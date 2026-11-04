import { describe, expect, it } from 'vitest';
import { checkClaims, findUnsupportedClaims } from '../src/claims.js';

const CV = 'Managed a team of 5 engineers at a payments company. Built the Python data pipeline. Founded a photography studio. MSc in Hydrology.';

describe('checkClaims', () => {
  it('flags an embellishment: "led a large team" says more than "managed a team of 5"', () => {
    expect(findUnsupportedClaims('Led a large team of engineers.', CV)).toEqual(['large']);
  });
  it('accepts a leadership word when any word of the same kind is in the materials', () => {
    expect(findUnsupportedClaims('Led a team of engineers.', CV)).toEqual([]);
    expect(findUnsupportedClaims('Directed the data pipeline.', CV)).toEqual([]);
  });
  it('flags leadership, awards and publications the materials never claim', () => {
    expect(findUnsupportedClaims('Won the national award and published two papers.', CV)).toEqual(expect.arrayContaining(['won', 'published']));
    expect(findUnsupportedClaims('Led the programme.', 'Built a website.')).toEqual(['led']);
  });
  it('flags a credential, a decade and a lower-case tool the materials do not mention', () => {
    expect(findUnsupportedClaims('A PhD holder with a decade of kubernetes and tableau.', CV)).toEqual(expect.arrayContaining(['phd', 'decade', 'kubernetes', 'tableau']));
    expect(findUnsupportedClaims('MSc and Python.', CV)).toEqual([]);
  });
  it('catches tool phrases of more than one word', () => {
    expect(findUnsupportedClaims('Applied machine learning to hydrology.', CV)).toEqual(['machine learning']);
    expect(findUnsupportedClaims('Applied machine learning to hydrology.', CV + ' Machine learning for floods.')).toEqual([]);
  });
  it('does not read "led to", "lead time" or "lead generation" as leadership', () => {
    expect(findUnsupportedClaims('This led to growth, with shorter lead time and strong lead generation.', 'Built a website.')).toEqual([]);
  });
  it('reads "a leading provider" as an embellishment but "leading a team" as a verb', () => {
    expect(findUnsupportedClaims('A leading provider of payments.', CV)).toEqual(['leading']);
    expect(findUnsupportedClaims('Leading a team of engineers.', CV)).toEqual([]);
  });
  it('reports each once, and takes an ignore list and a no-tools switch', () => {
    expect(findUnsupportedClaims('Large, large and large.', CV)).toEqual(['large']);
    expect(findUnsupportedClaims('Large team.', CV, { ignore: ['large'] })).toEqual([]);
    expect(findUnsupportedClaims('Used kubernetes.', CV, { tools: false })).toEqual([]);
  });
  it('can be limited to sentences about the reader', () => {
    const t = 'Interviews are often large panels. You led a large team at your last job.';
    expect(findUnsupportedClaims(t, CV, { about: 'you' })).toEqual(['large']);
    expect(checkClaims('Interviews are often large panels.', CV, { about: 'you' }).verdicts).toEqual([]);
  });
  it('summarises in one line', () => {
    expect(checkClaims('Led a large team.', 'Managed a team.').summary.text).toBe('Claims: 2 · ✓ 1 in your materials · ✕ 1 not in your materials — the materials never use the word that makes the claim.');
  });
});
