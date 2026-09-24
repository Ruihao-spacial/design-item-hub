// Builds FTAO engine input (shearWallFtao.js) from a wall with openings and runs it.
// Engine units: lbf, ft, in, psi. Line shares are in kips at the 1.0 level (1.0E / 1.0W).
import { createFTAO } from './shearWallFtao.js';
import { nominalFor, gaFor } from './shearWallNailing.js';
import { autoSelectFtaoStrap, getFtaoStrap, strapNailing, jambPostOptions } from './shearWallHardware.js';
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

// ctx: { floorH, rho, grade, sheathing, cd, ie, alphaS, lineThickness }
// parts: { nailing, endPosts: [postL, postR] (post size objects or null), anchorage, strap }
function engineInput(wall, ctx, lt, parts) {
  const geo = ftaoGeometry(wall, ctx.floorH);
  const nEdges = 2 * geo.L.length;
  const jamb = jambPostFor(wall, ctx.lineThickness);
  const area = (i) => {
    if (i === 0 && parts.endPosts && parts.endPosts[0]) return parts.endPosts[0].area;
    if (i === nEdges - 1 && parts.endPosts && parts.endPosts[1]) return parts.endPosts[1].area;
    return jamb.area;
  };
  const anc = parts.anchorage;
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
    E_post: Array(nEdges).fill(ctx.grade.E),
    A_post: Array.from({ length: nEdges }, (_, i) => area(i)),
    Fcperp_plate: ctx.grade.Fcperp,
    HD_allow: anc && anc.cap > 0 ? anc.cap : 1,
    d_a: anc && anc.delta != null ? anc.delta : 0,
    strap_allow: parts.strap ? parts.strap.cap : 1,
  };
}

// ASD shear capacity (lbf) of the FTAO wall for one load type — used as the wall's weight in
// capacity-based line distribution. Throws FTAOInputError on engine hard stops.
export function ftaoCapacityLbf(wall, ctx, nailing, lt) {
  return createFTAO(engineInput(wall, ctx, lt, { nailing })).capacity().Vcap_ASD;
}

// Full FTAO design at the wall's line shares (kips, 1.0 level) with the selected end posts and
// anchorage. Picks the lightest FTAO strap for Fmax (or the override). Throws on hard stops.
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
  const jamb = jambPostFor(wall, ctx.lineThickness);
  const result = {
    method: 'ftao',
    strap: strap ? { id: strap.id, cap: strap.cap, gauge: strap.gauge, nailing: strapNailing(strap), override: !!override } : null,
    strapDemand: Math.round(Fmax),
    strapDC: strap ? r2(Fmax / strap.cap) : null,
    jambPost: { id: jamb.id, label: jamb.label, area: jamb.area, override: !!wall.jambPostOverride && jamb.id === wall.jambPostOverride },
    perType: {},
    warnings: [],
  };

  for (const [lt, { V1 }] of Object.entries(perType)) {
    const el = createFTAO(engineInput(wall, ctx, lt, { nailing, endPosts: hw.endPosts, anchorage: hw.anchorage, strap }));
    const d = el.design(V1);
    let defl = null;
    if (lt === 'E' || num(ctx.alphaS) > 0) {
      const df = el.deflection(V1);
      defl = { Delta_in: df.Delta_in, V_defl: df.loads.V_defl, cases: df.cases, warnings: df.warnings };
    }
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
  if (!strap) result.warnings.push('No FTAO strap in the catalog carries ' + Math.round(Fmax) + ' lb');
  return result;
}
