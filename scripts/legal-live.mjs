// A live check of the legal module against the real CourtListener service. It needs your token in the environment (never as an option) and sends three short
// citations to courtlistener.com. It asserts what a healthy run must show, and says so plainly if the service answers differently.
//   COURTLISTENER_TOKEN=… npm run legal:live
import { createLegal } from '../dist/legal.js';

const token = process.env.COURTLISTENER_TOKEN;
if (!token) { console.error('legal:live needs COURTLISTENER_TOKEN in the environment (a free token from courtlistener.com).'); process.exit(2); }

// One real citation; a real citation attached to the wrong case name; one that does not exist.
const text = 'See Brown v. Board of Education, 347 U.S. 483 (1954). Also Roe v. Wade, 347 U.S. 483 (1954). And Smith v. Imaginary Airlines, 999 F.3d 9999 (11th Cir. 2099).';
console.error('Sending three citations to courtlistener.com.');
const r = await createLegal({ token }).check(text);
console.log(r.summary.text);
for (const v of r.verdicts) console.log(`  ${v.bucket === 'ok' ? '✓' : v.bucket === 'failed' ? '✕' : '≈'} [${v.status}] ${v.message}`);

const want = ['found', 'wrong-case', 'notfound'];
const got = r.verdicts.map((v) => v.status);
if (JSON.stringify(got) !== JSON.stringify(want)) {
  console.error(`\nExpected ${want.join(', ')} but got ${got.join(', ')}. If a status is "unavailable", CourtListener is throttling or refused the token: that says nothing about the module. Otherwise the service has changed from its documentation: read docs/legal-live-verification.md.`);
  process.exit(1);
}
if (!/not "Roe v\. Wade"/.test(r.verdicts[1].message)) { console.error('\nThe wrong-case message names the wrong case: the case name was read incorrectly.'); process.exit(1); }
console.log('\nlegal:live ok: a real citation is found, a real citation under the wrong name is caught, and an invented one is not verified.');
