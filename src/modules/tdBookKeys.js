// Diaphragm Analysis — the tool's value for a book key (tests/td-book/src/FORMAT.md), used by the Verification tab
// and the book tests. Returns a number, NaN (keys that should agree do not), or null (not reached by the tool yet).
//   R:<line>   force to a line (load-direction sign)        Rw:<wall> / vw:<wall>   wall share (lb) / unit shear (plf)
//   V:<station>[±][:<band>]   section shear                  vb:<station>[±]:<band>|*   basic unit shear
//   tdR:<TD>:<grid> |force TD ↔ support|   vtd:<TD>:<band> TD unit shear   aspect:<TD>   vnet:… as vb on the net field
//   N:<line>:<station> member force on the net field (tdNet)   Nmax:<line>:<from>-<to> max |N| along the run
//   Nb:<line>:<station>[±]    member force on the basic field (tdMembers.js); no side at a cut = the side where the
//                             line is a band edge / inside the opening stretch
// <station> is a grid across the span; ± the side; <band> 'A-B' = the band containing the middle of grids A and B.
import { sectionAt } from './tdBasicShear.js';
import { chordForce, crossForce } from './tdMembers.js';
import { vNetAt, memberN } from './tdNet.js';

const near = (a, b) => Math.abs(a - b) <= Math.max(1e-3 * Math.abs(b), 0.01);

export function toolValue(key, plan, analysis) {
  if (!analysis || !analysis.cases) return null;
  const [kind, ...rest] = key.split(':');
  const cases = analysis.cases;
  if (kind === 'R') {
    for (const c of cases) { const l = c.lines.find(x => x.name === rest[0]); if (l) return l.P; }
    return null;
  }
  if (kind === 'Rw' || kind === 'vw') {
    for (const c of cases) for (const l of c.lines) {
      const w = (l.walls || []).find(x => x.mark === rest[0]);
      if (w) return kind === 'Rw' ? w.share : w.v;
    }
    return null;
  }
  if (kind === 'Nb') return memberValue(rest, plan, cases);
  if (kind === 'tdR' || kind === 'vtd' || kind === 'aspect') return tdValue(kind, rest, plan, analysis);
  if (kind === 'N' || kind === 'Nmax') return netMember(kind, rest, plan, cases);
  if (kind === 'vnet') return netShear(rest, plan, cases);
  if (kind !== 'V' && kind !== 'vb') return null;
  const m = /^(.+?)([+-]?)$/.exec(rest[0] || '');
  if (!m) return null;
  const [, stName, side] = m;
  for (const c of cases) {
    const st = plan.grids.find(g => g.axis === c.axis && g.name === stName);
    if (!st) continue;
    const sec = sectionAt(c, st.at, side);
    if (!sec.parts.length) continue;
    const band = rest[1];
    if (kind === 'V' && !band) return sec.V;
    const all = sec.parts.flatMap(p => p.bands);
    let picked = all;
    if (band && band !== '*') {
      const names = band.split('-');
      const gs = names.map(n => plan.grids.find(g => g.axis !== c.axis && g.name === n));
      if (gs.some(g => !g)) return null;
      const mid = (gs[0].at + gs[1].at) / 2;
      picked = all.filter(b => mid > b.lo - 1e-6 && mid < b.hi + 1e-6);
      if (!picked.length) return null;
    }
    const vals = picked.map(b => (kind === 'V' ? b.V : b.v));
    return vals.every(v => near(v, vals[0])) ? vals[0] : NaN;
  }
  return null;
}

// TD ranges along a cross line g (TDs of the case direction that take g as a load line)
export function tdRangesOn(plan, dir, g) {
  return plan.tds.filter(t => t.dir === dir && t.loads.some(l => l.grid && l.grid.id === g.id))
    .map(t => (g.axis === 'x' ? [t.y1, t.y2] : [t.x1, t.x2]));
}

function memberValue([lineName, stTxt], plan, cases) {
  const m = /^(.+?)([+-]?)$/.exec(stTxt || '');
  if (!m) return null;
  const [, stName, side] = m;
  for (const c of cases) {
    const line = plan.grids.find(g => g.name === lineName && g.axis !== c.axis);
    const st = line && plan.grids.find(g => g.name === stName && g.axis === c.axis);
    if (line && st) {
      if (side) { const r = chordForce(c, line.at, st.at, side); return r ? r.N : null; }
      // no side: the side where the line is cut (inside an opening stretch, else a band edge)
      const pick = ['-', '+'].map(sd => {
        const r = chordForce(c, line.at, st.at, sd);
        const d = c.diaphragms.find(x => r && x.mark === r.diaphragm);
        const inStretch = d && (d.stretches || []).some(q => (sd === '-' ? st.at > q.a + 1e-6 && st.at <= q.b + 1e-6 : st.at >= q.a - 1e-6 && st.at < q.b - 1e-6));
        return { r, score: !r ? -1 : inStretch ? 2 : Math.abs(r.N) > 1e-9 ? 1 : 0 };
      }).sort((a, b) => b.score - a.score)[0];
      return pick.r ? pick.r.N : null;
    }
    const cross = plan.grids.find(g => g.name === lineName && g.axis === c.axis);
    const at = cross && plan.grids.find(g => g.name === stName && g.axis !== c.axis);
    if (cross && at) { const r = crossForce(c, cross, at.at, tdRangesOn(plan, c.dir, cross)); return r ? r.N : null; }
  }
  return null;
}

const tdRun = (analysis, mark) => (analysis.tdRuns || []).find(r => r.mark === mark && r.terminal === 'OUTPUT');
function tdValue(kind, [mark, arg], plan, analysis) {
  const r = tdRun(analysis, mark);
  if (!r) return null;
  if (kind === 'aspect') return r.outputs.td_aspect;
  const cs = analysis.cases.find(c => c.id === r.caseId);
  const f = cs && (cs.fields || []).find(x => x.mark === mark);
  if (!f) return null;
  if (kind === 'tdR') {
    if (arg !== f.top && arg !== f.bottom) return null;
    return Math.abs(arg === f.top ? r.outputs.td_F_sup_top : r.outputs.td_F_sup_bot);
  }
  const names = String(arg).split('-');
  const gs = names.map(n => plan.grids.find(g => g.name === n && g.axis === f.along));
  if (gs.some(g => !g)) return null;
  const mid = (gs[0].at + gs[1].at) / 2;
  const sg = f.segs.find(s => mid > s.lo && mid < s.hi);
  return sg ? sg.v : null;
}

const stationAt = (plan, txt, axis) => {
  const m = /^([xy])=(-?[\d.]+)$/.exec(txt);
  if (m) return m[1] === axis ? Number(m[2]) : null;
  const g = plan.grids.find(x => x.name === txt && x.axis === axis);
  return g ? g.at : null;
};

function netShear([stTxt, band], plan, cases) {
  const m = /^(.+?)([+-]?)$/.exec(stTxt || '');
  if (!m) return null;
  const [, stName, side] = m;
  const sd = side === '-' ? -1 : side === '+' ? 1 : 0;
  for (const c of cases) {
    const s = stationAt(plan, stName, c.axis);
    if (s === null || !c.fields) continue;
    const cross = c.axis === 'x' ? 'y' : 'x';
    let cs;
    if (band && band !== '*') {
      const gs = band.split('-').map(n => plan.grids.find(g => g.name === n && g.axis === cross));
      if (gs.some(g => !g)) return null;
      cs = [(gs[0].at + gs[1].at) / 2];
    } else {
      const C = [...new Set([...plan.grids.filter(g => g.axis === cross).map(g => g.at), ...c.diaphragms.flatMap(d => d.across),
        ...c.fields.flatMap(f => (f.along === cross ? f.segs.flatMap(x => [x.lo, x.hi]) : cross === 'x' ? [f.rect.x1, f.rect.x2] : [f.rect.y1, f.rect.y2]))])].sort((a, b) => a - b);
      cs = C.slice(0, -1).map((v, i) => (v + C[i + 1]) / 2);
    }
    const vals = cs.map(cc => vNetAt(c, c.fields, s, cc, sd, 0)).filter(v => v !== null);
    if (!vals.length) continue;
    return vals.every(v => near(v, vals[0])) ? vals[0] : NaN;
  }
  return null;
}

function netMember(kind, [lineName, stTxt], plan, cases) {
  for (const c of cases) {
    const m = (c.members || []).find(x => x.name === lineName);
    if (!m) continue;
    const axis = m.family === 'chord' ? c.axis : (c.axis === 'x' ? 'y' : 'x'); // stations run along the member
    if (kind === 'Nmax') {
      const [a, b] = (stTxt || '').split('-').map(t => stationAt(plan, t, axis));
      if (a === null || b === null) return null;
      const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
      let mx = 0; // signed value at the largest |N|
      const take = n => { if (n !== null && Math.abs(n) > Math.abs(mx)) mx = n; };
      for (const r of m.runs) for (const [p, n] of r.points) if (p >= lo - 1e-4 && p <= hi + 1e-4) take(n);
      for (const p of [lo, hi]) take(memberN(m, p));
      return mx;
    }
    const st = /^(.+?)([+-]?)$/.exec(stTxt || '');
    const p = st && stationAt(plan, st[1], axis);
    if (p === null || p === undefined) return null;
    return memberN(m, p);
  }
  return null;
}
