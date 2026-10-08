// D04b — two point loads (I), a load on part of an overhang (general form), a part over a support (K)
import { buildModel, ex, case4, case8, overhangRight, add, f4 } from './lib.mjs';

const inputs = buildModel({
  levels: [['Roof', 2.58]],
  dirs: [{ name: 'E-W', lines: 'A B', dias: [{ lv: 'Roof', mark: 'D1', L: 25, x1: 0, x2: 20,
    parts: [[0, 20, 10], [21, 3, 6], [15, 10, 4]], pl: [[5, 1.0, 'manual P1'], [14, 0.5, 'manual P2']], s1: 'A', s2: 'B' }] }],
});
const q = 0.01, l = 20; // ΣA = 200 + 18 + 40 = 258 sf; 2.58 / 258
const p1 = case4(q * 10, 0, 20, 0);
const p2 = overhangRight(q * 6 * 3, 2.5, l);                              // 21–24: W 0.18 at x̄ 22.5 → e = 2.5
const p3 = add(case4(q * 4, 15, 5, 0), overhangRight(q * 4 * 5, 2.5, l)); // 15–20 + 20–25
const pl = add(case8(1.0, 5, 15), case8(0.5, 14, 6));
const [R1, R2] = add(p1, p2, p3, pl);

export default {
  id: 'D04b', slug: 'points-overhang-over-support',
  title: 'Two point loads, a partial overhang load and a part over a support',
  intent: 'The remaining combinations: two manual point loads in the span (Case 10 = Case 8 × 2), a part on only part of the overhang (general overhang form, not Case 25), and a part that runs over R2 (cut into a Case 4 piece and an overhang piece).',
  covers: ['Case 8 × 2 (Case 10)', 'Partial overhang piece (general form)', 'Part over a support (K)', 'Manual P: Σ lines = F_x + ΣP'],
  handCalc: [
    { step: 1, text: 'ΣA = 20·10 + 3·6 + 10·4 = 258 sf → q = 2.58 / 258 = 0.01 k/sf; l = 20 ft, overhang 5 ft.' },
    { step: 2, text: 'Part 1 (0–20, w 100 plf, Case 1): R1 = R2 = ' + f4(p1[0]) + ' k.' },
    { step: 3, text: 'Part 2 (21–24, w 60 plf): W = 0.18 k at e = 2.5 ft past R2 → R1 = −W·e/l = ' + f4(p2[0]) + ', R2 = W(l + e)/l = ' + f4(p2[1]) + ' k.' },
    { step: 4, text: 'Part 3 (15–25, w 40 plf) cut at R2: 15–20 Case 4 (a/b/c 15/5/0) + 20–25 overhang (e 2.5) → R1 = ' + f4(p3[0]) + ', R2 = ' + f4(p3[1]) + ' k.' },
    { step: 5, text: 'P1 = 1.0 k at 5, P2 = 0.5 k at 14 (Case 8 each): R1 = ' + f4(pl[0]) + ', R2 = ' + f4(pl[1]) + ' k.' },
    { step: 6, text: 'R1 = ' + f4(R1) + ', R2 = ' + f4(R2) + ' k; Σ = ' + f4(R1 + R2) + ' = F_x 2.58 + ΣP 1.5.' },
  ],
  expect: [
    ex('R.D1 R1 (k)', 'dia:E-W/R.D1', 'R1', R1, 6), ex('R.D1 R2 (k)', 'dia:E-W/R.D1', 'R2', R2, 6),
    ex('R.D1 R_P at R1 (k)', 'dia:E-W/R.D1', 'R1P', pl[0], 5),
    ex('Σ reactions to lines (k)', 'level:E-W/Roof', 'sumToLines', 4.08, 6),
    ex('Part 2 piece region', 'dia:E-W/R.D1', 'rows[1].region', 'right', 3),
  ],
  expectChecks: { fail: [] },
  inputs,
};
