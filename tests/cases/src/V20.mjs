// V20 — Strong-Wall WSWH on concrete mixed with a sheathed wall: capacity distribution with the panel V_allow,
// panel D/C, anchor tension T = V·H_e/B − P/2 (combo-factored D), Table 06 anchor (cracked concrete, SDC D)
import { project, level, direction, line, wall, panel, gPoint, ex, pickNail, pickHD, asdE, f2, f3, SEISMIC, eq431, storyDrift, driftExpect } from './lib.mjs';

const Sds = 1.0, h = 9, V = 4, psf = 10, Lw = 8, Dp = 1.2;
const a = asdE(Sds);
// Table 01 (C-L-SW26 p. 40), WSWH18x9, f'c 2,500 psi: rows P = 1,000 and 4,000 lb both V_ASD,S = 2,575 lb, Δ = 0.45 in, H_e = 105.25 in
const T01 = { He: 105.25, V_S: 2575, D_S: 0.45 };
const B = 12.5;                                 // Table 05 / T01 p. 41 n.11: B = 12½" for WSWH18 on concrete
const P_E = Math.max(a.dn * Dp * 1000, a.d6 * Dp * 1000); // ASD vertical load acting with the shear (no live)
// Table 06-A (2,500 psi, cracked), SDC D → criteria E only; smallest W with T_ASDallow ≥ T
const T06E = [{ grade: 'STD', T: 16000, W: 33, de: 11, Lftg18: 47 }, { grade: 'STD', T: 17100, W: 35, de: 12, Lftg18: 49 }, { grade: 'HS', T: 34100, W: 52, de: 18, Lftg18: 66 }, { grade: 'HS', T: 36800, W: 55, de: 19, Lftg18: 69 }];
const wP = T01.V_S, wW = 312 * Lw;              // capacity weights (lb): panel V_allow; wall v_cap × L at 6" o.c.
const Vp = V * wP / (wP + wW), Vw = V - Vp;
const vw = 0.7 * Vw * 1000 / Lw;
const nW = pickNail(vw);
const Vd = 0.7 * Vp * 1000, dc = Vd / T01.V_S;
const M = Vp * T01.He / 12;                     // 1.0E OTM of the panel (k·ft) = V·H_e
const Np = M / (B / 12);                        // 1.0E end force over the anchor arm B
const Tp = 0.7 * Np - a.up * Dp / 2;            // (0.6−0.14SDS)D + 0.7E: T = 0.7V·H_e/B − 0.46·P/2
const anc = T06E.filter(r => r.T >= Tp * 1000).sort((x, y) => x.W - y.W || x.de - y.de)[0];
const delta = T01.D_S * Vp * 1000 / T01.V_S;    // Δ linear in V at the 1.0 level
const Rw = psf * Lw * h / 2000, Nw = Vw * h / Lw, Tw = 0.7 * Nw - a.up * Rw;
// Story drift (Cd 4, Ie 1.0, RC II): the panel uses its table drift (not Eq. 4.3-1) — Δ = Δ_ASDcap,S × V(1.0E) / V_ASDcap,S,
// the ASD seismic column scaled linearly to the 1.0-level share (= the LRFD-equivalent column, both carry the same Δ/V
// slope); SW-2 uses Eq. 4.3-1 with its pinned design.
const wSW2 = eq431({ mark: 'SW-2', L: Lw, h, nail: '6', hdL: 'HDUE3', hdR: 'HDUE3', postL: '(2)2x4', postR: '(2)2x4', Vk: Vw, TL: Nw, CR: Nw });
const d1 = storyDrift('Level 1', h, [{ mark: 'SW-1', delta }, wSW2]);

export default {
  id: 'V20', title: 'Strong-Wall WSWH on concrete with a sheathed wall', slug: 'wswh-concrete-mixed',
  intent: 'A WSWH18 panel on a concrete foundation (9 ft story, exact WSWH18x9 row) shares the story shear with an 8 ft sheathed wall by capacity: the panel weight is its tabulated V_allow (lb), the wall weight is v_cap × L. Checks the vertical load P used for the table lookup, the panel D/C = V_ASD / V_allow, the anchor tension T = 0.7V·H_e/B − (0.6−0.14S_DS)·P/2, the Table 06 anchor (cracked concrete, SDC D → seismic "E" rows only, smallest W then d_e), and the panel drift Δ = Δ_cap·V/V_cap.',
  covers: ['Simpson C-L-SW26 Table 01 (WSWH18x9)', 'Table 05 arm B', 'Table 06-A anchors (cracked, 2,500 psi)', 'Capacity distribution with WSWH'],
  handCalc: [
    'Panel SW-1 WSWH18 (1.5 ft wide), no wall weight; point load D = ' + Dp + ' k on the panel. P (ASD, seismic) = max[(1.0 + 0.14S_DS)D, (1.0 + 0.105S_DS)D + 0.75L] = 1.14 × 1200 = ' + Math.round(P_E) + ' lb.',
    'Table 01, WSWH18x9 (nominal 9 ft = floor-to-floor, f\'c 2,500 psi): H_e = 105.25 in; P = 1,000 and 4,000 lb rows both give V_ASD,S = 2,575 lb and Δ = 0.45 in → at P = ' + Math.round(P_E) + ' lb: V_allow = 2,575 lb. Arm B = 12.5 in (Table 05).',
    'Capacity distribution, SW-2 at 6" o.c. (312 plf): weights panel 2,575 lb, SW-2 312 × 8 = ' + wW + ' lb → Σ = ' + (wP + wW) + ' lb. Panel V = 4 × 2575/' + (wP + wW) + ' = ' + f3(Vp) + ' k; SW-2 V = ' + f3(Vw) + ' k.',
    'SW-2: v = 0.7 × ' + f3(Vw) + ' × 1000/8 = ' + f2(vw) + ' plf ≤ 312 → ' + nW.label + ' (unchanged, so the weights hold). N = ' + f3(Vw) + ' × 9/8 = ' + f3(Nw) + ' k, T = 0.7 × ' + f3(Nw) + ' − 0.46 × ' + f2(Rw) + ' = ' + f3(Tw) + ' k → ' + pickHD(Tw).id + '.',
    'Panel D/C = V_ASD / V_allow = 0.7 × ' + f3(Vp) + ' × 1000 / 2575 = ' + Math.round(Vd) + ' / 2575 = ' + f3(dc) + '.',
    'Panel anchor tension, (0.6 − 0.14S_DS)D + 0.7E: T = 0.7·V·H_e/B − 0.46·D/2 = 0.7 × ' + f3(Vp) + ' × 105.25/12.5 − 0.46 × ' + f2(Dp / 2) + ' = ' + f3(Tp) + ' k = ' + Math.round(Tp * 1000) + ' lb.',
    'Table 06-A (2,500 psi, cracked), SDC D → criteria E only. Rows with T_ASDallow ≥ ' + Math.round(Tp * 1000) + ' lb, smallest W then d_e: STD 16,000 lb, W = 33 in, d_e = 11 in (L_ftg = 47 in for WSWH18) → WSWH-AB STD (E), D/C = ' + f3(Tp * 1000 / 16000) + '.',
    'Panel drift at 1.0E: Δ = Δ_cap·V/V_cap = 0.45 × ' + f2(Vp * 1000) + ' / 2575 = ' + f3(delta) + ' in (linear, Table 01 n.7).',
    'Line checks G1–G12 pass (the panel load goes straight to the foundation).',
    'Story drift inputs: SW-1 (WSWH) δ = the table drift of step 8 (ASD seismic column Δ_cap = 0.45 in at V_cap = 2,575 lb, scaled to the 1.0E share ' + f2(Vp * 1000) + ' lb) = ' + f3(delta) + ' in. ' + wSW2.text,
    d1.text,
  ],
  expect: [
    ex('Panel P (seismic, lb)', 'wall:SW-1', 'wswh.P.E', P_E, 1, 0.6),
    ex('Panel V_allow (lb)', 'wall:SW-1', 'wswh.Vcap.E', 2575, 2, 0.5),
    ex('Panel H_e (in)', 'wall:SW-1', 'wswh.He', 105.25, 2, 0.001),
    ex('Panel arm B (in)', 'wall:SW-1', 'wswh.B', 12.5, 2, 0.001),
    ex('Panel share V (1.0E)', 'wall:SW-1', 'shareExact_1E', Vp, 3),
    ex('SW-2 share V (1.0E)', 'wall:SW-2', 'shareExact_1E', Vw, 3),
    ex('Panel D/C', 'wall:SW-1', 'dcRatio', dc, 5, 0.006),
    ex('Panel governing T (k)', 'wall:SW-1', 'governingTensionLeft', Tp, 6),
    ex('Panel anchor cap (lb)', 'wall:SW-1', 'anchorageLeft.cap', anc.T, 7, 0),
    ex('Panel Δ at 1.0E (in)', 'wall:SW-1', 'deflection.E.delta', delta, 8, 0.0005),
    ex('SW-2 δ at 1.0E (in)', 'wall:SW-2', 'deflection.E.delta', wSW2.delta, 10, 0.0005),
    ...driftExpect(d1, 11),
  ],
  expectChecks: { fail: [] },
  notChecked: 'Bolt length / HSR extension (Table 07) and edge shear anchorage (Table 08) — not in the tool.',
  // Design pinned as manual overrides (method case): the engine picks at calc v13, frozen 2026-09-30
  pins: {"SW-1":{"wswhAnchor":"E STD 16000"},"SW-2":{"nail":"6","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"}},
  inputs: project({
    sds: String(Sds), ...SEISMIC, seismicDesignCategory: 'D', wswhFc: '2500',
    wallDLTypes: [{ id: 'wdt-1', name: 'Stud wall', psf: String(psf) }],
    levels: [level('lvl-1', 'Level 1', h)],
    directions: [direction('dir-1', 'N-S', [line({ totalLength: 14, levelLoads: { 'lvl-1': { seismic: String(V), wind: '' } },
      gravityLoads: { 'lvl-1': { loads: [gPoint('g1', 0.75, Dp)] } },
      walls: [panel('w-1', 'SW-1', 'lvl-1', 0, { wallDLTypeId: '' }), wall('w-2', 'SW-2', 'lvl-1', 6, Lw)] })])],
  }),
};
