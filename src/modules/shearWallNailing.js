// SDPWS Table 4.3A — 15/32 WSP Structural 1, 10d common nail, 0.92 footnote 10 factor
// Sorted lightest → heaviest. Single-sided first, then both-sides.
export const NAILING_TABLE = [
  { id: '6',  label: '6" o.c.',          sides: 1, vn:  950, asdE:  312, asdW:  437, lrfdE:  437, lrfdW:  699 },
  { id: '4',  label: '4" o.c.',          sides: 1, vn: 1430, asdE:  470, asdW:  658, lrfdE:  658, lrfdW: 1052 },
  { id: '3',  label: '3" o.c.',          sides: 1, vn: 1860, asdE:  611, asdW:  856, lrfdE:  856, lrfdW: 1369 },
  { id: '2',  label: '2" o.c.',          sides: 1, vn: 2435, asdE:  800, asdW: 1120, lrfdE: 1120, lrfdW: 1792 },
  { id: '4B', label: '4" o.c. (both)',   sides: 2, vn: 2860, asdE:  940, asdW: 1316, lrfdE: 1316, lrfdW: 2105 },
  { id: '3B', label: '3" o.c. (both)',   sides: 2, vn: 3720, asdE: 1222, asdW: 1711, lrfdE: 1711, lrfdW: 2738 },
  { id: '2B', label: '2" o.c. (both)',   sides: 2, vn: 4870, asdE: 1600, asdW: 2240, lrfdE: 2240, lrfdW: 3584 },
];

export function autoSelectNailing(vSeismicPlf, vWindPlf, hbReduction, loadType) {
  for (const n of NAILING_TABLE) {
    const effE = n.asdE * hbReduction;
    const effW = n.asdW * hbReduction;
    let pass = true;
    if ((loadType === 'seismic' || loadType === 'both') && vSeismicPlf > effE) pass = false;
    if ((loadType === 'wind' || loadType === 'both') && vWindPlf > effW) pass = false;
    if (pass) return n;
  }
  return null;
}

export function getNailingById(id) {
  return NAILING_TABLE.find(n => n.id === id) || null;
}
