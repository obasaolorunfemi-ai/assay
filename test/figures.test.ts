import { describe, expect, it } from 'vitest';
import { checkFigures, extractFigures, extractYears, findUnsupportedFigures } from '../src/figures.js';

const values = (text: string) => extractFigures(text).map((f) => f.value);

describe('extractFigures (KeyStone\'s cases)', () => {
  it('reads plain numbers, thousands separators and decimals', () => {
    expect(values('We served 5,000 people and 12.5 hectares.')).toEqual([5000, 12.5]);
  });
  it('reads percentages the same way however they are written, and marks them as percent', () => {
    for (const t of ['A 40% rise', 'A 40 percent rise', 'A 40 per cent rise']) {
      const f = extractFigures(t);
      expect(f.map((x) => x.value)).toEqual([40]);
      expect(f[0]!.kind).toBe('percent');
    }
  });
  it('expands k, m and spelled-out scales', () => {
    expect(values('Raised 50k, then 1.5m, then 2 million')).toEqual([50_000, 1_500_000, 2_000_000]);
  });
  it('reads number words, including compounds and scales', () => {
    expect(values('three platforms')).toEqual([3]);
    expect(values('twenty-five staff')).toEqual([25]);
    expect(values('two million users')).toEqual([2_000_000]);
  });
  it('does not treat "one" as a figure', () => {
    expect(values('No one knew, but one of them did.')).toEqual([]);
  });
  it('ignores digits glued to letters, such as B2B or Q3', () => {
    expect(values('Our B2B pilot ran in Q3')).toEqual([]);
  });
  it('does not swallow the comma after a year', () => {
    expect(extractFigures('In 2024, we began.')[0]!.raw).toBe('2024');
  });
  it('ignores ordinals and list numbering', () => {
    expect(values('Our 40th anniversary')).toEqual([]);
    expect(values('1. Background\n2) Approach')).toEqual([]);
  });
  it('ignores what you tell it to (your own placeholder syntax)', () => {
    const text = 'Target: [ADD: how many people, e.g. 500]';
    expect(values(text)).toEqual([500]);
    expect(extractFigures(text, { ignore: [/\[ADD:[^\]]*\]/gi] })).toEqual([]);
  });
  it('reports where each figure starts in the text you gave, even after ignoring parts of it', () => {
    const text = '[ADD: 10] We reached 900 people.';
    const [f] = extractFigures(text, { ignore: [/\[ADD:[^\]]*\]/gi] });
    expect(text.slice(f!.index, f!.index + 3)).toBe('900');
  });
});

describe('list numbering', () => {
  it('does not glue the lines either side of a list marker into one number (KeyStone read "twenty-five / 2) / hundred" as 2,500)', () => {
    expect(values('twenty-five\n2)\nhundred')).toEqual([25]);
  });
});

describe('findUnsupportedFigures (KeyStone\'s cases)', () => {
  it('passes figures that appear in the supplied sources', () => {
    expect(findUnsupportedFigures('In 2024, we trained 40 women.', ['We trained 40 women in 2024.'])).toEqual([]);
  });
  it('flags a figure that appears in none of the sources', () => {
    expect(findUnsupportedFigures('We reached 5,000 beneficiaries.', ['We trained 40 women.']).map((f) => f.value)).toEqual([5000]);
  });
  it('matches across notations: "3" supports "three", and "1.5m" supports "1,500,000"', () => {
    expect(findUnsupportedFigures('Three sites', ['We run 3 sites.'])).toEqual([]);
    expect(findUnsupportedFigures('A budget of 1,500,000', ['Grants of up to 1.5m'])).toEqual([]);
  });
  it('counts figures in the call as supported, so restating its limits is fine', () => {
    expect(findUnsupportedFigures('Within the 500-word limit', ['Answers must not exceed 500 words'])).toEqual([]);
  });
  it('flags a repeated unsupported figure only once', () => {
    expect(findUnsupportedFigures('We reached 900 people. Those 900 people grew.', [])).toHaveLength(1);
  });
  it('draws from several sources at once', () => {
    expect(findUnsupportedFigures('Led 8 staff in 2023 to apply for 20000', ['CV: led 8 staff', 'Brief: pilot in 2023', 'Call: up to 20000'])).toEqual([]);
  });
});

describe('a percentage and a plain number are different figures', () => {
  it('does not let "40 women" in a CV support an invented "40%"', () => {
    expect(findUnsupportedFigures('A 40% increase.', ['We trained 40 women.']).map((f) => f.raw)).toEqual(['40%']);
  });
  it('and not the other way round', () => {
    expect(findUnsupportedFigures('We trained 40 women.', ['A 40% increase.']).map((f) => f.raw)).toEqual(['40']);
  });
  it('can be turned off, to match on value alone as KeyStone did', () => {
    expect(findUnsupportedFigures('A 40% increase.', ['We trained 40 women.'], { kinds: false })).toEqual([]);
  });
  it('a 40% is supported by "40 percent"', () => {
    expect(findUnsupportedFigures('A 40% increase.', ['up 40 percent'])).toEqual([]);
  });
});

describe('tolerance', () => {
  it('is exact by default', () => {
    expect(findUnsupportedFigures('about 14 billion', ['$14.06 billion']).map((f) => f.value)).toEqual([14e9]);
  });
  it('accepts values within the share you allow', () => {
    expect(findUnsupportedFigures('about 14 billion', ['$14.06 billion'], { tolerance: 0.05 })).toEqual([]);
    expect(findUnsupportedFigures('about 20 billion', ['$14.06 billion'], { tolerance: 0.05 })).toHaveLength(1);
  });
});

describe('checkFigures', () => {
  it('judges each distinct figure, in plain words, and summarises', () => {
    const rep = checkFigures('We trained 40 women across 3 sites and reached 5,000 people.', ['We trained 40 women at 3 sites.']);
    expect(rep.verdicts.map((v) => [v.figure.raw, v.supported])).toEqual([['40', true], ['3', true], ['5,000', false]]);
    expect(rep.verdicts[2]!.message).toBe('"5,000" does not appear in the materials you gave. Check it, or replace it with a blank.');
    expect(rep.summary.text).toBe('Figures: 3 · ✓ 2 supported · ✕ 1 not in your materials — check them before using the text.');
    expect(rep.ok).toBe(false);
  });
  it('is ok when everything is supported, and when there are no figures', () => {
    expect(checkFigures('We trained 40 women.', 'trained 40 women').ok).toBe(true);
    expect(checkFigures('No numbers at all.', 'None here either').ok).toBe(true);
  });
  it('takes one text or many as the materials', () => {
    expect(checkFigures('8 staff', 'led 8 staff').ok).toBe(true);
    expect(checkFigures('8 staff', ['x', 'led 8 staff']).ok).toBe(true);
  });
});

describe('extractYears', () => {
  it('finds every distinct 4-digit year', () => {
    expect(extractYears('moved from ₦645 in 2023 to ₦1,518 in 2025, and again in 2023')).toEqual([2023, 2025]);
  });
});

describe('hostile input', () => {
  it('stays fast on a megabyte of digits, words and percent signs', () => {
    const t = Date.now();
    extractFigures('12,345.67% '.repeat(90_000));
    extractFigures('twenty-five million '.repeat(50_000));
    extractFigures('9'.repeat(1_000_000));
    expect(Date.now() - t).toBeLessThan(3000);
  });
});
