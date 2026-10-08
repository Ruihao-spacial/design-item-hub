// Upgrade every saved Diaphragm to LRS item to the current stored-data schema and regenerate its results
// (rules: docs/data-durability.md, steps: src/modules/diaphragmToLrsMigrate.js).
//
//   SB_EMAIL=you@spacial.io SB_PASSWORD=... node scripts/upgradeDlrsItems.mjs          (dry run — no writes)
//   SB_EMAIL=you@spacial.io SB_PASSWORD=... node scripts/upgradeDlrsItems.mjs --apply  (write upgraded items)
//
// Per item: schema from → to, the no-loss check (every stored value is still there after migration) and whether
// the reactions / line forces / story shears are unchanged. An item that loses a value or fails to calculate is
// reported and never written. With --apply the previous version goes into revisions, like a save.
// Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env (local by default).
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import './lib/shearWallLoadCheck.mjs'; // stand-in DOM for the module imports
import { diaphragmToLrs } from '../src/modules/diaphragmToLrs.js';
import { calcAll } from '../src/modules/diaphragmToLrsCalc.js';
import { storedSchema, lostValues, resultNumbers } from '../src/modules/diaphragmToLrsMigrate.js';

const MAX_REVISIONS = 10;
const apply = process.argv.includes('--apply');

const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/).filter(l => /^\s*[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const { SB_EMAIL, SB_PASSWORD } = process.env;
if (!SB_EMAIL || !SB_PASSWORD) { console.error('Set SB_EMAIL and SB_PASSWORD'); process.exit(1); }

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const { error: authErr } = await sb.auth.signInWithPassword({ email: SB_EMAIL, password: SB_PASSWORD });
if (authErr) { console.error('Sign-in failed:', authErr.message); process.exit(1); }

const { data: rows, error } = await sb.from('items').select('*').eq('type', diaphragmToLrs.id);
if (error) { console.error(error.message); process.exit(1); }
console.log((apply ? 'APPLY' : 'DRY RUN') + ' — ' + rows.length + ' Diaphragm to LRS item(s) at ' + env.VITE_SUPABASE_URL);
console.log('Target: schema ' + diaphragmToLrs.schemaVersion + ', calc ' + diaphragmToLrs.calcVersion + '\n');

const same = (a, b) => Object.keys({ ...a, ...b }).every(k => a[k] === b[k]);
let failed = 0, written = 0, current = 0;
for (const row of rows) {
  const head = row.id.slice(0, 8) + '  ' + row.project_number + '  "' + (row.custom_name || row.label || '') + '"';
  const from = storedSchema(row.inputs, row.schema_version);
  let m, out, lost, before;
  try {
    m = diaphragmToLrs.migrate({ schemaVersion: row.schema_version, inputs: row.inputs });
    lost = lostValues(row.inputs, m.inputs);
    out = calcAll(m.inputs);
    before = resultNumbers(calcAll(JSON.parse(JSON.stringify(row.inputs))));
  } catch (e) { failed++; console.log('FAIL  ' + head + '\n      ' + e.message); continue; }
  const numbersSame = same(before, resultNumbers(out));
  const upToDate = row.schema_version === diaphragmToLrs.schemaVersion && row.calc_version === diaphragmToLrs.calcVersion && from === diaphragmToLrs.schemaVersion;
  console.log((lost.length ? 'LOSS  ' : upToDate ? 'OK    ' : 'UPGR  ') + head
    + '\n      schema ' + from + '→' + m.schemaVersion + ', calc ' + (row.calc_version ?? '?') + '→' + diaphragmToLrs.calcVersion
    + ' | ' + (lost.length ? lost.length + ' value(s) LOST: ' + lost.slice(0, 3).join('; ') : 'no value lost')
    + ' | results ' + (numbersSame ? 'unchanged' : 'CHANGED (see the calc version notes)') + ' | checks ' + out.status);
  if (lost.length) { failed++; continue; }
  if (upToDate) { current++; continue; }
  if (!apply) continue;
  const revisions = Array.isArray(row.revisions) ? [...row.revisions] : [];
  revisions.push({ inputs: row.inputs, outputs: row.outputs, updatedAt: row.updated_at, updatedBy: 'upgrade:dlrs' });
  while (revisions.length > MAX_REVISIONS) revisions.shift();
  const { error: upErr } = await sb.from('items').update({
    inputs: m.inputs, outputs: out, refs: m.inputs.refs || {},
    schema_version: m.schemaVersion, calc_version: diaphragmToLrs.calcVersion, revisions,
  }).eq('id', row.id);
  if (upErr) { failed++; console.log('      write failed: ' + upErr.message); } else written++;
}
console.log('\n' + (apply ? written + ' written' : (rows.length - current - failed) + ' would be upgraded') + ', ' + current + ' up to date, ' + failed + ' failed / not written');
process.exit(failed ? 1 : 0);
