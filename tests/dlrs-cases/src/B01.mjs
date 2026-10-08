// B01 — full uniform, simple span (hand calc: docs/diaphragm-to-lrs-beam-check.md)
import { beamCase, beamEx } from './lib.mjs';

export default beamCase({
  id: 'B01', slug: 'beam-full-uniform', title: 'Beam check — full uniform, simple span',
  intent: 'One uniform part over the whole span. Hand calc: docs/diaphragm-to-lrs-beam-check.md',
  covers: ['Simple span', 'Full uniform'],
  L: 20, parts: [[0, 20, 20]],
  handCalc: [
    { step: 1, text: 'Method 1: R1 = R2 = w·l/2 = 0.200 × 20 / 2 = 2.0000 k.' },
    { step: 2, text: 'Method 2: W = 4.000 k at x̄ = 10 → R2 = 4.000 × 10 / 20 = 2.0000; R1 = 4.000 − 2.0000 = 2.0000 k.' },
  ],
  expect: [beamEx('R1 (k)', 'R1', 2.0), beamEx('R2 (k)', 'R2', 2.0)],
});
