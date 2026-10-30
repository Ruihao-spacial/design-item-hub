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

// The plan in result mode at the shared zoom; `layer` goes just above the sheathing (under the plan lines)
const paintPlan = (plan, cs, zs = {}, ov = {}, cls = 'td-view') => {
  TS = zs.text || TEXT_DEFAULT;
  const state = { ...newEditorState(), dir: cs.dir, sel: null, zoom: zs.zoom || 1, panX: zs.panX || 0, panY: zs.panY || 0 };
  const d = drawPlan(plan, state, [], { result: true, outlines: ov.outlines !== false });
  const layer = svg('g', { class: cls });
  const first = d.group.querySelector('polygon');
  if (first && first.nextSibling) d.group.insertBefore(layer, first.nextSibling); else d.group.appendChild(layer);
  return { root: d.svg, v: d.view, layer, group: d.group };
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
  const { root, v, layer: paint, group } = paintPlan(plan, cs, zs, ov, 'td-view1');
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
  if (ov.lines !== false) drawLineForces(plan, cs, v, paint);
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
// What the Analysis views are showing (seismic: the force level and its factor; wind: as entered)
export function forcesShown(cs, lvl, k, fl, q) {
  if (cs.kind !== 'E') return 'Forces shown: wind, 1.0W as entered on the Plan tab (no factor).';
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

// Value under the mouse at drawing point (px, py) of view v. kind 1–3: unit shear at that point (basic / TD / net);
// kind 4: N on the nearest member line within 10 px (show = member filter). Returns { text, at: [px, py] } or null.
export function readoutAt(plan, cs, v, kind, px, py, show = { chord: true, cross: true }) {
  const x = v.wx(px), y = v.wy(py);
  const [s, c] = cs.axis === 'x' ? [x, y] : [y, x];
  const pos = `x ${f1(x)}, y ${f1(y)}`;
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
    const n = memberN(m, p);
    if (n === null) continue;
    best = { d, text: `${m.name} at ${alongX ? 'x' : 'y'} ${f1(p)}: N = ${tc(n)} lb`, at: alongX ? [px, v.sy(m.at)] : [v.sx(m.at), py] };
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
  const cs0 = cases.find(c => c.id === pick.id) || cases[0];
  box.appendChild(el('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '0.5rem' } },
    ...cases.map(c => el('button', { type: 'button', className: 'btn btn-sm' + (c.id === cs0.id ? ' btn-primary' : ''), onClick() { pick.set(c.id); } }, caseLabel(c)))));
  // force level (seismic): every view and table below shows the case scaled by k (results stay at 1.0E)
  const fl = results.forceLevels || { fx: null, diaphragm: 1, collector: 1 };
  const lvl = cs0.kind === 'E' ? (pick.level || 'E') : 'E';
  const k = lvl === 'D' ? fl.diaphragm : lvl === 'C' ? fl.collector : 1;
  const cs = scaleCase(cs0, k);
  const lvBar = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.4rem' } });
  if (cs0.kind === 'E') {
    lvBar.appendChild(el('span', { style: { fontSize: '0.78rem', color: 'var(--ink-secondary)' } }, 'Force level:'));
    for (const [key, txt] of [['E', '1.0E (F_x)'], ['D', 'Diaphragm × ' + fmtK(fl.diaphragm)], ['C', 'Collector × ' + fmtK(fl.collector)]])
      lvBar.appendChild(el('button', { type: 'button', className: 'btn btn-sm' + (key === lvl ? ' btn-primary' : ' btn-ghost'), onClick() { pick.setLevel && pick.setLevel(key); } }, txt));
  }
  box.appendChild(lvBar);
  box.appendChild(el('div', { className: 'td-forces-shown', style: { fontSize: '0.82rem', fontWeight: 600, margin: '0 0 0.5rem', padding: '4px 8px', borderLeft: '3px solid var(--accent)', background: 'var(--surface-2, #f8fafc)' } },
    forcesShown(cs0, lvl, k, fl, results.q)));
  const view = pick.view || 1;
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
  }
  box.appendChild(canvas);
  box.appendChild(legendBox);
  function drawCanvas() {
    const d = view === 1 ? drawBasicShear(plan, cs, zs, ov) : view === 2 ? drawTdShear(plan, cs, zs, ov) : view === 3 ? drawNetShear(plan, cs, zs, ov) : drawMembers(plan, cs, show, zs, ov);
    attachZoomPan(d.svg, d.group, d.view, plan, zs, redraw);
    attachReadout(d.svg, d.view, plan, cs, view, show);
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
    for (const g of st) {
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
  const { root, v, layer, group } = paintPlan(plan, cs, zs, ov);
  const fields = cs.fields || [];
  const vmax = Math.max(1e-9, ...fields.flatMap(f => f.segs.map(s => Math.abs(s.v))));
  for (const f of fields) for (const sg of f.segs) {
    const r = f.along === 'x' ? { x1: sg.lo, x2: sg.hi, y1: f.rect.y1, y2: f.rect.y2 } : { x1: f.rect.x1, x2: f.rect.x2, y1: sg.lo, y2: sg.hi };
    layer.appendChild(tip(svg('rect', { x: v.sx(r.x1), y: v.sy(r.y2), width: (r.x2 - r.x1) * v.k, height: (r.y2 - r.y1) * v.k,
      fill: sg.v >= 0 ? POS : NEG, 'fill-opacity': (0.1 + 0.5 * Math.abs(sg.v) / vmax).toFixed(3), stroke: '#fff', 'stroke-width': 0.5 }),
      `v_TD ${f1(sg.v)} plf · ${f.mark} · x ${f1(r.x1)}–${f1(r.x2)}, y ${f1(r.y1)}–${f1(r.y2)}`));
    layer.appendChild(label(v.sx((r.x1 + r.x2) / 2), v.sy((r.y1 + r.y2) / 2) + 3, f1(sg.v), { 'font-weight': 600 }));
  }
  if (ov.lines !== false) drawLineForces(plan, cs, v, layer);
  return { svg: root, group, view: v, scale: { max: vmax, unit: 'plf', name: 'v_TD' } };
}

// View 3: net unit shear v_b + v_TD, cell by cell (values at the cell ends along the span)
export function drawNetShear(plan, cs, zs = {}, ov = {}) {
  const { root, v, layer, group } = paintPlan(plan, cs, zs, ov);
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
  if (ov.lines !== false) drawLineForces(plan, cs, v, layer);
  return { svg: root, group, view: v, scale: { max: vmax, unit: 'plf', name: 'v_net' } };
}

// View 4: member force diagrams on their lines (tension blue, compression red); max of each run labelled; at a
// zoom ≥ 200 % also N at the grid crossings and wall ends; a run that does not close is marked "open" at its end.
export function drawMembers(plan, cs, show = { chord: true, cross: true }, zs = {}, ov = {}) {
  const { root, v, layer, group } = paintPlan(plan, cs, zs, ov);
  const ms = (cs.members || []).filter(m => show[m.family] !== false);
  const nmax = Math.max(1e-9, ...ms.flatMap(m => m.runs.map(r => Math.abs(r.max))));
  const H = 34 / nmax; // px per lb
  const detail = (zs.zoom || 1) >= 2;
  for (const m of ms) for (const r of m.runs) {
    if (Math.abs(r.max) < 0.5 && closes(r)) continue;
    const along = m.family === 'chord' ? cs.axis : crossAxis(cs); // coordinate along the member
    const pts = [...r.points].sort((p, q) => p[0] - q[0]);
    // the diagram is offset across the line: chords (along s) in c, cross members (along c) in s
    const xy = (p, n) => {
      const [x, y] = m.family === 'chord' ? toXY(cs, p, m.at) : toXY(cs, m.at, p);
      const off = n * H;
      const alongX = (m.family === 'chord') === (cs.axis === 'x');
      return alongX ? [v.sx(x), v.sy(y) - off] : [v.sx(x) + off, v.sy(y)];
    };
    for (let i = 0; i < pts.length - 1; i++) {
      const [p0, n0] = pts[i], [p1, n1] = pts[i + 1];
      if (p1 - p0 < 1e-9) continue;
      const poly = [xy(p0, 0), xy(p0, n0), xy(p1, n1), xy(p1, 0)].map(q => q.join(',')).join(' ');
      layer.appendChild(tip(svg('polygon', { points: poly, fill: n0 + n1 >= 0 ? POS : NEG, 'fill-opacity': 0.35, stroke: n0 + n1 >= 0 ? POS : NEG, 'stroke-width': 0.6 }),
        `${m.name}: N ${tc(n0)} → ${tc(n1)} at ${along} ${f1(p0)}–${f1(p1)}`));
    }
    const sideLabel = (p, n, txt, attrs = {}) => { const [lx, ly] = xy(p, n); return label(lx, ly + (n >= 0 ? -3 : 10 * TS), txt, { 'font-size': 9, ...attrs }); };
    // largest tension and largest compression of the run (a run can have both)
    const ext = runExtremes(r);
    for (const x of [ext.T, ext.C]) if (x) layer.appendChild(sideLabel(x.at, x.N, 'max ' + tc(x.N), { fill: x.N >= 0 ? '#1d4ed8' : '#b91c1c', 'font-weight': 600 }));
    if (detail) {
      // N at the grids crossing the member and at the wall ends on it (skip the maxima, already labelled)
      const stations = [...plan.grids.filter(g => g.axis === along).map(g => g.at),
        ...plan.walls.filter(w => m.gridId && w.gridId === m.gridId).flatMap(w => [w.from, w.to])];
      for (const p of [...new Set(stations)]) {
        if (p < r.from - 1e-6 || p > r.to + 1e-6 || [ext.T, ext.C].some(x => x && Math.abs(p - x.at) < 1e-3)) continue;
        const n = memberN(m, p);
        if (n !== null && Math.abs(n) >= 0.5) layer.appendChild(sideLabel(p, n, tc(n), { fill: '#374151' }));
      }
    }
    if (!closes(r)) layer.appendChild(sideLabel(r.to, r.residual, 'open ' + tc(r.residual), { fill: '#b91c1c', 'font-weight': 700 }));
  }
  if (ov.lines !== false) drawLineForces(plan, cs, v, layer);
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

// Phase 7: the offset-line iteration, one row per pass (line forces, TD loads, closure)
function offsetTable(cs) {
  const o = cs.offset, box = el('div');
  const names = o.passes[0].lines.map(l => l.name), tds = o.passes[0].tdP.map(t => t.mark);
  box.appendChild(el('div', { className: 'section-header', style: { marginTop: '0.8rem' } }, 'Offset wall lines — line forces iterated to closure'));
  box.appendChild(el('p', { style: { fontSize: '0.78rem', color: 'var(--ink-secondary)' } },
    o.groups.map(g => `${g.name} = walls ${g.walls.join(', ')} on grids ${g.grids.join(', ')} (one line of resistance, shared by wall length)`).join('; ')
    + '. Pass 0 = flexible line forces; each pass moves every wall line by the closure residual of its member runs and runs the TDs again, until every run on a wall line closes.'));
  const t = el('table', { className: 'dynamic-table', style: { fontSize: '0.8rem' } });
  t.appendChild(el('tr', null, ...['Pass', ...names.map(n => n + ' (lb)'), ...tds.map(m => 'P ' + m + ' (lb)'), 'Largest residual (lb)', 'Open runs'].map(h => el('th', null, h))));
  for (const p of o.passes) t.appendChild(el('tr', null, el('td', null, String(p.pass)),
    ...names.map(n => el('td', { className: 'mono' }, f0((p.lines.find(l => l.name === n) || {}).P))),
    ...tds.map(m => { const x = p.tdP.find(q => q.mark === m); return el('td', { className: 'mono' }, x && x.terminal === 'OUTPUT' ? f0(x.P) : '—'); }),
    el('td', { className: 'mono' }, f1(p.maxRes)),
    el('td', { style: { color: p.open ? 'var(--fail)' : 'var(--pass)' } }, p.open ? String(p.open) : '0 ✓')));
  box.appendChild(el('div', { className: 'table-scroll' }, t));
  if (!o.converged) box.appendChild(el('p', { style: { fontSize: '0.8rem', color: 'var(--fail)' } }, `No closure after ${o.passes.length - 1} passes — check the walls, TDs and load lines of the offset line.`));
  return box;
}

// View 4 table: every member run with its max and closure residual
export function memberTable(cs) {
  const t = el('table', { className: 'dynamic-table', style: { fontSize: '0.8rem' } });
  t.appendChild(el('tr', null, ...['Line', 'Member', 'Run', 'Max tension (lb)', 'at', 'Max compression (lb)', 'at', 'Closure residual (lb)'].map(h => el('th', null, h))));
  for (const m of cs.members || []) for (const r of m.runs) {
    if (Math.abs(r.max) < 0.5 && Math.abs(r.residual) < 0.5) continue;
    const ok = closes(r), { T, C } = runExtremes(r);
    const mono = s => el('td', { className: 'mono' }, s);
    t.appendChild(el('tr', null, el('td', null, m.name), el('td', null, m.family === 'chord' ? 'chord / strut along the span' : 'collector / strut across the span'),
      mono(f1(r.from) + ' – ' + f1(r.to)), mono(T ? 'T ' + f0(T.N) : '—'), mono(T ? f1(T.at) : ''), mono(C ? 'C ' + f0(-C.N) : '—'), mono(C ? f1(C.at) : ''),
      el('td', { className: 'mono', style: { color: ok ? 'var(--pass)' : 'var(--fail)' } }, f0(r.residual) + (ok ? ' ✓' : ' ✗'))));
  }
  return t;
}
