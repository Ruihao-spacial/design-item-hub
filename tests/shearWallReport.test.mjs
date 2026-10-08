// UI / report restructure (user review 2026-10-01): subscript markup, LC numbering, linked gravity loads (lateral DL,
// greyed out), line-result tabs (Walls first, Posts & Beams, Forces, Checks last) and the PDF organised per wall line.
// Run: node tests/shearWallReport.test.mjs
import fs from 'fs';
import assert from 'assert/strict';
import '../scripts/lib/shearWallLoadCheck.mjs'; // sets up the stand-in DOM
import { calcAll } from '../src/modules/shearWallCalc.js';
import { shearWallDesign, renderLineResults, postsBeamsRows, forcesRows, forceOptions, wallScheduleRows, dcLevel } from '../src/modules/shearWallDesign.js';
import { comboDefs } from '../src/modules/shearWallCombos.js';
import { renderElevation, planPdfElevation, renderElevationForPdf, pdfElevationPartSize, computeElevationLayout, textBox, LABEL_GAP_X } from '../src/modules/shearWallElevation.js';
const computeLayoutOf = (line, levels, results) => computeElevationLayout(line, levels, { pxPerFt: 18, showForces: true, results, combo: 'governing' });
import { assemblyPsf } from '../src/modules/shearWallGravity.js';
import { richRuns, rich, plainText } from '../src/richText.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 6).join('\n       ')); process.exitCode = 1; }
}
const caseInputs = (file) => {
  const c = JSON.parse(fs.readFileSync(new URL('./cases/' + file, import.meta.url), 'utf8'));
  return shearWallDesign.migrate({ schemaVersion: c.schemaVersion, inputs: c.inputs }).inputs;
};
const firstLine = (o) => o.perDirection[0].perLine[0];

test('Subscript markup: X_{ab} always, X_ab only in headers (short); DOM gets <sub>', () => {
  assert.deepEqual(richRuns('(1.0+0.14S_{DS})D'), [{ t: '(1.0+0.14S', sub: false }, { t: 'DS', sub: true }, { t: ')D', sub: false }]);
  assert.deepEqual(richRuns('SW_1 wall'), [{ t: 'SW_1 wall', sub: false }], 'cells keep an underscore without braces');
  assert.deepEqual(richRuns('R_D L / R (k)', true), [{ t: 'R', sub: false }, { t: 'D', sub: true }, { t: ' L / R (k)', sub: false }]);
  const d = document.createElement('div');
  const parts = rich('δ_{xe} (in)');
  parts.forEach(p => d.appendChild(p));
  assert.equal(d.querySelector('sub').textContent, 'xe');
  assert.equal(rich('plain'), 'plain');
  assert.equal(plainText('Ω_{0} = 2.5'), 'Ω0 = 2.5');
});

test('LC numbers: one per combination, continuous ASD → LRFD → Ω₀ ASD → Ω₀ LRFD; load cases unnumbered', () => {
  for (const [loadType, n] of [['seismic', 17], ['wind', 13], ['both', 23]]) {
    const defs = comboDefs({ loadType, sds: 1 });
    const lcs = defs.filter(d => d.lc).sort((a, b) => +a.lc.slice(2) - +b.lc.slice(2));
    assert.equal(lcs.length, n, loadType);
    assert.deepEqual(lcs.map(d => d.lc), lcs.map((_, i) => 'LC' + (i + 1)), loadType + ' continuous');
    const order = ['asd', 'lrfd', 'asd_omega', 'lrfd_omega'];
    for (let i = 1; i < lcs.length; i++) assert.ok(order.indexOf(lcs[i].group) >= order.indexOf(lcs[i - 1].group), loadType + ' grouped');
    assert.ok(defs.filter(d => d.group === 'load_case').every(d => !d.lc), 'load cases have no LC#');
  }
  assert.equal(comboDefs({ loadType: 'seismic' }).find(d => d.key === '0.6D+0.7ρE').lc, 'LC7');
});

test('Linked gravity row: D = the Flat Load lateral DL; D / L / Lr greyed out; Unlink makes them editable', () => {
  const inp = caseInputs('V01-one-wall.json');
  const ln = inp.directions[0].lines[0];
  ln.gravityLoads = { [inp.levels[0].id]: { loads: [] } };
  const roof = { id: 'tab1', name: 'Roof + PV', type: 'roof', llSymbol: 'Lr', dl: 18, dlLateral: 14, llGravity: 20 };
  assert.deepEqual(assemblyPsf(roof), { D: 14, L: 0, Lr: 20 });
  assert.equal(assemblyPsf({ id: 'old', dl: 12, llGravity: 40 }).D, 12, 'older Flat Load result without dlLateral → dl');
  const c = document.createElement('div');
  const h = renderElevation(c, ln, inp.levels, [], { flatLoadAssemblies: () => [roof] });
  [...c.querySelectorAll('button')].find(b => b.textContent === '+ Uniform (full line)').dispatchEvent(new window.Event('click'));
  const sel = [...c.querySelectorAll('select')].find(s => [...s.querySelectorAll('option')].some(o => o.getAttribute('value') === 'tab1'));
  assert.ok([...sel.querySelectorAll('option')].some(o => o.textContent.includes('lateral DL 14')), 'option shows the lateral DL');
  [...sel.querySelectorAll('option')].find(o => o.getAttribute('value') === 'tab1').setAttribute('selected', '');
  sel.dispatchEvent(new window.Event('change'));
  const row = ln.gravityLoads[inp.levels[0].id].loads[0];
  assert.equal(row.D, '14'); assert.equal(row.Lr, '20');
  const mags = () => [...c.querySelectorAll('input[type="number"]')].filter(i => /^(D|L|Lr) /.test(i.getAttribute('title') || ''));
  assert.equal(mags().length, 3);
  assert.ok(mags().every(i => i.disabled), 'D / L / Lr disabled while linked');
  assert.ok(mags()[0].getAttribute('title').includes('lateral dead load'));
  [...c.querySelectorAll('button')].find(b => b.textContent === 'Unlink').dispatchEvent(new window.Event('click'));
  assert.equal(row.assemblyId, '');
  assert.ok(mags().every(i => !i.disabled), 'editable after Unlink');
  h.destroy();
});

test('Tabs: Walls (default) · Distribution · Posts & Beams · Drift · Forces · Checks', () => {
  const o = calcAll(caseInputs('V10-transfer-beam.json'));
  const b = document.createElement('div');
  renderLineResults(b, firstLine(o), o.perDirection[0], { tab: 'nope', onTab() {} });
  const labels = [...b.querySelectorAll('button')].map(x => x.textContent).filter(t => /^(Walls|Distribution|Posts & Beams|Drift|Forces|Checks)/.test(t));
  assert.deepEqual(labels.map(t => t.split(' (')[0]), ['Walls', 'Distribution', 'Posts & Beams', 'Drift', 'Forces', 'Checks']);
  assert.ok(b.textContent.includes('Nailing (cap)'), 'default tab = Walls summary schedule');
});

test('Wall schedule: cap next to the nailing, D/C with v and every HD / strap / post, T and C at left / right', () => {
  const o = calcAll(caseInputs('V01-one-wall.json'));
  const pl = firstLine(o).perLevel[0], w = pl.walls[0];
  const r = wallScheduleRows(pl)[0];
  assert.ok(r[2].startsWith(w.nailing.label + ' — ') && r[2].endsWith(' plf'));
  assert.equal(r[4].dc, w.dcRatio);
  assert.equal(r[5], w.governingTensionLeft.toFixed(2) + ' / ' + w.governingTensionRight.toFixed(2));
  assert.equal(r[7].dc, w.anchorageDCLeft); assert.equal(r[9].dc, w.postDCLeft);
  assert.equal(dcLevel(1.2), 'fail'); assert.equal(dcLevel(0.85), 'warn'); assert.equal(dcLevel(0.5), 'pass');
});

test('Posts & Beams: every post base and beam support is listed with its hardware and governing LC#', () => {
  for (const f of ['V09-offset-stack-post.json', 'V10-transfer-beam.json', 'V11-beam-point-support.json', 'V12-unsupported-gravity.json']) {
    const ln = firstLine(calcAll(caseInputs(f)));
    const rows = postsBeamsRows(ln);
    const expected = (ln.postPaths || []).length + (ln.beamTransfers || []).reduce((a, bt) => a + Math.max(1, bt.supports.length), 0);
    assert.equal(rows.length, expected, f);
    for (const r of rows) if (r[3] !== '—' && !r[3].startsWith('0.00')) assert.ok(/— LC\d+ [→←]?/.test(r[3]) || r[3].endsWith('— LC1') || /— LC\d+$/.test(r[3]), f + ' governing LC# on ' + r[3]);
  }
});

test('Forces: the ASD envelope = the largest ASD LC at each end; an LRFD LC uses the HDUE LRFD cap', () => {
  const ln = firstLine(calcAll(caseInputs('V19-lrfd-omega.json')));
  const w = ln.perLevel[0].walls[0], combos = w.combos;
  const env = forcesRows(ln, 'governing');
  const maxT = Math.max(0, ...Object.entries(w.accumPerCombo || w.combos).filter(([k]) => combos[k].group === 'asd').map(([, c]) => c.tensionLeft || 0));
  assert.ok(env[0][3].startsWith(maxT.toFixed(2) + ' — LC'), env[0][3]);
  const lrfdKey = Object.keys(combos).find(k => combos[k].group === 'lrfd' && combos[k].f.e > 0);
  const lr = forcesRows(ln, lrfdKey);
  const a = w.anchorageLeft;
  if (a && a.id.startsWith('HDUE')) assert.equal(lr[0][6], (Math.round(a.cap * 1.4) / 1000).toFixed(2));
  assert.ok(forceOptions(ln).some(g => g.label.startsWith('Ω₀ ASD')), 'Ω₀ LCs in the dropdown');
});

test('PDF per wall line: front pages are project-wide; each line starts a sheet; no table mixes lines', () => {
  const inp = caseInputs('V17-deflection-distribution.json'); // two lines (A and B)
  for (const report of ['summary', 'detailed']) {
    const secs = shearWallDesign.pdfSections({ ...inp, pdfReport: report });
    const out = calcAll(inp);
    const lines = out.perDirection.flatMap(d => d.perLine.map(ln => ({ d, ln })));
    assert.ok(lines.length >= 2);
    // front (user review 2026-10-01): design data without nailing / distribution / wall DL rows, lateral loading of all
    // lines per direction, load cases + LCs, wall lines table (no sheet column)
    const design = secs.find(x => x.title === 'Design Data').rows.map(r => r[0]);
    assert.ok(!design.some(r => /Nailing capacities|Wall distribution|Wall DL/.test(r)), design.join(', '));
    assert.ok(secs.some(x => /^Lateral loading — .* \(unfactored, all lines\)$/.test(x.title)), 'lateral loading on the front');
    const idx = secs.find(x => x.title === 'Wall lines');
    assert.equal(idx.table.rows.length, lines.length);
    assert.deepEqual(idx.table.headers, ['Direction', 'Line', 'Walls', 'Status']);
    assert.ok(!secs.some(x => /Project Summary/.test(x.title)));
    for (const { d, ln } of lines) {
      const pre = d.dirName + ' / ' + ln.lineName;
      const head = secs.find(x => x.heading === 'Wall line ' + pre);
      assert.ok(head && head.pageBreakBefore, 'large heading on a new sheet for ' + pre);
      for (const t of [' — Line definition', ' — Walls (definition)', ' — Elevation — end forces, ASD envelope', ' — Elevation — hardware'])
        assert.ok(secs.some(x => x.title.startsWith(pre + t)), pre + t);
    }
    for (const { d, ln } of lines) {
      const marks = new Set(ln.perLevel.flatMap(pl => pl.walls.map(w => w.mark)));
      for (const s of secs.filter(x => x.title.startsWith(d.dirName + ' / ' + ln.lineName + ' — Wall schedule'))) {
        for (const r of s.table.rows) assert.ok(marks.has(String(r[0]).replace(/ \(.*\)$/, '')), report + ': ' + r[0] + ' belongs to ' + ln.lineName);
      }
    }
    const hasCalc = secs.some(s => / — Calc sheet /.test(s.title));
    assert.equal(hasCalc, report === 'detailed');
  }
});

test('Drift tab, wind: no α_s → the tab says why (not "no walls carrying shear"); with α_s → service drift, report only', () => {
  const base = caseInputs('V18-wind-and-both.json');
  const tabText = (inp) => { const o = calcAll(inp); const b = document.createElement('div'); renderLineResults(b, firstLine(o), o.perDirection[0], { tab: 'drift', onTab() {} }); return b.textContent; };
  const noAlpha = tabText({ ...base, loadType: 'wind', alphaS: '' });
  assert.ok(noAlpha.includes('No story drift: Wind drift is computed only with the service-level wind factor α_s'), noAlpha.slice(0, 200));
  assert.ok(!noAlpha.includes('no walls carrying shear'));
  // with α_s: a wind table of its own (no C_d / I_e columns) against h_sx / n (default 400), report only (user 2026-10-01)
  const withAlpha = tabText({ ...base, loadType: 'wind', alphaS: '0.7' });
  assert.ok(withAlpha.includes('Story drift — wind, service level (limit hsx / 400, report only)'), withAlpha.slice(0, 300));
  assert.ok(!withAlpha.includes('Cd·δxe') && !withAlpha.includes('Story drift — seismic'), 'no seismic C_d columns for wind');
  assert.ok(withAlpha.includes('0.300 (h/400)'), 'Δ_allow = 10 ft × 12 / 400');
  const both = tabText({ ...base, loadType: 'both', alphaS: '' });
  assert.ok(both.includes('Story drift — seismic') && both.includes('Wind drift is computed only with'), 'both: seismic rows + why wind is missing, visible');
});

test('Wind drift limit h / n: project setting (v12 default 400), allowable = h·12/n, NG is a warning only', () => {
  const base = caseInputs('V18-wind-and-both.json');
  assert.equal(base.windDriftLimit, '400', 'v11 → v12 migration adds the default');
  for (const n of ['400', '600']) {
    const o = calcAll({ ...base, loadType: 'wind', alphaS: '0.7', windDriftLimit: n });
    for (const ln of o.perDirection[0].perLine) for (const r of ln.drift.rows) {
      assert.equal(r.wind.limitDen, +n);
      assert.ok(Math.abs(r.wind.allowable - r.hsx * 12 / +n) < 1e-4);
      assert.equal(r.wind.pass, r.wind.delta <= r.wind.allowable + 1e-9);
    }
  }
  const o = calcAll({ ...base, loadType: 'wind', alphaS: '0.7', windDriftLimit: '400' });
  const ng = o.perDirection[0].perLine.find(ln => ln.drift.rows.some(r => r.wind.pass === false));
  assert.ok(ng, 'a line over h/400 in V18');
  const b = document.createElement('div');
  renderLineResults(b, ng, o.perDirection[0], { tab: 'walls', onTab() {} });
  const badge = b.querySelector('.badge');
  assert.ok(badge.className.includes('badge-stale') && badge.textContent.includes('wind drift over h/n (report only)'), 'warning, not a failure');
});

test('PDF elevation: standard scale (largest of 1/4", 3/16", 1/8" within 2 parts), cuts only in gaps, landscape parts', () => {
  const mk = (len, walls) => ({ totalLength: len, walls: walls.map(([x, L], k) => ({ id: 'w' + k, mark: 'SW-' + k, position: x, length: L })), beams: [], supportPosts: [] });
  const check = (line, scale, nParts) => {
    const plan = planPdfElevation(line, 684);
    assert.equal(plan.scaleLabel, scale, JSON.stringify(plan));
    assert.equal(plan.parts.length, nParts, JSON.stringify(plan.parts));
    for (const w of line.walls) {
      const a = w.position, b = w.position + w.length;
      assert.ok(plan.parts.some(pt => pt.x0 <= a + 1e-9 && pt.x1 >= b - 1e-9), 'wall ' + w.mark + ' fully inside one part');
      for (const pt of plan.parts.slice(0, -1)) assert.ok(!(pt.x1 > a + 1e-9 && pt.x1 < b - 1e-9), 'no cut through ' + w.mark);
    }
    for (const pt of plan.parts) assert.ok(Number.isInteger(pt.x0 * 2) && Number.isInteger(pt.x1 * 2), 'half-foot limits');
    return plan;
  };
  check(mk(30, [[0, 8], [20, 10]]), `1/4" = 1'-0"`, 1);
  check(mk(60, [[0, 10], [40, 10]]), `1/4" = 1'-0"`, 2);
  check(mk(80, [[0, 8], [36, 8], [70, 8]]), `3/16" = 1'-0"`, 2);
  check(mk(100, [[0, 8], [30, 8], [60, 8], [88, 4]]), `1/8" = 1'-0"`, 2);
  check(mk(40, [[0, 8], [20, 4]]), `1/4" = 1'-0"`, 1); // empty length past the last wall is not a part
  // PDF: elevation parts are landscape, at the planned scale, with the scale and the part in the title
  const inp = caseInputs('V17-deflection-distribution.json');
  const secs = shearWallDesign.pdfSections({ ...inp, pdfReport: 'summary' });
  const ev = secs.filter(x => x.elevation);
  assert.ok(ev.length >= 4 && ev.every(x => x.landscape && x.elevation.width > 0 && x.title.includes(` — horizontal scale 1/4" = 1'-0"`)), ev.map(x => x.title).join(' | '));
  const o = calcAll(inp), line = inp.directions[0].lines[1], ln = o.perDirection[0].perLine[1];
  const plan = planPdfElevation(line, 684), view = { pxPerFt: plan.pxPerFt, ...plan.parts[0] };
  const svg = renderElevationForPdf(line, inp.levels, inp.wallDLTypes, ln, 0, 'hardware', view);
  const size = pdfElevationPartSize(line, inp.levels, true, 'hardware', view);
  assert.equal(+svg.getAttribute('width'), size.w);
  assert.ok([...svg.querySelectorAll('text')].some(t => t.textContent === 'Level 1'), 'level labels kept in the part');
});

test('PDF elevation: a label with no free spot becomes a numbered note under the drawing, never an overlap (TC-1 E-W)', () => {
  const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/tc1-two-story.json', import.meta.url), 'utf8'));
  const inp = shearWallDesign.migrate({ schemaVersion: fx.schemaVersion, inputs: fx.inputs }).inputs;
  const o = calcAll(inp);
  const di = inp.directions.findIndex(d => d.name === 'E-W');
  const line = inp.directions[di].lines[0], ln = o.perDirection[di].perLine[0];
  // at 1/8" = 1'-0" P-1 (inside SW-6, near its right end) has no free spot for its label
  const view = { pxPerFt: 9, x0: 0, x1: 30 };
  const svg = renderElevationForPdf(line, inp.levels, inp.wallDLTypes, ln, 0, 'forces', view);
  const texts = [...svg.querySelectorAll('text')].map(t => t.textContent);
  const note = texts.find(t => t.startsWith('(1) P-1 base: '));
  assert.ok(note, 'P-1 label moved to note (1): ' + texts.filter(t => t.startsWith('(')).join(' | '));
  const size = pdfElevationPartSize(line, inp.levels, ln, 'forces', view);
  assert.equal(+svg.getAttribute('height'), size.h, 'the image is tall enough for the notes');
  const noNotes = pdfElevationPartSize(line, inp.levels, true, 'forces', view);
  assert.ok(size.h > noNotes.h);
});

// === One elevation scene for the tool and the PDF (user 2026-10-01: the tool elevation is the standard) ===
const tc1 = () => {
  const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/tc1-two-story.json', import.meta.url), 'utf8'));
  return shearWallDesign.migrate({ schemaVersion: fx.schemaVersion, inputs: fx.inputs }).inputs;
};
// Visible label texts (halo copies skipped) as "text @ x,y", inside the drawing (legend / notes excluded);
// the manual-override marker is ✎ in the tool (click to change) and * in print
const sceneLabels = (svg, maxY) => new Set([...svg.querySelectorAll('text')]
  .filter(t => !t.getAttribute('stroke') && +t.getAttribute('y') <= maxY && !/^\d+$/.test(t.textContent))
  .map(t => t.textContent.replace(/✎/g, '*') + ' @ ' + Math.round(+t.getAttribute('x')) + ',' + Math.round(+t.getAttribute('y'))));
// The tool's elevation at a given scale (px per ft), with the Forces / Hardware checkboxes set
function liveSvg(line, levels, results, pxPerFt, { forces, hw }) {
  const p = Object.getPrototypeOf(document.createElement('div')); // the stand-in DOM has no layout: set the width
  const W = pxPerFt * (parseFloat(line.totalLength) || 60) + 100; // GUTTER 80 + 20
  Object.defineProperty(p, 'clientWidth', { get() { return W; }, configurable: true });
  const c = document.createElement('div');
  const h = renderElevation(c, JSON.parse(JSON.stringify(line)), levels, [], {});
  h.showResults(results);
  const box = (name) => [...c.querySelectorAll('label')].find(l => l.textContent === name).querySelector('input');
  for (const [name, on] of [['Forces', forces], ['Hardware', hw]]) {
    const b = box(name);
    if (b.checked !== on) { b.checked = on; b.dispatchEvent(new window.Event('change')); }
  }
  h.drawSVG();
  const svg = c.querySelector('svg');
  delete p.clientWidth;
  return svg;
}

test('Elevation: the tool and the PDF draw the same scene (same labels at the same places, both modes)', () => {
  const models = [['TC-1', tc1()], ...['V10-transfer-beam.json', 'V14-ftao-apa-t555.json', 'V20-wswh-concrete-mixed.json', 'V09-offset-stack-post.json'].map(f => [f, caseInputs(f)])];
  let compared = 0;
  for (const [name, inp] of models) {
    const o = calcAll(inp);
    inp.directions.forEach((d, di) => d.lines.forEach((line, li) => {
      const ln = o.perDirection[di].perLine[li];
      if (!ln || !(line.walls || []).length) return;
      for (const mode of ['forces', 'hardware']) {
        const len = parseFloat(line.totalLength) || 60;
        const px = Math.max(18, 300 / len); // the tool's elevation is at least 400 px wide
        const view = { pxPerFt: px, x0: 0, x1: len };
        const pdf = renderElevationForPdf(line, inp.levels, [], ln, 0, mode, view);
        const live = liveSvg(line, inp.levels, ln, px, { forces: mode === 'forces', hw: mode === 'hardware' });
        const maxY = +live.getAttribute('height');
        const a = sceneLabels(live, maxY), b = sceneLabels(pdf, maxY);
        const onlyLive = [...a].filter(x => !b.has(x)), onlyPdf = [...b].filter(x => !a.has(x));
        assert.deepEqual([onlyLive, onlyPdf], [[], []], name + ' ' + line.name + ' ' + mode + ': labels differ');
        compared++;
      }
    }));
  }
  assert.ok(compared >= 10, 'compared ' + compared + ' elevations');
});

test('Elevation: a narrow wall reads "(both)" when its ends match, else one L: / R: row per end (T/C and Wall HW row)', () => {
  const inp = tc1();
  const o = calcAll(inp);
  const di = inp.directions.findIndex(d => d.name === 'E-W');
  const line = inp.directions[di].lines[0], ln = o.perDirection[di].perLine[0];
  const plan = planPdfElevation(line, 684), view = { pxPerFt: plan.pxPerFt, ...plan.parts[0] };
  const texts = (mode) => [...renderElevationForPdf(line, inp.levels, inp.wallDLTypes, ln, 0, mode, view).querySelectorAll('text')]
    .filter(t => !t.getAttribute('stroke')).map(t => t.textContent);
  const f = texts('forces');
  // SW-5 (5 ft, roof): both ends equal
  assert.ok(f.includes('P ▲2.38 ▼2.82k (both)'), 'SW-5 P row with (both): ' + f.filter(t => t.startsWith('P')).join(' | '));
  // SW-6 (8 ft): its left end takes SW-5's end from above, SW-5's right end lands on P-1 → ends differ
  for (const row of ['L: P ▲4.13 ▼4.90k', 'R: P ▲4.13 ▼4.90k', 'L: Σ▲6.51 ▼7.71k', 'R: Σ▲4.13 ▼4.90k']) assert.ok(f.includes(row), 'SW-6 row ' + row);
  const hw = texts('hardware');
  assert.ok(hw.some(t => /^MSTC\d+ [\d.]+ \(both\)$/.test(t)), 'SW-5 Wall HW row (both)');
  // ends equal → "(both)" at any width (user 2026-10-01): TC-1 N-S SW-2 / SW-4 (10 ft, wide enough for two columns)
  const ns = inp.directions.findIndex(d => d.name === 'N-S');
  const nsLine = inp.directions[ns].lines[0], nsLn = o.perDirection[ns].perLine[0];
  const nsPlan = planPdfElevation(nsLine, 684), nsView = { pxPerFt: nsPlan.pxPerFt, ...nsPlan.parts[0] };
  const nsTexts = (mode) => [...renderElevationForPdf(nsLine, inp.levels, inp.wallDLTypes, nsLn, 0, mode, nsView).querySelectorAll('text')]
    .filter(t => !t.getAttribute('stroke')).map(t => t.textContent);
  const nf = nsTexts('forces'), nh = nsTexts('hardware');
  for (const t of ['P ▲0.66 ▼1.41k (both)', 'P ▲2.89 ▼4.81k (both)', 'Σ3.56k (both)', 'Σ6.22k (both)']) assert.ok(nf.includes(t), 'N-S ' + t + ': ' + nf.filter(x => /both|^P |Σ/.test(x)).join(' | '));
  assert.ok(nh.includes('HDUE3 0.94 (both)') && nh.includes('(3)2x4 0.83 (both)'), 'SW-4 Wall HW row (both)');
  assert.ok(nf.includes('P ▲0.64 ▼3.74k') && nf.includes('P ▲1.04 ▼2.87k'), 'SW-7 ends differ → two columns');
  // the strip is one row taller on the level with the L: / R: Σ rows (4 rows)
  const L3 = computeLayoutOf(line, inp.levels, ln);
  assert.equal(L3.levelYs[1].forceStripH - L3.levelYs[0].forceStripH, 11);
});

test('Elevation labels keep a 4 px gap side by side; P-1 (inside SW-6) goes to note (1) instead of touching SW-6', () => {
  const inp = tc1();
  const o = calcAll(inp);
  const di = inp.directions.findIndex(d => d.name === 'E-W');
  const line = inp.directions[di].lines[0], ln = o.perDirection[di].perLine[0];
  const plan = planPdfElevation(line, 684), view = { pxPerFt: plan.pxPerFt, ...plan.parts[0] };
  assert.equal(plan.scaleLabel, '1/4" = 1\'-0"');
  const svg = renderElevationForPdf(line, inp.levels, inp.wallDLTypes, ln, 0, 'forces', view);
  const texts = [...svg.querySelectorAll('text')].map(t => t.textContent);
  assert.ok(texts.some(t => t.startsWith('(1) P-1 base: ')), 'P-1 label moved to note (1)');
  // placed labels in the drawing (one window; halo copies skipped): side-by-side boxes are ≥ 4 px apart
  const inner = svg.querySelectorAll('svg')[1];
  const boxes = [...inner.querySelectorAll('text')].filter(t => !t.getAttribute('stroke') && t.textContent.length > 2 && /[▲▼]/.test(t.textContent)).map(t => {
    const attrs = {}; for (const a of t.attributes) attrs[a.name] = isNaN(+a.value) ? a.value : +a.value;
    return { text: t.textContent, ...textBox(attrs, t.textContent) };
  });
  const close = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const sameRow = a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
    if (sameRow && a.x < b.x + b.w + LABEL_GAP_X && b.x < a.x + a.w + LABEL_GAP_X) close.push(a.text + ' × ' + b.text);
  }
  assert.deepEqual(close, []);
});

test('Calc sheet: the PDF Detailed calc sheet of every wall is the tool calc sheet (same headings, same table cells)', () => {
  const norm = (x) => String(x).replace(/_{([^}]*)}/g, '$1').replace(/s+/g, ' ').trim(); // compare plain text (subscripts dropped)
  let walls = 0;
  for (const [name, inp] of [['TC-1', tc1()], ['V14', caseInputs('V14-ftao-apa-t555.json')], ['V20', caseInputs('V20-wswh-concrete-mixed.json')]]) {
    const o = calcAll(inp);
    const pdf = shearWallDesign.pdfSections({ ...inp, pdfReport: 'detailed' }, o);
    o.perDirection.forEach((dirOut, di) => dirOut.perLine.forEach((ln, li) => {
      const line = inp.directions[di].lines[li];
      for (const pl of ln.perLevel) for (const w of pl.walls) {
        // screen: the Detailed sheet of this wall
        const c = document.createElement('div');
        renderLineResults(c, ln, dirOut, { tab: 'walls', onTab() {}, report: 'detailed', onReport() {}, detail: { level: pl.levelId, type: w.method, mark: w.mark }, onDetail() {}, defs: { inputs: inp, line } });
        const sheet = [...c.querySelectorAll('div')].find(d => d.firstChild && d.firstChild.textContent === 'Calc sheet — ' + w.mark + ' (' + pl.levelName + ', ' + d.firstChild.textContent.split(', ').pop());
        assert.ok(sheet, name + ' ' + w.mark + ' screen sheet');
        const screenCells = [...sheet.querySelectorAll('td')].map(td => norm(td.textContent)).filter(x => x && !/^(Open .+|Load path) →$/.test(x)); // the screen's link buttons
        // PDF: the sections of this wall's sheet
        const secs = pdf.filter(x => x.sheetOf === w.wallId);
        assert.ok(secs.length && secs[0].title === dirOut.dirName + ' / ' + ln.lineName + ' — Calc sheet ' + w.mark + ' (' + pl.levelName + ', ' + secs[0].title.split(', ').pop(), name + ' ' + w.mark + ' PDF sheet');
        const pdfCells = secs.flatMap(x => x.table ? x.table.rows.flatMap(r => (r.cells || r)) : x.rows ? x.rows.flat() : [])
          .map(cl => norm(cl && typeof cl === 'object' ? cl.t : cl)).filter(Boolean);
        assert.deepEqual(pdfCells, screenCells, name + ' ' + w.mark + ': PDF cells = screen cells');
        const titles = secs.map(x => x.title).join(' | ');
        for (const h of ['A. Wall definition', 'B1. Lateral', 'C. Calculations']) assert.ok(titles.includes(h), name + ' ' + w.mark + ' PDF has ' + h);
        walls++;
      }
    }));
  }
  assert.ok(walls >= 8, walls + ' walls compared');
});

test('PDF elevations: FTAO strap on the hardware elevation only (with its D/C coloured); screen font and sizes', () => {
  const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/tc1-two-story.json', import.meta.url), 'utf8'));
  const inp = shearWallDesign.migrate({ schemaVersion: fx.schemaVersion, inputs: fx.inputs }).inputs;
  const o = calcAll(inp);
  const di = inp.directions.findIndex(d => d.name === 'N-S');
  const line = inp.directions[di].lines[0], ln = o.perDirection[di].perLine[0];
  const ftao = ln.perLevel.flatMap(pl => pl.walls).find(w => w.method === 'ftao');
  assert.ok(ftao && ftao.ftao.strap, 'TC-1 N-S has an FTAO wall with a strap');
  const plan = planPdfElevation(line, 684), view = { pxPerFt: plan.pxPerFt, ...plan.parts[0] };
  const textsOf = (mode) => [...renderElevationForPdf(line, inp.levels, inp.wallDLTypes, ln, 0, mode, view).querySelectorAll('text')];
  const strap = ftao.ftao.strap.id;
  assert.ok(!textsOf('forces').some(t => t.textContent.startsWith(strap)), 'no strap on the end-force elevation');
  const hw = textsOf('hardware').filter(t => t.textContent.startsWith(strap + ' ')).find(t => t.querySelector('tspan'));
  assert.ok(hw && hw.textContent.endsWith(ftao.ftao.strapDC.toFixed(2)), 'strap + D/C on the hardware elevation');
  const dcSpan = [...hw.querySelectorAll('tspan')].find(x => x.textContent === ftao.ftao.strapDC.toFixed(2));
  assert.ok(dcSpan && /#|var/.test(dcSpan.getAttribute('fill') || ''), 'strap D/C coloured');
  const svg = renderElevationForPdf(line, inp.levels, inp.wallDLTypes, ln, 0, 'hardware', view);
  assert.ok(/Barlow/.test(svg.getAttribute('font-family')), 'screen font stack');
  const level = [...svg.querySelectorAll('text')].find(t => t.textContent === 'Roof');
  assert.equal(level.getAttribute('font-size'), '11', 'level name at the screen size');
});

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
