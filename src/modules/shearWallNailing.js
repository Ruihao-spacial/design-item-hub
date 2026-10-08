// SDPWS 2021 Table 4.3A — 15/32 WSP Structural 1, 10d common nail.
// All capacities include the 0.92 shear capacity reduction of SDPWS Table 4.3A footnote 10.
// vn = nominal unit shear (plf). ASD: E = vn/2.8, W = vn/2.0. LRFD (SDPWS 2021 §4.1.4.1 / 4.1.4.2): E = 0.5·vn, W = 0.8·vn.
// gaOSB / gaPLY = apparent shear stiffness Ga (kips/in). Both-sides rows already cover two sheathed faces.
// Sorted lightest → heaviest. Single-sided first, then both-sides.
export const FOOTNOTE_10_FACTOR = 0.92;
export const FOOTNOTE_10_NOTE = 'Shear wall capacities include the 0.92 reduction of SDPWS Table 4.3A footnote 10.';

export const NAILING_TABLE = [
  { id: '6',  label: '6" o.c.',          sides: 1, vn:  950, asdE:  312, asdW:  437, lrfdE:  437, lrfdW:  699, gaOSB:  22, gaPLY: 16 },
  { id: '4',  label: '4" o.c.',          sides: 1, vn: 1430, asdE:  470, asdW:  658, lrfdE:  658, lrfdW: 1052, gaOSB:  29, gaPLY: 20 },
  { id: '3',  label: '3" o.c.',          sides: 1, vn: 1860, asdE:  611, asdW:  856, lrfdE:  856, lrfdW: 1369, gaOSB:  36, gaPLY: 22 },
  { id: '2',  label: '2" o.c.',          sides: 1, vn: 2435, asdE:  800, asdW: 1120, lrfdE: 1120, lrfdW: 1792, gaOSB:  51, gaPLY: 28 },
  { id: '4B', label: '4" o.c. (both)',   sides: 2, vn: 2860, asdE:  940, asdW: 1316, lrfdE: 1316, lrfdW: 2105, gaOSB:  58, gaPLY: 40 },
  { id: '3B', label: '3" o.c. (both)',   sides: 2, vn: 3720, asdE: 1222, asdW: 1711, lrfdE: 1711, lrfdW: 2738, gaOSB:  72, gaPLY: 44 },
  { id: '2B', label: '2" o.c. (both)',   sides: 2, vn: 4870, asdE: 1600, asdW: 2240, lrfdE: 2240, lrfdW: 3584, gaOSB: 102, gaPLY: 56 },
];

export const SHEATHING_TYPES = [
  { id: 'ply', label: 'Plywood' },
  { id: 'osb', label: 'OSB' },
];

export function sheathingLabel(id) {
  return (SHEATHING_TYPES.find(s => s.id === id) || SHEATHING_TYPES[0]).label;
}

// Apparent shear stiffness Ga (kips/in) of a nailing row for the project sheathing type
export function gaFor(n, sheathing) {
  if (!n) return 0;
  return sheathing === 'osb' ? n.gaOSB : n.gaPLY;
}

// Nominal unit shear for the FTAO engine, which takes ASD allowable = nominal / 2.0:
// seismic vn/1.4 → vn/2.8; wind vn → vn/2.0. Footnote 10 factor applied, so it matches asdE / asdW.
export function nominalFor(n, loadType) {
  if (!n) return 0;
  return loadType === 'E' ? n.vn * FOOTNOTE_10_FACTOR / 1.4 : n.vn * FOOTNOTE_10_FACTOR;
}

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
