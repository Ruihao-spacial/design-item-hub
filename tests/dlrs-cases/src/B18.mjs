// B18 — point loads exactly at the supports when both sides overhang (hand calc: docs/diaphragm-to-lrs-beam-check.md)
import { beamCase, beamEx } from './lib.mjs';

export default beamCase({
  id: 'B18', slug: 'beam-points-at-supports-overhang', title: 'Beam check — point loads at the supports with overhangs',
  intent: 'Supports at 5 and 20 on a 25 ft diaphragm; P1 = 1 k at 5 (on R1), P2 = 1 k at 20 (on R2). Neither is on the overhang. Hand calc: docs/diaphragm-to-lrs-beam-check.md',
  covers: ['Point at a support', 'Overhang boundary'],
  L: 25, x1: 5, x2: 20, points: [[5, 1], [20, 1]],
  handCalc: [
    { step: 1, text: 'Method 1: P1 a 0 b 15 → 1.0000 / 0.0000; P2 a 15 b 0 → 0.0000 / 1.0000 → R1 = R2 = 1.0000 k.' },
    { step: 2, text: 'Method 2: R2 = (1 × 0 + 1 × 15) / 15 = 1.0000; R1 = 2 − 1 = 1.0000 k.' },
  ],
  expect: [
    beamEx('R1 (k)', 'R1', 1.0), beamEx('R2 (k)', 'R2', 1.0),
    beamEx('P2 share to R1 (k)', 'rows[1].R1', 0),
  ],
});
