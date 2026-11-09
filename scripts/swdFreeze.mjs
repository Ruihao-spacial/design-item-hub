// SWD freeze — fingerprints of Shear Wall Design items (results, form, results page, PDF, every elevation).
//   node scripts/swdFreeze.mjs --write              fixtures → tests/swd-freeze/baseline.json (only before an SWD change)
//   node scripts/swdFreeze.mjs --check              fixtures vs the baseline (also run by npm test)
//   node scripts/swdFreeze.mjs --db --write <file>  every SWD item in the local Supabase DB (read only) → <file>
//   node scripts/swdFreeze.mjs --db --check <file>  the local DB items vs <file>
// Local DB snapshots hold project data: keep them outside the repo (e.g. the session scratchpad or supabase/backups/).
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { fingerprint, compare } from './lib/swdFreeze.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(root, 'tests', 'swd-freeze', 'baseline.json');

// Every SWD definition kept in the repo: fixtures, legacy fixtures (one per schema), method cases, rule models
export async function fixtureItems() {
  const items = {};
  const add = (name, schemaVersion, inputs) => { if (inputs && Array.isArray(inputs.directions)) items[name] = { schemaVersion, inputs }; };
  const readDir = (dir, tag) => {
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      add(tag + '/' + f, j.schemaVersion ?? (j.inputs ? undefined : 1), j.inputs || j);
    }
  };
  readDir(path.join(root, 'tests', 'fixtures'), 'fixtures');
  readDir(path.join(root, 'tests', 'fixtures', 'legacy'), 'legacy');
  readDir(path.join(root, 'tests', 'cases'), 'cases');
  const ruleDir = path.join(root, 'tests', 'rules', 'models');
  for (const f of fs.readdirSync(ruleDir).filter(f => f.endsWith('.mjs')).sort()) {
    const m = (await import('file:///' + path.join(ruleDir, f).replace(/\\/g, '/'))).default;
    add('rules/' + f, m.schemaVersion ?? 10, m.inputs);
  }
  return items;
}

function dbItems() {
  const sql = "select coalesce(json_agg(json_build_object('id', id, 'project', project_number, 'name', coalesce(custom_name, label), 'schemaVersion', schema_version, 'inputs', inputs) order by project_number, id), '[]') from items where type = 'shear_wall_design' and not archived";
  const out = execFileSync('docker', ['exec', 'supabase_db_engineer-service-calculator', 'psql', '-U', 'postgres', '-At', '-c', sql], { maxBuffer: 1 << 30 }).toString();
  const items = {};
  for (const r of JSON.parse(out)) items[r.project + ' · ' + r.name + ' · ' + r.id.slice(0, 8)] = { schemaVersion: r.schemaVersion, inputs: r.inputs };
  return items;
}

const prints = items => Object.fromEntries(Object.entries(items).map(([k, it]) => [k, fingerprint(it)]));

async function main() {
  const args = process.argv.slice(2);
  const db = args.includes('--db');
  const mode = args.includes('--write') ? 'write' : args.includes('--check') ? 'check' : null;
  const file = db ? args.find(a => !a.startsWith('--')) : BASELINE;
  if (!mode || !file) { console.log('usage: --write | --check  (fixtures)   or   --db --write <file> | --db --check <file>'); process.exit(2); }
  const items = db ? dbItems() : await fixtureItems();
  const now = prints(items);
  const errors = Object.entries(now).filter(([, v]) => v.error);
  if (mode === 'write') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(now, null, 1) + '\n');
    console.log(`wrote ${file}: ${Object.keys(now).length} items` + (errors.length ? `, ${errors.length} that do not open (stored as such)` : ''));
    return;
  }
  const before = JSON.parse(fs.readFileSync(file, 'utf8'));
  const diffs = compare(before, now);
  if (!diffs.length) { console.log(`SWD freeze: ${Object.keys(now).length} items identical (results, form, results page, PDF, every elevation)`); return; }
  for (const d of diffs) console.log(`CHANGED  ${d.item} — ${d.part}: ${d.was} → ${d.now}`);
  console.log(`SWD freeze: ${diffs.length} difference(s) in ${new Set(diffs.map(d => d.item)).size} item(s)`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
