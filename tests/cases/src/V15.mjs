// V15 — deflection and story drift: Eq. 4.3-1 by hand for two walls, δxe = largest wall δ, δx = Cd·δxe/Ie vs Δa
import { project, level, direction, line, wall, ex, pickNail, pickHD, postCap, POSTS4, NAIL, asdE, f2, f3, f4 } from './lib.mjs';

const Sds = 1.0, V = 6, h = 10, psf = 10, Cd = 4, Ie = 1, limit = 0.020; // RC II, "all other structures"
const a = asdE(Sds);
const walls = [{ mark: 'SW-1', x: 0, L: 10 }, { mark: 'SW-2', x: 18, L: 8 }];
const sumL = walls.reduce((s, w) => s + w.L, 0);
const E = 1700000, Fcp = 625;
for (const w of walls) {
  w.V = V * w.L / sumL;                          // capacity split: same nailing → ∝ cap × L = ∝ L
  w.v = 0.7 * w.V * 1000 / w.L;
  w.n = pickNail(w.v);
  w.R = psf * w.L * h / 1000 / 2;
  w.N = w.V * h / w.L;                           // 1.0E end force (k)
  w.T = 0.7 * w.N - a.up * w.R;
  w.C = a.dn * w.R + 0.7 * w.N;
  w.hd = pickHD(w.T);
  w.post = POSTS4.filter(p => p.d2 >= 3.0).find(p => postCap(p, h).cap >= w.C);
  // Eq. 4.3-1 at 1.0E (ρ = 1): v1 = V/L, T1 = C1 = V·h/L
  w.v1 = w.V * 1000 / w.L; w.T1 = w.N * 1000; w.A = w.post.A; w.Ga = NAIL.find(x => x.id === w.n.id).gaPLY;
  w.t1 = 8 * w.v1 * h ** 3 / (E * w.A * w.L);
  w.t2 = w.v1 * h / (1000 * w.Ga);
  w.dHD = w.hd.delta * w.T1 / w.hd.cap;
  w.r = w.T1 / (w.A * Fcp);
  w.dC = 0.02 * (w.r < 0.73 ? w.r / 0.73 : w.r <= 1 ? 1 + (w.r - 0.73) / 0.27 : 2 * w.r ** 3);
  w.t3 = h * (w.dHD + w.dC) / w.L;
  w.delta = w.t1 + w.t2 + w.t3;
}
const [w1, w2] = walls;
const gov = w1.delta >= w2.delta ? w1 : w2;
const dxe = gov.delta, dx = Cd * dxe / Ie, Da = limit * h * 12;
const defl = (w) => w.mark + ': v = ' + f2(w.v1) + ' plf, T = C = ' + f2(w.T1) + ' lb, A = ' + w.A + ' in², G_a = ' + w.Ga + ' k/in → 8vh³/(EAb) = 8 × ' + f2(w.v1) + ' × ' + h + '³ / (1,700,000 × ' + w.A + ' × ' + w.L + ') = ' + f4(w.t1)
  + '; vh/(1000G_a) = ' + f2(w.v1) + ' × ' + h + ' / (1000 × ' + w.Ga + ') = ' + f4(w.t2) + '; Δ_HD = ' + w.hd.delta + ' × ' + f2(w.T1) + ' / ' + w.hd.cap + ' = ' + f4(w.dHD)
  + '; r = ' + f2(w.T1) + ' / (' + w.A + ' × 625) = ' + f4(w.r) + ' < 0.73 → Δ_c = 0.02 × r / 0.73 = ' + f4(w.dC) + '; h·Δa/b = ' + h + ' × (' + f4(w.dHD) + ' + ' + f4(w.dC) + ') / ' + w.L + ' = ' + f4(w.t3) + ' → δ = ' + f4(w.delta) + ' in.';

export default {
  id: 'V15', title: 'Deflection and story drift', slug: 'deflection-drift',
  intent: 'Two unequal walls at one story with Cd, Ie and risk category entered. Checks every SDPWS Eq. 4.3-1 term (bending, shear, holdown slip, crushing) at 1.0E, that the story drift uses the largest wall δ, and δx = Cd·δxe/Ie against Δa = 0.020·h_sx (ASCE 7-22 Table 12.12-1, RC II). Passing case — no drift sizing.',
  covers: ['SDPWS 2021 Eq. 4.3-1', 'ASCE 7-22 §12.8.6', 'ASCE 7-22 Table 12.12-1', 'HDUE slip δ·T/cap', 'Plate crushing (r < 0.73)'],
  handCalc: [
    'Capacity distribution: both walls start at the same nailing, so V splits by length: V_1 = ' + V + ' × ' + w1.L + '/' + sumL + ' = ' + f3(w1.V) + ' k, V_2 = ' + V + ' × ' + w2.L + '/' + sumL + ' = ' + f3(w2.V) + ' k.',
    'ASD unit shear v = 0.7·V/L = ' + f2(w1.v) + ' plf on both walls (equal by construction) ≤ 312 plf → 6" o.c., D/C = ' + f3(w1.v / 312) + '. h/b = 1.0 and 1.25 ≤ 2 → C_hb = 1.',
    'Hardware: T = 0.7·V·h/L − 0.46·R_D. SW-1: 0.7 × ' + f3(w1.N) + ' − 0.46 × ' + f2(w1.R) + ' = ' + f3(w1.T) + ' k → ' + w1.hd.id + '; SW-2: 0.7 × ' + f3(w2.N) + ' − 0.46 × ' + f2(w2.R) + ' = ' + f3(w2.T) + ' k → ' + w2.hd.id + '. Posts: C ≤ 5.00 k → (2)2x4 (HDUE3 minimum post), A = 10.5 in².',
    defl(w1),
    defl(w2),
    'Story drift: δxe = the largest wall δ = ' + gov.mark + ' ' + f4(dxe) + ' in (the shorter wall deflects more at the same unit shear: 8vh³/EAb and h·Δa/b grow with 1/b).',
    'δx = Cd·δxe/Ie = ' + Cd + ' × ' + f4(dxe) + ' / ' + Ie + ' = ' + f4(dx) + ' in. Δa = 0.020 × h_sx = 0.020 × ' + h + ' × 12 = ' + f3(Da) + ' in (Table 12.12-1, RC II). δx/h_sx = ' + f4(dx / (h * 12)) + ' → ' + f4(dx) + ' ≤ ' + f3(Da) + ' OK, no drift upsizing.',
    'Line checks G1–G12 pass (5 → 6 k all to the foundation, self-weight only).',
  ],
  expect: [
    ex('SW-1 share V (1.0E)', 'wall:SW-1', 'shareExact_1E', w1.V, 1),
    ex('SW-1 8vh³/(EAb) → (in)', 'wall:SW-1', 'deflection.E.dirs[0].t1', w1.t1, 4, 0.0002),
    ex('SW-1 vh/(1000G_a) (in)', 'wall:SW-1', 'deflection.E.dirs[0].t2', w1.t2, 4, 0.0002),
    ex('SW-1 holdown slip Δ_HD (in)', 'wall:SW-1', 'deflection.E.dirs[0].dHD', w1.dHD, 4, 0.0002),
    ex('SW-1 crushing Δ_c (in)', 'wall:SW-1', 'deflection.E.dirs[0].dC', w1.dC, 4, 0.0002),
    ex('SW-1 δ (in)', 'wall:SW-1', 'deflection.E.delta', w1.delta, 4, 0.0003),
    ex('SW-2 h·Δa/b (in)', 'wall:SW-2', 'deflection.E.dirs[0].t3', w2.t3, 5, 0.0002),
    ex('SW-2 δ (in)', 'wall:SW-2', 'deflection.E.delta', w2.delta, 5, 0.0003),
    ex('Story δxe (in)', 'drift:Level 1', 'seismic.deltaXE', dxe, 6, 0.0003),
    ex('Governing wall for drift', 'drift:Level 1', 'seismic.wallMark', gov.mark, 6),
    ex('δx = Cd·δxe/Ie (in)', 'drift:Level 1', 'seismic.deltaX', dx, 7, 0.001),
    ex('Allowable Δa (in)', 'drift:Level 1', 'seismic.allowable', Da, 7, 0.0001),
    ex('Drift passes', 'drift:Level 1', 'seismic.pass', true, 7),
  ],
  expectChecks: { fail: [] },
  notChecked: 'Wind drift (see V18) and drift sizing (see V16).',
  // Design pinned as manual overrides (method case): the engine picks at calc v13, frozen 2026-09-30
  pins: {"SW-1":{"nail":"6","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"},"SW-2":{"nail":"6","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"}},
  inputs: project({
    sds: String(Sds), cd: String(Cd), ie: String(Ie), riskCategory: 'II', driftRow: 'other',
    wallDLTypes: [{ id: 'wdt-1', name: 'Stud wall', psf: String(psf) }],
    levels: [level('lvl-1', 'Level 1', h)],
    directions: [direction('dir-1', 'N-S', [line({ totalLength: 30, levelLoads: { 'lvl-1': { seismic: String(V), wind: '' } }, gravityLoads: { 'lvl-1': { loads: [] } },
      walls: walls.map((w, i) => wall('w-' + (i + 1), w.mark, 'lvl-1', w.x, w.L)) })])],
  }),
};
