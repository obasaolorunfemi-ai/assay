/* Attributions: does every line that NAMES a source, a document, a person or a quote have an approved claim behind it?
   The grounding check proves that every FIGURE traces to an approved claim. A sentence with no number in it ("according to Dr Obi's CV, she
   ran the reserve desk") has nothing for it to read, and neither do a bullet, a heading or a quote. A model fills those with the credible
   detail it does not have: a CV nobody wrote, a study nobody ran, a person nobody named. This reads every line, headings and bullets
   included, and requires that anything it names carries a claim tag AND is in the approved material.

   What it looks for, per line:
   - a personal record (a CV, a résumé, a profile, a biography): never a source for an article, so the line needs a tag and the material must say it;
   - a document (a study, a survey, a filing, a white paper): the line needs a tag;
   - an attribution ("according to X", "X said"): the line needs a tag, and X must be in the approved material;
   - a direct quote of three words or more: it must be word for word in the approved material;
   - a titled person (Dr, Governor, Minister…): the name must be in the approved material.
   A line carrying a "[verify: …]" marker is skipped: that is the writer saying "chase this", on purpose.

   Offline, deterministic, safe on private text. It checks that a source is TRACEABLE to your material, not that the claim is true. Every pattern is bounded
   and every line is cut to a safe length, so a hostile draft cannot make it slow. */
import { tagPatterns, type TagFormat } from './grounding.js';
import { summarizeBuckets } from './summary.js';
import type { Summary } from './types.js';
import { hostOf } from './provenance.js';
import { cap } from './strutil.js';
import { cleanWord, wordIndex } from './words.js';

export type AttributionCode = 'personal-record' | 'document-untagged' | 'attribution-untagged' | 'attribution-unknown' | 'quote-unbacked' | 'person-unknown';

export interface AttributionProblem {
  /** Always 'source': kept so a caller can tell these from `grounding`'s 'figure' violations. */
  kind: 'source';
  code: AttributionCode;
  /** The line, cut to 200 characters. */
  line: string;
  reason: string;
}

export interface AttributionReport {
  ok: boolean;
  violations: AttributionProblem[];
  /** One line per run: how many lines were read, and how many named something the approved material does not back. */
  summary: Summary;
}

export interface AttributionOptions {
  /** Everything the draft may legitimately name: the approved claims, their publishers, the data you supplied (one text, or several). See `buildCorpus`. */
  corpus: string | string[];
  /** The tag syntax the draft uses. Default `[[c3]]`, `[[calc: …]]`, `[verify: …]` (see `grounding`). */
  tags?: Partial<TagFormat>;
  /** Most lines read per draft. Default 5000. */
  maxLines?: number;
}

const FENCE = /^```/;
const LINE_MAX = 1000;

// Personal records and profiles: never an acceptable source for an article, and never something a model should cite from memory.
const PERSONAL_RECORD = /\bCV\b|curriculum vitae|résumé|resumé|résume\b|\bLinkedIn (?:profile|page|bio)\b|\bbiograph(?:y|ical)\b|\bdossier\b/i;
// Documents and studies: fine when an approved claim backs them, invented otherwise.
const DOCUMENT = /\b(?:studies|study|surveys?|polls?|white ?papers?|working papers?|annual reports?|press releases?|thesis|dissertation|transcripts?|memorandum|datasets?|audit reports?|court (?:filing|ruling)s?|filings?)\b/i;

const CAP = "\\p{Lu}[\\p{L}&.'’-]{0,40}";
const ACCORDING = /\baccording to\s+([^,.;:()\n]{2,80})/gi;
const SAYS = new RegExp(`(${CAP}(?:\\s+(?:of|and|for|the|&)\\s+${CAP}|\\s+${CAP}){0,5})\\s+(?:says|said|told|estimates|estimated|reports|reported|found|finds|notes|noted|warned|warns|argues|argued|projects|projected|forecasts?|expects|expected)\\b`, 'gu');
const QUOTE = /["“]([^"”\n]{12,300})["”]/g;
const TITLED = /\b(?:Dr|Prof|Professor|Mr|Mrs|Ms|Mx|Chief|Hon|Governor|Minister|Senator|Justice|Sir|Dame|President|Director|CEO|CFO|CTO)\.?\s+(\p{Lu}[\p{L}'’-]{1,40}(?:\s+\p{Lu}[\p{L}'’-]{1,40}){0,3})/gu;
const LIST_MARKER = /^(?:>\s*|#{1,6}\s+|[-*•]\s+|\d+[.)]\s+)+/;

const LEADING_STOP = new Set(['the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'its', 'we', 'our', 'they', 'their', 'he', 'she', 'his', 'her', 'but', 'and', 'so', 'if', 'when', 'while', 'as', 'in', 'on', 'at', 'for', 'with', 'however', 'meanwhile', 'still', 'yet', 'there', 'here', 'what', 'who', 'why', 'how']);
// A plural group, not a named source: the line needs a tag, but there is no name to look up.
const GENERIC = new Set(['analysts', 'economists', 'experts', 'officials', 'reports', 'investors', 'traders', 'banks', 'markets', 'governments', 'people', 'customers', 'users', 'researchers', 'critics', 'sources', 'observers', 'regulators', 'authorities', 'businesses', 'companies', 'households', 'families']);
const CONNECT = new Set(['of', 'and', 'for', 'the', '&']);

const norm = (s: string): string => s.toLowerCase().replace(/['’]s\b/g, '').replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** The capitalised name at the start of a phrase ("the Lagos Remittance Institute said" -> "Lagos Remittance Institute"). */
function entityOf(phrase: string): string {
  const out: string[] = [];
  for (const raw of phrase.trim().split(/\s+/).slice(0, 12)) {
    const w = raw.replace(/^[("“]+/, '').replace(/[)",”]+$/, '');
    const bare = w.replace(/['’]s$/, '');
    if (!out.length && LEADING_STOP.has(bare.toLowerCase())) continue;
    if (/^\p{Lu}/u.test(bare) || (out.length && CONNECT.has(bare.toLowerCase()))) out.push(bare);
    else break;
  }
  while (out.length && CONNECT.has(out[out.length - 1]!.toLowerCase())) out.pop();
  return out.join(' ');
}

/** A corpus to give `checkAttributions`: the approved claims' text, their publishers, titles and hosts, plus any text the draft may draw on (your data, the topic, the brand's own facts). */
export function buildCorpus(parts: { claims?: Array<{ text?: string; sources?: Array<{ url?: string; publisher?: string; title?: string }> }>; texts?: Array<string | null | undefined> }): string {
  const out: string[] = [];
  for (const c of parts.claims ?? []) {
    if (c?.text) out.push(c.text);
    for (const s of c?.sources ?? []) {
      if (s?.publisher) out.push(s.publisher);
      if (s?.title) out.push(s.title);
      const host = hostOf(s?.url);
      if (host) out.push(host.split('.').slice(0, -1).join(' '), host);
    }
  }
  for (const t of parts.texts ?? []) if (t) out.push(t);
  return out.join('\n');
}

/** Checks a draft (Markdown) line by line. Everything under a Sources heading should already have been removed (see `splitSourceSection`). Never throws. */
export function checkAttributions(draft: string, opts: AttributionOptions): AttributionReport {
  const raw = (Array.isArray(opts.corpus) ? opts.corpus : [opts.corpus]).map((c) => String(c ?? '')).join('\n');
  const corpus = norm(raw);
  const has = wordIndex(raw);
  const tag = tagPatterns(opts.tags);
  const violations: AttributionProblem[] = [];
  const seen = new Set<string>();
  const flag = (code: AttributionCode, line: string, reason: string) => {
    const key = `${line}||${reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({ kind: 'source', code, line, reason });
  };
  const nameBacked = (phrase: string): boolean => {
    const p = norm(phrase);
    if (!p) return true;
    if (corpus.includes(p)) return true;
    const tokens = p.split(' ').filter((t) => t.length >= 3 && !CONNECT.has(t));
    return tokens.length > 0 && tokens.every((t) => has(t));
  };
  // A whole-word substring test on the normalised corpus, so "the position was stable" is found however the punctuation around it differs.
  const padded = ` ${corpus} `;
  const quoteBacked = (q: string) => padded.includes(` ${norm(q)} `);

  const buckets: Array<'ok' | 'failed'> = [];
  const lines = String(draft ?? '').split('\n').slice(0, opts.maxLines ?? 5000);
  let inFence = false;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (FENCE.test(trimmed)) { inFence = !inFence; continue; }
    if (inFence || !trimmed) continue;
    const text0 = cap(trimmed, LINE_MAX);
    // "[verify: …]" is the operator-facing "chase this" marker: deliberate, so the line is left alone.
    if (tag.verify.test(text0)) continue;

    const line = text0.slice(0, 200);
    const before = violations.length;
    const text = text0.replace(LIST_MARKER, '').trim();
    const tagged = tag.claim.test(text) || tag.calc.test(text);
    const bare = text.replace(tag.any, '').replace(/\s+/g, ' ').trim();
    if (!bare) continue;

    // Personal records and profiles.
    const personal = bare.match(PERSONAL_RECORD);
    if (personal && (!tagged || !corpus.includes(norm(personal[0])))) {
      flag('personal-record', line, `names a ${personal[0]} — a personal record or profile can only come from an approved source, and none says this`);
    }

    // Studies, filings and other documents need a claim behind them.
    const doc = bare.match(DOCUMENT);
    if (doc && !personal && !tagged) flag('document-untagged', line, `mentions a ${doc[0]} with no tag — a study, filing or document must come from an approved claim`);

    // "According to X…" and "X said…".
    const who: Array<string | null> = [];
    for (const m of bare.matchAll(ACCORDING)) who.push(entityOf(m[1] ?? '') || null);
    for (const m of bare.matchAll(SAYS)) { const e = entityOf(m[1] ?? ''); if (e) who.push(e); }
    for (const w of who) {
      const generic = !w || GENERIC.has(w.toLowerCase());
      if (!tagged) flag('attribution-untagged', line, `attributes a statement to ${w ? `“${w}”` : 'a source'} with no tag`);
      else if (!generic && !nameBacked(w)) flag('attribution-unknown', line, `attributes a statement to “${w}”, which isn't one of the approved sources`);
    }

    // A direct quote must be word for word in the approved material.
    for (const m of bare.matchAll(QUOTE)) {
      const q = m[1] ?? '';
      if (norm(q).split(' ').length < 3) continue;
      if (!tagged || !quoteBacked(q)) flag('quote-unbacked', line, `a direct quote (“${q.slice(0, 50)}${q.length > 50 ? '…' : ''}”) that doesn't appear in any approved claim`);
    }

    // A titled person must be in the approved material.
    for (const m of bare.matchAll(TITLED)) {
      const name = (m[1] ?? '').replace(/['’]s$/, '');
      const last = cleanWord(norm(name).split(' ').filter(Boolean).pop() ?? '');
      if (last.length >= 3 && !has(last)) flag('person-unknown', line, `names ${m[0].replace(/['’]s$/, '')}, who isn't in the approved material`);
    }
    buckets.push(violations.length > before ? 'failed' : 'ok');
  }

  const summary = summarizeBuckets(buckets, { label: 'Lines', ok: 'traced', check: 'to check', failed: 'name something no approved claim backs', failedTail: ' — confirm each or cut it before publishing.' });
  return { ok: violations.length === 0, violations, summary };
}
