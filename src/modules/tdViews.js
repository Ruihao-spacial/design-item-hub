// Diaphragm Analysis — result views (DOM). Views 2–4 (Phase 6): TD shear, net shear, member diagrams. View 1 (Phase 4): basic unit shear v_b painted on the plan per band and
// interval (signed scale, values at the band ends), line forces on the support lines, wall shares; tables below.
// The plan is drawn by tdPlanEditor.drawPlan (read-only use); the overlay goes under its lines.
import { el } from '../utils.js';
import { drawPlan, newEditorState } from './tdPlanEditor.js';
import { sectionAt } from './tdBasicShear.js';
import { breaks, vNetAt } from './tdNet.js';

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
const label = (x, y, s, attrs = {}) => svg('text', { x, y, 'font-size': 10, 'text-anchor': 'middle', fill: '#111827', 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3, ...attrs }, s);
export const caseLabel = c => 'Load along ' + c.dir + ' (' + (c.dir === 'y' ? '↕' : '↔') + ') — ' + (c.kind === 'E' ? 'seismic E' : 'wind W');

// View 1 drawing for one case
export function drawBasicShear(plan, cs) {
  const state = { ...newEditorState(), dir: cs.dir, sel: null };
  const { svg: root, group: g, view: v } = drawPlan(plan, state, [], {});
  const paint = svg('g', { class: 'td-view1' });
  const vmax = Math.max(1e-9, ...cs.diaphragms.flatMap(d => d.intervals.flatMap(i => i.bands.flatMap(b => [Math.abs(b.va), Math.abs(b.vb)]))));
  const rect = (a, b, lo, hi) => (cs.axis === 'x' ? { x1: a, x2: b, y1: lo, y2: hi } : { x1: lo, x2: hi, y1: a, y2: b });
  for (const d of cs.diaphragms) for (const iv of d.intervals) for (const bd of iv.bands) {
    const r = rect(iv.a, iv.b, bd.lo, bd.hi);
    const vm = (bd.va + bd.vb) / 2;
    paint.appendChild(svg('rect', { x: v.sx(r.x1), y: v.sy(r.y2), width: (r.x2 - r.x1) * v.k, height: (r.y2 - r.y1) * v.k,
      fill: vm >= 0 ? POS : NEG, 'fill-opacity': (0.08 + 0.45 * Math.abs(vm) / vmax).toFixed(3), stroke: '#ffffff', 'stroke-width': 0.5 }));
    const len = (iv.b - iv.a) * v.k, dep = (bd.hi - bd.lo) * v.k;
    if (dep < 14) continue;
    const mid = (bd.lo + bd.hi) / 2;
    const at = (s, val, anchor) => {
      const [x, y] = cs.axis === 'x' ? [v.sx(s), v.sy(mid)] : [v.sx(mid), v.sy(s)];
      return label(cs.axis === 'x' ? x + (anchor === 'start' ? 3 : -3) : x, cs.axis === 'x' ? y + 3 : y + (anchor === 'start' ? -4 : 11), f1(val), { 'text-anchor': cs.axis === 'x' ? anchor : 'middle', 'font-size': 9 });
    };
    if (len >= 60 || (len >= 30 && Math.abs(bd.va - bd.vb) < 0.05)) {
      paint.appendChild(at(iv.a, bd.va, 'start'));
      if (Math.abs(bd.va - bd.vb) >= 0.05) paint.appendChild(at(iv.b, bd.vb, 'end'));
    }
  }
  // line forces at the support lines, wall shares at the walls
  for (const ln of cs.lines) {
    if (Math.abs(ln.P) < 0.5 && !(ln.from || []).length) continue;
    const gr = plan.gridById.get(ln.gridId);
    if (!gr) continue;
    const [x, y] = gr.axis === 'x' ? [v.sx(gr.at), v.b ? v.sy(v.b.y2) - 22 : 20] : [v.sx(v.b.x2) + 4, v.sy(gr.at) - 4];
    paint.appendChild(label(x, y, ln.name + ': ' + f0(ln.P) + ' lb' + (ln.into ? ' → ' + ln.into.join(', ') : ''), { 'font-weight': 600, 'text-anchor': gr.axis === 'x' ? 'middle' : 'start', fill: ln.into ? '#b45309' : '#111827' }));
    for (const w of ln.walls || []) {
      const m = (w.from + w.to) / 2;
      const [wx, wy] = gr.axis === 'x' ? [v.sx(gr.at) + 4, v.sy(m)] : [v.sx(m), v.sy(gr.at) + 12];
      paint.appendChild(label(wx, wy, (w.mark || 'wall') + ' ' + f0(w.share) + ' lb · ' + f1(w.v) + ' plf', { 'text-anchor': gr.axis === 'x' ? 'start' : 'middle', fill: '#4338ca', 'font-size': 9 }));
    }
  }
  // under the plan lines: after the outline polygon
  const first = g.querySelector('polygon');
  if (first && first.nextSibling) g.insertBefore(paint, first.nextSibling); else g.appendChild(paint);
  // legend
  root.appendChild(svg('g', null,
    svg('rect', { x: 10, y: 8, width: 12, height: 10, fill: POS, 'fill-opacity': 0.5 }), label(26, 17, '+ v_b', { 'text-anchor': 'start' }),
    svg('rect', { x: 70, y: 8, width: 12, height: 10, fill: NEG, 'fill-opacity': 0.5 }), label(86, 17, '− v_b (plf, book "+" element)', { 'text-anchor': 'start' })));
  return root;
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
  const cs = cases.find(c => c.id === pick.id) || cases[0];
  box.appendChild(el('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '0.5rem' } },
    ...cases.map(c => el('button', { type: 'button', className: 'btn btn-sm' + (c.id === cs.id ? ' btn-primary' : ''), onClick() { pick.set(c.id); } }, caseLabel(c)))));
  const view = pick.view || 1;
  box.appendChild(el('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '0.5rem' } },
    ...[[1, 'View 1 · basic shear'], [2, 'View 2 · TD shear'], [3, 'View 3 · net shear'], [4, 'View 4 · member forces']].map(([n, t]) =>
      el('button', { type: 'button', className: 'btn btn-sm' + (n === view ? ' btn-primary' : ' btn-ghost'), onClick() { pick.setView(n); } }, t))));
  if (view === 2 || view === 3) {
    box.appendChild(el('div', { className: 'section-header' }, view === 2 ? 'View 2 — TD unit shear v_TD' : 'View 3 — net unit shear v_net = v_b + v_TD'));
    box.appendChild(view === 2 ? drawTdShear(plan, cs) : drawNetShear(plan, cs));
    box.appendChild(el('p', { style: small }, view === 2
      ? 'Segment shears of each TD that ran (TDs tab), book "+" element, plf. Outside the TDs v_TD = 0.'
      : 'Net shear = basic + TD shear (plf, book "+" element); outside the TDs it equals the basic shear. Values at the cell ends along the span.'));
    if (!(cs.fields || []).length) box.appendChild(el('p', { style: { ...small, color: 'var(--stale)' } }, 'No TD has results in this load case (TDs tab).'));
    return box;
  }
  if (view === 4) {
    const show = pick.show || { chord: true, cross: true };
    box.appendChild(el('div', { className: 'section-header' }, 'View 4 — chord, strut, collector and drag forces (net field)'));
    box.appendChild(el('div', { style: { display: 'flex', gap: '12px', fontSize: '0.8rem', marginBottom: '4px' } },
      ...[['chord', 'along the span (chords, struts)'], ['cross', 'across the span (collectors, drag struts)']].map(([k, t]) => el('label', null,
        el('input', { type: 'checkbox', checked: show[k] !== false, onChange(e) { pick.setShow({ ...show, [k]: e.target.checked }); } }), ' ' + t))));
    box.appendChild(drawMembers(plan, cs, show));
    box.appendChild(el('p', { style: small }, 'Every line is a member: N = ∫ (v on one side − v on the other − wall reaction) from a free end, on the net field; tension +. A wall line runs continuously across a gap inside the outline (strut). Each run must close to ~0 at its far end (Checks tab).'));
    box.appendChild(el('div', { className: 'table-scroll', style: { maxHeight: '360px', overflowY: 'auto' } }, memberTable(cs, pick.closureTol || 0.01)));
    return box;
  }
  box.appendChild(el('div', { className: 'section-header' }, 'View 1 — basic unit shear v', el('sub', null, 'b'), ' = V / d'));
  box.appendChild(drawBasicShear(plan, cs));
  box.appendChild(el('p', { style: small },
    'Flexible diaphragm, span by span: each diaphragm is a beam between its two support lines. Values at the band ends (plf); + = the book\'s "+" sheathing element. '
    + 'Line forces are positive in the load direction. A line without a wall passes its force to the TD it loads (orange).'));

  // line forces and walls
  const lt = el('table', { className: 'dynamic-table' });
  lt.appendChild(el('tr', null, ...['Line', 'Force (lb)', 'Made of', 'Walls: share (lb) · v (plf)', 'Split'].map(h => el('th', null, h))));
  for (const ln of [...cs.lines].sort((a, b) => a.at - b.at)) {
    lt.appendChild(el('tr', null, el('td', null, ln.name), el('td', { className: 'mono' }, f0(ln.P)),
      el('td', { style: { fontSize: '0.78rem' } }, (ln.from || []).map(f => f.src + ' ' + f0(f.F * cs.sigma)).join(' · ')),
      el('td', { className: 'mono', style: { fontSize: '0.8rem' } }, ln.into ? 'into ' + ln.into.join(', ') : (ln.walls || []).map(w => (w.mark || 'wall') + ' ' + f0(w.share) + ' · ' + f1(w.v)).join('; ') || (ln.noWall ? 'no wall' : '—')),
      el('td', { style: { fontSize: '0.78rem' } }, (ln.walls || []).length ? (ln.walls[0].basis === 'swd' ? 'Shear Wall Design' : 'by length') : '')));
  }
  const total = cs.diaphragms.reduce((t, d) => t + d.load, 0) * cs.sigma;
  const sumLines = cs.lines.reduce((t, l) => t + l.P, 0);
  box.appendChild(el('div', { className: 'section-header', style: { marginTop: '0.8rem' } }, 'Line forces and wall shares'));
  box.appendChild(el('div', { className: 'table-scroll' }, lt));
  box.appendChild(el('p', { style: { ...small, color: Math.abs(total - sumLines) < 0.5 ? 'var(--pass)' : 'var(--fail)' } },
    'Total load ' + f0(total) + ' lb · Σ line forces ' + f0(sumLines) + ' lb' + (Math.abs(total - sumLines) < 0.5 ? ' ✓' : ' ✗')));

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
const paintPlan = (plan, cs) => {
  const state = { ...newEditorState(), dir: cs.dir, sel: null };
  const d = drawPlan(plan, state, [], {});
  const layer = svg('g', { class: 'td-view' });
  const first = d.group.querySelector('polygon');
  if (first && first.nextSibling) d.group.insertBefore(layer, first.nextSibling); else d.group.appendChild(layer);
  return { root: d.svg, v: d.view, layer };
};
const legend = (root, txt) => root.appendChild(svg('g', null,
  svg('rect', { x: 10, y: 8, width: 12, height: 10, fill: POS, 'fill-opacity': 0.5 }), label(26, 17, '+', { 'text-anchor': 'start' }),
  svg('rect', { x: 40, y: 8, width: 12, height: 10, fill: NEG, 'fill-opacity': 0.5 }), label(56, 17, '− ' + txt, { 'text-anchor': 'start' })));
const toXY = (cs, s, c) => (cs.axis === 'x' ? [s, c] : [c, s]);

// View 2: the TD unit shears on their segments
export function drawTdShear(plan, cs) {
  const { root, v, layer } = paintPlan(plan, cs);
  const fields = cs.fields || [];
  const vmax = Math.max(1e-9, ...fields.flatMap(f => f.segs.map(s => Math.abs(s.v))));
  for (const f of fields) for (const sg of f.segs) {
    const r = f.along === 'x' ? { x1: sg.lo, x2: sg.hi, y1: f.rect.y1, y2: f.rect.y2 } : { x1: f.rect.x1, x2: f.rect.x2, y1: sg.lo, y2: sg.hi };
    layer.appendChild(svg('rect', { x: v.sx(r.x1), y: v.sy(r.y2), width: (r.x2 - r.x1) * v.k, height: (r.y2 - r.y1) * v.k,
      fill: sg.v >= 0 ? POS : NEG, 'fill-opacity': (0.1 + 0.5 * Math.abs(sg.v) / vmax).toFixed(3), stroke: '#fff', 'stroke-width': 0.5 }));
    layer.appendChild(label(v.sx((r.x1 + r.x2) / 2), v.sy((r.y1 + r.y2) / 2) + 3, f1(sg.v), { 'font-weight': 600 }));
  }
  for (const f of fields) layer.appendChild(label(v.sx(f.rect.x1) + 3, v.sy(f.rect.y2) + 11, f.mark, { 'text-anchor': 'start', fill: '#7c3aed' }));
  legend(root, 'v_TD (plf)');
  return root;
}

// View 3: net unit shear v_b + v_TD, cell by cell (values at the cell ends along the span)
export function drawNetShear(plan, cs) {
  const { root, v, layer } = paintPlan(plan, cs);
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
    layer.appendChild(svg('rect', { x: v.sx(x1), y: v.sy(y2), width: (x2 - x1) * v.k, height: (y2 - y1) * v.k,
      fill: vm >= 0 ? POS : NEG, 'fill-opacity': (0.08 + 0.45 * Math.abs(vm) / vmax).toFixed(3), stroke: '#fff', 'stroke-width': 0.5 }));
    const len = (c.b - c.a) * v.k, dep = (c.q - c.p) * v.k;
    if (dep < 14 || len < 30) continue;
    const at = (s, val, anchor) => { const [x, y] = toXY(cs, s, (c.p + c.q) / 2);
      return label(cs.axis === 'x' ? v.sx(x) + (anchor === 'start' ? 3 : -3) : v.sx(x), cs.axis === 'x' ? v.sy(y) + 3 : v.sy(y) + (anchor === 'start' ? -4 : 11), f1(val), { 'text-anchor': cs.axis === 'x' ? anchor : 'middle', 'font-size': 9 }); };
    layer.appendChild(at(c.a, c.va, 'start'));
    if (Math.abs(c.va - c.vb) >= 0.05 && len >= 60) layer.appendChild(at(c.b, c.vb, 'end'));
  }
  legend(root, 'v_net (plf)');
  return root;
}

// View 4: member force diagrams on their lines (tension blue, compression red); max of each run labelled
export function drawMembers(plan, cs, show = { chord: true, cross: true }) {
  const { root, v, layer } = paintPlan(plan, cs);
  const ms = (cs.members || []).filter(m => show[m.family]);
  const nmax = Math.max(1e-9, ...ms.flatMap(m => m.runs.map(r => Math.abs(r.max))));
  const H = 34 / nmax; // px per lb
  for (const m of ms) for (const r of m.runs) {
    if (Math.abs(r.max) < 0.5) continue;
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
      layer.appendChild(svg('polygon', { points: poly, fill: n0 + n1 >= 0 ? POS : NEG, 'fill-opacity': 0.35, stroke: n0 + n1 >= 0 ? POS : NEG, 'stroke-width': 0.6 }));
    }
    const [lx, ly] = xy(r.maxAt, r.max);
    layer.appendChild(label(lx, ly + (r.max >= 0 ? -3 : 10), (r.max >= 0 ? 'T ' : 'C ') + f0(Math.abs(r.max)), { 'font-size': 9, fill: r.max >= 0 ? '#1d4ed8' : '#b91c1c', 'font-weight': 600 }));
  }
  root.appendChild(svg('g', null,
    svg('rect', { x: 10, y: 8, width: 12, height: 10, fill: POS, 'fill-opacity': 0.5 }), label(26, 17, 'tension', { 'text-anchor': 'start' }),
    svg('rect', { x: 80, y: 8, width: 12, height: 10, fill: NEG, 'fill-opacity': 0.5 }), label(96, 17, 'compression (lb)', { 'text-anchor': 'start' })));
  return root;
}

// View 4 table: every member run with its max and closure residual
export function memberTable(cs, closureTol) {
  const t = el('table', { className: 'dynamic-table', style: { fontSize: '0.8rem' } });
  t.appendChild(el('tr', null, ...['Line', 'Member', 'Run', 'Max (lb)', 'at', 'Closure residual (lb)'].map(h => el('th', null, h))));
  for (const m of cs.members || []) for (const r of m.runs) {
    if (Math.abs(r.max) < 0.5 && Math.abs(r.residual) < 0.5) continue;
    const ok = Math.abs(r.residual) <= Math.max(1, closureTol * Math.abs(r.max));
    t.appendChild(el('tr', null, el('td', null, m.name), el('td', null, m.family === 'chord' ? 'chord / strut along the span' : 'collector / strut across the span'),
      el('td', { className: 'mono' }, f1(r.from) + ' – ' + f1(r.to)), el('td', { className: 'mono' }, (r.max >= 0 ? 'T ' : 'C ') + f0(Math.abs(r.max))),
      el('td', { className: 'mono' }, f1(r.maxAt)), el('td', { className: 'mono', style: { color: ok ? 'var(--pass)' : 'var(--fail)' } }, f0(r.residual) + (ok ? ' ✓' : ' ✗'))));
  }
  return t;
}
