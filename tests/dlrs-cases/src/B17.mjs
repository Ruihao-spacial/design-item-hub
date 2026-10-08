// B17 — overhangs on both sides, R1 reverses (hand calc: docs/diaphragm-to-lrs-beam-check.md)
import { beamCase, beamEx } from './lib.mjs';

export default beamCase({
  id: 'B17', slug: 'beam-overhangs-both', title: 'Beam check — overhangs on both sides, R1 reverses',
  intent: 'L 30 on supports 4 / 12 (4 ft left, 18 ft right overhang), w = 100 plf. Hand calc: docs/diaphragm-to-lrs-beam-check.md',
  covers: ['Overhangs both sides', 'Reversing reaction'],
  L: 30, x1: 4, x2: 12, parts: [[0, 30, 10]],
  handCalc: [
    { step: 1, text: 'Method 1: left OH 0.5000 / −0.1000; span 0.4000 / 0.4000; right OH (e 9) −2.0250 / 3.8250 → R1 = −1.1250, R2 = 4.1250 k.' },
    { step: 2, text: 'Method 2: W = 3 k at 15 → R2 = 3 × 11 / 8 = 4.1250; R1 = 3 − 4.125 = −1.1250 k.' },
  ],
  expect: [
    beamEx('R1 (k)', 'R1', -1.125), beamEx('R2 (k)', 'R2', 4.125),
    beamEx('right overhang piece R1 (k)', 'rows[2].R1', -2.025),
    beamEx('R1 reverses', 'supports[0].reverses', true),
  ],
});
