# Assay: checking AI-written text against evidence, one question at a time

*Technical paper, draft 0.1, November 2026. It describes Assay 0.3.0. Where a statement is a measurement it says what was measured and how small the sample was; where it is a design choice it says why.*

## Abstract

Language models write fluent text that is sometimes wrong in ways a reader cannot see: a citation to a paper that does not exist, a quote that is not in the document it is attributed to, a number nobody supplied. These are different failures, and they are caught by comparing the text with different things. Assay is a small library of seven separate checks, each comparing text with one thing: public records of papers and books, a source text, a set of supplied materials, a policy about sources, a list of approved claims, a source's own data, or the live web. Each check says what it compared against, answers in the same shape, and treats "I could not look" as a different answer from "it is not there". Four of the checks never touch the network, and a test enforces that. This paper explains the design, the self-healing behaviour of the checks that do use the network, the security model of the one check that fetches addresses it did not choose, what was measured, and what Assay cannot do.

## 1. The problem

A model that is asked for sources will give them with complete confidence. In a test of three replies from free models, the citations included DOIs that do not exist, DOIs that belong to unrelated papers (a 1960 Coase citation pointed at a 1963 book review), real authors paired with titles they never wrote, and one paper invented outright. A check that only asks "is there a paper with this title?" passes the first two.

Citations are the most visible case, not the only one. The same family of tools had grown several partial answers in separate places, each written for one application:

- a model asked to back a claim with "an exact quote from the posting" can invent the quote;
- a draft written from a CV and a brief can contain a figure ("5,000 beneficiaries") that is in neither;
- a model that tags its own sentence as coming from approved fact 3 has proved nothing until something checks that fact 3 exists and states the same figure;
- a claim can be sourced to a real page that is too weak to carry it;
- a real source can be cited for the wrong year's value;
- a link in the text can be dead, or crafted to make the server that checks it reach its own network.

Assay began as the citation checker inside Whetstone, a tool that runs under every reply of a free hosted model, and grew by absorbing the checks that had been written separately for KeyStone, Content Engine and Fieldstone.

## 2. Design

### 2.1 One question per check

| check | compares the text with | network |
|---|---|---|
| citations | public records of papers and books (CrossRef, OpenAlex, Open Library, the DOI registries) | yes |
| quotes | the source text you supply | no |
| figures | the materials you supply | no |
| gate | a policy about sources | no |
| grounding | a list of approved claims | no |
| values | a source's own data (World Bank, IMF, or figures you seeded) | yes |
| links | the live web, server-side only | yes |

The checks are separate modules with separate entry points because they apply to different scenarios and need different inputs. A job posting needs quotes and figures; a model answer with references needs citations; a published claim needs the gate. Running everything on everything would produce noise, and would send private text to services that have no business seeing it. There is deliberately no "check it all" function.

### 2.2 Say what was compared

Every verdict names the thing it was compared with, in a sentence a non-specialist can read: "The quote is not in the source text", "does not appear in the materials you gave", "a record exists in CrossRef". The wording avoids claiming more than was checked. A matching citation record is reported as a record that *exists*, not as "verified", because existence is all that was shown.

### 2.3 One shape of answer

Each item gets a bucket (`ok`, `check`, `failed`, `skip`), a status, and a message. Each report has a one-line summary and a single `ok` flag. The summary line is built by one shared function so the checks read alike.

### 2.4 "Could not look" is not "not found"

The most important rule in the design. Free record services throttle, change their replies and go down. If a throttled service returns nothing, an honest checker has learned nothing, and must not tell the author their citation is invented. Every network check therefore has an explicit *unavailable* outcome, and the rest of the system is built so that an outage can only ever produce that outcome (section 4).

### 2.5 Offline by construction

Quotes, figures, the gate and grounding make no requests. They import no module that could, and a test fails the build if one of them, or anything it imports, gains network access. This is what makes them safe on private text such as a CV. The citation check sends only the author names, title, year and link of each citation, never the surrounding text, and only to a fixed list of hosts.

### 2.6 Strict where leniency would pass a falsehood

Several defaults are stricter than the code they were ported from, each because the lenient version could let a wrong claim through:

- a figure check treats a percentage and a plain number as different figures, so "40 women" in a CV does not support an invented "40%";
- a quote must start and end on a word boundary and be at least 12 characters, so "sponsorship" cannot match almost any posting;
- a value claim must match on unit and on the exact year; a nearby year is reported as unmatched, never as a pass, and a GBP claim against a USD series is a different measurement, not a disagreement;
- a calculation tag that cannot be read is a violation in the grounding check, not a way to carry a figure unchecked;
- a model can *contradict* a value, through an optional hook the caller supplies, but can never *verify* one.

## 3. Citations

A citation is a square-bracket tag with a quoted title and a year. The same format is used in the prompt that asks the model for citations, so the tool and the model agree on it. The check:

1. **Finds the paper, not just the title.** Author, title and year are searched in CrossRef and OpenAlex, and in Open Library for books. When two authors are cited, both must appear on the same record.
2. **Checks the link it is given.** A DOI, SSRN abstract, arXiv paper or PubMed link is looked up in the registry that holds it. A real paper with an invented DOI is called out, and the closest real DOI is offered as `suggestedDoi`.
3. **Notices a paper cited wrongly**: the journal or year in the record differs from the citation (journal articles only).
4. **Handles approximate citations honestly.** A citation that names an area rather than a paper can only be answered with whether the author has related work.

## 4. Self-healing

The sources are free and shared, and they break. OpenAlex, for example, now gives each address a small daily credit budget and answers further requests with a 429 and a `Retry-After` of about twenty hours; this interrupted the project's own testing. The design goal is that none of this ever becomes an accusation and none of it needs a person to notice.

- **A changed reply is an outage.** A reply that is not the shape the source normally sends (an HTML error page, a renamed field) makes the result *unavailable*. An API change used to read as an empty result list.
- **A source is tested before it is believed.** Before anyone is told "not found", each source that said so is asked for a work that certainly exists. A source that cannot find it is broken without an error, and its answer is discarded. A passed test is trusted for ten minutes, and citations checked at the same moment share one test.
- **A failing source is left alone, then probed.** Three failures in a row, or a `Retry-After`, and the source is not asked for a while, never longer than fifteen minutes even if it asks for twenty hours; then one request is let through to see whether it has recovered. Short waits are retried inside the call.
- **An old answer beats "could not tell".** A conclusive result is kept; if the sources are down when it expires, the earlier answer is returned marked `stale`, with a message saying so. What is remembered covers the citation *and its link*, because an early version of the cache ignored the link and let a good DOI make a later invented one pass.
- **Recovery is explicit.** `recheck(report)` checks again only what could not be settled. `repair(text, report)` fixes what needs no guessing: a real paper with an invented DOI gets the DOI of the record it matched, but only after the new link is itself looked up and found to be that paper. `health()` asks each source for its known work and reports it as healthy, degraded or down.

Each of these has a test that fails when the safeguard is removed. One of them taught us something: a test for the response-shape guard kept passing with the guard deleted, because the self-test caught the same fault. The shape-guard tests now run with the self-test off, so each safeguard is tested alone.

## 5. Security

### 5.1 The link checker

The link checker is the one module that requests addresses it did not choose, and the addresses come out of AI text, which is shaped by whoever wrote the prompt. A crafted link must never make the server reach its own network or its cloud's metadata service. The design:

- **The checked address is the connected address.** Every address a name resolves to is validated inside the DNS lookup the connection itself uses, so there is no check followed by a second resolution. A name that answers "public" to a check and "private" to the connection (DNS rebinding) is refused.
- **Every redirect hop is re-checked** from the URL down before it is followed, by hand, up to five.
- **Only public addresses.** A purpose-written IPv4 and IPv6 parser refuses loopback, private, link-local (which includes the metadata address), carrier-grade NAT, documentation and reserved ranges. Every IPv6 form that wraps an IPv4 address (`::ffff:7f00:1`, NAT64, 6to4) is judged by the address inside it. The two earlier link guards this was ported from, in Content Engine and Fieldstone, missed several of those forms and resolved the name a second time after checking it; the port fixes both.
- **Bounded.** Five seconds per request, five redirects, two concurrent requests per host, 25 URLs per call, and only the first 24,000 characters of a page are read.
- **Fails closed.** Anything it cannot parse is refused, and a refused URL is never requested.

The IPv4 rules were tested against Node's own `BlockList` on every boundary and 20,000 random addresses.

What it does not do is also written down: it does not stop a *public* address from being fetched, so it must not be exposed as an open "what is the status of this URL" service, and egress filtering on the host remains the right second layer.

### 5.2 Hostile text and slow patterns

Text read by Assay is treated as hostile. CodeQL flagged polynomial regular expressions in the code, and measuring confirmed ten places that were quadratic on a long run of one character, including in the citation parser. They were fixed with bounded repetitions and linear trimming helpers, and a permanent test now runs 19 public functions against 24 families of awkward input at 30,000 characters with a 300 ms budget. If that test is slow, a pattern has become quadratic and must be bounded; the budget is not to be raised.

### 5.3 Publishing

The package has no runtime dependencies. It is released by npm trusted publishing from a protected GitHub environment that waits for a named human reviewer, so there is no npm token to steal or leak, and each release carries a provenance attestation. A repository rule makes release tags permanent: a published version cannot be quietly pointed at different code.

## 6. What was measured

Honesty about the evidence matters more here than the numbers.

- **A labelled corpus of 30 citations**, written by free models on one afternoon and labelled by hand. In the Whetstone run that motivated the project, the 30 tags produced 15 failures (all inventions or bad links, except one real report), 12 verified and 3 to look at. Run against the standalone library with healthy sources, the checker agreed with the hand labels on 28 or 29 of 30. `npm run corpus` repeats this against the live sources.
- **This is not a benchmark.** It is one sample, from one afternoon, from free models, labelled by the people who built the tool. It shows a change moving the numbers. No accuracy figure should be quoted from it, and none is claimed.
- **Differential tests against the originals.** 3,000 generated texts extract the same figures as KeyStone's guard, and the quote check accepts everything KeyStone's does; the only differences are the intended stricter ones.
- **371 automated tests**, with the security rules and self-healing paths checked by removing the rule and confirming a test fails.

## 7. What it cannot do

- **It shows that a source exists, not that the source says what the sentence claims.** A verified citation can still be attached to a false claim, and a fabricated one can be written to match a real record.
- **Coverage has gaps.** Books, reports, chapters, grey literature and non-English work are thinly indexed. A real WHO report came back as failed in the test corpus. That is why the wording is "not verified", and why removing failed citations is opt-in.
- **Quotes can be real and misleading**: a sentence cut from "is available only to staff" still matches.
- **Figures are checked for being supplied, not for what they are about.** "40 women" in the materials also supports "40 men".
- **The gate judges how a claim is sourced, not whether it is true.**
- **Grounding cannot tell which number a line means** when a claim carries several; the values check, with an explicit year, is the answer there.
- **Direct links cannot be checked from a browser**, so they are reported as needing a look.

## 8. Open questions

- **Does the source support the sentence?** Everything here establishes existence or traceability. Checking that a source *says* what is claimed is the largest unsolved gap, and probably needs a model, which would need to be held to the same rule: it may contradict, never verify.
- **A larger, independent benchmark**, labelled by people who did not build the checker.
- **Adoption.** Whetstone, KeyStone, Content Engine and Fieldstone still run their own copies. Moving them onto the package is what will show whether the shared checks hold up outside the project that wrote them.
- **A repair loop with the model call**, so a failed citation can be re-requested rather than only removed.

## Appendices

The full per-check reference, the self-healing description, the limits, the security policy and the changelog are the parts linked below.
