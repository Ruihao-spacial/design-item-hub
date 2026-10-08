// D03 — overhangs on both sides; the left reaction reverses
import { buildModel, ex, case4, overhangRight, overhangLeft, add, f2, f4 } from './lib.mjs';

const inputs = buildModel({
  levels: [['Roof', 3]],
  dirs: [{ name: 'E-W', lines: 'A B', dias: [{ lv: 'Roof', mark: 'D1', L: 30, x1: 4, x2: 12, parts: 10, s1: 'A', s2: 'B' }] }],
});
const q = 3 / 300, w = q * 10, l = 8;
const left = overhangLeft(w * 4, 2, l), span = case4(w, 0, 8, 0), right = overhangRight(w * 18, 9, l);
const [R1, R2] = add(left, span, right);

export default {
  id: 'D03', slug: 'overhangs-both-sides',
  title: 'Overhangs on both sides — a reaction reverses',
  intent: 'A 30 ft diaphragm on supports at 4 and 12 ft (4 ft overhang left, 18 ft right). The long right overhang lifts R1: its reaction is negative (reverses) and line A gets a negative force. ΣR still equals ΣW.',
  covers: ['Overhangs left + right (E)', 'General overhang form (e past the support)', 'Negative reaction kept with its sign'],
  handCalc: [
    { step: 1, text: 'ΣA = 30 × 10 = 300 sf → q = 3 / 300 = 0.01 k/sf; w = ' + f2(w * 1000) + ' plf; l = 12 − 4 = 8 ft.' },
    { step: 2, text: 'Left overhang 0–4: W = 0.4 k at e = 2 ft past R1 → R1 = W(l + e)/l = ' + f4(left[0]) + ', R2 = −W·e/l = ' + f4(left[1]) + ' k.' },
    { step: 3, text: 'Back span 4–12 (Case 1): R1 = R2 = ' + f4(span[0]) + ' k.' },
    { step: 4, text: 'Right overhang 12–30: W = 1.8 k at e = 9 ft past R2 → R1 = −W·e/l = ' + f4(right[0]) + ', R2 = W(l + e)/l = ' + f4(right[1]) + ' k.' },
    { step: 5, text: 'R1 = ' + f4(R1) + ' k (reverses), R2 = ' + f4(R2) + ' k; ΣR = ' + f4(R1 + R2) + ' = ΣW = 3.0 k.' },
  ],
  expect: [
    ex('R.D1 R1 (k)', 'dia:E-W/R.D1', 'R1', R1, 5),
    ex('R.D1 R2 (k)', 'dia:E-W/R.D1', 'R2', R2, 5),
    ex('R1 reverses', 'dia:E-W/R.D1', 'supports[0].reverses', true, 5),
    ex('Line R.A F (k)', 'line:E-W/R.A', 'F', R1, 5),
  ],
  expectChecks: { fail: [] },
  inputs,
};
