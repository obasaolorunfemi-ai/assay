// Make a blind labelling sheet from a corpus: the citations only, with the builder's own labels and notes removed.
//   node scripts/benchmark-template.mjs [corpus.json] > sheet.json
// Give each independent labeller their own copy and the instructions in docs/benchmark-protocol.md.
import { readFileSync } from 'node:fs';
const corpus = JSON.parse(readFileSync(process.argv[2] ?? new URL('../test/corpus.json', import.meta.url), 'utf8'));
console.log(JSON.stringify(corpus.map((c, i) => ({ id: `c${String(i + 1).padStart(3, '0')}`, tag: c.tag, label: '', note: '' })), null, 2));
