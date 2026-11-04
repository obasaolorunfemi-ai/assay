/* The offline tools on /try/: the package's own quotes, figures and grounding modules, run in the page.
   Results are built with textContent only. The page's security policy forbids any request, so nothing typed here can leave it. */
import { checkQuote } from '/lib/quotes.js';
import { checkFigures } from '/lib/figures.js';
import { checkGrounding } from '/lib/grounding.js';

const $ = (id) => document.getElementById(id);
const CLS = { ok: 'good', verified: 'good', check: 'warn', failed: 'bad' };

function out(box, summary, items) {
  box.replaceChildren();
  if (summary) { const p = document.createElement('p'); p.className = 'sumline'; p.textContent = summary; box.append(p); }
  for (const [cls, head, text] of items) {
    const d = document.createElement('div');
    d.className = 'out ' + cls;
    const s = document.createElement('strong'); s.textContent = head;
    const p = document.createElement('p'); p.textContent = text;
    d.append(s, p);
    box.append(d);
  }
}

function quotes() {
  const source = $('q-source').value;
  const list = $('q-quotes').value.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!list.length) return out($('t-quotes-out'), 'Add a quote to check.', []);
  const rows = list.map((q) => ({ q, v: checkQuote(source, q) }));
  const found = rows.filter((r) => r.v.status === 'found').length;
  out($('t-quotes-out'), `Quotes: ${rows.length} · ✓ ${found} found · ✕ ${rows.length - found} not found`, rows.map(({ q, v }) => [CLS[v.bucket] || 'warn', (v.status === 'found' ? '✓ ' : '✕ ') + q, v.message]));
}

function figures() {
  const r = checkFigures($('f-draft').value, [$('f-materials').value]);
  out($('t-figures-out'), r.summary.text, r.verdicts.map((v) => [v.supported ? 'good' : 'bad', (v.supported ? '✓ ' : '✕ ') + v.figure.raw, v.message]));
}

function grounding() {
  const claims = $('g-claims').value.split('\n').map((t) => t.trim()).filter(Boolean).map((text, i) => ({ ref: i + 1, text }));
  const r = checkGrounding($('g-draft').value, claims);
  const items = r.violations.map((v) => ['bad', v.code, v.reason + '\n' + v.line]);
  for (const w of r.warnings || []) items.push(['warn', 'note', w.reason]);
  out($('t-grounding-out'), r.summary.text, items);
}

const wire = (ids, fn) => {
  let t;
  const run = () => { try { fn(); } catch (e) { out($(ids[0] + '-out'), 'Could not check that text.', []); } };
  for (const id of ids.slice(1)) $(id).addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 150); });
  run();
};
wire(['t-quotes', 'q-source', 'q-quotes'], quotes);
wire(['t-figures', 'f-draft', 'f-materials'], figures);
wire(['t-grounding', 'g-claims', 'g-draft'], grounding);

/* The picker: one check at a time. Without JavaScript every check is shown, so nothing is hidden from anyone who cannot use the menu. */
(() => {
  const pick = $('pick');
  if (!pick) return;
  const panels = [...document.querySelectorAll('.tool')];
  const show = (id) => { panels.forEach((p) => { p.hidden = p.id !== id; }); if (pick.value !== id) pick.value = id; try { history.replaceState(null, '', '#' + id.slice(2)); } catch (e) { /* the address bar is optional */ } };
  pick.addEventListener('change', () => show(pick.value));
  const fromHash = 't-' + location.hash.slice(1);
  show(panels.some((p) => p.id === fromHash) ? fromHash : pick.value);
})();
