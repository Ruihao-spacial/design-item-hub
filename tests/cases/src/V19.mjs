// V19 — LRFD and Ω₀ forces (reported only) and a support post sized for max(ASD, Ω₀ ASD)
import { project, level, direction, line, wall, post, gPart, ex, pickHD, pickStrap, postCap, POSTS4, asdE, f2, f3, SEISMIC, eq431, storyDrift, driftExpect } from './lib.mjs';

const Sds = 1.0, O = 2.5, h = 10, psf = 10, L1 = 8, V2 = 3, V1 = 2;
const a = asdE(Sds);
const lu = 0.9 - 0.2 * Sds, ld = 1.2 + 0.2 * Sds;
const D = psf * L1 * h / 1000 + 100 * L1 / 1000, RD = D / 2, RL = 50 * L1 / 1000 / 2;
const N = V2 * h / L1;                                   // 1.0E end force of SW-1
const asd = { T: 0.7 * N - a.up * RD, C5: a.dn * RD + 0.7 * N, C6: a.d6 * RD + 0.525 * N + 0.75 * RL };
const lrfd = { C: ld * RD + N + RL, T: N - lu * RD };   // (1.2+0.2SDS)D + ρE + L ; (0.9−0.2SDS)D + ρE
const om = { C5: a.dn * RD + 0.7 * O * N, C6: a.d6 * RD + 0.525 * O * N + 0.75 * RL, T: 0.7 * O * N - a.up * RD };
const omL = { C: ld * RD + O * N + RL, T: O * N - lu * RD };
const Casd = Math.max(asd.C5, asd.C6), Com = Math.max(om.C5, om.C6);
const Cpost = Math.max(Casd, Com);
const hdBase = pickHD(asd.T);                            // post base on the foundation: HDUE, minimum post (2)2x4
const cands = POSTS4.filter(p => p.d2 >= 3.0);
const pPost = cands.find(p => postCap(p, h).cap >= Cpost);
const pAsdOnly = cands.find(p => postCap(p, h).cap >= Casd);
const strap = pickStrap(asd.T);
// Story drift (Cd 4, Ie 1.0, RC II), pinned design. SW-1 (Level 2) on posts: its own 1.0E end forces only (support
// deflection not included, P5). SW-2 (Level 1) takes the story shear V1 + V2; SW-1's ends land on P-1 / P-2, not on SW-2.
const N2 = (V1 + V2) * h / 10;
const dL2 = storyDrift('Level 2', h, [eq431({ mark: 'SW-1', L: L1, h, nail: '6', hdL: 'MSTC40', hdR: 'MSTC40', postL: '(2)2x4', postR: '(2)2x4', Vk: V2, TL: N, CR: N })]);
const dL1 = storyDrift('Level 1', h, [eq431({ mark: 'SW-2', L: 10, h, nail: '4', hdL: 'HDUE3', hdR: 'HDUE3', postL: '(2)2x4', postR: '(2)2x4', Vk: V1 + V2, TL: N2, CR: N2 })]);

export default {
  id: 'V19', title: 'LRFD and Ω₀ forces, support post', slug: 'lrfd-omega',
  intent: 'A 2nd-story wall SW-1 sits on two support posts (P-1, P-2) that carry its end forces to the foundation. Checks the LRFD seismic combinations (1.2+0.2S_DS)D + ρE + L and (0.9−0.2S_DS)D + ρE and the Ω₀ ASD / LRFD envelopes (all reported forces only), and that the support post member is sized for max(ASD, Ω₀ ASD) compression (ASCE 7-22 §12.3.3.3) while its base hardware stays ASD.',
  covers: ['ASCE 7-22 §2.3.6 (6), (7)', 'ASCE 7-22 §2.4.5 with Ω₀', '§12.3.3.3 support post', 'Reported vs design combinations'],
  handCalc: [
    'SW-1 (Level 2, 8 ft, h = 10 ft): D = self-weight 10 × 8 × 10/1000 = 0.80 + 100 plf × 8 = 0.80 → D = ' + f2(D) + ' k, R_D = ' + f2(RD) + ' k; L = 50 plf × 8 = 0.40 k → R_L = ' + f2(RL) + ' k. 1.0E = ' + V2 + ' k → N_E = ' + V2 + ' × ' + h + '/' + L1 + ' = ' + f3(N) + ' k. Ω₀ = 2.5 (entered: wood structural panel walls, Table 12.2-1 A.15; Cd 4, Ie 1.0, RC II).',
    'ASD (design): T = 0.7 × ' + f3(N) + ' − 0.46 × ' + f2(RD) + ' = ' + f3(asd.T) + ' k; C = max[1.14 × ' + f2(RD) + ' + 0.7 × ' + f3(N) + ' = ' + f3(asd.C5) + ', 1.105 × ' + f2(RD) + ' + 0.525 × ' + f3(N) + ' + 0.75 × ' + f2(RL) + ' = ' + f3(asd.C6) + '] = ' + f3(Casd) + ' k.',
    'LRFD (forces only): C = (1.2+0.2S_DS)D + ρE + L = 1.4 × ' + f2(RD) + ' + ' + f3(N) + ' + ' + f2(RL) + ' = ' + f3(lrfd.C) + ' k; T = ρE − (0.9−0.2S_DS)D = ' + f3(N) + ' − 0.7 × ' + f2(RD) + ' = ' + f3(lrfd.T) + ' k.',
    'Ω₀ ASD (forces only; support posts): C = 1.14 × ' + f2(RD) + ' + 0.7 × 2.5 × ' + f3(N) + ' = ' + f3(om.C5) + ' k (combo (6) with Ω₀ ' + f3(om.C6) + '); T = 1.75 × ' + f3(N) + ' − 0.46 × ' + f2(RD) + ' = ' + f3(om.T) + ' k.',
    'Ω₀ LRFD (forces only): C = 1.4 × ' + f2(RD) + ' + 2.5 × ' + f3(N) + ' + ' + f2(RL) + ' = ' + f3(omL.C) + ' k; T = 2.5 × ' + f3(N) + ' − 0.7 × ' + f2(RD) + ' = ' + f3(omL.T) + ' k.',
    'SW-1 hardware (ASD, upper story → strap): T = ' + f3(asd.T) + ' k → ' + strap.id + ' (' + strap.cap + ' lb).',
    'Support post P-1 (Level 1, under the SW-1 left end, on the foundation): it carries the SW-1 end per combination, so its envelopes equal the wall end: ASD T ' + f3(asd.T) + ' / C ' + f3(Casd) + ' k, LRFD C ' + f3(lrfd.C) + ' k, Ω₀ ASD C ' + f3(Com) + ' k.',
    'Post base hardware (ASD): T = ' + f3(asd.T) + ' k → ' + hdBase.id + ' (min post (2)2x4). Post member: C_design = max(ASD ' + f3(Casd) + ', Ω₀ ASD ' + f3(Com) + ') = ' + f3(Cpost) + ' k (Ω₀ ASD governs) → (2)2x4 ' + f2(postCap(cands[0], h).cap) + ' k < C → ' + pPost.id + ' ' + f2(postCap(pPost, h).cap) + ' k. With ASD alone it would be ' + pAsdOnly.id + '.',
    'Level 1: SW-2 (10 ft) takes the story shear ' + (V1 + V2) + ' k; the SW-1 shear reaches it through the diaphragm. Line checks G1–G12 pass.',
    dL2.gov.text + ' ' + dL2.text,
    dL1.gov.text + ' MSTC40 δ basis = cap/0.7 (strap); HDUE3 basis = ASD cap. ' + dL1.text,
  ],
  expect: [
    ex('SW-1 ASD governing T (k)', 'wall:SW-1', 'governingTensionLeft', asd.T, 2),
    ex('SW-1 ASD governing C (k)', 'wall:SW-1', 'governingComprRight', Casd, 2),
    ex('SW-1 LRFD C (k)', 'wall:SW-1', 'lrfd.cR', lrfd.C, 3),
    ex('SW-1 LRFD T (k)', 'wall:SW-1', 'lrfd.tL', lrfd.T, 3),
    ex('SW-1 Ω₀ ASD C (k)', 'wall:SW-1', 'omega.asd.cR', Com, 4),
    ex('SW-1 Ω₀ ASD T (k)', 'wall:SW-1', 'omega.asd.tL', om.T, 4),
    ex('SW-1 Ω₀ LRFD C (k)', 'wall:SW-1', 'omega.lrfd.cR', omL.C, 5),
    ex('SW-1 Ω₀ LRFD T (k)', 'wall:SW-1', 'omega.lrfd.tL', omL.T, 5),
    ex('P-1 ASD C (k)', 'post:P-1', 'envelopeC', Casd, 7),
    ex('P-1 LRFD C (k)', 'post:P-1', 'lrfd.C', lrfd.C, 7),
    ex('P-1 Ω₀ ASD C (k)', 'post:P-1', 'omega.asd.C', Com, 7),
    ex('P-1 post design C = max(ASD, Ω₀ ASD) (k)', 'post:P-1', 'postDesignC', Cpost, 8),
    ex('P-1 post design governed by', 'post:P-1', 'postGoverns', 'Ω₀ ASD', 8),
    ...driftExpect(dL2, 10),
    ...driftExpect(dL1, 11),
  ],
  expectChecks: { fail: [] },
  notChecked: 'P-2 (mirror of P-1); SW-2 design (standard, see V01).',
  // Design pinned as manual overrides (method case): the engine picks at calc v13, frozen 2026-09-30
  pins: {"SW-1":{"nail":"6","hdL":"MSTC40","hdR":"MSTC40","postL":"(2)2x4","postR":"(2)2x4"},"SW-2":{"nail":"4","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"},"P-1":{"post":"(3)2x4","hd":"HDUE3"},"P-2":{"post":"(3)2x4","hd":"HDUE3"}},
  inputs: project({
    sds: String(Sds), ...SEISMIC,
    wallDLTypes: [{ id: 'wdt-1', name: 'Stud wall', psf: String(psf) }],
    levels: [level('lvl-2', 'Level 2', h), level('lvl-1', 'Level 1', h)],
    directions: [direction('dir-1', 'N-S', [line({ totalLength: 24,
      levelLoads: { 'lvl-2': { seismic: String(V2), wind: '' }, 'lvl-1': { seismic: String(V1), wind: '' } },
      gravityLoads: { 'lvl-2': { loads: [gPart('g1', 0, L1, 100, 50)] }, 'lvl-1': { loads: [] } },
      walls: [wall('w-1', 'SW-1', 'lvl-2', 0, L1), wall('w-2', 'SW-2', 'lvl-1', 12, 10)],
      supportPosts: [post('sp-1', 'P-1', 'lvl-1', 0), post('sp-2', 'P-2', 'lvl-1', L1)] })])],
  }),
};
