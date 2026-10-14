// V10 — transfer beam: an upper wall on a beam with 2 post supports; wall ends + gravity on the beam →
// reactions by statics per load case → down the posts → post base hardware
import { project, level, direction, line, wall, beam, post, gPart, ex, pickNail, pickHD, pickStrap, postCap, POSTS4, asdE, f2, f3, SEISMIC, eq431, storyDrift, driftExpect } from './lib.mjs';

const Sds = 1.0, a = asdE(Sds), psf = 10, O = 2.5;
const hT = 9, hB = 10;
const xa = 2, xb = 14, span = xb - xa;             // beam BM-1 2–14 ft on the Roof story floor line, supports at 2 and 14
const x0 = 4, LW = 6, x1 = x0 + LW;                 // SW-5 on the beam, 4–10 ft
const wD = 200, ga = 2, gb = 14;                    // Level 1 gravity D 200 plf from 2 to 14 ft (on the beam)
const F_roof = 2, F_1 = 3;
// SW-5
const vW = 0.7 * F_roof * 1000 / LW, nW = pickNail(vW);
const DW = psf * LW * hT / 1000, RW = DW / 2, NW = F_roof * hT / LW;
// Loads on the beam per load case (+ = down): wall ends and the uniform load at its centroid
const Pg = wD * (gb - ga) / 1000, xg = (ga + gb) / 2;
const loads = { D: [[RW, x0], [RW, x1], [Pg, xg]], E: [[-NW, x0], [NW, x1]] }; // 1.0E →: uplift at the left end
const Rb = (c) => loads[c].reduce((s, [P, x]) => s + P * (x - xa) / span, 0);
const Rsum = (c) => loads[c].reduce((s, [P]) => s + P, 0);
const RbD = Rb('D'), RaD = Rsum('D') - RbD, RbE = Rb('E'), RaE = Rsum('E') - RbE;
// Support a (P-3): uplift with → (R_aE < 0), compression with ←
const Ta = -(a.up * RaD + 0.7 * RaE), Ca = a.dn * RaD - 0.7 * RaE;
const Tb = -(a.up * RbD - 0.7 * RbE), Cb = a.dn * RbD + 0.7 * RbE;
const CaO = a.dn * RaD - 0.7 * O * RaE;
const strapA = pickStrap(Ta), hdA = pickHD(Ta);
const pst = POSTS4.filter(p => p.d2 >= 3.0).find(p => postCap(p, hB).cap >= Math.max(Ca, CaO));
// SW-6 (Level 1 lateral wall)
const V6 = F_roof + F_1, v6 = 0.7 * V6 * 1000 / 10;
// Story drift (Cd 4, Ie 1.0, RC II): SW-5 on the beam (beam / post deflection not included, tool rule P5); SW-6 gets
// nothing from above (SW-5's ends land on BM-1) → own V·h/L and own self-weight only (1.0D + 0.5L + 1.0E)
const dR = storyDrift('Roof', hT, [eq431({ mark: 'SW-5', L: LW, h: hT, nail: '6', hdL: 'MSTC40', hdR: 'MSTC40', postL: '(2)2x4', postR: '(2)2x4', Vk: F_roof, TL: NW, CR: NW })]);
const N6 = V6 * hB / 10, R6 = psf * 10 * hB / 2000; // SW-6 self-weight, ½ each end (no gravity load over 16–26 ft)
const d1 = storyDrift('Level 1', hB, [eq431({ mark: 'SW-6', L: 10, h: hB, nail: '4', hdL: 'HDUE3', hdR: 'HDUE3', postL: '(2)2x4', postR: '(2)2x4', Vk: V6, TL: N6, CR: N6 })]);

export default {
  id: 'V10', title: 'Transfer beam on two posts', slug: 'transfer-beam',
  intent: 'An upper wall SW-5 (4–10 ft) sits on transfer beam BM-1 (supports at 2 and 14 ft, both Post supports over posts P-3 / P-4 in the story below). A floor load under the Roof story (Level 1 top, D 200 plf from 2 to 14 ft) also sits on the beam. The beam reactions are found by statics for each load case, combined, carried down the posts to the foundation, and the posts get base holdowns and a member size for max(ASD, Ω₀ ASD). Story shear at Level 1 goes to a separate wall SW-6.',
  covers: ['Transfer beam statics (2 supports)', 'Gravity on the beam (uniform at its centroid)', 'Beam support hardware (strap at an upper floor line)', 'Support posts to the foundation', 'Post member max(ASD, Ω₀ ASD)'],
  handCalc: [
    'SW-5 (L = ' + LW + ' ft, h = ' + hT + ' ft, V = ' + F_roof + ' k): v = 0.7 × ' + F_roof * 1000 + ' / ' + LW + ' = ' + f2(vW) + ' plf → ' + nW.label + '. D = ' + psf + ' × ' + LW + ' × ' + hT + ' = ' + f2(DW) + ' k → ' + f2(RW) + ' k per end; N_E = ' + F_roof + ' × ' + hT + ' / ' + LW + ' = ±' + f2(NW) + ' k.',
    'Loads on BM-1 (x_a = ' + xa + ', x_b = ' + xb + ', span ' + span + ' ft): 1.0D — SW-5 ends ' + f2(RW) + ' k at ' + x0 + ' and ' + x1 + ' ft, uniform ' + wD + ' plf × ' + (gb - ga) + ' ft = ' + f2(Pg) + ' k at its centroid x = ' + xg + ' ft. 1.0E → — SW-5 left end −' + f2(NW) + ' k at ' + x0 + ', right end +' + f2(NW) + ' k at ' + x1 + '.',
    '1.0D: R_b = Σ P·(x − x_a)/span = (' + f2(RW) + ' × ' + (x0 - xa) + ' + ' + f2(RW) + ' × ' + (x1 - xa) + ' + ' + f2(Pg) + ' × ' + (xg - xa) + ') / ' + span + ' = ' + f3(RbD) + ' k; R_a = ' + f2(Rsum('D')) + ' − ' + f3(RbD) + ' = ' + f3(RaD) + ' k.',
    '1.0E →: R_b = (−' + f2(NW) + ' × ' + (x0 - xa) + ' + ' + f2(NW) + ' × ' + (x1 - xa) + ') / ' + span + ' = ' + f3(RbE) + ' k; R_a = 0 − ' + f3(RbE) + ' = ' + f3(RaE) + ' k (uplift).',
    'Support a (P-3): uplift (0.6 − 0.14S_DS)D + 0.7E →: ' + f2(a.up) + ' × ' + f3(RaD) + ' + 0.7 × (' + f3(RaE) + ') = ' + f3(-Ta) + ' → T = ' + f3(Ta) + ' k; compression (1.0 + 0.14S_DS)D + 0.7E ←: ' + f2(a.dn) + ' × ' + f3(RaD) + ' + 0.7 × ' + f3(-RaE) + ' = ' + f3(Ca) + ' k.',
    'Support b (P-4): T = −(' + f2(a.up) + ' × ' + f3(RbD) + ' − 0.7 × ' + f3(RbE) + ') = ' + f3(Tb) + ' k (←); C = ' + f2(a.dn) + ' × ' + f3(RbD) + ' + 0.7 × ' + f3(RbE) + ' = ' + f3(Cb) + ' k (→).',
    'Hardware at support a: the beam is on the Roof story floor line (not the bottom story) → strap for T = ' + f3(Ta) + ' k → ' + strapA.id + '. P-3 base at the foundation → ' + hdA.id + '.',
    'P-3 member: Ω₀ ASD (5) = ' + f2(a.dn) + ' × ' + f3(RaD) + ' + 0.7 × ' + O + ' × ' + f3(-RaE) + ' = ' + f3(CaO) + ' k > ASD ' + f3(Ca) + ' k → ' + pst.id + ' at ' + hB + ' ft (cap ' + f2(postCap(pst, hB).cap) + ' k).',
    'SW-6 (Level 1, L = 10 ft, V = ' + V6 + ' k): v = 0.7 × ' + V6 * 1000 + ' / 10 = ' + f2(v6) + ' plf (same as V01). Checks: the Roof story shear goes to SW-5, SW-5 overturning and the beam load reach the foundation through P-3 / P-4 → G1–G12 pass.',
    dR.gov.text + ' (beam / post deflection under SW-5 not included, tool rule P5)',
    dR.text,
    d1.gov.text,
    d1.text,
  ],
  expect: [
    ex('BM-1 R_a 1.0D (k)', 'beam:BM-1', 'supports[0].perCombo["1.0D"]', RaD, 3),
    ex('BM-1 R_b 1.0D (k)', 'beam:BM-1', 'supports[1].perCombo["1.0D"]', RbD, 3),
    ex('BM-1 R_a 1.0E → (k)', 'beam:BM-1', 'supports[0].perCombo["1.0E"]', RaE, 4),
    ex('BM-1 R_b 1.0E → (k)', 'beam:BM-1', 'supports[1].perCombo["1.0E"]', RbE, 4),
    ex('BM-1 support a envelope T (k)', 'beam:BM-1', 'supports[0].envelopeT', Ta, 5),
    ex('BM-1 support a envelope C (k)', 'beam:BM-1', 'supports[0].envelopeC', Ca, 5),
    ex('BM-1 support b envelope T (k)', 'beam:BM-1', 'supports[1].envelopeT', Tb, 6),
    ex('BM-1 support b envelope C (k)', 'beam:BM-1', 'supports[1].envelopeC', Cb, 6),
    ex('P-3 envelope T (k)', 'post:P-3', 'envelopeT', Ta, 7),
    ex('P-3 member design C (k)', 'post:P-3', 'postDesignC', CaO, 8),
    ex('SW-6 ASD unit shear (plf)', 'wall:SW-6', 'unitShear_seismic', v6, 9, 0.01),
    ...driftExpect(dR, 11),
    ...driftExpect(d1, 13),
  ],
  expectChecks: { fail: [] },
  notChecked: 'Beam member design (deferred to a future Beam Calculator). SW-5 deflection on the beam excludes the beam deflection (noted by the tool).',
  // Design pinned as manual overrides (method case): the engine picks at calc v13, frozen 2026-09-30
  pins: {"SW-5":{"nail":"6","hdL":"MSTC40","hdR":"MSTC40","postL":"(2)2x4","postR":"(2)2x4"},"SW-6":{"nail":"4","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"},"P-3":{"post":"(2)2x4","hd":"HDUE3"},"P-4":{"post":"(2)2x4","hd":"HDUE3"},"BM-1":{"support0":"MSTC28","support1":"MSTC28"}},
  inputs: project({
    sds: String(Sds), ...SEISMIC, wallDLTypes: [{ id: 'wdt-1', name: 'Stud wall', psf: String(psf) }],
    levels: [level('lvl-1', 'Roof', hT), level('lvl-2', 'Level 1', hB)],
    directions: [direction('dir-1', 'N-S', [line({ totalLength: 30,
      levelLoads: { 'lvl-1': { seismic: String(F_roof), wind: '' }, 'lvl-2': { seismic: String(F_1), wind: '' } },
      gravityLoads: { 'lvl-1': { loads: [] }, 'lvl-2': { loads: [gPart('g1', ga, gb, wD)] } },
      walls: [wall('w-5', 'SW-5', 'lvl-1', x0, LW), wall('w-6', 'SW-6', 'lvl-2', 16, 10)],
      beams: [beam('bm-1', 'BM-1', 'lvl-1', xa, span, [['bs-1', xa, 'post'], ['bs-2', xb, 'post']])],
      supportPosts: [post('sp-3', 'P-3', 'lvl-2', xa), post('sp-4', 'P-4', 'lvl-2', xb)] })])],
  }),
};
