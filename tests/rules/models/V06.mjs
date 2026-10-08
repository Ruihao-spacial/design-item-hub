// V06 — hardware boundaries: HDUE at / just above a catalog capacity, MSTC straps with 16 / 18 / 24" floor clear span,
// and an OVER case (T above the heaviest HDUE)
import { project, level, direction, line, wall, ex, pickHD, f2, f3, f4 } from '../../cases/src/lib.mjs';

// Local strap tables (Floor to Floor Strap Catalog: ASD cap, lb) — 18" and 24" clear span; 16" is MSTC16 in lib
const MSTC = {
  '16': [['MSTC28', 1535], ['MSTC40', 3070], ['MSTC52', 4610], ['MSTC66', 5850]],
  '18': [['MSTC28', 1150], ['MSTC40', 2690], ['MSTC52', 4225], ['MSTC66', 5850]],
  '24': [['MSTC40', 1920], ['MSTC52', 3455], ['MSTC66', 5375], ['MSTC78', 5850]],
};
const strap = (Tk, span) => { const r = MSTC[span].find(([, cap]) => cap >= Tk * 1000); return r ? { id: r[0], cap: r[1] } : null; };

const hU = 10, h1 = 14, L = 10;                      // upper stories 10 ft, bottom story 14 ft; walls 10 ft, no self-weight
// Line S: four aligned walls, 1.0E = 2 k at Level 4 only → V = 2 k at every story
const F = 2;
const Nu = 0.7 * F * hU / L, N1 = 0.7 * F * h1 / L;  // ASD (0.7E, no dead load) end force of each wall's own shear
const T4 = Nu, T3 = 2 * Nu, T2 = 3 * Nu, T1 = 3 * Nu + N1;  // accumulated down the aligned ends
const s4 = strap(T4, '16'), s3 = strap(T3, '18'), s2 = strap(T2, '24'), hd1 = pickHD(T1);
const s3at16 = strap(T3, '16');
// Lines H1 / H2 / O: one 10 ft wall at the 14 ft bottom story: T = 0.7 × V × 14 / 10 = 0.98 V
const VH1 = 3.867, VH2 = 3.868, VO = 19;
const TH1 = 0.7 * VH1 * h1 / L, TH2 = 0.7 * VH2 * h1 / L, TO = 0.7 * VO * h1 / L;
const hdH1 = pickHD(TH1), hdH2 = pickHD(TH2), hdO = pickHD(TO);

const rows = [
  ['Line S', ex('SW-1 (Level 4) T (k)', 'wall:SW-1', 'governingTensionLeft', T4, 2)],
  ['Line S', ex('SW-1 strap (16" span)', 'wall:SW-1', 'anchorageLeft.id', s4.id, 2)],
  ['Line S', ex('SW-2 (Level 3) accumulated T (k)', 'wall:SW-2', 'hwDemand.tL', T3, 3)],
  ['Line S', ex('SW-2 strap (18" span)', 'wall:SW-2', 'anchorageLeft.id', s3.id, 3)],
  ['Line S', ex('SW-3 (Level 2) accumulated T (k)', 'wall:SW-3', 'hwDemand.tL', T2, 4)],
  ['Line S', ex('SW-3 strap (24" span)', 'wall:SW-3', 'anchorageLeft.id', s2.id, 4)],
  ['Line S', ex('SW-4 (Level 1) accumulated T (k)', 'wall:SW-4', 'hwDemand.tL', T1, 5)],
  ['Line S', ex('SW-4 holdown', 'wall:SW-4', 'anchorageLeft.id', hd1.id, 5)],
  ['Line H1', ex('SW-5 T (k)', 'wall:SW-5', 'governingTensionLeft', TH1, 6)],
  ['Line H1', ex('SW-5 holdown at the capacity', 'wall:SW-5', 'anchorageLeft.id', hdH1.id, 6)],
  ['Line H2', ex('SW-6 T (k)', 'wall:SW-6', 'governingTensionLeft', TH2, 7)],
  ['Line H2', ex('SW-6 holdown just above', 'wall:SW-6', 'anchorageLeft.id', hdH2.id, 7)],
  ['Line O', ex('SW-7 T (k)', 'wall:SW-7', 'governingTensionLeft', TO, 8)],
  ['Line O', ex('SW-7 holdown OVER (none)', 'wall:SW-7', 'anchorageLeft', null, 8)],
  ['Line O', ex('SW-7 end post OVER (none)', 'wall:SW-7', 'postRight', null, 9)],
].map(([ln, r]) => ({ ...r, line: ln }));

const oneWall = (i, name, mark, V) => line({ id: 'ln-' + i, name, totalLength: 12, levelLoads: { 'lvl-1': { seismic: String(V), wind: '' } },
  gravityLoads: {}, walls: [wall('w-' + i, mark, 'lvl-1', 1, L, { wallDLTypeId: '' })] });

export default {
  id: 'V06', title: 'Hardware selection at the catalog boundaries', slug: 'hardware-boundaries',
  intent: 'Proves the holdown / strap rules at their edges: the lightest HDUE with cap ≥ T (equal-ish and just above HDUE3), MSTC straps at upper floors picked from the table of that floor\'s clear span (16, 18, 24"), accumulation of T down aligned wall ends, and the OVER result when T exceeds HDUE17.',
  covers: ['HDUE catalog (ASD cap)', 'MSTC catalog by floor clear span 16 / 18 / 24"', 'straps at upper floors (anchorage auto)', 'aligned-end accumulation', 'OVER reporting'],
  handCalc: [
    'Levels: Level 4 / 3 / 2 are 10 ft with floor clear span 16", 18", 24"; Level 1 (bottom) is 14 ft. Anchorage "auto": upper floors use MSTC straps (table of that floor\'s clear span), the bottom uses HDUE. Walls 10 ft, no self-weight, so every ASD uplift is 0.7E: T = 0.7·V·h / L.',
    'Line S, SW-1 (Level 4): V = ' + F + ' k, T = 0.7 × ' + F + ' × ' + hU + ' / ' + L + ' = ' + f2(T4) + ' k → 16" table: MSTC28 1535 lb ≥ ' + Math.round(T4 * 1000) + ' → ' + s4.id + '.',
    'SW-2 (Level 3): own ' + f2(Nu) + ' + from SW-1 above ' + f2(T4) + ' = ' + f2(T3) + ' k (same combination, aligned ends) → 18" table: MSTC28 1150, MSTC40 2690 < ' + Math.round(T3 * 1000) + ' → ' + s3.id + ' (4225 lb). With the 16" table it would have been ' + s3at16.id + ' — the span matters.',
    'SW-3 (Level 2): ' + f2(Nu) + ' + ' + f2(T3) + ' = ' + f2(T2) + ' k → 24" table: MSTC40 1920, MSTC52 3455 < ' + Math.round(T2 * 1000) + ' → ' + s2.id + ' (5375 lb).',
    'SW-4 (Level 1, 14 ft): own 0.7 × ' + F + ' × ' + h1 + ' / ' + L + ' = ' + f2(N1) + ' + ' + f2(T2) + ' = ' + f2(T1) + ' k → HDUE5 5375 < ' + Math.round(T1 * 1000) + ' → ' + hd1.id + ' (7015 lb).',
    'Line H1, SW-5: V = ' + VH1 + ' k → T = 0.7 × ' + VH1 + ' × ' + h1 + ' / ' + L + ' = ' + f4(TH1) + ' k = ' + f2(TH1 * 1000) + ' lb ≤ 3790 → ' + hdH1.id + ' (D/C ' + f4(TH1 * 1000 / 3790) + ').',
    'Line H2, SW-6: V = ' + VH2 + ' k → T = ' + f4(TH2) + ' k = ' + f2(TH2 * 1000) + ' lb > 3790 → ' + hdH2.id + ' (5375 lb).',
    'Line O, SW-7: V = ' + VO + ' k → v = 0.7 × ' + VO * 1000 + ' / ' + L + ' = 1330 plf → 2" o.c. both sides; T = 0.7 × ' + VO + ' × ' + h1 + ' / ' + L + ' = ' + f2(TO) + ' k > HDUE17 17685 lb → no holdown: the engine reports OVER (anchorage = null), the wall status is NG, and there is no deflection (no slip value).',
    'Line O end post: C = ' + f2(TO) + ' k > 8x4 at 14 ft (6.82 k), the heaviest 4" post → OVER (post = null). OVER is NG (user rule 2026-09-29): G10 fails on Line O with rows "OVER — no anchorage carries T" and "OVER — no end post carries C"; the other lines pass.',
  ],
  expect: rows,
  expectChecks: { fail: ['Line O:G10'] }, // OVER holdown and post on Line O only
  notChecked: 'Posts of lines S / H (auto-sized, see V07). Strap / holdown D/C values (only the selection is checked).',
  inputs: project({
    levels: [level('lvl-4', 'Level 4', hU, { floorClearSpan: '16' }), level('lvl-3', 'Level 3', hU, { floorClearSpan: '18' }),
      level('lvl-2', 'Level 2', hU, { floorClearSpan: '24' }), level('lvl-1', 'Level 1', h1)],
    directions: [direction('dir-1', 'N-S', [
      line({ id: 'ln-s', name: 'Line S', totalLength: 12, levelLoads: { 'lvl-4': { seismic: String(F), wind: '' } }, gravityLoads: {},
        walls: [['SW-1', 'lvl-4'], ['SW-2', 'lvl-3'], ['SW-3', 'lvl-2'], ['SW-4', 'lvl-1']].map(([m, lv], i) => wall('w-s' + i, m, lv, 1, L, { wallDLTypeId: '' })) }),
      oneWall(5, 'Line H1', 'SW-5', VH1), oneWall(6, 'Line H2', 'SW-6', VH2), oneWall(7, 'Line O', 'SW-7', VO),
    ])],
  }),
};
