// Transfer Diaphragm — constructors for the stored definition (shape: tdMigrate.js). No DOM.
import { TD_SCHEMA } from './tdMigrate.js';

let _uid = 0;
export const uid = p => p + '-' + Date.now().toString(36) + '-' + (++_uid).toString(36);
const s = v => (v === undefined || v === null ? '' : String(v));

export const newGrid = (name, axis, at) => ({ id: uid('gr'), name: s(name), axis: axis === 'y' ? 'y' : 'x', at: s(at), ref: false });
export const newOpening = (x1, x2, y1, y2) => ({ id: uid('op'), name: '', x1: s(x1), x2: s(x2), y1: s(y1), y2: s(y2) });
export const newWall = (gridId, from, to, line, mark) => ({ id: uid('wl'), line: s(line), mark: s(mark), gridId: gridId || '', from: s(from), to: s(to) });
export const newTd = (mark, x1, x2, y1, y2, dir) => ({
  id: uid('td'), mark: s(mark), dir: dir === 'x' ? 'x' : 'y', x1: s(x1), x2: s(x2), y1: s(y1), y2: s(y2), supports: [], loads: [], overhang: null,
  engineer: { regionClear: null, cantileverOk: null, closureTol: '' },
});
// A diaphragm for one load direction: its rectangle (clipped to the sheathed plan) spans between two support lines
export const newDiaphragm = (mark, dir, x1, x2, y1, y2, supports) => ({
  id: uid('dg'), mark: s(mark), dir: dir === 'x' ? 'x' : 'y', x1: s(x1), x2: s(x2), y1: s(y1), y2: s(y2),
  supports: supports || [], sheathing: '', blocked: null, bandSplit: '',
});
export const newLoad = (acts, mode) => ({ id: uid('ld'), acts: acts || '-y', mode: mode || 'seismic', kind: '', psf: '', edgeId: '', segments: [] });
export const newSegment = (from, to, w) => ({ from: s(from), to: s(to), w: s(w), w2: '', wl: '' }); // wind mode: w windward, wl leeward

// A new item: a 100 × 50 ft rectangle on grids 1-2 / A-B, seismic load and one diaphragm in each direction
export function defaultInputs() {
  const g1 = newGrid('1', 'x', 0), g2 = newGrid('2', 'x', 100), gA = newGrid('A', 'y', 50), gB = newGrid('B', 'y', 0);
  return {
    schemaVersion: TD_SCHEMA, codeEdition: 'CBC-2025', designBasis: 'ASD', pdfReport: 'summary', refs: {}, notes: '',
    level: { name: '', fx: '' },
    diaphragm: { sheathing: 'wsp', blocked: true },
    grids: [g1, g2, gA, gB],
    outline: [{ x: '0', y: '0' }, { x: '100', y: '0' }, { x: '100', y: '50' }, { x: '0', y: '50' }],
    openings: [], walls: [], tds: [],
    diaphragms: [newDiaphragm('D1', 'y', 0, 100, 0, 50, [g1.id, g2.id]), newDiaphragm('D1', 'x', 0, 100, 0, 50, [gA.id, gB.id])],
    loads: [newLoad('-y', 'seismic'), newLoad('+x', 'seismic')],
  };
}

// Next free mark with a prefix: TD1, TD2 …
export function nextMark(list, prefix) {
  let n = 1;
  const used = new Set(list.map(x => x.mark));
  while (used.has(prefix + n)) n++;
  return prefix + n;
}
