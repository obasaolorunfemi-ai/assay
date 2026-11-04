#!/usr/bin/env node
// The command line: run one Assay check on files. Exit code 0 = nothing failed, 1 = something failed, 2 = could not run (bad usage, unreadable file).
//   assay quotes --source posting.txt --quote "Visa sponsorship is available"      (repeat --quote, or --quotes-file one-per-line.txt)
//   assay figures --draft draft.md --materials cv.txt --materials brief.txt
//   assay citations draft.md [--mailto you@example.org]
//   assay retractions draft.md [--mailto you@example.org]
//   assay links draft.md
//   assay health                                   is each source answering, and answering correctly? (exit 1 if one is not; --strict also if one is down)
//   assay grounding --draft draft.md --claims claims.txt                              (claims: one per line, numbered c1, c2 in order)
//   add --json for the raw report, or --html report.html for a page a person can review
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';

const pkg = createRequire(import.meta.url)('../package.json');
const HELP = `assay ${pkg.version}: check AI-written text against evidence

  assay quotes --source FILE (--quote TEXT ... | --quotes-file FILE)
  assay figures --draft FILE --materials FILE [--materials FILE ...]
  assay grounding --draft FILE --claims FILE
  assay citations FILE [--mailto ADDRESS]        looks the citations up online
  assay retractions FILE [--mailto ADDRESS]      looks the DOIs up online
  assay legal FILE                               checks US case citations at CourtListener (needs COURTLISTENER_TOKEN)
  assay links FILE                               requests the links in the file
  assay health [--mailto ADDRESS] [--strict]     asks every built-in source for a work it should know

  --json         print the raw report
  --html FILE    also write a page for a person to review
  --help, --version

Exit code: 0 nothing failed, 1 something failed, 2 could not run.`;

const die = (msg) => { console.error(`assay: ${msg}`); process.exit(2); };
const read = (f) => { try { return readFileSync(f, 'utf8'); } catch (e) { return die(`cannot read ${f}: ${e.code ?? e.message}`); } };
const MARK = { ok: '✓', check: '≈', failed: '✕', skip: '–' };

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      source: { type: 'string' }, quote: { type: 'string', multiple: true }, 'quotes-file': { type: 'string' },
      draft: { type: 'string' }, materials: { type: 'string', multiple: true }, claims: { type: 'string' },
      mailto: { type: 'string' }, strict: { type: 'boolean' }, json: { type: 'boolean' }, html: { type: 'string' }, help: { type: 'boolean' }, version: { type: 'boolean' },
    },
  });
} catch (e) { die(`${e.message}\n\n${HELP}`); }
const { values: o, positionals } = parsed;
if (o.version) { console.log(pkg.version); process.exit(0); }
const [command, file] = positionals;
if (o.help || !command) { console.log(HELP); process.exit(command || o.help ? 0 : 2); }

if (!existsSync(new URL('../dist/index.js', import.meta.url))) die('this copy has not been built yet. From the repository folder, run: npm ci && npm run build');
const lib = (m) => import(new URL(`../dist/${m}.js`, import.meta.url).href);
if (command === 'health') {
  // Self-regulation is only worth something if somebody notices when a source stops answering correctly. This asks each source for a work it must know.
  // degraded = it answers, but not with the work it should have (a changed reply, a broken index): that needs a person. down = unreachable or throttled: usually temporary.
  const { createAssay, defaultSources, pubmed } = await lib('index');
  const { createValues, defaultValueSources, eurostat, ourWorldInData } = await lib('values');
  const mailto = o.mailto ? { mailto: o.mailto } : {};
  const groups = [['Citation sources', await createAssay({ ...mailto, sources: [...defaultSources, pubmed] }).health()], ['Value sources', await createValues({ ...mailto, sources: [...defaultValueSources, eurostat, ourWorldInData] }).health()]];
  let bad = 0, down = 0;
  for (const [title, list] of groups) {
    console.log(title);
    for (const h of list) {
      if (h.state === 'degraded') bad++;
      if (h.state === 'down' || h.state === 'unknown') down++;
      console.log(`  ${h.state === 'healthy' ? '✓' : h.state === 'degraded' ? '✕' : '≈'} ${h.name}: ${h.state}${h.lastProblem ? ` (${h.lastProblem})` : ''}`);
    }
  }
  if (bad) console.log('\nA degraded source answers, but not correctly: a person needs to look at it.');
  else if (down) console.log('\nSources that are down are usually throttling or briefly unreachable; run again later.');
  process.exit(bad || (o.strict && down) ? 1 : 0);
}
const { renderReview, sections } = await lib('review');
let report, section, lines;

if (command === 'quotes') {
  if (!o.source) die('quotes needs --source FILE');
  const quotes = [...(o.quote ?? []), ...(o['quotes-file'] ? read(o['quotes-file']).split('\n').map((l) => l.trim()).filter(Boolean) : [])];
  if (!quotes.length) die('quotes needs --quote TEXT or --quotes-file FILE');
  const source = read(o.source);
  const { checkQuotes } = await lib('quotes');
  report = checkQuotes(quotes.map((quote, i) => ({ id: String(i + 1), quote, source })));
  section = sections.quotes(report);
  lines = report.verdicts.map((v) => [v.bucket, `“${v.quote}” — ${v.message}`]);
} else if (command === 'figures') {
  if (!o.draft || !o.materials?.length) die('figures needs --draft FILE and --materials FILE');
  const { checkFigures } = await lib('figures');
  report = checkFigures(read(o.draft), o.materials.map(read));
  section = sections.figures(report);
  lines = report.verdicts.map((v) => [v.bucket ?? (v.supported ? 'ok' : 'failed'), `${v.figure.raw} — ${v.message}`]);
} else if (command === 'grounding') {
  if (!o.draft || !o.claims) die('grounding needs --draft FILE and --claims FILE');
  const { checkGrounding } = await lib('grounding');
  const claims = read(o.claims).split('\n').map((t) => t.trim()).filter(Boolean).map((text, i) => ({ ref: i + 1, text }));
  report = checkGrounding(read(o.draft), claims);
  section = sections.grounding(report);
  lines = report.violations.map((v) => ['failed', `${v.line} — ${v.reason}`]);
} else if (command === 'citations') {
  if (!file) die('citations needs a FILE');
  const { createAssay } = await lib('index');
  report = await createAssay({ ...(o.mailto ? { mailto: o.mailto } : {}) }).check(read(file));
  section = sections.citations(report);
  lines = report.verdicts.map((v) => [v.bucket, `${v.citation.authors} (${v.citation.year}) — ${v.message}`]);
} else if (command === 'retractions') {
  if (!file) die('retractions needs a FILE');
  const { createRetractions } = await lib('retractions');
  report = await createRetractions({ ...(o.mailto ? { mailto: o.mailto } : {}) }).check(read(file));
  section = sections.retractions(report);
  lines = report.verdicts.map((v) => [v.bucket, v.message]);
} else if (command === 'legal') {
  if (!file) die('legal needs a FILE');
  // The token is read from the environment, never from an option: an option would be saved in your shell history and visible to other users of the machine.
  const token = process.env.COURTLISTENER_TOKEN;
  if (!token) die('legal needs your CourtListener token in the COURTLISTENER_TOKEN environment variable (not an option, which would be kept in your shell history). Get a free token with an account at https://www.courtlistener.com/, then: export COURTLISTENER_TOKEN=your-token');
  console.error('Sending the text to courtlistener.com to look up its case citations.');
  const { createLegal } = await lib('legal');
  report = await createLegal({ token }).check(read(file));
  section = sections.legal(report);
  lines = report.verdicts.map((v) => [v.bucket, v.message]);
} else if (command === 'links') {
  if (!file) die('links needs a FILE');
  const { createLinkChecker } = await lib('liveness');
  // A link ends at white space or a closing quote or bracket; trailing punctuation and an unmatched ")" belong to the sentence, not the link.
  const trim = (u) => { let x = u.replace(/[.,;:]+$/, ''); while (x.endsWith(')') && x.split(')').length > x.split('(').length) x = x.slice(0, -1).replace(/[.,;:]+$/, ''); return x; };
  const urls = [...new Set((read(file).match(/https?:\/\/[^\s\]>"']+/g) ?? []).map(trim))];
  report = await createLinkChecker().check(urls);
  section = sections.links(report);
  lines = report.verdicts.map((v) => [v.bucket ?? (v.status === 'live' ? 'ok' : 'check'), `${v.url} — ${v.message ?? v.status}`]);
} else die(`unknown check "${command}"\n\n${HELP}`);

if (o.html) { try { writeFileSync(o.html, renderReview([section], { title: `Assay: ${command}`, subtitle: file ?? o.draft ?? o.source ?? '' })); } catch (e) { die(`cannot write ${o.html}: ${e.code ?? e.message}`); } }
if (o.json) console.log(JSON.stringify(report, null, 2));
else {
  console.log(report.summary.text);
  for (const [b, text] of lines) console.log(`  ${MARK[b] ?? '·'} ${text}`);
}
process.exit(report.ok ? 0 : 1);
