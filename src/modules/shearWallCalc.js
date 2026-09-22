import { NAILING_TABLE, autoSelectNailing, getNailingById } from './shearWallNailing.js';
import { autoSelectHoldown, autoSelectStrap, autoSelectPost, getGradeById, HDUE_TABLE, MSTC_TABLE, POST_SIZES, computePostCapacity } from './shearWallHardware.js';

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

  const dlCompPerEnd = L > 0 ? r2(dl / 2) : 0;
  combos['1.0D'] = { group: 'load_case', tensionLeft: 0, tensionRight: 0, comprLeft: dlCompPerEnd, comprRight: dlCompPerEnd };

  if (loadType === 'seismic' || loadType === 'both') {
    const V = parseFloat(share1E) || 0;
    const otm = 0.7 * _rho * V * h;
    const gfUplift = 0.6 - 0.14 * _sds;
    const gfComp = 1.0 + 0.14 * _sds;
    steps.seismic = { otm: r2(otm), gfUplift: r4(gfUplift), gfComp: r4(gfComp) };

    const tPos = L > 0 ? Math.max(0, (otm - gfUplift * dlRTM) / L) : 0;
    const cPos = L > 0 ? (otm + gfComp * dlRTM) / L : 0;
    combos['0.6D+0.7ρE_pos'] = { group: 'asd', tensionLeft: r2(tPos), tensionRight: 0, comprLeft: 0, comprRight: r2(cPos) };
    combos['0.6D+0.7ρE_neg'] = { group: 'asd', tensionLeft: 0, tensionRight: r2(tPos), comprLeft: r2(cPos), comprRight: 0 };
    combos['D+0.7ρE_pos'] = { group: 'asd', tensionLeft: 0, tensionRight: 0, comprLeft: 0, comprRight: r2(cPos) };
    combos['D+0.7ρE_neg'] = { group: 'asd', tensionLeft: 0, tensionRight: 0, comprLeft: r2(cPos), comprRight: 0 };

    const eOtm1E = V * h;
    const eTpos = L > 0 ? r2(Math.max(0, (eOtm1E - dlRTM) / L)) : 0;
    const eCpos = L > 0 ? r2((eOtm1E + dlRTM) / L) : 0;
    combos['1.0E'] = { group: 'load_case', tensionLeft: eTpos, tensionRight: 0, comprLeft: 0, comprRight: eCpos };
  }

  if (loadType === 'wind' || loadType === 'both') {
    const Vw = parseFloat(share1W) || 0;
    const otmW = 0.6 * Vw * h;
    steps.wind = { otm: r2(otmW) };
    const tPosW = L > 0 ? Math.max(0, (otmW - 0.6 * dlRTM) / L) : 0;
    const cPosW = L > 0 ? (otmW + 1.0 * dlRTM) / L : 0;
    combos['0.6D+0.6W_pos'] = { group: 'asd', tensionLeft: r2(tPosW), tensionRight: 0, comprLeft: 0, comprRight: r2(cPosW) };
    combos['0.6D+0.6W_neg'] = { group: 'asd', tensionLeft: 0, tensionRight: r2(tPosW), comprLeft: r2(cPosW), comprRight: 0 };
    combos['D+0.6W_pos'] = { group: 'asd', tensionLeft: 0, tensionRight: 0, comprLeft: 0, comprRight: r2(cPosW) };
    combos['D+0.6W_neg'] = { group: 'asd', tensionLeft: 0, tensionRight: 0, comprLeft: r2(cPosW), comprRight: 0 };

    const wOtm1W = Vw * h;
    const wTpos = L > 0 ? r2(Math.max(0, (wOtm1W - dlRTM) / L)) : 0;
    const wCpos = L > 0 ? r2((wOtm1W + dlRTM) / L) : 0;
    combos['1.0W'] = { group: 'load_case', tensionLeft: wTpos, tensionRight: 0, comprLeft: 0, comprRight: wCpos };
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

export function detectStacking(walls, levels) {
  const groups = [];
  const used = new Set();
  const wallsByLevel = {};
  for (const w of walls) {
    if (!wallsByLevel[w.levelId]) wallsByLevel[w.levelId] = [];
    wallsByLevel[w.levelId].push(w);
  }

  for (let li = 0; li < levels.length; li++) {
    const topWalls = wallsByLevel[levels[li].id] || [];
    for (const tw of topWalls) {
      if (used.has(tw.id)) continue;
      const group = [tw.id];
      used.add(tw.id);
      let current = tw;
      for (let lj = li + 1; lj < levels.length; lj++) {
        const candidates = (wallsByLevel[levels[lj].id] || []).filter(w => !used.has(w.id));
        const stacked = candidates.find(w => overlaps(current, w));
        if (stacked) {
          group.push(stacked.id);
          used.add(stacked.id);
          current = stacked;
        } else {
          break;
        }
      }
      if (group.length > 1) groups.push(group);
    }
  }
  return groups;
}

function overlaps(a, b) {
  const aStart = parseFloat(a.position) || 0;
  const aEnd = aStart + (parseFloat(a.length) || 0);
  const bStart = parseFloat(b.position) || 0;
  const bEnd = bStart + (parseFloat(b.length) || 0);
  return aStart < bEnd && bStart < aEnd;
}

export function accumulateStackTC(stackGroupIds, wallResultsMap) {
  const accT = [];
  const accC = [];
  let cumT = 0, cumC = 0;
  for (const wid of stackGroupIds) {
    const wr = wallResultsMap[wid];
    if (!wr) { accT.push(cumT); accC.push(cumC); continue; }
    const localT = Math.max(wr.governingTensionLeft, wr.governingTensionRight);
    const localC = Math.max(wr.governingComprLeft, wr.governingComprRight);
    cumT = r2(cumT + localT);
    cumC = r2(cumC + localC);
    accT.push(cumT);
    accC.push(cumC);
  }

  const perComboAccum = {};
  const topWr = wallResultsMap[stackGroupIds[0]];
  if (topWr && topWr.combos) {
    for (const comboKey of Object.keys(topWr.combos)) {
      const cumTL = [], cumTR = [], cumCL = [], cumCR = [];
      let runTL = 0, runTR = 0, runCL = 0, runCR = 0;
      for (const wid of stackGroupIds) {
        const wr = wallResultsMap[wid];
        const c = wr && wr.combos ? wr.combos[comboKey] : null;
        if (c) {
          runTL = r2(runTL + (c.tensionLeft || 0));
          runTR = r2(runTR + (c.tensionRight || 0));
          runCL = r2(runCL + (c.comprLeft || 0));
          runCR = r2(runCR + (c.comprRight || 0));
        }
        cumTL.push(runTL); cumTR.push(runTR);
        cumCL.push(runCL); cumCR.push(runCR);
      }
      perComboAccum[comboKey] = { cumTL, cumTR, cumCL, cumCR };
    }
  }

  return { accumulatedTension: accT, accumulatedCompression: accC, perComboAccum };
}

// === Beam transfers ===

export function resolveBeamTransfers(beams, allWalls, wallResultsMap, levels) {
  if (!beams || !beams.length) return [];
  const results = [];
  for (const beam of beams) {
    const bmStart = parseFloat(beam.position) || 0;
    const bmEnd = bmStart + (parseFloat(beam.length) || 0);
    const bmSpan = bmEnd - bmStart;
    if (bmSpan <= 0) continue;

    const sourceWalls = allWalls.filter(w => {
      if (w.levelId !== beam.levelId) return false;
      const ws = parseFloat(w.position) || 0;
      const we = ws + (parseFloat(w.length) || 0);
      return ws < bmEnd && we > bmStart;
    });

    let leftT = 0, leftC = 0, rightT = 0, rightC = 0;
    const sourceIds = [];
    for (const sw of sourceWalls) {
      const wr = wallResultsMap[sw.id];
      if (!wr) continue;
      sourceIds.push(sw.id);
      const wPos = parseFloat(sw.position) || 0;
      const wLen = parseFloat(sw.length) || 0;
      const centroid = wPos + wLen / 2;
      const armRight = (centroid - bmStart) / bmSpan;
      const armLeft = (bmEnd - centroid) / bmSpan;
      const t = wr.accumTension != null ? wr.accumTension : Math.max(wr.governingTensionLeft, wr.governingTensionRight);
      const c = wr.accumCompression != null ? wr.accumCompression : Math.max(wr.governingComprLeft, wr.governingComprRight);
      leftT = r2(leftT + t * armLeft);
      leftC = r2(leftC + c * armLeft);
      rightT = r2(rightT + t * armRight);
      rightC = r2(rightC + c * armRight);
    }

    results.push({
      beamId: beam.id, levelId: beam.levelId,
      position: bmStart, length: bmSpan,
      sourceWallIds: sourceIds,
      leftReaction: { tension: leftT, compression: leftC },
      rightReaction: { tension: rightT, compression: rightC },
    });
  }
  return results;
}

// === Support post paths ===

function pointInWallEnd(pos, wall, tolerance) {
  const tol = tolerance || 0.1;
  const wStart = parseFloat(wall.position) || 0;
  const wEnd = wStart + (parseFloat(wall.length) || 0);
  if (Math.abs(pos - wStart) <= tol) return 'left';
  if (Math.abs(pos - wEnd) <= tol) return 'right';
  return null;
}

export function resolvePostPaths(supportPosts, beams, allWalls, wallResultsMap, levels, beamTransfers, lineThickness, grade) {
  if (!supportPosts || !supportPosts.length) return [];
  const results = [];
  const bottomLevelId = levels.length > 0 ? levels[levels.length - 1].id : null;
  const bottomLevel = levels.length > 0 ? levels[levels.length - 1] : null;
  if (!bottomLevel) return [];

  for (const sp of supportPosts) {
    const pos = parseFloat(sp.position) || 0;
    let accumT = 0, accumC = 0;

    // Collect from beam reactions at any level
    for (const bt of (beamTransfers || [])) {
      if (Math.abs(bt.position - pos) <= 0.1) {
        accumT = r2(accumT + bt.leftReaction.tension);
        accumC = r2(accumC + bt.leftReaction.compression);
      }
      if (Math.abs(bt.position + bt.length - pos) <= 0.1) {
        accumT = r2(accumT + bt.rightReaction.tension);
        accumC = r2(accumC + bt.rightReaction.compression);
      }
    }

    // Collect from wall ends at levels above the bottom that are NOT in a direct stack
    for (const w of allWalls) {
      if (w.levelId === bottomLevelId) continue;
      const side = pointInWallEnd(pos, w);
      if (!side) continue;
      // Skip walls that have direct stacking below (they're handled by the stacking system)
      const wLevelIdx = levels.findIndex(l => l.id === w.levelId);
      if (wLevelIdx < 0 || wLevelIdx >= levels.length - 1) continue;
      const belowLevelId = levels[wLevelIdx + 1].id;
      const hasDirectStack = allWalls.some(bw =>
        bw.levelId === belowLevelId && overlaps(w, bw));
      if (hasDirectStack) continue;
      // Also skip if a beam covers this wall (beam reactions already collected)
      const hasBeam = (beams || []).some(b => {
        if (b.levelId !== w.levelId) return false;
        const bs = parseFloat(b.position) || 0;
        const be = bs + (parseFloat(b.length) || 0);
        const ws = parseFloat(w.position) || 0;
        const we = ws + (parseFloat(w.length) || 0);
        return ws < be && we > bs;
      });
      if (hasBeam) continue;

      const wr = wallResultsMap[w.id];
      if (!wr) continue;
      const t = side === 'left'
        ? (wr.accumTension != null ? wr.accumTension : wr.governingTensionLeft)
        : (wr.accumTension != null ? wr.accumTension : wr.governingTensionRight);
      const c = side === 'left'
        ? (wr.accumCompression != null ? wr.accumCompression : wr.governingComprLeft)
        : (wr.accumCompression != null ? wr.accumCompression : wr.governingComprRight);
      accumT = r2(accumT + t);
      accumC = r2(accumC + c);
    }

    // Check if post feeds into a wall end at the bottom level
    let feedsInto = null;
    for (const w of allWalls) {
      if (w.levelId !== bottomLevelId) continue;
      const side = pointInWallEnd(pos, w);
      if (side) { feedsInto = { wallId: w.id, side }; break; }
    }

    const floorH = parseFloat(bottomLevel.floorToFloor) || 10;
    const holdown = autoSelectHoldown(accumT);
    const post = autoSelectPost(accumC, lineThickness || '4', grade, floorH);
    const hdDC = holdown && holdown.cap > 0 ? r2(accumT * 1000 / holdown.cap) : null;
    const postDC = post && post.capacityKips > 0 ? r2(accumC / post.capacityKips) : null;

    const perLevel = [{
      levelId: bottomLevelId, levelName: bottomLevel.name || '',
      accumT, accumC, holdown, post, hdDC, postDC, feedsInto,
    }];

    results.push({ postId: sp.id, position: pos, startLevelId: bottomLevelId, perLevel });
  }
  return results;
}

// === Load path audit ===

export function auditLoadPaths(allWalls, beams, supportPosts, levels, beamTransfers, postPaths) {
  const warnings = [];
  const bottomLevelId = levels.length > 0 ? levels[levels.length - 1].id : null;

  for (const w of allWalls) {
    if (w.levelId === bottomLevelId) continue;
    const wStart = parseFloat(w.position) || 0;
    const wEnd = wStart + (parseFloat(w.length) || 0);
    const wLevelIdx = levels.findIndex(l => l.id === w.levelId);
    if (wLevelIdx < 0 || wLevelIdx >= levels.length - 1) continue;
    const belowLevelId = levels[wLevelIdx + 1].id;

    const hasDirectStack = allWalls.some(bw =>
      bw.levelId === belowLevelId && overlaps(w, bw));
    if (hasDirectStack) continue;

    const hasBeam = (beams || []).some(b => {
      if (b.levelId !== w.levelId) return false;
      const bs = parseFloat(b.position) || 0;
      const be = bs + (parseFloat(b.length) || 0);
      return wStart < be && wEnd > bs;
    });
    if (hasBeam) continue;

    const hasPostLeft = (supportPosts || []).some(sp =>
      Math.abs((parseFloat(sp.position) || 0) - wStart) <= 0.1);
    const hasPostRight = (supportPosts || []).some(sp =>
      Math.abs((parseFloat(sp.position) || 0) - wEnd) <= 0.1);
    if (hasPostLeft && hasPostRight) continue;

    warnings.push({
      type: 'unsupported_wall', elementId: w.id, elementMark: w.mark || w.id,
      levelId: w.levelId, levelName: levels[wLevelIdx].name || '',
      message: 'Wall has no support below — add stacking wall, beam, or support posts',
    });
  }

  for (const b of (beams || [])) {
    const bStart = parseFloat(b.position) || 0;
    const bEnd = bStart + (parseFloat(b.length) || 0);
    const bLevelIdx = levels.findIndex(l => l.id === b.levelId);
    if (bLevelIdx < 0 || bLevelIdx >= levels.length - 1) continue;
    const belowLevelId = levels[bLevelIdx + 1].id;

    for (const [side, pos] of [['left', bStart], ['right', bEnd]]) {
      const hasPost = (supportPosts || []).some(sp =>
        Math.abs((parseFloat(sp.position) || 0) - pos) <= 0.1);
      const hasWallEnd = allWalls.some(bw => {
        if (bw.levelId !== belowLevelId) return false;
        return pointInWallEnd(pos, bw) !== null;
      });
      const hasWallBelow = allWalls.some(bw => {
        if (bw.levelId !== belowLevelId) return false;
        const bs = parseFloat(bw.position) || 0;
        const be = bs + (parseFloat(bw.length) || 0);
        return pos >= bs && pos <= be;
      });
      if (!hasPost && !hasWallEnd && !hasWallBelow) {
        warnings.push({
          type: 'unsupported_beam_end', elementId: b.id, elementMark: b.id,
          levelId: b.levelId, levelName: levels[bLevelIdx].name || '', side,
          message: 'Beam ' + side + ' support has no post or wall below',
        });
      }
    }
  }

  return { warnings, allClear: warnings.length === 0 };
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
          computeHardwareDC(wallResult, false);
          return wallResult;
        });

        return {
          levelId: lvl.id, levelName: lvl.name || '',
          storyShear_1E: r2(ss.seismic), storyShear_1W: r2(ss.wind),
          walls: wallResults,
        };
      });

      // Phase 3: Stacking accumulation + hardware re-select for stacked walls
      const wallResultsMap = {};
      perLevel.forEach(pl => pl.walls.forEach(wr => { wallResultsMap[wr.wallId] = wr; }));

      const stackGroupIds = detectStacking(allWalls, levels);
      const stackGroups = stackGroupIds.map(ids => {
        const acc = accumulateStackTC(ids, wallResultsMap);
        ids.forEach((wid, idx) => {
          const wr = wallResultsMap[wid];
          if (wr) {
            wr.accumTension = acc.accumulatedTension[idx];
            wr.accumCompression = acc.accumulatedCompression[idx];
            if (acc.perComboAccum) {
              wr.accumPerCombo = {};
              for (const [key, pca] of Object.entries(acc.perComboAccum)) {
                wr.accumPerCombo[key] = {
                  tensionLeft: pca.cumTL[idx], tensionRight: pca.cumTR[idx],
                  comprLeft: pca.cumCL[idx], comprRight: pca.cumCR[idx],
                };
              }
            }
            // Re-select hardware using accumulated forces for stacked walls
            if (idx > 0) {
              const accumT = acc.accumulatedTension[idx];
              const accumC = acc.accumulatedCompression[idx];
              if (wr.anchorageType === 'holdown') {
                wr.anchorageLeft = autoSelectHoldown(accumT);
                wr.anchorageRight = autoSelectHoldown(accumT);
              } else {
                const lvl = levels.find(l => l.id === allWalls.find(w => w.id === wid)?.levelId);
                const floorSpan = lvl?.floorClearSpan || '16';
                wr.anchorageLeft = autoSelectStrap(accumT, floorSpan);
                wr.anchorageRight = autoSelectStrap(accumT, floorSpan);
              }
              const flH = wr.floorH;
              wr.postLeft = autoSelectPost(accumC, lineThickness, grade, flH);
              wr.postRight = autoSelectPost(accumC, lineThickness, grade, flH);
              computeHardwareDC(wr, true);
            }
          }
        });
        return { wallIds: ids, ...acc };
      });

      // Phase 3b: Beam transfers
      const beamTransfers = resolveBeamTransfers(line.beams || [], allWalls, wallResultsMap, levels);

      // Phase 3c: Support post paths
      const postPaths = resolvePostPaths(
        line.supportPosts || [], line.beams || [], allWalls, wallResultsMap,
        levels, beamTransfers, lineThickness, grade,
      );

      // Apply post-to-wall interaction: add post demand to wall end holdowns
      for (const pp of postPaths) {
        for (const pl of pp.perLevel) {
          if (!pl.feedsInto) continue;
          const wr = wallResultsMap[pl.feedsInto.wallId];
          if (!wr) continue;
          if (pl.feedsInto.side === 'left') {
            wr.postDemandLeft = r2((wr.postDemandLeft || 0) + pl.accumT);
            wr.postComprLeft = r2((wr.postComprLeft || 0) + pl.accumC);
          } else {
            wr.postDemandRight = r2((wr.postDemandRight || 0) + pl.accumT);
            wr.postComprRight = r2((wr.postComprRight || 0) + pl.accumC);
          }
        }
      }

      // Phase 3d: Load path audit
      const loadPathAudit = auditLoadPaths(
        allWalls, line.beams || [], line.supportPosts || [],
        levels, beamTransfers, postPaths,
      );

      return { lineId: line.id, lineName: line.name || '', perLevel, stackGroups, beamTransfers, postPaths, loadPathAudit };
    });

    return { dirId: dir.id, dirName: dir.name || '', rho: parseFloat(dir.rho) || 1, perLine };
  });

  return { calcVersion: 'v2', perDirection };
}

function findAnchorage(id, floorSpan) {
  const hd = HDUE_TABLE.find(h => h.id === id);
  if (hd) return hd;
  for (const table of Object.values(MSTC_TABLE)) {
    const s = table.find(t => t.id === id);
    if (s) return s;
  }
  const spanTable = MSTC_TABLE[String(floorSpan)] || MSTC_TABLE['16'];
  const s2 = spanTable.find(t => t.id === id);
  return s2 || null;
}

function findPost(id, wallThickness, grade, floorH) {
  const allPosts = [...(POST_SIZES[wallThickness] || []), ...(POST_SIZES['4'] || []), ...(POST_SIZES['6'] || [])];
  const post = allPosts.find(p => p.id === id);
  if (!post) return null;
  return computePostCapacity(post, grade, floorH);
}

function r2(v) { return Math.round(v * 100) / 100; }
function r4(v) { return Math.round(v * 10000) / 10000; }

function computeHardwareDC(wr, isStacked) {
  const tDemandL = (isStacked && wr.accumTension != null ? wr.accumTension : wr.governingTensionLeft) * 1000;
  const tDemandR = (isStacked && wr.accumTension != null ? wr.accumTension : wr.governingTensionRight) * 1000;
  const cDemandL = isStacked && wr.accumCompression != null ? wr.accumCompression : wr.governingComprLeft;
  const cDemandR = isStacked && wr.accumCompression != null ? wr.accumCompression : wr.governingComprRight;
  wr.anchorageDCLeft = wr.anchorageLeft && wr.anchorageLeft.cap > 0 ? r2(tDemandL / wr.anchorageLeft.cap) : null;
  wr.anchorageDCRight = wr.anchorageRight && wr.anchorageRight.cap > 0 ? r2(tDemandR / wr.anchorageRight.cap) : null;
  wr.postDCLeft = wr.postLeft && wr.postLeft.capacityKips > 0 ? r2(cDemandL / wr.postLeft.capacityKips) : null;
  wr.postDCRight = wr.postRight && wr.postRight.capacityKips > 0 ? r2(cDemandR / wr.postRight.capacityKips) : null;
}
