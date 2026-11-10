/* Provenance: a claim's source link must be one your research actually produced.
   A model asked to "copy the source URL verbatim from the findings" can ignore the instruction and write one from memory. The link check
   alone does not catch that: a URL it makes up on a real site often still "works" (the site answers 200 for any path, or refuses a robot),
   so being reachable says nothing about where the link came from. This is the check that does: every source on a claim must appear in the
   text the model was given (the findings, the pages you supplied, the data you pasted). A source that does not is removed, and a claim left
   with no source is dropped.
   No network, no model, deterministic, safe on private text. It checks where a link CAME FROM, not whether the page says what the claim says. */
import { cap, trimEndBy } from './strutil.js';

// Bounded on purpose: a long unbroken run after "http://" must not be re-scanned from every position.
const URL_RE = /https?:\/\/[^\s<>"'`)\]]{1,2000}/gi;
// Parameters that never change which page a link points at.
const TRACKING_PARAM = /^(?:utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|ocid|cmpid|ref|ref_src|source|spm)$/i;
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', "'", '"', ')', ']']);

/**
 * The form two links are compared in: host without "www", path without a trailing slash, the query without tracking parameters and in a
 * fixed order; no scheme, no fragment. Returns null for anything that is not an http(s) address.
 */
export function normalizeUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = trimEndBy(cap(raw.trim(), 2200), (c) => TRAILING.has(c));
  let u: URL;
  try { u = new URL(cleaned); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = trimEndBy(u.pathname, (c) => c === '/');
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAM.test(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return `${host}${path}${params ? `?${params}` : ''}`;
}

/** Every http(s) address in a block of text, normalised, once each. */
export function extractUrls(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const m of String(text ?? '').matchAll(URL_RE)) {
    const n = normalizeUrl(m[0]);
    if (n) out.add(n);
  }
  return out;
}

/** The host of an address, lower case and without "www"; "" when it is not an address. */
export function hostOf(url: string | null | undefined): string {
  try { return new URL(String(url ?? '')).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

export interface ProvenanceClaim {
  text?: string;
  category?: string;
  sources?: Array<{ url?: string }>;
}

export interface ProvenanceResult<C extends ProvenanceClaim> {
  /** The claims that still have a source the research produced, with only those sources. A claim that never had a source is kept: whether that is acceptable is the gate's call, not this check's. */
  kept: C[];
  /** Claims whose every source was not in the research. */
  dropped: Array<{ text: string; reason: string; category?: string }>;
  /** Each source taken off a claim, so it can be reported. */
  removed: Array<{ url: string; claim: string }>;
}

/**
 * Keeps, on each claim, only the sources whose address appears in `knownTexts` (everything the model was shown). Never throws.
 * @param claims what the model returned, each with `sources: [{ url }]`
 * @param knownTexts the text(s) the model was given: findings, supplied pages, pasted data
 */
export function enforceProvenance<C extends ProvenanceClaim>(claims: C[], ...knownTexts: Array<string | null | undefined>): ProvenanceResult<C> {
  const known = new Set<string>();
  for (const t of knownTexts) for (const u of extractUrls(t)) known.add(u);

  const kept: C[] = [], dropped: ProvenanceResult<C>['dropped'] = [], removed: ProvenanceResult<C>['removed'] = [];
  for (const claim of Array.isArray(claims) ? claims : []) {
    const sources = Array.isArray(claim?.sources) ? claim.sources : [];
    if (sources.length === 0) { kept.push(claim); continue; }
    const real: typeof sources = [];
    for (const s of sources) {
      const n = normalizeUrl(s?.url);
      if (n && known.has(n)) real.push(s);
      else removed.push({ url: String(s?.url ?? ''), claim: String(claim.text ?? '').slice(0, 120) });
    }
    if (real.length === 0) {
      dropped.push({ text: String(claim.text ?? ''), reason: "source link wasn't in the research — possible invented source", ...(claim.category !== undefined ? { category: claim.category } : {}) });
      continue;
    }
    kept.push({ ...claim, sources: real });
  }
  return { kept, dropped, removed };
}
