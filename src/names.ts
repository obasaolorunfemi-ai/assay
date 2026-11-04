/* Names: does a draft mention only the people, organisations and sources that your materials mention?
   Checked against the MATERIALS you gave (a CV, a brief, a call for proposals), not against the world: no network, deterministic,
   safe to run on private text. Catches an invented "Greenfield Foundation", "my earlier role at Acme Capital", "the UNESCO report"
   and an invented link, DOI or email address: the credible-sounding detail a model adds when it has nothing real to say.

   It reads capitalised words and acronyms, so a made-up name written in lower case is not caught, and a real name the writer
   simply never put in the materials is flagged (which is the point: someone should check it). It is the companion to figures:
   figures catches an invented number, names catches an invented name. */
import type { Bucket, Summary } from './types.js';
import { summarizeBuckets } from './summary.js';

export interface NameOptions {
  /** Capitalised words that are never names in your text (a greeting, your own jargon). Added to the built-in list; compared in lower case. */
  ignore?: string[];
  /** Also check links, DOIs and email addresses. Default true. */
  links?: boolean;
}

export interface NameVerdict {
  /** As written ("Greenfield Foundation", "https://example.org/x"). */
  name: string;
  kind: 'name' | 'link';
  /** True when every capitalised word of the name (or the whole link) is in the materials. */
  supported: boolean;
  bucket: Extract<Bucket, 'ok' | 'failed'>;
  message: string;
}

export interface NameReport {
  /** One per distinct name or link. */
  verdicts: NameVerdict[];
  summary: Summary;
  /** True when every name and link is in the materials. */
  ok: boolean;
}

const STOP = new Set((
  'i i\'m i\'ve i\'d i\'ll we we\'re we\'ve my our me us the a an in on at as by for with from to of and but or if when while so yet ' +
  'this that these those it its he she they their there here what why how who where which after before during over under through across since until within without ' +
  'dear sincerely regards best kind yours faithfully thank thanks hello hi mr ms mrs dr sir madam hiring manager team cv resume ' +
  'january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday ' +
  'also however therefore moreover additionally furthermore overall finally first second third one two three ' +
  'her his him hers theirs you your yours mine each every some any many most several all no both another other such'
).split(' '));

/** Verbs and adverbs that start CV lines, so a capital there is grammar, not a name ("Built Oneremit Payments", "Previously Head of Business"). -ed, -ing and -ly words, plus verbs that end otherwise. */
const IRREGULAR_VERBS = new Set('built led ran grew drove won made wrote taught sold began took held spent brought oversaw cut set put got gave found kept met paid sent shaped spoke stood thought understood saw'.split(' '));
const verbLike = (w: string) => /(?:ed|ing|ly)$/i.test(w) || IRREGULAR_VERBS.has(w.toLowerCase());

/** Words that may sit inside a name without being part of what is checked ("Bank of America"). */
const CONNECT = new Set(['of', 'de', 'da', 'del', 'van', 'von', 'bin', 'al', 'the', 'for']);
const SPLIT = new Set(['and', '&']);

const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}'’-]*|&/gu;
// Bounded on purpose: an unbounded `[\w.+-]+@` is quadratic on a long run of word characters (see test/redos.test.ts).
const LINK = /(?:https?:\/\/|www\.)[^\s<>"')\]]{1,2000}|\b10\.\d{4,9}\/[^\s<>"')\]]{1,2000}|[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/gi;

const clean = (w: string) => w.replace(/['’]s$/i, '').replace(/^['’-]+|['’-]+$/g, '');
const isCap = (w: string) => /^\p{Lu}/u.test(w);
const isAcronym = (w: string) => /^\p{Lu}[\p{Lu}\p{N}-]+$/u.test(clean(w));
const canonLink = (l: string) => l.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[.,;:!?)\]]+$/, '').replace(/\/+$/, '');
const trimLink = (l: string) => l.replace(/[.,;:!?)\]]+$/, '');

/** The same word, allowing a plural or a short ending: "Nigeria" and "Nigerian", "founder" and "founders". */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 5 && l.startsWith(s) && l.length - s.length <= 3;
}

/** The set of words in some text, with an index by first five letters so "is this word (or a close form) there?" stays fast on long materials. */
function wordIndex(text: string) {
  const exact = new Set<string>();
  const byPrefix = new Map<string, string[]>();
  for (const m of text.matchAll(TOKEN)) {
    const w = clean(m[0]).toLowerCase();
    if (!w || exact.has(w)) continue;
    exact.add(w);
    if (w.length >= 5) { const k = w.slice(0, 5); const list = byPrefix.get(k); if (list) list.push(w); else byPrefix.set(k, [w]); }
  }
  return (w: string) => exact.has(w) || (w.length >= 5 && (byPrefix.get(w.slice(0, 5)) ?? []).some((k) => sameWord(k, w)));
}

function sentences(text: string): string[] {
  return text.split(/\n+|(?<=[.!?])\s+(?=[\p{Lu}"“(])/u).map((s) => s.replace(/^\s*(?:[-•*–·]\s+|\d+[.)]\s+)/, '').trim()).filter(Boolean);
}

/** Capitalised runs in one sentence, as lists of their words. */
function runsIn(sentence: string, stop: Set<string>): string[][] {
  const toks = [...sentence.matchAll(TOKEN)].map((m) => m[0]);
  const runs: string[][] = [];
  let cur: string[] = [];
  let pending: string[] = [];
  const flush = () => { if (cur.length) runs.push(cur); cur = []; pending = []; };
  toks.forEach((tok, i) => {
    const w = clean(tok);
    const lower = w.toLowerCase();
    if (SPLIT.has(lower)) { flush(); return; }
    // The first word of a sentence is capitalised by grammar, so it is kept only when it is an acronym, or when it
    // leads straight into another capitalised word and does not read as a verb ("Greenfield Foundation launched…").
    const next = toks[i + 1];
    const leadsName = !!next && isCap(next) && !stop.has(clean(next).toLowerCase()) && !SPLIT.has(next.toLowerCase()) && !verbLike(w);
    const grammar = i === 0 && !isAcronym(tok) && !leadsName;
    if (isCap(tok) && !grammar && !stop.has(lower) && w.length >= 2) {
      if (cur.length && pending.length) cur.push(...pending);
      pending = [];
      cur.push(w);
    } else if (cur.length && CONNECT.has(lower)) {
      pending.push(w);
    } else flush();
  });
  flush();
  return runs;
}

/** Every distinct name and link in `text`, each judged against `materials` (one text, or several). */
export function checkNames(text: string, materials: string | string[], opts: NameOptions = {}): NameReport {
  const joined = (Array.isArray(materials) ? materials : [materials]).join('\n');
  const has = wordIndex(joined);
  const stop = opts.ignore?.length ? new Set([...STOP, ...opts.ignore.map((w) => w.toLowerCase())]) : STOP;
  const verdicts: NameVerdict[] = [];
  const seen = new Set<string>();

  for (const s of sentences(text)) {
    for (const run of runsIn(s, stop)) {
      const caps = run.filter((w) => !CONNECT.has(w.toLowerCase()));
      if (!caps.length) continue;
      const name = run.join(' ');
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const supported = caps.every((w) => has(w.toLowerCase()));
      verdicts.push({
        name, kind: 'name', supported, bucket: supported ? 'ok' : 'failed',
        message: supported ? 'Every word of this name is in your materials.' : 'This name is not in your materials. Check it exists and is yours to claim.',
      });
    }
  }

  if (opts.links !== false) {
    const known = new Set((joined.match(LINK) ?? []).map(canonLink));
    for (const m of text.match(LINK) ?? []) {
      const name = trimLink(m);
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const supported = known.has(canonLink(m));
      verdicts.push({
        name, kind: 'link', supported, bucket: supported ? 'ok' : 'failed',
        message: supported ? 'This link is in your materials.' : 'This link, DOI or address is not in your materials. A source you did not supply is one to check.',
      });
    }
  }

  const summary = summarizeBuckets(verdicts.map((v) => v.bucket), { label: 'Names', ok: 'in your materials', check: 'to check', failed: 'not in your materials', failedTail: ' — check they exist and are yours to claim.' });
  return { verdicts, summary, ok: summary.failed === 0 };
}

/** The names and links in `text` that are not in `materials`, as written, once each. */
export function findUnsupportedNames(text: string, materials: string | string[], opts: NameOptions = {}): string[] {
  return checkNames(text, materials, opts).verdicts.filter((v) => !v.supported).map((v) => v.name);
}
