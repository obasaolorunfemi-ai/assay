import { describe, expect, it } from 'vitest';
import { citationFailures, feedbackFrom, improve } from '../src/loop.js';

const checkFor = (bad: string) => async (t: string) => (t.includes(bad) ? { ok: false, failures: [`"${bad}" is not real`] } : { ok: true, failures: [] });

describe('loop', () => {
  it('returns at once, without asking the model, when the text already passes', async () => {
    let asked = 0;
    const r = await improve({ text: 'fine', check: checkFor('BAD'), regenerate: async () => { asked++; return 'x'; } });
    expect(r).toMatchObject({ ok: true, rewrites: 0, text: 'fine' });
    expect(asked).toBe(0);
  });
  it('asks again with what failed and checks the new version', async () => {
    const seen: string[] = [];
    const r = await improve({ text: 'has BAD', check: checkFor('BAD'), regenerate: async (fb) => { seen.push(fb); return 'now fine'; } });
    expect(r).toMatchObject({ ok: true, rewrites: 1, text: 'now fine' });
    expect(seen[0]).toContain('"BAD" is not real');
    expect(seen[0]).toContain('Do not invent');
    expect(r.history.map((h) => h.failures.length)).toEqual([1, 0]);
  });
  it('stops at the limit and says it did not succeed, with the last text it checked', async () => {
    let n = 0;
    const r = await improve({ text: 'BAD 0', check: checkFor('BAD'), maxRewrites: 2, regenerate: async () => `BAD ${++n}` });
    expect(r).toMatchObject({ ok: false, rewrites: 2, text: 'BAD 2' });
    expect(n).toBe(2);
  });
  it('stops when the model returns nothing, the same text, or throws', async () => {
    for (const regenerate of [async () => '  ', async (_f: string, t: string) => t, async () => { throw new Error('model down'); }]) {
      const r = await improve({ text: 'BAD', check: checkFor('BAD'), regenerate });
      expect(r).toMatchObject({ ok: false, text: 'BAD', rewrites: 0 });
    }
  });
  it('maxRewrites: 0 only checks', async () => {
    let asked = 0;
    const r = await improve({ text: 'BAD', check: checkFor('BAD'), maxRewrites: 0, regenerate: async () => { asked++; return 'x'; } });
    expect(r.ok).toBe(false);
    expect(asked).toBe(0);
  });
  it('writes feedback and reads the failures of a citation report', () => {
    expect(feedbackFrom(['a', 'b'])).toMatch(/1\. a\n2\. b/);
    const fails = citationFailures({ verdicts: [{ bucket: 'failed', message: 'No such work.', citation: { authors: 'Rose', year: '1985', title: 'X' } }, { bucket: 'ok', message: '', citation: { authors: 'Y', year: '2000', title: 'Z' } }] } as never);
    expect(fails).toEqual(['The citation "Rose, 1985, X" could not be verified: No such work.']);
  });
});
