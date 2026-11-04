# Assay: Checking AI-Written Text Against Evidence, One Question at a Time

**Authors:** Obasa Olorunfemi, MBA; Precious Olusegun, PhD

**Affiliation:** Extrafemi Research

*Technical report, version 1.0, November 2026. It describes Assay 0.3.0 and, where marked, the 0.4.0 additions that were in review when it was written. The project is funded by Extrafemi via Extrafemi Labs and Extrafemi Research.*

## Abstract

**Background.** Large language models write fluent text that is sometimes wrong in ways a reader cannot see: citations to papers that do not exist, quotations that are not in the document they are attributed to, and figures that nobody supplied. These failures have caused documented harm, including sanctions against lawyers and a partial refund of a government consultancy fee.

**Problem.** The literature offers general hallucination detectors and benchmark metrics, but practitioners who publish model-written text need something narrower: deterministic, explainable checks that compare a specific piece of text with a specific kind of evidence, and that fail safe when the evidence source is unavailable.

**Approach.** We present Assay, a dependency-free library of separate checks, each defined by the single thing it compares text with: public bibliographic records (citations), a source text (quotes), supplied materials (figures), a source-quality policy (gate), a list of approved claims (grounding), a statistical source's own data (values), and the live web (links). Every check reports in one shape, states what it compared against (with a published definition of what counts as evidence and from which sources), and distinguishes "not found" from "could not look". The checks that use the network are self-healing: a changed, throttled or unavailable source can only produce an inconclusive result, never an accusation. The one component that fetches addresses it did not choose is hardened against server-side request forgery, DNS rebinding and algorithmic-complexity attacks.

**Results.** On a hand-labelled sample of 30 citations written by free models, Assay agreed with the labels on 28 or 29 items when its sources were healthy; the sample is too small to support an accuracy claim, and we give a protocol for building one that is. The security properties are checked by differential tests, regression tests over awkward inputs, and by deliberately breaking each safeguard to confirm that a test fails.

**Conclusion.** Existence checks are not entailment checks: Assay shows that a source exists, not that it says what a sentence claims. We therefore describe an extension that asks a caller-supplied model for evidence and counts only evidence that is verifiably in the source, and we state the limits that remain.

**Keywords:** hallucination, citation verification, attribution, fact-checking, retrieval, reliability engineering, server-side request forgery, research integrity

## 1 Introduction

A model asked for sources will give them with complete confidence. In an informal test of three replies from free models, the citations included DOIs that do not exist, DOIs that belong to unrelated papers (a 1960 article by Coase pointed at a 1963 book review), real authors paired with titles they never wrote, and one paper invented outright. A check that only asks whether a paper with this title exists passes the first two, because the title exists and the DOI is merely wrong.

The failure is well documented outside our own tests. Walters and Wilder (2023) asked ChatGPT-3.5 and ChatGPT-4 for short literature reviews on 42 topics and examined the 636 citations produced: 55% of the GPT-3.5 citations and 18% of the GPT-4 citations were fabricated, and 43% and 24% respectively of the real citations contained substantive errors. Bhattacharyya et al. (2023) found that, of 115 references in medical papers written by ChatGPT-3.5, 47% were fabricated, 46% were authentic but inaccurate and 7% were authentic and accurate. In law, where the consequences are formal, Dahl et al. (2024) report that public language models hallucinate at least 58% of the time on legal queries, and Magesh et al. (2025) found that commercial legal research tools marketed as reducing hallucination still produced them between 17% and 33% of the time.

The consequences have reached courts and contracts. In *Mata v. Avianca* (S.D.N.Y. 2023) lawyers filed a brief citing six decisions that a chatbot had invented, and were sanctioned (Bloomberg Law, 2023). In *Moffatt v. Air Canada* (2024 BCCRT 149) a tribunal held an airline liable for a refund rule its chatbot invented. A report that Deloitte prepared for the Australian Department of Employment and Workplace Relations was found to contain references to works that do not exist and a misquoted judgment, and part of the fee was reportedly refunded (Malay Mail, 2025). Such cases are now catalogued: a public database of court decisions addressing AI-generated content was reported in mid-2026 to list more than 1,600 entries (Charlotin, n.d.), a floor because it records only what was caught.

These failures differ in kind. An invented citation is checked against bibliographic records; an invented quotation against the document it is attributed to; an invented figure against the materials the author had; a refund rule against the airline's policy. Each requires a different comparison, a different input, and a different notion of what counts as agreement. Applying one detector to all of them would send private text to services with no need to see it and would blur which question was being asked.

### 1.1 Contributions

1. A decomposition of "checking AI-written text" into seven separate checks, each defined by what it compares text with and each usable alone (Section 3).
2. A verdict model in which "could not look" is a first-class outcome distinct from "not found", and a set of mechanisms that enforce the invariant that an unavailable source cannot cause an accusation (Section 5).
3. A threat model and mitigations for the one component that fetches addresses taken from untrusted text (Section 6), including a connect-time address-validation design that removes the check-then-connect race exploited by DNS rebinding.
4. A verification approach for the library itself (Section 7): differential tests against the implementations the checks were extracted from, regression tests over adversarial inputs, mutation checks of safeguards, and live verification against the real services, together with an honest account of what this does not establish.
5. A rule for model-assisted checking, *a model may contradict but never verify*, and its realisation in an evidence-verification extension (Section 4.8).
6. A protocol for building an independent benchmark (Section 8.3).

### 1.2 Scope and structure

Assay checks the *existence and traceability* of what text relies on. It does not decide whether text is true, and Section 9 is explicit about the cases it cannot catch. Section 2 reviews related work. Section 3 states the design principles; Section 4 describes the checks; Section 5 the self-healing mechanisms; Section 6 the security analysis; Section 7 the verification; Section 8 evaluation and a benchmark protocol; Section 9 limitations and threats to validity; Section 10 responsible use.

## 2 Background and related work

**Hallucination.** Ji et al. (2023) survey hallucination in natural language generation and distinguish *intrinsic* hallucination, which contradicts the source, from *extrinsic* hallucination, which cannot be verified from it; Huang et al. (2025) extend the treatment to large language models, separating factuality from faithfulness. Maynez et al. (2020) showed for abstractive summarisation that systems produce content absent from the input and that textual entailment judged faithfulness better than n-gram overlap. Lin et al. (2022) built TruthfulQA to measure whether models reproduce common falsehoods. Theoretical work argues that some hallucination is not removable by better training alone: Kalai and Vempala (2024) show that a calibrated model must hallucinate on facts that appear rarely in its training data, Xu et al. (2024) give a formal argument that hallucination is inevitable for computable models, and Kalai et al. (2025) argue that training and evaluation practices that reward guessing over abstention sustain it. If these arguments hold, detection at the point of use cannot be made redundant by better models.

**Attribution and fact verification.** A body of work asks whether generated text is supported by an identified source. Rashkin et al. (2023) define the "attributable to identified sources" framework for human evaluation; Bohnet et al. (2022) apply it to question answering. Thorne et al. (2018) introduced FEVER, a dataset of claims verified against Wikipedia as supported, refuted or lacking enough information. Min et al. (2023) score factual precision by decomposing text into atomic facts and checking each against a knowledge source. Kryscinski et al. (2020) train a model to judge factual consistency of summaries. Manakul et al. (2023) detect hallucination without external evidence by measuring consistency across sampled answers. Gao et al. (2023a) revise generated text after retrieving evidence, and Gao et al. (2023b) benchmark models that generate text with citations. Menick et al. (2022) train a model to support its answers with *verified quotes*, a design close in spirit to the evidence rule of Section 4.8. Liu et al. (2023) audited four generative search engines and found that, on average, 51.5% of generated sentences were fully supported by their citations and 74.5% of citations supported their sentences. Retrieval-augmented generation (Lewis et al., 2020) and browsing models (Nakano et al., 2021) reduce but do not remove unsupported output.

**Fabricated references.** Alkaissi and McFarlane (2023) and Athaluri et al. (2023) documented fabricated references in ChatGPT output in scientific writing; the studies cited in Section 1 measured its rate. These studies verify references by hand against databases. Assay automates that verification against the same databases and reports the uncertainty that hand verification leaves implicit.

**Scholarly infrastructure.** Crossref holds metadata deposited by publishers (Hendricks et al., 2020) and, since 2023, the Retraction Watch database of retractions (Crossref, 2023). OpenAlex is an open index of scholarly works (Priem et al., 2022); Semantic Scholar offers an open data platform (Kinney et al., 2023); PubMed is queried through NCBI's E-utilities (Kans, n.d.); Open Library catalogues books. Courts' decisions are searchable through the Free Law Project's CourtListener, whose citation-lookup API was introduced to help detect hallucinated case citations (Free Law Project, 2024). These services are free and shared, and each has its own limits and failure modes, which is the starting point of Section 5.

**Official statistics and other non-academic evidence.** Much of what is written with AI help is not scholarship: policy briefs, market reports, journalism, business and development reporting. Its claims rest on official statistics, central-bank bulletins, regulators' filings, specialist analysts and the financial press. Some of these have open interfaces: the World Bank's Indicators API (World Bank, n.d.), the IMF's DataMapper, Eurostat's dissemination API (Eurostat, n.d.), and Our World in Data (n.d.), a compiler that publishes each series with the original source it draws on. Most do not: a central bank's bulletin is a document, and a news report is an article. For these the evidence is the page itself, and the question the checker can answer is whether the page is there and how well a source of that kind may carry a claim of that kind, which is the job of the source-tier policy of Section 4.4 rather than of a lookup.

**Where this work sits.** The work above mostly proposes detectors and measures, evaluated on benchmarks. Assay is an engineering artefact with a different goal: to give a developer deterministic, explainable, individually usable checks that can run in a publishing pipeline, together with an explicit treatment of uncertainty and of the security of the checker itself. It does not compete with entailment models; Section 4.8 shows how one can be placed under the same discipline.

**Reliability and security engineering.** Our treatment of unavailable sources uses established patterns: circuit breakers (Nygard, 2018; Fowler, 2014), bounded retries with backoff and jitter (Brooker, n.d.), honouring server-supplied waits (RFC 9110; RFC 6585), serving stale content when the origin fails (the intent of RFC 5861), and the broader practice of designing for failure (Beyer et al., 2016; Dean & Barroso, 2013). For security, the link checker builds on the OWASP guidance on server-side request forgery (OWASP, n.d.), the address-space registries and translation mechanisms of RFC 1918, RFC 4291, RFC 6052, RFC 3056, RFC 4380, RFC 6598 and RFC 6890, and the analysis of DNS rebinding by Jackson et al. (2007, 2009). Its input handling follows the literature on algorithmic-complexity attacks (Crosby & Wallach, 2003) and regular-expression denial of service (Davis et al., 2018). Treating model output and fetched content as untrusted data follows the analysis of indirect prompt injection by Greshake et al. (2023). The supply-chain posture draws on studies of the npm ecosystem (Zimmermann et al., 2019; Ohm et al., 2020) and on signed build provenance (Newman et al., 2022).

## 3 Design principles

**P1. One question per check.** Each check is a separate module with its own entry point, defined by what it compares text with (Table 1). The checks apply to different scenarios and need different inputs; a job posting needs quotes and figures, a model answer with references needs citations, and a published claim needs the gate. There is deliberately no function that runs them all, because doing so would apply the wrong comparison to the wrong text and send private text to services that should not see it.

| Check | Compares the text with | Network |
|---|---|---|
| citations | public bibliographic records (CrossRef, OpenAlex, Open Library, DOI registries) | yes |
| quotes | a source text supplied by the user | no |
| figures | materials supplied by the user | no |
| gate | a policy about the quality of sources | no |
| grounding | a list of claims the user approved | no |
| values | a statistical source's own data (World Bank, IMF, Eurostat, Our World in Data, any statistics service the user describes, or seeded figures) | yes |
| links | the live web (server-side only) | yes |
| support (0.4.0) | a source text, via a caller-supplied judge whose evidence is verified | no (the judge may) |
| retractions (0.4.0) | Crossref's notices, including Retraction Watch | yes |
| legal (0.4.0) | CourtListener's database of US decisions (server-side only) | yes |

*Table 1. The checks, defined by what each compares text with.*

**P2. State what was compared.** Every verdict names the comparison in plain language, and the wording never claims more than was shown. A matching bibliographic record is reported as a record that *exists*, not as "verified", because existence is all that was established.

**P3. One shape of answer.** Each item receives a bucket (`ok`, `check`, `failed`, `skip`), a status and a message; each report receives a one-line summary and a single flag. The shared shape lets a pipeline handle any check, and lets a person read any of them.

**P4. "Could not look" is not "not found".** The central rule. A throttled service that returns nothing has taught the checker nothing, and telling an author that a real paper is invented is a harm. Every networked check therefore has an explicit *unavailable* outcome, and Section 5 enforces that outage can only ever produce it.

**P5. Offline by construction.** The checks that compare text with user-supplied material make no requests. A test fails the build if any of them, or any module they import, gains network access. The citation check transmits only the author names, title, year and link of each citation, never surrounding text, and only to a fixed list of hosts.

**P6. Strict where leniency would pass a falsehood.** Several defaults are stricter than the code they were extracted from: a percentage and a plain number are different figures; a quotation must begin and end on word boundaries and be at least twelve characters; a value claim must match on unit and on the exact period; an unreadable calculation is a violation, not a way to carry a figure unchecked.

**P7. A model may contradict but never verify.** Where a model is involved, it can lower trust but cannot raise it: a model's agreement is not evidence, whereas evidence it points to can be checked deterministically (Section 4.8).

**P8. Say what counts as evidence, and why.** Every verdict is only as good as the thing it was compared with, so the comparison is defined in advance and published (Section 3.1) rather than left implicit in the code.

### 3.1 What counts as evidence

Assay uses *evidence* in a narrow, operational sense. A thing is evidence if all four conditions hold: (i) it is a record or a text that a person could open and read; (ii) it comes from a source named in the documentation, whose coverage and limits are stated; (iii) it was obtained, or supplied by the user, at the time of the check; and (iv) it can be compared with the text mechanically, so that two people running the check obtain the same result. The first condition is what makes a verdict contestable: anyone who disagrees can open the same record. The second makes the limits of a "found" or "not found" knowable. The third prevents a stale or remembered answer from standing in for a fresh one, except where it is explicitly marked stale (Section 5). The fourth separates a check from an opinion.

By this definition the following do *not* count as evidence, and no check treats them as such: a model's statement that a source exists or says something; a model-written tag such as `[[c3]]` before it has been checked against the approved claims; a search engine's snippet; the existence of a link elsewhere in the same text; and the fact that a web page loads (which is evidence of liveness only, and is reported as such). A model's judgement that a source supports a sentence is not evidence either: only a quotation it points to can be, and only once that quotation has been found in the source by the quotes check (Section 4.8). Table 2 states, for each check, what counts, what does not, why, and from which sources.

| Check | Counts as evidence | Does not count | Sources |
|---|---|---|---|
| citations | a bibliographic record with matching authors, title and year; a registry entry for the DOI given | a model's say-so; a record that matches only the title | CrossRef, OpenAlex, Open Library, PubMed (opt-in), Semantic Scholar (opt-in), the DOI registries |
| quotes | the sentence occurring in the supplied source text | a paraphrase; a quotation under twelve characters | the user's source text |
| figures | the same value occurring in the supplied materials | the same digits with a different unit or kind (40% against 40) | the user's materials |
| gate | a source whose domain is in the user's tier policy at the required tier, counted over distinct sites | a source's own claim about its standing; an unlisted domain above tier 3 | the user's policy |
| grounding | an approved claim that exists, with a matching figure | a tag that names no approved claim; reasoning (`[[logic]]`) offered for a number | the user's approved claims |
| values | a published series for the exact period and unit | a nearby year; a different unit; a model's figure | World Bank, IMF, Eurostat and Our World in Data (opt-in), any statistics service the user describes, figures a person seeded |
| links | an HTTP response from the page | a blocked or unreachable response treated as absence | the live web |
| support | a quotation, given by a judge, that is found in the supplied source | the judge's verdict alone | the user's source text |
| retractions | a retraction, withdrawal, correction or concern notice for the DOI | an absence of notice read as proof of none | Crossref, including Retraction Watch |
| legal | a decision held under the citation, with the case named | a citation not held (reported as not verified, not as invented) | CourtListener |

*Table 2. What counts as evidence, for each check.*

## 4 The checks

### 4.1 Citations

A citation is a square-bracket tag with authors, year and quoted title, optionally followed by a venue and a link. The same format is used in the prompt that asks the model for citations, so that producer and checker agree on it. For each citation the checker:

1.

*Finds the work, not only the title.* Author surname, title and year are searched in CrossRef and OpenAlex, and in Open Library for books. When two authors are cited, both must appear on the same record, so that a real author attached to a title they did not write is detected (status `mismatch`).
2.

*Checks the link it is given.* A DOI, SSRN abstract, arXiv paper or PubMed link is looked up in the registry that holds it. A real work cited with a wrong DOI (status `badlink`) is called out and the closest real DOI is offered.
3. *Compares journal and year* for journal articles, noticing citations that name the right work with the wrong venue or date.
4.

*Treats approximate citations separately.* A citation naming an area rather than a paper can only be answered by whether the author has related work (`approx-ok`, `approx-none`).

Matching uses accent-folded surnames and a title-similarity measure tolerant of a missing subtitle. Results are cached on the citation *and its link*: an early version keyed the cache on the citation alone, so a paper first cited with a correct DOI could cause a later invented DOI to pass. That defect is recorded here because it illustrates the class of error the design is meant to prevent, and a regression test now covers it.

### 4.2 Quotes

`checkQuote(source, quote)` asks whether a sentence is in a source text. It forgives typography only: whitespace, quotation marks, dashes, ellipsis characters and case. It never forgives words. The quotation must start and end at a word boundary, so that "ship is available" does not match inside "sponsorship is available", and quotations shorter than twelve characters are refused because a short fragment appears in almost any text. A quotation that is genuinely present can still be misleading when taken out of context; that judgement is left to a person.

### 4.3 Figures

`checkFigures(draft, materials)` extracts every number from the draft, in any notation (`5,000`, `12.5`, `40%`, `40 percent`, `50k`, `2 million`, `three`), and checks that the same value occurs in the supplied materials. A percentage and a plain number are different figures, so "40 women" in a CV does not support an invented "40%". Left out on purpose are the word "one", ordinals, list numbering, and digits glued to letters (`B2B`, `Q3`), which are overwhelmingly not claims. The check establishes that a number was supplied, not what it is about.

### 4.4 Gate

The gate judges how a claim is *sourced*, not whether it is true, against a policy supplied as data. Sources are assigned tiers (0, the author's own first-party data; 1, an authority within its mandate; 2, a specialist; 3, the press; 4, an aggregator, which points to a source and is never one). A rule states which claims need stronger backing, selecting them by category *or* by what the text reads like so that a mislabelled claim does not escape, and what satisfies the rule as alternatives counted over distinct sites ("one authority, or two news sources"). Nobody, including the author of a claim, can raise an unlisted domain above tier 3 by asserting it. A broken policy entry is dropped and reported rather than disabling the gate. The tier list is the user's; Assay ships a small neutral default.

### 4.5 Grounding

A model that tags its own sentence `[[c3]]` has established nothing until something checks that claim 3 exists, that the sentence's own figure matches claim 3's, and that a line carrying a number carries a tag that can justify one. `checkGrounding` performs these checks against the claims approved for the draft. Tags for approved claims, calculations over claims (`[[calc: c3*0.15]]`, re-evaluated by a bounded arithmetic evaluator that never uses `eval`), reasoning (`[[logic]]`, which can never justify a number) and invented worked-example figures are distinguished; the tag syntax is a parameter. A calculation that cannot be read is a violation. The check establishes that a figure is traceable and matches; where a claim carries several numbers it cannot tell which the line means, and the values check is then the right tool.

### 4.6 Values

A citation can be real, its link live, and the claim can still state the wrong year's figure. The values check asks a statistical source's own data (World Bank, IMF, Eurostat in 0.4.0, Our World in Data, any statistics service described with data, or figures a person seeded from a primary publication such as a central bank's bulletin) and is strict by design: the unit must match (a claim in one currency against a series in another is a different measurement, not a disagreement), the exact period must exist (a close number for another year is `period-unmatched`, a downgrade rather than a pass), and a model cannot produce "verified". An optional hook allows a caller-supplied model to contradict, never to verify.

### 4.7 Links

Whether a page exists is the only claim the link checker makes. Statuses distinguish a live page, a page that is not there (HTTP 404 or 410), a site refusing or struggling (401, 403, 429 or 5xx, which are *never* treated as broken), an unreachable host (which says nothing about the page), a soft 404 (the request succeeded but landed on a home page or a page titled "not found"), and an address refused without a request. The component is server-side only (`"browser": null` in the package exports) because it fetches addresses taken from untrusted text; Section 6 describes its hardening.

### 4.8 Extensions (0.4.0): support, retractions and legal

*Support* asks whether a source text actually backs a sentence, which existence checks cannot. Assay has no model in it; the caller supplies a judge function. The design applies P7 in three steps. First, numbers are checked without any model: a figure in the claim that is absent from the source fails before the judge is asked. Second, the judge must answer with a verdict and a quoted piece of evidence, and the evidence is verified with the quotes check; a "supports" verdict whose quotation is not in the source is classed as invented evidence and fails. Third, even verified evidence yields only `check` ("a person should confirm it says the same thing"), because the model's reading of the evidence is the part nobody verified; a caller may opt in to counting it as `ok`. A "contradicts" verdict is believed as a failure only when it shows where. An unreachable or malformed judge is `unavailable`. The design is motivated by evidence that model judges are imperfect: Zheng et al. (2023) report position and verbosity biases in LLM-as-a-judge evaluation, and Wang et al. (2023) show that the order of candidates can change the verdict.

*Retractions* asks Crossref whether a cited work has a retraction, withdrawal, correction or expression-of-concern notice, using the notices Crossref carries including those from Retraction Watch (Crossref, 2023). "No notice recorded" is explicitly not proof that none exists, and a DOI that Crossref does not hold is skipped rather than cleared.

*Legal* checks US case citations against CourtListener's citation-lookup API. Besides existence, it detects a real citation attached to the wrong case, by comparing the case name written before the citation with the name CourtListener holds for it. A citation not found is reported as "not verified" because CourtListener does not hold every court's decisions. The API is documented to answer a well-formed citation absent from its database with status 404; it does not cover statutes, journals or *id.*/*supra* references (Free Law Project, 2024).

### 4.9 Adding sources

Because the evidence a verdict rests on is defined by its sources, adding a source is a decision about trust, and Assay leaves it to a person. A source is an object with a name, a self-test work (the *canary*) and a search function; a value source additionally supplies a series. Callers can supply their own, replace the defaults, or write one declaratively: `jsonSource` for bibliographic services and `jsonValueSource` for statistics services take an https address with a fixed host, the location of the records and fields in the reply, and a required canary, and refuse a description that lacks any of these. The sources need not be academic: a university repository, a central bank's data portal, a statistics office, a regulator's register or a company-filings interface are described the same way. Sources with no interface at all are ranked by the gate against the user's own list of bodies and outlets, for which the repository includes an example policy for markets, energy, trade and food-security claims. A source added this way inherits the whole discipline of Section 5: its replies are shape-checked, its "not found" is not believed until it has passed its self-test, and a failing source is left alone. Assay deliberately does not discover or adopt sources itself. A library that adopted sources automatically could be directed at a poisoned one, would change which hosts it contacts without anyone deciding to, and would defeat the privacy statement of Section 6.4.

## 5 Self-healing

### 5.1 The problem

Free sources throttle, change their replies and fail. During the project's own testing on 4 November 2026, OpenAlex began answering with HTTP 429 and a `Retry-After` of roughly twenty hours after the test address exhausted a daily credit budget. Without care, an empty reply from such a source reads as "no results", and a checker that treats "no results" as "not found" will accuse real citations on exactly the days the infrastructure is worst.

### 5.2 The invariant

> **I1.** A verdict with bucket `failed` is never derived from an answer that came from an unavailable, throttled, unreadable or self-test-failing source.

The mechanisms below exist to maintain I1; each has a test that fails when the mechanism is removed.

- **Response-shape validation.** A reply that is not the shape a source normally sends (an HTML error page, a renamed field) is classified as an outage. This closes the case in which an API change silently reads as an empty result list.
- **Canary self-test before accusation.** Before any source's "not found" is believed, that source is asked for a work that certainly exists. A source that cannot find it is broken without an error, and its answer is discarded. A passed test is trusted for ten minutes, and tests are single-flight, so that citations checked at the same moment share one. (An early version ran the test once per concurrent citation, producing 27 requests where 18 sufficed.)
- **Per-source circuit breaker.** Three consecutive failures, or a `Retry-After`, put a source aside, for at most fifteen minutes even if it asks for longer, after which a single probe request is let through (half-open). Short waits are retried inside the call; long ones are believed and the source is left alone, instead of being retried after three seconds.
- **Stale-while-error.** A conclusive result is kept (fresh for a day, usable for a week). If sources are down when it expires, the earlier answer is returned marked `stale`.
- **Explicit recovery.** `recheck` repeats only what could not be settled; `repair` fixes only what needs no guessing, namely a real work with an invented DOI receives the DOI of the record it matched, after that new link is itself looked up; `health` reports each source as healthy, degraded (answering, but failing its canary) or down.

### 5.3 A lesson from testing the safeguards

A test of the shape guard continued to pass after the guard was deleted, because the canary test caught the same fault. The shape-guard tests now run with the self-test disabled, so each safeguard is tested alone. We report this because redundant safeguards mask each other in tests, and a suite that cannot distinguish them overstates its coverage.

### 5.4 Self-regulating, not self-updating

The mechanisms above are self-*regulating*: they act while Assay runs, without a person. They are not self-*updating*, and the distinction matters because Assay is only as trustworthy as these safeguards. Nothing in the running library notices that a source has permanently renamed a field, changed its ranking so that the canary work no longer appears, or retired the canary work altogether. In each case the library fails safe, since the shape guard or the self-test makes the source *degraded* and its answers are discarded, but it does not repair itself, and a source that stays degraded silently reduces coverage. Detecting a change and adapting to it are different problems and Assay solves only the first.

The part that notices is outside the library. `assay health` asks every built-in source for a work it must know and reports *healthy*, *degraded* (it answers, but not with that work: a person must look) or *down* (unreachable or throttled, usually temporary). A scheduled workflow in the repository runs it weekly and opens an issue when a source is degraded; a down source is reported but does not fail the job, because several services throttle the shared addresses of the runners. This is monitoring, not repair, and it can fail in its own ways: a canary can be a poor probe (the work is found but the index ranks real queries differently), and a weekly interval means a change can go unnoticed for up to a week. Users who add their own sources can run the same `health()` call in their own schedule.

## 6 Security analysis

### 6.1 Assets and adversaries

The assets are the host that runs Assay and the networks behind it; the user's keys and private text; the free services Assay calls on the user's behalf; and the integrity of published packages. The adversary of primary concern is *the author of the text being checked*: because text usually comes from a model, it is shaped by whoever wrote the prompt, and an adversary may embed addresses, identifiers and patterns designed to make the checker misbehave (an instance of the injection class analysed by Greshake et al., 2023). A secondary adversary is anyone who can influence a package's build or release.

### 6.2 Server-side request forgery in the link checker

A checker that fetches URLs from untrusted text can be made to reach internal services, including cloud metadata endpoints (OWASP, n.d.). The design:

- **The checked address is the connected address.** Every address a name resolves to is validated inside the DNS lookup that the connection itself uses, so there is no check followed by a second resolution. A name that answers "public" to a pre-check and "private" to the connection, the DNS-rebinding pattern analysed by Jackson et al. (2007, 2009), is refused, and a name is refused if *any* address it resolves to is not public.
- **Every redirect hop is re-validated** from the URL down before it is followed; redirects are followed manually, at most five.
- **Only public addresses.** A purpose-written IPv4/IPv6 parser refuses loopback, private (RFC 1918), shared-address (RFC 6598), link-local (which contains the metadata address), documentation, benchmarking, multicast and reserved ranges (RFC 6890). Of IPv6 only global unicast is allowed (RFC 4291), and every form that wraps an IPv4 address, including IPv4-mapped, NAT64 (RFC 6052), 6to4 (RFC 3056) and the deprecated IPv4-compatible forms, is judged by the IPv4 address inside it; Teredo (RFC 4380) is refused outright.
- **Syntactic limits.** Only `http` and `https`, ports 80 and 443 by default, no credentials in the URL (RFC 3986), and no `localhost`, `.local`, `.internal`, `.lan` or single-label names; anything that cannot be parsed is refused.
- **Resource bounds.** Five seconds per request, five redirects, two concurrent requests per host, 25 URLs per call, and only the first 24,000 characters of a page are read. A flood of links cannot become a flood of requests.

The two earlier link guards from which this component was ported, in two earlier applications by the same developer, accepted several of the IPv4-wrapped forms above and resolved the host name a second time after checking it. Both defects were fixed in the port. The checker does not, and cannot, stop a *public* address from being fetched: if exposed as an open service it lets an attacker learn whether any public page exists. Egress filtering on the host remains the right second layer.

### 6.3 Algorithmic-complexity attacks on parsing

Because input is adversarial, patterns that are quadratic on long runs of a single character are a denial-of-service risk (Crosby & Wallach, 2003; Davis et al., 2018). Static analysis (CodeQL) flagged polynomial regular expressions in the code, and measurement confirmed ten places that were quadratic, including in the citation parser and the author splitter. They were rewritten with bounded repetitions and linear trimming helpers, and a permanent regression test now runs every public function that handles text (19 in 0.3.0, 24 in 0.4.0) against 24 families of awkward input at 30,000 characters with a 300 ms budget. The test states its own rule: if it becomes slow, a pattern has become quadratic and must be bounded; the budget is not to be raised.

### 6.4 Privacy and key handling

The offline checks make no requests. The citation check sends only author names, title, year and link of each citation, to a fixed list of hosts; the user's `mailto` goes to CrossRef and OpenAlex and an OpenAlex key to OpenAlex only. Nothing is logged and the default cache is in memory. The library sends no usage data. An application may opt in, by calling it explicitly, to add counts (checked, ok, to check, failed, per check; never text) to a public self-reported counter; the counter keeps running totals and no addresses, rate-limits each sender per day, and makes no claim to be verified. The `legal` check, in contrast, transmits the text it is given to CourtListener, and says so; it is server-side only so that its token is never placed in a page. The `support` check makes no request itself but a judge usually does, and the documentation warns against sending private text to a model the user would not otherwise trust with it.

### 6.5 Supply chain

Assay has no runtime dependencies, so installing it brings in nothing that could be compromised underneath it, the property whose absence drives much of the npm risk described by Zimmermann et al. (2019) and Ohm et al. (2020). Releases are built by a pinned GitHub Actions workflow and published through npm trusted publishing from a protected environment that requires a named human reviewer, so no long-lived publishing token exists to steal; each release carries build provenance (cf. Newman et al., 2022). Repository rules prevent release tags from being moved or deleted and `main` from being rewritten, so a published version cannot be quietly re-pointed at different code. We note a cost of this design that arose in practice: a mistaken tag cannot be deleted without first disabling the rule, which delayed one release.

## 7 Verifying the library

**Differential testing.** The quotes and figures checks were extracted from an existing application's guards. Following the principle of differential testing (McKeeman, 1998), 3,000 generated texts were run through both implementations: figure extraction was identical, and the quote check accepts everything the original accepts. The only differences are the intended stricter behaviours of P6. The IPv4 range rules were tested against Node's own `BlockList` on every range boundary and on 20,000 random addresses.

**Regression tests over adversarial inputs.** Section 6.3.

**Mutation checking of safeguards.** Mutation testing asks whether a test suite notices when the program is changed (Jia & Harman, 2011). We applied it by hand to the safeguards that matter most. For the 0.4.0 additions, eleven deliberate breaks (for example, accepting model-invented evidence, removing the response-shape guard of the retraction, PubMed and Eurostat sources, skipping the wrong-case comparison, leaving a title unescaped in the review page, and letting an unchanged rewrite loop) were each caught by a failing test, with no survivors. The self-healing and security rules of 0.3.0 were checked in the same way, which is how the masking described in Section 5.3 was found. Eleven mutations is a small set chosen by the authors, and we do not claim that it measures the whole suite.

**Live verification.** Network components were run against the real services. The retraction check correctly flagged the 1998 *Lancet* paper by Wakefield and colleagues, reporting the retraction notice dated 6 February 2010 and recorded by Retraction Watch; PubMed and Eurostat sources passed their canary tests and a Eurostat claim was verified and a false one refused. Two components could not be fully verified live and are labelled as such: the Semantic Scholar source (its shared unauthenticated pool answered 429 whenever tried) and the CourtListener check (no token had been used). Both are built from the published API references, treat a reply of the wrong shape as an outage, and are tested against fixtures written from those references, which verifies the code's handling of the documented shape but not that the live service matches its documentation.

**Automated tests.** 371 tests in 0.3.0 and 432 in 0.4.0, run on Node 20, 22 and 24, together with a smoke test that loads every public entry point from the built package.

**Assay applied to its own references.** The reference lists of this report and of its companion report on Lodestone were run through Assay: of the 36 references that carry a DOI, 34 were verified, two came back `unavailable` because OpenAlex was throttling requests at the time (and so were neither verified nor accused), none failed, and none has a retraction notice in Crossref. The run also exposed a defect: CrossRef returns some titles with markup (`<scp>AI</scp>`) and line breaks, which made a correctly cited paper read as having a different title. Titles are now compared as words, a regression test covers it, and the fix is recorded in the 0.4.0 changelog. This is evidence that the checker does useful work on real reference lists; it is not an accuracy measurement, because the references were chosen and verified by the authors first.

## 8 Evaluation

### 8.1 A small labelled sample

We hand-labelled 30 citations written by free models on 3 November 2026, recording for each whether the work was real and whether any link was correct. In the application that motivated the work, the 30 tags produced 15 failures (invented works or bad links, with one exception below), 12 verified and 3 for review. Run against the standalone library with healthy sources, the checker agreed with the hand labels on 28 or 29 of the 30, depending on source health. The exception worth recording is a real report published by the World Health Organization, which came back as not verified because the indexes hold books and reports thinly.

### 8.2 Why this is not a benchmark

The sample is one afternoon's output from free models, labelled by the people who built the checker and who knew what it would say. A rate from 30 items has a wide interval: a Wilson interval (Wilson, 1927; Brown et al., 2001) around 28 of 30 runs from roughly 79% to 98%, and the labelling is not independent. We therefore quote no accuracy figure, and use the sample only to see whether a change moves the results. The same holds for the many invented-citation rates in the literature of Section 1: they are rates for particular models, prompts and dates, and the right reading of our sample is that it is consistent with them.

### 8.3 A protocol for a benchmark that could embarrass the tool

The repository contains a protocol and instruments for building one. Prompts and models are fixed and recorded before any output is examined; items are split into a development set and a test set that nobody touches until the end. Blind sheets, with no verdicts or notes, are labelled separately by at least two people who are not authors of the checker, using stated decision rules (resolve the DOI, read the publisher's page, search a library catalogue) and without using the checker or a model. Agreement is measured with Cohen's kappa (Cohen, 1960), interpreted with the usual caution (Landis & Koch, 1977), and disagreements are adjudicated with the original labels kept. The test set is then frozen and the checker run once, at a stated version, with healthy sources. Results are reported with counts per class and Wilson intervals, not rates alone, with the errors listed, and with prompts, models, dates and labels published. As a guide, knowing a rate near 90% to within five points requires about 140 items in the class. The instruments (blind template, kappa and interval functions) are tested; the independence must come from other people.

## 9 Limitations and threats to validity

**Existence is not support.** A verified citation can be attached to a false sentence, and a fabricated one can be written to match a real record. The messages say "a record exists", and the support extension addresses this only partly, because it depends on a model whose agreement is not evidence.

**Coverage gaps.** Books, reports, chapters, grey literature and non-English work are thinly indexed. Real works come back as not verified; this is why the wording is "not verified" rather than "invented" and why automatic removal of failed citations is opt-in.

**Goodhart's law.** A checker used inside a loop with a model invites optimisation against it. A model asked to repair a failed citation can produce a different citation that merely exists, or a real record to which the sentence does not belong. Existence checks are cheap to satisfy, so passing them must not be read as correctness. This is why the repair loop keeps no model inside Assay, stops after a bounded number of rounds, and never reports success it has not checked.

**Dependence on third-party services.** Results depend on the records, availability and rate limits of CrossRef, OpenAlex and the others. Section 5 limits the damage of an outage but not of a wrong record: a bibliographic database containing an error will propagate it. A data compiler such as Our World in Data is a route to the original source, not a replacement for it: the verdict names the original source the compiler cites, and an error in the compilation or in the original passes through.

**Internal validity.** The labelled sample was labelled by the builders, and the mutation set was chosen by them.

**External validity.** The sample covers one family of models at one time.

**Construct validity.** "Found" means only that a matching record exists.

**Reproducibility.** Network results depend on the state of live services on the day; the code, tests, fixtures and the corpus runner are published so that others can repeat the offline parts exactly and the online parts with their own dates.

**What the checks cannot see.** The quotes check cannot detect a real quotation taken out of context. The figures check supports "40 men" with "40 women". The gate judges sourcing, not truth. Grounding cannot tell which number a line means when a claim carries several. Direct links cannot be checked from a browser. A wrong general-knowledge statement with no supplied source, such as the erroneous claim in the 2023 launch demonstration of a chatbot that moved a company's share price, is outside every check here unless a source is supplied for the support check to compare against.

## 10 Responsible use

Assay makes statements about people's work, and a false accusation is a harm. The design responds by wording (a result is "not verified", never "fabricated"), by the unavailable outcome of Section 5, and by keeping destructive actions such as removing a citation opt-in. The checks are aids to a person who decides; they do not replace that person, and several documented harms involved a person who was shown a problem and chose to vouch for the text anyway. Dual use is possible: a tool that detects fabricated citations can be used to polish fabrications until they pass, and the Goodhart concern of Section 9 applies to adversaries as well as to well-meaning loops. The offline checks are suitable for private text; the networked ones transmit what they say they transmit, and the documentation says what that is.

## 11 Conclusion

We have described Assay, a set of separate, individually usable checks that compare AI-written text with the evidence appropriate to each kind of claim, report in one shape, and treat "could not look" as distinct from "not found". The citation, value and link checks that use the network are built so that outage cannot become accusation, and the one component that fetches untrusted addresses is built against the attacks that apply to it. The verification is a mixture of differential, regression, mutation and live testing, and we have been explicit about where it falls short: the labelled sample is small and not independent, two components are not verified live, and existence is not support. The most useful next step is not a further check but the benchmark of Section 8.3, built by people who did not write the tool.

## Declarations

**Competing interests.** The software described is developed and maintained by the first author, and is released under the MIT licence.

**Funding.** The project is funded by Extrafemi via Extrafemi Labs and Extrafemi Research.

**Data and code availability.** Source code, tests, the labelled sample, the corpus runner and the benchmark instruments are in the project repository at https://github.com/obasaolorunfemi-ai/assay. The version described is the `v0.3.0` tag; the 0.4.0 additions are in the `v0.4.0` tag.

**Use of AI tools.** Parts of the software and of this report were produced with the assistance of an AI model, and every reference was verified against Crossref, arXiv, the RFC Editor or the publisher by the process described below.

**Affiliation.** Both authors: Extrafemi Research.

## References

**Note on the references.** Each reference with a DOI was retrieved from Crossref and checked against the cited title, authors, year and venue; arXiv preprints were checked against arXiv; RFCs were checked against the RFC Editor; web pages were checked to resolve at the time of writing. Press reports and court documents were read as reported by the sources named and not independently verified.

- Alkaissi, H., & McFarlane, S. I. (2023). Artificial hallucinations in ChatGPT: Implications in scientific writing. *Cureus*. https://doi.org/10.7759/cureus.35179
- Athaluri, S. A., Manthena, S. V., Kesapragada, V. S. R. K. M., Yarlagadda, V., Dave, T., & Duddumpudi, R. T. S. (2023). Exploring the boundaries of reality: Investigating the phenomenon of artificial intelligence hallucination in scientific writing through ChatGPT references. *Cureus*. https://doi.org/10.7759/cureus.37432
- Beyer, B., Jones, C., Petoff, J., & Murphy, N. R. (Eds.). (2016). *Site reliability engineering: How Google runs production systems*. O'Reilly Media.
- Bhattacharyya, M., Miller, V. M., Bhattacharyya, D., & Miller, L. E. (2023). High rates of fabricated and inaccurate references in ChatGPT-generated medical content. *Cureus*. https://doi.org/10.7759/cureus.39238
- Bloomberg Law. (2023, June 22). Phony ChatGPT brief leads to $5,000 fine for NY lawyers. https://news.bloomberglaw.com/energy/chatgpt-phony-legal-filing-case-gets-lawyers-a-5-000-fine
- Bohnet, B., Tran, V. Q., Verga, P., Aharoni, R., Andor, D., Soares, L. B., Ciaramita, M., Eisenstein, J., Ganchev, K., Herzig, J., Hui, K., Kwiatkowski, T., Ma, J., Ni, J., Saralegui, L. S., Schuster, T., Cohen, W. W., Collins, M., Das, D., …, & Webster, K. (2022). Attributed question answering: Evaluation and modeling for attributed large language models. *arXiv preprint* arXiv:2212.08037. https://arxiv.org/abs/2212.08037
- Brooker, M. (n.d.). Timeouts, retries, and backoff with jitter. *Amazon Builders' Library*. https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
- Brown, L. D., Cai, T. T., & DasGupta, A. (2001). Interval estimation for a binomial proportion. *Statistical Science*, *16*(2), 101–133. https://doi.org/10.1214/ss/1009213286
- Charlotin, D. (n.d.). *AI hallucination cases* [Database]. https://www.damiencharlotin.com/hallucinations/
- Cohen, J. (1960). A coefficient of agreement for nominal scales. *Educational and Psychological Measurement*, *20*(1), 37–46. https://doi.org/10.1177/001316446002000104
- Crosby, S. A., & Wallach, D. S. (2003). Denial of service via algorithmic complexity attacks. In *Proceedings of the 12th USENIX Security Symposium* (pp. 29–44). USENIX Association. https://www.usenix.org/conference/12th-usenix-security-symposium/denial-service-algorithmic-complexity-attacks
- Crossref. (2023, September 12). News: Crossref and Retraction Watch. https://crossref.org/blog/news-crossref-and-retraction-watch
- Dahl, M., Magesh, V., Suzgun, M., & Ho, D. E. (2024). Large legal fictions: Profiling legal hallucinations in large language models. *Journal of Legal Analysis*, *16*(1), 64–93. https://doi.org/10.1093/jla/laae003
- Davis, J. C., Coghlan, C. A., Servant, F., & Lee, D. (2018). The impact of regular expression denial of service (ReDoS) in practice: An empirical study at the ecosystem scale. In *Proceedings of the 2018 26th ACM Joint Meeting on European Software Engineering Conference and Symposium on the Foundations of Software Engineering* (pp. 246–256). ACM. https://doi.org/10.1145/3236024.3236027
- Dean, J., & Barroso, L. A. (2013). The tail at scale. *Communications of the ACM*, *56*(2), 74–80. https://doi.org/10.1145/2408776.2408794
- Eurostat. (n.d.). API: Getting started. *Eurostat data browser user guides*. https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-getting-started
- Fowler, M. (2014). CircuitBreaker. *martinfowler.com*. https://martinfowler.com/bliki/CircuitBreaker.html
- Free Law Project. (2024, April 16). Combat hallucinations and look up citations with our new API. https://free.law/2024/04/16/citation-lookup-api/
- Gao, L., Dai, Z., Pasupat, P., Chen, A., Chaganty, A. T., Fan, Y., Zhao, V., Lao, N., Lee, H., Juan, D.-C., & Guu, K. (2023a). RARR: Researching and revising what language models say, using language models. In *Proceedings of the 61st Annual Meeting of the Association for Computational Linguistics (Volume 1: Long Papers)* (pp. 16477–16508). ACL. https://doi.org/10.18653/v1/2023.acl-long.910
- Gao, T., Yen, H., Yu, J., & Chen, D. (2023b). Enabling large language models to generate text with citations. In *Proceedings of the 2023 Conference on Empirical Methods in Natural Language Processing* (pp. 6465–6488). ACL. https://doi.org/10.18653/v1/2023.emnlp-main.398
- Greshake, K., Abdelnabi, S., Mishra, S., Endres, C., Holz, T., & Fritz, M. (2023). Not what you've signed up for: Compromising real-world LLM-integrated applications with indirect prompt injection. In *Proceedings of the 16th ACM Workshop on Artificial Intelligence and Security* (pp. 79–90). ACM. https://doi.org/10.1145/3605764.3623985
- Hendricks, G., Tkaczyk, D., Lin, J., & Feeney, P. (2020). Crossref: The sustainable source of community-owned scholarly metadata. *Quantitative Science Studies*, *1*(1), 414–427. https://doi.org/10.1162/qss_a_00022
- Huang, L., Yu, W., Ma, W., Zhong, W., Feng, Z., Wang, H., Chen, Q., Peng, W., Feng, X., Qin, B., & Liu, T. (2025). A survey on hallucination in large language models: Principles, taxonomy, challenges, and open questions. *ACM Transactions on Information Systems*, *43*(2), 1–55. https://doi.org/10.1145/3703155
- Jackson, C., Barth, A., Bortz, A., Shao, W., & Boneh, D. (2007). Protecting browsers from DNS rebinding attacks. In *Proceedings of the 14th ACM Conference on Computer and Communications Security* (pp. 421–431). ACM. https://doi.org/10.1145/1315245.1315298
- Jackson, C., Barth, A., Bortz, A., Shao, W., & Boneh, D. (2009). Protecting browsers from DNS rebinding attacks. *ACM Transactions on the Web*, *3*(1), 1–26. https://doi.org/10.1145/1462148.1462150
- Ji, Z., Lee, N., Frieske, R., Yu, T., Su, D., Xu, Y., Ishii, E., Bang, Y. J., Madotto, A., & Fung, P. (2023). Survey of hallucination in natural language generation. *ACM Computing Surveys*, *55*(12), 1–38. https://doi.org/10.1145/3571730
- Jia, Y., & Harman, M. (2011). An analysis and survey of the development of mutation testing. *IEEE Transactions on Software Engineering*, *37*(5), 649–678. https://doi.org/10.1109/TSE.2010.62
- Kalai, A. T., Nachum, O., Vempala, S. S., & Zhang, E. (2025). Why language models hallucinate. *arXiv preprint* arXiv:2509.04664. https://arxiv.org/abs/2509.04664
- Kalai, A. T., & Vempala, S. S. (2024). Calibrated language models must hallucinate. In *Proceedings of the 56th Annual ACM Symposium on Theory of Computing* (pp. 160–171). ACM. https://doi.org/10.1145/3618260.3649777
- Kans, J. (Ed.). (n.d.). *Entrez programming utilities help*. National Center for Biotechnology Information. https://www.ncbi.nlm.nih.gov/books/NBK25501/
- Kinney, R., Anastasiades, C., Authur, R., Beltagy, I., Bragg, J., Buraczynski, A., Cachola, I., Candra, S., Chandrasekhar, Y., Cohan, A., Crawford, M., Downey, D., Dunkelberger, J., Etzioni, O., Evans, R., Feldman, S., Gorney, J., Graham, D., Hu, F., …, & Weld, D. S. (2023). The Semantic Scholar Open Data Platform. *arXiv preprint* arXiv:2301.10140. https://arxiv.org/abs/2301.10140
- Kryscinski, W., McCann, B., Xiong, C., & Socher, R. (2020). Evaluating the factual consistency of abstractive text summarization. In *Proceedings of the 2020 Conference on Empirical Methods in Natural Language Processing (EMNLP)* (pp. 9332–9346). ACL. https://doi.org/10.18653/v1/2020.emnlp-main.750
- Landis, J. R., & Koch, G. G. (1977). The measurement of observer agreement for categorical data. *Biometrics*, *33*(1), 159–174. https://doi.org/10.2307/2529310
- Lewis, P., Perez, E., Piktus, A., Petroni, F., Karpukhin, V., Goyal, N., Küttler, H., Lewis, M., Yih, W.-t., Rocktäschel, T., Riedel, S., & Kiela, D. (2020). Retrieval-augmented generation for knowledge-intensive NLP tasks. *arXiv preprint* arXiv:2005.11401. https://arxiv.org/abs/2005.11401
- Lin, S., Hilton, J., & Evans, O. (2022). TruthfulQA: Measuring how models mimic human falsehoods. In *Proceedings of the 60th Annual Meeting of the Association for Computational Linguistics (Volume 1: Long Papers)* (pp. 3214–3252). ACL. https://doi.org/10.18653/v1/2022.acl-long.229
- Liu, N., Zhang, T., & Liang, P. (2023). Evaluating verifiability in generative search engines. In *Findings of the Association for Computational Linguistics: EMNLP 2023* (pp. 7001–7025). ACL. https://doi.org/10.18653/v1/2023.findings-emnlp.467
- Magesh, V., Surani, F., Dahl, M., Suzgun, M., Manning, C. D., & Ho, D. E. (2025). Hallucination-free? Assessing the reliability of leading AI legal research tools. *Journal of Empirical Legal Studies*, *22*(2), 216–242. https://doi.org/10.1111/jels.12413
- Malay Mail. (2025, October 7). Deloitte to pay partial refund to Australian govt for report using AI. https://www.malaymail.com/news/world/2025/10/07/deloitte-to-pay-partial-refund-to-australian-govt-for-report-using-ai/193773
- Manakul, P., Liusie, A., & Gales, M. (2023). SelfCheckGPT: Zero-resource black-box hallucination detection for generative large language models. In *Proceedings of the 2023 Conference on Empirical Methods in Natural Language Processing* (pp. 9004–9017). ACL. https://doi.org/10.18653/v1/2023.emnlp-main.557
- Maynez, J., Narayan, S., Bohnet, B., & McDonald, R. (2020). On faithfulness and factuality in abstractive summarization. In *Proceedings of the 58th Annual Meeting of the Association for Computational Linguistics* (pp. 1906–1919). ACL. https://doi.org/10.18653/v1/2020.acl-main.173
- McKeeman, W. M. (1998). Differential testing for software. *Digital Technical Journal*, *10*(1), 100–107.
- Menick, J., Trebacz, M., Mikulik, V., Aslanides, J., Song, F., Chadwick, M., Glaese, M., Young, S., Campbell-Gillingham, L., Irving, G., & McAleese, N. (2022). Teaching language models to support answers with verified quotes. *arXiv preprint* arXiv:2203.11147. https://arxiv.org/abs/2203.11147
- Min, S., Krishna, K., Lyu, X., Lewis, M., Yih, W.-t., Koh, P., Iyyer, M., Zettlemoyer, L., & Hajishirzi, H. (2023). FActScore: Fine-grained atomic evaluation of factual precision in long form text generation. In *Proceedings of the 2023 Conference on Empirical Methods in Natural Language Processing* (pp. 12076–12100). ACL. https://doi.org/10.18653/v1/2023.emnlp-main.741
- Nakano, R., Hilton, J., Balaji, S., Wu, J., Ouyang, L., Kim, C., Hesse, C., Jain, S., Kosaraju, V., Saunders, W., Jiang, X., Cobbe, K., Eloundou, T., Krueger, G., Button, K., Knight, M., Chess, B., & Schulman, J. (2021). WebGPT: Browser-assisted question-answering with human feedback. *arXiv preprint* arXiv:2112.09332. https://arxiv.org/abs/2112.09332
- Newman, Z., Meyers, J. S., & Torres-Arias, S. (2022). Sigstore: Software signing for everybody. In *Proceedings of the 2022 ACM SIGSAC Conference on Computer and Communications Security* (pp. 2353–2367). ACM. https://doi.org/10.1145/3548606.3560596
- Nygard, M. T. (2018). *Release it! Design and deploy production-ready software* (2nd ed.). Pragmatic Bookshelf.
- Ohm, M., Plate, H., Sykosch, A., & Meier, M. (2020). Backstabber's knife collection: A review of open source software supply chain attacks. In *Detection of Intrusions and Malware, and Vulnerability Assessment (DIMVA 2020)* (pp. 23–43). Springer. https://doi.org/10.1007/978-3-030-52683-2_2
- Our World in Data. (n.d.). *Our World in Data*. https://ourworldindata.org/
- OWASP Foundation. (n.d.). *Server-side request forgery prevention cheat sheet*. https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- Priem, J., Piwowar, H., & Orr, R. (2022). OpenAlex: A fully-open index of scholarly works, authors, venues, institutions, and concepts. *arXiv preprint* arXiv:2205.01833. https://arxiv.org/abs/2205.01833
- Rashkin, H., Nikolaev, V., Lamm, M., Aroyo, L., Collins, M., Das, D., Petrov, S., Tomar, G. S., Turc, I., & Reitter, D. (2023). Measuring attribution in natural language generation models. *Computational Linguistics*, *49*(4), 777–840. https://doi.org/10.1162/coli_a_00486
- Thorne, J., Vlachos, A., Christodoulopoulos, C., & Mittal, A. (2018). FEVER: A large-scale dataset for fact extraction and VERification. In *Proceedings of the 2018 Conference of the North American Chapter of the Association for Computational Linguistics: Human Language Technologies, Volume 1 (Long Papers)* (pp. 809–819). ACL. https://doi.org/10.18653/v1/N18-1074
- Walters, W. H., & Wilder, E. I. (2023). Fabrication and errors in the bibliographic citations generated by ChatGPT. *Scientific Reports*, *13*(1), Article 14045. https://doi.org/10.1038/s41598-023-41032-5
- Wang, P., Li, L., Chen, L., Cai, Z., Zhu, D., Lin, B., Cao, Y., Liu, Q., Liu, T., & Sui, Z. (2023). Large language models are not fair evaluators. *arXiv preprint* arXiv:2305.17926. https://arxiv.org/abs/2305.17926
- Wilson, E. B. (1927). Probable inference, the law of succession, and statistical inference. *Journal of the American Statistical Association*, *22*(158), 209–212. https://doi.org/10.1080/01621459.1927.10502953
- World Bank. (n.d.). About the Indicators API documentation. *World Bank Data Help Desk*. https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation
- Xu, Z., Jain, S., & Kankanhalli, M. (2024). Hallucination is inevitable: An innate limitation of large language models. *arXiv preprint* arXiv:2401.11817. https://arxiv.org/abs/2401.11817
- Zheng, L., Chiang, W.-L., Sheng, Y., Zhuang, S., Wu, Z., Zhuang, Y., Lin, Z., Li, Z., Li, D., Xing, E. P., Zhang, H., Gonzalez, J. E., & Stoica, I. (2023). Judging LLM-as-a-judge with MT-Bench and Chatbot Arena. *arXiv preprint* arXiv:2306.05685. https://arxiv.org/abs/2306.05685
- Zimmermann, M., Staicu, C.-A., Tenny, C., & Pradel, M. (2019). Small world with high risks: A study of security threats in the npm ecosystem. In *28th USENIX Security Symposium* (pp. 995–1010). USENIX Association. https://www.usenix.org/conference/usenixsecurity19/presentation/zimmerman

### Internet standards

- Berners-Lee, T., Fielding, R., & Masinter, L. (2005). *Uniform Resource Identifier (URI): Generic syntax* (RFC 3986). IETF. https://www.rfc-editor.org/rfc/rfc3986
- Bao, C., Huitema, C., Bagnulo, M., Boucadair, M., & Li, X. (2010). *IPv6 addressing of IPv4/IPv6 translators* (RFC 6052). IETF. https://www.rfc-editor.org/rfc/rfc6052
- Carpenter, B., & Moore, K. (2001). *Connection of IPv6 domains via IPv4 clouds* (RFC 3056). IETF. https://www.rfc-editor.org/rfc/rfc3056
- Cotton, M., Vegoda, L., Bonica, R. (Ed.), & Haberman, B. (2013). *Special-purpose IP address registries* (RFC 6890). IETF. https://www.rfc-editor.org/rfc/rfc6890
- Fielding, R. (Ed.), Nottingham, M. (Ed.), & Reschke, J. (Ed.). (2022). *HTTP semantics* (RFC 9110). IETF. https://www.rfc-editor.org/rfc/rfc9110
- Hinden, R., & Deering, S. (2006). *IP version 6 addressing architecture* (RFC 4291). IETF. https://www.rfc-editor.org/rfc/rfc4291
- Huitema, C. (2006). *Teredo: Tunneling IPv6 over UDP through network address translations (NATs)* (RFC 4380). IETF. https://www.rfc-editor.org/rfc/rfc4380
- Nottingham, M. (2010). *HTTP cache-control extensions for stale content* (RFC 5861). IETF. https://www.rfc-editor.org/rfc/rfc5861
- Nottingham, M., & Fielding, R. (2012). *Additional HTTP status codes* (RFC 6585). IETF. https://www.rfc-editor.org/rfc/rfc6585
- Rekhter, Y., Moskowitz, B., Karrenberg, D., de Groot, G. J., & Lear, E. (1996). *Address allocation for private internets* (RFC 1918). IETF. https://www.rfc-editor.org/rfc/rfc1918
- Weil, J., Kuarsingh, V., Donley, C., Liljenstolpe, C., & Azinger, M. (2012). *IANA-reserved IPv4 prefix for shared address space* (RFC 6598). IETF. https://www.rfc-editor.org/rfc/rfc6598
