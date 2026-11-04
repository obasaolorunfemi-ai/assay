# Assay

Checks the citations in AI-written text, so an invented paper or a made-up DOI is caught before anyone relies on it.

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
| `concurrency`, `timeoutMs`, `retryDelayMs` | Polite by default: 4 requests at once, 8 s each, one retry after a 429. |
| `fetch` | Your own `fetch`. |

## What it cannot do

Read this before you trust a green tick.

- **It proves a source exists, not that it says what the sentence claims.** A verified citation can still be attached to a false claim.
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

Bump `version` in `package.json`, commit, then push a tag that matches it (`git tag v0.1.0 && git push --tags`). The release workflow waits for a
human to approve in the `npm-publish` environment, runs the type check, tests and build, and publishes with npm trusted publishing and
provenance. No npm token is stored anywhere.

MIT. See [CHANGELOG](CHANGELOG.md) and [SECURITY](SECURITY.md).
