// V05 — nailing boundary: v exactly at 312 plf, just above it, and beyond the heaviest pattern (2B)
import { project, level, direction, line, wall, ex, pickNail, NAIL, pickHD, postCap, POSTS4, f2, f3 } from '../../cases/src/lib.mjs';

const h = 8, L = 7;                                  // h/b = 1.14 → C_hb = 1.0
const cases = [
  { name: 'Line A', mark: 'SW-1', V: 3.12 },          // v = 0.7 × 3120 / 7 = 312.0 plf = 6" capacity
  { name: 'Line B', mark: 'SW-2', V: 3.13 },          // v = 313 plf
  { name: 'Line C', mark: 'SW-3', V: 18 },            // v = 1800 plf > 2B 1600 plf
];
for (const c of cases) {
  c.v = 0.7 * c.V * 1000 / L;
  c.n = pickNail(c.v) || NAIL[NAIL.length - 1];
  c.dc = c.v / c.n.E;
  c.T = 0.7 * c.V * h / L;                          // no self-weight (wall DL blank)
}
const C3 = cases[2];
const hd3 = pickHD(C3.T);
const post3 = POSTS4.filter(p => p.d2 >= 5.5).find(p => postCap(p, h).cap >= C3.T); // HDUE17 minimum post 6x4

export default {
  id: 'V05', title: 'Nailing selection at the boundaries', slug: 'nailing-boundary',
  intent: 'Three one-wall lines whose unit shear sits exactly at the 6" o.c. capacity (312 plf), 1 plf above it, and above the heaviest pattern (2" o.c. both sides, 1600 plf). Proves "lightest pattern with v ≤ v_cap" including equality, the step to the next pattern, and that past the table the heaviest pattern is used with D/C > 1 (the wall is NG, the equilibrium checks still pass).',
  covers: ['SDPWS 2021 Table 4.3A + footnote 10', 'nailing auto-selection (≤ is OK)', 'D/C > 1 at the heaviest pattern', 'G11 nailing trace'],
  handCalc: [
    'One story h = ' + h + ' ft; each line has one wall L = ' + L + ' ft (h/b = ' + f2(h / L) + ' ≤ 2, C_hb = 1.0), no gravity. ASD unit shear v = 0.7·V / L.',
    'Line A: V = ' + cases[0].V + ' k → v = 0.7 × ' + cases[0].V * 1000 + ' / ' + L + ' = ' + f2(cases[0].v) + ' plf = 312 plf → 6" o.c. passes (v ≤ v_cap), D/C = 1.000.',
    'Line B: V = ' + cases[1].V + ' k → v = 0.7 × ' + cases[1].V * 1000 + ' / ' + L + ' = ' + f2(cases[1].v) + ' plf > 312 → 6" NG; 4" o.c. 470 plf → D/C = ' + f3(cases[1].dc) + '.',
    'Line C: V = ' + C3.V + ' k → v = 0.7 × ' + C3.V * 1000 + ' / ' + L + ' = ' + f2(C3.v) + ' plf > 1600 plf (2" o.c. both sides, the heaviest) → heaviest pattern used, D/C = ' + f2(C3.v) + ' / 1600 = ' + f3(C3.dc) + ' → NG.',
    'Line C overturning: T = C = 0.7 × V × h / L = 0.7 × ' + C3.V + ' × ' + h + ' / ' + L + ' = ' + f3(C3.T) + ' k → ' + hd3.id + ' (' + hd3.cap + ' lb).',
    'Line C end post: ' + hd3.id + ' minimum post 6x4; at ' + h + ' ft 6x4 = ' + f2(postCap(POSTS4[4], h).cap) + ' k < ' + f3(C3.T) + ', 8x4 = ' + f2(postCap(POSTS4[5], h).cap) + ' k → ' + post3.id + '.',
  ],
  expect: [
    ex('Line A SW-1 unit shear (plf)', 'wall:SW-1', 'unitShear_seismic', cases[0].v, 2, 0.01),
    ex('Line A SW-1 nailing', 'wall:SW-1', 'nailing.id', '6', 2),
    ex('Line A SW-1 D/C', 'wall:SW-1', 'dcRatio', 1.0, 2, 0.006),
    ex('Line B SW-2 unit shear (plf)', 'wall:SW-2', 'unitShear_seismic', cases[1].v, 3, 0.01),
    ex('Line B SW-2 nailing', 'wall:SW-2', 'nailing.id', '4', 3),
    ex('Line B SW-2 D/C', 'wall:SW-2', 'dcRatio', cases[1].dc, 3, 0.006),
    ex('Line C SW-3 nailing', 'wall:SW-3', 'nailing.id', '2B', 4),
    ex('Line C SW-3 D/C', 'wall:SW-3', 'dcRatio', C3.dc, 4, 0.006),
    ex('Line C SW-3 governing T left (k)', 'wall:SW-3', 'governingTensionLeft', C3.T, 5),
    ex('Line C SW-3 holdown left', 'wall:SW-3', 'anchorageLeft.id', hd3.id, 5),
    ex('Line C SW-3 end post right', 'wall:SW-3', 'postRight.postLabel', post3.id, 6),
  ].map((r, i) => ({ ...r, line: cases[i < 3 ? 0 : i < 6 ? 1 : 2].name })),
  expectChecks: { fail: [] },
  notChecked: 'D/C is compared at ± 0.006 because the engine stores dcRatio rounded to 0.01 (line C: 1.125 is stored as 1.13). Line A is at the capacity in floating point (0.7 × 3.12 × 1000 / 7 = 311.99999…), so it shows the ≤ rule and not a tolerance.',
  inputs: project({
    levels: [level('lvl-1', 'Level 1', h)],
    directions: [direction('dir-1', 'N-S', cases.map((c, i) => line({ id: 'ln-' + (i + 1), name: c.name, totalLength: 12,
      levelLoads: { 'lvl-1': { seismic: String(c.V), wind: '' } }, gravityLoads: { 'lvl-1': { loads: [] } },
      walls: [wall('w-' + (i + 1), c.mark, 'lvl-1', 2, L, { wallDLTypeId: '' })] })))],
  }),
};
