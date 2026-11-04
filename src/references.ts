/* References: does a draft lean on an outside source that the materials never mention?
   Models cite without being asked: "(Okafor & Bello, 2019)", "according to the World Bank report", "studies show…".
   The bracketed format the citations check reads is not how a model writes unprompted, so those slip past it. This reads the
   loose forms and checks each against the MATERIALS you supplied: a source nobody supplied is one to check or cut.
   Offline and deterministic. It does not look the source up (that is the citations check, for the bracketed format). */
import { scopedSentences, type About } from './scope.js';
import { summarizeBuckets } from './summary.js';
import type { Bucket, Summary } from './types.js';

export interface ReferenceOptions {
  /** Read only the sentences that speak to or about the reader. */
  about?: About;
}

export interface ReferenceVerdict {
  /** As written. */
  source: string;
  kind: 'author-year' | 'numbered' | 'according-to' | 'appeal';
  supported: boolean;
  bucket: Extract<Bucket, 'ok' | 'failed'>;
  message: string;
}

export interface ReferenceReport {
  verdicts: ReferenceVerdict[];
  summary: Summary;
  ok: boolean;
}

const NAME = "\\p{Lu}[\\p{L}'’-]{1,30}";
// Every quantifier is bounded, so none is quadratic on a long run of one character.
const AUTHOR_YEAR = new RegExp(`\\(?(${NAME}(?:\\s(?:and|&)\\s${NAME}|\\set al\\.?)?),?\\s\\(?((?:1[89]|20)\\d{2}[a-z]?)\\)`, 'gu');
const NUMBERED = /\[(\d{1,3}(?:\s?[,–-]\s?\d{1,3}){0,6})\]/g;
const ACCORDING = /\baccording to (?:the |a |an |recent |new |one |several )?([^.,;:()\n]{3,70}?)(?=[,.;:)\n]| and | which | that )/gi;
const APPEAL = /\b(?:studies|research|surveys|data|evidence|statistics|experts|analysts|scientists|economists|reports) (?:show|shows|suggest|suggests|indicate|indicates|confirm|confirms|have shown|has shown|agree|say|says)\b|\bit is (?:widely|well) (?:known|documented|accepted)\b|\bexperts (?:agree|say)\b/gi;

const canon = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function findReferences(text: string, opts: ReferenceOptions = {}): { source: string; kind: ReferenceVerdict['kind'] }[] {
  const out: { source: string; kind: ReferenceVerdict['kind'] }[] = [];
  const seen = new Set<string>();
  const add = (source: string, kind: ReferenceVerdict['kind']) => {
    const key = canon(source);
    if (key && !seen.has(key)) { seen.add(key); out.push({ source: source.trim(), kind }); }
  };
  for (const s of scopedSentences(text, opts.about)) {
    for (const m of s.matchAll(AUTHOR_YEAR)) add(`${m[1]}, ${m[2]}`, 'author-year');
    for (const m of s.matchAll(NUMBERED)) add(`[${m[1]}]`, 'numbered');
    for (const m of s.matchAll(ACCORDING)) add(`according to ${m[1]}`, 'according-to');
    for (const m of s.matchAll(APPEAL)) add(m[0], 'appeal');
  }
  return out;
}

const MESSAGES: Record<ReferenceVerdict['kind'], string> = {
  'author-year': 'A citation your materials do not contain. If it is real, add it to your materials; if you cannot find it, cut it.',
  numbered: 'A numbered reference, and your materials have no matching list. There is nothing for it to point to.',
  'according-to': 'Leans on an outside source your materials do not mention. Name it from your own materials, or cut it.',
  appeal: 'Appeals to unnamed research or experts. Nothing in your materials says this; cut it or give the source.',
};

/** Every loose source in `text`, each judged against `materials` (one text, or several): supported only when the same source appears there. */
export function checkReferences(text: string, materials: string | string[], opts: ReferenceOptions = {}): ReferenceReport {
  const known = canon((Array.isArray(materials) ? materials : [materials]).join('\n'));
  const verdicts: ReferenceVerdict[] = findReferences(text, opts).map(({ source, kind }) => {
    const key = canon(source.replace(/^according to /i, ''));
    const supported = key.length > 0 && known.includes(key);
    return { source, kind, supported, bucket: supported ? 'ok' : 'failed', message: supported ? 'This source is in your materials.' : MESSAGES[kind] } as ReferenceVerdict;
  });
  const summary = summarizeBuckets(verdicts.map((v) => v.bucket), { label: 'References', ok: 'in your materials', check: 'to check', failed: 'not in your materials', failedTail: ' — a source you did not supply is one to check or cut.' });
  return { verdicts, summary, ok: summary.failed === 0 };
}

/** The sources in `text` that are not in `materials`, as written, once each. */
export function findUnsupportedReferences(text: string, materials: string | string[], opts: ReferenceOptions = {}): string[] {
  return checkReferences(text, materials, opts).verdicts.filter((v) => !v.supported).map((v) => v.source);
}
