// SWD elevation: move and resize walls by dragging, snapping to gridlines (user 2026-11-09, item 5; "snip" = snap).
// Rules (wallDragTarget): the moving end snaps to 1. a cross gridline (adopted plan only) within gridTol, 2. an end of
// another wall / beam / post within 0.5 ft, 3. the nearest 0.5 ft; Alt = 0.5 ft steps only. Resize: the other end stays,
// length ≥ 0.5 ft, never past an opening (openings keep their place). Unlinked items: no gridlines, 0.5 ft steps.
// Run: node tests/swdElevationDrag.test.mjs
import assert from 'assert/strict';
import fs from 'fs';
import '../scripts/lib/shearWallLoadCheck.mjs'; // sets up the stand-in DOM
import { wallDragTarget, renderElevation, setElevationPlan, DRAG_MIN_LENGTH } from '../src/modules/shearWallElevation.js';
import { shearWallDesign } from '../src/modules/shearWallDesign.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message)); process.exitCode = 1; }
}
const W = (id, pos, len, more = {}) => ({ id, mark: 'SW-' + id, levelId: 'L1', position: pos, length: len, openings: [], systemType: 'sheathed', ...more });
const lineOf = (...walls) => ({ id: 'ln', walls, beams: [], supportPosts: [] });
const grids = [{ name: '2', x: 10 }, { name: '3', x: 22 }];

test('Move: no gridlines → left end on 0.5 ft; near another wall end (≤ 0.5 ft) → that end, by either wall end', () => {
  const w = W('1', 2, 4), other = W('2', 15, 5);
  const ln = lineOf(w, other);
  assert.deepEqual(pick(wallDragTarget({ mode: 'move', wall: w, line: ln, deltaFt: 1.3 })), [3.5, 4, null]);   // 3.3 → 3.5
  // right end 6 + 8.8 = 14.8 → other wall's start 15 (0.2 ft) → position 11
  const t = wallDragTarget({ mode: 'move', wall: w, line: ln, deltaFt: 8.8 });
  assert.deepEqual([t.position, t.length, t.snap.kind], [11, 4, 'end']);
  // the wall's own ends are not snap targets
  assert.deepEqual(pick(wallDragTarget({ mode: 'move', wall: w, line: lineOf(w), deltaFt: 0.2 })), [2, 4, null]);
});

test('Move with gridlines: a gridline within gridTol beats an element end; the end closer to a gridline snaps', () => {
  const w = W('1', 2, 4), other = W('2', 10.4, 5);
  const ln = lineOf(w, other);
  // left end 2 + 7.7 = 9.7 → grid 2 at 10 (0.3 ft) although the other wall starts at 10.4
  const a = wallDragTarget({ mode: 'move', wall: w, line: ln, deltaFt: 7.7, grids, gridTol: 1 });
  assert.deepEqual([a.position, a.snap.kind, a.snap.name], [10, 'grid', '2']);
  // right end 6 + 15.6 = 21.6 → grid 3 at 22 → position 18
  const b = wallDragTarget({ mode: 'move', wall: w, line: lineOf(w), deltaFt: 15.6, grids, gridTol: 1 });
  assert.deepEqual([b.position, b.length, b.snap.name], [18, 4, '3']);
  // outside gridTol → no grid snap (0.5 ft step)
  const c = wallDragTarget({ mode: 'move', wall: w, line: lineOf(w), deltaFt: 6.4, grids, gridTol: 0.3 });
  assert.deepEqual(pick(c), [8.5, 4, null]);
  // Alt: 0.5 ft steps only
  assert.deepEqual(pick(wallDragTarget({ mode: 'move', wall: w, line: ln, deltaFt: 7.7, grids, gridTol: 1, alt: true })), [9.5, 4, null]);
});

test('Resize left / right: the other end stays; snaps like a move; length ≥ 0.5 ft; position ≥ 0', () => {
  const w = W('1', 12, 6); // 12 – 18
  const ln = lineOf(w);
  const l = wallDragTarget({ mode: 'left', wall: w, line: ln, deltaFt: -1.8, grids, gridTol: 1 }); // 10.2 → grid 2
  assert.deepEqual([l.position, l.length, l.snap.name], [10, 8, '2']);
  const r = wallDragTarget({ mode: 'right', wall: w, line: ln, deltaFt: 3.6, grids, gridTol: 1 }); // 21.6 → grid 3
  assert.deepEqual([r.position, r.length, r.snap.name], [12, 10, '3']);
  assert.deepEqual(pick(wallDragTarget({ mode: 'right', wall: w, line: ln, deltaFt: 1.2 })), [12, 7, null]); // 19.2 → 19
  assert.equal(wallDragTarget({ mode: 'left', wall: w, line: ln, deltaFt: 10 }).length, DRAG_MIN_LENGTH);
  assert.equal(wallDragTarget({ mode: 'right', wall: w, line: ln, deltaFt: -10 }).length, DRAG_MIN_LENGTH);
  assert.equal(wallDragTarget({ mode: 'left', wall: w, line: ln, deltaFt: -20 }).position, 0);
});

test('Resize never cuts an opening; a left-end resize keeps the openings in place (offsets shift)', () => {
  const w = W('1', 10, 12, { method: 'ftao', openings: [{ id: 'op-1', offset: 3, width: 4, sill: 3, head: 7 }] }); // opening 13 – 17
  const ln = lineOf(w);
  const l = wallDragTarget({ mode: 'left', wall: w, line: ln, deltaFt: 5 }); // 15 → stops at 13
  assert.deepEqual([l.position, l.length, l.openings[0].offset], [13, 9, 0]);
  const l2 = wallDragTarget({ mode: 'left', wall: w, line: ln, deltaFt: -2 }); // 8: opening stays at 13 → offset 5
  assert.deepEqual([l2.position, l2.length, l2.openings[0].offset, l2.openings[0].width], [8, 14, 5, 4]);
  assert.equal(w.openings[0].offset, 3, 'the wall itself is not changed by the target');
  const r = wallDragTarget({ mode: 'right', wall: w, line: ln, deltaFt: -8 }); // 14 → stops at 17
  assert.deepEqual([r.position, r.length], [10, 7]);
});

// Drag through the real elevation: select by Find, grips, mousedown on a grip, mouseup on the svg
function elevationFor(inputs, line) {
  const c = document.createElement('div');
  let changed = 0;
  const h = renderElevation(c, line, inputs.levels, inputs.wallDLTypes || [], { onInputChange() { changed++; } });
  h.showResults(shearWallDesign.calc(JSON.parse(JSON.stringify(inputs))).perDirection.flatMap(d => d.perLine).find(l => l.lineId === line.id)); // first draw
  const select = (id) => {
    const sel = [...c.querySelectorAll('select')].find(s => (s.getAttribute('title') || '').includes('mark or ID'));
    [...sel.querySelectorAll('option')].forEach(o => o.removeAttribute('selected'));
    [...sel.querySelectorAll('option')].find(o => o.getAttribute('value') === 'wall:' + id).setAttribute('selected', '');
    sel.dispatchEvent(new window.Event('change'));
  };
  const grips = () => [...c.querySelectorAll('rect[data-grip]')];
  return { c, h, select, grips, changed: () => changed };
}
const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/shearwall-sample.json', import.meta.url), 'utf8'));
const sample = () => shearWallDesign.migrate({ schemaVersion: fx.schemaVersion ?? (fx.inputs ? undefined : 1), inputs: JSON.parse(JSON.stringify(fx.inputs || fx)) }).inputs;

test('Elevation: grips only on the selected sheathed wall; none for a WSWH panel or with nothing selected', () => {
  const inputs = sample(), line = inputs.directions[0].lines[0];
  const e = elevationFor(inputs, line);
  assert.equal(e.grips().length, 0, 'nothing selected');
  e.select(line.walls[0].id);
  assert.deepEqual(e.grips().map(g => g.getAttribute('data-grip')), ['left', 'right']);
  e.h.destroy && e.h.destroy();
  // a WSWH panel (results recalculated with the panel, as the form does)
  const inp2 = sample(), line2 = inp2.directions[0].lines[0];
  Object.assign(line2.walls[0], { systemType: 'wswh', wswhWidth: '18', length: 1.5 });
  const e2 = elevationFor(inp2, line2);
  e2.select(line2.walls[0].id);
  assert.equal(e2.grips().length, 0, 'WSWH: length = panel width');
  e2.h.destroy && e2.h.destroy();
});

test('Elevation: dragging the right grip resizes the wall (0.5 ft steps unlinked; gridline snap with an adopted plan)', () => {
  for (const withGrid of [false, true]) {
    const inputs = sample(), line = inputs.directions[0].lines[0];
    const w = line.walls[0];
    const p0 = parseFloat(w.position), L0 = parseFloat(w.length);
    if (withGrid) setElevationPlan(line, { origin: 0, grid: { name: 'A', axis: 'y', at: 0 }, cross: [{ name: '7', x: p0 + L0 + 2.3, at: 0 }], extents: [] });
    const e = elevationFor(inputs, line);
    e.select(w.id);
    const [gl, gr] = e.grips();
    const pxPerFt = (parseFloat(gr.getAttribute('x')) - parseFloat(gl.getAttribute('x'))) / L0;
    const svg = e.c.querySelector('svg');
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600 });
    const xAt = ft => 80 + ft * pxPerFt; // GUTTER = 80
    const ev = (type, x) => { const m = new window.Event(type, { bubbles: true }); m.clientX = x; m.clientY = 10; m.altKey = false; return m; };
    gr.dispatchEvent(ev('mousedown', xAt(p0 + L0)));
    svg.dispatchEvent(ev('mouseup', xAt(p0 + L0 + 2.2)));
    assert.equal(parseFloat(w.position), p0);
    assert.equal(parseFloat(w.length), withGrid ? L0 + 2.3 : Math.round((L0 + 2.2) * 2) / 2 - (Math.round(p0 * 2) / 2 - p0), withGrid ? 'snapped to grid 7' : '0.5 ft step');
    assert.ok(e.changed() > 0, 'change reported');
    setElevationPlan(line, null);
    e.h.destroy && e.h.destroy();
  }
});

test('Text size (user 2026-11-10): A− / A+ in 10 % steps (70–160 %), remembered per browser; the drawing is shown scaled, a drag at 150 % lands where it does at 100 %', () => {
  const store = {};
  globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  try {
    const run = (scale) => {
      if (scale == null) delete store['swd.elevationTextScale']; else store['swd.elevationTextScale'] = String(scale);
      const inputs = sample(), line = inputs.directions[0].lines[0];
      const w = line.walls[0];
      const p0 = parseFloat(w.position), L0 = parseFloat(w.length);
      const e = elevationFor(inputs, line);
      const svg = e.c.querySelector('svg');
      const ts = scale || 1;
      const vb = svg.getAttribute('viewBox');
      if (ts === 1) assert.equal(vb, null, '100 %: the drawing exactly as before (no viewBox)');
      else {
        const [, , vw, vh] = vb.split(' ').map(Number);
        assert.equal(parseFloat(svg.getAttribute('width')), vw * ts);
        assert.equal(parseFloat(svg.getAttribute('height')), vh * ts);
      }
      e.select(w.id);
      const [gl, gr] = e.grips();
      const pxPerFt = (parseFloat(gr.getAttribute('x')) - parseFloat(gl.getAttribute('x'))) / L0; // drawing units
      e.c.querySelector('svg').getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600 });
      const xAt = ft => (80 + ft * pxPerFt) * ts; // screen px
      const ev = (type, x) => { const m = new window.Event(type, { bubbles: true }); m.clientX = x; m.clientY = 10 * ts; m.altKey = false; return m; };
      gr.dispatchEvent(ev('mousedown', xAt(p0 + L0)));
      e.c.querySelector('svg').dispatchEvent(ev('mouseup', xAt(p0 + L0 + 2.2)));
      const out = [parseFloat(w.position), parseFloat(w.length)];
      e.h.destroy && e.h.destroy();
      return out;
    };
    const base = run(null);
    assert.deepEqual(run(1.5), base, 'same resize at 150 %');
    assert.deepEqual(run(0.7), base, 'same resize at 70 %');
    // buttons: A+ twice from 100 % → 120 %, stored; A− clamps at 70 %; the % resets to 100 %
    delete store['swd.elevationTextScale'];
    const inputs = sample(), line = inputs.directions[0].lines[0];
    const e = elevationFor(inputs, line);
    const btn = (t) => [...e.c.querySelectorAll('button')].find(b => b.textContent === t);
    btn('A+').dispatchEvent(new window.Event('click')); btn('A+').dispatchEvent(new window.Event('click'));
    assert.equal(store['swd.elevationTextScale'], '1.2');
    assert.ok(btn('120%'));
    for (let i = 0; i < 10; i++) btn('A−').dispatchEvent(new window.Event('click'));
    assert.equal(store['swd.elevationTextScale'], '0.7');
    btn('70%').dispatchEvent(new window.Event('click'));
    assert.equal(store['swd.elevationTextScale'], '1');
    assert.equal(e.c.querySelector('svg').getAttribute('viewBox'), null);
    e.h.destroy && e.h.destroy();
  } finally { delete globalThis.localStorage; }
});

function pick(t) { return [t.position, t.length, t.snap]; }
console.log(passed + ' passed');
