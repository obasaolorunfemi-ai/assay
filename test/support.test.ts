import { describe, expect, it } from 'vitest';
import { createSupport, type Judge } from '../src/support.js';

const source = 'The programme ran in three districts. Attendance rose 40% on the previous year. Staff were paid monthly.';
const judge = (j: Awaited<ReturnType<Judge>> | (() => unknown)): Judge & { calls: number } => {
  const f = (async () => { f.calls++; return typeof j === 'function' ? j() : j; }) as Judge & { calls: number };
  f.calls = 0;
  return f;
};

describe('support: a model may propose evidence, only evidence found in the source counts', () => {
  it('fails on a figure that is not in the source, without asking the judge', async () => {
    const j = judge({ verdict: 'supports', evidence: 'Attendance rose 40% on the previous year' });
    const v = await createSupport({ judge: j }).checkOne('Attendance rose 55%.', source);
    expect(v).toMatchObject({ status: 'figure-not-in-source', bucket: 'failed' });
    expect(j.calls).toBe(0);
  });
  it('evidence really in the source is "to confirm" by default, never "ok": a model cannot verify', async () => {
    const v = await createSupport({ judge: judge({ verdict: 'supports', evidence: 'Attendance rose 40% on the previous year' }) }).checkOne('Attendance rose 40% year on year.', source);
    expect(v).toMatchObject({ status: 'evidence-found', bucket: 'check', evidence: 'Attendance rose 40% on the previous year' });
  });
  it('trustJudge: true makes found evidence ok', async () => {
    const v = await createSupport({ trustJudge: true, judge: judge({ verdict: 'supports', evidence: 'Attendance rose 40% on the previous year' }) }).checkOne('Attendance rose 40% year on year.', source);
    expect(v.bucket).toBe('ok');
  });
  it('evidence the judge invented fails the claim', async () => {
    const v = await createSupport({ judge: judge({ verdict: 'supports', evidence: 'The programme doubled enrolment in every district' }) }).checkOne('The programme doubled enrolment.', source);
    expect(v).toMatchObject({ status: 'evidence-invented', bucket: 'failed' });
  });
  it('"supports" with no evidence counts for nothing', async () => {
    const v = await createSupport({ judge: judge({ verdict: 'supports' }) }).checkOne('Staff were paid.', source);
    expect(v).toMatchObject({ status: 'no-evidence', bucket: 'check' });
  });
  it('short evidence is refused like a short quote', async () => {
    const v = await createSupport({ judge: judge({ verdict: 'supports', evidence: 'paid' }) }).checkOne('Staff were paid.', source);
    expect(v.bucket).toBe('failed');
  });
  it('contradiction with shown evidence fails; without it, it is only to look at', async () => {
    const shown = await createSupport({ judge: judge({ verdict: 'contradicts', evidence: 'Staff were paid monthly' }) }).checkOne('Staff were paid weekly.', source);
    expect(shown).toMatchObject({ status: 'contradicted', bucket: 'failed' });
    const unshown = await createSupport({ judge: judge({ verdict: 'contradicts' }) }).checkOne('Staff were paid weekly.', source);
    expect(unshown).toMatchObject({ status: 'contradiction-unshown', bucket: 'check' });
  });
  it('"unrelated" is to check, not failed: a model saying so is not proof', async () => {
    expect((await createSupport({ judge: judge({ verdict: 'unrelated' }) }).checkOne('The moon is cheese.', source)).bucket).toBe('check');
  });
  it('a judge that throws, times out or answers nonsense is unavailable and retryable, never an accusation', async () => {
    for (const j of [judge(() => { throw new Error('boom'); }), judge(() => new Promise(() => {})), judge(() => 'not an object'), judge(() => ({ verdict: 'maybe' }))]) {
      const v = await createSupport({ judge: j, timeoutMs: 30 }).checkOne('Staff were paid monthly.', source);
      expect(v).toMatchObject({ status: 'unavailable', bucket: 'check', retryable: true });
    }
  });
  it('an empty claim or source is skipped', async () => {
    const s = createSupport({ judge: judge({ verdict: 'unrelated' }) });
    expect((await s.checkOne('  ', source)).bucket).toBe('skip');
    expect((await s.checkOne('Something.', '')).bucket).toBe('skip');
  });
  it('keeps the order of the items and writes one summary', async () => {
    const s = createSupport({ concurrency: 2, judge: async ({ claim }) => (claim.includes('paid') ? { verdict: 'supports', evidence: 'Staff were paid monthly' } : { verdict: 'unrelated' }) });
    const r = await s.check([{ id: 'a', claim: 'Staff were paid.', source }, { id: 'b', claim: 'It rained.', source }, { id: 'c', claim: 'Staff were paid on time.', source }]);
    expect(r.verdicts.map((v) => v.id)).toEqual(['a', 'b', 'c']);
    expect(r.summary.text).toMatch(/^Support: 3/);
    expect(r.ok).toBe(true);
  });
  it('is not ok when a claim fails', async () => {
    const r = await createSupport({ judge: judge({ verdict: 'unrelated' }) }).check([{ claim: 'Attendance rose 99%.', source }]);
    expect(r.ok).toBe(false);
    expect(r.summary.text).toContain('not backed');
  });
});
