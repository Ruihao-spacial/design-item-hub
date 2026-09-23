// Upgrade every saved Shear Wall Design item to the current definition schema and regenerate its results.
//
//   SB_EMAIL=you@spacial.io SB_PASSWORD=... node scripts/upgradeShearWallItems.mjs          (dry run — no writes)
//   SB_EMAIL=you@spacial.io SB_PASSWORD=... node scripts/upgradeShearWallItems.mjs --apply  (write upgraded items)
//
// Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env (local by default; point .env at the cloud project
// to upgrade there). With --apply, each upgraded item gets its previous version pushed into revisions, like a save.
// Items that fail the open check are reported and never written.
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { checkShearWallItem } from './lib/shearWallLoadCheck.mjs';
import { shearWallDesign } from '../src/modules/shearWallDesign.js';

const MAX_REVISIONS = 10;
const apply = process.argv.includes('--apply');

const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/).filter(l => /^\s*[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const { SB_EMAIL, SB_PASSWORD } = process.env;
if (!SB_EMAIL || !SB_PASSWORD) { console.error('Set SB_EMAIL and SB_PASSWORD'); process.exit(1); }

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const { error: authErr } = await sb.auth.signInWithPassword({ email: SB_EMAIL, password: SB_PASSWORD });
if (authErr) { console.error('Sign-in failed:', authErr.message); process.exit(1); }

const { data: rows, error } = await sb.from('items')
  .select('*, entered_by_profile:profiles!items_entered_by_fkey(full_name)')
  .eq('type', shearWallDesign.id);
if (error) { console.error(error.message); process.exit(1); }

console.log((apply ? 'APPLY' : 'DRY RUN') + ' — ' + rows.length + ' Shear Wall Design item(s) at ' + env.VITE_SUPABASE_URL);
console.log('Target: schema ' + shearWallDesign.schemaVersion + ', calc ' + shearWallDesign.calcVersion + '\n');

let failed = 0, written = 0, current = 0;
for (const row of rows) {
  const r = checkShearWallItem({ schemaVersion: row.schema_version, inputs: row.inputs });
  const name = row.custom_name || row.label || '';
  const upToDate = row.schema_version === shearWallDesign.schemaVersion && row.calc_version === shearWallDesign.calcVersion;
  const head = row.id.slice(0, 8) + '  ' + row.project_number + '  "' + name + '"' + (row.archived ? ' (archived)' : '');
  if (!r.ok) {
    failed++;
    console.log('FAIL  ' + head + '\n      ' + r.error);
    continue;
  }
  const s = r.stats;
  console.log((upToDate ? 'OK    ' : 'UPGR  ') + head
    + '\n      schema ' + (row.schema_version ?? '?') + '→' + shearWallDesign.schemaVersion
    + ', calc ' + (row.calc_version ?? '?') + '→' + shearWallDesign.calcVersion
    + ' | ' + s.lines + ' lines, ' + s.walls + ' walls, ' + s.beams + ' beams, ' + s.posts + ' posts | ' + r.warnings + ' load path warning(s)');
  if (upToDate) { current++; continue; }
  if (!apply) continue;

  const revisions = Array.isArray(row.revisions) ? [...row.revisions] : [];
  revisions.push({ inputs: row.inputs, outputs: row.outputs, updatedAt: row.updated_at, updatedBy: row.entered_by_profile?.full_name || '—' });
  while (revisions.length > MAX_REVISIONS) revisions.shift();
  const inputs = r.migrated.inputs;
  const { error: upErr } = await sb.from('items').update({
    inputs, outputs: r.outputs, refs: inputs.refs || {},
    label: row.custom_name || shearWallDesign.summaryLabel(inputs, r.outputs),
    schema_version: shearWallDesign.schemaVersion, calc_version: shearWallDesign.calcVersion,
    revisions,
  }).eq('id', row.id);
  if (upErr) { failed++; console.log('      write failed: ' + upErr.message); } else { written++; console.log('      written'); }
}

console.log('\n' + current + ' already current, ' + (apply ? written + ' upgraded' : (rows.length - current - failed) + ' would be upgraded') + ', ' + failed + ' failed');
process.exit(failed ? 1 : 0);
