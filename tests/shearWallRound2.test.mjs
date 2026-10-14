// Shear Wall Phase 4 round 2: P9 HDUE minimum post, Ω₀ combos (forces only), dead load by statics, WSWH.
// Run: node tests/shearWallRound2.test.mjs
import assert from 'assert/strict';
import { checkShearWallItem } from '../scripts/lib/shearWallLoadCheck.mjs'; // sets up the stand-in DOM
import { calcAll, computeWallTC, resolveGravityAtWall } from '../src/modules/shearWallCalc.js';
import { shearWallDesign, renderLineResults, migrateV6toV7, lcTableRows, loadCaseTableRows } from '../src/modules/shearWallDesign.js';
import { renderElevation, renderElevationForPdf } from '../src/modules/shearWallElevation.js';
import { HDUE_TABLE, MSTC_TABLE, hdueTable, hdueMinPost, meetsMinPost, autoSelectPost, getGradeById } from '../src/modules/shearWallHardware.js';
import { lookupWswh, selectWswhAnchor, permittedCriteria, WSWH_ROD } from '../src/modules/shearWallWswh.js';
import { validateEngineeringInputs } from '../src/validation.js';

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

test('P9: anchorage minimum post by thickness; MSTC floor straps (2)2x (user rule 2026-09-30)', () => {
  // HDUE tables per framing group and wall width (data 2026-10-13): the min post comes from the line's wall-width table
  assert.equal(hdueMinPost(hdueTable('dfsp', '4')[0], '4').id, '(2)2x4');
  assert.equal(hdueMinPost(hdueTable('dfsp', '6')[0], '6').id, '(2)2x6');
  assert.equal(hdueMinPost(hdueTable('dfsp', '4').find(h => h.id === 'HDUE9'), '4').id, '6x4');
  assert.equal(hdueMinPost(hdueTable('dfsp', '6').find(h => h.id === 'HDUE9'), '6').id, '6x6');
  assert.equal(hdueMinPost(hdueTable('spfhf', '4').find(h => h.id === 'HDUE13'), '4').id, '8x4');
  for (const t of Object.values(MSTC_TABLE)) for (const s of t) {
    assert.equal(hdueMinPost(s, '4').id, '(2)2x4');
    assert.equal(hdueMinPost(s, '6').id, '(2)2x6');
  }
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
  assert.match(warns[0].message, /2x4 is below the anchorage minimum post \(2\)2x4/);
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
  near(c['(1.2+0.2SDS)D+Ω₀E+L_neg'].comprLeft, 32.8, 0.005);
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
  assert.ok(shearWallDesign.schemaVersion >= 7);
  // LC table: one row per combination, numbered ASD → LRFD → Ω₀ ASD → Ω₀ LRFD; load cases are a separate table
  const rows = lcTableRows({ loadType: 'both', omega0: '3' });
  assert.deepEqual(rows.map(r => r[0]), rows.map((_, i) => 'LC' + (i + 1)));
  assert.deepEqual([...new Set(rows.map(r => r[1]))], ['ASD', 'LRFD', 'Ω₀ ASD', 'Ω₀ LRFD']);
  assert.equal(rows.filter(r => r[1] === 'ASD').length, 10);
  assert.ok(rows.some(r => r[2] === '(0.6−0.14S_{DS})D + 0.7Ω_{0}E'), 'subscript markup in the combination');
  assert.equal(lcTableRows({ loadType: 'wind' }).filter(r => r[1].startsWith('Ω₀')).length, 0);
  assert.deepEqual(loadCaseTableRows({ loadType: 'both' }).map(r => r[0]), ['D', 'L', 'Lr', 'E', 'W']);
});

test('R4: Forces tab with Ω₀ LCs, LC tables in the PDF and the Summary tab', () => {
  const inp = oneStory([wall('w-1', 0, 8)], { seismic: 8, extra: { omega0: '3' } });
  const o = calcAll(inp);
  const b = document.createElement('div');
  const ln = lineOf(o), combos = ln.perLevel[0].walls[0].combos;
  const omKey = Object.keys(combos).find(k => combos[k].group === 'asd_omega');
  renderLineResults(b, ln, o.perDirection[0], { tab: 'forces', forcesKey: omKey, onTab() {} });
  assert.ok(b.textContent.includes('forces only') && b.querySelector('select').value === omKey);
  const secs = shearWallDesign.pdfSections(inp);
  assert.ok(secs.some(s => s.title === 'Load Combinations') && secs.some(s => s.title === 'Load Cases (unfactored)'));
  const form = document.createElement('div');
  shearWallDesign.renderForm(form, JSON.parse(JSON.stringify(inp)), () => {}, [], () => {});
  assert.ok(form.textContent.includes('Load Combinations') && form.textContent.includes('LC1'));
});

// === R6: dead load end reactions by statics ===

test('R6: point load at one end goes to that end; partial uniform splits by its centroid', () => {
  const w = { position: 10, length: 10, wallDLTypeId: 'dl-1', _floorToFloor: 10 };
  const types = [{ id: 'dl-1', psf: 10 }]; // self-weight 10 psf × 100 ft² = 1.0 k, ½ each end
  const g = resolveGravityAtWall(w, { uniform: [], point: [{ position: 10, dlKips: 4 }] }, types);
  near(g.rL, 4.5, 1e-6); near(g.rR, 0.5, 1e-6); near(g.dlTotal, 5, 1e-6);
  // 200 plf from 5 to 14 → overlap 10..14 = 0.8 k at x = 12 → R_R = 0.8·2/10 = 0.16
  const u = resolveGravityAtWall({ ...w, wallDLTypeId: '' }, { uniform: [{ start: 5, end: 14, dlPlf: 200 }], point: [] }, types);
  near(u.rR, 0.16, 1e-6); near(u.rL, 0.64, 1e-6);
  // Full-length uniform load → D/2 each end (unchanged from the old rule)
  const f = resolveGravityAtWall({ ...w, wallDLTypeId: '' }, { uniform: [{ start: 0, end: 40, dlPlf: 100 }], point: [] }, types);
  near(f.rL, 0.5, 1e-6); near(f.rR, 0.5, 1e-6);
});

test('R6: T/C use fD·R_end at each end (net = fD·R_end ∓ OTM/L)', () => {
  // 10 ft wall, point load 4 k at the left end, V = 5 k, h = 10, SDS 1.0, ρ 1
  const out = calcAll(oneStory([wall('w-1', 0, 10)], { seismic: 5, gravity: { 'lvl-1': { uniform: [], point: [{ id: 'pl-1', position: 0, dlKips: 4 }] } } }));
  const w = wallsOf(out)[0];
  assert.equal(w.dlRL, 4); assert.equal(w.dlRR, 0);
  const m = 0.7 * 5 * 10 / 10; // 3.5 k
  // 0.6D+0.7ρE_pos: left net = 0.46·4 − 3.5 → T_L = 1.66; right end has no dead load → T_R (neg) = 3.5
  near(w.combos['0.6D+0.7ρE_pos'].tensionLeft, 3.5 - 0.46 * 4, 0.005);
  near(w.combos['0.6D+0.7ρE_neg'].tensionRight, 3.5, 0.005);
  near(w.combos['D+0.7ρE_neg'].comprLeft, 3.5 + 1.14 * 4, 0.005);
  near(w.combos['1.0D'].comprLeft, 4, 0.005);
  assert.equal(w.combos['1.0D'].comprRight, 0);
});

test('R6: each solid wall takes only the loads over it, split by position', () => {
  const out = calcAll(oneStory([wall('w-1', 0, 4), wall('w-2', 6, 4)],
    { seismic: 5, gravity: { 'lvl-1': { uniform: [], point: [{ id: 'pl-1', position: 1, dlKips: 4 }] } } }));
  const [p1, p2] = wallsOf(out);
  near(p1.dlRL, 3, 0.005); near(p1.dlRR, 1, 0.005); // 4 k at 1 ft on a 4 ft wall
  assert.equal(p2.dlTotal, 0);
});

// === WSWH Strong-Wall ===
const panel = (id, position, more = {}) => wall(id, position, 1.5, { systemType: 'wswh', wswhWidth: '18', wswhCondition: 'concrete', wswhJoist: '12', wswhFloorDepth: '12', wswhAnchorOverride: '', ...more });
const twoStory = (walls, loads, extra = {}) => {
  const inp = oneStory(walls, { floorH: 9, extra });
  inp.levels = [
    { id: 'lvl-2', name: '2nd', floorToFloor: 9, floorClearSpan: '16', anchorageType: 'auto' },
    { id: 'lvl-1', name: '1st', floorToFloor: 9, floorClearSpan: '16', anchorageType: 'auto' },
  ];
  inp.directions[0].lines[0].levelLoads = loads;
  return inp;
};

test('WSWH lookup: table rows, height and P interpolation, raised-floor joist factor, limits', () => {
  const a = lookupWswh({ width: 18, condition: 'concrete', ftfFt: 9, P_lb: 4000, fc: 2500 });
  assert.equal(a.evalModel, 'WSWH18x9'); assert.equal(a.He, 105.25);
  assert.equal(a.V.E, 2575); assert.equal(a.D.E, 0.45); assert.equal(a.V.W, 3235); assert.equal(a.B, 12.5);
  // 9.5 ft, P midway 4,000–7,500: wind V = mean of x9 (3235/3005) and x10 (2755/2695)
  const b = lookupWswh({ width: 18, condition: 'concrete', ftfFt: 9.5, P_lb: 5750, fc: 2500 });
  near(b.He, 111.25, 1e-9); near(b.V.W, (3120 + 2725) / 2, 1e-9); near(b.V.E, (2575 + 2140) / 2, 1e-9);
  assert.equal(b.orderModel, 'WSWH18x10');
  // P below 1,000 lb uses the 1,000 row; f'c 4,500 uses the 3,000 table
  assert.equal(lookupWswh({ width: 24, condition: 'concrete', ftfFt: 8, P_lb: 0, fc: 4500 }).V.W, 6910);
  // Raised floor, 12"–16" joists: V × 0.92 (WSWH18x8 T02: 1680 S / 2135 W)
  near(lookupWswh({ width: 18, condition: 'raised', ftfFt: 8, P_lb: 1000, joist: '16' }).V.E, 1680 * 0.92, 1e-9);
  assert.match(lookupWswh({ width: 18, condition: 'raised', ftfFt: 8, P_lb: 2500 }).error, /exceeds 2,000 lb/);
  assert.match(lookupWswh({ width: 12, condition: 'concrete', ftfFt: 15, P_lb: 0 }).error, /outside the tabulated WSWH12 heights/);
  assert.match(lookupWswh({ width: 24, condition: 'concrete', ftfFt: 15, P_lb: 5000 }).error, /exceeds the tabulated 4000 lb/);
});

test('WSWH anchors (Table 06): smallest footing width then embedment; SDC filters E vs W/E; rod at stacked 2nd story', () => {
  const d = selectWswhAnchor(15000, { fc: 2500, sdc: 'D', width: 18 });
  assert.equal(d.rowId, 'E STD 16000'); assert.equal(d.W, 33); assert.equal(d.de, 11); assert.equal(d.Lftg, 47);
  assert.equal(selectWswhAnchor(15000, { fc: 2500, sdc: 'B', width: 18 }).rowId, 'W/E STD 17100');
  assert.equal(selectWswhAnchor(15000, { fc: 2500, sdc: 'C', detached: true, width: 18 }).rowId, 'W/E STD 17100');
  assert.equal(selectWswhAnchor(15000, { fc: 2500, sdc: 'C', detached: false, width: 18 }).rowId, 'E STD 16000');
  assert.equal(selectWswhAnchor(40000, { fc: 2500, sdc: 'D', width: 18 }), null);
  assert.equal(selectWswhAnchor(1000, { fc: 3500, sdc: 'D', width: 18 }).fc, 3000);
  assert.equal(permittedCriteria('', false).join(), 'E');
});

test('WSWH on concrete: D/C = V_ASD / V_allow; T = 0.7ρV·H_e/B − (0.6−0.14SDS)·P/2; Table 06 anchor', () => {
  const out = calcAll(oneStory([panel('w-1', 0)], { seismic: 2, floorH: 9 }));
  const w = wallsOf(out)[0];
  assert.equal(w.method, 'wswh'); assert.equal(w.length, 1.5); assert.equal(w.nailing.label, 'WSWH18x9');
  near(w.dcRatio, 0.7 * 2000 / 2575, 0.005);
  near(w.governingTensionLeft, 0.7 * 2 * 105.25 / 12.5, 0.01);
  assert.equal(w.anchorageLeft.rowId, 'E STD 16000');
  assert.equal(w.postLeft.postLabel, 'WSWH panel');
  near(w.deflection.E.delta, 0.64 * 2000 / 3680, 1e-4); // 1.0E, linear from the LRFD cap with its drift (option B, 2026-10-13)
  near(w.deltaShare.E, 0.64 * 2000 / 3680, 1e-4); // the distribution's δ(V) = the reported drift line (1.0 level)
  assert.equal(w.deflection.E.overLrfd, false);
  // V(1.0E) = 4,000 lb > V_LRFD 3,680 lb → warning sign (Δ_LRFD not valid above it)
  const lnO = calcAll(oneStory([panel('w-1', 0)], { seismic: 4, floorH: 9 })).perDirection[0].perLine[0];
  assert.ok(lnO.deflWarnings.some(x => /WSWH, 1\.0E\): V above V_LRFD 3680 lb/.test(x.message)), JSON.stringify(lnO.deflWarnings));
  // with 1 k of dead load: P = (1+0.14)·1000 for the lookup; uplift uses (0.6−0.14)·D/2
  const g = { 'lvl-1': { uniform: [], point: [{ id: 'pl-1', position: 0.75, dlKips: 1 }] } };
  const w2 = wallsOf(calcAll(oneStory([panel('w-1', 0)], { seismic: 2, floorH: 9, gravity: g })))[0];
  assert.equal(w2.wswh.P.E, 1140);
  near(w2.governingTensionLeft, 0.7 * 2 * 105.25 / 12.5 - 0.46 * 0.5, 0.01);
});

test('WSWH mixed with a sheathed wall: capacity weights V_allow vs v_cap × L; deflection distribution converges', () => {
  const inp = oneStory([wall('w-1', 10, 10), panel('w-2', 0)], { seismic: 8, floorH: 9 });
  const [sw, ws] = wallsOf(calcAll(inp));
  const wSw = sw.effectiveSeismicCap * 10, wWs = 2575;
  near(ws.share_1E, 8 * wWs / (wSw + wWs), 0.01);
  inp.distribution = 'deflection';
  const out = calcAll(inp);
  assert.equal(lineOf(out).distribution.method, 'deflection');
  assert.ok(lineOf(out).distribution.converged, 'deflection distribution converges with a WSWH panel');
});

test('WSWH two-story stack: base moment check, upper panel absorbed into the base, rod at the 2nd story', () => {
  const inp = twoStory([panel('w-1', 0, { levelId: 'lvl-2', wswhCondition: 'stackedUpper' }), panel('w-2', 0, { levelId: 'lvl-1' })],
    { 'lvl-2': { seismic: 1, wind: 0 }, 'lvl-1': { seismic: 1, wind: 0 } });
  const out = calcAll(inp);
  const up = wallsOf(out).find(w => w.wallId === 'w-1'), lo = wallsOf(out).find(w => w.wallId === 'w-2');
  assert.equal(up.wswh.table, 'T03'); assert.equal(up.anchorageLeft.id, WSWH_ROD.id);
  assert.equal(lo.wswh.role, 'stackedLower');
  // V₀ = WSWH18x9 at P = 4,000 lb, f'c 2,500 = 2575; V1 = 0.7·2 k, V2 = 0.7·1 k (ASD)
  const s = lo.wswh.stacked.E;
  near(s.Mallow, 2575 * 105.25 / 12, 0.01);
  near(s.Md, (1400 * 105.25 + 700 * (105.25 + 12 + up.wswh.He)) / 12, 0.01);
  near(lo.dcRatio, s.Md / s.Mallow, 0.005);
  // T₁ = 0.7·[V1·H1 + V2(H1+d+H2)]/12 / B (no dead load)
  near(lo.governingTensionLeft, 0.7 * (2 * 105.25 + 1 * (105.25 + 12 + up.wswh.He)) / 12 / (12.5 / 12), 0.01);
  const dlv = lineOf(out).wallDeliveries.filter(d => d.wallId === 'w-1');
  assert.ok(dlv.every(d => d.receiver.type === 'wswh_stack'));
  assert.ok(!lo.injections, 'upper end forces are not added again to the base panel');
});

test('WSWH problems: not tabulated / upper story without a stack → warning, no shear; openings blocked', () => {
  const out = calcAll(oneStory([panel('w-1', 0, { wswhWidth: '12' }), wall('w-2', 10, 10)], { seismic: 4, floorH: 15 }));
  const w = wallsOf(out).find(x => x.wallId === 'w-1');
  assert.equal(w.share_1E, 0); assert.ok(w.dcRatio > 1);
  assert.ok(lineOf(out).loadPathAudit.warnings.some(x => x.type === 'wswh' && /outside the tabulated/.test(x.message)));
  const out2 = calcAll(twoStory([panel('w-1', 0, { levelId: 'lvl-2' }), wall('w-3', 10, 10, { levelId: 'lvl-2' }), wall('w-2', 10, 10, { levelId: 'lvl-1' })],
    { 'lvl-2': { seismic: 1, wind: 0 }, 'lvl-1': { seismic: 1, wind: 0 } }));
  assert.ok(lineOf(out2).loadPathAudit.warnings.some(x => x.type === 'wswh' && /bottom story only/.test(x.message)));
  const errs = validateEngineeringInputs('shear_wall_design', oneStory([panel('w-1', 0, { openings: [{ offset: 0, width: 1, sill: 3, head: 7 }] })]));
  assert.ok(errs.some(e => /cannot have openings/.test(e)));
});

test('WSWH v6 → v7 migration adds wall system fields; results, PDF and form render', () => {
  const m = migrateV6toV7({ directions: [{ lines: [{ walls: [{ id: 'w-1' }] }] }] });
  assert.equal(m.directions[0].lines[0].walls[0].systemType, 'sheathed');
  assert.equal(m.wswhFc, '2500');
  const inp = oneStory([panel('w-1', 0), wall('w-2', 10, 10)], { seismic: 4, floorH: 9 });
  const r = checkShearWallItem({ schemaVersion: 7, inputs: inp });
  assert.ok(r.ok, r.error);
});

test('WSWH UI: Strong-Wall tab, PDF section, Summary settings and wall panel render', () => {
  const inp = twoStory([panel('w-1', 0, { levelId: 'lvl-2', wswhCondition: 'stackedUpper' }), panel('w-2', 0, { levelId: 'lvl-1' }), wall('w-3', 10, 10, { levelId: 'lvl-1' })],
    { 'lvl-2': { seismic: 1, wind: 0 }, 'lvl-1': { seismic: 2, wind: 0 } }, { seismicDesignCategory: 'D', wswhFc: '2500' });
  const o = calcAll(inp);
  const b = document.createElement('div');
  renderLineResults(b, lineOf(o), o.perDirection[0], { tab: 'wswh', onTab() {} });
  assert.ok(b.textContent.includes('Strong-Wall WSWH panels'));
  assert.ok(b.textContent.includes('base moment check'));
  assert.ok(b.textContent.includes('WSWH-AB'));
  const secs = shearWallDesign.pdfSections(inp);
  assert.ok(secs.some(s => /Strong-Wall WSWH$/.test(s.title)));
  assert.ok(secs.some(s => /two-story stack/.test(s.title)));
  const form = document.createElement('div');
  shearWallDesign.renderForm(form, JSON.parse(JSON.stringify(inp)), () => {}, [], () => {});
  assert.ok(form.textContent.includes('Strong-Wall WSWH (Simpson)'));
  // Wall panel of a WSWH wall: type / width / condition, no nailing field
  const c = document.createElement('div');
  const ln = JSON.parse(JSON.stringify(inp.directions[0].lines[0]));
  const h = renderElevation(c, ln, inp.levels, inp.wallDLTypes, { designContext: () => ({ sdc: 'D', wswhFc: '2500', bottomLevelId: 'lvl-1' }) });
  h.showResults(lineOf(o));
  const pick = (sel, value) => {
    [...sel.querySelectorAll('option')].forEach(x => x.removeAttribute('selected'));
    [...sel.querySelectorAll('option')].find(x => x.getAttribute('value') === value).setAttribute('selected', '');
    sel.dispatchEvent(new window.Event('change'));
  };
  const findSel = [...c.querySelectorAll('select')].find(s => (s.getAttribute('title') || '').includes('mark or ID'));
  pick(findSel, [...findSel.querySelectorAll('option')].find(x => /w-2/.test(x.getAttribute('value') || '')).getAttribute('value'));
  const txt = c.textContent;
  assert.ok(txt.includes('Strong-Wall WSWH (panel height = floor-to-floor'), 'WSWH editor shown');
  assert.ok(txt.includes('Anchor (Table 06'), 'anchor override offered for the concrete panel');
  assert.ok(!txt.includes('Hardware Overrides'), 'no HD / post overrides for a panel');
  const typeSel = [...c.querySelectorAll('select')].find(s => [...s.querySelectorAll('option')].some(x => x.getAttribute('value') === 'wswh'));
  pick(typeSel, 'sheathed');
  assert.equal(ln.walls.find(w => w.id === 'w-2').systemType, 'sheathed');
  assert.equal(ln.walls.find(w => w.id === 'w-2').length, 4);
  h.destroy();
});

test('WSWH elevation: panel label, stacked kit and anchor W / d_e drawn (PDF + live)', () => {
  const inp = twoStory([panel('w-1', 20, { levelId: 'lvl-2', wswhCondition: 'stackedUpper' }), panel('w-2', 20, { levelId: 'lvl-1' }), wall('w-3', 0, 10, { levelId: 'lvl-1' }), wall('w-4', 0, 10, { levelId: 'lvl-2' })],
    { 'lvl-2': { seismic: 2, wind: 0 }, 'lvl-1': { seismic: 3, wind: 0 } }, { seismicDesignCategory: 'D' });
  const o = calcAll(inp);
  const ln = inp.directions[0].lines[0];
  const pdf = renderElevationForPdf(ln, inp.levels, inp.wallDLTypes, lineOf(o), 700);
  const svg = typeof pdf === 'string' ? pdf : pdf.outerHTML;
  assert.ok(svg.includes('SW-2 · WSWH18x9'), 'vertical mark · model');
  assert.ok(svg.includes('WSWH-TSS18KT (two-story stacked kit)'), 'stacked kit named at the floor line');
  const base = wallsOf(o).find(w => w.wallId === 'w-2');
  const an = base.anchorageLeft;
  // the anchor is hardware: on the hardware elevation (shared scene, same as the tool with Hardware on)
  const hwEl = renderElevationForPdf(ln, inp.levels, inp.wallDLTypes, lineOf(o), 700, 'hardware');
  // d_e is drawn as d with a subscript e (tspan): the label text reads "… · W 24" · de 18""
  const anchorText = [...hwEl.querySelectorAll('text')].find(t => t.querySelector('tspan') && t.textContent === 'AB ' + an.grade + ' (' + an.criteria + ') · W ' + an.W + '" · de ' + an.de + '"');
  assert.ok(anchorText, 'anchor with min W and d_e');
  assert.equal([...anchorText.querySelectorAll('tspan')].find(x => x.textContent === 'e').getAttribute('baseline-shift'), 'sub', 'e is a subscript');
  assert.ok(!svg.includes(' · d_e '), 'no anchor on the end-force elevation');
  const c = document.createElement('div');
  const h = renderElevation(c, JSON.parse(JSON.stringify(ln)), inp.levels, inp.wallDLTypes, {});
  h.showResults(lineOf(o));
  assert.ok([...c.querySelectorAll('text')].some(t => t.textContent === 'SW-1 · WSWH18x9'));
  h.destroy();
});

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
