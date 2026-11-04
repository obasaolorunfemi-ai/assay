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

The ones that check against *your own material or policy* never touch the network, and a test enforces that, so they are safe to run on private text
such as a CV. Only citations sends anything out (the author, title, year and link of each citation, never the surrounding text).
All three report the same way: a verdict for each item with a plain-words `message`, a one-line `summary`, and `ok`.

More checks are planned as separate modules (values against a source's data, grounding, link liveness). Each will say what it compares against.

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
