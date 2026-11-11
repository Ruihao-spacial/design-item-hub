// V21 — Strong-Wall WSWH two-story stack (base moment check, TSS kit at the 2nd story) and a raised-floor panel
import { project, level, direction, line, panel, ex, f2, f3, SEISMIC, storyDrift, driftExpect } from './lib.mjs';

const h = 9, F2 = 0.8, F1 = 1.0, dfl = 12;
// Simpson C-L-SW26: Table 03 (p. 50) WSWH18x9 2nd story: H_e 105.25 in, V_ASD,S 1,095 lb, Δ 0.44 in
// Table 07 (p. 50) WSWH18x9 first-story stacked (stack base, README §5, calc v27): M_allow,S = 22,585 lb-ft, Δ = 0.45 in; LRFD-eq. 32,265 lb-ft / 0.64 in
// Table 02 (p. 47) WSWH18x9 raised floor: H_e 105.25 in, V_ASD,S 1,475 lb, Δ 0.43 in; Table 05-C: B = 12.5 in (concrete), 14.0 in (raised)
// LRFD cap with its drift (derived columns of the same rows): T03 1,565 lb / 0.63 in, T02 2,105 lb / 0.61 in
const up = { He: 105.25, V: 1095, D: 0.44, VL: 1565, DL: 0.63 }, base = { He: 105.25, M: 22585, D0: 0.45, ML: 32265, D0L: 0.64 }, rf = { He: 105.25, V: 1475, D: 0.43, B: 14.0, VL: 2105, DL: 0.61 };
const B = 12.5;               // concrete arm (stack base), Table 05-C; the 2nd story has no arm (user 2026-11-10)
const V2 = F2, V1 = F2 + F1;                    // 1.0-level shears (k): 2nd story panel, 1st story panel (story shear, incl. V2)
const d = dfl / 12;                              // Setup floor plate depth of Level 1 (the floor between the panels), ft
const V2a = 0.7 * V2 * 1000, V1a = 0.7 * V1 * 1000;   // ASD (lb)
const dcUp = V2a / up.V;
const Mallow = base.M;
const Md = V1a * h + V2a * (h + d);              // story heights: V₁·h₁ + V₂·(h₂ + d) (C-L-SW26 p. 29)
const V1avail = (Mallow - V2a * (h + d)) / h;
const Tup = 0;                                  // 2nd story: no lateral end force — its overturning is in the stack base (user 2026-11-10)
const otm1 = V1 * h + V2 * (h + d);             // k·ft at the 1.0 level
const Tbase = 0.7 * otm1 / (B / 12);
// Table 06-A (2,500 psi, cracked), SDC D → E rows: STD 16,000 / 17,100, HS 34,100 (W 52, d_e 18), HS 36,800
const E6 = [[16000, 'STD', 33, 11], [17100, 'STD', 35, 12], [34100, 'HS', 52, 18], [36800, 'HS', 55, 19]];
const anc = E6[2]; // pinned HS 34,100 (design frozen 2026-09-30); T now fits STD 17,100 — the pin is kept
const dUp = up.DL * V2 * 1000 / up.VL;
const MallowL = base.ML;
const dBase = base.D0L * (otm1 * 1000) / MallowL;  // Δ₁ = Δ_LRFD(T07)·M(1.0)/M_allow,LRFD
const Vr = F1, dcR = 0.7 * Vr * 1000 / rf.V, Tr = 0.7 * Vr * rf.He / rf.B;
// Story drift (Cd 4, Ie 1.0, RC II): WSWH panels use their table drift, not Eq. 4.3-1 — Δ = Δ_LRFD × V(1.0E) / V_LRFD
// (LRFD seismic column, linear; user 2026-10-13); the stack base Δ₁ = Δ₀,LRFD × M(1.0) / M_allow,LRFD (README §5).
const dR = rf.DL * Vr * 1000 / rf.VL;
const aL2 = storyDrift('Level 2', h, [{ mark: 'SW-1', delta: dUp }]);
const aL1 = storyDrift('Level 1', h, [{ mark: 'SW-2', delta: dBase }]);
const bL1 = storyDrift('Level 1', h, [{ mark: 'SW-3', delta: dR }]);

export default {
  id: 'V21', title: 'Strong-Wall WSWH stack and raised floor', slug: 'wswh-stack-raised',
  intent: 'Line A: two WSWH18 panels stacked over two 9 ft stories. The 2nd-story panel uses Table 03 and is held down by the WSWH-TSS18KT kit (no tension capacity published); the 1st-story panel is checked as an allowable base moment (M_allow from Table 07, C-L-SW26 p. 50) against M_d = V₁·h₁ + V₂·(h₂ + d) at story heights (V₁ includes the upper shear; d = Setup floor plate depth), and its anchors carry the stack moment. Line B: one panel on a raised wood floor (Table 02): shear check and anchor tension T only — the anchorage is by the RDP.',
  covers: ['C-L-SW26 Table 03 (stacked 2nd story)', 'Table 07 stack base (README §5)', 'Table 02 raised floor', 'Table 06-A anchors', 'TSS kit'],
  handCalc: [
    'Line A shears (1.0E): 2nd story F = ' + F2 + ' k → V₂ = ' + f2(V2) + ' k on SW-1; 1st story V₁ = ' + F2 + ' + ' + F1 + ' = ' + f2(V1) + ' k on SW-2. ASD: V₂ = 0.7 × 800 = ' + V2a + ' lb, V₁ = 0.7 × 1800 = ' + V1a + ' lb. No gravity on the panels (P = 0 ≤ 2,000 / 4,000 lb limits).',
    '2nd story (Table 03, WSWH18x9): V_allow = 1,095 lb → D/C = ' + V2a + '/1095 = ' + f3(dcUp) + '.',
    'Stack base (Table 07, WSWH18x9, seismic): M_allow = ' + f2(Mallow) + ' lb-ft.',
    'M_d = V₁·h₁ + V₂·(h₂ + d) = ' + V1a + ' × ' + h + ' + ' + V2a + ' × (' + h + ' + ' + d + ') = ' + f2(Md) + ' lb-ft → D/C = M_d/M_allow = ' + f3(Md / Mallow) + ' (V₁ = the story shear, which already includes V₂). Available V₁ = (M_allow − V₂·(h₂ + d))/h₁ = ' + f2(V1avail) + ' lb ≥ ' + V1a + ' → OK.',
    '2nd-story hold-down = WSWH-TSS18KT: no B and no tension check — the panel\'s overturning is carried into the stack base moment (user 2026-11-10); the kit is OK because the panel passes Table 03 (P₂ = 0 ≤ 2,000 lb, shear D/C ' + f3(dcUp) + ', drift).',
    'Stack base anchors: M(1.0) = V₁·h₁ + V₂·(h₂ + d) = ' + f2(V1) + ' × ' + h + ' + ' + f2(V2) + ' × (' + h + ' + ' + d + ') = ' + f3(otm1) + ' k·ft → T = 0.7 × ' + f3(otm1) + ' / (12.5/12) = ' + f3(Tbase) + ' k = ' + Math.round(Tbase * 1000) + ' lb. Table 06-A, SDC D, E rows: the pinned HS ' + anc[0] + ' lb, W = ' + anc[2] + ' in, d_e = ' + anc[3] + ' in (STD 17,100 would now carry T).',
    'Drift (LRFD cap with its drift): 2nd story Δ = 0.63 × 800/1565 = ' + f3(dUp) + ' in; base Δ₁ = Δ_LRFD·M(1.0)/M_allow,LRFD = 0.64 × ' + f2(otm1 * 1000) + '/' + f2(MallowL) + ' = ' + f3(dBase) + ' in (M_allow,LRFD = Table 07 LRFD-eq. 32,265 lb-ft).',
    'Line B raised floor (Table 02, WSWH18x9, joist ≤ 12"): V_allow = 1,475 lb; V = ' + f2(Vr) + ' k → D/C = 700/1475 = ' + f3(dcR) + '. T = 0.7·V·H_e/B = 0.7 × ' + f2(Vr) + ' × 105.25/14.0 = ' + f3(Tr) + ' k (B raised = 14.0 in) — reported; anchorage by the RDP.',
    'Line checks G1–G12 pass on both lines; the 2nd-story panel end forces are absorbed into the stack base moment (not delivered as wall-end loads).',
    'Story drift, Line A (each story has one panel; table drift, LRFD seismic column scaled to the 1.0E share, step 7). ' + aL2.text + ' ' + aL1.text + ' The stack base carries the moment of both stories, so its Δ₁ (' + f3(dBase) + ' in) is larger than the 2nd-story panel Δ.',
    'Story drift, Line B: SW-3 Δ = 0.61 × ' + f2(Vr * 1000) + ' / 2105 = ' + f3(dR) + ' in (Table 02). ' + bL1.text,
  ],
  expect: [
    { ...ex('SW-1 table', 'wall:SW-1', 'wswh.table', 'T03', 2), line: 'Line A' },
    { ...ex('SW-1 D/C', 'wall:SW-1', 'dcRatio', dcUp, 2, 0.006), line: 'Line A' },
    { ...ex('SW-2 role', 'wall:SW-2', 'wswh.role', 'stackedLower', 3), line: 'Line A' },
    { ...ex('Stack M_allow (lb-ft)', 'wall:SW-2', 'wswh.stacked.E.Mallow', Mallow, 3, 0.5), line: 'Line A' },
    { ...ex('Stack M_d (lb-ft)', 'wall:SW-2', 'wswh.stacked.E.Md', Md, 4, 0.5), line: 'Line A' },
    { ...ex('Stack V₁ available (lb)', 'wall:SW-2', 'wswh.stacked.E.V1avail', V1avail, 4, 0.5), line: 'Line A' },
    { ...ex('SW-2 D/C = M_d/M_allow', 'wall:SW-2', 'dcRatio', Md / Mallow, 4, 0.006), line: 'Line A' },
    // role: the hold-down is fixed by the panel condition (stacked 2nd story → TSS kit; raised floor → by RDP), not selected
    { ...ex('SW-1 hold-down (stacked 2nd story)', 'wall:SW-1', 'anchorageLeft.id', 'WSWH-TSS18KT', 5), line: 'Line A', role: true },
    { ...ex('SW-1 lateral T (k) — none, TSS kit', 'wall:SW-1', 'governingTensionLeft', Tup, 5), line: 'Line A' },
    { ...ex('SW-2 base T (k)', 'wall:SW-2', 'governingTensionLeft', Tbase, 6), line: 'Line A' },
    { ...ex('SW-2 anchor cap (lb)', 'wall:SW-2', 'anchorageLeft.cap', anc[0], 6, 0), line: 'Line A' },
    { ...ex('SW-2 Δ₁ (in)', 'wall:SW-2', 'deflection.E.delta', dBase, 7, 0.0005), line: 'Line A' },
    { ...ex('SW-3 D/C (raised floor)', 'wall:SW-3', 'dcRatio', dcR, 8, 0.006), line: 'Line B' },
    { ...ex('SW-3 T (k)', 'wall:SW-3', 'governingTensionLeft', Tr, 8), line: 'Line B' },
    { ...ex('SW-3 anchorage (raised floor)', 'wall:SW-3', 'anchorageLeft.id', 'Anchorage by RDP (raised floor)', 8), line: 'Line B', role: true },
    ...driftExpect(aL2, 10, 'Line A'),
    ...driftExpect(aL1, 10, 'Line A'),
    { ...ex('SW-3 Δ (in)', 'wall:SW-3', 'deflection.E.delta', dR, 11, 0.0005), line: 'Line B' },
    ...driftExpect(bL1, 11, 'Line B'),
  ],
  expectChecks: { fail: [] },
  // Design pinned as manual overrides (method case): the engine picks at calc v13, frozen 2026-09-30
  pins: {"Line A/SW-1":{},"Line A/SW-2":{"wswhAnchor":"E HS 34100"},"Line B/SW-3":{}},
  inputs: project({
    ...SEISMIC, seismicDesignCategory: 'D', wswhFc: '2500',
    levels: [level('lvl-2', 'Level 2', h), level('lvl-1', 'Level 1', h, { floorPlateDepth: String(dfl) })],
    directions: [direction('dir-1', 'N-S', [
      line({ id: 'ln-1', name: 'Line A', totalLength: 10, levelLoads: { 'lvl-2': { seismic: String(F2), wind: '' }, 'lvl-1': { seismic: String(F1), wind: '' } },
        walls: [panel('w-1', 'SW-1', 'lvl-2', 2, { wallDLTypeId: '', wswhCondition: 'stackedUpper' }), panel('w-2', 'SW-2', 'lvl-1', 2, { wallDLTypeId: '' })] }),
      line({ id: 'ln-2', name: 'Line B', totalLength: 10, levelLoads: { 'lvl-1': { seismic: String(F1), wind: '' } },
        walls: [panel('w-3', 'SW-3', 'lvl-1', 2, { wallDLTypeId: '', wswhCondition: 'raised' })] }),
    ])],
  }),
};
