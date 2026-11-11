// Diaphragm Analysis — the user's own test items (project 26999 Cotoros ADU Test, 2026-11-03), frozen in
// tests/fixtures/da-user/, and the fixes from that test (docs/diaphragm-analysis-fix-plan-2026-11-03.md).
// Run: node tests/diaphragmAnalysisUser.test.mjs
import assert from 'assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

if (!globalThis.document) {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window, document, Node: window.Node });
}

const { calcAll, diaphragmAnalysis, equilibriumGate } = await import('../src/modules/diaphragmAnalysis.js');
const { swdExtract } = await import('../src/modules/tdWallLink.js');
const { bookToInputs } = await import('./td-book/src/toInputs.mjs');
const { toolValue } = await import('../src/modules/tdBookKeys.js');
const { planWithLinks } = await import('../src/modules/diaphragmAnalysis.js');
const { defaultInputs } = await import('../src/modules/tdModel.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; }
}
const fx = n => JSON.parse(fs.readFileSync(new URL('./fixtures/da-user/' + n + '.json', import.meta.url), 'utf8'));
const SWD = swdExtract(fx('adu-swd').inputs);
// a copy of a fixture's inputs, edited by mod(inputs, gridId), then calculated with the linked SWD walls
function run(name, mod = () => {}) {
  const i = structuredClone(fx(name).inputs);
  const G = n => i.grids.find(g => g.name === n).id;
  mod(i, G);
  return { i, out: calcAll(i, { wallSource: SWD }) };
}
const P = (id, x1, x2, y1, y2) => ({ id, x1: String(x1), x2: String(x2), y1: String(y1), y2: String(y2) });
const dg = (id, mark, dir, parts, supports) => ({ id, dir, mark, parts, supports, blocked: null, chordCut: '', bandSplit: '', sheathing: '' });
const td = (id, mark, dir, x1, x2, y1, y2, supports, loads) => ({ id, mark, dir, x1: String(x1), x2: String(x2), y1: String(y1), y2: String(y2), supports,
  loads: loads || [], loadsMode: loads ? 'manual' : 'auto', overhang: null, engineer: { closureTol: '', regionClear: null, cantileverOk: null } });
const codes = (out, list = 'errors') => out[list].map(e => e.code);
const kase = (out, id) => out.analysis.cases.find(c => c.id === id);
const share = (out, id, mark) => kase(out, id).lines.flatMap(l => l.walls || []).find(w => w.mark === mark).share;
const checksOf = (out, id) => out.checks.filter(c => c.caseId === id);
const loadLines = (out, mark) => out.tds.find(t => t.mark === mark).loadLines.map(l => l.grid + (l.side < 0 ? '-' : l.side > 0 ? '+' : 'both'));

// The 2nd floor E-W as the user's case D: one diaphragm per bottom line (D1 on 4/2, D2 on 3.8/2, D3 on 5/2), TD1 =
// D1's rectangle, TD2 = D3's rectangle, load lines Auto. Lines 4 and 5 are separate (no strut, user decision D1).
const caseD = (i, G) => {
  i.diaphragms = i.diaphragms.filter(d => d.dir !== 'x').concat([
    dg('a', 'D1x', 'x', [P('a1', 3, 13, 8, 29)], [G('4'), G('2')]),
    dg('b', 'D2x', 'x', [P('b1', 13, 22, 11.67, 29)], [G('3.8'), G('2')]),
    dg('c', 'D3x', 'x', [P('c1', 22, 35, 5, 29)], [G('5'), G('2')])]);
  i.tds = i.tds.filter(t => t.dir !== 'x').concat([
    td('t1', 'TD1x', 'x', 3, 13, 8, 29, [G('4'), G('2')]),
    td('t2', 'TD2x', 'x', 22, 35, 5, 29, [G('5'), G('2')])]);
};

// ── Step A ──
test('5a: loads acting both ways in one case are an error (Roof as first saved: −y with +y, +x with −x cancelled to 0)', () => {
  const { out } = run('adu-roof-first');
  assert.equal(codes(out).filter(c => c === 'load-opposite').length, 2);
  assert.equal(out.status, 'fail');
});

test('5a: two seismic F_x / ΣA loads in one case are an error; two wind loads in one sense are not', () => {
  const { out } = run('adu-roof', i => { i.loads.push({ ...i.loads[0], id: 'ld-2' }); });
  assert.ok(codes(out).includes('load-seismic-twice'));
  assert.ok(!codes(out).includes('load-opposite'));
});

test('5c: grids that miss the plan — one warning naming them (Roof: grid 1 at y = 37)', () => {
  const { out } = run('adu-roof-first');
  const w = out.warnings.filter(x => x.code === 'grid-off-plan');
  assert.equal(w.length, 1);
  assert.match(w[0].msg, /Grid 1 \(y = 37\)/);
});

test('1: TD load lines Auto ignore walls of the other direction (Roof TD1 as first drawn no longer takes line 4 from SW-8)', () => {
  const { out } = run('adu-roof-first', i => { i.loads = i.loads.filter(l => l.kind === ''); });
  assert.ok(!loadLines(out, 'TD1').some(l => l.startsWith('4')), loadLines(out, 'TD1').join(' '));
});

test('1: Roof N-S with TD1 on 6 / 1.7, load lines Auto → 5 (−) and 5.5 (+); every run closes', () => {
  const { out } = run('adu-roof-first', (i, G) => {
    i.loads = i.loads.filter(l => l.kind === '' && l.acts.endsWith('y'));
    i.tds = i.tds.filter(t => t.dir === 'y');
    Object.assign(i.tds[0], { supports: [G('6'), G('1.7')], loads: [], loadsMode: 'auto' });
  });
  assert.deepEqual(codes(out), []);
  assert.deepEqual(loadLines(out, 'TD1').sort(), ['5-', '5.5+']);
  assert.ok(checksOf(out, 'y-E').every(c => c.ok), checksOf(out, 'y-E').filter(c => !c.ok).map(c => c.msg).join(' | '));
});

test('1b: a wall across a notch gap does not make a load line (2nd floor case D: TD2 does not take line 4 from SW-9)', () => {
  const { out } = run('adu-2nd', caseD);
  assert.deepEqual(loadLines(out, 'TD1x'), ['3.8+']);
  assert.deepEqual(loadLines(out, 'TD2x'), ['3.8-']);
});

test('case D (user): 2nd floor E-W closes on Auto; SW-9 / SW-11 / SW-7 = 1671 / 2244 / 4345 lb (= the diaphragm split at mid-strip)', () => {
  const { out } = run('adu-2nd', caseD);
  assert.deepEqual(codes(out), []);
  assert.ok(checksOf(out, 'x-E').every(c => c.ok), checksOf(out, 'x-E').filter(c => !c.ok).map(c => c.msg).join(' | '));
  for (const [m, v] of [['SW-9', 1671], ['SW-11', 2244], ['SW-7', 4345]]) assert.ok(Math.abs(share(out, 'x-E', m) - v) < 1, m + ' ' + share(out, 'x-E', m));
  assert.ok(!codes(out, 'warnings').includes('wall-in-span'));
});

test('6: a wall inside a diaphragm\'s span that takes no force is named (2nd floor as saved: SW-9 inside D1 between 5 and 2)', () => {
  const { out } = run('adu-2nd');
  const w = out.warnings.filter(x => x.code === 'wall-in-span');
  assert.equal(w.length, 1);
  assert.match(w[0].msg, /SW-9 on line 4 lies inside diaphragm D1 \(between 5 and 2\)/);
});

test('3: a strut TD loaded from both edges takes N(high edge) − N(low edge) (Auto "both" = the two one-sided loads together)', () => {
  // Roof as first drawn, E-W, offset line removed so the basic field is all that loads TD2; its load line 4 is reached
  // by SW-8 from the left and is D1's support line on the right → side both
  const base = (i, G) => {
    i.loads = i.loads.filter(l => l.kind === '' && l.acts.endsWith('x'));
    i.tds = i.tds.filter(t => t.dir === 'x');
    i.wallLink.groups = [];
    i.diaphragms.find(d => d.dir === 'x').supports = [G('4'), G('2')];
    Object.assign(i.tds[0], { y1: '5', y2: '29', supports: [G('2'), G('5')] });
  };
  const P1 = (mod) => { const { out } = run('adu-roof-first', (i, G) => { base(i, G); mod(i, G); }); return out.tdRuns.find(r => r.mark === 'TD2').skill.td_P1; };
  const auto = run('adu-roof-first', base).out;
  assert.deepEqual(loadLines(auto, 'TD2'), ['4both']);
  const both = auto.tdRuns.find(r => r.mark === 'TD2').skill.td_P1;
  const lo = P1((i, G) => { Object.assign(i.tds[0], { loadsMode: 'manual', loads: [{ gridId: G('4'), side: '-' }] }); });
  const hi = P1((i, G) => { Object.assign(i.tds[0], { loadsMode: 'manual', loads: [{ gridId: G('4'), side: '+' }] }); });
  assert.ok(Math.abs(both) > 1, 'not 0 any more: ' + both);
  assert.ok(Math.abs(both - (lo + hi)) < 1e-6, `${both} vs ${lo} + ${hi}`);
});

test('book examples: none of the new checks fires (load-opposite, load-seismic-twice, grid-off-plan, wall-in-span, td-past-support, group-no-path)', () => {
  const NEW = ['load-opposite', 'load-seismic-twice', 'grid-off-plan', 'wall-in-span', 'td-past-support', 'group-no-path'];
  const dir = new URL('./td-book/', import.meta.url);
  const ids = fs.readdirSync(dir).filter(f => /^Ex.*\.json$/.test(f));
  assert.equal(ids.length, 9);
  for (const f of ids) {
    const out = calcAll(bookToInputs(JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'))));
    const hit = [...out.errors, ...out.warnings].filter(e => NEW.includes(e.code));
    assert.deepEqual(hit.map(e => f + ': ' + e.msg), []);
  }
});

// ── Step B: any number of load lines on a simple-span TD (superposed single-load engine runs) ──
const books = () => fs.readdirSync(new URL('./td-book/', import.meta.url)).filter(f => /^Ex.*\.json$/.test(f))
  .map(f => JSON.parse(fs.readFileSync(new URL('./td-book/' + f, import.meta.url), 'utf8')));

test('2 proof: every book TD run as superposed single-load runs = the direct engine run (all book values, every member run, 1e-6)', () => {
  let n = 0, sup = 0;
  for (const b of books()) {
    const inp = bookToInputs(b), plan = planWithLinks(inp).plan;
    const a = calcAll(inp), s = calcAll(inp, {}, { superposeFrom: 1 });
    sup += s.tdRuns.filter(r => r.superposed).length;
    assert.deepEqual(s.tdRuns.map(r => r.terminal), a.tdRuns.map(r => r.terminal), b.id);
    for (const e of b.expected) {
      const x = toolValue(e.k, plan, a.analysis), y = toolValue(e.k, plan, s.analysis);
      assert.ok((x === null && y === null) || Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x)), `${b.id} ${e.k}: ${x} vs ${y}`);
      n++;
    }
    for (const c of a.analysis.cases) {
      const c2 = s.analysis.cases.find(q => q.id === c.id);
      (c.members || []).forEach((m, i) => m.runs.forEach((r, j) => {
        const r2 = c2.members[i].runs[j];
        assert.ok(Math.abs(r.max - r2.max) <= 1e-6 * Math.max(1, Math.abs(r.max)) && Math.abs(r.residual - r2.residual) <= 1e-6, `${b.id} ${m.name}`);
        n++;
      }));
    }
  }
  assert.equal(sup, 20, 'every book TD superposed (since 2026-11-04 also Ex 3.4\'s cantilever)');
  assert.ok(n > 700);
});

test('2: Roof E-W TD2 with three load lines (4, 5 both, 5.5) runs; each shear jump × length = that line\'s P, top stretch = Σ P·y / W', () => {
  const { out } = run('adu-roof');
  assert.ok(!codes(out).includes('td-loads-max'));
  const r = out.tdRuns.find(x => x.mark === 'TD2');
  assert.equal(r.terminal, 'OUTPUT');
  assert.equal(r.superposed.runs.length, 3);
  const L = r.skill.td_length, W = r.skill.td_span, segs = r.segsLocal; // [lo, hi, v], top first
  assert.equal(segs.length, 4);
  const loads = r.superposed.runs; // top first (y 8, 5, 2)
  loads.forEach((l, k) => assert.ok(Math.abs((segs[k + 1][2] - segs[k][2]) * L + l.P) < 1e-6, `jump at ${l.grid}`));
  assert.ok(Math.abs(Math.abs(segs[0][2] * L) - Math.abs(loads.reduce((s, l) => s + l.P * l.y, 0) / W)) < 1e-6);
});

// synthetic: one TD with four load lines — a notch on each side (chords B from the left, C from the right) and an
// opening at the wall line (its edge members D, E reach the TD from the left; book Ex 4.3 type)
function fourLines() {
  const i = defaultInputs();
  const gr = (name, axis, at) => ({ id: 'g' + name, name, axis, at: String(at), ref: false });
  i.grids = [gr('1', 'x', 0), gr('2', 'x', 10), gr('3', 'x', 20), gr('4', 'x', 40), gr('5', 'x', 60),
    gr('A', 'y', 0), gr('B', 'y', 4), gr('C', 'y', 8), gr('D', 'y', 12), gr('E', 'y', 16), gr('F', 'y', 30)];
  i.outline = [[0, 4], [20, 4], [20, 0], [40, 0], [40, 8], [60, 8], [60, 30], [0, 30]].map(([x, y]) => ({ x: String(x), y: String(y) }));
  i.openings = [{ id: 'op1', name: 'O1', x1: '0', x2: '20', y1: '12', y2: '16' }];
  i.walls = [{ id: 'w1', mark: 'SW1', gridId: 'g1', from: '4', to: '12', line: '1' }, { id: 'w2', mark: 'SW2', gridId: 'g1', from: '16', to: '30', line: '1' },
    { id: 'w5', mark: 'SW5', gridId: 'g5', from: '8', to: '30', line: '5' }];
  i.level.fx = '20';
  i.loads = [{ id: 'l1', acts: '-y', mode: 'seismic', kind: '', psf: '', edgeId: '', segments: [] }];
  i.noLoad = { E: false, W: true };
  i.diaphragms = [dg('d1', 'D1', 'y', [P('p1', 0, 20, 4, 12), P('p2', 0, 20, 16, 30), P('p4', 20, 40, 0, 30), P('p5', 40, 60, 8, 30)], ['g1', 'g5'])];
  i.tds = [td('t1', 'TD1', 'y', 20, 40, 0, 30, ['gA', 'gF'])];
  return i;
}
test('2: a TD with four load lines (Auto: E, D, B from the left, C from the right) runs and every member run closes', () => {
  const out = calcAll(fourLines());
  assert.deepEqual(codes(out), []);
  assert.deepEqual(loadLines(out, 'TD1'), ['E-', 'D-', 'C+', 'B-']);
  const r = out.tdRuns.find(x => x.mark === 'TD1');
  assert.equal(r.terminal, 'OUTPUT');
  assert.equal(r.superposed.runs.length, 4);
  assert.ok(out.checks.every(c => c.ok), out.checks.filter(c => !c.ok).map(c => c.msg).join(' | '));
});

test('2: TDs tab of a superposed TD — load table (P1…P4 with grid, side, run), stretches with Σ v_TD, support forces', () => {
  const box = document.createElement('div');
  diaphragmAnalysis.renderForm(box, fourLines(), () => {}, [], () => {}, {});
  [...box.querySelectorAll('button')].find(b => b.textContent === 'TDs').dispatchEvent(new window.Event('click'));
  const txt = box.textContent;
  assert.ok(txt.includes('Superposed from 4 engine runs'), 'note');
  for (const s of ['P1 (E)', 'P4 (B)', 'v_TD (plf) = Σ runs', 'Force to support', '✓ results']) assert.ok(txt.includes(s), s);
});

// ── 2026-11-04: overhangs by grid (one per support), any number of TD loads anywhere from tip to tip, Q2 ──
const { normalizeInputs } = await import('../src/modules/tdMigrate.js');
const { vRun } = await import('../src/modules/tdDerive.js');
const ex34 = edit => { const inp = bookToInputs(books().find(x => x.id === 'Ex3.4')); inp.tds[0].engineer.cantileverOk = true; if (edit) edit(inp); return inp; };
const runOf = (out, mark) => out.tdRuns.find(r => r.mark === mark);

test('11-04 a: a typed overhang [a, b] becomes grid picks on open (Roof TD2 0–5 → from 5 to 6); results unchanged by the conversion', () => {
  const i = structuredClone(fx('adu-roof-1104').inputs), G = n => i.grids.find(g => g.name === n).id;
  const before = calcAll(structuredClone(i), { wallSource: SWD });
  normalizeInputs(i);
  const t = i.tds.find(x => x.mark === 'TD2');
  assert.deepEqual(t.overhangs, [{ fromId: G('5'), toId: G('6'), at: '' }]);
  assert.deepEqual(t.overhang, ['0', '5'], 'the typed values stay as the record');
  assert.deepEqual(i.tds.find(x => x.mark === 'TD1').overhangs, []);
  const after = calcAll(i, { wallSource: SWD });
  assert.deepEqual(codes(after), codes(before));
  // a typed tip without a grid keeps its value (warning: pick a grid there)
  const j = structuredClone(fx('adu-roof-1104').inputs);
  j.tds.find(x => x.mark === 'TD2').overhang = ['1', '5']; j.tds.find(x => x.mark === 'TD2').y1 = '1';
  normalizeInputs(j);
  assert.deepEqual(j.tds.find(x => x.mark === 'TD2').overhangs, [{ fromId: G('5'), toId: '', at: '1' }]);
  assert.ok(codes(calcAll(j, { wallSource: SWD }), 'warnings').includes('td-overhang-grid'));
});

test('11-04 b: Roof E-W as saved — TD2 runs 3 ft past support 2 without an overhang there: error (y 29–32)', () => {
  const { out } = run('adu-roof-1104');
  const e = out.errors.find(x => x.code === 'td-past-support');
  assert.ok(e && /TD2 runs past its support 2 \(y 29–32\)/.test(e.msg), e && e.msg);
  assert.ok(!codes(out).includes('td-loads-max'), 'more than one load on a cantilever TD is allowed');
});

const roofOk = mod => run('adu-roof-1104', (i, G) => { normalizeInputs(i); mod(i, G); });
// The TD2 loads follow SWD's equal-δ shares on the offset line: v24 P = [−2262, −354], SW-8 / SW-10 / SW-6 = 4888 / 3945 /
// 7908 lb; v25 (2026-11-09, posts without the sill bearing check) [−2886, 191], 5511 / 3399 / 7830; with double holdowns /
// straps (2026-11-09, drift sizing past the largest single: 26999 SW-9 (2)HDUE17) the values below.
const ROOF_SEGS = [[3, 24, -1.9], [0, 3, 13.27], [-3, 0, 0], [-5, -3, 0]];
const roofChecks = (out, P, segs = ROOF_SEGS) => {
  assert.equal(out.status, 'ok', out.errors.map(e => e.msg).join(' | '));
  const cs = kase(out, 'x-E'), r = runOf(out, 'TD2');
  assert.equal(r.terminal, 'OUTPUT');
  assert.deepEqual(r.superposed.runs.map(x => [x.grid, x.kind]), [['4', 'span'], ['5', 'support'], ['5.5', 'bottom']]);
  assert.deepEqual(r.P.map(Math.round), P);
  // statics of a beam on 5 / 2 (W = 24, L = 9): P4 = −137 at y 3 → top 137·3/24, bottom 137·21/24; P5 straight into 5
  const W = 24, [P4, P5] = r.P;
  assert.ok(Math.abs(r.outputs.td_F_sup_top - P4 * 3 / W) < 1e-6 && Math.abs(r.outputs.td_F_sup_bot - (P4 * 21 / W + P5)) < 1e-6);
  assert.deepEqual(r.segsLocal.map(([a, b, v]) => [a, b, Math.round(v * 100) / 100]), segs);
  assert.ok(checksOf(out, 'x-E').every(c => c.ok), checksOf(out, 'x-E').filter(c => !c.ok).map(c => c.msg).join(' | '));
  assert.ok(cs.lines.length && checksOf(out, 'x-E').find(c => c.code === 'equilibrium').ok, 'Σ line forces = load (16,741 lb)');
  assert.deepEqual(['SW-8', 'SW-10', 'SW-6'].map(m => Math.round(share(out, 'x-E', m))), [2762, 5805, 8173]);
  assert.ok(codes(out, 'warnings').includes('td-load-on-support'));
};
test('11-04 c: Roof E-W with TD2 drawn y 0–29 — loads 4 (back span), 5 (on support 5), 5.5 (overhang, short of the tip): runs, every member run closes, SW-8 / SW-10 / SW-6 = 2762 / 5805 / 8173 lb (SWD v25 + doubles)', () => {
  const { out } = roofOk(i => { i.tds.find(x => x.mark === 'TD2').y2 = '29'; });
  roofChecks(out, [-137, -2214, 0]);
});
test('11-04 d: … or kept y 0–32 with a second overhang from 2 to 1.7 — same results (overhangs at both ends)', () => {
  const { out } = roofOk((i, G) => { i.tds.find(x => x.mark === 'TD2').overhangs.push({ fromId: G('2'), toId: G('1.7'), at: '' }); });
  roofChecks(out, [-137, -2214, 0], [[24, 27, 0], ...ROOF_SEGS]); // + the overhang 29–32 past support 2: no TD shear
  assert.deepEqual(out.tds.find(t => t.mark === 'TD2').tips, { bottom: -5, top: 27 });
});
test('11-04 e: Auto load lines search the overhang (Roof TD2: 4 and 5.5; not 1.7 at the far end any more)', () => {
  const { out } = roofOk(i => { const t = i.tds.find(x => x.mark === 'TD2'); t.y2 = '29'; t.loadsMode = 'auto'; t.loads = []; });
  assert.deepEqual(loadLines(out, 'TD2'), ['4-', '5.5+']);
});

test('11-04 f: Ex 3.4 (load at the tip) superposed = the direct cantilever run (support forces, shears, every member run)', () => {
  const a = calcAll(ex34()), s = calcAll(ex34(), {}, { superposeFrom: 1 });
  const ra = runOf(a, 'TD1'), rs = runOf(s, 'TD1');
  assert.ok(!ra.superposed && rs.superposed && rs.superposed.runs[0].kind === 'bottom');
  for (const k of ['td_F_sup_top', 'td_F_sup_bot']) assert.ok(Math.abs(ra.outputs[k] - rs.outputs[k]) < 1e-6, k);
  assert.deepEqual(rs.segsLocal.map(x => x.map(v => Math.round(v * 1e6) / 1e6)), [[0, 60, 57.75], [-15, 0, -231]]);
  const N = out => out.analysis.cases.flatMap(c => c.members.flatMap(m => m.runs.map(r => [m.name, Math.round(r.max * 1e3), Math.round(r.residual * 1e3)])));
  assert.deepEqual(N(s), N(a));
});

test('11-04 g: overhangs at both ends — Ex 3.4 with supports 2 / 2.9 (tips 1 and 3) and its mirror image (the load on the overhang past the top support: mirrored run) give beam statics and the same member forces', () => {
  const both = mirror => ex34(i => {
    i.grids.push({ id: 'g29', name: '2.9', axis: 'x', at: '60', ref: false });
    const id = n => i.grids.find(g => g.name === n).id, t = i.tds[0];
    t.supports = [id('2'), id('2.9')];
    t.overhangs = [{ fromId: id('2'), toId: id('1'), at: '' }, { fromId: id('2.9'), toId: id('3'), at: '' }];
    t.loadsMode = 'manual'; t.loads = [{ gridId: id('1'), side: '+' }]; // the book's strut only (Auto also finds wall line 3 at the new tip)
    if (mirror) {
      const X = v => String(75 - Number(v));
      i.grids.filter(g => g.axis === 'x').forEach(g => { g.at = X(g.at); });
      i.outline = i.outline.map(p => ({ x: X(p.x), y: p.y })).reverse();
      for (const o of [...i.tds, ...i.diaphragms.flatMap(d => d.parts)]) [o.x1, o.x2] = [X(o.x2), X(o.x1)];
      i.loads.forEach(l => l.segments.forEach(s => { [s.from, s.to] = [X(s.to), X(s.from)]; }));
    }
  });
  const a = calcAll(both(false)), b = calcAll(both(true));
  const ra = runOf(a, 'TD1'), rb = runOf(b, 'TD1');
  assert.equal(ra.terminal, 'OUTPUT'); assert.equal(rb.terminal, 'OUTPUT');
  assert.equal(ra.superposed.runs[0].kind, 'bottom'); assert.equal(rb.superposed.runs[0].kind, 'top');
  // statics, W = 45: the tip load P at 15 ft past support 2 → 2: P·60/45, 2.9: −P·15/45 (same P both ways)
  const P = ra.P[0];
  assert.ok(Math.abs(rb.P[0] - P) < 1e-6);
  assert.ok(Math.abs(ra.outputs.td_F_sup_bot - P * 60 / 45) < 1e-6 && Math.abs(ra.outputs.td_F_sup_top + P * 15 / 45) < 1e-6);
  assert.ok(Math.abs(rb.outputs.td_F_sup_top - P * 60 / 45) < 1e-6 && Math.abs(rb.outputs.td_F_sup_bot + P * 15 / 45) < 1e-6, 'mirrored: top / bottom swap');
  // TD shear: 0 on the far overhang; mirrored = same magnitudes, opposite sign in the TD frame order
  assert.deepEqual(ra.segsLocal.map(x => Math.round(x[2] * 1e6)), [0, Math.round(-P / 3 / 20 * 1e6), Math.round(P / 20 * 1e6)]);
  const mags = out => out.analysis.cases.flatMap(c => c.members.flatMap(m => m.runs.map(r => Math.round(Math.abs(r.max) * 100)))).sort((p, q) => p - q);
  assert.deepEqual(mags(b), mags(a));
});

test('11-04 j: TD card — overhangs picked by grid ("from" a support "to" a grid); "+ overhang" proposes the support the TD runs past and the grid at its end (Roof TD2: from 2 to 1.7)', async () => {
  const { renderPlanEditor, newEditorState } = await import('../src/modules/tdPlanEditor.js');
  const { parsePlan } = await import('../src/modules/tdGeometry.js');
  const i = structuredClone(fx('adu-roof-1104').inputs), G = n => i.grids.find(g => g.name === n).id;
  normalizeInputs(i);
  const st = { ...newEditorState(), page: 'diaphragms', dir: 'x', sel: { kind: 'td', id: i.tds.find(x => x.mark === 'TD2').id } }; // TDs tab, TD2 (2026-11-06)
  const draw = () => { const box = document.createElement('div'); box.appendChild(renderPlanEditor({ inputs: i, plan: parsePlan(i), errors: [], state: st, refresh() {} })); return box; };
  let box = draw();
  assert.equal(box.querySelectorAll('[data-overhang]').length, 1);
  assert.ok(box.textContent.includes('Overhangs'));
  [...box.querySelectorAll('button')].find(b => b.textContent === '+ overhang').dispatchEvent(new window.Event('click'));
  const t = i.tds.find(x => x.mark === 'TD2');
  assert.deepEqual(t.overhangs[1], { fromId: G('2'), toId: G('1.7'), at: '' });
  box = draw();
  assert.equal(box.querySelectorAll('[data-overhang]').length, 2);
  assert.ok(![...box.querySelectorAll('button')].some(b => b.textContent === '+ overhang'), 'one overhang per support: no third');
  assert.ok([...box.querySelectorAll('button')].some(b => b.textContent === '+ load line'), '+ load line on a cantilever TD');
});

test('11-04 h: one run\'s TD shear by where its load is (span / bottom / top / support), W = 10', () => {
  const o = { td_v_s1: 1, td_v_s3: 2 };
  const at = (kind, y) => [15, 5, 1, -1, -5].map(m => vRun({ kind, y, outputs: o }, m, 10)); // m: top overhang, span, span, bottom overhang ×2
  assert.deepEqual(at('span', 3), [0, 1, 2, 0, 0]);
  assert.deepEqual(at('bottom', -3), [0, 1, 1, 2, 0]); // 0 from the load (−3) to the tip
  assert.deepEqual([18, 12, 5, -1].map(m => vRun({ kind: 'top', y: 14, outputs: o }, m, 10)), [-0, -2, -1, -0]); // mirrored: y′ = −4
  assert.deepEqual(at('support', 0), [0, 0, 0, 0, 0]);
});

test('11-04 i (Q2): a case that balances but has open member runs FAILS and is held from Shear Wall Design; its member diagrams stay', () => {
  // Roof E-W as saved on 11-03 with TD2 on its wall lines 5 / 2: balances, chords O / B in the overhang stay open
  const { out } = run('adu-roof', (i, G) => { Object.assign(i.tds.find(t => t.dir === 'x'), { y1: '5', y2: '29', supports: [G('5'), G('2')], loads: [], loadsMode: 'auto' }); });
  const cs = kase(out, 'x-E');
  assert.ok(checksOf(out, 'x-E').find(c => c.code === 'equilibrium').ok, 'balances');
  assert.ok(!checksOf(out, 'x-E').find(c => c.code === 'closure').ok, 'member runs open');
  assert.ok(cs.notClosed && !cs.failed);
  assert.ok(checksOf(out, 'x-E').some(c => c.code === 'failed' && !c.ok && /do not close/.test(c.msg)));
  assert.ok(cs.members && cs.members.length, 'members kept on screen');
  const lf = n => out.lineForces.find(l => l.line === n).E;
  assert.deepEqual(['2', '4', '5'].map(lf), [null, null, null], 'E-W lines held');
  assert.ok(out.warnings.some(w => w.code === 'swd-held' && /do not close/.test(w.msg)));
  // a case that closes still sends its forces (the N-S case of the same item: lines A, E)
  assert.ok(['A', 'E'].every(n => lf(n) > 1), JSON.stringify(out.lineForces));
});

// ── Step C: closure solver keeps equilibrium; a case out of balance fails; an offset line needs a strut ──
test('4a: the closure solver keeps Σ line forces = load; book cases still close in one step (Ex 3.3, Ex 8.1, Ex 8.4)', () => {
  for (const id of ['Ex3.3', 'Ex8.1', 'Ex8.4']) {
    const out = calcAll(bookToInputs(books().find(b => b.id === id)));
    const cs = out.analysis.cases.find(c => c.offset);
    assert.equal(cs.offset.passes.length, 2, id + ': flexible start + one step');
    assert.ok(out.checks.filter(c => c.code === 'equilibrium').every(c => c.ok), id);
  }
});

test('4a: the user\'s Roof E-W (offset line 4/5, TD2 with three load lines) balances: Σ line forces = 16,740 lb', () => {
  const { out } = run('adu-roof');
  assert.ok(out.checks.filter(c => c.code === 'equilibrium').every(c => c.ok), out.checks.filter(c => c.code === 'equilibrium').map(c => c.msg).join(' | '));
});

test('4c: Roof E-W with TD2 on its wall lines 5 / 2 — balances, SW-8 / SW-10 / SW-6 = 1312 / 7073 / 8355 lb; only the overhang chords O, B stay open (since 11-04 the case FAILS for it — test 11-04 i)', () => {
  const { out } = run('adu-roof', (i, G) => { Object.assign(i.tds.find(t => t.dir === 'x'), { y1: '5', y2: '29', supports: [G('5'), G('2')], loads: [], loadsMode: 'auto' }); });
  assert.ok(out.checks.filter(c => c.code === 'equilibrium').every(c => c.ok));
  for (const [m, v] of [['SW-8', 1312], ['SW-10', 7073], ['SW-6', 8355]]) assert.ok(Math.abs(share(out, 'x-E', m) - v) < 1, m + ' ' + share(out, 'x-E', m));
  const cl = out.checks.find(c => c.caseId === 'x-E' && c.code === 'closure');
  assert.match(cl.msg, /20 of 22 member runs close — open: O \(5–32\): -73 lb of max \d+; B \(0–32\): 130 lb/);
});

test('4b: a case whose line forces do not balance fails — FAILED check, line forces held from Shear Wall Design (null), no member checks', () => {
  const { out } = run('adu-2nd', caseD);
  const an = { cases: out.analysis.cases, lineForces: out.lineForces };
  const checks = out.checks.map(c => (c.caseId === 'x-E' && c.code === 'equilibrium' ? { ...c, ok: false, msg: '↔ E: load 8260 lb = Σ line forces 9000 lb' } : c));
  const warnings = [];
  const link = { lines: out.wallLink.lines.map(l => ({ ...l, grid: { id: l.grid && out.analysis.cases[0] && (out.analysis.cases.flatMap(c => c.lines).find(x => x.name === l.grid) || {}).gridId, name: l.grid }, lineId: l.lineId, dirId: l.dirId })), walls: [] };
  const res = equilibriumGate(an, checks, link, warnings);
  const cs = an.cases.find(c => c.id === 'x-E');
  assert.match(cs.failed, /do not balance the load/);
  assert.ok(res.some(c => c.caseId === 'x-E' && c.code === 'failed' && !c.ok));
  assert.ok(!res.some(c => c.caseId === 'x-E' && c.code === 'closure'), 'member closure not reported');
  assert.ok(res.some(c => c.caseId === 'y-E' && c.code === 'closure'), 'the other case untouched');
  for (const f of an.lineForces.filter(l => l.line === '4' || l.line === '5' || l.line === '2')) assert.equal(f.E, null, f.line);
  assert.ok(an.lineForces.filter(l => l.line === 'A' || l.line === 'E').every(f => f.E !== null));
  assert.ok(warnings.some(w => w.code === 'swd-held'));
});

test('7: an offset line needs a strut — 2nd floor 4/5 is an error (user decision D1); Roof 4/5, Ex 3.3 B/C, Ch 8.4 D/E pass', () => {
  const { out } = run('adu-2nd', i => { i.wallLink.groups = [{ id: 'g', name: '4/5', exclude: [], lineIds: ['ln-4', 'ln-5'] }]; });
  const e = out.errors.find(x => x.code === 'group-no-path');
  assert.ok(e, codes(out).join(','));
  assert.match(e.msg, /Offset line 4\/5 \(lines 4, 5\): no strut connects its lines/);
  assert.ok(!codes(run('adu-roof').out).includes('group-no-path'));
  for (const id of ['Ex3.3', 'Ex8.4']) assert.ok(!codes(calcAll(bookToInputs(books().find(b => b.id === id)))).includes('group-no-path'), id);
});

// ── Step D: a TD drawn past its supports ──
test('5b: a simple-span TD drawn past its supports is an error naming the stretch (Roof as first drawn: TD1 / TD2 y 0–32 on 5 / 29)', () => {
  const { out } = run('adu-roof-first', i => { i.loads = i.loads.filter(l => l.kind === ''); });
  const e = out.errors.filter(x => x.code === 'td-past-support');
  assert.equal(e.length, 2);
  assert.match(e[0].msg, /runs past its supports 5 \(y 0–5\) and 2 \(y 29–32\)/);
  // the user's current items: none
  for (const n of ['adu-roof', 'adu-2nd']) assert.ok(!codes(run(n).out).includes('td-past-support'), n);
});

console.log(passed + ' passed');
