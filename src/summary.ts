import type { Bucket, Summary } from './types.js';

export interface SummaryWords {
  /** "Citations", "Quotes", "Figures" */
  label: string;
  ok: string;
  check: string;
  failed: string;
  /** Added when anything failed. */
  failedTail: string;
}

/** The one-line summary every module uses: "Quotes: 3 · ✓ 2 found · ✕ 1 not found — …". `skip` results are not counted. */
export function summarizeBuckets(buckets: Bucket[], w: SummaryWords): Summary {
  const live = buckets.filter((b) => b !== 'skip');
  const verified = live.filter((b) => b === 'ok').length;
  const check = live.filter((b) => b === 'check').length;
  const failed = live.filter((b) => b === 'failed').length;
  const bits = [`${w.label}: ${live.length}`];
  if (verified) bits.push(`✓ ${verified} ${w.ok}`);
  if (check) bits.push(`≈ ${check} ${w.check}`);
  if (failed) bits.push(`✕ ${failed} ${w.failed}`);
  return {
    total: live.length, verified, check, failed,
    level: failed ? 'bad' : check ? 'warn' : 'good',
    text: bits.join(' · ') + (failed ? w.failedTail : ''),
  };
}
