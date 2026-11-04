import type { Tally } from './tally.js';
/* Links: is this page really there?
   SERVER-SIDE ONLY (Node, Bun, Deno: it uses node:http, node:https and node:dns). It is not available to browser bundles, on purpose: it makes requests to URLs that come out
   of AI text, and a crafted link must never be able to make YOUR server reach your own network or your cloud's metadata service. So:
   - the address that is checked is the address that is connected to: every address a name resolves to is validated inside the lookup the connection itself uses, so a name that
     answers "public" to a check and "private" to the connection (DNS rebinding) is refused;
   - redirects are followed by hand, and every hop is checked again, from the URL down;
   - only http and https, ordinary ports, no credentials in the URL, no local or single-label names, and only public IP addresses (see `netguard`);
   - bounded: a time limit per request, a limit on redirects, at most a few requests to one host at a time, a cap on the URLs per call, and only the start of a page is ever read.
   It says whether a page is THERE, not whether it says what a citation claims. A site that blocks automated requests is "blocked", never "broken". */
import * as dns from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import type { Bucket, Summary } from './types.js';
import { createHealthBook, type BreakerOptions } from './health.js';
import { checkUrl, isSafeAddress, parseIPv4, parseIPv6, type UrlDecision } from './netguard.js';
import { summarizeBuckets } from './summary.js';

export { checkUrl, isSafeAddress } from './netguard.js';

export type LinkStatus = 'live' | 'soft404' | 'broken' | 'blocked' | 'unreachable' | 'unsafe' | 'limit';

export interface LinkVerdict {
  url: string;
  status: LinkStatus;
  /** live: ok. soft404, blocked, unreachable, limit: check. broken and unsafe: failed. */
  bucket: Bucket;
  message: string;
  httpStatus?: number;
  /** Where it ended up after redirects, when that differs. */
  finalUrl?: string;
  hops: number;
  /** True when asking again later may settle it. */
  retryable: boolean;
  retryAfterMs?: number;
}
export interface LinkReport { verdicts: LinkVerdict[]; summary: Summary; ok: boolean }

export interface LinkOptions {
  /** Count what this checker finds in a `Tally` of your own (numbers only). Nothing is sent anywhere: see `shareTally` if you choose to share the counts. */
  tally?: Tally;
  /** Per request. Default 5 seconds. */
  timeoutMs?: number;
  /** Redirects followed. Default 5. */
  maxHops?: number;
  /** The most URLs checked in one call; the rest come back as `limit`. Default 25. */
  maxUrls?: number;
  /** Requests at once, in all. Default 6. */
  concurrency?: number;
  /** Requests at once to one host. Default 2: a page of citations to one publisher must not hammer it. */
  perHostConcurrency?: number;
  /** Ports that may be connected to. Default 80 and 443. */
  allowPorts?: number[];
  /** Sent with each request. The default says what this is. Some publishers block anything that is not a browser: that comes back as `blocked`, not `broken`. */
  userAgent?: string;
  /** Also fetch the start of a page that answered, and call it `soft404` if its title says it is not there. Default false. */
  checkTitles?: boolean;
  /** How much of a page is read at most. Default 24,000 characters. */
  maxBodyChars?: number;
  /** Wait before the one retry after a network error. Default 300 to 600 ms. */
  retryDelayMs?: number;
  breaker?: BreakerOptions;
  /** FOR TESTS ONLY. Replaces the URL and address rules, which is exactly what makes a server safe to point at text it did not write. Never use this with links from a model or a user. */
  unsafeOverrides?: { url?: (raw: string) => UrlDecision; address?: (ip: string) => boolean; lookup?: typeof dns.lookup };
  now?: () => number;
}

export interface LinkChecker {
  checkOne(url: string): Promise<LinkVerdict>;
  check(urls: string[]): Promise<LinkReport>;
  /** Checks again what could not be settled (blocked, unreachable, limit), keeping the rest. */
  recheck(report: LinkReport): Promise<LinkReport>;
}

const BUCKET: Record<LinkStatus, Bucket> = { live: 'ok', soft404: 'check', broken: 'failed', blocked: 'check', unreachable: 'check', unsafe: 'failed', limit: 'check' };

// A path segment that means "this page isn't here", and the <title> of a not-found page. "Access Denied" is deliberately absent: it is a bot block, which says nothing about whether the page exists.
const ERRORISH_SEGMENT_RE = /(?:^|\/)(?:404|not-?found|page-?not-?found|error|errors|oops|unavailable|no-?results?|search)(?:\/|$|\.)/i;
const NOT_FOUND_TITLE_RE = /\b(?:404|not found|page (?:could ?n[o']t|can ?n[o']t|doesn[’']?t|does not) (?:be )?(?:found|exist)|no longer (?:available|exists)|we can[’']?t find|page missing)\b/i;
const pathOf = (u: string) => { try { return new URL(u).pathname.toLowerCase(); } catch { return ''; } };
const isHomeish = (p: string) => p === '' || p === '/' || /^\/[a-z]{2}(?:-[a-z]{2})?\/?$/.test(p);

/** A request that "succeeded" but landed somewhere that says the page is not there: a deep link bounced to the home page, or to an error page. */
export function looksLikeSoft404(requested: string, final: string): boolean {
  if (!final || final === requested) return false;
  const want = pathOf(requested), got = pathOf(final);
  if (!isHomeish(want) && isHomeish(got)) return true;
  const segment = (p: string) => (p.match(ERRORISH_SEGMENT_RE) || [])[0];
  const landed = segment(got);
  return Boolean(landed) && landed !== segment(want);
}

type Hop =
  | { kind: 'response'; status: number; headers: http.IncomingHttpHeaders; head: string }
  | { kind: 'unsafe'; reason: string }
  | { kind: 'network'; message: string };

const unsafeError = () => Object.assign(new Error('refused: the address is not a public one'), { code: 'EUNSAFE' });

export function createLinkChecker(opts: LinkOptions = {}): LinkChecker {
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 5000, maxHops = opts.maxHops ?? 5, maxUrls = Math.max(1, opts.maxUrls ?? 25), maxBody = opts.maxBodyChars ?? 24_000;
  const ua = opts.userAgent ?? 'Mozilla/5.0 (compatible; AssayLinkCheck/0.3; +https://github.com/obasaolorunfemi-ai/assay)';
  const addressOk = opts.unsafeOverrides?.address ?? isSafeAddress;
  const urlPolicy = opts.unsafeOverrides?.url ?? ((raw: string) => checkUrl(raw, { allowPorts: opts.allowPorts }));
  const baseLookup = opts.unsafeOverrides?.lookup ?? dns.lookup;
  const health = createHealthBook({ ...opts.breaker, now });

  // Every address the name resolves to is checked HERE, in the lookup the connection uses. There is no separate check followed by a second resolution, so there is nothing to race.
  const guardedLookup = ((hostname: string, options: dns.LookupOptions | number | undefined, cb: (...a: unknown[]) => void) => {
    const o = typeof options === 'object' && options ? options : {};
    (baseLookup as unknown as (h: string, o: unknown, cb: (e: Error | null, a: unknown, f?: number) => void) => void)(hostname, { ...o, all: true }, (err, addrs, fam) => {
      if (err) return cb(err);
      const list = Array.isArray(addrs) ? (addrs as Array<{ address: string; family: number }>) : [{ address: String(addrs), family: fam ?? 4 }];
      if (!list.length) return cb(new Error('no address'));
      if (list.some((a) => !addressOk(a.address))) return cb(unsafeError());
      if (o.all) cb(null, list); else cb(null, list[0]!.address, list[0]!.family);
    });
  }) as unknown as typeof dns.lookup;

  function hop(url: URL, method: 'HEAD' | 'GET'): Promise<Hop> {
    return new Promise((resolve) => {
      const host = url.hostname.replace(/^\[|\]$/g, '');
      // A literal address never goes through a lookup, so it is checked here, before any socket exists.
      if ((parseIPv4(host) || parseIPv6(host)) && !addressOk(host)) return resolve({ kind: 'unsafe', reason: 'the address is not a public one' });
      const mod = url.protocol === 'https:' ? https : http;
      let settled = false;
      const done = (h: Hop) => { if (!settled) { settled = true; resolve(h); } };
      const req = mod.request({
        protocol: url.protocol, hostname: host, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: `${url.pathname}${url.search}`, method,
        headers: { 'user-agent': ua, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-encoding': 'identity', connection: 'close' },
        lookup: guardedLookup, agent: false, timeout: timeoutMs,
      }, (res) => {
        const status = res.statusCode ?? 0;
        if (method === 'HEAD' || status < 200 || status >= 300 || !opts.checkTitles) { res.destroy(); return done({ kind: 'response', status, headers: res.headers, head: '' }); }
        // Only the start of a page is ever read, then the connection is dropped.
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { body += chunk; if (body.length >= maxBody) { res.destroy(); done({ kind: 'response', status, headers: res.headers, head: body.slice(0, maxBody) }); } });
        res.on('end', () => done({ kind: 'response', status, headers: res.headers, head: body.slice(0, maxBody) }));
        res.on('error', () => done({ kind: 'response', status, headers: res.headers, head: body.slice(0, maxBody) }));
      });
      req.on('timeout', () => { req.destroy(new Error('timed out')); });
      req.on('error', (e: NodeJS.ErrnoException) => done(e.code === 'EUNSAFE' ? { kind: 'unsafe', reason: 'the name resolves to a private or reserved address' } : { kind: 'network', message: e.message || e.code || 'network error' }));
      req.end();
    });
  }

  async function hopRetry(url: URL, method: 'HEAD' | 'GET'): Promise<Hop> {
    const first = await hop(url, method);
    if (first.kind !== 'network') return first;
    // A dropped connection or a timeout may be a blip: one more try, shortly after. A clean HTTP answer (even a 404) is never retried.
    await new Promise((go) => setTimeout(go, opts.retryDelayMs ?? 300 + Math.random() * 300));
    return hop(url, method);
  }

  // Limits: in all, and per host.
  const gate = (limit: number) => { let n = 0; const q: Array<() => void> = []; return async <T>(f: () => Promise<T>): Promise<T> => { if (n >= limit) await new Promise<void>((go) => q.push(go)); n++; try { return await f(); } finally { n--; q.shift()?.(); } }; };
  const overall = gate(Math.max(1, opts.concurrency ?? 6));
  const hostGates = new Map<string, ReturnType<typeof gate>>();
  const perHost = (h: string) => { let g = hostGates.get(h); if (!g) { g = gate(Math.max(1, opts.perHostConcurrency ?? 2)); hostGates.set(h, g); } return g; };

  const verdict = (url: string, status: LinkStatus, message: string, extra: Partial<LinkVerdict> = {}): LinkVerdict =>
    ({ url, status, bucket: BUCKET[status], message, hops: 0, retryable: status === 'blocked' || status === 'unreachable' || status === 'limit', ...extra });

  async function checkOne(raw: string): Promise<LinkVerdict> {
    let current = String(raw ?? '').trim();
    for (let hops = 0; hops <= maxHops; hops++) {
      const d = urlPolicy(current);
      if (!d.ok) return verdict(raw, 'unsafe', `Not fetched: ${d.reason}.`, { hops, retryable: false, ...(hops ? { finalUrl: current } : {}) });
      const host = d.host;
      if (!health.allow(host)) return verdict(raw, 'unreachable', `${host} is being given time to recover, so it was not asked just now.`, { hops });
      let res = await overall(() => perHost(host)(() => hopRetry(d.url, 'HEAD')));
      // Some hosts answer HEAD wrongly or refuse it: a non-OK HEAD is confirmed with GET before any conclusion is drawn. A throttled host (429, 503) is not asked again.
      if (res.kind === 'response' && res.status >= 400 && res.status !== 429 && res.status !== 503) res = await overall(() => perHost(host)(() => hopRetry(d.url, 'GET')));
      else if (res.kind === 'response' && res.status >= 200 && res.status < 300 && opts.checkTitles) res = await overall(() => perHost(host)(() => hopRetry(d.url, 'GET')));
      if (res.kind === 'unsafe') return verdict(raw, 'unsafe', `Not fetched: ${res.reason}.`, { hops, retryable: false });
      if (res.kind === 'network') { health.failure(host, res.message); return verdict(raw, 'unreachable', `Could not reach ${host} (${res.message}). This says nothing about whether the page exists.`, { hops }); }
      health.success(host);
      const { status } = res;
      if (status >= 300 && status < 400) {
        const loc = res.headers.location;
        if (!loc) return verdict(raw, 'blocked', `Redirected (${status}) with nowhere to go.`, { hops, httpStatus: status });
        try { current = new URL(Array.isArray(loc) ? loc[0]! : loc, d.url).toString(); } catch { return verdict(raw, 'blocked', 'Redirected to something that is not a URL.', { hops, httpStatus: status }); }
        continue;                                                   // checked again, from the top, as a new URL
      }
      const final = hops ? { finalUrl: current } : {};
      if (status >= 200 && status < 300) {
        const title = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(res.head)?.[1] ?? '';
        if (looksLikeSoft404(raw, current) || (opts.checkTitles && NOT_FOUND_TITLE_RE.test(title))) {
          return verdict(raw, 'soft404', `The page answered, but it landed on ${looksLikeSoft404(raw, current) ? 'a page that is not the one linked (the home page or an error page)' : `a page titled "${title.trim().slice(0, 80)}"`}. It is probably gone.`, { hops, httpStatus: status, ...final });
        }
        return verdict(raw, 'live', hops ? `The page is there (after ${hops} redirect${hops === 1 ? '' : 's'}).` : 'The page is there.', { hops, httpStatus: status, ...final });
      }
      if (status === 404 || status === 410) return verdict(raw, 'broken', `The page is not there (HTTP ${status}).`, { hops, httpStatus: status, retryable: false, ...final });
      // Anything else (401, 403, 429, 5xx) is the site refusing or struggling, which is not evidence the page does not exist. A throttled host is left alone until it says it is ready.
      const ra = Number(res.headers['retry-after']);
      const retryAfterMs = (status === 429 || status === 503) && Number.isFinite(ra) && ra >= 0 ? ra * 1000 : undefined;
      if (status === 429 || status === 503) health.failure(host, `HTTP ${status}`, retryAfterMs);
      return verdict(raw, 'blocked', `The site would not say (HTTP ${status}). That is bot protection or a busy server, not evidence that the page is missing: open it to confirm.`, { hops, httpStatus: status, ...final, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) });
    }
    return verdict(raw, 'blocked', `Too many redirects (more than ${maxHops}), so it was not followed to the end.`, { hops: maxHops });
  }

  const report = (verdicts: LinkVerdict[]): LinkReport => {
    const summary = summarizeBuckets(verdicts.map((v) => v.bucket), { label: 'Links', ok: 'live', check: 'to check', failed: 'broken or refused', failedTail: ' — do not present them as sources.' });
    return { verdicts, summary, ok: summary.failed === 0 };
  };

  async function check(urls: string[]): Promise<LinkReport> {
    const unique = [...new Set((Array.isArray(urls) ? urls : []).map((u) => String(u ?? '').trim()).filter(Boolean))];
    const rep = report(await Promise.all(unique.map((u, i) => (i < maxUrls ? checkOne(u) : Promise.resolve(verdict(u, 'limit', `Not checked: more than ${maxUrls} links in one call, so the rest were left alone rather than requested.`))))));
    opts.tally?.add('links', rep);
    return rep;
  }

  async function recheck(r: LinkReport): Promise<LinkReport> {
    let budget = maxUrls;
    return report(await Promise.all(r.verdicts.map((v) => (v.retryable && budget-- > 0 ? checkOne(v.url) : Promise.resolve(v)))));
  }

  return { checkOne, check, recheck };
}
