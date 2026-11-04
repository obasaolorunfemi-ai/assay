import { describe, expect, it } from 'vitest';
import { checkNames, findUnsupportedNames } from '../src/names.js';

const CV = `Ada Example
Founder and engineer. Lagos, Nigeria.
Built a payments app used by 300 merchants. Funded by the Tony Elumelu Foundation.
Head of Business at Oneremit Payments. MBA, Cyprus International University.
Created Lodestone, an open-source library, and evaluated N-ATLaS on Hausa, Igbo and Yoruba.
See https://example.org/report and write to ada@example.com.`;

describe('checkNames', () => {
  it('flags invented organisations and sources that have no digits', () => {
    const t = 'As the UNESCO Girls Education Report shows, and through our partnership with the Greenfield Foundation and my earlier role at Acme Capital, we will scale.';
    expect(findUnsupportedNames(t, CV)).toEqual(expect.arrayContaining(['UNESCO Girls Education Report', 'Greenfield Foundation', 'Acme Capital']));
  });

  it('passes names that are in the materials, including possessives, endings and hyphenated names', () => {
    const t = 'Ada Example founded a payments app, and Lodestone\'s approach came from evaluating N-ATLaS. Her Nigerian merchants trusted the Tony Elumelu Foundation. She studied at Cyprus International University.';
    const r = checkNames(t, CV);
    expect(r.ok).toBe(true);
    expect(r.summary.text).toMatch(/^Names: \d+ · ✓ \d+ in your materials$/);
  });

  it('does not treat a capital at the start of a sentence as a name', () => {
    expect(findUnsupportedNames('Led a team of founders. Built the product. Managed growth.', CV)).toEqual([]);
  });

  it('ignores greetings, sign-offs, months and common words, and takes your own ignore list', () => {
    expect(findUnsupportedNames('Dear Hiring Manager,\nI am applying in March. Sincerely,\nAda Example', CV)).toEqual([]);
    expect(findUnsupportedNames('We built it with Kubernetes.', CV)).toEqual(['Kubernetes']);
    expect(findUnsupportedNames('We built it with Kubernetes.', CV, { ignore: ['Kubernetes'] })).toEqual([]);
  });

  it('keeps an acronym that starts a sentence', () => {
    expect(findUnsupportedNames('UNESCO funded it.', CV)).toEqual(['UNESCO']);
  });

  it('joins names across of/for and splits across and', () => {
    expect(findUnsupportedNames('We worked with the Bank of America and Okafor & Bello.', CV)).toEqual(['Bank of America', 'Okafor', 'Bello']);
  });

  it('is judged against several materials at once, and reports each name once', () => {
    const r = checkNames('Greenfield Foundation again, and Greenfield Foundation.', ['Nothing here.', CV]);
    expect(r.verdicts).toHaveLength(1);
    expect(r.verdicts[0]).toMatchObject({ name: 'Greenfield Foundation', kind: 'name', supported: false, bucket: 'failed' });
    expect(r.summary.failed).toBe(1);
  });
});

describe('links, DOIs and addresses', () => {
  it('flags an invented link, DOI or email and allows ones in the materials', () => {
    const t = 'As shown at https://example.org/report/ and https://doi.org/10.1000/fake.123, mail ada@example.com or bob@evil.test.';
    expect(findUnsupportedNames(t, CV)).toEqual(['https://doi.org/10.1000/fake.123', 'bob@evil.test']);
  });
  it('compares a link without its scheme, "www." or trailing slash', () => {
    expect(findUnsupportedNames('Read www.example.org/report/.', CV)).toEqual([]);
  });
  it('can leave links out', () => {
    expect(findUnsupportedNames('Read https://elsewhere.test/x.', CV, { links: false })).toEqual([]);
  });
});

describe('the first word of a sentence', () => {
  it('is part of a name when it leads straight into another capital: an invented name cannot hide at the start', () => {
    expect(findUnsupportedNames('Greenfield Foundation launched the programme.', CV)).toEqual(['Greenfield Foundation']);
    expect(findUnsupportedNames('Acme Capital hired me.', CV)).toEqual(['Acme Capital']);
  });
  it('is left alone when it reads as a verb, so CV lines are not flagged for grammar', () => {
    expect(findUnsupportedNames('Spearheaded Oneremit Payments.', CV)).toEqual([]);
    expect(findUnsupportedNames('Built Oneremit Payments. Previously Head of Business at Oneremit Payments.', CV)).toEqual([]);
  });
});

describe('organisations written in lower case', () => {
  it('flags the word before an organisation marker when the materials never use it', () => {
    expect(findUnsupportedNames('We partnered with the greenfield foundation and acme corp.', CV)).toEqual(['greenfield foundation', 'acme corp']);
  });
  it('allows one the materials mention, and ordinary modifiers like "development bank"', () => {
    expect(findUnsupportedNames('We worked with the tony elumelu foundation and a development bank.', CV)).toEqual([]);
  });
});

describe('only what is said about the reader', () => {
  it('skips general statements and checks the ones addressed to you', () => {
    const advice = 'Hiring managers at Globex Corporation often ask about gaps. At your last role, Initech Systems, you ran payments.';
    expect(findUnsupportedNames(advice, CV, { about: 'you' })).toEqual(['Initech Systems']);
    expect(findUnsupportedNames(advice, CV)).toEqual(expect.arrayContaining(['Globex Corporation', 'Initech Systems']));
  });
});
