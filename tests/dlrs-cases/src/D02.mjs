// D02 — overhang on one side, full uniform (Case 24 = back span + overhang)
import { buildModel, ex, case4, overhangRight, add, f2, f4 } from './lib.mjs';

const inputs = buildModel({
  levels: [['Roof', 5]],
  dirs: [{ name: 'E-W', lines: 'A B', dias: [{ lv: 'Roof', mark: 'D1', L: 25, x1: 0, x2: 20, parts: 20, s1: 'A', s2: 'B' }] }],
});
const q = 5 / (25 * 20), w = q * 20, l = 20, a = 5;
const span = case4(w, 0, 20, 0), oh = overhangRight(w * a, a / 2, l);
const [R1, R2] = add(span, oh);

export default {
  id: 'D02', slug: 'overhang-one-side',
  title: 'Overhang on one side, full uniform (Case 24)',
  intent: 'One diaphragm 25 ft long on supports at 0 and 20 ft: a 5 ft cantilever past R2. The part is cut at R2 into a back-span piece (Case 1) and an overhang piece (Case 25); the sum must equal the Case 24 closed form.',
  covers: ['Overhang right', 'Cut at the support', 'Case 1 + Case 25 = Case 24'],
  handCalc: [
    { step: 1, text: 'ΣA = 25 × 20 = 500 sf → q = 5 / 500 = 0.01 k/sf; w = q·d = 0.01 × 20 = ' + f2(w * 1000) + ' plf.' },
    { step: 2, text: 'Back span 0–20 (Case 1): R1 = R2 = w·l/2 = ' + f4(span[0]) + ' k.' },
    { step: 3, text: 'Overhang 20–25 (Case 25): R1 = −w·a²/(2l) = ' + f4(oh[0]) + ', R2 = w·a(2l + a)/(2l) = ' + f4(oh[1]) + ' k.' },
    { step: 4, text: 'Total R1 = ' + f4(R1) + ', R2 = ' + f4(R2) + ' k. Case 24: R1 = w(l² − a²)/(2l) = ' + f4(w * (l * l - a * a) / (2 * l)) + ', R2 = w(l + a)²/(2l) = ' + f4(w * (l + a) ** 2 / (2 * l)) + ' k — the same.' },
  ],
  expect: [
    ex('R.D1 R1 → R.A (k)', 'dia:E-W/R.D1', 'R1', R1, 4),
    ex('R.D1 R2 → R.B (k)', 'dia:E-W/R.D1', 'R2', R2, 4),
    ex('Line R.B (k)', 'line:E-W/R.B', 'V', R2, 4),
    ex('Overhang piece region', 'dia:E-W/R.D1', 'rows[1].region', 'right', 3),
  ],
  expectChecks: { fail: [] },
  inputs,
};
