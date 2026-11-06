// Book example (tests/td-book/Ex*.json, FORMAT.md) → Transfer Diaphragm item inputs (tdMigrate.js shape).
// Names become ids; numbers become strings as typed in the form. `verification` carries the book values so the
// item's Verification tab can show them.
import { TD_SCHEMA } from '../../../src/modules/tdMigrate.js';
import { parsePlan, splitRegion } from '../../../src/modules/tdGeometry.js';

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
  // pieces of a diaphragm (schema 2): given (`parts`), else its rectangle cut to the sheathed plan at the depth changes
  const geo = parsePlan({ outline: L.outline.map(([x, y]) => ({ x: s(x), y: s(y) })), openings: (L.openings || []).map(o => ({ x1: o.x[0], x2: o.x[1], y1: o.y[0], y2: o.y[1] })) });
  const piecesOf = (id, dir, rect, given) => (given ? given.map(([x1, x2, y1, y2]) => ({ x1, x2, y1, y2 })) : splitRegion(geo, rect, dir === 'y' ? 'x' : 'y'))
    .map((q, i) => ({ id: id + '-p' + (i + 1), x1: s(q.x1), x2: s(q.x2), y1: s(q.y1), y2: s(q.y2) }));
  const box = { x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) };
  // Diaphragms: the layout's own (book sub-diaphragms, Ex 3.3 / 3.4 / 4.2), else one per load direction: the whole
  // plan, spanning between the outermost wall lines across the span
  const diaphragmFor = (dir, i) => {
    const sAxis = dir === 'y' ? 'x' : 'y';
    const wallAt = (L.walls || []).filter(w => w.axis === sAxis).map(w => w.at);
    const lines = L.grids.filter(g => g.axis === sAxis && !g.ref).map(g => g.at);
    const pool = wallAt.length >= 2 ? wallAt : lines;
    const sup = [Math.min(...pool), Math.max(...pool)].map(at => gridOn(sAxis, at)).filter(Boolean).map(g => gridId(g.name));
    const id = `dg-${book.id}-${i}`;
    return { id, mark: 'D1', dir, parts: piecesOf(id, dir, box), supports: sup, sheathing: '', blocked: null };
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
      ? L.diaphragms.map((d, i) => {
        const id = `dg-${book.id}-${i}`, dir = d.dir || dirs[0] || 'y';
        const rect = d.x ? { x1: d.x[0], x2: d.x[1], y1: d.y[0], y2: d.y[1] } : null;
        return { id, mark: d.mark, dir, parts: piecesOf(id, dir, rect, d.parts), supports: d.supports.map(gridId), sheathing: '', blocked: null, bandSplit: d.bandSplit || '', chordCut: d.chordCut || '' };
      })
      : dirs.map(diaphragmFor),
    tds: (L.tds || []).map((t, i) => ({
      id: `td-${book.id}-${i}`, mark: t.mark, dir: dirs[0] || 'y', x1: s(t.x[0]), x2: s(t.x[1]), y1: s(t.y[0]), y2: s(t.y[1]),
      supports: t.supports.map(gridId),
      loads: (t.loads || []).map(l => ({ gridId: gridId(l.grid), side: l.side })), loadsMode: 'auto',
      // overhangs by grid name [[support, tip]] (2026-11-04); a typed overhang [a, b] is kept as an item saved before would be
      ...(t.overhangs ? { overhangs: t.overhangs.map(([a, b]) => ({ fromId: gridId(a), toId: gridId(b), at: '' })) } : { overhang: t.overhang ? t.overhang.map(s) : null }),
      engineer: { regionClear: null, cantileverOk: null, closureTol: '' },
    })),
    loads: (L.loads || []).map((l, i) => ({
      id: `ld-${book.id}-${i}`, acts: l.acts, mode: l.mode, kind: l.kind || '', psf: s(l.psf), edgeId: l.edge ? gridId(l.edge) : '',
      segments: (l.segments || []).map(g => ({ from: s(g.from), to: s(g.to), w: s(g.w), w2: s(g.w2) })),
    })),
    verification: {
      id: book.id, title: book.title, pdf: book.pdf, pages: book.pages, sheathedArea: book.sheathedArea,
      expected: book.expected, errata: book.errata || [], assumptions: book.assumptions || [],
    },
  };
}
