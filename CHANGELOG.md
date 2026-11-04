# Changelog

Versions before 1.0 may change between minor releases; each change that could break a caller is marked **breaking**.

## 0.4.0

New checks and tools for the gaps the first release named.

- **`/support`**: does the source text actually back the sentence? You supply the judge (a model call); Assay verifies the evidence the judge quotes with the quotes check, fails a claim whose figure is not in the source without asking the judge, and by default never counts a model's reading as `ok`.
- **`/retractions`**: asks Crossref (which includes the Retraction Watch database) whether a paper was retracted, withdrawn, corrected or has an expression of concern. Verified live against a known retracted paper.
- **`/legal`** (server-only): checks US case citations against CourtListener's citation-lookup API and catches a real citation attached to the wrong case. Built from the API reference; no live call with a token has been made.
- **`/review`**: any report as one self-contained, escaped HTML page for a person to read, worst first. **`/loop`** (`improve`): ask the model again with what failed, bounded.
- **`assay` command line** and a **GitHub Action**.
- **More sources**: `pubmed` (verified live) and `semanticscholar` (not verified live) for citations; `eurostat` for values (verified live). All opt in.
- `Http.json` can now send a header or a POST (used by CourtListener and Semantic Scholar).
- A benchmark protocol (`docs/benchmark-protocol.md`) and instruments for building one with independent labellers: a blind sheet, Cohen's kappa between labellers, and Wilson intervals. The 30-item corpus is still not a benchmark.

## 0.3.0

**The first version published to npm.** 0.1.0 and 0.2.0 were development versions and were never released; everything in their sections below ships in 0.3.0. (0.2.0's text parsing had quadratic patterns, fixed here: do not look for it.)

**Self-healing citation checks.** See the README. A throttled, broken or changed source can no longer turn into an accusation, and the checker recovers by itself.

- Source health: a breaker per source (three failures, or a `Retry-After`, then it is left alone, capped at 15 minutes, then probed), `health()`.
- A **self-test before any accusation**: before "not found", each source that said so must find a work that certainly exists. Single-flight, trusted for ten minutes.
- A reply that is not the shape the source normally sends is an outage, never "no results". (A changed API used to read as an empty result list.)
- **Stale-while-error**: an earlier conclusive answer is served, marked `stale`, when the sources cannot be reached. Verdicts gain `retryable`, `stale` and `reason`.
- `recheck(report)` and `repair(text, report)` (a real paper with an invented DOI gets the matched record's DOI, after the new link is itself verified).
- Short `Retry-After` waits are retried in the call; long ones are believed and the source is left alone instead.
- **Fixed: the cache ignored the link**, so a paper first cited with a good DOI could make a later invented DOI read as verified, and the reverse. The link is now part of what is remembered.

**`@extrafemi-ai/assay/gate`** (ported from Content Engine's sourcing gate): `createGate(policy)`, `rules`, `defaultPolicy`, `summariseRecency`. The policy is data you pass in; Oneremit's own tier list stays in Content Engine. The Hormuz tracker's "one authority or two news sources" is a second rule on the same engine. Offline.

**Hardened against slow input.** CodeQL flagged polynomial regular expressions, and measuring confirmed ten places that were quadratic on a long run of one character (author splitting, typed numbers, quote trimming, tag stripping, DOI trimming, and the gate's host handling). Repetitions are now bounded, trimming is linear (`strutil`), hosts are capped at 253 characters, and `redos.test.ts` runs every public function against 24 awkward input families. Some of these were already in 0.2.0's `parseCitations`/`splitAuthors`; they are fixed here.

**`@extrafemi-ai/assay/links`** (server-only; ported from Content Engine's `verify-url` and Fieldstone's SSRF guard, and **stricter than both**): `createLinkChecker`, `checkUrl`, `isSafeAddress`, `looksLikeSoft404`. Fixed in the port: both originals resolved the name to check it and then let `fetch` resolve it again (DNS rebinding); here the address is validated inside the connection's own lookup. Both missed the hex form of IPv4-mapped IPv6 (`::ffff:7f00:1`, which is what a URL parser produces), NAT64, 6to4, Teredo and several IPv4 reserved ranges, blocked only the exact name `localhost`, accepted credentials and any port. Hop-by-hop redirect re-validation, per-host concurrency, a URL cap, a body-size bound, a breaker with `Retry-After`, an honest `User-Agent`, and `blocked` (a site refusing) kept distinct from `broken`. Package exports it with `"browser": null`.

**`@extrafemi-ai/assay/grounding`** (ported from Content Engine): `checkGrounding`, `stripTags`, `defaultTagFormat`. Every figure in a draft must trace to an approved claim, and match it. The tag syntax is configurable; violations have machine-readable codes; `[[logic]]` can never justify a figure. Stricter than the original in one place: an unreadable `[[calc: …]]` formula is a violation, not a pass. `figures` also exports Content Engine's typed number helpers (`extractTypedNumbers`, `numbersOverlap`, …). Offline.

**`@extrafemi-ai/assay/values`** (ported from Content Engine's reconciliation and Fieldstone's value states): `createValues`, `reconcile`, `worldBank`, `imf`, `seededSource`, `worldBankUrlInfo`. Unit and exact-period discipline; a model cross-check hook that can contradict but never verify; self-healing like citations (shape checks, breaker with `Retry-After`, self-test before a mismatch stands, stale-while-error series, `health()`).

## 0.2.0

Assay becomes a set of separate checks, each with its own entry point and each saying what it compares against.

- **`@extrafemi-ai/assay/quotes`** (ported from KeyStone): `checkQuote`, `verifyQuote`, `checkQuotes`. Is this sentence really in the source text? Forgives whitespace, quote marks, dashes and case, never words. New: the quote must start and end at a word boundary, so "ship is available" does not match inside "sponsorship is available".
- **`@extrafemi-ai/assay/figures`** (ported from KeyStone's invented-figure guard and Content Engine's number code): `checkFigures`, `findUnsupportedFigures`, `extractFigures`, `extractYears`, `evalFormula`, `looksLikeFormula`. Reads numbers in any notation. New: **a percentage and a plain number are different figures** by default (a "40 women" in a CV no longer supports an invented "40%"; `kinds: false` restores value-only matching), a `tolerance` option, an `ignore` option for your own placeholder syntax, and the position of each figure. A list marker no longer glues the lines either side of it into one number.
- Both are **offline**: no network, no dependencies, and a test fails if they ever import anything that could reach one.
- `evalFormula` accepts any variable name, not only `c3`; refuses expressions over 200 tokens or 50 deep; does not read inherited properties such as `constructor` as values.
- Checked against the originals: 3,000 generated texts extract the same figures as KeyStone's guard; the quote check accepts everything KeyStone's does.
- A smoke test loads every entry point from the built package, in CI and before a release.

## 0.1.0

First release, extracted from Whetstone's citation checker.

- `createAssay().check(text)` and `.verify(citations)`: a verdict for each citation, a summary line, and `ok`.
- `parseCitations()`: reads `[Author, Year, "Title" — Venue — link]` tags, with or without a link, and approximate tags.
- Looks in CrossRef, OpenAlex and Open Library (books). Both authors must be on the same record when two are cited. Accents are folded; a title cited without its subtitle matches.
- Checks the link given: DOI (CrossRef, then doi.org and DataCite), SSRN and arXiv as the DOIs they stand for, PubMed by PMID. A real paper with an invented DOI is `badlink`, with `suggestedDoi`.
- Compares journal and year for journal articles, against the record of the DOI given when there is one (a 2001 reprint does not make a 1985 citation wrong).
- Approximate citations are checked for related work by that author.
- A source that is throttled or down makes the result `unavailable`, never `notfound`. One polite retry after a 429.
- `strip()` replaces, removes or marks failed citations.
- `maxCitations` (default 50): a text with thousands of citations is checked up to the limit, and the rest are returned as `limit` without a request. Measured before the cap: 5,000 distinct citations caused 15,000 outbound requests.
- `requestsPerSecond` (default 5): requests start no faster than this however many run at once.
- `escapeHtml()` exported, so a verdict can be shown in a page without a hand-rolled escape.
- A match is reported as "a record exists", not "verified": existence is not correctness.
- Options: `mailto`, `keys.openalex`, `maxCitations`, `sources`, `cache`, `concurrency`, `timeoutMs`, `retryDelayMs`, `fetch`.
