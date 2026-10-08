// B05 — stepped depth: three parts across the span (hand calc: docs/diaphragm-to-lrs-beam-check.md)
import { beamCase, beamEx } from './lib.mjs';

export default beamCase({
  id: 'B05', slug: 'beam-stepped-depth', title: 'Beam check — stepped depth, three parts',
  intent: 'Three parts 0–6 (d 30), 6–14 (d 20), 14–20 (d 10) on a 20 ft simple span. Hand calc: docs/diaphragm-to-lrs-beam-check.md',
  covers: ['Simple span', 'Partial uniform × 3', 'Stepped depth'],
  L: 20, parts: [[0, 6, 30], [6, 8, 20], [14, 6, 10]],
  handCalc: [
    { step: 1, text: 'Method 1: part 1 1.5300 / 0.2700, part 2 0.8000 / 0.8000, part 3 0.0900 / 0.5100 → R1 = 2.4200, R2 = 1.5800 k.' },
    { step: 2, text: 'Method 2: ΣM about R1 = 1.8 × 3 + 1.6 × 10 + 0.6 × 17 = 31.6 → R2 = 1.5800; R1 = 4.0 − 1.58 = 2.4200 k.' },
  ],
  expect: [
    beamEx('R1 (k)', 'R1', 2.42), beamEx('R2 (k)', 'R2', 1.58),
    beamEx('part 1 R1 (k)', 'rows[0].R1', 1.53), beamEx('part 3 R2 (k)', 'rows[2].R2', 0.51),
  ],
});
