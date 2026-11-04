import { describe, expect, it } from 'vitest';
import { createAssay } from '../src/index.js';
import { ownMaterials, ownWorks } from '../src/own.js';

const CV = `Ada Example
Selected publications
Okafor, A. & Bello, B. (2019). Mobile payments and informal merchants in Lagos. Journal of African Finance, 14(2), 55-71.
Example, A. (2021). Measuring free language models. Naija Eval Working Papers.
Ada Example, "Why free models fail quietly", 2026.
[Example, 2020, "A tiny library for reliable model calls" — Self-published]`;

describe('ownWorks', () => {
  it('reads a reference line, a quoted title and a bracketed citation', () => {
    const w = ownWorks(CV);
    expect(w.map((x) => x.title)).toEqual(expect.arrayContaining(['Mobile payments and informal merchants in Lagos', 'Measuring free language models', 'Why free models fail quietly', 'A tiny library for reliable model calls']));
    expect(w.find((x) => x.title.startsWith('Mobile'))).toMatchObject({ authors: ['Okafor', 'Bello'], year: 2019 });
  });
  it('finds nothing in text with no works in it', () => {
    expect(ownWorks('Built a payments app used by 300 merchants.')).toEqual([]);
  });
});

describe('ownMaterials as a citation source', () => {
  const noNetwork = (() => { throw new Error('a request was made'); }) as unknown as typeof fetch;

  it('confirms a citation the person\'s own materials list, with no request at all', async () => {
    const assay = createAssay({ sources: [ownMaterials(CV)], fetch: noNetwork, selfTest: false });
    const r = await assay.check('Shown by [Okafor & Bello, 2019, "Mobile payments and informal merchants in Lagos" — Journal of African Finance].');
    expect(r.ok).toBe(true);
    expect(r.verdicts[0]?.status).toBe('found');
  });

  it('does not confirm one that is not in them', async () => {
    const assay = createAssay({ sources: [ownMaterials(CV)], fetch: noNetwork, selfTest: false });
    const r = await assay.check('As [Smith & Jones, 2020, "Informal credit across West Africa" — Journal of Development].');
    expect(r.ok).toBe(false);
    expect(r.verdicts[0]?.status).toBe('notfound');
  });
});
