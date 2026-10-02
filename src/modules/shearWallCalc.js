import { NAILING_TABLE, autoSelectNailing, getNailingById, gaFor } from './shearWallNailing.js';
import { autoSelectHoldown, autoSelectStrap, autoSelectPost, hdueMinPost, meetsMinPost, getGradeById, HDUE_TABLE, MSTC_TABLE, POST_SIZES, computePostCapacity, lrfdCap, deltaBasisLoad } from './shearWallHardware.js';
import { resolveVerticalLoadPath } from './shearWallLoadPath.js';
import { comboDefs } from './shearWallCombos.js';
import { gravityRows, wallGravity, gravityToElements } from './shearWallGravity.js';
import { aspectFactor } from './shearWallFtao.js';
import { expandWalls, hasOpenings, wallMethod, wallPiers, sortedOpenings } from './shearWallOpenings.js';
import { ftaoCapacityLbf, ftaoDesign, ftaoLoadTypes } from './shearWallFtaoAdapter.js';
import { wallDeflection, wallDeflectionAtShare, postArea, driftLimit } from './shearWallDeflection.js';
import { lineChecks } from './shearWallChecks.js';
import { isWswh, wswhWidthIn, wswhWidthFt, lookupWswh, stackedBaseCheck, selectWswhAnchor, RAISED_ANCHOR, WSWH_ROD, WSWH_PANEL_POST, conditionLabel } from './shearWallWswh.js';

// Records which calc produced a stored results snapshot (results are always regenerated for display)
export const CALC_VERSION = 'v18';

export function accumulateStoryShear(levelLoads, levels) {
  const result = {};
  let cumSeismic = 0;
  let cumWind = 0;
  for (const lvl of levels) {
    const entry = levelLoads[lvl.id] || {};
    cumSeismic += parseFloat(entry.seismic) || 0;
    cumWind += parseFloat(entry.wind) || 0;
    result[lvl.id] = { seismic: cumSeismic, wind: cumWind };
  }
  return result;
}

export function distributeByCapacity(walls, storyShear, capMap) {
  if (!walls.length) return [];
  const items = walls.map(w => {
    const cap = capMap ? (capMap[w.id] || 0) : 0;
    const len = parseFloat(w.length) || 0;
    return { wallId: w.id, capLen: cap * len };
  });
  const totalCapLen = items.reduce((s, it) => s + it.capLen, 0);
  if (totalCapLen <= 0) return items.map(it => ({ wallId: it.wallId, share: 0 }));
  return items.map(it => ({
    wallId: it.wallId,
    share: storyShear * it.capLen / totalCapLen,
  }));
}

// Gravity at one wall: self-weight (wall DL type × area, ½ to each end) plus the line loads directly
// above it (shearWallGravity.js), each split to the ends by statics. opts.lineLength (full-line loads),
// opts.exclude (spans taken by a transfer beam on that floor line).
// Returns dead load (wallSelfDL, diagramDL, dlTotal, rL, rR), live { L, Lr: { total, rL, rR } } and
// loadRows (one documentation row per load piece).
export function resolveGravityAtWall(wall, gravityLoadsAtLevel, wallDLTypes, opts = {}) {
  const pos = parseFloat(wall.position) || 0;
  const len = parseFloat(wall.length) || 0;
  const h = parseFloat(wall._floorToFloor) || 0;

  let wallSelfDL = 0;
  if (wall.wallDLTypeId && wallDLTypes) {
    const wdt = wallDLTypes.find(t => t.id === wall.wallDLTypeId);
    // FTAO walls: no wall weight where the openings are (_openingArea, ft²)
    if (wdt) wallSelfDL = (parseFloat(wdt.psf) || 0) * Math.max(0, len * h - (wall._openingArea || 0)) / 1000;
  }
  const g = wallGravity(pos, len, gravityRows(gravityLoadsAtLevel, opts.lineLength), opts.exclude);
  const total = wallSelfDL + g.D.total;
  const rR = wallSelfDL / 2 + g.D.rR;
  return {
    // unrounded (display rounds; user decision 2026-09-29)
    wallSelfDL, diagramDL: g.D.total, dlTotal: total, rL: total - rR, rR,
    live: { L: g.L, Lr: g.Lr }, loadRows: g.rows,
  };
}

// Ω₀ used for the amplified seismic combos when none is entered or linked
export const DEFAULT_OMEGA0 = 2.5;
export function omega0Of(inputs) { return parseFloat(inputs && inputs.omega0) || DEFAULT_OMEGA0; }

// End forces of a wall for every ASCE 7-22 combination (shearWallCombos.js), + = compression:
//   net end = d·R_D + l·R_L + lr·R_Lr ∓ (e·OTM_1.0E + w·OTM_1.0W) / arm
// share1E / share1W: 1.0-level shears (k); dlTotal: dead load (k); floorH: shear height (ft).
// opts.rL / rR — dead-load end reactions by statics (default dlTotal / 2 each)
// opts.live = { L: { rL, rR }, Lr: { rL, rR } } — live / roof live end reactions (default none)
// opts.omega0 — Ω₀ for the amplified seismic combos; opts.lrfdHalfL — 0.5L in LRFD combos
// opts.arm (ft) — lever arm between the end forces (default L; WSWH: anchor spacing B)
// opts.h (ft) — height of the shear (default floorH; WSWH: panel H_e)
// opts.otm1E / otm1W (k·ft) — 1.0-level overturning moment in place of V·h (stacked WSWH base)
export function computeWallTC(share1E, share1W, dlTotal, wallLength, floorH, rho, sds, loadType, opts = {}) {
  const L = parseFloat(wallLength) || 0;
  const h = parseFloat(floorH) || 0;
  const _rho = parseFloat(rho) || 1.0;
  const _sds = parseFloat(sds) || 0;
  const om = parseFloat(opts.omega0) || DEFAULT_OMEGA0;
  const dl = parseFloat(dlTotal) || 0;
  const hasR = opts.rL != null && opts.rR != null;
  const R = {
    D: L > 0 ? [hasR ? parseFloat(opts.rL) || 0 : dl / 2, hasR ? parseFloat(opts.rR) || 0 : dl / 2] : [0, 0],
    L: L > 0 && opts.live && opts.live.L ? [opts.live.L.rL || 0, opts.live.L.rR || 0] : [0, 0],
    Lr: L > 0 && opts.live && opts.live.Lr ? [opts.live.Lr.rL || 0, opts.live.Lr.rR || 0] : [0, 0],
  };
  const arm = opts.arm != null ? parseFloat(opts.arm) || 0 : L;
  const hE = opts.h != null ? parseFloat(opts.h) || 0 : h;
  const V = parseFloat(share1E) || 0, Vw = parseFloat(share1W) || 0;
  const VhE = opts.otm1E != null ? opts.otm1E : V * hE;   // 1.0-level overturning moments (k·ft)
  const VhW = opts.otm1W != null ? opts.otm1W : Vw * hE;

  const defs = comboDefs({ loadType, sds: _sds, rho: _rho, omega0: om, lrfdHalfL: !!opts.lrfdHalfL });
  const combos = {};
  const steps = {
    rL: r2(R.D[0]), rR: r2(R.D[1]), live: { L: R.L.map(r2), Lr: R.Lr.map(r2) },
    otm1E: VhE, otm1W: VhW, arm: r4(arm),
  };
  // m > 0 overturns toward the right end (_pos): left end is the uplift side
  const endPair = (f, m) => {
    const g = (i) => f.d * R.D[i] + f.l * R.L[i] + f.lr * R.Lr[i];
    const netL = g(0) - m, netR = g(1) + m;
    return {
      group: f.group, f: { d: f.d, l: f.l, lr: f.lr, e: f.e, w: f.w }, text: f.text, ref: f.ref, lc: f.lc || null,
      // unrounded (rounded for display only, user decision 2026-09-29)
      tensionLeft: Math.max(0, -netL), comprLeft: Math.max(0, netL),
      tensionRight: Math.max(0, -netR), comprRight: Math.max(0, netR),
    };
  };
  for (const f of defs) {
    const m = arm > 0 ? (f.e * VhE + f.w * VhW) / arm : 0;
    if (f.signed) {
      combos[f.key + '_pos'] = endPair(f, m);
      combos[f.key + '_neg'] = endPair(f, -m);
    } else {
      combos[f.key] = endPair(f, m);
    }
  }
  // Summary steps (calc detail): ASD seismic / wind overturning and gravity factors
  if (loadType === 'seismic' || loadType === 'both') {
    steps.seismic = { otm: r2(0.7 * _rho * VhE), gfUplift: r4(0.6 - 0.14 * _sds), gfComp: r4(1.0 + 0.14 * _sds) };
    steps.lrfdSeismic = { otm: r2(_rho * VhE), fUplift: r4(0.9 - 0.2 * _sds), fComp: r4(1.2 + 0.2 * _sds) };
    steps.omega = { omega0: om, otmASD: r2(0.7 * om * VhE), otmLRFD: r2(om * VhE) };
  }
  if (loadType === 'wind' || loadType === 'both') {
    steps.wind = { otm: r2(0.6 * VhW) };
    steps.lrfdWind = { otm: r2(VhW) };
  }

  const gov = governingOf(combos, 'asd');
  const lrfd = governingOf(combos, 'lrfd');
  return {
    combos, steps,
    omegaASD: governingOf(combos, 'asd_omega'), omegaLRFD: governingOf(combos, 'lrfd_omega'),
    governingTensionLeft: gov.tL,
    governingTensionRight: gov.tR,
    governingComprLeft: gov.cL,
    governingComprRight: gov.cR,
    lrfdTensionLeft: lrfd.tL, lrfdTensionRight: lrfd.tR,
    lrfdComprLeft: lrfd.cL, lrfdComprRight: lrfd.cR,
  };
}

// Governing end forces over the combos of one group ('asd' designs, 'lrfd' is reported)
export function governingOf(combos, group) {
  let tL = 0, tR = 0, cL = 0, cR = 0;
  for (const c of Object.values(combos || {})) {
    if (c.group !== group) continue;
    tL = Math.max(tL, c.tensionLeft || 0);
    tR = Math.max(tR, c.tensionRight || 0);
    cL = Math.max(cL, c.comprLeft || 0);
    cR = Math.max(cR, c.comprRight || 0);
  }
  return { tL, tR, cL, cR };
}

// SDPWS 2021 §4.3.3.2 / 4.3.4: h/b ≤ 2 → 1.0; 2 < h/b ≤ 3.5 → 1.25 − 0.125h/b; > 3.5 not a shear wall
export function checkAspectRatio(wallLength, floorToFloor) {
  const L = parseFloat(wallLength) || 0;
  const h = parseFloat(floorToFloor) || 0;
  if (L <= 0) return { hOverB: Infinity, flag: true, reductionFactor: 0, notPermitted: true };
  const hOverB = r2(h / L);
  const f = aspectFactor(h, L, '1.25-0.125h/bs');
  if (f === null) return { hOverB, flag: true, reductionFactor: 0, notPermitted: true };
  return { hOverB, flag: hOverB > 2.0, reductionFactor: r4(f), notPermitted: false };
}

// === Geometry helpers (shared with shearWallLoadPath.js) ===

export function pointInWallEnd(pos, wall, tolerance) {
  const tol = tolerance || 0.1;
  const wStart = parseFloat(wall.position) || 0;
  const wEnd = wStart + (parseFloat(wall.length) || 0);
  if (Math.abs(pos - wStart) <= tol) return 'left';
  if (Math.abs(pos - wEnd) <= tol) return 'right';
  return null;
}

// === Main calc with nailing iteration + hardware auto-select ===
// Walls with openings: 'segmented' walls are split into full-height piers (each designed as a wall);
// 'ftao' walls are one element designed by the FTAO engine (capacity weight = engine V_cap,ASD).

const isFtao = (w) => hasOpenings(w) && wallMethod(w) === 'ftao';

// === Strong-Wall WSWH panels ===
// Role of each panel (stacked pairs found by position), dead load, and table values per load type with
// P = largest ASD compression-combo vertical load acting with the shear: seismic max((1.0+0.14SDS)D,
// (1.0+0.105SDS)D + 0.75L); wind max(D, D + 0.75L + 0.75Lr). A panel with a lookup error carries no shear.
function prepareWswh(allWalls, levels, line, wallDLTypes, inputs, gOpts) {
  const out = {};
  const sds = parseFloat(inputs.sds) || 0;
  const liOf = (id) => levels.findIndex(l => l.id === id);
  const bottom = levels.length - 1;
  const panels = allWalls.filter(isWswh);
  for (const w of panels) {
    const li = liOf(w.levelId);
    const floorH = parseFloat((levels[li] || {}).floorToFloor) || 0;
    const grav = resolveGravityAtWall({ ...w, _floorToFloor: floorH }, (line.gravityLoads || {})[w.levelId], wallDLTypes, gOpts(w.levelId));
    const cond = w.wswhCondition || 'concrete';
    out[w.id] = { wall: w, li, floorH, grav, condition: cond, role: cond, width: wswhWidthIn(w), errors: [] };
  }
  for (const info of Object.values(out)) {
    const { wall: w, li, condition } = info;
    if (condition === 'stackedUpper') {
      const below = panels.find(o => liOf(o.levelId) === li + 1 && wswhWidthIn(o) === info.width
        && Math.abs((parseFloat(o.position) || 0) - (parseFloat(w.position) || 0)) <= 0.1);
      if (!below) info.errors.push('Stacked 2nd-story WSWH needs an equal-width WSWH directly below (±0.1 ft)');
      else if (liOf(below.levelId) !== bottom) info.errors.push('The WSWH below must be at the bottom story (two stories max)');
      else if ((below.wswhCondition || 'concrete') !== 'concrete') info.errors.push('The WSWH below must use the concrete foundation condition');
      else { info.lowerId = below.id; out[below.id].role = 'stackedLower'; out[below.id].upperId = w.id; }
      if ((parseFloat(w.wswhFloorDepth) || 0) > 18) info.errors.push('Floor depth ' + w.wswhFloorDepth + '" exceeds 18" (Table 03 n.6)');
    } else if (li !== bottom) {
      info.errors.push(conditionLabel(condition) + ' is for the bottom story only — use "Two-story stacked" at the 2nd story');
    }
  }
  // Stack base carries the 2nd-story panel's gravity too (concentric, ½ each end) — F2
  for (const info of Object.values(out)) {
    if (!info.upperId) continue;
    const ug = out[info.upperId].grav, g = info.grav, x = wswhWidthFt(info.wall) / 2;
    const up = { D: ug.dlTotal, L: ug.live.L.total, Lr: ug.live.Lr.total };
    const half = (o) => { const h = {}; for (const c of ['D', 'L', 'Lr']) if (o[c]) h[c] = r4(o[c] / 2); return h; };
    const nzc = (o) => { const h = {}; for (const c of ['D', 'L', 'Lr']) if (o[c]) h[c] = r4(o[c]); return h; };
    info.fromAbove = up;
    info.grav = {
      ...g, dlTotal: g.dlTotal + up.D, diagramDL: g.diagramDL + up.D,
      live: { L: { total: g.live.L.total + up.L }, Lr: { total: g.live.Lr.total + up.Lr } },
      loadRows: [...g.loadRows, { id: info.upperId, index: '↑', shape: 'stack', label: 'Stacked panel above (' + (out[info.upperId].wall.mark || info.upperId) + ')',
        x: r4(x), mag: nzc(up), P: nzc(up), rL: half(up), rR: half(up) }],
    };
  }
  const fc = inputs.wswhFc || '2500';
  for (const info of Object.values(out)) {
    // ASD vertical load acting with the shear: largest compression combo of that load type
    const D = info.grav.dlTotal * 1000, Lv = info.grav.live.L.total * 1000, Lr = info.grav.live.Lr.total * 1000;
    info.P = { E: Math.max((1.0 + 0.14 * sds) * D, (1.0 + 0.105 * sds) * D + 0.75 * Lv), W: Math.max(D, D + 0.75 * Lv + 0.75 * Lr) };
    info.look = {};
    for (const lt of ['E', 'W']) {
      info.look[lt] = lookupWswh({ width: info.width, condition: info.role, ftfFt: info.floorH, P_lb: info.P[lt], fc, joist: info.wall.wswhJoist || '12' });
    }
    const err = info.look.E.error || info.look.W.error;
    if (err) info.errors.push(err);
  }
  return out;
}

export function calcAll(inputs) {
  const levels = inputs.levels || [];
  const sds = inputs.sds;
  const omega0 = omega0Of(inputs);
  const loadType = inputs.loadType || 'seismic';
  const seismic = loadType === 'seismic' || loadType === 'both';
  const wind = loadType === 'wind' || loadType === 'both';
  const wallDLTypes = inputs.wallDLTypes || [];
  const globalThickness = inputs.wallThickness || '4';
  const grade = getGradeById(inputs.woodGrade);
  const sheathing = inputs.sheathing === 'osb' ? 'osb' : 'ply';
  const alphaS = parseFloat(inputs.alphaS) || 0;
  const bottomLevelId = levels.length > 0 ? levels[levels.length - 1].id : null;
  const floorHOf = (id) => parseFloat((levels.find(l => l.id === id) || {}).floorToFloor) || 0;
  const levelNameOf = (id) => (levels.find(l => l.id === id) || {}).name || '';
  // Anchorage catalog of a level: HDUE at the bottom story (or anchorage type 'holdown'), else the MSTC table of its floor span
  const anchorageTableOfLevel = (id) => {
    const lvl = levels.find(l => l.id === id) || {};
    const useHoldown = id === bottomLevelId || lvl.anchorageType === 'holdown';
    const floorSpan = lvl.floorClearSpan || '16';
    return { useHoldown, floorSpan, table: anchorageTable(useHoldown, floorSpan) };
  };

  const perDirection = (inputs.directions || []).map(dir => {
    const rho = dir.rho;
    const rhoN = parseFloat(rho) || 1;
    // One pass over a line. forced: { E: { wallId: kips }, W: {…} } replaces capacity-based shares
    // (deflection approach); null = capacity-based distribution.
    // floor (drift sizing): nail { wallId: index in NAILING_TABLE } — lightest nailing allowed;
    // anc { wallId: index in the wall's anchorage table } — smallest auto holdown / strap allowed (both ends)
    const runLine = (line, forced, floor = {}) => {
      const nailFloor = floor.nail || {}, ancFloor = floor.anc || {};
      const lineThickness = line.wallThickness || globalThickness;
      const storyShears = accumulateStoryShear(line.levelLoads || {}, levels);
      const ftaoCtx = (w) => ({ floorH: floorHOf(w.levelId), rho: rhoN, sds, grade, sheathing, cd: inputs.cd, ie: inputs.ie, alphaS, lineThickness, loadType });
      // Gravity loads: parts over a transfer beam go to the beam, point loads on a post top to the post,
      // loads over nothing are noted; walls take the rest (gOpts: full-line length + beam spans)
      const gdist = gravityToElements({ line, levels, coverWalls: (line.walls || []).map(w => (isWswh(w) ? { ...w, length: wswhWidthFt(w) } : w)) });
      const gOpts = (levelId) => ({ lineLength: line.totalLength, exclude: gdist.excludeByLevel[levelId] });
      const lrfdHalfL = !!inputs.lrfdHalfL;
      // Gravity (kips, D / L / Lr) at each FTAO jamb: half the adjacent pier's load + half the header load above the opening
      const jambDL = (w) => {
        const h = floorHOf(w.levelId);
        const gl = (line.gravityLoads || {})[w.levelId];
        const over = (position, length, height) => {
          const g = resolveGravityAtWall({ position, length, wallDLTypeId: w.wallDLTypeId, _floorToFloor: height }, gl, wallDLTypes, gOpts(w.levelId));
          return { D: g.dlTotal, L: g.live.L.total, Lr: g.live.Lr.total };
        };
        const half = (a, b) => ({ D: a.D / 2 + b.D / 2, L: a.L / 2 + b.L / 2, Lr: a.Lr / 2 + b.Lr / 2 });
        const piers = wallPiers(w);
        const x0 = parseFloat(w.position) || 0;
        const out = [];
        sortedOpenings(w).forEach((o, j) => {
          const header = over(x0 + o.offset, o.width, h - o.head);
          out.push(half(over(piers[j].start, piers[j].length, h), header));
          out.push(half(over(piers[j + 1].start, piers[j + 1].length, h), header));
        });
        return out;
      };

      // Segmented walls are solid (no openings). FTAO walls with bad opening geometry or rejected by the
      // engine, and segmented walls carrying openings (outside data), are designed solid and reported.
      const expanded = expandWalls(line.walls || [], levels);
      const openingIssues = { ...expanded.problems };
      const allWalls = expanded.walls.map(w => {
        if (isWswh(w)) return { ...w, length: wswhWidthFt(w), openings: [] };
        if (!isFtao(w)) return w;
        try { ftaoCapacityLbf(w, ftaoCtx(w), NAILING_TABLE[0], ftaoLoadTypes(loadType)[0]); return w; }
        catch (e) { openingIssues[w.id] = e.errors || [e.message]; return { ...w, openings: [], _openingsIgnored: true }; }
      });

      const capCache = {};
      const exactShares = {}; // unrounded 1.0-level shares (kips) for the final FTAO run
      const ftaoCap = (w, n, lt) => {
        const k = w.id + '|' + n.id + '|' + lt;
        if (capCache[k] === undefined) capCache[k] = ftaoCapacityLbf(w, ftaoCtx(w), n, lt);
        return capCache[k];
      };

      const wswh = prepareWswh(allWalls, levels, line, wallDLTypes, inputs, gOpts);
      const wswhCapLb = (w, lt) => { const i = wswh[w.id]; return i && !i.errors.length ? i.look[lt].V[lt] : 0; };

      // Aspect ratios (fixed per wall). FTAO piers are checked by the engine at the opening height.
      const wallARs = {};
      for (const w of allWalls) {
        wallARs[w.id] = isFtao(w) || isWswh(w)
          ? { hOverB: null, flag: false, reductionFactor: 1, notPermitted: false }
          : checkAspectRatio(parseFloat(w.length) || 0, floorHOf(w.levelId));
      }
      // Capacity weight (plf-equivalent) for capacity-based distribution
      const capOf = (w, n, lt) => {
        if (isWswh(w)) return wswhCapLb(w, lt) / wswhWidthFt(w); // panel V_allow (lb) over its width
        if (isFtao(w)) {
          const len = parseFloat(w.length) || 0;
          return len > 0 ? ftaoCap(w, n, lt) / len : 0;
        }
        return (lt === 'E' ? n.asdE : n.asdW) * wallARs[w.id].reductionFactor;
      };

      const sharesAt = (walls, V, capMap, lt) => forced
        ? walls.map(w => ({ wallId: w.id, share: (forced[lt] && forced[lt][w.id]) || 0 }))
        : distributeByCapacity(walls, V, capMap);

      // Phase 1: Iterate nailing selection until stable
      const wallNailing = {};
      const strengthPick = {}; // lightest nailing that carries the shear (strength alone)
      const floorOf = (w) => NAILING_TABLE[Math.min(nailFloor[w.id] || 0, NAILING_TABLE.length - 1)];
      allWalls.forEach(w => {
        const manual = w.nailingPattern ? getNailingById(w.nailingPattern) : null;
        wallNailing[w.id] = manual || floorOf(w);
      });

      for (let iter = 0; iter < 5; iter++) {
        let changed = false;
        for (const lvl of levels) {
          const wallsAtLevel = allWalls.filter(w => w.levelId === lvl.id);
          if (!wallsAtLevel.length) continue;
          const ss = storyShears[lvl.id] || { seismic: 0, wind: 0 };

          const seismicCapMap = {}, windCapMap = {};
          wallsAtLevel.forEach(w => {
            seismicCapMap[w.id] = capOf(w, wallNailing[w.id], 'E');
            windCapMap[w.id] = capOf(w, wallNailing[w.id], 'W');
          });

          const eMap = {}; sharesAt(wallsAtLevel, ss.seismic, seismicCapMap, 'E').forEach(s => { eMap[s.wallId] = s.share; });
          const wMap = {}; sharesAt(wallsAtLevel, ss.wind, windCapMap, 'W').forEach(s => { wMap[s.wallId] = s.share; });

          for (const w of wallsAtLevel) {
            if (w.nailingPattern || wallARs[w.id].notPermitted || isWswh(w)) continue;
            const wLen = parseFloat(w.length) || 0;
            if (wLen <= 0) continue;
            let selected;
            if (isFtao(w)) {
              const VE = 0.7 * rhoN * (eMap[w.id] || 0) * 1000, VW = 0.6 * (wMap[w.id] || 0) * 1000;
              selected = NAILING_TABLE.find(n => (!seismic || VE <= ftaoCap(w, n, 'E') + 1e-6) && (!wind || VW <= ftaoCap(w, n, 'W') + 1e-6)) || null;
            } else {
              const vSeis = (eMap[w.id] || 0) * 0.7 * rhoN * 1000 / wLen;
              const vWind = (wMap[w.id] || 0) * 0.6 * 1000 / wLen;
              selected = autoSelectNailing(vSeis, vWind, wallARs[w.id].reductionFactor, loadType);
            }
            const prev = wallNailing[w.id];
            if (!selected) selected = NAILING_TABLE[NAILING_TABLE.length - 1];
            strengthPick[w.id] = selected;
            // drift sizing: never lighter than the floor
            const fl = floorOf(w);
            if (NAILING_TABLE.indexOf(fl) > NAILING_TABLE.indexOf(selected)) selected = fl;
            if (selected.id !== prev.id) { wallNailing[w.id] = selected; changed = true; }
          }
        }
        if (!changed) break;
      }

      // Phase 2: Final results with converged nailing
      const perLevel = levels.map(lvl => {
        const ss = storyShears[lvl.id] || { seismic: 0, wind: 0 };
        const wallsAtLevel = allWalls.filter(w => w.levelId === lvl.id);
        const floorH = parseFloat(lvl.floorToFloor) || 0;
        const isBottom = lvl.id === bottomLevelId;
        const ancType = lvl.anchorageType || 'auto';
        const useHoldown = isBottom || ancType === 'holdown';
        const floorSpan = lvl.floorClearSpan || '16';

        const seismicCapMap = {}, windCapMap = {};
        wallsAtLevel.forEach(w => {
          seismicCapMap[w.id] = capOf(w, wallNailing[w.id], 'E');
          windCapMap[w.id] = capOf(w, wallNailing[w.id], 'W');
        });

        const eShares = sharesAt(wallsAtLevel, ss.seismic, seismicCapMap, 'E');
        const wShares = sharesAt(wallsAtLevel, ss.wind, windCapMap, 'W');
        const shareMap = {};
        eShares.forEach(s => { shareMap[s.wallId] = { seismic: s.share, wind: 0 }; });
        wShares.forEach(s => {
          if (!shareMap[s.wallId]) shareMap[s.wallId] = { seismic: 0, wind: 0 };
          shareMap[s.wallId].wind = s.share;
        });

        const totalCapLenE = wallsAtLevel.reduce((s, w) => {
          return s + (seismicCapMap[w.id] || 0) * (parseFloat(w.length) || 0);
        }, 0);

        const wallResults = wallsAtLevel.map(w => {
          const sh = shareMap[w.id] || { seismic: 0, wind: 0 };
          exactShares[w.id] = sh;
          if (isWswh(w)) {
            const relStiffness = forced
              ? (ss.seismic > 0 ? r2(sh.seismic / ss.seismic) : ss.wind > 0 ? r2(sh.wind / ss.wind) : 0)
              : totalCapLenE > 0 ? r2((seismicCapMap[w.id] || 0) * (parseFloat(w.length) || 0) / totalCapLenE) : 0;
            return wswhWallResult(w, wswh[w.id], sh, { floorH, rho, rhoN, sds, loadType, seismic, wind, omega0, lrfdHalfL, relStiffness, totalCapLenE,
              upperShare: wswh[w.id].upperId ? exactShares[wswh[w.id].upperId] : null, upper: wswh[w.id].upperId ? wswh[wswh[w.id].upperId] : null, inputs });
          }
          const wLen = parseFloat(w.length) || 0;
          const ar = wallARs[w.id];
          const n = wallNailing[w.id];
          const effCapE = seismicCapMap[w.id] || 0;
          const effCapW = windCapMap[w.id] || 0;
          // Share fraction of the story shear: capacity × length (capacity approach) or k/Σk (deflection approach)
          const relStiffness = forced
            ? (ss.seismic > 0 ? r2(sh.seismic / ss.seismic) : ss.wind > 0 ? r2(sh.wind / ss.wind) : 0)
            : totalCapLenE > 0 ? r2(effCapE * wLen / totalCapLenE) : 0;

          let seismicPlf = 0, windPlf = 0;
          let seismicDC, windDC, sheathCapE = effCapE, sheathCapW = effCapW;
          let ftao = null, arInfo = ar;
          if (isFtao(w)) {
            // Sheathing checks at the governing FTAO zone (pier, corner zone or above/below opening)
            ftao = ftaoDesign(w, ftaoCtx(w), n, sh, { endPosts: null, anchorage: null, jambDL: jambDL(w) });
            const zoneOf = (lt) => {
              const r = ftao.perType[lt];
              if (!r) return { plf: 0, cap: 0, dc: 0 };
              const z = r.sheathing.find(s => s.zone === r.governing.zone) || {};
              return { plf: z.demand || 0, cap: z.capacity || 0, dc: r.governing.dcr };
            };
            const zE = zoneOf('E'), zW = zoneOf('W');
            seismicPlf = zE.plf; windPlf = zW.plf;
            seismicDC = r2(zE.dc); windDC = r2(zW.dc);
            sheathCapE = zE.cap; sheathCapW = zW.cap;
            const piers = (Object.values(ftao.perType)[0] || {}).geometry;
            const pierAR = piers ? piers.piers : [];
            arInfo = {
              hOverB: pierAR.length ? r2(Math.max(...pierAR.map(p => p.aspect))) : null,
              reductionFactor: pierAR.length ? r4(Math.min(...pierAR.map(p => p.Car))) : 1,
              notPermitted: false,
            };
            arInfo.flag = arInfo.hOverB != null && arInfo.hOverB > 2.0;
          } else {
            if (wLen > 0) {
              seismicPlf = sh.seismic * 0.7 * rhoN * 1000 / wLen;
              windPlf = sh.wind * 0.6 * 1000 / wLen;
            }
            seismicDC = effCapE > 0 ? r2(seismicPlf / effCapE) : 0;
            windDC = effCapW > 0 ? r2(windPlf / effCapW) : 0;
          }
          let dcRatio, dcGoverning, unitShearASD;
          if (loadType === 'seismic') { dcRatio = seismicDC; dcGoverning = 'seismic'; unitShearASD = seismicPlf; }
          else if (loadType === 'wind') { dcRatio = windDC; dcGoverning = 'wind'; unitShearASD = windPlf; }
          else {
            dcGoverning = seismicDC >= windDC ? 'seismic' : 'wind';
            dcRatio = Math.max(seismicDC, windDC);
            unitShearASD = dcGoverning === 'wind' ? windPlf : seismicPlf;
          }
          const effCap = dcGoverning === 'wind' ? sheathCapW : sheathCapE;

          const wWithH = { ...w, _floorToFloor: floorH, _openingArea: isFtao(w) ? sortedOpenings(w).reduce((a, o) => a + o.width * (o.head - o.sill), 0) : 0 };
          const grav = resolveGravityAtWall(wWithH, (line.gravityLoads || {})[lvl.id], wallDLTypes, gOpts(lvl.id));
          const tc = computeWallTC(sh.seismic, sh.wind, grav.dlTotal, wLen, floorH, rho, sds, loadType, { omega0, rL: grav.rL, rR: grav.rR, live: grav.live, lrfdHalfL });

          let anchorageLeft = null, anchorageRight = null;
          if (w.anchorageLeftOverride) {
            anchorageLeft = findAnchorage(w.anchorageLeftOverride, floorSpan);
          } else {
            anchorageLeft = anchorageWithFloor(useHoldown ? autoSelectHoldown(tc.governingTensionLeft) : autoSelectStrap(tc.governingTensionLeft, floorSpan),
              anchorageTable(useHoldown, floorSpan), ancFloor[w.id]);
          }
          if (w.anchorageRightOverride) {
            anchorageRight = findAnchorage(w.anchorageRightOverride, floorSpan);
          } else {
            anchorageRight = anchorageWithFloor(useHoldown ? autoSelectHoldown(tc.governingTensionRight) : autoSelectStrap(tc.governingTensionRight, floorSpan),
              anchorageTable(useHoldown, floorSpan), ancFloor[w.id]);
          }

          const selL = selectEndPost(w.postLeftOverride, tc.governingComprLeft, lineThickness, grade, floorH, anchorageLeft);
          const selR = selectEndPost(w.postRightOverride, tc.governingComprRight, lineThickness, grade, floorH, anchorageRight);
          const postLeft = selL.post, postRight = selR.post;

          const wallResult = {
            wallId: w.id, mark: w.mark || '', position: parseFloat(w.position) || 0, length: wLen,
            method: isFtao(w) ? 'ftao' : 'wall',
            openingsIgnored: !!w._openingsIgnored,
            hOverB: arInfo.hOverB, hOverBFlag: arInfo.flag, hbReductionFactor: arInfo.reductionFactor,
            hbNotPermitted: !!arInfo.notPermitted,
            share_1E: r2(sh.seismic), share_1W: r2(sh.wind),
            shareExact_1E: sh.seismic, shareExact_1W: sh.wind,
            relStiffness, totalCapLen: r2(totalCapLenE),
            unitShear_seismic: r2(seismicPlf), unitShear_wind: r2(windPlf),
            unitShear_ASD: r2(unitShearASD),
            nailing: { id: n.id, label: n.label, sides: n.sides },
            // what sizes the sheathing: 'strength' | 'drift' (raised above the strength pick) | 'manual'
            nailingBasis: w.nailingPattern ? 'manual' : strengthPick[w.id] && NAILING_TABLE.indexOf(n) > NAILING_TABLE.indexOf(strengthPick[w.id]) ? 'drift' : 'strength',
            strengthNailing: strengthPick[w.id] ? { id: strengthPick[w.id].id, label: strengthPick[w.id].label } : null,
            capacity: dcGoverning === 'wind' ? n.asdW : n.asdE,
            effectiveCapacity: r2(effCap),
            seismicCap: n.asdE, windCap: n.asdW,
            effectiveSeismicCap: r2(sheathCapE), effectiveWindCap: r2(sheathCapW),
            seismicDC, windDC, dcRatio, dcGoverning,
            dlWallSelf: grav.wallSelfDL, dlFromDiagram: grav.diagramDL, dlTotal: grav.dlTotal, dlRL: grav.rL, dlRR: grav.rR,
            live: grav.live, gravRows: grav.loadRows,
            floorH,
            anchorageType: useHoldown ? 'holdown' : 'strap',
            anchorageLeft, anchorageRight,
            postLeft, postRight,
            postRaised: { left: selL.raised ? selL : null, right: selR.raised ? selR : null },
            ftao,
            ...tc,
          };
          computeHardwareDC(wallResult);
          return wallResult;
        });

        // Capacity-method weights (lb): capacity (plf-equivalent) × length — share = weight / Σ weights
        for (const wr of wallResults) {
          const len = parseFloat((wallsAtLevel.find(x => x.id === wr.wallId) || {}).length) || 0;
          wr.capWeight = { E: r2((seismicCapMap[wr.wallId] || 0) * len), W: r2((windCapMap[wr.wallId] || 0) * len) };
        }
        return {
          levelId: lvl.id, levelName: lvl.name || '',
          storyShear_1E: r2(ss.seismic), storyShear_1W: r2(ss.wind),
          walls: wallResults,
        };
      });

      // Phase 3: Vertical load path — wall ends, posts at any story, transfer beams (user supports)
      const wallResultsMap = {};
      perLevel.forEach(pl => pl.walls.forEach(wr => { wallResultsMap[wr.wallId] = wr; }));
      const absorbedInto = {};
      for (const [id, i] of Object.entries(wswh)) if (i.lowerId) absorbedInto[id] = i.lowerId;
      const loadPath = resolveVerticalLoadPath({
        levels, walls: allWalls, beams: line.beams || [], posts: line.supportPosts || [],
        wallResultsMap, lineThickness, grade, absorbedInto, beamGravity: gdist.beamGravity, postGravity: gdist.postGravity,
        // WSWH anchors; auto holdowns / straps never below the drift-sizing floor (overrides are left alone)
        wallHardware: (w, T, override) => {
          if (isWswh(w)) return wswhAnchorFor(w, wswh[w.id], T, inputs);
          if (override || ancFloor[w.id] == null) return undefined;
          const t = anchorageTableOfLevel(w.levelId);
          return anchorageWithFloor(t.useHoldown ? autoSelectHoldown(T) : autoSelectStrap(T, t.floorSpan), t.table, ancFloor[w.id]);
        },
      });
      loadPath.loadPathAudit.notes.push(...gdist.notes);
      for (const [id, i] of Object.entries(wswh)) {
        if (!i.errors.length) continue;
        loadPath.loadPathAudit.warnings.push({ type: 'wswh', elementId: id, elementMark: i.wall.mark || id, levelName: levelNameOf(i.wall.levelId),
          message: 'Strong-Wall: ' + i.errors.join('; ') + ' — panel carries no shear' });
      }

      // Opening / aspect-ratio problems go in the audit with the load path warnings
      for (const [wallId, msgs] of Object.entries(openingIssues)) {
        const w = (line.walls || []).find(x => x.id === wallId) || {};
        loadPath.loadPathAudit.warnings.push({ type: 'openings', elementId: wallId, elementMark: w.mark || wallId, levelName: levelNameOf(w.levelId),
          message: 'Openings not used — wall designed as solid: ' + msgs.join('; ') });
      }
      for (const wr of Object.values(wallResultsMap)) {
        if (wr.hbNotPermitted) {
          loadPath.loadPathAudit.warnings.push({ type: 'aspect_ratio', elementId: wr.wallId, elementMark: wr.mark, levelName: levelNameOf((allWalls.find(w => w.id === wr.wallId) || {}).levelId),
            message: 'h/b = ' + wr.hOverB + ' > 3.5 — not permitted as a shear wall (SDPWS 2021 §4.3.4); carries no shear' });
        }
      }
      // Anchorage basis per end: manual (override) / drift (raised above the strength pick) / strength
      for (const w of allWalls) {
        const wr = wallResultsMap[w.id];
        if (!wr || isWswh(w)) continue;
        const t = anchorageTableOfLevel(w.levelId);
        const basisOf = (ov, anc, T) => {
          if (ov) return { basis: 'manual', strength: null };
          const str = t.useHoldown ? autoSelectHoldown(T) : autoSelectStrap(T, t.floorSpan);
          return { basis: anc && str && anc.id !== str.id ? 'drift' : 'strength', strength: str ? str.id : null };
        };
        const d = wr.hwDemand || { tL: wr.governingTensionLeft, tR: wr.governingTensionRight };
        wr.anchorageBasis = { left: basisOf(w.anchorageLeftOverride, wr.anchorageLeft, d.tL), right: basisOf(w.anchorageRightOverride, wr.anchorageRight, d.tR) };
      }
      // P9: a post override below the anchorage minimum post (HDUE / MSTC) is not used
      const raisedMsg = (r, what) => what + ' override ' + r.requested + ' is below the anchorage minimum post ' + r.minPost
        + ' — ' + (r.post ? r.post.postLabel : 'OVER') + ' used; change or clear the override';
      for (const wr of Object.values(wallResultsMap)) {
        for (const side of ['left', 'right']) {
          const r = wr.postRaised && wr.postRaised[side];
          if (!r) continue;
          loadPath.loadPathAudit.warnings.push({ type: 'post_below_hdue_min', elementId: wr.wallId, elementMark: wr.mark,
            levelName: levelNameOf((allWalls.find(w => w.id === wr.wallId) || {}).levelId),
            message: raisedMsg(r, side[0].toUpperCase() + side.slice(1) + ' post') });
        }
      }
      for (const pp of loadPath.postPaths) {
        if (pp.postRaised) loadPath.loadPathAudit.warnings.push({ type: 'post_below_hdue_min', elementId: pp.postId, elementMark: pp.mark,
          levelName: pp.levelName, message: raisedMsg(pp.postRaised, 'Post') });
      }
      loadPath.loadPathAudit.allClear = loadPath.loadPathAudit.warnings.length === 0;

      // Phase 4: FTAO walls with the final end posts and anchorage (plate bearing, deflection, strap)
      for (const w of allWalls) {
        const wr = wallResultsMap[w.id];
        if (!wr || !isFtao(w)) continue;
        const softer = [wr.anchorageLeft, wr.anchorageRight].filter(Boolean)
          .sort((a, b) => (b.delta || 0) / b.cap - (a.delta || 0) / a.cap)[0] || null;
        const size = (p) => { const A = postArea(p, lineThickness); return A ? { area: A } : null; };
        try {
          wr.ftao = ftaoDesign(w, ftaoCtx(w), getNailingById(wr.nailing.id), exactShares[w.id],
            { endPosts: [size(wr.postLeft), size(wr.postRight)], anchorage: softer, jambDL: jambDL(w) });
        } catch (e) { if (wr.ftao) wr.ftao.warnings.push('Final FTAO check failed: ' + ((e.errors || [e.message]).join('; '))); }
      }

      // Phase 5: LRFD envelopes (reported) and deflection / story drift
      const deflCtx = { sheathing, lineThickness, grade };
      for (const wr of Object.values(wallResultsMap)) {
        wr.lrfd = wr.accumLRFD || { tL: wr.lrfdTensionLeft, tR: wr.lrfdTensionRight, cL: wr.lrfdComprLeft, cR: wr.lrfdComprRight };
        wr.omega = wr.accumOmega || { asd: wr.omegaASD, lrfd: wr.omegaLRFD };
        wr.lrfdCapLeft = lrfdCap(wr.anchorageLeft);
        wr.lrfdCapRight = lrfdCap(wr.anchorageRight);
        wr.deflection = {};
        if (wr.method === 'wswh') {
          if (seismic && wr.wswh.delta1.E != null) wr.deflection.E = { method: 'WSWH table', label: 'WSWH table Δ (linear in V)', delta: r4(wr.wswh.delta1.E) };
          if (wind && alphaS > 0 && wr.wswh.delta1.W != null) wr.deflection.W = { method: 'WSWH table', label: 'WSWH table Δ (linear in V)', delta: r4(alphaS * wr.wswh.delta1.W) };
        } else if (wr.method === 'ftao') {
          for (const lt of ['E', 'W']) {
            const d = wr.ftao && wr.ftao.perType[lt] && wr.ftao.perType[lt].deflection;
            if (d) wr.deflection[lt] = { method: 'FTAO — APA T555 pier cases, SDPWS Eq. 4.3-1', delta: r4(d.Delta_in), cases: d.cases };
          }
        } else {
          if (seismic) wr.deflection.E = wallDeflection(wr, 'E', 1.0, deflCtx);
          if (wind && alphaS > 0) wr.deflection.W = wallDeflection(wr, 'W', alphaS, deflCtx);
        }
        wr.onBeam = loadPath.wallDeliveries.some(d => d.wallId === wr.wallId && d.receiver.type === 'beam');
        // Stiffness k = V/δ (lb/in) at the 1.0 level — used by the deflection approach
        wr.stiffness = {};
        for (const lt of ftaoLoadTypes(loadType)) {
          if (wr.method === 'wswh') {
            if (wr.wswh.k[lt] > 0) wr.stiffness[lt] = wr.wswh.k[lt];
          } else if (wr.method === 'ftao') {
            const r = wr.ftao && wr.ftao.perType[lt];
            if (r && r.stiffness > 0) wr.stiffness[lt] = r.stiffness;
          } else {
            const share = lt === 'E' ? wr.shareExact_1E : wr.shareExact_1W;
            const d = lt === 'E' ? wr.deflection.E : wallDeflection(wr, 'W', 1.0, deflCtx);
            if (d && d.delta > 0 && share > 0) wr.stiffness[lt] = share * 1000 / d.delta;
            (wr.stiffnessDefl = wr.stiffnessDefl || {})[lt] = d || null; // Eq. 4.3-1 terms behind k (1.0 level)
          }
        }
        // δ (in) of this wall at a trial share Vk (k), 1.0 level — the deflection distribution solves for equal δ with
        // it. Sheathed walls: SDPWS Eq. 4.3-1 with the forces from above held; WSWH / FTAO: linear, δ = V/k.
        // Not part of the stored results (non-enumerable).
        // opt.signed: allow Vk < 0 (free split, information only); opt.trial: { anchorage, postLeft, postRight } to try
        // on this wall instead of its own hardware (holdown check of a zero-share wall).
        Object.defineProperty(wr, '_deltaAt', { enumerable: false, configurable: true, value: (lt, Vk, opt = {}) => {
          if (wr.method === 'wswh' || wr.method === 'ftao') { const k = wr.stiffness[lt]; return k > 0 ? Vk * 1000 / k : null; }
          const w = opt.trial ? { ...wr, anchorageLeft: opt.trial.anchorage, anchorageRight: opt.trial.anchorage, postLeft: opt.trial.postLeft, postRight: opt.trial.postRight } : wr;
          const d = wallDeflectionAtShare(w, lt, Vk, deflCtx, !!opt.signed);
          return d ? d.deltaExact : null;
        } });
        Object.defineProperty(wr, '_trials', { enumerable: false, configurable: true, value: () => anchorageTrials(wr, lineThickness) });
      }
      const drift = storyDrift(perLevel, inputs, { seismic, wind, alphaS });

      return {
        lineId: line.id, lineName: line.name || '', perLevel,
        beamTransfers: loadPath.beamTransfers, postPaths: loadPath.postPaths,
        wallDeliveries: loadPath.wallDeliveries, comboGroups: loadPath.comboGroups,
        loadPathAudit: loadPath.loadPathAudit,
        drift,
      };
    };
    const perLine = (dir.lines || []).map(line => {
      const res = sizeForDrift(line, inputs, levels, (floor) => solveDistribution(line, inputs, levels, (ln, forced) => runLine(ln, forced, floor)), anchorageTableOfLevel);
      const ck = lineChecks(line, res, { inputs, levels, rho: dir.rho });
      res.checks = ck.checks; res.checksFailed = ck.failed;
      return res;
    });

    return { dirId: dir.id, dirName: dir.name || '', rho: parseFloat(dir.rho) || 1, perLine };
  });

  return { calcVersion: CALC_VERSION, perDirection };
}

// Anchorage at a WSWH end for ASD tension T (kips): Table 06 row (concrete / stacked base),
// TSS rod (stacked 2nd story), or "by RDP" (raised floor)
function wswhAnchorFor(w, info, T, inputs) {
  if (!info) return null;
  if (info.role === 'raised') return RAISED_ANCHOR;
  if (info.role === 'stackedUpper') return T * 1000 <= WSWH_ROD.cap + 1e-6 ? WSWH_ROD : null;
  return selectWswhAnchor(T * 1000, { fc: inputs.wswhFc || '2500', sdc: inputs.seismicDesignCategory, detached: !!inputs.detachedOneTwoFamily,
    width: info.width, override: w.wswhAnchorOverride || '' });
}

// Wall result of a WSWH panel, in the shape the rest of the calc / UI uses (plf fields = lb over the panel width)
function wswhWallResult(w, info, sh, c) {
  const widthFt = wswhWidthFt(w);
  const ok = !info.errors.length;
  const lk = info.look;
  const f = { E: 0.7 * c.rhoN, W: 0.6 };
  const V1 = { E: sh.seismic, W: sh.wind };                    // 1.0-level shares (k)
  const Vd = { E: f.E * V1.E * 1000, W: f.W * V1.W * 1000 };   // ASD demand (lb)
  const Vcap = { E: ok ? lk.E.V.E : 0, W: ok ? lk.W.V.W : 0 };
  const He = ok ? lk.E.He : 0, B = ok ? lk.E.B : 0;
  const dc = {}, stacked = {}, otm1 = {}, delta1 = {}, k = {};
  for (const lt of ['E', 'W']) {
    const Heft = He / 12;
    otm1[lt] = V1[lt] * Heft;
    if (ok && info.role === 'stackedLower' && c.upper && !c.upper.errors.length) {
      const up = c.upper, uSh = c.upperShare || { seismic: 0, wind: 0 };
      const V2 = lt === 'E' ? uSh.seismic : uSh.wind;
      const H2 = up.look[lt].He, dfl = parseFloat(up.wall.wswhFloorDepth) || 0;
      // Moment check at the ASD level; 1.0-level OTM (k·ft) for the end forces of every combo
      stacked[lt] = stackedBaseCheck({ V0: Vcap[lt], H1: He, H2, dfl, V1: Vd[lt], V2: f[lt] * V2 * 1000 });
      stacked[lt].H2 = H2; stacked[lt].dfl = dfl;
      stacked[lt].V1k = V1[lt]; stacked[lt].V2k = V2; // 1.0-level shears (k) of the base and upper panel, for the M_OT breakdown
      otm1[lt] = (V1[lt] * He + V2 * (He + dfl + H2)) / 12;
      dc[lt] = stacked[lt].dc;
      // Δ₁ = Δ₀·M_d/M_allow at the 1.0 level
      const M1 = (V1[lt] * 1000 * He + V2 * 1000 * (He + dfl + H2)) / 12;
      delta1[lt] = stacked[lt].Mallow > 0 ? lk[lt].D[lt] * M1 / stacked[lt].Mallow : null;
    } else {
      dc[lt] = Vcap[lt] > 0 ? Vd[lt] / Vcap[lt] : (Vd[lt] > 0 ? 9.99 : 0);
      delta1[lt] = Vcap[lt] > 0 ? lk[lt].D[lt] * V1[lt] * 1000 / Vcap[lt] : null; // strength level: linear extrapolation
    }
    // Panel stiffness from the table (V_cap / Δ_cap, lb/in)
    k[lt] = ok && lk[lt].D[lt] > 0 ? Vcap[lt] / lk[lt].D[lt] : 0;
  }
  const seismicDC = c.seismic ? r2(dc.E) : 0, windDC = c.wind ? r2(dc.W) : 0;
  let dcRatio, dcGoverning;
  if (c.loadType === 'seismic') { dcRatio = seismicDC; dcGoverning = 'seismic'; }
  else if (c.loadType === 'wind') { dcRatio = windDC; dcGoverning = 'wind'; }
  else { dcGoverning = seismicDC >= windDC ? 'seismic' : 'wind'; dcRatio = Math.max(seismicDC, windDC); }
  if (!ok) dcRatio = Math.max(dcRatio, 9.99);

  const D = info.grav.dlTotal;
  const half = (x) => ({ total: x.total, rL: x.total / 2, rR: x.total / 2 }); // concentric on the panel (Simpson T = V·H/B − P/2)
  const live = { L: half(info.grav.live.L), Lr: half(info.grav.live.Lr) };
  const tc = computeWallTC(sh.seismic, sh.wind, D, widthFt, c.floorH, c.rho, c.sds, c.loadType, {
    omega0: c.omega0, rL: D / 2, rR: D / 2, live, lrfdHalfL: c.lrfdHalfL, arm: B / 12, h: He / 12,
    ...(info.role === 'stackedLower' && stacked.E ? { otm1E: otm1.E } : {}),
    ...(info.role === 'stackedLower' && stacked.W ? { otm1W: otm1.W } : {}),
  });
  const anchorageLeft = wswhAnchorFor(w, info, tc.governingTensionLeft, c.inputs);
  const anchorageRight = wswhAnchorFor(w, info, tc.governingTensionRight, c.inputs);
  const plf = (lb) => r2(lb / widthFt);
  const ev = lk.E && !lk.E.error ? lk.E : lk.W;
  const wr = {
    wallId: w.id, mark: w.mark || '', position: parseFloat(w.position) || 0, length: widthFt,
    method: 'wswh', openingsIgnored: false,
    hOverB: null, hOverBFlag: false, hbReductionFactor: 1, hbNotPermitted: false,
    share_1E: r2(sh.seismic), share_1W: r2(sh.wind), shareExact_1E: sh.seismic, shareExact_1W: sh.wind,
    relStiffness: c.relStiffness, totalCapLen: r2(c.totalCapLenE),
    unitShear_seismic: plf(Vd.E), unitShear_wind: plf(Vd.W), unitShear_ASD: plf(dcGoverning === 'wind' ? Vd.W : Vd.E),
    nailing: { id: 'wswh', label: ok ? ev.evalModel : 'WSWH' + info.width + ' (not tabulated)', sides: 0 },
    capacity: plf(dcGoverning === 'wind' ? Vcap.W : Vcap.E), effectiveCapacity: plf(dcGoverning === 'wind' ? Vcap.W : Vcap.E),
    seismicCap: plf(Vcap.E), windCap: plf(Vcap.W), effectiveSeismicCap: plf(Vcap.E), effectiveWindCap: plf(Vcap.W),
    seismicDC, windDC, dcRatio: r2(dcRatio), dcGoverning,
    dlWallSelf: info.grav.wallSelfDL, dlFromDiagram: info.grav.diagramDL, dlTotal: info.grav.dlTotal, dlRL: D / 2, dlRR: D / 2,
    live, gravRows: info.grav.loadRows,
    floorH: c.floorH, anchorageType: 'wswh', anchorageLeft, anchorageRight,
    postLeft: WSWH_PANEL_POST, postRight: WSWH_PANEL_POST, postRaised: { left: null, right: null },
    ftao: null,
    wswh: {
      ok, errors: info.errors, condition: info.condition, role: info.role, width: info.width,
      evalModel: ok ? ev.evalModel : null, orderModel: ok ? ev.orderModel : null, kit: ok ? ev.kit : '', table: ev.table,
      He, B, P: { E: r0(info.P.E), W: r0(info.P.W) }, Vd: { E: r0(Vd.E), W: r0(Vd.W) }, Vcap: { E: r0(Vcap.E), W: r0(Vcap.W) },
      Dcap: { E: ok ? lk.E.D.E : null, W: ok ? lk.W.D.W : null }, dc: { E: r2(dc.E), W: r2(dc.W) }, stacked, delta1, k,
      notes: ok ? [...new Set([...lk.E.notes, ...lk.W.notes])] : [], upperId: info.upperId || null, lowerId: info.lowerId || null,
      fromAbove: info.fromAbove || null,
      floorDepth: parseFloat(w.wswhFloorDepth) || 0,
    },
    ...tc,
  };
  computeHardwareDC(wr);
  wr.postDCLeft = null; wr.postDCRight = null;
  return wr;
}
function r0(v) { return Math.round(v); }

export const DISTRIBUTION_METHODS = [
  { id: 'capacity', label: 'Wall capacity (SDPWS 4.3.3.4.1)' },
  { id: 'deflection', label: 'Deflection — equal δ (relative stiffness)' },
];
// Line setting ('' = project default) over the project default; capacity when unset
export function lineDistribution(inputs, line) {
  const m = (line && line.distribution) || inputs.distribution;
  return m === 'deflection' ? 'deflection' : 'capacity';
}

const DIST_SHARE_TOL = 0.001; // k — the split is final when no share changes by more than this between passes
const DIST_MAX_PASSES = 20;
const FROM_ABOVE_NOTE = 0.5;  // note a wall when δ(0)/δ* > 0.5: more than half its δ comes from the forces above

// Deflection spread of a line result: per level and load type, (δmax − δmin) / δmax over the walls
// carrying shear, with δ = V/k at the 1.0 level. Levels where a wall has no stiffness are skipped.
function deflectionSpread(res, lts) {
  const rows = [];
  for (const pl of res.perLevel) {
    for (const lt of lts) {
      const ds = [];
      let complete = true;
      for (const w of pl.walls) {
        const V = (lt === 'E' ? w.shareExact_1E : w.shareExact_1W) || 0;
        if (w.hbNotPermitted || !(V > 0)) continue;
        const k = w.stiffness && w.stiffness[lt];
        if (!(k > 0)) { complete = false; continue; }
        ds.push({ mark: w.mark, delta: V * 1000 / k });
      }
      if (!complete || ds.length < 2) continue;
      const max = ds.reduce((a, d) => (d.delta > a.delta ? d : a));
      const min = ds.reduce((a, d) => (d.delta < a.delta ? d : a));
      rows.push({ levelName: pl.levelName, loadType: lt, spread: r4((max.delta - min.delta) / max.delta),
        deltaMax: r4(max.delta), deltaMin: r4(min.delta), maxMark: max.mark, minMark: min.mark });
    }
  }
  return { spread: rows.reduce((a, r) => Math.max(a, r.spread), 0), rows };
}

// Equal-deflection split of a story shear V (k) among walls, each with δ_i(V_i) from its own deflection equation
// (increasing in V_i). Finds the common δ* with Σ V_i(δ*) = V, V_i(δ*) = the share that gives wall i δ*.
// A wall already at or above δ* with no share of its own (rotated by the forces from above) takes 0.
// fns: [(Vk) => δ in] → { delta, shares: [k], zero: [bool], delta0: [in] }
export function equalDeflectionSplit(V, fns) {
  const bisect = (f, lo, hi, n = 80) => { for (let i = 0; i < n; i++) { const m = (lo + hi) / 2; if (f(m)) hi = m; else lo = m; } return (lo + hi) / 2; };
  const d0 = fns.map(f => f(0)), dV = fns.map(f => f(V));
  const shareAt = (i, target) => (d0[i] >= target ? 0 : dV[i] <= target ? V : bisect(v => fns[i](v) >= target, 0, V));
  const sumAt = (target) => fns.reduce((a, _, i) => a + shareAt(i, target), 0);
  const delta = bisect(t => sumAt(t) >= V, Math.min(...d0), Math.max(...dV));
  const shares = fns.map((_, i) => shareAt(i, delta));
  const sum = shares.reduce((a, s) => a + s, 0);
  const scaled = sum > 0 ? shares.map(s => s * V / sum) : shares; // removes the bisection remainder so Σ = V exactly
  return { delta, shares: scaled, zero: scaled.map(s => s === 0), delta0: d0 };
}

// The same equal-δ split without the V_i ≥ 0 limit (information only): a wall rotated by the forces from above more
// than the story deflects gets a negative share (it pushes back), and the other walls carry more than V together.
// fns: [(Vk) => δ in], defined for Vk < 0 too (signed). Shares searched in [−2V, 3V]; bounded = a share hit a bound.
export function freeDeflectionSplit(V, fns) {
  const bisect = (f, lo, hi, n = 80) => { for (let i = 0; i < n; i++) { const m = (lo + hi) / 2; if (f(m)) hi = m; else lo = m; } return (lo + hi) / 2; };
  const lo = -2 * V, hi = 3 * V;
  const dLo = fns.map(f => f(lo)), dHi = fns.map(f => f(hi));
  if ([...dLo, ...dHi].some(d => d == null || !Number.isFinite(d))) return null;
  const shareAt = (i, target) => (dLo[i] >= target ? lo : dHi[i] <= target ? hi : bisect(v => fns[i](v) >= target, lo, hi));
  const delta = bisect(t => fns.reduce((a, _, i) => a + shareAt(i, t), 0) >= V, Math.min(...dLo), Math.max(...dHi));
  const shares = fns.map((_, i) => shareAt(i, delta));
  return { delta, shares, bounded: shares.some(s => s <= lo + 1e-6 || s >= hi - 1e-6) };
}

// Holdown / strap check of a zero-share wall: every catalog anchorage larger than its current one (same family:
// HDUE stays HDUE, MSTC stays MSTC in the same span table), at both ends, with each end post raised to the
// anchorage's minimum post when it is smaller. Sheathed walls only.
export function anchorageTrials(wr, thickness) {
  if (wr.method !== 'wall' || !wr.anchorageLeft || !wr.anchorageRight || !wr.postLeft || !wr.postRight) return [];
  const table = [HDUE_TABLE, ...Object.values(MSTC_TABLE)].find(t => t.includes(wr.anchorageLeft))
    || [HDUE_TABLE, ...Object.values(MSTC_TABLE)].find(t => t.some(a => a.id === wr.anchorageLeft.id && a.cap === wr.anchorageLeft.cap));
  if (!table) return [];
  const cur = Math.max(wr.anchorageLeft.cap || 0, wr.anchorageRight.cap || 0);
  return table.filter(a => a.cap > cur).map(a => {
    const min = hdueMinPost(a, thickness);
    const end = (p) => (meetsMinPost(p, min) ? p : { postId: min.id, postLabel: min.label });
    return { anchorage: a, postLeft: end(wr.postLeft), postRight: end(wr.postRight) };
  });
}

// After the final split, at each story with a zero-share wall: the free split (shares without the ≥ 0 limit) and,
// for each zero-share wall, the share it would take with each larger holdown / strap (the other walls' δ held;
// the walls above do not depend on this wall, so the story split is exact for the trial hardware).
function zeroShareFollowUp(res, levels) {
  for (const l of levels) {
    if (!l.walls.some(w => w.zeroShare)) continue;
    const pl = res.perLevel.find(p => p.levelId === l.levelId);
    const walls = pl ? l.walls.map(lw => pl.walls.find(w => w.wallId === lw.wallId)) : [];
    if (!walls.length || walls.some(w => !w || !w._deltaAt)) continue;
    const lt = l.loadType;
    const fr = freeDeflectionSplit(l.V, walls.map(w => (Vk) => w._deltaAt(lt, Vk, { signed: true })));
    if (fr) {
      l.free = { delta: r4(fr.delta), bounded: fr.bounded };
      l.walls.forEach((lw, i) => { lw.freeShare = r4(fr.shares[i]); lw.extra = r4(fr.shares[i] - lw.share); });
    }
    const plain = walls.map(w => (Vk) => w._deltaAt(lt, Vk));
    l.walls.forEach((lw, i) => {
      if (!lw.zeroShare) return;
      lw.remedy = walls[i]._trials().map(t => {
        const fns = plain.map((f, j) => (j === i ? (Vk) => walls[i]._deltaAt(lt, Vk, { trial: t }) : f));
        if (fns[i](0) == null || fns[i](l.V) == null) return null;
        const s = equalDeflectionSplit(l.V, fns);
        const post = t.postLeft.postLabel === t.postRight.postLabel ? t.postLeft.postLabel : t.postLeft.postLabel + ' / ' + t.postRight.postLabel;
        return { anchorage: t.anchorage.id, post, delta0: r4(s.delta0[i]), share: r4(s.shares[i]) };
      }).filter(Boolean);
      lw.remedyFirst = lw.remedy.find(r => r.share > 0.0005) || null;
    });
  }
}

// Distribution warnings (user rule 2026-10-01): a zero-share wall (with its holdown check and the other fixes),
// and the walls at that story carrying more than designed because the zero share leaves out the push-back.
function distributionWarnings(levels) {
  const out = [];
  const k = (v) => v.toFixed(2) + ' k';
  for (const l of levels) {
    const zeros = l.walls.filter(w => w.zeroShare);
    if (!zeros.length) continue;
    const tag = ' (' + l.levelName + ', 1.0' + l.loadType + ')';
    for (const w of zeros) {
      const rem = w.remedy || [];
      const check = !rem.length ? 'no larger holdown / strap in the catalog to try'
        : !w.remedyFirst ? 'no holdown / strap in the catalog gives it a share (' + rem.map(r => r.anchorage + ' + ' + r.post + ' → δ(0) ' + r.delta0.toFixed(3) + ' in').join(', ') + ')'
        : rem.map(r => r.anchorage + ' + ' + r.post + ' → ' + k(r.share)).join(', ') + ' (estimate; set the override and recalculate to confirm)';
      out.push({ type: 'dist_zero_share', level: 'warn', elementId: w.wallId, elementMark: w.mark, levelId: l.levelId, levelName: l.levelName, loadType: l.loadType,
        message: w.mark + tag + ' takes no story shear: the forces from the walls above rotate it ' + w.delta0.toFixed(3) + ' in at zero own share, more than the story deflects ('
          + l.delta.toFixed(3) + ' in). Holdown check: ' + check + '. Other fixes: a longer ' + w.mark + '; less force from the walls stacked on it (stiffen the walls beside that stack, or soften the stack); '
          + 'walls at this story that are stiffer than their strength needs make ' + w.mark + ' take less — check their nailing and holdowns.' });
    }
    const more = l.walls.filter(w => !w.zeroShare && w.extra > 0.0005);
    if (!more.length) continue;
    const back = zeros.filter(w => w.freeShare < -0.0005);
    out.push({ type: 'dist_under_load', level: 'big', levelId: l.levelId, levelName: l.levelName, loadType: l.loadType,
      walls: more.map(w => ({ wallId: w.wallId, mark: w.mark, design: w.share, free: w.freeShare, extra: w.extra })),
      message: 'The other walls at ' + l.levelName + ' carry more than designed (1.0' + l.loadType + '). At equal deflection '
        + (back.length ? back.map(w => w.mark + ' would push back ' + k(-w.freeShare)).join(', ') : zeros.map(w => w.mark).join(', ') + ' would push back')
        + ', so ' + more.map(w => w.mark + ' carries ' + k(w.freeShare) + ' but is designed for ' + k(w.share) + ' (+' + (w.share > 0 ? (100 * w.extra / w.share).toFixed(1) + ' %' : k(w.extra)) + ')').join(', ')
        + '. Check these walls — more wall may be needed.' + (l.free && l.free.bounded ? ' (Free split hit its search bound — values approximate.)' : '') });
  }
  for (const w of out) w.key = [w.type, w.levelId, w.loadType, w.elementId || ''].join('|');
  return out;
}

// Engineer review of the distribution warnings (line.distReviewed: [{ key, message, date }]). A review holds only while
// the warning reads the same; when its values change it is stale and the warning counts again.
export function applyDistReviews(warnings, reviewed) {
  const list = Array.isArray(reviewed) ? reviewed : [];
  for (const w of warnings) {
    const r = list.find(x => x && x.key === w.key);
    w.reviewed = !!r && r.message === w.message;
    w.reviewStale = !!r && r.message !== w.message;
    w.reviewDate = r ? r.date || '' : '';
  }
  return warnings;
}

// Deflection approach: walls at a story deflect equally (rigid diaphragm). Each wall's δ is its own deflection
// equation at its share — sheathed walls SDPWS Eq. 4.3-1 (3 terms) with the end forces of that wall, own + from the
// walls above, as used everywhere else. At each story the shares are found where every wall gives the same δ and
// Σ V = story shear (equalDeflectionSplit). The forces from above and the hardware depend on the shares, so the line
// is recalculated and re-split until no share moves more than 0.001 k (max 20 passes; else the pass with the
// smallest change is used and flagged). Starts from the capacity shares.
function solveDistribution(line, inputs, levels, runLine) {
  let res = runLine(line, null);
  if (lineDistribution(inputs, line) !== 'deflection') {
    res.distribution = { method: 'capacity' };
    return res;
  }
  const storyShears = accumulateStoryShear(line.levelLoads || {}, levels);
  const lts = inputs.loadType === 'wind' ? ['W'] : inputs.loadType === 'both' ? ['E', 'W'] : ['E'];
  const cur = (w, lt) => (lt === 'E' ? w.shareExact_1E : w.shareExact_1W) || 0;
  // One split of every story from the walls of a result; kept = levels where a wall has no deflection yet
  const splitOf = (r) => {
    const next = { E: {}, W: {} }, kept = new Set(), levelsOut = [];
    for (const pl of r.perLevel) {
      const ss = storyShears[pl.levelId] || { seismic: 0, wind: 0 };
      for (const lt of lts) {
        const V = lt === 'E' ? ss.seismic : ss.wind;
        const active = pl.walls.filter(w => !w.hbNotPermitted);
        pl.walls.forEach(w => { next[lt][w.wallId] = w.hbNotPermitted ? 0 : cur(w, lt); });
        if (!(V > 0) || !active.length) continue;
        const fns = active.map(w => (Vk) => (w._deltaAt ? w._deltaAt(lt, Vk) : null));
        if (fns.some(f => f(0) == null || f(V) == null)) { kept.add(pl.levelName || pl.levelId); continue; }
        const s = equalDeflectionSplit(V, fns);
        active.forEach((w, i) => { next[lt][w.wallId] = s.shares[i]; });
        levelsOut.push({ levelId: pl.levelId, levelName: pl.levelName, loadType: lt, V: r4(V), delta: r4(s.delta),
          walls: active.map((w, i) => ({ wallId: w.wallId, mark: w.mark, share: r4(s.shares[i]), delta0: r4(s.delta0[i]),
            fromAboveRatio: s.delta > 0 ? r4(s.delta0[i] / s.delta) : null, zeroShare: s.zero[i] })) });
      }
    }
    return { next, kept, levels: levelsOut };
  };
  const change = (r, next) => Math.max(0, ...r.perLevel.flatMap(pl => pl.walls.flatMap(w => lts.map(lt => Math.abs((next[lt][w.wallId] || 0) - cur(w, lt))))));
  let split = splitOf(res);
  let passes = 0, moved = change(res, split.next);
  let best = { res, split, moved: Infinity };
  while (moved > DIST_SHARE_TOL && passes < DIST_MAX_PASSES) {
    res = runLine(line, split.next);
    passes++;
    split = splitOf(res);
    moved = change(res, split.next);
    if (moved < best.moved) best = { res, split, moved };
  }
  const converged = moved <= DIST_SHARE_TOL;
  const out = converged ? { res, split, moved } : best;
  const sp = deflectionSpread(out.res, lts);
  zeroShareFollowUp(out.res, out.split.levels);
  const noted = out.split.levels.flatMap(l => l.walls.filter(w => w.zeroShare || (w.fromAboveRatio != null && w.fromAboveRatio > FROM_ABOVE_NOTE))
    .map(w => ({ ...w, levelName: l.levelName, loadType: l.loadType, storyDelta: l.delta })));
  out.res.distribution = {
    method: 'deflection', passes, converged, shareChange: r4(out.moved), shareTolerance: DIST_SHARE_TOL,
    spread: sp.spread, spreadRows: sp.rows, levels: out.split.levels, fromAboveLimit: FROM_ABOVE_NOTE, noted,
    warnings: applyDistReviews(distributionWarnings(out.split.levels), line.distReviewed),
    note: out.split.kept.size ? 'Capacity shares kept at ' + [...out.split.kept].join(', ') + ': a wall has no deflection (no post / hardware selected or no load)' : null,
  };
  // zero-share walls are distribution warnings (above); a wall mostly displaced from above stays an ⓘ note
  for (const n of noted.filter(x => !x.zeroShare)) {
    out.res.loadPathAudit.notes.push({ type: 'dist_from_above', elementId: n.wallId, elementMark: n.mark, levelName: n.levelName,
      message: n.mark + ' (' + n.levelName + ', 1.0' + n.loadType + '): ' + n.fromAboveRatio.toFixed(2) + ' of its deflection comes from the forces of the walls above (δ = '
        + n.delta0.toFixed(3) + ' in at zero own share, story δ ' + n.storyDelta.toFixed(3) + ' in) — it takes little story shear; a larger holdown / strap on this wall reduces the rotation' });
  }
  return out.res;
}

// Drift check mode of a line: line setting ('' = project default) over the project default.
// 'check' = drift is a design check and auto nailing is raised until it passes; 'bypass' = report only.
export function lineDriftMode(inputs, line) {
  const m = line && line.driftBypass;
  if (m === 'bypass' || m === 'check') return m;
  return inputs && inputs.driftBypass ? 'bypass' : 'check';
}

const DRIFT_SIZING_MAX_STEPS = 40;

// Anchorage catalog a wall end is picked from: HDUE, or the MSTC table of the floor clear span
export function anchorageTable(useHoldown, floorSpan) {
  return useHoldown ? HDUE_TABLE : (MSTC_TABLE[String(floorSpan)] || MSTC_TABLE['16']);
}
// Auto anchorage never below the drift-sizing floor (index in its table). OVER (null) stays OVER.
export function anchorageWithFloor(pick, table, floorIdx) {
  if (!pick || floorIdx == null) return pick;
  const i = table.findIndex(a => a.id === pick.id);
  return i >= 0 && floorIdx > i ? table[Math.min(floorIdx, table.length - 1)] : pick;
}

// Drift sizing (user rules 2026-09-29 / 2026-09-30; both ends go to one size above the larger end). After the strength design, at each story whose drift fails
// (δx > Δa), take the wall whose δ sets the story drift and estimate from its SDPWS Eq. 4.3-1 terms (governing
// direction) which single step cuts its δ more:
//   nailing   — the story's common-pattern step (every auto wall to the heaviest pattern among them, or one heavier
//               once they are equal): Δδ = vh/(1000·Ga) · (1 − Ga / Ga,new) on the governing wall;
//   anchorage — the governing wall's auto holdown / strap one size up at both ends:
//               Δδ = (h/b) · (δ_cap·T/P_δ − δ_cap,new·T/P_δ,new) (slip only; a larger minimum post is not estimated).
// The larger saving is applied; when one step is not available (manual, override, heaviest / largest size, OVER,
// FTAO / WSWH) the other is used. The line is redesigned after each round, until every story passes or nothing is
// left to raise. Nailing and anchorage are floors: strength can still pick heavier. h/b > 3.5 walls are left alone.
function sizeForDrift(line, inputs, levels, solve, ancTableOf) {
  const mode = lineDriftMode(inputs, line);
  const sheathing = inputs.sheathing === 'osb' ? 'osb' : 'ply';
  const floor = { nail: {}, anc: {} };
  let res = solve(floor);
  const ngRows = (r) => ((r.drift && r.drift.rows) || []).filter(x => x.seismic && x.seismic.pass === false);
  const nIdx = (id) => NAILING_TABLE.findIndex(n => n.id === id);
  let steps = 0;
  const stuck = new Set();
  const log = [];
  if (mode === 'check') {
    while (steps < DRIFT_SIZING_MAX_STEPS) {
      const ng = ngRows(res);
      if (!ng.length) break;
      let bumped = false;
      for (const row of ng) {
        const pl = res.perLevel.find(p => p.levelId === row.levelId);
        const walls = pl ? pl.walls : [];
        const gov = walls.find(w => w.wallId === row.seismic.wallId);
        const d = gov && gov.deflection && gov.deflection.E;
        const g = d && d.dirs ? (d.dirs[0].delta >= d.dirs[1].delta ? d.dirs[0] : d.dirs[1]) : null;

        // Option 1: nailing — the story's common-pattern step
        let nail = null;
        const cands = walls.filter(w => w.nailingBasis !== 'manual' && w.method !== 'wswh' && !w.hbNotPermitted && w.deflection && w.deflection.E);
        if (cands.length) {
          const hi = Math.max(...cands.map(w => nIdx(w.nailing.id)));
          const target = cands.every(w => nIdx(w.nailing.id) === hi) ? hi + 1 : hi; // equalize first, then step all together
          if (target <= NAILING_TABLE.length - 1) {
            let save = 0;
            if (g && cands.includes(gov) && target > nIdx(gov.nailing.id)) {
              const ga0 = gaFor(getNailingById(gov.nailing.id), sheathing), ga1 = gaFor(NAILING_TABLE[target], sheathing);
              save = ga0 > 0 && ga1 > 0 ? g.t2 * (1 - ga0 / ga1) : 0;
            }
            nail = { target, save, walls: cands };
          }
        }

        // Option 2: anchorage — the governing wall's auto holdown / strap one size up (both ends)
        let anc = null;
        if (g && gov.method === 'wall' && !gov.hbNotPermitted && gov.anchorageBasis) {
          const side = g.dir === '→' ? 'left' : 'right';
          const cur = side === 'left' ? gov.anchorageLeft : gov.anchorageRight;
          const t = ancTableOf(row.levelId).table;
          const autoSides = ['left', 'right'].filter(sd => gov.anchorageBasis[sd].basis !== 'manual');
          const idxOf = (sd) => t.findIndex(a => a.id === ((sd === 'left' ? gov.anchorageLeft : gov.anchorageRight) || {}).id);
          if (cur && autoSides.includes(side) && autoSides.every(sd => idxOf(sd) >= 0)) {
            const next = Math.max(...autoSides.map(idxOf)) + 1;
            if (next <= t.length - 1) {
              const T = side === 'left' ? d.T : d.C; // lb at the tension end of the governing direction
              const slip = (a) => { const b = deltaBasisLoad(a); return b > 0 && a.delta != null ? a.delta * T / b : 0; };
              const ends = autoSides.map(sd => (sd === 'left' ? 'L ' : 'R ') + ((sd === 'left' ? gov.anchorageLeft : gov.anchorageRight) || {}).id).join(' / ');
              anc = { next, save: (d.h / d.b) * (slip(cur) - slip(t[next])), from: ends, to: t[next].id };
            }
          }
        }

        const useAnc = anc && (!nail || anc.save > nail.save);
        const entry = { levelName: row.levelName, mark: gov ? gov.mark : row.seismic.wallMark, deltaX: row.seismic.deltaX, allowable: row.seismic.allowable,
          saveNailing: nail ? r4(nail.save) : null, saveAnchorage: anc ? r4(anc.save) : null };
        if (useAnc) {
          floor.anc[gov.wallId] = Math.max(floor.anc[gov.wallId] ?? -1, anc.next);
          log.push({ ...entry, action: 'anchorage', detail: gov.mark + ' ' + anc.from + ' → ' + anc.to });
        } else if (nail) {
          for (const w of nail.walls) floor.nail[w.wallId] = Math.max(floor.nail[w.wallId] || 0, nail.target);
          log.push({ ...entry, action: 'nailing', detail: 'auto walls at ' + row.levelName + ' → ' + NAILING_TABLE[nail.target].label });
        } else { stuck.add(row.levelName); continue; }
        bumped = true;
      }
      if (!bumped) break;
      steps++;
      res = solve(floor);
    }
  }
  const ng = ngRows(res).map(r => r.levelName);
  const allW = res.perLevel.flatMap(p => p.walls);
  const raised = allW.filter(w => w.nailingBasis === 'drift').map(w => w.mark);
  const raisedAnchorage = allW.filter(w => w.anchorageBasis && (w.anchorageBasis.left.basis === 'drift' || w.anchorageBasis.right.basis === 'drift')).map(w => w.mark);
  const what = [raised.length ? 'nailing at ' + raised.join(', ') : '', raisedAnchorage.length ? 'holdowns / straps at ' + raisedAnchorage.join(', ') : ''].filter(Boolean).join('; ');
  res.driftSizing = {
    mode, steps, raised, raisedAnchorage, log,
    ngLevels: ng,
    note: mode === 'bypass'
      ? 'Drift bypassed — report only: no drift upsizing, and drift NG does not fail the line.'
      : ng.length
        ? 'Drift still NG at ' + ng.join(', ') + ' with the heaviest auto nailing and anchorage' + (stuck.size ? ' (nothing left to upsize)' : '')
          + ' — bending (post size) may govern: override the posts, hardware or nailing, or add wall length.'
        : what ? 'Raised for drift: ' + what + ' (' + steps + ' step' + (steps !== 1 ? 's' : '') + ').' : null,
  };
  return res;
}

// Story drift per level of a line: δxe = largest wall deflection at that level (1.0E, ρ = 1);
// δx = Cd·δxe/Ie (ASCE 7-22 §12.8.6) vs Δa = limit·h_sx (Table 12.12-1). Wind: service, report only.
// Wind drift limit h_sx / n (project setting, default 400; user 2026-10-01)
export function windLimitDen(inputs) { const n = parseFloat(inputs && inputs.windDriftLimit); return n > 0 ? n : 400; }

function storyDrift(perLevel, inputs, { seismic, wind, alphaS }) {
  const cd = parseFloat(inputs.cd) || 0;
  const ie = parseFloat(inputs.ie) || 0;
  const limit = driftLimit(inputs.driftRow, inputs.riskCategory);
  const rows = [];
  for (const pl of perLevel) {
    if (!pl.walls.length) continue;
    const hsx = pl.walls[0].floorH;
    const maxOf = (lt) => pl.walls.reduce((best, w) => {
      const d = w.deflection && w.deflection[lt];
      return d && (!best || d.delta > best.delta) ? { delta: d.delta, mark: w.mark, wallId: w.wallId } : best;
    }, null);
    const row = { levelId: pl.levelId, levelName: pl.levelName, hsx };
    if (seismic) {
      const m = maxOf('E');
      row.seismic = m ? { deltaXE: m.delta, wallMark: m.mark, wallId: m.wallId } : null;
      if (row.seismic && cd > 0 && ie > 0) {
        const dx = cd * m.delta / ie;
        row.seismic.deltaX = r4(dx);
        row.seismic.ratio = hsx > 0 ? r4(dx / (12 * hsx)) : null;
        if (limit != null && hsx > 0) {
          row.seismic.limit = limit;
          row.seismic.allowable = r4(limit * hsx * 12);
          row.seismic.pass = dx <= limit * hsx * 12 + 1e-9;
        }
      }
    }
    if (wind && alphaS > 0) {
      const m = maxOf('W');
      const den = windLimitDen(inputs);
      row.wind = m ? { delta: m.delta, wallMark: m.mark, ratio: hsx > 0 ? r4(m.delta / (12 * hsx)) : null,
        limitDen: den, allowable: hsx > 0 ? r4(hsx * 12 / den) : null, pass: hsx > 0 ? m.delta <= hsx * 12 / den + 1e-9 : null } : null;
    }
    rows.push(row);
  }
  return {
    cd: cd || null, ie: ie || null, riskCategory: String(inputs.riskCategory || '').trim() || null, limit, windLimitDen: wind ? windLimitDen(inputs) : null,
    // why a drift is not computed (user report 2026-10-01: a wind-only line showed an empty Drift tab with no reason)
    missing: [
      seismic && !(cd > 0 && ie > 0) ? 'Cd and Ie are needed for δx — link the Seismic Base Shear item or enter them' : null,
      wind && !(alphaS > 0) ? 'Wind drift is computed only with the service-level wind factor α_s (Summary / Config → Deflection & Drift; blank = skipped). It is checked against h_sx / ' + windLimitDen(inputs) + ' (serviceability, report only)' : null,
    ].filter(Boolean).join('. ') || null,
    rows,
  };
}

export function findAnchorage(id, floorSpan) {
  const hd = HDUE_TABLE.find(h => h.id === id);
  if (hd) return hd;
  // Strap capacity depends on floor clear span — look in the level's span table first
  const spanTable = MSTC_TABLE[String(floorSpan)] || MSTC_TABLE['16'];
  const s1 = spanTable.find(t => t.id === id);
  if (s1) return s1;
  for (const table of Object.values(MSTC_TABLE)) {
    const s = table.find(t => t.id === id);
    if (s) return s;
  }
  return null;
}

// Post at a holdown / strap end / post base: the override if it meets the anchorage minimum post (P9), else auto.
// An override below the minimum is not used: the auto post (≥ minimum) is, with raised = true.
export function selectEndPost(overrideId, C, wallThickness, grade, floorH, anchorage) {
  const min = hdueMinPost(anchorage, wallThickness);
  if (overrideId) {
    const p = findPost(overrideId, wallThickness, grade, floorH);
    if (p && meetsMinPost(p, min)) return { post: p, raised: false };
    if (p) return { post: autoSelectPost(C, wallThickness, grade, floorH, min), raised: true, requested: overrideId, minPost: min.label };
  }
  return { post: autoSelectPost(C, wallThickness, grade, floorH, min), raised: false };
}

export function findPost(id, wallThickness, grade, floorH) {
  const allPosts = [...(POST_SIZES[wallThickness] || []), ...(POST_SIZES['4'] || []), ...(POST_SIZES['6'] || [])];
  const post = allPosts.find(p => p.id === id);
  if (!post) return null;
  return computePostCapacity(post, grade, floorH);
}

function r2(v) { return Math.round(v * 100) / 100; }
function r4(v) { return Math.round(v * 10000) / 10000; }

function computeHardwareDC(wr) {
  wr.anchorageDCLeft = wr.anchorageLeft && wr.anchorageLeft.cap > 0 ? r2(wr.governingTensionLeft * 1000 / wr.anchorageLeft.cap) : null;
  wr.anchorageDCRight = wr.anchorageRight && wr.anchorageRight.cap > 0 ? r2(wr.governingTensionRight * 1000 / wr.anchorageRight.cap) : null;
  wr.postDCLeft = wr.postLeft && wr.postLeft.capacityKips > 0 ? r2(wr.governingComprLeft / wr.postLeft.capacityKips) : null;
  wr.postDCRight = wr.postRight && wr.postRight.capacityKips > 0 ? r2(wr.governingComprRight / wr.postRight.capacityKips) : null;
}
