// User test project 26998 "Cotoros Main Test" (2026-11-06; tests/fixtures/da-user/t98-*.json): Roof + 2nd Floor + SWD.
// Pins what is known (plan docs/diaphragm-analysis-plan-2026-11-06.md, investigation 2026-11-06):
// - Roof: both directions close (offset lines C/D, G/H.3 in the Ex 3.3 form, chord-step TDs, strut TDs);
// - 2nd Floor load along y (offset line A/B, SW-9 / SW-11 of the Roof ending inside TD1 on its strut line B): it did not
//   close (B −405 lb) — not because of the walls above (their load balances on B inside the TD) but because SW-8
//   (B, y 54–57.5) runs 0.5 ft into TD1 (from y 57): its share there left the member without being part of P.
//   Fixed (td-v13, tdMembers.crossForce): the wall part inside the TD belongs to P. Closes with and without A/B;
// - 2nd Floor load along x: open runs on line 2 (2/3 offset strut, SWD capacity split) and line I (D12 corner) after the
//   modelling fixes found; offset-line shares cycle between two SWD auto-nailing choices ("did not settle").
// A change detector: when an engine fix changes one of these, update the test with the user. Run: node tests/daCase26998.test.mjs
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
  const g = n => i.grids.find(x => x.name === n).id;
  mod(i, g, m => i.tds.find(t => t.mark === m));
  return calcAll(i, { wallSource: swdExtract(s), gridSource: { grids: sharedGrids(roofItem.inputs) } });
}
const openRuns = (r, id) => {
  const c = r.analysis.cases.find(x => x.id === id);
  return c.members.flatMap(m => m.runs.filter(q => Math.abs(q.residual) > Math.max(30, 0.05 * Math.abs(q.max))).map(() => m.name));
};
const lf = (r, n) => (r.lineForces.find(l => l.line.trim() === n) || {}).E;
const sumY = r => ['A', 'B', 'C', 'D', 'E', 'G', 'H.3', 'J', 'M'].reduce((t, n) => t + (lf(r, n) || 0), 0);

test('Roof: no errors, both directions close; Σ line forces 60 k each way', () => {
  const r = roof();
  assert.deepEqual(r.errors.map(e => e.code), []);
  assert.ok(!r.checks.some(c => !c.ok && !c.warn && c.code !== 'td'), r.checks.filter(c => !c.ok).map(c => c.msg).join(' | '));
  assert.ok(near(sumY(r), 60, 0.01));
  assert.ok(near(['2', '3', '5', '6', '8', '9'].reduce((t, n) => t + lf(r, n), 0), 60, 0.01));
});

test('2nd Floor as saved (A/B offset line, SW-9 / SW-11 end inside TD1): along y every run closes — TD1 P includes the part of SW-8 inside the TD (td-v13)', () => {
  const r = floor();
  assert.deepEqual(r.errors.map(e => e.code), []);
  assert.ok(r.warnings.some(w => w.code === 'above-type4' && /SW-9, SW-11/.test(w.msg)), 'SW-9 / SW-11 end at this floor');
  assert.deepEqual(openRuns(r, 'y-E'), []);
  assert.ok(near(sumY(r), 45.16, 0.02), String(sumY(r)));
  const td1 = r.analysis.tdRuns.find(t => t.caseId === 'y-E' && t.mark === 'TD1');
  assert.ok(/of the wall part inside the TD/.test(JSON.stringify(td1.how)), 'P names the wall part');
});

test('the fix equals drawing TD1 from the end of SW-8 (y 57.5): same wall shares within 0.1 k; and SW-8 ending at 57 needs no extra', () => {
  const a = floor(), b = floor((i, g, T) => { T('TD1').y1 = '57.5'; });
  assert.deepEqual(openRuns(b, 'y-E'), []);
  for (const n of ['A', 'B', 'C', 'D']) assert.ok(near(lf(a, n), lf(b, n), 0.1), n + ': ' + lf(a, n) + ' / ' + lf(b, n));
  const s = swdOf(x => x.directions.forEach(d => d.lines.forEach(l => l.walls.forEach(w => { if (w.mark === 'SW-8') w.length = String(Number(w.length) - 0.5); }))));
  const c = floor(() => {}, s);
  assert.deepEqual(openRuns(c, 'y-E'), []);
  const td1 = c.analysis.tdRuns.find(t => t.caseId === 'y-E' && t.mark === 'TD1');
  assert.ok(!/of the wall part inside the TD/.test(JSON.stringify(td1.how)), 'no wall inside: P unchanged rule');
});

test('2nd Floor along y: SW-9 / SW-11 continuing down line B (flag off) → closes as well', () => {
  const s = swdOf(x => x.directions.forEach(d => d.lines.forEach(l => l.walls.forEach(w => { if (w.mark === 'SW-9' || w.mark === 'SW-11') delete w.endsAtFloor; }))));
  const r = floor(() => {}, s);
  assert.deepEqual(openRuns(r, 'y-E'), []);
});

test('2nd Floor along y without the A/B offset line (TD1 = strut C only) → closes; Σ = 20 own + 17.84 (SW-22) + 7.32 (SW-9 / SW-11) = 45.16 k', () => {
  const r = floor((i, g, T) => { i.wallLink.groups = i.wallLink.groups.filter(x => x.name !== 'A/B'); const t = T('TD1'); t.loads = t.loads.filter(l => l.gridId !== g('B')); });
  assert.deepEqual(openRuns(r, 'y-E'), []);
  assert.ok(near(sumY(r), 45.16, 0.02), String(sumY(r)));
  assert.ok(near(lf(r, 'A'), 7.07, 0.02) && near(lf(r, 'G'), 20.74, 0.02), lf(r, 'A') + ' / ' + lf(r, 'G'));
});

test('2nd Floor along x after the modelling fixes (TD5 reviewed, D6 on 6 / 5, D11 into D12): only line 2 (2/3 strut) and line I (D12 corner) stay open', () => {
  const dg = (mark, parts, sup, g) => ({ id: 'dg-t-' + mark, dir: 'x', mark, parts: parts.map((p, k) => ({ id: 'dg-t-' + mark + '-' + k, x1: String(p[0]), x2: String(p[1]), y1: String(p[2]), y2: String(p[3]) })), blocked: null, chordCut: '', supports: sup.map(g), bandSplit: '', sheathing: '' });
  const r = floor((i, g, T) => {
    T('TD5').engineer.cantileverOk = true;
    i.diaphragms = i.diaphragms.filter(d => !(d.dir === 'x' && ['D4', 'D5', 'D6'].includes(d.mark)));
    i.diaphragms.push(dg('D4', [[27, 43.33, 57, 62]], ['6', '5'], g), dg('D6', [[43.33, 57, 42.5, 62]], ['6', '5'], g), dg('D5', [[57, 66, 57, 62]], ['6', '5'], g));
    const a = i.diaphragms.find(d => d.dir === 'x' && d.mark === 'D12'), b = i.diaphragms.find(d => d.dir === 'x' && d.mark === 'D11');
    a.parts = [...a.parts, ...b.parts.map(p => ({ ...p, id: p.id + 'm' }))]; i.diaphragms = i.diaphragms.filter(d => d !== b);
  });
  assert.deepEqual(r.errors.map(e => e.code), []);
  assert.deepEqual([...new Set(openRuns(r, 'x-E'))].sort(), ['2', 'I']);
});

test('offset lines: the Shear Wall Design shares do not settle (two auto-nailing choices alternate) — warning shown', () => {
  const r = floor();
  assert.ok(r.warnings.some(w => w.code === 'swd-group-rounds'));
});

console.log(passed + ' passed');
