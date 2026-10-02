// V12 — unsupported gravity: a full-line load over gaps with nothing below is noted and excluded; a point
// load on a post top goes into the post
import { project, level, direction, line, wall, post, gFull, gPoint, ex, pickNail, pickHD, postCap, POSTS4, asdE, f2, f3, SEISMIC, eq431, storyDrift, driftExpect } from './lib.mjs';

const Sds = 1.0, a = asdE(Sds), psf = 10, h = 10, Ltot = 30, Lw = 8;
const V = 4, wD = 100, wL = 200;                  // full line D 100 / L 200 plf
const PD = 3, PL = 1.5, xP = 12;                  // point load on the top of post P-5 at x = 12
// Walls SW-9 (0–8) and SW-10 (16–24): equal → V/2 each
const Vw = V / 2, v = 0.7 * Vw * 1000 / Lw, n = pickNail(v);
const D = wD * Lw / 1000 + psf * Lw * h / 1000, R = D / 2, LL = wL * Lw / 1000, RL = LL / 2;
const N = Vw * h / Lw;
const T = 0.7 * N - a.up * R;
const Cs = { e5: a.dn * R + 0.7 * N, e6: a.d6 * R + 0.75 * RL + 0.525 * N, dl: R + RL };
const C = Math.max(...Object.values(Cs));
// Gaps with nothing below: 8–16 and 24–30
const gap = (16 - 8) + (Ltot - 24), gapD = wD * gap / 1000, gapL = wL * gap / 1000;
// Post P-5: gravity only
const Cp = { dl: PD + PL, e6: a.d6 * PD + 0.75 * PL, e5: a.dn * PD };
const Cpost = Math.max(...Object.values(Cp));
const pst = POSTS4.filter(p => p.d2 >= 3.0).find(p => postCap(p, h).cap >= Cpost); // base HDUE3 (T = 0) → minimum (2)2x4
// 1.0D bookkeeping
const applied = 2 * psf * Lw * h / 1000 + wD * Ltot / 1000 + PD, found = 2 * D + PD;
// Story drift (Cd 4, Ie 1.0, RC II): two equal walls → equal δ (1.0E is lateral only, gravity does not enter Eq. 4.3-1)
const w431 = (mark) => eq431({ mark, L: Lw, h, nail: '6', hdL: 'HDUE3', hdR: 'HDUE3', postL: '(2)2x4', postR: '(2)2x4', Vk: Vw, TL: N, CR: N });
const d1 = storyDrift('Level 1', h, [w431('SW-9'), w431('SW-10')]);

export default {
  id: 'V12', title: 'Unsupported gravity and a point load on a post', slug: 'unsupported-gravity',
  intent: 'A full-line floor load runs over two walls and over two gaps with nothing below (8–16 ft and 24–30 ft): the gap parts are reported as "not carried" and the gravity checks count them as excluded, not failed. A point load at x = 12 ft sits on the top of support post P-5 and goes down the post to the foundation. The walls get only the load directly above them.',
  covers: ['Gravity split: over a wall / on a post / over nothing', 'Audit note gravity_unsupported (excluded in G4 / G8)', 'Post gravity from a point load', 'ASCE 7-22 §2.4.1 (2) D + L and §2.4.5 (6) with live load'],
  handCalc: [
    'Story shear V = ' + V + ' k to two equal walls (8 ft, same nailing) → ' + f2(Vw) + ' k each; v = 0.7 × ' + Vw * 1000 + ' / ' + Lw + ' = ' + f2(v) + ' plf → ' + n.label + '.',
    'Each wall carries the load directly above it: D = ' + wD + ' plf × ' + Lw + ' ft + ' + psf + ' psf × ' + Lw + ' × ' + h + ' = ' + f2(D) + ' k → ' + f2(R) + ' k per end; L = ' + wL + ' × ' + Lw + ' = ' + f2(LL) + ' k → ' + f2(RL) + ' k per end. N_E = ' + Vw + ' × ' + h + ' / ' + Lw + ' = ±' + f2(N) + ' k.',
    'Uplift (0.6 − 0.14S_DS)D + 0.7E: ' + f2(a.up) + ' × ' + f2(R) + ' − 0.7 × ' + f2(N) + ' = ' + f3(-T) + ' → T = ' + f3(T) + ' k → ' + pickHD(T).id + '.',
    'Compression: (5) ' + f2(a.dn) + ' × ' + f2(R) + ' + 0.7 × ' + f2(N) + ' = ' + f3(Cs.e5) + ' k; (6) ' + f3(a.d6) + ' × ' + f2(R) + ' + 0.75 × ' + f2(RL) + ' + 0.525 × ' + f2(N) + ' = ' + f3(Cs.e6) + ' k; D + L = ' + f3(Cs.dl) + ' k → C = ' + f3(C) + ' k — combination (6) with live load governs.',
    'Gaps: the full-line load over ' + gap + ' ft (8–16 and 24–30) has no wall, beam or post below → D ' + f2(gapD) + ' k and L ' + f2(gapL) + ' k are not carried (two audit notes).',
    'Post P-5 (x = ' + xP + ', 10 ft): D ' + PD + ' k, L ' + PL + ' k. ASD: D + L = ' + f3(Cp.dl) + ' k; (6) ' + f3(a.d6) + ' × ' + PD + ' + 0.75 × ' + PL + ' = ' + f3(Cp.e6) + ' k; (5) = ' + f3(Cp.e5) + ' k; the Ω₀ combinations have no E on the post (same values) → C = ' + f3(Cpost) + ' k. Base T = 0 → HDUE3 (lightest), minimum post (2)2x4 → ' + pst.id + ' (cap ' + f2(postCap(pst, h).cap) + ' k).',
    'G8 1.0D balance: applied = wall self-weight 2 × ' + f2(psf * Lw * h / 1000) + ' + line load ' + wD + ' × ' + Ltot + ' / 1000 + point ' + PD + ' = ' + f2(applied) + ' k; foundation = 2 × ' + f2(D) + ' + ' + PD + ' = ' + f2(found) + ' k; excluded = ' + f2(gapD) + ' k → ' + f2(found) + ' + ' + f2(gapD) + ' = ' + f2(applied) + ' k, balanced → G1–G12 pass.',
    d1.gov.text + ' SW-10 is identical (same length, share and pinned design) → equal δ; the first listed governs.',
    d1.text,
  ],
  expect: [
    ex('SW-9 dead load (k)', 'wall:SW-9', 'dlTotal', D, 2),
    ex('SW-9 live load (k)', 'wall:SW-9', 'live.L.total', LL, 2),
    ex('SW-9 governing T, left (k)', 'wall:SW-9', 'governingTensionLeft', T, 3),
    ex('SW-9 governing C, right (k)', 'wall:SW-9', 'governingComprRight', C, 4),
    ex('SW-10 governing C, left (k)', 'wall:SW-10', 'governingComprLeft', C, 4),
    ex('Audit notes', 'line', 'loadPathAudit.notes.length', 2, 5, 0),
    ex('Audit note 1: gravity not carried', 'line', 'loadPathAudit.notes[0].type', 'gravity_unsupported', 5),
    ex('Audit note 2: gravity not carried', 'line', 'loadPathAudit.notes[1].type', 'gravity_unsupported', 5),
    ex('P-5 envelope C (k)', 'post:P-5', 'envelopeC', Cpost, 6),
    ex('P-5 envelope T (k)', 'post:P-5', 'envelopeT', 0, 6),
    ex('P-5 lands on', 'post:P-5', 'receiver.type', 'foundation', 6),
    ...driftExpect(d1, 9),
  ],
  expectChecks: { fail: [] },
  notChecked: 'Post P-5 deflection (posts are not part of Eq. 4.3-1).',
  // Design pinned as manual overrides (method case): the engine picks at calc v13, frozen 2026-09-30
  pins: {"SW-9":{"nail":"6","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"},"SW-10":{"nail":"6","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"},"P-5":{"post":"(2)2x4","hd":"HDUE3"}},
  inputs: project({
    sds: String(Sds), ...SEISMIC, wallDLTypes: [{ id: 'wdt-1', name: 'Stud wall', psf: String(psf) }],
    levels: [level('lvl-1', 'Level 1', h)],
    directions: [direction('dir-1', 'N-S', [line({ totalLength: Ltot,
      levelLoads: { 'lvl-1': { seismic: String(V), wind: '' } },
      gravityLoads: { 'lvl-1': { loads: [gFull('g1', wD, wL, ''), gPoint('g2', xP, PD, PL, '')] } },
      walls: [wall('w-9', 'SW-9', 'lvl-1', 0, Lw), wall('w-10', 'SW-10', 'lvl-1', 16, Lw)],
      supportPosts: [post('sp-5', 'P-5', 'lvl-1', xP)] })])],
  }),
};
