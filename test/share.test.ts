import { describe, expect, it } from 'vitest';
import { COUNTED_CHECKS, shareTally, startSharing } from '../src/share.js';
import { createTally } from '../src/tally.js';
import { checkQuotes } from '../src/quotes.js';

const fetchOf = (status: number, seen: Array<{ url: string; body: any; method?: string }> = []) => (async (url: string, init: any) => { seen.push({ url, body: JSON.parse(init.body), method: init.method }); return { ok: status < 300, status } as Response; }) as unknown as typeof fetch;
const quotesReport = () => checkQuotes([{ quote: 'Relocation is available for all staff', source: 'Relocation support is available for senior staff only.' }, { quote: 'Relocation support is available for senior staff', source: 'Relocation support is available for senior staff only.' }]);

describe('shareTally: opt-in, numbers only', () => {
  it('sends only counts per check, never any text, and nothing identifying', async () => {
    const t = createTally(); t.add('quotes', quotesReport());
    const seen: any[] = [];
    const r = await shareTally(t, { fetch: fetchOf(200, seen), url: 'https://counter.example/api/count' });
    expect(r).toEqual({ sent: true, checked: 2 });
    expect(seen[0].method).toBe('POST');
    expect(seen[0].body).toEqual({ v: 1, counts: { quotes: { checked: 2, ok: 1, check: 0, failed: 1 } } });
    expect(JSON.stringify(seen[0].body)).not.toMatch(/Relocation|staff/);
  });
  it('sends only what is new: a second report with nothing new sends nothing', async () => {
    const t = createTally(); t.add('quotes', quotesReport());
    const seen: any[] = [];
    await shareTally(t, { fetch: fetchOf(200, seen), url: 'https://c.example/x' });
    expect(await shareTally(t, { fetch: fetchOf(200, seen), url: 'https://c.example/x' })).toEqual({ sent: false, reason: 'nothing new to send' });
    t.add('quotes', quotesReport());
    await shareTally(t, { fetch: fetchOf(200, seen), url: 'https://c.example/x' });
    expect(seen).toHaveLength(2);
    expect(seen[1].body.counts.quotes.checked).toBe(2);
  });
  it('a failed report keeps the counts for the next one, and never throws', async () => {
    const t = createTally(); t.add('quotes', quotesReport());
    expect((await shareTally(t, { fetch: fetchOf(503), url: 'https://c.example/x' })).sent).toBe(false);
    const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await shareTally(t, { fetch: down, url: 'https://c.example/x' })).toMatchObject({ sent: false, reason: 'the counter could not be reached' });
    const seen: any[] = [];
    expect((await shareTally(t, { fetch: fetchOf(200, seen), url: 'https://c.example/x' })).sent).toBe(true);
    expect(seen[0].body.counts.quotes.checked).toBe(2);
  });
  it('does not send names the counter does not accept, and refuses a plain-http address', async () => {
    const t = createTally(); t.add('my-own-check', { verdicts: [{ bucket: 'failed' }] });
    const seen: any[] = [];
    expect(await shareTally(t, { fetch: fetchOf(200, seen), url: 'https://c.example/x' })).toEqual({ sent: false, reason: 'nothing new to send' });
    expect(seen).toHaveLength(0);
    t.add('quotes', quotesReport());
    expect(await shareTally(t, { fetch: fetchOf(200, seen), url: 'http://c.example/x' })).toEqual({ sent: false, reason: 'the address must be https' });
    expect(seen).toHaveLength(0);
    expect(COUNTED_CHECKS).toContain('legal');
  });
  it('startSharing does nothing until its timer fires, and flush sends on demand', async () => {
    const t = createTally(); t.add('quotes', quotesReport());
    const seen: any[] = [];
    const s = startSharing(t, { fetch: fetchOf(200, seen), url: 'https://c.example/x', everyMs: 3_600_000 });
    expect(seen).toHaveLength(0);
    expect((await s.flush()).sent).toBe(true);
    s.stop();
    expect(seen).toHaveLength(1);
  });
});
