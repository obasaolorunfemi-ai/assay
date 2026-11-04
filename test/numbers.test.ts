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
