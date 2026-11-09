# Book example sources: format

Each file `ExN.N.mjs` restates one example of EX-IRREG-2E ("The Analysis of Irregular Shaped Structures: Wood
Diaphragms and Shear Walls", 2nd ed.). The excerpt PDFs are in the Shared Drive folder
`Design Item Hub\Diaphragm analysis reference\book reference\`. Do not copy book prose: give the layout as data and
the results as numbers, each with a page reference.

The tool must reach the same **final values**. Its route may differ: it integrates unit shear and does not use M/d,
and it takes the load as entered here.

## File shape
```js
export default {
  id: 'Ex4.1',
  title: 'Intermediate offset left of centerline, transverse load',   // own words
  pdf: 'The Analysis of Irregular Shaped Ch 4.1.pdf',                // file in "book reference"
  pages: '3-11',                                                     // 1-based page index of the excerpt PDF
  shearElement: 'mirrored',   // only when the book's "+" element is the mirror of Ex 4.1's (see Signs)
  layout: { grids, outline, openings, walls, tds, loads },
  expected: [ ... ],
  errata: [ ... ],
  assumptions: [ ... ],   // anything not stated in the book that the layout needs
};
```

## Layout
Plan coordinates: **x to the right, y up**, as drawn in the book figure. Feet.

| Key | Shape | Notes |
|---|---|---|
| `grids` | `[{ name, axis: 'x'\|'y', at }]` | `axis: 'x'` = a line of constant x (numbered grids drawn vertically). Add extra stations the book uses (e.g. `CL`) as grids with `ref: true`. |
| `outline` | `[[x, y], ...]` | Rectilinear sheathed outline, corners in order (counter-clockwise). |
| `openings` | `[{ name, x: [x1, x2], y: [y1, y2] }]` | Unsheathed rectangles inside the outline. |
| `walls` | `[{ line, mark, axis, at, from, to }]` | One per shear wall: `line` = wall-line name, `axis`/`at` = the grid it sits on, `from`/`to` = extent along the line (ft). |
| `tds` | `[{ mark, x: [x1, x2], y: [y1, y2], supports: [grid, grid], loads: [{ grid, side }] }]` | Transfer diaphragm rectangle. `supports` = the two lines it spans between (cantilever: add `overhang: [y1, y2]` or `[x1, x2]`). `loads` = the line where the disrupted chord/strut enters, `side` = `'-'` or `'+'` (the side of the TD the cut member comes from, in plan coordinates). |
| `loads` | `[{ acts: '+x'\|'-x'\|'+y'\|'-y', mode: 'line', edge?, segments: [{ from, to, w, w2? }] }]` | Line load along the span, plf. `from`/`to` are coordinates along the span axis. `w2` for a linearly varying segment. `edge` = the grid line the load is applied along (e.g. windward chord A, leeward chord D); it decides which band carries it where an opening or notch splits the depth. Without `edge` the load is shared by the bands in proportion to their depth. Use `mode: 'area', psf` only if the book gives psf. |

## Expected values
`{ k, v, unit, sense?, page, fig?, phase, tol?, note? }`

- `expectedNonClosing` (optional) has the same entry shape. It holds a first, deliberately wrong distribution that the
  book shows does not close (Ex 3.3); the tool test checks that it fails closure.
- `v` is signed:
  - **Unit shears** use the book's sign convention (the "+" sheathing element of each figure; the skill uses the same).
  - **Member forces** are tension + and compression −. Set `sense: 'T'`, `'C'` or `'?'` (book gives no sense).
- `page` is the 1-based page of the excerpt PDF. `fig` is the figure number when the value is read off a figure.
- `phase` is the plan phase that can first reach the value:
  - 4: reactions, section shear, basic unit shear;
  - 5: chord or strut force on the basic field (the disrupted force);
  - 6: TD, net and member values;
  - 7: anything that needs offset wall lines.
- `tol` is an absolute tolerance, only when the book rounds or carries an erratum (explain in `note`). The default is 0.5 % or 1 unit.

**Keys** use grid names. A *station* is a grid name, or `x=<ft>` / `y=<ft>`. A *side* suffix `-` / `+` means just
below / just above the station coordinate (left / right for x, bottom / top for y). A *band* `A-B` is the strip
between two grids running across the section.

| Key | Meaning | Unit |
|---|---|---|
| `R:<wallLine>` | Reaction / force to a wall line | lb |
| `Rw:<wallMark>` | Force to one wall | lb |
| `vw:<wallMark>` | Wall unit shear | plf |
| `V:<station>` or `V:<station>:<band>` | Section shear of the main diaphragm (or of one band / sub-diaphragm) | lb |
| `vb:<station><side>:<band>` | Basic unit shear at a section, in a band (`*` = full depth) | plf |
| `Nb:<line>:<station><side>` | Member force on the **basic** field (e.g. the disrupted chord force) | lb |
| `tdR:<TD>:<supportGrid>` | Force between TD and that support line; `note` gives the direction | lb |
| `tdP:<TD>:<grid>` | Load the book applies to the TD at that load line (may differ from `Nb`, e.g. a sub-diaphragm reaction, Ex 3.4) | lb |
| `vtd:<TD>:<band>` | TD unit shear in a band (a TD whose shear changes along its span uses x- or y-grid bands accordingly) | plf |
| `vnet:<station><side>:<band>` | Net unit shear | plf |
| `N:<line>:<station><side>` | Member force on the **net** field at a station of that line | lb |
| `Nmax:<line>:<from>-<to>` | Max force along a member run | lb |
| `aspect:<TD>` | TD aspect ratio | – |

## Signs
The tool reports unit shears with the **Ex 4.1 "+" element** (force on the −x face +y, on the +x face −y, on the top
face −x, on the bottom face +x), the same as the skill. Some examples draw the mirror element (Ex 3.3, Ex 4.2). Keep
the book's printed signs in the source and set `shearElement: 'mirrored'`; the build negates `vb`, `vtd`, `vnet` and
`vw` for those files and the doc shows both. Member forces are tension + in every file.

## Errata and assumptions
- `errata: [{ page, what, use }]`: a misprint, and the value the test uses instead.
- `assumptions: [{ what, why }]`: anything the layout needs that the book does not give, for example a wall length
  that is not shown.
