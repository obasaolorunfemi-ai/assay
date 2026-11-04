/* Share: optionally add your app's counts to the public counter.
   Assay never does this by itself. Nothing here runs unless YOUR code calls it, and what it sends is a handful of numbers: for each check, how many items were checked
   and how many came back ok, to check, or failed. No text, no citations, no quotes, no names, no address of yours (the counter keeps none), no identifier.
   The counter is at https://assay.extrafemi.com and is self-reported by apps that choose to take part: it is not verified, and it is rate-limited.
   A failed report is never fatal and never repeated in a loop: the counts stay in your tally and go out with the next one. */
import type { Tally } from './tally.js';

export const COUNTER_URL = 'https://assay.extrafemi.com/api/count';
/** The checks the counter accepts. Anything else in a tally stays in your tally. */
export const COUNTED_CHECKS = ['citations', 'quotes', 'figures', 'gate', 'grounding', 'values', 'links', 'support', 'retractions', 'legal'] as const;

export interface ShareOptions {
  /** Where to send the counts. Default: the public counter. Must be https (or http on localhost, for testing). */
  url?: string;
  fetch?: typeof fetch;
  /** Default 5 seconds. */
  timeoutMs?: number;
}
export interface ShareResult { sent: boolean; reason?: string; checked?: number }

const okUrl = (u: string) => /^https:\/\//i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(u);

/** Sends what has been counted since the last successful report. Never throws. */
export async function shareTally(tally: Tally, opts: ShareOptions = {}): Promise<ShareResult> {
  const url = opts.url ?? COUNTER_URL;
  if (!okUrl(url)) return { sent: false, reason: 'the address must be https' };
  const delta = tally.drain();
  const counts: Record<string, { checked: number; ok: number; check: number; failed: number }> = {};
  let checked = 0;
  for (const name of COUNTED_CHECKS) {
    const c = delta.byCheck[name];
    if (c && c.checked > 0) { counts[name] = { checked: c.checked, ok: c.ok, check: c.check, failed: c.failed }; checked += c.checked; }
  }
  if (!checked) return { sent: false, reason: 'nothing new to send' };
  try {
    const f = opts.fetch ?? globalThis.fetch;
    const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, counts }), signal: AbortSignal.timeout(opts.timeoutMs ?? 5000) });
    if (!res.ok) { tally.undrain(delta); return { sent: false, reason: `the counter answered ${res.status}` }; }
    return { sent: true, checked };
  } catch {
    tally.undrain(delta);
    return { sent: false, reason: 'the counter could not be reached' };
  }
}

export interface Sharing { stop(): void; flush(): Promise<ShareResult> }
/** Reports every `everyMs` (default ten minutes) until stopped. The timer does not keep a Node process alive. Call `flush()` before your process exits. */
export function startSharing(tally: Tally, opts: ShareOptions & { everyMs?: number } = {}): Sharing {
  const flush = () => shareTally(tally, opts);
  const timer: any = setInterval(() => { void flush(); }, Math.max(60_000, opts.everyMs ?? 600_000));
  timer?.unref?.();
  return { stop: () => clearInterval(timer), flush };
}
