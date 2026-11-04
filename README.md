# Assay

Checks AI-written text against evidence, so an invented paper, a made-up quote or a number nobody supplied is caught before anyone relies on it.

Assay is **a set of separate checks, not one**. Each compares the text with a different thing, so each is its own module with its own
entry point, and you use only the ones your scenario needs.

| check | compares the text with | network | import |
|---|---|---|---|
| **citations** | public records of papers and books (CrossRef, OpenAlex, Open Library, the DOI registries) | yes | `@extrafemi-ai/assay` |
| **quotes** | the source text you supply: is this sentence really in it? | **no** | `@extrafemi-ai/assay/quotes` |
| **figures** | the materials you supply: does every number come from them? | **no** | `@extrafemi-ai/assay/figures` |
| **gate** | a policy about sources: is each claim sourced well enough to be stated? | **no** | `@extrafemi-ai/assay/gate` |
| **grounding** | a list of approved claims: does every figure in a draft trace to one, and match it? | **no** | `@extrafemi-ai/assay/grounding` |
| **values** | a source's own data (World Bank, IMF, or figures you seeded): does the number match, for that year? | yes | `@extrafemi-ai/assay/values` |

The ones that check against *your own material or policy* never touch the network, and a test enforces that, so they are safe to run on private text
such as a CV. Only citations sends anything out (the author, title, year and link of each citation, never the surrounding text).
All three report the same way: a verdict for each item with a plain-words `message`, a one-line `summary`, and `ok`.

One more check is planned as its own module: link liveness (server-only). Each check says what it compares against.

## Citations

AI models cite with complete confidence and are often wrong. In a test of three replies from free models, they wrote DOIs that
do not exist, DOIs that belong to unrelated papers (a Coase 1960 citation pointed at a 1963 book review), real authors with titles
they never wrote, and one paper that was invented outright. A check that only asks "is there a paper with this title?" passes the
first two. Assay asks more.

- **Finds the paper, not just the title.** Author, title and year against CrossRef, OpenAlex and (for books) Open Library. With two
  authors cited, both must be on the same record.
- **Checks the link it gives.** A DOI, an SSRN abstract, an arXiv paper or a PubMed link is looked up in the registry that holds it.
  A real paper with an invented DOI is called out, with the closest real DOI offered.
- **Notices a paper cited wrongly.** The journal or year in the record differs from the citation (journal articles only).
- **Tells "not found" from "could not look".** If a source is throttled or down, the result is `unavailable`, never an accusation.
- **Acts on the result.** One summary line, a verdict for each citation in plain words, and `strip()` to take failed citations out.
- **No dependencies.** Plain `fetch`. Node 20+, browsers, Cloudflare Workers.

## Use

```ts
import { createAssay, strip } from '@extrafemi-ai/assay';

const assay = createAssay({ mailto: 'you@example.org' });

const text = 'Aid weakens accountability [Rose, 1985, "Sick individuals and sick populations" — IJE — https://doi.org/10.1093/ije/14.1.32].';
const report = await assay.check(text);

report.summary.text;   // "Citations: 1 · ✓ 1 verified"
report.ok;             // false if any citation failed
for (const v of report.verdicts) console.log(v.bucket, v.message);

const clean = strip(text, report);                 // failed citations become "[citation removed: could not be verified]"
const gone  = strip(text, report, { mode: 'remove' });
```

### What it reads

A citation is a square-bracket tag with a quoted title and a year. The same format works in a prompt, so your model produces it:

```
[Author, Year, "Exact Title" — Journal — https://doi.org/…]                   a title and a link
[Author, Year, "Exact Title" — Journal — search: https://scholar.google.com/scholar?q=…]
[Author, Year, "Exact Title" — Publisher]                                      no link: still checked
[CITATION — approximate: Author, years, topic — search: …]                    an area, not one paper
```

`[Logical inference — …]` and any other bracket are ignored. A prompt snippet that teaches a model this format, and tells small models
never to write a DOI (they cannot recall them), is in [Whetstone](https://github.com/obasaolorunfemi-ai/whetstone) (`hosted/src/models.js`).

### Verdicts

| bucket | meaning |
|---|---|
| `ok` | The paper exists, by these authors, with this title, and any link given points to it. |
| `check` | Found, but look at it: the title differs, the journal or year differs, the link cannot be checked, the citation is approximate, or the sources were unavailable. |
| `failed` | No such work, an author who never wrote that title, or a link that does not exist or is another paper. Do not rely on it. |

Each verdict has `status` (`found`, `badlink`, `mismatch`, `notfound`, `approx-ok`, `approx-none`, `no-title`, `unavailable`…), `message`
(one sentence), `match` (the record found, so a person can compare), `notes`, and for a wrong DOI, `suggestedDoi`.

### Options

| option | |
|---|---|
| `mailto` | Your address, sent to CrossRef and OpenAlex only, so they can reach you instead of blocking you. Recommended. |
| `keys: { openalex }` | OpenAlex now gives each address a small daily budget. A free key from openalex.org lifts it. Sent to OpenAlex only. |
| `sources` | Replace or extend where it looks. A source is `{ name, search(query, http, ctx) }`. |
| `cache` | Any `{ get, set }` store (Lodestone's stores fit). Default: in memory, one day. "Unavailable" is never cached. |
| `maxCitations` | The most citations checked in one call (default 50). Each costs up to three requests to free, shared services; a text with thousands must not become thousands of requests. The rest come back as `limit` (bucket `check`). |
| `requestsPerSecond` | Requests start no faster than this (default 5, CrossRef's public-pool rate), however many run at once. |
| `concurrency`, `timeoutMs`, `retryDelayMs` | Polite by default: 4 requests at once, 8 s each, one retry after a 429. |
| `fetch` | Your own `fetch`. |

### Showing a verdict in a page

`message`, `match.title` and the citation's own fields contain text from the web or from a model. Use `textContent`, or `escapeHtml()` (exported) before putting any of it in HTML.

### Self-healing

The sources are free and shared, and they break: OpenAlex now gives each address a small daily budget, and a service can change what it sends
without any error. None of that may turn into an accusation against a citation, and none of it should need a person to notice.

- **A changed or broken reply is an outage, not "no results".** A reply that is not the shape the source normally sends (an HTML error page,
  a renamed field) makes the result `unavailable`.
- **A source is tested before it is believed.** Before anyone is told "not found", each source that said so is asked for a work that certainly
  exists. A source that cannot find it is broken without an error, and its answer is discarded (`unavailable`, with the reason). A passed test
  is trusted for ten minutes, and citations checked at the same moment share one test.
- **A failing source is left alone, then probed.** Three failures in a row, or a `Retry-After`, and it is not asked for a while (never longer
  than 15 minutes, even if it asks for 20 hours); then one request is let through to see. Short waits are retried inside the call.
- **An old answer beats "could not tell".** A conclusive result is kept for a week. If the sources are down when it expires, the earlier answer
  is returned marked `stale: true`, with a message saying so.
- **`recheck(report)`** checks again only what could not be settled (`retryable`), once the sources are back.
- **`repair(text, report)`** fixes what needs no guessing: a real paper with an invented DOI gets the DOI of the record it matched, but only
  after that new link is looked up and found to be the paper. It returns the new text and a list of every change. Everything else is left to you.
- **`health()`** asks each source for its known work and says which are `healthy`, `degraded` (answering, but wrongly) or `down` (and when it will be tried again).

What is remembered is about the citation *and its link*: a paper first cited with a good DOI never makes a later invented DOI pass.

## Gate

Is a claim sourced well enough to be stated? The gate checks claims against a **policy about their sources**: no network, no model. It judges how a
claim is *sourced*, not whether it is true.

```ts
import { createGate, rules } from '@extrafemi-ai/assay/gate';

const gate = createGate({
  domains: { 'woodmac.com': 2, 'kpler.com': 2 },          // your own tier list (a small neutral default is built in)
  firstParty: ['mybrand.example'],                         // always tier 0
  rules: [rules.estimatesCausalLegalNeedSpecialist],       // or write your own
});

const report = gate.check([
  { text: 'Delays cost traders an estimated $400m.', category: 'loss-estimate', sources: [{ url: 'https://reuters.com/x', date: '2026-01-01' }] },
]);
report.dropped[0].reason;   // "a loss estimate, causal or force-majeure claim needs one source at Tier 2 or better"
report.summary.text;        // "Claims: 1 · ✕ 1 dropped — do not state the dropped ones as fact."
report.unlistedDomains;     // domains the policy did not know: review them and add the good ones
```

Tiers: 0 your own first-party data, 1 an authority within its mandate, 2 a specialist, 3 the press, 4 an aggregator (it points to the real source;
it is never the source). Outcomes: `pass`, `hold` (only backing is news under 24 hours old), `needs-corroboration`, `low-tier-only`, `no-source`, and `error`
(a claim that could not be judged, which never passes). A **rule** says which claims need stronger backing (by label *or* by what the text reads like, so a
wrong label does not dodge it) and what satisfies it, as "any of": `[{ atLeast: 1, tier: 1 }, { atLeast: 2, tier: 3 }]` is "one authority or two news
sources", counted by *different sites*. Nobody can raise an unknown domain above tier 3 by saying so, including the claim's own author.
A broken policy entry is dropped and reported in `gate.warnings` rather than taking the gate down. `summariseRecency()` lists sources older than two years.

## Values

A citation can be real and its link live, and the claim can still state the wrong year's figure. `values` asks the source's own data.

```ts
import { createValues } from '@extrafemi-ai/assay/values';

const values = createValues({ mailto: 'you@example.org' });

await values.check({ value: 19.5e9, unit: 'USD', period: 2023, geo: 'NGA', subject: 'remittances' });
// { state: 'verified', message: 'Matches World Bank (BX.TRF.PWKR.CD.DT) for 2023: 19,549,549,365 (exact).', … }

await values.checkText('Remittances reached $25 billion in 2023.', { url: 'https://api.worldbank.org/v2/country/NGA/indicator/BX.TRF.PWKR.CD.DT' });
// one verdict per year the sentence names; ok: false, "the claim says 25,000,000,000; World Bank says 19,549,549,365 for 2023"
```

It is strict on purpose: the **unit must match** (a GBP claim against a USD series, or a count against a percentage, is a different measurement, not a
disagreement), the **exact period must exist** (a close number for a different year never counts: `period-unmatched` is a downgrade, not a pass), and **a model
cannot produce "verified"**. States: `verified`, `mismatch`, `unit-mismatch`, `period-unmatched`, `no-data`, `no-source`, `unavailable`, `not-checkable`.

Sources: `worldBank` and `imf` (free, no key; the IMF covers World Economic Outlook aggregates only), and `seededSource(entries)` for figures a *person* read off a primary
publication (a central bank's report) where no API exists. Every seeded figure is reported as verified, so none should go in from memory or from a model.
`reconcile(claim, series)` is the pure comparison, usable on its own. Add your own source with `{ name, fetch(claim, ctx) }`.

`crossCheck` is an optional hook **you** supply (a model call, say; Assay makes none) for a claim no source covers. It can flag a mismatch (`cross-check-mismatch`).
At best it says `plausible`, which is a `check`, never verification. Values are self-healing like citations: a changed reply shape or an error body is `unavailable`, never "no
data" or a mismatch; a throttled source is left alone and its `Retry-After` believed; an earlier series is served (`stale`) when the source is down; and a source's "mismatch"
is held back unless it first returns a known figure correctly (`health()` reports this).

## Grounding

A model that tags its own sentence `[[c3]]` has proved nothing until something checks that c3 exists, that the sentence's *own* figure matches c3's, and that a line
carrying a number carries a tag that can justify one. `checkGrounding` does that against the claims you approved for the draft.

```ts
import { checkGrounding, stripTags } from '@extrafemi-ai/assay/grounding';

const claims = [{ ref: 1, text: 'The official rate averaged ₦645.19 in 2023.' }];
const r = checkGrounding('The rate moved to ₦425 in 2023 [[c1]].', claims);
r.ok;                       // false
r.violations[0];            // { code: 'figure-mismatch', reason: "states a figure that doesn't match c1's stated figure: possible mis-citation", … }
r.summary.text;             // "Lines: 1 · ✕ 1 not grounded — do not publish the flagged lines as they stand."
stripTags(draft);           // the published text, tags removed
```

Tags: `[[c3]]` or `[[c3,c7]]` cite approved claims; `[[calc: c3*0.15]]` is a calculation over claims (re-run, and the result must match the line);
`[[logic]]` is reasoning and **can never justify a number**; `[[eg]]` marks an invented figure in a worked example; `[verify: …]` is a note for the editor. **The syntax is a parameter**
(`tags: { open: '{{', close: '}}', claim: 's', … }`): `[[c3]]` is only the default. Every factual line is checked, including bullets, quotes and table rows. Headings, code fences and
everything under `## Sources` are not. Small counts with a unit ("12 years", "three postings") are figures too (`countUnits` adds yours).

Violation codes: `untagged-figure`, `unknown-claim`, `logic-figure`, `figure-mismatch`, `calc-mismatch`, `calc-no-refs`, `calc-unreadable`. **A formula that cannot be read is a violation**,
not a way to carry a figure unchecked (the original let it pass). A calculation given only as a list of claims (`[[calc: c1,c2]]`) names its inputs but cannot be re-run: it is
traced and reported in `warnings`. This checks that a figure is *traceable and matches*, not that the claim is true; when a claim carries several numbers it cannot tell which one the line means
(use `values` for the period). Offline.

## Quotes

A model asked to back a claim with "an exact quote from the posting" can invent the quote. `checkQuote` checks it against the source text.

```ts
import { checkQuote, checkQuotes, verifyQuote } from '@extrafemi-ai/assay/quotes';

verifyQuote(jobAd, 'Visa sponsorship is available for this role');   // true or false
checkQuote(jobAd, 'Relocation is available for all staff');          // { status: 'missing', bucket: 'failed', message: '…' }
checkQuotes([{ id: 'a', quote, source: jobAd }, …]).summary.text;     // "Quotes: 3 · ✓ 2 found · ✕ 1 not found — …"
```

It forgives typography only (whitespace, curly quotes, dashes, case) and never words. The quote must start and end at a word boundary, and a
quote under 12 characters is refused (`"sponsorship"` would match almost any posting; set `minChars` to change it).
Statuses: `found`, `missing`, `too-short`, `empty`.

## Figures

An invented "5,000 beneficiaries" or "a 40% increase" reads as plausible and nobody checks it. `checkFigures` finds every number in a draft
and checks that the same value appears in the materials you supplied (a CV, a brief, a call for proposals).

```ts
import { checkFigures } from '@extrafemi-ai/assay/figures';

const r = checkFigures(draft, [cv, brief, call], { ignore: [/\[ADD:[^\]]*\]/gi] });
r.summary.text;   // "Figures: 3 · ✓ 2 supported · ✕ 1 not in your materials — check them before using the text."
r.verdicts.filter((v) => !v.supported).map((v) => v.figure.raw);   // ["5,000"]
```

It reads numbers in any notation (`5,000`, `12.5`, `40%`, `40 percent`, `50k`, `1.5m`, `2 million`, `three`, `twenty-five`), so "3" in your
brief supports "three" in the draft, and "1.5m" supports "1,500,000". A percentage and a plain number are different figures: a "40 women" in
a CV does not support an invented "40%" (`kinds: false` matches on value alone). `tolerance` (default 0, exact) lets values within a share of
each other match. `ignore` removes text that is not a claim, such as your own placeholder syntax. One verdict per distinct figure.
Left out on purpose: the word "one", ordinals ("40th"), list numbering, and digits glued to letters (`B2B`, `Q3`).

`@extrafemi-ai/assay/figures` also exports `extractFigures`, `extractYears`, and `evalFormula`: arithmetic over named values
(`"(c3-c7)/c7*100"`) evaluated without `eval`, which throws on anything that is not arithmetic, on an unknown name and on division by zero.

## What it cannot do

Read this before you trust a green tick.

**Quotes:** a quote that is really there can still be out of context ("is available" cut from "is available only to staff"). That is for a person to judge. An elided quote ("A … B") is not matched.

**Figures:** it checks that a number was supplied, not what it is *about*: "40 women" in your materials supports "40 women" and also "40 men". It does not catch an invented name, only numbers. Currency symbols are not compared.

**Citations:**

- **It proves a source exists, not that it says what the sentence claims.** A verified citation can still be attached to a false claim, and a fabricated one can be written to match a real record. The messages say "a record exists", not "this is correct".
- **Coverage has gaps.** Books, reports, chapters, grey literature and non-English work are thin in these indexes. A real work can come
  back `failed` (a real WHO report did, in the test corpus). That is why the wording is "not verified", and why `strip()` is opt-in.
- **Direct links cannot be checked** from a browser (most sites do not allow it). They are reported as `check`.
- **`approximate` citations name an area, not a paper.** Assay can only say whether the author has related work.
- **The sources limit free use.** Without `mailto` and an OpenAlex key, a busy app will be throttled, and the result is then
  `unavailable`, not `failed`.
- **The test corpus is 30 citations**, hand-labelled, from one afternoon with free models. `npm run corpus` runs it against the live
  sources. It shows a change moving the numbers; it is not a benchmark, and no accuracy figure should be quoted from it.

## Privacy

Only the author names, title, year and link of each citation are sent, never the surrounding text. They go to: CrossRef,
OpenAlex, Open Library, doi.org, DataCite and PubMed (the last three only when a link calls for them). Nothing is sent anywhere else,
and nothing is logged.

## Origin

Extracted from [Whetstone](https://whetstone.extrafemi.com), where it runs under every reply, and built to sit next to
[Lodestone](https://github.com/obasaolorunfemi-ai/lodestone): Lodestone keeps the model call working, Assay checks what came back.

## Releases

Bump `version` in `package.json`, commit, then push a tag that matches it (for example `git tag v0.2.0 && git push origin v0.2.0`). The release workflow waits for a
human to approve in the `npm-publish` environment, runs the type check, tests and build, and publishes with npm trusted publishing and
provenance. No npm token is stored anywhere.

MIT. See [CHANGELOG](CHANGELOG.md) and [SECURITY](SECURITY.md).
