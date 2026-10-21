// V08 — two-story aligned stack: end forces accumulate per combination (own + wall above) down to the base
import { project, level, direction, line, wall, gFull, ex, pickNail, pickHD, pickStrap, postCap, POSTS4, asdE, f2, f3, SEISMIC, eq431, storyDrift, driftExpect } from './lib.mjs';

const Sds = 1.0, a = asdE(Sds), psf = 10, L = 10;
const hT = 9, hB = 10;                       // Roof story (top) 9 ft, Level 1 story (bottom) 10 ft
const F_roof = 3, F_1 = 4;                   // 1.0E story forces (k)
const VT = F_roof, VB = F_roof + F_1;        // story shears
// Top wall SW-1 (Roof): roof load D 100 / Lr 50 plf full line (line = wall length, nothing over a gap)
const vT = 0.7 * VT * 1000 / L, nT = pickNail(vT);
const DT = 100 * L / 1000 + psf * L * hT / 1000, RT = DT / 2, LrT = 50 * L / 1000, RLrT = LrT / 2;
const NT = VT * hT / L;
const T_top = 0.7 * NT - a.up * RT;                               // (0.6−0.14SDS)D + 0.7E → left end
const Cc = { e5: a.dn * RT + 0.7 * NT, e6: a.d6 * RT + 0.525 * NT, dlr: RT + RLrT };
const C_top = Math.max(...Object.values(Cc));
const strap = pickStrap(T_top);
const postT = POSTS4.filter(p => p.d2 >= 3.0).find(p => postCap(p, hT).cap >= C_top); // MSTC strap minimum post (2)2x4 (user rule 2026-09-30)
// Bottom wall SW-2 (Level 1): floor load D 80 / L 150 plf
const vB = 0.7 * VB * 1000 / L, nB = pickNail(vB);
const DB = 80 * L / 1000 + psf * L * hB / 1000, RB = DB / 2, LLB = 150 * L / 1000, RLB = LLB / 2;
const NB = VB * hB / L;
// Accumulated at the base, same combination: own + top wall end
const Tbase = { e8: -(a.up * RB - 0.7 * NB) - (a.up * RT - 0.7 * NT), e6: -(a.d6 * RB + 0.75 * RLB - 0.525 * NB) - (a.d6 * RT - 0.525 * NT) };
const T_base = Math.max(...Object.values(Tbase));
const Cbase = { e5: a.dn * RB + 0.7 * NB + Cc.e5, e6: a.d6 * RB + 0.75 * RLB + 0.525 * NB + Cc.e6, dl: RB + RLB + RT };
const C_base = Math.max(...Object.values(Cbase));
const hd = pickHD(T_base);
const postB = POSTS4.filter(p => p.d2 >= 3.0).find(p => postCap(p, hB).cap >= C_base); // HDUE minimum post (2)2x4
// Story drift (Cd 4, Ie 1.0, RC II), pinned design. Eq. 4.3-1 at 1.0D + 0.5L + 1.0E: SW-1 own N_T with R_T (Lr not in the
// drift case); SW-2 own N_B + N_T from SW-1 above, gravity R_B + 0.5·R_L,B + R_T (both ends aligned, symmetric)
const e1 = eq431({ mark: 'SW-1', L, h: hT, nail: '6', hdL: 'MSTC28', hdR: 'MSTC28', postL: '(2)2x4', postR: '(2)2x4', Vk: VT, TL: NT, CR: NT });
const e2 = eq431({ mark: 'SW-2', L, h: hB, nail: '3', hdL: 'HDUE7', hdR: 'HDUE7', postL: '6x4', postR: '6x4', Vk: VB, TL: NB + NT, CR: NB + NT });
const dR = storyDrift('Roof', hT, [e1]), dL = storyDrift('Level 1', hB, [e2]);

export default {
  id: 'V08', title: 'Two-story aligned stack', slug: 'two-story-aligned-stack',
  intent: 'Two solid walls stacked with both ends aligned. The top wall end forces go into the bottom wall ends per combination and add to its own; the base hardware and posts are sized for the sum. Also: strap (MSTC) at the upper floor line, holdown (HDUE) at the foundation, and a combination with live load that does not govern.',
  covers: ['Story shear build-up', 'Wall end transfer at aligned ends (±0.1 ft)', 'Per-combination accumulation', 'MSTC strap (16" floor span)', 'HDUE + minimum post', 'ASCE 7-22 §2.4.5 (5), (6), (8)'],
  handCalc: [
    'Story shears: Roof V_T = ' + F_roof + ' k; Level 1 V_B = ' + F_roof + ' + ' + F_1 + ' = ' + VB + ' k. One wall per story takes all of it.',
    'SW-1 (Roof, L = ' + L + ' ft, h = ' + hT + ' ft): v = 0.7 × ' + VT * 1000 + ' / ' + L + ' = ' + f2(vT) + ' plf → ' + nT.label + ' (' + nT.E + ' plf). SW-2 (Level 1, h = ' + hB + ' ft): v = 0.7 × ' + VB * 1000 + ' / ' + L + ' = ' + f2(vB) + ' plf → 4" o.c. 470 < ' + vB + ' NG → ' + nB.label + ' (' + nB.E + ' plf).',
    'SW-1 gravity: D = 100 plf × ' + L + ' + ' + psf + ' psf × ' + L + ' × ' + hT + ' = ' + f2(DT) + ' k → R_D = ' + f2(RT) + ' k per end; Lr = 50 × ' + L + ' = ' + f2(LrT) + ' k → ' + f2(RLrT) + ' k per end. M_OT = ' + VT + ' × ' + hT + ' = ' + VT * hT + ' k·ft → N_E = ±' + f2(NT) + ' k.',
    'SW-1 uplift (0.6 − 0.14S_DS)D + 0.7E: ' + f2(a.up) + ' × ' + f2(RT) + ' − 0.7 × ' + f2(NT) + ' = ' + f3(-T_top) + ' → T = ' + f3(T_top) + ' k at the Roof floor line (not the bottom story → strap) → lightest MSTC (16" span) ≥ ' + Math.round(T_top * 1000) + ' lb: ' + strap.id + ' (' + strap.cap + ' lb).',
    'SW-1 compression: combo (5) ' + f2(a.dn) + ' × ' + f2(RT) + ' + 0.7 × ' + f2(NT) + ' = ' + f3(Cc.e5) + ' k; combo (6) ' + f3(a.d6) + ' × ' + f2(RT) + ' + 0.525 × ' + f2(NT) + ' = ' + f3(Cc.e6) + ' k; D + Lr = ' + f3(Cc.dlr) + ' k → C = ' + f3(C_top) + ' k → post (MSTC minimum (2)2x4) ' + postT.id + ' at ' + hT + ' ft (cap ' + f2(postCap(postT, hT).cap) + ' k).',
    'SW-2 own gravity: D = 80 × ' + L + ' + ' + psf + ' × ' + L + ' × ' + hB + ' = ' + f2(DB) + ' k → ' + f2(RB) + ' k per end; L = 150 × ' + L + ' = ' + f2(LLB) + ' k → ' + f2(RLB) + ' k per end. M_OT = ' + VB + ' × ' + hB + ' = ' + VB * hB + ' k·ft → N_E = ±' + f2(NB) + ' k. Load case 1.0D at each SW-2 end incl. SW-1 above = ' + f2(RB) + ' + ' + f2(RT) + ' = ' + f2(RB + RT) + ' k.',
    'Base uplift = own + SW-1 end, same combination. (8): [' + f2(a.up) + ' × ' + f2(RB) + ' − 0.7 × ' + f2(NB) + '] + [' + f3(-T_top) + '] = ' + f3(-Tbase.e8) + '; (6): [' + f3(a.d6) + ' × ' + f2(RB) + ' + 0.75 × ' + f2(RLB) + ' − 0.525 × ' + f2(NB) + '] + [' + f3(a.d6) + ' × ' + f2(RT) + ' − 0.525 × ' + f2(NT) + '] = ' + f3(-Tbase.e6) + ' → T = ' + f3(T_base) + ' k → ' + hd.id + ' (' + hd.cap + ' lb; HDUE5 5375 lb too small).',
    'Base compression: (5) ' + f2(a.dn) + ' × ' + f2(RB) + ' + 0.7 × ' + f2(NB) + ' + ' + f3(Cc.e5) + ' = ' + f3(Cbase.e5) + ' k; (6) ' + f3(a.d6) + ' × ' + f2(RB) + ' + 0.75 × ' + f2(RLB) + ' + 0.525 × ' + f2(NB) + ' + ' + f3(Cc.e6) + ' = ' + f3(Cbase.e6) + ' k; D + L = ' + f3(Cbase.dl) + ' k → C = ' + f3(C_base) + ' k.',
    'Base post (' + hd.id + ' minimum (2)2x4, ' + hB + ' ft): lightest with cap ≥ ' + f2(C_base) + ' k in the order (2)2x4, (3)2x4, 4x4, 6x4, 8x4 → ' + postB.id + ' (cap ' + f2(postCap(postB, hB).cap) + ' k).',
    'Line checks: base shear ' + VB + ' k, base moment Σ V·h = ' + VT + ' × ' + hT + ' + ' + VB + ' × ' + hB + ' = ' + (VT * hT + VB * hB) + ' k·ft; all gravity reaches the foundation → G1–G12 pass.',
    e1.text + ' (strap slip at its LRFD cap = cap / 0.7.)',
    e2.text + ' (T = C = N_B + N_T = ' + f3(NB) + ' + ' + f3(NT) + ' = ' + f3(NB + NT) + ' k: the SW-1 end force adds to SW-2\'s own.)',
    dR.text,
    dL.text,
  ],
  expect: [
    ex('SW-2 ASD unit shear (plf)', 'wall:SW-2', 'unitShear_seismic', vB, 2, 0.01),
    ex('SW-1 governing T, left (k)', 'wall:SW-1', 'governingTensionLeft', T_top, 4),
    ex('SW-1 governing C, right (k)', 'wall:SW-1', 'governingComprRight', C_top, 5),
    ex('SW-2 1.0D left, own + above (k)', 'wall:SW-2', 'lc["1.0D"].left', RB + RT, 6),
    ex('SW-2 1.0E → left, own + above (k)', 'wall:SW-2', 'lc["1.0E →"].left', -(NB + NT), 6),
    ex('SW-2 base T, left (k)', 'wall:SW-2', 'hwDemand.tL', T_base, 7),
    ex('SW-2 base C, right (k)', 'wall:SW-2', 'hwDemand.cR', C_base, 8),
    ex('SW-1 δ at 1.0E (in)', 'wall:SW-1', 'deflection.E.delta', e1.delta, 11, 0.0005),
    ex('SW-2 δ at 1.0E, incl. SW-1 end forces (in)', 'wall:SW-2', 'deflection.E.delta', e2.delta, 12, 0.0005),
    ...driftExpect(dR, 13),
    ...driftExpect(dL, 14),
  ],
  expectChecks: { fail: [] },
  notChecked: 'The deflection terms one by one (V15). NDS post capacities are computed with the lib.mjs column formula (NDS 2018 §3.7), not re-derived step by step here.',
  // Design pinned as manual overrides (method case): the engine picks at calc v13, frozen 2026-09-30
  pins: {"SW-1":{"nail":"6","hdL":"MSTC28","hdR":"MSTC28","postL":"(2)2x4","postR":"(2)2x4"},"SW-2":{"nail":"3","hdL":"HDUE7","hdR":"HDUE7","postL":"6x4","postR":"6x4"}},
  inputs: project({
    sds: String(Sds), ...SEISMIC, wallDLTypes: [{ id: 'wdt-1', name: 'Stud wall', psf: String(psf) }],
    levels: [level('lvl-1', 'Roof', hT), level('lvl-2', 'Level 1', hB)],
    directions: [direction('dir-1', 'N-S', [line({ totalLength: L,
      levelLoads: { 'lvl-1': { seismic: String(F_roof), wind: '' }, 'lvl-2': { seismic: String(F_1), wind: '' } },
      gravityLoads: { 'lvl-1': { loads: [gFull('g1', 100, '', 50)] }, 'lvl-2': { loads: [gFull('g2', 80, 150, '')] } },
      walls: [wall('w-1', 'SW-1', 'lvl-1', 0, L), wall('w-2', 'SW-2', 'lvl-2', 0, L)] })])],
  }),
};
