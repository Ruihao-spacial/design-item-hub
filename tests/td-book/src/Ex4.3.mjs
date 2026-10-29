// EX-IRREG-2E Example 4.3: offset (skylight) at the end wall, strut on grid 1, transverse (y) load,
// two disrupted chords (B tension, C compression) entering one TD. Format: FORMAT.md.
export default {
  id: 'Ex4.3',
  title: 'Opening at end wall with strut, transverse load, two chords into one TD',
  pdf: 'The Analysis of Irregular Shaped Ch 4.6.pdf',
  pages: '1-9',
  layout: {
    grids: [
      { name: '1', axis: 'x', at: 0 },
      { name: '2', axis: 'x', at: 16 },
      { name: '3', axis: 'x', at: 31 },
      { name: 'CL', axis: 'x', at: 75, ref: true },
      { name: '4', axis: 'x', at: 150 },
      { name: 'D', axis: 'y', at: 0 },
      { name: 'C', axis: 'y', at: 16 },
      { name: 'B', axis: 'y', at: 34 },
      { name: 'A', axis: 'y', at: 56 },
    ],
    outline: [[0, 0], [150, 0], [150, 56], [0, 56]],
    openings: [{ name: 'skylight', x: [0, 16], y: [16, 34] }],
    walls: [
      { line: '1', mark: 'SW1', axis: 'x', at: 0, from: 44, to: 56 },
      { line: '1', mark: 'SW2', axis: 'x', at: 0, from: 0, to: 16 },
      { line: '4', mark: 'SW3', axis: 'x', at: 150, from: 0, to: 56 },
    ],
    tds: [
      { mark: 'TD1', x: [16, 31], y: [0, 56], supports: ['A', 'D'],
        loads: [{ grid: 'B', side: '-' }, { grid: 'C', side: '-' }] },
    ],
    // `edge` is a proposed extension (see assumptions): the grid line the load is applied on.
    loads: [
      { acts: '-y', mode: 'line', edge: 'A', segments: [{ from: 0, to: 16, w: 123 }, { from: 16, to: 150, w: 200 }] },
      { acts: '-y', mode: 'line', edge: 'D', segments: [{ from: 0, to: 16, w: 77 }] },
    ],
  },
  expected: [
    // Phase 4: reactions, wall forces, section shears, basic unit shears (pp2-3, p8, Fig 4.13)
    { k: 'R:1', v: 15000, unit: 'lb', page: 2, phase: 4 },
    { k: 'R:4', v: 15000, unit: 'lb', page: 2, phase: 4 },
    { k: 'Rw:SW1', v: 6428.6, unit: 'lb', page: 8, phase: 4, note: 'line 1 continuous via strut: split by wall length 12/28' },
    { k: 'Rw:SW2', v: 8571.4, unit: 'lb', page: 8, phase: 4, note: '16/28' },
    { k: 'vw:SW1', v: 535.7, unit: 'plf', page: 8, phase: 4 },
    { k: 'vw:SW2', v: 535.7, unit: 'plf', page: 8, phase: 4 },
    { k: 'vb:1+:A-B', v: 394.7, unit: 'plf', page: 2, fig: '4.13', phase: 4, note: '15000 / (22 + 16)' },
    { k: 'vb:1+:C-D', v: 394.7, unit: 'plf', page: 2, fig: '4.13', phase: 4 },
    { k: 'vb:2-:A-B', v: 305.3, unit: 'plf', page: 2, fig: '4.13', phase: 4 },
    { k: 'vb:2-:C-D', v: 317.8, unit: 'plf', page: 3, fig: '4.13', phase: 4 },
    { k: 'V:2+', v: 11800, unit: 'lb', page: 3, phase: 4 },
    { k: 'vb:2+:*', v: 210.7, unit: 'plf', page: 3, fig: '4.13', phase: 4 },
    { k: 'V:3', v: 8800, unit: 'lb', page: 3, phase: 4 },
    { k: 'vb:3:*', v: 157.14, unit: 'plf', page: 3, fig: '4.13', phase: 4, tol: 0.1,
      note: 'book prints 8800/56 = +167.9; exact 157.14 (erratum p3)' },
    { k: 'V:4', v: -15000, unit: 'lb', page: 3, phase: 4 },
    { k: 'vb:4-:*', v: -267.9, unit: 'plf', page: 3, fig: '4.13', phase: 4 },

    // Phase 5: disrupted chord forces on the basic field (book: M/d of sections A and B, p3)
    { k: 'Nb:B:2', v: 5600, unit: 'lb', sense: 'T', page: 3, phase: 5, note: 'exact 5600.2' },
    { k: 'Nb:C:2', v: -5700, unit: 'lb', sense: 'C', page: 3, phase: 5, note: 'exact 5699.8; p4: pushes on TD1' },

    // Phase 6: TD1 reactions and shears (pp4-5, Fig 4.14)
    { k: 'tdR:TD1:A', v: 1771.4, unit: 'lb', page: 4, fig: '4.14', phase: 6, note: 'reaction on TD at A acts to the right (+x); book V_A = -1771.4' },
    { k: 'tdR:TD1:D', v: 1871.4, unit: 'lb', page: 5, fig: '4.14', phase: 6, note: 'reaction on TD at D acts to the left (-x); book V_D = -1871.4' },
    { k: 'vtd:TD1:A-B', v: -118.1, unit: 'plf', page: 4, fig: '4.14', phase: 6 },
    { k: 'vtd:TD1:B-C', v: 255.24, unit: 'plf', page: 5, fig: '4.14', phase: 6 },
    { k: 'vtd:TD1:C-D', v: -124.76, unit: 'plf', page: 5, fig: '4.14', phase: 6, tol: 0.05,
      note: 'book computes -124.8 but uses 124.2 in the net-shear table (erratum p5)' },
    { k: 'aspect:TD1', v: 3.73, unit: '-', page: 2, phase: 6, tol: 0.01, note: '56/15, blocking required' },

    // Phase 6: net shears (p5 table, Fig 4.14)
    { k: 'vnet:1+:A-B', v: 394.7, unit: 'plf', page: 5, phase: 6 },
    { k: 'vnet:1+:C-D', v: 394.7, unit: 'plf', page: 5, phase: 6 },
    { k: 'vnet:2-:A-B', v: 305.3, unit: 'plf', page: 5, phase: 6 },
    { k: 'vnet:2-:C-D', v: 317.8, unit: 'plf', page: 5, phase: 6 },
    { k: 'vnet:2+:A-B', v: 92.6, unit: 'plf', page: 5, phase: 6 },
    { k: 'vnet:2+:B-C', v: 465.95, unit: 'plf', page: 5, phase: 6, tol: 0.1, note: 'book 465.9' },
    { k: 'vnet:2+:C-D', v: 85.95, unit: 'plf', page: 5, phase: 6, tol: 0.6, note: 'book 86.5 (uses 124.2, erratum p5)' },
    { k: 'vnet:3-:A-B', v: 39.05, unit: 'plf', page: 5, phase: 6, tol: 0.1, note: 'book 49.8 (uses vb 167.9, erratum p3)' },
    { k: 'vnet:3-:B-C', v: 412.38, unit: 'plf', page: 5, phase: 6, tol: 0.1, note: 'book 423.1 (erratum p3)' },
    { k: 'vnet:3-:C-D', v: 32.38, unit: 'plf', page: 5, phase: 6, tol: 0.1, note: 'book 43.7 (errata p3 and p5)' },
    { k: 'vnet:3+:*', v: 157.14, unit: 'plf', page: 4, fig: '4.14', phase: 6, tol: 0.1, note: 'book 167.9 (erratum p3)' },

    // Phase 6: longitudinal chords/struts B and C (pp5-7, Fig 4.15)
    { k: 'N:B:2', v: 5600, unit: 'lb', sense: 'T', page: 6, fig: '4.15', phase: 6 },
    { k: 'N:B:3', v: 0, unit: 'lb', sense: '?', page: 6, fig: '4.15', phase: 6, tol: 1, note: 'closes to zero; book labels this F2B' },
    { k: 'N:C:2', v: -5700, unit: 'lb', sense: 'C', page: 6, fig: '4.15', phase: 6, note: 'book prints "+5700 lb compression"' },
    { k: 'N:C:3', v: 0, unit: 'lb', sense: '?', page: 7, fig: '4.15', phase: 6, tol: 1, note: 'closes to zero' },

    // Phase 6: transverse strut on line 1 (p8, Fig 4.16); vw - vb = +141 plf along the walls, -394.7 plf on the 10 ft gap
    { k: 'N:1:y=44', v: 1691.7, unit: 'lb', sense: 'T', page: 8, fig: '4.16', phase: 6, tol: 1, note: 'end of SW1; book 141(12) = 1692' },
    { k: 'N:1:B', v: -2255.6, unit: 'lb', sense: 'C', page: 8, fig: '4.16', phase: 6, tol: 4, note: 'book -2252 (arithmetic slip, erratum p8)' },
    { k: 'N:1:C', v: -2255.6, unit: 'lb', sense: 'C', page: 8, fig: '4.16', phase: 6, tol: 4, note: 'constant B to C' },
    { k: 'N:1:D', v: 0, unit: 'lb', sense: '?', page: 8, fig: '4.16', phase: 6, tol: 4, note: 'closure; book -2252 + 141(16) = 0' },

    // Phase 6: transverse collectors on lines 2 and 3 (pp8-9, Fig 4.16)
    { k: 'N:2:B', v: 4678.6, unit: 'lb', sense: 'T', page: 8, fig: '4.16', phase: 6, tol: 1.5, note: 'book +4679.4' },
    { k: 'N:2:C+', v: -3708.6, unit: 'lb', sense: 'C', page: 9, fig: '4.16', phase: 6, tol: 2.5, note: 'from B side; book -3706.8' },
    { k: 'N:2:C-', v: -3708.6, unit: 'lb', sense: 'C', page: 7, fig: '4.16', phase: 6, tol: 9,
      note: 'from D side; figure label -3700 (carries erratum p5)' },
    { k: 'N:2:D', v: 0, unit: 'lb', sense: '?', page: 9, fig: '4.16', phase: 6, tol: 6.5, note: 'closure residual; book -6 (erratum p5)' },
    { k: 'N:3:B', v: -2598.1, unit: 'lb', sense: 'C', page: 9, fig: '4.16', phase: 6, tol: 1, note: 'book 2598.2 compression' },
    { k: 'N:3:C+', v: 1996.2, unit: 'lb', sense: 'T', page: 9, fig: '4.16', phase: 6, tol: 1, note: 'from B side; book +1995.4' },
    { k: 'N:3:C-', v: 1996.2, unit: 'lb', sense: 'T', page: 7, fig: '4.16', phase: 6, tol: 9.5,
      note: 'from D side; figure label 1987.2 (carries erratum p5)' },
    { k: 'N:3:D', v: 0, unit: 'lb', sense: '?', page: 9, fig: '4.16', phase: 6, tol: 8.5, note: 'closure residual; book "8.2 lb compression" (erratum p5)' },
  ],
  errata: [
    { page: 3, what: 'v3 = 8800/56 printed as +167.9 plf (value for grid 3 at 12 ft from grid 2, not 15 ft). Carried into Fig 4.13-4.16 and the grid-3 net shears on p5 (49.8, 423.1, 43.7). Member forces on line 3 do not depend on it.',
      use: 'vb at 3 = 157.14 plf; vnet 3- = 39.05 / 412.38 / 32.38 plf' },
    { page: 5, what: 'v_D computed as -124.8 plf but the net-shear table uses 124.2 (86.5, 43.7 plf). Causes the -6 lb and 8.2 lb closure residuals on p9 and the Fig 4.16 labels -3700 / 1987.2.',
      use: 'v_D = -124.76 plf; vnet 2+:C-D = 85.95 plf; closures = 0' },
    { page: 6, what: 'Strut force at grid 3B is labelled F2B.', use: 'N:B:3 = 0' },
    { page: 8, what: 'F1B = 1692 - 394.7(10) printed as -2252 lb; the arithmetic gives -2255.', use: 'N:1:B = -2255.6 lb (exact), tol 4' },
    { page: 9, what: 'F3D = +8.2 lb is called compression although positive.', use: 'N:3:D = 0, sense ?' },
  ],
  assumptions: [
    { what: 'Grid coordinates: 1 x=0, 2 x=16, 3 x=31, 4 x=150; D y=0, C y=16, B y=34, A y=56.', why: 'Fig 4.13 dims 16, 15, 150 (119 from 3 to 4) and 16 / 18 / 22 (12 + 10) across.' },
    { what: 'SW1 runs y=44..56 (12 ft from A); the 10 ft from SW1 to B and B-C on line 1 are strut only. SW2 is y=0..16. SW3 is full depth at grid 4.', why: 'Fig 4.13/4.16 and p8 (L = 12 and 16 ft).' },
    { what: 'Skylight x=0..16, y=16..34 modelled as an opening (no sheathing).', why: 'Text: skylight cannot transfer diaphragm shear; enclosing wall on line 1 B-C is not a shear wall.' },
    { what: 'Load over 1-2 is split 123 plf windward on edge A (section A) and 77 plf leeward on edge D (section B); 200 plf on edge A from 16 to 150. Encoded with a non-standard `edge` key on each load.',
      why: 'FORMAT.md line loads have no application line; without it the 1-2 load cannot be assigned to sections A and B (V2 = 6716 / 5084). Proposed extension: optional `edge: <grid>` (or `band`) on a line load.' },
    { what: 'Book section shears V2 = 6716 lb (section A) and 5084 lb (section B) are not recorded as keys; vb:2-:A-B and vb:2-:C-D carry them.', why: 'FORMAT.md V: takes one part (full depth); a band suffix would be needed.' },
    { what: 'Line 2/3 collector forces have no jump at B or C (chords act in x); C+/C- give the value approached from B and from D.', why: 'Book computes C from above (p9) and the figure labels it from below (Fig 4.16).' },
  ],
};
