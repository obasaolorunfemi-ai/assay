// Compare label files from two or more independent labellers.
//   node scripts/agreement.mjs labeller-a.json labeller-b.json [labeller-c.json ...]
// Each file is the filled-in sheet from `npm run benchmark:template`: [{ "id": "c01", "tag": "...", "label": "real" | "invented" | "unsure" }].
// Prints raw agreement and Cohen's kappa for every pair, and lists the items to adjudicate (any disagreement, or any "unsure").
import { readFileSync } from 'node:fs';
import { agreement, cohenKappa } from './agreement-lib.mjs';

const files = process.argv.slice(2);
if (files.length < 2) { console.error('usage: node scripts/agreement.mjs a.json b.json [c.json ...]'); process.exit(2); }
const sheets = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
const ids = sheets[0].map((r) => r.id);
for (const [i, s] of sheets.entries()) {
  if (s.length !== ids.length || s.some((r, j) => r.id !== ids[j])) { console.error(`${files[i]} does not have the same items, in the same order, as ${files[0]}`); process.exit(2); }
  const bad = s.filter((r) => !['real', 'invented', 'unsure'].includes(r.label));
  if (bad.length) { console.error(`${files[i]}: ${bad.length} item(s) have no valid label (real, invented or unsure), first: ${bad[0].id}`); process.exit(2); }
}
const labels = sheets.map((s) => s.map((r) => r.label));
for (let i = 0; i < files.length; i++) for (let j = i + 1; j < files.length; j++) {
  console.log(`${files[i]} vs ${files[j]}: agreement ${(agreement(labels[i], labels[j]) * 100).toFixed(1)}%, kappa ${cohenKappa(labels[i], labels[j]).toFixed(2)}`);
}
const adjudicate = ids.filter((_, k) => new Set(labels.map((l) => l[k])).size > 1 || labels.some((l) => l[k] === 'unsure'));
console.log(`\n${adjudicate.length} of ${ids.length} items need adjudication: ${adjudicate.join(', ') || 'none'}`);
