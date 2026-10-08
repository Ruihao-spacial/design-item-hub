// B11 — overhang on the right, full uniform (hand calc: docs/diaphragm-to-lrs-beam-check.md)
import { beamCase, beamEx } from './lib.mjs';

export default beamCase({
  id: 'B11', slug: 'beam-overhang-right', title: 'Beam check — overhang on the right, full uniform',
  intent: 'L 25 on supports 0 / 20 (5 ft overhang), w = 200 plf over the whole length. Hand calc: docs/diaphragm-to-lrs-beam-check.md',
  covers: ['Overhang one side', 'Cut at R2', 'Overhang closed form'],
  L: 25, x1: 0, x2: 20, parts: [[0, 25, 20]],
  handCalc: [
    { step: 1, text: 'Method 1: R1 = w(l² − a²)/(2l) = 0.2 × 375 / 40 = 1.8750; R2 = w(l + a)²/(2l) = 0.2 × 625 / 40 = 3.1250 k. Cut: span 2.0 / 2.0 + overhang −0.1250 / 1.1250.' },
    { step: 2, text: 'Method 2: W = 5.0 k at 12.5 → R2 = 5 × 12.5 / 20 = 3.1250; R1 = 5 − 3.125 = 1.8750 k.' },
  ],
  expect: [
    beamEx('R1 (k)', 'R1', 1.875), beamEx('R2 (k)', 'R2', 3.125),
    beamEx('overhang piece R1 (k)', 'rows[1].R1', -0.125), beamEx('overhang piece R2 (k)', 'rows[1].R2', 1.125),
  ],
});
