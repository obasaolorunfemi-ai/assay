import type { Bucket, Report } from './types.js';

export interface StripOptions {
  /**
   * 'placeholder' (default): `[citation removed: could not be verified]`, so the reader sees that something stood there.
   * 'remove': the tag is deleted, and the space it leaves is tidied.
   * 'mark': the tag stays, prefixed `[⚠ unverified:`, for a person to review.
   */
  mode?: 'placeholder' | 'remove' | 'mark';
  /** Which results to act on. Default: only `failed`. Add 'check' to be stricter. */
  buckets?: Bucket[];
}

/** Takes the citations that failed out of the text (or marks them). The text is otherwise untouched. */
export function strip(text: string, report: Report, opts: StripOptions = {}): string {
  const mode = opts.mode ?? 'placeholder';
  const buckets = new Set<Bucket>(opts.buckets ?? ['failed']);
  let out = text;
  for (const v of report.verdicts) {
    if (!buckets.has(v.bucket)) continue;
    const tag = v.citation.tag;
    const replacement = mode === 'remove' ? '' : mode === 'mark' ? `[⚠ unverified: ${v.citation.raw}]` : '[citation removed: could not be verified]';
    out = out.split(tag).join(replacement);
  }
  if (mode === 'remove') out = out.replace(/[ \t]+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ');
  return out;
}
