/* Figures: does every number in a draft appear in what you supplied?
   Checked against the MATERIALS you gave (a CV, a brief, a call for proposals), not against the world: no network, deterministic,
   safe to run on private text. Catches an invented "5,000 beneficiaries" or "a 40% increase". It does not catch an invented
   name, and it does not know what a number is ABOUT: "40 women" in the materials supports "40 women" and also "40 men". */
import type { Bucket, Summary } from './types.js';
import { extractFigures, type ExtractOptions, type Figure } from './numbers.js';
import { summarizeBuckets } from './summary.js';

export { extractFigures, extractYears, evalFormula, looksLikeFormula, extractTypedNumbers, extractPlainNumbers, extractScaledNumbers, extractPercents, hasAnyNumber, numbersOverlap } from './numbers.js';
export type { ExtractOptions, Figure, TypedNumbers } from './numbers.js';

export interface FigureOptions extends ExtractOptions {
  /** Require a percentage to be supported by a percentage, and a plain number by a plain number. Default true: a "40 women" in a CV must not support an invented "40%". Turn off to match on value alone. */
  kinds?: boolean;
  /** How far apart two values may be and still count as the same, as a share of the value (0.05 is within 5%). Default 0: exact. */
  tolerance?: number;
}

export interface FigureVerdict {
  figure: Figure;
  /** True when the same value appears in the materials. */
  supported: boolean;
  bucket: Extract<Bucket, 'ok' | 'failed'>;
  message: string;
}

export interface FigureReport {
  /** One per distinct figure (a number repeated five times is judged once, at its first place). */
  verdicts: FigureVerdict[];
  summary: Summary;
  /** True when every figure is supported. */
  ok: boolean;
}

const roundKey = (n: number) => Math.round(n * 1e6) / 1e6;
const close = (a: number, b: number, tol: number) => (tol <= 0 ? roundKey(a) === roundKey(b) : Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-9));

/** Checks every figure in `draft` against the figures in `materials` (one text, or several). */
export function checkFigures(draft: string, materials: string | string[], opts: FigureOptions = {}): FigureReport {
  const kinds = opts.kinds !== false;
  const tol = opts.tolerance ?? 0;
  const sources = (Array.isArray(materials) ? materials : [materials]).flatMap((m) => extractFigures(m, opts));
  const exact = new Set(sources.map((f) => (kinds ? f.kind : '') + ':' + roundKey(f.value)));
  const supports = (f: Figure) => tol <= 0
    ? exact.has((kinds ? f.kind : '') + ':' + roundKey(f.value))
    : sources.some((m) => (!kinds || m.kind === f.kind) && close(m.value, f.value, tol));

  const seen = new Set<string>();
  const verdicts: FigureVerdict[] = [];
  for (const f of extractFigures(draft, opts)) {
    const key = (kinds ? f.kind : '') + ':' + roundKey(f.value);
    if (seen.has(key)) continue;
    seen.add(key);
    const supported = supports(f);
    verdicts.push({
      figure: f, supported, bucket: supported ? 'ok' : 'failed',
      message: supported
        ? `"${f.raw}" appears in the materials you gave.`
        : `"${f.raw}" does not appear in the materials you gave. Check it, or replace it with a blank.`,
    });
  }
  const summary = summarizeBuckets(verdicts.map((v) => v.bucket), { label: 'Figures', ok: 'supported', check: 'to check', failed: 'not in your materials', failedTail: ' — check them before using the text.' });
  return { verdicts, summary, ok: summary.failed === 0 };
}

/** The figures in `draft` whose value appears nowhere in `sources`: one per distinct value. */
export function findUnsupportedFigures(draft: string, sources: string[], opts: FigureOptions = {}): Figure[] {
  return checkFigures(draft, sources, opts).verdicts.filter((v) => !v.supported).map((v) => v.figure);
}
