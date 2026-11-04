import { describe, expect, it } from 'vitest';
import { evalFormula, looksLikeFormula } from '../src/numbers.js';

describe('looksLikeFormula (Content Engine\'s cases)', () => {
  it('treats an operator-bearing expression as a formula', () => {
    expect(looksLikeFormula('c3*0.15')).toBe(true);
    expect(looksLikeFormula('(c3-c7)/c7*100')).toBe(true);
  });
  it('treats a bare comma list as NOT a formula', () => {
    expect(looksLikeFormula('c3,c7')).toBe(false);
  });
});

describe('evalFormula (Content Engine\'s cases)', () => {
  it('evaluates +, -, *, / and parentheses over named values', () => {
    expect(evalFormula('c3*0.15', { c3: 100 })).toBe(15);
    expect(evalFormula('c3+c7', { c3: 10, c7: 5 })).toBe(15);
    expect(evalFormula('(c3-c7)/c7*100', { c3: 1518, c7: 645 })).toBeCloseTo(135.35, 1);
  });
  it('respects precedence and unary minus', () => {
    expect(evalFormula('2+3*4', {})).toBe(14);
    expect(evalFormula('-(2+3)*2', {})).toBe(-10);
    expect(evalFormula('10-2-3', {})).toBe(5);
  });
  it('throws on division by zero', () => {
    expect(() => evalFormula('c3/0', { c3: 10 })).toThrow(/division by zero/);
  });
  it('throws on an unknown name', () => {
    expect(() => evalFormula('c3+c9', { c3: 10 })).toThrow(/no value for c9/);
  });
  it('throws on malformed syntax rather than guessing', () => {
    expect(() => evalFormula('c3+', { c3: 10 })).toThrow();
    expect(() => evalFormula('c3 c7', { c3: 1, c7: 1 })).toThrow();
    expect(() => evalFormula('', {})).toThrow(/empty/);
    expect(() => evalFormula('(1+2', {})).toThrow();
  });
});

describe('evalFormula cannot be used to run code', () => {
  it('rejects anything that is not arithmetic', () => {
    for (const bad of ['process.exit()', 'alert(1)', '1; 2', '1 + `x`', 'a.b', '1 ** 2', 'c3["x"]', '(1)(2)']) expect(() => evalFormula(bad, { c3: 1, a: 1 })).toThrow();
  });
  it('does not read inherited properties as values', () => {
    for (const n of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(() => evalFormula(n, {})).toThrow(/no value for/);
  });
  it('is bounded: a very long or deeply nested expression is refused, not run', () => {
    expect(() => evalFormula('1+'.repeat(500) + '1', {})).toThrow(/too long/);
    expect(() => evalFormula('('.repeat(60) + '1' + ')'.repeat(60), {})).toThrow(/nested/);
  });
});

import { extractPercents, extractPlainNumbers, extractScaledNumbers, extractTypedNumbers, extractYears, hasAnyNumber, numbersOverlap } from '../src/numbers.js';

describe('numbers by kind (Content Engine\'s cases)', () => {
  it('finds every distinct 4-digit year', () => expect(extractYears('moved from ₦645 in 2023 to ₦1,518 in 2025')).toEqual([2023, 2025]));
  it('plain numbers: rates and counts, but not a bare year or a scaled or percent figure', () => {
    expect(extractPlainNumbers('moved from ₦645 to ₦1,518')).toEqual(expect.arrayContaining([645, 1518]));
    expect(extractPlainNumbers('the rate averaged 645.19 in 2023')).not.toContain(2023);
    expect(extractPlainNumbers('the fee was ₦1955')).toContain(1955);
    expect(extractPlainNumbers('imports reached $14.06 billion')).not.toContain(14.06);
    expect(extractPlainNumbers('the gap widened past 62.23%')).not.toContain(62.23);
  });
  it('scaled numbers expand billion, million and trillion', () => expect(extractScaledNumbers('$14.06 billion and $25.74bn')).toEqual([14.06e9, 25.74e9]));
  it('percentages stay as percentages', () => expect(extractPercents('widened past 62.23%')).toEqual([62.23]));
  it('overlap is within tolerance and never across kinds', () => {
    expect(numbersOverlap(extractTypedNumbers('$14.06 billion'), extractTypedNumbers('about $14 billion'))).toBe(true);
    expect(numbersOverlap(extractTypedNumbers('₦645'), extractTypedNumbers('$645 billion'))).toBe(false);
    expect(numbersOverlap(extractTypedNumbers('425'), extractTypedNumbers('645'))).toBe(false);
    expect(hasAnyNumber(extractTypedNumbers('no figures here'))).toBe(false);
  });
});
