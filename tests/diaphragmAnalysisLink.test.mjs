// Diaphragm Analysis ↔ Shear Wall Design link (Phase 2, option B): link infra (many / from 'inputs' refs, no
// cycle), walls of SWD placed on the DA plan, matching checks, SWD line loads from DA, unlinked SWD untouched,
// clone of list links. Run: node tests/diaphragmAnalysisLink.test.mjs
import assert from 'assert/strict';
import { parseHTML } from 'linkedom';

if (!globalThis.document) {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window, document, Node: window.Node });
}
const { getModule } = await import('../src/modules/registry.js');
const { refsFromItems, currentOutputs, linkChanges, applyLinkUpdates } = await import('../src/results.js');
const { remapRefs } = await import('../src/clone.js');
const { swdExtract, linkedWalls, guessDir } = await import('../src/modules/tdWallLink.js');
const { parsePlan } = await import('../src/modules/tdGeometry.js');
const { defaultInputs } = await import('../src/modules/tdModel.js');
const { diaphragmAnalysis, calcAll } = await import('../src/modules/diaphragmAnalysis.js');

const da = getModule('diaphragm_analysis');
const swdMod = getModule('shear_wall_design');
const clone = v => JSON.parse(JSON.stringify(v));
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; }
}

// SWD's own default definition (its form + Calculate & Save), then two levels, two directions, walls on line 1
function swdDefaults() {
  let saved = null;
  const c = document.createElement('div');
  swdMod.renderForm(c, null, (x) => { saved = clone(x); }, [], () => {});
  [...c.querySelectorAll('button')].find(b => /Calculate/.test(b.textContent)).dispatchEvent(new window.Event('click'));
  return saved;
}
function swdCase() {
  const def = swdDefaults();
  const roof = def.levels[0];
  (def.directions || []).forEach(d => (d.lines || []).forEach(l => { l.totalLength = 50; }));
  roof.name = 'Roof';
  const ns = def.directions[0];
  ns.name = 'N-S';
  ns.lines = [{ ...clone(ns.lines[0] || {}), id: 'ln-a', name: '1', totalLength: 50, levelLoads: {}, walls: [
    { ...clone((ns.lines[0] && ns.lines[0].walls[0]) || {}), id: 'w-a', mark: 'SW-1', levelId: roof.id, position: 5, length: 20 },
    { ...clone((ns.lines[0] && ns.lines[0].walls[0]) || {}), id: 'w-b', mark: 'SW-2', levelId: roof.id, position: 30, length: 4, systemType: 'wswh', wswhWidth: '24' },
  ] }];
  return def;
}
function daCase(swdId) {
  const inputs = defaultInputs();
  inputs.level = { name: 'Roof', fx: '' };
  if (swdId) inputs.refs = { wallSource: swdId };
  return inputs;
}
const item = (id, type, inputs, outputs = {}) => ({ id, type, label: type, customName: '', inputs, outputs, schemaVersion: getModule(type).schemaVersion });

test('direction guess from SWD names', () => {
  assert.equal(guessDir('N-S'), 'y'); assert.equal(guessDir('E-W'), 'x'); assert.equal(guessDir('ew'), 'x');
  assert.equal(guessDir('Y'), 'y'); assert.equal(guessDir('Front'), '');
});

test('SWD walls placed on the DA plan: line on the ↕ grid of the same name, origin auto, WSWH width', () => {
  const swd = swdExtract(swdCase());
  const inputs = daCase();
  const lw = linkedWalls(inputs, parsePlan(inputs), swd);
  const issues = lw.issues.filter(i => i.code !== 'link-dir'); // the second SWD direction (E-W) has no line named like a grid
  assert.deepEqual(issues.map(i => i.code), []);
  const sw1 = lw.walls.find(w => w.mark === 'SW-1'), sw2 = lw.walls.find(w => w.mark === 'SW-2');
  const g1 = inputs.grids.find(g => g.name === '1');
  assert.equal(sw1.gridId, g1.id);
  assert.deepEqual([Number(sw1.from), Number(sw1.to)], [5, 25], 'origin = where grid 1 enters the plan (y = 0)');
  assert.deepEqual([Number(sw2.from), Number(sw2.to)], [30, 32], 'WSWH 24 in = 2 ft wide');
  assert.equal(sw2.type, 'wswh');
  inputs.wallLink = { dirMap: {}, origins: { 'ln-a': '10' } };
  const moved = linkedWalls(inputs, parsePlan(inputs), swd).walls.find(w => w.mark === 'SW-1');
  assert.deepEqual([Number(moved.from), Number(moved.to)], [15, 35], 'typed origin');
});

test('matching checks: level name, grid name, direction mapping', () => {
  const swd = swdExtract(swdCase());
  const inputs = daCase();
  inputs.level.name = 'Penthouse';
  assert.ok(linkedWalls(inputs, parsePlan(inputs), swd).issues.some(i => i.code === 'link-level'));
  inputs.level.name = 'roof'; // case-insensitive
  assert.ok(!linkedWalls(inputs, parsePlan(inputs), swd).issues.some(i => i.code === 'link-level'));
  inputs.grids.find(g => g.name === '1').name = '1A';
  assert.ok(linkedWalls(inputs, parsePlan(inputs), swd).issues.some(i => i.code === 'link-grid'));
  const odd = clone(swd); odd.directions[0].name = 'Front';
  inputs.grids.find(g => g.name === '1A').name = '1';
  const r = linkedWalls(inputs, parsePlan(inputs), odd);
  assert.ok(r.issues.some(i => i.code === 'link-dir'), 'an unguessable direction asks for a mapping');
  inputs.wallLink = { dirMap: { [odd.directions[0].id]: 'y' }, origins: {} };
  assert.ok(linkedWalls(inputs, parsePlan(inputs), odd).walls.some(w => w.mark === 'SW-1'), 'mapped by hand');
});

test('line length check: SWD line length must equal the plan length of its grid; flagged when not', () => {
  const def = swdCase();
  def.directions[0].lines[0].totalLength = 50;                       // grid 1 crosses the 100 × 50 plan: 50 ft
  const inputs = daCase();
  const ok = linkedWalls(inputs, parsePlan(inputs), swdExtract(def));
  const l1 = ok.lines.find(l => l.name === '1');
  assert.equal(l1.planLength, 50);
  assert.ok(!ok.issues.some(i => i.code === 'link-length'));
  def.directions[0].lines[0].totalLength = 60;
  const bad = linkedWalls(inputs, parsePlan(inputs), swdExtract(def));
  const msg = bad.issues.find(i => i.code === 'link-length');
  assert.ok(msg && /60 ft ≠ grid 1 in this plan 50 ft/.test(msg.msg), 'flagged with both lengths');
  assert.equal(calcAll(inputs, { wallSource: swdExtract(def) }).status, 'fail', 'shown as a plan error');
  // a notched outline: the grid line length runs from where it enters to where it leaves the sheathing
  inputs.outline = [[0, 0], [100, 0], [100, 50], [10, 50], [10, 40], [0, 40]].map(([x, y]) => ({ x: String(x), y: String(y) }));
  def.directions[0].lines[0].totalLength = 40;
  assert.ok(!linkedWalls(inputs, parsePlan(inputs), swdExtract(def)).issues.some(i => i.code === 'link-length'), 'grid 1 (x = 0) is 40 ft long here');
});

test('link infra: DA reads the SWD definition (from inputs), SWD reads DA outputs (many) — no cycle, both resolve', () => {
  const swdDef = swdCase();
  swdDef.refs = { diaphragmSources: ['da-1'] };
  const items = [item('swd-1', 'shear_wall_design', swdDef), item('da-1', 'diaphragm_analysis', daCase('swd-1'))];
  const daRefs = refsFromItems(da, items[1].inputs, items, new Set(['da-1']));
  assert.ok(daRefs.wallSource && daRefs.wallSource.directions.length >= 1, 'DA got the SWD definition');
  const daOut = currentOutputs(da, items[1], items);
  assert.equal(daOut.counts.walls, 2, 'DA results use the linked walls');
  assert.ok(daOut.lineForces.length && daOut.lineForces.every(l => l.E === 0 && l.W === 0), 'line forces 0 while F_x is blank (Phase 4)');
  const swdRefs = refsFromItems(swdMod, swdDef, items, new Set(['swd-1']));
  assert.ok(Array.isArray(swdRefs.diaphragmSources) && swdRefs.diaphragmSources[0].id === 'da-1' && swdRefs.diaphragmSources[0].level === 'Roof');
  assert.ok(currentOutputs(swdMod, items[0], items), 'SWD still calculates');
  assert.deepEqual(linkChanges(swdMod, items[0], items), [], 'no forces yet → nothing to update');
});

test('SWD line loads from DA: notice lists them, Update copies them, linked level inputs are greyed out', () => {
  const swdDef = swdCase();
  swdDef.refs = { diaphragmSources: ['da-1'] };
  const dir = swdDef.directions[0];
  const fake = { level: 'Roof', lineForces: [{ swdDirId: dir.id, swdLineId: 'ln-a', E: 6.34841, W: null }] };
  const ch = swdMod.linkDiff(clone(swdDef), { diaphragmSources: [{ id: 'da-1', ...fake }] });
  assert.equal(ch.length, 1);
  assert.equal(ch[0].refKey, 'diaphragmSources');
  assert.equal(ch[0].to, 6.3484);
  const upd = swdMod.applyLinks(clone(swdDef), { diaphragmSources: [{ id: 'da-1', ...fake }] });
  const roofId = swdDef.levels[0].id;
  assert.equal(upd.directions[0].lines[0].levelLoads[roofId].seismic, '6.3484');
  assert.deepEqual(swdMod.linkDiff(upd, { diaphragmSources: [{ id: 'da-1', ...fake }] }), [], 'in sync after Update');
  // the form: the DA item is listed, ticked, and the Roof load inputs of the master table are disabled
  const box = document.createElement('div');
  swdMod.renderForm(box, clone(upd), () => {}, [item('da-1', 'diaphragm_analysis', daCase('swd-1'))], () => {});
  assert.ok(box.textContent.includes('Line loads from Diaphragm Analysis'));
  const cb = [...box.querySelectorAll('input[type=checkbox]')].find(x => x.parentNode && x.parentNode.textContent.includes('level "Roof"'));
  assert.ok(cb && cb.checked, 'ticked');
  assert.ok([...box.querySelectorAll('input[type=number]')].some(i => i.disabled && /Diaphragm Analysis/.test(i.getAttribute('title') || '')), 'linked load input greyed out');
});

test('unlinked SWD items are untouched: linkDiff / applyLinks add nothing, refs untouched', () => {
  const def = swdCase();
  const before = clone(def);
  assert.deepEqual(swdMod.linkDiff(clone(def), {}), []);
  assert.deepEqual(swdMod.applyLinks(clone(def), {}), before);
  assert.deepEqual(applyLinkUpdates(swdMod, clone(def), [], 'x'), applyLinkUpdates(swdMod, before, [], 'x'));
  assert.equal(def.refs && def.refs.diaphragmSources, undefined);
});

test('clone: a list of links is remapped; deleted targets dropped; empty list removed', () => {
  const idMap = new Map([['a', 'A'], ['b', 'B']]);
  assert.deepEqual(remapRefs({ diaphragmSources: ['a', 'x', 'b'], elfSource: 'a', gone: 'x' }, idMap), { diaphragmSources: ['A', 'B'], elfSource: 'A' });
  assert.deepEqual(remapRefs({ diaphragmSources: ['x'] }, idMap), {});
});

test('DA form with the SWD item: link section, walls drawn read-only, Wall tool disabled', () => {
  const swdDef = swdCase();
  const items = [item('swd-1', 'shear_wall_design', swdDef)];
  const box = document.createElement('div');
  diaphragmAnalysis.renderForm(box, daCase('swd-1'), () => {}, items, () => {}, {});
  const click = t => { const b = [...box.querySelectorAll('button')].find(x => x.textContent.startsWith(t)); b.dispatchEvent(new window.Event('click')); };
  click('Setup');
  click('Shear wall link'); // Setup page of its own (2026-10-30)
  assert.ok(box.textContent.includes('Shear walls (from Shear Wall Design)'));
  assert.ok(box.textContent.includes('auto 0') || [...box.querySelectorAll('input')].some(i => i.getAttribute('placeholder') === 'auto 0'), 'origin auto shown');
  click('Plan');
  assert.ok(box.querySelector('svg').outerHTML.includes('SW-1'));
  const wallBtn = [...box.querySelectorAll('button')].find(b => b.textContent === 'Wall');
  assert.ok(wallBtn.disabled, 'Wall tool disabled while linked');
  assert.ok(box.textContent.includes('from Shear Wall Design, read-only'));
  const out = calcAll(daCase('swd-1'), { wallSource: swdExtract(swdDef) });
  assert.equal(out.counts.walls, 2);
});

console.log(passed + ' passed');
