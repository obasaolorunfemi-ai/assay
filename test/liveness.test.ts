import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createLinkChecker, looksLikeSoft404, type LinkOptions } from '../src/liveness.js';
import { checkUrl, isSafeAddress } from '../src/netguard.js';

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, hit: { n: number; methods: string[] }) => void;
const open: http.Server[] = [];
async function serve(handler: Handler) {
  const hit = { n: 0, methods: [] as string[] };
  const server = http.createServer((req, res) => { hit.n++; hit.methods.push(`${req.method} ${req.url}`); handler(req, res, hit); });
  await new Promise<void>((go) => server.listen(0, '127.0.0.1', go));
  open.push(server);
  const port = (server.address() as AddressInfo).port;
  return { port, hit, base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((go) => { server.closeAllConnections?.(); server.close(() => go()); }) };
}
afterEach(async () => { await Promise.all(open.splice(0).map((s) => new Promise<void>((go) => { s.closeAllConnections?.(); s.close(() => go()); }))); });

// FOR TESTS: loopback is allowed so a local server can be reached. Every OTHER address and URL still goes through the real rules.
const LOOPBACK = '127.0.0.1';
const testOverrides: NonNullable<LinkOptions['unsafeOverrides']> = {
  url: (raw) => { try { const u = new URL(raw); if (u.hostname === LOOPBACK && (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password) return { ok: true, url: u, host: LOOPBACK }; } catch { /* fall through to the real rules */ } return checkUrl(raw); },
  address: (ip) => ip === LOOPBACK || isSafeAddress(ip),
};
const checker = (extra: LinkOptions = {}) => createLinkChecker({ unsafeOverrides: testOverrides, retryDelayMs: 0, timeoutMs: 1500, ...extra });

describe('the real rules, with no overrides', () => {
  it('refuses a link to a local server and never connects to it', async () => {
    const s = await serve((_q, r) => r.end('secret'));
    for (const u of [`${s.base}/`, `http://localhost:${s.port}/`, `http://[::1]:${s.port}/`, `http://2130706433:${s.port}/`, `http://0x7f.1:${s.port}/`, `http://[::ffff:7f00:1]:${s.port}/`]) {
      const v = await createLinkChecker({ retryDelayMs: 0 }).checkOne(u);
      expect(v, u).toMatchObject({ status: 'unsafe', bucket: 'failed', retryable: false });
    }
    expect(s.hit.n).toBe(0);
  });

  it('refuses a public-looking NAME that resolves to a private address, at the moment of connecting (DNS rebinding)', async () => {
    const s = await serve((_q, r) => r.end('internal'));
    let lookups = 0;
    const rebind = ((_h: string, _o: unknown, cb: (e: Error | null, a: unknown) => void) => { lookups++; cb(null, [{ address: '127.0.0.1', family: 4 }]); }) as never;
    // the name passes the URL rules (it is an ordinary public-looking name on port 80...) but the address it resolves to is loopback
    const v = await createLinkChecker({ retryDelayMs: 0, unsafeOverrides: { lookup: rebind, url: (raw) => ({ ok: true, url: new URL(raw), host: 'rebind.example.com' }) } }).checkOne(`http://rebind.example.com:${s.port}/`);
    expect(v).toMatchObject({ status: 'unsafe', bucket: 'failed' });
    expect(lookups).toBe(1);
    expect(s.hit.n).toBe(0);
  });

  it('refuses a name when ANY address it resolves to is private (a mixed answer)', async () => {
    const s = await serve((_q, r) => r.end('x'));
    const mixed = ((_h: string, _o: unknown, cb: (e: Error | null, a: unknown) => void) => cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }])) as never;
    const v = await createLinkChecker({ retryDelayMs: 0, unsafeOverrides: { lookup: mixed, url: (raw) => ({ ok: true, url: new URL(raw), host: 'mixed.example.com' }) } }).checkOne(`http://mixed.example.com:${s.port}/`);
    expect(v.status).toBe('unsafe');
    expect(s.hit.n).toBe(0);
  });

  it('refuses credentials, odd schemes, and internal names, without any request', async () => {
    const c = createLinkChecker({ retryDelayMs: 0 });
    for (const u of ['https://user:pw@example.com/', 'file:///etc/passwd', 'ftp://example.com/x', 'http://metadata.google.internal/', 'http://169.254.169.254/latest/meta-data/', 'http://intranet/', 'https://example.com:6379/']) expect((await c.checkOne(u)).status, u).toBe('unsafe');
  });
});

describe('what a live server says', () => {
  it('200 is live; 404 and 410 are broken (the page is not there)', async () => {
    const s = await serve((q, r) => { r.statusCode = q.url === '/gone' ? 410 : q.url === '/missing' ? 404 : 200; r.end('x'); });
    const rep = await checker().check([`${s.base}/ok`, `${s.base}/missing`, `${s.base}/gone`]);
    expect(rep.verdicts.map((v) => [v.status, v.bucket, v.httpStatus])).toEqual([['live', 'ok', 200], ['broken', 'failed', 404], ['broken', 'failed', 410]]);
    expect(rep.summary.text).toBe('Links: 3 · ✓ 1 live · ✕ 2 broken or refused — do not present them as sources.');
    expect(rep.ok).toBe(false);
  });

  it('403, 401 and 500 are "blocked": a site refusing is not evidence the page is missing', async () => {
    const s = await serve((q, r) => { r.statusCode = Number(q.url!.slice(1)); r.end('x'); });
    const rep = await checker().check([`${s.base}/403`, `${s.base}/401`, `${s.base}/500`]);
    expect(rep.verdicts.every((v) => v.status === 'blocked' && v.bucket === 'check' && v.retryable)).toBe(true);
    expect(rep.verdicts[0]!.message).toMatch(/bot protection or a busy server/);
  });

  it('confirms a non-OK HEAD with GET before concluding anything', async () => {
    const s = await serve((q, r) => { if (q.method === 'HEAD') { r.statusCode = q.url === '/head405' ? 405 : 404; return r.end(); } r.end('real page'); });
    const rep = await checker().check([`${s.base}/head405`, `${s.base}/head404`]);
    expect(rep.verdicts.map((v) => v.status)).toEqual(['live', 'live']);
    expect(s.hit.methods).toEqual(expect.arrayContaining(['HEAD /head405', 'GET /head405', 'HEAD /head404', 'GET /head404']));
  });

  it('a throttled host (429 with Retry-After) is not asked again, and the wait is reported', async () => {
    const s = await serve((_q, r) => { r.statusCode = 429; r.setHeader('retry-after', '120'); r.end(); });
    const c = checker();
    const first = await c.checkOne(`${s.base}/a`);
    expect(first).toMatchObject({ status: 'blocked', httpStatus: 429, retryAfterMs: 120_000 });
    const before = s.hit.n;
    const second = await c.checkOne(`${s.base}/b`);
    expect(second).toMatchObject({ status: 'unreachable' });
    expect(second.message).toMatch(/given time to recover/);
    expect(s.hit.n).toBe(before);                                    // no request was made
  });

  it('retries one dropped connection, and says "unreachable" when the host really is not there', async () => {
    let n = 0;
    const flaky = await serve((q, r) => { if (n++ === 0) return q.socket.destroy(); r.end('ok'); });
    expect((await checker().checkOne(`${flaky.base}/x`)).status).toBe('live');
    const dead = await serve((_q, r) => r.end());
    const url = `${dead.base}/x`; await dead.close();
    const v = await checker().checkOne(url);
    expect(v).toMatchObject({ status: 'unreachable', bucket: 'check', retryable: true });
    expect(v.message).toMatch(/says nothing about whether the page exists/);
  });

  it('a host that drops HEAD but answers GET is "live", not "unreachable"', async () => {
    const s = await serve((q, r) => { if (q.method === 'HEAD') return q.socket.destroy(); r.setHeader('content-type', 'text/html'); r.end('<title>Indicator</title>'); });
    const v = await checker().checkOne(`${s.base}/indicator`);
    expect(v).toMatchObject({ status: 'live', bucket: 'ok' });
    expect(s.hit.methods.some((m) => m.startsWith('GET'))).toBe(true);
  });

  it('is still "unreachable" when the GET fails too', async () => {
    const s = await serve((q) => q.socket.destroy());
    const v = await checker().checkOne(`${s.base}/x`);
    expect(v).toMatchObject({ status: 'unreachable', bucket: 'check', retryable: true });
  });

  it('a server that never answers is "unreachable" after the time limit', async () => {
    const s = await serve(() => { /* never responds */ });
    const t = Date.now();
    const v = await checker({ timeoutMs: 150 }).checkOne(`${s.base}/x`);
    expect(v.status).toBe('unreachable');
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe('redirects are followed by hand, and every hop is checked again', () => {
  it('follows a redirect, absolute or relative, and reports where it ended', async () => {
    const s = await serve((q, r) => { if (q.url === '/old') { r.statusCode = 301; r.setHeader('location', '/mid'); return r.end(); } if (q.url === '/mid') { r.statusCode = 302; r.setHeader('location', `http://127.0.0.1:${(q.socket.localPort)}/new`); return r.end(); } r.end('page'); });
    const v = await checker().checkOne(`${s.base}/old`);
    expect(v).toMatchObject({ status: 'live', hops: 2, finalUrl: `${s.base}/new` });
    expect(v.message).toMatch(/after 2 redirects/);
  });

  it('a redirect into a private address is refused at that hop, and the target is never contacted', async () => {
    const target = await serve((_q, r) => r.end('metadata'));
    // 127.0.0.2 is private and NOT allowed by the test overrides, so it goes through the real rules
    const s = await serve((_q, r) => { r.statusCode = 302; r.setHeader('location', `http://127.0.0.2:${target.port}/latest/meta-data/`); r.end(); });
    const v = await checker().checkOne(`${s.base}/start`);
    expect(v).toMatchObject({ status: 'unsafe', bucket: 'failed', hops: 1 });
    expect(v.finalUrl).toContain('127.0.0.2');
    expect(target.hit.n).toBe(0);
  });

  it('refuses a redirect to another scheme, to credentials, to localhost, and to the metadata address', async () => {
    for (const loc of ['file:///etc/passwd', 'http://user:pw@127.0.0.1/x', 'http://localhost/x', 'http://169.254.169.254/latest/meta-data/', 'http://[::ffff:a9fe:a9fe]/', 'gopher://127.0.0.1:6379/_PING']) {
      const s = await serve((_q, r) => { r.statusCode = 302; r.setHeader('location', loc); r.end(); });
      const v = await checker().checkOne(`${s.base}/x`);
      expect(v.status, loc).toBe('unsafe');
    }
  });

  it('stops after maxHops, and says it did not follow it to the end', async () => {
    const s = await serve((q, r) => { r.statusCode = 302; r.setHeader('location', `http://127.0.0.1:${q.socket.localPort}/loop`); r.end(); });
    const v = await checker({ maxHops: 3 }).checkOne(`${s.base}/loop`);
    expect(v).toMatchObject({ status: 'blocked' });
    expect(v.message).toMatch(/Too many redirects \(more than 3\)/);
    expect(s.hit.n).toBeLessThanOrEqual(4);
  });
});

describe('a page that answers but is not the page', () => {
  it('a deep link bounced to the home page is "soft404", a check, not a pass', async () => {
    const s = await serve((q, r) => { if (q.url === '/papers/12345') { r.statusCode = 302; r.setHeader('location', '/'); return r.end(); } r.end('home'); });
    const v = await checker().checkOne(`${s.base}/papers/12345`);
    expect(v).toMatchObject({ status: 'soft404', bucket: 'check' });
  });
  it('with checkTitles, a 200 whose title says "not found" is soft404, and a normal page is live', async () => {
    const s = await serve((q, r) => r.end(q.url === '/gone' ? '<html><head><title>Page not found</title></head>' : '<html><head><title>The Real Paper</title></head>'));
    const c = checker({ checkTitles: true });
    expect((await c.checkOne(`${s.base}/gone`)).status).toBe('soft404');
    expect((await c.checkOne(`${s.base}/real`)).status).toBe('live');
  });
  it('looksLikeSoft404 on its own', () => {
    expect(looksLikeSoft404('https://x.com/a/b/c', 'https://x.com/')).toBe(true);
    expect(looksLikeSoft404('https://x.com/a/b/c', 'https://x.com/en/')).toBe(true);
    expect(looksLikeSoft404('https://x.com/a', 'https://x.com/404')).toBe(true);
    expect(looksLikeSoft404('https://x.com/a', 'https://x.com/a')).toBe(false);
    expect(looksLikeSoft404('https://x.com/', 'https://x.com/en/')).toBe(false);
    expect(looksLikeSoft404('https://x.com/search?q=1', 'https://x.com/search')).toBe(false);
  });
});

describe('it is bounded', () => {
  it('reads only the start of a page, then drops the connection', async () => {
    let sent = 0, dropped = false;
    const s = await serve((q, r) => {
      if (q.method === 'HEAD') return r.end();
      r.write('<html><head><title>Big</title></head>');
      // an endless page, written the way a real server writes: only as fast as the client reads
      const pump = () => { if (r.destroyed || r.writableEnded) { dropped = true; return; } sent += 8192; if (r.write('x'.repeat(8192))) setImmediate(pump); else r.once('drain', pump); };
      r.once('close', () => { dropped = true; });
      pump();
    });
    const v = await checker({ checkTitles: true, maxBodyChars: 24_000 }).checkOne(`${s.base}/huge`);
    expect(v.status).toBe('live');
    await new Promise((go) => setTimeout(go, 150));
    expect(dropped).toBe(true);
    expect(sent).toBeLessThan(2_000_000);   // a page of unbounded size cost about the first 24 KB plus what was already in flight
  });

  it('makes at most perHostConcurrency requests to one host at a time', async () => {
    let now = 0, max = 0;
    const s = await serve((_q, r) => { now++; max = Math.max(max, now); setTimeout(() => { now--; r.end('x'); }, 40); });
    await checker({ perHostConcurrency: 2, concurrency: 8 }).check(Array.from({ length: 8 }, (_, i) => `${s.base}/p${i}`));
    expect(max).toBeLessThanOrEqual(2);
  });

  it('checks at most maxUrls, and makes no request for the rest', async () => {
    const s = await serve((_q, r) => r.end('x'));
    const r2 = await createLinkChecker({ unsafeOverrides: testOverrides, maxUrls: 5, retryDelayMs: 0 }).check(Array.from({ length: 30 }, (_, i) => `${s.base}/v${i}`));
    expect(r2.verdicts).toHaveLength(30);
    expect(r2.verdicts.filter((v) => v.status === 'limit')).toHaveLength(25);
    expect(r2.verdicts.filter((v) => v.status === 'limit').every((v) => v.bucket === 'check' && v.retryable)).toBe(true);
    expect(s.hit.methods.filter((m) => m.includes('/v')).length).toBeLessThanOrEqual(5);
  });

  it('the default cap is 25', async () => {
    const s = await serve((_q, r) => r.end('x'));
    const rep = await checker().check(Array.from({ length: 40 }, (_, i) => `${s.base}/d${i}`));
    expect(rep.verdicts.filter((v) => v.status === 'limit')).toHaveLength(15);
    expect(s.hit.methods.length).toBeLessThanOrEqual(25);
  });

  it('checks a link once however many times it is given', async () => {
    const s = await serve((_q, r) => r.end('x'));
    const rep = await checker().check([`${s.base}/same`, `${s.base}/same`, ` ${s.base}/same `]);
    expect(rep.verdicts).toHaveLength(1);
    expect(s.hit.methods.filter((m) => m.startsWith('HEAD')).length).toBe(1);
  });
});

describe('recheck', () => {
  it('settles only what was blocked, unreachable or over the limit', async () => {
    let up = false;
    const s = await serve((q, r) => { if (q.url === '/flaps' && !up) { r.statusCode = 503; return r.end(); } r.statusCode = q.url === '/missing' ? 404 : 200; r.end('x'); });
    const c = checker({ breaker: { failuresToOpen: 99 } });
    const first = await c.check([`${s.base}/fine`, `${s.base}/flaps`, `${s.base}/missing`]);
    expect(first.verdicts.map((v) => v.status)).toEqual(['live', 'blocked', 'broken']);
    up = true;
    const before = s.hit.methods.length;
    const second = await c.recheck(first);
    expect(second.verdicts.map((v) => v.status)).toEqual(['live', 'live', 'broken']);
    expect(s.hit.methods.slice(before).every((m) => m.includes('/flaps'))).toBe(true);
  });
});

describe('server-side only, and kept out of browser bundles', () => {
  it('no other module imports it, and none but this one touches node:http, https or dns', () => {
    for (const f of fs.readdirSync(new URL('../src/', import.meta.url)).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts') && n !== 'liveness.ts')) {
      const src = fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/from '\.\/liveness\.js'/);
      expect(src, f).not.toMatch(/node:(http|https|dns|net|tls)/);
    }
  });
  it('the package exports it with a null browser condition', () => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.exports['./links']).toMatchObject({ browser: null, import: './dist/liveness.js' });
  });
});
