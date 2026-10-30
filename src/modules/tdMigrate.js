// Transfer Diaphragm — stored definition: version stamp, migration steps, normalisation (docs/data-durability.md).
//
// items.inputs is the source of truth (what the user typed; results are always regenerated). Rules:
//   - inputs.schemaVersion is stamped inside the data (P3); the DB column schema_version is a copy.
//   - A shape change is a step in TD_MIGRATIONS (P4): pure, idempotent, keeps every field it does not know.
//   - normalizeInputs only ADDS missing fields with neutral defaults (P5); safe on every open.
//   - Every past schema keeps a frozen fixture in tests/fixtures/legacy-td/ (P6).
// No DOM, no imports from the module UI.
//
// Shape (schema 1):
// { schemaVersion, codeEdition, designBasis, pdfReport, refs: { elfSource }, notes,
//   level: { name, fx },                                        // F_x in kip (linked from ELF or typed)
//   diaphragm: { sheathing: 'wsp', blocked: true },              // defaults for every diaphragm / TD
//   diaphragms: [{ id, mark, dir: 'x'|'y', x1, x2, y1, y2, supports: [gridId, gridId], sheathing, blocked }],
//                                                               // dir = axis the load acts along; '' / null = default
//   grids: [{ id, name, axis: 'x'|'y', at, ref }],             // axis 'x' = a line of constant x
//   outline: [{ x, y }],                                        // rectilinear, corners in order
//   openings: [{ id, name, x1, x2, y1, y2 }],
//   walls: [{ id, line, mark, gridId, from, to }],              // typed wall lines (Shear Wall Lines link: Phase 2)
//   tds: [{ id, mark, dir, x1, x2, y1, y2, supports: [gridId, gridId], loads: [{ gridId, side }], overhang: [a, b] | null,
//           engineer: { regionClear, cantileverOk, closureTol } },
//   wallLink: { dirMap: { [swdDirId]: 'x'|'y' }, origins: { [swdLineId]: ft | '' } },   // refs.wallSource = SWD item
//   loads: [{ id, acts: '+x'|'-x'|'+y'|'-y', mode: 'seismic'|'area'|'line'|'wind', kind: ''|'E'|'W' ('' = E for seismic, else W),
//             psf, edgeId, segments: [{ from, to, w, w2, wl }] }] }
//   diaphragms[].bandSplit: ''|'mid'|'low'|'high' (Phase 4; '' = mid)
//   loads[].mode 'wind' + segments[].wl (2026-10-30): w = windward plf, wl = leeward plf (blank = 0)
//   level.diaphragmFactor / level.collectorFactor (2026-10-30): display factors F_x → diaphragm / collector level
//     ('' = 1); results stay at 1.0E
// Numbers are stored as typed (strings); '' = blank.

export const TD_SCHEMA = 1;

// Ordered steps; `to` = the schema the step produces. Add new steps at the end, never edit a released one.
export const TD_MIGRATIONS = [];

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
  fill(inputs.wallLink, { dirMap: {}, origins: {} });
  arr(inputs, 'grids').forEach((g, i) => isObj(g) && fill(g, { id: 'gr-auto-' + i, name: '', axis: 'x', at: '', ref: false }));
  arr(inputs, 'outline').forEach(p => isObj(p) && fill(p, { x: '', y: '' }));
  arr(inputs, 'openings').forEach((o, i) => isObj(o) && fill(o, { id: 'op-auto-' + i, name: '', x1: '', x2: '', y1: '', y2: '' }));
  arr(inputs, 'walls').forEach((w, i) => isObj(w) && fill(w, { id: 'wl-auto-' + i, line: '', mark: '', gridId: '', from: '', to: '' }));
  // a TD / diaphragm saved before it had a direction takes the direction of the item's first load
  const dir0 = Array.isArray(inputs.loads) && inputs.loads[0] && String(inputs.loads[0].acts || '').endsWith('x') ? 'x' : 'y';
  arr(inputs, 'diaphragms').forEach((d, i) => {
    if (!isObj(d)) return;
    fill(d, { id: 'dg-auto-' + i, mark: '', dir: dir0, x1: '', x2: '', y1: '', y2: '', sheathing: '', blocked: null, bandSplit: '' });
    arr(d, 'supports');
  });
  arr(inputs, 'tds').forEach((t, i) => {
    if (!isObj(t)) return;
    fill(t, { id: 'td-auto-' + i, mark: '', dir: dir0, x1: '', x2: '', y1: '', y2: '', overhang: null, engineer: {} });
    arr(t, 'supports');
    arr(t, 'loads').forEach(l => isObj(l) && fill(l, { gridId: '', side: '+' }));
    fill(t.engineer, { regionClear: null, cantileverOk: null, closureTol: '' });
  });
  arr(inputs, 'loads').forEach((l, i) => {
    if (!isObj(l)) return;
    fill(l, { id: 'ld-auto-' + i, acts: '-y', mode: 'line', psf: '', edgeId: '', kind: '' });
    arr(l, 'segments').forEach(s => isObj(s) && fill(s, { from: '', to: '', w: '', w2: '', wl: '' }));
  });
  return inputs;
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
