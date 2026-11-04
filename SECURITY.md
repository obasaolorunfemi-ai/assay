# Security

## Reporting a problem

Please report a vulnerability privately, not in a public issue: use GitHub's **Report a vulnerability** button on the Security tab
of this repository. Say what you found, how to reproduce it, and which version. You will get a reply within a few days.

## What this package is, for supply-chain purposes

- **No runtime dependencies.** Assay uses only `fetch`, `AbortSignal` and `URL`. Installing it brings in nothing else.
- **Small.** Read it before you depend on it.
- **Pinned build.** Third-party GitHub Actions are pinned to a commit; Dependabot proposes updates.
- **Your keys stay yours.** An OpenAlex key is sent to OpenAlex only. Your `mailto` is sent to CrossRef and OpenAlex only.
- **No logging, no telemetry.** Citations, the text around them and results are never stored or sent anywhere but the sources named in the README. The default cache is in memory.

## How it is published

- **npm trusted publishing, no token.** The release workflow (`release.yml`) runs on a pushed `v*` tag, in the protected `npm-publish` environment, which waits for a named human reviewer. npm trusts this repository and that workflow file, so there is no npm token to steal, leak or expire. Each release carries a signed provenance attestation (`npm audit signatures` verifies it came from this repository).
- **What an attacker would need:** write access to this repository *and* the reviewer's approval, or the npm account itself. Turn on two-factor authentication for the npm account and for GitHub, and keep the `@extrafemi-ai` scope's membership short.
- **Names.** The unscoped name `assay` on npm belongs to someone else. Install `@extrafemi-ai/assay`; a package with the wrong name is not this one.

## Limits that protect other people

Assay sends requests to free, shared services on behalf of whoever calls it. `maxCitations` (default 50) bounds a single call: before the cap, a text with 5,000 citations caused 15,000 requests. At most four requests run at once, each has a timeout, a 429 gets one polite retry, and a throttled service is reported as `unavailable`, never as a verdict on the citation. If you expose Assay behind an endpoint, also limit callers yourself: the cap is per call, not per caller.

## What it does with untrusted text

The text it reads is usually written by an AI model, so it treats it as hostile. It only reads author, title, year, venue and link out
of square-bracket tags; those values are put into the query string of a request to a fixed list of hosts and are URL-encoded. It never
fetches a URL taken from the text: the only links it follows are DOI, SSRN, arXiv and PubMed identifiers, rebuilt into requests to
`crossref.org`, `doi.org`, `datacite.org` and `ncbi.nlm.nih.gov`. A DOI offered as a fix (`suggestedDoi`) is only ever a well-formed DOI.
The parser was run on a million characters of nested brackets, unclosed tags, and tags full of quotes and dashes: each took a few milliseconds, so there is no catastrophic backtracking in it. If you render a verdict's `message` or a record's `title` as HTML, escape it: they contain text from the web.
