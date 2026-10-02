// Shear Wall built-in equilibrium checks G1–G12 (shearWallChecks.js): every saved layout balances, the
// checks catch a load that is lost / changed on purpose, and the F1 / F2 gravity fixes close the path.
// Run: node tests/shearWallChecks.test.mjs
import fs from 'fs';
import assert from 'assert/strict';
import '../scripts/lib/shearWallLoadCheck.mjs'; // sets up the stand-in DOM
import { calcAll } from '../src/modules/shearWallCalc.js';
import { lineChecks } from '../src/modules/shearWallChecks.js';
import { shearWallDesign, renderLineResults } from '../src/modules/shearWallDesign.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' ± ' + tol + ', got ' + a);
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message)); process.exitCode = 1; }
}
const statusOf = (ln) => Object.fromEntries(ln.checks.map(c => [c.id, c.status]));
const failedIds = (ln) => ln.checks.filter(c => c.status === 'fail').map(c => c.id);
const clone = (o) => JSON.parse(JSON.stringify(o));
// Re-run the checks on a (tampered) copy of a line result
const recheck = (inputs, dirIdx, lineIdx, res) => {
  const dir = inputs.directions[dirIdx];
  return lineChecks(dir.lines[lineIdx], res, { inputs, levels: inputs.levels, rho: dir.rho });
};
const failsOf = (ck) => ck.checks.filter(c => c.status === 'fail').map(c => c.id);

const fixturesDir = new URL('./fixtures/', import.meta.url);
const loadItem = (f) => { const j = JSON.parse(fs.readFileSync(new URL(f, fixturesDir), 'utf8')); return j.inputs ? j : { schemaVersion: 8, inputs: j }; };
const FIXTURES = ['shearwall-sample.json', ...fs.readdirSync(new URL('legacy/', fixturesDir)).map(f => 'legacy/' + f)];
// Old fixtures that enter story shear at levels where the line has no wall: G2 must flag the lost shear
const KNOWN_LOST_SHEAR = { 'legacy/schema3-phase2.json|Line 2': ['G2'], 'legacy/schema4-bm-nan.json|Line 2': ['G2'] };

// A line with an OVER part (nothing in the catalog carries the demand) fails G10 — user rule 2026-09-29
const hasOver = (ln) => ln.perLevel.some(pl => pl.walls.some(w => !w.anchorageLeft || !w.anchorageRight || (w.method !== 'wswh' && (!w.postLeft || !w.postRight))))
  || (ln.postPaths || []).some(p => !p.post || (!p.anchorage && p.anchorageType))
  || (ln.beamTransfers || []).some(b => b.supports.some(s => !s.anchorage && s.anchorageType));
test('G1–G12: every saved layout balances (lost story shear in two old fixtures is flagged by G2 only; OVER parts fail G10)', () => {
  let over = 0;
  for (const f of FIXTURES) {
    const inp = shearWallDesign.migrate(loadItem(f)).inputs;
    for (const d of calcAll(inp).perDirection) for (const ln of d.perLine) {
      const want = [...(KNOWN_LOST_SHEAR[f + '|' + ln.lineName] || []), ...(hasOver(ln) ? ['G10'] : [])].sort();
      if (hasOver(ln)) over++;
      assert.deepEqual([...failedIds(ln)].sort(), want, f + ' ' + ln.lineName);
    }
  }
  assert.ok(over > 0, 'the sample fixture has OVER parts');
});

// One-direction builder for the scenarios below
const W = (id, lvl, pos, len, more = {}) => ({ id, mark: id, levelId: lvl, position: pos, length: len, wallDLTypeId: 'dl-1', nailingPattern: '',
  anchorageLeftOverride: '', anchorageRightOverride: '', postLeftOverride: '', postRightOverride: '', openings: [], method: 'segmented',
  narrowPier: false, ftaoStrapOverride: '', jambPostOverride: '', systemType: 'sheathed', ...more });
const build = (walls, levels, loads, gravity = {}, extra = {}) => ({
  sds: 1.0, loadType: 'seismic', wallThickness: '4', woodGrade: 'dfir_no1', wallDLTypes: [{ id: 'dl-1', name: 'Int', psf: 10 }], sheathing: 'ply',
  refs: {}, driftRow: 'other', levels,
  directions: [{ id: 'd', name: 'N-S', rho: 1, lines: [{ id: 'ln', name: 'A', totalLength: 40, wallThickness: '', levelLoads: loads, walls, beams: [], supportPosts: [], gravityLoads: gravity }] }],
  ...extra,
});
const L1 = [{ id: 'l1', name: '1st', floorToFloor: 10, floorClearSpan: '16', anchorageType: 'auto' }];
const L2 = [{ id: 'l2', name: '2nd', floorToFloor: 9, floorClearSpan: '16', anchorageType: 'auto' }, { id: 'l1', name: '1st', floorToFloor: 9, floorClearSpan: '16', anchorageType: 'auto' }];
const panel = (id, lvl, cond) => W(id, lvl, 0, 1.5, { systemType: 'wswh', wswhWidth: '18', wswhCondition: cond, wswhJoist: '12', wswhFloorDepth: '12', wswhAnchorOverride: '' });
const lineOf = (out) => out.perDirection[0].perLine[0];

test('FTAO wall with a window: loads over the opening are carried; wall weight excludes the opening; G4 / G8 balance', () => {
  const inp = build([W('SW-1', 'l1', 0, 12, { method: 'ftao', openings: [{ id: 'o', offset: 4, width: 4, sill: 3, head: 7 }] })], L1, { l1: { seismic: 4 } },
    { l1: { loads: [{ id: 'g', shape: 'full', D: '200', L: '100', Lr: '' }] } });
  const ln = lineOf(calcAll(inp));
  assert.deepEqual(failedIds(ln), []);
  const [w] = ln.perLevel[0].walls;
  assert.equal(w.method, 'ftao');
  // D = 200 plf × 12 ft + 10 psf × (12 × 10 − 4 × 4) ft² = 2.40 + 1.04 = 3.44 k; L = 100 × 12 = 1.2 k
  near(w.dlTotal, 3.44, 0.006); near(w.live.L.total, 1.2, 0.001);
});

test('A segmented wall carrying openings (outside data) is designed solid, flagged, and still balances', () => {
  const inp = build([W('SW-1', 'l1', 0, 12, { openings: [{ id: 'o', offset: 4, width: 4, sill: 3, head: 7 }] })], L1, { l1: { seismic: 4 } },
    { l1: { loads: [{ id: 'g', shape: 'full', D: '200', L: '', Lr: '' }] } });
  const ln = lineOf(calcAll(inp));
  assert.deepEqual(failedIds(ln), []);
  near(ln.perLevel[0].walls[0].dlTotal, 2.4 + 1.2, 0.006, 'solid wall: full self-weight 10 psf × 12 × 10');
  assert.ok(ln.loadPathAudit.warnings.some(x => /segmented walls are solid/.test(x.message)));
});

test('F2: a stacked WSWH base carries the 2nd-story panel gravity to the foundation; G8 balances', () => {
  const inp = build([panel('WS-2', 'l2', 'stackedUpper'), panel('WS-1', 'l1', 'concrete')], L2, { l2: { seismic: 1 }, l1: { seismic: 1 } },
    { l2: { loads: [{ id: 'g', shape: 'full', D: '100', L: '', Lr: '' }] } });
  const ln = lineOf(calcAll(inp));
  assert.deepEqual(failedIds(ln), []);
  const up = ln.perLevel[0].walls[0], lo = ln.perLevel[1].walls[0];
  near(lo.wswh.fromAbove.D, up.dlTotal, 0.001, 'base panel lists the load from the panel above');
  assert.ok(lo.gravRows.some(r => r.shape === 'stack'), 'stack row documented');
  // base panel D = its own self-weight (10 psf × 1.5 ft × 9 ft = 0.135 k) + the upper panel's D
  near(lo.dlTotal - lo.wswh.fromAbove.D, 0.135, 0.006, 'own self-weight');
});

// === The checks fire: each tampered result must fail exactly the check that guards it ===
const sample = shearWallDesign.migrate(loadItem('shearwall-sample.json')).inputs;
const sampleOut = calcAll(sample);
const lineIdx = (name) => sample.directions[0].lines.findIndex(l => l.name === name);

test('G2 fires when a wall share is lost', () => {
  const i = lineIdx('Line A'), res = clone(sampleOut.perDirection[0].perLine[i]);
  res.perLevel[0].walls[0].shareExact_1E = 0;
  assert.ok(failsOf(recheck(sample, 0, i, res)).includes('G2'));
});

test('G4 fires when a wall drops part of its gravity', () => {
  const i = lineIdx('Line A'), res = clone(sampleOut.perDirection[0].perLine[i]);
  const w = res.perLevel.flatMap(p => p.walls).find(x => x.dlTotal > 0.5);
  w.dlTotal -= 0.5;
  assert.ok(failsOf(recheck(sample, 0, i, res)).includes('G4'));
});

test('G6 fires when a wall end force does not balance the overturning', () => {
  const i = lineIdx('Line A'), res = clone(sampleOut.perDirection[0].perLine[i]);
  const w = res.perLevel.flatMap(p => p.walls).find(x => x.combos['1.0E'].tensionLeft > 0);
  w.combos['1.0E'].tensionLeft += 0.5;
  assert.ok(failsOf(recheck(sample, 0, i, res)).includes('G6'));
});

test('G7 fires when a transfer loses force (beam reaction changed)', () => {
  const i = sampleOut.perDirection[0].perLine.findIndex(l => (l.beamTransfers || []).some(b => b.valid));
  assert.ok(i >= 0, 'sample has a transfer beam');
  const res = clone(sampleOut.perDirection[0].perLine[i]);
  const bt = res.beamTransfers.find(b => b.valid);
  bt.supports[0].perCombo['1.0E'] = (bt.supports[0].perCombo['1.0E'] || 0) + 1;
  assert.ok(failsOf(recheck(sample, 0, i, res)).includes('G7'));
});

test('G9 fires when a base force moves along the line', () => {
  const i = lineIdx('Line A'), res = clone(sampleOut.perDirection[0].perLine[i]);
  const d = res.wallDeliveries.find(x => x.receiver.type === 'foundation' && Math.abs(x.map['1.0E'] || 0) > 0.5);
  d.position += 2;
  assert.ok(failsOf(recheck(sample, 0, i, res)).includes('G9'));
});

test('G12 fires when a combination is not the factored sum of the load cases', () => {
  const i = lineIdx('Line A'), res = clone(sampleOut.perDirection[0].perLine[i]);
  const w = res.perLevel[0].walls[0];
  w.combos['D+0.7ρE_pos'].comprRight += 0.5;
  assert.ok(failsOf(recheck(sample, 0, i, res)).includes('G12'));
});

test('G10: an anchorage override below the demand fails the check and makes the line NG', () => {
  const inp = build([W('SW-1', 'l1', 0, 6, { wallDLTypeId: '', anchorageLeftOverride: 'HDUE3', anchorageRightOverride: 'HDUE3' })], L1, { l1: { seismic: 4 } });
  const ln = lineOf(calcAll(inp));
  assert.ok(ln.perLevel[0].walls[0].governingTensionLeft * 1000 > 3790, 'demand above HDUE3');
  assert.deepEqual(failedIds(ln), ['G10']);
  assert.equal(ln.checksFailed, 1);
});

test('Checks tab renders with the rule, variables and NG rows; status badge counts failed checks', () => {
  const inp = build([W('SW-1', 'l1', 0, 6, { wallDLTypeId: '', anchorageLeftOverride: 'HDUE3', anchorageRightOverride: 'HDUE3' })], L1, { l1: { seismic: 4 } });
  const out = calcAll(inp), ln = lineOf(out);
  const c = document.createElement('div');
  renderLineResults(c, ln, out.perDirection[0], { tab: 'checks', onTab() {}, report: 'summary', onReport() {} });
  const t = c.textContent;
  assert.ok(t.includes('Checks (1 NG)'));
  assert.ok(t.includes('G10 — Envelope and hardware'));
  assert.ok(t.includes('Variables:'));
  assert.ok(t.includes('1 equilibrium check failed'));
});

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
