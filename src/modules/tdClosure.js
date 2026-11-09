// Diaphragm Analysis — general closure solver (replaces the Phase 7 offset iteration; user decision 2026-11-02).
//
// Some hand-over forces are not known until the TDs have run, because a TD hands part of its load back into a line
// whose force itself loads the TD (book: "iterate until closure of all force diagrams", Ch 8.4 p3, p11):
//   group     an offset wall line (one wall line name on ≥ 2 grids, Ex 3.3 B/C, Ch 8.4 D/E): its total force; the
//             walls share it by length, so a wall can take more than the diaphragm delivers there (strut into a TD);
//   line      every other wall-line part: its force (a TD reaction on a wall line changes it);
//   collector a wall-less collector handing a concentrated load into a diaphragm spanning across it (G7, Ch 8.4 B →
//             Diaphragm 5): the extra force from TD reactions on it; the receiving basic field is recomputed (G9);
//   td        a TD load line that is also a support of another TD (G2, Ex 8.1 collector B with TD2's reaction): the
//             share each loaded TD takes of that reaction.
// Each unknown starts at the flexible value (0 = Phase 4–6 result). Every member run must end at N = 0, so the solver
// takes all run residuals as equations and moves the unknowns together by Gauss–Newton (finite-difference Jacobian,
// a tiny ridge so a force closure cannot fix — e.g. the equal split of Ch 8.4 A.2 — stays where it started). The
// statics are linear, so one step closes a consistent model; the passes are kept as a table.
import { lineGroups, shareGroup, groupForce, wallShares, basicCase, loadCases, aboveLoads } from './tdBasicShear.js';
import { tdFields, members, closes } from './tdNet.js';

export const MAX_PASSES = 8;
const H = 10; // lb, finite-difference step (linear statics: exact)
const EQ_WEIGHT = 1e3; // weight of the equilibrium equation against the member-run residuals
// The solver's own stop: a run is closed when its residual is ~0. The user tolerance (tdNet.closes, 30 lb / 5 %) is
// only the pass / fail limit of the checks — stopping there would leave e.g. Ex 3.3 at the flexible start (193 lb).
const exact = r => Math.abs(r.residual) <= Math.max(0.01, 1e-6 * Math.abs(r.max));

// runCase(cs) → TD runs with the case's current line forces. opts: frames; lc (load case, else found by cs.id);
// start { lineOrGroupName: P (load-direction sign) } replaces the flexible start of a group / wall line;
// maxPasses (0 = evaluate the start only). Sets cs.diaphragms / lines / fields / members; returns null when the case has
// nothing to solve, else { tdRuns, offset: { groups, unknowns, passes, converged, maxPasses } }.
export function closeCase(plan, cs, runCase, opts = {}) {
  const groups = lineGroups(plan, cs);
  const collectors = cs.lines.filter(l => l.intoDiaphragm);
  // G2: a TD reaction on a line that loads two or more other TDs (Ex 8.1: TD2 on collector B between TD1 and TD3)
  // splits between them — one unknown per loaded TD. With a single loaded TD the member rule stands (Ex 8.1 line D:
  // TD2 takes the cut chord by the G4 rule; closure does not fix that constant).
  const tdLoads = [];
  const caseTds = plan.tds.filter(x => x.dir === cs.dir);
  for (const t of caseTds) for (const l of t.loads) {
    if (!l.grid) continue;
    const held = caseTds.filter(o => o !== t && o.supports.some(g => g && g.id === l.grid.id));
    const loaded = caseTds.filter(o => o.loads.some(m => m.grid && m.grid.id === l.grid.id) && !held.includes(o));
    if (held.length && loaded.length >= 2) tdLoads.push({ tdId: t.id, mark: t.mark, gridId: l.grid.id, line: l.grid.name, from: held.map(o => o.mark) });
  }
  if (!groups.length && !collectors.length && !tdLoads.length) return null;
  const maxPasses = opts.maxPasses ?? MAX_PASSES;
  const lc = opts.lc || (collectors.length ? loadCases(plan).find(x => x.id === cs.id) : null);
  const weights = new Map(cs.lines.map(l => [l.gridId, l.weights || null]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const base = { diaphragms: cs.diaphragms, lines: clone(cs.lines.map(l => ({ ...l, walls: undefined }))) };
  const inGroup = id => groups.some(g => g.gridIds.includes(id));

  // unknowns
  const U = [];
  groups.forEach(g => U.push({ kind: 'group', key: g.name, label: g.name + ' (offset line)', g }));
  for (const ln of base.lines) {
    if (ln.noWall || inGroup(ln.gridId) || !plan.walls.some(w => w.gridId === ln.gridId)) continue;
    const parts = (ln.parts || []).length ? ln.parts : [null];
    parts.forEach((p, i) => {
      if (p && !plan.walls.some(w => w.gridId === ln.gridId && w.to > p.lo + 1e-6 && w.from < p.hi - 1e-6)) return;
      U.push({ kind: 'line', key: ln.name + (parts.length > 1 ? ' ' + (+p.lo.toFixed(2)) + '–' + (+p.hi.toFixed(2)) : ''), gridId: ln.gridId, part: i,
        label: 'line ' + ln.name + (parts.length > 1 ? ' (' + (+p.lo.toFixed(2)) + '–' + (+p.hi.toFixed(2)) + ')' : '') });
    });
  }
  // group grids may hold parts outside the group (G8): those parts are wall lines of their own
  for (const g of groups) for (const id of g.gridIds) {
    const ln = base.lines.find(l => l.gridId === id);
    for (const [i, p] of ((ln && ln.parts) || []).entries()) {
      if (g.walls.some(w => w.gridId === id && w.to > p.lo + 1e-6 && w.from < p.hi - 1e-6)) continue;
      if (!plan.walls.some(w => w.gridId === id && w.to > p.lo + 1e-6 && w.from < p.hi - 1e-6)) continue;
      U.push({ kind: 'line', key: ln.name + ' ' + (+p.lo.toFixed(2)) + '–' + (+p.hi.toFixed(2)), gridId: id, part: i,
        label: 'line ' + ln.name + ' (' + (+p.lo.toFixed(2)) + '–' + (+p.hi.toFixed(2)) + ')' });
    }
  }
  collectors.forEach(l => U.push({ kind: 'collector', key: l.name, gridId: l.gridId, label: 'collector ' + l.name + ' → ' + l.into.join(', ') }));
  tdLoads.forEach(x => U.push({ kind: 'td', key: x.mark + '@' + x.line, ...x, label: x.mark + ' at ' + x.line + ' (holds ' + x.from.join(', ') + ')' }));

  // start: flexible (0), or the given forces
  const start = opts.start || {};
  const u = U.map(x => {
    if (x.kind === 'group' && x.key in start) return start[x.key] * cs.sigma - groupForce(plan, { ...base, lines: clone(base.lines) }, x.g);
    if (x.kind === 'line') {
      const ln = base.lines.find(l => l.gridId === x.gridId);
      if (!(ln.name in start)) return 0;
      const p = (ln.parts || [])[x.part];
      const F = start[ln.name] * cs.sigma;
      return p ? (Math.abs(ln.F) > 1e-6 ? p.F * F / ln.F : F / ln.parts.length) - p.F : F - ln.F;
    }
    return 0;
  });

  let state = null;
  function evaluate(u) {
    if (collectors.length && lc) {
      const delta = new Map(U.map((x, i) => [x, i]).filter(([x]) => x.kind === 'collector').map(([x, i]) => [x.gridId, u[i]]));
      const { c, lf } = basicCase(plan, lc, { q: cs.q ?? null, above: aboveLoads(cs) }, delta);
      cs.diaphragms = c.diaphragms;
      cs.lines = lf.lines;
    } else { cs.diaphragms = base.diaphragms; cs.lines = clone(base.lines); }
    for (const ln of cs.lines) ln.weights = weights.get(ln.gridId) || null;
    U.forEach((x, i) => {
      if (x.kind !== 'line') return;
      const ln = cs.lines.find(l => l.gridId === x.gridId);
      if (!ln) return;
      const p = (ln.parts || [])[x.part];
      if (p) { p.F += u[i]; p.P = p.F * cs.sigma; }
      ln.F += u[i]; ln.P = ln.F * cs.sigma;
    });
    for (const ln of cs.lines) if (!inGroup(ln.gridId)) ln.walls = wallShares(plan, ln, ln.weights);
    const gF = [];
    U.forEach((x, i) => { if (x.kind === 'group') { const F = groupForce(plan, cs, x.g) + u[i]; gF.push(F); shareGroup(plan, cs, x.g, F, (opts.groupBasis && opts.groupBasis[x.g.name]) || null); } });
    cs.tdAdjust = new Map(U.map((x, i) => [x, i]).filter(([x]) => x.kind === 'td').map(([x, i]) => [x.tdId + '|' + x.gridId, u[i]]));
    const tdRuns = runCase(cs);
    cs.fields = tdFields(plan, cs, tdRuns, opts.frames);
    cs.members = members(plan, cs, cs.fields);
    const r = [];
    let open = 0, notExact = 0, maxRes = 0;
    for (const m of cs.members) for (const run of m.runs) {
      r.push(run.residual);
      if (!closes(run)) open++;
      if (!exact(run)) notExact++;
      maxRes = Math.max(maxRes, Math.abs(run.residual));
    }
    // equilibrium is an equation too (user test 2026-11-03): Σ line forces = the load. A consistent model satisfies it
    // already (every book case), so it moves nothing there; a model that cannot close no longer drifts off balance.
    const eq = cs.lines.reduce((t, l) => t + l.P, 0) - cs.diaphragms.reduce((t, d) => t + d.load, 0) * cs.sigma;
    r.push(EQ_WEIGHT * eq);
    if (Math.abs(eq) > 0.01) notExact++;
    return state = { r, open, notExact, maxRes, tdRuns, gF, eq };
  }

  const passes = [];
  let converged = false;
  for (let pass = 0; ; pass++) {
    const E = evaluate(u);
    passes.push({
      pass, maxRes: E.maxRes, open: E.open,
      lines: [...groups.map((g, i) => ({ name: g.name, P: E.gF[i] * cs.sigma, group: true })),
        ...cs.lines.filter(l => !inGroup(l.gridId) && (l.walls || []).length).map(l => ({ name: l.name, P: l.P })),
        ...cs.lines.filter(l => l.intoDiaphragm).map(l => ({ name: l.name + ' → ' + l.into.join(', '), P: l.handedTotal * cs.sigma, collector: true }))],
      tdP: E.tdRuns.map(t => ({ mark: t.mark, P: t.P ? t.P.reduce((s, p) => s + p, 0) : t.skill ? t.skill.td_P1 + (t.skill.td_P2 || 0) : null, terminal: t.terminal })),
      unknowns: u.slice(),
    });
    if (!E.notExact) break;
    if (pass >= maxPasses) break;
    if (pass > 0 && E.maxRes > passes[pass - 1].maxRes * (1 - 1e-6)) break; // no further progress
    // Jacobian by finite differences, then (JᵀJ + ridge) Δ = −Jᵀ r
    const n = U.length, m = E.r.length;
    const J = U.map((_, j) => { const up = u.slice(); up[j] += H; const Ej = evaluate(up); return Ej.r.map((v, k) => (v - E.r[k]) / H); });
    const A = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => { let t = 0; for (let k = 0; k < m; k++) t += J[a][k] * J[b][k]; return t; }));
    const g = J.map(col => { let t = 0; for (let k = 0; k < m; k++) t -= col[k] * E.r[k]; return t; });
    // ridge scaled by the member-run rows only (the weighted equilibrium row would inflate it and slow the step)
    const dmax = Math.max(1e-12, ...J.map(col => { let t = 0; for (let k = 0; k < m - 1; k++) t += col[k] * col[k]; return t; }));
    A.forEach((row, a) => { row[a] += 1e-9 * dmax; });
    const d = solve(A, g);
    if (!d) break;
    d.forEach((v, j) => { u[j] += v; });
  }
  // leave the case at the last evaluated pass
  if (passes.length && passes[passes.length - 1].unknowns.some((v, i) => v !== u[i])) evaluate(passes[passes.length - 1].unknowns);
  const last = passes[passes.length - 1];
  converged = last.open === 0; // every run within the closure tolerance (the checks' limit)
  return {
    tdRuns: state.tdRuns,
    offset: {
      groups: groups.map((g, i) => ({ name: g.name, grids: g.gridIds.map(id => plan.gridById.get(id).name), P: state.gF[i] * cs.sigma, walls: g.walls.map(w => w.mark),
        basis: (opts.groupBasis && opts.groupBasis[g.name] && opts.groupBasis[g.name].method) || 'length' })),
      unknowns: U.map((x, i) => ({ kind: x.kind, label: x.label, value: last.unknowns[i] * (x.kind === 'td' ? 1 : cs.sigma) })),
      passes, converged, maxPasses,
    },
  };
}

// Gaussian elimination with partial pivoting; null if singular
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let t = M[r][n]; for (let k = r + 1; k < n; k++) t -= M[r][k] * x[k]; x[r] = t / M[r][r]; }
  return x;
}
