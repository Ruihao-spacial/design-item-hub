// D06 — manual point load: extra load on top of F_x
import { buildModel, ex, case4, case8, add, f4 } from './lib.mjs';

const inputs = buildModel({
  levels: [['Roof', 4]],
  dirs: [{ name: 'E-W', lines: 'A B', dias: [{ lv: 'Roof', mark: 'D1', L: 16, parts: 25, pl: [[4, 1.2, 'rooftop unit, not in F_x']], s1: 'A', s2: 'B' }] }],
});
const r = add(case4(0.25, 0, 16, 0), case8(1.2, 4, 12));

export default {
  id: 'D06', slug: 'manual-point-load',
  title: 'Manual point load (extra load)',
  intent: 'A manual point load is added on top of F_x. The level check becomes Σ line reactions = F_x + ΣP, and the summary shows ΣF = F_x + manual P.',
  covers: ['Manual P (Case 8)', 'D2 with manual P'],
  handCalc: [
    { step: 1, text: 'ΣA = 16 × 25 = 400 sf → q = 0.01 k/sf, w = 250 plf: Case 1 → 2.0 / 2.0 k.' },
    { step: 2, text: 'P = 1.2 k at a = 4, b = 12 (Case 8): 0.9 / 0.3 k → R1 = ' + f4(r[0]) + ', R2 = ' + f4(r[1]) + ' k; Σ = 5.2 = F_x 4.0 + P 1.2.' },
  ],
  expect: [
    ex('R.D1 R1 (k)', 'dia:E-W/R.D1', 'R1', r[0], 2), ex('R.D1 R2 (k)', 'dia:E-W/R.D1', 'R2', r[1], 2),
    ex('Σ manual P at the level (k)', 'level:E-W/Roof', 'sumManual', 1.2, 2),
    ex('ΣF at the level (k)', 'level:E-W/Roof', 'sumF', 5.2, 2),
  ],
  expectChecks: { fail: [] },
  inputs,
};
