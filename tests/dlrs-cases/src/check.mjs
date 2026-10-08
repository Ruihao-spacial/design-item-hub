// Print every expected vs calculated value of the Diaphragm to LRS cases. Run: npm run dlrs:cases:check [D01]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calcAll } from '../../../src/modules/diaphragmToLrsCalc.js';
import { evaluateCase } from '../../../src/modules/diaphragmToLrsVerify.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv.slice(2);
let bad = 0;
for (const f of fs.readdirSync(dir).filter(f => /^[DB]\d\d\w*-.*\.json$/.test(f)).sort()) {
  const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (only.length && !only.includes(c.id)) continue;
  const ev = evaluateCase(c, calcAll(c.inputs));
  console.log((ev.pass ? 'PASS ' : 'FAIL ') + c.id + ' — ' + c.title);
  for (const r of ev.values) console.log('   ' + (r.pass ? 'ok ' : 'NG ') + r.label + ': expected ' + r.value + ', calculated ' + (r.error || r.actual));
  for (const r of ev.checks.filter(x => !x.pass)) console.log('   NG check ' + r.dir + ' ' + r.id + ': ' + r.status + ' (expected ' + r.expected + ') ' + r.items.join('; '));
  if (!ev.pass) bad++;
}
if (bad) process.exitCode = 1;
