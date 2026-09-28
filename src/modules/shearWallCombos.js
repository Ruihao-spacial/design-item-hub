// ASCE 7-22 load combinations for shear wall end forces: D, L, Lr, W, E (S, R, H, F not tracked).
// Each combination = factors on the dead / live / roof live end reactions (d, l, lr) and on the
// 1.0-level overturning moments (e on 1.0E, w on 1.0W). Lateral combos come in _pos / _neg pairs.
// Groups: 'asd' = design; 'load_case' = deflection / display; 'lrfd', 'asd_omega', 'lrfd_omega' =
// reported forces (support post members also use Ω₀ ASD).

// opts: { loadType, sds, rho, omega0, lrfdHalfL }  lrfdHalfL: L factor 0.5 in LRFD combos
// §2.3.1 (3), (4) and §2.3.6 (6) (Lo ≤ 100 psf, not garages / places of public assembly)
export function comboDefs({ loadType = 'seismic', sds = 0, rho = 1, omega0 = 2.5, lrfdHalfL = false } = {}) {
  const S = parseFloat(sds) || 0, R = parseFloat(rho) || 1, O = parseFloat(omega0) || 2.5;
  const E = loadType === 'seismic' || loadType === 'both';
  const W = loadType === 'wind' || loadType === 'both';
  const fL = lrfdHalfL ? 0.5 : 1.0;
  const c = (key, group, f, text, ref, signed = false) => ({ key, group, d: 0, l: 0, lr: 0, e: 0, w: 0, ...f, text, ref, signed });
  const n = (v) => +v.toFixed(4);
  const defs = [
    // Load cases (unfactored)
    c('1.0D', 'load_case', { d: 1 }, '1.0D', 'load case'),
    c('1.0L', 'load_case', { l: 1 }, '1.0L', 'load case'),
    c('1.0Lr', 'load_case', { lr: 1 }, '1.0Lr', 'load case'),
    // ASD gravity (§2.4.1 combos 1–4)
    c('D', 'asd', { d: 1 }, 'D', '§2.4.1 (1)'),
    c('D+L', 'asd', { d: 1, l: 1 }, 'D + L', '§2.4.1 (2)'),
    c('D+Lr', 'asd', { d: 1, lr: 1 }, 'D + Lr', '§2.4.1 (3)'),
    c('D+0.75L+0.75Lr', 'asd', { d: 1, l: 0.75, lr: 0.75 }, 'D + 0.75L + 0.75Lr', '§2.4.1 (4)'),
    // LRFD gravity (§2.3.1 combos 1–3)
    c('1.4D', 'lrfd', { d: 1.4 }, '1.4D', '§2.3.1 (1)'),
    c('1.2D+1.6L+0.5Lr', 'lrfd', { d: 1.2, l: 1.6, lr: 0.5 }, '1.2D + 1.6L + 0.5Lr', '§2.3.1 (2)'),
    c('1.2D+1.6Lr+L', 'lrfd', { d: 1.2, l: fL, lr: 1.6 }, '1.2D + 1.6Lr + ' + (fL === 1 ? '' : '0.5') + 'L', '§2.3.1 (3)'),
  ];
  if (E) {
    const up = n(0.6 - 0.14 * S), dn = n(1.0 + 0.14 * S), d6 = n(1.0 + 0.105 * S);
    const lu = n(0.9 - 0.2 * S), ld = n(1.2 + 0.2 * S);
    defs.push(
      c('1.0E', 'load_case', { e: 1 }, '1.0E', 'load case'), // one direction: equal and opposite end forces
      c('D+0.7ρE', 'asd', { d: dn, e: 0.7 * R }, '(1.0+0.14SDS)D + 0.7ρE', '§2.4.5 (5)', true),
      c('D+0.525ρE+0.75L', 'asd', { d: d6, e: 0.525 * R, l: 0.75 }, '(1.0+0.105SDS)D + 0.525ρE + 0.75L', '§2.4.5 (6)', true),
      c('0.6D+0.7ρE', 'asd', { d: up, e: 0.7 * R }, '(0.6−0.14SDS)D + 0.7ρE', '§2.4.5 (8)', true),
      c('(1.2+0.2SDS)D+ρE+L', 'lrfd', { d: ld, e: R, l: fL }, '(1.2+0.2SDS)D + ρE + ' + (fL === 1 ? '' : '0.5') + 'L', '§2.3.6 (6)', true),
      c('(0.9-0.2SDS)D+ρE', 'lrfd', { d: lu, e: R }, '(0.9−0.2SDS)D + ρE', '§2.3.6 (7)', true),
      c('D+0.7Ω₀E', 'asd_omega', { d: dn, e: 0.7 * O }, '(1.0+0.14SDS)D + 0.7Ω₀E', '§2.4.5 (5) with Ω₀', true),
      c('D+0.525Ω₀E+0.75L', 'asd_omega', { d: d6, e: 0.525 * O, l: 0.75 }, '(1.0+0.105SDS)D + 0.525Ω₀E + 0.75L', '§2.4.5 (6) with Ω₀', true),
      c('0.6D+0.7Ω₀E', 'asd_omega', { d: up, e: 0.7 * O }, '(0.6−0.14SDS)D + 0.7Ω₀E', '§2.4.5 (8) with Ω₀', true),
      c('(1.2+0.2SDS)D+Ω₀E+L', 'lrfd_omega', { d: ld, e: O, l: fL }, '(1.2+0.2SDS)D + Ω₀E + ' + (fL === 1 ? '' : '0.5') + 'L', '§2.3.6 (6) with Ω₀', true),
      c('(0.9-0.2SDS)D+Ω₀E', 'lrfd_omega', { d: lu, e: O }, '(0.9−0.2SDS)D + Ω₀E', '§2.3.6 (7) with Ω₀', true),
    );
  }
  if (W) {
    defs.push(
      c('1.0W', 'load_case', { w: 1 }, '1.0W', 'load case'),
      c('D+0.6W', 'asd', { d: 1, w: 0.6 }, 'D + 0.6W', '§2.4.1 (5)', true),
      c('D+0.75(0.6W)+0.75L+0.75Lr', 'asd', { d: 1, w: 0.45, l: 0.75, lr: 0.75 }, 'D + 0.75L + 0.75(0.6W) + 0.75Lr', '§2.4.1 (6)', true),
      c('0.6D+0.6W', 'asd', { d: 0.6, w: 0.6 }, '0.6D + 0.6W', '§2.4.1 (7)', true),
      c('1.2D+1.6Lr+0.5W', 'lrfd', { d: 1.2, lr: 1.6, w: 0.5 }, '1.2D + 1.6Lr + 0.5W', '§2.3.1 (3)', true),
      c('1.2D+1.0W+L+0.5Lr', 'lrfd', { d: 1.2, w: 1.0, l: fL, lr: 0.5 }, '1.2D + 1.0W + ' + (fL === 1 ? '' : '0.5') + 'L + 0.5Lr', '§2.3.1 (4)', true),
      c('0.9D+1.0W', 'lrfd', { d: 0.9, w: 1.0 }, '0.9D + 1.0W', '§2.3.1 (5)', true),
    );
  }
  return defs;
}

// Combo keys as stored on the results (lateral combos get _pos / _neg)
export function comboKeysOf(defs) {
  return defs.flatMap(d => (d.signed ? [d.key + '_pos', d.key + '_neg'] : [d.key]));
}

// Gravity-only value of a combo for loads { D, L, Lr } (kips, + = compression)
export function gravityValue(f, g) {
  return (f.d || 0) * (g.D || 0) + (f.l || 0) * (g.L || 0) + (f.lr || 0) * (g.Lr || 0);
}
