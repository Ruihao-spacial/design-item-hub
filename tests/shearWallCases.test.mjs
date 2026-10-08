// Shear wall METHOD verification cases (tests/cases/*.json, built from tests/cases/src by npm run cases:build).
// Each case pins its design (nailing, holdowns / straps, posts, anchors) as manual overrides, so it verifies the
// method (loads, shares, T/C per load case, combinations, stacking, deflection) and never the selection rules — those
// are tested as properties in tests/shearWallRules.test.mjs (V05, V06, V07 and V16 moved there).
// For every case:
//   T1 line checks G1–G12 pass (or the ones the case says must fail fail) and required audit warnings exist
//   T2 every hand-calc value (expect) matches the engine within its tolerance
//   T3 method agreement on every wall: C3 corner overturning = C4 load-case totals, C5 superposition = the tool
//   T4 every results tab, every wall calc sheet, the elevation and the PDF sections render, with no raw
//      unrounded number in the text
//   T5 golden output (tests/cases/golden/Vxx.json) — the reviewed key results; refresh with npm run cases:accept
// Run: node tests/shearWallCases.test.mjs [--accept]
import fs from 'fs';
import assert from 'assert/strict';
import '../scripts/lib/shearWallLoadCheck.mjs'; // sets up the stand-in DOM
import { calcAll } from '../src/modules/shearWallCalc.js';
import { shearWallDesign, renderLineResults } from '../src/modules/shearWallDesign.js';
import { renderElevationForPdf } from '../src/modules/shearWallElevation.js';
import { cornerOverturningRows, loadCaseEnds, superpositionRows } from '../src/modules/shearWallCalcSheet.js';
import { evaluateCase, fmtValue } from '../src/modules/shearWallVerify.js';

const ACCEPT = process.argv.includes('--accept');
const DIFF = process.argv.includes('--diff'); // npm run cases:diff — list the changed golden fields before cases:accept
// Changed leaves between two goldens, as 'path: old → new' (walls / posts / beams keyed by mark)
function goldenDiff(a, b, path = '') {
  const out = [];
  const key = (x, i) => (x && typeof x === 'object' && (x.mark || x.line || x.level)) || String(i);
  if (Array.isArray(a) && Array.isArray(b)) {
    const ka = new Map(a.map((x, i) => [key(x, i), x])), kb = new Map(b.map((x, i) => [key(x, i), x]));
    for (const k of new Set([...ka.keys(), ...kb.keys()])) out.push(...goldenDiff(ka.get(k), kb.get(k), path + '[' + k + ']'));
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out.push(...goldenDiff(a[k], b[k], path ? path + '.' + k : k));
  } else if (JSON.stringify(a) !== JSON.stringify(b)) out.push(path + ': ' + JSON.stringify(a) + ' → ' + JSON.stringify(b));
  return out;
}
const casesDir = new URL('./cases/', import.meta.url);
const goldenDir = new URL('./cases/golden/', import.meta.url);
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 6).join('\n       ')); process.exitCode = 1; }
}

export function loadCases() {
  return fs.readdirSync(casesDir).filter(f => /^V\d\d-.*\.json$/.test(f)).sort()
    .map(f => ({ file: f, def: JSON.parse(fs.readFileSync(new URL(f, casesDir), 'utf8')) }));
}
const cases = loadCases();
const run = (def) => {
  const inp = shearWallDesign.migrate({ schemaVersion: def.schemaVersion, inputs: JSON.parse(JSON.stringify(def.inputs)) }).inputs;
  return { inp, out: calcAll(inp) };
};
const walls = (out) => out.perDirection.flatMap(d => d.perLine.flatMap(ln => ln.perLevel.flatMap(pl => pl.walls)));
const q = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v ?? null);

// Key results kept as the golden record of a case
function golden(out) {
  const g = { calcVersion: out.calcVersion, lines: [] };
  for (const d of out.perDirection) for (const ln of d.perLine) {
    g.lines.push({
      line: d.dirName + ' / ' + ln.lineName,
      walls: ln.perLevel.flatMap(pl => pl.walls.map(w => ({
        mark: w.mark, level: pl.levelName, method: w.method, nailing: w.nailing && w.nailing.id, basis: w.nailingBasis || null,
        V_E: q(w.shareExact_1E), V_W: q(w.shareExact_1W), dc: q(w.dcRatio),
        T: [q((w.hwDemand || {}).tL ?? w.governingTensionLeft), q((w.hwDemand || {}).tR ?? w.governingTensionRight)],
        C: [q((w.hwDemand || {}).cL ?? w.governingComprLeft), q((w.hwDemand || {}).cR ?? w.governingComprRight)],
        anchorage: [(w.anchorageLeft || {}).id || null, (w.anchorageRight || {}).id || null],
        posts: [(w.postLeft || {}).postLabel || null, (w.postRight || {}).postLabel || null],
        deltaE: q(w.deflection && w.deflection.E && w.deflection.E.delta),
      }))),
      posts: (ln.postPaths || []).map(p => ({ mark: p.mark, T: q(p.envelopeT), C: q(p.envelopeC), anchorage: (p.anchorage || {}).id || null, post: (p.post || {}).postLabel || null })),
      beams: (ln.beamTransfers || []).map(b => ({ mark: b.mark, supports: b.supports.map(s => ({ x: s.position, T: q(s.envelopeT), C: q(s.envelopeC), receiver: s.receiver && s.receiver.type })) })),
      drift: ((ln.drift && ln.drift.rows) || []).map(r => ({ level: r.levelName, dx: q(r.seismic && r.seismic.deltaX), pass: r.seismic ? r.seismic.pass ?? null : null })),
      checksFailed: (ln.checks || []).filter(c => c.status === 'fail').map(c => c.id),
      warnings: ((ln.loadPathAudit || {}).warnings || []).map(w => w.type),
    });
  }
  return g;
}

const RETIRED = ['V05', 'V06', 'V07', 'V16']; // selection-rule cases, now rule models in tests/rules/models/
// A method case may not expect a selection outcome (which nailing / hardware / post was picked) — only a role fixed by
// a condition (row.role, e.g. the TSS rod of a stacked WSWH) may be checked by id.
const SELECTION_FIELD = /(^|\.)(nailing\.id|nailingBasis|strengthNailing\.id|anchorage(Left|Right)?\.(id|rowId|W|de|grade)|post(Left|Right)?\.(postLabel|postId)|strap\.id)$/;
test('Method cases: no selection outcome is expected unless it is a fixed role; the design is pinned', () => {
  for (const { def } of cases) {
    assert.ok(!RETIRED.includes(def.id), def.id + ' is a rule model now');
    assert.ok(def.pinned && Object.keys(def.pinned).length, def.id + ' pins its design');
    for (const r of def.expect) assert.ok(r.role || !SELECTION_FIELD.test(r.field), def.id + ' ' + r.label + ' expects a selection (' + r.field + ')');
  }
});

test('Case files: ids unique, file name = id, every expect row names a hand-calc step', () => {
  const ids = cases.map(c => c.def.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  for (const { file, def } of cases) {
    assert.ok(file.startsWith(def.id + '-'), file);
    for (const k of ['title', 'intent', 'handCalc', 'expect', 'inputs']) assert.ok(def[k], def.id + ' has ' + k);
    const steps = new Set(def.handCalc.map(s => s.step));
    for (const r of def.expect) assert.ok(steps.has(r.step), def.id + ' ' + r.label + ': step ' + r.step);
    assert.ok(def.expect.length >= 3, def.id + ' has expected values');
  }
});

for (const { def } of cases) {
  const { inp, out } = run(def);
  const ev = evaluateCase(def, out);

  test(def.id + ' T1 line checks' + ((def.expectChecks || {}).fail || []).map(x => ' (' + x + ' must fail)').join(''), () => {
    const bad = ev.checks.filter(r => !r.pass).map(r => r.line + ' ' + r.id + ' ' + r.status + ' (expected ' + r.expected + ')');
    assert.deepEqual(bad, []);
    assert.deepEqual(ev.warnings.filter(w => !w.pass).map(w => w.type), [], 'required warnings');
  });

  test(def.id + ' T2 hand calc — ' + def.title, () => {
    const bad = ev.values.filter(r => !r.pass).map(r => r.label + ': expected ' + fmtValue(r.value) + ', got ' + fmtValue(r.actual) + (r.error ? ' (' + r.error + ')' : ''));
    assert.deepEqual(bad, []);
  });

  test(def.id + ' T3 C3 = C4 = the tool, C5 = governing', () => {
    for (const w of walls(out)) {
      if (!w.combos) continue;
      const c4 = loadCaseEnds(w);
      for (const dir of ['→', '←']) {
        const up = dir === '→' ? 'left' : 'right', piv = dir === '→' ? 'right' : 'left';
        for (const [k, v] of Object.entries(cornerOverturningRows(w, dir).values)) {
          const t = c4.N[k === '1.0E' || k === '1.0W' ? k + ' ' + dir : k];
          assert.ok(Math.abs(v.up - t[up]) <= 0.006 && Math.abs(v.pivot - t[piv]) <= 0.006, w.mark + ' ' + k + ' ' + dir);
        }
      }
      for (const r of superpositionRows(w)) if (r.diff != null) assert.ok(Math.abs(r.diff) <= 1e-6, w.mark + ' ' + r.cells[0] + ' C5 diff ' + r.diff);
    }
  });

  test(def.id + ' T4 every tab, calc sheet, elevation and PDF render (no raw decimals)', () => {
    const leaks = [];
    const scan = (txt, where) => { for (const m of String(txt).matchAll(/\d+\.\d{5,}/g)) leaks.push(where + ': …' + String(txt).slice(Math.max(0, m.index - 40), m.index + 12)); };
    for (const d of out.perDirection) for (const ln of d.perLine) {
      const line = inp.directions.find(x => x.id === d.dirId).lines.find(l => l.id === ln.lineId);
      const sheets = ln.perLevel.flatMap(pl => pl.walls.map(w => ({ level: pl.levelId, type: w.method, mark: w.mark })));
      for (const tab of ['distribution', 'checks', 'walls', 'loadpath', 'drift', 'lrfd', 'omega']) for (const report of ['summary', 'detailed']) {
        for (const detail of tab === 'walls' && report === 'detailed' ? sheets : [{}]) {
          const c = document.createElement('div');
          renderLineResults(c, ln, d, { tab, onTab() {}, report, onReport() {}, detail, onDetail() {}, defs: { inputs: inp, line } });
          for (const n of c.querySelectorAll('td, div, span, summary, th, button')) if (!n.children.length) scan(n.textContent, tab + ' ' + (detail.mark || ''));
        }
      }
      const svg = renderElevationForPdf(line, inp.levels, inp.wallDLTypes, ln, 900);
      for (const m of (typeof svg === 'string' ? svg : svg.outerHTML).matchAll(/>([^<]*)</g)) scan(m[1], 'elevation');
    }
    // PDF text (layout numbers like aspectRatio aren't text; values echoed exactly as the user typed them are allowed)
    const typed = new Set(JSON.stringify(inp).match(/\d+\.\d{5,}/g) || []);
    const pdf = JSON.stringify(shearWallDesign.pdfSections(inp), (k, v) => (k === 'aspectRatio' ? undefined : v));
    scan(pdf.replace(/\d+\.\d{5,}/g, (m) => (typed.has(m) ? '' : m)), 'PDF');
    const form = document.createElement('div');
    shearWallDesign.renderForm(form, JSON.parse(JSON.stringify(inp)), () => {}, [], () => {});
    assert.deepEqual(leaks.slice(0, 5), []);
  });

  test(def.id + ' T5 golden output', () => {
    const g = golden(out);
    const file = new URL(def.id + '.json', goldenDir);
    if (ACCEPT) { fs.mkdirSync(goldenDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(g, null, 2) + '\n'); return; }
    assert.ok(fs.existsSync(file), 'no golden for ' + def.id + ' — review the case, then npm run cases:accept');
    const want = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete want.calcVersion; delete g.calcVersion;
    if (DIFF) {
      const rows = goldenDiff(want, g);
      if (rows.length) console.log('       ' + def.id + ' golden changes (' + rows.length + '):\n' + rows.slice(0, 40).map(r => '         ' + r).join('\n') + (rows.length > 40 ? '\n         …' : ''));
    }
    assert.deepEqual(g, want);
  });
}

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : '') + (ACCEPT ? ' — goldens written' : ''));
