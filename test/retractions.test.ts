import { describe, expect, it } from 'vitest';
import { createRetractions, doisIn } from '../src/retractions.js';

// Shapes are Crossref's own: the first record is a trimmed copy of what api.crossref.org returned for a retracted paper on 2026-11-04.
const rec = (extra: Record<string, unknown>) => ({ message: { DOI: '10.1/x', title: ['A paper'], ...extra } });
const retracted = rec({ title: ['RETRACTED: Ileal-lymphoid-nodular hyperplasia'], 'updated-by': [
  { DOI: '10.1016/s0140-6736(04)15715-2', type: 'correction', label: 'Correction', source: 'retraction-watch', updated: { 'date-parts': [[2004, 3, 6]] } },
  { DOI: '10.1016/s0140-6736(10)60175-4', type: 'retraction', label: 'Retraction', source: 'retraction-watch', updated: { 'date-parts': [[2010, 2, 6]] } },
] });
const fetchOf = (table: Record<string, { status?: number; body: unknown }>) => (async (url: string) => {
  const key = Object.keys(table).find((k) => String(url).includes(encodeURIComponent(k))) ?? '';
  const t = table[key] ?? { status: 404, body: { message: 'Resource not found.' } };
  const status = t.status ?? 200;
  return { ok: status >= 200 && status < 300, status, json: async () => t.body, headers: new Headers() } as unknown as Response;
}) as unknown as typeof fetch;

describe('doisIn', () => {
  it('finds DOIs in prose and URLs, trims trailing punctuation, de-duplicates', () => {
    expect(doisIn('See https://doi.org/10.1145/3571730. Also (doi:10.1038/s41598-023-41032-5), and 10.1145/3571730 again; plus 10.1016/S0140-6736(97)11096-0.')).toEqual(['10.1145/3571730', '10.1038/s41598-023-41032-5', '10.1016/s0140-6736(97)11096-0']);
  });
  it('finds nothing in text without DOIs', () => { expect(doisIn('no identifiers 10.5 here')).toEqual([]); });
});

describe('retractions', () => {
  it('flags a retraction with its date and who recorded it', async () => {
    const r = await createRetractions({ fetch: fetchOf({ '10.1/r': { body: retracted } }) }).check(['10.1/r']);
    expect(r.ok).toBe(false);
    expect(r.verdicts[0]).toMatchObject({ status: 'retracted', bucket: 'failed', notice: { type: 'retraction', date: '2010-02-06', source: 'retraction-watch' } });
    expect(r.summary.text).toContain('retracted');
  });
  it('treats a RETRACTED title as a retraction even without a notice record', async () => {
    const r = await createRetractions({ fetch: fetchOf({ '10.1/t': { body: rec({ title: ['RETRACTED: something'] }) } }) }).check(['10.1/t']);
    expect(r.verdicts[0]!.status).toBe('retracted');
  });
  it('a correction alone is ok, an expression of concern is to check', async () => {
    const fix = rec({ 'updated-by': [{ type: 'correction', source: 'publisher', updated: { 'date-parts': [[2020]] } }] });
    const eoc = rec({ 'updated-by': [{ type: 'expression_of_concern', source: 'publisher', updated: { 'date-parts': [[2021, 5]] } }] });
    const r = await createRetractions({ fetch: fetchOf({ '10.1/c': { body: fix }, '10.1/e': { body: eoc } }) }).check(['10.1/c', '10.1/e']);
    expect(r.verdicts.map((v) => [v.status, v.bucket])).toEqual([['corrected', 'ok'], ['concern', 'check']]);
  });
  it('a record with no notices is clear, with the honest caveat', async () => {
    const r = await createRetractions({ fetch: fetchOf({ '10.1/ok': { body: rec({}) } }) }).check(['10.1/ok']);
    expect(r.verdicts[0]).toMatchObject({ status: 'clear', bucket: 'ok' });
    expect(r.verdicts[0]!.message).toContain('not proof');
  });
  it('a DOI Crossref does not hold is skipped, not cleared', async () => {
    const r = await createRetractions({ fetch: fetchOf({}) }).check(['10.9/none']);
    expect(r.verdicts[0]).toMatchObject({ status: 'not-in-crossref', bucket: 'skip' });
  });
  it('a throttled, broken or changed source is unavailable, never "clear"', async () => {
    for (const t of [{ status: 429, body: {} }, { status: 500, body: null }, { status: 200, body: '<html>oops</html>' }, { status: 200, body: { message: { renamed: true } } }]) {
      const r = await createRetractions({ fetch: fetchOf({ '10.1/u': t }) }).check(['10.1/u']);
      expect(r.verdicts[0]).toMatchObject({ status: 'unavailable', bucket: 'check', retryable: true });
      expect(r.ok).toBe(true);
    }
  });
  it('checks the DOIs it finds in a text, and caps how many', async () => {
    const f = fetchOf({ '10.1000/a': { body: rec({}) } });
    const r = await createRetractions({ fetch: f, maxDois: 2 }).check('10.1000/a 10.1000/b 10.1000/c');
    expect(r.verdicts).toHaveLength(2);
  });
});
