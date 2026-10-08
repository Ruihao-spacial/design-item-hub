import { pointInWallEnd, findAnchorage, selectEndPost } from './shearWallCalc.js';
import { autoSelectHoldown, autoSelectStrap } from './shearWallHardware.js';
import { gravityValue } from './shearWallCombos.js';

// Vertical load path: wall ends, posts at any story, transfer beams with user-defined supports.
// Per-combo force maps are signed: + = compression (down), − = uplift. Each wall end contributes
// its own combo T/C (compr − tension) plus whatever lands on that end from above.
// Floor line i = bottom of story levels[i]. Beams with levelId = story i sit on floor line i
// and carry story i walls/posts. A post with levelId = story i spans story i floor-to-floor.
//
// Receiver at a floor line (first match): beam spanning x → foundation (bottom story) →
// post in the story below at x → wall end below at x (either end of any wall) →
// mid-wall below (needs a post: warning, no transfer) → nothing (warning).

const TOL = 0.1;

function num(v) { return parseFloat(v) || 0; }
function r2(v) { return Math.round(v * 100) / 100; }
function zeroMap(keys) { const m = {}; for (const k of keys) m[k] = 0; return m; }
function addInto(target, src) { for (const k of Object.keys(target)) target[k] += src[k] || 0; }
// End forces stay unrounded (rounded for display only, user decision 2026-09-29); roundMap only copies
function roundMap(m) { return { ...m }; }
function span(e) { const s = num(e.position); return [s, s + num(e.length)]; }

// Envelope over one combo group (ASD designs; LRFD is reported): T = max uplift, C = max compression
export function envelope(map, comboGroups, group = 'asd') {
  let T = 0, C = 0;
  for (const [k, v] of Object.entries(map || {})) {
    if (comboGroups[k] !== group) continue;
    if (v < 0) T = Math.max(T, -v); else C = Math.max(C, v);
  }
  return { T, C };
}

// Per-end envelope of accumulated wall combos over one group
function endEnvelope(accum, comboGroups, group) {
  const o = { tL: 0, tR: 0, cL: 0, cR: 0 };
  for (const [k, c] of Object.entries(accum)) {
    if (comboGroups[k] !== group) continue;
    o.tL = Math.max(o.tL, c.tensionLeft); o.tR = Math.max(o.tR, c.tensionRight);
    o.cL = Math.max(o.cL, c.comprLeft); o.cR = Math.max(o.cR, c.comprRight);
  }
  return o;
}

export function resolveVerticalLoadPath(ctx) {
  const { levels, walls, beams, posts, wallResultsMap, lineThickness, grade } = ctx;
  // absorbedInto: stacked WSWH 2nd-story panel id → the panel below, whose base moment check already includes it
  const absorbedInto = ctx.absorbedInto || {};
  const warnings = [];
  const notes = [];
  const nLv = levels.length;

  const sample = Object.values(wallResultsMap).find(w => w.combos);
  const comboKeys = sample ? Object.keys(sample.combos) : [];
  const comboGroups = {};
  comboKeys.forEach(k => { comboGroups[k] = sample.combos[k].group; });
  const env = (m) => envelope(m, comboGroups);
  const envL = (m) => envelope(m, comboGroups, 'lrfd');
  // Ω₀ envelopes (ASD §2.4.5 / LRFD §2.3.6) — reported forces only
  const envO = (m) => ({ asd: envelope(m, comboGroups, 'asd_omega'), lrfd: envelope(m, comboGroups, 'lrfd_omega') });

  const levelName = (li) => (levels[li] && levels[li].name) || '';
  const levelIdx = {};
  levels.forEach((l, i) => { levelIdx[l.id] = i; });
  const markOf = (e) => e.mark || e.id;

  const incoming = {};   // wallId → { left: map, right: map, sources: [] }
  const postState = {};  // postId → { load: map, sources: [] }
  posts.forEach(p => { postState[p.id] = { load: zeroMap(comboKeys), sources: [] }; });
  const beamLoads = {};  // beamId → [{ x, map, source }]
  beams.forEach(b => { beamLoads[b.id] = []; });

  // Gravity loads on top of beams and posts (ctx.beamGravity / postGravity from shearWallGravity.js),
  // per combo from the combo factors on D / L / Lr (+ = compression)
  const comboF = {};
  comboKeys.forEach(k => { comboF[k] = sample.combos[k].f || { d: 0, l: 0, lr: 0 }; });
  const gravMap = (g) => { const m = zeroMap(comboKeys); for (const k of comboKeys) m[k] = gravityValue(comboF[k], g); return m; };
  for (const [bid, list] of Object.entries(ctx.beamGravity || {})) {
    if (!beamLoads[bid]) continue;
    list.forEach((ld, i) => beamLoads[bid].push({ x: ld.x, map: gravMap(ld.g), source: { type: 'gravity', id: bid + '#g' + i, label: ld.label }, gravity: ld }));
  }
  for (const [pid, list] of Object.entries(ctx.postGravity || {})) {
    const st = postState[pid];
    if (!st) continue;
    for (const ld of list) {
      const m = gravMap(ld.g);
      addInto(st.load, m);
      st.sources.push({ type: 'gravity', id: pid, label: ld.label, map: roundMap(m), env: env(m), gravity: ld.g });
    }
  }

  const wallDeliveries = [];
  const beamTransfers = [];
  const postPaths = [];

  // Own end force of a wall per combo, from its T/C results
  function ownEndMap(wr, side) {
    const m = zeroMap(comboKeys);
    for (const k of comboKeys) {
      const c = wr.combos[k] || {};
      m[k] = side === 'left' ? (c.comprLeft || 0) - (c.tensionLeft || 0) : (c.comprRight || 0) - (c.tensionRight || 0);
    }
    return m;
  }
  function wallEndMap(w, side) {
    const m = ownEndMap(wallResultsMap[w.id], side);
    if (incoming[w.id]) addInto(m, incoming[w.id][side]);
    return m;
  }

  function beamAt(levelId, x) {
    return beams.find(b => {
      if (b.levelId !== levelId) return false;
      const [bs, be] = span(b);
      return be - bs > 0 && x >= bs - TOL && x <= be + TOL;
    });
  }

  // kind: 'element' (wall end / post base) | 'point' | 'post' (beam support types)
  function findReceiver(li, x, kind) {
    const lvl = levels[li];
    if (kind === 'element') {
      const bm = beamAt(lvl.id, x);
      if (bm) return { type: 'beam', id: bm.id, label: markOf(bm) };
    }
    if (li === nLv - 1) return { type: 'foundation', label: 'Foundation' };
    const belowId = levels[li + 1].id;
    const postBelow = posts.find(p => p.levelId === belowId && Math.abs(num(p.position) - x) <= TOL);
    if (kind === 'post') {
      return postBelow ? { type: 'post', id: postBelow.id, label: markOf(postBelow) } : { type: 'none', label: 'No post below' };
    }
    if (kind === 'element' && postBelow) return { type: 'post', id: postBelow.id, label: markOf(postBelow) };
    for (const bw of walls) {
      if (bw.levelId !== belowId) continue;
      const side = pointInWallEnd(x, bw, TOL);
      if (side) return { type: 'wall_end', id: bw.id, side, label: markOf(bw) + (side === 'left' ? ' L' : ' R'), postBelow };
    }
    for (const bw of walls) {
      if (bw.levelId !== belowId) continue;
      const [ws, we] = span(bw);
      if (x > ws && x < we) return { type: 'wall_mid', id: bw.id, label: 'Mid-wall on ' + markOf(bw), postBelow };
    }
    if (kind === 'point') return { type: 'reported', label: 'Reaction only', postBelow };
    return { type: 'none', label: 'Unsupported' };
  }

  function deliver(li, x, map, source, kind) {
    let rec = findReceiver(li, x, kind);
    if (rec.type === 'wall_end' && source.type === 'wall' && absorbedInto[source.id] === rec.id) {
      return { type: 'wswh_stack', id: rec.id, side: rec.side, label: rec.label + ' (WSWH stack — in the base moment check)' };
    }
    const rounded = roundMap(map);
    if (rec.type === 'beam') beamLoads[rec.id].push({ x, map, source });
    else if (rec.type === 'post') {
      addInto(postState[rec.id].load, map);
      postState[rec.id].sources.push({ ...source, map: rounded, env: env(map) });
    } else if (rec.type === 'wall_end') {
      if (!incoming[rec.id]) incoming[rec.id] = { left: zeroMap(comboKeys), right: zeroMap(comboKeys), sources: [] };
      addInto(incoming[rec.id][rec.side], map);
      incoming[rec.id].sources.push({ ...source, side: rec.side, map: rounded, env: env(map) });
    }
    return rec;
  }

  // Connection hardware at floor line li — same rule as walls
  function selectAnchorage(li, T, overrideId) {
    const lvl = levels[li];
    const useHoldown = li === nLv - 1 || lvl.anchorageType === 'holdown';
    const floorSpan = lvl.floorClearSpan || '16';
    const anchorage = overrideId ? findAnchorage(overrideId, floorSpan)
      : useHoldown ? autoSelectHoldown(T) : autoSelectStrap(T, floorSpan);
    const anchorageDC = anchorage && anchorage.cap > 0 ? r2(T * 1000 / anchorage.cap) : null;
    return { anchorageType: useHoldown ? 'holdown' : 'strap', anchorage, anchorageDC };
  }
  const hasConnection = (rec) => ['beam', 'post', 'wall_end', 'foundation'].includes(rec.type);
  const noHardware = { anchorageType: null, anchorage: null, anchorageDC: null };

  // Input sanity checks
  beams.forEach((b, i) => {
    const [bs, be] = span(b);
    for (const o of beams.slice(i + 1)) {
      if (o.levelId !== b.levelId) continue;
      const [os, oe] = span(o);
      if (Math.min(be, oe) - Math.max(bs, os) > TOL) {
        warnings.push({ type: 'beam_overlap', elementId: b.id, elementMark: markOf(b), levelName: levelName(levelIdx[b.levelId]),
          message: markOf(b) + ' overlaps ' + markOf(o) + ' on the same floor line' });
      }
    }
  });
  posts.forEach((p, i) => {
    const dup = posts.slice(0, i).find(o => o.levelId === p.levelId && Math.abs(num(o.position) - num(p.position)) <= TOL);
    if (dup) {
      warnings.push({ type: 'duplicate_post', elementId: p.id, elementMark: markOf(p), levelName: levelName(levelIdx[p.levelId]),
        message: markOf(p) + ' duplicates ' + markOf(dup) + ' at ' + num(p.position).toFixed(1) + ' ft — only ' + markOf(dup) + ' carries load; delete the extra post' });
    }
  });

  for (let li = 0; li < nLv; li++) {
    const lvl = levels[li];

    // 1. Wall ends of story li
    for (const w of walls) {
      if (w.levelId !== lvl.id || !wallResultsMap[w.id] || !wallResultsMap[w.id].combos) continue;
      const [ws, we] = span(w);
      const missing = [];
      for (const [side, x] of [['left', ws], ['right', we]]) {
        const map = wallEndMap(w, side);
        const rec = deliver(li, x, map, { type: 'wall', id: w.id, end: side, label: markOf(w) + (side === 'left' ? ' L' : ' R') }, 'element');
        wallDeliveries.push({ wallId: w.id, levelId: lvl.id, side, position: x, receiver: rec, map: roundMap(map), env: env(map) });
        if (rec.type === 'none') missing.push(side + ' end: nothing below');
        if (rec.type === 'wall_mid') missing.push(side + ' end lands ' + rec.label.toLowerCase() + ' — add a post below');
      }
      if (missing.length) {
        warnings.push({ type: 'unsupported_wall', elementId: w.id, elementMark: markOf(w), levelId: w.levelId, levelName: levelName(li),
          message: missing.join('; ') + ' (no load transferred)' });
      }
    }

    // 2. Post bases of story li
    for (const p of posts) {
      if (p.levelId !== lvl.id) continue;
      const st = postState[p.id];
      const x = num(p.position);
      const rec = deliver(li, x, st.load, { type: 'post', id: p.id, label: markOf(p) }, 'element');
      const e = env(st.load);
      const floorH = num(lvl.floorToFloor) || 10;
      const hw = hasConnection(rec) ? selectAnchorage(li, e.T, p.anchorageOverride) : noHardware;
      // Support post member: max(ASD, Ω₀ ASD) compression (it supports a discontinued element, §12.3.3.3)
      const eO = envelope(st.load, comboGroups, 'asd_omega');
      const Cd = Math.max(e.C, eO.C);
      const ps = selectEndPost(p.postOverride, Cd, lineThickness, grade, floorH, hw.anchorage);
      const post = ps.post;
      const postDC = post && post.capacityKips > 0 ? r2(Cd / post.capacityKips) : null;
      if (rec.type === 'none' || rec.type === 'wall_mid') {
        warnings.push({ type: 'unsupported_post', elementId: p.id, elementMark: markOf(p), levelName: levelName(li),
          message: rec.type === 'wall_mid' ? 'Post base lands ' + rec.label.toLowerCase() + ' — add a post below (no load transferred)'
            : 'Post base has nothing below — add a post, beam, or wall end below' });
      }
      if (!st.sources.length && !warnings.some(w => w.type === 'duplicate_post' && w.elementId === p.id)) {
        notes.push({ type: 'post_no_load', elementId: p.id, elementMark: markOf(p), levelName: levelName(li), message: markOf(p) + ' carries no load from above' });
      }
      // Load added at this level (not from a post above) — for back-checking Σ
      const levelLoad = zeroMap(comboKeys);
      st.sources.filter(s => s.type !== 'post').forEach(s => addInto(levelLoad, s.map));
      postPaths.push({
        postId: p.id, mark: markOf(p), levelId: lvl.id, levelName: levelName(li), position: x, floorH,
        perCombo: roundMap(st.load), envelopeT: e.T, envelopeC: e.C, lrfd: envL(st.load), omega: envO(st.load),
        levelLoad: roundMap(levelLoad), levelLoadEnv: env(levelLoad),
        hasPostAbove: st.sources.some(s => s.type === 'post'),
        sources: st.sources, receiver: rec,
        ...hw, post, postDC, postRaised: ps.raised ? ps : null,
        postDesignC: Cd, postGoverns: eO.C > e.C + 1e-9 ? 'Ω₀ ASD' : 'ASD',
      });
    }

    // 3. Beams at floor line li — statics with the 2 user-defined supports
    for (const b of beams) {
      if (b.levelId !== lvl.id) continue;
      const [bs, be] = span(b);
      const sups = [...(b.supports || [])].sort((a, c) => num(a.position) - num(c.position));
      const loads = beamLoads[b.id];
      const mark = markOf(b);
      let problem = null;
      if (be - bs <= 0) problem = 'Beam has zero span';
      else if (sups.length !== 2) problem = mark + ' needs exactly 2 supports (has ' + sups.length + ')';
      else if (sups.some(s => num(s.position) < bs - TOL || num(s.position) > be + TOL)) problem = mark + ' has a support outside the beam span';
      else if (num(sups[1].position) - num(sups[0].position) <= TOL) problem = mark + ' supports coincide';
      if (problem) {
        warnings.push({ type: 'beam_invalid', elementId: b.id, elementMark: mark, levelName: levelName(li), message: problem + ' — no reactions computed' });
      }

      const xa = sups[0] ? num(sups[0].position) : bs;
      const xb = sups[1] ? num(sups[1].position) : be;
      const Ra = zeroMap(comboKeys), Rb = zeroMap(comboKeys);
      if (!problem) {
        for (const ld of loads) {
          for (const k of comboKeys) {
            const P = ld.map[k] || 0;
            const ra = P * (xb - ld.x) / (xb - xa);
            Ra[k] += ra;
            Rb[k] += P - ra;
          }
        }
      }

      const supportResults = (problem ? [] : [[sups[0], Ra], [sups[1], Rb]]).map(([s, R], j) => {
        const x = num(s.position);
        const type = s.type === 'post' ? 'post' : 'point';
        const rec = deliver(li, x, R, { type: 'beam', id: b.id, supportId: s.id, label: mark + (j === 0 ? ' L' : ' R') }, type);
        const e = env(R);
        if (rec.type === 'none') {
          warnings.push({ type: 'post_support_missing', elementId: b.id, elementMark: mark, levelName: levelName(li),
            message: mark + ' support at ' + x.toFixed(1) + ' ft is a Post support but no post is placed in the story below' });
        } else if (type === 'point' && rec.postBelow) {
          notes.push({ type: 'point_over_post', elementId: b.id, elementMark: mark, levelName: levelName(li),
            message: mark + ' support at ' + x.toFixed(1) + ' ft is a Point support but ' + markOf(rec.postBelow) + ' is below — set type to Post to carry load down' });
        } else if (rec.type === 'reported' || rec.type === 'wall_mid') {
          notes.push({ type: 'reaction_reported', elementId: b.id, elementMark: mark, levelName: levelName(li),
            message: mark + ' support at ' + x.toFixed(1) + ' ft' + (rec.type === 'wall_mid' ? ' bears ' + rec.label.toLowerCase() : '')
              + ': reaction T ' + e.T.toFixed(2) + 'k / C ' + e.C.toFixed(2) + 'k — design support externally' });
        }
        const hw = hasConnection(rec) ? selectAnchorage(li, e.T, s.anchorageOverride) : noHardware;
        return { supportId: s.id, position: x, type, perCombo: roundMap(R), envelopeT: e.T, envelopeC: e.C, lrfd: envL(R), omega: envO(R), receiver: rec, ...hw };
      });

      beamTransfers.push({
        beamId: b.id, mark, levelId: lvl.id, levelName: levelName(li),
        position: bs, length: r2(be - bs), valid: !problem,
        loads: loads.map(ld => ({ x: r2(ld.x), label: ld.source.label, sourceType: ld.source.type, sourceId: ld.source.id,
          map: roundMap(ld.map), env: env(ld.map), gravity: ld.gravity ? { ...ld.gravity.g, uniform: ld.gravity.uniform || null } : null })),
        supports: supportResults,
      });
    }
  }

  // Walls with loads landing on their ends: accumulate per side per combo, re-select hardware
  for (const w of walls) {
    const wr = wallResultsMap[w.id];
    const inc = incoming[w.id];
    if (!wr || !wr.combos || !inc) continue;
    const accum = {};
    let tL = 0, tR = 0, cL = 0, cR = 0;
    const lr = { tL: 0, tR: 0, cL: 0, cR: 0 };
    for (const k of comboKeys) {
      const c = wr.combos[k];
      const netL = (c.comprLeft || 0) - (c.tensionLeft || 0) + inc.left[k];
      const netR = (c.comprRight || 0) - (c.tensionRight || 0) + inc.right[k];
      accum[k] = {
        tensionLeft: Math.max(0, -netL), comprLeft: Math.max(0, netL),
        tensionRight: Math.max(0, -netR), comprRight: Math.max(0, netR),
      };
      if (comboGroups[k] === 'lrfd') {
        lr.tL = Math.max(lr.tL, accum[k].tensionLeft); lr.tR = Math.max(lr.tR, accum[k].tensionRight);
        lr.cL = Math.max(lr.cL, accum[k].comprLeft); lr.cR = Math.max(lr.cR, accum[k].comprRight);
      }
      if (comboGroups[k] !== 'asd') continue;
      tL = Math.max(tL, accum[k].tensionLeft); tR = Math.max(tR, accum[k].tensionRight);
      cL = Math.max(cL, accum[k].comprLeft); cR = Math.max(cR, accum[k].comprRight);
    }
    const demand = { tL, tR, cL, cR };
    wr.accumPerCombo = accum;
    wr.accumTension = Math.max(demand.tL, demand.tR);
    wr.accumCompression = Math.max(demand.cL, demand.cR);
    wr.injections = inc.sources;
    wr.hwDemand = demand;
    wr.accumLRFD = { ...lr };
    wr.accumOmega = { asd: endEnvelope(accum, comboGroups, 'asd_omega'), lrfd: endEnvelope(accum, comboGroups, 'lrfd_omega') };

    const lvl = levels[levelIdx[w.levelId]];
    const floorSpan = (lvl && lvl.floorClearSpan) || '16';
    const hook = ctx.wallHardware ? (T, ov) => ctx.wallHardware(w, T, ov) : () => undefined;
    const pickAnc = (ov, T) => { const h = hook(T, ov); if (h !== undefined) return h; return ov ? findAnchorage(ov, floorSpan)
      : wr.anchorageType === 'holdown' ? autoSelectHoldown(T) : autoSelectStrap(T, floorSpan); };
    wr.anchorageLeft = pickAnc(w.anchorageLeftOverride, demand.tL);
    wr.anchorageRight = pickAnc(w.anchorageRightOverride, demand.tR);
    const panel = wr.method === 'wswh'; // WSWH: no separate end posts
    const selL = panel ? { post: wr.postLeft } : selectEndPost(w.postLeftOverride, demand.cL, lineThickness, grade, wr.floorH, wr.anchorageLeft);
    const selR = panel ? { post: wr.postRight } : selectEndPost(w.postRightOverride, demand.cR, lineThickness, grade, wr.floorH, wr.anchorageRight);
    wr.postLeft = selL.post;
    wr.postRight = selR.post;
    wr.postRaised = { left: selL.raised ? selL : null, right: selR.raised ? selR : null };
    wr.anchorageDCLeft = wr.anchorageLeft && wr.anchorageLeft.cap > 0 ? r2(demand.tL * 1000 / wr.anchorageLeft.cap) : null;
    wr.anchorageDCRight = wr.anchorageRight && wr.anchorageRight.cap > 0 ? r2(demand.tR * 1000 / wr.anchorageRight.cap) : null;
    wr.postDCLeft = wr.postLeft && wr.postLeft.capacityKips > 0 ? r2(demand.cL / wr.postLeft.capacityKips) : null;
    wr.postDCRight = wr.postRight && wr.postRight.capacityKips > 0 ? r2(demand.cR / wr.postRight.capacityKips) : null;
  }

  return {
    beamTransfers, postPaths, wallDeliveries, comboGroups,
    loadPathAudit: { warnings, notes, allClear: warnings.length === 0 },
  };
}
