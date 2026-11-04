// Builds the Assay site into site/public. Every example on the home page is produced here by running the real library
// (dist/), and the long pages are rendered from the repository's own README, SECURITY and CHANGELOG, so the site cannot drift from the code.
//   npm run build && node site/build.mjs        (or: npm run site)
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

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
  checks: ['/checks/', 'The checks'],
  try: ['/try/', 'Try it'],
  heal: ['/self-healing/', 'Self-healing'],
  limits: ['/limits/', 'Limits'],
  security: ['/security/', 'Security'],
  changelog: ['/changelog/', 'Changelog'],
};
const NAV = ['checks', 'try', 'heal', 'limits', 'security', 'changelog'];
const THEME_BTN = '<button type="button" class="icon-btn" id="theme" aria-label="Switch to dark mode"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg></button>';
const MENU_BTN = '<button type="button" class="icon-btn menu-btn" id="menu" aria-expanded="false" aria-controls="sections" aria-label="Open menu"><svg class="i-open" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg><svg class="i-close" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
const sitebar = (key) => `<div class="col sitebar-in"><a class="brand" href="/">Assay</a><nav class="sections" id="sections" aria-label="Site">${NAV.map((k) => `<a href="${PAGES[k][0]}"${k === key ? ' aria-current="page"' : ''}>${PAGES[k][1]}</a>`).join('')}<a href="${GH}">GitHub</a><a href="${NPM}">npm</a></nav>${THEME_BTN}${MENU_BTN}</div>`;
const foot = `<footer class="site-foot"><div class="col"><div class="foot-grid">
<div><h2>The checks</h2><ul>${CHECKS.map(([n]) => `<li><a href="/checks/#${slug(n)}">${n}</a></li>`).join('')}</ul></div>
<div><h2>Read</h2><ul><li><a href="/try/">Try it</a></li><li><a href="/self-healing/">Self-healing</a></li><li><a href="/limits/">Limits</a></li><li><a href="/security/">Security</a></li><li><a href="/changelog/">Changelog</a></li></ul></div>
<div><h2>Project</h2><ul><li><a href="${GH}">GitHub</a></li><li><a href="${NPM}">npm</a></li><li><a href="https://lodestone.extrafemi.com">Lodestone</a>, its sibling</li><li><a href="https://whetstone.extrafemi.com">Whetstone</a>, where it runs</li></ul></div>
</div><p class="foot-note">Assay ${esc(pkg.version)}, MIT. Lodestone keeps the model call working; Assay checks what came back. The examples on this site are produced by running the library when the site is built.</p></div></footer>`;

const sums = createHash('sha256');
for (const f of ['style.css', 'theme.js', 'menu.js', 'demo.js']) sums.update(readFileSync(join(src, f)));
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
const doc = (h1, lede, inner) => `<main class="col page" id="main"><h1>${h1}</h1><p class="lede">${lede}</p><div class="prose">${inner}</div></main>`;

/* ---------- the pages ---------- */
const outputBlock = (o) => `<div class="out ${o.cls}"><strong>${esc(o.head)}</strong><p>${esc(o.text)}</p>${o.cap ? `<p class="cap">${esc(o.cap)}</p>` : ''}</div>`;
const card = (e) => `<article class="card" id="ex-${slug(e.name)}"><h3>${e.name}</h3><p class="tag">compares the text with ${esc(e.against)}</p><p class="what">${esc(e.what)}</p><pre><code>${esc(e.code)}</code></pre>${outputBlock(e.out)}<p class="imp">${esc(`import … from '${importPath(e.sub)}'`)} · ${e.net ? 'uses the network' : 'offline'}</p></article>`;
const netBadge = (n) => `<span class="net ${n ? 'yes' : 'no'}">${n ? 'network' : 'offline'}</span>`;

const home = `<main id="main">
<section class="col hero">
<p class="tag">${esc(pkg.name)} · ${esc(pkg.version)} · MIT · no dependencies</p>
<h1>Catch the invented citation before anyone relies on it.</h1>
<p class="lede">Assay checks AI-written text against evidence: a citation against the public record, a quote against its source, a number against the materials you gave. It is a set of separate checks, and each one says what it compared the text with.</p>
<div class="actions"><span class="install">npm install ${esc(pkg.name)}</span><a class="pill solid" href="/try/">Try the offline checks</a><a class="pill" href="/checks/">Read the checks</a><a class="pill" href="${GH}">GitHub</a></div>
</section>
<section class="band"><div class="col">
<h2>Seven checks, never run together</h2>
<p class="sub">They apply to different things, so each is its own module with its own entry point. Use the ones your scenario needs. The ones that compare against your own material or policy never touch the network, and a test enforces that, so they are safe to run on private text such as a CV.</p>
<div class="table-wrap"><table><thead><tr><th>Check</th><th>Compares the text with</th><th>Network</th><th>Import</th></tr></thead><tbody>
${CHECKS.map(([n, c, net, sub]) => `<tr><td><a href="/checks/#${slug(n)}">${n}</a></td><td>${esc(c)}</td><td>${netBadge(net)}</td><td>${esc(importPath(sub))}</td></tr>`).join('\n')}
</tbody></table></div>
</div></section>
<section class="band"><div class="col">
<h2>What it says when it catches something</h2>
<p class="sub">Each of these ran when this page was built, on the code shown. Every check answers the same way: a verdict for each item in plain words, a one-line summary, and an <em>ok</em> flag.</p>
<div class="cards">${EXAMPLES.map(card).join('\n')}</div>
</div></section>
<section class="band"><div class="col">
<h2>It does not accuse when it could not look</h2>
<p class="sub">The sources are free and shared, and they break. None of that may turn into an accusation against a citation, and none of it should need a person to notice.</p>
<div class="cards">
<article class="card"><h3>A changed reply is an outage</h3><p class="what">A reply that is not the shape a source normally sends, such as an HTML error page or a renamed field, is <em>unavailable</em>. It is never read as "no results".</p></article>
<article class="card"><h3>A source is tested first</h3><p class="what">Before anyone is told "not found", the source is asked for a work that certainly exists. If it cannot find that, its answer is discarded.</p></article>
<article class="card"><h3>A failing source is left alone</h3><p class="what">Three failures, or a Retry-After, and it is not asked for a while. Then one request is let through to see whether it has recovered.</p></article>
<article class="card"><h3>An old answer beats "could not tell"</h3><p class="what">A conclusive result is kept for a week, and returned marked stale if the sources are down when it expires.</p></article>
</div>
<p class="actions"><a class="pill" href="/self-healing/">How self-healing works</a><a class="pill" href="/limits/">What it cannot do</a></p>
</div></section>
<section class="band"><div class="col">
<h2>Where it comes from</h2>
<p class="sub">Extracted from <a href="https://whetstone.extrafemi.com">Whetstone</a>, where it runs under every reply, and built to sit next to <a href="https://lodestone.extrafemi.com">Lodestone</a>: Lodestone keeps the model call working, Assay checks what came back. It proves a source <em>exists</em>, not that it says what the sentence claims, and the <a href="/limits/">limits page</a> says where it falls short.</p>
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
const checksPage = doc('The checks', 'Seven separate checks. Each compares the text with a different thing, so each has its own entry point.', `${toc}${md(checksOverview.split('\n').filter((l) => l.startsWith('|')).join('\n'))}${checkSections}`);

const healPage = doc('Self-healing', 'How the citation and value checks keep working when the free sources they rely on do not.', md(readme.split('### Self-healing\n')[1].split('\n## ')[0].trim(), { minLevel: 2 }));
const limitsPage = doc('What it cannot do', 'Read this before you trust a green tick.', `${md(section(readme, 'What it cannot do').replace(/^Read this before you trust a green tick\.\n*/, ''))}<h2 id="privacy">Privacy</h2>${md(section(readme, 'Privacy'))}`);
const securityPage = doc('Security', 'Reporting a problem, how the package is published and protected, and what the link checker guarantees.', md(readFileSync(join(root, 'SECURITY.md'), 'utf8')));
const changelogPage = doc('Changelog', 'What changed, release by release.', md(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')));

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
put('', page({ path: '/', key: 'home', title: 'Assay: check AI-written text against evidence', desc: 'Separate checks for citations, quotes, figures, sourcing and links in AI-written text. Each says what it compared against, in plain words. MIT, no dependencies.', body: home, ld: homeLd }));
put('checks', page({ path: '/checks/', key: 'checks', title: 'The checks · Assay', desc: 'Citations, quotes, figures, the source-tier gate, grounding, values and links: what each compares the text with, and how to use it.', body: checksPage }));
put('try', page({ path: '/try/', key: 'try', title: 'Try it · Assay', desc: 'Run the offline checks (quotes, figures, grounding) in your browser. Nothing leaves the page.', body: tryPage, scripts: `\n<script type="module" src="/demo.js?v=${V8}"></script>` }));
put('self-healing', page({ path: '/self-healing/', key: 'heal', title: 'Self-healing · Assay', desc: 'How Assay keeps checking when its free sources throttle, change shape or go down, without turning an outage into an accusation.', body: healPage }));
put('limits', page({ path: '/limits/', key: 'limits', title: 'What it cannot do · Assay', desc: 'Where Assay falls short: it proves a source exists, not that it says what the sentence claims.', body: limitsPage }));
put('security', page({ path: '/security/', key: 'security', title: 'Security · Assay', desc: 'How Assay is published and protected, and what its link checker guarantees against server-side request forgery.', body: securityPage }));
put('changelog', page({ path: '/changelog/', key: 'changelog', title: 'Changelog · Assay', desc: 'What changed in each Assay release.', body: changelogPage }));
put('404', page({ path: '404', key: '', title: 'Not found · Assay', desc: 'Page not found.', body: notFound, noindex: true }));

for (const f of ['style.css', 'theme.js', 'menu.js', 'demo.js', 'favicon.svg', '_headers', 'robots.txt']) copyFileSync(join(src, f), join(out, f));
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

const urls = ['/', '/checks/', '/try/', '/self-healing/', '/limits/', '/security/', '/changelog/'];
writeFileSync(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
writeFileSync(join(out, 'llms.txt'), `# Assay\n\n> Checks AI-written text against evidence. A set of separate checks (citations, quotes, figures, gate, grounding, values, links), each saying what it compared the text with. npm: ${pkg.name}. MIT.\n\n- [The checks](${SITE}/checks/): what each compares against and how to use it\n- [Self-healing](${SITE}/self-healing/): how it avoids accusing when a source is down\n- [Limits](${SITE}/limits/): what it cannot do\n- [Security](${SITE}/security/): publishing, protections, link-checker threat model\n- [Changelog](${SITE}/changelog/)\n- [Source](${GH})\n- [Full text](${SITE}/llms-full.txt)\n`);
writeFileSync(join(out, 'llms-full.txt'), `${readme}\n\n---\n\n${readFileSync(join(root, 'SECURITY.md'), 'utf8')}`);
console.log(`site built: ${urls.length + 1} pages, ${need.size} library files for the browser tools, v=${V8}`);
