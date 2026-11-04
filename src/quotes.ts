/* Quotes: is this sentence really in the source?
   A model asked to back a claim with "an exact quote from the posting" can invent the quote. This checks it against the source
   text you supply: no network, no model, deterministic, safe to run on private text.
   It is lenient about typography only (whitespace, curly quotes, dashes, case) and never about words. A quote that is really
   there can still be out of context ("is available" cut from "is available only to staff"): that is for a person to judge. */
import type { Bucket, Summary } from './types.js';
import { summarizeBuckets } from './summary.js';

/** Quotes shorter than this prove nothing ("sponsorship" is in almost every posting). */
export const DEFAULT_MIN_QUOTE_CHARS = 12;

export interface QuoteOptions {
  /** The shortest quote accepted. Default 12 characters. */
  minChars?: number;
  /** Require the quote to start and end at a word boundary, so "ship is available" does not match inside "sponsorship is available". Default true. */
  wholeWords?: boolean;
}

export type QuoteStatus = 'found' | 'missing' | 'too-short' | 'empty';

export interface QuoteVerdict {
  quote: string;
  status: QuoteStatus;
  bucket: Extract<Bucket, 'ok' | 'failed'>;
  message: string;
  /** What you called it, when you used `checkQuotes`. */
  id?: string;
}

/** Typography only: whitespace, quote marks, dashes, ellipsis characters, accents-as-written and case. Never words. */
function canon(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’‚′`´]/g, "'")
    .replace(/[“”„″«»]/g, '"')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

/** Checks one quote against one source text. */
export function checkQuote(source: string, quote: string | null | undefined, opts: QuoteOptions = {}): QuoteVerdict {
  const min = opts.minChars ?? DEFAULT_MIN_QUOTE_CHARS;
  const raw = quote ?? '';
  if (!raw.trim()) return { quote: raw, status: 'empty', bucket: 'failed', message: 'No quote was given.' };
  const q = canon(raw).replace(/^["']+|["']+$/g, '').replace(/[.…]+$/, '').trim();
  if (q.length < min) return { quote: raw, status: 'too-short', bucket: 'failed', message: `A quote of ${q.length} characters proves nothing: it would match almost any text. Quote a whole sentence (at least ${min} characters).` };
  const text = canon(String(source ?? ''));
  let from = 0;
  for (;;) {
    const at = text.indexOf(q, from);
    if (at < 0) break;
    if (opts.wholeWords === false || (!isWordChar(text[at - 1]) && !isWordChar(text[at + q.length]))) {
      return { quote: raw, status: 'found', bucket: 'ok', message: 'The quote is in the source text.' };
    }
    from = at + 1;
  }
  return { quote: raw, status: 'missing', bucket: 'failed', message: 'The quote is not in the source text. It may be paraphrased or invented.' };
}

/** True when the quote is in the source (see `checkQuote` for the reason when it is not). */
export function verifyQuote(source: string, quote: string | null | undefined, opts: QuoteOptions = {}): boolean {
  return checkQuote(source, quote, opts).status === 'found';
}

export interface QuoteItem { quote: string | null | undefined; source: string; id?: string }
export interface QuoteReport {
  verdicts: QuoteVerdict[];
  summary: Summary;
  /** True when every quote was found. */
  ok: boolean;
}

/** Checks many quotes, each against its own source text. */
export function checkQuotes(items: QuoteItem[], opts: QuoteOptions = {}): QuoteReport {
  const verdicts = items.map((it) => ({ ...checkQuote(it.source, it.quote, opts), ...(it.id !== undefined ? { id: it.id } : {}) }));
  const summary = summarizeBuckets(verdicts.map((v) => v.bucket), { label: 'Quotes', ok: 'found', check: 'to check', failed: 'not found', failedTail: ' — do not present them as evidence.' });
  return { verdicts, summary, ok: summary.failed === 0 };
}
