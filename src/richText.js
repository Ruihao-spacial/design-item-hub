// Subscript markup for labels, table headers and equations (user request 2026-10-01: easier reading).
//   X_{abc}  → X with "abc" as a subscript (always)
//   X_abc    → the same, short form — only where `short` is on (table headers / labels), because cell values such as
//              wall marks may contain an underscore
// rich()     → DOM children for el() (text nodes and <sub>)
// richRuns() → [{ t, sub }] runs for the PDF (pdf.js draws sub runs smaller and lower)
import { el } from './utils.js';

const LONG = /_\{([^}]*)\}/;
const SHORT = /_\{([^}]*)\}|_([A-Za-z0-9]+)/;

export function richRuns(str, short = false) {
  const s = str == null ? '' : String(str);
  const re = short ? SHORT : LONG;
  const runs = [];
  let rest = s;
  for (let m = rest.match(re); m; m = rest.match(re)) {
    if (m.index > 0) runs.push({ t: rest.slice(0, m.index), sub: false });
    runs.push({ t: m[1] != null ? m[1] : m[2], sub: true });
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) runs.push({ t: rest, sub: false });
  return runs;
}

export const hasRich = (str, short = false) => (short ? SHORT : LONG).test(String(str == null ? '' : str));

// DOM children: a plain string stays a string (no extra nodes) when there is no markup
export function rich(str, short = false) {
  if (str == null || typeof str !== 'string' || !hasRich(str, short)) return str;
  return richRuns(str, short).map(r => (r.sub ? el('sub', null, r.t) : document.createTextNode(r.t)));
}

// Plain text of a marked-up string (for titles / tooltips): X_{ab} → Xab
export const plainText = (str, short = false) => richRuns(str, short).map(r => r.t).join('');
