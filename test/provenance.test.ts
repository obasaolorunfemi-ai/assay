import { describe, expect, it } from 'vitest';
import { enforceProvenance, extractUrls, hostOf, normalizeUrl } from '../src/provenance.js';

describe('normalizeUrl', () => {
  it('treats scheme, www, fragment, trailing slash and tracking parameters as noise', () => {
    expect(normalizeUrl('https://www.imf.org/en/Publications/WEO/?utm_source=x#top')).toBe(normalizeUrl('http://imf.org/en/Publications/WEO'));
  });
  it('keeps real query parameters, in a fixed order', () => {
    expect(normalizeUrl('https://a.org/p?b=2&a=1')).toBe('a.org/p?a=1&b=2');
  });
  it('strips punctuation copied with the link', () => {
    expect(normalizeUrl('https://a.org/report).')).toBe('a.org/report');
  });
  it('is null for anything that is not a web address', () => {
    expect(normalizeUrl('mailto:x@y.org')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl(undefined)).toBeNull();
  });
});

describe('extractUrls / hostOf', () => {
  it('finds the links in findings-style text', () => {
    const text = '  - Remittances rise — https://www.worldbank.org/en/news/x\n    publisher: World Bank\n  - (https://reuters.com/a/b).';
    expect([...extractUrls(text)]).toEqual(['worldbank.org/en/news/x', 'reuters.com/a/b']);
  });
  it('hostOf is lower case, without www, and empty for a non-address', () => {
    expect(hostOf('https://WWW.IMF.org/x')).toBe('imf.org');
    expect(hostOf('nope')).toBe('');
  });
});

describe('enforceProvenance', () => {
  const findings = '### News\n  - Reserves at $34bn — https://www.reuters.com/markets/cbn-reserves-2025-03-01/\n  - Remittances — https://www.worldbank.org/en/news/press-release/2024/remittances';
  const claim = (text: string, urls: string[]) => ({ text, category: 'context', sources: urls.map((url) => ({ url, publisher: 'x' })) });

  it('keeps a claim whose link the research produced, even tidied or carrying tracking parameters', () => {
    const r = enforceProvenance([claim('Reserves were $34bn', ['https://reuters.com/markets/cbn-reserves-2025-03-01?utm_source=feed'])], findings);
    expect(r.kept).toHaveLength(1);
    expect(r.dropped).toHaveLength(0);
  });

  it('drops a claim whose only source was never in the research', () => {
    const r = enforceProvenance([claim("Dr Obi's CV shows…", ['https://www.reuters.com/world/africa/amaka-obi-cv-2024-05-01/'])], findings);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0]!.reason).toMatch(/wasn't in the research/);
    expect(r.removed[0]!.url).toMatch(/amaka-obi-cv/);
  });

  it('removes only the invented source when a claim also has a real one', () => {
    const r = enforceProvenance([claim('Remittances rose', ['https://www.worldbank.org/en/news/press-release/2024/remittances', 'https://www.imf.org/en/Publications/Amaka-Obi-CV-2019'])], findings);
    expect(r.kept[0]!.sources!.map((s) => s.url)).toEqual(['https://www.worldbank.org/en/news/press-release/2024/remittances']);
    expect(r.removed).toHaveLength(1);
  });

  it('accepts a link that appears only in operator-supplied text', () => {
    expect(enforceProvenance([claim('x', ['https://oneremit.co/blog/rates'])], findings, 'Our post: https://oneremit.co/blog/rates').kept).toHaveLength(1);
  });

  it('leaves a claim with no sources for the gate to decide', () => {
    expect(enforceProvenance([{ text: 'no source', sources: [] }], findings).kept).toHaveLength(1);
  });

  it('never throws on odd input', () => {
    expect(() => enforceProvenance(undefined as never, undefined)).not.toThrow();
    expect(() => enforceProvenance([{ sources: [{}] }] as never, null)).not.toThrow();
  });
});
