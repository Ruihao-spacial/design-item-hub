// SWD freeze (user 2026-11-05, build step 2): every Shear Wall Design item kept in the repo opens exactly as before —
// same definition, results, results page, form, PDF sections, and every elevation (interactive, with results, PDF
// forces / hardware). The baseline (tests/swd-freeze/baseline.json) was written before any SWD change for the
// Diaphragm Analysis transfer work; it is only rewritten (node scripts/swdFreeze.mjs --write) after a change the user
// has accepted. Changes for SWD items linked to Diaphragm Analysis are tested in their own files.
// Run: node tests/swdFreeze.test.mjs
import assert from 'assert/strict';
import fs from 'fs';
import { fingerprint, compare } from '../scripts/lib/swdFreeze.mjs';
import { fixtureItems } from '../scripts/swdFreeze.mjs';

const baseline = JSON.parse(fs.readFileSync(new URL('./swd-freeze/baseline.json', import.meta.url), 'utf8'));
const items = await fixtureItems();
const clone = v => JSON.parse(JSON.stringify(v));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 6).join('\n       ')); process.exitCode = 1; }
}

const now = {};
for (const [k, it] of Object.entries(items)) now[k] = fingerprint(it);

test(`every repo SWD item (${Object.keys(items).length}) is identical to the baseline: definition, results, form, results page, PDF, every elevation`, () => {
  const diffs = compare(baseline, now);
  assert.equal(diffs.length, 0, diffs.slice(0, 15).map(d => `${d.item} — ${d.part}: ${d.was} → ${d.now}`).join('\n'));
  assert.ok(Object.keys(items).length >= 30);
  assert.ok(Object.values(now).every(v => !v.error), 'every item opens');
});

test('the freeze is deterministic and catches a change: a wall moved 0.1 ft → its elevation; a story force → results', () => {
  const name = 'fixtures/tc1-two-story.json';
  const it = items[name];
  assert.deepEqual(fingerprint(clone(it)), now[name], 'same item twice → same fingerprint');
  const moved = clone(it);
  const line = moved.inputs.directions[0].lines.find(l => (l.walls || []).length);
  const w = line.walls[0];
  w.position = String((parseFloat(w.position) || 0) + 0.1);
  const d1 = compare({ x: now[name] }, { x: fingerprint(moved) }).map(d => d.part);
  assert.ok(d1.includes('definition') && d1.some(p => p.startsWith('line ' + line.name + ' · elevation')), d1.join(', '));
  const pushed = clone(it);
  const ln = pushed.inputs.directions[0].lines.find(l => (l.walls || []).length);
  const lv = Object.keys(ln.levelLoads || {})[0] || pushed.inputs.levels[0].id;
  ln.levelLoads = { ...(ln.levelLoads || {}), [lv]: { ...((ln.levelLoads || {})[lv] || {}), seismic: String((parseFloat(((ln.levelLoads || {})[lv] || {}).seismic) || 0) + 1) } };
  const d2 = compare({ x: now[name] }, { x: fingerprint(pushed) }).map(d => d.part);
  assert.ok(d2.includes('results') && d2.includes('pdf'), d2.join(', '));
});

console.log(passed + ' passed');
