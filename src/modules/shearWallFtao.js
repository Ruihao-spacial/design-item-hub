// Vendored from the ftao-shear-wall skill v1.0.0 (Shearwall design reference/FTAO/ftao-shear-wall.skill).
// Only change: the Node CLI block at the end is removed. Keep in sync with the skill; test/ftao.test.js guards it.
/**
 * ftao.js — Force Transfer Around Openings (FTAO) wood shear wall element.
 *
 * Method : APA T555 (Jan 2018) / Diekmann technique, generalized to N = 1–3
 *          openings with independent pier and opening lengths. Opening heights
 *          are enveloped at the governing opening (APA "largest opening" rule).
 * Code   : CBC 2022 → ASCE 7-22, SDPWS 2021, NDS 2024.
 * Defl.  : SDPWS 2021 Eq. 4.3-1 (3-term) only, applied per APA pier ± cases,
 *          plus Δc crushing at wall-end piers per SDPWS Example C4.3.4-2.
 *
 * Units  : lbf, ft, in, psi, plf, kips/in (Ga).
 * Loads  : every public method takes V at the 1.0 level (strength-level Q_E or W);
 *          the element derives V_ASD (design) and V_defl (deflection) internally.
 *
 * Zero dependencies. Runs in Node ≥18 or the browser.
 */

export const VERSION = '1.0.0';

export class FTAOInputError extends Error {
  constructor(errors) {
    super('FTAO hard stop:\n - ' + errors.join('\n - '));
    this.name = 'FTAOInputError';
    this.errors = errors;
  }
}

const DEFAULTS = {
  rho: 1.0,
  kASD_E: null,   // null → 0.7·rho
  kASD_W: 0.6,
  kDefl_E: 1.0,   // ρ = 1.0 for drift, ASCE 7-22 §12.3.4.1
  alpha_s: null,  // service-wind factor, required for W
  arMethod: '1.25-0.125h/bs',
  t555NarrowPier: false,
  blocked: true,
  faces: 1,
  CM: 1.0,
  Ct: 1.0,
  dcrTol: 0.0,
  includeDeltaC: true, // set false only to reproduce APA regression values
};

const HEIGHT_TOL = 0.01; // ft
const EPS = 1e-9;

// ---------------------------------------------------------------- utilities
const round = (x, d = 3) => (x == null || !isFinite(x) ? x : Math.round(x * 10 ** d) / 10 ** d);
const isNum = (x) => typeof x === 'number' && isFinite(x);

function status(dcr, tol) {
  if (dcr <= 1.0 + EPS) return 'OK';
  if (dcr <= 1.0 + tol + EPS) return 'OK*';
  return 'NG';
}

/** NDS §4.2.6 / SDPWS Ex. C4.3.4-2 crushing curve: Δc = 0.02″·f(r). */
export function crushingDeflection(r) {
  if (r <= 0) return 0;
  let f;
  if (r < 0.73) f = r / 0.73;
  else if (r <= 1.0) f = 1 + (r - 0.73) / 0.27;
  else f = 2 * r ** 3;
  return 0.02 * f;
}

/** Aspect-ratio adjustment factor for a pier (h = governing h_o, b = pier length). */
export function aspectFactor(h, b, method) {
  const ar = h / b;
  if (ar <= 2.0 + EPS || method === 'none') return 1.0;
  if (ar > 3.5 + EPS) return null; // not permitted
  if (method === '2bs/h') return (2 * b) / h;
  return 1.25 - 0.125 * ar; // '1.25-0.125h/bs'
}

// ---------------------------------------------------------------- validation
function normalize(raw) {
  const p = { ...DEFAULTS, ...raw };
  if (p.kASD_E == null) p.kASD_E = 0.7 * p.rho;
  return p;
}

function validate(p) {
  const e = []; // hard stops
  const w = []; // warnings

  const N = p.openings?.length;
  if (!Number.isInteger(N) || N < 1 || N > 3) e.push('N (number of openings) must be 1–3.');
  if (!Array.isArray(p.L) || p.L.length !== (N ?? 0) + 1) e.push('L must have N+1 pier lengths.');
  if (!Array.isArray(p.Lo) || p.Lo.length !== N) e.push('Lo must have N opening widths.');
  if (!isNum(p.h_wall) || p.h_wall <= 0) e.push('h_wall must be > 0.');
  if (p.blocked !== true) e.push('Wall must be blocked (SDPWS 2021 §4.3.5.2; APA calculator limitation 2).');
  if (![1, 2].includes(p.faces)) e.push('faces must be 1 or 2.');
  if (!['E', 'W'].includes(p.loadType)) e.push("loadType must be 'E' or 'W'.");
  if (!['1.25-0.125h/bs', '2bs/h', 'none'].includes(p.arMethod)) e.push('arMethod invalid.');
  for (const k of ['vs_nominal', 'Ga', 'HD_allow', 'd_a', 'strap_allow']) {
    if (!isNum(p[k]) || p[k] < 0 || (k !== 'd_a' && p[k] === 0)) e.push(`${k} must be a positive number.`);
  }
  if (p.includeDeltaC && (!isNum(p.Fcperp_plate) || p.Fcperp_plate <= 0))
    e.push('Fcperp_plate must be > 0 (or includeDeltaC = false).');
  const nEdges = 2 * ((N ?? 0) + 1);
  for (const k of ['E_post', 'A_post']) {
    if (!Array.isArray(p[k]) || p[k].length !== nEdges || !p[k].every((x) => isNum(x) && x > 0))
      e.push(`${k} must have 2(N+1) = ${nEdges} positive values (order: pier1-L, pier1-R, pier2-L, …).`);
  }
  if (p.loadType === 'E') {
    if (!isNum(p.Cd) || !isNum(p.Ie)) e.push('Cd and Ie are required for loadType E.');
    if (!isNum(p.h_sx) || p.h_sx <= 0) e.push('h_sx is required for loadType E.');
  }
  if (p.loadType === 'W' && (!isNum(p.alpha_s) || p.alpha_s <= 0))
    e.push('alpha_s (service-wind factor) is required for loadType W.');
  if (e.length) return { e, w };

  // geometry
  p.openings.forEach((o, j) => {
    const s = o.ha + o.ho + o.hb;
    if (!(o.ha > 0 && o.ho > 0 && o.hb > 0))
      e.push(`Opening ${j + 1}: h_a, h_o, h_b must all be > 0 (full-height openings excluded, T555 Limitation 3).`);
    if (Math.abs(s - p.h_wall) > HEIGHT_TOL)
      e.push(`Opening ${j + 1}: h_a + h_o + h_b = ${round(s, 3)} ≠ h_wall = ${p.h_wall}.`);
    if (!(p.Lo[j] > 0)) e.push(`Lo${j + 1} must be > 0.`);
  });
  p.L.forEach((Li, i) => {
    if (!(Li > 0)) e.push(`L${i + 1} must be > 0.`);
    else if (Li < 1.5 - EPS) e.push(`Pier ${i + 1}: L = ${Li} ft < 1.5 ft (absolute minimum).`);
    else if (Li < 2.0 - EPS) {
      if (!p.t555NarrowPier)
        e.push(`Pier ${i + 1}: L = ${Li} ft < 2.0 ft (SDPWS 2021 §4.3.5.2). Enable t555NarrowPier to use the APA T555 alternate.`);
      else w.push(`Pier ${i + 1}: L = ${Li} ft uses APA T555 narrow-pier alternate (1.5–2.0 ft, blocked, h/b ≤ 3.5) — requires building official acceptance, CBC §104.11.`);
    }
  });

  // non-default factors
  if (Math.abs(p.kASD_E - 0.7 * p.rho) > EPS) w.push(`Non-default kASD_E = ${p.kASD_E} (default 0.7ρ = ${round(0.7 * p.rho)}).`);
  if (Math.abs(p.kASD_W - 0.6) > EPS) w.push(`Non-default kASD_W = ${p.kASD_W} (default 0.6).`);
  if (Math.abs(p.kDefl_E - 1.0) > EPS) w.push(`Non-default kDefl_E = ${p.kDefl_E} (default 1.0).`);
  if (p.faces === 2) w.push('Two sheathed faces: 2·v_s and 2·G_a used — beyond APA M410 test scope; FTAO statics unchanged.');
  if (!p.includeDeltaC) w.push('Δc crushing term disabled (APA regression mode).');
  return { e, w };
}

// ---------------------------------------------------------------- geometry
function governingOpening(openings) {
  let g = 0;
  openings.forEach((o, j) => {
    const G = openings[g];
    // Tie on h_o: h_a + h_b is then identical (= h_wall − h_o), so v_a is identical.
    // Break the tie on smallest h_b → tallest pier height h_wall − h_b in deflection (conservative).
    if (o.ho > G.ho + EPS || (Math.abs(o.ho - G.ho) <= EPS && o.hb < G.hb - EPS)) g = j;
  });
  return g;
}

// ---------------------------------------------------------------- statics
/**
 * Diekmann FTAO distribution for a given top-of-wall shear V (any level, linear).
 * Pier i (0-based) sits between opening i-1 (left) and opening i (right).
 */
function statics(p, geo, V) {
  const { L, Lo } = p;
  const { ha, ho, hb, h, Lwall } = geo;
  const N = Lo.length;
  const H = (V * h) / Lwall;
  const va = H / (ha + hb);
  const O = Lo.map((l) => va * l);

  // corner forces and tributary lengths per opening
  const Fl = [], Fr = [], Tl = [], Tr = [];
  for (let j = 0; j < N; j++) {
    const s = L[j] + L[j + 1];
    Fl[j] = (O[j] * L[j]) / s;
    Fr[j] = (O[j] * L[j + 1]) / s;
    Tl[j] = (L[j] * Lo[j]) / s;
    Tr[j] = (L[j + 1] * Lo[j]) / s;
  }

  const piers = L.map((Li, i) => {
    const Tsum = (i > 0 ? Tr[i - 1] : 0) + (i < N ? Tl[i] : 0);
    const Fsum = (i > 0 ? Fr[i - 1] : 0) + (i < N ? Fl[i] : 0);
    const v = ((V / Lwall) * (Li + Tsum)) / Li;
    const R = v * Li;
    const vc = (R - Fsum) / Li;
    return { i: i + 1, L: Li, T: Tsum, v, R, Fsum, vc };
  });

  // T555 step 10 line checks: end lines = H, interior lines = 0
  const lines = [];
  piers.forEach((pr, i) => {
    const edgeSum = pr.vc * (ha + hb) + pr.v * ho;
    const leftTarget = i === 0 ? H : 0;
    const rightTarget = i === N ? H : 0;
    lines.push({ line: 2 * i + 1, value: i === 0 ? edgeSum : va * (ha + hb) - edgeSum, target: leftTarget });
    lines.push({ line: 2 * i + 2, value: i === N ? edgeSum : va * (ha + hb) - edgeSum, target: rightTarget });
  });
  const vSum = piers.reduce((a, pr) => a + pr.v * pr.L, 0);

  return {
    V, H, va, O,
    corners: Array.from({ length: N }, (_, j) => ({ opening: j + 1, F_left: Fl[j], F_right: Fr[j], T_left: Tl[j], T_right: Tr[j] })),
    Fmax: Math.max(...Fl, ...Fr),
    piers,
    lines: lines.map((l) => ({ ...l, residual: l.value - l.target })),
    shearSumCheck: vSum - V,
    anchorage: V / Lwall,
  };
}

// ---------------------------------------------------------------- element
/**
 * Create an FTAO wall element.
 * @param {object} input  see references/io_register.md
 * @returns {{capacity:Function, design:Function, deflection:Function, input:object, geometry:object, warnings:string[]}}
 * @throws {FTAOInputError} on any hard stop
 */
export function createFTAO(input) {
  const p = normalize(input);
  const { e, w } = validate(p);
  const warnings = [...w];

  // geometry envelope
  const g = governingOpening(p.openings);
  const G = p.openings[g];
  const Lwall = p.L.reduce((a, b) => a + b, 0) + p.Lo.reduce((a, b) => a + b, 0);
  const geo = { governing: g + 1, ha: G.ha, ho: G.ho, hb: G.hb, h: p.h_wall, Lwall };
  const unequal = p.openings.some((o) => Math.abs(o.ho - G.ho) > EPS || Math.abs(o.ha - G.ha) > EPS || Math.abs(o.hb - G.hb) > EPS);
  geo.ignoredOpenings = unequal ? p.openings.map((_, j) => j + 1).filter((j) => j !== g + 1) : [];
  if (unequal) warnings.push(`Unequal opening heights: wall analyzed at governing opening ${g + 1} (h_a=${G.ha}, h_o=${G.ho}, h_b=${G.hb}) per APA largest-opening rule.`);

  // aspect ratios (h = governing h_o, SDPWS 2021 §4.3.5.2 / T555 detailing 1)
  geo.piers = p.L.map((Li, i) => {
    const ar = G.ho / Li;
    const Car = aspectFactor(G.ho, Li, p.arMethod);
    if (Car === null) e.push(`Pier ${i + 1}: h_o/b_s = ${round(ar, 2)} > 3.5 — not permitted as part of FTAO wall.`);
    return { i: i + 1, L: Li, aspect: ar, Car: Car ?? NaN };
  });

  // cautions (APA xlsx checks)
  p.openings.forEach((o, j) => {
    if (o.ha < 1.0 || o.hb < 1.0) warnings.push(`Opening ${j + 1}: sheathing height above or below < 1.0 ft — exercise caution.`);
    if (p.Lo[j] / o.ha > 6.5 || p.Lo[j] / o.hb > 6.5) warnings.push(`Opening ${j + 1}: width-to-height of sheathing above/below > 6.5:1 — exercise caution.`);
  });

  if (e.length) throw new FTAOInputError(e);

  const kASD = p.loadType === 'E' ? p.kASD_E : p.kASD_W;
  const kDefl = p.loadType === 'E' ? p.kDefl_E : p.alpha_s;
  const vAllow = p.faces * (p.vs_nominal / 2.0); // SDPWS 2021 §4.3.3, ASD Ω = 2.0
  const Ga = p.faces * p.Ga;
  const FcpPrime = p.includeDeltaC ? p.Fcperp_plate * p.CM * p.Ct : null;
  const nP = p.L.length;
  const Aend = { left: p.A_post[0], right: p.A_post[2 * nP - 1] };

  function sheathingDCR(st) {
    const zones = [];
    st.piers.forEach((pr, i) => {
      const Car = geo.piers[i].Car;
      zones.push({ zone: `pier ${pr.i}`, demand: pr.v, capacity: vAllow * Car, Car, dcr: pr.v / (vAllow * Car) });
      zones.push({ zone: `corner zone pier ${pr.i}`, demand: Math.abs(pr.vc), capacity: vAllow, dcr: Math.abs(pr.vc) / vAllow });
    });
    zones.push({ zone: 'above/below openings', demand: st.va, capacity: vAllow, dcr: st.va / vAllow });
    return zones;
  }

  // ---------------- capacity(): linear in V
  function capacity() {
    const Vtrial = 1000;
    const st = statics(p, geo, Vtrial);
    const zones = sheathingDCR(st);
    const gov = zones.reduce((a, z) => (z.dcr > a.dcr ? z : a));
    const Vcap_ASD = Vtrial / gov.dcr;
    return {
      Vcap_ASD: round(Vcap_ASD, 0),
      Vcap_1p0: round(Vcap_ASD / kASD, 0),
      kASD,
      governingZone: gov.zone,
      vAllow: round(vAllow, 1),
      basis: 'Sheathing only (SDPWS 2021 §4.3.3, v_s/2.0 × faces × C_ar). Straps and hold-downs are sized to the resulting share.',
    };
  }

  // ---------------- design(V1.0)
  function design(V1) {
    if (!isNum(V1) || V1 <= 0) throw new FTAOInputError(['V (1.0-level) must be > 0.']);
    const V = kASD * V1;
    const st = statics(p, geo, V);
    const zones = sheathingDCR(st).map((z) => ({ ...z, status: status(z.dcr, p.dcrTol) }));
    const maxZ = zones.reduce((a, z) => (z.dcr > a.dcr ? z : a));
    const strap = { demand: st.Fmax, allow: p.strap_allow, dcr: st.Fmax / p.strap_allow };
    strap.status = status(strap.dcr, p.dcrTol);
    const hd = { T: st.H, C: st.H, allow: p.HD_allow, dcr: st.H / p.HD_allow, arm: 'L_wall', note: 'Gross overturning T = C = V·h_wall/L_wall; dead load not included.' };
    hd.status = status(hd.dcr, p.dcrTol);
    const bearing = p.includeDeltaC
      ? ['left', 'right'].map((side) => {
          const fc = st.H / Aend[side];
          const dcr = fc / FcpPrime;
          return { end: side, C: st.H, A: Aend[side], fc_perp: fc, Fc_perp_prime: FcpPrime, dcr, status: status(dcr, p.dcrTol) };
        })
      : [];
    const allChecks = [...zones.map((z) => z.status), strap.status, hd.status, ...bearing.map((b) => b.status)];
    return {
      loads: { V_1p0: V1, kASD, V_ASD: V },
      geometry: geo,
      forces: {
        H: st.H, va: st.va, O: st.O, corners: st.corners, Fmax: st.Fmax,
        piers: st.piers, anchorage_plf: st.anchorage,
        lineChecks: st.lines, shearSumResidual: st.shearSumCheck,
      },
      checks: {
        sheathing: zones, governing: { zone: maxZ.zone, dcr: maxZ.dcr, status: maxZ.status },
        strap, holdDown: hd, plateBearing: bearing,
        overall: allChecks.includes('NG') ? 'NG' : allChecks.includes('OK*') ? 'OK*' : 'OK',
      },
      notes: ['Straps continuous full wall length above and below openings (APA T555 Figs. 2–4); F also = flat-blocking compression demand.'],
      warnings: [...warnings],
    };
  }

  // ---------------- deflection(V1.0)
  function deflection(V1) {
    if (!isNum(V1) || V1 <= 0) throw new FTAOInputError(['V (1.0-level) must be > 0.']);
    const V = kDefl * V1;
    const st = statics(p, geo, V);
    const wWarn = [];
    const Cend = st.H; // gross chord force at V_defl (no dead load)
    const cases = [];
    st.piers.forEach((pr, i) => {
      for (const dir of ['L', 'R']) {
        const edge = 2 * i + (dir === 'L' ? 0 : 1);
        // APA: pier deflecting away from sheathing below opening → full height
        const fullHeight = (i === 0 && dir === 'L') || (i === nP - 1 && dir === 'R');
        const hh = fullHeight ? geo.h : geo.h - geo.hb;
        const E = p.E_post[edge], A = p.A_post[edge], b = pr.L;
        const t1 = (8 * pr.v * hh ** 3) / (E * A * b);
        const t2 = (pr.v * hh) / (1000 * Ga);
        const Tpier = pr.v * hh;
        const dHD = p.d_a * (Tpier / p.HD_allow);
        let dC = 0, r = null;
        if (fullHeight && p.includeDeltaC) {
          r = Cend / (A * FcpPrime);
          dC = crushingDeflection(r);
        }
        const Da = dHD + dC;
        const t3 = (hh * Da) / b;
        if (Tpier > p.HD_allow + EPS) wWarn.push(`Pier ${pr.i}-${dir}: T_defl = ${round(Tpier, 0)} lbf > HD_allow — d_a extrapolated linearly beyond manufacturer tested load.`);
        if (r != null && r > 1.0) wWarn.push(`Pier ${pr.i}-${dir}: plate bearing r = ${round(r, 2)} > 1.0 at V_defl — crushing beyond NDS §4.2.6 reference deformation.`);
        cases.push({ pier: pr.i, dir, h: hh, v: pr.v, E, A, b, term1_bending: t1, term2_shear: t2, dHD, dC, r, Da, term3_anchorage: t3, sum: t1 + t2 + t3 });
      }
    });
    const Delta = cases.reduce((a, c) => a + c.sum, 0) / cases.length;
    const out = {
      loads: { V_1p0: V1, kDefl, V_defl: V },
      equation: 'SDPWS 2021 Eq. 4.3-1 (3-term), APA T555 pier ± averaging',
      Ga_used: Ga,
      cases,
      Delta_in: Delta,
      warnings: [...warnings, ...wWarn],
    };
    if (p.includeDeltaC) out.warnings.push('Δc uses gross chord C (no dead load) — compression-side crushing may be under-predicted.');
    if (p.loadType === 'E') {
      out.delta_xe = Delta;
      out.delta_x = (p.Cd * Delta) / p.Ie;
      out.driftRatio = out.delta_x / (p.h_sx * 12);
      out.driftNote = 'δx = Cd·δxe/Ie (ASCE 7-22 §12.8.6). Compare with Table 12.12-1 at story level.';
    } else {
      out.driftRatio = Delta / (p.h_wall * 12);
      out.driftNote = 'Service-wind deflection, report only (not codified).';
    }
    return out;
  }

  return {
    input: Object.freeze({ ...p }),
    geometry: geo,
    warnings,
    capacity,
    design,
    deflection,
  };
}

/** Convenience: run all three methods for input.V (1.0 level). */
export function runFTAO(input) {
  const el = createFTAO(input);
  return { version: VERSION, input: el.input, capacity: el.capacity(), design: el.design(input.V), deflection: el.deflection(input.V) };
}

