/* Values: does the number a claim states match what its source says, for the period it names?
   A citation can be real and its link live, and the claim still state the wrong year's figure. This asks the source's own data.
   Checked against a SOURCE'S DATA (World Bank, IMF, or a table you seed with figures a person has verified), so it uses the network
   for the first two. It is strict by design: the unit must match, the exact period must exist (a close number for a different year
   never counts), and a model's opinion can flag a mismatch but can never produce "verified". */
import type { Bucket, KeyValueStore, Summary } from './types.js';
import { makeHttp, type Http } from './http.js';
import { createHealthBook, type BreakerOptions, type SourceHealth } from './health.js';
import { extractFigures, extractYears } from './numbers.js';
import { summarizeBuckets } from './summary.js';

/** 'percent', a currency code ('USD', 'NGN'), or null for a bare count such as a population. */
export type Unit = string | null;

export interface ValueClaim {
  /** The number as a full value (19500000000, not 19.5), or the percent figure (62.2 for 62.2%). */
  value: number;
  unit: Unit;
  /** The year it is attributed to. */
  period: number | string;
  /** ISO 3166 alpha-3 country code ('NGA'). */
  geo: string;
  /** What it is about, in words ("remittances", "inflation"): used to pick the indicator when `indicator` is not given. */
  subject?: string;
  /** The source's own indicator id, when you know it. */
  indicator?: string;
}

export interface Series {
  source: string;
  indicatorId: string;
  indicatorName?: string;
  /** The unit the source reports in, as a full value. */
  unit: Unit;
  points: Array<{ year: number; value: number }>;
  /** Where a person can read it. */
  url?: string;
}

export type SourceAnswer =
  | { ok: true; series: Series }
  /** 'no-match': this source does not cover the subject. 'no-data': it does, but has nothing for this country or period. 'unavailable': could not be asked or sent something unexpected. */
  | { ok: false; kind: 'no-match' | 'no-data' | 'unavailable'; problem?: string; retryAfterMs?: number };

export interface ValueSourceContext { http: Http; mailto: string }
export interface ValueCanary { claim: ValueClaim; /** What the source should report. */ expected: number; /** Relative tolerance. */ tolerance: number }
export interface ValueSource {
  name: string;
  /** A known figure that does not change (a past year's population). Before the source's "mismatch" is believed, it is asked for this. */
  canary?: ValueCanary;
  fetch(claim: ValueClaim, ctx: ValueSourceContext): Promise<SourceAnswer>;
}

// ── Reconciling a claim with a series (pure) ──────────────────────────────────────────────────────────────────────────

export interface Tolerance {
  /** A percent claim this close in percentage points counts as exact. Default 0.1. */
  percentPoints?: number;
  /** A claim this close (as a share of the source's value) counts as exact. Default 0.005. */
  exact?: number;
  /** A claim this close counts as matching, "within tolerance". Default 0.05. */
  within?: number;
}

export type ValueState = 'verified' | 'mismatch' | 'unit-mismatch' | 'period-unmatched' | 'no-data' | 'no-source' | 'unavailable' | 'cross-check-mismatch' | 'plausible' | 'not-checkable';

export interface ValueVerdict {
  claim: ValueClaim;
  state: ValueState;
  bucket: Bucket;
  message: string;
  /** What the source says for that period. */
  expected?: number;
  /** The year compared, or for `period-unmatched` the nearest year the source has. */
  year?: number;
  /** How far off, as a share of the source's value (percent claims: in percentage points). */
  delta?: number;
  source?: string;
  indicator?: string;
  /** Where a person can check. */
  url?: string;
  /** True when asking again later may settle it. */
  retryable: boolean;
  stale?: boolean;
}

const BUCKET: Record<ValueState, Bucket> = {
  verified: 'ok', mismatch: 'failed', 'unit-mismatch': 'failed', 'cross-check-mismatch': 'failed',
  'period-unmatched': 'check', 'no-data': 'check', 'no-source': 'check', unavailable: 'check', plausible: 'check', 'not-checkable': 'skip',
};
const make = (claim: ValueClaim, state: ValueState, message: string, extra: Partial<ValueVerdict> = {}): ValueVerdict =>
  ({ claim, state, bucket: BUCKET[state], message, retryable: state === 'unavailable', ...extra });

const fmt = (n: number, unit: Unit) => (unit === 'percent' ? `${n}%` : n.toLocaleString('en-US', { maximumFractionDigits: 2 }));

/** Compares a claim with a source's series. Pure: no network. */
export function reconcile(claim: ValueClaim, series: Series, tol: Tolerance = {}): ValueVerdict {
  const base = { source: series.source, indicator: series.indicatorId, ...(series.url ? { url: series.url } : {}) };
  // A different unit is not a different number, it is a different measurement: a GBP claim against a USD series, a count against a percentage.
  if (claim.unit !== series.unit) {
    return make(claim, 'unit-mismatch', `The claim's unit (${claim.unit ?? 'a bare number'}) is not the source's (${series.unit ?? 'a bare number'}): they measure different things.`, base);
  }
  const year = Number(claim.period);
  const at = series.points.find((p) => p.year === year);
  if (!at) {
    // Period discipline: another year's figure proves nothing about this year's, however close the numbers happen to be.
    const nearest = series.points.length ? series.points.reduce((a, b) => (Math.abs(b.year - year) < Math.abs(a.year - year) ? b : a)) : null;
    return make(claim, 'period-unmatched', nearest ? `The source has no figure for ${year}; the nearest year it has is ${nearest.year}. Nothing was compared.` : `The source has no figures for ${year}.`, { ...base, ...(nearest ? { year: nearest.year } : {}) });
  }
  const exactRel = tol.exact ?? 0.005, withinRel = tol.within ?? 0.05, pp = tol.percentPoints ?? 0.1;
  const actual = at.value;
  let verdict: 'exact' | 'within' | 'mismatch', delta: number;
  if (series.unit === 'percent') {
    delta = Math.abs(claim.value - actual);
    verdict = delta <= pp ? 'exact' : delta / Math.max(Math.abs(actual), 1) <= withinRel ? 'within' : 'mismatch';
  } else {
    delta = Math.abs(claim.value - actual) / Math.max(Math.abs(actual), 1);
    verdict = delta <= exactRel ? 'exact' : delta <= withinRel ? 'within' : 'mismatch';
  }
  const common = { ...base, expected: actual, year, delta };
  return verdict === 'mismatch'
    ? make(claim, 'mismatch', `The claim says ${fmt(claim.value, claim.unit)}; ${series.source} says ${fmt(actual, series.unit)} for ${year}. That is outside tolerance.`, common)
    : make(claim, 'verified', `Matches ${series.source} (${series.indicatorId}) for ${year}: ${fmt(actual, series.unit)} (${verdict === 'exact' ? 'exact' : 'within tolerance'}).`, common);
}

// ── Sources ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Indicator { id: string; keywords: string[]; unit: Unit; /** Multiply the source's number by this to get a full value. */ magnitude?: number; name?: string }

/** The indicator whose keywords match the subject most. Plain substring scoring: right for a short curated list, not a general matcher. */
export function matchIndicator(list: Indicator[], subject: string | undefined): Indicator | null {
  const lower = (subject ?? '').toLowerCase();
  let best: Indicator | null = null, score = 0;
  for (const ind of list) { const s = ind.keywords.filter((k) => lower.includes(k)).length; if (s > score) { score = s; best = ind; } }
  return best;
}

export const WORLD_BANK_INDICATORS: Indicator[] = [
  { id: 'BX.TRF.PWKR.CD.DT', keywords: ['remittance', 'remittances'], unit: 'USD' },
  { id: 'NY.GDP.MKTP.KD.ZG', keywords: ['gdp growth', 'economic growth', 'growth rate'], unit: 'percent' },
  { id: 'NY.GDP.MKTP.CD', keywords: ['gdp', 'gross domestic product'], unit: 'USD' },
  { id: 'FP.CPI.TOTL.ZG', keywords: ['inflation', 'cpi', 'consumer price'], unit: 'percent' },
  { id: 'SL.UEM.TOTL.ZS', keywords: ['unemployment', 'jobless'], unit: 'percent' },
  { id: 'SP.POP.TOTL', keywords: ['population'], unit: null },
  { id: 'NE.EXP.GNFS.CD', keywords: ['export'], unit: 'USD' },
  { id: 'NE.IMP.GNFS.CD', keywords: ['import'], unit: 'USD' },
  { id: 'BX.KLT.DINV.CD.WD', keywords: ['fdi', 'foreign direct investment'], unit: 'USD' },
  { id: 'FI.RES.TOTL.CD', keywords: ['reserves', 'foreign reserves', 'fx reserves'], unit: 'USD' },
  { id: 'PA.NUS.FCRF', keywords: ['exchange rate', 'fx rate'], unit: 'NGN' },
  { id: 'SI.POV.NAHC', keywords: ['poverty'], unit: 'percent' },
];

const failure = (r: { ok: boolean; status: number; networkError?: boolean; retryAfterMs?: number }, why?: string): SourceAnswer => ({
  ok: false, kind: 'unavailable', problem: why ?? (r.networkError ? 'unreachable' : r.status === 429 ? 'rate limited (429)' : r.ok ? 'answered with something unexpected' : `HTTP ${r.status}`),
  ...(r.retryAfterMs !== undefined ? { retryAfterMs: r.retryAfterMs } : {}),
});

/** World Bank Indicators API (free, no key). Asks for a window of years around the claim's, not "the latest": a claim about 2023 needs 2023's own value. */
export const worldBank: ValueSource = {
  name: 'World Bank',
  canary: { claim: { value: 309_000_000, unit: null, period: 2010, geo: 'USA', indicator: 'SP.POP.TOTL' }, expected: 309_000_000, tolerance: 0.03 },
  async fetch(claim, { http }) {
    const ind = claim.indicator ? (WORLD_BANK_INDICATORS.find((i) => i.id === claim.indicator) ?? { id: claim.indicator, keywords: [], unit: claim.unit }) : matchIndicator(WORLD_BANK_INDICATORS, claim.subject);
    if (!ind) return { ok: false, kind: 'no-match' };
    const y = Number(claim.period) || new Date().getFullYear();
    const url = `https://api.worldbank.org/v2/country/${encodeURIComponent(claim.geo)}/indicator/${encodeURIComponent(ind.id)}?format=json&date=${y - 2}:${y + 1}&per_page=20`;
    const r = await http.json(url);
    const body = r.body as unknown;
    // The API answers [meta, rows]. An error comes back as [{ message: [...] }], with no rows entry: that is NOT "no data".
    const okShape = Array.isArray(body) && body.length >= 2 && body[0] && typeof body[0] === 'object' && !(body[0] as any).message && (Array.isArray(body[1]) || body[1] === null);
    if (!r.ok || !okShape) return failure(r);
    const rows = ((body as unknown[])[1] as any[] | null) ?? [];
    const points = rows.filter((x) => x && x.value !== null && x.value !== undefined && Number.isFinite(Number(x.value))).map((x) => ({ year: parseInt(String(x.date), 10), value: Number(x.value) })).filter((p) => Number.isFinite(p.year));
    if (!points.length) return { ok: false, kind: 'no-data', problem: 'no figures for that country and period' };
    return { ok: true, series: { source: 'World Bank', indicatorId: ind.id, indicatorName: rows[0]?.indicator?.value, unit: ind.unit, points, url: `https://data.worldbank.org/indicator/${ind.id}?locations=${claim.geo}` } };
  },
};

export const IMF_INDICATORS: Indicator[] = [
  { id: 'NGDP_RPCH', keywords: ['gdp growth', 'economic growth', 'growth rate', 'economy grew', 'grew'], unit: 'percent', magnitude: 1 },
  { id: 'NGDPD', keywords: ['gdp', 'gross domestic product'], unit: 'USD', magnitude: 1e9 },
  { id: 'PCPIPCH', keywords: ['inflation', 'cpi', 'consumer price'], unit: 'percent', magnitude: 1 },
  { id: 'LUR', keywords: ['unemployment', 'jobless'], unit: 'percent', magnitude: 1 },
  { id: 'LP', keywords: ['population'], unit: null, magnitude: 1e6 },
  { id: 'BCA', keywords: ['current account'], unit: 'USD', magnitude: 1e9 },
  { id: 'GGXWDG_NGDP', keywords: ['government debt', 'public debt', 'gross debt'], unit: 'percent', magnitude: 1 },
];

/** IMF DataMapper (free, no key; World Economic Outlook aggregates only). Asking for one country returns every country, so the country is read out of the answer, not trusted to the URL. The API reports in billions or millions; this converts to full values. */
export const imf: ValueSource = {
  name: 'IMF',
  canary: { claim: { value: 309_000_000, unit: null, period: 2010, geo: 'USA', indicator: 'LP' }, expected: 309_000_000, tolerance: 0.03 },
  async fetch(claim, { http }) {
    const ind = claim.indicator ? IMF_INDICATORS.find((i) => i.id === claim.indicator) : matchIndicator(IMF_INDICATORS, claim.subject);
    if (!ind) return { ok: false, kind: 'no-match' };
    const r = await http.json(`https://www.imf.org/external/datamapper/api/v1/${encodeURIComponent(ind.id)}`);
    const values = (r.body as any)?.values?.[ind.id];
    if (!r.ok || !values || typeof values !== 'object') return failure(r);
    const series = values[claim.geo];
    if (!series || typeof series !== 'object') return { ok: false, kind: 'no-data', problem: 'no series for that country' };
    const points = Object.entries(series as Record<string, unknown>).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)).map(([y, v]) => ({ year: parseInt(y, 10), value: (v as number) * (ind.magnitude ?? 1) }));
    if (!points.length) return { ok: false, kind: 'no-data', problem: 'no figures for that country' };
    return { ok: true, series: { source: 'IMF', indicatorId: ind.id, unit: ind.unit, points, url: `https://www.imf.org/external/datamapper/${ind.id}@WEO` } };
  },
};

export interface SeededEntry {
  geo: string; period: number | string; value: number; unit: Unit; keywords: string[];
  /** Who published it ("NBS", "CBN"), and where a person can read it. */
  source: string; sourceUrl: string;
  /** When a PERSON checked this against the primary source. */
  verifiedAt: string;
}
/**
 * A source made from a table you supply: figures a person read off the primary publication themselves (a central bank's report, a statistics office's
 * release) where no API exists. No network. Every figure in it will be reported as verified, so none should go in from memory or from a model.
 */
export function seededSource(entries: SeededEntry[], name = 'seeded figures'): ValueSource {
  return {
    name,
    async fetch(claim) {
      const subject = (claim.subject ?? '').toLowerCase();
      const mine = entries.filter((e) => e.geo === claim.geo && e.keywords.some((k) => subject.includes(k.toLowerCase())));
      if (!mine.length) return { ok: false, kind: 'no-match' };
      const points = mine.map((e) => ({ year: Number(e.period), value: e.value })).filter((p) => Number.isFinite(p.year));
      const first = mine[0]!;
      return { ok: true, series: { source: first.source, indicatorId: `${name}:${first.keywords[0]}`, unit: first.unit, points, url: first.sourceUrl } };
    },
  };
}

// ── Eurostat ───────────────────────────────────────────────────────────────

/** Eurostat names countries by two-letter code. The claim's `geo` is ISO alpha-3, as everywhere else in Assay. */
const EUROSTAT_GEO: Record<string, string> = { AUT: 'AT', BEL: 'BE', BGR: 'BG', HRV: 'HR', CYP: 'CY', CZE: 'CZ', DNK: 'DK', EST: 'EE', FIN: 'FI', FRA: 'FR', DEU: 'DE', GRC: 'EL', HUN: 'HU', IRL: 'IE', ITA: 'IT', LVA: 'LV', LTU: 'LT', LUX: 'LU', MLT: 'MT', NLD: 'NL', POL: 'PL', PRT: 'PT', ROU: 'RO', SVK: 'SK', SVN: 'SI', ESP: 'ES', SWE: 'SE', ISL: 'IS', NOR: 'NO', CHE: 'CH' };
interface EurostatIndicator extends Indicator { dataset: string; filters: Record<string, string> }
export const EUROSTAT_INDICATORS: EurostatIndicator[] = [
  { id: 'une_rt_a', dataset: 'une_rt_a', filters: { age: 'Y15-74', sex: 'T', unit: 'PC_ACT' }, keywords: ['unemployment', 'jobless'], unit: 'percent' },
  { id: 'prc_hicp_aind', dataset: 'prc_hicp_aind', filters: { coicop: 'CP00', unit: 'RCH_A_AVG' }, keywords: ['inflation', 'hicp', 'consumer price'], unit: 'percent' },
  { id: 'nama_10_gdp', dataset: 'nama_10_gdp', filters: { na_item: 'B1GQ', unit: 'CP_MEUR' }, keywords: ['gdp', 'gross domestic product'], unit: 'EUR', magnitude: 1e6 },
  { id: 'demo_pjan', dataset: 'demo_pjan', filters: { age: 'TOTAL', sex: 'T', unit: 'NR' }, keywords: ['population'], unit: null },
];

/** Eurostat (free, no key): European statistics for the EU, Iceland, Norway and Switzerland. Opt in with `sources: [...defaultValueSources, eurostat]`.
 *  It reads the JSON-stat reply and refuses anything that is not the shape it expects: a changed reply is `unavailable`, never "no data". */
export const eurostat: ValueSource = {
  name: 'Eurostat',
  canary: { claim: { value: 83_166_711, unit: null, period: 2020, geo: 'DEU', indicator: 'demo_pjan' }, expected: 83_166_711, tolerance: 0.001 },
  async fetch(claim, { http }) {
    const ind = claim.indicator ? EUROSTAT_INDICATORS.find((i) => i.id === claim.indicator) : (matchIndicator(EUROSTAT_INDICATORS, claim.subject) as EurostatIndicator | null);
    if (!ind) return { ok: false, kind: 'no-match' };
    const geo = EUROSTAT_GEO[claim.geo];
    if (!geo) return { ok: false, kind: 'no-match' };
    const y = Number(claim.period) || new Date().getFullYear();
    const q = new URLSearchParams({ format: 'JSON', lang: 'EN', geo, sinceTimePeriod: String(y - 2), untilTimePeriod: String(y + 1), ...ind.filters });
    const r = await http.json(`https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${ind.dataset}?${q}`);
    const body = r.body as any;
    if (body?.error) return { ok: false, kind: 'no-data', problem: 'Eurostat has no figures for that selection' };
    const time = body?.dimension?.time?.category?.index;
    const size: unknown = body?.size;
    const values = body?.value;
    // JSON-stat: every other dimension was pinned to one value, so a value's key is its position in the time axis. Anything else is not the shape we read.
    const okShape = r.ok && time && typeof time === 'object' && values && typeof values === 'object' && Array.isArray(size) && size.slice(0, -1).every((n) => n === 1) && size[size.length - 1] === Object.keys(time).length;
    if (!okShape) return failure(r);
    const points = Object.entries(time as Record<string, number>).map(([year, pos]) => ({ year: parseInt(year, 10), value: (values as Record<string, number>)[String(pos)] })).filter((p) => Number.isFinite(p.year) && typeof p.value === 'number' && Number.isFinite(p.value)).map((p) => ({ year: p.year, value: p.value * (ind.magnitude ?? 1) }));
    if (!points.length) return { ok: false, kind: 'no-data', problem: 'no figures for that country and period' };
    return { ok: true, series: { source: 'Eurostat', indicatorId: ind.id, indicatorName: body.label, unit: ind.unit, points, url: `https://ec.europa.eu/eurostat/databrowser/view/${ind.dataset}/default/table?lang=en` } };
  },
};

export const defaultValueSources: ValueSource[] = [worldBank, imf];

// ── The checker ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** An optional second opinion, for a claim no source covers. YOU supply it (a model call, say); Assay makes none. It can flag a mismatch. It can never make a claim "verified". */
export type CrossCheck = (claim: ValueClaim, context: { findings?: string }) => Promise<{ mismatch: boolean | null; note?: string; supersededBy?: string | null }>;

export interface ValuesOptions {
  mailto?: string;
  sources?: ValueSource[];
  tolerance?: Tolerance;
  crossCheck?: CrossCheck;
  cache?: KeyValueStore;
  cacheTtlMs?: number;
  staleTtlMs?: number;
  breaker?: BreakerOptions;
  /** Ask a source for its known figure before believing its "mismatch" (default true). */
  selfTest?: boolean;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
  requestsPerSecond?: number;
  concurrency?: number;
  now?: () => number;
}

export interface ValueReport { verdicts: ValueVerdict[]; summary: Summary; ok: boolean }

export interface Values {
  /** Checks one structured claim. */
  check(claim: ValueClaim, opts?: { findings?: string }): Promise<ValueVerdict>;
  /**
   * Checks the figures in a sentence against a source: for each year the sentence names that the source covers, does any figure in the sentence match?
   * Give the country, and either an indicator id or what it is about. `url` may be a World Bank indicator link, from which both are read.
   */
  checkText(text: string, about: { geo?: string; indicator?: string; subject?: string; url?: string }, opts?: { findings?: string }): Promise<ValueReport>;
  health(): Promise<SourceHealth[]>;
}

/** A World Bank indicator link, read into its country and indicator id (both the API and the data.worldbank.org forms). */
export function worldBankUrlInfo(url: string): { geo: string; indicator: string } | null {
  const u = String(url ?? '');
  let m = u.match(/worldbank\.org\/v2\/country\/([A-Za-z]{2,3})\/indicator\/([A-Za-z0-9._]+)/i);
  if (m) return { geo: m[1]!.toUpperCase(), indicator: m[2]! };
  m = u.match(/data\.worldbank\.org\/indicator\/([A-Za-z0-9._]+)\?locations=([A-Za-z]{2,3})/i);
  return m ? { geo: m[2]!.toUpperCase(), indicator: m[1]! } : null;
}

export function createValues(opts: ValuesOptions = {}): Values {
  const now = opts.now ?? Date.now;
  const http = makeHttp({ fetch: opts.fetch, timeoutMs: opts.timeoutMs, retryDelayMs: opts.retryDelayMs, requestsPerSecond: opts.requestsPerSecond, concurrency: opts.concurrency });
  const sources = opts.sources ?? defaultValueSources;
  const health = createHealthBook({ ...opts.breaker, now });
  const ctx: ValueSourceContext = { http, mailto: opts.mailto ?? '' };
  const cacheTtl = opts.cacheTtlMs ?? 86_400_000, staleTtl = opts.staleTtlMs ?? 7 * 86_400_000;
  const mem = new Map<string, { v: unknown; until: number }>();
  const cache: KeyValueStore = opts.cache ?? {
    async get(k) { const e = mem.get(k); if (!e || e.until < now()) { mem.delete(k); return undefined; } return e.v; },
    async set(k, v, o) { if (mem.size >= 2000) mem.delete(mem.keys().next().value as string); mem.set(k, { v, until: now() + (o?.ttlMs ?? staleTtl) }); },
  };
  const probes = new Map<string, Promise<boolean>>();
  const selfTestOn = opts.selfTest !== false;

  /** Is this source producing sensible numbers? Asked before a "mismatch" is believed. */
  async function sourceIsSound(src: ValueSource, force = false): Promise<boolean> {
    if (!src.canary || (!selfTestOn && !force)) return true;
    if (!force && health.selfTestFresh(src.name)) return true;
    if (!health.allow(src.name)) return false;   // being given time to recover: not probed
    let p = probes.get(src.name);
    if (!p) {
      const c = src.canary;
      p = (async () => {
        const a = await src.fetch(c.claim, ctx);
        if (!a.ok) { health.failure(src.name, a.problem ?? 'self-test could not run', a.retryAfterMs); return false; }
        const at = a.series.points.find((x) => x.year === Number(c.claim.period));
        const good = !!at && Math.abs(at.value - c.expected) / c.expected <= c.tolerance;
        if (good) health.selfTestPassed(src.name); else health.selfTestFailed(src.name);
        return good;
      })().finally(() => probes.delete(src.name));
      probes.set(src.name, p);
    }
    return p;
  }

  async function seriesFor(claim: ValueClaim): Promise<{ answer: SourceAnswer; src?: ValueSource; stale?: boolean }> {
    let sawNoData: SourceAnswer | null = null;
    const problems: string[] = [];
    for (const src of sources) {
      if (!health.allow(src.name)) { problems.push(`${src.name} is being given time to recover`); continue; }
      const key = `assay:values:v1:${src.name}|${claim.geo}|${claim.indicator ?? (claim.subject ?? '').toLowerCase().slice(0, 60)}|${claim.period}`;
      let entry: { series: Series; at: number } | undefined;
      try { const raw = (await cache.get(key)) as typeof entry; if (raw && typeof raw.at === 'number' && raw.series && Array.isArray(raw.series.points)) entry = raw; } catch { /* a miss */ }
      if (entry && now() - entry.at < cacheTtl) return { answer: { ok: true, series: entry.series }, src };
      const a = await src.fetch(claim, ctx);
      if (a.ok) { health.success(src.name); try { await cache.set(key, { series: a.series, at: now() }, { ttlMs: staleTtl }); } catch { /* ok */ } return { answer: a, src }; }
      if (a.kind === 'no-match') continue;
      if (a.kind === 'no-data') { health.success(src.name); sawNoData ??= a; continue; }
      health.failure(src.name, a.problem ?? 'did not answer', a.retryAfterMs);
      // An older real answer beats "could not tell".
      if (entry) return { answer: { ok: true, series: entry.series }, src, stale: true };
      problems.push(`${src.name}: ${a.problem ?? 'did not answer'}`);
    }
    if (problems.length) return { answer: { ok: false, kind: 'unavailable', problem: problems.join('; ') } };
    return { answer: sawNoData ?? { ok: false, kind: 'no-match' } };
  }

  const tolerance = opts.tolerance ?? {};

  const checkable = (claim: ValueClaim) => !!claim && Number.isFinite(claim.value) && !!claim.geo && Number.isFinite(Number(claim.period));

  /** Turns what the sources said into a verdict. */
  async function judge(claim: ValueClaim, got: { answer: SourceAnswer; src?: ValueSource; stale?: boolean }, o: { findings?: string }): Promise<ValueVerdict> {
    const { answer, src, stale } = got;
    if (answer.ok) {
      let v = reconcile(claim, answer.series, tolerance);
      // A "mismatch" is an accusation: before it stands, the source must have shown it gives sound numbers.
      if (v.state === 'mismatch' && src && !(await sourceIsSound(src))) {
        v = make(claim, 'unavailable', `${src.name} did not pass its self-test, so its figure is not trusted to contradict the claim. It can be checked again later.`, { source: src.name });
      }
      return stale ? { ...v, stale: true, message: `${v.message} (From an earlier check: the source could not be reached just now.)` } : v;
    }
    if (answer.kind === 'unavailable') return make(claim, 'unavailable', `No source could be reached just now (${answer.problem}). This says nothing about the claim; it can be checked again later.`);
    if (answer.kind === 'no-data') return make(claim, 'no-data', `${answer.problem ?? 'The source has no data'}: nothing could be compared.`);
    // No source covers it: an optional second opinion. It can contradict a claim; it can never confirm one.
    if (opts.crossCheck) {
      try {
        const r = await opts.crossCheck(claim, { findings: o.findings });
        if (r && r.mismatch === true) return make(claim, 'cross-check-mismatch', `No data source covers this, and the cross-check says the findings state a different figure${r.note ? `: ${r.note}` : ''}.`);
        if (r && r.mismatch === false) return make(claim, 'plausible', `No data source covers this. The cross-check found nothing against it${r.note ? ` (${r.note})` : ''}. That is not verification.`);
      } catch { /* a cross-check that fails changes nothing */ }
    }
    return make(claim, 'no-source', 'No data source covers this figure, so it could not be checked against one.');
  }

  async function check(claim: ValueClaim, o: { findings?: string } = {}): Promise<ValueVerdict> {
    if (!checkable(claim)) return make(claim, 'not-checkable', 'There is no country, period and value to check.');
    return judge(claim, await seriesFor(claim), o);
  }

  /** A four-digit number that is a year, not an amount: not preceded by a currency symbol. */
  function yearsIn(text: string): number[] {
    const out: number[] = [];
    for (const m of text.matchAll(/\b(?:19|20)\d{2}\b/g)) {
      const before = text.slice(Math.max(0, (m.index ?? 0) - 2), m.index ?? 0);
      if (/[₦$€£]\s?$/.test(before) || /^,\d{3}/.test(text.slice((m.index ?? 0) + 4, (m.index ?? 0) + 8))) continue;
      if (!out.includes(Number(m[0]))) out.push(Number(m[0]));
    }
    return out;
  }

  async function checkText(text: string, about: { geo?: string; indicator?: string; subject?: string; url?: string }, o: { findings?: string } = {}): Promise<ValueReport> {
    const fromUrl = about.url ? worldBankUrlInfo(about.url) : null;
    const geo = about.geo ?? fromUrl?.geo, indicator = about.indicator ?? fromUrl?.indicator;
    const years = yearsIn(text);
    const yearNumbers = new Set(years);
    // A bare four-digit number that is also a year in the text is the year, not a figure, unless a currency symbol sits in front of it ("a fee of ₦1955").
    const figs = extractFigures(text).filter((f) => !(f.kind === 'number' && Number.isInteger(f.value) && /^\d{4}$/.test(f.raw) && yearNumbers.has(f.value) && !/[₦$€£]\s?$/.test(text.slice(Math.max(0, f.index - 2), f.index))));
    if (!geo || !years.length || !figs.length) {
      return finish([make({ value: NaN, unit: null, period: '', geo: geo ?? '' }, 'not-checkable', 'The text needs a country, a year and a figure to be checked.')]);
    }
    const verdicts: ValueVerdict[] = [];
    for (const y of years) {
      const probe: ValueClaim = { value: figs[0]!.value, unit: null, period: y, geo, ...(indicator ? { indicator } : {}), ...(about.subject ? { subject: about.subject } : {}) };
      // The source is asked once for this year. Which figure in the sentence is "the claim" is not knowable from prose, so each is tried against it:
      // does ANY figure match? The SOURCE's own unit decides which figures are comparable (a percentage only to a percentage series).
      const got = await seriesFor(probe);
      let best: ValueVerdict | null = null;
      for (const f of figs) {
        const unit: Unit = got.answer.ok ? (f.kind === 'percent' ? 'percent' : got.answer.series.unit === 'percent' ? '__other__' : got.answer.series.unit) : (f.kind === 'percent' ? 'percent' : null);
        if (unit === '__other__') continue;                                        // a plain number cannot be compared with a percentage series
        if (got.answer.ok && f.kind === 'percent' && got.answer.series.unit !== 'percent') continue;   // nor a percentage with an amount
        const v = await judge({ ...probe, value: f.value, unit }, got, o);
        if (v.state === 'verified') { best = v; break; }
        if (!best || (best.state !== 'mismatch' && v.state === 'mismatch')) best = v;
      }
      verdicts.push(best ?? make(probe, 'unit-mismatch', 'No figure in the text is in the unit the source reports.'));
    }
    return finish(verdicts);
  }

  function finish(verdicts: ValueVerdict[]): ValueReport {
    const summary = summarizeBuckets(verdicts.map((v) => v.bucket), { label: 'Values', ok: 'match their source', check: 'to check', failed: 'contradicted', failedTail: ' — do not state the contradicted figures as they stand.' });
    return { verdicts, summary, ok: summary.failed === 0 };
  }

  async function healthReport(): Promise<SourceHealth[]> {
    for (const src of sources) await sourceIsSound(src, true);
    return health.snapshot(sources.map((s) => s.name));
  }

  return { check, checkText, health: healthReport };
}
