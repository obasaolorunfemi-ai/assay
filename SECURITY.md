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

## What it does with untrusted text

The text it reads is usually written by an AI model, so it treats it as hostile. It only reads author, title, year, venue and link out
of square-bracket tags; those values are put into the query string of a request to a fixed list of hosts and are URL-encoded. It never
fetches a URL taken from the text: the only links it follows are DOI, SSRN, arXiv and PubMed identifiers, rebuilt into requests to
`crossref.org`, `doi.org`, `datacite.org` and `ncbi.nlm.nih.gov`. A DOI offered as a fix (`suggestedDoi`) is only ever a well-formed DOI.
If you render a verdict's `message` or a record's `title` as HTML, escape it: they contain text from the web.
