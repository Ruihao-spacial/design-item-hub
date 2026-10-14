// V23 — deflection distribution: a lower short wall rotated by the stack above more than the story deflects takes no
// story shear (finding F-DD1, user rule 2026-09-30: zero share + warning). Same Eq. 4.3-1 as every other wall.
import { project, level, direction, line, wall, ex, HDUE, MSTC16, POSTS4, NAIL, f2, f3, f4 } from './lib.mjs';

const h = 10, E = 1700000, Fcp = 625, V = 5;
const Pp = (id) => POSTS4.find(p => p.id === id), Hd = (id) => HDUE.find(x => x.id === id), Ms = (id) => MSTC16.find(x => x.id === id);
const ga = (id) => NAIL.find(n => n.id === id).gaPLY;
const crush = (r) => 0.02 * (r < 0.73 ? r / 0.73 : r <= 1 ? 1 + (r - 0.73) / 0.27 : 2 * r ** 3);
// SDPWS Eq. 4.3-1 at 1.0E for a wall of length L with its share Vk (k) and the lateral end force from above Tab (lb),
// lateral end forces only (user 2026-10-14): T = C = 1000·V·h/L + Tab (≥ 0). Δ_HD = δ_LRFD × T / T_LRFD (LRFD pair).
function delta(L, Ga, a, p, Vk, Tab) {
  const v = 1000 * Vk / L, T = Math.max(0, 1000 * Vk * h / L + Tab), C = T;
  const t1 = 8 * v * h ** 3 / (E * p.A * L), t2 = v * h / (1000 * Ga), slip = a.delta * T / a.lrfdCap, dc = crush(C / (p.A * Fcp));
  return { t1, t2, slip, dc, t3: h * (slip + dc) / L, d: t1 + t2 + h * (slip + dc) / L };
}
const eqSplit = (fa, fb) => { let lo = 0, hi = V; for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (fa(m) > fb(V - m)) hi = m; else lo = m; } return lo; };
// Level 2: SW-3 8 ft 6" o.c. MSTC66 (3)2x4; SW-4 4 ft 2" o.c. both sides MSTC66 (3)2x4 (nothing above)
const d3 = (x) => delta(8, ga('6'), Ms('MSTC66'), Pp('(3)2x4'), x, 0).d;
const d4 = (x) => delta(4, ga('2B'), Ms('MSTC66'), Pp('(3)2x4'), x, 0).d;
const V3 = eqSplit(d3, d4), V4 = V - V3, dL2 = d3(V3);
const T3 = 1000 * V3 * h / 8, T4 = 1000 * V4 * h / 4;
// Level 1: SW-5 8 ft 2B HDUE13 8x4 (gets T3), SW-6 4 ft 2B HDUE5 (2)2x4 (gets T4)
const s6 = (x) => delta(4, ga('2B'), Hd('HDUE5'), Pp('(2)2x4'), x, T4);
const s5 = (x) => delta(8, ga('2B'), Hd('HDUE13'), Pp('8x4'), x, T3);
const z6 = s6(0), f5 = s5(V);
// Holdown check (user rule 2026-10-01): each larger HDUE on SW-6 at both ends, post raised to its minimum post;
// SW-5 held → SW-6's share at equal δ (0 while δ_6(0) ≥ δ_5(5 k))
const trial = (id, post) => { const f6 = (x) => delta(4, ga('2B'), Hd(id), Pp(post), x, T4).d;
  const d0 = f6(0); return { id, post, d0, share: d0 >= f5.d ? 0 : V - eqSplit((x) => s5(x).d, f6) }; };
// minimum posts of the DF/SP 4" HDUE table (C-C2026): HDUE7 (2)2x4, HDUE9 6x4, HDUE13 8x4, HDUE17 6x4
const rem = [trial('HDUE7', '(2)2x4'), trial('HDUE9', '6x4'), trial('HDUE13', '8x4'), trial('HDUE17', '6x4')];
const first = rem.find(r => r.share > 0) || null;
// Free split (no V ≥ 0 limit, information only): δ_5(V_5) = δ_6(V − V_5) with V_5 in [0, 2V]
let lo = 0, hi = 2 * V;
for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (s5(m).d > s6(V - m).d) hi = m; else lo = m; }
const V5f = lo, V6f = V - lo, dFree = s5(V5f).d;
// Story drift (ASCE 7-22 §12.8.6, Table 12.12-1 RC II): δx = Cd·δxe/Ie with δxe = the largest wall δ at the story
const Cd = 4, Ie = 1.0, Da = 0.020 * h * 12, dx2 = Cd * dL2 / Ie, dx1 = Cd * z6.d / Ie;

export default {
  id: 'V23', title: 'Deflection distribution — a wall with no story shear (rotated by the stack above)', slug: 'zero-share-wall',
  intent: 'Two stories, two walls each (8 ft and 4 ft), 1.0E = 5 k at Level 2. The upper short wall SW-4 is stiffer than SW-3 for its length (2" o.c. both sides vs 6" o.c.), so it takes a large part of Level 2 and sends a large end force down onto the lower short wall SW-6. With that force alone, SDPWS Eq. 4.3-1 already gives SW-6 more deflection than SW-5 deflects carrying the whole story. No equal-δ split with positive shares exists: SW-6 takes no story shear (user rule: zero share + warning), SW-5 takes all 5 k, and the tool warns: SW-6 with its holdown check and the other fixes, and — the big warning — SW-5 carrying more than it is designed for, because at equal δ SW-6 would push back.',
  covers: ['Deflection distribution (equal δ, Σ V = V)', 'SDPWS Eq. 4.3-1 with the end forces from above', 'Zero-share wall warning + holdown check (F-DD1)', 'Free split — walls carrying more than designed'],
  handCalc: [
    'Every wall uses SDPWS Eq. 4.3-1 at 1.0E, lateral end forces only: δ = 8vh³/(EAb) + vh/(1000G_a) + (h/b)·(Δ_HD + Δ_c(r)), v = 1000V/b, T = C = 1000·V·h/b + the end force from above (lb). Δ_HD = δ_LRFD × T / T_LRFD of the holdown / strap (LRFD pairs MSTC66 ' + Ms('MSTC66').delta + ' in / ' + Ms('MSTC66').lrfdCap + ' lb, HDUE5 ' + Hd('HDUE5').delta + ' / ' + Hd('HDUE5').lrfdCap + ', HDUE13 ' + Hd('HDUE13').delta + ' / ' + Hd('HDUE13').lrfdCap + '); r = C/(A·625). Pinned: SW-3 6" o.c. (G_a 16), SW-4 / SW-5 / SW-6 2" o.c. both sides (G_a 56); SW-3 / SW-4 MSTC66 + (3)2x4; SW-5 HDUE13 + 8x4; SW-6 HDUE5 + (2)2x4.',
    'Level 2 (nothing above), equal δ: V_3 = ' + f3(V3) + ' k, V_4 = ' + f3(V4) + ' k, δ = ' + f4(dL2) + ' in. SW-4 takes ' + f2(100 * V4 / V) + ' % of Level 2 on ' + f2(100 * 4 / 12) + ' % of the length. End forces sent down (1.0E): SW-3 → SW-5 T = ' + Math.round(T3) + ' lb, SW-4 → SW-6 T = ' + Math.round(T4) + ' lb.',
    'SW-6 at zero own share (only the force from SW-4: T = C = ' + Math.round(T4) + ' lb): Δ_HD = ' + Hd('HDUE5').delta + ' × ' + Math.round(T4) + ' / ' + Hd('HDUE5').lrfdCap + ' = ' + f4(z6.slip) + ' in, crushing Δ_c = ' + f4(z6.dc) + ' in → δ_6(0) = (10/4) × (' + f4(z6.slip) + ' + ' + f4(z6.dc) + ') = ' + f4(z6.d) + ' in.',
    'SW-5 carrying the whole story (V = 5 k, plus ' + Math.round(T3) + ' lb from SW-3): 8vh³/(EAb) = ' + f4(f5.t1) + ', vh/(1000G_a) = ' + f4(f5.t2) + ', h·Δa/b = ' + f4(f5.t3) + ' → δ_5(5 k) = ' + f4(f5.d) + ' in.',
    'δ_6(0) = ' + f4(z6.d) + ' in > δ_5(5 k) = ' + f4(f5.d) + ' in: even with no shear of its own SW-6 is displaced more than SW-5 carrying all of Level 1. No split with equal δ and V ≥ 0 exists → SW-6 takes 0, SW-5 takes 5 k, story δ = ' + f4(f5.d) + ' in; SW-6 is flagged (zero share). Its drift δ is its zero-share value ' + f4(z6.d) + ' in (the larger).',
    'Holdown check (both ends, post raised to the HDUE minimum post, SW-5 held): ' + rem.map(r => r.id + ' + ' + r.post + ': δ_6(0) = ' + f4(r.d0) + ' in → share ' + f3(r.share) + ' k').join('; ') + '. A larger holdown helps only through a lower δ_LRFD / T_LRFD and a larger minimum post; ' + (first ? 'the lightest giving a share is ' + first.id + ' (' + f3(first.share) + ' k).' : 'none gives SW-6 a share.') + ' Other fixes (listed, not calculated by the tool): a longer SW-6, less force from the stack above, or a less stiff SW-5 (its strength needs only 4" o.c.: 0.7 × 5000 / 8 = 438 plf ≤ 470).',
    'Free split (equal δ without the V ≥ 0 limit, information only; T and C clipped at 0): δ_5(V_5) = δ_6(V − V_5) → V_5 = ' + f3(V5f) + ' k, V_6 = ' + f3(V6f) + ' k (SW-6 pushes back), δ = ' + f4(dFree) + ' in. SW-5 is designed for 5.000 k but would carry ' + f3(V5f) + ' k (+' + f2(100 * (V5f - V) / V) + ' %) → big warning: check SW-5, more wall may be needed. The design keeps the zero share (user rule 2026-10-01).',
    'Story drift (Cd = 4, Ie = 1.0, RC II → Δa = 0.020 × h_sx = 0.020 × 10 × 12 = ' + f3(Da) + ' in): Level 2 δxe = ' + f4(dL2) + ' in (equal δ) → δx = 4 × ' + f4(dL2) + ' / 1.0 = ' + f4(dx2) + ' in ≤ ' + f3(Da) + ' OK; Level 1 δxe = the larger wall δ = SW-6 at zero share ' + f4(z6.d) + ' in → δx = ' + f4(dx1) + ' in ≤ ' + f3(Da) + ' OK. No drift sizing (design pinned). Ω₀ = 2.5 only adds the Ω₀ force tables (not used for design).',
    'Line checks: G3 shows Σ shares = 5 k, SW-5 δ = story δ, and SW-6 δ(0) ≥ story δ; G1–G12 pass.',
  ],
  expect: [
    ex('SW-3 share, Level 2 (k)', 'wall:SW-3', 'shareExact_1E', V3, 2, 0.005),
    ex('SW-4 share, Level 2 (k)', 'wall:SW-4', 'shareExact_1E', V4, 2, 0.005),
    ex('SW-4 δ, Level 2 (in)', 'wall:SW-4', 'deflection.E.delta', dL2, 2, 0.0005),
    ex('SW-6 δ at zero own share (in)', 'line', 'distribution.levels[1].walls[1].delta0', z6.d, 3, 0.0005),
    ex('SW-5 share = the whole story (k)', 'wall:SW-5', 'shareExact_1E', V, 5, 0.001),
    ex('SW-6 share (k)', 'wall:SW-6', 'shareExact_1E', 0, 5, 0.001),
    ex('SW-6 zero share flagged', 'line', 'distribution.levels[1].walls[1].zeroShare', true, 5),
    ex('Story δ, Level 1 (in)', 'line', 'distribution.levels[1].delta', f5.d, 4, 0.0005),
    ex('SW-5 δ (in)', 'wall:SW-5', 'deflection.E.delta', f5.d, 4, 0.0005),
    ex('SW-6 δ, zero share (in)', 'wall:SW-6', 'deflection.E.delta', z6.d, 5, 0.0005),
    ex('Holdown check: HDUE7 share (k)', 'line', 'distribution.levels[1].walls[1].remedy[0].share', rem[0].share, 6, 0.001),
    ...(first ? [ex('Holdown check: lightest giving a share', 'line', 'distribution.levels[1].walls[1].remedyFirst.anchorage', first.id, 6)] : []),
    ex('Holdown check: HDUE9 + 6x4 share (k)', 'line', 'distribution.levels[1].walls[1].remedy[1].share', rem[1].share, 6, 0.002),
    ex('Holdown check: HDUE13 + 8x4 share (k)', 'line', 'distribution.levels[1].walls[1].remedy[2].share', rem[2].share, 6, 0.002),
    ex('Holdown check: HDUE17 + 6x4 share (k)', 'line', 'distribution.levels[1].walls[1].remedy[3].share', rem[3].share, 6, 0.002),
    ex('Free split: SW-5 (k)', 'line', 'distribution.levels[1].walls[0].freeShare', V5f, 7, 0.002),
    ex('Free split: SW-6 (k)', 'line', 'distribution.levels[1].walls[1].freeShare', V6f, 7, 0.002),
    ex('Free split δ (in)', 'line', 'distribution.levels[1].free.delta', dFree, 7, 0.0005),
    ex('Story drift δx, Level 2 (in)', 'line', 'drift.rows[0].seismic.deltaX', dx2, 8, 0.002),
    ex('Story drift δx, Level 1 (in)', 'line', 'drift.rows[1].seismic.deltaX', dx1, 8, 0.002),
    ex('Story drift Level 1 passes', 'line', 'drift.rows[1].seismic.pass', true, 8),
  ],
  expectChecks: { fail: [], warnings: ['dist_zero_share', 'dist_under_load'] },
  notChecked: 'Whether a wall with no story shear, or SW-5 at the free-split share, is acceptable is the engineer\'s judgment: the tool warns (not NG) and does not redesign SW-5. The holdown check is an estimate with SW-5 held; the other fixes are listed, not calculated.',
  // Design pinned as manual overrides (method case)
  pins: {
    'SW-3': { nail: '6', hdL: 'MSTC66', hdR: 'MSTC66', postL: '(3)2x4', postR: '(3)2x4' },
    'SW-4': { nail: '2B', hdL: 'MSTC66', hdR: 'MSTC66', postL: '(3)2x4', postR: '(3)2x4' },
    'SW-5': { nail: '2B', hdL: 'HDUE13', hdR: 'HDUE13', postL: '8x4', postR: '8x4' },
    'SW-6': { nail: '2B', hdL: 'HDUE5', hdR: 'HDUE5', postL: '(2)2x4', postR: '(2)2x4' },
  },
  inputs: project({
    distribution: 'deflection',
    // seismic design inputs (user 2026-10-01): wood structural panel bearing walls, ASCE 7-22 Table 12.2-1 A.15 Cd 4 / Ω₀ 2.5
    // (flexible diaphragm), Ie 1.0, Risk Category II → drift check active (Table 12.12-1 0.020·h_sx) and Ω₀ forces reported
    cd: '4', ie: '1.0', riskCategory: 'II', omega0: '2.5',
    levels: [level('lvl-2', 'Level 2', h), level('lvl-1', 'Level 1', h)],
    directions: [direction('dir-1', 'N-S', [
      line({ name: 'Line A', totalLength: 40, levelLoads: { 'lvl-2': { seismic: String(V), wind: '' } }, gravityLoads: {},
        walls: [wall('w-3', 'SW-3', 'lvl-2', 0, 8), wall('w-4', 'SW-4', 'lvl-2', 20, 4), wall('w-5', 'SW-5', 'lvl-1', 0, 8), wall('w-6', 'SW-6', 'lvl-1', 20, 4)] }),
    ])],
  }),
};
