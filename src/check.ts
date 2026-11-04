import type { Citation, KeyValueStore, Report, Verdict } from './types.js';
import { makeHttp } from './http.js';
import { parseCitations } from './parse.js';
import { defaultSources, type SearchSource } from './sources.js';
import { bucketOf, messageFor, summarize } from './verdict.js';
import { failedSelfTest, verifyCitation, type Ctx } from './verify.js';
import type { Tally } from './tally.js';
import { createHealthBook, type BreakerOptions, type SourceHealth } from './health.js';
import { checkLink, linkKind } from './links.js';

export interface AssayOptions {
  /** Count what this checker finds in a `Tally` of your own (numbers only). Nothing is sent anywhere: see `shareTally` if you choose to share the counts. */
  tally?: Tally;
  /**
   * Your address, sent to CrossRef and OpenAlex so they can reach you instead of blocking you (their "polite pool", about twice the
   * rate). Strongly recommended for anything that runs often. It is sent to those two services and nowhere else.
   */
  mailto?: string;
  /** Optional keys by source, in lower case. OpenAlex now limits each address to a small daily budget; a free key (openalex.org) lifts it: `{ openalex: '…' }`. Sent to that source only. */
  keys?: Record<string, string>;
  /** Where to look. Default: CrossRef, OpenAlex, then Open Library, stopping at the first that confirms. */
  sources?: SearchSource[];
  /** Keeps answers so a citation checked once is not asked about again. Default: in memory. Lodestone's stores fit. */
  cache?: KeyValueStore;
  /** How long a kept answer is trusted without asking again. Default one day. */
  cacheTtlMs?: number;
  /** How long a kept answer may still be served, marked `stale`, when the sources cannot be reached. Default 7 days. */
  staleTtlMs?: number;
  /** The most citations checked in one call. Each costs up to three requests to free, shared services, so a text with thousands (from a model, or from a user) must not be able to turn Assay into a way of hammering them. The rest come back as `limit` (bucket `check`). Default 50. */
  maxCitations?: number;
  /** Leave a failing source alone for a while, and believe a "retry after" it sends. See `BreakerOptions`. */
  breaker?: BreakerOptions;
  /** Before a source's "not found" is believed, ask it for a work that certainly exists (default true). Turn off only in tests. */
  selfTest?: boolean;
  /** For a runtime or test with its own fetch. */
  fetch?: typeof fetch;
  /** Per request. Default 8 seconds. */
  timeoutMs?: number;
  /** How long to wait before the one retry after a 429 or 503. Default 1.2 seconds (or the source's Retry-After, up to 3). */
  retryDelayMs?: number;
  /** Requests started per second, across all citations. Default 5, which is what CrossRef's public pool allows. Lower it if several processes share one address. */
  requestsPerSecond?: number;
  /** Requests at once, across all citations. Default 4: the sources are free and shared, so this is polite by default. */
  concurrency?: number;
  /** For tests. */
  now?: () => number;
}

/** One automatic fix `repair()` made. */
export interface RepairChange {
  citation: Citation;
  /** The link that was wrong. */
  from: string;
  /** The link it was replaced with (checked before it was used). */
  to: string;
  why: string;
}

export interface Assay {
  /** Checks every citation in a piece of text. */
  check(text: string): Promise<Report>;
  /** Checks citations you already have (from `parse`, or built yourself). */
  verify(citations: Citation[]): Promise<Report>;
  /** Finds the citations in text without checking them. */
  parse(text: string): Citation[];
  /** Checks again the citations that could not be settled the first time (a source was down or throttled, or the limit was hit). The rest of the report is kept. */
  recheck(report: Report): Promise<Report>;
  /**
   * Fixes what can be fixed without guessing, and says what it did. A real paper cited with an invented DOI gets the DOI of the record it matched,
   * but only when the new link is looked up and found to be that paper. Everything else is left for you (`strip()` removes the rest).
   */
  repair(text: string, report: Report): Promise<{ text: string; changes: RepairChange[]; report: Report }>;
  /** Asks every source for a work that certainly exists, and says which are healthy, which are being left alone, and which no longer give trustworthy answers. */
  health(): Promise<SourceHealth[]>;
}

function memoryStore(now: () => number): KeyValueStore {
  const m = new Map<string, { v: unknown; until: number }>();
  return {
    async get(k) { const e = m.get(k); if (!e) return undefined; if (e.until < now()) { m.delete(k); return undefined; } return e.v; },
    async set(k, v, o) { if (m.size >= 5000) m.delete(m.keys().next().value as string); m.set(k, { v, until: now() + (o?.ttlMs ?? 86_400_000) }); },
  };
}

function overLimit(c: Citation): Verdict {
  const v = { status: 'limit' as const, notes: [] as string[] };
  return { citation: c, ...v, retryable: true, bucket: bucketOf(v.status, undefined, v.notes), message: messageFor(v, []) };
}

export function createAssay(opts: AssayOptions = {}): Assay {
  const now = opts.now ?? Date.now;
  const ctx: Ctx = {
    http: makeHttp({ fetch: opts.fetch, timeoutMs: opts.timeoutMs, concurrency: opts.concurrency, retryDelayMs: opts.retryDelayMs, requestsPerSecond: opts.requestsPerSecond }),
    sources: opts.sources ?? defaultSources,
    mailto: opts.mailto ?? '',
    keys: opts.keys ?? {},
    cache: opts.cache ?? memoryStore(now),
    cacheTtlMs: opts.cacheTtlMs ?? 86_400_000,
    staleTtlMs: opts.staleTtlMs ?? 7 * 86_400_000,
    health: createHealthBook({ ...opts.breaker, now }),
    now,
    probes: new Map(),
    selfTest: opts.selfTest !== false,
  };
  const maxCitations = Math.max(1, Math.floor(opts.maxCitations ?? 50));
  const report = (verdicts: Verdict[]): Report => { const summary = summarize(verdicts); return { verdicts, summary, ok: summary.failed === 0 }; };
  const verify = async (citations: Citation[]): Promise<Report> =>
    report(await Promise.all(citations.map((c, i) => (i < maxCitations ? verifyCitation(c, ctx) : Promise.resolve(overLimit(c))))));

  const recheck = async (r: Report): Promise<Report> => {
    let budget = maxCitations;
    return report(await Promise.all(r.verdicts.map((v) => (v.retryable && budget-- > 0 ? verifyCitation(v.citation, ctx) : Promise.resolve(v)))));
  };

  const repair = async (text: string, r: Report) => {
    const changes: RepairChange[] = [];
    const fixed = new Map<Citation, Citation>();
    let out = text;
    for (const v of r.verdicts) {
      const c = v.citation;
      // Only a real paper (an exact title match) whose link is wrong, with a DOI from the very record that matched.
      if (v.status !== 'badlink' || !v.suggestedDoi || v.exact === false || !c.url) continue;
      const kind = linkKind(c.url);
      if (kind.kind !== 'doi') continue;
      const to = `https://doi.org/${v.suggestedDoi}`;
      const raw = c.raw.split(c.url).join(to);
      if (raw === c.raw) continue;
      const next: Citation = { ...c, url: to, raw, tag: `[${raw}]` };
      // The replacement must itself be looked up and be this paper, or nothing changes.
      const link = await checkLink(next, ctx.http, ctx.mailto);
      if (link.state !== 'ok') continue;
      out = out.split(c.tag).join(next.tag);
      fixed.set(c, next);
      changes.push({ citation: c, from: c.url, to, why: v.linkState === 'dead' ? 'the DOI given does not exist; this is the DOI of the matching record' : 'the DOI given is another paper; this is the DOI of the matching record' });
    }
    if (!changes.length) return { text: out, changes, report: r };
    const verdicts = await Promise.all(r.verdicts.map((v) => (fixed.has(v.citation) ? verifyCitation(fixed.get(v.citation)!, ctx) : Promise.resolve(v))));
    return { text: out, changes, report: report(verdicts) };
  };

  const health = async (): Promise<SourceHealth[]> => {
    for (const src of ctx.sources) await failedSelfTest([src], ctx, true);
    return ctx.health.snapshot(ctx.sources.map((s) => s.name));
  };

  const counted = (r: Report): Report => { opts.tally?.add('citations', r); return r; };
  return { check: async (text) => counted(await verify(parseCitations(text))), verify: async (c) => counted(await verify(c)), parse: parseCitations, recheck, repair, health };
}
