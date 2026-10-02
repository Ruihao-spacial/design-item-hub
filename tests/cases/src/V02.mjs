// V02 — two unequal walls + self-weight: capacity distribution, per-wall gravity, T/C and hardware
import { project, level, direction, line, wall, ex, pickNail, pickHD, postCap, POSTS4, asdE, f2, f3, SEISMIC, eq431, storyDrift, driftExpect } from './lib.mjs';

const Sds = 1.0, V = 10, h = 10, psf = 10;
const L1 = 8, L2 = 12;
const a = asdE(Sds);
// Capacity distribution: both walls start at the same nailing, so weight = v_cap × L and the shares go ∝ L.
// The pattern is then chosen from the unit shear; with the same pattern at both walls it stays ∝ L.
const trial = pickNail(0.7 * V * 1000 / (L1 + L2));          // one pattern for both (same v at both walls)
const w1 = trial.E * L1, w2 = trial.E * L2, W = w1 + w2;
const V1 = V * w1 / W, V2 = V * w2 / W;
const v1 = 0.7 * V1 * 1000 / L1, v2 = 0.7 * V2 * 1000 / L2;
const n1 = pickNail(v1), n2 = pickNail(v2);
const D1 = psf * L1 * h / 1000, D2 = psf * L2 * h / 1000, R1 = D1 / 2, R2 = D2 / 2;
const N1 = V1 * h / L1, N2 = V2 * h / L2;
const T1 = 0.7 * N1 - a.up * R1, T2 = 0.7 * N2 - a.up * R2;
const C1 = a.dn * R1 + 0.7 * N1, C2 = a.dn * R2 + 0.7 * N2;
const hd1 = pickHD(T1), hd2 = pickHD(T2);
const post = POSTS4.filter(p => p.d2 >= 3.0).find(p => postCap(p, h).cap >= Math.max(C1, C2)); // HDUE3 min (2)2x4
const pc = postCap(post, h);
// Story drift (Cd 4, Ie 1.0, RC II): Eq. 4.3-1 of each wall with its 1.0E share (lateral-only T = C = V·h/L), pinned design
const e1 = eq431({ mark: 'SW-1', L: L1, h, nail: '4', hdL: 'HDUE3', hdR: 'HDUE3', postL: '(2)2x4', postR: '(2)2x4', Vk: V1, TL: N1, CR: N1 });
const e2 = eq431({ mark: 'SW-2', L: L2, h, nail: '4', hdL: 'HDUE3', hdR: 'HDUE3', postL: '(2)2x4', postR: '(2)2x4', Vk: V2, TL: N2, CR: N2 });
const d1 = storyDrift('Level 1', h, [e1, e2]);

export default {
  id: 'V02', title: 'Two unequal walls + self-weight', slug: 'two-unequal-walls',
  intent: 'Capacity distribution between two solid walls of different length (8 ft and 12 ft) at one story, with each wall carrying only its own self-weight. Proves weight = v_cap × L, share = V × weight / Σ weight, the equal unit shear that follows, and per-wall overturning, holdown and post.',
  covers: ['SDPWS 2021 §4.3.3.4.1 capacity distribution', 'SDPWS Table 4.3A + footnote 10', 'ASCE 7-22 §2.4.5 (5), (8)', 'HDUE selection', 'G2 horizontal equilibrium'],
  handCalc: [
    'Story shear V = 1.0E = ' + V + ' k. Walls SW-1 L = ' + L1 + ' ft, SW-2 L = ' + L2 + ' ft, h = ' + h + ' ft (h/b = ' + f2(h / L1) + ' and ' + f2(h / L2) + ', both ≤ 2 → C_hb = 1.0).',
    'Nailing trial: with one pattern at both walls v = 0.7 × ' + V * 1000 + ' / (' + L1 + ' + ' + L2 + ') = ' + f2(0.7 * V * 1000 / (L1 + L2)) + ' plf → ' + trial.label + ' (' + trial.E + ' plf).',
    'Weights = v_cap × L: SW-1 ' + trial.E + ' × ' + L1 + ' = ' + w1 + ' lb, SW-2 ' + trial.E + ' × ' + L2 + ' = ' + w2 + ' lb, Σ = ' + W + ' lb.',
    'Shares: V_1 = ' + V + ' × ' + w1 + ' / ' + W + ' = ' + f3(V1) + ' k, V_2 = ' + V + ' × ' + w2 + ' / ' + W + ' = ' + f3(V2) + ' k (Σ = ' + f2(V1 + V2) + ' k).',
    'Unit shear: v_1 = 0.7 × ' + f2(V1 * 1000) + ' / ' + L1 + ' = ' + f2(v1) + ' plf, v_2 = 0.7 × ' + f2(V2 * 1000) + ' / ' + L2 + ' = ' + f2(v2) + ' plf → both ' + n1.label + ', D/C = ' + f2(v1) + ' / ' + n1.E + ' = ' + f3(v1 / n1.E) + '.',
    'Self-weight: D_1 = ' + psf + ' × ' + L1 + ' × ' + h + ' / 1000 = ' + f2(D1) + ' k (R = ' + f2(R1) + ' each end); D_2 = ' + psf + ' × ' + L2 + ' × ' + h + ' / 1000 = ' + f2(D2) + ' k (R = ' + f2(R2) + ').',
    'Overturning 1.0E: N_1 = ' + f3(V1) + ' × ' + h + ' / ' + L1 + ' = ' + f3(N1) + ' k; N_2 = ' + f3(V2) + ' × ' + h + ' / ' + L2 + ' = ' + f3(N2) + ' k (equal: same v at both walls).',
    'Uplift (0.6 − 0.14S_DS)D + 0.7E: T_1 = 0.7 × ' + f3(N1) + ' − ' + f2(a.up) + ' × ' + f2(R1) + ' = ' + f3(T1) + ' k → ' + hd1.id + '; T_2 = 0.7 × ' + f3(N2) + ' − ' + f2(a.up) + ' × ' + f2(R2) + ' = ' + f3(T2) + ' k → ' + hd2.id + '.',
    'Compression (1.0 + 0.14S_DS)D + 0.7E: C_1 = ' + f2(a.dn) + ' × ' + f2(R1) + ' + 0.7 × ' + f3(N1) + ' = ' + f3(C1) + ' k; C_2 = ' + f2(a.dn) + ' × ' + f2(R2) + ' + 0.7 × ' + f3(N2) + ' = ' + f3(C2) + ' k.',
    'End posts: HDUE3 minimum post (2)2x4; NDS cap at ' + h + ' ft = ' + f2(pc.cap) + ' k ≥ ' + f3(Math.max(C1, C2)) + ' k → ' + post.id + ' at every end.',
    e1.text,
    e2.text,
    d1.text,
  ],
  expect: [
    ex('SW-1 capacity weight (lb)', 'wall:SW-1', 'capWeight.E', w1, 3, 0.01),
    ex('SW-2 capacity weight (lb)', 'wall:SW-2', 'capWeight.E', w2, 3, 0.01),
    ex('SW-1 share V (k)', 'wall:SW-1', 'shareExact_1E', V1, 4),
    ex('SW-2 share V (k)', 'wall:SW-2', 'shareExact_1E', V2, 4),
    ex('SW-1 unit shear (plf)', 'wall:SW-1', 'unitShear_seismic', v1, 5, 0.01),
    ex('SW-2 unit shear (plf)', 'wall:SW-2', 'unitShear_seismic', v2, 5, 0.01),
    ex('SW-1 dead load (k)', 'wall:SW-1', 'dlTotal', D1, 6),
    ex('SW-2 dead load (k)', 'wall:SW-2', 'dlTotal', D2, 6),
    ex('SW-1 governing T left (k)', 'wall:SW-1', 'governingTensionLeft', T1, 8),
    ex('SW-2 governing T left (k)', 'wall:SW-2', 'governingTensionLeft', T2, 8),
    ex('SW-2 governing C right (k)', 'wall:SW-2', 'governingComprRight', C2, 9),
    ex('SW-1 δ at 1.0E (in)', 'wall:SW-1', 'deflection.E.delta', e1.delta, 11, 0.0005),
    ex('SW-2 δ at 1.0E (in)', 'wall:SW-2', 'deflection.E.delta', e2.delta, 12, 0.0005),
    ...driftExpect(d1, 13),
  ],
  expectChecks: { fail: [] },
  notChecked: 'The deflection terms one by one (see V15) and the load combinations other than the governing uplift / compression pair (see V03).',
  // Design pinned as manual overrides (method case): the engine picks at calc v13, frozen 2026-09-30
  pins: {"SW-1":{"nail":"4","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"},"SW-2":{"nail":"4","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"}},
  inputs: project({
    sds: String(Sds), ...SEISMIC, wallDLTypes: [{ id: 'wdt-1', name: 'Stud wall', psf: String(psf) }],
    levels: [level('lvl-1', 'Level 1', h)],
    directions: [direction('dir-1', 'N-S', [line({ totalLength: 30, levelLoads: { 'lvl-1': { seismic: String(V), wind: '' } }, gravityLoads: { 'lvl-1': { loads: [] } },
      walls: [wall('w-1', 'SW-1', 'lvl-1', 2, L1), wall('w-2', 'SW-2', 'lvl-1', 16, L2)] })])],
  }),
};
