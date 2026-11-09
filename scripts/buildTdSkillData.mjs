// Vendors the wood-diaph-transfer skill into the repo:
//   tests.yaml                     → tests/td-cases/skill-tests.json  (book + boundary cases for the TD engine; book
//                                     misprints corrected, see CORRECTIONS)
//   data/SDPWS/2021/T4.2.2 (.csv)  → src/modules/tdTables.js          (aspect-ratio limits, UNVERIFIED)
//   flow.yaml                      → src/modules/tdFlow.js            (steps as data, each expression compiled to a JS
//                                     function; run by tdCalc.js — the JS twin of reference/wood_diaph_transfer.py)
// Run: node scripts/buildTdSkillData.mjs "<design-skills folder>"          (writes)
//      node scripts/buildTdSkillData.mjs "<design-skills folder>" --check  (compares, exit 1 on a difference;
//                                                                            line endings ignored)
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const dir = process.argv[2];
const check = process.argv.includes('--check');
if (!dir || !fs.existsSync(dir)) {
  console.error('Usage: node scripts/buildTdSkillData.mjs "<design-skills folder>" [--check]');
  process.exit(1);
}
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const skillDir = path.join(dir, 'skills', 'wood-diaph-transfer');

// tests.yaml: keep only data (anchors resolved by the parser)
const tests = parse(fs.readFileSync(path.join(skillDir, 'tests.yaml'), 'utf8'), { merge: true });
const skillMd = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
const ver = (skillMd.match(/^skill_version:\s*(\S+)/m) || [])[1];
const status = (skillMd.match(/^status:\s*(\S+)/m) || [])[1];
// Book misprints the skill's tests carry; the vendored test uses the corrected value and keeps what it replaced.
const CORRECTIONS = {
  T05: {
    note: 'EX-IRREG-2E Ex 4.3 p3 misprint: v3 = 8800/56 is printed +167.9 plf; correct 157.14 plf (see '
      + 'tests/td-book/src/Ex4.3.mjs errata). Basic and outside shear at edge x2 corrected; the x2 net shears follow. '
      + 'Edge-member forces do not depend on it.',
    inputs: Object.fromEntries(['top', 'y1', 'y2', 'bot'].map(k => ['td_vb_x2_' + k, 157.14])
      .concat(['s1', 's2', 's3'].flatMap(s => ['hi', 'lo'].map(e => ['td_vo_x2_' + s + '_' + e, 157.14])))),
    outputs: { td_vnet_x2_s1_hi: 39.05, td_vnet_x2_s2_hi: 412.38, td_vnet_x2_s3_lo: 32.38 },
    dropOverrides: ['td_vnet_x2_s3_lo'],
  },
};
for (const t of tests.tests) {
  const c = CORRECTIONS[t.id];
  if (!c) continue;
  const was = { inputs: {}, outputs: {} };
  for (const [k, v] of Object.entries(c.inputs)) { was.inputs[k] = t.inputs[k]; t.inputs[k] = v; }
  for (const [k, v] of Object.entries(c.outputs)) { was.outputs[k] = t.expected.outputs[k]; t.expected.outputs[k] = v; }
  for (const k of c.dropOverrides || []) if (t.tolerance && t.tolerance.overrides) delete t.tolerance.overrides[k];
  t.corrected = { note: c.note, was };
}
const testsJson = JSON.stringify({
  generatedFrom: 'design-skills/skills/wood-diaph-transfer/tests.yaml',
  skill: tests.skill, skillVersion: ver, skillStatus: status, schemaVersion: tests.schema_version,
  tests: tests.tests,
}, null, 2) + '\n';

// flow.yaml → tdFlow.js. Expressions are the skill's restricted Python (names, numbers, 'strings', + - * /,
// comparisons, and / or / not, True / False, max / min / abs / sqrt / log / exp); each becomes `e => …` over the
// run's environment e. An unknown token stops the build.
const flow = parse(fs.readFileSync(path.join(skillDir, 'flow.yaml'), 'utf8'), { merge: true });
const FUNCS = { max: 'Math.max', min: 'Math.min', abs: 'Math.abs', sqrt: 'Math.sqrt', log: 'Math.log', exp: 'Math.exp' };
const WORDS = { and: '&&', or: '||', not: '!', True: 'true', False: 'false' };
function jsExpr(src) {
  const s = String(src).replace(/\s+/g, ' ').trim();
  const re = /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)|([A-Za-z_]\w*)|('[^']*')|(==|!=|<=|>=|[-+*/(),<>]))/y;
  let out = '', m;
  re.lastIndex = 0;
  while (re.lastIndex < s.length) {
    const at = re.lastIndex;
    m = re.exec(s);
    if (!m || m.index !== at) throw new Error('flow.yaml: cannot read expression near "' + s.slice(at) + '" in: ' + s);
    if (m[1]) out += m[1];
    else if (m[2]) out += WORDS[m[2]] ? ' ' + WORDS[m[2]] + ' ' : FUNCS[m[2]] || 'e.' + m[2];
    else if (m[3]) out += m[3];
    else out += m[4] === '==' ? ' === ' : m[4] === '!=' ? ' !== ' : m[4];
  }
  return 'e => ' + out.replace(/ +/g, ' ').replace(/\( /g, '(').trim();
}
const lit = v => JSON.stringify(v);
const exprMap = x => '{ ' + Object.entries(x).map(([k, v]) => k + ': ' + jsExpr(v)).join(', ') + ' }';
function stepJs(st) {
  const f = [`id: ${lit(st.id)}`, `type: ${lit(st.type)}`, `title: ${lit(st.title)}`];
  if (st.condition !== undefined) f.push('condition: ' + jsExpr(st.condition));
  if (st.expr) f.push('expr: ' + exprMap(st.expr));
  for (const k of ['outputs', 'allowed_values', 'prompt', 'reason_code', 'message', 'warning', 'value', 'flags', 'table', 'next', 'verify', 'cite'])
    if (st[k] !== undefined && st[k] !== null) f.push(`${k}: ${lit(st[k])}`);
  if (st.conditional_flags) f.push('conditional_flags: [' + st.conditional_flags.map(c => `{ when: ${jsExpr(c.when)}, flag: ${lit(c.flag)}, message: ${lit(c.message)} }`).join(', ') + ']');
  if (st.edition) f.push('edition: { ' + Object.entries(st.edition).map(([ed, o]) => lit(ed) + ': { '
    + [o.cite ? 'cite: ' + lit(o.cite) : '', o.expr ? 'expr: ' + exprMap(o.expr) : ''].filter(Boolean).join(', ') + ' }').join(', ') + ' }');
  return '    ' + st.id + ': { ' + f.join(', ') + ' },';
}
const flowJs = `// GENERATED by scripts/buildTdSkillData.mjs from design-skills/skills/wood-diaph-transfer/flow.yaml — do not edit.
// Skill ${flow.skill} ${ver} (${status}). Run by tdCalc.js.
export const TD_FLOW = {
  skill: ${lit(flow.skill)}, skillVersion: ${lit(ver)}, skillStatus: ${lit(status)}, schemaVersion: ${lit(flow.schema_version)},
  editionParam: ${lit(flow.edition_param)}, entry: ${lit(flow.entry)},
  inputs: ${lit(flow.inputs)},
  engineerInputs: ${lit(flow.engineer_inputs)},
  outputs: ${lit(flow.outputs)},
  constants: ${lit(Object.fromEntries((flow.local_vars || []).filter(v => 'value' in v).map(v => [v.key, v.value])))},
  steps: {
${flow.steps.map(stepJs).join('\n')}
  },
};
`;

// SDPWS T4.2.2: csv + meta
const tDir = path.join(dir, 'data', 'SDPWS', '2021');
const csv = fs.readFileSync(path.join(tDir, 'SDPWS-2021-T4.2.2.csv'), 'utf8').trim().split(/\r?\n/);
const head = csv[0].split(',');
const rows = csv.slice(1).map(l => Object.fromEntries(l.split(',').map((c, i) => [head[i], i ? Number(c) : c])));
const meta = parse(fs.readFileSync(path.join(tDir, 'SDPWS-2021-T4.2.2.meta.yaml'), 'utf8'));
const tablesJs = `// GENERATED by scripts/buildTdSkillData.mjs from design-skills/data/SDPWS/2021/SDPWS-2021-T4.2.2 — do not edit.
// Maximum diaphragm aspect ratios. Verification: ${meta.verify} (${meta.transcribed_by}).
export const SDPWS_T422 = {
  tableId: ${JSON.stringify(meta.table_id)},
  section: ${JSON.stringify(meta.section)},
  verify: ${JSON.stringify(meta.verify)},
  rows: ${JSON.stringify(rows, null, 2).replace(/\n/g, '\n  ')},
};

export function aspectLimits(sheathingType) {
  return SDPWS_T422.rows.find(r => r.sheathing_type === sheathingType) || null;
}
`;

const outputs = [
  [path.join(repo, 'tests', 'td-cases', 'skill-tests.json'), testsJson],
  [path.join(repo, 'src', 'modules', 'tdTables.js'), tablesJs],
  [path.join(repo, 'src', 'modules', 'tdFlow.js'), flowJs],
];
const lf = t => (t === null ? null : t.replace(/\r\n/g, '\n'));
let differ = 0;
for (const [file, text] of outputs) {
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (check) {
    if (lf(old) !== text) { differ++; console.log('differs:', path.relative(repo, file)); }
    continue;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log('wrote', path.relative(repo, file));
}
if (check) {
  console.log(differ ? `${differ} file(s) differ` : 'up to date');
  process.exit(differ ? 1 : 0);
}
console.log(`${tests.tests.length} skill tests (skill ${ver}, ${status}); ${rows.length} aspect rows`);
