// B08 — point load off-centre (hand calc: docs/diaphragm-to-lrs-beam-check.md)
import { beamCase, beamEx } from './lib.mjs';

export default beamCase({
  id: 'B08', slug: 'beam-point-off-centre', title: 'Beam check — point load off-centre',
  intent: 'P = 1.5 k at x = 6 on a 20 ft simple span (area carrier R.D2). Hand calc: docs/diaphragm-to-lrs-beam-check.md',
  covers: ['Point load (a ≠ b)'],
  L: 20, points: [[6, 1.5]],
  handCalc: [
    { step: 1, text: 'Method 1: a 6, b 14 → R1 = 1.5 × 14 / 20 = 1.0500; R2 = 1.5 × 6 / 20 = 0.4500 k.' },
    { step: 2, text: 'Method 2: R2 = 1.5 × 6 / 20 = 0.4500; R1 = 1.5 − 0.45 = 1.0500 k.' },
  ],
  expect: [beamEx('R1 (k)', 'R1', 1.05), beamEx('R2 (k)', 'R2', 0.45)],
});
