// Clone a project / duplicate a calculation (src/clone.js). Run: node tests/clone.test.mjs
// The definition is copied exactly as stored; only the links (inputs.refs and the refs column) change,
// and a cloned project gives the same current results as the original.
import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
await import('../scripts/lib/shearWallLoadCheck.mjs'); // stand-in DOM globals
const { getModule } = await import('../src/modules/registry.js');
const { currentOutputs, linkChanges, applyLinkUpdates } = await import('../src/results.js');
const { cloneProjectRows, cloneItemRow, remapRefs } = await import('../src/clone.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; }
}
const copy = v => JSON.parse(JSON.stringify(v));
const withoutRefs = (inputs) => { const x = copy(inputs); delete x.refs; return x; };
let n = 0;
const seqId = () => 'new-' + (++n);

// A module's own default definition: render its form and press Calculate & Save
function defaultsOf(modId) {
  let saved = null;
  const c = document.createElement('div');
  getModule(modId).renderForm(c, null, (inputs) => { saved = copy(inputs); }, [], () => {});
  [...c.querySelectorAll('button')].find(b => /Calculate/.test(b.textContent)).dispatchEvent(new window.Event('click'));
  return saved;
}
const itemOf = (id, type, inputs, extra = {}) => ({
  id, projectNumber: 'P-1', type, label: getModule(type).label, customName: '', inputs, outputs: { stored: id },
  refs: copy(inputs.refs || {}), schemaVersion: getModule(type).schemaVersion, calcVersion: getModule(type).calcVersion,
  archived: false, revisions: [{ inputs: {}, outputs: {} }], ...extra,
});

// Every link kind: Flat Load → Mass Takeoff → ELF ← Base Shear; ELF → Diaphragm to LRS; Base Shear + Flat Load → Shear Wall.
// Mass Takeoff is archived (an archived item that another one links to).
function project() {
  const legacyDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/legacy');
  const tc1 = JSON.parse(fs.readFileSync(path.join(legacyDir, 'schema12-tc1.json'), 'utf8'));
  const flat = itemOf('flat-1', 'flat_load_calculator', defaultsOf('flat_load_calculator'));
  const bs = itemOf('bs-1', 'seismic_base_shear', defaultsOf('seismic_base_shear'));
  const mass = itemOf('mass-1', 'seismic_mass_takeoff', { ...defaultsOf('seismic_mass_takeoff'), refs: { flatLoadSource: 'flat-1' } }, { archived: true });
  const elf = itemOf('elf-1', 'elf_diaphragm_collector', { ...defaultsOf('elf_diaphragm_collector'), refs: { massSource: 'mass-1', baseShearSource: 'bs-1' } });
  const dl = itemOf('dl-1', 'diaphragm_to_lrs', { ...defaultsOf('diaphragm_to_lrs'), refs: { elfSource: 'elf-1' } }, { customName: 'Roof E-W' });
  const sw = itemOf('sw-1', 'shear_wall_design', { ...copy(tc1.inputs), refs: { baseShearSource: 'bs-1', flatLoadSource: 'flat-1' } }, { schemaVersion: tc1.schemaVersion, calcVersion: 'v18' });
  return [flat, bs, mass, elf, dl, sw];
}
// Rows as listItems would map them back
const asItems = rows => rows.map(r => ({
  id: r.id, projectNumber: r.project_number, type: r.type, label: r.label, customName: r.custom_name || '',
  inputs: r.inputs, outputs: r.outputs, refs: r.refs, schemaVersion: r.schema_version, calcVersion: r.calc_version,
  archived: r.archived, revisions: r.revisions,
}));

test('Project clone: every item copied (archived stay archived), new ids, new project, fresh history', () => {
  const items = project();
  const rows = cloneProjectRows(items, 'P-2', 'user-9', seqId);
  assert.equal(rows.length, items.length);
  assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
  rows.forEach((r, i) => {
    const it = items[i];
    assert.ok(!items.some(x => x.id === r.id), 'new id');
    assert.equal(r.project_number, 'P-2');
    assert.equal(r.type, it.type);
    assert.equal(r.archived, it.archived);
    assert.equal(r.custom_name, it.customName || null);
    assert.equal(r.label, it.label);
    assert.equal(r.schema_version, it.schemaVersion);
    assert.equal(r.calc_version, it.calcVersion);
    assert.equal(r.entered_by, 'user-9');
    assert.deepEqual(r.revisions, []);
    assert.deepEqual(r.outputs, it.outputs);
  });
  assert.equal(rows.find(r => r.type === 'seismic_mass_takeoff').archived, true);
});

test('Project clone: every link points to the copy inside the new project; inputs otherwise unchanged', () => {
  const items = project();
  const rows = cloneProjectRows(items, 'P-2', 'u', seqId);
  const newIdOf = Object.fromEntries(items.map((it, i) => [it.id, rows[i].id]));
  rows.forEach((r, i) => {
    const it = items[i];
    const expected = Object.fromEntries(Object.entries(it.inputs.refs || {}).map(([k, v]) => [k, newIdOf[v]]));
    assert.deepEqual(r.inputs.refs || {}, expected, it.type + ' inputs.refs');
    assert.deepEqual(r.refs, expected, it.type + ' refs column');
    for (const id of Object.values(r.refs)) assert.ok(rows.some(x => x.id === id), 'link inside the new project');
    assert.deepEqual(withoutRefs(r.inputs), withoutRefs(it.inputs), it.type + ' definition copied exactly');
  });
});

test('Project clone: current results equal the original, item by item', () => {
  const items = project();
  const clones = asItems(cloneProjectRows(items, 'P-2', 'u', seqId));
  items.forEach((it, i) => {
    const mod = getModule(it.type);
    assert.deepEqual(currentOutputs(mod, clones[i], clones), currentOutputs(mod, it, items), it.type);
  });
});

// Linked values are copied into the definition; the link drives the "Upstream changed" check and the refresh.
// A clone must still see its upstream copy: an out-of-date value is reported the same way, from the copy.
test('Project clone: "Upstream changed" works the same and points at the copied upstream items', () => {
  const items = project();
  const elf = items.find(i => i.id === 'elf-1');
  const sdsNow = getModule('seismic_base_shear').calc(items.find(i => i.id === 'bs-1').inputs).sds;
  elf.inputs.sds = String(Number(sdsNow) + 0.25); // out of date vs Base Shear
  const rows = cloneProjectRows(items, 'P-2', 'u', seqId);
  const clones = asItems(rows);
  items.forEach((it, i) => {
    const mod = getModule(it.type);
    assert.deepEqual(linkChanges(mod, clones[i], clones), linkChanges(mod, it, items), it.type);
  });
  const before = linkChanges(getModule('elf_diaphragm_collector'), elf, items);
  assert.ok(before.some(c => c.refKey === 'baseShearSource'), 'stale sds reported');
  const refreshed = applyLinkUpdates(getModule('elf_diaphragm_collector'), clones[3].inputs, clones, clones[3].id);
  assert.equal(String(refreshed.sds), String(sdsNow), 'refresh pulls from the copied Base Shear');
});

test('Project clone: the source items are not changed', () => {
  const items = project();
  const before = copy(items);
  cloneProjectRows(items, 'P-2', 'u', seqId);
  assert.deepEqual(items, before);
});

test('Project clone: a link to an item that no longer exists is cleared; an item without refs gets none', () => {
  const items = project();
  items.find(i => i.id === 'elf-1').inputs.refs.baseShearSource = 'deleted-item';
  const rows = cloneProjectRows(items, 'P-2', 'u', seqId);
  const elf = rows.find(r => r.type === 'elf_diaphragm_collector');
  assert.deepEqual(Object.keys(elf.inputs.refs), ['massSource']);
  assert.deepEqual(Object.keys(elf.refs), ['massSource']);
  const noRefs = itemOf('x-1', 'seismic_base_shear', { a: '1' });
  const [r] = cloneProjectRows([noRefs], 'P-2', 'u', seqId);
  assert.ok(!('refs' in r.inputs), 'no refs key added to the definition');
  assert.deepEqual(r.refs, {});
});

test('Project clone: an empty project gives no rows', () => {
  assert.deepEqual(cloneProjectRows([], 'P-2', 'u', seqId), []);
});

test('remapRefs keeps the keys, maps the ids', () => {
  assert.deepEqual(remapRefs({ a: '1', b: '2', c: '' }, new Map([['1', 'x'], ['2', 'y']])), { a: 'x', b: 'y' });
  assert.deepEqual(remapRefs(undefined, new Map()), {});
});

test('Duplicate: same project, same links, "(copy)" name, definition copied exactly', () => {
  const items = project();
  for (const it of items) {
    const r = cloneItemRow(it, 'user-9', getModule(it.type).label, seqId);
    assert.notEqual(r.id, it.id);
    assert.equal(r.project_number, 'P-1');
    assert.deepEqual(r.inputs, it.inputs, it.type + ' inputs incl. links');
    assert.deepEqual(r.refs, it.inputs.refs || {});
    assert.equal(r.custom_name, (it.customName || it.label) + ' (copy)');
    assert.equal(r.label, r.custom_name);
    assert.equal(r.archived, it.archived);
    assert.deepEqual(r.revisions, []);
    const mod = getModule(it.type);
    const all = [...items, ...asItems([r])];
    assert.deepEqual(currentOutputs(mod, asItems([r])[0], all), currentOutputs(mod, it, items), it.type + ' same results');
  }
  assert.equal(cloneItemRow(items.find(i => i.id === 'dl-1'), 'u', 'x', seqId).custom_name, 'Roof E-W (copy)');
});

test('Every frozen fixture (tests/fixtures/legacy*) is copied without a lost value', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
  const dirs = { legacy: 'shear_wall_design', 'legacy-dlrs': 'diaphragm_to_lrs' };
  let count = 0;
  for (const [dir, type] of Object.entries(dirs)) {
    for (const f of fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.json'))) {
      const fx = JSON.parse(fs.readFileSync(path.join(root, dir, f), 'utf8'));
      const it = itemOf('fx-' + f, type, copy(fx.inputs), { schemaVersion: fx.schemaVersion, calcVersion: fx.calcVersion, outputs: fx.outputs || {} });
      const [r] = cloneProjectRows([it], 'P-2', 'u', seqId);
      assert.deepEqual(withoutRefs(r.inputs), withoutRefs(fx.inputs), f + ' project clone');
      assert.deepEqual(r.outputs, fx.outputs || {}, f + ' outputs');
      assert.equal(r.schema_version, fx.schemaVersion, f + ' schema stamp');
      assert.deepEqual(cloneItemRow(it, 'u', 'x', seqId).inputs, fx.inputs, f + ' duplicate');
      count++;
    }
  }
  assert.ok(count >= 14, 'fixtures found: ' + count);
});

console.log('\n' + passed + ' clone tests passed' + (process.exitCode ? ' — SOME FAILED' : ''));
