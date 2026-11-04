import type { Http } from './http.js';
import type { Candidate, Citation, KeyValueStore, Status, Verdict } from './types.js';
import { splitAuthors } from './parse.js';
import { nameKey, significantWords, titleSimilarity, venueSimilarity, TITLE_EXACT_THRESHOLD, TITLE_MATCH_THRESHOLD } from './text.js';
import { countAuthorMatches, openalexKey, type SearchSource } from './sources.js';
import { checkLink } from './links.js';
import { bucketOf, messageFor, suggestedDoiOf } from './verdict.js';

export interface Ctx { http: Http; sources: SearchSource[]; mailto: string; keys: Record<string, string>; cache: KeyValueStore; cacheTtlMs: number }

/** What is worth caching about a check: everything but the citation itself. */
type Core = Pick<Verdict, 'status' | 'source' | 'exact' | 'match' | 'notes' | 'linkState' | 'suggestedDoi'>;

export function cacheKey(c: Citation): string {
  if (c.tier === 'approximate') return 'assay:v1:approx|' + c.raw.toLowerCase().slice(0, 120);
  const sn = splitAuthors(c.authors).map((s) => nameKey(s.split(/\s+/).pop())).filter(Boolean);
  return 'assay:v1:' + sn.slice(0, 3).join('+') + '|' + (parseInt(c.year, 10) || 'nd') + '|' + (c.title || '').toLowerCase().slice(0, 80);
}

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

async function core(c: Citation, ctx: Ctx): Promise<{ core: Core; searched: string[] }> {
  if (c.tier === 'approximate') return { core: await verifyApproximate(c, ctx), searched: ['OpenAlex', 'Open Library'] };
  const raw = splitAuthors(c.authors).map((s) => s.split(/\s+/).pop() || '');
  const surnames = raw.map(nameKey).filter(Boolean);
  if (!surnames.length || (surnames.length === 1 && surnames[0] === 'unknown')) return { core: { status: 'skip', notes: [] }, searched: [] };
  if (!c.title) return { core: { status: 'no-title', notes: [] }, searched: [] };
  // A citation naming 2+ authors must match at least 2 of them on the SAME record to count as found: a single shared surname is
  // not enough. A real run resolved "Lesthaeghe & van de Kaa (1986)" against a same-titled SOLO Lesthaeghe paper from another year.
  const required = surnames.length <= 1 ? 1 : 2;
  let bestSim = 0, bestSource = '', best: Candidate | null = null, authorSeen = false, anyOk = false, anyFailed = false;
  const searched: string[] = [];
  for (const src of ctx.sources) {
    if (bestSim >= TITLE_MATCH_THRESHOLD) break;
    searched.push(src.name);
    const r = await src.search({ title: c.title, surname: raw[0] || '' }, ctx.http, { mailto: ctx.mailto, keys: ctx.keys });
    if (!r.ok) { anyFailed = true; continue; } // throttled or unreachable: not "no match"
    anyOk = true;
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
  // "Not found" is an accusation, so it needs every source to have answered. If one was throttled or down, the others finding nothing proves nothing.
  const status: Status = !anyOk || anyFailed ? 'unavailable' : authorSeen ? 'mismatch' : 'notfound';
  return { core: { status, notes: [] }, searched };
}

/**
 * An "approximate" citation names an author's general area, not one paper, so there is no title to confirm. What can be asked is
 * whether anyone with that surname has work on that topic: OpenAlex (within the years given, plus a margin), then Open Library for
 * books. "No such work" is a warning; "some work exists" is only ever "cannot confirm".
 */
async function verifyApproximate(c: Citation, ctx: Ctx): Promise<Core> {
  const seg = (c.raw.match(/approximate:\s*([^—\]]+)/i) || [])[1] || '';
  const am = seg.match(/^\s*([A-Z][\p{L}'’-]+(?:\s*(?:&|and|\/)\s*[A-Z][\p{L}'’-]+)*)/u);
  if (!am) return { status: 'approx-unparsed', notes: [] };
  const names = am[1]!.split(/\s*(?:&|and|\/)\s*/).map((n) => n.trim()).filter(Boolean);
  const surnames = names.map((n) => nameKey(n.split(/\s+/).pop())).filter(Boolean);
  if (!surnames.length) return { status: 'approx-unparsed', notes: [] };
  const years = (seg.match(/\b(?:19|20)\d{2}\b/g) || []).map(Number);
  const topic = significantWords(seg.slice(am[0].length).replace(/\b(?:19|20)\d{2}(?:\s*[-–]\s*(?:19|20)?\d{2,4})?/g, ' ')).slice(0, 6);
  const mail = ctx.mailto ? `&mailto=${encodeURIComponent(ctx.mailto)}` : '';
  let anyOk = false, anyFailed = false;
  const q = encodeURIComponent((topic.join(' ') + ' ' + names[0]).trim());
  const yr = years.length ? `&filter=publication_year:${Math.min(...years) - 2}-${Math.max(...years) + 2}` : '';
  const oa = await ctx.http.json(`https://api.openalex.org/works?search=${q}&per_page=25${yr}${mail}${openalexKey(ctx.keys)}`);
  if (!oa.ok) anyFailed = true;
  if (oa.ok) {
    anyOk = true;
    const hit = ((oa.body as any)?.results || []).find((it: any) => (it.authorships || []).some((a: any) => surnames.some((sn) => nameKey(a.author?.display_name).includes(sn))));
    if (hit) return { status: 'approx-ok', source: 'OpenAlex', notes: [], match: { title: hit.title || '', authors: [], year: hit.publication_year || 0, doi: '', article: false, venue: '' } };
  }
  const ol = await ctx.http.json(`https://openlibrary.org/search.json?author=${encodeURIComponent((names[0] || '').split(/\s+/).pop() || '')}&q=${encodeURIComponent(topic.join(' '))}&limit=10&fields=title,author_name,first_publish_year`);
  if (!ol.ok) anyFailed = true;
  if (ol.ok) {
    anyOk = true;
    const hit = ((ol.body as any)?.docs || []).find((d: any) => (d.author_name || []).some((n: string) => surnames.some((sn) => nameKey(n).includes(sn))));
    if (hit) return { status: 'approx-ok', source: 'Open Library', notes: [], match: { title: hit.title || '', authors: [], year: hit.first_publish_year || 0, doi: '', article: false, venue: '' } };
  }
  // As for a paper: "none found" needs every source to have answered.
  return { status: anyOk && !anyFailed ? 'approx-none' : 'unavailable', notes: [] };
}

/** Checks one citation. Never throws: a source that fails is "unavailable", and an unreadable citation is "skip". */
export async function verifyCitation(c: Citation, ctx: Ctx): Promise<Verdict> {
  const key = cacheKey(c);
  let hit: Core | undefined;
  try { hit = (await ctx.cache.get(key)) as Core | undefined; } catch { /* a cache that cannot be read is a miss */ }
  let searched: string[] = ctx.sources.map((s) => s.name);
  let res: Core;
  if (hit && typeof hit === 'object' && typeof (hit as Core).status === 'string') res = hit;
  else {
    try { const r = await core(c, ctx); res = r.core; searched = r.searched; }
    catch { res = { status: 'skip', notes: [] }; }
    // An answer that is only "could not reach anyone" is not worth keeping.
    if (res.status !== 'unavailable') { try { await ctx.cache.set(key, res, { ttlMs: ctx.cacheTtlMs }); } catch { /* the check still stands */ } }
  }
  return { citation: c, ...res, bucket: bucketOf(res.status, res.exact, res.notes), message: messageFor(res, searched) };
}
