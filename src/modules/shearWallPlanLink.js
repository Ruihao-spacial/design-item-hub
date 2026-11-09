// Shear Wall Design ↔ Diaphragm Analysis grid link (user 2026-11-05, build step 3; pure, no DOM).
//
// Only for an SWD item linked to Diaphragm Analysis items (Loading → "Line loads from Diaphragm Analysis") whose
// engineer pressed "Adopt plan grids". Nothing here runs for any other item, and nothing is written to an item until
// that button is pressed (existing projects keep their stored data, results and elevations — tests/swdFreeze.test.mjs).
//
// Stored (only after adoption):
//   inputs.planLink = { sourceId, grids: [{ name, axis, at, from, to, ref }],     // copy of the source DA item's grids
//                       lines: { [lineId]: { grid, axis, at } },                    // the grid each SWD line sits on
//                       extents: { [lineId]: { [levelId]: [[lo, hi], …] } } }      // sheathed diaphragm per level (plan)
//   line.planOrigin = plan coordinate of position 0 of the line (string, ft). All positions on the line stay measured
//   from it, so the calc is unchanged; the line length is only how far the line is drawn.
// The copy is refreshed with the other DA link values (update notice → Update), never the line starts.
// DA reads line.planOrigin (tdWallLink.swdExtract) and places the walls of every level from the same start.

const num = v => (v === '' || v === null || v === undefined ? NaN : Number(v));
const r4 = v => Math.round(v * 1e4) / 1e4;
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// JSON with object keys sorted (order-free comparison)
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(n => [n, x[n]])) : x));

export const planLinkOn =inputs => !!(inputs && inputs.planLink && Array.isArray(inputs.planLink.grids));

// The linked DA sources, as the ref extract gives them: [{ id, level, planGrids, planLines }]
export function sourcesWithPlan(sources) {
  return (sources || []).filter(s => s && Array.isArray(s.planGrids));
}

// Default source: the DA item that owns the shared grids (user 2026-11-05), else the linked DA item of the highest SWD
// level (levels are stored top first)
export function defaultSourceId(inputs, sources) {
  const list = sourcesWithPlan(sources);
  const owner = list.find(s => list.some(x => x.gridsFrom === s.id)) || null;
  if (owner) return owner.id;
  for (const lvl of inputs.levels || []) {
    const s = list.find(x => same(x.level, lvl.name));
    if (s) return s.id;
  }
  return list.length ? list[0].id : null;
}

// The snapshot from the sources (null when the source has no grids)
export function buildPlanLink(inputs, sources, sourceId) {
  const list = sourcesWithPlan(sources);
  const src = list.find(s => s.id === sourceId) || null;
  if (!src) return null;
  const lines = {}, extents = {};
  for (const pl of src.planLines || []) if (pl.grid && Number.isFinite(pl.at)) lines[pl.lineId] = { grid: pl.grid, axis: pl.axis, at: r4(pl.at) };
  for (const s of list) {
    const lvl = (inputs.levels || []).find(l => same(l.name, s.level));
    if (!lvl) continue;
    for (const pl of s.planLines || []) {
      if (!pl.grid || !Array.isArray(pl.bands)) continue;
      if (!extents[pl.lineId]) extents[pl.lineId] = {};
      extents[pl.lineId][lvl.id] = pl.bands.map(([a, b]) => [r4(a), r4(b)]);
    }
  }
  const grids = src.planGrids.map(g => ({ name: g.name, axis: g.axis, at: r4(g.at), from: Number.isFinite(g.from) ? r4(g.from) : null, to: Number.isFinite(g.to) ? r4(g.to) : null, ref: !!g.ref }));
  return { sourceId: src.id, grids, lines, extents };
}

// Line starts the DA items use today, per SWD line: [{ lineId, level, origin }] (to adopt one and show where levels differ)
export function originsBySource(sources) {
  const out = [];
  for (const s of sourcesWithPlan(sources)) for (const pl of s.planLines || []) if (pl.grid && Number.isFinite(pl.origin)) out.push({ lineId: pl.lineId, level: s.level, sourceId: s.id, origin: r4(pl.origin) });
  return out;
}

// Adopt: write the snapshot and, for every line that has no start yet, the start the source DA item uses today (so no
// wall moves on that level). Returns { planLink, set: [{ lineId, origin }], differ: [{ lineId, origins: [{ level, origin }] }] }.
export function adoptPlanLink(inputs, sources, sourceId) {
  const planLink = buildPlanLink(inputs, sources, sourceId);
  if (!planLink) return null;
  inputs.planLink = planLink;
  const all = originsBySource(sources);
  const set = [], differ = [];
  for (const d of inputs.directions || []) for (const line of d.lines || []) {
    const mine = all.filter(o => o.lineId === line.id);
    const fromSrc = mine.find(o => o.sourceId === planLink.sourceId);
    if (new Set(mine.map(o => o.origin)).size > 1) differ.push({ lineId: line.id, name: line.name, origins: mine.map(o => ({ level: o.level, origin: o.origin })) });
    if (Number.isFinite(num(line.planOrigin)) || !fromSrc) continue;
    line.planOrigin = String(fromSrc.origin);
    set.push({ lineId: line.id, origin: fromSrc.origin });
  }
  syncAll(inputs);
  return { planLink, set, differ };
}

// Remove the link: the snapshot and the line starts (positions are kept; DA falls back to its own origins)
export function dropPlanLink(inputs) {
  delete inputs.planLink;
  for (const d of inputs.directions || []) for (const line of d.lines || []) delete line.planOrigin;
}

// The snapshot is out of date with the sources (update notice). Only for an adopted item.
export function planLinkStale(inputs, sources) {
  if (!planLinkOn(inputs)) return false;
  const fresh = buildPlanLink(inputs, sources, inputs.planLink.sourceId);
  if (!fresh) return false; // source unticked / gone: keep the copy
  // by value: the database (jsonb) stores object keys in its own order, so a plain JSON string differs after every save
  const key = p => canon([p.grids, p.lines, p.extents]);
  return key(fresh) !== key(inputs.planLink);
}
export function refreshPlanLink(inputs, sources) {
  if (!planLinkOn(inputs)) return;
  const fresh = buildPlanLink(inputs, sources, inputs.planLink.sourceId);
  if (fresh) { inputs.planLink = fresh; syncAll(inputs); }
}

// A grid reaches coordinate c along its length (from / to null = open)
const reaches = (g, c) => !(Number.isFinite(g.from) && Number.isFinite(g.to) ? c < Math.min(g.from, g.to) - 1e-6 || c > Math.max(g.from, g.to) + 1e-6
  : (Number.isFinite(g.from) && c < g.from - 1e-6) || (Number.isFinite(g.to) && c > g.to + 1e-6));

// What the elevation draws for a line (positions along the line, ft from position 0), or null when not linked.
// { origin, grid: { name, axis, at } | null, cross: [{ name, x }] (grids crossing the line, any x), extents: [{ levelId, segs: [[a, b]] }] }
export function planViewOf(inputs, line) {
  if (!planLinkOn(inputs) || !line) return null;
  const origin = num(line.planOrigin);
  if (!Number.isFinite(origin)) return null;
  const L = inputs.planLink.lines[line.id] || null;
  const crossAxis = L ? (L.axis === 'x' ? 'y' : 'x') : null;
  const cross = L ? inputs.planLink.grids.filter(g => g.axis === crossAxis && !g.ref && Number.isFinite(g.at) && reaches(g, L.at))
    .map(g => ({ name: g.name, x: r4(g.at - origin), at: g.at })).sort((a, b) => a.x - b.x) : [];
  const ext = (inputs.planLink.extents || {})[line.id] || {};
  const extents = Object.entries(ext).map(([levelId, segs]) => ({ levelId, segs: segs.map(([a, b]) => [r4(a - origin), r4(b - origin)]) }));
  return { origin, grid: L ? { name: L.grid, axis: L.axis, at: L.at } : null, cross, extents };
}

// Line length from the plan (adopted items): from the line start to the end of the longest diaphragm stretch on the
// line over all levels, never shorter than the farthest element. null = no stretch known (the typed length stays).
export function planLineLength(inputs, line) {
  if (!planLinkOn(inputs)) return null;
  const origin = num(line.planOrigin);
  const ext = (inputs.planLink.extents || {})[line.id];
  if (!Number.isFinite(origin) || !ext) return null;
  const ends = Object.values(ext).flat().map(([, b]) => b - origin).filter(Number.isFinite);
  if (!ends.length) return null;
  const el = [...(line.walls || []).map(w => num(w.position) + num(w.length)), ...(line.beams || []).map(b => num(b.position) + num(b.length)),
    ...(line.supportPosts || []).map(p => num(p.position))].filter(Number.isFinite);
  return r4(Math.max(...ends, ...el, 0));
}
// Write it (keeps the stored type); returns true when it changed
export function syncLineLength(inputs, line) {
  const L = planLineLength(inputs, line);
  if (L === null || Math.abs(num(line.totalLength) - L) < 1e-6) return false;
  line.totalLength = typeof line.totalLength === 'number' ? L : String(L);
  return true;
}
const syncAll = inputs => { for (const d of inputs.directions || []) for (const line of d.lines || []) syncLineLength(inputs, line); };

// Move the line start to newOrigin while every wall, post, beam, beam support and gravity load keeps its plan location
// (positions shift by old − new). Openings are measured from their wall and do not change.
export function moveLineStart(line, newOrigin) {
  const old = num(line.planOrigin), nu = num(newOrigin);
  if (!Number.isFinite(nu)) return;
  const d = Number.isFinite(old) ? old - nu : 0;
  const sh = (o, k) => { if (o && o[k] !== '' && o[k] !== undefined && o[k] !== null && Number.isFinite(num(o[k]))) o[k] = typeof o[k] === 'number' ? r4(o[k] + d) : String(r4(num(o[k]) + d)); };
  if (d) {
    for (const w of line.walls || []) sh(w, 'position');
    for (const p of line.supportPosts || []) sh(p, 'position');
    for (const b of line.beams || []) { sh(b, 'position'); for (const s of b.supports || []) sh(s, 'position'); }
    for (const gl of Object.values(line.gravityLoads || {})) {
      for (const ld of (gl && gl.loads) || []) { if (ld.shape === 'full') continue; sh(ld, 'position'); sh(ld, 'start'); sh(ld, 'end'); }
      for (const u of (gl && gl.uniform) || []) { sh(u, 'start'); sh(u, 'end'); }
      for (const p of (gl && gl.point) || []) sh(p, 'position');
    }
    // the line's far end stays where it is on the plan (and never cuts an element)
    const len = num(line.totalLength);
    if (Number.isFinite(len)) {
      const ends = [...(line.walls || []).map(w => num(w.position) + num(w.length)), ...(line.beams || []).map(b => num(b.position) + num(b.length)),
        ...(line.supportPosts || []).map(p => num(p.position))].filter(Number.isFinite);
      const L = Math.max(r4(len + d), ...ends, 0);
      line.totalLength = typeof line.totalLength === 'number' ? L : String(L);
    }
  }
  line.planOrigin = String(r4(nu));
}
