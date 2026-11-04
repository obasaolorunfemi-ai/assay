import type { Citation } from './types.js';
import { cap, trimBy } from './strutil.js';

/** "Banerjee et al." and "Banerjee, Duflo, et al." leave surnames, with no stray punctuation (a leftover "." once made every et-al citation unreadable). */
export function splitAuthors(a: string): string[] {
  // Capped, and every run of spaces is bounded: this takes text from anywhere, and an author list is never thousands of characters long.
  return cap(String(a ?? ''), 1000).replace(/\s{0,20}\bet\s{1,20}al\b\.?/gi, '').split(/,|&|\band\b/i).map((s) => s.trim()).filter(Boolean);
}

/**
 * Finds the citations in a piece of text. A citation is a square-bracket tag:
 *
 *   [Author, Year, "Exact Title" — Journal — https://doi.org/…]        a title and a link
 *   [Author, Year, "Exact Title" — Journal — search: https://scholar.google.com/scholar?q=…]
 *   [Author, Year, "Exact Title" — Publisher]                          a title and no link: still checked
 *   [CITATION — approximate: Author, years, topic — search: …]        an author's area, not one paper
 *
 * `[Logical inference — …]` and any other bracket are not citations. Identical tags are returned once.
 */
export function parseCitations(text: string): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  const tagRe = /\[([^[\]]{6,400})\]/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(text))) {
    const raw = m[1]!.trim();
    if (seen.has(raw)) continue;
    if (/^Logical inference/i.test(raw)) continue;
    const approx = /^CITATION\s{0,20}—?\s{0,20}approximate/i.test(raw);
    const urlMatch = raw.match(/https?:\/\/\S+/);
    const titled = /"[^"]{4,300}"/.test(raw) && /\b(19|20)\d{2}\b/.test(raw);
    if (!urlMatch && !approx && !titled) continue;
    seen.add(raw);
    // The title is pulled out by its quotes before splitting on dashes, so a title that contains one is not cut in two.
    const tm = raw.match(/"([^"]{4,300})"/);
    const title = tm ? tm[1]!.trim() : '';
    const sans = tm ? raw.replace(tm[0], '') : raw;
    const segments = sans.split(/—|--/).map((s) => s.trim()).filter(Boolean);
    const nonUrl = segments.filter((s) => !/^https?:\/\//.test(s) && !/^(search|url|doi)\s*:/i.test(s));
    let authorsAndYear = nonUrl[0] || '';
    let venue = nonUrl[1] || '';
    if (approx) { authorsAndYear = (raw.match(/approximate:\s*([^—]+)/i) || [])[1] || raw; venue = ''; }
    const ym = authorsAndYear.match(/\b(19|20)\d{2}\b/);
    // An approximate tag can carry a year range ("Putnam, 1993-2002, social capital"): all of it goes, not just the first year.
    const cleaned = approx
      ? authorsAndYear.replace(/,?\s{0,20}\b(?:19|20)\d{2}(?:\s{0,20}[-–]\s{0,20}(?:19|20)?\d{2,4})?/g, '').replace(/\s{2,20}/g, ' ')
      : authorsAndYear.replace(/,?\s{0,20}\b(19|20)\d{2}\b/, '');
    const authors = trimBy(cleaned.replace(/^CITATION\s{0,20}—?\s{0,20}approximate:?\s{0,20}/i, ''), (c) => c === ',' || /\s/.test(c)) || 'Unknown';
    out.push({
      raw, tag: m[0], authors, year: ym ? ym[0] : 'n.d.', title, venue: venue.trim(), url: urlMatch ? urlMatch[0] : '',
      tier: approx ? 'approximate' : urlMatch && !/search:/i.test(raw) ? 'link' : 'search',
    });
  }
  return out;
}
