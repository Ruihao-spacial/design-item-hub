// Helpers for writing verification case sources (tests/cases/src/Vxx.mjs → tests/cases/Vxx-*.json).
// The hand calc in each source is plain arithmetic from the code tables below (SDPWS 2021 Table 4.3A with the
// 0.92 footnote 10, HDUE / MSTC catalogs, NDS 2018 column) — it never calls the engine.
// Build: npm run cases:build
import fs from 'fs';

export const SCHEMA = 12;

// === Code tables used by the hand calcs (copied from the reference files, not imported from the engine) ===
export const NAIL = [ // id, ASD seismic / wind unit shear (plf), Ga plywood / OSB (k/in)
  { id: '6', label: '6" o.c.', E: 312, W: 437, gaPLY: 16, gaOSB: 22 },
  { id: '4', label: '4" o.c.', E: 470, W: 658, gaPLY: 20, gaOSB: 29 },
  { id: '3', label: '3" o.c.', E: 611, W: 856, gaPLY: 22, gaOSB: 36 },
  { id: '2', label: '2" o.c.', E: 800, W: 1120, gaPLY: 28, gaOSB: 51 },
  { id: '4B', label: '4" o.c. (both)', E: 940, W: 1316, gaPLY: 40, gaOSB: 58 },
  { id: '3B', label: '3" o.c. (both)', E: 1222, W: 1711, gaPLY: 44, gaOSB: 72 },
  { id: '2B', label: '2" o.c. (both)', E: 1600, W: 2240, gaPLY: 56, gaOSB: 102 },
];
export const HDUE = [['HDUE3', 3790, 0.127], ['HDUE5', 5375, 0.146], ['HDUE7', 7015, 0.154], ['HDUE9', 8425, 0.159], ['HDUE13', 12950, 0.145], ['HDUE17', 17685, 0.111]]
  .map(([id, cap, delta]) => ({ id, cap, delta }));
export const MSTC16 = [['MSTC28', 1535, 0.0808], ['MSTC40', 3070, 0.0970], ['MSTC52', 4610, 0.1188], ['MSTC66', 5850, 0.1296]].map(([id, cap, delta]) => ({ id, cap, delta }));

// SDPWS 2021 §4.3.4 aspect ratio factor
export const Chb = (h, b) => (h / b <= 2 ? 1 : h / b <= 3.5 ? 1.25 - 0.125 * h / b : 0);
// Lightest nailing with v ≤ cap × C_hb (lt 'E' | 'W')
export const pickNail = (v, lt = 'E', C = 1) => NAIL.find(n => v <= n[lt] * C + 1e-9) || null;
export const pickHD = (Tk) => HDUE.find(h => h.cap >= Tk * 1000) || null;
export const pickStrap = (Tk) => MSTC16.find(h => h.cap >= Tk * 1000) || null;

// NDS 2018 column capacity (DF-L No.1 unless given): C_D 1.6, K_e 1.0, l2 = 6" braced by sheathing, c = 0.8
export const GRADE_NO1 = { Fc: 1500, Fcperp: 625, E: 1700000, Emin: 620000 };
export const POSTS4 = [ // wall 4": order the engine tries them in (lightest first as listed)
  { id: '2x4', d1: 3.5, d2: 1.5, A: 5.25, CF: 1.15 }, { id: '(2)2x4', d1: 3.5, d2: 3.0, A: 10.5, CF: 1.15 },
  { id: '(3)2x4', d1: 3.5, d2: 4.5, A: 15.75, CF: 1.15 }, { id: '4x4', d1: 3.5, d2: 3.5, A: 12.25, CF: 1.15 },
  { id: '6x4', d1: 3.5, d2: 5.5, A: 19.25, CF: 1.10 }, { id: '8x4', d1: 3.5, d2: 7.5, A: 26.25, CF: 1.10 },
];
export function postCap(p, hFt, g = GRADE_NO1) {
  const Fstar = g.Fc * 1.6 * p.CF;
  const axis = (le, d) => { const CT = 1 + 1200 * le / (0.59 * g.E); const r = le / d; return 0.822 * g.Emin * CT / (r * r); };
  const FcE = Math.min(axis(hFt * 12, p.d1), axis(6, p.d2));
  const R = FcE / Fstar;
  const Cp = (1 + R) / 1.6 - Math.sqrt(((1 + R) / 1.6) ** 2 - R / 0.8);
  const Fc1 = Fstar * Cp, Fperp = g.Fcperp * (p.d2 + 0.375) / p.d2;
  return { Fstar, FcE, Cp, Fc1, Fperp, cap: Math.round(Math.min(Fc1, Fperp) * p.A / 10) / 100 };
}

// ASCE 7-22 ASD seismic factors
export const asdE = (Sds) => ({ up: 0.6 - 0.14 * Sds, dn: 1 + 0.14 * Sds, d6: 1 + 0.105 * Sds });

// Rounding for the hand-calc text
export const f2 = (v) => (+v).toFixed(2);
export const f3 = (v) => (+v).toFixed(3);
export const f4 = (v) => (+v).toFixed(4);

// === Definition builders (schema v10) ===
export function project(o = {}) {
  return {
    sds: '1.0', loadType: 'seismic', wallThickness: '4', woodGrade: 'dfir_no1', sheathing: 'ply', distribution: 'capacity',
    cd: '', ie: '', riskCategory: '', driftRow: 'other', driftBypass: false, alphaS: '', windDriftLimit: '400', omega0: '', lrfdHalfL: false,
    wswhFc: '2500', seismicDesignCategory: '', detachedOneTwoFamily: false, pdfReport: 'detailed', refs: {}, notes: '',
    wallDLTypes: [{ id: 'wdt-1', name: 'Stud wall', psf: '10' }],
    levels: [], directions: [], ...o,
  };
}
export const level = (id, name, floorToFloor, o = {}) => ({ id, name, floorToFloor, anchorageType: 'auto', floorClearSpan: '16', ...o });
export const direction = (id, name, lines, rho = 1) => ({ id, name, rho, lines });
export function line(o) {
  return { id: 'ln-1', name: 'Line A', totalLength: 30, wallThickness: '', distribution: '', driftBypass: '', distReviewed: [],
    levelLoads: {}, gravityLoads: {}, walls: [], beams: [], supportPosts: [], ...o };
}
export function wall(id, mark, levelId, position, length, o = {}) {
  return { id, mark, levelId, position, length, method: 'segmented', systemType: 'sheathed', openings: [], narrowPier: false,
    wallDLTypeId: 'wdt-1', nailingPattern: '', anchorageLeftOverride: '', anchorageRightOverride: '', postLeftOverride: '', postRightOverride: '',
    ftaoStrapOverride: '', jambPostOverride: '', wswhWidth: '18', wswhCondition: 'concrete', wswhJoist: '12', wswhFloorDepth: '12', wswhAnchorOverride: '', ...o };
}
export const panel = (id, mark, levelId, position, o = {}) => wall(id, mark, levelId, position, 1.5, { systemType: 'wswh', ...o });
export const beam = (id, mark, levelId, position, length, supports) => ({ id, mark, levelId, position, length,
  supports: supports.map(([sid, pos, type = 'point']) => ({ id: sid, position: pos, type, anchorageOverride: '' })) });
export const post = (id, mark, levelId, position, o = {}) => ({ id, mark, levelId, position, postOverride: '', anchorageOverride: '', ...o });
// Gravity rows: point (k), full (plf), partial (plf from start to end)
export const gPoint = (id, x, D, L = '', Lr = '') => ({ id, shape: 'point', position: x, start: 0, end: 0, D: String(D), L: String(L), Lr: String(Lr), perArea: false, trib: '', assemblyId: '' });
export const gFull = (id, D, L = '', Lr = '') => ({ id, shape: 'full', position: 0, start: 0, end: 0, D: String(D), L: String(L), Lr: String(Lr), perArea: false, trib: '', assemblyId: '' });
export const gPart = (id, start, end, D, L = '', Lr = '') => ({ id, shape: 'partial', position: 0, start, end, D: String(D), L: String(L), Lr: String(Lr), perArea: false, trib: '', assemblyId: '' });

// Expect row helpers
export const ex = (label, at, field, value, step, tol) => ({ label, at, field, value, tol: tol != null ? tol : typeof value === 'number' ? 0.005 : undefined, step });

// === Seismic design inputs and story drift by hand (user 2026-10-01: every method case has Cd / Ie / RC / Ω₀) ===
// Wood structural panel bearing walls, ASCE 7-22 Table 12.2-1 A.15: Cd 4, Ω₀ 2.5 (flexible diaphragm); Ie 1.0, RC II
// → drift check on (Table 12.12-1, "all other structures": Δa = 0.020·h_sx); Ω₀ only adds the Ω₀ force tables.
export const SEISMIC = { cd: '4', ie: '1.0', riskCategory: 'II', omega0: '2.5' };
const crushOf = (r) => 0.02 * (r < 0.73 ? r / 0.73 : r <= 1 ? 1 + (r - 0.73) / 0.27 : 2 * r ** 3); // SDPWS C4.3.4-2 curve
// Holdown / strap at a wall end: δ at its basis load (HDUE: ASD cap; MSTC: cap / 0.7, the strap LRFD cap)
export function anchorOf(id) {
  const h = HDUE.find(x => x.id === id); if (h) return { id, delta: h.delta, basis: h.cap, basisText: h.cap + ' (ASD cap)' };
  const s = MSTC16.find(x => x.id === id); if (s) return { id, delta: s.delta, basis: s.cap / 0.7, basisText: s.cap + '/0.7' };
  throw new Error('anchor ' + id);
}
const postOf = (id) => { const p = POSTS4.find(x => x.id === id); if (!p) throw new Error('post ' + id); return p; };
// SDPWS 2021 Eq. 4.3-1 of one wall at 1.0E, both directions (→: holdown slip at the left end, crushing at the right;
// ← mirrored), the larger governs. The design is the case's pinned one. Vk = the wall's 1.0E share (k);
// TL / CR = the 1.0E tension at the left end / compression at the right end for → (k), own V·h/L + from above;
// TR / CL the same for ← (default = TL / CR, a symmetric stack). A = the smaller end post (bending term).
export function eq431({ mark, L, h, nail, hdL, hdR, postL, postR, Vk, TL, CR, TR, CL, E = 1700000, Fcp = 625 }) {
  const Ga = NAIL.find(n => n.id === nail).gaPLY, pL = postOf(postL), pR = postOf(postR), A = Math.min(pL.A, pR.A);
  const v = 1000 * Vk / L, t1 = 8 * v * h ** 3 / (E * A * L), t2 = v * h / (1000 * Ga);
  const one = (dir, Tk, Ck, hd, pc) => {
    const a = anchorOf(hd), T = 1000 * Tk, C = 1000 * Ck, dHD = a.delta * T / a.basis, r = C / (pc.A * Fcp), dC = crushOf(r), t3 = h * (dHD + dC) / L;
    return { dir, T, C, a, pc, dHD, r, dC, t3, delta: t1 + t2 + t3 };
  };
  const dirs = [one('→', TL, CR, hdL, pR), one('←', TR != null ? TR : CR, CL != null ? CL : TL, hdR, pL)];
  const g = dirs[0].delta >= dirs[1].delta ? dirs[0] : dirs[1];
  const text = mark + ' (Eq. 4.3-1, ' + g.dir + ' governs): v = 1000 × ' + f3(Vk) + ' / ' + L + ' = ' + f2(v) + ' plf, A = ' + A + ' in², G_a = ' + Ga + ' k/in → 8vh³/(EAb) = ' + f4(t1)
    + '; vh/(1000G_a) = ' + f4(t2) + '; Δ_HD = ' + g.a.delta + ' × ' + f2(g.T) + ' / ' + g.a.basisText + ' = ' + f4(g.dHD) + ' (' + g.a.id + ', T = ' + f2(g.T) + ' lb)'
    + '; r = ' + f2(g.C) + ' / (' + g.pc.A + ' × ' + Fcp + ') = ' + f4(g.r) + ' → Δ_c = ' + f4(g.dC) + '; h·Δa/b = ' + h + ' × (' + f4(g.dHD) + ' + ' + f4(g.dC) + ') / ' + L + ' = ' + f4(g.t3)
    + ' → δ = ' + f4(g.delta) + ' in.';
  return { mark, t1, t2, dirs, gov: g, delta: g.delta, text };
}
// Story drift (ASCE 7-22 §12.8.6): δxe = the largest wall δ at the story, δx = Cd·δxe / Ie ≤ Δa = 0.020·h_sx (RC II)
export function storyDrift(levelName, h, walls, { Cd = 4, Ie = 1, limit = 0.020 } = {}) {
  const gov = walls.reduce((a, w) => (w.delta > a.delta ? w : a));
  const dxe = gov.delta, dx = Cd * dxe / Ie, Da = limit * h * 12, pass = dx <= Da + 1e-9;
  const text = 'Story drift ' + levelName + ': δxe = the largest wall δ = ' + gov.mark + ' ' + f4(dxe) + ' in → δx = Cd·δxe/Ie = ' + Cd + ' × ' + f4(dxe) + ' / ' + Ie.toFixed(1) + ' = ' + f3(dx)
    + ' in vs Δa = ' + limit.toFixed(3) + ' × ' + h + ' × 12 = ' + f3(Da) + ' in → ' + (pass ? 'OK' : 'NG — over the limit (design pinned, so drift sizing does not change it; the line reports drift NG)') + '.';
  return { levelName, gov, dxe, dx, Da, pass, text };
}
// Expect rows for one story drift (line: the line name when the case has more than one line)
export function driftExpect(d, step, line) {
  const rows = [
    ex('Story δxe, ' + d.levelName + ' (in)', 'drift:' + d.levelName, 'seismic.deltaXE', d.dxe, step, 0.0005),
    ex('Governing wall for drift, ' + d.levelName, 'drift:' + d.levelName, 'seismic.wallMark', d.gov.mark, step),
    ex('δx = Cd·δxe/Ie, ' + d.levelName + ' (in)', 'drift:' + d.levelName, 'seismic.deltaX', d.dx, step, 0.002),
    ex('Drift ' + (d.pass ? 'passes' : 'NG') + ', ' + d.levelName, 'drift:' + d.levelName, 'seismic.pass', d.pass, step),
  ];
  return line ? rows.map(r => ({ ...r, line, label: line + ' — ' + r.label })) : rows;
}

// Method cases pin the design (nailing, holdowns / straps, posts, WSWH anchors, beam-support hardware) as manual
// overrides, so a change in the selection rules never moves their hand calcs. pins: { '[Line/]mark': { nail, hdL, hdR,
// postL, postR, ftaoStrap, wswhAnchor } | { post, hd } (support post) | { support0, support1 } (beam, by support position) }.
// The selection rules themselves are tested in tests/shearWallRules.test.mjs.
export function applyPins(inputs, pins) {
  if (!pins) return inputs;
  const lines = (inputs.directions || []).flatMap(d => d.lines || []);
  const used = new Set();
  for (const ln of lines) {
    const key = (m) => (lines.length > 1 ? ln.name + '/' : '') + m;
    const pin = (m) => { const k = key(m); if (pins[k]) used.add(k); return pins[k]; };
    for (const w of ln.walls || []) {
      const p = pin(w.mark); if (!p) continue;
      const set = (f, v) => { if (v) w[f] = v; };
      set('nailingPattern', p.nail); set('anchorageLeftOverride', p.hdL); set('anchorageRightOverride', p.hdR);
      set('postLeftOverride', p.postL); set('postRightOverride', p.postR); set('ftaoStrapOverride', p.ftaoStrap); set('wswhAnchorOverride', p.wswhAnchor);
    }
    for (const sp of ln.supportPosts || []) {
      const p = pin(sp.mark); if (!p) continue;
      if (p.post) sp.postOverride = p.post;
      if (p.hd) sp.anchorageOverride = p.hd;
    }
    for (const b of ln.beams || []) {
      const p = pin(b.mark); if (!p) continue;
      [...(b.supports || [])].sort((a, c) => (+a.position) - (+c.position)).forEach((s, i) => { if (p['support' + i]) s.anchorageOverride = p['support' + i]; });
    }
  }
  const unused = Object.keys(pins).filter(k => !used.has(k));
  if (unused.length) throw new Error('pins for unknown elements: ' + unused.join(', '));
  return inputs;
}
// "Given (pinned)" lines for the catalog
export function pinnedText(pins) {
  const t = { nail: 'nailing', hdL: 'HD/strap L', hdR: 'HD/strap R', postL: 'post L', postR: 'post R', ftaoStrap: 'FTAO strap', wswhAnchor: 'anchor',
    post: 'post', hd: 'base HD/strap', support0: 'support a', support1: 'support b' };
  return Object.entries(pins || {}).filter(([, p]) => Object.keys(p).length)
    .map(([k, p]) => k + ': ' + Object.entries(p).map(([f, v]) => (t[f] || f) + ' ' + v).join(', '));
}

// Write the case JSON
export function writeCase(c) {
  const slug = c.slug || c.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const file = new URL('../' + c.id + '-' + slug + '.json', import.meta.url);
  const { slug: _s, ...rest } = c;
  const body = { id: c.id, title: c.title, intent: c.intent, covers: c.covers || [], handCalc: c.handCalc.map((t, i) => ({ step: i + 1, text: t })),
    expect: c.expect, expectChecks: c.expectChecks || { fail: [] }, notChecked: c.notChecked || '', pinned: c.pins || null, schemaVersion: SCHEMA,
    inputs: applyPins(JSON.parse(JSON.stringify(rest.inputs)), c.pins) };
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n');
  return file;
}
