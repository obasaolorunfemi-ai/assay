import { describe, expect, it } from 'vitest';
import { checkGrounding, stripTags } from '../src/grounding.js';

// Claim text left generic (no figure) by default, so the draft-vs-claim value check has nothing to compare against and stays silent.
const claims = (n: number, texts: Record<number, string> = {}) => Array.from({ length: n }, (_, i) => ({ ref: i + 1, text: texts[i + 1] || `claim ${i + 1}` }));
const g = (body: string, c = claims(3), platform = false) => checkGrounding(body, c, { hasPlatformData: platform });

describe('checkGrounding (Content Engine\'s cases)', () => {
  it('passes prose where every figure carries a valid tag', () => {
    const r = g('Brent traded near $70 a barrel in October [[c1]].\n\nThe naira lost about 40% of its dollar value over the year [[c2]].', claims(3, { 1: 'Brent near $70 a barrel', 2: 'naira lost 40%' }));
    expect(r.ok).toBe(true);
    expect(r.refsUsed).toEqual([1, 2]);
  });
  it('flags an untagged number', () => {
    const r = g('Remittances rose to $54 billion last year.');
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toMatchObject({ code: 'untagged-figure', kind: 'figure' });
    expect(r.violations[0]!.reason).toMatch(/no tag/);
  });
  it('flags a tag that points at a claim that does not exist', () => {
    const r = g('Growth hit 4% [[c9]].');
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toMatchObject({ code: 'unknown-claim' });
    expect(r.violations[0]!.reason).toMatch(/doesn't exist/);
  });
  it('allows c0 only when platform data was supplied', () => {
    expect(g('Our fee is 0.9% [[c0]].', claims(3), true).ok).toBe(true);
    expect(g('Our fee is 0.9% [[c0]].', claims(3), false).ok).toBe(false);
  });
  it('treats [verify: …] as intentional, not a violation', () => {
    const r = g('Imports fell sharply [verify: 2026 customs figure].');
    expect(r.ok).toBe(true);
    expect(r.verifyMarkers).toEqual(['2026 customs figure']);
  });
  it('ignores everything under the ## Sources heading', () => {
    expect(g('Prices rose 3% [[c1]].\n\n## Sources\n- Reuters, 2026 — https://reuters.com/x', claims(2, { 1: 'prices rose 3%' })).ok).toBe(true);
  });
});

describe('the line\'s figure against its cited claim\'s figure', () => {
  it('passes when they match', () => {
    expect(g('The official rate moved to ₦645 in 2023 [[c1]].', claims(1, { 1: 'World Bank PA.NUS.FCRF: 2023 = 645.19' })).ok).toBe(true);
  });
  it('catches a draft line stating a different figure from the one its claim distilled', () => {
    const r = g('The official rate moved to ₦425 in 2023 [[c1]].', claims(1, { 1: 'The official exchange rate averaged ₦645.19 in 2023 (World Bank PA.NUS.FCRF).' }));
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toMatchObject({ code: 'figure-mismatch' });
    expect(r.violations[0]!.reason).toMatch(/doesn't match c1's stated figure/);
  });
  it('known limitation: a claim carrying several numbers cannot pin the line to the right one (the values check does that)', () => {
    expect(g('The official rate moved to ₦425 in 2023 [[c1]].', claims(1, { 1: 'World Bank PA.NUS.FCRF: 2023 = 645.19, 2022 = 425.98' })).ok).toBe(true);
  });
  it('flags a figure that appears nowhere in its cited claim', () => {
    const r = g("Nigeria's petroleum imports reached $18.2 billion in 2024 [[c1]].", claims(1, { 1: 'CBN 2024 BoP: petroleum imports $14.06bn, non-oil imports $25.74bn' }));
    expect(r.ok).toBe(false);
    expect(r.violations[0]!.reason).toMatch(/doesn't match c1's stated figure/);
  });
  it('stays silent when the claim itself carries no figure', () => {
    expect(g('The shift toward regulated rails is deliberate, per the CBN [[c1]].', claims(1, { 1: 'CBN framed the shift as deliberate policy' })).ok).toBe(true);
  });
  it('the tolerance is yours to set', () => {
    const c = claims(1, { 1: 'rate was ₦645' });
    expect(checkGrounding('It rose to ₦660 [[c1]].', c).ok).toBe(true);                       // 2.3% off
    expect(checkGrounding('It rose to ₦660 [[c1]].', c, { tolerance: 0.01 }).ok).toBe(false);
  });
});

describe('[[logic]] and [[eg]] on a figure', () => {
  it('flags a figure tagged only [[logic]]', () => {
    const r = g('The gap widened past 60% [[logic]].', claims(1));
    expect(r.violations[0]).toMatchObject({ code: 'logic-figure' });
    expect(r.violations[0]!.reason).toMatch(/tagged only \[\[logic\]\]/);
  });
  it('allows [[logic]] on a line with no figure', () => expect(g('This makes the shift structurally sound [[logic]].', claims(1)).ok).toBe(true));
  it('allows an invented figure tagged [[eg]], the worked-example escape hatch', () => expect(g('Say an importer orders $200,000 of machinery [[eg]].', claims(1)).ok).toBe(true));
});

describe('[[calc]]', () => {
  it('rejects a bare [[calc]]', () => {
    const r = g('By that arithmetic, roughly $2m a month [[calc]].', claims(3));
    expect(r.violations[0]).toMatchObject({ code: 'calc-no-refs' });
    expect(r.violations[0]!.reason).toMatch(/no referenced claims/);
  });
  it('traces the legacy ref-list form, and says that its arithmetic was not re-run', () => {
    const r = g('By that arithmetic, roughly $2m a month [[calc: c1,c2]].', claims(3));
    expect(r.ok).toBe(true);
    expect(r.calcLines).toHaveLength(1);
    expect(r.refsUsed).toEqual([1, 2]);
    expect(r.warnings[0]!.reason).toMatch(/arithmetic was not re-run/);
  });
  it('re-runs a formula and passes when it matches the line', () => {
    expect(g("That's a 15% cut, or ₦96.75 off the base rate [[calc: c1*0.15]].", claims(1, { 1: 'base rate is ₦645' })).ok).toBe(true);
  });
  it('flags a formula whose result is not what the line states', () => {
    const r = g("That's a 15% cut, or ₦500 off the base rate [[calc: c1*0.15]].", claims(1, { 1: 'base rate is ₦645' }));
    expect(r.violations[0]).toMatchObject({ code: 'calc-mismatch' });
    expect(r.violations[0]!.reason).toMatch(/calc c1\*0\.15 = /);
  });
  it('flags a calc pointing at a claim that does not exist', () => {
    const r = g('Roughly ₦96.75 [[calc: c9*0.15]].', claims(1, { 1: 'base rate is ₦645' }));
    expect(r.violations[0]!.reason).toMatch(/doesn't exist/);
  });
  it('a formula that cannot be read is a violation, not a way to carry a figure unchecked (Content Engine let it pass)', () => {
    for (const bad of ['c1*', '(c1+', 'c1/0', 'c1*(c1']) {
      const r = g(`That is ₦96.75 off the rate [[calc: ${bad}]].`, claims(1, { 1: 'base rate is ₦645' }));
      expect(r.ok, bad).toBe(false);
      expect(r.violations[0]!.code, bad).toBe('calc-unreadable');
    }
  });
  it('a calc built on a claim with no number is a warning (it cannot be re-run), not a violation', () => {
    const r = g('Roughly ₦96.75 [[calc: c1*0.15]].', claims(1, { 1: 'the rate was high' }));
    expect(r.ok).toBe(true);
    expect(r.warnings[0]!.reason).toMatch(/states no number/);
  });
});

describe('every line is checked, not just prose with a big number', () => {
  const c = claims(2, { 1: 'Reserves $34 billion', 2: 'claim 2' });
  it('checks bullets, blockquotes and numbered lines like prose', () => {
    for (const line of ['- Remittances reached $54 billion last year.', '* Remittances reached $54 billion last year.', '> Remittances reached $54 billion last year.', '1. Remittances reached $54 billion last year.']) {
      const r = g(`Cold open [[c1]].\n\n${line}`, c);
      expect(r.ok, line).toBe(false);
      expect(r.violations[0]!.kind).toBe('figure');
    }
  });
  it('passes a tagged bullet', () => expect(g('- Reserves were $34 billion [[c1]].', c).ok).toBe(true));
  it('counts small numbers with a unit as figures', () => {
    for (const line of ['She spent 12 years at the bank.', 'He held three postings abroad.', 'The desk has 40 staff.', 'It took two decades.']) expect(g(line, c).ok, line).toBe(false);
  });
  it('does not turn ordinary words into figures', () => expect(g('One day the rate will settle, and a year from now it may not matter.', c).ok).toBe(true));
  it('does not demand a tag on a heading', () => expect(g('## Why 2026 is different\n\nPlain prose [[logic]].', c).ok).toBe(true));
  it('skips the machine-generated data inside a code fence', () => {
    expect(g('Chart below [[logic]].\n\n```chart\n{"values": [425, 430]}\n```\n\nDone.', c).ok).toBe(true);
  });
  it('unit words can be added', () => {
    expect(checkGrounding('It shipped 40 containers.', c).ok).toBe(true);
    expect(checkGrounding('It shipped 40 containers.', c, { countUnits: ['container'] }).ok).toBe(false);
    expect(checkGrounding('It shipped 1 container.', c, { countUnits: ['container'] }).ok).toBe(false);
    expect(checkGrounding('It shipped 40 containers.', c, { countUnits: ['.*'] }).ok).toBe(true);   // a unit is a word, never a pattern
  });
});

describe('the tag format is a parameter', () => {
  const tags = { open: '{{', close: '}}', claim: 's', calc: 'math', logic: 'reason', example: 'sample', verify: 'check' };
  const c = claims(2, { 1: 'Reserves $34 billion' });
  it('reads another syntax the same way', () => {
    expect(checkGrounding('Reserves were $34 billion {{s1}}.', c, { tags }).ok).toBe(true);
    const bad = checkGrounding('Reserves were $54 billion {{s1}}.', c, { tags });
    expect(bad.violations[0]).toMatchObject({ code: 'figure-mismatch' });
    expect(bad.violations[0]!.reason).toMatch(/s1's stated figure/);
    expect(checkGrounding('Growth hit 4% {{s9}}.', c, { tags }).violations[0]!.reason).toBe("tag points at claim s9, which doesn't exist (valid: s1–s2)");
    expect(checkGrounding('A fee of $200,000 {{sample}}.', c, { tags }).ok).toBe(true);
    expect(checkGrounding('Imports fell [check: customs].', c, { tags }).verifyMarkers).toEqual(['customs']);
  });
  it('the default syntax is not read when you use another', () => {
    expect(checkGrounding('Reserves were $34 billion [[c1]].', c, { tags }).ok).toBe(false);
  });
});

describe('summary and coverage', () => {
  it('counts lines, and says which are not grounded', () => {
    const r = g('Fine [[logic]].\n\nGrowth hit 4% with no tag.\n\nReserves were $34 billion [[c1]].', claims(1, { 1: 'Reserves $34 billion' }));
    expect(r.summary.text).toBe('Lines: 3 · ✓ 2 grounded · ✕ 1 not grounded — do not publish the flagged lines as they stand.');
    expect(r.coverage).toEqual({ used: 1, total: 1 });
  });
});

describe('stripTags', () => {
  it('removes tags and tidies spacing', () => expect(stripTags('Growth hit 4% [[c1]] this year.')).toBe('Growth hit 4% this year.'));
  it('keeps [verify: …] unless told to drop it', () => {
    expect(stripTags('x [verify: y]')).toBe('x [verify: y]');
    expect(stripTags('x [verify: y]', { dropVerify: true }).trim()).toBe('x');
  });
  it('follows the tag format', () => expect(stripTags('Growth {{s1}} hit 4%.', { tags: { open: '{{', close: '}}' } })).toBe('Growth hit 4%.'));
});

describe('hostile and odd input', () => {
  it('never throws, and fails nothing it cannot read', () => {
    expect(checkGrounding(undefined as unknown as string, []).ok).toBe(true);
    expect(checkGrounding('Growth hit 4% [[c1]].', null as unknown as []).ok).toBe(false);
    expect(() => checkGrounding('x [[calc: ' + '('.repeat(500) + ']]', claims(1))).not.toThrow();
  });
  it('stays fast on a megabyte of tags, digits and brackets', () => {
    const t = Date.now();
    checkGrounding('[[c1]] 12,345.67% $1 '.repeat(50_000), claims(1));
    checkGrounding('[['.repeat(200_000) + '9'.repeat(300_000), claims(1));
    checkGrounding('a\n'.repeat(500_000), claims(1));
    expect(Date.now() - t).toBeLessThan(5000);
  });
  it('reads at most maxLines lines', () => {
    const r = checkGrounding('Growth hit 4%.\n'.repeat(100), claims(1), { maxLines: 10 });
    expect(r.violations).toHaveLength(10);
  });
});
