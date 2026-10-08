// B09 — uniform plus two point loads (hand calc: docs/diaphragm-to-lrs-beam-check.md)
import { beamCase, beamEx } from './lib.mjs';

export default beamCase({
  id: 'B09', slug: 'beam-uniform-two-points', title: 'Beam check — uniform plus two point loads',
  intent: 'w = 250 plf over 16 ft with P1 = 1.2 k at 4 and P2 = 0.7 k at 11. Hand calc: docs/diaphragm-to-lrs-beam-check.md',
  covers: ['Full uniform', 'Two point loads', 'Distributed / point split of R'],
  L: 16, parts: [[0, 16, 25]], points: [[4, 1.2], [11, 0.7]],
  handCalc: [
    { step: 1, text: 'Method 1: uniform 2.0000 / 2.0000; P1 0.9000 / 0.3000; P2 0.21875 / 0.48125 → R1 = 3.11875, R2 = 2.78125 k.' },
    { step: 2, text: 'Method 2: ΣM about R1 = 4.0 × 8 + 1.2 × 4 + 0.7 × 11 = 44.5 → R2 = 2.78125; R1 = 5.9 − 2.78125 = 3.11875 k.' },
  ],
  expect: [
    beamEx('R1 (k)', 'R1', 3.11875), beamEx('R2 (k)', 'R2', 2.78125),
    beamEx('R1 from point loads (k)', 'R1P', 1.11875), beamEx('R2 from uniform (k)', 'R2dist', 2.0),
  ],
});
