// Diaphragm Analysis — Phase 4: loads, span beams, basic unit shear, line forces, wall shares, View 1.
// Book: every phase-4 value of the 7 examples (wall-line forces, wall shares, section shears, basic unit shears).
// Statics: ΣR = total load, v·d = V, closed forms (simple span, overhang), band split at openings, wall-less
// support lines into TDs, load cases (E / W), B4 (Shear Wall Design shares = SWD's own run), View 1 / Verification.
// Run: node tests/diaphragmAnalysisBasic.test.mjs
import assert from 'assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

if (!globalThis.document) {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window, document, Node: window.Node });
}
const { getModule } = await import('../src/modules/registry.js');
const { parsePlan, sheathedArea, depthAt } = await import('../src/modules/tdGeometry.js');
const { loadCases, analyseCase, lineForces, sectionAt } = await import('../src/modules/tdBasicShear.js');
const { toolValue } = await import('../src/modules/tdBookKeys.js');
const { defaultInputs, newLoad, newSegment, newDiaphragm } = await import('../src/modules/tdModel.js');
const { normalizeInputs } = await import('../src/modules/tdMigrate.js');
const { diaphragmAnalysis, calcAll, planWithLinks } = await import('../src/modules/diaphragmAnalysis.js');
const { swdExtract } = await import('../src/modules/tdWallLink.js');
const { calcAll: swdCalcAll } = await import('../src/modules/shearWallCalc.js');
const { bookToInputs } = await import('./td-book/src/toInputs.mjs');

const swdMod = getModule('shear_wall_design');
const book = id => JSON.parse(fs.readFileSync(new URL('./td-book/' + id + '.json', import.meta.url), 'utf8'));
const BOOKS = ['Ex3.3', 'Ex3.4', 'Ex3.5', 'Ex4.1', 'Ex4.2', 'Ex4.3', 'Ex5.1'];
const clone = v => JSON.parse(JSON.stringify(v));
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; }
}

// ---------------------------------------------------------------- book
test('book: every phase-4 value of the 7 examples (line forces, wall shares, V, v_b) through calcAll', () => {
  const fails = [];
  let n = 0;
  for (const id of BOOKS) {
    const b = book(id), inputs = bookToInputs(b);
    const r = calcAll(inputs);
    assert.equal(r.status, 'ok', id + ': ' + r.errors.map(e => e.msg).join('; '));
    const plan = planWithLinks(inputs).plan;
    for (const e of b.expected.filter(x => x.phase === 4)) {
      n++;
      const want = e.vTool ?? e.v, got = toolValue(e.k, plan, r.analysis);
      const tol = e.tol ?? Math.max(0.005 * Math.abs(want), 0.5);
      if (got === null || Number.isNaN(got) || Math.abs(got - want) > tol) fails.push(`${id} ${e.k}: tool ${got} book ${want}`);
    }
  }
  assert.ok(n >= 80, 'phase-4 values: ' + n);
  assert.deepEqual(fails, []);
});

test('book: the Verification tab compares phase-4 values — none differ', () => {
  for (const id of ['Ex4.1', 'Ex3.4']) {
    const inputs = bookToInputs(book(id));
    const box = document.createElement('div');
    diaphragmAnalysis.renderForm(box, inputs, () => {}, [], () => {}, {});
    assert.match(box.textContent, / ok, 0 differ, /, id);
  }
});

// ---------------------------------------------------------------- statics
const caseOf = (inputs, i = 0) => { const plan = parsePlan(inputs); const lc = loadCases(plan)[i]; const fx = Number(inputs.level.fx);
  const cs = analyseCase(plan, lc, { q: fx * 1000 / sheathedArea(plan) }); cs.lines = lineForces(plan, cs).lines; return { plan, cs }; };
function notchedPlan() {
  const inp = defaultInputs(); // 100 × 50, grids 1 / 2 (x), A / B (y), seismic −y and +x
  inp.outline = [[0, 0], [100, 0], [100, 50], [30, 50], [30, 35], [0, 35]].map(([x, y]) => ({ x: String(x), y: String(y) }));
  inp.openings = [{ id: 'op1', name: '', x1: '55', x2: '70', y1: '15', y2: '30' }];
  inp.level.fx = '40';
  return inp;
}

test('ΣR = total load and v·d = V at random sections (notch + opening, both directions)', () => {
  const inp = notchedPlan();
  for (const i of [0, 1]) {
    const { plan, cs } = caseOf(inp, i);
    const total = cs.diaphragms.reduce((t, d) => t + d.load, 0);
    assert.ok(close(total * cs.sigma, 40000, 1e-9), 'load = q ΣA = F_x');
    assert.ok(close(cs.lines.reduce((t, l) => t + l.P, 0), 40000, 1e-9), 'Σ line forces = F_x');
    for (let k = 0; k < 25; k++) {
      const d = cs.diaphragms[0], s = d.lo + (d.hi - d.lo) * (0.013 + 0.97 * k / 25);
      const sec = sectionAt(cs, s);
      const dep = depthAt(plan, cs.axis, s);
      for (const b of sec.parts[0].bands) assert.ok(close(b.v * (b.hi - b.lo), b.V, 1e-9));
      if (sec.parts[0].bands.length === 1) assert.ok(close(sec.V / dep, sec.parts[0].bands[0].v, 1e-9));
    }
  }
});

test('closed forms: simple span w L / 2 and V = w (L/2 − x); overhang reactions by statics', () => {
  const inp = defaultInputs();
  inp.loads = [Object.assign(newLoad('-y', 'line'), { segments: [newSegment(0, 100, 300)] })];
  let { cs } = caseOf(inp);
  assert.deepEqual(cs.lines.map(l => Math.round(l.P)).sort(), [15000, 15000]);
  for (const x of [10, 37.5, 80]) assert.ok(close(sectionAt(cs, x).V, 300 * (50 - x), 1e-9), 'V at ' + x);
  // supports at x = 20 and 100 (grid 1 moved): 300 plf over 0–100 → R(20) = 30000 · 50 / 80
  inp.grids.find(g => g.name === '1').at = '20';
  inp.grids.push({ id: 'g0', name: '0', axis: 'x', at: '0', ref: false });
  ({ cs } = caseOf(inp));
  const R1 = cs.lines.find(l => l.name === '1').P, R2 = cs.lines.find(l => l.name === '2').P;
  assert.ok(close(R1, 30000 * 50 / 80) && close(R2, 30000 * 30 / 80), R1 + ' / ' + R2);
  assert.ok(close(sectionAt(cs, 20, '-').V, -6000) && close(sectionAt(cs, 20, '+').V, -6000 + R1), 'overhang shear and the jump at the support');
});

test('opening bands: loads in proportion to width → same v in every band for any split; edge loads follow the split section', () => {
  const inp = notchedPlan();
  for (const split of ['', 'low', 'high', 'mid']) {
    inp.diaphragms.find(d => d.dir === 'y').bandSplit = split;
    const { cs } = caseOf(inp);
    const sec = sectionAt(cs, 62);
    assert.equal(sec.parts[0].bands.length, 2);
    assert.ok(close(sec.parts[0].bands[0].v, sec.parts[0].bands[1].v, 1e-9), split);
  }
  // Ex 5.1 (edge loads): auto (= the high end, smaller |V|) gives the book's 463 / 373 at grid 3; 'mid' differs; Σ bands = V
  const b = bookToInputs(book('Ex5.1'));
  const at3 = split => { b.diaphragms[0].bandSplit = split; const { plan, cs } = caseOf(b); const g3 = plan.grids.find(g => g.name === '3'); return sectionAt(cs, g3.at); };
  const hi = at3(''), mid = at3('mid');
  assert.deepEqual(at3('high').parts[0].bands.map(x => x.v), hi.parts[0].bands.map(x => x.v), 'auto = high end here');
  assert.ok(Math.abs(hi.parts[0].bands.find(x => x.lo > 30).v - 463) < 0.1);
  assert.ok(close(mid.parts[0].bands.find(x => x.lo > 30).v, mid.parts[0].bands.find(x => x.lo < 30).v, 1e-9), 'mid: equal v at mid-opening');
  for (const s of [hi, mid]) assert.ok(close(s.parts[0].bands.reduce((t, x) => t + x.V, 0), s.V, 1e-9));
});

test('a support line without a wall goes into the TD it loads (Ex 3.4), or is flagged when there is none', () => {
  const inputs = bookToInputs(book('Ex3.4'));
  let r = calcAll(inputs);
  const cs = r.analysis.cases[0];
  const l1 = cs.lines.find(l => l.name === '1');
  assert.ok(Math.abs(l1.P) < 1e-6);
  assert.deepEqual(l1.into, ['TD1']);
  assert.ok(cs.lines.find(l => l.name === '2').from.some(f => /TD TD1 from line 1/.test(f.src) && Math.round(f.F * cs.sigma) === 5775));
  inputs.tds = [];
  r = calcAll(inputs);
  assert.ok(r.warnings.some(w => w.code === 'line-no-wall' && /Line 1/.test(w.msg)));
});

test('load cases: seismic (F_x / ΣA) and wind line load along the same direction are separate cases', () => {
  const inp = defaultInputs();
  inp.level.fx = '20';
  inp.loads.push(Object.assign(newLoad('-y', 'line'), { segments: [newSegment(0, 100, 100)] }));
  const r = calcAll(inp);
  const ids = r.analysis.cases.map(c => c.id);
  assert.deepEqual(ids, ['y-E', 'y-W', 'x-E']);
  const E = r.analysis.cases.find(c => c.id === 'y-E'), W = r.analysis.cases.find(c => c.id === 'y-W');
  assert.equal(Math.round(E.lines.reduce((t, l) => t + l.P, 0)), 20000);
  assert.equal(Math.round(W.lines.reduce((t, l) => t + l.P, 0)), 10000);
  inp.loads[2].kind = 'E';
  assert.equal(Math.round(calcAll(inp).analysis.cases.find(c => c.id === 'y-E').lines.reduce((t, l) => t + l.P, 0)), 30000, 'kind E joins the seismic case');
});

test('stored data: kind and bandSplit are normalised onto older items; constructors carry them', () => {
  const old = defaultInputs();
  delete old.loads[0].kind; delete old.diaphragms[0].bandSplit;
  const n = normalizeInputs(clone(old));
  assert.equal(n.loads[0].kind, ''); assert.equal(n.diaphragms[0].bandSplit, '');
  assert.equal(newDiaphragm('D', 'y', 0, 1, 0, 1).bandSplit, '');
});

// ---------------------------------------------------------------- B4: Shear Wall Design shares
function swdCase() {
  let saved = null;
  const c = document.createElement('div');
  swdMod.renderForm(c, null, (x) => { saved = clone(x); }, [], () => {});
  [...c.querySelectorAll('button')].find(b => /Calculate/.test(b.textContent)).dispatchEvent(new window.Event('click'));
  const def = saved, roof = def.levels[0];
  roof.name = 'Roof';
  const ns = def.directions[0];
  ns.name = 'N-S';
  const w0 = (ns.lines[0] && ns.lines[0].walls[0]) || {};
  ns.lines = [
    { ...clone(ns.lines[0] || {}), id: 'ln-a', name: '1', totalLength: 50, levelLoads: {}, walls: [
      { ...clone(w0), id: 'w-a', mark: 'SW-1', levelId: roof.id, position: 5, length: 20 },
      { ...clone(w0), id: 'w-b', mark: 'SW-2', levelId: roof.id, position: 30, length: 8 }] },
    { ...clone(ns.lines[0] || {}), id: 'ln-b', name: '2', totalLength: 50, levelLoads: {}, walls: [
      { ...clone(w0), id: 'w-c', mark: 'SW-3', levelId: roof.id, position: 0, length: 50 }] },
  ];
  def.directions = [ns];
  return def;
}

test('B4: DA wall shares on a linked line = the ratio Shear Wall Design\'s own calcAll gives after its DA link update', () => {
  const swdDef = swdCase();
  const da = defaultInputs();
  da.level = { name: 'Roof', fx: '30' };
  da.refs = { wallSource: 'swd-1' };
  da.loads = da.loads.filter(l => l.acts.endsWith('y'));
  da.diaphragms = da.diaphragms.filter(d => d.dir === 'y');
  const r = calcAll(da, { wallSource: swdExtract(swdDef) });
  assert.equal(r.status, 'ok', r.errors.map(e => e.msg).join('; '));
  const lf = r.lineForces.find(l => l.line === '1');
  assert.ok(close(lf.E, 15, 1e-9), 'line 1: 15 kip');
  const ln = r.analysis.cases[0].lines.find(l => l.name === '1');
  assert.ok(ln.walls.length === 2 && ln.walls.every(w => w.basis === 'swd'));
  assert.ok(close(ln.walls.reduce((t, w) => t + w.share, 0), 15000, 1e-9));
  // SWD applies the same line forces through its own link and calculates
  swdDef.refs = { diaphragmSources: ['da-1'] };
  const upd = swdMod.applyLinks(clone(swdDef), { diaphragmSources: [{ id: 'da-1', level: 'Roof', lineForces: r.lineForces }] });
  const res = swdCalcAll(upd);
  const pl = res.perDirection[0].perLine.find(l => l.lineId === 'ln-a').perLevel.find(p => p.levelId === swdDef.levels[0].id);
  const sum = pl.walls.reduce((t, w) => t + w.shareExact_1E, 0);
  assert.ok(close(sum, 15, 1e-3), 'SWD story shear at the roof = 15 kip');
  for (const w of pl.walls) {
    const mine = ln.walls.find(x => x.id === 'swd:' + w.wallId);
    assert.ok(close(mine.share / 15000, w.shareExact_1E / sum, 1e-6), w.mark);
  }
});

// ---------------------------------------------------------------- View 1
test('Analysis tab: View 1 painted per band, case buttons, line-force table with the equilibrium check', () => {
  const inputs = bookToInputs(book('Ex4.3'));
  const box = document.createElement('div');
  diaphragmAnalysis.renderForm(box, inputs, () => {}, [], () => {}, {});
  [...box.querySelectorAll('button')].find(b => b.textContent === 'Analysis').dispatchEvent(new window.Event('click'));
  const g = box.querySelector('g.td-view1');
  assert.ok(g && g.querySelectorAll('rect').length >= 5, 'bands painted');
  assert.ok(box.textContent.includes('View 1'));
  assert.ok(box.textContent.includes('Σ line forces 30,000 lb ✓'));
  assert.ok(box.textContent.includes('SW1 6,429'));
  assert.ok(box.textContent.includes('Opening x 0–16: inflection (opening-edge chords 0) at 0, bands share V by width at 0 — free end at the low end'));
});

console.log(passed + ' passed');
