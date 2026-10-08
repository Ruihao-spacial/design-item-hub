// Diaphragm to LRS — calc engine (pure, no DOM).
//
// Flexible diaphragms, each a 2-support beam (overhangs allowed), carry the 1.0E story force F_x of a
// level to the lines of resistance (wall lines). Method:
//   q = F_x / ΣA (per level and direction), w = q·d on each uniform part.
//   Loads are reduced to two primitives (uniform part, point load). A uniform part is cut at the
//   supports into pieces (left overhang / back span / right overhang). Every piece and point load goes
//   through one lever rule (statics, ΣM = 0 about each support):
//     R1 = W·(x₂ − x̄)/l     R2 = W·(x̄ − x₁)/l     l = x₂ − x₁
//   R1 and R2 are computed independently, so ΣR = ΣW + ΣP (check D1) is a real check. A lever outside
//   0…l (load on an overhang) gives a negative value at the far support — the reaction reverses.
//   That rule is the only calculation path; the rows carry W (or P), x̄ (or x), both levers and R1 / R2.
// Units: lengths ft, areas sf, q k/sf, w k/ft (shown as plf), forces kip. Outputs rounded to 4 decimals.

export const CALC_VERSION = 'v2'; // v2 (2026-10-08): rows no longer carry an AISC case label

const EPS = 1e-9;
const TOL = 1e-6; // kip, equilibrium checks

export function num(v) {
  if (v === '' || v == null) return NaN;
  const n = typeof v === 'number' ? v : parseFloat(String(v).trim());
  return Number.isFinite(n) ? n : NaN;
}
export const r4 = v => {
  if (!Number.isFinite(v)) return v;
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? 0 : r;
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// ── Labels ─────────────────────────────────────────────────────────────

// Short level tag: leading digits ("2nd Floor" → "2"), else the first letter ("Roof" → "R").
export function autoTag(name) {
  const s = String(name || '').trim();
  const m = s.match(/^\d+/);
  if (m) return m[0];
  return s ? s[0].toUpperCase() : '';
}
export const levelTag = lv => (lv && String(lv.tag || '').trim()) || autoTag(lv && lv.name);
export const tagged = (tag, name) => (tag ? tag + '.' : '') + (name || '?');

// ── Beam solver ────────────────────────────────────────────────────────

// beam = { L, x1, x2, parts: [{ id, label, a, b, w }], points: [{ id, label, x, P, source, manual }] }
// Returns { rows, R1, R2, R1dist, R2dist, R1P, R2P, sumW, sumP }. Assumes valid geometry (see beamErrors).
export function solveBeam(beam) {
  const { L, x1, x2 } = beam;
  const l = x2 - x1;
  const rows = [];
  const push = (row) => {
    const lever1 = x2 - (row.kind === 'uniform' ? row.xbar : row.x);
    const lever2 = (row.kind === 'uniform' ? row.xbar : row.x) - x1;
    const F = row.kind === 'uniform' ? row.W : row.P;
    row.lever1 = lever1; row.lever2 = lever2;
    row.R1 = F * lever1 / l;
    row.R2 = F * lever2 / l;
    rows.push(row);
  };
  for (const p of beam.parts || []) {
    const s = p.a, e = p.a + p.b;
    const cuts = [[0, x1, 'left'], [x1, x2, 'span'], [x2, L, 'right']];
    for (const [lo, hi, region] of cuts) {
      const u = Math.max(s, lo), v = Math.min(e, hi);
      if (v - u <= EPS) continue;
      push({ kind: 'uniform', partId: p.id, label: p.label, region, u, v, w: p.w, W: p.w * (v - u), xbar: (u + v) / 2 });
    }
  }
  for (const pt of beam.points || []) {
    const region = pt.x < x1 - EPS ? 'left' : pt.x > x2 + EPS ? 'right' : 'span';
    push({ kind: 'point', pointId: pt.id, label: pt.label, source: pt.source, manual: !!pt.manual, region, x: pt.x, P: pt.P });
  }
  const sum = (f, pred) => rows.filter(pred).reduce((s, r) => s + r[f], 0);
  const isU = r => r.kind === 'uniform', isP = r => r.kind === 'point';
  return {
    rows,
    R1dist: sum('R1', isU), R2dist: sum('R2', isU),
    R1P: sum('R1', isP), R2P: sum('R2', isP),
    R1: sum('R1', () => true), R2: sum('R2', () => true),
    sumW: sum('W', isU), sumP: sum('P', isP),
  };
}

// The lever rule of one row with its numbers — the same text in the tool and the PDF.
// W (uniform piece) or P (point load) at x̄ / x; l = x₂ − x₁.
export function leverRuleText(row, x1, x2) {
  const f2 = v => (Number.isFinite(v) ? v.toFixed(2) : '—');
  const uni = row.kind === 'uniform';
  const F = uni ? 'W' : 'P', X = uni ? 'x̄' : 'x', val = uni ? row.W : row.P, x = uni ? row.xbar : row.x;
  return [
    'R1 = ' + F + '·(x₂ − ' + X + ')/l = ' + f2(val) + ' × (' + f2(x2) + ' − ' + f2(x) + ') / ' + f2(x2 - x1) + ' = ' + f2(row.R1),
    'R2 = ' + F + '·(' + X + ' − x₁)/l = ' + f2(val) + ' × (' + f2(x) + ' − ' + f2(x1) + ') / ' + f2(x2 - x1) + ' = ' + f2(row.R2),
  ];
}

// Geometry errors of one diaphragm (parsed numbers). Empty array = valid.
export function beamErrors(g) {
  const errs = [];
  if (!(g.L > 0)) errs.push('length L must be > 0');
  if (!Number.isFinite(g.x1) || !Number.isFinite(g.x2)) errs.push('support position missing');
  else {
    if (g.x1 < -EPS || g.x2 > g.L + EPS) errs.push('supports must lie within 0–L');
    if (!(g.x2 - g.x1 > 1e-6)) errs.push('R1 must be left of R2 (x₁ < x₂)');
  }
  (g.parts || []).forEach((p, i) => {
    const n = 'part ' + (i + 1);
    if (!Number.isFinite(p.a) || !Number.isFinite(p.b) || !Number.isFinite(p.d)) errs.push(n + ': a, b and d are required');
    else {
      if (p.a < -EPS) errs.push(n + ': a must be ≥ 0');
      if (!(p.b > 0)) errs.push(n + ': b must be > 0');
      if (!(p.d > 0)) errs.push(n + ': d must be > 0');
      if (p.a + p.b > g.L + 1e-6) errs.push(n + ': a + b exceeds L');
    }
  });
  (g.points || []).forEach(pt => {
    if (!Number.isFinite(pt.x) || pt.x < -EPS || pt.x > g.L + 1e-6) errs.push((pt.label || 'point load') + ': x must lie within 0–L');
    if (!Number.isFinite(pt.P)) errs.push((pt.label || 'point load') + ': P is required');
  });
  return errs;
}

// ── Inputs → parsed model ──────────────────────────────────────────────

// Parsed geometry of a diaphragm (no loads yet). Support x defaults: R1 at 0, R2 at L.
export function parseDiaphragm(dg) {
  const L = num(dg.length);
  const sup = dg.supports || [];
  const sx = (s, def) => { const v = num(s && s.x); return Number.isFinite(v) ? v : def; };
  return {
    L,
    x1: sx(sup[0], 0),
    x2: sx(sup[1], L),
    parts: (dg.parts || []).map((p, i) => ({ id: p.id, label: 'part ' + (i + 1), a: Number.isFinite(num(p.a)) ? num(p.a) : 0, b: num(p.b), d: num(p.d) })),
    points: (dg.pointLoads || []).map((p, i) => ({ id: p.id, label: 'P' + (i + 1), x: num(p.x), P: num(p.p), note: p.note || '', manual: true })),
  };
}

// A diaphragm is "simple" when it is one full-length part between end supports (quick row entry).
export function isSimple(dg) {
  const parts = dg.parts || [];
  const sup = dg.supports || [];
  const L = num(dg.length);
  const x = (s) => (s && s.x !== '' && s.x != null) ? num(s.x) : null;
  const x1 = x(sup[0]), x2 = x(sup[1]);
  return parts.length <= 1 && !(dg.pointLoads || []).length
    && (x1 == null || near(x1, 0)) && (x2 == null || near(x2, L))
    && (!parts.length || ((parts[0].a === '' || parts[0].a == null || near(num(parts[0].a), 0)) && (parts[0].b === '' || parts[0].b == null || near(num(parts[0].b), L))));
}

const groupActive = (g, levelId) => !g.levelIds || !g.levelIds.length || g.levelIds.includes(levelId);

// ── Main calc ──────────────────────────────────────────────────────────

export function calcAll(inputs) {
  const levels = (inputs.levels || []).map(lv => ({ id: lv.id, name: lv.name || '', tag: levelTag(lv), fx: num(lv.fx) }));
  const dirs = (inputs.directions || []).map(dir => calcDirection(dir, levels));
  const levelsOut = levels.map(lv => ({
    id: lv.id, name: lv.name, tag: lv.tag, fx: Number.isFinite(lv.fx) ? r4(lv.fx) : null,
    sumA: Object.fromEntries(dirs.map(d => [d.id, d.perLevel.find(p => p.levelId === lv.id).sumA])),
  }));
  const allChecks = dirs.flatMap(d => d.checks);
  return {
    calcVersion: CALC_VERSION,
    levels: levelsOut,
    perDirection: dirs,
    status: allChecks.some(c => c.status === 'fail') ? 'fail' : 'pass',
  };
}

function calcDirection(dir, levels) {
  const lines = dir.lines || [];
  const lineById = new Map(lines.map(l => [l.id, l]));
  const groups = dir.groups || [];
  const checks = {
    D1: [], D2: [], D3: [], D4: [], D5: [], D6: [], D7: [], D8: [], D9: [],
  };
  const perLevel = [];
  let carried = []; // [{ fromKey, fromLabel, toLineIds, pct, V, sourceUnitLines }] arriving at the next level

  levels.forEach((lv, li) => {
    const dias = (dir.diaphragms || []).filter(d => d.levelId === lv.id);
    const parsed = new Map(dias.map(d => [d.id, parseDiaphragm(d)]));
    // ΣA over valid parts
    let sumA = 0;
    for (const g of parsed.values()) for (const p of g.parts) if (p.b > 0 && p.d > 0) sumA += p.b * p.d;
    const fx = lv.fx;
    const q = sumA > 0 && Number.isFinite(fx) ? fx / sumA : 0;
    const lvLabel = lv.name || lv.tag || 'level';
    if (dias.length) {
      if (!Number.isFinite(fx) || fx <= 0) checks.D8.push(lvLabel + ': F_x missing or ≤ 0');
      else if (!(sumA > 0)) checks.D8.push(lvLabel + ': no diaphragm area (ΣA = 0)');
    }

    // Solve order: a diaphragm resting on another must be solved first (Kahn's algorithm).
    const byId = new Map(dias.map(d => [d.id, d]));
    const markOf = d => tagged(lv.tag, d.mark || '?');
    const deps = new Map(dias.map(d => [d.id, new Set()])); // target ← sources
    const errs = new Map(dias.map(d => [d.id, [...beamErrors(parsed.get(d.id))]]));
    for (const d of dias) {
      (d.supports || []).slice(0, 2).forEach((s, si) => {
        const rn = 'R' + (si + 1);
        if (!s || !s.kind || (s.kind === 'line' && !s.lineId) || (s.kind === 'diaphragm' && !s.diaphragmId)) {
          errs.get(d.id).push(rn + ' has no target (wall line or diaphragm)');
        } else if (s.kind === 'line' && !lineById.has(s.lineId)) {
          errs.get(d.id).push(rn + ' → a wall line that no longer exists');
        } else if (s.kind === 'diaphragm') {
          const t = byId.get(s.diaphragmId);
          if (!t) {
            const other = (dir.diaphragms || []).find(x => x.id === s.diaphragmId);
            checks.D4.push(markOf(d) + '.' + rn + ' → ' + (other ? 'a diaphragm at another level' : 'a diaphragm that no longer exists'));
            errs.get(d.id).push(rn + ' → diaphragm not at this level');
          } else if (t.id === d.id) {
            checks.D4.push(markOf(d) + '.' + rn + ' rests on itself');
            errs.get(d.id).push(rn + ' rests on itself');
          } else {
            deps.get(t.id).add(d.id);
            const tg = parsed.get(t.id);
            const ax = num(s.atX);
            if (!Number.isFinite(ax) || ax < -EPS || !(ax <= tg.L + 1e-6)) errs.get(d.id).push(rn + ' → ' + markOf(t) + ': x on ' + markOf(t) + ' must lie within 0–' + (Number.isFinite(tg.L) ? tg.L : 'L'));
          }
        }
      });
      if ((d.supports || []).length < 2) errs.get(d.id).push('two supports are required');
    }
    const order = [];
    const remaining = new Map([...deps].map(([k, v]) => [k, new Set(v)]));
    let progress = true;
    while (progress) {
      progress = false;
      for (const [id, srcs] of remaining) {
        if (srcs.size === 0) {
          order.push(id); remaining.delete(id); progress = true;
          for (const s of remaining.values()) s.delete(id);
        }
      }
    }
    if (remaining.size) checks.D4.push(lvLabel + ': diaphragms rest on each other in a loop (' + [...remaining.keys()].map(id => markOf(byId.get(id))).join(', ') + ')');

    // Solve
    const incoming = new Map(dias.map(d => [d.id, []]));
    const lineR = new Map(); // lineId → [{ from, R }]
    let sumToLines = 0, sumManual = 0;
    const results = new Map();
    for (const id of order) {
      const d = byId.get(id);
      const g = parsed.get(id);
      const e = errs.get(id);
      const inc = incoming.get(id);
      if (inc.some(p => !Number.isFinite(p.P))) e.push('an incoming load could not be calculated');
      const res = {
        id, mark: d.mark || '', label: markOf(d), L: g.L, x1: g.x1, x2: g.x2, l: g.x2 - g.x1,
        parts: g.parts.map(p => ({ ...p, c: g.L - p.a - p.b, A: p.b * p.d, w: q * p.d })),
        points: [...inc, ...g.points], errors: e, supports: [], rows: [],
      };
      if (!e.length) {
        const sol = solveBeam({ L: g.L, x1: g.x1, x2: g.x2, parts: res.parts.map(p => ({ id: p.id, label: p.label, a: p.a, b: p.b, w: p.w })), points: res.points });
        res.rows = sol.rows; res.sumW = sol.sumW; res.sumP = sol.sumP;
        const Rs = [[sol.R1, sol.R1dist, sol.R1P], [sol.R2, sol.R2dist, sol.R2P]];
        if (Math.abs(sol.R1 + sol.R2 - sol.sumW - sol.sumP) > TOL) checks.D1.push(res.label + ': ΣR = ' + r4(sol.R1 + sol.R2) + ' ≠ ΣW + ΣP = ' + r4(sol.sumW + sol.sumP));
        sumManual += g.points.reduce((s, p) => s + p.P, 0);
        (d.supports || []).slice(0, 2).forEach((s, si) => {
          const [R, Rd, Rp] = Rs[si];
          const rn = res.label + '.R' + (si + 1);
          const sup = { name: 'R' + (si + 1), x: si ? g.x2 : g.x1, kind: s.kind, R, Rdist: Rd, RP: Rp };
          if (s.kind === 'line') {
            const ln = lineById.get(s.lineId);
            sup.lineId = s.lineId; sup.to = tagged(lv.tag, ln.name);
            if (!lineR.has(s.lineId)) lineR.set(s.lineId, []);
            lineR.get(s.lineId).push({ from: rn, R });
            sumToLines += R;
          } else {
            const t = byId.get(s.diaphragmId);
            sup.diaphragmId = t.id; sup.to = markOf(t); sup.atX = num(s.atX);
            incoming.get(t.id).push({ id: 'in-' + id + '-' + si, label: 'P', x: num(s.atX), P: R, source: rn, manual: false });
          }
          res.supports.push(sup);
        });
      }
      results.set(id, res);
    }
    // diaphragms caught in a loop
    for (const id of remaining.keys()) {
      const d = byId.get(id);
      results.set(id, { id, mark: d.mark || '', label: markOf(d), errors: [...errs.get(id), 'in a support loop — not solved'], supports: [], rows: [], parts: [], points: [] });
    }
    for (const d of dias) {
      const r = results.get(d.id);
      if (r.errors.length) checks.D3.push(r.label + ': ' + r.errors.join('; '));
      // number the incoming / manual point loads P1, P2 … in display order
      r.points.forEach((p, i) => { p.label = 'P' + (i + 1); });
    }
    if (dias.length && Number.isFinite(fx)) {
      const expect = fx + sumManual;
      if (Math.abs(sumToLines - expect) > Math.max(TOL, 1e-6 * Math.abs(expect))) {
        checks.D2.push(lvLabel + ': Σ reactions to wall lines = ' + r4(sumToLines) + ' k ≠ F_x + Σ manual P = ' + r4(expect) + ' k');
      }
    }

    // Units of resistance at this level: merged lines (a group of 2 or more existing lines) and single lines.
    // A line in two merges at the same level stays in the first one (D9 flags it).
    const activeGroups = groups.filter(g => groupActive(g, lv.id) && (g.lineIds || []).filter(id => lineById.has(id)).length >= 2);
    const groupOfLine = new Map();
    for (const g of activeGroups) for (const id of g.lineIds) {
      if (!lineById.has(id)) continue;
      if (groupOfLine.has(id)) checks.D9.push(lvLabel + ': line ' + tagged(lv.tag, lineById.get(id).name) + ' is in two merges (' + [groupOfLine.get(id), g].map(x => x.lineIds.filter(i => lineById.has(i)).map(i => lineById.get(i).name).join('+')).join(' and ') + ') — it counts in the first only');
      else groupOfLine.set(id, g);
    }
    const unitKeyOfLine = id => groupOfLine.has(id) ? 'g:' + groupOfLine.get(id).id : id;
    const unitLines = key => key.startsWith('g:') ? activeGroups.find(g => 'g:' + g.id === key).lineIds.filter(id => lineById.has(id)) : [key];
    const unitName = key => unitLines(key).map(id => tagged(lv.tag, lineById.get(id).name)).join('+');
    const units = new Map(); // key → row
    const unit = key => {
      if (!units.has(key)) units.set(key, { key, lineIds: unitLines(key), name: unitLines(key).map(id => lineById.get(id).name).join('+'), label: unitName(key), F: 0, sources: [], fromAbove: [], V: 0, goesTo: [] });
      return units.get(key);
    };
    for (const [lineId, list] of lineR) {
      const u = unit(unitKeyOfLine(lineId));
      for (const it of list) { u.F += it.R; u.sources.push(it); }
    }
    // Force arriving from the level above
    let lostAbove = 0;
    const presentKeys = new Set(units.keys()); // units that receive diaphragm load at this level
    for (const c of carried) {
      const keys = [...new Set(c.toLineIds.map(unitKeyOfLine))];
      let key = null;
      if (c.mode === 'split') {
        // an explicit target: one line, or one group that is also combined at this level
        if (keys.length === 1) key = keys[0];
        else {
          checks.D6.push(c.fromLabel + ' → ' + lvLabel + ': split target lines are not combined at this level — split to each line instead');
          lostAbove += c.V;
          continue;
        }
      } else {
        // 'same': the unit at this level holding the same line(s); must be one unit that receives load here
        const present = keys.filter(k => presentKeys.has(k));
        if (present.length === 1) key = present[0];
        else {
          checks.D6.push(c.fromLabel + ' → ' + lvLabel + ': ' + (present.length ? 'its lines are in different lines / groups here' : 'no same wall line receives load at this level') + ' — choose Split or Ends at ' + c.fromLevel);
          lostAbove += c.V;
          continue;
        }
      }
      const u = unit(key);
      u.fromAbove.push({ from: c.fromLabel, pct: c.pct, V: c.V });
    }
    for (const u of units.values()) u.V = u.F + u.fromAbove.reduce((s, f) => s + f.V, 0);

    // Where each unit's story shear goes next
    const lower = levels[li + 1];
    const downMap = ((dir.down || {})[lv.id]) || {};
    const next = [];
    let ended = 0;
    for (const u of units.values()) {
      const ch = downMap[u.key] || { mode: 'same' };
      if (!lower) { u.goesTo = [{ text: 'foundation' }]; u.ends = true; ended += u.V; continue; }
      if (ch.mode === 'ends') { u.goesTo = [{ text: 'resisted at ' + lvLabel }]; u.ends = true; ended += u.V; continue; }
      if (ch.mode === 'split') {
        const validTo = to => !!to && (to.startsWith('g:') ? groups.some(g => 'g:' + g.id === to) : lineById.has(to));
        const sp = (ch.split || []).filter(s => s && validTo(s.to));
        const tot = sp.reduce((s, x) => s + (num(x.pct) || 0), 0);
        if (!sp.length) checks.D5.push(u.label + ' → split has no target lines');
        else if (Math.abs(tot - 100) > 1e-6) checks.D5.push(u.label + ' → split adds to ' + r4(tot) + ' % (must be 100 %)');
        for (const s of sp) {
          const pct = num(s.pct) || 0;
          const toLineIds = s.to.startsWith('g:') ? (groups.find(g => 'g:' + g.id === s.to).lineIds || []).filter(id => lineById.has(id)) : [s.to];
          next.push({ mode: 'split', fromLabel: u.label, fromLevel: lvLabel, toLineIds, pct, V: u.V * pct / 100 });
          u.goesTo.push({ text: toLineIds.map(id => tagged(lower.tag, lineById.get(id).name)).join('+') + ' ' + r4(pct) + ' %' });
        }
        continue;
      }
      next.push({ mode: 'same', fromLabel: u.label, fromLevel: lvLabel, toLineIds: u.lineIds, pct: 100, V: u.V });
      u.goesTo = [{ text: u.lineIds.map(id => tagged(lower.tag, lineById.get(id).name)).join('+'), pending: true }];
    }

    const lineIdx = id => lines.findIndex(l => l.id === id);
    const rows = [...units.values()].sort((a, b) => Math.min(...a.lineIds.map(lineIdx)) - Math.min(...b.lineIds.map(lineIdx)));
    const sumF = rows.reduce((s, u) => s + u.F, 0);
    const sumV = rows.reduce((s, u) => s + u.V, 0);
    const prev = perLevel[perLevel.length - 1];
    const expectV = (prev ? prev.cumF - prev.cumEnded : 0) + sumF;
    if (Math.abs(sumV - expectV) > Math.max(TOL, 1e-6 * Math.abs(expectV))) {
      checks.D7.push(lvLabel + ': ΣV = ' + r4(sumV) + ' k ≠ ΣF at and above − ended above = ' + r4(expectV) + ' k');
    }
    perLevel.push({
      levelId: lv.id, name: lv.name, tag: lv.tag, fx: Number.isFinite(fx) ? r4(fx) : null,
      sumA: r4(sumA), q: r4Small(q), qPsf: r4(q * 1000), sumManual: r4(sumManual), sumToLines: r4(sumToLines),
      diaphragms: dias.map(d => roundDiaphragm(results.get(d.id))),
      lines: rows.map(u => ({
        key: u.key, name: u.name, label: u.label, lineIds: u.lineIds,
        F: r4(u.F), sources: u.sources.map(s => ({ from: s.from, R: r4(s.R) })),
        fromAbove: u.fromAbove.map(f => ({ from: f.from, pct: r4(f.pct), V: r4(f.V) })),
        V: r4(u.V), goesTo: u.goesTo, ends: !!u.ends, merged: u.key.startsWith('g:'),
      })),
      sumF: r4(sumF), sumV: r4(sumV), ended: r4(ended), lost: r4(lostAbove),
      cumF: (prev ? prev.cumF : 0) + sumF, cumEnded: (prev ? prev.cumEnded : 0) + ended + lostAbove,
    });
    carried = next;
  });

  // cumulative helpers are internal; round them for the output
  perLevel.forEach(p => { p.cumF = r4(p.cumF); p.cumEnded = r4(p.cumEnded); });
  const CHECK_LABELS = {
    D1: 'Each diaphragm: ΣR = ΣW + ΣP',
    D2: 'Each level: Σ reactions to wall lines = F_x + Σ manual P',
    D3: 'Geometry valid and every support assigned',
    D4: 'No support loops; links stay within the level',
    D5: 'Split percentages add to 100 %',
    D6: 'Every wall line has a place to go at the level below',
    D7: 'Each level: ΣV = ΣF at and above − force resisted above',
    D8: 'F_x and diaphragm area present (q > 0)',
    D9: 'Merged lines: each line is in at most one merge per level',
  };
  return {
    id: dir.id, name: dir.name || '',
    perLevel,
    checks: Object.entries(checks).map(([id, items]) => ({ id, label: CHECK_LABELS[id], status: items.length ? 'fail' : 'pass', items })),
  };
}

// q in k/sf is small — keep 8 significant decimals so q·d reproduces w
const r4Small = v => Number.isFinite(v) ? Math.round(v * 1e8) / 1e8 : v;

function roundDiaphragm(r) {
  const rr = v => (typeof v === 'number' ? r4(v) : v);
  return {
    id: r.id, mark: r.mark, label: r.label, errors: r.errors,
    L: rr(r.L), x1: rr(r.x1), x2: rr(r.x2), l: rr(r.l),
    parts: (r.parts || []).map(p => ({ id: p.id, label: p.label, a: rr(p.a), b: rr(p.b), c: rr(p.c), d: rr(p.d), A: rr(p.A), w: r4(p.w), wPlf: r4(p.w * 1000) })),
    points: (r.points || []).map(p => ({ id: p.id, label: p.label, x: rr(p.x), P: rr(p.P), source: p.source || '', manual: !!p.manual, note: p.note || '' })),
    rows: (r.rows || []).map(row => ({
      kind: row.kind, partId: row.partId, pointId: row.pointId, label: row.label, source: row.source, manual: row.manual,
      region: row.region, u: rr(row.u), v: rr(row.v), x: rr(row.x), w: rr(row.w), W: rr(row.W), P: rr(row.P), xbar: rr(row.xbar),
      lever1: rr(row.lever1), lever2: rr(row.lever2), R1: r4(row.R1), R2: r4(row.R2),
    })),
    sumW: rr(r.sumW), sumP: rr(r.sumP),
    supports: (r.supports || []).map(s => ({ ...s, R: r4(s.R), Rdist: r4(s.Rdist), RP: r4(s.RP), reverses: s.R < -1e-9 })),
  };
}
