/** One citation as written in a piece of text. */
export interface Citation {
  /** The text inside the brackets. */
  raw: string;
  /** The whole tag as it appears in the text, brackets included (what `strip` replaces). */
  tag: string;
  /** Who it names ("Kahneman & Tversky"); for an approximate citation, the author and topic. */
  authors: string;
  /** The year as written, or 'n.d.'. */
  year: string;
  /** The quoted title; empty when none was given. */
  title: string;
  /** The journal, publisher or other venue, when one was given. */
  venue: string;
  /** The link, when one was given. */
  url: string;
  /**
   * 'link': a title and a link. 'search': a title and a search link, or no link at all.
   * 'approximate': names an author's area, not one paper, so there is no title to confirm.
   */
  tier: 'link' | 'search' | 'approximate';
}

/** What the checking of one citation found. */
export type Status =
  | 'found'          // a record by these authors with this title exists
  | 'badlink'        // the paper exists, but the DOI or link given is wrong (does not exist, or is another paper)
  | 'mismatch'       // an author with this surname exists, but not for this title
  | 'notfound'       // no such work in any source asked
  | 'approx-ok'      // approximate: the author has related work (a specific paper cannot be confirmed)
  | 'approx-none'    // approximate: no work by this author on this topic
  | 'approx-unparsed'// approximate: could not tell whose work or what topic
  | 'no-title'       // no title was given, so there is nothing to confirm
  | 'unavailable'    // every source was unreachable or throttled: inconclusive, never "not found"
  | 'skip';          // no author could be read; nothing useful to say

/** How much trust a status earns. `failed` means: do not rely on it. */
export type Bucket = 'ok' | 'check' | 'failed' | 'skip';

/** A record a source returned for a title search. */
export interface Candidate {
  title: string;
  /** Author surnames or full names, as the source writes them. */
  authors: string[];
  year: number;
  doi: string;
  /** True for a journal article (year and journal are only compared for these). */
  article: boolean;
  venue: string;
}

export interface Verdict {
  citation: Citation;
  status: Status;
  bucket: Bucket;
  /** Which source confirmed it ('CrossRef', 'OpenAlex', 'Open Library'). */
  source?: string;
  /** False when the title found only resembles the cited one. */
  exact?: boolean;
  /** The record that matched (or the closest one), so a person can compare. */
  match?: Candidate;
  /** Things to look at on a paper that exists: the journal or year differs, the link was not checkable. */
  notes: string[];
  /** For `badlink`: 'dead' (no such DOI) or 'wrong' (it is another paper). */
  linkState?: 'dead' | 'wrong';
  /** One sentence, in plain words, saying what was found. */
  message: string;
  /** For `badlink`: the DOI of the closest record, as a fix to offer. */
  suggestedDoi?: string;
}

export interface Summary {
  total: number;
  verified: number;
  check: number;
  failed: number;
  /** 'good' (all verified), 'warn' (some to check), 'bad' (some failed). */
  level: 'good' | 'warn' | 'bad';
  /** "Citations: 6 · ✓ 2 verified · ≈ 2 to check · ✕ 2 not verified" */
  text: string;
}

export interface Report {
  verdicts: Verdict[];
  summary: Summary;
  /** True when nothing failed. */
  ok: boolean;
}

/** The same shape as Lodestone's store, so one store can serve both. */
export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, opts?: { ttlMs?: number }): Promise<void>;
}
