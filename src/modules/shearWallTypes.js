const SVG_NS = 'http://www.w3.org/2000/svg';

let _id = { lvl: 1, dir: 1, ln: 1, w: 1, gu: 1, gp: 1, gl: 1, wdt: 1, bm: 1, sp: 1, bs: 1, op: 1 };

export function resetIds(inputs) {
  const max = { lvl: 0, dir: 0, ln: 0, w: 0, gu: 0, gp: 0, gl: 0, wdt: 0, bm: 0, sp: 0, bs: 0, op: 0 };
  const extract = (id) => {
    if (!id) return;
    const m = id.match(/^([a-z]+)-(\d+)$/);
    if (m && max[m[1]] !== undefined) max[m[1]] = Math.max(max[m[1]], +m[2]);
  };
  if (!inputs) return;
  (inputs.levels || []).forEach(l => extract(l.id));
  (inputs.wallDLTypes || []).forEach(t => extract(t.id));
  (inputs.directions || []).forEach(d => {
    extract(d.id);
    (d.lines || []).forEach(ln => {
      extract(ln.id);
      (ln.walls || []).forEach(w => {
        extract(w.id);
        (w.openings || []).forEach(o => extract(o.id));
      });
      (ln.beams || []).forEach(b => {
        extract(b.id);
        (b.supports || []).forEach(s => extract(s.id));
      });
      (ln.supportPosts || []).forEach(s => extract(s.id));
      Object.values(ln.gravityLoads || {}).forEach(gl => {
        (gl.uniform || []).forEach(u => extract(u.id));
        (gl.point || []).forEach(p => extract(p.id));
        (gl.loads || []).forEach(p => extract(p.id));
      });
    });
  });
  for (const k of Object.keys(_id)) _id[k] = max[k] + 1;
}

export function newLevelId() { return 'lvl-' + (_id.lvl++); }
export function newDirId() { return 'dir-' + (_id.dir++); }
export function newLineId() { return 'ln-' + (_id.ln++); }
export function newWallId() { return 'w-' + (_id.w++); }
export function newUniformId() { return 'gu-' + (_id.gu++); }
export function newPointId() { return 'gp-' + (_id.gp++); }
export function newGravityLoadId() { return 'gl-' + (_id.gl++); }
export function newWDTId() { return 'wdt-' + (_id.wdt++); }
export function newBeamId() { return 'bm-' + (_id.bm++); }
export function newSupportPostId() { return 'sp-' + (_id.sp++); }
export function newBeamSupportId() { return 'bs-' + (_id.bs++); }
export function newOpeningId() { return 'op-' + (_id.op++); }

let _wallNum = 1;
export function resetWallNum(inputs) {
  let maxNum = 0;
  (inputs.directions || []).forEach(d =>
    (d.lines || []).forEach(ln =>
      (ln.walls || []).forEach(w => {
        const m = (w.mark || '').match(/^SW-(\d+)$/);
        if (m) maxNum = Math.max(maxNum, +m[1]);
      })
    )
  );
  _wallNum = maxNum + 1;
}
export function nextWallMark() { return 'SW-' + (_wallNum++); }

let _beamNum = 1;
let _postNum = 1;
export function resetElementNums(inputs) {
  let maxBm = 0, maxP = 0;
  (inputs.directions || []).forEach(d =>
    (d.lines || []).forEach(ln => {
      (ln.beams || []).forEach(b => {
        const m = (b.mark || '').match(/^BM-(\d+)$/);
        if (m) maxBm = Math.max(maxBm, +m[1]);
      });
      (ln.supportPosts || []).forEach(p => {
        const m = (p.mark || '').match(/^P-(\d+)$/);
        if (m) maxP = Math.max(maxP, +m[1]);
      });
    })
  );
  _beamNum = maxBm + 1;
  _postNum = maxP + 1;
}
export function nextBeamMark() { return 'BM-' + (_beamNum++); }
export function nextPostMark() { return 'P-' + (_postNum++); }

export function newLevel(name) {
  return { id: newLevelId(), name: name || '', floorToFloor: '', floorClearSpan: '16', anchorageType: 'auto' };
}

export function newWallDLType(name, psf) {
  return { id: newWDTId(), name: name || '', psf: psf ?? '' };
}

export function newDirection(name) {
  return { id: newDirId(), name: name || '', rho: 1.0, lines: [] };
}

export function newLine(name) {
  return {
    id: newLineId(), name: name || '', totalLength: 60,
    wallThickness: '', distribution: '', // '' = project default distribution
    levelLoads: {}, walls: [], beams: [], supportPosts: [], gravityLoads: {},
  };
}

export function newWall(levelId, position, wallDLTypeId) {
  return {
    id: newWallId(), mark: nextWallMark(), levelId,
    position: position ?? 0, length: 4,
    wallDLTypeId: wallDLTypeId || '',
    nailingPattern: '',
    anchorageLeftOverride: '', anchorageRightOverride: '',
    postLeftOverride: '', postRightOverride: '',
    ...wallOpeningDefaults(),
    ...wallSystemDefaults(),
  };
}

// Wall system (schema v7): 'sheathed' wood shear wall or a Simpson Strong-Wall WSWH panel.
// WSWH: width 12 / 18 / 24 in (wall length = width), condition concrete | raised | stackedUpper,
// joist depth (raised floor: '12' ≤ 12", '16' 12"–16"), floor depth d_fl (in, stacked), anchor override (Table 06 row)
export function wallSystemDefaults() {
  return { systemType: 'sheathed', wswhWidth: '18', wswhCondition: 'concrete', wswhJoist: '12', wswhFloorDepth: '12', wswhAnchorOverride: '' };
}

// Openings and wall-with-openings settings (schema v6). method: 'segmented' | 'ftao'
export function wallOpeningDefaults() {
  return { openings: [], method: 'segmented', narrowPier: false, ftaoStrapOverride: '', jambPostOverride: '' };
}

// Window-type opening: offset from the wall's left end, width, sill and head heights above the floor (ft)
export function newOpening(offset, width, sill, head) {
  return { id: newOpeningId(), offset: offset ?? 1, width: width ?? 3, sill: sill ?? 3, head: head ?? 7 };
}

export function newUniformLoad(start, end) {
  return { id: newUniformId(), start: start ?? 0, end: end ?? 30, dlPlf: '' };
}

// Gravity load row (schema v8): shape point | full | partial; D / L / Lr (kips for a point, plf for uniform);
// uniform rows are plf, or psf × tributary width (perArea, trib ft); a Flat Load assembly link (assemblyId) is psf × trib
export function newGravityLoad(shape, start, end) {
  return { id: newGravityLoadId(), shape: shape || 'partial', position: start ?? 0, start: start ?? 0, end: end ?? 30, D: '', L: '', Lr: '', perArea: false, trib: '', assemblyId: '' };
}

export function newPointLoad(position) {
  return { id: newPointId(), position: position ?? 0, dlKips: '' };
}

// Beam sits at the bottom floor line of story levelId and carries that story's walls/posts
export function newBeam(levelId, position, length) {
  return { id: newBeamId(), mark: nextBeamMark(), levelId, position: position ?? 0, length: length ?? 8, supports: [] };
}

// type: 'point' (support at this level) | 'post' (links to a post in the story below)
export function newBeamSupport(position, type) {
  return { id: newBeamSupportId(), position: position ?? 0, type: type || 'point', anchorageOverride: '' };
}

// A post occupies one story (levelId), floor-to-floor
export function newSupportPost(levelId, position) {
  return { id: newSupportPostId(), mark: nextPostMark(), levelId, position: position ?? 0, anchorageOverride: '', postOverride: '' };
}

export function defaultInputs() {
  const wdt1 = newWallDLType('Exterior', 9.5);
  const wdt2 = newWallDLType('Interior', 7.0);
  const lvl1 = newLevel('Roof');
  lvl1.floorToFloor = 10;
  const lvl2 = newLevel('2nd Floor');
  lvl2.floorToFloor = 10;
  const dir1 = newDirection('N-S');
  dir1.lines.push(newLine('Line 1'));
  const dir2 = newDirection('E-W');
  dir2.lines.push(newLine('Line A'));
  return {
    sds: '', loadType: 'seismic',
    wallThickness: '4',
    ...deflectionDefaults(),
    ...projectV7Defaults(),
    ...projectV8Defaults(),
    woodGrade: 'dfir_no1',
    wallDLTypes: [wdt1, wdt2],
    levels: [lvl1, lvl2],
    directions: [dir1, dir2],
    refs: {}, notes: '',
  };
}

// Deflection / drift settings (schema v6). cd, ie, riskCategory are copied from a linked Base Shear item.
export function deflectionDefaults() {
  return { sheathing: 'ply', cd: '', ie: '', riskCategory: '', driftRow: 'other', alphaS: '', distribution: 'capacity' };
}

// Project settings added in schema v7: Ω₀ (forces-only combos) and SDC (WSWH anchor criteria), both copied
// from a linked Base Shear item; foundation f'c and detached one-/two-family dwelling for the WSWH tables
export function projectV7Defaults() {
  return { omega0: '', seismicDesignCategory: '', wswhFc: '2500', detachedOneTwoFamily: false };
}

// Schema v8: LRFD live-load factor 0.5 (ASCE 7-22 §2.3.1 exc. 1 / §2.3.6; Lo ≤ 100 psf, not garages or assembly)
export function projectV8Defaults() {
  return { lrfdHalfL: false };
}

export function svgEl(tag, attrs, ...children) {
  const e = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('on') && typeof v === 'function') {
        e.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'style' && typeof v === 'object') {
        Object.assign(e.style, v);
      } else if (v !== undefined && v !== null && v !== false) {
        e.setAttribute(k, v);
      }
    }
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    if (typeof c === 'string' || typeof c === 'number') {
      e.appendChild(document.createTextNode(String(c)));
    } else if (c instanceof Node) {
      e.appendChild(c);
    }
  }
  return e;
}
