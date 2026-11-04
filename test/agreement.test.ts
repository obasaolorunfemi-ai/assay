import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script module with no types
import { agreement, cohenKappa, wilson } from '../scripts/agreement-lib.mjs';

const rep = (n: number, v: string) => Array(n).fill(v) as string[];
describe('labeller agreement', () => {
  it('Cohen kappa on the textbook example (20 yes-yes, 5 yes-no, 10 no-yes, 15 no-no) is 0.4', () => {
    const a = [...rep(20, 'yes'), ...rep(5, 'yes'), ...rep(10, 'no'), ...rep(15, 'no')];
    const b = [...rep(20, 'yes'), ...rep(5, 'no'), ...rep(10, 'yes'), ...rep(15, 'no')];
    expect(agreement(a, b)).toBeCloseTo(0.7, 10);
    expect(cohenKappa(a, b)).toBeCloseTo(0.4, 10);
  });
  it('identical labels give kappa 1, and chance-level agreement gives about 0', () => {
    const a = ['real', 'invented', 'real', 'invented'];
    expect(cohenKappa(a, a)).toBe(1);
    expect(cohenKappa(['real', 'real', 'invented', 'invented'], ['real', 'invented', 'real', 'invented'])).toBeCloseTo(0, 10);
  });
  it('refuses lists that cannot be compared', () => {
    expect(() => agreement(['a'], ['a', 'b'])).toThrow();
    expect(() => agreement([], [])).toThrow();
  });
  it('the Wilson interval is wide at small n and narrow at large n, and stays inside 0 to 1', () => {
    const [l1, h1] = wilson(27, 30), [l2, h2] = wilson(900, 1000);
    expect(h1 - l1).toBeGreaterThan(h2 - l2);
    expect(wilson(30, 30)[1]).toBeLessThanOrEqual(1);
    expect(wilson(0, 30)[0]).toBe(0);
    expect(wilson(0, 0)).toEqual([0, 1]);
  });
});
