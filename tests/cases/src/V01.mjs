// V01 — one wall: the base chain story shear → unit shear → nailing → overturning → holdown / post → deflection
import { project, level, direction, line, wall, ex, pickNail, pickHD, postCap, POSTS4, HDUE, NAIL, asdE, f2, f3, f4, SEISMIC, eq431, storyDrift, driftExpect } from './lib.mjs';

const Sds = 1.0, V = 5, L = 10, h = 10, psf = 10;
const a = asdE(Sds);
const v = 0.7 * V * 1000 / L;                     // ASD unit shear (plf)
const n = pickNail(v);                            // 4" o.c.
const D = psf * L * h / 1000, R = D / 2;          // self-weight, ½ each end
const otm = V * h, N = otm / L;                   // 1.0E overturning, ± end force
const T = 0.7 * N - a.up * R;                     // (0.6−0.14SDS)D + 0.7E
const C = a.dn * R + 0.7 * N;                     // (1.0+0.14SDS)D + 0.7E
const C6 = a.d6 * R + 0.525 * N;                  // (1.0+0.105SDS)D + 0.525E (+0.75L, none)
const hd = pickHD(T);
const minPost = POSTS4.filter(p => p.d2 >= 3.0);  // HDUE3 minimum post (2)2x4 (d2 ≥ 3.0")
const post = minPost.find(p => postCap(p, h).cap >= C);
const pc = postCap(post, h);
// Deflection at 1.0E (SDPWS Eq. 4.3-1), lateral end forces only (user 2026-10-14): v1 = V/L; T1 = C1 = V·h/L
const v1 = V * 1000 / L, T1 = N * 1000, C1 = N * 1000, A = post.A, E = 1700000, Ga = NAIL.find(x => x.id === n.id).gaPLY;
const t1 = 8 * v1 * h ** 3 / (E * A * L), t2 = v1 * h / (1000 * Ga);
const dHD = hd.delta * T1 / hd.lrfdCap; // linear from the LRFD pair (2026-10-14)
const r = C1 / (A * 625), dC = 0.02 * (r < 0.73 ? r / 0.73 : r <= 1 ? 1 + (r - 0.73) / 0.27 : 2 * r ** 3);
const t3 = h * (dHD + dC) / L, delta = t1 + t2 + t3;
// Story drift (Cd 4, Ie 1.0, RC II): the one wall governs; the same Eq. 4.3-1 through the shared helper
const d1 = storyDrift('Level 1', h, [eq431({ mark: 'SW-1', L, h, nail: '4', hdL: 'HDUE3', hdR: 'HDUE3', postL: '(2)2x4', postR: '(2)2x4', Vk: V, TL: N, CR: N })]);

export default {
  id: 'V01', title: 'One wall — base chain', slug: 'one-wall',
  intent: 'The shortest complete path through the calculator: one solid 10 ft wall, seismic only, self-weight only. Checks story shear → ASD unit shear → nailing → overturning → holdown → end post → deflection, and that every line check G1–G12 passes.',
  covers: ['SDPWS 2021 Table 4.3A + footnote 10', 'ASCE 7-22 §2.4.5 (5), (8)', 'HDUE selection + minimum post', 'NDS 2018 column', 'SDPWS Eq. 4.3-1', 'G1–G12'],
  handCalc: [
    'Story shear V = 1.0E = ' + V + ' k (one level, one wall) → SW-1 takes all of it: V = ' + f2(V) + ' k.',
    'ASD unit shear v = 0.7·ρ·V / L = 0.7 × 1.0 × ' + V * 1000 + ' / ' + L + ' = ' + f2(v) + ' plf. h/b = ' + h + '/' + L + ' = 1.0 ≤ 2 → C_hb = 1.0. 6" o.c. 312 plf < ' + v + ' NG; 4" o.c. 470 plf ≥ ' + v + ' → 4" o.c., D/C = ' + v + '/470 = ' + f3(v / 470) + '.',
    'Self-weight D = ' + psf + ' psf × ' + L + ' ft × ' + h + ' ft = ' + f2(D) + ' k → R_D = ' + f2(R) + ' k at each end (no other gravity).',
    'M_OT(1.0E) = V·h = ' + V + ' × ' + h + ' = ' + otm + ' k·ft → N_E = ±' + otm + '/' + L + ' = ±' + f2(N) + ' k (uplift at the left end for →).',
    'Uplift, (0.6 − 0.14S_DS)D + 0.7E: N = ' + f2(a.up) + ' × ' + f2(R) + ' − 0.7 × ' + f2(N) + ' = ' + f2(-T) + ' → T = ' + f2(T) + ' k → lightest HDUE with cap ≥ ' + Math.round(T * 1000) + ' lb: ' + hd.id + ' (' + hd.cap + ' lb), D/C = ' + f3(T * 1000 / hd.cap) + '.',
    'Compression, (1.0 + 0.14S_DS)D + 0.7E: C = ' + f2(a.dn) + ' × ' + f2(R) + ' + 0.7 × ' + f2(N) + ' = ' + f2(C) + ' k (combo (6): ' + f3(a.d6) + ' × ' + f2(R) + ' + 0.525 × ' + f2(N) + ' = ' + f3(C6) + ' k, smaller).',
    'End post: HDUE3 minimum post is (2)2x4. NDS column at h = ' + h + ' ft, DF-L No.1: F_c* = 1500 × 1.6 × 1.15 = ' + Math.round(pc.Fstar) + ' psi, F_cE = ' + Math.round(pc.FcE) + ' psi, C_P = ' + f4(pc.Cp) + ', F_c′ = ' + Math.round(pc.Fc1) + ' psi; bearing F_c⊥′ = 625 × (3.0 + 0.375)/3.0 = ' + Math.round(pc.Fperp) + ' psi → cap = ' + f2(pc.cap) + ' k ≥ ' + f2(C) + ' k → ' + post.id + '.',
    'Deflection at 1.0E (lateral end forces only): v = ' + v1 + ' plf, end forces T = C = V·h/L = ' + f2(N) + ' k, A = ' + A + ' in², G_a = ' + Ga + ' k/in. 8vh³/(EAb) = 8 × ' + v1 + ' × ' + h + '³ / (1,700,000 × ' + A + ' × ' + L + ') = ' + f4(t1) + '; vh/(1000G_a) = ' + v1 + ' × ' + h + ' / (1000 × ' + Ga + ') = ' + f4(t2)
      + '; holdown Δ = δ_LRFD × T / T_LRFD of ' + hd.id + ' = ' + hd.delta + ' × ' + Math.round(T1) + ' / ' + hd.lrfdCap + ' = ' + f4(dHD) + '; crushing r = ' + Math.round(C1) + ' / (' + A + ' × 625) = ' + f4(r) + ' → Δ_c = ' + f4(dC) + '; h·Δa/b = ' + f4(t3) + ' → δ = ' + f4(delta) + ' in.',
    d1.text,
    'Line checks: base shear = 5 k at the foundation, base moment = 50 k·ft, gravity 1.0D = ' + f2(D) + ' k all at the foundation → G1–G12 pass.',
  ],
  expect: [
    ex('SW-1 share V (1.0E)', 'wall:SW-1', 'shareExact_1E', V, 1),
    ex('SW-1 ASD unit shear (plf)', 'wall:SW-1', 'unitShear_seismic', v, 2, 0.01),
    ex('SW-1 D/C', 'wall:SW-1', 'dcRatio', v / 470, 2, 0.006),
    ex('SW-1 dead load D (k)', 'wall:SW-1', 'dlTotal', D, 3),
    ex('SW-1 1.0E → left end N (k)', 'wall:SW-1', 'lc["1.0E →"].left', -N, 4),
    ex('SW-1 governing T, left (k)', 'wall:SW-1', 'governingTensionLeft', T, 5),
    ex('SW-1 governing C, right (k)', 'wall:SW-1', 'governingComprRight', C, 6),
    ex('SW-1 post capacity (k)', 'wall:SW-1', 'postRight.capacityKips', pc.cap, 7),
    ex('SW-1 δ at 1.0E (in)', 'wall:SW-1', 'deflection.E.delta', delta, 8, 0.0005),
    ...driftExpect(d1, 9),
  ],
  expectChecks: { fail: [] },
  // Design pinned as manual overrides (method case): the engine picks at calc v13, frozen 2026-09-30
  pins: {"SW-1":{"nail":"4","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"}},
  inputs: project({
    sds: String(Sds), ...SEISMIC, wallDLTypes: [{ id: 'wdt-1', name: 'Stud wall', psf: String(psf) }],
    levels: [level('lvl-1', 'Level 1', h)],
    directions: [direction('dir-1', 'N-S', [line({ totalLength: 20, levelLoads: { 'lvl-1': { seismic: String(V), wind: '' } }, gravityLoads: { 'lvl-1': { loads: [] } },
      walls: [wall('w-1', 'SW-1', 'lvl-1', 5, L)] })])],
  }),
};
