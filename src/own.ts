/* Own materials: your CV, your profile, your letters, as a place a citation can be found.
   A person's own publications sit in their own documents, and a check that sends them to a public index to be "verified" is
   both slow and a leak of what they wrote. `ownMaterials` is a citation source that reads works out of the text you give it
   and answers locally: no request is made. Put it first, and a citation the person's own materials list is confirmed there;
   the rest fall through to the public indexes as before.
     createAssay({ sources: [ownMaterials([cv, profile, letters]), ...defaultSources] })
   What it reads: the bracketed form the citations check reads, a reference line written the usual way
   ("Okafor, A. & Bello, B. (2019). Title of the work. Venue."), and a quoted title with a year and the author's name before it.
   Offline, and in the offline test. */
import { parseCitations } from './parse.js';
import type { SearchSource } from './sources.js';
import type { Candidate } from './types.js';

export interface OwnWork { title: string; /** Author surnames. */ authors: string[]; year: number }

const SURNAME = /\p{Lu}[\p{L}'’-]{2,30}/gu;
// Every quantifier is bounded, so none is quadratic on a long run of one character.
const REFERENCE_LINE = /([\p{Lu}][^()\n]{2,160}?)\s\(((?:1[89]|20)\d{2})[a-z]?\)[.,]?\s+([^\n.?!]{8,200})[.?!]/gu;
const QUOTED = /(.{0,100}?)[“"]([^”"\n]{8,200})[”"][^\n]{0,80}?\b((?:1[89]|20)\d{2})\b/gu;

const surnames = (s: string): string[] => [...new Set((s.match(SURNAME) ?? []).filter((w) => !/^(?:And|Et|Al|The|In|On)$/.test(w)))];
const clean = (t: string) => t.replace(/\s+/g, ' ').replace(/^[“"']+|[”"'.,;:]+$/g, '').trim();

/** The works named in some text, as author surnames, a year and a title. */
export function ownWorks(materials: string | string[]): OwnWork[] {
  const out: OwnWork[] = [];
  const seen = new Set<string>();
  const add = (title: string, authors: string[], year: number) => {
    const t = clean(title);
    const key = `${t.toLowerCase()}|${year}`;
    if (t.length >= 8 && authors.length && !seen.has(key)) { seen.add(key); out.push({ title: t, authors, year }); }
  };
  for (const text of Array.isArray(materials) ? materials : [materials]) {
    for (const c of parseCitations(text)) if (c.title) add(c.title, surnames(c.authors), Number(c.year) || 0);
    for (const m of text.matchAll(REFERENCE_LINE)) add(m[3] ?? '', surnames(m[1] ?? ''), Number(m[2]));
    for (const m of text.matchAll(QUOTED)) add(m[2] ?? '', surnames(m[1] ?? '').slice(-3), Number(m[3]));
  }
  return out;
}

/** A citation source that finds works in the text you give it and makes no request. Put it before the public indexes. */
export function ownMaterials(materials: string | string[], opts: { name?: string } = {}): SearchSource {
  const works = ownWorks(materials);
  const candidates: Candidate[] = works.map((w) => ({ title: w.title, authors: w.authors, year: w.year, doi: '', article: false, venue: '' }));
  return {
    name: opts.name ?? 'your own materials',
    authorMode: 'family',
    async search(q) {
      const want = new Set(q.title.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
      return { ok: true, candidates: candidates.filter((c) => (c.title.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).some((w) => want.has(w))) };
    },
  };
}
