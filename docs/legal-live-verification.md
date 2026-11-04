# The legal check against the real CourtListener

`@extrafemi-ai/assay/legal` was written from CourtListener's published citation-lookup reference. Until 4 November 2026 it had never been run against the service. This is the record of the first live run, and how to repeat it.

## The first run

On 4 November 2026 the authors ran, from a source checkout with a free CourtListener token in `COURTLISTENER_TOKEN`:

```
printf 'See Brown v. Board of Education, 347 U.S. 483 (1954). Also Roe v. Wade, 347 U.S. 483 (1954). And Smith v. Imaginary Airlines, 999 F.3d 9999 (11th Cir. 2099).' > /tmp/legal-test.txt
node bin/assay.mjs legal /tmp/legal-test.txt
```

and got:

```
Sending the text to courtlistener.com to look up its case citations.
Case citations: 3 · ✓ 1 found · ✕ 2 not verified — do not file or publish them as authority.
  ✓ 347 U.S. 483 is a real citation: Brown v. Board of Education.
  ✕ 347 U.S. 483 exists, but it is Brown v. Board of Education, not "Also Roe v. Wade". The citation points to another case.
  ✕ 999 F.3d 9999 was not found in CourtListener. It may be invented, or it may be a court CourtListener does not hold: check it before relying on it.
```

## What it showed

- **A real citation is found**, with the case CourtListener holds under it.
- **A real citation under the wrong case name is caught.** `347 U.S. 483` is *Brown*; the text called it *Roe v. Wade*. This is the pattern in the 2023 sanctions case on the project's cases page.
- **An invented citation is "not verified"**, with the honest note that CourtListener does not hold every court.
- **One defect:** the second message named the case as "Also Roe v. Wade". The sentence-opening word "Also" had been read as part of the name. It is fixed (`caseNameBefore` now drops signal words such as "See", "Also", "And"), and the line above is now a regression test in `test/legal.test.ts`.

## What this does and does not establish

One run, three citations, one day. It shows that the module speaks the service's real protocol and that the three outcomes work. It is not a measure of how often CourtListener holds a given court's decisions, how it behaves under its rate limits (60 citations a minute, 250 per request), or how it handles statutes and law journals, which it does not cover.

## Repeating it

```
COURTLISTENER_TOKEN=… npm run legal:live
```

It sends the same three citations to courtlistener.com, prints the verdicts, and exits non-zero if a result differs, naming whether the service is throttling (`unavailable`) or has changed from its documentation. Never pass the token as an option.
