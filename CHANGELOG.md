# Changelog

Versions before 1.0 may change between minor releases; each change that could break a caller is marked **breaking**.

## 0.3.0

**Self-healing citation checks.** See the README. A throttled, broken or changed source can no longer turn into an accusation, and the checker recovers by itself.

- Source health: a breaker per source (three failures, or a `Retry-After`, then it is left alone, capped at 15 minutes, then probed), `health()`.
- A **self-test before any accusation**: before "not found", each source that said so must find a work that certainly exists. Single-flight, trusted for ten minutes.
- A reply that is not the shape the source normally sends is an outage, never "no results". (A changed API used to read as an empty result list.)
- **Stale-while-error**: an earlier conclusive answer is served, marked `stale`, when the sources cannot be reached. Verdicts gain `retryable`, `stale` and `reason`.
- `recheck(report)` and `repair(text, report)` (a real paper with an invented DOI gets the matched record's DOI, after the new link is itself verified).
- Short `Retry-After` waits are retried in the call; long ones are believed and the source is left alone instead.
- **Fixed: the cache ignored the link**, so a paper first cited with a good DOI could make a later invented DOI read as verified, and the reverse. The link is now part of what is remembered.

**`@extrafemi-ai/assay/gate`** (ported from Content Engine's sourcing gate): `createGate(policy)`, `rules`, `defaultPolicy`, `summariseRecency`. The policy is data you pass in; Oneremit's own tier list stays in Content Engine. The Hormuz tracker's "one authority or two news sources" is a second rule on the same engine. Offline.

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
