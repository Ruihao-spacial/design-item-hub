// DA transfer from the walls above (user 2026-11-05, build step 6) — the 26997 hand calc of
// docs/diaphragm-analysis-offset-transfer-plan-2026-11-05.md §3. 2nd floor x 0–70, y 0–100, F_x = 10 k; Roof-story walls
// (SWD, 10 k on each of lines 2 / B / C / 3, equal split) — 2 / B / C end at the 2nd floor, 3 continues.
// Run: node tests/daTransfer.test.mjs
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
const { newDiaphragm } = await import('../src/modules/tdModel.js');
const { calcAll } = await import('../src/modules/diaphragmAnalysis.js');
const editor = await import('../src/modules/tdPlanEditor.js');
const { memberN } = await import('../src/modules/tdNet.js');

const swdMod = getModule('shear_wall_design');
const clone = v => JSON.parse(JSON.stringify(v));
const load = f => JSON.parse(fs.readFileSync(new URL('./fixtures/da-user/' + f, import.meta.url), 'utf8'));
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 6).join('\n       ')); process.exitCode = 1; }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const swdItem = load('hov-swd.json'), flrItem = load('hov-2nd.json');

// SWD: DA ticked, grids adopted, every line starting at grid 1 / grid A; roof story 10 k on 2 / B / C / 3
function swdDef(mod = () => {}) {
  const inp = swdMod.migrate({ schemaVersion: swdItem.schemaVersion, inputs: clone(swdItem.inputs) }).inputs;
  inp.refs = { ...(inp.refs || {}), diaphragmSources: ['roof', 'flr'] };
  inp.planLink = { sourceId: 'roof', grids: [], lines: {}, extents: {} };
  inp.loadType = 'seismic';
  const [roof] = inp.levels;
  for (const d of inp.directions) for (const l of d.lines) {
    l.planOrigin = '0';
    l.levelLoads = { [roof.id]: { seismic: ['2', 'B', 'C', '3'].includes(l.name) ? '10' : '0', wind: '' } };
  }
  mod(inp);
  return inp;
}
// DA 2nd floor with one diaphragm per direction over the whole floor
function daInputs() {
  const inp = normalizeInputs(clone(flrItem.inputs));
  const g = n => inp.grids.find(x => x.name === n).id;
  inp.grids.forEach(x => { x.from = ''; x.to = ''; });
  inp.diaphragms = [
    newDiaphragm('D1', 'x', [{ x1: 0, x2: 70, y1: 0, y2: 100 }], [g('A'), g('D')]),
    newDiaphragm('D2', 'y', [{ x1: 0, x2: 70, y1: 0, y2: 100 }], [g('1'), g('3')]),
  ];
  return inp;
}
const run = (def = swdDef()) => calcAll(daInputs(), { wallSource: swdExtract(def) });
const lf = (r, name) => r.lineForces.find(l => l.name === name || l.lineName === name) || r.lineForces.find(l => l.swdLineId === lineId(name));
const lineId = name => swdDef().directions.flatMap(d => d.lines).find(l => l.name === name).id;
const lfE = (r, name) => { const x = r.lineForces.find(l => l.swdLineId === lineId(name)); return x ? x.E : null; };
const caseOf = (r, dir) => r.analysis.cases.find(c => c.dir === dir && c.kind === 'E');
const memberMax = (cs, name) => { const m = cs.members.find(x => x.name === name && x.family === 'cross'); return m ? Math.max(...m.runs.map(r => Math.abs(r.max))) : null; };

test('the plan is clean and every case balances and closes', () => {
  const r = run();
  assert.deepEqual(r.errors.map(e => e.code), []);
  const bad = r.checks.filter(c => !c.ok && !c.warn);
  assert.deepEqual(bad.map(c => c.msg), []);
  assert.ok(r.checks.some(c => c.code === 'equilibrium' && c.ok));
});

test('load along x: walls above on B / C (10 k each) → line A = D = 15 k (5 own + 8 + 2); line forces balance 10 + 20', () => {
  const r = run();
  assert.ok(near(lfE(r, 'A'), 15, 1e-3), 'A ' + lfE(r, 'A'));
  assert.ok(near(lfE(r, 'D'), 15, 1e-3), 'D ' + lfE(r, 'D'));
  assert.ok(!lfE(r, 'B') && !lfE(r, 'C'), 'B / C take nothing at this level');
  const cs = caseOf(r, 'x');
  const pts = cs.diaphragms.flatMap(d => d.points).filter(p => p.ext);
  assert.deepEqual(pts.map(p => p.mark).sort(), ['SW-11', 'SW-12', 'SW-13', 'SW-14']);
  assert.ok(near(pts.reduce((t, p) => t + Math.abs(p.F), 0), 20000, 1e-6));
});

test('load along x: shear at A = 15 000 / 70 = 214.3 plf; distributor on B max 5.07 k (x 34.5), on C 5.29 k (x 33); collector on A max 8.36 k (x 31); all close', () => {
  const cs = caseOf(run(), 'x');
  const d = cs.diaphragms[0];
  const atA = d.intervals[0];
  assert.ok(near(Math.abs(atA.Va) / 70, 214.29, 0.05), 'v at A ' + Math.abs(atA.Va) / 70);
  assert.ok(near(memberMax(cs, 'B'), 5071.4, 1), 'distributor B ' + memberMax(cs, 'B'));
  // C: SW-13 x 10–20, SW-14 x 23–33 (not 24.5 as SW-12): −1429 → +2143 → +1714 → +5286 at x 33 → 0 at x 70
  assert.ok(near(memberMax(cs, 'C'), 5285.7, 1), 'distributor C ' + memberMax(cs, 'C'));
  assert.ok(near(memberMax(cs, 'A'), 8357.1, 1), 'collector A ' + memberMax(cs, 'A'));
  for (const m of cs.members) for (const run of m.runs) assert.ok(Math.abs(run.residual) < 1, m.name + ' residual ' + run.residual);
});

test('load along y: line 2 (10 k) ends here → line 1 = 13.571 k, line 3 = 6.429 k (diaphragm only; SWD adds the 10 k of line 3 above); line 3 drag = 0 (stacked)', () => {
  const r = run();
  assert.ok(near(lfE(r, '1'), 5 + 10 * 60 / 70, 1e-3), '1 ' + lfE(r, '1'));
  assert.ok(near(lfE(r, '3'), 5 + 10 * 10 / 70, 1e-3), '3 ' + lfE(r, '3'));
  const cs = caseOf(r, 'y');
  // line 3: SW-1 / SW-3 (through) stand over SW-2 / SW-4: the walls above enter and leave over the same length
  const m3 = cs.members.find(x => x.name === '3' && x.family === 'cross');
  for (const run of m3.runs) assert.ok(Math.abs(run.residual) < 1);
  for (const m of cs.members) for (const run of m.runs) assert.ok(Math.abs(run.residual) < 1, m.name + ' residual ' + run.residual);
});

test('through wall not stacked: SW-1 moved 5 ft along line 3 → a drag on line 3 at this floor, still closing; line forces unchanged', () => {
  const r0 = run();
  const def = swdDef(inp => { const w = inp.directions.flatMap(d => d.lines).find(l => l.name === '3').walls.find(x => x.mark === 'SW-1'); w.position = String(Number(w.position) + 5); });
  const r = run(def);
  assert.ok(near(lfE(r, '3'), lfE(r0, '3'), 1e-6));
  const m3 = caseOf(r, 'y').members.find(x => x.name === '3' && x.family === 'cross');
  const m30 = caseOf(r0, 'y').members.find(x => x.name === '3' && x.family === 'cross');
  assert.ok(Math.max(...m3.runs.map(x => Math.abs(x.max))) > Math.max(...m30.runs.map(x => Math.abs(x.max))) + 100, 'drag appears');
  for (const run of m3.runs) assert.ok(Math.abs(run.residual) < 1);
});

test('B4: DA reports what it took from each wall above (transferIn) = what SWD hands over at this floor', () => {
  const def = swdDef();
  const r = run(def);
  const took = r.transferIn.filter(t => t.kind === 'E');
  assert.deepEqual(took.map(t => t.mark).sort(), ['SW-11', 'SW-12', 'SW-13', 'SW-14', 'SW-5', 'SW-7']);
  const swdOut = swdMod.calc(clone(def));
  const handed = swdOut.perDirection.flatMap(d => d.perLine).flatMap(l => l.transfer || []).reduce((t, x) => t + x.E, 0);
  assert.ok(near(took.reduce((t, x) => t + x.V, 0), handed, 1e-6), 'DA ' + took.reduce((t, x) => t + x.V, 0) + ' / SWD ' + handed);
  assert.ok(near(handed, 30, 1e-6));
});

test('a wall above outside every diaphragm → above-no-diaphragm error (its force cannot be carried)', () => {
  const inp = daInputs();
  inp.diaphragms[0].parts = [{ id: inp.diaphragms[0].id + '-p1', x1: '0', x2: '70', y1: '30', y2: '100' }]; // B (y 20) outside
  inp.diaphragms[0].supports = [inp.grids.find(x => x.name === 'C').id, inp.grids.find(x => x.name === 'D').id];
  const r = calcAll(inp, { wallSource: swdExtract(swdDef()) });
  assert.ok([...r.errors, ...r.warnings].some(e => e.code === 'above-no-diaphragm' && /SW-11/.test(e.msg)));
});

{
  const { crossForce } = await import('../src/modules/tdMembers.js');
  const { memberN } = await import('../src/modules/tdNet.js');
  test('regression: crossForce on grid 2 (walls above SW-5 / SW-7) equals the member N at y 20 and y 80', () => {
    const r = run();
    const cs = caseOf(r, 'y');
    const inp = daInputs();
    const g2 = { id: inp.grids.find(x => x.name === '2').id, at: 10 };
    const m = cs.members.find(x => x.name === '2' && x.family === 'cross');
    for (const y of [20, 80]) {
      const cf = crossForce(cs, g2, y);
      assert.ok(cf && near(Math.abs(cf.N), Math.abs(memberN(m, y)), 1), 'y ' + y + ': crossForce ' + (cf && cf.N) + ' / member ' + memberN(m, y));
    }
  });
}

// ---- step 7: force levels with the walls above
const { scaleCase } = await import('../src/modules/tdViews.js');
const { renderAnalysis } = await import('../src/modules/tdViews.js');
const { planWithLinks } = await import('../src/modules/diaphragmAnalysis.js');
function runLv(level = {}, def = swdDef()) {
  const inp = daInputs();
  Object.assign(inp.level, level);
  return { r: calcAll(inp, { wallSource: swdExtract(def) }), inp, def };
}
const vA = cs => Math.abs(cs.diaphragms[0].intervals[0].Va) / 70; // plf at A (load along x)

test('diaphragm level = k_D·own + Ω₀·walls above: at A 1.2 × 71.43 + 2.5 × 142.86 = 442.86 plf; +25 % → 532.14; members close', () => {
  const { r } = runLv({ diaphragmFactor: '1.2', transferOmega: '2.5' });
  assert.equal(r.forceLevels.transfer, 2.5);
  const d = r.levelD.find(c => c.dir === 'x');
  assert.ok(near(vA(scaleCase(d, 1.2)), 1.2 * 5000 / 70 + 2.5 * 10000 / 70, 0.01), 'D ' + vA(scaleCase(d, 1.2)));
  for (const m of d.members) for (const run of m.runs) assert.ok(Math.abs(run.residual) < 1, m.name);
  const r2 = runLv({ diaphragmFactor: '1.2', transferOmega: '2.5', transferIncrease: true }).r;
  assert.equal(r2.forceLevels.transfer, 3.125);
  assert.ok(near(vA(scaleCase(r2.levelD.find(c => c.dir === 'x'), 1.2)), 1.2 * 5000 / 70 + 3.125 * 10000 / 70, 0.01));
  // 1.0E and the line forces to SWD are not changed by the factors
  assert.deepEqual(r2.lineForces, run().lineForces);
});

test('collector level = k_C × (own + walls above): at A 1.68 × 214.29; collector A 1.68 × 8.36 k', () => {
  const { r } = runLv({ collectorFactor: '1.68' });
  const c = scaleCase(caseOf(r, 'x'), 1.68);
  assert.ok(near(vA(c), 1.68 * 15000 / 70, 0.01));
  assert.ok(near(memberMax(c, 'A'), 1.68 * 8357.14, 2));
});

test('Ω₀ blank = the linked Shear Wall Design item\'s Ω₀; the diaphragm-level run is not stored (not in the saved outputs)', () => {
  const def = swdDef(inp => { inp.omega0 = '3'; });
  const { r } = runLv({}, def);
  assert.equal(r.forceLevels.omega0, 3); assert.equal(r.forceLevels.omega0From, 'Shear Wall Design');
  assert.ok(Array.isArray(r.levelD) && r.levelD.length);
  assert.ok(!('levelD' in JSON.parse(JSON.stringify(r))), 'levelD is not saved');
});

test('Analysis tab: the diaphragm level shows own × k_D + walls above × Ω₀, and the walls-above table at that level', () => {
  const { r, inp, def } = runLv({ diaphragmFactor: '1.2', transferOmega: '2.5' });
  const plan = planWithLinks(inp, { wallSource: swdExtract(def) }).plan;
  const cs = caseOf(r, 'x');
  const mk = level => renderAnalysis(plan, r, { id: cs.id, level, set() {}, setLevel() {}, setView() {}, view: 1 });
  const d = mk('D');
  assert.match(d.querySelector('.td-forces-shown').textContent, /own level × k_D 1\.2 \+ walls above \(SW-11, SW-12, SW-13, SW-14\) × Ω₀ 2\.5/);
  const rows = [...d.querySelectorAll('table[data-abovevalues="D"] tr')].slice(1);
  assert.equal(rows.length, 4);
  const sw11 = rows.find(x => /SW-11/.test(x.textContent)).querySelectorAll('td');
  assert.equal(sw11[3].textContent, '5,000'); assert.equal(sw11[4].textContent, '12,500'); assert.equal(sw11[5].textContent, '1,250');
  assert.match(mk('E').querySelector('.td-forces-shown').textContent, /own level .* \+ walls of the story above/);
});

test('SWD transfer balance (B4): the Loading panel shows what SWD hands over at the 2nd floor and what DA - 2nd Floor took — ✓', () => {
  const def = swdDef();
  const { r } = runLv({}, def);
  const items = [{ id: 'flr', type: 'diaphragm_analysis', custom_name: 'DA - 2nd Floor', inputs: { level: { name: '2nd Floor' } }, outputs: { level: '2nd Floor', transferIn: r.transferIn, lineForces: r.lineForces } },
    { id: 'roof', type: 'diaphragm_analysis', custom_name: 'DA - Roof', inputs: { level: { name: 'Roof' } }, outputs: { level: 'Roof', lineForces: [] } }];
  const c = document.createElement('div');
  swdMod.renderForm(c, clone(def), () => {}, items, () => {});
  const tb = c.querySelector('[data-transferbalance]');
  assert.ok(tb, 'balance shown');
  assert.match(tb.textContent, /2nd Floor: handed over 30\.00 k \(lines 2, B, C\) · DA - 2nd Floor took 30\.00 k ✓/);
  // unlinked: nothing
  const plain = clone(def); delete plain.refs.diaphragmSources;
  const c2 = document.createElement('div');
  swdMod.renderForm(c2, plain, () => {}, items, () => {});
  assert.equal(c2.querySelector('[data-transferbalance]'), null);
});

// ---- option 2 (user 2026-11-05): collector from–to on a line of walls above; the user's 26997 model (load along y split
// into D3 y 0–20 / D2 20–80 / D1 80–100 on 1–3; SW-7 y 20–30, SW-5 y 35.5–45.5 on line 2)
function userModel(collector) {
  const def = swdDef(inp => { const l2 = inp.directions.flatMap(d => d.lines).find(l => l.name === '2');
    l2.walls.find(w => w.mark === 'SW-7').position = '20'; l2.walls.find(w => w.mark === 'SW-5').position = '35.5'; });
  const inp = daInputs();
  const g = n => inp.grids.find(x => x.name === n).id;
  inp.diaphragms = inp.diaphragms.filter(d => d.dir !== 'y');
  for (const [m, y1, y2] of [['D3', 0, 20], ['D2', 20, 80], ['D1', 80, 100]]) inp.diaphragms.push(newDiaphragm(m, 'y', [{ x1: 0, x2: 70, y1, y2 }], [g('1'), g('3')]));
  const l2 = def.directions.flatMap(d => d.lines).find(l => l.name === '2').id;
  if (collector) inp.aboveCollectors = { [l2]: { fromId: g(collector[0]), toId: g(collector[1]) } };
  return { r: calcAll(inp, { wallSource: swdExtract(def) }), inp, def };
}
const dg = (cs, m) => cs.diaphragms.find(d => d.mark === m);

test('option 2: full depth (blank) = today — the 10 k of line 2 shared by depth 20 / 60 / 20 %; distributor on 2 from A to D, max 5.45 k', () => {
  const cs = caseOf(userModel(null).r, 'y');
  const ext = m => dg(cs, m).points.filter(p => p.ext).reduce((t, p) => t + Math.abs(p.F), 0);
  assert.ok(near(ext('D3'), 2000, 1e-6) && near(ext('D2'), 6000, 1e-6) && near(ext('D1'), 2000, 1e-6));
  assert.ok(near(memberMax(cs, '2'), 5450, 1));
});

test('option 2: collector B–C on line 2 → all 10 k into D2 (R at line 1 = 3 + 8.571 k), D3 / D1 only their own load; line 1 still 13.571 k', () => {
  const { r } = userModel(['B', 'C']);
  assert.deepEqual(r.errors.map(e => e.code), []);
  const cs = caseOf(r, 'y');
  const ext = m => dg(cs, m).points.filter(p => p.ext).reduce((t, p) => t + Math.abs(p.F), 0);
  assert.ok(near(ext('D2'), 10000, 1e-6) && ext('D3') === 0 && ext('D1') === 0);
  const R1 = m => Math.abs(dg(cs, m).supports.find(s => s.name === '1').R);
  assert.ok(near(R1('D2'), 3000 + 10000 * 60 / 70, 0.01), 'D2 at 1: ' + R1('D2'));
  assert.ok(near(R1('D3'), 1000, 0.01) && near(R1('D1'), 1000, 0.01));
  assert.ok(near(lfE(r, '1'), 13.571, 1e-3) && near(lfE(r, '3'), 6.429, 1e-3));
  // D2 shear at line 1 = 11 571 / 60 = 192.9 plf (full depth: 136)
  assert.ok(near(Math.abs(dg(cs, 'D2').intervals[0].Va) / 60, 192.86, 0.05));
});

test('option 2: the collector on 2 runs B → C only: 166.7 plf into D2, 500 plf from each wall → max 5.75 k at y 45.5; nothing beyond B / C; all runs close', () => {
  const cs = caseOf(userModel(['B', 'C']).r, 'y');
  const m = cs.members.find(x => x.name === '2' && x.family === 'cross');
  const big = m.runs.filter(run => Math.abs(run.max) > 1);
  assert.equal(big.length, 1);
  assert.ok(near(Math.abs(big[0].max), 5750, 1) && near(big[0].maxAt, 45.5, 0.01), big[0].max + ' @ ' + big[0].maxAt);
  assert.ok(memberN(m, 10) === null || Math.abs(memberN(m, 10)) < 1, 'nothing at y 10');
  assert.ok(memberN(m, 90) === null || Math.abs(memberN(m, 90)) < 1, 'nothing at y 90');
  for (const mm of cs.members) for (const run of mm.runs) assert.ok(Math.abs(run.residual) < 1, mm.name + ' residual ' + run.residual);
  // chords B / C now carry D2's larger moment against D3's / D1's (≈ 0 with the full depth)
  const chordMax = n => Math.max(...cs.members.filter(x => x.name === n && x.family === 'chord').flatMap(x => x.runs.map(run => Math.abs(run.max))));
  assert.ok(chordMax('B') > 1000 && chordMax('C') > 1000, 'B ' + chordMax('B') + ' / C ' + chordMax('C'));
});

test('option 2 checks: a collector end inside a diaphragm (one diaphragm A–D) → above-collector-inside; a wall off the collector → above-collector-short', () => {
  // one diaphragm A–D along y: B–C ends inside it
  const def = swdDef(inp => { const l2 = inp.directions.flatMap(d => d.lines).find(l => l.name === '2');
    l2.walls.find(w => w.mark === 'SW-7').position = '20'; l2.walls.find(w => w.mark === 'SW-5').position = '35.5'; });
  const inp = daInputs();
  const g = n => inp.grids.find(x => x.name === n).id;
  inp.aboveCollectors = { [def.directions.flatMap(d => d.lines).find(l => l.name === '2').id]: { fromId: g('B'), toId: g('C') } };
  const r = calcAll(inp, { wallSource: swdExtract(def) });
  const e = [...r.errors, ...r.warnings].find(x => x.code === 'above-collector-inside');
  assert.ok(e && /D2/.test(e.msg) && /B–C/.test(e.msg), e && e.msg);
  // collector A–B in the split model: the walls (y 20–45.5) are not on it
  const r2 = userModel(['A', 'B']).r;
  assert.ok(r2.errors.some(x => x.code === 'above-collector-short' && /SW-5/.test(x.msg)));
});

test('user 26997 (B / C collector 2–3 on the single x diaphragm): a plan error naming the fix, case held from SWD, no open runs; split at grid 2 → closes, A = D = 15 k', () => {
  const def = swdDef();
  const ids = n => def.directions.flatMap(d => d.lines).find(l => l.name === n).id;
  const mk = split => {
    const inp = daInputs();
    const g = n => inp.grids.find(x => x.name === n).id;
    inp.aboveCollectors = { [ids('B')]: { fromId: g('2'), toId: g('3') }, [ids('C')]: { fromId: g('2'), toId: g('3') } };
    if (split) {
      inp.diaphragms = inp.diaphragms.filter(d => d.dir !== 'x');
      inp.diaphragms.push(newDiaphragm('DX1', 'x', [{ x1: 0, x2: 10, y1: 0, y2: 100 }], [g('A'), g('D')]));
      inp.diaphragms.push(newDiaphragm('DX2', 'x', [{ x1: 10, x2: 70, y1: 0, y2: 100 }], [g('A'), g('D')]));
    }
    return calcAll(inp, { wallSource: swdExtract(def) });
  };
  const bad = mk(false);
  const errs = bad.errors.filter(e => e.code === 'above-collector-inside');
  assert.equal(errs.length, 2, 'one per line (B, C), as a plan error');
  assert.match(errs[0].msg, /SW-11, SW-12/); assert.match(errs[0].msg, /Split that diaphragm at the collector ends/);
  assert.equal(bad.status, 'fail');
  const cx = caseOf(bad, 'x');
  assert.ok(bad.checks.some(c => c.caseId === cx.id && c.code === 'failed' && /cannot be placed/.test(c.msg)));
  assert.equal(lfE(bad, 'A'), null, 'held from SWD');
  for (const m of cx.members) for (const run of m.runs) assert.ok(Math.abs(run.residual) < 1, 'no open run on ' + m.name);
  const ok = mk(true);
  assert.deepEqual(ok.errors.map(e => e.code), []);
  assert.ok(near(lfE(ok, 'A'), 15, 1e-3) && near(lfE(ok, 'D'), 15, 1e-3));
  const c2 = caseOf(ok, 'x');
  for (const m of c2.members) for (const run of m.runs) assert.ok(Math.abs(run.residual) < 1, m.name);
  // B: SW-11 x 10–20, SW-12 x 24.5–34.5 into DX2 (depth 60): 166.7 plf → max 5.92 k at x 34.5 (as the roof collector)
  assert.ok(near(memberMax(c2, 'B'), 5916.7, 1), 'B ' + memberMax(c2, 'B'));
});

test('collector end on a diaphragm edge with no grid (user 2026-11-05): "edge of D2 / D1 (y 50)" offered; B → that edge puts the 10 k into D2 (y 20–50) only; closes', () => {
  const def = swdDef(inp => { const l2 = inp.directions.flatMap(d => d.lines).find(l => l.name === '2');
    l2.walls.find(w => w.mark === 'SW-7').position = '20'; l2.walls.find(w => w.mark === 'SW-5').position = '35.5'; });
  const inp = daInputs();
  const g = n => inp.grids.find(x => x.name === n).id;
  inp.diaphragms = inp.diaphragms.filter(d => d.dir !== 'y');
  for (const [m, y1, y2] of [['D3', 0, 20], ['D2', 20, 50], ['D1', 50, 100]]) inp.diaphragms.push(newDiaphragm(m, 'y', [{ x1: 0, x2: 70, y1, y2 }], [g('1'), g('3')]));
  const { plan } = planWithLinks(inp, { wallSource: swdExtract(def) });
  const { renderPlanEditor, newEditorState } = editor;
  const st = newEditorState(); st.page = 'walls';
  const c = document.createElement('div');
  c.appendChild(renderPlanEditor({ inputs: inp, plan, errors: [], state: st, refresh() {}, wallsLinked: true }));
  const toSel = c.querySelector('select[data-collector="2:to"]');
  const texts = [...toSel.querySelectorAll('option')].map(o => o.textContent);
  assert.ok(texts.includes('edge of D2 / D1 (y 50)'), texts.join(' | '));
  assert.ok(texts.some(t => /^B \(20\) — edge of D3 \/ D2$/.test(t)), 'a grid on an edge is labelled with it: ' + texts.join(' | '));
  const choose = (sel, re) => { for (const o of sel.querySelectorAll('option')) { if (re.test(o.textContent)) o.setAttribute('selected', ''); else o.removeAttribute('selected'); } sel.dispatchEvent(new window.Event('change')); };
  choose(c.querySelector('select[data-collector="2:from"]'), /^B \(20\)/);
  choose(toSel, /^edge of D2 \/ D1/);
  const l2 = def.directions.flatMap(d => d.lines).find(l => l.name === '2').id;
  assert.equal(inp.aboveCollectors[l2].fromId, g('B')); assert.equal(Number(inp.aboveCollectors[l2].toAt), 50);
  const r = calcAll(inp, { wallSource: swdExtract(def) });
  assert.deepEqual(r.errors.map(e => e.code), []);
  const cs = caseOf(r, 'y');
  const ext = m => dg(cs, m).points.filter(p => p.ext).reduce((t, p) => t + Math.abs(p.F), 0);
  assert.ok(near(ext('D2'), 10000, 1e-6) && ext('D1') === 0 && ext('D3') === 0);
  for (const mm of cs.members) for (const run of mm.runs) assert.ok(Math.abs(run.residual) < 1, mm.name + ' residual ' + run.residual);
  assert.equal(r.wallsAbove.walls.find(w => w.mark === 'SW-5').collector.to, 'y 50');
});

test('option 2 UI: "Collector from / to" per line under the walls-above table; drawn on the plan; blank keeps nothing stored', () => {
  const { inp, def } = userModel(null);
  const { plan } = planWithLinks(inp, { wallSource: swdExtract(def) });
  const { renderPlanEditor, drawPlan, newEditorState } = editor;
  const st = newEditorState(); st.page = 'walls';
  const c = document.createElement('div');
  c.appendChild(renderPlanEditor({ inputs: inp, plan, errors: [], state: st, refresh() {}, wallsLinked: true }));
  const rows = [...c.querySelectorAll('table[data-collectortable] tr')].slice(1).map(x => x.querySelector('td').textContent);
  assert.deepEqual(rows.sort(), ['2', 'B', 'C'], 'one row per line of walls that end here');
  const sel = c.querySelector('select[data-collector="2:from"]');
  for (const o of sel.querySelectorAll('option')) { if (o.textContent.startsWith('B ')) o.setAttribute('selected', ''); else o.removeAttribute('selected'); }
  sel.dispatchEvent(new window.Event('change'));
  const l2 = def.directions.flatMap(d => d.lines).find(l => l.name === '2').id;
  assert.equal(plan.gridById.get(inp.aboveCollectors[l2].fromId).name, 'B');
  // with both ends: drawn
  const done = userModel(['B', 'C']);
  const p2 = planWithLinks(done.inp, { wallSource: swdExtract(done.def) }).plan;
  assert.ok(drawPlan(p2, newEditorState(), []).svg.querySelector('[data-collector="2"]'));
  assert.equal(drawPlan(plan, newEditorState(), []).svg.querySelector('[data-collector]'), null, 'nothing drawn for full depth');
});

console.log(passed + ' passed');
