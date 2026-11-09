// Diaphragm Analysis UI (user 2026-11-06, plan ~/.claude/plans/add-new-feature-to-kind-horizon.md) on project 26998
// (tests/fixtures/da-user/t98-*.json, Roof): (1) plan messages grouped by type and numbered, under the plan;
// (2) Diaphragms & TDs page: a tab per kind, a sub-tab per item, one card shown; (3) Analysis: member diagrams and
// force labels drawn above the walls; walls below / walls above switches. Run: node tests/daUi.test.mjs
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
const { calcAll, planWithLinks } = await import('../src/modules/diaphragmAnalysis.js');
const { groupMessages } = await import('../src/modules/tdMessages.js');
const { drawMembers } = await import('../src/modules/tdViews.js');

const clone = v => JSON.parse(JSON.stringify(v));
const load = f => JSON.parse(fs.readFileSync(new URL('./fixtures/da-user/' + f, import.meta.url), 'utf8'));
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 6).join('\n       ')); process.exitCode = 1; }
}
const swdItem = load('t98-swd.json'), roofItem = load('t98-roof.json');
const swdMod = getModule('shear_wall_design'), da = getModule('diaphragm_analysis');
const swd = swdMod.migrate({ schemaVersion: swdItem.schemaVersion, inputs: clone(swdItem.inputs) }).inputs;
const roof = () => normalizeInputs(clone(roofItem.inputs));
const items = [{ id: swdItem.id, type: 'shear_wall_design', inputs: swd }, { id: roofItem.id, type: 'diaphragm_analysis', inputs: roofItem.inputs }];
const open = () => {
  const box = document.createElement('div');
  da.renderForm(box, roof(), () => {}, items, () => {}, { itemId: roofItem.id });
  return box;
};
const btn = (box, t) => [...box.querySelectorAll('button')].find(b => b.textContent === t || b.textContent.startsWith(t));
const click = (box, t) => btn(box, t).dispatchEvent(new window.Event('click'));
const fire = node => node.dispatchEvent(new window.Event('click'));
const r0 = calcAll(roof(), { wallSource: swdExtract(swd) });

test('26998 Roof as saved: both cases close (the layout of 2026-11-06), so the UI tests run on a valid item', () => {
  assert.deepEqual(r0.errors.map(e => e.code), []);
  assert.ok(!r0.checks.some(c => !c.ok && !c.warn && c.code !== 'td'), r0.checks.filter(c => !c.ok).map(c => c.msg).join(' | '));
});

test('groupMessages: "grids not on this plan" has its own group; every message in one group; numbers E1… / W1… unique, in order; unknown code → Other', () => {
  const errors = [{ code: 'dg-supports', msg: 'e1' }, { code: 'td-size', msg: 'e2' }, { code: 'dg-overlap', msg: 'e3' }];
  const warnings = [...r0.warnings, { code: 'something-new', msg: 'w?', warn: true }];
  const g = groupMessages(errors, warnings);
  const off = g.find(x => x.key === 'grid-off-plan');
  assert.ok(off && off.kind === 'warning' && off.items.length === 1 && /do not cross this plan/.test(off.items[0].msg));
  assert.ok(g.filter(x => x.key !== 'grid-off-plan').every(x => x.items.every(m => m.code !== 'grid-off-plan')), 'only in its own group');
  assert.equal(groupMessages([], [{ code: 'grid-mismatch', msg: 'm' }])[0].key, 'grids', 'other grid messages in "Grids"');
  assert.equal(g.reduce((s, x) => s + x.items.length, 0), errors.length + warnings.length, 'each message once');
  const nums = g.flatMap(x => x.items.map(m => m.n));
  assert.equal(new Set(nums).size, nums.length);
  assert.deepEqual(g.filter(x => x.kind === 'error').flatMap(x => x.items.map(m => m.n)), ['E1', 'E2', 'E3']);
  assert.deepEqual(g.filter(x => x.kind === 'error').map(x => x.key), ['diaphragms', 'tds'], 'errors first, table order; dg-supports + dg-overlap together');
  assert.equal(g.filter(x => x.kind === 'warning').flatMap(x => x.items.map(m => m.n))[0], 'W1');
  assert.equal(g[g.length - 1].key, 'other');
  assert.equal(g[g.length - 1].items[0].msg, 'w?');
});

test('Plan tab: no message lines above the editor; grouped, numbered messages under the drawing (left column); a closed group stays closed', () => {
  const box = open();
  click(box, 'Plan');
  const ed = box.querySelector('.td-editor');
  assert.ok(ed && !ed.previousSibling, 'the editor is the first thing on the Plan tab');
  const msgs = box.querySelector('.td-messages');
  const drawing = [...box.querySelectorAll('svg')].find(s => s.querySelector('g.td-plan'));
  assert.ok(msgs && drawing && msgs.parentNode === drawing.parentNode, 'same column as the drawing');
  const all = [...box.querySelectorAll('*')];
  assert.ok(all.indexOf(msgs) > all.indexOf(drawing), 'below the drawing');
  const g = msgs.querySelector('[data-msg-group="warning:grid-off-plan"]');
  assert.ok(g && /Grids not on this plan \(1\)/.test(g.textContent) && g.querySelector('[data-msg^="W"]'));
  assert.equal(msgs.querySelectorAll('[data-msg]').length, r0.warnings.length);
  // dark theme (user 2026-11-06): message text takes the theme ink, not a fixed dark colour
  assert.ok([...msgs.querySelectorAll('[data-msg] span')].every(sp => !/#|ink-primary/.test(sp.getAttribute('style') || '')), 'theme colours only');
  g.open = false; g.dispatchEvent(new window.Event('toggle'));
  click(box, 'Diaphragms & TDs');
  assert.equal(box.querySelector('[data-msg-group="warning:grid-off-plan"]').open, false, 'kept across a redraw');
});

test('Diaphragms & TDs: Diaphragms / TDs tabs with counts, a sub-tab per item, one card; a sub-tab selects its item; a TD picked on the plan opens the TDs tab', () => {
  const box = open();
  click(box, 'Plan'); click(box, 'Diaphragms & TDs');
  const inp = roof();
  const nD = inp.diaphragms.filter(d => d.dir === 'y').length, nT = inp.tds.filter(t => (t.dir || 'y') === 'y').length;
  assert.ok(box.querySelector('[data-dgtab="diaphragm"]').textContent.includes('(' + nD + ')'));
  assert.ok(box.querySelector('[data-dgtab="td"]').textContent.includes('(' + nT + ')'));
  assert.equal(box.querySelectorAll('[data-subtab]').length, nD);
  assert.equal(box.querySelectorAll('[data-selrow^="diaphragm:"]').length, 1, 'one diaphragm card');
  assert.equal(box.querySelectorAll('[data-selrow^="td:"]').length, 0);
  // sub-tab D2 → its card, selected (highlighted)
  fire(box.querySelector('[data-subtab="D2"]'));
  const d2 = inp.diaphragms.find(d => d.dir === 'y' && d.mark === 'D2');
  const card = box.querySelector('[data-selrow="diaphragm:' + d2.id + '"]');
  assert.ok(card && /var\(--sel-bg\)/.test(card.getAttribute('style') || ''), 'D2 shown and selected (theme token --sel-bg: readable in dark mode)');
  assert.ok(box.querySelector('[data-subtab="D2"]').className.includes('btn-primary'));
  // TDs tab
  fire(box.querySelector('[data-dgtab="td"]'));
  assert.equal(box.querySelectorAll('[data-subtab]').length, nT);
  assert.equal(box.querySelectorAll('[data-selrow^="td:"]').length, 1, 'one TD card');
  fire(box.querySelector('[data-subtab="TD4"]'));
  const td4 = inp.tds.find(t => t.mark === 'TD4');
  assert.ok(box.querySelector('[data-selrow="td:' + td4.id + '"]'), 'TD4 card');
  // back to Diaphragms, then pick TD1 on the plan → TDs tab with TD1
  fire(box.querySelector('[data-dgtab="diaphragm"]'));
  const td1 = inp.tds.find(t => t.mark === 'TD1');
  const tdRect = [...box.querySelectorAll('svg g.td-plan g')].find(g => g.querySelector('rect') && g.textContent.includes('TD1'));
  assert.ok(tdRect, 'TD1 drawn on the plan');
  fire(tdRect);
  assert.ok(box.querySelector('[data-dgtab="td"]').className.includes('btn-primary'), 'TDs tab opened');
  assert.ok(box.querySelector('[data-selrow="td:' + td1.id + '"]'), 'TD1 card shown');
});

test('Diaphragms & TDs: an item with a plan error has a red dot on its tab and sub-tab', () => {
  const inp = roof();
  const d = inp.diaphragms.find(x => x.dir === 'y' && x.mark === 'D3');
  d.supports = [d.supports[0], d.supports[0]]; // same line twice → error on D3
  const box = document.createElement('div');
  da.renderForm(box, inp, () => {}, items, () => {}, { itemId: roofItem.id });
  click(box, 'Plan'); click(box, 'Diaphragms & TDs');
  assert.ok(box.querySelector('[data-dgtab="diaphragm"]').textContent.includes('●'));
  assert.ok(box.querySelector('[data-subtab="D3"]').textContent.includes('●'));
  assert.ok(!box.querySelector('[data-subtab="D1"]').textContent.includes('●'));
  assert.ok(box.querySelector('.td-messages [data-msg^="E"]'), 'the error is listed under the plan');
});

test('Analysis, Members N: diagrams and labels drawn after (above) the walls; walls below / above switches hide them; both on by default', () => {
  const plan = planWithLinks(roof(), { wallSource: swdExtract(swd) }).plan;
  const cs = r0.analysis.cases.find(c => c.id === 'y-E');
  const d = drawMembers(plan, cs, { chord: true, cross: true }, {}, {});
  const all = [...d.svg.querySelectorAll('*')];
  const walls = [...d.svg.querySelectorAll('[data-wall]')], polys = [...d.svg.querySelectorAll('g.td-view-top polygon')];
  assert.ok(walls.length > 5 && polys.length > 20);
  const lastWall = Math.max(...walls.map(w => all.indexOf(w)));
  assert.ok(polys.every(p => all.indexOf(p) > lastWall), 'every member polygon after the last wall');
  const sw = [...d.svg.querySelectorAll('g.td-view-top text')].find(t => /^SW-22 /.test(t.textContent));
  assert.ok(sw && all.indexOf(sw) > lastWall, 'wall share label on top');
  assert.equal(drawMembers(plan, cs, undefined, {}, { walls: false }).svg.querySelectorAll('[data-wall]').length, 0, 'walls below hidden');
  // walls above: the Roof has none; the switch hides them where there are (Ex: a plan with one wall above)
  const p2 = { ...plan, wallsAbove: [{ id: 'a1', mark: 'SWA', axis: 'x', at: 33, from: 60, to: 70, kind: 'through', line: 'D' }] };
  assert.equal(drawMembers(p2, cs, undefined, {}, {}).svg.querySelectorAll('[data-above]').length, 1);
  assert.equal(drawMembers(p2, cs, undefined, {}, { above: false }).svg.querySelectorAll('[data-above]').length, 0, 'walls above hidden');
  assert.ok(drawMembers(p2, cs, undefined, {}, { above: false }).svg.querySelectorAll('[data-wall]').length > 5, 'separate switches');
});

test('Analysis tab: "walls below (this level)" always, "walls above (story above)" only when there are walls above; unticking redraws without walls', () => {
  const box = open();
  click(box, 'Analysis');
  const lab = t => [...box.querySelectorAll('label')].find(l => l.textContent.includes(t));
  assert.ok(lab('walls below (this level)') && !lab('walls above (story above)'), 'Roof: no story above');
  click(box, 'Members N');
  assert.ok(box.querySelector('.td-canvas [data-wall]'));
  const cb = lab('walls below (this level)').querySelector('input');
  cb.checked = false; cb.dispatchEvent(new window.Event('change'));
  assert.ok(!box.querySelector('.td-canvas [data-wall]') && box.querySelector('.td-canvas g.td-view-top polygon'), 'walls gone, diagrams stay');
});

test('open item 6-A: Plan → Shear walls, collector table — the tick "each wall into the diaphragm under it" stores own and disables from / to', () => {
  const flr = load('t98-2nd.json');
  const projectItems = [...items, { id: flr.id, type: 'diaphragm_analysis', inputs: flr.inputs }];
  const inp = normalizeInputs(clone(flr.inputs));
  const box = document.createElement('div');
  da.renderForm(box, inp, () => {}, projectItems, () => {}, { itemId: flr.id });
  click(box, 'Plan'); click(box, 'Shear walls');
  const cb = box.querySelector('[data-collector-own="6"]');
  assert.ok(cb && !cb.checked, 'tick for line 6, off by default');
  assert.ok(!box.querySelector('[data-collector="6:from"]').disabled);
  cb.checked = true; cb.dispatchEvent(new window.Event('change'));
  assert.equal(inp.aboveCollectors['ln-14'].own, true);
  assert.ok(box.querySelector('[data-collector-own="6"]').checked && box.querySelector('[data-collector="6:from"]').disabled, 'from / to disabled');
  const off = box.querySelector('[data-collector-own="6"]'); off.checked = false; off.dispatchEvent(new window.Event('change'));
  assert.ok(!('ln-14' in inp.aboveCollectors), 'unticked: nothing stored (as before)');
});

console.log(passed + ' passed');
