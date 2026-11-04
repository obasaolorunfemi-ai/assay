import { describe, expect, it } from 'vitest';
import { renderReview, sections } from '../src/review.js';
import { checkQuotes } from '../src/quotes.js';
import { checkFigures } from '../src/figures.js';
import { checkGrounding } from '../src/grounding.js';

describe('review page', () => {
  it('is one self-contained page that forbids scripts and requests', () => {
    const html = renderReview([{ name: 'Quotes', summary: 'Quotes: 1', items: [] }]);
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/<script|<link|<img|src=|href=/i);
    expect(html).not.toMatch(/monospace|Courier|Menlo|Consolas/i);
  });
  it('escapes everything that came from a model or the web', () => {
    const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>"\'&';
    const html = renderReview([{ name: evil, summary: evil, items: [{ bucket: 'failed', title: evil, message: evil, detail: [evil] }] }], { title: evil, subtitle: evil });
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });
  it('orders the worst first within a section', () => {
    const html = renderReview([{ name: 'S', summary: 's', items: [{ bucket: 'ok', title: 'OKITEM', message: 'm' }, { bucket: 'failed', title: 'BADITEM', message: 'm' }, { bucket: 'check', title: 'MIDITEM', message: 'm' }] }]);
    expect(html.indexOf('BADITEM')).toBeLessThan(html.indexOf('MIDITEM'));
    expect(html.indexOf('MIDITEM')).toBeLessThan(html.indexOf('OKITEM'));
  });
  it('turns the real reports into sections', () => {
    const q = sections.quotes(checkQuotes([{ id: 'a', quote: 'Relocation is available for all staff', source: 'Relocation support is available for senior staff only.' }]));
    const f = sections.figures(checkFigures('We reached 5,000 people.', ['We reached many people.']));
    const g = sections.grounding(checkGrounding('The rate moved to ₦425 [[c1]].', [{ ref: 1, text: 'The rate averaged ₦645.19.' }]));
    const html = renderReview([q, f, g], { title: 'Draft review' });
    expect(q.items[0]!.bucket).toBe('failed');
    expect(f.items[0]).toMatchObject({ bucket: 'failed', title: '5,000' });
    expect(g.items[0]!.detail).toEqual(['Code: figure-mismatch']);
    expect(html).toContain('Do not rely on this');
    expect(html).toContain('Draft review');
  });
});
