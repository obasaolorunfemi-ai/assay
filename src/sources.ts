import type { Http, HttpResult } from './http.js';
import type { Candidate } from './types.js';
import { nameKey, mainTitle } from './text.js';

/** What a source is asked: a title, and the first author's surname as written. */
export interface SearchQuery { title: string; surname: string }
export interface SearchResult {
  /** False when the source could not be reached, was throttled, or answered with something that is not what it normally sends. That says nothing about the citation. */
  ok: boolean;
  candidates: Candidate[];
  /** What the source asked for, if it asked us to wait. */
  retryAfterMs?: number;
  /** Why it was not ok, in a few words (for `health()`). */
  problem?: string;
}
/** What a source is given besides the query. */
export interface SourceContext {
  /** Your address, for the services that ask for one (CrossRef, OpenAlex). Empty when none was given. */
  mailto: string;
  /** Optional keys by source name in lower case: `{ openalex: '…' }`. */
  keys: Record<string, string>;
}
/** A work that certainly exists, which a healthy source can find. Before a source's "not found" is believed, it is asked for this. */
export interface Canary { title: string; surname: string; authors: string[] }

/** A place that can be asked "is there a work with this title by this author?". Add your own by implementing this. */
export interface SearchSource {
  name: string;
  /** 'family' when `authors` are surnames (CrossRef), 'display' when they are full names (the default). */
  authorMode?: 'family' | 'display';
  /** A known work. Without one, the source's "no match" is believed as it stands. */
  canary?: Canary;
  search(q: SearchQuery, http: Http, ctx: SourceContext): Promise<SearchResult>;
}

const arr = (x: unknown): any[] => (Array.isArray(x) ? x : []);
const mail = (m: string) => (m ? `&mailto=${encodeURIComponent(m)}` : '');
export const openalexKey = (keys: Record<string, string>) => (keys.openalex ? `&api_key=${encodeURIComponent(keys.openalex)}` : '');

/** A source that did not answer properly. A reply that is not the shape the source normally sends (an HTML error page, a renamed field) is treated exactly like an outage: it must never read as "no results". */
export function failed(r: HttpResult, problem?: string): SearchResult {
  const why = problem ?? (r.networkError ? 'unreachable' : r.status === 429 ? 'rate limited (429)' : r.ok ? 'answered with something unexpected' : `HTTP ${r.status}`);
  return { ok: false, candidates: [], problem: why, ...(r.retryAfterMs !== undefined ? { retryAfterMs: r.retryAfterMs } : {}) };
}

/** CrossRef: the broadest index of journal articles. */
export const crossref: SearchSource = {
  name: 'CrossRef',
  authorMode: 'family',
  canary: { title: 'The Problem of Social Cost', surname: 'Coase', authors: ['Coase'] },
  async search(q, http, { mailto }) {
    const r = await http.json(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(q.title)}&rows=5${mail(mailto)}`);
    const items = (r.body as any)?.message?.items;
    if (!r.ok || !Array.isArray(items)) return failed(r);
    return {
      ok: true,
      candidates: items.map((it: any) => ({
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
  canary: { title: 'Attention Is All You Need', surname: 'Vaswani', authors: ['Vaswani'] },
  async search(q, http, { mailto, keys }) {
    const r = await http.json(`https://api.openalex.org/works?search=${encodeURIComponent(q.title)}&per_page=15${mail(mailto)}${openalexKey(keys)}`);
    const results = (r.body as any)?.results;
    if (!r.ok || !Array.isArray(results)) return failed(r);
    return {
      ok: true,
      candidates: results.map((it: any) => ({
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
  canary: { title: 'Why Nations Fail', surname: 'Acemoglu', authors: ['Daron Acemoglu'] },
  async search(q, http) {
    const r = await http.json(`https://openlibrary.org/search.json?title=${encodeURIComponent(mainTitle(q.title).trim())}&author=${encodeURIComponent(q.surname)}&limit=10&fields=title,author_name,first_publish_year`);
    const docs = (r.body as any)?.docs;
    if (!r.ok || !Array.isArray(docs)) return failed(r);
    return {
      ok: true,
      candidates: docs.map((d: any) => ({ title: d.title || '', authors: arr(d.author_name), year: d.first_publish_year || 0, doi: '', article: false, venue: '' })),
    };
  },
};

export const defaultSources: SearchSource[] = [crossref, openalex, openlibrary];

/** Do the candidate's authors include these surnames? Accents are folded. */
export function countAuthorMatches(surnames: string[], authors: string[], mode: 'family' | 'display'): number {
  const names = authors.map(nameKey).filter(Boolean);
  return surnames.filter((sn) => names.some((n) => (mode === 'family' ? n.includes(sn) || sn.includes(n) : n.includes(sn)))).length;
}
