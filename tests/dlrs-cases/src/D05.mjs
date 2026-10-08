// D05 — chain of three diaphragms; an incoming load at an overhang tip (Case 26)
import { buildModel, ex, case4, case8, overhangRight, add, f4 } from './lib.mjs';

const inputs = buildModel({
  levels: [['Roof', 4]],
  dirs: [{ name: 'E-W', lines: 'A B C D', dias: [
    { lv: 'Roof', mark: 'D3', L: 6, parts: 10, s1: { on: 'D2', at: 5 }, s2: 'D' },
    { lv: 'Roof', mark: 'D2', L: 10, parts: 10, s1: { on: 'D1', at: 24 }, s2: 'C' },
    { lv: 'Roof', mark: 'D1', L: 24, x1: 0, x2: 20, parts: 10, s1: 'A', s2: 'B' },
  ] }],
});
const q = 0.01, w = q * 10; // ΣA = 60 + 100 + 240 = 400 sf
const d3 = case4(w, 0, 6, 0);
const d2 = add(case4(w, 0, 10, 0), case8(d3[0], 5, 5));
const d1 = add(case4(w, 0, 20, 0), overhangRight(w * 4, 2, 20), overhangRight(d2[0], 4, 20));

export default {
  id: 'D05', slug: 'chain-of-three',
  title: 'A chain of three diaphragms, ending on an overhang tip',
  intent: 'R.D3 rests on R.D2, which rests on the tip of the R.D1 overhang. They are entered in reverse order; the tool must solve R.D3 → R.D2 → R.D1 and pass each reaction on as a point load. The load at the tip is Case 26.',
  covers: ['Solve order (dependency)', 'Diaphragm on diaphragm', 'Case 26 (point load at the overhang tip)'],
  handCalc: [
    { step: 1, text: 'ΣA = 6·10 + 10·10 + 24·10 = 400 sf → q = 0.01 k/sf; w = 100 plf on all three.' },
    { step: 2, text: 'R.D3 (Case 1): R1 = R2 = ' + f4(d3[0]) + ' k. R1 → point load on R.D2 at x = 5.' },
    { step: 3, text: 'R.D2: Case 1 0.5 / 0.5 + Case 8 (P ' + f4(d3[0]) + ' k at mid-span) → R1 = ' + f4(d2[0]) + ' k (→ R.D1 at x = 24, its tip), R2 = ' + f4(d2[1]) + ' k → line C.' },
    { step: 4, text: 'R.D1 (l = 20, overhang 4): uniform (Case 24) + P ' + f4(d2[0]) + ' k at the tip (Case 26: R1 = −P·a/l, R2 = P(l + a)/l) → R1 = ' + f4(d1[0]) + ', R2 = ' + f4(d1[1]) + ' k.' },
    { step: 5, text: 'Σ lines = A ' + f4(d1[0]) + ' + B ' + f4(d1[1]) + ' + C ' + f4(d2[1]) + ' + D ' + f4(d3[1]) + ' = ' + f4(d1[0] + d1[1] + d2[1] + d3[1]) + ' k = F_x.' },
  ],
  expect: [
    ex('R.D2 R1 → R.D1 (k)', 'dia:E-W/R.D2', 'R1', d2[0], 3),
    ex('R.D1 R1 (k)', 'dia:E-W/R.D1', 'R1', d1[0], 4), ex('R.D1 R2 (k)', 'dia:E-W/R.D1', 'R2', d1[1], 4),
    ex('R.D1 incoming load source', 'dia:E-W/R.D1', 'points[0].source', 'R.D2.R1', 4),
    ex('Tip load region', 'dia:E-W/R.D1', 'rows[2].region', 'right', 4),
  ],
  expectChecks: { fail: [] },
  inputs,
};
