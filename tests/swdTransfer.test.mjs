// SWD transfer to the diaphragm below (user 2026-11-05, build step 4) on project 26997 "Horizontal Offset Walls"
// (tests/fixtures/da-user/hov-swd.json): roof story walls on lines 2 / B / C stop at the 2nd floor; line 3 continues.
// Only an SWD item linked to Diaphragm Analysis (ticked DA source) transfers; the same inputs unlinked calculate as today.
// Run: node tests/swdTransfer.test.mjs
import assert from 'assert/strict';
import fs from 'fs';
import { parseHTML } from 'linkedom';

if (!globalThis.document) {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window, document, Node: window.Node });
}
const { getModule } = await import('../src/modules/registry.js');
const { endsAtFloorIds, transferOn } = await import('../src/modules/shearWallCalc.js');
const { renderElevation, setElevationTransfer } = await import('../src/modules/shearWallElevation.js');

const swdMod = getModule('shear_wall_design');
const clone = v => JSON.parse(JSON.stringify(v));
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 5).join('\n       ')); process.exitCode = 1; }
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const item = JSON.parse(fs.readFileSync(new URL('./fixtures/da-user/hov-swd.json', import.meta.url), 'utf8'));
const lineByName = (inp, n) => inp.directions.flatMap(d => d.lines).find(l => l.name === n);
// the 26997 hand calc (plan doc §3): roof story 10 k on each of 2, B, C, 3; 2nd floor A = D = 15, 1 = 13.571, 3 = 6.429
function inputs({ linked = true } = {}) {
  const inp = swdMod.migrate({ schemaVersion: item.schemaVersion, inputs: clone(item.inputs) }).inputs;
  const [roof, flr] = inp.levels;
  const set = (n, lv, E) => { const l = lineByName(inp, n); l.levelLoads = { ...(l.levelLoads || {}), [lv.id]: { seismic: String(E), wind: '' } }; };
  for (const n of ['2', 'B', 'C', '3']) set(n, roof, 10);
  for (const n of ['2', 'B', 'C']) set(n, flr, 0);
  set('A', flr, 15); set('D', flr, 15); set('1', flr, 13.571); set('3', flr, 6.429);
  for (const n of ['1', 'A', 'D']) set(n, roof, 0);
  inp.loadType = 'seismic';
  inp.refs = { ...(inp.refs || {}) };
  if (linked) inp.refs.diaphragmSources = ['31d8ceda-7dc5-4522-8387-0beec0bcd6d6', '5a72b91d-2495-4e22-a055-12a4a5c2af19']; else delete inp.refs.diaphragmSources;
  return inp;
}
const lineOut = (out, n) => out.perDirection.flatMap(d => d.perLine).find(l => l.lineName === n);
const g2 = lo => lo.checks.find(c => c.id === 'G2');
const lvlOf = (lo, name) => lo.perLevel.find(p => p.levelName === name);

test('unlinked (today): line B\'s roof shear has no wall at the 2nd floor — G2 fails; the endsAtFloor flag is ignored', () => {
  const inp = inputs({ linked: false });
  assert.ok(!transferOn(inp));
  assert.equal(endsAtFloorIds(inp, lineByName(inp, 'B'), inp.levels).size, 0);
  const out = swdMod.calc(clone(inp));
  const B = lineOut(out, 'B');
  assert.equal(B.transfer, undefined);
  assert.ok(near(lvlOf(B, '2nd Floor').storyShear_1E, 10), 'the 10 k stays on line B');
  assert.ok(!g2(B).pass && g2(B).status !== 'pass', 'G2 fails as before');
  // a stray flag on an unlinked item changes nothing
  const flagged = clone(inp); lineByName(flagged, '3').walls.find(w => w.mark === 'SW-1').endsAtFloor = true;
  assert.deepEqual(swdMod.calc(clone(flagged)), out);
});

test('linked: lines 2 / B / C end at the 2nd floor (no wall below) — 10 k each to the diaphragm, 0 left on the line, G2 passes and says so', () => {
  const inp = inputs();
  const out = swdMod.calc(clone(inp));
  for (const n of ['2', 'B', 'C']) {
    const L = lineOut(out, n);
    assert.equal(L.transfer.length, 1, n);
    assert.equal(L.transfer[0].levelName, 'Roof'); assert.equal(L.transfer[0].belowName, '2nd Floor');
    assert.ok(near(L.transfer[0].E, 10), n + ' transfers 10 k');
    assert.ok(near(lvlOf(L, '2nd Floor').storyShear_1E, 0), n + ': nothing left on the line below');
    const c = g2(L);
    assert.ok(c.pass === true || c.status === 'pass', n + ' G2 passes');
    assert.ok(JSON.stringify(c).includes('transferred to the diaphragm at this floor'), n + ' G2 names the transfer');
  }
  // the continuing line 3 and the lines below are as before: 3 carries 10 (from above) + 6.429
  const L3 = lineOut(out, '3');
  assert.equal(L3.transfer, undefined);
  assert.ok(near(lvlOf(L3, '2nd Floor').storyShear_1E, 16.429, 0.006));
  // equilibrium of the building: base shear = 20 (roof) + 10 (2nd floor) = 30 k over lines 1 / 3 / A / D
  const base = ['1', '3', 'A', 'D'].reduce((t, n) => t + lvlOf(lineOut(out, n), '2nd Floor').storyShear_1E, 0)
    + ['2', 'B', 'C'].reduce((t, n) => t + lvlOf(lineOut(out, n), '2nd Floor').storyShear_1E, 0);
  assert.ok(near(base, 13.571 + 16.429 + 15 + 15, 0.02), 'no story shear counted twice: ' + base);
});

test('linked, mixed line: SW-1 on line 3 ticked "ends at this floor" — its share goes to the diaphragm, SW-3 still goes down the line', () => {
  const inp = inputs();
  lineByName(inp, '3').walls.find(w => w.mark === 'SW-1').endsAtFloor = true;
  const out = swdMod.calc(clone(inp));
  const L3 = lineOut(out, '3');
  const roof = lvlOf(L3, 'Roof');
  const sw1 = roof.walls.find(w => w.mark === 'SW-1').shareExact_1E;
  assert.ok(sw1 > 0 && sw1 < 10);
  assert.ok(near(L3.transfer[0].E, sw1), 'transfer = SW-1 share');
  assert.deepEqual(L3.transfer[0].walls, ['SW-1']);
  assert.ok(near(lvlOf(L3, '2nd Floor').storyShear_1E, 16.429 - sw1, 0.006), 'the line below carries the rest (results rounded to 0.01)');
  assert.ok(g2(L3).pass === true || g2(L3).status === 'pass');
});

test('linked, mixed line with the deflection method: the transfer settles (shares and story shear consistent)', () => {
  const inp = inputs();
  const l3 = lineByName(inp, '3');
  l3.walls.find(w => w.mark === 'SW-1').endsAtFloor = true;
  l3.distribution = 'deflection';
  const out = swdMod.calc(clone(inp));
  const L3 = lineOut(out, '3');
  const sw1 = lvlOf(L3, 'Roof').walls.find(w => w.mark === 'SW-1').shareExact_1E;
  assert.ok(near(L3.transfer[0].E, sw1, 1e-4));
  assert.ok(near(lvlOf(L3, '2nd Floor').storyShear_1E, 16.429 - sw1, 0.006));
});

test('UI: wall panel — "ends at the 2nd Floor floor" text for SW-11 (no wall below), a tick for SW-1 (mixed line), nothing on 1st-story walls; marker on the elevation', () => {
  const inp = inputs();
  const panelFor = (lineName, mark) => {
    const line = lineByName(inp, lineName);
    const w = line.walls.find(x => x.mark === mark);
    const c = document.createElement('div');
    setElevationTransfer(line, () => endsAtFloorIds(inp, line, inp.levels));
    const cb = { transferInfo(wall) {
      const i = inp.levels.findIndex(l => l.id === wall.levelId), below = inp.levels[i + 1];
      if (!below) return null;
      return { mode: line.walls.some(x => x.levelId === below.id) ? 'tick' : 'auto', belowName: below.name };
    } };
    const h = renderElevation(c, line, inp.levels, inp.wallDLTypes || [], cb);
    h.drawSVG();
    const find = c.querySelector('select');
    for (const o of find.querySelectorAll('option')) { if (o.getAttribute('value') === 'wall:' + w.id) o.setAttribute('selected', ''); else o.removeAttribute('selected'); }
    find.dispatchEvent(new window.Event('change'));
    return { c, row: c.querySelector('[data-transferrow]'), line, w };
  };
  const a = panelFor('B', 'SW-11');
  assert.ok(a.row && /no wall below/.test(a.row.textContent) && !a.row.querySelector('input'));
  assert.ok(a.c.querySelector('[data-endsatfloor="' + a.w.id + '"]'), 'marker under SW-11');
  const b = panelFor('3', 'SW-1');
  const tick = b.row.querySelector('input[type=checkbox]');
  assert.ok(tick && !tick.checked);
  assert.ok(!b.c.querySelector('[data-endsatfloor]'), 'no marker before the tick');
  tick.checked = true; tick.dispatchEvent(new window.Event('change'));
  assert.equal(b.w.endsAtFloor, true);
  assert.ok(b.c.querySelector('[data-endsatfloor="' + b.w.id + '"]'), 'marker after the tick');
  const d = panelFor('3', 'SW-2');
  assert.equal(d.row, null, '1st-story wall: no transfer row');
});

console.log(passed + ' passed');
