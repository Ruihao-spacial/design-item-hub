// Transfer Diaphragm — Phase 1: plan geometry, plan checks, editor tools, form, stored data, book layouts.
// Run: node tests/diaphragmAnalysisPlan.test.mjs
import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseHTML } from 'linkedom';

if (!globalThis.document) {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  globalThis.window = window;
  globalThis.document = document;
  globalThis.Node = window.Node;
}
const { parsePlan, planErrors, sheathedArea, depthAt, sectionBands, panels } = await import('../src/modules/tdGeometry.js');
const { diaphragmAnalysis, calcAll } = await import('../src/modules/diaphragmAnalysis.js');
const { TD_SCHEMA, migrateItem, normalizeInputs, lostValues } = await import('../src/modules/tdMigrate.js');
const { defaultInputs, newGrid } = await import('../src/modules/tdModel.js');
const editorMod = await import('../src/modules/tdPlanEditor.js');
const { applyClick, finishOutline, deleteSelected, snapPoint, newEditorState, guessTdLines, drawPlan } = editorMod;
const { bookToInputs } = await import('./td-book/src/toInputs.mjs');
const { DESIGN_ITEM_MODULES } = await import('../src/modules/registry.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const bookDir = path.join(here, 'td-book');
const books = fs.readdirSync(bookDir).filter(f => /^Ex\d+\.\d+\.json$/.test(f)).sort()
  .map(f => JSON.parse(fs.readFileSync(path.join(bookDir, f), 'utf8')));
const fixDir = path.join(here, 'fixtures', 'legacy-td');
const clone = v => JSON.parse(JSON.stringify(v));
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; }
}

// plan from compact data: outline corners, openings [x1,x2,y1,y2]
function planOf(outline, openings = []) {
  return parsePlan({
    grids: [], walls: [], tds: [], loads: [],
    outline: outline.map(([x, y]) => ({ x: String(x), y: String(y) })),
    openings: openings.map(([x1, x2, y1, y2], i) => ({ id: 'o' + i, x1, x2, y1, y2 })),
  });
}

// ── geometry ──
test('rectangle: area, depth, one band, panels sum to ΣA', () => {
  const p = planOf([[0, 0], [100, 0], [100, 50], [0, 50]]);
  assert.equal(sheathedArea(p), 5000);
  assert.equal(depthAt(p, 'x', 30), 50);
  assert.equal(depthAt(p, 'y', 10), 100);
  assert.deepEqual(sectionBands(p, 'x', 30), [[0, 50]]);
  assert.equal(planErrors(p).length, 0);
});

test('L-shape: depth steps at the re-entrant corner (each side differs)', () => {
  const p = planOf([[0, 0], [60, 0], [60, 20], [30, 20], [30, 50], [0, 50]]);
  assert.equal(sheathedArea(p), 60 * 20 + 30 * 30);
  assert.equal(depthAt(p, 'x', 30, '-'), 50);
  assert.equal(depthAt(p, 'x', 30, '+'), 20);
  assert.equal(depthAt(p, 'y', 35), 30);
  assert.equal(depthAt(p, 'y', 10), 60);
  const sum = panels(p).reduce((s, q) => s + q.area, 0);
  assert.ok(near(sum, sheathedArea(p)));
});

test('T-shape and notch: bands across the section', () => {
  const t = planOf([[0, 0], [90, 0], [90, 20], [60, 20], [60, 50], [30, 50], [30, 20], [0, 20]]);
  assert.equal(depthAt(t, 'x', 45), 50);
  assert.equal(depthAt(t, 'x', 10), 20);
  const n = planOf([[0, 0], [15, 0], [15, 10], [35, 10], [35, 0], [150, 0], [150, 50], [0, 50]]); // Ex 4.1
  assert.deepEqual(sectionBands(n, 'x', 20), [[10, 50]]);
  assert.equal(depthAt(n, 'x', 15, '-'), 50);
  assert.equal(depthAt(n, 'x', 15, '+'), 40);
  assert.equal(depthAt(n, 'x', 35, '+'), 50);
});

test('opening: two bands, area reduced, panels exclude the opening', () => {
  const p = planOf([[0, 0], [160, 0], [160, 50], [0, 50]], [[15, 39, 16, 40]]); // Ex 5.1
  assert.equal(sheathedArea(p), 8000 - 24 * 24);
  assert.deepEqual(sectionBands(p, 'x', 27), [[0, 16], [40, 50]]);
  assert.equal(depthAt(p, 'x', 27), 26);
  assert.ok(near(panels(p).reduce((s, q) => s + q.area, 0), sheathedArea(p)));
});

test('plan checks fire: diagonal edge, self-crossing, opening outside, TD over an opening, wall off the plan, bad load', () => {
  const codes = inputs => planErrors(parsePlan(inputs)).map(e => e.code);
  const base = defaultInputs();
  const diag = clone(base); diag.outline[2].x = '90';
  assert.ok(codes(diag).includes('outline-diag'));
  const cross = clone(base); cross.outline = [[0, 0], [100, 0], [100, 50], [50, 50], [50, -10], [0, -10]].map(([x, y]) => ({ x: String(x), y: String(y) }));
  assert.ok(codes(cross).includes('outline-cross'));
  const op = clone(base); op.openings.push({ id: 'o1', name: 'O', x1: '90', x2: '120', y1: '10', y2: '20' });
  assert.ok(codes(op).includes('opening-outside'));
  const td = clone(base);
  td.openings.push({ id: 'o1', name: 'O', x1: '10', x2: '20', y1: '10', y2: '20' });
  td.tds.push({ id: 't1', mark: 'TD1', x1: '0', x2: '30', y1: '0', y2: '50', supports: [base.grids[2].id, base.grids[3].id], loads: [], overhang: null });
  assert.ok(codes(td).includes('td-opening'));
  assert.ok(codes(td).includes('td-loads'));
  const wall = clone(base); const g = newGrid('9', 'x', 150); wall.grids.push(g); wall.walls.push({ id: 'w', line: '9', mark: 'SW1', gridId: g.id, from: '0', to: '20' });
  assert.ok(codes(wall).includes('wall-outside'));
  const ld = clone(base); ld.loads.push({ id: 'l', acts: '-y', mode: 'line', psf: '', edgeId: '', segments: [{ from: '0', to: '0', w: '200', w2: '' }] });
  assert.ok(codes(ld).includes('load-seg-bad'));
  assert.equal(codes(base).length, 0, 'default item is valid');
});

// ── book layouts ──
test('all 9 book layouts: convert, valid, ΣA = book area, panels sum to ΣA, TD lines resolve', () => {
  assert.equal(books.length, 9);
  for (const b of books) {
    const inputs = bookToInputs(b);
    const plan = parsePlan(inputs);
    const errs = planErrors(plan);
    assert.deepEqual(errs.map(e => e.msg), [], b.id + ' has no plan errors');
    assert.ok(near(sheathedArea(plan), b.sheathedArea), b.id + ' ΣA');
    assert.ok(near(panels(plan).reduce((s, q) => s + q.area, 0), b.sheathedArea, 1e-6), b.id + ' panels');
    assert.equal(calcAll(inputs).status, 'ok', b.id + ' status');
    for (const t of plan.tds) assert.ok(t.supports.every(Boolean) && t.loads.every(l => l.grid), b.id + ' ' + t.mark + ' lines');
  }
});

test('book depths: Ex 4.1 notch 40 ft between 2 and 3; Ex 5.1 opening leaves 26 ft at grid 3; Ex 4.3 skylight', () => {
  const by = id => parsePlan(bookToInputs(books.find(b => b.id === id)));
  const e41 = by('Ex4.1');
  assert.equal(depthAt(e41, 'x', 25), 40);
  assert.equal(depthAt(e41, 'x', 15, '-'), 50);
  const e51 = by('Ex5.1');
  assert.equal(depthAt(e51, 'x', 27), 26);
  assert.equal(depthAt(e51, 'x', 39, '+'), 50);
  const e43 = by('Ex4.3');
  assert.equal(depthAt(e43, 'x', 8), 56 - 18);
});

// ── editor ──
function editorCase() {
  const inputs = defaultInputs();
  return { inputs, plan: () => parsePlan(inputs), st: newEditorState() };
}

test('snap: grid intersection / grid line within 14 px, else 0.5 ft', () => {
  const { plan } = editorCase();
  const p = plan();
  const a = snapPoint(p, 99.2, 30.3, 10);
  assert.deepEqual([a.x, a.y, a.onGridX, a.onGridY], [100, 30.5, true, false]);
  const b = snapPoint(p, 51.26, 0.6, 10);
  assert.deepEqual([b.x, b.y, b.onGridX, b.onGridY], [51.5, 0, false, true]);
  const c = snapPoint(p, 0.9, 49.2, 10);
  assert.deepEqual([c.x, c.y, c.onGridX && c.onGridY], [0, 50, true], 'grid intersection');
});

test('tools: grid, opening, wall on a grid only, TD with guessed supports and load lines, delete', () => {
  const { inputs, plan, st } = editorCase();
  st.tool = 'gridx';
  assert.ok(applyClick(inputs, plan(), st, { x: 40, y: 10 }));
  assert.equal(inputs.grids.filter(g => g.axis === 'x').length, 3);
  assert.ok(!applyClick(inputs, plan(), st, { x: 40, y: 20 }), 'no duplicate grid');
  st.tool = 'gridy';
  assert.ok(applyClick(inputs, plan(), st, { x: 10, y: 20 }));
  st.tool = 'opening';
  assert.ok(!applyClick(inputs, plan(), st, { x: 60, y: 10 }));
  assert.ok(applyClick(inputs, plan(), st, { x: 80, y: 20 }));
  assert.equal(inputs.openings.length, 1);
  st.tool = 'wall';
  applyClick(inputs, plan(), st, { x: 5, y: 33 });
  assert.ok(!applyClick(inputs, plan(), st, { x: 5, y: 45 }), 'x = 5 is not a grid');
  applyClick(inputs, plan(), st, { x: 0, y: 0 });
  assert.ok(applyClick(inputs, plan(), st, { x: 0, y: 50 }));
  assert.equal(inputs.walls[0].mark, 'SW1');
  assert.equal(inputs.walls[0].from, '0');
  st.tool = 'td';
  applyClick(inputs, plan(), st, { x: 0, y: 0 });
  assert.ok(applyClick(inputs, plan(), st, { x: 15, y: 50 }));
  const td = inputs.tds[0];
  assert.equal(td.mark, 'TD1');
  const names = ids => ids.map(id => inputs.grids.find(g => g.id === id).name);
  assert.deepEqual(names(td.supports), ['A', 'B'], 'supports at the ends of the long side');
  // load lines on Auto (2026-11-03): found from the plan — a plain rectangle has no notch / opening edge, so none
  assert.equal(td.loadsMode, 'auto');
  assert.deepEqual(parsePlan(inputs).tds[0].loads, [], 'plain plan: no load line found');
  assert.ok(/no load line found/.test(st.message), st.message);
  st.sel = { kind: 'opening', id: inputs.openings[0].id };
  assert.ok(deleteSelected(inputs, st));
  assert.equal(inputs.openings.length, 0);
  assert.deepEqual(guessTdLines(plan(), { x1: 0, x2: 100, y1: 0, y2: 20 }).supports.map(id => inputs.grids.find(g => g.id === id).name), ['2', '1']);
});

test('outline tool: corners line up, closes on the first corner, replaces the outline', () => {
  const { inputs, plan, st } = editorCase();
  st.tool = 'outline';
  for (const [x, y] of [[0, 0], [60, 1], [60, 20], [30, 21], [30, 50], [0, 50]]) applyClick(inputs, plan(), st, { x, y });
  assert.equal(st.pending.length, 6);
  assert.deepEqual(st.pending[1], { x: 60, y: 0 }, 'snapped onto the row of the last corner');
  assert.ok(applyClick(inputs, plan(), st, { x: 0, y: 0 }));
  assert.equal(inputs.outline.length, 6);
  assert.equal(sheathedArea(plan()), 60 * 20 + 30 * 30);
  // the default diaphragms (0–100 × 0–50) now run past the outline: hard check, nothing else
  assert.deepEqual(planErrors(plan()).filter(e => !e.warn).map(e => e.code), ['dg-part-outside', 'dg-part-outside']);
  st.tool = 'outline';
  st.pending = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 10 }];
  assert.ok(!finishOutline(inputs, st), 'last corner does not line up with the first');
});

test('drawing: every book layout draws (grids, walls, TDs, openings, loads)', () => {
  for (const b of books) {
    const inputs = bookToInputs(b);
    const plan = parsePlan(inputs);
    const dir = plan.loads[0].acts.endsWith('x') ? 'x' : 'y';
    const { svg } = drawPlan(plan, { ...newEditorState(), dir }, [], {});
    assert.equal(svg.tagName.toLowerCase(), 'svg');
    const html = svg.outerHTML;
    for (const g of plan.grids) assert.ok(html.includes('>' + g.name + '<'), b.id + ' grid ' + g.name);
    for (const t of plan.tds) assert.ok(html.includes('>' + t.mark + '<'), b.id + ' ' + t.mark);
  }
});

test('review 2026-10-29: diaphragm tool guesses its supports; an off-grid TD still finds them; the panel shows them', () => {
  const { inputs, plan, st } = editorCase();
  inputs.grids.push(newGrid('C', 'y', 20));
  const gname = id => inputs.grids.find(g => g.id === id).name;
  inputs.diaphragms = inputs.diaphragms.filter(d => d.dir !== 'x'); // free sheathing for the new x diaphragm
  st.tool = 'diaphragm'; st.dir = 'x';
  applyClick(inputs, plan(), st, { x: 0, y: 0 });
  assert.ok(applyClick(inputs, plan(), st, { x: 100, y: 50 }, 10));
  const d = inputs.diaphragms[inputs.diaphragms.length - 1];
  assert.equal(d.dir, 'x');
  assert.equal(d.mark, 'D1', 'next free mark in the x direction');
  assert.deepEqual(d.supports.map(gname), ['B', 'A'], 'load along x spans between ↔ lines at its ends');
  st.tool = 'td'; st.dir = 'y';
  applyClick(inputs, plan(), st, { x: 0, y: 0.3 });          // a little off grid B (y = 0) and A (y = 50)
  assert.ok(applyClick(inputs, plan(), st, { x: 15, y: 49.6 }, 10));
  const t = inputs.tds[0];
  assert.equal(t.dir, 'y');
  assert.deepEqual(t.supports.map(gname), ['A', 'B']);
  assert.equal(t.loadsMode, 'auto'); // load lines found from the plan (none on this plain plan)
  // the panel's support selects show A and B
  const box = document.createElement('div');
  diaphragmAnalysis.renderForm(box, inputs, () => {}, [], () => {}, {});
  [...box.querySelectorAll('button')].find(b => b.textContent.startsWith('Plan')).dispatchEvent(new window.Event('click'));
  [...box.querySelectorAll('button')].find(b => b.textContent === 'Diaphragms & TDs').dispatchEvent(new window.Event('click'));
  const shown = [...box.querySelectorAll('select')].map(s => [...s.querySelectorAll('option')].find(o => o.selected)).filter(o => o && o.value === t.supports[0]);
  assert.ok(shown.length >= 1, 'TD support A is the selected option of a support select');
});

test('diaphragm checks: wrong support axis, overlap, coverage warning; warnings do not fail the item', () => {
  const inputs = defaultInputs();
  assert.equal(calcAll(inputs).status, 'ok');
  const d = inputs.diaphragms.find(x => x.dir === 'y');
  const swapped = clone(inputs);
  swapped.diaphragms.find(x => x.dir === 'y').supports = clone(inputs.diaphragms.find(x => x.dir === 'x').supports);
  assert.ok(calcAll(swapped).errors.some(e => e.code === 'dg-supports-axis'));
  const two = clone(inputs);
  two.diaphragms.push({ ...clone(d), id: 'd2', mark: 'D2', parts: [{ id: 'd2-p1', x1: '50', x2: '100', y1: '0', y2: '50' }] });
  assert.ok(calcAll(two).errors.some(e => e.code === 'dg-overlap'));
  const half = clone(inputs);
  half.diaphragms.find(x => x.dir === 'y').parts[0].x2 = '60';
  half.diaphragms.find(x => x.dir === 'y').supports[1] = '';
  const r = calcAll(half);
  assert.ok(r.warnings.some(e => e.code === 'dg-cover'));
  assert.ok(r.errors.some(e => e.code === 'dg-supports'));
  const none = clone(inputs);
  none.diaphragms = none.diaphragms.filter(x => x.dir !== 'x');
  const rn = calcAll(none);
  assert.ok(rn.warnings.some(e => e.code === 'dg-none'));
  assert.equal(rn.status, 'ok', 'a warning alone does not fail');
});

test('direction filter: the drawing shows only the diaphragms / TDs / loads of the chosen direction, with its arrow', () => {
  const b = books.find(x => x.id === 'Ex4.1');
  const inputs = bookToInputs(b);
  const plan = parsePlan(inputs);
  const y = drawPlan(plan, { ...newEditorState(), dir: 'y' }, []).svg.outerHTML;
  const x = drawPlan(plan, { ...newEditorState(), dir: 'x' }, []).svg.outerHTML;
  assert.ok(y.includes('>TD1<') && y.includes('Load along y') && y.includes('200 plf'));
  assert.ok(!x.includes('>TD1<') && x.includes('Load along x') && !x.includes('200 plf'));
  const n = normalizeInputs({ loads: [{ acts: '+x' }], tds: [{ mark: 'T' }], diaphragms: [{ mark: 'D' }] });
  assert.equal(n.tds[0].dir, 'x', 'an older TD takes the direction of the first load');
  assert.equal(n.diaphragms[0].dir, 'x');
});

test('review 2 (comment 1): a diaphragm drawn off the grids snaps onto them and gets both supports; one inner line = cantilever case', () => {
  const { inputs, plan, st } = editorCase();
  inputs.grids.push(newGrid('3', 'x', 60));
  const gname = id => inputs.grids.find(g => g.id === id).name;
  inputs.diaphragms = inputs.diaphragms.filter(d => d.dir !== 'y'); // free sheathing for the drawn diaphragms
  st.tool = 'diaphragm'; st.dir = 'y';
  applyClick(inputs, plan(), st, { x: 0.4, y: 0.3 });
  assert.ok(applyClick(inputs, plan(), st, { x: 59.6, y: 49.7 }, 10));
  const d = inputs.diaphragms[inputs.diaphragms.length - 1];
  assert.deepEqual(d.parts.map(q => [q.x1, q.x2, q.y1, q.y2]), [['0', '60', '0', '50']], 'one piece, edges snapped onto 1 / 3 / B / A');
  assert.deepEqual(d.supports.map(gname), ['1', '3']);
  assert.ok(/spans between 1 \/ 3/.test(st.message));
  // a rectangle 60 → 85 has only grid 3 inside: one support (overhang), message says so
  applyClick(inputs, plan(), st, { x: 60, y: 0 });
  applyClick(inputs, plan(), st, { x: 85, y: 50 }, 10);
  const c = inputs.diaphragms[inputs.diaphragms.length - 1];
  assert.deepEqual(c.supports.map(gname), ['3']);
  assert.ok(/only support line 3/.test(st.message));
});

test('review 2 (comment 2): Esc cancels the drawing, then the selection, then the tool', () => {
  const { handleEscape } = editorMod;
  const st = newEditorState();
  st.tool = 'td'; st.pending = [{ x: 0, y: 0 }]; st.sel = { kind: 'td', id: 't' };
  assert.ok(handleEscape(st)); assert.equal(st.pending.length, 0); assert.ok(st.sel);
  assert.ok(handleEscape(st)); assert.equal(st.sel, null); assert.equal(st.tool, 'td');
  assert.ok(handleEscape(st)); assert.equal(st.tool, 'select');
  assert.ok(!handleEscape(st), 'nothing left to cancel');
});

test('review 2 (comment 3): dragging an edge moves it (snapped value), keeps a rectangle, and a support on that edge follows', () => {
  const { setEdge } = editorMod;
  const inputs = defaultInputs();
  inputs.grids.push(newGrid('3', 'x', 60));
  const g3 = inputs.grids[inputs.grids.length - 1];
  const d = inputs.diaphragms.find(x => x.dir === 'y'); // 0..100, supports 1 (x=0) / 2 (x=100)
  const plan = parsePlan(inputs);
  const q = d.parts[0];
  assert.ok(setEdge(inputs, plan, 'diaphragm', d.id, 'x2', 60, q.id));
  assert.equal(q.x2, '60');
  assert.equal(d.supports[1], g3.id, 'support 2 (old edge) → grid 3 (new edge)');
  assert.ok(!setEdge(inputs, parsePlan(inputs), 'diaphragm', d.id, 'x2', 0.2, q.id), 'no zero-width rectangle');
  assert.ok(setEdge(inputs, parsePlan(inputs), 'diaphragm', d.id, 'x1', 70, q.id), 'dragging past the other edge flips');
  assert.deepEqual([q.x1, q.x2], ['60', '70']);
  const st = { ...newEditorState(), sel: { kind: 'diaphragm', id: d.id } };
  const html = drawPlan(parsePlan(inputs), st, [], { onPick() {}, onEdgeDown() {} }).svg.outerHTML;
  assert.equal((html.match(/data-edge="/g) || []).length, 8, '4 edges × (line + square)');
});

// ── module, form and stored data ──
function openAndSave(inputs) {
  let saved = null;
  const box = document.createElement('div');
  diaphragmAnalysis.renderForm(box, inputs, (x) => { saved = clone(x); }, [], () => {}, {});
  const click = (pred) => { const b = [...box.querySelectorAll('button')].find(pred); if (b) b.dispatchEvent(new window.Event('click')); return !!b; };
  for (const t of ['Setup', 'Plan', 'Analysis', 'TDs', 'Checks']) assert.ok(click(b => b.textContent.startsWith(t)), 'tab ' + t);
  assert.ok(click(b => b.textContent === 'Plan' || b.textContent.startsWith('Plan')));
  assert.ok(box.querySelector('svg'), 'plan drawing');
  // input pages of the Plan tab (2026-11-03), each with its own tools
  for (const [pg, tools] of [['Grids & outline', ['Grid ↕', 'Outline', 'Opening']], ['Diaphragms & TDs', ['Diaphragm', 'TD']], ['Shear walls', ['Wall']]]) {
    assert.ok(click(b => b.textContent === pg), 'page ' + pg);
    for (const tool of [...tools, 'Select']) assert.ok(click(b => b.textContent === tool && !b.disabled) || tool === 'Wall', 'tool ' + tool + ' on ' + pg);
  }
  assert.ok(click(b => b.textContent === 'Grids & outline'));
  if (inputs && inputs.verification) assert.ok(click(b => b.textContent.startsWith('Verification')), 'verification tab');
  assert.ok(click(b => b.textContent === 'Calculate & Save'), 'save');
  assert.ok(saved, 'onSave called');
  return saved;
}

test('module registered; new item opens, saves, calculates', () => {
  assert.ok(DESIGN_ITEM_MODULES.includes(diaphragmAnalysis));
  const saved = openAndSave(undefined);
  assert.equal(saved.schemaVersion, TD_SCHEMA);
  const out = diaphragmAnalysis.calc(saved);
  assert.equal(out.sumA, 5000);
  assert.equal(out.status, 'ok');
  assert.ok(diaphragmAnalysis.pdfSections(saved, out).length >= 2);
  const box = document.createElement('div');
  diaphragmAnalysis.renderOutputs(box, out);
  assert.ok(box.textContent.includes('5000.00'));
});

test('every book item opens (all tabs + Verification), saves without loss, and migrates idempotently', () => {
  for (const b of books) {
    const inputs = bookToInputs(b);
    const before = clone(inputs);
    const saved = openAndSave(clone(inputs));
    assert.deepEqual(lostValues(before, saved), [], b.id + ' no value lost on save');
    const m1 = migrateItem({ schemaVersion: TD_SCHEMA, inputs: clone(saved) });
    const m2 = migrateItem(clone(m1));
    assert.deepEqual(m1.inputs, m2.inputs, b.id + ' idempotent');
  }
});

test('normalise: empty / partial stored inputs get every field; unknown fields kept', () => {
  const n = normalizeInputs({ grids: [{ name: 'A' }], tds: [{ mark: 'T' }], loads: [{ segments: [{}] }], futureField: 7 });
  assert.equal(n.futureField, 7);
  assert.equal(n.grids[0].axis, 'x');
  assert.deepEqual(n.tds[0].engineer, { regionClear: null, cantileverOk: null, closureTol: '' });
  assert.equal(n.loads[0].segments[0].w2, '');
  assert.equal(n.diaphragm.sheathing, 'wsp');
  assert.deepEqual(normalizeInputs(clone(n)), n, 'idempotent');
});

test('ELF link: level F_x follows the linked item; a renamed level is reported', () => {
  const inputs = defaultInputs();
  inputs.level = { name: 'Roof', fx: '10' };
  const linked = { elfSource: { elfTable: [{ level: 'Roof', fx: 12.5 }, { level: '2nd', fx: 8 }] } };
  assert.equal(diaphragmAnalysis.linkDiff(inputs, linked).length, 1);
  diaphragmAnalysis.applyLinks(inputs, linked);
  assert.equal(inputs.level.fx, '12.5');
  assert.equal(diaphragmAnalysis.linkDiff(inputs, linked).length, 0);
  assert.ok(near(calcAll(inputs).q, 12500 / 5000));
  inputs.level.name = 'Penthouse';
  assert.equal(diaphragmAnalysis.linkDiff(inputs, linked)[0].to, '(not in ELF)');
});

test('frozen fixtures (tests/fixtures/legacy-td/): open, no value lost, same ΣA', () => {
  const files = fs.existsSync(fixDir) ? fs.readdirSync(fixDir).filter(f => /^schema\d+-.*\.json$/.test(f)) : [];
  assert.ok(files.length >= 1, 'at least one fixture');
  for (const f of files) {
    const fx = JSON.parse(fs.readFileSync(path.join(fixDir, f), 'utf8'));
    const m = migrateItem({ schemaVersion: fx.schemaVersion, inputs: clone(fx.inputs) });
    assert.deepEqual(lostValues(fx.inputs, m.inputs).filter(l => !l.startsWith('schemaVersion')), [], f + ' no loss');
    assert.ok(near(calcAll(m.inputs).sumA, fx.sumA), f + ' ΣA');
    openAndSave(clone(m.inputs));
  }
});

// ── diaphragm pieces (schema 2, user 2026-11-02) ──
const pieces = d => d.parts.map(q => [q.x1, q.x2, q.y1, q.y2].map(Number));
// every number of the analysis (cases: basic shear, line forces, TD runs, net field, members), rounded
const resultDigest = r => JSON.stringify(r.analysis, (k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v));

test('pieces: a schema-1 rectangle opens as pieces cut at the depth changes / around the opening; rectangle kept; same results', () => {
  const ex = { 'schema1-ex35-rect-diaphragm.json': ['Ex3.5', [[0, 40, 14, 50], [40, 90, 0, 50], [90, 120, 0, 20]]],
    'schema1-ex51-rect-diaphragm-opening.json': ['Ex5.1', [[0, 15, 0, 50], [15, 39, 0, 16], [15, 39, 40, 50], [39, 160, 0, 50]]] };
  for (const [f, [id, want]] of Object.entries(ex)) {
    const fx = JSON.parse(fs.readFileSync(path.join(fixDir, f), 'utf8'));
    const m = migrateItem({ schemaVersion: 1, inputs: clone(fx.inputs) });
    assert.equal(m.inputs.schemaVersion, TD_SCHEMA);
    const d = m.inputs.diaphragms[0];
    assert.deepEqual(pieces(d), want, id + ' pieces');
    assert.deepEqual([d.x1, d.x2, d.y1, d.y2], [fx.inputs.diaphragms[0].x1, fx.inputs.diaphragms[0].x2, fx.inputs.diaphragms[0].y1, fx.inputs.diaphragms[0].y2], 'rectangle kept for the record');
    const r = calcAll(m.inputs), rb = calcAll(bookToInputs(books.find(b => b.id === id)));
    assert.equal(r.status, 'ok', id + ' no hard-check error after the upgrade');
    assert.ok(r.analysis.cases.length >= 1);
    assert.equal(resultDigest(r), resultDigest(rb), id + ' every analysis value the same as the book layout');
    assert.deepEqual(migrateItem(clone(m)).inputs, m.inputs, 'idempotent');
  }
});

test('pieces: book layouts — Ex 3.5 is one diaphragm of 3 pieces (1–2 C–A, 2–5 D–A, 5–6 D–B), drawn as one 8-corner outline', () => {
  const inputs = bookToInputs(books.find(b => b.id === 'Ex3.5'));
  const d = inputs.diaphragms[0];
  assert.equal(inputs.diaphragms.length, 1);
  assert.deepEqual(pieces(d), [[0, 40, 14, 50], [40, 90, 0, 50], [90, 120, 0, 20]]);
  const { pieceEdges } = editorMod;
  const pl = parsePlan(inputs);
  const { outer, inner } = pieceEdges(pl.diaphragms[0].parts);
  const len = e => Math.abs(e[2] - e[0]) + Math.abs(e[3] - e[1]);
  assert.equal(outer.reduce((t, e) => t + len(e), 0), 2 * (120 + 50), 'outer edges = the outline perimeter (notched corners keep 2(L + B))');
  assert.equal(inner.length, 2, 'two edges between pieces (at 2 and at 5)');
  const html = drawPlan(pl, { ...newEditorState(), dir: 'y', sel: { kind: 'diaphragm', id: d.id } }, [], {}).svg.outerHTML;
  for (const n of ['D1.1', 'D1.2', 'D1.3']) assert.ok(html.includes('>' + n + '<'), 'selected diaphragm shows ' + n);
  for (const b of books) {
    const i = bookToInputs(b);
    for (const dg of i.diaphragms) assert.ok(dg.parts.length >= 1, b.id + ' ' + dg.mark);
  }
});

test('pieces: hard checks — over an opening, outside the outline, overlapping, apart; TD across a notch', () => {
  const base = bookToInputs(books.find(b => b.id === 'Ex5.1'));
  const codesOf = i => planErrors(parsePlan(i)).filter(e => !e.warn).map(e => e.code);
  assert.deepEqual(codesOf(base), []);
  const over = clone(base); over.diaphragms[0].parts = [{ id: 'q', x1: '0', x2: '160', y1: '0', y2: '50' }];
  assert.deepEqual(codesOf(over), ['dg-part-opening'], 'a piece over the opening');
  const out = bookToInputs(books.find(b => b.id === 'Ex3.5')); out.diaphragms[0].parts[0].y1 = '0';
  assert.deepEqual(codesOf(out), ['dg-part-outside'], 'a piece past the notch');
  const lap = clone(base); lap.diaphragms[0].parts[3].x1 = '30'; lap.diaphragms[0].parts[3].y1 = '0';
  assert.ok(codesOf(lap).includes('dg-part-overlap'));
  const apart = clone(base); apart.diaphragms[0].parts.splice(0, 1, { id: 'z', x1: '0', x2: '10', y1: '0', y2: '50' });
  assert.ok(codesOf(apart).includes('dg-split'), 'a piece that touches no other');
  const ex41 = bookToInputs(books.find(b => b.id === 'Ex4.1'));
  ex41.tds[0].x2 = '40'; // TD1 0–40: its corners and centre are on sheathing, but it crosses the notch 15–35 below y 10
  assert.ok(codesOf(ex41).includes('td-outside'), 'TD check is exact (not corners only)');
  assert.equal(calcAll(over).status !== 'ok', true, 'a hard check stops the analysis');
});

test('pieces: Fill between supports, + Piece tool, Delete removes the selected piece first', () => {
  const { fillBetweenSupports } = editorMod;
  const inputs = bookToInputs(books.find(b => b.id === 'Ex3.5'));
  const d = inputs.diaphragms[0];
  const want = pieces(d);
  d.parts = [];
  assert.ok(codesOfAll(inputs).includes('dg-parts'));
  const st = newEditorState();
  assert.equal(fillBetweenSupports(inputs, parsePlan(inputs), d.id, st), 3);
  assert.deepEqual(pieces(d), want, 'fill gives the same pieces as the book layout');
  // Ex 3.3: D2 (25–125, supports C / A, load along x) filled with D1 present takes only the free sheathing
  const e33 = bookToInputs(books.find(b => b.id === 'Ex3.3'));
  const d2 = e33.diaphragms[1], w2 = pieces(d2);
  d2.parts = [];
  fillBetweenSupports(e33, parsePlan(e33), d2.id, st);
  assert.deepEqual(pieces(d2), w2, 'same as the book layout (D2 = 25–125 × C–A)');
  assert.ok(!planErrors(parsePlan(e33)).some(e => e.code === 'dg-overlap'), 'never overlaps D1');
  // + Piece: select D1, draw over the whole plan → nothing free; delete a piece, draw it again → added back
  st.sel = { kind: 'diaphragm', id: d.id, part: d.parts[2].id };
  assert.ok(deleteSelected(inputs, st));
  assert.equal(d.parts.length, 2, 'only the selected piece is deleted');
  st.tool = 'piece'; st.dir = 'y';
  applyClick(inputs, parsePlan(inputs), st, { x: 0, y: 0 });
  assert.ok(applyClick(inputs, parsePlan(inputs), st, { x: 120, y: 50 }, 10));
  assert.deepEqual(pieces(d), want.slice(0, 2).concat([[90, 120, 0, 20]]));
  st.tool = 'piece'; st.sel = null;
  applyClick(inputs, parsePlan(inputs), st, { x: 0, y: 0 });
  assert.ok(/Select the diaphragm/.test(st.message), 'the piece tool needs a selected diaphragm');
});
function codesOfAll(i) { return planErrors(parsePlan(i)).map(e => e.code); }

test('Plan tab filter: diaphragms, TDs and openings can be hidden (view only)', () => {
  const inputs = bookToInputs(books.find(b => b.id === 'Ex5.1'));
  const pl = parsePlan(inputs);
  const on = newEditorState();
  const all = drawPlan(pl, on, []).svg.outerHTML;
  assert.ok(all.includes('>TD1<') && all.includes('>OP1<') && all.includes('>D1<'));
  const off = { ...newEditorState(), layers: { diaphragms: false, tds: false, openings: false } };
  const none = drawPlan(pl, off, []).svg.outerHTML;
  assert.ok(!none.includes('>TD1<') && !none.includes('>OP1<') && !none.includes('>D1<'));
  const box = document.createElement('div');
  const st = newEditorState();
  box.appendChild(editorMod.renderPlanEditor({ inputs, plan: pl, errors: [], state: st, refresh() {} }));
  assert.equal(box.querySelectorAll('input[data-layer]').length, 3, 'three show / hide boxes on the Plan tab');
  assert.deepEqual(inputs, bookToInputs(books.find(b => b.id === 'Ex5.1')), 'nothing stored');
});

console.log(passed + ' passed');
