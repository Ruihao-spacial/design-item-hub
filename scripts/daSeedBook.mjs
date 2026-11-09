// Put the book examples (tests/td-book/Ex*.json) into the project "DA-BOOK", one Transfer Diaphragm item per
// example, named "Ex4.1 — title". Each item carries the book values in inputs.verification (Verification tab).
//
//   SB_EMAIL=you@spacial.io SB_PASSWORD=... node scripts/daSeedBook.mjs          (dry run — no writes)
//   SB_EMAIL=you@spacial.io SB_PASSWORD=... node scripts/daSeedBook.mjs --apply  (create / refresh the items)
//
// Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env (local by default). An existing example item is
// overwritten with the book layout (its previous version goes into revisions, like a save).
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { parseHTML } from 'linkedom';

if (!globalThis.document) { // stand-in DOM for the module import
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window, document, Node: window.Node });
}
const { diaphragmAnalysis } = await import('../src/modules/diaphragmAnalysis.js');
const { bookToInputs } = await import('../tests/td-book/src/toInputs.mjs');

const PROJECT = { number: 'DA-BOOK', display: 'DA-BOOK', name: 'Transfer Diaphragm — book examples' };
const MAX_REVISIONS = 10;
const apply = process.argv.includes('--apply');

const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/).filter(l => /^\s*[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const { SB_EMAIL, SB_PASSWORD } = process.env;
if (!SB_EMAIL || !SB_PASSWORD) { console.error('Set SB_EMAIL and SB_PASSWORD'); process.exit(1); }

const dir = new URL('../tests/td-book/', import.meta.url);
const books = fs.readdirSync(dir).filter(f => /^Ex\d+\.\d+\.json$/.test(f))
  .map(f => JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8')))
  .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: SB_EMAIL, password: SB_PASSWORD });
if (authErr) { console.error('Sign-in failed:', authErr.message); process.exit(1); }
const userId = auth.user.id;
console.log((apply ? 'APPLY' : 'DRY RUN') + ' — ' + books.length + ' example(s) → project ' + PROJECT.number + ' "' + PROJECT.name + '" at ' + env.VITE_SUPABASE_URL + '\n');

const { data: proj, error: pErr } = await sb.from('projects').select('project_number').eq('project_number', PROJECT.number).maybeSingle();
if (pErr) { console.error(pErr.message); process.exit(1); }
if (!proj) {
  console.log('NEW   project ' + PROJECT.number);
  if (apply) {
    const { error } = await sb.from('projects').insert({ project_number: PROJECT.number, display_number: PROJECT.display, name: PROJECT.name, status: 'active', created_by: userId,
      notes: 'EX-IRREG-2E book examples (npm run da:seed). Each item has a Verification tab: book values vs the tool.' });
    if (error) { console.error(error.message); process.exit(1); }
  }
}
const { data: rows, error: iErr } = proj ? await sb.from('items').select('*').eq('project_number', PROJECT.number).eq('type', diaphragmAnalysis.id) : { data: [], error: null };
if (iErr) { console.error(iErr.message); process.exit(1); }

let written = 0, failed = 0;
for (const b of books) {
  const name = b.id + ' — ' + b.title;
  const inputs = diaphragmAnalysis.migrate({ schemaVersion: diaphragmAnalysis.schemaVersion, inputs: bookToInputs(b) }).inputs;
  inputs.notes = 'Book example ' + b.id + ' (' + b.pdf + ', pp ' + b.pages + '). See the Verification tab.';
  let outputs;
  try { outputs = diaphragmAnalysis.calc(inputs); } catch (e) { failed++; console.log('FAIL  ' + name + ' — ' + e.message); continue; }
  if (outputs.status !== 'ok') { failed++; console.log('FAIL  ' + name + ' — plan issues: ' + outputs.errors.map(e => e.msg).join('; ')); continue; }
  const row = (rows || []).find(r => (r.custom_name || '').startsWith(b.id + ' '));
  console.log((row ? 'UPDT  ' : 'NEW   ') + name);
  if (!apply) continue;
  const fields = { label: name, custom_name: name, inputs, outputs, refs: inputs.refs || {}, schema_version: diaphragmAnalysis.schemaVersion, calc_version: diaphragmAnalysis.calcVersion, archived: false };
  let error;
  if (row) {
    const revisions = Array.isArray(row.revisions) ? [...row.revisions] : [];
    revisions.push({ inputs: row.inputs, outputs: row.outputs, updatedAt: row.updated_at, updatedBy: 'da:seed' });
    while (revisions.length > MAX_REVISIONS) revisions.shift();
    ({ error } = await sb.from('items').update({ ...fields, revisions }).eq('id', row.id));
  } else {
    ({ error } = await sb.from('items').insert({ ...fields, project_number: PROJECT.number, type: diaphragmAnalysis.id, entered_by: userId, revisions: [] }));
  }
  if (error) { failed++; console.log('      write failed: ' + error.message); } else written++;
}
console.log('\n' + (apply ? written + ' written' : books.length - failed + ' would be written') + ', ' + failed + ' failed');
process.exit(failed ? 1 : 0);
