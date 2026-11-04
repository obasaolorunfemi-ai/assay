/* Draft: every check that compares a draft with your own materials, in one call.
   Figures (a number nobody supplied), names (a person, organisation, link or DOI nobody supplied), references (a source nobody
   supplied), and claims (a word that makes a claim about the person that the materials never make). All offline, all
   deterministic, so safe on private text such as a CV. Use the single checks when you want one; use this when you want the
   draft held to all of them, which is what an application tool usually needs. */
import { checkClaims, type ClaimOptions } from './claims.js';
import { checkFigures, type FigureOptions } from './figures.js';
import { checkNames, type NameOptions } from './names.js';
import { checkReferences } from './references.js';
import { scopedSentences, type About } from './scope.js';
import { summarizeBuckets } from './summary.js';
import type { Bucket, Summary } from './types.js';

export interface DraftOptions {
  /** Read only the sentences that speak to or about the reader ("Your experience at…"). For advice that should make no claim about the person. */
  about?: About;
  /** Each check is on unless set to false; pass its options to change it. */
  figures?: boolean | FigureOptions;
  names?: boolean | Omit<NameOptions, 'about'>;
  references?: boolean;
  claims?: boolean | Omit<ClaimOptions, 'about'>;
}

export interface Finding {
  kind: 'figure' | 'name' | 'link' | 'reference' | 'claim';
  /** As written in the draft. */
  text: string;
  message: string;
}

export interface DraftReport {
  /** Everything the materials do not back, in the order the checks run. */
  findings: Finding[];
  summary: Summary;
  /** True when nothing was found. */
  ok: boolean;
}

/** Holds `text` to every check against `materials` (one text, or several). */
export function checkDraft(text: string, materials: string | string[], opts: DraftOptions = {}): DraftReport {
  const findings: Finding[] = [];
  const buckets: Bucket[] = [];
  const scope = opts.about;
  const on = <T,>(v: boolean | T | undefined): v is true | T => v !== false;
  const sub = <T extends object>(v: boolean | T | undefined): T | undefined => (typeof v === 'object' ? v : undefined);

  if (on(opts.figures)) {
    const r = checkFigures(scope ? scopedSentences(text, scope).join('\n') : text, materials, sub<FigureOptions>(opts.figures));
    for (const v of r.verdicts) { buckets.push(v.bucket); if (!v.supported) findings.push({ kind: 'figure', text: v.figure.raw, message: v.message }); }
  }
  if (on(opts.names)) {
    const r = checkNames(text, materials, { ...sub<Omit<NameOptions, 'about'>>(opts.names), ...(scope ? { about: scope } : {}) });
    for (const v of r.verdicts) { buckets.push(v.bucket); if (!v.supported) findings.push({ kind: v.kind, text: v.name, message: v.message }); }
  }
  if (on(opts.references)) {
    const r = checkReferences(text, materials, scope ? { about: scope } : {});
    for (const v of r.verdicts) { buckets.push(v.bucket); if (!v.supported) findings.push({ kind: 'reference', text: v.source, message: v.message }); }
  }
  if (on(opts.claims)) {
    const r = checkClaims(text, materials, { ...sub<Omit<ClaimOptions, 'about'>>(opts.claims), ...(scope ? { about: scope } : {}) });
    for (const v of r.verdicts) { buckets.push(v.bucket); if (!v.supported) findings.push({ kind: 'claim', text: v.term, message: v.message }); }
  }
  // One citation can trip several checks: "(Okafor, 2019)" is a reference, and also a name and a year. Report it once, as the reference.
  const refs = findings.filter((f) => f.kind === 'reference').map((f) => f.text.toLowerCase());
  const covered = (f: Finding) => (f.kind === 'name' || f.kind === 'figure') && refs.some((r) => r.includes(f.text.toLowerCase()));
  const kept = findings.filter((f) => !covered(f));
  findings.length = 0;
  findings.push(...kept);
  const summary = summarizeBuckets(buckets, { label: 'Draft', ok: 'backed by your materials', check: 'to check', failed: 'not backed by your materials', failedTail: ' — check each before using the text.' });
  return { findings, summary, ok: findings.length === 0 };
}
