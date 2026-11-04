import { describe, expect, it } from 'vitest';
import { parseCitations, splitAuthors } from '../src/index.js';

describe('splitAuthors', () => {
  it('keeps the surname when "et al." follows (a stray "." once made every et-al citation unreadable)', () => {
    expect(splitAuthors('Banerjee et al.')).toEqual(['Banerjee']);
    expect(splitAuthors('Banerjee et al')).toEqual(['Banerjee']);
    expect(splitAuthors('Banerjee, Duflo, et al.')).toEqual(['Banerjee', 'Duflo']);
    expect(splitAuthors('Karlan & Zinman')).toEqual(['Karlan', 'Zinman']);
  });
});

describe('parseCitations', () => {
  it('reads a titled citation with a link, with a search link, and with no link; skips other brackets', () => {
    const refs = parseCitations('A [Acemoglu & Robinson, 2012, "Why Nations Fail" — Crown Publishing] B [Logical inference — no citation required] C [see the section above] D [Rose, 1985, "Sick individuals and sick populations" — IJE — https://doi.org/10.1093/ije/14.1.32] E [Putnam, 2000, "Bowling Alone" — search: https://scholar.google.com/scholar?q=x]');
    expect(refs.map((r) => r.tier)).toEqual(['search', 'link', 'search']);
    expect(refs[0]).toMatchObject({ authors: 'Acemoglu & Robinson', year: '2012', title: 'Why Nations Fail', venue: 'Crown Publishing', url: '' });
    expect(refs[1]).toMatchObject({ authors: 'Rose', title: 'Sick individuals and sick populations', venue: 'IJE' });
  });

  it('returns identical tags once, and keeps the whole tag for strip()', () => {
    const t = '[Rose, 1985, "Sick individuals and sick populations" — IJE] and again [Rose, 1985, "Sick individuals and sick populations" — IJE]';
    const refs = parseCitations(t);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.tag).toBe('[Rose, 1985, "Sick individuals and sick populations" — IJE]');
  });

  it('labels an approximate tag by author and topic, not by its first year', () => {
    const [r] = parseCitations('[CITATION — approximate: Putnam, 1993-2002, social capital and civic engagement — search: https://scholar.google.com/scholar?q=x]');
    expect(r).toMatchObject({ tier: 'approximate', authors: 'Putnam, social capital and civic engagement', year: '1993' });
  });

  it('does not cut a title that contains a dash', () => {
    const [r] = parseCitations('[Smith, 2001, "Growth — and its discontents" — Journal of X]');
    expect(r!.title).toBe('Growth — and its discontents');
    expect(r!.venue).toBe('Journal of X');
  });
});
