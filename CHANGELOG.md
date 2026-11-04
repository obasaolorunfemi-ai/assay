# Changelog

Versions before 1.0 may change between minor releases; each change that could break a caller is marked **breaking**.

## 0.6.0

- **`/own`**: `ownMaterials(texts)` is a citation source that finds works in a person's own CV, profile and letters and answers with no request, so their own publications are confirmed locally (and never sent to a public index). Put it before `defaultSources`.
- **`/claims`**: does the draft say something about the person that the materials never say, even with no name, figure or link? "Led a large team" carries two claims, *led* and *large*. Embellishments (*large, global, senior…*) must be in the materials; ownership (*led, founded, won, published*) is backed by any word of the same kind; credentials, *decade* and lower-case tools (*kubernetes, tableau, machine learning*) are checked too. A list, not a judgement, and it says so.
- **`/references`**: does the draft lean on a source the materials never mention? Reads the loose forms a model writes unprompted (author and year, `[1]`, *according to…*, *studies show*), which the bracketed citations check does not.
- **`/draft`**: figures, names, references and claims in one call, a citation reported once however many checks it trips.
- **`about: 'you'`** on names, references, claims and draft: read only the sentences that speak to or about the reader, so general advice (interview questions, career direction) is held to what it says about the person, not to every general statement.
- **Names: organisations written in lower case.** "the greenfield foundation" and "acme corp" are caught by the word that says what they are, with a short list of ordinary modifiers ("development bank") left alone.
- **Fixed: a full stop after "et al" no longer ends a sentence**, so "Adeyemi et al. (2021)" is read as one citation.
- **`/names`**: is every person, organisation, link and DOI in a draft one that your materials mention? The companion to figures: an invented "Greenfield Foundation" or "my earlier role at Acme Capital" has no digit, so the figures check passes it. A name is supported when every capitalised word in it is in the materials; links, DOIs and email addresses must appear in them too. Offline, bounded against quadratic patterns, and in the offline and no-quadratic tests like the other modules. Built for KeyStone, whose grant drafts, CV rewrites and cover letters needed it.

## 0.5.0

**The legal check, run live.** `/legal` was run against the real CourtListener for the first time (three citations: found, caught under the wrong case, not verified) and the run is recorded in `docs/legal-live-verification.md`, repeatable with `npm run legal:live`. It exposed a defect, fixed here: a sentence-opening word such as "Also" was read as part of the case name, so a message said `not "Also Roe v. Wade"`.

**Sources beyond the academic.** `ourWorldInData` (opt in; verified live) reads any Our World in Data chart, one year at a time, takes the country from the data rather than trusting the address, and puts the original source OWID cites in the verdict. `jsonValueSource` adds any JSON statistics service with data, as `jsonSource` does for citations. `examples/gate-policy-markets-and-trade.mjs` is a ready-made tier policy for markets, energy, trade and food-security claims. `Http` gained an optional `text()` for sources that answer in CSV. The docs and site no longer read as if Assay were only for papers.

**Live counter (opt-in).** `@extrafemi-ai/assay/share` (`shareTally`, `startSharing`) lets an app add its counts to the public counter on the project's home page, and the `tally` option on `createAssay`, `createValues`, `createRetractions`, `createLegal`, `createSupport` and `createLinkChecker` counts what they find. Off unless your code calls it; numbers only, never text; a failed report is never fatal. The counter is a small Cloudflare Worker (`worker/`) with a Durable Object, rate-limited per sender per day, keeping no addresses; it is self-reported and not verified. The home page shows it live.

## 0.4.0

New checks and tools for the gaps the first release named.

- **`/support`**: does the source text actually back the sentence? You supply the judge (a model call); Assay verifies the evidence the judge quotes with the quotes check, fails a claim whose figure is not in the source without asking the judge, and by default never counts a model's reading as `ok`.
- **`/retractions`**: asks Crossref (which includes the Retraction Watch database) whether a paper was retracted, withdrawn, corrected or has an expression of concern. Verified live against a known retracted paper.
- **`/legal`** (server-only): checks US case citations against CourtListener's citation-lookup API and catches a real citation attached to the wrong case. Built from the API reference; no live call with a token has been made.
- **`/review`**: any report as one self-contained, escaped HTML page for a person to read, worst first. **`/loop`** (`improve`): ask the model again with what failed, bounded.
- **`assay` command line** and a **GitHub Action**.
- **More sources**: `pubmed` (verified live) and `semanticscholar` (not verified live) for citations; `eurostat` for values (verified live). All opt in.
- **Fixed: a title with markup no longer reads as a different title.** CrossRef sends some titles with markup and line breaks (`<scp>AI</scp>`), which made a real, correctly cited paper come back as "the title differs". Found by running Assay on the reference lists of its own technical papers. Titles from CrossRef and OpenAlex are now compared as words.
- **`jsonSource`**: add a citation source with data (an https address, where the records and fields are, a required canary) instead of code. Refuses a description with no canary, a non-https address or a host filled from the search words.
- **`assay health`** asks every built-in source for a work it must know; a weekly workflow runs it and opens an issue when a source answers wrongly. The README now says plainly which safeguards regulate themselves at run time and which things only a person can update.
- **`/tally`**: count what your own app's checks have caught (`createTally().add('quotes', report)`), keeping only numbers, never text. Assay itself still counts nothing and sends nothing.
- **`assay legal FILE`**, with the CourtListener token read from the `COURTLISTENER_TOKEN` environment variable only. README says where the token goes on each platform.
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
