// Simpson Strong-Wall SSWH (high-strength steel shearwall), SWD item 7 (user 2026-11-10).
// Data: Shearwall design reference/SSWH 11–16 (C-L-SW26 pp. 11–29) → scripts/buildSswhData.mjs → shearWallSswhData.js.
// Same rules as WSWH: concrete (T11), garage portal with SSWH-PKT (T12, T = k·V·H/B − P/2), wood floor (T13, joist × 0.91,
// DFL rim × 0.84), stacked 2nd story (T14, joist × 0.96, DFL rim × 0.95, TSS kit — no tension check), stack base -STK
// (T15 allowable base moment, M = V₁·h₁ + V₂·(h₂ + d)). Anchor arm B for concrete / stack base = p. 15 n.9 as printed.
// Example: C-L-SW26 p. 29 — SSWH24x8 over SSWH24x9-STK, 1,500 / 2,000 lb, 8 / 1 / 9 ft → M = 45,000 ≤ 49,905 ft·lb.
// Run: node tests/shearWallSswh.test.mjs
import assert from 'assert/strict';
import { checkShearWallItem } from '../scripts/lib/shearWallLoadCheck.mjs'; // sets up the stand-in DOM
import { calcAll } from '../src/modules/shearWallCalc.js';
import { lookupWswh, stackMoment, familyOf, isWswh } from '../src/modules/shearWallWswh.js';
import { SSWH_T11, SSWH_T12, SSWH_T13, SSWH_T14, SSWH_T15, SSWH_ARM } from '../src/modules/shearWallSswhData.js';
import { validateEngineeringInputs } from '../src/validation.js';
import { wallScheduleRows } from '../src/modules/shearWallDesign.js';
import { renderElevationForPdf } from '../src/modules/shearWallElevation.js';
import { cornerOverturningRows, caseKeysOf, loadCaseEnds } from '../src/modules/shearWallCalcSheet.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' ± ' + tol + ', got ' + a);
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message)); process.exitCode = 1; }
}

const P = (id, lv, more = {}) => ({ id, mark: id, levelId: lv, position: 2, length: 2, wallDLTypeId: '', nailingPattern: '', anchorageLeftOverride: '',
  anchorageRightOverride: '', postLeftOverride: '', postRightOverride: '', openings: [], method: 'segmented',
  systemType: 'sswh', wswhWidth: '24', wswhCondition: 'concrete', wswhJoist: '12', wswhAnchorOverride: '', ...more });
const base = (levels, walls, loads, more = {}) => ({ sds: '1.0', loadType: 'wind', wallThickness: '4', species: 'DF-L', woodGrade: 'dfir_no1', postGrade: 'dfir_pt_no1',
  wallDLTypes: [], sheathing: 'ply', alphaS: '', cd: '4', ie: '1', riskCategory: 'II', refs: {}, wswhFc: '2500', seismicDesignCategory: 'D',
  levels, directions: [{ id: 'd', name: 'N-S', rho: 1, lines: [{ id: 'l', name: 'A', totalLength: 20, wallThickness: '', levelLoads: loads, walls,
    beams: [], supportPosts: [], gravityLoads: more.gravity || {} }] }], ...more.inputs });
// p. 29: SSWH24x8 (2nd story, 8 ft) over SSWH24x9-STK (9 ft), 12" floor (Setup floor plate depth of the first story)
const p29 = (more = {}) => base([{ id: 'r', name: 'Roof', floorToFloor: 8, anchorageType: 'auto' }, { id: 'f2', name: '2nd Floor', floorToFloor: 9, anchorageType: 'auto', floorPlateDepth: '12' }],
  [P('U', 'r', { wswhCondition: 'stackedUpper', wswhJoist: '14', ...(more.upper || {}) }), P('B', 'f2')], { r: { wind: '1.5' }, f2: { wind: '2.0' } }, more);
const one = (wall, more = {}) => base([{ id: 'f1', name: '1st', floorToFloor: more.h || 9, anchorageType: 'auto' }], [P('S', 'f1', wall)], { f1: { wind: String(more.V || 2) } }, more);
const lineOf = (inp) => calcAll(inp).perDirection[0].perLine[0];
const wall = (ln, mark) => ln.perLevel.flatMap(pl => pl.walls).find(w => w.mark === mark);
const warnings = (ln) => ln.loadPathAudit.warnings.map(w => w.message);

test('Data = the reviewed SSWH tables (generator row counts, sample rows, arms as printed)', () => {
  assert.deepEqual([SSWH_T11.length, SSWH_T12.length, SSWH_T13.length, SSWH_T14.length, SSWH_T15.length], [204, 36, 34, 34, 34]);
  const r = SSWH_T11.find(x => x.model === 'SSWH24x9' && x.P_lb === 7500 && x.fc_psi === 2500);
  assert.deepEqual([r.V_ASDcap_W, r.Delta_ASDcap_W, r.T_ASDcap_W], [5360, 0.39, 32230]);
  assert.equal(SSWH_T14.find(x => x.model === 'SSWH24x8').V_ASDcap_W, 3625);
  assert.equal(SSWH_T15.find(x => x.model === 'SSWH24x9').M_ASDcap_W, 49905);
  assert.deepEqual(SSWH_ARM.map(a => a.B_concrete_in), [7.75, 9.5, 12, 14.675, 17.5], 'p. 15 n.9 as printed (user 2026-11-10)');
  assert.deepEqual(SSWH_ARM.map(a => a.B_wood_in), [8, 11, 14, 17, 20], 'W − 4 (p. 21 n.9)');
  assert.ok(isWswh({ systemType: 'sswh' }) && familyOf({ systemType: 'sswh' }) === 'SSWH' && familyOf({ systemType: 'wswh' }) === 'WSWH');
});

test('C-L-SW26 p. 29: SSWH24x8 over SSWH24x9-STK — M = 45,000 ≤ M_allow 49,905 ft·lb; 2nd story V 1,500 ≤ 3,625; TSS kit, no tension at the 2nd story', () => {
  const ln = lineOf(p29());
  const U = wall(ln, 'U'), B = wall(ln, 'B');
  assert.equal(B.wswh.family, 'SSWH'); assert.equal(B.wswh.role, 'stackedLower');
  const st = B.wswh.stacked.W;
  near(st.M1, 45000, 1e-6, 'M(1.0)');
  near(st.Mallow, 49905, 1e-9, 'T15 table value');
  assert.equal(B.wswh.orderModel, 'SSWH24x9-STK');
  near(U.wswh.Vcap.W, 3625, 1e-9, 'T14 (Simpson\'s 3,900 in the example is unpublished data at P = 3,750 lb)');
  near(U.wswh.Vd.W, 0.6 * 1500, 1e-9);
  // 2nd story: no B, no tension (user 2026-11-10) — hold-down = the kit
  assert.equal(U.anchorageLeft.id, 'SSWH-TSS_KT'); assert.ok(U.anchorageLeft.byKit);
  assert.equal(U.combos['1.0W'].tensionLeft, 0); assert.equal(U.governingTensionLeft, 0);
  // base anchors: T = M / B (concrete arm 17.5 in), SWH-AB from Table 06
  near(B.combos['1.0W'].tensionLeft, 45 / (17.5 / 12), 1e-9);
  assert.ok(/^SWH-AB /.test(B.anchorageLeft.id), B.anchorageLeft.id);
  assert.deepEqual(ln.checks.filter(c => c.status === 'fail').map(c => c.id), []);
  assert.ok(B.wswh.notes.some(n => /T15/.test(n)));
});

test('Stack base: P₁ > 4,000 lb → warning, the T15 table value is kept (no P interpolation)', () => {
  const ln = lineOf(p29({ gravity: { f2: { loads: [{ id: 'g', shape: 'full', D: '3000', L: '', Lr: '' }] } } }));
  const B = wall(ln, 'B');
  assert.ok(B.wswh.P.W > 4000);
  assert.ok(warnings(ln).some(m => /P₁ = \d+ lb exceeds 4,000 lb — the allowable base moment \(T15\)/.test(m)));
  near(B.wswh.stacked.W.Mallow, 49905, 1e-9);
});

test('Concrete (T11): interpolation on P inside the table; above 7,500 lb → warning, the 7,500 lb row is used', () => {
  const lk = lookupWswh({ family: 'SSWH', width: 24, condition: 'concrete', ftfFt: 9, P_lb: 5750 });
  near(lk.V.W, (5690 + 5360) / 2, 1e-9, 'halfway between 4,000 and 7,500 lb');
  assert.equal(lk.B, 17.5);
  const hi = lookupWswh({ family: 'SSWH', width: 24, condition: 'concrete', ftfFt: 9, P_lb: 9000 });
  assert.ok(!hi.error && hi.warnings.some(m => /9000 lb exceeds the tabulated 7500 lb/.test(m)));
  near(hi.V.W, 5360, 1e-9);
  const ln = lineOf(one({ wswhWidth: '15' }));
  const S = wall(ln, 'S');
  assert.equal(S.length, 1.25); assert.equal(S.wswh.evalModel, 'SSWH15x9'); assert.equal(S.wswh.B, 9.5);
  assert.deepEqual(ln.checks.filter(c => c.status === 'fail').map(c => c.id), []);
});

test('Garage portal (T12): SSWH12x8 with SSWH-PKT, T = k·V·H/B with k = 0.90; f\'c 4,000 table', () => {
  const ln = lineOf(one({ wswhWidth: '12', wswhCondition: 'portal' }, { h: 8, V: 1.5, inputs: { wswhFc: '4000' } }));
  const S = wall(ln, 'S');
  assert.equal(S.wswh.k, 0.9); assert.equal(S.wswh.kit, 'SSWH-PKT'); assert.equal(S.wswh.orderModel, 'SSWH12x8 w/ SSWH-PKT');
  near(S.wswh.Vcap.W, 2690, 1e-9, 'T12 SSWH12x8 f\'c 4,000, P ≤ 1,000 lb, wind');
  near(S.combos['1.0W'].tensionLeft, 0.9 * 1.5 * 93.25 / 7.75, 1e-9, 'k·V·H/B');
  assert.deepEqual(ln.checks.filter(c => c.status === 'fail').map(c => c.id), []);
  assert.ok(lineOf(one({ wswhWidth: '18', wswhCondition: 'portal' })).loadPathAudit.warnings.some(w => /SSWH18 is not tabulated/.test(w.message)));
});

test('Wood floor (T13) and stacked 2nd story (T14): joist and DFL rim factors; wood floor B = W − 4; kits', () => {
  const v = (cond, joist, rim) => lookupWswh({ family: 'SSWH', width: 18, condition: cond, ftfFt: 9, P_lb: 0, joist, rim });
  const w0 = v('raised', '12', 'LSL');
  near(w0.V.W, 2210, 1e-9); assert.equal(w0.B, 14); assert.equal(w0.kit, 'SSWH-RF18KT');
  near(v('raised', '16', 'DFL').V.W, 2210 * 0.91 * 0.84, 1e-9);
  const u0 = v('stackedUpper', '14', 'LSL');
  near(u0.V.W, 1710, 1e-9);
  near(v('stackedUpper', '18', 'DFL').V.W, 1710 * 0.96 * 0.95, 1e-9);
  const wp = lookupWswh({ family: 'SSWH', width: 18, condition: 'raised', ftfFt: 9, P_lb: 2500 });
  assert.ok(!wp.error && wp.warnings.some(m => /2,000 lb/.test(m)), 'wood floor P > 2,000 → warning');
});

test('Stack base table: interpolation on height; SSWH12 has no x13; equal width and family required for a stack', () => {
  const m = stackMoment(24, 8.5, 'SSWH');
  near(m.M.W, (49930 + 49905) / 2, 1e-9);
  assert.ok(stackMoment(12, 13, 'SSWH').error);
  // a WSWH over an SSWH is not a stack
  const inp = p29(); inp.directions[0].lines[0].walls[0].systemType = 'wswh'; inp.directions[0].lines[0].walls[0].wswhWidth = '24';
  assert.ok(lineOf(inp).loadPathAudit.warnings.some(w => /equal-width/.test(w.message)));
});

test('UI / report: an SSWH item opens, every tab and PDF section renders; validation knows the SSWH widths', () => {
  const r = checkShearWallItem({ schemaVersion: 13, inputs: p29() });
  assert.ok(r.ok, r.error);
  const bad = one({ wswhWidth: '20' });
  assert.ok(validateEngineeringInputs('shear_wall_design', bad).some(e => /SSWH width/.test(e)));
  assert.ok(!validateEngineeringInputs('shear_wall_design', one({ wswhWidth: '21' })).some(e => /width/.test(e)));
});

test('Stacked 2nd story shows "not calc / deferred (TSS kit)" — schedule, calc sheet, elevation; never a 0 tension', () => {
  const inp = p29();
  const ln = lineOf(inp);
  const U = wall(ln, 'U');
  const row = wallScheduleRows(ln.perLevel[0]).find(r => r[0].startsWith('U'));
  assert.equal(row[5], 'not calc / deferred (TSS kit)');
  assert.ok(/gravity only/.test(row[6]));
  const cell = cornerOverturningRows(U, '→').rows[0][1 + caseKeysOf(U).gravity.length];
  assert.ok(cell.startsWith('not calc / deferred — SSWH-TSS_KT'), cell);
  assert.ok(loadCaseEnds(U).rows.some(r => r[1] === 'not calc / deferred (TSS kit)'));
  const svg = renderElevationForPdf(inp.directions[0].lines[0], inp.levels, [], ln, 0, 'forces');
  const html = typeof svg === 'string' ? svg : svg.outerHTML;
  assert.ok(/not calc \/ deferred|deferred/.test(html), 'elevation strip');
});

console.log(passed + ' passed');
