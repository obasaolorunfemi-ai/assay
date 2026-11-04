// Builds the Assay site into site/public. Every example on the home page is produced here by running the real library
// (dist/), and the long pages are rendered from the repository's own README, SECURITY and CHANGELOG, so the site cannot drift from the code.
//   npm run build && node site/build.mjs        (or: npm run site)
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { ILL, animCss } from './illustrations.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'public');
const src = join(here, 'src');
const lib = (f) => import(pathToFileURL(join(root, 'dist', f)).href);
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const SITE = 'https://assay.extrafemi.com';
const GH = 'https://github.com/obasaolorunfemi-ai/assay';
const NPM = 'https://www.npmjs.com/package/@extrafemi-ai/assay';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s) => s.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/* ---------- the seven checks (what each compares with, and whether it touches the network) ---------- */
const CHECKS = [
  ['Citations', 'public records of papers and books: CrossRef, OpenAlex, Open Library, the DOI registries', true, '.'],
  ['Quotes', 'the source text you supply: is this sentence really in it?', false, './quotes'],
  ['Figures', 'the materials you supply: does every number come from them?', false, './figures'],
  ['Gate', 'a policy about sources: is each claim sourced well enough to be stated?', false, './gate'],
  ['Grounding', 'a list of approved claims: does every figure in a draft trace to one, and match it?', false, './grounding'],
  ['Values', "a source's own data (World Bank, IMF, or figures you seeded): does the number match, for that year?", true, './values'],
  ['Links', 'the live web: is the page there? (server-side only)', true, './links'],
];
for (const [name, , , sub] of CHECKS) assert.ok(pkg.exports[sub], `${name}: package.json has no export "${sub}"`);
const importPath = (sub) => (sub === '.' ? pkg.name : `${pkg.name}/${sub.slice(2)}`);

/* ---------- real output: each example runs the library and asserts what it expects, so a wrong claim fails the build ---------- */
const Q = await lib('quotes.js'), F = await lib('figures.js'), G = await lib('gate.js'), GR = await lib('grounding.js');
const V = await lib('values.js'), L = await lib('liveness.js'), A = await lib('index.js');

const posting = 'We offer visa sponsorship for this role. Relocation support is available for senior staff only.';
const quote = Q.checkQuote(posting, 'Relocation is available for all staff');
assert.equal(quote.bucket, 'failed');

const draftF = 'We reached 5,000 beneficiaries, a 40% increase, across three districts.';
const materialsF = 'Our programme worked in three districts, and attendance rose 40% on last year.';
const fig = F.checkFigures(draftF, [materialsF]);
const figBad = fig.verdicts.filter((v) => !v.supported);
assert.equal(figBad.length, 1);

const gate = G.createGate({ rules: [G.rules.estimatesCausalLegalNeedSpecialist] });
const gateRep = gate.check([{ text: 'Delays cost traders an estimated $400m.', category: 'loss-estimate', sources: [{ url: 'https://reuters.com/x', date: '2026-01-01' }] }]);
assert.equal(gateRep.dropped.length, 1);

const gClaims = [{ ref: 1, text: 'The official rate averaged ₦645.19 in 2023.' }];
const gDraft = 'The rate moved to ₦425 in 2023 [[c1]].';
const grounding = GR.checkGrounding(gDraft, gClaims);
assert.equal(grounding.ok, false);

const series = { source: 'World Bank', indicatorId: 'BX.TRF.PWKR.CD.DT', unit: 'USD', points: [{ year: 2023, value: 19549549365 }] };
const vClaim = { value: 25e9, unit: 'USD', period: 2023, geo: 'NGA', subject: 'remittances' };
const val = V.reconcile(vClaim, series);
assert.equal(val.state, 'mismatch');

const linkUrl = 'http://169.254.169.254/latest/meta-data/';
const link = L.checkUrl(linkUrl);
assert.equal(link.ok, false);

const tag = 'Aid weakens accountability [Rose, 1985, "Sick individuals and sick populations" — IJE — https://doi.org/10.1093/ije/14.1.32].';
const cites = A.parseCitations(tag);
assert.equal(cites.length, 1);

const money = (n) => Number(n).toLocaleString('en-US');
const EXAMPLES = [
  {
    name: 'Quotes', against: 'the source text you supply', sub: './quotes', net: false,
    what: 'A model asked for "an exact quote from the posting" can invent one. This asks whether the sentence is really in the text.',
    code: `const posting = "${posting}";\ncheckQuote(posting, 'Relocation is available for all staff');`,
    out: { cls: 'bad', head: `✕ ${quote.status}`, text: quote.message },
  },
  {
    name: 'Figures', against: 'the materials you supply', sub: './figures', net: false,
    what: 'An invented "5,000 beneficiaries" reads as plausible. This finds every number and asks whether you supplied it.',
    code: `const draft = "${draftF}";\nconst brief = "${materialsF}";\ncheckFigures(draft, [brief]);`,
    out: { cls: 'bad', head: fig.summary.text, text: figBad.map((v) => v.message).join(' ') },
  },
  {
    name: 'Gate', against: 'a policy about sources', sub: './gate', net: false,
    what: 'Is a claim sourced well enough to be stated? It judges how a claim is sourced, never whether it is true. No model, no network.',
    code: `createGate({ rules: [rules.estimatesCausalLegalNeedSpecialist] }).check([{\n  text: 'Delays cost traders an estimated $400m.',\n  category: 'loss-estimate',\n  sources: [{ url: 'https://reuters.com/x', date: '2026-01-01' }],\n}]);`,
    out: { cls: 'bad', head: `✕ dropped`, text: gateRep.dropped[0].reason },
  },
  {
    name: 'Grounding', against: 'a list of approved claims', sub: './grounding', net: false,
    what: 'A model that tags its own sentence [[c1]] has proved nothing until something checks that c1 exists and says the same number.',
    code: `const claims = [{ ref: 1, text: 'The official rate averaged ₦645.19 in 2023.' }];\ncheckGrounding('${gDraft}', claims);`,
    out: { cls: 'bad', head: grounding.summary.text, text: `${grounding.violations[0].code}: ${grounding.violations[0].reason}` },
  },
  {
    name: 'Values', against: "a source's own data", sub: './values', net: true,
    what: 'A citation can be real and still state the wrong year. reconcile() is the comparison, with no request: give it a claim and a series.',
    code: `reconcile(\n  { value: 25e9, unit: 'USD', period: 2023, geo: 'NGA', subject: 'remittances' },\n  { source: 'World Bank', indicatorId: 'BX.TRF.PWKR.CD.DT', unit: 'USD',\n    points: [{ year: 2023, value: 19549549365 }] },\n);`,
    out: { cls: 'bad', head: `✕ ${val.state}`, text: val.message },
  },
  {
    name: 'Links', against: 'the live web', sub: './links', net: true,
    what: 'Is the page there? Server-side only, because it fetches addresses that came out of AI text. A crafted link must never reach your own network.',
    code: `checkUrl('${linkUrl}');`,
    out: { cls: 'warn', head: 'refused without a request', text: `The address is refused: ${link.reason}.` },
  },
  {
    name: 'Citations', against: 'public records of papers and books', sub: '.', net: true,
    what: 'The lookup needs the network, so this page does not run it. This is what is read from a tag before CrossRef, OpenAlex or the DOI registry is asked.',
    code: `parseCitations('${tag.replace(/'/g, "\\'")}');`,
    out: { cls: 'good', head: `${cites.length} citation read`, text: `Author ${cites[0].authors}, ${cites[0].year}, titled “${cites[0].title}”, in ${cites[0].venue}, with a ${cites[0].tier === 'link' ? 'link to check' : cites[0].tier}.`, cap: 'Then each source is asked for the work, and the verdict says what was found.' },
  },
];

/* ---------- markdown from the repository's own files ---------- */
const hrefOf = (h) => {
  if (h === 'SECURITY.md') return '/security/';
  if (h === 'CHANGELOG.md') return '/changelog/';
  return /^(https?:\/\/|\/|#)/.test(h) ? h : '#';
};
function inline(s) {
  const codes = [];
  let t = esc(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, href) => `<a href="${hrefOf(href.replace(/&amp;/g, '&'))}">${txt}</a>`);
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}
function md(text, { minLevel = 2 } = {}) {
  const lines = text.replace(/\r/g, '').split('\n');
  const html = [];
  let para = [], list = null;
  const flush = () => {
    if (para.length) { html.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
    if (list) { html.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i.join(' '))}</li>`).join('')}</${list.tag}>`); list = null; }
  };
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l)) {
      flush();
      const body = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      html.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
    } else if (/^\|/.test(l) && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1] || '')) {
      flush();
      const head = cells(l); i += 2;
      const rows = [];
      for (; i < lines.length && /^\|/.test(lines[i]); i++) rows.push(cells(lines[i]));
      i--;
      html.push(`<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (/^#{1,6}\s/.test(l)) {
      flush();
      const m = l.match(/^(#+)\s+(.*)$/);
      if (m[1].length === 1) continue;
      const n = Math.min(Math.max(m[1].length - 2 + minLevel, minLevel), 4);
      html.push(`<h${n} id="${slug(m[2])}">${inline(m[2])}</h${n}>`);
    } else if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const tag = /^\s*\d+\./.test(l) ? 'ol' : 'ul';
      if (para.length) flush();
      if (list && list.tag !== tag) flush();
      if (!list) list = { tag, items: [] };
      list.items.push([l.replace(/^\s*([-*]|\d+\.)\s+/, '')]);
    } else if (/^\s+\S/.test(l) && list) {
      list.items[list.items.length - 1].push(l.trim());
    } else if (!l.trim()) {
      flush();
    } else {
      if (list) flush();
      para.push(l.trim());
    }
  }
  flush();
  return html.join('\n');
}
/** The text under a heading of the given level, up to the next heading of that level or higher. */
function section(text, heading, level = 2) {
  const mark = '#'.repeat(level) + ' ';
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === mark + heading);
  assert.ok(start >= 0, `README has no "${mark}${heading}"`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^#{1,6} /.test(lines[i]) && lines[i].match(/^#+/)[0].length <= level) { end = i; break; }
  return lines.slice(start + 1, end).join('\n').trim();
}
const dropSub = (text, heading) => {
  const mark = '### ' + heading;
  const lines = text.split('\n');
  const s = lines.findIndex((l) => l === mark);
  assert.ok(s >= 0, `no ${mark}`);
  let e = lines.length;
  for (let i = s + 1; i < lines.length; i++) if (/^#{1,3} /.test(lines[i])) { e = i; break; }
  return [...lines.slice(0, s), ...lines.slice(e)].join('\n');
};

/* ---------- page furniture ---------- */
const PAGES = {
  home: ['/', 'Home'],
  cases: ['/cases/', 'Cases'],
  try: ['/try/', 'Try it'],
  start: ['/start/', 'Get started'],
  checks: ['/checks/', 'Reference'],
  paper: ['/paper/', 'Technical paper'],
  heal: ['/self-healing/', 'Self-healing'],
  limits: ['/limits/', 'Limits'],
  security: ['/security/', 'Security'],
  changelog: ['/changelog/', 'Changelog'],
};
const NAV = ['cases', 'try', 'start', 'checks', 'paper'];
const PAPER = ['heal', 'limits', 'security', 'changelog'];
const THEME_BTN = '<button type="button" class="icon-btn" id="theme" aria-label="Switch to dark mode"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg></button>';
const MENU_BTN = '<button type="button" class="icon-btn menu-btn" id="menu" aria-expanded="false" aria-controls="sections" aria-label="Open menu"><svg class="i-open" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg><svg class="i-close" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
const sitebar = (key) => `<div class="col sitebar-in"><a class="brand" href="/">Assay</a><nav class="sections" id="sections" aria-label="Site">${NAV.map((k) => `<a href="${PAGES[k][0]}"${k === key || (k === 'paper' && PAPER.includes(key)) ? ' aria-current="page"' : ''}>${PAGES[k][1]}</a>`).join('')}<a href="${GH}">GitHub</a><a href="${NPM}">npm</a></nav>${THEME_BTN}${MENU_BTN}</div>`;
const foot = `<footer class="site-foot"><div class="col"><div class="foot-grid">
<div><h2>Use it</h2><ul><li><a href="/cases/">When AI made things up</a></li><li><a href="/try/">Try it in your browser</a></li><li><a href="/start/">Get started</a></li><li><a href="/checks/">Reference</a></li></ul></div>
<div><h2>Technical paper</h2><ul><li><a href="/paper/">Overview</a></li><li><a href="/self-healing/">Self-healing</a></li><li><a href="/limits/">Limits</a></li><li><a href="/security/">Security</a></li><li><a href="/changelog/">Changelog</a></li></ul></div>
<div><h2>Project</h2><ul><li><a href="${GH}">GitHub</a></li><li><a href="${NPM}">npm</a></li><li><a href="https://lodestone.extrafemi.com">Lodestone</a>, its sibling</li></ul></div>
</div><p class="foot-note">Assay ${esc(pkg.version)}, free and open source (MIT). Lodestone keeps the AI call working; Assay checks what came back. The examples on this site are produced by running the library when the site is built.</p></div></footer>`;

const sums = createHash('sha256');
for (const f of ['style.css', 'theme.js', 'menu.js', 'demo.js', 'anim.js']) sums.update(readFileSync(join(src, f)));
sums.update(animCss);
const V8 = sums.digest('hex').slice(0, 8);

function page({ path, key, title, desc, body, scripts = '', noindex = false, ld = '' }) {
  const url = `${SITE}${path === '404' ? '/' : path}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#faf9f5" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#141413" media="(prefers-color-scheme: dark)">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website"><meta property="og:url" content="${url}"><meta property="og:site_name" content="Assay">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}">
<meta name="robots" content="${noindex ? 'noindex' : 'index,follow,max-image-preview:large'}">
${ld}<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/newsreader-latin-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/inter-latin-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fonts/fonts.css">
<link rel="stylesheet" href="/style.css?v=${V8}">
<script src="/theme.js?v=${V8}"></script>
<script src="/menu.js?v=${V8}" defer></script>${scripts}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="sitebar">${sitebar(key)}</header>
${body}
${foot}
</body>
</html>
`;
}
const doc = (h1, lede, inner, kicker = '') => `<main class="col page" id="main">${kicker ? `<p class="tag"><a href="/paper/">Technical paper</a> · ${kicker}</p>` : ''}<h1>${h1}</h1><p class="lede">${lede}</p><div class="prose">${inner}</div></main>`;

/* ---------- the pages ---------- */
const outputBlock = (o) => `<div class="out ${o.cls}"><strong>${esc(o.head)}</strong><p>${esc(o.text)}</p>${o.cap ? `<p class="cap">${esc(o.cap)}</p>` : ''}</div>`;

const story = (e, title, said) => `<article class="card" id="ex-${slug(e.name)}"><h3>${title}</h3><p class="what">${said}</p><div class="out ${e.out.cls}"><strong>Assay says</strong><p>${esc(e.out.text.replace(/^[a-z]+(-[a-z]+)+: /, '').replace(/^[a-z]/, (c) => c.toUpperCase()))}</p></div><details><summary>Show the code</summary><pre><code>${esc(e.code)}</code></pre><p class="imp">${esc(`import … from '${importPath(e.sub)}'`)}</p></details></article>`;
const ex = (n) => EXAMPLES.find((e) => e.name === n);
const CHECK_CARDS = [
  ['citations', 'Citations', 'Is this paper real?', 'Assay looks each citation up in public records of papers and books, and says found, look again, or not found. It also checks that the link points to that paper.', 'Looks it up online'],
  ['quotes', 'Quotes', 'Is this quote really in the source?', 'It searches your source text for the exact sentence. It forgives curly quotes, dashes and capital letters, never different words.', 'Stays on your device'],
  ['figures', 'Figures', 'Did I make up a number?', 'It finds every number in the draft and checks that you supplied the same number in your own materials. “three” matches 3.', 'Stays on your device'],
  ['gate', 'Gate', 'Is this claim sourced well enough to say?', 'Sources are ranked from your own data down to news aggregators. Some claims, like a loss estimate, need a specialist source. With only press coverage behind it, the gate drops the claim.', 'Stays on your device'],
  ['grounding', 'Grounding', 'Does every number trace to a fact I approved?', 'Each line carries a tag naming the approved fact it came from. Assay checks that the fact exists and that the line states the same figure.', 'Stays on your device'],
  ['values', 'Values', 'Is this figure right for that year?', 'It asks the source’s own data, such as the World Bank or the IMF, for that exact year and unit. A nearby year never counts as a match.', 'Looks it up online'],
  ['links', 'Links', 'Does this link work, and is it safe to open?', 'From a server only. It checks the page is there, and refuses addresses that point into your own network without making any request.', 'Makes web requests, server only'],
];
const home = `<main id="main">
<section class="col hero">
<p class="tag">Free and open source · MIT</p>
<h1>AI writes with total confidence. Sometimes it makes things up.</h1>
<p class="lede">Assay reads what the AI wrote and tells you which citations are not real papers, which quotes are not in the source, and which numbers nobody gave it. You decide what to publish.</p>
<div class="actions"><a class="pill solid" href="/try/">Try it now</a><a class="pill" href="/start/">Add it to your app</a></div>
<p class="tag">The checks that use your own text run in your browser and send nothing anywhere.</p>
</section>
<section class="band" id="checks"><div class="col">
<div class="sec-head"><div><h2>Seven checks, each for one job</h2>
<p class="sub">They answer different questions, so each is its own check with its own import. Use the one that fits; they are not meant to run all at once. Each picture loops to show what the check does.</p></div>
<button type="button" class="pill" id="motion" aria-pressed="false">Pause animations</button></div>
<div class="checks">
${CHECK_CARDS.map(([key, name, q, text, net]) => `<article class="check" id="check-${key}"><div class="stage">${ILL[key]}</div><div class="words"><span class="name">${name}</span><h3>${q}</h3><p>${text}</p><span class="where ${net ? 'net' : 'local'}">${net}</span></div></article>`).join('\n')}
</div>
<p class="actions"><a class="pill" href="/checks/">Every option and message, in the reference</a></p>
</div></section>
<section class="band"><div class="col">
<h2>Where AI goes wrong</h2>
<p class="sub">The last four are real runs: Assay checked the text described, when this page was built. Open “Show the code” to see the call.</p>
<div class="cards">
<article class="card"><h3>A paper that does not exist</h3><p class="what">Asked for sources, AI models write convincing ones: a real author with a title they never wrote, or a link that goes to a different paper. In a test of free models, some citations were invented outright.</p><div class="out plain"><strong>What Assay does</strong><p>It looks each citation up in public records of papers and books, and says found, look again, or not found. If a record service is down, it says it could not look. It never calls that “not found”.</p></div></article>
${story(ex('Quotes'), 'A quote nobody wrote', `You asked for an exact quote from a job posting. The AI wrote “Relocation is available for all staff.” The posting says relocation is for senior staff only.`)}
${story(ex('Figures'), 'A number from nowhere', `Your draft says “5,000 beneficiaries”. The brief you gave the AI never mentions that number, but it does mention 40% and three districts.`)}
${story(ex('Grounding'), 'A number tied to the wrong fact', `The AI says the rate moved to ₦425 and tags the line as coming from a fact that says ₦645.19.`)}
${story(ex('Values'), 'The right source, the wrong year', `A draft says Nigerian remittances reached $25 billion in 2023. The World Bank figure for that year is about $19.5 billion.`)}
</div>
<p class="actions"><a class="pill" href="/cases/">These are small. Read the cases that cost real money</a></p>
</div></section>
<section class="band"><div class="col">
<h2>Why a red mark is worth believing</h2>
<div class="cards">
<article class="card"><h3>It says what it compared against</h3><p class="what">Every result names the thing it checked the text with: a public record, your own source text, a list of facts you approved.</p></article>
<article class="card"><h3>It does not accuse when it could not look</h3><p class="what">Free record services get busy or break. When that happens Assay says “could not check”, and tries again later. It keeps earlier answers and uses them, marked as old, until the service is back.</p></article>
<article class="card"><h3>It is honest about its limits</h3><p class="what">It can show that a source exists, not that the source says what the sentence claims. Books and reports are thinly covered, so a real work can come back as not found. <a href="/limits/">Read the limits.</a></p></article>
</div>
</div></section>
<section class="band"><div class="col">
<h2>Add it to your app in a minute</h2>
<p class="sub">For developers. It is a small package with no dependencies that runs on Node 20 or later, in browsers and on Cloudflare Workers.</p>
<pre><code>npm install ${esc(pkg.name)}</code></pre>
<p class="actions"><a class="pill solid" href="/start/">Get started</a><a class="pill" href="/checks/">Reference</a><a class="pill" href="/paper/">Technical paper</a></p>
</div></section>
</main>`;

const homeLd = `<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebSite', '@id': `${SITE}/#site`, url: `${SITE}/`, name: 'Assay', description: 'Checks AI-written text against evidence.', inLanguage: 'en' },
    { '@type': 'SoftwareSourceCode', '@id': `${SITE}/#code`, name: 'Assay', codeRepository: GH, programmingLanguage: 'TypeScript', license: 'https://opensource.org/license/mit', description: pkg.description },
  ],
}).replace(/</g, '\\u003c')}</script>\n`;

const checksOverview = readme.split('\n## ')[0];
const checkSections = CHECKS.map(([n]) => {
  let body = section(readme, n);
  if (n === 'Citations') body += '\n\n### Use\n' + dropSub(section(readme, 'Use'), 'Self-healing');
  return `<h2 id="${slug(n)}">${n}</h2>\n${md(body, { minLevel: 2 })}`;
}).join('\n');
const toc = `<ul class="toc">${CHECKS.map(([n]) => `<li><a href="#${slug(n)}">${n}</a></li>`).join('')}</ul>`;
const checksPage = doc('Reference', 'Every check, with its options, statuses and messages. Seven separate checks: each compares the text with a different thing, so each has its own entry point.', `${toc}${md(checksOverview.split('\n').filter((l) => l.startsWith('|')).join('\n'))}${checkSections}`);

const healPage = doc('Self-healing', 'How the citation and value checks keep working when the free sources they rely on do not.', md(readme.split('### Self-healing\n')[1].split('\n## ')[0].trim(), { minLevel: 2 }), 'how it keeps working');
const limitsPage = doc('What it cannot do', 'Read this before you trust a green tick.', `${md(section(readme, 'What it cannot do').replace(/^Read this before you trust a green tick\.\n*/, ''))}<h2 id="privacy">Privacy</h2>${md(section(readme, 'Privacy'))}`, 'what it cannot do');
const securityPage = doc('Security', 'Reporting a problem, how the package is published and protected, and what the link checker guarantees.', md(readFileSync(join(root, 'SECURITY.md'), 'utf8')), 'security');
const changelogPage = doc('Changelog', 'What changed, release by release.', md(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')), 'changelog');


const startMd = `## 1. Install

\`\`\`
npm install ${pkg.name}
\`\`\`

## 2. Pick the check that fits

### You ask an AI to write with sources: check the citations

\`\`\`
import { createAssay, strip } from '${pkg.name}';

const assay = createAssay({ mailto: 'you@example.org' });   // lets the record services contact you instead of blocking you
const report = await assay.check(aiText);

report.summary.text;                 // "Citations: 3 · ✓ 2 verified · ✕ 1 not verified"
report.ok;                           // false if any citation failed
const clean = strip(aiText, report); // failed citations become "[citation removed: could not be verified]"
\`\`\`

### You ask an AI to write from your own documents (a CV, a brief, a call): check quotes and numbers

\`\`\`
import { checkQuote } from '${pkg.name}/quotes';
import { checkFigures } from '${pkg.name}/figures';

checkQuote(jobPosting, 'Visa sponsorship is available for this role');   // found, or missing
checkFigures(draft, [cv, brief]).summary.text;                           // "Figures: 3 · ✓ 2 supported · ✕ 1 not in your materials"
\`\`\`

These two never touch the network, so they are safe to run on private text.

### You publish claims that need a good source: use the gate

\`\`\`
import { createGate, rules } from '${pkg.name}/gate';

const gate = createGate({ rules: [rules.estimatesCausalLegalNeedSpecialist] });
gate.check([{ text: 'Delays cost traders an estimated $400m.', category: 'loss-estimate', sources: [{ url: 'https://reuters.com/x', date: '2026-01-01' }] }]);
\`\`\`

### Your draft tags each line with the approved fact it came from: check the grounding

\`\`\`
import { checkGrounding } from '${pkg.name}/grounding';

checkGrounding('The rate moved to ₦425 in 2023 [[c1]].', [{ ref: 1, text: 'The official rate averaged ₦645.19 in 2023.' }]);
\`\`\`

## 3. Show the result

Every check answers the same way: \`ok\`, a one-line \`summary.text\`, and a verdict for each item with a \`message\` in plain words. Messages can contain text that came from the web or from a model, so put them on a page with \`textContent\`, or run \`escapeHtml()\` (exported) first.

## Good to know

- **Browsers and servers.** Citations, quotes, figures, the gate, grounding and values run anywhere with \`fetch\`: Node 20 or later, browsers, Cloudflare Workers. The link checker is server-side only on purpose.
- **Be polite to the free services.** Give \`mailto\` so CrossRef and OpenAlex can reach you. OpenAlex also gives each address a small daily budget; a free key from openalex.org lifts it.
- **Read the limits** before you trust a green tick. [What it cannot do](/limits/).
- **Every option, every status, every message** is in the [reference](/checks/).`;
const startPage = doc('Get started', 'Install it, pick the check that fits, read the verdict.', md(startMd, { minLevel: 2 }));

const paperSrc = readFileSync(join(root, 'docs/paper.md'), 'utf8').replace(/\r/g, '');
const paperTitle = paperSrc.match(/^# (.*)$/m)[1];
const paperStatus = paperSrc.match(/^\*(.*)\*$/m)[1];
const paperBody = paperSrc.replace(/^# .*$/m, '').replace(/^\*.*\*$/m, '').split('\n## Appendices')[0];
const appendices = [['/checks/', 'Reference', 'Every check, option, status and message.'], ['/self-healing/', 'Self-healing', 'The full description of how the network checks keep working when their sources do not.'], ['/limits/', 'What it cannot do', 'The limits, in the README’s own words, and what happens to your data.'], ['/security/', 'Security policy', 'Reporting, publishing, repository protections and the link checker’s guarantees.'], ['/changelog/', 'Changelog', 'What changed, release by release.']];
const paperPage = doc(esc(paperTitle), esc(paperStatus), `${md(paperBody)}<h2 id="appendices">Appendices</h2><ul class="parts">${appendices.map(([h, t, d]) => `<li><a href="${h}">${t}</a><span>${d}</span></li>`).join('')}</ul>`);


/* ---------- the cases page: every figure here was read from a court decision, a tribunal decision, a published study or press reports, and is attributed ---------- */
const CASES = [
  {
    id: 'mata', kind: 'In court', title: 'Mata v. Avianca', when: 'Sanctions order, 22 June 2023', where: 'US District Court, Southern District of New York',
    what: 'Lawyers for a passenger suing an airline filed a brief citing court decisions that did not exist. A chatbot had written them, complete with plausible names and citations. The court found the citations fictitious and, more seriously, that the lawyers kept vouching for them after the court asked about them.',
    cost: 'A $5,000 fine for the lawyers and their firm, an order to write to each judge whose name had been put on a fake opinion, and the passenger’s case dismissed as filed too late.',
    note: 'The dollar figure is small. The reputational cost, and the lesson for every lawyer after them, is not.',
    verdict: ['yes', 'Yes, for the fake citations'], would: 'The legal check (new in 0.4.0) looks every case citation up in CourtListener and catches a real citation attached to the wrong case. It has not yet been run live with a token. What no check fixes is the second failure: standing by a citation after being asked about it.',
    sources: [['Bloomberg Law: Phony ChatGPT brief leads to $5,000 fine', 'https://news.bloomberglaw.com/energy/chatgpt-phony-legal-filing-case-gets-lawyers-a-5-000-fine']],
    cite: 'Mata v. Avianca, Inc., No. 22-cv-1461 (PKC), 678 F. Supp. 3d 443 (S.D.N.Y. 2023).',
  },
  {
    id: 'aircanada', kind: 'To a customer', title: 'Moffatt v. Air Canada', when: 'Decision, 14 February 2024', where: 'Civil Resolution Tribunal of British Columbia',
    what: 'After a family death, a customer asked the airline’s website chatbot about bereavement fares and was told he could claim the discount after travelling. The airline’s actual policy did not allow that. The airline argued the chatbot was a separate entity responsible for its own words. The tribunal rejected that.',
    cost: 'The tribunal found negligent misrepresentation and ordered the difference in fare: $650.88 in damages, about $812 in total with interest and fees. Small money, but the ruling is that a company answers for what its chatbot tells customers.',
    note: 'Secondary reports sometimes call the $812 figure the damages. The damages were $650.88; the total includes interest and tribunal fees.',
    verdict: ['partly', 'Partly'], would: 'The policy was written down on the airline’s own site. Checking each chatbot answer against that approved text, with grounding (every statement traces to an approved fact) or support (a judge you supply, with its evidence verified against the policy), would have flagged a refund rule the policy did not contain. Both need the policy text to be supplied.',
    sources: [['Civil Resolution Tribunal decision, 2024 BCCRT 149', 'https://decisions.civilresolutionbc.ca/crt/crtd/en/525448/1/document.do'], ['Manatt: Airline has to honor a refund policy its chatbot fabricated', 'https://manatt.com/insights/newsletters/advertising-law/ai-gone-wild-airline-has-to-honor-a-refund-policy']],
    cite: 'Moffatt v. Air Canada, 2024 BCCRT 149.',
  },
  {
    id: 'deloitte', kind: 'In a government report', title: 'Deloitte Australia’s review for the Department of Employment and Workplace Relations', when: 'Report commissioned December 2024; refund reported October 2025', where: 'Australia',
    what: 'A report of about A$440,000 on a welfare compliance system contained references to academic works that did not exist and a misquoted federal court judgment, found by an academic reader. A corrected version disclosed that a generative AI tool had been used in producing it.',
    cost: 'The department said the firm agreed to repay the final instalment under the contract. The amount was not officially disclosed; some outlets put it at roughly A$290,000. The firm maintained that the findings of the report were unchanged.',
    note: 'A researcher who raised the alarm argued that some corrections replaced fake references with other doubtful ones, which is exactly what happens when a model is asked to fix its own citations without a check.',
    verdict: ['yes', 'Yes'], would: 'The citations check looks up every reference. The quotes check compares a quotation with the text of the judgment it is attributed to. The repair loop asks the model again, but only keeps a replacement that the checks then verify.',
    sources: [['Malay Mail: Deloitte to pay partial refund to Australian government', 'https://www.malaymail.com/news/world/2025/10/07/deloitte-to-pay-partial-refund-to-australian-govt-for-report-using-ai/193773'], ['TechSpot: Deloitte admits AI hallucinated quotes in government report', 'https://www.techspot.com/news/109758-deloitte-admits-ai-hallucinated-quotes-government-report-offers.html']],
    cite: '',
  },
  {
    id: 'bard', kind: 'At a product launch', title: 'Google’s Bard demonstration', when: '8 February 2023', where: 'Worldwide',
    what: 'A promotional post for Google’s chatbot showed it answering that the James Webb Space Telescope took the first pictures of a planet outside our solar system. The first such pictures were taken by a different telescope in 2004. Reuters pointed out the error.',
    cost: 'Alphabet’s shares fell about 7.7% that day, roughly $100 billion of market value.',
    note: 'The share fall cannot be pinned on the error alone. The same week Microsoft announced a chatbot for its search engine, and investors were also reacting to worries that Google was losing ground. Treat the figure as the size of the reaction, not the price of one mistake.',
    verdict: ['no', 'No, not on its own'], would: 'This was a wrong general-knowledge statement with no source supplied. None of Assay’s checks compare a statement with the world at large. Given a source, such as the telescope’s mission page, the support check could have tested the sentence against it. The honest lesson is that Assay needs something to compare against.',
    sources: [['Global News: Bard chatbot wrong answer, shares plummet', 'https://globalnews.ca/news/9473928/bard-google-ai-chatbot-wrong-answer-shares-plummet/amp'], ['The Week: AI chatbot makes $100bn mistake', 'https://theweek.com/google/959623/googles-bard-ai-chatbot-makes-100bn-mistake']],
    cite: '',
  },
];
const STUDIES = [
  ['Walters and Wilder (2023)', 'Asked to write short literature reviews on 42 topics, ChatGPT-3.5 and ChatGPT-4 produced 636 citations. 55% of the GPT-3.5 citations and 18% of the GPT-4 citations were fabricated, and 43% of the real GPT-3.5 citations and 24% of the real GPT-4 ones had substantive errors.', 'https://doi.org/10.1038/s41598-023-41032-5'],
  ['Dahl, Magesh, Suzgun and Ho (2024)', 'Across public language models asked legal questions, the models hallucinated at least 58% of the time, struggled to predict their own hallucinations, and often accepted users’ incorrect legal assumptions.', 'https://doi.org/10.1093/jla/laae003'],
  ['Magesh and colleagues (2025)', 'Commercial legal research tools that advertise “hallucination-free” citations, tested in a preregistered study, hallucinated between 17% and 33% of the time. Fewer than general chatbots, far from none.', 'https://doi.org/10.1111/jels.12413'],
];
const caseCard = (c) => `<article class="case" id="${c.id}"><p class="tag">${esc(c.kind)} · ${esc(c.when)} · ${esc(c.where)}</p><h2>${esc(c.title)}</h2>
<p>${esc(c.what)}</p><p><strong>What it cost.</strong> ${esc(c.cost)}</p><p class="small">${esc(c.note)}</p>
<div class="verdict ${c.verdict[0]}"><strong>Would Assay have caught it? ${esc(c.verdict[1])}.</strong><p>${esc(c.would)}</p></div>
<p class="small">${c.cite ? `${esc(c.cite)} ` : ''}Sources: ${c.sources.map(([t, u]) => `<a href="${u}">${esc(t)}</a>`).join('; ')}.</p></article>`;
const casesPage = `<main class="col page" id="main"><h1>When AI made things up</h1>
<p class="lede">Documented cases where text written by a chatbot was wrong in a way that cost someone money or standing. Each one says what happened, what it cost, and, honestly, whether Assay would have caught it.</p>
<div class="prose"><p class="note">These are written from a court decision, a tribunal decision, published studies and press reports, and the figures are as reported there. They are not legal advice. A cost is the sum reported, not a measure of the full harm. Spotted a mistake? Open an issue on <a href="${GH}">GitHub</a>.</p></div>
<div class="cases">${CASES.map(caseCard).join('\n')}</div>
<section class="band"><h2>It is not only a few famous cases</h2>
<div class="prose"><p>Studies that measured it, rather than waiting for it to be reported:</p>
<ul class="parts">${STUDIES.map(([t, d, u]) => `<li><a href="${u}">${esc(t)}</a><span>${esc(d)}</span></li>`).join('')}</ul>
<p>Courts are keeping count too. Damien Charlotin maintains a public database of court decisions in which a judge addressed AI-generated content, mostly invented citations; press coverage in mid-2026 put it above 1,600 entries. It only lists what was caught and reported, so it is a floor. <a href="https://www.damiencharlotin.com/hallucinations/">See the database</a>.</p></div></section>
<section class="band"><h2>What the cases have in common</h2>
<div class="prose"><ul><li><strong>The text looked finished.</strong> Fluent, formatted, confident. Nothing in it said “unchecked”.</li>
<li><strong>The facts were checkable.</strong> A citation either exists or it does not. A refund policy is written down. A quotation is in the document or it is not.</li>
<li><strong>Nobody checked, or someone checked and kept going.</strong> No tool replaces the person who decides. Assay’s job is to put the unchecked things in front of that person, in plain words, before the filing, the report or the launch.</li></ul>
<p class="actions"><a class="pill solid" href="/try/">Try the offline checks</a><a class="pill" href="/#checks">See the seven checks</a><a class="pill" href="/limits/">What Assay cannot do</a></p></div></section>
</main>`;

const tool = (id, title, intro, fields, run) => `<section class="tool" id="${id}"><h2>${title}</h2><p class="sub tight">${intro}</p>${fields}<div class="results" id="${id}-out" aria-live="polite"></div></section>`;
const field = (id, label, value, rows = 4) => `<div><label for="${id}">${label}</label><textarea id="${id}" rows="${rows}" spellcheck="false">${esc(value)}</textarea></div>`;
const tryPage = `<main class="col page" id="main"><h1>Try the offline checks</h1>
<p class="lede">These run in your browser, with the same code as the package. Nothing you type leaves this page: its security policy does not allow it to make a request at all.</p>
<div class="tools" id="tools">
${tool('t-quotes', 'Quotes', 'Is each quote really in the source text? One quote per line.', field('q-source', 'Source text', posting, 4) + field('q-quotes', 'Quotes to check', 'We offer visa sponsorship for this role\nRelocation is available for all staff', 3))}
${tool('t-figures', 'Figures', 'Does every number in the draft appear in the materials you supplied?', field('f-draft', 'Draft', draftF, 3) + field('f-materials', 'Your materials', materialsF, 3))}
${tool('t-grounding', 'Grounding', 'Does each tagged line trace to an approved claim, with the same figure? One claim per line, numbered c1, c2 in order.', field('g-claims', 'Approved claims', gClaims[0].text, 3) + field('g-draft', 'Draft, with [[c1]] tags', gDraft, 3))}
</div>
<p class="note">Citations, values and links are not here because they need the network. The <a href="/checks/">checks page</a> shows how to run each.</p>
<noscript><p class="note">These tools need JavaScript. The code is the same as the package's, and the home page shows real output from it.</p></noscript>
</main>`;

const notFound = `<main class="col notfound" id="main"><span class="tag">404</span><h1>That page isn't here.</h1><p>Try the checks, or go back to the start.</p><div class="actions"><a class="pill solid" href="/">Back to Assay</a><a class="pill" href="/checks/">The checks</a></div></main>`;

/* ---------- write everything ---------- */
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const put = (path, html) => {
  const file = path === '404' ? join(out, '404.html') : join(out, path, 'index.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
};
put('', page({ path: '/', key: 'home', title: 'Assay: catch what AI made up', desc: 'Finds invented citations, quotes that are not in the source, and numbers nobody gave the AI. Free, open source, and the checks on your own text run in your browser.', body: home, ld: homeLd, scripts: `\n<script src="/anim.js?v=${V8}" defer></script>` }));
put('start', page({ path: '/start/', key: 'start', title: 'Get started · Assay', desc: 'Install Assay and run the check that fits: citations, quotes, figures, the source gate or grounding.', body: startPage }));
put('paper', page({ path: '/paper/', key: 'paper', title: 'Technical paper · Assay', desc: 'How Assay works, how it fails and where it stops: design, self-healing, limits, security and changelog.', body: paperPage }));
put('checks', page({ path: '/checks/', key: 'checks', title: 'Reference · Assay', desc: 'Citations, quotes, figures, the source-tier gate, grounding, values and links: what each compares the text with, every option and every status.', body: checksPage }));
put('cases', page({ path: '/cases/', key: 'cases', title: 'When AI made things up · Assay', desc: 'Documented cases where AI-written text was wrong and cost real money or standing, and whether Assay would have caught each one.', body: casesPage }));
put('try', page({ path: '/try/', key: 'try', title: 'Try it · Assay', desc: 'Run the offline checks (quotes, figures, grounding) in your browser. Nothing leaves the page.', body: tryPage, scripts: `\n<script type="module" src="/demo.js?v=${V8}"></script>` }));
put('self-healing', page({ path: '/self-healing/', key: 'heal', title: 'Self-healing · Assay', desc: 'How Assay keeps checking when its free sources throttle, change shape or go down, without turning an outage into an accusation.', body: healPage }));
put('limits', page({ path: '/limits/', key: 'limits', title: 'What it cannot do · Assay', desc: 'Where Assay falls short: it proves a source exists, not that it says what the sentence claims.', body: limitsPage }));
put('security', page({ path: '/security/', key: 'security', title: 'Security · Assay', desc: 'How Assay is published and protected, and what its link checker guarantees against server-side request forgery.', body: securityPage }));
put('changelog', page({ path: '/changelog/', key: 'changelog', title: 'Changelog · Assay', desc: 'What changed in each Assay release.', body: changelogPage }));
put('404', page({ path: '404', key: '', title: 'Not found · Assay', desc: 'Page not found.', body: notFound, noindex: true }));

for (const f of ['theme.js', 'menu.js', 'demo.js', 'anim.js', 'favicon.svg', '_headers', 'robots.txt']) copyFileSync(join(src, f), join(out, f));
writeFileSync(join(out, 'style.css'), readFileSync(join(src, 'style.css'), 'utf8') + '\n' + animCss);
cpSync(join(src, 'fonts'), join(out, 'fonts'), { recursive: true });

// The in-browser tools import the real offline modules. Copy exactly those and what they import.
const need = new Set();
const walk = (f) => {
  if (need.has(f)) return;
  need.add(f);
  const code = readFileSync(join(root, 'dist', f), 'utf8');
  for (const m of code.matchAll(/from '\.\/([^']+\.js)'/g)) walk(m[1]);
};
['quotes.js', 'figures.js', 'grounding.js'].forEach(walk);
for (const f of need) {
  assert.ok(!/(http|netguard|liveness|sources|check|health)\.js$/.test(f), `the browser tools must not pull in ${f}`);
  mkdirSync(join(out, 'lib'), { recursive: true });
  copyFileSync(join(root, 'dist', f), join(out, 'lib', f));
}

const urls = ['/', '/cases/', '/try/', '/start/', '/checks/', '/paper/', '/self-healing/', '/limits/', '/security/', '/changelog/'];
writeFileSync(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
writeFileSync(join(out, 'llms.txt'), `# Assay\n\n> Checks AI-written text against evidence. A set of separate checks (citations, quotes, figures, gate, grounding, values, links), each saying what it compared the text with. npm: ${pkg.name}. MIT.\n\n- [When AI made things up](${SITE}/cases/): documented cases and whether Assay would have caught each\n- [Get started](${SITE}/start/): install and recipes\n- [Reference](${SITE}/checks/): every check, option and status\n- [Self-healing](${SITE}/self-healing/): how it avoids accusing when a source is down\n- [Limits](${SITE}/limits/): what it cannot do\n- [Security](${SITE}/security/): publishing, protections, link-checker threat model\n- [Changelog](${SITE}/changelog/)\n- [Source](${GH})\n- [Full text](${SITE}/llms-full.txt)\n`);
writeFileSync(join(out, 'llms-full.txt'), `${readme}\n\n---\n\n${readFileSync(join(root, 'SECURITY.md'), 'utf8')}`);
console.log(`site built: ${urls.length + 1} pages, ${need.size} library files for the browser tools, v=${V8}`);
