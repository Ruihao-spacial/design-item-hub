// Shear Wall: live load / roof live load, gravity load shapes (point / full / partial), ASCE 7-22 combos,
// gravity on transfer beams and posts, Ω₀ ASD support posts, Flat Load link, schema v8.
// Run: node tests/shearWallLiveLoad.test.mjs
import assert from 'assert/strict';
import { checkShearWallItem } from '../scripts/lib/shearWallLoadCheck.mjs'; // sets up the stand-in DOM
import { calcAll, computeWallTC, resolveGravityAtWall } from '../src/modules/shearWallCalc.js';
import { comboDefs } from '../src/modules/shearWallCombos.js';
import { gravityRows, assemblyLoads } from '../src/modules/shearWallGravity.js';
import { shearWallDesign, renderLineResults, migrateV7toV8, gravityDetail, endForceDetail, designBasisRows } from '../src/modules/shearWallDesign.js';
import { renderElevation } from '../src/modules/shearWallElevation.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' ± ' + tol + ', got ' + a);
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message)); process.exitCode = 1; }
}
const wall = (id, levelId, position, length, more = {}) => ({
  id, mark: 'SW-' + id.split('-')[1], levelId, position, length, wallDLTypeId: '', nailingPattern: '',
  anchorageLeftOverride: '', anchorageRightOverride: '', postLeftOverride: '', postRightOverride: '',
  openings: [], method: 'segmented', narrowPier: false, ftaoStrapOverride: '', jambPostOverride: '', systemType: 'sheathed', ...more,
});
const ld = (shape, more) => ({ id: 'gl-' + Math.random().toString(36).slice(2, 7), shape, position: 0, start: 0, end: 0, D: '', L: '', Lr: '', assemblyId: '', trib: '', ...more });
function model({ levels, walls, loads = {}, gravity = {}, beams = [], posts = [], loadType = 'seismic', sds = 1.0, extra = {} }) {
  return {
    sds, loadType, wallThickness: '4', woodGrade: 'dfir_no1', wallDLTypes: [], sheathing: 'ply', refs: {},
    cd: '', ie: '', riskCategory: '', driftRow: 'other', alphaS: '', omega0: '2.5', lrfdHalfL: false,
    levels, directions: [{ id: 'dir-1', name: 'N-S', rho: 1, lines: [{ id: 'ln-1', name: 'A', totalLength: 30, wallThickness: '',
      levelLoads: loads, walls, beams, supportPosts: posts, gravityLoads: gravity }] }],
    ...extra,
  };
}
const one = [{ id: 'lvl-1', name: '1st', floorToFloor: 10, floorClearSpan: '16', anchorageType: 'auto' }];
const two = [{ id: 'lvl-2', name: '2nd', floorToFloor: 10, floorClearSpan: '16', anchorageType: 'auto' }, ...one];
const lineOf = (out) => out.perDirection[0].perLine[0];
const wallsOf = (out) => lineOf(out).perLevel.flatMap(p => p.walls);

test('ASCE 7-22 combos with L and Lr by hand; uplift combos carry no live load', () => {
  // V_E = 5 k, V_W = 4 k, h = L = 10 ft; R_D = 2 / 2, R_L = 3 / 3, R_Lr = 1 / 1; SDS 1.0, ρ 1
  const live = { L: { rL: 3, rR: 3 }, Lr: { rL: 1, rR: 1 } };
  const tc = computeWallTC(5, 4, 4, 10, 10, 1, 1.0, 'both', { live });
  const c = tc.combos;
  near(c['D+L'].comprLeft, 5, 1e-9);
  near(c['D+Lr'].comprLeft, 3, 1e-9);
  near(c['D+0.75L+0.75Lr'].comprRight, 2 + 2.25 + 0.75, 1e-9);
  near(c['D+0.525ρE+0.75L_pos'].comprRight, 1.105 * 2 + 0.75 * 3 + 0.525 * 5, 0.005);
  near(c['D+0.75(0.6W)+0.75L+0.75Lr_pos'].comprRight, 2 + 2.25 + 0.75 + 0.45 * 4, 0.005);
  near(c['0.6D+0.7ρE_pos'].tensionLeft, 3.5 - 0.46 * 2, 0.005);
  near(c['0.6D+0.6W_pos'].tensionLeft, 2.4 - 1.2, 0.005);
  near(c['1.2D+1.6L+0.5Lr'].comprLeft, 2.4 + 4.8 + 0.5, 0.005);
  near(c['1.2D+1.6Lr+L'].comprLeft, 2.4 + 1.6 + 3, 0.005);
  near(c['(1.2+0.2SDS)D+ρE+L_pos'].comprRight, 1.4 * 2 + 3 + 5, 0.005);
  near(c['1.2D+1.0W+L+0.5Lr_pos'].comprRight, 2.4 + 3 + 0.5 + 4, 0.005);
  near(c['D+0.525Ω₀E+0.75L_pos'].comprRight, 1.105 * 2 + 2.25 + 0.525 * 2.5 * 5, 0.005);
  near(c['1.0L'].comprLeft, 3, 1e-9); near(c['1.0Lr'].comprRight, 1, 1e-9);
  // governing ASD compression now includes the live-load combos
  near(tc.governingComprRight, Math.max(1.14 * 2 + 3.5, 1.105 * 2 + 2.25 + 2.625, 2 + 3, 2 + 2.4, 2 + 2.25 + 0.75 + 1.8), 0.01);
  // LRFD 0.5L option
  const h = computeWallTC(5, 4, 4, 10, 10, 1, 1.0, 'both', { live, lrfdHalfL: true });
  near(h.combos['(1.2+0.2SDS)D+ρE+L_pos'].comprRight, 1.4 * 2 + 1.5 + 5, 0.005);
  near(h.combos['1.2D+1.6L+0.5Lr'].comprLeft, 2.4 + 4.8 + 0.5, 0.005, '1.6L combo keeps 1.6');
  assert.ok(comboDefs({ loadType: 'seismic' }).every(d => !d.key.includes('W')));
});

test('Gravity rows: point, full-line and partial uniform, each case split to the wall ends by statics', () => {
  const gl = { loads: [ld('full', { D: '100', L: '200' }), ld('partial', { start: 2, end: 6, Lr: '300' }), ld('point', { position: 1, D: '2', L: '1' })] };
  const rows = gravityRows(gl, 30);
  assert.equal(rows.uniform.length, 2); assert.equal(rows.point.length, 1);
  assert.equal(rows.uniform[0].x1, 30);
  const g = resolveGravityAtWall({ position: 0, length: 10 }, gl, [], { lineLength: 30 });
  near(g.dlTotal, 1 + 2, 1e-9); near(g.rL, 0.5 + 2 * 0.9, 1e-6);
  near(g.live.L.total, 2 + 1, 1e-9); near(g.live.L.rR, 1 + 0.1, 1e-6);
  near(g.live.Lr.total, 1.2, 1e-9); near(g.live.Lr.rR, 1.2 * 0.4, 1e-6); // centroid at 4 ft
  assert.equal(g.loadRows.length, 3);
});

test('Walls: live load adds compression (posts), not uplift', () => {
  const g = { 'lvl-1': { loads: [ld('full', { D: '100', L: '400' })] } };
  const a = wallsOf(calcAll(model({ levels: one, walls: [wall('w-1', 'lvl-1', 0, 10)], loads: { 'lvl-1': { seismic: 4, wind: 0 } } })))[0];
  const b = wallsOf(calcAll(model({ levels: one, walls: [wall('w-1', 'lvl-1', 0, 10)], loads: { 'lvl-1': { seismic: 4, wind: 0 } }, gravity: g })))[0];
  near(b.live.L.total, 4, 1e-9);
  assert.ok(b.governingComprLeft > a.governingComprLeft + 1);
  // uplift: dead load resists (0.46·R_D), live load never does
  near(b.governingTensionLeft, Math.max(0, 0.7 * 4 - 0.46 * 0.5), 0.01);
});

test('Transfer beam carries the gravity on top of it; reactions go down the posts; walls keep only their part', () => {
  const beams = [{ id: 'bm-1', mark: 'BM-1', levelId: 'lvl-2', position: 0, length: 10, supports: [
    { id: 'bs-1', position: 0, type: 'post', anchorageOverride: '' }, { id: 'bs-2', position: 10, type: 'post', anchorageOverride: '' }] }];
  const posts = [{ id: 'sp-1', mark: 'P-1', levelId: 'lvl-1', position: 0, anchorageOverride: '', postOverride: '' },
    { id: 'sp-2', mark: 'P-2', levelId: 'lvl-1', position: 10, anchorageOverride: '', postOverride: '' }];
  // Floor at the top of story 1 (= the beam's floor line): 100 D / 200 L plf full line
  const gravity = { 'lvl-1': { loads: [ld('full', { D: '100', L: '200' })] } };
  const out = calcAll(model({ levels: two, walls: [wall('w-1', 'lvl-2', 20, 10), wall('w-2', 'lvl-1', 20, 10)], beams, posts, gravity,
    loads: { 'lvl-2': { seismic: 2, wind: 0 }, 'lvl-1': { seismic: 2, wind: 0 } } }));
  const ln = lineOf(out);
  const bt = ln.beamTransfers[0];
  const g = bt.loads.find(l => l.sourceType === 'gravity');
  assert.ok(g, 'gravity load on the beam'); near(g.gravity.D, 1.0, 1e-9); near(g.gravity.L, 2.0, 1e-9); near(g.x, 5, 1e-9);
  near(bt.supports[0].perCombo['D+L'], 1.5, 0.005);
  const p1 = ln.postPaths.find(p => p.postId === 'sp-1');
  near(p1.perCombo['D+L'], 1.5, 0.005);
  // Wall below at 20–30 carries only the floor load over it (1.0 k D), not the beam span
  const w2 = wallsOf(out).find(w => w.wallId === 'w-2');
  near(w2.dlTotal, 1.0, 1e-9); near(w2.live.L.total, 2.0, 1e-9);
  // Nothing over 10–20 ft: noted, not carried
  assert.ok(ln.loadPathAudit.notes.some(n => n.type === 'gravity_unsupported' && /10–20 ft/.test(n.message)));
});

test('Point load on a post top goes to the post; support posts are sized for max(ASD, Ω₀ ASD)', () => {
  const posts = [{ id: 'sp-1', mark: 'P-1', levelId: 'lvl-2', position: 0, anchorageOverride: '', postOverride: '' },
    { id: 'sp-2', mark: 'P-2', levelId: 'lvl-1', position: 0, anchorageOverride: '', postOverride: '' }];
  const walls = [wall('w-1', 'lvl-2', 0, 8, { position: 0 }), wall('w-2', 'lvl-1', 10, 10)];
  // wall w-1 left end sits on post P-2 (story 1) — a discontinued wall end
  const gravity = { 'lvl-1': { loads: [ld('point', { position: 0, D: '1', L: '2' })] } };
  const out = calcAll(model({ levels: two, walls, posts: [posts[1]], gravity, loads: { 'lvl-2': { seismic: 6, wind: 0 }, 'lvl-1': { seismic: 2, wind: 0 } } }));
  const pp = lineOf(out).postPaths.find(p => p.postId === 'sp-2');
  assert.ok(pp.sources.some(s => s.type === 'gravity'), 'point load reaches the post');
  const eO = Math.max(...Object.entries(pp.perCombo).filter(([k]) => /Ω₀E/.test(k) && !/\(/.test(k)).map(([, v]) => v));
  near(pp.postDesignC, Math.max(pp.envelopeC, eO), 0.01);
  assert.equal(pp.postGoverns, 'Ω₀ ASD');
  if (pp.post) near(pp.postDC, pp.postDesignC / pp.post.capacityKips, 0.011);
});

test('FTAO jamb posts include live load (governing ASD compression combo)', () => {
  const w = wall('w-1', 'lvl-1', 0, 12, { method: 'ftao', openings: [{ id: 'op-1', offset: 4, width: 4, sill: 3, head: 7 }] });
  const g0 = calcAll(model({ levels: one, walls: [w], loads: { 'lvl-1': { seismic: 3, wind: 0 } } }));
  const g1 = calcAll(model({ levels: one, walls: [w], loads: { 'lvl-1': { seismic: 3, wind: 0 } }, gravity: { 'lvl-1': { loads: [ld('full', { D: '200', L: '800' })] } } }));
  const j0 = wallsOf(g0)[0].ftao.jambs[0], j1 = wallsOf(g1)[0].ftao.jambs[0];
  assert.ok(j1.ll > 0, 'jamb live load'); assert.ok(j1.C > j0.C);
  assert.ok(/L/.test(j1.combo));
});

test('WSWH: lookup P uses the largest compression combo including 0.75L', () => {
  const p = wall('w-1', 'lvl-1', 0, 1.5, { systemType: 'wswh', wswhWidth: '18', wswhCondition: 'concrete', wswhJoist: '12', wswhFloorDepth: '12', wswhAnchorOverride: '' });
  const out = calcAll(model({ levels: one, walls: [p], loads: { 'lvl-1': { seismic: 1, wind: 0 } }, gravity: { 'lvl-1': { loads: [ld('point', { position: 0.75, D: '1', L: '2' })] } } }));
  const w = wallsOf(out)[0];
  near(w.wswh.P.E, Math.max(1140, 1105 + 1500), 1);
});

test('Flat Load link: assembly psf × trib; roof live → Lr; linkDiff / applyLinks track changes', () => {
  const roof = { id: 'tab1', name: 'Roof', type: 'roof', llSymbol: 'Lr', dl: 15, llGravity: 20 };
  const floor = { id: 'tab2', name: 'Floor', type: 'floor', llSymbol: 'L', dl: 12, llGravity: 40 };
  assert.deepEqual(assemblyLoads(roof, 10), { D: 150, L: 0, Lr: 200 });
  assert.deepEqual(assemblyLoads(floor, 5), { D: 60, L: 200, Lr: 0 });
  const inp = model({ levels: one, walls: [wall('w-1', 'lvl-1', 0, 10)], gravity: { 'lvl-1': { loads: [ld('full', { assemblyId: 'tab2', trib: '5', D: '60', L: '200' })] } } });
  assert.equal(shearWallDesign.linkDiff(inp, { flatLoadSource: { perTab: [floor] } }).length, 0);
  const ch = shearWallDesign.linkDiff(inp, { flatLoadSource: { perTab: [{ ...floor, llGravity: 50 }] } });
  assert.deepEqual(ch.map(c => c.to), [250]);
  shearWallDesign.applyLinks(inp, { flatLoadSource: { perTab: [{ ...floor, llGravity: 50 }] } });
  assert.equal(inp.directions[0].lines[0].gravityLoads['lvl-1'].loads[0].L, '250');
  assert.ok(shearWallDesign.linkDiff(inp, { flatLoadSource: { perTab: [] } })[0].missing);
});

test('v7 → v8 migration: uniform / point dead loads become rows; calc unchanged', () => {
  const legacy = model({ levels: one, walls: [wall('w-1', 'lvl-1', 0, 10)], loads: { 'lvl-1': { seismic: 4, wind: 0 } },
    gravity: { 'lvl-1': { uniform: [{ id: 'gu-1', start: 0, end: 30, dlPlf: 150 }], point: [{ id: 'gp-1', position: 2, dlKips: 1 }] } } });
  const before = wallsOf(calcAll(legacy))[0];
  const m = migrateV7toV8(JSON.parse(JSON.stringify(legacy)));
  const loads = m.directions[0].lines[0].gravityLoads['lvl-1'].loads;
  assert.deepEqual(loads.map(l => [l.shape, l.D]), [['partial', 150], ['point', 1]]);
  assert.equal(m.lrfdHalfL, false);
  const after = wallsOf(calcAll(m))[0];
  assert.equal(after.governingTensionLeft, before.governingTensionLeft);
  assert.equal(after.governingComprRight, before.governingComprRight);
});

test('Calc detail documents every load and the end force of every combination; design basis lists all combos', () => {
  const inp = model({ levels: one, walls: [wall('w-1', 'lvl-1', 0, 10)], loads: { 'lvl-1': { seismic: 4, wind: 0 } },
    gravity: { 'lvl-1': { loads: [ld('point', { position: 2, D: '2', L: '1' }), ld('partial', { start: 0, end: 5, Lr: '100' })] } } });
  const w = wallsOf(calcAll(inp))[0];
  const g = gravityDetail(w).textContent, e = endForceDetail(w).textContent;
  assert.ok(g.includes('#1 Point') && g.includes('D 2.00 / L 1.00') && g.includes('Σ end reactions'));
  assert.ok(g.includes('Lr 100 plf'));
  assert.ok(e.includes('(1.0+0.105SDS)D + 0.525ρE + 0.75L') && e.includes('§2.4.5 (6)') && e.includes('ASD — used for design'));
  assert.ok(e.includes('0.75×0.80'), 'L reaction at the left end substituted (1 k at 2 ft → 0.80)');
  const rows = designBasisRows({ loadType: 'both', omega0: '2.5' });
  assert.ok(rows[0][1].includes('D + L') && rows[0][1].includes('D + 0.75L + 0.75(0.6W) + 0.75Lr'));
  assert.ok(rows[2][1].includes('1.2D + 1.6L + 0.5Lr'));
  const r = checkShearWallItem({ schemaVersion: 8, inputs: inp });
  assert.ok(r.ok, r.error);
  const b = document.createElement('div');
  const o = calcAll(inp);
  renderLineResults(b, lineOf(o), o.perDirection[0], { tab: 'walls', onTab() {} });
  assert.ok(b.textContent.includes('End forces by combination'));
});

test('Gravity panel: add a full-line row, link a Flat Load assembly × trib, markers drawn', () => {
  const inp = model({ levels: one, walls: [wall('w-1', 'lvl-1', 0, 10)], gravity: { 'lvl-1': { loads: [] } } });
  const ln = inp.directions[0].lines[0];
  const floor = { id: 'tab2', name: 'Floor', type: 'floor', llSymbol: 'L', dl: 12, llGravity: 40 };
  const c = document.createElement('div');
  const h = renderElevation(c, ln, inp.levels, [], { flatLoadAssemblies: () => [floor] });
  [...c.querySelectorAll('button')].find(b => b.textContent === '+ Uniform (full line)').dispatchEvent(new window.Event('click'));
  assert.equal(ln.gravityLoads['lvl-1'].loads[0].shape, 'full');
  const pick = (sel, v) => { [...sel.querySelectorAll('option')].forEach(o => o.removeAttribute('selected')); [...sel.querySelectorAll('option')].find(o => o.getAttribute('value') === v).setAttribute('selected', ''); sel.dispatchEvent(new window.Event('change')); };
  pick([...c.querySelectorAll('select')].find(s => [...s.querySelectorAll('option')].some(o => o.getAttribute('value') === 'tab2')), 'tab2');
  const trib = [...c.querySelectorAll('tr')].map(tr => tr.children[5] && tr.children[5].querySelector('input[type="number"]')).find(Boolean);
  trib.value = '5'; trib.dispatchEvent(new window.Event('change'));
  const row = ln.gravityLoads['lvl-1'].loads[0];
  // Linked row: psf × trib (12 / 40 psf × 5 ft = 60 / 200 plf)
  assert.equal(row.assemblyId, 'tab2'); assert.equal(row.perArea, true); assert.equal(row.D, '12'); assert.equal(row.L, '40');
  assert.ok(c.textContent.includes('psf → D 60 / L 200 plf'), 'unit and plf shown on the row');
  h.drawSVG();
  assert.ok([...c.querySelectorAll('text')].some(t => t.textContent === '#1 D 60 / L 200 plf'), 'marker label');
  // Manual row: plf by default; "× trib" switches it to psf × trib
  [...c.querySelectorAll('button')].find(b => b.textContent === '+ Uniform (partial)').dispatchEvent(new window.Event('click'));
  const r2 = ln.gravityLoads['lvl-1'].loads[1];
  assert.ok(!r2.perArea);
  const rowEls = [...c.querySelectorAll('tr')].filter(tr => tr.children.length > 9);
  assert.equal(rowEls[2].children[9].textContent, 'plf', 'default unit plf');
  const tick = (tr, on) => { const cb = tr.querySelector('input[type="checkbox"]'); cb.checked = on; cb.dispatchEvent(new window.Event('change')); };
  assert.ok(rowEls[2].textContent.includes('psf × trib'), 'checkbox label');
  tick(rowEls[2], true);
  assert.equal(r2.perArea, true);
  const row2 = [...c.querySelectorAll('tr')].filter(tr => tr.children.length > 9)[2];
  assert.ok(row2.children[9].textContent.startsWith('psf'));
  tick(row2, false);
  assert.equal(r2.perArea, false);
  assert.equal([...c.querySelectorAll('tr')].filter(tr => tr.children.length > 9)[2].children[9].textContent, 'plf', 'unchecked → back to plf');
  h.destroy();
});

test('Uniform psf × trib rows: calc uses psf × trib; calc detail shows the conversion; linked rows compare psf', () => {
  const g = { 'lvl-1': { loads: [ld('partial', { start: 0, end: 10, perArea: true, trib: '4', D: '15', L: '40' })] } };
  const inp = model({ levels: one, walls: [wall('w-1', 'lvl-1', 0, 10)], loads: { 'lvl-1': { seismic: 2, wind: 0 } }, gravity: g });
  const w = wallsOf(calcAll(inp))[0];
  near(w.dlTotal, 0.6, 1e-9); near(w.live.L.total, 1.6, 1e-9);
  assert.ok(gravityDetail(w).textContent.includes('D 15.0 / L 40.0 psf × 4 ft = D 60 / L 160 plf'));
  const floor = { id: 'tab2', name: 'Floor', type: 'floor', llSymbol: 'L', dl: 15, llGravity: 40 };
  g['lvl-1'].loads[0].assemblyId = 'tab2';
  assert.equal(shearWallDesign.linkDiff(inp, { flatLoadSource: { perTab: [floor] } }).length, 0);
  assert.deepEqual(shearWallDesign.linkDiff(inp, { flatLoadSource: { perTab: [{ ...floor, dl: 18 }] } }).map(c => [c.to, /psf$/.test(c.label)]), [[18, true]]);
});

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
