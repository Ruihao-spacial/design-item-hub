// Wall openings: geometry, checks, and segmented-wall expansion.
// An opening is { id, offset, width, sill, head } in ft: offset from the wall's left end,
// sill and head heights above the floor line. Wall height = level floor-to-floor.
// Full-height openings (doors) are not openings — model them as separate walls. Only FTAO walls have openings.

const TOL = 0.01;
export const MIN_PIER_FT = 2.0;         // SDPWS 2021 §4.3.5.2
export const MIN_NARROW_PIER_FT = 1.5;  // APA T555 alternate (CBC §104.11), per-wall opt-in
export const MAX_FTAO_OPENINGS = 3;

function num(v) { return parseFloat(v) || 0; }

export function hasOpenings(wall) {
  return Array.isArray(wall.openings) && wall.openings.length > 0;
}

export function wallMethod(wall) {
  return wall.method === 'ftao' ? 'ftao' : 'segmented';
}

// Openings sorted left → right, numbers parsed
export function sortedOpenings(wall) {
  return (wall.openings || [])
    .map(o => ({ id: o.id, offset: num(o.offset), width: num(o.width), sill: num(o.sill), head: num(o.head) }))
    .sort((a, b) => a.offset - b.offset);
}

// Full-height piers between the openings of an FTAO wall, absolute positions along the line
export function wallPiers(wall) {
  const x0 = num(wall.position);
  const L = num(wall.length);
  const piers = [];
  let cursor = 0;
  for (const o of sortedOpenings(wall)) {
    piers.push({ start: x0 + cursor, end: x0 + o.offset, length: o.offset - cursor });
    cursor = o.offset + o.width;
  }
  piers.push({ start: x0 + cursor, end: x0 + L, length: L - cursor });
  return piers;
}

// Geometry problems that make the openings unusable (wall is then designed as solid)
export function openingProblems(wall, floorH) {
  const problems = [];
  if (!hasOpenings(wall)) return problems;
  const L = num(wall.length);
  const h = num(floorH);
  const ops = sortedOpenings(wall);
  ops.forEach((o, j) => {
    const n = 'Opening ' + (j + 1);
    if (!(o.width > 0)) problems.push(n + ': width must be > 0');
    if (o.offset < -TOL || o.offset + o.width > L + TOL) problems.push(n + ' extends beyond the wall');
    if (!(o.sill > 0)) problems.push(n + ': sill height must be > 0 (full-height openings: split the wall instead)');
    if (!(o.head > o.sill)) problems.push(n + ': head height must be above the sill');
    if (h > 0 && !(o.head < h - TOL)) problems.push(n + ': head height must be below the floor-to-floor height (' + h + ' ft)');
    if (j > 0) {
      const prev = ops[j - 1];
      if (o.offset < prev.offset + prev.width - TOL) problems.push(n + ' overlaps opening ' + j);
    }
  });
  if (wallMethod(wall) === 'ftao' && ops.length > MAX_FTAO_OPENINGS) {
    problems.push('FTAO covers 1–' + MAX_FTAO_OPENINGS + ' openings (wall has ' + ops.length + ')');
  }
  if (!problems.length) {
    const minPier = wall.narrowPier ? MIN_NARROW_PIER_FT : MIN_PIER_FT;
    wallPiers(wall).forEach((p, i) => {
      if (p.length < minPier - TOL) {
        problems.push('Pier ' + (i + 1) + ' is ' + p.length.toFixed(2) + ' ft — minimum ' + minPier.toFixed(1) + ' ft'
          + (wall.narrowPier ? '' : ' (APA T555 1.5 ft piers need the narrow-pier option)'));
      }
    });
  }
  return problems;
}

// Walls as the calc sees them. Segmented walls are solid full-height walls and cannot have openings;
// openings exist only on FTAO walls. A segmented wall that still carries openings (outside data) and an FTAO
// wall with unusable opening geometry are designed as solid walls and reported.
// Returns { walls, problems: { wallId: [messages] } }.
export const SEGMENTED_OPENINGS_MSG = 'segmented walls are solid full-height walls and cannot have openings — use FTAO or split the wall';
export function expandWalls(walls, levels) {
  const floorHOf = {};
  (levels || []).forEach(l => { floorHOf[l.id] = num(l.floorToFloor); });
  const out = [];
  const problems = {};
  for (const w of walls || []) {
    if (!hasOpenings(w)) { out.push(w); continue; }
    const p = wallMethod(w) === 'ftao' ? openingProblems(w, floorHOf[w.levelId]) : [SEGMENTED_OPENINGS_MSG];
    if (p.length) { problems[w.id] = p; out.push({ ...w, openings: [], _openingsIgnored: true }); continue; }
    out.push(w);
  }
  return { walls: out, problems };
}
