// Diaphragm Analysis — cantilevered TD: the limits the engineer reviews (user 2026-10-29). The engineer's review is the
// skill's td_cantilever_ok (S062). UNVERIFIED: written from recall of SDPWS-2021 §4.2.5 (cantilevered / open-front
// diaphragms) — trace against the licensed SDPWS-2021 before relying on the numbers. Pure, no DOM.
export const CANTILEVER_LIMITS_VERIFY = 'UNVERIFIED (SDPWS-2021 §4.2.5, from recall — to trace)';

// geometry: { Lp: overhang length L′ (ft), L: TD length (ft, the width W′ of the cantilevered strip) }
export function cantileverLimits({ Lp, L }) {
  const r = L > 0 ? Lp / L : NaN;
  const f = v => (Number.isFinite(v) ? (Math.round(v * 100) / 100).toString() : '—');
  return [
    { id: 'C1', text: 'Cantilevered diaphragm: L′ ≤ 35 ft and L′ ≤ 2/3 W′ (whichever is smaller), rigid diaphragm.',
      value: `L′ = ${f(Lp)} ft; W′ = TD length ${f(L)} ft → L′/W′ = ${f(r)} (2/3 = 0.67). If W′ is the diaphragm depth instead, check that ratio.`,
      flag: Lp > 35 || r > 2 / 3 },
    { id: 'C2', text: 'Open-front structure: L′ ≤ 35 ft.', value: `L′ = ${f(Lp)} ft`, flag: Lp > 35 },
    { id: 'C3', text: 'Open-front, not torsionally irregular: L′/W′ ≤ 1.5 (one story), ≤ 1.0 (over one story); more only where calculated deflections can be tolerated.', value: `L′/W′ = ${f(r)}`, flag: r > 1 },
    { id: 'C4', text: 'Open-front, torsionally irregular (ASCE 7 Type 1a / 1b): L′/W′ ≤ 1.0 (one story), ≤ 0.67 (over one story).', value: `L′/W′ = ${f(r)}`, flag: r > 0.67 },
    { id: 'C5', text: 'Drift at the open edge, including torsion and accidental torsion, ≤ the ASCE 7 allowable story drift.', value: 'not computed by the tool', flag: false },
    { id: 'C6', text: 'The back-span support is a collector or shear-wall line able to take the reversed reaction (skill S062).', value: 'see the TD support forces', flag: false },
  ];
}
