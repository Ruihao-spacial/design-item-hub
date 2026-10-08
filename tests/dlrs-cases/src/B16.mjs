// B16 — point loads on the overhang: at the tip and inside it (hand calc: docs/diaphragm-to-lrs-beam-check.md)
import { beamCase, beamEx, ex } from './lib.mjs';

export default beamCase({
  id: 'B16', slug: 'beam-overhang-points', title: 'Beam check — point loads on the overhang (tip and inside)',
  intent: 'P1 = 1 k at the tip (25) and P2 = 0.5 k at 22, supports 0 / 20; R1 reverses and line A gets a negative force. Hand calc: docs/diaphragm-to-lrs-beam-check.md',
  covers: ['Overhang point at the tip', 'Overhang point, general form', 'Negative line force'],
  L: 25, x1: 0, x2: 20, points: [[25, 1], [22, 0.5]],
  handCalc: [
    { step: 1, text: 'Method 1: P1 (e 5) −0.2500 / 1.2500; P2 (e 2) −0.0500 / 0.5500 → R1 = −0.3000, R2 = 1.8000 k.' },
    { step: 2, text: 'Method 2: R2 = (1 × 25 + 0.5 × 22) / 20 = 1.8000; R1 = 1.5 − 1.8 = −0.3000 k.' },
  ],
  expect: [
    beamEx('R1 (k)', 'R1', -0.3), beamEx('R2 (k)', 'R2', 1.8),
    beamEx('P1 (tip) share to R1 (k)', 'rows[0].R1', -0.25),
    ex('line A force (k)', 'line:E-W/R.A', 'F', -0.3, 1),
  ],
});
