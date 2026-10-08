// D01 — the team's spreadsheet, page C.6 (Shared Drive "Diaphragm to LRS reference"), rebuilt.
// Expected values are the spreadsheet's own numbers (lb → k); the hand calc shows how they arise.
import { buildModel, ex, case4, case8, f2, f4 } from './lib.mjs';

const roof = (mark, L, d, s1, s2) => ({ lv: 'Roof', mark, L, parts: d, s1, s2 });
const second = (mark, L, d, s1, s2) => ({ lv: '2nd Floor', mark, L, parts: d, s1, s2 });
const inputs = buildModel({
  levels: [['Roof', 22.6], ['2nd Floor', 6.43]],
  dirs: [{ name: 'E-W', lines: 'A C D F H', groups: [['C D']],
    down: { Roof: { H: 'ends' } },
    dias: [
      roof('D1', 18.25, 25.67, 'A', 'C'), roof('D2', 16.25, 14.33, { on: 'D1', at: 2 }, 'C'), roof('D3', 3.5, 40, 'C', 'D'),
      roof('D4', 14.75, 34, 'D', 'F'), roof('D5', 7.25, 6, 'D', { on: 'D4', at: 7.25 }), roof('D6', 19.17, 21, 'F', 'H'),
      roof('D7', 8.5, 8, 'F', { on: 'D6', at: 8.5 }),
      second('D1', 18.25, 25.67, 'A', 'C'), second('D2', 16.25, 14.33, { on: 'D1', at: 2 }, 'C'), second('D3.1', 3.5, 21, 'C', 'D'),
      second('D3.2', 3.5, 9.5, 'C', 'D'), second('D4', 14.75, 34, 'D', 'F'), second('D5', 7.25, 6, 'D', { on: 'D4', at: 7.25 }),
    ] }],
});

// hand calc (closed forms) for the steps shown
const A = 18.25 * 25.67 + 16.25 * 14.33 + 3.5 * 40 + 14.75 * 34 + 7.25 * 6 + 19.17 * 21 + 8.5 * 8;
const q = 22.6 / A;
const w1 = q * 25.67, w2 = q * 14.33;
const [d2r1] = case4(w2, 0, 16.25, 0);
const [d1r1u, d1r2u] = case4(w1, 0, 18.25, 0);
const [d1r1p, d1r2p] = case8(d2r1, 2, 16.25);
const k = lb => lb / 1000;

export default {
  id: 'D01', slug: 'sample-c6',
  title: 'The team spreadsheet, page C.6 (Roof + 2nd floor, E-W)',
  intent: 'Rebuilds the reference spreadsheet: seven roof and six 2nd-floor diaphragms, three of them resting on another diaphragm, lines C and D combined, line H resisted at the roof. Every reaction, line force and story shear must match the spreadsheet.',
  covers: ['q = F_x / ΣA', 'Case 1 + Case 8 (diaphragm on diaphragm)', 'Merged lines C+D', 'Story shear from above', 'Ends here (line H)'],
  handCalc: [
    { step: 1, text: 'Roof: ΣA = Σ L × d = ' + f2(A) + ' sf → q = 22.6 / ' + f2(A) + ' = ' + f4(q * 1000) + ' psf (spreadsheet 12.2 psf).' },
    { step: 2, text: 'R.D2: w = q × 14.33 = ' + f2(w2 * 1000) + ' plf, simple span 16.25 ft (Case 1): R1 = R2 = w·l/2 = ' + f4(d2r1) + ' k. R1 rests on R.D1 at x = 2 ft → point load P1 on R.D1.' },
    { step: 3, text: 'R.D1: w = q × 25.67 = ' + f2(w1 * 1000) + ' plf (Case 1): R_dist = ' + f4(d1r1u) + ' k each end. P1 = ' + f4(d2r1) + ' k at a = 2, b = 16.25 (Case 8): R_P1 = P·b/l = ' + f4(d1r1p) + ', R_P2 = P·a/l = ' + f4(d1r2p) + ' k → R.A = ' + f4(d1r1u + d1r1p) + ' k, R.C = ' + f4(d1r2u + d1r2p) + ' k.' },
    { step: 4, text: 'R.D4 carries R.D5 (P at its right end x = 7.25 of 14.75), R.D6 carries R.D7 (x = 8.5 of 19.17), the same way (Case 1 + Case 8).' },
    { step: 5, text: 'Lines at the roof: R.A = R.D1.R1; R.C+R.D = R.D1.R2 + R.D2.R2 + R.D3 (both) + R.D4.R1 + R.D5.R1; R.F = R.D4.R2 + R.D6.R1 + R.D7.R1; R.H = R.D6.R2 (resisted at the roof: the spreadsheet does not carry it down).' },
    { step: 6, text: '2nd floor: q = 6.43 / 1353.09 sf; same layout without R.D6 / R.D7, R.D3 split into two strips 21 ft and 9.5 ft deep (both C → D).' },
    { step: 7, text: 'Story shear at the 2nd floor = own F + the same line above: 2.A = 2.D1.R1 + R.A, 2.C+2.D = own + R.C+R.D, 2.F = 2.D4.R2 + R.F.' },
  ],
  expect: [
    ex('Roof ΣA (sf)', 'level:E-W/Roof', 'sumA', 1856.91, 1, 0.01),
    ex('R.D1.R1 → R.A (k)', 'dia:E-W/R.D1', 'R1', k(4112.63), 3),
    ex('R.D1.R1 R_dist (k)', 'dia:E-W/R.D1', 'R1dist', k(2850.86), 3),
    ex('R.D1.R1 R_P (k)', 'dia:E-W/R.D1', 'R1P', k(1261.76), 3),
    ex('R.D1.R2 → R.C (k)', 'dia:E-W/R.D1', 'R2', k(3006.16), 3),
    ex('R.D2.R1 → P1 (k)', 'dia:E-W/R.D2', 'R1', k(1417.06), 2),
    ex('R.D3.R1 (k)', 'dia:E-W/R.D3', 'R1', k(851.95), 4),
    ex('R.D4.R1 (k)', 'dia:E-W/R.D4', 'R1', k(3186.42), 4),
    ex('R.D4.R2 (k)', 'dia:E-W/R.D4', 'R2', k(3181.93), 4),
    ex('R.D5.R2 → P2 (k)', 'dia:E-W/R.D5', 'R2', k(264.71), 4),
    ex('R.D6.R1 (k)', 'dia:E-W/R.D6', 'R1', k(2680.11), 4),
    ex('R.D6.R2 → R.H (k)', 'dia:E-W/R.D6', 'R2', k(2633.27), 4),
    ex('R.D7.R1 (k)', 'dia:E-W/R.D7', 'R1', k(413.81), 4),
    ex('Line R.A (k)', 'line:E-W/R.A', 'V', k(4112.63), 5),
    ex('Line R.C+R.D (k)', 'line:E-W/R.C+R.D', 'V', k(9578.25), 5),
    ex('Line R.F (k)', 'line:E-W/R.F', 'V', k(6275.85), 5),
    ex('Line R.H (k)', 'line:E-W/R.H', 'V', k(2633.27), 5),
    ex('2.D1.R1 → 2.A (k)', 'dia:E-W/2.D1', 'R1', k(1605.78), 6),
    ex('2.D1.R2 → 2.C (k)', 'dia:E-W/2.D1', 'R2', k(1173.76), 6),
    ex('2.D3.1.R1 (k)', 'dia:E-W/2.D3.1', 'R1', k(174.64), 6),
    ex('2.D3.2.R1 (k)', 'dia:E-W/2.D3.2', 'R1', k(79.00), 6),
    ex('2.D4.R1 (k)', 'dia:E-W/2.D4', 'R1', k(1244.14), 6),
    ex('2.D4.R2 (k)', 'dia:E-W/2.D4', 'R2', k(1242.39), 6),
    ex('2.D5.R1 (k)', 'dia:E-W/2.D5', 'R1', k(103.36), 6),
    ex('2.A level force F (k)', 'line:E-W/2.A', 'F', k(1605.78), 7),
    ex('2.C+2.D level force F (k)', 'line:E-W/2.C+2.D', 'F', k(3581.83), 7),
    ex('2.F level force F (k)', 'line:E-W/2.F', 'F', k(1242.39), 7),
    ex('2.A story shear V (k)', 'line:E-W/2.A', 'V', k(5718.40), 7),
    ex('2.C+2.D story shear V (k)', 'line:E-W/2.C+2.D', 'V', k(13160.08), 7),
    ex('2.F story shear V (k)', 'line:E-W/2.F', 'V', k(7518.24), 7),
  ],
  expectChecks: { fail: [] },
  notChecked: 'The spreadsheet rounds q for display only (12.2 psf); values are compared at ± 0.0005 k.',
  inputs,
};
