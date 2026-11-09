// User test project 26998 "Cotoros Main Test" (tests/fixtures/da-user/t98-*.json): Roof + 2nd Floor + SWD, layout of
// 2026-11-09 (2nd Floor: SW-57 deleted — line 6 a wall-less collector into D2 / D10; west tab + strip one diaphragm on
// 9 / 5 with chord-step TD7; grid 9 ends at x 40, wall-less grid 9E taken by TD8; offset lines A/B, C/D, 2/3).
// Plan / findings: docs/diaphragm-analysis-plan-2026-11-06.md.
// - td-v13: SW-8 (B, y 54–57.5) runs 0.5 ft into TD1 — its part inside belongs to the TD's strut load P.
// - td-v14: SW-61 / SW-63 stand on line 2 at the ends of OP1, where line 2 is bridged (no sheathing either side) — the
//   member now counts walls on a bridged stretch (it skipped them while P counted them: line 2 −816 lb open).
// - TD9 of the saved item (x 66–80, load 9E) is not needed (the engine stops on it): removed here; with the user's save
//   without TD9 this is a no-op.
// Run: node tests/daCase26998.test.mjs
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
const swdItem = load('t98-swd.json'), roofItem = load('t98-roof.json'), flrItem = load('t98-2nd.json');
const swdOf = (mod = () => {}) => { const s = getModule('shear_wall_design').migrate({ schemaVersion: swdItem.schemaVersion, inputs: clone(swdItem.inputs) }).inputs; mod(s); return s; };
const swd = swdOf();
const roof = () => calcAll(normalizeInputs(clone(roofItem.inputs)), { wallSource: swdExtract(swd) });
function floor(mod = () => {}, s = swd) {
  const i = normalizeInputs(clone(flrItem.inputs));
  i.tds = i.tds.filter(t => t.mark !== 'TD9'); // saved without TD9 since 2026-11-09 22:03 (no-op)
  const g = n => i.grids.find(x => x.name === n).id;
  mod(i, g, m => i.tds.find(t => t.mark === m));
  return calcAll(i, { wallSource: swdExtract(s), gridSource: { grids: sharedGrids(roofItem.inputs) } });
}
const openRuns = (r, id) => {
  const c = r.analysis.cases.find(x => x.id === id);
  return c.members.flatMap(m => m.runs.filter(q => Math.abs(q.residual) > Math.max(30, 0.05 * Math.abs(q.max))).map(() => m.name));
};
const lf = (r, n) => (r.lineForces.find(l => l.line.trim() === n) || {}).E;
const sum = (r, names) => names.reduce((t, n) => t + (lf(r, n) || 0), 0);
const Y = ['A', 'B', 'C', 'D', 'E', 'G', 'H.3', 'J', 'M'], X = ['1', '2', '3', '5', '6', '8', '9', '10', '11'];
// Σ line forces = own F_x (20 k each way) + the walls of the story above that end at this floor (their 1.0E from SWD)
const transfer = (r, id) => (r.analysis.cases.find(x => x.id === id).above || []).filter(a => a.kind === 'transfer').reduce((t, a) => t + a.V, 0) / 1000;
const failing = (r, id) => r.checks.filter(c => c.caseId === id && !c.ok && !c.warn && c.code !== 'td').map(c => c.msg);

test('Roof: no errors, both directions close; Σ line forces 60 k each way', () => {
  const r = roof();
  assert.deepEqual(r.errors.map(e => e.code), []);
  assert.deepEqual([...failing(r, 'y-E'), ...failing(r, 'x-E')], []);
  assert.ok(near(sum(r, Y), 60, 0.01) && near(sum(r, ['2', '3', '5', '6', '8', '9']), 60, 0.01));
});

test('2nd Floor: no errors; both directions close — Σ line forces = 20 k own + walls ending here (y: SW-22, SW-9, SW-11 ≈ 25.1 k; x: SW-39 / 55 / 56 ≈ 22.8 k)', () => {
  const r = floor();
  assert.deepEqual(r.errors.map(e => e.code), []);
  assert.deepEqual(openRuns(r, 'y-E'), []);
  assert.deepEqual(openRuns(r, 'x-E'), []);
  assert.deepEqual([...failing(r, 'y-E'), ...failing(r, 'x-E')], []);
  assert.ok(near(sum(r, Y), 20 + transfer(r, 'y-E'), 0.02) && near(transfer(r, 'y-E'), 25.1, 0.2), sum(r, Y) + ' / ' + transfer(r, 'y-E'));
  assert.ok(near(sum(r, X), 20 + transfer(r, 'x-E'), 0.02) && near(transfer(r, 'x-E'), 22.8, 0.2), sum(r, X) + ' / ' + transfer(r, 'x-E'));
  assert.ok(near(lf(r, 'G'), 20.26, 0.1) && near(lf(r, 'B'), 5.49, 0.1) && near(lf(r, '5'), 24.24, 0.1), lf(r, 'G') + ' / ' + lf(r, 'B') + ' / ' + lf(r, '5'));
});

test('td-v13: TD1 P includes the part of SW-8 inside the TD; same shares as drawing TD1 from the end of SW-8 (y 57.5)', () => {
  const a = floor(), b = floor((i, g, T) => { T('TD1').y1 = '57.5'; });
  const td1 = a.analysis.tdRuns.find(t => t.caseId === 'y-E' && t.mark === 'TD1');
  assert.ok(/of the wall part inside the TD/.test(JSON.stringify(td1.how)));
  assert.deepEqual(openRuns(b, 'y-E'), []);
  for (const n of ['A', 'B', 'C', 'D']) assert.ok(near(lf(a, n), lf(b, n), 0.1), n + ': ' + lf(a, n) + ' / ' + lf(b, n));
});

test('td-v14: line 2 bridged over OP1 counts SW-61 / SW-63 on the bridge — the member closes and equals the TD5 strut load at x 33', () => {
  const r = floor();
  const c = r.analysis.cases.find(x => x.id === 'x-E');
  const m2 = c.members.find(m => m.name === '2' && m.family === 'cross');
  const run = m2.runs.find(q => q.from <= 33 && q.to >= 66);
  assert.ok(Math.abs(run.residual) <= Math.max(30, 0.05 * Math.abs(run.max)), String(run.residual)); // closes (was −816); not exact while the 2/3 shares do not settle (step 5)
  const onBridge = run.pieces.filter(p => p.strut && p.a >= 33 - 1e-6 && p.b <= 34.5 + 1e-6);
  assert.ok(onBridge.length && onBridge.some(p => Math.abs(p.qm) > 1), 'SW-61 acts on the bridged stretch');
  const td5 = r.analysis.tdRuns.find(t => t.caseId === 'x-E' && t.mark === 'TD5');
  const at33 = run.pieces.find(p => Math.abs(p.a - 33) < 1e-6).Na;
  assert.ok(near(Math.abs(at33), Math.abs(td5.P[0]), 30), at33 + ' vs ' + td5.P[0]);
});

test('2nd Floor along y without the A/B offset line (TD1 = strut C only) → closes as well; A takes SW-9 / SW-11 across D1 (7.07 k)', () => {
  const r = floor((i, g, T) => { i.wallLink.groups = i.wallLink.groups.filter(x => x.name !== 'A/B'); const t = T('TD1'); t.loads = t.loads.filter(l => l.gridId !== g('B')); });
  assert.deepEqual(openRuns(r, 'y-E'), []);
  assert.ok(near(sum(r, Y), 20 + transfer(r, 'y-E'), 0.02), String(sum(r, Y)));
  assert.ok(near(lf(r, 'A'), 7.07, 0.1), String(lf(r, 'A')));
});

test('open item 5: every offset line settles (no "did not settle"); the 2nd Floor needs no held nailing; the Roof 5/6 walls that alternate are held at the heavier and named', () => {
  const r = floor(), rr = roof();
  for (const x of [r, rr]) {
    assert.ok(!x.warnings.some(w => w.code === 'swd-group-rounds'), 'settled');
    for (const cs of x.analysis.cases) if (cs.offset && cs.offset.swdRounds) assert.ok(cs.offset.swdRounds.settled, cs.id);
  }
  assert.ok(!r.warnings.some(w => w.code === 'swd-group-nailing'), '2nd Floor: settles on the SWD own picks');
  const held = rr.warnings.filter(w => w.code === 'swd-group-nailing').map(w => w.msg).join(' | ');
  assert.ok(/SW-39/.test(held) && /SW-55/.test(held) && /SW-56/.test(held), held);
});

test('open item 5 (force from above not clamped): 2/3 takes 15.65 k from SW-35 on line 3; the floor moves 8.86 k off line 3 — the line-3 walls keep 6.79 k, the same demand / capacity as the line-2 walls', () => {
  const r = floor();
  assert.ok(near(lf(r, '3'), -8.86, 0.05) && near(lf(r, '2'), 10.58, 0.05), lf(r, '3') + ' / ' + lf(r, '2'));
  assert.ok(near(lf(r, '3') + 15.654, 6.79, 0.05), String(lf(r, '3') + 15.654));
  const total = lf(r, '2') + lf(r, '3') + 15.654 + 8.505;
  // SWD capacities at the settled nailing: SW-70 / 71 3244 / 3784 lb, SW-61 / 63 2140 each, SW-66 7360, SW-67 8096
  assert.ok(near((lf(r, '3') + 15.654) / total, (3244 + 3784) / (3244 + 3784 + 2140 * 2 + 7360 + 8096), 0.005), String(total));
});

// open item 6-A (2026-11-09): opt-in "each wall into the diaphragm under it" per line of walls above
const pointsAt6 = (r, mark) => { const c = r.analysis.cases.find(x => x.id === 'x-E'); const d = c.diaphragms.find(x => x.mark === mark);
  return Object.fromEntries((d.points || []).filter(p => Math.abs(p.at - 57) < 1e-6).map(p => [p.mark || 'line ' + p.line, p.F / 1000])); };
const line6 = flrItem.inputs.wallLink && 'ln-14'; // SWD line 6

test('6-A off (today): each wall above on grid 6 is shared by depth — SW-39 41.8 % D2 / 58.2 % D10', () => {
  const r = floor();
  assert.ok(near(pointsAt6(r, 'D2')['SW-39'], 3.25, 0.02) && near(pointsAt6(r, 'D10')['SW-39'], 4.53, 0.02));
});

test('6-A on (line 6): SW-39 only into D2, SW-55 / SW-56 only into D10; the collector of line 6 itself still by depth; Σ unchanged, both directions close', () => {
  const r = floor(i => { i.aboveCollectors = { ...(i.aboveCollectors || {}), [line6]: { own: true } }; });
  assert.deepEqual(r.errors.map(e => e.code), []);
  assert.deepEqual([...openRuns(r, 'y-E'), ...openRuns(r, 'x-E')], []);
  const d2 = pointsAt6(r, 'D2'), d10 = pointsAt6(r, 'D10');
  assert.ok(near(d2['SW-39'], 7.78, 0.02) && !('SW-39' in d10), JSON.stringify({ d2, d10 }));
  assert.ok(near(d10['SW-55'], 4.91, 0.02) && near(d10['SW-56'], 10.10, 0.02) && !('SW-55' in d2) && !('SW-56' in d2), JSON.stringify({ d2, d10 }));
  assert.ok(near(d2['line 6'], 0.29, 0.02) && near(d10['line 6'], 0.41, 0.02));
  assert.ok(near(sum(r, X), 20 + transfer(r, 'x-E'), 0.02));
  // the drag along grid 6 between the two diaphragms is small now (was ~2 k at x 33)
  const m6 = r.analysis.cases.find(x => x.id === 'x-E').members.find(m => m.name === '6' && m.family === 'cross');
  const at33 = m6.runs[0].pieces.find(p => Math.abs(p.a - 33) < 1e-6).Na;
  assert.ok(Math.abs(at33) < 500, String(at33));
});

test('6-A on: a wall above over no diaphragm spanning its grid → error above-no-diaphragm naming the switch; the case is held', () => {
  const r = floor(i => {
    i.aboveCollectors = { ...(i.aboveCollectors || {}), [line6]: { own: true } };
    i.diaphragms = i.diaphragms.filter(d => !(d.dir === 'x' && d.mark === 'D2')); // nothing under SW-39 now
  });
  assert.ok(r.errors.some(e => e.code === 'above-no-diaphragm' && /SW-39/.test(e.msg) && /under each wall/.test(e.msg)), r.errors.map(e => e.msg).join(' | '));
});

console.log(passed + ' passed');
