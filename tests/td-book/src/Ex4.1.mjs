// EX-IRREG-2E Example 4.1: intermediate notch left of centerline, transverse (y) load. Format: FORMAT.md.
export default {
  id: 'Ex4.1',
  title: 'Intermediate notch left of centerline, transverse load, two TDs',
  pdf: 'The Analysis of Irregular Shaped Ch 4.1.pdf',
  pages: '2-11',
  layout: {
    grids: [
      { name: '1', axis: 'x', at: 0 },
      { name: '2', axis: 'x', at: 15 },
      { name: '3', axis: 'x', at: 35 },
      { name: '4', axis: 'x', at: 50 },
      { name: 'CL', axis: 'x', at: 75, ref: true },
      { name: '5', axis: 'x', at: 150 },
      { name: 'C', axis: 'y', at: 0 },
      { name: 'B', axis: 'y', at: 10 },
      { name: 'A', axis: 'y', at: 50 },
    ],
    outline: [[0, 0], [15, 0], [15, 10], [35, 10], [35, 0], [150, 0], [150, 50], [0, 50]],
    openings: [],
    walls: [
      { line: '1', mark: 'SW1', axis: 'x', at: 0, from: 0, to: 50 },
      { line: '5', mark: 'SW5', axis: 'x', at: 150, from: 0, to: 50 },
    ],
    tds: [
      { mark: 'TD1', x: [0, 15], y: [0, 50], supports: ['A', 'C'], loads: [{ grid: 'B', side: '+' }] },
      { mark: 'TD2', x: [35, 50], y: [0, 50], supports: ['A', 'C'], loads: [{ grid: 'B', side: '-' }] },
    ],
    loads: [{ acts: '-y', mode: 'line', segments: [{ from: 0, to: 150, w: 200 }] }],
  },
  expected: [
    // Phase 4: reactions, section shears, basic unit shears (p4, Fig 4.1)
    { k: 'R:1', v: 15000, unit: 'lb', page: 4, phase: 4 },
    { k: 'R:5', v: 15000, unit: 'lb', page: 4, phase: 4 },
    { k: 'V:2', v: 12000, unit: 'lb', page: 4, phase: 4 },
    { k: 'V:3', v: 8000, unit: 'lb', page: 4, phase: 4 },
    { k: 'V:4', v: 5000, unit: 'lb', page: 4, phase: 4 },
    { k: 'vb:1+:*', v: 300, unit: 'plf', page: 4, fig: '4.1', phase: 4 },
    { k: 'vb:2-:*', v: 240, unit: 'plf', page: 4, fig: '4.1', phase: 4 },
    { k: 'vb:2+:A-B', v: 300, unit: 'plf', page: 4, fig: '4.1', phase: 4 },
    { k: 'vb:3-:A-B', v: 200, unit: 'plf', page: 4, fig: '4.1', phase: 4 },
    { k: 'vb:3+:*', v: 160, unit: 'plf', page: 4, fig: '4.1', phase: 4 },
    { k: 'vb:4:*', v: 100, unit: 'plf', page: 4, fig: '4.1', phase: 4 },

    // Phase 5: disrupted chord forces on the basic field (book: M/d, p4)
    { k: 'Nb:B:2', v: 5062.5, unit: 'lb', sense: 'T', page: 4, phase: 5, note: 'book F2B = M2B / 40' },
    { k: 'Nb:B:3', v: 10062.5, unit: 'lb', sense: 'T', page: 4, phase: 5, note: 'book F3B = M3B / 40' },

    // Phase 6: TD forces and shears (pp5-7, Fig 4.2)
    { k: 'tdR:TD1:A', v: 1012.5, unit: 'lb', page: 5, fig: '4.2', phase: 6, note: 'reaction on TD at A acts to the left (-x)' },
    { k: 'tdR:TD1:C', v: 4050, unit: 'lb', page: 6, fig: '4.2', phase: 6, note: 'reaction on TD at C acts to the left (-x)' },
    { k: 'vtd:TD1:A-B', v: 67.5, unit: 'plf', page: 5, fig: '4.2', phase: 6 },
    { k: 'vtd:TD1:B-C', v: -270, unit: 'plf', page: 6, fig: '4.2', phase: 6 },
    { k: 'tdR:TD2:A', v: 2012.5, unit: 'lb', page: 5, fig: '4.2', phase: 6, note: 'reaction on TD at A acts to the right (+x)' },
    { k: 'tdR:TD2:C', v: 8050, unit: 'lb', page: 7, fig: '4.2', phase: 6, note: 'reaction on TD at C acts to the right (+x)' },
    { k: 'vtd:TD2:A-B', v: -134.2, unit: 'plf', page: 7, fig: '4.2', phase: 6 },
    { k: 'vtd:TD2:B-C', v: 536.7, unit: 'plf', page: 7, fig: '4.2', phase: 6 },
    { k: 'aspect:TD1', v: 3.33, unit: '-', page: 3, phase: 6, tol: 0.01, note: '50/15, blocking required' },
    { k: 'aspect:TD2', v: 3.33, unit: '-', page: 3, phase: 6, tol: 0.01 },

    // Phase 6: net shears (p6 TD1 table, p7 TD2 table)
    { k: 'vnet:1+:A-B', v: 367.5, unit: 'plf', page: 6, phase: 6 },
    { k: 'vnet:2-:A-B', v: 307.5, unit: 'plf', page: 6, phase: 6 },
    { k: 'vnet:2+:A-B', v: 300, unit: 'plf', page: 6, phase: 6 },
    { k: 'vnet:1+:B-C', v: 30, unit: 'plf', page: 6, phase: 6 },
    { k: 'vnet:2-:B-C', v: -30, unit: 'plf', page: 6, phase: 6 },
    { k: 'vnet:3+:A-B', v: 25.8, unit: 'plf', page: 7, phase: 6 },
    { k: 'vnet:3-:A-B', v: 200, unit: 'plf', page: 7, phase: 6 },
    { k: 'vnet:3+:B-C', v: 696.7, unit: 'plf', page: 7, phase: 6 },
    { k: 'vnet:4-:A-B', v: -34.2, unit: 'plf', page: 7, phase: 6 },
    { k: 'vnet:4-:B-C', v: 636.7, unit: 'plf', page: 7, phase: 6 },
    { k: 'vnet:4+:*', v: 100, unit: 'plf', page: 7, phase: 6 },

    // Phase 6: longitudinal members, line B (pp8-9, Fig 4.3)
    { k: 'N:B:2', v: 5062.5, unit: 'lb', sense: 'T', page: 8, fig: '4.3', phase: 6 },
    { k: 'N:B:3', v: 10062.5, unit: 'lb', sense: 'T', page: 8, fig: '4.3', phase: 6, tol: 1.5,
      note: 'from the right of grid 3 the book gets 10,063.5 (rounded net shears); the diagram closes' },
    { k: 'N:B:4', v: 0, unit: 'lb', sense: '?', page: 9, fig: '4.3', phase: 6, tol: 1.5, note: 'diagram closes to zero' },
    // line A (p9)
    { k: 'N:A:2', v: -5062.5, unit: 'lb', sense: 'C', page: 9, fig: '4.3', phase: 6 },
    { k: 'N:A:3', v: -10062.5, unit: 'lb', sense: 'C', page: 9, fig: '4.3', phase: 6 },
    { k: 'N:A:4', v: -10000, unit: 'lb', sense: 'C', page: 9, fig: '4.3', phase: 6, tol: 1.5,
      note: 'similar triangles in 3-4: +83.2 / -146.2 lb' },
    { k: 'N:A:CL', v: -11250, unit: 'lb', sense: 'C', page: 9, fig: '4.3', phase: 6 },
    // line C (p9)
    { k: 'Nmax:C:1-2', v: 112.5, unit: 'lb', sense: '?', page: 8, fig: '4.3', phase: 6,
      note: 'triangles +30 / -30 plf over 1-2; book gives the magnitude only' },
    { k: 'N:C:4', v: 10000, unit: 'lb', sense: 'T', page: 9, fig: '4.3', phase: 6, tol: 1.5 },
    { k: 'N:C:CL', v: 11250, unit: 'lb', sense: 'T', page: 9, fig: '4.3', phase: 6 },

    // Phase 6: transverse collectors (pp10-11, Fig 4.4); station side + = toward A
    { k: 'N:2:B+', v: 300, unit: 'lb', sense: 'T', page: 10, fig: '4.4', phase: 6 },
    { k: 'N:2:B-', v: 300, unit: 'lb', sense: 'T', page: 10, fig: '4.4', phase: 6 },
    { k: 'N:3:B+', v: 6968, unit: 'lb', sense: 'T', page: 11, fig: '4.4', phase: 6, tol: 2 },
    { k: 'N:3:B-', v: 6967, unit: 'lb', sense: 'T', page: 11, fig: '4.4', phase: 6, tol: 2 },
    { k: 'N:4:B+', v: -5368, unit: 'lb', sense: 'C', page: 11, fig: '4.4', phase: 6, tol: 2 },
    { k: 'N:4:B-', v: -5367, unit: 'lb', sense: 'C', page: 11, fig: '4.4', phase: 6, tol: 2 },
  ],
  errata: [
    { page: 6, what: 'The second net-shear table (right TD) repeats the left-TD table.', use: 'TD2 net shears from the p7 table' },
  ],
  assumptions: [
    { what: 'Shear wall at grid 5 is full depth (0-50 ft) at x = 150.', why: 'Text: walls at grid lines 1 and 5 only; grid 5 is outside the figure. R5 = wL/2 needs only that it supports the end.' },
  ],
};
