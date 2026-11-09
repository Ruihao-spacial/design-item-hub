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
//     H and the outer chords are those of the inflection section; an outer chord follows the outermost band of each
//     interval (its line may step, e.g. Ex 8.1 bottom chord E → D at grid 4), so every section stays in equilibrium.
//     A chord cut inside the stretch (its line is not the outer chord at the inflection; Ex 8.1 chord D at 4) takes,
//     per diaphragm setting chordCut (G4, user 2026-11-02, from the opening study docs/diaphragm-analysis-opening-
//     study.md): '' / 'section' = ±M(s) / H(s) at the cut, inner members taken as 0 there (default; book Ex 8.1 p8:
//     M4 / 80 = 3000; within −6…+9 % of a stiffness reference) or 'vierendeel' = the value above (Ex 8.1: 2759.6).
//   Opening-edge (inner) members (G3): zero at the inflection, unless the band's unit shear changes sign inside the
//     opening — then zero at that zero-shear point (book Ex 8.1 p13: each TD takes the shear area on its side).
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
// ∫_{s0}^{s1} v of the band picked in each interval (pick(bands) → band | undefined; s0 < s1)
function bandIntegral(d, pick, s0, s1) {
  let t = 0;
  for (const x of d.intervals) {
    const a = Math.max(x.a, s0), b = Math.min(x.b, s1);
    if (b - a < EPS) continue;
    const bd = pick(x.bands);
    if (!bd) continue;
    const h = x.b - x.a;
    t += (intV(bd.Va, bd.wa, bd.wb, h, b - x.a) - intV(bd.Va, bd.wa, bd.wb, h, a - x.a)) / (bd.hi - bd.lo);
  }
  return t;
}

// Where the unit shear of the band edged by line c changes sign inside the opening stretch st (linear within each
// interval; also at an interval boundary), or null
export function zeroShearPoint(d, st, c) {
  let prev = null;
  for (const x of d.intervals) {
    if (x.a < st.a - EPS || x.b > st.b + EPS) continue;
    const bd = x.bands.find(b => near(b.lo, c) || near(b.hi, c));
    if (!bd) { prev = null; continue; }
    if (prev && prev.v * bd.va < 0) return x.a;
    if (bd.va * bd.vb < 0) return x.a + (x.b - x.a) * bd.va / (bd.va - bd.vb);
    prev = { v: bd.vb };
  }
  return null;
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
    // Vierendeel stretch: start at the inflection section (its outer chords and H), integrate the band unit shears
    const outerLo = bands[0].lo, outerHi = bands[bands.length - 1].hi;
    const infSide = st.sInf <= st.a + EPS ? '+' : st.sInf >= st.b - EPS ? '-' : '';
    const xi = intervalAt(d, st.sInf, infSide);
    const iLo = xi.bands[0].lo, iHi = xi.bands[xi.bands.length - 1].hi, Hinf = iHi - iLo;
    const Minf = momentAt(d, st.sInf, infSide);
    const role = near(c, outerLo) ? 'low' : near(c, outerHi) ? 'high' : 'inner';
    const cut = (role === 'low' && !near(c, iLo)) || (role === 'high' && !near(c, iHi)); // chord ends inside the stretch
    if (cut && d.chordCut !== 'vierendeel') {
      const M = momentAt(d, s, side), H = outerHi - outerLo;
      return { N: role === 'low' ? M / H : -M / H, how: `chord cut inside the opening stretch — section rule (setting): ${role === 'low' ? '+' : '−'}M/H = ${role === 'low' ? '' : '−'}${Math.round(M)} / ${+H.toFixed(2)}, inner members taken as 0 here`, diaphragm: d.mark };
    }
    const N0 = role === 'low' ? Minf / Hinf : role === 'high' ? -Minf / Hinf : 0;
    // an outer chord follows the outermost band; an inner (opening-edge) member the bands on its line
    const pickAbove = role === 'low' ? bs => bs[0] : role === 'high' ? () => null : bs => bs.find(b => near(b.lo, c));
    const pickBelow = role === 'high' ? bs => bs[bs.length - 1] : role === 'low' ? () => null : bs => bs.find(b => near(b.hi, c));
    const integ = (a, b) => bandIntegral(d, pickAbove, a, b) - bandIntegral(d, pickBelow, a, b); // a < b
    const fromInf = p => (p >= st.sInf ? integ(st.sInf, p) : -integ(p, st.sInf));
    if (role === 'inner') {
      const x0 = zeroShearPoint(d, st, c);
      if (x0 !== null) return { N: fromInf(s) - fromInf(x0), how: `opening-edge member: 0 at the band's zero-shear point (${+x0.toFixed(2)}), + ∫(v above − v below)`, diaphragm: d.mark, zeroShear: x0 };
    }
    return { N: N0 + fromInf(s), how: `Vierendeel: ${N0 ? (N0 > 0 ? '+' : '−') + 'M/H at the inflection' : '0 at the inflection'} (${+st.sInf.toFixed(2)}${N0 ? ', H = ' + +Hinf.toFixed(2) : ''}), + ∫(v above − v below)${cut ? ' — chord cut inside the stretch: the outer chord force arriving at the cut' : ''}`, diaphragm: d.mark };
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
// opts.noThrough (TD inputs, user 26996 2026-11-05): leave out the walls above that continue down their line — their
// drag enters and leaves on the same line, so it is not a cut strut / chord force a TD has to carry
export function wallR(cs, gridId, c, opts = {}) {
  const ln = cs.lines.find(l => l.gridId === gridId);
  const w = ln && (ln.walls || []).find(x => c > x.from - 1e-9 && c < x.to + 1e-9);
  return (w ? -cs.sigma * w.share / w.length : 0) + aboveR(cs, gridId, c, ln, opts);
}
// Walls of the story above on this grid (step 6, user 2026-11-05; cs.above: [{ kind, gridId, from, to, V (lb, load
// direction) }]): each puts its force into the member along its length (source σ·V / L). A 'through' wall continues down
// its line: the same total leaves through this level's walls on the line, by their shares (sink), so the member shows
// only the drag where the walls above and below do not line up. A 'transfer' wall's force leaves through the diaphragm
// (its concentrated load), so the member is the distributor that spreads it over the depth.
function aboveR(cs, gridId, c, ln, opts = {}) {
  const ab = (cs.above || []).filter(a => a.gridId === gridId && a.V && !a.missed && !(opts.noThrough && a.kind === 'through')); // missed: its force was not placed
  if (!ab.length) return 0;
  let r = 0;
  for (const a of ab) if (c > a.from - 1e-9 && c < a.to + 1e-9 && a.to - a.from > 1e-9) r += cs.sigma * a.V / (a.to - a.from);
  const T = ab.filter(a => a.kind === 'through').reduce((t, a) => t + a.V, 0);
  const walls = (ln && ln.walls) || [];
  if (T && walls.length) {
    const tot = walls.reduce((t, x) => t + Math.max(0, x.share || 0), 0);
    const len = walls.reduce((t, x) => t + x.length, 0);
    const w = walls.find(x => c > x.from - 1e-9 && c < x.to + 1e-9);
    if (w) r -= cs.sigma * T * (tot > 1e-9 ? Math.max(0, w.share || 0) / tot : w.length / len) / w.length;
  }
  return r;
}

// Force in the member on line g (across the span, g.at = s0) at c. tdRanges: [[c0, c1]] of the TDs this line loads.
// Returns { N, how } or null.
export function crossForce(cs, g, c, tdRanges = []) {
  const s0 = g.at;
  const pts = new Set();
  for (const side of ['-', '+']) for (const p of sectionAt(cs, s0, side).parts) for (const b of p.bands) { pts.add(b.lo); pts.add(b.hi); }
  const ln = cs.lines.find(l => l.gridId === g.id);
  for (const w of (ln && ln.walls) || []) { pts.add(w.from); pts.add(w.to); }
  // walls of the story above on this grid (step 6): their source is piecewise constant, so their ends are break points
  for (const a of cs.above || []) if (a.gridId === g.id) { pts.add(a.from); pts.add(a.to); }
  for (const r of tdRanges) { pts.add(r[0]); pts.add(r[1]); }
  const cc = [...pts].sort((a, b) => a - b);
  if (cc.length < 2) return null;
  const lo = cc[0], hi = cc[cc.length - 1];
  const q = m => (vAt(cs, s0, m, '+') || 0) - (vAt(cs, s0, m, '-') || 0) - wallR(cs, g.id, m, { noThrough: true }); // a TD's P: no through drag
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
  // A wall of this line running past the TD edge into the TD (user test 26998, 2026-11-06: SW-8 y 54–57.5, TD1 from 57):
  // the part inside takes its share straight out of the member, not through the TD shear — so it belongs to P, as if
  // the member were integrated on to the wall end (the TD's own field there is not part of P).
  const wallIn = (lo2, hi2) => {
    let t = 0;
    for (const w of (ln && ln.walls) || []) {
      const p = Math.max(w.from, lo2), r = Math.min(w.to, hi2);
      if (r - p > EPS && w.length > EPS) t += cs.sigma * w.share / w.length * (r - p);
    }
    return t;
  };
  const tdFrom = c0 => tdRanges.find(r => near(r[0], c0)), tdTo = c0 => tdRanges.find(r => near(r[1], c0));
  if (freeA) {
    const td = near(c, b) ? tdFrom(c) : null, extra = td ? wallIn(c, td[1]) : 0;
    return { N: integ(a, c) + extra, how: 'integrated from the free end at ' + +a.toFixed(2) + (Math.abs(extra) > 0.5 ? ` + ${Math.round(extra)} lb of the wall part inside the TD` : '') };
  }
  if (freeB) {
    const td = near(c, a) ? tdTo(c) : null, extra = td ? wallIn(td[0], c) : 0;
    return { N: -(integ(c, b) + extra), how: 'integrated from the free end at ' + +b.toFixed(2) + (Math.abs(extra) > 0.5 ? ` + ${Math.round(extra)} lb of the wall part inside the TD` : '') };
  }
  const Q = integ(a, b);
  return { N: -Q / 2 + integ(a, c), how: 'between two TDs: split equally (book Ex 4.2)' };
}
