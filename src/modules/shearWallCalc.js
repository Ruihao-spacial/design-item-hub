import { NAILING_TABLE, autoSelectNailing, getNailingById } from './shearWallNailing.js';
import { autoSelectHoldown, autoSelectStrap, autoSelectPost, hdueMinPost, meetsMinPost, getGradeById, HDUE_TABLE, MSTC_TABLE, POST_SIZES, computePostCapacity, lrfdCap } from './shearWallHardware.js';
import { resolveVerticalLoadPath } from './shearWallLoadPath.js';
import { comboDefs } from './shearWallCombos.js';
import { gravityRows, wallGravity, gravityToElements } from './shearWallGravity.js';
import { aspectFactor } from './shearWallFtao.js';
import { expandWalls, hasOpenings, wallMethod, wallPiers, sortedOpenings } from './shearWallOpenings.js';
import { ftaoCapacityLbf, ftaoDesign, ftaoLoadTypes } from './shearWallFtaoAdapter.js';
import { wallDeflection, postArea, driftLimit } from './shearWallDeflection.js';
import { isWswh, wswhWidthIn, wswhWidthFt, lookupWswh, stackedBaseCheck, selectWswhAnchor, RAISED_ANCHOR, WSWH_ROD, WSWH_PANEL_POST, conditionLabel } from './shearWallWswh.js';

// Records which calc produced a stored results snapshot (results are always regenerated for display)
export const CALC_VERSION = 'v9';

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
    wallSelfDL: r2(wallSelfDL), diagramDL: r2(g.D.total), dlTotal: r2(total), rL: r4(total - rR), rR: r4(rR),
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
    otm1E: r2(VhE), otm1W: r2(VhW), arm: r4(arm),
  };
  // m > 0 overturns toward the right end (_pos): left end is the uplift side
  const endPair = (f, m) => {
    const g = (i) => f.d * R.D[i] + f.l * R.L[i] + f.lr * R.Lr[i];
    const netL = g(0) - m, netR = g(1) + m;
    return {
      group: f.group, f: { d: f.d, l: f.l, lr: f.lr, e: f.e, w: f.w }, text: f.text, ref: f.ref,
      tensionLeft: r2(Math.max(0, -netL)), comprLeft: r2(Math.max(0, netL)),
      tensionRight: r2(Math.max(0, -netR)), comprRight: r2(Math.max(0, netR)),
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
  return { tL: r2(tL), tR: r2(tR), cL: r2(cL), cR: r2(cR) };
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

  const perDirection = (inputs.directions || []).map(dir => {
    const rho = dir.rho;
    const rhoN = parseFloat(rho) || 1;
    // One pass over a line. forced: { E: { wallId: kips }, W: {…} } replaces capacity-based shares
    // (deflection approach); null = capacity-based distribution.
    const runLine = (line, forced) => {
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

      // Segmented walls → piers. Openings with bad geometry, and FTAO walls the engine rejects,
      // are designed as solid walls and reported in the audit.
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
      allWalls.forEach(w => {
        const manual = w.nailingPattern ? getNailingById(w.nailingPattern) : null;
        wallNailing[w.id] = manual || NAILING_TABLE[0];
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
            if (selected && selected.id !== prev.id) {
              wallNailing[w.id] = selected;
              changed = true;
            } else if (!selected) {
              const heaviest = NAILING_TABLE[NAILING_TABLE.length - 1];
              if (prev.id !== heaviest.id) { wallNailing[w.id] = heaviest; changed = true; }
            }
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
          } else if (useHoldown) {
            anchorageLeft = autoSelectHoldown(tc.governingTensionLeft);
          } else {
            anchorageLeft = autoSelectStrap(tc.governingTensionLeft, floorSpan);
          }
          if (w.anchorageRightOverride) {
            anchorageRight = findAnchorage(w.anchorageRightOverride, floorSpan);
          } else if (useHoldown) {
            anchorageRight = autoSelectHoldown(tc.governingTensionRight);
          } else {
            anchorageRight = autoSelectStrap(tc.governingTensionRight, floorSpan);
          }

          const selL = selectEndPost(w.postLeftOverride, tc.governingComprLeft, lineThickness, grade, floorH, anchorageLeft);
          const selR = selectEndPost(w.postRightOverride, tc.governingComprRight, lineThickness, grade, floorH, anchorageRight);
          const postLeft = selL.post, postRight = selR.post;

          const wallResult = {
            wallId: w.id, mark: w.mark || '', position: parseFloat(w.position) || 0, length: wLen,
            method: isFtao(w) ? 'ftao' : w.parentWallId ? 'pier' : 'wall',
            parentWallId: w.parentWallId || null, pierIndex: w.pierIndex ?? null,
            openingsIgnored: !!w._openingsIgnored,
            hOverB: arInfo.hOverB, hOverBFlag: arInfo.flag, hbReductionFactor: arInfo.reductionFactor,
            hbNotPermitted: !!arInfo.notPermitted,
            share_1E: r2(sh.seismic), share_1W: r2(sh.wind),
            shareExact_1E: sh.seismic, shareExact_1W: sh.wind,
            relStiffness, totalCapLen: r2(totalCapLenE),
            unitShear_seismic: r2(seismicPlf), unitShear_wind: r2(windPlf),
            unitShear_ASD: r2(unitShearASD),
            nailing: { id: n.id, label: n.label, sides: n.sides },
            capacity: dcGoverning === 'wind' ? n.asdW : n.asdE,
            effectiveCapacity: r2(effCap),
            seismicCap: n.asdE, windCap: n.asdW,
            effectiveSeismicCap: r2(sheathCapE), effectiveWindCap: r2(sheathCapW),
            seismicDC, windDC, dcRatio, dcGoverning,
            dlWallSelf: grav.wallSelfDL, dlFromDiagram: grav.diagramDL, dlTotal: grav.dlTotal, dlRL: r2(grav.rL), dlRR: r2(grav.rR),
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
        wallHardware: (w, T) => (isWswh(w) ? wswhAnchorFor(w, wswh[w.id], T, inputs) : undefined),
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
      // P9: a post override below the HDUE minimum post is not used
      const raisedMsg = (r, what) => what + ' override ' + r.requested + ' is below the HDUE minimum post ' + r.minPost
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
    const perLine = (dir.lines || []).map(line => solveDistribution(line, inputs, levels, runLine));

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
    method: 'wswh', parentWallId: null, pierIndex: null, openingsIgnored: false,
    hOverB: null, hOverBFlag: false, hbReductionFactor: 1, hbNotPermitted: false,
    share_1E: r2(sh.seismic), share_1W: r2(sh.wind), shareExact_1E: sh.seismic, shareExact_1W: sh.wind,
    relStiffness: c.relStiffness, totalCapLen: r2(c.totalCapLenE),
    unitShear_seismic: plf(Vd.E), unitShear_wind: plf(Vd.W), unitShear_ASD: plf(dcGoverning === 'wind' ? Vd.W : Vd.E),
    nailing: { id: 'wswh', label: ok ? ev.evalModel : 'WSWH' + info.width + ' (not tabulated)', sides: 0 },
    capacity: plf(dcGoverning === 'wind' ? Vcap.W : Vcap.E), effectiveCapacity: plf(dcGoverning === 'wind' ? Vcap.W : Vcap.E),
    seismicCap: plf(Vcap.E), windCap: plf(Vcap.W), effectiveSeismicCap: plf(Vcap.E), effectiveWindCap: plf(Vcap.W),
    seismicDC, windDC, dcRatio: r2(dcRatio), dcGoverning,
    dlWallSelf: info.grav.wallSelfDL, dlFromDiagram: info.grav.diagramDL, dlTotal: info.grav.dlTotal, dlRL: r2(D / 2), dlRR: r2(D / 2),
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

const DIST_TOL = 0.05;   // accepted when walls at every level deflect within 5%: (δmax − δmin) / δmax ≤ 0.05
const DIST_MAX_PASSES = 20;

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

// Deflection approach: walls at a level in a line deflect equally, so shares ∝ stiffness k = V/δ
// (SDPWS 2021 Eq. 4.3-1 at 1.0E / 1.0W). δ depends on the share (holdown slip, hardware, posts, nailing),
// so start from capacity shares and redistribute until the walls' δ at every level are within 5%.
// If that is not reached in 20 passes, the pass with the smallest spread is used and flagged.
function solveDistribution(line, inputs, levels, runLine) {
  let res = runLine(line, null);
  if (lineDistribution(inputs, line) !== 'deflection') {
    res.distribution = { method: 'capacity' };
    return res;
  }
  const storyShears = accumulateStoryShear(line.levelLoads || {}, levels);
  const lts = inputs.loadType === 'wind' ? ['W'] : inputs.loadType === 'both' ? ['E', 'W'] : ['E'];
  const kept = new Set();
  let sp = deflectionSpread(res, lts);
  let passes = 0;
  let best = { res, sp, passes };
  while (sp.spread > DIST_TOL && passes < DIST_MAX_PASSES) {
    const next = { E: {}, W: {} };
    for (const pl of res.perLevel) {
      const ss = storyShears[pl.levelId] || { seismic: 0, wind: 0 };
      for (const lt of lts) {
        const V = lt === 'E' ? ss.seismic : ss.wind;
        const cur = (w) => (lt === 'E' ? w.shareExact_1E : w.shareExact_1W) || 0;
        const ks = pl.walls.map(w => (w.hbNotPermitted ? 0 : w.stiffness && w.stiffness[lt]));
        const sum = ks.reduce((a, k) => a + (k || 0), 0);
        const usable = V > 0 && sum > 0 && ks.every(k => k != null && k >= 0);
        if (V > 0 && !usable) kept.add(pl.levelName || pl.levelId);
        pl.walls.forEach((w, i) => { next[lt][w.wallId] = usable ? V * ks[i] / sum : cur(w); });
      }
    }
    passes++;
    res = runLine(line, next);
    sp = deflectionSpread(res, lts);
    if (sp.spread < best.sp.spread) best = { res, sp, passes };
  }
  const converged = sp.spread <= DIST_TOL;
  const out = converged ? { res, sp, passes } : best;
  out.res.distribution = {
    method: 'deflection', passes, usedPass: out.passes, converged,
    spread: out.sp.spread, spreadRows: out.sp.rows, tolerance: DIST_TOL,
    note: kept.size ? 'Capacity shares kept at ' + [...kept].join(', ') + ': a wall has no stiffness (no post / hardware selected or no load)' : null,
  };
  return out.res;
}

// Story drift per level of a line: δxe = largest wall deflection at that level (1.0E, ρ = 1);
// δx = Cd·δxe/Ie (ASCE 7-22 §12.8.6) vs Δa = limit·h_sx (Table 12.12-1). Wind: service, report only.
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
      return d && (!best || d.delta > best.delta) ? { delta: d.delta, mark: w.mark } : best;
    }, null);
    const row = { levelId: pl.levelId, levelName: pl.levelName, hsx };
    if (seismic) {
      const m = maxOf('E');
      row.seismic = m ? { deltaXE: m.delta, wallMark: m.mark } : null;
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
      row.wind = m ? { delta: m.delta, wallMark: m.mark, ratio: hsx > 0 ? r4(m.delta / (12 * hsx)) : null } : null;
    }
    rows.push(row);
  }
  return {
    cd: cd || null, ie: ie || null, riskCategory: inputs.riskCategory || null, limit,
    missing: seismic && !(cd > 0 && ie > 0) ? 'Cd and Ie are needed for δx — link the Seismic Base Shear item or enter them' : null,
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

// Post at a holdown end / post base: the override if it meets the HDUE minimum post (P9), else auto.
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
