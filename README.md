# Assay

Checks AI-written text against evidence, so an invented paper, a made-up quote or a number nobody supplied is caught before anyone relies on it.

Assay is **a set of separate checks, not one**. Each compares the text with a different thing, so each is its own module with its own
entry point, and you use only the ones your scenario needs.

| check | compares the text with | network | import |
|---|---|---|---|
| **citations** | public records of papers and books (CrossRef, OpenAlex, Open Library, the DOI registries) | yes | `@extrafemi-ai/assay` |
| **quotes** | the source text you supply: is this sentence really in it? | **no** | `@extrafemi-ai/assay/quotes` |
| **figures** | the materials you supply: does every number come from them? | **no** | `@extrafemi-ai/assay/figures` |
| **names** | the materials you supply: is every person, organisation, link and DOI in a draft one of theirs? | **no** | `@extrafemi-ai/assay/names` |
| **claims** | the materials you supply: does the draft say something about the person (led, large, founded, PhD, a tool) that the materials never say? | **no** | `@extrafemi-ai/assay/claims` |
| **references** | the materials you supply: does the draft lean on a source (an author and year, "according to…", "studies show") that the materials never mention? | **no** | `@extrafemi-ai/assay/references` |
| **own** | the person's own CV, profile and letters, as a place a citation can be found (a citation source; no request) | **no** | `@extrafemi-ai/assay/own` |
| **draft** | all of the above and figures, in one call | **no** | `@extrafemi-ai/assay/draft` |
| **gate** | a policy about sources: is each claim sourced well enough to be stated? | **no** | `@extrafemi-ai/assay/gate` |
| **grounding** | a list of approved claims: does every figure in a draft trace to one, and match it? | **no** | `@extrafemi-ai/assay/grounding` |
| **links** | the live web: is the page there? (server-side only) | yes | `@extrafemi-ai/assay/links` |
| **values** | a source's own data (World Bank, IMF, Eurostat, Our World in Data, any statistics service you add, or figures you seeded): does the number match, for that year? | yes | `@extrafemi-ai/assay/values` |
| **support** | a source text you supply: does it actually *back* this sentence? (you supply the model that judges; Assay verifies its evidence) | **no** (your judge may) | `@extrafemi-ai/assay/support` |
| **retractions** | Crossref's notices, including Retraction Watch: has this paper been retracted? | yes | `@extrafemi-ai/assay/retractions` |
| **legal** | CourtListener's database of US court decisions: are these case citations real, and is that the case named? (server-side, needs a free token) | yes | `@extrafemi-ai/assay/legal` |

The ones that check against *your own material or policy* never touch the network, and a test enforces that, so they are safe to run on private text
such as a CV. Only citations sends anything out (the author, title, year and link of each citation, never the surrounding text).
All three report the same way: a verdict for each item with a plain-words `message`, a one-line `summary`, and `ok`.

Each check says what it compares against.

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

### What regulates itself, and what does not

The safeguards above react while Assay runs. Be clear about what that is:

| | Does it happen by itself? |
|---|---|
| Leaving a failing or throttled source alone, then probing it | **Yes**, at run time (the breaker) |
| Refusing to accuse when a source gives a changed or unreadable reply | **Yes** (shape check) |
| Refusing to believe "not found" from a source that cannot find a known work | **Yes** (self-test with a canary) |
| Serving an earlier answer, marked stale, when sources are down | **Yes** |
| Noticing that a source has *permanently* changed (a renamed field, a retired canary work) | **No**, not by the running library. `assay health` asks every built-in source for a known work and reports `degraded` when one answers wrongly; the repository runs it weekly (`.github/workflows/sources-health.yml`) and opens an issue. A person then fixes the source. |
| Adapting to a changed reply | **No.** Detecting a change and fixing for it are different things; Assay does the first. |
| Finding and adopting new sources, or changing which services it calls | **No, deliberately.** See below. |

So Assay is self-*regulating*, not self-*updating*. The safeguards stop a failing source from causing a wrong verdict; keeping the sources themselves current is maintenance, and the weekly check is what tells the maintainers when it is due.

### Adding your own source

You can add a source; Assay will not add one to itself. A new source is a new thing whose answers are believed, and a library that adopted sources automatically could be pointed at a poisoned one, and would break its promise about which hosts it contacts. So adding one is a decision a person takes, in code or in data. It can be a university repository, but just as well a central bank's data portal, a statistics office, a regulator's register, a company-filings API, a news API, or your own first-party records.

**With data**, for any service that answers JSON over https (the description is checked when you make it; a reply of the wrong shape is an outage; a canary is required):

```ts
import { createAssay, defaultSources, jsonSource } from '@extrafemi-ai/assay';

const myIndex = jsonSource({
  name: 'My Institution Repository',
  url: 'https://repo.example.org/api/search?title={title}&author={surname}',
  headers: { 'x-api-key': 'key:myrepo' },                       // 'key:NAME' is read from keys.NAME below
  results: 'data.items',                                        // where the array of records is in the reply
  fields: { title: 'name', authors: 'writers', year: 'meta.year', doi: 'ids.doi' },
  authorName: 'fullName',                                       // authors are objects: where the name is inside each
  canary: { title: 'A work this repository certainly holds', surname: 'Surname', authors: ['Surname'] },
});
const assay = createAssay({ sources: [...defaultSources, myIndex], keys: { myrepo: process.env.REPO_KEY! } });
```

**For numbers**, `jsonValueSource` does the same for a statistics service (the address takes `{geo}`, `{from}`, `{to}` and `{indicator}`; the figures are multiplied by `magnitude` so "in millions" compares as a full value).

**With code**, implement `SearchSource` (`{ name, canary, search(query, http, ctx) }`), or for numbers `ValueSource`, or `seededSource` for figures a person read off a primary publication. Add the source to your own scheduled check with `createAssay({ sources }).health()`: it will tell you when your source starts answering wrongly. To add a source to Assay itself, open a pull request with the source, a fixture recorded from the real service, a self-test, and a note of whether it was verified live.

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

Sources: `worldBank` and `imf` (free, no key; the IMF covers World Economic Outlook aggregates only), `eurostat` and `ourWorldInData` (opt in), `jsonValueSource(spec)` for any statistics service that answers JSON over https (a central bank's data portal, a statistics office, a regulator), and `seededSource(entries)` for figures a *person* read off a primary
publication (a central bank's bulletin, a statistics office's release) where no interface exists. Every seeded figure is reported as verified, so none should go in from memory or from a model.
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

## Links

Is the page really there? **Server-side only** (Node, Bun, Deno): it makes requests, so it is deliberately absent from browser bundles (`"browser": null` in the package's `exports`).

```ts
import { createLinkChecker } from '@extrafemi-ai/assay/links';

const links = createLinkChecker();
const report = await links.check(['https://example.com/paper.pdf', 'http://169.254.169.254/latest/meta-data/']);
report.verdicts.map((v) => [v.url, v.status]);   // [['…/paper.pdf', 'live'], ['http://169.254.169.254/…', 'unsafe']]
report.summary.text;                              // "Links: 2 · ✓ 1 live · ✕ 1 broken or refused — do not present them as sources."
```

Statuses: `live`, `broken` (404 or 410: the page is not there), `blocked` (401, 403, 429, 5xx: a site refusing or struggling, **never** treated as broken), `unreachable` (could not connect; says nothing
about the page), `soft404` (it answered, but landed on the home page or a page titled "not found"), `unsafe` (refused without a request), `limit`. `recheck(report)` checks again what could not be settled.

**This is the module that can hurt you**, because it fetches URLs that came out of AI text, which is shaped by whoever wrote the prompt. A crafted link must never make your server reach your own
network or your cloud's metadata service. See [SECURITY](SECURITY.md) for what it guarantees and what it does not. In short: the address that is validated is the address that is connected to (so a name
that answers "public" to a check and "private" to the connection is refused); every redirect hop is re-checked from the URL down; only http and https on ports 80 and 443, no credentials, no `localhost`, no
`.internal` or single-label names, and only public IP addresses (including every IPv6 way of writing a private IPv4 one). `checkUrl()` and `isSafeAddress()` are exported if you want the rules on their own.

Bounded: 5 seconds per request, 5 redirects, 2 requests at a time to any one host, 25 URLs per call, and only the first 24,000 characters of a page are ever read. A host that fails repeatedly, or sends
`Retry-After`, is left alone for a while. The default `User-Agent` says what this is; some publishers block anything that is not a browser, which comes back as `blocked`.

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

## Names

Figures catches an invented number. Names catches the other thing a model invents when it has nothing real to say: a partner organisation, an earlier employer, a report, a link. "Our partnership with the Greenfield Foundation" and "my earlier role at Acme Capital" contain no digit, so a figures check passes them. `checkNames` reads every capitalised name and acronym in a draft and checks that each word of it appears in the materials you supplied (a CV, a brief, a call for proposals), and does the same for links, DOIs and email addresses.

```ts
import { checkNames, findUnsupportedNames } from '@extrafemi-ai/assay/names';

const r = checkNames(draft, [cv, brief, call]);
r.summary.text;   // "Names: 4 · ✓ 2 in your materials · ✕ 2 not in your materials — check they exist and are yours to claim."
findUnsupportedNames(draft, [cv, brief, call]);   // ["Greenfield Foundation", "Acme Capital"]
```

- **Words, not strings.** A name is supported when every capitalised word in it is in the materials, in any form of the word ("Nigeria" supports "Nigerian"). "Bank of America" joins across *of*, *for* and *the*; "Okafor & Bello" is two names.
- **The first word of a sentence** is capital by grammar, so it is not a name on its own. It counts when it leads straight into another capitalised word and does not read as a verb ("Greenfield Foundation launched…" is checked; "Built Oneremit Payments" is not flagged for *Built*).
- **Links, DOIs and addresses** must appear in the materials, compared without the scheme, `www.` or a trailing slash. A source you did not supply is one to check.
- **`ignore`** adds words that are never names in your text; `links: false` leaves links out.

What it does not do: it reads capitals, so an invented name written in lower case is not caught, and a real name the writer never put in the materials is flagged (that is the point: someone should check it). It does not know what a name is *about*, and it does not check the world, only your materials, so it is safe on private text and a test enforces that it never touches the network.

## Claims

"Led a large team" has no number, no name and no link, so figures and names pass it. Two words in it carry the claim: *led* and *large*. `checkClaims` reads a fixed list of the words that carry weight on a CV or in an application and checks each against the materials:

```ts
import { checkClaims } from '@extrafemi-ai/assay/claims';

checkClaims('Led a large team of engineers.', 'Managed a team of 5 engineers.').summary.text;
// "Claims: 2 · ✓ 1 in your materials · ✕ 1 not in your materials — the materials never use the word that makes the claim."
// "led" is backed by "managed" (same kind of claim); "large" is not backed by anything.
```

- **Embellishments** must be in the materials themselves: *large, significant, global, award-winning, senior, world-class…*
- **Ownership** is backed by any word of the same kind: *led* by *managed*, *founded* by *launched*, *won* by *shortlisted*, *published* by *authored*.
- **Credentials and length**: *PhD, MBA, master's, bachelor's, certified, chartered*, and *decade*.
- **Tools and skills in lower case**, where a name check has no capital to read: *python, kubernetes, tableau, machine learning…* (`tools: false` leaves them out).
- Skips *led to*, *lead time* and *lead generation*; reads *a leading provider* as an embellishment and *leading a team* as a verb. `ignore` takes your own words.

It is a list, not a judgement. It cannot say a sentence is untrue, only that the materials never used the word that makes the claim, and a claim made in words not on the list gets through.

## References

Models cite without being asked: "(Okafor & Bello, 2019)", "according to the World Bank report", "studies show". The bracketed form the citations check reads is not how a model writes unprompted, so those pass it. `checkReferences` reads the loose forms (author and year, numbered `[1]`, *according to…*, and unnamed appeals such as *studies show*, *experts agree*) and checks each against the materials: a source nobody supplied is one to check or cut. It does not look the source up; that is what the citations check does, for the bracketed format.

```ts
import { checkReferences } from '@extrafemi-ai/assay/references';

checkReferences('As Adeyemi et al. (2021) show, research shows this works.', cv).verdicts.map((v) => v.source);
// ["Adeyemi et al., 2021", "research shows"]
```

## Own materials

A person's own publications sit in their own documents (a CV, a profile, an earlier letter). Sending them to a public index to be "verified" is slow, and it leaks what they wrote. `ownMaterials` is a citation source that reads works out of the text you give it and answers locally, with no request. Put it first and a citation the person's own materials list is confirmed there; the rest fall through to the public indexes as before.

```ts
import { createAssay, defaultSources } from '@extrafemi-ai/assay';
import { ownMaterials } from '@extrafemi-ai/assay/own';

const assay = createAssay({ sources: [ownMaterials([cv, profile, letters]), ...defaultSources] });
```

It reads the bracketed form the citations check reads, a reference line written the usual way (`Okafor, A. & Bello, B. (2019). Title of the work. Venue.`), and a quoted title with a year and the author's name before it. The same materials are what the figures, names, references and claims checks are given, so one list of "what this person has said" backs every check.

## Draft

`checkDraft` holds a draft to figures, names, references and claims in one call and returns what none of them could back:

```ts
import { checkDraft } from '@extrafemi-ai/assay/draft';

const r = checkDraft(draft, [cv, brief, call]);
r.findings;   // [{ kind: 'figure' | 'name' | 'link' | 'reference' | 'claim', text, message }, …]
r.summary.text;
```

A citation that trips several checks ("(Okafor, 2019)" is a reference, a name and a year) is reported once, as the reference.

**General advice.** Interview questions and career direction make claims about the *situation*, not the person, so checking every sentence would drown the page. `about: 'you'` reads only the sentences that speak to or about the reader ("Your last role at…", "As a candidate, you…"), on every check above:

```ts
checkDraft(advice, [cv, rubric], { about: 'you' });
```

## Support

Everything above shows that something exists or is traceable. `support` asks whether a source text actually *backs* a sentence. Assay has no model in it: you give it a `judge`, a function that asks whatever model you trust, and Assay holds the judge to its one rule everywhere: **a model may contradict, but it cannot verify.**

```ts
import { createSupport } from '@extrafemi-ai/assay/support';

const support = createSupport({
  judge: async ({ claim, source }) => askYourModel(claim, source),   // must answer { verdict: 'supports' | 'contradicts' | 'unrelated', evidence?: string }
});
const r = await support.check([{ id: 'a', claim: 'Attendance rose 40% year on year.', source: brief }]);
r.summary.text;   // "Support: 1 · ≈ 1 to confirm"
```

- **Numbers first, with no model.** A figure in the claim that is not in the source fails at once and the judge is not asked.
- **The evidence must be real.** The judge has to quote a sentence from the source; the quote is checked with the quotes check. "Supports" with a quote that is not in the source is `evidence-invented`, a failure.
- **Even then, "to confirm".** A quote that is really there, which a model says means the same as the claim, is `check`, not `ok`: the model's reading is the part nobody verified. `trustJudge: true` counts it as `ok` if you accept that.
- **A model that says "contradicts" is believed only if it shows where.** With the quote in the source it is a failure; without, it is to look at.
- An unreachable judge, a timeout or an unreadable answer is `unavailable` and retryable, never an accusation. Assay makes no request itself, but your judge probably does: do not send private text to a model you would not send it to anyway.

## Retractions

A citation can be real, its link live, and the paper withdrawn. Crossref's records carry retraction, withdrawal and correction notices, including the Retraction Watch database Crossref now holds.

```ts
import { createRetractions } from '@extrafemi-ai/assay/retractions';

const r = await createRetractions({ mailto: 'you@example.org' }).check(textOrListOfDois);
r.verdicts[0];   // { status: 'retracted', bucket: 'failed', notice: { type: 'retraction', date: '2010-02-06', source: 'retraction-watch' }, … }
```

Statuses: `retracted` (also withdrawn or removed; a title that starts "RETRACTED" counts), `concern` (expression of concern: to check), `corrected` (ok, with the note), `clear` (no notice recorded), `not-in-crossref` (skipped, not cleared), `unavailable`. "Clear" is not proof: notices reach Crossref from publishers and Retraction Watch, and some are late. It reads every DOI in a text, at most 50 by default.

## Legal

Invented case law is the best-documented harm from AI-written text. `legal` asks CourtListener (the Free Law Project's database of US decisions) about every case citation in a text, through its citation-lookup API, which exists for this.

```ts
import { createLegal } from '@extrafemi-ai/assay/legal';

const r = await createLegal({ token: process.env.COURTLISTENER_TOKEN! }).check(brief);
r.verdicts[0];   // { status: 'wrong-case', bucket: 'failed', caseName: 'Martinez v. …', message: '925 F.3d 1339 exists, but it is …, not "Varghese v. China Southern Airlines".' }
```

**Where the token goes.** Create a free account at [courtlistener.com](https://www.courtlistener.com/) and copy your API token from your profile (CourtListener's API help links to your usage page at `courtlistener.com/profile/api-usage/`). Then keep it out of your code and your repository: put it in an environment variable called `COURTLISTENER_TOKEN`, and read it where you create the checker, as above. On your own machine, `export COURTLISTENER_TOKEN=…` in the shell (or a `.env` file that is listed in `.gitignore`). In Cloudflare Workers, `npx wrangler secret put COURTLISTENER_TOKEN`; on Netlify, an environment variable marked secret; in GitHub Actions, a repository secret passed with `env:`. From the command line: `COURTLISTENER_TOKEN=… assay legal brief.txt`. The command line accepts the token only from the environment, never as an option, because options are kept in shell history. The token is sent to courtlistener.com only.

It needs a free CourtListener token, and sends the text to courtlistener.com: never pass confidential text. It is **server-side only** (`"browser": null`), so a token is never put in a page. Statuses: `found`; `wrong-case` (a real citation that belongs to a different case than the one named, the pattern in the 2023 sanctions case); `notfound` (not verified: CourtListener does not hold every court, so check before calling it invented); `ambiguous`, `unreadable` (a reporter it does not know), `limit` (over 250 citations in a request) and `unavailable`. Statutes, journals and *id.*/*supra* are out of scope for the API. Text over 60,000 characters is sent in parts. Built from the published API reference, and **run live once** (4 November 2026, three citations): a real citation was found, a real citation under the wrong name was caught, and an invented one was not verified. The record, and how to repeat it with `COURTLISTENER_TOKEN=… npm run legal:live`, is in [`docs/legal-live-verification.md`](docs/legal-live-verification.md). One run is not a measure of coverage or of behaviour under its rate limits.

## Tally

Assay itself counts nothing and sends nothing: a library that promises "no logging, no telemetry" cannot also keep a running score. If *you* want a counter for your own app ("12 invented citations blocked this month"), `@extrafemi-ai/assay/tally` is the piece. You feed it the reports your code already has; it keeps only numbers, never the text, the citations or the quotes; and you decide where the numbers go.

```ts
import { createTally } from '@extrafemi-ai/assay/tally';

const tally = createTally();
tally.add('citations', await assay.check(text));      // any Assay report
tally.add('quotes', checkQuotes(items));
tally.snapshot();   // { checked: 14, ok: 11, check: 1, failed: 2, skipped: 0, byCheck: { citations: {…}, quotes: {…} } }
```

### Sharing your counts with the public counter (optional)

The home page of [assay.extrafemi.com](https://assay.extrafemi.com) shows a live counter. It is fed only by apps whose authors choose to take part, and nothing is sent unless your code calls `shareTally` or `startSharing`:

```ts
import { createAssay } from '@extrafemi-ai/assay';
import { createTally } from '@extrafemi-ai/assay/tally';
import { startSharing } from '@extrafemi-ai/assay/share';

const tally = createTally();
const assay = createAssay({ tally });   // also createValues, createRetractions, createLegal, createSupport, createLinkChecker
startSharing(tally);                    // every ten minutes; call `.flush()` before your process exits
```

What goes out is `{ "v": 1, "counts": { "citations": { "checked": 12, "ok": 10, "check": 1, "failed": 1 } } }`: for each check, how many items were checked and how many came back ok, to check or failed. No text, citations, quotes, names or identifiers. The counter (`worker/` in this repository) keeps running totals only; it does not store addresses (it hashes the sender with the day's date, in memory, only to limit what one sender can add in a day), and it is **self-reported and not verified**. A failed report is never fatal and is added to the next one. The plain functions (`checkQuotes`, `checkFigures`, `checkGrounding`, the gate) have no instance to hook, so call `tally.add('quotes', report)` after them.

`merge()` adds counts you kept elsewhere (another process, an earlier day), so you can store the snapshot in your own database and show it on your own page.

## Review, the loop, the command line

- **`@extrafemi-ai/assay/review`** turns any report into one self-contained HTML page for the person who decides: worst first, plain-words messages, no scripts, a policy that forbids requests, everything escaped. `renderReview([sections.quotes(report), sections.figures(report2)], { title })`.
- **`@extrafemi-ai/assay/loop`** (`improve`): when something fails, ask the model again with what was wrong, check again, a bounded number of times. Assay keeps no model in it: you pass `regenerate`, and the loop stops at `maxRewrites` (default 2), on an empty or unchanged answer, or when the model errors, and never claims success it has not checked. With Lodestone: `regenerate: (feedback, text) => ai.complete({ system, messages: [{ role: 'user', content: `${text}\n\n${feedback}` }] }).then((r) => r.text)`.
- **`assay` on the command line** (`npx @extrafemi-ai/assay quotes --source posting.txt --quote "…"`): quotes, figures, grounding, citations, retractions and links on files. Exit code 0 = nothing failed, 1 = something failed, 2 = could not run; `--json` for the report, `--html page.html` for the review page.
- **A GitHub Action** (`action.yml`): `uses: obasaolorunfemi-ai/assay@v0.4.0` with `command` and `args`, so a pull request that adds an unsupported figure fails its check.

## More sources

Assay is not only for academic work. The checks behind it came from tools that lean on central-bank bulletins, statistics offices, regulatory filings, industry analysts and the financial press as much as on papers. A source can be anything a person could open and read, and there are three ways in, depending on what the source offers:

- **It has an open interface:** opt in to a built-in one. For citations: `createAssay({ sources: [...defaultSources, pubmed] })` adds PubMed (verified live), and `semanticscholar` adds Semantic Scholar (built from the API reference, **not verified live**: its shared pool answered 429 whenever tried). For values: `createValues({ sources: [...defaultValueSources, eurostat, ourWorldInData] })` adds Eurostat (the EU, Iceland, Norway and Switzerland; verified live) and [Our World in Data](https://ourworldindata.org/) (verified live). Our World in Data compiles statistics from the UN, the World Bank, national bodies and researchers; the verdict names the original source it cites, because it is the route, not the origin. Name any of its charts by its address slug in `claim.indicator` (`ourworldindata.org/grapher/<slug>`), and give the unit as OWID writes it ("years", or "percent" for a percentage).
- **It has an interface Assay does not know:** describe it with data. `jsonSource` (citations) and `jsonValueSource` (statistics) take an https address with a fixed host, where the rows and fields are in the reply, and a required self-test, and refuse a description missing any of those.
- **It has no interface** (a central bank's PDF bulletin, a regulator's register, a company filing, a news article): the evidence is the page, or a figure someone read off it. Check that the link is there and ranks with the gate against *your* list of bodies and outlets, or put the figure in `seededSource`. [`examples/gate-policy-markets-and-trade.mjs`](examples/gate-policy-markets-and-trade.mjs) is a ready-made policy for markets, energy, trade and food-security claims: UN agencies, central banks and regulators at tier 1, specialist analysts at tier 2, the financial press at tier 3, encyclopaedias and aggregators never alone.

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

Bump `version` in `package.json`, commit, then push a tag that matches it (for example `git tag v0.3.0 && git push origin v0.3.0`). The release workflow waits for a
human to approve in the `npm-publish` environment, runs the type check, tests and build, and publishes with npm trusted publishing and
provenance. No npm token is stored anywhere.

MIT. See [CHANGELOG](CHANGELOG.md) and [SECURITY](SECURITY.md).
