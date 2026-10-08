// Shear Wall Design calc checks. Run: node tests/shearWall.test.mjs
import fs from 'fs';
import assert from 'assert/strict';
import { calcAll } from '../src/modules/shearWallCalc.js';
import { resolveVerticalLoadPath } from '../src/modules/shearWallLoadPath.js';
import { resetIds, resetElementNums, newBeam, newSupportPost, newBeamSupport } from '../src/modules/shearWallTypes.js';
import { computeElevationLayout } from '../src/modules/shearWallElevation.js';
import { migrateV4toV5 } from '../src/modules/shearWallDesign.js';

const fixture = () => JSON.parse(fs.readFileSync(new URL('./fixtures/shearwall-sample.json', import.meta.url), 'utf8'));
const baselineA = JSON.parse(fs.readFileSync(new URL('./fixtures/shearwall-lineA-baseline.json', import.meta.url), 'utf8'));
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const lineOut = (out, name) => out.perDirection[0].perLine.find(l => l.lineName === name);
const wallRes = (ln, mark) => ln.perLevel.flatMap(p => p.walls).find(w => w.mark === mark);

test('IDs: beams/posts/supports get unique sequential ids after resetIds', () => {
  const inp = fixture();
  resetIds(inp); resetElementNums(inp);
  const b1 = newBeam('lvl-1', 0, 8), b2 = newBeam('lvl-1', 10, 8);
  const p1 = newSupportPost('lvl-2', 0), p2 = newSupportPost('lvl-2', 4);
  const s1 = newBeamSupport(0);
  assert.equal(b1.id, 'bm-2'); assert.equal(b2.id, 'bm-3');
  assert.equal(p1.id, 'sp-6'); assert.equal(p2.id, 'sp-7');
  assert.equal(s1.id, 'bs-3');
  assert.equal(b1.mark, 'BM-2'); assert.equal(p1.mark, 'P-6');
});

test('Migration v4→v5: duplicate bm-NaN / sp-NaN re-IDed, marks + explicit supports added', () => {
  const inp = { levels: [{ id: 'lvl-1' }, { id: 'lvl-2' }], directions: [{ lines: [{
    walls: [],
    beams: [{ id: 'bm-NaN', levelId: 'lvl-1', position: 0, length: 10 }, { id: 'bm-NaN', levelId: 'lvl-1', position: 20, length: 6 }],
    supportPosts: [{ id: 'sp-NaN', levelId: 'lvl-2', position: 0 }, { id: 'sp-NaN', levelId: 'lvl-2', position: 26 }],
  }] }] };
  migrateV4toV5(inp);
  const ln = inp.directions[0].lines[0];
  assert.deepEqual(ln.beams.map(b => b.id), ['bm-1', 'bm-2']);
  assert.deepEqual(ln.supportPosts.map(p => p.id), ['sp-1', 'sp-2']);
  assert.deepEqual(ln.beams.map(b => b.mark), ['BM-1', 'BM-2']);
  assert.deepEqual(ln.beams[0].supports.map(s => [s.position, s.type]), [[0, 'post'], [10, 'point']]);
  assert.deepEqual(ln.beams[1].supports.map(s => [s.position, s.type]), [[20, 'point'], [26, 'post']]);
  const again = JSON.stringify(inp);
  migrateV4toV5(inp);
  assert.equal(JSON.stringify(inp), again, 'migration is idempotent');
});

test('Migration v4→v5: mixed valid and NaN ids continue after the highest existing number', () => {
  const inp = { levels: [{ id: 'lvl-1' }, { id: 'lvl-2' }], directions: [{ lines: [{
    walls: [],
    beams: [{ id: 'bm-3', mark: 'BM-3', levelId: 'lvl-1', position: 0, length: 10 }, { id: 'bm-NaN', levelId: 'lvl-1', position: 20, length: 6 }],
    supportPosts: [{ id: 'sp-4', mark: 'P-4', levelId: 'lvl-2', position: 0 }, { id: 'sp-NaN', levelId: 'lvl-2', position: 26 }],
  }] }] };
  migrateV4toV5(inp);
  const ln = inp.directions[0].lines[0];
  assert.deepEqual(ln.beams.map(b => b.id), ['bm-3', 'bm-4']);
  assert.deepEqual(ln.beams.map(b => b.mark), ['BM-3', 'BM-4']);
  assert.deepEqual(ln.supportPosts.map(p => p.id), ['sp-4', 'sp-5']);
  assert.deepEqual(ln.supportPosts.map(p => p.mark), ['P-4', 'P-5']);
});

test('Regression: aligned stacked walls match Phase 3 results (nailing, T/C, accumulation, hardware)', () => {
  const ln = lineOut(calcAll(fixture()), 'Line A');
  // end forces are unrounded since calc v12; the Phase 3 baseline is at 0.01 k (display rounding)
  const q = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const rows = ln.perLevel.flatMap(p => p.walls).map(w => ({ mark: w.mark, nailing: w.nailing.id, dcRatio: w.dcRatio,
    govT: [q(w.governingTensionLeft), q(w.governingTensionRight)], govC: [q(w.governingComprLeft), q(w.governingComprRight)],
    accumT: q(w.accumTension ?? null), accumC: q(w.accumCompression ?? null),
    anchorage: [(w.anchorageLeft || {}).id || null, (w.anchorageRight || {}).id || null],
    anchorageDC: [w.anchorageDCLeft, w.anchorageDCRight],
    post: [(w.postLeft || {}).postLabel || null, (w.postRight || {}).postLabel || null], postDC: [w.postDCLeft, w.postDCRight] }));
  // Phase 3 also set accum values on the top wall of a stack (= its own); now only walls that receive load have them
  const base = baselineA.map(r => {
    const now = rows.find(x => x.mark === r.mark);
    return now && now.accumT === null && r.accumT === Math.max(...r.govT) ? { ...r, accumT: null, accumC: null } : r;
  });
  // ids exact; forces within 0.02 k and D/C within 0.01 (unrounded end forces, calc v12: sums of stacked ends move ≤ 0.01 k)
  const ids = (r) => ({ mark: r.mark, nailing: r.nailing, anchorage: r.anchorage, post: r.post });
  assert.deepEqual(rows.map(ids), base.map(ids));
  const close = (x, y, tol, what) => { if (x == null || y == null) return assert.equal(x, y, what); assert.ok(Math.abs(x - y) <= tol + 1e-9, what + ': ' + x + ' vs ' + y); };
  rows.forEach((r, i) => {
    const b = base[i];
    for (const k of ['govT', 'govC']) r[k].forEach((v, j) => close(v, b[k][j], 0.02, r.mark + ' ' + k));
    for (const k of ['accumT', 'accumC']) close(r[k], b[k], 0.02, r.mark + ' ' + k);
    for (const k of ['anchorageDC', 'postDC']) r[k].forEach((v, j) => close(v, b[k][j], 0.011, r.mark + ' ' + k));
    close(r.dcRatio, b.dcRatio, 1e-9, r.mark + ' dcRatio');
  });
  assert.equal(ln.loadPathAudit.warnings.length, 0);
});

// Synthetic engine input: one ASD combo 'X', one wall (uplift 3k left, compression 5k right) on a beam
function engineCase(beam, wallEnds) {
  const levels = [
    { id: 'a', name: 'Top', floorToFloor: 10, anchorageType: 'auto', floorClearSpan: '16' },
    { id: 'b', name: 'Bot', floorToFloor: 10 },
  ];
  const walls = [{ id: 'w', mark: 'SW', levelId: 'a', position: wallEnds[0], length: wallEnds[1] - wallEnds[0] }];
  const wr = { wallId: 'w', combos: { X: { group: 'asd', tensionLeft: 3, comprLeft: 0, tensionRight: 0, comprRight: 5 } } };
  return resolveVerticalLoadPath({
    levels, walls, beams: [beam], posts: [], wallResultsMap: { w: wr }, stackGroupIds: [],
    onBeamIds: new Set(['w']), lineThickness: '4', grade: { Fc: 1500, Fcperp: 625, E: 1700000, Emin: 620000 },
  });
}

test('Beam statics hand check: supports 0 & 12, uplift 3k @2, compression 5k @8', () => {
  const r = engineCase({ id: 'bm', mark: 'BM', levelId: 'a', position: 0, length: 12,
    supports: [{ id: 's1', position: 0, type: 'point' }, { id: 's2', position: 12, type: 'point' }] }, [2, 8]);
  const [a, b] = r.beamTransfers[0].supports;
  // R0 = -3(10/12) + 5(4/12) = -0.833 (uplift); R12 = 2 - (-0.833) = 2.833
  assert.ok(near(a.perCombo.X, -0.83), 'R0 = ' + a.perCombo.X);
  assert.ok(near(b.perCombo.X, 2.83), 'R12 = ' + b.perCombo.X);
  assert.ok(Math.abs(a.envelopeT - 5 / 6) < 1e-9, 'unrounded R0 uplift = 5/6 k');
  assert.ok(Math.abs(b.envelopeC - 17 / 6) < 1e-9, 'unrounded R12 = 17/6 k');
});

test('Beam statics overhang: supports 2 & 10, wall 4–11 (compression end on overhang)', () => {
  const r = engineCase({ id: 'bm', mark: 'BM', levelId: 'a', position: 0, length: 12,
    supports: [{ id: 's1', position: 2, type: 'point' }, { id: 's2', position: 10, type: 'point' }] }, [4, 11]);
  const [a, b] = r.beamTransfers[0].supports;
  // Ra = -3(10-4)/8 + 5(10-11)/8 = -2.25 - 0.625 = -2.875; Rb = 2 - Ra = 4.875
  assert.ok(near(a.perCombo.X, -2.88), 'Ra = ' + a.perCombo.X);
  assert.ok(near(b.perCombo.X, 4.88), 'Rb = ' + b.perCombo.X);
});

test('Stacked posts (Line B): each post carries the wall end above, per combo, to foundation', () => {
  const ln = lineOut(calcAll(fixture()), 'Line B');
  const sw7 = wallRes(ln, 'SW-7');
  const pp = Object.fromEntries(ln.postPaths.map(p => [p.mark, p]));
  for (const k of Object.keys(sw7.combos)) {
    const c = sw7.combos[k];
    assert.ok(near(pp['P-1'].perCombo[k], c.comprLeft - c.tensionLeft), 'P-1 ' + k);
    assert.ok(near(pp['P-2'].perCombo[k], c.comprRight - c.tensionRight), 'P-2 ' + k);
    assert.ok(near(pp['P-3'].perCombo[k], pp['P-1'].perCombo[k]), 'P-3 ' + k);
  }
  assert.equal(pp['P-1'].receiver.label, 'P-3');
  assert.equal(pp['P-3'].receiver.type, 'foundation');
  assert.equal(pp['P-3'].anchorageType, 'holdown');
  assert.equal(pp['P-1'].anchorageType, 'strap');
  assert.ok(pp['P-3'].anchorage && pp['P-3'].anchorage.cap >= pp['P-3'].envelopeT * 1000);
  assert.equal(ln.loadPathAudit.warnings.length, 0, JSON.stringify(ln.loadPathAudit.warnings));
});

test('Beam point support over a wall end (Line C): reaction added to SW-12 left end per combo', () => {
  const ln = lineOut(calcAll(fixture()), 'Line C');
  const bt = ln.beamTransfers[0];
  const right = bt.supports.find(s => s.position === 14);
  assert.equal(right.receiver.type, 'wall_end');
  assert.equal(right.receiver.label, 'SW-12 L');
  const sw12 = wallRes(ln, 'SW-12');
  assert.ok(sw12.injections && sw12.injections.length === 1);
  for (const k of Object.keys(sw12.combos)) {
    const base = sw12.combos[k];
    const net = (base.comprLeft - base.tensionLeft) + right.perCombo[k];
    const got = sw12.accumPerCombo[k].comprLeft - sw12.accumPerCombo[k].tensionLeft;
    assert.ok(near(got, net, 0.02), k + ' net ' + got + ' vs ' + net);
  }
  const left = bt.supports.find(s => s.position === 2);
  const p5 = ln.postPaths.find(p => p.mark === 'P-5');
  assert.equal(left.receiver.label, 'P-5');
  for (const k of Object.keys(left.perCombo)) assert.ok(near(p5.perCombo[k], left.perCombo[k]), 'P-5 ' + k);
  for (const k of Object.keys(left.perCombo)) {
    const sumLoads = bt.loads.reduce((s, ld) => s + ld.map[k], 0);
    assert.ok(near(sumLoads, left.perCombo[k] + right.perCombo[k], 0.02), 'equilibrium ' + k);
  }
});

test('Audit: 1 support, Post support without post, post with nothing below, reaction-only note', () => {
  const inp = fixture();
  const lnC = inp.directions[0].lines[2];
  lnC.supportPosts = [{ id: 'sp-9', mark: 'P-9', levelId: 'lvl-2', position: 39 }];
  lnC.beams.push({ id: 'bm-2', mark: 'BM-2', levelId: 'lvl-2', position: 31, length: 6, supports: [{ id: 'bs-3', position: 31, type: 'point' }] });
  lnC.beams[0].supports[1].position = 12;
  const ln = lineOut(calcAll(inp), 'Line C');
  const types = ln.loadPathAudit.warnings.map(w => w.type);
  assert.ok(types.includes('post_support_missing'), types.join());
  assert.ok(types.includes('beam_invalid'), types.join());
  assert.ok(types.includes('unsupported_post'), types.join());
  assert.ok(ln.loadPathAudit.notes.some(n => n.type === 'reaction_reported'));
});

test('Layout: label bands only where needed; beam labels go in the story below', () => {
  const inp = fixture();
  const [lnA, , lnC] = inp.directions[0].lines;
  const A = computeElevationLayout(lnA, inp.levels, { width: 800, showForces: true, showHW: true });
  assert.ok(A.levelYs.every(l => l.topBandH === 0 && l.postHwH === 0) && !A.fdnBand);
  const C = computeElevationLayout(lnC, inp.levels, { width: 800, showForces: true, showHW: true });
  const [l1, l2, l3] = C.levelYs;
  assert.equal(l1.forceStripH + l1.topBandH + l1.postHwH, 0, 'empty 3rd story: no bands');
  assert.ok(l2.topBandH === 0 && l2.forceStripH > 0 && l2.postHwH === 0, '2nd: T/C only');
  assert.ok(l3.topReactH > 0 && l3.topHwH > 0 && l3.postHwH > 0, '1st: BM-1 labels on top, P-5 base HW');
  assert.ok(C.levelYs.every(l => l.floorY === l.y + l.h && l.bodyY === l.y + l.topBandH));
  const off = computeElevationLayout(lnC, inp.levels, { width: 800 });
  assert.ok(off.levelYs.every(l => l.h === l.basePx), 'compact when overlays off');
});

// Reduced from Line 2 of the Test 123 project: SW-7 36–41 (top) over SW-8 36–51, P-17 at 41 inside SW-8's story,
// SW-8 left end on SW-10 right end (26–36), SW-8 right end on P-21.
function offsetCase(extra) {
  const inp = fixture();
  const ln = inp.directions[0].lines[0];
  ln.levelLoads = { 'lvl-1': { seismic: 2, wind: 0 }, 'lvl-2': { seismic: 2, wind: 0 }, 'lvl-3': { seismic: 2, wind: 0 } };
  ln.gravityLoads = {};
  ln.walls = [
    { id: 'w-7', mark: 'SW-7', levelId: 'lvl-1', position: 36, length: 5, wallDLTypeId: 'wdt-1' },
    { id: 'w-8', mark: 'SW-8', levelId: 'lvl-2', position: 36, length: 15, wallDLTypeId: 'wdt-1' },
    { id: 'w-10', mark: 'SW-10', levelId: 'lvl-3', position: 26, length: 10, wallDLTypeId: 'wdt-1' },
  ];
  ln.supportPosts = [
    { id: 'sp-17', mark: 'P-17', levelId: 'lvl-2', position: 41 },
    { id: 'sp-20', mark: 'P-20', levelId: 'lvl-3', position: 41 },
    { id: 'sp-21', mark: 'P-21', levelId: 'lvl-3', position: 51 },
  ];
  if (extra) extra(ln);
  inp.loadType = 'seismic';
  return lineOut(calcAll(inp), 'Line A');
}

test('Offset stacking: SW-7 right end goes to P-17, not into SW-8', () => {
  const ln = offsetCase();
  const dl = (id, side) => ln.wallDeliveries.find(d => d.wallId === id && d.side === side).receiver.label;
  assert.equal(dl('w-7', 'left'), 'SW-8 L');
  assert.equal(dl('w-7', 'right'), 'P-17');
  assert.equal(dl('w-8', 'left'), 'SW-10 R');
  assert.equal(dl('w-8', 'right'), 'P-21');
  const sw7 = wallRes(ln, 'SW-7'), sw8 = wallRes(ln, 'SW-8'), sw10 = wallRes(ln, 'SW-10');
  const p17 = ln.postPaths.find(p => p.mark === 'P-17'), p20 = ln.postPaths.find(p => p.mark === 'P-20');
  for (const k of Object.keys(sw7.combos)) {
    const c7 = sw7.combos[k], c8 = sw8.combos[k], a8 = sw8.accumPerCombo[k];
    assert.ok(near(p17.perCombo[k], c7.comprRight - c7.tensionRight), 'P-17 ' + k);
    assert.ok(near(p20.perCombo[k], p17.perCombo[k]), 'P-20 ' + k);
    assert.ok(near(a8.comprRight - a8.tensionRight, c8.comprRight - c8.tensionRight), 'SW-8 R own only ' + k);
    assert.ok(near(a8.comprLeft - a8.tensionLeft, (c8.comprLeft - c8.tensionLeft) + (c7.comprLeft - c7.tensionLeft)), 'SW-8 L ' + k);
  }
  assert.ok(sw10.injections.some(s => s.label === 'SW-8 L' && s.side === 'right'));
  assert.equal(ln.loadPathAudit.warnings.length, 0, JSON.stringify(ln.loadPathAudit.warnings));
  assert.ok(p20.hasPostAbove && p20.levelLoadEnv.T === 0 && p20.levelLoadEnv.C === 0, 'P-20 P row = 0 (all load from P-17)');
  assert.ok(!p17.hasPostAbove && near(p17.levelLoadEnv.T, p17.envelopeT), 'P-17 P row = its Σ');
});

test('Mid-wall end without a post: warning and no transfer into the wall below', () => {
  const ln = offsetCase(l => { l.supportPosts = l.supportPosts.filter(p => p.mark !== 'P-17'); });
  const d = ln.wallDeliveries.find(x => x.wallId === 'w-7' && x.side === 'right');
  assert.equal(d.receiver.type, 'wall_mid');
  const w = ln.loadPathAudit.warnings.find(x => x.type === 'unsupported_wall' && x.elementMark === 'SW-7');
  assert.ok(w && /add a post/.test(w.message), JSON.stringify(ln.loadPathAudit.warnings));
  const sw8 = wallRes(ln, 'SW-8');
  const c8 = sw8.combos['0.6D+0.7ρE_neg'], a8 = sw8.accumPerCombo['0.6D+0.7ρE_neg'];
  assert.ok(near(a8.tensionRight, c8.tensionRight), 'SW-8 right T unchanged');
});

test('Duplicate posts at the same position are flagged', () => {
  const ln = offsetCase(l => { l.supportPosts.push({ id: 'sp-99', mark: 'P-99', levelId: 'lvl-3', position: 41 }); });
  const w = ln.loadPathAudit.warnings.find(x => x.type === 'duplicate_post');
  assert.ok(w && w.elementMark === 'P-99' && /P-20/.test(w.message));
  assert.ok(!ln.loadPathAudit.notes.some(n => n.elementMark === 'P-99'));
});

test('S9: 0.6D combos use their own gravity factor for compression', () => {
  const ln = lineOut(calcAll(fixture()), 'Line A');
  const w = wallRes(ln, 'SW-1');
  // net = fD·R_end ± OTM/L with the dead-load end reaction by statics (R6)
  const s = w.steps.seismic, L = w.length, rR = w.steps.rR;
  assert.ok(near(w.combos['0.6D+0.7ρE_pos'].comprRight, s.otm / L + s.gfUplift * rR));
  assert.ok(near(w.combos['D+0.7ρE_pos'].comprRight, s.otm / L + s.gfComp * rR));
  assert.ok(near(w.combos['0.6D+0.6W_pos'].comprRight, w.steps.wind.otm / L + 0.6 * rR));
});

test('Load cases 1.0E / 1.0W are lateral only: equal and opposite end forces, no dead load', () => {
  const ln = lineOut(calcAll(fixture()), 'Line A');
  for (const w of ln.perLevel.flatMap(p => p.walls)) {
    for (const [k, V] of [['1.0E', w.share_1E], ['1.0W', w.share_1W]]) {
      const c = w.combos[k];
      const expected = V * w.floorH / w.length;
      assert.ok(near(c.tensionLeft, expected) && near(c.comprRight, expected), w.mark + ' ' + k + ' = V·h/L');
      assert.equal(c.comprLeft, 0); assert.equal(c.tensionRight, 0);
    }
    const d = w.combos['1.0D'];
    assert.ok(near(d.comprLeft, w.dlTotal / 2) && near(d.comprRight, w.dlTotal / 2), w.mark + ' 1.0D = D/2 each end');
  }
});

test('Every combination reports both ends: net = fD·D/2 ∓ OTM/L', () => {
  const ln = lineOut(calcAll(fixture()), 'Line A');
  for (const w of ln.perLevel.flatMap(p => p.walls)) {
    const half = w.dlTotal / 2, L = w.length;
    const mE = (0.7 * 1.0 * w.share_1E * w.floorH) / L, mW = (0.6 * w.share_1W * w.floorH) / L;
    const s = w.steps.seismic;
    for (const [k, fD, m] of [['0.6D+0.7ρE_pos', s.gfUplift, mE], ['0.6D+0.7ρE_neg', s.gfUplift, -mE], ['D+0.7ρE_pos', s.gfComp, mE],
      ['D+0.7ρE_neg', s.gfComp, -mE], ['0.6D+0.6W_pos', 0.6, mW], ['0.6D+0.6W_neg', 0.6, -mW], ['D+0.6W_pos', 1.0, mW], ['D+0.6W_neg', 1.0, -mW]]) {
      const c = w.combos[k];
      assert.ok(near(c.comprLeft - c.tensionLeft, fD * half - m, 0.02), w.mark + ' ' + k + ' left');
      assert.ok(near(c.comprRight - c.tensionRight, fD * half + m, 0.02), w.mark + ' ' + k + ' right');
    }
  }
});

// === Saved definitions from every schema era must still open with the current code ===
const { checkShearWallItem } = await import('../scripts/lib/shearWallLoadCheck.mjs');
const { shearWallDesign } = await import('../src/modules/shearWallDesign.js');
const { renderElevation, renderElevationForPdf, textBox } = await import('../src/modules/shearWallElevation.js');

test('Elevation: walls reach the floor line, beam sits on it, reactions below it (PDF + live)', () => {
  const inp = fixture();
  const lnC = inp.directions[0].lines[2];
  const lo = lineOut(calcAll(inp), 'Line C');
  // PDF elevations (user 2026-10-01): 'forces' = forces only (no hardware rows); 'hardware' = wall + post hardware rows, no forces
  const Lh = computeElevationLayout(lnC, inp.levels, { width: 500, showForces: false, showHW: true, wallHwRows: true });
  const svgH = renderElevationForPdf(lnC, inp.levels, inp.wallDLTypes || [], lo, 500, 'hardware');
  const hwTexts = [...svgH.querySelectorAll('text')].map(t => t.textContent);
  assert.ok(hwTexts.some(t => /(HDUE|MSTC)\d+/.test(t)), "hardware elevation shows wall HD / strap");
  assert.ok(!hwTexts.some(t => /^Σ?▲/.test(t)), 'no forces on the hardware elevation');
  assert.ok(Lh.levelYs.some(l => l.wallHwH > 0));
  const L = computeElevationLayout(lnC, inp.levels, { width: 500, showForces: true, showHW: false });
  const lv2 = L.levelYs[1], lv3 = L.levelYs[2];
  const svg = renderElevationForPdf(lnC, inp.levels, inp.wallDLTypes || [], lo, 500, 'forces');
  const rects = [...svg.querySelectorAll('rect')];
  const beam = rects.find(r => r.getAttribute('fill') === '#7c3aed' && +r.getAttribute('height') === 8);
  assert.ok(beam && near(+beam.getAttribute('y') + 8, lv2.floorY, 0.01), 'beam bottom on the 2nd-story floor line');
  const wallRects = rects.filter(r => r.getAttribute('stroke') === '#1a2233' && r.getAttribute('opacity') === '0.7');
  assert.equal(wallRects.length, 4);
  const bottoms = wallRects.map(r => +r.getAttribute('y') + +r.getAttribute('height'));
  assert.ok(bottoms.some(b => near(b, lv2.floorY - 8, 0.01)), 'SW-11 (on BM-1) ends at the beam top');
  assert.ok(bottoms.some(b => near(b, lv2.floorY - 1, 0.01)), 'SW-15 reaches the floor line');
  assert.ok(bottoms.filter(b => near(b, lv3.floorY - 1, 0.01)).length === 2, '1st-story walls reach the foundation');
  const rTexts = [...svg.querySelectorAll('text')].filter(t => /^R[▲▼]/.test(t.textContent));
  assert.ok(rTexts.length > 0 && rTexts.every(t => +t.getAttribute('y') > lv2.floorY), 'reactions below the beam floor line');

  // Live view: placed labels (halo groups) never overlap
  for (const [fx, name] of [[inp, 'Line C'], [JSON.parse(fs.readFileSync(new URL('./fixtures/legacy/schema5-round2.json', import.meta.url), 'utf8')), 'Line 2']]) {
    const inputs = fx.inputs ? shearWallDesign.migrate({ schemaVersion: fx.schemaVersion, inputs: fx.inputs }).inputs : fx;
    const out = shearWallDesign.calc(inputs);
    const line = inputs.directions.flatMap(d => d.lines).find(l => l.name === name);
    const lineRes = out.perDirection.flatMap(d => d.perLine).find(l => l.lineId === line.id);
    const c = document.createElement('div');
    const h = renderElevation(c, JSON.parse(JSON.stringify(line)), inputs.levels, inputs.wallDLTypes || [], {});
    h.showResults(lineRes);
    const boxes = [...c.querySelectorAll('g')].map(g => [...g.children].filter(e => e.tagName.toLowerCase() === 'text'))
      .filter(ts => ts.length === 2).map(ts => {
        const t = ts[1];
        const attrs = {}; for (const a of t.attributes) attrs[a.name] = isNaN(+a.value) ? a.value : +a.value;
        return { text: t.textContent, ...textBox(attrs, t.textContent) };
      });
    const clash = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) clash.push(a.text + ' × ' + b.text);
    }
    assert.deepEqual(clash, [], name + ' label overlaps');
  }
});

test('Elevation: click nailing / support hardware to override from the quick editor', () => {
  const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/legacy/schema5-round2.json', import.meta.url), 'utf8'));
  const inputs = shearWallDesign.migrate({ schemaVersion: fx.schemaVersion, inputs: fx.inputs }).inputs;
  const line = inputs.directions[0].lines.find(l => l.name === 'Line 2');
  const resFor = () => shearWallDesign.calc(inputs).perDirection[0].perLine.find(l => l.lineId === line.id);
  const c = document.createElement('div');
  // Same wiring as the module: every edit recalculates the preview
  const h = renderElevation(c, line, inputs.levels, inputs.wallDLTypes || [], { onInputChange() { h.showResults(resFor()); } });
  h.showResults(resFor());
  c.querySelector('.elevation-wrapper').getBoundingClientRect = () => ({ left: 0, top: 0 });
  const clickTarget = (sel) => {
    const t = c.querySelector(sel);
    assert.ok(t, 'target ' + sel);
    const ev = new window.Event('click', { bubbles: true }); ev.clientX = 10; ev.clientY = 10;
    t.dispatchEvent(ev);
    const qe = c.querySelector('.quick-edit');
    assert.ok(qe && !qe.hidden, 'editor open for ' + sel);
    return qe;
  };
  const choose = (qe, idx, value) => {
    const sel = qe.querySelectorAll('select')[idx];
    [...sel.querySelectorAll('option')].forEach(o => o.removeAttribute('selected'));
    [...sel.querySelectorAll('option')].find(o => o.getAttribute('value') === value).setAttribute('selected', '');
    sel.dispatchEvent(new window.Event('change'));
  };
  const texts = () => [...c.querySelectorAll('text')].map(t => t.textContent);

  const sw8 = line.walls.find(w => w.mark === 'SW-8');
  let qe = clickTarget('[data-edit="nailing:' + sw8.id + '"]');
  choose(qe, 0, '4');
  assert.equal(sw8.nailingPattern, '4');
  assert.ok(texts().some(t => t === '4" o.c. ✎'), 'nailing shows the override marker');
  qe = c.querySelector('.quick-edit');
  [...qe.querySelectorAll('button')].find(b => b.textContent === 'Reset to auto').dispatchEvent(new window.Event('click'));
  assert.equal(sw8.nailingPattern, '');

  const supTarget = c.querySelector('[data-edit^="support:"]');
  const [, beamId, supId] = supTarget.getAttribute('data-edit').split(':');
  qe = clickTarget('[data-edit="' + supTarget.getAttribute('data-edit') + '"]');
  choose(qe, 0, 'MSTC40');
  const sDef = line.beams.find(b => b.id === beamId).supports.find(s => s.id === supId);
  assert.equal(sDef.anchorageOverride, 'MSTC40');
  assert.ok(texts().some(t => /^\S+: MSTC40✎ [\d.]+$/.test(t)), 'support HW label: owner tag, MSTC40 with the override marker, D/C');
});

test('Elevation: overlapping posts open a chooser; Find selects by ID', () => {
  const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/legacy/schema5-round2.json', import.meta.url), 'utf8'));
  const inputs = shearWallDesign.migrate({ schemaVersion: fx.schemaVersion, inputs: fx.inputs }).inputs;
  const line = inputs.directions[0].lines.find(l => l.name === 'Line 2');
  const lineRes = shearWallDesign.calc(inputs).perDirection[0].perLine.find(l => l.lineId === line.id);
  const c = document.createElement('div');
  const h = renderElevation(c, JSON.parse(JSON.stringify(line)), inputs.levels, inputs.wallDLTypes || [], {});
  h.showResults(lineRes);
  const findSel = () => [...c.querySelectorAll('select')].find(s => (s.getAttribute('title') || '').includes('mark or ID'));
  const selectedText = () => ([...findSel().querySelectorAll('option')].find(o => o.hasAttribute('selected')) || {}).textContent;

  // Find: pick P-8 by ID
  const sel = findSel();
  [...sel.querySelectorAll('option')].forEach(o => o.removeAttribute('selected'));
  [...sel.querySelectorAll('option')].find(o => o.getAttribute('value') === 'post:sp-8').setAttribute('selected', '');
  sel.dispatchEvent(new window.Event('change'));
  assert.ok(selectedText().startsWith('P-8'));

  // Click on the stacked P-1 / P-8 / P-13 → chooser lists all three
  c.querySelector('svg').getBoundingClientRect = () => ({ left: 0, top: 0 });
  c.querySelector('.elevation-wrapper').getBoundingClientRect = () => ({ left: 0, top: 0 });
  const rects = [...c.querySelectorAll('rect')].filter(r => r.getAttribute('fill') === 'transparent' && r.style.cursor === 'pointer');
  const key = r => r.getAttribute('x') + ',' + r.getAttribute('y');
  const counts = {}; rects.forEach(r => { counts[key(r)] = (counts[key(r)] || 0) + 1; });
  const tgt = rects.find(r => counts[key(r)] >= 3);
  const ev = new window.Event('click'); ev.clientX = +tgt.getAttribute('x') + 6; ev.clientY = +tgt.getAttribute('y') + 20;
  tgt.dispatchEvent(ev);
  const chooser = [...c.querySelectorAll('div')].find(d => d.firstChild && /pick one/.test(d.firstChild.textContent || ''));
  assert.ok(chooser && !chooser.hidden, 'chooser shown');
  const names = [...chooser.querySelectorAll('button')].map(b => b.textContent.split(' ')[0]);
  assert.deepEqual(names.sort(), ['P-1', 'P-13', 'P-8']);
  [...chooser.querySelectorAll('button')].find(b => b.textContent.startsWith('P-13')).dispatchEvent(new window.Event('click'));
  assert.ok(chooser.hidden && selectedText().startsWith('P-13'), 'picked P-13');
});

const legacyDir = new URL('./fixtures/legacy/', import.meta.url);
for (const f of fs.readdirSync(legacyDir).filter(n => n.endsWith('.json')).sort()) {
  test('Legacy definition opens: ' + f, () => {
    const fx = JSON.parse(fs.readFileSync(new URL(f, legacyDir), 'utf8'));
    const r = checkShearWallItem({ schemaVersion: fx.schemaVersion, inputs: fx.inputs });
    assert.ok(r.ok, r.error);
    assert.equal(r.migrated.schemaVersion, shearWallDesign.schemaVersion);
    const again = shearWallDesign.migrate(JSON.parse(JSON.stringify(r.migrated)));
    assert.deepEqual(again.inputs, r.migrated.inputs, 'migration is idempotent');
  });
}

test('Module schemaVersion matches the last definition migration', () => {
  const r = shearWallDesign.migrate({ schemaVersion: 1, inputs: null });
  assert.equal(r.schemaVersion, shearWallDesign.schemaVersion);
  assert.ok(r.inputs && r.inputs.directions, 'empty definition gets defaults');
});

test('Stored results from an older calc never break the results view', () => {
  const oldShape = { calcVersion: 'v3', perDirection: [{ dirName: 'N-S', rho: 1, perLine: [{ lineName: 'x', perLevel: [], wallDeliveries: [{ receiver: { type: 'post' } }] }] }] };
  const c = document.createElement('div');
  shearWallDesign.renderOutputs(c, oldShape);
  assert.ok(/older calc version/.test(c.textContent));
});

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
process.exit(process.exitCode || 0);
