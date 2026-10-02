// V07 — NDS 2018 end post capacity: selection in catalog order (not by capacity), the HDUE minimum post rule,
// and a line with a 6" wall thickness override
import { project, level, direction, line, wall, ex, pickHD, postCap, POSTS4, f2, f4 } from '../../cases/src/lib.mjs';

// 6" wall posts (Column Check reference), in the order the engine tries them
const POSTS6 = [
  { id: '(2)2x6', d1: 5.5, d2: 3.0, A: 16.5, CF: 1.10 }, { id: '(3)2x6', d1: 5.5, d2: 4.5, A: 24.75, CF: 1.10 },
  { id: '4x6', d1: 5.5, d2: 3.5, A: 19.25, CF: 1.00 }, { id: '6x6', d1: 5.5, d2: 5.5, A: 30.25, CF: 1.00 }, { id: '8x6', d1: 5.5, d2: 7.5, A: 41.25, CF: 1.00 },
];
// HDUE minimum post by wall thickness → its d2 (the engine compares posts by d2)
const MIN = { HDUE3: ['(2)2x4', '(2)2x6'], HDUE5: ['(2)2x4', '(2)2x6'], HDUE7: ['(2)2x4', '(2)2x6'], HDUE9: ['4x4', '4x6'], HDUE13: ['8x4', '8x6'], HDUE17: ['6x4', '6x6'] };
const h = 10, L = 10;
const lines = [
  { name: 'Line A', mark: 'SW-1', V: 2.8, t: '4' },   // C 1.96 k: 2x4 would carry it, the HDUE3 minimum is (2)2x4
  { name: 'Line B', mark: 'SW-2', V: 7.9, t: '4' },   // C 5.53 k: (3)2x4 before 4x4 in the list
  { name: 'Line C', mark: 'SW-3', V: 11, t: '4' },    // HDUE9 → minimum 4x4 (d2 3.5): (3)2x4 still allowed (d2 4.5)
  { name: 'Line D', mark: 'SW-4', V: 15, t: '4' },    // HDUE13 → minimum 8x4
  { name: 'Line E', mark: 'SW-5', V: 10, t: '6' },    // 6" wall override
  { name: 'Line F', mark: 'SW-6', V: 17, t: '6' },    // 6" wall, HDUE13 → minimum 8x6
];
for (const c of lines) {
  c.C = 0.7 * c.V * h / L;                          // no self-weight: T = C = 0.7E end force
  c.hd = pickHD(c.C);
  const list = c.t === '6' ? POSTS6 : POSTS4;
  const minId = MIN[c.hd.id][c.t === '6' ? 1 : 0];
  const minD2 = list.find(p => p.id === minId).d2;
  c.tried = list.filter(p => p.d2 >= minD2 - 1e-9);
  c.post = c.tried.find(p => postCap(p, h).cap >= c.C);
  c.cap = postCap(c.post, h).cap;
  c.minId = minId;
}
const B = lines[1], p3 = postCap(POSTS4[2], h);
const tried = (c) => c.tried.map(p => p.id + ' ' + f2(postCap(p, h).cap)).join(', ');

export default {
  id: 'V07', title: 'End post selection (NDS 2018)', slug: 'nds-post-capacity',
  intent: 'Six one-wall lines whose end compression steps through the post catalog. Proves the NDS 2018 column capacity, that posts are tried in catalog order (not sorted by capacity), that the HDUE minimum post removes smaller posts (compared by the post depth d2), and that a line with a 6" wall override uses the 6" post list.',
  covers: ['NDS 2018 §3.7 column stability (C_P) and §3.10 bearing', 'catalog order selection', 'HDUE minimum post (P9)', 'line wall thickness override'],
  handCalc: [
    'Bottom story h = ' + h + ' ft, walls L = ' + L + ' ft, no self-weight → T = C = 0.7 × V × h / L = 0.7V. DF-L No.1 (F_c 1500, E_min 620,000, F_c⊥ 625 psi), C_D 1.6, K_e 1.0, weak axis braced at 6".',
    'NDS example, (3)2x4 at 10 ft: F_c* = 1500 × 1.6 × 1.15 = ' + Math.round(p3.Fstar) + ' psi; F_cE = 0.822·E_min′/(l_e/d)² with l_e/d = 120/3.5 → ' + Math.round(p3.FcE) + ' psi; C_P = ' + f4(p3.Cp) + ' → F_c′ = ' + Math.round(p3.Fc1) + ' psi; bearing 625 × (4.5 + 0.375)/4.5 = ' + Math.round(p3.Fperp) + ' psi → cap = min × 15.75 in² = ' + f2(p3.cap) + ' k.',
    lines[0].name + ': C = ' + f2(lines[0].C) + ' k → ' + lines[0].hd.id + ', minimum post ' + lines[0].minId + '. 2x4 (2.50 k) would carry it but is below the minimum; tried: ' + tried(lines[0]) + ' → ' + lines[0].post.id + '.',
    B.name + ': C = ' + f2(B.C) + ' k → ' + B.hd.id + ' (min ' + B.minId + '); tried in order ' + tried(B) + ' → ' + B.post.id + ' (4x4 5.83 k is listed after (3)2x4, so it is never reached).',
    lines[2].name + ': C = ' + f2(lines[2].C) + ' k → ' + lines[2].hd.id + ', minimum 4x4 (d2 3.5"): (2)2x4 (d2 3.0") drops out, (3)2x4 (d2 4.5") stays; tried ' + tried(lines[2]) + ' → ' + lines[2].post.id + '.',
    lines[3].name + ': C = ' + f2(lines[3].C) + ' k → ' + lines[3].hd.id + ', minimum 8x4; tried ' + tried(lines[3]) + ' → ' + lines[3].post.id + '.',
    lines[4].name + ' (6" wall override): C = ' + f2(lines[4].C) + ' k → ' + lines[4].hd.id + ', minimum (2)2x6; 6" list at 10 ft: ' + tried(lines[4]) + ' → ' + lines[4].post.id + '.',
    lines[5].name + ' (6" wall): C = ' + f2(lines[5].C) + ' k → ' + lines[5].hd.id + ', minimum 8x6; tried ' + tried(lines[5]) + ' → ' + lines[5].post.id + '.',
  ],
  expect: lines.flatMap((c, i) => [
    { ...ex(c.mark + ' holdown', 'wall:' + c.mark, 'anchorageLeft.id', c.hd.id, i + 3), line: c.name },
    { ...ex(c.mark + ' end post', 'wall:' + c.mark, 'postRight.postLabel', c.post.id, i + 3), line: c.name },
    ...(['Line B', 'Line C', 'Line E'].includes(c.name) ? [{ ...ex(c.mark + ' post capacity (k)', 'wall:' + c.mark, 'postRight.capacityKips', c.cap, i + 3), line: c.name }] : []),
  ]),
  expectChecks: { fail: [] },
  notChecked: 'Nailing and deflection of these lines. Only the governing compression end (right) is listed; the left end uses the same rule.',
  inputs: project({
    levels: [level('lvl-1', 'Level 1', h)],
    directions: [direction('dir-1', 'N-S', lines.map((c, i) => line({ id: 'ln-' + (i + 1), name: c.name, totalLength: 12, wallThickness: c.t === '6' ? '6' : '',
      levelLoads: { 'lvl-1': { seismic: String(c.V), wind: '' } }, gravityLoads: {}, walls: [wall('w-' + (i + 1), c.mark, 'lvl-1', 1, L, { wallDLTypeId: '' })] })))],
  }),
};
