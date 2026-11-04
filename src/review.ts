/* Review: one page a person can read, from any of Assay's reports.
   Assay's checks decide nothing on their own: a green tick is a reason to look less, a red cross a reason to look hard. This turns reports into a single
   self-contained HTML page for the person who has to decide: every item with its verdict and its plain-words message, the worst first, and a summary line
   per check. No network, no scripts. The page carries a content-security policy that forbids scripts and requests, and everything that came from a model
   or the web is escaped. */
import type { Bucket } from './types.js';
import { escapeHtml } from './escape.js';

export interface ReviewItem { bucket: Bucket; title: string; message: string; detail?: string[] }
export interface ReviewSection { name: string; summary: string; items: ReviewItem[] }
export interface ReviewOptions { title?: string; /** Shown under the title, for example the file reviewed. */ subtitle?: string }

const ORDER: Record<Bucket, number> = { failed: 0, check: 1, ok: 2, skip: 3 };
const MARK: Record<Bucket, string> = { failed: '✕', check: '≈', ok: '✓', skip: '–' };
const WORD: Record<Bucket, string> = { failed: 'Do not rely on this', check: 'Look at this', ok: 'Nothing found against it', skip: 'Not checked' };

/** Any report with `verdicts` and a `summary.text`, turned into a section. These read only the fields they name, so they accept every Assay report. */
type Reportish<V> = { verdicts: V[]; summary: { text: string } };
type Bucketed = { bucket: Bucket; message: string };
const section = <V extends Bucketed>(name: string, r: Reportish<V>, title: (v: V) => string, detail?: (v: V) => string[] | undefined): ReviewSection => ({
  name, summary: r.summary.text,
  items: r.verdicts.map((v) => { const d = detail?.(v); return { bucket: v.bucket, title: title(v), message: v.message, ...(d && d.length ? { detail: d } : {}) }; }),
});

export const sections = {
  citations: (r: Reportish<Bucketed & { citation: { authors: string; year: string; title: string; tag?: string } ; match?: { title?: string } | undefined }>) =>
    section('Citations', r, (v) => `${v.citation.authors} (${v.citation.year})${v.citation.title ? `, “${v.citation.title}”` : ''}`, (v) => (v.match?.title ? [`Closest record: ${v.match.title}`] : undefined)),
  quotes: (r: Reportish<Bucketed & { quote: string; id?: string }>) => section('Quotes', r, (v) => `“${v.quote}”`),
  figures: (r: Reportish<Bucketed & { figure: { raw: string }; supported: boolean }>) => section('Figures', r, (v) => v.figure.raw),
  grounding: (r: { summary: { text: string }; violations: Array<{ code: string; line: string; reason: string }> }): ReviewSection => ({
    name: 'Grounding', summary: r.summary.text,
    items: r.violations.map((v) => ({ bucket: 'failed' as const, title: v.line, message: v.reason, detail: [`Code: ${v.code}`] })),
  }),
  gate: (r: { summary: { text: string }; verdicts: Array<{ claim?: { text: string }; outcome: string; reason?: string }> }): ReviewSection => ({
    name: 'Source gate', summary: r.summary.text,
    items: r.verdicts.map((v) => ({ bucket: (v.outcome === 'pass' ? 'ok' : v.outcome === 'hold' || v.outcome === 'needs-corroboration' ? 'check' : 'failed') as Bucket, title: v.claim?.text ?? '', message: v.reason ?? v.outcome })),
  }),
  values: (r: Reportish<Bucketed & { claim: { value: number; period: number | string; subject?: string } }>) => section('Values', r, (v) => `${v.claim.subject ?? 'Figure'} ${v.claim.value} (${v.claim.period})`),
  links: (r: Reportish<Bucketed & { url: string }>) => section('Links', r, (v) => v.url),
  retractions: (r: Reportish<Bucketed & { doi: string }>) => section('Retractions', r, (v) => v.doi),
  legal: (r: Reportish<Bucketed & { citation: string; caseName?: string }>) => section('Case citations', r, (v) => v.citation, (v) => (v.caseName ? [`CourtListener holds: ${v.caseName}`] : undefined)),
  support: (r: Reportish<Bucketed & { claim: string; evidence?: string }>) => section('Support', r, (v) => v.claim, (v) => (v.evidence ? [`Evidence in the source: “${v.evidence}”`] : undefined)),
};

/** A whole page. Pass the sections you have; items inside each are ordered worst first. */
export function renderReview(secs: ReviewSection[], opts: ReviewOptions = {}): string {
  const title = opts.title ?? 'Assay review';
  const body = secs.map((s) => {
    const items = [...s.items].sort((a, b) => ORDER[a.bucket] - ORDER[b.bucket]);
    return `<section><h2>${escapeHtml(s.name)}</h2><p class="sum">${escapeHtml(s.summary)}</p>${items.length ? `<ul>${items.map((i) => `<li class="${i.bucket}"><span class="mark" aria-hidden="true">${MARK[i.bucket]}</span><div><strong>${escapeHtml(i.title)}</strong><span class="word">${WORD[i.bucket]}</span><p>${escapeHtml(i.message)}</p>${(i.detail ?? []).map((d) => `<p class="detail">${escapeHtml(d)}</p>`).join('')}</div></li>`).join('')}</ul>` : '<p class="none">Nothing to show.</p>'}</section>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(title)}</title><style>
:root{color-scheme:light dark;--bg:#faf9f5;--fg:#141413;--dim:#5e5d58;--rule:#dcd9cd;--bad:#a32d2d;--badw:#f5dcd6;--warn:#7a4a08;--warnw:#f3e4be;--good:#3b6d11;--goodw:#dde8cc}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#faf9f5;--dim:#a3a199;--rule:#3a3935;--bad:#f08a7b;--badw:#3d2220;--warn:#e2b04b;--warnw:#3a2c12;--good:#9bc66b;--goodw:#26341a}}
html{font-size:clamp(100%,.82rem + .32vw,125%)}body{margin:0;background:var(--bg);color:var(--fg);font:400 1rem/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:min(60rem,100% - 2rem);margin:0 auto;padding:2rem 0 4rem}h1{font:600 clamp(1.6rem,1.3rem + 1.4vw,2.4rem)/1.15 Georgia,serif;margin:0}h2{font:600 1.3rem/1.2 Georgia,serif;margin:2rem 0 .3rem}
.sub{color:var(--dim);margin:.3rem 0 0}.sum{font-weight:600;margin:0 0 .8rem}ul{list-style:none;margin:0;padding:0;display:grid;gap:.6rem}
li{display:flex;gap:.8rem;padding:.8rem 1rem;border-radius:12px;border:1px solid transparent}li p{margin:.15rem 0 0}li.failed{background:var(--badw);color:var(--bad)}li.check{background:var(--warnw);color:var(--warn)}li.ok{background:var(--goodw);color:var(--good)}li.skip{border-color:var(--rule);color:var(--dim)}
.mark{font-weight:700;width:1.2rem;flex:none}.word{margin-left:.6rem;font-size:.85rem;font-weight:600;opacity:.9}.detail{font-size:.9rem;opacity:.9}.none{color:var(--dim)}strong{overflow-wrap:anywhere}
@media print{li{break-inside:avoid}}</style></head><body><main><h1>${escapeHtml(title)}</h1>${opts.subtitle ? `<p class="sub">${escapeHtml(opts.subtitle)}</p>` : ''}${body}</main></body></html>`;
}
