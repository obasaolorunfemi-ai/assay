// Text that Assay reads usually comes from an AI model, which means from whoever wrote the prompt. A pattern that is fine on normal text can take
// minutes on a long run of one character, and CodeQL flagged exactly that ("polynomial regular expression"). So every public function is run against
// the awkward shapes at a size where anything quadratic fails by a wide margin. If this test is slow, a pattern has become quadratic: bound it
// (see strutil.ts), do not raise the budget.
import { describe, expect, it } from 'vitest';
import { checkFigures, checkGrounding, checkQuote, createGate, doiFromUrl, evalFormula, extractFigures, extractTypedNumbers, isSafeAddress, linkKind, nameKey, parseCitations, splitAuthors, strip, stripTags, summariseRecency, titleSimilarity, worldBankUrlInfo } from '../src/entry.js';

const N = 30_000;
const families: Record<string, string> = {
  spaces: ' '.repeat(N) + 'x', digits: '9'.repeat(N), digitsThenWord: '1'.repeat(N) + 'x', commas: '1,'.repeat(N / 2) + 'x', dots: '.'.repeat(N) + 'x', dotsDigits: '1.'.repeat(N / 2) + 'x',
  dashes: '-'.repeat(N), openBrackets: '['.repeat(N), tags: '[[c1]] '.repeat(N / 7), openTag: '[[' + 'a'.repeat(N), quotesAndDashes: '"a — '.repeat(N / 5), etal: 'et al '.repeat(N / 6),
  years: '2023 '.repeat(N / 5), ssrn: 'ssrn.com/'.repeat(N / 9) + 'x', scholar: 'scholar.google.'.repeat(N / 15) + 'x', words: 'word '.repeat(N / 5), spaceNewline: ' \n'.repeat(N / 2) + 'x',
  mixed: ('$1,2.3% ' + '(a) ').repeat(N / 12), commasAndSpaces: ', '.repeat(N / 2) + 'x', quotes: "'".repeat(N) + 'x', percent: '9'.repeat(N) + ' ', hostDots: 'a.'.repeat(N / 2) + 'com',
};
const cit = (t: string) => ({ raw: t, tag: `[${t}]`, authors: t, year: '2001', title: t, venue: t, url: t, tier: 'search' as const });
const targets: Record<string, (t: string) => unknown> = {
  parseCitations: (t) => parseCitations(t), splitAuthors: (t) => splitAuthors(t), linkKind: (t) => linkKind(t), doiFromUrl: (t) => doiFromUrl(t), titleSimilarity: (t) => titleSimilarity(t, t), nameKey: (t) => nameKey(t),
  extractFigures: (t) => extractFigures(t), extractTypedNumbers: (t) => extractTypedNumbers(t), checkFigures: (t) => checkFigures(t, t), evalFormula: (t) => { try { evalFormula(t, {}); } catch { /* expected */ } },
  checkQuote: (t) => checkQuote(t, `${t}zzzzzzzzzzzz`), checkGrounding: (t) => checkGrounding(t, [{ ref: 1, text: t }]), stripTags: (t) => stripTags(t),
  gate: (t) => createGate().check([{ text: t, category: t, sources: [{ url: t, date: t }] }]), recency: (t) => summariseRecency([{ url: t, date: t }]), worldBankUrlInfo: (t) => worldBankUrlInfo(t),
  isSafeAddress: (t) => isSafeAddress(t), strip: (t) => strip(t, { verdicts: [{ citation: cit(t), bucket: 'failed' } as never], summary: {} as never, ok: false }),
};

describe('no public function is quadratic on awkward text', () => {
  for (const [tn, fn] of Object.entries(targets)) {
    it(tn, () => {
      const slow: string[] = [];
      for (const [fam, text] of Object.entries(families)) {
        const t0 = performance.now();
        fn(text);
        const ms = performance.now() - t0;
        if (ms > 300) slow.push(`${fam}: ${ms.toFixed(0)} ms`);
      }
      expect(slow, `${tn} took too long on: ${slow.join(', ')}`).toEqual([]);
    });
  }
});
