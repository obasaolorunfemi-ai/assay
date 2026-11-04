/**
 * Makes text safe to put inside HTML. A verdict's `message`, a record's `title` and a citation's own fields contain text from
 * the web or from a model, so anything shown in a page goes through this (or through `textContent`). It escapes the five
 * characters that matter in element content and in quoted attributes.
 */
export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
