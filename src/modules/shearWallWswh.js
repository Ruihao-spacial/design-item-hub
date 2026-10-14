// Simpson Strong-Wall WSWH (high-strength wood shearwall) — table lookup, stacked base moment check,
// anchor selection. Rules from the WSWH reference folder 00_README (§4 lookup rules, §5 stacked panels)
// and Table 06 (anchorage, cracked concrete). Data: shearWallWswhData.js (generated).
import { WSWH_T01, WSWH_T02, WSWH_T03, WSWH_EVAL_ORDER, WSWH_ARM, WSWH_KITS, WSWH_ANCHORS } from './shearWallWswhData.js';

export const WSWH_WIDTHS = ['12', '18', '24'];
export const WSWH_CONDITIONS = [
  { id: 'concrete', label: 'Concrete foundation (T01)' },
  { id: 'raised', label: 'Raised wood floor (T02)' },
  { id: 'stackedUpper', label: 'Two-story stacked — 2nd story (T03)' },
];
export const WSWH_JOISTS = [{ id: '12', label: 'Joist ≤ 12"' }, { id: '16', label: 'Joist 12"–16" (× 0.92)' }];
export const WSWH_FC = ['2500', '3000', '4500'];
// TSS kit rods at the stacked 2nd-story panel: 1" ASTM A193 B7 — ASD steel limit (Table 06 HS) and φN_sa
export const WSWH_ROD = { id: 'TSS rod 1" A193 B7', cap: 36800, lrfdCap: 56810 };
export const RAISED_JOIST_FACTOR = 0.92;

export const isWswh = (w) => !!w && w.systemType === 'wswh';
export const wswhWidthIn = (w) => (WSWH_WIDTHS.includes(String(w.wswhWidth)) ? Number(w.wswhWidth) : 18);
export const wswhWidthFt = (w) => wswhWidthIn(w) / 12;
export const conditionLabel = (id) => (WSWH_CONDITIONS.find(c => c.id === id) || { label: id }).label;

export const WSWH_NOTES = [
  'Strong-Wall WSWH values: Simpson C-L-SW26 (2026) / ICC-ES ESR-2652, 2024 IBC basis — confirm ESR-2652 lists 2021 IBC for CBC 2022.',
  'Seismic values are based on R = 6.5. LRFD-equivalent values are derived (seismic ASD/0.7, wind ASD/0.6), not Simpson-published.',
  'Drift at the 1.0 level is linear in V from the LRFD cap with its drift: Δ = Δ_LRFD·V/V_LRFD (stacked base: Δ_0,LRFD·M_d/M_allow,LRFD); a warning sign when V > V_LRFD. Table 03 (stacked 2nd story) could not be self-checked.',
  'Anchors: Table 06, cracked concrete. Bolt length l_e / HSR extension (Table 07) and edge shear anchorage (Table 08) are not checked.',
];

const lerp = (a, b, t) => a + (b - a) * t;
const COLS = ['He_in', 'V_ASDcap_S', 'Delta_ASDcap_S', 'T_ASDcap_S', 'V_ASDcap_W', 'Delta_ASDcap_W', 'T_ASDcap_W',
  'V_LRFDcap_S', 'Delta_LRFDcap_S', 'V_LRFDcap_W', 'Delta_LRFDcap_W'];
const mix = (r1, r2, t) => Object.fromEntries(COLS.map(k => [k, r2 == null || r1[k] == null ? r1[k] : lerp(r1[k], r2[k], t)]));
const ofWidth = (rows, width) => rows.filter(r => r.model.startsWith('WSWH' + width + 'x'));

// T01 rows of one nominal height at vertical load P (ASD lb): P below the first row uses it; above the last = not tabulated
function atP(rows, P) {
  const s = [...rows].sort((a, b) => a.P_lb - b.P_lb);
  if (P <= s[0].P_lb) return { row: mix(s[0], null, 0) };
  const last = s[s.length - 1];
  if (P > last.P_lb + 1e-6) return { error: 'P = ' + Math.round(P) + ' lb exceeds the tabulated ' + last.P_lb + ' lb at ' + last.model + ' (not permitted)' };
  for (let i = 0; i < s.length - 1; i++) {
    if (P <= s[i + 1].P_lb) return { row: mix(s[i], s[i + 1], (P - s[i].P_lb) / (s[i + 1].P_lb - s[i].P_lb)) };
  }
  return { row: mix(last, null, 0) };
}

// Panel values for one wall. condition: concrete | raised | stackedUpper | stackedLower (base of a stack)
// ftfFt = level floor-to-floor = nominal height (interpolated between tabulated heights).
// P_lb: ASD vertical load on the panel (T01 axis; limits for T02 / T03). joist: '12' | '16' (raised floor).
export function lookupWswh({ width, condition, ftfFt, P_lb = 0, fc = 2500, joist = '12' }) {
  const out = { width, condition, notes: [], error: null };
  const lower = condition === 'stackedLower';
  const table = condition === 'raised' ? WSWH_T02 : condition === 'stackedUpper' ? WSWH_T03 : WSWH_T01;
  out.table = condition === 'raised' ? 'T02' : condition === 'stackedUpper' ? 'T03' : 'T01';
  const fcTab = lower ? 2500 : (Number(fc) >= 3000 ? 3000 : 2500);
  let rows = ofWidth(table, width);
  if (out.table === 'T01') rows = rows.filter(r => r.fc_psi === fcTab);
  if (!rows.length) { out.error = 'WSWH' + width + ' is not tabulated for ' + conditionLabel(condition); return out; }
  const noms = [...new Set(rows.map(r => r.nominal_ft))].sort((a, b) => a - b);
  const h = Number(ftfFt) || 0;
  if (h < noms[0] - 1e-6 || h > noms[noms.length - 1] + 1e-6) {
    out.error = 'Floor-to-floor ' + h + ' ft is outside the tabulated WSWH' + width + ' heights (' + noms[0] + '–' + noms[noms.length - 1] + ' ft, ' + out.table + ')';
    return out;
  }
  let n1 = noms[0], n2 = noms[0];
  for (let i = 0; i < noms.length; i++) {
    if (noms[i] <= h + 1e-6) n1 = noms[i];
    if (noms[i] >= h - 1e-6) { n2 = noms[i]; break; }
  }
  const t = n2 > n1 ? (h - n1) / (n2 - n1) : 0;
  const rowAt = (n) => {
    const rs = rows.filter(r => r.nominal_ft === n);
    if (out.table === 'T01') return atP(rs, lower ? 4000 : P_lb);
    return { row: mix(rs[0], null, 0) };
  };
  const a = rowAt(n1), b = rowAt(n2);
  if (a.error || b.error) { out.error = a.error || b.error; return out; }
  const v = mix(a.row, b.row, t);

  if (condition === 'raised' && P_lb > 2000 + 1e-6) { out.error = 'P = ' + Math.round(P_lb) + ' lb exceeds 2,000 lb (raised floor, Table 02 n.3)'; return out; }
  if (condition === 'stackedUpper' && P_lb > 2000 + 1e-6) { out.error = 'P₂ = ' + Math.round(P_lb) + ' lb exceeds 2,000 lb (stacked 2nd story, Table 03 n.5)'; return out; }
  if (lower && P_lb > 4000 + 1e-6) { out.error = 'P₁ = ' + Math.round(P_lb) + ' lb exceeds 4,000 lb (stacked 1st story, Table 03 n.5)'; return out; }
  let factor = 1;
  if (condition === 'raised' && String(joist) === '16') { factor = RAISED_JOIST_FACTOR; out.notes.push('Joist 12"–16": V × 0.92 (Table 02 n.6)'); }

  const exact = t === 0 || n1 === n2;
  const modelAt = (n) => 'WSWH' + width + 'x' + n;
  out.He = v.He_in;
  out.nominal = h;
  out.evalModel = exact ? modelAt(n1) : modelAt(n1) + '–x' + n2 + ' (interp.)';
  const order = WSWH_EVAL_ORDER.find(r => r.eval_model === modelAt(n2));
  out.orderModel = order ? order.order_model : modelAt(n2);
  out.V = { E: v.V_ASDcap_S * factor, W: v.V_ASDcap_W * factor };          // ASD allowable shear (lb)
  out.D = { E: v.Delta_ASDcap_S * factor, W: v.Delta_ASDcap_W * factor };  // drift at V (in); scales with V
  // LRFD cap with its drift (user 2026-10-13, option B): drift at the 1.0 level = Δ_LRFD × V / V_LRFD (linear)
  out.VL = { E: v.V_LRFDcap_S * factor, W: v.V_LRFDcap_W * factor };
  out.DL = { E: v.Delta_LRFDcap_S * factor, W: v.Delta_LRFDcap_W * factor };
  out.T0 = { E: v.T_ASDcap_S == null ? null : v.T_ASDcap_S * factor, W: v.T_ASDcap_W == null ? null : v.T_ASDcap_W * factor };
  const arm = WSWH_ARM.find(r => r.width_in === width);
  out.B = condition === 'raised' ? arm.B_raised_in : arm.B_concrete_in;
  if (condition === 'stackedUpper') out.notes.push('Rod arm B = concrete B (Table 05-C) — confirm for the TSS kit');
  const kit = WSWH_KITS.find(r => r.width_in === width);
  out.kit = condition === 'raised' ? kit.raisedKit : (condition === 'stackedUpper' || lower) ? kit.stackedKit : '';
  if (!exact) out.notes.push('Interpolated between ' + modelAt(n1) + ' and ' + modelAt(n2) + ' (H_e ' + v.He_in.toFixed(2) + '")');
  if (out.table === 'T01' && !lower && fcTab !== Number(fc)) out.notes.push("f'c " + fc + ' psi uses the ' + fcTab + ' psi table');
  if (lower) out.notes.push("Stacked base: V₀ at P = 4,000 lb, f'c = 2,500 psi (Table 03 n.1, n.5)");
  return out;
}

// Stacked 1st-story panel (README §5): M_allow = V₀·H₁/12, M_d = [V₁·H₁ + V₂·(H₁ + d_fl + H₂)]/12 (lb-ft)
export function stackedBaseCheck({ V0, H1, H2, dfl, V1, V2 }) {
  const Mallow = V0 * H1 / 12;
  const Md = (V1 * H1 + V2 * (H1 + dfl + H2)) / 12;
  const V1avail = H1 > 0 ? (Mallow - V2 * (H1 + dfl + H2) / 12) * 12 / H1 : 0;
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
export function selectWswhAnchor(T_lb, { fc, sdc, detached, width, override }) {
  const rows = anchorRows({ fc, sdc, detached });
  const pick = override ? rows.find(r => anchorId(r) === override) : null;
  const cands = rows.filter(r => r.T_ASDallow >= T_lb - 1e-6).sort((a, b) => a.W_in - b.W_in || a.de_in - b.de_in || a.T_ASDallow - b.T_ASDallow);
  const r = pick || cands[0];
  if (!r) return null;
  return {
    id: 'WSWH-AB ' + r.grade + ' (' + r.criteria + ')', cap: r.T_ASDallow, delta: 0, wswhAnchor: true,
    rowId: anchorId(r), override: !!pick, criteria: r.criteria, grade: r.grade, fc: r.fc_psi,
    W: r.W_in, de: r.de_in, Lftg: r['L_ftg' + width + '_in'], governs: r.governs,
    lrfdCapE: r.T_LRFDcap_E, lrfdCapW: r.T_LRFDcap_W, phiNsa: r.phiNsa,
  };
}

export const RAISED_ANCHOR = { id: 'Anchorage by RDP (raised floor)', cap: 0, delta: 0, wswhAnchor: true, byRDP: true };
export const WSWH_PANEL_POST = { postId: 'wswh', postLabel: 'WSWH panel', capacityKips: 0, wswh: true };
