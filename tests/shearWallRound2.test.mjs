// Shear Wall Phase 4 round 2: P9 HDUE minimum post, Ω₀ combos (forces only), dead load by statics, WSWH.
// Run: node tests/shearWallRound2.test.mjs
import assert from 'assert/strict';
import { calcAll } from '../src/modules/shearWallCalc.js';
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

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
