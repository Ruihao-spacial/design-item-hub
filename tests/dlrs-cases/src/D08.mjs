// D08 — robustness: support loop, unassigned support, supports at the same x, split ≠ 100 %, whitespace input
import { buildModel, ex } from './lib.mjs';

const inputs = buildModel({
  levels: [['Roof', 4], ['2nd Floor', 2]],
  dirs: [{ name: 'E-W', lines: 'A B', down: { Roof: { B: { split: [['A', 60]] } } }, dias: [
    { lv: 'Roof', mark: 'D1', L: ' 20 ', parts: [[0, 20, 10]], s1: 'A', s2: 'B' },
    { lv: 'Roof', mark: 'D2', L: 10, parts: 5, s1: { on: 'D3', at: 2 }, s2: 'B' },
    { lv: 'Roof', mark: 'D3', L: 10, parts: 5, s1: { on: 'D2', at: 2 }, s2: 'A' },
    { lv: 'Roof', mark: 'D4', L: 8, parts: 5, s1: 'A', s2: null },
    { lv: 'Roof', mark: 'D5', L: 8, x1: 3, x2: 3, parts: 5, s1: 'A', s2: 'B' },
    { lv: '2nd Floor', mark: 'D1', L: 20, parts: 10, s1: 'A', s2: 'B' },
  ] }],
});
const q = 4 / 380;

export default {
  id: 'D08', slug: 'robustness',
  title: 'Robustness: loop, unassigned support, supports at the same x, split ≠ 100 %',
  intent: 'Bad inputs must be reported, not crash: R.D2 and R.D3 rest on each other (loop, D4); R.D4 has no R2 target and R.D5 has both supports at x = 3 (D3); roof line B is split 60 % only (D5). The lost force makes D2 (roof) and D7 (2nd floor) fail. R.D1 typed with spaces (" 20 ") still calculates.',
  covers: ['D2', 'D3', 'D4', 'D5', 'D7', 'Input parsing (whitespace)'],
  handCalc: [
    { step: 1, text: 'Roof ΣA = 200 + 50 + 50 + 40 + 40 = 380 sf → q = 4 / 380 k/sf; only R.D1 is solved: R1 = R2 = q·10·20/2 = ' + (q * 100).toFixed(4) + ' k.' },
    { step: 2, text: 'The roof does not balance (only R.D1 reaches the lines) → D2 fails; the loop → D4; the bad diaphragms → D3; split 60 % → D5; the lost 40 % → D7 at the 2nd floor.' },
  ],
  expect: [
    ex('R.D1 R1 (k)', 'dia:E-W/R.D1', 'R1', q * 100, 1),
    ex('D4 status', 'check:E-W/D4', 'status', 'fail', 2),
  ],
  expectChecks: { fail: ['D2', 'D3', 'D4', 'D5', 'D7'] },
  inputs,
};
