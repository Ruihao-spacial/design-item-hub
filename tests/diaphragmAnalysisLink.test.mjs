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

test('no line-length check (user 2026-11-05): any SWD length runs; a wall off the sheathing of its grid warns (not an error)', () => {
  const def = swdCase();
  const inputs = daCase();
  for (const L of [50, 60, 120]) {
    def.directions[0].lines[0].totalLength = L;
    const lw = linkedWalls(inputs, parsePlan(inputs), swdExtract(def));
    assert.ok(!lw.issues.some(i => i.code === 'link-length'), 'length ' + L);
    assert.equal(lw.lines.find(l => l.name === '1').planLength, 50);
    assert.deepEqual(lw.lines.find(l => l.name === '1').bands, [[0, 50]], 'sheathed stretch of grid 1');
  }
  assert.ok(!calcAll(inputs, { wallSource: swdExtract(def) }).errors.some(e => /^link-/.test(e.code)), 'nothing blocks the analysis');
  // SW-1 (position 5, 20 ft) from origin 0 sits on 5–25; a typed origin of 40 puts it at 45–65, past the plan (0–50)
  inputs.wallLink = { ...(inputs.wallLink || {}), origins: { [def.directions[0].lines[0].id]: '40' } };
  const off = linkedWalls(inputs, parsePlan(inputs), swdExtract(def)).issues.find(i => i.code === 'link-wall-sheathing');
  assert.ok(off && off.warn && /SW-1/.test(off.msg) && /0–50/.test(off.msg), off && off.msg);
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
  [...box.querySelectorAll('button')].find(b => b.textContent === 'Shear walls').dispatchEvent(new window.Event('click'));
  const wallBtn = [...box.querySelectorAll('button')].find(b => b.textContent === 'Wall');
  assert.ok(wallBtn.disabled, 'Wall tool disabled while linked');
  assert.ok(box.textContent.includes('from Shear Wall Design, read-only'));
  const out = calcAll(daCase('swd-1'), { wallSource: swdExtract(swdDef) });
  assert.equal(out.counts.walls, 2);
});

// ---- offset lines of linked walls, split like Shear Wall Design (option B, user 2026-11-03) ----
const fs = await import('node:fs');
const { bookToInputs } = await import('./td-book/src/toInputs.mjs');
const { toolValue } = await import('../src/modules/tdBookKeys.js');
const { planWithLinks } = await import('../src/modules/diaphragmAnalysis.js');
const { calcAll: swdCalc } = await import('../src/modules/shearWallCalc.js');
const book84 = () => JSON.parse(fs.readFileSync(new URL('./td-book/Ex8.4.json', import.meta.url), 'utf8'));
// Ex 8.4 with its E-W walls in an SWD item: lines A, D, "E 4-7" (SW6) and "E 8-9" (SW7) — two SWD lines on grid E, each
// on its own stretch (user 2026-11-03); offset line D/E = SWD lines D + E 4-7
function linked84({ sw5 = {}, distribution = '', names = ['E 4-7', 'E 8-9'], lengths = null } = {}) {
  const def = swdDefaults();
  const roof = def.levels[0]; roof.name = 'Roof'; def.levels = [roof];
  const proto = clone(def.directions[0].lines[0].walls[0] || {});
  const W = (id, mark, pos, len, extra = {}) => ({ ...clone(proto), id, mark, levelId: roof.id, position: pos, length: len, ...extra });
  def.directions = [{ ...clone(def.directions[0]), id: 'dir-ew', name: 'E-W', lines: [
    { id: 'ln-A', name: 'A', totalLength: 0, levelLoads: {}, walls: [W('w4', 'SW4', 25, 25), W('w8', 'SW8', 88, 20)] },
    { id: 'ln-D', name: 'D', totalLength: 0, levelLoads: {}, walls: [W('w5', 'SW5', 0, 10, sw5)] },
    { id: 'ln-E1', name: names[0], totalLength: 0, levelLoads: {}, walls: [W('w6', 'SW6', 15, 50)] },
    { id: 'ln-E2', name: names[1], totalLength: 0, levelLoads: {}, walls: [W('w7', 'SW7', 0, 25)] },
  ] }];
  if (distribution) def.directions[0].lines.forEach(l => { l.distribution = distribution; });
  const inputs = bookToInputs(book84());
  inputs.walls = []; inputs.level = { name: 'Roof', fx: '' }; inputs.refs = { wallSource: 'swd-1' };
  inputs.wallLink = { dirMap: { 'dir-ew': 'x' }, origins: {}, groups: [{ id: 'g1', name: 'D/E', lineIds: ['ln-D', 'ln-E1'], exclude: [] }] };
  const lw = linkedWalls(inputs, parsePlan(inputs), swdExtract(def));
  for (const l of lw.lines) def.directions[0].lines.find(x => x.id === l.lineId).totalLength = lengths && lengths[l.lineId] !== undefined ? lengths[l.lineId] : l.planLength;
  const swd = swdExtract(def);
  const r = calcAll(inputs, { wallSource: swd });
  const d2 = clone(def);
  for (const lf of r.lineForces) d2.directions[0].lines.find(x => x.id === lf.swdLineId).levelLoads = { [roof.id]: { seismic: String(lf.E || 0), wind: '0' } };
  const swdWalls = swdCalc(d2).perDirection[0].perLine.flatMap(l => l.perLevel[0].walls);
  return { inputs, swd, r, lw, plan: planWithLinks(inputs, { wallSource: swd }).plan, swdWalls, daWall: m => r.analysis.cases[0].lines.flatMap(l => l.walls || []).find(w => w.mark === m) };
}

test('several SWD lines on one grid: "E 4-7" / "E 8-9" sit on grid E over their spans — origin at the span start, length checked against the span (65 / 25 ft), no length error', () => {
  const { lw, r } = linked84();
  const e1 = lw.lines.find(l => l.lineId === 'ln-E1'), e2 = lw.lines.find(l => l.lineId === 'ln-E2');
  assert.equal(e1.grid.name, 'E'); assert.deepEqual(e1.span, [60, 125]); assert.equal(e1.origin, 60); assert.equal(e1.planLength, 65);
  assert.equal(e2.grid.name, 'E'); assert.deepEqual(e2.span, [145, 170]); assert.equal(e2.origin, 145); assert.equal(e2.planLength, 25);
  const sw7 = lw.walls.find(w => w.mark === 'SW7');
  assert.deepEqual([Number(sw7.from), Number(sw7.to)], [145, 170]);
  assert.deepEqual(r.errors.map(e => e.msg), []);
  assert.ok(!r.warnings.some(w => /^link-/.test(w.code)), r.warnings.filter(w => /^link-/.test(w.code)).map(w => w.msg).join('; '));
});

test('several SWD lines on one grid: any SWD length runs (no length check); two lines over the same stretch are reported', () => {
  const a = linked84({ lengths: { 'ln-E2': 30 } });
  assert.ok(!a.r.errors.some(e => /^link-/.test(e.code)), a.r.errors.map(e => e.msg).join(' | '));
  const b = linked84({ names: ['E', 'E 8-9'] }); // "E" = the whole grid, overlapping "E 8-9"
  assert.ok(b.r.errors.some(e => e.code === 'link-overlap' && /"E" and "E 8-9"/.test(e.msg)), b.r.errors.map(e => e.msg).join(' | '));
});

test('Ex 8.4 with linked walls (SWD lines D + E 4-7 as offset line D/E, SW7 alone on E 8-9): every book value; each SWD line gets its own walls\' force; SWD designs the same wall forces', () => {
  const { r, plan, swdWalls, daWall } = linked84();
  assert.deepEqual(r.errors.map(e => e.msg), []);
  assert.ok(!r.warnings.some(w => w.code === 'swd-group-partial'));
  const fails = book84().expected.filter(e => e.k !== 'R:E7').filter(e => {
    const want = e.vTool ?? e.v, got = toolValue(e.k, plan, r.analysis), tol = e.tol ?? Math.max(0.005 * Math.abs(want), 1);
    return got === null || Math.abs(got - want) > tol;
  }).map(e => e.k);
  assert.deepEqual(fails, []);
  assert.ok(Math.abs(toolValue('R:E 8-9', plan, r.analysis) - 9327) < 10, 'SW7 alone: section B 9327 lb');
  const lf = id => r.lineForces.find(l => l.swdLineId === id).E * 1000;
  assert.ok(Math.abs(lf('ln-E1') - daWall('SW6').share) < 1e-6 && Math.abs(lf('ln-E2') - daWall('SW7').share) < 1e-6, 'per SWD line, not the whole grid');
  for (const m of ['SW5', 'SW6', 'SW7']) assert.ok(Math.abs(swdWalls.find(x => x.mark === m).shareExact_1E * 1000 - daWall(m).share) < 2, m + ' same force in SWD and DA');
  assert.ok(r.analysis.cases[0].offset.converged && r.checks.every(c => c.ok), r.checks.filter(c => !c.ok).map(c => c.msg).join('; '));
});

test('Ex 8.4 linked, SW5 with heavier nailing: equal demand / capacity on SW5 and SW6 in SWD; SW7 keeps section B force; closes', () => {
  const { r, swdWalls, daWall } = linked84({ sw5: { nailingPattern: '3' } });
  const dc = m => { const w = swdWalls.find(x => x.mark === m); return w.unitShear_seismic / w.effectiveSeismicCap; };
  assert.ok(Math.abs(dc('SW5') - dc('SW6')) < 1e-3, dc('SW5') + ' / ' + dc('SW6'));
  // SW7 alone takes section B's half of Diaphragm 5's reaction, which moves a little with TD1's strut force
  assert.ok(Math.abs(daWall('SW7').share - 9327) < 150, String(daWall('SW7').share));
  assert.ok(Math.abs(r.lineForces.find(l => l.swdLineId === 'ln-E2').E * 1000 - daWall('SW7').share) < 1e-6);
  assert.ok(r.analysis.cases[0].offset.converged && r.checks.every(c => c.ok), r.checks.filter(c => !c.ok).map(c => c.msg).join('; '));
});

test('several SWD lines on one continuous part of a grid ("E 4-6", "E 6-7"): warned (one diaphragm force split by SWD shares); a wall outside its span is warned', () => {
  const { inputs, swd } = linked84({ names: ['E 4-6', 'E 6-7'], lengths: { 'ln-E1': 40, 'ln-E2': 25 } });
  inputs.wallLink.groups = [];
  const r = calcAll(inputs, { wallSource: swd });
  assert.ok(r.warnings.some(w => w.code === 'link-wall-span' && /SW6/.test(w.msg)), 'SW6 (75-125) runs past E 4-6 (60-100)');
  assert.ok(r.warnings.some(w => w.code === 'swd-lines-one-part' && /E 4-6, E 6-7/.test(w.msg)), r.warnings.map(w => w.code).join(', '));
});

test('Setup → Shear wall link: grid / span set by hand puts a line on its stretch (a line named "E2" → grid E, 8 to 9)', () => {
  const { inputs, swd } = linked84({ names: ['E 4-7', 'E2'], lengths: { 'ln-E2': 25 } });
  let r = calcAll(inputs, { wallSource: swd });
  assert.ok(r.errors.some(e => e.code === 'link-grid' && /"E2"/.test(e.msg)), r.errors.map(e => e.msg).join(' | '));
  const id = n => inputs.grids.find(g => g.name === n).id;
  inputs.wallLink.lineGrid = { 'ln-E2': { gridId: id('E'), fromId: id('8'), toId: id('9') } };
  r = calcAll(inputs, { wallSource: swd });
  const l = r.wallLink.lines.find(x => x.lineId === 'ln-E2');
  assert.equal(l.grid, 'E'); assert.deepEqual(l.span, [145, 170]); assert.equal(l.gridHow, 'set');
  assert.ok(!r.errors.some(e => /^link-/.test(e.code)), r.errors.map(e => e.msg).join(' | '));
});

// Ex 3.3 with its walls in an SWD item: offset line B/C = whole SWD lines B and C (SW1; SW3 + SW4), the case option B
// is for; the load as seismic (1.0E) so both distribution methods apply
function linked33({ sw1 = {}, distribution = '' } = {}) {
  const def = swdDefaults();
  const roof = def.levels[0]; roof.name = 'Roof'; def.levels = [roof];
  const proto = clone(def.directions[0].lines[0].walls[0] || {});
  const W = (id, mark, pos, len, extra = {}) => ({ ...clone(proto), id, mark, levelId: roof.id, position: pos, length: len, ...extra });
  def.directions = [{ ...clone(def.directions[0]), id: 'dir-ew', name: 'E-W', lines: [
    { id: 'ln-A', name: 'A', totalLength: 0, levelLoads: {}, walls: [W('w2', 'SW2', 30, 10)] },
    { id: 'ln-B', name: 'B', totalLength: 0, levelLoads: {}, walls: [W('w1', 'SW1', 0, 8, sw1)] },
    { id: 'ln-C', name: 'C', totalLength: 0, levelLoads: {}, walls: [W('w3', 'SW3', 32, 8), W('w4', 'SW4', 85, 15)] },
  ] }];
  if (distribution) def.directions[0].lines.forEach(l => { l.distribution = distribution; });
  const inputs = bookToInputs(JSON.parse(fs.readFileSync(new URL('./td-book/Ex3.3.json', import.meta.url), 'utf8')));
  inputs.loads[0].kind = 'E';
  inputs.walls = []; inputs.level = { name: 'Roof', fx: '' }; inputs.refs = { wallSource: 'swd-1' };
  inputs.wallLink = { dirMap: { 'dir-ew': 'x' }, origins: {}, groups: [{ id: 'g1', name: 'B/C', lineIds: ['ln-B', 'ln-C'], exclude: [] }] };
  const lw = linkedWalls(inputs, parsePlan(inputs), swdExtract(def));
  for (const l of lw.lines) def.directions[0].lines.find(x => x.id === l.lineId).totalLength = l.planLength;
  const swd = swdExtract(def);
  const r = calcAll(inputs, { wallSource: swd });
  const d2 = clone(def);
  for (const lf of r.lineForces) d2.directions[0].lines.find(x => x.id === lf.swdLineId).levelLoads = { [roof.id]: { seismic: String(lf.E || 0), wind: '0' } };
  const swdWalls = swdCalc(d2).perDirection[0].perLine.flatMap(l => l.perLevel[0].walls);
  return { r, swdWalls, plan: planWithLinks(inputs, { wallSource: swd }).plan, daWall: m => r.analysis.cases[0].lines.flatMap(l => l.walls || []).find(w => w.mark === m) };
}

test('linked offset line (Ex 3.3 B/C), same walls: split = the book\'s by wall length; every phase-7 value holds; closes', () => {
  const { r, plan } = linked33();
  assert.deepEqual(r.errors.map(e => e.msg), []);
  const o = r.analysis.cases[0].offset;
  assert.equal(o.groups[0].basis, 'capacity');
  assert.ok(o.converged && r.checks.every(c => c.ok), r.checks.filter(c => !c.ok).map(c => c.msg).join('; '));
  const b = JSON.parse(fs.readFileSync(new URL('./td-book/Ex3.3.json', import.meta.url), 'utf8'));
  const fails = b.expected.filter(e => e.phase === 7).filter(e => {
    const want = e.vTool ?? e.v, got = toolValue(e.k, plan, r.analysis), tol = e.tol ?? Math.max(0.005 * Math.abs(want), 1);
    return got === null || Math.abs(got - want) > tol;
  }).map(e => e.k);
  assert.deepEqual(fails, []);
});

test('linked offset line, capacity method: SW1 with heavier nailing takes more; Shear Wall Design given DA\'s line forces designs the same wall forces (equal demand / capacity on B and C)', () => {
  const { r, swdWalls, daWall } = linked33({ sw1: { nailingPattern: '3' } });
  const dc = m => { const w = swdWalls.find(x => x.mark === m); return w.unitShear_seismic / w.effectiveSeismicCap; };
  assert.ok(Math.abs(dc('SW1') - dc('SW3')) < 1e-3 && Math.abs(dc('SW3') - dc('SW4')) < 1e-3, [dc('SW1'), dc('SW3'), dc('SW4')].join(' / '));
  for (const m of ['SW1', 'SW3', 'SW4']) assert.ok(Math.abs(swdWalls.find(x => x.mark === m).shareExact_1E * 1000 - daWall(m).share) < 2, m + ' same force in SWD and DA');
  assert.ok(daWall('SW1').v > 1.8 * daWall('SW3').v, 'capacity 611 vs 312 plf');
  assert.ok(r.analysis.cases[0].offset.converged && r.checks.every(c => c.ok), r.checks.filter(c => !c.ok).map(c => c.msg).join('; '));
});

test('linked offset line, deflection method: equal δ on B and C in Shear Wall Design with DA\'s line forces; closes', () => {
  const { r, swdWalls, daWall } = linked33({ distribution: 'deflection' });
  assert.equal(r.analysis.cases[0].offset.groups[0].basis, 'deflection');
  const d = m => swdWalls.find(x => x.mark === m).deflection.E.delta;
  assert.ok(Math.abs(d('SW1') - d('SW3')) < 2e-3 && Math.abs(d('SW3') - d('SW4')) < 2e-3, [d('SW1'), d('SW3'), d('SW4')].join(' / '));
  for (const m of ['SW1', 'SW3', 'SW4']) assert.ok(Math.abs(swdWalls.find(x => x.mark === m).shareExact_1E * 1000 - daWall(m).share) < 5, m);
  const o = r.analysis.cases[0].offset;
  assert.ok(o.swdRounds.settled && o.converged && r.checks.every(c => c.ok), r.checks.filter(c => !c.ok).map(c => c.msg).join('; '));
});

test('Setup → Shear wall link: offset line card (name, lines, walls to leave out); TD warning points to it', () => {
  const { inputs, swd } = linked84();
  inputs.wallLink.groups = [];
  const box = document.createElement('div');
  const refs = { wallSource: swd };
  diaphragmAnalysis.renderForm(box, inputs, () => {}, [item('swd-1', 'shear_wall_design', swd.definition)], () => {}, {});
  const btn = t => [...box.querySelectorAll('button')].find(b => b.textContent.startsWith(t));
  btn('Setup').dispatchEvent(new window.Event('click'));
  btn('Shear wall link').dispatchEvent(new window.Event('click'));
  assert.ok(box.textContent.includes('Offset lines of resistance'));
  btn('+ Offset line').dispatchEvent(new window.Event('click'));
  assert.equal(inputs.wallLink.groups.length, 1);
  const r = calcAll(inputs, refs);
  assert.ok(r.tdRuns.some(t => (t.issues || []).some(i => i.code === 'td-load-wall-line' && /Offset lines of resistance/.test(i.msg))), 'TD1 on line D points to the setting');
});

console.log(passed + ' passed');
