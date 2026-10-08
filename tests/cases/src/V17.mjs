// V17 — deflection distribution: a converged line (closed form) and a stacked line where the lower short wall is
// starved by the rotation from above (finding F-DD1 — the fixed base case for the F-DD1 solver work)
import { project, level, direction, line, wall, ex, HDUE, MSTC16, POSTS4, NAIL, f2, f3, f4, SEISMIC, eq431, storyDrift, driftExpect } from './lib.mjs';

const h = 10, E = 1700000, Fcp = 625;
const H3 = HDUE.find(x => x.id === 'HDUE3'), P2 = POSTS4.find(p => p.id === '(2)2x4');
const Ga6 = NAIL.find(n => n.id === '6').gaPLY;
// δ per kip of wall shear (in/k): Eq. 4.3-1 with v = 1000V/L, T = C = 1000V·h/L, crushing r < 0.73 (linear)
function springOf(L, Ga, hd, p) {
  const t1 = 8e6 / (E * p.A * L * L), t2 = h / (L * Ga), T1 = 1000 * h / L;
  const dHD = hd.delta * T1 / hd.cap, dC = 0.02 * (T1 / (p.A * Fcp)) / 0.73, t3 = h * (dHD + dC) / L;
  return { t1, t2, t3, c: t1 + t2 + t3, rPerK: T1 / (p.A * Fcp) };
}
const V = 6, Ls = [6, 12];
const s = Ls.map(L => springOf(L, Ga6, H3, P2));
const k = s.map(x => 1 / x.c), K = k[0] + k[1];
const Vs = k.map(x => V * x / K), delta = V / K;
const v = Vs.map((x, i) => 0.7 * x * 1000 / Ls[i]);
const T2 = 0.7 * Vs[1] * h / 12 - 0.46 * (10 * 12 * h / 2000);
const byLength = Ls.map(L => V * L / 18);

// Line B (pinned design): δ(V, T_above) at 1.0E with the full Eq. 4.3-1 (crushing curve), 2" o.c. both sides (G_a 56)
const VB = 7, GaB = NAIL.find(n => n.id === '2B').gaPLY;
const Pp = (id) => POSTS4.find(p => p.id === id), Hd = (id) => HDUE.find(x => x.id === id), Ms = (id) => MSTC16.find(x => x.id === id);
const crush = (r) => 0.02 * (r < 0.73 ? r / 0.73 : r <= 1 ? 1 + (r - 0.73) / 0.27 : 2 * r ** 3);
function dB(L, a, basis, p, Vk, Tab) {
  const vv = 1000 * Vk / L, T = 1000 * Vk * h / L + Tab;
  return 8 * vv * h ** 3 / (E * p.A * L) + vv * h / (1000 * GaB) + h * (a.delta * T / basis + crush(T / (p.A * Fcp))) / L;
}
// equal δ by bisection on the first wall's share
const eqSplit = (fa, fb) => { let lo = 0, hi = VB; for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (fa(m) > fb(VB - m)) hi = m; else lo = m; } return lo; };
const d3 = (x) => dB(8, Ms('MSTC66'), 5850 / 0.7, Pp('(3)2x4'), x, 0), d4 = (x) => dB(4, Ms('MSTC40'), 3070 / 0.7, Pp('(2)2x4'), x, 0);
const V3 = eqSplit(d3, d4), V4 = VB - V3, dL2 = d3(V3);
const T3 = 1000 * V3 * h / 8, T4 = 1000 * V4 * h / 4;   // 1.0E end forces landing on SW-5 / SW-6 (lb)
const d5 = (x) => dB(8, Hd('HDUE13'), 12950, Pp('8x4'), x, T3), d6 = (x) => dB(4, Hd('HDUE3'), 3790, Pp('(2)2x4'), x, T4);
const V6 = VB - eqSplit(d5, d6), V5 = VB - V6, dL1 = d5(V5);
const off6 = d6(0), full5 = d5(VB);
const capShare6 = 0.9375 * 4 / (0.9375 * 4 + 8); // capacity share of SW-6: same nailing, C_hb 0.9375 at h/b 2.5
// Story drift (Cd 4, Ie 1.0, RC II): each wall's Eq. 4.3-1 at the equal-δ shares above (the walls of a story give the
// same δ, so δxe = the story δ); end forces own V·h/L + from above (lb → k)
const wA = (mark, L, Vk) => eq431({ mark, L, h, nail: '6', hdL: 'HDUE3', hdR: 'HDUE3', postL: '(2)2x4', postR: '(2)2x4', Vk, TL: Vk * h / L, CR: Vk * h / L });
const dA = storyDrift('Level 1', h, [wA('SW-1', 6, Vs[0]), wA('SW-2', 12, Vs[1])]);
const wB = (mark, L, hd, post, Vk, Tab) => eq431({ mark, L, h, nail: '2B', hdL: hd, hdR: hd, postL: post, postR: post, Vk, TL: Vk * h / L + Tab / 1000, CR: Vk * h / L + Tab / 1000 });
const dB2 = storyDrift('Level 2', h, [wB('SW-3', 8, 'MSTC66', '(3)2x4', V3, 0), wB('SW-4', 4, 'MSTC40', '(2)2x4', V4, 0)]);
const dB1 = storyDrift('Level 1', h, [wB('SW-5', 8, 'HDUE13', '8x4', V5, T3), wB('SW-6', 4, 'HDUE3', '(2)2x4', V6, T4)]);

export default {
  id: 'V17', title: 'Deflection distribution — closed form and a starved stacked wall (F-DD1)', slug: 'deflection-distribution',
  intent: 'Line A: two walls (6 ft and 12 ft) share the story shear by stiffness, k = V/δ from SDPWS Eq. 4.3-1, iterated until the wall δ are within 5 %. With linear δ (no plate crushing beyond r = 0.73, fixed hardware) the converged split has a closed form, which is checked here. Line B (finding F-DD1, pinned design): a 4 ft Level 1 wall (SW-6) under a 4 ft wall (SW-4). The δ of SW-6 includes the holdown slip and crushing from the end force SW-4 sends down, which does not depend on the own share of SW-6 — an offset. Equal δ at Level 1 then gives SW-6 only a few percent of the story shear (starved), although its capacity share is about a third. The tool converges to that split; this case fixes the numbers for the F-DD1 solver work.',
  covers: ['Deflection distribution (k = V/δ, 5 % spread, 20 passes)', 'SDPWS Eq. 4.3-1', 'Stacked walls: offset from the forces above (F-DD1)'],
  handCalc: [
    'Line A, both walls 6" o.c. (G_a = 16 k/in), HDUE3 (δ 0.127 in at 3790 lb), (2)2x4 end posts (A = 10.5 in²), h = 10 ft. δ per kip of wall shear: c = 8,000,000/(E·A·L²) + h/(L·G_a) + (h/L)·[0.127·(1000h/L)/3790 + 0.02·(1000h/L)/(A·625)/0.73].',
    'SW-1 (L = 6): c_1 = ' + f4(s[0].t1) + ' + ' + f4(s[0].t2) + ' + ' + f4(s[0].t3) + ' = ' + f4(s[0].c) + ' in/k → k_1 = ' + f3(k[0]) + ' k/in. SW-2 (L = 12): c_2 = ' + f4(s[1].t1) + ' + ' + f4(s[1].t2) + ' + ' + f4(s[1].t3) + ' = ' + f4(s[1].c) + ' in/k → k_2 = ' + f3(k[1]) + ' k/in.',
    'Converged split V_i = V·k_i/Σk: V_1 = 6 × ' + f3(k[0]) + '/' + f3(K) + ' = ' + f3(Vs[0]) + ' k, V_2 = ' + f3(Vs[1]) + ' k (by length it would be ' + f2(byLength[0]) + ' / ' + f2(byLength[1]) + ' k — the long wall is stiffer than its length share).',
    'Every wall deflects δ = V/Σk = 6/' + f3(K) + ' = ' + f4(delta) + ' in → spread 0 (well inside 5 %). Stiffness reported as k = V·1000/δ: ' + Math.round(k[0] * 1000) + ' and ' + Math.round(k[1] * 1000) + ' lb/in.',
    'Check the assumptions: v = ' + f2(v[0]) + ' / ' + f2(v[1]) + ' plf ≤ 312 → 6" o.c. on both; SW-2 T = 0.7 × ' + f3(Vs[1]) + ' × 10/12 − 0.46 × 0.60 = ' + f3(T2) + ' k ≤ 3.79 → HDUE3; crushing r = ' + f3(s[0].rPerK * Vs[0]) + ' / ' + f3(s[1].rPerK * Vs[1]) + ' < 0.73 → linear.',
    'Line B: 2nd story SW-3 (8 ft) and SW-4 (4 ft) over SW-5 (8 ft) / SW-6 (4 ft), all 2" o.c. both sides (G_a = 56); 1.0E = 7 k at Level 2 only, so both stories carry 7 k. Pinned: SW-3 MSTC66 + (3)2x4, SW-4 MSTC40 + (2)2x4, SW-5 HDUE13 + 8x4, SW-6 HDUE3 + (2)2x4. δ(V, T_above) = 8vh³/(EAb) + vh/(1000G_a) + (h/b)·[δ_cap·T/P_δ + Δ_c(r)], T = 1000·V·h/L + T_above (MSTC P_δ = cap/0.7, HDUE P_δ = cap).',
    'Level 2 (nothing above): equal δ → V_3 = ' + f3(V3) + ' k, V_4 = ' + f3(V4) + ' k, δ = ' + f4(dL2) + ' in at both walls. The 1.0E end forces sent down: SW-3 T = ' + Math.round(T3) + ' lb onto SW-5, SW-4 T = ' + Math.round(T4) + ' lb onto SW-6.',
    'Level 1 offsets: SW-6 at zero own share already deflects d_6 = δ(0, ' + Math.round(T4) + ' lb) = ' + f4(off6) + ' in (its HDUE3 slip and crushing under the force from SW-4, × h/b = 2.5). SW-5 carrying the whole 7 k deflects ' + f4(full5) + ' in > d_6, so an equal-δ split exists.',
    'Level 1 equal δ: V_6 = ' + f3(V6) + ' k (' + f2(100 * V6 / VB) + ' % of the story), V_5 = ' + f3(V5) + ' k, δ = ' + f4(dL1) + ' in. By capacity SW-6 would take ' + f2(100 * capShare6) + ' % (' + f2(VB * capShare6) + ' k): the stack above starves it (finding F-DD1).',
    'Offset check (note in G3): δ_6(0)/δ = ' + f4(off6) + ' / ' + f4(dL1) + ' = ' + f2(off6 / dL1) + ' > 0.5 → SW-6 is noted: most of its deflection comes from the force of SW-4 above; δ_5(0)/δ = ' + f4(d5(0)) + ' / ' + f4(dL1) + ' = ' + f2(d5(0) / dL1) + ' → no note.',
    'Line A drift (Cd 4, Ie 1.0, RC II): the two walls give the same δ at their shares (' + f4(dA.gov.delta) + ' in), so δxe = the story δ and either wall can be named as governing. ' + dA.text,
    'Line B drift: Level 2 δ = ' + f4(dB2.dxe) + ' in, Level 1 δ = ' + f4(dB1.dxe) + ' in (equal δ at each story, end forces from above included). ' + dB2.text + ' ' + dB1.text,
  ],
  expect: [
    { ...ex('SW-1 share V (1.0E)', 'wall:SW-1', 'shareExact_1E', Vs[0], 3, 0.005), line: 'Line A' },
    { ...ex('SW-2 share V (1.0E)', 'wall:SW-2', 'shareExact_1E', Vs[1], 3, 0.005), line: 'Line A' },
    { ...ex('SW-1 stiffness k (lb/in)', 'wall:SW-1', 'stiffness.E', k[0] * 1000, 4, 0.005 * k[0] * 1000), line: 'Line A' },
    { ...ex('SW-2 stiffness k (lb/in)', 'wall:SW-2', 'stiffness.E', k[1] * 1000, 4, 0.005 * k[1] * 1000), line: 'Line A' },
    { ...ex('SW-1 δ (in)', 'wall:SW-1', 'deflection.E.delta', delta, 4, 0.001), line: 'Line A' },
    { ...ex('SW-2 δ (in)', 'wall:SW-2', 'deflection.E.delta', delta, 4, 0.001), line: 'Line A' },
    { ...ex('Line A converged', 'line', 'distribution.converged', true, 4), line: 'Line A' },
    { ...ex('Line A δ spread ≤ 5 %', 'line', 'distribution.spreadRows[0].spread', 0, 4, 0.05), line: 'Line A' },
    { ...ex('Line B SW-3 share, Level 2 (k)', 'wall:SW-3', 'shareExact_1E', V3, 7, 0.01), line: 'Line B' },
    { ...ex('Line B SW-4 share, Level 2 (k)', 'wall:SW-4', 'shareExact_1E', V4, 7, 0.01), line: 'Line B' },
    { ...ex('Line B SW-4 δ, Level 2 (in)', 'wall:SW-4', 'deflection.E.delta', dL2, 7, 0.002), line: 'Line B' },
    { ...ex('Line B SW-6 share, Level 1 — starved (k)', 'wall:SW-6', 'shareExact_1E', V6, 9, 0.005), line: 'Line B' },
    { ...ex('Line B SW-5 share, Level 1 (k)', 'wall:SW-5', 'shareExact_1E', V5, 9, 0.005), line: 'Line B' },
    { ...ex('Line B SW-5 δ, Level 1 (in)', 'wall:SW-5', 'deflection.E.delta', dL1, 9, 0.0005), line: 'Line B' },
    { ...ex('Line B SW-6 δ, Level 1 (in)', 'wall:SW-6', 'deflection.E.delta', dL1, 9, 0.0005), line: 'Line B' },
    { ...ex('Line B SW-6 δ(0)/δ* (from above)', 'line', 'distribution.levels[1].walls[1].fromAboveRatio', off6 / dL1, 10, 0.002), line: 'Line B' },
    { ...ex('Line B converged', 'line', 'distribution.converged', true, 9), line: 'Line B' },
    // equal δ at every story: which wall is 'largest' is rounding noise, so the governing-wall row is left out
    ...[...driftExpect(dA, 11, 'Line A'), ...driftExpect(dB2, 12, 'Line B'), ...driftExpect(dB1, 12, 'Line B')].filter(r => r.field !== 'seismic.wallMark'),
  ],
  expectChecks: { fail: [] },
  notChecked: 'Whether a starved lower wall is acceptable is the engineer\'s judgment: the tool notes it (G3) and names the remedy (a larger holdown / strap on that wall).',
  // Design pinned as manual overrides (method case): the engine picks at calc v13, frozen 2026-09-30
  pins: {"Line A/SW-1":{"nail":"6","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"},"Line A/SW-2":{"nail":"6","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"},"Line B/SW-3":{"nail":"2B","hdL":"MSTC66","hdR":"MSTC66","postL":"(3)2x4","postR":"(3)2x4"},"Line B/SW-4":{"nail":"2B","hdL":"MSTC40","hdR":"MSTC40","postL":"(2)2x4","postR":"(2)2x4"},"Line B/SW-5":{"nail":"2B","hdL":"HDUE13","hdR":"HDUE13","postL":"8x4","postR":"8x4"},"Line B/SW-6":{"nail":"2B","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"}},
  inputs: project({
    distribution: 'deflection', ...SEISMIC,
    levels: [level('lvl-2', 'Level 2', h), level('lvl-1', 'Level 1', h)],
    directions: [direction('dir-1', 'N-S', [
      line({ id: 'ln-1', name: 'Line A', totalLength: 30, levelLoads: { 'lvl-1': { seismic: String(V), wind: '' } }, gravityLoads: {},
        walls: [wall('w-1', 'SW-1', 'lvl-1', 0, 6), wall('w-2', 'SW-2', 'lvl-1', 16, 12)] }),
      line({ id: 'ln-2', name: 'Line B', totalLength: 40, levelLoads: { 'lvl-2': { seismic: '7', wind: '' } }, gravityLoads: {},
        walls: [wall('w-3', 'SW-3', 'lvl-2', 0, 8), wall('w-4', 'SW-4', 'lvl-2', 20, 4), wall('w-5', 'SW-5', 'lvl-1', 0, 8), wall('w-6', 'SW-6', 'lvl-1', 20, 4)] }),
    ])],
  }),
};
