// Shear Wall drift sizing: at each failing story the step that cuts the governing wall's δ more (Eq. 4.3-1 terms) is
// applied — the story's common nailing step or that wall's holdown / strap one size up (user rule 2026-09-30) — until
// the story drift passes (check on). Each wall reports what governs its sheathing and anchorage (strength / drift /
// manual), and the drift check can be bypassed (report only) for the project or per line. Schema v9, calc v13.
// Run: node tests/shearWallDrift.test.mjs
import fs from 'fs';
import assert from 'assert/strict';
import '../scripts/lib/shearWallLoadCheck.mjs'; // sets up the stand-in DOM
import { calcAll, lineDriftMode, anchorageWithFloor } from '../src/modules/shearWallCalc.js';
import { HDUE_TABLE, MSTC_TABLE, anchorageFlex } from '../src/modules/shearWallHardware.js';
import { shearWallDesign, renderLineResults, migrateV8toV9, sheathingGovernsText } from '../src/modules/shearWallDesign.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message)); process.exitCode = 1; }
}
const W = (id, lvl, pos, len, more = {}) => ({ id, mark: id, levelId: lvl, position: pos, length: len, wallDLTypeId: '', nailingPattern: '',
  anchorageLeftOverride: '', anchorageRightOverride: '', postLeftOverride: '', postRightOverride: '', openings: [], method: 'segmented',
  narrowPier: false, ftaoStrapOverride: '', jambPostOverride: '', systemType: 'sheathed', ...more });
// The user's E-W test in TC-1: SW-5 (4 ft, Roof 9 ft) over SW-6 (8 ft, Level 1 10 ft), 1.0E 2 k + 3 k, Cd 5, Ie 1, RC II
const ew = ({ nail = '', bypass = false, lineMode = '', cd = '5' } = {}) => ({
  sds: '1.0', loadType: 'seismic', wallThickness: '4', woodGrade: 'dfir_no1', wallDLTypes: [], sheathing: 'ply', refs: {},
  cd, ie: '1', riskCategory: 'II', driftRow: 'other', alphaS: '', distribution: 'deflection', driftBypass: bypass,
  levels: [{ id: 'lvl-1', name: 'Roof', floorToFloor: 9, floorClearSpan: '16', anchorageType: 'auto' }, { id: 'lvl-2', name: 'Level 1', floorToFloor: 10, floorClearSpan: '16', anchorageType: 'auto' }],
  directions: [{ id: 'dir-2', name: 'E-W', rho: 1, lines: [{ id: 'ln-2', name: 'Line 1', totalLength: 60, wallThickness: '', distribution: '', driftBypass: lineMode,
    levelLoads: { 'lvl-1': { seismic: '2' }, 'lvl-2': { seismic: '3' } },
    walls: [W('SW-5', 'lvl-1', 16.5, 4, { nailingPattern: nail }), W('SW-6', 'lvl-2', 16.5, 8, { nailingPattern: nail })],
    beams: [], supportPosts: [], gravityLoads: {} }] }],
});
const lineOf = (out) => out.perDirection[0].perLine[0];
const wallsOf = (ln) => ln.perLevel.flatMap(p => p.walls);
const driftStatus = (ln) => ln.drift.rows.map(r => r.seismic.pass);

test('Strength alone (bypass): 4" o.c. at both walls, drift NG at both stories — the case the user found', () => {
  const ln = lineOf(calcAll(ew({ bypass: true })));
  assert.deepEqual(wallsOf(ln).map(w => w.nailing.id), ['4', '4']);
  assert.deepEqual(wallsOf(ln).map(w => w.nailingBasis), ['strength', 'strength']);
  assert.deepEqual(driftStatus(ln), [false, false]);
});

test('Drift check on: nailing or holdowns / straps are raised until both stories pass; raised parts say "drift"', () => {
  const ln = lineOf(calcAll(ew()));
  assert.deepEqual(driftStatus(ln), [true, true]);
  for (const w of wallsOf(ln)) {
    const raised = w.nailingBasis === 'drift' || w.anchorageBasis.left.basis === 'drift' || w.anchorageBasis.right.basis === 'drift';
    assert.ok(raised, w.mark + ' has something raised for drift');
    if (w.nailingBasis === 'drift') assert.ok(sheathingGovernsText(w).startsWith('Drift (strength: 4" o.c.)'));
  }
  assert.equal(ln.driftSizing.mode, 'check');
  assert.ok(ln.driftSizing.steps > 0 && ln.driftSizing.ngLevels.length === 0);
  assert.deepEqual(ln.checks.filter(c => c.status === 'fail').map(c => c.id), [], 'equilibrium checks still pass');
});

test('Anchorage raised for drift: strength pick kept for reference; floor never lowers a strength pick; OVER stays OVER', () => {
  // manual nailing: only the holdown / strap can move (Δa = δ_LRFD × T / T_LRFD — only a stiffer size, lower δ_LRFD / T_LRFD, helps)
  const ln = lineOf(calcAll(ew({ nail: '4' })));
  const sw6 = wallsOf(ln).find(w => w.mark === 'SW-6');
  assert.equal(sw6.anchorageBasis.left.basis, 'drift');
  const idx = (id) => HDUE_TABLE.findIndex(h => h.id === id);
  assert.ok(idx(sw6.anchorageLeft.id) > idx(sw6.anchorageBasis.left.strength), 'raised above the strength pick');
  const hw = (id) => [...HDUE_TABLE, ...MSTC_TABLE['16']].find(h => h.id === id);
  for (const l of ln.driftSizing.log) {
    const ids = l.detail.match(/(HDUE|MSTC)\d+/g), to = ids.at(-1);
    assert.ok(anchorageFlex(hw(to)) < Math.max(...ids.slice(0, -1).map(id => anchorageFlex(hw(id)))), 'each step is stiffer (δ_LRFD / T_LRFD): ' + l.detail);
  }
  assert.equal(anchorageWithFloor(HDUE_TABLE[4], HDUE_TABLE, 1).id, HDUE_TABLE[4].id);
  assert.equal(anchorageWithFloor(HDUE_TABLE[0], HDUE_TABLE, 2).id, HDUE_TABLE[2].id);
  assert.equal(anchorageWithFloor(null, HDUE_TABLE, 2), null);
  const c = document.createElement('div');
  renderLineResults(c, ln, calcAll(ew({ nail: '4' })).perDirection[0], { tab: 'drift', onTab() {}, report: 'summary', onReport() {} });
  assert.ok(c.textContent.includes('Drift sizing steps') && c.textContent.includes('Δδ HD / strap'));
});

test('Anchorage overrides are never changed by drift sizing; with nothing left the story stays NG', () => {
  const inp = ew({ nail: '4' });
  inp.directions[0].lines[0].walls.forEach(w => { w.anchorageLeftOverride = w.levelId === 'lvl-1' ? 'MSTC52' : 'HDUE9'; w.anchorageRightOverride = w.anchorageLeftOverride; });
  const ln = lineOf(calcAll(inp));
  assert.deepEqual(wallsOf(ln).map(w => [w.anchorageLeft.id, w.anchorageBasis.left.basis]), [['MSTC52', 'manual'], ['HDUE9', 'manual']]);
  assert.equal(ln.driftSizing.steps, 0);
  assert.ok(ln.driftSizing.ngLevels.length > 0 && /nothing left to upsize/.test(ln.driftSizing.note));
});

test('MSTC floor strap ends get at least a (2)2x post (user rule 2026-09-30)', () => {
  const ln = lineOf(calcAll(ew({ bypass: true })));
  const sw5 = wallsOf(ln).find(w => w.mark === 'SW-5');
  assert.equal(sw5.anchorageLeft.id.slice(0, 4), 'MSTC');
  assert.equal(sw5.postLeft.postId, '(2)2x4'); assert.equal(sw5.postRight.postId, '(2)2x4');
});

test('Each drift step raises one pattern at a time: the result is the lightest nailing that passes drift', () => {
  const ln = lineOf(calcAll(ew()));
  const order = ['6', '4', '3', '2', '4B', '3B', '2B'];
  for (const w of wallsOf(ln)) {
    const i = order.indexOf(w.nailing.id);
    // one pattern lighter on this wall alone (the other kept) must fail drift at its story
    const other = wallsOf(ln).find(x => x.mark !== w.mark);
    const trial = ew();
    trial.directions[0].lines[0].walls.forEach(x => { x.nailingPattern = x.id === w.mark ? order[i - 1] : other.nailing.id; });
    trial.driftBypass = true;
    const tl = lineOf(calcAll(trial));
    const lvl = w.mark === 'SW-5' ? 0 : 1;
    assert.equal(tl.drift.rows[lvl].seismic.pass, false, w.mark + ' one lighter (' + order[i - 1] + ') fails drift');
  }
});

// Two unequal walls per story (strength alone gives different nailing): drift sizing must end with one common
// pattern per story, and that pattern one lighter for all walls of the story must fail drift.
const pair = ({ bypass = false, manual = '' } = {}) => {
  const inp = ew({ bypass });
  const ln = inp.directions[0].lines[0];
  ln.walls = [W('A1', 'lvl-1', 0, 4), W('A2', 'lvl-1', 20, 8, { nailingPattern: manual }), W('B1', 'lvl-2', 0, 6), W('B2', 'lvl-2', 20, 10)];
  ln.levelLoads = { 'lvl-1': { seismic: '6.5' }, 'lvl-2': { seismic: '8' } }; // 6.5 k: the Roof fails drift at strength (calc v13)
  inp.distribution = 'deflection'; // the stiffer wall takes more shear → strength gives different nailing
  return inp;
};
test('Drift rule: when nailing is stepped at a story, all its auto walls get one common pattern (user rule 2026-09-29)', () => {
  const order = ['6', '4', '3', '2', '4B', '3B', '2B'];
  const base = lineOf(calcAll(pair({ bypass: true })));
  assert.deepEqual(driftStatus(base), [false, false], 'the strength design fails drift at both stories');
  for (const pl of base.perLevel) assert.equal(new Set(pl.walls.map(w => w.nailing.id)).size, 2, pl.levelName + ' strength nailing differs');
  const ln = lineOf(calcAll(pair()));
  assert.deepEqual(driftStatus(ln), [true, true]);
  for (const pl of ln.perLevel) {
    const ids = pl.walls.map(w => w.nailing.id);
    const failedBefore = base.drift.rows.find(r => r.levelId === pl.levelId).seismic.pass === false;
    const nailed = ln.driftSizing.log.some(l => l.levelName === pl.levelName && l.action === 'nailing');
    if (!failedBefore || !nailed) continue; // a story fixed by holdowns alone keeps its strength nailing
    assert.equal(new Set(ids).size, 1, pl.levelName + ' walls share one pattern: ' + ids.join(', '));
    // one pattern lighter for every wall of the story → drift fails there
    const i = order.indexOf(ids[0]);
    const trial = pair({ bypass: true });
    trial.directions[0].lines[0].walls.forEach(x => {
      const w = wallsOf(ln).find(y => y.wallId === x.id);
      x.nailingPattern = x.levelId === pl.levelId ? order[Math.max(0, i - 1)] : w.nailing.id;
    });
    if (i > 0) assert.equal(lineOf(calcAll(trial)).drift.rows.find(r => r.levelId === pl.levelId).seismic.pass, false, pl.levelName + ' one lighter fails');
  }
});

test('Each drift step applies the larger estimated Δδ of the governing wall (nailing vs holdown / strap)', () => {
  for (const inp of [ew(), pair(), ew({ nail: '4' })]) {
    const log = lineOf(calcAll(inp)).driftSizing.log;
    assert.ok(log.length > 0);
    for (const l of log) {
      const want = l.saveAnchorage != null && (l.saveNailing == null || l.saveAnchorage > l.saveNailing) ? 'anchorage' : 'nailing';
      assert.equal(l.action, want, l.levelName + ' ' + l.mark + ': nail ' + l.saveNailing + ' vs anc ' + l.saveAnchorage);
    }
  }
});

test('Drift rule: a manual wall keeps its nailing; the auto walls of that story still share one pattern', () => {
  const ln = lineOf(calcAll(pair({ manual: '6' })));
  const a2 = wallsOf(ln).find(w => w.wallId === 'A2');
  assert.deepEqual([a2.nailing.id, a2.nailingBasis], ['6', 'manual']);
  const autos = ln.perLevel.map(pl => pl.walls.filter(w => w.nailingBasis !== 'manual').map(w => w.nailing.id));
  for (const ids of autos) assert.ok(new Set(ids).size <= 1, ids.join(', '));
});

test('Manual nailing is never changed by drift sizing; the auto holdowns / straps are raised instead', () => {
  const ln = lineOf(calcAll(ew({ nail: '4' })));
  assert.deepEqual(wallsOf(ln).map(w => [w.nailing.id, w.nailingBasis]), [['4', 'manual'], ['4', 'manual']]);
  assert.ok(ln.driftSizing.log.every(l => l.action === 'anchorage' && l.saveNailing == null));
  // Δa = δ_LRFD × T / T_LRFD (2026-10-14): HDUE17 brings Level 1 within the limit; the Roof (MSTC66, the stiffest strap) stays NG
  assert.deepEqual(driftStatus(ln), [false, true], 'with manual nailing the Roof stays NG');
  assert.equal(wallsOf(ln).find(w => w.mark === 'SW-6').anchorageLeft.id, 'HDUE17');
  assert.ok(/Drift still NG at Roof/.test(ln.driftSizing.note));
});

test('Bypass: project default and per-line override; bypassed drift NG does not fail the line', () => {
  assert.equal(lineDriftMode({ driftBypass: true }, { driftBypass: '' }), 'bypass');
  assert.equal(lineDriftMode({ driftBypass: true }, { driftBypass: 'check' }), 'check');
  assert.equal(lineDriftMode({ driftBypass: false }, { driftBypass: 'bypass' }), 'bypass');
  assert.equal(lineDriftMode({}, {}), 'check');
  const sized = lineOf(calcAll(ew({ bypass: true, lineMode: 'check' })));
  assert.equal(sized.driftSizing.mode, 'check'); assert.deepEqual(driftStatus(sized), [true, true]);
  const out = calcAll(ew({ lineMode: 'bypass' })), ln = lineOf(out);
  assert.equal(ln.driftSizing.mode, 'bypass'); assert.deepEqual(driftStatus(ln), [false, false]);
  const c = document.createElement('div');
  renderLineResults(c, ln, out.perDirection[0], { tab: 'drift', onTab() {}, report: 'summary', onReport() {} });
  const t = c.textContent;
  assert.ok(t.includes('Drift check: bypassed.') && t.includes('NG (bypassed)'));
  assert.ok(t.includes('drift NG (bypassed, report only)') && !t.includes('— drift NG —'), 'line not NG for bypassed drift');
});

test('No Cd / Ie: drift is not checked, nothing is raised', () => {
  const ln = lineOf(calcAll(ew({ cd: '' })));
  assert.equal(ln.driftSizing.steps, 0);
  assert.deepEqual(wallsOf(ln).map(w => w.nailingBasis), ['strength', 'strength']);
});

test('Walls summary shows "Sheathing governed by"; the calc sheet explains it (definition + nailing trace)', () => {
  const inp = ew(), out = calcAll(inp), ln = lineOf(out);
  const text = (report) => { const c = document.createElement('div');
    renderLineResults(c, ln, out.perDirection[0], { tab: 'walls', onTab() {}, report, onReport() {}, detail: { mark: 'SW-5' }, defs: { inputs: inp, line: inp.directions[0].lines[0] } });
    return c.textContent; };
  const sum = text('summary');
  assert.ok(sum.includes('Sheathing governed by') && sum.includes('Drift (strength: 4" o.c.)'));
  const det = text('detailed');
  assert.ok(det.includes('SW-5 ·drift'), 'mark tab flags the drift-governed wall');
  assert.ok(det.includes('auto — governed by drift (strength: 4" o.c.)'));
  assert.ok(det.includes('OK — lightest for strength') && det.includes('raised for drift'), 'nailing trace shows the strength pick and the drift steps');
});

test('Schema v9: v8 → v9 adds the drift bypass settings (idempotent); form shows the checkbox and line select', () => {
  const inp = { directions: [{ lines: [{}] }] };
  migrateV8toV9(inp); migrateV8toV9(inp);
  assert.equal(inp.driftBypass, false); assert.equal(inp.directions[0].lines[0].driftBypass, '');
  const saved = JSON.parse(fs.readFileSync(new URL('./fixtures/legacy/schema8-verification.json', import.meta.url), 'utf8'));
  const mig = shearWallDesign.migrate(saved);
  assert.equal(mig.schemaVersion, shearWallDesign.schemaVersion); assert.equal(mig.inputs.driftBypass, false);
  const form = document.createElement('div');
  shearWallDesign.renderForm(form, mig.inputs, () => {}, [], () => {});
  assert.ok(form.textContent.includes('Bypass the drift check'));
  const ewBtn = [...form.querySelectorAll('button')].find(b => b.textContent === 'E-W');
  ewBtn.dispatchEvent(new window.Event('click'));
  assert.ok(form.textContent.includes('Check & size for drift'));
});

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
