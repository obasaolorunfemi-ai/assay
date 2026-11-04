import { describe, expect, it } from 'vitest';
import type { Http, HttpInit, HttpResult } from '../src/http.js';
import { crossref, plainTitle, pubmed, semanticscholar } from '../src/sources.js';
import { createValues, eurostat } from '../src/values.js';

const ok = (body: unknown): HttpResult => ({ ok: true, status: 200, body });
const http = (route: (url: string, init?: HttpInit) => HttpResult): Http & { urls: string[]; inits: Array<HttpInit | undefined> } => {
  const h = { urls: [] as string[], inits: [] as Array<HttpInit | undefined>, async json(url: string, init?: HttpInit) { h.urls.push(url); h.inits.push(init); return route(url, init); } };
  return h;
};
const ctx = { mailto: '', keys: {} as Record<string, string> };

// Trimmed copies of what eutils.ncbi.nlm.nih.gov returned on 2026-11-04.
const esearch = { header: { type: 'esearch' }, esearchresult: { count: '1', idlist: ['36811129'] } };
const esummary = { header: { type: 'esummary' }, result: { uids: ['36811129'], '36811129': { uid: '36811129', pubdate: '2023 Feb', source: 'Cureus', authors: [{ name: 'Alkaissi H' }, { name: 'McFarlane SI' }], title: 'Artificial Hallucinations in ChatGPT: Implications in Scientific Writing.', pubtype: ['Editorial'], articleids: [{ idtype: 'pubmed', value: '36811129' }, { idtype: 'doi', value: '10.7759/cureus.35179' }] } } };

describe('pubmed source', () => {
  it('turns a PubMed record into a candidate: surname without initials, no trailing full stop, year, DOI', async () => {
    const h = http((u) => ok(u.includes('esearch') ? esearch : esummary));
    const r = await pubmed.search({ title: 'Artificial Hallucinations in ChatGPT: Implications in Scientific Writing', surname: 'Alkaissi' }, h, ctx);
    expect(r.ok).toBe(true);
    expect(r.candidates[0]).toMatchObject({ title: 'Artificial Hallucinations in ChatGPT: Implications in Scientific Writing', authors: ['Alkaissi', 'McFarlane'], year: 2023, doi: '10.7759/cureus.35179', venue: 'Cureus', article: false });
    expect(h.urls[0]).toContain('sort=relevance');
    expect(decodeURIComponent(h.urls[0]!)).toContain('[Title]');
  });
  it('no match is ok with no candidates, and only one request is made', async () => {
    const h = http(() => ok({ esearchresult: { count: '0', idlist: [] } }));
    expect(await pubmed.search({ title: 'Nothing', surname: 'X' }, h, ctx)).toEqual({ ok: true, candidates: [] });
    expect(h.urls).toHaveLength(1);
  });
  it('a reply of the wrong shape is an outage, never "no results"', async () => {
    for (const body of [{ error: 'x' }, '<html>', { esearchresult: {} }]) {
      const r = await pubmed.search({ title: 'T', surname: 'X' }, http(() => ok(body)), ctx);
      expect(r.ok).toBe(false);
    }
    const r2 = await pubmed.search({ title: 'T', surname: 'X' }, http((u) => (u.includes('esearch') ? ok(esearch) : ok({ nope: 1 }))), ctx);
    expect(r2.ok).toBe(false);
  });
});

// Written from the Semantic Scholar API reference; the shared unauthenticated pool answered 429 whenever a live call was tried, so this is not a recording.
describe('semanticscholar source', () => {
  const body = { total: 1, data: [{ paperId: 'abc', title: 'Attention is All you Need', year: 2017, venue: 'NIPS', authors: [{ authorId: '1', name: 'Ashish Vaswani' }, { authorId: '2', name: 'Noam Shazeer' }], externalIds: { DOI: '10.5555/3295222.3295349' }, publicationTypes: ['JournalArticle', 'Conference'] }] };
  it('maps the reply and sends the key as a header only when one is given', async () => {
    const h = http(() => ok(body));
    const r = await semanticscholar.search({ title: 'Attention Is All You Need', surname: 'Vaswani' }, h, { mailto: '', keys: { semanticscholar: 'k' } });
    expect(r.candidates[0]).toMatchObject({ title: 'Attention is All you Need', authors: ['Ashish Vaswani', 'Noam Shazeer'], year: 2017, doi: '10.5555/3295222.3295349', article: true });
    expect(h.inits[0]).toEqual({ headers: { 'x-api-key': 'k' } });
    const h2 = http(() => ok(body));
    await semanticscholar.search({ title: 'T', surname: 'X' }, h2, ctx);
    expect(h2.inits[0]).toBeUndefined();
  });
  it('429 and a changed reply are outages, with the wait it asked for', async () => {
    const throttled = await semanticscholar.search({ title: 'T', surname: 'X' }, http(() => ({ ok: false, status: 429, body: { message: 'Too Many Requests' }, retryAfterMs: 60_000 })), ctx);
    expect(throttled).toMatchObject({ ok: false, retryAfterMs: 60_000 });
    expect((await semanticscholar.search({ title: 'T', surname: 'X' }, http(() => ok({ items: [] })), ctx)).ok).toBe(false);
  });
});

// A trimmed copy of Eurostat's JSON-stat reply for une_rt_a (Germany, 2021 to 2025), read on 2026-11-04.
const stat = (value: Record<string, number>, years = ['2021', '2022', '2023', '2024', '2025']) => ({ label: 'Unemployment by sex and age - annual data', id: ['freq', 'age', 'unit', 'sex', 'geo', 'time'], size: [1, 1, 1, 1, 1, years.length], value, dimension: { time: { category: { index: Object.fromEntries(years.map((y, i) => [y, i])) } } } });
describe('eurostat source', () => {
  const values = (route: (url: string) => HttpResult) => createValues({ sources: [eurostat], fetch: (async (url: string) => { const r = route(String(url)); return { ok: r.ok, status: r.status, json: async () => r.body, headers: new Headers() }; }) as unknown as typeof fetch, selfTest: false } as never);
  it('reads the series for the right dataset and checks a claim against its own year', async () => {
    const urls: string[] = [];
    const v = values((u) => { urls.push(u); return ok(stat({ '0': 3.6, '1': 3.1, '2': 3.1, '3': 3.5, '4': 3.8 })); });
    const good = await v.check({ value: 3.1, unit: 'percent', period: 2023, geo: 'DEU', subject: 'unemployment' });
    expect(good).toMatchObject({ state: 'verified', source: 'Eurostat' });
    expect(urls[0]).toContain('/data/une_rt_a?');
    expect(urls[0]).toContain('geo=DE');
    const bad = await v.check({ value: 9, unit: 'percent', period: 2023, geo: 'DEU', subject: 'unemployment' });
    expect(bad.state).toBe('mismatch');
  });
  it('knows its dataset units: GDP is reported in millions of euro and returned as full values', async () => {
    const v = values(() => ok({ label: 'GDP', id: ['freq', 'unit', 'na_item', 'geo', 'time'], size: [1, 1, 1, 1, 2], value: { '0': 4254930, '1': 4386940 }, dimension: { time: { category: { index: { '2023': 0, '2024': 1 } } } } }));
    const r = await v.check({ value: 4_254_930_000_000, unit: 'EUR', period: 2023, geo: 'DEU', subject: 'gdp' });
    expect(r.state).toBe('verified');
  });
  it('a country it does not cover or a subject it does not know is no-match, not a failure', async () => {
    const v = values(() => ok(stat({})));
    expect((await v.check({ value: 1, unit: null, period: 2023, geo: 'NGA', subject: 'unemployment' })).state).toBe('no-source');
    expect((await v.check({ value: 1, unit: null, period: 2023, geo: 'DEU', subject: 'rainfall' })).state).toBe('no-source');
  });
  it('an error reply is no data; a changed shape is unavailable, never "no data"', async () => {
    const empty = await values(() => ok({ error: [{ status: 404, label: 'x' }] })).check({ value: 1, unit: 'percent', period: 2023, geo: 'DEU', subject: 'unemployment' });
    expect(empty.state).toBe('no-data');
    for (const body of ['<html>', { value: {}, size: [2, 3], dimension: { time: { category: { index: { '2023': 0 } } } } }, { renamed: true }]) {
      const r = await values(() => ok(body)).check({ value: 1, unit: 'percent', period: 2023, geo: 'DEU', subject: 'unemployment' });
      expect(r.state).toBe('unavailable');
    }
  });
});

describe('titles with markup', () => {
  it('plainTitle drops tags and line breaks', () => {
    expect(plainTitle('Hallucination\u2010Free? Assessing the Reliability of Leading\n   <scp>AI</scp>\n   Legal Research Tools')).toBe('Hallucination\u2010Free? Assessing the Reliability of Leading AI Legal Research Tools');
    expect(plainTitle(undefined)).toBe('');
    expect(plainTitle('a <scr<b>ipt>x</scr</b>ipt> b')).not.toMatch(/[<>]/);
  });
  it('CrossRef titles are compared as words: the 2025 legal-research paper comes back with its markup removed', async () => {
    const h = http(() => ok({ message: { items: [{ title: ['Hallucination\u2010Free? Assessing the Reliability of Leading\n <scp>AI</scp>\n Legal Research Tools'], author: [{ family: 'Magesh' }], issued: { 'date-parts': [[2025]] }, DOI: '10.1111/jels.12413', type: 'journal-article', 'container-title': ['Journal of Empirical Legal Studies'] }] } }));
    const r = await crossref.search({ title: 'x', surname: 'Magesh' }, h, ctx);
    expect(r.candidates[0]!.title).toBe('Hallucination\u2010Free? Assessing the Reliability of Leading AI Legal Research Tools');
  });
});
