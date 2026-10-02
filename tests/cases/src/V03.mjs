// V03 — gravity statics D / L / Lr on one wall: full-line, partial and point loads, part of them over nothing
import { project, level, direction, line, wall, gFull, gPart, gPoint, ex, pickNail, pickHD, postCap, POSTS4, asdE, f2, f3, f4, SEISMIC, eq431, storyDrift, driftExpect } from './lib.mjs';

const Sds = 1.0, V = 4, h = 10, psf = 10;
const x0 = 4, L = 10, lineLen = 20;                         // SW-1 from x = 4 to 14 on a 20 ft line
const a = asdE(Sds);
// Pieces on the wall (x from the wall left end): full line 100 / 50 / 40 plf, partial 6–18 ft 200 / 100 plf,
// point at line x = 7 ft 3 / 2 / 1 k, wall self-weight. The partial load 14–18 ft and the full line 0–4 / 14–20 ft
// are over no wall → "not carried" (audit note, excluded in G4 / G8).
const pieces = [
  { name: 'full line 100 / 50 / 40 plf over 4–14 ft', x: 5, P: { D: 100 * L / 1000, L: 50 * L / 1000, Lr: 40 * L / 1000 } },
  { name: 'partial 200 / 100 plf over 6–14 ft (of 6–18)', x: (2 + 10) / 2, P: { D: 200 * 8 / 1000, L: 100 * 8 / 1000, Lr: 0 } },
  { name: 'point 3 / 2 / 1 k at line x = 7 ft', x: 3, P: { D: 3, L: 2, Lr: 1 } },
  { name: 'self-weight 10 psf × 10 × 10', x: 5, P: { D: psf * L * h / 1000, L: 0, Lr: 0 } },
];
const cs = ['D', 'L', 'Lr'];
const tot = {}, RR = {}, RL = {}, MR = {}, ML = {};
for (const c of cs) {
  tot[c] = pieces.reduce((s, p) => s + p.P[c], 0);
  MR[c] = pieces.reduce((s, p) => s + p.P[c] * (L - p.x), 0);   // about the right corner (→)
  ML[c] = pieces.reduce((s, p) => s + p.P[c] * p.x, 0);         // about the left corner (←)
  RR[c] = ML[c] / L; RL[c] = tot[c] - RR[c];
}
const v = 0.7 * V * 1000 / L, n = pickNail(v);
const N = V * h / L;
// Left-end compression per ASD combination (← direction puts the seismic compression at the left end)
const cD = RL.D, cDL = RL.D + RL.L, cDLr = RL.D + RL.Lr, c4 = RL.D + 0.75 * RL.L + 0.75 * RL.Lr;
const c5 = a.dn * RL.D + 0.7 * N, c6 = a.d6 * RL.D + 0.525 * N + 0.75 * RL.L;
const CL = Math.max(cD, cDL, cDLr, c4, c5, c6);
const c6R = a.d6 * RR.D + 0.525 * N + 0.75 * RR.L, c5R = a.dn * RR.D + 0.7 * N;
const CR = Math.max(RR.D + RR.L, RR.D + 0.75 * RR.L + 0.75 * RR.Lr, c5R, c6R);
const TL = 0.7 * N - a.up * RL.D, TR = 0.7 * N - a.up * RR.D;   // (0.6 − 0.14SDS)D + 0.7E
const hdR = pickHD(TR);
const post = POSTS4.filter(p => p.d2 >= 3.0).find(p => postCap(p, h).cap >= CL);
const txt = (o) => cs.map(c => c + ' ' + f3(o[c])).join(' / ');
// Story drift (Cd 4, Ie 1.0, RC II): Eq. 4.3-1 at 1.0E — lateral only (T = C = V·h/L, gravity not included), pinned
// posts 6x4 left / (3)2x4 right: A = the smaller, (3)2x4; → crushes the right post, ← the left
const e1 = eq431({ mark: 'SW-1', L, h, nail: '6', hdL: 'HDUE3', hdR: 'HDUE3', postL: '6x4', postR: '(3)2x4', Vk: V, TL: N, CR: N });
const d1 = storyDrift('Level 1', h, [e1]);

export default {
  id: 'V03', title: 'Gravity statics D / L / Lr', slug: 'gravity-statics',
  intent: 'One wall under a full-line uniform (D / L / Lr), a partial uniform that runs past the wall end, and an off-centre point load. Proves the statics end reactions per load case, the resisting moment about each corner, that load over no wall is not carried (audit note, excluded — the checks still pass), and the governing ASD combinations with live and roof live load.',
  covers: ['Gravity statics R_R = Σ P·x / L', 'C3 M_R about each corner', 'ASCE 7-22 §2.4.1 (2), (4), §2.4.5 (5), (6), (8)', 'gravity_unsupported audit note', 'G4 / G8 excluded loads'],
  handCalc: [
    'SW-1 runs x = ' + x0 + '–' + (x0 + L) + ' ft on a ' + lineLen + ' ft line, h = ' + h + ' ft. x below is measured from the wall left end.',
    'Load pieces on the wall: ' + pieces.map(p => p.name + ' → P = ' + txt(p.P) + ' k at x = ' + f2(p.x) + ' ft').join('; ') + '.',
    'Not carried (over no wall): full line 0–4 and 14–20 ft (D 1.00 / L 0.50 / Lr 0.40 k) and partial 14–18 ft (D 0.80 / L 0.40 k) → audit notes, excluded in the gravity checks.',
    'Totals ΣP: ' + txt(tot) + ' k.',
    'M_R about the right corner (→) = Σ P·(L − x): ' + txt(MR) + ' k·ft; about the left corner (←) = Σ P·x: ' + txt(ML) + ' k·ft.',
    'Reactions: R_R = Σ P·x / L = ' + txt(RR) + ' k; R_L = ΣP − R_R = ' + txt(RL) + ' k.',
    'Lateral: V = ' + V + ' k, v = 0.7 × ' + V * 1000 + ' / ' + L + ' = ' + f2(v) + ' plf → ' + n.label + '; N_E = ' + V + ' × ' + h + ' / ' + L + ' = ±' + f2(N) + ' k.',
    'Left-end compression by combination: D = ' + f4(cD) + '; D + L = ' + f4(cDL) + '; D + Lr = ' + f4(cDLr) + '; D + 0.75L + 0.75Lr = ' + f4(c4) + '; (1.0+0.14S_DS)D + 0.7E ← = ' + f2(a.dn) + ' × ' + f4(RL.D) + ' + 0.7 × ' + f2(N) + ' = ' + f4(c5)
      + '; (1.0+0.105S_DS)D + 0.525E + 0.75L ← = ' + f3(a.d6) + ' × ' + f4(RL.D) + ' + 0.525 × ' + f2(N) + ' + 0.75 × ' + f4(RL.L) + ' = ' + f4(c6) + ' → governs C_L = ' + f4(CL) + ' k.',
    'Right-end compression: combo (6) → = ' + f3(a.d6) + ' × ' + f4(RR.D) + ' + 0.525 × ' + f2(N) + ' + 0.75 × ' + f4(RR.L) + ' = ' + f4(c6R) + '; combo (5) → = ' + f4(c5R) + ' → C_R = ' + f4(CR) + ' k.',
    'Uplift (0.6 − 0.14S_DS)D + 0.7E: left (→) 0.7 × ' + f2(N) + ' − ' + f2(a.up) + ' × ' + f4(RL.D) + ' = ' + f4(TL) + ' k; right (←) 0.7 × ' + f2(N) + ' − ' + f2(a.up) + ' × ' + f4(RR.D) + ' = ' + f4(TR) + ' k → ' + hdR.id + ' at the right.',
    'Left end post (HDUE3 minimum post (2)2x4, sizes tried in catalog order at ' + h + ' ft): ' + POSTS4.filter(p => p.d2 >= 3.0).map(p => p.id + ' ' + f2(postCap(p, h).cap) + ' k').join(', ') + ' → first with cap ≥ C_L = ' + f3(CL) + ' k is ' + post.id + '.',
    e1.text,
    d1.text,
  ],
  expect: [
    ex('SW-1 total D (k)', 'wall:SW-1', 'dlTotal', tot.D, 4),
    ex('SW-1 total L (k)', 'wall:SW-1', 'live.L.total', tot.L, 4),
    ex('SW-1 total Lr (k)', 'wall:SW-1', 'live.Lr.total', tot.Lr, 4),
    ex('SW-1 R_L dead (k)', 'wall:SW-1', 'dlRL', RL.D, 6),
    ex('SW-1 R_R dead (k)', 'wall:SW-1', 'dlRR', RR.D, 6),
    ex('SW-1 R_R live (k)', 'wall:SW-1', 'live.L.rR', RR.L, 6),
    ex('SW-1 R_L roof live (k)', 'wall:SW-1', 'live.Lr.rL', RL.Lr, 6),
    ex('SW-1 1.0L left end N (k)', 'wall:SW-1', 'lc["1.0L"].left', RL.L, 6),
    ex('SW-1 D + L left compression (k)', 'wall:SW-1', 'combos["D+L"].comprLeft', cDL, 8),
    ex('SW-1 D + 0.75L + 0.75Lr left compression (k)', 'wall:SW-1', 'combos["D+0.75L+0.75Lr"].comprLeft', c4, 8),
    ex('SW-1 (1.0+0.105SDS)D + 0.525E + 0.75L ← left compression (k)', 'wall:SW-1', 'combos["D+0.525ρE+0.75L_neg"].comprLeft', c6, 8),
    ex('SW-1 governing C left (k)', 'wall:SW-1', 'governingComprLeft', CL, 8),
    ex('SW-1 governing C right (k)', 'wall:SW-1', 'governingComprRight', CR, 9),
    ex('SW-1 governing T right (k)', 'wall:SW-1', 'governingTensionRight', TR, 10),
    ex('SW-1 δ at 1.0E (in)', 'wall:SW-1', 'deflection.E.delta', e1.delta, 12, 0.0005),
    ...driftExpect(d1, 13),
  ],
  expectChecks: { fail: [] },
  notChecked: 'The "not carried" amounts are only checked through G4 / G8 passing with them excluded; LRFD and Ω₀ combinations (see V19).',
  // Design pinned as manual overrides (method case): the engine picks at calc v13, frozen 2026-09-30
  pins: {"SW-1":{"nail":"6","hdL":"HDUE3","hdR":"HDUE3","postL":"6x4","postR":"(3)2x4"}},
  inputs: project({
    sds: String(Sds), ...SEISMIC, wallDLTypes: [{ id: 'wdt-1', name: 'Stud wall', psf: String(psf) }],
    levels: [level('lvl-1', 'Level 1', h)],
    directions: [direction('dir-1', 'N-S', [line({ totalLength: lineLen, levelLoads: { 'lvl-1': { seismic: String(V), wind: '' } },
      gravityLoads: { 'lvl-1': { loads: [gFull('g1', 100, 50, 40), gPart('g2', 6, 18, 200, 100), gPoint('g3', 7, 3, 2, 1)] } },
      walls: [wall('w-1', 'SW-1', 'lvl-1', x0, L)] })])],
  }),
};
