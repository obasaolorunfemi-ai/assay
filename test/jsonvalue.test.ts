import { describe, expect, it } from 'vitest';
import type { Http, HttpInit, HttpResult } from '../src/http.js';
import { jsonValueSource, createValues, type JsonValueSourceSpec } from '../src/values.js';

// A made-up statistics office, only to show the shape: rows of { yr, val } by country and year.
const spec: JsonValueSourceSpec = {
  name: 'Example Statistics Office', url: 'https://stats.example.org/api/{indicator}?country={geo}&from={from}&to={to}', headers: { 'x-api-key': 'my-own-key' },
  results: 'data.rows', fields: { year: 'yr', value: 'val' }, unit: 'percent', indicators: [{ id: 'CPI', keywords: ['inflation', 'consumer prices'] }],
  canary: { claim: { value: 5, unit: 'percent', period: 2010, geo: 'NGA', indicator: 'CPI' }, expected: 5, tolerance: 0.05 },
};
const ok = (body: unknown, status = 200): HttpResult => ({ ok: status < 300, status, body });
const http = (route: (url: string, init?: HttpInit) => HttpResult) => { const h = { calls: [] as Array<{ url: string; init?: HttpInit }>, async json(url: string, init?: HttpInit) { h.calls.push({ url, ...(init ? { init } : {}) }); return route(url, init); } }; return h as Http & typeof h; };
const rows = { data: { rows: [{ yr: '2021', val: '16.9' }, { yr: '2022', val: '18.8' }, { yr: '2023', val: '24.5' }] } };

describe('jsonValueSource: a statistics source added with data', () => {
  it('fills the address, sends the header, and maps rows into a series', async () => {
    const h = http(() => ok(rows));
    const r = await jsonValueSource(spec).fetch({ value: 24.5, unit: 'percent', period: 2023, geo: 'NGA', subject: 'inflation' }, { http: h, mailto: '' });
    expect(h.calls[0]!.url).toBe('https://stats.example.org/api/CPI?country=NGA&from=2021&to=2024');
    expect(h.calls[0]!.init).toEqual({ headers: { 'x-api-key': 'my-own-key' } });
    expect(r).toMatchObject({ ok: true, series: { source: 'Example Statistics Office', indicatorId: 'CPI', unit: 'percent', points: [{ year: 2021, value: 16.9 }, { year: 2022, value: 18.8 }, { year: 2023, value: 24.5 }] } });
  });
  it('applies the magnitude ("in millions") so claims compare in full values', async () => {
    const r = await jsonValueSource({ ...spec, unit: 'NGN', magnitude: 1e6 }).fetch({ value: 1, unit: 'NGN', period: 2023, geo: 'NGA', indicator: 'CPI' }, { http: http(() => ok({ data: { rows: [{ yr: 2023, val: 3.5 }] } })), mailto: '' });
    expect(r.ok && r.series.points[0]!.value).toBe(3_500_000);
  });
  it('works through the whole checker: right figure verified, wrong one contradicted', async () => {
    const fetchOf = (async () => new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const v = createValues({ sources: [jsonValueSource(spec)], fetch: fetchOf, requestsPerSecond: 1000, selfTest: false } as never);
    expect(await v.check({ value: 24.5, unit: 'percent', period: 2023, geo: 'NGA', subject: 'inflation' })).toMatchObject({ state: 'verified' });
    expect((await v.check({ value: 12, unit: 'percent', period: 2023, geo: 'NGA', subject: 'inflation' })).state).toBe('mismatch');
  });
  it('a reply that is not an array of rows is an outage, never "no data"; an empty array is no data', async () => {
    for (const body of ['<html>', { data: {} }, { data: { rows: 'x' } }, null]) {
      expect(await jsonValueSource(spec).fetch({ value: 1, unit: 'percent', period: 2023, geo: 'NGA', indicator: 'CPI' }, { http: http(() => ok(body)), mailto: '' })).toMatchObject({ ok: false, kind: 'unavailable' });
    }
    expect(await jsonValueSource(spec).fetch({ value: 1, unit: 'percent', period: 2023, geo: 'NGA', indicator: 'CPI' }, { http: http(() => ok({ data: { rows: [] } })), mailto: '' })).toMatchObject({ ok: false, kind: 'no-data' });
  });
  it('an unknown indicator or a country that is not a three-letter code is no-match, with no request made', async () => {
    const h = http(() => ok(rows));
    expect(await jsonValueSource(spec).fetch({ value: 1, unit: null, period: 2023, geo: 'NGA', subject: 'rainfall' }, { http: h, mailto: '' })).toMatchObject({ kind: 'no-match' });
    expect(await jsonValueSource(spec).fetch({ value: 1, unit: null, period: 2023, geo: 'Nigeria; DROP', indicator: 'CPI' }, { http: h, mailto: '' })).toMatchObject({ kind: 'no-match' });
    expect(h.calls).toHaveLength(0);
  });
  it('refuses a description that could not be trusted: no canary, not https, a host filled from the claim, no indicators', () => {
    expect(() => jsonValueSource({ ...spec, canary: undefined as never })).toThrow(/canary/);
    expect(() => jsonValueSource({ ...spec, url: 'http://stats.example.org/{indicator}' })).toThrow(/https/);
    expect(() => jsonValueSource({ ...spec, url: 'https://{geo}.example.org/{indicator}' })).toThrow(/host/);
    expect(() => jsonValueSource({ ...spec, url: 'nonsense' })).toThrow(/address/);
    expect(() => jsonValueSource({ ...spec, indicators: [] })).toThrow(/indicators/);
    expect(() => jsonValueSource({ ...spec, name: ' ' })).toThrow(/name/);
  });
});
