// Stacked Strong-Wall base moment (user 2026-11-10, SWD item 6; calc v27).
// M = V₁·h₁ + V₂·(h₂ + d) at story heights: V₁ = the base panel's share (it already includes V₂), V₂ = the 2nd-story
// panel's share, h = level floor-to-floor, d = Setup floor plate depth of the story below (the only depth source).
// Before v27 the tool used [V₁·H₁ + V₂·(H₁ + d_fl + H₂)]/12, which counted V₂·H₁ twice.
// M_allow, Δ and T at the allowable moment from Table 07 (C-L-SW26 p. 50), no P interpolation; P₁ > 4,000 / P₂ > 2,000,
// d = 0 and d > 18" → warnings (the panel keeps its shear).
// Example: C-L-SW26 p. 29 (1,500 lb at the roof, 2,000 lb at the 2nd floor, 8 ft over 9 ft, 12" floor) = 45,000 ft·lb.
// Run: node tests/shearWallStacked.test.mjs
import assert from 'assert/strict';
import { checkShearWallItem } from '../scripts/lib/shearWallLoadCheck.mjs'; // sets up the stand-in DOM
import { calcAll } from '../src/modules/shearWallCalc.js';
import { stackMoment, stackedBaseCheck } from '../src/modules/shearWallWswh.js';
import { WSWH_T07 } from '../src/modules/shearWallWswhData.js';
void checkShearWallItem;

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' ± ' + tol + ', got ' + a);
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message)); process.exitCode = 1; }
}

const P = (id, lv, more = {}) => ({ id, mark: id, levelId: lv, position: 2, length: 2, wallDLTypeId: '', nailingPattern: '', anchorageLeftOverride: '',
  anchorageRightOverride: '', postLeftOverride: '', postRightOverride: '', openings: [], method: 'segmented',
  systemType: 'wswh', wswhWidth: '24', wswhCondition: 'concrete', wswhJoist: '12', wswhAnchorOverride: '', ...more });
// Roof story 8 ft over a 9 ft first story; depth = Setup floor plate depth of the first story (the 2nd floor)
function model({ roof = 1.5, second = 2.0, depth = '12', type = 'wind', gravity = null } = {}) {
  const lt = type === 'wind' ? 'wind' : 'seismic';
  return { sds: '1.0', loadType: type, wallThickness: '4', species: 'DF-L', woodGrade: 'dfir_no1', postGrade: 'dfir_pt_no1', wallDLTypes: [],
    sheathing: 'ply', alphaS: '', cd: '4', ie: '1', riskCategory: 'II', refs: {}, wswhFc: '2500', seismicDesignCategory: 'D',
    levels: [{ id: 'r', name: 'Roof', floorToFloor: 8, anchorageType: 'auto' }, { id: 'f2', name: '2nd Floor', floorToFloor: 9, anchorageType: 'auto', floorPlateDepth: depth }],
    directions: [{ id: 'd', name: 'N-S', rho: 1, lines: [{ id: 'l', name: 'A', totalLength: 20, wallThickness: '',
      levelLoads: { r: { [lt]: String(roof) }, f2: { [lt]: String(second) } },
      walls: [P('U', 'r', { wswhCondition: 'stackedUpper' }), P('B', 'f2')], beams: [], supportPosts: [], gravityLoads: gravity || {} }] }] };
}
const lineOf = (inp) => calcAll(inp).perDirection[0].perLine[0];
const base = (ln) => ln.perLevel[1].walls[0];
const warnings = (ln) => ln.loadPathAudit.warnings.map(w => w.message);

test('C-L-SW26 p. 29 loads: M = 1,500 × (8 + 1 + 9) + 2,000 × 9 = 45,000 ft·lb; V₁·h₁ + V₂·(h₂ + d) with V₁ = 3,500', () => {
  const ln = lineOf(model());
  const B = base(ln), st = B.wswh.stacked.W;
  assert.equal(B.wswh.role, 'stackedLower');
  near(B.share_1W, 3.5, 1e-9, 'V₁ = the story shear, incl. the upper 1.5 k');
  assert.deepEqual([st.h1, st.h2, st.d], [9, 8, 1]);
  near(st.M1, 45000, 1e-6);
  near(st.M1, 1500 * (8 + 1 + 9) + 2000 * 9, 1e-6, 'Σ F·y of the story forces');
  near(B.steps.otm1W, 45, 1e-9, '1.0-level OTM used for the base anchor forces');
  near(B.combos['1.0W'].tensionLeft, 45 / (B.wswh.B / 12), 1e-9, 'T = M / B');
  // ASD check at 0.6W against Table 07 WSWH24x9 wind 49,160 lb-ft
  near(st.Mallow, 49160, 1e-9);
  near(st.Md, 0.6 * 45000, 1e-6);
  near(B.dcRatio, Math.round(0.6 * 45000 / 49160 * 100) / 100, 1e-9);
  near(st.V1avail, (49160 - 0.6 * 1500 * 9) / 9, 1e-6);
});

test('Roof only → 1,500 × 18 = 27,000; 2nd floor only → 2,000 × 9 = 18,000 (no V₂·h₁ counted twice)', () => {
  near(base(lineOf(model({ second: 0 }))).wswh.stacked.W.M1, 27000, 1e-6);
  near(base(lineOf(model({ roof: 0 }))).wswh.stacked.W.M1, 18000, 1e-6);
});

test('Statics: ΣFx = 0, ΣFy = 0 at the base; ΣM: the base couple over the anchor arm B = Σ F·y; G9 passes exactly', () => {
  const ln = lineOf(model());
  const B = base(ln), c = B.combos['1.0W'];
  near(1.5 + 2.0 - ln.perLevel[1].storyShear_1W, 0, 1e-9, 'ΣFx');
  near(c.tensionLeft - c.comprRight, 0, 1e-9, 'ΣFy (no gravity)');
  near(c.tensionLeft * B.wswh.B / 12, 1.5 * 18 + 2.0 * 9, 1e-9, 'ΣM');
  const g9 = ln.checks.find(x => x.id === 'G9');
  assert.equal(g9.status, 'pass');
  near(g9.rows[0].expected, 45, 1e-9);
  assert.ok(!g9.notes.some(n => /not a loss/.test(n)), 'no "not a loss" note for a stacked pair');
  assert.deepEqual(ln.checks.filter(x => x.status === 'fail').map(x => x.id), []);
});

test('M_allow / Δ / T from Table 07 (p. 50), interpolated on height only; seismic WSWH24x9 = 45,170', () => {
  const t = (m) => WSWH_T07.find(r => r.model === m);
  assert.equal(t('WSWH24x9').M_ASDcap_S, 45170); assert.equal(t('WSWH24x9').M_ASDcap_W, 49160);
  const m = stackMoment(24, 9);
  assert.deepEqual([m.M.E, m.M.W, m.D.E, m.T.W], [45170, 49160, 0.43, 33710]);
  const half = stackMoment(24, 9.5);
  near(half.M.W, (49160 + 49145) / 2, 1e-9, 'between x9 and x10');
  assert.ok(stackMoment(12, 13).error, 'WSWH12 stops at x12');
  const ln = lineOf(model({ type: 'seismic' }));
  near(base(ln).wswh.stacked.E.Mallow, 45170, 1e-9);
  // stackedBaseCheck alone
  const s = stackedBaseCheck({ Mallow: 49160, V1: 2100, V2: 900, h1: 9, h2: 8, d: 1 });
  near(s.Md, 2100 * 9 + 900 * 9, 1e-9);
});

test('One depth source (Setup): d = 0 → warning, d > 18" → warning; the panel keeps its shear', () => {
  const zero = lineOf(model({ depth: '' }));
  assert.equal(base(zero).wswh.stacked.W.d, 0);
  assert.ok(warnings(zero).some(m => /Floor plate depth between the stacked panels is 0/.test(m)));
  near(base(zero).wswh.stacked.W.M1, 1500 * 17 + 2000 * 9, 1e-6);
  const deep = lineOf(model({ depth: '20' }));
  assert.ok(warnings(deep).some(m => /20" between the stacked panels exceeds 18"/.test(m)));
  assert.ok(deep.perLevel[0].walls[0].share_1W > 0 && base(deep).share_1W > 0, 'panels still carry shear');
  // the panel's old wswhFloorDepth is no longer read
  const inp = model({ depth: '' }); inp.directions[0].lines[0].walls[0].wswhFloorDepth = '12';
  assert.equal(base(lineOf(inp)).wswh.stacked.W.d, 0);
});

test('P₁ > 4,000 lb → warning (Table 07 basis, p. 50 n.5); the base panel keeps its M_allow and shear', () => {
  const ln = lineOf(model({ gravity: { f2: { loads: [{ id: 'g', shape: 'full', D: '2600', L: '', Lr: '' }] } } }));
  const B = base(ln);
  assert.ok(B.wswh.P.W > 4000, 'P = ' + B.wswh.P.W);
  assert.ok(warnings(ln).some(m => /P₁ = \d+ lb exceeds 4,000 lb/.test(m)));
  assert.ok(B.wswh.ok && B.share_1W > 0);
  near(B.wswh.stacked.W.Mallow, 49160, 1e-9, 'table value, no P interpolation');
});

console.log(passed + ' passed');
