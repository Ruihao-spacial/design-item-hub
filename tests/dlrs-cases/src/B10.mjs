// B10 — point loads exactly at the supports (hand calc: docs/diaphragm-to-lrs-beam-check.md)
import { beamCase, beamEx } from './lib.mjs';

export default beamCase({
  id: 'B10', slug: 'beam-points-at-supports', title: 'Beam check — point loads exactly at the supports',
  intent: 'P1 = 1 k at x = 0 (on R1) and P2 = 1 k at x = 20 (on R2); each goes wholly into its own support. Hand calc: docs/diaphragm-to-lrs-beam-check.md',
  covers: ['Point load at a support (a = 0 / b = 0)'],
  L: 20, points: [[0, 1], [20, 1]],
  handCalc: [
    { step: 1, text: 'Method 1: P1 a 0 b 20 → 1.0000 / 0.0000; P2 a 20 b 0 → 0.0000 / 1.0000 → R1 = R2 = 1.0000 k.' },
    { step: 2, text: 'Method 2: R2 = (1 × 0 + 1 × 20) / 20 = 1.0000; R1 = 2 − 1 = 1.0000 k.' },
  ],
  expect: [
    beamEx('R1 (k)', 'R1', 1.0), beamEx('R2 (k)', 'R2', 1.0),
    beamEx('P1 share to R2 (k)', 'rows[0].R2', 0), beamEx('P2 share to R1 (k)', 'rows[1].R1', 0),
  ],
});
