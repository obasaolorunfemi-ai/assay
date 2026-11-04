import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The modules that check text against material you supply say they never touch the network, so they are safe on private text (a CV, a draft). Enforce it in the source, so it stays true. */
const OFFLINE = ['quotes', 'figures', 'names', 'scope', 'claims', 'references', 'draft', 'numbers', 'summary', 'gate', 'grounding', 'netguard', 'strutil', 'support', 'review', 'loop', 'escape', 'tally'];
const NETWORK = /\bfetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\bimport\s*\(|require\s*\(|node:(?:http|https|net|dns|tls|dgram)|from\s+['"](?!\.\/)/;

describe('the offline modules', () => {
  for (const name of OFFLINE) {
    it(`${name}.ts has no network access and imports only sibling modules`, () => {
      const src = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(src).not.toMatch(NETWORK);
    });
  }
  it('their sibling imports are only other offline modules (or types)', () => {
    for (const name of OFFLINE) {
      const src = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
      for (const m of src.matchAll(/^import\s+(type\s+)?[^;]*from\s+'\.\/([a-z]+)\.js'/gm)) {
        const isType = !!m[1];
        expect(isType || OFFLINE.includes(m[2]!), `${name}.ts imports ./${m[2]}.js`).toBe(true);
      }
    }
  });
});
