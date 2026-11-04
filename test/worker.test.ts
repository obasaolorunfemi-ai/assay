import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript modules, no types
import { LIMITS, allowance, applyReport, emptyTotals, parseReport, publicView } from '../worker/logic.mjs';
// @ts-expect-error plain JavaScript module, no types
import worker, { Counter } from '../worker/index.mjs';

const good = { v: 1, counts: { quotes: { checked: 3, ok: 1, check: 1, failed: 1 }, citations: { checked: 2, ok: 2, check: 0, failed: 0 } } };

describe('the counter rules', () => {
  it('accepts a well-formed report and refuses everything else', () => {
    const r = parseReport(JSON.stringify(good));
    expect(r).toMatchObject({ ok: true, total: 5 });
    const bad = [
      'nope', '{}', '{"v":2,"counts":{}}', '{"v":1,"counts":[]}', '{"v":1,"counts":{}}',
      JSON.stringify({ v: 1, counts: { 'hacked-check': { checked: 1, ok: 1, check: 0, failed: 0 } } }),
      JSON.stringify({ v: 1, counts: { quotes: { checked: 1.5, ok: 1.5, check: 0, failed: 0 } } }),
      JSON.stringify({ v: 1, counts: { quotes: { checked: 1, ok: 0, check: 0, failed: 0 } } }),
      JSON.stringify({ v: 1, counts: { quotes: { checked: -1, ok: -1, check: 0, failed: 0 } } }),
      JSON.stringify({ v: 1, counts: { quotes: { checked: 0, ok: 0, check: 0, failed: 0 } } }),
      JSON.stringify({ v: 1, counts: { quotes: { checked: 100001, ok: 100001, check: 0, failed: 0 } } }),
      JSON.stringify({ v: 1, counts: { quotes: { checked: 1, ok: 1, check: 0, failed: 0, text: 'Relocation…' } } }),
    ];
    for (const b of bad) expect(parseReport(b).ok, b).toBe(b.includes('text') ? true : false);
  });
  it('ignores any extra field, so text sent by mistake is never stored', () => {
    const r = parseReport(JSON.stringify({ v: 1, counts: { quotes: { checked: 1, ok: 1, check: 0, failed: 0, text: 'secret words' } }, note: 'hi' }));
    expect(JSON.stringify(r)).not.toMatch(/secret|hi/);
  });
  it('adds counts to totals and shows only the public view', () => {
    const t = applyReport(applyReport(emptyTotals(0), parseReport(JSON.stringify(good)).counts), parseReport(JSON.stringify(good)).counts);
    expect(t).toMatchObject({ reports: 2, checked: 10, ok: 6, check: 2, failed: 2 });
    expect(t.byCheck.quotes.failed).toBe(2);
    expect(Object.keys(publicView(t))).toEqual(['since', 'updated', 'reports', 'checked', 'ok', 'check', 'failed', 'byCheck', 'note']);
  });
  it('limits what one source can add in a day, and starts again the next day', () => {
    const s = { day: '', used: new Map() };
    expect(allowance(s, 'a', LIMITS.perSourcePerDay, '2026-11-04')).toBe(true);
    expect(allowance(s, 'a', 1, '2026-11-04')).toBe(false);
    expect(allowance(s, 'b', 1, '2026-11-04')).toBe(true);
    expect(allowance(s, 'a', 1, '2026-11-05')).toBe(true);
  });
});

// The Worker end to end, with Cloudflare's Durable Object replaced by an in-memory one.
const env = () => {
  const store = new Map<string, unknown>();
  const counter = new Counter({ storage: { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => { store.set(k, v); } } });
  return { ASSETS: { fetch: async () => new Response('asset') }, COUNTER: { idFromName: () => 'id', get: () => ({ fetch: (u: string, init?: RequestInit) => counter.fetch(new Request(u, init)) }) }, store };
};
const post = (body: unknown, headers: Record<string, string> = {}) => new Request('https://assay.example/api/count', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('the counter Worker', () => {
  it('counts a report and shows it on GET, with CORS for the public numbers', async () => {
    const e = env();
    expect((await worker.fetch(post(good), e)).status).toBe(202);
    const got = await worker.fetch(new Request('https://assay.example/api/count'), e);
    const body = await got.json();
    expect(body).toMatchObject({ reports: 1, checked: 5, failed: 1 });
    expect(got.headers.get('access-control-allow-origin')).toBe('*');
    expect(body.note).toMatch(/not verified/i);
  });
  it('refuses malformed, oversized and wrongly typed requests', async () => {
    const e = env();
    expect((await worker.fetch(post('not json'), e)).status).toBe(400);
    expect((await worker.fetch(post({ v: 1, counts: { evil: { checked: 1, ok: 1, check: 0, failed: 0 } } }), e)).status).toBe(400);
    expect((await worker.fetch(post('x'.repeat(5000)), e)).status).toBe(413);
    expect((await worker.fetch(new Request('https://assay.example/api/count', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(good) }), e)).status).toBe(415);
    expect((await worker.fetch(new Request('https://assay.example/api/count', { method: 'DELETE' }), e)).status).toBe(405);
    expect((await (await worker.fetch(new Request('https://assay.example/api/count'), e)).json()).reports).toBe(0);
  });
  it('rate-limits one source per day but still accepts another', async () => {
    const e = env();
    const big = { v: 1, counts: { quotes: { checked: 20000, ok: 20000, check: 0, failed: 0 } } };
    expect((await worker.fetch(post(big), e)).status).toBe(202);
    expect((await worker.fetch(post(good), e)).status).toBe(429);
    expect((await worker.fetch(post(good, { 'cf-connecting-ip': '198.51.100.9' }), e)).status).toBe(202);
  });
  it('stores no address and no text', async () => {
    const e = env();
    await worker.fetch(post({ ...good, counts: { quotes: { checked: 1, ok: 1, check: 0, failed: 0, text: 'private words' } } }), e);
    const stored = JSON.stringify([...e.store.values()]);
    expect(stored).not.toMatch(/203\.0\.113|private words/);
  });
  it('answers preflight, and passes every other path to the static site', async () => {
    const e = env();
    const pre = await worker.fetch(new Request('https://assay.example/api/count', { method: 'OPTIONS' }), e);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
    expect(await (await worker.fetch(new Request('https://assay.example/cases/'), e)).text()).toBe('asset');
  });
});
