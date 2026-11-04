import { describe, expect, it } from 'vitest';
import { checkQuote, checkQuotes, verifyQuote } from '../src/quotes.js';

const jd = 'We love our team.\n\nVisa sponsorship is   available for\nthis role.  Apply now. We’re hiring.';

describe('verifyQuote (KeyStone\'s cases)', () => {
  it('accepts an exact sentence, ignoring whitespace and case', () => {
    expect(verifyQuote(jd, 'visa sponsorship is available for this role')).toBe(true);
  });
  it('tolerates curly vs straight apostrophes and trailing punctuation', () => {
    expect(verifyQuote(jd, "We're hiring.")).toBe(true);
    expect(verifyQuote(jd, '"Visa sponsorship is available for this role."')).toBe(true);
  });
  it('rejects a quote that is not in the source', () => {
    expect(verifyQuote(jd, 'Relocation assistance is available for all staff')).toBe(false);
  });
  it('rejects paraphrases that change the words', () => {
    expect(verifyQuote(jd, 'Sponsorship of visas is available for this role')).toBe(false);
  });
  it('rejects empty and very short quotes, which prove nothing', () => {
    expect(verifyQuote(jd, '')).toBe(false);
    expect(verifyQuote(jd, null)).toBe(false);
    expect(verifyQuote(jd, 'sponsorship')).toBe(false);
  });
});

describe('typography is forgiven, words are not', () => {
  it('folds dashes, curly double quotes, non-breaking spaces and fullwidth forms', () => {
    const src = 'The role is full-time — remote “where possible”. Salary is competitive.';
    expect(verifyQuote(src, 'the role is full–time - remote "where possible". salary is competitive')).toBe(true);
  });
  it('still rejects one changed word', () => {
    expect(verifyQuote(jd, 'Visa sponsorship is unavailable for this role')).toBe(false);
  });
});

describe('whole words', () => {
  it('does not match a quote that starts or ends in the middle of a word', () => {
    expect(verifyQuote(jd, 'ship is available for this role')).toBe(false);
    expect(verifyQuote(jd, 'Visa sponsorship is available for this ro')).toBe(false);
  });
  it('can be turned off', () => {
    expect(verifyQuote(jd, 'ship is available for this role', { wholeWords: false })).toBe(true);
  });
  it('finds a later occurrence when an earlier one is inside a longer word', () => {
    expect(verifyQuote('bigfoot is real. foot is real. ok', 'foot is real. ok', { minChars: 5 })).toBe(true);
  });
});

describe('checkQuote gives a reason', () => {
  it('says why in plain words', () => {
    expect(checkQuote(jd, null)).toMatchObject({ status: 'empty', bucket: 'failed' });
    expect(checkQuote(jd, 'sponsorship')).toMatchObject({ status: 'too-short', bucket: 'failed' });
    expect(checkQuote(jd, 'Relocation assistance is available for all staff')).toMatchObject({ status: 'missing', bucket: 'failed' });
    expect(checkQuote(jd, 'We love our team.')).toMatchObject({ status: 'found', bucket: 'ok' });
  });
  it('lets you set the shortest quote', () => {
    expect(checkQuote(jd, 'Apply now.', { minChars: 5 }).status).toBe('found');
    expect(checkQuote(jd, 'Apply now.').status).toBe('too-short');
  });
});

describe('checkQuotes', () => {
  it('checks each quote against its own source and summarises', () => {
    const rep = checkQuotes([
      { id: 'a', quote: 'Visa sponsorship is available for this role', source: jd },
      { id: 'b', quote: 'Relocation assistance is available for all staff', source: jd },
      { id: 'c', quote: 'Remote work is possible for this role', source: 'Remote work is possible for this role.' },
    ]);
    expect(rep.verdicts.map((v) => [v.id, v.status])).toEqual([['a', 'found'], ['b', 'missing'], ['c', 'found']]);
    expect(rep.summary).toMatchObject({ total: 3, verified: 2, failed: 1, level: 'bad' });
    expect(rep.summary.text).toBe('Quotes: 3 · ✓ 2 found · ✕ 1 not found — do not present them as evidence.');
    expect(rep.ok).toBe(false);
  });
  it('is ok when every quote is found, and when there are none', () => {
    expect(checkQuotes([{ quote: 'We love our team.', source: jd }]).ok).toBe(true);
    expect(checkQuotes([]).ok).toBe(true);
  });
});

describe('hostile input', () => {
  it('stays fast on a megabyte of source and a long quote', () => {
    const big = 'lorem ipsum dolor sit amet '.repeat(40_000);
    const t = Date.now();
    expect(verifyQuote(big, 'lorem ipsum dolor sit amet lorem ipsum dolor sit amet lorem ipsum dolor sit amez')).toBe(false);
    expect(verifyQuote('a'.repeat(1_000_000), 'a'.repeat(5000) + 'b')).toBe(false);
    expect(Date.now() - t).toBeLessThan(2000);
  });
  it('never throws on odd values', () => {
    expect(() => checkQuote(undefined as unknown as string, 'a quote that is long enough')).not.toThrow();
    expect(checkQuote(null as unknown as string, 'a quote that is long enough').status).toBe('missing');
  });
});
