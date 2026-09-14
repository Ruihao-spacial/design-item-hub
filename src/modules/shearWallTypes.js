const SVG_NS = 'http://www.w3.org/2000/svg';

let _id = { lvl: 1, dir: 1, ln: 1, w: 1, gu: 1, gp: 1, wdt: 1 };

export function resetIds(inputs) {
  const max = { lvl: 0, dir: 0, ln: 0, w: 0, gu: 0, gp: 0, wdt: 0 };
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
      (ln.walls || []).forEach(w => extract(w.id));
      Object.values(ln.gravityLoads || {}).forEach(gl => {
        (gl.uniform || []).forEach(u => extract(u.id));
        (gl.point || []).forEach(p => extract(p.id));
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
export function newWDTId() { return 'wdt-' + (_id.wdt++); }

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
    wallThickness: '',
    levelLoads: {}, walls: [], gravityLoads: {},
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
  };
}

export function newUniformLoad(start, end) {
  return { id: newUniformId(), start: start ?? 0, end: end ?? 30, dlPlf: '' };
}

export function newPointLoad(position) {
  return { id: newPointId(), position: position ?? 0, dlKips: '' };
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
    woodGrade: 'dfir_no1',
    wallDLTypes: [wdt1, wdt2],
    levels: [lvl1, lvl2],
    directions: [dir1, dir2],
    refs: {}, notes: '',
  };
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
