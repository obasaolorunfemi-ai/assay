import { describe, expect, it } from 'vitest';
import { buildCorpus, checkAttributions } from '../src/attributions.js';
import { markLines } from '../src/sourcelist.js';

const claims = [
  { ref: 1, text: 'Nigeria received $20.9 billion in remittances in 2023, per the World Bank.', sources: [{ url: 'https://www.worldbank.org/en/news/remittances', publisher: 'World Bank', title: 'Remittance brief' }] },
  { ref: 2, text: "The CBN's reserves stood at $34 billion in March 2025. Governor Cardoso said the position was stable.", sources: [{ url: 'https://www.cbn.gov.ng/reserves', publisher: 'Central Bank of Nigeria' }] },
];
const corpus = buildCorpus({ claims, texts: ['Oneremit sends money to Nigeria.', 'remittances to Nigeria'] });
const flags = (md: string) => checkAttributions(md, { corpus }).violations;
const codes = (md: string) => flags(md).map((v) => v.code);
const reasons = (md: string) => flags(md).map((v) => v.reason).join(' | ');

describe('the invented CV, every way it can appear', () => {
  it('flags a CV mentioned in prose with no number and no tag', () => {
    const md = "According to Dr. Amaka Obi's CV, she ran the CBN reserve desk.";
    expect(flags(md).length).toBeGreaterThan(0);
    expect(flags(md).every((v) => v.kind === 'source')).toBe(true);
    expect(reasons(md)).toMatch(/CV/);
  });
  it('flags it as a bullet, a blockquote and a heading', () => {
    expect(flags("- Amaka Obi's CV lists 12 years at the Central Bank.")).not.toHaveLength(0);
    expect(flags("> Amaka Obi's CV says she led the desk.")).not.toHaveLength(0);
    expect(flags("## What Amaka Obi's 2019 CV shows about reserves")).not.toHaveLength(0);
  });
  it('flags a CV even on a tagged line, because no approved claim mentions one', () => {
    expect(flags("Reserves were $34 billion [[c2]], per Amaka Obi's CV.")).not.toHaveLength(0);
  });
  it('allows a CV only when an approved claim itself mentions it and the line is tagged', () => {
    const c = buildCorpus({ claims: [{ ref: 1, text: "The candidate's CV lists a 2019 posting." }] });
    expect(checkAttributions("The candidate's CV lists a 2019 posting [[c1]].", { corpus: c }).violations).toHaveLength(0);
  });
});

describe('other fabricated source shapes', () => {
  it('flags a study with no tag, passes it with one', () => {
    expect(codes('A recent survey found most senders prefer Fridays.')).toContain('document-untagged');
    expect(flags('A survey of senders is cited by the World Bank [[c1]].')).toHaveLength(0);
  });
  it("flags 'according to' an entity that isn't an approved source, even tagged", () => {
    expect(codes('According to the Lagos Remittance Institute, flows rose [[c1]].')).toContain('attribution-unknown');
    expect(reasons('According to the Lagos Remittance Institute, flows rose [[c1]].')).toMatch(/isn't one of the approved sources/);
  });
  it('passes an attribution to an approved publisher when tagged', () => {
    expect(flags('According to the World Bank, flows reached $20.9 billion [[c1]].')).toHaveLength(0);
  });
  it('requires a tag on an attributed statement, named or generic', () => {
    expect(codes('The World Bank said flows rose.')).toContain('attribution-untagged');
    expect(codes('Analysts said the naira would hold.')).toContain('attribution-untagged');
    expect(flags('Analysts said the naira would hold [[c2]].')).toHaveLength(0);
  });
  it("flags a direct quote that isn't in the approved claims, passes one that is", () => {
    expect(codes('"We settled four thousand transfers a day," says the CFO [[c1]].')).toContain('quote-unbacked');
    expect(flags('Cardoso said "the position was stable" [[c2]].')).toHaveLength(0);
  });
  it("flags a titled person who isn't in the approved material, passes one who is", () => {
    expect(reasons("Dr. Chidi Okafor leads the central bank's reserve desk.")).toMatch(/Okafor/);
    expect(flags('Governor Cardoso kept rates unchanged [[c2]].')).toHaveLength(0);
  });
  it('leaves an operator [verify: …] marker alone', () => {
    expect(flags('Her CV shows a posting at the CBN [verify: confirm with HR].')).toHaveLength(0);
  });
  it('ignores plain prose and code fences', () => {
    expect(flags('Sending money home on a Friday is simple [[logic]].\n\n```chart\n{"title":"CV study"}\n```')).toHaveLength(0);
  });
  it('honours a different tag syntax', () => {
    const md = 'A survey of senders is cited by the World Bank {c1}.';
    expect(checkAttributions(md, { corpus, tags: { open: '{', close: '}' } }).violations).toHaveLength(0);
    expect(checkAttributions(md, { corpus }).violations).not.toHaveLength(0);
  });
});

describe('report shape', () => {
  it('says how many lines were read and how many named something unbacked', () => {
    const r = checkAttributions("Fine [[c1]].\n\nAccording to Dr. Obi's CV, she ran it.", { corpus });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatchObject({ total: 2, failed: 1, level: 'bad' });
    expect(r.summary.text).toMatch(/Lines: 2/);
  });
  it('is ok and good on a clean draft', () => {
    const r = checkAttributions('Remittances reached $20.9 billion [[c1]].', { corpus });
    expect(r).toMatchObject({ ok: true, violations: [] });
    expect(r.summary.level).toBe('good');
  });
  it('never throws on odd input', () => {
    expect(() => checkAttributions(undefined as never, { corpus: undefined as never })).not.toThrow();
  });
});

describe('what is left after a redraft is marked where the reader will see it', () => {
  it('a marked line no longer trips the check (it is now an operator-facing marker)', () => {
    const md = "Fine line [[c1]].\n\nAccording to Dr. Amaka Obi's CV, she ran the desk.";
    const marked = markLines(md, flags(md).map((v) => v.line));
    expect(marked).toMatch(/\[verify: unapproved source/);
    expect(checkAttributions(marked, { corpus }).violations).toHaveLength(0);
  });
});
