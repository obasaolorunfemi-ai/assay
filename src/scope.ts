/* Which sentences a check reads. Shared by names, sources, claims and draft.
   By default a check reads everything. `about: 'you'` narrows it to sentences that speak to or about the reader
   ("Your experience at…", "As a candidate, you…"): the claims about a person that general advice (interview questions,
   career direction) can still get wrong, without checking every general statement the advice makes. */

export type About = 'you';

/** Sentences of a text: split on new lines and on a full stop followed by a capital. List marks are removed. */
export function sentencesOf(text: string): string[] {
  // A full stop after "et al", "e.g", "Dr" and the like does not end a sentence ("Adeyemi et al. (2021)").
  return text.split(/\n+|(?<=[.!?])(?<!\b(?:al|e\.g|i\.e|vs|Mr|Mrs|Ms|Dr|Prof|Inc|Ltd|St|No|approx|Fig)\.)\s+(?=[\p{Lu}"“(])/u).map((s) => s.replace(/^\s*(?:[-•*–·]\s+|\d+[.)]\s+)/, '').trim()).filter(Boolean);
}

const ABOUT_YOU = /\b(?:you|your|yours|yourself|you're|you've|you'd|you'll|candidate|applicant)\b/i;

/** The sentences a check should read. */
export function scopedSentences(text: string, about?: About): string[] {
  const all = sentencesOf(text);
  return about === 'you' ? all.filter((s) => ABOUT_YOU.test(s)) : all;
}
