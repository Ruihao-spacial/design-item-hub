// Transfer Diaphragm — plan geometry (pure, no DOM).
// Plan coordinates: x to the right, y up, feet. The sheathed region is a rectilinear outline minus rectangular
// openings. Used by the plan editor (errors, ΣA), the basic-shear engine (depth d at a section) and the tests.
//
// Stored inputs keep what the user typed (strings, ids). parsePlan() turns them into numbers; references are by id.

const EPS = 1e-6;
const r2 = v => Math.round(v * 100) / 100;
const num = v => (v === '' || v === null || v === undefined ? NaN : Number(v));
const fin = v => Number.isFinite(v);

// TD overhangs (user 2026-11-04): picked as grid lines, "from" a support of the TD "to" the grid at the tip — one per
// support, so a TD may overhang both. Stored t.overhangs: [{ fromId, toId, at }] (at = the tip coordinate of an item
// saved with typed values whose tip has no grid; used only while toId is blank). An item saved before keeps its typed
// t.overhang [a, b] (read when t.overhangs is absent; the normaliser turns it into grids — tdMigrate).
// Returns [{ support: grid | null, tipGrid: grid | null, tip: number }].
export function parseOverhangs(t, gridById) {
  if (Array.isArray(t.overhangs)) return t.overhangs.filter(o => o && typeof o === 'object').map(o => {
    const tipGrid = gridById.get(o.toId) || null;
    return { support: gridById.get(o.fromId) || null, tipGrid, tip: tipGrid ? tipGrid.at : num(o.at) };
  });
  return legacyOverhang(t, gridById);
}
// a typed overhang [a, b] (saved before 2026-11-04): the end on a support is "from", the other end the tip
export function legacyOverhang(t, gridById) {
  if (!(Array.isArray(t.overhang) && t.overhang.length === 2 && t.overhang.every(v => v !== '' && v !== null && v !== undefined))) return [];
  const [a, b] = t.overhang.map(num).sort((p, q) => p - q);
  if (!fin(a) || !fin(b)) return [];
  const sup = (t.supports || []).map(id => gridById.get(id)).filter(Boolean);
  // as the typed form was read: the overhang lies below the low support (tip = its low end) or above the high one
  const s = sup.slice().sort((p, q) => p.at - q.at), mid = (a + b) / 2;
  const low = s.length === 2 && mid < s[0].at + EPS, high = s.length === 2 && mid > s[1].at - EPS;
  const support = low ? s[0] : high ? s[1] : null, tip = low ? a : b;
  const tipGrid = support ? [...gridById.values()].find(g => g.axis === support.axis && !g.ref && Math.abs(g.at - tip) < EPS)
    || [...gridById.values()].find(g => g.axis === support.axis && Math.abs(g.at - tip) < EPS) || null : null;
  return [{ support, tipGrid, tip }];
}

// A grid reaches coordinate c (along the grid) / covers the stretch a–b: inside its extent (blank ends = open).
// Grids from older items have no extent (lo / hi undefined) and reach everywhere.
export const gridReaches = (g, c, tol = EPS) => !!g && !(c < (g.lo ?? -Infinity) - tol) && !(c > (g.hi ?? Infinity) + tol);
export const gridCovers = (g, a, b, tol = EPS) => gridReaches(g, Math.min(a, b), tol) && gridReaches(g, Math.max(a, b), tol);
export const gridBounded = g => !!g && (Number.isFinite(g.lo) || Number.isFinite(g.hi));
const extentText = g => (g.axis === 'x' ? 'y ' : 'x ') + (Number.isFinite(g.lo) ? r2(g.lo) : '…') + '–' + (Number.isFinite(g.hi) ? r2(g.hi) : '…');

// inputs → { grids, gridById, outline, openings, walls, tds, loads } with numbers; unparseable items are kept with NaN
export function parsePlan(inputs) {
  // grid extent (user 2026-11-05): from / to along the grid (y1 / y2 for a ↕ grid, x1 / x2 for a ↔ grid); blank = open
  const grids = (inputs.grids || []).map(g => {
    const a = num(g.from), b = num(g.to);
    const lo = fin(a) && fin(b) ? Math.min(a, b) : fin(a) ? a : -Infinity, hi = fin(a) && fin(b) ? Math.max(a, b) : fin(b) ? b : Infinity;
    return { id: g.id, name: String(g.name || '').trim(), axis: g.axis === 'y' ? 'y' : 'x', at: num(g.at), ref: !!g.ref, lo, hi };
  });
  const gridById = new Map(grids.map(g => [g.id, g]));
  const outline = (inputs.outline || []).map(p => [num(p.x), num(p.y)]);
  const openings = (inputs.openings || []).map(o => ({ id: o.id, name: o.name || '', x1: Math.min(num(o.x1), num(o.x2)), x2: Math.max(num(o.x1), num(o.x2)), y1: Math.min(num(o.y1), num(o.y2)), y2: Math.max(num(o.y1), num(o.y2)) }));
  const walls = (inputs.walls || []).map(w => {
    const g = gridById.get(w.gridId);
    const a = num(w.from), b = num(w.to);
    return { id: w.id, line: String(w.line || (g && g.name) || '').trim(), mark: w.mark || '', gridId: w.gridId, axis: g ? g.axis : null, at: g ? g.at : NaN, from: Math.min(a, b), to: Math.max(a, b),
      linked: !!w.linked, type: w.type || '', swdLineId: w.swdLineId || null };
  });
  const tds = (inputs.tds || []).map(t => ({
    id: t.id, mark: t.mark || '', dir: t.dir === 'x' ? 'x' : 'y',
    x1: Math.min(num(t.x1), num(t.x2)), x2: Math.max(num(t.x1), num(t.x2)),
    y1: Math.min(num(t.y1), num(t.y2)), y2: Math.max(num(t.y1), num(t.y2)),
    supports: (t.supports || []).map(id => gridById.get(id) || null),
    loads: (t.loads || []).map(l => ({ grid: gridById.get(l.gridId) || null, side: l.side === '-' ? '-' : l.side === 'both' ? 'both' : '+' })),
    overhangs: parseOverhangs(t, gridById),
    auto: t.loadsMode !== 'manual', // load lines found from the plan (user 2026-11-03); 'manual' = as entered
  }));
  // A diaphragm is one or more rectangles (pieces, schema 2) analysed as one beam; x1..y2 = the pieces' bounding box
  const diaphragms = (inputs.diaphragms || []).map(d => {
    const parts = (Array.isArray(d.parts) ? d.parts : []).map((q, i) => ({ id: q.id || d.id + '-p' + i,
      x1: Math.min(num(q.x1), num(q.x2)), x2: Math.max(num(q.x1), num(q.x2)), y1: Math.min(num(q.y1), num(q.y2)), y2: Math.max(num(q.y1), num(q.y2)) }));
    const ok = parts.filter(q => [q.x1, q.x2, q.y1, q.y2].every(fin));
    const box = ok.length ? { x1: Math.min(...ok.map(q => q.x1)), x2: Math.max(...ok.map(q => q.x2)), y1: Math.min(...ok.map(q => q.y1)), y2: Math.max(...ok.map(q => q.y2)) }
      : { x1: NaN, x2: NaN, y1: NaN, y2: NaN };
    return { id: d.id, mark: d.mark || '', dir: d.dir === 'x' ? 'x' : 'y', parts, ...box,
      supports: (d.supports || []).map(id => gridById.get(id) || null),
      sheathing: d.sheathing || '', blocked: d.blocked, bandSplit: d.bandSplit || '', chordCut: d.chordCut === 'vierendeel' ? 'vierendeel' : d.chordCut === 'section' ? 'section' : '' };
  });
  // loads of a kind declared "none" on Setup (inputs.noLoad) stay stored but are not analysed
  const none = inputs.noLoad || {};
  const kindOf = l => (l.kind === 'E' || l.kind === 'W' ? l.kind : l.mode === 'seismic' ? 'E' : 'W');
  const loads = (inputs.loads || []).filter(l => !none[kindOf(l)]).map(l => ({
    id: l.id, acts: ['+x', '-x', '+y', '-y'].includes(l.acts) ? l.acts : '-y', mode: ['seismic', 'area', 'line', 'wind'].includes(l.mode) ? l.mode : 'line', kind: l.kind === 'E' || l.kind === 'W' ? l.kind : '',
    psf: num(l.psf), edge: l.edgeId ? gridById.get(l.edgeId) || null : null,
    segments: (l.segments || []).map(s => ({ from: num(s.from), to: num(s.to), w: num(s.w), w2: s.w2 === '' || s.w2 === undefined ? null : num(s.w2),
      wl: s.wl === '' || s.wl === undefined || s.wl === null ? 0 : num(s.wl) })),
  }));
  const plan = { grids, gridById, outline, openings, walls, tds, diaphragms, loads, noLoad: { E: !!none.E, W: !!none.W } };
  // TD load lines found from the plan (`found`); on Auto they are the TD's load lines, the entered ones kept as `entered`
  for (const t of tds) {
    t.found = detectTdLoads(plan, t); // also for a TD set by hand: its card shows what Auto would use
    if (!t.auto) continue;
    t.entered = t.loads;
    t.loads = t.found.map(l => ({ grid: l.grid, side: l.side }));
  }
  return plan;
}

// TD load lines from the plan (user 2026-11-03). A load line is a grid running like the supports, between them or on
// an overhang (past its support up to and including the tip — user 2026-11-04), where a member arrives at one of the TD's long edges from outside — where the sheathing
// changes across that grid just outside the edge (a notch / outline step, or an opening edge), or failing that a wall
// on the grid outside the TD, or the grid is a support line of another diaphragm reaching the edge. The side is the
// edge it arrives at; both edges → 'both'. All 20 book TDs (Ex 3.3–8.4) are found this way. Returns
// [{ grid, side: '-' | '+' | 'both', why }] (top first is not implied; tdFrame orders them).
export function detectTdLoads(plan, t) {
  const sup = (t.supports || []).filter(Boolean);
  if (sup.length !== 2 || sup[0].axis !== sup[1].axis || ![t.x1, t.x2, t.y1, t.y2].every(fin) || !plan.outline.length) return [];
  const sAx = sup[0].axis, D = 0.05;
  const [e1, e2] = sAx === 'y' ? [t.x1, t.x2] : [t.y1, t.y2];
  const s1 = Math.min(sup[0].at, sup[1].at), s2 = Math.max(sup[0].at, sup[1].at);
  const pt = (a, c) => (sAx === 'y' ? [c, a] : [a, c]); // a = along the TD span, c = across it
  const across = sAx === 'y' ? 'x' : 'y';
  const out = [];
  for (const g of plan.grids.filter(q => q.axis === sAx && !q.ref && fin(q.at))) {
    const inSpan = g.at > s1 + EPS && g.at < s2 - EPS;
    const onOverhang = !sup.includes(g) && (t.overhangs || []).some(o => o.support && fin(o.tip) &&
      Math.abs(g.at - o.support.at) > EPS && (g.at - o.support.at) * (o.tip - o.support.at) > 0 && Math.abs(g.at - o.support.at) <= Math.abs(o.tip - o.support.at) + EPS);
    if (!inSpan && !onOverhang) continue;
    const sides = [];
    for (const [c, side] of [[e1 - D, '-'], [e2 + D, '+']]) {
      if (!gridReaches(g, side === '-' ? e1 : e2)) continue; // a bounded grid that stops before this edge
      const a = isSheathed(plan, ...pt(g.at - D, c)), b = isSheathed(plan, ...pt(g.at + D, c));
      let why = null;
      if (a !== b) {
        const [x, y] = pt(g.at + (a ? D : -D), c); // the unsheathed side: inside the outline = an opening
        why = (plan.outline.length >= 3 && pointInPolygon(x, y, plan.outline) ? 'opening edge' : 'outline / notch edge') + ' at ' + across + ' = ' + r2(side === '-' ? e1 : e2);
      } else if (g.axis !== t.dir && plan.walls.some(w => w.gridId === g.id && (side === '-'
        ? w.from < e1 - EPS && runsOnSheathing(plan, g, Math.min(w.to, e1), e1)
        : w.to > e2 + EPS && runsOnSheathing(plan, g, e2, Math.max(w.from, e2))))) why = 'wall on ' + g.name + ' outside the TD';
      else if (a && plan.diaphragms.some(d => d.dir === t.dir && d.supports.some(q => q && q.id === g.id) &&
        d.parts.some(q => { const [x, y] = pt(g.at, c); return x >= q.x1 - EPS && x <= q.x2 + EPS && y >= q.y1 - EPS && y <= q.y2 + EPS; })))
        why = 'support line of a diaphragm next to the TD';
      if (why) sides.push({ side, why });
    }
    if (sides.length) out.push({ grid: g, side: sides.length === 2 ? 'both' : sides[0].side, why: sides.map(s => s.why).join('; ') });
  }
  return out;
}

// A member runs along grid g from a to b (coordinates along the grid): sheathing on at least one side of the grid on
// every stretch between break coordinates (no notch / void gap across the whole width). A wall only makes its grid a
// TD load line when its member reaches the TD edge this way (user test 2026-11-03: SW-9 across a notch is not one).
export function runsOnSheathing(plan, g, a, b) {
  if (!(b > a + EPS)) return true;
  const D = 0.05, along = breakCoords(plan)[g.axis === 'x' ? 'ys' : 'xs'];
  const pts = [a, ...along.filter(p => p > a + EPS && p < b - EPS), b];
  for (let i = 0; i < pts.length - 1; i++) {
    const m = (pts[i] + pts[i + 1]) / 2;
    const at = c => (g.axis === 'x' ? [c, m] : [m, c]);
    if (!isSheathed(plan, ...at(g.at - D)) && !isSheathed(plan, ...at(g.at + D))) return false;
  }
  return true;
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
    if (fin(g.lo) && fin(g.hi) && g.hi - g.lo < EPS) err.push({ code: 'grid-extent', msg: `Grid ${g.name || '?'}: its start and end (${extentText(g)}) are the same — leave both blank for a grid across the whole plan.`, ref: g.id });
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
    else if (!gridCovers(plan.gridById.get(w.gridId), w.from, w.to)) { const g = plan.gridById.get(w.gridId);
      err.push({ code: 'grid-extent', msg: `${label} (${r2(w.from)}–${r2(w.to)}) runs past the end of grid ${g.name} (${extentText(g)}) — extend the grid or move the wall.`, ref: w.id }); }
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
    if (plan.openings.some(op => rectsOverlap(op, t))) err.push({ code: 'td-opening', msg: `${label} contains an opening (not allowed in a TD).`, ref: t.id });
    else if (outlineOk && !onSheathing(plan, t)) err.push({ code: 'td-outside', msg: `${label} is not inside the outline.`, ref: t.id });
    if (t.supports.length !== 2 || t.supports.some(g => !g)) err.push({ code: 'td-supports', msg: `${label}: pick its two support lines.`, ref: t.id });
    else if (t.supports[0].axis !== t.supports[1].axis) err.push({ code: 'td-supports-axis', msg: `${label}: both support lines must run the same way.`, ref: t.id });
    else {
      const ax = t.supports[0].axis; // supports along x-grids → TD spans along x
      const [lo, hi] = ax === 'x' ? [t.x1, t.x2] : [t.y1, t.y2];
      const on = g => g.at >= lo - EPS && g.at <= hi + EPS;
      if (!t.supports.every(on)) err.push({ code: 'td-supports-out', msg: `${label}: support lines must cross the TD.`, ref: t.id });
      else {
        // bounded grids (user 2026-11-05): every grid the TD uses reaches across its whole length
        const [c1, c2] = ax === 'x' ? [t.y1, t.y2] : [t.x1, t.x2];
        const used = [...t.supports, ...t.loads.map(l => l.grid), ...t.overhangs.map(o => o.tipGrid)].filter(Boolean);
        for (const g of new Set(used)) if (!gridCovers(g, c1, c2))
          err.push({ code: 'grid-extent', msg: `${label}: grid ${g.name} (${extentText(g)}) does not reach across the TD (${ax === 'x' ? 'y' : 'x'} ${r2(c1)}–${r2(c2)}) — extend the grid.`, ref: t.id });
        // overhangs (user 2026-11-04): picked by grid, from a support to the tip, one per support; the TD reaches the tip
        const s1 = Math.min(...t.supports.map(g => g.at)), s2 = Math.max(...t.supports.map(g => g.at));
        const ends = { lo: null, hi: null };
        for (const o of t.overhangs) {
          if (!o.support || !t.supports.includes(o.support)) { err.push({ code: 'td-overhang', msg: `${label}: an overhang starts at one of the TD's supports — pick it in "from".`, ref: t.id }); continue; }
          if (!fin(o.tip)) { err.push({ code: 'td-overhang', msg: `${label}: pick the grid line at the tip of the overhang from ${o.support.name}.`, ref: t.id }); continue; }
          const end = Math.abs(o.support.at - s1) < EPS && o.tip < s1 - EPS ? 'lo' : Math.abs(o.support.at - s2) < EPS && o.tip > s2 + EPS ? 'hi' : null;
          if (!end) { err.push({ code: 'td-overhang', msg: `${label}: the overhang from ${o.support.name} must run away from the other support.`, ref: t.id }); continue; }
          if (ends[end] !== null) { err.push({ code: 'td-overhang', msg: `${label}: one overhang per support (${o.support.name} has two).`, ref: t.id }); continue; }
          ends[end] = o.tip;
          if (Math.abs((end === 'lo' ? lo : hi) - o.tip) > 0.01) err.push({ code: 'td-overhang-tip', ref: t.id,
            msg: `${label}: the overhang from ${o.support.name} ends at ${o.tipGrid ? o.tipGrid.name : ax + ' = ' + r2(o.tip)} (${ax} = ${r2(o.tip)}) but the TD ends at ${ax} = ${r2(end === 'lo' ? lo : hi)} — draw the TD to the tip.` });
          if (!o.tipGrid) err.push({ code: 'td-overhang-grid', warn: true, ref: t.id, msg: `${label}: the overhang tip ${ax} = ${r2(o.tip)} (typed before 2026-11-04) has no grid line — add one there and pick it as the tip.` });
        }
        // user test 2026-11-03: TD1 / TD2 drawn y 0–32 with supports at 5 / 29 stopped on closure with no reason given;
        // 2026-11-04: also the end of an overhanging TD that has no overhang of its own
        const past = [...(ends.lo === null && lo < s1 - EPS ? [[lo, s1, t.supports.find(g => g.at === s1)]] : []), ...(ends.hi === null && hi > s2 + EPS ? [[s2, hi, t.supports.find(g => g.at === s2)]] : [])];
        if (past.length) err.push({ code: 'td-past-support', ref: t.id,
          msg: `${label} runs past its support${past.length > 1 ? 's' : ''} ${past.map(([a, b, g]) => g.name + ' (' + ax + ' ' + r2(a) + '–' + r2(b) + ')').join(' and ')}: a TD spans between its two supports. Draw it between them, move the support to the TD's end, or add an overhang from that support.` });
      }
      if (!t.loads.length) err.push(t.auto
        ? { code: 'td-loads', warn: true, msg: `${label}: no load line found — no notch, opening or outline edge meets its long edges between its supports or on its overhangs. It carries nothing; check where it is drawn, or set its load lines by hand.`, ref: t.id }
        : { code: 'td-loads', msg: `${label}: add the line where the cut chord / strut enters.`, ref: t.id });
      // any number of load lines, between the supports, on a support or on an overhang (superposed engine runs,
      // user 2026-11-03 / 2026-11-04); where each may lie is checked in tdFrame
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
    if (!d.parts.length) { err.push({ code: 'dg-parts', msg: `${label}: no pieces — draw it, or pick its supports and use Fill between supports.`, ref: d.id }); continue; }
    const bad = d.parts.findIndex(q => ![q.x1, q.x2, q.y1, q.y2].every(fin) || q.x2 - q.x1 < EPS || q.y2 - q.y1 < EPS);
    if (bad >= 0) { err.push({ code: 'dg-size', msg: `${label}: piece ${partName(d, bad)} is missing a size or has none.`, ref: d.id }); continue; }
    // hard checks (user 2026-11-02): every piece lies on sheathing — inside the outline, not over an opening
    d.parts.forEach((q, i) => {
      const pl = `${label}, piece ${partName(d, i)}`;
      const op = plan.openings.find(o => rectsOverlap(o, q));
      if (op) err.push({ code: 'dg-part-opening', msg: `${pl} lies over opening ${op.name || ''} — an opening is not part of a diaphragm.`, ref: d.id });
      else if (outlineOk && !onSheathing(plan, q)) err.push({ code: 'dg-part-outside', msg: `${pl} runs outside the outline.`, ref: d.id });
    });
    for (let i = 0; i < d.parts.length; i++) for (let j = i + 1; j < d.parts.length; j++)
      if (rectsOverlap(d.parts[i], d.parts[j])) err.push({ code: 'dg-part-overlap', msg: `${label}: pieces ${partName(d, i)} and ${partName(d, j)} overlap.`, ref: d.id });
    if (!partsConnected(d.parts)) err.push({ code: 'dg-split', msg: `${label}: its pieces do not form one region (each piece must share an edge with another).`, ref: d.id });
    const sAxis = spanAxis(d.dir); // supports are lines of constant span coordinate
    if (d.supports.length !== 2 || d.supports.some(g => !g)) err.push({ code: 'dg-supports', msg: `${label}: pick its two support lines.`, ref: d.id });
    else if (d.supports.some(g => g.axis !== sAxis)) err.push({ code: 'dg-supports-axis', msg: `${label}: supports must be ${sAxis === 'x' ? '↕ (x =)' : '↔ (y =)'} lines for a load along ${d.dir}.`, ref: d.id });
    else {
      const crosses = g => d.parts.some(q => (sAxis === 'x' ? g.at >= q.x1 - EPS && g.at <= q.x2 + EPS : g.at >= q.y1 - EPS && g.at <= q.y2 + EPS));
      if (!d.supports.every(crosses)) err.push({ code: 'dg-supports-out', msg: `${label}: support lines must cross the diaphragm.`, ref: d.id });
      else for (const g of d.supports) {
        // bounded grids (user 2026-11-05): a support line reaches across the pieces it touches
        const touch = d.parts.filter(q => (sAxis === 'x' ? g.at >= q.x1 - EPS && g.at <= q.x2 + EPS : g.at >= q.y1 - EPS && g.at <= q.y2 + EPS));
        const c1 = Math.min(...touch.map(q => (sAxis === 'x' ? q.y1 : q.x1))), c2 = Math.max(...touch.map(q => (sAxis === 'x' ? q.y2 : q.x2)));
        if (!gridCovers(g, c1, c2)) err.push({ code: 'grid-extent', msg: `${label}: support grid ${g.name} (${extentText(g)}) does not reach across the diaphragm (${sAxis === 'x' ? 'y' : 'x'} ${r2(c1)}–${r2(c2)}) — extend the grid.`, ref: d.id });
      }
      if (Math.abs(d.supports[0].at - d.supports[1].at) < EPS) err.push({ code: 'dg-supports-same', msg: `${label}: the two supports are the same line.`, ref: d.id });
    }
  }
  for (const dir of ['x', 'y']) {
    const ds = plan.diaphragms.filter(d => d.dir === dir && [d.x1, d.x2, d.y1, d.y2].every(fin));
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
      const a = ds[i], b = ds[j];
      if (a.parts.some(p => b.parts.some(q => rectsOverlap(p, q)))) err.push({ code: 'dg-overlap', msg: `Diaphragms ${a.mark} and ${b.mark} (${dir === 'y' ? '↕' : '↔'}) overlap.`, ref: b.id });
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
    if (l.mode === 'area' && l.kind !== 'E') err.push({ code: 'load-wind-area', warn: true, msg: 'Wind (W) entered as an area load spreads it over the plan; wind reaches the diaphragm along the windward / leeward faces — use the Wind load (plf = pressure × tributary height).', ref: l.id });
    if (l.mode === 'line') {
      if (!l.segments.length) err.push({ code: 'load-seg', msg: 'Line load: add at least one segment.', ref: l.id });
      if (l.segments.some(s => !fin(s.from) || !fin(s.to) || !fin(s.w) || s.to - s.from < EPS)) err.push({ code: 'load-seg-bad', msg: 'Line load: a segment has a missing value or zero length.', ref: l.id });
      if (l.edge && l.edge.axis === (l.acts.endsWith('y') ? 'x' : 'y')) err.push({ code: 'load-edge', msg: `Line load edge ${l.edge.name} must run along the span.`, ref: l.id });
    }
    if (l.mode === 'wind') {
      if (!l.segments.length) err.push({ code: 'load-seg', msg: 'Wind load: add at least one segment.', ref: l.id });
      if (l.segments.some(s => !fin(s.from) || !fin(s.to) || !fin(s.w) || !fin(s.wl) || s.to - s.from < EPS)) err.push({ code: 'load-seg-bad', msg: 'Wind load: a segment has a missing value or zero length (windward plf needed; leeward blank = 0).', ref: l.id });
    }
  }
  // loads of one case (direction × kind) — user test 2026-11-03: −y and +y seismic loads cancelled to 0 without a word
  const kindOf = l => (l.kind === 'E' || l.kind === 'W' ? l.kind : l.mode === 'seismic' ? 'E' : 'W');
  const KIND = { E: 'seismic', W: 'wind' };
  for (const dir of ['x', 'y']) for (const k of ['E', 'W']) {
    const ls = plan.loads.filter(l => dirOf(l.acts) === dir && kindOf(l) === k);
    if (!ls.length) continue;
    const senses = new Set(ls.map(l => (String(l.acts).startsWith('-') ? '-' : '+')));
    if (senses.size > 1) err.push({ code: 'load-opposite', msg: `The ${KIND[k]} loads along ${dir} act in opposite directions (${ls.map(l => l.acts).join(', ')}) — they would cancel. Enter one direction per load case (the analysis is linear; the other sense is the same with the signs changed); delete the extra load on Setup.`, ref: ls[ls.length - 1].id });
    const fx = ls.filter(l => l.mode === 'seismic');
    if (fx.length > 1) err.push({ code: 'load-seismic-twice', msg: `${fx.length} seismic F_x / ΣA loads along ${dir} — F_x would be counted ${fx.length} times. Keep one (Setup → Seismic loading).`, ref: fx[fx.length - 1].id });
  }
  // grids that miss the plan (user test 2026-11-03: grid 1 at y = 37, outline to y = 32)
  if (outlineOk) {
    const xs = plan.outline.map(p => p[0]), ys = plan.outline.map(p => p[1]);
    const off = plan.grids.filter(g => {
      if (g.ref || !fin(g.at)) return false;
      const [a, b] = g.axis === 'x' ? [Math.min(...xs), Math.max(...xs)] : [Math.min(...ys), Math.max(...ys)];
      const [c, e] = g.axis === 'x' ? [Math.min(...ys), Math.max(...ys)] : [Math.min(...xs), Math.max(...xs)];
      return g.at < a - EPS || g.at > b + EPS || (g.hi ?? Infinity) < c - EPS || (g.lo ?? -Infinity) > e + EPS;
    });
    if (off.length) err.push({ code: 'grid-off-plan', warn: true, ref: off[0].id,
      msg: `Grid${off.length > 1 ? 's' : ''} ${off.map(g => g.name + ' (' + g.axis + ' = ' + r2(g.at) + ')').join(', ')} ${off.length > 1 ? 'do' : 'does'} not cross this plan — fine for grids of another level; check the position otherwise.` });
  }
  return err;
}

// Sheathed area ΣA (sf): outline minus openings (openings are inside the outline when the plan is valid)
export function sheathedArea(plan) {
  if (plan.outline.length < 3 || plan.outline.some(p => !fin(p[0]) || !fin(p[1]))) return 0;
  const open = plan.openings.filter(o => [o.x1, o.x2, o.y1, o.y2].every(fin)).reduce((s, o) => s + (o.x2 - o.x1) * (o.y2 - o.y1), 0);
  return Math.abs(polygonArea(plan.outline)) - open;
}

// Sheathed area inside a rectangle; of a diaphragm = the sum over its pieces
export function diaphragmArea(plan, r) {
  if (r && Array.isArray(r.parts)) return r.parts.filter(q => [q.x1, q.x2, q.y1, q.y2].every(fin)).reduce((s, q) => s + diaphragmArea(plan, q), 0);
  return panels(plan).reduce((s, p) => {
    const w = Math.min(p.x2, r.x2) - Math.max(p.x1, r.x1), h = Math.min(p.y2, r.y2) - Math.max(p.y1, r.y1);
    return w > 0 && h > 0 ? s + w * h : s;
  }, 0);
}

// Two rectangles share area (touching edges do not count)
export const rectsOverlap = (a, b) => a.x1 < b.x2 - EPS && a.x2 > b.x1 + EPS && a.y1 < b.y2 - EPS && a.y2 > b.y1 + EPS;

// The whole rectangle is sheathing: inside the outline and clear of every opening (exact, by panels)
export function onSheathing(plan, r) {
  if (![r.x1, r.x2, r.y1, r.y2].every(fin)) return false;
  return Math.abs(diaphragmArea(plan, { x1: r.x1, x2: r.x2, y1: r.y1, y2: r.y2 }) - (r.x2 - r.x1) * (r.y2 - r.y1)) < 1e-4;
}

// Name of a piece: D1.1, D1.2 …
export const partName = (d, i) => (d.mark || 'D') + '.' + (i + 1);

// Pieces form one region: every piece is reached through shared edges of positive length
export function partsConnected(parts) {
  if (parts.length < 2) return true;
  const touch = (a, b) => {
    const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1), oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
    return (Math.abs(ox) < EPS && oy > EPS) || (Math.abs(oy) < EPS && ox > EPS);
  };
  const seen = new Set([0]), stack = [0];
  while (stack.length) { const i = stack.pop(); parts.forEach((q, j) => { if (!seen.has(j) && touch(parts[i], q)) { seen.add(j); stack.push(j); } }); }
  return seen.size === parts.length;
}

// The sheathed part of a rectangle as pieces. The region is cut at the outline corners, the openings and the
// `avoid` rectangles (other diaphragms of the direction); cells are joined across the span into strips (one per
// section interval) and equal neighbouring strips are joined along it, so the pieces follow the depth changes
// (Ex 3.5: 1–2 C–A, 2–5 D–A, 5–6 D–B; Ex 5.1: below and above the opening). spanAx 'x' = a load along y.
export function splitRegion(plan, r, spanAx = 'x', avoid = []) {
  if (![r.x1, r.x2, r.y1, r.y2].every(fin) || r.x2 - r.x1 < EPS || r.y2 - r.y1 < EPS) return [];
  const xs = new Set([r.x1, r.x2]), ys = new Set([r.y1, r.y2]);
  plan.outline.forEach(([x, y]) => { if (fin(x)) xs.add(x); if (fin(y)) ys.add(y); });
  for (const o of [...plan.openings, ...avoid]) { [o.x1, o.x2].forEach(v => fin(v) && xs.add(v)); [o.y1, o.y2].forEach(v => fin(v) && ys.add(v)); }
  const cut = (set, lo, hi) => [...set].filter(v => v >= lo - EPS && v <= hi + EPS).sort((a, b) => a - b).filter((v, i, a) => !i || v - a[i - 1] > EPS);
  const X = cut(xs, r.x1, r.x2), Y = cut(ys, r.y1, r.y2);
  const [S, C] = spanAx === 'x' ? [X, Y] : [Y, X];
  const filled = (s1, s2, c1, c2) => {
    const [x, y] = spanAx === 'x' ? [(s1 + s2) / 2, (c1 + c2) / 2] : [(c1 + c2) / 2, (s1 + s2) / 2];
    return isSheathed(plan, x, y) && !avoid.some(a => inRect(x, y, a));
  };
  const strips = [];
  for (let i = 0; i < S.length - 1; i++) {
    const runs = [];
    for (let j = 0; j < C.length - 1; j++) {
      if (!filled(S[i], S[i + 1], C[j], C[j + 1])) continue;
      const last = runs[runs.length - 1];
      if (last && Math.abs(last[1] - C[j]) < EPS) last[1] = C[j + 1]; else runs.push([C[j], C[j + 1]]);
    }
    const prev = strips[strips.length - 1];
    const same = prev && Math.abs(prev.b - S[i]) < EPS && prev.runs.length === runs.length
      && prev.runs.every((q, k) => Math.abs(q[0] - runs[k][0]) < EPS && Math.abs(q[1] - runs[k][1]) < EPS);
    if (same) prev.b = S[i + 1]; else strips.push({ a: S[i], b: S[i + 1], runs });
  }
  const out = [];
  for (const st of strips) for (const [c1, c2] of st.runs)
    out.push(spanAx === 'x' ? { x1: st.a, x2: st.b, y1: c1, y2: c2 } : { x1: c1, x2: c2, y1: st.a, y2: st.b });
  return out;
}

// Sheathed bands of diaphragm d on the section `axis = s` (side as sectionBands): the plan's bands clipped to the
// pieces that hold the section
export function diaphragmBands(plan, d, axis, s, side = '') {
  const t = s + (side === '-' ? -1e-4 : side === '+' ? 1e-4 : 0);
  const rng = (d.parts || []).filter(q => [q.x1, q.x2, q.y1, q.y2].every(fin))
    .filter(q => (axis === 'x' ? t >= q.x1 - EPS && t <= q.x2 + EPS : t >= q.y1 - EPS && t <= q.y2 + EPS))
    .map(q => (axis === 'x' ? [q.y1, q.y2] : [q.x1, q.x2])).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [a, b] of rng) { const l = merged[merged.length - 1]; if (l && a <= l[1] + EPS) l[1] = Math.max(l[1], b); else merged.push([a, b]); }
  const out = [];
  for (const [lo, hi] of sectionBands(plan, axis, s, side)) for (const [a, b] of merged) {
    const p = Math.max(lo, a), q = Math.min(hi, b);
    if (q - p > EPS) { const l = out[out.length - 1]; if (l && Math.abs(l[1] - p) < EPS) l[1] = q; else out.push([p, q]); }
  }
  return out;
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
  [...plan.tds, ...(plan.diaphragms || []).flatMap(d => d.parts || [d])].forEach(t => { [t.x1, t.x2].forEach(v => fin(v) && xs.add(v)); [t.y1, t.y2].forEach(v => fin(v) && ys.add(v)); });
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

// A drawn TD in the skill's local frame (wood-diaph-transfer, SKILL.md §2): y along the TD span from the bottom
// support (y = 0) to the top support (y = W), x along the TD length L (edge x1 = lower plan coordinate).
// Plan → local keeps the plan axes (a swap of x and y keeps the shear sign). Overhangs (user 2026-11-04: one per
// support, picked by grid): local y runs from the bottom support, so an overhang below it has y < 0 and one above the
// top support y > W. A TD with only an overhang on the high side mirrors y (ySign = −1) so that it lies below (the
// skill's cantilever frame, y1 < 0); plan unit shears then change sign into and out of the engine; P, support forces
// and member forces do not. Load lines lie anywhere from tip to tip (between the supports, on a support, on an
// overhang); tips = { bottom, top } local y of the tips (null = no overhang at that end).
// Returns { ok, issues[], geometry: { td_support, td_span, td_length, td_y1, td_side1, td_has_load2, td_y2, td_side2 },
//   spanAxis, ySign, bottom, top (grids), edgeX1, edgeX2 (plan coordinates), tips, loads: [{ grid, y, side }] (top first) }.
export function tdFrame(t) {
  const issues = [];
  const out = { ok: false, issues, geometry: null };
  if (t.supports.length !== 2 || t.supports.some(g => !g || !fin(g.at)) || t.supports[0].axis !== t.supports[1].axis) {
    issues.push('pick two support lines that run the same way');
    return out;
  }
  const ax = t.supports[0].axis; // grids of axis 'x' sit at x = const → the TD spans along plan x
  const [sLo, sHi] = t.supports.map(g => g.at).sort((a, b) => a - b);
  const [lo, hi] = ax === 'x' ? [t.x1, t.x2] : [t.y1, t.y2];
  const [e1, e2] = ax === 'x' ? [t.y1, t.y2] : [t.x1, t.x2];
  const W = sHi - sLo, L = e2 - e1;
  // overhang tips in plan coordinates, by end
  const tip = { lo: null, hi: null };
  for (const o of t.overhangs || []) {
    const end = !o.support || !t.supports.includes(o.support) || !fin(o.tip) ? null
      : Math.abs(o.support.at - sLo) < EPS && o.tip < sLo - EPS ? 'lo' : Math.abs(o.support.at - sHi) < EPS && o.tip > sHi + EPS ? 'hi' : null;
    if (!end || tip[end] !== null) { issues.push('an overhang runs from one of the supports, away from the other, to the grid at its tip (one per support)'); continue; }
    tip[end] = o.tip;
  }
  const ySign = tip.hi !== null && tip.lo === null ? -1 : 1;
  const loc = s => (ySign > 0 ? s - sLo : sHi - s);
  const [bottom, top] = ySign > 0 ? [sLo, sHi] : [sHi, sLo];
  const gridAtPos = at => t.supports.find(g => Math.abs(g.at - at) < EPS);
  const tips = ySign > 0 ? { bottom: tip.lo === null ? null : r2(loc(tip.lo)), top: tip.hi === null ? null : r2(loc(tip.hi)) }
    : { bottom: r2(loc(tip.hi)), top: null };
  // side −1 / +1: the cut member enters from the low / high edge; 0: members enter from both edges (G1, Ex 8.1 TD1 line B)
  const loads = t.loads.filter(l => l.grid && fin(l.grid.at)).map(l => ({ grid: l.grid, y: r2(loc(l.grid.at)), side: l.side === '-' ? -1 : l.side === 'both' ? 0 : 1 }))
    .sort((a, b) => b.y - a.y);
  Object.assign(out, { spanAxis: ax, ySign, bottom: gridAtPos(bottom), top: gridAtPos(top), edgeX1: e1, edgeX2: e2, tips, loads });
  if (!(W > EPS)) issues.push('the two supports are the same line');
  if (!(L > EPS)) issues.push('the TD has no length');
  if (!loads.length) issues.push('add the load line where the cut chord / strut enters');
  const yMin = tips.bottom ?? 0, yMax = tips.top ?? W;
  if (fin(lo) && fin(hi)) {
    const [a, b] = [loc(lo), loc(hi)].sort((p, q) => p - q);
    if ((tips.bottom !== null && Math.abs(a - tips.bottom) > 0.01) || (tips.top !== null && Math.abs(b - tips.top) > 0.01)) issues.push('the TD rectangle must reach the tip of the overhang');
  }
  if (loads.some(l => !(l.y > yMin - 0.01 && l.y < yMax + 0.01)))
    issues.push(tips.bottom === null && tips.top === null ? 'load lines must lie between the supports (or on one)' : 'load lines must lie between the tips of the TD (supports and overhangs)');
  const support = tips.bottom !== null || tips.top !== null ? 'cantilever' : 'simple';
  const [l1, l2] = loads;
  out.geometry = {
    td_support: support, td_span: r2(W), td_length: r2(L),
    td_y1: l1 ? l1.y : null, td_side1: l1 ? l1.side || 1 : null, // both sides: the engine's own collector output uses +1
    td_has_load2: !!l2, td_y2: l2 ? l2.y : 0, td_side2: l2 ? l2.side || 1 : 1, // placeholders when absent, as the skill's tests
  };
  out.ok = !issues.length;
  return out;
}
