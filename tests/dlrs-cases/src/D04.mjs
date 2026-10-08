// D04 — partial uniform, stepped depth along the span (H) and a diaphragm split into 3 parts (L)
import { buildModel, ex, case4, add, f4 } from './lib.mjs';

const inputs = buildModel({
  levels: [['Roof', 6.55]],
  dirs: [{ name: 'E-W', lines: 'A B C D', dias: [
    { lv: 'Roof', mark: 'D1', L: 20, parts: [[0, 12, 30], [12, 8, 10]], s1: 'A', s2: 'B' },
    { lv: 'Roof', mark: 'D2', L: 12, parts: [[0, 12, 8], [0, 6, 4], [3, 9, 5]], s1: 'B', s2: 'C' },
    { lv: 'Roof', mark: 'D3', L: 10, parts: [[2, 5, 10]], s1: 'C', s2: 'D' },
  ] }],
});
const q = 0.01; // ΣA = 360 + 80 + 96 + 24 + 45 + 50 = 655 sf; 6.55 / 655
const d1 = add(case4(q * 30, 0, 12, 8), case4(q * 10, 12, 8, 0));
const d2 = add(case4(q * 8, 0, 12, 0), case4(q * 4, 0, 6, 6), case4(q * 5, 3, 9, 0));
const d3 = case4(q * 10, 2, 5, 3);

export default {
  id: 'D04', slug: 'partial-stepped-split',
  title: 'Partial uniform, stepped depth and a 3-part split (Case 4 × N)',
  intent: 'R.D1 changes depth along its span (30 ft deep for 12 ft, then 10 ft). R.D2 is split into three strips with different a / b / c over the same 12 ft span. R.D3 is loaded on part of its span only. Every part is a Case 4 load; the reactions are their sums.',
  covers: ['Case 4 (partial uniform)', 'Stepped depth (H)', 'Split into N parts (L): a_i + b_i + c_i = L'],
  handCalc: [
    { step: 1, text: 'ΣA = 12·30 + 8·10 + 12·8 + 6·4 + 9·5 + 5·10 = 655 sf → q = 6.55 / 655 = 0.01 k/sf.' },
    { step: 2, text: 'R.D1 (l = 20): part 1 a/b/c = 0/12/8, w 300 plf; part 2 = 12/8/0, w 100 plf. Case 4: R1 = Σ w·b(2c + b)/(2l) = ' + f4(d1[0]) + ', R2 = Σ w·b(2a + b)/(2l) = ' + f4(d1[1]) + ' k.' },
    { step: 3, text: 'R.D2 (l = 12): parts 0/12/0 w 80, 0/6/6 w 40, 3/9/0 w 50 plf → R1 = ' + f4(d2[0]) + ', R2 = ' + f4(d2[1]) + ' k.' },
    { step: 4, text: 'R.D3 (l = 10): a/b/c = 2/5/3, w 100 plf → R1 = ' + f4(d3[0]) + ', R2 = ' + f4(d3[1]) + ' k.' },
  ],
  expect: [
    ex('R.D1 R1 (k)', 'dia:E-W/R.D1', 'R1', d1[0], 2), ex('R.D1 R2 (k)', 'dia:E-W/R.D1', 'R2', d1[1], 2),
    ex('R.D2 R1 (k)', 'dia:E-W/R.D2', 'R1', d2[0], 3), ex('R.D2 R2 (k)', 'dia:E-W/R.D2', 'R2', d2[1], 3),
    ex('R.D3 R1 (k)', 'dia:E-W/R.D3', 'R1', d3[0], 4), ex('R.D3 R2 (k)', 'dia:E-W/R.D3', 'R2', d3[1], 4),
    ex('Line R.B F (k)', 'line:E-W/R.B', 'F', d1[1] + d2[0], 3),
  ],
  expectChecks: { fail: [] },
  inputs,
};
