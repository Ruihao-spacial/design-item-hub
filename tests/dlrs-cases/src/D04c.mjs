// D04c — case M: a 3-part split on a beam with an overhang (L + J), and its mirror
import { buildModel, ex, case4, overhangRight, overhangLeft, add, f4 } from './lib.mjs';

const inputs = buildModel({
  levels: [['Roof', 7]],
  dirs: [
    { name: 'E-W', lines: 'A B', dias: [{ lv: 'Roof', mark: 'D1', L: 25, x1: 0, x2: 20, parts: [[0, 20, 30], [20, 5, 10], [15, 10, 5]], s1: 'A', s2: 'B' }] },
    { name: 'N-S', lines: '1 2', dias: [{ lv: 'Roof', mark: 'D1', L: 25, x1: 5, x2: 25, parts: [[5, 20, 30], [0, 5, 10], [0, 10, 5]], s1: '1', s2: '2' }] },
  ],
});
const q = 0.01, l = 20; // ΣA = 600 + 50 + 50 = 700 sf
const r = add(case4(q * 30, 0, 20, 0), overhangRight(q * 10 * 5, 2.5, l), case4(q * 5, 15, 5, 0), overhangRight(q * 5 * 5, 2.5, l));
const m = add(case4(q * 30, 0, 20, 0), overhangLeft(q * 10 * 5, 2.5, l), case4(q * 5, 0, 5, 15), overhangLeft(q * 5 * 5, 2.5, l));

export default {
  id: 'D04c', slug: 'split-with-overhang',
  title: 'Split into 3 parts on a beam with an overhang (case M) and its mirror',
  intent: 'The worked example of the plan: part 1 in the back span, part 2 only on the overhang, part 3 over the support. E-W has the overhang on the right; N-S has the same diaphragm mirrored (overhang on the left), so R1 and R2 swap.',
  covers: ['Case M = L + J', 'Mirror (left overhang)', 'Case 1 / Case 4 / Case 25 per piece'],
  handCalc: [
    { step: 1, text: 'ΣA = 20·30 + 5·10 + 10·5 = 700 sf → q = 7 / 700 = 0.01 k/sf; l = 20, overhang 5 ft.' },
    { step: 2, text: 'Part 1 (Case 1, w 300 plf): 3.0000 / 3.0000 k. Part 2 (overhang only, Case 25, W 0.5 k, e 2.5): −0.0625 / 0.5625 k.' },
    { step: 3, text: 'Part 3: span piece 15–20 (Case 4, w 50 plf) 0.03125 / 0.21875 k + overhang piece 20–25 (Case 25) −0.03125 / 0.28125 k.' },
    { step: 4, text: 'E-W: R1 = ' + f4(r[0]) + ', R2 = ' + f4(r[1]) + ' k. N-S mirror: R1 = ' + f4(m[0]) + ', R2 = ' + f4(m[1]) + ' k.' },
  ],
  expect: [
    ex('E-W R.D1 R1 (k)', 'dia:E-W/R.D1', 'R1', r[0], 4), ex('E-W R.D1 R2 (k)', 'dia:E-W/R.D1', 'R2', r[1], 4),
    ex('N-S R.D1 R1 (k)', 'dia:N-S/R.D1', 'R1', m[0], 4), ex('N-S R.D1 R2 (k)', 'dia:N-S/R.D1', 'R2', m[1], 4),
    ex('E-W pieces (rows)', 'dia:E-W/R.D1', 'rows.length', 4, 3),
  ],
  expectChecks: { fail: [] },
  inputs,
};
