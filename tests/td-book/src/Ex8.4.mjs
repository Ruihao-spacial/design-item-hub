// EX-IRREG-2E Section 8.4: the Ex 8.1 building (Section 8.3) loaded in the longitudinal (E-W) direction, seismic.
// Segmented as the book does (Fig 8.21): sub-diaphragms 1-4 and 6 hang off the collector on B, which hands its whole
// force to the main diaphragm 5 (6-9, A-E) as a concentrated load (G7); offset line of resistance SW5 (D) + SW6 (E)
// with the strut D into TD1 (Phase 7); SW7 on E acts alone (G8); TD2 takes the chords of sections A / B at the notch.
// Format: FORMAT.md. Plan coordinates as Ex 8.1 (y up, E = 0 … A = 90). Transcribed 2026-11-03.
export default {
  id: 'Ex8.4',
  title: 'Complex diaphragm, longitudinal load: collector into the main diaphragm, offset wall line, iteration',
  pdf: 'The Analysis of Irregular Shaped Ch 8.4.pdf',
  pages: '2-21',
  shearElement: 'mirrored',
  layout: {
    grids: [
      { name: '1', axis: 'x', at: 0 },
      { name: '2', axis: 'x', at: 30 },
      { name: '3', axis: 'x', at: 50 },
      { name: '4', axis: 'x', at: 60 },
      { name: '5', axis: 'x', at: 75 },
      { name: '6', axis: 'x', at: 100 },
      { name: '7', axis: 'x', at: 125 },
      { name: '8', axis: 'x', at: 145 },
      { name: '9', axis: 'x', at: 170 },
      { name: '10', axis: 'x', at: 190 },
      { name: 'E', axis: 'y', at: 0 },
      { name: 'D', axis: 'y', at: 10 },
      { name: 'C', axis: 'y', at: 15 },
      { name: 'B', axis: 'y', at: 50 },
      { name: 'A.2', axis: 'y', at: 80 },
      { name: 'A', axis: 'y', at: 90 },
    ],
    outline: [[0, 90], [190, 90], [190, 50], [170, 50], [170, 0], [145, 0], [145, 15], [125, 15], [125, 0], [60, 0], [60, 10],
      [30, 10], [30, 50], [0, 50]],
    openings: [{ name: 'OP1', x: [50, 75], y: [50, 80] }],
    // E-W walls only (the N-S walls SW1-SW3 and MRF1 resist the other direction). SW5 (D) and SW6 (E) are one offset
    // line of resistance (p2): one wall line name. SW7 acts alone (p2: no strut to SW6).
    walls: [
      { line: 'A', mark: 'SW4', axis: 'y', at: 90, from: 25, to: 50 },
      { line: 'A', mark: 'SW8', axis: 'y', at: 90, from: 88, to: 108 },
      { line: 'D/E', mark: 'SW5', axis: 'y', at: 10, from: 30, to: 40 },
      { line: 'D/E', mark: 'SW6', axis: 'y', at: 0, from: 75, to: 125 },
      { line: 'E7', mark: 'SW7', axis: 'y', at: 0, from: 145, to: 170 },
    ],
    // Fig 8.21 segments. The TD regions (TD1, TD3, TD4) are sub-diaphragms of their own (book: their uniform load plus
    // the transferred force); the TD on top carries the transferred force only.
    diaphragms: [
      { mark: 'D1', x: [0, 30], y: [50, 90], supports: ['A', 'B'] },
      { mark: 'D2', x: [30, 60], y: [10, 50], supports: ['B', 'D'] },
      { mark: 'D3', x: [50, 75], y: [80, 90], supports: ['A', 'A.2'] },
      { mark: 'D4', x: [75, 100], y: [0, 50], supports: ['B', 'E'] },
      { mark: 'D5', parts: [[100, 170, 15, 90], [100, 125, 0, 15], [145, 170, 0, 15]], supports: ['A', 'E'] },
      { mark: 'D6', x: [170, 190], y: [50, 90], supports: ['A', 'B'] },
      { mark: 'DT1', x: [60, 75], y: [0, 50], supports: ['B', 'E'] },
      { mark: 'DT3', x: [30, 50], y: [50, 90], supports: ['A', 'B'] },
      { mark: 'DT4', x: [75, 100], y: [50, 90], supports: ['A', 'B'] },
    ],
    tds: [
      // strut D from SW5 enters TD1 at grid 4 (p3, Fig 8.23)
      { mark: 'TD1', x: [60, 75], y: [0, 50], supports: ['B', 'E'], loads: [{ grid: 'D', side: '-' }] },
      // chords of sections A (line 7) and B (line 8) end at C (p12, Fig 8.24)
      { mark: 'TD2', x: [100, 170], y: [15, 50], supports: ['6', '9'], loads: [{ grid: '7', side: '-' }, { grid: '8', side: '-' }] },
      // Diaphragm 3's reaction on A.2 shared by TD3 and TD4 (p8)
      { mark: 'TD3', x: [30, 50], y: [50, 90], supports: ['A', 'B'], loads: [{ grid: 'A.2', side: '+' }] },
      { mark: 'TD4', x: [75, 100], y: [50, 90], supports: ['A', 'B'], loads: [{ grid: 'A.2', side: '-' }] },
    ],
    // seismic: C_s = 0.14 × 30 psf = 4.2 psf on the sheathed area, acting east (+x) (p4-5)
    loads: [{ acts: '+x', mode: 'area', kind: 'E', psf: 4.2 }],
  },
  expected: [
    // Phase 4: basic unit shears of the sub-diaphragms that do not depend on the iteration (pp7-8, Fig 8.22)
    { k: 'vb:A-:1-2', v: -84, unit: 'plf', page: 7, fig: '8.22', phase: 4, note: 'Diaphragm 1: 2520 / 30' },
    { k: 'vb:B+:1-2', v: 84, unit: 'plf', page: 7, fig: '8.22', phase: 4 },
    { k: 'vb:B-:2-4', v: -84, unit: 'plf', page: 8, fig: '8.22', phase: 4, note: 'Diaphragm 2' },
    { k: 'vb:D+:2-4', v: 84, unit: 'plf', page: 8, fig: '8.22', phase: 4 },
    { k: 'vb:A-:3-5', v: -21, unit: 'plf', page: 8, fig: '8.22', phase: 4, note: 'Diaphragm 3: 525 / 25' },
    { k: 'vb:A.2+:3-5', v: 21, unit: 'plf', page: 8, fig: '8.28', phase: 4 },
    { k: 'vb:B-:5-6', v: -105, unit: 'plf', page: 8, fig: '8.22', phase: 4, note: 'Diaphragm 4: 2625 / 25' },
    { k: 'vb:E+:5-6', v: 105, unit: 'plf', page: 8, fig: '8.22', phase: 4 },
    { k: 'vb:A-:9-10', v: -84, unit: 'plf', page: 8, fig: '8.22', phase: 4, note: 'Diaphragm 6: 1680 / 20' },
    { k: 'vb:B+:9-10', v: 84, unit: 'plf', page: 8, fig: '8.22', phase: 4 },

    // Phase 6: TD3 / TD4 (Diaphragm 3's 525 lb on A.2 shared equally, 262.5 each) and their net shears (p9, Figs 8.22-8.23)
    { k: 'tdP:TD3:A.2', v: 262.5, unit: 'lb', page: 8, phase: 6, note: '525 / 2 (p9 prints 262.2 in the formulas)' },
    { k: 'tdP:TD4:A.2', v: 262.5, unit: 'lb', page: 8, phase: 6 },
    { k: 'vnet:A-:2-3', v: -93.8, unit: 'plf', page: 9, fig: '8.22', phase: 6, note: 'R_A 1876.9 / 20' },
    { k: 'vnet:A.2+:2-3', v: -51.8, unit: 'plf', page: 6, fig: '8.22', phase: 6 },
    { k: 'vnet:A.2-:2-3', v: -38.7, unit: 'plf', page: 6, fig: '8.22', phase: 6 },
    { k: 'vnet:B+:2-3', v: 87.28, unit: 'plf', page: 9, fig: '8.22', phase: 6, tol: 0.05, note: 'R_B 1745.6 / 20 (p9 prints 87.3 over 25 ft)' },
    { k: 'vnet:A-:5-6', v: -91.9, unit: 'plf', page: 9, fig: '8.23', phase: 6, note: 'R_A 2296.9 / 25' },
    { k: 'vnet:A.2+:5-6', v: -49.9, unit: 'plf', page: 7, fig: '8.23', phase: 6 },
    { k: 'vnet:A.2-:5-6', v: -39.4, unit: 'plf', page: 7, fig: '8.23', phase: 6 },
    { k: 'vnet:B+:5-6', v: 86.6, unit: 'plf', page: 9, fig: '8.23', phase: 6 },
    // collector A.2 (p16, Fig 8.25 lower). The book prints + for compression on the longitudinal lines (p16); here tension +.
    { k: 'N:A.2:3', v: 262.4, unit: 'lb', sense: 'T', page: 16, fig: '8.25', phase: 6 },
    { k: 'N:A.2:5', v: -262.6, unit: 'lb', sense: 'C', page: 16, fig: '8.25', phase: 6 },
    { k: 'N:A.2:6', v: 0, unit: 'lb', sense: '?', page: 16, fig: '8.25', phase: 6, tol: 1 },
    // transverse lines 2, 3 (pp19, Fig 8.28): − compression, + tension
    { k: 'N:2:A.2', v: -98, unit: 'lb', sense: 'C', page: 19, fig: '8.28', phase: 6 },
    { k: 'N:2:B', v: 0, unit: 'lb', sense: '?', page: 19, fig: '8.28', phase: 6, tol: 1 },
    { k: 'N:3:A.2', v: 728, unit: 'lb', sense: 'T', page: 19, fig: '8.28', phase: 6, tol: 1, note: 'book −728 (erratum: sign); Fig 8.28: 728.4' },
    { k: 'N:3:B', v: 0, unit: 'lb', sense: '?', page: 19, fig: '8.28', phase: 6, tol: 6, note: 'book 5.9 "close enough"' },
    { k: 'N:5:A.2', v: -709, unit: 'lb', sense: 'C', page: 19, fig: '8.28', phase: 6, tol: 1, note: 'book +709 (erratum: sign); Fig 8.28: 708.8' },
    { k: 'N:5:B', v: 0, unit: 'lb', sense: '?', page: 19, fig: '8.28', phase: 6, tol: 1 },

    // Phase 7: everything that hangs on the collector B → main diaphragm 5 and the offset line D/E (the iteration,
    // p11 "final forces"). Tolerances marked G10: the book stops with its group total short by TD1's strut force
    // (see errata p11); values that depend on it may differ by up to that share.
    { k: 'tdP:TD1:D', v: 137.4, unit: 'lb', page: 11, fig: '8.23', phase: 7, tol: 25, note: 'G10: closure gives ~160 (the book omits it from the SW5 + SW6 total)' },
    { k: 'vnet:B-:4-5', v: -103.2, unit: 'plf', page: 11, fig: '8.23', phase: 7, tol: 0.5, note: 'TD1: R_B 1548 / 15 (G10)' },
    { k: 'vnet:D+:4-5', v: 64.8, unit: 'plf', page: 7, fig: '8.23', phase: 7, tol: 0.5, note: 'G10' },
    { k: 'vnet:D-:4-5', v: 55.7, unit: 'plf', page: 7, fig: '8.23', phase: 7, tol: 2, note: 'G10' },
    { k: 'vnet:E+:4-5', v: 97.7, unit: 'plf', page: 11, fig: '8.23', phase: 7, tol: 2, note: 'TD1: R_E 1465 / 15 (G10)' },
    { k: 'R:A', v: 30247.8, unit: 'lb', page: 15, phase: 7, tol: 20, note: '2520 + 1876.9 + 525 + 2296.9 + 21,349 + 1680 (G10)' },
    { k: 'vw:SW4', v: 672.2, unit: 'plf', page: 15, phase: 7, tol: 0.5 },
    { k: 'vw:SW8', v: 672.2, unit: 'plf', page: 15, phase: 7, tol: 0.5 },
    { k: 'R:D/E', v: 15944.7, unit: 'lb', page: 11, phase: 7, tol: 140, note: 'SW5 + SW6 (G10: the consistent total includes TD1\'s strut force)' },
    { k: 'vw:SW5', v: 265.7, unit: 'plf', page: 11, phase: 7, tol: 2.5, note: 'G10' },
    { k: 'vw:SW6', v: 265.7, unit: 'plf', page: 11, phase: 7, tol: 2.5, note: 'G10' },
    { k: 'R:E7', v: 9327, unit: 'lb', page: 7, fig: '8.23', phase: 7, tol: 10, note: 'SW7 = section B\'s half of R_E' },
    { k: 'vw:SW7', v: 373.1, unit: 'plf', page: 14, fig: '8.27', phase: 7, tol: 0.5, note: 'Fig 8.27 prints 375.2 (erratum)' },
    // main diaphragm 5 (p11, Fig 8.24)
    { k: 'vb:A-:6-9', v: -305, unit: 'plf', page: 11, fig: '8.24', phase: 7, tol: 0.5, note: 'R_A 21,349 / 70' },
    { k: 'vb:B+:6-9', v: -137, unit: 'plf', page: 11, fig: '8.24', phase: 7, tol: 0.5 },
    { k: 'vb:B-:6-9', v: 74.5, unit: 'plf', page: 10, fig: '8.24', phase: 7, tol: 0.5, note: '5215 / 70; book prints 75.4 (erratum); +14,804 lb from the collector on B' },
    { k: 'vb:C+:6-9', v: 221.5, unit: 'plf', page: 10, fig: '8.24', phase: 7, tol: 0.5 },
    { k: 'vb:C-:6-7', v: 310.1, unit: 'plf', page: 11, fig: '8.24', phase: 7, tol: 0.5 },
    { k: 'vb:E+:6-7', v: 373.1, unit: 'plf', page: 11, fig: '8.24', phase: 7, tol: 0.5, note: 'R_E 18,655 / 50' },
    { k: 'vb:E+:8-9', v: 373.1, unit: 'plf', page: 11, fig: '8.24', phase: 7, tol: 0.5 },
    // TD2 (p12, Figs 8.23-8.24): the chords of sections A / B, (373.1 + 310.1) / 2 × 15
    { k: 'tdP:TD2:7', v: 5124, unit: 'lb', page: 11, fig: '8.24', phase: 7, tol: 5 },
    { k: 'tdP:TD2:8', v: 5124, unit: 'lb', page: 11, fig: '8.24', phase: 7, tol: 5 },
    { k: 'tdR:TD2:6', v: 1464, unit: 'lb', page: 12, fig: '8.23', phase: 7, tol: 2, note: '5124 × 20 / 70' },
    { k: 'tdR:TD2:9', v: 1464, unit: 'lb', page: 12, fig: '8.23', phase: 7, tol: 2 },
    { k: 'vtd:TD2:6-7', v: -41.8, unit: 'plf', page: 12, fig: '8.23', phase: 7, tol: 0.1, note: 'p12 prints −40.8 (erratum)' },
    { k: 'vtd:TD2:7-8', v: 104.6, unit: 'plf', page: 12, fig: '8.23', phase: 7, tol: 0.2 },
    { k: 'vtd:TD2:8-9', v: -41.8, unit: 'plf', page: 12, fig: '8.23', phase: 7, tol: 0.1 },
    { k: 'vnet:B-:6-7', v: 32.7, unit: 'plf', page: 12, phase: 7, tol: 0.5, note: '−41.8 + 74.5; book 33.6 from 75.4 (erratum)' },
    { k: 'vnet:B-:7-8', v: 179.1, unit: 'plf', page: 12, phase: 7, tol: 0.5, note: '104.6 + 74.5; book 180 from 75.4 (erratum)' },
    { k: 'vnet:C+:6-7', v: 179.7, unit: 'plf', page: 12, phase: 7, tol: 0.5, note: 'p12 prints −41.3 + 221.5' },
    { k: 'vnet:C+:7-8', v: 326.1, unit: 'plf', page: 12, phase: 7, tol: 0.5 },
    // line A (pp15-16, Fig 8.25). Book: + compression, − tension; here tension +.
    { k: 'N:A:x=25', v: -2100, unit: 'lb', sense: 'C', page: 15, fig: '8.25', phase: 7, note: '84 × 25' },
    { k: 'N:A:2', v: 841, unit: 'lb', sense: 'T', page: 15, phase: 7, tol: 3, note: 'p15 prints +841 (erratum)' },
    { k: 'N:A:3', v: 12409, unit: 'lb', sense: 'T', page: 15, fig: '8.25', phase: 7, tol: 15 },
    { k: 'N:A:x=88', v: 10689.3, unit: 'lb', sense: 'T', page: 15, fig: '8.25', phase: 7, tol: 15, note: 'start of SW8 (6 − 12 ft)' },
    { k: 'N:A:6', v: 17652.9, unit: 'lb', sense: 'T', page: 15, phase: 7, tol: 20 },
    { k: 'N:A:x=108', v: 20590.5, unit: 'lb', sense: 'T', page: 16, fig: '8.25', phase: 7, tol: 20, note: 'end of SW8 (6 + 8 ft)' },
    { k: 'N:A:10', v: 0, unit: 'lb', sense: '?', page: 16, fig: '8.25', phase: 7, tol: 1 },
    // line B (p16, Fig 8.26): compression into the main diaphragm, tension 9-10
    { k: 'N:B:2', v: -2520, unit: 'lb', sense: 'C', page: 16, fig: '8.26', phase: 7 },
    { k: 'N:B:3', v: -5945.6, unit: 'lb', sense: 'C', page: 16, fig: '8.26', phase: 7 },
    { k: 'N:B:5', v: -8334, unit: 'lb', sense: 'C', page: 16, fig: '8.26', phase: 7, tol: 10, note: 'G10 (TD1)' },
    { k: 'N:B:6', v: -13124, unit: 'lb', sense: 'C', page: 16, fig: '8.26', phase: 7, tol: 10, note: 'the collector force handed into Diaphragm 5 from the left (G10)' },
    { k: 'N:B:7', v: -8881.5, unit: 'lb', sense: 'C', page: 16, fig: '8.26', phase: 7, tol: 10, note: 'book 9035.5 (erratum)' },
    { k: 'N:B:8', v: -2559.5, unit: 'lb', sense: 'C', page: 16, fig: '8.26', phase: 7, tol: 10, note: 'book 263.5 (erratum)' },
    { k: 'N:B:9', v: 1680, unit: 'lb', sense: 'T', page: 16, fig: '8.26', phase: 7, tol: 10 },
    { k: 'N:B:10', v: 0, unit: 'lb', sense: '?', page: 16, fig: '8.26', phase: 7, tol: 1 },
    // line C (p17, Fig 8.27)
    { k: 'N:C:7', v: 3260, unit: 'lb', sense: 'T', page: 17, fig: '8.27', phase: 7, tol: 10 },
    { k: 'N:C:8', v: -3268, unit: 'lb', sense: 'C', page: 17, fig: '8.27', phase: 7, tol: 10, note: 'p17 uses 326.4 for 326.1' },
    { k: 'N:C:9', v: 0, unit: 'lb', sense: '?', page: 17, fig: '8.27', phase: 7, tol: 10, note: 'book 8 lb' },
    // line D (p17, Figs 8.23 / 8.27): SW5 pulls the strut D; it ends in TD1
    { k: 'N:D:x=40', v: 1816, unit: 'lb', sense: 'T', page: 17, fig: '8.27', phase: 7, tol: 25, note: 'book +1816 with −137.4 at grid 4 (erratum: one sense); G10' },
    { k: 'N:D:4', v: 137.4, unit: 'lb', sense: 'T', page: 17, fig: '8.27', phase: 7, tol: 25, note: 'the strut force into TD1 (G10)' },
    { k: 'N:D:5', v: 0, unit: 'lb', sense: '?', page: 17, fig: '8.27', phase: 7, tol: 1 },
    // line E (p17, Fig 8.27)
    { k: 'N:E:5', v: -1465, unit: 'lb', sense: 'C', page: 17, fig: '8.27', phase: 7, tol: 20, note: 'G10' },
    { k: 'N:E:6', v: 2550, unit: 'lb', sense: 'T', page: 17, fig: '8.27', phase: 7, tol: 80, note: 'G10: v_SW6 and TD1 R_E both move with the strut force' },
    { k: 'N:E:7', v: 0, unit: 'lb', sense: '?', page: 17, fig: '8.27', phase: 7, tol: 1, note: 'book 137.5 "close enough" (erratum p11 / G10)' },
    { k: 'N:E:9', v: 0, unit: 'lb', sense: '?', page: 17, fig: '8.27', phase: 7, tol: 1, note: 'SW7 net shear 0' },
    // transverse lines 4-9 (pp19-21, Fig 8.28)
    { k: 'N:4:D', v: -768, unit: 'lb', sense: 'C', page: 19, fig: '8.28', phase: 7, tol: 15, note: 'G10 (TD1)' },
    { k: 'N:4:E', v: 0, unit: 'lb', sense: '?', page: 19, fig: '8.28', phase: 7, tol: 1 },
    { k: 'N:5:D', v: -72, unit: 'lb', sense: 'C', page: 20, fig: '8.28', phase: 7, tol: 15, note: 'Fig 8.28: 73 (G10)' },
    { k: 'N:5:E', v: 0, unit: 'lb', sense: '?', page: 20, fig: '8.28', phase: 7, tol: 1, note: 'book −1' },
    { k: 'N:6:A.2', v: -2133, unit: 'lb', sense: 'C', page: 20, fig: '8.28', phase: 7, tol: 5 },
    { k: 'N:6:B', v: -8841, unit: 'lb', sense: 'C', page: 20, fig: '8.28', phase: 7, tol: 15 },
    { k: 'N:6:C', v: -4005.8, unit: 'lb', sense: 'C', page: 20, phase: 7, tol: 15 },
    { k: 'N:6:E', v: 0, unit: 'lb', sense: '?', page: 20, phase: 7, tol: 16, note: 'book 15.8' },
    { k: 'N:9:C', v: 5124, unit: 'lb', sense: 'T', page: 21, fig: '8.28', phase: 7, tol: 5, note: 'book −5124 (erratum: sense)' },
    { k: 'N:9:B', v: 8856.8, unit: 'lb', sense: 'T', page: 21, fig: '8.28', phase: 7, tol: 20, note: 'book −8856.8 (erratum: sense)' },
    { k: 'N:9:A', v: 0, unit: 'lb', sense: '?', page: 21, phase: 7, tol: 17, note: 'book 16.7' },
  ],

  errata: [
    { page: 11, what: 'R_E of Diaphragm 5 prints 1481.2(40); ΣV_B = 14,831.2 (the line above) and R_E = 18,666.6 need 14,831.2.', use: '14,831.2 lb' },
    { page: 11, what: 'The SW5 + SW6 total (15,944.7 = 2520 + 1465 + 2625 + 9333) leaves out TD1\'s reaction at D (the strut force, 137.4 lb): TD1 carries 63 × 50 = 3150 = 1548 + 1465 + 137.4. So the walls carry 137.4 lb less than the diaphragm delivers and line E ends at +137.5 lb (p17, "close enough"). With the strut force in the total every line closes (the tool: P ≈ 160 lb).', use: 'closure: line E ends at 0; values that depend on P carry a G10 tolerance' },
    { page: 8, what: 'Diaphragm 3: "shared equally between TD1 and TD4" — its reaction on A.2 goes to TD3 and TD4 (Fig 8.21, p9 formulas).', use: 'TD3 and TD4, 262.5 lb each' },
    { page: 9, what: 'TD3 / TD4 formulas use 262.2 for 525 / 2 = 262.5; TD3 v_B = 1745.6 / 25 = 87.3 should be / 20 = 87.28 (TD3 is 20 ft wide, Fig 8.26 87.28).', use: '262.5 lb; 87.28 plf' },
    { page: 15, what: 'Line A: F2 = 2100 − 588.2(5) printed 841; it is −841, and F3 = −841 − 578.4(20) = −12,409 needs it.', use: '−841 lb (tension)' },
    { page: 17, what: 'Line D: F at the end of SW5 printed 1816 and F4 = −137.4; the strut beyond SW5 collects 84 × 20 = 1680 toward −137.4, so the end of SW5 is −1816 (tension, as Fig 8.23).', use: '−1816 lb (tension)' },
    { page: 12, what: 'TD2 v_6-9 printed −40.8; 1464 / 35 = 41.83 (Fig 8.23 −41.8). The net-shear table uses −41.3 for line C.', use: '−41.8 plf' },
    { page: 14, what: 'Fig 8.27 SW7 v_sw = v_diaph = 375.2; 9327 / 25 = 373.1 (Fig 8.24).', use: '373.1 plf' },
    { page: 10, what: 'Fig 8.24: below B the main diaphragm carries +5215 lb, printed v = +75.4 plf; 5215 / 70 = 74.5 (digits swapped). The net-shear table (p12) carries it on: 33.6 and 180 for 32.7 and 179.1.', use: '74.5, 32.7, 179.1 plf' },
    { page: 16, what: 'Line B: F7 = 13,124 − (137 + 33.6)(25) printed 9035.5 (= 8859), and F8 = 9035.5 − (137 + 180)(20) printed 263.5 (= 2695.5); F9 = −1680 only follows from the shears with 74.5 (erratum p10): 13,124 − 4242.5 = 8881.5, − 6322 = 2559.5, − 4242.5 = −1683 ≈ −1680.', use: '8881.5 and 2559.5 lb (compression)' },
    { page: 19, what: 'Lines 3 and 5 at A.2: the book uses the opposite sign to its own line 2 rule (line 2: −[(93.8 − 84) + (51.8 − 42)] with TD3 on the right gives −98; the same rule with TD3 on the left of line 3 gives +728, with TD4 on the right of line 5 −709).', use: '+728 (tension) on line 3, −709 (compression) on line 5' },
    { page: 21, what: 'Line 9 printed −5124 at C and −8856.8 at B, the same sense as line 6 (−4005.8, −8841); lines 6 and 9 are the two chords of Diaphragm 5 between B and C and carry opposite senses (section moment).', use: '+5124 and +8856.8 (tension)' },
    { page: 20, what: 'The "grid line 7 starting at E" block (584.92, 521.92, 324.48 …) does not belong to this example; line 7 is the next block (F = 5124 at C, 0 at B).', use: 'not used' },
  ],

  assumptions: [
    { what: 'Same plan as Ex 8.1 (confirmed with the user 2026-11-02): y up, E = 0, D = 10, C = 15, B = 50, A.2 = 80, A = 90; x: 1 = 0 … 10 = 190.', why: 'Fig 8.20 dimensions match Fig 8.7.' },
    { what: 'Walls: SW4 on A 25-50 (2 − 5 ft to 3), SW8 on A 88-108 (6 − 12 ft to 6 + 8 ft), SW5 on D 30-40, SW6 on E 75-125 (50 ft, 5 to 7), SW7 on E 145-170. SW5 and SW6 share the wall line name "D/E" (offset line, p2); SW7 has its own ("E7").', why: 'Figs 8.20, 8.25, 8.27; p11 (SW6 50 ft, SW7 25 ft), p15 (ΣL_A = 45 ft).' },
    { what: 'Seismic as an area load 4.2 psf (C_s 0.14 × 30 psf), +x.', why: 'p4: the strip load in proportion to the width (= psf × depth).' },
    { what: 'Sub-diaphragms as Fig 8.21: D1, D2, D3, D4, D6, the main Diaphragm 5 (pieces 6-9 A-C, sections A 6-7 and B 8-9 C-E), and the TD regions DT1 (TD1), DT3 (TD3), DT4 (TD4) as diaphragms of their own between their supports.', why: 'p2-4; the book solves the TD regions as simple beams with their uniform load and the transferred force.' },
    { what: 'The collector on B has no wall: the reactions on it (D1, DT3, D2, DT1, D4, DT4 from the left, D6 from the right) go into Diaphragm 5 as a concentrated load at B (G7).', why: 'p2: "transfer the accumulated forces as a concentrated force into the main diaphragm"; Fig 8.24 (14,804 lb).' },
  ],
};
