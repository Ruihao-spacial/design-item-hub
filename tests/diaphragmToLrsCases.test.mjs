// Diaphragm to LRS verification cases (tests/dlrs-cases/Dxx-*.json, and the beam back-check cases Bxx-*.json).
// T1 hand-calc values + checks, T2 form / every tab / PDF sections render, T3 golden output (change detector).
// Run: node tests/diaphragmToLrsCases.test.mjs [--accept | --diff]
import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
await import('../scripts/lib/shearWallLoadCheck.mjs'); // stand-in DOM globals
const { diaphragmToLrs } = await import('../src/modules/diaphragmToLrs.js');
const { calcAll } = await import('../src/modules/diaphragmToLrsCalc.js');
const { evaluateCase } = await import('../src/modules/diaphragmToLrsVerify.js');

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'dlrs-cases');
const goldDir = path.join(dir, 'golden');
const ACCEPT = process.argv.includes('--accept'), DIFF = process.argv.includes('--diff');
const cases = fs.readdirSync(dir).filter(f => /^[DB]\d\d\w*-.*\.json$/.test(f)).sort().map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; }
}

assert.ok(cases.length >= 10, 'cases found: ' + cases.length);
for (const c of cases) {
  const out = calcAll(c.inputs);
  test(c.id + ' T1 hand-calc values and checks', () => {
    const ev = evaluateCase(c, out);
    const bad = [...ev.values.filter(r => !r.pass).map(r => r.label + ': expected ' + r.value + ', got ' + (r.error || r.actual)),
      ...ev.checks.filter(r => !r.pass).map(r => r.dir + ' ' + r.id + ' ' + r.status + ' (expected ' + r.expected + ')')];
    assert.deepEqual(bad, []);
  });
  test(c.id + ' T2 form, tabs, editor and PDF render', () => {
    const inputs = JSON.parse(JSON.stringify({ ...c.inputs, verification: { ...c, inputs: undefined } }));
    const box = document.createElement('div');
    diaphragmToLrs.renderForm(box, inputs, () => {}, [], () => {}, {});
    const click = (re) => { const b = [...box.querySelectorAll('button')].find(x => re.test(x.textContent)); if (b) b.dispatchEvent(new window.Event('click')); return !!b; };
    assert.ok(/PASS/.test(box.textContent), 'Verification tab shows PASS');
    for (const d of c.inputs.directions) {
      assert.ok(click(new RegExp('^' + d.name.replace(/[-]/g, '\\-'))), 'direction tab ' + d.name);
      for (const lv of c.inputs.levels) {
        click(new RegExp('^' + lv.name + ' \\('));
        const n = [...box.querySelectorAll('button')].filter(b => b.textContent === '▸').length;
        for (let i = 0; i < n; i++) {
          const b = [...box.querySelectorAll('button')].filter(x => x.textContent === '▸' || x.textContent === '▾')[i];
          if (b && b.textContent === '▸') b.dispatchEvent(new window.Event('click')); // open the editor of row i (closes the previous one)
        }
      }
      assert.ok(/Wall Line Shear Summary/.test(box.textContent));
    }
    assert.ok(click(/^Checks/));
    assert.ok(click(/^Setup$/));
    for (const rep of ['summary', 'detailed']) {
      const secs = diaphragmToLrs.pdfSections({ ...c.inputs, pdfReport: rep }, out);
      assert.ok(secs.length > 2, rep + ' sections');
      for (const s of secs) if (s.elevation) assert.ok(s.elevation.renderFn().tagName.toLowerCase() === 'svg');
      const txt = JSON.stringify(secs.map(s => ({ ...s, elevation: undefined })));
      assert.ok(!/NaN|undefined/.test(txt), rep + ' PDF has no NaN / undefined');
    }
    diaphragmToLrs.renderOutputs(document.createElement('div'), out);
  });
  test(c.id + ' T3 golden output', () => {
    const file = path.join(goldDir, c.id + '.json');
    const now = JSON.parse(JSON.stringify(out));
    if (ACCEPT || !fs.existsSync(file)) {
      fs.mkdirSync(goldDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(now, null, 1) + '\n');
      return;
    }
    const gold = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (DIFF) {
      const diffs = [];
      const walk = (a, b, p) => {
        if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) { if (a !== b) diffs.push(p + ': ' + JSON.stringify(a) + ' → ' + JSON.stringify(b)); return; }
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], p + '.' + k);
      };
      walk(gold, now, c.id);
      diffs.slice(0, 40).forEach(d => console.log('       ' + d));
    }
    assert.deepEqual(now, gold, 'output changed — review with --diff, then npm run dlrs:cases:accept');
  });
}

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
