// Double holdowns / straps (user 2026-11-09): two of the same HDUE or MSTC at one end, no mixing. ASD and LRFD caps × 2;
// each device takes T / 2 with its own δ @ LRFD cap → Δa = δ_LRFD × T / (2·T_LRFD); minimum post = the single's.
// Auto-select and drift sizing may pick a double (ladder: singles, then the doubles stronger than the largest single).
// Run: node tests/shearWallDouble.test.mjs
import assert from 'assert/strict';
import { checkShearWallItem } from '../scripts/lib/shearWallLoadCheck.mjs'; // sets up the stand-in DOM
import { calcAll, findAnchorage } from '../src/modules/shearWallCalc.js';
import { hdueTable, mstcTable, hdueLadder, mstcLadder, hdueOptions, mstcOptions, doubleOf, anchorageQty, autoSelectHoldown,
  autoSelectStrap, anchorageDelta, anchorageFlex, hdueMinPost } from '../src/modules/shearWallHardware.js';
import { hardwareUsed } from '../src/modules/shearWallHardwareTab.js';
import { hardwareTraceRows } from '../src/modules/shearWallCalcSheet.js';
void checkShearWallItem;

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' ± ' + tol + ', got ' + a);
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message)); process.exitCode = 1; }
}

const W = (id, pos, len, more = {}) => ({ id, mark: 'SW-' + id.split('-')[1], levelId: 'lvl-1', position: pos, length: len, wallDLTypeId: '', nailingPattern: '',
  anchorageLeftOverride: '', anchorageRightOverride: '', postLeftOverride: '', postRightOverride: '', openings: [], method: 'segmented',
  narrowPier: false, ftaoStrapOverride: '', jambPostOverride: '', systemType: 'sheathed', ...more });
const oneStory = (walls, seismic, cd = '4') => ({ sds: '1.0', loadType: 'seismic', wallThickness: '4', species: 'DF-L', woodGrade: 'dfir_no1', postGrade: 'dfir_pt_no1',
  wallDLTypes: [], sheathing: 'ply', cd, ie: '1', riskCategory: 'II', driftRow: 'other', alphaS: '', refs: {},
  levels: [{ id: 'lvl-1', name: 'L1', floorToFloor: 10, floorClearSpan: '16', anchorageType: 'auto' }],
  directions: [{ id: 'dir-1', name: 'N-S', rho: 1, lines: [{ id: 'ln-1', name: 'A', totalLength: 40, wallThickness: '', levelLoads: { 'lvl-1': { seismic: String(seismic) } },
    walls, beams: [], supportPosts: [], gravityLoads: {} }] }] });
const lineOf = (out) => out.perDirection[0].perLine[0];
const wallOf = (out) => lineOf(out).perLevel[0].walls[0];

test('A double = two of the same device: caps × 2, δ @ LRFD cap and minimum post of the single, id "(2)…"', () => {
  for (const [t, singles] of [['HDUE 4"', hdueTable('dfsp', '4')], ['HDUE 6" SPF/HF', hdueTable('spfhf', '6')], ['MSTC 16"', mstcTable('dfsp', '16')]]) {
    for (const s of singles) {
      const d = doubleOf(s);
      assert.equal(d.id, '(2)' + s.id, t);
      assert.equal(d.cap, 2 * s.cap); assert.equal(d.lrfdCap, 2 * s.lrfdCap);
      assert.equal(d.deltaLrfd, s.deltaLrfd); assert.deepEqual(d.minPost, s.minPost);
      assert.equal(anchorageQty(d), 2); assert.equal(anchorageQty(s), 1);
      assert.equal(s.qty, undefined, 'singles unchanged (stored results of existing items stay identical)');
      assert.equal(doubleOf(s), d, 'stable identity');
      // Δa at the same T is half the single's (each device T / 2)
      near(anchorageDelta(d, 6000), anchorageDelta(s, 6000) / 2, 1e-12, d.id + ' Δa');
      near(anchorageFlex(d), anchorageFlex(s) / 2, 1e-15);
      assert.deepEqual(hdueMinPost(d, '4'), hdueMinPost(s, '4'));
    }
  }
});

test('Ladder: singles, then only the doubles stronger than the largest single, by capacity; options: every double', () => {
  for (const [singles, ladder, options] of [[hdueTable('dfsp', '4'), hdueLadder('dfsp', '4'), hdueOptions('dfsp', '4')],
    [mstcTable('dfsp', '24'), mstcLadder('dfsp', '24'), mstcOptions('dfsp', '24')]]) {
    const top = Math.max(...singles.map(a => a.cap));
    assert.deepEqual(ladder.slice(0, singles.length), singles);
    const dbl = ladder.slice(singles.length);
    assert.ok(dbl.length > 0 && dbl.every(d => d.qty === 2 && d.cap > top));
    for (let i = 1; i < dbl.length; i++) assert.ok(dbl[i].cap >= dbl[i - 1].cap);
    assert.equal(options.length, 2 * singles.length);
    assert.deepEqual(options.slice(singles.length).map(d => d.id), singles.map(s => '(2)' + s.id));
  }
  assert.deepEqual(hdueLadder('dfsp', '4').map(a => a.id), ['HDUE3', 'HDUE5', 'HDUE7', 'HDUE9', 'HDUE13', 'HDUE17', '(2)HDUE9', '(2)HDUE13', '(2)HDUE17']);
});

test('Auto-select: a single while one is enough; past the largest single the lightest double; past every double OVER', () => {
  const top = hdueTable('dfsp', '4').at(-1); // HDUE17 16,040 lb
  assert.equal(autoSelectHoldown(top.cap / 1000, 'dfsp', '4').id, 'HDUE17');
  assert.equal(autoSelectHoldown((top.cap + 1) / 1000, 'dfsp', '4').id, '(2)HDUE9');
  assert.equal(autoSelectHoldown(2 * top.cap / 1000, 'dfsp', '4').id, '(2)HDUE17');
  assert.equal(autoSelectHoldown((2 * top.cap + 1) / 1000, 'dfsp', '4'), null);
  const s = mstcTable('dfsp', '16'), sTop = s.at(-1);
  assert.equal(autoSelectStrap((sTop.cap + 1) / 1000, '16', 'dfsp').qty, 2);
});

test('Override "(2)HDUE5": found, D/C on 2 × cap, Δ_HD half of HDUE5 at the same T, same minimum post', () => {
  const ov = (id) => wallOf(calcAll(oneStory([W('w-1', 0, 8, { nailingPattern: '2', anchorageLeftOverride: id, anchorageRightOverride: id })], 6)));
  const one = ov('HDUE5'), two = ov('(2)HDUE5');
  assert.equal(findAnchorage('(2)HDUE5', '16', 'dfsp', '4').cap, 2 * findAnchorage('HDUE5', '16', 'dfsp', '4').cap);
  assert.equal(findAnchorage('(2)MSTC40', '24', 'dfsp', '4').id, '(2)MSTC40');
  assert.equal(two.anchorageLeft.id, '(2)HDUE5');
  near(two.governingTensionLeft, one.governingTensionLeft, 1e-9, 'T does not depend on the device');
  near(two.anchorageDCLeft, one.anchorageDCLeft / 2, 0.006, 'D/C');
  assert.equal(two.postLeft.postId, one.postLeft.postId);
  const dHD = (w) => Math.max(...w.deflection.E.dirs.map(d => d.dHD));
  near(dHD(two), dHD(one) / 2, 1e-4, 'Δ_HD');
  assert.ok(two.deflection.E.delta < one.deflection.E.delta);
  // calc sheet: the cap as 2 × single, the device named
  const rows = hardwareTraceRows(two, { floorSpan: '16', lineThickness: '4', wallIn: { anchorageLeftOverride: '(2)HDUE5', anchorageRightOverride: '(2)HDUE5' } });
  const a = rows.find(r => r[0] === 'Anchorage Left')[1];
  assert.ok(/\(2\)HDUE5/.test(a) && /2 × 5375 = 10750 lb \(two HDUE5, same model\)/.test(a), a);
});

test('Auto: a wall past the largest single gets the lightest double; the Hardware tab lists the single row', () => {
  // 4 ft wall, 10 ft high, 11 k: T ≈ 0.7 × 11 × 10 / 4 ≈ 19 k > HDUE17 16.04 k
  const inputs = oneStory([W('w-1', 0, 4, { nailingPattern: '2' })], 11);
  const w = wallOf(calcAll(inputs));
  assert.ok(w.governingTensionLeft * 1000 > hdueTable('dfsp', '4').at(-1).cap, String(w.governingTensionLeft));
  assert.equal(w.anchorageLeft.qty, 2);
  assert.equal(w.anchorageBasis.left.basis, 'strength');
  const used = hardwareUsed(inputs, calcAll(inputs));
  assert.ok(used.hdue['4'].has(w.anchorageLeft.singleId) && !used.hdue['4'].has(w.anchorageLeft.id));
});

test('Drift sizing continues past the largest single: HDUE17 → (2)HDUE13 → (2)HDUE17 (stiffer steps only)', () => {
  const out = calcAll(oneStory([W('w-1', 0, 6, { nailingPattern: '2' })], 5, '6'));
  const log = lineOf(out).driftSizing.log.map(l => l.detail);
  assert.deepEqual(log.slice(-2), ['SW-1 L HDUE17 / R HDUE17 → (2)HDUE13', 'SW-1 L (2)HDUE13 / R (2)HDUE13 → (2)HDUE17'], JSON.stringify(log));
  const w = wallOf(out);
  assert.equal(w.anchorageLeft.id, '(2)HDUE17');
  assert.equal(w.anchorageBasis.left.basis, 'drift');
});

console.log(passed + ' passed');
