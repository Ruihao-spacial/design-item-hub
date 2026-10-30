// EX-IRREG-2E Example 3.4: single outward offset, longitudinal (y) load, discontinuous strut at grid 1
// carried by a propped-cantilever TD (B-C, supports 2 and 3, overhang 1-2). Format: FORMAT.md.
export default {
  id: 'Ex3.4',
  title: 'Single offset, longitudinal load, strut carried by a propped-cantilever TD',
  pdf: 'The Analysis of Irregular Shaped Example 3.4.pdf',
  pages: '1-13',
  layout: {
    grids: [
      { name: '1', axis: 'x', at: 0 },
      { name: '2', axis: 'x', at: 15 },
      { name: '3', axis: 'x', at: 75 },
      { name: 'D', axis: 'y', at: 0 },
      { name: 'C', axis: 'y', at: 60 },
      { name: 'B', axis: 'y', at: 80 },
      { name: 'A', axis: 'y', at: 100 },
    ],
    outline: [[15, 0], [75, 0], [75, 100], [0, 100], [0, 60], [15, 60]],
    openings: [],
    walls: [
      { line: '2', mark: 'SW1', axis: 'x', at: 15, from: 40, to: 60 },
      { line: '2', mark: 'SW2', axis: 'x', at: 15, from: 0, to: 30 },
      { line: '3', mark: 'SW3', axis: 'x', at: 75, from: 30, to: 100 },
    ],
    // Book sub-diaphragms (p2-p4): upper A-C spans strut line 1 to wall line 3; lower C-D spans 2 to 3
    diaphragms: [
      { mark: 'D1', x: [0, 75], y: [60, 100], supports: ['1', '3'] },
      { mark: 'D2', x: [15, 75], y: [0, 60], supports: ['2', '3'] },
    ],
    tds: [
      { mark: 'TD1', x: [0, 75], y: [60, 80], supports: ['2', '3'], overhang: [0, 15],
        loads: [{ grid: '1', side: '+' }] },
    ],
    loads: [{ acts: '-y', mode: 'line', segments: [{ from: 0, to: 75, w: 200 }] }],
  },
  expected: [
    // Phase 4: wall-line reactions (p12, Fig 3.26 alternate check)
    { k: 'R:2', v: 9375, unit: 'lb', page: 12, fig: '3.26', phase: 4, note: 'book: TD 5775 + diaphragm C-D 3600' },
    { k: 'R:3', v: 5625, unit: 'lb', page: 11, fig: '3.26', phase: 4,
      note: 'figure check value; book route: 3180 (upper A-C) - 1155 (TD) + 3600 (C-D)' },
    { k: 'vw:SW1', v: 187.5, unit: 'plf', page: 12, phase: 4, note: '9375 / (20 + 30)' },
    { k: 'vw:SW2', v: 187.5, unit: 'plf', page: 12, phase: 4 },

    // Phase 4: basic unit shears. Book splits the plan into upper A-C (spans 1-3, 200 plf over 1-2, 80 plf over 2-3,
    // R1 = 4620, R3 = 3180) and lower C-D (spans 2-3, 120 plf, R = 3600 each end) (p5, Fig 3.23)
    { k: 'vb:1+:A-C', v: 115.5, unit: 'plf', page: 5, fig: '3.23', phase: 4, note: 'R1 = 4620 / 40; strut line 1 has no wall' },
    { k: 'vb:2:A-C', v: 40.5, unit: 'plf', page: 5, fig: '3.23', phase: 4, note: 'upper section shear V2 = 1620 lb / 40' },
    { k: 'vb:3-:A-C', v: -79.5, unit: 'plf', page: 5, fig: '3.23', phase: 4, note: 'R3(upper) = 3180 / 40' },
    { k: 'vb:2+:C-D', v: 60, unit: 'plf', page: 5, fig: '3.23', phase: 4, note: '3600 / 60' },
    { k: 'vb:3-:C-D', v: -60, unit: 'plf', page: 5, fig: '3.23', phase: 4 },

    // Phase 5: disrupted strut force on the basic field, line 1 at B (p12, Fig 3.26)
    { k: 'Nb:1:B', v: -2310, unit: 'lb', sense: 'C', page: 12, fig: '3.26', phase: 5,
      note: '115.5 x 20; the book loads the TD tip with the whole strut-line reaction R1 = 4620 lb' },

    // Phase 6: TD (propped cantilever, load 4620 lb at grid 1) (p5, Fig 3.23)
    { k: 'tdR:TD1:2', v: 5775, unit: 'lb', page: 5, fig: '3.23', phase: 6, note: 'on TD at 2 acts +y (against the load)' },
    { k: 'tdR:TD1:3', v: 1155, unit: 'lb', page: 5, fig: '3.23', phase: 6, note: 'on TD at 3 acts -y (same direction as the load; hold-down)' },
    { k: 'vtd:TD1:1-2', v: -231, unit: 'plf', page: 5, fig: '3.23', phase: 6, note: 'band along the TD span (x), overhang' },
    { k: 'vtd:TD1:2-3', v: 57.75, unit: 'plf', page: 5, fig: '3.23', phase: 6, note: 'back span' },

    // Phase 6: net shears (p8 table, p7 Fig 3.24)
    { k: 'vnet:1+:A-B', v: 115.5, unit: 'plf', page: 8, phase: 6, note: 'book prints +115.58, see errata' },
    { k: 'vnet:2:A-B', v: 40.5, unit: 'plf', page: 7, fig: '3.24', phase: 6 },
    { k: 'vnet:3-:A-B', v: -79.5, unit: 'plf', page: 8, phase: 6 },
    { k: 'vnet:1+:B-C', v: -115.5, unit: 'plf', page: 8, phase: 6 },
    { k: 'vnet:2-:B-C', v: -190.5, unit: 'plf', page: 8, phase: 6 },
    { k: 'vnet:2+:B-C', v: 98.25, unit: 'plf', page: 8, phase: 6 },
    { k: 'vnet:3-:B-C', v: -21.75, unit: 'plf', page: 8, phase: 6 },
    { k: 'vnet:2+:C-D', v: 60, unit: 'plf', page: 7, fig: '3.24', phase: 6 },
    { k: 'vnet:3-:C-D', v: -60, unit: 'plf', page: 7, fig: '3.24', phase: 6 },

    // Phase 6: chords along x (pp9-10, Fig 3.25)
    { k: 'N:A:2', v: -1170, unit: 'lb', sense: 'C', page: 9, fig: '3.25', phase: 6 },
    { k: 'Nmax:A:2-3', v: -1580, unit: 'lb', sense: 'C', page: 9, fig: '3.25', phase: 6,
      note: 'at 20.25 ft right of 2 (x = 35.25), where the shear crosses zero' },
    { k: 'N:A:3', v: 0, unit: 'lb', sense: '?', page: 9, phase: 6, note: 'diagram closes' },
    { k: 'N:B:2', v: 3465, unit: 'lb', sense: 'T', page: 9, fig: '3.25', phase: 6 },
    { k: 'N:B:3', v: 0, unit: 'lb', sense: '?', page: 10, phase: 6, note: 'diagram closes' },
    { k: 'N:C:2', v: -2295, unit: 'lb', sense: 'C', page: 10, fig: '3.25', phase: 6 },
    { k: 'N:C:3', v: 0, unit: 'lb', sense: '?', page: 10, phase: 6, note: 'diagram closes' },

    // Phase 6: struts/collectors along y (p12, Fig 3.26)
    { k: 'N:1:B', v: -2310, unit: 'lb', sense: 'C', page: 12, fig: '3.26', phase: 6 },
    { k: 'N:1:C', v: 0, unit: 'lb', sense: '?', page: 12, phase: 6, note: 'diagram closes' },
    { k: 'N:2:C', v: -5775, unit: 'lb', sense: 'C', page: 12, fig: '3.26', phase: 6, note: 'collector B-C into TD, summing from B' },
    { k: 'N:2:y=40', v: -3225, unit: 'lb', sense: 'C', page: 12, fig: '3.26', phase: 6, note: 'bottom end of SW1; net 127.5 plf along the walls' },
    { k: 'N:2:y=30', v: -3825, unit: 'lb', sense: 'C', page: 12, fig: '3.26', phase: 6, note: 'top end of SW2 (10 ft gap at -60 plf)' },
    { k: 'N:2:D', v: 0, unit: 'lb', sense: '?', page: 12, fig: '3.26', phase: 6, note: 'diagram closes' },
  ],
  errata: [
    { page: 5, what: 'TD back-span shear printed as 1115 / 20.', use: '1155 / 20 = 57.75 plf (result as printed)' },
    { page: 8, what: 'Net-shear table gives +115.58 plf for grid 1 A-B.', use: '+115.5 plf' },
    { page: 10, what: 'Line C chord forces are labelled F2B.', use: 'values are line C (2295 lb compression)' },
    { page: 12, what: 'Second "At the end of SW1" (F = -3825) is the top of SW2, 10 ft below SW1.', use: 'N:2:y=30' },
  ],
  assumptions: [
    { what: 'SW3 extent on line 3 taken as y = 30-100 (scaled from Fig 3.22).', why: 'Not dimensioned; only its line reaction is used and no value depends on the length.' },
    { what: 'SW1 at y = 40-60 and SW2 at y = 0-30 on line 2.', why: 'Fig 3.22 gives 20 ft and 30 ft and the 10 ft gap is used on p12.' },
    { what: 'TD1 load is the strut on line 1 entering at B from above (side +).', why: 'Book loads the cantilever tip with R1 = 4620 lb (whole strut line 1 A-C); the strut force at B is 2310 lb.' },
    { what: 'TD shear bands keyed by x-grids (1-2, 2-3).', why: 'In this TD the shear changes along the TD span, not across the depth.' },
    { what: 'No TD aspect ratio recorded.', why: 'Book does not state one (60/20 = 3.0 would be derived).' },
  ],
};
