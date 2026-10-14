// Builds src/modules/shearWallHardwareData.js from the Shear Wall hardware reference tables
// (Shared Drive: Design Item Hub/Shearwall design reference): HDUE holdowns, MSTC floor straps, SDPWS nailing,
// FTAO wall straps, NDS wood grades. The .md files are the source; the engineer enters every value there.
// Run: node scripts/buildHardwareData.mjs ["<Shearwall design reference folder>"]   (npm run hardware:build)
//      --check  compares with the committed data file instead of writing it (exit 1 when they differ)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIR = 'G:/Shared drives/Structural Engineering Standards/ENG CALC TOOLDEV/Calculation Library/Design Software/Design Item Hub/Shearwall design reference';
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const dir = args.find(a => !a.startsWith('--')) || DEFAULT_DIR;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'modules', 'shearWallHardwareData.js');
if (!fs.existsSync(dir)) {
  console.error('Reference folder not found: ' + dir + '\nUsage: node scripts/buildHardwareData.mjs "<Shearwall design reference folder>" [--check]');
  process.exit(1);
}

const FILES = {
  hdue: 'Floor_Anchorage_Holdown_Catalog.md',
  mstc: 'Floor_to_Floor_Strap_Catalog.md',
  nailing: 'Shearwall_nailing_and_capacity_table.md',
  ftao: 'FTAO/D2_FTAO_wall_strap_catalog.md',
  wood: 'Wood_grades_NDS_2018.md',
};

// Every markdown table in a file: { h2, h3 (last headings above it), headers, rows }
function tables(file) {
  const lines = fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/);
  const out = [];
  let h2 = '', h3 = '';
  const cellsOf = (l) => l.trim().split('|').slice(1, -1).map(c => c.trim());
  for (let i = 0; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { h2 = lines[i].slice(3).trim(); h3 = ''; }
    if (/^### /.test(lines[i])) h3 = lines[i].slice(4).trim();
    if (!lines[i].trim().startsWith('|') || !lines[i + 1] || !/^\|[-| :]+\|$/.test(lines[i + 1].trim())) continue;
    const headers = cellsOf(lines[i]);
    const rows = [];
    for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) rows.push(cellsOf(lines[i]));
    out.push({ h2, h3, headers, rows });
  }
  return out;
}

// '9,215' → 9215, '52½' → 52.5, '' / '—' → null, text stays text
function num(c) {
  const t = String(c ?? '').replace(/\*\*/g, '').replace(/,/g, '').replace('½', '.5').trim();
  if (t === '' || t === '—' || t === '-') return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  throw new Error('not a number: "' + c + '"');
}
const text = (c) => String(c ?? '').replace(/\*\*/g, '').trim() || null;
// column index by header text (case-insensitive substring); throws when missing
function col(t, ...names) {
  const i = t.headers.findIndex(h => names.some(n => h.toLowerCase().includes(n.toLowerCase())));
  if (i < 0) throw new Error('column "' + names[0] + '" not found in [' + t.headers.join(' | ') + '] (' + t.h2 + ' ' + t.h3 + ')');
  return i;
}
// The "## Source" Field | Value table of a file
function source(key) {
  const t = tables(FILES[key]).find(x => x.h2 === 'Source');
  if (!t) throw new Error(FILES[key] + ': no ## Source table');
  const f = (name) => text((t.rows.find(r => r[0].toLowerCase().startsWith(name)) || [])[1]) || '';
  return { doc: f('document'), edition: f('edition'), page: f('page'), entered: f('entered'), file: FILES[key] };
}
const groupOf = (h) => (/^DF\/SP/.test(h) ? 'dfsp' : /^SPF\/HF/.test(h) ? 'spfhf' : null);

function need(cond, msg) { if (!cond) throw new Error(msg); }

// --- HDUE: one table per species group and wall width ---
const hdue = { dfsp: {}, spfhf: {} };
for (const t of tables(FILES.hdue)) {
  const g = groupOf(t.h2);
  const w = (t.h2.match(/(\d)" wall/) || [])[1];
  if (!g || !w) continue;
  const [iM, iA, iL, iD, iP, iDa] = [col(t, 'HD'), col(t, 'ASD cap'), col(t, 'LRFD cap'), col(t, 'δ @ LRFD'), col(t, 'Min post'), col(t, 'δ @ ASD')];
  hdue[g][w] = t.rows.map(r => ({ id: text(r[iM]), cap: num(r[iA]), lrfdCap: num(r[iL]), deltaLrfd: num(r[iD]), minPost: text(r[iP]), deltaAsd: num(r[iDa]) }));
}

// --- MSTC: per species group, per floor clear span ---
const mstc = { dfsp: {}, spfhf: {} };
for (const t of tables(FILES.mstc)) {
  const g = groupOf(t.h2);
  const span = (t.h3.match(/^(\d+)" Clear Span/) || [])[1];
  if (!g || !span) continue;
  const [iM, iA, iL, iD, i4, i6] = [col(t, 'Strap'), col(t, 'ASD cap'), col(t, 'LRFD cap'), col(t, 'δ @ LRFD'), col(t, 'Min post 4'), col(t, 'Min post 6')];
  mstc[g][span] = t.rows.map(r => ({ id: text(r[iM]), cap: num(r[iA]), lrfdCap: num(r[iL]), deltaLrfd: num(r[iD]), minPost: { '4': text(r[i4]), '6': text(r[i6]) } }));
}

// --- Nailing: DF/SP and SPF/HF capacity tables (SPF/HF V_n already × C_G) ---
const nailing = {};
for (const t of tables(FILES.nailing)) {
  const g = groupOf(t.h2);
  if (!g || !/Capacity Table/.test(t.h2)) continue;
  const c = { id: col(t, 'E.N.'), vn: col(t, 'V_n'), asdE: col(t, 'v_allow,E'), asdW: col(t, 'v_allow,W'), lrfdE: col(t, 'V_n,E'), lrfdW: col(t, 'V_n,W'), gaOSB: col(t, 'Ga OSB'), gaPLY: col(t, 'Ga PLY') };
  nailing[g] = t.rows.map(r => {
    const id = text(r[c.id]);
    const both = /B$/.test(id);
    const row = { id, label: id.replace(/B$/, '') + '" o.c.' + (both ? ' (both)' : ''), sides: both ? 2 : 1 };
    for (const k of ['vn', 'asdE', 'asdW', 'lrfdE', 'lrfdW', 'gaOSB', 'gaPLY']) row[k] = num(r[c[k]]);
    return row;
  });
}
// C_G of each group = its V_n / the DF/SP V_n (the SPF/HF table is entered as v_n × C_G)
const cg = { dfsp: 1 };
if (nailing.spfhf) cg.spfhf = Math.round(nailing.spfhf[0].vn / nailing.dfsp[0].vn * 100) / 100;

// --- FTAO wall straps: one row per strap model and nail; DF/SP and SPF/HF fasteners ---
const ftaoT = tables(FILES.ftao).find(t => t.headers.some(h => /Model/.test(h)));
const fast = (c) => { const m = String(c).match(/^\((\d+)\)\s*(.+)$/); if (!m) throw new Error('fasteners: ' + c); return { n: Number(m[1]), d: m[2].trim() }; };
const ftao = [];
{
  const t = ftaoT;
  const [iM, iL, iG, iFd, iEd, iFs, iEs, iC] = [col(t, 'Model'), col(t, 'Total L'), col(t, 'Ga.'), col(t, 'Fasteners (Total) (in.) [DF/SP]'), col(t, 'End Length (in.) [DF/SP]'),
    col(t, 'Fasteners (Total) (in.) [SPF/HF]'), col(t, 'End Length (in.) [SPF/HF]'), col(t, 'Allowable Tension')];
  for (const r of t.rows) {
    const id = text(r[iM]);
    let s = ftao.find(x => x.id === id);
    if (!s) { s = { id, gauge: num(r[iG]), lengthFt: num(r[iL]), cap: num(r[iC]), nails: [] }; ftao.push(s); }
    const fd = fast(r[iFd]), fs = fast(r[iFs]);
    s.nails.push({ d: fd.d, dfsp: [fd.n, num(r[iEd])], spfhf: [fs.n, num(r[iEs])] });
  }
  ftao.sort((a, b) => a.cap - b.cap);
}

// --- Wood grades: NDS 4A / 4B (by width) / 4D, per species ---
const SPECIES = { 'DF-L': { prefix: 'dfir', group: 'dfsp' }, SP: { prefix: 'sp', group: 'dfsp' }, SPF: { prefix: 'spf', group: 'spfhf' }, HF: { prefix: 'hf', group: 'spfhf' } };
const slug = (g) => g.toLowerCase().replace(/non-dense/g, 'nd').replace(/dense/g, 'd').replace(/select structural/g, 'ss')
  .replace(/ and | & /g, '').replace(/[^a-z0-9]/g, '');
const wood = [];
for (const t of tables(FILES.wood)) {
  const m = t.h3.match(/^(DF-L|SP|SPF|HF) — Table (4A|4B|4D)/);
  if (!m) continue;
  const [, species, table] = m;
  const width = table === '4B' ? (/2"–4" wide/.test(t.h3) ? '2-4' : /5"–6" wide/.test(t.h3) ? '5-6' : null) : null;
  if (table === '4B' && !width) throw new Error('Table 4B heading without a width class: ' + t.h3);
  const c = { grade: col(t, 'Grade'), Fc: col(t, 'F_c (psi)'), Fcperp: col(t, 'F_c⊥'), E: col(t, 'E (psi)'), Emin: col(t, 'E_min'), G: t.headers.indexOf('G') };
  need(c.G >= 0, 'no G column: ' + t.h3);
  for (const r of t.rows) {
    const name = text(r[c.grade]);
    const pt = table === '4D';
    const id = SPECIES[species].prefix + (pt ? '_pt_' : '_') + slug(name);
    const vals = { Fc: num(r[c.Fc]), Fcperp: num(r[c.Fcperp]), E: num(r[c.E]), Emin: num(r[c.Emin]), G: num(r[c.G]) };
    let g = wood.find(x => x.id === id);
    if (!g) {
      g = { id, species, group: SPECIES[species].group, table, kind: pt ? 'pt' : 'dim', grade: name, label: species + ' ' + name + (pt ? ' (P&T)' : '') };
      wood.push(g);
    }
    if (width) (g.widths = g.widths || {})[width] = vals; else Object.assign(g, vals);
  }
}

// --- sanity checks: a broken table fails the build, never a silent gap ---
for (const g of ['dfsp', 'spfhf']) {
  for (const w of ['4', '6']) need(hdue[g][w] && hdue[g][w].length === 6, 'HDUE ' + g + ' ' + w + '": 6 rows expected');
  for (const s of ['16', '18', '24']) need(mstc[g][s] && mstc[g][s].length === 4, 'MSTC ' + g + ' ' + s + '": 4 rows expected');
  need(nailing[g] && nailing[g].length === 7, 'nailing ' + g + ': 7 rows expected');
}
for (const g of Object.values(hdue)) for (const rows of Object.values(g)) for (const r of rows)
  need(r.cap > 0 && r.lrfdCap > r.cap && r.deltaLrfd > 0 && r.minPost, 'HDUE row incomplete: ' + JSON.stringify(r));
for (const g of Object.values(mstc)) for (const rows of Object.values(g)) for (const r of rows)
  need(r.cap > 0 && r.lrfdCap > r.cap && r.deltaLrfd > 0 && r.minPost['4'] && r.minPost['6'], 'MSTC row incomplete: ' + JSON.stringify(r));
for (const g of wood) for (const v of g.widths ? Object.values(g.widths) : [g])
  need(v.Fc > 0 && v.Fcperp > 0 && v.E > 0 && v.Emin > 0 && v.G > 0, 'wood grade incomplete: ' + g.id);
need(new Set(wood.map(g => g.id)).size === wood.length, 'duplicate wood grade id');
need(ftao.length === 8, 'FTAO straps: 8 models expected');

const sources = Object.fromEntries(Object.keys(FILES).map(k => [k, source(k)]));
const json = (v) => JSON.stringify(v);
const block = (obj) => '{\n' + Object.entries(obj).map(([k, v]) => '  ' + json(k) + ': ' + json(v)).join(',\n') + ',\n}';
const list = (rows) => '[\n' + rows.map(r => '  ' + json(r)).join(',\n') + ',\n]';
const out = `// GENERATED by scripts/buildHardwareData.mjs from the hardware reference tables
// (Shared Drive: Design Item Hub/Shearwall design reference: ${Object.values(FILES).join(', ')}).
// Do not edit by hand; update the .md tables and run \`npm run hardware:build\`.
// Units: lb, in, psi, plf, kips/in. Groups: dfsp = DF/SP framing, spfhf = SPF/HF framing.

// Where each table comes from (the "## Source" table of each file)
export const HW_SOURCES = ${block(sources)};

// HDUE holdowns: [group][wall width "4" | "6"] — ASD cap (design), LRFD cap with δ @ LRFD cap (deflection only), min post
export const HDUE_DATA = ${block(hdue)};

// MSTC floor-to-floor straps: [group][floor clear span] — ASD cap (design), LRFD cap with δ @ LRFD cap (deflection only)
export const MSTC_DATA = ${block(mstc)};

// SDPWS Table 4.3A nailing: [group] — SPF/HF v_n is entered × C_G; capacities include the 0.92 footnote factor
export const NAILING_DATA = ${block(nailing)};
export const NAILING_CG = ${json(cg)};

// FTAO wall straps (CS / CMST / CMSTC): ASD allowable tension, fasteners [count, end length] per framing group
export const FTAO_STRAP_DATA = ${list(ftao)};

// NDS 2018 wood grades: kind dim (Table 4A / 4B, 4B values by width class) or pt (Table 4D, posts & timbers)
export const WOOD_GRADES = ${list(wood)};
`;

if (checkOnly) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== out) { console.error('shearWallHardwareData.js differs from the reference .md files — run npm run hardware:build'); process.exit(1); }
  console.log('shearWallHardwareData.js matches the reference .md files');
} else {
  fs.writeFileSync(OUT, out);
  console.log('Wrote ' + OUT + ' — HDUE ' + Object.values(hdue).flatMap(Object.values).flat().length + ' rows, MSTC '
    + Object.values(mstc).flatMap(Object.values).flat().length + ', nailing ' + Object.values(nailing).flat().length + ', FTAO ' + ftao.length + ', grades ' + wood.length);
}
