import { describe, expect, it } from 'vitest';
import { createAssay, parseCitations } from '../src/index.js';
import type { Citation } from '../src/index.js';
import { CANARY_ROUTES, cr, crItem, ol, oa, router, type Route } from './helpers.js';

const REAL = crItem('Prospect Theory: An Analysis of Decision under Risk', ['Kahneman', 'Tversky'], '10.2307/1914185');
const ref = (o: Partial<Citation> = {}): Citation => ({ raw: 'x', tag: '[x]', authors: 'Kahneman & Tversky', year: '1979', title: 'Prospect Theory: An Analysis of Decision under Risk', venue: 'Econometrica', url: '', tier: 'search', ...o });
const invented = (i: number): Citation => ref({ authors: `Zzz${i}`, title: `An Invented Title Number ${i} About Nothing Real`, year: '2001' });
const MIN = 60_000;

/** A clock we control. */
function clock(start = 1_700_000_000_000) { let t = start; return { now: () => t, advance: (ms: number) => { t += ms; } }; }
const opts = (net: { fetch: typeof fetch }, c = clock(), extra = {}) => ({ fetch: net.fetch, now: c.now, requestsPerSecond: 1e6, retryDelayMs: 0, ...extra });
const hits = (net: { calls: string[] }, host: string) => net.calls.filter((u) => u.includes(host)).length;

describe('a source that changes what it sends is treated as an outage, never as "no results"', () => {
  const shapes: Array<[string, Route]> = [
    ['CrossRef sends an HTML error page with a 200', { status: 200, body: null }],
    ['CrossRef renames the field', { status: 200, body: { message: { results: [] } } }],
    ['CrossRef sends an unrelated object', { status: 200, body: { error: 'maintenance' } }],
  ];
  for (const [name, route] of shapes) {
    it(name, async () => {
      const net = router({ 'api.crossref.org/works?query': route, 'api.openalex.org': oa(), 'openlibrary.org/search.json': ol() }, { canaries: false });
      // the self-test is off so that this layer is tested ON ITS OWN (with it on, the self-test would also catch these)
      const rep = await createAssay(opts(net, clock(), { selfTest: false })).verify([invented(1)]);
      expect(rep.verdicts[0]).toMatchObject({ status: 'unavailable', bucket: 'check', retryable: true });
      expect(rep.verdicts[0]!.reason).toMatch(/CrossRef: answered with something unexpected/);
    });
  }
  it('the same for OpenAlex and Open Library', async () => {
    const a = router({ 'api.crossref.org/works?query': cr(), 'api.openalex.org': { status: 200, body: { data: [] } }, 'openlibrary.org/search.json': ol() }, { canaries: false });
    expect((await createAssay(opts(a, clock(), { selfTest: false })).verify([invented(2)])).verdicts[0]).toMatchObject({ status: 'unavailable', reason: expect.stringMatching(/OpenAlex: answered with something unexpected/) });
    const b = router({ 'api.crossref.org/works?query': cr(), 'api.openalex.org': oa(), 'openlibrary.org/search.json': { status: 200, body: { numFound: 0 } } }, { canaries: false });
    expect((await createAssay(opts(b, clock(), { selfTest: false })).verify([invented(3)])).verdicts[0]).toMatchObject({ status: 'unavailable', reason: expect.stringMatching(/Open Library: answered with something unexpected/) });
  });
});

describe('the breaker', () => {
  it('leaves a failing source alone after three failures, and probes it again when the wait is over', async () => {
    const c = clock();
    let up = false;
    const base = router({ 'api.openalex.org': oa(), 'openlibrary.org/search.json': ol() });
    const f = (async (url: string, init?: RequestInit) => {
      if (String(url).includes('api.crossref.org/works?query.bibliographic=An')) { base.calls.push(String(url)); return up ? ({ ok: true, status: 200, json: async () => ({ message: { items: [] } }) } as Response) : ({ ok: false, status: 500, json: async () => ({}) } as Response); }
      return base.fetch(url, init);
    }) as unknown as typeof fetch;
    const a = createAssay({ fetch: f, now: c.now, requestsPerSecond: 1e6, retryDelayMs: 0, selfTest: false, breaker: { failuresToOpen: 3, cooldownMs: MIN } });
    for (let i = 0; i < 3; i++) await a.verify([invented(10 + i)]);
    const after3 = hits(base, 'api.crossref.org');
    await a.verify([invented(20)]);
    expect(hits(base, 'api.crossref.org')).toBe(after3);            // not asked: it is being given time
    expect((await a.health()).find((h) => h.name === 'CrossRef')).toMatchObject({ state: 'down' });
    expect(hits(base, 'api.crossref.org')).toBe(after3);            // and health() does not probe it either
    c.advance(MIN + 1);
    up = true;
    const r = await a.verify([invented(21)]);                        // the probe goes through, succeeds, closes the breaker
    expect(hits(base, 'api.crossref.org')).toBe(after3 + 1);
    expect(r.verdicts[0]!.status).toBe('notfound');
    await a.verify([invented(22)]);
    expect(hits(base, 'api.crossref.org')).toBe(after3 + 2);        // asked normally again
  });

  it('believes a source that says how long to wait, and never waits longer than the cap', async () => {
    const c = clock();
    const slow = { ok: false, status: 429, headers: new Headers({ 'retry-after': '71816' }), json: async () => ({}) } as Response;   // what OpenAlex sent: twenty hours
    const base = router({ 'api.crossref.org/works?query': cr(), 'openlibrary.org/search.json': ol() });
    const f = (async (url: string, init?: RequestInit) => { if (String(url).includes('api.openalex.org/works?search=An')) { base.calls.push(String(url)); return slow; } return base.fetch(url, init); }) as unknown as typeof fetch;
    const a = createAssay({ fetch: f, now: c.now, requestsPerSecond: 1e6, retryDelayMs: 0, selfTest: false, breaker: { maxCooldownMs: 15 * MIN } });
    await a.verify([invented(30)]);
    expect(hits(base, 'api.openalex.org')).toBe(1);                  // one request, not a retry three seconds later
    await a.verify([invented(31)]);
    expect(hits(base, 'api.openalex.org')).toBe(1);                  // left alone
    const h = (await a.health()).find((x) => x.name === 'OpenAlex')!;
    expect(h.state).toBe('down');
    expect(h.retryAt! - c.now()).toBe(15 * MIN);                     // capped: it is tried again, not shunned for twenty hours
    c.advance(15 * MIN + 1);
    await a.verify([invented(32)]);
    expect(hits(base, 'api.openalex.org')).toBe(2);
  });

  it('a short Retry-After is retried once inside the call', async () => {
    let n = 0;
    const base = router({ 'api.crossref.org/works?query': cr(REAL), 'api.openalex.org': oa(), 'openlibrary.org/search.json': ol() });
    const f = (async (url: string, init?: RequestInit) => {
      if (String(url).includes('api.crossref.org/works?query.bibliographic=Prospect') && n++ === 0) return { ok: false, status: 429, headers: new Headers({ 'retry-after': '0' }), json: async () => ({}) } as Response;
      return base.fetch(url, init);
    }) as unknown as typeof fetch;
    const rep = await createAssay({ fetch: f, requestsPerSecond: 1e6, retryDelayMs: 0 }).verify([ref()]);
    expect(rep.verdicts[0]!.status).toBe('found');
  });
});

describe('a source is not believed when it cannot find a work that exists', () => {
  const brokenCrossRef = (net: ReturnType<typeof router>) => net;
  it('"not found" from a silently broken source becomes "unavailable", with the reason', async () => {
    // CrossRef returns well-formed, empty answers for EVERYTHING, including the canary. No error anywhere.
    const net = router({ 'api.crossref.org/works?query.bibliographic=The%20Problem%20of%20Social%20Cost': cr(), 'api.crossref.org/works?query': cr(), 'api.openalex.org': oa(), 'openlibrary.org/search.json': ol() });
    const a = createAssay(opts(brokenCrossRef(net)));
    const rep = await a.verify([invented(40)]);
    expect(rep.verdicts[0]).toMatchObject({ status: 'unavailable', bucket: 'check', retryable: true });
    expect(rep.verdicts[0]!.reason).toMatch(/CrossRef did not pass its self-test/);
    expect(rep.ok).toBe(true);                                       // nobody was accused
    const h = (await a.health()).find((x) => x.name === 'CrossRef')!;
    expect(h).toMatchObject({ state: 'degraded', selfTest: 'failed' });
  });

  it('a healthy source is believed, and its self-test is trusted for ten minutes (one test, not one per citation)', async () => {
    const c = clock();
    const net = router({ 'api.crossref.org/works?query': cr(), 'api.openalex.org': oa(), 'openlibrary.org/search.json': ol() });
    const a = createAssay(opts(net, c));
    const many = Array.from({ length: 10 }, (_, i) => invented(50 + i));
    const rep = await a.verify(many);
    expect(rep.verdicts.every((v) => v.status === 'notfound')).toBe(true);
    const canaryHits = (host: string, key: string) => net.calls.filter((u) => u.includes(host) && u.includes(key)).length;
    expect(canaryHits('api.crossref.org', 'Social%20Cost')).toBe(1);   // single-flight: ten citations at once, one self-test per source
    expect(canaryHits('api.openalex.org', 'Attention')).toBe(1);
    expect(canaryHits('openlibrary.org', 'Why%20Nations')).toBe(1);
    await a.verify([invented(60)]);
    expect(canaryHits('api.crossref.org', 'Social%20Cost')).toBe(1);   // still trusted
    c.advance(11 * MIN);
    await a.verify([invented(61)]);
    expect(canaryHits('api.crossref.org', 'Social%20Cost')).toBe(2);   // retested after ten minutes
  });

  it('a source with no self-test (your own) is believed as it stands', async () => {
    const mine = { name: 'MyIndex', search: async () => ({ ok: true, candidates: [] }) };
    const rep = await createAssay({ fetch: router({}).fetch, sources: [mine], requestsPerSecond: 1e6 }).verify([invented(70)]);
    expect(rep.verdicts[0]!.status).toBe('notfound');
  });

  it('an approximate "no related work" needs the self-test too', async () => {
    const net = router({ 'api.openalex.org/works?search=An': oa(), 'api.openalex.org/works?search=quantum': oa(), 'openlibrary.org/search.json?author=Zorblatt': ol(), 'api.openalex.org/works?search=Attention%20Is%20All%20You%20Need': oa() });
    const approx = parseCitations('[CITATION — approximate: Zorblatt, 2010-2015, quantum remittance theory — search: https://scholar.google.com/scholar?q=x]')[0]!;
    const rep = await createAssay(opts(net)).verify([approx]);
    expect(rep.verdicts[0]).toMatchObject({ status: 'unavailable' });
    expect(rep.verdicts[0]!.reason).toMatch(/OpenAlex did not pass its self-test/);
  });
});

describe('what is remembered is about the citation AND its link', () => {
  const good = 'https://doi.org/10.2307/1914185', bad = 'https://doi.org/10.2308/ptri.1979.47.2.263';
  const routes: Record<string, Route> = {
    'api.crossref.org/works?query.bibliographic=Prospect': cr(REAL),
    'api.crossref.org/works/10.2307/1914185': { status: 200, body: { message: REAL } },
    'api.crossref.org/works/10.2308': { status: 404, body: {} }, 'doi.org/api/handles/10.2308': { status: 404, body: { responseCode: 100 } },
    'api.openalex.org': oa(), 'openlibrary.org/search.json': ol(),
  };
  it('a paper first cited with a good DOI does not make a later invented DOI pass, nor the reverse', async () => {
    const a = createAssay(opts(router(routes)));
    const first = (await a.verify([ref({ url: good })])).verdicts[0]!;
    const second = (await a.verify([ref({ url: bad })])).verdicts[0]!;
    expect(first).toMatchObject({ status: 'found', bucket: 'ok' });
    expect(second).toMatchObject({ status: 'badlink', bucket: 'failed' });
    const b = createAssay(opts(router(routes)));
    expect((await b.verify([ref({ url: bad })])).verdicts[0]!.status).toBe('badlink');
    expect((await b.verify([ref({ url: good })])).verdicts[0]!.status).toBe('found');
  });
});

describe('an old answer beats "could not tell"', () => {
  it('serves the earlier result, marked stale, when the sources are down; and stops after the stale limit', async () => {
    const c = clock();
    let down = false;
    const base = router({ 'api.crossref.org/works?query': cr(REAL), 'api.openalex.org': oa(), 'openlibrary.org/search.json': ol() });
    const f = (async (url: string, init?: RequestInit) => down ? ({ ok: false, status: 503, json: async () => ({}) } as Response) : base.fetch(url, init)) as unknown as typeof fetch;
    const a = createAssay({ fetch: f, now: c.now, requestsPerSecond: 1e6, retryDelayMs: 0, cacheTtlMs: 86_400_000, staleTtlMs: 7 * 86_400_000 });
    expect((await a.verify([ref()])).verdicts[0]).toMatchObject({ status: 'found', bucket: 'ok' });
    c.advance(2 * 86_400_000);                                       // past "fresh", inside "stale"
    down = true;
    const v = (await a.verify([ref()])).verdicts[0]!;
    expect(v).toMatchObject({ status: 'found', bucket: 'ok', stale: true, retryable: false });
    expect(v.message).toMatch(/From an earlier check/);
    c.advance(6 * 86_400_000);                                       // past the stale limit
    expect((await a.verify([ref()])).verdicts[0]).toMatchObject({ status: 'unavailable' });
  });

  it('never keeps "unavailable" as an answer', async () => {
    const net = router({ 'api.crossref.org': { status: 500, body: {} }, 'api.openalex.org': oa(), 'openlibrary.org/search.json': ol() }, { canaries: false });
    const a = createAssay(opts(net));
    await a.verify([invented(80)]);
    const first = net.calls.length;
    await a.verify([invented(80)]);
    expect(net.calls.length).toBeGreaterThan(first);
  });
});

describe('recheck()', () => {
  it('settles only what could not be settled, once the sources are back', async () => {
    const c = clock();
    let down = true;
    const base = router({ 'api.crossref.org/works?query': cr(REAL), 'api.openalex.org': oa(), 'openlibrary.org/search.json': ol() });
    const f = (async (url: string, init?: RequestInit) => down && String(url).includes('api.crossref.org/works?query.bibliographic=Prospect') ? ({ ok: false, status: 503, json: async () => ({}) } as Response) : base.fetch(url, init)) as unknown as typeof fetch;
    const a = createAssay({ fetch: f, now: c.now, requestsPerSecond: 1e6, retryDelayMs: 0, selfTest: false, breaker: { failuresToOpen: 99 } });
    const first = await a.verify([ref(), invented(90)]);
    expect(first.verdicts.map((v) => [v.status, v.retryable])).toEqual([['unavailable', true], ['notfound', false]]);
    down = false;
    const before = base.calls.length;
    const second = await a.recheck(first);
    expect(second.verdicts.map((v) => v.status)).toEqual(['found', 'notfound']);
    expect(base.calls.slice(before).some((u) => u.includes('Invented'))).toBe(false);   // the settled one was not asked again
  });
});

describe('repair()', () => {
  const text = 'A [Kahneman & Tversky, 1979, "Prospect Theory: An Analysis of Decision under Risk" — Econometrica — https://doi.org/10.2308/ptri.1979.47.2.263] B [Meyer, 2016, "The Impact of Microcredit: Evidence from Bosnia and Herzegovina" — WD — https://scholar.google.com/scholar?q=meyer]';
  const routes = (replacementOk: boolean): Record<string, Route> => ({
    'api.crossref.org/works?query.bibliographic=Prospect': cr(REAL),
    'api.crossref.org/works/10.2308': { status: 404, body: {} },
    'doi.org/api/handles/10.2308': { status: 404, body: { responseCode: 100 } },
    'api.crossref.org/works/10.2307/1914185': replacementOk ? { status: 200, body: { message: REAL } } : { status: 404, body: {} },
    'doi.org/api/handles/10.2307': { status: 404, body: { responseCode: 100 } },
    'api.crossref.org/works?query': cr(), 'api.openalex.org': oa(), 'openlibrary.org/search.json': ol(),
  });

  it('replaces an invented DOI with the matching record\'s, after looking the new one up, and says what it did', async () => {
    const a = createAssay(opts(router(routes(true))));
    const rep = await a.check(text);
    expect(rep.verdicts.map((v) => v.status)).toEqual(['badlink', 'notfound']);
    const fixed = await a.repair(text, rep);
    expect(fixed.changes).toHaveLength(1);
    expect(fixed.changes[0]).toMatchObject({ from: 'https://doi.org/10.2308/ptri.1979.47.2.263', to: 'https://doi.org/10.2307/1914185' });
    expect(fixed.text).toContain('https://doi.org/10.2307/1914185');
    expect(fixed.text).not.toContain('10.2308');
    expect(fixed.text).toContain('[Meyer, 2016');                    // the invented paper is left for you (strip() removes it)
    expect(fixed.report.verdicts.map((v) => v.status)).toEqual(['found', 'notfound']);
  });

  it('changes nothing when the replacement link does not itself check out', async () => {
    const a = createAssay(opts(router(routes(false))));
    const rep = await a.check(text);
    const fixed = await a.repair(text, rep);
    expect(fixed.changes).toEqual([]);
    expect(fixed.text).toBe(text);
  });

  it('does not touch a near-miss title, however the DOI looks', async () => {
    const near = crItem('Prospect Theory: A Different Analysis of Choice under Uncertainty Today', ['Kahneman', 'Tversky'], '10.2307/1914185');
    const r = routes(true); r['api.crossref.org/works?query.bibliographic=Prospect'] = cr(near);
    const a = createAssay(opts(router(r)));
    const rep = await a.check(text);
    const fixed = await a.repair(text, rep);
    expect(fixed.changes).toEqual([]);
  });
});

describe('health()', () => {
  it('reports each source: healthy, degraded (broken without an error) or down', async () => {
    const healthy = router({});
    expect((await createAssay(opts(healthy)).health()).map((h) => [h.name, h.state, h.selfTest])).toEqual([['CrossRef', 'healthy', 'passed'], ['OpenAlex', 'healthy', 'passed'], ['Open Library', 'healthy', 'passed']]);
    const sick: Record<string, Route> = { 'api.openalex.org': { status: 200, body: { results: [] } }, 'openlibrary.org': { status: 500, body: {} }, ...CANARY_ROUTES };
    const out = await createAssay(opts(router(sick, { canaries: false }))).health();
    expect(out.find((h) => h.name === 'CrossRef')!.state).toBe('healthy');
    expect(out.find((h) => h.name === 'OpenAlex')).toMatchObject({ state: 'degraded', selfTest: 'failed' });
    expect(out.find((h) => h.name === 'Open Library')!.lastProblem).toMatch(/HTTP 500/);
  });
});
