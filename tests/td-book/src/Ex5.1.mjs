// EX-IRREG-2E Example 5.1: single opening offset in both directions, Vierendeel elements, two TDs with two
// disrupted members each, wind split windward/leeward across the opening. Format: FORMAT.md.
export default {
  id: 'Ex5.1',
  title: 'Offset opening, Vierendeel elements, TD each side, split wind at the opening',
  pdf: 'The Analysis of Irregular Shaped Ch 5.1 Example 5.1.pdf',
  pages: '8-21',
  layout: {
    grids: [
      { name: '1', axis: 'x', at: 0 },
      { name: '2', axis: 'x', at: 15 },
      { name: '3', axis: 'x', at: 27 },
      { name: '4', axis: 'x', at: 39 },
      { name: '5', axis: 'x', at: 54 },
      { name: 'CL', axis: 'x', at: 80, ref: true },
      { name: '6', axis: 'x', at: 160 },
      { name: 'D', axis: 'y', at: 0 },
      { name: 'C', axis: 'y', at: 16 },
      { name: 'B', axis: 'y', at: 40 },
      { name: 'A', axis: 'y', at: 50 },
    ],
    outline: [[0, 0], [160, 0], [160, 50], [0, 50]],
    openings: [{ name: 'OP1', x: [15, 39], y: [16, 40] }],
    walls: [
      { line: '1', mark: 'SW1', axis: 'x', at: 0, from: 0, to: 50 },
      { line: '6', mark: 'SW2', axis: 'x', at: 160, from: 0, to: 50 },
    ],
    // Whole plan. Opening between TD1 and TD2: inflection at grid 3, width split at grid 4 (auto rule, p8-p9)
    diaphragms: [{ mark: 'D1', x: [0, 160], y: [0, 50], supports: ['1', '6'] }],
    tds: [
      { mark: 'TD1', x: [0, 15], y: [0, 50], supports: ['A', 'D'],
        loads: [{ grid: 'B', side: '+' }, { grid: 'C', side: '+' }] },
      { mark: 'TD2', x: [39, 54], y: [0, 50], supports: ['A', 'D'],
        loads: [{ grid: 'B', side: '-' }, { grid: 'C', side: '-' }] },
    ],
    // Fig 5.5 (p8), text p15. Load 1 is applied along chord A; load 2 (leeward strip over the opening) along chord D.
    // The format has no field for the edge a line load acts on; see assumptions.
    loads: [
      { acts: '-y', mode: 'line', edge: 'A', segments: [
        { from: 0, to: 15, w: 200 },
        { from: 15, to: 39, w: 123 },
        { from: 39, to: 160, w: 200 },
      ] },
      { acts: '-y', mode: 'line', edge: 'D', segments: [{ from: 15, to: 39, w: 77 }] },
    ],
  },
  expected: [
    // Phase 4: reactions, section shears (p15, Fig 5.5 p8)
    { k: 'R:1', v: 16000, unit: 'lb', page: 15, phase: 4 },
    { k: 'R:6', v: 16000, unit: 'lb', page: 15, phase: 4 },
    { k: 'V:2', v: 13000, unit: 'lb', page: 15, phase: 4 },
    { k: 'V:3', v: 10600, unit: 'lb', page: 15, phase: 4 },
    { k: 'V:4', v: 8200, unit: 'lb', page: 15, phase: 4 },
    // basic unit shears, full depth (p15-16, Fig 5.5)
    { k: 'vb:1+:*', v: 320, unit: 'plf', page: 15, fig: '5.5', phase: 4 },
    { k: 'vb:2-:*', v: 260, unit: 'plf', page: 15, fig: '5.5', phase: 4 },
    { k: 'vb:4+:*', v: 164, unit: 'plf', page: 15, fig: '5.5', phase: 4 },
    { k: 'vb:5:*', v: 104, unit: 'plf', page: 16, fig: '5.5', phase: 4 },
    // basic unit shears in the elements above (A-B) and below (C-D) the opening (pp16-17, Fig 5.8)
    { k: 'vb:4-:A-B', v: 315.4, unit: 'plf', page: 16, fig: '5.8', phase: 4, note: 'V4 split to the bands by width: 3153.8 lb / 10' },
    { k: 'vb:4-:C-D', v: 315.4, unit: 'plf', page: 16, fig: '5.8', phase: 4, note: '5046.2 lb / 16' },
    { k: 'vb:3:A-B', v: 463, unit: 'plf', page: 16, fig: '5.8', phase: 4, note: 'element I/II, 4629.8 lb / 10 (load 123 plf in the band)' },
    { k: 'vb:3:C-D', v: 373.1, unit: 'plf', page: 17, fig: '5.8', phase: 4, note: 'element III/IV, 5970.2 lb / 16 (load 77 plf in the band)' },
    { k: 'vb:2+:A-B', v: 610.6, unit: 'plf', page: 17, fig: '5.8', phase: 4, note: '6105.8 lb / 10; the averaged Fig 5.5 value 500 plf is superseded' },
    { k: 'vb:2+:C-D', v: 430.9, unit: 'plf', page: 17, fig: '5.8', phase: 4, note: '6894.2 lb / 16' },

    // Phase 5: chord forces on the basic field (with opening), Vierendeel element statics (pp16-17, Fig 5.8)
    { k: 'Nb:A:3', v: -7182, unit: 'lb', sense: 'C', page: 16, fig: '5.8', phase: 5, note: 'book F3 = M3 / 50, inflection point at grid 3' },
    { k: 'Nb:D:3', v: 7182, unit: 'lb', sense: 'T', page: 16, fig: '5.8', phase: 5 },
    { k: 'Nb:A:4', v: -11852, unit: 'lb', sense: 'C', page: 16, fig: '5.8', phase: 5, tol: 1 },
    { k: 'Nb:B:4', v: 4670.1, unit: 'lb', sense: 'T', page: 16, fig: '5.8', phase: 5, note: 'disrupted chord into TD2' },
    { k: 'Nb:C:4', v: -4131.2, unit: 'lb', sense: 'C', page: 17, fig: '5.8', phase: 5, note: 'disrupted chord into TD2' },
    { k: 'Nb:D:4', v: 11313, unit: 'lb', sense: 'T', page: 17, fig: '5.8', phase: 5, tol: 1 },
    { k: 'Nb:A:2', v: -740.6, unit: 'lb', sense: 'C', page: 17, fig: '5.8', phase: 5, note: 'book prints -740.6 (opposite to its assumed direction); Fig 5.8 / 5.11 give 740.6' },
    { k: 'Nb:B:2', v: -6441.4, unit: 'lb', sense: 'C', page: 17, fig: '5.8', phase: 5, note: 'disrupted chord into TD1' },
    { k: 'Nb:C:2', v: 4824.2, unit: 'lb', sense: 'T', page: 17, fig: '5.8', phase: 5, note: 'disrupted chord into TD1' },
    { k: 'Nb:D:2', v: 2357.8, unit: 'lb', sense: 'T', page: 17, fig: '5.8', phase: 5 },

    // Phase 6: TD1 (p18, Fig 5.9 p12)
    { k: 'tdR:TD1:A', v: 3609.4, unit: 'lb', page: 18, fig: '5.9', phase: 6, note: 'force on TD at A acts to the right (+x)' },
    { k: 'tdR:TD1:D', v: 1992.2, unit: 'lb', page: 18, fig: '5.9', phase: 6, note: 'force on TD at D acts to the left (-x); see errata' },
    { k: 'vtd:TD1:A-B', v: -240.6, unit: 'plf', page: 18, fig: '5.9', phase: 6 },
    { k: 'vtd:TD1:B-C', v: 188.8, unit: 'plf', page: 18, fig: '5.9', phase: 6 },
    { k: 'vtd:TD1:C-D', v: -132.8, unit: 'plf', page: 18, fig: '5.9', phase: 6 },
    // TD2 (p19, Fig 5.10 p13)
    { k: 'tdR:TD2:A', v: 2414.1, unit: 'lb', page: 19, fig: '5.10', phase: 6, note: 'force on TD at A acts to the right (+x)' },
    { k: 'tdR:TD2:D', v: 1875.2, unit: 'lb', page: 19, fig: '5.10', phase: 6, note: 'force on TD at D acts to the left (-x)' },
    { k: 'vtd:TD2:A-B', v: -160.9, unit: 'plf', page: 19, fig: '5.10', phase: 6, note: 'printed unsigned; text and figure say negative' },
    { k: 'vtd:TD2:B-C', v: 150.4, unit: 'plf', page: 19, fig: '5.10', phase: 6 },
    { k: 'vtd:TD2:C-D', v: -125, unit: 'plf', page: 19, fig: '5.10', phase: 6, note: 'printed unsigned as v_A; text and figure say negative' },
    { k: 'aspect:TD1', v: 3.33, unit: '-', page: 21, phase: 6, tol: 0.01, note: '50/15, blocking required (also stated p15)' },
    { k: 'aspect:TD2', v: 3.33, unit: '-', page: 21, phase: 6, tol: 0.01 },

    // Phase 6: net shears, TD1 (p18 table)
    { k: 'vnet:1+:A-B', v: 79.4, unit: 'plf', page: 18, phase: 6 },
    { k: 'vnet:1+:B-C', v: 508.8, unit: 'plf', page: 18, phase: 6 },
    { k: 'vnet:1+:C-D', v: 187.2, unit: 'plf', page: 18, phase: 6 },
    { k: 'vnet:2-:A-B', v: 19.4, unit: 'plf', page: 18, phase: 6 },
    { k: 'vnet:2-:B-C', v: 448.8, unit: 'plf', page: 18, phase: 6 },
    { k: 'vnet:2-:C-D', v: 127.2, unit: 'plf', page: 18, phase: 6 },
    // TD2 (p19 table)
    { k: 'vnet:4+:A-B', v: 3.1, unit: 'plf', page: 19, phase: 6 },
    { k: 'vnet:4+:B-C', v: 314.4, unit: 'plf', page: 19, phase: 6 },
    { k: 'vnet:4+:C-D', v: 39, unit: 'plf', page: 19, phase: 6 },
    { k: 'vnet:5-:A-B', v: -56.9, unit: 'plf', page: 19, phase: 6 },
    { k: 'vnet:5-:B-C', v: 254.4, unit: 'plf', page: 19, phase: 6 },
    { k: 'vnet:5-:C-D', v: -21, unit: 'plf', page: 19, phase: 6 },

    // Phase 6: transverse collectors, summed from D (pp19-20, Figs 5.9-5.10)
    { k: 'N:2:C', v: 4859.2, unit: 'lb', sense: 'T', page: 19, fig: '5.9', phase: 6 },
    { k: 'N:2:B', v: -5912, unit: 'lb', sense: 'C', page: 19, fig: '5.9', phase: 6 },
    { k: 'N:2:A', v: 0, unit: 'lb', sense: '?', page: 19, fig: '5.9', phase: 6, tol: 6, note: 'closes; book uses 610 for 610.6 and still writes 0' },
    { k: 'N:4:C', v: -4422.4, unit: 'lb', sense: '?', page: 20, fig: '5.10', phase: 6, note: 'book magnitude, no T/C word; sign by statics (C), plotted on the opposite side to Fig 5.9 grid-2 T' },
    { k: 'N:4:B', v: 3123.2, unit: 'lb', sense: '?', page: 20, fig: '5.10', phase: 6, note: 'book prints -3123.2 (its own running sign); statics gives T' },
    { k: 'N:4:A', v: 0, unit: 'lb', sense: '?', page: 20, fig: '5.10', phase: 6, tol: 1.5 },
    { k: 'N:5:C', v: 2000, unit: 'lb', sense: '?', page: 20, fig: '5.10', phase: 6, note: 'statics gives T' },
    { k: 'N:5:B', v: -1609.6, unit: 'lb', sense: '?', page: 20, fig: '5.10', phase: 6, note: 'book prints +1609.6; statics gives C' },
    { k: 'N:5:A', v: 0, unit: 'lb', sense: '?', page: 20, fig: '5.10', phase: 6, tol: 1.5 },

    // Phase 6: longitudinal collectors B and C, summed from grid 1 (p20, Fig 5.11 p14)
    { k: 'N:B:2', v: -6441.4, unit: 'lb', sense: 'C', page: 20, fig: '5.11', phase: 6, tol: 1, note: 'book 6441; sense from element II (Fig 5.8)' },
    { k: 'N:B:3', v: 0, unit: 'lb', sense: '?', page: 20, fig: '5.11', phase: 6, tol: 1.5, note: 'inflection point' },
    { k: 'N:B:4', v: 4670.1, unit: 'lb', sense: 'T', page: 20, fig: '5.11', phase: 6, tol: 1, note: 'table 4670.4 (rounded shears), element value 4670.1, Fig 5.11 misprints 4760.4' },
    { k: 'N:B:5', v: 0, unit: 'lb', sense: '?', page: 20, fig: '5.11', phase: 6, tol: 1.5, note: 'diagram closes' },
    { k: 'N:C:2', v: 4824.2, unit: 'lb', sense: 'T', page: 20, fig: '5.11', phase: 6, tol: 1, note: 'book 4824' },
    { k: 'N:C:3', v: 0, unit: 'lb', sense: '?', page: 20, fig: '5.11', phase: 6, tol: 1.5, note: 'inflection point' },
    { k: 'N:C:4', v: -4131.2, unit: 'lb', sense: 'C', page: 20, fig: '5.11', phase: 6, tol: 1, note: 'book -4131' },
    { k: 'N:C:5', v: 0, unit: 'lb', sense: '?', page: 20, fig: '5.11', phase: 6, tol: 1.5, note: 'diagram closes' },
    // chords A and D, summed from grid 1 (p21, Fig 5.11)
    { k: 'N:A:2', v: -740.6, unit: 'lb', sense: 'C', page: 21, fig: '5.11', phase: 6 },
    { k: 'N:A:3', v: -7182.2, unit: 'lb', sense: 'C', page: 21, fig: '5.11', phase: 6 },
    { k: 'N:A:4', v: -11852.6, unit: 'lb', sense: 'C', page: 21, fig: '5.11', phase: 6 },
    { k: 'N:A:5', v: -11449, unit: 'lb', sense: 'C', page: 21, fig: '5.11', phase: 6, tol: 1.5,
      note: 'triangles +1.2 / -404.8 in 4-5; equals the no-opening value M5/50 = 11,448' },
    { k: 'N:D:2', v: 2357.8, unit: 'lb', sense: 'T', page: 21, fig: '5.11', phase: 6, tol: 1, note: 'book 2358' },
    { k: 'N:D:4', v: 11313, unit: 'lb', sense: 'T', page: 21, fig: '5.11', phase: 6, tol: 1 },
    { k: 'N:D:5', v: 11448, unit: 'lb', sense: 'T', page: 21, fig: '5.11', phase: 6, tol: 1.5, note: 'see errata: book 11,433 then 11,448' },
  ],
  errata: [
    { page: 11, what: 'Fig 5.8 labels the shear sums at grids 3 and 4 as "ΣV2".', use: 'V:3 = 10,600 and V:4 = 8,200 lb' },
    { page: 17, what: 'F4D written as 7182 + 4031.2; the element III chord force is 4131.2.', use: 'Nb:D:4 = 11,313 lb (the printed result is right)' },
    { page: 17, what: 'Element IV unit shear at grid 2 is labelled v3CD.', use: 'value 430.9 plf as vb:2+:C-D' },
    { page: 18, what: 'TD1 V_D is printed with the multiplier 1/16; the result -1992.2 corresponds to 1/50 (TD span).', use: 'tdR:TD1:D = 1992.2 lb' },
    { page: 19, what: 'TD2 unit shears printed unsigned (160.9, 125) and the D-side value is labelled v_A.', use: 'vtd:TD2:A-B = -160.9, vtd:TD2:C-D = -125 (text and Fig 5.10 say negative)' },
    { page: 19, what: 'Grid-2 collector closure uses 610 instead of 610.6 (sum is -6 lb, written as 0).', use: 'N:2:A = 0' },
    { page: 20, what: 'Grid-4 and grid-5 collector tables are labelled F2C/F2B/F2A, carry no T/C, and their signs do not follow one convention (grid 4 B printed negative, grid 5 B positive).', use: 'magnitudes from the book; signs by statics with the same convention that gives the book-labelled grid-2 T/C' },
    { page: 20, what: 'Longitudinal B table prints F2B = +6441 then F3B = -6441 + ...; sign flips between rows.', use: 'B at 2 compression, B at 4 tension (element senses, Fig 5.8)' },
    { page: 14, what: 'Fig 5.11 shows F = 4760.4 lb at B4 (text 4670.4, element 4670.1), "-23" for the -21 plf net shear at D in 4-5, and +184 / -64 for the D-chord triangles in 4-5.', use: 'N:B:4 = 4670.1; vnet:5-:C-D = -21' },
    { page: 21, what: 'F5D = 11,313 + 184 - 64 = 11,433, then "≅ 11,448". Integrating 39 to -21 plf over 15 ft gives +190.1 / -55.1, i.e. 11,448, which is also M5/50 for the field without opening.', use: 'N:D:5 = 11,448 lb' },
  ],
  assumptions: [
    { what: 'Load 1 (200 / 123 / 200 plf) acts along chord A (y = 50); load 2 (77 plf, x = 15-39) acts along chord D (y = 0). Both point -y.', why: 'Fig 5.5 draws the 123 plf windward strip on line A and the 77 plf leeward strip on line D. The element statics (pp16-17) need the strip to be on its own element; the format cannot say which edge a line load acts on.' },
    { what: 'Grid 3 (x = 27) is the inflection point at mid-length of the opening; F3B = F3C = 0, and V4 is split between the bands above and below the opening by sheathed width.', why: 'Book method (pp6-9, p16); the tool must use the same split to reach the element values.' },
    { what: 'The averaged basic unit shear at 2R (V2 / 26 = +500 plf, p15, Fig 5.5) is not recorded as an expected value.', why: 'The book itself replaces it with the element values 610.6 / 430.9 plf (p17); no band key fits a depth-averaged value.' },
    { what: 'SW2 at grid 6 (x = 160) is full depth 0-50 ft.', why: 'Fig 5.5 shows SW2 along the right end; R6 = wL/2 only needs it to support the end.' },
    { what: 'Fig 5.11 has a leader "F = 4677 lb" on line B inside TD2 that matches no computed value (the B force in TD2 falls linearly from 4670 at grid 4 to 0 at grid 5).', why: 'Unexplained figure label; not used.' },
  ],
};
