import { describe, expect, it } from 'vitest';
import { createAssay, parseCitations } from '../src/index.js';
import type { Citation } from '../src/index.js';
import { cr, crItem, ol, oa, oaWork, router } from './helpers.js';

const REAL = crItem('Prospect Theory: An Analysis of Decision under Risk', ['Kahneman', 'Tversky'], '10.2307/1914185');
const ref = (o: Partial<Citation> = {}): Citation => ({ raw: 'x', tag: '[x]', authors: 'Kahneman & Tversky', year: '1979', title: 'Prospect Theory: An Analysis of Decision under Risk', venue: 'Econometrica', url: '', tier: 'search', ...o });
const run = async (routes: Parameters<typeof router>[0], c: Citation) => {
  const net = router(routes);
  const a = createAssay({ fetch: net.fetch, retryDelayMs: 0 });
  const rep = await a.verify([c]);
  return { v: rep.verdicts[0]!, rep, net };
};

describe('the title and author check', () => {
  it('verifies a real paper with a real DOI', async () => {
    const { v } = await run({ 'api.crossref.org/works?query': cr(REAL), 'api.crossref.org/works/10.2307/1914185': { status: 200, body: { message: REAL } } }, ref({ url: 'https://doi.org/10.2307/1914185' }));
    expect(v).toMatchObject({ status: 'found', exact: true, bucket: 'ok', source: 'CrossRef' });
    expect(v.message).toBe('Verified in CrossRef.');
  });

  it('flags an invented paper: no record at all, or a real author with a title they never wrote', async () => {
    const none = await run({ 'api.crossref.org/works?query': cr(), 'api.openalex.org': oa() }, ref({ authors: 'Meyer', year: '2016', title: 'The Impact of Microcredit: Evidence from Bosnia and Herzegovina' }));
    expect(none.v).toMatchObject({ status: 'notfound', bucket: 'failed' });
    expect(none.v.message).toMatch(/Not found in CrossRef, OpenAlex, Open Library/);
    const real = await run({ 'api.crossref.org/works?query': cr(crItem('The Microfinance Promise', ['Morduch'], '10.1257/jel.37.4.1569')), 'api.openalex.org': oa() }, ref({ authors: 'Morduch', year: '1999', title: 'The Role of Microfinance in Poverty Reduction' }));
    expect(real.v).toMatchObject({ status: 'mismatch', bucket: 'failed' });
  });

  it('requires two authors on the same record when two are cited', async () => {
    const solo = await run({ 'api.crossref.org/works?query': cr(crItem('Two Demographic Transition Models with Different Implications', ['Lesthaeghe'])), 'api.openalex.org': oa() }, ref({ authors: 'Lesthaeghe & van de Kaa', year: '1986', title: 'Two Demographic Transition Models with Different Implications' }));
    expect(solo.v.status).toBe('mismatch');
  });

  it('never says "not found" when a source could not answer: the others finding nothing proves nothing', async () => {
    const { v } = await run({ 'api.crossref.org': { status: 500, body: {} }, 'api.openalex.org': oa(), 'openlibrary.org/search.json': ol() }, ref({ authors: 'Rose', year: '1985', title: 'Sick individuals and sick populations' }));
    expect(v).toMatchObject({ status: 'unavailable', bucket: 'check' });
  });

  it('retries once when a source says slow down (429)', async () => {
    let n = 0;
    const f = (async (url: string) => {
      if (String(url).includes('api.crossref.org') && n++ === 0) return { ok: false, status: 429, headers: new Headers(), json: async () => ({}) } as Response;
      return { ok: true, status: 200, json: async () => ({ message: { items: [REAL] }, results: [], docs: [] }) } as Response;
    }) as unknown as typeof fetch;
    const rep = await createAssay({ fetch: f, retryDelayMs: 0 }).verify([ref()]);
    expect(rep.verdicts[0]!.status).toBe('found');
    expect(n).toBe(2);
  });

  it('is "unavailable", never "not found", when every source is unreachable', async () => {
    const { v } = await run({ 'api.crossref.org': 'throw', 'api.openalex.org': 'throw', 'openlibrary.org': 'throw' }, ref());
    expect(v).toMatchObject({ status: 'unavailable', bucket: 'check' });
  });

  it('folds accents (OpenAlex writes Bourdieu "Bourdıeu"), and matches a title cited without its subtitle', async () => {
    const b = await run({ 'api.crossref.org/works?query': cr(), 'api.openalex.org': oa(oaWork('The Forms of Capital', 'Pierre Bourdıeu')) }, ref({ authors: 'Pierre Bourdieu', year: '1986', title: 'The Forms of Capital' }));
    expect(b.v.status).toBe('found');
    const n = await run({ 'api.crossref.org/works?query': cr(), 'api.openalex.org': oa(oaWork('Why nations fail: the origins of power, prosperity, and poverty', 'Daron Acemoğlu')) }, ref({ authors: 'Acemoglu', year: '2012', title: 'Why Nations Fail' }));
    expect(n.v.status).toBe('found');
    const unrelated = await run({ 'api.crossref.org/works?query': cr(), 'api.openalex.org': oa(oaWork('Why nations fail: the origins of power, prosperity, and poverty', 'Daron Acemoğlu')) }, ref({ authors: 'Acemoglu', year: '2012', title: 'Why Aid Fails' }));
    expect(unrelated.v.status).toBe('mismatch');
  });

  it('finds a real book in Open Library when neither journal index holds it, and not an invented one', async () => {
    const hit = await run({ 'api.crossref.org/works?query': cr(), 'api.openalex.org': oa(), 'openlibrary.org/search.json': ol({ title: 'Social systems', author_name: ['Niklas Luhmann'], first_publish_year: 1995 }) }, ref({ authors: 'Luhmann', year: '1984', title: 'Social Systems', venue: 'Stanford University Press' }));
    expect(hit.v).toMatchObject({ status: 'found', source: 'Open Library' });
    const miss = await run({ 'api.crossref.org/works?query': cr(), 'api.openalex.org': oa(), 'openlibrary.org/search.json': ol() }, ref({ authors: 'Luhmann', year: '1984', title: 'The Role of Systems in Poverty Reduction' }));
    expect(miss.v.status).toBe('notfound');
  });
});

describe('the link the citation gives', () => {
  it('does not call a real paper "verified" when its DOI was invented, and offers the real one', async () => {
    const { v } = await run({ 'api.crossref.org/works?query': cr(REAL), 'api.crossref.org/works/10.2308': { status: 404, body: {} }, 'doi.org/api/handles/10.2308': { status: 404, body: { responseCode: 100 } } }, ref({ url: 'https://doi.org/10.2308/ptri.1979.47.2.263' }));
    expect(v).toMatchObject({ status: 'badlink', bucket: 'failed', linkState: 'dead', suggestedDoi: '10.2307/1914185' });
    expect(v.message).toBe('The paper exists, but the DOI given does not exist. The closest match in the database has DOI 10.2307/1914185.');
  });

  it('calls a DOI wrong when it is another paper (Coase 1960 pointed at a book review)', async () => {
    const { v } = await run({ 'api.crossref.org/works?query': cr(crItem('The Problem of Social Cost', ['Coase'], '10.1086/466560')), 'api.crossref.org/works/10.1086/294594': { status: 200, body: { message: crItem('Book Review: Developing Better Managers', ['Thorelli']) } } }, ref({ authors: 'Coase', year: '1960', title: 'The Problem of Social Cost', url: 'https://doi.org/10.1086/294594' }));
    expect(v).toMatchObject({ status: 'badlink', linkState: 'wrong', suggestedDoi: '10.1086/466560' });
  });

  it('does not call a real DOI at another registrar wrong, and says nothing when the DOI service is unreachable', async () => {
    const other = await run({ 'api.crossref.org/works?query': cr(REAL), 'api.crossref.org/works/10.5281': { status: 404, body: {} }, 'doi.org/api/handles': { status: 200, body: { responseCode: 1 } } }, ref({ url: 'https://doi.org/10.5281/zenodo.123' }));
    expect(other.v.status).toBe('found');
    const offline = await run({ 'api.crossref.org/works?query': cr(REAL), 'api.crossref.org/works/10.1': 'throw' }, ref({ url: 'https://doi.org/10.1/x' }));
    expect(offline.v.status).toBe('found');
  });

  it('checks SSRN and arXiv links as the DOIs they stand for; an arXiv DOI is compared by title through DataCite', async () => {
    const routes = (t: string) => ({ 'api.crossref.org/works?query': cr(crItem('Attention Is All You Need', ['Vaswani'])), 'api.crossref.org/works/10.48550': { status: 404, body: {} }, 'doi.org/api/handles': { status: 200, body: { responseCode: 1 } }, 'api.datacite.org': { status: 200, body: { data: { attributes: { titles: [{ title: t }] } } } } });
    const claim = ref({ authors: 'Vaswani', year: '2017', title: 'Attention Is All You Need', url: 'https://arxiv.org/abs/1706.03762' });
    expect((await run(routes('Attention Is All You Need'), claim)).v.status).toBe('found');
    expect((await run(routes('A Completely Different Paper About Graphs'), claim)).v).toMatchObject({ status: 'badlink', linkState: 'wrong' });
  });

  it('checks a PubMed link by PMID, and reports any other direct link as not checked', async () => {
    const real = crItem('Sick individuals and sick populations', ['Rose'], '10.1093/ije/14.1.32');
    const ok = await run({ 'api.crossref.org/works?query': cr(real), 'eutils.ncbi.nlm.nih.gov': { status: 200, body: { result: { '3991755': { title: 'Sick individuals and sick populations.' } } } } }, ref({ authors: 'Rose', year: '1985', title: 'Sick individuals and sick populations', url: 'https://pubmed.ncbi.nlm.nih.gov/3991755/' }));
    expect(ok.v.status).toBe('found');
    const gone = await run({ 'api.crossref.org/works?query': cr(real), 'eutils.ncbi.nlm.nih.gov': { status: 200, body: { result: { '1': { error: 'cannot get document summary' } } } } }, ref({ authors: 'Rose', year: '1985', title: 'Sick individuals and sick populations', url: 'https://pubmed.ncbi.nlm.nih.gov/1/' }));
    expect(gone.v).toMatchObject({ status: 'badlink', linkState: 'dead' });
    const direct = await run({ 'api.crossref.org/works?query': cr(REAL) }, ref({ url: 'https://www.example.org/a-paper' }));
    expect(direct.v).toMatchObject({ status: 'found', bucket: 'check' });
    expect(direct.v.notes.join(' ')).toMatch(/link is not checked/);
  });
});

describe('a paper that exists but is cited wrongly', () => {
  const real = { title: ['Savings Constraints and Microenterprise Development: Evidence from a Field Experiment in Kenya'], author: [{ family: 'Dupas' }, { family: 'Robinson' }], DOI: '10.1257/app.5.1.163', type: 'journal-article', 'container-title': ['American Economic Journal: Applied Economics'], issued: { 'date-parts': [[2013]] } };
  const claim = (o: Partial<Citation> = {}) => ref({ authors: 'Dupas & Robinson', year: '2013', title: real.title[0], venue: 'American Economic Journal: Applied Economics', ...o });
  const go = (c: Citation) => run({ 'api.crossref.org/works?query': cr(real) }, c);

  it('says nothing about a correct citation, and names the real journal and year when they differ', async () => {
    expect((await go(claim())).v.notes).toEqual([]);
    expect((await go(claim({ venue: 'Econometrica' }))).v.notes.join()).toMatch(/journal in the record/);
    expect((await go(claim({ venue: 'American Economic Review' }))).v.notes.join()).toMatch(/journal in the record/);
    expect((await go(claim({ year: '2009' }))).v.notes.join()).toMatch(/the record says 2013, not 2009/);
    expect((await go(claim({ venue: 'AEJ' }))).v.notes).toEqual([]);
  });

  it('shows the real title for a near-miss instead of stamping it verified', async () => {
    const { v } = await go(claim({ title: 'Savings Constraints and Microenterprise Returns: Evidence from a Field Experiment' }));
    expect(v).toMatchObject({ status: 'found', exact: false, bucket: 'check' });
    expect(v.message).toMatch(/the title differs/);
    expect(v.message).toMatch(/Microenterprise Development/);
  });

  it('does not call a book reissue a wrong year', async () => {
    const book = await run({ 'api.crossref.org/works?query': cr({ title: ["The Innovator's Dilemma"], author: [{ family: 'Christensen' }], type: 'book', issued: { 'date-parts': [[2011]] } }) }, ref({ authors: 'Christensen', year: '1997', title: "The Innovator's Dilemma", venue: 'Harvard Business School Press' }));
    expect(book.v.notes).toEqual([]);
  });
});

describe('a reprint of the paper cited (Rose 1985, reprinted 2001)', () => {
  const original = { title: ['Sick individuals and sick populations'], author: [{ family: 'Rose' }], DOI: '10.1093/ije/14.1.32', type: 'journal-article', 'container-title': ['International Journal of Epidemiology'], issued: { 'date-parts': [[1985]] } };
  const reprint = { ...original, DOI: '10.1093/ije/30.3.427', issued: { 'date-parts': [[2001]] } };
  const claim = ref({ authors: 'Rose', year: '1985', title: 'Sick individuals and sick populations', venue: 'International Journal of Epidemiology', url: 'https://doi.org/10.1093/ije/14.1.32' });

  it('compares year and journal with the record of the DOI that was given, not with the reprint the search returned first', async () => {
    const { v } = await run({ 'api.crossref.org/works?query': cr(reprint, original), 'api.crossref.org/works/10.1093/ije/14.1.32': { status: 200, body: { message: original } } }, claim);
    expect(v).toMatchObject({ status: 'found', bucket: 'ok' });
    expect(v.notes).toEqual([]);
  });

  it('with no link, prefers the record whose year is nearest the one cited', async () => {
    const { v } = await run({ 'api.crossref.org/works?query': cr(reprint, original) }, ref({ ...claim, url: '' }));
    expect(v.match?.year).toBe(1985);
    expect(v.bucket).toBe('ok');
  });
});

describe('approximate citations', () => {
  it('never accuses when a source could not answer', async () => {
    const approx0 = parseCitations('[CITATION — approximate: Putnam, 1993-2002, social capital and civic engagement — search: https://scholar.google.com/scholar?q=x]')[0]!;
    const r = await run({ 'api.openalex.org': { status: 429, body: {} }, 'openlibrary.org/search.json': ol() }, approx0);
    expect(r.v).toMatchObject({ status: 'unavailable', bucket: 'check' });
  });
  const approx = (inner: string) => parseCitations(`[CITATION — approximate: ${inner}]`)[0]!;
  it('"cannot confirm" when the author has related work, a warning when none, neutral when unreadable', async () => {
    const ok = await run({ 'api.openalex.org': oa(oaWork("Bowling Alone: America's Declining Social Capital", 'Robert D. Putnam')) }, approx('Putnam, 1993-2002, social capital and civic engagement — search: https://scholar.google.com/scholar?q=x'));
    expect(ok.v).toMatchObject({ status: 'approx-ok', bucket: 'check' });
    const none = await run({ 'api.openalex.org': oa(), 'openlibrary.org/search.json': ol() }, approx('Zorblatt, 2010-2015, quantum remittance theory — search: https://scholar.google.com/scholar?q=x'));
    expect(none.v).toMatchObject({ status: 'approx-none', bucket: 'failed' });
    expect((await run({}, approx('some area of the literature'))).v.status).toBe('approx-unparsed');
    const book = await run({ 'api.openalex.org': oa(), 'openlibrary.org/search.json': ol({ title: 'Distinction', author_name: ['Pierre Bourdieu'], first_publish_year: 1979 }) }, approx('Bourdieu, 1980-1990, cultural capital — search: https://scholar.google.com/scholar?q=x'));
    expect(book.v.status).toBe('approx-ok');
  });
});

describe('a text with a flood of citations', () => {
  it('checks only the first maxCitations and sends no requests for the rest', async () => {
    const net = router({ 'api.crossref.org/works?query': cr(), 'api.openalex.org': oa() });
    const text = Array.from({ length: 500 }, (_, i) => `[Author${i}, 2001, "A Distinct Title Number ${i} About Things" — J]`).join(' ');
    const rep = await createAssay({ fetch: net.fetch, retryDelayMs: 0, maxCitations: 5 }).check(text);
    expect(rep.verdicts).toHaveLength(500);
    expect(rep.verdicts.filter((v) => v.status === 'limit')).toHaveLength(495);
    expect(rep.verdicts.filter((v) => v.status === 'limit').every((v) => v.bucket === 'check')).toBe(true);
    expect(net.calls.length).toBeLessThanOrEqual(5 * 4);   // at most three searches and a link check each, for five citations
  });
  it('defaults to 50, so a text of thousands cannot become thousands of requests', async () => {
    const net = router({ 'api.crossref.org/works?query': cr(), 'api.openalex.org': oa() });
    const text = Array.from({ length: 5000 }, (_, i) => `[Author${i}, 2001, "A Distinct Title Number ${i} About Things" — J]`).join(' ');
    await createAssay({ fetch: net.fetch, retryDelayMs: 0 }).check(text);
    expect(net.calls.length).toBeLessThanOrEqual(50 * 4);
  });
});

describe('the cache and the options', () => {
  it('asks about a citation once', async () => {
    const net = router({ 'api.crossref.org/works?query': cr(REAL) });
    const a = createAssay({ fetch: net.fetch });
    await a.verify([ref()]);
    const first = net.calls.length;
    await a.verify([ref()]);
    expect(net.calls.length).toBe(first);
  });

  it('does not keep "unavailable": a failed lookup is retried next time', async () => {
    const net = router({ 'api.crossref.org': 'throw', 'api.openalex.org': 'throw', 'openlibrary.org': 'throw' });
    const a = createAssay({ fetch: net.fetch });
    await a.verify([ref()]);
    const first = net.calls.length;
    await a.verify([ref()]);
    expect(net.calls.length).toBeGreaterThan(first);
  });

  it('sends your address to CrossRef and OpenAlex only when you give one', async () => {
    const net = router({ 'api.crossref.org/works?query': cr(), 'api.openalex.org': oa() });
    await createAssay({ fetch: net.fetch }).verify([ref({ authors: 'Zzz', title: 'An Invented Title About Nothing Real' })]);
    expect(net.calls.some((u) => u.includes('mailto'))).toBe(false);
    const net2 = router({ 'api.crossref.org/works?query': cr(), 'api.openalex.org': oa() });
    await createAssay({ fetch: net2.fetch, mailto: 'me@example.test' }).verify([ref({ authors: 'Zzz', title: 'An Invented Title About Nothing Real' })]);
    expect(net2.calls.filter((u) => u.includes('mailto=me%40example.test')).length).toBeGreaterThanOrEqual(2);
  });

  it('sends an OpenAlex key to OpenAlex only, when you give one', async () => {
    const net = router({ 'api.crossref.org/works?query': cr(), 'api.openalex.org': oa() });
    await createAssay({ fetch: net.fetch, keys: { openalex: 'oa-test-key' } }).verify([ref({ authors: 'Zzz', title: 'An Invented Title About Nothing Real' })]);
    expect(net.calls.filter((u) => u.includes('api_key=oa-test-key')).every((u) => u.includes('api.openalex.org'))).toBe(true);
    expect(net.calls.some((u) => u.includes('api_key=oa-test-key'))).toBe(true);
    expect(net.calls.some((u) => u.includes('crossref.org') && u.includes('oa-test-key'))).toBe(false);
  });

  it('takes your own sources, and never throws on a broken one', async () => {
    const mine = { name: 'MyIndex', search: async (_q: unknown, _h: unknown, _c: unknown) => ({ ok: true, candidates: [{ title: 'Prospect Theory: An Analysis of Decision under Risk', authors: ['Kahneman', 'Tversky'], year: 1979, doi: '', article: false, venue: '' }] }) };
    const net = router({});
    expect((await createAssay({ fetch: net.fetch, sources: [mine] }).verify([ref()])).verdicts[0]).toMatchObject({ status: 'found', source: 'MyIndex' });
    const broken = { name: 'Broken', search: async () => { throw new Error('boom'); } };
    expect((await createAssay({ fetch: net.fetch, sources: [broken] }).verify([ref()])).verdicts[0]!.status).toBe('skip');
  });
});
