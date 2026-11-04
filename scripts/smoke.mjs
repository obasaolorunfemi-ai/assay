// Run after `npm run build`: every public entry point loads from the BUILT package, by the name people will install, and does its job.
import * as root from '@extrafemi-ai/assay';
import * as quotes from '@extrafemi-ai/assay/quotes';
import * as figures from '@extrafemi-ai/assay/figures';

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

console.log('smoke ok:', Object.keys(root).length, 'root exports,', Object.keys(quotes).length, 'quotes,', Object.keys(figures).length, 'figures');
