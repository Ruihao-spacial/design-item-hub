// User test project 26996 (2026-11-05; tests/fixtures/da-user/t96-*.json): 2nd floor with a notch (x 0–10, y 80–100),
// SW-19 on line 2 below the notch, offset line 1/2 (SWD lines 1 and 2) with TD1 as its strut; Roof-story walls SW-5 / SW-7
// continue down line 2 (to SW-19), SW-11..14 on B / C end at this floor.
// Findings: (1) load along x: the diaphragm was supported on A / C — C has no wall below; (2) load along y: TD1 read the
// drag of SW-5 / SW-7 along grid 2 as a cut strut force (10 k counted twice) — fixed: a TD's P leaves out walls above
// that continue down their line. Run: node tests/daCase26996.test.mjs
import assert from 'assert/strict';
import fs from 'fs';
import { parseHTML } from 'linkedom';

if (!globalThis.document) {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window, document, Node: window.Node });
}
const { getModule } = await import('../src/modules/registry.js');
const { swdExtract } = await import('../src/modules/tdWallLink.js');
const { normalizeInputs } = await import('../src/modules/tdMigrate.js');
const { calcAll } = await import('../src/modules/diaphragmAnalysis.js');
const { sharedGrids } = await import('../src/modules/tdGridShare.js');

const clone = v => JSON.parse(JSON.stringify(v));
const load = f => JSON.parse(fs.readFileSync(new URL('./fixtures/da-user/' + f, import.meta.url), 'utf8'));
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 6).join('\n       ')); process.exitCode = 1; }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const swdItem = load('t96-swd.json'), roofItem = load('t96-roof.json'), flrItem = load('t96-2nd.json');
const swd = getModule('shear_wall_design').migrate({ schemaVersion: swdItem.schemaVersion, inputs: clone(swdItem.inputs) }).inputs;
function run(mod = () => {}) {
  const inp = normalizeInputs(clone(flrItem.inputs));
  mod(inp, n => inp.grids.find(x => x.name === n).id);
  return calcAll(inp, { wallSource: swdExtract(swd), gridSource: { grids: sharedGrids(roofItem.inputs) } });
}
const onAD = (inp, g) => { inp.diaphragms.find(d => d.dir === 'x').supports = [g('A'), g('D')]; };
const lf = (r, n) => (r.lineForces.find(l => l.line === n) || {}).E;

test('as saved: load along x on A / C — C has no wall below, so SW-13 / SW-14 (on C) cannot be placed: plan error, case held', () => {
  const r = run();
  assert.ok(r.errors.some(e => e.code === 'above-no-diaphragm' && /SW-13/.test(e.msg)));
  assert.ok(r.warnings.some(w => w.code === 'line-no-wall' && /Line C/.test(w.msg)));
  assert.equal(lf(r, 'A'), null);
});

test('load along x on A / D: runs and closes — A + D = 30 k (10 own + 20 from SW-11..14)', () => {
  const r = run(onAD);
  assert.deepEqual(r.errors.map(e => e.code), []);
  const cx = r.analysis.cases.find(c => c.dir === 'x' && c.kind === 'E');
  assert.ok(!r.checks.some(c => c.caseId === cx.id && !c.ok && !c.warn), r.checks.filter(c => c.caseId === cx.id && !c.ok).map(c => c.msg).join(' | '));
  assert.ok(near(lf(r, 'A') + lf(r, 'D'), 30, 1e-3), lf(r, 'A') + ' + ' + lf(r, 'D'));
});

test('load along y (fix): TD1 on grid 2 no longer counts the drag of SW-5 / SW-7 (down line 2 to SW-19) — every run closes; Σ line forces = 10 k own load', () => {
  const r = run(onAD);
  const cy = r.analysis.cases.find(c => c.dir === 'y' && c.kind === 'E');
  const bad = r.checks.filter(c => c.caseId === cy.id && !c.ok && !c.warn);
  assert.deepEqual(bad.map(c => c.msg), []);
  for (const m of cy.members) for (const run of m.runs) assert.ok(Math.abs(run.residual) < 1, m.name + ' residual ' + run.residual);
  // the 10 k of SW-5 / SW-7 goes down line 2 in Shear Wall Design (and SW-1 / SW-3 down line 3): not in these line forces
  assert.ok(near(lf(r, '1') + lf(r, '2') + lf(r, '3'), 10, 1e-3), [lf(r, '1'), lf(r, '2'), lf(r, '3')].join(' / '));
  // the drag itself is on the member diagram of grid 2 (from SW-5 / SW-7 to SW-19), closing there
  const m2 = cy.members.find(x => x.name === '2' && x.family === 'cross');
  assert.ok(Math.max(...m2.runs.map(q => Math.abs(q.max))) >= 9000, 'drag on grid 2');
});

// second state (2026-11-06): SW-5 / SW-7 end at the 2nd floor, offset line 1/2 = SW-9 + SW-10 (line 1) + SW-19 (20 ft, line 2)
{
  const sw = load('t96b-swd.json'), ro = load('t96b-roof.json'), fl = load('t96b-2nd.json');
  const swdB = getModule('shear_wall_design').migrate({ schemaVersion: sw.schemaVersion, inputs: clone(sw.inputs) }).inputs;
  const runB = () => calcAll(normalizeInputs(clone(fl.inputs)), { wallSource: swdExtract(swdB), gridSource: { grids: sharedGrids(ro.inputs) } });
  test('offset line 1/2 with walls above ending at the floor (bug fixed): SW-19 (20 ft) takes as much as SW-9 + SW-10 (2 × 10 ft) — shares settle, no warning', () => {
    const r = runB();
    assert.ok(!r.warnings.some(w => w.code === 'swd-group-rounds'), 'settled');
    const cy = r.analysis.cases.find(c => c.dir === 'y' && c.kind === 'E');
    const share = mark => cy.lines.flatMap(l => l.walls || []).find(w => w.mark === mark).share;
    assert.ok(near(share('SW-19'), share('SW-9') + share('SW-10'), 1), share('SW-19') + ' vs ' + (share('SW-9') + share('SW-10')));
    assert.ok(near(lf(r, '1') + lf(r, '2') + lf(r, '3'), 20, 1e-3), 'Σ = 10 own + 10 from SW-5 / SW-7');
    assert.ok(!r.checks.some(c => c.caseId === cy.id && !c.ok && !c.warn), r.checks.filter(c => c.caseId === cy.id && !c.ok).map(c => c.msg).join(' | '));
  });
  // DA's distribution = Shear Wall Design's (user 2026-11-06): DA line forces → SWD (as Update does) → SWD's own split
  const swdM = getModule('shear_wall_design');
  const roundTrip = def => {
    const rr = calcAll(normalizeInputs(clone(ro.inputs)), { wallSource: swdExtract(def) });
    const r = calcAll(normalizeInputs(clone(fl.inputs)), { wallSource: swdExtract(def), gridSource: { grids: sharedGrids(ro.inputs) } });
    const d2 = clone(def);
    for (const [name, res] of [['Roof', rr], ['2nd Floor', r]]) {
      const lv = d2.levels.find(l => l.name === name);
      for (const f of res.lineForces) { const line = d2.directions.flatMap(d => d.lines).find(l => l.id === f.swdLineId); line.levelLoads = { ...(line.levelLoads || {}), [lv.id]: { seismic: String(f.E), wind: '0' } }; }
    }
    const out = swdM.calc(d2);
    const walls = {};
    for (const d of out.perDirection) for (const l of d.perLine) for (const pl of l.perLevel) for (const w of pl.walls) walls[w.mark] = w;
    return { r, out, walls };
  };
  // nailing (user 2026-11-06): auto, and fixed per wall — different capacities inside the offset line
  const NAILS = [['auto', {}], ['SW-19 4", SW-9 / SW-10 6"', { 'SW-19': '4', 'SW-9': '6', 'SW-10': '6' }], ['SW-9 3", SW-10 6", SW-19 auto', { 'SW-9': '3', 'SW-10': '6' }]];
  for (const [nailTag, marks] of NAILS) for (const method of ['capacity', 'deflection']) test(`DA = SWD (${method} method on lines 1 / 2, nailing ${nailTag}): every 2nd-floor wall share (+ the walls above continuing down its line) equals SWD's after Update; equal v / capacity or equal δ in the offset line; base shear 30 k each way; transfer balance`, () => {
    const def = clone(swdB);
    for (const w of def.directions.flatMap(d => d.lines).flatMap(l => l.walls)) if (marks[w.mark] !== undefined) w.nailingPattern = marks[w.mark];
    if (method === 'deflection') for (const l of def.directions.flatMap(d => d.lines)) if (['1', '2'].includes(l.name)) l.distribution = 'deflection';
    const { r, out, walls } = roundTrip(def);
    assert.deepEqual(r.errors.map(e => e.code), []);
    for (const cs of r.analysis.cases.filter(c => c.kind === 'E')) for (const ln of cs.lines) {
      const T = (cs.above || []).filter(a => a.gridId === ln.gridId && a.kind === 'through').reduce((t, a) => t + a.V, 0);
      const tot = (ln.walls || []).reduce((t, w) => t + Math.max(0, w.share), 0);
      for (const w of ln.walls || []) assert.ok(near(walls[w.mark].shareExact_1E * 1000, w.share + (T ? T * w.share / tot : 0), 5), w.mark);
    }
    const g = ['SW-9', 'SW-10', 'SW-19'].map(m => walls[m]);
    if (method === 'capacity') { const v = g.map(w => w.unitShear_seismic / w.effectiveSeismicCap); assert.ok(Math.max(...v) - Math.min(...v) < 1e-3, 'equal v / capacity: ' + v); }
    else { const dl = g.map(w => w.deltaShare.E); assert.ok(Math.max(...dl) - Math.min(...dl) < 1e-3, 'equal δ: ' + dl); }
    for (const d of out.perDirection) {
      const base = d.perLine.reduce((t, l) => t + (l.perLevel.find(p => p.levelName === '2nd Floor') || { walls: [] }).walls.reduce((a, w) => a + w.shareExact_1E, 0), 0);
      assert.ok(near(base, 30, 0.01), d.dirName + ' base ' + base);
      const handed = d.perLine.flatMap(l => l.transfer || []).reduce((t, x) => t + x.E, 0);
      const took = r.transferIn.filter(t => t.kind === 'E' && d.perLine.some(l => l.lineId === t.swdLineId)).reduce((t, x) => t + x.V, 0);
      assert.ok(near(handed, took, 0.01), d.dirName + ' handed ' + handed + ' took ' + took);
    }
  });
}

console.log(passed + ' passed');
