/* Claims: does a draft say something about the person that the materials never say, even with no name, figure or link?
   "Led a large team" has no number and no name. Two words in it make claims: "led" (a leadership claim) and "large" (an
   embellishment). This reads a fixed list of the words that carry weight on a CV or in an application and checks each against
   the MATERIALS you supplied:
     embellishments   large, significant, global, award-winning, senior…  (the word itself must be in the materials)
     ownership        led/managed/directed… · founded/launched/established… · won/awarded/shortlisted… · published/authored/patented…
                      (any word of the same kind in the materials supports it: "led" is backed by "managed")
     credentials      PhD, MBA, master's, bachelor's, certified, chartered…  · "decade"
     tools & skills   python, kubernetes, tableau, machine learning… in lower case, where a name check has no capital to read
   Offline, deterministic, and deliberately a list, not a judgement: it cannot tell you a sentence is untrue, only that the
   materials never used the word that carries the claim. It reads no meaning, so "this led to growth" is skipped by hand. */
import { scopedSentences, type About } from './scope.js';
import { summarizeBuckets } from './summary.js';
import type { Bucket, Summary } from './types.js';

export type ClaimKind = 'embellishment' | 'leadership' | 'founding' | 'award' | 'publication' | 'credential' | 'duration' | 'tool';

export interface ClaimOptions {
  /** Read only the sentences that speak to or about the reader. */
  about?: About;
  /** Words to leave out (your own jargon, a word the materials use in another sense). Compared in lower case. */
  ignore?: string[];
  /** Leave the tools and skills list out. */
  tools?: boolean;
}

export interface ClaimVerdict {
  /** As written. */
  term: string;
  kind: ClaimKind;
  supported: boolean;
  bucket: Extract<Bucket, 'ok' | 'failed'>;
  message: string;
}

export interface ClaimReport {
  verdicts: ClaimVerdict[];
  summary: Summary;
  ok: boolean;
}

const EMBELLISH = 'large big huge vast significant significantly major substantial substantially numerous extensive extensively global worldwide nationwide leading top-tier top-ranked award-winning world-class flagship high-profile enterprise-scale multi-million multimillion record-breaking unprecedented dramatically exceptional outstanding renowned prestigious senior executive c-suite';
const GROUPS: { kind: ClaimKind; words: string }[] = [
  { kind: 'leadership', words: 'led lead leads leading managed manage manages managing directed direct directs headed head heads oversaw oversee oversees supervised supervise supervises spearheaded spearhead chaired chair owned ran run runs' },
  { kind: 'founding', words: 'founded found cofounded co-founded established establish launched launch pioneered pioneer started start created create' },
  { kind: 'award', words: 'won win awarded award winner recognised recognized honoured honored shortlisted nominated finalist' },
  { kind: 'publication', words: 'published publish authored author co-authored coauthored patented patent' },
  { kind: 'credential', words: 'phd doctorate doctoral dphil' },
  { kind: 'credential', words: 'mba' },
  { kind: 'credential', words: 'msc masters master mphil' },
  { kind: 'credential', words: 'bsc bachelor bachelors' },
  { kind: 'credential', words: 'certified certification certificate licensed licenced chartered' },
  { kind: 'duration', words: 'decade decades' },
];
const TOOLS = 'python javascript typescript java kotlin swift golang rust ruby php sql nosql postgres postgresql mysql mongodb redis kafka spark hadoop airflow dbt snowflake bigquery aws azure gcp docker kubernetes terraform ansible jenkins git github gitlab linux react angular vue node nodejs django flask spring rails tensorflow pytorch scikit pandas numpy excel tableau powerbi looker salesforce hubspot jira figma sketch photoshop illustrator sap oracle agile scrum kanban prince2 pmp devops llm nlp';
const TOOL_PHRASES = ['machine learning', 'deep learning', 'six sigma', 'power bi', 'data science', 'natural language processing', 'computer vision', 'project management'];

const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const words = (s: string) => [...s.matchAll(TOKEN)].map((m) => m[0].toLowerCase().replace(/['’]s$/, ''));

/** "Led to", "lead time", "lead generation": not a claim about leading anyone. */
const NOT_LEADING = new Set(['to', 'by', 'time', 'times', 'generation', 'gen', 'magnet', 'magnets', 'in', 'into']);
/** "A leading provider" is an embellishment; "leading a team" is a verb. */
const DETERMINERS = new Set(['a', 'an', 'the', 'our', 'as', 'of', 'one']);

interface Entry { kind: ClaimKind; members: Set<string> }
const entries = (tools: boolean): Entry[] => {
  const out: Entry[] = EMBELLISH.split(' ').map((w) => ({ kind: 'embellishment' as const, members: new Set([w]) }));
  for (const g of GROUPS) out.push({ kind: g.kind, members: new Set(g.words.split(' ')) });
  if (tools) for (const w of TOOLS.split(' ')) out.push({ kind: 'tool', members: new Set([w]) });
  return out;
};

const MESSAGES: Record<ClaimKind, string> = {
  embellishment: 'This word makes the claim bigger, and your materials never use it.',
  leadership: 'Says you led or managed something. Nothing in your materials uses a word like that.',
  founding: 'Says you founded or launched something. Nothing in your materials uses a word like that.',
  award: 'Says you won or were recognised. Nothing in your materials says so.',
  publication: 'Says you published or patented something. Nothing in your materials says so.',
  credential: 'Names a qualification your materials do not mention.',
  duration: 'Says "decade", which your materials never do.',
  tool: 'Names a tool or skill your materials do not mention.',
};

/** Each claim-bearing word in `text`, judged against `materials` (one text, or several). */
export function checkClaims(text: string, materials: string | string[], opts: ClaimOptions = {}): ClaimReport {
  const joined = (Array.isArray(materials) ? materials : [materials]).join('\n');
  const have = new Set(words(joined));
  const lowerJoined = joined.toLowerCase();
  const list = entries(opts.tools !== false);
  const skip = new Set((opts.ignore ?? []).map((w) => w.toLowerCase()));
  const lookup = new Map<string, Entry>();
  for (const e of list) for (const m of e.members) if (!lookup.has(m)) lookup.set(m, e);
  const backed = (e: Entry) => [...e.members].some((m) => have.has(m)) || (e.kind === 'tool' && [...e.members].some((m) => lowerJoined.includes(m)));
  const verdicts: ClaimVerdict[] = [];
  const done = new Set<Entry | string>();
  const push = (key: Entry | string, term: string, kind: ClaimKind, supported: boolean) => {
    if (done.has(key)) return;
    done.add(key);
    verdicts.push({ term, kind, supported, bucket: supported ? 'ok' : 'failed', message: supported ? 'This is in your materials.' : MESSAGES[kind] });
  };

  for (const sentence of scopedSentences(text, opts.about)) {
    const toks = words(sentence);
    const lowerSentence = sentence.toLowerCase();
    toks.forEach((w, i) => {
      if (skip.has(w)) return;
      const e = lookup.get(w);
      if (!e) return;
      const next = toks[i + 1] ?? '';
      const prev = toks[i - 1] ?? '';
      if ((w === 'led' || w === 'lead' || w === 'leads') && NOT_LEADING.has(next)) return;
      if (w === 'leading') {
        if (DETERMINERS.has(prev)) { push('leading', w, 'embellishment', have.has('leading')); return; }
        if (NOT_LEADING.has(next)) return;
        const verb = list.find((x) => x.kind === 'leadership');
        if (verb) { push(verb, w, 'leadership', backed(verb)); return; }
      }
      push(e, w, e.kind, backed(e));
    });
    for (const phrase of TOOL_PHRASES) {
      if (opts.tools === false || !lowerSentence.includes(phrase)) continue;
      push(phrase, phrase, 'tool', lowerJoined.includes(phrase));
    }
  }
  const summary = summarizeBuckets(verdicts.map((v) => v.bucket), { label: 'Claims', ok: 'in your materials', check: 'to check', failed: 'not in your materials', failedTail: ' — the materials never use the word that makes the claim.' });
  return { verdicts, summary, ok: summary.failed === 0 };
}

/** The claim-bearing words in `text` that `materials` never use, as written, once each. */
export function findUnsupportedClaims(text: string, materials: string | string[], opts: ClaimOptions = {}): string[] {
  return checkClaims(text, materials, opts).verdicts.filter((v) => !v.supported).map((v) => v.term);
}
