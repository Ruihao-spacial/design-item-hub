// Diaphragm Analysis — interactive plan editor (SVG drawing + property panel).
// The plan (grids, outline, openings, walls) is shared by both load directions. Diaphragms, TDs and loads belong
// to one load direction; the direction switch shows one direction at a time with its load arrow.
// Tools: Select · Grid ↕ / Grid ↔ · Outline · Opening · Wall · Diaphragm · + Piece · TD.
// A diaphragm is one or more rectangles (pieces, D1.1, D1.2 …) on the sheathing, analysed as one beam: a drawn
// rectangle is cut to the sheathing that is not yet in another diaphragm of the direction (never over an opening or
// outside the outline); "Fill between supports" makes the pieces from its two support lines.
// Snapping (marker under the cursor, rubber band while drawing): grid intersection → grid line → corners of the
// outline / openings / diaphragms / TDs and wall ends → 0.5 ft. Wheel = zoom about the cursor; drag the background
// (Select) = pan. Edits go through applyClick / the panel and then refresh(true); view changes call refresh(false).
import { el } from '../utils.js';
import { groupMessages, renderMessages } from './tdMessages.js';
import { planBounds, spanAxis, DIR_LABEL, splitRegion, partName, diaphragmArea, parsePlan, gridReaches } from './tdGeometry.js';
import { loadProfile, loadKind } from './tdBasicShear.js';
import { newGrid, newOpening, newWall, newTd, newDiaphragm, newPart, newLoad, newSegment, nextMark, uid } from './tdModel.js';

const NS = 'http://www.w3.org/2000/svg';
const FONT = 'Barlow, Segoe UI, system-ui, sans-serif';
const C = {
  grid: '#94a3b8', gridRef: '#cbd5e1', bubble: '#334155', fill: '#eef2ff', edge: '#1e293b', open: '#ffffff',
  td: 'rgba(245, 158, 11, 0.22)', tdEdge: '#b45309', wall: '#111827', load: '#2563eb', sel: '#db2777', err: '#dc2626',
  pending: '#16a34a', wallLinked: '#4338ca', dg: '#0f766e', dgFill: 'rgba(15, 118, 110, 0.06)', snap: '#16a34a', snapSoft: '#f59e0b',
};
export const EDITOR_W = 900;
const M = 64;          // margin for grid bubbles
const SNAP_PX = 14;

export const TOOLS = [
  ['select', 'Select'], ['gridx', 'Grid ↕'], ['gridy', 'Grid ↔'], ['outline', 'Outline'],
  ['opening', 'Opening'], ['wall', 'Wall'], ['diaphragm', 'Diaphragm'], ['piece', '+ Piece'], ['td', 'TD'],
];
// Plan tab input pages (user 2026-11-03): each page has its own tools and input tables; the whole plan stays drawn
export const PAGES = [
  ['geometry', 'Grids & outline', ['gridx', 'gridy', 'outline', 'opening', 'cornerpick']],
  ['diaphragms', 'Diaphragms & TDs', ['diaphragm', 'piece', 'td']],
  ['walls', 'Shear walls', ['wall']],
];
const PAGE_OF = { grid: 'geometry', opening: 'geometry', outline: 'geometry', diaphragm: 'diaphragms', td: 'diaphragms', wall: 'walls', above: 'walls' };
export const pageOf = state => (PAGES.some(p => p[0] === state.page) ? state.page : 'geometry');
const HINT = {
  select: 'Click an item to select it (Delete removes it — a diaphragm piece first, Esc deselects). Drag an edge of a selected diaphragm piece / TD to move it (snaps to grid lines). Drag the background to pan, wheel to zoom.',
  gridx: 'Click to add a vertical grid line (constant x).',
  gridy: 'Click to add a horizontal grid line (constant y).',
  outline: 'Click the corners in order; each new corner lines up with the last one. Click the first corner (or Finish) to close. This replaces the outline.',
  opening: 'Click two opposite corners of the opening.',
  cornerpick: 'Click the point for the outline corner (snaps to grid intersections and corner lines). Esc cancels.',
  wall: 'Click the two ends of the wall on a grid line.',
  diaphragm: 'Click two opposite corners: the sheathing inside, not yet in another diaphragm of this direction, becomes a new diaphragm (one or more pieces). It spans between the two support lines at its ends (change them in the panel).',
  piece: 'Select a diaphragm, then click two opposite corners: the free sheathing inside is added to it as pieces.',
  td: 'Click two opposite corners of the transfer diaphragm. Its supports and load lines are guessed from the grids; check them in the panel.',
};

export function newEditorState() {
  return { tool: 'select', sel: null, pending: [], zoom: 1, panX: 0, panY: 0, message: '', dir: 'y', layers: { ...LAYERS_ON }, page: 'geometry' };
}

// Plan tab show / hide filter (view only, not stored): diaphragms, TDs, openings
export const LAYERS = [['diaphragms', 'Diaphragms'], ['tds', 'TDs'], ['openings', 'Openings']];
const LAYERS_ON = { diaphragms: true, tds: true, openings: true, above: true, walls: true };
const shown = (state, key) => !state.layers || state.layers[key] !== false;
// extra: more [key, label] layers shown only when the plan has them (walls of the story above, step 5)
export function layerFilter(state, onChange, extra = []) {
  if (!state.layers) state.layers = { ...LAYERS_ON };
  return el('span', { className: 'td-layers', style: { display: 'inline-flex', gap: '8px', alignItems: 'center', fontSize: '0.78rem', color: 'var(--ink-secondary)' } },
    el('span', null, 'Show:'),
    ...[...LAYERS, ...extra].map(([key, label]) => el('label', { style: { display: 'inline-flex', gap: '3px', alignItems: 'center', cursor: 'pointer' } },
      el('input', { type: 'checkbox', checked: shown(state, key), 'data-layer': key,
        onChange(e) { state.layers[key] = e.target.checked; if (!e.target.checked && state.sel && state.sel.kind === key.replace(/s$/, '')) state.sel = null; onChange(); } }),
      label)));
}

const fin = Number.isFinite;
const r2 = v => Math.round(v * 100) / 100;
const fmt = v => (fin(v) ? String(r2(v)) : '?');

// ── view transform ──
export function viewOf(plan, state) {
  const b = planBounds(plan);
  const dx = Math.max(b.x2 - b.x1, 1), dy = Math.max(b.y2 - b.y1, 1);
  let k0 = (EDITOR_W - 2 * M) / dx;
  let H = dy * k0 + 2 * M;
  if (H > 640) { H = 640; k0 = Math.min(k0, (H - 2 * M) / dy); }
  if (H < 280) H = 280;
  const k = k0 * state.zoom;
  return {
    W: EDITOR_W, H, k, b,
    sx: x => M + (x - b.x1) * k + state.panX,
    sy: y => M + (b.y2 - y) * k + state.panY,
    wx: px => (px - M - state.panX) / k + b.x1,
    wy: py => b.y2 - (py - M - state.panY) / k,
  };
}

// w(s) strip beside the plan (below it for a span along x, right of it for a span along y): the summed load of the
// diaphragms in plf, positive in the load direction, with its value at each step / end
function drawLoadProfile(g, v, cs, q, nCases, modes) {
  const prof = loadProfile(cs);
  if (!prof.length) return;
  const wmax = Math.max(1e-9, ...prof.flatMap(p => [Math.abs(p.wa), Math.abs(p.wb)]));
  const H = 18, alongX = cs.axis === 'x';
  const base = alongX ? v.sy(v.b.y1) + 40 : v.sx(v.b.x2) + 40; // baseline, px
  const pt = (s, w) => (alongX ? [v.sx(s), base - H * w / wmax] : [base - H * w / wmax, v.sy(s)]);
  const grp = svg('g', { class: 'td-load-profile' });
  const lineAt = s => (alongX ? [v.sx(s), base] : [base, v.sy(s)]);
  let last = null;
  for (const p of prof) {
    const poly = [lineAt(p.a), pt(p.a, p.wa), pt(p.b, p.wb), lineAt(p.b)].map(c => c.join(',')).join(' ');
    grp.appendChild(svg('polygon', { points: poly, fill: C.load, 'fill-opacity': 0.18, stroke: C.load, 'stroke-width': 1 },
      svg('title', null, `w ${fmt(p.wa)}${Math.abs(p.wa - p.wb) > 0.01 ? ' → ' + fmt(p.wb) : ''} plf at ${cs.axis} ${fmt(p.a)}–${fmt(p.b)}`)));
    // label where the value changes (and at the start)
    if (last === null || Math.abs(last - p.wa) > 0.01) {
      const [x, y] = alongX ? [v.sx(p.a) + 2, base + 11] : [base + 11, v.sy(p.a) - 2];
      grp.appendChild(text(x, y, fmt(Math.round(p.wa * 10) / 10), { fill: C.load, 'font-size': 9, 'text-anchor': 'start', transform: alongX ? null : `rotate(90 ${x} ${y})` }));
    }
    last = p.wb;
  }
  const [x1, y1] = lineAt(prof[0].a), [x2, y2] = lineAt(prof[prof.length - 1].b);
  grp.appendChild(svg('line', { x1, y1, x2, y2, stroke: C.load, 'stroke-width': 1 }));
  const how = modes.map(m => (m === 'seismic' ? 'seismic q·d(s)' + (Number.isFinite(q) ? ', q = ' + fmt(q) + ' psf' : '') : m === 'area' ? 'area psf·d(s)' : m === 'wind' ? 'wind windward + leeward' : 'line plf')).join(' + ');
  const cap = `w(s) on the span beams, plf (${cs.kind === 'E' ? 'E' : 'W'}: ${how})` + (nCases > 1 ? ' — 1 of ' + nCases + ' load cases' : '');
  grp.appendChild(alongX ? text(v.sx(v.b.x2), base + 11, cap, { fill: C.load, 'font-size': 9, 'text-anchor': 'end' })
    : text(base + 11, v.sy(v.b.y1), cap, { fill: C.load, 'font-size': 9, 'text-anchor': 'start', transform: `rotate(-90 ${base + 11} ${v.sy(v.b.y1)})` }));
  g.appendChild(grp);
}

// Wind load: windward arrows outside the windward face pointing at it, leeward arrows outside the leeward face pointing
// away (suction), both in the load direction; each labelled with its plf
function drawWind(g, v, l) {
  const sg = l.acts.startsWith('-') ? -1 : 1, alongX = spanAxis(l.acts) === 'x';
  for (const s of l.segments) {
    if (![s.from, s.to, s.w].every(fin)) continue;
    for (const [face, w, lee] of [['wind', s.w, false], ['lee', s.wl, true]]) {
      if (!fin(w) || !w) continue;
      // face coordinate across the span: windward = the side the load comes from
      const at = alongX ? ((sg < 0) !== lee ? v.b.y2 : v.b.y1) : ((sg < 0) !== lee ? v.b.x2 : v.b.x1);
      const out = (sg < 0) !== lee ? 1 : -1; // outward from the plan, in plan units
      if (alongX) {
        const ys = v.sy(at), d = -out; // screen y grows downward
        const xa = v.sx(s.from), xb = v.sx(s.to), n = Math.max(2, Math.round((xb - xa) / 28));
        const [y0, y1] = lee ? [ys + d * 3, ys + d * 20] : [ys + d * 20, ys + d * 3]; // arrow from y0 to y1 (head at y1)
        g.appendChild(svg('line', { x1: xa, y1: lee ? y1 : y0, x2: xb, y2: lee ? y1 : y0, stroke: C.load, 'stroke-width': 1 }));
        for (let i = 0; i <= n; i++) {
          const xx = xa + (xb - xa) * i / n, h = Math.sign(y1 - y0);
          g.appendChild(svg('path', { d: `M${xx},${y0} L${xx},${y1} M${xx - 3},${y1 - h * 5} L${xx},${y1} L${xx + 3},${y1 - h * 5}`, stroke: C.load, 'stroke-width': 1, fill: 'none' }));
        }
        g.appendChild(text((xa + xb) / 2, ys + d * 26 + (d > 0 ? 8 : 0), fmt(w) + ' plf ' + (lee ? 'leeward' : 'windward'), { fill: C.load, 'font-size': 10 }));
      } else {
        const xs = v.sx(at), d = out;
        const ya = v.sy(s.from), yb = v.sy(s.to), n = Math.max(2, Math.round(Math.abs(yb - ya) / 28));
        const [x0, x1] = lee ? [xs + d * 3, xs + d * 20] : [xs + d * 20, xs + d * 3];
        g.appendChild(svg('line', { x1: lee ? x1 : x0, y1: ya, x2: lee ? x1 : x0, y2: yb, stroke: C.load, 'stroke-width': 1 }));
        for (let i = 0; i <= n; i++) {
          const yy = ya + (yb - ya) * i / n, h = Math.sign(x1 - x0);
          g.appendChild(svg('path', { d: `M${x0},${yy} L${x1},${yy} M${x1 - h * 5},${yy - 3} L${x1},${yy} L${x1 - h * 5},${yy + 3}`, stroke: C.load, 'stroke-width': 1, fill: 'none' }));
        }
        g.appendChild(text(xs + d * 26, (ya + yb) / 2, fmt(w) + ' plf ' + (lee ? 'leeward' : 'windward'), { fill: C.load, 'font-size': 10, 'text-anchor': d > 0 ? 'start' : 'end' }));
      }
    }
  }
}

// Zoom by `factor` about the drawing point (px, py) (drawing units): the plan point under it stays put. Used by the
// editor and the result views (tdViews.js); state holds zoom / panX / panY.
export function zoomAt(plan, state, view, px, py, factor) {
  const wx = view.wx(px), wy = view.wy(py);
  state.zoom = Math.min(20, Math.max(0.2, state.zoom * factor));
  const v2 = viewOf(plan, { ...state, panX: 0, panY: 0 });
  state.panX = px - v2.sx(wx); state.panY = py - v2.sy(wy);
}
// − / + (about the middle of the drawing) / Fit buttons
export function zoomButtons(plan, state, redraw) {
  const btn = (txt, title, fn) => el('button', { type: 'button', className: 'btn btn-ghost btn-sm', title, onClick() { fn(); redraw(); } }, txt);
  const mid = f => { const v = viewOf(plan, state); zoomAt(plan, state, v, v.W / 2, v.H / 2, f); };
  return [btn('−', 'Zoom out', () => mid(1 / 1.25)), btn('+', 'Zoom in', () => mid(1.25)),
    btn('Fit', 'Fit the plan', () => { state.zoom = 1; state.panX = 0; state.panY = 0; })];
}

// Legend of the plan symbols (HTML, under a drawing). result: the result views draw diaphragms / TDs as outlines.
export function planLegend({ result = false } = {}) {
  const sw = (...kids) => { const s = svg('svg', { width: 30, height: 14, viewBox: '0 0 30 14', style: 'vertical-align:middle;flex:none' }); kids.forEach(k => s.appendChild(k)); return s; };
  const item = (swatch, txt) => el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' } }, swatch, txt);
  const items = [
    item(sw(svg('rect', { x: 1, y: 1, width: 28, height: 12, fill: C.fill, stroke: C.edge, 'stroke-width': 1.5 })), 'sheathing (outline)'),
    item(sw(svg('rect', { x: 1, y: 1, width: 28, height: 12, fill: C.open, stroke: C.edge, 'stroke-width': 1, 'stroke-dasharray': '4 2' }),
      svg('line', { x1: 1, y1: 1, x2: 29, y2: 13, stroke: C.edge, 'stroke-width': 0.6 }), svg('line', { x1: 29, y1: 1, x2: 1, y2: 13, stroke: C.edge, 'stroke-width': 0.6 })), 'opening'),
    item(sw(svg('rect', { x: 1, y: 1, width: 28, height: 12, fill: result ? 'none' : C.dgFill, stroke: C.dg, 'stroke-width': 1.5, 'stroke-dasharray': '6 2' })), 'diaphragm (span between its supports)'),
    item(sw(svg('rect', { x: 1, y: 1, width: 28, height: 12, fill: result ? 'none' : C.td, stroke: C.tdEdge, 'stroke-width': 1.5 })), 'transfer diaphragm (TD), arrow = load line'),
    item(sw(svg('line', { x1: 1, y1: 7, x2: 29, y2: 7, stroke: C.wall, 'stroke-width': 5 })), 'shear wall'),
    item(sw(svg('line', { x1: 1, y1: 7, x2: 29, y2: 7, stroke: C.wallLinked, 'stroke-width': 5 })), 'wall from Shear Wall Design'),
    item(sw(svg('path', { d: 'M15,1 L15,12 M11,8 L15,12 L19,8', stroke: C.load, 'stroke-width': 1.5, fill: 'none' })), 'load'),
    item(sw(svg('line', { x1: 1, y1: 7, x2: 29, y2: 7, stroke: C.grid, 'stroke-width': 1, 'stroke-dasharray': '6 3 2 3' })), 'grid line'),
  ];
  if (!result) items.push(item(sw(svg('rect', { x: 1, y: 1, width: 28, height: 12, fill: 'none', stroke: C.sel, 'stroke-width': 2 })), 'selected'));
  return el('div', { className: 'td-legend', style: { display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: '0.75rem', color: 'var(--ink-secondary)', marginTop: '4px' } }, ...items);
}

// Coordinates worth snapping to, per axis: corners of everything drawn (grids are handled first)
function cornerCoords(plan) {
  const xs = [], ys = [];
  plan.outline.forEach(([x, y]) => { xs.push(x); ys.push(y); });
  [...plan.openings, ...plan.tds, ...plan.diaphragms.flatMap(d => d.parts)].forEach(r => { xs.push(r.x1, r.x2); ys.push(r.y1, r.y2); });
  plan.walls.forEach(w => { if (!w.axis) return; if (w.axis === 'x') { xs.push(w.at); ys.push(w.from, w.to); } else { ys.push(w.at); xs.push(w.from, w.to); } });
  return { xs: xs.filter(fin), ys: ys.filter(fin) };
}

// Snap a world point. k = px per ft. Returns the point and what it snapped to (for the marker).
export function snapPoint(plan, x, y, k) {
  const tol = SNAP_PX / k;
  const pick = (v, cands) => {
    let best = null;
    for (const c of cands) if (fin(c) && Math.abs(c - v) <= tol && (best === null || Math.abs(c - v) < Math.abs(best - v))) best = c;
    return best;
  };
  // a bounded grid (user 2026-11-05) snaps only where it runs
  const gx = pick(x, plan.grids.filter(g => g.axis === 'x' && gridReaches(g, y, tol)).map(g => g.at));
  const gy = pick(y, plan.grids.filter(g => g.axis === 'y' && gridReaches(g, x, tol)).map(g => g.at));
  const cc = cornerCoords(plan);
  const ox = gx ?? pick(x, cc.xs);
  const oy = gy ?? pick(y, cc.ys);
  return { x: ox ?? Math.round(x * 2) / 2, y: oy ?? Math.round(y * 2) / 2, onGridX: gx !== null, onGridY: gy !== null, onX: ox !== null, onY: oy !== null };
}

// grid lines read-only: locked by the engineer, or shared from another DA item (edited there; user 2026-11-05)
const gridsReadOnly = inputs => !!inputs.gridsLocked || !!(inputs.refs && inputs.refs.gridSource);
const gridAt = (plan, axis, at) => plan.grids.find(g => g.axis === axis && fin(g.at) && Math.abs(g.at - at) < 1e-6);

function nextGridName(inputs, axis) {
  const names = inputs.grids.filter(g => g.axis === axis).map(g => g.name);
  if (axis === 'x') { let n = 1; while (names.includes(String(n))) n++; return String(n); }
  for (let i = 0; i < 26; i++) { const c = String.fromCharCode(65 + i); if (!names.includes(c)) return c; }
  return 'G' + names.length;
}

// Grids of one axis, sorted, excluding reference stations
const linesOf = (plan, axis) => plan.grids.filter(g => g.axis === axis && fin(g.at) && !g.ref).sort((a, b) => a.at - b.at);
// The grid nearest a coordinate, within tol; else the nearest one inside [lo, hi]
function nearLine(lines, at, tol, lo, hi) {
  let best = null;
  for (const g of lines) if (Math.abs(g.at - at) <= tol && (!best || Math.abs(g.at - at) < Math.abs(best.at - at))) best = g;
  if (best) return best;
  const inside = lines.filter(g => g.at >= lo - 1e-6 && g.at <= hi + 1e-6);
  return inside.length ? inside.reduce((a, g) => (Math.abs(g.at - at) < Math.abs(a.at - at) ? g : a)) : null;
}

// Rectangle edges within tol (ft) of a grid line move onto it (diaphragms and TDs stay on the grid)
export function snapRectToGrids(plan, r, tol) {
  const out = { ...r };
  for (const [k, axis] of [['x1', 'x'], ['x2', 'x'], ['y1', 'y'], ['y2', 'y']]) {
    const g = nearLine(linesOf(plan, axis), r[k], tol, Infinity, -Infinity);
    if (g) out[k] = g.at;
  }
  return out;
}

// The outermost two grid lines of one axis within [lo, hi] (tol): the supports of a rectangle spanning along that
// axis. A line short of an end leaves an overhang (cantilever); a single line gives a single support.
function outerLines(plan, axis, lo, hi, tol) {
  const ls = linesOf(plan, axis).filter(g => g.at >= lo - tol && g.at <= hi + tol);
  return ls.length > 1 ? [ls[0], ls[ls.length - 1]] : ls;
}

// Default TD supports / loads: the TD spans along its longer side; supports = the outermost lines across it
// (top / right first), load lines = the same-direction grids strictly between the supports. tol in ft.
export function guessTdLines(plan, t, tol = 0.5) {
  const alongY = (t.y2 - t.y1) >= (t.x2 - t.x1);
  const axis = alongY ? 'y' : 'x';
  const [lo, hi] = alongY ? [t.y1, t.y2] : [t.x1, t.x2];
  const supports = outerLines(plan, axis, lo, hi, tol).reverse();
  const [s1, s2] = supports.length === 2 ? [supports[1].at, supports[0].at] : [lo, hi];
  const inner = linesOf(plan, axis).filter(g => g.at > s1 + 1e-6 && g.at < s2 - 1e-6 && !supports.includes(g));
  return { supports: supports.map(g => g.id), loads: inner.slice(0, 2).map(g => ({ gridId: g.id, side: '+' })) };
}

// A new overhang of a TD (pt: the parsed TD): from the support the rectangle runs past (not yet used by another
// overhang) to the grid line at that end of the rectangle — blank where there is none. Returns { fromId, toId, at }.
export function guessOverhang(plan, pt, taken = []) {
  const sup = pt ? pt.supports.filter(Boolean) : [];
  const out = { fromId: '', toId: '', at: '' };
  if (sup.length !== 2 || sup[0].axis !== sup[1].axis) return out;
  const ax = sup[0].axis, [lo, hi] = ax === 'x' ? [pt.x1, pt.x2] : [pt.y1, pt.y2];
  const [s1, s2] = sup.slice().sort((a, b) => a.at - b.at);
  const free = g => !taken.some(o => o && o.fromId === g.id);
  const pick = [[s1, lo, lo < s1.at - 1e-6], [s2, hi, hi > s2.at + 1e-6]].find(([g, , past]) => past && free(g))
    || [[s1, lo], [s2, hi]].find(([g]) => free(g));
  if (!pick) return out;
  out.fromId = pick[0].id;
  const tip = linesOf(plan, ax).find(g => Number.isFinite(pick[1]) && Math.abs(g.at - pick[1]) < 1e-6 && g !== pick[0]);
  if (tip) out.toId = tip.id;
  return out;
}

// Default diaphragm supports: the span runs across the load; supports = the outermost lines of constant span
// coordinate within the rectangle (an end without a line overhangs). tol in ft.
export function guessDiaphragmSupports(plan, d, dir, tol = 0.5) {
  const ax = spanAxis(dir);
  const [lo, hi] = ax === 'x' ? [d.x1, d.x2] : [d.y1, d.y2];
  return outerLines(plan, ax, lo, hi, tol).map(g => g.id);
}

// Move one edge of a TD / diaphragm piece (edge 'x1' | 'x2' | 'y1' | 'y2') to `at` (partId: the piece; default
// the first). A support that sat on the old edge moves to the grid line at the new edge when there is one.
// Returns true when the inputs changed.
export function setEdge(inputs, plan, kind, id, edge, at, partId = null) {
  const list = kind === 'td' ? inputs.tds : inputs.diaphragms;
  const owner = list && list.find(x => x.id === id);
  const r = owner && kind !== 'td' ? (owner.parts || []).find(q => q.id === partId) || (owner.parts || [])[0] : owner;
  if (!r || !fin(at)) return false;
  const axis = edge[0];
  const other = Number(r[edge === axis + '1' ? axis + '2' : axis + '1']);
  if (Math.abs(at - other) < 0.5) return false; // keep a real rectangle
  const old = Number(r[edge]);
  if (Math.abs(old - at) < 1e-9) return false;
  r[edge] = String(r2(at));
  const lo = Math.min(Number(r[axis + '1']), Number(r[axis + '2'])), hi = Math.max(Number(r[axis + '1']), Number(r[axis + '2']));
  r[axis + '1'] = String(r2(lo)); r[axis + '2'] = String(r2(hi));
  const onNew = gridAt(plan, axis, at);
  owner.supports = (owner.supports || []).map(gid => {
    const g = plan.gridById.get(gid);
    return g && g.axis === axis && Math.abs(g.at - old) < 1e-6 && onNew ? onNew.id : gid;
  });
  return true;
}

// The free sheathing of a rectangle for a diaphragm of direction dir, as pieces: cut to the sheathed plan, clear of
// every other diaphragm of the direction (keepId: a diaphragm whose pieces do not count as taken)
export function cutPieces(plan, dir, rect, keepId = null) {
  const avoid = plan.diaphragms.filter(d => d.dir === dir && d.id !== keepId).flatMap(d => d.parts).filter(q => [q.x1, q.x2, q.y1, q.y2].every(fin));
  return splitRegion(plan, rect, spanAxis(dir), avoid).map(q => ({ x1: r2(q.x1), x2: r2(q.x2), y1: r2(q.y1), y2: r2(q.y2) }));
}

// Fill between supports: the diaphragm's pieces become the sheathing between its two support lines that no other
// diaphragm of the direction holds. Returns the number of pieces (0 = nothing changed, state.message says why).
export function fillBetweenSupports(inputs, plan, id, state = {}) {
  const d = inputs.diaphragms.find(x => x.id === id), pd = plan.diaphragms.find(x => x.id === id);
  if (!d || !pd) return 0;
  const sAx = spanAxis(pd.dir);
  const sup = pd.supports.filter(g => g && g.axis === sAx && fin(g.at));
  if (sup.length !== 2 || Math.abs(sup[0].at - sup[1].at) < 1e-6) { state.message = (d.mark || 'Diaphragm') + ': pick its two support lines first.'; return 0; }
  const [lo, hi] = sup.map(g => g.at).sort((a, b) => a - b);
  const b = planBounds(plan);
  const rect = sAx === 'x' ? { x1: lo, x2: hi, y1: b.y1, y2: b.y2 } : { x1: b.x1, x2: b.x2, y1: lo, y2: hi };
  const pieces = cutPieces(plan, pd.dir, rect, d.id);
  if (!pieces.length) { state.message = (d.mark || 'Diaphragm') + ': no free sheathing between ' + sup.map(g => g.name).join(' and ') + '.'; return 0; }
  d.parts = pieces.map(q => newPart(uid('dp'), q));
  state.message = (d.mark || 'Diaphragm') + ': ' + pieces.length + ' piece(s) between ' + sup.map(g => g.name).join(' and ') + '.';
  return pieces.length;
}

// One click of the active tool at a snapped world point. Mutates inputs / state; returns true when inputs changed.
export function applyClick(inputs, plan, state, p, k = 10) {
  state.message = '';
  const pend = state.pending;
  const tol = Math.max(0.5, 8 / k);
  switch (state.tool) {
    case 'cornerpick': { // outline corner picked on the plan (user 2026-11-03): set corner #index, or insert after it
      const pk = state.pick || { index: inputs.outline.length - 1, insert: true };
      const pt = { x: String(r2(p.x)), y: String(r2(p.y)) };
      let n;
      if (pk.insert) { inputs.outline.splice(pk.index + 1, 0, pt); n = pk.index + 2; }
      else if (inputs.outline[pk.index]) { inputs.outline[pk.index] = pt; n = pk.index + 1; }
      else return false;
      state.tool = 'select'; state.pick = null;
      state.message = 'Outline corner ' + n + ' at (' + pt.x + ', ' + pt.y + ').';
      return true;
    }
    case 'gridx': case 'gridy': {
      const axis = state.tool === 'gridx' ? 'x' : 'y';
      if (gridsReadOnly(inputs)) { state.message = inputs.gridsLocked ? 'Grid lines are locked — unlock them on Grids & outline.' : 'Grid lines are shared from another Diaphragm Analysis item — edit them there.'; return false; }
      const at = axis === 'x' ? p.x : p.y;
      if (gridAt(plan, axis, at)) { state.message = 'A grid line is already there.'; return false; }
      const g = newGrid(nextGridName(inputs, axis), axis, r2(at));
      inputs.grids.push(g);
      state.sel = { kind: 'grid', id: g.id };
      return true;
    }
    case 'outline': {
      const q = lineUp(pend, p);
      if (pend.length) {
        const first = pend[0], last = pend[pend.length - 1];
        if (pend.length >= 3 && Math.abs(q.x - first.x) < 1e-6 && Math.abs(q.y - first.y) < 1e-6) return finishOutline(inputs, state);
        if (Math.abs(q.x - last.x) < 1e-6 && Math.abs(q.y - last.y) < 1e-6) return false;
      }
      pend.push(q);
      state.message = pend.length + ' corner(s). Click the first corner or press Finish to close.';
      return false;
    }
    case 'opening': case 'td': case 'wall': case 'diaphragm': case 'piece': {
      const target = state.tool === 'piece' && state.sel && state.sel.kind === 'diaphragm' && inputs.diaphragms.find(x => x.id === state.sel.id && x.dir === state.dir);
      if (state.tool === 'piece' && !target) { state.pending = []; state.message = 'Select the diaphragm to add the piece to first (click it, or its row in the panel).'; return false; }
      // a diaphragm / TD is cut to the sheathing: without a closed outline it would be stored uncut (user 2026-11-03)
      if (['diaphragm', 'piece', 'td'].includes(state.tool) && (plan.outline || []).length < 4) {
        state.pending = []; state.message = 'Draw and close the outline first (Grids & outline page): a diaphragm or TD is cut to the sheathing inside it.'; return false;
      }
      if (!pend.length) { pend.push({ x: p.x, y: p.y }); state.message = 'Now click the opposite corner / end.'; return false; }
      const a = pend[0];
      state.pending = [];
      if (state.tool === 'wall') {
        let axis = null, at = null, from, to;
        if (Math.abs(a.x - p.x) < 1e-6) { axis = 'x'; at = a.x; from = a.y; to = p.y; }
        else if (Math.abs(a.y - p.y) < 1e-6) { axis = 'y'; at = a.y; from = a.x; to = p.x; }
        const g = axis && gridAt(plan, axis, at);
        if (!g) { state.message = 'A wall must lie on a grid line: click both ends on the same grid.'; return false; }
        if (Math.abs(to - from) < 1e-6) { state.message = 'The wall has no length.'; return false; }
        const w = newWall(g.id, r2(Math.min(from, to)), r2(Math.max(from, to)), g.name, nextMark(inputs.walls, 'SW'));
        inputs.walls.push(w);
        state.sel = { kind: 'wall', id: w.id };
        return true;
      }
      let rect = { x1: Math.min(a.x, p.x), x2: Math.max(a.x, p.x), y1: Math.min(a.y, p.y), y2: Math.max(a.y, p.y) };
      if (state.tool !== 'opening') rect = snapRectToGrids(plan, rect, tol);
      const [x1, x2, y1, y2] = [rect.x1, rect.x2, rect.y1, rect.y2].map(r2);
      if (x2 - x1 < 1e-6 || y2 - y1 < 1e-6) { state.message = 'The rectangle has no area.'; return false; }
      rect = { x1, x2, y1, y2 };
      if (state.tool === 'opening') {
        const o = newOpening(x1, x2, y1, y2);
        o.name = nextMark(inputs.openings.map(x => ({ mark: x.name })), 'OP');
        inputs.openings.push(o);
        state.sel = { kind: 'opening', id: o.id };
      } else if (state.tool === 'piece') {
        const pieces = cutPieces(plan, state.dir, rect);
        if (!pieces.length) { state.message = 'No free sheathing in that rectangle (outline, openings and the other diaphragms are left out).'; return false; }
        pieces.forEach(q => target.parts.push(newPart(uid('dp'), q)));
        state.sel = { kind: 'diaphragm', id: target.id, part: target.parts[target.parts.length - 1].id };
        state.message = target.mark + ': ' + pieces.length + ' piece(s) added — now ' + target.parts.length + '.';
      } else if (state.tool === 'diaphragm') {
        const pieces = cutPieces(plan, state.dir, rect);
        if (!pieces.length) { state.message = 'No free sheathing in that rectangle (outline, openings and the other diaphragms are left out).'; return false; }
        const box = { x1: Math.min(...pieces.map(q => q.x1)), x2: Math.max(...pieces.map(q => q.x2)), y1: Math.min(...pieces.map(q => q.y1)), y2: Math.max(...pieces.map(q => q.y2)) };
        const sup = guessDiaphragmSupports(plan, box, state.dir, tol);
        const d = newDiaphragm(nextMark(inputs.diaphragms.filter(x => x.dir === state.dir), 'D'), state.dir, pieces, sup);
        inputs.diaphragms.push(d);
        state.sel = { kind: 'diaphragm', id: d.id };
        const nm = sup.map(id => plan.gridById.get(id).name);
        const ln = spanAxis(state.dir) === 'x' ? '↕' : '↔';
        state.message = d.mark + ' (' + pieces.length + ' piece' + (pieces.length > 1 ? 's' : '') + '): ' + (sup.length === 2 ? 'spans between ' + nm.join(' / ') :
          sup.length === 1 ? 'only support line ' + nm[0] + ' found inside it — add the second (a cantilever still needs a back-span support) or drag an edge to a ' + ln + ' grid'
            : 'no ' + ln + ' grid line inside it — add grid lines or drag its edges onto them') + '. Check in the panel.';
      } else {
        const t = newTd(nextMark(inputs.tds, 'TD'), x1, x2, y1, y2, state.dir);
        const guess = guessTdLines(plan, rect, tol);
        t.supports = guess.supports;
        t.loadsMode = 'auto'; // load lines found from the plan (user 2026-11-03)
        inputs.tds.push(t);
        state.sel = { kind: 'td', id: t.id };
        const pt = parsePlan(inputs).tds.find(x => x.id === t.id);
        const sideTxt = s => (s === 'both' ? 'both sides' : s === '-' ? (pt.supports[0] && pt.supports[0].axis === 'y' ? 'left' : 'below') : (pt.supports[0] && pt.supports[0].axis === 'y' ? 'right' : 'above'));
        state.message = t.mark + ': supports ' + (guess.supports.length === 2 ? guess.supports.map(id => plan.gridById.get(id).name).join(' / ') : 'not found — pick them') +
          (pt.loads.length ? ', load line ' + pt.loads.map(l => l.grid.name + ' (' + sideTxt(l.side) + ')').join(', ') + ' found on the plan'
            : ', no load line found (no notch / opening / outline edge meets its long edges)') + '. Check them in the panel.';
      }
      return true;
    }
    default: return false;
  }
}

// Outline corners line up with the previous corner (horizontal or vertical edge)
function lineUp(pend, p) {
  const q = { x: p.x, y: p.y };
  if (pend.length) {
    const last = pend[pend.length - 1];
    if (Math.abs(q.x - last.x) < Math.abs(q.y - last.y)) q.x = last.x; else q.y = last.y;
  }
  return q;
}

export function finishOutline(inputs, state) {
  const pts = state.pending;
  if (pts.length < 4) { state.message = 'An outline needs at least 4 corners.'; return false; }
  const first = pts[0], last = pts[pts.length - 1];
  if (Math.abs(first.x - last.x) > 1e-6 && Math.abs(first.y - last.y) > 1e-6) {
    state.message = 'The last corner must line up with the first one (same x or same y).';
    return false;
  }
  inputs.outline = pts.map(q => ({ x: String(r2(q.x)), y: String(r2(q.y)) }));
  state.pending = [];
  state.tool = 'select';
  state.message = 'Outline set.';
  return true;
}

export function deleteSelected(inputs, state) {
  const s = state.sel;
  if (!s) return false;
  if (s.kind === 'corner') {
    if (!inputs.outline[s.id]) return false;
    inputs.outline.splice(s.id, 1); state.sel = null; return true;
  }
  const lists = { grid: 'grids', opening: 'openings', wall: 'walls', td: 'tds', diaphragm: 'diaphragms' };
  const list = inputs[lists[s.kind]];
  if (!list) return false;
  if (s.kind === 'grid' && gridsReadOnly(inputs)) { state.message = inputs.gridsLocked ? 'Grid lines are locked — unlock them to delete one.' : 'Grid lines are shared from another Diaphragm Analysis item — delete it there.'; return false; }
  const i = list.findIndex(x => x.id === s.id);
  if (i < 0) return false;
  // a selected piece of a diaphragm with several pieces: only that piece
  const d = list[i];
  if (s.kind === 'diaphragm' && s.part && Array.isArray(d.parts) && d.parts.length > 1) {
    const j = d.parts.findIndex(q => q.id === s.part);
    if (j >= 0) { d.parts.splice(j, 1); state.sel = { kind: 'diaphragm', id: d.id }; return true; }
  }
  list.splice(i, 1);
  state.sel = null;
  return true;
}

// ── SVG ──
function svg(tag, attrs, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, String(v));
  }
  for (const c of kids) {
    if (c == null || c === false) continue;
    if (typeof c === 'string' || typeof c === 'number') e.appendChild(document.createTextNode(String(c)));
    else e.appendChild(c);
  }
  return e;
}
const text = (x, y, s, attrs = {}) => svg('text', { x, y, 'font-family': FONT, 'font-size': 11, fill: C.bubble, 'text-anchor': 'middle', ...attrs }, s);

// Support symbol on a diaphragm / TD: a heavy line on the support grid with small triangles, drawn only where the
// diaphragm's pieces (a TD: its rectangle) meet the line
function supportMark(v, d, g, col) {
  const grp = svg('g');
  const rects = (d.parts || [d]).filter(q => [q.x1, q.x2, q.y1, q.y2].every(fin));
  const on = rects.filter(q => (g.axis === 'x' ? g.at >= q.x1 - 1e-6 && g.at <= q.x2 + 1e-6 : g.at >= q.y1 - 1e-6 && g.at <= q.y2 + 1e-6))
    .map(q => (g.axis === 'x' ? [q.y1, q.y2] : [q.x1, q.x2])).sort((a, b) => a[0] - b[0]);
  const runs = [];
  for (const [a, b] of on) { const l = runs[runs.length - 1]; if (l && a <= l[1] + 1e-6) l[1] = Math.max(l[1], b); else runs.push([a, b]); }
  for (const [a, b] of runs) {
    if (g.axis === 'x') {
      const x = v.sx(g.at), ya = v.sy(b), yb = v.sy(a);
      grp.appendChild(svg('line', { x1: x, y1: ya, x2: x, y2: yb, stroke: col, 'stroke-width': 3.5, 'stroke-opacity': 0.7 }));
      for (const y of [ya + 10, (ya + yb) / 2, yb - 10]) grp.appendChild(svg('path', { d: `M${x},${y} l-7,-5 l0,10 z`, fill: col, 'fill-opacity': 0.8 }));
    } else {
      const y = v.sy(g.at), xa = v.sx(a), xb = v.sx(b);
      grp.appendChild(svg('line', { x1: xa, y1: y, x2: xb, y2: y, stroke: col, 'stroke-width': 3.5, 'stroke-opacity': 0.7 }));
      for (const x of [xa + 10, (xa + xb) / 2, xb - 10]) grp.appendChild(svg('path', { d: `M${x},${y} l-5,7 l10,0 z`, fill: col, 'fill-opacity': 0.8 }));
    }
  }
  return grp;
}

// Edges of a set of non-overlapping rectangles: the outer boundary of their union, and the shared (inner) edges.
// Returns { outer: [[x1, y1, x2, y2]], inner: [...] } in plan coordinates.
export function pieceEdges(rects) {
  const outer = [], inner = [];
  rects.forEach((r, i) => {
    const edges = [['y', r.y1, r.x1, r.x2], ['y', r.y2, r.x1, r.x2], ['x', r.x1, r.y1, r.y2], ['x', r.x2, r.y1, r.y2]];
    for (const [ax, at, lo, hi] of edges) {
      // stretches of this edge shared with another piece (collinear edge of a neighbour)
      const shared = [];
      rects.forEach((q, j) => {
        if (j === i) return;
        const cand = ax === 'y' ? [[q.y1, q.x1, q.x2], [q.y2, q.x1, q.x2]] : [[q.x1, q.y1, q.y2], [q.x2, q.y1, q.y2]];
        for (const [c, a, b] of cand) if (Math.abs(c - at) < 1e-6) { const p = Math.max(lo, a), e = Math.min(hi, b); if (e - p > 1e-6) shared.push([p, e, j]); }
      });
      shared.sort((a, b) => a[0] - b[0]);
      let t = lo;
      const seg = (a, b, out) => { if (b - a > 1e-6) out.push(ax === 'y' ? [a, at, b, at] : [at, a, at, b]); };
      for (const [a, b, j] of shared) { seg(t, a, outer); if (i < j) seg(a, b, inner); t = Math.max(t, b); } // inner edge drawn once
      seg(t, hi, outer);
    }
  });
  return { outer, inner };
}

// The drawing alone (also used read-only by later views). Shows the plan and the items of state.dir.
// opts.onPick(kind, id) makes items clickable.
export function drawPlan(plan, state, errors, opts = {}) {
  const v = viewOf(plan, state);
  const dir = state.dir || 'y';
  const bad = new Set((errors || []).filter(e => !e.warn).map(e => e.ref).filter(Boolean));
  const isSel = (kind, id) => state.sel && state.sel.kind === kind && state.sel.id === id;
  const pick = (kind, id, part) => opts.onPick ? (e) => { e.stopPropagation(); opts.onPick(kind, id, part); } : null;
  const cursor = opts.onPick ? 'cursor:pointer' : '';
  const root = svg('svg', { xmlns: NS, viewBox: `0 0 ${v.W} ${v.H}`, width: '100%', style: 'max-width:' + v.W + 'px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;user-select:none;touch-action:none;outline:none', tabindex: 0 });
  const g = svg('g', { class: 'td-plan' });
  root.appendChild(g);

  // sheathed outline and openings
  const o = plan.outline.filter(p => fin(p[0]) && fin(p[1]));
  if (o.length >= 3) g.appendChild(svg('polygon', { points: o.map(p => v.sx(p[0]) + ',' + v.sy(p[1])).join(' '), fill: C.fill, stroke: (errors || []).some(e => !e.warn && e.code.startsWith('outline')) ? C.err : C.edge, 'stroke-width': 2.5 }));
  for (const op of shown(state, 'openings') ? plan.openings : []) {
    if (![op.x1, op.x2, op.y1, op.y2].every(fin)) continue;
    const [x, y, w, h] = [v.sx(op.x1), v.sy(op.y2), (op.x2 - op.x1) * v.k, (op.y2 - op.y1) * v.k];
    const col = isSel('opening', op.id) ? C.sel : bad.has(op.id) ? C.err : C.edge;
    g.appendChild(svg('g', { style: cursor, onClick: pick('opening', op.id) },
      svg('rect', { x, y, width: w, height: h, fill: C.open, stroke: col, 'stroke-width': 1.5, 'stroke-dasharray': '6 3' }),
      svg('line', { x1: x, y1: y, x2: x + w, y2: y + h, stroke: col, 'stroke-width': 0.8 }),
      svg('line', { x1: x + w, y1: y, x2: x, y2: y + h, stroke: col, 'stroke-width': 0.8 }),
      op.name ? text(x + w / 2, y + h / 2 - 4, op.name, { fill: col }) : null));
  }

  // diaphragms of this direction: their pieces (fill), the outline of the union (dashed), the edges between pieces
  // (dotted) and the support marks where the pieces meet the support lines. Result views (opts.result) draw
  // diaphragms and TDs as outlines only, so the result colours are the only fills; opts.outlines === false leaves
  // them out. A selected diaphragm shows its piece names (D1.1 …); a selected piece is outlined.
  const showRects = opts.outlines !== false;
  for (const d of showRects && shown(state, 'diaphragms') ? plan.diaphragms.filter(x => x.dir === dir) : []) {
    const rects = d.parts.filter(q => [q.x1, q.x2, q.y1, q.y2].every(fin) && q.x2 > q.x1 && q.y2 > q.y1);
    if (!rects.length) continue;
    const sel = isSel('diaphragm', d.id);
    const col = sel ? C.sel : bad.has(d.id) ? C.err : C.dg;
    const grp = svg('g', { style: cursor });
    for (const q of rects) grp.appendChild(svg('rect', { x: v.sx(q.x1), y: v.sy(q.y2), width: (q.x2 - q.x1) * v.k, height: (q.y2 - q.y1) * v.k,
      fill: opts.result ? 'none' : C.dgFill, stroke: 'none', 'pointer-events': opts.result ? 'none' : 'all', onClick: pick('diaphragm', d.id, q.id) }));
    const { outer, inner } = pieceEdges(rects);
    for (const [a, b, c, e] of outer) grp.appendChild(svg('line', { x1: v.sx(a), y1: v.sy(b), x2: v.sx(c), y2: v.sy(e), stroke: col, 'stroke-width': sel ? 2.5 : 1.5, 'stroke-dasharray': '10 4', 'pointer-events': 'none' }));
    for (const [a, b, c, e] of inner) grp.appendChild(svg('line', { x1: v.sx(a), y1: v.sy(b), x2: v.sx(c), y2: v.sy(e), stroke: col, 'stroke-width': 0.8, 'stroke-dasharray': '2 3', 'stroke-opacity': 0.7, 'pointer-events': 'none' }));
    const big = rects.reduce((m, q) => ((q.x2 - q.x1) * (q.y2 - q.y1) > (m.x2 - m.x1) * (m.y2 - m.y1) ? q : m), rects[0]);
    grp.appendChild(text(v.sx(big.x1) + 18, v.sy(big.y1) - 10, d.mark || 'D', { fill: col, 'font-weight': 700, 'font-size': 13, 'pointer-events': 'none' }));
    if (sel && !opts.result) d.parts.forEach((q, i) => {
      if (!rects.includes(q)) return;
      const on = state.sel.part === q.id;
      if (on) grp.appendChild(svg('rect', { x: v.sx(q.x1) + 2, y: v.sy(q.y2) + 2, width: Math.max((q.x2 - q.x1) * v.k - 4, 1), height: Math.max((q.y2 - q.y1) * v.k - 4, 1), fill: 'none', stroke: C.sel, 'stroke-width': 1.5, 'pointer-events': 'none' }));
      grp.appendChild(text(v.sx((q.x1 + q.x2) / 2), v.sy((q.y1 + q.y2) / 2) + 4, partName(d, i), { fill: col, 'font-size': 11, 'font-weight': on ? 700 : 400, 'pointer-events': 'none' }));
    });
    for (const s of d.supports) if (s && fin(s.at)) grp.appendChild(supportMark(v, d, s, col));
    g.appendChild(grp);
  }

  // TDs of this direction
  for (const t of showRects && shown(state, 'tds') ? plan.tds.filter(x => x.dir === dir) : []) {
    if (![t.x1, t.x2, t.y1, t.y2].every(fin)) continue;
    const [x, y, w, h] = [v.sx(t.x1), v.sy(t.y2), (t.x2 - t.x1) * v.k, (t.y2 - t.y1) * v.k];
    const col = isSel('td', t.id) ? C.sel : bad.has(t.id) ? C.err : C.tdEdge;
    const grp = svg('g', { style: cursor, onClick: pick('td', t.id) },
      svg('rect', { x, y, width: w, height: h, fill: opts.result ? 'none' : C.td, stroke: col, 'stroke-width': isSel('td', t.id) ? 2.5 : 1.5 }),
      text(x + w / 2, y + 14, t.mark || 'TD', { fill: col, 'font-weight': 600 }));
    for (const s of t.supports) if (s && fin(s.at)) grp.appendChild(supportMark(v, t, s, col));
    for (const l of t.loads) {
      if (!l.grid || !fin(l.grid.at)) continue;
      if (l.grid.axis === 'y') {
        const yy = v.sy(l.grid.at), xe = l.side === '+' ? x + w : x, dr = l.side === '+' ? 1 : -1;
        grp.appendChild(svg('line', { x1: x, y1: yy, x2: x + w, y2: yy, stroke: col, 'stroke-width': 2 }));
        grp.appendChild(svg('path', { d: `M${xe + dr * 22},${yy} L${xe + dr * 4},${yy} M${xe + dr * 10},${yy - 5} L${xe + dr * 4},${yy} L${xe + dr * 10},${yy + 5}`, stroke: col, 'stroke-width': 1.6, fill: 'none' }));
      } else {
        const xx = v.sx(l.grid.at), ye = l.side === '+' ? y : y + h, dr = l.side === '+' ? -1 : 1;
        grp.appendChild(svg('line', { x1: xx, y1: y, x2: xx, y2: y + h, stroke: col, 'stroke-width': 2 }));
        grp.appendChild(svg('path', { d: `M${xx},${ye + dr * 22} L${xx},${ye + dr * 4} M${xx - 5},${ye + dr * 10} L${xx},${ye + dr * 4} L${xx + 5},${ye + dr * 10}`, stroke: col, 'stroke-width': 1.6, fill: 'none' }));
      }
    }
    g.appendChild(grp);
  }

  // grids (dashed, bubbles outside the plan)
  const top = v.sy(v.b.y2) - 26, left = v.sx(v.b.x1) - 26;
  for (const gr of plan.grids) {
    if (!fin(gr.at)) continue;
    const col = isSel('grid', gr.id) ? C.sel : bad.has(gr.id) ? C.err : gr.ref ? C.gridRef : C.grid;
    const grp = svg('g', { style: cursor, onClick: pick('grid', gr.id) });
    // a bounded grid (user 2026-11-05) is drawn over its extent only, with a bubble at each bounded end
    const bubble = (cx, cy) => { grp.appendChild(svg('circle', { cx, cy, r: 10, fill: '#fff', stroke: col, 'stroke-width': 1.2 })); grp.appendChild(text(cx, cy + 4, gr.name, { fill: isSel('grid', gr.id) ? C.sel : C.bubble })); };
    const line = (x1, y1, x2, y2) => {
      grp.appendChild(svg('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': 1, 'stroke-dasharray': '8 4 2 4' }));
      grp.appendChild(svg('line', { x1, y1, x2, y2, stroke: 'transparent', 'stroke-width': 8 }));
    };
    const loB = fin(gr.lo), hiB = fin(gr.hi);
    if (gr.axis === 'x') {
      const x = v.sx(gr.at);
      const yTop = hiB ? v.sy(gr.hi) - 6 : top + 10, yBot = loB ? v.sy(gr.lo) + 6 : v.sy(v.b.y1) + 12;
      line(x, yTop, x, yBot);
      bubble(x, hiB ? yTop - 10 : top);
      if (loB && hiB) bubble(x, yBot + 10);
    } else {
      const y = v.sy(gr.at);
      const xL = loB ? v.sx(gr.lo) - 6 : left + 10, xR = hiB ? v.sx(gr.hi) + 6 : v.sx(v.b.x2) + 12;
      line(xL, y, xR, y);
      bubble(loB ? xL - 10 : left, y);
      if (loB && hiB) bubble(xR + 10, y);
    }
    g.appendChild(grp);
  }

  // walls
  for (const w of shown(state, 'walls') ? plan.walls : []) {
    if (!w.axis || !fin(w.from) || !fin(w.to)) continue;
    const col = isSel('wall', w.id) ? C.sel : bad.has(w.id) ? C.err : w.linked ? C.wallLinked : C.wall;
    const [x1, y1, x2, y2] = w.axis === 'x' ? [v.sx(w.at), v.sy(w.from), v.sx(w.at), v.sy(w.to)] : [v.sx(w.from), v.sy(w.at), v.sx(w.to), v.sy(w.at)];
    const lx = (x1 + x2) / 2 + (w.axis === 'x' ? -12 : 0), ly = (y1 + y2) / 2 + (w.axis === 'x' ? 0 : -8);
    const on = isSel('wall', w.id);
    g.appendChild(svg('g', { style: cursor, onClick: pick('wall', w.id), 'data-wall': w.mark || w.id },
      // selected (user 2026-11-05): a wide halo so the wall is easy to find on the plan
      on ? svg('line', { x1, y1, x2, y2, stroke: C.sel, 'stroke-width': 18, 'stroke-opacity': 0.25, 'stroke-linecap': 'round', 'data-selhalo': '1' }) : null,
      svg('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': on ? 8 : 6, 'stroke-linecap': 'butt' }),
      text(lx, ly, (w.mark || '') + (w.type && w.type !== 'segmented' ? ' ' + w.type.toUpperCase() : ''), { fill: col, 'font-size': on ? 12 : 10, 'font-weight': on ? 700 : null, transform: w.axis === 'x' ? `rotate(-90 ${lx} ${ly})` : null })));
  }

  // walls of the story above (step 5): dashed, beside their grid; amber = ends at this floor (its force goes into this
  // diaphragm), grey = continues down its line. Selectable to find them (read-only: they belong to Shear Wall Design).
  if (shown(state, 'above')) for (const w of plan.wallsAbove || []) {
    if (!w.axis || !fin(w.from) || !fin(w.to) || !fin(w.at)) continue;
    const on = isSel('above', w.id);
    const col = on ? C.sel : w.kind === 'transfer' ? '#d97706' : '#94a3b8';
    const off = 5; // px beside the grid line, so a wall of this level on the same grid stays visible
    const [x1, y1, x2, y2] = w.axis === 'x' ? [v.sx(w.at) + off, v.sy(w.from), v.sx(w.at) + off, v.sy(w.to)] : [v.sx(w.from), v.sy(w.at) - off, v.sx(w.to), v.sy(w.at) - off];
    const lx = (x1 + x2) / 2 + (w.axis === 'x' ? 12 : 0), ly = (y1 + y2) / 2 + (w.axis === 'x' ? 0 : -8);
    const label = (w.mark || '') + (w.kind === 'transfer' ? ' ↓' : ' ↕');
    const grp = svg('g', { 'data-above': w.mark, 'data-kind': w.kind, style: cursor, onClick: pick('above', w.id) },
      on ? svg('line', { x1, y1, x2, y2, stroke: C.sel, 'stroke-width': 16, 'stroke-opacity': 0.25, 'stroke-linecap': 'round', 'data-selhalo': '1' }) : null,
      svg('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': on ? 5 : 4, 'stroke-dasharray': '7 3', 'stroke-linecap': 'butt', opacity: 0.9 }),
      svg('line', { x1, y1, x2, y2, stroke: 'transparent', 'stroke-width': 10 }), // easier to click
      text(lx, ly, label, { fill: col, 'font-size': on ? 11 : 9, 'font-weight': on ? 700 : null, transform: w.axis === 'x' ? `rotate(-90 ${lx} ${ly})` : null }));
    grp.appendChild(svg('title', null, (w.mark || '') + ' — ' + (w.upperLevel || 'story above') + ' story, line ' + w.line + ': ' + (w.kind === 'transfer' ? 'ends at this floor; its force goes into this diaphragm' : 'continues down its line')));
    g.appendChild(grp);
  }
  // collectors set from–to (option 2): a thin amber line on the grid with end bars, once per line
  if (shown(state, 'above')) for (const w of [...new Map((plan.wallsAbove || []).filter(x => x.collector).map(x => [x.swdLineId, x])).values()]) {
    const c = w.collector, vert = w.axis === 'x';
    const [x1, y1, x2, y2] = vert ? [v.sx(w.at), v.sy(c.lo), v.sx(w.at), v.sy(c.hi)] : [v.sx(c.lo), v.sy(w.at), v.sx(c.hi), v.sy(w.at)];
    const bar = (x, y) => (vert ? svg('line', { x1: x - 6, y1: y, x2: x + 6, y2: y, stroke: '#b45309', 'stroke-width': 2 }) : svg('line', { x1: x, y1: y - 6, x2: x, y2: y + 6, stroke: '#b45309', 'stroke-width': 2 }));
    g.appendChild(svg('g', { 'data-collector': w.line, 'pointer-events': 'none' },
      svg('line', { x1, y1, x2, y2, stroke: '#b45309', 'stroke-width': 1.5 }), bar(x1, y1), bar(x2, y2),
      svg('title', null, 'Collector on line ' + w.line + ': ' + c.from + '–' + c.to)));
  }

  // loads of this direction (line loads: arrows along their edge)
  const notes = [];
  for (const l of plan.loads.filter(x => (x.acts.endsWith('x') ? 'x' : 'y') === dir)) {
    const span = spanAxis(l.acts);
    if (l.mode === 'wind') { notes.push('wind acting ' + l.acts + ' (windward / leeward)'); drawWind(g, v, l); continue; }
    if (l.mode !== 'line') { notes.push((l.mode === 'seismic' ? 'seismic F_x / ΣA' : fmt(l.psf) + ' psf') + ' acting ' + l.acts); continue; }
    notes.push('line load acting ' + l.acts + (l.edge ? ' on ' + l.edge.name : ''));
    for (const s of l.segments) {
      if (![s.from, s.to, s.w].every(fin)) continue;
      const pos = l.edge && fin(l.edge.at) ? l.edge.at : null;
      if (span === 'x') {
        const yEdge = pos ?? (l.acts === '-y' ? v.b.y2 : v.b.y1);
        const ys = v.sy(yEdge), d = l.acts === '-y' ? -1 : 1;
        const y0 = ys + d * 20;
        const xa = v.sx(s.from), xb = v.sx(s.to);
        g.appendChild(svg('line', { x1: xa, y1: y0, x2: xb, y2: y0, stroke: C.load, 'stroke-width': 1 }));
        const n = Math.max(2, Math.round((xb - xa) / 28));
        for (let i = 0; i <= n; i++) {
          const xx = xa + (xb - xa) * i / n;
          g.appendChild(svg('path', { d: `M${xx},${y0} L${xx},${ys + d * 3} M${xx - 3},${ys + d * 8} L${xx},${ys + d * 3} L${xx + 3},${ys + d * 8}`, stroke: C.load, 'stroke-width': 1, fill: 'none' }));
        }
        g.appendChild(text((xa + xb) / 2, y0 + d * 6 + (d < 0 ? -2 : 8), fmt(s.w) + (s.w2 != null ? '→' + fmt(s.w2) : '') + ' plf', { fill: C.load, 'font-size': 10 }));
      } else {
        const xEdge = pos ?? (l.acts === '+x' ? v.b.x1 : v.b.x2);
        const xs = v.sx(xEdge), d = l.acts === '+x' ? -1 : 1;
        const x0 = xs + d * 20;
        const ya = v.sy(s.from), yb = v.sy(s.to);
        g.appendChild(svg('line', { x1: x0, y1: ya, x2: x0, y2: yb, stroke: C.load, 'stroke-width': 1 }));
        const n = Math.max(2, Math.round(Math.abs(yb - ya) / 28));
        for (let i = 0; i <= n; i++) {
          const yy = ya + (yb - ya) * i / n;
          g.appendChild(svg('path', { d: `M${x0},${yy} L${xs + d * 3},${yy} M${xs + d * 8},${yy - 3} L${xs + d * 3},${yy} L${xs + d * 8},${yy + 3}`, stroke: C.load, 'stroke-width': 1, fill: 'none' }));
        }
        g.appendChild(text(x0 + d * 8, (ya + yb) / 2, fmt(s.w) + ' plf', { fill: C.load, 'font-size': 10, 'text-anchor': d < 0 ? 'end' : 'start' }));
      }
    }
  }

  // pending clicks of the active tool
  if (state.pending.length) {
    const pts = state.pending.map(p => v.sx(p.x) + ',' + v.sy(p.y)).join(' ');
    if (state.pending.length > 1) g.appendChild(svg('polyline', { points: pts, fill: 'none', stroke: C.pending, 'stroke-width': 2, 'stroke-dasharray': '5 3' }));
    state.pending.forEach(p => g.appendChild(svg('circle', { cx: v.sx(p.x), cy: v.sy(p.y), r: 4, fill: C.pending })));
  }

  // load-direction legend (fixed, top right): big arrow + label
  const lg = svg('g', { transform: `translate(${v.W - 150},10)` },
    svg('rect', { x: 0, y: 0, width: 140, height: 62, rx: 6, fill: '#eff6ff', stroke: C.load, 'stroke-width': 1 }));
  if (dir === 'y') lg.appendChild(svg('path', { d: 'M24,10 L24,52 M14,42 L24,52 L34,42 M14,20 L24,10 L34,20', stroke: C.load, 'stroke-width': 3, fill: 'none' }));
  else lg.appendChild(svg('path', { d: 'M6,31 L44,31 M34,21 L44,31 L34,41 M16,21 L6,31 L16,41', stroke: C.load, 'stroke-width': 3, fill: 'none' }));
  lg.appendChild(text(92, 27, 'Load along ' + dir, { fill: C.load, 'font-weight': 700, 'font-size': 12 }));
  lg.appendChild(text(92, 44, plan.diaphragms.filter(x => x.dir === dir).length + ' diaphragm(s), ' + plan.tds.filter(x => x.dir === dir).length + ' TD(s)', { fill: C.load, 'font-size': 10 }));
  root.appendChild(lg);
  // the load the span beams carry, w(s) in plf, for every load mode (Plan tab: opts.loadCases = the analysis cases)
  const lcs = (opts.loadCases || []).filter(c => c.dir === dir);
  if (lcs.length) {
    const kindOf = l => l.kind || (l.mode === 'seismic' ? 'E' : 'W');
    const modes = [...new Set(plan.loads.filter(l => (l.acts.endsWith('x') ? 'x' : 'y') === dir && kindOf(l) === lcs[0].kind).map(l => l.mode))];
    drawLoadProfile(g, v, lcs[0], opts.q, lcs.length, modes);
  }
  if (notes.length) root.appendChild(text(10, lcs.length ? 16 : v.H - 10, 'Load: ' + notes.join(' · '), { 'text-anchor': 'start', fill: C.load }));
  root.appendChild(text(v.W - 40, v.H - 10, 'x →  y ↑', { fill: '#94a3b8', 'font-size': 10 }));

  // edge handles of the selected diaphragm / TD (drag an edge; it snaps to grid lines)
  if (opts.onEdgeDown && state.sel && (state.sel.kind === 'diaphragm' || state.sel.kind === 'td')) {
    const own = (state.sel.kind === 'td' ? plan.tds : plan.diaphragms).find(x => x.id === state.sel.id && x.dir === dir);
    const r = own && state.sel.kind === 'diaphragm' ? own.parts.find(q => q.id === state.sel.part) || (own.parts.length === 1 ? own.parts[0] : null) : own;
    if (r && [r.x1, r.x2, r.y1, r.y2].every(fin)) {
      const X1 = v.sx(r.x1), X2 = v.sx(r.x2), Y1 = v.sy(r.y1), Y2 = v.sy(r.y2);
      const edges = [['x1', X1, Y2, X1, Y1], ['x2', X2, Y2, X2, Y1], ['y1', X1, Y1, X2, Y1], ['y2', X1, Y2, X2, Y2]];
      for (const [edge, ax1, ay1, ax2, ay2] of edges) {
        const vert = edge[0] === 'x';
        const down = e => { e.stopPropagation(); e.preventDefault(); opts.onEdgeDown(state.sel.kind, own.id, edge, own === r ? null : r.id); };
        g.appendChild(svg('line', { x1: ax1, y1: ay1, x2: ax2, y2: ay2, stroke: 'rgba(219,39,119,0.001)', 'stroke-width': 12, style: 'cursor:' + (vert ? 'ew-resize' : 'ns-resize'), class: 'td-edge', 'data-edge': edge, onMousedown: down }));
        const mx = (ax1 + ax2) / 2, my = (ay1 + ay2) / 2;
        g.appendChild(svg('rect', { x: mx - 5, y: my - 5, width: 10, height: 10, fill: '#fff', stroke: C.sel, 'stroke-width': 2, style: 'cursor:' + (vert ? 'ew-resize' : 'ns-resize'), class: 'td-edge', 'data-edge': edge, onMousedown: down }));
      }
    }
  }

  // live overlay (snap marker, rubber band): filled by the editor on mousemove
  const overlay = svg('g', { class: 'td-overlay', 'pointer-events': 'none' });
  g.appendChild(overlay);
  // outline corners (user 2026-11-03): numbered dots on the Grids & outline page; the selected corner (outline row)
  // or the one being picked gets a ring, so a row can be found on the plan
  if (opts.onPick && pageOf(state) === 'geometry') {
    const raw = opts.outline || [];
    raw.forEach((q, i) => {
      const x = Number(q.x), y = Number(q.y);
      if (!fin(x) || !fin(y) || q.x === '' || q.y === '') return;
      g.appendChild(svg('g', { 'data-corner-dot': i }, svg('circle', { cx: v.sx(x), cy: v.sy(y), r: 3, fill: C.edge }),
        svg('text', { x: v.sx(x) + 5, y: v.sy(y) - 5, 'font-size': 10, fill: C.edge, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3 }, String(i + 1))));
    });
  }
  const ci = state.sel && state.sel.kind === 'corner' ? state.sel.id : state.tool === 'cornerpick' && state.pick && !state.pick.insert ? state.pick.index : null;
  if (ci !== null && opts.outline && opts.outline[ci]) { const m = cornerMarker(v, opts.outline[ci], ci); if (m) g.appendChild(m); }
  return { svg: root, group: g, overlay, view: v };
}

// Ring + number at outline corner i (q = the stored corner { x, y }); null when it has no coordinates yet
export function cornerMarker(v, q, i) {
  const x = Number(q && q.x), y = Number(q && q.y);
  if (!q || q.x === '' || q.y === '' || !fin(x) || !fin(y)) return null;
  return svg('g', { 'data-corner-mark': i, 'pointer-events': 'none' },
    svg('circle', { cx: v.sx(x), cy: v.sy(y), r: 9, fill: 'none', stroke: C.sel, 'stroke-width': 2.5 }),
    svg('circle', { cx: v.sx(x), cy: v.sy(y), r: 3.5, fill: C.sel }),
    svg('text', { x: v.sx(x) + 12, y: v.sy(y) - 10, 'font-size': 12, 'font-weight': 700, fill: C.sel, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3 }, '#' + (i + 1) + ' (' + q.x + ', ' + q.y + ')'));
}

// Snap marker and rubber band for the current tool, at snapped point s
function drawOverlay(overlay, state, v, s) {
  while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
  if (state.tool === 'select' || !s) return;
  const X = v.sx(s.x), Y = v.sy(s.y);
  const strong = s.onGridX && s.onGridY;
  const col = strong ? C.snap : (s.onX || s.onY) ? C.snapSoft : '#64748b';
  if (s.onX) overlay.appendChild(svg('line', { x1: X, y1: Y - 26, x2: X, y2: Y + 26, stroke: col, 'stroke-width': 1, 'stroke-dasharray': '3 2' }));
  if (s.onY) overlay.appendChild(svg('line', { x1: X - 26, y1: Y, x2: X + 26, y2: Y, stroke: col, 'stroke-width': 1, 'stroke-dasharray': '3 2' }));
  overlay.appendChild(strong
    ? svg('rect', { x: X - 6, y: Y - 6, width: 12, height: 12, fill: 'none', stroke: col, 'stroke-width': 2 })
    : svg('circle', { cx: X, cy: Y, r: 5, fill: 'none', stroke: col, 'stroke-width': 2 }));
  const p0 = state.pending[0];
  if (!p0) return;
  const band = { stroke: C.pending, 'stroke-width': 1.5, 'stroke-dasharray': '6 3', fill: 'none' };
  if (state.tool === 'wall') overlay.appendChild(svg('line', { x1: v.sx(p0.x), y1: v.sy(p0.y), x2: X, y2: Y, ...band }));
  else if (state.tool === 'outline') {
    const last = state.pending[state.pending.length - 1];
    const q = lineUp(state.pending, s);
    overlay.appendChild(svg('line', { x1: v.sx(last.x), y1: v.sy(last.y), x2: v.sx(q.x), y2: v.sy(q.y), ...band }));
  } else {
    const x = Math.min(v.sx(p0.x), X), y = Math.min(v.sy(p0.y), Y);
    overlay.appendChild(svg('rect', { x, y, width: Math.abs(X - v.sx(p0.x)), height: Math.abs(Y - v.sy(p0.y)), ...band, fill: 'rgba(22,163,74,0.06)' }));
    overlay.appendChild(text((X + v.sx(p0.x)) / 2, Math.min(y, Y) - 4, r2(Math.abs(s.x - p0.x)) + ' × ' + r2(Math.abs(s.y - p0.y)) + ' ft', { fill: C.pending, 'font-size': 10 }));
  }
}

// Esc: cancel the drawing in progress, else clear the selection, else go back to Select. Returns true if it acted.
export function handleEscape(state) {
  if (state.pending.length) state.pending = [];
  else if (state.sel) state.sel = null;
  else if (state.tool !== 'select') { state.tool = 'select'; state.pick = null; }
  else return false;
  state.message = '';
  return true;
}

// Preview of an edge being dragged: the rectangle with the moved edge at the snapped position
function drawEdgePreview(overlay, plan, v, d, s) {
  while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
  const own = (d.kind === 'td' ? plan.tds : plan.diaphragms).find(x => x.id === d.id);
  const r = own && d.kind !== 'td' ? own.parts.find(q => q.id === d.part) || own.parts[0] : own;
  if (!r) return;
  const q = { x1: r.x1, x2: r.x2, y1: r.y1, y2: r.y2, [d.edge]: d.at };
  const [x1, x2, y1, y2] = [Math.min(q.x1, q.x2), Math.max(q.x1, q.x2), Math.min(q.y1, q.y2), Math.max(q.y1, q.y2)];
  overlay.appendChild(svg('rect', { x: v.sx(x1), y: v.sy(y2), width: (x2 - x1) * v.k, height: (y2 - y1) * v.k, fill: 'rgba(219,39,119,0.06)', stroke: C.sel, 'stroke-width': 2, 'stroke-dasharray': '6 3' }));
  const on = d.edge[0] === 'x' ? s.onGridX : s.onGridY;
  overlay.appendChild(text(v.sx(d.edge[0] === 'x' ? d.at : (x1 + x2) / 2) + 6, v.sy(d.edge[0] === 'y' ? d.at : (y1 + y2) / 2) - 6,
    d.edge[0] + ' = ' + r2(d.at) + (on ? ' (grid)' : ''), { fill: on ? C.snap : C.sel, 'font-size': 11, 'text-anchor': 'start', 'font-weight': 600 }));
}

// The editor: direction switch, toolbar, drawing, panel. refresh(inputsChanged) redraws (recalculates when true).
// loadCases / q (optional): the analysis cases, for the w(s) load strip.
export function renderPlanEditor({ inputs, plan, errors, warnings = [], state, refresh, wallsLinked = false, loadCases = null, q = null }) {
  if (wallsLinked && state.tool === 'wall') state.tool = 'select';
  const page = pageOf(state), pageTools = PAGES.find(p => p[0] === page)[2];
  if (state.tool !== 'select' && !pageTools.includes(state.tool)) { state.tool = 'select'; state.pending = []; }
  state.errors = errors || []; // the panel names issues of the other load direction
  const box = el('div', { className: 'td-editor' });
  // input pages: in the right column, above that page's inputs (user 2026-11-03)
  const pageBar = el('div', { className: 'td-pages', style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '0.5rem', borderBottom: '1px solid var(--border-light)', paddingBottom: '0.4rem' } },
    ...PAGES.map(([k, label]) => el('button', { type: 'button', 'data-page': k, className: 'btn btn-sm' + (page === k ? ' btn-primary' : ' btn-ghost'),
      onClick() { if (page === k) return; state.page = k; state.tool = 'select'; state.pending = []; state.message = ''; refresh(false); } }, label)));
  const dirBar = el('div', { className: 'td-dir', style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' } },
    el('span', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)' } }, 'Load direction:'),
    ...['y', 'x'].map(d => el('button', { type: 'button', className: 'btn btn-sm' + (state.dir === d ? ' btn-primary' : ''),
      onClick() { state.dir = d; state.pending = []; state.sel = null; refresh(false); } }, DIR_LABEL[d])),
    el('span', { style: { fontSize: '0.75rem', color: 'var(--ink-tertiary)' } }, 'Diaphragms, TDs and loads belong to one direction; grids, outline, openings and walls are shared.'));
  const bar = el('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.4rem' } });
  for (const [key, label] of TOOLS.filter(([k]) => k === 'select' || pageTools.includes(k))) {
    const locked = gridsReadOnly(inputs) && (key === 'gridx' || key === 'gridy');
    const off = (wallsLinked && key === 'wall') || locked;
    bar.appendChild(el('button', { type: 'button', className: 'btn btn-sm' + (state.tool === key ? ' btn-primary' : ''), disabled: off,
      title: locked ? 'Grid lines are locked (Grids & outline → Unlock)' : off ? 'Walls come from the linked Shear Wall Design item (Setup)' : '',
      onClick() { state.tool = key; state.pending = []; state.message = ''; refresh(false); } }, label));
  }
  if (state.tool === 'outline' && state.pending.length) bar.appendChild(el('button', { type: 'button', className: 'btn btn-sm', onClick() { const ch = finishOutline(inputs, state); refresh(ch); } }, 'Finish outline'));
  if (state.pending.length) bar.appendChild(el('button', { type: 'button', className: 'btn btn-ghost btn-sm', onClick() { state.pending = []; state.message = ''; refresh(false); } }, 'Cancel'));
  bar.appendChild(el('span', { style: { flex: 1 } }));
  bar.appendChild(layerFilter(state, () => refresh(false), (plan.wallsAbove || []).length ? [['above', 'Walls above']] : []));
  zoomButtons(plan, state, () => refresh(false)).forEach(b => bar.appendChild(b));
  const swdOwned = state.sel && (state.sel.kind === 'above' || (state.sel.kind === 'wall' && String(state.sel.id).startsWith('swd:')));
  if (state.sel && !swdOwned) bar.appendChild(el('button', { type: 'button', className: 'btn btn-ghost btn-sm', style: { color: 'var(--fail)' }, onClick() { if (deleteSelected(inputs, state)) refresh(true); } }, 'Delete selected'));
  box.appendChild(bar);
  box.appendChild(el('div', { style: { fontSize: '0.78rem', color: state.message ? 'var(--ink)' : 'var(--ink-tertiary)', minHeight: '2.4em', marginBottom: '0.3rem' } },
    state.message || HINT[state.tool]));

  let edgeDrag = null; // { kind, id, edge, at }
  const { svg: drawing, group, overlay, view } = drawPlan(plan, state, errors, {
    onPick: state.tool === 'select' ? (kind, id, part) => { state.sel = part ? { kind, id, part } : { kind, id }; if (PAGE_OF[kind]) state.page = PAGE_OF[kind]; if (kind === 'diaphragm' || kind === 'td') state.dgTab = kind; refresh(false); } : null,
    onEdgeDown: state.tool === 'select' ? (kind, id, edge, part) => { edgeDrag = { kind, id, edge, part, at: null }; } : null,
    loadCases, q, outline: inputs.outline,
  });
  // editing an outline row (focus, no redraw) moves the ring at once
  state._markCorner = i => {
    group.querySelectorAll('[data-corner-mark]').forEach(n => n.remove());
    if (i === null || i === undefined) return;
    const m = cornerMarker(view, inputs.outline[i], i);
    if (m) group.appendChild(m);
  };
  const coords = el('div', { className: 'mono', style: { fontSize: '0.75rem', color: 'var(--ink-tertiary)', textAlign: 'right' } }, ' ');
  const scale = () => { const r = drawing.getBoundingClientRect ? drawing.getBoundingClientRect() : null; return r && r.width ? { r, sc: view.W / r.width } : { r: { left: 0, top: 0 }, sc: 1 }; };
  const toSvg = e => { const { r, sc } = scale(); return [(e.clientX - r.left) * sc, (e.clientY - r.top) * sc]; };
  let drag = null;
  drawing.addEventListener('mousedown', e => { if (state.tool === 'select') drag = { x: e.clientX, y: e.clientY, moved: false, px: state.panX, py: state.panY }; });
  drawing.addEventListener('mousemove', e => {
    const [px, py] = toSvg(e);
    const s = snapPoint(plan, view.wx(px), view.wy(py), view.k);
    coords.textContent = `x ${r2(view.wx(px))}  y ${r2(view.wy(py))}   →  snap (${s.x}, ${s.y})${s.onGridX && s.onGridY ? ' grid intersection' : s.onGridX || s.onGridY ? ' grid line' : s.onX || s.onY ? ' corner line' : ''}`;
    if (edgeDrag) { edgeDrag.at = edgeDrag.edge[0] === 'x' ? s.x : s.y; drawEdgePreview(overlay, plan, view, edgeDrag, s); return; }
    drawOverlay(overlay, state, view, s);
    if (drag) {
      const { sc } = scale();
      const dx = (e.clientX - drag.x) * sc, dy = (e.clientY - drag.y) * sc;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      group.setAttribute('transform', `translate(${dx},${dy})`);
    }
  });
  drawing.addEventListener('mouseup', e => {
    if (edgeDrag) {
      const d = edgeDrag; edgeDrag = null;
      state.suppressClick = true;
      if (d.at !== null && setEdge(inputs, plan, d.kind, d.id, d.edge, d.at, d.part)) { state.message = 'Edge moved to ' + d.edge[0] + ' = ' + r2(d.at) + '.'; refresh(true); }
      else refresh(false);
      return;
    }
    if (!drag) return;
    if (drag.moved) {
      const { sc } = scale();
      state.panX = drag.px + (e.clientX - drag.x) * sc; state.panY = drag.py + (e.clientY - drag.y) * sc;
      drag = null; refresh(false);
    } else drag = null;
  });
  drawing.addEventListener('mouseleave', () => { if (drag && drag.moved) group.removeAttribute('transform'); drag = null; edgeDrag = null; drawOverlay(overlay, state, view, null); });
  drawing.addEventListener('click', e => {
    if (state.suppressClick) { state.suppressClick = false; return; }
    if (state.tool === 'select') { if (state.sel && e.target === drawing) { state.sel = null; refresh(false); } return; }
    const [px, py] = toSvg(e);
    const p = snapPoint(plan, view.wx(px), view.wy(py), view.k);
    const ch = applyClick(inputs, plan, state, p, view.k);
    refresh(ch);
  });
  drawing.addEventListener('wheel', e => {
    e.preventDefault();
    const [px, py] = toSvg(e);
    zoomAt(plan, state, view, px, py, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    refresh(false);
  });
  // Keys anywhere on the page while this editor is shown: Esc cancels (drawing → selection → tool), Delete removes
  // the selection (not while typing in a field). One listener per editor state; a redraw replaces it.
  if (state._onKey && typeof document !== 'undefined') document.removeEventListener('keydown', state._onKey);
  state._onKey = e => {
    if (!box.isConnected) { document.removeEventListener('keydown', state._onKey); return; }
    const typing = e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    if (e.key === 'Escape') {
      if (!handleEscape(state)) return;
      e.preventDefault();
      if (typing && e.target.blur) e.target.blur();
      refresh(false);
    } else if (e.key === 'Delete' && !typing && deleteSelected(inputs, state)) { e.preventDefault(); refresh(true); }
  };
  if (typeof document !== 'undefined') document.addEventListener('keydown', state._onKey);

  box.appendChild(el('div', { style: { display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' } },
    el('div', { style: { flex: '1 1 600px', minWidth: 0 } }, drawing, coords, planLegend(),
      renderMessages(groupMessages((errors || []).filter(e => !e.warn), [...(errors || []).filter(e => e.warn), ...(warnings || [])]), state)),
    el('div', { style: { flex: '0 1 400px', minWidth: '300px' } }, pageBar, page === 'diaphragms' ? dirBar : null, renderPanel(inputs, plan, state, refresh, wallsLinked))));
  return box;
}

// ── load lists (Setup tab: Seismic loading = kind E, Wind loading = kind W) ──
// Each load: direction it acts, mode, values. Changing the mode keeps the load on its page (kind set explicitly).
// Loads saved before have kind '' (seismic → E, any other mode → W) and show on that page.
const LOAD_MODES = {
  E: [['seismic', 'Seismic F_x/ΣA'], ['area', 'Area (psf)'], ['line', 'Line (plf)']],
  W: [['wind', 'Wind (windward / leeward plf)'], ['line', 'Line (plf), optional edge'], ['area', 'Area (psf)']],
};
export function renderLoadList(inputs, kind, refresh) {
  const box = el('div');
  for (const dir of ['y', 'x']) {
    const list = inputs.loads.filter(l => (String(l.acts).endsWith('x') ? 'x' : 'y') === dir && loadKind(l) === kind);
    box.appendChild(el('div', { className: 'section-header', style: { marginTop: '0.6rem' } }, 'Load along ' + dir + ' (' + DIR_LABEL[dir] + ')'));
    if (!list.length) box.appendChild(el('p', { style: small }, 'None.'));
    for (const l of list) {
      const c = el('div', { style: { border: '1px solid var(--border-light)', borderRadius: '6px', padding: '6px', marginBottom: '6px', maxWidth: '720px' } });
      c.appendChild(el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
        el('span', { style: small }, 'Acts'),
        choose((dir === 'y' ? ['-y', '+y'] : ['+x', '-x']).map(a => [a, a]), l.acts, v => { l.acts = v; refresh(true); }),
        choose(LOAD_MODES[kind].some(([m]) => m === l.mode) ? LOAD_MODES[kind] : [...LOAD_MODES[kind], [l.mode, l.mode]], l.mode, v => {
          l.mode = v; l.kind = kind;
          if ((v === 'line' || v === 'wind') && !l.segments.length) l.segments.push(newSegment('', '', ''));
          refresh(true);
        }),
        l.mode === 'area' ? el('span', null, numInput(l, 'psf', refresh, '56px'), ' psf') : null,
        l.mode === 'seismic' ? el('span', { style: small }, 'q = F_x / ΣA from the level above') : null,
        l.mode === 'line' ? el('span', null, el('span', { style: small }, 'edge '), gridSelect(inputs, spanAxis(l.acts) === 'x' ? 'y' : 'x', l.edgeId, id => { l.edgeId = id; refresh(true); }, 'shared')) : null,
        delBtn(() => { inputs.loads.splice(inputs.loads.indexOf(l), 1); refresh(true); }, 'Delete load')));
      if (l.mode === 'line' || l.mode === 'wind') {
        const wind = l.mode === 'wind', ax = spanAxis(l.acts);
        const t = el('table', { className: 'dynamic-table', style: { marginTop: '4px' } });
        t.appendChild(el('tr', null, el('th', null, ax + ' from'), el('th', null, ax + ' to'),
          wind ? el('th', { title: 'On the face the wind comes from (pressure × tributary height)' }, 'windward (plf)') : el('th', null, 'w (plf)'),
          wind ? el('th', { title: 'On the opposite face (suction × tributary height); blank = 0' }, 'leeward (plf)') : el('th', { title: 'End value for a varying load (blank = uniform)' }, 'w end'),
          el('th', null, '')));
        l.segments.forEach((s, i) => t.appendChild(el('tr', null, ...['from', 'to', 'w', wind ? 'wl' : 'w2'].map(k => el('td', null, numInput(s, k, refresh, '64px'))),
          el('td', null, delBtn(() => { l.segments.splice(i, 1); refresh(true); })))));
        c.appendChild(t);
        if (wind) c.appendChild(el('p', { style: small }, 'Each strip loads the sheathing band on its own face. Without an opening both reach the same band, so only the net (windward + leeward) counts; at an opening each band gets its own strip (book Ex 5.1).'));
        c.appendChild(el('button', { type: 'button', className: 'btn btn-ghost btn-sm', onClick() { l.segments.push(newSegment('', '', '')); refresh(true); } }, '+ segment'));
      }
      box.appendChild(c);
    }
    // one seismic F_x / ΣA load per direction (user test 2026-11-03: a second one, acting the other way, cancelled it)
    if (kind === 'E' && list.some(l => l.mode === 'seismic')) {
      box.appendChild(el('p', { style: small }, 'One seismic F_x / ΣA load per direction (the analysis is linear: the opposite sense is the same with the signs changed).'));
      continue;
    }
    box.appendChild(el('button', { type: 'button', className: 'btn btn-sm', onClick() {
      const l = newLoad(dir === 'y' ? '-y' : '+x', kind === 'E' ? 'seismic' : 'wind');
      l.kind = kind;
      if (kind === 'W') l.segments.push(newSegment('', '', ''));
      inputs.loads.push(l); refresh(true);
    } }, (kind === 'E' ? '+ Seismic load along ' : '+ Wind load along ') + dir));
  }
  return box;
}

// ── property panel ──
function numInput(obj, key, refresh, width = '64px', attrs = {}) {
  return el('input', { type: 'number', step: 'any', value: obj[key] ?? '', style: { width }, ...attrs,
    onChange(e) { obj[key] = e.target.value; refresh(true); } });
}
function textInput(obj, key, refresh, width = '56px') {
  return el('input', { type: 'text', value: obj[key] ?? '', style: { width }, onChange(e) { obj[key] = e.target.value.trim(); refresh(true); } });
}
// Select of grid lines (optionally one axis). The value is set after the options exist, so the chosen line shows.
function gridSelect(inputs, axis, value, onPick, blank = '—') {
  const sel = el('select', { className: 'form-select', style: { width: 'auto', padding: '2px 4px' }, onChange(e) { onPick(e.target.value); } });
  sel.appendChild(el('option', { value: '' }, blank));
  inputs.grids.filter(g => !axis || g.axis === axis).forEach(g => sel.appendChild(el('option', { value: g.id }, (g.axis === 'x' ? '↕ ' : '↔ ') + (g.name || '?'))));
  setSelect(sel, value && inputs.grids.some(g => g.id === value && (!axis || g.axis === axis)) ? value : '');
  return sel;
}
// Mark the chosen option (works in browsers and in the Node stand-in DOM)
function setSelect(sel, value) {
  try { sel.value = value; } catch { /* stand-in DOM has no value setter */ }
  // only set the match: a single select deselects the others (the stand-in DOM mishandles selected = false)
  for (const o of sel.querySelectorAll('option')) if (o.value === value) o.selected = true;
}
function choose(options, value, onPick) {
  const sel = el('select', { className: 'form-select', style: { width: 'auto', padding: '2px 4px' }, onChange(e) { onPick(e.target.value); } },
    ...options.map(([v, s]) => el('option', { value: v }, s)));
  setSelect(sel, value);
  return sel;
}
const delBtn = (onClick, title = 'Delete') => el('button', { type: 'button', className: 'btn btn-ghost btn-sm', title, onClick }, '×');
// A collapsible panel section (user 2026-11-03): ▾ open / ▸ collapsed; its state is kept in the editor state across
// redraws, pages and load directions (key = the title without "— load along x").
let panelState = null; // the editor state of the panel being drawn (renderPanel sets it)
const section = (title, ...kids) => {
  const key = String(title).replace(/\s+—\s+(load\s+)?along\s+[xy]$/, '');
  const st = panelState || {};
  if (!st.collapsed) st.collapsed = {};
  const d = el('details', { 'data-section': key, style: { marginBottom: '0.6rem' } });
  d.open = !st.collapsed[key];
  const arrow = el('span', { className: 'td-sec-arrow', style: { display: 'inline-block', width: '1.1em', color: 'var(--ink-secondary)' } }, d.open ? '▾' : '▸');
  // display flex drops the browser's own marker, so only this arrow shows
  d.appendChild(el('summary', { className: 'section-header', style: { cursor: 'pointer', margin: '0 0 0.3rem', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '0.2rem', textAlign: 'left', listStyle: 'none' } }, arrow, el('span', null, title)));
  kids.forEach(k => { if (k) d.appendChild(k); });
  d.addEventListener('toggle', () => { st.collapsed[key] = !d.open; arrow.textContent = d.open ? '▾' : '▸'; });
  return d;
};
const SEL_BG = 'var(--sel-bg)'; // theme token (light pink / dark: translucent), so the row text stays readable
const rowStyle = (state, kind, id) => (state.sel && state.sel.kind === kind && state.sel.id === id ? { background: SEL_BG } : null);
let focusCtx = null;
// onFocusin handler of a row / card: select it and highlight it in place (other rows lose the highlight)
const focusSel = (kind, id) => (e) => {
  const ctx = focusCtx;
  if (!ctx) return;
  const { state, box } = ctx;
  if (state.sel && state.sel.kind === kind && state.sel.id === id && !state.sel.part) return;
  state.sel = { kind, id };
  box.querySelectorAll('[data-selrow]').forEach(r => { r.style.background = ''; });
  if (e.currentTarget && e.currentTarget.style) e.currentTarget.style.background = SEL_BG;
  if (typeof state._markCorner === 'function') state._markCorner(kind === 'corner' ? id : null);
};
const small = { fontSize: '0.75rem', color: 'var(--ink-tertiary)' };
const SHEATHING = [['', 'default'], ['wsp', 'WSP'], ['lumber_straight_single', 'Lumber straight'], ['lumber_diagonal_single', 'Lumber diag.'], ['lumber_diagonal_double', 'Lumber diag. ×2']];

function renderPanel(inputs, plan, state, refresh, wallsLinked = false) {
  const box = el('div', { style: { fontSize: '0.82rem' } });
  const dir = state.dir, page = pageOf(state);
  panelState = state;
  // editing a field of a row selects that row at once (user 2026-11-03); the drawing follows on the next redraw
  focusCtx = { state, box };
  // clicking a row selects it, except a click into one of its fields (a redraw would take the focus away)
  const select = (kind, id) => (e) => {
    if (e && e.target && /^(INPUT|SELECT|OPTION|BUTTON|TEXTAREA)$/.test(e.target.tagName)) return;
    if (state.sel && state.sel.kind === kind && state.sel.id === id) return;
    state.sel = { kind, id }; refresh(false);
  };
  const card = (kind, id) => el('div', { 'data-selrow': kind + ':' + id, style: { border: '1px solid var(--border-light)', borderRadius: '6px', padding: '6px', marginBottom: '6px', ...(rowStyle(state, kind, id) || {}) }, onClick: select(kind, id), onFocusin: focusSel(kind, id) });
  const supportsRow = (obj, axis, label) => {
    while (obj.supports.length < 2) obj.supports.push('');
    return el('div', { style: { marginTop: '4px' } }, el('span', { style: small }, label + ' '),
      gridSelect(inputs, axis, obj.supports[0], id => { obj.supports[0] = id; refresh(true); }), ' ',
      gridSelect(inputs, axis, obj.supports[1], id => { obj.supports[1] = id; refresh(true); }));
  };

  // the other load direction: its diaphragms / TDs are not listed below — say so, with their issues (user 2026-11-03:
  // an early diaphragm drawn along x gave plan errors that could not be found on the y page)
  if (page === 'diaphragms') {
    const other = dir === 'y' ? 'x' : 'y';
    const od = inputs.diaphragms.filter(d => d.dir === other), ot = inputs.tds.filter(t => (t.dir || 'y') === other);
    if (od.length || ot.length) {
      const ids = new Set([...od, ...ot].map(o => o.id));
      const nErr = (state.errors || []).filter(e => !e.warn && ids.has(e.ref)).length;
      box.appendChild(el('div', { style: { ...small, padding: '6px', marginBottom: '6px', borderRadius: '6px', border: '1px solid ' + (nErr ? 'var(--fail)' : 'var(--border-light)'), color: nErr ? 'var(--fail)' : 'var(--ink-tertiary)' } },
        'Load along ' + other + ': ' + [od.length ? od.length + ' diaphragm(s) ' + od.map(d => d.mark).join(', ') : '', ot.length ? ot.length + ' TD(s) ' + ot.map(t => t.mark).join(', ') : ''].filter(Boolean).join(' · ')
        + (nErr ? ' — ' + nErr + ' plan issue(s)' : '') + '. ',
        el('button', { type: 'button', className: 'btn btn-ghost btn-sm', 'data-other-dir': other, onClick() { state.dir = other; state.sel = null; state.pending = []; refresh(false); } }, 'Show load along ' + other)));
    }
  }

  // Diaphragms & TDs page (user 2026-11-06): a tab for diaphragms and one for TDs, a sub-tab per item, one card shown
  const sAxis = spanAxis(dir);
  const diaphragmCard = d => {
    const c = card('diaphragm', d.id);
    const pd = plan.diaphragms.find(x => x.id === d.id);
    c.appendChild(el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
      textInput(d, 'mark', refresh, '44px'),
      el('span', { style: small }, (d.parts || []).length + ' piece(s)' + (pd ? ', ' + fmt(diaphragmArea(plan, pd)) + ' sf' : '')),
      el('span', { style: { flex: 1 } }),
      delBtn(() => { inputs.diaphragms.splice(inputs.diaphragms.indexOf(d), 1); refresh(true); }, 'Delete diaphragm')));
    c.appendChild(supportsRow(d, sAxis, 'Spans between'));
    c.appendChild(el('div', { style: { marginTop: '4px', display: 'flex', gap: '4px', flexWrap: 'wrap' } },
      el('button', { type: 'button', className: 'btn btn-sm', title: 'The pieces become the sheathing between the two support lines that no other diaphragm of this direction holds (outline and openings left out).',
        onClick() { const n = fillBetweenSupports(inputs, plan, d.id, state); state.sel = { kind: 'diaphragm', id: d.id }; refresh(n > 0); } }, 'Fill between supports'),
      el('button', { type: 'button', className: 'btn btn-ghost btn-sm', title: 'Draw a rectangle: its free sheathing is added as pieces',
        onClick() { state.sel = { kind: 'diaphragm', id: d.id }; state.tool = 'piece'; state.pending = []; state.message = ''; refresh(false); } }, '+ Piece (draw)')));
    const pt = el('table', { className: 'dynamic-table', style: { marginTop: '4px' } });
    pt.appendChild(el('tr', null, el('th', null, 'Piece'), ...['x1', 'x2', 'y1', 'y2'].map(k => el('th', null, k)), el('th', null, '')));
    (d.parts || []).forEach((q, i) => {
      const on = state.sel && state.sel.kind === 'diaphragm' && state.sel.id === d.id && state.sel.part === q.id;
      pt.appendChild(el('tr', { style: on ? { background: 'var(--sel-bg-strong)' } : null, onClick: e => { if (e && e.target && /^(INPUT|BUTTON)$/.test(e.target.tagName)) return; e.stopPropagation(); state.sel = { kind: 'diaphragm', id: d.id, part: q.id }; refresh(false); } },
        el('td', { style: small }, partName(d, i)), ...['x1', 'x2', 'y1', 'y2'].map(k => el('td', null, numInput(q, k, refresh, '50px'))),
        el('td', null, delBtn(() => { d.parts.splice(i, 1); refresh(true); }, 'Delete piece'))));
    });
    c.appendChild(el('div', { className: 'table-scroll' }, pt));
    if ([d.x1, d.x2, d.y1, d.y2].some(v => v !== undefined && v !== ''))
      c.appendChild(el('p', { style: { ...small, margin: '2px 0 0' } }, 'Pieces cut on upgrade (schema 2) from the earlier rectangle x ' + d.x1 + '–' + d.x2 + ', y ' + d.y1 + '–' + d.y2 + ' (kept for the record, not used).'));
    c.appendChild(el('div', { style: { marginTop: '4px' } }, el('span', { style: small }, 'Sheathing '),
      choose(SHEATHING, d.sheathing || '', v => { d.sheathing = v; refresh(true); }),
      el('span', { style: { ...small, marginLeft: '6px' } }, 'Blocking '),
      choose([['', 'default'], ['yes', 'blocked'], ['no', 'unblocked']], d.blocked === true ? 'yes' : d.blocked === false ? 'no' : '', v => { d.blocked = v === '' ? null : v === 'yes'; refresh(true); }),
      el('span', { style: { ...small, marginLeft: '6px' }, title: 'Where an opening splits the depth, the bands share the section shear by width at one section of the opening; each band then carries its own load. Auto: at the end on a support line (free chord ends, Ex 4.3), else at the opening end with the smaller shear (Ex 5.1).' }, 'Opening bands share V at '),
      choose([['', 'auto'], ['low', 'opening start (low ' + sAxis + ')'], ['high', 'opening end (high ' + sAxis + ')'], ['mid', 'mid-opening']], d.bandSplit || '', v => { d.bandSplit = v; refresh(true); }),
      el('span', { style: { ...small, marginLeft: '6px' }, title: 'A chord that stops inside an opening stretch (e.g. a notch under the opening): its force at the cut, which the TD takes. Section (default): M/H at the cut, the opening-edge members taken as 0 there (book Ex 8.1, p8; within −6…+9 % of a stiffness reference). Vierendeel: zero in the opening-edge members at the inflection, then the sum of unit shears along the outer chord (about a quarter lower). docs/diaphragm-analysis-opening-study.md' }, 'Chord cut in an opening '),
      choose([['', 'section M/H at the cut (default)'], ['vierendeel', 'Vierendeel']], d.chordCut === 'vierendeel' ? 'vierendeel' : '', v => { d.chordCut = v; refresh(true); })));
    return c;
  };
  const tdCard = t => {
    const pt = plan.tds.find(x => x.id === t.id);
    const axis = pt && pt.supports[0] ? pt.supports[0].axis : null;
    const c = card('td', t.id);
    c.appendChild(el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
      textInput(t, 'mark', refresh, '48px'),
      ...['x1', 'x2', 'y1', 'y2'].flatMap(k => [el('span', { style: small }, k), numInput(t, k, refresh, '50px')]),
      delBtn(() => { inputs.tds.splice(inputs.tds.indexOf(t), 1); refresh(true); })));
    c.appendChild(supportsRow(t, null, 'Supports'));
    // overhangs (user 2026-11-04): picked by grid — from a support of the TD to the grid at the tip, one per support
    if (!Array.isArray(t.overhangs)) t.overhangs = [];
    const ohRow = el('div', { style: { marginTop: '4px', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
      el('span', { style: small, title: 'Cantilever: the TD runs past a support to the grid line at its tip. One overhang per support (a TD may overhang both).' }, 'Overhangs '));
    const supOpts = (pt ? pt.supports : []).filter(Boolean).map(g => [g.id, g.name || '?']);
    t.overhangs.forEach((o, i) => ohRow.appendChild(el('span', { 'data-overhang': String(i), style: { whiteSpace: 'nowrap' } },
      el('span', { style: small }, 'from '), choose([['', '—'], ...supOpts], o.fromId || '', v => { o.fromId = v; refresh(true); }),
      el('span', { style: small }, ' to '), gridSelect(inputs, axis, o.toId, id => { o.toId = id; if (id) o.at = ''; refresh(true); }),
      !o.toId && o.at !== '' && o.at != null ? el('span', { style: { ...small, color: 'var(--stale)' } }, ' (typed tip ' + o.at + ' — pick its grid)') : null,
      delBtn(() => { t.overhangs.splice(i, 1); refresh(true); }))));
    if (t.overhangs.length < 2) ohRow.appendChild(el('button', { type: 'button', className: 'btn btn-ghost btn-sm', title: 'The TD runs past one of its supports',
      onClick() { t.overhangs.push(guessOverhang(plan, pt, t.overhangs)); refresh(true); } }, '+ overhang'));
    if (!t.overhangs.length) ohRow.appendChild(el('span', { style: small }, 'none (spans between its supports)'));
    c.appendChild(ohRow);
    // load lines: Auto = found from the plan (default), or set by hand (user 2026-11-03)
    const sideName = s => (s === 'both' ? 'both sides' : s === '-' ? (axis === 'y' ? 'left' : 'below') : (axis === 'y' ? 'right' : 'above'));
    const auto = t.loadsMode !== 'manual';
    const loads = el('div', { style: { marginTop: '4px' } }, el('span', { style: small }, 'Load lines (cut chord / strut enters from) '),
      choose([['auto', 'Auto — found on the plan'], ['manual', 'Set by hand']], auto ? 'auto' : 'manual', v => {
        if (v === 'manual' && auto && pt && pt.found && pt.found.length) t.loads = pt.found.map(l => ({ gridId: l.grid.id, side: l.side }));
        t.loadsMode = v; refresh(true);
      }));
    if (auto) {
      const found = (pt && pt.found) || [];
      loads.appendChild(found.length
        ? el('div', { style: { marginTop: '2px' } }, ...found.map(l => el('div', { 'data-found': l.grid.name, style: { fontSize: '0.8rem' } },
          el('strong', null, l.grid.name), ' — ' + sideName(l.side), el('span', { style: small }, ' (' + l.why + ')'))))
        : el('div', { style: { ...small, color: 'var(--stale)' } }, 'None found: no notch, opening or outline edge meets its long edges between its supports. Check where it is drawn, or set its load lines by hand.'));
    } else {
      t.loads.forEach((l, i) => loads.appendChild(el('span', { style: { marginRight: '6px', whiteSpace: 'nowrap' } },
        gridSelect(inputs, axis, l.gridId, id => { l.gridId = id; refresh(true); }),
        choose([['-', sideName('-')], ['+', sideName('+')], ['both', 'both sides']], l.side === '-' ? '-' : l.side === 'both' ? 'both' : '+', v => { l.side = v; refresh(true); }),
        delBtn(() => { t.loads.splice(i, 1); refresh(true); }))));
      loads.appendChild(el('button', { type: 'button', className: 'btn btn-ghost btn-sm', onClick() { t.loads.push({ gridId: '', side: '+' }); refresh(true); } }, '+ load line'));
      const found = (pt && pt.found) || [];
      const same = found.map(l => l.grid.id + ' ' + l.side).sort().join(',') === t.loads.map(l => l.gridId + ' ' + l.side).sort().join(',');
      if (!same) loads.appendChild(el('div', { style: { ...small, marginTop: '2px' } },
        'The plan gives: ' + (found.length ? found.map(l => l.grid.name + ' ' + sideName(l.side)).join(', ') : 'none') + ' (Auto would use these).'));
    }
    c.appendChild(loads);
    return c;
  };
  if (page === 'diaphragms') {
    const lists = { diaphragm: inputs.diaphragms.filter(d => d.dir === dir), td: inputs.tds.filter(t => (t.dir || 'y') === dir) };
    const errRefs = new Set((state.errors || []).filter(e => !e.warn && e.ref).map(e => e.ref));
    const dot = on => (on ? el('span', { style: { color: 'var(--fail)', marginLeft: '0.25rem' } }, '●') : null);
    if (state.sel && lists[state.sel.kind] && lists[state.sel.kind].some(o => o.id === state.sel.id)) state.dgTab = state.sel.kind;
    const kind = state.dgTab === 'td' ? 'td' : 'diaphragm';
    box.appendChild(el('div', { className: 'td-dgtabs', style: { display: 'flex', gap: '4px', marginBottom: '0.4rem', borderBottom: '2px solid var(--border)' } },
      ...[['diaphragm', 'Diaphragms'], ['td', 'TDs']].map(([k, label]) => el('button', { type: 'button', 'data-dgtab': k, className: 'btn btn-sm' + (kind === k ? ' btn-primary' : ' btn-ghost'),
        style: { borderRadius: '6px 6px 0 0', marginBottom: '-2px' },
        onClick() { if (kind === k) return; state.dgTab = k; if (state.sel && (state.sel.kind === 'diaphragm' || state.sel.kind === 'td')) state.sel = null; refresh(false); } },
        label + ' (' + lists[k].length + ')', dot(lists[k].some(o => errRefs.has(o.id)))))));
    if (!state.subSel) state.subSel = {};
    const list = lists[kind];
    const cur = (state.sel && state.sel.kind === kind && list.find(o => o.id === state.sel.id)) || list.find(o => o.id === state.subSel[kind]) || list[0];
    if (cur) state.subSel[kind] = cur.id;
    if (kind === 'diaphragm') box.appendChild(el('p', { style: small }, 'For the load along ' + dir + ' each diaphragm spans between two ' + (sAxis === 'x' ? '↕' : '↔') + ' support lines (wall or collector lines) and is analysed as one beam. It is one or more rectangles (pieces) on the sheathing — never over an opening or outside the outline.'));
    if (list.length) box.appendChild(el('div', { className: 'td-subtabs', style: { display: 'flex', gap: '3px', flexWrap: 'wrap', marginBottom: '0.4rem' } },
      ...list.map(o => el('button', { type: 'button', 'data-subtab': o.mark || o.id, className: 'btn btn-sm' + (o === cur ? ' btn-primary' : ' btn-ghost'),
        onClick() { if (o === cur && state.sel && state.sel.id === o.id) return; state.subSel[kind] = o.id; state.sel = { kind, id: o.id }; refresh(false); } },
        o.mark || '?', dot(errRefs.has(o.id))))));
    if (cur) box.appendChild(kind === 'diaphragm' ? diaphragmCard(cur) : tdCard(cur));
    else box.appendChild(el('p', { style: { ...small, color: kind === 'diaphragm' ? 'var(--stale)' : undefined } }, 'None for this direction — use the ' + (kind === 'diaphragm' ? 'Diaphragm' : 'TD') + ' tool.'));
  }

  // loads: entered on Setup (Seismic loading / Wind loading); drawn on the plan
  if (page === 'diaphragms') {
    const n = inputs.loads.filter(x => (String(x.acts).endsWith('x') ? 'x' : 'y') === dir).length;
    box.appendChild(section('Loads — along ' + dir, el('p', { style: small },
      (n ? n + ' load(s) act along ' + dir + ' — drawn on the plan with the w(s) strip. ' : 'No load acts along ' + dir + '. ')
      + 'Loads are entered on the Setup tab: Seismic loading / Wind loading.')));
  }

  if (page === 'geometry') geometryPanel(box, inputs, plan, state, refresh, select);
  if (page === 'walls') wallsPanel(box, inputs, plan, state, refresh, select, wallsLinked);
  return box;
}

// Grids & outline page: grid lines, outline corners, openings (all shared by both load directions)
function geometryPanel(box, inputs, plan, state, refresh, select) {
  const lock = gridsReadOnly(inputs);
  const share = state.gridShare || null; // { fromId, ownerName, options: [{ id, name }], set(id) } (DA form)
  // two tabs (user 2026-11-05): N-S grids (↕, x = const) and E-W grids (↔, y = const); each grid may stop early:
  // its extent along the grid (y1–y2 for ↕, x1–x2 for ↔), blank = across the whole plan
  const sel = state.sel && state.sel.kind === 'grid' ? inputs.grids.find(g => g.id === state.sel.id) : null;
  if (sel) state.gridTab = sel.axis; // a grid picked on the plan opens its tab
  const tab = state.gridTab === 'y' ? 'y' : 'x';
  const [cAt, cLo, cHi] = tab === 'x' ? ['x (ft)', 'y1', 'y2'] : ['y (ft)', 'x1', 'x2'];
  const tabBar = el('div', { style: { display: 'flex', gap: '4px', margin: '0 0 4px' } },
    ...[['x', 'N-S grids ↕'], ['y', 'E-W grids ↔']].map(([k, label]) => el('button', { type: 'button', 'data-gridtab': k,
      className: 'btn btn-sm' + (tab === k ? ' btn-primary' : ' btn-ghost'),
      onClick() { state.gridTab = k; if (state.sel && state.sel.kind === 'grid') state.sel = null; refresh(false); } },
      label + ' (' + inputs.grids.filter(g => g.axis === k).length + ')')));
  const gt = el('table', { className: 'dynamic-table', 'data-gridtable': tab });
  const extTitle = 'Where the grid line starts / ends along its length — blank = it runs across the whole plan';
  gt.appendChild(el('tr', null, el('th', null, 'Name'), el('th', null, cAt), el('th', { title: extTitle }, cLo), el('th', { title: extTitle }, cHi),
    el('th', { title: 'Reference station only (e.g. a centerline CL): drawn lighter, used to read values there; never a support, load or wall line' }, 'Ref only'), el('th', null, '')));
  const show = (g, k) => el('span', { className: 'mono' }, String(g[k] ?? ''));
  inputs.grids.filter(g => g.axis === tab).sort((a, b) => Number(a.at) - Number(b.at)).forEach(g => gt.appendChild(el('tr', { 'data-selrow': 'grid:' + g.id, style: rowStyle(state, 'grid', g.id), onClick: select('grid', g.id), onFocusin: focusSel('grid', g.id) },
    el('td', null, lock ? show(g, 'name') : textInput(g, 'name', refresh, '44px')),
    el('td', null, lock ? show(g, 'at') : numInput(g, 'at', refresh)),
    el('td', null, lock ? show(g, 'from') : numInput(g, 'from', refresh)),
    el('td', null, lock ? show(g, 'to') : numInput(g, 'to', refresh)),
    el('td', null, el('input', { type: 'checkbox', checked: !!g.ref, disabled: lock, onChange(e) { g.ref = e.target.checked; refresh(true); } })),
    el('td', null, lock ? null : delBtn(() => { inputs.grids.splice(inputs.grids.indexOf(g), 1); refresh(true); })))));
  // lock (user 2026-11-03): stored with the item; grid names / positions read-only, no add / delete / grid tools
  const lockBtn = el('button', { type: 'button', className: 'btn btn-sm' + (lock ? ' btn-primary' : ' btn-ghost'), 'data-gridlock': '1',
    title: lock ? 'Unlock: grid lines can be changed again' : 'Lock the grid lines so they cannot be moved, renamed or deleted by accident',
    onClick() { inputs.gridsLocked = !lock; if (!lock && state.tool !== 'select' && /^grid/.test(state.tool)) state.tool = 'select'; refresh(true); } }, lock ? '🔒 Locked — unlock' : '🔓 Lock grid lines');
  const addGrid = () => { const ats = plan.grids.filter(g => g.axis === tab).map(g => g.at).filter(fin); inputs.grids.push(newGrid(nextGridName(inputs, tab), tab, ats.length ? Math.max(...ats) + 20 : 0)); refresh(true); };
  // one grid for all levels (user 2026-11-05): use the grids of another DA item (its owner edits them)
  const shareRow = share && (share.options.length || share.fromId) ? el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', margin: '0 0 4px', fontSize: '0.8rem' } },
    'Grid lines:', el('select', { className: 'form-select', 'data-gridshare': '1', style: { width: 'auto', fontSize: '0.8rem' }, onChange(e) { share.set(e.target.value); } },
      el('option', { value: '', selected: !share.fromId }, 'own (this item owns them)'),
      ...share.options.map(o => el('option', { value: o.id, selected: o.id === share.fromId }, 'shared from ' + o.name)),
      share.fromId && !share.options.some(o => o.id === share.fromId) ? el('option', { value: share.fromId, selected: true }, 'shared from ' + (share.ownerName || 'an item not found')) : null)) : null;
  const shareNote = share && share.fromId ? el('div', { style: { fontSize: '0.75rem', color: 'var(--ink-tertiary)', margin: '0 0 4px' } },
    'Shared from ' + (share.ownerName || '?') + ': edit the grids there. A change there shows an update notice here (Update brings it in).') : null;
  box.appendChild(section('Grid lines (shared)', shareRow, shareNote, share && share.fromId ? null : el('div', { style: { margin: '0 0 4px' } }, lockBtn), tabBar, el('div', { className: 'table-scroll' }, gt),
    el('div', { style: { fontSize: '0.72rem', color: 'var(--ink-tertiary)', margin: '2px 0' } }, (tab === 'x' ? 'y1 / y2' : 'x1 / x2') + ': leave blank for a grid across the whole plan; set them for a grid that stops early.'),
    lock ? null : el('div', { style: { display: 'flex', gap: '4px', marginTop: '4px' } },
      el('button', { type: 'button', className: 'btn btn-sm', 'data-addgrid': tab, onClick: addGrid }, tab === 'x' ? '+ Grid ↕' : '+ Grid ↔'))));

  const ot = el('table', { className: 'dynamic-table' });
  ot.appendChild(el('tr', null, el('th', null, '#'), el('th', null, 'x'), el('th', null, 'y'), el('th', { title: 'Pick a point on the plan' }, 'Pick'), el('th', null, '')));
  // pick (user 2026-11-03): click a point on the plan for this corner (⌖), or for a new corner after it (+⌖)
  const pickBtn = (label, title, pick) => el('button', { type: 'button', className: 'btn btn-ghost btn-sm', title, 'data-pick': label,
    style: state.tool === 'cornerpick' && state.pick && state.pick.index === pick.index && state.pick.insert === pick.insert ? { background: SEL_BG } : null,
    onClick() { state.tool = 'cornerpick'; state.pick = pick; state.pending = []; state.message = ''; refresh(false); } }, label);
  inputs.outline.forEach((p, i) => ot.appendChild(el('tr', { 'data-selrow': 'corner:' + i, onClick: select('corner', i), onFocusin: focusSel('corner', i),
    style: (state.tool === 'cornerpick' && state.pick && state.pick.index === i && !state.pick.insert) || (state.sel && state.sel.kind === 'corner' && state.sel.id === i) ? { background: SEL_BG } : null },
    el('td', { style: small }, String(i + 1)), el('td', null, numInput(p, 'x', refresh)), el('td', null, numInput(p, 'y', refresh)),
    el('td', { style: { whiteSpace: 'nowrap' } }, pickBtn('⌖', 'Pick corner ' + (i + 1) + ' on the plan', { index: i, insert: false }), pickBtn('+⌖', 'Pick a new corner after ' + (i + 1), { index: i, insert: true })),
    el('td', null, delBtn(() => { inputs.outline.splice(i, 1); refresh(true); }, 'Delete corner')))));
  box.appendChild(section('Outline (shared, corners in order)', el('div', { className: 'table-scroll' }, ot), // full height, no inner scroll (user 2026-11-03)
    el('div', { style: { display: 'flex', gap: '4px', marginTop: '4px' } },
      el('button', { type: 'button', className: 'btn btn-sm', onClick() { inputs.outline.push({ x: '', y: '' }); refresh(true); } }, '+ Corner'),
      pickBtn('+ Corner (pick)', 'Pick a new last corner on the plan', { index: inputs.outline.length - 1, insert: true }))));

  if (!inputs.openings.length) box.appendChild(section('Openings (shared)', el('p', { style: small }, 'None — use the Opening tool (two opposite corners).')));
  else {
    const t = el('table', { className: 'dynamic-table' });
    t.appendChild(el('tr', null, el('th', null, 'Name'), el('th', null, 'x1'), el('th', null, 'x2'), el('th', null, 'y1'), el('th', null, 'y2'), el('th', null, '')));
    inputs.openings.forEach(o => t.appendChild(el('tr', { 'data-selrow': 'opening:' + o.id, style: rowStyle(state, 'opening', o.id), onClick: select('opening', o.id), onFocusin: focusSel('opening', o.id) },
      el('td', null, textInput(o, 'name', refresh, '44px')), ...['x1', 'x2', 'y1', 'y2'].map(k => el('td', null, numInput(o, k, refresh, '52px'))),
      el('td', null, delBtn(() => { inputs.openings.splice(inputs.openings.indexOf(o), 1); refresh(true); })))));
    box.appendChild(section('Openings (shared)', el('div', { className: 'table-scroll' }, t)));
  }
}

// Shear walls page: typed walls, or the walls linked from Shear Wall Design (read-only)
function wallsPanel(box, inputs, plan, state, refresh, select, wallsLinked) {
  if (wallsLinked) {
    const lt = el('table', { className: 'dynamic-table' });
    lt.appendChild(el('tr', null, el('th', null, 'Mark'), el('th', null, 'Line'), el('th', null, 'Type'), el('th', null, 'From'), el('th', null, 'To')));
    plan.walls.forEach(w => lt.appendChild(el('tr', { 'data-selrow': 'wall:' + w.id, style: { ...(rowStyle(state, 'wall', w.id) || {}), cursor: 'pointer' }, onClick: select('wall', w.id), onFocusin: focusSel('wall', w.id) },
      el('td', null, w.mark), el('td', null, w.line), el('td', { style: small }, w.type || 'segmented'), el('td', { className: 'mono' }, fmt(w.from)), el('td', { className: 'mono' }, fmt(w.to)))));
    box.appendChild(section('Shear walls (from Shear Wall Design, read-only)', plan.walls.length ? el('div', { className: 'table-scroll' }, lt)
      : el('p', { style: small }, 'No wall of this level is placed yet — check the level name, direction mapping and line names (Setup).')));
    const ab = plan.wallsAbove || [];
    if (ab.length) {
      const at = el('table', { className: 'dynamic-table', 'data-abovetable': '1' });
      at.appendChild(el('tr', null, el('th', null, 'Mark'), el('th', null, 'Line'), el('th', null, 'From'), el('th', null, 'To'), el('th', { title: 'Story shear of the wall (Shear Wall Design), 1.0E / 1.0W' }, 'V (k) E / W'), el('th', null, 'Its force')));
      ab.forEach(w => at.appendChild(el('tr', { 'data-selrow': 'above:' + w.id, style: { ...(rowStyle(state, 'above', w.id) || {}), cursor: 'pointer' }, onClick: select('above', w.id) }, el('td', null, w.mark), el('td', null, w.line), el('td', { className: 'mono' }, fmt(w.from)), el('td', { className: 'mono' }, fmt(w.to)),
        el('td', { className: 'mono' }, (Number.isFinite(w.VE) ? fmt(w.VE) : '—') + ' / ' + (Number.isFinite(w.VW) ? fmt(w.VW) : '—')),
        el('td', { style: { ...small, color: w.kind === 'transfer' ? '#b45309' : '' } }, w.kind === 'transfer' ? '↓ into this diaphragm' + (w.onSheathing ? '' : ' — not on the sheathing!') : '↕ down its line'))));
      // collector per line of walls that end here (option 2, user 2026-11-05): blank = full depth
      const lines = [...new Map(ab.filter(w => w.kind === 'transfer').map(w => [w.swdLineId, w])).values()];
      const ct = lines.length ? el('table', { className: 'dynamic-table', 'data-collectortable': '1', style: { marginTop: '6px' } }) : null;
      if (ct) {
        ct.appendChild(el('tr', null, el('th', null, 'Line'), el('th', { title: 'The collector on this grid runs only from – to; its force goes only into the diaphragms between them. Blank = full depth (into every diaphragm across the grid, by depth).' }, 'Collector from'), el('th', null, 'to'),
          el('th', { title: 'No collector along the grid: each wall that ends here goes only into the diaphragm(s) under it (a wall over two diaphragms split by its length over each). From – to does not apply.' }, 'Each wall into the diaphragm under it')));
        if (!inputs.aboveCollectors) inputs.aboveCollectors = {};
        for (const w of lines) {
          const cur = inputs.aboveCollectors[w.swdLineId] || {};
          const cAx = w.axis === 'x' ? 'y' : 'x'; // the collector runs along its grid: coordinates of this axis
          // diaphragm edges at this grid (user 2026-11-05): every diaphragm of the wall's load direction crossing the grid —
          // the ends of its pieces there (a separate diaphragm = a sub-diaphragm; its edges are chords)
          const edges = new Map();
          for (const d of plan.diaphragms.filter(x => x.dir === w.dir)) {
            // pieces the grid passes through (strictly inside: a grid on a piece edge is that diaphragm's support or edge)
            const ps = (d.parts || []).filter(q => [q.x1, q.x2, q.y1, q.y2].every(fin) && (w.axis === 'x' ? q.x1 < w.at - 1e-6 && q.x2 > w.at + 1e-6 : q.y1 < w.at - 1e-6 && q.y2 > w.at + 1e-6));
            if (!ps.length) continue;
            const lo = Math.min(...ps.map(q => (cAx === 'y' ? q.y1 : q.x1))), hi = Math.max(...ps.map(q => (cAx === 'y' ? q.y2 : q.x2)));
            for (const v of [lo, hi]) { const k = Math.round(v * 1e4) / 1e4; edges.set(k, [...(edges.get(k) || []), d.mark]); }
          }
          const cross = plan.grids.filter(g => g.axis !== w.axis && !g.ref && fin(g.at)).sort((p, q) => p.at - q.at);
          const onGrid = v => cross.find(g => Math.abs(g.at - v) < 1e-6);
          const opts = [...cross.map(g => { const em = [...edges.entries()].find(([v]) => Math.abs(v - g.at) < 1e-6);
            return { v: 'g:' + g.id, at: g.at, t: g.name + ' (' + fmt(g.at) + ')' + (em ? ' — edge of ' + [...new Set(em[1])].join(' / ') : '') }; }),
            ...[...edges.entries()].filter(([v]) => !onGrid(v)).map(([v, ms]) => ({ v: 'e:' + v, at: v, t: 'edge of ' + [...new Set(ms)].join(' / ') + ' (' + cAx + ' ' + fmt(v) + ')' }))]
            .sort((a, b) => a.at - b.at);
          const curVal = side => (cur[side + 'Id'] ? 'g:' + cur[side + 'Id'] : cur[side + 'At'] !== undefined && cur[side + 'At'] !== '' ? 'e:' + Math.round(Number(cur[side + 'At']) * 1e4) / 1e4 : '');
          const put = (side, val) => {
            const c = { ...(inputs.aboveCollectors[w.swdLineId] || {}) };
            delete c[side + 'Id']; delete c[side + 'At'];
            if (val.startsWith('g:')) c[side + 'Id'] = val.slice(2); else if (val.startsWith('e:')) c[side + 'At'] = val.slice(2);
            if (!c.fromId && !c.toId && !c.fromAt && !c.toAt && !c.own) delete inputs.aboveCollectors[w.swdLineId]; else inputs.aboveCollectors[w.swdLineId] = c;
            refresh(true);
          };
          // open item 6-A (user 2026-11-09): opt-in "each wall into the diaphragm under it"; ticking clears from – to
          const setOwn = on => {
            const c = { ...(inputs.aboveCollectors[w.swdLineId] || {}) };
            if (on) { c.own = true; delete c.fromId; delete c.toId; delete c.fromAt; delete c.toAt; } else delete c.own;
            if (!c.fromId && !c.toId && !c.fromAt && !c.toAt && !c.own) delete inputs.aboveCollectors[w.swdLineId]; else inputs.aboveCollectors[w.swdLineId] = c;
            refresh(true);
          };
          const pick = (side, blank) => { const sel = curVal(side); return el('select', { className: 'form-select', 'data-collector': w.line + ':' + side, disabled: !!cur.own, style: { width: 'auto', fontSize: '0.78rem' }, onChange(e) { put(side, e.target.value); } },
            el('option', { value: '' }, blank), ...opts.map(o => el('option', { value: o.v, selected: o.v === sel }, o.t))); };
          ct.appendChild(el('tr', null, el('td', null, w.line), el('td', null, pick('from', 'full depth')), el('td', null, pick('to', '—')),
            el('td', { style: { textAlign: 'center' } }, el('input', { type: 'checkbox', 'data-collector-own': w.line, checked: !!cur.own, onChange(e) { setOwn(e.target.checked); } }))));
        }
      }
      box.appendChild(section('Walls of the ' + (ab[0].upperLevel || 'story above') + ' story (read-only)', el('div', { className: 'table-scroll' }, at), ct,
        ct ? el('p', { style: { ...small, marginTop: '4px' } }, 'Collector: blank = full depth (the force goes into every diaphragm across the grid, by depth). From – to: only into the diaphragms lying between them — their edges there are chords (split the floor at the collector ends). "Each wall into the diaphragm under it": no collector along the grid — each wall only loads the diaphragm(s) it stands over.') : null,
        el('p', { style: { ...small, marginTop: '4px' } }, '↓ ends at this floor (no wall below on its line, or ticked in Shear Wall Design): this diaphragm takes its force. ↕ continues down its line. Drawn dashed beside the grid; the forces come with the next build step.')));
    }
    return;
  }
  const wt = el('table', { className: 'dynamic-table' });
  wt.appendChild(el('tr', null, el('th', null, 'Mark'), el('th', null, 'Line'), el('th', null, 'Grid'), el('th', null, 'From'), el('th', null, 'To'), el('th', null, '')));
  inputs.walls.forEach(w => wt.appendChild(el('tr', { 'data-selrow': 'wall:' + w.id, style: rowStyle(state, 'wall', w.id), onClick: select('wall', w.id), onFocusin: focusSel('wall', w.id) },
    el('td', null, textInput(w, 'mark', refresh, '44px')), el('td', null, textInput(w, 'line', refresh, '36px')),
    el('td', null, gridSelect(inputs, null, w.gridId, id => { w.gridId = id; refresh(true); })),
    el('td', null, numInput(w, 'from', refresh, '52px')), el('td', null, numInput(w, 'to', refresh, '52px')),
    el('td', null, delBtn(() => { inputs.walls.splice(inputs.walls.indexOf(w), 1); refresh(true); })))));
  box.appendChild(section('Shear walls (shared)', inputs.walls.length ? el('div', { className: 'table-scroll' }, wt) : el('p', { style: small }, 'None yet — use the Wall tool.'),
    el('p', { style: { ...small, marginTop: '4px' } }, 'Line = the wall line name. Walls with the same name on two or more grids form one offset line of resistance (force shared by wall length, e.g. D/E); give walls that act alone their own name (e.g. E7).')));
}
