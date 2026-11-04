/* Retractions: has this paper been retracted?
   A citation can be real, its link live, and the paper withdrawn. Crossref's records carry notices of retraction, withdrawal and correction, including
   the Retraction Watch database that Crossref now holds, so this asks Crossref about each DOI it finds in a text (or each DOI you list).
   "No notice recorded" is not proof that none exists: notices reach Crossref from publishers and from Retraction Watch, and some are late.
   A DOI that Crossref does not hold (a DataCite DOI, a preprint server) is skipped, not cleared. An outage is `unavailable`, never "clear". */
import type { Bucket, Summary } from './types.js';
import { summarizeBuckets } from './summary.js';
import { makeHttp, type Http } from './http.js';

export type RetractionStatus = 'retracted' | 'concern' | 'corrected' | 'clear' | 'not-in-crossref' | 'unavailable';
export interface RetractionVerdict {
  doi: string;
  status: RetractionStatus;
  bucket: Bucket;
  message: string;
  /** The notice found, when there is one: its date (YYYY-MM-DD) and who recorded it. */
  notice?: { type: string; date: string; source: string };
  retryable?: boolean;
}
export interface RetractionReport { verdicts: RetractionVerdict[]; summary: Summary; ok: boolean }
export interface RetractionOptions { mailto?: string; fetch?: typeof fetch; timeoutMs?: number; requestsPerSecond?: number; maxDois?: number }
export interface Retractions {
  /** Pass a text (every DOI in it is checked) or a list of DOIs. */
  check(input: string | string[]): Promise<RetractionReport>;
}

const words = { label: 'Papers', ok: 'no notice', check: 'to check', failed: 'retracted', failedTail: ' — do not cite a retracted paper as evidence.' };

/** The DOIs in a text, trimmed of the punctuation that follows them in prose. Bounded: it reads each candidate once. */
export function doisIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b10\.\d{4,9}\/[^\s"'<>\]]{1,200}/g)) {
    let d = m[0];
    while (d.length && /[.,;:)\]}]$/.test(d)) d = d.slice(0, -1);
    if (d.length > 8) out.add(d.toLowerCase());
  }
  return [...out];
}

const GONE = new Set(['retraction', 'withdrawal', 'removal']);
const CONCERN = new Set(['expression_of_concern', 'expression-of-concern']);

export function createRetractions(opts: RetractionOptions = {}): Retractions {
  const http: Http = makeHttp({ ...(opts.fetch ? { fetch: opts.fetch } : {}), ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}), requestsPerSecond: opts.requestsPerSecond ?? 5 });
  const maxDois = opts.maxDois ?? 50;
  const mail = opts.mailto ? `?mailto=${encodeURIComponent(opts.mailto)}` : '';

  async function one(doi: string): Promise<RetractionVerdict> {
    const r = await http.json(`https://api.crossref.org/works/${encodeURIComponent(doi)}${mail}`);
    if (r.status === 404) return { doi, status: 'not-in-crossref', bucket: 'skip', message: `${doi} is not a Crossref DOI, so Crossref has no notice for it either way.` };
    const m = (r.body as { message?: Record<string, unknown> } | null)?.message;
    // Anything that is not the record Crossref normally sends is an outage, never "clear".
    if (!r.ok || !m || typeof m !== 'object' || typeof m.DOI !== 'string') {
      return { doi, status: 'unavailable', bucket: 'check', retryable: true, message: `Crossref ${r.networkError ? 'could not be reached' : r.status === 429 ? 'is throttling requests' : 'answered with something unexpected'}, so ${doi} was not checked. That says nothing about the paper.` };
    }
    const updates = Array.isArray(m['updated-by']) ? (m['updated-by'] as Array<Record<string, unknown>>) : [];
    const notices = updates.map((u) => ({ type: String(u.type ?? ''), date: dateOf(u), source: String(u.source ?? 'publisher') }));
    const gone = notices.find((n) => GONE.has(n.type));
    const title = Array.isArray(m.title) ? String(m.title[0] ?? '') : '';
    if (gone || /^\s*RETRACTED\b/i.test(title)) {
      const n = gone ?? { type: 'retraction', date: '', source: 'the record title' };
      return { doi, status: 'retracted', bucket: 'failed', notice: n, message: `${doi} has been ${n.type === 'withdrawal' ? 'withdrawn' : n.type === 'removal' ? 'removed' : 'retracted'}${n.date ? ` (notice dated ${n.date}, recorded by ${n.source})` : ''}. Do not cite it as evidence.` };
    }
    const concern = notices.find((n) => CONCERN.has(n.type));
    if (concern) return { doi, status: 'concern', bucket: 'check', notice: concern, message: `${doi} carries an expression of concern${concern.date ? ` dated ${concern.date}` : ''}. Read the notice before citing it.` };
    const fix = notices.find((n) => n.type === 'correction');
    if (fix) return { doi, status: 'corrected', bucket: 'ok', notice: fix, message: `${doi} has a correction notice${fix.date ? ` dated ${fix.date}` : ''} and no retraction. Cite the corrected version.` };
    return { doi, status: 'clear', bucket: 'ok', message: `No retraction or correction is recorded for ${doi} in Crossref. That is not proof that none exists.` };
  }

  return {
    async check(input) {
      const dois = (Array.isArray(input) ? input.map((d) => d.trim().toLowerCase()).filter(Boolean) : doisIn(input)).slice(0, maxDois);
      const verdicts: RetractionVerdict[] = [];
      for (const d of [...new Set(dois)]) verdicts.push(await one(d));
      const summary = summarizeBuckets(verdicts.map((v) => v.bucket), words);
      return { verdicts, summary, ok: summary.failed === 0 };
    },
  };
}

function dateOf(u: Record<string, unknown>): string {
  const p = (u.updated as { 'date-parts'?: number[][] } | undefined)?.['date-parts']?.[0];
  if (!Array.isArray(p) || typeof p[0] !== 'number') return '';
  return [p[0], p[1] ?? 1, p[2] ?? 1].map((n, i) => String(n).padStart(i === 0 ? 4 : 2, '0')).join('-');
}
