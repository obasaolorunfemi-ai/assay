/** One way to ask the network, with a time limit. A failure is a value, never a throw: a source that cannot be reached is "not available", not "not found". */
export interface Http {
  json(url: string): Promise<{ ok: boolean; status: number; body: unknown }>;
}

export function makeHttp(opts: { fetch?: typeof fetch; timeoutMs?: number; concurrency?: number; retryDelayMs?: number }): Http {
  const f = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const limit = Math.max(1, opts.concurrency ?? 4);
  const retryDelay = opts.retryDelayMs ?? 1200;
  let running = 0;
  const waiting: Array<() => void> = [];
  const acquire = () => new Promise<void>((go) => { if (running < limit) { running++; go(); } else waiting.push(() => { running++; go(); }); });
  const release = () => { running--; waiting.shift()?.(); };
  return {
    async json(url) {
      await acquire();
      try {
        // One polite retry when a source says "slow down" (429) or is briefly busy (503): these free services share their limits.
        let res = await f(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
        if (res.status === 429 || res.status === 503) {
          const ra = Number(res.headers?.get?.('retry-after'));
          await new Promise((go) => setTimeout(go, Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : retryDelay, 3000)));
          res = await f(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
        }
        let body: unknown = null;
        try { body = await res.json(); } catch { /* a non-JSON body (an error page) */ }
        return { ok: res.ok, status: res.status, body };
      } catch {
        return { ok: false, status: 0, body: null };
      } finally { release(); }
    },
  };
}
