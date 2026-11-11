// Shear wall hardware and wood: holdown / strap catalogs, FTAO straps, wood grades, post design.
// The catalog values are GENERATED from the reference .md files (shearWallHardwareData.js, npm run hardware:build);
// this file only shapes them and holds the rules.
import { HDUE_DATA, MSTC_DATA, FTAO_STRAP_DATA, WOOD_GRADES, HW_SOURCES } from './shearWallHardwareData.js';

// === Framing species and groups ===
// Connector catalogs tabulate DF/SP and SPF/HF values; the project species picks the group (user 2026-10-13).
export const SPECIES_GROUPS = [
  { id: 'dfsp',  label: 'DF/SP' },
  { id: 'spfhf', label: 'SPF/HF' },
];
export const SPECIES = [
  { id: 'DF-L', label: 'Douglas Fir-Larch (DF-L)', group: 'dfsp',  defaults: ['dfir_no1', 'dfir_pt_no1'] },
  { id: 'SP',   label: 'Southern Pine (SP)',       group: 'dfsp',  defaults: ['sp_no1', 'sp_pt_no1'] },
  { id: 'SPF',  label: 'Spruce-Pine-Fir (SPF)',    group: 'spfhf', defaults: ['spf_no1no2', 'spf_pt_no1'] },
  { id: 'HF',   label: 'Hem-Fir (HF)',             group: 'spfhf', defaults: ['hf_no1', 'hf_pt_no1'] },
];
export const speciesOf = (id) => SPECIES.find(s => s.id === id) || SPECIES[0];
export const groupLabel = (g) => (SPECIES_GROUPS.find(x => x.id === g) || SPECIES_GROUPS[0]).label;

// Where each table comes from (Hardware tab source blocks). file = Shared Drive: Design Item Hub/Shearwall design reference/<file>
export const HARDWARE_SOURCES = {
  ...HW_SOURCES,
  wswh: { doc: 'Simpson Strong-Tie C-L-SW26, Strong-Wall High-Strength Wood Shearwalls (ESR-2652)', edition: '© 2026', page: 'pp. 40–41 (Table 01), 47 (02), 50 (03)', entered: '', file: 'WSWH/01–03 *.md' },
  sswh: { doc: 'Simpson Strong-Tie C-L-SW26, Strong-Wall High-Strength Steel Shearwall (ESR-1679)', edition: '© 2026', page: 'pp. 13–15 (T11), 19 (T12), 21 (T13), 28 (T14), 27 (T15)', entered: 'Claude for Ruihao / 11/10/2026 (reviewed by the user)', file: 'SSWH/11–16 *.md' },
};

// === NDS 2018 wood grades (Tables 4A / 4B by width / 4D) ===
// kind 'dim' = dimension lumber (studs, plates, 2x / 4x posts); kind 'pt' = posts & timbers 5"x5" and larger.
export const NDS_GRADES = WOOD_GRADES;
export const dimGrades = (species) => WOOD_GRADES.filter(g => g.species === species && g.kind === 'dim');
export const ptGrades = (species) => WOOD_GRADES.filter(g => g.species === species && g.kind === 'pt');
export function getGradeById(id) {
  return WOOD_GRADES.find(g => g.id === id) || WOOD_GRADES.find(g => g.id === 'dfir_no1');
}
export const gradeGroup = (grade) => (grade && grade.group) || 'dfsp';

// The project's wood: species, dimension-lumber grade and posts & timbers grade (schema 13 settings).
// Fcperp / E on the object = the sill plate / stud values (2"–4" wide class for Table 4B) for older callers;
// member-specific values come from memberProps / sillProps.
export function woodBasis(inputs) {
  const sp = speciesOf((inputs && inputs.species) || (getGradeById(inputs && inputs.woodGrade).species));
  const pick = (list, id, fallback) => list.find(g => g.id === id) || list.find(g => g.id === fallback) || list[0];
  const dim = pick(dimGrades(sp.id), inputs && inputs.woodGrade, sp.defaults[0]);
  const pt = pick(ptGrades(sp.id), inputs && inputs.postGrade, sp.defaults[1]);
  const sill = gradeValues(dim, 4);
  return { wood: true, species: sp.id, speciesLabel: sp.label, group: sp.group, dim, pt, id: dim.id, label: dim.label, ptLabel: pt.label,
    Fc: sill.Fc, Fcperp: sill.Fcperp, E: sill.E, Emin: sill.Emin, G: sill.G };
}
// A wood basis from a grade object (older callers / tests passing a grade)
export function asWood(x) {
  if (x && x.wood) return x;
  const g = x && x.id ? x : getGradeById('dfir_no1');
  return woodBasis({ species: g.species, woodGrade: g.kind === 'dim' ? g.id : undefined, postGrade: g.kind === 'pt' ? g.id : undefined });
}

// Reference values of a grade for a member of nominal width w (in): Table 4B is tabulated by width class.
// null when the width class is not entered (e.g. SP 8" wide).
function gradeValues(grade, w) {
  if (!grade.widths) return grade;
  const cls = w <= 4 ? '2-4' : w <= 6 ? '5-6' : String(w);
  return grade.widths[cls] || null;
}
// NDS Table 4A size factor C_F for F_c (by nominal width); Table 4B and 4D values need none (C_F = 1.0)
export function cfTable4A(w) { return w <= 4 ? 1.15 : w <= 6 ? 1.1 : w <= 8 ? 1.05 : 1.0; }

// === Post Size Catalog ===
// d1 = across the wall (wall thickness), d2 = along the wall; w = nominal width for C_F / Table 4B width class;
// pt = 5"x5" and larger (posts & timbers, NDS Table 4D).
export const POST_SIZES = {
  '4': [
    { id: '2x4',    label: '2x4',    d1: 3.5, d2: 1.5, area:  5.25, w: 4 },
    { id: '(2)2x4', label: '(2)2x4', d1: 3.5, d2: 3.0, area: 10.50, w: 4 },
    { id: '(3)2x4', label: '(3)2x4', d1: 3.5, d2: 4.5, area: 15.75, w: 4 },
    { id: '4x4',    label: '4x4',    d1: 3.5, d2: 3.5, area: 12.25, w: 4 },
    { id: '6x4',    label: '6x4',    d1: 3.5, d2: 5.5, area: 19.25, w: 6 },
    { id: '8x4',    label: '8x4',    d1: 3.5, d2: 7.5, area: 26.25, w: 8 },
  ],
  '6': [
    { id: '(2)2x6', label: '(2)2x6', d1: 5.5, d2: 3.0, area: 16.50, w: 6 },
    { id: '(3)2x6', label: '(3)2x6', d1: 5.5, d2: 4.5, area: 24.75, w: 6 },
    { id: '4x6',    label: '4x6',    d1: 5.5, d2: 3.5, area: 19.25, w: 6 },
    { id: '6x6',    label: '6x6',    d1: 5.5, d2: 5.5, area: 30.25, w: 6, pt: true },
    { id: '8x6',    label: '8x6',    d1: 5.5, d2: 7.5, area: 41.25, w: 8, pt: true },
  ],
};
export const postSizeById = (id) => [...POST_SIZES['4'], ...POST_SIZES['6']].find(p => p.id === id) || null;

// Values used for a post member: the P&T grade (Table 4D) for 5"x5" and larger, else the dimension grade
// (Table 4A with C_F, or Table 4B by width with C_F = 1.0). null = not available (no table for that width).
export function memberProps(wood, post) {
  const wb = asWood(wood);
  const grade = post.pt ? wb.pt : wb.dim;
  const v = gradeValues(grade, post.w);
  if (!v) return null;
  const CF = grade.table === '4A' ? cfTable4A(post.w) : 1.0;
  return { Fc: v.Fc, Fcperp: v.Fcperp, E: v.E, Emin: v.Emin, CF, table: grade.table, gradeLabel: grade.label };
}
// Sill plate (always dimension lumber, Table 4A / 4B) of a wall thickness: F_c⊥ for plate crushing and post bearing
export function sillProps(wood, wallThickness) {
  const wb = asWood(wood);
  const v = gradeValues(wb.dim, wallThickness === '6' ? 6 : 4);
  return { Fcperp: v.Fcperp, E: v.E, table: wb.dim.table, gradeLabel: wb.dim.label };
}

// === Holdowns and floor straps (generated catalogs) ===
// Entries: { family, id, cap (ASD, design), lrfdCap (load of δ @ LRFD cap; never a design check), deltaLrfd (δ @ LRFD
// cap: Δa in SDPWS Eq. 4.3-1 = deltaLrfd × T / lrfdCap), minPost: { [wall thickness]: post id } }. Entries are built
// once (identity is stable).
const HDUE_CACHE = {};
export function hdueTable(group = 'dfsp', thickness = '4') {
  const g = HDUE_DATA[group] ? group : 'dfsp', t = thickness === '6' ? '6' : '4';
  const key = g + t;
  if (!HDUE_CACHE[key]) HDUE_CACHE[key] = HDUE_DATA[g][t].map(r => ({ family: 'HDUE', group: g, id: r.id, cap: r.cap, lrfdCap: r.lrfdCap,
    deltaLrfd: r.deltaLrfd, deltaAsd: r.deltaAsd, minPost: { [t]: r.minPost } }));
  return HDUE_CACHE[key];
}
const MSTC_CACHE = {};
export function mstcTable(group = 'dfsp', span = '16') {
  const g = MSTC_DATA[group] ? group : 'dfsp', s = MSTC_DATA[g][String(span)] ? String(span) : '16';
  const key = g + s;
  if (!MSTC_CACHE[key]) MSTC_CACHE[key] = MSTC_DATA[g][s].map(r => ({ family: 'MSTC', group: g, span: s, id: r.id, cap: r.cap, lrfdCap: r.lrfdCap,
    deltaLrfd: r.deltaLrfd, minPost: r.minPost }));
  return MSTC_CACHE[key];
}
export const MSTC_SPANS = Object.keys(MSTC_DATA.dfsp);

// === Floor plate depth (user 2026-11-10, SWD item 1; Shearwall Deisgn Elevation Reference.pdf) ===
// levels are top → bottom. level.floorPlateDepth (in) = the floor framing at the TOP of that story (its top plate to
// the FF above); the top level has none. inputs.groundDepth (in) = 1st FF to TOC under the bottom story (usually 0).
// The floor below a wall = the floorPlateDepth of the next level down (ground for the bottom story). Blank = 0.
const depthIn = (v) => { const d = parseFloat(v); return d > 0 ? d : 0; };
export function floorDepthBelowIn(levels, levelId, groundDepth) {
  const i = (levels || []).findIndex(l => l.id === levelId);
  if (i < 0) return 0;
  return depthIn(i === levels.length - 1 ? groundDepth : levels[i + 1].floorPlateDepth);
}
// MSTC strap table (floor clear span) for the walls of a level: the smallest clear span ≥ the floor plate depth below;
// a blank depth keeps the level's stored floorClearSpan (items saved before the depth existed, default 16").
// over: the depth exceeds the largest table (the largest is used and the caller warns).
export function strapSpanInfo(levels, levelId) {
  const i = (levels || []).findIndex(l => l.id === levelId);
  const lvl = i >= 0 ? levels[i] : {};
  const d = i >= 0 && i < levels.length - 1 ? depthIn(levels[i + 1].floorPlateDepth) : 0;
  if (!(d > 0)) return { span: lvl.floorClearSpan || '16', depth: 0, over: false };
  const spans = [...MSTC_SPANS].sort((a, b) => parseFloat(a) - parseFloat(b));
  const s = spans.find(x => parseFloat(x) >= d - 1e-9);
  return { span: s || spans[spans.length - 1], depth: d, over: !s };
}
export const strapSpanOf = (levels, levelId) => strapSpanInfo(levels, levelId).span;

// === Double holdowns / straps (user 2026-11-09) ===
// Two of the same HDUE or MSTC at one end (no mixing): ASD and LRFD caps × 2; each device takes T / 2 with its own
// δ @ LRFD cap, so δ_LRFD stays and Δa = δ_LRFD × T / (2·T_LRFD); minimum post = the single device's. Id "(2)" + id.
// Singles carry no qty field (stored results of existing items stay identical); anchorageQty(a) reads it.
const DOUBLE_CACHE = new Map();
export function doubleOf(a) {
  if (!a || a.qty === 2) return a;
  if (!DOUBLE_CACHE.has(a)) DOUBLE_CACHE.set(a, { ...a, id: '(2)' + a.id, qty: 2, singleId: a.id, cap: 2 * a.cap,
    lrfdCap: a.lrfdCap > 0 ? 2 * a.lrfdCap : a.lrfdCap });
  return DOUBLE_CACHE.get(a);
}
export const anchorageQty = (a) => (a && a.qty === 2 ? 2 : 1);
export const singleIdOf = (a) => (a && a.singleId) || (a && a.id);
// Selection ladder (auto-select, drift sizing, larger-size trials): the singles, then the doubles stronger than the
// largest single, by capacity — light to heavy, so a double is picked only when no single is enough.
const LADDER_CACHE = new Map();
function ladderOf(singles) {
  if (!LADDER_CACHE.has(singles)) {
    const top = Math.max(...singles.map(a => a.cap));
    LADDER_CACHE.set(singles, [...singles, ...singles.map(doubleOf).filter(d => d.cap > top).sort((a, b) => a.cap - b.cap)]);
  }
  return LADDER_CACHE.get(singles);
}
// Every choice for a manual override: the singles, then every double
const OPTIONS_CACHE = new Map();
function optionsOf(singles) {
  if (!OPTIONS_CACHE.has(singles)) OPTIONS_CACHE.set(singles, [...singles, ...singles.map(doubleOf)]);
  return OPTIONS_CACHE.get(singles);
}
export const hdueLadder = (group, thickness) => ladderOf(hdueTable(group, thickness));
export const mstcLadder = (group, span) => ladderOf(mstcTable(group, span));
export const hdueOptions = (group, thickness) => optionsOf(hdueTable(group, thickness));
export const mstcOptions = (group, span) => optionsOf(mstcTable(group, span));

// DF/SP 4" HDUE and DF/SP MSTC by span (older callers, tests)
export const HDUE_TABLE = hdueTable('dfsp', '4');
export const MSTC_TABLE = Object.fromEntries(MSTC_SPANS.map(s => [s, mstcTable('dfsp', s)]));

// LRFD cap (lb) paired with δ @ LRFD cap — reported, never a design check
export function lrfdCap(hw) {
  return hw && hw.lrfdCap > 0 ? hw.lrfdCap : null;
}
// δ @ LRFD cap of a holdown / strap (in) — the table value (display)
export function anchorageSlip(hw) {
  return hw && hw.deltaLrfd > 0 ? hw.deltaLrfd : 0;
}
// Flexibility δ_LRFD / T_LRFD (in/lb) of the LRFD pair
export function anchorageFlex(hw) {
  return hw && hw.deltaLrfd > 0 && hw.lrfdCap > 0 ? hw.deltaLrfd / hw.lrfdCap : 0;
}
// Δa (in) of a holdown / strap in SDPWS Eq. 4.3-1 at the 1.0-level tension T (lb): linear from the LRFD pair,
// Δa = δ_LRFD × T / T_LRFD (user 2026-10-14; replaces "δ @ LRFD cap used directly"). T above the LRFD cap = extrapolated
// (overLrfdCap → warning sign); T ≤ 0 → 0.
export function anchorageDelta(hw, Tlb) {
  return Tlb > 0 ? anchorageFlex(hw) * Tlb : 0;
}
// T (lb, 1.0E / 1.0W) above the LRFD cap: δ @ LRFD cap is not valid above that load → warning sign (no NG, no upsizing)
export function overLrfdCap(hw, Tlb) {
  return !!(hw && hw.lrfdCap > 0 && Tlb > hw.lrfdCap + 0.5);
}

export function autoSelectHoldown(tensionKips, group = 'dfsp', thickness = '4') {
  const table = hdueLadder(group, thickness);
  const lbs = tensionKips * 1000;
  if (lbs <= 0) return table[0];
  return table.find(hd => hd.cap >= lbs) || null;
}

export function autoSelectStrap(tensionKips, floorClearSpan, group = 'dfsp') {
  const table = mstcLadder(group, floorClearSpan);
  const lbs = tensionKips * 1000;
  if (lbs <= 0) return table[0];
  return table.find(s => s.cap >= lbs) || null;
}

// === FTAO Wall Strap Catalog (straps above / below openings) ===
// ASD allowable tension (lbs), the same for both framing groups; fasteners [count, end length (in)] per group.
// lengthFt = coil / total length (ft).
export const FTAO_STRAP_TABLE = FTAO_STRAP_DATA;

// Lightest strap with ASD allowable ≥ demand (lbs); null when none is enough
export function autoSelectFtaoStrap(lbs) {
  if (!(lbs > 0)) return FTAO_STRAP_TABLE[0];
  return FTAO_STRAP_TABLE.find(s => s.cap >= lbs) || null;
}

export function getFtaoStrap(id) {
  return FTAO_STRAP_TABLE.find(s => s.id === id) || null;
}

// 10d (0.148") row of a strap for the framing group: { d, count, endLength }
export function strapNailing(strap, group = 'dfsp') {
  const row = strap && (strap.nails.find(n => n.d.startsWith('0.148')) || strap.nails[0]);
  const g = group === 'spfhf' ? 'spfhf' : 'dfsp';
  return row ? { d: row.d, count: row[g][0], endLength: row[g][1] } : null;
}

// Jamb (opening edge) posts: (2)2x minimum, same thickness as the line's wall
export function jambPostOptions(wallThickness) {
  const posts = POST_SIZES[wallThickness] || POST_SIZES['4'];
  return posts.filter(p => p.id !== '2x4');
}

// NDS 2018 column capacity check
// CD = 1.6 (seismic/wind), CM = Ct = Ci = 1.0
// l2 = 6" (braced by sheathing), Ke = 1.0
const CD = 1.6;
const KE = 1.0;
const L2_IN = 6;
const KM = 1200;
const KT = 0.59;
const C_SAWN = 0.8;

// wood: woodBasis (or a grade). Member values per memberProps (Table 4A / 4B / 4D). null when the member is not available
// for the species. Capacity = F_c′ × A (column only): sill plate bearing is not a design check for any post (user
// 2026-11-09, CALC v25); F_c⊥′ on the sill (Table 4A / 4B, wall thickness = the post's d1) is reported for information.
// C_b (NDS 3.10.4) = (l_b + 0.375) / l_b for l_b < 6 in, else 1.0; l_b = d2 (the post along the sill).
export function computePostCapacity(post, wood, floorHeightFt) {
  const m = memberProps(wood, post);
  if (!m) return null;
  const sill = sillProps(wood, post.d1 >= 5 ? '6' : '4');
  const l1 = floorHeightFt * 12;
  const le1 = KE * l1;
  const le2 = KE * L2_IN;

  const FcStar = m.Fc * CD * m.CF;

  const CT1 = 1 + (KM * le1) / (KT * m.E);
  const CT2 = 1 + (KM * le2) / (KT * m.E);

  const EminP1 = m.Emin * CT1;
  const EminP2 = m.Emin * CT2;

  const ratio1 = le1 / post.d1;
  const ratio2 = le2 / post.d2;
  const FcE1 = ratio1 > 0 ? 0.822 * EminP1 / (ratio1 * ratio1) : Infinity;
  const FcE2 = ratio2 > 0 ? 0.822 * EminP2 / (ratio2 * ratio2) : Infinity;

  const FcE = Math.min(FcE1, FcE2);
  const R = FcE / FcStar;
  const Cp = (1 + R) / (2 * C_SAWN) - Math.sqrt(Math.pow((1 + R) / (2 * C_SAWN), 2) - R / C_SAWN);
  const FcPrime = FcStar * Cp;

  const CB = post.d2 < 6 ? (post.d2 + 0.375) / post.d2 : 1.0;
  const FcPerpPrime = sill.Fcperp * CB; // information only (not a design check)

  const FcGovern = FcPrime;
  const capacityKips = r2(FcGovern * post.area / 1000);

  return {
    postId: post.id, postLabel: post.label,
    table: m.table, gradeLabel: m.gradeLabel, Fc: m.Fc, CF: m.CF, E: m.E, Emin: m.Emin, sillFcperp: sill.Fcperp,
    FcStar: r0(FcStar), Cp: r4(Cp), FcPrime: r0(FcPrime),
    CB: r4(CB), FcPerpPrime: r0(FcPerpPrime),
    FcGovern: r0(FcGovern), capacityKips,
    le1, le2, ratio1: r2(ratio1), ratio2: r2(ratio2),
    FcE1: r0(FcE1), FcE2: r0(FcE2), FcE: r0(FcE),
    CT1: r4(CT1), CT2: r4(CT2),
    governedBy: 'axial',
  };
}

// Anchorage minimum post (catalog minPost: HDUE by size and wall width, MSTC floor straps (2)2x). At a holdown / strap
// end the post is never narrower along the wall (d2) than this, in the line's wall thickness. No minPost → null.
export function hdueMinPost(anchorage, wallThickness) {
  if (!anchorage || !anchorage.minPost) return null;
  const t = POST_SIZES[wallThickness] ? wallThickness : '4';
  const id = anchorage.minPost[t];
  return id ? POST_SIZES[t].find(p => p.id === id) || null : null;
}

// true when a post (catalog entry or capacity result) is at least the minimum post
export function meetsMinPost(post, minPost) {
  if (!minPost || !post) return true;
  const ps = postSizeById(post.postId || post.id);
  return !!ps && ps.d2 >= minPost.d2 - 1e-9;
}

export function autoSelectPost(compressionKips, wallThickness, wood, floorHeightFt, minPost = null) {
  const posts = (POST_SIZES[wallThickness] || POST_SIZES['4']).filter(p => meetsMinPost(p, minPost));
  for (const post of posts) {
    const result = computePostCapacity(post, wood, floorHeightFt);
    if (!result) continue; // not available for the species (e.g. SP 8" wide)
    if (compressionKips <= 0 || result.capacityKips >= compressionKips) return result;
  }
  return null;
}

function r0(v) { return Math.round(v); }
function r2(v) { return Math.round(v * 100) / 100; }
function r4(v) { return Math.round(v * 10000) / 10000; }
