// B04 — partial uniform at the right end (hand calc: docs/diaphragm-to-lrs-beam-check.md)
import { beamCase, beamEx } from './lib.mjs';

export default beamCase({
  id: 'B04', slug: 'beam-partial-right', title: 'Beam check — partial uniform at the right end',
  intent: 'A part from x = 12 to 20 on a 20 ft simple span (c = 0). Hand calc: docs/diaphragm-to-lrs-beam-check.md',
  covers: ['Simple span', 'Partial uniform (c = 0)'],
  L: 20, parts: [[12, 8, 25]],
  handCalc: [
    { step: 1, text: 'Method 1: R1 = 0.250 × 8 × 8 / 40 = 0.4000; R2 = 0.250 × 8 × 32 / 40 = 1.6000 k.' },
    { step: 2, text: 'Method 2: W = 2.000 k at 16 → R2 = 2.000 × 16 / 20 = 1.6000; R1 = 2.000 − 1.6000 = 0.4000 k.' },
  ],
  expect: [beamEx('R1 (k)', 'R1', 0.4), beamEx('R2 (k)', 'R2', 1.6)],
});
