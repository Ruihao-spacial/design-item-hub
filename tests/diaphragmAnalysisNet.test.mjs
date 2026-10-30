// Diaphragm Analysis — Phase 6: TD field, net field, members on every line (net field), checks, Views 2–4.
// Book: every phase-6 value (TD reactions / shears, net shears, member forces and maxima, aspect, wall shares).
// Every member run of the book examples closes; the skill's TD edge forces = the integrator's; without the TDs the
// basic field does not close (the book's point); wall lines across an opening (strut) vs a notch; seismic flag.
// Run: node tests/diaphragmAnalysisNet.test.mjs
import assert from 'assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

if (!globalThis.document) {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window, document, Node: window.Node });
}
const { toolValue } = await import('../src/modules/tdBookKeys.js');
const { vNetAt, vtdAt, memberN } = await import('../src/modules/tdNet.js');
const { vAt } = await import('../src/modules/tdMembers.js');
const { lineParts } = await import('../src/modules/tdBasicShear.js');
const { defaultInputs, newLoad, newSegment } = await import('../src/modules/tdModel.js');
const { diaphragmAnalysis, calcAll, planWithLinks } = await import('../src/modules/diaphragmAnalysis.js');
const { bookToInputs } = await import('./td-book/src/toInputs.mjs');

const book = id => JSON.parse(fs.readFileSync(new URL('./td-book/' + id + '.json', import.meta.url), 'utf8'));
const BOOKS = ['Ex3.4', 'Ex3.5', 'Ex4.1', 'Ex4.2', 'Ex4.3', 'Ex5.1'];
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; }
}
const run = (id, edit) => {
  const inputs = bookToInputs(book(id));
  inputs.tds.forEach(t => { t.engineer.cantileverOk = true; });
  if (edit) edit(inputs);
  return { inputs, r: calcAll(inputs), plan: planWithLinks(inputs).plan };
};

test('book: every phase-6 value of the 6 examples (TD reactions / shears, net shears, member forces, maxima, aspect)', () => {
  const fails = [];
  let n = 0;
  for (const id of BOOKS) {
    const b = book(id), { r, plan } = run(id);
    for (const e of b.expected.filter(x => x.phase === 6)) {
      n++;
      const want = e.vTool ?? e.v, got = toolValue(e.k, plan, r.analysis);
      const tol = e.tol ?? Math.max(0.005 * Math.abs(want), 1);
      if (got === null || Number.isNaN(got) || Math.abs(got - want) > tol) fails.push(`${id} ${e.k}: tool ${got} book ${want}`);
    }
  }
  assert.equal(n, 242);
  assert.deepEqual(fails, []);
});

test('checks on the book examples: equilibrium, every member run closes, skill TD edge forces = integrator', () => {
  for (const id of BOOKS) {
    const { r } = run(id);
    const bad = r.checks.filter(c => !c.ok);
    assert.deepEqual(bad.map(c => c.msg), [], id);
    const edges = r.checks.filter(c => c.code === 'td-edges');
    assert.ok(edges.length && edges.every(c => /\(4 values\)/.test(c.msg)), id + ': edge forces compared');
    assert.ok(r.checks.some(c => c.code === 'closure' && /(\d+) of \1 member runs close/.test(c.msg)), id);
  }
});

test('without its TDs the basic field does not close (Ex 4.1) — the closure check reports the open lines', () => {
  const { r } = run('Ex4.1', i => { i.tds = []; });
  const c = r.checks.find(x => x.code === 'closure');
  assert.equal(c.ok, false);
  assert.match(c.msg, /open: .*B/);
});

test('net field: v_TD inside the TDs only; v_net = v_b + v_TD', () => {
  const { r, plan } = run('Ex4.1');
  const cs = r.analysis.cases[0];
  for (const [x, y] of [[7, 30], [7, 5], [20, 30], [42, 30], [42, 5], [100, 25]]) {
    const vb = vAt(cs, x, y), vt = vtdAt(cs.fields, x, y);
    assert.ok(close(vNetAt(cs, cs.fields, x, y), vb + vt, 1e-9));
    const inTd = plan.tds.some(t => x > t.x1 && x < t.x2 && y > t.y1 && y < t.y2);
    assert.equal(vt !== 0, inTd, `(${x}, ${y})`);
  }
});

test('integrator on a plain rectangle: chords ±M/d, every run closes, a full-length wall line carries nothing', () => {
  const inp = defaultInputs();
  inp.loads = [Object.assign(newLoad('-y', 'line'), { segments: [newSegment(0, 100, 240)] })];
  inp.diaphragms = inp.diaphragms.filter(d => d.dir === 'y');
  inp.walls = [{ id: 'w1', line: '1', mark: 'W1', gridId: inp.grids[0].id, from: '0', to: '50' }, { id: 'w2', line: '2', mark: 'W2', gridId: inp.grids[1].id, from: '0', to: '50' }];
  const r = calcAll(inp);
  const cs = r.analysis.cases[0];
  const chord = name => cs.members.find(m => m.name === name);
  for (const x of [10, 50, 80]) {
    const M = 12000 * x - 240 * x * x / 2;
    assert.ok(close(memberN(chord('B'), x), M / 50, 1e-6) && close(memberN(chord('A'), x), -M / 50, 1e-6), 'x = ' + x);
  }
  assert.ok(r.checks.every(c => c.ok), r.checks.filter(c => !c.ok).map(c => c.msg).join('; '));
  assert.ok(Math.abs(cs.members.find(m => m.name === '1').runs[0].max) < 1e-6);
});

test('wall lines: continuous across an opening inside the outline (Ex 4.3 line 1, strut), split at a notch (Ex 4.2 line C)', () => {
  let { r, plan } = run('Ex4.3');
  let cs = r.analysis.cases[0];
  const g1 = plan.grids.find(g => g.name === '1');
  assert.deepEqual(lineParts(plan, cs, g1), [[0, 56]]);
  assert.equal(cs.members.find(m => m.name === '1').runs.length, 1, 'one member across the opening');
  ({ r, plan } = run('Ex4.2'));
  cs = r.analysis.cases[0];
  const gC = plan.grids.find(g => g.name === 'C');
  assert.deepEqual(lineParts(plan, cs, gC), [[0, 15], [35, 150]]);
  const walls = cs.lines.find(l => l.name === 'C').walls;
  assert.ok(Math.abs(walls.find(w => w.mark === 'SW3').share - 713.36) < 0.5, 'SW3 takes its own part: 500 + 213.3');
});

test('seismic case with a TD: the collector amplification flag is reported', () => {
  const { r } = run('Ex4.1', i => { i.loads.forEach(l => { l.kind = 'E'; }); });
  assert.ok(r.checks.some(c => c.code === 'seismic' && /Ω₀/.test(c.msg)));
});

test('Analysis tab: Views 2–4 (TD shear, net shear, member diagrams with filter and table); Checks tab lists the checks', () => {
  const inputs = bookToInputs(book('Ex5.1'));
  const box = document.createElement('div');
  diaphragmAnalysis.renderForm(box, inputs, () => {}, [], () => {}, {});
  const click = t => [...box.querySelectorAll('button')].find(b => b.textContent === t).dispatchEvent(new window.Event('click'));
  click('Analysis');
  click('View 2 · TD shear');
  assert.ok(box.textContent.includes('View 2 — TD unit shear') && box.querySelectorAll('g.td-view rect').length >= 6);
  click('View 3 · net shear');
  assert.equal(box.querySelectorAll('g.td-view rect').length, 16, 'View 3: 6 × 3 cells less the 2 in the opening');
  click('View 4 · member forces');
  const polys = box.querySelectorAll('g.td-view polygon').length;
  assert.ok(polys > 20 && box.textContent.includes('Closure residual'));
  const cb = [...box.querySelectorAll('input[type=checkbox]')][1];
  cb.checked = false; cb.dispatchEvent(new window.Event('change'));
  assert.ok(box.querySelectorAll('g.td-view polygon').length < polys, 'filter hides the cross members');
  click('Checks');
  assert.ok(box.textContent.includes('Analysis checks') && box.textContent.includes('member runs close'));
});

console.log(passed + ' passed');
