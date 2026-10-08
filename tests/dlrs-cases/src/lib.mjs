// Diaphragm to LRS verification cases — shared helpers for the case sources (Dxx.mjs).
// The hand calcs use the published closed forms (AISC Manual Table 3-23), NOT the engine's lever rule,
// so the cases check the engine independently.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SCHEMA = 1;
export const f2 = v => (Math.abs(v) < 5e-13 ? 0 : v).toFixed(2);
export const f4 = v => (Math.abs(v) < 5e-13 ? 0 : v).toFixed(4);

// ── Closed forms (Table 3-23). l = back span, w in k/ft, P in k ──
// Case 4 (Case 1 when a = c = 0): partial uniform in the back span, a / b / c measured from R1
export const case4 = (w, a, b, c) => { const l = a + b + c; return [w * b * (2 * c + b) / (2 * l), w * b * (2 * a + b) / (2 * l)]; };
// Case 8: point load in the back span
export const case8 = (P, a, b) => { const l = a + b; return [P * b / l, P * a / l]; };
// Overhang beyond R2 (Case 25 / 26 and their general form): resultant F at e past R2 → [R1, R2]
export const overhangRight = (F, e, l) => [-F * e / l, F * (l + e) / l];
export const overhangLeft = (F, e, l) => [F * (l + e) / l, -F * e / l];
export const add = (...rs) => rs.reduce((s, r) => [s[0] + r[0], s[1] + r[1]], [0, 0]);

// ── Model builder (readable ids, so expectations and the catalog can name things) ──
// spec = { levels: [[name, fx, tag?]], dirs: [{ name, lines: 'A B C', groups: [['C D', ['Roof']?]], dias: [...], down: {...} }] }
// dia = { lv: 'Roof', mark: 'D1', L, x1?, x2?, parts: [[a, b, d]] | d, s1: 'A' | { on: 'D1', at: 2 }, s2, pl: [[x, P, note]] }
// down = { Roof: { H: 'ends' | 'same' | { split: [['C', 40], ['C+D', 60]] } } }  (keys: line name or 'C+D' group)
export function buildModel(spec) {
  const lvId = n => 'lv-' + n.replace(/\s+/g, '');
  const levels = spec.levels.map(([name, fx, tag]) => ({ id: lvId(name), name, tag: tag || '', fx: String(fx) }));
  const directions = spec.dirs.map(ds => {
    const did = 'dir-' + ds.name;
    const lines = ds.lines.split(/\s+/).filter(Boolean).map(n => ({ id: did + '-' + n, name: n }));
    const lineId = n => { const l = lines.find(x => x.name === n); if (!l) throw new Error('line ' + n); return l.id; };
    const groups = (ds.groups || []).map(([names, lvs]) => ({ id: 'g-' + names.replace(/\s+/g, ''), lineIds: names.split(/\s+/).map(lineId), levelIds: (lvs || []).map(lvId) }));
    const gKey = n => { const g = groups.find(x => x.id === 'g-' + n.replace(/\+/g, '')); if (!g) throw new Error('group ' + n); return 'g:' + g.id; };
    const key = n => (n.includes('+') ? gKey(n) : lineId(n));
    const dgId = (lv, mark) => did + '-' + lvId(lv) + '-' + mark;
    const sup = (lv, s, x) => typeof s === 'string'
      ? { x: x == null ? '' : String(x), kind: 'line', lineId: lineId(s), diaphragmId: '', atX: '' }
      : s && s.on ? { x: x == null ? '' : String(x), kind: 'diaphragm', lineId: '', diaphragmId: dgId(lv, s.on), atX: String(s.at) }
        : { x: x == null ? '' : String(x), kind: 'line', lineId: '', diaphragmId: '', atX: '' };
    const diaphragms = (ds.dias || []).map(g => ({
      id: dgId(g.lv, g.mark), levelId: lvId(g.lv), mark: g.mark, length: typeof g.L === 'string' ? g.L : String(g.L),
      supports: [sup(g.lv, g.s1, g.x1), sup(g.lv, g.s2, g.x2)],
      parts: (Array.isArray(g.parts) ? g.parts : [[0, g.L, g.parts]]).map(([a, b, d], i) => ({ id: dgId(g.lv, g.mark) + '-p' + (i + 1), a: String(a), b: String(b), d: String(d) })),
      pointLoads: (g.pl || []).map(([x, p, note], i) => ({ id: dgId(g.lv, g.mark) + '-m' + (i + 1), x: String(x), p: String(p), note: note || '' })),
    }));
    const down = {};
    for (const [lv, map] of Object.entries(ds.down || {})) {
      const m = (down[lvId(lv)] = {});
      for (const [k, ch] of Object.entries(map)) {
        m[key(k)] = ch === 'ends' || ch === 'same' ? { mode: ch } : { mode: 'split', split: ch.split.map(([to, pct]) => ({ to: key(to), pct: String(pct) })) };
      }
    }
    return { id: did, name: ds.name, lines, groups, down, diaphragms };
  });
  return { loadType: 'seismic', pdfReport: 'detailed', refs: {}, notes: '', levels, directions };
}

// Expect row: dia / line / level / check targets (see src/modules/diaphragmToLrsVerify.js)
export const ex = (label, at, field, value, step, tol) => ({ label, at, field, value, step, ...(tol != null ? { tol } : {}) });

export function writeCase(c) {
  const file = path.join(OUT_DIR, c.id + '-' + c.slug + '.json');
  for (const f of fs.readdirSync(OUT_DIR)) if (f.startsWith(c.id + '-') && f.endsWith('.json')) fs.unlinkSync(path.join(OUT_DIR, f));
  const { slug, ...rest } = c;
  fs.writeFileSync(file, JSON.stringify({ ...rest, schemaVersion: SCHEMA }, null, 2) + '\n');
  return file;
}

// ── Beam back-check cases (B01 …, docs/diaphragm-to-lrs-beam-check.md) ──
// One level "Roof" with q = 0.01 k/sf (F_x = 0.01 × ΣA), direction E-W, the beam under test R.D1 on lines A (R1) / B (R2).
// Expected values are typed by hand in each Bxx.mjs — nothing here computes them.
// spec = { L, x1?, x2?, parts: [[a, b, d]], points: [[x, P]], ... }; a beam with no parts gets the area carrier R.D2
// (L 10, d 10, on lines C / D) so the level has an area (D8).
export const Q_BEAM = 0.01;
export function beamCase(spec) {
  const parts = spec.parts || [];
  const points = spec.points || [];
  const carrier = !parts.length;
  const sumA = parts.reduce((s, [, b, d]) => s + b * d, 0) + (carrier ? 100 : 0);
  const fx = Math.round(Q_BEAM * sumA * 1e6) / 1e6;
  const dias = [{ lv: 'Roof', mark: 'D1', L: spec.L, x1: spec.x1, x2: spec.x2, parts: parts.length ? parts : [], s1: 'A', s2: 'B',
    pl: points.map(([x, p], i) => [x, p, 'P' + (i + 1)]) }];
  if (carrier) dias.push({ lv: 'Roof', mark: 'D2', L: 10, parts: 10, s1: 'C', s2: 'D' });
  const inputs = buildModel({ levels: [['Roof', fx]], dirs: [{ name: 'E-W', lines: carrier ? 'A B C D' : 'A B', dias }] });
  const beam = {
    L: spec.L, x1: spec.x1 == null ? 0 : spec.x1, x2: spec.x2 == null ? spec.L : spec.x2,
    parts: parts.map(([a, b, d], i) => ({ id: 'p' + (i + 1), label: 'part ' + (i + 1), a, b, w: Q_BEAM * d })),
    points: points.map(([x, P], i) => ({ id: 'm' + (i + 1), label: 'P' + (i + 1), x, P, manual: true })),
  };
  const { L, x1, x2, parts: _p, points: _q, ...meta } = spec;
  return { ...meta, beam, inputs, expectChecks: { fail: [] } };
}
// Expect row on the beam under test (R.D1) — field 'R1', 'R2', 'R1dist', 'R1P', 'rows[0].R1', …
export const beamEx = (label, field, value, step = 1) => ex(label, 'dia:E-W/R.D1', field, value, step);
