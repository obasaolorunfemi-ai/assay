// Run after `npm run build`: every public entry point loads from the BUILT package, by the name people will install, and does its job.
import * as root from '@extrafemi-ai/assay';
import * as quotes from '@extrafemi-ai/assay/quotes';
import * as figures from '@extrafemi-ai/assay/figures';
import * as gate from '@extrafemi-ai/assay/gate';
import * as values from '@extrafemi-ai/assay/values';
import * as grounding from '@extrafemi-ai/assay/grounding';
import * as links from '@extrafemi-ai/assay/links';
import * as support from '@extrafemi-ai/assay/support';
import * as legal from '@extrafemi-ai/assay/legal';
import * as retractions from '@extrafemi-ai/assay/retractions';
import * as review from '@extrafemi-ai/assay/review';
import * as loop from '@extrafemi-ai/assay/loop';
import * as tally from '@extrafemi-ai/assay/tally';
import * as share from '@extrafemi-ai/assay/share';
import * as names from '@extrafemi-ai/assay/names';
import * as claims from '@extrafemi-ai/assay/claims';
import * as references from '@extrafemi-ai/assay/references';
import * as draft from '@extrafemi-ai/assay/draft';
import * as own from '@extrafemi-ai/assay/own';

const need = (cond, msg) => { if (!cond) { console.error('SMOKE FAILED:', msg); process.exit(1); } };

need(typeof root.createAssay === 'function' && typeof root.parseCitations === 'function' && typeof root.strip === 'function', 'root exports');
need(root.parseCitations('[Rose, 1985, "Sick individuals and sick populations" — IJE]').length === 1, 'parseCitations');

need(typeof quotes.checkQuote === 'function' && typeof quotes.verifyQuote === 'function' && typeof quotes.checkQuotes === 'function', 'quotes exports');
need(quotes.verifyQuote('Visa sponsorship is available for this role.', 'visa sponsorship is available') === true, 'verifyQuote finds a real quote');
need(quotes.verifyQuote('Visa sponsorship is available for this role.', 'relocation is available for all staff') === false, 'verifyQuote rejects an invented one');

need(typeof names.checkNames === 'function' && typeof names.findUnsupportedNames === 'function', 'names exports');
need(names.findUnsupportedNames('We partnered with the Greenfield Foundation.', 'We built an app.').includes('Greenfield Foundation'), 'names flags an invented organisation');
need(names.findUnsupportedNames('We built an app.', 'We built an app.').length === 0, 'names passes a supported draft');
need(typeof claims.checkClaims === 'function' && claims.findUnsupportedClaims('Led a large team.', 'Managed a team.').join() === 'large', 'claims flags an embellishment and backs "led" with "managed"');
need(typeof references.checkReferences === 'function' && references.findUnsupportedReferences('Studies show this works.', 'We built an app.').length === 1, 'references flags an unnamed appeal');
need(typeof draft.checkDraft === 'function' && draft.checkDraft('We reached 5,000 people at Acme Capital.', 'We built an app.').findings.length >= 2, 'draft holds a draft to figures and names');
need(typeof own.ownMaterials === 'function' && own.ownWorks('Okafor, A. & Bello, B. (2019). Mobile payments and informal merchants in Lagos. Journal of African Finance.').length === 1, 'own reads a reference line');

need(typeof figures.checkFigures === 'function' && typeof figures.evalFormula === 'function' && typeof figures.extractFigures === 'function', 'figures exports');
need(figures.checkFigures('We reached 5,000 people.', 'We trained 40 women.').ok === false, 'checkFigures flags an invented figure');
need(figures.checkFigures('We trained 40 women.', 'We trained 40 women.').ok === true, 'checkFigures passes a supported one');
need(figures.evalFormula('(c3-c7)/c7*100', { c3: 1518, c7: 645 }) > 135, 'evalFormula');

need(typeof gate.createGate === 'function' && typeof gate.summariseRecency === 'function' && gate.rules && gate.defaultPolicy, 'gate exports');
const g = gate.createGate({ rules: [gate.rules.estimatesCausalLegalNeedSpecialist] });
need(g.check([{ text: 'Delays cost traders an estimated $4m.', category: 'loss-estimate', sources: [{ url: 'https://reuters.com/x', date: '2020-01-01' }] }]).ok === false, 'gate drops an under-sourced estimate');
need(g.check([{ text: 'A strike happened.', category: 'event', sources: [{ url: 'https://reuters.com/x', date: '2020-01-01' }] }]).ok === true, 'gate passes an ordinary event');
need(typeof values.createValues === 'function' && typeof values.reconcile === 'function' && values.worldBank && values.imf && typeof values.seededSource === 'function', 'values exports');
const rv = values.reconcile({ value: 19.5e9, unit: 'USD', period: 2023, geo: 'NGA' }, { source: 'World Bank', indicatorId: 'X', unit: 'USD', points: [{ year: 2023, value: 19_549_549_365 }] });
need(rv.state === 'verified', 'reconcile verifies a matching figure');
need(values.reconcile({ value: 19.5e9, unit: 'USD', period: 2024, geo: 'NGA' }, { source: 'World Bank', indicatorId: 'X', unit: 'USD', points: [{ year: 2023, value: 19_549_549_365 }] }).state === 'period-unmatched', 'reconcile will not compare another year');
need(typeof grounding.checkGrounding === 'function' && typeof grounding.stripTags === 'function', 'grounding exports');
need(grounding.checkGrounding('The rate moved to ₦425 in 2023 [[c1]].', [{ ref: 1, text: 'The official rate averaged ₦645.19 in 2023.' }]).ok === false, 'grounding flags a figure that does not match its claim');
need(grounding.checkGrounding('The rate averaged ₦645 in 2023 [[c1]].', [{ ref: 1, text: 'The official rate averaged ₦645.19 in 2023.' }]).ok === true, 'grounding passes a matching figure');
need(typeof links.createLinkChecker === 'function' && typeof links.checkUrl === 'function' && typeof links.isSafeAddress === 'function', 'links exports');
need(links.isSafeAddress('::ffff:7f00:1') === false && links.isSafeAddress('169.254.169.254') === false && links.isSafeAddress('8.8.8.8') === true, 'isSafeAddress');
need(links.checkUrl('http://localhost/').ok === false && links.checkUrl('https://example.com/x').ok === true, 'checkUrl');
const lv = await links.createLinkChecker().checkOne('http://169.254.169.254/latest/meta-data/');
need(lv.status === 'unsafe', 'the link checker refuses the metadata address without a request');
need(typeof support.createSupport === 'function', 'support exports');
const sv = await support.createSupport({ judge: async () => ({ verdict: 'supports', evidence: 'Attendance rose 40% on the previous year' }) }).checkOne('Attendance rose 40%.', 'Attendance rose 40% on the previous year.');
need(sv.status === 'evidence-found' && sv.bucket === 'check', 'support: found evidence is to confirm, never ok by default');
need((await support.createSupport({ judge: async () => ({ verdict: 'supports', evidence: 'It doubled everywhere in the country' }) }).checkOne('It doubled.', 'Attendance rose 40% on the previous year.')).status === 'evidence-invented', 'support: invented evidence fails');
need(typeof legal.createLegal === 'function' && typeof legal.sameCase === 'function', 'legal exports');
need(typeof retractions.createRetractions === 'function' && retractions.doisIn('see https://doi.org/10.1145/3571730.')[0] === '10.1145/3571730', 'retractions exports');
const page = review.renderReview([{ name: 'X', summary: 's', items: [{ bucket: 'failed', title: '<b>t</b>', message: 'm' }] }]);
need(page.includes('&lt;b&gt;') && !page.includes('<script'), 'review escapes and carries no script');
need(typeof loop.improve === 'function' && (await loop.improve({ text: 'ok', check: async () => ({ ok: true, failures: [] }), regenerate: async () => 'x' })).ok === true, 'loop');
const tl = tally.createTally(); tl.add('quotes', quotes.checkQuotes([{ quote: 'an invented quote nobody wrote', source: 'something else entirely' }]));
need(tl.snapshot().failed === 1 && !JSON.stringify(tl.snapshot()).includes('invented'), 'tally counts without keeping text');
need(typeof share.shareTally === 'function' && typeof share.startSharing === 'function' && share.COUNTED_CHECKS.includes('quotes'), 'share exports');
const sent = []; const t2 = tally.createTally(); t2.add('quotes', quotes.checkQuotes([{ quote: 'an invented quote nobody wrote', source: 'something else' }]));
const shared = await share.shareTally(t2, { url: 'https://counter.example/api/count', fetch: async (u, i) => { sent.push(JSON.parse(i.body)); return { ok: true, status: 202 }; } });
need(shared.sent && sent[0].counts.quotes.failed === 1 && !JSON.stringify(sent).includes('invented'), 'share sends counts only');
const a = root.createAssay();
need(['check', 'verify', 'recheck', 'repair', 'health', 'parse'].every((k) => typeof a[k] === 'function'), 'Assay methods');

console.log('smoke ok:', Object.keys(root).length, 'root exports,', Object.keys(quotes).length, 'quotes,', Object.keys(figures).length, 'figures,', Object.keys(gate).length, 'gate');
