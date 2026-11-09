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
const { diaphragmAnalysis, calcAll, planWithLinks, blocksCase } = await import('../src/modules/diaphragmAnalysis.js');
const V = await import('../src/modules/tdViews.js');
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
  click('TD v_TD');
  assert.ok(box.textContent.includes('View 2 — TD unit shear') && box.querySelectorAll('g.td-view rect').length >= 6);
  click('Net v_net');
  assert.equal(box.querySelectorAll('g.td-view rect').length, 16, 'View 3: 6 × 3 cells less the 2 in the opening');
  click('Members N');
  const polys = box.querySelectorAll('g.td-view polygon').length;
  assert.ok(polys > 20 && box.textContent.includes('Closure residual'));
  const cb = [...box.querySelectorAll('input[type=checkbox]')].find(x => x.parentNode.textContent.includes('across the span'));
  cb.checked = false; cb.dispatchEvent(new window.Event('change'));
  assert.ok(box.querySelectorAll('g.td-view polygon').length < polys, 'filter hides the cross members');
  click('Checks');
  assert.ok(box.textContent.includes('Analysis checks') && box.textContent.includes('member runs close'));
});

test('Analysis tab: zoom shared by the views (more values when zoomed, Fit resets), hover values, legend, outlines without fill', () => {
  const open = (id, edit) => {
    const inputs = bookToInputs(book(id));
    inputs.tds.forEach(t => { t.engineer.cantileverOk = true; });
    if (edit) edit(inputs);
    const b = document.createElement('div');
    diaphragmAnalysis.renderForm(b, inputs, () => {}, [], () => {}, {});
    return b;
  };
  let box = open('Ex4.2');
  const click = t => [...box.querySelectorAll('button')].find(b => b.textContent === t).dispatchEvent(new window.Event('click'));
  const texts = () => box.querySelectorAll('g.td-view text').length;
  click('Analysis');
  click('Net v_net');
  const n1 = texts();
  for (let i = 0; i < 4; i++) click('+');
  assert.ok(box.textContent.includes('244 %'), 'zoom readout');
  assert.ok(texts() > n1, `zoomed in shows more values (${n1} → ${texts()})`);
  box = open('Ex3.4');
  click('Analysis');
  for (let i = 0; i < 4; i++) click('+');
  click('Members N');
  assert.ok(box.textContent.includes('244 %'), 'zoom kept when switching view');
  assert.ok([...box.querySelectorAll('g.td-view text')].some(t => t.textContent === 'C 3,225'), 'N at the wall end SW1 (y = 40) labelled at zoom ≥ 200 %');
  assert.ok([...box.querySelectorAll('g.td-view polygon title')].some(t => /^2: N C/.test(t.textContent)), 'hover read-out on the member diagram');
  click('Fit');
  assert.ok(box.textContent.includes('100 %'));
  // legend: the view's scale and the plan symbols; TDs as outlines (no fill) in result views
  assert.ok(box.querySelector('.td-scale').textContent.includes('largest |N| 5,775 lb'));
  assert.ok(box.querySelector('.td-legend').textContent.includes('transfer diaphragm (TD)'));
  click('Basic v_b');
  assert.ok(box.querySelector('.td-scale').textContent.includes('+115.5 plf'));
  assert.ok([...box.querySelectorAll('g.td-view1 rect title')].some(t => t.textContent.startsWith('v_b 115.5')), 'hover read-out on a shear cell');
  assert.ok(![...box.querySelectorAll('svg rect')].some(r => /245, 158, 11/.test(r.getAttribute('fill') || '')), 'no amber TD fill over the results');
  assert.ok(!box.querySelector('.td-notice'), 'every TD ran');
  // the Plan tab carries the symbol legend too
  click('Plan');
  assert.ok(box.querySelector('.td-legend').textContent.includes('selected'));
});

test('Analysis tab: text size A− / A+, max tension and compression per run, mouse read-out on the plan and on a member line', () => {

  const { r, plan } = run('Ex3.4');
  const cs = r.analysis.cases[0];
  // read-out: line 2 (x = 15) at y = 50, along SW1 → N = C 4,500 (−3225 − 127.5 × 10); the nearest line wins
  const d4 = V.drawMembers(plan, cs, undefined, { zoom: 1, panX: 0, panY: 0 });
  const ro = V.readoutAt(plan, cs, d4.view, 4, d4.view.sx(15) + 4, d4.view.sy(50));
  assert.ok(ro && ro.text.startsWith('2 at y 50: N = C 4,500'), ro && ro.text);
  assert.equal(V.readoutAt(plan, cs, d4.view, 4, d4.view.sx(45), d4.view.sy(50)), null, 'nothing away from a line');
  const ro3 = V.readoutAt(plan, cs, d4.view, 3, d4.view.sx(40), d4.view.sy(70));
  assert.ok(ro3.text.startsWith('v_net 48.3 plf · x 40, y 70'), ro3.text); // 98.25 at grid 2 → −21.75 at grid 3, linear
  // line A has compression only; line B tension only; both maxima labelled where they exist
  const labels = [...d4.svg.querySelectorAll('g.td-view text')].map(t => t.textContent);
  assert.ok(labels.includes('max C 1,580') && labels.includes('max T 3,465') && labels.includes('max C 5,775'));
  const box = document.createElement('div');
  const inputs = bookToInputs(book('Ex3.4'));
  inputs.tds.forEach(t => { t.engineer.cantileverOk = true; });
  diaphragmAnalysis.renderForm(box, inputs, () => {}, [], () => {}, {});
  const click = t => [...box.querySelectorAll('button')].find(b => b.textContent === t).dispatchEvent(new window.Event('click'));
  click('Analysis'); click('Members N');
  const size = () => Number(box.querySelector('g.td-view text').getAttribute('font-size'));
  const s0 = size();
  click('A+');
  assert.ok(size() > s0 && box.textContent.includes('text 144 %'), 'larger text');
  assert.ok(box.textContent.includes('Max tension (lb)') && box.textContent.includes('Max compression (lb)'));
  assert.ok(box.querySelector('g.td-readout'), 'read-out layer');
});

test('gate: a TD that did not run pauses its case — no TD / net / member results, Checks PAUSED (not failed), basic shear and line forces kept (Ex 3.4)', () => {
  const inputs = bookToInputs(book('Ex3.4')); // cantilever not reviewed: TD1 waits
  const r = calcAll(inputs), cs = r.analysis.cases[0];
  assert.deepEqual(cs.paused.map(p => [p.mark, p.terminal]), [['TD1', 'ENGINEER_INPUT:S062']]);
  assert.ok(!r.checks.some(c => !c.ok && !c.warn), 'nothing reported as failed');
  assert.ok(!r.checks.some(c => c.code === 'closure'), 'no closure verdict on an incomplete field');
  assert.ok(r.checks.some(c => c.code === 'paused' && c.msg.includes('PAUSED — TD TD1 awaits the cantilever review')));
  assert.ok(r.checks.some(c => c.code === 'equilibrium' && c.ok), 'equilibrium still checked');
  const box = document.createElement('div');
  diaphragmAnalysis.renderForm(box, inputs, () => {}, [], () => {}, {});
  const click = t => [...box.querySelectorAll('button')].find(b => b.textContent === t).dispatchEvent(new window.Event('click'));
  click('Analysis');
  assert.ok(box.querySelector('.td-paused').textContent.includes('basic shear and line forces below are valid'));
  assert.ok(box.querySelector('g.td-view1') && box.textContent.includes('Σ line forces 15,000 lb ✓'), 'View 1 still drawn');
  for (const v of ['TD v_TD', 'Net v_net', 'Members N']) {
    click(v);
    assert.ok(box.querySelector('.td-paused').textContent.startsWith('PAUSED — TD TD1 awaits the cantilever review'), v);
    assert.ok(!box.querySelector('g.td-view') && !box.textContent.includes('Closure residual'), v + ': nothing drawn');
  }
  // the review lifts the gate; "limits not met" stops it
  inputs.tds[0].engineer.cantileverOk = true;
  assert.equal(calcAll(inputs).analysis.cases[0].paused.length, 0);
  inputs.tds[0].engineer.cantileverOk = false;
  const st = calcAll(inputs).analysis.cases[0].paused;
  assert.ok(st.length && st[0].reason.startsWith('stopped'), st[0] && st[0].reason);
  // a TD with no disrupted force adds nothing: it does not pause its case (Ex 3.3 with SW1 on its own line B)
  const u = bookToInputs(book('Ex3.3')); u.walls.find(w => w.mark === 'SW1').line = 'B';
  assert.equal(calcAll(u).analysis.cases[0].paused.length, 0);
  assert.ok(blocksCase({ terminal: 'NOT_RUN', issues: [{ code: 'td-geometry' }] }) && !blocksCase({ terminal: 'NOT_RUN', issues: [{ code: 'td-no-load' }] }));
});

console.log(passed + ' passed');
