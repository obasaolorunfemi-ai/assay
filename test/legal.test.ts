import { describe, expect, it } from 'vitest';
import { caseNameBefore, createLegal, sameCase } from '../src/legal.js';

// Rows follow CourtListener's published citation-lookup reference (citation, normalized_citations, start_index, end_index, status, error_message, clusters).
// They are written by hand from that reference: no live call has been made with a token.
const row = (o: Record<string, unknown>) => ({ citation: '', normalized_citations: [], start_index: 0, end_index: 0, status: 200, error_message: '', clusters: [], ...o });
const reply = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: new Headers() }) as unknown as Response;
const seen: Array<{ url: string; init: any }> = [];
const fakeFetch = (respond: (body: string) => Response) => (async (url: string, init: any) => { seen.push({ url, init }); return respond(String(init?.body ?? '')); }) as unknown as typeof fetch;

describe('case-name helpers', () => {
  it('reads the "A v. B" written before a citation', () => {
    const t = 'As held in Mata v. Avianca, Inc., 678 F. Supp. 3d 443';
    expect(caseNameBefore(t, t.indexOf('678'))).toMatch(/Mata v\. Avianca/);
    expect(caseNameBefore('no case name here 678 F. Supp.', 20)).toBe('');
  });
  it('compares the significant words of two case names', () => {
    expect(sameCase('Varghese v. China Southern Airlines Co. Ltd.', 'Varghese v. China Southern Airlines')).toBe(true);
    expect(sameCase('Varghese v. China Southern Airlines', 'Martinez v. Delta Air Lines')).toBe(false);
    expect(sameCase('', 'Anything v. Anyone')).toBe(true);
  });
});

describe('legal', () => {
  it('a found citation whose case matches the name written is ok', async () => {
    const text = 'See Roe v. Wade, 410 U.S. 113 (1973).';
    const l = createLegal({ token: 't', fetch: fakeFetch(() => reply([row({ citation: '410 U.S. 113', start_index: text.indexOf('410'), clusters: [{ case_name: 'Roe v. Wade' }] })])) });
    const r = await l.check(text);
    expect(r.verdicts[0]).toMatchObject({ status: 'found', bucket: 'ok', caseName: 'Roe v. Wade' });
    expect(r.ok).toBe(true);
  });
  it('a real citation that belongs to a DIFFERENT case than the one named fails: the pattern in the 2023 sanctions case', async () => {
    const text = 'Varghese v. China Southern Airlines, 925 F.3d 1339 (11th Cir. 2019)';
    const l = createLegal({ token: 't', fetch: fakeFetch(() => reply([row({ citation: '925 F.3d 1339', start_index: text.indexOf('925'), clusters: [{ case_name: 'Martinez v. Some Bank' }] })])) });
    const r = await l.check(text);
    expect(r.verdicts[0]).toMatchObject({ status: 'wrong-case', bucket: 'failed', caseName: 'Martinez v. Some Bank' });
    expect(r.ok).toBe(false);
  });
  it('maps the other statuses: 404 not verified, 300 ambiguous, 400 unreadable, 429 limit', async () => {
    const l = createLegal({ token: 't', fetch: fakeFetch(() => reply([row({ citation: '1 X', status: 404 }), row({ citation: '2 X', status: 300, clusters: [{ case_name: 'A v. B' }, { case_name: 'C v. D' }] }), row({ citation: '3 X', status: 400 }), row({ citation: '4 X', status: 429 })])) });
    const r = await l.check('text');
    expect(r.verdicts.map((v) => [v.status, v.bucket])).toEqual([['notfound', 'failed'], ['ambiguous', 'check'], ['unreadable', 'check'], ['limit', 'check']]);
    expect(r.verdicts[0]!.message).toContain('does not hold');
  });
  it('a throttled, refused or changed API is unavailable, never an accusation', async () => {
    for (const res of [reply({ wait_util: 'x' }, 429), reply({ detail: 'nope' }, 401), reply('<html>', 200), reply({ not: 'an array' }, 200), reply(null, 500)]) {
      const r = await createLegal({ token: 't', fetch: fakeFetch(() => res) }).check('410 U.S. 113');
      expect(r.verdicts[0]).toMatchObject({ status: 'unavailable', bucket: 'check', retryable: true });
      expect(r.ok).toBe(true);
    }
  });
  it('sends the token as the API asks, as a POST of the text', async () => {
    seen.length = 0;
    await createLegal({ token: 'secret-token', fetch: fakeFetch(() => reply([])) }).check('Some text 1 U.S. 1');
    expect(seen[0]!.url).toBe('https://www.courtlistener.com/api/rest/v4/citation-lookup/');
    expect(seen[0]!.init.method).toBe('POST');
    expect(seen[0]!.init.headers.authorization).toBe('Token secret-token');
    expect(seen[0]!.init.body).toBe('text=Some%20text%201%20U.S.%201');
  });
  it('splits a long text into requests under the API limit', async () => {
    seen.length = 0;
    const long = ('word '.repeat(19) + '\n').repeat(900); // about 90,000 characters
    await createLegal({ token: 't', fetch: fakeFetch(() => reply([])) }).check(long);
    expect(seen.length).toBe(2);
    expect(seen.every((s) => decodeURIComponent(s.init.body.slice(5)).length <= 60_000)).toBe(true);
  });
});
