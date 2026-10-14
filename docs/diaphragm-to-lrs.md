# Diaphragm to LRS — calculator guide

Module id `diaphragm_to_lrs` · schema 2 · calc v2 · branch `diaphragm-to-lrs` (built 2026-10-07, v2 2026-10-08; pushed as `4008c99`, PR #2 stacked on PR #1).
Stored-data rules (how saved projects survive code changes): `docs/data-durability.md`.
Decisions and open items: `docs/diaphragm-to-lrs-backlog.md`. Verification catalog: `docs/diaphragm-to-lrs-test-cases.md`.
Hand back-check of the beam solver (cases B01–B19, every loading condition, formula + free body vs the tool): `docs/diaphragm-to-lrs-beam-check.md`.

## Purpose
Distributes the seismic story force (1.0E, F_x) of each level through **flexible diaphragms** to the **lines of
resistance** (wall lines), and sums the force per line and the story shear down the building. It replaces the team's
spreadsheet "SLRS Wall Line Reaction Determination" (Shared Drive `Design Item Hub\Diaphragm to LRS reference`,
page C.6 = case D01). Wind is planned later.

## Method
1. **Area load.** For each level and direction: q = F_x / ΣA, where ΣA is the sum of all diaphragm parts of that
   level in that direction (b × d). The full F_x applies in each direction.
2. **Line load.** Each rectangular part carries w = q·d (plf) over its loaded length b, starting at a (c = L − a − b).
3. **Beam.** Each diaphragm is a beam of length L on two supports at x₁ < x₂ (l = x₂ − x₁; an overhang wherever a
   support is not at an end). Parts are cut at the supports into pieces (left overhang / back span / right overhang).
   Every piece (resultant W at x̄) and every point load P gives
   - R1 = W·(x₂ − x̄)/l, R2 = W·(x̄ − x₁)/l  (statics, ΣM = 0 about each support).
   R1 and R2 are computed independently; ΣR = ΣW + ΣP is check D1. A load on an overhang gives a negative value at
   the far support: the reaction **reverses** (kept with its sign, shown red).
4. **The lever rule is the only calculation path.** The tool and the PDF show it per row with its numbers
   (R1 = W·(x₂ − x̄)/l = …). No published beam-table case is printed (decision O5, 2026-10-08). The published closed
   forms are used only by the hand calcs that check the engine (cases D01–D08, B01–B19).
5. **Diaphragm on diaphragm.** A support may rest on another diaphragm at a given x; its reaction becomes a point load
   there. Diaphragms are solved in dependency order; a loop is an error (D4).
6. **Line force.** F of a line at a level = Σ reactions delivered to it. **Merged lines** (e.g. R.4+R.5, 2 or more lines,
   at the ticked levels) act as one line of resistance: F = Σ reactions to all of them, and the story shear goes down as one unit.
7. **Story shear.** V = F + force from above. Per line per level the force goes down as **Same line** (default),
   **Split %** to lower lines (vertical discontinuity) or **Ends here** (resisted at that level, e.g. a hillside). The
   lowest level goes to the foundation.
8. **Manual point loads** are extra load (not part of F_x): Σ reactions to lines = F_x + Σ manual P (D2).

Units: lengths ft, areas sf, w plf, forces kip (stored to 4 decimals, shown with 2).

## Using it (app)
1. **Setup tab** — link the ELF Diaphragm & Collector item (fills the levels and F_x, greyed out), or type the levels
   and F_x. Level tags (R, 2 …) prefix marks: R.D1, R.A. Add / rename directions (tab = load direction = the
   direction of the wall lines that resist it).
2. **Direction tab** — enter the wall lines (A, C, D …). **Merge lines → one line of resistance** (just below the
   lines): + Merge lines, tick 2 or more lines and the levels; the merged line shows as R.4+R.5 with a "merged" badge.
3. **Level sub-tab** — the header shows F_x, ΣA, q (and the other direction's ΣA for information).
   - **+ Diaphragm**, then in the row: mark, L, d, and the two supports (a wall line, or a diaphragm + x on it).
   - **▸** opens the editor: support positions (overhangs), several parts (a / b / d), manual point loads, the beam
     diagram, and the reaction rows (lever rule with its numbers per row).
   - **Copy diaphragms from <level>** copies a layout once (manual P not copied).
   - **Where each line's story shear goes** — Same / Split % / Ends here.
4. **Wall Line Shear Summary** (bottom of the direction tab) — one table per level: F, from above, V, goes to; Σ row.
5. **Checks tab** — D1–D9; a failing check marks the tab with a red dot.
6. **Export PDF** (top toolbar) — Summary (spreadsheet-style table + summary per level) or Detailed (adds per
   diaphragm: diagram, lever-rule rows, the lever rule with numbers per row; variables; checks).

## Checks
D1 ΣR = ΣW + ΣP per diaphragm · D2 Σ reactions to lines = F_x + Σ manual P per level · D3 geometry valid and every
support assigned · D4 no support loops, links within the level · D5 split adds to 100 % · D6 every line has a place to
go at the level below · D7 ΣV = ΣF at and above − force resisted above · D8 F_x and area present · D9 each line in at
most one merge per level.
Save is blocked only for: no levels, a support with no target, invalid geometry (`src/validation.js`).

## Data (items.inputs)
```
{ schemaVersion: 2, loadType, pdfReport, refs: { elfSource }, notes,
  levels: [{ id, name, tag, fx }],                                   // top-down
  directions: [{ id, name, lines: [{ id, name }],
    groups: [{ id, lineIds, levelIds }],                             // merged lines (2+); levelIds [] = all levels
    down: { [levelId]: { [lineId | 'g:'+groupId]: { mode: 'same'|'split'|'ends', split: [{ to, pct }] } } },
    diaphragms: [{ id, levelId, mark, length,
      supports: [{ x, kind: 'line'|'diaphragm', lineId, diaphragmId, atX }, {…}],   // x '' = 0 / L
      parts: [{ id, a, b, d }], pointLoads: [{ id, x, p, note }] }] }] }
```
Outputs (`calcAll`): `{ calcVersion, levels[{ sumA per direction }], perDirection[{ perLevel[{ sumA, q, qPsf, diaphragms[{ parts, points, rows, supports[{ R, Rdist, RP, to, reverses }] }], lines[{ label, F, fromAbove, V, goesTo, merged }] }], checks }], status }`.
Stored-data rules: `docs/data-durability.md`. Migration steps + normalisation: `diaphragmToLrsMigrate.js` (schema 1 → 2 stamps
`inputs.schemaVersion`; no field changes).

## Files
| File | Role |
|---|---|
| `src/modules/diaphragmToLrs.js` | module export, form (tabs, table, editor, down choices), summary, checks tab, ELF link |
| `src/modules/diaphragmToLrsCalc.js` | engine: parsing, beam solver, chain, line forces, story shear, checks |
| `src/modules/diaphragmToLrsDiagram.js` | beam diagram SVG (tool and PDF) |
| `src/modules/diaphragmToLrsReport.js` | PDF sections Summary / Detailed |
| `src/modules/diaphragmToLrsVerify.js` | case resolver, comparison, Verification tab |
| `src/modules/diaphragmToLrsMigrate.js` | stored data: schema, migration steps, normalisation, no-loss / results helpers |
| `tests/diaphragmToLrs.test.mjs` | engine tests: every closed form, random equilibrium, chain, story shear |
| `tests/diaphragmToLrsCases.test.mjs` | cases D01–D08 and B01–B19: values + checks, render, goldens |
| `tests/diaphragmToLrsBeamCheck.test.mjs` | B01–B19 run straight through `solveBeam` vs the hand calc; app item = same beam; B19 superposition |
| `tests/diaphragmToLrsMigrate.test.mjs` | frozen fixtures (`tests/fixtures/legacy-dlrs/`, incl. the real Test-123 item): no value lost, idempotent, same results, opens / saves / prints; merged lines; D9 |
| `tests/dlrs-cases/` | case JSON, `src/` hand-calc sources (Dxx closed forms; Bxx hand values typed from the beam-check doc), `golden/` |
| `scripts/dlrsCasesDoc.mjs`, `scripts/dlrsSeedCases.mjs` | catalog generator, seed into DLRS-VERIFY |
| `scripts/upgradeDlrsItems.mjs` | bulk upgrade of saved items (dry run by default; no-loss and results report) |

## Commands
`npm test` · `npm run dlrs:cases:build | dlrs:cases:check | dlrs:cases:diff | dlrs:cases:accept | dlrs:cases:doc` ·
`SB_EMAIL=… SB_PASSWORD=… npm run dlrs:seed [-- --apply]` · `SB_EMAIL=… SB_PASSWORD=… npm run upgrade:dlrs [-- --apply]`.
After a calc change: bump `CALC_VERSION` in the calc file, `dlrs:cases:diff`, review, `dlrs:cases:accept`, `dlrs:cases:doc`.
After an inputs shape change: capture a fixture of the old shape first, add a step to `DLRS_MIGRATIONS`, bump `DLRS_SCHEMA`,
run the migration test, then `upgrade:dlrs` (dry run, then `--apply`). See `docs/data-durability.md`.
