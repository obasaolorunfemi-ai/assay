// Runs the labelled corpus (test/corpus.json) against the LIVE sources and reports how the checker did.
//   npm run corpus                      uses the real network; takes about a minute
//   ASSAY_MAILTO=you@example.org npm run corpus
// Each entry is a citation written by a free model (2026-11-03), labelled by hand with what was true of it. This is a small sample,
// not a benchmark: use it to see a change move the numbers, not to quote an accuracy.
import { readFileSync } from 'node:fs';
import { createAssay } from '../dist/index.js';

const corpus = JSON.parse(readFileSync(new URL('../test/corpus.json', import.meta.url), 'utf8'));
const assay = createAssay({ mailto: process.env.ASSAY_MAILTO ?? '', concurrency: 2 });
const rep = await assay.check(corpus.map((c) => c.tag).join(' '));
const byTag = new Map(rep.verdicts.map((v) => [v.citation.tag, v]));
let agree = 0;
const wrong = [];
for (const c of corpus) {
  const v = byTag.get(c.tag);
  const got = v ? v.bucket : 'missing';
  if (got === c.expect) agree++; else wrong.push({ what: c.what, expect: c.expect, got, status: v?.status });
  console.log(`${got === c.expect ? '  ' : '!!'} ${got.padEnd(7)} ${(v?.status ?? '').padEnd(12)} ${c.what}`);
}
console.log(`\n${agree} of ${corpus.length} as expected. ${rep.summary.text}`);
for (const w of wrong) console.log('DIFFERS:', JSON.stringify(w));
process.exit(wrong.length ? 1 : 0);
