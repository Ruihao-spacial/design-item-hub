// Diaphragm Analysis — Phase 5: opening rule (inflection / width split from the geometry), member forces on the basic
// field (book Nb values), each TD's skill inputs derived from the plan (= the skill's own T01–T08 inputs), TD engine
// runs on the drawn TDs (= the skill's expected outputs), cantilever review, mirrored overhang, TDs tab.
// Run: node tests/diaphragmAnalysisTd.test.mjs
import assert from 'assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

if (!globalThis.document) {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window, document, Node: window.Node });
}
const { tdFrame } = await import('../src/modules/tdGeometry.js');
const { sectionAt } = await import('../src/modules/tdBasicShear.js');
const { chordForce, crossForce } = await import('../src/modules/tdMembers.js');
const { deriveTd, CLOSURE_TOL } = await import('../src/modules/tdDerive.js');
const { toolValue } = await import('../src/modules/tdBookKeys.js');
const { defaultInputs, newLoad, newSegment } = await import('../src/modules/tdModel.js');
const { diaphragmAnalysis, calcAll, planWithLinks } = await import('../src/modules/diaphragmAnalysis.js');
const { bookToInputs } = await import('./td-book/src/toInputs.mjs');

const SUITE = JSON.parse(fs.readFileSync(new URL('./td-cases/skill-tests.json', import.meta.url), 'utf8'));
const book = id => JSON.parse(fs.readFileSync(new URL('./td-book/' + id + '.json', import.meta.url), 'utf8'));
const clone = v => JSON.parse(JSON.stringify(v));
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; }
}
const run = (id, edit) => { const inputs = bookToInputs(book(id)); if (edit) edit(inputs); return { inputs, r: calcAll(inputs), plan: planWithLinks(inputs).plan }; };

test('opening rule from the geometry: Ex 4.3 (opening at wall line 1) → free end; Ex 5.1 (TDs both sides) → Vierendeel', () => {
  let st = run('Ex4.3').r.analysis.cases[0].diaphragms[0].stretches;
  assert.equal(st.length, 1);
  assert.deepEqual([st[0].a, st[0].b, st[0].sInf, st[0].sRef], [0, 16, 0, 0]);
  assert.match(st[0].rule, /free end/);
  st = run('Ex5.1').r.analysis.cases[0].diaphragms[0].stretches;
  assert.deepEqual([st[0].a, st[0].b, st[0].sInf, st[0].sRef], [15, 39, 27, 39], 'inflection mid-opening (grid 3), width split at grid 4 (|V| 8200 < 13000)');
  // the engineer may move the width split; the inflection stays
  st = run('Ex5.1', i => { i.diaphragms[0].bandSplit = 'mid'; }).r.analysis.cases[0].diaphragms[0].stretches;
  assert.deepEqual([st[0].sInf, st[0].sRef], [27, 27]);
  assert.match(st[0].rule, /set by the user/);
});

test('book: every phase-5 value (basic-field chord / strut forces — the disrupted forces) of the 7 examples', () => {
  const fails = [];
  let n = 0;
  for (const id of ['Ex3.3', 'Ex3.4', 'Ex3.5', 'Ex4.1', 'Ex4.2', 'Ex4.3', 'Ex5.1']) {
    const b = book(id), { r, plan } = run(id);
    for (const e of b.expected.filter(x => x.phase === 5)) {
      n++;
      const want = e.vTool ?? e.v, got = toolValue(e.k, plan, r.analysis);
      const tol = e.tol ?? Math.max(0.005 * Math.abs(want), 1);
      if (got === null || Number.isNaN(got) || Math.abs(got - want) > tol) fails.push(`${id} ${e.k}: tool ${got} book ${want}`);
    }
  }
  assert.equal(n, 19);
  assert.deepEqual(fails, []);
});

test('member forces: a constant-depth chord by section (M/d) = the unit-shear integral from the free end', () => {
  const inp = defaultInputs();
  inp.loads = [Object.assign(newLoad('-y', 'line'), { segments: [newSegment(0, 100, 250)] })];
  const { cs } = (() => { const r = calcAll(inp); return { cs: r.analysis.cases[0] }; })();
  for (const s of [7, 31.5, 62, 93]) {
    let integral = 0;
    for (let k = 0; k < 2000; k++) { const x = (k + 0.5) * s / 2000; integral += sectionAt(cs, x).parts[0].bands[0].v * s / 2000; }
    assert.ok(close(chordForce(cs, 0, s).N, integral, 1e-5), 'bottom chord at ' + s);
    assert.ok(close(chordForce(cs, 50, s).N, -integral, 1e-5), 'top chord at ' + s);
    assert.equal(chordForce(cs, 25, s).N, 0, 'a line inside the band');
  }
  // a support line with a wall over its full length carries no collector force
  const { r, plan } = run('Ex4.1');
  const g1 = plan.grids.find(g => g.name === '1');
  for (const c of [5, 25, 45]) assert.ok(Math.abs(crossForce(r.analysis.cases[0], g1, c).N) < 1e-6);
});

const BOOK_TDS = { T01: ['Ex4.1', 'TD1'], T02: ['Ex4.1', 'TD2'], T03: ['Ex3.5', 'TD1'], T04: ['Ex3.5', 'TD2'], T05: ['Ex4.3', 'TD1'],
  T06: ['Ex5.1', 'TD1'], T07: ['Ex5.1', 'TD2'], T08: ['Ex3.4', 'TD1'] };

test('derived TD inputs of the 8 drawn book TDs = the skill tests\' hand inputs (P, sides, every v_b and outside shear)', () => {
  const fails = [];
  for (const [id, [ex, mark]] of Object.entries(BOOK_TDS)) {
    const { r, plan } = run(ex);
    const t = plan.tds.find(x => x.mark === mark);
    const dv = deriveTd(plan, r.analysis.cases[0], t, tdFrame(t), {});
    const exp = SUITE.tests.find(x => x.id === id).inputs;
    for (const [k, v] of Object.entries(exp)) {
      if (!/^td_(P|v[bo]_|side|y|span|length|support|has)/.test(k)) continue;
      const got = dv.skill[k];
      if (typeof v === 'number' ? Math.abs(got - v) > Math.max(0.05, 0.001 * Math.abs(v)) : got !== v) fails.push(`${id} ${k}: ${got} ≠ ${v}`);
    }
  }
  assert.deepEqual(fails, []);
});

test('TD engine on the drawn book TDs: results = the skill tests\' expected outputs; closure within the code constant', () => {
  const fails = [];
  for (const [id, [ex, mark]] of Object.entries(BOOK_TDS)) {
    const { r } = run(ex, i => { i.tds.forEach(t => { t.engineer.cantileverOk = true; }); });
    const tr = r.tdRuns.find(x => x.mark === mark);
    const t = SUITE.tests.find(x => x.id === id), tol = t.tolerance || {};
    if (tr.terminal !== 'OUTPUT') { fails.push(`${id} ${tr.terminal}`); continue; }
    assert.ok(tr.outputs.td_closure_rel <= CLOSURE_TOL, id + ' closure');
    for (const [k, v] of Object.entries(t.expected.outputs || {})) {
      const rel = (tol.overrides || {})[k] ?? tol.default_rel ?? 0.01;
      const got = tr.outputs[k];
      if (typeof v === 'boolean' ? got !== v : Math.abs(got - v) > Math.max(rel * Math.abs(v), tol.default_abs ?? 0)) fails.push(`${id} ${k}: ${got} ≠ ${v}`);
    }
  }
  assert.deepEqual(fails, []);
  // Ex 4.2 (strut shared by two TDs) runs too; Ex 3.3 (load line with walls of the offset line B/C) runs since Phase 7
  assert.ok(run('Ex4.2').r.tdRuns.every(x => x.terminal === 'OUTPUT'));
  assert.equal(run('Ex3.3').r.tdRuns[0].terminal, 'OUTPUT');
  // without the grouping (SW1 its own line B) the walls on B take the strut force: nothing for TD1, and the reason is given
  const e33 = run('Ex3.3', i => { i.walls.find(w => w.mark === 'SW1').line = 'B'; }).r.tdRuns[0];
  assert.equal(e33.terminal, 'NOT_RUN');
  assert.ok(e33.issues.some(i => /one wall line name/.test(i.msg)));
});

test('cantilever TD: paused until the engineer reviews the limits; "not met" stops; region clear and closure are never asked', () => {
  let tr = run('Ex3.4').r.tdRuns[0];
  assert.equal(tr.terminal, 'ENGINEER_INPUT:S062');
  tr = run('Ex3.4', i => { i.tds[0].engineer.cantileverOk = false; }).r.tdRuns[0];
  assert.equal(tr.terminal, 'HARD_STOP:E_TD_CANTILEVER_LIMITS');
  // the TDs tab lists the limits; the review button stores the answer and the TD runs
  const inputs = bookToInputs(book('Ex3.4'));
  const box = document.createElement('div');
  diaphragmAnalysis.renderForm(box, inputs, () => {}, [], () => {}, {});
  const click = t => [...box.querySelectorAll('button')].find(b => b.textContent === t).dispatchEvent(new window.Event('click'));
  click('TDs');
  assert.ok(box.textContent.includes('Cantilever limits — engineer review') && box.textContent.includes('UNVERIFIED'));
  assert.ok(box.textContent.includes('L′ = 15 ft'));
  click('Reviewed — limits met');
  assert.equal(inputs.tds[0].engineer.cantileverOk, true);
  assert.ok(box.textContent.includes('✓ results'));
  assert.ok(box.textContent.includes('Force to support'));
});

test('overhang on the high side (Ex 3.4 mirrored left–right): y mirrored, same TD results as the book layout', () => {
  const a = run('Ex3.4', i => { i.tds[0].engineer.cantileverOk = true; }).r.tdRuns[0];
  const b = run('Ex3.4', i => {
    const X = v => String(75 - Number(v));
    i.grids.filter(g => g.axis === 'x').forEach(g => { g.at = X(g.at); });
    i.outline = i.outline.map(p => ({ x: X(p.x), y: p.y })).reverse();
    for (const o of [...i.tds, ...i.diaphragms]) [o.x1, o.x2] = [X(o.x2), X(o.x1)];
    i.tds[0].overhang = [X(i.tds[0].overhang[1]), X(i.tds[0].overhang[0])];
    i.loads.forEach(l => l.segments.forEach(s => { [s.from, s.to] = [X(s.to), X(s.from)]; }));
    i.tds[0].engineer.cantileverOk = true;
  }).r;
  assert.equal(b.tds[0].ySign, -1);
  const tb = b.tdRuns[0];
  assert.equal(tb.terminal, 'OUTPUT');
  for (const k of ['td_F_sup_top', 'td_F_sup_bot', 'td_v_s1', 'td_v_s3', 'td_N_x1_b1', 'td_N_x2_b1', 'td_Nlong_1', 'td_closure_rel'])
    assert.ok(close(tb.outputs[k], a.outputs[k], 1e-6), k + ': ' + tb.outputs[k] + ' vs ' + a.outputs[k]);
});

test('TDs tab: derived loads with how they were found, shears per segment, results, DRAFT', () => {
  const inputs = bookToInputs(book('Ex5.1'));
  const box = document.createElement('div');
  diaphragmAnalysis.renderForm(box, inputs, () => {}, [], () => {}, {});
  [...box.querySelectorAll('button')].find(b => b.textContent === 'TDs').dispatchEvent(new window.Event('click'));
  const txt = box.textContent;
  assert.ok(txt.includes('DRAFT'));
  assert.ok(txt.includes('Vierendeel') && txt.includes('-6,441'), 'P1 of TD1 with its derivation');
  assert.ok(txt.includes('s2 (y2 → y1)'));
  assert.equal((txt.match(/✓ results/g) || []).length, 2);
});

console.log(passed + ' passed');
