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
test('all 7 book layouts: convert, valid, ΣA = book area, panels sum to ΣA, TD lines resolve', () => {
  assert.equal(books.length, 7);
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
  assert.deepEqual(names(td.loads.map(l => l.gridId)), ['C'], 'inner grid y = 20 is the load line');
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
  assert.equal(planErrors(plan()).length, 0);
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
  st.tool = 'diaphragm'; st.dir = 'x';
  applyClick(inputs, plan(), st, { x: 0, y: 0 });
  assert.ok(applyClick(inputs, plan(), st, { x: 100, y: 50 }, 10));
  const d = inputs.diaphragms[inputs.diaphragms.length - 1];
  assert.equal(d.dir, 'x');
  assert.equal(d.mark, 'D2', 'next mark in the x direction');
  assert.deepEqual(d.supports.map(gname), ['B', 'A'], 'load along x spans between ↔ lines at its ends');
  st.tool = 'td'; st.dir = 'y';
  applyClick(inputs, plan(), st, { x: 0, y: 0.3 });          // a little off grid B (y = 0) and A (y = 50)
  assert.ok(applyClick(inputs, plan(), st, { x: 15, y: 49.6 }, 10));
  const t = inputs.tds[0];
  assert.equal(t.dir, 'y');
  assert.deepEqual(t.supports.map(gname), ['A', 'B']);
  assert.deepEqual(t.loads.map(l => gname(l.gridId)), ['C']);
  // the panel's support selects show A and B
  const box = document.createElement('div');
  diaphragmAnalysis.renderForm(box, inputs, () => {}, [], () => {}, {});
  [...box.querySelectorAll('button')].find(b => b.textContent.startsWith('Plan')).dispatchEvent(new window.Event('click'));
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
  two.diaphragms.push({ ...clone(d), id: 'd2', mark: 'D2', x1: '50', x2: '100' });
  assert.ok(calcAll(two).errors.some(e => e.code === 'dg-overlap'));
  const half = clone(inputs);
  half.diaphragms.find(x => x.dir === 'y').x2 = '60';
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
  st.tool = 'diaphragm'; st.dir = 'y';
  applyClick(inputs, plan(), st, { x: 0.4, y: 0.3 });
  assert.ok(applyClick(inputs, plan(), st, { x: 59.6, y: 49.7 }, 10));
  const d = inputs.diaphragms[inputs.diaphragms.length - 1];
  assert.deepEqual([d.x1, d.x2, d.y1, d.y2], ['0', '60', '0', '50'], 'edges snapped onto 1 / 3 / B / A');
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
  assert.ok(setEdge(inputs, plan, 'diaphragm', d.id, 'x2', 60));
  assert.equal(d.x2, '60');
  assert.equal(d.supports[1], g3.id, 'support 2 (old edge) → grid 3 (new edge)');
  assert.ok(!setEdge(inputs, parsePlan(inputs), 'diaphragm', d.id, 'x2', 0.2), 'no zero-width rectangle');
  assert.ok(setEdge(inputs, parsePlan(inputs), 'diaphragm', d.id, 'x1', 70), 'dragging past the other edge flips');
  assert.deepEqual([d.x1, d.x2], ['60', '70']);
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
  for (const tool of ['Grid ↕', 'Outline', 'TD', 'Select']) assert.ok(click(b => b.textContent === tool), 'tool ' + tool);
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

console.log(passed + ' passed');
