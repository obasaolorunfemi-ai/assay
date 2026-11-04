/* Small string helpers that run in time proportional to the input, however hostile it is.
   The usual one-liners for trimming (`s.replace(/^[,\s]+|[,\s]+$/g, '')`, `/[.,;]+$/`) are quadratic on a long run of the trimmed characters followed by
   something else, so anything that reads text we did not write uses these instead. */

/** Removes the characters that pass `drop` from both ends. One pass from each end. */
export function trimBy(s: string, drop: (ch: string) => boolean): string {
  let a = 0, b = s.length;
  while (a < b && drop(s[a]!)) a++;
  while (b > a && drop(s[b - 1]!)) b--;
  return s.slice(a, b);
}
/** Removes the characters that pass `drop` from the end only. */
export function trimEndBy(s: string, drop: (ch: string) => boolean): string {
  let b = s.length;
  while (b > 0 && drop(s[b - 1]!)) b--;
  return s.slice(0, b);
}
/** Cuts text to a length that is safe to run the matching rules on. A real author list, title or URL is far shorter than any of these limits. */
export const cap = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);
