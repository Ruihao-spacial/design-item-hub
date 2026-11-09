// Transfer Diaphragm — stored definition: version stamp, migration steps, normalisation (docs/data-durability.md).
//
// items.inputs is the source of truth (what the user typed; results are always regenerated). Rules:
//   - inputs.schemaVersion is stamped inside the data (P3); the DB column schema_version is a copy.
//   - A shape change is a step in TD_MIGRATIONS (P4): pure, idempotent, keeps every field it does not know.
//   - normalizeInputs only ADDS missing fields with neutral defaults (P5); safe on every open.
//   - Every past schema keeps a frozen fixture in tests/fixtures/legacy-td/ (P6).
// No DOM, no imports from the module UI.
import { parsePlan, splitRegion, legacyOverhang } from './tdGeometry.js';
//
// Shape (schema 1):
// { schemaVersion, codeEdition, designBasis, pdfReport, refs: { elfSource }, notes,
//   level: { name, fx },                                        // F_x in kip (linked from ELF or typed)
//   diaphragm: { sheathing: 'wsp', blocked: true },              // defaults for every diaphragm / TD
//   diaphragms: [{ id, mark, dir: 'x'|'y', x1, x2, y1, y2, supports: [gridId, gridId], sheathing, blocked }],
//                                                               // x1..y2: schema 1 only (see schema 2 below)
//                                                               // dir = axis the load acts along; '' / null = default
//   grids: [{ id, name, axis: 'x'|'y', at, ref, from, to }],  // from / to: extent along the grid, '' = open (2026-11-05)             // axis 'x' = a line of constant x
//   outline: [{ x, y }],                                        // rectilinear, corners in order
//   openings: [{ id, name, x1, x2, y1, y2 }],
//   walls: [{ id, line, mark, gridId, from, to }],              // typed wall lines (Shear Wall Lines link: Phase 2)
//   tds: [{ id, mark, dir, x1, x2, y1, y2, supports: [gridId, gridId], loads: [{ gridId, side }], overhang: [a, b] | null,
//           engineer: { regionClear, cantileverOk, closureTol } },
//   tds[].overhangs (2026-11-04, user): [{ fromId, toId, at }] — overhangs picked by grid, from a support to the grid at
//     the tip, one per support. Added from the typed overhang [a, b] (kept as the record, no longer read): toId = the
//     grid at the tip when there is one, else at = the typed tip (a plan warning asks for a grid there).
//   wallLink: { dirMap: { [swdDirId]: 'x'|'y' }, origins: { [swdLineId]: ft | '' } },   // refs.wallSource = SWD item
//   loads: [{ id, acts: '+x'|'-x'|'+y'|'-y', mode: 'seismic'|'area'|'line'|'wind', kind: ''|'E'|'W' ('' = E for seismic, else W),
//             psf, edgeId, segments: [{ from, to, w, w2, wl }] }] }
//   diaphragms[].bandSplit: ''|'mid'|'low'|'high' (Phase 4; '' = mid)
//   diaphragms[].chordCut: ''|'section'|'vierendeel' (2026-11-02): a chord cut inside an opening stretch — '' /
//     'section' = M/H at the cut (default, book Ex 8.1 p8, opening study), 'vierendeel' = from the inflection
//   loads[].mode 'wind' + segments[].wl (2026-10-30): w = windward plf, wl = leeward plf (blank = 0)
//   level.diaphragmFactor / level.collectorFactor (2026-10-30): display factors F_x → diaphragm / collector level
//     ('' = 1); results stay at 1.0E
// Schema 2 (2026-11-02, user): a diaphragm is one or more rectangles analysed as one beam between its supports:
//   diaphragms[].parts: [{ id, x1, x2, y1, y2 }] (named D1.1, D1.2 … in order). Every piece must lie on sheathing
//   (inside the outline, not over an opening) — a hard check. The step to 2 cuts a schema-1 rectangle into pieces
//   (its sheathed part, split at the depth changes); the rectangle stays in x1..y2 as the record of where the pieces
//   came from (not used by the calculation).
// Numbers are stored as typed (strings); '' = blank.

export const TD_SCHEMA = 2;

// Ordered steps; `to` = the schema the step produces. Add new steps at the end, never edit a released one.
export const TD_MIGRATIONS = [
  { to: 2, up: inp => {
    if (!Array.isArray(inp.diaphragms)) return inp;
    const plan = parsePlan(inp);
    const o = plan.outline, valid = o.length >= 4 && o.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    const r2 = v => String(Math.round(v * 100) / 100);
    inp.diaphragms.forEach((d, k) => {
      if (!isObj(d) || Array.isArray(d.parts)) return;
      const n = v => (v === '' || v === null || v === undefined ? NaN : Number(v));
      const rect = { x1: Math.min(n(d.x1), n(d.x2)), x2: Math.max(n(d.x1), n(d.x2)), y1: Math.min(n(d.y1), n(d.y2)), y2: Math.max(n(d.y1), n(d.y2)) };
      const ok = [rect.x1, rect.x2, rect.y1, rect.y2].every(Number.isFinite);
      const dir = d.dir || (Array.isArray(inp.loads) && inp.loads[0] && String(inp.loads[0].acts || '').endsWith('x') ? 'x' : 'y');
      let pieces = ok && valid ? splitRegion(plan, rect, dir === 'x' ? 'y' : 'x') : [];
      if (!pieces.length && ok) pieces = [rect]; // nothing sheathed / no outline: keep the rectangle (the checks say so)
      d.parts = pieces.map((q, i) => ({ id: (d.id || 'dg-auto-' + k) + '-p' + (i + 1), x1: r2(q.x1), x2: r2(q.x2), y1: r2(q.y1), y2: r2(q.y2) }));
    });
    return inp;
  } },
];

const clone = v => JSON.parse(JSON.stringify(v));
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function storedSchema(inputs, columnVersion) {
  const inner = inputs && parseInt(inputs.schemaVersion, 10);
  if (Number.isFinite(inner) && inner > 0) return inner;
  const col = parseInt(columnVersion, 10);
  return Number.isFinite(col) && col > 0 ? col : 1;
}

export function migrateInputs(inputs, from) {
  if (!isObj(inputs)) return inputs;
  let inp = clone(inputs);
  if (from > TD_SCHEMA) return inp;
  for (const step of TD_MIGRATIONS) if (step.to > from) inp = step.up(inp);
  inp.schemaVersion = TD_SCHEMA;
  return inp;
}

export function normalizeInputs(inputs) {
  if (!isObj(inputs)) return inputs;
  const fill = (o, defaults) => { for (const [k, v] of Object.entries(defaults)) if (o[k] === undefined || (o[k] === null && typeof v === 'object' && v !== null)) o[k] = typeof v === 'object' && v !== null ? clone(v) : v; return o; };
  const arr = (o, k) => { if (!Array.isArray(o[k])) o[k] = []; return o[k]; };
  fill(inputs, { codeEdition: 'CBC-2025', designBasis: 'ASD', pdfReport: 'summary', refs: {}, notes: '', level: {}, diaphragm: {} });
  fill(inputs.level, { name: '', fx: '', diaphragmFactor: '', collectorFactor: '' });
  fill(inputs.diaphragm, { sheathing: 'wsp', blocked: true });
  fill(inputs, { wallLink: {} });
  fill(inputs.wallLink, { dirMap: {}, origins: {}, groups: [], lineGrid: {} }); // groups: offset lines; lineGrid: grid / span per SWD line (2026-11-03)
  fill(inputs, { noLoad: {}, gridsLocked: false, aboveCollectors: {} }); // aboveCollectors (2026-11-05): collector from–to per SWD line of walls above // gridsLocked: grid lines read-only in the editor (2026-11-03) // 2026-11-03: the engineer declares the item has no seismic (E) / no wind (W) load
  fill(inputs.noLoad, { E: false, W: false });
  arr(inputs, 'grids').forEach((g, i) => isObj(g) && fill(g, { id: 'gr-auto-' + i, name: '', axis: 'x', at: '', ref: false, from: '', to: '' }));
  arr(inputs, 'outline').forEach(p => isObj(p) && fill(p, { x: '', y: '' }));
  arr(inputs, 'openings').forEach((o, i) => isObj(o) && fill(o, { id: 'op-auto-' + i, name: '', x1: '', x2: '', y1: '', y2: '' }));
  arr(inputs, 'walls').forEach((w, i) => isObj(w) && fill(w, { id: 'wl-auto-' + i, line: '', mark: '', gridId: '', from: '', to: '' }));
  // a TD / diaphragm saved before it had a direction takes the direction of the item's first load
  const dir0 = Array.isArray(inputs.loads) && inputs.loads[0] && String(inputs.loads[0].acts || '').endsWith('x') ? 'x' : 'y';
  arr(inputs, 'diaphragms').forEach((d, i) => {
    if (!isObj(d)) return;
    fill(d, { id: 'dg-auto-' + i, mark: '', dir: dir0, sheathing: '', blocked: null, bandSplit: '', chordCut: '' });
    arr(d, 'supports');
    arr(d, 'parts').forEach((q, j) => isObj(q) && fill(q, { id: d.id + '-p' + (j + 1), x1: '', x2: '', y1: '', y2: '' }));
  });
  // TD load lines (2026-11-03): a TD saved before has no loadsMode — it becomes 'auto' when its entered lines are the
  // ones the plan gives, else it stays 'manual' (nothing changes for it; the TD card shows the found lines)
  const undecided = Array.isArray(inputs.tds) && inputs.tds.some(t => isObj(t) && t.loadsMode === undefined);
  const found = undecided ? autoLoads(inputs) : null;
  arr(inputs, 'tds').forEach((t, i) => {
    if (!isObj(t)) return;
    if (t.loadsMode === undefined) {
      const f = found.get(t.id), mine = (Array.isArray(t.loads) ? t.loads : []).map(l => (l && l.gridId) + ' ' + (l && l.side)).sort().join(',');
      t.loadsMode = f !== undefined && f === mine ? 'auto' : 'manual';
    }
    fill(t, { id: 'td-auto-' + i, mark: '', dir: dir0, x1: '', x2: '', y1: '', y2: '', overhang: null, engineer: {} });
    arr(t, 'supports');
    arr(t, 'loads').forEach(l => isObj(l) && fill(l, { gridId: '', side: '+' }));
    fill(t.engineer, { regionClear: null, cantileverOk: null, closureTol: '' });
    if (!Array.isArray(t.overhangs)) t.overhangs = typedOverhang(inputs, t);
    t.overhangs.forEach(o => isObj(o) && fill(o, { fromId: '', toId: '', at: '' }));
  });
  arr(inputs, 'loads').forEach((l, i) => {
    if (!isObj(l)) return;
    fill(l, { id: 'ld-auto-' + i, acts: '-y', mode: 'line', psf: '', edgeId: '', kind: '' });
    arr(l, 'segments').forEach(s => isObj(s) && fill(s, { from: '', to: '', w: '', w2: '', wl: '' }));
  });
  return inputs;
}

// A TD's typed overhang [a, b] (saved before 2026-11-04) as grid picks (tdGeometry.legacyOverhang reads it the same way)
function typedOverhang(inputs, t) {
  const gridById = new Map((Array.isArray(inputs.grids) ? inputs.grids : []).filter(isObj)
    .map(g => [g.id, { id: g.id, axis: g.axis === 'y' ? 'y' : 'x', at: g.at === '' || g.at == null ? NaN : Number(g.at), ref: !!g.ref }]));
  return legacyOverhang(t, gridById).map(o => ({ fromId: o.support ? o.support.id : '', toId: o.tipGrid ? o.tipGrid.id : '', at: o.tipGrid ? '' : String(o.tip) }));
}

// The load lines the plan gives each TD (tdGeometry.detectTdLoads), as 'gridId side' lists for comparison
function autoLoads(inputs) {
  const m = new Map();
  try {
    const plan = parsePlan({ ...inputs, tds: inputs.tds.map(t => (isObj(t) ? { ...t, loadsMode: 'auto' } : t)) });
    for (const t of plan.tds) m.set(t.id, t.loads.map(l => l.grid.id + ' ' + l.side).sort().join(','));
  } catch { /* incomplete plan: no TD becomes auto */ }
  return m;
}

export function migrateItem(item) {
  if (!item || !isObj(item.inputs)) return item;
  const from = storedSchema(item.inputs, item.schemaVersion);
  const inputs = normalizeInputs(migrateInputs(item.inputs, from));
  return { ...item, inputs, schemaVersion: Math.max(from, TD_SCHEMA) };
}

// Every leaf value with its path. Used by the no-loss checks.
export function leafPaths(v, p = '', out = new Map()) {
  if (Array.isArray(v)) { if (!v.length) out.set(p, '[]'); v.forEach((x, i) => leafPaths(x, p ? p + '.' + i : String(i), out)); }
  else if (isObj(v)) { const ks = Object.keys(v); if (!ks.length) out.set(p, '{}'); ks.forEach(k => leafPaths(v[k], p ? p + '.' + k : k, out)); }
  else out.set(p, v);
  return out;
}

export function lostValues(before, after) {
  const b = leafPaths(before), a = leafPaths(after);
  const lost = [];
  for (const [p, v] of b) {
    if (v === '[]' || v === '{}') continue;
    if (!a.has(p) || a.get(p) !== v) lost.push(p + ': ' + JSON.stringify(v) + ' → ' + (a.has(p) ? JSON.stringify(a.get(p)) : 'missing'));
  }
  return lost;
}
