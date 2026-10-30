// Diaphragm Analysis — TD engine (Phase 3): tdCalc.js runs the skill wood-diaph-transfer (tdFlow.js, generated from
// its flow.yaml). Skill tests T01–T21 (T05 with the Ex 4.3 p3 misprint corrected), the skill's invariant suite
// (reference/test_invariants.py, ported), every step type and stop reached, engineer inputs never filled, step trace
// with citations, and each drawn book TD mapped into the skill frame (tdFrame) = the skill's own test geometry.
// Run: node tests/diaphragmAnalysisEngine.test.mjs
import assert from 'assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

if (!globalThis.document) {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window, document, Node: window.Node });
}
const { runTd, flowStepTypes, TdFlowError } = await import('../src/modules/tdCalc.js');
const { TD_FLOW } = await import('../src/modules/tdFlow.js');
const { parsePlan, tdFrame } = await import('../src/modules/tdGeometry.js');
const { bookToInputs } = await import('./td-book/src/toInputs.mjs');
const { diaphragmAnalysis, calcAll } = await import('../src/modules/diaphragmAnalysis.js');

const SUITE = JSON.parse(fs.readFileSync(new URL('./td-cases/skill-tests.json', import.meta.url), 'utf8'));
const book = id => JSON.parse(fs.readFileSync(new URL('./td-book/' + id + '.json', import.meta.url), 'utf8'));
const clone = v => JSON.parse(JSON.stringify(v));
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; }
}

// ---------------------------------------------------------------- skill tests
const within = (a, e, rel, abs) => (typeof e === 'boolean' || typeof a === 'boolean' ? a === e : Math.abs(a - e) <= Math.max(rel * Math.abs(e), abs));
const run = t => runTd(t.inputs, t.engineer_inputs, t.edition);

test('skill tests T01–T21: terminal, flags and outputs within the skill tolerance', () => {
  assert.equal(SUITE.tests.length, 21);
  const fails = [];
  for (const t of SUITE.tests) {
    const r = run(t), x = t.expected, tol = t.tolerance || {};
    if (r.terminal !== x.terminal) fails.push(`${t.id} terminal ${r.terminal} ≠ ${x.terminal}`);
    const got = r.flags.map(f => f.id).sort().join(), exp = (x.flags || []).slice().sort().join();
    if (got !== exp) fails.push(`${t.id} flags [${got}] ≠ [${exp}]`);
    for (const [k, v] of Object.entries(x.outputs || {})) {
      const rel = (tol.overrides || {})[k] ?? tol.default_rel ?? 0.01;
      if (!(k in r.outputs) || !within(r.outputs[k], v, rel, tol.default_abs ?? 0)) fails.push(`${t.id} ${k} = ${r.outputs[k]} ≠ ${v}`);
    }
  }
  assert.deepEqual(fails, []);
});

test('T05: Ex 4.3 p3 misprint corrected (v3 = 157.14, not 167.9); edge-member forces unchanged by it', () => {
  const t = SUITE.tests.find(x => x.id === 'T05');
  assert.ok(t.corrected && /167\.9/.test(t.corrected.note));
  assert.equal(t.corrected.was.inputs.td_vb_x2_top, 167.9);
  assert.equal(t.inputs.td_vb_x2_top, 157.14);
  const r = run(t);
  assert.ok(Math.abs(r.outputs.td_vnet_x2_s1_hi - 39.05) < 0.01);
  const old = clone(t);
  Object.assign(old.inputs, t.corrected.was.inputs);
  const r0 = run(old);
  for (const k of ['td_N_x2_b1', 'td_N_x2_b2', 'td_N_x2_res', 'td_N_x1_b1', 'td_F_sup_top']) assert.ok(Math.abs(r.outputs[k] - r0.outputs[k]) < 1e-9, k);
});

test('every step type of the flow is reached, and every HARD_STOP code', () => {
  const types = new Set(), stops = new Set();
  for (const t of SUITE.tests) {
    const r = run(t);
    r.trace.forEach(s => types.add(s.type));
    if (r.terminal.startsWith('HARD_STOP:')) stops.add(r.terminal.slice(10));
  }
  // stops the skill tests do not reach
  const base = clone(SUITE.tests.find(x => x.id === 'T01'));
  const go = (inp, eng = base.engineer_inputs) => runTd({ ...base.inputs, ...inp }, eng, inp.code_edition || 'CBC-2025').terminal;
  for (const term of [go({ code_edition: 'IBC-2018' }), go({}, { ...base.engineer_inputs, td_region_clear: false }), go({ td_y1: 60 }),
    go({ td_vb_x1_top: 999 }), go({ td_length: 5 })]) if (term.startsWith('HARD_STOP:')) stops.add(term.slice(10));
  const t8 = SUITE.tests.find(x => x.id === 'T08');
  stops.add(runTd(t8.inputs, { ...t8.engineer_inputs, td_cantilever_ok: false }).terminal.slice(10));
  const present = flowStepTypes().filter(x => x !== 'CONSERVATIVE_DEFAULT' && x !== 'CALL');
  assert.deepEqual(present.filter(x => !types.has(x)), []);
  const codes = Object.values(TD_FLOW.steps).filter(s => s.type === 'HARD_STOP').map(s => s.reason_code);
  assert.deepEqual(codes.filter(c => !stops.has(c)), []);
});

test('engineer inputs are never filled: a missing one pauses at its step; a bad value is refused', () => {
  const t = SUITE.tests.find(x => x.id === 'T01'), t8 = SUITE.tests.find(x => x.id === 'T08');
  assert.equal(runTd(t.inputs, {}).terminal, 'ENGINEER_INPUT:S020');
  assert.equal(runTd(t.inputs, { td_region_clear: true }).terminal, 'ENGINEER_INPUT:S200');
  assert.equal(runTd(t.inputs, { td_region_clear: true, td_closure_tol: '' }).terminal, 'ENGINEER_INPUT:S200');
  assert.equal(runTd(t8.inputs, { td_region_clear: true, td_closure_tol: 0.01 }).terminal, 'ENGINEER_INPUT:S062');
  const paused = runTd(t.inputs, {});
  assert.ok(paused.trace.at(-1).paused && paused.trace.at(-1).prompt.length > 20);
  assert.throws(() => runTd(t.inputs, { td_region_clear: true, td_closure_tol: 0 }), TdFlowError);
  assert.throws(() => runTd(t.inputs, { td_region_clear: 'yes' }), TdFlowError);
  const { td_span, ...noSpan } = t.inputs;
  assert.throws(() => runTd(noSpan, t.engineer_inputs), /missing inputs: td_span/);
});

test('step trace: one record per step with citations; edition picks the ASCE 7 citation; DRAFT while not PE-approved', () => {
  const t = SUITE.tests.find(x => x.id === 'T01');
  const r = run(t);
  assert.equal(r.trace[0].id, TD_FLOW.entry);
  assert.equal(r.trace.at(-1).type, 'OUTPUT');
  assert.ok(r.trace.every(s => Array.isArray(s.cite) && s.cite.length && s.verify));
  assert.ok(r.trace.find(s => s.id === 'S240').table === 'SDPWS-2021-T4.2.2' && r.trace.find(s => s.id === 'S240').tableVerify === 'UNVERIFIED');
  const asce = rr => rr.trace.at(-1).cite.find(c => c.std === 'ASCE7').edition;
  assert.equal(asce(r), '22');
  assert.equal(asce(runTd({ ...t.inputs, code_edition: 'CBC-2022' }, t.engineer_inputs)), '16');
  assert.equal(r.draft, TD_FLOW.skillStatus !== 'PE_APPROVED');
  assert.ok(r.draft);
  assert.deepEqual(Object.keys(r.outputs).sort(), TD_FLOW.outputs.slice().sort());
});

// ---------------------------------------------------------------- invariants (skill reference/test_invariants.py)
const ENG = { td_region_clear: true, td_cantilever_ok: true, td_closure_tol: 1e9 }; // closure not under test
const close = (a, b) => Math.abs(a - b) <= Math.max(1e-9 * Math.max(Math.abs(a), Math.abs(b)), 1e-6);
const EDGE = ['td_vb_{e}_top', 'td_vb_{e}_y1', 'td_vb_{e}_y2', 'td_vb_{e}_bot', 'td_vo_{e}_s1_hi', 'td_vo_{e}_s1_lo', 'td_vo_{e}_s2_hi', 'td_vo_{e}_s2_lo', 'td_vo_{e}_s3_hi', 'td_vo_{e}_s3_lo'];
const k = (key, e) => key.replace('{e}', e);
const SHEAR_IN = ['x1', 'x2'].flatMap(e => EDGE.map(key => k(key, e)));
function go(inp) {
  const r = runTd(inp, ENG);
  assert.equal(r.terminal, 'OUTPUT');
  return r.outputs;
}
function mirrorX(inp) {
  const m = clone(inp);
  m.td_P1 = -inp.td_P1; m.td_P2 = -inp.td_P2; m.td_side1 = -inp.td_side1; m.td_side2 = -inp.td_side2;
  for (const key of EDGE) { m[k(key, 'x1')] = -inp[k(key, 'x2')]; m[k(key, 'x2')] = -inp[k(key, 'x1')]; }
  return m;
}
function mirrorY(inp) {
  const W = inp.td_span, two = inp.td_has_load2, m = clone(inp);
  if (two) Object.assign(m, { td_P1: inp.td_P2, td_side1: inp.td_side2, td_y1: W - inp.td_y2, td_P2: inp.td_P1, td_side2: inp.td_side1, td_y2: W - inp.td_y1 });
  else m.td_y1 = W - inp.td_y1;
  for (const e of ['x1', 'x2']) {
    const g = key => inp[k(key, e)];
    m[k('td_vb_{e}_top', e)] = -g('td_vb_{e}_bot'); m[k('td_vb_{e}_bot', e)] = -g('td_vb_{e}_top');
    m[k('td_vb_{e}_y1', e)] = -(two ? g('td_vb_{e}_y2') : g('td_vb_{e}_y1'));
    m[k('td_vb_{e}_y2', e)] = -(two ? g('td_vb_{e}_y1') : g('td_vb_{e}_y2'));
    m[k('td_vo_{e}_s1_hi', e)] = -g('td_vo_{e}_s3_lo'); m[k('td_vo_{e}_s1_lo', e)] = -g('td_vo_{e}_s3_hi');
    m[k('td_vo_{e}_s3_hi', e)] = -g('td_vo_{e}_s1_lo'); m[k('td_vo_{e}_s3_lo', e)] = -g('td_vo_{e}_s1_hi');
    m[k('td_vo_{e}_s2_hi', e)] = -g('td_vo_{e}_s2_lo'); m[k('td_vo_{e}_s2_lo', e)] = -g('td_vo_{e}_s2_hi');
  }
  return m;
}
function checkCase(name, inp, errs) {
  const o = go(inp);
  const P1 = inp.td_P1, P2 = inp.td_has_load2 ? inp.td_P2 : 0, y1 = inp.td_y1, y2 = inp.td_y2, W = inp.td_span, L = inp.td_length;
  if (!close(o.td_F_sup_top + o.td_F_sup_bot, P1 + P2)) errs.push(name + ' I1 sum Fx');
  if (!close(o.td_F_sup_top * W, P1 * y1 + P2 * y2)) errs.push(name + ' I1 moment');
  if (inp.td_support === 'simple') {
    if (!close((o.td_v_s2 - o.td_v_s1) * L, -P1)) errs.push(name + ' I2 jump y1');
    if (!close((o.td_v_s3 - o.td_v_s2) * L, -P2)) errs.push(name + ' I2 jump y2');
  } else if (!close((o.td_v_s3 - o.td_v_s1) * L, o.td_F_sup_bot)) errs.push(name + ' I2 jump at support');
  const m = go(mirrorX(inp));
  const pairs = [['td_F_sup_top', 'td_F_sup_top', -1], ['td_F_sup_bot', 'td_F_sup_bot', -1], ['td_v_s1', 'td_v_s1', -1], ['td_v_s3', 'td_v_s3', -1],
    ['td_N_x1_b1', 'td_N_x2_b1', 1], ['td_N_x2_b1', 'td_N_x1_b1', 1], ['td_N_x1_b2', 'td_N_x2_b2', 1], ['td_Nlong_1', 'td_Nlong_1', 1],
    ...['s1_hi', 's1_lo', 's3_hi', 's3_lo'].map(s => ['td_vnet_x1_' + s, 'td_vnet_x2_' + s, -1])];
  for (const [a, b, sg] of pairs) if (!close(m[b], sg * o[a])) errs.push(`${name} I4 mirror-x ${a}`);
  if (inp.td_support === 'simple') {
    const n = go(mirrorY(inp)), two = inp.td_has_load2;
    const checks = [['td_F_sup_top', n.td_F_sup_bot], ['td_F_sup_bot', n.td_F_sup_top]];
    if (two) checks.push(['td_N_x1_b1', n.td_N_x1_b2 + o.td_N_x1_res], ['td_N_x1_b2', n.td_N_x1_b1 + o.td_N_x1_res],
      ['td_N_x2_b1', n.td_N_x2_b2 + o.td_N_x2_res], ['td_N_x2_b2', n.td_N_x2_b1 + o.td_N_x2_res],
      ['td_Nlong_1', n.td_Nlong_2], ['td_Nlong_2', n.td_Nlong_1], ['td_v_s2', -n.td_v_s2]);
    else checks.push(['td_N_x1_b1', n.td_N_x1_b1 + o.td_N_x1_res], ['td_N_x2_b1', n.td_N_x2_b1 + o.td_N_x2_res], ['td_Nlong_1', n.td_Nlong_1]);
    checks.push(['td_v_s1', -n.td_v_s3], ['td_v_s3', -n.td_v_s1], ['td_N_x1_res', -n.td_N_x1_res], ['td_N_x2_res', -n.td_N_x2_res]);
    for (const [a, v] of checks) if (!close(o[a], v)) errs.push(`${name} I5 mirror-y ${a}`);
  }
  const s = clone(inp), f = 2.5;
  for (const key of [...SHEAR_IN, 'td_P1', 'td_P2']) s[key] = f * inp[key];
  const so = go(s);
  for (const key of ['td_F_sup_top', 'td_v_s1', 'td_vnet_x1_s1_hi', 'td_N_x2_b1', 'td_Nlong_1']) if (!close(so[key], f * o[key])) errs.push(`${name} I6 linearity ${key}`);
}
function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function randomCases(n = 200, seed = 20261029) {
  const r = rng(seed), u = (a, b) => a + (b - a) * r(), pm = () => (r() < 0.5 ? -1 : 1);
  return Array.from({ length: n }, (_, i) => {
    const cant = r() < 0.25, W = u(10, 80), L = u(W / 3.9, W / 1.2), two = !cant && r() < 0.5;
    const y1 = cant ? -u(1, 20) : u(0.2, 0.8) * W;
    const d = { code_edition: 'CBC-2025', design_basis: 'LRFD', load_type: 'seismic', diaph_sheathing_type: 'wsp', td_blocked: true,
      td_support: cant ? 'cantilever' : 'simple', td_span: W, td_length: L, td_P1: pm() * u(500, 20000), td_side1: pm(), td_y1: y1,
      td_has_load2: two, td_P2: two ? pm() * u(500, 20000) : 0, td_side2: pm(), td_y2: two ? u(0.1, 0.9) * y1 : 0 };
    for (const key of SHEAR_IN) d[key] = u(-600, 600);
    return ['R' + String(i).padStart(3, '0'), d];
  });
}

test('invariants I1, I2, I4, I5, I6 on the skill tests + 200 random cases (skill test_invariants.py)', () => {
  const cases = SUITE.tests.filter(t => t.expected.terminal === 'OUTPUT' && ['reference', 'boundary'].includes(t.kind)).map(t => [t.id, t.inputs]).concat(randomCases());
  const errs = [];
  for (const [name, inp] of cases) checkCase(name, inp, errs);
  assert.deepEqual(errs.slice(0, 20), []);
});

test('invariant I3: a TD with no basic / outside shear gives the beam chord force M / L', () => {
  const base = { code_edition: 'CBC-2025', design_basis: 'ASD', load_type: 'wind', diaph_sheathing_type: 'wsp', td_blocked: true,
    td_side1: 1, td_has_load2: false, td_P2: 0, td_side2: 1, td_y2: 0, ...Object.fromEntries(SHEAR_IN.map(x => [x, 0])) };
  for (const P of [1000, -1000]) {
    let o = go({ ...base, td_support: 'simple', td_span: 40, td_length: 10, td_P1: P, td_y1: 15 });
    const M = P * 15 * 25 / 40;
    assert.ok(close(o.td_N_x2_b1, M / 10) && close(o.td_N_x1_b1, -M / 10));
    o = go({ ...base, td_support: 'cantilever', td_span: 40, td_length: 10, td_P1: P, td_y1: -12 });
    assert.ok(close(o.td_N_x2_b1, -P * 12 / 10) && close(o.td_N_x1_b1, P * 12 / 10));
  }
});

// ---------------------------------------------------------------- drawn TD → skill frame
const BOOK_TDS = { T01: ['Ex4.1', 'TD1'], T02: ['Ex4.1', 'TD2'], T03: ['Ex3.5', 'TD1'], T04: ['Ex3.5', 'TD2'], T05: ['Ex4.3', 'TD1'],
  T06: ['Ex5.1', 'TD1'], T07: ['Ex5.1', 'TD2'], T08: ['Ex3.4', 'TD1'] };
const GEOM_KEYS = ['td_support', 'td_span', 'td_length', 'td_y1', 'td_side1', 'td_has_load2', 'td_y2', 'td_side2'];

test('book TDs drawn on the plan give the skill tests\' geometry (T01–T08: support, W, L, y1/y2, sides)', () => {
  for (const [id, [ex, mark]] of Object.entries(BOOK_TDS)) {
    const plan = parsePlan(bookToInputs(book(ex)));
    const f = tdFrame(plan.tds.find(t => t.mark === mark));
    assert.ok(f.ok, id + ': ' + f.issues.join('; '));
    const exp = SUITE.tests.find(t => t.id === id).inputs;
    assert.deepEqual(f.geometry, Object.fromEntries(GEOM_KEYS.map(key => [key, exp[key]])), id);
  }
});

const tdOf = (over) => parsePlan({
  grids: [{ id: 'g1', name: '1', axis: 'x', at: '0' }, { id: 'g2', name: '2', axis: 'x', at: '20' }, { id: 'g3', name: '3', axis: 'x', at: '80' },
    { id: 'g4', name: '4', axis: 'x', at: '95' }, { id: 'gA', name: 'A', axis: 'y', at: '0' }, { id: 'gB', name: 'B', axis: 'y', at: '30' }, { id: 'gC', name: 'C', axis: 'y', at: '50' }],
  outline: [], openings: [], walls: [], diaphragms: [], loads: [],
  tds: [{ id: 't', mark: 'TD1', dir: 'y', x1: '20', x2: '80', y1: '30', y2: '50', supports: ['g2', 'g3'], loads: [], overhang: null, ...over }],
}).tds[0];

test('tdFrame: TD spanning along plan x; overhang on the high side mirrors y; issues for bad load lines', () => {
  // supports 2 / 3 (x = 20 / 80) → W = 60, L = 20 (y 30–50); load at x = 0 is outside a simple span
  let f = tdFrame(tdOf({ loads: [{ gridId: 'g1', side: '+' }] }));
  assert.equal(f.spanAxis, 'x');
  assert.ok(!f.ok && /between the supports/.test(f.issues.join()));
  // cantilever, overhang below (x 0–20), load at the tip x = 0 → y1 = -20
  f = tdFrame(tdOf({ x1: '0', overhang: ['0', '20'], loads: [{ gridId: 'g1', side: '-' }] }));
  assert.ok(f.ok, f.issues.join());
  assert.deepEqual([f.geometry.td_support, f.geometry.td_span, f.geometry.td_length, f.geometry.td_y1, f.geometry.td_side1, f.ySign], ['cantilever', 60, 20, -20, -1, 1]);
  assert.equal(f.bottom.name, '2');
  // overhang above (x 80–95), load at x = 95 → y mirrored: bottom = grid 3, y1 = -15
  f = tdFrame(tdOf({ x2: '95', overhang: ['80', '95'], loads: [{ gridId: 'g4', side: '+' }] }));
  assert.ok(f.ok, f.issues.join());
  assert.deepEqual([f.ySign, f.bottom.name, f.top.name, f.geometry.td_y1], [-1, '3', '2', -15]);
  // cantilever load not at the tip; three load lines; missing supports
  assert.ok(/tip/.test(tdFrame(tdOf({ x2: '95', overhang: ['80', '95'], loads: [{ gridId: 'g2', side: '+' }] })).issues.join()));
  assert.ok(/at most 2/.test(tdFrame(tdOf({ supports: ['gA', 'gC'], x1: '20', x2: '80', y1: '0', y2: '50',
    loads: [{ gridId: 'gB' }, { gridId: 'gB' }, { gridId: 'gB' }] })).issues.join()));
  assert.ok(!tdFrame(tdOf({ supports: ['g2'] })).ok);
});

test('calcAll lists each TD in the skill frame; the TDs tab shows them with the DRAFT mark', () => {
  const inputs = bookToInputs(book('Ex4.1'));
  const r = calcAll(inputs);
  assert.equal(r.tds.length, 2);
  const td1 = r.tds.find(t => t.mark === 'TD1');
  assert.deepEqual([td1.ok, td1.bottom, td1.top, td1.geometry.td_y1, td1.loadLines[0].grid], [true, 'C', 'A', 10, 'B']);
  const box = document.createElement('div');
  diaphragmAnalysis.renderForm(box, inputs, () => {}, [], () => {}, {});
  [...box.querySelectorAll('button')].find(b => b.textContent === 'TDs').dispatchEvent(new window.Event('click'));
  assert.ok(box.textContent.includes('DRAFT'));
  assert.ok(box.textContent.includes('C → A'));
  assert.ok(box.textContent.includes('✓ results'), 'TD runs shown (Phase 5)');
});

console.log(passed + ' passed');
