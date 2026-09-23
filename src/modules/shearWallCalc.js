import { NAILING_TABLE, autoSelectNailing, getNailingById } from './shearWallNailing.js';
import { autoSelectHoldown, autoSelectStrap, autoSelectPost, getGradeById, HDUE_TABLE, MSTC_TABLE, POST_SIZES, computePostCapacity } from './shearWallHardware.js';
import { resolveVerticalLoadPath } from './shearWallLoadPath.js';

// Records which calc produced a stored results snapshot (results are always regenerated for display)
export const CALC_VERSION = 'v5';

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
    if (wdt) wallSelfDL = (parseFloat(wdt.psf) || 0) * len * h / 1000;
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
  }

  let govTL = 0, govTR = 0, govCL = 0, govCR = 0;
  for (const [, c] of Object.entries(combos)) {
    if (c.group === 'load_case') continue;
    govTL = Math.max(govTL, c.tensionLeft || 0);
    govTR = Math.max(govTR, c.tensionRight || 0);
    govCL = Math.max(govCL, c.comprLeft || 0);
    govCR = Math.max(govCR, c.comprRight || 0);
  }

  return {
    combos, steps,
    governingTensionLeft: r2(govTL),
    governingTensionRight: r2(govTR),
    governingComprLeft: r2(govCL),
    governingComprRight: r2(govCR),
  };
}

export function checkAspectRatio(wallLength, floorToFloor) {
  const L = parseFloat(wallLength) || 0;
  const h = parseFloat(floorToFloor) || 0;
  if (L <= 0) return { hOverB: Infinity, flag: true, reductionFactor: 0 };
  const hOverB = r2(h / L);
  const flag = hOverB > 2.0;
  const reductionFactor = hOverB > 2.5 ? r2(2 * L / h) : 1.0;
  return { hOverB, flag, reductionFactor };
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

export function calcAll(inputs) {
  const levels = inputs.levels || [];
  const sds = inputs.sds;
  const loadType = inputs.loadType || 'seismic';
  const wallDLTypes = inputs.wallDLTypes || [];
  const globalThickness = inputs.wallThickness || '4';
  const grade = getGradeById(inputs.woodGrade);
  const bottomLevelId = levels.length > 0 ? levels[levels.length - 1].id : null;

  const perDirection = (inputs.directions || []).map(dir => {
    const rho = dir.rho;
    const perLine = (dir.lines || []).map(line => {
      const lineThickness = line.wallThickness || globalThickness;
      const storyShears = accumulateStoryShear(line.levelLoads || {}, levels);
      const allWalls = line.walls || [];

      // Pre-compute aspect ratios (fixed per wall, don't change with iteration)
      const wallARs = {};
      for (const lvl of levels) {
        const floorH = parseFloat(lvl.floorToFloor) || 0;
        allWalls.filter(w => w.levelId === lvl.id).forEach(w => {
          wallARs[w.id] = checkAspectRatio(parseFloat(w.length) || 0, floorH);
        });
      }

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
            const n = wallNailing[w.id]; const ar = wallARs[w.id];
            seismicCapMap[w.id] = n.asdE * ar.reductionFactor;
            windCapMap[w.id] = n.asdW * ar.reductionFactor;
          });

          const eShares = distributeByCapacity(wallsAtLevel, ss.seismic, seismicCapMap);
          const wShares = distributeByCapacity(wallsAtLevel, ss.wind, windCapMap);
          const eMap = {}; eShares.forEach(s => { eMap[s.wallId] = s.share; });
          const wMap = {}; wShares.forEach(s => { wMap[s.wallId] = s.share; });

          for (const w of wallsAtLevel) {
            if (w.nailingPattern) continue;
            const wLen = parseFloat(w.length) || 0;
            if (wLen <= 0) continue;
            const vSeis = (eMap[w.id] || 0) * 0.7 * (parseFloat(rho) || 1) * 1000 / wLen;
            const vWind = (wMap[w.id] || 0) * 0.6 * 1000 / wLen;
            const ar = wallARs[w.id];
            const selected = autoSelectNailing(vSeis, vWind, ar.reductionFactor, loadType);
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
          const n = wallNailing[w.id]; const ar = wallARs[w.id];
          seismicCapMap[w.id] = n.asdE * ar.reductionFactor;
          windCapMap[w.id] = n.asdW * ar.reductionFactor;
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
          const wLen = parseFloat(w.length) || 0;
          const ar = wallARs[w.id];
          const n = wallNailing[w.id];
          const effCapE = n.asdE * ar.reductionFactor;
          const effCapW = n.asdW * ar.reductionFactor;
          const relStiffness = totalCapLenE > 0 ? r2(effCapE * wLen / totalCapLenE) : 0;

          let seismicPlf = 0, windPlf = 0;
          if (wLen > 0) {
            seismicPlf = sh.seismic * 0.7 * (parseFloat(rho) || 1) * 1000 / wLen;
            windPlf = sh.wind * 0.6 * 1000 / wLen;
          }
          const seismicDC = effCapE > 0 ? r2(seismicPlf / effCapE) : 0;
          const windDC = effCapW > 0 ? r2(windPlf / effCapW) : 0;
          let dcRatio, dcGoverning, unitShearASD;
          if (loadType === 'seismic') { dcRatio = seismicDC; dcGoverning = 'seismic'; unitShearASD = seismicPlf; }
          else if (loadType === 'wind') { dcRatio = windDC; dcGoverning = 'wind'; unitShearASD = windPlf; }
          else {
            dcGoverning = seismicDC >= windDC ? 'seismic' : 'wind';
            dcRatio = Math.max(seismicDC, windDC);
            unitShearASD = Math.max(seismicPlf, windPlf);
          }
          const effCap = dcGoverning === 'wind' ? effCapW : effCapE;

          const wWithH = { ...w, _floorToFloor: floorH };
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
            hOverB: ar.hOverB, hOverBFlag: ar.flag, hbReductionFactor: ar.reductionFactor,
            share_1E: r2(sh.seismic), share_1W: r2(sh.wind),
            relStiffness, totalCapLen: r2(totalCapLenE),
            unitShear_seismic: r2(seismicPlf), unitShear_wind: r2(windPlf),
            unitShear_ASD: r2(unitShearASD),
            nailing: { id: n.id, label: n.label, sides: n.sides },
            capacity: dcGoverning === 'wind' ? n.asdW : n.asdE,
            effectiveCapacity: r2(effCap),
            seismicCap: n.asdE, windCap: n.asdW,
            effectiveSeismicCap: r2(effCapE), effectiveWindCap: r2(effCapW),
            seismicDC, windDC, dcRatio, dcGoverning,
            dlWallSelf: grav.wallSelfDL, dlFromDiagram: grav.diagramDL, dlTotal: grav.dlTotal,
            floorH,
            anchorageType: useHoldown ? 'holdown' : 'strap',
            anchorageLeft, anchorageRight,
            postLeft, postRight,
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

      return {
        lineId: line.id, lineName: line.name || '', perLevel,
        beamTransfers: loadPath.beamTransfers, postPaths: loadPath.postPaths,
        wallDeliveries: loadPath.wallDeliveries, comboGroups: loadPath.comboGroups,
        loadPathAudit: loadPath.loadPathAudit,
      };
    });

    return { dirId: dir.id, dirName: dir.name || '', rho: parseFloat(dir.rho) || 1, perLine };
  });

  return { calcVersion: CALC_VERSION, perDirection };
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
