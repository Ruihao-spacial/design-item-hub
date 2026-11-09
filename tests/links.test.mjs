// Current results for every module + linked-value change checks. Run: node tests/links.test.mjs
import assert from 'assert/strict';
await import('../scripts/lib/shearWallLoadCheck.mjs'); // stand-in DOM globals
const { DESIGN_ITEM_MODULES, getModule } = await import('../src/modules/registry.js');
const { currentOutputs, linkChanges, applyLinkUpdates } = await import('../src/results.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

// A module's own default definition: render its form and press Calculate & Save
function defaultsOf(modId) {
  const mod = getModule(modId);
  let saved = null;
  const c = document.createElement('div');
  mod.renderForm(c, null, (inputs) => { saved = JSON.parse(JSON.stringify(inputs)); }, [], () => {});
  const btn = [...c.querySelectorAll('button')].find(b => /Calculate/.test(b.textContent));
  assert.ok(btn, modId + ' has a Calculate & Save button');
  btn.dispatchEvent(new window.Event('click'));
  assert.ok(saved, modId + ' produced default inputs');
  return saved;
}
const itemOf = (id, type, inputs) => ({ id, type, label: getModule(type).label, customName: '', inputs, outputs: {}, schemaVersion: getModule(type).schemaVersion });

// Chain: Flat Load → Mass Takeoff → ELF ← Base Shear
function chain() {
  const flat = itemOf('flat-1', 'flat_load_calculator', defaultsOf('flat_load_calculator'));
  const tab = getModule('flat_load_calculator').calc(flat.inputs).perTab[0];
  const psf = Math.round((tab.dlLateral || tab.dl || 0) * 10) / 10;

  const massIn = defaultsOf('seismic_mass_takeoff');
  massIn.refs = { flatLoadSource: 'flat-1' };
  massIn.levels[0].areaMasses.push({ id: 'amT', element: 'Roof deck', area: '1000', slope: '', psf, refKey: tab.id, comments: '' });
  const mass = itemOf('mass-1', 'seismic_mass_takeoff', massIn);

  const bsIn = defaultsOf('seismic_base_shear');
  const bs = itemOf('bs-1', 'seismic_base_shear', bsIn);
  const bsOut = getModule('seismic_base_shear').calc(bsIn);

  const massOut = getModule('seismic_mass_takeoff').calc(massIn);
  const elfIn = defaultsOf('elf_diaphragm_collector');
  elfIn.refs = { massSource: 'mass-1', baseShearSource: 'bs-1' };
  elfIn.levels = massOut.perLevel.map(m => ({ name: m.label, wx: String(m.seismicWeight), hx: String(m.hx), wpx: '' }));
  for (const k of ['sds', 'cs', 'ie', 'omega0', 'k']) elfIn[k] = String(bsOut[k]);
  const elf = itemOf('elf-1', 'elf_diaphragm_collector', elfIn);

  const dlIn = defaultsOf('diaphragm_to_lrs');
  dlIn.refs = { elfSource: 'elf-1' };
  const elfOut = getModule('elf_diaphragm_collector').calc(elfIn);
  dlIn.levels = elfOut.elfTable.map((r, i) => ({ id: 'dl-lv' + i, name: r.level, tag: '', fx: String(r.fx) }));
  const dl = itemOf('dl-1', 'diaphragm_to_lrs', dlIn);

  const tdIn = defaultsOf('diaphragm_analysis');
  tdIn.refs = { elfSource: 'elf-1' };
  tdIn.level = { name: elfOut.elfTable[0].level, fx: String(elfOut.elfTable[0].fx) };
  const td = itemOf('td-1', 'diaphragm_analysis', tdIn);
  return { flat, mass, bs, elf, dl, td, items: [flat, mass, bs, elf, dl, td], tab, psf };
}

test('Every module regenerates results from its definition; results + PDF render', () => {
  const { items } = chain();
  for (const mod of DESIGN_ITEM_MODULES) {
    if (mod.id === 'shear_wall_design') continue; // covered by tests/shearWall.test.mjs
    assert.ok(mod.regenerateResults, mod.id + ' regenerates');
    const it = items.find(x => x.type === mod.id);
    const out = currentOutputs(mod, it, items);
    assert.deepEqual(out, mod.calc(it.inputs, {}), mod.id + ' current = calc(inputs)');
    mod.renderOutputs(document.createElement('div'), out);
    mod.pdfSections(it.inputs, out);
  }
});

test('In-sync chain reports no linked changes', () => {
  const { items } = chain();
  for (const it of items) assert.deepEqual(linkChanges(getModule(it.type), it, items), [], it.type);
});

test('Flat Load assembly DL change → Mass Takeoff notice → Update clears it', () => {
  const { mass, items, psf } = chain();
  const massMod = getModule('seismic_mass_takeoff');
  mass.inputs.levels[0].areaMasses.find(r => r.id === 'amT').psf = psf + 2.5; // copy is now out of date
  const ch = linkChanges(massMod, mass, items);
  assert.equal(ch.length, 1);
  assert.equal(ch[0].refKey, 'flatLoadSource');
  assert.ok(/Roof deck/.test(ch[0].label) && Math.abs(ch[0].to - psf) < 1e-9, JSON.stringify(ch[0]));
  mass.inputs = applyLinkUpdates(massMod, mass.inputs, items, mass.id);
  assert.equal(mass.inputs.levels[0].areaMasses.find(r => r.id === 'amT').psf, psf);
  assert.deepEqual(linkChanges(massMod, mass, items), []);
});

test('Deleted Flat Load assembly is reported and never auto-updated', () => {
  const { mass, items } = chain();
  const massMod = getModule('seismic_mass_takeoff');
  const row = mass.inputs.levels[0].areaMasses.find(r => r.id === 'amT');
  row.refKey = 'tab-gone'; row.psf = 12;
  const ch = linkChanges(massMod, mass, items);
  assert.ok(ch.length === 1 && ch[0].missing, JSON.stringify(ch));
  mass.inputs = applyLinkUpdates(massMod, mass.inputs, items, mass.id);
  assert.equal(mass.inputs.levels[0].areaMasses.find(r => r.id === 'amT').psf, 12);
});

test('Base Shear Cs and Mass Takeoff W changes → ELF notice → Update clears it', () => {
  const { elf, bs, items } = chain();
  const elfMod = getModule('elf_diaphragm_collector');
  const bsOut = getModule('seismic_base_shear').calc(bs.inputs);
  elf.inputs.cs = String(bsOut.cs + 0.02);
  elf.inputs.levels[0].wx = String(parseFloat(elf.inputs.levels[0].wx) + 10);
  elf.inputs.levels[0].wpx = '55';
  const ch = linkChanges(elfMod, elf, items);
  const labels = ch.map(c => c.label);
  assert.ok(labels.includes('Cs'), labels.join());
  assert.ok(labels.some(l => / W$/.test(l)), labels.join());
  assert.equal(ch.length, 2, labels.join());
  elf.inputs = applyLinkUpdates(elfMod, elf.inputs, items, elf.id);
  assert.deepEqual(linkChanges(elfMod, elf, items), []);
  assert.equal(elf.inputs.levels[0].wpx, '55', 'Wpx kept for a matching level');
});

test('Mass Takeoff level list change is reported as one change and rebuilt on Update', () => {
  const { elf, mass, items } = chain();
  const elfMod = getModule('elf_diaphragm_collector');
  mass.inputs.levels.push({ ...JSON.parse(JSON.stringify(mass.inputs.levels[0])), id: 'lv-new', name: 'Penthouse', areaMasses: [], lineMasses: [], pointMasses: [] });
  const ch = linkChanges(elfMod, elf, items);
  assert.ok(ch.length === 1 && ch[0].label === 'Level list', JSON.stringify(ch));
  elf.inputs = applyLinkUpdates(elfMod, elf.inputs, items, elf.id);
  assert.equal(elf.inputs.levels.length, mass.inputs.levels.length);
  assert.deepEqual(linkChanges(elfMod, elf, items), []);
});

test('ELF F_x change → Diaphragm to LRS notice → Update clears it, level ids kept', () => {
  const { dl, items } = chain();
  const mod = getModule('diaphragm_to_lrs');
  const id0 = dl.inputs.levels[0].id;
  dl.inputs.levels[0].fx = String(parseFloat(dl.inputs.levels[0].fx) + 1);
  const ch = linkChanges(mod, dl, items);
  assert.ok(ch.length === 1 && / Fx$/.test(ch[0].label), JSON.stringify(ch));
  dl.inputs = applyLinkUpdates(mod, dl.inputs, items, dl.id);
  assert.deepEqual(linkChanges(mod, dl, items), []);
  assert.equal(dl.inputs.levels[0].id, id0, 'level id kept (diaphragms stay on their level)');
});

test('Cycles and missing upstream items are ignored', () => {
  const { elf, items } = chain();
  const elfMod = getModule('elf_diaphragm_collector');
  elf.inputs.refs.massSource = 'no-such-item';
  assert.doesNotThrow(() => linkChanges(elfMod, elf, items));
  const self = { ...elf, inputs: { ...elf.inputs, refs: { massSource: elf.id } } };
  assert.doesNotThrow(() => currentOutputs(elfMod, self, [self]));
});

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
