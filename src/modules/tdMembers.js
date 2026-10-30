// Diaphragm Analysis — Phase 5: member forces on the basic field (pure, no DOM). Tension +.
//
// Members along the span (chords / struts on lines c = const), at a section s:
//   - single band [lo, hi] (depth d): the band's chord pair carries the section moment M(s) = ∫ V ds:
//     N(lo edge) = +M/d, N(hi edge) = −M/d, a line inside the band 0. With a constant depth this equals the
//     unit-shear integral from the free end; at a notch it gives the force the cut chord needs (book F = M / d_reduced,
//     Ex 4.1, 3.5) — the disrupted force a TD must take.
//   - opening stretch (Vierendeel, tdBasicShear "Bands"): at the inflection section the opening-edge chords are 0 and
//     the outer chords carry ±M / H (H = outer chord distance, book F3 = M3 / 50); from there each band edge
//     integrates dN/ds = v_above − v_below with the band unit shears (book F4B, F2B …, Ex 5.1; Ex 4.3 from line 1).
// Members across the span (struts / collectors on lines s = const), along c:
//   dN/dc = v(s+) − v(s−) − r_wall, r_wall = the wall reaction per foot on the diaphragm (plan sign). Integrated
//   from a free end of the line; a part between two TDs that both take the line (book Ex 4.2) is split equally
//   between them (N = −Q/2 at its low end). Ex 3.4: strut 1 from the free end A to the TD edge at B = −2310.
import { sectionAt } from './tdBasicShear.js';

const EPS = 1e-6;
const near = (a, b) => Math.abs(a - b) < 1e-4;

// Interval of diaphragm d at s (side '-' / '+' / '')
function intervalAt(d, s, side = '') {
  if (side === '-') return d.intervals.find(i => near(i.b, s)) || d.intervals.find(i => s > i.a && s <= i.b + 1e-4);
  if (side === '+') return d.intervals.find(i => near(i.a, s)) || d.intervals.find(i => s >= i.a - 1e-4 && s < i.b);
  return d.intervals.find(i => s > i.a + 1e-4 && s < i.b - 1e-4) || d.intervals.find(i => near(i.a, s)) || d.intervals.find(i => near(i.b, s));
}
// ∫_0^τ of a V that starts at Va with load linear wa → wb over the interval length h
const intV = (Va, wa, wb, h, tau) => Va * tau + wa * tau * tau / 2 + (wb - wa) * tau * tau * tau / (6 * h);
export function momentAt(d, s, side = '') {
  const x = intervalAt(d, s, side);
  if (!x) return null;
  return x.Ma + intV(x.Va, x.wa, x.wb, x.b - x.a, s - x.a);
}
// ∫_{s0}^{s1} v of the band [lo, hi] (s0 < s1 inside the stretch intervals)
function bandIntegral(d, lo, hi, s0, s1) {
  let t = 0;
  for (const x of d.intervals) {
    const a = Math.max(x.a, s0), b = Math.min(x.b, s1);
    if (b - a < EPS) continue;
    const bd = x.bands.find(q => near(q.lo, lo) && near(q.hi, hi));
    if (!bd) continue;
    const h = x.b - x.a;
    t += (intV(bd.Va, bd.wa, bd.wb, h, b - x.a) - intV(bd.Va, bd.wa, bd.wb, h, a - x.a)) / (hi - lo);
  }
  return t;
}

// Force in the member on line c (along the span) at section s. Returns { N, how, diaphragm } or null.
export function chordForce(cs, c, s, side = '') {
  for (const d of cs.diaphragms) {
    if (s < d.lo - EPS || s > d.hi + EPS || c < d.across[0] - EPS || c > d.across[1] + EPS) continue;
    const x = intervalAt(d, s, side);
    if (!x || !x.bands.length) continue;
    const st = (d.stretches || []).find(q => x.a >= q.a - EPS && x.b <= q.b + EPS);
    const bands = x.bands;
    const above = bands.find(b => near(b.lo, c)), below = bands.find(b => near(b.hi, c));
    const inside = bands.find(b => c > b.lo + 1e-4 && c < b.hi - 1e-4);
    if (inside) return { N: 0, how: 'line inside a band — no basic chord force', diaphragm: d.mark };
    if (!above && !below) continue;
    if (!st) {
      const b = bands[0], M = momentAt(d, s, side), dd = b.hi - b.lo;
      const N = above ? M / dd : -M / dd;
      return { N, how: `section: ${above ? '+' : '−'}M/d = ${above ? '' : '−'}${Math.round(M)} / ${+dd.toFixed(2)}`, diaphragm: d.mark };
    }
    // Vierendeel stretch: start at the inflection section, integrate the band unit shears
    const outerLo = bands[0].lo, outerHi = bands[bands.length - 1].hi, H = outerHi - outerLo;
    const Minf = momentAt(d, st.sInf, st.sInf <= st.a + EPS ? '+' : st.sInf >= st.b - EPS ? '-' : '');
    const N0 = near(c, outerLo) ? Minf / H : near(c, outerHi) ? -Minf / H : 0;
    const [s0, s1, sg] = s >= st.sInf ? [st.sInf, s, 1] : [s, st.sInf, -1];
    const q = (above ? bandIntegral(d, above.lo, above.hi, s0, s1) : 0) - (below ? bandIntegral(d, below.lo, below.hi, s0, s1) : 0);
    return { N: N0 + sg * q, how: `Vierendeel: ${N0 ? (N0 > 0 ? '+' : '−') + 'M/H at the inflection' : '0 at the inflection'} (${+st.sInf.toFixed(2)}), + ∫(v above − v below)`, diaphragm: d.mark };
  }
  return null;
}

// Unit shear at section s (side) at cross coordinate c: the band of any diaphragm holding c (null = no sheathing)
export function vAt(cs, s, c, side = '') {
  const sec = sectionAt(cs, s, side);
  for (const p of sec.parts) for (const b of p.bands) if (c > b.lo - 1e-9 && c < b.hi + 1e-9) return b.v;
  return null;
}

// Wall reaction per foot on the diaphragm (plan sign along the load axis) on line gridId at c
export function wallR(cs, gridId, c) {
  const ln = cs.lines.find(l => l.gridId === gridId);
  const w = ln && (ln.walls || []).find(x => c > x.from - 1e-9 && c < x.to + 1e-9);
  return w ? -cs.sigma * w.share / w.length : 0;
}

// Force in the member on line g (across the span, g.at = s0) at c. tdRanges: [[c0, c1]] of the TDs this line loads.
// Returns { N, how } or null.
export function crossForce(cs, g, c, tdRanges = []) {
  const s0 = g.at;
  const pts = new Set();
  for (const side of ['-', '+']) for (const p of sectionAt(cs, s0, side).parts) for (const b of p.bands) { pts.add(b.lo); pts.add(b.hi); }
  const ln = cs.lines.find(l => l.gridId === g.id);
  for (const w of (ln && ln.walls) || []) { pts.add(w.from); pts.add(w.to); }
  for (const r of tdRanges) { pts.add(r[0]); pts.add(r[1]); }
  const cc = [...pts].sort((a, b) => a - b);
  if (cc.length < 2) return null;
  const lo = cc[0], hi = cc[cc.length - 1];
  const q = m => (vAt(cs, s0, m, '+') || 0) - (vAt(cs, s0, m, '-') || 0) - wallR(cs, g.id, m);
  const integ = (a, b) => { let t = 0; for (let i = 0; i < cc.length - 1; i++) { const p = Math.max(cc[i], a), r = Math.min(cc[i + 1], b); if (r - p > EPS) t += q((p + r) / 2) * (r - p); } return t; };
  // the part of the line outside the TDs that holds c (at a TD edge: the part outside that TD)
  const inTd = m => tdRanges.some(([a, b]) => m > a + 1e-4 && m < b - 1e-4);
  const cuts = [lo, ...tdRanges.flat(), hi].filter(v => v >= lo - EPS && v <= hi + EPS).sort((a, b) => a - b);
  let seg = null;
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1], m = (a + b) / 2;
    if (b - a < EPS || inTd(m)) continue;
    if (c >= a - 1e-4 && c <= b + 1e-4) { seg = [a, b]; if (!(near(c, a) && inTd(a - 1e-3)) && !(near(c, b) && inTd(b + 1e-3))) break; }
  }
  if (!seg) return null;
  const [a, b] = seg;
  const freeA = near(a, lo) && !tdRanges.some(r => near(r[0], a) || near(r[1], a));
  const freeB = near(b, hi) && !tdRanges.some(r => near(r[0], b) || near(r[1], b));
  if (freeA) return { N: integ(a, c), how: 'integrated from the free end at ' + +a.toFixed(2) };
  if (freeB) return { N: -integ(c, b), how: 'integrated from the free end at ' + +b.toFixed(2) };
  const Q = integ(a, b);
  return { N: -Q / 2 + integ(a, c), how: 'between two TDs: split equally (book Ex 4.2)' };
}
