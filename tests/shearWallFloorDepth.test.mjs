// Floor plate depth in the overturning height (user 2026-11-10, SWD item 1; calc v26).
// Reference: Shearwall design reference/Shearwall Deisgn Elevation Reference.pdf (T1–T6) and the Simpson SSWH two-story
// example (C-L-SW26 p. 29): 2nd story 8 ft, 12" floor, 1st story 9 ft, M_base = 1.5 × (8 + 1 + 9) + 2.0 × 9 = 45 k·ft.
// Rules: overturning (hardware, chords, forces carried down) uses FTF + the floor plate depth below the wall; the wall
// height FTF stays for h/b and deflection. level.floorPlateDepth = floor at the TOP of that story (top level none);
// inputs.groundDepth = 1st FF to TOC. Blank = 0 = results as before. Strap table = smallest MSTC clear span ≥ depth.
// Run: node tests/shearWallFloorDepth.test.mjs
import assert from 'assert/strict';
import { checkShearWallItem } from '../scripts/lib/shearWallLoadCheck.mjs'; // sets up the stand-in DOM
import { calcAll } from '../src/modules/shearWallCalc.js';
import { floorDepthBelowIn, strapSpanInfo } from '../src/modules/shearWallHardware.js';
import { wallDefinitionRows } from '../src/modules/shearWallCalcSheet.js';
void checkShearWallItem;

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' ± ' + tol + ', got ' + a);
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message)); process.exitCode = 1; }
}

const W = (id, lv, pos, len) => ({ id, mark: id, levelId: lv, position: pos, length: len, wallDLTypeId: '', nailingPattern: '',
  anchorageLeftOverride: '', anchorageRightOverride: '', postLeftOverride: '', postRightOverride: '', openings: [], method: 'segmented', systemType: 'sheathed' });
const P = (id, lv, pos) => ({ id, mark: id, levelId: lv, position: pos, anchorageOverride: '', postOverride: '' });
// F_roof = 1.5 k, F_2nd = 2.0 k (1.0W, no gravity); Roof story FTF 8 ft, 2nd Floor story FTF 9 ft; b = 4 ft
function model({ depth = '12', ground = undefined, offset = false } = {}) {
  const lvl2 = { id: 'f2', name: '2nd Floor', floorToFloor: 9, floorClearSpan: '16', anchorageType: 'auto' };
  if (depth !== 'absent') lvl2.floorPlateDepth = depth; // 'absent' = an item saved before the field existed
  const inputs = { sds: '', loadType: 'wind', wallThickness: '4', species: 'DF-L', woodGrade: 'dfir_no1', postGrade: 'dfir_pt_no1', wallDLTypes: [],
    sheathing: 'ply', alphaS: '1.0', refs: {},
    levels: [{ id: 'r', name: 'Roof', floorToFloor: 8, floorClearSpan: '16', anchorageType: 'auto' }, lvl2],
    directions: [{ id: 'd', name: 'N-S', rho: 1, lines: [{ id: 'l', name: 'A', totalLength: 20, wallThickness: '', levelLoads: { r: { wind: '1.5' }, f2: { wind: '2.0' } },
      walls: offset ? [W('U', 'r', 0, 4), W('B', 'f2', 6, 4)] : [W('U', 'r', 0, 4), W('B', 'f2', 0, 4)],
      beams: [], supportPosts: offset ? [P('P-1', 'f2', 0), P('P-2', 'f2', 4)] : [], gravityLoads: {} }] }] };
  if (ground !== undefined) inputs.groundDepth = ground;
  return inputs;
}
const lineOf = (inputs) => calcAll(inputs).perDirection[0].perLine[0];
const wall = (ln, mark) => ln.perLevel.flatMap(pl => pl.walls).find(w => w.mark === mark);
const T = (w) => ((w.accumPerCombo || w.combos)['1.0W']); // 1.0W end forces incl. loads from above
const notPassing = (ln) => ln.checks.filter(c => c.status === 'fail').map(c => c.id);

test('Page 2 (aligned): T2 = 3.375 k at the floor-to-floor strap, T4 = 11.25 k at TOC; base M = 45 k·ft (Simpson); ΣFx, ΣFy, ΣM = 0', () => {
  const ln = lineOf(model());
  const U = wall(ln, 'U'), B = wall(ln, 'B');
  // T1 (2nd FF, wall height only) — the reference value, not a tool output
  near(1.5 * 8 / 4, 3.0, 1e-12, 'T1');
  assert.equal(U.otmH, 9); assert.equal(U.floorDepthBelow, 1); assert.equal(U.floorH, 8);
  near(T(U).tensionLeft, 3.375, 1e-9, 'T2'); near(T(U).comprRight, 3.375, 1e-9, 'C2');
  assert.equal(B.otmH, undefined, 'ground blank: bottom story height = FTF');
  near(B.combos['1.0W'].tensionLeft, 3.5 * 9 / 4, 1e-9, 'own 7.875');
  near(T(B).tensionLeft, 11.25, 1e-9, 'T3 = T4'); near(T(B).comprRight, 11.25, 1e-9);
  // statics of the whole line (lateral only): ΣFx = 1.5 + 2.0 − base shear; ΣFy = T − C; ΣM about TOC
  const baseV = ln.perLevel.find(p => p.levelId === 'f2').storyShear_1W;
  near(1.5 + 2.0 - baseV, 0, 1e-9, 'ΣFx');
  near(T(B).tensionLeft - T(B).comprRight, 0, 1e-9, 'ΣFy');
  near(1.5 * (8 + 1 + 9) + 2.0 * 9 - T(B).tensionLeft * 4, 0, 1e-9, 'ΣM');
  // cuts: at the strap (ΣM = 1.5 × 9 − T2 × 4), at 1st FF
  near(1.5 * 9 - T(U).tensionLeft * 4, 0, 1e-9, 'ΣM cut at 1st top plate');
  const g9 = ln.checks.find(c => c.id === 'G9').rows[0];
  near(g9.expected, 45, 1e-9); near(g9.actual, 45, 1e-9);
  assert.deepEqual(notPassing(ln), []);
  // the strap is sized for T2 (3.375 k), the holdown for T4
  // ASD design at 0.6W: strap for 0.6 × T2 = 2.025 k, holdown for 0.6 × T4 = 6.75 k
  near(U.hwDemand ? U.hwDemand.tL : U.governingTensionLeft, 0.6 * 3.375, 1e-9, 'strap ASD T');
  near(B.hwDemand.tL, 0.6 * 11.25, 1e-9, 'holdown ASD T');
  assert.ok(U.anchorageType === 'strap' && U.anchorageLeft.cap >= 2025);
  assert.ok(B.anchorageType === 'holdown' && B.anchorageLeft.cap >= 6750);
});

test('Wall height stays FTF: h/b = 8 / 4, deflection h = 8 ft, calc sheet shows h + d_fl', () => {
  const ln = lineOf(model());
  const U = wall(ln, 'U');
  assert.equal(U.hOverB, 2);
  const d = U.deflection && (U.deflection.W || U.deflection.E);
  assert.ok(d, 'deflection computed');
  assert.equal(d.h, 8);
  near(d.T, 3375, 1, 'Δa uses the T with the floor depth (lb)');
  const rows = wallDefinitionRows(U, {});
  assert.ok(rows.some(r => r[0] === 'Overturning height' && /8\.00 \+ 1\.00 = 9\.00/.test(r[1])));
});

test('Page 3 (upper wall on posts, F_transfer to an offset wall): post T = 3.375 k constant to TOC, T5 = 7.875 k; ΣFx, ΣFy, ΣM = 0', () => {
  const ln = lineOf(model({ offset: true }));
  const U = wall(ln, 'U'), B = wall(ln, 'B');
  near(T(U).tensionLeft, 3.375, 1e-9, 'T2');
  const p1 = ln.postPaths.find(p => p.mark === 'P-1'), p2 = ln.postPaths.find(p => p.mark === 'P-2');
  near(p1.perCombo['1.0W'], -3.375, 1e-9, 'P-1 uplift = T2 (no shear in the posts)');
  near(p2.perCombo['1.0W'], 3.375, 1e-9, 'P-2 compression');
  near(T(B).tensionLeft, 7.875, 1e-9, 'T5 = T6');
  near(1.5 + 2.0 - ln.perLevel.find(p => p.levelId === 'f2').storyShear_1W, 0, 1e-9, 'ΣFx');
  near(p1.perCombo['1.0W'] + p2.perCombo['1.0W'] - T(B).tensionLeft + T(B).comprRight, 0, 1e-9, 'ΣFy');
  near(1.5 * 18 + 2.0 * 9 - (3.375 * 4 + T(B).tensionLeft * 4), 0, 1e-9, 'ΣM about TOC');
  near(1.5 * 9 - 3.375 * 4, 0, 1e-12, 'ΣM upper wall + posts about the transfer level');
  near(3.5 * 9 - T(B).tensionLeft * 4, 0, 1e-9, 'ΣM lower wall');
  assert.deepEqual(notPassing(ln), []);
});

test('Ground (1st FF to TOC) 12": bottom story height 9 + 1; T4 = 12.125 k, T6 = 8.75 k; base M 48.5 k·ft', () => {
  const ln = lineOf(model({ ground: '12' }));
  const B = wall(ln, 'B');
  assert.equal(B.otmH, 10);
  near(T(B).tensionLeft, 12.125, 1e-9, 'T4');
  near(1.5 * 19 + 2.0 * 10 - T(B).tensionLeft * 4, 0, 1e-9, 'ΣM');
  near(ln.checks.find(c => c.id === 'G9').rows[0].expected, 48.5, 1e-9);
  assert.equal(B.hOverB, 2.25, 'h/b still on FTF 9');
  const ln3 = lineOf(model({ ground: '12', offset: true }));
  near(T(wall(ln3, 'B')).tensionLeft, 8.75, 1e-9, 'T6');
  near(ln3.postPaths.find(p => p.mark === 'P-1').perCombo['1.0W'], -3.375, 1e-9, 'posts unchanged');
  near(1.5 * 19 + 2.0 * 10 - (3.375 * 4 + 8.75 * 4), 0, 1e-9, 'ΣM about TOC');
  assert.deepEqual(notPassing(ln3), []);
});

test('Strap table from the depth: 12" → 16", 17" → 18", 24" → 24", 25" → 24" + warning; blank → stored floor span', () => {
  const lv = (d, span = '16') => [{ id: 'a', floorClearSpan: span }, { id: 'b', floorPlateDepth: d }];
  assert.deepEqual(strapSpanInfo(lv('12'), 'a'), { span: '16', depth: 12, over: false });
  assert.equal(strapSpanInfo(lv('17'), 'a').span, '18');
  assert.equal(strapSpanInfo(lv('24'), 'a').span, '24');
  assert.deepEqual(strapSpanInfo(lv('25'), 'a'), { span: '24', depth: 25, over: true });
  assert.equal(strapSpanInfo(lv('', '18'), 'a').span, '18');
  assert.equal(strapSpanInfo(lv(undefined), 'a').span, '16');
  assert.equal(strapSpanInfo(lv('12'), 'b').depth, 0, 'bottom story: holdown, no strap table');
  assert.equal(floorDepthBelowIn(lv('12'), 'a', '6'), 12);
  assert.equal(floorDepthBelowIn(lv('12'), 'b', '6'), 6);
  assert.equal(floorDepthBelowIn(lv('12'), 'b', ''), 0);
  const ln = lineOf(model({ depth: '17' }));
  assert.equal(wall(ln, 'U').anchorageLeft.span, '18');
  const over = lineOf(model({ depth: '25' }));
  assert.ok(over.loadPathAudit.warnings.some(w => w.type === 'floor_depth' && /25" .* 24"/.test(w.message)));
});

test('Blank depth = results identical to an item saved before the field existed', () => {
  const strip = (x) => JSON.stringify(x);
  const before = calcAll(model({ depth: 'absent' }));
  assert.equal(strip(calcAll(model({ depth: '' }))), strip(before));
  assert.equal(strip(calcAll(model({ depth: '0', ground: '' }))), strip(before));
  assert.equal(wall(before.perDirection[0].perLine[0], 'U').otmH, undefined);
  near(T(wall(before.perDirection[0].perLine[0], 'B')).tensionLeft, 10.875, 1e-9, 'today: 1.5 × 8 / 4 + 3.5 × 9 / 4');
});

console.log(passed + ' passed');
