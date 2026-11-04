import { describe, expect, it } from 'vitest';
import { checkReferences, findReferences, findUnsupportedReferences } from '../src/references.js';

const MATERIALS = 'Our fund follows the World Bank report on informal trade. See Okafor and Bello, 2019.';

describe('findReferences', () => {
  it('reads author-year citations in their common forms', () => {
    const r = findReferences('Shown by (Okafor & Bello, 2019), by Adeyemi et al. (2021) and by Coase (1960).');
    expect(r.map((x) => x.source)).toEqual(['Okafor & Bello, 2019', 'Adeyemi et al., 2021', 'Coase, 1960']);
    expect(r.every((x) => x.kind === 'author-year')).toBe(true);
  });
  it('reads numbered references, "according to" and unnamed appeals', () => {
    const kinds = findReferences('Trade grew [1, 2]. According to the UNESCO report, girls lag. Studies show this. Experts agree.').map((x) => x.kind);
    expect(kinds).toEqual(['numbered', 'according-to', 'appeal', 'appeal']);
  });
});

describe('checkReferences', () => {
  it('flags a source the materials never mention and allows one they do', () => {
    const t = 'According to the World Bank report, trade is informal. As the Smith and Jones (2020) study shows, women lead it.';
    expect(findUnsupportedReferences(t, MATERIALS)).toEqual(['Smith and Jones, 2020']);
  });
  it('flags an unnamed appeal to research', () => {
    const r = checkReferences('Research shows this works.', MATERIALS);
    expect(r.ok).toBe(false);
    expect(r.verdicts[0]).toMatchObject({ kind: 'appeal', supported: false, bucket: 'failed' });
  });
  it('is quiet on a draft with no outside sources', () => {
    expect(checkReferences('We built a payments app for 300 merchants.', MATERIALS).verdicts).toEqual([]);
  });
  it('can be limited to sentences about the reader', () => {
    expect(findUnsupportedReferences('Research shows interviews vary. Your last role, as Adeyemi (2021) notes, was senior.', MATERIALS, { about: 'you' })).toEqual(['Adeyemi, 2021']);
  });
});
