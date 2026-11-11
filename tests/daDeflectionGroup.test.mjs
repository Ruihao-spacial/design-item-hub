// Offset line + SWD deflection distribution (bug 0, user test 26998, 2026-11-09; plan
// docs/diaphragm-analysis-plan-2026-11-09-open-items.md, option 0-A). A wall SWD cannot design at its trial share has no
// deflection (_deltaAt null); the equal-δ solver read null as 0 (an infinitely stiff wall) and gave it the whole group
// (Roof 2/3: SW-65 took 22.8 k, SW-35 — the stiffest wall — 0). Now that round is split by capacity (swd-group-defl) and
// equal δ is used again once every wall has a deflection. Run: node tests/daDeflectionGroup.test.mjs
import assert from 'assert/strict';
import fs from 'fs';
import { parseHTML } from 'linkedom';

if (!globalThis.document) {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window, document, Node: window.Node });
}
const { getModule } = await import('../src/modules/registry.js');
const { swdExtract, swdWallShares } = await import('../src/modules/tdWallLink.js');

const clone = v => JSON.parse(JSON.stringify(v));
const load = f => JSON.parse(fs.readFileSync(new URL('./fixtures/da-user/' + f, import.meta.url), 'utf8'));
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 6).join('\n       ')); process.exitCode = 1; }
}
const swdItem = load('t98-swd.json');
const swdWith = method => { const s = getModule('shear_wall_design').migrate({ schemaVersion: swdItem.schemaVersion, inputs: clone(swdItem.inputs) }).inputs; s.distribution = method; return swdExtract(s); };
const ex = swdWith('deflection');
const def = ex.definition;
const roofId = def.levels.find(l => l.name === 'Roof').id;
const lineOf = n => { for (const d of def.directions) for (const l of d.lines) if (l.name.trim() === n) return { dir: d, line: l }; };
const L2 = lineOf('2'), L3 = lineOf('3');
const wallIds = [...L2.line.walls, ...L3.line.walls].filter(w => w.levelId === roofId).map(w => 'swd:' + w.id);
const spec = [{ name: '2/3', wallIds, lineIds: [L2.line.id, L3.line.id] }];
const lfs = (e2, e3) => [{ swdDirId: L2.dir.id, swdLineId: L2.line.id, E: e2, W: 0 }, { swdDirId: L3.dir.id, swdLineId: L3.line.id, E: e3, W: 0 }];
const markOf = id => [...L2.line.walls, ...L3.line.walls].find(w => 'swd:' + w.id === id).mark;
const byMark = ws => Object.fromEntries(Object.entries(ws).map(([k, v]) => [markOf(k), v]));

// SWD v25 (2026-11-09, no sill bearing check on posts): at the round-0 forces (line 2 16.34 k) every wall is now designed
// (a post passes), so the case where SW-65 has no deflection is taken at line 2 = 20 k.
test('26998 Roof 2/3, line 2 20 k, line 3 6.46 k: SW-65 has no deflection there → split by capacity (swd-group-defl), SW-35 keeps a share', () => {
  const out = swdWallShares(ex, roofId, lfs(20, 6.46), spec);
  const g = out.groups['2/3'];
  assert.equal(g.method, 'deflection');
  assert.equal(g.deflectionFailed, true);
  const w = byMark(g.E.weights);
  assert.ok(w['SW-35'] > 0 && w['SW-65'] > 0, JSON.stringify(w));
});

test('26998 Roof 2/3, moderate forces (line 2 8.51 k, line 3 15.65 k): equal δ is used; SW-35 (stiffest) takes the most, every wall a share', () => {
  const out = swdWallShares(ex, roofId, lfs(8.51, 15.65), spec);
  const g = out.groups['2/3'];
  assert.ok(!g.deflectionFailed, 'deflection used');
  const w = byMark(g.E.weights);
  const tot = Object.values(w).reduce((t, v) => t + v, 0);
  assert.ok(Math.abs(tot - 24.16) < 0.05, String(tot));
  assert.ok(Object.values(w).every(v => v > 0), JSON.stringify(w));
  assert.equal(Object.entries(w).sort((a, b) => b[1] - a[1])[0][0], 'SW-35');
  // 17.16 k with the v24 posts (hand check 2026-11-09: equal δ ≈ 0.59 in); v25: SW-35 end posts (3)2x6 instead of 8x6
  assert.ok(Math.abs(w['SW-35'] - 16.76) < 0.3, String(w['SW-35']));
});

test('capacity distribution: untouched by the guard (no deflection check, no warning)', () => {
  const out = swdWallShares(swdWith('capacity'), roofId, lfs(16.34, 6.46), spec);
  const g = out.groups['2/3'];
  assert.equal(g.method, 'capacity');
  assert.ok(!g.deflectionFailed);
});

console.log(passed + ' passed');
