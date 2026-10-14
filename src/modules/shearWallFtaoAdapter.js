// Builds FTAO engine input (shearWallFtao.js) from a wall with openings and runs it.
// Engine units: lbf, ft, in, psi. Line shares are in kips at the 1.0 level (1.0E / 1.0W).
import { createFTAO } from './shearWallFtao.js';
import { nominalFor, gaFor } from './shearWallNailing.js';
import { autoSelectFtaoStrap, getFtaoStrap, strapNailing, jambPostOptions, anchorageSlip, computePostCapacity, memberProps, sillProps, postSizeById } from './shearWallHardware.js';
import { sortedOpenings, wallPiers } from './shearWallOpenings.js';

function num(v) { return parseFloat(v) || 0; }
function r2(v) { return Math.round(v * 100) / 100; }

const LOAD_TYPES = { seismic: ['E'], wind: ['W'], both: ['E', 'W'] };
export function ftaoLoadTypes(loadType) { return LOAD_TYPES[loadType] || ['E']; }

// Engine geometry: pier lengths, opening widths, h_a / h_o / h_b per opening (h_b = sill)
export function ftaoGeometry(wall, floorH) {
  const h = num(floorH);
  const ops = sortedOpenings(wall);
  return {
    L: wallPiers(wall).map(p => p.length),
    Lo: ops.map(o => o.width),
    openings: ops.map(o => ({ ha: h - o.head, ho: o.head - o.sill, hb: o.sill })),
    h_wall: h,
  };
}

export function jambPostFor(wall, lineThickness) {
  const opts = jambPostOptions(lineThickness);
  return opts.find(p => p.id === wall.jambPostOverride) || opts[0];
}

// ctx: { floorH, rho, sds, grade, sheathing, cd, ie, alphaS, lineThickness, loadType }
// parts: { nailing, endPosts: [postL, postR] (post size objects or null), anchorage, strap, jambAreas: { edgeIndex: in² } }
function engineInput(wall, ctx, lt, parts) {
  const geo = ftaoGeometry(wall, ctx.floorH);
  const nEdges = 2 * geo.L.length;
  const jamb = jambPostFor(wall, ctx.lineThickness);
  const area = (i) => {
    if (i === 0 && parts.endPosts && parts.endPosts[0]) return parts.endPosts[0].area;
    if (i === nEdges - 1 && parts.endPosts && parts.endPosts[1]) return parts.endPosts[1].area;
    if (parts.jambAreas && parts.jambAreas[i] > 0) return parts.jambAreas[i];
    return jamb.area;
  };
  const anc = parts.anchorage;
  // chord E of an edge member: end posts per their grade (4A / 4B / 4D), jambs dimension lumber
  const edgeE = (i) => {
    const p = (i === 0 && parts.endPosts && parts.endPosts[0]) || (i === nEdges - 1 && parts.endPosts && parts.endPosts[1]) || null;
    const m = memberProps(ctx.grade, (p && p.id && postSizeById(p.id)) || jamb);
    return m ? m.E : ctx.grade.E;
  };
  return {
    wallId: wall.mark || wall.id,
    ...geo,
    t555NarrowPier: !!wall.narrowPier,
    loadType: lt,
    rho: num(ctx.rho) || 1,
    Cd: num(ctx.cd) || 1, Ie: num(ctx.ie) || 1, h_sx: geo.h_wall,
    alpha_s: num(ctx.alphaS) || 1,
    vs_nominal: nominalFor(parts.nailing, lt),
    Ga: gaFor(parts.nailing, ctx.sheathing),
    faces: 1, // both-sides nailing rows already carry two faces
    E_post: Array.from({ length: nEdges }, (_, i) => edgeE(i)),
    A_post: Array.from({ length: nEdges }, (_, i) => area(i)),
    Fcperp_plate: sillProps(ctx.grade, ctx.lineThickness).Fcperp, // sill plate: NDS Table 4A / 4B
    HD_allow: (anc && anc.cap) || 1, // ASD cap (engine reference check of the gross H)
    d_a: anchorageSlip(anc), HD_lrfd: (anc && anc.lrfdCap) || 0, // Δa = δ @ LRFD cap × T_pier / LRFD cap (LRFD pair, user 2026-10-14)
    strap_allow: parts.strap ? parts.strap.cap : 1,
  };
}

// ASD shear capacity (lbf) of the FTAO wall for one load type — used as the wall's weight in
// capacity-based line distribution. Throws FTAOInputError on engine hard stops.
export function ftaoCapacityLbf(wall, ctx, nailing, lt) {
  return createFTAO(engineInput(wall, ctx, lt, { nailing })).capacity().Vcap_ASD;
}

// Jamb posts (opening edges), sized for the Diekmann pier chord force (ASD), governing ASD compression combo:
//   C = d·D + l·L + lr·Lr + k·v_i·h_o   (v_i = ASD pier shear beside the opening at 0.7ρE / 0.6W,
//   k = 1 or 0.75 for the combos with 0.75L; h_o = governing opening height). Gravity D / L / Lr (kips) =
// half the pier's load + half the header load above the opening, from the caller (hw.jambDL, jamb order: opening 1 left, right, …).
// Engine edge index of opening j's jambs: left = 2j + 1 (pier j right side), right = 2j + 2 (pier j+1 left side).
function sizeJambs(wall, ctx, perType, hw) {
  const opts = jambPostOptions(ctx.lineThickness);
  const override = wall.jambPostOverride ? opts.find(p => p.id === wall.jambPostOverride) : null;
  const N = sortedOpenings(wall).length;
  const jambs = [];
  for (let j = 0; j < N; j++) {
    for (const side of ['left', 'right']) {
      const k = 2 * j + (side === 'left' ? 0 : 1);
      const pierIdx = side === 'left' ? j : j + 1;
      const raw = (hw.jambDL && hw.jambDL[k]) || 0;
      const g = typeof raw === 'number' ? { D: raw, L: 0, Lr: 0 } : { D: num(raw.D), L: num(raw.L), Lr: num(raw.Lr) };
      const dl = g.D;
      let C = 0, ho = 0, v = 0, lt = null, combo = '';
      const S = num(ctx.sds);
      // ASD compression combos: gravity part + (lateral fraction)·v_i·h_o; v_i is at 0.7ρE / 0.6W
      const cands = [
        { t: null, d: 1, l: 1, lr: 0, k: 0, name: 'D + L' },
        { t: null, d: 1, l: 0, lr: 1, k: 0, name: 'D + Lr' },
        { t: null, d: 1, l: 0.75, lr: 0.75, k: 0, name: 'D + 0.75L + 0.75Lr' },
        { t: 'E', d: 1 + 0.14 * S, l: 0, lr: 0, k: 1, name: '(1.0+0.14SDS)D + 0.7ρE' },
        { t: 'E', d: 1 + 0.105 * S, l: 0.75, lr: 0, k: 0.75, name: '(1.0+0.105SDS)D + 0.525ρE + 0.75L' },
        { t: 'W', d: 1, l: 0, lr: 0, k: 1, name: 'D + 0.6W' },
        { t: 'W', d: 1, l: 0.75, lr: 0.75, k: 0.75, name: 'D + 0.75L + 0.75(0.6W) + 0.75Lr' },
      ];
      for (const cd of cands) {
        const pt = cd.t ? perType[cd.t] : Object.values(perType)[0];
        if (!pt) continue;
        const d0 = pt.d0;
        const vi = cd.k ? d0.forces.piers[pierIdx].v : 0;
        const c = (cd.d * g.D + cd.l * g.L + cd.lr * g.Lr) + cd.k * vi * d0.geometry.ho / 1000;
        if (c > C) { C = c; ho = d0.geometry.ho; v = cd.k * vi; lt = cd.t; combo = cd.name; }
      }
      const capOf = (p) => computePostCapacity(p, ctx.grade, ctx.floorH);
      let post = override ? capOf(override) : null;
      let size = override;
      if (!override) {
        for (const p of opts) { const r = capOf(p); if (r && r.capacityKips >= C) { post = r; size = p; break; } }
      }
      jambs.push({
        opening: j + 1, side, edge: 2 * j + (side === 'left' ? 1 : 2), loadType: lt,
        dl: r2(dl), ll: r2(g.L), lr: r2(g.Lr), combo, v: Math.round(v), ho: r2(ho), C: r2(C),
        post: post ? { id: size.id, label: size.label, area: size.area, capacityKips: post.capacityKips } : null,
        dc: post && post.capacityKips > 0 ? r2(C / post.capacityKips) : null,
        override: !!override,
      });
    }
  }
  return jambs;
}

// Full FTAO design at the wall's line shares (kips, 1.0 level) with the selected end posts and
// anchorage. Picks the lightest FTAO strap for Fmax (or the override) and sizes the jamb posts.
// hw: { endPosts, anchorage, jambDL }. Throws on engine hard stops.
export function ftaoDesign(wall, ctx, nailing, shares, hw) {
  const perType = {};
  let Fmax = 0;
  for (const lt of ftaoLoadTypes(ctx.loadType)) {
    const V1 = (lt === 'E' ? shares.seismic : shares.wind) * 1000;
    if (!(V1 > 0)) continue;
    const base = { nailing, endPosts: hw.endPosts, anchorage: hw.anchorage };
    const d0 = createFTAO(engineInput(wall, ctx, lt, base)).design(V1);
    perType[lt] = { V1, d0 };
    Fmax = Math.max(Fmax, d0.forces.Fmax);
  }

  const override = wall.ftaoStrapOverride ? getFtaoStrap(wall.ftaoStrapOverride) : null;
  const strap = override || autoSelectFtaoStrap(Fmax);
  const jambs = sizeJambs(wall, ctx, perType, hw);
  const jambAreas = {};
  const fallback = jambPostFor(wall, ctx.lineThickness);
  jambs.forEach(jb => { jambAreas[jb.edge] = jb.post ? jb.post.area : fallback.area; });
  const result = {
    method: 'ftao',
    strap: strap ? { id: strap.id, cap: strap.cap, gauge: strap.gauge, nailing: strapNailing(strap), override: !!override } : null,
    strapDemand: Math.round(Fmax),
    strapDC: strap ? r2(Fmax / strap.cap) : null,
    jambs,
    perType: {},
    warnings: [],
  };

  for (const [lt, { V1 }] of Object.entries(perType)) {
    const el = createFTAO(engineInput(wall, ctx, lt, { nailing, endPosts: hw.endPosts, anchorage: hw.anchorage, strap, jambAreas }));
    const d = el.design(V1);
    // wind Δ is only reported when the service factor α_s is set
    const df = el.deflection(V1);
    const defl = lt === 'E' || num(ctx.alphaS) > 0
      ? { Delta_in: df.Delta_in, V_defl: df.loads.V_defl, cases: df.cases, warnings: df.warnings } : null;
    result.perType[lt] = {
      V_1p0: V1, V_ASD: d.loads.V_ASD, kASD: d.loads.kASD,
      geometry: d.geometry,
      H: d.forces.H, va: d.forces.va, O: d.forces.O, corners: d.forces.corners, Fmax: d.forces.Fmax,
      piers: d.forces.piers, anchorage_plf: d.forces.anchorage_plf, lineChecks: d.forces.lineChecks,
      sheathing: d.checks.sheathing, governing: d.checks.governing,
      plateBearing: d.checks.plateBearing, overall: d.checks.overall,
      deflection: defl,
    };
    for (const w of d.warnings) if (!result.warnings.includes(w)) result.warnings.push(w);
  }

  // Governing sheathing zone over the load types
  let gov = null;
  for (const [lt, r] of Object.entries(result.perType)) {
    if (!gov || r.governing.dcr > gov.dcr) gov = { ...r.governing, loadType: lt };
  }
  result.governing = gov;
  // δ(V) at the 1.0 level (in) for the deflection distribution (user 2026-10-14: no stored stiffness; the same level as
  // the segmented walls' Eq. 4.3-1 and the WSWH table): the final element with α_s = 1 for W, at a trial share Vk (k).
  // Built for every load type, also one this wall carries no share of. Not part of the stored results.
  const els = {};
  const deflAt = (lt, Vk) => {
    if (!(Vk > 0)) return 0;
    if (!els[lt]) els[lt] = createFTAO(engineInput(wall, { ...ctx, alphaS: 1 }, lt, { nailing, endPosts: hw.endPosts, anchorage: hw.anchorage, strap, jambAreas }));
    return els[lt].deflection(Vk * 1000).Delta_in;
  };
  Object.defineProperty(result, '_deflAt', { enumerable: false, configurable: true, value: deflAt });
  if (!strap) result.warnings.push('No FTAO strap in the catalog carries ' + Math.round(Fmax) + ' lb');
  jambs.filter(jb => !jb.post).forEach(jb => result.warnings.push('Opening ' + jb.opening + ' ' + jb.side + ' jamb: no ' + ctx.lineThickness + '" post carries ' + jb.C.toFixed(2) + ' k'));
  return result;
}
