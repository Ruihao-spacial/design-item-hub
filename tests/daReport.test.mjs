// Diaphragm Analysis — PDF report (Phase 8, user 2026-11-10): Summary / Detailed built from the same recalculated
// result as the screen; every value at ASD (0.7E / 0.6W), seismic at three force levels, each load direction on its own;
// unit shears as the ± envelope (max |v|), member forces as the ± envelope (max T / max C, signed); the drawings are the
// Analysis tab's own functions. Run: node tests/daReport.test.mjs
import assert from 'assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

if (!globalThis.document) {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window, document, Node: window.Node });
}
const { getModule } = await import('../src/modules/registry.js');
const { swdExtract } = await import('../src/modules/tdWallLink.js');
const { normalizeInputs } = await import('../src/modules/tdMigrate.js');
const { diaphragmAnalysis, calcAll } = await import('../src/modules/diaphragmAnalysis.js');
const { sharedGrids } = await import('../src/modules/tdGridShare.js');
const R = await import('../src/modules/tdReport.js');
const V = await import('../src/modules/tdViews.js');
const { bookToInputs } = await import('./td-book/src/toInputs.mjs');

const clone = v => JSON.parse(JSON.stringify(v));
const book = id => JSON.parse(fs.readFileSync(new URL('./td-book/' + id + '.json', import.meta.url), 'utf8'));
const load = f => JSON.parse(fs.readFileSync(new URL('./fixtures/da-user/' + f, import.meta.url), 'utf8'));
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 6).join('\n       ')); process.exitCode = 1; }
}
const swdItem = load('t98-swd.json'), roofItem = load('t98-roof.json'), flrItem = load('t98-2nd.json');
const swd = getModule('shear_wall_design').migrate({ schemaVersion: swdItem.schemaVersion, inputs: clone(swdItem.inputs) }).inputs;
const flrInputs = () => { const i = normalizeInputs(clone(flrItem.inputs)); i.tds = i.tds.filter(t => t.mark !== 'TD9'); i.level.diaphragmFactor = '1.2'; i.level.collectorFactor = '2'; return i; };
const flrRefs = () => ({ wallSource: swdExtract(swd), gridSource: { grids: sharedGrids(roofItem.inputs) } });
const flr = flrInputs(), flrOut = calcAll(flr, flrRefs());
const sections = mode => diaphragmAnalysis.pdfSections({ ...flr, pdfReport: mode }, flrOut);
const titled = (secs, start) => secs.filter(s => (s.title || '').startsWith(start));

test('the PDF uses the result it is given (recalculated with the links), not a calc without them', () => {
  const secs = sections('summary');
  const head = secs[0].rows.map(r => r[0] + ': ' + (r[1].t || r[1]));
  assert.ok(head.some(t => t.startsWith('Shear Wall Design: Linked')), head.join('\n'));
  assert.ok(head.some(t => t.startsWith('Walls above (transfer): Ω₀ 2.5')));
  assert.ok(head.some(t => t.includes('the effect of ρ is already incorporated')));
  assert.ok(head.some(t => t.startsWith('Values printed: ASD — 0.7E')));
  // without its links, the same item would not know its walls: the line force table proves the linked walls are used
  const lt = titled(secs, 'Line forces and wall shares — seismic, load along y')[0];
  assert.ok(lt.table.rows.some(r => /SW-\d+/.test(r[3])), 'linked SWD walls in the table');
});

test('Summary: plan per direction; per case line forces (1.0 and ASD), net shear envelope (diaphragm), members envelope (collector), member table at 3 levels; checks', () => {
  const secs = sections('summary');
  assert.equal(titled(secs, 'Plan — ').length, 2);
  for (const d of ['y', 'x']) {
    const head = 'Seismic, load along ' + d;
    assert.equal(titled(secs, head).length, 1);
    const fig = secs.filter(s => s.elevation && s.title.includes('Net unit shear v_net, ASD 0.7 × diaphragm level (k_D 1.2, walls above × Ω₀ 2.5)'));
    assert.ok(fig.length === 2 && fig.every(f => f.title.includes('max |v| of')), 'one per direction, envelope');
    assert.equal(secs.filter(s => s.elevation && s.title.startsWith('Member forces, ASD 0.7 × collector level (k_C 2)')).length, 2);
  }
  const mt = titled(secs, 'Member forces — seismic, load along y')[0].table;
  assert.deepEqual(mt.headers.slice(3, 6), ['ASD, 1.0E level: max T / max C (lb)', 'ASD, diaphragm level: max T / max C (lb)', 'ASD, collector level: max T / max C (lb)']);
  assert.ok(secs.some(s => s.title === 'Checks'));
  for (const s of secs.filter(x => x.elevation)) { const svg = s.elevation.renderFn(500); assert.equal(svg.tagName.toLowerCase(), 'svg'); assert.ok(+svg.getAttribute('width') > 0 && +svg.getAttribute('height') > 0); }
});

test('values: line table = analysis × 1.0 / × 0.7; member table = the Analysis tab envelope at each level (× 0.7 k)', () => {
  const cs = flrOut.analysis.cases.find(c => c.dir === 'y'), rc = flrOut.reverse.cases.find(c => c.id === cs.id);
  const lt = titled(sections('summary'), 'Line forces and wall shares — seismic, load along y')[0].table;
  const ln = [...cs.lines].sort((a, b) => a.at - b.at)[0];
  assert.deepEqual(lt.rows[0].slice(0, 3), [ln.name, Math.round(ln.P).toLocaleString('en-US'), Math.round(0.7 * ln.P).toLocaleString('en-US')]);
  // collector level: envelope of the two senses × 0.7 × k_C, as the Analysis tab builds it
  const levels = R.reportLevels(flrOut, cs);
  assert.deepEqual(levels.map(L => [L.key, +L.k.toFixed(6)]), [['E', 0.7], ['D', 0.84], ['C', 1.4]]);
  const env = V.envelopeCase(V.scaleCase(cs, 1.4), V.scaleCase(rc, 1.4));
  const rows = R.memberRows(levels);
  let n = 0;
  for (const m of env.members) for (const r of m.runs) {
    const row = rows.find(x => x.name === m.name && x.family === m.family && Math.abs(x.from - r.from) < 1e-6);
    if (!row) { assert.ok(Math.abs(r.max) < 0.5, 'left out only when zero: ' + m.name); continue; }
    const e = V.runExtremes(r), c = row.values[2];
    assert.ok((!e.T && !c.T) || Math.abs(e.T.N - c.T.N) < 1e-6, m.name);
    assert.ok((!e.C && !c.C) || Math.abs(e.C.N - c.C.N) < 1e-6, m.name);
    n++;
  }
  assert.ok(n > 20);
  // diaphragm level with walls above = the levelD run × 0.7 k_D (not the 1.0 run × 0.84)
  const d = levels[1];
  assert.ok(d.a.members.length && flrOut.levelD.some(c => c.id === cs.id));
});

test('Detailed: three levels of drawings, basic / TD shear envelopes, section tables, TD table, walls above, closure passes', () => {
  const secs = sections('detailed');
  assert.equal(secs.filter(s => s.elevation && s.title.startsWith('Net unit shear')).length, 6);
  assert.equal(secs.filter(s => s.elevation && s.title.startsWith('Member forces,')).length, 6);
  assert.equal(secs.filter(s => s.elevation && s.title.startsWith('Basic unit shear')).length, 2);
  assert.ok(secs.filter(s => s.elevation && s.title.startsWith('TD unit shear')).length >= 1);
  const st = titled(secs, 'Diaphragm ').filter(s => s.table);
  assert.ok(st.length >= 4 && st[0].table.headers[3] === 'max |v| − per band (plf)' && st[0].title.includes('section shears, ASD 0.7 × diaphragm level'));
  assert.ok(titled(secs, 'Transfer diaphragms — ASD 0.7 × 1.0E').length >= 1);
  const wa = titled(secs, 'Walls of the story above')[0].table;
  assert.deepEqual(wa.headers, ['Wall', 'Line', 'Goes', 'V 1.0 (lb)', '1.0E level (lb)', 'Diaphragm (lb)', 'Collector (lb)', 'Into the floor, diaphragm (plf)']);
  // transfer at the diaphragm level = V × 0.7 × Ω₀ (2.5)
  const r = wa.rows[0], V1 = Number(r[3].replace(/,/g, ''));
  assert.ok(Math.abs(Number(r[5].replace(/,/g, '')) - 0.7 * 2.5 * V1) <= 1, r.join(' | '));
  assert.ok(titled(secs, 'Closure solver').length >= 1);
});

test('wind (book Ex 5.1): one level, ASD 0.6W, envelopes of ∓y; paused (Ex 3.4): status, basic shear envelope only', () => {
  const w = bookToInputs(book('Ex5.1')); w.loads = [{ id: 'w', acts: '-y', mode: 'wind', kind: '', psf: '', edgeId: '', segments: [{ from: '0', to: '160', w: '123', w2: '', wl: '77' }] }];
  const ws = diaphragmAnalysis.pdfSections({ ...w, pdfReport: 'summary' }, calcAll(w));
  assert.ok(ws.some(s => s.elevation && s.title === 'Net unit shear v_net, ASD 0.6W — max |v| of -y / +y'));
  const mt = titled(ws, 'Member forces — wind')[0].table;
  assert.deepEqual(mt.headers.slice(3, 4), ['ASD 0.6W: max T / max C (lb)']);
  const lt = titled(ws, 'Line forces and wall shares — wind')[0].table;
  assert.equal(lt.headers[2], 'ASD 0.6W (lb)');
  const p = bookToInputs(book('Ex3.4'));
  const ps = diaphragmAnalysis.pdfSections({ ...p, pdfReport: 'detailed' }, calcAll(p));
  assert.ok(ps.some(s => (s.text || '').startsWith('PAUSED — TD TD1 awaits the cantilever review')));
  assert.ok(ps.some(s => s.elevation && s.title === 'Basic unit shear v_b, ASD 0.6W — max |v| of -y / +y'));
  assert.ok(!ps.some(s => s.elevation && /^(Net unit shear|Member forces)/.test(s.title)), 'nothing of the incomplete net field');
});

test('a plan with errors prints the issues only; pdfSections without outputs recalculates', () => {
  const i = normalizeInputs(clone(roofItem.inputs)); i.outline = i.outline.slice(0, 2);
  const s = diaphragmAnalysis.pdfSections(i);
  assert.equal(s[s.length - 1].title, 'Plan issues — not analysed');
});

console.log(passed + ' passed');
