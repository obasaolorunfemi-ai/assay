import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain JavaScript example, no types
import { gate, policy } from '../examples/gate-policy-markets-and-trade.mjs';

const claim = (text: string, category: string, urls: string[]) => ({ text, category, sources: urls.map((url) => ({ url, date: '2020-01-01' })) });

describe('the markets-and-trade example policy', () => {
  it('ranks the bodies and outlets it names, and keeps the neutral defaults', () => {
    const d = policy.domains;
    expect([d['wfp.org'], d['kpler.com'], d['dallasfed.org'], d['nairametrics.com'], d['reuters.com'], d['wikipedia.org']]).toEqual([1, 2, 2, 3, 3, 4]);
    expect(policy.unlistedTier).toBe(3);
  });
  it('a loss estimate backed only by the press is dropped; the same claim with a specialist passes', () => {
    const press = gate.check([claim('Delays cost traders an estimated $400m.', 'loss-estimate', ['https://www.reuters.com/a', 'https://www.bloomberg.com/b'])]);
    expect(press.dropped).toHaveLength(1);
    const withSpecialist = gate.check([claim('Delays cost traders an estimated $400m.', 'loss-estimate', ['https://www.reuters.com/a', 'https://www.kpler.com/b'])]);
    expect(withSpecialist.passed).toHaveLength(1);
  });
  it('a plain event is fine on one reputable outlet, and a central bank is an authority by suffix', () => {
    expect(gate.check([claim('A strike began at the port.', 'event', ['https://www.reuters.com/a'])]).passed).toHaveLength(1);
    expect(gate.check([claim('The central bank held its rate.', 'event', ['https://www.cbn.gov.ng/a'])]).passed).toHaveLength(1);
  });
  it('an encyclopaedia alone is never enough', () => {
    expect(gate.check([claim('The price was X.', 'event', ['https://en.wikipedia.org/wiki/X'])]).dropped).toHaveLength(1);
  });
});
