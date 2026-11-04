// The counter's rules, kept apart from the Worker so they can be tested without Cloudflare.
// What it stores: running totals of NUMBERS, per check. What it never receives or stores: text, names, addresses, identifiers.
import { BASELINE } from './baseline.mjs';

export const CHECKS = ['citations', 'quotes', 'figures', 'gate', 'grounding', 'values', 'links', 'support', 'retractions', 'legal'];
export const LIMITS = {
  /** The most items one report may claim. */
  perReport: 100_000,
  /** The most one source may add in a day. The counter is self-reported and cannot be verified; this stops one party from running it up. */
  perSourcePerDay: 20_000,
  /** The largest request body, in bytes. A real report is a few hundred. */
  bodyBytes: 4096,
};

const INT = (n) => Number.isInteger(n) && n >= 0 && n <= LIMITS.perReport;
const zero = () => ({ checked: 0, ok: 0, check: 0, failed: 0 });

export function emptyTotals(now = Date.now()) {
  return { since: new Date(now).toISOString().slice(0, 10), updated: null, reports: 0, ...zero(), byCheck: Object.fromEntries(CHECKS.map((c) => [c, zero()])) };
}

/** Reads a report. Anything that is not exactly the documented shape is refused: unknown checks, non-integers, counts that do not add up. */
export function parseReport(text) {
  let body;
  try { body = JSON.parse(text); } catch { return { ok: false, error: 'not JSON' }; }
  if (!body || typeof body !== 'object' || body.v !== 1 || !body.counts || typeof body.counts !== 'object' || Array.isArray(body.counts)) return { ok: false, error: 'not a version 1 report' };
  const names = Object.keys(body.counts);
  if (!names.length || names.length > CHECKS.length) return { ok: false, error: 'no counts' };
  const counts = {};
  let total = 0;
  for (const name of names) {
    if (!CHECKS.includes(name)) return { ok: false, error: `unknown check: ${name.slice(0, 20)}` };
    const c = body.counts[name];
    if (!c || typeof c !== 'object') return { ok: false, error: `bad counts for ${name}` };
    const { checked, ok, check, failed } = c;
    if (![checked, ok, check, failed].every(INT)) return { ok: false, error: `counts for ${name} must be whole numbers` };
    if (ok + check + failed !== checked) return { ok: false, error: `counts for ${name} do not add up` };
    counts[name] = { checked, ok, check, failed };
    total += checked;
  }
  if (total < 1 || total > LIMITS.perReport) return { ok: false, error: 'a report is 1 to 100000 items' };
  return { ok: true, counts, total };
}

export function applyReport(totals, counts, now = Date.now()) {
  for (const [name, c] of Object.entries(counts)) {
    const t = (totals.byCheck[name] ??= zero());
    for (const k of ['checked', 'ok', 'check', 'failed']) { t[k] += c[k]; totals[k] += c[k]; }
  }
  totals.reports += 1;
  totals.updated = new Date(now).toISOString();
  return totals;
}

const sum = (rows) => rows.reduce((a, r) => ({ checked: a.checked + r.checked, ok: a.ok + r.ok, check: a.check + r.check, failed: a.failed + r.failed }), zero());
const rowTotal = (counts) => sum(Object.values(counts));

/** What the public may see: ONE set of totals, made of the project's own documented runs plus what apps have reported, with the parts listed so each can be seen. */
export function publicView(totals, baseline = BASELINE) {
  const own = baseline.map((b) => ({ id: b.id, label: b.label, when: b.when, link: b.link, ...rowTotal(b.counts) }));
  const ownSum = sum(own);
  const apps = { reports: totals.reports, checked: totals.checked, ok: totals.ok, check: totals.check, failed: totals.failed };
  const byCheck = {};
  for (const name of CHECKS) {
    const a = totals.byCheck[name] ?? zero();
    byCheck[name] = baseline.reduce((acc, b) => (b.counts[name] ? sum([acc, b.counts[name]]) : acc), { ...a });
  }
  return {
    since: totals.since, updated: totals.updated,
    checked: ownSum.checked + apps.checked, ok: ownSum.ok + apps.ok, check: ownSum.check + apps.check, failed: ownSum.failed + apps.failed,
    byCheck, sources: own, apps,
    note: 'The totals are the project’s own documented runs plus what apps that chose to take part have reported. Reports are self-reported counts, not verified.',
  };
}

/** A per-source daily allowance, held in memory only. `state` is { day, used: Map }. Returns whether `amount` more is allowed. */
export function allowance(state, key, amount, day) {
  if (state.day !== day) { state.day = day; state.used.clear(); }
  if (state.used.size > 10_000) state.used.clear();
  const used = state.used.get(key) ?? 0;
  if (used + amount > LIMITS.perSourcePerDay) return false;
  state.used.set(key, used + amount);
  return true;
}
