// Diaphragm to LRS — beam back-check (B01 …): solveBeam run directly on each case's beam against the hand calc
// in docs/diaphragm-to-lrs-beam-check.md (the same values the app items are checked against).
// Run: node tests/diaphragmToLrsBeamCheck.test.mjs
import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
await import('../scripts/lib/shearWallLoadCheck.mjs'); // stand-in DOM globals
const { solveBeam, calcAll } = await import('../src/modules/diaphragmToLrsCalc.js');

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'dlrs-cases');
const cases = fs.readdirSync(dir).filter(f => /^B\d\d\w*-.*\.json$/.test(f)).sort().map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
const TOL = 0.0005;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n       ')); process.exitCode = 1; }
}
const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= TOL, msg + ': ' + a + ' vs ' + b);
const get = (o, field) => field.replace(/\[(\d+)\]/g, '.$1').split('.').reduce((v, k) => (v == null ? v : v[k]), o);

assert.ok(cases.length >= 19, 'beam cases found: ' + cases.length);
for (const c of cases) {
  const s = solveBeam(c.beam);
  test(c.id + ' solveBeam = hand calc', () => {
    for (const e of c.expect.filter(x => x.at === 'dia:E-W/R.D1')) {
      if (e.field === 'supports[0].reverses') { assert.equal(s.R1 < -1e-9, e.value, e.label); continue; }
      const v = get(s, e.field);
      if (typeof e.value === 'number') close(v, e.value, e.label); else assert.equal(v, e.value, e.label);
    }
    close(s.R1 + s.R2, s.sumW + s.sumP, 'ΣR = ΣW + ΣP');
  });
  test(c.id + ' the app item solves the same beam (w = q·d)', () => {
    const dg = calcAll(c.inputs).perDirection[0].perLevel[0].diaphragms.find(d => d.label === 'R.D1');
    assert.equal(dg.rows.length, s.rows.length, 'rows');
    dg.rows.forEach((r, i) => {
      const b = s.rows[i];
      assert.equal(r.kind + r.region, b.kind + b.region, 'row ' + i);
      close(r.R1, b.R1, 'row ' + i + ' R1'); close(r.R2, b.R2, 'row ' + i + ' R2');
    });
  });
}

// Superposition: B19 solved one load at a time adds up to B19 solved at once.
test('B19 superposition — Σ single-load solutions = combined solution', () => {
  const c = cases.find(x => x.id === 'B19');
  const all = solveBeam(c.beam);
  const singles = [
    ...c.beam.parts.map(p => solveBeam({ ...c.beam, parts: [p], points: [] })),
    ...c.beam.points.map(p => solveBeam({ ...c.beam, parts: [], points: [p] })),
  ];
  close(singles.reduce((t, s) => t + s.R1, 0), all.R1, 'R1');
  close(singles.reduce((t, s) => t + s.R2, 0), all.R2, 'R2');
  close(all.R1, 3.15, 'R1 hand'); close(all.R2, 4.65, 'R2 hand');
});

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
