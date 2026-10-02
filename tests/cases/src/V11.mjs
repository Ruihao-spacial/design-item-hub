// V11 — beam Point supports: one over nothing (reaction only, reported), one over a wall end below
// (the reaction is added to that wall end per combination)
import { project, level, direction, line, wall, beam, ex, pickHD, asdE, f2, f3, SEISMIC, eq431, storyDrift, driftExpect } from './lib.mjs';

const Sds = 1.0, a = asdE(Sds), psf = 10;
const hT = 9, hB = 10;
const xa = 0, xb = 12, span = xb - xa;          // BM-2 0–12 ft, Point supports at 0 and 12
const x0 = 2, LW = 6, x1 = x0 + LW;             // SW-7 on the beam 2–8 ft
const F_roof = 2, F_1 = 3;
const DW = psf * LW * hT / 1000, RW = DW / 2, NW = F_roof * hT / LW;
const loads = { D: [[RW, x0], [RW, x1]], E: [[-NW, x0], [NW, x1]] };
const Rb = (c) => loads[c].reduce((s, [P, x]) => s + P * (x - xa) / span, 0);
const Rs = (c) => loads[c].reduce((s, [P]) => s + P, 0);
const RbD = Rb('D'), RaD = Rs('D') - RbD, RbE = Rb('E'), RaE = Rs('E') - RbE;
// Support a: reaction only
const Ta = -(a.up * RaD + 0.7 * RaE), Ca = a.dn * RaD - 0.7 * RaE;
// SW-8 below (12–22 ft): its left end at x = 12 receives R_b
const L8 = 10, V8 = F_roof + F_1, D8 = psf * L8 * hB / 1000, R8 = D8 / 2, N8 = V8 * hB / L8;
// left end N per combination = own + R_b, same combination key (→ = _pos for both)
const comb = {
  e8p: (a.up * R8 - 0.7 * N8) + (a.up * RbD + 0.7 * RbE), e5p: (a.dn * R8 - 0.7 * N8) + (a.dn * RbD + 0.7 * RbE),
  e6p: (a.d6 * R8 - 0.525 * N8) + (a.d6 * RbD + 0.525 * RbE),
  e8n: (a.up * R8 + 0.7 * N8) + (a.up * RbD - 0.7 * RbE), e5n: (a.dn * R8 + 0.7 * N8) + (a.dn * RbD - 0.7 * RbE),
  e6n: (a.d6 * R8 + 0.525 * N8) + (a.d6 * RbD - 0.525 * RbE),
};
const T8L = Math.max(0, ...Object.values(comb).map(v => -v)), C8L = Math.max(0, ...Object.values(comb));
const T8own = 0.7 * N8 - a.up * R8, C8own = a.dn * R8 + 0.7 * N8;   // right end: own only
// Story drift (Cd 4, Ie 1.0, RC II). SW-7 on the beam (beam deflection not included, tool rule P5). SW-8: 1.0E → left end
// tension = own N8 − R_b,E (the beam reaction is compression there), right end compression = own N8; 1.0E is lateral
// only, so ← is the exact mirror (left compression N8 − R_b,E, right tension N8)
const dR = storyDrift('Roof', hT, [eq431({ mark: 'SW-7', L: LW, h: hT, nail: '6', hdL: 'MSTC40', hdR: 'MSTC40', postL: '(2)2x4', postR: '(2)2x4', Vk: F_roof, TL: NW, CR: NW })]);
const d1 = storyDrift('Level 1', hB, [eq431({ mark: 'SW-8', L: L8, h: hB, nail: '4', hdL: 'HDUE3', hdR: 'HDUE3', postL: '(2)2x4', postR: '(2)2x4', Vk: V8, TL: N8 - RbE, CR: N8 })]);

export default {
  id: 'V11', title: 'Beam point supports — reaction only / over a wall end', slug: 'beam-point-support',
  intent: 'Beam BM-2 (0–12 ft) carries SW-7 (2–8 ft) on two Point supports. The support at x = 0 has nothing below it: its reaction is reported for external design ("reaction only" note) and leaves the load path. The support at x = 12 sits exactly on the left end of SW-8 below: that reaction is added to the SW-8 left end per combination, so its uplift drops and its compression changes; the SW-8 right end keeps its own values.',
  covers: ['Point support types', 'Reaction only (reported, excluded from the checks)', 'Point support over a wall end → added to that end', 'Per-combination superposition at a wall end'],
  handCalc: [
    'SW-7 (L = ' + LW + ' ft, h = ' + hT + ' ft, V = ' + F_roof + ' k): D = ' + psf + ' × ' + LW + ' × ' + hT + ' = ' + f2(DW) + ' k → ' + f2(RW) + ' k per end; N_E = ' + F_roof + ' × ' + hT + ' / ' + LW + ' = ±' + f2(NW) + ' k.',
    'BM-2 1.0D: R_b = (' + f2(RW) + ' × ' + x0 + ' + ' + f2(RW) + ' × ' + x1 + ') / ' + span + ' = ' + f3(RbD) + ' k; R_a = ' + f2(Rs('D')) + ' − ' + f3(RbD) + ' = ' + f3(RaD) + ' k.',
    'BM-2 1.0E →: R_b = (−' + f2(NW) + ' × ' + x0 + ' + ' + f2(NW) + ' × ' + x1 + ') / ' + span + ' = ' + f3(RbE) + ' k; R_a = ' + f3(RaE) + ' k.',
    'Support a (x = 0, nothing below): reaction only. T = −(' + f2(a.up) + ' × ' + f3(RaD) + ' + 0.7 × (' + f3(RaE) + ')) = ' + f3(Ta) + ' k; C = ' + f2(a.dn) + ' × ' + f3(RaD) + ' + 0.7 × ' + f3(-RaE) + ' = ' + f3(Ca) + ' k — design the support externally.',
    'SW-8 (Level 1, 12–22 ft, V = ' + V8 + ' k): D = ' + psf + ' × ' + L8 + ' × ' + hB + ' = ' + f2(D8) + ' k → ' + f2(R8) + ' k per end; N_E = ' + V8 + ' × ' + hB + ' / ' + L8 + ' = ±' + f2(N8) + ' k. Own (right end): T = ' + f3(T8own) + ' k, C = ' + f3(C8own) + ' k.',
    'SW-8 left end load cases incl. R_b: 1.0D = ' + f2(R8) + ' + ' + f3(RbD) + ' = ' + f3(R8 + RbD) + ' k; 1.0E → = −' + f2(N8) + ' + ' + f3(RbE) + ' = ' + f3(-N8 + RbE) + ' k.',
    'SW-8 left end uplift, (0.6 − 0.14S_DS)D + 0.7E →: [' + f2(a.up) + ' × ' + f2(R8) + ' − 0.7 × ' + f2(N8) + '] + [' + f2(a.up) + ' × ' + f3(RbD) + ' + 0.7 × ' + f3(RbE) + '] = ' + f3(comb.e8p) + ' → T = ' + f3(T8L) + ' k (was ' + f3(T8own) + ' k without the beam) → ' + pickHD(T8L).id + '.',
    'SW-8 left end compression, (1.0 + 0.14S_DS)D + 0.7E ←: [' + f2(a.dn) + ' × ' + f2(R8) + ' + 0.7 × ' + f2(N8) + '] + [' + f2(a.dn) + ' × ' + f3(RbD) + ' − 0.7 × ' + f3(RbE) + '] = ' + f3(comb.e5n) + ' k → C = ' + f3(C8L) + ' k.',
    'Checks: the support-a reaction leaves the model (listed as reaction only → excluded); everything else reaches the foundation → G1–G12 pass.',
    dR.gov.text + ' (beam deflection under SW-7 not included, tool rule P5)',
    dR.text,
    'SW-8 1.0E → end forces for Eq. 4.3-1: left tension T = N_E − R_b,E = ' + f3(N8) + ' − ' + f3(RbE) + ' = ' + f3(N8 - RbE) + ' k, right compression C = ' + f3(N8) + ' k (← is the mirror). ' + d1.gov.text,
    d1.text,
  ],
  expect: [
    ex('BM-2 R_a 1.0D (k)', 'beam:BM-2', 'supports[0].perCombo["1.0D"]', RaD, 2),
    ex('BM-2 R_b 1.0D (k)', 'beam:BM-2', 'supports[1].perCombo["1.0D"]', RbD, 2),
    ex('BM-2 R_b 1.0E → (k)', 'beam:BM-2', 'supports[1].perCombo["1.0E"]', RbE, 3),
    ex('BM-2 support a: reaction only', 'beam:BM-2', 'supports[0].receiver.type', 'reported', 4),
    ex('BM-2 support a envelope T (k)', 'beam:BM-2', 'supports[0].envelopeT', Ta, 4),
    ex('BM-2 support a envelope C (k)', 'beam:BM-2', 'supports[0].envelopeC', Ca, 4),
    ex('BM-2 support b lands on a wall end', 'beam:BM-2', 'supports[1].receiver.type', 'wall_end', 6),
    ex('SW-8 left 1.0D incl. R_b (k)', 'wall:SW-8', 'lc["1.0D"].left', R8 + RbD, 6),
    ex('SW-8 left 1.0E → incl. R_b (k)', 'wall:SW-8', 'lc["1.0E →"].left', -N8 + RbE, 6),
    ex('SW-8 left T with R_b (k)', 'wall:SW-8', 'hwDemand.tL', T8L, 7),
    ex('SW-8 left C with R_b (k)', 'wall:SW-8', 'hwDemand.cL', C8L, 8),
    ex('SW-8 right T, own only (k)', 'wall:SW-8', 'hwDemand.tR', T8own, 5),
    ex('SW-8 right C, own only (k)', 'wall:SW-8', 'hwDemand.cR', C8own, 5),
    ex('Audit note: reaction only', 'line', 'loadPathAudit.notes[0].type', 'reaction_reported', 4),
    ...driftExpect(dR, 11),
    ...driftExpect(d1, 13),
  ],
  expectChecks: { fail: [] },
  notChecked: 'Beam member design; support-a hardware (reaction only, none selected).',
  // Design pinned as manual overrides (method case): the engine picks at calc v13, frozen 2026-09-30
  pins: {"SW-7":{"nail":"6","hdL":"MSTC40","hdR":"MSTC40","postL":"(2)2x4","postR":"(2)2x4"},"SW-8":{"nail":"4","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"},"BM-2":{"support1":"MSTC28"}},
  inputs: project({
    sds: String(Sds), ...SEISMIC, wallDLTypes: [{ id: 'wdt-1', name: 'Stud wall', psf: String(psf) }],
    levels: [level('lvl-1', 'Roof', hT), level('lvl-2', 'Level 1', hB)],
    directions: [direction('dir-1', 'N-S', [line({ totalLength: 24,
      levelLoads: { 'lvl-1': { seismic: String(F_roof), wind: '' }, 'lvl-2': { seismic: String(F_1), wind: '' } },
      gravityLoads: { 'lvl-1': { loads: [] }, 'lvl-2': { loads: [] } },
      walls: [wall('w-7', 'SW-7', 'lvl-1', x0, LW), wall('w-8', 'SW-8', 'lvl-2', 12, L8)],
      beams: [beam('bm-2', 'BM-2', 'lvl-1', xa, span, [['bs-1', xa, 'point'], ['bs-2', xb, 'point']])] })])],
  }),
};
