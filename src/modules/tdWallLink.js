// Diaphragm Analysis ↔ Shear Wall Design link (pure, no DOM).
// Shear Wall Design (SWD) owns the walls (all wall types, all levels); the Diaphragm Analysis (DA) plan owns the
// grids. DA reads the SWD definition (ref from: 'inputs') and places the walls of its level on the plan:
//   - each SWD direction is mapped to a DA load direction (wallLink.dirMap: 'x' | 'y'); its lines run along the load,
//     so a line of a load along y sits on the ↕ grid (constant x) with the same name, and the reverse;
//   - an SWD wall position is measured along its line from the line origin; wallLink.origins[lineId] is the plan
//     coordinate of that origin ('' = where the line enters the sheathed plan).
// DA's results label each line force with the SWD direction / line ids, so SWD needs no geometry or mapping.
// SWD helpers and its engine are imported read-only. B4 (Phase 4): swdWallShares runs SWD's own calcAll on a copy of
// the definition with DA's line forces at DA's level, so the walls share a line force exactly as in SWD.
import { isWswh, wswhWidthFt } from './shearWallWswh.js';
import { calcAll as swdCalcAll } from './shearWallCalc.js';
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
    directions: (def.directions || []).map(d => ({
      id: d.id, name: d.name || '',
      lines: (d.lines || []).map(ln => ({
        id: ln.id, name: ln.name || '', totalLength: num(ln.totalLength),
        walls: (ln.walls || []).map(w => ({
          id: w.id, mark: w.mark || '', levelId: w.levelId, position: num(w.position),
          length: isWswh(w) ? wswhWidthFt(w) : num(w.length), type: w.systemType || 'segmented',
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
  for (const d of swd.directions) {
    const dir = (link.dirMap || {})[d.id] || guessDir(d.name);
    if (dir !== 'x' && dir !== 'y') {
      out.issues.push({ code: 'link-dir', msg: `Map Shear Wall Design direction "${d.name || '?'}" to a load direction (Setup).` });
      continue;
    }
    const axis = dir === 'y' ? 'x' : 'y'; // grid the line sits on
    for (const ln of d.lines) {
      const grid = plan.grids.find(g => g.axis === axis && same(g.name, ln.name)) || null;
      const typed = num((link.origins || {})[ln.id]);
      const bands = grid ? sectionBands(plan, axis, grid.at) : [];
      // length of the grid line in the plan: from where it enters the sheathed plan to where it leaves it
      const planLength = bands.length ? bands[bands.length - 1][1] - bands[0][0] : 0;
      let origin = typed, originAuto = false;
      if (grid && !Number.isFinite(typed)) { origin = bands.length ? bands[0][0] : 0; originAuto = true; }
      out.lines.push({ dirId: d.id, dirName: d.name, dir, lineId: ln.id, name: ln.name, grid, origin, originAuto, planLength, swdLength: ln.totalLength });
      if (grid && Number.isFinite(ln.totalLength) && Math.abs(ln.totalLength - planLength) > LENGTH_TOL) {
        out.issues.push({ code: 'link-length', msg: `Line ${ln.name} (${d.name}): length in Shear Wall Design ${r2(ln.totalLength)} ft ≠ grid ${grid.name} in this plan ${r2(planLength)} ft. Make them match (SWD line length, or the plan outline).` });
      }
      const walls = ln.walls.filter(w => w.levelId === lvl.id);
      if (!grid) {
        if (walls.length) out.issues.push({ code: 'link-grid', msg: `Shear Wall Design line "${ln.name}" (${d.name}): no ${axis === 'x' ? '↕' : '↔'} grid named "${ln.name}" in the plan.` });
        continue;
      }
      for (const w of walls) {
        if (!Number.isFinite(w.position) || !(w.length > 0)) { out.issues.push({ code: 'link-wall', msg: `Wall ${w.mark} (line ${ln.name}): position / length missing in Shear Wall Design.` }); continue; }
        out.walls.push({ id: 'swd:' + w.id, line: ln.name, mark: w.mark, gridId: grid.id, from: String(origin + w.position), to: String(origin + w.position + w.length),
          linked: true, swdLineId: ln.id, swdDirId: d.id, type: w.type });
      }
    }
  }
  return out;
}

// B4: SWD calcAll on a copy of the definition, DA's line forces at DA's level (kip, 1.0E / 1.0W; other levels keep
// their own loads). lineForces: [{ swdDirId, swdLineId, E, W }]. Returns { weights: { E: { 'swd:<wallId>': kip },
// W: {…} }, error } — the shares SWD gives the walls of each line at this level (DA uses their ratio on a line).
export function swdWallShares(swd, levelId, lineForces) {
  const out = { weights: { E: {}, W: {} }, error: null };
  if (!swd || !swd.definition || !levelId) return out;
  const def = JSON.parse(JSON.stringify(swd.definition));
  for (const lf of lineForces) {
    const dir = (def.directions || []).find(d => d.id === lf.swdDirId);
    const line = dir && (dir.lines || []).find(l => l.id === lf.swdLineId);
    if (!line) continue;
    if (!line.levelLoads) line.levelLoads = {};
    line.levelLoads[levelId] = { ...(line.levelLoads[levelId] || {}), seismic: String(lf.E || 0), wind: String(lf.W || 0) };
  }
  let res;
  try { res = swdCalcAll(def); } catch (e) { out.error = 'Shear Wall Design calculation failed: ' + e.message; return out; }
  for (const d of res.perDirection || []) for (const l of d.perLine || []) {
    const pl = (l.perLevel || []).find(p => p.levelId === levelId);
    for (const w of (pl && pl.walls) || []) {
      out.weights.E['swd:' + w.wallId] = w.shareExact_1E || 0;
      out.weights.W['swd:' + w.wallId] = w.shareExact_1W || 0;
    }
  }
  return out;
}
