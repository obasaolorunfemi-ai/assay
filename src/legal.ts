/* Legal: are these court citations real, and do they belong to the case named?
   Court filings with invented case law are the best-documented harm from AI-written text. This asks CourtListener (the Free Law Project's database of
   US court decisions) about every case citation in a text, using its citation-lookup API, which exists for this purpose.
   It needs a free CourtListener token. It sends the text you give it to courtlistener.com, so do not pass confidential text.
   Like the other network checks it tells "not found" apart from "could not look": a throttled or changed API is `unavailable`, never an accusation.
   Coverage is not complete (CourtListener does not hold every court's decisions), so the wording is "not verified", not "invented". */
import type { Bucket, Summary } from './types.js';
import { summarizeBuckets } from './summary.js';
import { makeHttp, type Http } from './http.js';

export type LegalStatus = 'found' | 'wrong-case' | 'notfound' | 'ambiguous' | 'unreadable' | 'limit' | 'unavailable';
export interface LegalVerdict {
  /** The citation as it appears in the text ("925 F.3d 1339"). */
  citation: string;
  status: LegalStatus;
  bucket: Bucket;
  message: string;
  /** The case CourtListener holds under this citation, so a person can compare. */
  caseName?: string;
  retryable?: boolean;
}
export interface LegalReport { verdicts: LegalVerdict[]; summary: Summary; ok: boolean }
export interface LegalOptions {
  /** Your CourtListener API token (free, from courtlistener.com). Sent to courtlistener.com only. */
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Default https://www.courtlistener.com/api/rest/v4/citation-lookup/ */
  endpoint?: string;
}
export interface Legal {
  check(text: string): Promise<LegalReport>;
}

const MAX_CHARS = 60_000; // the API accepts 64,000 characters a request
const words = { label: 'Case citations', ok: 'found', check: 'to check', failed: 'not verified', failedTail: ' — do not file or publish them as authority.' };
const STOP = new Set(['v', 'vs', 'inc', 'corp', 'co', 'llc', 'ltd', 'the', 'of', 'and', 'in', 're', 'ex', 'rel', 'et', 'al', 'company', 'corporation', 'no']);

/** The significant words of a case name, lower-cased. */
const partyWords = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

/** The "A v. B" written just before a citation, if there is one. It reads at most 160 characters and uses no backtracking pattern. */
export function caseNameBefore(text: string, index: number): string {
  const window = text.slice(Math.max(0, index - 160), index);
  const dot = window.lastIndexOf(' v. '), bare = window.lastIndexOf(' v ');
  const at = Math.max(dot, bare);
  if (at < 0) return '';
  const sepLen = at === dot ? 4 : 3;
  const connector = /^(?:of|the|and|&|de|la|ex|rel\.?|for|in)$/i;
  const before = window.slice(0, at).trim().split(/\s+/);
  const left: string[] = [];
  for (let i = before.length - 1; i >= 0 && left.length < 5; i--) {
    const w = before[i]!;
    if (/^[A-Z0-9]/.test(w) || (connector.test(w) && left.length)) left.unshift(w); else break;
  }
  while (left.length && connector.test(left[0]!)) left.shift();
  const right = window.slice(at + sepLen).trim().split(/\s+/).slice(0, 6).join(' ').replace(/[\s,;]+$/, '');
  return left.length && right ? `${left.join(' ')} v. ${right}` : '';
}
/** Do two case names share enough of their words to be the same case? */
export function sameCase(written: string, held: string): boolean {
  const a = new Set(partyWords(written)), b = new Set(partyWords(held));
  if (!a.size || !b.size) return true; // nothing to compare is not a mismatch
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size) >= 0.5;
}

interface Row { citation?: unknown; normalized_citations?: unknown; start_index?: unknown; end_index?: unknown; status?: unknown; error_message?: unknown; clusters?: unknown }

function chunks(text: string): Array<{ offset: number; text: string }> {
  const out: Array<{ offset: number; text: string }> = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + MAX_CHARS);
    if (end < text.length) { const nl = text.lastIndexOf('\n', end); if (nl > at + MAX_CHARS / 2) end = nl; }
    out.push({ offset: at, text: text.slice(at, end) });
    at = end;
  }
  return out;
}

export function createLegal(opts: LegalOptions): Legal {
  const http: Http = makeHttp({ ...(opts.fetch ? { fetch: opts.fetch } : {}), ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}), requestsPerSecond: 1 });
  const endpoint = opts.endpoint ?? 'https://www.courtlistener.com/api/rest/v4/citation-lookup/';
  const unavailable = (message: string): LegalVerdict => ({ citation: '', status: 'unavailable', bucket: 'check', retryable: true, message });

  return {
    async check(text) {
      const verdicts: LegalVerdict[] = [];
      for (const part of chunks(text)) {
        const r = await http.json(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Token ${opts.token}` },
          body: `text=${encodeURIComponent(part.text)}`,
        });
        // A reply that is not the array the API sends (an HTML error page, a changed shape) is an outage, never "no citations".
        if (!r.ok || !Array.isArray(r.body)) {
          const why = r.networkError ? 'could not be reached' : r.status === 429 ? 'is throttling requests' : r.status === 401 || r.status === 403 ? 'refused the token' : 'answered with something unexpected';
          verdicts.push(unavailable(`CourtListener ${why}, so these citations were not checked. That says nothing about them.`));
          continue;
        }
        for (const row of r.body as Row[]) {
          const citation = typeof row.citation === 'string' ? row.citation : '';
          const status = Number(row.status);
          const start = typeof row.start_index === 'number' ? row.start_index + part.offset : -1;
          const clusters = Array.isArray(row.clusters) ? (row.clusters as Array<Record<string, unknown>>) : [];
          const names = clusters.map((c) => (typeof c.case_name === 'string' ? c.case_name : '')).filter(Boolean);
          const held = names[0];
          if (status === 200) {
            const written = start >= 0 ? caseNameBefore(text, start) : '';
            if (written && names.length && !names.some((n) => sameCase(written, n))) {
              verdicts.push({ citation, status: 'wrong-case', bucket: 'failed', ...(held ? { caseName: held } : {}), message: `${citation} exists, but it is ${held ?? 'a different case'}, not "${written}". The citation points to another case.` });
            } else {
              verdicts.push({ citation, status: 'found', bucket: 'ok', ...(held ? { caseName: held } : {}), message: held ? `${citation} is a real citation: ${held}.` : `${citation} is a real citation.` });
            }
          } else if (status === 404) {
            verdicts.push({ citation, status: 'notfound', bucket: 'failed', message: `${citation} was not found in CourtListener. It may be invented, or it may be a court CourtListener does not hold: check it before relying on it.` });
          } else if (status === 300) {
            verdicts.push({ citation, status: 'ambiguous', bucket: 'check', message: `${citation} matches more than one decision (${names.slice(0, 3).join('; ') || 'several'}). Check which one is meant.` });
          } else if (status === 400) {
            verdicts.push({ citation, status: 'unreadable', bucket: 'check', message: `${citation} looks like a citation, but its reporter is not one CourtListener knows, so it could not be checked.` });
          } else if (status === 429) {
            verdicts.push({ citation, status: 'limit', bucket: 'check', message: `${citation} was not looked up: the text had more citations than one request allows. Check the rest in a second call.` });
          } else {
            verdicts.push({ citation, status: 'unavailable', bucket: 'check', retryable: true, message: `${citation || 'A citation'} came back in a form Assay could not read, so it was not checked.` });
          }
        }
      }
      const summary = summarizeBuckets(verdicts.map((v) => v.bucket), words);
      return { verdicts, summary, ok: summary.failed === 0 };
    },
  };
}
