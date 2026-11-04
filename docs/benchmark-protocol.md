# Building a benchmark for Assay that someone else can trust

The 30-citation corpus in `test/corpus.json` is not a benchmark. It is one sample, written by free models on one afternoon, and labelled by the people who built the checker, who knew what the checker would say. It is useful for watching a change move the numbers. No accuracy figure should be quoted from it.

A benchmark needs to be built so that it could embarrass the tool. This is the protocol. Following it is the point; Assay supplies the instruments (`npm run benchmark:template`, `npm run benchmark:agreement`), not the independence, which only other people can give.

## 1. Sample before you look

Fix the prompts and the models first, and write them down: the prompt text, the model names and versions, the dates, the settings. Ask each model each prompt once. Keep everything the models produced, not only the citations that look interesting. Split the items into a **development set**, which anyone may tune against, and a **test set**, which nobody touches until the end.

## 2. Label blind, by people who did not build the checker

Make a sheet with `npm run benchmark:template`: the citations only, with no verdicts and no notes. Give each labeller their own copy. At least two labellers per item, working separately, neither of them an author of Assay.

Each item gets one label:

- `real`: the work exists, by these authors, with this title, and any link given points to it.
- `invented`: no such work; or the authors never wrote that title; or the link does not exist or is another paper.
- `unsure`: after the steps below, still cannot be settled.

Decision rules: resolve the DOI at doi.org and read the publisher's page; search the exact title in a scholarly index and a library catalogue; for books, find the publisher's or a library's record. A real work cited with a wrong year or an invented DOI is `invented` and gets a note saying which. Record what you checked in the `note` field. Do not use Assay, or any language model, to decide.

## 3. Measure the labellers before the tool

Run `npm run benchmark:agreement a.json b.json`. It prints raw agreement and Cohen's kappa for each pair, and lists the items that need adjudication: every disagreement and every `unsure`. A benchmark whose labellers disagree about a fifth of the items cannot grade a tool to better than that. Report the kappa. Adjudicate by discussion, and keep the original labels beside the final ones.

## 4. Freeze, then run

Freeze the labelled test set (commit it, tag it). Run Assay once, at a stated version, with healthy sources, and record the date. Do not change Assay and run again on the same test set: that is tuning on the test, and the numbers stop meaning anything. Changes go on the development set; a new test set is drawn for the next release.

## 5. Report what a reader needs

- The number of items, and how many of each label. A test with 20 invented citations says almost nothing about invented citations.
- For each outcome, the count and the interval, not only the rate. `wilson(k, n)` in `scripts/agreement-lib.mjs` gives the 95% interval. As a guide, to know a rate near 90% to within five points you need about 140 items in the class.
- The cases Assay got wrong, listed, with the reason. Include the real work that was called not found, and the invented one that was called found.
- That "found" means only that a record exists, and what that does and does not show (see the limits in the README).
- The labellers' agreement, the prompts, the models and the dates, and the labels themselves, published so anyone can recompute.

## What this does not settle

A benchmark of citations says nothing about quotes, figures or the gate, which compare text with material the user supplies and need their own. It also cannot say how a tool behaves on text from a model that does not yet exist. Treat any number as a measurement of a version on a sample on a date.
