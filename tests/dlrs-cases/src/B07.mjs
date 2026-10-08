// B07 — point load at midspan (hand calc: docs/diaphragm-to-lrs-beam-check.md)
import { beamCase, beamEx } from './lib.mjs';

export default beamCase({
  id: 'B07', slug: 'beam-point-midspan', title: 'Beam check — point load at midspan',
  intent: 'P = 2 k at x = 10 on a 20 ft simple span (no uniform on R.D1; area carrier R.D2). Hand calc: docs/diaphragm-to-lrs-beam-check.md',
  covers: ['Point load (a = b)'],
  L: 20, points: [[10, 2]],
  handCalc: [
    { step: 1, text: 'Method 1: R1 = P·b/l = 2 × 10 / 20 = 1.0000; R2 = P·a/l = 1.0000 k.' },
    { step: 2, text: 'Method 2: R2 = 2 × 10 / 20 = 1.0000; R1 = 2 − 1 = 1.0000 k.' },
  ],
  expect: [beamEx('R1 (k)', 'R1', 1.0), beamEx('R2 (k)', 'R2', 1.0)],
});
