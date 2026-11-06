// Diaphragm Analysis — Phase 5: each drawn TD's skill inputs from the plan and the basic field, then the TD engine.
// Pure, no DOM. Geometry comes from tdFrame; per load case:
//   P (load at each load line, local x):
//     chord TD (load line along the span, e.g. Ex 4.1 B): P = N · side, N = the basic-field chord force where the
//       member enters the TD (tdMembers.chordForce: M/d of the cut band, or Vierendeel at an opening);
//     strut TD (load line across the span, e.g. Ex 3.4 line 1, Ex 4.2 B): P = the force of that wall-less line handed
//       into the TD in Phase 4 (equal split between TDs on one line). A load line with walls of an offset wall
//       line (Phase 7, Ex 3.3 B): P = its strut force at the TD edge (walls shared across the group, tdClosure.js).
//   td_vb_* : basic unit shear just inside each TD edge at the breakpoints;
//   td_vo_* : just outside each edge at both ends of each segment — void 0, sheathing its basic v, plus a shear wall
//             on that edge line (its reaction per foot: x1 edge + r, x2 edge − r).
//   An overhang above the top support mirrors local y (ySign −1): unit shears change sign; P does not.
//   td_vo of a segment whose outside shear is not straight between its ends (a wall or a sheathing edge ends inside
//   it — Ex 8.1 line 6, SW2 0–25 within TD4's C–E… segment) is the segment average of the exact profile, so the
//   engine's closure sees the true ∫ v_out (G5, 2026-11-02). The net field / members use the exact profile anyway.
// Engineer inputs (user decisions 2026-10-29): td_region_clear = true (the engineer drew the TD; plan checks reject
// an opening in it); td_cantilever_ok = the engineer's review of the listed cantilever limits (tdLimits.js);
// td_closure_tol = CLOSURE_TOL.
import { chordForce, crossForce, vAt, wallR } from './tdMembers.js';
import { runTd } from './tdCalc.js';
import { breakCoords, isSheathed } from './tdGeometry.js';
const r2 = v => Math.round(v * 100) / 100;

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
    if (out && type === 'chord') r = wallR(cs, (plan.grids.find(q => q.axis === cs.axis && Math.abs(q.at - e) < 1e-6) || {}).id, p, { noThrough: true });
    return ys * ((v || 0) + (e === e1 ? r : -r));
  };
  // loads
  const P = f.loads.map((l, i) => {
    let N = null, txt;
    if (type === 'chord' && l.side === 0) { // members from both edges (G1): P = N from the high edge − N from the low edge
      const rl = chordForce(cs, l.grid.at, e1, '-'), rh = chordForce(cs, l.grid.at, e2, '+');
      if (rl || rh) {
        const Pv = (rh ? rh.N : 0) - (rl ? rl.N : 0);
        how['td_P' + (i + 1)] = `line ${l.grid.name} from both sides: ${Math.round(rh ? rh.N : 0)} lb at the high edge (${rh ? rh.how : 'none'}) − ${Math.round(rl ? rl.N : 0)} lb at the low edge (${rl ? rl.how : 'none'})`;
        return Pv;
      }
    } else if (type === 'chord') {
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
      const tag = `strut ${l.grid.name}${ln && ln.group ? ' (offset wall line ' + ln.group + ')' : ''}`;
      if (ln && !ln.noWall && !ln.group) issues.push({ code: 'td-load-wall-line', warn: true, msg: `TD ${t.mark}: load line ${l.grid.name} has shear walls of its own wall line — they take its force. If a continuous strut connects it to another wall line (an offset line of resistance), ` + (plan.walls.some(w => w.gridId === l.grid.id && w.linked)
        ? 'add it on Setup → Shear wall link → Offset lines of resistance (e.g. lines D + E).' : 'give its walls on every grid one wall line name (e.g. B/C).') });
      if (l.side === 0) { // members from both edges (as G1 for a chord, user test 2026-11-03): P = N at the high edge − N at the low edge
        const rl = crossForce(cs, l.grid, e1, ranges), rh = crossForce(cs, l.grid, e2, ranges);
        if (rl || rh) {
          how['td_P' + (i + 1)] = `${tag} from both sides: ${Math.round(rh ? rh.N : 0)} lb at the high edge (${rh ? rh.how : 'none'}) − ${Math.round(rl ? rl.N : 0)} lb at the low edge (${rl ? rl.how : 'none'})`;
          return (rh ? rh.N : 0) - (rl ? rl.N : 0);
        }
      }
      const r = l.side === 0 ? null : crossForce(cs, l.grid, l.side > 0 ? e2 : e1, ranges);
      if (r) { N = r.N; txt = `${tag}: N = ${Math.round(N)} lb at the TD edge (${r.how}) × side`; }
    }
    if (N === null) { issues.push({ code: 'td-no-P', msg: `TD ${t.mark}: no member force found at load line ${l.grid.name}.` }); return 0; }
    how['td_P' + (i + 1)] = txt;
    return N * l.side;
  });
  // G2 (closure solver): a load line that is also a support of another TD takes a share of that TD's reaction
  f.loads.forEach((l, i) => {
    const dP = cs.tdAdjust && cs.tdAdjust.get(t.id + '|' + l.grid.id);
    if (!dP) return;
    P[i] = (P[i] || 0) + dP;
    how['td_P' + (i + 1)] = (how['td_P' + (i + 1)] || '') + `; + ${Math.round(dP)} lb from the reaction of the TD held by line ${l.grid.name} (closure solver)`;
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
  // breakpoints along the TD span (local y): where the outside profile may change
  const bc = breakCoords(plan)[f.spanAxis === 'x' ? 'xs' : 'ys'].map(p => ys * (p - base));
  const averaged = [], inexact = new Set(); // edges whose outside profile is not straight within a segment
  const outside = (yHi, yLo, e, name) => {
    const hi = sample(yHi, -1, e, 'out'), lo = sample(yLo, 1, e, 'out');
    const pts = [yLo, ...bc.filter(y => y > yLo + 1e-6 && y < yHi - 1e-6), yHi];
    const L = yHi - yLo;
    if (!(L > 1e-9)) return [hi, lo]; // a zero-length segment (a load on a support: superposed, these inputs unused)
    let area = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const m = (pts[i] + pts[i + 1]) / 2, v = sample(m, 0, e, 'out');
      area += v * (pts[i + 1] - pts[i]); // exact: linear pieces
      if (Math.abs(v - (lo + (hi - lo) * (m - yLo) / L)) > 1e-6 * Math.max(1, Math.abs(v))) inexact.add(name.split(' ')[1]);
    }
    if (Math.abs(area - (hi + lo) / 2 * L) <= 1e-6 * Math.max(1, Math.abs(area))) return [hi, lo];
    averaged.push(`${name}: ${+(hi).toFixed(2)} / ${+(lo).toFixed(2)} at the ends → ${+(area / L).toFixed(2)} plf average`);
    return [area / L, area / L];
  };
  for (const [x, e] of [['x1', e1], ['x2', e2]]) {
    for (const [k, b] of Object.entries(bp)) skill[`td_vb_${x}_${k}`] = b ? sample(b[0], b[1], e, 'in') : 0;
    if (!cant && !g.td_has_load2) skill[`td_vb_${x}_y2`] = skill[`td_vb_${x}_y1`];
    for (const [k, sg] of Object.entries(seg)) {
      const [vh, vl] = sg ? outside(sg[0], sg[1], e, `edge ${x} ${k}`) : [0, 0];
      skill[`td_vo_${x}_${k}_hi`] = vh;
      skill[`td_vo_${x}_${k}_lo`] = vl;
    }
  }
  if (averaged.length) how.td_vo_avg = 'outside shear not straight along the segment (a wall or sheathing edge ends inside it) — the engine gets the segment average: ' + averaged.join('; ');
  how.td_vb = 'basic unit shear just inside each TD edge' + (ys < 0 ? ' (sign changed: y mirrored)' : '');
  how.td_vo = 'just outside each edge: void 0, sheathing its basic v' + (type === 'chord' ? ', + a shear wall on the edge line (reaction per foot)' : '');
  return { type, skill, how, issues, inexactEdges: [...inexact], P: P.map(p => p || 0) };
}

// Superposed TD (user 2026-11-03: three or more load lines; 2026-11-04: a load on a support, a TD with an overhang
// carrying more than one load or a load short of the tip, overhangs at both ends). Everything a TD produces is linear
// in its loads, so the engine runs once per load line with that load alone and the basic / outside shears set to 0
// (the TD's own field; the basic field is added once, by the net field), and the runs are added: support forces Σ,
// unit shear on each stretch between the tips, supports and load lines Σ. One run, by where its load is (local y):
//   0 < y < W  'span'    — simple-span run: shear above / below the load, 0 on the overhangs;
//   y < 0      'bottom'  — cantilever run (skill frame, Ex 3.4): back span, then support → load; 0 from load to tip;
//   y > W      'top'     — the same run mirrored (y′ = W − y): shears change sign, top / bottom forces swap;
//   y = 0 / W  'support' — straight into that support, no TD shear.
// Net shear and every member force come from the tool's integration as for any TD. Proof: superposing the two loads
// of each book TD gives the direct 2-load run, the Ex 3.4 tip load gives the direct cantilever run, and loads on the
// overhangs match beam statics (tests/diaphragmAnalysisUser.test.mjs).
export const SUPERPOSE_FROM = 3;
export function runKind(y, W) { return y > 1e-6 && y < W - 1e-6 ? 'span' : y < -1e-6 ? 'bottom' : y > W + 1e-6 ? 'top' : 'support'; }
// TD unit shear of one run at local y = m (TD frame sign)
export function vRun(r, m, W) {
  const o = r.outputs;
  if (!o || r.skipped) return 0;
  if (r.kind === 'span') return m > W ? 0 : m > r.y ? o.td_v_s1 || 0 : m > 0 ? o.td_v_s3 || 0 : 0;
  if (r.kind === 'bottom') return m > W ? 0 : m > 0 ? o.td_v_s1 || 0 : m > r.y ? o.td_v_s3 || 0 : 0;
  if (r.kind === 'top') { const mm = W - m, yy = W - r.y; return -(mm > W ? 0 : mm > 0 ? o.td_v_s1 || 0 : mm > yy ? o.td_v_s3 || 0 : 0); }
  return 0;
}
function superpose(base, f, dv, eng, cont) {
  const g = f.geometry, W = g.td_span;
  const zero = Object.fromEntries(Object.keys(dv.skill).filter(k => /^td_v[bo]_/.test(k)).map(k => [k, 0]));
  const runs = f.loads.map((l, i) => {
    const P = dv.P[i] || 0, kind = runKind(l.y, W);
    const one = { grid: l.grid.name, y: l.y, side: l.side, P, kind };
    if (Math.abs(P) < 0.5) return { ...one, terminal: 'OUTPUT', skipped: true, outputs: { td_v_s1: 0, td_v_s3: 0, td_F_sup_top: 0, td_F_sup_bot: 0, td_closure_rel: 0 } };
    if (kind === 'support') { // S090 / S100 at y = 0 or W: the whole load to that support
      const atTop = l.y > W / 2;
      return { ...one, terminal: 'OUTPUT', outputs: { td_v_s1: 0, td_v_s3: 0, td_F_sup_top: atTop ? P : 0, td_F_sup_bot: atTop ? 0 : P, td_closure_rel: 0 } };
    }
    const y1 = kind === 'top' ? r2(W - l.y) : l.y;
    const skill = { ...dv.skill, ...zero, td_support: kind === 'span' ? 'simple' : 'cantilever', td_y1: y1, td_side1: l.side || 1, td_has_load2: false, td_y2: 0, td_side2: 1, td_P1: P, td_P2: 0 };
    let res;
    try { res = runTd(skill, eng); } catch (e) { return { ...one, terminal: 'ERROR', error: e.message }; }
    if (res.outputs && kind === 'top') { // back to the TD frame: top / bottom swap (forces keep their sign)
      const o = res.outputs;
      res.outputs = { ...o, td_F_sup_top: o.td_F_sup_bot, td_F_sup_bot: o.td_F_sup_top };
    }
    if (cont.length && res.outputs) { // as runTds: edges that carry on past the TD close on their line
      const own = ['x1', 'x2'].filter(x => !cont.some(c => c.edge === x)).map(x => Math.abs(res.outputs[`td_N_${x}_res`] || 0));
      res.outputs.td_closure_rel = Math.max(0, ...own) / Math.abs(P);
    }
    return { ...one, terminal: res.terminal, outputs: res.outputs, flags: res.flags, draft: res.draft };
  });
  const bad = runs.find(r => r.terminal !== 'OUTPUT');
  const issues = [...dv.issues];
  if (bad && bad.error) issues.push({ code: 'td-run', msg: `TD ${base.mark}: load line ${bad.grid}: ${bad.error}` });
  for (const r of runs) if (r.kind === 'support' && !r.skipped) issues.push({ code: 'td-load-on-support', warn: true,
    msg: `TD ${base.mark}: load line ${r.grid} is a support of the TD — its ${Math.round(Math.abs(r.P))} lb goes straight into that support (no TD shear).` });
  const ran = runs.filter(r => !r.skipped && r.outputs && r.kind !== 'support');
  const o1 = (ran[0] || {}).outputs || {};
  // stretches between the tips, the supports and the load lines (local y, top first), shear = Σ of the runs there
  const tips = f.tips || {};
  const Y = [...new Set([tips.top ?? W, W, ...f.loads.map(l => l.y), 0, tips.bottom ?? 0])].sort((a, b) => b - a);
  const segsLocal = [];
  for (let k = 0; k < Y.length - 1; k++) {
    const m = (Y[k] + Y[k + 1]) / 2;
    segsLocal.push([Y[k + 1], Y[k], runs.reduce((s, r) => s + vRun(r, m, W), 0)]);
  }
  const sum = k => runs.reduce((s, r) => s + ((r.outputs && r.outputs[k]) || 0), 0);
  const outputs = {
    td_F_sup_top: sum('td_F_sup_top'), td_F_sup_bot: sum('td_F_sup_bot'),
    td_closure_rel: Math.max(0, ...runs.map(r => (r.outputs && r.outputs.td_closure_rel) || 0)),
    td_aspect: o1.td_aspect ?? W / g.td_length, ar_max_unblocked: o1.ar_max_unblocked, ar_max_blocked: o1.ar_max_blocked, td_blocking_required: !!o1.td_blocking_required,
  };
  let terminal = bad ? bad.terminal : 'OUTPUT';
  if (!bad && outputs.td_closure_rel > CLOSURE_TOL) { terminal = 'HARD_STOP:E_TD_CLOSURE'; issues.push({ code: 'td-closure', msg: `TD ${base.mark}: a load-line run does not close (${(outputs.td_closure_rel * 100).toFixed(1)} %).` }); }
  if (cont.length) for (const c of cont) issues.push({ code: 'td-edge-continues', warn: true, msg: `TD ${base.mark}: edge ${c.edge} (line ${c.line}) carries on past ${c.past}; closure checked on the whole line (Checks).` });
  const flags = [...new Map(ran.flatMap(r => r.flags || []).map(fl => [fl.id, fl])).values()];
  return { ...base, type: dv.type, skill: dv.skill, how: dv.how, P: dv.P, issues, continues: cont, inexactEdges: [], terminal, flags, outputs, segsLocal,
    superposed: { runs: runs.map(r => ({ grid: r.grid, y: r.y, side: r.side, P: r.P, kind: r.kind, terminal: r.terminal, skipped: !!r.skipped,
      v_above: r.outputs ? vRun(r, r.y + 1e-3, W) : null, v_below: r.outputs ? vRun(r, r.y - 1e-3, W) : null, F_top: r.outputs ? r.outputs.td_F_sup_top : null, F_bot: r.outputs ? r.outputs.td_F_sup_bot : null })) },
    draft: ran.some(r => r.draft) };
}

// Edges of a simple-span TD whose line carries on past the TD (sheathing beside the line just beyond an end of the
// TD; Ex 8.1 TD2's right edge, line 5, goes on above B along the opening to A). Such an edge cannot close between
// the TD's supports: its end force goes on along the line, whose closure check (tdNet, Checks) decides (G6, user
// 2026-11-02). Returns [{ edge: 'x1' | 'x2', line, past }].
export function continuingEdges(plan, t, f) {
  if (!f || !f.ok || f.geometry.td_support !== 'simple') return [];
  const along = f.spanAxis, cross = along === 'x' ? 'y' : 'x';
  const [lo, hi] = along === 'x' ? [t.x1, t.x2] : [t.y1, t.y2];
  const at = (p, c) => (along === 'x' ? [p, c] : [c, p]);
  const out = [];
  for (const [edge, e] of [['x1', f.edgeX1], ['x2', f.edgeX2]]) {
    for (const [p, end] of [[lo - 0.05, 'lo'], [hi + 0.05, 'hi']]) {
      if (![e - 0.05, e + 0.05].some(c => isSheathed(plan, ...at(p, c)))) continue;
      const line = plan.grids.find(g => g.axis === cross && Math.abs(g.at - e) < 1e-6);
      const sup = t.supports.filter(Boolean).sort((a, b) => a.at - b.at)[end === 'lo' ? 0 : 1];
      out.push({ edge, line: line ? line.name : cross + ' = ' + e, past: sup ? sup.name : end });
      break;
    }
  }
  return out;
}

// Derive and run every TD of the case. inputsTds: the stored TDs (engineer review); f: tdFrame per TD id.
export function runTds(plan, cs, frames, inputsTds, opts) {
  return plan.tds.filter(t => t.dir === cs.dir).map(t => {
    const f = frames.get(t.id);
    const base = { tdId: t.id, mark: t.mark, caseId: cs.id };
    if (t.auto && !t.loads.length) return { ...base, terminal: 'NOT_RUN', issues: [{ code: 'td-no-load', warn: true, msg: `TD ${t.mark}: no load line found on the plan — it carries nothing.` }] };
    if (!f || !f.ok) return { ...base, terminal: 'NOT_RUN', issues: [{ code: 'td-geometry', msg: `TD ${t.mark}: ${(f && f.issues.join('; ')) || 'geometry incomplete'}.` }] };
    const dv = deriveTd(plan, cs, t, f, opts);
    if (dv.P.every(p => Math.abs(p) < 0.5))
      return { ...base, type: dv.type, skill: dv.skill, how: dv.how, terminal: 'NOT_RUN', issues: [...dv.issues, { code: 'td-no-load', warn: true,
        msg: `TD ${t.mark}: no disrupted force at its load line(s) on the basic field${dv.issues.some(i => i.code === 'td-load-wall-line') ? ' — the line\'s own walls take it' : ''}.` }] };
    const raw = (inputsTds || []).find(x => x.id === t.id) || {};
    const ok = raw.engineer ? raw.engineer.cantileverOk : null;
    // an edge that carries on past the TD is closed on its whole line: the engine's closure tolerance (an engineer
    // input) is opened and the remaining edges are checked here against CLOSURE_TOL
    const cont = continuingEdges(plan, t, f);
    const eng = { td_region_clear: true, td_closure_tol: cont.length ? 1e9 : CLOSURE_TOL, ...(ok === true || ok === false ? { td_cantilever_ok: ok } : {}) };
    // the engine runs directly for one or two loads between the supports, or one load at the tip of a single overhang
    // (Ex 3.4); anything else is superposed (any number of loads anywhere from tip to tip, user 2026-11-04)
    const g = f.geometry, tips = f.tips || {};
    const from = (opts && opts.superposeFrom) || SUPERPOSE_FROM; // tests: 1 = superpose every TD
    const direct = f.loads.length < from && (g.td_support === 'simple'
      ? f.loads.every(l => runKind(l.y, g.td_span) === 'span')
      : tips.top === null && tips.bottom !== null && f.loads.length === 1 && Math.abs(f.loads[0].y - tips.bottom) < 0.01);
    if (!direct) return superpose(base, f, dv, { ...eng, td_closure_tol: 1e9 }, cont);
    let res;
    try { res = runTd(dv.skill, eng); } catch (e) { return { ...base, ...dv, terminal: 'ERROR', issues: [...dv.issues, { code: 'td-run', msg: `TD ${t.mark}: ${e.message}` }] }; }
    const issues = [...dv.issues];
    let terminal = res.terminal;
    if (cont.length && res.outputs) {
      const Psum = Math.abs(dv.skill.td_P1) + Math.abs(dv.skill.td_P2);
      const own = ['x1', 'x2'].filter(x => !cont.some(c => c.edge === x)).map(x => Math.abs(res.outputs[`td_N_${x}_res`] || 0));
      res.outputs.td_closure_rel = Psum > 0 ? Math.max(0, ...own) / Psum : 0;
      for (const c of cont) issues.push({ code: 'td-edge-continues', warn: true,
        msg: `TD ${t.mark}: edge ${c.edge} (line ${c.line}) carries on past ${c.past} — its ${Math.round(res.outputs[`td_N_${c.edge}_res`] || 0)} lb goes on along line ${c.line}; closure checked on the whole line (Checks).` });
      if (res.outputs.td_closure_rel > CLOSURE_TOL) { terminal = 'HARD_STOP:E_TD_CLOSURE'; issues.push({ code: 'td-closure', msg: `TD ${t.mark}: an edge that ends at the TD does not close (${(res.outputs.td_closure_rel * 100).toFixed(1)} %).` }); }
    }
    return { ...base, type: dv.type, skill: dv.skill, how: dv.how, issues, continues: cont, inexactEdges: dv.inexactEdges, terminal, flags: res.flags, outputs: res.outputs, draft: res.draft };
  });
}
