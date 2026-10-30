# Diaphragm Analysis: calculator guide

Module **Diaphragm Analysis**, id `diaphragm_analysis` (former id `transfer_diaphragm`). Built 2026-10-29: Phases 0–6 (book cases, plan editor and checks, Shear Wall Design link, TD engine, basic shear / line forces, derived TD inputs and TD runs, net field / member diagrams / Views 1–4 / checks). Next: Phase 7 (offset wall lines).
Branch `diaphragm-analysis` (off `master` 71cdfb5, 2026-10-29). Plan: `~/.claude/plans/read-the-md-files-composed-kite.md`.
Decisions and open items: `docs/diaphragm-analysis-backlog.md`. Book cases: `docs/diaphragm-analysis-book-cases.md`.

## Purpose
Analysis of irregular wood diaphragms (notches, openings, offset wall lines) by the visual shear transfer method
(EX-IRREG-2E Ch 3–5). The engineer draws the plan (grids, outline, openings, walls, transfer diaphragms). The tool
finds the basic unit shear, the disrupted chord / strut forces, the TD shears, the net shear, and every chord, strut,
collector and drag force, with a closure check on each member.

## References (Shared Drive, `Design Item Hub\Diaphragm analysis reference`)
- `design-skills\skills\wood-diaph-transfer`: the TD skill (TESTED, not PE-approved). `npm run da:skill:build`
  turns its flow.yaml into `tdFlow.js` (every step, expressions as JS functions); `tdCalc.js` runs it like the
  skill's Python reference. Results carry a DRAFT mark until the skill is PE-approved.
- **Book misprint carried by the skill:** tests.yaml T05 uses Ex 4.3 p3 v3 = 167.9 plf (printed); correct 157.14.
  The vendored T05 is corrected (`CORRECTIONS` in `scripts/buildTdSkillData.mjs`); to report to the skill author.
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
  into the line loads (update notice when they change). Line forces are filled since Phase 4.

## Basic shear, line forces, walls (Phase 4)
- Load case = direction × kind (E / W; load field `kind`). Each diaphragm is a beam between its two support lines
  (overhang allowed); line loads are shared by the diaphragms covering a section in proportion to depth (edge loads:
  the diaphragm / band on that edge).
- Opening bands (Vierendeel, book Ch 5.2): inflection (opening-edge chords 0) and width split of V chosen from the
  geometry — at the end on a support line (free chord ends, Ex 4.3), else inflection at mid-opening and width split
  at the end with the smaller |V| (Ex 5.1). Diaphragm setting "Opening bands share V at" (auto | start | end | mid)
  overrides the width split.
- A support line without a wall passes its force into the TD it loads (equal split between TDs), then by statics
  to that TD's supports. Wall shares by wall length, or with the Shear Wall Design link by SWD's own calcAll (B4).
- Line forces and wall shares are positive in the load direction; unit shears use the "+" element.

## Disrupted forces and TD inputs (Phase 5)
- Basic-field member forces (`tdMembers.js`): chords ±M/d of the band (single band), or Vierendeel from the
  inflection in an opening stretch; cross lines (struts / collectors) integrated from a free end, equal split
  between two TDs (Ex 4.2).
- Each TD's skill inputs come from the plan (`tdDerive.js`): P = chord force at the TD edge × side (chord TD) or the
  wall-less line force handed into it (strut TD); edge / outside shears from the basic field, + a wall on an edge.
- Engineer inputs: region clear = drawn TD; cantilever = the engineer's review of the listed limits (UNVERIFIED);
  closure tolerance = 1 % of |P1| + |P2| (code constant).

## Net field, members, checks (Phase 6)
- Net field = basic + the TD segment shears inside each TD. Every line is a member (chords and struts along the
  span, collectors and drag struts across it); N is integrated from a free end on the net field and must close.
- A wall line is one member across a gap inside the outline (strut) and splits at a gap outside it (notch); walls
  share the force of their own connected part of the line.
- Checks tab: equilibrium, closure of every member run, TD status, skill TD edge forces = integrator, seismic flag.
- Views: 1 basic shear, 2 TD shear, 3 net shear, 4 member force diagrams (+ table).

## TD engine (Phase 3)
- One call per transfer diaphragm. It is not the analysis of a regular diaphragm: that is the basic shear (Phase 4);
  a TD adds its shears on top where a notch, offset or opening cuts a chord or strut.
- Frame (skill §2): y along the TD span from the support at y = 0 to the support at y = W; x along the TD length,
  edge x1 = lower plan coordinate. Plan axes are kept (a swap keeps the shear sign). A cantilever overhang must lie
  below y = 0: an overhang on the high side mirrors y, and plan unit shears / support forces change sign in and out.
- Geometry comes from the drawing (`tdFrame`); P and the basic / outside shears come from the plan in Phase 5.
  Engineer inputs (region clear, cantilever limits, closure tolerance) are asked when results first appear.

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
| `src/modules/tdFlow.js` | the skill's flow.yaml as data + JS expressions (generated, `--check` keeps it in sync) |
| `src/modules/tdCalc.js` | TD engine `runTd()`: runs tdFlow step by step; outputs, flags, step trace with citations; engineer inputs never filled |
| `tests/diaphragmAnalysisEngine.test.mjs` | Phase 3: skill tests T01–T21, invariants, stops, engineer inputs, trace, drawn book TDs → skill geometry |
| `tests/diaphragmAnalysisPlan.test.mjs` | Phase 1 tests (geometry, checks, tools, form, stored data, book layouts) |
| `src/modules/tdBasicShear.js` | Phase 4: load cases, span beams, section / band shears, line forces (TD hand-over), wall shares |
| `src/modules/tdViews.js` | Analysis tab: View 1 and the line / section tables |
| `src/modules/tdMembers.js` | Phase 5: basic-field member forces (section / Vierendeel chords, cross-line struts) |
| `src/modules/tdDerive.js` | Phase 5: each TD's skill inputs from the plan, TD engine runs per load case |
| `src/modules/tdLimits.js` | cantilever limits for the engineer's review (UNVERIFIED) |
| `tests/diaphragmAnalysisTd.test.mjs` | Phase 5: opening rule, book Nb values, derived inputs = T01–T08, TD runs, cantilever review, mirrored overhang |
| `src/modules/tdNet.js` | Phase 6: TD / net fields, members on every line, closure, checks |
| `tests/diaphragmAnalysisNet.test.mjs` | Phase 6: book values, closure, skill = integrator, line parts, views, checks |
| `src/modules/tdBookKeys.js` | tool value of a book key (Verification tab, book tests, book-cases doc) |
| `tests/diaphragmAnalysisBasic.test.mjs` | Phase 4: book values, statics, closed forms, bands, TD hand-over, load cases, B4, View 1 |
| `src/modules/tdWallLink.js` | Shear Wall Design link: `swdExtract`, direction guess, walls of the level placed on the plan, matching checks |
| `tests/diaphragmAnalysisLink.test.mjs` | link infra (many / from-inputs refs), walls on the plan, SWD line loads from DA, unlinked SWD untouched |
| `tests/td-book/src/toInputs.mjs`, `scripts/daSeedBook.mjs` | book layout → item inputs; seed project DA-BOOK |

## Commands
`npm run da:skill:build -- "<design-skills folder>" [--check]` · `npm run da:book:build [Ex4.1 …]` · `npm run da:book:doc` ·
`SB_EMAIL=… SB_PASSWORD=… npm run da:seed [-- --apply]` · `node tests/diaphragmAnalysisPlan.test.mjs`
