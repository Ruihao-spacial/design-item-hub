// FTAO engine regression (from the ftao-shear-wall skill). Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFTAO, FTAOInputError, crushingDeflection } from '../src/modules/shearWallFtao.js';

const fill = (n, x) => Array(n).fill(x);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

// APA regression mode: E, ρ=1, 2-2x6 DF-L No.2 posts (A=16.5, E=1.6e6), Δc off.
const base = {
  loadType: 'E', rho: 1, Cd: 4, Ie: 1, h_sx: 9, faces: 1,
  d_a: 0.128, strap_allow: 1700, includeDeltaC: false, blocked: true,
};

// T555 two-opening example (15/32 OSB Rated Sheathing, 8d @ 4": v_s = 760 → 380 ASD)
const t555 = (over = {}) => ({
  ...base, h_sx: 8,
  L: [4, 4, 3.5], Lo: [6, 2], h_wall: 8,
  openings: [{ ha: 4 / 3, ho: 8 / 3, hb: 4 }, { ha: 4 / 3, ho: 8 / 3, hb: 4 }],
  vs_nominal: 760, Ga: 19, HD_allow: 2145,
  E_post: fill(6, 1.6e6), A_post: fill(6, 16.5),
  ...over,
});
const V_T555 = 3750 / 0.7; // 1.0-level; V_ASD = 3750, V_defl = 5357

test('T555: statics match Figure 4', () => {
  const d = createFTAO(t555()).design(V_T555);
  near(d.loads.V_ASD, 3750, 1e-6);
  near(d.forces.H, 1538, 1);
  near(d.forces.va, 288, 1);
  const [p1, p2, p3] = d.forces.piers;
  near(p1.v, 337, 1); near(p2.v, 388, 1); near(p3.v, 244, 1);
  near(p1.vc, 120, 1); near(p2.vc, 95, 1); near(p3.vc, 167, 1);
  near(d.forces.Fmax, 865, 1);
  const c = d.forces.corners;
  near(c[0].F_left, 865, 1); near(c[0].F_right, 865, 1); near(c[1].F_left, 308, 1); near(c[1].F_right, 269, 1);
  d.forces.lineChecks.forEach((l) => near(l.residual, 0, 1e-6, `line ${l.line}`));
  near(d.forces.shearSumResidual, 0, 1e-6);
  near(d.forces.anchorage_plf, 3750 / 19.5, 1e-6);
});

test('T555: pier 2 NG at default tolerance, OK* at 3%', () => {
  assert.equal(createFTAO(t555()).design(V_T555).checks.governing.status, 'NG');
  const d = createFTAO(t555({ dcrTol: 0.03 })).design(V_T555);
  assert.equal(d.checks.governing.zone, 'pier 2');
  assert.equal(d.checks.governing.status, 'OK*');
  near(d.checks.governing.dcr, 1.021, 0.001);
});

test('T555 Fig. 6: 3-term Δ = 0.335 in. (7/16 OSB, Ga = 22)', () => {
  near(createFTAO(t555({ Ga: 22 })).deflection(V_T555).Delta_in, 0.335, 0.0005);
});

test('APA xlsx Design Example 3-term, A-cell error corrected: Δ = 0.352 in. (Ga = 19)', () => {
  const r = createFTAO(t555()).deflection(V_T555);
  near(r.loads.V_defl, 5357.14, 0.01);
  near(r.Delta_in, 0.352, 0.0005);
  near(r.driftRatio, (4 * r.Delta_in) / 96, 1e-9);
  const p1L = r.cases[0];
  near(p1L.h, 8, 0); near(p1L.term1_bending, 0.019, 0.0005); near(p1L.term2_shear, 0.202, 0.0005); near(p1L.term3_anchorage, 0.459, 0.0005);
  assert.equal(r.cases[1].h, 4); // pier 1-R toward sheathing below → h_wall − h_b
});

test('APA xlsx One Opening: statics and 3-term Δ = 0.158 in.', () => {
  const el = createFTAO({
    ...base, L: [6, 2], Lo: [6], h_wall: 9, openings: [{ ha: 2, ho: 5, hb: 2 }],
    vs_nominal: 1200, Ga: 17, HD_allow: 3740, E_post: fill(4, 1.6e6), A_post: fill(4, 16.5),
  });
  const d = el.design(10000); // V_ASD 7000
  near(d.forces.H, 4500, 0.5); near(d.forces.va, 1125, 0.5);
  near(d.forces.piers[0].v, 875, 0.5); near(d.forces.piers[1].v, 875, 0.5);
  near(d.forces.piers[0].vc, 31, 0.5); near(d.forces.Fmax, 5063, 0.5);
  near(el.geometry.piers[1].Car, 0.938, 0.001);
  near(el.deflection(1000).Delta_in, 0.158, 0.0005); // xlsx deflection tab uses V_unfactored = 1000
});

test('APA xlsx Two Openings (8000 lbf): statics and 3-term Δ = 0.384 in.', () => {
  const el = createFTAO({
    ...base, L: [5, 5, 5], Lo: [3, 3], h_wall: 9,
    openings: [{ ha: 1.5, ho: 3.5, hb: 4 }, { ha: 1.5, ho: 3.5, hb: 4 }],
    vs_nominal: 1200, Ga: 24, HD_allow: 4800, E_post: fill(6, 1.6e6), A_post: fill(6, 16.5),
  });
  const d = el.design(8000 / 0.7);
  near(d.forces.H, 3429, 0.5); near(d.forces.va, 623, 0.5); near(d.forces.Fmax, 935, 0.5);
  [495, 610, 495].forEach((v, i) => near(d.forces.piers[i].v, v, 0.5));
  [308, 235, 308].forEach((v, i) => near(d.forces.piers[i].vc, v, 0.5));
  near(el.deflection(8000 / 0.7).Delta_in, 0.384, 0.0005);
});

test('APA xlsx Three Openings (12000 lbf): statics and 3-term Δ = 0.773 in.', () => {
  const el = createFTAO({
    ...base, L: [3, 2, 3, 4], Lo: [3, 3, 2], h_wall: 9,
    openings: fill(3, { ha: 2, ho: 3, hb: 4 }),
    vs_nominal: 1740, Ga: 23, HD_allow: 6800, E_post: fill(8, 1.6e6), A_post: fill(8, 16.5),
  });
  const d = el.design(12000 / 0.7);
  near(d.forces.H, 5400, 0.5); near(d.forces.va, 900, 0.5); near(d.forces.Fmax, 1620, 0.5);
  [960, 1320, 1131, 771].forEach((v, i) => near(d.forces.piers[i].v, v, 0.5));
  [420, 240, 334, 514].forEach((v, i) => near(d.forces.piers[i].vc, v, 0.5));
  near(el.deflection(12000 / 0.7).Delta_in, 0.773, 0.0005);
});

test('Unequal opening heights: envelope at governing opening (max h_o, tie → min h_b)', () => {
  const el = createFTAO(t555({ openings: [{ ha: 4 / 3, ho: 8 / 3, hb: 4 }, { ha: 2, ho: 2, hb: 4 }] }));
  assert.equal(el.geometry.governing, 1);
  assert.deepEqual(el.geometry.ignoredOpenings, [2]);
  assert.ok(el.warnings.some((w) => w.includes('Unequal opening heights')));
  near(el.design(V_T555).forces.va, 288.46, 0.01); // same as T555
  // tie on h_o → h_a + h_b equal by construction; tie-break on smallest h_b
  const tie = createFTAO(t555({ openings: [{ ha: 1, ho: 2, hb: 5 }, { ha: 3, ho: 2, hb: 3 }] }));
  assert.equal(tie.geometry.governing, 2);
  assert.equal(tie.geometry.hb, 3);
});

test('Capacity is linear: design at Vcap_1p0 gives governing DCR = 1.00', () => {
  const el = createFTAO(t555());
  const c = el.capacity();
  near(el.design(c.Vcap_1p0).checks.governing.dcr, 1.0, 0.001);
  assert.equal(c.governingZone, 'pier 2');
});

test('Δc crushing at wall-end piers per C4.3.4-2 curve', () => {
  near(crushingDeflection(0.73), 0.02, 1e-12);
  near(crushingDeflection(1.0), 0.04, 1e-12);
  near(crushingDeflection(1.5), 0.02 * 2 * 1.5 ** 3, 1e-12);
  const el = createFTAO(t555({ includeDeltaC: true, Fcperp_plate: 625 }));
  const r = el.deflection(V_T555);
  const C = (V_T555 * 8) / 19.5;
  const dC = crushingDeflection(C / (16.5 * 625));
  near(r.cases[0].dC, dC, 1e-12);          // pier 1-L (wall end)
  assert.equal(r.cases[1].dC, 0);          // pier 1-R (interior edge)
  near(r.cases[5].dC, dC, 1e-12);          // pier 3-R (wall end)
  near(r.Delta_in, 0.35222 + (8 * dC / 4 + 8 * dC / 3.5) / 6, 1e-4);
  const d = el.design(V_T555);
  near(d.checks.plateBearing[0].dcr, 1538.46 / (16.5 * 625), 1e-3);
});

test('Hard stops', () => {
  const bad = (over, frag) => assert.throws(() => createFTAO(t555(over)), (e) => e instanceof FTAOInputError && e.errors.some((m) => m.includes(frag)));
  bad({ L: [1.75, 4, 3.5] }, '< 2.0 ft');
  bad({ L: [1.25, 4, 3.5], t555NarrowPier: true }, '1.5 ft');
  bad({ blocked: false }, 'blocked');
  bad({ openings: [{ ha: 1, ho: 2.67, hb: 4 }, { ha: 4 / 3, ho: 8 / 3, hb: 4 }] }, 'h_wall');
  bad({ openings: [{ ha: 0, ho: 4, hb: 4 }, { ha: 4 / 3, ho: 8 / 3, hb: 4 }] }, 'full-height');
  bad({ L: [1.6, 4, 3.5], t555NarrowPier: true, openings: [{ ha: 1, ho: 6, hb: 1 }, { ha: 1, ho: 6, hb: 1 }] }, '> 3.5'); // 6/1.6 = 3.75
  bad({ Cd: undefined }, 'Cd');
  bad({ loadType: 'W' }, 'alpha_s');
});

test('T555 narrow-pier option: 1.5–2.0 ft passes with warning', () => {
  const el = createFTAO(t555({ L: [1.75, 4, 3.5], t555NarrowPier: true }));
  assert.ok(el.warnings.some((w) => w.includes('§104.11')));
});

test('Wind: 0.6 ASD factor, α_s for deflection, drift report-only', () => {
  const el = createFTAO(t555({ loadType: 'W', alpha_s: 0.7, Cd: undefined, Ie: undefined }));
  assert.equal(el.design(10000).loads.V_ASD, 6000);
  const r = el.deflection(10000);
  assert.equal(r.loads.V_defl, 7000);
  assert.equal(r.delta_x, undefined);
});

test('Two faces doubles capacity and G_a, flags scope', () => {
  const one = createFTAO(t555()), two = createFTAO(t555({ faces: 2 }));
  near(two.capacity().Vcap_ASD, 2 * one.capacity().Vcap_ASD, 1);
  assert.ok(two.warnings.some((w) => w.includes('M410')));
  assert.equal(two.deflection(V_T555).Ga_used, 38);
});

test('Non-default factor flagged', () => {
  const el = createFTAO(t555({ kASD_E: 0.525 }));
  assert.ok(el.warnings.some((w) => w.includes('Non-default kASD_E')));
});
