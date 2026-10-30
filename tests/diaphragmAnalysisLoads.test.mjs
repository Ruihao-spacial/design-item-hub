// Diaphragm Analysis — load types and force levels (2026-10-30, user review):
// wind windward / leeward input (each strip on its own face; = book Ex 5.1's two edge line loads), wind-as-area
// warning, the w(s) load strip on the Plan tab for every mode, seismic display factors F_x → diaphragm (F_px) /
// collector level with the "Forces shown" line, and the SWD line forces staying at 1.0E.
// Run: node tests/diaphragmAnalysisLoads.test.mjs
import assert from 'assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

if (!globalThis.document) {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window, document, Node: window.Node });
}
const { toolValue } = await import('../src/modules/tdBookKeys.js');
const { loadProfile } = await import('../src/modules/tdBasicShear.js');
const { defaultInputs } = await import('../src/modules/tdModel.js');
const { normalizeInputs } = await import('../src/modules/tdMigrate.js');
const { diaphragmAnalysis, calcAll, planWithLinks, forceLevels, linkLineForces } = await import('../src/modules/diaphragmAnalysis.js');
const V = await import('../src/modules/tdViews.js');
const { bookToInputs } = await import('./td-book/src/toInputs.mjs');

const book = id => JSON.parse(fs.readFileSync(new URL('./td-book/' + id + '.json', import.meta.url), 'utf8'));
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; }
}
const windLoad = (acts, segs) => ({ id: 'ld-w', acts, mode: 'wind', kind: '', psf: '', edgeId: '', segments: segs.map(([from, to, w, wl]) => ({ from: String(from), to: String(to), w: String(w), w2: '', wl: wl === '' ? '' : String(wl) })) });
const seismicItem = () => { const i = defaultInputs(); i.level.fx = '100'; return i; }; // 100 × 50 ft, F_x 100 k

test('wind: one windward / leeward load (123 / 77 plf) = book Ex 5.1\'s two edge line loads — all 73 values identical', () => {
  const b = book('Ex5.1'), a = bookToInputs(b), w = bookToInputs(b);
  w.loads = [windLoad('-y', [[0, 160, 123, 77]])];
  const ra = calcAll(a), rw = calcAll(w), pa = planWithLinks(a).plan, pw = planWithLinks(w).plan;
  assert.deepEqual(rw.errors, []);
  const diff = b.expected.filter(e => { const x = toolValue(e.k, pa, ra.analysis), y = toolValue(e.k, pw, rw.analysis); return !(x === y || Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x))); });
  assert.deepEqual(diff.map(e => e.k), []);
  assert.equal(rw.analysis.cases[0].kind, 'W');
});

test('wind: without an opening only the net load counts (200 windward ≡ 123 + 77); each strip goes to its own face', () => {
  const run = segs => { const i = bookToInputs(book('Ex4.1')); i.loads = [windLoad('-y', segs)]; return calcAll(i); };
  const a = run([[0, 150, 200, '']]), b = run([[0, 150, 123, 77]]);
  for (const [la, lb] of a.analysis.cases[0].lines.map((l, j) => [l, b.analysis.cases[0].lines[j]])) assert.ok(Math.abs(la.P - lb.P) < 1e-6, la.name);
  // Ex 5.1 at the opening: windward band (B–A) gets 123, leeward band (D–C) 77 per foot
  const w = bookToInputs(book('Ex5.1')); w.loads = [windLoad('-y', [[0, 160, 123, 77]])];
  const d = calcAll(w).analysis.cases[0].diaphragms[0];
  const iv = d.intervals.find(i => i.a >= 15 - 1e-6 && i.b <= 39 + 1e-6);
  const top = iv.bands.find(x => x.hi === 50), bot = iv.bands.find(x => x.lo === 0);
  assert.ok(Math.abs(top.wa + 123) < 1e-9 && Math.abs(bot.wa + 77) < 1e-9, `${top.wa} / ${bot.wa}`);
});

test('wind entered as an area load: warning; stored data gets wl and the factors without losing anything', () => {
  const i = seismicItem(); i.loads[0].mode = 'area'; i.loads[0].psf = '20';
  assert.ok(calcAll(i).warnings.some(w => w.code === 'load-wind-area'));
  i.loads[0].kind = 'E';
  assert.ok(!calcAll(i).warnings.some(w => w.code === 'load-wind-area'), 'an E area load is fine');
  const old = { ...defaultInputs(), level: { name: 'L2', fx: '12' } };
  old.loads = [{ id: 'l', acts: '-y', mode: 'line', segments: [{ from: '0', to: '10', w: '5', w2: '' }] }];
  const n = normalizeInputs(JSON.parse(JSON.stringify(old)));
  assert.deepEqual(n.level, { name: 'L2', fx: '12', diaphragmFactor: '', collectorFactor: '' });
  assert.equal(n.loads[0].segments[0].wl, '');
  assert.equal(n.loads[0].segments[0].w, '5');
});

test('load strip w(s): seismic q·d(s) steps with the depth (Ex 4.1 notch), line load as entered (Ex 3.4); drawn on the Plan tab', () => {
  const s = bookToInputs(book('Ex4.1')); s.loads = [{ id: 'q', acts: '-y', mode: 'seismic', kind: '', psf: '', edgeId: '', segments: [] }]; s.level.fx = '7.25';
  const r = calcAll(s), cs = r.analysis.cases[0], q = r.q;
  const prof = loadProfile(cs);
  const at = x => prof.find(p => x > p.a && x < p.b);
  assert.ok(Math.abs(at(5).wa - q * 50) < 1e-9 && Math.abs(at(25).wa - q * 40) < 1e-9, 'q × 50 ft full depth, q × 40 ft at the notch');
  assert.ok(Math.abs(prof.reduce((t, p) => t + (p.wa + p.wb) / 2 * (p.b - p.a), 0) - 7250) < 1e-6, 'Σ w ds = F_x');
  const p34 = loadProfile(calcAll(bookToInputs(book('Ex3.4'))).analysis.cases[0]);
  assert.ok(p34.every(p => Math.abs(p.wa - 200) < 1e-9 && Math.abs(p.wb - 200) < 1e-9));
  const box = document.createElement('div');
  diaphragmAnalysis.renderForm(box, s, () => {}, [], () => {}, {});
  [...box.querySelectorAll('button')].find(b => b.textContent === 'Plan').dispatchEvent(new window.Event('click')); // book items open on Verification
  const strip = box.querySelector('g.td-load-profile');
  assert.ok(strip && strip.textContent.includes('seismic q·d(s), q = ' + Math.round(q * 100) / 100 + ' psf'), strip && strip.textContent);
});

test('force levels: Setup factors; Analysis shows 1.0E / diaphragm / collector level with a "Forces shown" line; SWD line forces stay at 1.0E', () => {
  const i = seismicItem(); i.level.diaphragmFactor = '1.25'; i.level.collectorFactor = '2.5';
  assert.deepEqual(forceLevels(i), { fx: 100, diaphragm: 1.25, collector: 2.5 });
  assert.deepEqual(forceLevels(defaultInputs()), { fx: null, diaphragm: 1, collector: 1 });
  const r = calcAll(i), cs = r.analysis.cases.find(c => c.dir === 'y');
  const sc = V.scaleCase(cs, 1.25);
  assert.ok(Math.abs(sc.lines[0].P - 1.25 * cs.lines[0].P) < 1e-9 && Math.abs(sc.members[0].runs[0].max - 1.25 * cs.members[0].runs[0].max) < 1e-9);
  assert.ok(Math.abs(cs.lines[0].P - 50000) < 1e-6, 'results stay at 1.0E');
  const box = document.createElement('div');
  diaphragmAnalysis.renderForm(box, i, () => {}, [], () => {}, {});
  const click = t => [...box.querySelectorAll('button')].find(b => b.textContent === t).dispatchEvent(new window.Event('click'));
  click('Analysis');
  const shown = () => box.querySelector('.td-forces-shown').textContent;
  assert.ok(shown().startsWith('Forces shown: seismic 1.0E from F_x = 100 k'));
  assert.ok(box.textContent.includes('50,000'));
  click('Diaphragm × 1.25');
  assert.ok(shown().includes('DIAPHRAGM level = 1.0E × k_D 1.25') && box.textContent.includes('62,500'));
  click('Collector × 2.5');
  assert.ok(shown().includes('COLLECTOR level = 1.0E × k_C 2.5') && box.textContent.includes('125,000'));
  // wind case: no factor
  const w = bookToInputs(book('Ex3.4'));
  w.tds.forEach(t => { t.engineer.cantileverOk = true; });
  const b2 = document.createElement('div');
  diaphragmAnalysis.renderForm(b2, w, () => {}, [], () => {}, {});
  [...b2.querySelectorAll('button')].find(b => b.textContent === 'Analysis').dispatchEvent(new window.Event('click'));
  assert.ok(b2.querySelector('.td-forces-shown').textContent.startsWith('Forces shown: wind, 1.0W'));
  assert.ok(![...b2.querySelectorAll('button')].some(b => b.textContent.startsWith('Diaphragm ×')), 'no level buttons for wind');
  // Setup shows the factor inputs
  click('Setup');
  assert.ok(box.textContent.includes('Seismic force levels'));
});

test('Setup pages: Seismic loading (level, F_x, factors, E loads), Wind loading (W loads), Shear wall link, General; loads left the Plan panel', () => {
  const inputs = seismicItem();
  const box = document.createElement('div');
  diaphragmAnalysis.renderForm(box, inputs, () => {}, [], () => {}, {});
  const click = t => [...box.querySelectorAll('button')].find(b => b.textContent === t).dispatchEvent(new window.Event('click'));
  click('Setup');
  assert.ok(box.textContent.includes('Level and story force F') && box.textContent.includes('Seismic loads (E)'));
  assert.ok(box.textContent.includes('+ Seismic load along y') && box.textContent.includes('+ Seismic load along x'));
  click('Wind loading');
  assert.ok(box.textContent.includes('Wind loads (W)') && !box.textContent.includes('Level and story force'));
  click('+ Wind load along y');
  const wl = inputs.loads[inputs.loads.length - 1];
  assert.deepEqual([wl.mode, wl.kind, wl.acts, wl.segments.length], ['wind', 'W', '-y', 1]);
  assert.ok(box.textContent.includes('windward (plf)') && box.textContent.includes('leeward (plf)'));
  // the two seismic loads are not on the wind page, the wind load is not on the seismic page
  assert.equal([...box.querySelectorAll('button')].filter(b => b.title === 'Delete load').length, 1);
  click('Seismic loading');
  assert.equal([...box.querySelectorAll('button')].filter(b => b.title === 'Delete load').length, 2);
  click('General');
  assert.ok(box.textContent.includes('Code and diaphragm') && box.textContent.includes('Method'));
  click('Shear wall link');
  assert.ok(box.textContent.includes('Shear walls (from Shear Wall Design)'));
  // a book wind (line loads, kind blank) shows on the Wind page; the Plan panel only points to Setup
  const b5 = bookToInputs(book('Ex5.1'));
  const box2 = document.createElement('div');
  diaphragmAnalysis.renderForm(box2, b5, () => {}, [], () => {}, {});
  const click2 = t => [...box2.querySelectorAll('button')].find(b => b.textContent === t).dispatchEvent(new window.Event('click'));
  click2('Plan');
  assert.ok(box2.textContent.includes('Loads are entered on the Setup tab') && !box2.textContent.includes('+ Load along'));
  click2('Setup'); click2('Wind loading');
  assert.equal([...box2.querySelectorAll('button')].filter(b => b.title === 'Delete load').length, 2);
});

test('gate and Shear Wall Design: a paused offset-line case holds its line forces (null = SWD offers no update); other cases are sent', () => {
  const link = { lines: [{ grid: { id: 'g' }, dir: 'x', dirId: 'd', lineId: 'l', name: 'B' }] };
  const line = { gridId: 'g', P: 2500 };
  const lf = (offset, paused) => linkLineForces([{ dir: 'x', kind: 'W', offset, paused, lines: [line] }, { dir: 'x', kind: 'E', paused: [{ mark: 'TD1' }], lines: [line] }], link)[0];
  assert.deepEqual([lf({}, [{ mark: 'TD1' }]).W, lf({}, [{ mark: 'TD1' }]).E], [null, 2.5], 'W held (offset + paused); E sent (no offset line, line forces do not need the TD run)');
  assert.equal(lf({}, []).W, 2.5, 'sent once the TD runs');
  assert.equal(lf(undefined, [{ mark: 'TD1' }]).W, 2.5, 'no offset line: sent');
});

console.log(passed + ' passed');
