import type { Bucket, Citation, Status, Summary, Verdict } from './types.js';
import { DOI_PATTERN } from './links.js';

/** ok = confirmed. check = found with something to look at, or cannot be confirmed (approximate, no title, offline). failed = no such work, the wrong work, or a link to something else. */
export function bucketOf(status: Status, exact: boolean | undefined, notes: string[]): Bucket {
  switch (status) {
    case 'found': return exact === false || notes.length ? 'check' : 'ok';
    case 'badlink': case 'mismatch': case 'notfound': case 'approx-none': return 'failed';
    case 'approx-ok': case 'approx-unparsed': case 'no-title': case 'unavailable': case 'limit': return 'check';
    default: return 'skip';
  }
}

/** One sentence, in plain words, for what was found. */
export function messageFor(v: Pick<Verdict, 'status' | 'source' | 'exact' | 'match' | 'notes' | 'linkState' | 'suggestedDoi'>, searched: string[]): string {
  switch (v.status) {
    case 'found': {
      const parts: string[] = [];
      if (v.exact === false && v.match?.title) parts.push(`the title differs (the record: “${v.match.title.slice(0, 140)}”)`);
      parts.push(...v.notes);
      return parts.length ? `Found in ${v.source}, but check: ${parts.join('; ')}.` : `Verified in ${v.source}.`;
    }
    case 'badlink': {
      const why = v.linkState === 'dead' ? 'the DOI given does not exist' : 'the link given belongs to a different paper';
      return `The paper exists, but ${why}.` + (v.suggestedDoi ? ` The closest match in the database has DOI ${v.suggestedDoi}.` : ' Find the real link yourself.');
    }
    case 'mismatch': return 'An author with this surname exists, but not for this exact title. The title may be invented or attached to the wrong author.';
    case 'notfound': return `Not found in ${searched.join(', ') || 'any source'}. It may be invented.`;
    case 'approx-ok': return `Approximate: related work by this author exists${v.match?.title ? ` (for example “${v.match.title.slice(0, 90)}”)` : ''}. No specific paper can be confirmed.`;
    case 'approx-none': return 'Approximate: no work by this author on this topic was found. Verify before relying on it.';
    case 'approx-unparsed': return 'Approximate: could not tell whose work or what topic.';
    case 'no-title': return 'No title was given, so there is nothing to confirm.';
    case 'limit': return 'Not checked: this text has more citations than the limit for one check, so the rest were left alone rather than sent to the free services.';
    case 'unavailable': return 'The citation sources were unreachable or throttled. This says nothing about the citation; try again later.';
    default: return '';
  }
}

export function suggestedDoiOf(doi: string | undefined): string | undefined {
  return doi && DOI_PATTERN.test(doi) && doi.length < 200 ? doi : undefined;
}

export function summarize(verdicts: Pick<Verdict, 'bucket'>[]): Summary {
  const live = verdicts.filter((v) => v.bucket !== 'skip');
  const verified = live.filter((v) => v.bucket === 'ok').length;
  const check = live.filter((v) => v.bucket === 'check').length;
  const failed = live.filter((v) => v.bucket === 'failed').length;
  const bits = [`Citations: ${live.length}`];
  if (verified) bits.push(`✓ ${verified} verified`);
  if (check) bits.push(`≈ ${check} to check`);
  if (failed) bits.push(`✕ ${failed} not verified`);
  return {
    total: live.length, verified, check, failed,
    level: failed ? 'bad' : check ? 'warn' : 'good',
    text: bits.join(' · ') + (failed ? ' — do not rely on them.' : ''),
  };
}

export type { Citation };
