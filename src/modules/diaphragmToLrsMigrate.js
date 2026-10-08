// Diaphragm to LRS — stored definition: version stamp, migration steps, normalisation (docs/data-durability.md).
//
// items.inputs is the source of truth (what the user typed; results are always regenerated). Rules:
//   - inputs.schemaVersion is stamped inside the data (P3); the DB column schema_version is a copy.
//   - A shape change is a step in DLRS_MIGRATIONS (P4): pure, idempotent, and it keeps every field it does not
//     know (copy with spread — never rebuild an object from a list of known keys). A renamed / removed field must
//     be moved by the step, never dropped.
//   - normalizeInputs fills fields that are missing in older data with neutral defaults (P5). It only ADDS, never
//     changes or removes a value, so it is safe to run on every open.
//   - Every past schema keeps a frozen fixture in tests/fixtures/legacy-dlrs/ (P6), checked by
//     tests/diaphragmToLrsMigrate.test.mjs: no value lost, idempotent, same results, opens and saves.
// No DOM, no imports from the module UI (scripts and tests use it directly).

export const DLRS_SCHEMA = 2;

// Ordered steps; `to` = the schema the step produces. Add new steps at the end, never edit a released one.
export const DLRS_MIGRATIONS = [
  // 1 → 2 (2026-10-08): the version is stamped inside the inputs. No field changes.
  { to: 2, up: inp => ({ ...inp }) },
];

const clone = v => JSON.parse(JSON.stringify(v));
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// The version of stored inputs: the stamp inside the data wins over the DB column (a copy may lose the column).
export function storedSchema(inputs, columnVersion) {
  const inner = inputs && parseInt(inputs.schemaVersion, 10);
  if (Number.isFinite(inner) && inner > 0) return inner;
  const col = parseInt(columnVersion, 10);
  return Number.isFinite(col) && col > 0 ? col : 1;
}

// Run the steps after `from`. Inputs from a NEWER schema than this code are left as they are (never downgraded).
export function migrateInputs(inputs, from) {
  if (!isObj(inputs)) return inputs;
  let inp = clone(inputs);
  if (from > DLRS_SCHEMA) return inp;
  for (const step of DLRS_MIGRATIONS) if (step.to > from) inp = step.up(inp);
  inp.schemaVersion = DLRS_SCHEMA;
  return inp;
}

// Fill missing fields only (undefined / null containers). Idempotent; keeps unknown fields and every value.
export function normalizeInputs(inputs) {
  if (!isObj(inputs)) return inputs;
  const fill = (o, defaults) => { for (const [k, v] of Object.entries(defaults)) if (o[k] === undefined || (o[k] === null && typeof v === 'object')) o[k] = typeof v === 'object' ? clone(v) : v; return o; };
  const arr = (o, k) => { if (!Array.isArray(o[k])) o[k] = []; return o[k]; };
  fill(inputs, { loadType: 'seismic', pdfReport: 'summary', refs: {}, notes: '' });
  arr(inputs, 'levels').forEach((lv, i) => isObj(lv) && fill(lv, { id: 'lv-auto-' + i, name: '', tag: '', fx: '' }));
  arr(inputs, 'directions').forEach((dir, di) => {
    if (!isObj(dir)) return;
    fill(dir, { id: 'dir-auto-' + di, name: '', down: {} });
    arr(dir, 'lines').forEach((ln, i) => isObj(ln) && fill(ln, { id: dir.id + '-ln-auto-' + i, name: '' }));
    arr(dir, 'groups').forEach((g, i) => { if (isObj(g)) { fill(g, { id: dir.id + '-grp-auto-' + i }); arr(g, 'lineIds'); arr(g, 'levelIds'); } });
    arr(dir, 'diaphragms').forEach((d, i) => {
      if (!isObj(d)) return;
      fill(d, { id: dir.id + '-dg-auto-' + i, levelId: '', mark: '', length: '' });
      const sup = arr(d, 'supports');
      while (sup.length < 2) sup.push({});
      sup.forEach(s => isObj(s) && fill(s, { x: '', kind: 'line', lineId: '', diaphragmId: '', atX: '' }));
      arr(d, 'parts').forEach((p, j) => isObj(p) && fill(p, { id: d.id + '-pt-auto-' + j, a: '', b: '', d: '' }));
      arr(d, 'pointLoads').forEach((p, j) => isObj(p) && fill(p, { id: d.id + '-pl-auto-' + j, x: '', p: '', note: '' }));
    });
  });
  return inputs;
}

// Module migrate(item): stored item → current shape (inputs migrated, then normalised).
export function migrateItem(item) {
  if (!item || !isObj(item.inputs)) return item;
  const from = storedSchema(item.inputs, item.schemaVersion);
  const inputs = normalizeInputs(migrateInputs(item.inputs, from));
  return { ...item, inputs, schemaVersion: Math.max(from, DLRS_SCHEMA) };
}

// Every leaf value with its path ('directions.0.lines.1.name' → '4'). Used by the no-loss checks.
export function leafPaths(v, p = '', out = new Map()) {
  if (Array.isArray(v)) { if (!v.length) out.set(p, '[]'); v.forEach((x, i) => leafPaths(x, p ? p + '.' + i : String(i), out)); }
  else if (isObj(v)) { const ks = Object.keys(v); if (!ks.length) out.set(p, '{}'); ks.forEach(k => leafPaths(v[k], p ? p + '.' + k : k, out)); }
  else out.set(p, v);
  return out;
}

// Paths of `before` whose value is missing or different in `after` (a container that only gained entries is fine).
export function lostValues(before, after) {
  const b = leafPaths(before), a = leafPaths(after);
  const lost = [];
  for (const [p, v] of b) {
    if (v === '[]' || v === '{}') continue; // an empty container may be filled by normalisation
    if (!a.has(p) || a.get(p) !== v) lost.push(p + ': ' + JSON.stringify(v) + ' → ' + (a.has(p) ? JSON.stringify(a.get(p)) : 'missing'));
  }
  return lost;
}

// The engineering numbers of a result (reactions, line forces, story shears) — compared across versions.
export function resultNumbers(out) {
  const n = {};
  for (const d of (out && out.perDirection) || []) {
    for (const lv of d.perLevel || []) {
      const k = (d.name || '') + '/' + (lv.name || '');
      n[k + ' ΣA'] = lv.sumA; n[k + ' q'] = lv.q;
      for (const g of lv.diaphragms || []) (g.supports || []).forEach(s => { n[k + ' ' + g.label + '.' + s.name] = s.R; });
      for (const u of lv.lines || []) { n[k + ' ' + u.label + ' F'] = u.F; n[k + ' ' + u.label + ' V'] = u.V; }
    }
  }
  return n;
}
