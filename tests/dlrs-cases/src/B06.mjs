// B06 — overlapping (stacked) parts (hand calc: docs/diaphragm-to-lrs-beam-check.md)
import { beamCase, beamEx } from './lib.mjs';

export default beamCase({
  id: 'B06', slug: 'beam-stacked-parts', title: 'Beam check — overlapping (stacked) parts',
  intent: 'Part 2 (5–15) lies on top of part 1 (0–20); both d 10. Hand calc: docs/diaphragm-to-lrs-beam-check.md',
  covers: ['Simple span', 'Overlapping parts (superposition)'],
  L: 20, parts: [[0, 20, 10], [5, 10, 10]],
  handCalc: [
    { step: 1, text: 'Method 1: part 1 1.0000 / 1.0000 + part 2 (5 / 10 / 5) 0.5000 / 0.5000 → R1 = R2 = 1.5000 k.' },
    { step: 2, text: 'Method 2: R2 = (2.0 × 10 + 1.0 × 10) / 20 = 1.5000; R1 = 3.0 − 1.5 = 1.5000 k.' },
  ],
  expect: [beamEx('R1 (k)', 'R1', 1.5), beamEx('R2 (k)', 'R2', 1.5)],
});
