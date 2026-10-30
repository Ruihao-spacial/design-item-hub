// Diaphragm Analysis — Phase 5: each drawn TD's skill inputs from the plan and the basic field, then the TD engine.
// Pure, no DOM. Geometry comes from tdFrame; per load case:
//   P (load at each load line, local x):
//     chord TD (load line along the span, e.g. Ex 4.1 B): P = N · side, N = the basic-field chord force where the
//       member enters the TD (tdMembers.chordForce: M/d of the cut band, or Vierendeel at an opening);
//     strut TD (load line across the span, e.g. Ex 3.4 line 1, Ex 4.2 B): P = the force of that wall-less line handed
//       into the TD in Phase 4 (equal split between TDs on one line). A load line with walls of an offset wall
//       line (Phase 7, Ex 3.3 B): P = its strut force at the TD edge (walls shared across the group, tdOffset.js).
//   td_vb_* : basic unit shear just inside each TD edge at the breakpoints;
//   td_vo_* : just outside each edge at both ends of each segment — void 0, sheathing its basic v, plus a shear wall
//             on that edge line (its reaction per foot: x1 edge + r, x2 edge − r).
//   An overhang above the top support mirrors local y (ySign −1): unit shears change sign; P does not.
// Engineer inputs (user decisions 2026-10-29): td_region_clear = true (the engineer drew the TD; plan checks reject
// an opening in it); td_cantilever_ok = the engineer's review of the listed cantilever limits (tdLimits.js);
// td_closure_tol = CLOSURE_TOL.
import { chordForce, crossForce, vAt, wallR } from './tdMembers.js';
import { runTd } from './tdCalc.js';

export const CLOSURE_TOL = 0.01; // relative to |P1| + |P2|; the book's residuals are far below (Ex 4.3: ~0.07 %)
const D = 1e-3; // ft, nudge into a segment / across an edge

export function deriveTd(plan, cs, t, f, opts = {}) {
  const issues = [], how = {};
  const g = f.geometry;
  const type = f.spanAxis === cs.axis ? 'strut' : 'chord';
  const ys = f.ySign, base = f.bottom.at;
  const pos = y => base + ys * y; // local y → plan coordinate along the TD span
  const [e1, e2] = [f.edgeX1, f.edgeX2];
  // unit shear (local sign) at local y (nudged by dir), at edge e, inside / outside the TD
  const sample = (y, dir, e, where) => {
    const p = pos(y + dir * D);
    const out = where === 'out';
    let v;
    if (type === 'chord') v = vAt(cs, e, p, (e === e1) !== out ? '+' : '-');
    else v = vAt(cs, p, e + ((e === e1) !== out ? D : -D), '');
    let r = 0;
    if (out && type === 'chord') r = wallR(cs, (plan.grids.find(q => q.axis === cs.axis && Math.abs(q.at - e) < 1e-6) || {}).id, p);
    return ys * ((v || 0) + (e === e1 ? r : -r));
  };
  // loads
  const P = f.loads.map((l, i) => {
    let N = null, txt;
    if (type === 'chord') {
      const r = chordForce(cs, l.grid.at, l.side > 0 ? e2 : e1, l.side > 0 ? '+' : '-');
      if (r) { N = r.N; txt = `chord ${l.grid.name}: N = ${Math.round(N)} lb at the TD edge (${r.how}) × side ${l.side > 0 ? '+1' : '−1'}`; }
    } else {
      const ln = cs.lines.find(x => x.gridId === l.grid.id);
      if (ln && ln.into && ln.into.includes(t.mark)) {
        const Pv = ln.handed / ln.into.length;
        how['td_P' + (i + 1)] = `line ${l.grid.name} has no wall: its force ${Math.round(ln.handed * cs.sigma)} lb goes into ${ln.into.join(', ')}${ln.into.length > 1 ? ' (equal split)' : ''}`;
        return Pv;
      }
      const ranges = plan.tds.filter(q => q.dir === cs.dir && q.loads.some(m => m.grid && m.grid.id === l.grid.id)).map(q => (l.grid.axis === 'x' ? [q.y1, q.y2] : [q.x1, q.x2]));
      const r = crossForce(cs, l.grid, l.side > 0 ? e2 : e1, ranges);
      if (r) { N = r.N; txt = `strut ${l.grid.name}${ln && ln.group ? ' (offset wall line ' + ln.group + ')' : ''}: N = ${Math.round(N)} lb at the TD edge (${r.how}) × side`; }
      if (ln && !ln.noWall && !ln.group) issues.push({ code: 'td-load-wall-line', warn: true, msg: `TD ${t.mark}: load line ${l.grid.name} has shear walls of its own wall line — they take its force. For an offset line of resistance give its walls on every grid one wall line name (e.g. B/C).` });
    }
    if (N === null) { issues.push({ code: 'td-no-P', msg: `TD ${t.mark}: no member force found at load line ${l.grid.name}.` }); return 0; }
    how['td_P' + (i + 1)] = txt;
    return N * l.side;
  });
  const skill = {
    code_edition: opts.codeEdition || 'CBC-2025', design_basis: opts.designBasis || 'ASD', load_type: cs.kind === 'E' ? 'seismic' : 'wind',
    diaph_sheathing_type: opts.sheathing || 'wsp', td_blocked: opts.blocked !== false,
    ...g, td_P1: P[0] || 0, td_P2: g.td_has_load2 ? P[1] || 0 : 0,
  };
  // breakpoints (local y, nudge into the segment) and segments [hi, lo]
  const cant = g.td_support === 'cantilever';
  const W = g.td_span, y1 = g.td_y1, y2 = g.td_has_load2 ? g.td_y2 : y1;
  const bp = cant ? { top: [W, -1], bot: [0, 1], y1: [y1, 1], y2: null } : { top: [W, -1], y1: [y1, 1], y2: [y2, 1], bot: [0, 1] };
  const seg = cant ? { s1: [W, 0], s2: null, s3: [0, y1] } : { s1: [W, y1], s2: g.td_has_load2 ? [y1, y2] : null, s3: [y2, 0] };
  for (const [x, e] of [['x1', e1], ['x2', e2]]) {
    for (const [k, b] of Object.entries(bp)) skill[`td_vb_${x}_${k}`] = b ? sample(b[0], b[1], e, 'in') : 0;
    if (!cant && !g.td_has_load2) skill[`td_vb_${x}_y2`] = skill[`td_vb_${x}_y1`];
    for (const [k, sg] of Object.entries(seg)) {
      skill[`td_vo_${x}_${k}_hi`] = sg ? sample(sg[0], -1, e, 'out') : 0;
      skill[`td_vo_${x}_${k}_lo`] = sg ? sample(sg[1], 1, e, 'out') : 0;
    }
  }
  how.td_vb = 'basic unit shear just inside each TD edge' + (ys < 0 ? ' (sign changed: y mirrored)' : '');
  how.td_vo = 'just outside each edge: void 0, sheathing its basic v' + (type === 'chord' ? ', + a shear wall on the edge line (reaction per foot)' : '');
  return { type, skill, how, issues };
}

// Derive and run every TD of the case. inputsTds: the stored TDs (engineer review); f: tdFrame per TD id.
export function runTds(plan, cs, frames, inputsTds, opts) {
  return plan.tds.filter(t => t.dir === cs.dir).map(t => {
    const f = frames.get(t.id);
    const base = { tdId: t.id, mark: t.mark, caseId: cs.id };
    if (!f || !f.ok) return { ...base, terminal: 'NOT_RUN', issues: [{ code: 'td-geometry', msg: `TD ${t.mark}: ${(f && f.issues.join('; ')) || 'geometry incomplete'}.` }] };
    const dv = deriveTd(plan, cs, t, f, opts);
    if (Math.abs(dv.skill.td_P1) < 0.5 && Math.abs(dv.skill.td_P2) < 0.5)
      return { ...base, type: dv.type, skill: dv.skill, how: dv.how, terminal: 'NOT_RUN', issues: [...dv.issues, { code: 'td-no-load', warn: true,
        msg: `TD ${t.mark}: no disrupted force at its load line(s) on the basic field${dv.issues.some(i => i.code === 'td-load-wall-line') ? ' — the line\'s own walls take it' : ''}.` }] };
    const raw = (inputsTds || []).find(x => x.id === t.id) || {};
    const ok = raw.engineer ? raw.engineer.cantileverOk : null;
    const eng = { td_region_clear: true, td_closure_tol: CLOSURE_TOL, ...(ok === true || ok === false ? { td_cantilever_ok: ok } : {}) };
    let res;
    try { res = runTd(dv.skill, eng); } catch (e) { return { ...base, ...dv, terminal: 'ERROR', issues: [...dv.issues, { code: 'td-run', msg: `TD ${t.mark}: ${e.message}` }] }; }
    return { ...base, type: dv.type, skill: dv.skill, how: dv.how, issues: dv.issues, terminal: res.terminal, flags: res.flags, outputs: res.outputs, draft: res.draft };
  });
}
