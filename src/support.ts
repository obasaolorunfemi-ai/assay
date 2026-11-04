/* Support: does the source actually say it?
   Everything else in Assay shows that something exists or is traceable. This check asks the harder question: is this sentence backed by this source text?
   Assay makes no model call and has no model in it. You supply a `judge` (a function that asks whatever model you trust) and Assay holds it to the same rule
   as everywhere else: a model may contradict, but it cannot verify. The judge must point at evidence, the evidence must be really in the source (checked
   with the quotes check, deterministic), and by default even then the best answer is "found a quote, a person should confirm it says the same".
   Numbers are checked without any model: a claim whose figure is not in the source fails before the judge is asked. */
import type { Bucket, Summary } from './types.js';
import type { Tally } from './tally.js';
import { summarizeBuckets } from './summary.js';
import { checkQuote } from './quotes.js';
import { checkFigures } from './figures.js';

/** What a judge says about one claim and one source. `evidence` is a sentence it claims to have copied out of the source. */
export interface Judgement { verdict: 'supports' | 'contradicts' | 'unrelated'; evidence?: string; note?: string }
export type Judge = (input: { claim: string; source: string }) => Promise<Judgement>;

export type SupportStatus =
  | 'evidence-found'        // the judge quoted evidence and it is really in the source (a person should still confirm it says the same)
  | 'contradicted'          // the judge quoted evidence that is really in the source and says the judge thinks it contradicts the claim
  | 'figure-not-in-source'  // a number in the claim does not appear in the source: failed without asking the judge
  | 'evidence-invented'     // the judge said "supports" and quoted something that is NOT in the source
  | 'no-evidence'           // the judge found nothing in the source that backs the claim
  | 'contradiction-unshown' // the judge said "contradicts" but could not show where
  | 'unavailable'           // the judge could not be asked, or answered in a shape Assay could not read
  | 'no-source'             // there was no source text to check against
  | 'empty-claim';

export interface SupportItem { claim: string; source: string; id?: string }
export interface SupportVerdict {
  id?: string;
  claim: string;
  status: SupportStatus;
  bucket: Bucket;
  message: string;
  /** The evidence the judge gave, when it is really in the source. */
  evidence?: string;
  /** True when asking again later may settle it. */
  retryable?: boolean;
}
export interface SupportReport { verdicts: SupportVerdict[]; summary: Summary; ok: boolean }

export interface SupportOptions {
  /** Count what this checker finds in a `Tally` of your own (numbers only). Nothing is sent anywhere: see `shareTally` if you choose to share the counts. */
  tally?: Tally;
  judge: Judge;
  /** Count "evidence found" as `ok`. Off by default: a model decided the evidence means the same as the claim, and a model cannot verify. */
  trustJudge?: boolean;
  /** How long to wait for the judge, per claim. Default 30 seconds. */
  timeoutMs?: number;
  /** How many claims are judged at once. Default 3. */
  concurrency?: number;
  /** The shortest evidence accepted, in characters (the quotes check's rule). Default 12. */
  minEvidenceChars?: number;
}
export interface Support {
  check(items: SupportItem[]): Promise<SupportReport>;
  checkOne(claim: string, source: string): Promise<SupportVerdict>;
}

const words = { label: 'Support', ok: 'backed', check: 'to confirm', failed: 'not backed', failedTail: ' — do not state the unbacked claims as fact.' };

function readJudgement(x: unknown): Judgement | null {
  if (!x || typeof x !== 'object') return null;
  const v = (x as Record<string, unknown>).verdict;
  if (v !== 'supports' && v !== 'contradicts' && v !== 'unrelated') return null;
  const e = (x as Record<string, unknown>).evidence;
  const n = (x as Record<string, unknown>).note;
  return { verdict: v, ...(typeof e === 'string' ? { evidence: e } : {}), ...(typeof n === 'string' ? { note: n.slice(0, 500) } : {}) };
}

export function createSupport(opts: SupportOptions): Support {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const concurrency = Math.max(1, opts.concurrency ?? 3);

  async function checkOne(claim: string, source: string, id?: string): Promise<SupportVerdict> {
    const base = { ...(id !== undefined ? { id } : {}), claim };
    if (!claim.trim()) return { ...base, status: 'empty-claim', bucket: 'skip', message: 'No claim was given.' };
    if (!source.trim()) return { ...base, status: 'no-source', bucket: 'skip', message: 'There was no source text to check the claim against.' };

    // Numbers first, with no model: a figure that is not in the source cannot be backed by it.
    const figs = checkFigures(claim, [source]);
    const missing = figs.verdicts.filter((v) => !v.supported);
    if (missing.length) {
      return { ...base, status: 'figure-not-in-source', bucket: 'failed', message: `The claim states ${missing.map((m) => `"${m.figure.raw}"`).join(', ')}, which does not appear in the source text, so the source cannot back it.` };
    }

    let raw: unknown;
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error('timeout')), timeoutMs); });
      try { raw = await Promise.race([opts.judge({ claim, source }), timeout]); } finally { clearTimeout(timer); }
    } catch {
      return { ...base, status: 'unavailable', bucket: 'check', retryable: true, message: 'The judge could not be asked, so this claim was not checked. That says nothing about the claim.' };
    }
    const j = readJudgement(raw);
    if (!j) return { ...base, status: 'unavailable', bucket: 'check', retryable: true, message: 'The judge answered in a shape Assay could not read, so this claim was not checked.' };

    if (j.verdict === 'unrelated') return { ...base, status: 'no-evidence', bucket: 'check', message: 'The judge found nothing in the source that backs this claim.' };

    const q = j.evidence ? checkQuote(source, j.evidence, { minChars: opts.minEvidenceChars ?? 12 }) : null;
    const shown = q?.status === 'found';
    if (j.verdict === 'supports') {
      if (!j.evidence) return { ...base, status: 'no-evidence', bucket: 'check', message: 'The judge said the source backs this claim but did not show where, so it counts for nothing.' };
      if (!shown) return { ...base, status: 'evidence-invented', bucket: 'failed', message: 'The judge said the source backs this claim and quoted a sentence that is not in the source. The evidence was invented.' };
      return { ...base, status: 'evidence-found', bucket: opts.trustJudge ? 'ok' : 'check', evidence: j.evidence, message: 'A sentence the judge pointed to is really in the source. A person should confirm that it says the same thing as the claim.' };
    }
    // contradicts
    if (shown) return { ...base, status: 'contradicted', bucket: 'failed', evidence: j.evidence!, message: 'The judge thinks the source contradicts this claim, and the sentence it pointed to is really in the source. Read it before using the claim.' };
    return { ...base, status: 'contradiction-unshown', bucket: 'check', message: 'The judge said the source contradicts this claim but did not show where, so look at it yourself.' };
  }

  return {
    checkOne: async (claim, source) => { const v = await checkOne(claim, source); opts.tally?.add('support', { verdicts: [v] }); return v; },
    async check(items) {
      const verdicts: SupportVerdict[] = new Array(items.length);
      let next = 0;
      const worker = async () => { for (;;) { const i = next++; if (i >= items.length) return; const it = items[i]!; verdicts[i] = await checkOne(it.claim, it.source, it.id); } };
      await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
      const summary = summarizeBuckets(verdicts.map((v) => v.bucket), words);
      const report = { verdicts, summary, ok: summary.failed === 0 };
      opts.tally?.add('support', report);
      return report;
    },
  };
}
