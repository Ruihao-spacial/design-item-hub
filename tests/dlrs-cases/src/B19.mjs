// B19 — everything combined (hand calc: docs/diaphragm-to-lrs-beam-check.md)
import { beamCase, beamEx } from './lib.mjs';

export default beamCase({
  id: 'B19', slug: 'beam-combined', title: 'Beam check — everything combined',
  intent: 'Overhangs on both sides, three parts (one over R2), two span point loads and one at the tip. Hand calc: docs/diaphragm-to-lrs-beam-check.md',
  covers: ['Overhangs both sides', 'Part over a support', 'Stacked parts', 'Span + tip point loads', 'Superposition'],
  L: 30, x1: 4, x2: 24, parts: [[0, 30, 10], [8, 10, 20], [20, 8, 5]], points: [[10, 1.0], [16, 0.6], [30, 0.8]],
  handCalc: [
    { step: 1, text: 'Method 1 (each load): uniform R1 2.4500 / R2 2.9500; points R1 0.7000 / R2 1.7000 → R1 = 3.1500, R2 = 4.6500 k.' },
    { step: 2, text: 'Method 2: ΣM about R1 = 33.0 + 18.0 + 8.0 + 6.0 + 7.2 + 20.8 = 93.0 → R2 = 4.6500; R1 = 7.8 − 4.65 = 3.1500 k.' },
  ],
  expect: [
    beamEx('R1 (k)', 'R1', 3.15), beamEx('R2 (k)', 'R2', 4.65),
    beamEx('R1 from uniform (k)', 'R1dist', 2.45), beamEx('R2 from uniform (k)', 'R2dist', 2.95),
    beamEx('R1 from point loads (k)', 'R1P', 0.7), beamEx('R2 from point loads (k)', 'R2P', 1.7),
    beamEx('number of rows', 'rows.length', 9),
  ],
});
