import { describe, expect, it } from 'vitest';
import { createTally } from '../src/tally.js';
import { checkQuotes } from '../src/quotes.js';
import { checkGrounding } from '../src/grounding.js';

describe('tally', () => {
  it('counts the buckets of real reports, per check and in total, and keeps nothing else', () => {
    const t = createTally();
    t.add('quotes', checkQuotes([{ quote: 'Relocation is available for all staff', source: 'Relocation support is available for senior staff only.' }, { quote: 'Relocation support is available for senior staff', source: 'Relocation support is available for senior staff only.' }]));
    t.add('grounding', checkGrounding('The rate moved to ₦425 [[c1]].', [{ ref: 1, text: 'The rate averaged ₦645.19.' }]));
    const s = t.snapshot();
    expect(s).toMatchObject({ checked: 3, ok: 1, failed: 2, check: 0, skipped: 0 });
    expect(s.byCheck.quotes).toEqual({ checked: 2, ok: 1, check: 0, failed: 1, skipped: 0 });
    expect(s.byCheck.grounding).toMatchObject({ failed: 1 });
    expect(JSON.stringify(s)).not.toMatch(/Relocation|₦/);
  });
  it('does not count skipped items as checked', () => {
    const t = createTally();
    t.add('citations', { verdicts: [{ bucket: 'skip' }, { bucket: 'check' }] });
    expect(t.snapshot()).toMatchObject({ checked: 1, check: 1, skipped: 1 });
  });
  it('merges counts kept elsewhere, ignoring junk, and resets', () => {
    const t = createTally();
    t.add('links', { verdicts: [{ bucket: 'failed' }] });
    t.merge({ checked: 4, ok: 3, check: 0, failed: 1, skipped: 0, byCheck: { links: { checked: 4, ok: 3, check: 0, failed: 1, skipped: 0 }, 'Bad Key!': { checked: 9, ok: 9, check: 0, failed: 0, skipped: 0 } } });
    expect(t.snapshot().failed).toBe(2);
    expect(t.snapshot().byCheck.links!.checked).toBe(5);
    expect(Object.keys(t.snapshot().byCheck)).toEqual(['links']);
    t.reset();
    expect(t.snapshot().checked).toBe(0);
  });
  it('refuses a name that is not a short lower-case word', () => {
    expect(() => createTally().add('Not A Name', { verdicts: [] })).toThrow(/lower-case/);
  });
});
