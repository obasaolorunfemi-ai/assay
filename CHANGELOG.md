# Changelog

Versions before 1.0 may change between minor releases; each change that could break a caller is marked **breaking**.

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
