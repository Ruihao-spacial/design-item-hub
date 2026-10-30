// Diaphragm Analysis — Phase 4: loads, span beams, basic unit shear, line forces, wall shares (pure, no DOM).
//
// Load case = one load direction (dir 'x' | 'y', the axis the load acts along) and one kind (E | W). Each diaphragm
// the user defined for that direction is a flexible beam along the span axis (spanAxis: a load along y spans along
// x) between its two support lines; it may overhang a support. Its load w(s) (plf, signed along the plan axis):
//   seismic mode  q · d(s)   (q = F_x / ΣA, psf)        area mode  psf · d(s)
//   wind mode     per segment a windward and a leeward plf: each goes to the band on that face of the section
//                 (windward = the side the load comes from), so at an opening the two strips load different bands
//   line mode     w(s) of the segments, shared by the diaphragms covering the section in proportion to their depth;
//                 with an `edge` grid only by the diaphragms whose depth contains that line
// where d(s) is the diaphragm's sheathed depth at s (its rectangle ∩ the sheathed plan). Within an interval between
// break coordinates d is constant and line loads are linear, so the statics below are exact.
//
// Sign: V(s) = sum of the forces (plan axis of the load) on the part of the diaphragm with smaller s; unit shear
// v = V / d is then the book's "+" sheathing element (Ex 4.1: load −y, v = +300 plf next to the left support).
// Reported reactions / line forces are positive in the load direction (the force delivered to the line).
//
// Bands (opening stretch): where an opening splits the section, each band carries its own load (edge loads go to the
// band on that edge). The bands are a Vierendeel frame; two assumptions close it (EX-IRREG-2E Ch 5.2):
//   inflection — where the opening-edge chords carry no force (local band moment 0);
//   width split — the section where the bands share the section shear by width; each band then integrates its own
//                 load from there.
// Chosen from the geometry (diaphragm.bandSplit '' = auto):
//   - the stretch ends at a support line / diaphragm end (Ex 4.3: the opening runs up to wall line 1): the edge
//     chords have a free end there, so inflection and width split are both at that end;
//   - sheathing (TDs) on both sides (Ex 5.1): inflection at mid-opening (book: F3B = F3C = 0); width split at the
//     opening end with the smaller |V| (book: "start at grid 4", V4 = 8200 < V2 = 13000), which keeps the effect of
//     the width assumption smallest.
// bandSplit 'low' / 'high' / 'mid' overrides the width-split section (the inflection stays automatic).
// With loads in proportion to width every band has the same v whatever the split.
//
// Line forces: Σ reactions on each support line. A support line without a wall delivers its force into the TD(s)
// that have it as a load line (equal split between TDs, book Ex 4.2), and each TD passes it by statics to its own
// supports (Ex 3.4); repeated while a TD support has no wall. Wall shares: by wall length, or (linked Shear Wall
// Design) in proportion to the shares Shear Wall Design's own calcAll gives the walls of the line (tdWallLink.js).
import { sectionBands, breakCoords, spanAxis, pointInPolygon } from './tdGeometry.js';

const EPS = 1e-6;
const fin = v => Number.isFinite(v);
const sortU = a => [...new Set(a.map(v => Math.round(v * 1e6) / 1e6))].sort((p, q) => p - q);

export const loadKind = l => (l.kind === 'E' || l.kind === 'W' ? l.kind : l.mode === 'seismic' ? 'E' : 'W');
export const BAND_SPLITS = ['mid', 'low', 'high']; // '' = auto (see Bands above)

// The load cases of a plan: [{ id, dir, kind, loads }]
export function loadCases(plan) {
  const out = [];
  for (const l of plan.loads) {
    const dir = l.acts.endsWith('x') ? 'x' : 'y', kind = loadKind(l), id = dir + '-' + kind;
    let c = out.find(x => x.id === id);
    if (!c) out.push(c = { id, dir, kind, loads: [] });
    c.loads.push(l);
  }
  return out.sort((a, b) => (a.dir === b.dir ? (a.kind < b.kind ? -1 : 1) : a.dir === 'y' ? -1 : 1));
}

// Intersect sheathed bands with [c1, c2]
const clip = (bands, c1, c2) => bands.map(([a, b]) => [Math.max(a, c1), Math.min(b, c2)]).filter(([a, b]) => b - a > EPS);
const width = bands => bands.reduce((s, [a, b]) => s + b - a, 0);

// Value of a line-load segment at s (null outside)
function segAt(g, s) {
  if (!(fin(g.from) && fin(g.to) && fin(g.w))) return null;
  const a = Math.min(g.from, g.to), b = Math.max(g.from, g.to);
  if (s < a - EPS || s > b + EPS) return null;
  if (g.w2 === null || !fin(g.w2) || b - a < EPS) return g.w;
  const t = (s - g.from) / (g.to - g.from);
  return g.w + (g.w2 - g.w) * t;
}

// ∫_a^b w(s) ds and ∫_a^b w(s)(s − p) ds for w linear from wa to wb
const force = (wa, wb, h) => (wa + wb) / 2 * h;
const moment = (wa, wb, a, h, p) => h * (wa * ((a - p) / 2 + h / 6) + wb * ((a - p) / 2 + h / 3));

// One load case. ctx = { q } (psf from F_x / ΣA, or null). Returns { id, dir, kind, axis, diaphragms[], issues[] }.
export function analyseCase(plan, lc, ctx = {}) {
  const ax = spanAxis(lc.dir); // span axis: sections are lines ax = s
  const issues = [];
  const across = d => (ax === 'x' ? [d.y1, d.y2] : [d.x1, d.x2]);
  const along = d => (ax === 'x' ? [d.x1, d.x2] : [d.y1, d.y2]);
  const dgs = plan.diaphragms.filter(d => d.dir === lc.dir && [d.x1, d.x2, d.y1, d.y2].every(fin) && d.x2 > d.x1 && d.y2 > d.y1);
  const usable = dgs.filter(d => {
    const ok = d.supports.length === 2 && d.supports.every(g => g && g.axis === ax && fin(g.at)) && Math.abs(d.supports[0].at - d.supports[1].at) > EPS;
    if (!ok) issues.push({ code: 'dg-unsupported', msg: `Diaphragm ${d.mark || '?'} (${lc.dir}): needs two support lines across the span — not analysed.`, ref: d.id });
    return ok;
  });
  const bandsOf = (d, s, side = '') => { const [c1, c2] = across(d); return clip(sectionBands(plan, ax, s, side), c1, c2); };
  const sigma = l => (l.acts.startsWith('-') ? -1 : 1);

  // Load on diaphragm d, band k (or the whole diaphragm when band is null), at s inside an interval (mid = its midpoint)
  function loadAt(d, bands, band, s, mid) {
    let w = 0;
    const dW = width(bands);
    for (const l of lc.loads) {
      const sg = sigma(l);
      if (l.mode === 'seismic' || l.mode === 'area') {
        const p = l.mode === 'seismic' ? ctx.q : l.psf;
        if (!fin(p)) continue;
        w += sg * p * (band ? band[1] - band[0] : dW);
        continue;
      }
      if (l.mode === 'wind') {
        // windward plf to the band on the windward face of the whole section, leeward plf to the band on the leeward
        // face (book Ex 5.1: 123 plf on chord A, 77 plf on chord D at the opening). With one band across the section
        // both reach it, so only the net load matters there.
        const all = sectionBands(plan, ax, mid);
        if (!all.length) continue;
        const cMin = Math.min(...all.map(b => b[0])), cMax = Math.max(...all.map(b => b[1]));
        const cWind = sg < 0 ? cMax : cMin, cLee = sg < 0 ? cMin : cMax; // the wind blows toward the load direction
        for (const g of l.segments) {
          if (segAt(g, s) === null || segAt(g, mid) === null) continue;
          for (const [cf, val] of [[cWind, g.w], [cLee, g.wl]]) {
            if (!fin(val) || !val) continue;
            const holder = bands.find(b => cf >= b[0] - EPS && cf <= b[1] + EPS);
            if (holder && (!band || band === holder)) w += sg * val; // no holder: the face belongs to another diaphragm
          }
        }
        continue;
      }
      for (const g of l.segments) {
        const v = segAt(g, s);
        if (v === null || segAt(g, mid) === null) continue; // segment must cover the interval
        // diaphragms that take this load at this section
        const takers = usable.filter(o => {
          const [a, b] = along(o);
          if (!(mid > a + EPS && mid < b - EPS)) return false;
          if (l.edge && fin(l.edge.at)) { const [c1, c2] = across(o); return l.edge.at >= c1 - EPS && l.edge.at <= c2 + EPS; }
          return true;
        });
        const depthOf = o => width(o === d ? bands : bandsOf(o, mid));
        const total = takers.reduce((t, o) => t + depthOf(o), 0);
        if (!takers.includes(d) || total < EPS) continue;
        const share = depthOf(d) / total;
        if (!band) { w += sg * v * share; continue; }
        if (l.edge && fin(l.edge.at)) {
          // the band on that edge (nearest band if the edge line is not on a band)
          const dist = b => (l.edge.at < b[0] ? b[0] - l.edge.at : l.edge.at > b[1] ? l.edge.at - b[1] : 0);
          const near = bands.reduce((m, b) => (dist(b) < dist(m) ? b : m), bands[0]);
          if (near === band) w += sg * v * share;
        } else w += sg * v * share * (band[1] - band[0]) / dW;
      }
    }
    return w;
  }

  const brk = breakCoords(plan)[ax === 'x' ? 'xs' : 'ys'];
  const loadEnds = lc.loads.flatMap(l => l.segments.flatMap(g => [g.from, g.to])).filter(fin);
  const out = [];
  for (const d of usable) {
    const [lo, hi] = along(d);
    const sup = d.supports.map(g => g.at).sort((a, b) => a - b);
    if (sup[0] < lo - EPS || sup[1] > hi + EPS) { issues.push({ code: 'dg-support-out', msg: `Diaphragm ${d.mark}: a support line lies outside it.`, ref: d.id }); continue; }
    const pts = sortU([lo, hi, ...sup, ...brk, ...loadEnds, ...plan.grids.filter(g => g.axis === ax).map(g => g.at)].filter(v => fin(v) && v >= lo - EPS && v <= hi + EPS));
    // intervals with their bands and band loads at both ends
    const iv = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], h = b - a, mid = (a + b) / 2;
      if (h < EPS) continue;
      const bands = bandsOf(d, mid);
      if (!bands.length) { iv.push({ a, b, bands: [], wa: 0, wb: 0, bw: [] }); continue; }
      const bw = bands.map(bd => ({ lo: bd[0], hi: bd[1], wa: loadAt(d, bands, bd, a, mid), wb: loadAt(d, bands, bd, b, mid) }));
      iv.push({ a, b, bands, bw, wa: bw.reduce((s, x) => s + x.wa, 0), wb: bw.reduce((s, x) => s + x.wb, 0) });
    }
    // reactions (forces on the diaphragm along the plan axis)
    const [p1, p2] = sup;
    let F = 0, M = 0;
    for (const x of iv) { F += force(x.wa, x.wb, x.b - x.a); M += moment(x.wa, x.wb, x.a, x.b - x.a, p1); }
    const R2 = -M / (p2 - p1), R1 = -F - R2;
    const reactions = [{ at: p1, R: R1 }, { at: p2, R: R2 }];
    const supGrid = at => d.supports.find(g => Math.abs(g.at - at) < EPS);
    // section shear V along s (total), walking from lo; reactions applied when passing a support
    let V = 0;
    for (const x of iv) {
      for (const r of reactions) if (Math.abs(r.at - x.a) < EPS) V += r.R;
      x.Va = V;
      V += force(x.wa, x.wb, x.b - x.a);
      x.Vb = V;
    }
    // section moment M(s) = ∫ V ds from lo (exact for linear w)
    let Ms = 0;
    for (const x of iv) { x.Ma = Ms; const h = x.b - x.a; Ms += x.Va * h + x.wa * h * h / 2 + (x.wb - x.wa) * h * h / 6; x.Mb = Ms; }
    // band shears: stretches of intervals with the same number (> 1) of bands
    for (const x of iv) if (x.bands.length === 1) { x.bw[0].Va = x.Va; x.bw[0].Vb = x.Vb; }
    const override = BAND_SPLITS.includes(d.bandSplit) ? d.bandSplit : '';
    const stretches = [];
    const atSupport = p => Math.abs(p - lo) < EPS || Math.abs(p - hi) < EPS || sup.some(q => Math.abs(q - p) < EPS);
    for (let i = 0; i < iv.length;) {
      const n = iv[i].bands.length;
      if (n < 2) { i++; continue; }
      let j = i;
      while (j + 1 < iv.length && iv[j + 1].bands.length === n) j++;
      const st = iv.slice(i, j + 1);
      const A = st[0].a, B = st[st.length - 1].b;
      const freeA = atSupport(A), freeB = atSupport(B);
      const VA = Math.abs(st[0].Va), VB = Math.abs(st[st.length - 1].Vb);
      let sInf, auto, rule;
      if (freeA !== freeB) { sInf = auto = freeA ? A : B; rule = 'free end at the ' + (freeA ? 'low' : 'high') + ' end (support line / diaphragm end)'; }
      else {
        sInf = (A + B) / 2;
        auto = Math.abs(VA - VB) < EPS ? sInf : VA < VB ? A : B;
        rule = freeA ? 'supports at both ends' : 'sheathing on both sides (Vierendeel): inflection at mid-opening, width split at the end with the smaller |V|';
        if (freeA) issues.push({ code: 'dg-opening-both-supports', warn: true, msg: `Diaphragm ${d.mark}: an opening runs from support to support — check the bands as separate diaphragms.`, ref: d.id });
      }
      const sRef = override === 'low' ? A : override === 'high' ? B : override === 'mid' ? (A + B) / 2 : auto;
      stretches.push({ a: A, b: B, sInf, sRef, rule: override ? rule + '; width split set by the user (' + override + ')' : rule });
      // V and band loads at sRef; then each band integrates its own load both ways
      const k = st.findIndex(x => sRef >= x.a - EPS && sRef <= x.b + EPS);
      const x0 = st[k], t = (sRef - x0.a) / (x0.b - x0.a);
      const dRef = width(x0.bands);
      const Vref = x0.Va + force(x0.wa, x0.wa + (x0.wb - x0.wa) * t, sRef - x0.a);
      const Vband = x0.bw.map(bd => Vref * (bd.hi - bd.lo) / dRef);
      // within x0: from sRef back to a and on to b
      x0.bw.forEach((bd, m) => {
        const wRef = bd.wa + (bd.wb - bd.wa) * t;
        bd.Va = Vband[m] - force(bd.wa, wRef, sRef - x0.a);
        bd.Vb = Vband[m] + force(wRef, bd.wb, x0.b - sRef);
      });
      const supSplit = (x, at, sgn) => reactions.filter(r => Math.abs(r.at - at) < EPS).reduce((s, r) => s + sgn * r.R, 0) / width(x.bands);
      for (let m = k + 1; m < st.length; m++) {
        const prev = st[m - 1], x = st[m];
        const jump = supSplit(x, x.a, 1); // reaction inside the stretch: shared by width (noted)
        x.bw.forEach((bd, q) => { bd.Va = prev.bw[q].Vb + jump * (bd.hi - bd.lo); bd.Vb = bd.Va + force(bd.wa, bd.wb, x.b - x.a); });
      }
      for (let m = k - 1; m >= 0; m--) {
        const next = st[m + 1], x = st[m];
        const jump = supSplit(x, x.b, 1);
        x.bw.forEach((bd, q) => { bd.Vb = next.bw[q].Va - jump * (bd.hi - bd.lo); bd.Va = bd.Vb - force(bd.wa, bd.wb, x.b - x.a); });
      }
      if (st.some((x, m) => m > 0 && reactions.some(r => Math.abs(r.at - x.a) < EPS)))
        issues.push({ code: 'dg-support-in-stretch', warn: true, msg: `Diaphragm ${d.mark}: a support inside an opening stretch — its reaction is shared by the bands by width.`, ref: d.id });
      i = j + 1;
    }
    for (const x of iv) x.bw.forEach(bd => { const wd = bd.hi - bd.lo; bd.va = bd.Va / wd; bd.vb = bd.Vb / wd; });
    out.push({
      id: d.id, mark: d.mark, lo, hi, across: across(d), bandSplit: override || 'auto', stretches,
      load: F,
      supports: reactions.map(r => { const g = supGrid(r.at); return { gridId: g ? g.id : null, name: g ? g.name : '?', at: r.at, R: r.R }; }),
      intervals: iv.map(x => ({ a: x.a, b: x.b, Va: x.Va, Vb: x.Vb, Ma: x.Ma, Mb: x.Mb, wa: x.wa, wb: x.wb, d: width(x.bands),
        bands: x.bw.map(bd => ({ lo: bd.lo, hi: bd.hi, wa: bd.wa, wb: bd.wb, Va: bd.Va, Vb: bd.Vb, va: bd.va, vb: bd.vb })) })),
    });
  }
  return { id: lc.id, dir: lc.dir, kind: lc.kind, axis: ax, sigma: lc.loads.length ? sigma(lc.loads[0]) : 1, diaphragms: out, issues };
}

// The load the span beams carry, summed over the diaphragms of the case, along the span: [{ a, b, wa, wb }] (plf,
// positive in the load direction). One picture for every load mode: seismic q·d(s), area psf·d(s), wind / line plf.
export function loadProfile(cs) {
  const pts = sortU(cs.diaphragms.flatMap(d => d.intervals.flatMap(i => [i.a, i.b])));
  const at = (i, s) => i.wa + (i.wb - i.wa) * (s - i.a) / (i.b - i.a);
  const out = [];
  for (let j = 0; j < pts.length - 1; j++) {
    const a = pts[j], b = pts[j + 1];
    if (b - a < EPS) continue;
    let wa = 0, wb = 0;
    for (const d of cs.diaphragms) for (const i of d.intervals) if (i.a <= a + EPS && i.b >= b - EPS) { wa += at(i, a); wb += at(i, b); }
    out.push({ a, b, wa: wa * cs.sigma, wb: wb * cs.sigma });
  }
  return out;
}

// Line forces of a case: each support line's Σ (−R) (plan-axis sign), then wall-less lines into their TDs.
// Each contribution keeps where it enters along the line (`parts`: c ranges — a diaphragm's bands at the support, a
// TD's extent), so the line can be split into connected parts (lineParts) and each part's walls take its force.
// Returns { lines: [{ gridId, name, at, F (plan sign), P (load-direction sign), from: [{ src, F, parts }],
//   parts: [{ lo, hi, F, P }], noWall, into?, handed? }], issues }
export function lineForces(plan, cs) {
  const map = new Map();
  const add = (g, F, src, parts) => {
    if (!g) return;
    let e = map.get(g.id);
    if (!e) map.set(g.id, e = { gridId: g.id, name: g.name, at: g.at, F: 0, from: [] });
    e.F += F; e.from.push({ src, F, parts });
  };
  const gridById = plan.gridById;
  for (const d of cs.diaphragms) for (const sp of d.supports) {
    const x = d.intervals.find(i => Math.abs(i.a - sp.at) < 1e-6) || d.intervals.find(i => Math.abs(i.b - sp.at) < 1e-6);
    const parts = x && x.bands.length ? x.bands.map(b => [b.lo, b.hi]) : [d.across];
    add(gridById.get(sp.gridId), -sp.R, 'diaphragm ' + d.mark, parts);
  }
  const hasWall = id => plan.walls.some(w => w.gridId === id);
  const issues = [];
  // hand wall-less lines to their TDs (a few passes: a TD support may itself have no wall)
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (const e of [...map.values()]) {
      if (hasWall(e.gridId) || Math.abs(e.F) < EPS) continue;
      const tds = plan.tds.filter(t => t.dir === cs.dir && t.loads.some(l => l.grid && l.grid.id === e.gridId) && t.supports.length === 2 && t.supports.every(Boolean));
      if (!tds.length) continue;
      const F = e.F;
      e.F = 0; e.from.push({ src: 'to ' + tds.map(t => t.mark).join(', ') + (tds.length > 1 ? ' (equal split)' : ''), F: -F, parts: null });
      e.into = tds.map(t => t.mark);
      e.handed = (e.handed || 0) + F; // plan sign; each TD takes handed / into.length as its load P
      for (const t of tds) {
        const [a, b] = t.supports.map(g => g.at);
        const Ft = F / tds.length;
        const Fb = Ft * (e.at - a) / (b - a), Fa = Ft - Fb;
        const ext = [cs.axis === 'x' ? [t.y1, t.y2] : [t.x1, t.x2]];
        add(t.supports[0], Fa, 'TD ' + t.mark + ' from line ' + e.name, ext);
        add(t.supports[1], Fb, 'TD ' + t.mark + ' from line ' + e.name, ext);
      }
      moved = true;
    }
    if (!moved) break;
  }
  const lines = [...map.values()].map(e => {
    const g = gridById.get(e.gridId);
    const parts = lineParts(plan, cs, g).map(([lo, hi]) => ({ lo, hi, F: 0 }));
    for (const f of e.from) {
      if (!f.parts) continue;
      const len = f.parts.reduce((t, [a, b]) => t + b - a, 0);
      for (const [a, b] of f.parts) for (const p of parts) {
        const ov = Math.min(b, p.hi) - Math.max(a, p.lo);
        if (ov > EPS && len > EPS) p.F += f.F * ov / len;
      }
    }
    for (const p of parts) p.P = p.F * cs.sigma;
    return { ...e, P: e.F * cs.sigma, noWall: !hasWall(e.gridId), parts };
  });
  for (const e of lines) {
    if (e.noWall && Math.abs(e.F) > 0.5 && !e.into)
      issues.push({ code: 'line-no-wall', warn: true, msg: `Line ${e.name} (${cs.dir}, ${cs.kind}): ${Math.round(e.P)} lb with no shear wall and no TD loaded by it.` });
    else if (!e.noWall) for (const p of e.parts) if (Math.abs(p.P) > 0.5 && !plan.walls.some(w => w.gridId === e.gridId && w.to > p.lo + EPS && w.from < p.hi - EPS))
      issues.push({ code: 'line-part-no-wall', warn: true, msg: `Line ${e.name} (${cs.dir}, ${cs.kind}): the part ${+p.lo.toFixed(2)}–${+p.hi.toFixed(2)} carries ${Math.round(p.P)} lb but has no wall and is not connected to one.` });
  }
  return { lines, issues };
}

// Connected parts of a support / wall line g (s = g.at) along c: sheathing on either side and walls. A line with walls
// is continuous across a gap that lies inside the outline (a strut along the wall line, book Ex 4.3 line 1); a gap
// outside the outline (a notch, Ex 4.2 line C between grids 2 and 3) splits it.
export function lineParts(plan, cs, g) {
  if (!g) return [];
  const iv = [];
  for (const side of ['-', '+']) for (const p of sectionAt(cs, g.at, side).parts) for (const b of p.bands) iv.push([b.lo, b.hi]);
  const walls = plan.walls.filter(w => w.gridId === g.id && fin(w.from) && fin(w.to));
  for (const w of walls) iv.push([w.from, w.to]);
  iv.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of iv) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + EPS) { last[1] = Math.max(last[1], b); continue; }
    if (last && walls.length) {
      const m = (last[1] + a) / 2;
      const [x, y] = cs.axis === 'x' ? [g.at, m] : [m, g.at];
      if (plan.outline.length >= 3 && pointInPolygon(x, y, plan.outline)) { last[1] = b; continue; }
    }
    out.push([a, b]);
  }
  return out;
}

// Wall shares on a line, part by part: each connected part's force split among its walls by length, or by the ratio
// of `weights` (wallId → number, e.g. SWD shares) when given
export function wallShares(plan, line, weights = null) {
  const walls = plan.walls.filter(w => w.gridId === line.gridId && fin(w.from) && fin(w.to) && w.to > w.from);
  const wt = w => (weights ? weights[w.id] || 0 : w.to - w.from);
  const parts = line.parts && line.parts.length ? line.parts : [{ lo: -Infinity, hi: Infinity, P: line.P }];
  const out = [];
  for (const p of parts) {
    const ws = walls.filter(w => w.to > p.lo + EPS && w.from < p.hi - EPS);
    const sum = ws.reduce((t, w) => t + wt(w), 0);
    for (const w of ws) {
      const share = sum > EPS ? p.P * wt(w) / sum : 0;
      out.push({ id: w.id, mark: w.mark, from: w.from, to: w.to, length: w.to - w.from, share, v: share / (w.to - w.from), basis: weights ? 'swd' : 'length' });
    }
  }
  return out;
}

// Offset wall lines (Phase 7): walls with one wall line name on two or more grids across the span are one line of
// resistance (book Ex 3.3: SW1 on B, SW3 / SW4 on C = line B/C). Returns [{ name, gridIds, walls }].
export function lineGroups(plan, cs) {
  const by = new Map();
  for (const w of plan.walls) {
    if (w.axis !== cs.axis || !w.line || !(fin(w.from) && fin(w.to) && w.to > w.from)) continue;
    const k = w.line.toLowerCase();
    let g = by.get(k);
    if (!g) by.set(k, g = { name: w.line, gridIds: [], walls: [] });
    g.walls.push(w);
    if (!g.gridIds.includes(w.gridId)) g.gridIds.push(w.gridId);
  }
  return [...by.values()].filter(g => g.gridIds.length > 1);
}

// A group's force F (plan sign) to its walls by length across all its grids (a rigid line, SDPWS 4.3.5.5.1 exception;
// book Ex 3.3 p4: SW1 on B shares with SW3 / SW4 on C); each grid line's force = Σ its walls' shares. A group grid
// with no diaphragm reaction gets a line entry.
export function shareGroup(plan, cs, grp, F) {
  const len = grp.walls.reduce((t, w) => t + w.to - w.from, 0);
  for (const id of grp.gridIds) {
    let ln = cs.lines.find(l => l.gridId === id);
    if (!ln) { const g = plan.gridById.get(id); cs.lines.push(ln = { gridId: id, name: g.name, at: g.at, F: 0, from: [], parts: [], noWall: false }); }
    const ws = grp.walls.filter(w => w.gridId === id);
    ln.F = ws.reduce((t, w) => t + F * (w.to - w.from) / len, 0);
    ln.P = ln.F * cs.sigma;
    ln.group = grp.name;
    ln.walls = ws.map(w => {
      const share = F * cs.sigma * (w.to - w.from) / len;
      return { id: w.id, mark: w.mark, from: w.from, to: w.to, length: w.to - w.from, share, v: share / (w.to - w.from), basis: 'group' };
    });
  }
}

// Section at s (side '-' / '+' / ''): per diaphragm covering s, its bands with V and v, and the total V
export function sectionAt(cs, s, side = '') {
  const res = { V: 0, parts: [] };
  for (const d of cs.diaphragms) {
    if (s < d.lo - EPS || s > d.hi + EPS) continue;
    if ((side === '-' && s < d.lo + 1e-4) || (side === '+' && s > d.hi - 1e-4)) continue; // no diaphragm on that side
    let x = null, at = null;
    if (side === '-') { x = d.intervals.find(i => Math.abs(i.b - s) < 1e-4); at = 'b'; }
    else if (side === '+') { x = d.intervals.find(i => Math.abs(i.a - s) < 1e-4); at = 'a'; }
    if (!x) {
      x = d.intervals.find(i => s > i.a + 1e-4 && s < i.b - 1e-4);
      if (!x) { x = d.intervals.find(i => Math.abs(i.b - s) < 1e-4) || d.intervals.find(i => Math.abs(i.a - s) < 1e-4); at = x && Math.abs(x.b - s) < 1e-4 ? 'b' : 'a'; }
    }
    if (!x) continue;
    const bands = x.bands.map(bd => {
      let V;
      if (at === 'a') V = bd.Va; else if (at === 'b') V = bd.Vb;
      else { const t = (s - x.a) / (x.b - x.a); V = bd.Va + force(bd.wa, bd.wa + (bd.wb - bd.wa) * t, s - x.a); }
      return { lo: bd.lo, hi: bd.hi, V, v: V / (bd.hi - bd.lo) };
    });
    const V = bands.reduce((t, b) => t + b.V, 0);
    res.V += V;
    res.parts.push({ id: d.id, mark: d.mark, V, bands });
  }
  return res;
}
