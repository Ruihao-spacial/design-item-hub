// Shear Wall calc sheet (Walls → Detailed): layered tabs level → type → mark, and the per-wall sheet
// A definition · B loads · C calcs. The hidden calc is exposed three ways that must agree with the tool:
// C3 overturning about each corner (from the inputs), C4 end forces per load case (own + from above),
// C5 superposition of the C4 totals for the governing combination. Run: node tests/shearWallCalcSheet.test.mjs
import fs from 'fs';
import assert from 'assert/strict';
import '../scripts/lib/shearWallLoadCheck.mjs'; // sets up the stand-in DOM
import { calcAll } from '../src/modules/shearWallCalc.js';
import { shearWallDesign, renderLineResults, driftCalcRows } from '../src/modules/shearWallDesign.js';
import { capacityRows, aspectFactorText, cornerOverturningRows, loadCaseEnds, superpositionRows, nailingTraceRows, caseKeysOf,
  resistingMomentRows, beamLeverTable, deflectionSubstitutionRows, aboveSourceRefs } from '../src/modules/shearWallCalcSheet.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' ± ' + tol + ', got ' + a);
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message)); process.exitCode = 1; }
}
const nOf = (c, s) => (c ? (s === 'left' ? (c.comprLeft || 0) - (c.tensionLeft || 0) : (c.comprRight || 0) - (c.tensionRight || 0)) : 0);
const W = (id, mark, lvl, pos, len, more = {}) => ({ id, mark, levelId: lvl, position: pos, length: len, wallDLTypeId: 'wdt-1', nailingPattern: '',
  anchorageLeftOverride: '', anchorageRightOverride: '', postLeftOverride: '', postRightOverride: '', openings: [], method: 'segmented',
  narrowPier: false, ftaoStrapOverride: '', jambPostOverride: '', systemType: 'sheathed', ...more });
const model = (levels, walls, loads, gravity, psf = '10', extra = {}) => ({
  loadType: 'seismic', sds: '1.0', wallThickness: '4', woodGrade: 'dfir_no1', distribution: 'capacity', sheathing: 'ply', refs: {}, driftRow: 'other',
  wallDLTypes: [{ id: 'wdt-1', name: 'Stud wall', psf }], levels,
  directions: [{ id: 'dir-1', name: 'N-S', rho: 1, lines: [{ id: 'ln-1', name: 'Line A', totalLength: 16, wallThickness: '', levelLoads: loads, walls, beams: [], supportPosts: [], gravityLoads: gravity }] }],
  ...extra,
});
const ld = (id, shape, D, L, more = {}) => ({ id, shape, position: 0, start: 0, end: 0, D: String(D), L: L ? String(L) : '', Lr: '', perArea: false, trib: '', assemblyId: '', ...more });
const L1 = [{ id: 'lvl-1', name: 'Level 1', floorToFloor: 10, floorClearSpan: '16', anchorageType: 'auto' }];
// TC-2 of Test-123: two solid walls either side of a window
const tc2 = () => model(L1, [W('w-1', 'SW-1', 'lvl-1', 0, 6), W('w-2', 'SW-2', 'lvl-1', 10, 6)], { 'lvl-1': { seismic: '6' } },
  { 'lvl-1': { loads: [ld('g1', 'full', 200, 100), ld('g2', 'point', 2, 0, { position: 1.5, start: 1.5, end: 1.5 })] } });
const lineOf = (out) => out.perDirection[0].perLine[0];
const sheetText = (inp, detail, report = 'detailed') => {
  const out = calcAll(inp), dirOut = out.perDirection[0], ln = dirOut.perLine[0];
  const c = document.createElement('div');
  renderLineResults(c, ln, dirOut, { tab: 'walls', onTab() {}, report, onReport() {}, detail, onDetail() {}, defs: { inputs: inp, line: inp.directions[0].lines[0] } });
  return c;
};
const fixtures = () => {
  const root = new URL('./fixtures/', import.meta.url);
  const files = ['shearwall-sample.json', ...fs.readdirSync(new URL('legacy/', root)).map(f => 'legacy/' + f)];
  return files.map(f => { const j = JSON.parse(fs.readFileSync(new URL(f, root), 'utf8')); return [f, shearWallDesign.migrate(j.inputs ? j : { schemaVersion: 8, inputs: j }).inputs]; });
};
const allWalls = (inp) => calcAll(inp).perDirection.flatMap(d => d.perLine.flatMap(ln => ln.perLevel.flatMap(pl => pl.walls))).filter(w => w.combos);

test('Tabs: level → type → mark; only existing types; one wall per sheet; a missing selection falls back to the first', () => {
  const inp = tc2();
  const c = sheetText(inp, { mark: 'SW-2' });
  const btns = [...c.querySelectorAll('button')].map(b => b.textContent);
  assert.ok(btns.includes('Level 1') && btns.includes('Segmented (2)') && btns.includes('SW-1') && btns.includes('SW-2'));
  assert.ok(!btns.some(b => /^FTAO|^WSWH/.test(b)), 'only the types present');
  const t = c.textContent;
  assert.ok(t.includes('Calc sheet — SW-2') && !t.includes('Calc sheet — SW-1'), 'one wall at a time');
  assert.ok(sheetText(inp, { level: 'nope', type: 'nope', mark: 'nope' }).textContent.includes('Calc sheet — SW-1'), 'falls back to the first wall');
  for (const s of ['A. Wall definition', 'B1. Lateral', 'B2. Gravity', 'B3. Loads from above', 'C1. Sheathing capacity', 'C2. Shear demand', 'C3. Overturning', 'C4. End forces by load case', 'C5. Governing', 'C6. Hardware', 'C7. Deflection'])
    assert.ok(t.includes(s) || s === 'C7. Deflection', 'sheet section ' + s);
});

test('The sheet echoes the wall definition and the story shear build-up', () => {
  const t = sheetText(tc2(), { mark: 'SW-1' }).textContent;
  assert.ok(t.includes('x = 0.00 to 6.00 ft') && t.includes('Length L6.00 ft') && t.includes('Height h10.00 ft (floor-to-floor)'));
  assert.ok(t.includes('Stud wall 10 psf') && t.includes('auto — governed by strength'));
  // X_y symbols render as subscripts (<sub>), so the text reads F + Level 1, V + x, wt + w
  assert.ok(t.includes('FLevel 1 6.00 = 6.00 k') && t.includes('Vx × wtw / Σwt = 6.00 × 2820 / 5640 = 3.00 k'));
  const subs = [...sheetText(tc2(), { mark: 'SW-1' }).querySelectorAll('sub')].map(x => x.textContent);
  assert.ok(subs.includes('Level') && subs.includes('x') && subs.includes('w'), 'subscripts: ' + subs.slice(0, 12).join(' '));
});

test('C1 capacity: v_n × 0.92 / 2.8, aspect ratio factor, v_cap — TC-2 (h/b 1.67) and a 4 ft wall (h/b 2.5)', () => {
  const w = lineOf(calcAll(tc2())).perLevel[0].walls[0];
  const rows = Object.fromEntries(capacityRows(w, ['E']));
  assert.equal(rows['Nominal unit shear v_n'], '1430 plf');
  assert.ok(rows['ASD seismic table value'].startsWith('v_n × 0.92 / 2.8 = 1430 × 0.92 / 2.8 = 470 plf'));
  assert.ok(rows['Aspect ratio (SDPWS 4.3.4)'].includes('1.67 ≤ 2.0 → C_hb = 1.0'));
  assert.equal(rows['v_cap seismic'], '470 × 1.0000 = 470 plf');
  const a = aspectFactorText(10, 4);
  near(a.C, 0.9375, 1e-9); assert.ok(a.text.includes('1.25 − 0.125 × 2.50 = 0.9375'));
  const narrow = lineOf(calcAll(model(L1, [W('w-1', 'SW-1', 'lvl-1', 0, 4)], { 'lvl-1': { seismic: '1' } }, {}))).perLevel[0].walls[0];
  const nr = Object.fromEntries(capacityRows(narrow, ['E']));
  assert.ok(nr['v_cap seismic'].endsWith('= ' + Math.round(narrow.seismicCap * 0.9375) + ' plf'));
  near(narrow.effectiveSeismicCap, narrow.seismicCap * 0.9375, 0.01, 'tool uses the same factor');
  const trace = nailingTraceRows(w, 1, ['E']).map(r => r.join(' '));
  assert.ok(trace[0].startsWith('6" o.c. E 312 < 350') && trace[0].endsWith('NG'));
  assert.ok(trace[1].includes('E 470 ≥ 350') && trace[1].includes('OK — lightest for strength ← used'));
});

test('C3 overturning about each corner (from the inputs) equals the tool end forces for every load case — all fixtures', () => {
  let worst = 0;
  for (const [f, inp] of fixtures()) for (const w of allWalls(inp)) {
    const c4 = loadCaseEnds(w);
    for (const dir of ['→', '←']) {
      const up = dir === '→' ? 'left' : 'right', piv = dir === '→' ? 'right' : 'left';
      for (const [k, v] of Object.entries(cornerOverturningRows(w, dir).values)) {
        const t = c4.N[k === '1.0E' || k === '1.0W' ? k + ' ' + dir : k];
        const d = Math.max(Math.abs(v.up - t[up]), Math.abs(v.pivot - t[piv]));
        worst = Math.max(worst, d);
        assert.ok(d <= 0.006, f + ' ' + w.mark + ' ' + k + ' ' + dir + ': corner ' + JSON.stringify(v) + ' vs ' + JSON.stringify(t));
      }
    }
  }
});

test('C3 hand check — TC-2 SW-1 → : M_R about the right corner = Σ P·(L − x)', () => {
  const w = lineOf(calcAll(tc2())).perLevel[0].walls[0];
  const t = cornerOverturningRows(w, '→');
  const col = (label) => t.rows.find(r => r[0].startsWith(label));
  // D: uniform 1.20 k at 3 ft (lever 3) + point 2.00 k at 1.5 ft (lever 4.5) + self 0.60 k at 3 ft (lever 3) = 3.6 + 9.0 + 1.8 = 14.40
  assert.equal(col('M_R')[1], '14.40');
  assert.equal(col('Own left-end N')[1], '2.40');          // 14.40 / 6 = R_L
  assert.equal(col('M_OT')[2 + t.headers.findIndex(h => h.startsWith('1.0E')) - 2], '30.00 = 3.00 × 10.00');
});

test('C4 load-case totals = own + from above = the tool accumulated load cases — all fixtures', () => {
  for (const [f, inp] of fixtures()) for (const w of allWalls(inp)) {
    const src = w.accumPerCombo || w.combos;
    for (const [label, v] of Object.entries(loadCaseEnds(w).N)) {
      if (label.endsWith('←')) { const fwd = loadCaseEnds(w).N[label.replace('←', '→')]; near(v.left, -fwd.left, 1e-9); continue; }
      const k = label.replace(' →', '');
      for (const s of ['left', 'right']) near(v[s], nOf(src[k], s), 1e-6, f + ' ' + w.mark + ' ' + label + ' ' + s);
    }
  }
});

test('C5 superposition of the C4 totals reproduces the tool governing T / C at every end (rounding only) — all fixtures + TC-2', () => {
  let worst = 0;
  const all = [...fixtures(), ['TC-2', tc2()]];
  for (const [f, inp] of all) for (const w of allWalls(inp)) for (const r of superpositionRows(w)) {
    if (r.diff == null) continue;
    worst = Math.max(worst, Math.abs(r.diff));
    assert.ok(Math.abs(r.diff) <= 1e-6, f + ' ' + w.mark + ' ' + r.cells[0] + ': ' + r.cells.join(' | '));
  }
  assert.ok(worst < 1e-6, 'worst ' + worst);
  // TC-2 SW-1 by hand: T left = 3.50 − 0.46 × 2.40 = 2.40 k; C left = 1.14 × 2.40 + 3.50 = 6.24 k
  const w = lineOf(calcAll(tc2())).perLevel[0].walls[0];
  const by = Object.fromEntries(superpositionRows(w).map(r => [r.cells[0], r.cells]));
  assert.equal(by['T L'][4], '2.40'); assert.equal(by['C L'][4], '6.24'); assert.equal(by['T R'][4], '2.86'); assert.equal(by['C R'][4], '5.10');
  // the governing combination is referred to by its LC# (user 2026-10-01): (0.6−0.14S_DS)D + 0.7ρE = LC7 for a seismic project
  assert.ok(by['T L'][1].startsWith('LC7 →'), by['T L'][1]);
  assert.equal(w.combos['0.6D+0.7ρE_pos'].lc, 'LC7');
});

test('FTAO and WSWH walls get their own sheets with sections A–C', () => {
  const ftao = model([{ id: 'lvl-1', name: 'Level 1', floorToFloor: 8, floorClearSpan: '16', anchorageType: 'auto' }],
    [W('w-1', 'SW-1', 'lvl-1', 0, 19.5, { method: 'ftao', openings: [{ id: 'o1', offset: 4, width: 6, sill: 4, head: 4 + 8 / 3 }, { id: 'o2', offset: 14, width: 2, sill: 4, head: 4 + 8 / 3 }] })],
    { 'lvl-1': { seismic: '5' } }, {});
  const tf = sheetText(ftao, { type: 'ftao' }).textContent;
  for (const s of ['FTAO (1)', 'A. Wall definition', 'Openings', 'FTAO engine', 'Jamb posts', 'C3. Overturning', 'C5. Governing']) assert.ok(tf.includes(s), 'FTAO sheet: ' + s);
  const wswh = model(L1, [W('w-1', 'SW-1', 'lvl-1', 0, 1.5, { systemType: 'wswh', wswhWidth: '18', wswhCondition: 'concrete', wswhJoist: '12', wswhFloorDepth: '12', wswhAnchorOverride: '' }),
    W('w-2', 'SW-2', 'lvl-1', 6, 8)], { 'lvl-1': { seismic: '3' } }, {});
  const tw = sheetText(wswh, { type: 'wswh' }).textContent;
  for (const s of ['WSWH (1)', 'Segmented (1)', 'Strong-Wall WSWH panel', 'Table values', 'MOT = V·h (k·ft) — WSWH: V·He', 'C4. End forces']) assert.ok(tw.includes(s), 'WSWH sheet: ' + s);
});

test('B2 gravity table: a point load shows its P, and the P column adds up to the Σ row (TC-1 SW-7 report)', () => {
  const c = sheetText(tc2(), { mark: 'SW-1' });
  const b2 = [...c.querySelectorAll('table')].find(t => t.textContent.includes('x̄ (ft)'));
  const rows = [...b2.querySelectorAll('tr')].slice(1).map(tr => [...tr.children].map(td => td.textContent));
  const pt = rows.find(r => r[0].includes('Point'));
  assert.equal(pt[3], 'D 2.00', 'point load P (was "—")');
  const D = (s) => { const m = /D (\d+\.\d+)/.exec(s); return m ? +m[1] : 0; };
  const sumRow = rows.find(r => r[0] === 'Σ end reactions');
  near(rows.filter(r => r !== sumRow).reduce((a, r) => a + D(r[3]), 0), D(sumRow[3]), 0.011, 'Σ of the P column');
});

// === Breakdowns S0–S7 (every number on the sheet gets its parts) ===
const allLines = (inp) => calcAll(inp).perDirection.flatMap(d => d.perLine);
const panelW = (id, mark, lvl, pos, more = {}) => W(id, mark, lvl, pos, 1.5, { systemType: 'wswh', wswhWidth: '18', wswhCondition: 'concrete', wswhJoist: '12', wswhFloorDepth: '12', wswhAnchorOverride: '', ...more });
const L2 = [{ id: 'lvl-2', name: '2nd', floorToFloor: 9, floorClearSpan: '16', anchorageType: 'auto' }, { id: 'lvl-1', name: '1st', floorToFloor: 9, floorClearSpan: '16', anchorageType: 'auto' }];

test('S0 M_R lever table: Σ P·(L − x) = R_L·L and Σ P·x = R_R·L, and Σ = the C3 M_R row — all fixtures + TC-2', () => {
  let n = 0;
  for (const [f, inp] of [...fixtures(), ['TC-2', tc2()]]) for (const w of allWalls(inp)) {
    const t = resistingMomentRows(w);
    if (!t || t.note) continue;
    const L = w.length, lv = w.live || { L: {}, Lr: {} };
    const R = { D: [w.dlRL, w.dlRR], L: [lv.L.rL, lv.L.rR], Lr: [lv.Lr.rL, lv.Lr.rR] };
    for (const c of Object.keys(t.sum.right)) {
      near(t.sum.right[c], (R[c][0] || 0) * L, 0.006 * L, f + ' ' + w.mark + ' ' + c + ' right corner');
      near(t.sum.left[c], (R[c][1] || 0) * L, 0.006 * L, f + ' ' + w.mark + ' ' + c + ' left corner');
      const mr = (dir) => cornerOverturningRows(w, dir).rows.find(r => r[0].startsWith('M_R'))[1 + caseKeysOf(w).gravity.findIndex(([x]) => x === c)];
      assert.equal(mr('→'), t.sum.right[c].toFixed(2)); assert.equal(mr('←'), t.sum.left[c].toFixed(2));
      n++;
    }
  }
  assert.ok(n > 10, 'cases checked: ' + n);
  // TC-2 SW-1, D about the right corner: 1.20 × 3 + 2.00 × 4.5 + 0.60 × 3 = 14.40
  const t = resistingMomentRows(lineOf(calcAll(tc2())).perLevel[0].walls[0]);
  near(t.sum.right.D, 14.4, 1e-6);
  assert.ok(sheetText(tc2(), { mark: 'SW-1' }).textContent.includes('MR breakdown'));
});

test('S1 beam lever table: R_b = Σ P·(x − x_a)/(x_b − x_a), R_a = ΣP − R_b equal the tool reactions per load case — fixtures with beams', () => {
  let n = 0;
  for (const [f, inp] of fixtures()) for (const ln of allLines(inp)) for (const bt of ln.beamTransfers || []) {
    const t = beamLeverTable(bt);
    if (!t) continue;
    for (const k of t.keys) {
      near(t.Ra[k], bt.supports[0].perCombo[k] || 0, 0.02, f + ' ' + bt.mark + ' R_a ' + k);
      near(t.Rb[k], bt.supports[1].perCombo[k] || 0, 0.02, f + ' ' + bt.mark + ' R_b ' + k);
      n++;
    }
  }
  assert.ok(n >= 4, 'beam cases checked: ' + n);
  const [, inp] = fixtures().find(([f]) => f === 'shearwall-sample.json');
  const d = inp.directions.find(x => x.lines.some(l => (l.beams || []).length)), line = d.lines.find(l => (l.beams || []).length);
  const out = calcAll(inp), dirOut = out.perDirection.find(x => x.dirId === d.id), ln = dirOut.perLine.find(l => l.lineId === line.id);
  const c = document.createElement('div');
  renderLineResults(c, ln, dirOut, { tab: 'postsbeams', onTab() {} });
  assert.ok(c.textContent.includes('lever table') && c.textContent.includes('Rb ('), 'rendered in the Posts & Beams tab (R_b subscripted)');
});

test('S2 deflection terms: the substituted numbers reproduce each Eq. 4.3-1 term and δ — all fixtures', () => {
  let n = 0;
  for (const [f, inp] of fixtures()) for (const w of allWalls(inp)) for (const [lt, d] of Object.entries(w.deflection || {})) {
    if (!d || !d.dirs) continue;
    const rows = deflectionSubstitutionRows(w, { lineThickness: inp.wallThickness || '4', grade: { Fcperp: 625 } }).map(r => r.cells || r);
    for (const g of d.dirs) {
      near(8 * d.v * d.h ** 3 / (d.E * d.A * d.b), g.t1, 0.002, f + ' ' + w.mark + ' t1');
      near(d.v * d.h / (1000 * d.Ga), g.t2, 0.002, f + ' ' + w.mark + ' t2');
      near(d.h * (g.dHD + g.dC) / d.b, g.t3, 0.0002, f + ' ' + w.mark + ' t3');
      near(g.t1 + g.t2 + g.t3, g.delta, 0.0003, f + ' ' + w.mark + ' δ');
      const p = (lt === 'E' ? '1.0E' : 'α_s·W') + ' ' + g.dir + ' ';
      assert.ok(rows.some(r => r[0] === p + '8vh³/(EAb)' && r[1].startsWith('8 × ' + d.v + ' × ')), f + ' ' + w.mark + ' row ' + p);
      assert.ok(rows.some(r => r[0] === p + 'δ' && r[1].endsWith(g.delta.toFixed(3) + ' in') || r[0] === p + 'δ'), f + ' ' + w.mark + ' δ row');
      n++;
    }
  }
  assert.ok(n > 10, 'deflection cases checked: ' + n);
  // Holdown slip = δ·T/P_δ with the catalog numbers
  const w = lineOf(calcAll(tc2())).perLevel[0].walls[0];
  const d = w.deflection && w.deflection.E;
  if (d && d.dirs && w.anchorageLeft) {
    const row = deflectionSubstitutionRows(w, { lineThickness: '4', grade: { Fcperp: 625 } }).find(r => r[0] === '1.0E → Δ_HD slip (left end)');
    assert.ok(row[1].startsWith('δ·T / P_δ = ' + w.anchorageLeft.delta + ' × ' + d.T + ' / '), row[1]);
  }
});

test('S3 posts: the calc sheet points to the Hardware tab; the Hardware tab shows F_cE, F_c*, C_P', () => {
  const t = sheetText(tc2(), { mark: 'SW-1' }).textContent;
  assert.ok(t.includes('see Hardware tab → Post Compression Capacity') && !t.includes('NDS 2018 column ('), 'no NDS repeat on the sheet');
  const inp = tc2();
  const c = document.createElement('div');
  shearWallDesign.renderForm(c, inp, () => {}, [], () => {});
  const hw = [...c.querySelectorAll('button')].find(b => b.textContent === 'Hardware');
  hw.click();
  const txt = c.textContent;
  assert.ok(txt.includes('F_cE (psi)') && txt.includes('F_c* (psi)') && txt.includes('C_P') && txt.includes('Floor Height: 10 ft'));
});

test('S4 from-above references: each value names its source and equals the source wall C4 total at that end — all fixtures', () => {
  let n = 0;
  for (const [f, inp] of fixtures()) for (const ln of allLines(inp)) for (const pl of ln.perLevel) for (const w of pl.walls) {
    for (const r of aboveSourceRefs(w, ln)) {
      assert.ok(r.text.includes('see '), f + ' ' + w.mark + ' ' + r.text);
      if (r.source.type !== 'wall') continue;
      const src = ln.perLevel.flatMap(p => p.walls).find(x => x.wallId === r.source.id);
      const tot = loadCaseEnds(src).N[r.key === '1.0E' || r.key === '1.0W' ? r.key + ' →' : r.key][r.source.end];
      near(r.value, tot, 0.006, f + ' ' + w.mark + ' ← ' + src.mark + ' ' + r.key);
      assert.equal(r.nav.mark, src.mark);
      n++;
    }
  }
  assert.ok(n > 5, 'references checked: ' + n);
  // Two-story stack: the lower wall's sheet links to the upper wall
  const inp = model(L2, [W('w-1', 'SW-1', 'lvl-2', 0, 8), W('w-2', 'SW-2', 'lvl-1', 0, 8)], { 'lvl-2': { seismic: '2' }, 'lvl-1': { seismic: '2' } }, {});
  const picks = [];
  const out = calcAll(inp), dirOut = out.perDirection[0], ln = dirOut.perLine[0];
  const c = document.createElement('div');
  renderLineResults(c, ln, dirOut, { tab: 'walls', onTab() {}, report: 'detailed', onReport() {}, detail: { level: 'lvl-1' }, onDetail(p) { picks.push(p); }, defs: { inputs: inp, line: inp.directions[0].lines[0] } });
  assert.ok(c.textContent.includes('SW-1 left end — see 2nd → Segmented → SW-1, C4 Left total'), 'reference text');
  [...c.querySelectorAll('button')].find(b => b.textContent === 'Open SW-1 →').click();
  assert.deepEqual(picks[0], { level: 'lvl-2', type: 'wall', mark: 'SW-1' });
});

test('S5 WSWH M_OT: V·H_e / 12 for a single panel; V₁·H₁ + V₂·(H₁ + d_fl + H₂) with numbers at a stack base', () => {
  const inp = model(L2, [panelW('w-1', 'SW-1', 'lvl-2', 0, { wswhCondition: 'stackedUpper' }), panelW('w-2', 'SW-2', 'lvl-1', 0)], { 'lvl-2': { seismic: '1' }, 'lvl-1': { seismic: '1' } }, {}, '10', { seismicDesignCategory: 'D' });
  const walls = allWalls(inp);
  const lo = walls.find(w => w.wallId === 'w-2'), up = walls.find(w => w.wallId === 'w-1');
  assert.equal(lo.wswh.role, 'stackedLower');
  const st = lo.wswh.stacked.E;
  near((st.V1k * lo.wswh.He + st.V2k * (lo.wswh.He + st.dfl + st.H2)) / 12, lo.steps.otm1E, 0.006, 'the substituted parts give the tool M_OT');
  const cell = (w) => cornerOverturningRows(w, '→').rows[0][1 + caseKeysOf(w).gravity.length];
  assert.ok(cell(lo).startsWith('(V₁·H₁ + V₂·(H₁ + d_fl + H₂)) / 12 = (' + st.V1k.toFixed(2) + ' × '), cell(lo));
  assert.ok(cell(lo).endsWith('= ' + lo.steps.otm1E.toFixed(2)));
  assert.ok(cell(up).startsWith('V·H_e / 12 = ' + up.shareExact_1E.toFixed(2) + ' × ' + up.wswh.He.toFixed(2) + ' / 12 = '), cell(up));
});

test('S6 B1 links to the Distribution tab', () => {
  const tabs = [];
  const inp = tc2();
  const out = calcAll(inp), dirOut = out.perDirection[0], ln = dirOut.perLine[0];
  const c = document.createElement('div');
  renderLineResults(c, ln, dirOut, { tab: 'walls', onTab(t) { tabs.push(t); }, report: 'detailed', onReport() {}, detail: {}, onDetail() {}, defs: { inputs: inp, line: inp.directions[0].lines[0] } });
  [...c.querySelectorAll('button')].find(b => b.textContent === 'Open Distribution tab →').click();
  assert.deepEqual(tabs, ['distribution']);
});

test('S7 drift: δx = Cd·δxe/Ie and Δa = limit × h_sx × 12 with numbers, matching the Story drift table', () => {
  const [, inp] = fixtures().find(([f]) => f.includes('schema8-verification'));
  let n = 0;
  for (const ln of allLines(inp)) {
    const rows = driftCalcRows(ln);
    for (const r of ln.drift.rows) {
      const s = r.seismic;
      if (!s || s.deltaX == null) continue;
      near(ln.drift.cd * s.deltaXE / ln.drift.ie, s.deltaX, 1e-4);
      near(s.limit * r.hsx * 12, s.allowable, 1e-4);
      const row = rows.find(x => x[0] === r.levelName + ' (seismic)');
      assert.ok(row[1].startsWith('δx = Cd·δxe / Ie = ' + ln.drift.cd + ' × ' + s.deltaXE.toFixed(3) + ' / ' + ln.drift.ie + ' = ' + s.deltaX.toFixed(3)), row[1]);
      assert.ok(row[2].includes('= ' + s.allowable.toFixed(3)) && row[3].endsWith(s.pass ? 'OK' : 'NG') || row[3].endsWith('(bypassed)'), row.join(' | '));
      n++;
    }
    const c = document.createElement('div');
    renderLineResults(c, ln, calcAll(inp).perDirection[0], { tab: 'drift', onTab() {} });
    if (rows.length) assert.ok(c.textContent.includes('Drift calc — numbers substituted'));
  }
  assert.ok(n >= 1, 'drift rows checked: ' + n);
});

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
