// Diaphragm to LRS verification cases (D01 …): resolve an expected value in calcAll() output and compare.
// Used by the case runner (tests/diaphragmToLrsCases.test.mjs), the catalog (scripts/dlrsCasesDoc.mjs) and the
// in-app Verification tab (items seeded by scripts/dlrsSeedCases.mjs carry the case in inputs.verification).
//
// Case: { id, title, intent, covers[], handCalc: [{ step, text }], expect: [...], expectChecks, inputs }
// Expect row: { label, at, field, value, tol, step }
//   at    — 'level:<direction>/<level name>' | 'dia:<direction>/<label, e.g. R.D1>' | 'line:<direction>/<label, e.g. 2.C+2.D>'
//           | 'check:<direction>/<D1…D8>'
//   field — path in that object (a diaphragm also has R1, R2, R1dist, R1P, R2dist, R2P)
//   value — number (|calc − value| ≤ tol, default 0.0005 k) or string / boolean (equal)
// expectChecks: { fail: ['D6'] or ['E-W:D6'] } — every other check must pass.
import { el } from '../utils.js';
import { parsePath, fmtValue } from './shearWallVerify.js';
import { calcAll } from './diaphragmToLrsCalc.js';

export const DEFAULT_TOL = 0.0005;

function dirOf(out, name) {
  const d = (out.perDirection || []).find(x => x.name === name);
  if (!d) throw new Error('direction "' + name + '" not found');
  return d;
}

export function resolveTarget(out, row) {
  const m = /^(level|dia|line|check):([^/]+)\/(.+)$/.exec(row.at || '');
  if (!m) throw new Error('bad target "' + row.at + '"');
  const [, kind, dn, key] = m;
  const d = dirOf(out, dn);
  if (kind === 'check') {
    const c = d.checks.find(x => x.id === key);
    if (!c) throw new Error('check ' + key + ' not found');
    return c;
  }
  if (kind === 'level') {
    const lv = d.perLevel.find(p => p.name === key);
    if (!lv) throw new Error('level "' + key + '" not found');
    return lv;
  }
  for (const lv of d.perLevel) {
    if (kind === 'dia') {
      const g = lv.diaphragms.find(x => x.label === key);
      if (g) {
        const s = g.supports || [];
        return { ...g, R1: s[0] && s[0].R, R2: s[1] && s[1].R, R1dist: s[0] && s[0].Rdist, R1P: s[0] && s[0].RP, R2dist: s[1] && s[1].Rdist, R2P: s[1] && s[1].RP };
      }
    } else {
      const u = lv.lines.find(x => x.label === key);
      if (u) return u;
    }
  }
  throw new Error((kind === 'dia' ? 'diaphragm' : 'line') + ' "' + key + '" not found');
}

export function compareRow(out, row) {
  let v;
  try {
    v = resolveTarget(out, row);
    for (const k of parsePath(row.field || '')) { if (v == null) break; v = v[k]; }
  } catch (e) { return { ...row, actual: undefined, diff: null, pass: false, error: e.message }; }
  if (typeof row.value === 'number') {
    const ok = typeof v === 'number' && isFinite(v);
    const diff = ok ? v - row.value : null;
    return { ...row, actual: v, diff, pass: ok && Math.abs(diff) <= (row.tol != null ? row.tol : DEFAULT_TOL) + 1e-9, error: ok ? null : 'not a number: ' + v };
  }
  return { ...row, actual: v, diff: null, pass: v === row.value, error: null };
}

export function checkRows(out, caseDef) {
  const list = ((caseDef.expectChecks || {}).fail) || [];
  const rows = [];
  for (const d of out.perDirection || []) for (const c of d.checks) {
    const want = list.includes(c.id) || list.includes(d.name + ':' + c.id);
    const failed = c.status === 'fail';
    rows.push({ dir: d.name, id: c.id, title: c.label, status: c.status, expected: want ? 'fail' : 'pass', pass: failed === want, items: c.items });
  }
  return rows;
}

export function evaluateCase(caseDef, out) {
  const values = (caseDef.expect || []).map(r => compareRow(out, r));
  const checks = checkRows(out, caseDef);
  return { values, checks, pass: values.every(r => r.pass) && checks.every(r => r.pass) };
}

// Plain-text model description (catalog + Verification tab)
export function modelSummary(inputs) {
  const out = [];
  const lvName = id => (inputs.levels.find(l => l.id === id) || {}).name || id;
  out.push('Levels (top down): ' + inputs.levels.map(l => l.name + ' F_x ' + l.fx + ' k' + (l.tag ? ' [' + l.tag + ']' : '')).join(' · '));
  for (const d of inputs.directions || []) {
    out.push(d.name + ' — lines ' + (d.lines || []).map(l => l.name).join(', ')
      + ((d.groups || []).length ? '; combined ' + d.groups.map(g => g.lineIds.map(id => (d.lines.find(l => l.id === id) || {}).name).join('+') + (g.levelIds && g.levelIds.length ? ' at ' + g.levelIds.map(lvName).join(', ') : '')).join('; ') : ''));
    for (const g of d.diaphragms || []) {
      const sup = (g.supports || []).map((s, i) => 'R' + (i + 1) + (s.x !== '' && s.x != null ? ' x ' + s.x : '') + ' → '
        + (s.kind === 'diaphragm' ? ((d.diaphragms.find(x => x.id === s.diaphragmId) || {}).mark || '?') + ' @ ' + s.atX : ((d.lines.find(l => l.id === s.lineId) || {}).name || '?'))).join(', ');
      const parts = (g.parts || []).map(p => 'a ' + p.a + ' b ' + p.b + ' d ' + p.d).join(' | ');
      const pls = (g.pointLoads || []).map(p => 'P ' + p.p + ' k @ ' + p.x + (p.note ? ' (' + p.note + ')' : '')).join(', ');
      out.push('  ' + lvName(g.levelId) + ' ' + g.mark + ': L ' + g.length + ' ft; ' + sup + '; parts ' + parts + (pls ? '; manual ' + pls : ''));
    }
    for (const [lid, map] of Object.entries(d.down || {})) for (const [k, ch] of Object.entries(map)) {
      const nm = k.startsWith('g:') ? 'group ' + k.slice(2) : ((d.lines.find(l => l.id === k) || {}).name || k);
      out.push('  ' + lvName(lid) + ' line ' + nm + ': ' + ch.mode + (ch.mode === 'split' ? ' ' + ch.split.map(s => (s.to.startsWith('g:') ? s.to : (d.lines.find(l => l.id === s.to) || {}).name) + ' ' + s.pct + '%').join(', ') : ''));
    }
  }
  return out;
}

export function renderVerificationTab(inputs) {
  const v = inputs.verification;
  const box = el('div');
  let ev = null, err = null;
  try { ev = evaluateCase(v, calcAll(inputs)); } catch (e) { err = e.message; }
  box.appendChild(el('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.35rem' } },
    el('strong', null, v.id + ' — ' + v.title),
    ev ? el('span', { className: 'badge ' + (ev.pass ? 'badge-pass' : 'badge-fail') }, ev.pass ? 'PASS' : 'FAIL') : null));
  const note = (text, color) => el('div', { style: { fontSize: '0.8rem', color: color || 'var(--ink-secondary)', marginBottom: '0.4rem', lineHeight: '1.5' } }, text);
  box.appendChild(note(v.intent));
  if ((v.covers || []).length) box.appendChild(note('Covers: ' + v.covers.join(' · ')));
  box.appendChild(note('Expected = the hand calc of this case; Calculated = the tool with the inputs as they are now. Changing the inputs changes the model (re-seed with npm run dlrs:seed to restore).', 'var(--stale, #b7791f)'));
  if (err) { box.appendChild(note('Could not evaluate: ' + err, 'var(--fail)')); return box; }
  box.appendChild(el('div', { className: 'form-label' }, 'Hand calc'));
  const ol = el('ol', { style: { fontSize: '0.82rem', paddingLeft: '1.25rem', margin: '0.25rem 0 0.5rem', lineHeight: '1.55' } });
  (v.handCalc || []).forEach(s => ol.appendChild(el('li', null, s.text)));
  box.appendChild(ol);
  box.appendChild(el('div', { className: 'form-label' }, 'Expected vs calculated'));
  const t = el('table', { className: 'data-table' });
  t.appendChild(el('tr', null, ...['Step', 'Value', 'Expected', 'Calculated', 'Difference', 'Tol', ''].map(h => el('th', null, h))));
  for (const r of ev.values) t.appendChild(el('tr', null, el('td', null, String(r.step || '')), el('td', null, r.label),
    el('td', { className: 'num mono' }, fmtValue(r.value)), el('td', { className: 'num mono' }, r.error ? r.error : fmtValue(r.actual)),
    el('td', { className: 'num mono' }, r.diff == null ? '' : r.diff.toFixed(4)), el('td', { className: 'num mono' }, r.tol != null ? String(r.tol) : typeof r.value === 'number' ? String(DEFAULT_TOL) : ''),
    el('td', null, el('span', { className: 'badge ' + (r.pass ? 'badge-pass' : 'badge-fail') }, r.pass ? 'OK' : 'NG'))));
  box.appendChild(el('div', { className: 'table-scroll' }, t));
  box.appendChild(el('div', { className: 'form-label', style: { marginTop: '0.6rem' } }, 'Checks'));
  const ct = el('table', { className: 'data-table' });
  ct.appendChild(el('tr', null, ...['Direction', 'Check', 'Status', 'Expected', ''].map(h => el('th', null, h))));
  for (const r of ev.checks) ct.appendChild(el('tr', null, el('td', null, r.dir), el('td', null, r.id + ' ' + r.title), el('td', null, r.status), el('td', null, r.expected),
    el('td', null, el('span', { className: 'badge ' + (r.pass ? 'badge-pass' : 'badge-fail') }, r.pass ? 'OK' : 'NG'))));
  box.appendChild(el('div', { className: 'table-scroll' }, ct));
  return box;
}
