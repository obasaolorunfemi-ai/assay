/* What the checker knows about its sources, and what it does about a sick one.
   A source can be down, throttled for a day (OpenAlex now gives each address a small daily budget), or quietly change what it returns.
   None of those may become an accusation against a citation, and none may need a person to notice. So each source has:
   - a breaker: after a few failures it is left alone for a while (longer if it says "retry after"), then one probe is let through;
   - a self-test: before anyone is told "not found", the sources that said so must find a work we know exists. */

export interface BreakerOptions {
  /** Failures in a row before a source is left alone. Default 3. */
  failuresToOpen?: number;
  /** How long it is left alone the first time. Default 60 s; doubles each time a probe fails, up to `maxCooldownMs`. */
  cooldownMs?: number;
  /** Never wait longer than this, even when a source asks for more (OpenAlex asked for 20 hours). Default 15 minutes: after that one probe is tried anyway. */
  maxCooldownMs?: number;
  /** How long a passed self-test is trusted. Default 10 minutes. */
  selfTestTtlMs?: number;
}

export type SourceState = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface SourceHealth {
  name: string;
  state: SourceState;
  /** When a source that is being left alone will next be tried (ms since epoch). */
  retryAt?: number;
  /** What last went wrong. */
  lastProblem?: string;
  /** Result of the last self-test. */
  selfTest: 'passed' | 'failed' | 'untested';
}

interface Entry { fails: number; openUntil: number; cooldown: number; problem?: string; testPassedUntil: number; testFailed: boolean; tested: boolean; everOk: boolean }

export function createHealthBook(opts: BreakerOptions & { now?: () => number } = {}) {
  const now = opts.now ?? Date.now;
  const need = opts.failuresToOpen ?? 3;
  const base = opts.cooldownMs ?? 60_000;
  const cap = opts.maxCooldownMs ?? 900_000;
  const testTtl = opts.selfTestTtlMs ?? 600_000;
  const book = new Map<string, Entry>();
  const get = (n: string): Entry => { let e = book.get(n); if (!e) { e = { fails: 0, openUntil: 0, cooldown: base, testPassedUntil: 0, testFailed: false, tested: false, everOk: false }; book.set(n, e); } return e; };
  return {
    /** May this source be asked now? True when it is healthy, or when its cool-down is over (that one request is the probe). */
    allow(name: string): boolean { return now() >= get(name).openUntil; },
    success(name: string) { const e = get(name); e.fails = 0; e.openUntil = 0; e.cooldown = base; e.problem = undefined; e.everOk = true; },
    /** `retryAfterMs` is what the source itself asked for, if it did. */
    failure(name: string, problem: string, retryAfterMs?: number) {
      const e = get(name);
      e.fails++; e.problem = problem;
      const asked = retryAfterMs && retryAfterMs > 0 ? Math.min(retryAfterMs, cap) : 0;
      // A source that says "come back in N seconds" is believed at once; otherwise it gets three tries before it is left alone.
      if (asked) { e.openUntil = now() + asked; e.cooldown = Math.max(e.cooldown, asked); }
      else if (e.fails >= need) { e.openUntil = now() + e.cooldown; e.cooldown = Math.min(e.cooldown * 2, cap); }
    },
    selfTestFresh(name: string): boolean { return get(name).testPassedUntil > now(); },
    selfTestPassed(name: string) { const e = get(name); e.testPassedUntil = now() + testTtl; e.testFailed = false; e.tested = true; },
    /** The source answered, but could not find a work we know exists: it is broken in a way that returns no error. Look again soon. */
    selfTestFailed(name: string) { const e = get(name); e.testPassedUntil = 0; e.testFailed = true; e.tested = true; e.problem = 'could not find a work that exists (its answers cannot be trusted)'; },
    snapshot(names: string[]): SourceHealth[] {
      return names.map((name) => {
        const e = get(name);
        const open = e.openUntil > now();
        const state: SourceState = open ? 'down' : e.testFailed ? 'degraded' : e.fails > 0 ? 'degraded' : e.everOk || e.testPassedUntil > 0 ? 'healthy' : 'unknown';
        return { name, state, ...(open ? { retryAt: e.openUntil } : {}), ...(e.problem ? { lastProblem: e.problem } : {}), selfTest: !e.tested ? 'untested' : e.testFailed ? 'failed' : 'passed' };
      });
    },
  };
}
export type HealthBook = ReturnType<typeof createHealthBook>;
