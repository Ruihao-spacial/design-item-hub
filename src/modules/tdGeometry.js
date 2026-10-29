// Transfer Diaphragm — plan geometry (pure, no DOM).
// Plan coordinates: x to the right, y up, feet. The sheathed region is a rectilinear outline minus rectangular
// openings. Used by the plan editor (errors, ΣA), the basic-shear engine (depth d at a section) and the tests.
//
// Stored inputs keep what the user typed (strings, ids). parsePlan() turns them into numbers; references are by id.

const EPS = 1e-6;
const r2 = v => Math.round(v * 100) / 100;
const num = v => (v === '' || v === null || v === undefined ? NaN : Number(v));
const fin = v => Number.isFinite(v);

// inputs → { grids, gridById, outline, openings, walls, tds, loads } with numbers; unparseable items are kept with NaN
export function parsePlan(inputs) {
  const grids = (inputs.grids || []).map(g => ({ id: g.id, name: String(g.name || '').trim(), axis: g.axis === 'y' ? 'y' : 'x', at: num(g.at), ref: !!g.ref }));
  const gridById = new Map(grids.map(g => [g.id, g]));
  const outline = (inputs.outline || []).map(p => [num(p.x), num(p.y)]);
  const openings = (inputs.openings || []).map(o => ({ id: o.id, name: o.name || '', x1: Math.min(num(o.x1), num(o.x2)), x2: Math.max(num(o.x1), num(o.x2)), y1: Math.min(num(o.y1), num(o.y2)), y2: Math.max(num(o.y1), num(o.y2)) }));
  const walls = (inputs.walls || []).map(w => {
    const g = gridById.get(w.gridId);
    const a = num(w.from), b = num(w.to);
    return { id: w.id, line: String(w.line || (g && g.name) || '').trim(), mark: w.mark || '', gridId: w.gridId, axis: g ? g.axis : null, at: g ? g.at : NaN, from: Math.min(a, b), to: Math.max(a, b),
      linked: !!w.linked, type: w.type || '' };
  });
  const tds = (inputs.tds || []).map(t => ({
    id: t.id, mark: t.mark || '', dir: t.dir === 'x' ? 'x' : 'y',
    x1: Math.min(num(t.x1), num(t.x2)), x2: Math.max(num(t.x1), num(t.x2)),
    y1: Math.min(num(t.y1), num(t.y2)), y2: Math.max(num(t.y1), num(t.y2)),
    supports: (t.supports || []).map(id => gridById.get(id) || null),
    loads: (t.loads || []).map(l => ({ grid: gridById.get(l.gridId) || null, side: l.side === '-' ? '-' : '+' })),
    overhang: t.overhang && t.overhang.length === 2 && t.overhang.every(v => v !== '') ? t.overhang.map(num).sort((a, b) => a - b) : null,
  }));
  const diaphragms = (inputs.diaphragms || []).map(d => ({
    id: d.id, mark: d.mark || '', dir: d.dir === 'x' ? 'x' : 'y',
    x1: Math.min(num(d.x1), num(d.x2)), x2: Math.max(num(d.x1), num(d.x2)),
    y1: Math.min(num(d.y1), num(d.y2)), y2: Math.max(num(d.y1), num(d.y2)),
    supports: (d.supports || []).map(id => gridById.get(id) || null),
    sheathing: d.sheathing || '', blocked: d.blocked,
  }));
  const loads = (inputs.loads || []).map(l => ({
    id: l.id, acts: ['+x', '-x', '+y', '-y'].includes(l.acts) ? l.acts : '-y', mode: ['seismic', 'area', 'line'].includes(l.mode) ? l.mode : 'line',
    psf: num(l.psf), edge: l.edgeId ? gridById.get(l.edgeId) || null : null,
    segments: (l.segments || []).map(s => ({ from: num(s.from), to: num(s.to), w: num(s.w), w2: s.w2 === '' || s.w2 === undefined ? null : num(s.w2) })),
  }));
  return { grids, gridById, outline, openings, walls, tds, diaphragms, loads };
}

// Load direction of a load: the axis it acts along ('y' for ±y). A diaphragm / TD carries the same tag.
export const dirOf = acts => (String(acts).endsWith('x') ? 'x' : 'y');
export const DIR_LABEL = { y: 'Load along y (↕)', x: 'Load along x (↔)' };

export function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

// Point strictly inside / on the boundary of a simple polygon (ray casting; boundary counts as inside)
export function pointInPolygon(x, y, pts) {
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    if (Math.abs((x2 - x1) * (y - y1) - (y2 - y1) * (x - x1)) < EPS && x >= Math.min(x1, x2) - EPS && x <= Math.max(x1, x2) + EPS && y >= Math.min(y1, y2) - EPS && y <= Math.max(y1, y2) + EPS) return true;
  }
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const inRect = (x, y, r) => x > r.x1 + EPS && x < r.x2 - EPS && y > r.y1 + EPS && y < r.y2 - EPS;

// Sheathed (diaphragm) at a point: inside the outline and not inside an opening
export function isSheathed(plan, x, y) {
  return pointInPolygon(x, y, plan.outline) && !plan.openings.some(o => inRect(x, y, o));
}

function segmentsCross(a, b, c, d) {
  // proper crossing of two orthogonal segments (touching at ends does not count)
  const h1 = a[1] === b[1], h2 = c[1] === d[1];
  if (h1 === h2) return false;
  const [H0, H1, V0, V1] = h1 ? [a, b, c, d] : [c, d, a, b];
  const y = H0[1], x = V0[0];
  return x > Math.min(H0[0], H1[0]) + EPS && x < Math.max(H0[0], H1[0]) - EPS && y > Math.min(V0[1], V1[1]) + EPS && y < Math.max(V0[1], V1[1]) - EPS;
}

// Every problem in the plan, for the editor and the save message: [{ code, msg, ref? }]
export function planErrors(plan) {
  const err = [];
  const names = new Map();
  for (const g of plan.grids) {
    if (!g.name) err.push({ code: 'grid-name', msg: 'A grid line has no name.', ref: g.id });
    if (!fin(g.at)) err.push({ code: 'grid-at', msg: `Grid ${g.name || '?'}: position is not a number.`, ref: g.id });
    const k = g.axis + ':' + g.name.toLowerCase();
    if (g.name && names.has(k)) err.push({ code: 'grid-dup', msg: `Grid name ${g.name} is used twice.`, ref: g.id });
    names.set(k, g.id);
  }
  const o = plan.outline;
  if (o.length < 4) err.push({ code: 'outline-short', msg: 'The outline needs at least 4 corners.' });
  else if (o.some(p => !fin(p[0]) || !fin(p[1]))) err.push({ code: 'outline-nan', msg: 'An outline corner is not a number.' });
  else {
    for (let i = 0; i < o.length; i++) {
      const a = o[i], b = o[(i + 1) % o.length];
      if (a[0] !== b[0] && a[1] !== b[1]) err.push({ code: 'outline-diag', msg: `Outline edge ${i + 1} is not horizontal or vertical.` });
      if (a[0] === b[0] && a[1] === b[1]) err.push({ code: 'outline-zero', msg: `Outline corners ${i + 1} and ${(i + 1) % o.length + 1} are the same point.` });
    }
    for (let i = 0; i < o.length; i++) for (let j = i + 2; j < o.length; j++) {
      if (i === 0 && j === o.length - 1) continue;
      if (segmentsCross(o[i], o[(i + 1) % o.length], o[j], o[(j + 1) % o.length])) { err.push({ code: 'outline-cross', msg: 'The outline crosses itself.' }); i = o.length; break; }
    }
    if (Math.abs(polygonArea(o)) < EPS) err.push({ code: 'outline-area', msg: 'The outline has no area.' });
  }
  const outlineOk = !err.some(e => e.code.startsWith('outline'));
  const rectInside = r => [[r.x1, r.y1], [r.x2, r.y1], [r.x2, r.y2], [r.x1, r.y2], [(r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2]].every(([x, y]) => pointInPolygon(x, y, o));
  for (const op of plan.openings) {
    const label = 'Opening ' + (op.name || '');
    if (![op.x1, op.x2, op.y1, op.y2].every(fin) || op.x2 - op.x1 < EPS || op.y2 - op.y1 < EPS) err.push({ code: 'opening-size', msg: `${label}: size is missing or zero.`, ref: op.id });
    else if (outlineOk && !rectInside(op)) err.push({ code: 'opening-outside', msg: `${label} is not inside the outline.`, ref: op.id });
  }
  for (const w of plan.walls) {
    const label = 'Wall ' + (w.mark || w.line || '');
    if (!w.axis) err.push({ code: 'wall-grid', msg: `${label}: pick the grid line it sits on.`, ref: w.id });
    else if (!fin(w.from) || !fin(w.to) || w.to - w.from < EPS) err.push({ code: 'wall-extent', msg: `${label}: start / end missing or zero length.`, ref: w.id });
    else if (outlineOk) {
      const mid = (w.from + w.to) / 2;
      const [x, y] = w.axis === 'x' ? [w.at, mid] : [mid, w.at];
      if (!pointInPolygon(x, y, o)) err.push({ code: 'wall-outside', msg: `${label} is not on the diaphragm.`, ref: w.id });
    }
  }
  const tdNames = new Set();
  for (const t of plan.tds) {
    const label = 'TD ' + (t.mark || '');
    if (t.mark && tdNames.has(t.mark)) err.push({ code: 'td-dup', msg: `${label}: mark used twice.`, ref: t.id });
    tdNames.add(t.mark);
    if (![t.x1, t.x2, t.y1, t.y2].every(fin) || t.x2 - t.x1 < EPS || t.y2 - t.y1 < EPS) { err.push({ code: 'td-size', msg: `${label}: rectangle is missing or zero.`, ref: t.id }); continue; }
    if (outlineOk && !rectInside(t)) err.push({ code: 'td-outside', msg: `${label} is not inside the outline.`, ref: t.id });
    if (plan.openings.some(op => op.x1 < t.x2 - EPS && op.x2 > t.x1 + EPS && op.y1 < t.y2 - EPS && op.y2 > t.y1 + EPS)) err.push({ code: 'td-opening', msg: `${label} contains an opening (not allowed in a TD).`, ref: t.id });
    if (t.supports.length !== 2 || t.supports.some(g => !g)) err.push({ code: 'td-supports', msg: `${label}: pick its two support lines.`, ref: t.id });
    else if (t.supports[0].axis !== t.supports[1].axis) err.push({ code: 'td-supports-axis', msg: `${label}: both support lines must run the same way.`, ref: t.id });
    else {
      const ax = t.supports[0].axis; // supports along x-grids → TD spans along x
      const [lo, hi] = ax === 'x' ? [t.x1, t.x2] : [t.y1, t.y2];
      const on = g => g.at >= lo - EPS && g.at <= hi + EPS;
      if (!t.supports.every(on)) err.push({ code: 'td-supports-out', msg: `${label}: support lines must cross the TD.`, ref: t.id });
      if (!t.loads.length) err.push({ code: 'td-loads', msg: `${label}: add the line where the cut chord / strut enters.`, ref: t.id });
      if (t.loads.length > 2) err.push({ code: 'td-loads-max', msg: `${label}: at most 2 load lines.`, ref: t.id });
      for (const l of t.loads) {
        if (!l.grid) err.push({ code: 'td-load-grid', msg: `${label}: a load line has no grid.`, ref: t.id });
        else if (l.grid.axis !== ax || !on(l.grid)) err.push({ code: 'td-load-out', msg: `${label}: load line ${l.grid.name} must run like the supports and cross the TD.`, ref: t.id });
      }
    }
  }
  const dmarks = new Set();
  for (const d of plan.diaphragms) {
    const label = 'Diaphragm ' + (d.mark || '') + ' (' + (d.dir === 'y' ? '↕' : '↔') + ')';
    if (d.mark && dmarks.has(d.dir + d.mark)) err.push({ code: 'dg-dup', msg: `${label}: mark used twice in this direction.`, ref: d.id });
    dmarks.add(d.dir + d.mark);
    if (![d.x1, d.x2, d.y1, d.y2].every(fin) || d.x2 - d.x1 < EPS || d.y2 - d.y1 < EPS) { err.push({ code: 'dg-size', msg: `${label}: rectangle is missing or zero.`, ref: d.id }); continue; }
    if (outlineOk && diaphragmArea(plan, d) < EPS) err.push({ code: 'dg-empty', msg: `${label} covers no sheathing.`, ref: d.id });
    const sAxis = spanAxis(d.dir); // supports are lines of constant span coordinate
    if (d.supports.length !== 2 || d.supports.some(g => !g)) err.push({ code: 'dg-supports', msg: `${label}: pick its two support lines.`, ref: d.id });
    else if (d.supports.some(g => g.axis !== sAxis)) err.push({ code: 'dg-supports-axis', msg: `${label}: supports must be ${sAxis === 'x' ? '↕ (x =)' : '↔ (y =)'} lines for a load along ${d.dir}.`, ref: d.id });
    else {
      const [lo, hi] = sAxis === 'x' ? [d.x1, d.x2] : [d.y1, d.y2];
      if (d.supports.some(g => g.at < lo - EPS || g.at > hi + EPS)) err.push({ code: 'dg-supports-out', msg: `${label}: support lines must be within the diaphragm.`, ref: d.id });
      if (Math.abs(d.supports[0].at - d.supports[1].at) < EPS) err.push({ code: 'dg-supports-same', msg: `${label}: the two supports are the same line.`, ref: d.id });
    }
  }
  for (const dir of ['x', 'y']) {
    const ds = plan.diaphragms.filter(d => d.dir === dir && [d.x1, d.x2, d.y1, d.y2].every(fin));
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
      const a = ds[i], b = ds[j];
      const r = { x1: Math.max(a.x1, b.x1), x2: Math.min(a.x2, b.x2), y1: Math.max(a.y1, b.y1), y2: Math.min(a.y2, b.y2) };
      if (r.x2 - r.x1 > EPS && r.y2 - r.y1 > EPS && diaphragmArea(plan, r) > EPS) err.push({ code: 'dg-overlap', msg: `Diaphragms ${a.mark} and ${b.mark} (${dir === 'y' ? '↕' : '↔'}) overlap.`, ref: b.id });
    }
    const loaded = plan.loads.some(l => dirOf(l.acts) === dir);
    if (outlineOk && loaded) {
      const covered = ds.reduce((s, d) => s + diaphragmArea(plan, d), 0);
      const total = sheathedArea(plan);
      if (!ds.length) err.push({ code: 'dg-none', warn: true, msg: `No diaphragm is defined for the load along ${dir} (${dir === 'y' ? '↕' : '↔'}).` });
      else if (covered < total - 0.01) err.push({ code: 'dg-cover', warn: true, msg: `Diaphragms along ${dir} cover ${r2(covered)} of ${r2(total)} sf; the rest carries no load.` });
    }
  }
  for (const l of plan.loads) {
    if (l.mode === 'area' && !fin(l.psf)) err.push({ code: 'load-psf', msg: 'Area load: psf missing.', ref: l.id });
    if (l.mode === 'line') {
      if (!l.segments.length) err.push({ code: 'load-seg', msg: 'Line load: add at least one segment.', ref: l.id });
      if (l.segments.some(s => !fin(s.from) || !fin(s.to) || !fin(s.w) || s.to - s.from < EPS)) err.push({ code: 'load-seg-bad', msg: 'Line load: a segment has a missing value or zero length.', ref: l.id });
      if (l.edge && l.edge.axis === (l.acts.endsWith('y') ? 'x' : 'y')) err.push({ code: 'load-edge', msg: `Line load edge ${l.edge.name} must run along the span.`, ref: l.id });
    }
  }
  return err;
}

// Sheathed area ΣA (sf): outline minus openings (openings are inside the outline when the plan is valid)
export function sheathedArea(plan) {
  if (plan.outline.length < 3 || plan.outline.some(p => !fin(p[0]) || !fin(p[1]))) return 0;
  const open = plan.openings.filter(o => [o.x1, o.x2, o.y1, o.y2].every(fin)).reduce((s, o) => s + (o.x2 - o.x1) * (o.y2 - o.y1), 0);
  return Math.abs(polygonArea(plan.outline)) - open;
}

// Sheathed area inside a rectangle (a diaphragm is its rectangle clipped to the sheathed plan)
export function diaphragmArea(plan, r) {
  return panels(plan).reduce((s, p) => {
    const w = Math.min(p.x2, r.x2) - Math.max(p.x1, r.x1), h = Math.min(p.y2, r.y2) - Math.max(p.y1, r.y1);
    return w > 0 && h > 0 ? s + w * h : s;
  }, 0);
}

// Span axis for a load: a load acting along y spans along x (sections are x = const), and the reverse
export const spanAxis = acts => (String(acts).endsWith('y') ? 'x' : 'y');

// Sheathed intervals [lo, hi] across the plan on the section `axis = s` (axis 'x': the vertical line x = s).
// side '-' / '+' evaluates just before / after s (at a depth step the two sides differ).
export function sectionBands(plan, axis, s, side = '') {
  const t = s + (side === '-' ? -1e-4 : side === '+' ? 1e-4 : 0);
  const cuts = new Set();
  const o = plan.outline;
  for (let i = 0; i < o.length; i++) {
    const a = o[i], b = o[(i + 1) % o.length];
    const [p, q] = axis === 'x' ? [0, 1] : [1, 0];
    if (a[p] !== b[p]) { if (t >= Math.min(a[p], b[p]) - EPS && t <= Math.max(a[p], b[p]) + EPS) cuts.add(a[q]); }
    else cuts.add(a[q]);
  }
  for (const op of plan.openings) { cuts.add(axis === 'x' ? op.y1 : op.x1); cuts.add(axis === 'x' ? op.y2 : op.x2); }
  const c = [...cuts].filter(fin).sort((a, b) => a - b);
  const bands = [];
  for (let i = 0; i < c.length - 1; i++) {
    const m = (c[i] + c[i + 1]) / 2;
    if (c[i + 1] - c[i] < EPS) continue;
    const [x, y] = axis === 'x' ? [t, m] : [m, t];
    if (isSheathed(plan, x, y)) {
      const last = bands[bands.length - 1];
      if (last && Math.abs(last[1] - c[i]) < EPS) last[1] = c[i + 1]; else bands.push([c[i], c[i + 1]]);
    }
  }
  return bands;
}

// Sheathed depth d at a section (sum of the bands)
export function depthAt(plan, axis, s, side = '') {
  return sectionBands(plan, axis, s, side).reduce((d, [a, b]) => d + b - a, 0);
}

// Every coordinate where something starts or ends, per axis (grids, outline corners, openings, TDs, walls)
export function breakCoords(plan) {
  const xs = new Set(), ys = new Set();
  plan.grids.forEach(g => fin(g.at) && (g.axis === 'x' ? xs : ys).add(g.at));
  plan.outline.forEach(([x, y]) => { if (fin(x)) xs.add(x); if (fin(y)) ys.add(y); });
  plan.openings.forEach(o => { [o.x1, o.x2].forEach(v => fin(v) && xs.add(v)); [o.y1, o.y2].forEach(v => fin(v) && ys.add(v)); });
  [...plan.tds, ...(plan.diaphragms || [])].forEach(t => { [t.x1, t.x2].forEach(v => fin(v) && xs.add(v)); [t.y1, t.y2].forEach(v => fin(v) && ys.add(v)); });
  plan.walls.forEach(w => { if (!w.axis) return; const [along, at] = w.axis === 'x' ? [ys, xs] : [xs, ys]; at.add(w.at); [w.from, w.to].forEach(v => fin(v) && along.add(v)); });
  const sort = s => [...s].sort((a, b) => a - b);
  return { xs: sort(xs), ys: sort(ys) };
}

// Panels: the sheathed cells cut by every break coordinate. Each panel is a rectangle { x1, x2, y1, y2, area }.
export function panels(plan) {
  const { xs, ys } = breakCoords(plan);
  const out = [];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    const x1 = xs[i], x2 = xs[i + 1], y1 = ys[j], y2 = ys[j + 1];
    if (x2 - x1 < EPS || y2 - y1 < EPS) continue;
    if (isSheathed(plan, (x1 + x2) / 2, (y1 + y2) / 2)) out.push({ x1, x2, y1, y2, area: (x2 - x1) * (y2 - y1) });
  }
  return out;
}

// Plan extents (outline, grids) for drawing
export function planBounds(plan) {
  const xs = [], ys = [];
  plan.outline.forEach(([x, y]) => { if (fin(x)) xs.push(x); if (fin(y)) ys.push(y); });
  plan.grids.forEach(g => fin(g.at) && (g.axis === 'x' ? xs : ys).push(g.at));
  if (!xs.length) xs.push(0, 100);
  if (!ys.length) ys.push(0, 50);
  return { x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) };
}
