// V14 — FTAO benchmark: APA T555 two-opening example (Figure 4 statics) run through the full calculator
import { project, level, direction, line, wall, ex, f2, f3, f4, SEISMIC, storyDrift, driftExpect } from './lib.mjs';

// APA T555 "Design for Force Transfer Around Openings", two-opening example: piers 4 / 4 / 3.5 ft, openings
// 6 ft and 2 ft, h = 8 ft, h_a = 1.33 ft (above), h_o = 2.67 ft (opening), h_b = 4 ft (below); V_ASD = 3,750 lb.
const h = 8, Lp = [4, 4, 3.5], Lo = [6, 2], ha = 4 / 3, ho = 8 / 3, hb = 4;
const Ltot = Lp.reduce((s, x) => s + x, 0) + Lo.reduce((s, x) => s + x, 0); // 19.5 ft
const V_ASD = 3750, V1 = V_ASD / 0.7;          // seismic ASD 0.7ρE with ρ = 1 → 1.0-level V = 5,357 lb
const H = V_ASD * h / Ltot;                     // chord force (lb), no dead load
const va = H / (ha + hb);                       // unit shear above / below the openings (plf)
const anch = V_ASD / Ltot;                      // wall anchorage (plf)
// Published T555 Figure 4 values (lb, plf) — the same ones in test/ftao.test.js
const PUB = { pierV: [337, 388, 244], pierVc: [120, 95, 167], Fmax: 865, corner1: [865, 865], corner2: [308, 269] };
const sill = hb, head = hb + ho;
const off1 = Lp[0], off2 = Lp[0] + Lo[0] + Lp[1];
// FTAO deflection, APA T555 method (SDPWS 2021 Eq. 4.3-1 per pier and direction, averaged over the 2·n pier cases),
// with this case's pinned design — not the published 0.335 in, which uses the example's own posts, holdowns and G_a.
// At 1.0E (ρ = 1): V = V1. Pier unit shear v_i = (V/L)·(L_i + T_i)/L_i, T_i = the opening lengths tributary to the pier
// (T555 statics, the same as the published pier values × V1/V_ASD). Pinned: 4" o.c. plywood G_a = 20 k/in, HDUE3
// (δ 0.127 in at 3,790 lb), every pier edge (2)2x4 A = 10.5 in² (end posts and default jamb posts). A pier that
// deflects away from the sheathing below the opening (pier 1 ←L, pier n →R) uses the full height h and the crushing
// term at the wall-end post with C = H (gross chord force); the others use h − h_b and no crushing.
const FD = (() => {
  const E = 1700000, Ga = 20, da = 0.127, HDa = 3790, A = 10.5, Fcp = 625, V = V1;
  const crush = (r) => 0.02 * (r < 0.73 ? r / 0.73 : r <= 1 ? 1 + (r - 0.73) / 0.27 : 2 * r ** 3);
  const Tl = [], Tr = [];
  for (let j = 0; j < Lo.length; j++) { const sum = Lp[j] + Lp[j + 1]; Tl[j] = Lp[j] * Lo[j] / sum; Tr[j] = Lp[j + 1] * Lo[j] / sum; }
  const Hd = V * h / Ltot, cases = [];
  Lp.forEach((Li, i) => {
    const T = (i > 0 ? Tr[i - 1] : 0) + (i < Lo.length ? Tl[i] : 0), v = V / Ltot * (Li + T) / Li;
    for (const d of ['L', 'R']) {
      const full = (i === 0 && d === 'L') || (i === Lp.length - 1 && d === 'R'), hh = full ? h : h - hb;
      const t1 = 8 * v * hh ** 3 / (E * A * Li), t2 = v * hh / (1000 * Ga), dHD = da * v * hh / HDa;
      const r = full ? Hd / (A * Fcp) : null, dC = full ? crush(r) : 0, t3 = hh * (dHD + dC) / Li;
      cases.push({ pier: i + 1, d, T, v, hh, t1, t2, dHD, r, dC, t3, sum: t1 + t2 + t3 });
    }
  });
  return { Hd, cases, delta: cases.reduce((a, c) => a + c.sum, 0) / cases.length };
})();
const dL1 = storyDrift('Level 1', h, [{ mark: 'SW-14', delta: FD.delta }]);

export default {
  id: 'V14', title: 'FTAO — APA T555 two-opening benchmark', slug: 'ftao-apa-t555',
  intent: 'A 19.5 ft FTAO wall with two windows reproduces the APA T555 two-opening example through the whole calculator (level load → share → FTAO engine). The statics of the force-transfer method must match the published Figure 4 values: chord force H, unit shear above / below the openings, pier and corner-zone unit shears, strap force F_max and the corner forces.',
  covers: ['FTAO method (APA T555 / Diekmann)', 'Published benchmark (APA T555 Figure 4)', 'Segmented vs FTAO: openings only on FTAO walls'],
  handCalc: [
    'Geometry (T555): piers ' + Lp.join(' / ') + ' ft, openings ' + Lo.join(' / ') + ' ft → L = ' + Ltot + ' ft; h = ' + h + ' ft, h_a = ' + f2(ha) + ', h_o = ' + f2(ho) + ', h_b = ' + hb + ' ft. In the tool: openings at offset ' + off1 + ' ft (width ' + Lo[0] + ') and ' + off2 + ' ft (width ' + Lo[1] + '), sill ' + sill + ' ft, head ' + f2(head) + ' ft.',
    'Loads: T555 uses V_ASD = ' + V_ASD + ' lb. With seismic 0.7ρE and ρ = 1 the level load is V = ' + V_ASD + ' / 0.7 = ' + f2(V1) + ' lb (entered as ' + f2(V1 / 1000) + ' k, one wall takes all of it).',
    'Chord force H = V·h / L = ' + V_ASD + ' × ' + h + ' / ' + Ltot + ' = ' + f2(H) + ' lb (published 1,538 lb; no dead load in the FTAO statics).',
    'Unit shear above and below the openings v_a = v_b = H / (h_a + h_b) = ' + f2(H) + ' / (' + f2(ha) + ' + ' + hb + ') = ' + f2(va) + ' plf (published 288 plf).',
    'Pier unit shears (published): pier 1 / 2 / 3 = ' + PUB.pierV.join(' / ') + ' plf; corner-zone unit shears v_c = ' + PUB.pierVc.join(' / ') + ' plf.',
    'Strap force F_max (published) = ' + PUB.Fmax + ' lb; corner forces: opening 1 left / right = ' + PUB.corner1.join(' / ') + ' lb, opening 2 left / right = ' + PUB.corner2.join(' / ') + ' lb.',
    'Anchorage along the wall = V / L = ' + V_ASD + ' / ' + Ltot + ' = ' + f2(anch) + ' plf.',
    'Line checks: base shear and moment of the one wall = the level load → G1–G12 pass.',
    'FTAO deflection at 1.0E (APA T555 method: Eq. 4.3-1 for each pier in each direction, averaged; pinned design 4" o.c. plywood G_a = 20, HDUE3 δ 0.127 in at 3,790 lb, all pier edges (2)2x4 A = 10.5 in²; the published 0.335 in uses the example’s own components, so it is not this case’s value). V = ' + f2(V1) + ' lb, H = V·h/L = ' + f2(FD.Hd) + ' lb. '
      + FD.cases.map(c => 'Pier ' + c.pier + ' ' + c.d + ': v = ' + f2(V1) + '/' + Ltot + ' × (L_' + c.pier + ' + T_' + c.pier + ') / L_' + c.pier + ' = ' + f2(V1) + '/' + Ltot + ' × (' + Lp[c.pier - 1] + ' + ' + f3(c.T) + ')/' + Lp[c.pier - 1] + ' = ' + f2(c.v) + ' plf, h = ' + c.hh + ' → ' + f4(c.t1) + ' + ' + f4(c.t2) + ' + ' + c.hh + ' × (' + f4(c.dHD) + (c.r != null ? ' + Δ_c ' + f4(c.dC) + ' [r = ' + f3(c.r) + ']' : '') + ')/' + Lp[c.pier - 1] + ' = ' + f4(c.sum)).join('; ')
      + ' → Δ = average of the ' + FD.cases.length + ' cases = ' + f4(FD.delta) + ' in.',
    dL1.text,
  ],
  expect: [
    ex('SW-14 is FTAO', 'wall:SW-14', 'method', 'ftao', 1),
    ex('V_ASD (lb)', 'wall:SW-14', 'ftao.perType.E.V_ASD', V_ASD, 2, 0.5),
    ex('Chord force H (lb)', 'wall:SW-14', 'ftao.perType.E.H', H, 3, 0.5),
    ex('v_a above / below openings (plf)', 'wall:SW-14', 'ftao.perType.E.va', va, 4, 0.5),
    ...PUB.pierV.map((v, i) => ex('Pier ' + (i + 1) + ' unit shear (plf), T555', 'wall:SW-14', 'ftao.perType.E.piers[' + i + '].v', v, 5, 1)),
    ...PUB.pierVc.map((v, i) => ex('Pier ' + (i + 1) + ' corner-zone v_c (plf), T555', 'wall:SW-14', 'ftao.perType.E.piers[' + i + '].vc', v, 5, 1)),
    ex('F_max (lb), T555', 'wall:SW-14', 'ftao.perType.E.Fmax', PUB.Fmax, 6, 1),
    ex('Corner force opening 1 left (lb), T555', 'wall:SW-14', 'ftao.perType.E.corners[0].F_left', PUB.corner1[0], 6, 1),
    ex('Corner force opening 2 right (lb), T555', 'wall:SW-14', 'ftao.perType.E.corners[1].F_right', PUB.corner2[1], 6, 1),
    ex('Anchorage (plf)', 'wall:SW-14', 'ftao.perType.E.anchorage_plf', anch, 7, 0.01),
    ex('SW-14 FTAO Δ at 1.0E (in)', 'wall:SW-14', 'deflection.E.delta', FD.delta, 9, 0.0005),
    ...driftExpect(dL1, 10),
  ],
  expectChecks: { fail: [] },
  notChecked: 'The published T555 deflection (0.335 in with 7/16 OSB, G_a 22) uses the example\'s own posts, holdowns and G_a and is checked by the FTAO engine tests (test/ftao.test.js); here Δ is hand-calculated by the same T555 method with this case\'s pinned design (step 9). Sheathing capacity (the tool auto-selects nailing).',
  // Design pinned as manual overrides (method case): the engine picks at calc v13, frozen 2026-09-30
  pins: {"SW-14":{"nail":"4","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4","ftaoStrap":"CS20"}},
  inputs: project({
    ...SEISMIC,
    wallDLTypes: [{ id: 'wdt-1', name: 'Stud wall', psf: '10' }],
    levels: [level('lvl-1', 'Level 1', h)],
    directions: [direction('dir-1', 'N-S', [line({ totalLength: Ltot,
      levelLoads: { 'lvl-1': { seismic: String(V1 / 1000), wind: '' } },
      gravityLoads: { 'lvl-1': { loads: [] } },
      walls: [wall('w-14', 'SW-14', 'lvl-1', 0, Ltot, { method: 'ftao',
        openings: [{ id: 'o1', offset: off1, width: Lo[0], sill, head }, { id: 'o2', offset: off2, width: Lo[1], sill, head }] })] })])],
  }),
};
