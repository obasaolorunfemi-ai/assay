/* Numbers in text: what they say, in whatever notation, and a safe way to do arithmetic on them. Shared by the modules that
   check figures (figures), compare a claimed number with a source's (values) and trace a draft to approved claims (grounding).
   No network, no dependencies. */

const UNITS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const ONES: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { hundred: 100, thousand: 1_000, million: 1_000_000, billion: 1_000_000_000 };

// Digits not glued to a letter ("B2B", "Q3", "COVID-19"), with an optional unit: %, k/m/mn/bn directly attached, or a spelled-out scale after a space.
const DIGIT_RE = /(?<![A-Za-z]|[A-Za-z]-)\d+(?:,\d{3})*(?:\.\d+)?(?:%|k\b|mn\b|bn\b|m\b|\s+(?:percent|per\s?cent|million|billion|thousand|hundred)\b)?/gi;

const WORD_RE = new RegExp(
  '\\b(?:(?:' + Object.keys(TENS).join('|') + ')(?:[-\\s](?:' + Object.keys(ONES).join('|') + '))?|' +
    Object.keys(UNITS).join('|') + ')(?:\\s+(?:' + Object.keys(SCALES).join('|') + '))?\\b',
  'gi',
);

/** A number found in text. */
export interface Figure {
  /** As written ("40%", "1.5m", "twenty-five"). */
  raw: string;
  /** Its value, fully expanded (1.5m is 1500000; 40% is 40, not 0.4). */
  value: number;
  /** 'percent' for a percentage; 'number' for everything else. A 40% and a 40 are never the same figure. */
  kind: 'percent' | 'number';
  /** Where it starts in the text you gave. */
  index: number;
}

export interface ExtractOptions {
  /** Parts of the text that are not claims and must not count (for example your own placeholder syntax: /\[ADD:[^\]]*\]/gi). */
  ignore?: RegExp[];
}

const blank = (s: string, re: RegExp): string => s.replace(re.global ? re : new RegExp(re.source, re.flags + 'g'), (m) => ' '.repeat(m.length));

function digitValue(raw: string): number | null {
  const m = raw.toLowerCase().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)(.*)$/);
  if (!m) return null;
  let value = parseFloat(m[1]!);
  if (Number.isNaN(value)) return null;
  const suffix = m[2]!.trim();
  if (suffix === 'k' || suffix === 'thousand') value *= 1_000;
  else if (suffix === 'm' || suffix === 'mn' || suffix === 'million') value *= 1_000_000;
  else if (suffix === 'bn' || suffix === 'billion') value *= 1_000_000_000;
  else if (suffix === 'hundred') value *= 100;
  return value;
}

function wordValue(raw: string): number | null {
  const parts = raw.toLowerCase().split(/[-\s]+/).filter(Boolean);
  let value = 0, scale = 1;
  for (const p of parts) {
    if (p in TENS) value += TENS[p]!;
    else if (p in ONES && value >= 20) value += ONES[p]!;
    else if (p in UNITS) value += UNITS[p]!;
    else if (p in SCALES) scale = SCALES[p]!;
    else return null;
  }
  return value === 0 ? null : value * scale;
}

/**
 * Every number in the text, however it is written: 5,000, 12.5, 40%, 40 percent, 50k, 1.5m, 2 million, three, twenty-five.
 * Left out on purpose: "one" (too often a pronoun), ordinals ("40th"), list numbering ("1. "), digits glued to letters (B2B, Q3).
 * Years are figures like any other.
 */
export function extractFigures(text: string, opts: ExtractOptions = {}): Figure[] {
  let clean = String(text ?? '');
  for (const re of opts.ignore ?? []) clean = blank(clean, re);
  clean = clean.replace(/^([ \t]*)(\d+)([.)]\s+)/gm, (_m, a: string, n: string, c: string) => a + ' '.repeat(n.length) + c);
  const out: Figure[] = [];
  for (const m of clean.matchAll(DIGIT_RE)) {
    const at = m.index ?? 0;
    // "1st", "40th": ordinals are positions, not quantities.
    const after = clean.slice(at + m[0].length, at + m[0].length + 2).toLowerCase();
    if (/^(st|nd|rd|th)/.test(after) && !/%|k|m|bn|mn$/i.test(m[0])) continue;
    const value = digitValue(m[0]);
    if (value !== null) out.push({ raw: m[0].trim(), value, kind: /%|percent|per\s?cent/i.test(m[0]) ? 'percent' : 'number', index: at });
  }
  for (const m of clean.matchAll(WORD_RE)) {
    const value = wordValue(m[0]);
    if (value !== null) out.push({ raw: m[0].trim(), value, kind: 'number', index: m.index ?? 0 });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Every distinct 4-digit year (1900 to 2099) in the text, in order. */
export function extractYears(text: string): number[] {
  return [...new Set([...String(text ?? '').matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0])))];
}

// ── Safe arithmetic ──────────────────────────────────────────────────────────────────────────────────────────────────────
// For formulas such as "c3*0.15": +, -, *, /, parentheses, decimal literals and names like c3, evaluated WITHOUT eval() or Function().
// Anything else throws, as does an unknown name or a division by zero.

type Token = { t: 'num' | 'ref' | 'op'; v: string | number };
const TOKEN_RE = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_]\w*)|([+\-*/()]))/gy;

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  const s = String(expr ?? '').trim();
  let idx = 0;
  while (idx < s.length) {
    TOKEN_RE.lastIndex = idx;
    const m = TOKEN_RE.exec(s);
    if (!m || m.index !== idx) throw new Error(`unrecognized character at "${s.slice(idx, idx + 8)}"`);
    idx = TOKEN_RE.lastIndex;
    if (m[1] !== undefined) tokens.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: 'ref', v: m[2] });
    else if (m[3] !== undefined) tokens.push({ t: 'op', v: m[3] });
  }
  return tokens;
}

/** Evaluates an arithmetic expression over named values (`{ c3: 645, c7: 1518 }`). Throws on a parse error, an unknown name, or division by zero: treat "cannot evaluate" as "cannot verify", never as a pass. */
export function evalFormula(expr: string, values: Record<string, number>): number {
  const tokens = tokenize(expr);
  if (!tokens.length) throw new Error('empty expression');
  if (tokens.length > 200) throw new Error('expression too long');
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (t: Token | undefined, v: string) => !!t && t.t === 'op' && t.v === v;

  function factor(depth: number): number {
    if (depth > 50) throw new Error('expression too deeply nested');
    const t = tokens[pos];
    if (!t) throw new Error('unexpected end of expression');
    if (isOp(t, '-')) { pos++; return -factor(depth + 1); }
    if (isOp(t, '(')) {
      pos++;
      const v = sum(depth + 1);
      if (!isOp(peek(), ')')) throw new Error('expected )');
      pos++;
      return v;
    }
    if (t.t === 'num') { pos++; return t.v as number; }
    if (t.t === 'ref') {
      pos++;
      if (!Object.prototype.hasOwnProperty.call(values, t.v as string)) throw new Error(`no value for ${t.v}`);
      return values[t.v as string]!;
    }
    throw new Error(`unexpected token "${t.v}"`);
  }
  function product(depth: number): number {
    let v = factor(depth);
    while (isOp(peek(), '*') || isOp(peek(), '/')) {
      const op = tokens[pos++]!.v;
      const r = factor(depth);
      if (op === '/') { if (r === 0) throw new Error('division by zero'); v /= r; } else v *= r;
    }
    return v;
  }
  function sum(depth: number): number {
    let v = product(depth);
    while (isOp(peek(), '+') || isOp(peek(), '-')) {
      const op = tokens[pos++]!.v;
      const r = product(depth);
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  const result = sum(0);
  if (pos !== tokens.length) throw new Error('trailing input after expression');
  return result;
}

/** True when the text uses an operator (a formula), rather than being a bare list of names like "c3,c7". */
export function looksLikeFormula(expr: string): boolean {
  return /[+\-*/()]/.test(String(expr ?? ''));
}

// ── Numbers by kind ──────────────────────────────────────────────────────────────────────────────────────────────────────
// A $14bn total, a ₦645 rate and a 62% ratio are different KINDS of figure, so they are never compared with each other.

// Every repetition is bounded (a figure longer than about 40 characters is not a figure): an unbounded `\d[\d,]*` followed by a suffix that usually fails is quadratic on a long run of digits.
const PLAIN_NUM_RE = /([₦$€£])?\s?(\d[\d,]{0,40}(?:\.\d{1,20})?)\b(?!\s?(?:bn|billion|m\b|million|trillion|%|percent))/gi;
const SCALED_NUM_RE = /[₦$€£]?\s?(\d[\d,]{0,40}(?:\.\d{1,20})?)\s?(bn|billion|m\b|million|trillion)\b/gi;
const PERCENT_RE = /(\d[\d,]{0,40}(?:\.\d{1,20})?)\s?(?:%|percent\b)/gi;
const SCALE: Record<string, number> = { bn: 1e9, billion: 1e9, m: 1e6, million: 1e6, trillion: 1e12 };
const plainNum = (s: string) => Number(String(s).replace(/,/g, ''));

/** Plain numbers: the shape a rate, a price or a count has (₦645, 1,518). A bare four-digit number with no currency symbol, in 1900 to 2099, is a year, and left out (see `extractYears`). */
export function extractPlainNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of String(text ?? '').matchAll(PLAIN_NUM_RE)) {
    const v = plainNum(m[2]!);
    if (!Number.isFinite(v)) continue;
    if (!m[1] && /^\d{4}$/.test(m[2]!) && v >= 1900 && v <= 2099) continue;
    out.push(v);
  }
  return out;
}
/** Scaled totals, fully expanded: "$14.06 billion" is 14060000000. */
export function extractScaledNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of String(text ?? '').matchAll(SCALED_NUM_RE)) {
    const v = plainNum(m[1]!), scale = SCALE[m[2]!.toLowerCase()];
    if (Number.isFinite(v) && scale) out.push(v * scale);
  }
  return out;
}
/** Percentages, kept as percentages: 62.23% is 62.23, not 0.6223. */
export function extractPercents(text: string): number[] {
  const out: number[] = [];
  for (const m of String(text ?? '').matchAll(PERCENT_RE)) { const v = plainNum(m[1]!); if (Number.isFinite(v)) out.push(v); }
  return out;
}

export interface TypedNumbers { plain: number[]; scaled: number[]; percent: number[] }
/** Every number in the text, kept apart by kind. */
export function extractTypedNumbers(text: string): TypedNumbers {
  return { plain: extractPlainNumbers(text), scaled: extractScaledNumbers(text), percent: extractPercents(text) };
}
export const hasAnyNumber = (t: TypedNumbers): boolean => t.plain.length + t.scaled.length + t.percent.length > 0;

/** Does any number in `a` match a number of the same kind in `b`, within a relative tolerance (default 5%)? */
export function numbersOverlap(a: TypedNumbers, b: TypedNumbers, tolerance = 0.05): boolean {
  for (const kind of ['plain', 'scaled', 'percent'] as const) {
    for (const x of a[kind]) for (const y of b[kind]) {
      if (Math.abs(x - y) / Math.max(Math.abs(y), 1e-9) <= tolerance) return true;
    }
  }
  return false;
}
