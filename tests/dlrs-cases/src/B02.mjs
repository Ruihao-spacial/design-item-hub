// B02 — partial uniform at the left end (hand calc: docs/diaphragm-to-lrs-beam-check.md)
import { beamCase, beamEx } from './lib.mjs';

export default beamCase({
  id: 'B02', slug: 'beam-partial-left', title: 'Beam check — partial uniform at the left end',
  intent: 'A part from x = 0 to 8 on a 20 ft simple span. Hand calc: docs/diaphragm-to-lrs-beam-check.md',
  covers: ['Simple span', 'Partial uniform (a = 0)'],
  L: 20, parts: [[0, 8, 15]],
  handCalc: [
    { step: 1, text: 'Method 1: R1 = w·b(2c + b)/(2l) = 0.150 × 8 × 32 / 40 = 0.9600; R2 = w·b(2a + b)/(2l) = 0.150 × 8 × 8 / 40 = 0.2400 k.' },
    { step: 2, text: 'Method 2: W = 1.200 k at 4 → R2 = 1.200 × 4 / 20 = 0.2400; R1 = 1.200 − 0.2400 = 0.9600 k.' },
  ],
  expect: [beamEx('R1 (k)', 'R1', 0.96), beamEx('R2 (k)', 'R2', 0.24)],
});
