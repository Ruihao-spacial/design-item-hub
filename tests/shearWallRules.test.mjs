// Shear wall design SELECTION RULES, tested as properties (not hand calcs): whatever the tool picks must obey the rule,
// so any valid design passes and only a broken rule fails. The method (loads, T/C, combinations, stacking, deflection)
// is verified by the pinned method cases (tests/shearWallCases.test.mjs); drift sizing (R7) by tests/shearWallDrift.test.mjs.
//   R1 auto nailing (strength) = the lightest pattern with v ≤ v_cap·C_hb (E and W); drift basis → heavier than the strength pick
//   R2 auto holdown / strap (strength) = the lightest in its table with cap ≥ T; OVER only if none carries T; drift basis → larger
//   R3 auto post = the first in catalog order with cap ≥ C and d2 ≥ the anchorage minimum post (HDUE by size, MSTC (2)2x)
//   R4 overrides are never changed; a post override below the minimum post is replaced and flagged
//   R5 support-post member designed for max(ASD, Ω₀ ASD) compression, then R3
//   R6 WSWH anchor = the smallest footing width W, then embedment d_e, with T_allow ≥ T among the SDC-permitted rows
//   R8 deflection distribution: equal Eq. 4.3-1 δ at every story, Σ V = V, zero-share walls δ(0) ≥ δ*, notes when δ(0)/δ* > 0.5
//   R9 distribution warnings: zero-share warning + under-load warning; an engineer review (line.distReviewed) clears a warning
//      only while its text is unchanged (stale otherwise); undoing the review brings it back
// Models: every method case source unpinned (tests/cases/src), the rule models (tests/rules/models: former V05, V06, V07,
// V16) and every legacy fixture. Run: node tests/shearWallRules.test.mjs
import fs from 'fs';
import assert from 'assert/strict';
import '../scripts/lib/shearWallLoadCheck.mjs'; // sets up the stand-in DOM
import { calcAll } from '../src/modules/shearWallCalc.js';
import { shearWallDesign } from '../src/modules/shearWallDesign.js';
import { HDUE_TABLE, MSTC_TABLE, POST_SIZES, computePostCapacity, getGradeById, hdueMinPost } from '../src/modules/shearWallHardware.js';
import { anchorRows } from '../src/modules/shearWallWswh.js';
import { NAIL } from './cases/src/lib.mjs';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 8).join('\n       ')); process.exitCode = 1; }
}
const EPS = 1e-6;

// === Models ===
const models = [];
const srcDir = new URL('./cases/src/', import.meta.url), ruleDir = new URL('./rules/models/', import.meta.url);
for (const [dir, tag] of [[srcDir, 'case (unpinned)'], [ruleDir, 'rule model']]) {
  for (const f of fs.readdirSync(dir).filter(f => /^V\d\d\.mjs$/.test(f)).sort()) {
    const c = (await import(new URL(f, dir))).default;
    models.push({ name: c.id + ' ' + tag, schemaVersion: 10, inputs: c.inputs });
  }
}
const legacyDir = new URL('./fixtures/legacy/', import.meta.url);
for (const f of fs.readdirSync(legacyDir).filter(f => f.endsWith('.json')).sort()) {
  const j = JSON.parse(fs.readFileSync(new URL(f, legacyDir), 'utf8'));
  models.push({ name: 'fixture ' + f, schemaVersion: j.schemaVersion, inputs: j.inputs });
}
const runs = models.map(m => {
  const inp = shearWallDesign.migrate({ schemaVersion: m.schemaVersion, inputs: JSON.parse(JSON.stringify(m.inputs)) }).inputs;
  return { ...m, inp, out: calcAll(inp) };
});

// The pinned method cases (every design choice is an override) — used for R4
const casesDir = new URL('./cases/', import.meta.url);
const pinnedRuns = fs.readdirSync(casesDir).filter(f => /^V\d\d-.*\.json$/.test(f)).sort().map(f => {
  const c = JSON.parse(fs.readFileSync(new URL(f, casesDir), 'utf8'));
  const inp = shearWallDesign.migrate({ schemaVersion: c.schemaVersion, inputs: JSON.parse(JSON.stringify(c.inputs)) }).inputs;
  return { name: c.id + ' pinned', inp, out: calcAll(inp) };
});

// Every sheathed wall result with its definition, level and line context
function eachWall(run, fn) {
  const { inp, out } = run;
  const levels = inp.levels || [];
  const bottom = levels.length ? levels[levels.length - 1].id : null;
  for (const d of out.perDirection) for (const ln of d.perLine) {
    const line = inp.directions.find(x => x.id === d.dirId).lines.find(l => l.id === ln.lineId);
    const thickness = line.wallThickness || inp.wallThickness || '4';
    for (const pl of ln.perLevel) {
      const lvl = levels.find(l => l.id === pl.levelId) || {};
      const holdown = pl.levelId === bottom || lvl.anchorageType === 'holdown';
      const table = holdown ? HDUE_TABLE : (MSTC_TABLE[String(lvl.floorClearSpan || '16')] || MSTC_TABLE['16']);
      for (const w of pl.walls) {
        const wIn = (line.walls || []).find(x => x.id === w.wallId) || {};
        fn({ w, wIn, ln, line, lvl, table, thickness, where: run.name + ' / ' + ln.lineName + ' / ' + w.mark });
      }
    }
  }
}
const lightest = (table, T) => (T * 1000 <= 0 ? table[0] : table.find(a => a.cap >= T * 1000 - EPS) || null);
const idx = (table, a) => table.findIndex(x => a && x.id === a.id);
const grade = (run) => getGradeById(run.inp.woodGrade);

// === R1 nailing ===
test('R1 auto nailing = the lightest pattern that carries the shear (E and W, with C_hb); drift raises it', () => {
  let n = 0;
  for (const run of runs) eachWall(run, ({ w, wIn, where }) => {
    if (w.method !== 'wall' || w.hbNotPermitted || wIn.nailingPattern || !w.nailing) return;
    const lt = run.inp.loadType || 'seismic', C = w.hbReductionFactor || 1;
    const ok = (p) => (lt === 'wind' || w.unitShear_seismic <= p.E * C + 0.01) && (lt === 'seismic' || w.unitShear_wind <= p.W * C + 0.01);
    const want = NAIL.find(ok) || NAIL[NAIL.length - 1];
    const got = NAIL.findIndex(p => p.id === w.nailing.id);
    if (w.nailingBasis === 'drift') {
      const s = NAIL.findIndex(p => p.id === w.strengthNailing.id);
      assert.ok(got > s, where + ': drift nailing ' + w.nailing.id + ' heavier than the strength pick ' + w.strengthNailing.id);
      assert.equal(w.strengthNailing.id, want.id, where + ' strength pick');
    } else {
      assert.equal(w.nailing.id, want.id, where + ': v ' + w.unitShear_seismic + ' / ' + w.unitShear_wind + ' plf');
    }
    n++;
  });
  assert.ok(n > 30, n + ' walls checked');
});

// === R2 anchorage ===
test('R2 auto holdown / strap = the lightest in its table with cap ≥ T; OVER only when none carries it; drift raises it', () => {
  let n = 0;
  for (const run of runs) eachWall(run, ({ w, wIn, table, where }) => {
    if (w.method === 'wswh') return;
    const d = w.hwDemand || { tL: w.governingTensionLeft, tR: w.governingTensionRight };
    for (const [side, ov, a, T] of [['left', wIn.anchorageLeftOverride, w.anchorageLeft, d.tL], ['right', wIn.anchorageRightOverride, w.anchorageRight, d.tR]]) {
      if (ov) continue;
      const want = lightest(table, T);
      const basis = w.anchorageBasis && w.anchorageBasis[side];
      if (basis && basis.basis === 'drift') {
        assert.ok(idx(table, a) > idx(table, want), where + ' ' + side + ': drift pick ' + (a && a.id) + ' larger than ' + (want && want.id));
        assert.equal(basis.strength, want && want.id, where + ' ' + side + ' strength pick');
      } else {
        assert.equal(a ? a.id : null, want ? want.id : null, where + ' ' + side + ': T ' + T);
      }
      if (a) assert.ok(a.cap >= T * 1000 - EPS, where + ' ' + side + ' cap ≥ T');
      n++;
    }
  });
  assert.ok(n > 60, n + ' ends checked');
});

// === R3 posts ===
test('R3 auto post = first in catalog order with cap ≥ C and at least the anchorage minimum post (MSTC ends (2)2x)', () => {
  let n = 0;
  for (const run of runs) eachWall(run, ({ w, wIn, lvl, thickness, where }) => {
    if (w.method !== 'wall') return;
    const d = w.hwDemand || { cL: w.governingComprLeft, cR: w.governingComprRight };
    for (const [ov, p, C, a] of [[wIn.postLeftOverride, w.postLeft, d.cL, w.anchorageLeft], [wIn.postRightOverride, w.postRight, d.cR, w.anchorageRight]]) {
      if (a && a.id && a.id.startsWith('MSTC')) assert.ok(p && POST_SIZES[thickness].find(x => x.id === p.postId).d2 >= POST_SIZES[thickness][1].d2, where + ': strap end post ≥ ' + POST_SIZES[thickness][1].id);
      if (ov) continue;
      const min = hdueMinPost(a, thickness);
      const want = POST_SIZES[thickness].filter(x => !min || x.d2 >= min.d2 - 1e-9)
        .find(x => computePostCapacity(x, grade(run), parseFloat(lvl.floorToFloor)).capacityKips >= C - EPS);
      assert.equal(p ? p.postId : null, want ? want.id : null, where + ': C ' + C + (min ? ', min ' + min.id : ''));
      n++;
    }
  });
  assert.ok(n > 60, n + ' ends checked');
});

// === R4 overrides ===
test('R4 overrides are kept (nailing, holdown / strap, post); a post below the minimum is replaced and flagged', () => {
  let n = 0;
  for (const run of [...runs, ...pinnedRuns]) eachWall(run, ({ w, wIn, ln, thickness, where }) => {
    if (w.method === 'wswh') return;
    if (wIn.nailingPattern) { assert.equal(w.nailing.id, wIn.nailingPattern, where); assert.equal(w.nailingBasis, 'manual'); n++; }
    for (const [side, ovA, a, ovP, p] of [['left', wIn.anchorageLeftOverride, w.anchorageLeft, wIn.postLeftOverride, w.postLeft], ['right', wIn.anchorageRightOverride, w.anchorageRight, wIn.postRightOverride, w.postRight]]) {
      if (ovA) { assert.equal(a && a.id, ovA, where + ' ' + side + ' anchorage override'); n++; }
      if (!ovP) continue;
      const min = hdueMinPost(a, thickness);
      const size = POST_SIZES[thickness].find(x => x.id === ovP) || [...POST_SIZES['4'], ...POST_SIZES['6']].find(x => x.id === ovP);
      if (!min || size.d2 >= min.d2 - 1e-9) assert.equal(p && p.postId, ovP, where + ' ' + side + ' post override');
      else {
        assert.notEqual(p && p.postId, ovP, where + ' ' + side + ': override below the minimum is replaced');
        assert.ok(ln.loadPathAudit.warnings.some(x => x.type === 'post_below_hdue_min' && x.elementId === w.wallId), where + ' flagged');
      }
      n++;
    }
  });
  assert.ok(n > 100, n + ' overrides checked');
  // a single 2x4 at a strap end (upper story) is below the MSTC minimum (2)2x4 → replaced and flagged
  const c = pinnedRuns.find(x => x.name === 'V08 pinned');
  const inp = JSON.parse(JSON.stringify(c.inp));
  const top = inp.directions[0].lines[0].walls.find(w => w.mark === 'SW-1');
  top.postLeftOverride = '2x4';
  const ln = calcAll(inp).perDirection[0].perLine[0];
  const w = ln.perLevel.flatMap(p => p.walls).find(x => x.mark === 'SW-1');
  assert.equal(w.anchorageLeft.id.slice(0, 4), 'MSTC');
  assert.equal(w.postLeft.postId, '(2)2x4');
  assert.ok(ln.loadPathAudit.warnings.some(x => x.type === 'post_below_hdue_min' && /anchorage minimum post \(2\)2x4/.test(x.message)));
});

// === R5 support posts ===
test('R5 support-post member = max(ASD, Ω₀ ASD) compression, then the R3 post rule', () => {
  let n = 0;
  for (const run of runs) for (const d of run.out.perDirection) for (const ln of d.perLine) {
    const line = run.inp.directions.find(x => x.id === d.dirId).lines.find(l => l.id === ln.lineId);
    const thickness = line.wallThickness || run.inp.wallThickness || '4';
    for (const pp of ln.postPaths || []) {
      const pIn = (line.supportPosts || []).find(x => x.id === pp.postId) || {};
      const Co = pp.omega && pp.omega.asd ? pp.omega.asd.C : 0;
      assert.ok(Math.abs(pp.postDesignC - Math.max(pp.envelopeC, Co)) <= 1e-6, run.name + ' ' + pp.mark + ' design C');
      assert.equal(pp.postGoverns, Co > pp.envelopeC + 1e-9 ? 'Ω₀ ASD' : 'ASD');
      if (!pIn.postOverride) {
        const min = hdueMinPost(pp.anchorage, thickness);
        const want = POST_SIZES[thickness].filter(x => !min || x.d2 >= min.d2 - 1e-9)
          .find(x => computePostCapacity(x, grade(run), pp.floorH).capacityKips >= pp.postDesignC - EPS);
        assert.equal(pp.post ? pp.post.postId : null, want ? want.id : null, run.name + ' ' + pp.mark);
      }
      n++;
    }
  }
  assert.ok(n >= 5, n + ' support posts checked');
});

// === R6 WSWH anchors ===
test('R6 WSWH anchor = smallest W, then d_e, with T_allow ≥ T among the permitted rows', () => {
  let n = 0;
  for (const run of runs) eachWall(run, ({ w, wIn, where }) => {
    if (w.method !== 'wswh' || wIn.wswhAnchorOverride) return;
    const a = w.anchorageLeft;
    if (!a || !a.rowId) return; // stacked 2nd story (TSS rod) / raised floor (by RDP): fixed by the condition
    const T = ((w.hwDemand || {}).tL ?? w.governingTensionLeft) * 1000;
    const rows = anchorRows({ fc: run.inp.wswhFc || '2500', sdc: run.inp.seismicDesignCategory, detached: !!run.inp.detachedOneTwoFamily });
    const better = rows.filter(r => r.T_ASDallow >= T - EPS && (r.W_in < a.W || (r.W_in === a.W && r.de_in < a.de)));
    assert.ok(a.cap >= T - EPS, where + ' cap ≥ T');
    assert.deepEqual(better.map(r => r.grade + ' W' + r.W_in + ' de' + r.de_in), [], where + ': no smaller permitted anchor carries T');
    n++;
  });
  assert.ok(n >= 2, n + ' WSWH anchors checked');
});

// === R8 deflection distribution ===
test('R8 deflection distribution: Σ shares = V; every wall with a share has the story δ (Eq. 4.3-1 at its share); a zero-share wall has δ(0) ≥ δ*; noted exactly when δ(0)/δ* > 0.5', () => {
  let n = 0;
  for (const run of [...runs, ...pinnedRuns]) for (const d of run.out.perDirection) for (const ln of d.perLine) {
    const dist = ln.distribution;
    if (!dist || dist.method !== 'deflection' || !dist.converged) continue;
    for (const l of dist.levels) {
      const pl = ln.perLevel.find(p => p.levelId === l.levelId);
      const where = run.name + ' / ' + ln.lineName + ' / ' + l.levelName;
      const sum = pl.walls.reduce((a, w) => a + ((l.loadType === 'E' ? w.shareExact_1E : w.shareExact_1W) || 0), 0);
      assert.ok(Math.abs(sum - l.V) <= 1e-6, where + ' Σ shares ' + sum + ' = ' + l.V);
      for (const lw of l.walls) {
        const w = pl.walls.find(x => x.wallId === lw.wallId);
        const V = (l.loadType === 'E' ? w.shareExact_1E : w.shareExact_1W) || 0;
        const dAt = w._deltaAt(l.loadType, V);
        if (lw.zeroShare) assert.ok(lw.delta0 >= l.delta - 1e-4 && V === 0, where + ' ' + w.mark + ' zero share');
        else assert.ok(Math.abs(dAt - l.delta) <= Math.max(0.0005, 0.005 * l.delta), where + ' ' + w.mark + ' δ ' + dAt + ' vs ' + l.delta);
        const noted = (dist.noted || []).some(x => x.wallId === lw.wallId && x.levelName === l.levelName && x.loadType === l.loadType);
        assert.equal(noted, lw.zeroShare || lw.fromAboveRatio > 0.5, where + ' ' + w.mark + ' note');
        n++;
      }
    }
  }
  assert.ok(n >= 10, n + ' walls checked');
});

// === Boundary behaviour from the former selection cases ===
const byName = (id) => runs.find(r => r.name === id + ' rule model');
const wallOf = (run, line, mark) => run.out.perDirection[0].perLine.find(l => l.lineName === line).perLevel.flatMap(p => p.walls).find(w => w.mark === mark);
test('Boundaries: nailing at exactly v_cap stays (≤), 1 plf over steps up, past the heaviest = heaviest with D/C > 1 (former V05)', () => {
  const r = byName('V05');
  assert.equal(wallOf(r, 'Line A', 'SW-1').nailing.id, '6');
  assert.equal(wallOf(r, 'Line B', 'SW-2').nailing.id, '4');
  const c = wallOf(r, 'Line C', 'SW-3'); assert.equal(c.nailing.id, '2B'); assert.ok(c.dcRatio > 1);
});
test('Boundaries: strap table follows the floor clear span; T past HDUE17 is OVER and fails G10 (former V06)', () => {
  const r = byName('V06');
  const s = r.out.perDirection[0].perLine.find(l => l.lineName === 'Line S');
  const spans = s.perLevel.map(pl => ({ lvl: pl.levelName, a: pl.walls[0].anchorageLeft.id }));
  assert.equal(spans.length, 4);
  const o = r.out.perDirection[0].perLine.find(l => l.lineName === 'Line O');
  assert.equal(o.perLevel.flatMap(p => p.walls)[0].anchorageLeft, null);
  assert.ok(o.checks.some(c => c.id === 'G10' && c.status === 'fail'));
});
test('Boundaries: posts tried in catalog order ((3)2x4 before 4x4), 6" wall uses the 6" list (former V07)', () => {
  const r = byName('V07');
  assert.equal(wallOf(r, 'Line B', 'SW-2').postRight.postId, '(3)2x4');
  assert.ok(wallOf(r, 'Line E', 'SW-5').postRight.postId.endsWith('2x6'));
});

// === R9 engineer review of the distribution warnings (user request 2026-10-01) ===
const v23 = JSON.parse(fs.readFileSync(new URL('./cases/V23-zero-share-wall.json', import.meta.url), 'utf8')); // pinned design (zero share)
test('R9 distribution warnings: an engineer review clears a warning only while it reads the same; stale when the values change; undo restores it', () => {
  const c = v23;
  const run = (mut) => { const inp = JSON.parse(JSON.stringify(shearWallDesign.migrate({ schemaVersion: c.schemaVersion, inputs: c.inputs }).inputs)); if (mut) mut(inp);
    return calcAll(inp).perDirection[0].perLine[0].distribution.warnings; };
  const open = run();
  assert.deepEqual(open.map(w => w.type).sort(), ['dist_under_load', 'dist_zero_share']);
  assert.ok(open.every(w => w.key && !w.reviewed && !w.reviewStale));
  const lineOf = (inp) => inp.directions[0].lines[0];
  const done = run(inp => { lineOf(inp).distReviewed = open.map(w => ({ key: w.key, message: w.message, date: '2026-10-01' })); });
  assert.ok(done.every(w => w.reviewed && !w.reviewStale && w.reviewDate === '2026-10-01'));
  // the story shear changes → the messages change → the reviews are stale and the warnings count again
  const stale = run(inp => { lineOf(inp).distReviewed = open.map(w => ({ key: w.key, message: w.message, date: '2026-10-01' }));
    lineOf(inp).levelLoads['lvl-2'].seismic = '6'; });
  assert.ok(stale.length === 2 && stale.every(w => !w.reviewed && w.reviewStale));
  const undone = run(inp => { lineOf(inp).distReviewed = []; });
  assert.ok(undone.every(w => !w.reviewed && !w.reviewStale));
});

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
