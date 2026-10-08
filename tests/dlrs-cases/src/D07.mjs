// D07 — story shear down the building: Same, Split %, Ends here, a group at one level only
import { buildModel, ex } from './lib.mjs';

const inputs = buildModel({
  levels: [['Roof', 8], ['2nd Floor', 4], ['1st Floor', 3, '1']],
  dirs: [{ name: 'E-W', lines: 'A B C D E', groups: [['C D', ['2nd Floor']]],
    down: { Roof: { A: 'ends', E: { split: [['C', 25], ['D', 75]] } }, '2nd Floor': { 'C+D': { split: [['E', 100]] } } },
    dias: [
      { lv: 'Roof', mark: 'D1', L: 20, parts: 20, s1: 'A', s2: 'B' }, { lv: 'Roof', mark: 'D2', L: 20, parts: 20, s1: 'B', s2: 'E' },
      { lv: '2nd Floor', mark: 'D1', L: 20, parts: 10, s1: 'B', s2: 'C' }, { lv: '2nd Floor', mark: 'D2', L: 20, parts: 10, s1: 'D', s2: 'E' },
      { lv: '1st Floor', mark: 'D1', L: 30, parts: 10, s1: 'B', s2: 'E' },
    ] }],
});

export default {
  id: 'D07', slug: 'story-shear-down',
  title: 'Story shear down the building: Same, Split %, Ends, group at one level',
  intent: 'Roof line A is resisted at the roof (hillside). Roof line E lands between 2nd-floor lines C and D (vertical discontinuity) and is split 25 / 75 %. C and D are combined at the 2nd floor only, and that group lands on line E at the 1st floor (100 %). Story shears must add up level by level.',
  covers: ['Ends here', 'Split %', 'Group at some levels only', 'D7: ΣV = ΣF − resisted above'],
  handCalc: [
    { step: 1, text: 'Roof: ΣA = 800 sf, q = 0.01, w = 200 plf → 2.0 k at each end: R.A 2.0, R.B 4.0, R.E 2.0. R.A ends at the roof.' },
    { step: 2, text: '2nd: ΣA = 400 sf, q = 0.01, w = 100 plf → 1.0 k at each end: own B 1.0, C 1.0, D 1.0, E 1.0.' },
    { step: 3, text: '2nd story shear: 2.B = 1.0 + R.B 4.0 = 5.0; 2.C+2.D = 2.0 + R.E (25 % + 75 %) 2.0 = 4.0; 2.E = 1.0 (R.E went to C / D). ΣV = 10.0 = 8 + 4 − 2 (R.A).' },
    { step: 4, text: '1st: ΣA = 300 sf, q = 0.01, w = 100 plf → 1.5 k each: 1.B = 1.5 + 5.0 = 6.5; 1.E = 1.5 + 2.E 1.0 + (2.C+2.D) 4.0 = 6.5. ΣV = 13.0 = 15 − 2.' },
  ],
  expect: [
    ex('R.A ends at the roof', 'line:E-W/R.A', 'ends', true, 1),
    ex('2.B V (k)', 'line:E-W/2.B', 'V', 5.0, 3), ex('2.C+2.D V (k)', 'line:E-W/2.C+2.D', 'V', 4.0, 3), ex('2.E V (k)', 'line:E-W/2.E', 'V', 1.0, 3),
    ex('2nd ΣV (k)', 'level:E-W/2nd Floor', 'sumV', 10.0, 3),
    ex('1.B V (k)', 'line:E-W/1.B', 'V', 6.5, 4), ex('1.E V (k)', 'line:E-W/1.E', 'V', 6.5, 4),
    ex('1st ΣV (k)', 'level:E-W/1st Floor', 'sumV', 13.0, 4),
  ],
  expectChecks: { fail: [] },
  inputs,
};
