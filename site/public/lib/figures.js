import { extractFigures } from './numbers.js';
import { summarizeBuckets } from './summary.js';
export { extractFigures, extractYears, evalFormula, looksLikeFormula, extractTypedNumbers, extractPlainNumbers, extractScaledNumbers, extractPercents, hasAnyNumber, numbersOverlap } from './numbers.js';
const roundKey = (n) => Math.round(n * 1e6) / 1e6;
const close = (a, b, tol) => (tol <= 0 ? roundKey(a) === roundKey(b) : Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-9));
/** Checks every figure in `draft` against the figures in `materials` (one text, or several). */
export function checkFigures(draft, materials, opts = {}) {
    const kinds = opts.kinds !== false;
    const tol = opts.tolerance ?? 0;
    const sources = (Array.isArray(materials) ? materials : [materials]).flatMap((m) => extractFigures(m, opts));
    const exact = new Set(sources.map((f) => (kinds ? f.kind : '') + ':' + roundKey(f.value)));
    const supports = (f) => tol <= 0
        ? exact.has((kinds ? f.kind : '') + ':' + roundKey(f.value))
        : sources.some((m) => (!kinds || m.kind === f.kind) && close(m.value, f.value, tol));
    const seen = new Set();
    const verdicts = [];
    for (const f of extractFigures(draft, opts)) {
        const key = (kinds ? f.kind : '') + ':' + roundKey(f.value);
        if (seen.has(key))
            continue;
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
export function findUnsupportedFigures(draft, sources, opts = {}) {
    return checkFigures(draft, sources, opts).verdicts.filter((v) => !v.supported).map((v) => v.figure);
}
