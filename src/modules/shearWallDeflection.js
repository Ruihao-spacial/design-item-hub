// Shear wall deflection and story drift — SDPWS 2021 Eq. 4.3-1 (3-term):
//   δ = 8vh³/(EAb) + vh/(1000·Ga) + h·Δa/b
// v (plf) at the 1.0 level (1.0E with ρ = 1, or α_s·1.0W for service wind), h and b in ft, E psi, A in², Ga kips/in.
// Δa = holdown / strap Δ linear from its LRFD pair, δ_LRFD × T / T_LRFD (user 2026-10-14) + Δc sill plate crushing at
// the compression end (sill F_c⊥ from NDS Table 4A / 4B). T above the LRFD cap → overLrfd (warning sign only).
// E·A = the smaller of the two end posts (E per member: Table 4A / 4B, or 4D for posts 5"x5" and larger).
// End forces: lateral only (user 2026-10-14), T = C = the 1.0-level overturning force at each end, own + from the walls
// above (the accumulated 1.0E / 1.0W load case). FTAO walls use the FTAO engine and WSWH the Simpson table; all three
// read their LRFD pair at the same 1.0 level.
import { crushingDeflection } from './shearWallFtao.js';
import { gaFor, getNailingById } from './shearWallNailing.js';
import { postSizeById, anchorageDelta, overLrfdCap, memberProps, sillProps } from './shearWallHardware.js';

function r4(v) { return Math.round(v * 10000) / 10000; }

// ASCE 7-22 Table 12.12-1 allowable story drift Δa / h_sx, by risk category
export const DRIFT_ROWS = [
  { id: 'other', label: 'All other structures', limits: { I: 0.020, II: 0.020, III: 0.015, IV: 0.010 } },
  { id: 'fourStory', label: '≤ 4 stories, interior walls/partitions/ceilings/exterior walls designed for drift', limits: { I: 0.025, II: 0.025, III: 0.020, IV: 0.015 } },
];

export function driftLimit(rowId, riskCategory) {
  const row = DRIFT_ROWS.find(r => r.id === rowId) || DRIFT_ROWS[0];
  return row.limits[String(riskCategory || '').trim().toUpperCase()] ?? null; // ' II' typed with a space still counts
}

export function postArea(postResult) {
  if (!postResult) return null;
  const p = postSizeById(postResult.postId);
  return p ? p.area : null;
}
// Chord E (psi) of an end post: the member's grade value (Table 4A / 4B, or 4D for 5"x5" and larger)
export function postE(postResult, wood) {
  const p = postResult && postSizeById(postResult.postId);
  const m = p && memberProps(wood, p);
  return m ? m.E : null;
}

// One loading direction: tension at one end (anchorage), compression at the other (post bearing)
export function deflectionTerms({ v, h, b, E, A, Ga, T, anchorage, C, Ac, Fcperp }) {
  const t1 = 8 * v * h ** 3 / (E * A * b);
  const t2 = v * h / (1000 * Ga);
  const dHD = anchorageDelta(anchorage, T);
  const overLrfd = T > 0 && overLrfdCap(anchorage, T);
  const r = Ac > 0 && Fcperp > 0 ? C / (Ac * Fcperp) : 0;
  const dC = crushingDeflection(r);
  const t3 = h * (dHD + dC) / b;
  return { t1: r4(t1), t2: r4(t2), dHD: r4(dHD), r: r4(r), dC: r4(dC), t3: r4(t3), delta: r4(t1 + t2 + t3), deltaExact: t1 + t2 + t3,
    T: Math.round(T), anchorageId: anchorage ? anchorage.id : null, lrfdCap: anchorage && anchorage.lrfdCap > 0 ? anchorage.lrfdCap : null, overLrfd };
}

// Eq. 4.3-1 of a regular wall at one lateral load case for a share (k). latL / latR = the 1.0-level lateral end force
// (k): → tension at the left end (latL) and compression at the right (latR), ← mirrored. Both directions; the larger
// governs.
function deflectionOf(wr, factor, ctx, share, latL, latR) {
  const L = wr.length;
  const h = wr.floorH;
  const Ga = gaFor(getNailingById(wr.nailing && wr.nailing.id), ctx.sheathing);
  const AL = postArea(wr.postLeft);
  const AR = postArea(wr.postRight);
  const EL = postE(wr.postLeft, ctx.grade), ER = postE(wr.postRight, ctx.grade);
  if (!(Ga > 0) || !(AL > 0) || !(AR > 0) || !(EL > 0) || !(ER > 0)) return null;
  const v = share * factor * 1000 / L;
  const [E, A] = EL * AL <= ER * AR ? [EL, AL] : [ER, AR];
  const Fcperp = sillProps(ctx.grade, ctx.lineThickness).Fcperp;
  const lL = latL * factor * 1000, lR = latR * factor * 1000; // lb
  // → : left end tension, right end compression; ← : right end tension, left end compression
  const dirs = [
    { dir: '→', ...deflectionTerms({ v, h, b: L, E, A, Ga, T: lL, anchorage: wr.anchorageLeft, C: lR, Ac: AR, Fcperp }), C: Math.round(lR) },
    { dir: '←', ...deflectionTerms({ v, h, b: L, E, A, Ga, T: lR, anchorage: wr.anchorageRight, C: lL, Ac: AL, Fcperp }), C: Math.round(lL) },
  ];
  const gov = dirs[0].deltaExact >= dirs[1].deltaExact ? dirs[0] : dirs[1];
  return { method: 'SDPWS Eq. 4.3-1', v: Math.round(v), h, b: L, E, A, Ga, Fcperp,
    T: Math.round(lL), C: Math.round(lR), dirs, delta: gov.delta, deltaExact: gov.deltaExact,
    overLrfd: dirs.some(d => d.overLrfd) };
}

// Deflection of a regular wall / segmented pier for one lateral load case, at its share and with its accumulated
// 1.0-level end forces (own + from the walls above). wr: wall result (after load path); lt: 'E' | 'W';
// factor: 1.0 (E) or α_s (W). A wall with zero share still rotates under the forces from above (fromAbove).
export function wallDeflection(wr, lt, factor, ctx) {
  const L = wr.length;
  const h = wr.floorH;
  // exact (unrounded) share, the same one the end forces T / C below come from
  const share = lt === 'E' ? (wr.shareExact_1E ?? wr.share_1E) : (wr.shareExact_1W ?? wr.share_1W);
  if (!(L > 0) || !(h > 0) || !(share >= 0)) return null;
  const key = lt === 'E' ? '1.0E' : '1.0W';
  const c = (wr.accumPerCombo && wr.accumPerCombo[key]) || (wr.combos && wr.combos[key]);
  if (!c) return null;
  if (!(share > 0) && (wr.hbNotPermitted || !((c.tensionLeft || 0) > 0 || (c.comprRight || 0) > 0))) return null;
  const d = deflectionOf(wr, factor, ctx, share, c.tensionLeft || 0, c.comprRight || 0);
  return d && !(share > 0) ? { ...d, fromAbove: true } : d;
}

// The same Eq. 4.3-1 at a trial share Vk (k) of the wall: its own 1.0 end forces become Vk·h/L while the part coming
// from the walls above stays as it is (above = accumulated − own). Used by the deflection distribution to find the
// shares at which every wall at a story gives the same δ. At the wall's own share it equals wallDeflection.
// signed: also allows Vk < 0 (the wall pushing back; information only) — the shear terms turn negative and the end
// forces T / C are clipped at 0.
export function wallDeflectionAtShare(wr, lt, Vk, ctx, signed = false) {
  const L = wr.length, h = wr.floorH;
  if (!(L > 0) || !(h > 0) || !(signed ? Number.isFinite(Vk) : Vk >= 0)) return null;
  const key = lt === 'E' ? '1.0E' : '1.0W';
  const own = (wr.combos && wr.combos[key]) || {};
  const acc = (wr.accumPerCombo && wr.accumPerCombo[key]) || own;
  const aboveT = (acc.tensionLeft || 0) - (own.tensionLeft || 0);
  const aboveC = (acc.comprRight || 0) - (own.comprRight || 0);
  const ownT = Vk * h / L;
  const clip = (x) => (signed ? Math.max(0, x) : x);
  return deflectionOf(wr, 1.0, ctx, Vk, clip(ownT + aboveT), clip(ownT + aboveC));
}
