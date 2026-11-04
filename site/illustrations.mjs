// One small animated scene for each check, drawn as inline SVG. The page's content-security policy allows no inline styles or scripts,
// so every look and every movement is a class defined in style.css or in the generated animation sheet below (animCss).
// Elements that appear in turn carry a start time as a class (t10 = 10% into the 9-second loop); the keyframes for each start time are generated.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const T = (x, y, t, cls = 'tx') => `<text class="${cls}" x="${x}" y="${y}">${esc(t)}</text>`;
const svg = (label, body) => `<svg class="ill" viewBox="0 0 320 190" role="img" aria-label="${esc(label)}"><g aria-hidden="true">${body}</g></svg>`;
const stamp = (t, x, y, w, text, ok) => `<g class="pop t${t}"><rect class="${ok ? 'okbg' : 'badbg'}" x="${x}" y="${y}" width="${w}" height="26" rx="13"/>${T(x + w / 2, y + 17.5, text, ok ? 'tx c oktx' : 'tx c badtx')}</g>`;

export const ILL = {
  citations: svg('A citation card is looked up in three public record collections, and a found stamp appears.', `
    <rect class="pane" x="12" y="52" width="122" height="70" rx="9"/>
    ${T(24, 76, 'Rose, 1985', 'tx b')}${T(24, 94, '“Sick individuals and', 'tx s')}${T(24, 106, 'sick populations”', 'tx s')}
    <rect class="pane2" x="200" y="22" width="108" height="34" rx="8"/>${T(254, 43, 'CrossRef', 'tx c')}
    <rect class="pane2" x="200" y="72" width="108" height="34" rx="8"/>${T(254, 93, 'OpenAlex', 'tx c')}
    <rect class="pane2" x="200" y="122" width="108" height="34" rx="8"/>${T(254, 143, 'Open Library', 'tx c')}
    <path class="draw t8 line" pathLength="1" d="M134 87 C168 87 168 39 200 39"/>
    <path class="draw t16 line" pathLength="1" d="M134 87 L200 89"/>
    <path class="draw t24 line" pathLength="1" d="M134 87 C168 87 168 139 200 139"/>
    ${stamp(42, 26, 134, 94, '✓ A record exists', true)}`),

  quotes: svg('A search bar sweeps down a source text looking for a quote, finds nothing, and the quote is marked not in the text.', `
    <rect class="pane" x="12" y="14" width="190" height="162" rx="9"/>
    ${[[160, 32], [150, 52], [168, 72], [118, 92], [156, 112], [140, 132], [96, 152]].map(([w, y]) => `<rect class="ln" x="26" y="${y}" width="${w}" height="7" rx="3.5"/>`).join('')}
    <rect class="scan" x="18" y="26" width="178" height="18" rx="5"/>
    <rect class="pane2" x="214" y="58" width="96" height="52" rx="9"/>
    ${T(262, 79, '“Relocation is', 'tx s c')}${T(262, 92, 'available for', 'tx s c')}${T(262, 105, 'all staff”', 'tx s c')}
    ${stamp(64, 214, 122, 96, '✕ Not in the text', false)}`),

  figures: svg('Numbers in a draft are matched to numbers in your materials; the one with no match is flagged.', `
    <rect class="pane" x="12" y="12" width="108" height="166" rx="9"/>${T(66, 30, 'Your draft', 'tx s c')}
    <rect class="chip" x="24" y="40" width="84" height="30" rx="8"/>${T(66, 60, '5,000', 'tx c b')}
    <rect class="chip" x="24" y="86" width="84" height="30" rx="8"/>${T(66, 106, '40%', 'tx c b')}
    <rect class="chip" x="24" y="132" width="84" height="30" rx="8"/>${T(66, 152, 'three', 'tx c b')}
    <rect class="pane2" x="200" y="12" width="108" height="166" rx="9"/>${T(254, 30, 'Your materials', 'tx s c')}
    <rect class="chip" x="212" y="86" width="84" height="30" rx="8"/>${T(254, 106, '40%', 'tx c b')}
    <rect class="chip" x="212" y="132" width="84" height="30" rx="8"/>${T(254, 152, 'three', 'tx c b')}
    <path class="draw t12 line" pathLength="1" d="M108 101 L212 101"/>
    <path class="draw t24 line" pathLength="1" d="M108 147 L212 147"/>
    <g class="pop t44"><rect class="alert" x="21" y="37" width="90" height="36" rx="10"/><circle class="badbg" cx="108" cy="40" r="11"/>${T(108, 45, '✕', 'tx c badtx')}</g>
    ${T(160, 82, 'no match', 'tx s c badtx pop t48')}`),

  gate: svg('A claim backed only by press coverage tries to move up to the specialist tier, is held back, and is dropped.', `
    ${['0 · your own data', '1 · an authority', '2 · a specialist', '3 · the press', '4 · an aggregator'].map((l, i) => `<rect class="${i < 3 ? 'pane2' : 'pane'}" x="14" y="${14 + i * 32}" width="176" height="26" rx="7"/>${T(26, 31 + i * 32, l, i === 3 ? 'tx b' : 'tx')}`).join('')}
    <rect class="zone" x="9" y="9" width="186" height="100" rx="11"/>
    ${T(204, 36, 'A loss estimate', 'tx s')}${T(204, 49, 'needs a source in', 'tx s')}${T(204, 62, 'the dashed box.', 'tx s')}
    <g class="bump"><circle class="token" cx="170" cy="123" r="8"/></g>
    ${stamp(46, 196, 128, 116, '✕ Dropped', false)}`),

  grounding: svg('A line tagged c1 is traced back to the approved fact c1; the two figures differ, so the line is flagged.', `
    <rect class="pane2" x="12" y="12" width="296" height="52" rx="9"/>
    <text class="tx" x="24" y="34">c1 · The official rate averaged <tspan class="hot">₦645.19</tspan> in 2023.</text>
    ${T(24, 54, 'an approved fact', 'tx s')}
    <rect class="pane" x="12" y="116" width="296" height="60" rx="9"/>
    <text class="tx" x="24" y="144">The rate moved to <tspan class="hot">₦425</tspan> in 2023.</text>
    <rect class="chip" x="236" y="130" width="60" height="26" rx="8"/>${T(266, 147, '[[c1]]', 'tx c b')}
    <path class="draw t12 line" pathLength="1" d="M266 130 L266 64"/>
    ${stamp(46, 20, 78, 140, '≠ Figures differ', false)}`),

  values: svg('A bar chart by year; a claim of 25 billion dollars sits above the source figure of 19.5 billion for 2023.', `
    <path class="axis" d="M16 160 H190"/>
    ${[[24, 58], [58, 70], [92, 52], [126, 82]].map(([x, h]) => `<rect class="bar grow" x="${x}" y="${160 - h}" width="24" height="${h}" rx="3"/>`).join('')}
    <rect class="bar hot grow" x="160" y="68" width="24" height="92" rx="3"/>${T(172, 176, '2023', 'tx s c')}
    <path class="draw t34 line bad" pathLength="1" d="M150 38 H196"/>
    ${T(208, 42, 'Claim: $25bn', 'tx b badtx pop t38')}
    ${T(208, 108, 'World Bank:', 'tx s pop t46')}${T(208, 122, '$19.5bn', 'tx b pop t46')}
    ${stamp(56, 200, 134, 110, '✕ Wrong for 2023', false)}`),

  links: svg('One web address reaches a public page and is marked live; a second address that points into a private network is refused before any request is made.', `
    <rect class="chip" x="12" y="20" width="132" height="28" rx="8"/>${T(78, 38, 'example.com/paper.pdf', 'tx s c')}
    <path class="draw t8 line" pathLength="1" d="M144 34 H214"/>
    <circle class="globe" cx="244" cy="34" r="22"/><ellipse class="globe" cx="244" cy="34" rx="9" ry="22"/><path class="globe" d="M222 34 H266"/>
    ${stamp(20, 214, 60, 60, '✓ live', true)}
    <rect class="chip" x="12" y="112" width="132" height="28" rx="8"/>${T(78, 130, '169.254.169.254/…', 'tx s c')}
    <path class="draw t42 line bad" pathLength="1" d="M144 126 H178"/>
    <path class="shield pop t50" d="M184 108 l16 6 v16 c0 11 -8 18 -16 21 c-8 -3 -16 -10 -16 -21 v-16z"/>
    <rect class="pane2" x="226" y="106" width="82" height="40" rx="8"/>${T(267, 130, 'your network', 'tx s c')}
    ${stamp(60, 150, 154, 160, '✕ Refused, nothing sent', false)}`),
};

/** Generated keyframes: one set per start time for the things that appear (pop) and the lines that draw. */
export const animCss = (() => {
  let c = '/* generated by site/illustrations.mjs */\n';
  for (let n = 0; n <= 75; n += 2) {
    c += `@keyframes pop-${n}{0%,${n}%{opacity:0;transform:scale(.85)}${n + 6}%{opacity:1;transform:scale(1)}90%{opacity:1;transform:scale(1)}98%,100%{opacity:0;transform:scale(1)}}\n`;
    c += `@keyframes draw-${n}{0%,${n}%{stroke-dashoffset:1;opacity:1}${n + 9}%{stroke-dashoffset:0;opacity:1}90%{stroke-dashoffset:0;opacity:1}98%,100%{stroke-dashoffset:0;opacity:0}}\n`;
    c += `.pop.t${n}{animation-name:pop-${n}}.draw.t${n}{animation-name:draw-${n}}\n`;
  }
  return c;
})();
