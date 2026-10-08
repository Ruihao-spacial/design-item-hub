// B15 — overhang on the left, mirror of B11 (hand calc: docs/diaphragm-to-lrs-beam-check.md)
import { beamCase, beamEx } from './lib.mjs';

export default beamCase({
  id: 'B15', slug: 'beam-overhang-left', title: 'Beam check — overhang on the left (mirror of B11)',
  intent: 'L 25 on supports 5 / 25 (5 ft overhang on the left), w = 200 plf. R1 and R2 are B11 swapped. Hand calc: docs/diaphragm-to-lrs-beam-check.md',
  covers: ['Left overhang', 'Mirror'],
  L: 25, x1: 5, x2: 25, parts: [[0, 25, 20]],
  handCalc: [
    { step: 1, text: 'Method 1: left overhang (e 2.5) 1.1250 / −0.1250 + span 2.0 / 2.0 → R1 = 3.1250, R2 = 1.8750 k.' },
    { step: 2, text: 'Method 2: W = 5 k at 12.5 → R2 = 5 × 7.5 / 20 = 1.8750; R1 = 5 − 1.875 = 3.1250 k.' },
  ],
  expect: [
    beamEx('R1 (k)', 'R1', 3.125), beamEx('R2 (k)', 'R2', 1.875),
    beamEx('left overhang piece R2 (k)', 'rows[0].R2', -0.125),
  ],
});
