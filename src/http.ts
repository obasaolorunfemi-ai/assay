/** One way to ask the network, with a time limit. A failure is a value, never a throw: a source that cannot be reached is "not available", not "not found". */
export interface HttpResult { ok: boolean; status: number; body: unknown; /** What the source asked for with Retry-After, in ms. */ retryAfterMs?: number; /** True when the request itself failed (offline, timed out), as opposed to the source answering with an error. */ networkError?: boolean }
/** Extra things a few sources need: a header (an API key), or a POST. Most sources need none. */
export interface HttpInit { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string }
export interface Http {
  json(url: string, init?: HttpInit): Promise<HttpResult>;
  /** The reply as text, for the few sources that answer in CSV. `body` is a string, or null when it was not readable or was over 5 MB. Optional so a hand-made `Http` in a test need not provide it. */
  text?(url: string, init?: HttpInit): Promise<HttpResult>;
}

/** Retry-After is seconds, or a date. */
export function parseRetryAfter(v: string | null | undefined, now = Date.now()): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return n * 1000;
  const d = Date.parse(v);
  return Number.isFinite(d) ? Math.max(0, d - now) : undefined;
}

export function makeHttp(opts: { fetch?: typeof fetch; timeoutMs?: number; concurrency?: number; retryDelayMs?: number; requestsPerSecond?: number }): Http {
  const f = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const limit = Math.max(1, opts.concurrency ?? 4);
  const retryDelay = opts.retryDelayMs ?? 1200;
  // Requests start no faster than this, whatever the concurrency: the services are free and shared, and CrossRef's public pool allows about 5 a second.
  const gap = 1000 / Math.max(0.1, opts.requestsPerSecond ?? 5);
  let nextStart = 0;
  const pace = async () => { const now = Date.now(); const at = Math.max(now, nextStart); nextStart = at + gap; if (at > now) await new Promise((go) => setTimeout(go, at - now)); };
  let running = 0;
  const waiting: Array<() => void> = [];
  const acquire = () => new Promise<void>((go) => { if (running < limit) { running++; go(); } else waiting.push(() => { running++; go(); }); });
  const release = () => { running--; waiting.shift()?.(); };
  return {
    json: (url, init) => request(url, init, 'json'),
    text: (url, init) => request(url, init, 'text'),
  };
  async function request(url: string, init: HttpInit | undefined, kind: 'json' | 'text'): Promise<HttpResult> {
    {
      await acquire();
      try {
        await pace();
        // One polite retry when a source says "slow down" (429) or is briefly busy (503): these free services share their limits.
        const req = () => ({ signal: AbortSignal.timeout(timeoutMs), method: init?.method ?? 'GET', headers: { accept: kind === 'json' ? 'application/json' : 'text/csv, text/plain;q=0.9, */*;q=0.5', ...(init?.headers ?? {}) }, ...(init?.body !== undefined ? { body: init.body } : {}) });
        let res = await f(url, req());
        // Only a SHORT wait is worth retrying inside this call. A source that says "come back in two minutes" (or twenty hours) is believed:
        // the failure is returned at once with that wait, and the health book leaves the source alone until then.
        const asked = res.status === 429 || res.status === 503 ? parseRetryAfter(res.headers?.get?.('retry-after')) : undefined;
        if ((res.status === 429 || res.status === 503) && (asked === undefined || asked <= 3000)) {
          await new Promise((go) => setTimeout(go, asked ?? retryDelay));
          await pace();
          res = await f(url, req());
        }
        let body: unknown = null;
        try {
          if (kind === 'json') body = await res.json();
          else { const t = await res.text(); body = t.length <= 5_000_000 ? t : null; }
        } catch { /* a body that is not what was asked for (an error page) */ }
        const retryAfterMs = res.ok ? undefined : parseRetryAfter(res.headers?.get?.('retry-after'));
        return { ok: res.ok, status: res.status, body, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
      } catch {
        return { ok: false, status: 0, body: null, networkError: true };
      } finally { release(); }
    }
  }
}
