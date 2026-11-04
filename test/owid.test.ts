import { describe, expect, it } from 'vitest';
import type { Http, HttpInit, HttpResult } from '../src/http.js';
import { createValues, ourWorldInData, owidUnit } from '../src/values.js';

// Trimmed copies of what ourworldindata.org returned on 2026-11-04 (CSV per year, and the chart's metadata).
const csvLife = (yr: number, v: string) => `entity,code,year,life_expectancy_0\nNigeria,NGA,${yr},${v}\n`;
const LIFE: Record<number, string> = { 2021: '53.455', 2022: '54.079', 2023: '54.4623' };
const metaLife = { chart: { title: 'Life expectancy' }, columns: { life_expectancy_0: { titleShort: 'Life expectancy', unit: 'years', shortUnit: 'years', citationShort: 'Riley (2005); Zijdeman et al. (2015); HMD (2025); UN WPP (2024) – with major processing by Our World in Data' } } };
// A chart that ignores the country filter and answers for every country (as gdp-per-capita-worldbank did).
const csvAll = (yr: number) => `entity,code,year,ny_gdp_pcap_pp_kd,owid_region,ny_gdp_pcap_pp_kd__original_year\nAlbania,ALB,${yr},22724.293,Europe,\nNigeria,NGA,${yr},7843.004,Africa,\nUnited States,USA,${yr},74351.67,North America,\n`;
const metaGdp = { columns: { ny_gdp_pcap_pp_kd: { titleShort: 'GDP per capita', unit: 'international-$ in 2021 prices', shortUnit: '$', citationShort: 'Eurostat, OECD, IMF, and World Bank (2026) – with minor processing by Our World in Data' } } };
const metaPct = { columns: { it_net_user_zs: { titleShort: 'Internet users', unit: '% of population', shortUnit: '%', citationShort: 'ITU (2025)' } } };

const http = (route: (url: string) => { status?: number; body: unknown }) => {
  const reply = (url: string): HttpResult => { const r = route(url); const status = r.status ?? 200; return { ok: status < 300, status, body: r.body }; };
  const h: Http & { urls: string[] } = { urls: [], async json(u: string, _i?: HttpInit) { h.urls.push(u); return reply(u); }, async text(u: string, _i?: HttpInit) { h.urls.push(u); return reply(u); } };
  return h;
};
const lifeRoute = (u: string) => {
  if (u.includes('.metadata.json')) return { body: metaLife };
  const yr = Number(u.match(/time=(\d+)/)![1]);
  return { body: LIFE[yr] ? csvLife(yr, LIFE[yr]!) : 'entity,code,year,life_expectancy_0\n' };
};
// The whole checker, with only the network replaced: Response objects, as fetch would give them.
const fetchFor = (route: (url: string) => { status?: number; body: unknown }) => (async (u: string) => {
  const r = route(String(u));
  const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
  return new Response(body, { status: r.status ?? 200, headers: { 'content-type': typeof r.body === 'string' ? 'text/csv' : 'application/json' } });
}) as unknown as typeof fetch;
const checker = (route: (u: string) => { status?: number; body: unknown }) => createValues({ sources: [ourWorldInData], fetch: fetchFor(route), requestsPerSecond: 1000, selfTest: false } as never);

describe('Our World in Data as a value source', () => {
  it('fetches one year at a time (a range can return only its ends) and names where OWID got the numbers', async () => {
    const h = http(lifeRoute);
    const r = await ourWorldInData.fetch({ value: 54.1, unit: 'years', period: 2022, geo: 'NGA', subject: 'life expectancy' }, { http: h, mailto: '' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.series).toMatchObject({ indicatorId: 'life-expectancy', unit: 'years', points: [{ year: 2021, value: 53.455 }, { year: 2022, value: 54.079 }, { year: 2023, value: 54.4623 }] });
    expect(r.series.source).toBe('Our World in Data (Riley (2005); Zijdeman et al. (2015); HMD (2025); UN WPP (2024))');
    const csvUrls = h.urls.filter((u) => u.includes('.csv'));
    expect(csvUrls.map((u) => u.match(/time=(\d+)$/)![1])).toEqual(['2021', '2022', '2023']);
    expect(csvUrls[0]).toContain('country=NGA');
  });
  it('reconciles a claim against it end to end: right, wrong, and in a sentence', async () => {
    const v = checker(lifeRoute);
    const right = await v.check({ value: 54.1, unit: 'years', period: 2022, geo: 'NGA', subject: 'life expectancy' });
    expect(right).toMatchObject({ state: 'verified', bucket: 'ok' });
    expect(right.message).toContain('Our World in Data (Riley (2005)');
    const wrong = await v.check({ value: 70, unit: 'years', period: 2022, geo: 'NGA', subject: 'life expectancy' });
    expect(wrong).toMatchObject({ state: 'mismatch', bucket: 'failed' });
    const inText = await v.checkText('Life expectancy in Nigeria was 70 years in 2022.', { geo: 'NGA', indicator: 'life-expectancy' });
    expect(inText.ok).toBe(false);
    const missing = await v.check({ value: 50, unit: 'years', period: 2030, geo: 'NGA', indicator: 'life-expectancy' });
    expect(missing.state).not.toBe('verified');
  });
  it('does not trust the country filter: it reads the country from the data', async () => {
    const h = http((u) => (u.includes('.metadata.json') ? { body: metaGdp } : { body: csvAll(Number(u.match(/time=(\d+)/)![1])) }));
    const r = await ourWorldInData.fetch({ value: 7843, unit: 'international-$ in 2021 prices', period: 2023, geo: 'NGA', indicator: 'gdp-per-capita-worldbank' }, { http: h, mailto: '' });
    expect(r.ok && r.series.points.every((p) => Math.abs(p.value - 7843.004) < 1e-6)).toBe(true);
    expect(r.ok && r.series.points).toHaveLength(3);
  });
  it('turns OWID units into Assay units: a percentage is percent, a head-count has none, anything else is kept as written', () => {
    expect(owidUnit('% of population', '%')).toBe('percent');
    expect(owidUnit('deaths per 100 live births', '%')).toBe('percent');
    expect(owidUnit('people', '')).toBeNull();
    expect(owidUnit('years', 'years')).toBe('years');
    expect(owidUnit('international-$ in 2021 prices', '$')).toBe('international-$ in 2021 prices');
  });
  it('a percentage chart gives a percent series', async () => {
    const h = http((u) => (u.includes('.metadata.json') ? { body: metaPct } : { body: `entity,code,year,it_net_user_zs\nNigeria,NGA,${u.match(/time=(\d+)/)![1]},39.1472\n` }));
    const r = await ourWorldInData.fetch({ value: 39, unit: 'percent', period: 2022, geo: 'NGA', indicator: 'share-of-individuals-using-the-internet' }, { http: h, mailto: '' });
    expect(r.ok && r.series.unit).toBe('percent');
  });
  it('no data for the country is no-data; an unknown chart (404) or an unsafe name is no-match; an unknown subject is no-match', async () => {
    const empty = await ourWorldInData.fetch({ value: 1, unit: null, period: 2022, geo: 'NGA', indicator: 'life-expectancy' }, { http: http((u) => (u.includes('.metadata.json') ? { body: metaLife } : { body: 'entity,code,year,life_expectancy_0\n' })), mailto: '' });
    expect(empty).toMatchObject({ ok: false, kind: 'no-data' });
    const notFound = await ourWorldInData.fetch({ value: 1, unit: null, period: 2022, geo: 'NGA', indicator: 'no-such-chart' }, { http: http(() => ({ status: 404, body: null })), mailto: '' });
    expect(notFound).toMatchObject({ ok: false, kind: 'no-match' });
    for (const indicator of ['../../etc/passwd', 'UPPER', 'a b', 'x'.repeat(200)]) {
      const h = http(() => ({ body: '' }));
      expect(await ourWorldInData.fetch({ value: 1, unit: null, period: 2022, geo: 'NGA', indicator }, { http: h, mailto: '' })).toMatchObject({ ok: false, kind: 'no-match' });
      expect(h.urls).toHaveLength(0);
    }
    expect(await ourWorldInData.fetch({ value: 1, unit: null, period: 2022, geo: 'NGA', subject: 'rainfall' }, { http: http(() => ({ body: '' })), mailto: '' })).toMatchObject({ ok: false, kind: 'no-match' });
    expect(await ourWorldInData.fetch({ value: 1, unit: null, period: 2022, geo: 'Nigeria', indicator: 'life-expectancy' }, { http: http(() => ({ body: '' })), mailto: '' })).toMatchObject({ ok: false, kind: 'no-match' });
  });
  it('a changed or broken reply is an outage, never "no data": an error page, a renamed column, a missing metadata file, an Http that cannot read text', async () => {
    const claim = { value: 1, unit: null, period: 2022, geo: 'NGA', indicator: 'life-expectancy' } as const;
    for (const route of [
      (u: string) => (u.includes('.metadata.json') ? { body: metaLife } : { body: '<html><body>Error</body></html>' }),
      (u: string) => (u.includes('.metadata.json') ? { body: metaLife } : { body: 'country,iso,yr,v\nNigeria,NGA,2022,54' }),
      (u: string) => (u.includes('.metadata.json') ? { body: { nothing: true } } : { body: csvLife(2022, '54.079') }),
      (u: string) => (u.includes('.metadata.json') ? { status: 500, body: null } : { body: csvLife(2022, '54.079') }),
      (u: string) => (u.includes('.metadata.json') ? { body: metaLife } : { status: 429, body: '' }),
    ]) {
      const r = await ourWorldInData.fetch(claim, { http: http(route), mailto: '' });
      expect(r, JSON.stringify(r)).toMatchObject({ ok: false, kind: 'unavailable' });
    }
    const noText = { async json() { return { ok: true, status: 200, body: metaLife }; } } as Http;
    expect(await ourWorldInData.fetch(claim, { http: noText, mailto: '' })).toMatchObject({ ok: false, kind: 'unavailable' });
  });
  it('quoted names in the CSV are read correctly', async () => {
    const h = http((u) => (u.includes('.metadata.json') ? { body: metaLife } : { body: `entity,code,year,life_expectancy_0\n"Korea, South",KOR,2022,83.5\n"Cote d""Ivoire",CIV,2022,59\n` }));
    const r = await ourWorldInData.fetch({ value: 83.5, unit: 'years', period: 2022, geo: 'KOR', indicator: 'life-expectancy' }, { http: h, mailto: '' });
    expect(r.ok && r.series.points[0]).toMatchObject({ year: 2022, value: 83.5 });
  });
});
