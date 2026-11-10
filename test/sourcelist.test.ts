import { describe, expect, it } from 'vitest';
import { approvedUrls, buildSourceList, markLines, problemsForPrompt, splitSourceSection, stripUnapprovedLinks, UNSUPPORTED_MARKER } from '../src/sourcelist.js';

const claims = [
  { ref: 1, sources: [{ url: 'https://www.worldbank.org/en/news/remittances', publisher: 'World Bank', title: 'Remittance brief', tier: 1, status: 'live' }] },
  { ref: 2, sources: [{ url: 'https://www.cbn.gov.ng/reserves', publisher: 'Central Bank of Nigeria', tier: 1, status: 'blocked' }, { url: 'https://www.cbn.gov.ng/dead', publisher: 'Central Bank of Nigeria', tier: 1, status: 'broken' }] },
];

describe('splitSourceSection', () => {
  const body = "Intro [[c1]].\n\n## Section\n\nText.\n\n## Sources\n\n- Amaka Obi — Curriculum Vitae (2019), https://example.org/cv.pdf — Tier 2\n- World Bank — Tier 1\n";
  it("removes the model's Sources section and says there was one", () => {
    const r = splitSourceSection(body);
    expect(r.hadSection).toBe(true);
    expect(r.body).not.toMatch(/Curriculum Vitae|Sources/);
    expect(r.body).toMatch(/## Section/);
  });
  it('also catches References, Further reading and a bold "Sources:" label', () => {
    expect(splitSourceSection('Text.\n\n## References\n\n- Obi CV').body).toBe('Text.');
    expect(splitSourceSection('Text.\n\n**Sources:**\n\n- Obi CV').hadSection).toBe(true);
    expect(splitSourceSection('Text.\n\n## Further reading\n\n- x').hadSection).toBe(true);
  });
  it('leaves a real subhead that merely starts with "Sources"', () => {
    const r = splitSourceSection('Text.\n\n## Sources of remittance growth\n\nMore text.');
    expect(r.hadSection).toBe(false);
    expect(r.body).toMatch(/Sources of remittance growth/);
  });
  it('keeps content that follows the section under a later heading', () => {
    const r = splitSourceSection('A.\n\n## Sources\n\n- x\n\n## Next steps\n\nB.');
    expect(r.body).toMatch(/Next steps/);
    expect(r.body).not.toMatch(/- x/);
  });
  it('does not treat a heading inside a code fence as the section', () => {
    expect(splitSourceSection('```\n## Sources\n```\n\nAfter.').hadSection).toBe(false);
  });
});

describe('buildSourceList', () => {
  const dead = (s: { status?: unknown }) => s.status === 'broken';
  it('lists only the sources of cited claims, skips dead links, and links with tiers', () => {
    const out = buildSourceList(claims, [1, 2], { tierLabel: (t) => `Tier ${t}`, skip: dead });
    expect(out).toMatch(/^## Sources/);
    expect(out).toMatch(/\[Remittance brief\]\(https:\/\/www.worldbank.org\/en\/news\/remittances\) — World Bank \(Tier 1\)/);
    expect(out).toMatch(/cbn.gov.ng\/reserves/);
    expect(out).not.toMatch(/cbn.gov.ng\/dead/);
  });
  it("omits claims the draft didn't cite", () => {
    expect(buildSourceList(claims, [1])).not.toMatch(/cbn/);
  });
  it('writes a short plain list for a post, and adds the first-party line for claim 0', () => {
    const out = buildSourceList(claims, [0, 1], { style: 'plain', tierLabel: (t) => `Tier ${t}` });
    expect(out).toMatch(/- World Bank — Tier 1/);
    expect(out).not.toMatch(/https?:/);
    expect(out).toMatch(/first-party data/);
  });
  it('is empty when no cited claim has a source', () => {
    expect(buildSourceList(claims, [])).toBe('');
  });
  it('lists a source once however many claims share it', () => {
    const two = [claims[0]!, { ref: 3, sources: claims[0]!.sources }];
    expect(buildSourceList(two, [1, 3]).match(/worldbank/g)).toHaveLength(1);
  });
});

describe('stripUnapprovedLinks', () => {
  const approved = approvedUrls(claims, 'Our page: https://oneremit.co/rates');
  const hosts = ['oneremit.co'];
  it('keeps approved links and removes the rest, keeping the anchor text', () => {
    const md = "See [the brief](https://www.worldbank.org/en/news/remittances) and [Obi's CV](https://example.org/amaka-obi-cv.pdf).";
    const r = stripUnapprovedLinks(md, approved, hosts);
    expect(r.body).toBe("See [the brief](https://www.worldbank.org/en/news/remittances) and Obi's CV.");
    expect(r.removed.map((x) => x.url)).toEqual(['https://example.org/amaka-obi-cv.pdf']);
  });
  it('removes a bare invented address', () => {
    const r = stripUnapprovedLinks('Read https://example.org/cv.pdf for more.', approved, hosts);
    expect(r.body).not.toMatch(/example.org/);
    expect(r.removed).toHaveLength(1);
  });
  it("allows the operator's own domains, any path", () => {
    expect(stripUnapprovedLinks('Try [it](https://www.oneremit.co/anything).', approved, hosts).removed).toHaveLength(0);
  });
  it('leaves a code fence alone', () => {
    const md = '```chart\n{"src":"https://example.org/data"}\n```';
    expect(stripUnapprovedLinks(md, approved, hosts).body).toBe(md);
  });
});

describe('markLines / problemsForPrompt', () => {
  it('marks the listed lines only, once, and a marked line is left alone next time', () => {
    const md = 'Fine line [[c1]].\n\nAccording to Dr. Obi\'s CV, she ran the desk.';
    const out = markLines(md, ["According to Dr. Obi's CV, she ran the desk."]);
    expect(out).toMatch(/Fine line \[\[c1\]\]\.\n/);
    expect(out.split(UNSUPPORTED_MARKER).length - 1).toBe(1);
    expect(markLines(out, ["According to Dr. Obi's CV, she ran the desk."])).toBe(out);
  });
  it('lists problems for a redraft prompt, bounded', () => {
    const p = problemsForPrompt([{ line: 'x'.repeat(500), reason: 'why' }, { line: 'b', reason: 'r' }], 1);
    expect(p.split('\n')).toHaveLength(1);
    expect(p).toMatch(/^- "x{140}" — why$/);
  });
});
