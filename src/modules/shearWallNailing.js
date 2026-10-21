// SDPWS 2021 Table 4.3A — 15/32 WSP Structural 1, 10d common nail.
// All capacities include the 0.92 shear capacity reduction of SDPWS Table 4.3A footnote 10.
// vn = nominal unit shear (plf). ASD: E = vn/2.8, W = vn/2.0. LRFD (SDPWS 2021 §4.1.4.1 / 4.1.4.2): E = 0.5·vn, W = 0.8·vn.
// gaOSB / gaPLY = apparent shear stiffness Ga (kips/in). Both-sides rows already cover two sheathed faces.
// Sorted lightest → heaviest. Single-sided first, then both-sides.
import { NAILING_DATA, NAILING_CG } from './shearWallHardwareData.js';

export const FOOTNOTE_10_FACTOR = 0.92;
export const FOOTNOTE_10_NOTE = 'Shear wall capacities include the 0.92 reduction of SDPWS Table 4.3A footnote 10.';

// Rows are GENERATED from the reference .md (shearWallHardwareData.js). SPF/HF rows: v_n entered × C_G (= 0.92).
export const NAILING_TABLE = NAILING_DATA.dfsp;
export const nailingTable = (group = 'dfsp') => NAILING_DATA[group] || NAILING_DATA.dfsp;
export const nailingCG = (group = 'dfsp') => NAILING_CG[group] ?? 1;

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

export function autoSelectNailing(vSeismicPlf, vWindPlf, hbReduction, loadType, group = 'dfsp') {
  for (const n of nailingTable(group)) {
    const effE = n.asdE * hbReduction;
    const effW = n.asdW * hbReduction;
    let pass = true;
    if ((loadType === 'seismic' || loadType === 'both') && vSeismicPlf > effE) pass = false;
    if ((loadType === 'wind' || loadType === 'both') && vWindPlf > effW) pass = false;
    if (pass) return n;
  }
  return null;
}

export function getNailingById(id, group = 'dfsp') {
  return nailingTable(group).find(n => n.id === id) || null;
}
