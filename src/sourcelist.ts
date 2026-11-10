/* Source list: what a reader sees as "the sources" must come from your approved claims, not from the model.
   A model asked to end a draft with a Sources section can add an entry that was never approved, and nothing downstream looks at that list.
   So the tool takes it over: remove the section the model wrote, build the real one from the claims the draft actually cites, take out
   any link in the text that is not an approved source, and mark whatever is still unsupported where the reader will see it.
   Pure text in, text out: no network, no model, deterministic, safe on private text. */
import { cap } from './strutil.js';
import { hostOf, normalizeUrl, extractUrls } from './provenance.js';

// A heading that opens a source list. Checked on a short, whitespace-collapsed line, so "## Sources of remittance growth" is not one.
const SOURCES_HEADING = /^(?:#{1,4} ?|\*\*|__)?(?:sources?|references?|bibliography|citations?|further reading|works cited|source list|notes and sources) ?:? ?(?:\*\*|__)?$/i;
const ANY_HEADING = /^#{1,3}\s+\S/;
const FENCE = /^```/;
const HEADING_MAX = 80;

const isSourcesHeading = (line: string) => {
  const t = cap(line.trim(), 400);
  if (t.length > HEADING_MAX) return false;
  return SOURCES_HEADING.test(t.replace(/\s+/g, ' '));
};

/**
 * Removes the Sources / References / Further reading section the model wrote: from its heading to the next heading, or the end.
 * Code fences are left alone. `hadSection` says whether there was one, which tells you the format expects a list.
 */
export function splitSourceSection(markdown: string): { body: string; hadSection: boolean } {
  const out: string[] = [];
  let skipping = false, hadSection = false, inFence = false;
  for (const line of String(markdown ?? '').split('\n')) {
    const t = line.trim();
    if (FENCE.test(t)) inFence = !inFence;
    if (!inFence && !skipping && isSourcesHeading(line)) { skipping = true; hadSection = true; continue; }
    if (skipping) {
      if (ANY_HEADING.test(t) && !isSourcesHeading(line)) skipping = false;
      else continue;
    }
    out.push(line);
  }
  return { body: out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd(), hadSection };
}

export interface ListedSource { url?: string; publisher?: string; title?: string; tier?: number | null; [k: string]: unknown }
export interface ListedClaim { ref: number; sources?: ListedSource[] }

export interface SourceListOptions {
  /** 'links' (default): "- [Title](url) — Publisher (Tier 1)". 'plain': "- Publisher — Tier 1", one line per publisher, no links (a short post). */
  style?: 'links' | 'plain';
  /** How a tier reads. Default "Tier 1"; "tier ?" when unknown. */
  tierLabel?: (tier: number | null | undefined) => string;
  /** Leave a source out (a dead link, say). */
  skip?: (source: ListedSource) => boolean;
  /** The heading. Default "## Sources". */
  heading?: string;
  /** The line added when claim 0 (your own supplied data) was cited. Default "- Your own first-party data, supplied for this piece — Tier 0". */
  firstParty?: string;
}

/** The Sources section a reader sees: the sources of the claims the draft cites, once each. An empty string when there is nothing to list. */
export function buildSourceList(claims: ListedClaim[], refsUsed: number[], opts: SourceListOptions = {}): string {
  const tierLabel = opts.tierLabel ?? ((t) => (t == null ? 'tier ?' : `Tier ${t}`));
  const plain = opts.style === 'plain';
  const used = new Set(refsUsed ?? []);
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const c of Array.isArray(claims) ? claims : []) {
    if (!used.has(c.ref)) continue;
    for (const s of c.sources ?? []) {
      if (opts.skip?.(s)) continue;
      const host = hostOf(s.url);
      const who = s.publisher || host;
      const key = plain ? String(who).toLowerCase() : normalizeUrl(s.url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      lines.push(plain ? `- ${who} — ${tierLabel(s.tier)}` : `- [${s.title || host}](${s.url}) — ${who} (${tierLabel(s.tier)})`);
    }
  }
  if (used.has(0)) lines.push(opts.firstParty ?? '- Your own first-party data, supplied for this piece — Tier 0');
  return lines.length ? `${opts.heading ?? '## Sources'}\n\n${lines.join('\n')}` : '';
}

/** Every address a reader may be sent to: those on the claims' sources, plus any in the operator's own text (data, a call to action). */
export function approvedUrls(claims: Array<{ sources?: Array<{ url?: string }> }>, ...operatorTexts: Array<string | null | undefined>): Set<string> {
  const set = new Set<string>();
  for (const c of Array.isArray(claims) ? claims : []) for (const s of c?.sources ?? []) { const n = normalizeUrl(s?.url); if (n) set.add(n); }
  for (const t of operatorTexts) for (const u of extractUrls(t)) set.add(u);
  return set;
}

const MD_LINK = /\[([^\]\n]{0,300})\]\((https?:\/\/[^)\s]{1,2000})(?: "[^"\n]{0,200}")?\)/g;
const ANGLE_URL = /<(https?:\/\/[^>\s]{1,2000})>/g;
const BARE_URL = /https?:\/\/[^\s<>"'`)\]]{1,2000}/g;

function hostAllowed(url: string, allowed: Set<string>): boolean {
  const host = hostOf(url);
  if (!host) return false;
  for (const h of allowed) if (host === h || host.endsWith(`.${h}`)) return true;
  return false;
}

/**
 * Removes the links that are not approved: `[text](url)` keeps its text, a bare address is dropped. A link is fine when it is in `approved`
 * or on one of `allowedHosts` (your own domains, any path). Code fences (a chart's data) are left alone.
 */
export function stripUnapprovedLinks(markdown: string, approved: Set<string>, allowedHosts: Iterable<string> = []): { body: string; removed: Array<{ url: string; line: string }> } {
  const hosts = new Set([...allowedHosts].map((h) => String(h).toLowerCase().replace(/^www\./, '')));
  const removed: Array<{ url: string; line: string }> = [];
  const ok = (url: string) => { const n = normalizeUrl(url); return (!!n && approved.has(n)) || hostAllowed(url, hosts); };
  let inFence = false;
  const lines = String(markdown ?? '').split('\n').map((line) => {
    if (FENCE.test(line.trim())) { inFence = !inFence; return line; }
    if (inFence) return line;
    const where = line.trim().slice(0, 200);
    let next = line.replace(MD_LINK, (m, text: string, url: string) => { if (ok(url)) return m; removed.push({ url, line: where }); return text; });
    next = next.replace(ANGLE_URL, (m, url: string) => { if (ok(url)) return m; removed.push({ url, line: where }); return ''; });
    // A bare address that survived the passes above and is not inside a markdown link's parentheses.
    next = next.replace(BARE_URL, (m, offset: number, whole: string) => {
      const prev = whole[offset - 1];
      if (prev === '(' || prev === '[') return m;
      if (ok(m)) return m;
      removed.push({ url: m, line: where });
      return '';
    });
    return next === line ? line : next.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([.,;:)])/g, '$1');
  });
  return { body: lines.join('\n'), removed };
}

/** What `markLines` appends by default. */
export const UNSUPPORTED_MARKER = '[verify: unapproved source — confirm it or remove this line before publishing]';

/** Appends a visible marker to each line listed in `lines` (matched on the first 200 characters of the trimmed line), once, so it cannot reach a reader unmarked. */
export function markLines(markdown: string, lines: Iterable<string>, marker: string = UNSUPPORTED_MARKER): string {
  const bad = new Set([...lines]);
  if (!bad.size) return String(markdown ?? '');
  const already = /\[verify:/i;
  return String(markdown ?? '').split('\n').map((l) => (bad.has(l.trim().slice(0, 200)) && !already.test(l) ? `${l.trimEnd()} ${marker}` : l)).join('\n');
}

/** One line per problem, to tell the model what to fix on a redraft: `- "the line" — why`. */
export function problemsForPrompt(problems: Array<{ line: string; reason: string }>, limit = 12): string {
  return (Array.isArray(problems) ? problems : []).slice(0, limit).map((p) => `- "${String(p.line).slice(0, 140)}" — ${p.reason}`).join('\n');
}
