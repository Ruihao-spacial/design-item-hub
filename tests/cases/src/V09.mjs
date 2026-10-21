// V09 — offset stack: an upper wall whose ends land mid-wall below. Line A: no post (warning, no transfer).
// Line B: the same with a support post under each end (post carries the end to the foundation).
import { project, level, direction, line, wall, post, ex, pickNail, pickHD, pickStrap, postCap, POSTS4, asdE, f2, f3, SEISMIC, eq431, storyDrift, driftExpect } from './lib.mjs';

const Sds = 1.0, a = asdE(Sds), psf = 10, O = 2.5;          // Ω₀ default 2.5
const hT = 9, hB = 10, LU = 8, LL = 16, xU = 4;             // upper wall 4–12 over lower wall 0–16
const F_roof = 2, F_1 = 3, VT = F_roof, VB = F_roof + F_1;
// Upper wall (self-weight only)
const vU = 0.7 * VT * 1000 / LU, nU = pickNail(vU);
const DU = psf * LU * hT / 1000, RU = DU / 2, NU = VT * hT / LU;
const TU = 0.7 * NU - a.up * RU, CU = a.dn * RU + 0.7 * NU;
const CU_O = a.dn * RU + 0.7 * O * NU;                       // Ω₀ ASD (5): (1.0+0.14SDS)D + 0.7Ω₀E
// Lower wall (self-weight only) — unchanged by the upper wall in both lines
const vL = 0.7 * VB * 1000 / LL, nL = pickNail(vL);
const DL = psf * LL * hB / 1000, RL = DL / 2, NL = VB * hB / LL;
const TL = 0.7 * NL - a.up * RL, CL = a.dn * RL + 0.7 * NL;
const hdL = pickHD(TL);
// Line B posts: base at the foundation → HDUE for T; member for max(ASD C, Ω₀ ASD C)
const hdP = pickHD(TU);
const Cpost = Math.max(CU, CU_O);
const pst = POSTS4.filter(p => p.d2 >= 3.0).find(p => postCap(p, hB).cap >= Cpost);
// Story drift (Cd 4, Ie 1.0, RC II), pinned design, both lines alike: nothing transfers into the lower wall (Line A: no
// post; Line B: the posts take the upper ends), so each wall's Eq. 4.3-1 uses only its own N = V·h/L and its own self-weight
// R (1.0D + 0.5L + 1.0E, no live load)
const eU = (m) => eq431({ mark: m, L: LU, h: hT, nail: '6', hdL: 'MSTC28', hdR: 'MSTC28', postL: '(2)2x4', postR: '(2)2x4', Vk: VT, TL: NU, CR: NU });
const eL = (m) => eq431({ mark: m, L: LL, h: hB, nail: '6', hdL: 'HDUE3', hdR: 'HDUE3', postL: '(2)2x4', postR: '(2)2x4', Vk: VB, TL: NL, CR: NL });
const dr = (s) => ({ roof: storyDrift('Roof', hT, [eU('SW-' + s + '1')]), l1: storyDrift('Level 1', hB, [eL('SW-' + s + '2')]) });
const dA = dr('A'), dB = dr('B');

const walls = (s) => [wall('w-' + s + '1', 'SW-' + s + '1', 'lvl-1', xU, LU), wall('w-' + s + '2', 'SW-' + s + '2', 'lvl-2', 0, LL)];
const ln = (id, name, s, posts) => line({ id, name, totalLength: LL,
  levelLoads: { 'lvl-1': { seismic: String(F_roof), wind: '' }, 'lvl-2': { seismic: String(F_1), wind: '' } },
  gravityLoads: { 'lvl-1': { loads: [] }, 'lvl-2': { loads: [] } }, walls: walls(s), supportPosts: posts });

export default {
  id: 'V09', title: 'Offset stack with and without a post', slug: 'offset-stack-post',
  intent: 'An upper wall (x = 4–12 ft) sits on a longer wall below (0–16 ft), so both upper ends land mid-wall. Tool rule: a wall end transfers only where it aligns with a wall end below (±0.1 ft); a mid-wall end needs a post. Line A has no post: warning, nothing is transferred, the lower wall is designed for its own load only. Line B adds a post under each upper end: the post carries the end force to the foundation (base holdown, post member for max(ASD, Ω₀ ASD)) and the lower wall is still unchanged.',
  covers: ['Wall end transfer rule (aligned ends only)', 'Mid-wall end → warning, no transfer', 'Support post at any story', 'Post base HDUE', 'Support post member max(ASD, Ω₀ ASD) (ASCE 7-22 §12.3.3.3)'],
  handCalc: [
    'Both lines: Roof V_T = ' + F_roof + ' k (upper wall, L = ' + LU + ' ft, h = ' + hT + ' ft); Level 1 V_B = ' + VB + ' k (lower wall, L = ' + LL + ' ft, h = ' + hB + ' ft). Self-weight only (' + psf + ' psf).',
    'Upper wall: v = 0.7 × ' + VT * 1000 + ' / ' + LU + ' = ' + f2(vU) + ' plf → ' + nU.label + '. D = ' + psf + ' × ' + LU + ' × ' + hT + ' = ' + f2(DU) + ' k → R = ' + f2(RU) + ' k; N_E = ' + VT + ' × ' + hT + ' / ' + LU + ' = ±' + f3(NU) + ' k.',
    'Upper wall ends: T = 0.7 × ' + f3(NU) + ' − ' + f2(a.up) + ' × ' + f2(RU) + ' = ' + f3(TU) + ' k; C = ' + f2(a.dn) + ' × ' + f2(RU) + ' + 0.7 × ' + f3(NU) + ' = ' + f3(CU) + ' k (same at both ends by symmetry).',
    'Lower wall (own load only): v = 0.7 × ' + VB * 1000 + ' / ' + LL + ' = ' + f2(vL) + ' plf → ' + nL.label + '. D = ' + psf + ' × ' + LL + ' × ' + hB + ' = ' + f2(DL) + ' k → R = ' + f2(RL) + ' k; N_E = ' + VB + ' × ' + hB + ' / ' + LL + ' = ±' + f3(NL) + ' k.',
    'Lower wall: T = 0.7 × ' + f3(NL) + ' − ' + f2(a.up) + ' × ' + f2(RL) + ' = ' + f3(TL) + ' k → ' + hdL.id + '; C = ' + f2(a.dn) + ' × ' + f2(RL) + ' + 0.7 × ' + f3(NL) + ' = ' + f3(CL) + ' k.',
    'Line A: upper ends at x = 4 and 12 land inside the lower wall (0–16), no post → warning "add a post below", no transfer: the lower wall keeps T = ' + f3(TL) + ' / C = ' + f3(CL) + ' k.',
    'Line B: posts P-B1 (x = 4) and P-B2 (x = 12) in the Level 1 story each receive one upper end: envelope T = ' + f3(TU) + ' k, C = ' + f3(CU) + ' k. The lower wall is unchanged (T = ' + f3(TL) + ' k).',
    'Post base at the foundation: T = ' + f3(TU) + ' k → ' + hdP.id + '. Post member: Ω₀ ASD (5) = ' + f2(a.dn) + ' × ' + f2(RU) + ' + 0.7 × ' + O + ' × ' + f3(NU) + ' = ' + f3(CU_O) + ' k > ASD ' + f3(CU) + ' k → design C = ' + f3(Cpost) + ' k → ' + pst.id + ' at ' + hB + ' ft (cap ' + f2(postCap(pst, hB).cap) + ' k, HDUE3 minimum (2)2x4).',
    'Checks: Line A loses the upper end forces (listed by the audit, excluded, not failed); Line B carries everything to the foundation → G1–G12 pass on both lines.',
    'Upper wall (both lines) — ' + eU('SW-A1 / SW-B1').text,
    'Lower wall (both lines; no end force from above: Line A no post, Line B on the posts) — ' + eL('SW-A2 / SW-B2').text,
    'Both lines: ' + dA.roof.text.replace('SW-A1', 'SW-A1 / SW-B1'),
    'Both lines: ' + dA.l1.text.replace('SW-A2', 'SW-A2 / SW-B2'),
  ],
  expect: [
    ex('Upper wall T, left (k) — Line A', 'wall:SW-A1', 'governingTensionLeft', TU, 3),
    ex('Upper wall C, right (k) — Line A', 'wall:SW-A1', 'governingComprRight', CU, 3),
    { ...ex('Lower wall T, left (k) — Line A, no transfer', 'wall:SW-A2', 'governingTensionLeft', TL, 6), line: 'Line A' },
    { ...ex('Lower wall 1.0D left = own R only (nothing from above) — Line A', 'wall:SW-A2', 'lc["1.0D"].left', RL, 6), line: 'Line A' },
    { ...ex('Lower wall T, left (k) — Line B, unchanged', 'wall:SW-B2', 'governingTensionLeft', TL, 7), line: 'Line B' },
    { ...ex('Lower wall C, right (k) — Line B, unchanged', 'wall:SW-B2', 'governingComprRight', CL, 7), line: 'Line B' },
    { ...ex('P-B1 envelope T (k)', 'post:P-B1', 'envelopeT', TU, 7), line: 'Line B' },
    { ...ex('P-B1 envelope C (k)', 'post:P-B1', 'envelopeC', CU, 7), line: 'Line B' },
    { ...ex('P-B1 member design C (k)', 'post:P-B1', 'postDesignC', Cpost, 8), line: 'Line B' },
    { ...ex('P-B1 member governed by', 'post:P-B1', 'postGoverns', 'Ω₀ ASD', 8), line: 'Line B' },
    { ...ex('P-B2 lands on', 'post:P-B2', 'receiver.type', 'foundation', 7), line: 'Line B' },
    { ...ex('Lower wall δ at 1.0E, own forces only (in) — Line A', 'wall:SW-A2', 'deflection.E.delta', dA.l1.dxe, 11, 0.0005), line: 'Line A' },
    ...driftExpect(dA.roof, 12, 'Line A'), ...driftExpect(dA.l1, 13, 'Line A'),
    ...driftExpect(dB.roof, 12, 'Line B'), ...driftExpect(dB.l1, 13, 'Line B'),
  ].map(r => (r.line ? r : { ...r, line: 'Line A' })),
  expectChecks: { fail: [], warnings: ['unsupported_wall'] },
  notChecked: 'The deflection terms one by one (V15); the post does not stiffen the lower wall in the drift calc. The lower wall nailing and posts follow V01.',
  // Design pinned as manual overrides (method case): the engine picks at calc v13, frozen 2026-09-30
  pins: {"Line A/SW-A1":{"nail":"6","hdL":"MSTC28","hdR":"MSTC28","postL":"(2)2x4","postR":"(2)2x4"},"Line A/SW-A2":{"nail":"6","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"},"Line B/SW-B1":{"nail":"6","hdL":"MSTC28","hdR":"MSTC28","postL":"(2)2x4","postR":"(2)2x4"},"Line B/SW-B2":{"nail":"6","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"},"Line B/P-B1":{"post":"(2)2x4","hd":"HDUE3"},"Line B/P-B2":{"post":"(2)2x4","hd":"HDUE3"}},
  inputs: project({
    sds: String(Sds), ...SEISMIC, wallDLTypes: [{ id: 'wdt-1', name: 'Stud wall', psf: String(psf) }],
    levels: [level('lvl-1', 'Roof', hT), level('lvl-2', 'Level 1', hB)],
    directions: [direction('dir-1', 'N-S', [
      ln('ln-a', 'Line A', 'A', []),
      ln('ln-b', 'Line B', 'B', [post('sp-1', 'P-B1', 'lvl-2', xU), post('sp-2', 'P-B2', 'lvl-2', xU + LU)]),
    ])],
  }),
};
