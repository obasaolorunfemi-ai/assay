/* Loop: ask the model again, with what was wrong.
   A failed citation, a figure nobody supplied, an ungrounded line: instead of only removing or flagging it, tell the model what failed and let it rewrite,
   then check again, a bounded number of times. Assay keeps no model inside it: you pass `regenerate`, which calls whatever you use (Lodestone's `ai.complete`,
   for example). The loop only decides when to stop, and it never loops forever and never claims success it has not checked. */
import type { Report } from './types.js';

export interface Round { round: number; failures: string[] }
export interface LoopResult {
  /** The best text reached: the last version that was checked. */
  text: string;
  /** True when the final text passed. */
  ok: boolean;
  /** How many times the model was asked to rewrite. */
  rewrites: number;
  /** The failures found at each check, so a person can see what was fixed and what was not. */
  history: Round[];
}
export interface LoopOptions {
  text: string;
  /** Check a version of the text: say whether it passes, and list what failed in a sentence each. */
  check(text: string): Promise<{ ok: boolean; failures: string[] }>;
  /** Ask for a rewrite. `feedback` is a plain-words list of what failed; return the new text. */
  regenerate(feedback: string, text: string): Promise<string>;
  /** The most rewrites allowed. Default 2. */
  maxRewrites?: number;
}

/** Feedback for a model, in plain words, from a list of failures. */
export function feedbackFrom(failures: string[]): string {
  return `Your last draft had problems that were checked and found wrong:\n${failures.map((f, i) => `${i + 1}. ${f}`).join('\n')}\nRewrite the draft. Keep what was fine. Fix or remove each problem above. Do not invent sources, quotes, DOIs or figures to replace them: if you cannot support a statement, say less.`;
}

/** The failures in a citation report, one sentence each. */
export function citationFailures(r: Pick<Report, 'verdicts'>): string[] {
  return r.verdicts.filter((v) => v.bucket === 'failed').map((v) => `The citation "${v.citation.authors}, ${v.citation.year}${v.citation.title ? `, ${v.citation.title}` : ''}" could not be verified: ${v.message}`);
}

export async function improve(opts: LoopOptions): Promise<LoopResult> {
  const max = Math.max(0, opts.maxRewrites ?? 2);
  let text = opts.text;
  const history: Round[] = [];
  for (let rewrites = 0; ; rewrites++) {
    const c = await opts.check(text);
    history.push({ round: rewrites, failures: c.failures });
    if (c.ok) return { text, ok: true, rewrites, history };
    if (rewrites >= max) return { text, ok: false, rewrites, history };
    let next: string;
    try { next = await opts.regenerate(feedbackFrom(c.failures), text); } catch { return { text, ok: false, rewrites, history }; }
    // A rewrite that comes back empty or unchanged cannot improve anything: stop rather than check the same text again.
    if (typeof next !== 'string' || !next.trim() || next === text) return { text, ok: false, rewrites, history };
    text = next;
  }
}
