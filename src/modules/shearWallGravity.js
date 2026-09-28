// Gravity loads on a wall line (schema v8): one row per load with a shape and D / L / Lr magnitudes.
//   point   — position (ft); D, L, Lr in kips
//   full    — uniform along the whole line at that level; D, L, Lr in plf
//   partial — uniform from start to end (ft); D, L, Lr in plf
// A uniform row may be linked to a Flat Load assembly × tributary width (assemblyId, trib):
// D plf = dead psf × trib; live psf × trib goes to Lr for a roof assembly, else to L.
// line.gravityLoads[levelId] = { loads: [...] } — the loads sit at the top of that story (its floor /
// roof above). Each wall below takes the part directly above it (statics end reactions); where a
// transfer beam sits on that floor line the beam takes it; a point load on a post top goes to the post.

export const LOAD_CASES = ['D', 'L', 'Lr'];
export const LOAD_SHAPES = [
  { id: 'point', label: 'Point (k)' },
  { id: 'full', label: 'Uniform — full line (plf)' },
  { id: 'partial', label: 'Uniform — partial (plf)' },
];
const TOL = 0.1;
const num = (v) => parseFloat(v) || 0;
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;

// One level's loads as uniform segments { x0, x1, D, L, Lr (plf) } and points { x, D, L, Lr (k) }.
// Accepts v8 { loads } and the older { uniform: [{ start, end, dlPlf }], point: [{ position, dlKips }] }.
export function gravityRows(gl, lineLength) {
  const out = { uniform: [], point: [] };
  if (!gl) return out;
  const len = num(lineLength);
  if (Array.isArray(gl.loads)) {
    gl.loads.forEach((ld, i) => {
      const mag = { D: num(ld.D), L: num(ld.L), Lr: num(ld.Lr) };
      const base = { id: ld.id || 'g' + i, index: i + 1, shape: ld.shape, assemblyId: ld.assemblyId || '', trib: num(ld.trib), ...mag };
      if (ld.shape === 'point') out.point.push({ ...base, x: num(ld.position) });
      else {
        const x0 = ld.shape === 'full' ? 0 : Math.min(num(ld.start), num(ld.end));
        const x1 = ld.shape === 'full' ? len : Math.max(num(ld.start), num(ld.end));
        if (x1 > x0) out.uniform.push({ ...base, x0, x1 });
      }
    });
    return out;
  }
  (gl.uniform || []).forEach((u, i) => {
    const x0 = Math.min(num(u.start), num(u.end)), x1 = Math.max(num(u.start), num(u.end));
    if (x1 > x0) out.uniform.push({ id: u.id || 'u' + i, index: i + 1, shape: 'partial', x0, x1, D: num(u.dlPlf), L: 0, Lr: 0 });
  });
  (gl.point || []).forEach((p, i) => out.point.push({ id: p.id || 'p' + i, index: i + 1, shape: 'point', x: num(p.position), D: num(p.dlKips), L: 0, Lr: 0 }));
  return out;
}

// [a, b] minus the excluded spans → list of pieces
function subtract(a, b, spans) {
  let pieces = [[a, b]];
  for (const [s, e] of spans || []) {
    const next = [];
    for (const [p, q] of pieces) {
      if (e <= p || s >= q) { next.push([p, q]); continue; }
      if (s > p) next.push([p, s]);
      if (e < q) next.push([e, q]);
    }
    pieces = next;
  }
  return pieces.filter(([p, q]) => q - p > 1e-9);
}
const inSpans = (x, spans) => (spans || []).some(([s, e]) => x >= s - 1e-9 && x <= e + 1e-9);

// Loads carried by one wall (position, length) with the end reactions of each case by statics.
// exclude: spans taken by a transfer beam on that floor line. Returns per case { total, rL, rR }
// and one documentation row per load piece.
export function wallGravity(pos, len, rows, exclude) {
  const out = { D: { total: 0, rL: 0, rR: 0 }, L: { total: 0, rL: 0, rR: 0 }, Lr: { total: 0, rL: 0, rR: 0 }, rows: [] };
  const end = pos + len;
  const add = (row, x, P) => {
    const toR = len > 0 ? (x - pos) / len : 0.5;
    const doc = { id: row.id, index: row.index, shape: row.shape, x: r4(x - pos), mag: {}, P: {}, rL: {}, rR: {} };
    for (const c of LOAD_CASES) {
      if (!P[c]) continue;
      out[c].total += P[c]; out[c].rR += P[c] * toR; out[c].rL += P[c] * (1 - toR);
      doc.P[c] = r4(P[c]); doc.rR[c] = r4(P[c] * toR); doc.rL[c] = r4(P[c] * (1 - toR));
    }
    return doc;
  };
  for (const u of rows.uniform) {
    for (const [a, b] of subtract(Math.max(pos, u.x0), Math.min(end, u.x1), exclude)) {
      const P = {}; for (const c of LOAD_CASES) P[c] = u[c] * (b - a) / 1000;
      if (!LOAD_CASES.some(c => P[c])) continue;
      const doc = add(u, (a + b) / 2, P);
      doc.a = r4(a - pos); doc.b = r4(b - pos); doc.w = { D: u.D, L: u.L, Lr: u.Lr };
      if (u.assemblyId) { doc.assemblyId = u.assemblyId; doc.trib = u.trib; }
      out.rows.push(doc);
    }
  }
  for (const p of rows.point) {
    if (p.x < pos - 1e-9 || p.x > end + 1e-9 || inSpans(p.x, exclude)) continue;
    if (!LOAD_CASES.some(c => p[c])) continue;
    const doc = add(p, p.x, { D: p.D, L: p.L, Lr: p.Lr });
    doc.mag = { D: p.D, L: p.L, Lr: p.Lr };
    out.rows.push(doc);
  }
  for (const c of LOAD_CASES) { out[c].total = r4(out[c].total); out[c].rL = r4(out[c].rL); out[c].rR = r4(out[c].rR); }
  return out;
}

// Where every load of the line goes that is not over a wall of its story:
// - a transfer beam on that floor line (beam of the story above) → beam loads (a uniform piece acts at
//   its centroid, exact for the two-support reactions)
// - a point load on a post top of that story → post
// - nothing → audit note (not carried)
// walls: design walls (piers included) with levelId / position / length; coverWalls: definition walls
// (full length incl. openings) used to decide what is "over a wall".
export function gravityToElements({ line, levels, coverWalls }) {
  const lineLength = num(line.totalLength);
  const beamGravity = {}, postGravity = {}, notes = [], excludeByLevel = {};
  levels.forEach((lvl, li) => {
    const rows = gravityRows((line.gravityLoads || {})[lvl.id], lineLength);
    const beams = li > 0 ? (line.beams || []).filter(b => b.levelId === levels[li - 1].id && num(b.length) > 0) : [];
    const spans = beams.map(b => [num(b.position), num(b.position) + num(b.length)]);
    excludeByLevel[lvl.id] = spans;
    const wallSpans = coverWalls.filter(w => w.levelId === lvl.id).map(w => [num(w.position), num(w.position) + num(w.length)]);
    const posts = (line.supportPosts || []).filter(p => p.levelId === lvl.id);
    const lbl = (row) => (row.shape === 'point' ? 'Point' : row.shape === 'full' ? 'Uniform (full)' : 'Uniform') + ' load ' + row.index + ' (' + (lvl.name || 'level') + ')';
    const mags = (g) => LOAD_CASES.filter(c => g[c]).map(c => c + ' ' + r2(g[c])).join(' / ');
    for (const u of rows.uniform) {
      for (const b of beams) {
        const bs = num(b.position), be = bs + num(b.length);
        const a = Math.max(bs, u.x0), c = Math.min(be, u.x1);
        if (c - a <= 1e-9) continue;
        const g = {}; for (const k of LOAD_CASES) g[k] = u[k] * (c - a) / 1000;
        if (!LOAD_CASES.some(k => g[k])) continue;
        (beamGravity[b.id] = beamGravity[b.id] || []).push({ x: (a + c) / 2, g, label: lbl(u) + ' ' + r2(a) + '–' + r2(c) + ' ft', uniform: { x0: a, x1: c, w: { D: u.D, L: u.L, Lr: u.Lr } } });
      }
      for (const [a, c] of subtract(u.x0, u.x1, [...spans, ...wallSpans])) {
        if (!LOAD_CASES.some(k => u[k])) continue;
        notes.push({ type: 'gravity_unsupported', elementId: u.id, elementMark: lbl(u), levelName: lvl.name || '',
          message: lbl(u) + ' ' + r2(a) + '–' + r2(c) + ' ft (' + mags(u) + ' plf) has no wall, beam or post below — not carried' });
      }
    }
    for (const p of rows.point) {
      if (!LOAD_CASES.some(k => p[k])) continue;
      const g = { D: p.D, L: p.L, Lr: p.Lr };
      const bm = beams.find(b => p.x >= num(b.position) - 1e-9 && p.x <= num(b.position) + num(b.length) + 1e-9);
      if (bm) { (beamGravity[bm.id] = beamGravity[bm.id] || []).push({ x: p.x, g, label: lbl(p) + ' at ' + r2(p.x) + ' ft' }); continue; }
      if (inSpans(p.x, wallSpans)) continue;
      const post = posts.find(q => Math.abs(num(q.position) - p.x) <= TOL);
      if (post) { (postGravity[post.id] = postGravity[post.id] || []).push({ g, label: lbl(p) + ' at ' + r2(p.x) + ' ft' }); continue; }
      notes.push({ type: 'gravity_unsupported', elementId: p.id, elementMark: lbl(p), levelName: lvl.name || '',
        message: lbl(p) + ' at ' + r2(p.x) + ' ft (' + mags(p) + ' k) has no wall, beam or post below — not carried' });
    }
  });
  return { beamGravity, postGravity, notes, excludeByLevel };
}

// Flat Load link: plf values of a uniform row from an assembly (perTab entry) and a trib width (ft)
export function assemblyLoads(asm, trib) {
  const t = num(trib);
  const roof = asm && (asm.type === 'roof' || asm.llSymbol === 'Lr');
  const dead = asm ? num(asm.dl) : 0, live = asm ? num(asm.llGravity) : 0;
  return { D: r2(dead * t), L: roof ? 0 : r2(live * t), Lr: roof ? r2(live * t) : 0 };
}
