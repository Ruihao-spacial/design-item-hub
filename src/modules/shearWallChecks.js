// Built-in equilibrium checks (gatekeepers) of one wall line result — G1–G12.
// They prove that shear, gravity and overturning balance at every step. Applied loads are rebuilt from the
// definition (levelLoads, gravity rows, wall DL types × area), not taken from calc intermediates.
// Sign convention: N = signed vertical force at an end / post base / beam support (kips), + = compression,
// N = C − T. Load cases 1.0D, 1.0L, 1.0Lr, 1.0E (ρ = 1), 1.0W. Equilibrium (G6–G9) is checked on the load
// cases; G12 proves every combination is the factored sum of the load cases (superposition), so the
// combinations balance too. Forces the load path audit already explains (unsupported ends, reaction-only
// supports, gravity with nothing below) are listed as excluded, not as failures.
import { gravityRows } from './shearWallGravity.js';
import { hasOpenings, wallMethod, sortedOpenings, openingProblems } from './shearWallOpenings.js';
import { isWswh, wswhWidthFt } from './shearWallWswh.js';
import { NAILING_TABLE } from './shearWallNailing.js';
import { hdueMinPost, meetsMinPost } from './shearWallHardware.js';
import { lcRef } from './shearWallCombos.js';

const CASES = ['D', 'L', 'Lr'];
const CASE_KEY = { D: '1.0D', L: '1.0L', Lr: '1.0Lr', E: '1.0E', W: '1.0W' };
const EXCLUDED = ['none', 'wall_mid', 'reported'];
const num = (v) => parseFloat(v) || 0;
const r4 = (v) => Math.round(v * 10000) / 10000;
const tolOf = (expected, abs = 0.02, rel = 0.001) => Math.max(abs, rel * Math.abs(expected));
const nOf = (c, side) => (c ? (side === 'left' ? (c.comprLeft || 0) - (c.tensionLeft || 0) : (c.comprRight || 0) - (c.tensionRight || 0)) : 0);

export const CHECK_DEFS = [
  { id: 'G1', title: 'Story shear build-up', intent: 'The story shear used equals the lateral inputs',
    rule: 'V_x,i = Σ F_j over the levels at and above level i', vars: 'F_j = lateral load entered at level j (k); V_x,i = story shear used at level i (k)' },
  { id: 'G2', title: 'Horizontal equilibrium', intent: 'No shear is lost or created in the distribution',
    rule: 'Σ V_w over the walls at level i = V_x,i', vars: 'V_w = 1.0-level shear share of wall w (k)' },
  { id: 'G3', title: 'Distribution rule', intent: 'The shares follow the chosen method',
    rule: 'Capacity: V_w = V_x·wt_w/Σwt, wt_w = v_cap,w × L_w. Deflection: every wall with a share has δ_w(V_w) = δ* (±0.5 %), ΣV_w = V_x; a wall with no share has δ_w(0) ≥ δ*',
    vars: 'v_cap,w = ASD unit shear capacity incl. h/b factor (plf); L_w = wall length (ft); δ_w(V) = SDPWS Eq. 4.3-1 of wall w at share V with its end forces (own + from above) (in); δ* = story deflection (in)' },
  { id: 'G4', title: 'Gravity reconciliation', intent: 'Every gravity load is accounted for (per level, D / L / Lr)',
    rule: 'P_applied = P_walls + P_beams + P_posts + P_noted',
    vars: 'P_applied = Σ load rows + wall self-weight; P_walls / P_beams / P_posts = gravity taken by walls, transfer beams, post tops; P_noted = loads listed as not carried (k)' },
  { id: 'G5', title: 'Wall statics', intent: "Each wall's end reactions balance its gravity loads",
    rule: 'R_L + R_R = ΣP and R_R·L = ΣP·x̄', vars: 'P = load piece on the wall (k); x̄ = its centroid from the wall left end (ft); L = wall length (ft); R_L, R_R = end reactions (k)' },
  { id: 'G6', title: 'Wall end equilibrium (load cases)', intent: 'End forces balance the loads and the overturning moment',
    rule: 'N_L + N_R = ΣP_case;  (N_R − R_R,case)·arm = OTM_case',
    vars: 'N_L, N_R = wall end forces (k, + = compression); arm = lever arm (L; WSWH: B); OTM_case = V_w·h for 1.0E / 1.0W (WSWH: H_e; stack base: V₁H₁ + V₂(H₁ + d_fl + H₂)), 0 for D / L / Lr' },
  { id: 'G7', title: 'Transfer conservation (load cases)', intent: 'Nothing is lost between elements',
    rule: 'Delivered N = received N; beam R_a + R_b = ΣP and R_b(x_b − x_a) = ΣP(x − x_a); post base = Σ sources; accumulated end = own + from above',
    vars: 'P = load on the beam at x (k); x_a, x_b = support positions (ft); R_a, R_b = support reactions (k)' },
  { id: 'G8', title: 'Global vertical equilibrium (load cases)', intent: 'The line balances top to bottom',
    rule: 'Σ N_base + Σ N_excluded = Σ P_applied (all levels); 1.0E / 1.0W: = 0',
    vars: 'N_base = forces landing on the foundation (k); N_excluded = forces the audit lists as not carried (unsupported / mid-wall ends, reaction-only supports, gravity with nothing below)' },
  { id: 'G9', title: 'Global overturning (1.0E / 1.0W)', intent: 'The base moment equals the applied lateral loads × heights',
    rule: 'Σ N_base·x (+ excluded) = Σ (Σ V_w at story i)·h_i', vars: 'x = position from the line left end (ft); V_w = wall shares at story i (k); h_i = floor-to-floor height of story i (ft). WSWH panels use H_e and arm B: that difference is listed' },
  { id: 'G10', title: 'Envelope and hardware', intent: 'Design demands are the true governing values and every part carries them',
    rule: 'T_gov = max over ASD combos (accumulated); cap ≥ demand for holdowns / straps / posts; post ≥ anchorage minimum post (HDUE by size, MSTC (2)2x); OVER (nothing in the catalog carries the demand) = NG',
    vars: 'T_gov, C_gov = governing ASD tension / compression at an end (k)' },
  { id: 'G11', title: 'Sheathing', intent: 'The sheathing check reproduces and the auto nailing is the lightest that passes',
    rule: 'v = 0.7ρV_w/L (E) or 0.6V_w/L (W); D/C = v / (v_cap × C_hb)',
    vars: 'v = ASD unit shear (plf); ρ = redundancy of the direction; C_hb = 1.25 − 0.125·h/b when h/b > 2, else 1.0' },
  { id: 'G12', title: 'Superposition', intent: 'Every combination is the factored sum of the load cases (so G6–G8 cover every combo)',
    rule: 'N_combo = d·N_D + l·N_L + lr·N_Lr ± (e·N_E + w·N_W)', vars: 'd, l, lr, e, w = factors of the combination; ± = direction of the lateral load (→ / ←)' },
];

function newCheck(id) {
  const def = CHECK_DEFS.find(d => d.id === id);
  return { ...def, status: 'na', rows: [], notes: [], passCount: 0, failCount: 0 };
}
// A numeric comparison row
function compare(chk, where, expected, actual, opt = {}) {
  const tol = opt.tol != null ? opt.tol : tolOf(expected, opt.abs, opt.rel);
  const diff = actual - expected;
  const ok = isFinite(diff) && Math.abs(diff) <= tol + 1e-9;
  chk.rows.push({ where, case: opt.case || '', expected: r4(expected), actual: r4(actual), diff: r4(diff), tol: r4(tol), unit: opt.unit || 'k', status: ok ? 'pass' : 'fail', detail: opt.detail || '' });
  settle(chk, ok);
}
// A yes / no row (text values)
function assertRow(chk, where, ok, expected, actual, opt = {}) {
  chk.rows.push({ where, case: opt.case || '', expected, actual, diff: '', tol: '', unit: '', status: ok ? 'pass' : 'fail', detail: opt.detail || '' });
  settle(chk, ok);
}
function settle(chk, ok) {
  if (ok) chk.passCount++; else chk.failCount++;
  chk.status = chk.failCount ? 'fail' : 'pass';
}

// ctx: { inputs, levels, rho (direction) }
export function lineChecks(line, res, ctx) {
  const { inputs, levels } = ctx;
  const rho = num(ctx.rho) || 1;
  const loadType = inputs.loadType || 'seismic';
  const seismic = loadType === 'seismic' || loadType === 'both';
  const wind = loadType === 'wind' || loadType === 'both';
  const lats = [seismic && 'E', wind && 'W'].filter(Boolean);
  const walls = res.perLevel.flatMap(pl => pl.walls.map(w => ({ w, pl })));
  const byId = {};
  walls.forEach(({ w }) => { byId[w.wallId] = w; });
  const sample = walls.find(({ w }) => w.combos);
  const comboKeys = sample ? Object.keys(sample.w.combos) : [];
  const caseKeys = Object.entries(CASE_KEY).filter(([, k]) => comboKeys.includes(k));
  const levelIdx = {};
  levels.forEach((l, i) => { levelIdx[l.id] = i; });
  const floorH = (id) => num((levels.find(l => l.id === id) || {}).floorToFloor);
  const defWalls = line.walls || [];
  const notes = (res.loadPathAudit && res.loadPathAudit.notes) || [];

  // Story shears from the inputs (top → bottom)
  const Vx = {};
  { let e = 0, w = 0; for (const l of levels) { const x = (line.levelLoads || {})[l.id] || {}; e += num(x.seismic); w += num(x.wind); Vx[l.id] = { E: e, W: w }; } }

  const out = [];

  // G1
  const g1 = newCheck('G1');
  for (const pl of res.perLevel) {
    if (seismic) compare(g1, pl.levelName, Vx[pl.levelId].E, pl.storyShear_1E, { case: '1.0E' });
    if (wind) compare(g1, pl.levelName, Vx[pl.levelId].W, pl.storyShear_1W, { case: '1.0W' });
  }
  out.push(g1);

  // G2
  const g2 = newCheck('G2');
  for (const pl of res.perLevel) {
    for (const lt of lats) {
      const V = Vx[pl.levelId][lt];
      if (!(V > 0) && !pl.walls.length) continue;
      const sum = pl.walls.reduce((a, w) => a + ((lt === 'E' ? w.shareExact_1E : w.shareExact_1W) || 0), 0);
      compare(g2, pl.levelName, V, sum, { case: CASE_KEY[lt], detail: pl.walls.length ? pl.walls.length + ' wall(s)' : 'no wall at this level carries the story shear' });
    }
  }
  out.push(g2);

  // G3
  const g3 = newCheck('G3');
  const dist = res.distribution || { method: 'capacity' };
  if (dist.method === 'deflection') {
    // Equal δ: every wall with a share deflects the story δ (Eq. 4.3-1 at its share); a wall with no share is already
    // rotated at least that much by the forces from above; Σ shares = story shear
    for (const l of dist.levels || []) {
      const pl = res.perLevel.find(p => p.levelId === l.levelId);
      if (!pl) continue;
      const sum = l.walls.reduce((a, w) => a + w.share, 0);
      compare(g3, l.levelName + ' Σ shares', l.V, sum, { case: CASE_KEY[l.loadType], detail: 'Σ V_w = V_x' });
      for (const lw of l.walls) {
        const w = pl.walls.find(x => x.wallId === lw.wallId);
        const V = (l.loadType === 'E' ? w.shareExact_1E : w.shareExact_1W) || 0, k = w.stiffness && w.stiffness[l.loadType];
        if (lw.zeroShare) {
          assertRow(g3, w.mark + ' (' + l.levelName + ')', lw.delta0 >= l.delta - 1e-4, 'δ(0) ≥ ' + l.delta.toFixed(4) + ' in', lw.delta0.toFixed(4) + ' in',
            { case: CASE_KEY[l.loadType], detail: 'zero share: rotated by the forces from above more than the story deflects' });
        } else if (V > 0 && k > 0) {
          compare(g3, w.mark + ' (' + l.levelName + ')', l.delta, V * 1000 / k, { tol: Math.max(0.0005, 0.005 * l.delta), unit: 'in', case: CASE_KEY[l.loadType],
            detail: 'δ at its share = story δ (±0.5 %)' });
        }
      }
    }
    if (!dist.converged) g3.notes.push('Deflection distribution: shares still moved ' + dist.shareChange + ' k after ' + dist.passes + ' passes (limit ' + dist.shareTolerance + ' k); the closest pass is used and flagged on the line.');
    for (const n of dist.noted || []) g3.notes.push(n.mark + ' (' + n.levelName + '): ' + (n.zeroShare ? 'takes no story shear — δ at zero own share ' + n.delta0.toFixed(3) + ' in ≥ story δ ' + n.storyDelta.toFixed(3) + ' in; see the distribution warnings (holdown check, walls carrying more than designed).'
      : 'δ(0)/δ* = ' + n.fromAboveRatio.toFixed(2) + ' > ' + dist.fromAboveLimit + ' — most of its deflection comes from the forces of the walls above; a larger holdown / strap reduces it.'));
    if (dist.note) g3.notes.push(dist.note);
  } else {
    for (const pl of res.perLevel) {
      for (const lt of lats) {
        const tot = pl.walls.reduce((a, w) => a + ((w.capWeight || {})[lt] || 0), 0);
        if (!(tot > 0)) continue;
        const V = lt === 'E' ? pl.storyShear_1E : pl.storyShear_1W;
        for (const w of pl.walls) {
          const wt = (w.capWeight || {})[lt] || 0;
          compare(g3, w.mark + ' (' + pl.levelName + ')', V * wt / tot, (lt === 'E' ? w.shareExact_1E : w.shareExact_1W) || 0,
            { case: CASE_KEY[lt], detail: 'V ' + V + ' × ' + wt + ' / ' + r4(tot) });
        }
      }
    }
  }
  if (g3.status === 'na' && g3.notes.length) g3.status = 'note';
  out.push(g3);

  // G4 — gravity reconciliation per level and case
  const g4 = newCheck('G4');
  const applied = { D: 0, L: 0, Lr: 0 };
  const dlType = (id) => (inputs.wallDLTypes || []).find(t => t.id === id);
  for (const [li, lvl] of levels.entries()) {
    const rows = gravityRows((line.gravityLoads || {})[lvl.id], line.totalLength);
    const h = floorH(lvl.id);
    const lvlWalls = res.perLevel.find(p => p.levelId === lvl.id) || { walls: [] };
    const app = { D: 0, L: 0, Lr: 0 };
    for (const u of rows.uniform) for (const c of CASES) app[c] += u[c] * (u.x1 - u.x0) / 1000;
    for (const p of rows.point) for (const c of CASES) app[c] += p[c];
    // wall self-weight from the definition
    for (const w of defWalls.filter(x => x.levelId === lvl.id)) {
      const t = dlType(w.wallDLTypeId);
      if (!t) continue;
      const psf = num(t.psf);
      const L = isWswh(w) ? wswhWidthFt(w) : num(w.length);
      let area = L * h;
      // FTAO walls: no wall weight where the openings are (segmented walls are solid)
      const ignored = walls.some(({ w: r }) => r.wallId === w.id && r.openingsIgnored);
      if (!isWswh(w) && hasOpenings(w) && wallMethod(w) === 'ftao' && !ignored && !openingProblems(w, h).length) {
        for (const o of sortedOpenings(w)) area -= o.width * (o.head - o.sill);
      }
      app.D += psf * area / 1000;
    }
    const car = { walls: { D: 0, L: 0, Lr: 0 }, beams: { D: 0, L: 0, Lr: 0 }, posts: { D: 0, L: 0, Lr: 0 }, noted: { D: 0, L: 0, Lr: 0 } };
    for (const w of lvlWalls.walls) {
      const up = (w.wswh && w.wswh.fromAbove) || { D: 0, L: 0, Lr: 0 };
      car.walls.D += (w.dlTotal || 0) - up.D;
      car.walls.L += ((w.live && w.live.L && w.live.L.total) || 0) - up.L;
      car.walls.Lr += ((w.live && w.live.Lr && w.live.Lr.total) || 0) - up.Lr;
    }
    const beamLvl = li > 0 ? levels[li - 1].id : null;
    for (const bt of res.beamTransfers || []) {
      if (bt.levelId !== beamLvl) continue;
      for (const ld of bt.loads || []) if (ld.sourceType === 'gravity' && ld.gravity) for (const c of CASES) car.beams[c] += ld.gravity[c] || 0;
    }
    for (const pp of res.postPaths || []) {
      if (pp.levelId !== lvl.id) continue;
      for (const s of pp.sources || []) if (s.type === 'gravity' && s.gravity) for (const c of CASES) car.posts[c] += s.gravity[c] || 0;
    }
    for (const n of notes) if (n.type === 'gravity_unsupported' && n.levelId === lvl.id && n.g) for (const c of CASES) car.noted[c] += n.g[c] || 0;
    for (const c of CASES) {
      applied[c] += app[c];
      const got = car.walls[c] + car.beams[c] + car.posts[c] + car.noted[c];
      if (!(Math.abs(app[c]) > 1e-9) && !(Math.abs(got) > 1e-9)) continue;
      compare(g4, lvl.name, app[c], got, { case: c, detail: 'walls ' + r4(car.walls[c]) + ' + beams ' + r4(car.beams[c]) + ' + posts ' + r4(car.posts[c]) + ' + noted ' + r4(car.noted[c]) });
    }
  }
  out.push(g4);

  // G5 — wall statics per case
  const g5 = newCheck('G5');
  for (const { w, pl } of walls) {
    const L = w.length || 0;
    const lv = w.live || { L: {}, Lr: {} };
    const tot = { D: w.dlTotal || 0, L: (lv.L && lv.L.total) || 0, Lr: (lv.Lr && lv.Lr.total) || 0 };
    const rl = { D: w.dlRL || 0, L: (lv.L && lv.L.rL) || 0, Lr: (lv.Lr && lv.Lr.rL) || 0 };
    const rr = { D: w.dlRR || 0, L: (lv.L && lv.L.rR) || 0, Lr: (lv.Lr && lv.Lr.rR) || 0 };
    const where = w.mark + ' (' + pl.levelName + ')';
    for (const c of CASES) {
      if (!(Math.abs(tot[c]) > 1e-9)) continue;
      let P = c === 'D' ? (w.dlWallSelf || 0) : 0, M = c === 'D' ? (w.dlWallSelf || 0) * L / 2 : 0;
      for (const r of w.gravRows || []) { P += (r.P && r.P[c]) || 0; M += ((r.P && r.P[c]) || 0) * (r.x || 0); }
      compare(g5, where, tot[c], P, { case: c + ' ΣP', detail: 'load rows + self-weight' });
      compare(g5, where, tot[c], rl[c] + rr[c], { case: c + ' R_L + R_R' });
      if (w.method === 'wswh') { if (c === 'D') g5.notes.push(w.mark + ': WSWH panel load is concentric (R = P/2 each end, Simpson T = V·H/B − P/2) — no moment check.'); continue; }
      compare(g5, where, M, rr[c] * L, { case: c + ' R_R·L = ΣP·x̄', unit: 'k·ft', abs: 0.01 * Math.max(L, 1) });
    }
  }
  out.push(g5);

  // G6 — wall end equilibrium per load case
  const g6 = newCheck('G6');
  const otmOf = (w, lt) => {
    const V = (lt === 'E' ? w.shareExact_1E : w.shareExact_1W) || 0;
    if (w.method !== 'wswh') return V * (w.floorH || 0);
    const x = w.wswh;
    if (x.role === 'stackedLower' && x.stacked && x.stacked[lt] && x.upperId && byId[x.upperId]) {
      const u = byId[x.upperId], V2 = (lt === 'E' ? u.shareExact_1E : u.shareExact_1W) || 0;
      return (V * x.He + V2 * (x.He + x.stacked[lt].dfl + x.stacked[lt].H2)) / 12;
    }
    return V * (x.He || 0) / 12;
  };
  for (const { w, pl } of walls) {
    if (!w.combos) continue;
    const arm = (w.steps && w.steps.arm) || w.length || 0;
    const lv = w.live || { L: {}, Lr: {} };
    const P = { D: w.dlTotal || 0, L: (lv.L && lv.L.total) || 0, Lr: (lv.Lr && lv.Lr.total) || 0, E: 0, W: 0 };
    const RR = { D: w.dlRR || 0, L: (lv.L && lv.L.rR) || 0, Lr: (lv.Lr && lv.Lr.rR) || 0, E: 0, W: 0 };
    const where = w.mark + ' (' + pl.levelName + ')';
    for (const [c, key] of caseKeys) {
      const cb = w.combos[key];
      const NL = nOf(cb, 'left'), NR = nOf(cb, 'right');
      const otm = c === 'E' || c === 'W' ? otmOf(w, c) : 0;
      if (!(Math.abs(P[c]) > 1e-9) && !(Math.abs(otm) > 1e-9) && !(Math.abs(NL) + Math.abs(NR) > 1e-9)) continue;
      compare(g6, where, P[c], NL + NR, { case: key + ' vertical' });
      compare(g6, where, otm, (NR - RR[c]) * arm, { case: key + ' moment', unit: 'k·ft', abs: 0.01 * Math.max(arm, 1) });
    }
  }
  out.push(g6);

  // G7 — transfer conservation per load case
  const g7 = newCheck('G7');
  const sideTag = (side) => (side === 'left' ? ' L' : ' R');
  const incomingOf = (w, side, key) => (w.injections || []).filter(s => s.side === side).reduce((a, s) => a + ((s.map && s.map[key]) || 0), 0);
  // does the receiver list this source with the same map?
  const received = (rec, srcId, srcLabel, key) => {
    if (rec.type === 'wall_end') {
      const rw = byId[rec.id];
      const s = rw && (rw.injections || []).find(x => x.id === srcId && x.label === srcLabel);
      return s ? (s.map[key] || 0) : null;
    }
    if (rec.type === 'post') {
      const pp = (res.postPaths || []).find(p => p.postId === rec.id);
      const s = pp && pp.sources.find(x => x.id === srcId && x.label === srcLabel);
      return s ? (s.map[key] || 0) : null;
    }
    if (rec.type === 'beam') {
      const bt = (res.beamTransfers || []).find(b => b.beamId === rec.id);
      const s = bt && bt.loads.find(x => x.sourceId === srcId && x.label === srcLabel);
      return s ? (s.map[key] || 0) : null;
    }
    return undefined; // foundation / excluded / WSWH stack: nothing to match
  };
  const checkReceipt = (where, rec, srcId, srcLabel, sent, key) => {
    const got = received(rec, srcId, srcLabel, key);
    if (got === undefined) return;
    if (got === null) assertRow(g7, where, false, 'received by ' + rec.label, 'not found at the receiver', { case: key });
    else compare(g7, where, sent, got, { case: key, detail: '→ ' + rec.label });
  };
  for (const d of res.wallDeliveries || []) {
    const w = byId[d.wallId];
    if (!w || !w.combos) continue;
    const label = (w.mark || d.wallId) + sideTag(d.side);
    for (const [, key] of caseKeys) {
      const own = nOf(w.combos[key], d.side), inc = incomingOf(w, d.side, key);
      compare(g7, label + ' delivered', own + inc, d.map[key] || 0, { case: key, detail: 'own ' + r4(own) + ' + from above ' + r4(inc) });
      checkReceipt(label + ' received', d.receiver, d.wallId, label, d.map[key] || 0, key);
      if (w.accumPerCombo && w.accumPerCombo[key]) compare(g7, label + ' accumulated', own + inc, nOf(w.accumPerCombo[key], d.side), { case: key });
    }
  }
  for (const pp of res.postPaths || []) {
    for (const [, key] of caseKeys) {
      const sum = (pp.sources || []).reduce((a, s) => a + ((s.map && s.map[key]) || 0), 0);
      compare(g7, pp.mark + ' base = Σ sources', sum, (pp.perCombo || {})[key] || 0, { case: key });
      checkReceipt(pp.mark + ' received', pp.receiver, pp.postId, pp.mark, (pp.perCombo || {})[key] || 0, key);
    }
  }
  for (const bt of res.beamTransfers || []) {
    if (!bt.valid || bt.supports.length !== 2) continue;
    const [sa, sb] = bt.supports;
    const xa = sa.position, xb = sb.position;
    for (const [, key] of caseKeys) {
      let P = 0, M = 0;
      for (const ld of bt.loads) { const v = (ld.map && ld.map[key]) || 0; P += v; M += v * (ld.x - xa); }
      const Ra = sa.perCombo[key] || 0, Rb = sb.perCombo[key] || 0;
      compare(g7, bt.mark + ' R_a + R_b = ΣP', P, Ra + Rb, { case: key });
      compare(g7, bt.mark + ' R_b·(x_b − x_a) = ΣP(x − x_a)', M, Rb * (xb - xa), { case: key, unit: 'k·ft', abs: 0.02 * Math.max(xb - xa, 1) });
      bt.supports.forEach((s, j) => checkReceipt(bt.mark + (j === 0 ? ' L' : ' R') + ' support received', s.receiver, bt.beamId, bt.mark + (j === 0 ? ' L' : ' R'), s.perCombo[key] || 0, key));
    }
  }
  out.push(g7);

  // Forces at the base and the excluded ones, per combo key: [{ x, map, excluded, what }]
  const baseForces = [];
  for (const d of res.wallDeliveries || []) {
    const w = byId[d.wallId];
    baseForces.push({ x: d.position, map: d.map, type: d.receiver.type, what: ((w && w.mark) || d.wallId) + sideTag(d.side) });
  }
  for (const pp of res.postPaths || []) baseForces.push({ x: pp.position, map: pp.perCombo || {}, type: pp.receiver.type, what: pp.mark + ' base' });
  for (const bt of res.beamTransfers || []) {
    if (!bt.valid) { for (const ld of bt.loads) baseForces.push({ x: ld.x, map: ld.map, type: 'none', what: bt.mark + ' (invalid beam) load ' + ld.label }); continue; }
    bt.supports.forEach((s, j) => baseForces.push({ x: s.position, map: s.perCombo, type: s.receiver.type, what: bt.mark + (j === 0 ? ' L' : ' R') + ' support' }));
  }
  const atBase = baseForces.filter(f => f.type === 'foundation');
  const excluded = baseForces.filter(f => EXCLUDED.includes(f.type));

  // G8 — global vertical equilibrium per load case
  const g8 = newCheck('G8');
  for (const [c, key] of caseKeys) {
    const base = atBase.reduce((a, f) => a + (f.map[key] || 0), 0);
    let ex = excluded.reduce((a, f) => a + (f.map[key] || 0), 0);
    if (CASES.includes(c)) for (const n of notes) if (n.type === 'gravity_unsupported' && n.g) ex += n.g[c] || 0;
    const exp = CASES.includes(c) ? applied[c] : 0;
    if (!(Math.abs(exp) > 1e-9) && !(Math.abs(base) + Math.abs(ex) > 1e-9)) continue;
    compare(g8, 'Line total', exp, base + ex, { case: key, detail: 'foundation ' + r4(base) + ' + excluded ' + r4(ex), abs: 0.05 });
  }
  excluded.forEach(f => { if (caseKeys.some(([, k]) => Math.abs(f.map[k] || 0) > 1e-9)) g8.notes.push('Excluded (see the load path audit): ' + f.what + ' → ' + f.type); });
  out.push(g8);

  // G9 — global overturning per lateral load case
  const g9 = newCheck('G9');
  for (const lt of lats) {
    const key = CASE_KEY[lt];
    if (!comboKeys.includes(key)) continue;
    // V carried by the walls of each story × its height (shear lost at a level is G2's failure, not repeated here)
    let expected = 0;
    for (const pl of res.perLevel) expected += pl.walls.reduce((a, w) => a + ((lt === 'E' ? w.shareExact_1E : w.shareExact_1W) || 0), 0) * floorH(pl.levelId);
    const actual = [...atBase, ...excluded].reduce((a, f) => a + (f.map[key] || 0) * f.x, 0);
    // WSWH: couple V·H_e over the arm B, delivered at the panel ends (width) — list the difference
    let adj = 0;
    for (const { w } of walls) {
      if (w.method !== 'wswh' || !w.combos || (w.wswh.role === 'stackedUpper' && w.wswh.lowerId)) continue;
      const V = (lt === 'E' ? w.shareExact_1E : w.shareExact_1W) || 0;
      let applied2 = V * (w.floorH || 0);
      if (w.wswh.upperId && byId[w.wswh.upperId]) { const u = byId[w.wswh.upperId]; applied2 += ((lt === 'E' ? u.shareExact_1E : u.shareExact_1W) || 0) * (u.floorH || 0); }
      const couple = nOf(w.combos[key], 'right') * (w.length || 0);
      adj += applied2 - couple;
    }
    if (Math.abs(adj) > 1e-6) g9.notes.push(key + ': WSWH panels resist V·H_e over arm B, not V·h over their width — difference ' + r4(adj) + ' k·ft (by the panel tables, not a loss).');
    compare(g9, 'Line base moment', expected - adj, actual, { case: key, unit: 'k·ft', abs: 0.1, rel: 0.005,
      detail: 'Σ V·h = ' + r4(expected) + (adj ? ' − WSWH ' + r4(adj) : '') });
  }
  out.push(g9);

  // G10 — envelopes and hardware
  const g10 = newCheck('G10');
  const thickness = line.wallThickness || inputs.wallThickness || '4';
  const asdKeys = comboKeys.filter(k => sample && sample.w.combos[k].group === 'asd');
  for (const { w, pl } of walls) {
    if (!w.combos) continue;
    const where = w.mark + ' (' + pl.levelName + ')';
    const src = w.accumPerCombo || w.combos;
    const env = { tL: 0, tR: 0, cL: 0, cR: 0 };
    for (const k of asdKeys) { const c = src[k] || {}; env.tL = Math.max(env.tL, c.tensionLeft || 0); env.tR = Math.max(env.tR, c.tensionRight || 0); env.cL = Math.max(env.cL, c.comprLeft || 0); env.cR = Math.max(env.cR, c.comprRight || 0); }
    const dem = w.hwDemand || { tL: w.governingTensionLeft, tR: w.governingTensionRight, cL: w.governingComprLeft, cR: w.governingComprRight };
    for (const f of ['tL', 'tR', 'cL', 'cR']) compare(g10, where, env[f], dem[f] || 0, { case: { tL: 'T left', tR: 'T right', cL: 'C left', cR: 'C right' }[f] + ' = max ASD', abs: 0.011 });
    for (const [side, T, C] of [['left', dem.tL, dem.cL], ['right', dem.tR, dem.cR]]) {
      const a = side === 'left' ? w.anchorageLeft : w.anchorageRight;
      const p = side === 'left' ? w.postLeft : w.postRight;
      const S = side === 'left' ? 'L' : 'R';
      if (a && !a.byRDP && a.cap > 0) assertRow(g10, where, a.cap + 1e-6 >= T * 1000, 'cap ≥ T', a.id + ' ' + a.cap + ' lb vs T ' + Math.round(T * 1000) + ' lb', { case: 'anchorage ' + S });
      // OVER (user rule 2026-09-29): no holdown / strap / post in the catalog carries the demand → NG
      if (!a) assertRow(g10, where, false, 'cap ≥ T', 'OVER — no anchorage carries T ' + Math.round(T * 1000) + ' lb', { case: 'anchorage ' + S });
      if (w.method === 'wswh') continue;
      if (!p) assertRow(g10, where, false, 'cap ≥ C', 'OVER — no end post carries C ' + (C || 0).toFixed(2) + ' k', { case: 'post ' + S });
      if (p && p.capacityKips != null) assertRow(g10, where, p.capacityKips + 1e-6 >= C, 'cap ≥ C', p.postLabel + ' ' + p.capacityKips + ' k vs C ' + C.toFixed(2) + ' k', { case: 'post ' + S });
      const min = hdueMinPost(a, thickness);
      if (min && p) assertRow(g10, where, meetsMinPost(p, min), '≥ ' + min.label, p.postLabel, { case: 'anchorage min post ' + S });
    }
  }
  for (const pp of res.postPaths || []) {
    const where = pp.mark + ' base (' + pp.levelName + ')';
    if (pp.anchorage && pp.anchorage.cap > 0) assertRow(g10, where, pp.anchorage.cap + 1e-6 >= pp.envelopeT * 1000, 'cap ≥ T', pp.anchorage.id + ' ' + pp.anchorage.cap + ' lb vs T ' + Math.round(pp.envelopeT * 1000) + ' lb', { case: 'anchorage' });
    if (!pp.anchorage && pp.anchorageType) assertRow(g10, where, false, 'cap ≥ T', 'OVER — no anchorage carries T ' + Math.round(pp.envelopeT * 1000) + ' lb', { case: 'anchorage' });
    if (!pp.post) assertRow(g10, where, false, 'cap ≥ C', 'OVER — no post carries C ' + (pp.postDesignC || 0).toFixed(2) + ' k (' + pp.postGoverns + ')', { case: 'post' });
    if (pp.post && pp.postDesignC != null) assertRow(g10, where, pp.post.capacityKips + 1e-6 >= pp.postDesignC, 'cap ≥ C', pp.post.postLabel + ' ' + pp.post.capacityKips + ' k vs C ' + pp.postDesignC.toFixed(2) + ' k (' + pp.postGoverns + ')', { case: 'post' });
  }
  for (const bt of res.beamTransfers || []) {
    bt.supports.forEach((s, j) => {
      if (!s.anchorage && s.anchorageType) assertRow(g10, bt.mark + (j === 0 ? ' L' : ' R') + ' support', false, 'cap ≥ T', 'OVER — no anchorage carries T ' + Math.round(s.envelopeT * 1000) + ' lb', { case: 'anchorage' });
      if (s.anchorage && s.anchorage.cap > 0) assertRow(g10, bt.mark + (j === 0 ? ' L' : ' R') + ' support', s.anchorage.cap + 1e-6 >= s.envelopeT * 1000, 'cap ≥ T', s.anchorage.id + ' ' + s.anchorage.cap + ' lb vs T ' + Math.round(s.envelopeT * 1000) + ' lb', { case: 'anchorage' });
    });
  }
  out.push(g10);

  // G11 — sheathing (sheathed walls and segmented piers; FTAO / WSWH use their own engines)
  const g11 = newCheck('G11');
  const need = (loadType === 'both' ? ['E', 'W'] : loadType === 'wind' ? ['W'] : ['E']);
  for (const { w, pl } of walls) {
    if (w.method === 'wswh' || w.method === 'ftao' || w.hbNotPermitted || !(w.length > 0)) continue;
    const where = w.mark + ' (' + pl.levelName + ')';
    const n = NAILING_TABLE.find(x => x.id === (w.nailing && w.nailing.id));
    if (!n) continue;
    const hb = (w.floorH || 0) / w.length;
    const Chb = hb <= 2 ? 1 : 1.25 - 0.125 * hb;
    const v = { E: 0.7 * rho * (w.shareExact_1E || 0) * 1000 / w.length, W: 0.6 * (w.shareExact_1W || 0) * 1000 / w.length };
    if (seismic) {
      compare(g11, where, v.E, w.unitShear_seismic || 0, { case: 'v seismic', unit: 'plf', abs: 0.5 });
      compare(g11, where, v.E / (n.asdE * Chb), w.seismicDC || 0, { case: 'D/C seismic', unit: '', abs: 0.006 });
    }
    if (wind) {
      compare(g11, where, v.W, w.unitShear_wind || 0, { case: 'v wind', unit: 'plf', abs: 0.5 });
      compare(g11, where, v.W / (n.asdW * Chb), w.windDC || 0, { case: 'D/C wind', unit: '', abs: 0.006 });
    }
    const def = defWalls.find(x => x.id === w.wallId) || {};
    if (def.nailingPattern) { g11.notes.push(w.mark + ': manual nailing ' + n.label + ' (not auto-selected).'); continue; }
    const passes = (m) => need.every(lt => v[lt] <= (lt === 'E' ? m.asdE : m.asdW) * Chb + 0.5);
    // drift-governed walls: the strength pick must be the lightest passing pattern, and the used one heavier
    const sp = w.nailingBasis === 'drift' && w.strengthNailing ? NAILING_TABLE.find(x => x.id === w.strengthNailing.id) : n;
    if (sp !== n) {
      g11.notes.push(w.mark + ': nailing ' + n.label + ' governed by drift (strength needs ' + sp.label + ').');
      assertRow(g11, where, NAILING_TABLE.indexOf(n) > NAILING_TABLE.indexOf(sp), 'heavier than the strength pick', n.label + ' vs ' + sp.label, { case: 'drift-raised' });
    }
    const i = NAILING_TABLE.indexOf(sp);
    const heaviest = i === NAILING_TABLE.length - 1;
    assertRow(g11, where, passes(sp) || heaviest, 'strength nailing passes', sp.label + (passes(sp) ? ' passes' : ' — heaviest, still NG'), { case: 'nailing' });
    if (i > 0) { const lighter = NAILING_TABLE[i - 1]; assertRow(g11, where, !passes(lighter), 'lighter pattern fails', lighter.label + (passes(lighter) ? ' would pass' : ' fails'), { case: 'lightest' }); }
  }
  out.push(g11);

  // G12 — superposition: every combo = factored load cases, at every force point
  const g12 = newCheck('G12');
  const factors = {};
  if (sample) for (const k of comboKeys) factors[k] = sample.w.combos[k].f || {};
  const nonCase = comboKeys.filter(k => !Object.values(CASE_KEY).includes(k));
  const superpose = (where, get) => {
    let worst = null;
    for (const k of nonCase) {
      const f = factors[k];
      const s = k.endsWith('_neg') ? -1 : 1;
      const exp = (f.d || 0) * get(CASE_KEY.D) + (f.l || 0) * get(CASE_KEY.L) + (f.lr || 0) * get(CASE_KEY.Lr) + s * ((f.e || 0) * get(CASE_KEY.E) + (f.w || 0) * get(CASE_KEY.W));
      const act = get(k), diff = act - exp;
      // each load case value is rounded to 0.01 k at every story, so the tolerance grows with the factors (+ 0.2 %)
      const tol = 0.01 * (1 + Math.abs(f.d || 0) + Math.abs(f.l || 0) + Math.abs(f.lr || 0) + Math.abs(f.e || 0) + Math.abs(f.w || 0)) + 0.002 * Math.abs(exp);
      if (!worst || Math.abs(diff) - tol > Math.abs(worst.diff) - worst.tol) worst = { k, exp, act, diff, tol };
    }
    const any = (walls.find(x => x.w.combos) || {}).w;
    if (worst) compare(g12, where, worst.exp, worst.act, { case: 'worst: ' + (any ? lcRef(any.combos, worst.k) : worst.k), tol: worst.tol, detail: nonCase.length + ' combos' });
  };
  for (const { w, pl } of walls) {
    if (!w.combos) continue;
    for (const side of ['left', 'right']) superpose(w.mark + sideTag(side) + ' own (' + pl.levelName + ')', (k) => nOf(w.combos[k], side));
  }
  for (const f of baseForces) superpose(f.what + ' → ' + f.type, (k) => (f.map[k] || 0));
  out.push(g12);

  for (const c of out) if (c.status === 'na' && c.notes.length) c.status = 'note';
  return { checks: out, failed: out.filter(c => c.status === 'fail').length };
}
