// Book example (tests/td-book/Ex*.json, FORMAT.md) → Transfer Diaphragm item inputs (tdMigrate.js shape).
// Names become ids; numbers become strings as typed in the form. `verification` carries the book values so the
// item's Verification tab can show them.
import { TD_SCHEMA } from '../../../src/modules/tdMigrate.js';

const s = v => (v === undefined || v === null ? '' : String(v));

export function bookToInputs(book) {
  const L = book.layout;
  const ids = new Map();
  const grids = L.grids.map((g, i) => {
    const id = `gr-${book.id}-${i}`;
    ids.set(g.name, id);
    return { id, name: g.name, axis: g.axis, at: s(g.at), ref: !!g.ref };
  });
  const gridId = name => ids.get(name) || '';
  const gridOn = (axis, at) => L.grids.find(g => g.axis === axis && g.at === at);
  const dirs = [...new Set((L.loads || []).map(l => (l.acts.endsWith('x') ? 'x' : 'y')))];
  const xs = L.outline.map(p => p[0]), ys = L.outline.map(p => p[1]);
  const box = { x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) };
  // Diaphragms: the layout's own (book sub-diaphragms, Ex 3.3 / 3.4 / 4.2), else one per load direction: the whole
  // plan, spanning between the outermost wall lines across the span
  const diaphragmFor = (dir, i) => {
    const sAxis = dir === 'y' ? 'x' : 'y';
    const wallAt = (L.walls || []).filter(w => w.axis === sAxis).map(w => w.at);
    const lines = L.grids.filter(g => g.axis === sAxis && !g.ref).map(g => g.at);
    const pool = wallAt.length >= 2 ? wallAt : lines;
    const sup = [Math.min(...pool), Math.max(...pool)].map(at => gridOn(sAxis, at)).filter(Boolean).map(g => gridId(g.name));
    return { id: `dg-${book.id}-${i}`, mark: 'D1', dir, x1: s(box.x1), x2: s(box.x2), y1: s(box.y1), y2: s(box.y2), supports: sup, sheathing: '', blocked: null };
  };
  return {
    schemaVersion: TD_SCHEMA, codeEdition: 'CBC-2025', designBasis: 'ASD', pdfReport: 'summary', refs: {}, notes: '',
    level: { name: book.id, fx: '' },
    diaphragm: { sheathing: 'wsp', blocked: true },
    grids,
    outline: L.outline.map(([x, y]) => ({ x: s(x), y: s(y) })),
    openings: (L.openings || []).map((o, i) => ({ id: `op-${book.id}-${i}`, name: o.name || '', x1: s(o.x[0]), x2: s(o.x[1]), y1: s(o.y[0]), y2: s(o.y[1]) })),
    walls: (L.walls || []).map((w, i) => {
      const g = gridOn(w.axis, w.at);
      return { id: `wl-${book.id}-${i}`, line: s(w.line), mark: s(w.mark), gridId: g ? gridId(g.name) : '', from: s(w.from), to: s(w.to) };
    }),
    diaphragms: L.diaphragms
      ? L.diaphragms.map((d, i) => ({ id: `dg-${book.id}-${i}`, mark: d.mark, dir: d.dir || dirs[0] || 'y', x1: s(d.x[0]), x2: s(d.x[1]), y1: s(d.y[0]), y2: s(d.y[1]),
        supports: d.supports.map(gridId), sheathing: '', blocked: null, bandSplit: d.bandSplit || '' }))
      : dirs.map(diaphragmFor),
    tds: (L.tds || []).map((t, i) => ({
      id: `td-${book.id}-${i}`, mark: t.mark, dir: dirs[0] || 'y', x1: s(t.x[0]), x2: s(t.x[1]), y1: s(t.y[0]), y2: s(t.y[1]),
      supports: t.supports.map(gridId),
      loads: (t.loads || []).map(l => ({ gridId: gridId(l.grid), side: l.side })),
      overhang: t.overhang ? t.overhang.map(s) : null,
      engineer: { regionClear: null, cantileverOk: null, closureTol: '' },
    })),
    loads: (L.loads || []).map((l, i) => ({
      id: `ld-${book.id}-${i}`, acts: l.acts, mode: l.mode, psf: s(l.psf), edgeId: l.edge ? gridId(l.edge) : '',
      segments: (l.segments || []).map(g => ({ from: s(g.from), to: s(g.to), w: s(g.w), w2: s(g.w2) })),
    })),
    verification: {
      id: book.id, title: book.title, pdf: book.pdf, pages: book.pages, sheathedArea: book.sheathedArea,
      expected: book.expected, errata: book.errata || [], assumptions: book.assumptions || [],
    },
  };
}
