/* Word matching shared by the checks that ask "is this word, or a close form of it, in the material?". Internal: not a package entry point. */

export const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}'’-]*|&/gu;

/** A word without a possessive 's or edge punctuation. */
export const cleanWord = (w: string): string => w.replace(/['’]s$/i, '').replace(/^['’-]+|['’-]+$/g, '');

/** The same word, allowing a plural or a short ending: "Nigeria" and "Nigerian", "founder" and "founders". */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 5 && l.startsWith(s) && l.length - s.length <= 3;
}

/** The set of words in some text, with an index by first five letters so "is this word (or a close form) there?" stays fast on long materials. */
export function wordIndex(text: string): (w: string) => boolean {
  const exact = new Set<string>();
  const byPrefix = new Map<string, string[]>();
  for (const m of text.matchAll(TOKEN)) {
    const w = cleanWord(m[0]).toLowerCase();
    if (!w || exact.has(w)) continue;
    exact.add(w);
    if (w.length >= 5) { const k = w.slice(0, 5); const list = byPrefix.get(k); if (list) list.push(w); else byPrefix.set(k, [w]); }
  }
  return (w: string) => exact.has(w) || (w.length >= 5 && (byPrefix.get(w.slice(0, 5)) ?? []).some((k) => sameWord(k, w)));
}
