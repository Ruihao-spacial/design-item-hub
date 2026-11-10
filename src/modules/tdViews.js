// Diaphragm Analysis — result views (DOM). One canvas per load case, two groups:
//   Unit shear: Basic v_b (View 1, Phase 4) · TD v_TD (View 2) · Net v_net (View 3);  Forces: Members N (View 4).
// Shared zoom / pan (wheel about the cursor, drag, − / + / Fit) kept across views and cases, so one spot can be
// compared view by view; labels keep their size, so zooming in shows the values hidden on small cells. Hover = value.
// Overlays (all views): line forces & wall shares; diaphragm / TD outlines. HTML legend under the canvas: the view's
// colour scale (+ blue / − red, its largest value) and the plan symbols.
// The plan is drawn by tdPlanEditor.drawPlan (read-only use, result mode); the paint goes under its lines.
import { el } from '../utils.js';
import { drawPlan, newEditorState, zoomAt, zoomButtons, planLegend } from './tdPlanEditor.js';
import { sectionAt } from './tdBasicShear.js';
import { breaks, vNetAt, vtdAt, closes, memberN } from './tdNet.js';
import { vAt } from './tdMembers.js';

const NS = 'http://www.w3.org/2000/svg';
const POS = '#2563eb', NEG = '#dc2626';
const f0 = v => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—');
const f1 = v => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toString() : '—');
function svg(tag, attrs, ...kids) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) n.setAttribute(k, String(v));
  for (const c of kids) if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
}
// Text size of the drawing being built (shared zoom state `text`, A− / A+): every result label and the pixel room a
// label needs scale with it. Set by paintPlan; drawings are built synchronously, one at a time.
export const TEXT_DEFAULT = 1.2;
let TS = TEXT_DEFAULT;
const label = (x, y, s, attrs = {}) => svg('text', { x, y, 'text-anchor': 'middle', fill: '#111827', 'paint-order': 'stroke', stroke: '#fff', ...attrs,
  'font-size': +((attrs['font-size'] || 10) * TS).toFixed(1), 'stroke-width': +(3 * TS).toFixed(1) }, s);
export const caseLabel = c => 'Load along ' + c.dir + ' (' + (c.dir === 'y' ? '↕' : '↔') + ') — ' + (c.kind === 'E' ? 'seismic E' : 'wind W');

const tip = (node, s) => { node.appendChild(svg('title', null, s)); return node; };
const crossAxis = cs => (cs.axis === 'x' ? 'y' : 'x');
// "x 15–75, y 60–80" for a cell given along the span (s) and across it (c)
const where = (cs, a, b, p, q) => `${cs.axis} ${f1(a)}–${f1(b)}, ${crossAxis(cs)} ${f1(p)}–${f1(q)}`;

// The plan in result mode at the shared zoom; `layer` goes just above the sheathing (under the plan lines: shear
// fills), `top` above everything the plan draws (member diagrams and force labels — walls must not hide them, user
// 2026-11-06). ov.walls / ov.above false hide the walls of this level (below the diaphragm) / of the story above.
const paintPlan = (plan, cs, zs = {}, ov = {}, cls = 'td-view') => {
  TS = zs.text || TEXT_DEFAULT;
  const base = newEditorState();
  const state = { ...base, dir: cs.dir, sel: null, zoom: zs.zoom || 1, panX: zs.panX || 0, panY: zs.panY || 0,
    layers: { ...base.layers, walls: ov.walls !== false, above: ov.above !== false } };
  const d = drawPlan(plan, state, [], { result: true, outlines: ov.outlines !== false });
  const layer = svg('g', { class: cls });
  const first = d.group.querySelector('polygon');
  if (first && first.nextSibling) d.group.insertBefore(layer, first.nextSibling); else d.group.appendChild(layer);
  const top = svg('g', { class: cls + ' ' + cls + '-top' });
  d.group.appendChild(top);
  return { root: d.svg, v: d.view, layer, top, group: d.group };
};

// Line forces at the support lines, wall shares at the walls (overlay, every view)
function drawLineForces(plan, cs, v, layer) {
  for (const ln of cs.lines) {
    if (Math.abs(ln.P) < 0.5 && !(ln.from || []).length) continue;
    const gr = plan.gridById.get(ln.gridId);
    if (!gr) continue;
    const [x, y] = gr.axis === 'x' ? [v.sx(gr.at), v.b ? v.sy(v.b.y2) - 22 : 20] : [v.sx(v.b.x2) + 4, v.sy(gr.at) - 4];
    layer.appendChild(label(x, y, ln.name + ': ' + f0(ln.P) + ' lb' + (ln.into ? ' → ' + ln.into.join(', ') : ''), { 'font-weight': 600, 'text-anchor': gr.axis === 'x' ? 'middle' : 'start', fill: ln.into ? '#b45309' : '#111827' }));
    for (const w of ln.walls || []) {
      const m = (w.from + w.to) / 2;
      const [wx, wy] = gr.axis === 'x' ? [v.sx(gr.at) + 4, v.sy(m)] : [v.sx(m), v.sy(gr.at) + 12];
      layer.appendChild(label(wx, wy, (w.mark || 'wall') + ' ' + f0(w.share) + ' lb · ' + f1(w.v) + ' plf', { 'text-anchor': gr.axis === 'x' ? 'start' : 'middle', fill: '#4338ca', 'font-size': 9 }));
    }
  }
}

// View 1 (Basic v_b) for one case. zs: shared zoom { zoom, panX, panY }; ov: overlays { lines, outlines }.
// Returns { svg, group, view, scale: { max, unit, name } }.
export function drawBasicShear(plan, cs, zs = {}, ov = {}) {
  const { root, v, layer: paint, top, group } = paintPlan(plan, cs, zs, ov, 'td-view1');
  const vmax = Math.max(1e-9, ...cs.diaphragms.flatMap(d => d.intervals.flatMap(i => i.bands.flatMap(b => [Math.abs(b.va), Math.abs(b.vb)]))));
  const rect = (a, b, lo, hi) => (cs.axis === 'x' ? { x1: a, x2: b, y1: lo, y2: hi } : { x1: lo, x2: hi, y1: a, y2: b });
  for (const d of cs.diaphragms) for (const iv of d.intervals) for (const bd of iv.bands) {
    const r = rect(iv.a, iv.b, bd.lo, bd.hi);
    const vm = (bd.va + bd.vb) / 2;
    paint.appendChild(tip(svg('rect', { x: v.sx(r.x1), y: v.sy(r.y2), width: (r.x2 - r.x1) * v.k, height: (r.y2 - r.y1) * v.k,
      fill: vm >= 0 ? POS : NEG, 'fill-opacity': (0.08 + 0.45 * Math.abs(vm) / vmax).toFixed(3), stroke: '#ffffff', 'stroke-width': 0.5 }),
      `v_b ${f1(bd.va)}${Math.abs(bd.va - bd.vb) >= 0.05 ? ' → ' + f1(bd.vb) : ''} plf · ${d.mark || 'diaphragm'} · ${where(cs, iv.a, iv.b, bd.lo, bd.hi)}`));
    const len = (iv.b - iv.a) * v.k, dep = (bd.hi - bd.lo) * v.k;
    if (dep < 14 * TS) continue;
    const mid = (bd.lo + bd.hi) / 2;
    const at = (s, val, anchor) => {
      const [x, y] = cs.axis === 'x' ? [v.sx(s), v.sy(mid)] : [v.sx(mid), v.sy(s)];
      return label(cs.axis === 'x' ? x + (anchor === 'start' ? 3 : -3) : x, cs.axis === 'x' ? y + 3 : y + (anchor === 'start' ? -4 : 11), f1(val), { 'text-anchor': cs.axis === 'x' ? anchor : 'middle', 'font-size': 9 });
    };
    if (len >= 60 * TS || (len >= 30 * TS && Math.abs(bd.va - bd.vb) < 0.05)) {
      paint.appendChild(at(iv.a, bd.va, 'start'));
      if (Math.abs(bd.va - bd.vb) >= 0.05) paint.appendChild(at(iv.b, bd.vb, 'end'));
    }
  }
  if (ov.lines !== false) drawLineForces(plan, cs, v, top);
  return { svg: root, group, view: v, scale: { max: vmax, unit: 'plf', name: 'v_b' } };
}

// Wheel = zoom about the cursor, drag = pan (shown live by moving the plan group, applied on release)
function attachZoomPan(root, group, v, plan, zs, redraw) {
  const scale = () => { const r = root.getBoundingClientRect ? root.getBoundingClientRect() : null; return r && r.width ? { r, sc: v.W / r.width } : { r: { left: 0, top: 0 }, sc: 1 }; };
  let drag = null;
  root.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, px: zs.panX, py: zs.panY, moved: false }; });
  root.addEventListener('mousemove', e => {
    if (!drag) return;
    const { sc } = scale(), dx = (e.clientX - drag.x) * sc, dy = (e.clientY - drag.y) * sc;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    group.setAttribute('transform', `translate(${dx},${dy})`);
  });
  root.addEventListener('mouseup', e => {
    const d = drag;
    drag = null;
    if (!d || !d.moved) return;
    const { sc } = scale();
    zs.panX = d.px + (e.clientX - d.x) * sc; zs.panY = d.py + (e.clientY - d.y) * sc;
    redraw();
  });
  root.addEventListener('mouseleave', () => { if (drag) group.removeAttribute('transform'); drag = null; });
  root.addEventListener('wheel', e => {
    e.preventDefault();
    const { r, sc } = scale();
    zoomAt(plan, zs, v, (e.clientX - r.left) * sc, (e.clientY - r.top) * sc, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    redraw();
  });
}

const fmtK = v => (Math.round(v * 1000) / 1000).toString();
// Load combination factor on the force level shown (user 2026-11-10): LRFD 1.0E / 1.0W, ASD 0.7E / 0.6W (ASCE 7-22
// §2.3.6 / §2.4.5 for E; §2.3.1 / §2.4.1 for W — W is strength level). Default = Setup → General "Design basis".
export const comboFactor = (kind, basis) => (basis === 'LRFD' ? 1 : kind === 'E' ? 0.7 : 0.6);
export const comboLabel = (kind, basis) => basis + ' — ' + fmtK(comboFactor(kind, basis)) + (kind === 'E' ? 'E' : 'W');

// What the Analysis views are showing: the sense, the load combination and (seismic) the force level and its factor.
// combo = { basis, kc, acts, reversed } (absent: the 1.0 level as analysed, entered sense)
export function forcesShown(cs, lvl, k, fl, q, combo = null) {
  const base = forcesLevel(cs, lvl, k, fl, q);
  if (!combo) return base;
  const tot = fmtK(combo.kc * k);
  return `${combo.basis} ${fmtK(combo.kc)}${cs.kind === 'E' ? 'E' : 'W'}` + (k !== 1 ? ` × level ${fmtK(k)} = × ${tot}` : '')
    + `, acting ${combo.acts}${combo.envelope ? ' (envelope of both senses: max tension / max compression of the two runs)' : combo.reversed ? ' (reversed sense — its own full run)' : ' (entered sense)'}. ` + base
    + (combo.kc !== 1 ? ` All values below are × ${fmtK(combo.kc)} (${combo.basis}).` : '');
}
function forcesLevel(cs, lvl, k, fl, q) {
  if (cs.kind !== 'E') return 'Forces shown: wind, 1.0W as entered on Setup → Wind loading (no factor).';
  // walls of the story above (step 7): the levels name both parts
  const ab = (cs.above || []).filter(a => a.V);
  if (ab.length) {
    const marks = ab.map(a => a.mark).join(', ');
    const om = fl.increase ? 'max(Ω₀ ' + fmtK(fl.omega0 ?? 2.5) + ', 1.25) = ' + fmtK(fl.transfer ?? 2.5) : fmtK(fl.omega0 ?? 2.5);
    if (lvl === 'D') return `Forces shown: seismic, DIAPHRAGM level = own level × k_D ${fmtK(k)} + walls above (${marks}) × Ω₀ ${om} (ASCE 7-22 §12.10.1.1, Type 4) — for unit shears, chords and struts. Shear Wall Design receives the 1.0E line forces, not these.`;
    if (lvl === 'C') return `Forces shown: seismic, COLLECTOR level = (own level + walls above ${marks}) × k_C ${fmtK(k)} — read collectors, drag struts and distributors here. Shear Wall Design receives the 1.0E line forces, not these.`;
    return `Forces shown: seismic 1.0E: own level (F_x${fl.fx !== null ? ' = ' + fl.fx + ' k' : ''}) + walls of the story above (${marks}, 1.0E from Shear Wall Design) — as analysed; the line forces sent to Shear Wall Design are these.`;
  }
  const src = 'F_x' + (fl.fx !== null ? ' = ' + fl.fx + ' k' : '') + (Number.isFinite(q) ? ' (q = ' + (Math.round(q * 100) / 100) + ' psf)' : '');
  if (lvl === 'D') return `Forces shown: seismic, DIAPHRAGM level = 1.0E × k_D ${fmtK(k)} (F_px / F_x, Setup) — for unit shears, chords and struts. Shear Wall Design receives the 1.0E line forces, not these.`;
  if (lvl === 'C') return `Forces shown: seismic, COLLECTOR level = 1.0E × k_C ${fmtK(k)} (Setup) — read collectors / drag struts here. Shear Wall Design receives the 1.0E line forces, not these.`;
  return `Forces shown: seismic 1.0E from ${src} — as analysed; the line forces sent to Shear Wall Design are these.`;
}

// The case with every force and unit shear × k (display at a force level; geometry unchanged)
export function scaleCase(cs, k) {
  if (k === 1) return cs;
  const S = v => (Number.isFinite(v) ? v * k : v);
  return {
    ...cs,
    diaphragms: cs.diaphragms.map(d => ({ ...d, load: S(d.load), supports: d.supports.map(s => ({ ...s, R: S(s.R) })),
      intervals: d.intervals.map(i => ({ ...i, Va: S(i.Va), Vb: S(i.Vb), Ma: S(i.Ma), Mb: S(i.Mb), wa: S(i.wa), wb: S(i.wb),
        bands: i.bands.map(b => ({ ...b, wa: S(b.wa), wb: S(b.wb), Va: S(b.Va), Vb: S(b.Vb), va: S(b.va), vb: S(b.vb) })) })) })),
    lines: cs.lines.map(l => ({ ...l, F: S(l.F), P: S(l.P), handed: S(l.handed), from: (l.from || []).map(f => ({ ...f, F: S(f.F) })),
      parts: (l.parts || []).map(p => ({ ...p, F: S(p.F), P: S(p.P) })), walls: (l.walls || []).map(w => ({ ...w, share: S(w.share), v: S(w.v) })) })),
    fields: (cs.fields || []).map(f => ({ ...f, segs: f.segs.map(g => ({ ...g, v: S(g.v) })) })),
    members: (cs.members || []).map(m => ({ ...m, runs: m.runs.map(r => ({ ...r, N: S(r.N), residual: S(r.residual), max: S(r.max),
      points: r.points.map(([p, n]) => [p, S(n)]), pieces: r.pieces.map(pc => ({ ...pc, Na: S(pc.Na), qa: S(pc.qa), qm: S(pc.qm), qb: S(pc.qb) })) })) })),
    offset: cs.offset && { ...cs.offset, groups: cs.offset.groups.map(g => ({ ...g, P: S(g.P) })),
      passes: cs.offset.passes.map(p => ({ ...p, maxRes: S(p.maxRes), lines: p.lines.map(l => ({ ...l, P: S(l.P) })), tdP: p.tdP.map(t => ({ ...t, P: t.P === null ? null : S(t.P) })) })) },
  };
}

// ── Envelope of the two senses (user 2026-11-10): an overlay of the two runs already calculated (entered and reversed),
// member by member — no new calculation. At every position either run has a point (plus where the two diagrams cross),
// max T = the larger N of the two, max C = the smaller (signed, not absolute). Members only (View 4).
// Linear value of a run's points at p (null outside the run)
function nOn(points, p) {
  if (!points.length || p < points[0][0] - 1e-6 || p > points[points.length - 1][0] + 1e-6) return null;
  for (let i = 0; i < points.length - 1; i++) {
    const [a, na] = points[i], [b, nb] = points[i + 1];
    if (p >= a - 1e-9 && p <= b + 1e-9) return b - a < 1e-12 ? nb : na + (nb - na) * (p - a) / (b - a);
  }
  return points[points.length - 1][1];
}
// Points of f(p) = max / min of two piecewise-linear diagrams, with their crossing points added
export function envelopePoints(pa, pb) {
  const A = [...pa].sort((x, y) => x[0] - y[0]), B = [...pb].sort((x, y) => x[0] - y[0]);
  const st = [...new Set([...A, ...B].map(([p]) => Math.round(p * 1e6) / 1e6))].sort((x, y) => x - y);
  const val = (P, p) => { const n = nOn(P, p); return n === null ? 0 : n; }; // a sense without the run there: N = 0
  const hi = [], lo = [];
  for (let i = 0; i < st.length; i++) {
    const p = st[i], a = val(A, p), b = val(B, p);
    if (i) {
      const q = st[i - 1], a0 = val(A, q), b0 = val(B, q);
      if ((a0 - b0) * (a - b) < 0) { // the two diagrams cross inside (q, p)
        const t = (a0 - b0) / ((a0 - b0) - (a - b)), x = q + t * (p - q), n = a0 + t * (a - a0);
        hi.push([x, n]); lo.push([x, n]);
      }
    }
    hi.push([p, Math.max(a, b)]); lo.push([p, Math.min(a, b)]);
  }
  return { hi, lo };
}
// The part of a diagram on one side of 0 (sign +1: tension, −1: compression), with the zero crossings added
export function clipSide(points, sign) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const [p, n] = points[i];
    if (i) {
      const [q, m] = points[i - 1];
      if (m * n < 0) { const x = q + (p - q) * m / (m - n); out.push([x, 0]); }
    }
    out.push([p, sign > 0 ? Math.max(n, 0) : Math.min(n, 0)]);
  }
  return out;
}
// A case whose members are the envelope of cases a (entered) and b (reversed), both at the same level / factor.
// Each run: env.T / env.C (the max T / max C diagrams), points = both (for runExtremes), max = the larger |N|,
// residual = the larger closure residual of the two; env.ok = both close.
export function envelopeCase(a, b) {
  const key = m => m.family + '|' + m.at.toFixed(4);
  const bm = new Map((b.members || []).map(m => [key(m), m]));
  const runKey = r => r.from.toFixed(4) + '|' + r.to.toFixed(4);
  const envRun = (ra, rb) => {
    const { hi, lo } = envelopePoints(ra ? ra.points : [], rb ? rb.points : []);
    const res = [ra, rb].filter(Boolean).sort((x, y) => Math.abs(y.residual) - Math.abs(x.residual))[0];
    const T = clipSide(hi, 1), C = clipSide(lo, -1);
    const max = Math.max(0, ...T.map(([, n]) => n), ...C.map(([, n]) => -n));
    const base = ra || rb;
    return { from: base.from, to: base.to, pieces: [], N: res.N, residual: res.residual, max, points: [...T, ...C],
      env: { T, C, ok: [ra, rb].filter(Boolean).every(r => closes(r)) } };
  };
  const members = (a.members || []).map(m => {
    const o = bm.get(key(m)); bm.delete(key(m));
    const orun = new Map(((o && o.runs) || []).map(r => [runKey(r), r]));
    const runs = m.runs.map(r => { const rb = orun.get(runKey(r)); orun.delete(runKey(r)); return envRun(r, rb); });
    for (const rb of orun.values()) runs.push(envRun(null, rb)); // a run only the reversed sense has
    return { ...m, runs };
  });
  for (const o of bm.values()) members.push({ ...o, runs: o.runs.map(r => envRun(null, r)) });
  return { ...a, members, envelope: true };
}
const runCloses = r => (r.env ? r.env.ok : closes(r));

// Value under the mouse at drawing point (px, py) of view v. kind 1–3: unit shear at that point (basic / TD / net);
// kind 4: N on the nearest member line within 10 px (show = member filter). Returns { text, at: [px, py] } or null.
export function readoutAt(plan, cs, v, kind, px, py, show = { chord: true, cross: true }) {
  const x = v.wx(px), y = v.wy(py);
  const [s, c] = cs.axis === 'x' ? [x, y] : [y, x];
  const pos = `x ${f1(x)}, y ${f1(y)}`;
  if (cs.envShear && kind <= 3) { // envelope of the two senses: both values and max |v|
    const e = envShearAt(cs, cs.envShear.b, kind, s, c);
    if (!e) return null;
    const nm = kind === 1 ? 'v_b' : kind === 2 ? 'v_TD' : 'v_net', A = cs.envShear.acts;
    return { text: `${nm} ${A.a}: ${f1(e.va || 0)} · ${A.b}: ${f1(e.vb || 0)} → max |v| ${f1(e.v)} plf (${e.from === 'a' ? A.a : A.b}) · ${pos}`, at: [px, py] };
  }
  if (kind === 1 || kind === 3) {
    const val = kind === 1 ? vAt(cs, s, c) : vNetAt(cs, cs.fields || [], s, c);
    return val === null ? null : { text: `${kind === 1 ? 'v_b' : 'v_net'} ${f1(val)} plf · ${pos}`, at: [px, py] };
  }
  if (kind === 2) {
    if (vAt(cs, s, c) === null) return null;
    return { text: `v_TD ${f1(vtdAt(cs.fields || [], x, y))} plf · ${pos}`, at: [px, py] };
  }
  let best = null;
  for (const m of cs.members || []) {
    if (show[m.family] === false) continue;
    const alongX = (m.family === 'chord') === (cs.axis === 'x'); // the member is drawn horizontally
    const d = alongX ? Math.abs(py - v.sy(m.at)) : Math.abs(px - v.sx(m.at));
    const p = alongX ? x : y;
    if (d > 10 || (best && d >= best.d)) continue;
    const at = alongX ? [px, v.sy(m.at)] : [v.sx(m.at), py];
    if (cs.envelope) { // envelope: max T and max C at p
      const r = m.runs.find(q => p >= q.from - 1e-4 && p <= q.to + 1e-4);
      if (!r || !r.env) continue;
      const t = nOn(r.env.T, p), c = nOn(r.env.C, p);
      best = { d, text: `${m.name} at ${alongX ? 'x' : 'y'} ${f1(p)}: max T ${f0(t || 0)} · max C ${f0(-(c || 0))} lb (both senses)`, at };
      continue;
    }
    const n = memberN(m, p);
    if (n === null) continue;
    best = { d, text: `${m.name} at ${alongX ? 'x' : 'y'} ${f1(p)}: N = ${tc(n)} lb`, at };
  }
  return best && { text: best.text, at: best.at };
}

// Live read-out box + marker that follow the mouse (not while dragging)
function attachReadout(root, v, plan, cs, kind, show) {
  const g = svg('g', { class: 'td-readout', 'pointer-events': 'none', style: 'display:none' });
  const dot = svg('circle', { r: 3.5, fill: '#111827' });
  const box = svg('rect', { rx: 4, fill: '#ffffff', stroke: '#111827', 'stroke-width': 0.8, 'fill-opacity': 0.95 });
  const txt = svg('text', { 'font-size': +(11 * TS).toFixed(1), fill: '#111827' });
  g.appendChild(dot); g.appendChild(box); g.appendChild(txt);
  root.appendChild(g);
  const scale = () => { const r = root.getBoundingClientRect ? root.getBoundingClientRect() : null; return r && r.width ? { r, sc: v.W / r.width } : { r: { left: 0, top: 0 }, sc: 1 }; };
  let down = false;
  root.addEventListener('mousedown', () => { down = true; g.setAttribute('style', 'display:none'); });
  root.addEventListener('mouseup', () => { down = false; });
  root.addEventListener('mouseleave', () => { down = false; g.setAttribute('style', 'display:none'); });
  root.addEventListener('mousemove', e => {
    if (down) return;
    const { r, sc } = scale();
    const px = (e.clientX - r.left) * sc, py = (e.clientY - r.top) * sc;
    const ro = readoutAt(plan, cs, v, kind, px, py, show);
    if (!ro) { g.setAttribute('style', 'display:none'); return; }
    const w = ro.text.length * 6.2 * TS + 12, h = 18 * TS;
    const bx = Math.min(ro.at[0] + 12, v.W - w - 4), by = Math.max(ro.at[1] - h - 8, 4);
    dot.setAttribute('cx', ro.at[0]); dot.setAttribute('cy', ro.at[1]);
    box.setAttribute('x', bx); box.setAttribute('y', by); box.setAttribute('width', w); box.setAttribute('height', h);
    txt.setAttribute('x', bx + 6); txt.setAttribute('y', by + h - 5 * TS);
    txt.textContent = ro.text;
    g.setAttribute('style', '');
  });
}

// Colour scale of a view (HTML, under the canvas)
function scaleLegend(sc, members) {
  const box = el('div', { className: 'td-scale', style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', fontSize: '0.75rem', color: 'var(--ink-secondary)', marginTop: '6px' } });
  const swatch = (col, op) => el('span', { style: { display: 'inline-block', width: '14px', height: '10px', background: col, opacity: op, border: '1px solid ' + col, verticalAlign: 'middle' } });
  if (members) {
    box.appendChild(el('span', null, swatch(POS, 0.6), ' tension (+)'));
    box.appendChild(el('span', null, swatch(NEG, 0.6), ' compression (−)'));
    box.appendChild(el('span', null, 'diagram height ∝ |N| — largest |N| ' + f0(sc.max) + ' lb; hover a diagram for N; zoom ≥ 200 % labels N at grids and wall ends'));
    return box;
  }
  if (sc.envelope) {
    box.appendChild(el('span', null, swatch(ENV, 0.5), ' ' + sc.name + ' of both senses: colour depth ∝ max |v| / largest of this view (' + f1(sc.max) + ' ' + sc.unit + '); hover a cell for both senses'));
    return box;
  }
  const bar = el('span', { style: { display: 'inline-block', width: '180px', height: '10px', border: '1px solid var(--border)', verticalAlign: 'middle',
    background: `linear-gradient(to right, rgba(220,38,38,0.53), rgba(220,38,38,0.08) 49%, #fff 50%, rgba(37,99,235,0.08) 51%, rgba(37,99,235,0.53))` } });
  box.appendChild(el('span', { className: 'mono' }, '−' + f1(sc.max)));
  box.appendChild(bar);
  box.appendChild(el('span', { className: 'mono' }, '+' + f1(sc.max) + ' ' + sc.unit));
  box.appendChild(el('span', null, sc.name + ': blue + / red −, book "+" sheathing element; colour depth ∝ |v| / largest of this view (' + f1(sc.max) + ' ' + sc.unit + '); hover a cell for its value'));
  return box;
}

// TDs of the case that did not run: the TD / net / member views are incomplete without them
// Gate (calcAll cs.paused): a TD of the case did not run, so the TD / net / member results are not reported.
// View 1 keeps the basic shear and the line forces (not final for an offset-line case).
function pausedPanel(cs, view) {
  const stop = cs.paused.some(p => !String(p.terminal).startsWith('ENGINEER_INPUT'));
  const col = stop ? 'var(--fail)' : 'var(--stale)';
  const what = view === 1 ? (cs.offset ? 'The basic shear below is valid; the line forces of the offset wall line are not final (held from Shear Wall Design).' : 'The basic shear and line forces below are valid (they do not need the TD run).')
    : 'TD shear, net shear and member forces need the TD shears — they are shown when it runs. Basic shear and line forces: Basic v_b.';
  return el('div', { className: 'td-paused', style: { border: '1px solid ' + col, color: col, borderRadius: '6px', padding: '6px 10px', fontSize: '0.85rem', marginBottom: '6px' } },
    el('strong', null, (stop ? 'STOPPED — ' : 'PAUSED — ') + cs.paused.map(p => 'TD ' + p.mark + ' ' + p.reason).join('; ') + '. '), what);
}

// Analysis tab: case picker, View 1, line forces / walls, section shears per diaphragm
export function renderAnalysis(plan, results, pick) {
  const box = el('div');
  const cases = (results.analysis && results.analysis.cases) || [];
  const small = { fontSize: '0.78rem', color: 'var(--ink-tertiary)' };
  if (results.errors && results.errors.length) {
    box.appendChild(el('p', { style: { color: 'var(--fail)', fontSize: '0.85rem' } }, 'Fix the plan issues first (Plan / Checks tabs) — the analysis runs on a valid plan.'));
    return box;
  }
  if (!cases.length) { box.appendChild(el('p', { style: small }, 'No load — add one on the Plan tab.')); return box; }
  const csE = cases.find(c => c.id === pick.id) || cases[0];
  box.appendChild(el('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '0.5rem' } },
    ...cases.map(c => el('button', { type: 'button', className: 'btn btn-sm' + (c.id === csE.id ? ' btn-primary' : ''), onClick() { pick.set(c.id); } }, caseLabel(c)))));
  // sense (user 2026-11-10, 1-B): the entered sense or the reversed one — a full second run (calcAll results.reverse)
  const rev = results.reverse || null;
  const acts = (results.senses || []).find(x => x.caseId === csE.id) || { entered: (csE.loads && csE.loads[0] && csE.loads[0].acts) || '', reversed: '' };
  const view = pick.view || 1;
  // sense: 'entered' | 'reversed' | 'envelope' (both senses overlaid: View 4 max T / max C, Views 1–3 max |v|)
  const sense = !(rev && acts.reversed) ? 'entered' : pick.sense || (pick.reversed ? 'reversed' : 'entered');
  const csR = rev && acts.reversed ? rev.cases.find(c => c.id === csE.id) || null : null;
  const reversed = sense === 'reversed' && !!csR;
  // the reversed sense must be complete for the envelope: a PAUSED / FAILED run has no valid TD / net / member values
  // (a PAUSED run still has a valid basic shear: View 1 keeps the envelope)
  const revBad0 = csR && ((csR.paused && csR.paused.length) ? 'PAUSED' : csR.failed ? 'FAILED' : null);
  const revBad = revBad0 && !(view === 1 && revBad0 === 'PAUSED') ? revBad0 : null;
  const envelope = sense === 'envelope' && !!csR && !revBad;
  const cs0 = reversed ? csR : csE;
  // force level (seismic): every view and table below shows the case scaled by k (results stay at 1.0E)
  const fl = results.forceLevels || { fx: null, diaphragm: 1, collector: 1 };
  const lvl = cs0.kind === 'E' ? (pick.level || 'E') : 'E';
  const kL = lvl === 'D' ? fl.diaphragm : lvl === 'C' ? fl.collector : 1;
  // load combination (user 2026-11-10): a factor on the force level shown — LRFD 1.0E / 1.0W, ASD 0.7E / 0.6W
  const basis = pick.basis === 'ASD' ? 'ASD' : 'LRFD'; // the module passes Setup's design basis; none given = 1.0 as analysed
  const kc = comboFactor(cs0.kind, basis);
  const k = kc * kL;
  // diaphragm level with walls above (step 7): the run with the walls above × Ω₀ / k_D, × k_D (calcAll levelD)
  const levelD = reversed ? rev.levelD : results.levelD;
  const dCase = lvl === 'D' && levelD ? levelD.find(c => c.id === cs0.id) || null : null;
  const dRev = envelope && lvl === 'D' && rev.levelD ? rev.levelD.find(c => c.id === cs0.id) || null : null;
  const envB = envelope ? scaleCase(dRev || csR, k) : null; // the reversed sense at the same level / factor
  const cs = envelope && view === 4 ? envelopeCase(scaleCase(dCase || csE, k), envB) : scaleCase(dCase || cs0, k);
  const lvBar = el('div', { style: { display: 'flex', gap: '6px 14px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.4rem' } });
  const lab = t => el('span', { style: { fontSize: '0.78rem', color: 'var(--ink-secondary)' } }, t);
  const grpBox = (...c) => el('span', { style: { display: 'inline-flex', gap: '4px', alignItems: 'center' } }, ...c);
  if (acts.reversed) lvBar.appendChild(grpBox(lab('Acts:'), ...[['entered', acts.entered + ' (entered)'], ['reversed', acts.reversed], ['envelope', 'Envelope ±' + csE.dir]].map(([key, txt]) =>
    el('button', { type: 'button', 'data-sense': key, className: 'btn btn-sm' + (key === sense ? ' btn-primary' : ' btn-ghost'), disabled: key !== 'entered' && !csR,
      title: key === 'envelope' ? 'Both senses overlaid — unit shear: max |v| per cell; members: max tension and max compression' : '',
      onClick() { if (pick.setSense) pick.setSense(key); else if (pick.setReversed) pick.setReversed(key === 'reversed'); } }, txt))));
  if (cs0.kind === 'E') lvBar.appendChild(grpBox(lab('Force level:'), ...[['E', '1.0E (F_x)'], ['D', 'Diaphragm × ' + fmtK(fl.diaphragm)], ['C', 'Collector × ' + fmtK(fl.collector)]].map(([key, txt]) =>
    el('button', { type: 'button', className: 'btn btn-sm' + (key === lvl ? ' btn-primary' : ' btn-ghost'), onClick() { pick.setLevel && pick.setLevel(key); } }, txt))));
  lvBar.appendChild(grpBox(lab('Load combination:'), el('select', { className: 'form-input', 'data-combo': '1', style: { width: 'auto', padding: '2px 6px', fontSize: '0.8rem' },
    onChange(e) { pick.setBasis && pick.setBasis(e.target.value); } },
  ...['LRFD', 'ASD'].map(b => el('option', { value: b, selected: b === basis }, comboLabel(cs0.kind, b))))));
  box.appendChild(lvBar);
  box.appendChild(el('div', { className: 'td-forces-shown', style: { fontSize: '0.82rem', fontWeight: 600, margin: '0 0 0.5rem', padding: '4px 8px', borderLeft: '3px solid var(--accent)', background: 'var(--surface-2, #f8fafc)' } },
    forcesShown(cs0, lvl, kL, fl, results.q, { basis, kc, acts: reversed ? acts.reversed : envelope ? '±' + csE.dir : acts.entered, reversed, envelope })));
  if (envelope && view !== 4) box.appendChild(el('p', { 'data-envelope-note': 'shear', style: { ...small, margin: '0 0 0.4rem' } },
    'Envelope: each cell shows max |v| of the two senses (' + acts.entered + ', ' + acts.reversed + ') — sheathing capacity is the same either way, so this is the value for diaphragm selection. Hover a cell for both senses and the one that governs.'));
  if (sense === 'envelope' && revBad) box.appendChild(el('p', { 'data-envelope-note': 'bad', style: { ...small, color: 'var(--fail)', margin: '0 0 0.4rem' } },
    'Envelope not available: the reversed sense (' + acts.reversed + ') is ' + revBad + ' (Checks tab). This view shows the entered sense (' + acts.entered + ').'));
  if (envelope && csR.notClosed) box.appendChild(el('p', { style: { ...small, color: 'var(--fail)', margin: '0 0 0.4rem' } },
    'The reversed sense (' + acts.reversed + ') has member runs that do not close (' + csR.notClosed + ') — marked "open" below.'));
  // the walls of the story above at the level shown (step 7)
  const abv = (cs0.above || []).filter(a => a.V);
  if (abv.length) {
    const f = kc * (lvl === 'D' ? (fl.transfer ?? 2.5) : lvl === 'C' ? kL : 1);
    const t = el('table', { className: 'dynamic-table', 'data-abovevalues': lvl, style: { fontSize: '0.78rem', marginBottom: '0.5rem' } });
    t.appendChild(el('tr', null, el('th', null, 'Wall above'), el('th', null, 'Line'), el('th', null, 'Goes'), el('th', null, 'V 1.0 (lb)'), el('th', null, 'V shown (lb)'), el('th', null, 'Into the floor (plf)')));
    for (const a of abv) t.appendChild(el('tr', null, el('td', null, a.mark), el('td', null, a.line), el('td', null, a.kind === 'transfer' ? '↓ into this diaphragm' : '↕ down its line'),
      el('td', { className: 'mono' }, f0(a.V)), el('td', { className: 'mono' }, f0(a.V * f)), el('td', { className: 'mono', title: 'Wall-to-floor transfer connection: V / wall length' }, f0(a.V * f / Math.max(1e-9, a.to - a.from)))));
    box.appendChild(el('div', { className: 'table-scroll' }, t));
  }
  const zs = pick.zoom || { zoom: 1, panX: 0, panY: 0 }; // shared by every view and case (held by the module)
  const ov = pick.overlays || { lines: true, outlines: true };
  const show = pick.show || { chord: true, cross: true };
  // view buttons in two groups; the tooltip keeps the View 1–4 names of the docs
  const vbtn = (n, t) => el('button', { type: 'button', title: 'View ' + n, className: 'btn btn-sm' + (n === view ? ' btn-primary' : ' btn-ghost'), onClick() { pick.setView(n); } }, t);
  const grp = (name, ...b) => el('span', { style: { display: 'inline-flex', gap: '3px', alignItems: 'center' } }, el('span', { style: { fontSize: '0.78rem', color: 'var(--ink-secondary)', marginRight: '2px' } }, name), ...b);
  box.appendChild(el('div', { style: { display: 'flex', gap: '6px 18px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.4rem' } },
    grp('Unit shear:', vbtn(1, 'Basic v_b'), vbtn(2, 'TD v_TD'), vbtn(3, 'Net v_net')), grp('Forces:', vbtn(4, 'Members N'))));
  const check = (on, txt, fn) => el('label', null, el('input', { type: 'checkbox', checked: on, onChange(e) { fn(e.target.checked); } }), ' ' + txt);
  const zoomTxt = el('span', { className: 'mono', style: { fontSize: '0.75rem', color: 'var(--ink-tertiary)', minWidth: '3.5em' } });
  const canvas = el('div', { className: 'td-canvas' }), legendBox = el('div');
  const redraw = () => drawCanvas();
  box.appendChild(el('div', { style: { display: 'flex', gap: '6px 12px', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.8rem', marginBottom: '4px' } },
    check(ov.lines !== false, 'line forces & wall shares', x => pick.setOverlays({ ...ov, lines: x })),
    check(ov.outlines !== false, 'diaphragm / TD outlines', x => pick.setOverlays({ ...ov, outlines: x })),
    check(ov.walls !== false, 'walls below (this level)', x => pick.setOverlays({ ...ov, walls: x })),
    (plan.wallsAbove || []).length ? check(ov.above !== false, 'walls above (story above)', x => pick.setOverlays({ ...ov, above: x })) : null,
    ...(view === 4 ? [['chord', 'members along the span (chords, struts)'], ['cross', 'across the span (collectors, drag struts)']].map(([k, t]) =>
      check(show[k] !== false, t, x => pick.setShow({ ...show, [k]: x }))) : []),
    el('span', { style: { flex: 1 } }),
    el('button', { type: 'button', className: 'btn btn-ghost btn-sm', title: 'Smaller text', onClick() { zs.text = Math.max(0.8, (zs.text || TEXT_DEFAULT) / 1.2); redraw(); } }, 'A−'),
    el('button', { type: 'button', className: 'btn btn-ghost btn-sm', title: 'Larger text', onClick() { zs.text = Math.min(3, (zs.text || TEXT_DEFAULT) * 1.2); redraw(); } }, 'A+'),
    ...zoomButtons(plan, zs, redraw), zoomTxt));
  const titles = { 1: ['View 1 — basic unit shear v', el('sub', null, 'b'), ' = V / d'], 2: ['View 2 — TD unit shear v_TD'], 3: ['View 3 — net unit shear v_net = v_b + v_TD'], 4: ['View 4 — chord, strut, collector and drag forces (net field)'] };
  box.appendChild(el('div', { className: 'section-header' }, ...titles[view]));
  if ((cs0.paused || []).length) {
    box.appendChild(pausedPanel(cs0, view));
    if (view > 1) return box; // gate: nothing of the incomplete net field is drawn
  } else if (cs0.failed) { // the line forces do not balance the load (calcAll): nothing of this case is valid but the basic shear
    box.appendChild(el('div', { className: 'td-paused', style: { border: '1px solid var(--fail)', color: 'var(--fail)', borderRadius: '6px', padding: '6px 10px', fontSize: '0.85rem', marginBottom: '6px' } },
      el('strong', null, 'FAILED — ' + cs0.failed + '. '), view === 1 ? 'The basic shear below is valid; the line forces and wall shares are not (held from Shear Wall Design).' : 'TD shear, net shear and member forces are not reported. Basic shear: Basic v_b.'));
    if (view > 1) return box;
  } else if (cs0.notClosed) { // balances, but member runs stay open (user 2026-11-04): shown, held from SWD
    box.appendChild(el('div', { className: 'td-failed', style: { border: '1px solid var(--fail)', color: 'var(--fail)', borderRadius: '6px', padding: '6px 10px', fontSize: '0.85rem', marginBottom: '6px' } },
      el('strong', null, 'FAILED — member runs do not close. '), 'The line forces are held from Shear Wall Design. ' + (view === 4 ? 'Open runs: ' + cs0.notClosed + '.' : 'View 4 shows the open member runs.')));
  }
  box.appendChild(canvas);
  box.appendChild(legendBox);
  function drawCanvas() {
    const envShear = envelope && view < 4;
    const d = envShear ? drawShearEnvelope(plan, cs, envB, view, zs, ov, { a: acts.entered, b: acts.reversed })
      : view === 1 ? drawBasicShear(plan, cs, zs, ov) : view === 2 ? drawTdShear(plan, cs, zs, ov) : view === 3 ? drawNetShear(plan, cs, zs, ov) : drawMembers(plan, cs, show, zs, ov);
    attachZoomPan(d.svg, d.group, d.view, plan, zs, redraw);
    attachReadout(d.svg, d.view, plan, envShear ? { ...cs, envShear: { b: envB, acts: { a: acts.entered, b: acts.reversed } } } : cs, view, show);
    canvas.replaceChildren(d.svg);
    legendBox.replaceChildren(scaleLegend(d.scale, view === 4), planLegend({ result: true }));
    zoomTxt.textContent = 'zoom ' + Math.round(zs.zoom * 100) + ' % · text ' + Math.round((zs.text || TEXT_DEFAULT) * 100) + ' %';
  }
  drawCanvas();
  box.appendChild(el('p', { style: small }, 'Wheel = zoom about the cursor, drag = pan, A− / A+ = text size; zoom and text size are kept when you switch views or load cases. Values hidden on small cells appear as you zoom in. Move the mouse over the plan for the value under it (Members: N on the nearest line).'));
  if (view === 2 || view === 3) {
    box.appendChild(el('p', { style: small }, view === 2
      ? 'Segment shears of each TD that ran (TDs tab), book "+" element, plf. Outside the TDs v_TD = 0.'
      : 'Net shear = basic + TD shear (plf, book "+" element); outside the TDs it equals the basic shear. Values at the cell ends along the span.'));
    if (!(cs.fields || []).length) box.appendChild(el('p', { style: { ...small, color: 'var(--stale)' } }, 'No TD has results in this load case (TDs tab).'));
    return box;
  }
  if (view === 4) {
    box.appendChild(el('p', { style: small }, 'Every line is a member: N = ∫ (v on one side − v on the other − wall reaction) from a free end, on the net field; tension +. A wall line runs continuously across a gap inside the outline (strut). Each run must close to ~0 at its far end (Checks tab).'));
    box.appendChild(el('div', { className: 'table-scroll', style: { maxHeight: '360px', overflowY: 'auto' } }, memberTable(cs)));
    return box;
  }
  box.appendChild(el('p', { style: small },
    'Flexible diaphragm, span by span: each diaphragm is a beam between its two support lines. Values at the band ends (plf); + = the book\'s "+" sheathing element. '
    + 'Line forces are positive in the load direction. A line without a wall passes its force to the TD it loads (orange).'));

  // line forces and walls
  const lt = el('table', { className: 'dynamic-table' });
  lt.appendChild(el('tr', null, ...['Line', 'Force (lb)', 'Made of', 'Walls: share (lb) · v (plf)', 'Split'].map(h => el('th', null, h))));
  for (const ln of [...cs.lines].sort((a, b) => a.at - b.at)) {
    lt.appendChild(el('tr', null, el('td', null, ln.name), el('td', { className: 'mono' }, f0(ln.P)),
      el('td', { style: { fontSize: '0.78rem' } }, (ln.from || []).map(f => f.src + ' ' + f0(f.F * cs.sigma)).join(' · ')
        + (cs.offset && (ln.walls || []).length ? ' → iterated to closure (table below)' : '')),
      el('td', { className: 'mono', style: { fontSize: '0.8rem' } }, ln.into ? 'into ' + ln.into.join(', ') : (ln.walls || []).map(w => (w.mark || 'wall') + ' ' + f0(w.share) + ' · ' + f1(w.v)).join('; ') || (ln.noWall ? 'no wall' : '—')),
      el('td', { style: { fontSize: '0.78rem' } }, (ln.walls || []).length ? (ln.walls[0].basis === 'swd' ? 'Shear Wall Design' : ln.walls[0].basis === 'group' ? 'by length across ' + ln.group : 'by length') : '')));
  }
  const total = cs.diaphragms.reduce((t, d) => t + d.load, 0) * cs.sigma;
  const sumLines = cs.lines.reduce((t, l) => t + l.P, 0);
  box.appendChild(el('div', { className: 'section-header', style: { marginTop: '0.8rem' } }, 'Line forces and wall shares'));
  box.appendChild(el('div', { className: 'table-scroll' }, lt));
  box.appendChild(el('p', { style: { ...small, color: Math.abs(total - sumLines) < 0.5 ? 'var(--pass)' : 'var(--fail)' } },
    'Total load ' + f0(total) + ' lb · Σ line forces ' + f0(sumLines) + ' lb' + (Math.abs(total - sumLines) < 0.5 ? ' ✓' : ' ✗')));
  if (cs.offset) box.appendChild(offsetTable(cs));

  // section shears per diaphragm at the grid stations
  for (const d of cs.diaphragms) {
    const st = plan.grids.filter(g => g.axis === cs.axis && g.at >= d.lo - 1e-6 && g.at <= d.hi + 1e-6).sort((a, b) => a.at - b.at);
    const t = el('table', { className: 'dynamic-table' });
    t.appendChild(el('tr', null, ...['Station', 'V − (lb)', 'V + (lb)', 'v − per band (plf)', 'v + per band (plf)'].map(h => el('th', null, h))));
    const bandTxt = sec => sec.parts.filter(p => p.id === d.id).flatMap(p => p.bands.map(b => f1(b.v) + (p.bands.length > 1 ? ' [' + f1(b.lo) + '–' + f1(b.hi) + ']' : ''))).join(', ') || '—';
    // envelope: max |v| of the two senses per band (the governing sense named), max |V|
    const dB = envelope && envB ? envB.diaphragms.find(x => x.id === d.id) : null;
    const secOf = (dd, cse, at, side) => sectionAt({ ...cse, diaphragms: [dd] }, at, side);
    const envTxt = (sa, sb) => sa.parts.filter(p => p.id === d.id).flatMap((p, pi) => p.bands.map((b, bi) => {
      const ob = ((sb.parts.filter(q => q.id === d.id)[pi] || {}).bands || [])[bi];
      const vb = ob ? ob.v : 0, gov = Math.abs(vb) > Math.abs(b.v) + 1e-9 ? acts.reversed : acts.entered;
      return f1(Math.max(Math.abs(b.v), Math.abs(vb))) + ' (' + gov + ')' + (p.bands.length > 1 ? ' [' + f1(b.lo) + '–' + f1(b.hi) + ']' : '');
    })).join(', ') || '—';
    for (const g of st) {
      if (dB) {
        const ma = secOf(d, cs, g.at, '-'), pa = secOf(d, cs, g.at, '+'), mb = secOf(dB, envB, g.at, '-'), pb = secOf(dB, envB, g.at, '+');
        const lo = g.at <= d.lo + 1e-6, hi = g.at >= d.hi - 1e-6;
        t.appendChild(el('tr', { 'data-env-row': '1' }, el('td', null, g.name + ' (' + f1(g.at) + ')'),
          el('td', { className: 'mono' }, lo ? '' : f0(Math.max(Math.abs(ma.V), Math.abs(mb.V)))), el('td', { className: 'mono' }, hi ? '' : f0(Math.max(Math.abs(pa.V), Math.abs(pb.V)))),
          el('td', { className: 'mono' }, lo ? '' : envTxt(ma, mb)), el('td', { className: 'mono' }, hi ? '' : envTxt(pa, pb))));
        continue;
      }
      const m = sectionAt({ ...cs, diaphragms: [d] }, g.at, '-'), p = sectionAt({ ...cs, diaphragms: [d] }, g.at, '+');
      const lo = g.at <= d.lo + 1e-6, hi = g.at >= d.hi - 1e-6;
      t.appendChild(el('tr', null, el('td', null, g.name + ' (' + f1(g.at) + ')'),
        el('td', { className: 'mono' }, lo ? '' : f0(m.V)), el('td', { className: 'mono' }, hi ? '' : f0(p.V)),
        el('td', { className: 'mono' }, lo ? '' : bandTxt(m)), el('td', { className: 'mono' }, hi ? '' : bandTxt(p))));
    }
    box.appendChild(el('div', { className: 'section-header', style: { marginTop: '0.8rem' } },
      'Diaphragm ' + (d.mark || '') + ' — ' + cs.axis + ' ' + f1(d.lo) + ' to ' + f1(d.hi) + ', load ' + f0(d.load * cs.sigma) + ' lb, reactions ' + d.supports.map(s => s.name + ' ' + f0(-s.R * cs.sigma)).join(' / ')
));
    for (const st of d.stretches || []) box.appendChild(el('p', { style: small },
      'Opening ' + cs.axis + ' ' + f1(st.a) + '–' + f1(st.b) + ': inflection (opening-edge chords 0) at ' + f1(st.sInf) + ', bands share V by width at ' + f1(st.sRef) + ' — ' + st.rule + '.'));
    box.appendChild(el('div', { className: 'table-scroll' }, t));
  }
  return box;
}

// ---------------------------------------------------------------- Phase 6: Views 2–4
const toXY = (cs, s, c) => (cs.axis === 'x' ? [s, c] : [c, s]);

// View 2: the TD unit shears on their segments (the TD mark comes with its outline)
export function drawTdShear(plan, cs, zs = {}, ov = {}) {
  const { root, v, layer, top, group } = paintPlan(plan, cs, zs, ov);
  const fields = cs.fields || [];
  const vmax = Math.max(1e-9, ...fields.flatMap(f => f.segs.map(s => Math.abs(s.v))));
  for (const f of fields) for (const sg of f.segs) {
    const r = f.along === 'x' ? { x1: sg.lo, x2: sg.hi, y1: f.rect.y1, y2: f.rect.y2 } : { x1: f.rect.x1, x2: f.rect.x2, y1: sg.lo, y2: sg.hi };
    layer.appendChild(tip(svg('rect', { x: v.sx(r.x1), y: v.sy(r.y2), width: (r.x2 - r.x1) * v.k, height: (r.y2 - r.y1) * v.k,
      fill: sg.v >= 0 ? POS : NEG, 'fill-opacity': (0.1 + 0.5 * Math.abs(sg.v) / vmax).toFixed(3), stroke: '#fff', 'stroke-width': 0.5 }),
      `v_TD ${f1(sg.v)} plf · ${f.mark} · x ${f1(r.x1)}–${f1(r.x2)}, y ${f1(r.y1)}–${f1(r.y2)}`));
    layer.appendChild(label(v.sx((r.x1 + r.x2) / 2), v.sy((r.y1 + r.y2) / 2) + 3, f1(sg.v), { 'font-weight': 600 }));
  }
  if (ov.lines !== false) drawLineForces(plan, cs, v, top);
  return { svg: root, group, view: v, scale: { max: vmax, unit: 'plf', name: 'v_TD' } };
}

// View 3: net unit shear v_b + v_TD, cell by cell (values at the cell ends along the span)
export function drawNetShear(plan, cs, zs = {}, ov = {}) {
  const { root, v, layer, top, group } = paintPlan(plan, cs, zs, ov);
  const fields = cs.fields || [];
  const { S, C } = breaks(plan, cs, fields);
  const cells = [];
  for (let i = 0; i < S.length - 1; i++) for (let j = 0; j < C.length - 1; j++) {
    const a = S[i], b = S[i + 1], p = C[j], q = C[j + 1], cm = (p + q) / 2;
    if (b - a < 1e-6 || q - p < 1e-6 || vNetAt(cs, fields, (a + b) / 2, cm) === null) continue;
    cells.push({ a, b, p, q, va: vNetAt(cs, fields, a, cm, 1, 0), vb: vNetAt(cs, fields, b, cm, -1, 0) });
  }
  const vmax = Math.max(1e-9, ...cells.flatMap(c => [Math.abs(c.va), Math.abs(c.vb)]));
  for (const c of cells) {
    const [x1, y1] = toXY(cs, c.a, c.p), [x2, y2] = toXY(cs, c.b, c.q);
    const vm = (c.va + c.vb) / 2;
    layer.appendChild(tip(svg('rect', { x: v.sx(x1), y: v.sy(y2), width: (x2 - x1) * v.k, height: (y2 - y1) * v.k,
      fill: vm >= 0 ? POS : NEG, 'fill-opacity': (0.08 + 0.45 * Math.abs(vm) / vmax).toFixed(3), stroke: '#fff', 'stroke-width': 0.5 }),
      `v_net ${f1(c.va)}${Math.abs(c.va - c.vb) >= 0.05 ? ' → ' + f1(c.vb) : ''} plf · ${where(cs, c.a, c.b, c.p, c.q)}`));
    const len = (c.b - c.a) * v.k, dep = (c.q - c.p) * v.k;
    if (dep < 14 * TS || len < 30 * TS) continue;
    const at = (s, val, anchor) => { const [x, y] = toXY(cs, s, (c.p + c.q) / 2);
      return label(cs.axis === 'x' ? v.sx(x) + (anchor === 'start' ? 3 : -3) : v.sx(x), cs.axis === 'x' ? v.sy(y) + 3 : v.sy(y) + (anchor === 'start' ? -4 : 11), f1(val), { 'text-anchor': cs.axis === 'x' ? anchor : 'middle', 'font-size': 9 }); };
    layer.appendChild(at(c.a, c.va, 'start'));
    if (Math.abs(c.va - c.vb) >= 0.05 && len >= 60 * TS) layer.appendChild(at(c.b, c.vb, 'end'));
  }
  if (ov.lines !== false) drawLineForces(plan, cs, v, top);
  return { svg: root, group, view: v, scale: { max: vmax, unit: 'plf', name: 'v_net' } };
}

// ── Unit shear envelope of the two senses (user 2026-11-10, Views 1–3): an overlay of the two runs already calculated —
// per cell, at each end, max |v| of the two senses and the sense that governs (sheathing capacity is the same either
// way, so the selection value is |v|). kind 1 basic, 2 TD, 3 net. a / b = the entered / reversed case (same level).
const ENV = '#7c3aed'; // max |v| has no sign: one neutral colour
// v of one sense at (s, c) approached from sSide (kind 1 basic, 2 TD = net − basic, 3 net); null = no sheathing
function shearOf(cs, kind, s, c, sSide = 0) {
  const vb = vNetAt(cs, [], s, c, sSide, 0);
  if (vb === null) return null;
  if (kind === 1) return vb;
  const vn = vNetAt(cs, cs.fields || [], s, c, sSide, 0);
  return kind === 2 ? vn - vb : vn;
}
// max |v| of the two senses at a point: { v: max |v|, from: 'a' | 'b', va, vb } (null = no sheathing in either)
export function envShearAt(a, b, kind, s, c, sSide = 0) {
  const va = shearOf(a, kind, s, c, sSide), vb = shearOf(b, kind, s, c, sSide);
  if (va === null && vb === null) return null;
  const A = Math.abs(va || 0), B = Math.abs(vb || 0);
  return { v: Math.max(A, B), from: B > A + 1e-9 ? 'b' : 'a', va, vb };
}
export function drawShearEnvelope(plan, a, b, kind, zs = {}, ov = {}, acts = { a: 'entered', b: 'reversed' }) {
  const { root, v, layer, top, group } = paintPlan(plan, a, zs, ov, kind === 1 ? 'td-view1' : 'td-view');
  const ba = breaks(plan, a, a.fields || []), bb = breaks(plan, b, b.fields || []);
  const uniq = xs => [...new Set(xs.map(x => Math.round(x * 1e6) / 1e6))].sort((p, q) => p - q);
  const S = uniq([...ba.S, ...bb.S]), C = uniq([...ba.C, ...bb.C]);
  const cells = [];
  for (let i = 0; i < S.length - 1; i++) for (let j = 0; j < C.length - 1; j++) {
    const s0 = S[i], s1 = S[i + 1], p = C[j], q = C[j + 1], cm = (p + q) / 2;
    if (s1 - s0 < 1e-6 || q - p < 1e-6 || envShearAt(a, b, kind, (s0 + s1) / 2, cm) === null) continue;
    const e0 = envShearAt(a, b, kind, s0, cm, 1), e1 = envShearAt(a, b, kind, s1, cm, -1);
    if (!e0 || !e1) continue;
    if (kind === 2 && e0.v < 0.05 && e1.v < 0.05) continue; // outside the TDs v_TD = 0
    cells.push({ s0, s1, p, q, e0, e1 });
  }
  const vmax = Math.max(1e-9, ...cells.flatMap(c => [c.e0.v, c.e1.v]));
  const name = kind === 1 ? 'v_b' : kind === 2 ? 'v_TD' : 'v_net';
  const sense = e => (e.from === 'a' ? acts.a : acts.b);
  for (const c of cells) {
    const [x1, y1] = toXY(a, c.s0, c.p), [x2, y2] = toXY(a, c.s1, c.q);
    const vm = (c.e0.v + c.e1.v) / 2;
    layer.appendChild(tip(svg('rect', { x: v.sx(x1), y: v.sy(y2), width: (x2 - x1) * v.k, height: (y2 - y1) * v.k,
      fill: ENV, 'fill-opacity': (0.06 + 0.45 * vm / vmax).toFixed(3), stroke: '#fff', 'stroke-width': 0.5 }),
      `max |${name}| ${f1(c.e0.v)}${Math.abs(c.e0.v - c.e1.v) >= 0.05 ? ' → ' + f1(c.e1.v) : ''} plf (${sense(c.e0)}) · ${acts.a}: ${f1(c.e0.va)} · ${acts.b}: ${f1(c.e0.vb)} · ${where(a, c.s0, c.s1, c.p, c.q)}`));
    const len = (c.s1 - c.s0) * v.k, dep = (c.q - c.p) * v.k;
    if (dep < 14 * TS || len < 30 * TS) continue;
    const at = (s, val, anchor) => { const [x, y] = toXY(a, s, (c.p + c.q) / 2);
      return label(a.axis === 'x' ? v.sx(x) + (anchor === 'start' ? 3 : -3) : v.sx(x), a.axis === 'x' ? v.sy(y) + 3 : v.sy(y) + (anchor === 'start' ? -4 : 11), f1(val), { 'text-anchor': a.axis === 'x' ? anchor : 'middle', 'font-size': 9 }); };
    layer.appendChild(at(c.s0, c.e0.v, 'start'));
    if (Math.abs(c.e0.v - c.e1.v) >= 0.05 && len >= 60 * TS) layer.appendChild(at(c.s1, c.e1.v, 'end'));
  }
  if (ov.lines !== false) drawLineForces(plan, a, v, top);
  return { svg: root, group, view: v, scale: { max: vmax, unit: 'plf', name: 'max |' + name + '|', envelope: true } };
}

// View 4: member force diagrams on their lines (tension blue, compression red); max of each run labelled; at a
// zoom ≥ 200 % also N at the grid crossings and wall ends; a run that does not close is marked "open" at its end.
export function drawMembers(plan, cs, show = { chord: true, cross: true }, zs = {}, ov = {}) {
  const { root, v, layer, top, group } = paintPlan(plan, cs, zs, ov);
  const ms = (cs.members || []).filter(m => show[m.family] !== false);
  const nmax = Math.max(1e-9, ...ms.flatMap(m => m.runs.map(r => Math.abs(r.max))));
  const H = 34 / nmax; // px per lb
  const detail = (zs.zoom || 1) >= 2;
  for (const m of ms) for (const r of m.runs) {
    if (Math.abs(r.max) < 0.5 && runCloses(r)) continue;
    const along = m.family === 'chord' ? cs.axis : crossAxis(cs); // coordinate along the member
    const pts = [...r.points].sort((p, q) => p[0] - q[0]);
    // the diagram is offset across the line: chords (along s) in c, cross members (along c) in s
    const xy = (p, n) => {
      const [x, y] = m.family === 'chord' ? toXY(cs, p, m.at) : toXY(cs, m.at, p);
      const off = n * H;
      const alongX = (m.family === 'chord') === (cs.axis === 'x');
      return alongX ? [v.sx(x), v.sy(y) - off] : [v.sx(x) + off, v.sy(y)];
    };
    // envelope (both senses): the max T diagram and the max C diagram, each on its own side of the line
    const diagrams = r.env ? [[r.env.T, 'max '], [r.env.C, 'max ']] : [[pts, '']];
    for (const [dpts, pre] of diagrams) for (let i = 0; i < dpts.length - 1; i++) {
      const [p0, n0] = dpts[i], [p1, n1] = dpts[i + 1];
      if (p1 - p0 < 1e-9) continue;
      if (Math.abs(n0) < 0.5 && Math.abs(n1) < 0.5) continue; // no force on this stretch: nothing drawn (user 2026-11-10)
      const poly = [xy(p0, 0), xy(p0, n0), xy(p1, n1), xy(p1, 0)].map(q => q.join(',')).join(' ');
      top.appendChild(tip(svg('polygon', { points: poly, fill: n0 + n1 >= 0 ? POS : NEG, 'fill-opacity': 0.35, stroke: n0 + n1 >= 0 ? POS : NEG, 'stroke-width': 0.6 }),
        `${m.name}: ${pre}N ${tc(n0)} → ${tc(n1)} at ${along} ${f1(p0)}–${f1(p1)}`));
    }
    const sideLabel = (p, n, txt, attrs = {}) => { const [lx, ly] = xy(p, n); return label(lx, ly + (n >= 0 ? -3 : 10 * TS), txt, { 'font-size': 9, ...attrs }); };
    // largest tension and largest compression of the run (a run can have both)
    const ext = runExtremes(r);
    for (const x of [ext.T, ext.C]) if (x) top.appendChild(sideLabel(x.at, x.N, 'max ' + tc(x.N), { fill: x.N >= 0 ? '#1d4ed8' : '#b91c1c', 'font-weight': 600 }));
    if (detail) {
      // N at the grids crossing the member and at the wall ends on it (skip the maxima, already labelled)
      const stations = [...plan.grids.filter(g => g.axis === along).map(g => g.at),
        ...plan.walls.filter(w => m.gridId && w.gridId === m.gridId).flatMap(w => [w.from, w.to])];
      for (const p of [...new Set(stations)]) {
        if (p < r.from - 1e-6 || p > r.to + 1e-6 || [ext.T, ext.C].some(x => x && Math.abs(p - x.at) < 1e-3)) continue;
        if (r.env) { // envelope: max T and max C at the station
          for (const n of [nOn(r.env.T, p), nOn(r.env.C, p)]) if (n !== null && Math.abs(n) >= 0.5) top.appendChild(sideLabel(p, n, tc(n), { fill: '#374151' }));
          continue;
        }
        const n = memberN(m, p);
        if (n !== null && Math.abs(n) >= 0.5) top.appendChild(sideLabel(p, n, tc(n), { fill: '#374151' }));
      }
    }
    if (!runCloses(r)) top.appendChild(sideLabel(r.to, r.residual, 'open ' + tc(r.residual), { fill: '#b91c1c', 'font-weight': 700 }));
  }
  if (ov.lines !== false) drawLineForces(plan, cs, v, top);
  return { svg: root, group, view: v, scale: { max: nmax, unit: 'lb', name: 'N' } };
}
const tc = n => (n >= 0 ? 'T ' : 'C ') + f0(Math.abs(n));
// Largest tension / compression along a run: { T: { N, at } | null, C: … } (|N| ≥ 0.5 lb)
export function runExtremes(r) {
  let T = null, C = null;
  for (const [p, n] of r.points) {
    if (n >= 0.5 && (!T || n > T.N)) T = { N: n, at: p };
    if (n <= -0.5 && (!C || n < C.N)) C = { N: n, at: p };
  }
  return { T, C };
}

// Closure solver (tdClosure.js): one row per pass (line / collector forces, TD loads, closure)
function offsetTable(cs) {
  const o = cs.offset, box = el('div');
  const names = o.passes[0].lines.map(l => l.name), tds = o.passes[0].tdP.map(t => t.mark);
  box.appendChild(el('div', { className: 'section-header', style: { marginTop: '0.8rem' } }, 'Closure solver — hand-over forces iterated to closure'));
  const what = [
    ...o.groups.map(g => `offset wall line ${g.name} = walls ${g.walls.join(', ')} on grids ${g.grids.join(', ')} (one line of resistance, shared by wall length)`),
    ...(o.unknowns || []).filter(u => u.kind === 'collector').map(u => `${u.label} (concentrated load; that diaphragm's basic shear is recomputed each pass)`),
    ...(o.unknowns || []).filter(u => u.kind === 'td').map(u => `${u.label}: share of the held TD's reaction`),
  ];
  box.appendChild(el('p', { style: { fontSize: '0.78rem', color: 'var(--ink-secondary)' } },
    (what.length ? what.join('; ') + '. ' : '')
    + 'Pass 0 = flexible line forces. Each pass moves these forces and every wall-line force together (Gauss–Newton on the closure residuals of all member runs) and runs the TDs again, until every member run closes.'));
  if ((o.unknowns || []).length) box.appendChild(el('p', { style: { fontSize: '0.78rem', color: 'var(--ink-secondary)' } },
    'Change from the flexible start: ' + o.unknowns.map(u => `${u.label} ${u.value >= 0 ? '+' : ''}${f0(u.value)} lb`).join(' · ')));
  const t = el('table', { className: 'dynamic-table', style: { fontSize: '0.8rem' } });
  t.appendChild(el('tr', null, ...['Pass', ...names.map(n => n + ' (lb)'), ...tds.map(m => 'P ' + m + ' (lb)'), 'Largest residual (lb)', 'Open runs'].map(h => el('th', null, h))));
  for (const p of o.passes) t.appendChild(el('tr', null, el('td', null, String(p.pass)),
    ...names.map(n => el('td', { className: 'mono' }, f0((p.lines.find(l => l.name === n) || {}).P))),
    ...tds.map(m => { const x = p.tdP.find(q => q.mark === m); return el('td', { className: 'mono' }, x && x.terminal === 'OUTPUT' ? f0(x.P) : '—'); }),
    el('td', { className: 'mono' }, f1(p.maxRes)),
    el('td', { style: { color: p.open ? 'var(--fail)' : 'var(--pass)' } }, p.open ? String(p.open) : '0 ✓')));
  box.appendChild(el('div', { className: 'table-scroll' }, t));
  if (!o.converged) box.appendChild(el('p', { style: { fontSize: '0.8rem', color: 'var(--fail)' } }, `No closure after ${o.passes.length - 1} passes — check the walls, TDs, load lines and collectors listed above.`));
  return box;
}

// View 4 table: every member run with its max and closure residual
export function memberTable(cs) {
  const t = el('table', { className: 'dynamic-table', style: { fontSize: '0.8rem' } });
  t.appendChild(el('tr', null, ...['Line', 'Member', 'Run', 'Max tension (lb)', 'at', 'Max compression (lb)', 'at', 'Closure residual (lb)'].map(h => el('th', null, h))));
  for (const m of cs.members || []) for (const r of m.runs) {
    if (Math.abs(r.max) < 0.5 && Math.abs(r.residual) < 0.5) continue;
    const ok = runCloses(r), { T, C } = runExtremes(r);
    const mono = s => el('td', { className: 'mono' }, s);
    t.appendChild(el('tr', null, el('td', null, m.name), el('td', null, m.family === 'chord' ? 'chord / strut along the span' : 'collector / strut across the span'),
      mono(f1(r.from) + ' – ' + f1(r.to)), mono(T ? 'T ' + f0(T.N) : '—'), mono(T ? f1(T.at) : ''), mono(C ? 'C ' + f0(-C.N) : '—'), mono(C ? f1(C.at) : ''),
      el('td', { className: 'mono', style: { color: ok ? 'var(--pass)' : 'var(--fail)' } }, f0(r.residual) + (ok ? ' ✓' : ' ✗'))));
  }
  return t;
}
