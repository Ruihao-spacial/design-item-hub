// V13 — window between two solid walls: two segmented walls with a 4 ft gap, a full-line load and a
// point load; each wall by statics, the load over the gap not carried
import { project, level, direction, line, wall, gFull, gPoint, ex, pickNail, pickHD, postCap, POSTS4, asdE, f2, f3, SEISMIC, eq431, storyDrift, driftExpect } from './lib.mjs';

const Sds = 1.0, a = asdE(Sds), psf = 10, h = 10, L = 6, V = 6;
const wD = 200, wL = 100, PD = 2, xP = 1.5;       // full line D 200 / L 100 plf; point D 2 k at x = 1.5 (on SW-11)
const Vw = V / 2, v = 0.7 * Vw * 1000 / L, n = pickNail(v), N = Vw * h / L;
const self = psf * L * h / 1000;
// SW-11 (0–6): pieces (P, x̄ from its left end)
const p11 = [[wD * L / 1000, L / 2], [PD, xP], [self, L / 2]];
const D11 = p11.reduce((s, [P]) => s + P, 0);
const RR11 = p11.reduce((s, [P, x]) => s + P * x / L, 0), RL11 = D11 - RR11;
const RLL = wL * L / 2000;                         // live per end (uniform only)
const T11L = 0.7 * N - a.up * RL11, T11R = 0.7 * N - a.up * RR11;
const C11L = Math.max(a.dn * RL11 + 0.7 * N, a.d6 * RL11 + 0.75 * RLL + 0.525 * N);
const C11R = Math.max(a.dn * RR11 + 0.7 * N, a.d6 * RR11 + 0.75 * RLL + 0.525 * N);
// SW-12 (10–16): uniform + self-weight, symmetric
const D12 = wD * L / 1000 + self, R12 = D12 / 2;
const T12 = 0.7 * N - a.up * R12, C12 = Math.max(a.dn * R12 + 0.7 * N, a.d6 * R12 + 0.75 * RLL + 0.525 * N);
const posts = POSTS4.filter(p => p.d2 >= 3.0);
const post11L = posts.find(p => postCap(p, h).cap >= C11L);
const gapD = wD * 4 / 1000;
// Story drift (Cd 4, Ie 1.0, RC II): equal shares; SW-12 has the smaller (2)2x4 end posts → more bending and crushing
// → it governs. Expected NG (user decision 2026-10-01: keep the pinned design and verify the NG)
const d1 = storyDrift('Level 1', h, [
  eq431({ mark: 'SW-11', L, h, nail: '4', hdL: 'HDUE3', hdR: 'HDUE3', postL: '(3)2x4', postR: '(3)2x4', Vk: Vw, TL: N, CR: N }),
  eq431({ mark: 'SW-12', L, h, nail: '4', hdL: 'HDUE3', hdR: 'HDUE3', postL: '(2)2x4', postR: '(2)2x4', Vk: Vw, TL: N, CR: N })]);

export default {
  id: 'V13', title: 'Window between two solid walls', slug: 'window-two-solid-walls',
  intent: 'A window is modelled as two solid (segmented) walls with a 4 ft gap — the tool rule since 2026-09-29: segmented walls never have openings. Checks the gravity statics of each wall with an off-centre point load (unequal end reactions), the end forces at both ends in both directions, and that the load over the window is reported as not carried.',
  covers: ['Segmented walls are solid (openings only on FTAO)', 'Gravity end reactions by statics (R_R = Σ P·x̄ / L)', 'Unequal ends → different T / C each end', 'gravity_unsupported over the gap'],
  handCalc: [
    'Story shear V = ' + V + ' k to two equal 6 ft walls → ' + f2(Vw) + ' k each; v = 0.7 × ' + Vw * 1000 + ' / ' + L + ' = ' + f2(v) + ' plf → 6" o.c. 312 < ' + v + ' NG → ' + n.label + ' (470), D/C ' + f3(v / 470) + '. h/b = 10/6 = 1.67 ≤ 2. N_E = ' + Vw + ' × ' + h + ' / ' + L + ' = ±' + f2(N) + ' k.',
    'SW-11 (0–6 ft) D pieces: uniform ' + wD + ' × 6 = ' + f2(p11[0][0]) + ' k at 3.0; point ' + PD + ' k at ' + xP + '; self ' + psf + ' × 6 × 10 = ' + f2(self) + ' k at 3.0 → D = ' + f2(D11) + ' k.',
    'SW-11 R_R = (' + f2(p11[0][0]) + ' × 3 + ' + PD + ' × ' + xP + ' + ' + f2(self) + ' × 3) / ' + L + ' = ' + f3(RR11) + ' k; R_L = ' + f2(D11) + ' − ' + f3(RR11) + ' = ' + f3(RL11) + ' k. Live L = ' + wL + ' × 6 = ' + f2(2 * RLL) + ' k → ' + f2(RLL) + ' k per end.',
    'SW-11 left end: T (→, (0.6 − 0.14S_DS)D + 0.7E) = 0.7 × ' + f2(N) + ' − ' + f2(a.up) + ' × ' + f3(RL11) + ' = ' + f3(T11L) + ' k; C (←) = ' + f2(a.dn) + ' × ' + f3(RL11) + ' + 0.7 × ' + f2(N) + ' = ' + f3(C11L) + ' k (combo (6) ' + f3(a.d6 * RL11 + 0.75 * RLL + 0.525 * N) + ' k).',
    'SW-11 right end: T (←) = 0.7 × ' + f2(N) + ' − ' + f2(a.up) + ' × ' + f3(RR11) + ' = ' + f3(T11R) + ' k; C (→) = ' + f2(a.dn) + ' × ' + f3(RR11) + ' + 0.7 × ' + f2(N) + ' = ' + f3(C11R) + ' k.',
    'SW-12 (10–16 ft): D = ' + f2(wD * L / 1000) + ' + ' + f2(self) + ' = ' + f2(D12) + ' k → ' + f2(R12) + ' k per end; T = 0.7 × ' + f2(N) + ' − ' + f2(a.up) + ' × ' + f2(R12) + ' = ' + f3(T12) + ' k; C = ' + f2(a.dn) + ' × ' + f2(R12) + ' + 0.7 × ' + f2(N) + ' = ' + f3(C12) + ' k.',
    'Hardware: SW-11 left T ' + f3(T11L) + ' k → ' + pickHD(T11L).id + '; SW-12 T ' + f3(T12) + ' k → ' + pickHD(T12).id + '. SW-11 left post for C ' + f3(C11L) + ' k at 10 ft ((2)2x4 minimum): (2)2x4 cap ' + f2(postCap(posts[0], h).cap) + ' k < C → ' + post11L.id + ' (cap ' + f2(postCap(post11L, h).cap) + ' k).',
    'The uniform load over the window (6–10 ft) has nothing below: D ' + f2(gapD) + ' k and L ' + f2(wL * 4 / 1000) + ' k not carried (audit note, excluded in G4 / G8) → G1–G12 pass.',
    'Eq. 4.3-1 per wall at 1.0E (lateral only, gravity does not enter): ' + d1.gov.text,
    d1.text,
  ],
  expect: [
    ex('SW-11 dead load (k)', 'wall:SW-11', 'dlTotal', D11, 2),
    ex('SW-11 R_R dead (k)', 'wall:SW-11', 'dlRR', RR11, 3),
    ex('SW-11 R_L dead (k)', 'wall:SW-11', 'dlRL', RL11, 3),
    ex('SW-11 T left (k)', 'wall:SW-11', 'governingTensionLeft', T11L, 4),
    ex('SW-11 C left (k)', 'wall:SW-11', 'governingComprLeft', C11L, 4),
    ex('SW-11 T right (k)', 'wall:SW-11', 'governingTensionRight', T11R, 5),
    ex('SW-11 C right (k)', 'wall:SW-11', 'governingComprRight', C11R, 5),
    ex('SW-12 T left (k)', 'wall:SW-12', 'governingTensionLeft', T12, 6),
    ex('SW-12 C right (k)', 'wall:SW-12', 'governingComprRight', C12, 6),
    ex('Audit note: load over the window not carried', 'line', 'loadPathAudit.notes[0].type', 'gravity_unsupported', 8),
    ...driftExpect(d1, 10),
  ],
  expectChecks: { fail: [] },
  notChecked: 'Drift sizing: the design is pinned, so the drift NG is reported and not fixed (see the R7 rule test for sizing).',
  // Design pinned as manual overrides (method case): the engine picks at calc v13, frozen 2026-09-30
  pins: {"SW-11":{"nail":"4","hdL":"HDUE3","hdR":"HDUE3","postL":"(3)2x4","postR":"(3)2x4"},"SW-12":{"nail":"4","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"}},
  inputs: project({
    sds: String(Sds), ...SEISMIC, wallDLTypes: [{ id: 'wdt-1', name: 'Stud wall', psf: String(psf) }],
    levels: [level('lvl-1', 'Level 1', h)],
    directions: [direction('dir-1', 'N-S', [line({ totalLength: 16,
      levelLoads: { 'lvl-1': { seismic: String(V), wind: '' } },
      gravityLoads: { 'lvl-1': { loads: [gFull('g1', wD, wL, ''), gPoint('g2', xP, PD)] } },
      walls: [wall('w-11', 'SW-11', 'lvl-1', 0, L), wall('w-12', 'SW-12', 'lvl-1', 10, L)] })])],
  }),
};
