/* Grounding: does every figure in a draft trace to an approved claim?
   A model that tags its own sentence "[[c3]]" has proved nothing until something checks that c3 exists, that the sentence's OWN figure matches
   c3's figure, and that a line carrying a number carries a tag that can justify a number at all. This does that, against the list of approved
   claims you give it: no network, no model, deterministic, safe on private text. It checks that a figure is TRACEABLE and matches, not that the claim is true.
   The tag syntax is a convention of whoever writes the prompt; it is a parameter here, and `[[c3]]` is only the default. */
import type { Summary } from './types.js';
import { evalFormula, extractTypedNumbers, hasAnyNumber, looksLikeFormula, numbersOverlap } from './numbers.js';
import { summarizeBuckets } from './summary.js';

export interface TagFormat {
  /** What wraps a tag. Default `[[` and `]]`. */
  open: string;
  close: string;
  /** The letter before a claim number: `c` gives c3. */
  claim: string;
  /** Names for the other tags: `[[calc: c3*0.15]]`, `[[logic]]`, `[[eg]]`. */
  calc: string;
  logic: string;
  example: string;
  /** A marker that says "chase this before publishing", written in single brackets: `[verify: …]`. */
  verify: string;
}
export const defaultTagFormat: TagFormat = { open: '[[', close: ']]', claim: 'c', calc: 'calc', logic: 'logic', example: 'eg', verify: 'verify' };

export interface GroundingClaim { ref: number; text: string }

export type ViolationCode = 'untagged-figure' | 'unknown-claim' | 'logic-figure' | 'figure-mismatch' | 'calc-mismatch' | 'calc-no-refs' | 'calc-unreadable';
export interface GroundingViolation {
  /** Always 'figure': kept for callers that group by it. */
  kind: 'figure';
  code: ViolationCode;
  line: string;
  reason: string;
}
export interface GroundingWarning { line: string; reason: string }

export interface GroundingReport {
  ok: boolean;
  violations: GroundingViolation[];
  /** Things that could not be verified but are not violations: a calculation given only as a list of claims, or one built on a claim that states no number. */
  warnings: GroundingWarning[];
  calcLines: string[];
  verifyMarkers: string[];
  refsUsed: number[];
  coverage: { used: number; total: number };
  /** One line per run: how many factual lines were checked, and how many were not grounded. */
  summary: Summary;
}

export interface GroundingOptions {
  /** Claim 0 is allowed when your own platform data was supplied to the writer. Default false. */
  hasPlatformData?: boolean;
  tags?: Partial<TagFormat>;
  /** How far a line's figure may be from its claim's and still match (share of the value). Default 5%. */
  tolerance?: number;
  /** How far a calculated result may be from the line's figure. Default 8%: rounding compounds across claims. */
  calcTolerance?: number;
  /** Plain words that make a small number a figure ("12 years", "three postings"), added to the built-in list. Give the singular; the plural is matched too (`container` matches container and containers). */
  countUnits?: string[];
  /** Most lines read per draft. Default 5000. */
  maxLines?: number;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const FIGURE_RE = /(₦|\$|€|£|N\s?\d)|\b\d+(\.\d+)?\s?%|\b\d{4}\b|\b\d[\d,]{2,}\b|\b\d+(\.\d+)?\s?(bn|billion|m|million|trillion|bbl|barrels?|basis points|bps|percent|kt|tonnes?|mbpd|litres?)\b/i;
// Small counts with a unit are figures too: "12 years at the bank" and "three postings" walked straight through a check that only saw big numbers.
const COUNT_UNITS = ['years?', 'months?', 'weeks?', 'days?', 'hours?', 'people', 'persons', 'staff', 'employees', 'countries', 'banks', 'branches', 'offices', 'postings', 'roles', 'jobs', 'firms', 'companies', 'customers', 'users', 'clients', 'transfers', 'transactions', 'times', 'decades?', 'percentage points'];
const NUMBER_WORDS = 'two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|dozens?';

const STRUCTURAL_RE = /^(#{1,6}\s|```)/;
const LIST_MARKER_RE = /^(?:>\s*|[-*•]\s+|\d+[.)]\s+)+/;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]+\|?\s*$/;

function compile(fmt: TagFormat, extraUnits: string[]) {
  const o = esc(fmt.open), c = esc(fmt.close), k = esc(fmt.claim);
  const units = [...COUNT_UNITS, ...extraUnits.map((w) => `${esc(String(w).trim())}s?`).filter((w) => w !== 's?')].join('|');
  return {
    claimTag: new RegExp(`${o}\\s*${k}\\s*\\d+(?:\\s*,\\s*${k}?\\s*\\d+)*\\s*${c}`, 'gi'),
    // Every pattern that scans for a closing bracket is bounded: an unclosed opening in a megabyte of text must not make each position scan to the end.
    calcTag: new RegExp(`${o}\\s*${esc(fmt.calc)}(?:\\s*:\\s*([^\\]]{0,300}?))?\\s*${c}`, 'gi'),
    logicTag: new RegExp(`${o}\\s*${esc(fmt.logic)}\\s*${c}`, 'gi'),
    exampleTag: new RegExp(`${o}\\s*${esc(fmt.example)}\\s*${c}`, 'gi'),
    anyTag: new RegExp(`${o}[^\\]]{0,300}${c}`, 'g'),
    ref: new RegExp(`${k}(\\d+)`, 'gi'),
    verify: new RegExp(`\\[${esc(fmt.verify)}:\\s*([^\\]]{1,300})\\]`, 'gi'),
    figure: new RegExp(`${FIGURE_RE.source}|\\b\\d{1,3}\\s?(?:${units})\\b|\\b(?:${NUMBER_WORDS})\\s+(?:${units})\\b`, 'i'),
  };
}

/** Checks a draft (Markdown) against the claims that were approved for it. Everything under a "## Sources" heading is left out. Never throws. */
export function checkGrounding(draft: string, claims: GroundingClaim[], opts: GroundingOptions = {}): GroundingReport {
  const fmt: TagFormat = { ...defaultTagFormat, ...opts.tags };
  const re = compile(fmt, opts.countUnits ?? []);
  const tol = opts.tolerance ?? 0.05, calcTol = opts.calcTolerance ?? 0.08;
  const claimList = Array.isArray(claims) ? claims.filter((c) => c && Number.isInteger(c.ref)) : [];
  const claimText = new Map(claimList.map((c) => [c.ref, String(c.text ?? '')]));
  const maxRef = claimList.length ? Math.max(...claimList.map((c) => c.ref)) : 0;
  const minRef = opts.hasPlatformData ? 0 : 1;
  // A ref is valid when it names a claim you actually gave (c0 only with platform data).
  const valid = (r: number) => (r === 0 ? !!opts.hasPlatformData : claimText.has(r));

  const violations: GroundingViolation[] = [], warnings: GroundingWarning[] = [], calcLines: string[] = [], verifyMarkers: string[] = [];
  const refsUsed = new Set<number>();
  const lineBuckets: Array<'ok' | 'failed'> = [];
  const add = (code: ViolationCode, line: string, reason: string) => violations.push({ kind: 'figure', code, line: line.slice(0, 200), reason });
  const unknown = (r: number) => `tag points at claim ${fmt.claim}${r}, which doesn't exist (valid: ${fmt.claim}${minRef}–${fmt.claim}${maxRef})`;

  const text = typeof draft === 'string' ? draft : '';
  const beforeSources = text.split(/^##\s*Sources\s*$/im)[0] ?? '';
  const lines = beforeSources.split(/\n+/).slice(0, opts.maxLines ?? 5000);

  // A fence line only marks where a fence opens or closes; everything BETWEEN a pair of fences (a chart's raw JSON, a code block) is data, not prose.
  let inFence = false;
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (!line || STRUCTURAL_RE.test(line) || TABLE_SEP_RE.test(line)) continue;
    line = line.replace(LIST_MARKER_RE, '').trim();
    if (!line) continue;

    // [verify: …] markers are intentional ("chase this before publishing"): collect them, then remove them so they do not trip the untagged-figure check.
    for (const m of line.matchAll(re.verify)) verifyMarkers.push(m[1]!.trim());
    line = line.replace(re.verify, '').trim();
    if (!line) continue;

    const before = violations.length;
    const claimTags = line.match(re.claimTag) ?? [];
    const calcMatches = [...line.matchAll(re.calcTag)];
    const logicTags = line.match(re.logicTag) ?? [];
    const exampleTags = line.match(re.exampleTag) ?? [];
    const bare = line.replace(re.anyTag, '').trim();
    const lineHasFigure = re.figure.test(bare);

    const claimRefs: number[] = [];
    for (const tag of claimTags) {
      for (const m of tag.matchAll(re.ref)) {
        const r = Number(m[1]);
        if (!valid(r)) add('unknown-claim', line, unknown(r));
        else { refsUsed.add(r); claimRefs.push(r); }
      }
    }

    if (calcMatches.length) calcLines.push(bare.slice(0, 200));
    for (const m of calcMatches) {
      const inner = (m[1] ?? '').trim();
      if (!inner) { add('calc-no-refs', line, `${fmt.open}${fmt.calc}${fmt.close} with no referenced claims: a calculation must name what it's built from`); continue; }
      const refs = [...inner.matchAll(re.ref)].map((r) => Number(r[1]));
      if (!refs.length) { add('calc-no-refs', line, `${fmt.open}${fmt.calc}${fmt.close} with no ${fmt.claim}N references: a calculation must name what it's built from`); continue; }
      let refsOk = true;
      const values: Record<string, number> = {};
      for (const r of refs) {
        if (!valid(r)) { refsOk = false; add('unknown-claim', line, `calc points at claim ${fmt.claim}${r}, which doesn't exist (valid: ${fmt.claim}${minRef}–${fmt.claim}${maxRef})`); continue; }
        refsUsed.add(r);
        const n = extractTypedNumbers(claimText.get(r) ?? '');
        const v = n.plain[0] ?? n.scaled[0] ?? n.percent[0];
        if (v !== undefined) values[`${fmt.claim}${r}`] = v;
      }
      if (!refsOk) continue;
      if (!looksLikeFormula(inner)) {
        // A bare list of claims names its inputs but cannot be re-run. It is traced, and said so.
        warnings.push({ line: line.slice(0, 200), reason: 'a calculation given only as a list of claims: its inputs are traced, but the arithmetic was not re-run' });
        continue;
      }
      if (!refs.every((r) => `${fmt.claim}${r}` in values)) { warnings.push({ line: line.slice(0, 200), reason: 'a calculation built on a claim that states no number, so it could not be re-run' }); continue; }
      try {
        const computed = evalFormula(inner, values);
        const lineNums = extractTypedNumbers(bare);
        if (hasAnyNumber(lineNums) && !numbersOverlap(lineNums, { plain: [computed], scaled: [computed], percent: [computed] }, calcTol)) {
          add('calc-mismatch', line, `calc ${inner} = ${computed.toLocaleString('en-US', { maximumFractionDigits: 2 })}, but the line doesn't state that`);
        }
      } catch {
        // A formula that cannot be read must not be a way to carry a figure unchecked: it was written to be re-run, so it is a violation.
        add('calc-unreadable', line, `calc "${inner}" cannot be evaluated, so the figure it supports was not checked: write it as arithmetic over claims`);
      }
    }

    const justified = claimTags.length + calcMatches.length + exampleTags.length > 0;
    if (lineHasFigure && !justified) {
      if (logicTags.length) add('logic-figure', line, `states a figure tagged only ${fmt.open}${fmt.logic}${fmt.close}: reasoning tags can't justify a number; cite a claim, use ${fmt.open}${fmt.calc}: …${fmt.close}, or mark it ${fmt.open}${fmt.example}${fmt.close} if it's a worked example`);
      else add('untagged-figure', line, 'states a number / rate / date with no tag: not traceable to a source');
    }

    // The line's OWN figure against its cited claim's figure.
    if (lineHasFigure && claimRefs.length) {
      const lineNums = extractTypedNumbers(bare);
      if (hasAnyNumber(lineNums)) {
        const sets = claimRefs.map((r) => extractTypedNumbers(claimText.get(r) ?? '')).filter(hasAnyNumber);
        if (sets.length && !sets.some((cn) => numbersOverlap(lineNums, cn, tol))) {
          add('figure-mismatch', line, `states a figure that doesn't match ${fmt.claim}${claimRefs.join(`/${fmt.claim}`)}'s stated figure: possible mis-citation`);
        }
      }
    }
    lineBuckets.push(violations.length > before ? 'failed' : 'ok');
  }

  const summary = summarizeBuckets(lineBuckets, { label: 'Lines', ok: 'grounded', check: 'to check', failed: 'not grounded', failedTail: ' — do not publish the flagged lines as they stand.' });
  return {
    ok: violations.length === 0, violations, warnings, calcLines, verifyMarkers,
    refsUsed: [...refsUsed].sort((a, b) => a - b),
    coverage: { used: refsUsed.size, total: claimList.length + (opts.hasPlatformData ? 1 : 0) },
    summary,
  };
}

/** Removes the tags for the published text, tidying the spacing. `[verify: …]` markers stay (they are for the editor) unless `dropVerify` is set. */
export function stripTags(markdown: string, opts: { dropVerify?: boolean; tags?: Partial<TagFormat> } = {}): string {
  const fmt: TagFormat = { ...defaultTagFormat, ...opts.tags };
  const re = compile(fmt, []);
  let out = String(markdown ?? '').replace(re.anyTag, '');
  if (opts.dropVerify) out = out.replace(re.verify, '');
  return out.replace(/[ \t]+([.,;:)])/g, '$1').replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n');
}
