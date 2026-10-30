// Diaphragm Analysis — Phase 6: TD shear field, net field and every member force on it (pure, no DOM). Tension +.
//
// TD field: inside each TD that ran (OUTPUT), the skill's segment shears td_v_s1..s3, mapped back to the plan
// (× ySign; the TD frame keeps the plan axes). Net field: v_net = v_b + Σ v_TD (book: outside the TDs unchanged).
//
// Members: every line of the case — grids, band edges (outline / opening / notch edges), TD edges — in two families
// (case frame: s along the span, c across):
//   chord family (lines c = const, along s):  dN/ds = v_net(c+) − v_net(c−)
//   cross family (lines s = const, along c):  dN/dc = v_net(s+) − v_net(s−) − r_wall   (r_wall: tdMembers.wallR)
// A run is a stretch of the line with sheathing on at least one side. N starts at 0 at the run's low end (a free
// end) and must return to ~0 at its high end: the closure check (book Ex 3.3). Simpson's rule per piece is exact for
// the piecewise linear / quadratic shears; interior extremes (q changing sign) are found by bisection.
import { vAt, wallR } from './tdMembers.js';
import { lineParts } from './tdBasicShear.js';

const EPS = 1e-6, NUDGE = 1e-5;
// Member closure (user 2026-10-30): a run closes when |residual| ≤ the larger of a fixed force and a share of the run's
// largest |N| — the fixed floor lets a run with small forces pass, the share scales with large ones.
export const CLOSURE_REL = 0.01, CLOSURE_LB = 1;
export const closureTol = max => Math.max(CLOSURE_LB, CLOSURE_REL * Math.abs(max));
export const closes = r => Math.abs(r.residual) <= closureTol(r.max);
const uniq = a => [...new Set(a.filter(Number.isFinite).map(v => Math.round(v * 1e6) / 1e6))].sort((p, q) => p - q);

// TD shear fields of a case: [{ tdId, mark, rect, along, segs: [{ lo, hi, v }] }] (plan coordinates, plan sign)
export function tdFields(plan, cs, runs, frames) {
  const out = [];
  for (const r of runs) {
    if (r.caseId !== cs.id || r.terminal !== 'OUTPUT') continue;
    const t = plan.tds.find(x => x.id === r.tdId), f = frames.get(r.tdId);
    if (!t || !f) continue;
    const g = r.skill, o = r.outputs, ys = f.ySign, base = f.bottom.at;
    const P = y => base + ys * y;
    const W = g.td_span, y1 = g.td_y1, y2 = g.td_has_load2 ? g.td_y2 : y1;
    const segLocal = g.td_support === 'cantilever' ? [[0, W, o.td_v_s1], [y1, 0, o.td_v_s3]]
      : [[y1, W, o.td_v_s1], ...(g.td_has_load2 ? [[y2, y1, o.td_v_s2]] : []), [0, y2, o.td_v_s3]];
    const segs = segLocal.map(([a, b, v]) => { const p = P(a), q = P(b); return { lo: Math.min(p, q), hi: Math.max(p, q), v: ys * v }; });
    out.push({ tdId: t.id, mark: t.mark, rect: { x1: t.x1, x2: t.x2, y1: t.y1, y2: t.y2 }, along: f.spanAxis, segs,
      top: f.top ? f.top.name : null, bottom: f.bottom ? f.bottom.name : null });
  }
  return out;
}
export function vtdAt(fields, x, y) {
  let v = 0;
  for (const f of fields) {
    if (x <= f.rect.x1 || x >= f.rect.x2 || y <= f.rect.y1 || y >= f.rect.y2) continue;
    const p = f.along === 'x' ? x : y;
    const sg = f.segs.find(s => p > s.lo && p < s.hi);
    if (sg) v += sg.v;
  }
  return v;
}
// Net unit shear at (s, c) of the case, approached from sides (sSide / cSide: −1, 0, +1). null = no sheathing.
export function vNetAt(cs, fields, s, c, sSide = 0, cSide = 0) {
  const sp = s + sSide * NUDGE, cp = c + cSide * NUDGE;
  const vb = vAt(cs, s, cp, sSide > 0 ? '+' : sSide < 0 ? '-' : ''); // the section side explicitly (sectionAt snaps 1e-4)
  if (vb === null) return null;
  const [x, y] = cs.axis === 'x' ? [sp, cp] : [cp, sp];
  return vb + vtdAt(fields, x, y);
}

// Break coordinates of the case: along s (interval ends, TD edges / segment ends, grids) and across c
export function breaks(plan, cs, fields) {
  const S = [], C = [];
  for (const d of cs.diaphragms) {
    S.push(d.lo, d.hi); C.push(...d.across);
    for (const i of d.intervals) { S.push(i.a, i.b); for (const b of i.bands) C.push(b.lo, b.hi); }
  }
  const sx = cs.axis === 'x';
  for (const f of fields) {
    S.push(...(sx ? [f.rect.x1, f.rect.x2] : [f.rect.y1, f.rect.y2])); C.push(...(sx ? [f.rect.y1, f.rect.y2] : [f.rect.x1, f.rect.x2]));
    for (const g of f.segs) (f.along === cs.axis ? S : C).push(g.lo, g.hi);
  }
  for (const g of plan.grids) (g.axis === cs.axis ? S : C).push(g.at);
  for (const w of plan.walls) if (w.axis === cs.axis) C.push(w.from, w.to);
  const ext = [Math.min(...cs.diaphragms.map(d => d.lo)), Math.max(...cs.diaphragms.map(d => d.hi)),
    Math.min(...cs.diaphragms.map(d => d.across[0])), Math.max(...cs.diaphragms.map(d => d.across[1]))];
  return { S: uniq(S).filter(v => v >= ext[0] - EPS && v <= ext[1] + EPS), C: uniq(C).filter(v => v >= ext[2] - EPS && v <= ext[3] + EPS) };
}

// One member line. family 'chord' (c = at, along s) or 'cross' (s = at, along c).
function memberLine(plan, cs, fields, family, at, pts, gridId) {
  const q = (p, side) => {
    if (family === 'chord') {
      const up = vNetAt(cs, fields, p, at, side, 1), dn = vNetAt(cs, fields, p, at, side, -1);
      return up === null && dn === null ? null : (up || 0) - (dn || 0);
    }
    const hi = vNetAt(cs, fields, at, p, 1, side), lo = vNetAt(cs, fields, at, p, -1, side);
    return hi === null && lo === null ? null : (hi || 0) - (lo || 0) - wallR(cs, gridId, p + side * NUDGE);
  };
  // a wall line bridges a gap inside the outline (strut): q = 0 there and the run continues
  const g = family === 'cross' && gridId ? plan.gridById.get(gridId) : null;
  const bridged = g && plan.walls.some(w => w.gridId === gridId) ? lineParts(plan, cs, g) : [];
  const inBridge = m => bridged.some(([a, b]) => m > a && m < b);
  const runs = [];
  let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], h = b - a;
    if (h < EPS) continue;
    const m = (a + b) / 2;
    if (q(m, 0) === null) {
      if (cur && inBridge(m)) { cur.pieces.push({ a, b, Na: cur.N, qa: 0, qm: 0, qb: 0, strut: true }); cur.to = b; continue; }
      if (cur) { runs.push(cur); cur = null; }
      continue;
    }
    if (!cur) cur = { from: a, to: a, pieces: [], N: 0 };
    const qa = q(a, 1), qm = q(m, 0), qb = q(b, -1);
    cur.pieces.push({ a, b, Na: cur.N, qa, qm, qb });
    cur.N += h / 6 * (qa + 4 * qm + qb);
    cur.to = b;
  }
  if (cur) runs.push(cur);
  for (const r of runs) {
    r.residual = r.N;
    let mx = 0, at0 = r.from;
    const vals = [];
    for (const pc of r.pieces) {
      vals.push([pc.a, pc.Na]);
      // q is at most quadratic on a piece: extremes of N where q = 0 (bisection on 16 sub-steps)
      const qf = t => { const u = (t - pc.a) / (pc.b - pc.a); return pc.qa * (1 - u) * (1 - 2 * u) + 4 * pc.qm * u * (1 - u) + pc.qb * u * (2 * u - 1); };
      for (let k = 0; k < 16; k++) {
        let l = pc.a + (pc.b - pc.a) * k / 16, rr = pc.a + (pc.b - pc.a) * (k + 1) / 16;
        if (k) vals.push([l, nAt(pc, l)]); // N at the sub-steps too (a zero of q on a step)
        if (qf(l) * qf(rr) < 0) { for (let it = 0; it < 40; it++) { const md = (l + rr) / 2; if (qf(l) * qf(md) <= 0) rr = md; else l = md; } vals.push([(l + rr) / 2, nAt(pc, (l + rr) / 2)]); }
      }
    }
    vals.push([r.to, r.N]);
    for (const [p, n] of vals) if (Math.abs(n) > Math.abs(mx)) { mx = n; at0 = p; }
    r.max = mx; r.maxAt = at0; r.points = vals;
  }
  return runs;
}
// N inside a piece at p (Simpson on [a, p] with q from its quadratic through qa, qm, qb)
export function nAt(pc, p) {
  const h = pc.b - pc.a;
  const qf = t => { const u = (t - pc.a) / h; return pc.qa * (1 - u) * (1 - 2 * u) + 4 * pc.qm * u * (1 - u) + pc.qb * u * (2 * u - 1); };
  return pc.Na + (p - pc.a) / 6 * (qf(pc.a) + 4 * qf((pc.a + p) / 2) + qf(p));
}

// All members of a case: [{ family, at, name, gridId, runs }]
export function members(plan, cs, fields) {
  if (!cs.diaphragms.length) return [];
  const { S, C } = breaks(plan, cs, fields);
  const name = (axis, v) => { const g = plan.grids.find(x => x.axis === axis && Math.abs(x.at - v) < 1e-6); return g ? { name: g.name, id: g.id } : { name: axis + '=' + +v.toFixed(2), id: null }; };
  const crossAxis = cs.axis === 'x' ? 'y' : 'x';
  const out = [];
  for (const c of C) { const n = name(crossAxis, c); const runs = memberLine(plan, cs, fields, 'chord', c, S, n.id); if (runs.length) out.push({ family: 'chord', at: c, name: n.name, gridId: n.id, runs }); }
  for (const s of S) { const n = name(cs.axis, s); const runs = memberLine(plan, cs, fields, 'cross', s, C, n.id); if (runs.length) out.push({ family: 'cross', at: s, name: n.name, gridId: n.id, runs }); }
  return out;
}

// N on a member at p (null outside its runs)
export function memberN(m, p) {
  for (const r of m.runs) {
    if (p < r.from - 1e-4 || p > r.to + 1e-4) continue;
    if (Math.abs(p - r.to) < 1e-4) return r.N;
    const pc = r.pieces.find(x => p >= x.a - 1e-4 && p <= x.b + 1e-4);
    return pc ? nAt(pc, Math.min(Math.max(p, pc.a), pc.b)) : null;
  }
  return null;
}

// Phase 6 checks of a case: equilibrium, closure of every member run, the TD runs, the skill's TD edge-member forces
// against the integrator on the same lines (only where the line's run is exactly the TD span), the seismic flag.
// Closure per run: closes() above. Returns [{ caseId, code, ok, msg, warn? }].
export function netChecks(plan, cs, runs, frames) {
  const out = [];
  const tag = (cs.dir === 'y' ? '↕' : '↔') + ' ' + (cs.kind === 'E' ? 'E' : 'W');
  const total = cs.diaphragms.reduce((t, d) => t + d.load, 0) * cs.sigma, sum = cs.lines.reduce((t, l) => t + l.P, 0);
  out.push({ caseId: cs.id, code: 'equilibrium', ok: Math.abs(total - sum) <= Math.max(0.5, 1e-6 * Math.abs(total)),
    msg: `${tag}: load ${Math.round(total)} lb = Σ line forces ${Math.round(sum)} lb` });
  let n = 0;
  const open = [];
  for (const m of cs.members || []) for (const r of m.runs) {
    n++;
    if (!closes(r)) open.push(`${m.name} (${+r.from.toFixed(2)}–${+r.to.toFixed(2)}): ${Math.round(r.residual)} lb of max ${Math.round(Math.abs(r.max))}`);
  }
  out.push({ caseId: cs.id, code: 'closure', ok: !open.length, msg: `${tag}: ${n - open.length} of ${n} member runs close` + (open.length ? ' — open: ' + open.join('; ') : '') });
  for (const r of runs.filter(x => x.caseId === cs.id)) {
    const okRun = r.terminal === 'OUTPUT';
    out.push({ caseId: cs.id, code: 'td', ok: okRun, warn: r.terminal === 'NOT_RUN' || r.terminal.startsWith('ENGINEER_INPUT'),
      msg: `${tag}: TD ${r.mark} — ${okRun ? 'results; closure ' + (r.outputs.td_closure_rel * 100).toFixed(3) + ' %, aspect ' + r.outputs.td_aspect.toFixed(2) + (r.outputs.td_blocking_required ? ', blocking required' : '') : r.terminal}` });
    if (!okRun) continue;
    // skill edge members vs the integrator
    const f = frames.get(r.tdId), g = r.skill, o = r.outputs;
    const pos = y => f.bottom.at + f.ySign * y;
    const y0 = g.td_support === 'cantilever' ? g.td_y1 : 0; // a cantilever runs from its tip
    const lo = Math.min(pos(y0), pos(g.td_span)), hi = Math.max(pos(y0), pos(g.td_span));
    const fam = f.spanAxis === cs.axis ? 'chord' : 'cross'; // edges run along the TD span
    const diffs = [];
    let compared = 0;
    for (const [x, e] of [['x1', f.edgeX1], ['x2', f.edgeX2]]) {
      const m = (cs.members || []).find(q => q.family === fam && Math.abs(q.at - e) < 1e-6);
      const run = m && m.runs.find(q => Math.abs(q.from - lo) < 1e-4 && Math.abs(q.to - hi) < 1e-4);
      if (!run) continue;
      for (const [k, y] of [['b1', g.td_support === 'cantilever' ? 0 : g.td_y1], ['b2', g.td_support === 'cantilever' ? 0 : (g.td_has_load2 ? g.td_y2 : g.td_y1)]]) {
        const mine = memberN(m, pos(y)), skill = o[`td_N_${x}_${k}`];
        if (mine !== null) compared++;
        if (mine !== null && Math.abs(mine - skill) > Math.max(1, 0.005 * Math.abs(skill))) diffs.push(`${x} ${k}: integrator ${Math.round(mine)} / skill ${Math.round(skill)}`);
      }
    }
    out.push({ caseId: cs.id, code: 'td-edges', ok: !diffs.length, warn: !compared,
      msg: `${tag}: TD ${r.mark} edge members — ` + (!compared ? 'not compared (the edge lines continue past the TD)' : `skill = integrator (${compared} values)`) + (diffs.length ? ': ' + diffs.join('; ') : '') });
    if ((r.flags || []).some(fl => fl.id === 'W_SEISMIC_COLLECTOR_AMPLIFICATION'))
      out.push({ caseId: cs.id, code: 'seismic', ok: true, warn: true, msg: `${tag}: TD ${r.mark} — collector forces are unamplified; collector design must apply Ω₀ / the 25 % increase where required (ASCE 7 §12.10.2.1, §12.3.3.4).` });
  }
  return out;
}
