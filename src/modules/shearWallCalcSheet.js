// Row builders of the per-wall calc sheet (Walls → Detailed). Pure data — no DOM — so tests and a PDF calc
// sheet can reuse them. Every row is [label, value] or an array of table cells (strings).
// Sign convention: N = vertical force at a wall end (k), + = compression, − = uplift; N = C − T.
// Load cases 1.0D, 1.0L, 1.0Lr, 1.0E, 1.0W are unfactored; the combinations are their factored sums
// (superposition — check G12). → = shear toward the right end (left end uplift), ← = toward the left end.
import { NAILING_TABLE, FOOTNOTE_10_FACTOR, sheathingLabel } from './shearWallNailing.js';
import { HDUE_TABLE, MSTC_TABLE, hdueMinPost, deltaBasisLoad } from './shearWallHardware.js';
import { postArea } from './shearWallDeflection.js';

const f2 = (v) => (v == null || !isFinite(v) ? '—' : (+v).toFixed(2));
const f3 = (v) => (v == null || !isFinite(v) ? '—' : (+v).toFixed(3));
const f4 = (v) => (v == null || !isFinite(v) ? '—' : (+v).toFixed(4));
const f0 = (v) => (v == null || !isFinite(v) ? '—' : Math.round(v).toString());
const sgn = (v) => (v < 0 ? '− ' + f2(-v) : f2(v));
const tc = (N) => (N < -1e-9 ? 'T ' + f2(-N) : N > 1e-9 ? 'C ' + f2(N) : '0');
const nOf = (c, side) => (c ? (side === 'left' ? (c.comprLeft || 0) - (c.tensionLeft || 0) : (c.comprRight || 0) - (c.tensionRight || 0)) : 0);

export const GRAVITY_CASES = [['D', '1.0D'], ['L', '1.0L'], ['Lr', '1.0Lr']];
export const LATERAL_CASES = [['E', '1.0E'], ['W', '1.0W']];

// Load cases present on this wall (keys of its combos)
export function caseKeysOf(w) {
  const has = (k) => !!(w.combos && w.combos[k]);
  return { gravity: GRAVITY_CASES.filter(([, k]) => has(k)), lateral: LATERAL_CASES.filter(([, k]) => has(k)) };
}

// === A. Wall definition ===
// ctx: { wallIn (definition wall), levelName, lineThickness, gradeLabel, sheathing, rho, dlType ({ name, psf }) }
export function wallDefinitionRows(w, ctx = {}) {
  const d = ctx.wallIn || {};
  const L = w.length || 0, h = w.floorH || 0;
  const typeName = w.method === 'wswh' ? 'Strong-Wall WSWH (Simpson)' : w.method === 'ftao' ? 'FTAO — force transfer around openings' : 'Segmented (solid, full height)';
  const rows = [
    ['Mark / level', (w.mark || '') + ' / ' + (ctx.levelName || '—')],
    ['Wall type', typeName],
    ['Position', 'x = ' + f2(w.position) + ' to ' + f2((w.position || 0) + L) + ' ft (from the line left end)'],
    ['Length L', f2(L) + ' ft' + (w.method === 'wswh' ? ' (panel width)' : '')],
    ['Height h', f2(h) + ' ft (floor-to-floor)'],
  ];
  if (w.method !== 'wswh') rows.push(['Aspect ratio h/b', L > 0 ? f2(h) + ' / ' + f2(L) + ' = ' + f2(h / L) : '—']);
  if (w.method === 'ftao' && (d.openings || []).length) {
    rows.push(['Openings', d.openings.map((o, i) => '#' + (i + 1) + ': offset ' + f2(o.offset) + ' ft, width ' + f2(o.width) + ' ft, sill ' + f2(o.sill) + ' ft, head ' + f2(o.head) + ' ft').join('; ')]);
  }
  rows.push(['Wall dead load', ctx.dlType ? (ctx.dlType.name || 'wall DL') + ' ' + (ctx.dlType.psf || 0) + ' psf' : 'none']);
  rows.push(['Framing', ((ctx.lineThickness || '4') === '6' ? '2x6' : '2x4') + (ctx.gradeLabel ? ', ' + ctx.gradeLabel : '')]);
  if (w.method !== 'wswh') rows.push(['Sheathing', sheathingLabel(ctx.sheathing) + ' (G_a for deflection)']);
  rows.push(['Redundancy ρ', String(ctx.rho != null ? ctx.rho : '—')]);
  if (w.method !== 'wswh') {
    const basis = w.nailingBasis === 'manual' ? 'manual ✎' : w.nailingBasis === 'drift' ? 'auto — governed by drift (strength: ' + ((w.strengthNailing && w.strengthNailing.label) || '?') + ')' : 'auto — governed by strength';
    rows.push(['Nailing', (w.nailing ? w.nailing.label : '?') + ' — ' + basis]);
  }
  const ov = (id, what) => (id ? what + ' ' + id + ' ✎' : null);
  const overrides = [ov(d.anchorageLeftOverride, 'HD/strap L'), ov(d.anchorageRightOverride, 'HD/strap R'), ov(d.postLeftOverride, 'post L'), ov(d.postRightOverride, 'post R'),
    w.method === 'ftao' ? ov(d.ftaoStrapOverride, 'FTAO strap') : null, w.method === 'ftao' ? ov(d.jambPostOverride, 'jamb post') : null, w.method === 'wswh' ? ov(d.wswhAnchorOverride, 'anchor') : null].filter(Boolean);
  rows.push(['Hardware / posts', overrides.length ? overrides.join(', ') + '; others auto' : 'all auto-selected']);
  if (w.method === 'wswh' && w.wswh) {
    rows.push(['WSWH', 'width ' + w.wswh.width + '", ' + (w.wswh.condition || '') + (w.wswh.floorDepth ? ', floor depth ' + w.wswh.floorDepth + '"' : '')]);
  }
  return rows;
}

// === C1. Sheathing capacity (segmented walls): SDPWS 2021 Table 4.3A, footnote 10, aspect ratio ===
export function aspectFactorText(h, L) {
  if (!(L > 0)) return { hb: null, C: 0, text: 'L = 0' };
  const hb = h / L;
  if (hb <= 2 + 1e-9) return { hb, C: 1, text: 'h/b = ' + f2(h) + ' / ' + f2(L) + ' = ' + f2(hb) + ' ≤ 2.0 → C_hb = 1.0' };
  if (hb <= 3.5 + 1e-9) { const C = 1.25 - 0.125 * hb; return { hb, C, text: 'h/b = ' + f2(hb) + ' (2.0 < h/b ≤ 3.5) → C_hb = 1.25 − 0.125 × ' + f2(hb) + ' = ' + C.toFixed(4) }; }
  return { hb, C: 0, text: 'h/b = ' + f2(hb) + ' > 3.5 → not a shear wall (carries no shear)' };
}

// lt: 'E' | 'W'
export function capacityRows(w, lts = ['E']) {
  if (w.method !== 'wall') return [];
  const n = NAILING_TABLE.find(x => x.id === (w.nailing && w.nailing.id));
  if (!n) return [['Nailing', 'not found']];
  const ar = aspectFactorText(w.floorH || 0, w.length || 0);
  const rows = [
    ['Nailing', n.label + (n.sides === 2 ? ', both sides' : ', one side') + ' — 15/32" WSP Structural 1, 10d common (SDPWS 2021 Table 4.3A)'],
    ['Nominal unit shear v_n', f0(n.vn) + ' plf'],
  ];
  for (const lt of lts) {
    const div = lt === 'E' ? 2.8 : 2.0, tab = lt === 'E' ? n.asdE : n.asdW;
    rows.push(['ASD ' + (lt === 'E' ? 'seismic' : 'wind') + ' table value', 'v_n × ' + FOOTNOTE_10_FACTOR + ' / ' + div + ' = ' + n.vn + ' × ' + FOOTNOTE_10_FACTOR + ' / ' + div + ' = ' + f0(n.vn * FOOTNOTE_10_FACTOR / div) + ' plf (table ' + tab + ' plf; 0.92 = footnote 10)']);
  }
  rows.push(['Aspect ratio (SDPWS 4.3.4)', ar.text]);
  for (const lt of lts) {
    const tab = lt === 'E' ? n.asdE : n.asdW;
    rows.push(['v_cap ' + (lt === 'E' ? 'seismic' : 'wind'), tab + ' × ' + ar.C.toFixed(4) + ' = ' + f0(tab * ar.C) + ' plf']);
  }
  return rows;
}

// Nailing selection trace: every pattern from the lightest up to the one used, with its capacity vs demand
export function nailingTraceRows(w, rho, lts = ['E']) {
  if (w.method !== 'wall') return [];
  const L = w.length || 0;
  if (!(L > 0)) return [];
  const ar = aspectFactorText(w.floorH || 0, L);
  const v = { E: 0.7 * (rho || 1) * (w.shareExact_1E || 0) * 1000 / L, W: 0.6 * (w.shareExact_1W || 0) * 1000 / L };
  const used = NAILING_TABLE.findIndex(x => x.id === (w.nailing && w.nailing.id));
  const strength = w.strengthNailing ? NAILING_TABLE.findIndex(x => x.id === w.strengthNailing.id) : used;
  const rows = [];
  if (w.nailingBasis === 'manual') return [['Nailing', 'manual override ' + (w.nailing && w.nailing.label) + ' — not auto-selected']];
  for (let i = 0; i <= Math.max(used, strength); i++) {
    const m = NAILING_TABLE[i];
    const parts = lts.map(lt => { const cap = (lt === 'E' ? m.asdE : m.asdW) * ar.C; return (lt === 'E' ? 'E ' : 'W ') + f0(cap) + (v[lt] <= cap + 0.5 ? ' ≥ ' : ' < ') + f0(v[lt]); });
    const ok = lts.every(lt => v[lt] <= (lt === 'E' ? m.asdE : m.asdW) * ar.C + 0.5);
    const tag = i === strength ? (ok ? 'OK — lightest for strength' : 'heaviest, still NG') : i < strength ? 'NG' : 'raised for drift';
    rows.push([m.label, parts.join(', ') + ' plf → ' + tag + (i === used ? ' ← used' : '')]);
  }
  return rows;
}

// === C3. Overturning about each corner, per load case ===
// dir '→': shear toward the right, pivot = right corner, uplift at the left end.
// dir '←': pivot = left corner, uplift at the right end.
// Columns = load cases; rows = moments and the end force at the uplift end (own) and with loads from above.
export function cornerOverturningRows(w, dir) {
  const { gravity, lateral } = caseKeysOf(w);
  const cases = [...gravity, ...lateral];
  const L = w.length || 0;
  const arm = (w.steps && w.steps.arm) || L;
  const up = dir === '→' ? 'left' : 'right', piv = dir === '→' ? 'right' : 'left';
  const sgnDir = dir === '→' ? 1 : -1;
  const panel = w.method === 'wswh';
  const lv = w.live || { L: {}, Lr: {} };
  const Rof = { D: [w.dlRL || 0, w.dlRR || 0], L: [(lv.L && lv.L.rL) || 0, (lv.L && lv.L.rR) || 0], Lr: [(lv.Lr && lv.Lr.rL) || 0, (lv.Lr && lv.Lr.rR) || 0] };
  const Ptot = { D: w.dlTotal || 0, L: (lv.L && lv.L.total) || 0, Lr: (lv.Lr && lv.Lr.total) || 0 };
  // resisting moment of the gravity about the pivot: Σ P·(lever to the pivot), levers from the wall's left end x
  const MR = (c) => {
    if (panel) return (up === 'left' ? Rof[c][0] : Rof[c][1]) * arm; // concentric panel load: R = P/2
    let M = 0;
    for (const r of w.gravRows || []) { const P = (r.P && r.P[c]) || 0; M += P * (up === 'left' ? L - (r.x || 0) : (r.x || 0)); }
    if (c === 'D') M += (w.dlWallSelf || 0) * L / 2;
    return M;
  };
  const otm = (c) => { const k = c === 'E' ? 'otm1E' : 'otm1W'; return (w.steps && w.steps[k]) || 0; };
  const above = (key, side) => (w.injections || []).filter(s => s.side === side).reduce((a, s) => a + ((s.map && s.map[key]) || 0) * (LATERAL_CASES.some(([, k]) => k === key) ? sgnDir : 1), 0);
  const head = ['Row (' + dir + ' pivot = ' + piv + ' corner, uplift at the ' + up + ' end)', ...cases.map(([, k]) => k + (LATERAL_CASES.some(([, x]) => x === k) ? ' ' + dir : ''))];
  const row = (label, fn) => [label, ...cases.map(([c, k]) => fn(c, k))];
  const isLat = (c) => c === 'E' || c === 'W';
  const ownUp = (c) => (isLat(c) ? -otm(c) / arm : MR(c) / arm);
  const otmText = (c) => {
    const V = c === 'E' ? w.shareExact_1E : w.shareExact_1W;
    if (!panel) return f2(otm(c)) + ' = ' + f2(V) + ' × ' + f2(w.floorH);
    const x = w.wswh || {}, st = x.stacked && x.stacked[c];
    // S5: stack base — the moment used for the base anchor forces (heights in inches)
    if (x.role === 'stackedLower' && st && st.V2k != null) {
      return '(V₁·H₁ + V₂·(H₁ + d_fl + H₂)) / 12 = (' + f2(st.V1k) + ' × ' + f2(x.He) + ' + ' + f2(st.V2k) + ' × (' + f2(x.He) + ' + ' + f2(st.dfl) + ' + ' + f2(st.H2) + ')) / 12 = ' + f2(otm(c));
    }
    return 'V·H_e / 12 = ' + f2(V) + ' × ' + f2(x.He) + ' / 12 = ' + f2(otm(c));
  };
  const rows = [
    row('M_OT = V·h (k·ft)' + (panel ? ' — WSWH: V·H_e' + (w.wswh && w.wswh.role === 'stackedLower' ? ', stack base V₁·H₁ + V₂·(H₁ + d_fl + H₂)' : '') : ''), (c) => (isLat(c) ? otmText(c) : '0')),
    row('M_R = Σ P·lever about the ' + piv + ' corner (k·ft)' + (panel ? ' — WSWH: P/2 × B' : ''), (c) => (isLat(c) ? '0' : f2(MR(c)))),
    row('arm (ft)', () => f2(arm)),
    row('Own ' + up + '-end N = (M_R − M_OT) / arm (k)', (c) => sgn(ownUp(c))),
    row('Own ' + piv + '-end N = ΣP − N_' + up + ' (k)', (c) => sgn((isLat(c) ? 0 : Ptot[c]) - ownUp(c))),
    row('From above at the ' + up + ' end (k)', (c, k) => sgn(above(k, up))),
    row('From above at the ' + piv + ' end (k)', (c, k) => sgn(above(k, piv))),
    row('Total ' + up + '-end N (k)', (c, k) => sgn(ownUp(c) + above(k, up))),
    row('Total ' + piv + '-end N (k)', (c, k) => sgn((isLat(c) ? 0 : Ptot[c]) - ownUp(c) + above(k, piv))),
  ];
  return { headers: head, rows, values: Object.fromEntries(cases.map(([c, k]) => [k, { up: ownUp(c) + above(k, up), pivot: (isLat(c) ? 0 : Ptot[c]) - ownUp(c) + above(k, piv) }])) };
}

// === S0. M_R breakdown under C3: every gravity piece with its lever to each corner ===
// Right corner (→, uplift at the left end): lever L − x. Left corner (←): lever x. Σ = the C3 M_R values.
// A uniform piece acts at its centroid (exact for the moment). WSWH: concentric panel load, no table.
const pieceName = (r) => (r.shape === 'stack' ? r.label || 'WSWH panel above' : '#' + r.index + ' ' + (r.shape === 'point' ? 'Point' : r.shape === 'full' ? 'Uniform (full line)' : 'Uniform')
  + (r.shape === 'point' ? '' : ' ' + f2(r.a) + '–' + f2(r.b) + ' ft'));
export function resistingMomentRows(w) {
  const cs = caseKeysOf(w).gravity.map(([c]) => c);
  if (!cs.length) return null;
  if (w.method === 'wswh') return { note: 'WSWH: the panel load is concentric — M_R = P/2 × B about either corner (no lever table).' };
  const L = w.length || 0;
  const pieces = (w.gravRows || []).map(r => ({ label: pieceName(r), x: r.x || 0, P: r.P || {} }));
  if (w.dlWallSelf) pieces.push({ label: 'Wall self-weight', x: L / 2, P: { D: w.dlWallSelf } });
  if (!pieces.length) return null;
  const txt = (o) => cs.map(c => c + ' ' + f2(o[c] || 0)).join(' / ');
  const sum = { P: {}, right: {}, left: {} };
  cs.forEach(c => { sum.P[c] = 0; sum.right[c] = 0; sum.left[c] = 0; });
  const rows = pieces.map(p => {
    const mr = {}, ml = {};
    for (const c of cs) {
      const P = p.P[c] || 0;
      mr[c] = P * (L - p.x); ml[c] = P * p.x;
      sum.P[c] += P; sum.right[c] += mr[c]; sum.left[c] += ml[c];
    }
    return [p.label, f2(p.x), txt(p.P), f2(L - p.x), txt(mr), f2(p.x), txt(ml)];
  });
  rows.push({ cells: ['Σ = C3 M_R', '', txt(sum.P), '', txt(sum.right), '', txt(sum.left)], style: { fontWeight: '600' } });
  const u = cs.join(' / ');
  return {
    headers: ['Load piece', 'x (ft)', 'P ' + u + ' (k)', 'Lever to the right corner L − x (ft)', 'P·(L − x) ' + u + ' (k·ft) — pivot right (→)', 'Lever to the left corner x (ft)', 'P·x ' + u + ' (k·ft) — pivot left (←)'],
    rows, sum,
  };
}

// === S1. Transfer beam reactions by statics: every load with its lever to each support ===
// R_b = Σ P·(x − x_a)/(x_b − x_a), R_a = ΣP − R_b, per load case (+ = compression; lateral → direction).
const BEAM_CASES = ['1.0D', '1.0L', '1.0Lr', '1.0E', '1.0W'];
export function beamLeverTable(bt) {
  const sups = bt.supports || [];
  if (!bt.valid || sups.length !== 2) return null;
  const [sa, sb] = sups;
  const xa = sa.position, xb = sb.position, span = xb - xa;
  if (!(span > 0)) return null;
  const val = (m, k) => (m && m[k]) || 0;
  const keys = BEAM_CASES.filter(k => (bt.loads || []).some(l => Math.abs(val(l.map, k)) > 1e-9) || Math.abs(val(sa.perCombo, k)) + Math.abs(val(sb.perCombo, k)) > 1e-9);
  if (!keys.length) return null;
  const Rb = {}, Ra = {}, Psum = {};
  keys.forEach(k => { Rb[k] = 0; Psum[k] = 0; });
  const rows = (bt.loads || []).map(l => {
    const frac = (l.x - xa) / span;
    keys.forEach(k => { const P = val(l.map, k); Psum[k] += P; Rb[k] += P * frac; });
    return [l.label, f2(l.x), f2(l.x - xa), f2(xb - l.x), f3(frac), ...keys.map(k => sgn(val(l.map, k)))];
  });
  keys.forEach(k => { Ra[k] = Psum[k] - Rb[k]; });
  const bold = { fontWeight: '600' };
  const sLbl = (s, j) => bt.mark + (j === 0 ? ' L' : ' R') + ' at ' + f2(s.position) + ' ft';
  rows.push({ cells: ['ΣP', '', '', '', '', ...keys.map(k => sgn(Psum[k]))], style: bold });
  rows.push({ cells: ['R_{b} (' + sLbl(sb, 1) + ') = Σ P·(x − x_{a})/(x_{b} − x_{a})', '', '', '', '', ...keys.map(k => sgn(Rb[k]))], style: bold });
  rows.push({ cells: ['R_{a} (' + sLbl(sa, 0) + ') = ΣP − R_{b}', '', '', '', '', ...keys.map(k => sgn(Ra[k]))], style: bold });
  rows.push(['Tool R_{a} / R_{b}', '', '', '', '', ...keys.map(k => sgn(val(sa.perCombo, k)) + ' / ' + sgn(val(sb.perCombo, k)))]);
  return {
    headers: ['Load on ' + bt.mark, 'x (ft)', 'x − x_a (ft)', 'x_b − x (ft)', '(x − x_a)/(x_b − x_a)', ...keys.map(k => 'P ' + k + (k === '1.0E' || k === '1.0W' ? ' →' : '') + ' (k)')],
    rows, keys, Ra, Rb, xa, xb,
  };
}

// === S2. C7 deflection: each Eq. 4.3-1 term with its numbers substituted ===
// → : tension (holdown slip) at the left end, crushing at the right post; ← mirrored.
// ctx: { lineThickness, grade }
function crushingText(r) {
  if (!(r > 0)) return '0';
  if (r < 0.73) return '0.02 × r / 0.73 = 0.02 × ' + f4(r) + ' / 0.73';
  if (r <= 1.0) return '0.02 × (1 + (r − 0.73) / 0.27) = 0.02 × (1 + (' + f4(r) + ' − 0.73) / 0.27)';
  return '0.02 × 2r³ = 0.02 × 2 × ' + f4(r) + '³';
}
export function deflectionSubstitutionRows(w, ctx = {}) {
  const rows = [];
  const Fcperp = ctx.grade && ctx.grade.Fcperp;
  for (const [lt, d] of Object.entries(w.deflection || {})) {
    if (!d) continue;
    const name = lt === 'E' ? '1.0E' : 'α_s·W';
    if (!d.dirs) { rows.push([name, f3(d.delta) + ' in (' + (d.label || d.method || 'engine') + ')']); continue; }
    rows.push([name + ' inputs', 'v = ' + d.v + ' plf (1.0 level), h = ' + f2(d.h) + ' ft, b = ' + f2(d.b) + ' ft, E = ' + d.E + ' psi, A = ' + d.A + ' in² (smaller end post), G_a = ' + d.Ga + ' k/in; T = ' + d.T + ' lb, C = ' + d.C + ' lb (lateral only)']);
    const gov = d.dirs.reduce((a, b) => (b.delta > a.delta ? b : a));
    for (const g of d.dirs) {
      const right = g.dir === '→';
      const anc = right ? w.anchorageLeft : w.anchorageRight;
      const T = right ? d.T : d.C, C = right ? d.C : d.T;
      const cPost = right ? w.postRight : w.postLeft;
      const Ac = postArea(cPost, ctx.lineThickness || '4');
      const basis = deltaBasisLoad(anc);
      const p = name + ' ' + g.dir + ' ';
      rows.push([p + '8vh³/(EAb)', '8 × ' + d.v + ' × ' + f2(d.h) + '³ / (' + d.E + ' × ' + d.A + ' × ' + f2(d.b) + ') = ' + f4(g.t1) + ' in']);
      rows.push([p + 'vh/(1000·G_a)', d.v + ' × ' + f2(d.h) + ' / (1000 × ' + d.Ga + ') = ' + f4(g.t2) + ' in']);
      rows.push([p + 'Δ_HD slip (' + (right ? 'left' : 'right') + ' end)', anc && basis > 0
        ? 'δ·T / P_δ = ' + anc.delta + ' × ' + T + ' / ' + f0(basis) + ' = ' + f4(g.dHD) + ' in (' + anc.id + '; P_δ = ' + (HDUE_TABLE.some(h => h.id === anc.id) ? 'ASD cap' : 'ASD cap / 0.7') + ')'
        : '0 (no holdown / strap δ)']);
      rows.push([p + 'Δ_c crushing (' + (right ? 'right' : 'left') + ' post)', Ac > 0 && Fcperp > 0
        ? 'r = C / (A_c·F_c⊥) = ' + C + ' / (' + Ac + ' × ' + Fcperp + ') = ' + f4(g.r) + '; Δ_c = ' + crushingText(g.r) + ' = ' + f4(g.dC) + ' in'
        : '0 (no post area / F_c⊥)']);
      rows.push([p + 'h·Δa/b', f2(d.h) + ' × (' + f4(g.dHD) + ' + ' + f4(g.dC) + ') / ' + f2(d.b) + ' = ' + f4(g.t3) + ' in']);
      rows.push({ cells: [p + 'δ', f4(g.t1) + ' + ' + f4(g.t2) + ' + ' + f4(g.t3) + ' = ' + f3(g.delta) + ' in' + (g === gov ? ' ← governs (used for drift)' : '') + (w.onBeam ? ' — on a beam: support deflection not included' : '')], style: { fontWeight: g === gov ? '600' : null } });
    }
  }
  return rows;
}

// === S4. Where each "from above" value comes from ===
// Returns one row per source and load case with a nonzero value: { side, key, value, text, nav }.
// nav: { level, type, mark } (a wall's calc sheet) or { tab: 'loadpath' }.
const TYPE_NAME = { wall: 'Segmented', ftao: 'FTAO', wswh: 'WSWH' };
export function aboveSourceRefs(w, ln) {
  const out = [];
  const wallAt = {};
  for (const pl of (ln && ln.perLevel) || []) for (const x of pl.walls) wallAt[x.wallId] = { pl, w: x };
  const posts = {}; ((ln && ln.postPaths) || []).forEach(p => { posts[p.postId] = p; });
  const beams = {}; ((ln && ln.beamTransfers) || []).forEach(b => { beams[b.beamId] = b; });
  for (const s of w.injections || []) {
    let text, nav;
    const endWord = (e) => (e === 'left' ? 'left' : 'right');
    if (s.type === 'wall' && wallAt[s.id]) {
      const { pl, w: src } = wallAt[s.id];
      const end = s.end || (/ L$/.test(s.label || '') ? 'left' : 'right');
      text = src.mark + ' ' + endWord(end) + ' end — see ' + pl.levelName + ' → ' + TYPE_NAME[src.method] + ' → ' + src.mark + ', C4 ' + (end === 'left' ? 'Left' : 'Right') + ' total';
      nav = { level: pl.levelId, type: src.method, mark: src.mark };
    } else if (s.type === 'post') {
      const p = posts[s.id];
      text = (p ? p.mark : s.label) + ' base (Σ down the post) — see Load path → Posts' + (p ? ', ' + p.levelName : '');
      nav = { tab: 'loadpath' };
    } else if (s.type === 'beam') {
      const b = beams[s.id];
      text = (s.label || '') + ' support reaction — see Load path → Transfer beams → ' + (b ? b.mark : '') + ' lever table';
      nav = { tab: 'loadpath' };
    } else {
      text = (s.label || s.id) + ' — see Load path';
      nav = { tab: 'loadpath' };
    }
    for (const [, key] of [...GRAVITY_CASES, ...LATERAL_CASES]) {
      const v = s.map && s.map[key];
      if (!v || Math.abs(v) < 1e-9) continue;
      out.push({ side: s.side, key, value: v, text, nav, source: s });
    }
  }
  return out;
}

// === C4. End forces by load case: own | from above | total, both ends ===
// Returns { headers, rows, N: { 'key dir': { left, right } } } — lateral cases in both directions (← = mirror)
export function loadCaseEnds(w) {
  const { gravity, lateral } = caseKeysOf(w);
  const own = (key, side) => nOf(w.combos[key], side);
  const above = (key, side) => (w.injections || []).filter(s => s.side === side).reduce((a, s) => a + ((s.map && s.map[key]) || 0), 0);
  const N = {};
  const rows = [];
  const push = (label, key, s) => {
    const o = { left: s * own(key, 'left'), right: s * own(key, 'right') };
    const a = { left: s * above(key, 'left'), right: s * above(key, 'right') };
    const t = { left: o.left + a.left, right: o.right + a.right };
    N[label] = t;
    rows.push([label, sgn(o.left), sgn(a.left), sgn(t.left) + ' (' + tc(t.left) + ')', sgn(o.right), sgn(a.right), sgn(t.right) + ' (' + tc(t.right) + ')']);
  };
  for (const [, k] of gravity) push(k, k, 1);
  for (const [, k] of lateral) { push(k + ' →', k, 1); push(k + ' ←', k, -1); }
  return { headers: ['Load case (unfactored)', 'Left own', 'Left from above', 'Left total', 'Right own', 'Right from above', 'Right total'], rows, N };
}

// === C5. Governing combinations by superposition of the C4 totals, compared with the tool ===
// The tool forms every combination at each wall and adds them down the load path per combination
// (accumPerCombo); here the load-case totals are factored and added. Equal by linearity (G12); the difference
// is floating point only (end forces are unrounded since calc v12).
export function superpositionRows(w) {
  if (!w.combos) return [];
  const src = w.accumPerCombo || w.combos;
  const { N } = loadCaseEnds(w);
  const Nk = (label, side) => (N[label] ? N[label][side] : 0);
  const out = [];
  for (const [side, S] of [['left', 'L'], ['right', 'R']]) {
    for (const what of ['T', 'C']) {
      let best = null;
      for (const [k, c] of Object.entries(w.combos)) {
        if (c.group !== 'asd') continue;
        const v = nOf(src[k], side);
        const val = what === 'T' ? -v : v;
        if (val > 1e-9 && (!best || val > best.val)) best = { k, c, val, v };
      }
      if (!best) { out.push({ cells: [what + ' ' + S, '—', 'no ' + (what === 'T' ? 'uplift' : 'compression') + ' in any ASD combination', '', '0.00', '0.00', '0.00'] }); continue; }
      const f = best.c.f || {}, dir = best.k.endsWith('_neg') ? '←' : '→';
      const terms = [], parts = [];
      let sum = 0;
      const add = (fac, label, name) => {
        if (!(Math.abs(fac) > 1e-9) || !N[label]) return;
        const n = Nk(label, side); sum += fac * n;
        terms.push((+fac.toFixed(4)) + '·N_{' + name + '}'); parts.push((+fac.toFixed(4)) + ' × (' + f2(n) + ')');
      };
      add(f.d, '1.0D', 'D'); add(f.l, '1.0L', 'L'); add(f.lr, '1.0Lr', 'Lr');
      add(f.e, '1.0E ' + dir, 'E' + dir); add(f.w, '1.0W ' + dir, 'W' + dir);
      const sup = what === 'T' ? Math.max(0, -sum) : Math.max(0, sum);
      const tool = best.val;
      out.push({ cells: [what + ' ' + S, (best.c.lc || best.c.text || best.k) + ' ' + dir + ' (' + (best.c.ref || '') + ')', terms.join(' + ') + ' = ' + parts.join(' + ') + ' = ' + sgn(sum),
        what === 'T' ? 'T = max(0, −N)' : 'C = max(0, N)', f2(sup), f2(tool), f2(sup - tool)], diff: sup - tool });
    }
  }
  return out;
}
export const SUPERPOSITION_HEADERS = ['End', 'Governing ASD combination', 'N = Σ factor × load-case total (k)', 'Rule', 'Superposition (k)', 'Tool (k)', 'Difference (k)'];

// === C6. Hardware and post selection trace ===
function nextLighter(anc, floorSpan) {
  if (!anc) return null;
  const hd = HDUE_TABLE.findIndex(h => h.id === anc.id);
  if (hd >= 0) return hd > 0 ? HDUE_TABLE[hd - 1] : null;
  const tbl = MSTC_TABLE[String(floorSpan)] || MSTC_TABLE['16'];
  const i = tbl.findIndex(s => s.id === anc.id);
  return i > 0 ? tbl[i - 1] : null;
}
// ctx: { floorSpan, lineThickness, grade, wallIn }
export function hardwareTraceRows(w, ctx = {}) {
  if (w.method === 'wswh') return [];
  const dem = w.hwDemand || { tL: w.governingTensionLeft, tR: w.governingTensionRight, cL: w.governingComprLeft, cR: w.governingComprRight };
  const d = ctx.wallIn || {};
  const rows = [];
  for (const [side, S] of [['left', 'Left'], ['right', 'Right']]) {
    const a = side === 'left' ? w.anchorageLeft : w.anchorageRight;
    const T = side === 'left' ? dem.tL : dem.tR;
    const ov = side === 'left' ? d.anchorageLeftOverride : d.anchorageRightOverride;
    const kind = w.anchorageType === 'strap' ? 'MSTC strap (' + (ctx.floorSpan || '16') + '" floor span table)' : 'HDUE holdown';
    if (!a) { rows.push(['Anchorage ' + S, 'T = ' + f2(T) + ' k → OVER: no ' + kind + ' carries ' + f0(T * 1000) + ' lb']); continue; }
    const basis = w.anchorageBasis && w.anchorageBasis[side];
    const drift = !ov && basis && basis.basis === 'drift';
    const lighter = ov || drift ? null : nextLighter(a, ctx.floorSpan);
    rows.push(['Anchorage ' + S, 'T = ' + f2(T) + ' k = ' + f0(T * 1000) + ' lb → ' + a.id + (ov ? ' ✎ (override)' : '') + ' cap ' + a.cap + ' lb, D/C ' + f2(a.cap > 0 ? T * 1000 / a.cap : null)
      + (drift ? '; raised for drift (strength pick ' + (basis.strength || 'OVER') + ') — see the Drift tab, drift sizing steps'
        : lighter ? '; lighter ' + lighter.id + ' ' + lighter.cap + ' lb < ' + f0(T * 1000) + ' lb' : !ov ? '; lightest in the ' + kind + ' table' : '')]);
  }
  for (const [side, S] of [['left', 'Left'], ['right', 'Right']]) {
    const p = side === 'left' ? w.postLeft : w.postRight;
    const C = side === 'left' ? dem.cL : dem.cR;
    const a = side === 'left' ? w.anchorageLeft : w.anchorageRight;
    if (!p) { rows.push(['Post ' + S, 'C = ' + f2(C) + ' k → OVER: no post in the ' + (ctx.lineThickness || '4') + '" wall carries it']); continue; }
    const min = hdueMinPost(a, ctx.lineThickness || '4');
    rows.push(['Post ' + S, 'C = ' + f2(C) + ' k → ' + p.postLabel + ', cap ' + f2(p.capacityKips) + ' k, D/C ' + f2(p.capacityKips > 0 ? C / p.capacityKips : null) + (min ? '; anchorage minimum post ' + min.label : '')]);
  }
  // S3: the NDS 2018 column derivation is in the Hardware tab, not repeated here
  if (w.postLeft || w.postRight) {
    rows.push(['Post capacity (NDS 2018)', 'see Hardware tab → Post Compression Capacity' + (ctx.gradeLabel ? ' — ' + ctx.gradeLabel : '') + ', ' + (ctx.lineThickness || '4') + '" wall, floor height ' + f2(w.floorH) + ' ft']);
  }
  return rows;
}
