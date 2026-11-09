// Diaphragm Analysis — grid lines (user 2026-11-05): N-S / E-W tabs on the Grids & outline page, and grids that stop
// early (extent from / to along the grid: y1–y2 for a ↕ grid, x1–x2 for a ↔ grid; blank = across the whole plan).
// Run: node tests/diaphragmAnalysisGrids.test.mjs
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
const { parsePlan, planErrors, detectTdLoads, gridReaches, gridCovers } = await import('../src/modules/tdGeometry.js');
const { normalizeInputs } = await import('../src/modules/tdMigrate.js');
const { newGrid, newWall, newTd, newDiaphragm } = await import('../src/modules/tdModel.js');
const editorMod = await import('../src/modules/tdPlanEditor.js');
const { snapPoint, newEditorState, drawPlan, renderPlanEditor } = editorMod;
const { bookToInputs } = await import('./td-book/src/toInputs.mjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const bookDir = path.join(here, 'td-book');
const books = fs.readdirSync(bookDir).filter(f => /^Ex\d+\.\d+\.json$/.test(f)).sort()
  .map(f => JSON.parse(fs.readFileSync(path.join(bookDir, f), 'utf8')));
const userDir = path.join(here, 'fixtures', 'da-user');
const userItems = fs.readdirSync(userDir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(userDir, f), 'utf8')));
const clone = v => JSON.parse(JSON.stringify(v));
const codes = errs => errs.map(e => e.code);

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; }
}

// 26997-like 2nd floor: outline x 0–70, y 0–100; grids 1 / 3 (↕), A / B / D (↔)
function base() {
  const g = { g1: newGrid('1', 'x', 0), g3: newGrid('3', 'x', 70), gA: newGrid('A', 'y', 0), gB: newGrid('B', 'y', 20), gD: newGrid('D', 'y', 100) };
  const inputs = normalizeInputs({
    grids: Object.values(g), outline: [{ x: '0', y: '0' }, { x: '70', y: '0' }, { x: '70', y: '100' }, { x: '0', y: '100' }],
    openings: [], walls: [], tds: [], diaphragms: [], loads: [], level: { name: 'L', fx: '' },
  });
  return { inputs, g };
}

test('old items: grids get from / to = "" on open, reach everywhere; book and user plans give the same checks (no grid-extent)', () => {
  for (const b of books) {
    const raw = bookToInputs(b);
    raw.grids.forEach(g => { delete g.from; delete g.to; });
    const inputs = normalizeInputs(clone(raw));
    assert.ok(inputs.grids.every(g => g.from === '' && g.to === ''), b.id + ': normaliser fills from / to');
    const pl = parsePlan(inputs);
    assert.ok(pl.grids.every(g => g.lo === -Infinity && g.hi === Infinity), b.id);
    assert.ok(!codes(planErrors(pl)).includes('grid-extent'), b.id);
    assert.deepEqual(codes(planErrors(pl)), codes(planErrors(parsePlan(normalizeInputs(clone(raw)))))); // stable
  }
  for (const it of userItems) {
    const inputs = normalizeInputs(clone(it.inputs || it));
    assert.ok(!codes(planErrors(parsePlan(inputs))).includes('grid-extent'));
  }
});

test('extent: blank ends are open, order does not matter, gridReaches / gridCovers', () => {
  const { inputs, g } = base();
  g.gB.from = '30'; g.gB.to = '0'; // typed backwards
  let pl = parsePlan(inputs);
  const B = pl.gridById.get(g.gB.id);
  assert.equal(B.lo, 0); assert.equal(B.hi, 30);
  assert.ok(gridReaches(B, 30) && !gridReaches(B, 31) && gridCovers(B, 5, 25) && !gridCovers(B, 5, 40));
  g.gB.from = ''; g.gB.to = '30';
  pl = parsePlan(inputs);
  assert.equal(pl.gridById.get(g.gB.id).lo, -Infinity);
  assert.ok(gridReaches(pl.gridById.get(g.gB.id), -500));
  g.gB.from = '10'; g.gB.to = '10';
  assert.ok(codes(planErrors(parsePlan(inputs))).includes('grid-extent'), 'zero extent');
});

test('grid-extent: a wall past the end of its grid; a diaphragm / TD on a grid that does not reach across', () => {
  const { inputs, g } = base();
  g.gB.from = '0'; g.gB.to = '30';
  const w = newWall(g.gB.id, '20', '35'); w.mark = 'SW-1';
  inputs.walls.push(w);
  let errs = planErrors(parsePlan(inputs));
  assert.ok(errs.some(e => e.code === 'grid-extent' && /SW-1/.test(e.msg) && /grid B/.test(e.msg)), 'wall past the end');
  w.to = '30';
  assert.ok(!codes(planErrors(parsePlan(inputs))).includes('grid-extent'), 'wall inside the extent');
  // diaphragm along x (supports A / D) — A stops at x 50, the diaphragm runs x 0–70
  g.gA.from = '0'; g.gA.to = '50';
  const d = newDiaphragm('D1', 'x', [{ x1: 0, x2: 70, y1: 0, y2: 100 }], [g.gA.id, g.gD.id]);
  inputs.diaphragms.push(d);
  errs = planErrors(parsePlan(normalizeInputs(inputs)));
  assert.ok(errs.some(e => e.code === 'grid-extent' && /support grid A/.test(e.msg)), codes(errs).join(','));
  g.gA.to = '';
  errs = planErrors(parsePlan(normalizeInputs(inputs)));
  assert.ok(!codes(errs).includes('grid-extent'), codes(errs).join(','));
  // TD on 1 / 3 across y 10–30, its support 3 stops at y 25
  g.g3.from = '0'; g.g3.to = '25';
  const t = newTd('TD1', 0, 70, 10, 30, 'y'); t.supports = [g.g1.id, g.g3.id];
  inputs.tds.push(t);
  errs = planErrors(parsePlan(normalizeInputs(inputs)));
  assert.ok(errs.some(e => e.code === 'grid-extent' && /grid 3/.test(e.msg) && /TD/.test(e.msg)), codes(errs).join(','));
});

test('grid-off-plan: a bounded grid whose extent misses the plan', () => {
  const { inputs, g } = base();
  g.gB.from = '80'; g.gB.to = '120'; // the plan is x 0–70
  const e = planErrors(parsePlan(inputs)).find(x => x.code === 'grid-off-plan');
  assert.ok(e && /B/.test(e.msg));
  g.gB.from = '60';
  assert.ok(!codes(planErrors(parsePlan(inputs))).includes('grid-off-plan'));
});

test('snapping: a bounded grid snaps only where it runs', () => {
  const { inputs, g } = base();
  g.gB.from = '0'; g.gB.to = '30';
  const pl = parsePlan(inputs);
  assert.equal(snapPoint(pl, 10, 20.2, 20).onGridY, true, 'inside the extent');
  assert.equal(snapPoint(pl, 50, 20.2, 20).onGridY, false, 'past its end');
});

test('drawing: a bounded grid is drawn over its extent with a bubble at each end; an open grid as before', () => {
  const { inputs, g } = base();
  const before = drawPlan(parsePlan(inputs), newEditorState(), []).svg.outerHTML;
  const bubbles = html => (html.match(/<circle[^>]*r="10"/g) || []).length;
  g.gB.from = '0'; g.gB.to = '30';
  const after = drawPlan(parsePlan(inputs), newEditorState(), []).svg.outerHTML;
  assert.equal(bubbles(after), bubbles(before) + 1, 'second bubble on the bounded grid');
  g.gB.from = ''; g.gB.to = '';
  assert.equal(drawPlan(parsePlan(inputs), newEditorState(), []).svg.outerHTML, before, 'open grids draw exactly as before');
});

test('TD load lines (Auto): a bounded grid that stops before the TD edge is not a load line', () => {
  // Ex 3.3 has auto load lines found from the plan; bound each found load grid short of both TD edges
  let checked = 0;
  for (const b of books) {
    const inputs = normalizeInputs(bookToInputs(b));
    const pl = parsePlan(inputs);
    for (const t of pl.tds) {
      const found = detectTdLoads(pl, t);
      if (!found.length) continue;
      const lg = found[0].grid;
      const raw = inputs.grids.find(x => x.id === lg.id);
      const [e1, e2] = lg.axis === 'y' ? [t.x1, t.x2] : [t.y1, t.y2];
      const save = { from: raw.from, to: raw.to };
      raw.from = String(e1 + 0.25 * (e2 - e1)); raw.to = String(e1 + 0.75 * (e2 - e1)); // inside the TD, reaching neither edge
      const pl2 = parsePlan(inputs);
      const t2 = pl2.tds.find(x => x.id === t.id);
      assert.ok(!detectTdLoads(pl2, t2).some(f => f.grid.id === lg.id), b.id + ' ' + t.mark + ' grid ' + lg.name);
      Object.assign(raw, save);
      checked++;
    }
  }
  assert.ok(checked >= 10, 'checked ' + checked + ' TDs');
});

test('Grids & outline page: N-S / E-W tabs, extent columns, + Grid adds to the open tab, picking a grid opens its tab', () => {
  const { inputs, g } = base();
  const st = newEditorState(); st.page = 'geometry';
  const render = () => { const box = document.createElement('div'); box.appendChild(renderPlanEditor({ inputs, plan: parsePlan(inputs), errors: [], state: st, refresh() {} })); return box; };
  let box = render();
  assert.equal(box.querySelectorAll('button[data-gridtab]').length, 2);
  let rows = [...box.querySelectorAll('table[data-gridtable] tr[data-selrow]')];
  assert.equal(box.querySelector('table[data-gridtable]').getAttribute('data-gridtable'), 'x');
  assert.deepEqual(rows.map(r => r.getAttribute('data-selrow')), [g.g1, g.g3].map(x => 'grid:' + x.id), 'N-S tab lists the ↕ grids');
  assert.ok(box.textContent.includes('y1') && box.textContent.includes('y2'));
  box.querySelector('button[data-gridtab="y"]').dispatchEvent(new window.Event('click'));
  box = render();
  rows = [...box.querySelectorAll('table[data-gridtable] tr[data-selrow]')];
  assert.equal(rows.length, 3, 'E-W tab lists A / B / D');
  assert.ok(box.textContent.includes('x1') && box.textContent.includes('x2'));
  const n = inputs.grids.length;
  box.querySelector('button[data-addgrid]').dispatchEvent(new window.Event('click'));
  assert.equal(inputs.grids.length, n + 1);
  assert.equal(inputs.grids[n].axis, 'y', '+ Grid adds an E-W grid on the E-W tab');
  assert.equal(inputs.grids[n].from, ''); assert.equal(inputs.grids[n].to, '');
  st.sel = { kind: 'grid', id: g.g1.id };
  box = render();
  assert.equal(box.querySelector('table[data-gridtable]').getAttribute('data-gridtable'), 'x', 'a picked ↕ grid opens the N-S tab');
});

// ---- one grid for all levels (user 2026-11-05, comment 1): a DA item uses the grids of another DA item (the owner)
const { getModule } = await import('../src/modules/registry.js');
const { linkChanges, applyLinkUpdates } = await import('../src/results.js');
const { sharedGrids, gridShareDiff, applyGridShare } = await import('../src/modules/tdGridShare.js');
const daMod = getModule('diaphragm_analysis');
const hov = f => { const j = JSON.parse(fs.readFileSync(path.join(userDir, f), 'utf8')); return { id: j.id, type: j.type, label: f, custom_name: f === 'hov-roof.json' ? 'DA - Roof' : 'DA - 2nd Floor', schemaVersion: j.schemaVersion, inputs: j.inputs }; };

test('shared grids: the 2nd floor uses the Roof\'s grids — picked on the grid page; ids kept by name; grid page read-only; owner list leaves out itself', () => {
  const roof = hov('hov-roof.json'), flr = hov('hov-2nd.json');
  const ids = Object.fromEntries(flr.inputs.grids.map(g => [g.name, g.id]));
  let saved = null;
  const c = document.createElement('div');
  daMod.renderForm(c, clone(flr.inputs), x => { saved = x; }, [roof, flr], () => {}, { itemId: flr.id });
  const pick = c.querySelector('select[data-gridshare]');
  assert.ok(pick, 'grid page has the "Grid lines" choice');
  assert.deepEqual([...pick.querySelectorAll('option')].map(o => o.textContent), ['own (this item owns them)', 'shared from DA - Roof'], 'itself left out');
  for (const o of pick.querySelectorAll('option')) { if (o.getAttribute('value') === roof.id) o.setAttribute('selected', ''); else o.removeAttribute('selected'); }
  pick.dispatchEvent(new window.Event('change'));
  const sel2 = c.querySelector('select[data-gridshare]');
  assert.equal(sel2.value, roof.id, 'shared from DA - Roof');
  assert.equal(c.querySelectorAll('table[data-gridtable] input[type=number]').length, 0, 'read-only tables');
  assert.equal(c.querySelectorAll('button[data-addgrid]').length, 0, 'no + Grid');
  assert.equal(c.querySelectorAll('button[data-gridlock]').length, 0, 'no lock button (shared)');
  // the copy has the Roof's values: grids 1 / 2 / 3 run across the whole plan (the 2nd floor had y 0–100)
  const row1 = c.querySelector('table[data-gridtable="x"] tr[data-selrow="grid:' + ids['1'] + '"]');
  assert.ok(row1, 'grid 1 keeps its id');
  assert.deepEqual([...row1.querySelectorAll('td')].slice(0, 4).map(td => td.textContent.trim()), ['1', '0', '', '']);
});

test('shared grids: owner change → update notice (by grid), Update brings it in, ids kept; a grid only here warns grid-local', () => {
  const roof = hov('hov-roof.json'), flr = hov('hov-2nd.json');
  flr.inputs.refs = { ...(flr.inputs.refs || {}), gridSource: roof.id };
  applyGridShare(flr.inputs, { grids: sharedGrids(roof.inputs) });
  assert.deepEqual(linkChanges(daMod, flr, [roof, flr]).filter(c => c.refKey === 'gridSource'), [], 'in step');
  roof.inputs.grids.find(g => g.name === '2').at = '12';
  roof.inputs.grids.find(g => g.name === 'B').from = '10';
  const ch = linkChanges(daMod, flr, [roof, flr]).filter(c => c.refKey === 'gridSource');
  assert.deepEqual(ch.map(c => c.label).sort(), ['Grid 2 (↕) position', 'Grid B (↔) start']);
  const id2 = flr.inputs.grids.find(g => g.name === '2').id;
  const up = applyLinkUpdates(daMod, flr.inputs, [roof, flr], flr.id);
  assert.equal(up.grids.find(g => g.name === '2').at, '12'); assert.equal(up.grids.find(g => g.name === '2').id, id2);
  assert.equal(up.grids.find(g => g.name === 'B').from, '10');
  // a grid the owner does not have
  up.grids.push(newGrid('4', 'x', 40));
  const r = daMod.calc(up, { gridSource: { grids: sharedGrids(roof.inputs) } });
  assert.ok(r.warnings.some(w => w.code === 'grid-local' && /4/.test(w.msg)));
  // an owner grid added there is added here
  roof.inputs.grids.push(newGrid('5', 'x', 50));
  assert.ok(gridShareDiff(up, { grids: sharedGrids(roof.inputs) }).some(c => /Grid 5/.test(c.label) && c.from === '(missing here)'));
});

console.log(passed + ' passed');
