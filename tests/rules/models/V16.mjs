// V16 — drift sizing (one common pattern per story) and the per-line drift bypass
// Deflection distribution with δ linear in V (crushing r < 0.73, fixed hardware): each wall is a spring
// δ_i = c_i·V_i, so the converged shares are V_i = V·k_i/Σk with k_i = 1/c_i and the story δ = V/Σk.
import { project, level, direction, line, wall, ex, pickNail, pickHD, postCap, POSTS4, HDUE, NAIL, asdE, f2, f3, f4 } from '../../cases/src/lib.mjs';

const Sds = 1.0, V = 10, h = 10, psf = 10, Cd = 5, Ie = 1, limit = 0.020;
const a = asdE(Sds);
const E = 1700000, Fcp = 625;
const Da = limit * h * 12;
const P2 = POSTS4.find(p => p.id === '(2)2x4'), P3 = POSTS4.find(p => p.id === '(3)2x4');
const H3 = HDUE.find(x => x.id === 'HDUE3'), H5 = HDUE.find(x => x.id === 'HDUE5');
// c = δ per kip of wall shear (in/k) for a wall of length L with nailing Ga, holdown hd and end posts p
function springOf(L, Ga, hd, p) {
  const t1 = 8e6 / (E * p.A * L * L);             // 8·v·h³/(E·A·b) with v = 1000V/L, h = 10 ft
  const t2 = h / (L * Ga);                        // v·h/(1000·Ga)
  const T1 = 1000 * h / L;                        // lb per kip of V
  const dHD = hd.delta * T1 / hd.cap;
  const dC = 0.02 * (T1 / (p.A * Fcp)) / 0.73;     // r < 0.73 branch (checked below)
  const t3 = h * (dHD + dC) / L;
  return { t1, t2, dHD, dC, t3, c: t1 + t2 + t3, rPerK: T1 / (p.A * Fcp) };
}
// Converged deflection distribution for walls [{ L, Ga, hd, p }]
function distribute(ws) {
  const s = ws.map(w => springOf(w.L, w.Ga, w.hd, w.p));
  const K = s.reduce((acc, x) => acc + 1 / x.c, 0);
  return { s, K, V: s.map(x => V / x.c / K), delta: V / K };
}
const ga = (id) => NAIL.find(n => n.id === id).gaPLY;
const W1 = { L: 6, hd: H3, p: P2 }, W2 = { L: 12, hd: H5, p: P3 };
// Line A final: both 3" o.c. (common pattern) — the result of drift sizing
const A3 = distribute([{ ...W1, Ga: ga('3') }, { ...W2, Ga: ga('3') }]);
// One lighter common pattern: both 4" o.c.
const A4 = distribute([{ ...W1, Ga: ga('4') }, { ...W2, Ga: ga('4') }]);
// Line B (bypass): the strength design, 6" o.c. and 4" o.c.
const B = distribute([{ ...W1, Ga: ga('6') }, { ...W2, Ga: ga('4') }]);
const vA = A3.V.map((x, i) => 0.7 * x * 1000 / [6, 12][i]);
const vB = B.V.map((x, i) => 0.7 * x * 1000 / [6, 12][i]);
const R = [psf * 6 * h / 2000, psf * 12 * h / 2000];
const TA = A3.V.map((x, i) => 0.7 * x * h / [6, 12][i] - a.up * R[i]);
const CA = A3.V.map((x, i) => a.dn * R[i] + 0.7 * x * h / [6, 12][i]);
const cap2 = postCap(P2, h).cap, cap3 = postCap(P3, h).cap;
const dxA = Cd * A3.delta / Ie, dx4 = Cd * A4.delta / Ie, dxB = Cd * B.delta / Ie;
const rMax = Math.max(A3.s[0].rPerK * A3.V[0], A3.s[1].rPerK * A3.V[1], B.s[0].rPerK * B.V[0], B.s[1].rPerK * B.V[1]);
const L_ = (name, row) => ({ ...row, line: name });

export default {
  id: 'V16', title: 'Drift sizing and the drift bypass', slug: 'drift-sizing-bypass',
  intent: 'A 10 ft story whose strength design fails drift (Cd 5, RC II). Deflection distribution gives the two walls different strength nailing (6" and 4" o.c.). Line A (check): drift sizing gives every auto wall of the story ONE common pattern — first the heaviest (4"), then one heavier per pass — so both walls end at 3" o.c., governed by drift, and the story passes; Line C shows the next lighter common pattern (4" on both, manual) fails. Line B (per-line bypass): the strength nailing is kept, drift NG is reported but does not fail the line.',
  covers: ['Drift sizing — common pattern per story (user rule 2026-09-29)', 'Per-line drift bypass', 'Deflection distribution', 'ASCE 7-22 §12.8.6 / Table 12.12-1'],
  handCalc: [
    'Each wall is a spring: δ_i = c_i·V_i. With V_i in kips, h = 10 ft, E = 1,700,000 psi: c = 8,000,000/(E·A·L²) + h/(L·G_a) + (h/L)·[δ_HD·(1000h/L)/cap + 0.02·(1000h/L)/(A·625)/0.73]. Walls: SW-1 L = 6 ft (HDUE3, (2)2x4 A = 10.5), SW-2 L = 12 ft (HDUE5, (3)2x4 A = 15.75). Deflection distribution → V_i = V·k_i/Σk, k_i = 1/c_i, and every wall has δ = V/Σk.',
    'Line A final (3" o.c., G_a = 22): c_1 = ' + f4(A3.s[0].t1) + ' + ' + f4(A3.s[0].t2) + ' + ' + f4(A3.s[0].t3) + ' = ' + f4(A3.s[0].c) + ' in/k; c_2 = ' + f4(A3.s[1].t1) + ' + ' + f4(A3.s[1].t2) + ' + ' + f4(A3.s[1].t3) + ' = ' + f4(A3.s[1].c) + ' in/k → k = ' + f3(1 / A3.s[0].c) + ' / ' + f3(1 / A3.s[1].c) + ' k/in, Σk = ' + f3(A3.K) + '.',
    'Shares V_1 = 10 × ' + f3(1 / A3.s[0].c) + '/' + f3(A3.K) + ' = ' + f3(A3.V[0]) + ' k, V_2 = ' + f3(A3.V[1]) + ' k. δ = V/Σk = 10/' + f3(A3.K) + ' = ' + f4(A3.delta) + ' in at both walls. (Largest crushing ratio r = ' + f3(rMax) + ' < 0.73, so δ is linear in V.)',
    'Hardware at these shares: T = 0.7·V·h/L − 0.46·R_D → SW-1 ' + f3(TA[0]) + ' k (HDUE3, 3790 lb), SW-2 ' + f3(TA[1]) + ' k > 3.79 → HDUE5 (5375 lb). C = 1.14·R_D + 0.7·V·h/L → SW-1 ' + f3(CA[0]) + ' k ≤ (2)2x4 ' + f2(cap2) + ' k; SW-2 ' + f3(CA[1]) + ' k > ' + f2(cap2) + ' → (3)2x4 ' + f2(cap3) + ' k.',
    'Strength alone at these shares: v_1 = 0.7 × ' + f3(A3.V[0]) + ' × 1000/6 = ' + f2(vA[0]) + ' plf → ' + pickNail(vA[0]).label + '; v_2 = 0.7 × ' + f3(A3.V[1]) + ' × 1000/12 = ' + f2(vA[1]) + ' plf → ' + pickNail(vA[1]).label + '. The walls differ for strength, so the rule first makes them equal at the heavier (4"), then steps both up.',
    'Line A drift: δx = Cd·δ/Ie = 5 × ' + f4(A3.delta) + ' = ' + f3(dxA) + ' in ≤ Δa = 0.020 × 10 × 12 = ' + f3(Da) + ' in → OK. Both walls: nailing 3" o.c., basis drift, strength nailing kept as 6" / 4". D/C at 3" (611 plf): ' + f3(vA[0] / 611) + ' / ' + f3(vA[1] / 611) + '.',
    'One lighter common pattern (Line C, 4" o.c. on both, G_a = 20, same hardware): c_1 = ' + f4(A4.s[0].c) + ', c_2 = ' + f4(A4.s[1].c) + ' in/k → Σk = ' + f3(A4.K) + ', δ = ' + f4(A4.delta) + ' in → δx = ' + f3(dx4) + ' > ' + f3(Da) + ' in → NG. So 3" is the lightest common pattern that passes.',
    'Line B (bypass), strength design 6" (G_a 16) / 4" (G_a 20): c_1 = ' + f4(B.s[0].c) + ', c_2 = ' + f4(B.s[1].c) + ' in/k → V_1 = ' + f3(B.V[0]) + ', V_2 = ' + f3(B.V[1]) + ' k (v = ' + f2(vB[0]) + ' / ' + f2(vB[1]) + ' plf → 6" / 4", consistent), δ = ' + f4(B.delta) + ' in → δx = ' + f3(dxB) + ' > ' + f3(Da) + ' in → drift NG, reported only (bypass): nailing stays 6" / 4", basis strength.',
    'Tolerance note: the engine stops the deflection distribution once the wall δ are within 5 % ((δmax − δmin)/δmax). Line A converges to 0.2 %, so its shares and δx match the closed form closely; Line B stops at ~4.5 %, so its δx (from the largest wall δ) is compared with a ±5 % tolerance.',
    'Line checks G1–G12 pass on all three lines (drift is not a G check).',
  ],
  expect: [
    L_('Line A', ex('SW-1 share V (1.0E)', 'wall:SW-1', 'shareExact_1E', A3.V[0], 3, 0.01)),
    L_('Line A', ex('SW-1 nailing (drift sized)', 'wall:SW-1', 'nailing.id', '3', 6)),
    L_('Line A', ex('SW-2 nailing (drift sized)', 'wall:SW-2', 'nailing.id', '3', 6)),
    L_('Line A', ex('SW-1 basis', 'wall:SW-1', 'nailingBasis', 'drift', 6)),
    L_('Line A', ex('SW-1 strength nailing', 'wall:SW-1', 'strengthNailing.id', pickNail(vA[0]).id, 5)),
    L_('Line A', ex('SW-2 strength nailing', 'wall:SW-2', 'strengthNailing.id', pickNail(vA[1]).id, 5)),
    L_('Line A', ex('SW-2 holdown', 'wall:SW-2', 'anchorageLeft.id', 'HDUE5', 4)),
    L_('Line A', ex('SW-2 end post', 'wall:SW-2', 'postLeft.postLabel', '(3)2x4', 4)),
    L_('Line A', ex('Line A δx (in)', 'drift:Level 1', 'seismic.deltaX', dxA, 6, 0.01)),
    L_('Line A', ex('Line A drift passes', 'drift:Level 1', 'seismic.pass', true, 6)),
    L_('Line C', ex('Line C (4" both) drift fails', 'drift:Level 1', 'seismic.pass', false, 7)),
    L_('Line B', ex('SW-3 nailing (bypass, strength)', 'wall:SW-3', 'nailing.id', '6', 8)),
    L_('Line B', ex('SW-4 nailing (bypass, strength)', 'wall:SW-4', 'nailing.id', '4', 8)),
    L_('Line B', ex('SW-4 basis', 'wall:SW-4', 'nailingBasis', 'strength', 8)),
    L_('Line B', ex('Line B δx (in)', 'drift:Level 1', 'seismic.deltaX', dxB, 8, 0.05 * dxB)),
    L_('Line B', ex('Line B drift NG (reported)', 'drift:Level 1', 'seismic.pass', false, 8)),
    L_('Line B', ex('Line B drift mode', 'line', 'driftSizing.mode', 'bypass', 8)),
  ],
  expectChecks: { fail: [] },
  notChecked: 'The engine pass-by-pass path (how many sizing steps); only the final state is hand checked.',
  inputs: project({
    sds: String(Sds), cd: String(Cd), ie: String(Ie), riskCategory: 'II', driftRow: 'other', distribution: 'deflection',
    wallDLTypes: [{ id: 'wdt-1', name: 'Stud wall', psf: String(psf) }],
    levels: [level('lvl-1', 'Level 1', h)],
    directions: [direction('dir-1', 'N-S', [
      line({ id: 'ln-1', name: 'Line A', totalLength: 30, levelLoads: { 'lvl-1': { seismic: String(V), wind: '' } }, gravityLoads: { 'lvl-1': { loads: [] } },
        walls: [wall('w-1', 'SW-1', 'lvl-1', 0, 6), wall('w-2', 'SW-2', 'lvl-1', 16, 12)] }),
      line({ id: 'ln-2', name: 'Line B', driftBypass: 'bypass', totalLength: 30, levelLoads: { 'lvl-1': { seismic: String(V), wind: '' } }, gravityLoads: { 'lvl-1': { loads: [] } },
        walls: [wall('w-3', 'SW-3', 'lvl-1', 0, 6), wall('w-4', 'SW-4', 'lvl-1', 16, 12)] }),
      line({ id: 'ln-3', name: 'Line C', totalLength: 30, levelLoads: { 'lvl-1': { seismic: String(V), wind: '' } }, gravityLoads: { 'lvl-1': { loads: [] } },
        walls: [wall('w-5', 'SW-5', 'lvl-1', 0, 6, { nailingPattern: '4' }), wall('w-6', 'SW-6', 'lvl-1', 16, 12, { nailingPattern: '4' })] }),
    ])],
  }),
};
