// B13 — partial uniform on the overhang (hand calc: docs/diaphragm-to-lrs-beam-check.md)
import { beamCase, beamEx } from './lib.mjs';

export default beamCase({
  id: 'B13', slug: 'beam-overhang-partial', title: 'Beam check — partial uniform on the overhang',
  intent: 'w = 60 plf from 21 to 24, touching neither R2 (20) nor the tip (25). Hand calc: docs/diaphragm-to-lrs-beam-check.md',
  covers: ['Overhang load, general form'],
  L: 25, x1: 0, x2: 20, parts: [[21, 3, 6]],
  handCalc: [
    { step: 1, text: 'Method 1: W = 0.18 k at e = 2.5 past R2 → R1 = −0.18 × 2.5 / 20 = −0.0225; R2 = 0.18 × 22.5 / 20 = 0.2025 k.' },
    { step: 2, text: 'Method 2: R2 = 0.18 × 22.5 / 20 = 0.2025; R1 = 0.18 − 0.2025 = −0.0225 k.' },
  ],
  expect: [beamEx('R1 (k)', 'R1', -0.0225), beamEx('R2 (k)', 'R2', 0.2025)],
});
