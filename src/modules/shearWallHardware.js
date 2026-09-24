// === HDUE Holdown Catalog (concrete anchorage) ===
// cap = ASD allowable tension (lbs). delta = deflection (in) at the ASD cap, used for 1.0E / 1.0W
// deflection: Δa = delta · T(1.0) / cap. LRFD cap = 1.4 · cap (delta scales the same way).
export const HDUE_TABLE = [
  { id: 'HDUE3',  cap: 3790,  minPost: { '4': '(2)2x4', '6': '(2)2x6' }, delta: 0.127 },
  { id: 'HDUE5',  cap: 5375,  minPost: { '4': '(2)2x4', '6': '(2)2x6' }, delta: 0.146 },
  { id: 'HDUE7',  cap: 7015,  minPost: { '4': '(2)2x4', '6': '(2)2x6' }, delta: 0.154 },
  { id: 'HDUE9',  cap: 8425,  minPost: { '4': '4x4',    '6': '4x6' },    delta: 0.159 },
  { id: 'HDUE13', cap: 12950, minPost: { '4': '8x4',    '6': '8x6' },    delta: 0.145 },
  { id: 'HDUE17', cap: 17685, minPost: { '4': '6x4',    '6': '6x6' },    delta: 0.111 },
];

// === MSTC Strap Catalog (floor-to-floor) ===
// Keyed by floor clear span (inches). ASD allowable tension (lbs). No LRFD value.
// delta is taken as the deflection at the ASD cap (same basis as HDUE — assumption, noted in results).
export const MSTC_TABLE = {
  '16': [
    { id: 'MSTC28', cap: 1535, delta: 0.0808 },
    { id: 'MSTC40', cap: 3070, delta: 0.0970 },
    { id: 'MSTC52', cap: 4610, delta: 0.1188 },
    { id: 'MSTC66', cap: 5850, delta: 0.1296 },
  ],
  '18': [
    { id: 'MSTC28', cap: 1150, delta: 0.0785 },
    { id: 'MSTC40', cap: 2690, delta: 0.0947 },
    { id: 'MSTC52', cap: 4225, delta: 0.1162 },
    { id: 'MSTC66', cap: 5850, delta: 0.1313 },
  ],
  '24': [
    { id: 'MSTC40', cap: 1920, delta: 0.0897 },
    { id: 'MSTC52', cap: 3455, delta: 0.1150 },
    { id: 'MSTC66', cap: 5375, delta: 0.1310 },
    { id: 'MSTC78', cap: 5850, delta: 0.1448 },
  ],
};

export const HDUE_LRFD_FACTOR = 1.4;
// LRFD tension capacity (lbs) — HDUE only; MSTC straps have no LRFD value
export function lrfdCap(hw) {
  return hw && HDUE_TABLE.some(h => h.id === hw.id) ? Math.round(hw.cap * HDUE_LRFD_FACTOR) : null;
}

// === FTAO Wall Strap Catalog (straps above / below openings) ===
// ASD allowable tension (lbs). Fasteners total / end length (in) for DF/SP and SPF/HF framing.
// The app designs with DF-L framing and shows the 0.148" (10d) nail row.
export const FTAO_STRAP_TABLE = [
  { id: 'CS22',    gauge: 22, cap:  845, nails: [{ d: '0.148 x 2½', dfsp: [10, 6], spfhf: [12, 7] }, { d: '0.131 x 2½', dfsp: [12, 7], spfhf: [14, 8] }] },
  { id: 'CS20',    gauge: 20, cap: 1030, nails: [{ d: '0.148 x 2½', dfsp: [12, 7], spfhf: [14, 9] }, { d: '0.131 x 2½', dfsp: [14, 9], spfhf: [16, 9] }] },
  { id: 'CS18',    gauge: 18, cap: 1370, nails: [{ d: '0.148 x 2½', dfsp: [16, 9], spfhf: [18, 11] }, { d: '0.131 x 2½', dfsp: [18, 11], spfhf: [22, 12] }] },
  { id: 'CS16',    gauge: 16, cap: 1705, nails: [{ d: '0.148 x 2½', dfsp: [20, 11], spfhf: [22, 13] }, { d: '0.131 x 2½', dfsp: [22, 13], spfhf: [26, 15] }] },
  { id: 'CS14',    gauge: 14, cap: 2490, nails: [{ d: '0.148 x 2½', dfsp: [26, 15], spfhf: [30, 16] }, { d: '0.131 x 2½', dfsp: [30, 16], spfhf: [36, 19] }] },
  { id: 'CMSTC16', gauge: 16, cap: 4690, nails: [{ d: '0.148 x 3¼', dfsp: [50, 20], spfhf: [50, 25] }] },
  { id: 'CMST14',  gauge: 14, cap: 6475, nails: [{ d: '0.148 x 2½', dfsp: [66, 30], spfhf: [76, 34] }, { d: '0.162 x 2½', dfsp: [56, 26], spfhf: [66, 30] }] },
  { id: 'CMST12',  gauge: 12, cap: 9215, nails: [{ d: '0.148 x 2½', dfsp: [86, 39], spfhf: [98, 44] }, { d: '0.162 x 2½', dfsp: [74, 33], spfhf: [84, 38] }] },
];

// Lightest strap with ASD allowable ≥ demand (lbs); null when none is enough
export function autoSelectFtaoStrap(lbs) {
  if (!(lbs > 0)) return FTAO_STRAP_TABLE[0];
  return FTAO_STRAP_TABLE.find(s => s.cap >= lbs) || null;
}

export function getFtaoStrap(id) {
  return FTAO_STRAP_TABLE.find(s => s.id === id) || null;
}

// 10d (0.148") DF/SP row of a strap: { d, count, endLength }
export function strapNailing(strap) {
  const row = strap && (strap.nails.find(n => n.d.startsWith('0.148')) || strap.nails[0]);
  return row ? { d: row.d, count: row.dfsp[0], endLength: row.dfsp[1] } : null;
}

// Jamb (opening edge) posts: (2)2x minimum, same thickness as the line's wall
export function jambPostOptions(wallThickness) {
  const posts = POST_SIZES[wallThickness] || POST_SIZES['4'];
  return posts.filter(p => p.id !== '2x4');
}

export function autoSelectHoldown(tensionKips) {
  const lbs = tensionKips * 1000;
  if (lbs <= 0) return HDUE_TABLE[0];
  for (const hd of HDUE_TABLE) {
    if (hd.cap >= lbs) return hd;
  }
  return null;
}

export function autoSelectStrap(tensionKips, floorClearSpan) {
  const lbs = tensionKips * 1000;
  const table = MSTC_TABLE[String(floorClearSpan)] || MSTC_TABLE['16'];
  if (lbs <= 0) return table[0];
  for (const s of table) {
    if (s.cap >= lbs) return s;
  }
  return null;
}

// === NDS 2018 Table 4A — Douglas Fir-Larch Grades ===
export const NDS_GRADES = [
  { id: 'dfir_ss', species: 'DF-L', label: 'DF-L Select Structural', Fc: 1700, Fcperp: 625, E: 1900000, Emin: 690000 },
  { id: 'dfir_no1btr', species: 'DF-L', label: 'DF-L No.1 & Btr',       Fc: 1550, Fcperp: 625, E: 1800000, Emin: 660000 },
  { id: 'dfir_no1', species: 'DF-L', label: 'DF-L No.1',              Fc: 1500, Fcperp: 625, E: 1700000, Emin: 620000 },
  { id: 'dfir_no2', species: 'DF-L', label: 'DF-L No.2',              Fc: 1350, Fcperp: 625, E: 1600000, Emin: 582000 },
  { id: 'dfir_no3', species: 'DF-L', label: 'DF-L No.3',              Fc:  775, Fcperp: 625, E: 1400000, Emin: 510000 },
];

// === Post Size Catalog ===
// CF values per NDS Table 4A supplement
export const POST_SIZES = {
  '4': [
    { id: '2x4',    label: '2x4',    d1: 3.5, d2: 1.5, area:  5.25, CF: 1.15 },
    { id: '(2)2x4', label: '(2)2x4', d1: 3.5, d2: 3.0, area: 10.50, CF: 1.15 },
    { id: '(3)2x4', label: '(3)2x4', d1: 3.5, d2: 4.5, area: 15.75, CF: 1.15 },
    { id: '4x4',    label: '4x4',    d1: 3.5, d2: 3.5, area: 12.25, CF: 1.15 },
    { id: '6x4',    label: '6x4',    d1: 3.5, d2: 5.5, area: 19.25, CF: 1.10 },
    { id: '8x4',    label: '8x4',    d1: 3.5, d2: 7.5, area: 26.25, CF: 1.10 },
  ],
  '6': [
    { id: '(2)2x6', label: '(2)2x6', d1: 5.5, d2: 3.0, area: 16.50, CF: 1.10 },
    { id: '(3)2x6', label: '(3)2x6', d1: 5.5, d2: 4.5, area: 24.75, CF: 1.10 },
    { id: '4x6',    label: '4x6',    d1: 5.5, d2: 3.5, area: 19.25, CF: 1.00 },
    { id: '6x6',    label: '6x6',    d1: 5.5, d2: 5.5, area: 30.25, CF: 1.00 },
    { id: '8x6',    label: '8x6',    d1: 5.5, d2: 7.5, area: 41.25, CF: 1.00 },
  ],
};

// NDS 2018 column capacity check
// CD = 1.6 (seismic/wind), CM = Ct = Ci = 1.0
// l2 = 6" (braced by sheathing), Ke = 1.0
const CD = 1.6;
const KE = 1.0;
const L2_IN = 6;
const KM = 1200;
const KT = 0.59;
const C_SAWN = 0.8;

export function computePostCapacity(post, grade, floorHeightFt) {
  const l1 = floorHeightFt * 12;
  const le1 = KE * l1;
  const le2 = KE * L2_IN;

  const FcStar = grade.Fc * CD * post.CF;

  const CT1 = 1 + (KM * le1) / (KT * grade.E);
  const CT2 = 1 + (KM * le2) / (KT * grade.E);

  const EminP1 = grade.Emin * CT1;
  const EminP2 = grade.Emin * CT2;

  const ratio1 = le1 / post.d1;
  const ratio2 = le2 / post.d2;
  const FcE1 = ratio1 > 0 ? 0.822 * EminP1 / (ratio1 * ratio1) : Infinity;
  const FcE2 = ratio2 > 0 ? 0.822 * EminP2 / (ratio2 * ratio2) : Infinity;

  const FcE = Math.min(FcE1, FcE2);
  const R = FcE / FcStar;
  const Cp = (1 + R) / (2 * C_SAWN) - Math.sqrt(Math.pow((1 + R) / (2 * C_SAWN), 2) - R / C_SAWN);
  const FcPrime = FcStar * Cp;

  const CB = (post.d2 + 0.375) / post.d2;
  const FcPerpPrime = grade.Fcperp * CB;

  const FcGovern = Math.min(FcPrime, FcPerpPrime);
  const capacityKips = r2(FcGovern * post.area / 1000);

  return {
    postId: post.id, postLabel: post.label,
    FcStar: r0(FcStar), Cp: r4(Cp), FcPrime: r0(FcPrime),
    CB: r4(CB), FcPerpPrime: r0(FcPerpPrime),
    FcGovern: r0(FcGovern), capacityKips,
    le1, le2, ratio1: r2(ratio1), ratio2: r2(ratio2),
    FcE1: r0(FcE1), FcE2: r0(FcE2), FcE: r0(FcE),
    CT1: r4(CT1), CT2: r4(CT2),
    governedBy: FcPrime <= FcPerpPrime ? 'axial' : 'bearing',
  };
}

export function autoSelectPost(compressionKips, wallThickness, grade, floorHeightFt) {
  const posts = POST_SIZES[wallThickness] || POST_SIZES['4'];
  if (compressionKips <= 0) return computePostCapacity(posts[0], grade, floorHeightFt);
  for (const post of posts) {
    const result = computePostCapacity(post, grade, floorHeightFt);
    if (result.capacityKips >= compressionKips) return result;
  }
  return null;
}

export function getGradeById(id) {
  return NDS_GRADES.find(g => g.id === id) || NDS_GRADES[2];
}

function r0(v) { return Math.round(v); }
function r2(v) { return Math.round(v * 100) / 100; }
function r4(v) { return Math.round(v * 10000) / 10000; }
