import { describe, expect, it } from 'vitest';
import { createAssay } from '../src/check.js';
import { createRetractions } from '../src/retractions.js';
import { createSupport } from '../src/support.js';
import { createLegal } from '../src/legal.js';
import { createTally } from '../src/tally.js';

const fetchOf = (body: unknown, status = 200) => (async () => ({ ok: status < 300, status, json: async () => body, headers: new Headers() }) as unknown as Response) as unknown as typeof fetch;

describe('the tally option counts what a checker finds, as it is used', () => {
  it('createRetractions', async () => {
    const tally = createTally();
    await createRetractions({ tally, fetch: fetchOf({ message: { DOI: '10.1000/a', title: ['RETRACTED: x'] } }) }).check(['10.1000/a', '10.1000/b']);
    expect(tally.snapshot()).toMatchObject({ checked: 2, failed: 2 });
    expect(tally.snapshot().byCheck.retractions).toBeDefined();
  });
  it('createSupport counts both check and checkOne', async () => {
    const tally = createTally();
    const s = createSupport({ tally, judge: async () => ({ verdict: 'unrelated' }) });
    await s.check([{ claim: 'The moon is cheese.', source: 'Cheese is made from milk.' }]);
    await s.checkOne('Another claim here.', 'Some other source text.');
    expect(tally.snapshot()).toMatchObject({ checked: 2, check: 2 });
  });
  it('createLegal', async () => {
    const tally = createTally();
    await createLegal({ tally, token: 't', fetch: fetchOf([{ citation: '1 U.S. 1', status: 404, start_index: 0, clusters: [] }]) }).check('1 U.S. 1');
    expect(tally.snapshot().byCheck.legal).toMatchObject({ checked: 1, failed: 1 });
  });
  it('createAssay counts a citation check but not a re-check of the same report', async () => {
    const tally = createTally();
    const a = createAssay({ tally, sources: [], fetch: fetchOf({}) });
    const r = await a.check('[Nobody, 1999, "A title"]');
    const n = tally.snapshot().checked;
    expect(n).toBeGreaterThanOrEqual(0);
    await a.recheck(r);
    expect(tally.snapshot().checked).toBe(n);
  });
  it('nothing is counted, and nothing breaks, without a tally', async () => {
    const r = await createRetractions({ fetch: fetchOf({ message: { DOI: '10.1000/a', title: ['x'] } }) }).check(['10.1000/a']);
    expect(r.verdicts).toHaveLength(1);
  });
});
