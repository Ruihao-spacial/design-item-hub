// V22 — robustness: awkward but valid inputs must calculate, render and report what is wrong
import { project, level, direction, line, wall, ex, f2, f3, f4, eq431, storyDrift, driftExpect } from './lib.mjs';

const h = 10, F2 = 2, F1 = 4, L1 = 8, L2 = 2.5, lineLen = 20;
const V = F2 + F1;                               // Level 1 story shear (k): the Level 2 load still accumulates below
const v = 0.7 * V * 1000 / L1, cap6 = 312;
const N = V * h / L1;                            // no gravity → T = C = 0.7·N
const T = 0.7 * N;
// HDUE3 3790 < 5250 → HDUE5 5375 lb (δ 0.146); posts: (2)2x4 5.00 k < 5.25 → (3)2x4 7.50 k (A = 15.75)
const hd = { id: 'HDUE5', cap: 5375, delta: 0.146 }, A = 15.75, Ga = 16, E = 1700000;
const v1 = V * 1000 / L1, T1 = N * 1000;
const t1 = 8 * v1 * h ** 3 / (E * A * L1), t2 = v1 * h / (1000 * Ga), dHD = hd.delta * T1 / hd.cap;
const r = T1 / (A * 625), dC = 0.02 * (1 + (r - 0.73) / 0.27), t3 = h * (dHD + dC) / L1, delta = t1 + t2 + t3;
// Story drift (Cd 4, Ie 1.0, RC II — C_d and I_e typed with spaces, " 4 " / "1.0 ", to test the parsing): SW-1 alone governs
// Level 1 (SW-2, h/b > 3.5, has no share and no δ); Level 2 has no wall → no drift row. Pinned design → drift NG kept.
const d1 = storyDrift('Level 1', h, [eq431({ mark: 'SW-1', L: L1, h, nail: '6', hdL: 'HDUE5', hdR: 'HDUE5', postL: '(3)2x4', postR: '(3)2x4', Vk: V, TL: N, CR: N })]);

export default {
  id: 'V22', title: 'Robustness — awkward inputs', slug: 'robustness',
  intent: 'Valid but awkward inputs: numbers typed with spaces or left blank, a level with lateral load but no wall, walls touching both line ends, zero gravity (blank wall weight and a blank uniform load), a wall with h/b > 3.5 and a manual nailing lighter than needed. The item must calculate and render every tab; the problems must be reported: G2 fails at the level without a wall, the h/b > 3.5 wall is flagged and carries no shear, and the under-nailed wall shows D/C > 1.',
  covers: ['Input parsing (blank / whitespace)', 'G2 horizontal equilibrium', 'SDPWS 2021 §4.3.4 h/b > 3.5', 'Manual nailing NG', 'Rendering with no gravity'],
  handCalc: [
    'Parsing: S_DS " 1.0 " → 1.0 (so the ASD uplift factor 0.6 − 0.14 × 1.0 = 0.46), ρ " " → 1.0, Level 1 floor-to-floor "10" → 10 ft, wind "  " / "" → 0, wall weight psf "" → 0, uniform D " " → 0: no gravity anywhere.',
    'Level 2 has 1.0E = ' + F2 + ' k but no wall in this line → G2 (horizontal equilibrium) fails at Level 2 (expected ' + F2 + ' k, carried 0). The load still accumulates into the Level 1 story shear: V = ' + F2 + ' + ' + F1 + ' = ' + V + ' k.',
    'SW-2 (x = 17.5–20.0 ft, touching the line end): h/b = 10/2.5 = 4.0 > 3.5 → not a shear wall (SDPWS 2021 §4.3.4), carries no shear, audit warning. SW-1 (x = 0–8, touching the line start) takes all ' + V + ' k.',
    'SW-1 manual 6" o.c.: v = 0.7 × ' + V * 1000 + '/' + L1 + ' = ' + f2(v) + ' plf vs 312 plf → D/C = ' + f3(v / cap6) + ' > 1 → wall NG (a design result, not an equilibrium check).',
    'SW-1 end forces (no gravity): N = ' + V + ' × ' + h + '/' + L1 + ' = ' + f2(N) + ' k → T = C = 0.7 × ' + f2(N) + ' = ' + f2(T) + ' k → HDUE5 (5,375 lb; HDUE3 3,790 lb too small), posts (3)2x4 (the (2)2x4 minimum post has 5.00 k < 5.25 k).',
    'SW-1 δ at 1.0E: v = ' + v1 + ' plf, A = 15.75 in², G_a = 16 → 8vh³/(EAb) = ' + f4(t1) + ', vh/(1000G_a) = ' + f4(t2) + ', Δ_HD = 0.146 × ' + T1 + '/5375 = ' + f4(dHD) + ', r = ' + f4(r) + ' (0.73–1.0) → Δ_c = 0.02 × (1 + (r − 0.73)/0.27) = ' + f4(dC) + ', h·Δa/b = ' + f4(t3) + ' → δ = ' + f4(delta) + ' in.',
    'Seismic inputs typed with spaces: C_d " 4 " → 4, I_e "1.0 " → 1.0, risk category II (Ω₀ blank → default 2.5). SW-2 (h/b > 3.5) has no share and no δ; Level 2 has no wall, so no drift row. ' + d1.text,
    'Every other line check passes; every tab, calc sheet, elevation and PDF section renders (runner T4).',
  ],
  expect: [
    ex('ASD uplift factor from S_DS " 1.0 "', 'wall:SW-1', 'combos["0.6D+0.7ρE_pos"].f.d', 0.46, 1, 1e-9),
    ex('SW-1 floor height from "10" (ft)', 'wall:SW-1', 'floorH', 10, 1, 0),
    ex('SW-1 dead load (k)', 'wall:SW-1', 'dlTotal', 0, 1, 0),
    ex('Level 1 story shear (k)', 'level:Level 1', 'storyShear_1E', V, 2),
    ex('SW-2 not a shear wall (h/b > 3.5)', 'wall:SW-2', 'hbNotPermitted', true, 3),
    ex('SW-2 share (k)', 'wall:SW-2', 'shareExact_1E', 0, 3, 1e-9),
    ex('SW-1 share (k)', 'wall:SW-1', 'shareExact_1E', V, 3),
    ex('SW-1 unit shear (plf)', 'wall:SW-1', 'unitShear_seismic', v, 4, 0.01),
    ex('SW-1 D/C > 1', 'wall:SW-1', 'dcRatio', v / cap6, 4, 0.006),
    ex('SW-1 governing T (k)', 'wall:SW-1', 'governingTensionLeft', T, 5),
    ex('SW-1 δ (in)', 'wall:SW-1', 'deflection.E.delta', delta, 6, 0.0005),
    ...driftExpect(d1, 7),
  ],
  expectChecks: { fail: ['G2'], warnings: ['aspect_ratio'] },
  notChecked: 'The save gate (src/validation.js) is not part of the calc — a line with an empty level is still saved here because walls exist in the line.',
  // Design pinned as manual overrides (method case): the engine picks at calc v13, frozen 2026-09-30
  pins: {"SW-1":{"nail":"6","hdL":"HDUE5","hdR":"HDUE5","postL":"(3)2x4","postR":"(3)2x4"},"SW-2":{"nail":"6","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"}},
  inputs: project({
    // risk category is a dropdown / Base Shear link in the app, so it is entered plainly ("II"); a padded " II" is not
    // trimmed by the engine (no drift limit → no allowable) — reported 2026-10-01, not part of this case
    sds: ' 1.0 ', cd: ' 4 ', ie: '1.0 ', riskCategory: 'II', omega0: '',
    wallDLTypes: [{ id: 'wdt-1', name: 'Stud wall', psf: '' }],
    levels: [level('lvl-2', 'Level 2', h), level('lvl-1', 'Level 1', String(h))],
    directions: [direction('dir-1', 'N-S', [line({ totalLength: String(lineLen),
      levelLoads: { 'lvl-2': { seismic: String(F2), wind: '  ' }, 'lvl-1': { seismic: ' ' + F1 + ' ', wind: '' } },
      gravityLoads: { 'lvl-1': { loads: [{ id: 'g1', shape: 'full', position: 0, start: 0, end: 0, D: ' ', L: '', Lr: '', perArea: false, trib: '', assemblyId: '' }] } },
      walls: [wall('w-1', 'SW-1', 'lvl-1', '0', String(L1), { nailingPattern: '6' }), wall('w-2', 'SW-2', 'lvl-1', lineLen - L2, L2)] })], ' ')],
  }),
};
