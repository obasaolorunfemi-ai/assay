/** A fake network: the first route whose key is in the URL answers. 'throw' simulates being offline. Anything unmatched answers empty. */
export type Route = { status: number; body: unknown } | 'throw';
/** What each source's self-test asks for, answered correctly: a healthy network. Listed first, so an ordinary route cannot swallow it. */
export const CANARY_ROUTES: Record<string, Route> = {
  'api.crossref.org/works?query.bibliographic=The%20Problem%20of%20Social%20Cost': { status: 200, body: { message: { items: [{ title: ['The Problem of Social Cost'], author: [{ family: 'Coase' }], DOI: '10.1086/466560', type: 'journal-article', issued: { 'date-parts': [[1960]] }, 'container-title': ['The Journal of Law and Economics'] }] } } },
  'api.openalex.org/works?search=Attention%20Is%20All%20You%20Need': { status: 200, body: { results: [{ title: 'Attention Is All You Need', authorships: [{ author: { display_name: 'Ashish Vaswani' } }], doi: '', publication_year: 2017 }] } },
  'openlibrary.org/search.json?title=Why%20Nations%20Fail&author=Acemoglu': { status: 200, body: { docs: [{ title: 'Why Nations Fail', author_name: ['Daron Acemoglu', 'James A. Robinson'], first_publish_year: 2012 }] } },
};
export function router(routes: Record<string, Route>, opts: { canaries?: boolean } = {}) {
  routes = opts.canaries === false ? routes : { ...CANARY_ROUTES, ...routes };
  const calls: string[] = [];
  const f = (async (url: string | URL) => {
    const u = String(url);
    calls.push(u);
    for (const [k, v] of Object.entries(routes)) {
      if (!u.includes(k)) continue;
      if (v === 'throw') throw new TypeError('offline');
      return { ok: v.status >= 200 && v.status < 300, status: v.status, json: async () => v.body } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ message: { items: [] }, results: [], docs: [] }) } as Response;
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}
export const cr = (...items: unknown[]) => ({ status: 200, body: { message: { items } } });
export const crItem = (title: string, families: string[], doi = '', extra: Record<string, unknown> = {}) => ({ title: [title], author: families.map((family) => ({ family })), DOI: doi, ...extra });
export const oa = (...results: unknown[]) => ({ status: 200, body: { results } });
export const oaWork = (title: string, name: string, extra: Record<string, unknown> = {}) => ({ title, authorships: [{ author: { display_name: name } }], doi: '', ...extra });
export const ol = (...docs: unknown[]) => ({ status: 200, body: { docs } });
