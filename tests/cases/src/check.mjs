// Evaluate built cases against the engine and print every row: node tests/cases/src/check.mjs V05 [V06 …]
// (no ids = all cases). Prints OK / NG per expected value, failing checks and required warnings.
import fs from 'fs';
import '../../../scripts/lib/shearWallLoadCheck.mjs';
import { calcAll } from '../../../src/modules/shearWallCalc.js';
import { shearWallDesign } from '../../../src/modules/shearWallDesign.js';
import { evaluateCase, fmtValue } from '../../../src/modules/shearWallVerify.js';

const outDir = new URL('../', import.meta.url);
const only = process.argv.slice(2);
let bad = 0;
for (const f of fs.readdirSync(outDir).filter(x => /^V\d\d-.*\.json$/.test(x)).sort()) {
  if (only.length && !only.includes(f.slice(0, 3))) continue;
  const c = JSON.parse(fs.readFileSync(new URL(f, outDir), 'utf8'));
  const inp = shearWallDesign.migrate({ schemaVersion: c.schemaVersion, inputs: c.inputs }).inputs;
  const r = evaluateCase(c, calcAll(inp));
  console.log('\n' + c.id + ' ' + c.title + ' — ' + (r.pass ? 'PASS' : 'FAIL'));
  for (const v of r.values) console.log('  ' + (v.pass ? 'ok' : 'NG') + '  [' + v.step + '] ' + v.label + ': expected ' + fmtValue(v.value) + ', engine ' + fmtValue(v.actual) + (v.error ? ' (' + v.error + ')' : ''));
  for (const x of r.checks.filter(x => !x.pass)) console.log('  NG  check ' + x.line + ' ' + x.id + ' ' + x.status + ' (expected ' + x.expected + ')');
  for (const w of r.warnings.filter(x => !x.pass)) console.log('  NG  warning ' + w.type + ' missing');
  if (!r.pass) bad++;
}
if (bad) process.exitCode = 1;
