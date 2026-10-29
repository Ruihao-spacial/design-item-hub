# Transfer Diaphragm: decisions and backlog

Branch `diaphragm-analysis` (off `master` 71cdfb5). Plan: `~/.claude/plans/read-the-md-files-composed-kite.md` (approved 2026-10-29).
Guide: `docs/diaphragm-analysis.md`. Book cases: `docs/diaphragm-analysis-book-cases.md`.

## Next session — start here (set 2026-10-29, after Phase 2)
**State:** Phases 0–2 committed. Local `master` = `a60be7a` (SWD v24 `5539efd` + Diaphragm Analysis `b62a98b`,
merged locally, **not pushed**). Branch `diaphragm-analysis` = master. `npm test` green, SWD goldens identical.
**PRs (2026-10-29):** [#5](https://github.com/Ruihao-spacial/design-item-hub/pull/5) `sw-design-data-appendix` → master
(SWD v24) and [#6](https://github.com/Ruihao-spacial/design-item-hub/pull/6) `diaphragm-analysis` → master — merge #5 first.
Local `master` (a60be7a) is not pushed; after the PRs merge, reset it to origin/master.
Local DB (user, 2026-10-29): `upgrade:shearwall -- --apply` (34 SWD items now schema 13 / v24),
`seed:cases -- --apply` (SW-VERIFY 19 items at v24), `da:seed -- --apply` (DA-BOOK, 7 items). Checked read-only.
**Next:** Phase 3 (TD engine) — ON HOLD (user, 2026-10-29).
- Line-length check added: SWD line `totalLength` must equal the plan length of its grid (enter → leave the
  sheathed plan, ±0.01 ft); a mismatch is a plan error and red ✗ in the Setup line table.

## Earlier start-here (Phase 1)

**State:** Phases 0 and 1 built, nothing committed on this branch. `npm test` green (incl. 16 new plan tests), `npx vite build` OK.
- Done: skill data vendored (`npm run da:skill:build`, 21 skill tests, T4.2.2), book-case format + Ex 4.1 source,
  build / doc scripts, these docs. `yaml` added as a dev dependency (build script only).
- Book transcription of Ex 3.3, 3.4, 3.5, 4.2, 4.3, 5.1: see the Phase 0 entry below.

**Next (user):**
1. Seed the book examples: `SB_EMAIL=… SB_PASSWORD=… npm run da:seed` (dry run), then `-- --apply` → project DA-BOOK.
2. Open each DA-BOOK item next to its book figure (Plan + Verification tabs); draw one plan from scratch in a new
   item (tools, snapping, pan / zoom, panel edits, save / reopen).
3. Then Phase 2 (Shear Wall Lines) with its 3 open questions.

## Phase 1 review fixes (user comments 1–5, 2026-10-29)
1. Renamed **Diaphragm Analysis**, id `diaphragm_analysis` (user Q8, 2026-10-29: full diaphragm analysis; transfer diaphragms are the method for irregular layouts). Files, docs, scripts (`da:*`), seed project `DA-BOOK` and the branch `diaphragm-analysis` renamed too; items saved during testing under the old id do not open.
2. **Diaphragm definition** added: `diaphragms[]` (mark, dir, rectangle clipped to the sheathed plan, two support
   lines, sheathing / blocking overrides). Diaphragm tool; supports guessed at the rectangle ends. Checks: supports
   missing / wrong axis / outside / same line, overlap within a direction (errors); uncovered sheathing or no
   diaphragm for a loaded direction (warnings — do not fail the item).
3. **Snapping**: radius 14 px; grid intersection (green square) → grid line → corners of outline, openings,
   diaphragms, TDs and wall ends (orange) → 0.5 ft; snap guides; rubber band with live size while drawing; the
   readout says what it snapped to.
4. **TD supports in the panel**: guess now tolerates a TD drawn slightly off the grids (nearest line within
   max(0.5 ft, 8 px)); selects mark the chosen option after the options exist; the status line names the guessed
   supports / load line. Checked in Chrome (harness page): a TD drawn by mouse shows ↔ A / ↔ B.
5. **Load directions**: switch "Load along y (↕) / Load along x (↔)" on the Plan tab; diaphragms, TDs and loads
   belong to a direction (`dir`); the drawing shows only that direction, with a load-direction legend; the panel
   lists that direction's diaphragms, TDs and loads. Older TDs / diaphragms take the direction of the first load.
- Book converter: one default diaphragm per load direction (whole plan, between the outermost wall lines); book
  sub-diaphragms (Ex 3.3, 3.4, 4.2) to be set when the basic shear is checked (Phase 4).
- Tests: 19 in `tests/diaphragmAnalysisPlan.test.mjs` (3 new for the review). DA-BOOK not seeded yet (user: later).

## Phase 1 log (2026-10-29)
- Module `diaphragm_analysis` registered (after Diaphragm to LRS). Tabs: Setup (ELF link + level, code edition,
  basis, sheathing, blocking) · Plan (editor) · Analysis / TDs (placeholders) · Checks (plan issues) · Verification
  (book cases: ΣA compared now, book values listed as pending).
- Files: `tdGeometry.js` (parse, plan checks, ΣA, sections / bands / depth with side, panels), `tdModel.js`
  (constructors), `tdMigrate.js` (schema 1, normalise, no-loss helpers), `tdPlanEditor.js` (tools Select, Grid ↕ / ↔,
  Outline, Opening, Wall, TD; snap grid → outline corner → 0.5 ft; wheel zoom, drag pan, Delete key; property panel
  for grids, outline corners, openings, walls, TDs (supports, load lines, overhang), loads (seismic / psf / line with
  edge and segments)).
- New TD: supports guessed as the grids at the ends of its long side, load lines = the grids inside.
- Save is not blocked by plan issues (they show on the plan and the Checks tab), so a half-drawn plan can be saved.
- Tests `tests/diaphragmAnalysisPlan.test.mjs`; frozen fixture `tests/fixtures/legacy-td/schema1-ex41-plan.json`.
  `tests/links.test.mjs` chain gained a TD item (every registered module must regenerate its results there).
- Seed: `scripts/daSeedBook.mjs` (`npm run da:seed`), converter `tests/td-book/src/toInputs.mjs`.
- Not checked in a real browser by Claude (Node stand-in DOM only): mouse tools, pan / zoom, focus while typing.

## Rules for this work
- Shear Wall Design is not touched: no edit to or import from `shearWall*.js`, its tests, goldens or saved items.
- Diaphragm to LRS files are not edited; read-only reuse (beam solver, ELF link pattern) is fine.
- Commit / push / DB writes only on the user's request.

## Decisions (user, 2026-10-29)
1. Interactive plan page (grids, outline, openings, diaphragms, TDs); the TD skill applies to the drawn TDs.
2. New design item; loading like Diaphragm to LRS; one level per item.
3. Flexible diaphragm, span by span. Continuous: far future.
4. Unit-shear integration is the only path for chord / strut / collector / drag forces; no M/d in the tool.
5. At least 4 views: basic, TD, net unit shear; member force diagrams on the plan.
6. Shear Wall Lines: a dedicated, permanent module (capacity or deflection distribution), independent of Shear Wall Design.
7. Plan editor first (Phase 1) so every later phase can be checked on screen.
8. The 7 book examples are the tool's tests, compared on final values; loads entered as the book applies them.

## Phase 0 log
- 2026-10-29: pages rendered with PyMuPDF (user-installed) into the session scratchpad; the PDFs have a text layer
  and equation images. All 7 examples transcribed: 366 values (`npm run da:book:build`, all validate).
- **Format extensions** (FORMAT.md): `edge` on line loads (Ex 4.3, 5.1 split wind by chord), `V:<station>:<band>`,
  `tdP:<TD>:<grid>`, `expectedNonClosing` (Ex 3.3), `shearElement: 'mirrored'` (Ex 3.3, 4.2 draw the mirror "+"
  element; the build negates their unit shears into the tool's Ex 4.1 convention).
- **New book errata** beyond the skill notes, all recorded in the sources. Notable: **Ex 4.3 p3 v3 = 8800/56 printed
  167.9, correct 157.14** — the skill's tests.yaml T05 uses the printed value; tell the skill author. Ex 3.3 Fig 3.21
  line A values recomputed; Ex 5.1 p21 F5D = 11,448.
- **Method points the engine must cover** (from the transcription; decide in the phase that needs them):
  1. Ex 3.4: the book splits the plan into sub-diaphragms; the upper one is supported on strut line 1, which rests on
     the cantilever TD. A span support can be a TD / strut (like DLRS diaphragm-on-diaphragm), not only a wall line.
     The TD load is that reaction (4620 lb), not the basic-field strut force (2310 lb). → Phase 4/5.
  2. Ex 5.1: chords around an opening have no free end; the book sets the Vierendeel inflection at mid-opening
     (grid 3, force 0) and splits shear between the bands by sheathed width. → Phase 5 rule.
  3. Ex 3.3: load to offset lines by the wall-length-weighted average distance (46.1 ft) and a 400 lb trial shift
     until closure. → Phase 7 question.
  4. Ex 4.2: one strut force split equally between two TDs (engineer input); bands loaded in proportion to width.

## Open items
- Questions before Phase 2: see "Questions for the user" below.
- Phase 5 questions: one TD per side of a notch or the user's choice; load lines for an opening with 2 chords.
- Phase 7 question: Ex 3.3 weighted-average tributary refinement vs flexible tributary + closure flag; tolerance.

## Phase 1 review 2 (user, 2026-10-29)
1. **Diaphragm supports auto-selected like a TD.** Diaphragm and TD rectangles snap their edges onto grid lines
   within max(0.5 ft, 8 px); supports = the outermost lines inside the rectangle across the span (a line short of an
   end = overhang / cantilever; one line = one support, named in the message). Status line names the result.
2. **Esc** anywhere on the page (not only on the drawing): cancels the drawing in progress → clears the selection →
   back to Select. Delete removes the selection unless typing in a field.
3. **Drag edges** of the selected diaphragm / TD (Select tool): handles on the 4 edges; the edge snaps (grid line
   first), preview shows the value; a support on the moved edge follows to the grid at the new edge; dragging past
   the other edge flips; no zero-width rectangle.
- Checked in Chrome (harness): drawn diaphragm → 0–60 × 0–50, supports ↕1 / ↕3; right edge dragged to grid 2 →
  supports ↕1 / ↕2, coverage warning cleared; Esc cleared the selection.
- **Q8 rename** done: module id `diaphragm_analysis`, `src/modules/diaphragmAnalysis.js`,
  `tests/diaphragmAnalysisPlan.test.mjs` (22 tests), docs `docs/diaphragm-analysis*.md`, scripts `da:*`
  (`da:skill:build`, `da:book:build`, `da:book:doc`, `da:seed` → project DA-BOOK), branch `diaphragm-analysis`.

## Answers (user, 2026-10-29) to the questions before Phase 2
1–2. Wall capacity and stiffness: **use the values of the Shear Wall Design module.** Taken as: Shear Wall Lines
   reads Shear Wall Design's tables and methods **read-only** (import, never edit). This relaxes the earlier
   "no import from shearWall*" rule; a later change in Shear Wall Design then also changes Shear Wall Lines results.
   (To confirm at the start of Phase 2: tables/method, or values from a linked Shear Wall Design item?)
3. Shear Wall Lines is a **separate module linked** to Diaphragm Analysis.
4. Lines and locations must **match** between the two modules (grid names + positions).
5. **Two-way**: Shear Wall Lines shows the line forces / wall unit shears from the linked Diaphragm Analysis item.
6. Diaphragms and TDs stay **rectangles**.
7. A diaphragm may **cantilever** (book Ex 3.4). Collector / strut lines are **not drawn by the user**: every grid /
   wall line run inside the plan is a member, and the integrator (Phase 5) finds the chord, strut, collector and drag
   forces on all of them. The user only defines what cannot be inferred: each diaphragm's supports (a support line
   with no wall = a collector / strut line) and the TD that carries a disrupted force. A support line with no wall
   delivers its reaction into the TD whose load line it is (Ex 3.4); a later helper can suggest that TD.
8. Rename to `diaphragm_analysis` — done.

## Bug fixed 2026-10-29: item "Diaphragm Analysis — Roof — 0 TDs — plan has errors" did not open
- Cause: the rename (Q8) changed the module id; the item (project Test1) was saved as `transfer_diaphragm`, saves
  never rewrite an item's type, so `getModule` found nothing and the page went back without a message.
- Fix: modules may list `formerIds`; `getModule` falls back to them (`registry.js`). Diaphragm Analysis lists
  `transfer_diaphragm`. The item's data was checked in Node (opens; its two plan issues: a blank outline corner and
  D1 without supports). Frozen as `tests/fixtures/legacy-td/schema1-test1-old-type.json` with its stored type.

## Phase 2 plan revised (user data flow, option a) — see the plan file, "Phase 2"
Shear Wall Lines keeps an SWD-shaped wall definition and runs SWD `calcAll` read-only with the line forces from DA as
`levelLoads`; DA owns grids, Shear Wall Lines owns walls; DA's calc runs the force → share loop (one pass; iterative
only for offset wall groups, Phase 7). To confirm before 2a: all levels in one Shear Wall Lines item; segmented walls
first; wall dead load optional; grids owned by the DA plan.

## Decision 2026-10-29 (user): option B — link inside Shear Wall Design
- Not a separate / copied module: SWD gets an optional "line loads from Diaphragm Analysis" link (additive only);
  all wall types through SWD's own form. All levels in one SWD item; SWD lines match DA grids by name.
- Rule change: SWD files MAY be edited for this link only. Guard: SWD CALC_VERSION unchanged; all SWD goldens,
  legacy fixtures and the `upgrade:shearwall` dry run identical; unlinked items gain no fields.
- Build B1–B4 (plan file, Phase 2): results.js inputs-refs → SWD link + direction mapping → DA link, line origins,
  walls on the plan, matching checks → force / share loop (Phase 4 one pass, Phase 7 offset iteration).

## Phase 2 log (2026-10-29) — option B built (B1–B3; B4 needs Phase 4 line forces)
- **B1 link infra** (`src/results.js`, `src/views/itemForm.js`, `src/clone.js`): a ref may be `many: true` (a list of
  item ids → `[{ id, …extract }]`) and/or `from: 'inputs'` (extract reads the upstream *definition*; its own refs are
  not resolved, so it can never close a cycle). Clone remaps lists (deleted targets dropped). Single refs unchanged.
- **B2 Shear Wall Design (additive, `shearWallDesign.js` only, +~75 lines):** ref `diaphragmSources` (many, one DA
  item per level) → `{ level, lineForces }`; `linkDiff` / `applyLinks` copy each line's 1.0E / 1.0W at the level of
  the same name into `line.levelLoads` (keyed by SWD direction / line ids, so SWD needs no mapping); Loading section
  lists the project's DA items with a tick box; ticked levels' load inputs are greyed out. Guard met: `shearWallCalc.js`
  untouched (CALC_VERSION v23 on this branch), all SWD goldens identical (`cases:diff`), all SWD tests / legacy
  fixtures pass, unlinked items unchanged by linkDiff / applyLinks. **To do by the user:** `upgrade:shearwall` dry run
  on the local DB (needs SB_EMAIL / SB_PASSWORD).
- **B3 Diaphragm Analysis:** ref `wallSource` (from inputs) → `swdExtract` (levels, directions, lines, walls with
  WSWH width); Setup section "Shear walls (from Shear Wall Design)": pick the item, map each SWD direction to load
  along x / y (guess from N-S / E-W), line origin per line (blank = where the grid enters the plan). The walls of the
  DA level are drawn read-only (indigo, FTAO / WSWH tagged), the Wall tool is disabled, checks: level name, line ↔
  grid name, direction mapping, wall position / length. Outputs gain `level`, `wallLink`, `lineForces` ([] until
  Phase 4, then `{ swdDirId, swdLineId, E, W }` in kip).
- New file `src/modules/tdWallLink.js`; tests `tests/diaphragmAnalysisLink.test.mjs` (8). Checked in Chrome (harness):
  DA plan shows SW-1 5–25, SW-2 (WSWH 24 in) 30–32, SW-3 0–50; Setup mapping table; SWD lists the DA item ticked
  and greys out the 3 Roof load inputs.
- **B4** (the force → share loop: DA runs SWD `calcAll` with its line forces; same shares in both modules) is built
  with Phase 4, when DA produces line forces; offset-group iteration with Phase 7.
