import { describe, expect, it } from 'vitest';
import { createAssay, strip, summarize } from '../src/index.js';
import { cr, crItem, oa, router } from './helpers.js';

const TEXT = 'Aid weakens accountability [Rose, 1985, "Sick individuals and sick populations" — IJE]. Microcredit fails [Meyer, 2016, "The Impact of Microcredit: Evidence from Bosnia and Herzegovina" — WD] , as shown.';
const net = () => router({
  'api.crossref.org/works?query.bibliographic=Sick': cr(crItem('Sick individuals and sick populations', ['Rose'], '10.1093/ije/14.1.32')),
  'api.crossref.org/works?query': cr(), 'api.openalex.org': oa(),
});

describe('check()', () => {
  it('returns a verdict for each citation, a summary, and ok=false when any failed', async () => {
    const rep = await createAssay({ requestsPerSecond: 1e6, fetch: net().fetch }).check(TEXT);
    expect(rep.verdicts.map((v) => v.bucket)).toEqual(['ok', 'failed']);
    expect(rep.summary).toMatchObject({ total: 2, verified: 1, failed: 1, level: 'bad' });
    expect(rep.summary.text).toBe('Citations: 2 · ✓ 1 verified · ✕ 1 not verified — do not rely on them.');
    expect(rep.ok).toBe(false);
  });
  it('is ok with no citations at all', async () => {
    const rep = await createAssay({ requestsPerSecond: 1e6, fetch: net().fetch }).check('No sources here.');
    expect(rep.ok).toBe(true);
    expect(rep.summary.total).toBe(0);
  });
});

describe('summarize()', () => {
  it('counts the buckets and picks the level', () => {
    expect(summarize([{ bucket: 'ok' }, { bucket: 'ok' }])).toMatchObject({ level: 'good', text: 'Citations: 2 · ✓ 2 verified' });
    expect(summarize([{ bucket: 'ok' }, { bucket: 'check' }]).level).toBe('warn');
    expect(summarize([{ bucket: 'skip' }]).total).toBe(0);
  });
});

describe('strip()', () => {
  it('replaces a failed citation with a placeholder and leaves the rest of the text alone', async () => {
    const rep = await createAssay({ requestsPerSecond: 1e6, fetch: net().fetch }).check(TEXT);
    const out = strip(TEXT, rep);
    expect(out).toContain('[Rose, 1985, "Sick individuals and sick populations" — IJE]');
    expect(out).toContain('[citation removed: could not be verified]');
    expect(out).not.toContain('Bosnia');
  });
  it('can remove the tag and tidy the space, or mark it for a person', async () => {
    const rep = await createAssay({ requestsPerSecond: 1e6, fetch: net().fetch }).check(TEXT);
    expect(strip(TEXT, rep, { mode: 'remove' })).toBe('Aid weakens accountability [Rose, 1985, "Sick individuals and sick populations" — IJE]. Microcredit fails, as shown.');
    expect(strip(TEXT, rep, { mode: 'mark' })).toContain('[⚠ unverified: Meyer, 2016,');
  });
  it('acts only on the buckets asked for', async () => {
    const rep = await createAssay({ requestsPerSecond: 1e6, fetch: net().fetch }).check(TEXT);
    expect(strip(TEXT, rep, { buckets: ['check'] })).toBe(TEXT);
  });
});
