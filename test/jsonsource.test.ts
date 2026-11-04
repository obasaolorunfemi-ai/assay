import { describe, expect, it } from 'vitest';
import type { Http, HttpInit, HttpResult } from '../src/http.js';
import { jsonSource, type JsonSourceSpec } from '../src/sources.js';
import { createAssay } from '../src/index.js';

const spec: JsonSourceSpec = {
  name: 'Example Index', url: 'https://index.example.org/api/search?title={title}&author={surname}', headers: { 'x-api-key': 'key:example' },
  results: 'data.items', fields: { title: 'name', authors: 'writers', year: 'meta.year', doi: 'ids.doi', venue: 'meta.journal' }, authorName: 'full',
  canary: { title: 'The Problem of Social Cost', surname: 'Coase', authors: ['Coase'] },
};
const ok = (body: unknown): HttpResult => ({ ok: true, status: 200, body });
const http = (route: (url: string, init?: HttpInit) => HttpResult) => { const h = { calls: [] as Array<{ url: string; init?: HttpInit }>, async json(url: string, init?: HttpInit) { h.calls.push({ url, ...(init ? { init } : {}) }); return route(url, init); } }; return h as Http & typeof h; };
const reply = { data: { items: [{ name: 'The <i>Problem</i> of Social Cost', writers: [{ full: 'Ronald Coase' }], meta: { year: '1960', journal: 'JLE' }, ids: { doi: 'https://doi.org/10.1086/466560' } }] } };

describe('jsonSource: a source added with data, not code', () => {
  it('fills the address, sends the key header from the options, and maps the reply', async () => {
    const h = http(() => ok(reply));
    const r = await jsonSource(spec).search({ title: 'Social Cost & more', surname: 'Coase' }, h, { mailto: '', keys: { example: 'sekret' } });
    expect(h.calls[0]!.url).toBe('https://index.example.org/api/search?title=Social%20Cost%20%26%20more&author=Coase');
    expect(h.calls[0]!.init).toEqual({ headers: { 'x-api-key': 'sekret' } });
    expect(r.candidates[0]).toEqual({ title: 'The Problem of Social Cost', authors: ['Ronald Coase'], year: 1960, doi: '10.1086/466560', article: false, venue: 'JLE' });
  });
  it('a reply that is not an array of records is an outage, never "no results"', async () => {
    for (const body of ['<html>', { data: {} }, { data: { items: 'x' } }, null]) {
      expect((await jsonSource(spec).search({ title: 't', surname: 's' }, http(() => ok(body)), { mailto: '', keys: {} })).ok).toBe(false);
    }
    expect(await jsonSource(spec).search({ title: 't', surname: 's' }, http(() => ok({ data: { items: [] } })), { mailto: '', keys: {} })).toEqual({ ok: true, candidates: [] });
  });
  it('refuses a description that could not be trusted: no canary, not https, a host filled from the search words', () => {
    expect(() => jsonSource({ ...spec, canary: undefined as never })).toThrow(/canary/);
    expect(() => jsonSource({ ...spec, url: 'http://index.example.org/?q={title}' })).toThrow(/https/);
    expect(() => jsonSource({ ...spec, url: 'https://{surname}.example.org/?q={title}' })).toThrow(/host/);
    expect(() => jsonSource({ ...spec, url: 'not a url' })).toThrow(/address/);
    expect(() => jsonSource({ ...spec, name: ' ' })).toThrow(/name/);
    expect(() => jsonSource({ ...spec, results: '' })).toThrow(/results/);
  });
  it('plugs into createAssay like a built-in, and its self-test stops it accusing when it is broken', async () => {
    const fetchOf = (body: unknown) => (async () => ({ ok: true, status: 200, json: async () => body, headers: new Headers() }) as unknown as Response) as unknown as typeof fetch;
    const tag = '[Coase, 1960, "The Problem of Social Cost"]';
    const good = await createAssay({ sources: [jsonSource(spec)], fetch: fetchOf(reply), requestsPerSecond: 1000 }).check(tag);
    expect(good.verdicts[0]!.status).toBe('found');
    // The source now answers fine-looking but empty results for everything, including its own canary: that is a broken source, not a missing paper.
    const broken = await createAssay({ sources: [jsonSource(spec)], fetch: fetchOf({ data: { items: [] } }), requestsPerSecond: 1000 }).check(tag);
    expect(broken.verdicts[0]!.status).toBe('unavailable');
    expect(broken.ok).toBe(true);
  });
});
