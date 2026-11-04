import type { Http } from './http.js';
import type { Candidate } from './types.js';
import { nameKey, mainTitle } from './text.js';

/** What a source is asked: a title, and the first author's surname as written. */
export interface SearchQuery { title: string; surname: string }
/** What a source is given besides the query. */
export interface SourceContext {
  /** Your address, for the services that ask for one (CrossRef, OpenAlex). Empty when none was given. */
  mailto: string;
  /** Optional keys by source name in lower case: `{ openalex: '…' }`. */
  keys: Record<string, string>;
}
export interface SearchResult {
  /** False when the source could not be reached or was throttled: that says nothing about the citation. */
  ok: boolean;
  candidates: Candidate[];
}
/** A place that can be asked "is there a work with this title by this author?". Add your own by implementing this. */
export interface SearchSource {
  name: string;
  /** 'family' when `authors` are surnames (CrossRef), 'display' when they are full names (the default). */
  authorMode?: 'family' | 'display';
  search(q: SearchQuery, http: Http, ctx: SourceContext): Promise<SearchResult>;
}

const arr = (x: unknown): any[] => (Array.isArray(x) ? x : []);
const mail = (m: string) => (m ? `&mailto=${encodeURIComponent(m)}` : '');
export const openalexKey = (keys: Record<string, string>) => (keys.openalex ? `&api_key=${encodeURIComponent(keys.openalex)}` : '');

/** CrossRef: the broadest index of journal articles. */
export const crossref: SearchSource = {
  name: 'CrossRef',
  authorMode: 'family',
  async search(q, http, { mailto }) {
    const r = await http.json(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(q.title)}&rows=5${mail(mailto)}`);
    if (!r.ok) return { ok: false, candidates: [] };
    const items = arr((r.body as any)?.message?.items);
    return {
      ok: true,
      candidates: items.map((it) => ({
        title: arr(it.title)[0] || '',
        authors: arr(it.author).map((a) => a.family || '').filter(Boolean),
        year: it.issued?.['date-parts']?.[0]?.[0] || 0,
        doi: it.DOI || '',
        article: it.type === 'journal-article',
        venue: arr(it['container-title'])[0] || '',
      })),
    };
  },
};

/** OpenAlex: stronger on books and working papers. Asked for 15 results because a book can rank fifth. */
export const openalex: SearchSource = {
  name: 'OpenAlex',
  async search(q, http, { mailto, keys }) {
    const r = await http.json(`https://api.openalex.org/works?search=${encodeURIComponent(q.title)}&per_page=15${mail(mailto)}${openalexKey(keys)}`);
    if (!r.ok) return { ok: false, candidates: [] };
    return {
      ok: true,
      candidates: arr((r.body as any)?.results).map((it) => ({
        title: it.title || '',
        authors: arr(it.authorships).map((a) => a.author?.display_name || '').filter(Boolean),
        year: it.publication_year || 0,
        doi: String(it.doi || '').replace(/^https?:\/\/doi\.org\//i, ''),
        article: it.type === 'article',
        venue: it.primary_location?.source?.display_name || '',
      })),
    };
  },
};

/** Open Library: a free catalogue of books, which neither journal index holds under the book's own title. */
export const openlibrary: SearchSource = {
  name: 'Open Library',
  async search(q, http) {
    const r = await http.json(`https://openlibrary.org/search.json?title=${encodeURIComponent(mainTitle(q.title).trim())}&author=${encodeURIComponent(q.surname)}&limit=10&fields=title,author_name,first_publish_year`);
    if (!r.ok) return { ok: false, candidates: [] };
    return {
      ok: true,
      candidates: arr((r.body as any)?.docs).map((d) => ({
        title: d.title || '', authors: arr(d.author_name), year: d.first_publish_year || 0, doi: '', article: false, venue: '',
      })),
    };
  },
};

export const defaultSources: SearchSource[] = [crossref, openalex, openlibrary];

/** Do the candidate's authors include these surnames? Accents are folded. */
export function countAuthorMatches(surnames: string[], authors: string[], mode: 'family' | 'display'): number {
  const names = authors.map(nameKey).filter(Boolean);
  return surnames.filter((sn) => names.some((n) => (mode === 'family' ? n.includes(sn) || sn.includes(n) : n.includes(sn)))).length;
}
