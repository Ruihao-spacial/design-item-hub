// B03 — partial uniform inside the span (hand calc: docs/diaphragm-to-lrs-beam-check.md)
import { beamCase, beamEx } from './lib.mjs';

export default beamCase({
  id: 'B03', slug: 'beam-partial-inside', title: 'Beam check — partial uniform inside the span',
  intent: 'A part from x = 4 to 14 on a 20 ft simple span (a / b / c = 4 / 10 / 6). Hand calc: docs/diaphragm-to-lrs-beam-check.md',
  covers: ['Simple span', 'Partial uniform (interior)'],
  L: 20, parts: [[4, 10, 10]],
  handCalc: [
    { step: 1, text: 'Method 1: R1 = 0.100 × 10 × 22 / 40 = 0.5500; R2 = 0.100 × 10 × 18 / 40 = 0.4500 k.' },
    { step: 2, text: 'Method 2: W = 1.000 k at 9 → R2 = 9 / 20 = 0.4500; R1 = 1.000 − 0.4500 = 0.5500 k.' },
  ],
  expect: [beamEx('R1 (k)', 'R1', 0.55), beamEx('R2 (k)', 'R2', 0.45)],
});
