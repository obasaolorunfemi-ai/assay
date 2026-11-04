import { describe, expect, it } from 'vitest';
import { createValues, imf, matchIndicator, reconcile, seededSource, worldBank, worldBankUrlInfo, WORLD_BANK_INDICATORS, type Series, type ValueClaim, type ValueSource } from '../src/values.js';
import { router, type Route } from './helpers.js';

const claim = (o: Partial<ValueClaim> = {}): ValueClaim => ({ value: 19.5e9, unit: 'USD', period: 2023, geo: 'NGA', subject: 'remittances', ...o });
const series = (o: Partial<Series> = {}): Series => ({ source: 'World Bank', indicatorId: 'BX.TRF.PWKR.CD.DT', unit: 'USD', points: [{ year: 2022, value: 21.9e9 }, { year: 2023, value: 19_549_549_365 }], ...o });
const MIN = 60_000;
const clock = (start = 1_700_000_000_000) => { let t = start; return { now: () => t, advance: (ms: number) => { t += ms; } }; };

// What the World Bank sends: [meta, rows]
const wb = (rows: Array<[string, number | null]>, id = 'BX.TRF.PWKR.CD.DT'): Route => ({ status: 200, body: [{ page: 1, pages: 1, per_page: 20, total: rows.length }, rows.map(([date, value]) => ({ indicator: { id, value: 'Personal remittances, received (current US$)' }, country: { id: 'NG', value: 'Nigeria' }, date, value }))] });
// A healthy network includes the World Bank's and IMF's known figures
const CANARIES: Record<string, Route> = {
  'api.worldbank.org/v2/country/USA/indicator/SP.POP.TOTL': wb([['2010', 309_327_143]], 'SP.POP.TOTL'),
  'www.imf.org/external/datamapper/api/v1/LP': { status: 200, body: { values: { LP: { USA: { '2010': 309.3 } } } } },
};
const net = (routes: Record<string, Route>) => router({ ...CANARIES, ...routes }, { canaries: false });
const fast = (n: { fetch: typeof fetch }, c = clock(), extra = {}) => ({ fetch: n.fetch, now: c.now, requestsPerSecond: 1e6, retryDelayMs: 0, ...extra });

describe('reconcile (Fieldstone\'s rules)', () => {
  it('verifies an exact figure and one within tolerance', () => {
    expect(reconcile(claim({ value: 19_549_549_365 }), series())).toMatchObject({ state: 'verified', bucket: 'ok' });
    expect(reconcile(claim({ value: 19.5e9 }), series()).message).toMatch(/exact/);          // 0.25% off
    const within = reconcile(claim({ value: 19.0e9 }), series());                            // 2.8% off
    expect(within).toMatchObject({ state: 'verified' });
    expect(within.message).toMatch(/within tolerance/);
  });
  it('flags a figure outside tolerance, naming both numbers', () => {
    const v = reconcile(claim({ value: 25e9 }), series());
    expect(v).toMatchObject({ state: 'mismatch', bucket: 'failed', expected: 19_549_549_365, year: 2023 });
    expect(v.message).toBe('The claim says 25,000,000,000; World Bank says 19,549,549,365 for 2023. That is outside tolerance.');
  });
  it('percent claims are compared in percentage points', () => {
    const s = series({ unit: 'percent', points: [{ year: 2023, value: 24.5 }] });
    expect(reconcile(claim({ value: 24.55, unit: 'percent' }), s).state).toBe('verified');
    expect(reconcile(claim({ value: 31, unit: 'percent' }), s).state).toBe('mismatch');
  });
  it('a different unit is not a number disagreement but a different measurement', () => {
    const v = reconcile(claim({ unit: 'percent', value: 19.5 }), series());
    expect(v).toMatchObject({ state: 'unit-mismatch', bucket: 'failed' });
    expect(reconcile(claim({ unit: 'GBP' }), series()).state).toBe('unit-mismatch');
    expect(reconcile(claim({ unit: null }), series()).state).toBe('unit-mismatch');
  });
  it('a close number for a DIFFERENT year never counts: period-unmatched is a downgrade, not a pass', () => {
    const v = reconcile(claim({ period: 2024, value: 19_549_549_365 }), series());   // the number equals 2023's
    expect(v).toMatchObject({ state: 'period-unmatched', bucket: 'check', year: 2023 });
    expect(v.message).toMatch(/no figure for 2024; the nearest year it has is 2023\. Nothing was compared/);
    expect(reconcile(claim(), series({ points: [] })).state).toBe('period-unmatched');
  });
  it('tolerance can be tightened or loosened', () => {
    expect(reconcile(claim({ value: 19.0e9 }), series(), { within: 0.01 }).state).toBe('mismatch');
    expect(reconcile(claim({ value: 17e9 }), series(), { within: 0.15 }).state).toBe('verified');
  });
});

describe('indicator matching and links', () => {
  it('picks the indicator with the most matching keywords', () => {
    expect(matchIndicator(WORLD_BANK_INDICATORS, 'Nigeria GDP growth')!.id).toBe('NY.GDP.MKTP.KD.ZG');
    expect(matchIndicator(WORLD_BANK_INDICATORS, 'remittances received')!.id).toBe('BX.TRF.PWKR.CD.DT');
    expect(matchIndicator(WORLD_BANK_INDICATORS, 'the price of yams')).toBeNull();
  });
  it('reads a World Bank link into a country and an indicator, in both forms', () => {
    expect(worldBankUrlInfo('https://api.worldbank.org/v2/country/NGA/indicator/BX.TRF.PWKR.CD.DT?format=json')).toEqual({ geo: 'NGA', indicator: 'BX.TRF.PWKR.CD.DT' });
    expect(worldBankUrlInfo('https://data.worldbank.org/indicator/SP.POP.TOTL?locations=ng')).toEqual({ geo: 'NG', indicator: 'SP.POP.TOTL' });
    expect(worldBankUrlInfo('https://example.org/x')).toBeNull();
  });
});

describe('check, against the World Bank', () => {
  it('verifies "$19.5B remittances in 2023" against the real figure (Fieldstone\'s confirmed example)', async () => {
    const n = net({ 'api.worldbank.org/v2/country/NGA/indicator/BX.TRF.PWKR.CD.DT': wb([['2022', 21.9e9], ['2023', 19_549_549_365]]) });
    const v = await createValues(fast(n)).check(claim());
    expect(v).toMatchObject({ state: 'verified', bucket: 'ok', source: 'World Bank', year: 2023 });
    expect(n.calls.find((u) => u.includes('BX.TRF'))).toContain('date=2021:2024');   // a window around the claimed year, not "the latest"
  });
  it('skips the years the source has no value for (null), and uses what is there', async () => {
    const n = net({ 'indicator/BX.TRF': wb([['2024', null], ['2023', 19_549_549_365]]) });
    expect((await createValues(fast(n)).check(claim())).state).toBe('verified');
  });
  it('says "no data" when the source covers the subject but has nothing for the country and period', async () => {
    const n = net({ 'indicator/BX.TRF': { status: 200, body: [{ page: 1, total: 0 }, null] } });
    expect(await createValues(fast(n)).check(claim())).toMatchObject({ state: 'no-data', bucket: 'check' });
  });
  it('says "no source" when nothing covers the subject, and never invents a verdict', async () => {
    const v = await createValues(fast(net({}))).check(claim({ subject: 'the price of yams' }));
    expect(v).toMatchObject({ state: 'no-source', bucket: 'check' });
  });
  it('is not checkable without a country, a period and a number', async () => {
    const v = createValues(fast(net({})));
    expect((await v.check(claim({ geo: '' }))).bucket).toBe('skip');
    expect((await v.check(claim({ value: NaN }))).state).toBe('not-checkable');
    expect((await v.check(claim({ period: 'last year' }))).state).toBe('not-checkable');
  });
});

describe('the IMF', () => {
  it('converts the API\'s billions to a full value and reads the country out of an all-countries answer', async () => {
    const n = net({ 'datamapper/api/v1/NGDPD': { status: 200, body: { values: { NGDPD: { NGA: { '2023': 363.8, '2024': 187.8 }, GHA: { '2023': 76.4 } } } } } });
    const v = await createValues(fast(n, clock(), { sources: [imf] })).check(claim({ value: 363.8e9, subject: 'gdp', period: 2023 }));
    expect(v).toMatchObject({ state: 'verified', source: 'IMF', expected: 363.8e9 });
  });
  it('a country the answer does not contain is "no data"', async () => {
    const n = net({ 'datamapper/api/v1/NGDPD': { status: 200, body: { values: { NGDPD: { GHA: { '2023': 76.4 } } } } } });
    expect((await createValues(fast(n, clock(), { sources: [imf] })).check(claim({ subject: 'gdp' }))).state).toBe('no-data');
  });
});

describe('seeded figures (a person\'s own verified numbers, where no API exists)', () => {
  const entries = [{ geo: 'NGA', period: 2023, value: 22.4, unit: 'percent' as const, keywords: ['inflation'], source: 'NBS', sourceUrl: 'https://nigerianstat.gov.ng/x', verifiedAt: '2026-10-01' }];
  it('verifies against the seeded figure, with no network', async () => {
    const n = net({});
    const v = await createValues(fast(n, clock(), { sources: [seededSource(entries)] })).check(claim({ value: 22.4, unit: 'percent', subject: 'inflation' }));
    expect(v).toMatchObject({ state: 'verified', source: 'NBS', url: 'https://nigerianstat.gov.ng/x' });
    expect(n.calls).toEqual([]);
  });
  it('an empty table verifies nothing', async () => {
    const v = await createValues(fast(net({}), clock(), { sources: [seededSource([])] })).check(claim({ subject: 'inflation' }));
    expect(v.state).toBe('no-source');
  });
});

describe('self-healing', () => {
  it('an error body or a changed shape is "unavailable", never "no data" and never a mismatch', async () => {
    const err = net({ 'indicator/BX.TRF': { status: 200, body: [{ message: [{ id: '120', key: 'Invalid format', value: 'The indicator was not found.' }] }] } });
    const a = await createValues(fast(err, clock(), { sources: [worldBank] })).check(claim());
    expect(a).toMatchObject({ state: 'unavailable', retryable: true });
    const html = net({ 'indicator/BX.TRF': { status: 200, body: null } });
    expect((await createValues(fast(html, clock(), { sources: [worldBank] })).check(claim())).state).toBe('unavailable');
    const renamed = net({ 'indicator/BX.TRF': { status: 200, body: { data: [] } } });
    expect((await createValues(fast(renamed, clock(), { sources: [worldBank] })).check(claim())).state).toBe('unavailable');
  });

  it('a source that gives wrong numbers cannot contradict a claim: its mismatch is held back until it passes its self-test', async () => {
    // The World Bank "answers", but every figure is wrong, including its known one.
    const n = net({ 'api.worldbank.org/v2/country/USA/indicator/SP.POP.TOTL': wb([['2010', 5]], 'SP.POP.TOTL'), 'indicator/BX.TRF': wb([['2023', 1_000_000]]) });
    const v = createValues(fast(n, clock(), { sources: [worldBank] }));
    const r = await v.check(claim());
    expect(r).toMatchObject({ state: 'unavailable', bucket: 'check' });
    expect(r.message).toMatch(/did not pass its self-test/);
    expect((await v.health()).find((h) => h.name === 'World Bank')).toMatchObject({ state: 'degraded', selfTest: 'failed' });
    // the same wrong source, with the self-test off, WOULD accuse: this is what the test protects against
    expect((await createValues(fast(n, clock(), { sources: [worldBank], selfTest: false })).check(claim())).state).toBe('mismatch');
  });

  it('a healthy source\'s mismatch stands, and its self-test is shared and remembered', async () => {
    const n = net({ 'indicator/BX.TRF': wb([['2023', 19_549_549_365]]) });
    const v = createValues(fast(n, clock(), { sources: [worldBank] }));
    const rs = await Promise.all([1, 2, 3, 4, 5].map((i) => v.check(claim({ value: 30e9 + i }))));
    expect(rs.every((r) => r.state === 'mismatch')).toBe(true);
    expect(n.calls.filter((u) => u.includes('SP.POP.TOTL')).length).toBe(1);
  });

  it('leaves a throttled source alone and believes its Retry-After', async () => {
    const c = clock();
    const throttled = { ok: false, status: 429, headers: new Headers({ 'retry-after': '600' }), json: async () => ({}) } as Response;
    const base = net({});
    let hit = 0;
    const f = (async (url: string, init?: RequestInit) => { if (String(url).includes('indicator/BX.TRF')) { hit++; return throttled; } return base.fetch(url, init); }) as unknown as typeof fetch;
    const v = createValues({ fetch: f, now: c.now, requestsPerSecond: 1e6, retryDelayMs: 0, sources: [worldBank] });
    await v.check(claim()); await v.check(claim({ value: 1 })); await v.check(claim({ value: 2 }));
    expect(hit).toBe(1);
    expect((await v.health())[0]!.state).toBe('down');
    c.advance(10 * MIN + 1);
    await v.check(claim({ value: 3 }));
    expect(hit).toBe(2);
  });

  it('serves the earlier series, marked stale, when the source is down', async () => {
    const c = clock();
    let down = false;
    const base = net({ 'indicator/BX.TRF': wb([['2023', 19_549_549_365]]) });
    const f = (async (url: string, init?: RequestInit) => (down ? ({ ok: false, status: 503, json: async () => ({}) } as Response) : base.fetch(url, init))) as unknown as typeof fetch;
    const v = createValues({ fetch: f, now: c.now, requestsPerSecond: 1e6, retryDelayMs: 0, sources: [worldBank] });
    expect((await v.check(claim())).state).toBe('verified');
    c.advance(2 * 86_400_000); down = true;
    const r = await v.check(claim());
    expect(r).toMatchObject({ state: 'verified', stale: true });
    expect(r.message).toMatch(/From an earlier check/);
  });
});

describe('the cross-check hook (you supply it; a model can flag a mismatch but never verify)', () => {
  const none = (extra = {}) => ({ ...fast(net({})), sources: [] as ValueSource[], ...extra });
  it('a mismatch flagged by the hook is a failure, saying that no data source covered it', async () => {
    const v = await createValues(none({ crossCheck: async () => ({ mismatch: true, note: 'the report says 31%' }) })).check(claim());
    expect(v).toMatchObject({ state: 'cross-check-mismatch', bucket: 'failed' });
    expect(v.message).toMatch(/No data source covers this/);
  });
  it('"nothing against it" is only ever "plausible", never verified', async () => {
    const v = await createValues(none({ crossCheck: async () => ({ mismatch: false }) })).check(claim());
    expect(v).toMatchObject({ state: 'plausible', bucket: 'check' });
    expect(v.message).toMatch(/not verification/);
  });
  it('"cannot tell", or a hook that throws, changes nothing', async () => {
    expect((await createValues(none({ crossCheck: async () => ({ mismatch: null }) })).check(claim())).state).toBe('no-source');
    expect((await createValues(none({ crossCheck: async () => { throw new Error('model down'); } })).check(claim())).state).toBe('no-source');
  });
  it('is not consulted when a data source covers the claim', async () => {
    let asked = 0;
    const n = net({ 'indicator/BX.TRF': wb([['2023', 19_549_549_365]]) });
    await createValues(fast(n, clock(), { sources: [worldBank], crossCheck: async () => { asked++; return { mismatch: true }; } })).check(claim({ value: 30e9 }));
    expect(asked).toBe(0);
  });
});

describe('checkText (Content Engine\'s year-and-figure check)', () => {
  const about = { geo: 'NGA', indicator: 'BX.TRF.PWKR.CD.DT' };
  const n = () => net({ 'indicator/BX.TRF': wb([['2022', 21.9e9], ['2023', 19_549_549_365]]) });
  it('verifies a sentence whose figure matches the source for the year it names', async () => {
    const r = await createValues(fast(n(), clock(), { sources: [worldBank] })).checkText('Remittances reached $19.5 billion in 2023.', about);
    expect(r.verdicts.map((v) => v.state)).toEqual(['verified']);
    expect(r.ok).toBe(true);
  });
  it('flags a figure that is not the source\'s for that year, and reads a World Bank link for the country and indicator', async () => {
    const r = await createValues(fast(n(), clock(), { sources: [worldBank] })).checkText('Remittances reached $25 billion in 2023.', { url: 'https://api.worldbank.org/v2/country/NGA/indicator/BX.TRF.PWKR.CD.DT' });
    expect(r.verdicts[0]).toMatchObject({ state: 'mismatch', bucket: 'failed' });
    expect(r.summary.text).toBe('Values: 1 · ✕ 1 contradicted — do not state the contradicted figures as they stand.');
    expect(r.ok).toBe(false);
  });
  it('judges each year the sentence names', async () => {
    const r = await createValues(fast(n(), clock(), { sources: [worldBank] })).checkText('Remittances fell from $21.9 billion in 2022 to $19.5 billion in 2023.', about);
    expect(r.verdicts.map((v) => v.state)).toEqual(['verified', 'verified']);
  });
  it('does not mistake the year for a figure, but keeps a currency amount that looks like a year', async () => {
    const r = await createValues(fast(net({ 'indicator/PA.NUS': wb([['2023', 1955]], 'PA.NUS.FCRF') }), clock(), { sources: [worldBank] })).checkText('The fee was ₦1955 in 2023.', { geo: 'NGA', indicator: 'PA.NUS.FCRF' });
    expect(r.verdicts.map((v) => [v.claim.period, v.state])).toEqual([[2023, 'verified']]);   // ₦1955 is the figure, not a year 1955
  });
  it('needs a country, a year and a figure, and says so instead of guessing', async () => {
    const v = createValues(fast(net({})));
    expect((await v.checkText('Remittances are large.', about)).verdicts[0]!.state).toBe('not-checkable');
    expect((await v.checkText('Remittances reached $19.5 billion.', about)).verdicts[0]!.state).toBe('not-checkable');
    expect((await v.checkText('Remittances reached $19.5 billion in 2023.', { indicator: 'x' })).verdicts[0]!.state).toBe('not-checkable');
  });
});
