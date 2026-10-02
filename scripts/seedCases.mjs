// Put the verification cases (tests/cases/Vxx-*.json) into the project "SW Verification" as Shear Wall Design
// items, one per case, named "Vxx — title". Each item carries its case in inputs.verification, which shows the
// Verification tab (expected vs calculated) in the app.
//
//   SB_EMAIL=you@spacial.io SB_PASSWORD=... node scripts/seedCases.mjs          (dry run — no writes)
//   SB_EMAIL=you@spacial.io SB_PASSWORD=... node scripts/seedCases.mjs --apply  (create / refresh the items)
//
// Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env (local by default). An existing case item is
// overwritten with the case definition (its previous version goes into revisions, like a save).
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import './lib/shearWallLoadCheck.mjs'; // stand-in DOM for the module imports
import { shearWallDesign } from '../src/modules/shearWallDesign.js';

const PROJECT = { number: 'SW-VERIFY', display: 'SW-VERIFY', name: 'SW Verification' };
const MAX_REVISIONS = 10;
const apply = process.argv.includes('--apply');

const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/).filter(l => /^\s*[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const { SB_EMAIL, SB_PASSWORD } = process.env;
if (!SB_EMAIL || !SB_PASSWORD) { console.error('Set SB_EMAIL and SB_PASSWORD'); process.exit(1); }

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: SB_EMAIL, password: SB_PASSWORD });
if (authErr) { console.error('Sign-in failed:', authErr.message); process.exit(1); }
const userId = auth.user.id;

const casesDir = new URL('../tests/cases/', import.meta.url);
const cases = fs.readdirSync(casesDir).filter(f => /^V\d\d-.*\.json$/.test(f)).sort()
  .map(f => JSON.parse(fs.readFileSync(new URL(f, casesDir), 'utf8')));
console.log((apply ? 'APPLY' : 'DRY RUN') + ' — ' + cases.length + ' case(s) → project ' + PROJECT.number + ' "' + PROJECT.name + '" at ' + env.VITE_SUPABASE_URL + '\n');

const { data: proj, error: pErr } = await sb.from('projects').select('project_number').eq('project_number', PROJECT.number).maybeSingle();
if (pErr) { console.error(pErr.message); process.exit(1); }
if (!proj) {
  console.log('NEW   project ' + PROJECT.number);
  if (apply) {
    const { error } = await sb.from('projects').insert({ project_number: PROJECT.number, display_number: PROJECT.display, name: PROJECT.name, status: 'active', created_by: userId,
      notes: 'Shear wall verification cases V01–V22 (npm run seed:cases). Each item has a Verification tab: hand calc vs the tool.' });
    if (error) { console.error(error.message); process.exit(1); }
  }
}
const { data: rows, error: iErr } = proj ? await sb.from('items').select('*').eq('project_number', PROJECT.number).eq('type', shearWallDesign.id) : { data: [], error: null };
if (iErr) { console.error(iErr.message); process.exit(1); }

let written = 0, failed = 0;
for (const c of cases) {
  const name = c.id + ' — ' + c.title;
  const { inputs: caseInputs, schemaVersion, ...verification } = c;
  const migrated = shearWallDesign.migrate({ schemaVersion, inputs: JSON.parse(JSON.stringify(caseInputs)) });
  const inputs = { ...migrated.inputs, verification, notes: (c.intent || '') + '\n\nSee the Verification tab for the hand calc and expected values.' };
  let outputs;
  try { outputs = shearWallDesign.calc(inputs); } catch (e) { failed++; console.log('FAIL  ' + name + ' — ' + e.message); continue; }
  const row = (rows || []).find(r => (r.custom_name || '').startsWith(c.id + ' '));
  console.log((row ? 'UPDT  ' : 'NEW   ') + name);
  if (!apply) continue;
  const fields = { label: name, custom_name: name, inputs, outputs, refs: inputs.refs || {}, schema_version: shearWallDesign.schemaVersion, calc_version: shearWallDesign.calcVersion, archived: false };
  let error;
  if (row) {
    const revisions = Array.isArray(row.revisions) ? [...row.revisions] : [];
    revisions.push({ inputs: row.inputs, outputs: row.outputs, updatedAt: row.updated_at, updatedBy: 'seed:cases' });
    while (revisions.length > MAX_REVISIONS) revisions.shift();
    ({ error } = await sb.from('items').update({ ...fields, revisions }).eq('id', row.id));
  } else {
    ({ error } = await sb.from('items').insert({ ...fields, project_number: PROJECT.number, type: shearWallDesign.id, entered_by: userId, revisions: [] }));
  }
  if (error) { failed++; console.log('      write failed: ' + error.message); } else written++;
}
console.log('\n' + (apply ? written + ' written' : cases.length - failed + ' would be written') + ', ' + failed + ' failed');
process.exit(failed ? 1 : 0);
