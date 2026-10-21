// Shear wall verification cases (V01–V22): resolve an expected value in the calc output and compare.
// Used by the case runner (tests/shearWallCases.test.mjs), the catalog (scripts/casesDoc.mjs) and the
// in-app Verification tab (items seeded by scripts/seedCases.mjs carry the case in inputs.verification).
//
// Case: { id, title, intent, covers[], handCalc: [{ step, text }], expect: [...], expectChecks, inputs }
// Expect row: { label, at, field, value, tol, step, line? }
//   at    — 'wall:<mark>' | 'post:<mark>' | 'beam:<mark>' | 'level:<level name>' | 'drift:<level name>' | 'line'
//   field — path in that object: a.b[0]["1.0D"]; a wall also has the virtual field lc = C4 load-case end forces
//           (lc["1.0D"].left, lc["1.0E →"].right; + = compression)
//   value — number (|calc − value| ≤ tol) or string / boolean / null (equal)
//   line  — line name when the case has more than one line (default: the first line of the first direction)
// expectChecks: { fail: [ids of checks G1–G12 that must fail, or "<line name>:<id>" for one line] } — every other check must pass (or be N/A);
//   optional warnings: [load path audit / distribution warning types that must be present]
import { loadCaseEnds } from './shearWallCalcSheet.js';

export function parsePath(path) {
  const out = [];
  const re = /\.?([A-Za-z_$][\w$]*)|\[(\d+)\]|\["([^"]*)"\]/g;
  let m, last = 0;
  while ((m = re.exec(path)) !== null) {
    if (m.index !== last) throw new Error('Bad path "' + path + '" at ' + last);
    out.push(m[1] != null ? m[1] : m[2] != null ? +m[2] : m[3]);
    last = re.lastIndex;
  }
  if (last !== path.length) throw new Error('Bad path "' + path + '"');
  return out;
}

export function findLine(out, name) {
  const lines = (out.perDirection || []).flatMap(d => d.perLine.map(ln => ({ d, ln })));
  const hit = name ? lines.find(x => x.ln.lineName === name) : lines[0];
  if (!hit) throw new Error('Line not found: ' + (name || '(first)'));
  return hit;
}

// The object an expect row points at
export function resolveTarget(out, row) {
  const { ln } = findLine(out, row.line);
  const at = row.at || 'line';
  const i = at.indexOf(':');
  const kind = i < 0 ? at : at.slice(0, i), name = i < 0 ? '' : at.slice(i + 1);
  if (kind === 'line') return ln;
  if (kind === 'wall') {
    const w = ln.perLevel.flatMap(p => p.walls).find(x => x.mark === name);
    if (!w) throw new Error('Wall not found: ' + name);
    return Object.assign(Object.create(w), { lc: w.combos ? loadCaseEnds(w).N : {} });
  }
  if (kind === 'post') { const p = (ln.postPaths || []).find(x => x.mark === name); if (!p) throw new Error('Post not found: ' + name); return p; }
  if (kind === 'beam') { const b = (ln.beamTransfers || []).find(x => x.mark === name); if (!b) throw new Error('Beam not found: ' + name); return b; }
  if (kind === 'level') { const p = ln.perLevel.find(x => x.levelName === name); if (!p) throw new Error('Level not found: ' + name); return p; }
  if (kind === 'drift') { const r = ((ln.drift && ln.drift.rows) || []).find(x => x.levelName === name); if (!r) throw new Error('Drift row not found: ' + name); return r; }
  throw new Error('Unknown target: ' + at);
}

export function resolveValue(out, row) {
  let v = resolveTarget(out, row);
  for (const k of parsePath(row.field || '')) {
    if (v == null) return undefined;
    v = v[k];
  }
  return v;
}

// One compared row: { ...row, actual, diff, pass, error }
export function compareRow(out, row) {
  let actual, error = null;
  try { actual = resolveValue(out, row); } catch (e) { error = e.message; }
  if (error) return { ...row, actual: undefined, diff: null, pass: false, error };
  if (typeof row.value === 'number') {
    const ok = typeof actual === 'number' && isFinite(actual);
    const diff = ok ? actual - row.value : null;
    return { ...row, actual, diff, pass: ok && Math.abs(diff) <= (row.tol != null ? row.tol : 0.005) + 1e-9, error: ok ? null : 'not a number: ' + actual };
  }
  return { ...row, actual, diff: null, pass: actual === row.value, error: null };
}

// Checks G1–G12 of every line against expectChecks
export function checkRows(out, caseDef) {
  // 'G10' = must fail on some line; 'Line B:G10' = must fail on Line B (and pass on the other lines)
  const list = ((caseDef.expectChecks || {}).fail) || [];
  const mustFail = new Set(list.filter(x => !x.includes(':')));
  const perLine = list.filter(x => x.includes(':')).map(x => { const i = x.lastIndexOf(':'); return [x.slice(0, i), x.slice(i + 1)]; });
  const rows = [];
  for (const d of out.perDirection || []) for (const ln of d.perLine) {
    for (const c of ln.checks || []) {
      const failed = c.status === 'fail';
      const want = mustFail.has(c.id) || perLine.some(([l, id]) => l === ln.lineName && id === c.id);
      rows.push({ line: ln.lineName, id: c.id, title: c.title, status: c.status, expected: want ? 'fail' : 'pass', pass: failed === want && (want || c.status !== 'fail') });
    }
  }
  // a check that must fail has to fail on at least one line
  for (const id of mustFail) if (!rows.some(r => r.id === id && r.status === 'fail')) rows.push({ line: '—', id, title: 'expected to fail', status: 'pass', expected: 'fail', pass: false });
  for (const [l, id] of perLine) if (!rows.some(r => r.line === l && r.id === id)) rows.push({ line: l, id, title: 'expected to fail (line not found)', status: '—', expected: 'fail', pass: false });
  return rows;
}

export function warningRows(out, caseDef) {
  const want = (caseDef.expectChecks || {}).warnings || [];
  const have = new Set((out.perDirection || []).flatMap(d => d.perLine.flatMap(ln =>
    [...((ln.loadPathAudit || {}).warnings || []), ...((ln.distribution || {}).warnings || [])].map(w => w.type))));
  return want.map(t => ({ type: t, pass: have.has(t) }));
}

// Everything the reviewer sees for one case
export function evaluateCase(caseDef, out) {
  const values = (caseDef.expect || []).map(r => compareRow(out, r));
  const checks = checkRows(out, caseDef);
  const warnings = warningRows(out, caseDef);
  const pass = values.every(r => r.pass) && checks.every(r => r.pass) && warnings.every(r => r.pass);
  return { values, checks, warnings, pass };
}

// Plain-text description of a case model (for the catalog and the Verification tab)
export function modelSummary(inputs) {
  const lv = inputs.levels || [];
  const name = (id) => (lv.find(l => l.id === id) || {}).name || id;
  const out = [];
  out.push('Project: ' + (inputs.loadType || 'seismic') + ', S_DS ' + (inputs.sds || '—') + ', ' + (inputs.species || 'DF-L') + ' ' + (inputs.woodGrade || '') + ' / ' + (inputs.postGrade || '') + ', ' + (inputs.wallThickness || '4') + '" walls, '
    + (inputs.sheathing === 'osb' ? 'OSB' : 'plywood') + ', distribution ' + (inputs.distribution || 'capacity')
    + (inputs.cd ? ', Cd ' + inputs.cd + ' / Ie ' + inputs.ie + ' / RC ' + (inputs.riskCategory || '—') : '')
    + (inputs.omega0 ? ', Ω₀ ' + inputs.omega0 : '')
    + ((inputs.wallDLTypes || []).length ? ', wall DL ' + inputs.wallDLTypes.map(t => t.psf + ' psf').join(' / ') : ''));
  out.push('Levels (top down): ' + lv.map(l => l.name + ' ' + l.floorToFloor + ' ft' + (l.anchorageType && l.anchorageType !== 'auto' ? ' (' + l.anchorageType + ')' : '') + (l.floorClearSpan && l.floorClearSpan !== '16' ? ', clear span ' + l.floorClearSpan + '"' : '')).join(' · '));
  for (const d of inputs.directions || []) for (const ln of d.lines || []) {
    out.push(d.name + ' / ' + ln.name + ' (' + ln.totalLength + ' ft, ρ ' + d.rho + (ln.wallThickness ? ', ' + ln.wallThickness + '" walls' : '') + (ln.distribution ? ', ' + ln.distribution : '') + (ln.driftBypass ? ', drift ' + ln.driftBypass : '') + '):');
    const loads = Object.entries(ln.levelLoads || {}).map(([id, v]) => name(id) + ' ' + ['seismic', 'wind'].filter(k => String(v[k] || '').trim()).map(k => (k === 'seismic' ? 'E ' : 'W ') + v[k] + ' k').join(', ')).filter(s => /k$/.test(s));
    if (loads.length) out.push('  lateral 1.0 at each level: ' + loads.join(' · '));
    for (const w of ln.walls || []) {
      const type = w.systemType === 'wswh' ? 'WSWH ' + (w.wswhWidth || 18) + '" ' + (w.wswhCondition || '') : (w.openings || []).length ? 'FTAO' : 'segmented';
      out.push('  ' + w.mark + ' — ' + name(w.levelId) + ', x ' + w.position + ' ft, L ' + w.length + ' ft, ' + type
        + (w.nailingPattern ? ', nailing ' + w.nailingPattern + ' (manual)' : '') + ((w.openings || []).length ? ', openings ' + w.openings.map(o => o.width + '×' + (o.head - o.sill) + ' at ' + o.offset).join(', ') : ''));
    }
    for (const b of ln.beams || []) out.push('  beam ' + b.mark + ' — ' + name(b.levelId) + ' floor line, x ' + b.position + '–' + (b.position + b.length) + ' ft, supports ' + (b.supports || []).map(s => s.type + ' at ' + s.position).join(', '));
    for (const p of ln.supportPosts || []) out.push('  post ' + p.mark + ' — ' + name(p.levelId) + ', x ' + p.position + ' ft');
    for (const [id, g] of Object.entries(ln.gravityLoads || {})) for (const r of (g.loads || [])) {
      const mag = ['D', 'L', 'Lr'].filter(k => String(r[k] || '').trim()).map(k => k + ' ' + r[k]).join(' / ');
      out.push('  gravity at ' + name(id) + ': ' + (r.shape === 'point' ? 'point ' + mag + ' k at x ' + r.position : r.shape === 'full' ? 'full line ' + mag + ' plf' : 'uniform ' + mag + ' plf, x ' + r.start + '–' + r.end));
    }
  }
  return out;
}

export function fmtValue(v) {
  if (typeof v === 'number') return Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(3) : v.toFixed(4);
  if (v === undefined) return '—';
  return String(v);
}
