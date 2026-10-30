// Diaphragm Analysis — interactive plan editor (SVG drawing + property panel).
// The plan (grids, outline, openings, walls) is shared by both load directions. Diaphragms, TDs and loads belong
// to one load direction; the direction switch shows one direction at a time with its load arrow.
// Tools: Select · Grid ↕ / Grid ↔ · Outline · Opening · Wall · Diaphragm · TD.
// Snapping (marker under the cursor, rubber band while drawing): grid intersection → grid line → corners of the
// outline / openings / diaphragms / TDs and wall ends → 0.5 ft. Wheel = zoom about the cursor; drag the background
// (Select) = pan. Edits go through applyClick / the panel and then refresh(true); view changes call refresh(false).
import { el } from '../utils.js';
import { planBounds, spanAxis, DIR_LABEL } from './tdGeometry.js';
import { loadProfile, loadKind } from './tdBasicShear.js';
import { newGrid, newOpening, newWall, newTd, newDiaphragm, newLoad, newSegment, nextMark } from './tdModel.js';

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
  ['opening', 'Opening'], ['wall', 'Wall'], ['diaphragm', 'Diaphragm'], ['td', 'TD'],
];
const HINT = {
  select: 'Click an item to select it (Delete removes it, Esc deselects). Drag a selected diaphragm / TD edge to move it (snaps to grid lines). Drag the background to pan, wheel to zoom.',
  gridx: 'Click to add a vertical grid line (constant x).',
  gridy: 'Click to add a horizontal grid line (constant y).',
  outline: 'Click the corners in order; each new corner lines up with the last one. Click the first corner (or Finish) to close. This replaces the outline.',
  opening: 'Click two opposite corners of the opening.',
  wall: 'Click the two ends of the wall on a grid line.',
  diaphragm: 'Click two opposite corners of the diaphragm for the load direction shown. It spans between the two support lines at its ends (change them in the panel).',
  td: 'Click two opposite corners of the transfer diaphragm. Its supports and load lines are guessed from the grids; check them in the panel.',
};

export function newEditorState() {
  return { tool: 'select', sel: null, pending: [], zoom: 1, panX: 0, panY: 0, message: '', dir: 'y' };
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
  [...plan.openings, ...plan.tds, ...plan.diaphragms].forEach(r => { xs.push(r.x1, r.x2); ys.push(r.y1, r.y2); });
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
  const gx = pick(x, plan.grids.filter(g => g.axis === 'x').map(g => g.at));
  const gy = pick(y, plan.grids.filter(g => g.axis === 'y').map(g => g.at));
  const cc = cornerCoords(plan);
  const ox = gx ?? pick(x, cc.xs);
  const oy = gy ?? pick(y, cc.ys);
  return { x: ox ?? Math.round(x * 2) / 2, y: oy ?? Math.round(y * 2) / 2, onGridX: gx !== null, onGridY: gy !== null, onX: ox !== null, onY: oy !== null };
}

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

// Default diaphragm supports: the span runs across the load; supports = the outermost lines of constant span
// coordinate within the rectangle (an end without a line overhangs). tol in ft.
export function guessDiaphragmSupports(plan, d, dir, tol = 0.5) {
  const ax = spanAxis(dir);
  const [lo, hi] = ax === 'x' ? [d.x1, d.x2] : [d.y1, d.y2];
  return outerLines(plan, ax, lo, hi, tol).map(g => g.id);
}

// Move one edge of a diaphragm / TD (edge 'x1' | 'x2' | 'y1' | 'y2') to `at`. A support that sat on the old edge
// moves to the grid line at the new edge when there is one. Returns true when the inputs changed.
export function setEdge(inputs, plan, kind, id, edge, at) {
  const list = kind === 'td' ? inputs.tds : inputs.diaphragms;
  const r = list && list.find(x => x.id === id);
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
  r.supports = (r.supports || []).map(gid => {
    const g = plan.gridById.get(gid);
    return g && g.axis === axis && Math.abs(g.at - old) < 1e-6 && onNew ? onNew.id : gid;
  });
  return true;
}

// One click of the active tool at a snapped world point. Mutates inputs / state; returns true when inputs changed.
export function applyClick(inputs, plan, state, p, k = 10) {
  state.message = '';
  const pend = state.pending;
  const tol = Math.max(0.5, 8 / k);
  switch (state.tool) {
    case 'gridx': case 'gridy': {
      const axis = state.tool === 'gridx' ? 'x' : 'y';
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
    case 'opening': case 'td': case 'wall': case 'diaphragm': {
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
      } else if (state.tool === 'diaphragm') {
        const sup = guessDiaphragmSupports(plan, rect, state.dir, tol);
        const d = newDiaphragm(nextMark(inputs.diaphragms.filter(x => x.dir === state.dir), 'D'), state.dir, x1, x2, y1, y2, sup);
        inputs.diaphragms.push(d);
        state.sel = { kind: 'diaphragm', id: d.id };
        const nm = sup.map(id => plan.gridById.get(id).name);
        const ln = spanAxis(state.dir) === 'x' ? '↕' : '↔';
        state.message = d.mark + ': ' + (sup.length === 2 ? 'spans between ' + nm.join(' / ') :
          sup.length === 1 ? 'only support line ' + nm[0] + ' found inside it — add the second (a cantilever still needs a back-span support) or drag an edge to a ' + ln + ' grid'
            : 'no ' + ln + ' grid line inside it — add grid lines or drag its edges onto them') + '. Check in the panel.';
      } else {
        const t = newTd(nextMark(inputs.tds, 'TD'), x1, x2, y1, y2, state.dir);
        const guess = guessTdLines(plan, rect, tol);
        t.supports = guess.supports;
        t.loads = guess.loads;
        inputs.tds.push(t);
        state.sel = { kind: 'td', id: t.id };
        state.message = t.mark + ': supports ' + (guess.supports.length === 2 ? guess.supports.map(id => plan.gridById.get(id).name).join(' / ') : 'not found — pick them') +
          (guess.loads.length ? ', load line ' + guess.loads.map(l => plan.gridById.get(l.gridId).name).join(', ') : ', no load line inside — add one') + '. Check them in the panel.';
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
  const lists = { grid: 'grids', opening: 'openings', wall: 'walls', td: 'tds', diaphragm: 'diaphragms' };
  const list = inputs[lists[s.kind]];
  if (!list) return false;
  const i = list.findIndex(x => x.id === s.id);
  if (i < 0) return false;
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

// Support symbol on a diaphragm: a heavy line on the support grid across the diaphragm, with small triangles
function supportMark(v, d, g, col) {
  const grp = svg('g');
  if (g.axis === 'x') {
    const x = v.sx(g.at), ya = v.sy(d.y2), yb = v.sy(d.y1);
    grp.appendChild(svg('line', { x1: x, y1: ya, x2: x, y2: yb, stroke: col, 'stroke-width': 3.5, 'stroke-opacity': 0.7 }));
    for (const y of [ya + 10, (ya + yb) / 2, yb - 10]) grp.appendChild(svg('path', { d: `M${x},${y} l-7,-5 l0,10 z`, fill: col, 'fill-opacity': 0.8 }));
  } else {
    const y = v.sy(g.at), xa = v.sx(d.x1), xb = v.sx(d.x2);
    grp.appendChild(svg('line', { x1: xa, y1: y, x2: xb, y2: y, stroke: col, 'stroke-width': 3.5, 'stroke-opacity': 0.7 }));
    for (const x of [xa + 10, (xa + xb) / 2, xb - 10]) grp.appendChild(svg('path', { d: `M${x},${y} l-5,7 l10,0 z`, fill: col, 'fill-opacity': 0.8 }));
  }
  return grp;
}

// The drawing alone (also used read-only by later views). Shows the plan and the items of state.dir.
// opts.onPick(kind, id) makes items clickable.
export function drawPlan(plan, state, errors, opts = {}) {
  const v = viewOf(plan, state);
  const dir = state.dir || 'y';
  const bad = new Set((errors || []).filter(e => !e.warn).map(e => e.ref).filter(Boolean));
  const isSel = (kind, id) => state.sel && state.sel.kind === kind && state.sel.id === id;
  const pick = (kind, id) => opts.onPick ? (e) => { e.stopPropagation(); opts.onPick(kind, id); } : null;
  const cursor = opts.onPick ? 'cursor:pointer' : '';
  const root = svg('svg', { xmlns: NS, viewBox: `0 0 ${v.W} ${v.H}`, width: '100%', style: 'max-width:' + v.W + 'px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;user-select:none;touch-action:none;outline:none', tabindex: 0 });
  const g = svg('g', { class: 'td-plan' });
  root.appendChild(g);

  // sheathed outline and openings
  const o = plan.outline.filter(p => fin(p[0]) && fin(p[1]));
  if (o.length >= 3) g.appendChild(svg('polygon', { points: o.map(p => v.sx(p[0]) + ',' + v.sy(p[1])).join(' '), fill: C.fill, stroke: (errors || []).some(e => !e.warn && e.code.startsWith('outline')) ? C.err : C.edge, 'stroke-width': 2.5 }));
  for (const op of plan.openings) {
    if (![op.x1, op.x2, op.y1, op.y2].every(fin)) continue;
    const [x, y, w, h] = [v.sx(op.x1), v.sy(op.y2), (op.x2 - op.x1) * v.k, (op.y2 - op.y1) * v.k];
    const col = isSel('opening', op.id) ? C.sel : bad.has(op.id) ? C.err : C.edge;
    g.appendChild(svg('g', { style: cursor, onClick: pick('opening', op.id) },
      svg('rect', { x, y, width: w, height: h, fill: C.open, stroke: col, 'stroke-width': 1.5, 'stroke-dasharray': '6 3' }),
      svg('line', { x1: x, y1: y, x2: x + w, y2: y + h, stroke: col, 'stroke-width': 0.8 }),
      svg('line', { x1: x + w, y1: y, x2: x, y2: y + h, stroke: col, 'stroke-width': 0.8 }),
      op.name ? text(x + w / 2, y + h / 2 - 4, op.name, { fill: col }) : null));
  }

  // diaphragms of this direction (clipped outline drawn as a dashed rectangle + support marks). Result views
  // (opts.result) draw diaphragms and TDs as outlines only, so the result colours are the only fills;
  // opts.outlines === false leaves them out.
  const showRects = opts.outlines !== false;
  for (const d of showRects ? plan.diaphragms.filter(x => x.dir === dir) : []) {
    if (![d.x1, d.x2, d.y1, d.y2].every(fin)) continue;
    const [x, y, w, h] = [v.sx(d.x1), v.sy(d.y2), (d.x2 - d.x1) * v.k, (d.y2 - d.y1) * v.k];
    const col = isSel('diaphragm', d.id) ? C.sel : bad.has(d.id) ? C.err : C.dg;
    const grp = svg('g', { style: cursor, onClick: pick('diaphragm', d.id) },
      svg('rect', { x: x + 3, y: y + 3, width: Math.max(w - 6, 1), height: Math.max(h - 6, 1), fill: opts.result ? 'none' : C.dgFill, stroke: col, 'stroke-width': isSel('diaphragm', d.id) ? 2.5 : 1.5, 'stroke-dasharray': '10 4' }),
      text(x + 18, y + h - 10, d.mark || 'D', { fill: col, 'font-weight': 700, 'font-size': 13 }));
    for (const s of d.supports) if (s && fin(s.at)) grp.appendChild(supportMark(v, d, s, col));
    g.appendChild(grp);
  }

  // TDs of this direction
  for (const t of showRects ? plan.tds.filter(x => x.dir === dir) : []) {
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
    if (gr.axis === 'x') {
      const x = v.sx(gr.at);
      grp.appendChild(svg('line', { x1: x, y1: top + 10, x2: x, y2: v.sy(v.b.y1) + 12, stroke: col, 'stroke-width': 1, 'stroke-dasharray': '8 4 2 4' }));
      grp.appendChild(svg('line', { x1: x, y1: top + 10, x2: x, y2: v.sy(v.b.y1) + 12, stroke: 'transparent', 'stroke-width': 8 }));
      grp.appendChild(svg('circle', { cx: x, cy: top, r: 10, fill: '#fff', stroke: col, 'stroke-width': 1.2 }));
      grp.appendChild(text(x, top + 4, gr.name, { fill: isSel('grid', gr.id) ? C.sel : C.bubble }));
    } else {
      const y = v.sy(gr.at);
      grp.appendChild(svg('line', { x1: left + 10, y1: y, x2: v.sx(v.b.x2) + 12, y2: y, stroke: col, 'stroke-width': 1, 'stroke-dasharray': '8 4 2 4' }));
      grp.appendChild(svg('line', { x1: left + 10, y1: y, x2: v.sx(v.b.x2) + 12, y2: y, stroke: 'transparent', 'stroke-width': 8 }));
      grp.appendChild(svg('circle', { cx: left, cy: y, r: 10, fill: '#fff', stroke: col, 'stroke-width': 1.2 }));
      grp.appendChild(text(left, y + 4, gr.name, { fill: isSel('grid', gr.id) ? C.sel : C.bubble }));
    }
    g.appendChild(grp);
  }

  // walls
  for (const w of plan.walls) {
    if (!w.axis || !fin(w.from) || !fin(w.to)) continue;
    const col = isSel('wall', w.id) ? C.sel : bad.has(w.id) ? C.err : w.linked ? C.wallLinked : C.wall;
    const [x1, y1, x2, y2] = w.axis === 'x' ? [v.sx(w.at), v.sy(w.from), v.sx(w.at), v.sy(w.to)] : [v.sx(w.from), v.sy(w.at), v.sx(w.to), v.sy(w.at)];
    const lx = (x1 + x2) / 2 + (w.axis === 'x' ? -12 : 0), ly = (y1 + y2) / 2 + (w.axis === 'x' ? 0 : -8);
    g.appendChild(svg('g', { style: cursor, onClick: pick('wall', w.id) },
      svg('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': 6, 'stroke-linecap': 'butt' }),
      text(lx, ly, (w.mark || '') + (w.type && w.type !== 'segmented' ? ' ' + w.type.toUpperCase() : ''), { fill: col, 'font-size': 10, transform: w.axis === 'x' ? `rotate(-90 ${lx} ${ly})` : null })));
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
    const r = (state.sel.kind === 'td' ? plan.tds : plan.diaphragms).find(x => x.id === state.sel.id && x.dir === dir);
    if (r && [r.x1, r.x2, r.y1, r.y2].every(fin)) {
      const X1 = v.sx(r.x1), X2 = v.sx(r.x2), Y1 = v.sy(r.y1), Y2 = v.sy(r.y2);
      const edges = [['x1', X1, Y2, X1, Y1], ['x2', X2, Y2, X2, Y1], ['y1', X1, Y1, X2, Y1], ['y2', X1, Y2, X2, Y2]];
      for (const [edge, ax1, ay1, ax2, ay2] of edges) {
        const vert = edge[0] === 'x';
        const down = e => { e.stopPropagation(); e.preventDefault(); opts.onEdgeDown(state.sel.kind, r.id, edge); };
        g.appendChild(svg('line', { x1: ax1, y1: ay1, x2: ax2, y2: ay2, stroke: 'rgba(219,39,119,0.001)', 'stroke-width': 12, style: 'cursor:' + (vert ? 'ew-resize' : 'ns-resize'), class: 'td-edge', 'data-edge': edge, onMousedown: down }));
        const mx = (ax1 + ax2) / 2, my = (ay1 + ay2) / 2;
        g.appendChild(svg('rect', { x: mx - 5, y: my - 5, width: 10, height: 10, fill: '#fff', stroke: C.sel, 'stroke-width': 2, style: 'cursor:' + (vert ? 'ew-resize' : 'ns-resize'), class: 'td-edge', 'data-edge': edge, onMousedown: down }));
      }
    }
  }

  // live overlay (snap marker, rubber band): filled by the editor on mousemove
  const overlay = svg('g', { class: 'td-overlay', 'pointer-events': 'none' });
  g.appendChild(overlay);
  return { svg: root, group: g, overlay, view: v };
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
  else if (state.tool !== 'select') state.tool = 'select';
  else return false;
  state.message = '';
  return true;
}

// Preview of an edge being dragged: the rectangle with the moved edge at the snapped position
function drawEdgePreview(overlay, plan, v, d, s) {
  while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
  const r = (d.kind === 'td' ? plan.tds : plan.diaphragms).find(x => x.id === d.id);
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
export function renderPlanEditor({ inputs, plan, errors, state, refresh, wallsLinked = false, loadCases = null, q = null }) {
  if (wallsLinked && state.tool === 'wall') state.tool = 'select';
  const box = el('div', { className: 'td-editor' });
  const dirBar = el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '0.4rem' } },
    el('span', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)' } }, 'Load direction:'),
    ...['y', 'x'].map(d => el('button', { type: 'button', className: 'btn btn-sm' + (state.dir === d ? ' btn-primary' : ''),
      onClick() { state.dir = d; state.pending = []; state.sel = null; refresh(false); } }, DIR_LABEL[d])),
    el('span', { style: { fontSize: '0.75rem', color: 'var(--ink-tertiary)' } }, 'Diaphragms, TDs and loads belong to one direction; grids, outline, openings and walls are shared.'));
  box.appendChild(dirBar);
  const bar = el('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.4rem' } });
  for (const [key, label] of TOOLS) {
    const off = wallsLinked && key === 'wall';
    bar.appendChild(el('button', { type: 'button', className: 'btn btn-sm' + (state.tool === key ? ' btn-primary' : ''), disabled: off,
      title: off ? 'Walls come from the linked Shear Wall Design item (Setup)' : '',
      onClick() { state.tool = key; state.pending = []; state.message = ''; refresh(false); } }, label));
  }
  if (state.tool === 'outline' && state.pending.length) bar.appendChild(el('button', { type: 'button', className: 'btn btn-sm', onClick() { const ch = finishOutline(inputs, state); refresh(ch); } }, 'Finish outline'));
  if (state.pending.length) bar.appendChild(el('button', { type: 'button', className: 'btn btn-ghost btn-sm', onClick() { state.pending = []; state.message = ''; refresh(false); } }, 'Cancel'));
  bar.appendChild(el('span', { style: { flex: 1 } }));
  zoomButtons(plan, state, () => refresh(false)).forEach(b => bar.appendChild(b));
  if (state.sel) bar.appendChild(el('button', { type: 'button', className: 'btn btn-ghost btn-sm', style: { color: 'var(--fail)' }, onClick() { if (deleteSelected(inputs, state)) refresh(true); } }, 'Delete selected'));
  box.appendChild(bar);
  box.appendChild(el('div', { style: { fontSize: '0.78rem', color: state.message ? 'var(--ink-primary, #111)' : 'var(--ink-tertiary)', minHeight: '1.1em', marginBottom: '0.3rem' } },
    state.message || HINT[state.tool]));

  let edgeDrag = null; // { kind, id, edge, at }
  const { svg: drawing, group, overlay, view } = drawPlan(plan, state, errors, {
    onPick: state.tool === 'select' ? (kind, id) => { state.sel = { kind, id }; refresh(false); } : null,
    onEdgeDown: state.tool === 'select' ? (kind, id, edge) => { edgeDrag = { kind, id, edge, at: null }; } : null,
    loadCases, q,
  });
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
      if (d.at !== null && setEdge(inputs, plan, d.kind, d.id, d.edge, d.at)) { state.message = 'Edge moved to ' + d.edge[0] + ' = ' + r2(d.at) + '.'; refresh(true); }
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
    el('div', { style: { flex: '1 1 600px', minWidth: 0 } }, drawing, coords, planLegend()),
    el('div', { style: { flex: '0 1 400px', minWidth: '300px' } }, renderPanel(inputs, plan, state, refresh, wallsLinked))));
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
const section = (title, ...kids) => el('details', { open: true, style: { marginBottom: '0.6rem' } },
  el('summary', { className: 'section-header', style: { cursor: 'pointer', margin: '0 0 0.3rem' } }, title), ...kids);
const rowStyle = (state, kind, id) => (state.sel && state.sel.kind === kind && state.sel.id === id ? { background: '#fdf2f8' } : null);
const small = { fontSize: '0.75rem', color: 'var(--ink-tertiary)' };
const SHEATHING = [['', 'default'], ['wsp', 'WSP'], ['lumber_straight_single', 'Lumber straight'], ['lumber_diagonal_single', 'Lumber diag.'], ['lumber_diagonal_double', 'Lumber diag. ×2']];

function renderPanel(inputs, plan, state, refresh, wallsLinked = false) {
  const box = el('div', { style: { fontSize: '0.82rem' } });
  const dir = state.dir;
  // clicking a row selects it, except a click into one of its fields (a redraw would take the focus away)
  const select = (kind, id) => (e) => {
    if (e && e.target && /^(INPUT|SELECT|OPTION|BUTTON|TEXTAREA)$/.test(e.target.tagName)) return;
    if (state.sel && state.sel.kind === kind && state.sel.id === id) return;
    state.sel = { kind, id }; refresh(false);
  };
  const card = (kind, id) => el('div', { style: { border: '1px solid var(--border-light)', borderRadius: '6px', padding: '6px', marginBottom: '6px', ...(rowStyle(state, kind, id) || {}) }, onClick: select(kind, id) });
  const supportsRow = (obj, axis, label) => {
    while (obj.supports.length < 2) obj.supports.push('');
    return el('div', { style: { marginTop: '4px' } }, el('span', { style: small }, label + ' '),
      gridSelect(inputs, axis, obj.supports[0], id => { obj.supports[0] = id; refresh(true); }), ' ',
      gridSelect(inputs, axis, obj.supports[1], id => { obj.supports[1] = id; refresh(true); }));
  };

  // diaphragms of this direction
  {
    const body = el('div');
    const list = inputs.diaphragms.filter(d => d.dir === dir);
    const sAxis = spanAxis(dir);
    body.appendChild(el('p', { style: small }, 'For the load along ' + dir + ' each diaphragm spans between two ' + (sAxis === 'x' ? '↕' : '↔') + ' support lines (wall or collector lines). Its rectangle is clipped to the sheathed plan.'));
    for (const d of list) {
      const c = card('diaphragm', d.id);
      c.appendChild(el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
        textInput(d, 'mark', refresh, '44px'),
        ...['x1', 'x2', 'y1', 'y2'].flatMap(k => [el('span', { style: small }, k), numInput(d, k, refresh, '50px')]),
        delBtn(() => { inputs.diaphragms.splice(inputs.diaphragms.indexOf(d), 1); refresh(true); })));
      c.appendChild(supportsRow(d, sAxis, 'Spans between'));
      c.appendChild(el('div', { style: { marginTop: '4px' } }, el('span', { style: small }, 'Sheathing '),
        choose(SHEATHING, d.sheathing || '', v => { d.sheathing = v; refresh(true); }),
        el('span', { style: { ...small, marginLeft: '6px' } }, 'Blocking '),
        choose([['', 'default'], ['yes', 'blocked'], ['no', 'unblocked']], d.blocked === true ? 'yes' : d.blocked === false ? 'no' : '', v => { d.blocked = v === '' ? null : v === 'yes'; refresh(true); }),
        el('span', { style: { ...small, marginLeft: '6px' }, title: 'Where an opening splits the depth, the bands share the section shear by width at one section of the opening; each band then carries its own load. Auto: at the end on a support line (free chord ends, Ex 4.3), else at the opening end with the smaller shear (Ex 5.1).' }, 'Opening bands share V at '),
        choose([['', 'auto'], ['low', 'opening start (low ' + sAxis + ')'], ['high', 'opening end (high ' + sAxis + ')'], ['mid', 'mid-opening']], d.bandSplit || '', v => { d.bandSplit = v; refresh(true); })));
      body.appendChild(c);
    }
    if (!list.length) body.appendChild(el('p', { style: { ...small, color: 'var(--stale)' } }, 'None for this direction — use the Diaphragm tool.'));
    box.appendChild(section('Diaphragms — load along ' + dir, body));
  }

  // TDs of this direction
  {
    const body = el('div');
    const list = inputs.tds.filter(t => (t.dir || 'y') === dir);
    if (!list.length) body.appendChild(el('p', { style: small }, 'None for this direction — use the TD tool.'));
    for (const t of list) {
      const pt = plan.tds.find(x => x.id === t.id);
      const axis = pt && pt.supports[0] ? pt.supports[0].axis : null;
      const c = card('td', t.id);
      c.appendChild(el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
        textInput(t, 'mark', refresh, '48px'),
        ...['x1', 'x2', 'y1', 'y2'].flatMap(k => [el('span', { style: small }, k), numInput(t, k, refresh, '50px')]),
        delBtn(() => { inputs.tds.splice(inputs.tds.indexOf(t), 1); refresh(true); })));
      c.appendChild(supportsRow(t, null, 'Supports'));
      c.lastChild.appendChild(el('span', { style: { ...small, marginLeft: '8px' } }, 'Overhang '));
      c.lastChild.appendChild(el('input', { type: 'checkbox', checked: !!t.overhang, title: 'Cantilever: the TD runs past a support', onChange(e) { t.overhang = e.target.checked ? ['', ''] : null; refresh(true); } }));
      if (t.overhang) c.lastChild.appendChild(el('span', null, ' ', numInput(t.overhang, 0, refresh, '48px'), ' – ', numInput(t.overhang, 1, refresh, '48px')));
      const loads = el('div', { style: { marginTop: '4px' } }, el('span', { style: small }, 'Load lines (cut chord / strut enters from) '));
      t.loads.forEach((l, i) => loads.appendChild(el('span', { style: { marginRight: '6px', whiteSpace: 'nowrap' } },
        gridSelect(inputs, axis, l.gridId, id => { l.gridId = id; refresh(true); }),
        choose([['-', axis === 'y' ? 'left' : 'below'], ['+', axis === 'y' ? 'right' : 'above']], l.side === '-' ? '-' : '+', v => { l.side = v; refresh(true); }),
        delBtn(() => { t.loads.splice(i, 1); refresh(true); }))));
      if (t.loads.length < 2) loads.appendChild(el('button', { type: 'button', className: 'btn btn-ghost btn-sm', onClick() { t.loads.push({ gridId: '', side: '+' }); refresh(true); } }, '+ load line'));
      c.appendChild(loads);
      body.appendChild(c);
    }
    box.appendChild(section('Transfer diaphragms — load along ' + dir, body));
  }

  // loads: entered on Setup (Seismic loading / Wind loading); drawn on the plan
  {
    const n = inputs.loads.filter(x => (String(x.acts).endsWith('x') ? 'x' : 'y') === dir).length;
    box.appendChild(section('Loads — along ' + dir, el('p', { style: small },
      (n ? n + ' load(s) act along ' + dir + ' — drawn on the plan with the w(s) strip. ' : 'No load acts along ' + dir + '. ')
      + 'Loads are entered on the Setup tab: Seismic loading / Wind loading.')));
  }

  // shared plan items
  const gt = el('table', { className: 'dynamic-table' });
  gt.appendChild(el('tr', null, el('th', null, 'Name'), el('th', null, 'Runs'), el('th', null, 'At (ft)'), el('th', { title: 'Reference station only (e.g. centerline)' }, 'Ref'), el('th', null, '')));
  [...inputs.grids].sort((a, b) => (a.axis === b.axis ? Number(a.at) - Number(b.at) : a.axis < b.axis ? -1 : 1)).forEach(g => gt.appendChild(el('tr', { style: rowStyle(state, 'grid', g.id), onClick: select('grid', g.id) },
    el('td', null, textInput(g, 'name', refresh, '44px')),
    el('td', { style: small }, g.axis === 'x' ? '↕ x =' : '↔ y ='),
    el('td', null, numInput(g, 'at', refresh)),
    el('td', null, el('input', { type: 'checkbox', checked: !!g.ref, onChange(e) { g.ref = e.target.checked; refresh(true); } })),
    el('td', null, delBtn(() => { inputs.grids.splice(inputs.grids.indexOf(g), 1); refresh(true); })))));
  box.appendChild(section('Grid lines (shared)', el('div', { className: 'table-scroll' }, gt),
    el('div', { style: { display: 'flex', gap: '4px', marginTop: '4px' } },
      el('button', { type: 'button', className: 'btn btn-sm', onClick() { const xs = plan.grids.filter(g => g.axis === 'x').map(g => g.at).filter(fin); inputs.grids.push(newGrid(nextGridName(inputs, 'x'), 'x', xs.length ? Math.max(...xs) + 20 : 0)); refresh(true); } }, '+ Grid ↕'),
      el('button', { type: 'button', className: 'btn btn-sm', onClick() { const ys = plan.grids.filter(g => g.axis === 'y').map(g => g.at).filter(fin); inputs.grids.push(newGrid(nextGridName(inputs, 'y'), 'y', ys.length ? Math.max(...ys) + 20 : 0)); refresh(true); } }, '+ Grid ↔'))));

  const ot = el('table', { className: 'dynamic-table' });
  ot.appendChild(el('tr', null, el('th', null, '#'), el('th', null, 'x'), el('th', null, 'y'), el('th', null, '')));
  inputs.outline.forEach((p, i) => ot.appendChild(el('tr', null, el('td', { style: small }, String(i + 1)), el('td', null, numInput(p, 'x', refresh)), el('td', null, numInput(p, 'y', refresh)),
    el('td', null, delBtn(() => { inputs.outline.splice(i, 1); refresh(true); }, 'Delete corner')))));
  box.appendChild(section('Outline (shared, corners in order)', el('div', { className: 'table-scroll', style: { maxHeight: '180px', overflowY: 'auto' } }, ot),
    el('button', { type: 'button', className: 'btn btn-sm', style: { marginTop: '4px' }, onClick() { inputs.outline.push({ x: '', y: '' }); refresh(true); } }, '+ Corner')));

  if (inputs.openings.length) {
    const t = el('table', { className: 'dynamic-table' });
    t.appendChild(el('tr', null, el('th', null, 'Name'), el('th', null, 'x1'), el('th', null, 'x2'), el('th', null, 'y1'), el('th', null, 'y2'), el('th', null, '')));
    inputs.openings.forEach(o => t.appendChild(el('tr', { style: rowStyle(state, 'opening', o.id), onClick: select('opening', o.id) },
      el('td', null, textInput(o, 'name', refresh, '44px')), ...['x1', 'x2', 'y1', 'y2'].map(k => el('td', null, numInput(o, k, refresh, '52px'))),
      el('td', null, delBtn(() => { inputs.openings.splice(inputs.openings.indexOf(o), 1); refresh(true); })))));
    box.appendChild(section('Openings (shared)', el('div', { className: 'table-scroll' }, t)));
  }

  if (wallsLinked) {
    const lt = el('table', { className: 'dynamic-table' });
    lt.appendChild(el('tr', null, el('th', null, 'Mark'), el('th', null, 'Line'), el('th', null, 'Type'), el('th', null, 'From'), el('th', null, 'To')));
    plan.walls.forEach(w => lt.appendChild(el('tr', { style: rowStyle(state, 'wall', w.id), onClick: select('wall', w.id) },
      el('td', null, w.mark), el('td', null, w.line), el('td', { style: small }, w.type || 'segmented'), el('td', { className: 'mono' }, fmt(w.from)), el('td', { className: 'mono' }, fmt(w.to)))));
    box.appendChild(section('Shear walls (from Shear Wall Design, read-only)', plan.walls.length ? el('div', { className: 'table-scroll' }, lt)
      : el('p', { style: small }, 'No wall of this level is placed yet — check the level name, direction mapping and line names (Setup).')));
    return box;
  }
  const wt = el('table', { className: 'dynamic-table' });
  wt.appendChild(el('tr', null, el('th', null, 'Mark'), el('th', null, 'Line'), el('th', null, 'Grid'), el('th', null, 'From'), el('th', null, 'To'), el('th', null, '')));
  inputs.walls.forEach(w => wt.appendChild(el('tr', { style: rowStyle(state, 'wall', w.id), onClick: select('wall', w.id) },
    el('td', null, textInput(w, 'mark', refresh, '44px')), el('td', null, textInput(w, 'line', refresh, '36px')),
    el('td', null, gridSelect(inputs, null, w.gridId, id => { w.gridId = id; refresh(true); })),
    el('td', null, numInput(w, 'from', refresh, '52px')), el('td', null, numInput(w, 'to', refresh, '52px')),
    el('td', null, delBtn(() => { inputs.walls.splice(inputs.walls.indexOf(w), 1); refresh(true); })))));
  box.appendChild(section('Shear walls (shared)', inputs.walls.length ? el('div', { className: 'table-scroll' }, wt) : el('p', { style: small }, 'None yet — use the Wall tool. Walls with the same line name form one line of resistance.')));
  return box;
}
