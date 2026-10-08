// Diaphragm to LRS — stored data survives code changes (docs/data-durability.md).
// Every frozen fixture in tests/fixtures/legacy-dlrs/ (old schema, real items) must: lose no value when migrated,
// migrate idempotently, give the same engineering numbers, open in the form (every tab), save without loss,
// print, and its old stored outputs must still render. Also: merged lines (Test-123 R.4+R.5) and D9.
// Run: node tests/diaphragmToLrsMigrate.test.mjs
import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
await import('../scripts/lib/shearWallLoadCheck.mjs'); // stand-in DOM globals
const { diaphragmToLrs } = await import('../src/modules/diaphragmToLrs.js');
const { calcAll } = await import('../src/modules/diaphragmToLrsCalc.js');
const { DLRS_SCHEMA, DLRS_MIGRATIONS, migrateItem, lostValues, resultNumbers } = await import('../src/modules/diaphragmToLrsMigrate.js');

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/legacy-dlrs');
const fixtures = fs.readdirSync(dir).filter(f => /^schema\d+-.*\.json$/.test(f)).sort()
  .map(f => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
const clone = v => JSON.parse(JSON.stringify(v));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; }
}

// Open the form, visit every tab / level / editor, then press Save; returns the saved inputs.
function openAndSave(inputs) {
  let saved = null;
  const box = document.createElement('div');
  diaphragmToLrs.renderForm(box, inputs, (x) => { saved = clone(x); }, [], () => {}, {});
  const click = (pred) => { const b = [...box.querySelectorAll('button')].find(pred); if (b) b.dispatchEvent(new window.Event('click')); return !!b; };
  for (const d of inputs.directions) {
    assert.ok(click(b => b.textContent.startsWith(d.name || 'Direction')), 'direction tab ' + d.name);
    for (const lv of inputs.levels) {
      click(b => b.textContent.startsWith((lv.name || '(level)') + ' ('));
      const n = [...box.querySelectorAll('button')].filter(b => b.textContent === '▸').length;
      for (let i = 0; i < n; i++) {
        const b = [...box.querySelectorAll('button')].filter(x => x.textContent === '▸' || x.textContent === '▾')[i];
        if (b && b.textContent === '▸') b.dispatchEvent(new window.Event('click'));
      }
    }
  }
  assert.ok(click(b => /^Checks/.test(b.textContent)), 'Checks tab');
  assert.ok(click(b => b.textContent === 'Setup'), 'Setup tab');
  assert.ok(click(b => b.textContent === 'Calculate & Save'), 'Save button');
  assert.ok(saved, 'onSave called');
  return saved;
}

// ── the rule itself is followed ──
test('schema bookkeeping: DLRS_SCHEMA = last step; a frozen fixture exists for every older schema', () => {
  assert.equal(DLRS_MIGRATIONS[DLRS_MIGRATIONS.length - 1].to, DLRS_SCHEMA);
  assert.equal(diaphragmToLrs.schemaVersion, DLRS_SCHEMA);
  DLRS_MIGRATIONS.forEach((s, i) => assert.ok(i === 0 || s.to > DLRS_MIGRATIONS[i - 1].to, 'steps in order'));
  for (let v = 1; v < DLRS_SCHEMA; v++) assert.ok(fixtures.some(f => f.schemaVersion === v), 'fixture for schema ' + v + ' in tests/fixtures/legacy-dlrs/');
});

for (const fx of fixtures) {
  const stored = { schemaVersion: fx.schemaVersion, inputs: clone(fx.inputs) };
  const m = diaphragmToLrs.migrate(stored);

  test(fx.file + ' — migrates to schema ' + DLRS_SCHEMA + ' with no value lost', () => {
    assert.deepEqual(stored.inputs, fx.inputs, 'migrate must not change its argument');
    assert.equal(m.schemaVersion, DLRS_SCHEMA);
    assert.equal(m.inputs.schemaVersion, DLRS_SCHEMA);
    assert.deepEqual(lostValues(fx.inputs, m.inputs), []);
  });
  test(fx.file + ' — migration is idempotent', () => {
    assert.deepEqual(diaphragmToLrs.migrate(clone(m)), m);
    // the stamp inside the data wins over a wrong / missing DB column
    assert.deepEqual(diaphragmToLrs.migrate({ inputs: clone(m.inputs) }).inputs, m.inputs);
  });
  test(fx.file + ' — same reactions, line forces and story shears as when frozen (calc ' + fx.calcVersion + ')', () => {
    assert.deepEqual(resultNumbers(calcAll(m.inputs)), fx.numbers);
    assert.deepEqual(resultNumbers(calcAll(clone(fx.inputs))), fx.numbers, 'raw old inputs also calculate');
  });
  test(fx.file + ' — opens (every tab, level, editor), saves without loss, prints', () => {
    const saved = openAndSave(clone(m.inputs));
    assert.deepEqual(lostValues(m.inputs, saved), [], 'save keeps every value');
    assert.deepEqual(lostValues(fx.inputs, saved), [], 'save keeps every original value');
    assert.equal(saved.schemaVersion, DLRS_SCHEMA);
    for (const rep of ['summary', 'detailed']) {
      const secs = diaphragmToLrs.pdfSections({ ...m.inputs, pdfReport: rep }, null);
      const txt = JSON.stringify(secs.map(s => ({ ...s, elevation: undefined })));
      assert.ok(!/NaN|undefined/.test(txt), rep + ' PDF has no NaN / undefined');
    }
  });
  test(fx.file + ' — its stored v1 outputs still render (Results section)', () => {
    diaphragmToLrs.renderOutputs(document.createElement('div'), clone(fx.outputs));
    assert.ok(diaphragmToLrs.summaryLabel(m.inputs, fx.outputs).length > 0);
  });
}

test('unknown fields at every level survive migrate + open + save', () => {
  const fx = fixtures.find(f => f.file === 'schema1-unknown-fields.json');
  const saved = openAndSave(diaphragmToLrs.migrate({ schemaVersion: 1, inputs: clone(fx.inputs) }).inputs);
  const d = saved.directions[0];
  assert.deepEqual(saved.futureTop, { flag: true, list: ['x'] });
  assert.equal(saved.levels[0].futureLevel, 'kept');
  assert.equal(d.futureDir, 7); assert.equal(d.lines[0].colour, 'red'); assert.equal(d.groups[0].futureGroup, 'kept');
  assert.equal(d.diaphragms[0].comment, 'note on R.D1'); assert.equal(d.diaphragms[0].supports[0].futureSupport, 1.5);
  assert.equal(d.diaphragms[0].parts[0].material, 'plywood'); assert.equal(d.diaphragms[1].pointLoads[0].futureP, 'kept');
  assert.equal(Object.values(Object.values(d.down)[0])[0].futureDown, 'kept');
  // gaps of older data were filled, not left to crash
  assert.deepEqual(d.diaphragms[2].pointLoads, []); assert.equal(d.diaphragms[2].supports[1].atX, '');
});

test('data from a NEWER schema than this code is never downgraded or changed', () => {
  const inputs = { ...clone(fixtures[0].inputs), schemaVersion: 99, futureShape: { a: 1 } };
  const m = migrateItem({ schemaVersion: 99, inputs: clone(inputs) });
  assert.equal(m.inputs.schemaVersion, 99); assert.equal(m.schemaVersion, 99);
  assert.deepEqual(lostValues(inputs, m.inputs), []);
});

// A story-shear choice may outlive its line (the line was deleted later, e.g. Test-123): the calc ignores it and the
// data keeps it (never dropped). Every other reference must resolve.
test('references are stable ids (supports, merges, split targets point at ids that exist)', () => {
  for (const fx of fixtures) {
    for (const d of fx.inputs.directions) {
      const lineIds = new Set(d.lines.map(l => l.id)), dgIds = new Set(d.diaphragms.map(x => x.id)), lvIds = new Set(fx.inputs.levels.map(l => l.id));
      const groupKeys = new Set((d.groups || []).map(g => 'g:' + g.id));
      for (const g of d.diaphragms) {
        assert.ok(lvIds.has(g.levelId), fx.file + ' ' + g.mark + ' levelId');
        for (const s of g.supports) {
          if (s.kind === 'line' && s.lineId) assert.ok(lineIds.has(s.lineId), fx.file + ' support → line id');
          if (s.kind === 'diaphragm' && s.diaphragmId) assert.ok(dgIds.has(s.diaphragmId), fx.file + ' support → diaphragm id');
        }
      }
      for (const g of d.groups || []) for (const id of g.lineIds) assert.ok(lineIds.has(id), fx.file + ' merge → line id');
      for (const [lvId, map] of Object.entries(d.down || {})) {
        assert.ok(lvIds.has(lvId), fx.file + ' down level id');
        for (const [k, ch] of Object.entries(map)) {
          if (!lineIds.has(k) && !groupKeys.has(k)) continue; // left over from a deleted line — ignored, kept
          for (const sp of ch.split || []) assert.ok(!sp.to || lineIds.has(sp.to) || groupKeys.has(sp.to), fx.file + ' split target');
        }
      }
    }
  }
});

// ── Decision 2: merged lines ──
const t123 = fixtures.find(f => f.file === 'schema1-test123.json');
const withMerge = (groups) => {
  const inp = diaphragmToLrs.migrate({ schemaVersion: 1, inputs: clone(t123.inputs) }).inputs;
  const ew = inp.directions.find(d => d.name === 'E-W');
  const id = n => ew.lines.find(l => l.name === n).id;
  ew.groups = groups.map((names, i) => ({ id: 'grp-test-' + i, lineIds: names.map(id), levelIds: [] }));
  return calcAll(inp).perDirection.find(d => d.name === 'E-W');
};
const lineOf = (d, lvName, label) => d.perLevel.find(p => p.name === lvName).lines.find(u => u.label === label);

test('Test-123: merge 4+5 at all levels → R.4+R.5 F 6.3484; 2.4+2.5 F 3.9693, V 10.3177 (hand: sums of the separate lines)', () => {
  const d = withMerge([['4', '5']]);
  const r = lineOf(d, 'Roof', 'R.4+R.5'), s = lineOf(d, '2nd Floor', '2.4+2.5');
  assert.ok(r && s, 'merged lines present');
  // the tool adds the unrounded line forces, so the merged value may differ from the sum of 4-decimal values by 0.0001
  const near = (a, b, m) => assert.ok(Math.abs(a - b) <= 0.0005, m + ': ' + a + ' vs ' + b);
  near(r.F, 6.3484, 'R.4+R.5 F'); near(r.V, 6.3484, 'R.4+R.5 V'); assert.equal(r.merged, true);
  near(s.F, 3.9693, '2.4+2.5 F'); near(s.V, 10.3177, '2.4+2.5 V');
  // separate values frozen before the change: R.4 3.7028 + R.5 2.6456; 2.4 2.5735 + 2.5 1.3958
  near(t123.numbers['E-W/Roof R.4 F'] + t123.numbers['E-W/Roof R.5 F'], r.F, 'sum of the separate roof lines');
  near(t123.numbers['E-W/2nd Floor 2.4 V'] + t123.numbers['E-W/2nd Floor 2.5 V'], s.V, 'sum of the separate 2nd floor story shears');
  assert.equal(lineOf(d, 'Roof', 'R.2').F, t123.numbers['E-W/Roof R.2 F'], 'line 2 unchanged');
  assert.equal(lineOf(d, '2nd Floor', '2.2').V, t123.numbers['E-W/2nd Floor 2.2 V'], 'line 2 story shear unchanged');
  assert.ok(d.checks.every(c => c.status === 'pass'), 'all checks pass');
});

test('a merge with only one line is not a merge (no "merged" line, no check fails)', () => {
  const d = withMerge([['4']]);
  assert.ok(lineOf(d, 'Roof', 'R.4') && !lineOf(d, 'Roof', 'R.4').merged);
  assert.ok(d.checks.every(c => c.status === 'pass'));
});

test('D9: a line in two merges at the same level is flagged', () => {
  const d = withMerge([['4', '5'], ['2', '4']]);
  const d9 = d.checks.find(c => c.id === 'D9');
  assert.equal(d9.status, 'fail');
  assert.ok(/line R\.4 is in two merges/.test(d9.items.join(' ')), d9.items.join(' '));
});

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
