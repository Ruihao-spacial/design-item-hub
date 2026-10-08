// B12 — uniform on the overhang only (hand calc: docs/diaphragm-to-lrs-beam-check.md)
import { beamCase, beamEx } from './lib.mjs';

export default beamCase({
  id: 'B12', slug: 'beam-overhang-only', title: 'Beam check — uniform on the overhang only',
  intent: 'w = 100 plf on the 5 ft overhang only (20–25); R1 reverses. Hand calc: docs/diaphragm-to-lrs-beam-check.md',
  covers: ['Whole-overhang uniform', 'Reversing reaction'],
  L: 25, x1: 0, x2: 20, parts: [[20, 5, 10]],
  handCalc: [
    { step: 1, text: 'Method 1: R1 = −w·a²/(2l) = −0.1 × 25 / 40 = −0.0625; R2 = w·a(2l + a)/(2l) = 0.1 × 5 × 45 / 40 = 0.5625 k.' },
    { step: 2, text: 'Method 2: W = 0.5 k at 22.5 → R2 = 0.5 × 22.5 / 20 = 0.5625; R1 = 0.5 − 0.5625 = −0.0625 k.' },
  ],
  expect: [
    beamEx('R1 (k)', 'R1', -0.0625), beamEx('R2 (k)', 'R2', 0.5625),
    beamEx('R1 reverses', 'supports[0].reverses', true),
  ],
});
