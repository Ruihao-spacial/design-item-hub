// ASCE 7-22 lookup tables and helpers for Seismic Base Shear
// Note: Fa/Fv site coefficients are removed in ASCE 7-22.
// SMS, SM1 are provided directly by the USGS Seismic Design Maps tool.

// --- Site Classes (ASCE 7-22 §11.4.3) ---
export const SITE_CLASSES = [
  { key: 'Default', label: 'Default' },
  { key: 'A',       label: 'A — Hard Rock' },
  { key: 'B',       label: 'B — Rock' },
  { key: 'BC',      label: 'BC' },
  { key: 'C',       label: 'C — Very Dense Soil / Soft Rock' },
  { key: 'CD',      label: 'CD' },
  { key: 'D',       label: 'D — Stiff Soil' },
  { key: 'DE',      label: 'DE' },
  { key: 'E',       label: 'E — Soft Clay Soil' },
];

export const GROUND_MOTION_SOURCES = [
  { key: 'asce_hazard', label: 'ASCE Hazard Tool' },
  { key: 'geotech',     label: 'Geotechnical Report' },
];

// --- Table 1.5-2: Importance Factor ---
export const RISK_CATEGORIES = [
  { key: 'I',   label: 'I' },
  { key: 'II',  label: 'II' },
  { key: 'III', label: 'III' },
  { key: 'IV',  label: 'IV' },
];

const IE_MAP = { 'I': 1.0, 'II': 1.0, 'III': 1.25, 'IV': 1.5 };

export function lookupIe(riskCategory) {
  return IE_MAP[riskCategory] || 1.0;
}

// --- Tables 11.6-1 & 11.6-2: Seismic Design Category ---
const SDC_SDS_THRESHOLDS = [0.167, 0.33, 0.50];
const SDC_SD1_THRESHOLDS = [0.067, 0.133, 0.20];
const SDC_LETTERS_LOW  = ['A', 'B', 'C', 'D'];
const SDC_LETTERS_HIGH = ['A', 'C', 'D', 'D'];

function sdcFromValue(value, thresholds, riskCategory) {
  const letters = riskCategory === 'IV' ? SDC_LETTERS_HIGH : SDC_LETTERS_LOW;
  for (let i = 0; i < thresholds.length; i++) {
    if (value < thresholds[i]) return letters[i];
  }
  return letters[letters.length - 1];
}

export function determineSdc(sds, sd1, s1, riskCategory) {
  if (s1 >= 0.75) {
    const sdc = riskCategory === 'IV' ? 'F' : 'E';
    return { sdcFromSds: sdc, sdcFromSd1: sdc, seismicDesignCategory: sdc };
  }
  const fromSds = sdcFromValue(sds, SDC_SDS_THRESHOLDS, riskCategory);
  const fromSd1 = sdcFromValue(sd1, SDC_SD1_THRESHOLDS, riskCategory);
  const order = 'ABCDEF';
  const governing = order.indexOf(fromSds) >= order.indexOf(fromSd1) ? fromSds : fromSd1;
  return { sdcFromSds: fromSds, sdcFromSd1: fromSd1, seismicDesignCategory: governing };
}

// --- Table 12.8-1: Coefficient Cu ---
const CU_ENTRIES = [
  { threshold: 0.4,  cu: 1.4 },
  { threshold: 0.3,  cu: 1.4 },
  { threshold: 0.2,  cu: 1.5 },
  { threshold: 0.15, cu: 1.6 },
  { threshold: 0.1,  cu: 1.7 },
];

export function lookupCu(sd1) {
  for (const entry of CU_ENTRIES) {
    if (sd1 >= entry.threshold) return entry.cu;
  }
  return 1.7;
}

// --- Table 12.8-2: Approximate Period Parameters Ct and x ---
export const PERIOD_TYPES = [
  { key: 'steel_mrf',    label: 'Steel moment-resisting frames',           ct: 0.028, x: 0.8 },
  { key: 'concrete_mrf', label: 'Concrete moment-resisting frames',        ct: 0.016, x: 0.9 },
  { key: 'steel_ebf',    label: 'Steel eccentrically braced frames',       ct: 0.03,  x: 0.75 },
  { key: 'steel_brbf',   label: 'Steel buckling-restrained braced frames', ct: 0.03,  x: 0.75 },
  { key: 'other',        label: 'All other structural systems',            ct: 0.02,  x: 0.75 },
];

// --- Table 12.2-1: Seismic Force-Resisting Systems (ASCE 7-16 values) ---
export const STRUCTURAL_SYSTEMS = [
  // A. Bearing Wall Systems
  { key: 'a1',  group: 'A. Bearing Wall Systems', label: 'Special reinforced concrete shear walls',          r: 5,    omega0: 2.5, cd: 5 },
  { key: 'a2',  group: 'A. Bearing Wall Systems', label: 'Ordinary reinforced concrete shear walls',         r: 4,    omega0: 2.5, cd: 4 },
  { key: 'a7',  group: 'A. Bearing Wall Systems', label: 'Special reinforced masonry shear walls',           r: 5,    omega0: 2.5, cd: 3.5 },
  { key: 'a8',  group: 'A. Bearing Wall Systems', label: 'Intermediate reinforced masonry shear walls',      r: 3.5,  omega0: 2.5, cd: 2.25 },
  { key: 'a9',  group: 'A. Bearing Wall Systems', label: 'Ordinary reinforced masonry shear walls',          r: 2,    omega0: 2.5, cd: 1.75 },
  { key: 'a15', group: 'A. Bearing Wall Systems', label: 'Light-frame (wood) walls w/ wood structural panels', r: 6.5, omega0: 3,   cd: 4 },
  { key: 'a16', group: 'A. Bearing Wall Systems', label: 'Light-frame (CFS) walls w/ wood structural panels',  r: 6.5, omega0: 3,   cd: 4 },
  { key: 'a17', group: 'A. Bearing Wall Systems', label: 'Light-frame walls w/ shear panels of other materials', r: 2, omega0: 2.5, cd: 2 },

  // B. Building Frame Systems
  { key: 'b1',  group: 'B. Building Frame Systems', label: 'Steel eccentrically braced frames',              r: 8,    omega0: 2,   cd: 4 },
  { key: 'b2',  group: 'B. Building Frame Systems', label: 'Steel special concentrically braced frames',     r: 6,    omega0: 2,   cd: 5 },
  { key: 'b3',  group: 'B. Building Frame Systems', label: 'Steel ordinary concentrically braced frames',    r: 3.25, omega0: 2,   cd: 3.25 },
  { key: 'b4',  group: 'B. Building Frame Systems', label: 'Special reinforced concrete shear walls',        r: 6,    omega0: 2.5, cd: 5 },
  { key: 'b5',  group: 'B. Building Frame Systems', label: 'Ordinary reinforced concrete shear walls',       r: 5,    omega0: 2.5, cd: 4.5 },
  { key: 'b16', group: 'B. Building Frame Systems', label: 'Special reinforced masonry shear walls',         r: 5.5,  omega0: 2.5, cd: 4 },
  { key: 'b22', group: 'B. Building Frame Systems', label: 'Light-frame (wood) walls w/ wood structural panels', r: 7, omega0: 2.5, cd: 4.5 },
  { key: 'b23', group: 'B. Building Frame Systems', label: 'Light-frame (CFS) walls w/ wood structural panels',  r: 7, omega0: 2.5, cd: 4.5 },
  { key: 'b25', group: 'B. Building Frame Systems', label: 'Steel buckling-restrained braced frames',        r: 8,    omega0: 2.5, cd: 5 },

  // C. Moment-Resisting Frame Systems
  { key: 'c1',  group: 'C. Moment-Resisting Frames', label: 'Steel special moment frames',                  r: 8,    omega0: 3,   cd: 5.5 },
  { key: 'c2',  group: 'C. Moment-Resisting Frames', label: 'Steel special truss moment frames',            r: 7,    omega0: 3,   cd: 5.5 },
  { key: 'c3',  group: 'C. Moment-Resisting Frames', label: 'Steel intermediate moment frames',             r: 4.5,  omega0: 3,   cd: 4 },
  { key: 'c4',  group: 'C. Moment-Resisting Frames', label: 'Steel ordinary moment frames',                 r: 3.5,  omega0: 3,   cd: 3 },
  { key: 'c5',  group: 'C. Moment-Resisting Frames', label: 'Special reinforced concrete moment frames',    r: 8,    omega0: 3,   cd: 5.5 },
  { key: 'c6',  group: 'C. Moment-Resisting Frames', label: 'Intermediate reinforced concrete moment frames', r: 5,  omega0: 3,   cd: 4.5 },
  { key: 'c7',  group: 'C. Moment-Resisting Frames', label: 'Ordinary reinforced concrete moment frames',   r: 3,    omega0: 3,   cd: 2.5 },

  // D. Dual Systems with Special Moment Frames
  { key: 'd1',  group: 'D. Dual Systems w/ SMF', label: 'Steel eccentrically braced frames',                r: 8,    omega0: 2.5, cd: 4 },
  { key: 'd2',  group: 'D. Dual Systems w/ SMF', label: 'Steel special concentrically braced frames',       r: 7,    omega0: 2.5, cd: 5.5 },
  { key: 'd3',  group: 'D. Dual Systems w/ SMF', label: 'Special reinforced concrete shear walls',          r: 7,    omega0: 2.5, cd: 5.5 },
  { key: 'd12', group: 'D. Dual Systems w/ SMF', label: 'Steel buckling-restrained braced frames',          r: 8,    omega0: 2.5, cd: 5 },

  // Custom
  { key: 'custom', group: 'Other', label: 'Custom / Manual Entry', r: null, omega0: null, cd: null },
];
