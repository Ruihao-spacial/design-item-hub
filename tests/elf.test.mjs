// ELF Diaphragm & Collector v2 (user review 2026-11-10) and its checks in Diaphragm Analysis.
// Hand case: W = 100 + 200 kip at h = 20 / 10 ft, C_s 0.15, S_DS 1.0, I_e 1.0, Ω₀ 2.5, ρ 1.3, k 1.
//   V = 0.15 × 300 = 45; w·h = 2000 / 2000 → C_vx 0.5 / 0.5, F_x 22.5 / 22.5; V_x 22.5 / 45.
//   Roof: F_px = 22.5 / 100 × 100 = 22.5, min 0.2·1·100 = 20, max 40 → F_px,des 22.5
//   2nd:  F_px = 45 / 300 × 200 = 30, min 40, max 80 → F_px,des 40
//   Collector (§12.10.2.1): (1) Ω₀ F_x 56.25 / 56.25, (2) Ω₀ F_px,des 56.25 / 100, (3) ρ F_px,min 26 / 52 → F_c 56.25 / 100
//   Light-frame: Ω₀ 2.5 − 0.5 = 2.0 → (1) 45 / 45, (2) 45 / 80
//   25 % (§12.3.3.5): F_px,des × 1.25 = 28.13 / 50; (3) 1.25 × 1.3 × 20 = 32.5 / 65; Ω₀ items unchanged
//   Wood-shear-wall exception (+25 %): F_c = 1.25 × 1.3 × F_px,des = 36.56 / 65
// Run: node tests/elf.test.mjs
import assert from 'assert/strict';
import { parseHTML } from 'linkedom';

if (!globalThis.document) {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window, document, Node: window.Node });
}
const { elfDiaphragmCollector: elf, omegaCollector, ELF_CALC_VERSION } = await import('../src/modules/elfDiaphragmCollector.js');
const { elfLinkChecks, forceLevels } = await import('../src/modules/diaphragmAnalysis.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 6).join('\n       ')); process.exitCode = 1; }
}
const base = { sds: '1.0', cs: '0.15', ie: '1.0', omega0: '2.5', rho: '1.3', k: '1', refs: {},
  levels: [{ name: 'Roof', wx: '100', hx: '20', wpx: '' }, { name: '2nd', wx: '200', hx: '10', wpx: '' }] };
const run = (opt = {}) => elf.calc({ ...base, ...opt });
const coll = o => o.collectorTable.map(r => [r.omega0Fx, r.omega0Fpx, r.minForce, r.exceptionForce, r.designForce, r.governs]);

test('v2; story shear and diaphragm forces unchanged by the options; ratios F_px,des / F_x', () => {
  assert.equal(ELF_CALC_VERSION, 'v2');
  assert.equal(elf.calcVersion, 'v2');
  const o = run();
  assert.equal(o.baseShear, 45);
  assert.deepEqual(o.elfTable.map(r => [r.level, r.cvx, r.fx, r.vx]), [['Roof', 0.5, 22.5, 22.5], ['2nd', 0.5, 22.5, 45]]);
  assert.deepEqual(o.diaphragmTable.map(r => [r.fpxCalc, r.fpxMin, r.fpxMax, r.fpxDesign, r.fpxDesignInc, r.kD]), [[22.5, 20, 40, 22.5, 22.5, 1], [30, 40, 80, 40, 40, 1.778]]);
});

test('collector §12.10.2.1: max of (1) Ω₀ F_x, (2) Ω₀ F_px,des, (3) ρ F_px,min; ratios F_c / F_px,des and F_c / F_x; no F_px,max term', () => {
  const o = run();
  assert.deepEqual(coll(o), [[56.25, 56.25, 26, null, 56.25, '1'], [56.25, 100, 52, null, 100, '2']]);
  assert.deepEqual(o.collectorTable.map(r => [r.fcOverFpx, r.kC]), [[2.5, 2.5], [2.5, 4.444]]);
  assert.ok(!o.collectorTable.some(r => 'lightFrame' in r), 'the old 0.4·S_DS·I_e·w_px column is gone');
});

test('light-frame diaphragm: Ω₀ − 0.5, not less than 2.0, in items 1 and 2 only', () => {
  assert.deepEqual([[2.5, true], [3, true], [2.2, true], [2, true], [1.5, true], [3, false]].map(([o, lf]) => omegaCollector(o, lf)), [2, 2.5, 2, 2, 1.5, 3]);
  const o = run({ lightFrame: true });
  assert.deepEqual(coll(o), [[45, 45, 26, null, 45, '1'], [45, 80, 52, null, 80, '2']]);
  assert.equal(o.options.omegaCollector, 2);
});

test('25 % (§12.3.3.5): on F_px,des (k_D) and item 3 only — never on a force with Ω₀', () => {
  const o = run({ increase25: true });
  assert.deepEqual(o.diaphragmTable.map(r => [r.fpxDesign, r.fpxDesignInc, r.kD]), [[22.5, 28.13, 1.25], [40, 50, 2.222]]);
  assert.deepEqual(coll(o), [[56.25, 56.25, 32.5, null, 56.25, '1'], [56.25, 100, 65, null, 100, '2']]);
  // item 3 governs only when it is the largest: Ω₀ 1.0 typed
  const g = run({ increase25: true, omega0: '1.0' });
  assert.deepEqual(coll(g)[1], [22.5, 40, 65, null, 65, '3']);
});

test('exception, braced entirely by wood light-frame shear walls: F_c = 1.25·ρ·F_px,des, no Ω₀ items', () => {
  assert.deepEqual(coll(run({ woodWallException: true })), [[null, null, null, 29.25, 29.25, 'exception'], [null, null, null, 52, 52, 'exception']]);
  const o = run({ woodWallException: true, increase25: true });
  assert.deepEqual(coll(o), [[null, null, null, 36.56, 36.56, 'exception'], [null, null, null, 65, 65, 'exception']]);
  assert.deepEqual(o.collectorTable.map(r => [r.fcOverFpx, r.kC]), [[1.625, 1.625], [1.625, 2.889]]);
});

test('screen tables: header rows symbol (one line) / unit / reference; equal widths; centred; <sub> / <sup>; ratios; ◄', () => {
  const box = document.createElement('div');
  elf.renderOutputs(box, run({ increase25: true }));
  const tables = [...box.querySelectorAll('table.elf-table')];
  assert.equal(tables.length, 3);
  const row = (tbl, k) => [...tbl.querySelector('tr[data-head="' + k + '"]').querySelectorAll('th')];
  const txt = cells => cells.map(c => c.textContent);
  const [st, dt, ct] = tables;
  assert.deepEqual(txt(row(st, 'label')), ['Level', 'wx', 'hx', 'wx·hxk', 'Cvx', 'Fx', 'Vx']);
  assert.deepEqual(txt(row(st, 'unit')), ['', 'kip', 'ft', '', '', 'kip', 'kip']);
  assert.deepEqual(txt(row(st, 'ref')), ['', '', '', '', 'Eq. 12.8-12', 'Eq. 12.8-11', 'Eq. 12.8-13']);
  assert.deepEqual(txt(row(dt, 'label')).slice(-2), ['1.25·Fpx,des', '1.25·Fpx,des / Fx']);
  assert.deepEqual(txt(row(dt, 'ref')).slice(1), ['§12.10.1.1', 'Eq. 12.10-1', 'Eq. 12.10-3', 'Eq. 12.10-2', '§12.10.1.1', '§12.3.3.5', '= kD (DA)']);
  assert.deepEqual(txt(row(ct, 'label')), ['Level', 'Ω0·Fx', 'Ω0·Fpx,des', '1.25·ρ·Fpx,min', 'Fc', 'Fc / Fpx,des', 'Fc / Fx']);
  assert.deepEqual(txt(row(ct, 'ref')).slice(1), ['§12.10.2.1(1)', '§12.10.2.1(2)', '§12.10.2.1(3)', 'max of (1)–(3)', '', '= kC (DA)']);
  // symbols on one line, every column the same width, everything centred
  for (const tbl of tables) {
    const ths = [...tbl.querySelectorAll('th')], tds = [...tbl.querySelectorAll('td')];
    assert.ok(row(tbl, 'label').every(t => t.style.whiteSpace === 'nowrap'));
    assert.equal(new Set(row(tbl, 'label').map(t => t.style.width)).size, 1);
    assert.ok([...ths, ...tds].every(c => c.style.textAlign === 'center'));
    assert.ok(ths.every(t => t.style.textTransform === 'none') && tbl.style.tableLayout === 'fixed');
  }
  // subscripts / superscripts as elements: h_x^k, F_px,des, Ω_0, k_D
  const subs = c => [...c.querySelectorAll('sub')].map(x => x.textContent), sups = c => [...c.querySelectorAll('sup')].map(x => x.textContent);
  const whk = row(st, 'label')[3];
  assert.deepEqual([subs(whk), sups(whk)], [['x', 'x'], ['k']]);
  assert.deepEqual(subs(row(ct, 'label')[2]), ['0', 'px,des']);
  assert.deepEqual(subs(row(dt, 'ref').slice(-1)[0]), ['D']);
  assert.ok(!txt([...box.querySelectorAll('th')]).some(h => /_|\^|\{/.test(h)), 'no markup left as text');
  assert.ok(box.textContent.includes('100.00 ◄'));
  assert.ok([...box.querySelectorAll('p sub')].some(x => x.textContent === 'px,des'), 'the note uses subscripts too');
  const ex = document.createElement('div');
  elf.renderOutputs(ex, run({ woodWallException: true }));
  assert.ok([...ex.querySelectorAll('th')].some(t => t.textContent.includes('§12.10.2.1 Exc.')) && !ex.textContent.includes('Ω0·Fx'));
});

test('form: three option ticks with notes; PDF: options, column references, equations page', () => {
  const box = document.createElement('div');
  elf.renderForm(box, { ...base, lightFrame: false, increase25: false, woodWallException: false, notes: '' }, () => {}, []);
  assert.deepEqual([...box.querySelectorAll('[data-elf-option]')].map(x => x.getAttribute('data-elf-option')), ['lightFrame', 'increase25', 'woodWallException']);
  assert.ok(box.textContent.includes('Ω₀ − 0.5, not less than 2.0') && box.textContent.includes('never to a force that includes Ω₀'));
  const inputs = { ...base, increase25: true, lightFrame: true };
  const secs = elf.pdfSections(inputs, elf.calc(inputs));
  const opt = secs.find(s => s.title === 'Options').rows.map(r => r.join(': '));
  assert.ok(opt[0].includes('→ Ω₀ = 2') && opt[1].includes('never with Ω₀') && opt[2].endsWith('No'), opt.join(' | '));
  const ct = secs.find(s => (s.title || '').startsWith('Collector Design Forces')).table;
  assert.ok(ct.headers.includes('1.25·ρ·F_{px,min} (kip) [§12.10.2.1(3)]') && ct.headers.includes('F_{c} / F_{x} [= k_{C} (DA)]'), ct.headers.join(' | '));
  assert.ok(ct.colWidths.every(w => Math.abs(w - 1 / ct.headers.length) < 1e-12), 'equal PDF column widths');
  const et = secs.find(s => (s.title || '').startsWith('ELF Story Shear')).table;
  assert.ok(et.headers.includes('w_{x}·h_{x}^{k}') && et.headers.includes('C_{vx} [Eq. 12.8-12]'), et.headers.join(' | '));
  assert.ok(secs[0].rows.some(r => r[0] === 'S_{DS}'));
  const dt = secs.find(s => (s.title || '').startsWith('Diaphragm Design Forces')).table;
  assert.ok(dt.headers.some(h => h.includes('[§12.3.3.5]')), dt.headers.join(' | '));
  const eq = secs.find(s => s.equations).equations.map(e => e.ref);
  assert.ok(['§12.10.2.1 (1)', '§12.10.2.1 (2)', '§12.10.2.1 (3)', '§12.10.2.1 Exc.', 'Light-frame'].every(r => eq.includes(r)));
});

// ── Diaphragm Analysis checks against the linked ELF (td-v19)
test('DA: walls above × max(Ω₀, 1.25) at the diaphragm level (not Ω₀ × 1.25)', () => {
  assert.equal(forceLevels({ level: { transferOmega: '2.5', transferIncrease: true } }).transfer, 2.5);
  assert.equal(forceLevels({ level: { transferOmega: '2.5', transferIncrease: false } }).transfer, 2.5);
  assert.equal(forceLevels({ level: { transferOmega: '1', transferIncrease: true } }).transfer, 1.25);
});

test('DA: Seismic Base Shear of the linked ELF and the linked Shear Wall Design must be the same item', () => {
  const swd = id => ({ definition: { refs: id ? { baseShearSource: id } : {} } });
  const codes = (elfBs, swdBs) => elfLinkChecks({ level: {} }, { elfSource: { baseShearSource: elfBs, options: {} }, wallSource: swd(swdBs) }).map(c => c.code);
  assert.deepEqual(codes('bs-1', 'bs-1'), []);
  assert.deepEqual(codes(null, null), []);
  assert.deepEqual(codes('bs-1', 'bs-2'), ['elf-swd-baseshear']);
  assert.deepEqual(codes('bs-1', null), ['elf-swd-baseshear']);
  assert.ok(elfLinkChecks({ level: {} }, { elfSource: { baseShearSource: null, options: {} }, wallSource: swd('bs-2') })[0].msg.includes('the linked ELF item has none'));
  assert.deepEqual(elfLinkChecks({ level: {} }, { elfSource: { baseShearSource: 'bs-1' } }), [], 'no SWD link: nothing to compare');
});

test('DA: the +25 % tick must match the linked ELF 25 % box (only with walls above that end here)', () => {
  const link = { above: { walls: [{ kind: 'transfer' }] } };
  const c = (tick, elf25, lk = link) => elfLinkChecks({ level: { transferIncrease: tick } }, { elfSource: { options: { increase25: elf25 } } }, lk).map(x => x.code);
  assert.deepEqual(c(true, true), []);
  assert.deepEqual(c(false, false), []);
  assert.deepEqual(c(false, true), ['elf-25']);
  assert.deepEqual(c(true, false), ['elf-25']);
  assert.deepEqual(c(false, true, { above: { walls: [{ kind: 'through' }] } }), [], 'no wall ends at this floor');
});

console.log(passed + ' passed');
