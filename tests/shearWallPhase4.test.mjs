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
import { checkShearWallItem } from '../scripts/lib/shearWallLoadCheck.mjs';
import { shearWallDesign, renderLineResults } from '../src/modules/shearWallDesign.js';
import { renderElevation, renderElevationForPdf } from '../src/modules/shearWallElevation.js';

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
  const d = deflectionTerms({ v: 500, h: 10, b: 8, E: 1.7e6, A: 10.5, Ga: 16, T: 6250, anchorage: { id: 'HDUE7', cap: 7015, delta: 0.154 }, C: 6250, Ac: 10.5, Fcperp: 625 });
  near(d.t1, 0.0280, 0.0001); near(d.t2, 0.3125, 0.0001); near(d.dHD, 0.1372, 0.0001);
  near(d.dC, 0.0365, 0.0001); near(d.t3, 0.2171, 0.0001); near(d.delta, 0.5577, 0.0002);
});

test('Strap slip uses the MSTC LRFD cap (ASD cap / 0.7); HDUE uses the ASD cap', () => {
  const m = deflectionTerms({ v: 500, h: 10, b: 8, E: 1.7e6, A: 10.5, Ga: 16, T: 2000, anchorage: { id: 'MSTC40', cap: 3070, delta: 0.097 }, C: 0, Ac: 10.5, Fcperp: 625 });
  near(m.dHD, 0.097 * 2000 / (3070 / 0.7), 0.0001);
  const h = deflectionTerms({ v: 500, h: 10, b: 8, E: 1.7e6, A: 10.5, Ga: 16, T: 2000, anchorage: { id: 'HDUE5', cap: 5375, delta: 0.146 }, C: 0, Ac: 10.5, Fcperp: 625 });
  near(h.dHD, 0.146 * 2000 / 5375, 0.0001);
});

test('FTAO jamb posts: C = fD·DL + v_i·h_o; self-weight excludes openings; loads over openings count for FTAO', () => {
  const V1 = 3750 / 0.7 / 1000;
  const bare = wallsOf(calcAll(oneStory([t555Wall()], { seismic: V1, floorH: 8 })))[0];
  const j1 = bare.ftao.jambs[0];
  assert.equal(bare.ftao.jambs.length, 4);
  near(j1.C, 337.3 * (8 / 3) / 1000, 0.005, 'no DL: C = v1·h_o');
  assert.ok(j1.post && j1.post.id === '(2)2x4' && j1.dc < 1);
  const withDL = oneStory([t555Wall({ wallDLTypeId: 'wdt-1' })], { seismic: V1, floorH: 8 });
  withDL.wallDLTypes = [{ id: 'wdt-1', name: 'Ext', psf: 10 }];
  const w = wallsOf(calcAll(withDL))[0];
  near(w.dlWallSelf, (19.5 * 8 - (6 + 2) * (8 / 3)) * 10 / 1000, 0.005, 'self-weight without openings');
  near(w.ftao.jambs[0].dl, (4 * 8 * 10 / 2 + 6 * (4 / 3) * 10 / 2) / 1000, 0.005, 'half pier + half header');
  near(w.ftao.jambs[0].C, 1.14 * w.ftao.jambs[0].dl + 337.3 * (8 / 3) / 1000, 0.006);
  // A uniform load over opening 1 reaches the FTAO wall (overturning DL) and its jambs
  withDL.directions[0].lines[0].gravityLoads = { 'lvl-1': { uniform: [{ id: 'gu-1', start: 4, end: 10, dlPlf: 200 }], point: [] } };
  const g = wallsOf(calcAll(withDL))[0];
  near(g.dlFromDiagram, 1.2, 0.005);
  near(g.ftao.jambs[0].dl - w.ftao.jambs[0].dl, 0.6, 0.005);
});

test('Segmented: only loads over the pier lengths reach the piers', () => {
  const inp = oneStory([wall('w-1', 0, 10, { openings: [{ id: 'op-1', offset: 4, width: 2, sill: 3, head: 7 }] })]);
  inp.directions[0].lines[0].gravityLoads = { 'lvl-1': { uniform: [{ id: 'gu-1', start: 0, end: 10, dlPlf: 100 }], point: [] } };
  assert.deepEqual(wallsOf(calcAll(inp)).map(p => p.dlFromDiagram), [0.4, 0.4]);
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
  const lo = tc.combos['(0.9-0.2SDS)D+ρE_pos'], hi = tc.combos['(1.2+0.2SDS)D+ρE+L_pos'];
  assert.equal(lo.group, 'lrfd');
  near(lo.tensionLeft, 4.85, 0.005); near(lo.comprRight, 7.65, 0.005);
  near(hi.comprRight, 9.05, 0.005);
  near(tc.lrfdTensionLeft, 4.85, 0.005); near(tc.lrfdComprRight, 9.05, 0.005);
  // ASD: T = 0.7·5·10/8 − (0.6 − 0.14)·4/2 = 4.375 − 0.92
  near(tc.governingTensionLeft, 3.455, 0.005);
  near(tc.governingComprRight, 4.375 + 1.14 * 2, 0.006);
  const w = computeWallTC(0, 5, 4, 8, 10, 1.0, 0, 'wind');
  near(w.combos['0.9D+1.0W_pos'].tensionLeft, 6.25 - 1.8, 0.005);
  near(w.combos['1.2D+1.0W+L+0.5Lr_neg'].comprLeft, 6.25 + 2.4, 0.005);
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

test('Openings definition renders: form, results, PDF sections, elevations', () => {
  const inp = oneStory([t555Wall(), wall('w-2', 25, 10, { openings: [{ id: 'op-3', offset: 4, width: 2, sill: 3, head: 7 }] })],
    { seismic: 8, floorH: 8, loadType: 'both', extra: { cd: '4', ie: '1', riskCategory: 'II', alphaS: '0.7' } });
  inp.directions[0].lines[0].levelLoads['lvl-1'].wind = 6;
  const r = checkShearWallItem({ schemaVersion: 6, inputs: inp });
  assert.ok(r.ok, r.error);
  const out = shearWallDesign.calc(inp);
  const c = document.createElement('div');
  shearWallDesign.renderOutputs(c, out);
  assert.ok(c.textContent.includes('Full results for each wall line'), 'bottom section is a summary');
  assert.ok(!c.textContent.includes('SW-2a'), 'no wall detail in the summary');
  // Line results, one sub-tab at a time
  const dirOut = out.perDirection[0], ln = dirOut.perLine[0];
  const tabText = (tab, report) => { const b = document.createElement('div'); renderLineResults(b, ln, dirOut, { tab, onTab() {}, report }); return b.textContent; };
  const expect = { walls: ['SW-2a', 'SW-2b', 'Overturning'], distribution: ['Capacity method', 'Weight = cap × L', 'story shear V'], drift: ['Story drift', 'Wall deflections'], lrfd: ['forces only', 'HDUE LRFD cap'], loadpath: ['load path'] };
  for (const [tab, words] of Object.entries(expect)) for (const w of words) assert.ok(tabText(tab).toLowerCase().includes(w.toLowerCase()), tab + ' tab shows ' + w);
  // Summary report: schedule + overturning summary; detailed: each wall's calc by type (FTAO included)
  assert.ok(!tabText('walls').includes('FTAO calc'), 'summary has no per-wall calc');
  for (const w of ['Calc detail', 'FTAO calc', 'Jamb posts', 'End forces by combination']) assert.ok(tabText('walls', 'detailed').includes(w), 'detailed report shows ' + w);
  assert.ok(tabText('ftao').includes('Overturning'), 'old FTAO tab key falls back to Walls');
  // The line tab of the form shows the line results
  const form = document.createElement('div');
  shearWallDesign.renderForm(form, JSON.parse(JSON.stringify(inp)), () => {}, [], () => {});
  [...form.querySelectorAll('button')].find(b => b.textContent === 'N-S').dispatchEvent(new window.Event('click'));
  assert.ok(form.textContent.includes('Line Results — N-S / A'), 'line tab has its results');
  [...form.querySelectorAll('button')].find(b => b.textContent.startsWith('Drift')).dispatchEvent(new window.Event('click'));
  assert.ok(form.textContent.includes('Story drift'), 'sub-tab switches');
  const titles = shearWallDesign.pdfSections(inp).map(x => x.title).join(' | ');
  for (const t of ['FTAO SW-1', 'LRFD Forces', 'Story Drift', 'Wall Deflection']) assert.ok(titles.includes(t), 'PDF has ' + t);
});

test('Elevation: segmented piers drawn with their marks, FTAO strap label, pier quick edit sets the parent', () => {
  const inp = oneStory([t555Wall(), wall('w-2', 25, 10, { openings: [{ id: 'op-3', offset: 4, width: 2, sill: 3, head: 7 }] })], { seismic: 8, floorH: 8 });
  const line = inp.directions[0].lines[0];
  const resFor = () => shearWallDesign.calc(inp).perDirection[0].perLine[0];
  const c = document.createElement('div');
  const h = renderElevation(c, line, inp.levels, [], { onInputChange() { h.showResults(resFor()); } });
  h.showResults(resFor());
  const texts = () => [...c.querySelectorAll('text')].map(t => t.textContent);
  assert.ok(texts().includes('SW-2a') && texts().includes('SW-2b'), 'pier marks');
  const strap = resFor().perLevel[0].walls.find(w => w.method === 'ftao').ftao.strap.id;
  assert.ok(texts().includes(strap), 'FTAO strap label ' + strap);
  c.querySelector('.elevation-wrapper').getBoundingClientRect = () => ({ left: 0, top: 0 });
  const t = c.querySelector('[data-edit="nailing:w-2#p1"]');
  assert.ok(t, 'pier nailing target');
  const ev = new window.Event('click', { bubbles: true }); ev.clientX = 10; ev.clientY = 10;
  t.dispatchEvent(ev);
  const qe = c.querySelector('.quick-edit');
  assert.ok(qe && !qe.hidden, 'quick editor open');
  const sel = qe.querySelector('select');
  [...sel.querySelectorAll('option')].forEach(o => o.removeAttribute('selected'));
  [...sel.querySelectorAll('option')].find(o => o.getAttribute('value') === '3').setAttribute('selected', '');
  sel.dispatchEvent(new window.Event('change'));
  assert.equal(line.walls[1].nailingPattern, '3', 'parent wall nailing overridden');
  const pdf = renderElevationForPdf(line, inp.levels, [], resFor(), 600);
  const pdfTexts = [...pdf.querySelectorAll('text')].map(x => x.textContent);
  assert.ok(pdfTexts.includes('SW-2a') && pdfTexts.includes(strap), 'PDF shows piers and strap');
  h.destroy();
});

test('Deflection approach: wall δ at a level within 5% ((δmax − δmin)/δmax); converges', () => {
  const walls = [wall('w-1', 0, 8, { nailingPattern: '4' }), wall('w-2', 20, 4, { nailingPattern: '4' })];
  const cap = calcAll(oneStory(JSON.parse(JSON.stringify(walls)), { seismic: 6 }));
  const inp = oneStory(walls, { seismic: 6, extra: { distribution: 'deflection' } });
  const out = calcAll(inp);
  const [a, b] = wallsOf(out), [ca, cb] = wallsOf(cap);
  const dist = lineOf(out).distribution;
  assert.equal(dist.method, 'deflection'); assert.equal(dist.converged, true); assert.ok(dist.passes >= 2);
  near(a.share_1E + b.share_1E, 6, 0.011);
  assert.ok(b.share_1E < cb.share_1E, 'short (softer) wall takes less than its capacity share');
  const hi = Math.max(a.deflection.E.delta, b.deflection.E.delta), lo = Math.min(a.deflection.E.delta, b.deflection.E.delta);
  assert.ok((hi - lo) / hi <= 0.05, 'wall δ within 5%: ' + a.deflection.E.delta + ' / ' + b.deflection.E.delta);
  near(dist.spread, (hi - lo) / hi, 0.0002, 'reported spread');
  assert.equal(lineOf(cap).distribution.method, 'capacity');
  near(ca.share_1E / cb.share_1E, (470 * 8) / (470 * 0.9375 * 4), 0.02);
});

test('Deflection approach: identical walls share equally; line setting overrides the project default', () => {
  const inp = oneStory([wall('w-1', 0, 8), wall('w-2', 20, 8)], { seismic: 6, extra: { distribution: 'deflection' } });
  const [a, b] = wallsOf(calcAll(inp));
  near(a.share_1E, 3, 0.011); near(b.share_1E, 3, 0.011);
  inp.directions[0].lines[0].distribution = 'capacity';
  assert.equal(lineOf(calcAll(inp)).distribution.method, 'capacity');
  const inp2 = oneStory([wall('w-1', 0, 8), wall('w-2', 20, 8)], { seismic: 6 });
  inp2.directions[0].lines[0].distribution = 'deflection';
  assert.equal(lineOf(calcAll(inp2)).distribution.method, 'deflection');
});

test('Deflection approach with an FTAO wall and wind', () => {
  const inp = oneStory([t555Wall({ nailingPattern: '4' }), wall('w-2', 30, 8, { nailingPattern: '4' })],
    { seismic: 4, wind: 3, floorH: 8, loadType: 'both', extra: { distribution: 'deflection' } });
  const out = calcAll(inp);
  const [f, r] = wallsOf(out);
  assert.ok(f.stiffness.E > 0 && f.stiffness.W > 0 && r.stiffness.W > 0);
  near(f.share_1E + r.share_1E, 4, 0.011); near(f.share_1W + r.share_1W, 3, 0.011);
  assert.equal(lineOf(out).distribution.converged, true);
});

test('Distribution dropdowns render; results and PDF name the approach', () => {
  const inp = oneStory([wall('w-1', 0, 8), wall('w-2', 20, 4)], { seismic: 6, extra: { distribution: 'deflection' } });
  const r = checkShearWallItem({ schemaVersion: 6, inputs: inp });
  assert.ok(r.ok, r.error);
  const form = document.createElement('div');
  shearWallDesign.renderForm(form, JSON.parse(JSON.stringify(inp)), () => {}, [], () => {});
  assert.ok(form.textContent.includes('Wall Distribution (default)'));
  const c = document.createElement('div');
  shearWallDesign.renderOutputs(c, shearWallDesign.calc(inp));
  const b = document.createElement('div');
  const o = shearWallDesign.calc(inp);
  renderLineResults(b, o.perDirection[0].perLine[0], o.perDirection[0], { tab: 'walls', onTab() {} });
  assert.ok(b.textContent.includes('distribution by deflection (wall δ within'));
  assert.ok(shearWallDesign.pdfSections(inp).some(s => (s.rows || []).some(r => /distribution by deflection/.test(r[1]))), 'PDF line summary names the approach');
});

test('Base Shear link: changed Cd flagged, applyLinks copies Sds/Cd/Ie/RC', () => {
  const inp = { sds: '1.0', cd: '4', ie: '1.0', riskCategory: 'II' };
  const linked = { baseShearSource: { sds: 1.0, cd: 5, ie: 1.0, riskCategory: 'II' } };
  const ch = shearWallDesign.linkDiff(inp, linked);
  assert.deepEqual(ch.map(c => c.label), ['Cd']);
  shearWallDesign.applyLinks(inp, linked);
  assert.equal(inp.cd, '5');
});

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
