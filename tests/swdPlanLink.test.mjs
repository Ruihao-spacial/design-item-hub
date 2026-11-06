// SWD ↔ DA grid link (user 2026-11-05, build step 3) on the user's project 26997 "Horizontal Offset Walls"
// (tests/fixtures/da-user/hov-*.json): only an SWD item linked to DA that adopted the plan grids changes; adoption keeps
// every wall where DA puts it today; the line start is the same for every level; moving it keeps the elements on the
// plan; the elevation shows the crossing grids and each level's diaphragm stretch; DA takes the start from SWD, stops
// the line-length check for those lines and warns when its grids differ from SWD's copy.
// Run: node tests/swdPlanLink.test.mjs
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
const { calcAll: daCalc } = await import('../src/modules/diaphragmAnalysis.js');
const PL = await import('../src/modules/shearWallPlanLink.js');
const { renderElevation, renderElevationForPdf, setElevationPlan } = await import('../src/modules/shearWallElevation.js');
const { fingerprint } = await import('../scripts/lib/swdFreeze.mjs');

const swdMod = getModule('shear_wall_design');
const clone = v => JSON.parse(JSON.stringify(v));
const load = f => JSON.parse(fs.readFileSync(new URL('./fixtures/da-user/' + f, import.meta.url), 'utf8'));
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 5).join('\n       ')); process.exitCode = 1; }
}

const swdItem = load('hov-swd.json'), roofItem = load('hov-roof.json'), flrItem = load('hov-2nd.json');
const swdInputs = () => swdMod.migrate({ schemaVersion: swdItem.schemaVersion, inputs: clone(swdItem.inputs) }).inputs;
const daRun = (item, swdDef) => daCalc(normalizeInputs(clone(item.inputs)), { wallSource: swdExtract(swdDef) });
const ref = swdMod.refs.find(r => r.key === 'diaphragmSources');
const sourcesOf = (swdDef, extra = {}) => [[roofItem, 'roof'], [flrItem, '2nd']].map(([it, k]) => ({ id: it.id, ...ref.extract(daRun(extra[k] || it, swdDef)) }));
const lineByName = (inp, n) => inp.directions.flatMap(d => d.lines).find(l => l.name === n);
const codes = out => [...out.errors, ...out.warnings].map(e => e.code);

test('before adoption: nothing changes — DA outputs grids and line stretches; SWD stores nothing, no grid layer', () => {
  const inp = swdInputs();
  const roof = daRun(roofItem, inp);
  assert.ok(roof.planGrids.length === 7 && roof.planGrids.every(g => 'from' in g && 'to' in g));
  const B = roof.wallLink.lines.find(l => l.name === 'B');
  assert.equal(B.at, 20); assert.equal(B.axis, 'y'); assert.deepEqual(B.bands, [[10, 70]]); assert.equal(B.origin, 10); assert.equal(B.originFromSwd, false);
  assert.ok(!PL.planLinkOn(inp));
  assert.equal(PL.planViewOf(inp, lineByName(inp, 'B')), null);
  // freeze fingerprint of this item is the same with the DA items ticked but not adopted
  const ticked = clone(inp); ticked.refs = { ...(ticked.refs || {}), diaphragmSources: [roofItem.id, flrItem.id] };
  assert.equal(swdMod.linkDiff(ticked, { diaphragmSources: sourcesOf(ticked) }).filter(c => /grid link/.test(c.label)).length, 0);
  const c = document.createElement('div');
  renderElevation(c, lineByName(inp, 'B'), inp.levels, inp.wallDLTypes || [], {}).drawSVG();
  assert.ok(!c.innerHTML.includes('data-planlayer'));
});

test('link-length (fixed): only lines with walls at the DA level are compared — the roof no longer errors on 1 / A / D', () => {
  const inp = swdInputs();
  const roof = daRun(roofItem, inp);
  const ll = roof.errors.filter(e => e.code === 'link-length').map(e => e.msg.split(' ')[1]);
  assert.ok(!ll.includes('1') && !ll.includes('A') && !ll.includes('D'), ll.join(','));
});

test('adopt: snapshot of the top level\'s DA grids; each line starts where DA puts it today (no wall moves); levels that differ are listed', () => {
  const inp = swdInputs();
  inp.refs = { ...(inp.refs || {}), diaphragmSources: [roofItem.id, flrItem.id] };
  const sources = sourcesOf(inp);
  assert.equal(PL.defaultSourceId(inp, sources), roofItem.id, 'top level (Roof) by default');
  const before = daRun(roofItem, inp).wallLink.lines.map(l => [l.name, l.origin]);
  const res = PL.adoptPlanLink(inp, sources, roofItem.id);
  assert.ok(PL.planLinkOn(inp));
  assert.equal(inp.planLink.grids.length, 7);
  assert.deepEqual(inp.planLink.lines[lineByName(inp, 'B').id], { grid: 'B', axis: 'y', at: 20 });
  for (const [n, o] of before) assert.equal(parseFloat(lineByName(inp, n).planOrigin), o, 'line ' + n);
  assert.ok(res.differ.some(d => d.name === 'B'), 'B: roof 10, 2nd floor 0');
  // DA of both levels now takes the start from SWD; the roof walls are where they were
  const roofAfter = daRun(roofItem, inp), flrAfter = daRun(flrItem, inp);
  const Br = roofAfter.wallLink.lines.find(l => l.name === 'B'), Bf = flrAfter.wallLink.lines.find(l => l.name === 'B');
  assert.ok(Br.originFromSwd && Bf.originFromSwd); assert.equal(Br.origin, 10); assert.equal(Bf.origin, 10, 'same start on every level');
  assert.ok(!codes(roofAfter).includes('link-length') && !codes(flrAfter).includes('link-length'), 'no length check with a fixed start');
  // line length from the plan: B starts at x 10, longest stretch ends at x 70 (both levels) → 60; line 1 (no roof
  // stretch) 0 → 100 (2nd floor y 0–100)
  assert.equal(String(lineByName(inp, 'B').totalLength), '60');
  assert.equal(String(lineByName(inp, '1').totalLength), '100');
  // the stored definition: only planLink, planOrigin and the line lengths changed
  const a = clone(swdInputs()), b = clone(inp);
  delete b.planLink; delete b.refs.diaphragmSources; if (!Object.keys(b.refs).length && !Object.keys(a.refs || {}).length) { b.refs = a.refs; }
  b.directions.forEach((d, i) => d.lines.forEach((l, j) => { delete l.planOrigin; l.totalLength = a.directions[i].lines[j].totalLength; }));
  assert.deepEqual(b, a);
});

test('plan view and elevation layer: crossing grids, each level\'s diaphragm stretch; calc unchanged', () => {
  const inp = swdInputs();
  inp.refs = { ...(inp.refs || {}), diaphragmSources: [roofItem.id, flrItem.id] };
  const resBefore = JSON.stringify(swdMod.calc(clone(inp)));
  PL.adoptPlanLink(inp, sourcesOf(inp), roofItem.id);
  const B = lineByName(inp, 'B');
  const pv = PL.planViewOf(inp, B);
  assert.deepEqual(pv.cross.map(c => [c.name, c.x]), [['1', -10], ['2', 0], ['3', 60]]);
  const lvRoof = inp.levels.find(l => l.name === 'Roof'), lv2 = inp.levels.find(l => l.name === '2nd Floor');
  assert.deepEqual(pv.extents.find(e => e.levelId === lvRoof.id).segs, [[0, 60]], 'roof diaphragm on B: x 10–70');
  assert.deepEqual(pv.extents.find(e => e.levelId === lv2.id).segs, [[-10, 60]], '2nd floor on B: x 0–70');
  assert.equal(JSON.stringify(swdMod.calc(clone(inp))).replace(/"planOrigin":"[^"]*",?/g, ''), resBefore.replace(/"planOrigin":"[^"]*",?/g, ''), 'results unchanged');
  // elevation: layer with bubbles 2 and 3 (1 is before the line start), one stretch per level
  const c = document.createElement('div');
  setElevationPlan(B, pv);
  renderElevation(c, B, inp.levels, inp.wallDLTypes || [], {}).drawSVG();
  const html = c.innerHTML;
  assert.ok(html.includes('data-planlayer'));
  assert.deepEqual([...c.querySelectorAll('[data-grid]')].map(x => x.getAttribute('data-grid')), ['2', '3']);
  assert.equal(c.querySelectorAll('[data-extent]').length, 2);
  // PDF elevation of an adopted item carries the same layer (pdfSections)
  const out = swdMod.calc(clone(inp));
  const secs = swdMod.pdfSections(inp, out);
  const el = secs.find(s => s.elevation && /Line B|B —/.test(s.title || '')) || secs.find(s => s.elevation);
  assert.ok(el.elevation.renderFn().outerHTML.includes('data-planlayer'));
  setElevationPlan(B, null);
});

test('moving the line start keeps every element on the plan; the far end stays; DA walls do not move', () => {
  const inp = swdInputs();
  inp.refs = { ...(inp.refs || {}), diaphragmSources: [roofItem.id, flrItem.id] };
  PL.adoptPlanLink(inp, sourcesOf(inp), roofItem.id);
  const B = lineByName(inp, 'B');
  const placed = () => daRun(roofItem, inp).wallLink && swdExtract(inp).directions.flatMap(d => d.lines).find(l => l.id === B.id).walls
    .map(w => [w.mark, parseFloat(B.planOrigin) + w.position]);
  const was = placed(), len = parseFloat(B.totalLength), posts = (B.supportPosts || []).map(p => parseFloat(B.planOrigin) + parseFloat(p.position));
  PL.moveLineStart(B, 0); // start at grid 1
  PL.syncLineLength(inp, B);
  assert.equal(B.planOrigin, '0');
  assert.deepEqual(placed(), was, 'walls keep their plan location');
  assert.deepEqual((B.supportPosts || []).map(p => parseFloat(p.position)), posts, 'posts keep their plan location');
  assert.equal(parseFloat(B.totalLength), len + 10, 'far end kept (x 70 = end of the diaphragm stretches)');
  const roofAfter = daRun(roofItem, inp);
  const sw11 = roofAfter.wallLink && (roofAfter.wallLink.lines.find(l => l.name === 'B'));
  assert.equal(sw11.origin, 0);
});

test('update notice (user comment 2): no notice for an unchanged copy saved through the database (jsonb reorders object keys)', () => {
  const inp = swdInputs();
  inp.refs = { ...(inp.refs || {}), diaphragmSources: [roofItem.id, flrItem.id] };
  PL.adoptPlanLink(inp, sourcesOf(inp), flrItem.id);
  // jsonb-like: every object's keys in another order
  const shuffle = v => Array.isArray(v) ? v.map(shuffle) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).reverse().map(k => [k, shuffle(v[k])])) : v;
  inp.planLink = shuffle(inp.planLink);
  assert.equal(swdMod.linkDiff(inp, { diaphragmSources: sourcesOf(inp) }).filter(c => /grid link/.test(c.label)).length, 0);
});

test('update notice: a grid moved in DA makes the copy stale; Update refreshes it (never the line starts); grid-mismatch in DA', () => {
  const inp = swdInputs();
  inp.refs = { ...(inp.refs || {}), diaphragmSources: [roofItem.id, flrItem.id] };
  PL.adoptPlanLink(inp, sourcesOf(inp), roofItem.id);
  const starts = inp.directions.flatMap(d => d.lines).map(l => l.planOrigin);
  assert.equal(swdMod.linkDiff(inp, { diaphragmSources: sourcesOf(inp) }).filter(c => /grid link/.test(c.label)).length, 0, 'fresh copy');
  const moved = clone(roofItem); moved.inputs.grids.find(g => g.name === '2').at = '12';
  const src2 = sourcesOf(inp, { roof: moved });
  assert.equal(swdMod.linkDiff(inp, { diaphragmSources: src2 }).filter(c => /grid link/.test(c.label)).length, 1);
  swdMod.applyLinks(inp, { diaphragmSources: src2 });
  assert.equal(inp.planLink.grids.find(g => g.name === '2').at, 12);
  assert.deepEqual(inp.directions.flatMap(d => d.lines).map(l => l.planOrigin), starts, 'line starts kept');
  // the 2nd floor still has grid 2 at x 10 → grid-mismatch there
  const flr = daRun(flrItem, inp);
  assert.ok(flr.warnings.some(w => w.code === 'grid-mismatch' && /2/.test(w.msg)));
});

test('bounded grids: SWD sees only the grids that cross its line', () => {
  const inp = swdInputs();
  inp.refs = { ...(inp.refs || {}), diaphragmSources: [roofItem.id, flrItem.id] };
  const r = clone(roofItem); r.inputs.grids.find(g => g.name === '2').from = '20'; r.inputs.grids.find(g => g.name === '2').to = '80';
  PL.adoptPlanLink(inp, sourcesOf(inp, { roof: r }), roofItem.id);
  const A = lineByName(inp, 'A'), B = lineByName(inp, 'B');
  inp.directions.flatMap(d => d.lines).forEach(l => { if (!Number.isFinite(parseFloat(l.planOrigin))) l.planOrigin = '0'; });
  assert.ok(!PL.planViewOf(inp, A).cross.some(c => c.name === '2'), 'grid 2 (y 20–80) does not reach line A (y 0)');
  assert.ok(PL.planViewOf(inp, B).cross.some(c => c.name === '2'), 'it reaches line B (y 20)');
});

test('form: the Adopt panel shows only with ticked DA items; Adopt writes the link; Remove deletes it and the starts', () => {
  const inp = swdInputs();
  const items = [roofItem, flrItem].map(it => ({ id: it.id, type: 'diaphragm_analysis', custom_name: it.id === roofItem.id ? 'DA - Roof' : 'DA - 2nd Floor', inputs: it.inputs, outputs: daRun(it, inp) }));
  let c = document.createElement('div');
  swdMod.renderForm(c, clone(inp), () => {}, items, () => {});
  assert.equal(c.querySelectorAll('[data-gridlink]').length, 0, 'not ticked → no panel');
  const ticked = clone(inp); ticked.refs = { ...(ticked.refs || {}), diaphragmSources: [roofItem.id, flrItem.id] };
  let saved = null;
  c = document.createElement('div');
  swdMod.renderForm(c, ticked, x => { saved = x; }, items, () => {});
  const adopt = c.querySelector('[data-adoptgrids]');
  assert.ok(adopt, 'Adopt button');
  adopt.dispatchEvent(new window.Event('click'));
  assert.ok(c.querySelector('[data-dropgrids]'), 'adopted: Remove button shown');
  [...c.querySelectorAll('button')].find(b => b.textContent.trim() === 'E-W').dispatchEvent(new window.Event('click'));
  const start = c.querySelector('[data-linestart]');
  assert.ok(start, 'line header shows "Starts at"');
  assert.ok(Number.isFinite(parseFloat(start.value)), 'with the adopted start');
  [...c.querySelectorAll('button')].find(b => b.textContent.trim() === 'Summary / Config').dispatchEvent(new window.Event('click'));
  c.querySelector('[data-dropgrids]').dispatchEvent(new window.Event('click'));
  assert.ok(c.querySelector('[data-adoptgrids]'), 'removed: Adopt again');
});

test('freeze: an adopted item fingerprints differently only in its definition / form / elevations, not its results', () => {
  const inp = swdInputs();
  inp.refs = { ...(inp.refs || {}), diaphragmSources: [roofItem.id, flrItem.id] }; // linked in both: only the adoption differs
  const base = fingerprint({ schemaVersion: swdMod.schemaVersion, inputs: inp });
  const ad = clone(inp);
  PL.adoptPlanLink(ad, sourcesOf(ad), roofItem.id);
  const f = fingerprint({ schemaVersion: swdMod.schemaVersion, inputs: ad });
  assert.equal(f.parts.results, base.parts.results, 'same results');
  assert.notEqual(f.parts.definition, base.parts.definition, 'the definition holds the link');
  assert.notEqual(f.parts['line B · elevation'], base.parts['line B · elevation'], 'the elevation shows the grid layer');
});

test('user comment (Adopt panel): DA items that share one grid are one choice, named with the levels that use it', () => {
  const inp = swdInputs();
  const shared = clone(flrItem); shared.inputs.refs = { ...(shared.inputs.refs || {}), gridSource: roofItem.id };
  const mk = (it, name) => ({ id: it.id, type: 'diaphragm_analysis', custom_name: name, inputs: it.inputs, outputs: daRun(it, inp) });
  const ticked = clone(inp); ticked.refs = { ...(ticked.refs || {}), diaphragmSources: [roofItem.id, flrItem.id] };
  let c = document.createElement('div');
  swdMod.renderForm(c, clone(ticked), () => {}, [mk(roofItem, 'DA - Roof'), mk(shared, 'DA - 2nd Floor')], () => {});
  const one = c.querySelector('[data-gridsource]');
  assert.equal(one.tagName.toLowerCase(), 'span', 'one choice: no select');
  assert.match(one.textContent, /DA - Roof.*shared with DA - 2nd Floor/);
  c = document.createElement('div');
  swdMod.renderForm(c, clone(ticked), () => {}, [mk(roofItem, 'DA - Roof'), mk(flrItem, 'DA - 2nd Floor')], () => {});
  assert.equal(c.querySelector('[data-gridsource]').tagName.toLowerCase(), 'select', 'two own grids: a choice');
  assert.equal(c.querySelectorAll('[data-gridsource] option').length, 2);
});

test('user comment (C / D missing): an adopted item opens with its line lengths from the plan; an unadopted one is untouched', () => {
  const inp = swdInputs();
  inp.refs = { ...(inp.refs || {}), diaphragmSources: [roofItem.id, flrItem.id] };
  PL.adoptPlanLink(inp, sourcesOf(inp), roofItem.id);
  inp.directions.flatMap(d => d.lines).forEach(l => { PL.moveLineStart(l, 0); l.totalLength = 60; }); // as saved before the fix
  const opened = swdMod.migrate({ schemaVersion: swdMod.schemaVersion, inputs: clone(inp) }).inputs;
  assert.equal(String(lineByName(opened, '1').totalLength), '100', 'line 1: y 0–100 on the 2nd floor');
  assert.equal(String(lineByName(opened, 'B').totalLength), '70');
  const L1 = lineByName(opened, '1');
  const c = document.createElement('div');
  setElevationPlan(L1, PL.planViewOf(opened, L1));
  renderElevation(c, L1, opened.levels, opened.wallDLTypes || [], {}).drawSVG();
  assert.deepEqual([...c.querySelectorAll('[data-grid]')].map(x => x.getAttribute('data-grid')), ['A', 'B', 'C', 'D'], 'all four grids on line 1');
  setElevationPlan(L1, null);
  const plain = swdInputs();
  assert.deepEqual(swdMod.migrate({ schemaVersion: swdMod.schemaVersion, inputs: clone(plain) }).inputs, plain, 'unadopted: as stored');
});

test('user comment (zoom): − / + / Fit change only the view; at 100 % the drawing is the one without zoom', () => {
  const inp = swdInputs();
  const ln = lineByName(inp, 'A');
  const c = document.createElement('div');
  const h = renderElevation(c, ln, inp.levels, inp.wallDLTypes || [], {});
  h.drawSVG();
  const svgW = () => +c.querySelector('svg').getAttribute('width');
  const w0 = svgW(), html0 = c.querySelector('svg').outerHTML, line0 = JSON.stringify(ln);
  const btn = t => [...c.querySelectorAll('[data-elevzoom] button')].find(b => b.textContent === t);
  btn('+').dispatchEvent(new window.Event('click'));
  assert.ok(svgW() > w0 * 1.2, 'zoomed in: wider drawing (scrolls)');
  assert.equal(c.querySelector('[data-elevzoom] span').textContent, '125%');
  btn('Fit').dispatchEvent(new window.Event('click'));
  assert.equal(svgW(), w0);
  assert.equal(c.querySelector('svg').outerHTML, html0, 'Fit = the drawing as before');
  assert.equal(JSON.stringify(ln), line0, 'the line is not changed');
  // user comment: the controls sit at the right end of the toolbar row, after Find (no absolute buttons over it), and
  // stay there when the toolbar is rebuilt (mode change)
  const group = c.querySelector('[data-elevzoom]');
  const row = group.parentNode;
  assert.equal(row.lastChild, group, 'last in the toolbar row');
  assert.ok(row.querySelector('select'), 'the Find list is in the same row, before it');
  assert.ok(group.querySelector('[data-elevview="expand"]'), 'Expand is in the group');
  assert.ok(!/position:\s*absolute/.test(group.outerHTML), 'no absolute positioning');
  [...row.querySelectorAll('button')].find(b => b.textContent === '+ Wall').dispatchEvent(new window.Event('click'));
  assert.ok(c.querySelector('[data-elevzoom]') && c.querySelector('[data-elevzoom]').parentNode.lastChild === c.querySelector('[data-elevzoom]'), 'kept after a mode change');
});

console.log(passed + ' passed');
