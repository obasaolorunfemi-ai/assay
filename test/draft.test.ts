import { describe, expect, it } from 'vitest';
import { checkDraft } from '../src/draft.js';

const CV = 'Ada Example. Managed a team of 5 at Oneremit Payments. Served 300 merchants in Lagos. Python.';

describe('checkDraft', () => {
  it('passes a draft the materials back', () => {
    const r = checkDraft('Ada Example managed a team of 5 at Oneremit Payments and served 300 merchants.', CV);
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
  });
  it('holds a draft to all four: a figure, a name, a reference, a claim', () => {
    const r = checkDraft('I led a large team of 50 at Acme Capital, as the UNESCO report (Okafor, 2019) shows.', CV);
    const kinds = new Set(r.findings.map((f) => f.kind));
    expect(kinds).toEqual(new Set(['figure', 'name', 'reference', 'claim']));
    expect(r.findings.map((f) => f.text)).toEqual(expect.arrayContaining(['50', 'Acme Capital', 'Okafor, 2019', 'large']));
    expect(r.summary.level).toBe('bad');
    // The citation is reported once, as a reference, not again as a name and a year.
    expect(r.findings.map((f) => f.text)).not.toContain('2019');
    expect(r.findings.map((f) => f.text)).not.toContain('Okafor');
  });
  it('lets one check be turned off and another given options', () => {
    expect(checkDraft('A large team.', CV, { claims: false }).ok).toBe(true);
    expect(checkDraft('Used kubernetes.', CV, { claims: { tools: false } }).ok).toBe(true);
  });
  it('can be limited to what is said about the reader, for general advice', () => {
    const advice = 'Many firms hold large panel interviews. At your last role, Acme Capital, you managed 40 people.';
    const r = checkDraft(advice, CV, { about: 'you' });
    expect(r.findings.map((f) => f.text).sort()).toEqual(['40', 'Acme Capital']);
  });
});
