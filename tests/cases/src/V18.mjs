// V18 — wind and seismic together (loadType 'both'): wind column capacity, wind ASD combos, governing E vs W, α_s drift
import { project, level, direction, line, wall, gFull, ex, pickHD, postCap, POSTS4, HDUE, NAIL, asdE, f2, f3, f4, SEISMIC, eq431, storyDrift, driftExpect } from './lib.mjs';

const Sds = 1.0, h = 10, L = 10, psf = 10, alphaS = 0.7;
const a = asdE(Sds);
const Dplf = 100, Lrplf = 60;
const D = psf * L * h / 1000 + Dplf * L / 1000, RD = D / 2, RLr = Lrplf * L / 1000 / 2;
// lightest nailing that carries both v_E (seismic column) and v_W (wind column)
const pickBoth = (vE, vW) => NAIL.find(n => vE <= n.E + 1e-9 && vW <= n.W + 1e-9);
function design(VE, VW) {
  const vE = 0.7 * VE * 1000 / L, vW = 0.6 * VW * 1000 / L;
  const n = pickBoth(vE, vW);
  const dcE = vE / n.E, dcW = vW / n.W;
  const NE = VE * h / L, NW = VW * h / L;
  const T = { E8: 0.7 * NE - a.up * RD, W7: 0.6 * NW - 0.6 * RD };            // (0.6−0.14SDS)D + 0.7E, 0.6D + 0.6W
  const C = { E5: a.dn * RD + 0.7 * NE, W5: RD + 0.6 * NW, W6: RD + 0.45 * NW + 0.75 * RLr, DLr: RD + RLr, E6: a.d6 * RD + 0.525 * NE };
  const Tg = Math.max(T.E8, T.W7), Cg = Math.max(...Object.values(C));
  const hd = pickHD(Tg);
  const post = POSTS4.filter(p => p.d2 >= 3.0).find(p => postCap(p, h).cap >= Cg);
  return { VE, VW, vE, vW, n, dcE, dcW, NE, NW, T, C, Tg, Cg, hd, post, gov: dcE >= dcW ? 'seismic' : 'wind' };
}
const A = design(5, 6), B = design(2, 12);
// α_s·W deflection of SW-2 (Eq. 4.3-1, lateral only): v = α_s·V_W/L, T = C = α_s·N_W
const E = 1700000;
const vw = alphaS * B.VW * 1000 / L, Tw = alphaS * B.NW * 1000, Cw = Tw, Ap = B.post.A, Ga = NAIL.find(n => n.id === B.n.id).gaPLY;
const t1 = 8 * vw * h ** 3 / (E * Ap * L), t2 = vw * h / (1000 * Ga), dHD = B.hd.delta * Tw / B.hd.lrfdCap; // linear from the LRFD pair (2026-10-14)
const r = Cw / (Ap * 625), dC = 0.02 * (r < 0.73 ? r / 0.73 : r <= 1 ? 1 + (r - 0.73) / 0.27 : 2 * r ** 3);
const t3 = h * (dHD + dC) / L, dW = t1 + t2 + t3;
const pc = postCap(B.post, h);
// Seismic story drift (Cd 4, Ie 1.0, RC II) at 1.0E, one wall per line, the pinned design
const dEA = storyDrift('Level 1', h, [eq431({ mark: 'SW-1', L, h, nail: '4', hdL: 'HDUE3', hdR: 'HDUE3', postL: '(2)2x4', postR: '(2)2x4', Vk: A.VE, TL: A.NE, CR: A.NE })]);
const dEB = storyDrift('Level 1', h, [eq431({ mark: 'SW-2', L, h, nail: '3', hdL: 'HDUE7', hdR: 'HDUE7', postL: '6x4', postR: '6x4', Vk: B.VE, TL: B.NE, CR: B.NE })]);
const rows = (w, m) => [
  m + ': v_E = 0.7 × ' + w.VE + ' × 1000 / ' + L + ' = ' + f2(w.vE) + ' plf, v_W = 0.6 × ' + w.VW + ' × 1000 / ' + L + ' = ' + f2(w.vW) + ' plf. Lightest pattern with v_E ≤ seismic column and v_W ≤ wind column (wind = 1.4 × seismic, SDPWS 4.3.3): ' + w.n.label + ' (' + w.n.E + ' / ' + w.n.W + ' plf). D/C E = ' + f3(w.dcE) + ', W = ' + f3(w.dcW) + ' → ' + w.gov + ' governs.',
  m + ' end forces: N_E = ' + w.VE + ' × ' + h + '/' + L + ' = ' + f2(w.NE) + ' k, N_W = ' + f2(w.NW) + ' k; R_D = ' + f2(RD) + ', R_Lr = ' + f2(RLr) + ' k. Uplift: (0.6−0.14S_DS)D + 0.7E = ' + f3(w.T.E8) + ' k, 0.6D + 0.6W = 0.6 × ' + f2(w.NW) + ' − 0.6 × ' + f2(RD) + ' = ' + f3(w.T.W7) + ' k → T = ' + f3(w.Tg) + ' k → ' + w.hd.id
    + '. Compression: (1+0.14S_DS)D + 0.7E = ' + f3(w.C.E5) + ', D + 0.6W = ' + f2(RD) + ' + 0.6 × ' + f2(w.NW) + ' = ' + f3(w.C.W5) + ', D + 0.75(0.6W) + 0.75Lr = ' + f3(w.C.W6) + ' → C = ' + f3(w.Cg) + ' k → ' + w.post.id + '.',
];

export default {
  id: 'V18', title: 'Wind and seismic together', slug: 'wind-and-both',
  intent: 'Load type "both" on two single-wall lines: Line A where seismic governs the sheathing and Line B where wind governs. Checks the wind ASD unit shear 0.6W against the wind capacity column, the wind combinations D + 0.6W, 0.6D + 0.6W and D + 0.75(0.6W) + 0.75Lr for the end forces, the governing load type per wall, and the service wind deflection with α_s (report only).',
  covers: ['SDPWS 2021 Table 4.3A wind column', 'ASCE 7-22 §2.4.1 (5)–(7)', 'Governing E vs W', 'α_s wind deflection (report only)'],
  handCalc: [
    'Gravity on each 10 ft wall: self-weight 10 psf × 10 × 10 = 1.00 k + D 100 plf × 10 ft = 1.00 k → D = ' + f2(D) + ' k, R_D = ' + f2(RD) + ' k each end; Lr 60 plf × 10 = 0.60 k → R_Lr = ' + f2(RLr) + ' k.',
    ...rows(A, 'Line A SW-1 (1.0E = 5 k, 1.0W = 6 k)'),
    ...rows(B, 'Line B SW-2 (1.0E = 2 k, 1.0W = 12 k)'),
    'SW-2 end post: ' + B.post.id + ' at 10 ft: F_c* = ' + Math.round(pc.Fstar) + ' psi, F_cE = ' + Math.round(pc.FcE) + ' psi, C_P = ' + f4(pc.Cp) + ' → cap = ' + f2(pc.cap) + ' k ≥ ' + f3(B.Cg) + ' k (lighter posts in the list order are below ' + f3(B.Cg) + ' k or below the HDUE7 minimum post).',
    'SW-2 service wind deflection with α_s = ' + alphaS + ': v = ' + f2(vw) + ' plf, T = C = α_s·N_W = ' + f2(Tw) + ' lb (lateral only), A = ' + Ap + ' in², G_a = ' + Ga + ' → 8vh³/(EAb) = ' + f4(t1) + ', vh/(1000G_a) = ' + f4(t2) + ', Δ_HD = δ_LRFD × T / T_LRFD of ' + B.hd.id + ' = ' + B.hd.delta + ' × ' + f2(Tw) + ' / ' + B.hd.lrfdCap + ' = ' + f4(dHD) + ', r = ' + f4(r) + ' → Δ_c = ' + f4(dC) + ', h·Δa/b = ' + f4(t3) + ' → δ = ' + f4(dW) + ' in; δ/h_sx = ' + f4(dW) + ' / 120 = ' + f4(dW / 120) + ' (report only, no limit).',
    'Line checks G1–G12 pass on both lines (1.0W and 1.0E balance; gravity all to the foundation).',
    'Seismic drift, Line A (1.0E = ' + A.VE + ' k): ' + dEA.gov.text + ' ' + dEA.text,
    'Seismic drift, Line B (1.0E = ' + B.VE + ' k): ' + dEB.gov.text + ' ' + dEB.text,
  ],
  expect: [
    { ...ex('SW-1 governing load type', 'wall:SW-1', 'dcGoverning', A.gov, 2), line: 'Line A' },
    { ...ex('SW-1 wind ASD unit shear (plf)', 'wall:SW-1', 'unitShear_wind', A.vW, 2, 0.01), line: 'Line A' },
    { ...ex('SW-1 governing T left (k)', 'wall:SW-1', 'governingTensionLeft', A.Tg, 3), line: 'Line A' },
    { ...ex('SW-1 governing C right (k)', 'wall:SW-1', 'governingComprRight', A.Cg, 3), line: 'Line A' },
    { ...ex('SW-2 governing load type', 'wall:SW-2', 'dcGoverning', B.gov, 4), line: 'Line B' },
    { ...ex('SW-2 D/C (wind)', 'wall:SW-2', 'windDC', B.dcW, 4, 0.006), line: 'Line B' },
    { ...ex('SW-2 0.6D + 0.6W → uplift left (k)', 'wall:SW-2', 'combos["0.6D+0.6W_pos"].tensionLeft', B.T.W7, 5), line: 'Line B' },
    { ...ex('SW-2 D + 0.6W → compression right (k)', 'wall:SW-2', 'combos["D+0.6W_pos"].comprRight', B.C.W5, 5), line: 'Line B' },
    { ...ex('SW-2 α_s·W δ (in)', 'wall:SW-2', 'deflection.W.delta', dW, 7, 0.0005), line: 'Line B' },
    { ...ex('Line B wind drift ratio δ/h_sx', 'drift:Level 1', 'wind.ratio', dW / 120, 7, 0.0001), line: 'Line B' },
    ...driftExpect(dEA, 9, 'Line A'),
    ...driftExpect(dEB, 10, 'Line B'),
  ],
  expectChecks: { fail: [] },
  notChecked: 'Wind drift limit h/n (report only, see the drift tab).',
  // Design pinned as manual overrides (method case): the engine picks at calc v13, frozen 2026-09-30
  pins: {"Line A/SW-1":{"nail":"4","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"},"Line B/SW-2":{"nail":"3","hdL":"HDUE7","hdR":"HDUE7","postL":"6x4","postR":"6x4"}},
  inputs: project({
    sds: String(Sds), loadType: 'both', alphaS: String(alphaS), ...SEISMIC,
    wallDLTypes: [{ id: 'wdt-1', name: 'Stud wall', psf: String(psf) }],
    levels: [level('lvl-1', 'Level 1', h)],
    directions: [direction('dir-1', 'N-S', [
      line({ id: 'ln-1', name: 'Line A', totalLength: 10, levelLoads: { 'lvl-1': { seismic: '5', wind: '6' } }, gravityLoads: { 'lvl-1': { loads: [gFull('g1', Dplf, '', Lrplf)] } },
        walls: [wall('w-1', 'SW-1', 'lvl-1', 0, L)] }),
      line({ id: 'ln-2', name: 'Line B', totalLength: 10, levelLoads: { 'lvl-1': { seismic: '2', wind: '12' } }, gravityLoads: { 'lvl-1': { loads: [gFull('g2', Dplf, '', Lrplf)] } },
        walls: [wall('w-2', 'SW-2', 'lvl-1', 0, L)] }),
    ])],
  }),
};
