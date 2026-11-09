// Diaphragm Analysis ↔ Shear Wall Design link (pure, no DOM).
// Shear Wall Design (SWD) owns the walls (all wall types, all levels); the Diaphragm Analysis (DA) plan owns the
// grids. DA reads the SWD definition (ref from: 'inputs') and places the walls of its level on the plan:
//   - each SWD direction is mapped to a DA load direction (wallLink.dirMap: 'x' | 'y'); its lines run along the load,
//     so a line of a load along y sits on the ↕ grid (constant x) with the same name, and the reverse;
//   - an SWD wall position is measured along its line from the line origin; wallLink.origins[lineId] is the plan
//     coordinate of that origin ('' = where the line enters the sheathed plan, or the start of its span).
//   - several SWD lines may sit on one grid (user 2026-11-03, book Ch 8.4: "E 4-7" for SW6, "E 8-9" for SW7): a line
//     named "<grid> <from>-<to>" sits on grid <grid> between the cross grids <from> and <to>; or set by hand
//     (wallLink.lineGrid[lineId] = { gridId, fromId, toId }, '' = from the name). Its length is checked against that
//     span and its origin is the span start; each SWD line gets the force of its own walls (linkLineForces).
// DA's results label each line force with the SWD direction / line ids, so SWD needs no geometry or mapping.
// SWD helpers and its engine are imported read-only. B4 (Phase 4): swdWallShares runs SWD's own calcAll on a copy of
// the definition with DA's line forces at DA's level, so the walls share a line force exactly as in SWD.
import { isWswh, wswhWidthFt } from './shearWallWswh.js';
import { calcAll as swdCalcAll, accumulateStoryShear, lineDistribution, equalDeflectionSplit } from './shearWallCalc.js';
import { sectionBands } from './tdGeometry.js';

const LENGTH_TOL = 0.01; // ft — SWD line length vs the plan length of its grid
const r2 = v => Math.round(v * 100) / 100;
const num = v => (v === '' || v === null || v === undefined ? NaN : Number(v));
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// What DA needs from an SWD definition (the ref's extract)
export function swdExtract(def) {
  return {
    definition: JSON.parse(JSON.stringify(def)), // full definition for B4 (SWD calcAll)
    levels: (def.levels || []).map(l => ({ id: l.id, name: l.name || '' })),
    // grid link (user 2026-11-05): set only when SWD adopted the plan grids of a linked DA item
    planGrids: def.planLink && Array.isArray(def.planLink.grids) ? def.planLink.grids : null,
    // SWD hands a wall's force to the diaphragm below only when it has this DA item ticked (step 4, transferOn)
    daLinked: (((def.refs || {}).diaphragmSources) || []).length > 0,
    directions: (def.directions || []).map(d => ({
      id: d.id, name: d.name || '',
      lines: (d.lines || []).map(ln => ({
        id: ln.id, name: ln.name || '', totalLength: num(ln.totalLength),
        planOrigin: def.planLink ? num(ln.planOrigin) : NaN, // SWD fixes the line start on the plan (grid link)
        walls: (ln.walls || []).map(w => ({
          id: w.id, mark: w.mark || '', levelId: w.levelId, position: num(w.position),
          length: isWswh(w) ? wswhWidthFt(w) : num(w.length), type: w.systemType || 'segmented',
          endsAtFloor: w.endsAtFloor === true, // ticked on a mixed line (SWD step 4)
        })),
      })),
    })),
  };
}

// Guess of the DA load direction from an SWD direction name: E-W / x → 'x', N-S / y → 'y', else ''
export function guessDir(name) {
  const n = String(name || '').toUpperCase().replace(/\s/g, '');
  if (/^(E-?W|W-?E|X|EW)$/.test(n) || /E-?W/.test(n)) return 'x';
  if (/^(N-?S|S-?N|Y|NS)$/.test(n) || /N-?S/.test(n)) return 'y';
  return '';
}

// The walls of DA's level, in plan coordinates, plus everything that does not match. plan = parsePlan(inputs).
// Returns { walls: [{ id, line, mark, gridId, from, to, linked, swdLineId, swdDirId, type }],
//           lines: [{ dirId, dirName, dir, lineId, name, grid, origin, originAuto }], issues: [{ code, msg, warn? }],
//           levelId }
export function linkedWalls(inputs, plan, swd) {
  const out = { walls: [], lines: [], issues: [], levelId: null };
  if (!swd) return out;
  const link = inputs.wallLink || {};
  const lvl = swd.levels.find(l => same(l.name, inputs.level && inputs.level.name));
  if (!lvl) {
    out.issues.push({ code: 'link-level', msg: `Level "${(inputs.level && inputs.level.name) || '?'}" is not a level of the linked Shear Wall Design item (${swd.levels.map(l => l.name).join(', ') || 'none'}).` });
    return out;
  }
  out.levelId = lvl.id;
  // offset lines of resistance (user 2026-11-03): [{ id, name, lineIds: [swd line id], exclude: [swd wall id] }]
  const groups = (link.groups || []).filter(g => g && String(g.name || '').trim() && (g.lineIds || []).length);
  for (const g of link.groups || []) {
    const lines = (g.lineIds || []).map(id => swd.directions.flatMap(d => d.lines.map(l => ({ d, l }))).find(x => x.l.id === id)).filter(Boolean);
    if (!String(g.name || '').trim()) out.issues.push({ code: 'link-group-name', warn: true, msg: 'Offset line of resistance: give it a name (Setup → Shear wall link) — not used until then.' });
    else if (lines.length < 2) out.issues.push({ code: 'link-group-lines', warn: true, msg: `Offset line ${g.name}: pick two or more Shear Wall Design lines (Setup → Shear wall link).` });
    else if (new Set(lines.map(x => x.d.id)).size > 1) out.issues.push({ code: 'link-group-dir', msg: `Offset line ${g.name}: its lines must belong to one Shear Wall Design direction.` });
  }
  for (const d of swd.directions) {
    const dir = (link.dirMap || {})[d.id] || guessDir(d.name);
    if (dir !== 'x' && dir !== 'y') {
      out.issues.push({ code: 'link-dir', msg: `Map Shear Wall Design direction "${d.name || '?'}" to a load direction (Setup).` });
      continue;
    }
    const axis = dir === 'y' ? 'x' : 'y'; // grid the line sits on
    for (const ln of d.lines) {
      const { grid, span, how } = lineGridOf(plan, axis, ln, ((link.lineGrid || {})[ln.id]) || {});
      const typed = num((link.origins || {})[ln.id]);
      // sheathed stretches of the grid, cut to the grid's own extent (bounded grids, user 2026-11-05)
      const bands = grid ? sectionBands(plan, axis, grid.at).map(([a, b]) => [Math.max(a, grid.lo ?? -Infinity), Math.min(b, grid.hi ?? Infinity)]).filter(([a, b]) => b - a > 1e-6) : [];
      // length in the plan: the span between its two cross grids, else the whole grid line from where it enters the
      // sheathed plan to where it leaves it
      const planLength = span ? span[1] - span[0] : bands.length ? bands[bands.length - 1][1] - bands[0][0] : 0;
      // origin: the line start SWD fixed on the plan (grid link) > typed here > auto
      const fromSwd = Number.isFinite(ln.planOrigin);
      let origin = fromSwd ? ln.planOrigin : typed, originAuto = false;
      if (grid && !fromSwd && !Number.isFinite(typed)) { origin = span ? span[0] : bands.length ? bands[0][0] : 0; originAuto = true; }
      const walls = ln.walls.filter(w => w.levelId === lvl.id);
      out.lines.push({ dirId: d.id, dirName: d.name, dir, lineId: ln.id, name: ln.name, grid, span, gridHow: how, origin, originAuto, originFromSwd: fromSwd, planLength, swdLength: ln.totalLength, bands });
      // No line-length check (user 2026-11-05): the SWD line length is how far SWD draws the line; each level has its own
      // sheathed stretch. What matters is that every wall of this level lies on the sheathing of its grid (below).
      if (!grid) {
        if (walls.length) out.issues.push({ code: 'link-grid', msg: `Shear Wall Design line "${ln.name}" (${d.name}): no ${axis === 'x' ? '↕' : '↔'} grid named "${ln.name}" in the plan (or "<grid> <from>-<to>", or pick the grid on Setup → Shear wall link).` });
        continue;
      }
      for (const w of walls) {
        if (!Number.isFinite(w.position) || !(w.length > 0)) { out.issues.push({ code: 'link-wall', msg: `Wall ${w.mark} (line ${ln.name}): position / length missing in Shear Wall Design.` }); continue; }
        // an offset line of resistance chosen on Setup (wallLink.groups): its walls take the group's name, so DA treats
        // them as one line across their grids (tdBasicShear.lineGroups); a wall left out keeps its own line
        const grp = groups.find(gr => (gr.lineIds || []).includes(ln.id) && !(gr.exclude || []).includes(w.id));
        out.walls.push({ id: 'swd:' + w.id, line: grp ? grp.name : ln.name, mark: w.mark, gridId: grid.id, from: String(origin + w.position), to: String(origin + w.position + w.length),
          linked: true, swdLineId: ln.id, swdDirId: d.id, type: w.type, swdGroup: grp ? grp.id : null });
        const a = origin + w.position, b = a + w.length;
        if (!bands.some(([lo, hi]) => a >= lo - LENGTH_TOL && b <= hi + LENGTH_TOL))
          out.issues.push({ code: 'link-wall-sheathing', warn: true, msg: `Wall ${w.mark} (line ${ln.name}) at ${grid.axis === 'x' ? 'y' : 'x'} ${r2(a)}–${r2(b)} is not on the sheathing of grid ${grid.name} at this level (${bands.length ? bands.map(([lo, hi]) => r2(lo) + '–' + r2(hi)).join(', ') : 'grid off the plan'}). Check the line start${fromSwd ? ' (Shear Wall Design line header)' : ' / origin'} and the wall position.` });
        if (span && (a < span[0] - LENGTH_TOL || b > span[1] + LENGTH_TOL))
          out.issues.push({ code: 'link-wall-span', warn: true, msg: `Wall ${w.mark} (line ${ln.name}) runs outside the line's span ${r2(span[0])}–${r2(span[1])} on grid ${grid.name}.` });
      }
    }
  }
  // grid link (user 2026-11-05): SWD keeps a copy of the plan grids; a grid of the same name elsewhere here is a mismatch
  if (swd.planGrids) {
    const ext = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? [Math.min(a, b), Math.max(a, b)] : [Number.isFinite(a) ? a : -Infinity, Number.isFinite(b) ? b : Infinity]);
    const near = (a, b) => (a === b) || Math.abs(a - b) <= LENGTH_TOL; // ±Infinity equal to itself
    const bad = [];
    for (const g of plan.grids) {
      const c = swd.planGrids.find(x => x.axis === g.axis && same(x.name, g.name));
      if (!c) continue;
      const [lo, hi] = ext(num(c.from), num(c.to));
      if (!near(num(c.at), g.at) || !near(lo, g.lo ?? -Infinity) || !near(hi, g.hi ?? Infinity)) bad.push(g.name);
    }
    if (bad.length) out.issues.push({ code: 'grid-mismatch', warn: true, msg: `Grid${bad.length > 1 ? 's' : ''} ${bad.join(', ')} ${bad.length > 1 ? 'are' : 'is'} not where the linked Shear Wall Design item has ${bad.length > 1 ? 'them' : 'it'} (its copy of the plan grids). Update the grids in Shear Wall Design (Loading → Plan grids), or make the grids of the Diaphragm Analysis items of all levels the same.` });
  }
  // two SWD lines on one grid must not overlap (each takes the force of its own stretch)
  const placed = out.lines.filter(l => l.grid);
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i], b = placed[j];
    if (a.grid.id !== b.grid.id || a.dirId !== b.dirId) continue;
    const ra = a.span || [-Infinity, Infinity], rb = b.span || [-Infinity, Infinity];
    if (Math.min(ra[1], rb[1]) - Math.max(ra[0], rb[0]) > LENGTH_TOL)
      out.issues.push({ code: 'link-overlap', msg: `Shear Wall Design lines "${a.name}" and "${b.name}" both sit on grid ${a.grid.name} over the same stretch — give each its span ("${a.grid.name} 4-7", "${a.grid.name} 8-9") or pick their spans on Setup → Shear wall link.` });
  }
  return out;
}

// Walls of the story above (user 2026-11-05, build step 5): the SWD walls of the level directly above this DA level
// (SWD levels are stored top first), placed on this plan from the same line start as the walls of this level
// (link.lines). Each is
//   'transfer' — its force ends at this floor and goes into this diaphragm: its SWD line has no wall at this level, or
//                the engineer ticked "ends at this floor" on a mixed line (SWD wall.endsAtFloor);
//   'through'  — it continues down its own line (SWD carries its force to the walls below; here only a drag along the
//                line where the walls above and below do not line up).
// Returns { walls: [{ id, swdWallId, mark, line, swdLineId, swdDirId, dir, gridId, axis, at, from, to, kind,
//           onSheathing, upperLevel }], issues, upperLevelId, upperLevel }. No force yet (step 6).
// collectors (option 2, user 2026-11-05): inputs.aboveCollectors[swdLineId] = { fromId, toId } — the collector on that
// line runs only between these two cross grids; its force goes only into the diaphragms lying between them (each wall's
// collector: { lo, hi, from, to } in plan coordinates along the grid; null = full depth).
export function wallsAbove(plan, swd, link, inputs = {}) {
  const out = { walls: [], issues: [], upperLevelId: null, upperLevel: null };
  if (!swd || !link || !link.levelId) return out;
  const i = swd.levels.findIndex(l => l.id === link.levelId);
  const upper = i > 0 ? swd.levels[i - 1] : null;
  if (!upper) return out; // top level: nothing above
  out.upperLevelId = upper.id; out.upperLevel = upper.name;
  for (const d of swd.directions) for (const ln of d.lines) {
    const up = ln.walls.filter(w => w.levelId === upper.id);
    if (!up.length) continue;
    const L = link.lines.find(l => l.lineId === ln.id);
    if (!L || !L.grid) {
      out.issues.push({ code: 'above-grid', warn: true, msg: `Walls of the ${upper.name} story on line ${ln.name} (${up.map(w => w.mark).join(', ')}): no grid "${ln.name}" in this plan, so they are not placed here.` });
      continue;
    }
    const continues = ln.walls.some(w => w.levelId === link.levelId);
    const cset = ((inputs.aboveCollectors || {})[ln.id]) || null;
    // own (open item 6-A, user 2026-11-09): no collector along the grid — each wall that ends here goes only into the
    // diaphragm(s) under it (a wall over two diaphragms split by length); from – to does not apply
    const own = !!(cset && cset.own);
    // an end is a grid (fromId / toId) or a diaphragm edge picked on the Shear walls page (fromAt / toAt, plan coordinate
    // along the grid; user 2026-11-05)
    const crossAx = L.grid.axis === 'x' ? 'y' : 'x';
    const endOf = (id, at) => { const g = id ? plan.gridById.get(id) : null; if (g && Number.isFinite(g.at)) return { at: g.at, name: g.name };
      const v = num(at); return Number.isFinite(v) ? { at: v, name: crossAx + ' ' + r2(v) } : null; };
    const ea = cset ? endOf(cset.fromId, cset.fromAt) : null, eb = cset ? endOf(cset.toId, cset.toAt) : null;
    const collector = !own && ea && eb && Math.abs(ea.at - eb.at) > LENGTH_TOL
      ? { lo: Math.min(ea.at, eb.at), hi: Math.max(ea.at, eb.at), from: ea.at <= eb.at ? ea.name : eb.name, to: ea.at <= eb.at ? eb.name : ea.name } : null;
    if (!own && cset && (cset.fromId || cset.toId || cset.fromAt || cset.toAt) && !collector) out.issues.push({ code: 'above-collector', warn: true, msg: `Collector of line ${ln.name}: pick two different ends (grids or diaphragm edges), or leave both blank for the full depth.` });
    for (const w of up) {
      if (!Number.isFinite(w.position) || !(w.length > 0)) continue;
      const a = L.origin + w.position, b = a + w.length;
      const kind = !continues || w.endsAtFloor ? 'transfer' : 'through';
      const onSheathing = (L.bands || []).some(([lo, hi]) => a >= lo - LENGTH_TOL && b <= hi + LENGTH_TOL);
      out.walls.push({ id: 'above:' + w.id, swdWallId: w.id, mark: w.mark, line: ln.name, swdLineId: ln.id, swdDirId: d.id, dir: L.dir,
        gridId: L.grid.id, axis: L.grid.axis, at: L.grid.at, from: a, to: b, kind, onSheathing, upperLevel: upper.name, collector: kind === 'transfer' ? collector : null, own: kind === 'transfer' && own });
      if (kind === 'transfer' && collector && (a < collector.lo - LENGTH_TOL || b > collector.hi + LENGTH_TOL)) out.issues.push({ code: 'above-collector-short',
        msg: `Wall ${w.mark} (line ${ln.name}, ${r2(a)}–${r2(b)}) is not on its collector ${collector.from}–${collector.to} (${r2(collector.lo)}–${r2(collector.hi)}): its force cannot get onto the collector. Extend the collector over the wall, or leave it blank for the full depth.` });
      if (kind === 'transfer' && !onSheathing) out.issues.push({ code: 'above-off-plan', warn: true,
        msg: `Wall ${w.mark} (${upper.name} story, line ${ln.name}) ends at this floor but ${L.grid.axis === 'x' ? 'y' : 'x'} ${r2(a)}–${r2(b)} is not on this level's sheathing of grid ${L.grid.name} (${(L.bands || []).map(([lo, hi]) => r2(lo) + '–' + r2(hi)).join(', ') || 'none'}) — its force has no diaphragm to go into. Check the line start and the outline.` });
    }
  }
  const tr = out.walls.filter(w => w.kind === 'transfer');
  if (tr.length) {
    out.issues.push({ code: 'above-type4', warn: true, info: true,
      msg: `Out-of-plane offset (ASCE 7-22 Table 12.3-1, horizontal irregularity Type 4): ${tr.map(w => w.mark).join(', ')} of the ${upper.name} story end at this floor; this diaphragm carries their force to the walls of this level (§12.10.1.1: transfer forces × Ω₀ for the diaphragm; §12.3.3.3 elements supporting them).` });
    if (!swd.daLinked) out.issues.push({ code: 'above-linkback', warn: true,
      msg: `Shear Wall Design does not have this Diaphragm Analysis item ticked (Loading → "Line loads from Diaphragm Analysis"), so it still carries ${tr.map(w => w.mark).join(', ')} down their own line. Tick it there.` });
    if (!swd.planGrids) out.issues.push({ code: 'above-origin', warn: true,
      msg: 'The walls of the story above are placed from this item\'s line origins. Adopt the plan grids in Shear Wall Design (Loading → Plan grids) so every level uses the same line start.' });
  }
  return out;
}

// The grid and span of an SWD line on axis (the grids its lines sit on). set = wallLink.lineGrid[lineId]:
// { gridId, fromId, toId } ('' = from the name). Name "E" → grid E, whole line; "E 4-7" (also "E 4–7", "E: 4-7")
// → grid E from cross grid 4 to cross grid 7. Returns { grid, span: [lo, hi] | null, how: 'name' | 'name+span' | 'set' }.
export function lineGridOf(plan, axis, ln, set = {}) {
  const cross = axis === 'x' ? 'y' : 'x';
  const byName = (ax, n) => plan.grids.find(g => g.axis === ax && same(g.name, n)) || null;
  const byId = id => (id ? plan.gridById.get(id) || null : null);
  let grid = byId(set.gridId), how = grid ? 'set' : null, from = null, to = null;
  if (!grid) grid = byName(axis, ln.name), how = grid ? 'name' : null;
  if (!grid) {
    const m = /^\s*(.+?)[\s:]+([^\s:]+)\s*[-–]\s*(\S+)\s*$/.exec(String(ln.name || ''));
    if (m && byName(axis, m[1]) && byName(cross, m[2]) && byName(cross, m[3])) {
      grid = byName(axis, m[1]); from = byName(cross, m[2]); to = byName(cross, m[3]); how = 'name+span';
    }
  }
  if (set.fromId || set.toId) { from = byId(set.fromId) || from; to = byId(set.toId) || to; how = 'set'; }
  const span = from && to && Number.isFinite(from.at) && Number.isFinite(to.at) && Math.abs(to.at - from.at) > 1e-6
    ? [Math.min(from.at, to.at), Math.max(from.at, to.at)] : null;
  return { grid, span, how, from, to };
}

// B4: SWD calcAll on a copy of the definition, DA's line forces at DA's level (kip, 1.0E / 1.0W; other levels keep
// their own loads). lineForces: [{ swdDirId, swdLineId, E, W }]. Returns { weights: { E: { 'swd:<wallId>': kip },
// W: {…} }, error } — the shares SWD gives the walls of each line at this level (DA uses their ratio on a line).
//
// groups (optional): [{ name, wallIds: ['swd:<id>'], lineIds }] — offset lines of resistance. For each, out.groups[name]
// = { method, E: { weights, above }, W: {…} }: the walls of the group share the group's story shear the way SWD shares a
// line (option B, user 2026-11-03) — capacity method: by capacity × length (SDPWS 4.3.3.4.1; from SWD's own split),
// deflection method: by SWD's equal-δ split of the group walls' current story shear (equalDeflectionSplit with each
// wall's δ(V)). weights: { 'swd:<id>': number }; above: { lineId: kip } = the story shear from the stories above that
// reaches the group walls of that line (kept on its line). The forces are the ones given, so the caller repeats with
// the new line forces until the weights settle (the deflection method and auto-sized nailing are not linear).
// opts.fixNailing (open item 5-A, 2026-11-09): { wallId: nailingId } — hold these auto-nailed walls at that nailing in
// this copy (the stored item is not touched). out.nailing: { wallId: { id, label, cap } } of the group walls at the level
// (cap = plf, seismic), so the caller can see the automatic pick of each round.
export function swdWallShares(swd, levelId, lineForces, groups = [], opts = {}) {
  const out = { weights: { E: {}, W: {} }, groups: {}, nailing: {}, error: null };
  if (!swd || !swd.definition || !levelId) return out;
  const def = JSON.parse(JSON.stringify(swd.definition));
  if (opts.fixNailing) for (const d of def.directions || []) for (const l of d.lines || []) for (const w of l.walls || []) {
    if (w.levelId === levelId && !w.nailingPattern && opts.fixNailing[w.id]) w.nailingPattern = opts.fixNailing[w.id];
  }
  for (const lf of lineForces) {
    const dir = (def.directions || []).find(d => d.id === lf.swdDirId);
    const line = dir && (dir.lines || []).find(l => l.id === lf.swdLineId);
    if (!line) continue;
    if (!line.levelLoads) line.levelLoads = {};
    line.levelLoads[levelId] = { ...(line.levelLoads[levelId] || {}), seismic: String(lf.E || 0), wind: String(lf.W || 0) };
  }
  let res;
  try { res = swdCalcAll(def); } catch (e) { out.error = 'Shear Wall Design calculation failed: ' + e.message; return out; }
  const byLine = new Map(); // lineId → { line (definition), walls (results at this level), V: { E, W } (story shear) }
  for (const d of res.perDirection || []) for (const l of d.perLine || []) {
    const pl = (l.perLevel || []).find(p => p.levelId === levelId);
    for (const w of (pl && pl.walls) || []) {
      if (w.nailing && w.nailing.id) out.nailing[w.wallId] = { id: w.nailing.id, label: w.nailing.label, cap: w.effectiveSeismicCap ?? w.seismicCap ?? 0 };
      out.weights.E['swd:' + w.wallId] = w.shareExact_1E || 0;
      out.weights.W['swd:' + w.wallId] = w.shareExact_1W || 0;
    }
    const dl = (def.directions || []).flatMap(x => x.lines || []).find(x => x.id === l.lineId);
    if (dl) {
      const ss = accumulateStoryShear(dl.levelLoads || {}, def.levels || [])[levelId] || { seismic: 0, wind: 0 };
      byLine.set(dl.id, { line: dl, walls: (pl && pl.walls) || [], V: { E: ss.seismic, W: ss.wind } });
    }
  }
  for (const g of groups) {
    const lines = (g.lineIds || []).map(id => byLine.get(id)).filter(Boolean);
    const ids = new Set(g.wallIds || []);
    const methods = new Set(lines.map(x => lineDistribution(def, x.line)));
    const method = methods.size === 1 ? [...methods][0] : 'capacity';
    const entry = { method, mixed: methods.size > 1 };
    for (const lt of ['E', 'W']) {
      const key = lt === 'E' ? 'shareExact_1E' : 'shareExact_1W';
      const weights = {}, above = {};
      let carried = 0; // story shear the group walls carry now (k)
      const gw = [];
      for (const x of lines) {
        const own = x.walls.filter(w => ids.has('swd:' + w.wallId));
        const lf = lineForces.find(f => f.swdLineId === x.line.id);
        // this level's line force as given, negative too (open item 5, 2026-11-09): an offset line can take force off a line
        // (26998 line 3 −3.2 k); clamping it to 0 made the force from above depend on it (12.45 instead of 15.65 k) and
        // the rounds never settled
        const atLevel = Number(lf && lf[lt]) || 0;
        const share = (ws) => ws.reduce((t, w) => t + (w[key] || 0), 0);
        const lineShare = share(x.walls), ownShare = share(own);
        // the line's story shear at this level = what SWD's walls there carry (Σ shares). Not the running sum of the levels
        // above: walls that end at a floor hand their shear to the diaphragm (step 4), so it no longer reaches this level
        // (user 26996 2026-11-05: SW-19 got 0.22 of its weight, and less each round)
        const V = lineShare > 0 ? lineShare : x.V[lt];
        // story shear from above on this line, the part reaching the group walls (by their present share of the line)
        above[x.line.id] = Math.max(0, V - atLevel) * (lineShare > 0 ? ownShare / lineShare : own.length / Math.max(1, x.walls.length));
        carried += ownShare;
        const capLen = w => (lt === 'E' ? (w.effectiveSeismicCap ?? w.capacity) : (w.effectiveWindCap ?? w.capacity)) * (w.length || 0);
        const lineCap = x.walls.reduce((t, w) => t + (capLen(w) || 0), 0);
        for (const w of own) {
          gw.push(w);
          // capacity × length as SWD uses it: from SWD's own split when the line carries shear (exact for every wall
          // type), else from the wall's capacity
          weights['swd:' + w.wallId] = V > 0 && lineShare > 0 ? (w[key] || 0) / V * lineCap : capLen(w) || w.length || 0;
        }
      }
      // equal δ only when every group wall has a deflection over 0 … the carried force (as SWD's own split checks). A wall
      // SWD cannot design at its trial share returns null, which the solver would read as an infinitely stiff wall taking
      // the whole group (bug 0, user test 26998 2026-11-09: Roof 2/3, SW-65 took 22.8 k, SW-35 0). Otherwise this round is
      // split by capacity (warning swd-group-defl); the next round tries equal δ again with the new forces.
      const hasDelta = w => typeof w._deltaAt === 'function' && [0, carried / 2, carried].every(v => Number.isFinite(w._deltaAt(lt, v)));
      if (method === 'deflection' && carried > 0 && gw.length && gw.every(hasDelta)) {
        try {
          const s = equalDeflectionSplit(carried, gw.map(w => (Vk) => w._deltaAt(lt, Vk)));
          gw.forEach((w, i) => { weights['swd:' + w.wallId] = s.shares[i]; });
        } catch { entry.deflectionFailed = true; }
      } else if (method === 'deflection' && carried > 0) entry.deflectionFailed = true; // kept across E / W (the W pass with no load cleared it)
      entry[lt] = { weights, above };
    }
    out.groups[g.name] = entry;
  }
  return out;
}
