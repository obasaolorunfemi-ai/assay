/* The source gate: is this claim sourced well enough to be stated?
   Checks claims against a POLICY about their sources (who ranks above whom, which kinds of claim need stronger backing, how old
   breaking news must be): no network, no model, deterministic, safe on private text. It judges how a claim is SOURCED, not whether
   it is true. A claim can clear the gate and still be wrong; one that fails may still be right, just not yet backed well enough.
   The policy is data you pass in. Assay ships a small neutral default and two example rules; your own tier list stays in your app. */
import type { Bucket, Summary } from './types.js';
import { summarizeBuckets } from './summary.js';

/** 0 is your own first-party data, 1 an authority within its mandate, 2 a specialist, 3 the press, 4 an aggregator that is never cited. */
export type Tier = number;

export interface GateSource {
  url: string;
  /** What the claim's author (often a model) says the tier is. It can only LOWER a source that is not in the policy, never raise it. */
  tier?: number | null;
  /** When it was published (ISO date). */
  date?: string | null;
  publisher?: string;
  title?: string;
}
export interface GateClaim {
  text: string;
  /** What kind of claim this is, as your pipeline labels it ("loss-estimate", "event", "price"…). Rules can also read the text itself, so a wrong label does not dodge them. */
  category?: string;
  sources: GateSource[];
}

/** "At least N different sources at this tier or better." */
export interface Requirement { atLeast: number; tier: number }
export interface CorroborationRule {
  name: string;
  /** Claims labelled with one of these. */
  categories?: string[];
  /** Claims whose text matches one of these, whatever their label. */
  textPatterns?: RegExp[];
  /** The claim must meet AT LEAST ONE of these. */
  anyOf: Requirement[];
}

export interface Policy {
  /** Host (or parent domain) to tier. "reuters.com" covers "www.reuters.com" and "uk.reuters.com". */
  domains: Record<string, number>;
  /** For hosts not listed: the first pattern that matches gives the tier (for example any .gov is tier 1). */
  suffixes?: Array<{ test: RegExp; tier: number }>;
  /** Your own domains: always tier 0. */
  firstParty?: string[];
  /** Domains someone vouched for that are not in `domains`: placed at `unlistedTier`, never higher. */
  trusted?: string[];
  /** The ceiling for a domain the policy does not know. Default 3. Nobody can raise a source above it by saying so. */
  unlistedTier?: number;
  /** A claim whose sources are ALL at this tier or worse is dropped: such sources point you to the real source, they are not the source. Default 4. */
  neverCitedFrom?: number;
  rules?: CorroborationRule[];
  /** Hold a claim whose only backing is news newer than `withinMs`, unless some source is `unlessTier` or better. Default: 24 hours, tier 2. Null turns it off. */
  hold?: { withinMs: number; unlessTier: number } | null;
  /** At most this many sources are read per claim. Default 50. */
  maxSourcesPerClaim?: number;
}

export type GateOutcome = 'pass' | 'no-source' | 'low-tier-only' | 'needs-corroboration' | 'hold' | 'error';

export interface GateSourceVerdict extends GateSource {
  tier: number;
  /** True when the policy knows this domain. */
  listed: boolean;
  trusted: boolean;
  firstParty: boolean;
}
export interface GateVerdict {
  claim: GateClaim;
  outcome: GateOutcome;
  /** ok for pass; check for hold and error; failed for a claim that must be dropped. */
  bucket: Bucket;
  reason: string;
  /** The rule that was not met, when there was one. */
  rule?: string;
  bestTier?: number;
  sources: GateSourceVerdict[];
}
export interface GateReport {
  verdicts: GateVerdict[];
  passed: GateVerdict[];
  /** Must not be stated as it stands. */
  dropped: GateVerdict[];
  /** Not yet: wait, or corroborate. */
  held: GateVerdict[];
  /** Domains the policy did not know, for you to review and add. */
  unlistedDomains: string[];
  summary: Summary;
  ok: boolean;
}

// ── A neutral starting policy and two worked rules ────────────────────────────────────────────────────────────────────────

const T1 = ['imf.org', 'worldbank.org', 'un.org', 'oecd.org', 'wto.org', 'bis.org', 'europa.eu', 'fao.org', 'unctad.org', 'iea.org', 'who.int'];
const T3 = ['reuters.com', 'apnews.com', 'bloomberg.com', 'ft.com', 'wsj.com', 'economist.com', 'bbc.com', 'bbc.co.uk', 'aljazeera.com', 'nytimes.com', 'theguardian.com'];
const T4 = ['wikipedia.org', 'investopedia.com', 'statista.com', 'tradingeconomics.com', 'quora.com', 'reddit.com'];

/** A small, opinionated-but-neutral start: international bodies at 1, the major wires at 3, encyclopaedias and aggregators at 4; any .gov or .int host is 1, any .edu or .ac.uk host is 2. Replace or extend `domains` with your own list. */
export const defaultPolicy: Policy = {
  domains: { ...Object.fromEntries(T1.map((d) => [d, 1])), ...Object.fromEntries(T3.map((d) => [d, 3])), ...Object.fromEntries(T4.map((d) => [d, 4])) },
  suffixes: [
    { test: /\.gov(\.[a-z]{2})?$/, tier: 1 }, { test: /\.int$/, tier: 1 }, { test: /\.gouv\./, tier: 1 },
    { test: /\.edu$/, tier: 2 }, { test: /\.ac\.uk$/, tier: 2 },
  ],
  unlistedTier: 3,
  neverCitedFrom: 4,
  hold: { withinMs: 24 * 3_600_000, unlessTier: 2 },
  maxSourcesPerClaim: 50,
};

/** Rules you can pass in `policy.rules`. Each is an example of how to write your own. */
export const rules = {
  /**
   * Content Engine's: an estimate of loss, a causal claim ("X caused Y") or a force-majeure classification needs at least one specialist (tier 2)
   * or better. News (tier 3) alone is enough for "a strike happened" or "the price was X", not for these. The text patterns catch a claim that
   * reads like one of these even when it was labelled something else.
   */
  estimatesCausalLegalNeedSpecialist: {
    name: 'a loss estimate, causal or force-majeure claim',
    categories: ['loss-estimate', 'causal', 'fm-classification'],
    textPatterns: [
      /\bcost[s]?\b.{0,30}\bestimated\b|\blost\b|\blosses?\s+of\b|\bwiped\s+out\b|\bdamage[s]?\s+(?:of|estimated)\b|\bestimated\s+(?:loss(?:es)?|cost|impact|damage)\b|\bprice\s?tag\s+of\b/i,
      /\b(caused\s+by|due\s+to|as\s+a\s+(?:direct\s+)?result\s+of|led\s+to|triggered\s+by|because\s+of)\b/i,
      /\bforce\s+majeure|acts?\s+of\s+god|declared\s+force\s+majeure\b/i,
    ],
    anyOf: [{ atLeast: 1, tier: 2 }],
  } satisfies CorroborationRule,
  /** Hormuz tracker's test for logging a force-majeure declaration: confirmed by one authority (tier 1) or by two independent news sources (tier 3). */
  oneAuthorityOrTwoPress: {
    name: 'a declaration',
    categories: ['declaration'],
    anyOf: [{ atLeast: 1, tier: 1 }, { atLeast: 2, tier: 3 }],
  } satisfies CorroborationRule,
};

// ── The engine ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function hostOf(url: string): string {
  const raw = String(url ?? '').trim();
  let h: string;
  try { h = new URL(raw).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { h = raw.slice(0, 2000).replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0]!.toLowerCase(); }
  // A DNS name is at most 253 characters. Anything longer is not a host, and must not be allowed to cost time.
  return h.length > 253 ? '' : h;
}

/** A host and each parent domain of it: "a.b.reuters.com" gives a.b.reuters.com, b.reuters.com, reuters.com. */
function chain(host: string): string[] {
  const parts = host.split('.');
  if (parts.length > 40) return [host];
  const out = [host];
  for (let i = 1; i < parts.length - 1; i++) out.push(parts.slice(i).join('.'));
  return out;
}

export interface PolicyWarning { message: string }

/** Repairs a policy rather than failing on it: a bad entry is dropped and reported, so one typo in a list cannot take the gate down or, worse, quietly let everything through. */
export function normalizePolicy(p: Partial<Policy> = {}, base: Policy = defaultPolicy): { policy: Required<Omit<Policy, 'hold'>> & { hold: Policy['hold'] }; warnings: string[] } {
  const warnings: string[] = [];
  const validTier = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 9;
  const domains: Record<string, number> = {};
  for (const [d, t] of Object.entries({ ...base.domains, ...(p.domains ?? {}) })) {
    const key = String(d).toLowerCase().replace(/^www\./, '');
    if (!key || !validTier(t)) { warnings.push(`domain "${d}" has no valid tier (${String(t)}); ignored`); continue; }
    domains[key] = t as number;
  }
  const suffixes = [...(p.suffixes ?? base.suffixes ?? [])].filter((s) => {
    const ok = s && s.test instanceof RegExp && validTier(s.tier);
    if (!ok) warnings.push('a suffix rule needs a RegExp and a tier from 0 to 9; ignored');
    return ok;
  });
  const lower = (xs: unknown) => (Array.isArray(xs) ? xs : []).map((x) => String(x).toLowerCase().replace(/^www\./, '')).filter(Boolean);
  const unlistedTier = validTier(p.unlistedTier) ? p.unlistedTier! : base.unlistedTier ?? 3;
  if (p.unlistedTier !== undefined && !validTier(p.unlistedTier)) warnings.push(`unlistedTier ${String(p.unlistedTier)} is not valid; using ${unlistedTier}`);
  const neverCitedFrom = validTier(p.neverCitedFrom) ? p.neverCitedFrom! : base.neverCitedFrom ?? 4;
  const rulesOut: CorroborationRule[] = [];
  for (const r of p.rules ?? base.rules ?? []) {
    const anyOf = (Array.isArray(r?.anyOf) ? r.anyOf : []).filter((q) => q && Number.isInteger(q.atLeast) && q.atLeast >= 1 && validTier(q.tier));
    const patterns = (Array.isArray(r?.textPatterns) ? r.textPatterns : []).filter((x) => x instanceof RegExp);
    const categories = (Array.isArray(r?.categories) ? r.categories : []).map(String);
    // A rule that can never apply, or can never be met, is dropped LOUDLY: silently keeping it would either do nothing or reject every claim.
    if (!r || !r.name || !anyOf.length || (!patterns.length && !categories.length)) { warnings.push(`rule "${r?.name ?? '(unnamed)'}" is incomplete (needs a name, at least one requirement, and categories or text patterns); ignored`); continue; }
    rulesOut.push({ name: r.name, categories, textPatterns: patterns, anyOf });
  }
  const hold = p.hold === null ? null : p.hold !== undefined ? (p.hold && p.hold.withinMs > 0 && validTier(p.hold.unlessTier) ? p.hold : (warnings.push('hold is not valid; using the default'), base.hold ?? null)) : base.hold ?? null;
  return {
    policy: { domains, suffixes, firstParty: lower(p.firstParty ?? base.firstParty), trusted: lower(p.trusted ?? base.trusted), unlistedTier, neverCitedFrom, rules: rulesOut, hold, maxSourcesPerClaim: Math.max(1, Math.floor(p.maxSourcesPerClaim ?? base.maxSourcesPerClaim ?? 50)) },
    warnings,
  };
}

export interface Gate {
  /** Problems found in the policy you passed (each repaired by ignoring the bad entry). Empty when it was clean. */
  warnings: string[];
  /** The tier the policy gives a URL, or null when it does not know the host. */
  tierOf(url: string): number | null;
  check(claims: GateClaim[], opts?: { now?: Date }): GateReport;
}

export function createGate(policy: Partial<Policy> = {}): Gate {
  const { policy: P, warnings } = normalizePolicy(policy);
  const inSet = (host: string, set: string[]) => { const s = new Set(set); return chain(host).some((h) => s.has(h)); };

  function lookup(host: string): number | null {
    for (const h of chain(host)) if (Object.prototype.hasOwnProperty.call(P.domains, h)) return P.domains[h]!;
    for (const s of P.suffixes) if (s.test.test(host)) return s.tier;
    return null;
  }

  function annotate(s: GateSource): GateSourceVerdict {
    const host = hostOf(s.url);
    if (host && inSet(host, P.firstParty)) return { ...s, tier: 0, listed: true, trusted: false, firstParty: true };
    const listedTier = host ? lookup(host) : null;
    if (listedTier !== null) return { ...s, tier: listedTier, listed: true, trusted: false, firstParty: false };
    const trusted = !!host && inSet(host, P.trusted);
    let tier = P.unlistedTier;
    // A domain the policy does not know cannot be certified by the claim's own author: they may say it is WORSE, never better.
    if (!trusted && typeof s.tier === 'number' && Number.isFinite(s.tier) && s.tier > P.unlistedTier) tier = Math.min(Math.floor(s.tier), 9);
    return { ...s, tier, listed: false, trusted, firstParty: false };
  }

  function judge(raw: GateClaim, now: Date): GateVerdict {
    const list = Array.isArray(raw?.sources) ? raw.sources.slice(0, P.maxSourcesPerClaim) : [];
    const sources = list.filter((s) => s && typeof s.url === 'string' && s.url.trim()).map(annotate);
    const claim: GateClaim = { ...raw, sources: sources };
    const out = (outcome: GateOutcome, bucket: Bucket, reason: string, extra: Partial<GateVerdict> = {}): GateVerdict => ({ claim, outcome, bucket, reason, sources, ...extra });
    if (!sources.length) return out('no-source', 'failed', 'no usable source');
    const tiers = sources.map((s) => s.tier);
    const best = Math.min(...tiers);
    if (tiers.every((t) => t >= P.neverCitedFrom)) return out('low-tier-only', 'failed', `Tier ${P.neverCitedFrom} sources only (they point to the source; they are not the source)`, { bestTier: best });

    const text = String(raw.text ?? '');
    for (const r of P.rules) {
      const labelled = !!raw.category && (r.categories ?? []).includes(raw.category);
      const reads = !labelled && (r.textPatterns ?? []).some((re) => re.test(text));
      if (!labelled && !reads) continue;
      const hosts = (tier: number) => new Set(sources.filter((s) => s.tier <= tier).map((s) => hostOf(s.url)));
      if (r.anyOf.some((q) => hosts(q.tier).size >= q.atLeast)) continue;
      const need = r.anyOf.map((q) => `${q.atLeast === 1 ? 'one source' : `${q.atLeast} different sources`} at Tier ${q.tier} or better`).join(' or ');
      return out('needs-corroboration', 'failed', labelled ? `${r.name} needs ${need}` : `reads like ${r.name} (labelled "${raw.category ?? 'none'}"), which needs ${need}`, { rule: r.name, bestTier: best });
    }

    if (P.hold) {
      const dated = sources.map((s) => (s.date ? Date.parse(s.date) : NaN)).filter((n) => !Number.isNaN(n));
      const newest = dated.length ? Math.max(...dated) : null;
      if (newest !== null && now.getTime() - newest < P.hold.withinMs && best > P.hold.unlessTier) {
        return out('hold', 'check', `its only backing is news less than ${Math.round(P.hold.withinMs / 3_600_000)} hours old; wait, or corroborate it with a Tier ${P.hold.unlessTier} or better source`, { bestTier: best });
      }
    }
    return out('pass', 'ok', `sourced at Tier ${best}`, { bestTier: best });
  }

  return {
    warnings,
    tierOf: (url) => { const h = hostOf(url); if (!h) return null; if (inSet(h, P.firstParty)) return 0; return lookup(h); },
    check(claims, opts = {}) {
      const now = opts.now ?? new Date();
      const verdicts = (Array.isArray(claims) ? claims : []).map((c) => {
        // A claim that cannot be judged must never pass by accident.
        try { return judge(c, now); }
        catch { return { claim: { text: String(c?.text ?? ''), sources: [] }, outcome: 'error' as const, bucket: 'check' as const, reason: 'could not be evaluated', sources: [] } satisfies GateVerdict; }
      });
      const unlisted = [...new Set(verdicts.flatMap((v) => v.sources.filter((s) => !s.listed).map((s) => hostOf(s.url))).filter(Boolean))];
      const summary = summarizeBuckets(verdicts.map((v) => v.bucket), { label: 'Claims', ok: 'passed', check: 'held', failed: 'dropped', failedTail: ' — do not state the dropped ones as fact.' });
      return {
        verdicts, passed: verdicts.filter((v) => v.outcome === 'pass'), dropped: verdicts.filter((v) => v.bucket === 'failed'), held: verdicts.filter((v) => v.outcome === 'hold' || v.outcome === 'error'),
        unlistedDomains: unlisted, summary, ok: summary.failed === 0,
      };
    },
  };
}

// ── Recency ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RecencySummary {
  dated: number; total: number;
  oldest: GateSource | null; newest: GateSource | null;
  stale: GateSource[]; staleCount: number;
  note: string;
}

/** How fresh the sourcing is. Sources older than `staleDays` (default two years) are listed, so a figure resting only on them can be dated in the prose. */
export function summariseRecency(sources: GateSource[], opts: { now?: Date; staleDays?: number } = {}): RecencySummary {
  const now = opts.now ?? new Date();
  const staleDays = opts.staleDays ?? 730;
  const dated = (sources ?? []).map((s) => ({ s, t: s.date ? Date.parse(s.date) : NaN })).filter((x) => !Number.isNaN(x.t)).sort((a, b) => a.t - b.t);
  if (!dated.length) return { dated: 0, total: sources?.length ?? 0, oldest: null, newest: null, stale: [], staleCount: 0, note: 'No publication dates could be read: treat every figure\'s currency as unknown.' };
  const cutoff = now.getTime() - staleDays * 86_400_000;
  const stale = dated.filter((x) => x.t < cutoff).map((x) => x.s);
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const years = Math.round((staleDays / 365) * 10) / 10;
  return {
    dated: dated.length, total: sources.length, oldest: dated[0]!.s, newest: dated[dated.length - 1]!.s, stale, staleCount: stale.length,
    note: stale.length ? `${stale.length} of ${dated.length} dated sources are more than ${years} years old (oldest: ${iso(dated[0]!.t)}). Any figure resting only on those must be dated in the prose.` : `All dated sources are within the last ${years} years (oldest: ${iso(dated[0]!.t)}).`,
  };
}
