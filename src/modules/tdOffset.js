// Diaphragm Analysis — Phase 7: offset wall lines, line forces iterated to closure (pure, no DOM).
//
// An offset line of resistance (walls with one wall line name on several grids, tdBasicShear.lineGroups) shares its
// force by wall length across its grids, so the wall on one grid can take more than the diaphragm delivers there; the
// difference runs along that grid as a strut into a TD (book Ex 3.3: SW1 on B → strut B → TD1). The TD hands it to its
// supports, which changes what those lines must carry — so the split between lines is not known in advance (book: the
// equal split wL/2 leaves ~387 lb at the end of lines A and C; its 400 lb trial shift nearly closes).
// User decision 2026-10-30: iterate to closure. Pass 0 = the flexible line forces (Phase 4), group force = Σ of its
// grids. Each pass: wall shares → TDs (P from the strut forces) → net field → members; then every wall line moves by
// its closure residual (a cross member run on the line ends at N = residual; F ← F − residual, plan sign), a group by
// the Σ of its grids. Stops when every run on a wall line closes (tdNet.closes). Linear in the forces, so it converges
// geometrically (Ex 3.3: factor ~0.08 per pass).
import { lineGroups, shareGroup, wallShares } from './tdBasicShear.js';
import { tdFields, members, closes } from './tdNet.js';

export const MAX_PASSES = 25;
const EPS = 1e-6;

// runCase(cs) → the TD runs of the case with its current line forces. opts.start: { lineOrGroupName: P (load-direction
// sign) } replaces pass 0's forces; opts.maxPasses (0 = evaluate the start only, e.g. the book's equal split).
// Sets cs.fields / cs.members / cs.lines; returns { tdRuns, offset } or null when the case has no offset line.
export function offsetIterate(plan, cs, runCase, opts = {}) {
  const groups = lineGroups(plan, cs);
  if (!groups.length) return null;
  const maxPasses = opts.maxPasses ?? MAX_PASSES;
  const inGroup = id => groups.find(g => g.gridIds.includes(id));
  const lineOf = id => cs.lines.find(l => l.gridId === id);
  const start = opts.start || {};
  let gF = groups.map(g => (g.name in start ? start[g.name] * cs.sigma : g.gridIds.reduce((t, id) => t + ((lineOf(id) || {}).F || 0), 0)));
  for (const ln of cs.lines) if (!inGroup(ln.gridId) && ln.name in start) setLine(plan, cs, ln,start[ln.name] * cs.sigma);
  const passes = [];
  let tdRuns = [], converged = false;
  for (let pass = 0; ; pass++) {
    groups.forEach((g, i) => shareGroup(plan, cs, g, gF[i]));
    tdRuns = runCase(cs);
    cs.fields = tdFields(plan, cs, tdRuns, opts.frames);
    cs.members = members(plan, cs, cs.fields);
    // closure residual of every run on a wall line
    const res = new Map();
    let open = 0, maxRes = 0;
    for (const m of cs.members) {
      const ln = m.family === 'cross' && m.gridId && lineOf(m.gridId);
      if (!ln || !(ln.walls || []).length) continue;
      for (const r of m.runs) {
        const e = res.get(ln.gridId) || { total: 0, runs: [] };
        e.total += r.residual; e.runs.push(r); res.set(ln.gridId, e);
        if (!closes(r)) open++;
        maxRes = Math.max(maxRes, Math.abs(r.residual));
      }
    }
    passes.push({
      pass, maxRes, open,
      lines: [...groups.map((g, i) => ({ name: g.name, P: gF[i] * cs.sigma, group: true })),
        ...cs.lines.filter(l => !inGroup(l.gridId) && (l.walls || []).length).map(l => ({ name: l.name, P: l.P }))],
      tdP: tdRuns.map(r => ({ mark: r.mark, P: r.skill ? r.skill.td_P1 + (r.skill.td_P2 || 0) : null, terminal: r.terminal })),
    });
    if (!open) { converged = true; break; }
    if (pass >= maxPasses) break;
    // move each wall line by its residual; a group by the Σ of its grids
    groups.forEach((g, i) => { gF[i] -= g.gridIds.reduce((t, id) => t + ((res.get(id) || {}).total || 0), 0); });
    for (const ln of cs.lines) {
      const e = res.get(ln.gridId);
      if (!e || inGroup(ln.gridId)) continue;
      for (const r of e.runs) {
        const mid = (r.from + r.to) / 2;
        const p = (ln.parts || []).find(q => mid > q.lo - EPS && mid < q.hi + EPS) || (ln.parts || [])[0];
        if (p) p.F -= r.residual;
      }
      setLine(plan, cs, ln, (ln.parts || []).length ? ln.parts.reduce((t, p) => t + p.F, 0) : ln.F - e.total);
    }
  }
  return {
    tdRuns,
    offset: { groups: groups.map((g, i) => ({ name: g.name, grids: g.gridIds.map(id => plan.gridById.get(id).name), P: gF[i] * cs.sigma,
      walls: g.walls.map(w => w.mark) })), passes, converged, maxPasses },
  };
}

// A line (not in a group) set to force F (plan sign): its parts scaled to it, walls re-shared on the line's own basis
function setLine(plan, cs, ln, F) {
  const old = (ln.parts || []).reduce((t, p) => t + p.F, 0);
  for (const p of ln.parts || []) { p.F = Math.abs(old) > EPS ? p.F * F / old : F / ln.parts.length; p.P = p.F * cs.sigma; }
  ln.F = F; ln.P = F * cs.sigma;
  ln.walls = wallShares(plan, ln, ln.weights || null);
}
