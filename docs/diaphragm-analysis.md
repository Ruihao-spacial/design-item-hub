# Diaphragm Analysis: calculator guide

Module **Diaphragm Analysis**, id `diaphragm_analysis` (Phase 1 built 2026-10-29: setup, plan editor, plan checks). Companion module `shear_wall_lines` (Phase 2).
Branch `diaphragm-analysis` (off `master` 71cdfb5, 2026-10-29). Plan: `~/.claude/plans/read-the-md-files-composed-kite.md`.
Decisions and open items: `docs/diaphragm-analysis-backlog.md`. Book cases: `docs/diaphragm-analysis-book-cases.md`.

## Purpose
Analysis of irregular wood diaphragms (notches, openings, offset wall lines) by the visual shear transfer method
(EX-IRREG-2E Ch 3–5). The engineer draws the plan (grids, outline, openings, walls, transfer diaphragms). The tool
finds the basic unit shear, the disrupted chord / strut forces, the TD shears, the net shear, and every chord, strut,
collector and drag force, with a closure check on each member.

## References (Shared Drive, `Design Item Hub\Diaphragm analysis reference`)
- `design-skills\skills\wood-diaph-transfer`: the TD skill (TESTED, not PE-approved). It is a **reference** for this
  tool. The app does not run flow.yaml; `tdCalc.js` (Phase 3) is a JS port tested against the skill's tests.
- `design-skills\research\`: method notes (`wood-diaph-irregular/notes.md` §1 = the five operations).
- `book reference\`: the 7 EX-IRREG-2E excerpts. They are restated as data in `tests/td-book/src/` and are the tool's
  end-to-end test oracle.

## Method (decisions 2026-10-29)
1. **Load** per direction: seismic F_x / ΣA (as Diaphragm to LRS), area load psf, or line load plf (piecewise; how the
   book's wind examples are entered).
2. **Flexible diaphragm, span by span** between adjacent wall lines. A continuous diaphragm is a far-future item.
3. **Basic unit shear** v_b = V(x) / d(x), where d(x) is the sheathed depth at the section; it jumps at depth steps.
4. **Member forces only by unit-shear integration:** N(s) = ∫ (v_side A − v_side B) ds along every member line,
   starting at 0 at a free end; N back to ~0 at the far end is the closure check. M/d is not used (it equals the
   integral for a constant-depth chord and appears only in hand-calc tests).
5. **Disrupted force P** = the integrated basic-field force where a chord or strut is cut.
6. **TD analysis** per the skill (reactions, segment shears, net shears, edge members, closure, aspect / blocking).
7. **Net field** = basic + TD shears; member diagrams on the net field.

## Plan model
- Shared by both load directions: grids, outline, openings, shear walls.
- Per load direction (`dir` = the axis the load acts along): diaphragms, TDs, loads. The Plan tab shows one direction
  at a time with a load-direction arrow.
- A **diaphragm** is a rectangle clipped to the sheathed plan, spanning between two support lines across the span
  (for a load along y: two ↕ lines). Diaphragms of one direction must not overlap; uncovered sheathing is a warning.
  Sheathing / blocking per diaphragm, default from Setup.

## Shear Wall Design link (Phase 2, option B)
- Shear Wall Design owns the walls (all types, all levels) and the distribution method; this plan owns the grids.
- Setup → "Shear walls (from Shear Wall Design)": pick the SWD item, map each SWD direction to load along x / y,
  optionally set each line's origin. SWD line names = grid names; SWD level name = this item's level.
- SWD → Loading → "Line loads from Diaphragm Analysis": tick the DA item of each level; its line forces are copied
  into the line loads (update notice when they change). Line forces arrive with Phase 4.

## Views
1. Basic unit shear. 2. TD unit shear. 3. Net unit shear. 4. All drag / collector / chord force diagrams on the plan.

## Files
| File | Role |
|---|---|
| `scripts/buildTdSkillData.mjs` | vendors the skill tests (`tests/td-cases/skill-tests.json`) and SDPWS T4.2.2 (`src/modules/tdTables.js`); `--check` compares |
| `tests/td-book/src/FORMAT.md`, `Ex*.mjs`, `lib.mjs`, `build.mjs` | book example sources, format, validation, build to `tests/td-book/Ex*.json` |
| `scripts/daBookDoc.mjs` | generates `docs/diaphragm-analysis-book-cases.md` |
| `src/modules/diaphragmAnalysis.js` | module export, tabs, ELF link, calc (Phase 1: plan checks, ΣA, q), outputs, PDF |
| `src/modules/tdGeometry.js` | pure plan geometry: parse, checks, ΣA, section bands / depth (each side of a step), panels |
| `src/modules/tdModel.js`, `tdMigrate.js` | constructors; stored data (schema 1, normalise, no-loss helpers) |
| `src/modules/tdPlanEditor.js` | SVG plan editor + property panel; `drawPlan` is reused read-only |
| `src/modules/tdTables.js` | SDPWS T4.2.2 aspect limits (generated, UNVERIFIED) |
| `tests/diaphragmAnalysisPlan.test.mjs` | Phase 1 tests (geometry, checks, tools, form, stored data, book layouts) |
| `src/modules/tdWallLink.js` | Shear Wall Design link: `swdExtract`, direction guess, walls of the level placed on the plan, matching checks |
| `tests/diaphragmAnalysisLink.test.mjs` | link infra (many / from-inputs refs), walls on the plan, SWD line loads from DA, unlinked SWD untouched |
| `tests/td-book/src/toInputs.mjs`, `scripts/daSeedBook.mjs` | book layout → item inputs; seed project DA-BOOK |

## Commands
`npm run da:skill:build -- "<design-skills folder>" [--check]` · `npm run da:book:build [Ex4.1 …]` · `npm run da:book:doc` ·
`SB_EMAIL=… SB_PASSWORD=… npm run da:seed [-- --apply]` · `node tests/diaphragmAnalysisPlan.test.mjs`
