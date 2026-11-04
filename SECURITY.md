# Security

## Reporting a problem

Please report a vulnerability privately, not in a public issue: use GitHub's **Report a vulnerability** button on the Security tab
of this repository. Say what you found, how to reproduce it, and which version. You will get a reply within a few days.

## What this package is, for supply-chain purposes

- **No runtime dependencies.** Assay uses only `fetch`, `AbortSignal` and `URL`. Installing it brings in nothing else.
- **Small.** Read it before you depend on it.
- **Pinned build.** Third-party GitHub Actions are pinned to a commit; Dependabot proposes updates.
- **Your keys stay yours.** An OpenAlex key is sent to OpenAlex only. Your `mailto` is sent to CrossRef and OpenAlex only.
- **No logging, no telemetry.** Citations, the text around them and results are never stored or sent anywhere but the sources named in the README. The default cache is in memory. The one exception is opt-in: `shareTally` / `startSharing` (`@extrafemi-ai/assay/share`) send a handful of counts to the public counter, but only if your code calls them. They send numbers per check, never text, and nothing in Assay calls them for you.

## How it is published

- **npm trusted publishing, no token.** The release workflow (`release.yml`) runs on a pushed `v*` tag, in the protected `npm-publish` environment, which waits for a named human reviewer. npm trusts this repository and that workflow file, so there is no npm token to steal, leak or expire. Each release carries a signed provenance attestation (`npm audit signatures` verifies it came from this repository).
- **What an attacker would need:** write access to this repository *and* the reviewer's approval, or the npm account itself. Turn on two-factor authentication for the npm account and for GitHub, and keep the `@extrafemi-ai` scope's membership short.
- **Names.** The unscoped name `assay` on npm belongs to someone else. Install `@extrafemi-ai/assay`; a package with the wrong name is not this one.

## How the repository is protected

- **Releases are permanent.** A repository ruleset stops any `v*` tag being moved or deleted once pushed, so a published version cannot be quietly pointed at different code. (A mistaken tag therefore cannot be deleted without switching the ruleset off first.) `main` cannot be force-pushed or deleted.
- **The publish environment accepts only release tags.** `npm-publish` runs only for `v*` tags, and a named reviewer must approve each run.
- **Scanning.** CodeQL runs on every push and weekly. Secret scanning with push protection is on. Dependabot proposes updates and security fixes; major-version bumps are reviewed by hand, not merged automatically.
- **Private reporting.** GitHub's private vulnerability reporting is on, which is what the button above is.

## Limits that protect other people

Assay sends requests to free, shared services on behalf of whoever calls it. `maxCitations` (default 50) bounds a single call: before the cap, a text with 5,000 citations caused 15,000 requests. At most four requests run at once and start no faster than `requestsPerSecond` (default 5), each has a timeout, a 429 gets one polite retry, and a throttled service is reported as `unavailable`, never as a verdict on the citation. If you expose Assay behind an endpoint, also limit callers yourself: the cap is per call, not per caller.

## Which parts touch the network

Only **citations** and **values** touch the network. `quotes`, `figures`, `gate` and `grounding` compare text with material you supply and have no network access: a test fails if they, or anything they import, could reach one. That makes them the ones to use on private text. They also take text of any size without a pattern that backtracks badly (a megabyte of digits, brackets and repeated words each ran in milliseconds), and `evalFormula` is bounded in length and nesting and never uses `eval` or `Function`.

## The link checker (`@extrafemi-ai/assay/links`)

This is the one module that makes requests to addresses it did not choose, so read this before you use it.

**What it guarantees**
- **The checked address is the connected address.** Every address a host name resolves to is validated inside the DNS lookup the connection itself uses. There is no check followed by a second resolution, so a name that answers "public" to a check and "private" to the connection (DNS rebinding) is refused. A name is refused if *any* address it resolves to is not public.
- **Every redirect hop is re-checked**, from the URL down, before it is followed. Redirects are followed by hand, up to 5.
- **Only public addresses.** IPv4: loopback, private, link-local (which includes the cloud metadata address), carrier-grade NAT, documentation, benchmarking, multicast and reserved ranges are refused. IPv6: only global unicast is allowed, and every form that wraps an IPv4 address (`::ffff:7f00:1`, NAT64, 6to4, the deprecated `::a.b.c.d`) is judged by the IPv4 address inside it; Teredo, unique-local, link-local and documentation ranges are refused. Disguised forms (`2130706433`, `0x7f.1`, octal) are refused. The IPv4 ranges are tested against Node's own `net.BlockList`.
- **Only `http` and `https`, ports 80 and 443 by default, no credentials in the URL, and no `localhost`, `.local`, `.internal`, `.lan` or single-label names.**
- **Bounded.** 5 seconds per request, 5 redirects, 2 concurrent requests per host, 25 URLs per call, and only the first 24,000 characters of a page are ever read (the connection is then dropped). A flood of links cannot become a flood of requests.
- **Fails closed.** Anything it cannot parse is refused. A refused URL is never requested.

**What it does not do**
- It does not stop a **public** address from being fetched. If you point it at text from an attacker, the attacker can make your server request any public page (and learn, from the verdict, whether it is there). Do not return the raw status of arbitrary URLs to an untrusted caller without rate limiting them.
- It checks that a page is *there*, not that it says what a citation claims.
- It does not guard the network around it: egress filtering on your host is still the right second layer. If your platform can reach private networks, also block them at the platform.
- `unsafeOverrides` exists for tests and removes these rules. Never use it with links from a model or a user.
- Redirect targets and response headers come from the other server and are treated as untrusted: the checker reads only the status, `Location` and `Retry-After`.

## What it does with untrusted text

The text it reads is usually written by an AI model, so it treats it as hostile. It only reads author, title, year, venue and link out
of square-bracket tags; those values are put into the query string of a request to a fixed list of hosts and are URL-encoded. It never
fetches a URL taken from the text: the only links it follows are DOI, SSRN, arXiv and PubMed identifiers, rebuilt into requests to
`crossref.org`, `doi.org`, `datacite.org` and `ncbi.nlm.nih.gov`. A DOI offered as a fix (`suggestedDoi`) is only ever a well-formed DOI.
**Hostile text is tested for, not assumed away.** CodeQL flagged "polynomial regular expression" patterns in 0.3.0 development, and measuring confirmed ten places where doubling a long run of spaces, digits, dots or commas quadrupled the time (author splitting, typed-number extraction, quote trimming, tag stripping, DOI trimming, and one algorithmic case in the gate that built a suffix string for every label of a 24,000-dot host). All are fixed: repetitions are bounded, trimming uses linear helpers (`strutil.ts`), and a host longer than 253 characters is not a host. A permanent test (`redos.test.ts`) runs every public function against 24 awkward input families and fails if any takes more than 300 ms at 30,000 characters. If you render a verdict's `message` or a record's `title` as HTML, use `escapeHtml()` or `textContent`: they contain text from the web.
