// Shear Wall Phase 4: openings (segmented / FTAO), deflection & drift, LRFD forces, schema v6.
// Run: node tests/shearWallPhase4.test.mjs
import assert from 'assert/strict';
import { calcAll, computeWallTC, checkAspectRatio } from '../src/modules/shearWallCalc.js';
import { migrateV5toV6 } from '../src/modules/shearWallDesign.js';
import { deflectionTerms, driftLimit } from '../src/modules/shearWallDeflection.js';
import { ftaoCapacityLbf } from '../src/modules/shearWallFtaoAdapter.js';
import { getNailingById } from '../src/modules/shearWallNailing.js';
import { getGradeById } from '../src/modules/shearWallHardware.js';
import { wallPiers, openingProblems } from '../src/modules/shearWallOpenings.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' ± ' + tol + ', got ' + a);
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message)); process.exitCode = 1; }
}

// One direction, one line, one level; walls given per test
function oneStory(walls, { seismic = 10, wind = 0, floorH = 10, loadType = 'seismic', sds = 1.0, extra = {} } = {}) {
  return {
    sds, loadType, wallThickness: '4', woodGrade: 'dfir_no1', wallDLTypes: [], sheathing: 'ply',
    cd: '', ie: '', riskCategory: '', driftRow: 'other', alphaS: '', refs: {},
    levels: [{ id: 'lvl-1', name: '1st', floorToFloor: floorH, floorClearSpan: '16', anchorageType: 'auto' }],
    directions: [{ id: 'dir-1', name: 'N-S', rho: 1, lines: [{
      id: 'ln-1', name: 'A', totalLength: 60, wallThickness: '',
      levelLoads: { 'lvl-1': { seismic, wind } }, walls, beams: [], supportPosts: [], gravityLoads: {},
    }] }],
    ...extra,
  };
}
const wall = (id, position, length, more = {}) => ({
  id, mark: 'SW-' + id.split('-')[1], levelId: 'lvl-1', position, length, wallDLTypeId: '', nailingPattern: '',
  anchorageLeftOverride: '', anchorageRightOverride: '', postLeftOverride: '', postRightOverride: '',
  openings: [], method: 'segmented', narrowPier: false, ftaoStrapOverride: '', jambPostOverride: '', ...more,
});
const lineOf = (out) => out.perDirection[0].perLine[0];
const wallsOf = (out) => lineOf(out).perLevel.flatMap(p => p.walls);

test('Aspect ratio per SDPWS 2021: h/b 2.5 → 0.9375, h/b > 3.5 not permitted', () => {
  const a = checkAspectRatio(4, 10);
  near(a.reductionFactor, 0.9375, 1e-9); assert.equal(a.flag, true); assert.equal(a.notPermitted, false);
  assert.equal(checkAspectRatio(5, 10).reductionFactor, 1.0);
  const b = checkAspectRatio(2.8, 10);
  assert.equal(b.notPermitted, true); assert.equal(b.reductionFactor, 0);
});

test('h/b > 3.5 wall carries no shear and is flagged in the audit', () => {
  const out = calcAll(oneStory([wall('w-1', 0, 8), wall('w-2', 20, 2.5)]));
  const [w1, w2] = wallsOf(out);
  assert.equal(w2.share_1E, 0);
  near(w1.share_1E, 10, 0.01);
  assert.ok(lineOf(out).loadPathAudit.warnings.some(w => w.type === 'aspect_ratio' && w.elementId === 'w-2'));
});

test('Segmented wall with one opening = two separate walls', () => {
  const seg = calcAll(oneStory([wall('w-1', 0, 10, { openings: [{ id: 'op-1', offset: 4, width: 2, sill: 3, head: 7 }] })]));
  const sep = calcAll(oneStory([wall('w-1', 0, 4), wall('w-2', 6, 4)]));
  const a = wallsOf(seg), b = wallsOf(sep);
  assert.deepEqual(a.map(w => w.mark), ['SW-1a', 'SW-1b']);
  assert.deepEqual(a.map(w => w.parentWallId), ['w-1', 'w-1']);
  const pick = (w) => [w.position, w.length, w.share_1E, w.nailing.id, w.governingTensionLeft, w.governingComprRight, w.anchorageLeft.id, w.postRight.postId];
  assert.deepEqual(a.map(pick), b.map(pick));
});

test('Opening geometry problems → wall designed as solid, audit warning', () => {
  const bad = wall('w-1', 0, 10, { openings: [{ id: 'op-1', offset: 0.5, width: 3, sill: 3, head: 7 }] });
  assert.ok(openingProblems(bad, 10).some(p => /Pier 1/.test(p)));
  const out = calcAll(oneStory([bad]));
  const ws = wallsOf(out);
  assert.equal(ws.length, 1); assert.equal(ws[0].openingsIgnored, true); assert.equal(ws[0].length, 10);
  assert.ok(lineOf(out).loadPathAudit.warnings.some(w => w.type === 'openings'));
});

// APA T555 two-window wall: L = 4, 4, 3.5 ft; Lo = 6, 2 ft; h = 8 ft; ha 1.33 / ho 2.67 / hb 4
const t555Wall = (more = {}) => wall('w-1', 0, 19.5, {
  method: 'ftao', openings: [
    { id: 'op-1', offset: 4, width: 6, sill: 4, head: 4 + 8 / 3 },
    { id: 'op-2', offset: 14, width: 2, sill: 4, head: 4 + 8 / 3 },
  ], ...more,
});

test('FTAO wall alone in a line reproduces the APA T555 forces (V_ASD = 3750 lb)', () => {
  assert.deepEqual(wallPiers(t555Wall()).map(p => p.length), [4, 4, 3.5]);
  const out = calcAll(oneStory([t555Wall()], { seismic: 3750 / 0.7 / 1000, floorH: 8 }));
  const w = wallsOf(out)[0];
  assert.equal(w.method, 'ftao');
  const E = w.ftao.perType.E;
  near(E.V_ASD, 3750, 0.5); near(E.H, 1538, 1); near(E.va, 288, 1); near(E.Fmax, 866, 1);
  assert.deepEqual(E.piers.map(p => Math.round(p.v)), [337, 388, 244]);
  assert.ok(w.ftao.strap && w.ftao.strap.cap >= E.Fmax, 'strap carries Fmax');
  near(w.dcRatio, E.governing.dcr, 0.01);
});

test('FTAO capacity weight = engine V_cap,ASD in capacity-based distribution', () => {
  const inp = oneStory([t555Wall({ nailingPattern: '4' }), wall('w-2', 30, 8, { nailingPattern: '4' })], { floorH: 8 });
  const out = calcAll(inp);
  const [f, r] = wallsOf(out);
  const ctx = { floorH: 8, rho: 1, grade: getGradeById('dfir_no1'), sheathing: 'ply', lineThickness: '4', loadType: 'seismic' };
  const vcap = ftaoCapacityLbf(t555Wall({ nailingPattern: '4' }), ctx, getNailingById('4'), 'E');
  const expected = 10 * vcap / (vcap + 470 * 8);
  near(f.share_1E, expected, 0.011); near(r.share_1E, 10 - expected, 0.011);
});

test('FTAO engine hard stop (pier h_o/b > 3.5) → designed as solid, flagged', () => {
  const w = wall('w-1', 0, 12, { method: 'ftao', openings: [{ id: 'op-1', offset: 2, width: 8, sill: 1, head: 9 }] });
  const out = calcAll(oneStory([w]));
  assert.equal(wallsOf(out)[0].openingsIgnored, true);
  assert.ok(lineOf(out).loadPathAudit.warnings.some(x => x.type === 'openings' && /3\.5/.test(x.message)));
});

test('3-term deflection terms by hand (SDPWS Eq. 4.3-1 + Δc)', () => {
  const d = deflectionTerms({ v: 500, h: 10, b: 8, E: 1.7e6, A: 10.5, Ga: 16, T: 6250, anchorage: { cap: 7015, delta: 0.154 }, C: 6250, Ac: 10.5, Fcperp: 625 });
  near(d.t1, 0.0280, 0.0001); near(d.t2, 0.3125, 0.0001); near(d.dHD, 0.1372, 0.0001);
  near(d.dC, 0.0365, 0.0001); near(d.t3, 0.2171, 0.0001); near(d.delta, 0.5577, 0.0002);
});

test('Wall deflection uses 1.0E shear, selected posts/holdown, Ga for sheathing; drift vs Table 12.12-1', () => {
  const inp = oneStory([wall('w-1', 0, 8)], { seismic: 4, extra: { cd: '4', ie: '1.0', riskCategory: 'II' } });
  const out = calcAll(inp);
  const w = wallsOf(out)[0];
  const d = w.deflection.E;
  assert.equal(d.v, 500); assert.equal(d.h, 10); assert.equal(d.b, 8);
  assert.equal(d.Ga, getNailingById(w.nailing.id).gaPLY);
  assert.equal(d.T, 5000); // 1.0E lateral only: V·h/L = 4·10/8 k
  const drift = lineOf(out).drift.rows[0];
  near(drift.seismic.deltaXE, d.delta, 1e-9);
  near(drift.seismic.deltaX, 4 * d.delta, 1e-3);
  assert.equal(drift.seismic.limit, 0.020);
  near(drift.seismic.allowable, 2.4, 1e-9);
  assert.equal(drift.seismic.pass, drift.seismic.deltaX <= 2.4);
  const osb = calcAll({ ...inp, sheathing: 'osb' });
  assert.equal(wallsOf(osb)[0].deflection.E.Ga, getNailingById(w.nailing.id).gaOSB);
});

test('Drift without Cd / Ie: δxe reported, δx skipped with a note', () => {
  const out = calcAll(oneStory([wall('w-1', 0, 8)], { seismic: 4 }));
  const dr = lineOf(out).drift;
  assert.ok(dr.missing);
  assert.ok(dr.rows[0].seismic.deltaXE > 0); assert.equal(dr.rows[0].seismic.deltaX, undefined);
});

test('Wind deflection only when α_s is set', () => {
  const base = oneStory([wall('w-1', 0, 8)], { seismic: 0, wind: 4, loadType: 'wind' });
  assert.equal(wallsOf(calcAll(base))[0].deflection.W, undefined);
  const withA = calcAll({ ...base, alphaS: '0.7' });
  assert.equal(wallsOf(withA)[0].deflection.W.v, 350);
});

test('Drift limits by risk category and row', () => {
  assert.equal(driftLimit('other', 'II'), 0.020); assert.equal(driftLimit('other', 'IV'), 0.010);
  assert.equal(driftLimit('fourStory', 'II'), 0.025); assert.equal(driftLimit('fourStory', 'III'), 0.020);
  assert.equal(driftLimit('other', ''), null);
});

test('LRFD combos by hand; ASD governing unchanged', () => {
  const tc = computeWallTC(5, 0, 4, 8, 10, 1.0, 1.0, 'seismic');
  const lo = tc.combos['(0.9-0.2SDS)D+ρE_pos'], hi = tc.combos['(1.2+0.2SDS)D+ρE_pos'];
  assert.equal(lo.group, 'lrfd');
  near(lo.tensionLeft, 4.85, 0.005); near(lo.comprRight, 7.65, 0.005);
  near(hi.comprRight, 9.05, 0.005);
  near(tc.lrfdTensionLeft, 4.85, 0.005); near(tc.lrfdComprRight, 9.05, 0.005);
  // ASD: T = 0.7·5·10/8 − (0.6 − 0.14)·4/2 = 4.375 − 0.92
  near(tc.governingTensionLeft, 3.455, 0.005);
  near(tc.governingComprRight, 4.375 + 1.14 * 2, 0.006);
  const w = computeWallTC(0, 5, 4, 8, 10, 1.0, 0, 'wind');
  near(w.combos['0.9D+1.0W_pos'].tensionLeft, 6.25 - 1.8, 0.005);
  near(w.combos['1.2D+1.0W_neg'].comprLeft, 6.25 + 2.4, 0.005);
});

test('LRFD envelope and HDUE LRFD cap (1.4×) reported on walls', () => {
  const out = calcAll(oneStory([wall('w-1', 0, 8)], { seismic: 4 }));
  const w = wallsOf(out)[0];
  near(w.lrfd.tL, w.lrfdTensionLeft, 1e-9);
  assert.equal(w.lrfdCapLeft, Math.round(w.anchorageLeft.cap * 1.4));
});

test('Migration v5→v6 adds opening and deflection defaults, idempotent', () => {
  const inp = { levels: [], directions: [{ lines: [{ walls: [{ id: 'w-1' }] }] }] };
  migrateV5toV6(inp);
  assert.equal(inp.sheathing, 'ply'); assert.equal(inp.driftRow, 'other'); assert.deepEqual(inp.refs, {});
  const w = inp.directions[0].lines[0].walls[0];
  assert.deepEqual(w.openings, []); assert.equal(w.method, 'segmented'); assert.equal(w.narrowPier, false);
  const again = JSON.stringify(inp);
  migrateV5toV6(inp);
  assert.equal(JSON.stringify(inp), again);
});

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
