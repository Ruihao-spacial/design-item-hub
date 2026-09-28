// Shear Wall Phase 4 round 2: P9 HDUE minimum post, Ω₀ combos (forces only), dead load by statics, WSWH.
// Run: node tests/shearWallRound2.test.mjs
import assert from 'assert/strict';
import { checkShearWallItem } from '../scripts/lib/shearWallLoadCheck.mjs'; // sets up the stand-in DOM
import { calcAll, computeWallTC } from '../src/modules/shearWallCalc.js';
import { shearWallDesign, renderLineResults, migrateV6toV7, designBasisRows } from '../src/modules/shearWallDesign.js';
import { HDUE_TABLE, MSTC_TABLE, hdueMinPost, meetsMinPost, autoSelectPost, getGradeById } from '../src/modules/shearWallHardware.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' ± ' + tol + ', got ' + a);
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message)); process.exitCode = 1; }
}

// One direction, one line, one level; walls given per test
function oneStory(walls, { seismic = 10, wind = 0, floorH = 10, loadType = 'seismic', sds = 1.0, gravity = {}, extra = {} } = {}) {
  return {
    sds, loadType, wallThickness: '4', woodGrade: 'dfir_no1', wallDLTypes: [{ id: 'dl-1', name: 'Int', psf: 10 }], sheathing: 'ply',
    cd: '', ie: '', riskCategory: '', driftRow: 'other', alphaS: '', refs: {},
    levels: [{ id: 'lvl-1', name: '1st', floorToFloor: floorH, floorClearSpan: '16', anchorageType: 'auto' }],
    directions: [{ id: 'dir-1', name: 'N-S', rho: 1, lines: [{
      id: 'ln-1', name: 'A', totalLength: 60, wallThickness: '',
      levelLoads: { 'lvl-1': { seismic, wind } }, walls, beams: [], supportPosts: [], gravityLoads: gravity,
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

// === P9: HDUE minimum post ===

test('P9: HDUE minimum post by thickness; straps have none', () => {
  assert.equal(hdueMinPost(HDUE_TABLE[0], '4').id, '(2)2x4');
  assert.equal(hdueMinPost(HDUE_TABLE[0], '6').id, '(2)2x6');
  assert.equal(hdueMinPost(HDUE_TABLE.find(h => h.id === 'HDUE9'), '4').id, '4x4');
  assert.equal(hdueMinPost(MSTC_TABLE['16'][0], '4'), null);
  const min = hdueMinPost(HDUE_TABLE[0], '4');
  assert.equal(meetsMinPost({ id: '2x4' }, min), false);
  assert.equal(meetsMinPost({ postId: '4x4' }, min), true);
  assert.equal(autoSelectPost(0.1, '4', getGradeById('dfir_no1'), 10, min).postId, '(2)2x4');
  assert.equal(autoSelectPost(0.1, '4', getGradeById('dfir_no1'), 10).postId, '2x4');
});

test('P9: holdown ends never get a single 2x post (auto)', () => {
  const out = calcAll(oneStory([wall('w-1', 0, 20)], { seismic: 3 }));
  const w = wallsOf(out)[0];
  assert.equal(w.anchorageLeft.id.slice(0, 4), 'HDUE');
  assert.equal(w.postLeft.postId, '(2)2x4');
  assert.equal(w.postRight.postId, '(2)2x4');
});

test('P9: override below the minimum is not used and is flagged; a heavier override is kept', () => {
  const out = calcAll(oneStory([wall('w-1', 0, 20, { postLeftOverride: '2x4', postRightOverride: '4x4' })], { seismic: 3 }));
  const w = wallsOf(out)[0];
  assert.equal(w.postLeft.postId, '(2)2x4');
  assert.equal(w.postRight.postId, '4x4');
  const warns = lineOf(out).loadPathAudit.warnings.filter(x => x.type === 'post_below_hdue_min');
  assert.equal(warns.length, 1);
  assert.match(warns[0].message, /2x4 is below the HDUE minimum post \(2\)2x4/);
});

// === R4: Ω₀ combos — forces only ===

test('R4: Ω₀ combos by hand (ASD §2.4.5 and LRFD §2.3.6, Ω₀ replaces ρ)', () => {
  // V = 10 k, h = 10 ft, L = 10 ft, D = 4 k, SDS = 1.0, ρ = 1.3, Ω₀ = 3
  const tc = computeWallTC(10, 0, 4, 10, 10, 1.3, 1.0, 'seismic', { omega0: 3 });
  const c = tc.combos;
  // 0.6D+0.7Ω₀E: net L = (0.6−0.14)·2 − 0.7·3·10·10/10 = 0.92 − 21 → T = 20.08
  near(c['0.6D+0.7Ω₀E_pos'].tensionLeft, 20.08, 0.005);
  // D+0.7Ω₀E: net R = 1.14·2 + 21 = 23.28
  near(c['D+0.7Ω₀E_pos'].comprRight, 23.28, 0.005);
  // (0.9−0.2SDS)D+Ω₀E: 0.7·2 − 30 → T = 28.6; (1.2+0.2SDS)D+Ω₀E: 1.4·2 + 30 = 32.8
  near(c['(0.9-0.2SDS)D+Ω₀E_pos'].tensionLeft, 28.6, 0.005);
  near(c['(1.2+0.2SDS)D+Ω₀E_neg'].comprLeft, 32.8, 0.005);
  assert.equal(c['D+0.7Ω₀E_pos'].group, 'asd_omega');
  assert.equal(c['(0.9-0.2SDS)D+Ω₀E_pos'].group, 'lrfd_omega');
  near(tc.omegaASD.tL, 20.08, 0.005);
  // Design envelope is ρ-based ASD only: 0.7·1.3·10 = 9.1 k·ft/ft → T = 9.1 − 0.92 = 8.18
  near(tc.governingTensionLeft, 8.18, 0.005);
  // Default Ω₀ = 2.5 when blank; wind-only has no Ω₀ combos
  assert.equal(computeWallTC(10, 0, 0, 10, 10, 1, 1, 'seismic').steps.omega.omega0, 2.5);
  assert.ok(!Object.keys(computeWallTC(0, 10, 0, 10, 10, 1, 1, 'wind').combos).some(k => k.includes('Ω₀')));
});

test('R4: Ω₀ never changes design (governing, hardware, posts) — only the reported envelopes', () => {
  const a = wallsOf(calcAll(oneStory([wall('w-1', 0, 8)], { seismic: 8, extra: { omega0: '2' } })))[0];
  const b = wallsOf(calcAll(oneStory([wall('w-1', 0, 8)], { seismic: 8, extra: { omega0: '3' } })))[0];
  assert.equal(a.governingTensionLeft, b.governingTensionLeft);
  assert.equal(a.anchorageLeft.id, b.anchorageLeft.id);
  assert.equal(a.postRight.postId, b.postRight.postId);
  assert.equal(a.nailing.id, b.nailing.id);
  assert.ok(b.omega.asd.tL > a.omega.asd.tL);
  assert.ok(b.omega.lrfd.cR > a.omega.lrfd.cR);
});

test('R4: Ω₀ flows through the load path to posts and beam supports', () => {
  const inp = oneStory([], { seismic: 0 });
  inp.levels = [
    { id: 'lvl-2', name: '2nd', floorToFloor: 10, floorClearSpan: '16', anchorageType: 'auto' },
    { id: 'lvl-1', name: '1st', floorToFloor: 10, floorClearSpan: '16', anchorageType: 'auto' },
  ];
  const ln = inp.directions[0].lines[0];
  ln.levelLoads = { 'lvl-2': { seismic: 6, wind: 0 }, 'lvl-1': { seismic: 6, wind: 0 } };
  ln.walls = [wall('w-1', 0, 8, { levelId: 'lvl-2' }), wall('w-2', 20, 10, { levelId: 'lvl-1' })];
  ln.supportPosts = [{ id: 'sp-1', mark: 'P-1', levelId: 'lvl-1', position: 0, anchorageOverride: '', postOverride: '' },
    { id: 'sp-2', mark: 'P-2', levelId: 'lvl-1', position: 8, anchorageOverride: '', postOverride: '' }];
  const out = calcAll(inp);
  const pp = lineOf(out).postPaths.find(p => p.postId === 'sp-1');
  const up = wallsOf(out).find(w => w.wallId === 'w-1');
  near(pp.omega.asd.T, up.omega.asd.tL, 0.01);
  assert.ok(pp.omega.asd.T > pp.envelopeT, 'Ω₀ uplift exceeds the ρ-based ASD uplift');
});

test('R4: Base Shear link carries Ω₀; v6 → v7 migration adds omega0; design basis lists roles', () => {
  const inp = { sds: '1.0', cd: '4', ie: '1.0', riskCategory: 'II', omega0: '2.5' };
  const linked = { baseShearSource: { sds: 1.0, cd: 4, ie: 1.0, riskCategory: 'II', omega0: 3 } };
  assert.deepEqual(shearWallDesign.linkDiff(inp, linked).map(c => c.label), ['Ω₀']);
  shearWallDesign.applyLinks(inp, linked);
  assert.equal(inp.omega0, '3');
  assert.equal(shearWallDesign.refs[0].extract({ omega0: 2 }).omega0, 2);
  const m = migrateV6toV7({ directions: [] });
  assert.equal(m.omega0, '');
  assert.equal(shearWallDesign.schemaVersion, 7);
  const rows = designBasisRows({ loadType: 'both', omega0: '3' });
  assert.deepEqual(rows.map(r => r[2]), ['DESIGN', 'Deflection', 'Forces only', 'Forces only', 'Forces only']);
  assert.ok(rows[3][1].includes('Ω₀ = 3'));
  assert.equal(designBasisRows({ loadType: 'wind' }).length, 3);
});

test('R4: Ω₀ tab, design-basis line and PDF sections render', () => {
  const inp = oneStory([wall('w-1', 0, 8)], { seismic: 8, extra: { omega0: '3' } });
  const o = calcAll(inp);
  const b = document.createElement('div');
  renderLineResults(b, lineOf(o), o.perDirection[0], { tab: 'omega', onTab() {} });
  assert.ok(b.textContent.includes('Forces only'));
  assert.ok(b.textContent.includes('not used for design'));
  const secs = shearWallDesign.pdfSections(inp);
  assert.ok(secs.some(s => s.title === 'Load Combinations & Design Basis'));
  assert.ok(secs.some(s => /Ω₀ Forces \(reported only, not used for design\)/.test(s.title)));
  const form = document.createElement('div');
  shearWallDesign.renderForm(form, JSON.parse(JSON.stringify(inp)), () => {}, [], () => {});
  assert.ok(form.textContent.includes('Load Combinations & Design Basis'));
});

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
