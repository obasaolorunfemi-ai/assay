// A source-quality policy for claims about markets, energy, trade and food security. Nothing academic about it: the bodies and outlets are the ones such work
// really leans on (UN agencies, central banks and regulators, specialist analysts, the financial press), and it is the kind of ranking that the Hormuz Crisis tracker
// and Inkstone's sourcing gate apply. Start from it and edit: the gate judges how a claim is SOURCED against YOUR list, and Assay only ships a small neutral one.
//
//   import { gate } from './gate-policy-markets-and-trade.mjs';
//   gate.check([{ text: 'Delays cost traders an estimated $400m.', category: 'loss-estimate', sources: [{ url: 'https://www.reuters.com/x', date: '2026-10-01' }] }]);
import { createGate, defaultPolicy, rules } from '@extrafemi-ai/assay/gate';

const at = (tier, hosts) => Object.fromEntries(hosts.map((h) => [h, tier]));

export const policy = {
  ...defaultPolicy,
  domains: {
    ...defaultPolicy.domains,
    // Tier 1: official bodies, within their mandate. (Any .gov host, any .int host and most central banks' .gov.xx hosts are already tier 1 by suffix.)
    ...at(1, ['wfp.org', 'unescap.org', 'imo.org', 'ecb.europa.eu', 'nnpcgroup.com', 'londonstockexchange.com', 'jpx.co.jp']),
    // Tier 2: specialists: think tanks, regional banks' research, commodity and shipping analysts, law firms' client alerts.
    ...at(2, ['atlanticcouncil.org', 'stimson.org', 'energypolicy.columbia.edu', 'dallasfed.org', 'farmdocdaily.illinois.edu', 'woodmac.com', 'kpler.com', 'lloydslist.com', 'drewry.co.uk', 'icis.com', 'spglobal.com', 'clydeco.com']),
    // Tier 3: reputable news, including regional outlets that cover markets the wires do not.
    ...at(3, ['cnbc.com', 'axios.com', 'cbsnews.com', 'euronews.com', 'nairametrics.com', 'businessday.ng', 'techpoint.africa']),
  },
  // Your own domains are tier 0: your platform's data and your own published positions, authoritative only about yourself.
  firstParty: [],
  rules: [
    // A loss estimate, a causal claim or a force-majeure classification needs a specialist (tier 2) or better; news alone is not enough for these.
    rules.estimatesCausalLegalNeedSpecialist,
    // Logging a declaration needs one authority, or two independent news sources.
    rules.oneAuthorityOrTwoPress,
  ],
};

export const gate = createGate(policy);
