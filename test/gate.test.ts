import { describe, expect, it } from 'vitest';
import { createGate, defaultPolicy, normalizePolicy, rules, summariseRecency, type GateClaim, type GateSource } from '../src/gate.js';

const src = (url: string, extra: Partial<GateSource> = {}): GateSource => ({ url, publisher: 'x', tier: null, date: null, ...extra });
const claim = (category: string, sources: GateSource[], text = 'a claim'): GateClaim => ({ text, category, sources });
// Content Engine's setup: its own specialists, and its rule for estimates, causes and force majeure
const ce = () => createGate({ domains: { 'woodmac.com': 2, 'kpler.com': 2 }, rules: [rules.estimatesCausalLegalNeedSpecialist] });

describe('tierOf (Content Engine\'s tierFor cases)', () => {
  const g = ce();
  it('resolves listed domains and their subdomains', () => {
    expect(g.tierOf('https://www.imf.org/en/x')).toBe(1);
    expect(g.tierOf('https://blogs.worldbank.org/x')).toBe(1);
    expect(g.tierOf('https://en.wikipedia.org/wiki/x')).toBe(4);
    expect(g.tierOf('https://a.b.reuters.com/x')).toBe(3);
  });
  it('lifts unlisted government, IGO and university domains', () => {
    expect(g.tierOf('https://finance.gov.zz/report')).toBe(1);
    expect(g.tierOf('https://who.int/news')).toBe(1);
    expect(g.tierOf('https://econ.harvard.edu/paper')).toBe(2);
  });
  it('returns null for an unknown domain', () => {
    expect(g.tierOf('https://some-random-blog.example/post')).toBeNull();
  });
  it('does not match a host that merely ends in a listed name', () => {
    expect(g.tierOf('https://notreuters.com/x')).toBeNull();
    expect(g.tierOf('https://reuters.com.evil.example/x')).toBeNull();
  });
});

describe('check (Content Engine\'s applyGate cases)', () => {
  it('drops a loss-estimate with no Tier 0–2 corroboration', () => {
    const { passed, dropped } = ce().check([claim('loss-estimate', [src('https://reuters.com/x', { tier: 3, date: '2020-01-01' })])]);
    expect(passed).toHaveLength(0);
    expect(dropped[0]!.reason).toMatch(/Tier 2/);
    expect(dropped[0]).toMatchObject({ outcome: 'needs-corroboration', bucket: 'failed' });
  });
  it('passes a loss-estimate that has a Tier 2 source', () => {
    const { passed } = ce().check([claim('loss-estimate', [src('https://woodmac.com/x', { tier: 2, date: '2020-01-01' }), src('https://reuters.com/x', { tier: 3, date: '2020-01-01' })])]);
    expect(passed).toHaveLength(1);
  });
  it('holds a tier-3-only event whose only source is under 24 hours old', () => {
    const now = new Date('2026-01-02T00:00:00Z');
    const { held, passed } = ce().check([claim('event', [src('https://apnews.com/x', { tier: 3, date: '2026-01-01T18:00:00Z' })])], { now });
    expect(passed).toHaveLength(0);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ outcome: 'hold', bucket: 'check' });
  });
  it('accepts an older tier-3 event', () => {
    const now = new Date('2026-01-10T00:00:00Z');
    expect(ce().check([claim('event', [src('https://apnews.com/x', { tier: 3, date: '2026-01-01' })])], { now }).passed).toHaveLength(1);
  });
  it('does not hold fresh news that a Tier 2 source also backs', () => {
    const now = new Date('2026-01-02T00:00:00Z');
    expect(ce().check([claim('event', [src('https://apnews.com/x', { date: '2026-01-01T18:00:00Z' }), src('https://kpler.com/x', { date: '2025-12-01' })])], { now }).passed).toHaveLength(1);
  });
  it('treats a first-party domain as Tier 0', () => {
    const g = createGate({ firstParty: ['mybrand.example'] });
    const { passed } = g.check([claim('price', [src('https://data.mybrand.example/rates')])]);
    expect(passed[0]!.sources[0]!.tier).toBe(0);
    expect(passed[0]!.sources[0]!.firstParty).toBe(true);
  });
  it('caps a trusted (unlisted) domain at Tier 3, never higher', () => {
    const g = createGate({ trusted: ['myniche.example'] });
    const s = g.check([claim('context', [src('https://myniche.example/post', { tier: 1, date: '2020-01-01' })])]).verdicts[0]!.sources[0]!;
    expect(s).toMatchObject({ tier: 3, trusted: true, listed: false });
  });
  it('drops a claim with no sources', () => {
    const { dropped } = ce().check([claim('context', [])]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ outcome: 'no-source', reason: 'no usable source' });
  });
});

describe('a claim\'s author cannot certify an unknown domain (Content Engine\'s model-trust seam)', () => {
  it('caps an unlisted domain at Tier 3 even when the author says Tier 2', () => {
    const { dropped } = ce().check([claim('loss-estimate', [src('https://some-random-blog.example/x', { tier: 2, date: '2026-01-01' })])]);
    expect(dropped[0]!.reason).toMatch(/Tier 2/);
  });
  it('still lets the author lower it to Tier 3', () => {
    expect(ce().check([claim('context', [src('https://some-random-blog.example/x', { tier: 3, date: '2026-01-01' })])]).passed[0]!.sources[0]!.tier).toBe(3);
  });
  it('honours a self-declared Tier 4, which then fails on its own rule', () => {
    const { dropped } = ce().check([claim('context', [src('https://some-random-blog.example/x', { tier: 4, date: '2026-01-01' })])]);
    expect(dropped[0]).toMatchObject({ outcome: 'low-tier-only' });
    expect(dropped[0]!.reason).toMatch(/Tier 4 sources only/);
  });
  it('leaves a listed domain\'s real tier alone', () => {
    expect(ce().check([claim('loss-estimate', [src('https://kpler.com/x', { date: '2026-01-01' })])]).passed[0]!.sources[0]!.tier).toBe(2);
  });
  it('a listed domain cannot be lowered or raised by the author either', () => {
    expect(ce().check([claim('context', [src('https://imf.org/x', { tier: 4, date: '2020-01-01' })])]).passed[0]!.sources[0]!.tier).toBe(1);
  });
});

describe('a mislabelled claim still meets its rule (Content Engine\'s text backstop)', () => {
  it('drops a loss estimate labelled "context", and says it read like one', () => {
    const { dropped } = ce().check([claim('context', [src('https://reuters.com/x', { date: '2026-01-01' })], 'Shipping delays cost traders an estimated $400 million.')]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.reason).toMatch(/reads like a loss estimate.*labelled "context"/);
  });
  it('recognises causal and force-majeure wording', () => {
    for (const t of ['Margins fell as a direct result of the FX shortage.', 'The terminal declared force majeure on exports.']) {
      expect(ce().check([claim('context', [src('https://reuters.com/x', { date: '2026-01-01' })], t)]).dropped).toHaveLength(1);
    }
  });
  it('passes an ordinary price claim at Tier 3 alone', () => {
    expect(ce().check([claim('context', [src('https://reuters.com/x', { date: '2026-01-01' })], 'Brent traded near $70 a barrel in October.')]).passed).toHaveLength(1);
  });
});

describe('a different rule on the same engine (the Hormuz tracker\'s: one authority or two press)', () => {
  const g = () => createGate({ rules: [rules.oneAuthorityOrTwoPress] });
  const decl = (sources: GateSource[]) => g().check([claim('declaration', sources, 'Company X declared force majeure.')], { now: new Date('2026-06-01') }).verdicts[0]!;
  it('passes with one Tier 1 source', () => expect(decl([src('https://imf.org/x', { date: '2026-01-01' })]).outcome).toBe('pass'));
  it('passes with two different Tier 3 sources', () => expect(decl([src('https://reuters.com/a', { date: '2026-01-01' }), src('https://apnews.com/b', { date: '2026-01-01' })]).outcome).toBe('pass'));
  it('does not count two articles from the same site as two sources', () => expect(decl([src('https://reuters.com/a', { date: '2026-01-01' }), src('https://reuters.com/b', { date: '2026-01-01' })]).outcome).toBe('needs-corroboration'));
  it('fails with one Tier 3 source, and says what would be enough', () => {
    const v = decl([src('https://reuters.com/a', { date: '2026-01-01' })]);
    expect(v.outcome).toBe('needs-corroboration');
    expect(v.reason).toBe('a declaration needs one source at Tier 1 or better or 2 different sources at Tier 3 or better');
    expect(v.rule).toBe('a declaration');
  });
  it('does not apply to other kinds of claim', () => {
    expect(g().check([claim('event', [src('https://reuters.com/a', { date: '2026-01-01' })])], { now: new Date('2026-06-01') }).passed).toHaveLength(1);
  });
});

describe('report', () => {
  it('summarises, and lists the domains the policy did not know', () => {
    const r = ce().check([
      claim('event', [src('https://reuters.com/a', { date: '2020-01-01' })]),
      claim('loss-estimate', [src('https://reuters.com/b', { date: '2020-01-01' })]),
      claim('context', [src('https://new-site.example/p', { date: '2020-01-01' })]),
    ]);
    expect(r.summary.text).toBe('Claims: 3 · ✓ 2 passed · ✕ 1 dropped — do not state the dropped ones as fact.');
    expect(r.ok).toBe(false);
    expect(r.unlistedDomains).toEqual(['new-site.example']);
    expect([r.passed.length, r.dropped.length, r.held.length]).toEqual([2, 1, 0]);
  });
  it('is ok with no claims', () => { expect(ce().check([]).ok).toBe(true); });
});

describe('the gate heals instead of failing', () => {
  it('a broken policy entry is dropped and reported; the rest of the policy still works', () => {
    const g = createGate({
      domains: { 'good.example': 1, 'bad.example': 'high' as unknown as number, 'worse.example': 42 },
      suffixes: [{ test: 'not a regexp' as unknown as RegExp, tier: 1 }],
      rules: [{ name: 'half a rule', anyOf: [] } as never, { name: 'broken tiers', categories: ['x'], anyOf: [{ atLeast: 0, tier: 99 }] } as never],
      unlistedTier: 'three' as unknown as number,
    });
    expect(g.warnings.length).toBeGreaterThanOrEqual(5);
    expect(g.warnings.join(' ')).toMatch(/bad\.example/);
    expect(g.tierOf('https://good.example/x')).toBe(1);
    expect(g.tierOf('https://bad.example/x')).toBeNull();
    // a rule that cannot be met is dropped loudly rather than silently rejecting every claim
    expect(g.check([claim('x', [src('https://reuters.com/a', { date: '2020-01-01' })])]).passed).toHaveLength(1);
  });
  it('a clean policy has no warnings', () => { expect(ce().warnings).toEqual([]); });
  it('a claim that cannot be judged never passes', () => {
    const evil = { text: 'x', category: 'x', get sources(): never { throw new Error('boom'); } } as unknown as GateClaim;
    const r = ce().check([evil, claim('event', [src('https://reuters.com/a', { date: '2020-01-01' })])]);
    expect(r.verdicts.map((v) => v.outcome)).toEqual(['error', 'pass']);
    expect(r.verdicts[0]!.bucket).toBe('check');
    expect(r.passed).toHaveLength(1);
  });
  it('odd input is handled, not thrown on', () => {
    const g = ce();
    expect(g.check(null as unknown as GateClaim[]).verdicts).toEqual([]);
    expect(g.check([{ text: 'x', sources: 'nope' } as unknown as GateClaim]).verdicts[0]!.outcome).toBe('no-source');
    expect(g.check([{ text: 'x', sources: [null, { url: '' }, { url: 12 }] } as unknown as GateClaim]).verdicts[0]!.outcome).toBe('no-source');
  });
  it('reads no more than maxSourcesPerClaim sources per claim', () => {
    const many = Array.from({ length: 5000 }, (_, i) => src(`https://site${i}.example/x`, { date: '2020-01-01' }));
    const v = createGate({ maxSourcesPerClaim: 10 }).check([claim('context', many)]).verdicts[0]!;
    expect(v.sources).toHaveLength(10);
  });
  it('the shipped default policy is itself valid', () => {
    expect(normalizePolicy({}, defaultPolicy).warnings).toEqual([]);
  });
});

describe('summariseRecency (Content Engine\'s recency helper)', () => {
  const now = new Date('2026-06-01');
  it('lists sources older than two years', () => {
    const r = summariseRecency([src('https://a.example', { date: '2026-05-01' }), src('https://b.example', { date: '2022-01-01' }), src('https://c.example')], { now });
    expect(r).toMatchObject({ dated: 2, total: 3, staleCount: 1 });
    expect(r.stale[0]!.url).toBe('https://b.example');
    expect(r.note).toMatch(/1 of 2 dated sources are more than 2 years old \(oldest: 2022-01-01\)/);
  });
  it('says so when nothing is dated, and when everything is fresh', () => {
    expect(summariseRecency([src('https://a.example')], { now }).note).toMatch(/No publication dates/);
    expect(summariseRecency([src('https://a.example', { date: '2026-01-01' })], { now }).note).toMatch(/within the last 2 years/);
  });
});
