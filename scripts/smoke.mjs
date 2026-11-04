// Run after `npm run build`: every public entry point loads from the BUILT package, by the name people will install, and does its job.
import * as root from '@extrafemi-ai/assay';
import * as quotes from '@extrafemi-ai/assay/quotes';
import * as figures from '@extrafemi-ai/assay/figures';
import * as gate from '@extrafemi-ai/assay/gate';

const need = (cond, msg) => { if (!cond) { console.error('SMOKE FAILED:', msg); process.exit(1); } };

need(typeof root.createAssay === 'function' && typeof root.parseCitations === 'function' && typeof root.strip === 'function', 'root exports');
need(root.parseCitations('[Rose, 1985, "Sick individuals and sick populations" — IJE]').length === 1, 'parseCitations');

need(typeof quotes.checkQuote === 'function' && typeof quotes.verifyQuote === 'function' && typeof quotes.checkQuotes === 'function', 'quotes exports');
need(quotes.verifyQuote('Visa sponsorship is available for this role.', 'visa sponsorship is available') === true, 'verifyQuote finds a real quote');
need(quotes.verifyQuote('Visa sponsorship is available for this role.', 'relocation is available for all staff') === false, 'verifyQuote rejects an invented one');

need(typeof figures.checkFigures === 'function' && typeof figures.evalFormula === 'function' && typeof figures.extractFigures === 'function', 'figures exports');
need(figures.checkFigures('We reached 5,000 people.', 'We trained 40 women.').ok === false, 'checkFigures flags an invented figure');
need(figures.checkFigures('We trained 40 women.', 'We trained 40 women.').ok === true, 'checkFigures passes a supported one');
need(figures.evalFormula('(c3-c7)/c7*100', { c3: 1518, c7: 645 }) > 135, 'evalFormula');

need(typeof gate.createGate === 'function' && typeof gate.summariseRecency === 'function' && gate.rules && gate.defaultPolicy, 'gate exports');
const g = gate.createGate({ rules: [gate.rules.estimatesCausalLegalNeedSpecialist] });
need(g.check([{ text: 'Delays cost traders an estimated $4m.', category: 'loss-estimate', sources: [{ url: 'https://reuters.com/x', date: '2020-01-01' }] }]).ok === false, 'gate drops an under-sourced estimate');
need(g.check([{ text: 'A strike happened.', category: 'event', sources: [{ url: 'https://reuters.com/x', date: '2020-01-01' }] }]).ok === true, 'gate passes an ordinary event');
const a = root.createAssay();
need(['check', 'verify', 'recheck', 'repair', 'health', 'parse'].every((k) => typeof a[k] === 'function'), 'Assay methods');

console.log('smoke ok:', Object.keys(root).length, 'root exports,', Object.keys(quotes).length, 'quotes,', Object.keys(figures).length, 'figures,', Object.keys(gate).length, 'gate');
