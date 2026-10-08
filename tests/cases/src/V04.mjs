// V04 — aspect ratio (SDPWS 2021 §4.3.4): C_hb at h/b = 2.0, 2.5, 3.5, and a wall > 3.5 that carries nothing
import { project, level, direction, line, wall, ex, Chb, NAIL, f2, f3, f4, SEISMIC, eq431, storyDrift, driftExpect } from './lib.mjs';

const V = 3, h = 7;                                  // h = 7 ft gives exact h/b values with short walls
const walls = [['w-1', 'SW-1', 0, 3.5], ['w-2', 'SW-2', 6, 2.8], ['w-3', 'SW-3', 12, 2.0], ['w-4', 'SW-4', 18, 1.75]]
  .map(([id, mark, x, L]) => ({ id, mark, x, L, hb: h / L, C: Chb(h, L) }));
const n = NAIL[0];                                   // 6" o.c. (checked in step 5)
const ok = walls.filter(w => w.C > 0);
ok.forEach(w => { w.cap = n.E * w.C; w.wt = w.cap * w.L; });
const W = ok.reduce((s, w) => s + w.wt, 0);
ok.forEach(w => { w.V = V * w.wt / W; w.v = 0.7 * w.V * 1000 / w.L; w.dc = w.v / w.cap; });
const by = Object.fromEntries(walls.map(w => [w.mark, w]));
// Story drift (Cd 4, Ie 1.0, RC II): Eq. 4.3-1 of the three shear walls with their 1.0E share (T = C = V·h/L), pinned
// 6" o.c. / HDUE3 / (2)2x4; SW-4 (h/b > 3.5) is not a shear wall: no share, no δ, not in the story drift
const defl = ok.map(w => eq431({ mark: w.mark, L: w.L, h, nail: '6', hdL: 'HDUE3', hdR: 'HDUE3', postL: '(2)2x4', postR: '(2)2x4', Vk: w.V, TL: w.V * h / w.L, CR: w.V * h / w.L }));
const d1 = storyDrift('Level 1', h, defl);

export default {
  id: 'V04', title: 'Aspect ratio factor and walls over 3.5', slug: 'aspect-ratio',
  intent: 'Four walls at one 7 ft story with h/b = 2.0, 2.5, 3.5 and 4.0. Proves the SDPWS 2021 aspect ratio factor C_hb = 1.25 − 0.125·h/b for 2 < h/b ≤ 3.5, that it scales both the capacity and the capacity-distribution weight, and that a wall over 3.5 is flagged (aspect_ratio warning) and takes no shear.',
  covers: ['SDPWS 2021 §4.3.4 aspect ratio', 'SDPWS 4.3.3.4.1 capacity distribution with C_hb', 'aspect_ratio audit warning', 'G2 / G11'],
  handCalc: [
    'Story shear V = ' + V + ' k, h = ' + h + ' ft. Walls: ' + walls.map(w => w.mark + ' L = ' + w.L + ' ft, h/b = ' + h + '/' + w.L + ' = ' + f2(w.hb)).join('; ') + '.',
    'C_hb: SW-1 h/b 2.00 ≤ 2 → 1.0; SW-2 1.25 − 0.125 × 2.5 = ' + f4(by['SW-2'].C) + '; SW-3 1.25 − 0.125 × 3.5 = ' + f4(by['SW-3'].C) + '; SW-4 h/b 4.00 > 3.5 → not a shear wall (C_hb = 0, no shear, audit warning).',
    'Reduced capacity at 6" o.c. (312 plf): ' + ok.map(w => w.mark + ' 312 × ' + f4(w.C) + ' = ' + f2(w.cap) + ' plf').join('; ') + '.',
    'Weights v_cap × L: ' + ok.map(w => w.mark + ' ' + f2(w.cap) + ' × ' + w.L + ' = ' + f2(w.wt) + ' lb').join('; ') + '; Σ = ' + f2(W) + ' lb (SW-4 0).',
    'Shares V × wt / Σ: ' + ok.map(w => w.mark + ' ' + f4(w.V) + ' k').join('; ') + '; SW-4 0 k. Unit shears 0.7·V/L: ' + ok.map(w => w.mark + ' ' + f2(w.v) + ' plf').join('; ') + ' — all ≤ their reduced 6" capacity, so 6" o.c. stays.',
    'D/C = v / (312·C_hb) = ' + f4(ok[0].dc) + ' at every sheathed wall (the capacity method gives every wall the same D/C).',
    ...defl.map(e => e.text),
    'SW-4 (h/b 4.00 > 3.5) is not a shear wall: no share, no deflection, not part of the story drift. ' + d1.text + ' The short walls deflect most for their shear (the 8vh³/EAb and h·Δa/b terms grow with h/b): this case keeps its pinned design and verifies the drift NG.',
  ],
  expect: [
    ex('SW-2 C_hb', 'wall:SW-2', 'hbReductionFactor', by['SW-2'].C, 2, 0.0001),
    ex('SW-3 C_hb', 'wall:SW-3', 'hbReductionFactor', by['SW-3'].C, 2, 0.0001),
    ex('SW-4 not a shear wall', 'wall:SW-4', 'hbNotPermitted', true, 2),
    ex('SW-2 reduced capacity (plf)', 'wall:SW-2', 'effectiveSeismicCap', by['SW-2'].cap, 3, 0.01),
    ex('SW-3 reduced capacity (plf)', 'wall:SW-3', 'effectiveSeismicCap', by['SW-3'].cap, 3, 0.01),
    ex('SW-1 weight (lb)', 'wall:SW-1', 'capWeight.E', by['SW-1'].wt, 4, 0.01),
    ex('SW-2 weight (lb)', 'wall:SW-2', 'capWeight.E', by['SW-2'].wt, 4, 0.01),
    ex('SW-3 weight (lb)', 'wall:SW-3', 'capWeight.E', by['SW-3'].wt, 4, 0.01),
    ex('SW-4 weight (lb)', 'wall:SW-4', 'capWeight.E', 0, 4, 0.01),
    ex('SW-1 share (k)', 'wall:SW-1', 'shareExact_1E', by['SW-1'].V, 5),
    ex('SW-3 share (k)', 'wall:SW-3', 'shareExact_1E', by['SW-3'].V, 5),
    ex('SW-4 share (k)', 'wall:SW-4', 'shareExact_1E', 0, 5),
    ex('SW-3 unit shear (plf)', 'wall:SW-3', 'unitShear_seismic', by['SW-3'].v, 5, 0.01),
    ex('SW-2 D/C', 'wall:SW-2', 'dcRatio', by['SW-2'].dc, 6, 0.006),
    ...defl.map((e, i) => ex(e.mark + ' δ at 1.0E (in)', 'wall:' + e.mark, 'deflection.E.delta', e.delta, 7 + i, 0.0005)),
    ...driftExpect(d1, 7 + defl.length),
  ],
  expectChecks: { fail: [], warnings: ['aspect_ratio'] },
  notChecked: 'D/C is compared at ± 0.006 because the engine stores dcRatio rounded to 0.01. Overturning, hardware and posts of the short walls (the chain is covered in V01 / V02). No self-weight (wall DL type blank) to keep the shares clean.',
  // Design pinned as manual overrides (method case): the engine picks at calc v13, frozen 2026-09-30
  pins: {"SW-1":{"nail":"6","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"},"SW-2":{"nail":"6","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"},"SW-3":{"nail":"6","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"},"SW-4":{"nail":"6","hdL":"HDUE3","hdR":"HDUE3","postL":"(2)2x4","postR":"(2)2x4"}},
  inputs: project({
    ...SEISMIC,
    levels: [level('lvl-1', 'Level 1', h)],
    directions: [direction('dir-1', 'N-S', [line({ totalLength: 24, levelLoads: { 'lvl-1': { seismic: String(V), wind: '' } }, gravityLoads: { 'lvl-1': { loads: [] } },
      walls: walls.map(w => wall(w.id, w.mark, 'lvl-1', w.x, w.L, { wallDLTypeId: '' })) })])],
  }),
};
