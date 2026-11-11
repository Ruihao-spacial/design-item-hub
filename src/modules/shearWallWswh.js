// Simpson Strong-Wall WSWH (high-strength wood shearwall) — table lookup, stacked base moment check,
// anchor selection. Rules from the WSWH reference folder 00_README (§4 lookup rules, §5 stacked panels)
// and Table 06 (anchorage, cracked concrete). Data: shearWallWswhData.js (generated).
import { WSWH_T01, WSWH_T02, WSWH_T03, WSWH_T07, WSWH_EVAL_ORDER, WSWH_ARM, WSWH_KITS, WSWH_ANCHORS } from './shearWallWswhData.js';
import { SSWH_T11, SSWH_T12, SSWH_T13, SSWH_T14, SSWH_T15, SSWH_ARM, SSWH_KITS } from './shearWallSswhData.js';

export const WSWH_WIDTHS = ['12', '18', '24'];
export const WSWH_CONDITIONS = [
  { id: 'concrete', label: 'Concrete foundation (T01)' },
  { id: 'raised', label: 'Raised wood floor (T02)' },
  { id: 'stackedUpper', label: 'Two-story stacked — 2nd story (T03)' },
];
export const WSWH_JOISTS = [{ id: '12', label: 'Joist ≤ 12"' }, { id: '16', label: 'Joist 12"–16" (× 0.92)' }];
export const WSWH_FC = ['2500', '3000', '4500'];
// Stacked 2nd-story panel hold-down = the two-story connection kit WSWH-TSS12/18/24KT (Table 05-D, Table 03 n.7).
// No tension capacity is published: the kit works when the panel passes Table 03 (P₂ ≤ 2,000 lb, shear, drift) —
// user 2026-10-27. T is reported; no anchor D/C.
export const tssKitAnchor = (width, family = 'WSWH') => {
  const kits = family === 'SSWH' ? SSWH_KITS : WSWH_KITS;
  const kit = (kits.find(r => r.width_in === width) || {}).stackedKit || family + '-TSS kit';
  return { id: kit, cap: 0, delta: 0, wswhAnchor: true, byKit: true };
};
// No B and no tension check at the 2nd story (user 2026-11-10): the panel's overturning is carried into the stack base
// moment; the hold-down is the kit. The panel's lateral end forces are not calculated.
// A stacked 2nd-story Strong-Wall result: its lateral T / C are not calculated (deferred — the TSS kit works; the
// overturning is in the stack base moment). Displays show DEFERRED_TEXT instead of 0 (user 2026-11-10).
export const lateralDeferred = (wr) => !!(wr && wr.method === 'wswh' && wr.wswh && wr.wswh.role === 'stackedUpper' && wr.wswh.lowerId);
export const DEFERRED_TEXT = 'not calc / deferred (TSS kit)';
export const TSS_KIT_NOTE = 'Two-story connection kit: no tension check — the panel\'s overturning is carried into the stack base moment (user 2026-11-10); OK when the 2nd-story panel passes its table (P₂ ≤ 2,000 lb, shear, drift).';
export const RAISED_JOIST_FACTOR = 0.92;

// === Simpson Strong-Wall SSWH (high-strength steel shearwall), SWD item 7 (user 2026-11-10) — same rules, own tables ===
export const SSWH_WIDTHS = ['12', '15', '18', '21', '24'];
export const SSWH_CONDITIONS = [
  { id: 'concrete', label: 'Concrete foundation (T11)' },
  { id: 'portal', label: 'Garage portal with SSWH-PKT (T12)' },
  { id: 'raised', label: 'First story on a wood floor (T13)' },
  { id: 'stackedUpper', label: 'Two-story stacked — 2nd story (T14)' },
];
export const SSWH_WOOD_JOISTS = [{ id: '12', label: 'Joist ≤ 12"' }, { id: '16', label: 'Joist 12"–16" (× 0.91)' }];
export const SSWH_UPPER_JOISTS = [{ id: '14', label: 'Joist ≤ 14"' }, { id: '18', label: 'Joist 14"–18" (× 0.96)' }];
export const SSWH_RIMS = [{ id: 'LSL', label: 'LSL rim joist / blocking' }, { id: 'DFL', label: 'DFL rim joist / blocking' }];
export const SSWH_FACTORS = { woodJoist16: 0.91, woodDFL: 0.84, upperJoist18: 0.96, upperDFL: 0.95 };

// A Strong-Wall panel of either family (WSWH wood, SSWH steel) — one code path, the family picks the tables
export const isWswh = (w) => !!w && (w.systemType === 'wswh' || w.systemType === 'sswh');
export const isSswh = (w) => !!w && w.systemType === 'sswh';
export const familyOf = (w) => (isSswh(w) ? 'SSWH' : 'WSWH');
export const widthsOf = (family) => (family === 'SSWH' ? SSWH_WIDTHS : WSWH_WIDTHS);
export const conditionsOf = (family) => (family === 'SSWH' ? SSWH_CONDITIONS : WSWH_CONDITIONS);
export const wswhWidthIn = (w) => (widthsOf(familyOf(w)).includes(String(w.wswhWidth)) ? Number(w.wswhWidth) : 18);
export const wswhWidthFt = (w) => wswhWidthIn(w) / 12;
export const conditionLabel = (id, family = 'WSWH') => (conditionsOf(family).find(c => c.id === id) || { label: id }).label;
export const panelPostOf = (family) => (family === 'SSWH' ? { postId: 'sswh', postLabel: 'SSWH panel', capacityKips: 0, wswh: true } : WSWH_PANEL_POST);
const FAM = {
  WSWH: { tables: { concrete: ['T01', WSWH_T01], raised: ['T02', WSWH_T02], stackedUpper: ['T03', WSWH_T03] }, stack: ['T07', WSWH_T07, 'C-L-SW26 p. 50'] },
  SSWH: { tables: { concrete: ['T11', SSWH_T11], portal: ['T12', SSWH_T12], raised: ['T13', SSWH_T13], stackedUpper: ['T14', SSWH_T14] }, stack: ['T15', SSWH_T15, 'C-L-SW26 p. 27'] },
};
const P_AXIS = new Set(['T01', 'T11', 'T12']);
export const SSWH_NOTES = [
  'Strong-Wall SSWH values: Simpson C-L-SW26 (2026) pp. 11–29 / ICC-ES ESR-1679; ESR-1679 covers the 2021 IBC / IRC (CBC / CRC 2022 basis; user 2026-11-10).',
  'Seismic values are based on R = 6.5. LRFD-equivalent values are derived (seismic ASD/0.7, wind ASD/0.6), not Simpson-published.',
  'Anchor arm B: concrete and stack base per C-L-SW26 p. 15 n.9 as printed (7.75 / 9.5 / 12 / 14.675 / 17.5 in); the tabulated T implies 8⅛ / 10⅜ / 12⅝ in for SSWH12 / 15 / 18 — conservative, follow up with Simpson. Wood floor B = W − 4 (p. 21 n.9); portal T = k·V·H/B − P/2 (p. 19 n.10).',
  'Anchors: SWH-AB, Table 06 (shared with WSWH), cracked concrete. Footing length L by others for SSWH15 / 21. Garage portal header and its induced moment (10 % of the base moment for SSWH12 / 15, p. 18) by the designer.',
  'Stacked 2nd story: SSWH-TSS_KT. ' + TSS_KIT_NOTE,
];

export const WSWH_NOTES = [
  'Strong-Wall WSWH values: Simpson C-L-SW26 (2026) / ICC-ES ESR-2652; ESR-2652 covers the 2021 IBC / IRC (CBC / CRC 2022 basis).',
  'Seismic values are based on R = 6.5. LRFD-equivalent values are derived (seismic ASD/0.7, wind ASD/0.6; concrete-governed anchor rows ASD × α, α = 1.4 assumed — not published), not Simpson-published.',
  'Drift at the 1.0 level is linear in V from the LRFD cap with its drift: Δ = Δ_LRFD·V/V_LRFD (stacked base: Δ_0,LRFD·M_d/M_allow,LRFD); a warning sign when V > V_LRFD. Tables 03 and 06 checked against C-L-SW26 pp. 50 and 86–87.',
  'Anchors: Table 06, cracked concrete. Anchor bolt length / HSR extension and edge shear anchorage: per Simpson details, by others (not checked by this tool).',
  'Stacked 2nd story: WSWH-TSS12/18/24KT. ' + TSS_KIT_NOTE,
];

const lerp = (a, b, t) => a + (b - a) * t;
const COLS = ['He_in', 'V_ASDcap_S', 'Delta_ASDcap_S', 'T_ASDcap_S', 'V_ASDcap_W', 'Delta_ASDcap_W', 'T_ASDcap_W',
  'V_LRFDcap_S', 'Delta_LRFDcap_S', 'V_LRFDcap_W', 'Delta_LRFDcap_W'];
const mix = (r1, r2, t) => Object.fromEntries(COLS.map(k => [k, r2 == null || r1[k] == null ? r1[k] : lerp(r1[k], r2[k], t)]));
const ofWidth = (rows, width, family = 'WSWH') => rows.filter(r => r.model.startsWith(family + width + 'x'));

// T01 rows of one nominal height at vertical load P (ASD lb): P below the first row uses it; above the last = not tabulated
// soft (SSWH, user 2026-11-10): above the last row → that row and a warning instead of an error
function atP(rows, P, soft = false) {
  const s = [...rows].sort((a, b) => a.P_lb - b.P_lb);
  if (P <= s[0].P_lb) return { row: mix(s[0], null, 0) };
  const last = s[s.length - 1];
  if (P > last.P_lb + 1e-6) {
    if (soft) return { row: mix(last, null, 0), warn: 'P = ' + Math.round(P) + ' lb exceeds the tabulated ' + last.P_lb + ' lb at ' + last.model + ' — the ' + last.P_lb + ' lb row is used' };
    return { error: 'P = ' + Math.round(P) + ' lb exceeds the tabulated ' + last.P_lb + ' lb at ' + last.model + ' (not permitted)' };
  }
  for (let i = 0; i < s.length - 1; i++) {
    if (P <= s[i + 1].P_lb) return { row: mix(s[i], s[i + 1], (P - s[i].P_lb) / (s[i + 1].P_lb - s[i].P_lb)) };
  }
  return { row: mix(last, null, 0) };
}

// The table rows one panel reads: its table (by condition), width, f'c table (T01) and the tabulated nominal heights
// n1 ≤ h ≤ n2 around the floor-to-floor height. error when the width or height is not tabulated.
function wswhBracket({ family = 'WSWH', width, condition, ftfFt, fc = 2500 }) {
  const lower = condition === 'stackedLower';
  const F = FAM[family];
  const [id, table] = F.tables[lower ? 'concrete' : condition] || F.tables.concrete;
  const out = { table: id };
  out.fcTab = lower ? 2500 : id === 'T12' ? [4000, 3000, 2500].find(t => Number(fc) >= t) || 2500 : (Number(fc) >= 3000 ? 3000 : 2500);
  let rows = ofWidth(table, width, family);
  if (P_AXIS.has(id)) rows = rows.filter(r => r.fc_psi === out.fcTab);
  if (!rows.length) { out.error = family + width + ' is not tabulated for ' + conditionLabel(condition, family); return out; }
  const noms = [...new Set(rows.map(r => r.nominal_ft))].sort((a, b) => a - b);
  const h = Number(ftfFt) || 0;
  if (h < noms[0] - 1e-6 || h > noms[noms.length - 1] + 1e-6) {
    out.error = 'Floor-to-floor ' + h + ' ft is outside the tabulated ' + family + width + ' heights (' + noms[0] + '–' + noms[noms.length - 1] + ' ft, ' + out.table + ')';
    return out;
  }
  let n1 = noms[0], n2 = noms[0];
  for (let i = 0; i < noms.length; i++) {
    if (noms[i] <= h + 1e-6) n1 = noms[i];
    if (noms[i] >= h - 1e-6) { n2 = noms[i]; break; }
  }
  Object.assign(out, { rows, h, n1, n2 });
  return out;
}

// Rows of the reference table one panel uses (PDF Design data appendix): every P row at the bracketing heights.
export function wswhRowsUsed({ family = 'WSWH', width, condition, ftfFt, fc }) {
  if (condition === 'stackedLower') { const m = stackMoment(width, Number(ftfFt) || 0, family); return { table: FAM[family].stack[0], rows: m.error ? [] : m.rows }; }
  const b = wswhBracket({ family, width, condition, ftfFt, fc });
  return b.error ? { table: b.table, rows: [] } : { table: b.table, rows: b.rows.filter(r => r.nominal_ft === b.n1 || r.nominal_ft === b.n2) };
}

// Panel values for one wall. condition: concrete | raised | stackedUpper | stackedLower (base of a stack)
// ftfFt = level floor-to-floor = nominal height (interpolated between tabulated heights).
// P_lb: ASD vertical load on the panel (T01 axis; limits for T02 / T03). joist: '12' | '16' (raised floor).
export function lookupWswh({ family = 'WSWH', width, condition, ftfFt, P_lb = 0, fc = 2500, joist = '12', rim = 'LSL' }) {
  const out = { width, condition, notes: [], error: null };
  const lower = condition === 'stackedLower';
  const sswh = family === 'SSWH';
  const br = wswhBracket({ family, width, condition, ftfFt, fc });
  out.table = br.table;
  if (br.error) { out.error = br.error; return out; }
  const { rows, h, n1, n2, fcTab } = br;
  const t = n2 > n1 ? (h - n1) / (n2 - n1) : 0;
  out.warnings = [];
  const rowAt = (n) => {
    const rs = rows.filter(r => r.nominal_ft === n);
    if (P_AXIS.has(out.table)) return atP(rs, lower ? 4000 : P_lb, sswh);
    return { row: mix(rs[0], null, 0) };
  };
  const a = rowAt(n1), b = rowAt(n2);
  if (a.error || b.error) { out.error = a.error || b.error; return out; }
  if (!lower && (a.warn || b.warn)) out.warnings.push(a.warn || b.warn);
  const v = mix(a.row, b.row, t);

  if (!sswh && condition === 'raised' && P_lb > 2000 + 1e-6) { out.error = 'P = ' + Math.round(P_lb) + ' lb exceeds 2,000 lb (raised floor, Table 02 n.3)'; return out; }
  // Stacked panels: the published tables are at P₂ ≤ 2,000 / P₁ ≤ 4,000 lb (p. 50 n.5) — above that a warning, the
  // panel keeps its tabulated values (user 2026-11-10; no interpolation on P)
  if (sswh) {
    if (condition === 'raised' && P_lb > 2000 + 1e-6) out.warnings.push('P = ' + Math.round(P_lb) + ' lb exceeds 2,000 lb — the wood floor table (T13) is based on 2,000 lb (p. 21 n.4)');
    if (condition === 'stackedUpper' && P_lb > 2000 + 1e-6) out.warnings.push('P₂ = ' + Math.round(P_lb) + ' lb exceeds 2,000 lb — the stacked 2nd-story table (T14) is based on 2,000 lb (p. 28 n.5)');
    if (lower && P_lb > 4000 + 1e-6) out.warnings.push('P₁ = ' + Math.round(P_lb) + ' lb exceeds 4,000 lb — the allowable base moment (T15) is based on 4,000 lb (p. 28 n.5)');
  } else {
    if (condition === 'stackedUpper' && P_lb > 2000 + 1e-6) out.warnings.push('P₂ = ' + Math.round(P_lb) + ' lb exceeds 2,000 lb — the stacked 2nd-story table is based on 2,000 lb (p. 50 n.5)');
    if (lower && P_lb > 4000 + 1e-6) out.warnings.push('P₁ = ' + Math.round(P_lb) + ' lb exceeds 4,000 lb — the allowable base moment (Table 07) is based on 4,000 lb (p. 50 n.5)');
  }
  let factor = 1;
  if (!sswh && condition === 'raised' && String(joist) === '16') { factor = RAISED_JOIST_FACTOR; out.notes.push('Joist 12"–16": V × 0.92 (Table 02 n.6)'); }
  if (sswh && condition === 'raised') {
    if (String(joist) === '16') { factor *= SSWH_FACTORS.woodJoist16; out.notes.push('Joist 12"–16": V × 0.91 (T13, p. 21 n.7)'); }
    if (rim === 'DFL') { factor *= SSWH_FACTORS.woodDFL; out.notes.push('DFL rim joist and blocking: V × 0.84 (T13, p. 21 n.5)'); }
  }
  if (sswh && condition === 'stackedUpper') {
    if (String(joist) === '18') { factor *= SSWH_FACTORS.upperJoist18; out.notes.push('Joist 14"–18": V × 0.96 (T14, p. 28 n.8)'); }
    if (rim === 'DFL') { factor *= SSWH_FACTORS.upperDFL; out.notes.push('DFL rim joist and blocking: V × 0.95 (T14, p. 28 n.7)'); }
  }

  const exact = t === 0 || n1 === n2;
  const modelAt = (n) => family + width + 'x' + n;
  out.He = v.He_in;
  out.nominal = h;
  out.evalModel = exact ? modelAt(n1) : modelAt(n1) + '–x' + n2 + ' (interp.)';
  const order = sswh ? null : WSWH_EVAL_ORDER.find(r => r.eval_model === modelAt(n2));
  out.orderModel = order ? order.order_model : modelAt(n2) + (sswh && lower ? '-STK' : sswh && condition === 'portal' ? ' w/ SSWH-PKT' : '');
  out.V = { E: v.V_ASDcap_S * factor, W: v.V_ASDcap_W * factor };          // ASD allowable shear (lb)
  out.D = { E: v.Delta_ASDcap_S * factor, W: v.Delta_ASDcap_W * factor };  // drift at V (in); scales with V
  // LRFD cap with its drift (user 2026-10-13, option B): drift at the 1.0 level = Δ_LRFD × V / V_LRFD (linear)
  out.VL = { E: v.V_LRFDcap_S * factor, W: v.V_LRFDcap_W * factor };
  out.DL = { E: v.Delta_LRFDcap_S * factor, W: v.Delta_LRFDcap_W * factor };
  out.T0 = { E: v.T_ASDcap_S == null ? null : v.T_ASDcap_S * factor, W: v.T_ASDcap_W == null ? null : v.T_ASDcap_W * factor };
  if (sswh) {
    const arm = SSWH_ARM.find(r => r.width_in === width);
    // concrete / stack base: p. 15 n.9 as printed (user 2026-11-10); portal p. 19 n.10; wood floor W − 4 (p. 21 n.9)
    out.B = condition === 'raised' ? arm.B_wood_in : condition === 'portal' ? arm.B_portal_in : condition === 'stackedUpper' ? arm.B_stacked_upper_in
      : lower ? arm.B_stacked_base_in : arm.B_concrete_in;
    // portal T = (k·V·H)/B − P/2: k = 0.90 for SSWH12 / 15 with H_e ≤ 93¼", else 1.00 (p. 19 n.10)
    out.k = condition === 'portal' ? (width <= 15 && v.He_in <= 93.25 + 1e-9 ? 0.9 : 1) : 1;
    if (condition === 'portal') out.notes.push('Portal: T = k·V·H/B − P/2 with k = ' + out.k.toFixed(2) + ' (T12, p. 19 n.10); header and its induced moment by the designer (p. 18)');
    const kit = SSWH_KITS.find(r => r.width_in === width);
    out.kit = condition === 'raised' ? kit.woodFloorKit : condition === 'portal' ? kit.portalKit : (condition === 'stackedUpper' || lower) ? kit.stackedKit : '';
  } else {
    const arm = WSWH_ARM.find(r => r.width_in === width);
    // stacked 2nd story: TSS rod arm (C-L-SW26 p. 47 n.8, user 2026-10-27); the stack base keeps the concrete B
    out.B = condition === 'raised' ? arm.B_raised_in : condition === 'stackedUpper' ? arm.B_stacked_in : arm.B_concrete_in;
    const kit = WSWH_KITS.find(r => r.width_in === width);
    out.kit = condition === 'raised' ? kit.raisedKit : (condition === 'stackedUpper' || lower) ? kit.stackedKit : '';
  }
  if (!exact) out.notes.push('Interpolated between ' + modelAt(n1) + ' and ' + modelAt(n2) + ' (H_e ' + v.He_in.toFixed(2) + '")');
  if (P_AXIS.has(out.table) && !lower && fcTab !== Number(fc)) out.notes.push("f'c " + fc + ' psi uses the ' + fcTab + ' psi table');
  if (lower) {
    // Stack base (user 2026-11-10): allowable base moment, its drift and anchor tension from the published first-story
    // table (WSWH T07 p. 50, SSWH T15 p. 27), interpolated on H_e only. V / D / VL / DL become the shear equivalent
    // M·12/H_e (capacity weight in the line distribution; equal to the one-story V at 4,000 lb by Simpson's construction).
    const m = stackMoment(width, h, family);
    if (m.error) { out.error = m.error; return out; }
    Object.assign(out, { M: m.M, MD: m.D, ML: m.ML, MDL: m.DL, MT: m.T, Mmodel: m.model });
    out.He = m.He;
    out.V = { E: m.M.E * 12 / m.He, W: m.M.W * 12 / m.He };
    out.D = { E: m.D.E, W: m.D.W };
    out.VL = { E: m.ML.E * 12 / m.He, W: m.ML.W * 12 / m.He };
    out.DL = { E: m.DL.E, W: m.DL.W };
    out.T0 = { E: m.T.E, W: m.T.W };
    out.notes.push(sswh ? 'Stack base: allowable base moment from T15 (C-L-SW26 p. 27, ' + m.model + '-STK)'
      : 'Stack base: allowable base moment from Table 07 (C-L-SW26 p. 50, ' + m.model + ')');
  }
  return out;
}

// Table 07 (p. 50) at a first-story floor-to-floor height h (ft): M (lb-ft), drift and anchor tension at M, ASD and
// LRFD-equivalent, interpolated on the tabulated nominal heights (n.3)
export function stackMoment(width, h, family = 'WSWH') {
  const [tid, table] = FAM[family].stack;
  const tname = family === 'SSWH' ? tid : 'Table 07';
  const rows = ofWidth(table, width, family).sort((a, b) => a.nominal_ft - b.nominal_ft);
  if (!rows.length) return { error: family + width + ' has no stacked first-story table (' + tname + ')' };
  const lo = rows[0].nominal_ft, hi = rows[rows.length - 1].nominal_ft;
  if (h < lo - 1e-6 || h > hi + 1e-6) return { error: 'Floor-to-floor ' + h + ' ft is outside the stacked first-story ' + family + width + ' heights (' + lo + '–' + hi + ' ft, ' + tname + ')' };
  let a = rows[0], b = rows[0];
  for (const r of rows) { if (r.nominal_ft <= h + 1e-6) a = r; if (r.nominal_ft >= h - 1e-6) { b = r; break; } }
  const t = b.nominal_ft > a.nominal_ft ? (h - a.nominal_ft) / (b.nominal_ft - a.nominal_ft) : 0;
  const L = (k) => lerp(a[k], b[k], t);
  return {
    model: t === 0 ? a.model : a.model + '–x' + b.nominal_ft + ' (interp.)', He: L('He_in'),
    M: { E: L('M_ASDcap_S'), W: L('M_ASDcap_W') }, D: { E: L('Delta_ASDcap_S'), W: L('Delta_ASDcap_W') },
    T: { E: L('T_ASDcap_S'), W: L('T_ASDcap_W') },
    ML: { E: L('M_LRFDcap_S'), W: L('M_LRFDcap_W') }, DL: { E: L('Delta_LRFDcap_S'), W: L('Delta_LRFDcap_W') },
    rows: t === 0 ? [a] : [a, b],
  };
}

// Stacked 1st-story panel (README §5, revised 2026-11-10): M_d = V₁·h₁ + V₂·(h₂ + d) at story heights (ft), V₁ = the
// base panel's shear (it already includes V₂), V₂ = the 2nd-story panel's shear; M_allow from Table 07 (lb-ft).
// The same formula as Σ F·y of the story forces (C-L-SW26 p. 29). Before calc v27 V₂·H₁ was counted twice.
export function stackedBaseCheck({ Mallow, V1, V2, h1, h2, d }) {
  const Md = V1 * h1 + V2 * (h2 + d);
  const V1avail = h1 > 0 ? (Mallow - V2 * (h2 + d)) / h1 : 0;
  return { Mallow, Md, dc: Mallow > 0 ? Md / Mallow : null, V1avail };
}

// === Anchors (Table 06, cracked concrete) ===
// SDC A–B: W/E or E; SDC C: W/E or E for a detached one-/two-family dwelling, else E; SDC D–F (or unknown): E
export function permittedCriteria(sdc, detached) {
  const s = String(sdc || '').trim().toUpperCase();
  if (s === 'A' || s === 'B') return ['W/E', 'E'];
  if (s === 'C') return detached ? ['W/E', 'E'] : ['E'];
  return ['E'];
}
export const anchorFcTable = (fc) => [4500, 3000, 2500].find(t => Number(fc) >= t) || 2500;
export const anchorId = (r) => r.criteria + ' ' + r.grade + ' ' + r.T_ASDallow;

export function anchorRows({ fc, sdc, detached }) {
  const fcT = anchorFcTable(fc);
  const crit = permittedCriteria(sdc, detached);
  return WSWH_ANCHORS.filter(r => r.fc_psi === fcT && crit.includes(r.criteria));
}

// Anchor for one end: smallest footing width W, then smallest embedment d_e, with T_ASDallow ≥ T (user rule).
// Returns an anchorage object ({ id, cap, … }) or null when no row passes.
export function selectWswhAnchor(T_lb, { fc, sdc, detached, width, override, family = 'WSWH' }) {
  const rows = anchorRows({ fc, sdc, detached });
  const pick = override ? rows.find(r => anchorId(r) === override) : null;
  const cands = rows.filter(r => r.T_ASDallow >= T_lb - 1e-6).sort((a, b) => a.W_in - b.W_in || a.de_in - b.de_in || a.T_ASDallow - b.T_ASDallow);
  const r = pick || cands[0];
  if (!r) return null;
  return {
    // SSWH: the same SWH-AB bolts and Table 06 (C-L-SW26 p. 85); footing length L only tabulated for 12 / 18 / 24
    id: (family === 'SSWH' ? 'SWH-AB ' : 'WSWH-AB ') + r.grade + ' (' + r.criteria + ')', cap: r.T_ASDallow, delta: 0, wswhAnchor: true,
    rowId: anchorId(r), override: !!pick, criteria: r.criteria, grade: r.grade, fc: r.fc_psi,
    W: r.W_in, de: r.de_in, Lftg: r['L_ftg' + width + '_in'] ?? null, governs: r.governs,
    lrfdCapE: r.T_LRFDcap_E, lrfdCapW: r.T_LRFDcap_W, phiNsa: r.phiNsa,
  };
}

export const RAISED_ANCHOR = { id: 'Anchorage by RDP (raised floor)', cap: 0, delta: 0, wswhAnchor: true, byRDP: true };
export const WSWH_PANEL_POST = { postId: 'wswh', postLabel: 'WSWH panel', capacityKips: 0, wswh: true };
