// Diaphragm Analysis — Phase 7: offset wall lines, line forces iterated to closure (tdOffset.js).
// Book Ex 3.3: every phase-7 value of the corrected run; the book's first run (equal split wL/2) reproduced and shown
// not to close; the iteration converges from any start; walls group only by one wall line name on two or more grids;
// the other book examples are not touched; pass table on the Analysis tab, offset check on the Checks tab.
// Run: node tests/diaphragmAnalysisOffset.test.mjs
import assert from 'assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

if (!globalThis.document) {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window, document, Node: window.Node });
}
const { toolValue } = await import('../src/modules/tdBookKeys.js');
const { tdFrame } = await import('../src/modules/tdGeometry.js');
const { runTds } = await import('../src/modules/tdDerive.js');
const { lineGroups } = await import('../src/modules/tdBasicShear.js');
const { closes } = await import('../src/modules/tdNet.js');
const { offsetIterate } = await import('../src/modules/tdOffset.js');
const { diaphragmAnalysis, calcAll, planWithLinks, analyse } = await import('../src/modules/diaphragmAnalysis.js');
const { bookToInputs } = await import('./td-book/src/toInputs.mjs');

const book = id => JSON.parse(fs.readFileSync(new URL('./td-book/' + id + '.json', import.meta.url), 'utf8'));
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
const compare = (list, plan, an) => {
  const fails = [];
  for (const e of list) {
    const want = e.vTool ?? e.v, got = toolValue(e.k, plan, an);
    const tol = e.tol ?? Math.max(0.005 * Math.abs(want), 1);
    if (got === null || Number.isNaN(got) || Math.abs(got - want) > tol) fails.push(`${e.k}: tool ${got} book ${want}`);
  }
  return fails;
};
// One Ex 3.3 case evaluated from given line forces (load-direction sign), outside calcAll
const fromStart = (start, maxPasses) => {
  const inputs = bookToInputs(book('Ex3.3')), plan = planWithLinks(inputs).plan;
  const an = analyse(plan, null, null, null), cs = an.cases[0];
  const frames = new Map(plan.tds.map(t => [t.id, tdFrame(t)]));
  const it = offsetIterate(plan, cs, c => runTds(plan, c, frames, inputs.tds, {}), { frames, start, maxPasses });
  cs.offset = it.offset;
  return { plan, cs, it, analysis: { cases: an.cases, tdRuns: it.tdRuns } };
};

test('book Ex 3.3: every phase-7 value (line forces A and B/C, net shears, struts B, collectors A / C, transverse collectors)', () => {
  const b = book('Ex3.3'), { r, plan } = run('Ex3.3');
  const list = b.expected.filter(e => e.phase === 7);
  assert.equal(list.length, 22);
  assert.deepEqual(compare(list, plan, r.analysis), []);
  // between the book's exact closure (~4580) and its trial shift (4600)
  const RA = toolValue('R:A', plan, r.analysis);
  assert.ok(RA > 4579 && RA < 4601, 'R_A ' + RA);
  assert.equal(r.tdRuns[0].terminal, 'OUTPUT');
});

test('book Ex 3.3 first run: the equal split wL/2 gives the book\'s 37 values and does not close (~387 lb at grid 4 on A and C)', () => {
  const b = book('Ex3.3'), { plan, cs, it, analysis } = fromStart({ A: 5000, 'B/C': 5000 }, 0);
  assert.equal(b.expectedNonClosing.length, 37);
  assert.deepEqual(compare(b.expectedNonClosing, plan, analysis), []);
  assert.equal(it.offset.converged, false);
  const open = cs.members.filter(m => m.family === 'cross').flatMap(m => m.runs.filter(x => !closes(x)).map(x => [m.name, Math.round(x.residual)]));
  assert.deepEqual(open.sort(), [['A', 387], ['C', -387]]);
});

test('iteration: closes from the flexible start and from far starts (inside the closure tolerance of exact closure ~4580.5); equilibrium and wall shares by length across B/C', () => {
  const { r, plan } = run('Ex3.3');
  const cs = r.analysis.cases[0];
  assert.ok(cs.offset.converged && cs.offset.passes.length >= 2);
  assert.equal(cs.offset.passes[0].lines.find(l => l.name === 'B/C').P, 5210, 'pass 0 = flexible: 700 (B) + 4510 (C)');
  assert.ok(cs.offset.passes.every((p, i) => i === 0 || p.maxRes < cs.offset.passes[i - 1].maxRes), 'residual falls every pass');
  assert.ok(r.checks.find(c => c.code === 'offset').ok);
  assert.ok(r.checks.filter(c => c.code !== 'offset').every(c => c.ok), 'equilibrium, every member run closes');
  const sum = cs.lines.reduce((t, l) => t + l.P, 0);
  assert.ok(Math.abs(sum - 10000) < 1e-6);
  const BC = toolValue('R:B/C', plan, r.analysis);
  for (const [mark, len] of [['SW1', 8], ['SW3', 8], ['SW4', 15]]) assert.ok(Math.abs(toolValue('Rw:' + mark, plan, r.analysis) - BC * len / 31) < 1e-6, mark);
  for (const start of [{ A: 8000, 'B/C': 2000 }, { A: 1000, 'B/C': 9000 }]) {
    const { it, plan: p2, analysis } = fromStart(start);
    assert.ok(it.offset.converged, JSON.stringify(start));
    // stops once line A's residual ≤ 1 % of its max (~34 lb), i.e. R_A within ~37 lb of exact closure
    assert.ok(Math.abs(toolValue('R:A', p2, analysis) - 4580.5) < 40, 'R_A ' + toolValue('R:A', p2, analysis));
  }
});

test('groups: one wall line name on two or more grids only; other book examples and an ungrouped Ex 3.3 are not iterated', () => {
  const { plan, r } = run('Ex3.3');
  const gs = lineGroups(plan, r.analysis.cases[0]);
  assert.deepEqual(gs.map(g => [g.name, g.walls.map(w => w.mark)]), [['B/C', ['SW1', 'SW3', 'SW4']]]);
  for (const id of ['Ex3.4', 'Ex3.5', 'Ex4.1', 'Ex4.2', 'Ex4.3', 'Ex5.1']) {
    const x = run(id).r;
    assert.ok(x.analysis.cases.every(c => !c.offset) && !x.checks.some(c => c.code === 'offset'), id);
  }
  const u = run('Ex3.3', i => { i.walls.find(w => w.mark === 'SW1').line = 'B'; }).r;
  assert.ok(!u.analysis.cases[0].offset);
  assert.equal(u.analysis.cases[0].lines.find(l => l.name === 'B').P, 700, 'B keeps its own reaction');
});

test('Analysis tab: pass table under the line forces; Checks tab: offset check', () => {
  const inputs = bookToInputs(book('Ex3.3'));
  const box = document.createElement('div');
  diaphragmAnalysis.renderForm(box, inputs, () => {}, [], () => {}, {});
  const click = t => [...box.querySelectorAll('button')].find(b => b.textContent === t).dispatchEvent(new window.Event('click'));
  click('Analysis');
  assert.ok(box.textContent.includes('Offset wall lines — line forces iterated to closure'));
  assert.ok(box.textContent.includes('by length across B/C') && box.textContent.includes('P TD1 (lb)'));
  click('Checks');
  assert.ok(box.textContent.includes('offset wall line B/C') && box.textContent.includes('iterated to closure'));
});

console.log(passed + ' passed');
