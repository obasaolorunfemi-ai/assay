/* Tally: how many things your own app's checks have caught.
   Assay itself never counts anything, sends anything, or phones home: a library that promises "no logging, no telemetry" cannot also keep a running score for its
   authors. If YOU want a counter ("12 invented citations blocked this month"), this is the piece: you feed it the reports your own code already has, it keeps
   only numbers (never the text, the citations or the quotes), and you decide where the numbers go and who sees them. */
import type { Bucket } from './types.js';

export interface TallyCounts { checked: number; ok: number; check: number; failed: number; skipped: number }
export interface TallySnapshot extends TallyCounts { byCheck: Record<string, TallyCounts> }
export interface Tally {
  /** Count the verdicts in any Assay report. `name` is the check ("citations", "quotes"…). Only the buckets are read; nothing else is kept. */
  add(name: string, report: { verdicts?: Array<{ bucket: Bucket }>; violations?: unknown[] }): void;
  /** What has been counted so far. */
  snapshot(): TallySnapshot;
  /** Add counts that were kept elsewhere (another process, an earlier day), for example loaded from your own store. */
  merge(other: TallySnapshot): void;
  reset(): void;
}

const zero = (): TallyCounts => ({ checked: 0, ok: 0, check: 0, failed: 0, skipped: 0 });
const KEY = /^[a-z][a-z0-9-]{0,30}$/;

export function createTally(): Tally {
  let total = zero();
  let by: Record<string, TallyCounts> = {};
  const bump = (c: TallyCounts, b: Bucket | 'violation') => {
    if (b === 'skip') { c.skipped++; return; }
    c.checked++;
    if (b === 'ok') c.ok++; else if (b === 'check') c.check++; else c.failed++;
  };
  return {
    add(name, report) {
      if (!KEY.test(name)) throw new TypeError('a tally name is a short lower-case word such as "citations"');
      const c = (by[name] ??= zero());
      // A grounding report lists only what went wrong; each violation is one thing caught.
      const list: Array<Bucket | 'violation'> = report.verdicts ? report.verdicts.map((v) => v.bucket) : (report.violations ?? []).map(() => 'violation' as const);
      for (const b of list) { bump(c, b); bump(total, b); }
    },
    snapshot: () => ({ ...total, byCheck: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { ...v }])) }),
    merge(o) {
      const add = (a: TallyCounts, b: TallyCounts) => { a.checked += b.checked | 0; a.ok += b.ok | 0; a.check += b.check | 0; a.failed += b.failed | 0; a.skipped += b.skipped | 0; };
      add(total, o);
      for (const [k, v] of Object.entries(o.byCheck ?? {})) if (KEY.test(k)) add((by[k] ??= zero()), v);
    },
    reset() { total = zero(); by = {}; },
  };
}
