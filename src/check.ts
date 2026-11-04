import type { Citation, KeyValueStore, Report, Verdict } from './types.js';
import { makeHttp } from './http.js';
import { parseCitations } from './parse.js';
import { defaultSources, type SearchSource } from './sources.js';
import { bucketOf, messageFor, summarize } from './verdict.js';
import { verifyCitation } from './verify.js';

export interface AssayOptions {
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
  /** How long a kept answer is trusted. Default one day. */
  cacheTtlMs?: number;
  /** For a runtime or test with its own fetch. */
  fetch?: typeof fetch;
  /** Per request. Default 8 seconds. */
  timeoutMs?: number;
  /** How long to wait before the one retry after a 429 or 503. Default 1.2 seconds (or the source's Retry-After, up to 3). */
  retryDelayMs?: number;
  /** The most citations checked in one call. Each costs up to three requests to free, shared services, so a text with thousands (from a model, or from a user) must not be able to turn Assay into a way of hammering them. The rest come back as `limit` (bucket `check`). Default 50. */
  maxCitations?: number;
  /** Requests at once, across all citations. Default 4: the sources are free and shared, so this is polite by default. */
  concurrency?: number;
}

export interface Assay {
  /** Checks every citation in a piece of text. */
  check(text: string): Promise<Report>;
  /** Checks citations you already have (from `parse`, or built yourself). */
  verify(citations: Citation[]): Promise<Report>;
  /** Finds the citations in text without checking them. */
  parse(text: string): Citation[];
}

function memoryStore(): KeyValueStore {
  const m = new Map<string, { v: unknown; until: number }>();
  return {
    async get(k) { const e = m.get(k); if (!e) return undefined; if (e.until < Date.now()) { m.delete(k); return undefined; } return e.v; },
    async set(k, v, o) { if (m.size >= 5000) m.delete(m.keys().next().value as string); m.set(k, { v, until: Date.now() + (o?.ttlMs ?? 86_400_000) }); },
  };
}

function overLimit(c: Citation): Verdict {
  const v = { status: 'limit' as const, notes: [] as string[] };
  return { citation: c, ...v, bucket: bucketOf(v.status, undefined, v.notes), message: messageFor(v, []) };
}

export function createAssay(opts: AssayOptions = {}): Assay {
  const ctx = {
    http: makeHttp({ fetch: opts.fetch, timeoutMs: opts.timeoutMs, concurrency: opts.concurrency, retryDelayMs: opts.retryDelayMs }),
    sources: opts.sources ?? defaultSources,
    mailto: opts.mailto ?? '',
    keys: opts.keys ?? {},
    cache: opts.cache ?? memoryStore(),
    cacheTtlMs: opts.cacheTtlMs ?? 86_400_000,
  };
  const maxCitations = Math.max(1, Math.floor(opts.maxCitations ?? 50));
  const verify = async (citations: Citation[]): Promise<Report> => {
    const verdicts: Verdict[] = await Promise.all(citations.map((c, i) => i < maxCitations ? verifyCitation(c, ctx) : Promise.resolve(overLimit(c))));
    const summary = summarize(verdicts);
    return { verdicts, summary, ok: summary.failed === 0 };
  };
  return { check: (text) => verify(parseCitations(text)), verify, parse: parseCitations };
}
