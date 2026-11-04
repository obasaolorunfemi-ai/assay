// The live counter. A Worker with one job: add up numbers that apps choose to send, and show the totals.
//   POST /api/count   { v: 1, counts: { quotes: { checked, ok, check, failed }, ... } }   adds to the totals
//   GET  /api/count   the totals, as JSON
// It receives no text, keeps no addresses (an address is hashed with the day's date, held in memory only, to enforce a daily allowance, and forgotten), and only runs
// for /api/* : every other path is served straight from the static site.
import { CHECKS, LIMITS, allowance, applyReport, emptyTotals, parseReport, publicView } from './logic.mjs';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...CORS, ...extra } });

async function dayKey(request) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const day = new Date().toISOString().slice(0, 10);
  const bytes = new TextEncoder().encode(`${day}|${ip}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return { day, key: [...new Uint8Array(hash)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('') };
}

export class Counter {
  constructor(state) {
    this.state = state;
    this.totals = null;
    this.limit = { day: '', used: new Map() };
  }
  async load() {
    if (!this.totals) this.totals = (await this.state.storage.get('totals')) ?? emptyTotals();
    return this.totals;
  }
  async fetch(request) {
    const totals = await this.load();
    const path = new URL(request.url).pathname;
    if (path === '/get') return json(publicView(totals), 200, { 'cache-control': 'public, max-age=10' });
    if (path === '/add' && request.method === 'POST') {
      const { key, day, counts, total } = await request.json();
      if (!allowance(this.limit, key, total, day)) return json({ error: 'daily allowance for this source used up' }, 429);
      applyReport(totals, counts);
      await this.state.storage.put('totals', totals);
      return json({ ok: true }, 202);
    }
    return json({ error: 'not found' }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/count') return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const stub = env.COUNTER.get(env.COUNTER.idFromName('global'));
    if (request.method === 'GET') return stub.fetch('https://counter/get');
    if (request.method !== 'POST') return json({ error: 'use GET or POST' }, 405, { allow: 'GET, POST, OPTIONS' });
    if (!/^application\/json/i.test(request.headers.get('content-type') || '')) return json({ error: 'send application/json' }, 415);
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > LIMITS.bodyBytes) return json({ error: 'too large' }, 413);
    const text = await request.text();
    if (text.length > LIMITS.bodyBytes) return json({ error: 'too large' }, 413);
    const parsed = parseReport(text);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const { day, key } = await dayKey(request);
    return stub.fetch('https://counter/add', { method: 'POST', body: JSON.stringify({ key, day, counts: parsed.counts, total: parsed.total }) }).then((r) => new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS } }));
  },
};
export { CHECKS };
