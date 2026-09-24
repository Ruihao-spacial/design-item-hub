import { NAILING_TABLE, autoSelectNailing, getNailingById } from './shearWallNailing.js';
import { autoSelectHoldown, autoSelectStrap, autoSelectPost, getGradeById, HDUE_TABLE, MSTC_TABLE, POST_SIZES, computePostCapacity, lrfdCap } from './shearWallHardware.js';
import { resolveVerticalLoadPath } from './shearWallLoadPath.js';
import { aspectFactor } from './shearWallFtao.js';
import { expandWalls, hasOpenings, wallMethod, wallPiers, sortedOpenings } from './shearWallOpenings.js';
import { ftaoCapacityLbf, ftaoDesign, ftaoLoadTypes } from './shearWallFtaoAdapter.js';
import { wallDeflection, postArea, driftLimit } from './shearWallDeflection.js';

// Records which calc produced a stored results snapshot (results are always regenerated for display)
export const CALC_VERSION = 'v6';

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

export function resolveGravityAtWall(wall, gravityLoadsAtLevel, wallDLTypes) {
  const pos = parseFloat(wall.position) || 0;
  const len = parseFloat(wall.length) || 0;
  const wallEnd = pos + len;
  const h = parseFloat(wall._floorToFloor) || 0;

  let wallSelfDL = 0;
  if (wall.wallDLTypeId && wallDLTypes) {
    const wdt = wallDLTypes.find(t => t.id === wall.wallDLTypeId);
    // FTAO walls: no wall weight where the openings are (_openingArea, ft²)
    if (wdt) wallSelfDL = (parseFloat(wdt.psf) || 0) * Math.max(0, len * h - (wall._openingArea || 0)) / 1000;
  }

  let diagramDL = 0;
  if (gravityLoadsAtLevel) {
    for (const u of (gravityLoadsAtLevel.uniform || [])) {
      const uStart = parseFloat(u.start) || 0;
      const uEnd = parseFloat(u.end) || 0;
      const plf = parseFloat(u.dlPlf) || 0;
      const overlapStart = Math.max(pos, uStart);
      const overlapEnd = Math.min(wallEnd, uEnd);
      if (overlapEnd > overlapStart) diagramDL += plf * (overlapEnd - overlapStart) / 1000;
    }
    for (const p of (gravityLoadsAtLevel.point || [])) {
      const pPos = parseFloat(p.position) || 0;
      if (pPos >= pos && pPos <= wallEnd) diagramDL += parseFloat(p.dlKips) || 0;
    }
  }

  return { wallSelfDL: r2(wallSelfDL), diagramDL: r2(diagramDL), dlTotal: r2(wallSelfDL + diagramDL) };
}

export function computeWallTC(share1E, share1W, dlTotal, wallLength, floorH, rho, sds, loadType) {
  const L = parseFloat(wallLength) || 0;
  const h = parseFloat(floorH) || 0;
  const _rho = parseFloat(rho) || 1.0;
  const _sds = parseFloat(sds) || 0;
  const dl = parseFloat(dlTotal) || 0;
  const dlRTM = dl * L / 2;

  const combos = {};
  const steps = { dlRTM: r2(dlRTM) };

  // Both ends from one formula: net end force = fD·DL/2 ∓ OTM/L (+ = compression).
  // m > 0 overturns toward the right end (_pos): left end uplift side, right end compression side.
  const half = L > 0 ? dl / 2 : 0;
  const endPair = (group, fD, m) => {
    const netL = fD * half - m;
    const netR = fD * half + m;
    return {
      group,
      tensionLeft: r2(Math.max(0, -netL)), comprLeft: r2(Math.max(0, netL)),
      tensionRight: r2(Math.max(0, -netR)), comprRight: r2(Math.max(0, netR)),
    };
  };

  combos['1.0D'] = endPair('load_case', 1.0, 0);

  if (loadType === 'seismic' || loadType === 'both') {
    const V = parseFloat(share1E) || 0;
    const otm = 0.7 * _rho * V * h;
    const gfUplift = 0.6 - 0.14 * _sds;
    const gfComp = 1.0 + 0.14 * _sds;
    steps.seismic = { otm: r2(otm), gfUplift: r4(gfUplift), gfComp: r4(gfComp) };
    const m = L > 0 ? otm / L : 0;
    combos['0.6D+0.7ρE_pos'] = endPair('asd', gfUplift, m);
    combos['0.6D+0.7ρE_neg'] = endPair('asd', gfUplift, -m);
    combos['D+0.7ρE_pos'] = endPair('asd', gfComp, m);
    combos['D+0.7ρE_neg'] = endPair('asd', gfComp, -m);
    // Load case: lateral only (no dead load) — equal and opposite end forces
    combos['1.0E'] = endPair('load_case', 0, L > 0 ? V * h / L : 0);
    // LRFD (ASCE 7-22 §2.3.6, Ev = 0.2SDS·D) — reported forces only, design stays ASD
    const mL = L > 0 ? _rho * V * h / L : 0;
    const fUp = 0.9 - 0.2 * _sds, fComp = 1.2 + 0.2 * _sds;
    steps.lrfdSeismic = { otm: r2(_rho * V * h), fUplift: r4(fUp), fComp: r4(fComp) };
    combos['(0.9-0.2SDS)D+ρE_pos'] = endPair('lrfd', fUp, mL);
    combos['(0.9-0.2SDS)D+ρE_neg'] = endPair('lrfd', fUp, -mL);
    combos['(1.2+0.2SDS)D+ρE_pos'] = endPair('lrfd', fComp, mL);
    combos['(1.2+0.2SDS)D+ρE_neg'] = endPair('lrfd', fComp, -mL);
  }

  if (loadType === 'wind' || loadType === 'both') {
    const Vw = parseFloat(share1W) || 0;
    const otmW = 0.6 * Vw * h;
    steps.wind = { otm: r2(otmW) };
    const m = L > 0 ? otmW / L : 0;
    combos['0.6D+0.6W_pos'] = endPair('asd', 0.6, m);
    combos['0.6D+0.6W_neg'] = endPair('asd', 0.6, -m);
    combos['D+0.6W_pos'] = endPair('asd', 1.0, m);
    combos['D+0.6W_neg'] = endPair('asd', 1.0, -m);
    combos['1.0W'] = endPair('load_case', 0, L > 0 ? Vw * h / L : 0);
    const mW = L > 0 ? Vw * h / L : 0;
    steps.lrfdWind = { otm: r2(Vw * h) };
    combos['0.9D+1.0W_pos'] = endPair('lrfd', 0.9, mW);
    combos['0.9D+1.0W_neg'] = endPair('lrfd', 0.9, -mW);
    combos['1.2D+1.0W_pos'] = endPair('lrfd', 1.2, mW);
    combos['1.2D+1.0W_neg'] = endPair('lrfd', 1.2, -mW);
  }

  const gov = governingOf(combos, 'asd');
  const lrfd = governingOf(combos, 'lrfd');
  return {
    combos, steps,
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

export function calcAll(inputs) {
  const levels = inputs.levels || [];
  const sds = inputs.sds;
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
    const perLine = (dir.lines || []).map(line => {
      const lineThickness = line.wallThickness || globalThickness;
      const storyShears = accumulateStoryShear(line.levelLoads || {}, levels);
      const ftaoCtx = (w) => ({ floorH: floorHOf(w.levelId), rho: rhoN, sds, grade, sheathing, cd: inputs.cd, ie: inputs.ie, alphaS, lineThickness, loadType });
      // Dead load (kips) at each FTAO jamb: half the adjacent pier's load + half the header load above the opening
      const jambDL = (w) => {
        const h = floorHOf(w.levelId);
        const gl = (line.gravityLoads || {})[w.levelId];
        const dlOver = (position, length, height) => resolveGravityAtWall({ position, length, wallDLTypeId: w.wallDLTypeId, _floorToFloor: height }, gl, wallDLTypes).dlTotal;
        const piers = wallPiers(w);
        const x0 = parseFloat(w.position) || 0;
        const out = [];
        sortedOpenings(w).forEach((o, j) => {
          const header = dlOver(x0 + o.offset, o.width, h - o.head);
          out.push(dlOver(piers[j].start, piers[j].length, h) / 2 + header / 2);
          out.push(dlOver(piers[j + 1].start, piers[j + 1].length, h) / 2 + header / 2);
        });
        return out;
      };

      // Segmented walls → piers. Openings with bad geometry, and FTAO walls the engine rejects,
      // are designed as solid walls and reported in the audit.
      const expanded = expandWalls(line.walls || [], levels);
      const openingIssues = { ...expanded.problems };
      const allWalls = expanded.walls.map(w => {
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

      // Aspect ratios (fixed per wall). FTAO piers are checked by the engine at the opening height.
      const wallARs = {};
      for (const w of allWalls) {
        wallARs[w.id] = isFtao(w)
          ? { hOverB: null, flag: false, reductionFactor: 1, notPermitted: false }
          : checkAspectRatio(parseFloat(w.length) || 0, floorHOf(w.levelId));
      }
      // Capacity weight (plf-equivalent) for capacity-based distribution
      const capOf = (w, n, lt) => {
        if (isFtao(w)) {
          const len = parseFloat(w.length) || 0;
          return len > 0 ? ftaoCap(w, n, lt) / len : 0;
        }
        return (lt === 'E' ? n.asdE : n.asdW) * wallARs[w.id].reductionFactor;
      };

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

          const eMap = {}; distributeByCapacity(wallsAtLevel, ss.seismic, seismicCapMap).forEach(s => { eMap[s.wallId] = s.share; });
          const wMap = {}; distributeByCapacity(wallsAtLevel, ss.wind, windCapMap).forEach(s => { wMap[s.wallId] = s.share; });

          for (const w of wallsAtLevel) {
            if (w.nailingPattern || wallARs[w.id].notPermitted) continue;
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

        const eShares = distributeByCapacity(wallsAtLevel, ss.seismic, seismicCapMap);
        const wShares = distributeByCapacity(wallsAtLevel, ss.wind, windCapMap);
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
          const wLen = parseFloat(w.length) || 0;
          const ar = wallARs[w.id];
          const n = wallNailing[w.id];
          const effCapE = seismicCapMap[w.id] || 0;
          const effCapW = windCapMap[w.id] || 0;
          const relStiffness = totalCapLenE > 0 ? r2(effCapE * wLen / totalCapLenE) : 0;

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
          const grav = resolveGravityAtWall(wWithH, (line.gravityLoads || {})[lvl.id], wallDLTypes);
          const tc = computeWallTC(sh.seismic, sh.wind, grav.dlTotal, wLen, floorH, rho, sds, loadType);

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

          const postLeft = w.postLeftOverride
            ? findPost(w.postLeftOverride, lineThickness, grade, floorH)
            : autoSelectPost(tc.governingComprLeft, lineThickness, grade, floorH);
          const postRight = w.postRightOverride
            ? findPost(w.postRightOverride, lineThickness, grade, floorH)
            : autoSelectPost(tc.governingComprRight, lineThickness, grade, floorH);

          const wallResult = {
            wallId: w.id, mark: w.mark || '', position: parseFloat(w.position) || 0, length: wLen,
            method: isFtao(w) ? 'ftao' : w.parentWallId ? 'pier' : 'wall',
            parentWallId: w.parentWallId || null, pierIndex: w.pierIndex ?? null,
            openingsIgnored: !!w._openingsIgnored,
            hOverB: arInfo.hOverB, hOverBFlag: arInfo.flag, hbReductionFactor: arInfo.reductionFactor,
            hbNotPermitted: !!arInfo.notPermitted,
            share_1E: r2(sh.seismic), share_1W: r2(sh.wind),
            relStiffness, totalCapLen: r2(totalCapLenE),
            unitShear_seismic: r2(seismicPlf), unitShear_wind: r2(windPlf),
            unitShear_ASD: r2(unitShearASD),
            nailing: { id: n.id, label: n.label, sides: n.sides },
            capacity: dcGoverning === 'wind' ? n.asdW : n.asdE,
            effectiveCapacity: r2(effCap),
            seismicCap: n.asdE, windCap: n.asdW,
            effectiveSeismicCap: r2(sheathCapE), effectiveWindCap: r2(sheathCapW),
            seismicDC, windDC, dcRatio, dcGoverning,
            dlWallSelf: grav.wallSelfDL, dlFromDiagram: grav.diagramDL, dlTotal: grav.dlTotal,
            floorH,
            anchorageType: useHoldown ? 'holdown' : 'strap',
            anchorageLeft, anchorageRight,
            postLeft, postRight,
            ftao,
            ...tc,
          };
          computeHardwareDC(wallResult);
          return wallResult;
        });

        return {
          levelId: lvl.id, levelName: lvl.name || '',
          storyShear_1E: r2(ss.seismic), storyShear_1W: r2(ss.wind),
          walls: wallResults,
        };
      });

      // Phase 3: Vertical load path — wall ends, posts at any story, transfer beams (user supports)
      const wallResultsMap = {};
      perLevel.forEach(pl => pl.walls.forEach(wr => { wallResultsMap[wr.wallId] = wr; }));
      const loadPath = resolveVerticalLoadPath({
        levels, walls: allWalls, beams: line.beams || [], posts: line.supportPosts || [],
        wallResultsMap, lineThickness, grade,
      });

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
        wr.lrfdCapLeft = lrfdCap(wr.anchorageLeft);
        wr.lrfdCapRight = lrfdCap(wr.anchorageRight);
        wr.deflection = {};
        if (wr.method === 'ftao') {
          for (const lt of ['E', 'W']) {
            const d = wr.ftao && wr.ftao.perType[lt] && wr.ftao.perType[lt].deflection;
            if (d) wr.deflection[lt] = { method: 'FTAO — APA T555 pier cases, SDPWS Eq. 4.3-1', delta: r4(d.Delta_in), cases: d.cases };
          }
        } else {
          if (seismic) wr.deflection.E = wallDeflection(wr, 'E', 1.0, deflCtx);
          if (wind && alphaS > 0) wr.deflection.W = wallDeflection(wr, 'W', alphaS, deflCtx);
        }
        wr.onBeam = loadPath.wallDeliveries.some(d => d.wallId === wr.wallId && d.receiver.type === 'beam');
      }
      const drift = storyDrift(perLevel, inputs, { seismic, wind, alphaS });

      return {
        lineId: line.id, lineName: line.name || '', perLevel,
        beamTransfers: loadPath.beamTransfers, postPaths: loadPath.postPaths,
        wallDeliveries: loadPath.wallDeliveries, comboGroups: loadPath.comboGroups,
        loadPathAudit: loadPath.loadPathAudit,
        drift,
      };
    });

    return { dirId: dir.id, dirName: dir.name || '', rho: parseFloat(dir.rho) || 1, perLine };
  });

  return { calcVersion: CALC_VERSION, perDirection };
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
