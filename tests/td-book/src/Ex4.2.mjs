// EX-IRREG-2E Example 4.2: intermediate notch, longitudinal (x) load, walls in line, offset strut, paired TDs.
// Format: FORMAT.md. Unit shears use the "+" element drawn in Figs 4.8-4.12 (top face +x, right face +y). This is the
// mirror of the Ex 4.1 element, so a tool that reports in the Ex 4.1 convention must negate every unit shear here.
export default {
  id: 'Ex4.2',
  title: 'Intermediate notch, longitudinal load, offset strut shared by two TDs',
  pdf: 'The Analysis of Irregular Shaped Example 4.2.pdf',
  pages: '1-11',
  shearElement: 'mirrored',   // book '+' element is the mirror of Ex 4.1's; build converts unit shears
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
      { line: 'A', mark: 'SW1', axis: 'y', at: 50, from: 0, to: 15 },
      { line: 'A', mark: 'SW2', axis: 'y', at: 50, from: 42, to: 92 },
      { line: 'C', mark: 'SW3', axis: 'y', at: 0, from: 0, to: 8 },
      { line: 'C', mark: 'SW4', axis: 'y', at: 0, from: 50, to: 100 },
    ],
    tds: [
      { mark: 'TD1', x: [0, 15], y: [0, 50], supports: ['A', 'C'], loads: [{ grid: 'B', side: '+' }] },
      { mark: 'TD2', x: [35, 50], y: [0, 50], supports: ['A', 'C'], loads: [{ grid: 'B', side: '-' }] },
    ],
    // Seismic: 200 plf over A-B (40 ft); B-C has 130 of 150 ft of width, so 200(130/150) = 173.33 plf (p2-p3)
    loads: [{ acts: '+x', mode: 'line', segments: [{ from: 0, to: 10, w: 173.333 }, { from: 10, to: 50, w: 200 }] }],
  },
  expected: [
    // Phase 4: basic unit shears (p3-p4, Fig 4.8). Band 1-2: 20 plf, beam A-C. Band 2-3: 26.67 plf, beam A-B.
    // Band 3-5: 153.33 plf, beam A-C.
    { k: 'vb:A-:1-2', v: -33.33, unit: 'plf', page: 3, fig: '4.8', phase: 4, note: '500 lb / 15 ft' },
    { k: 'vb:B:1-2', v: 20, unit: 'plf', page: 3, phase: 4, note: 'V_B = 500 - 20(10) = 300 lb / 15 ft' },
    { k: 'vb:C+:1-2', v: 33.33, unit: 'plf', page: 3, fig: '4.8', phase: 4 },
    { k: 'vb:A-:2-3', v: -26.67, unit: 'plf', page: 3, fig: '4.8', phase: 4, note: '533.4 lb / 20 ft' },
    { k: 'vb:B+:2-3', v: 26.67, unit: 'plf', page: 3, fig: '4.8', phase: 4 },
    { k: 'vb:A-:3-5', v: -33.33, unit: 'plf', page: 4, fig: '4.8', phase: 4, note: '3833.3 lb / 115 ft' },
    { k: 'vb:B:3-5', v: 20, unit: 'plf', page: 6, phase: 4, note: 'not computed in the text; used in the p6 net-shear table (2300 lb / 115 ft)' },
    { k: 'vb:C+:3-5', v: 33.33, unit: 'plf', page: 4, fig: '4.8', phase: 4 },

    // Phase 4: line A reaction and line A walls (by length)
    { k: 'R:A', v: 4973.33, unit: 'lb', page: 7, phase: 4, note: 'book sums band reactions and TD reactions; equals whole-body statics' },
    { k: 'vw:SW1', v: 76.52, unit: 'plf', page: 7, phase: 4, note: 'R_A / (15 + 50)' },
    { k: 'vw:SW2', v: 76.52, unit: 'plf', page: 7, phase: 4 },

    // Phase 5: strut force on line B (band 2-3 edge reaction 533.4 lb, half to each TD, p5)
    { k: 'Nb:B:2', v: 266.7, unit: 'lb', sense: 'T', page: 5, fig: '4.9', phase: 5, note: 'strut pulls TD1' },
    { k: 'Nb:B:3', v: -266.7, unit: 'lb', sense: 'C', page: 5, fig: '4.9', phase: 5, note: 'strut pushes TD2' },

    // Phase 6: TD reactions and shears (p5, Fig 4.9). Both TDs are loaded toward +x; results identical.
    { k: 'tdR:TD1:A', v: 53.34, unit: 'lb', page: 5, fig: '4.9', phase: 6, note: 'reaction on TD at A acts to the left (-x); book V_A = -53.34' },
    { k: 'tdR:TD1:C', v: 213.36, unit: 'lb', page: 5, fig: '4.9', phase: 6, note: 'reaction on TD at C acts to the left (-x); book V_C = +213.36' },
    { k: 'vtd:TD1:A-B', v: -3.56, unit: 'plf', page: 5, fig: '4.9', phase: 6 },
    { k: 'vtd:TD1:B-C', v: 14.22, unit: 'plf', page: 5, fig: '4.9', phase: 6 },
    { k: 'tdR:TD2:A', v: 53.34, unit: 'lb', page: 5, fig: '4.9', phase: 6, note: 'reaction on TD at A acts to the left (-x)' },
    { k: 'tdR:TD2:C', v: 213.36, unit: 'lb', page: 5, fig: '4.9', phase: 6, note: 'reaction on TD at C acts to the left (-x)' },
    { k: 'vtd:TD2:A-B', v: -3.56, unit: 'plf', page: 5, fig: '4.9', phase: 6 },
    { k: 'vtd:TD2:B-C', v: 14.22, unit: 'plf', page: 5, fig: '4.9', phase: 6 },

    // Phase 6: net shears (p6 table, Fig 4.10)
    { k: 'vnet:A-:1-2', v: -36.89, unit: 'plf', page: 6, phase: 6 },
    { k: 'vnet:B+:1-2', v: 16.44, unit: 'plf', page: 6, phase: 6 },
    { k: 'vnet:B-:1-2', v: 34.22, unit: 'plf', page: 6, phase: 6 },
    { k: 'vnet:C+:1-2', v: 47.55, unit: 'plf', page: 6, phase: 6 },
    { k: 'vnet:A-:3-4', v: -36.89, unit: 'plf', page: 6, phase: 6 },
    { k: 'vnet:B+:3-4', v: 16.44, unit: 'plf', page: 6, phase: 6 },
    { k: 'vnet:B-:3-4', v: 34.22, unit: 'plf', page: 6, phase: 6 },
    { k: 'vnet:C+:3-4', v: 47.55, unit: 'plf', page: 6, phase: 6 },
    { k: 'vnet:A-:2-3', v: -26.67, unit: 'plf', page: 6, fig: '4.10', phase: 6 },
    { k: 'vnet:B+:2-3', v: 26.67, unit: 'plf', page: 6, fig: '4.10', phase: 6 },
    { k: 'vnet:A-:4-5', v: -33.33, unit: 'plf', page: 6, fig: '4.10', phase: 6 },
    { k: 'vnet:C+:4-5', v: 33.33, unit: 'plf', page: 6, fig: '4.10', phase: 6 },

    // Phase 6: line C walls (own band reaction + TD reaction at C, p7)
    { k: 'Rw:SW3', v: 713.36, unit: 'lb', page: 7, phase: 6, note: '500 + 213.34' },
    { k: 'vw:SW3', v: 89.17, unit: 'plf', page: 7, phase: 6 },
    { k: 'Rw:SW4', v: 4046.3, unit: 'lb', page: 7, phase: 6, note: '33.33(115) + 213.34' },
    { k: 'vw:SW4', v: 80.92, unit: 'plf', page: 7, phase: 6 },

    // Phase 6: line A (pp8-9, Fig 4.11)
    { k: 'N:A:2', v: 594.4, unit: 'lb', sense: 'T', page: 8, fig: '4.11', phase: 6 },
    { k: 'N:A:3', v: 61.1, unit: 'lb', sense: 'T', page: 8, fig: '4.11', phase: 6 },
    { k: 'N:A:x=42', v: -197.2, unit: 'lb', sense: 'C', page: 8, fig: '4.11', phase: 6, note: 'left end of SW2' },
    { k: 'N:A:4', v: 119.8, unit: 'lb', sense: 'T', page: 9, fig: '4.11', phase: 6 },
    { k: 'N:A:x=92', v: 1933.3, unit: 'lb', sense: 'T', page: 9, fig: '4.11', phase: 6, note: 'right end of SW2' },
    { k: 'N:A:5', v: 0, unit: 'lb', sense: '?', page: 9, fig: '4.11', phase: 6, tol: 1, note: 'diagram closes' },
    // line B
    { k: 'N:B:2', v: 266.7, unit: 'lb', sense: 'T', page: 9, fig: '4.11', phase: 6 },
    { k: 'N:B:3', v: -266.7, unit: 'lb', sense: 'C', page: 9, fig: '4.11', phase: 6 },
    { k: 'N:B:4', v: 0, unit: 'lb', sense: '?', page: 9, fig: '4.11', phase: 6, tol: 1, note: 'diagram closes' },
    // line C
    { k: 'N:C:x=8', v: 332.9, unit: 'lb', sense: 'T', page: 9, fig: '4.11', phase: 6, note: 'right end of SW3' },
    { k: 'N:C:2', v: 0, unit: 'lb', sense: '?', page: 9, fig: '4.11', phase: 6, tol: 1, note: 'diagram closes' },
    { k: 'N:C:4', v: -713.3, unit: 'lb', sense: 'C', page: 9, fig: '4.11', phase: 6 },
    { k: 'N:C:x=100', v: 1666.8, unit: 'lb', sense: 'T', page: 9, fig: '4.11', phase: 6, note: 'right end of SW4' },
    { k: 'N:C:5', v: 0, unit: 'lb', sense: '?', page: 10, fig: '4.11', phase: 6, tol: 1, note: 'diagram closes' },

    // Phase 6: transverse collectors and chord 1 (pp10-11, Fig 4.12); station side + = toward A
    { k: 'N:1:B+', v: -409, unit: 'lb', sense: 'C', page: 10, fig: '4.12', phase: 6, note: '+101.4 - 510.4' },
    { k: 'N:1:B-', v: -409, unit: 'lb', sense: 'C', page: 11, fig: '4.12', phase: 6 },
    { k: 'Nmax:1:A-B', v: -510.4, unit: 'lb', sense: 'C', page: 10, fig: '4.12', phase: 6,
      note: 'interior extremum where the shear difference changes sign, 27.67 ft below A' },
    { k: 'N:2:B+', v: 409, unit: 'lb', sense: 'T', page: 11, fig: '4.12', phase: 6 },
    { k: 'N:2:B-', v: 409, unit: 'lb', sense: 'T', page: 11, fig: '4.12', phase: 6 },
    { k: 'N:3:B+', v: -409, unit: 'lb', sense: 'C', page: 11, fig: '4.12', phase: 6, note: 'book: same as grid 2, in compression' },
    { k: 'N:3:B-', v: -409, unit: 'lb', sense: 'C', page: 11, fig: '4.12', phase: 6 },
    { k: 'N:4:B+', v: 142.4, unit: 'lb', sense: 'T', page: 11, fig: '4.12', phase: 6, tol: 0.5, note: 'Fig 4.12 prints 142.2' },
    { k: 'N:4:B-', v: 142.4, unit: 'lb', sense: 'T', page: 11, fig: '4.12', phase: 6, tol: 0.5 },
  ],
  errata: [
    { page: 7, what: 'SW3 net shear printed as 89.17 - 45.55 = 41.62.', use: 'diaphragm shear 47.55 plf; 41.62 plf is correct' },
    { page: 9, what: 'F2C chain starts from 322.9 lb.', use: '332.9 lb (force at the end of SW3); result 0 is correct' },
    { page: 10, what: 'Fig 4.12 labels the grid 3 collector force "F4B = 409 lb" and gives 142.2 lb at grid 4.', use: 'F3B = 409 lb C; F4B = 142.4 lb (p11 text)' },
  ],
  assumptions: [
    { what: 'Equal split between the paired TDs: the B-edge reaction of band 2-3 (533.4 lb) goes half to TD1 (pulled through the strut, tension at 2B) and half to TD2 (pushed, compression at 3B), 266.7 lb each.', why: 'Book assumption (p1, p5); an engineer input, not statics.' },
    { what: 'Load: 200 plf per ft of depth over A-B and 173.33 plf over B-C. At each depth the load is shared by the sheathed bands in proportion to width over the full 150 ft: band 1-2 20 plf, band 2-3 26.67 plf, band 3-5 153.33 plf (B-C: 20 and 153.33 only). Total 9733 lb.', why: 'Book p2-p3 gives section loads only; seismic load proportional to diaphragm width.' },
    { what: 'Line A walls share R_A in proportion to length (76.52 plf on SW1 and SW2). Line C walls each take their own band reaction plus the TD reaction at C (SW3 713.36 lb, SW4 4046.3 lb), not a length split.', why: 'Book p7. Line C is broken between 2 and 3, so each piece must close on its own.' },
    { what: 'Sign convention: the "+" element in this example (top face +x, bottom -x, left face -y, right face +y; "positive direction" arrow to the left) is the mirror of the Ex 4.1 element. Printed unit-shear signs already follow it, so no conversion is applied. Member forces are tension +.', why: 'FORMAT.md: book sign per the figure element. A tool using the Ex 4.1 element must negate every unit shear in this file.' },
    { what: 'Book section names A, B, C mean bands 1-2, 2-3, 3-5; keys here use grid names only.', why: 'Section names clash with grid names.' },
    { what: 'TD1 spans x 0-15 and TD2 x 35-50, both full depth A-C.', why: 'Shaded in Fig 4.8.' },
  ],
};
