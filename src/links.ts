import type { Http } from './http.js';
import type { Citation } from './types.js';
import { titleSimilarity, TITLE_MATCH_THRESHOLD } from './text.js';
import { cap, trimEndBy } from './strutil.js';

export const DOI_PATTERN = /10\.\d{4,9}\/[^\s"<>\]]+/i;
const encDoi = (d: string) => encodeURIComponent(d).replace(/%2F/gi, '/');

export function doiFromUrl(url: string): string {
  const m = cap(url || '', 2000).match(/doi\.org\/(10\.\d{4,9}\/[^\s"<>\]]{1,500})/i);
  return m ? trimEndBy(m[1]!, (c) => '.,;:)'.includes(c)) : '';
}

export type LinkKind = { kind: 'none' | 'search' | 'direct' } | { kind: 'doi'; doi: string } | { kind: 'pubmed'; pmid: string };

/**
 * What a link in a citation stands for. A doi.org link is a DOI; an SSRN abstract and an arXiv paper have one by construction
 * (10.2139/ssrn.N, 10.48550/arXiv.ID); a PubMed link is a PMID. A Google Scholar search link cannot be wrong. Any other direct
 * link cannot be read from a browser (the sites do not allow it), so it is reported as not checked.
 */
export function linkKind(url: string): LinkKind {
  url = cap(url || '', 2000);
  if (!url) return { kind: 'none' };
  if (/scholar\.google\.[a-z.]{1,30}\/scholar\?/i.test(url)) return { kind: 'search' };
  const d = doiFromUrl(url);
  if (d) return { kind: 'doi', doi: d };
  let m = url.match(/ssrn\.com\/(?:[^\s"]{0,300}?)abstract(?:_id)?=(\d{4,9})/i);
  if (m) return { kind: 'doi', doi: '10.2139/ssrn.' + m[1] };
  m = url.match(/arxiv\.org\/(?:abs|pdf)\/([a-z-]+\/\d{7}|\d{4}\.\d{4,5})/i);
  if (m) return { kind: 'doi', doi: '10.48550/arXiv.' + m[1] };
  m = url.match(/(?:pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pubmed)\/(\d{1,9})/i);
  if (m) return { kind: 'pubmed', pmid: m[1]! };
  return { kind: 'direct' };
}

/** The record a DOI resolved to, when we could read it: what year and journal it is really in. */
export interface LinkRecord { year: number; venue: string; article: boolean }
export type LinkState = { state: 'none' | 'direct' | 'unchecked' | 'dead' } | { state: 'ok'; record?: LinkRecord } | { state: 'wrong'; title: string };

/**
 * A model that cannot recall a DOI makes one up that looks right, and the title check would still say "verified" because the
 * paper itself exists. So the link it gave is looked up too. CrossRef holds the record; a 404 there is asked of doi.org, which
 * knows every registrar, and then of DataCite (arXiv, Zenodo), so a real non-CrossRef DOI is compared by title, not called wrong.
 */
export async function checkLink(c: Citation, http: Http, mailto: string): Promise<LinkState> {
  const k = linkKind(c.url);
  if (k.kind === 'none' || k.kind === 'search') return { state: 'none' };
  if (k.kind === 'direct') return { state: 'direct' };
  const cmp = (t: string | undefined, record?: LinkRecord): LinkState => (titleSimilarity(c.title, t || '') >= TITLE_MATCH_THRESHOLD ? { state: 'ok', ...(record ? { record } : {}) } : { state: 'wrong', title: t || '' });
  if (k.kind !== 'doi' && k.kind !== 'pubmed') return { state: 'unchecked' };
  if (k.kind === 'pubmed') {
    const r = await http.json(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${k.pmid}`);
    if (!r.ok) return { state: 'unchecked' };
    const rec = (r.body as any)?.result?.[k.pmid];
    return !rec || rec.error || !rec.title ? { state: 'dead' } : cmp(rec.title);
  }
  const cr = await http.json(`https://api.crossref.org/works/${encDoi(k.doi)}${mailto ? `?mailto=${encodeURIComponent(mailto)}` : ''}`);
  if (cr.status === 200) {
    const m = (cr.body as any)?.message;
    return cmp(m?.title?.[0], { year: m?.issued?.['date-parts']?.[0]?.[0] || 0, venue: m?.['container-title']?.[0] || '', article: m?.type === 'journal-article' });
  }
  if (cr.status === 404) {
    // doi.org answers a DOI that does not exist with HTTP 404 and {responseCode:100}, so the body is read whatever the status
    const h = await http.json(`https://doi.org/api/handles/${encDoi(k.doi)}`);
    const code = (h.body as any)?.responseCode;
    if (code !== 1) return code === 100 ? { state: 'dead' } : { state: 'unchecked' };
    const dc = await http.json(`https://api.datacite.org/dois/${encDoi(k.doi)}`);
    if (!dc.ok) return { state: 'unchecked' };
    const t = (dc.body as any)?.data?.attributes?.titles?.[0]?.title;
    return t ? cmp(t) : { state: 'unchecked' };
  }
  return { state: 'unchecked' };
}
