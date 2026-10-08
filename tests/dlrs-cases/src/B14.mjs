// B14 — a part running over a support (hand calc: docs/diaphragm-to-lrs-beam-check.md)
import { beamCase, beamEx } from './lib.mjs';

export default beamCase({
  id: 'B14', slug: 'beam-part-over-support', title: 'Beam check — a part running over a support',
  intent: 'w = 40 plf from 15 to 25, across R2 at 20: the tool cuts it into a span piece and an overhang piece. Hand calc: docs/diaphragm-to-lrs-beam-check.md',
  covers: ['Cut at a support', 'Partial uniform + overhang'],
  L: 25, x1: 0, x2: 20, parts: [[15, 10, 4]],
  handCalc: [
    { step: 1, text: 'Method 1: span piece 15–20 (15 / 5 / 0) 0.0250 / 0.1750 + overhang 20–25 (e 2.5) −0.0250 / 0.2250 → R1 = 0.0000, R2 = 0.4000 k.' },
    { step: 2, text: 'Method 2: W = 0.4 k at 20 (on R2) → R2 = 0.4 × 20 / 20 = 0.4000; R1 = 0.0000 k.' },
  ],
  expect: [
    beamEx('R1 (k)', 'R1', 0), beamEx('R2 (k)', 'R2', 0.4),
    beamEx('span piece R2 (k)', 'rows[0].R2', 0.175), beamEx('overhang piece R1 (k)', 'rows[1].R1', -0.025),
  ],
});
