// DA walls of the story above (user 2026-11-05, build step 5; read and drawn, no force yet) on project 26997
// (tests/fixtures/da-user/hov-*.json): the 2nd floor sees the Roof-story walls of SWD at the same line start; lines 2 / B / C
// end at this floor (transfer), line 3 continues (through); checks for the cases that need the engineer.
// Run: node tests/daWallsAbove.test.mjs
import assert from 'assert/strict';
import fs from 'fs';
import { parseHTML } from 'linkedom';

if (!globalThis.document) {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window, document, Node: window.Node });
}
const { getModule } = await import('../src/modules/registry.js');
const { swdExtract } = await import('../src/modules/tdWallLink.js');
const { normalizeInputs } = await import('../src/modules/tdMigrate.js');
const { calcAll, planWithLinks } = await import('../src/modules/diaphragmAnalysis.js');
const { drawPlan, newEditorState, renderPlanEditor } = await import('../src/modules/tdPlanEditor.js');

const swdMod = getModule('shear_wall_design');
const clone = v => JSON.parse(JSON.stringify(v));
const load = f => JSON.parse(fs.readFileSync(new URL('./fixtures/da-user/' + f, import.meta.url), 'utf8'));
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 5).join('\n       ')); process.exitCode = 1; }
}
const swdItem = load('hov-swd.json'), roofItem = load('hov-roof.json'), flrItem = load('hov-2nd.json');
// SWD as the user set it: DA items ticked, plan grids adopted, every line starting at grid 1 / grid A (0)
function swdDef({ ticked = true, adopted = true } = {}) {
  const inp = swdMod.migrate({ schemaVersion: swdItem.schemaVersion, inputs: clone(swdItem.inputs) }).inputs;
  inp.refs = { ...(inp.refs || {}) };
  if (ticked) inp.refs.diaphragmSources = [roofItem.id, flrItem.id]; else delete inp.refs.diaphragmSources;
  if (adopted) { inp.planLink = { sourceId: roofItem.id, grids: [], lines: {}, extents: {} }; inp.directions.forEach(d => d.lines.forEach(l => { l.planOrigin = '0'; })); }
  else { delete inp.planLink; inp.directions.forEach(d => d.lines.forEach(l => { delete l.planOrigin; })); }
  return inp;
}
const da = (item, def) => normalizeInputs(clone(item.inputs));
const run = (item, def) => calcAll(da(item, def), { wallSource: swdExtract(def) });
const codes = r => [...r.errors, ...r.warnings].map(e => e.code);

test('2nd floor: the 8 Roof-story walls at the same start — 2 / B / C end here (↓ transfer), 3 continues (↕ through)', () => {
  const r = run(flrItem, swdDef());
  const ab = r.wallsAbove;
  assert.equal(ab.level, 'Roof');
  const by = Object.fromEntries(ab.walls.map(w => [w.mark, w]));
  assert.deepEqual(Object.keys(by).sort(), ['SW-1', 'SW-11', 'SW-12', 'SW-13', 'SW-14', 'SW-3', 'SW-5', 'SW-7']);
  for (const m of ['SW-5', 'SW-7', 'SW-11', 'SW-12', 'SW-13', 'SW-14']) assert.equal(by[m].kind, 'transfer', m);
  for (const m of ['SW-1', 'SW-3']) assert.equal(by[m].kind, 'through', m);
  // SW-11: line B (y 20), position 10, 10 ft → x 10–20; on the 2nd-floor sheathing (x 0–70)
  assert.equal(by['SW-11'].at, 20); assert.equal(by['SW-11'].from, 10); assert.equal(by['SW-11'].to, 20); assert.ok(by['SW-11'].onSheathing);
  assert.ok(codes(r).includes('above-type4'));
  assert.ok(!codes(r).includes('above-linkback') && !codes(r).includes('above-origin') && !codes(r).includes('above-off-plan'));
  assert.equal(r.status === 'fail' ? r.errors.filter(e => /^above-/.test(e.code)).length : 0, 0, 'no error from the walls above');
});

test('Roof (top level): nothing above', () => {
  const r = run(roofItem, swdDef());
  assert.deepEqual(r.wallsAbove.walls, []);
  assert.ok(!codes(r).some(c => /^above-/.test(c)));
});

test('mixed line: SW-1 ticked "ends at this floor" in SWD → transfer here; SW-3 stays through', () => {
  const def = swdDef();
  def.directions.flatMap(d => d.lines).find(l => l.name === '3').walls.find(w => w.mark === 'SW-1').endsAtFloor = true;
  const by = Object.fromEntries(run(flrItem, def).wallsAbove.walls.map(w => [w.mark, w.kind]));
  assert.equal(by['SW-1'], 'transfer'); assert.equal(by['SW-3'], 'through');
});

test('checks: SWD without this DA ticked (above-linkback), grids not adopted (above-origin), a wall off the sheathing (above-off-plan)', () => {
  assert.ok(codes(run(flrItem, swdDef({ ticked: false }))).includes('above-linkback'));
  assert.ok(codes(run(flrItem, swdDef({ adopted: false }))).includes('above-origin'));
  const def = swdDef();
  def.directions.flatMap(d => d.lines).find(l => l.name === 'B').planOrigin = '65'; // SW-11 → x 75–85, past x 70
  const r = run(flrItem, def);
  const off = [...r.warnings].find(w => w.code === 'above-off-plan' && /SW-11/.test(w.msg));
  assert.ok(off, codes(r).join(','));
});

test('drawn: dashed beside the grid (amber ↓ / grey ↕), "Walls above" filter; table on the Shear walls page', () => {
  const def = swdDef();
  const inputs = da(flrItem, def);
  const { plan } = planWithLinks(inputs, { wallSource: swdExtract(def) });
  const st = newEditorState();
  let svg = drawPlan(plan, st, []).svg;
  const g = [...svg.querySelectorAll('[data-above]')];
  assert.equal(g.length, 8);
  assert.equal(g.filter(x => x.getAttribute('data-kind') === 'transfer').length, 6);
  st.layers.above = false;
  assert.equal(drawPlan(plan, st, []).svg.querySelectorAll('[data-above]').length, 0, 'hidden by the filter');
  const st2 = newEditorState(); st2.page = 'walls';
  const c = document.createElement('div');
  c.appendChild(renderPlanEditor({ inputs, plan, errors: [], state: st2, refresh() {}, wallsLinked: true }));
  assert.ok(c.querySelector('input[data-layer="above"]'), 'filter box only when there are walls above');
  const rows = c.querySelectorAll('table[data-abovetable] tr');
  assert.equal(rows.length, 9, 'header + 8 walls');
  assert.match(c.querySelector('table[data-abovetable]').textContent, /↓ into this diaphragm/);
  // a plan with nothing above has no extra filter box (the Plan tab filter stays 3 boxes)
  const c2 = document.createElement('div');
  c2.appendChild(renderPlanEditor({ inputs: da(roofItem, def), plan: planWithLinks(da(roofItem, def), { wallSource: swdExtract(def) }).plan, errors: [], state: newEditorState(), refresh() {}, wallsLinked: true }));
  assert.equal(c2.querySelectorAll('input[data-layer]').length, 3);
});

test('highlight (user 2026-11-05): a wall picked in the Shear walls tables or on the plan gets a halo; walls above too; no Delete for SWD walls', () => {
  const def = swdDef();
  const inputs = da(flrItem, def);
  const { plan } = planWithLinks(inputs, { wallSource: swdExtract(def) });
  const st = newEditorState(); st.page = 'walls';
  const render = () => { const c = document.createElement('div'); c.appendChild(renderPlanEditor({ inputs, plan, errors: [], state: st, refresh() {}, wallsLinked: true })); return c; };
  let c = render();
  assert.equal(c.querySelectorAll('[data-selhalo]').length, 0, 'nothing picked: no halo');
  // pick SW-15 (a wall of this level) in its table row
  const row = [...c.querySelectorAll('tr[data-selrow^="wall:"]')].find(r => /SW-15/.test(r.textContent));
  row.dispatchEvent(new window.Event('click'));
  c = render();
  assert.equal(st.sel.kind, 'wall');
  assert.equal(c.querySelectorAll('[data-selhalo]').length, 1, 'halo on SW-15');
  assert.ok(c.querySelector('[data-wall="SW-15"] [data-selhalo]'));
  assert.ok(![...c.querySelectorAll('button')].some(b => b.textContent === 'Delete selected'), 'no Delete for an SWD wall');
  // pick SW-11 of the story above in its table row
  const arow = [...c.querySelectorAll('table[data-abovetable] tr[data-selrow]')].find(r => /SW-11/.test(r.textContent));
  arow.dispatchEvent(new window.Event('click'));
  c = render();
  assert.equal(st.sel.kind, 'above');
  assert.ok(c.querySelector('[data-above="SW-11"] [data-selhalo]'), 'halo on SW-11 (above)');
  assert.ok(c.querySelector('tr[data-selrow="above:above:' + st.sel.id.slice(6) + '"]') || c.querySelector('tr[data-selrow="above:' + st.sel.id + '"]'), 'its row highlighted');
  // a click on the plan picks a wall above too
  const g = c.querySelector('[data-above="SW-13"]');
  g.dispatchEvent(new window.Event('click'));
  assert.equal(st.sel.kind, 'above'); assert.match(st.sel.id, /^above:/);
});

test('no diaphragm drawn (the 26997 items as saved): the walls above change no line force (nothing can carry them)', () => {
  const def = swdDef();
  const r = run(flrItem, def);
  const base = calcAll(da(flrItem, def), { wallSource: { ...swdExtract(def), levels: swdExtract(def).levels.slice(1) } });
  assert.deepEqual(r.lineForces, base.lineForces);
});

console.log(passed + ' passed');
