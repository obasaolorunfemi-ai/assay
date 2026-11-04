import { summarizeBuckets } from './summary.js';
import { trimBy, trimEndBy } from './strutil.js';
/** Quotes shorter than this prove nothing ("sponsorship" is in almost every posting). */
export const DEFAULT_MIN_QUOTE_CHARS = 12;
/** Typography only: whitespace, quote marks, dashes, ellipsis characters, accents-as-written and case. Never words. */
function canon(s) {
    return s
        .normalize('NFKC')
        .replace(/[‘’‚′`´]/g, "'")
        .replace(/[“”„″«»]/g, '"')
        .replace(/[‐‑‒–—―−]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}
const isWordChar = (c) => !!c && /[\p{L}\p{N}]/u.test(c);
/** Checks one quote against one source text. */
export function checkQuote(source, quote, opts = {}) {
    const min = opts.minChars ?? DEFAULT_MIN_QUOTE_CHARS;
    const raw = quote ?? '';
    if (!raw.trim())
        return { quote: raw, status: 'empty', bucket: 'failed', message: 'No quote was given.' };
    const q = trimEndBy(trimBy(canon(raw), (c) => c === '"' || c === "'"), (c) => c === '.' || c === '…').trim();
    if (q.length < min)
        return { quote: raw, status: 'too-short', bucket: 'failed', message: `A quote of ${q.length} characters proves nothing: it would match almost any text. Quote a whole sentence (at least ${min} characters).` };
    const text = canon(String(source ?? ''));
    let from = 0;
    for (;;) {
        const at = text.indexOf(q, from);
        if (at < 0)
            break;
        if (opts.wholeWords === false || (!isWordChar(text[at - 1]) && !isWordChar(text[at + q.length]))) {
            return { quote: raw, status: 'found', bucket: 'ok', message: 'The quote is in the source text.' };
        }
        from = at + 1;
    }
    return { quote: raw, status: 'missing', bucket: 'failed', message: 'The quote is not in the source text. It may be paraphrased or invented.' };
}
/** True when the quote is in the source (see `checkQuote` for the reason when it is not). */
export function verifyQuote(source, quote, opts = {}) {
    return checkQuote(source, quote, opts).status === 'found';
}
/** Checks many quotes, each against its own source text. */
export function checkQuotes(items, opts = {}) {
    const verdicts = items.map((it) => ({ ...checkQuote(it.source, it.quote, opts), ...(it.id !== undefined ? { id: it.id } : {}) }));
    const summary = summarizeBuckets(verdicts.map((v) => v.bucket), { label: 'Quotes', ok: 'found', check: 'to check', failed: 'not found', failedTail: ' — do not present them as evidence.' });
    return { verdicts, summary, ok: summary.failed === 0 };
}
