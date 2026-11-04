/* String matching for titles and names. Measured, not guessed: each rule exists because a real checker run got it wrong. */

export const TITLE_MATCH_THRESHOLD = 0.5;
/** Below this a title that matched is only similar: the verdict shows the real title so a person can compare. */
export const TITLE_EXACT_THRESHOLD = 0.85;

const STOPWORDS = new Set(['the', 'and', 'of', 'a', 'an', 'in', 'on', 'for', 'to', 'with', 'is', 'are', 'at', 'by', 'from', 'as', 'that', 'this', 'it', 'its', 'was', 'were', 'be', 'been', 'or', 'but', 'not', 'into', 'onto', 'over', 'under', 'their', 'his', 'her', 'our', 'your']);

/** A name as letters only, accents folded. OpenAlex spells Bourdieu "Bourdıeu" (dotless i) and Acemoglu "Acemoğlu". */
export function nameKey(s: string | undefined | null): string {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i').replace(/ø/gi, 'o').replace(/ł/gi, 'l').replace(/đ/gi, 'd').replace(/ß/g, 'ss').replace(/æ/gi, 'ae').replace(/œ/gi, 'oe')
    .toLowerCase().replace(/[^a-z]/g, '');
}

function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The words of a title that carry meaning: no stopwords, nothing shorter than three letters. */
export function significantWords(s: string): string[] {
  return normalize(s).split(' ').filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function bigrams(words: string[]): Set<string> {
  const g = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) g.add(words[i] + '_' + words[i + 1]);
  return g;
}

/** The title before its subtitle. */
export function mainTitle(t: string): string {
  return (t || '').split(/[:—–]/)[0];
}

/* Plain word overlap alone is not enough: a fabricated title scored 0.56 against a real, unrelated paper purely from shared
   field jargon plus stopwords. So stopwords are dropped and ordered word pairs count for more than single words. */
function similarityRaw(a: string, b: string): number {
  const wa = significantWords(a), wb = significantWords(b);
  if (wa.length < 2 || wb.length < 2) return 0;
  const sa = new Set(wa), sb = new Set(wb);
  let uni = 0; sa.forEach((w) => { if (sb.has(w)) uni++; });
  const uniSim = uni / Math.max(sa.size, sb.size);
  const ba = bigrams(wa), bb = bigrams(wb);
  let bi = 0; ba.forEach((g) => { if (bb.has(g)) bi++; });
  const biSim = ba.size && bb.size ? bi / Math.max(ba.size, bb.size) : 0;
  return uniSim * 0.35 + biSim * 0.65;
}

/** How alike two titles are, 0 to 1. A title cited without its subtitle is also compared with the record's main title. */
export function titleSimilarity(a: string, b: string): number {
  const full = similarityRaw(a, b);
  if (full >= TITLE_EXACT_THRESHOLD) return full;
  let best = full;
  if (!/[:—–]/.test(a) && /[:—–]/.test(b)) best = Math.max(best, similarityRaw(a, mainTitle(b)));
  if (!/[:—–]/.test(b) && /[:—–]/.test(a)) best = Math.max(best, similarityRaw(mainTitle(a), b));
  return best;
}

/** How alike two journal names are, by their meaningful words. */
export function venueSimilarity(a: string, b: string): number {
  const sa = new Set(significantWords(a)), sb = new Set(significantWords(b));
  let n = 0; sa.forEach((w) => { if (sb.has(w)) n++; });
  return n / Math.max(sa.size, sb.size, 1);
}
