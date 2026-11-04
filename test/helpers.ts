/** A fake network: the first route whose key is in the URL answers. 'throw' simulates being offline. Anything unmatched answers empty. */
export type Route = { status: number; body: unknown } | 'throw';
export function router(routes: Record<string, Route>) {
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
