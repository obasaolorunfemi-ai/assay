import type { Http } from './http.js';
import type { Candidate, Citation, KeyValueStore, Status, Verdict } from './types.js';
import { splitAuthors } from './parse.js';
import { nameKey, significantWords, titleSimilarity, venueSimilarity, TITLE_EXACT_THRESHOLD, TITLE_MATCH_THRESHOLD } from './text.js';
import { countAuthorMatches, openalexKey, type SearchSource } from './sources.js';
import { checkLink } from './links.js';
import { bucketOf, messageFor, suggestedDoiOf } from './verdict.js';
import type { HealthBook } from './health.js';

export interface Ctx {
  http: Http; sources: SearchSource[]; mailto: string; keys: Record<string, string>;
  cache: KeyValueStore; cacheTtlMs: number; staleTtlMs: number;
  health: HealthBook; now: () => number;
  /** Self-tests in progress, by source, so citations checked at the same moment share one instead of each running their own. */
  probes: Map<string, Promise<boolean>>;
  /** Ask a source for its known work before believing its "not found". Default true. */
  selfTest: boolean;
}

/** What is worth caching about a check: everything but the citation itself. */
type Core = Pick<Verdict, 'status' | 'source' | 'exact' | 'match' | 'notes' | 'linkState' | 'suggestedDoi' | 'reason'>;
interface Entry { core: Core; at: number }

export function cacheKey(c: Citation): string {
  if (c.tier === 'approximate') return 'assay:v2:approx|' + c.raw.toLowerCase().slice(0, 120);
  const sn = splitAuthors(c.authors).map((s) => nameKey(s.split(/\s+/).pop())).filter(Boolean);
  // The link is part of the key: "found, and its DOI is right" and "found, but its DOI is invented" are different answers about the same paper.
  return 'assay:v2:' + sn.slice(0, 3).join('+') + '|' + (parseInt(c.year, 10) || 'nd') + '|' + (c.title || '').toLowerCase().slice(0, 80) + '|' + (c.url || '').toLowerCase().slice(0, 160);
}

/** An answer worth keeping and worth serving later: a real conclusion, not "could not tell". */
const conclusive = (s: Status) => s !== 'unavailable' && s !== 'limit' && s !== 'skip';

function yearGap(cand: Candidate, c: Citation): number {
  const y = parseInt(c.year, 10);
  return y && cand.year ? Math.abs(cand.year - y) : 9999;
}

/** A paper can exist and still be cited wrongly: the year or journal is another's. Only for journal articles (a book's year is its reissue's), and only when the claim is specific enough to compare. */
function metaNotes(c: Citation, best: Candidate | null): string[] {
  const notes: string[] = [];
  if (!best || !best.article) return notes;
  const y = parseInt(c.year, 10);
  if (y && best.year && Math.abs(y - best.year) > 1) notes.push(`the record says ${best.year}, not ${y}`);
  const v = (c.venue || '').trim();
  if (v && best.venue && !/^[A-Z&]{2,8}$/.test(v)) {
    const many = significantWords(v).length >= 2;
    const differs = many ? venueSimilarity(v, best.venue) < 0.5 : nameKey(v).length >= 5 && !nameKey(best.venue).includes(nameKey(v));
    if (differs) notes.push(`the journal in the record is “${best.venue.slice(0, 80)}”`);
  }
  return notes;
}

/**
 * Before a source's "not found" is believed, it must find a work we know exists. A source can break without an error: an index that
 * stops returning results, a field renamed, a search that quietly degrades. Its empty answers would then be read as "this citation
 * does not exist". A passed test is trusted for ten minutes. Returns the names of sources that failed the test.
 */
export async function failedSelfTest(sources: SearchSource[], ctx: Ctx, force = false): Promise<string[]> {
  if (!ctx.selfTest && !force) return [];
  const bad: string[] = [];
  for (const src of sources) {
    if (!src.canary || (!force && ctx.health.selfTestFresh(src.name))) continue;
    if (!ctx.health.allow(src.name)) { bad.push(src.name); continue; }   // being given time to recover: not probed
    const canary = src.canary;
    let p = ctx.probes.get(src.name);
    if (!p) {
      p = (async () => {
        const r = await src.search({ title: canary.title, surname: canary.surname }, ctx.http, { mailto: ctx.mailto, keys: ctx.keys });
        if (!r.ok) { ctx.health.failure(src.name, r.problem ?? 'self-test could not run', r.retryAfterMs); return false; }
        const want = canary.authors.map(nameKey);
        const found = r.candidates.some((cand) => titleSimilarity(canary.title, cand.title) >= TITLE_EXACT_THRESHOLD && want.some((w) => cand.authors.some((a) => nameKey(a).includes(w) || w.includes(nameKey(a)))));
        if (found) ctx.health.selfTestPassed(src.name); else ctx.health.selfTestFailed(src.name);
        return found;
      })().finally(() => ctx.probes.delete(src.name));
      ctx.probes.set(src.name, p);
    }
    if (!(await p)) bad.push(src.name);
  }
  return bad;
}

async function core(c: Citation, ctx: Ctx): Promise<{ core: Core; searched: string[] }> {
  if (c.tier === 'approximate') return verifyApproximate(c, ctx);
  const raw = splitAuthors(c.authors).map((s) => s.split(/\s+/).pop() || '');
  const surnames = raw.map(nameKey).filter(Boolean);
  if (!surnames.length || (surnames.length === 1 && surnames[0] === 'unknown')) return { core: { status: 'skip', notes: [] }, searched: [] };
  if (!c.title) return { core: { status: 'no-title', notes: [] }, searched: [] };
  // A citation naming 2+ authors must match at least 2 of them on the SAME record to count as found: a single shared surname is
  // not enough. A real run resolved "Lesthaeghe & van de Kaa (1986)" against a same-titled SOLO Lesthaeghe paper from another year.
  const required = surnames.length <= 1 ? 1 : 2;
  let bestSim = 0, bestSource = '', best: Candidate | null = null, authorSeen = false, anyOk = false;
  const problems: string[] = [];
  const answered: SearchSource[] = [];
  const searched: string[] = [];
  for (const src of ctx.sources) {
    if (bestSim >= TITLE_MATCH_THRESHOLD) break;
    searched.push(src.name);
    // A source that is being left alone (down, or throttled until later) is not asked. That is not "no match" either.
    if (!ctx.health.allow(src.name)) { problems.push(`${src.name} is being given time to recover`); continue; }
    const r = await src.search({ title: c.title, surname: raw[0] || '' }, ctx.http, { mailto: ctx.mailto, keys: ctx.keys });
    if (!r.ok) { ctx.health.failure(src.name, r.problem ?? 'did not answer', r.retryAfterMs); problems.push(`${src.name}: ${r.problem ?? 'did not answer'}`); continue; }
    ctx.health.success(src.name);
    anyOk = true; answered.push(src);
    for (const cand of r.candidates) {
      const matched = countAuthorMatches(surnames, cand.authors, src.authorMode ?? 'display');
      if (matched > 0) authorSeen = true;
      const sim = titleSimilarity(c.title, cand.title);
      if (sim < TITLE_MATCH_THRESHOLD || matched < required) continue;
      // Equal titles (a reprint, a working-paper version): the one whose year is nearest the cited year wins.
      const tie = best !== null && Math.abs(sim - bestSim) < 1e-9 && yearGap(cand, c) < yearGap(best, c);
      if (sim > bestSim + 1e-9 || tie) { bestSim = sim; bestSource = src.name; best = cand; }
    }
  }
  if (bestSim >= TITLE_MATCH_THRESHOLD && best) {
    const out: Core = { status: 'found', source: bestSource, exact: bestSim >= TITLE_EXACT_THRESHOLD, match: best, notes: metaNotes(c, best) };
    const link = await checkLink(c, ctx.http, ctx.mailto);
    if (link.state === 'dead' || link.state === 'wrong') {
      out.status = 'badlink'; out.linkState = link.state; out.suggestedDoi = suggestedDoiOf(best.doi);
    } else if (link.state === 'direct') out.notes.push('the link is not checked: open it and confirm it is this paper');
    // The DOI the citation gave names its own record: year and journal are compared against THAT, not against a reprint the search happened to return.
    else if (link.state === 'ok' && link.record) out.notes = metaNotes(c, { ...best, ...link.record });
    return { core: out, searched };
  }
  // "Not found" is an accusation, so it needs every source to have answered, and each to have passed its self-test.
  if (!anyOk || problems.length) return { core: { status: 'unavailable', notes: [], reason: problems.join('; ') || 'no source answered' }, searched };
  const sick = await failedSelfTest(answered, ctx);
  if (sick.length) return { core: { status: 'unavailable', notes: [], reason: `${sick.join(', ')} did not pass its self-test` }, searched };
  return { core: { status: authorSeen ? 'mismatch' : 'notfound', notes: [] }, searched };
}

/**
 * An "approximate" citation names an author's general area, not one paper, so there is no title to confirm. What can be asked is
 * whether anyone with that surname has work on that topic: OpenAlex (within the years given, plus a margin), then Open Library for
 * books. "No such work" is a warning; "some work exists" is only ever "cannot confirm". As for a paper, "none" needs every source to
 * have answered and passed its self-test.
 */
async function verifyApproximate(c: Citation, ctx: Ctx): Promise<{ core: Core; searched: string[] }> {
  const searched = ['OpenAlex', 'Open Library'];
  const seg = (c.raw.match(/approximate:\s*([^—\]]+)/i) || [])[1] || '';
  const am = seg.match(/^\s*([A-Z][\p{L}'’-]+(?:\s*(?:&|and|\/)\s*[A-Z][\p{L}'’-]+)*)/u);
  if (!am) return { core: { status: 'approx-unparsed', notes: [] }, searched };
  const names = am[1]!.split(/\s*(?:&|and|\/)\s*/).map((n) => n.trim()).filter(Boolean);
  const surnames = names.map((n) => nameKey(n.split(/\s+/).pop())).filter(Boolean);
  if (!surnames.length) return { core: { status: 'approx-unparsed', notes: [] }, searched };
  const years = (seg.match(/\b(?:19|20)\d{2}\b/g) || []).map(Number);
  const topic = significantWords(seg.slice(am[0].length).replace(/\b(?:19|20)\d{2}(?:\s*[-–]\s*(?:19|20)?\d{2,4})?/g, ' ')).slice(0, 6);
  const mail = ctx.mailto ? `&mailto=${encodeURIComponent(ctx.mailto)}` : '';
  const problems: string[] = [];
  let answered = 0;
  const asked: SearchSource[] = [];
  const bySource = (n: string) => ctx.sources.find((s) => s.name === n);

  if (ctx.health.allow('OpenAlex')) {
    const q = encodeURIComponent((topic.join(' ') + ' ' + names[0]).trim());
    const yr = years.length ? `&filter=publication_year:${Math.min(...years) - 2}-${Math.max(...years) + 2}` : '';
    const oa = await ctx.http.json(`https://api.openalex.org/works?search=${q}&per_page=25${yr}${mail}${openalexKey(ctx.keys)}`);
    const results = (oa.body as any)?.results;
    if (oa.ok && Array.isArray(results)) {
      ctx.health.success('OpenAlex'); answered++;
      const s = bySource('OpenAlex'); if (s) asked.push(s);
      const hit = results.find((it: any) => (it.authorships || []).some((a: any) => surnames.some((sn) => nameKey(a.author?.display_name).includes(sn))));
      if (hit) return { core: { status: 'approx-ok', source: 'OpenAlex', notes: [], match: { title: hit.title || '', authors: [], year: hit.publication_year || 0, doi: '', article: false, venue: '' } }, searched };
    } else { const why = oa.networkError ? 'unreachable' : oa.status === 429 ? 'rate limited (429)' : 'answered with something unexpected'; ctx.health.failure('OpenAlex', why, oa.retryAfterMs); problems.push(`OpenAlex: ${why}`); }
  } else problems.push('OpenAlex is being given time to recover');

  if (ctx.health.allow('Open Library')) {
    const ol = await ctx.http.json(`https://openlibrary.org/search.json?author=${encodeURIComponent((names[0] || '').split(/\s+/).pop() || '')}&q=${encodeURIComponent(topic.join(' '))}&limit=10&fields=title,author_name,first_publish_year`);
    const docs = (ol.body as any)?.docs;
    if (ol.ok && Array.isArray(docs)) {
      ctx.health.success('Open Library'); answered++;
      const s = bySource('Open Library'); if (s) asked.push(s);
      const hit = docs.find((d: any) => (d.author_name || []).some((n: string) => surnames.some((sn) => nameKey(n).includes(sn))));
      if (hit) return { core: { status: 'approx-ok', source: 'Open Library', notes: [], match: { title: hit.title || '', authors: [], year: hit.first_publish_year || 0, doi: '', article: false, venue: '' } }, searched };
    } else { const why = ol.networkError ? 'unreachable' : ol.status === 429 ? 'rate limited (429)' : 'answered with something unexpected'; ctx.health.failure('Open Library', why, ol.retryAfterMs); problems.push(`Open Library: ${why}`); }
  } else problems.push('Open Library is being given time to recover');

  if (!answered || problems.length) return { core: { status: 'unavailable', notes: [], reason: problems.join('; ') || 'no source answered' }, searched };
  const sick = await failedSelfTest(asked, ctx);
  if (sick.length) return { core: { status: 'unavailable', notes: [], reason: `${sick.join(', ')} did not pass its self-test` }, searched };
  return { core: { status: 'approx-none', notes: [] }, searched };
}

/** Checks one citation. Never throws: a source that fails is "unavailable", and an unreadable citation is "skip". */
export async function verifyCitation(c: Citation, ctx: Ctx): Promise<Verdict> {
  const key = cacheKey(c);
  let entry: Entry | undefined;
  try { const raw = (await ctx.cache.get(key)) as Entry | undefined; if (raw && typeof raw === 'object' && typeof raw.at === 'number' && raw.core && typeof raw.core.status === 'string') entry = raw; } catch { /* a cache that cannot be read is a miss */ }
  const fresh = entry && ctx.now() - entry.at < ctx.cacheTtlMs;
  let searched: string[] = ctx.sources.map((s) => s.name);
  let res: Core;
  let stale = false;
  if (entry && fresh) res = entry.core;
  else {
    try { const r = await core(c, ctx); res = r.core; searched = r.searched; }
    catch { res = { status: 'skip', notes: [] }; }
    if (conclusive(res.status)) { try { await ctx.cache.set(key, { core: res, at: ctx.now() } satisfies Entry, { ttlMs: ctx.staleTtlMs }); } catch { /* the check still stands */ } }
    // The sources cannot say, but we have said before: an earlier real answer beats "could not tell". It is marked as old.
    else if (res.status === 'unavailable' && entry && conclusive(entry.core.status)) { res = entry.core; stale = true; }
  }
  const retryable = res.status === 'unavailable' || res.status === 'limit';
  return { citation: c, ...res, ...(stale ? { stale: true } : {}), retryable, bucket: bucketOf(res.status, res.exact, res.notes), message: messageFor({ ...res, ...(stale ? { stale: true } : {}) }, searched) };
}
