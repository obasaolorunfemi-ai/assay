// Checks the BUILT site for the things that quietly cost visitors and search traffic: titles and descriptions that are missing, duplicated or the wrong length,
// a canonical address that is not the page's own, missing share tags, structured data that does not parse, internal links and anchors that go nowhere,
// assets that do not exist, and a sitemap that disagrees with the pages. Exits 1 and says what is wrong.
//   node site/check.mjs [folder]    (after npm run site; the folder defaults to site/public)
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'public');
const SITE = 'https://assay.extrafemi.com';
const problems = [];
const bad = (page, msg) => problems.push(`${page}: ${msg}`);

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const pages = walk(root).filter((f) => f.endsWith('.html')).map((f) => ({ file: f, path: '/' + relative(root, f).replace(/index\.html$/, '').replace(/\\/g, '/') }));
const html = new Map(pages.map((p) => [p.path, readFileSync(p.file, 'utf8')]));
const idsOf = (h) => new Set([...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const attr = (h, re) => h.match(re)?.[1];

const titles = new Map(), descs = new Map();
for (const { path } of pages) {
  const h = html.get(path);
  const page = path === '/404.html' ? '404' : path;
  const noindex = /<meta name="robots" content="noindex"/.test(h);
  const title = attr(h, /<title>([^<]*)<\/title>/), desc = attr(h, /<meta name="description" content="([^"]*)"/);
  if (!title) bad(page, 'no <title>');
  if (!desc) bad(page, 'no meta description');
  if (!noindex) {
    if (title && (title.length < 15 || title.length > 65)) bad(page, `title is ${title.length} characters (15 to 65): "${title}"`);
    if (desc && (desc.length < 70 || desc.length > 165)) bad(page, `description is ${desc.length} characters (70 to 165)`);
    if (title) (titles.get(title) ?? titles.set(title, []).get(title)).push(page);
    if (desc) (descs.get(desc) ?? descs.set(desc, []).get(desc)).push(page);
    const canon = attr(h, /<link rel="canonical" href="([^"]*)"/);
    if (canon !== SITE + path) bad(page, `canonical is ${canon}, expected ${SITE + path}`);
    for (const t of ['og:title', 'og:description', 'og:image', 'og:url', 'og:type']) if (!h.includes(`property="${t}"`)) bad(page, `missing ${t}`);
    for (const t of ['twitter:card', 'twitter:image']) if (!h.includes(`name="${t}"`)) bad(page, `missing ${t}`);
    if (!/<html lang="en">/.test(h)) bad(page, 'no lang');
    const h1 = (h.match(/<h1[ >]/g) || []).length;
    if (h1 !== 1) bad(page, `${h1} <h1> elements (want exactly 1)`);
    if (!/<script type="application\/ld\+json">/.test(h)) bad(page, 'no structured data');
  } else if (path !== '/404.html') bad(page, 'is noindex');
  for (const m of h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
    try { const j = JSON.parse(m[1]); if (j['@context'] !== 'https://schema.org') bad(page, 'structured data has no schema.org context'); } catch { bad(page, 'structured data is not valid JSON'); }
  }
  // links, anchors and assets
  for (const m of h.matchAll(/\s(?:href|src)="([^"#?][^"]*|#[^"]*)"/g)) {
    const ref = m[1];
    if (/^(https?:|mailto:|data:)/.test(ref)) continue;
    if (ref.startsWith('#')) { if (ref.length > 1 && !idsOf(h).has(ref.slice(1))) bad(page, `anchor ${ref} has no target on the page`); continue; }
    const [pathPart, hash] = ref.split('#');
    const clean = pathPart.split('?')[0];
    const target = clean.endsWith('/') ? clean : clean;
    const fileOk = existsSync(join(root, clean.endsWith('/') ? clean + 'index.html' : clean)) || (!clean.includes('.') && existsSync(join(root, clean, 'index.html')));
    if (!fileOk) { bad(page, `link ${ref} goes nowhere`); continue; }
    if (hash) { const t = html.get(clean.endsWith('/') ? clean : clean + '/'); if (t && !idsOf(t).has(hash)) bad(page, `link ${ref}: no #${hash} on that page`); }
  }
}
for (const [t, ps] of titles) if (ps.length > 1) bad(ps.join(', '), `share the title "${t}"`);
for (const [d, ps] of descs) if (ps.length > 1) bad(ps.join(', '), 'share a description');


// headers: every path must get exactly ONE Content-Security-Policy. Two matching rules that both set it send two policies, a browser applies both, and the stricter wins:
// the home page's live counter was blocked in production that way once. This reads the _headers file the way Cloudflare matches it (":name" is one segment, "*" is the rest).
{
  const rules = []; let cur = null;
  for (const line of readFileSync(join(root, '_headers'), 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!line.startsWith(' ')) { cur = { pattern: line.trim(), csp: null }; rules.push(cur); }
    else if (cur && /^\s*Content-Security-Policy:/i.test(line)) cur.csp = line.trim();
  }
  const toRe = (p) => new RegExp('^' + p.split('/').map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*'))).join('/') + '$');
  const paths = new Set(['/nope', '/x/y', '/style.css', '/fonts/fonts.css', ...pages.map((p) => p.path)]);
  for (const path of paths) {
    const hits = rules.filter((r) => r.csp && toRe(r.pattern).test(path));
    if (hits.length !== 1) bad('_headers', `${path} gets ${hits.length} Content-Security-Policy headers (want exactly 1)`);
    else {
      const wantSelf = path === '/';
      const hasSelf = /connect-src 'self'/.test(hits[0].csp), hasNone = /connect-src 'none'/.test(hits[0].csp);
      if (wantSelf && !hasSelf) bad('_headers', `${path} must allow connect-src 'self' for the live counter`);
      if (!wantSelf && !hasNone) bad('_headers', `${path} must forbid requests (connect-src 'none')`);
    }
  }
}

// sitemap
const sm = readFileSync(join(root, 'sitemap.xml'), 'utf8');
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const lastmods = [...sm.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
if (lastmods.length !== locs.length || lastmods.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) bad('sitemap.xml', 'every <url> needs a <lastmod> as YYYY-MM-DD');
for (const l of locs) { if (!l.startsWith(SITE + '/')) bad('sitemap.xml', `${l} is not on ${SITE}`); else if (!html.has(l.slice(SITE.length))) bad('sitemap.xml', `${l} is not a page`); }
for (const { path } of pages) if (path !== '/404.html' && !locs.includes(SITE + path)) bad('sitemap.xml', `${path} is missing`);
if (new Set(locs).size !== locs.length) bad('sitemap.xml', 'has duplicate addresses');
const robots = readFileSync(join(root, 'robots.txt'), 'utf8');
if (!robots.includes(`Sitemap: ${SITE}/sitemap.xml`)) bad('robots.txt', 'does not point at the sitemap');
if (!existsSync(join(root, 'assay-share-card-1200x630.png'))) bad('site', 'the share card is missing');

if (problems.length) { console.error(`site check: ${problems.length} problem${problems.length === 1 ? '' : 's'}\n- ` + problems.join('\n- ')); process.exit(1); }
console.log(`site check ok: ${pages.length} pages, ${locs.length} in the sitemap, titles and descriptions unique and sized, share tags and structured data present, no broken internal links`);
