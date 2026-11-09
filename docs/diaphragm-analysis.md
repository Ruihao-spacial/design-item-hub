# Diaphragm Analysis: calculator guide

Module **Diaphragm Analysis**, id `diaphragm_analysis` (former id `transfer_diaphragm`). Built 2026-10-29: Phases 0–6 (book cases, plan editor and checks, Shear Wall Design link, TD engine, basic shear / line forces, derived TD inputs and TD runs, net field / member diagrams / Views 1–4 / checks); 2026-10-30: Phase 7 (offset wall lines, line forces iterated to closure). 2026-11-02: diaphragm pieces (schema 2), hard checks, opening / cut-chord rules G1, G3–G6 (see "Openings, cut chords and closure"). 2026-11-03: book case Ex 8.4 and the general closure solver (G2, G7, G8, G9); fixes from the user's own test (project 26999, td-v10 — section "User test 2026-11-03"). 2026-11-04: TD overhangs picked by grid (both ends), TD loads anywhere from tip to tip, a case with open member runs fails (td-v11 — section "TD overhangs and loads anywhere"). 2026-11-05/06: walls of the story above / transfer, SWD grid link, collectors, force levels (td-v12 — sections "Grid link", "Walls that end at a floor", "Walls of the story above", "Collector extent"; committed 87aceab, PR #7). Phase 8 (PDF, upgrade script) on hold (user).
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
   starting at 0 at a free end; N back to ~0 at the far end is the closure check. M/d is not used for reported
   member forces (it equals the integral for a constant-depth chord); it is used only for the basic-field force P
   that a TD takes (5. — M/d of the cut band, or M/H at a chord cut inside an opening, 2026-11-02).
5. **Disrupted force P** = the integrated basic-field force where a chord or strut is cut.
6. **TD analysis** per the skill (reactions, segment shears, net shears, edge members, closure, aspect / blocking).
7. **Net field** = basic + TD shears; member diagrams on the net field.

## Plan model
- UI (user 2026-11-06, view only, no stored field): **messages under the plan** — errors and warnings grouped by
  type (`tdMessages.js`: grids not on this plan (own group), grids, outline and openings, diaphragms, TDs, wall
  lines, walls above, Shear Wall Design link, loads, other), errors first, numbered E1… / W1…; groups collapse
  (kept across redraws). **Diaphragms & TDs page**: a Diaphragms tab and a TDs tab (count, red ● on an error), a
  sub-tab per item showing its one card; a sub-tab selects the item on the plan, an item picked on the plan opens
  its tab. **Analysis views**: member diagrams and force / wall-share labels drawn above the walls (layer
  `td-view-top`); switches *walls below (this level)* and *walls above (story above)*. Test `tests/daUi.test.mjs`
  (project 26998, fixtures `t98-*`).
- Editor details (user 2026-11-03): panel sections collapse (▾ / ▸; kept in the editor state across redraws, pages
  and directions); editing any field of a row selects that row at once (no redraw); **Lock grid lines**
  (`inputs.gridsLocked`: names / positions read-only, no add / delete, grid tools off); outline corners **picked on
  the plan** (⌖ re-pick, +⌖ insert after, + Corner (pick)), numbered corner dots on Grids & outline and a ring on the
  selected / picked corner, Delete removes the selected corner; **Ref only** grids = reference stations (e.g. CL):
  drawn lighter, read values there, never a support / load / wall line; the Diaphragms page names diaphragms / TDs of
  the other direction with their issues; Diaphragm / + Piece / TD need a closed outline; the mouse wheel never changes
  a number field (it scrolls).
- Plan tab input pages (user 2026-11-03): **Grids & outline** (grid lines, outline, openings) · **Diaphragms & TDs**
  (load direction, diaphragms / pieces, TDs, loads note) · **Shear walls** (walls, or the linked SWD walls read-only).
  The page buttons sit in the right column above that page's inputs; each page has its own tools and tables; the whole
  plan is drawn on every page; picking an item on the drawing opens its page.
- Shared by both load directions: grids, outline, openings, shear walls.
- Per load direction (`dir` = the axis the load acts along): diaphragms, TDs, loads. The Plan tab shows one direction
  at a time with a load-direction arrow.
- A **diaphragm** is one or more rectangles (**pieces**, D1.1, D1.2 …; schema 2, user 2026-11-02) analysed as one
  beam between two support lines across the span (for a load along y: two ↕ lines); its depth at a section = the
  pieces there ∩ the sheathed plan. The book's rule (Ex 3.5 Fig 3.27, Ex 8.1 §8.3 Fig 8.7): a plan is split into
  separate diaphragms only at a support line (shear wall, or a strut / collector into a TD — Ex 3.3, 3.4, 4.2, Ex 8.1
  Diaphragms 1 / 2 at wall line 6); a change of depth, a notch or an opening is *not* a split — the pieces of one
  diaphragm follow it (Ex 3.5: 1–2 C–A, 2–5 D–A, 5–6 D–B; Ex 5.1: around the opening).
- **Openings belong to the plan** (outline minus openings = the sheathing). **Hard checks** (errors, the item is not
  analysed): a diaphragm piece outside the outline (`dg-part-outside`) or over an opening (`dg-part-opening`);
  pieces overlapping (`dg-part-overlap`, `dg-overlap` between diaphragms of one direction); pieces not forming one
  region (`dg-split`); a support line that does not cross the diaphragm; a TD outside the outline (exact test) or
  over an opening. Uncovered sheathing stays a warning. Sheathing / blocking per diaphragm, default from Setup.
- Editor: the Diaphragm tool cuts the drawn rectangle to the free sheathing (outline, openings and the other
  diaphragms of the direction left out) — one or more pieces; **+ Piece** adds the free sheathing of a rectangle to
  the selected diaphragm; **Fill between supports** (panel) makes the pieces from the two support lines. Each piece
  has its own row (x1 x2 y1 y2) and edge handles; Delete removes the selected piece first.
- Upgrade (schema 1 → 2): a stored rectangle is cut into pieces at the depth changes / around openings (same
  results); the rectangle stays in `x1..y2` as the record of where the pieces came from (shown in the panel, not
  used). Book cases: `docs/diaphragm-analysis-book-cases.md` lists every diaphragm with its pieces.

- **Grid lines (user 2026-11-05):** the Grids & outline page lists them on two tabs, **N-S grids ↕** (x = const;
  columns x, y1, y2) and **E-W grids ↔** (y = const; y, x1, x2); "+ Grid" adds to the open tab, a grid picked on the
  plan opens its tab. **A grid may stop early**: `grids[].from / to` = its extent along the grid (blank = across the
  whole plan; old items open with both blank, nothing changes). A bounded grid is drawn and snapped over its extent only
  (bubble at each bounded end). Error `grid-extent` when a wall runs past the end of its grid, or a diaphragm support,
  TD support / load line / overhang tip does not reach across the diaphragm / TD; `grid-off-plan` also when the extent
  misses the outline; Auto TD load lines skip a grid that stops before the TD edge. Helpers `gridReaches`,
  `gridCovers` (tdGeometry). Tests `tests/diaphragmAnalysisGrids.test.mjs`. Next: Shear Wall Design sees only the grids
  that cross its line (plan `docs/diaphragm-analysis-offset-transfer-plan-2026-11-05.md`, Part A).

## How to draw diaphragms and TDs (modelling guide, user test 26998, 2026-11-06)
Rules found on project 26998 "Cotoros Main Test" Roof (fixtures `tests/fixtures/da-user/t98-*.json`). Every rule
was tested: each wrong layout below failed closure; the layout described here closes both directions
(Σ 60 k each way). Work one load direction at a time.

**1. Start from the wall lines, not the outline.** List the lines with walls for this direction (26998 along y:
B, C/D, G/H.3, M; along x: 2/3, 5/6, 8, 9). Only these are diaphragm supports. A wall-less grid as a support fails
(`line-no-wall`), unless a TD is drawn on purpose to take its force (rule 4, kind 2). 26998 first try: x diaphragms
on 1.7, 9 (x 57–66) and 8.8 — no walls there.

**2. One diaphragm per bay between two adjacent wall lines.** A notch or a change of depth is *not* a split: one
diaphragm, several pieces, one beam. Overhangs past the outer support are fine (26998: x 0–11 past B, 109–112
past M). Split only at a wall line, or for an offset line (rule 3). Adjacent diaphragms with the same two supports
can be one diaphragm (26998 x: D4 + D5 on 7 / 6, D6 + D7 on 8 / 6 give identical results merged).

**3. Offset line — each wall on the support line of its own diaphragm part (book Ex 3.3).** Split the bay along the
load direction where the strut leaves the walls of one line. 26998 C/D: the tab x 8–27, y 39.5–51 is a diaphragm on
B / C; above y = 51 D1 spans B / D. G/H.3: below y = 57 the parts on D / G and G / H.3; above, D2 on D / H.3. A wall
of the group inside a diaphragm that spans to its partner line double-counts (the strut line carries its basic force
plus the TD load; residual = the TD's P) — 26998 first try, C inside D1 on B / D, G inside D2 on D / H.3.

**4. TDs — only three kinds:**

| Kind | When | How to draw | 26998 |
|---|---|---|---|
| 1. Offset-line strut | every offset line (rule D1) | starts where the strut leaves its wall part; supports = the diaphragm it enters; load line = the strut grid | TD1 (C, y 51–57, B / D); TD4 (G, y 57–72, D / H.3) |
| 2. Wall-less support | a diaphragm supported on a line without walls, on purpose | load line = that line; the TD spans between wall lines | TD2 (F, from D4 on F / G); x: TD5 (line 4, from D8), TD6 (line 7), TD8 (struts 3 / 5 of the 2/3, 5/6 offset lines) |
| 3. Chord step | the diaphragm edge steps (re-entrant corner, notch) | full depth, edge to edge, on the deeper side of the step; supports = the two edge grids; load line = the stepped edge grid (book Ex 3.5, Ex 4.1) | TD9 (step at x = 100: 8.8 / 1.7, line 4); TD3 (step at x = 8: 7 / 2.6, line 6) |

**5. Do not draw:**
- a TD on a line that runs the full depth of its diaphragm through sheathing — the basic field already closes it, the
  TD counts its force twice (26998: TD3 on L, TD1 on A.8, TD4 on F; residual = −2098 / 773 / 497 lb = exactly P);
- a TD that no force reaches (NOT_RUN; 26998 x TD7 on 2.6);
- a TD behind another on the same load line — the first takes the load, the second gets nothing (26998 TD2 above TD1).

**6. Load lines:** Auto first; if it lists a full-depth line or an overhang tip, set by hand.

**7. Reading the Checks:** `line-no-wall` / `line-part-no-wall` → a support without a wall (rule 1–2);
`wall-in-span` → split there or make an offset line (rule 3); an open member run with residual = a TD's P → that TD
double-counts (rule 5); open runs on edge lines at a corner → a chord-step TD is missing (rule 4, kind 3).

**Order for a new level:** grids, outline, walls (SWD link) → diaphragms bay by bay for one direction, calculate →
clear `line-no-wall` / `wall-in-span` before any TD → TDs kind 1, 2, 3, calculating after each and reading which
member runs are still open → the other direction.

## Shear Wall Design link (Phase 2, option B)
- Shear Wall Design owns the walls (all types, all levels) and the distribution method; this plan owns the grids.
- Setup → "Shear walls (from Shear Wall Design)": pick the SWD item, map each SWD direction to load along x / y,
  optionally set each line's origin. SWD line names = grid names; SWD level name = this item's level.
- SWD → Loading → "Line loads from Diaphragm Analysis": tick the DA item of each level; its line forces are copied
  into the line loads (update notice when they change). Line forces are filled since Phase 4.

## Grid link with Shear Wall Design (user 2026-11-05, build step 3)
- Only for an SWD item that ticked its DA items (Loading → "Line loads from Diaphragm Analysis") **and** pressed **Adopt
  plan grids**. Nothing is written to an SWD item before that, so existing SWD items calculate and draw exactly as before
  (proof: `tests/swdFreeze.test.mjs`, and `npm run swd:freeze -- --db --check …` over the local DB).
- **Adopt** copies the grids of one DA item (default: the top level) into `inputs.planLink` and gives each SWD line a
  fixed start on the plan, `line.planOrigin`. The start is the one DA uses today, so no wall moves. Lines whose levels
  used different starts are listed (26997: B / C at x 10 on the roof, x 0 on the 2nd floor; the roof's start is kept).
- **SWD line header → "Starts at"** (number, or "at grid…"). Moving it keeps every wall, post, beam, beam support and
  gravity load where it is on the plan, and keeps the line's far end. The line length is then only how far the line is
  drawn.
- **SWD elevation:** a band above the top level carries a bubble for each grid that crosses the line. A bounded grid
  counts only where it reaches the line. Each level's diaphragm stretch on the line (from that level's DA item) is a
  teal bar on its floor / roof line. The interactive and PDF elevations are the same drawing, with the layer attached
  through `setElevationPlan`.
- **DA:**
  - Every DA item of the project takes the line start from SWD (`originFromSwd`; Setup shows "… (SWD)" instead of the
    origin field).
  - `link-length` is not checked for those lines. For the other lines it is checked only when the line has walls at
    this level (fix: the roof of 26997 errored on lines 1 / A / D, which have no roof walls).
  - New warning `grid-mismatch` when a DA grid of the same name differs from SWD's copy.
  - DA outputs `planGrids` and, per linked line, `at`, `axis`, `bands` (sheathed stretches, cut to the grid's extent).
- **Update notice:** a change of the DA grids / stretches shows "Plan grids and diaphragm stretches (grid link)" in SWD;
  Update refreshes the copy, never the line starts. **Remove grid link** deletes the copy and the starts (positions stay).
- Files: `shearWallPlanLink.js` (pure), `shearWallElevation.js` (layer), `shearWallDesign.js` (panel, header, extract),
  `tdWallLink.js`, `diaphragmAnalysis.js`. Tests: `tests/swdPlanLink.test.mjs` (26997 fixtures `tests/fixtures/da-user/hov-*.json`).
- Not built: wall drag snapping to grids in the elevation (optional in the plan).
- **User comments 2026-11-05 (fixed):**
  1. **One grid for all levels.** Grids & outline → "Grid lines: own / shared from <DA item>" (`inputs.refs.gridSource`,
     ref from the owner's inputs, `tdGridShare.js`). The owner edits the grids, and the other items show them
     read-only (no lock / + Grid / grid tools). A change in the owner shows an update notice per grid; Update brings
     it in. Grids are matched by axis + name, so ids and every reference are kept. A grid only here warns `grid-local`.
     SWD's Adopt defaults to the owner (DA outputs `gridsFrom`). The form gets its own item id through
     `hooks.itemId` (itemForm.js).
  2. **The "Plan grids … changed" notice that never went away:** the database (jsonb) stores object keys in its own
     order, and the copy was compared as a JSON string. It is now compared by value (`canon`).
  3. **No line-length check:**
     - `link-length` and the "Length SWD / plan" column are gone. The column is now "Sheathed here", for information only.
     - New warning `link-wall-sheathing`: a linked wall of this level that is not on the sheathing of its grid.
     - SWD line length (adopted items): from the plan, line start → end of the longest diaphragm stretch over all
       levels, never shorter than the farthest element. It is shown read-only ("70 (plan)") and kept in step on
       Adopt / Update / Starts at. This can change full-line gravity loads of an adopted item; unadopted items are
       unchanged.
  4. (2nd round) **Adopt panel:** DA items that share one grid are one choice ("DA - Roof … shared with DA - 2nd
     Floor"); a select appears only when levels have grids of their own.
  5. (2nd round) **Grids C / D missing on the N-S elevations:** the plan length was shown but written only on Adopt /
     Update / Starts at, so the elevation still drew 60 ft. An adopted item now opens with its line lengths from the
     plan (`withPlanLengths` in SWD's migrate; gated on `planLink`).
  6. (2nd round) **Zoom on every SWD elevation:** − / % / + / Fit next to Expand, and Ctrl + wheel about the cursor; the box
     scrolls both ways. At 100 % the drawing is exactly as before. The freeze compares the elevation without the zoom
     buttons (`data-elevzoom`) and still finds all 36 repo items identical, and 36 of 37 local DB items (26997 changed
     by its own adoption).

## Walls that end at a floor — SWD side (user 2026-11-05, build step 4)
- Only for an SWD item linked to Diaphragm Analysis (a ticked DA source). Every other SWD item calculates as before
  (freeze: 36 repo / 37 DB items, only the two linked test projects with a discontinued line changed).
- **Which walls:**
  - A wall whose line has **no wall at the next level down** ends at that floor automatically. Its force goes into
    the diaphragm of that floor (26997: SW-5 / SW-7 on 2, SW-11 / SW-12 on B, SW-13 / SW-14 on C).
  - On a line that continues (a **mixed line**), the wall panel has a tick "Ends at the … floor"
    (`wall.endsAtFloor`). Off by default, so the wall stays on its line and the line's walls below take its force
    through a collector along the line.
  - Bottom-story walls never end at a floor.
- **Calc** (`shearWallCalc.js`: `transferOn`, `endsAtFloorIds`, `lineWithTransfer`):
  - The flagged walls' 1.0E / 1.0W shares leave the line at the floor below. The calc runs on a copy of the line with
    levelLoads(below) − transferred, so story shears, the split, deflection and the checks follow by themselves.
  - Mixed lines are repeated until the shares settle; capacity and deflection methods are both tested.
  - Line result `transfer: [{ levelId, levelName, belowId, belowName, E, W, walls }]`.
- **G2** passes with "… k of Roof (SW-11, SW-12) transferred to the diaphragm at this floor". An unlinked item still
  fails G2 as before: the shear is lost there.
- **Elevation:** "↓ to diaphragm" under the flagged walls (`setElevationTransfer`, linked items only).
- **Deferred:**
  - B4, the direction check that Σ transferred at L = Σ transfer loads used by DA level L, comes with the DA engine
    (step 6).
  - B5, a calc-sheet note on posts under a flagged wall.
  - No CALC_VERSION bump: unlinked results are unchanged.
- Tests: `tests/swdTransfer.test.mjs` (26997 hand-calc loads: lines 2 / B / C transfer 10 k each; the base shear
  stays 30 k).

## Walls of the story above — DA side (user 2026-11-05, build step 5: read and drawn, no force yet)
- `tdWallLink.wallsAbove`: the SWD walls of the level directly above this DA level (SWD levels are stored top first),
  placed from the same line start as this level's walls (SWD `planOrigin` once the grids are adopted).
- Each wall is **transfer** (↓, amber) when its SWD line has no wall at this level, or when it is ticked "ends at this
  floor" in SWD. Its force goes into this diaphragm. Otherwise it is **through** (↕, grey): it continues down its line.
- **Plan tab:** the walls are drawn dashed beside their grid, with a "Walls above" filter (shown only when there are
  any).
- **Shear walls page:** a read-only table "Walls of the Roof story".
- Outputs `wallsAbove: { level, walls: [{ mark, line, swdWallId, swdLineId, dir, axis, at, from, to, kind, onSheathing }] }`.
- **Warnings:**
  - `above-type4` (info: Type 4 out-of-plane offset, §12.10.1.1 / 12.3.3.3);
  - `above-off-plan` (a transfer wall not on this level's sheathing);
  - `above-linkback` (SWD does not have this DA ticked, so it still carries the force down the line);
  - `above-origin` (grids not adopted in SWD; positions from this item's own origins);
  - `above-grid` (no grid for the line).
- No force yet: line forces are unchanged (step 6). Tests: `tests/daWallsAbove.test.mjs` (26997: 8 walls, 6 transfer).

## Walls of the story above — the engine (user 2026-11-05, build step 6; CALC_VERSION td-v12)
- **Forces:** V_w per wall above = SWD's own split of that level (`swdWallShares(swd, upperLevelId, [])`, 1.0E / 1.0W), in
  the case's load direction.
- **Transfer wall** (ends at this floor):
  - It is a concentrated load at its grid on the diaphragm(s) of the case that span across it, shared by depth like
    G7 (`basicCase` ctx.above, `ext` points). It counts in the diaphragm's load, so the equilibrium check and the
    closure solver include it.
  - On a support line or outside every diaphragm it is not applied → error `above-no-diaphragm`.
- **Members** (`tdMembers.wallR` + `aboveR`):
  - Every wall above is a source σ·V / L over its length on its grid's member.
  - A transfer wall's force leaves through the diaphragm, so that member is the **distributor** over the depth.
  - A **through** wall's force leaves through this level's walls on its line by their shares, so the member shows
    only the drag where the walls above and below do not line up (0 when stacked).
- **Line forces to SWD:** the diaphragm reactions, which include the transfer. A through wall's force is not in them,
  because SWD carries it down its line, so nothing is counted twice.
- **Outputs:** `wallsAbove.walls[].E / W` (kip), and `transferIn: [{ swdWallId, swdLineId, mark, kind, V }]`. The latter is
  what this diaphragm took from each wall (B4). The test shows it equals what SWD hands over at that floor.
- **Hand calc of 26997** (plan §3), all matched by `tests/daTransfer.test.mjs`:
  - load along x: A = D = 15 k, v at A = 214.3 plf; distributors B 5.07 k / C 5.29 k (SW-14 at 23, not 24.5); collector
    A 8.36 k;
  - load along y: line 1 = 13.571 k, line 3 = 6.429 k; line 3 drag 0 when stacked, a drag when SW-1 is moved;
  - every run closes.
- **Force levels (step 7)**, user decisions Q1 / Q2:
  - **1.0E** = own level + walls above, as analysed. The line forces go to SWD.
  - **Diaphragm** = k_D·own + Ω₀·walls above (× 1.25 when ticked, §12.3.3.5), per ASCE 7-22 §12.10.1.1 (Type 4).
    - Linear, so it is computed as k_D × one more run with the walls-above forces × Ω₀ / k_D (`calcAll` → `levelD`).
      That run has the same members and fields, so every diagram and closure check is exact.
    - `levelD` is kept in memory only (not enumerable, not saved; results are regenerated on open).
  - **Collector** = k_C × (own + walls above) — ELF's k_C already takes the max of the §12.10.2.1 cases.
- **Setup → Seismic loading → "Transfer from the walls above"** (only when walls end at this floor):
  - Ω₀ (`level.transferOmega`; blank = the linked SWD item's Ω₀, else 2.5);
  - "+25 %" (`level.transferIncrease`);
  - the resulting factor.
- **Analysis tab:**
  - The "Forces shown" line names both parts at every level.
  - A table lists each wall above: where it goes, V at 1.0, V at the level shown, and V / L into the floor (the
    wall-to-floor transfer connection, plf).
- **Plan tab → Shear walls page:** the walls-above table has V (k) E / W.
- **B4 in SWD:** Loading shows per floor "handed over X k (lines …) · DA item took Y k ✓ / ✗", only for linked items
  with walls that end at a floor.
- Tests: `tests/daTransfer.test.mjs` (12):
  - D at A = 1.2·71.43 + 2.5·142.86 = 442.86 plf, 532.14 plf with +25 %;
  - C = 1.68 × (214.29 plf, 8.36 k);
  - Ω₀ from SWD; levelD not saved;
  - the view text and table;
  - the SWD balance ✓.

## Collector extent of the walls above — option 2 (user 2026-11-05)
- **Default (blank) = full depth:** a wall that ends at this floor puts its force into every diaphragm of the case
  across its grid, shared by depth; its collector runs over the whole depth.
- **Collector from – to:** set per line on Plan → Shear walls, under the walls-above table
  (`inputs.aboveCollectors[swdLineId] = { fromId, toId }`, two cross grids; normaliser default `{}`). The force then goes
  only into the diaphragms lying wholly between the two grids, shared by depth. Their edges at the collector ends are
  chords.
- **Ends on diaphragm edges (user 2026-11-05):**
  - The from / to lists offer the grids and the edges of every diaphragm of that load direction crossing the wall's
    grid (the ends of its pieces there), e.g. "edge of D2 / D1 (y 50)".
  - A grid lying on an edge is labelled with it: "B (20) — edge of D3 / D2".
  - Stored: a grid end as `fromId` / `toId`, an edge as `fromAt` / `toAt` (plan coordinate); saved items unchanged.
- **Use it with the floor split into separate diaphragms at the collector ends** (26997, load along y: D3 / D2 / D1 at
  B / C).
- **Checks:**
  - error `above-collector-inside`: a collector end falls inside a diaphragm, i.e. a load on part of its depth. That is a
    TD case (option 3, gap G11), not option 2.
  - error `above-collector-short`: a wall above is not on its collector.
  - warning `above-collector`: only one end picked.
  - `above-collector-inside` and `above-no-diaphragm` are **plan errors** (fixed after the user's 26997 try with B / C
    collectors 2–3 on the single x diaphragm):
    - they were warnings; the walls' member sources were still added, so runs were left open by 10 k and the case
      FAILED with no reason given;
    - now: one message per line naming the fix, no source for a wall whose force is not placed, the case FAILED
      ("cannot be placed") and held from SWD.
- **Plan:** the collector is drawn as an amber line with end bars (full depth: nothing drawn).
- **Limit (user 2026-11-06, 26998 2nd Floor grid 6):** one collector per line — all walls above on that line share it,
  and blank = the whole line. Walls above landing on different diaphragms cannot yet each have their own collector
  (backlog, open item 6).
- **26997** (collector B–C on line 2), `tests/daTransfer.test.mjs`:
  - D2 takes all 10 k; D2 at line 1 = 3 + 8.571 k, 192.9 plf (full depth: 136 plf); D3 / D1 take 1 k each;
  - line 1 = 13.571 k (unchanged);
  - collector on 2 runs B → C only, max 5.75 k at y 45.5 (full depth: 5.45 k A → D);
  - chords B / C now carry force; every run closes.
- **Also fixed:** `tdMembers.crossForce` now breaks at the ends of the walls above. A TD reading a strut on such a grid
  got the wrong force (8 000 instead of −2 000 lb).

## Loads: seismic vs wind (2026-10-30)
- **No seismic load / No wind load** (user 2026-11-03): a button on each Setup loading page stores `inputs.noLoad.E / W`
  (no schema change; normaliser default false); it is the first thing on its page. Declared (seismic): only the level
  stays on the page (the Shear Wall Design link matches by level name). Declared: the kind's loads (if any) stay stored but are not analysed.
  Not declared and no load of that kind: warning "No seismic / wind load entered". DA-BOOK items declare the kind
  their example does not have (`daSeedBook.mjs`).
| | Seismic (E) | Wind (W) |
|---|---|---|
| Input | "Seismic F_x/ΣA" (F_x from ELF or typed) | "Wind": per segment a windward and a leeward plf (pressure × tributary height); or a line load on an edge |
| On the span beams | w(s) = q·d(s), q = F_x / ΣA (follows the sheathed depth, openings carry nothing) | windward strip → the band on the windward face, leeward strip → the band on the leeward face |
| Matters when | always the same shape | at an opening: the bands get different strips (book Ex 5.1: 123 on A, 77 on D); without one only the net counts |
| Force level shown | 1.0E; Analysis can show × k_D (F_px / F_x) or × k_C (collector level), Setup | 1.0W as entered |
| To Shear Wall Design | 1.0E line forces (never the scaled ones) | 1.0W line forces |
- **Where loads are entered (user 2026-10-30): the Setup tab**, one page each — *Seismic loading* (level, F_x / ELF
  link, k_D / k_C, E loads per direction), *Wind loading* (W loads per direction: wind windward / leeward, line on an
  edge, area), *Shear wall link*, *General* (code, sheathing, blocking, method). A load's page follows its kind
  (blank kind: seismic → E, other modes → W); changing the mode on a page keeps it there. The Plan tab draws the
  loads (arrows, w(s) strip) and points to Setup.
- An Area (psf) load of kind W gets a warning (wind is not a plan-area load).
- Plan tab: the w(s) strip (plf, positive in the load direction) the beams carry is drawn beside the plan for every
  mode (below it for a span along x, right of it for a span along y), with its value at each step; the first load
  case of the direction shown.
- Seismic display factors k_D / k_C (`level.diaphragmFactor` / `collectorFactor`, blank = 1): the analysis stays at
  1.0E (linear), the Analysis tab scales every force / unit shear for display (`scaleCase`) and states the level in
  the "Forces shown" line. Setup suggests both from the linked ELF item (F_px design / F_x, collector design / F_x).

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

## TD load lines found from the plan (user 2026-11-03)
- Each TD: **Load lines: Auto** (default) or **Set by hand**. Auto (`tdGeometry.detectTdLoads`, run in `parsePlan`
  on every recalculation): a grid running like the supports, between them or on an overhang (past its support up to
  and including the tip, 2026-11-04), where a member
  arrives at one of the TD's long edges from outside — the sheathing changes across that grid just outside the edge
  (notch / outline step, or opening edge); fall-backs: a wall on that grid outside the TD, or the grid is a support
  line of another diaphragm reaching the edge. Side = the edge it arrives at, both edges → `both`. All 20 book TDs
  are found (test, with the entered lines erased; every book value unchanged). The wall reason counts only a wall that
  resists this load direction and whose grid runs on sheathing without a gap from the wall to the TD edge
  (`runsOnSheathing`; user test 2026-11-03: E-W walls and a wall across a notch made false load lines).
- None found → warning, the TD carries nothing (does not pause its case). Any number, anywhere from tip to tip
  (superposed runs, below). Set by hand: today's grid / side controls, pre-filled with the found
  lines; the card says what the plan gives when they differ.
- Stored `tds[].loadsMode` 'auto' | 'manual' (no schema change). A TD saved before becomes 'auto' when its entered
  lines are the found ones, else 'manual' (kept as entered). Supports stay as entered / guessed (user: keep for now).

## User test 2026-11-03 (project 26999 Cotoros ADU Test; plan `docs/diaphragm-analysis-fix-plan-2026-11-03.md`)
- **Any number of load lines on a simple-span TD.** The engine takes P1 / P2; a TD is linear in its loads, so with three
  or more lines `tdDerive.superpose` runs the engine once per load line (that load alone, basic / outside shears 0) and
  adds the runs: support forces Σ, unit shear on each stretch between supports and load lines Σ (`r.segsLocal`). Net
  shear and members come from the tool's integration as for any TD; the engine's edge values hold for one load each, so
  the "skill = integrator" check says "not compared" and the member closure covers the edges. Proof (test): every book
  TD run this way equals its direct run (all book values and every member run, 1e-6). TDs tab: load table, stretches.
- **Strut TD loaded from both edges** (Auto side `both`): P = N at the high edge − N at the low edge (as G1); it was 0.
- **Closure solver keeps equilibrium**: Σ line forces − load is an equation (weight 10³; the ridge is scaled by the
  member rows only, so book cases still close in one step). A case whose line forces still do not balance **FAILS**
  (`equilibriumGate`): FAILED check, TD / net / member values not reported, line forces held from Shear Wall Design.
- **Offset line needs a strut** (user decision D1): error `group-no-path` unless a TD of that load direction has one of
  the group's lines as a load line and another as a support or load line (Ex 3.3 TD1 B → C, Ch 8.4 TD1 D → E). Without
  a strut the walls are separate lines of resistance; a strip with no wall under it is then shared by where the plan is
  divided (2nd floor case D: line 3.8 split equally into two TDs = the diaphragm split at mid-strip).
- **Checks:** `load-opposite` (loads of one case in both senses — they cancelled), `load-seismic-twice`, one seismic
  F_x / ΣA load per direction on Setup (the + button hides); `grid-off-plan` (one warning listing them); `wall-in-span`
  (a wall inside a diaphragm's span that takes no force — split the diaphragm at each wall line, Ch 8.4);
  `td-past-support` (a simple-span TD drawn beyond its supports).
- Fixtures `tests/fixtures/da-user/` (the user's items), tests `tests/diaphragmAnalysisUser.test.mjs`. CALC_VERSION td-v10.

## TD overhangs and loads anywhere (user 2026-11-04, project 26999 "ADU - Roof" E-W TD2)
- **Overhangs picked by grid:** TD card → Overhangs → "+ overhang", then **from** (one of the TD's supports) **to** (the
  grid at the tip). One per support, so a TD may overhang both supports. "+ overhang" proposes the support the TD runs
  past and the grid at that end. Stored `tds[].overhangs: [{ fromId, toId, at }]` (no schema change). A TD saved with
  typed values (`overhang: [a, b]`) gets them as grid picks on open (normaliser; the typed values stay as the record);
  a typed tip with no grid keeps its value in `at` and warns `td-overhang-grid` (add a grid there and pick it).
- **Checks:** `td-overhang` (from is not a support, no tip, runs toward the other support, two from one support),
  `td-overhang-tip` (the TD does not end at the tip), `td-past-support` now also on an end of an overhanging TD that
  has no overhang there (the user's TD2 drawn y 0–32: 3 ft past support 2).
- **Loads anywhere from tip to tip, any number:** the TD is a beam on two supports with overhangs (statics:
  R_top = −Σ P·y / W, R_bot = −Σ P·(W − y) / W). The engine runs directly only for one or two loads between the supports
  or one load at the tip of a single overhang (Ex 3.4); everything else is superposed, one run per load by where it is:
  between the supports → simple-span run (no shear on the overhangs); on the overhang below the bottom support →
  cantilever run (shear support → load, 0 from the load to the tip); on the overhang past the top support → the same
  run mirrored (y′ = W − y; shears change sign, top / bottom forces swap); **on a support** → straight into that
  support, no TD shear (warning `td-load-on-support`). With only a high-side overhang y is mirrored as before.
- Cantilever review (skill S062) is asked when a load on an overhang carries force (one limits list per overhang).
- Proof (tests): Ex 3.4 superposed = its direct cantilever run (forces, shears, every member run); overhangs at both
  ends + the mirror image of that layout (a load past the top support) = beam statics and the same member forces;
  the user's Roof E-W with TD2 drawn y 0–29 (or kept 0–32 with a second overhang 2 → 1.7): TD2 loads 4 = −2262 lb
  (back span), 5 = −354 lb (on support 5), 5.5 = 0 (D3's free edge), forces 2 / 5 = −283 / −2334 lb, every member run
  closes, SW-8 / SW-10 / SW-6 = 4888 / 3945 / 7908 lb.
- **A case that balances but has open member runs FAILS** (user Q2, 2026-11-04): FAILED check naming the open runs,
  line forces held from Shear Wall Design (null, warning `swd-held`), but the TD / net / member views stay on screen so
  the open runs can be found (banner "FAILED — member runs do not close"). An unbalanced case is handled as before.
- A TD support line without a shear wall is normal (user Q1: Ex 3.5's TD) — no warning.
- CALC_VERSION **td-v11**. Fixture `tests/fixtures/da-user/adu-roof-1104.json`.

## Disrupted forces and TD inputs (Phase 5)
- Basic-field member forces (`tdMembers.js`): chords ±M/d of the band (single band), or Vierendeel from the
  inflection in an opening stretch (rules for openings: "Openings, cut chords and closure" below); cross lines
  (struts / collectors) integrated from a free end, equal split between two TDs (Ex 4.2).
- Each TD's skill inputs come from the plan (`tdDerive.js`): P = chord force at the TD edge × side (chord TD), or the
  sum of both edges for a load line with side 'both' (G1), or the wall-less line force handed into it (strut TD);
  edge / outside shears from the basic field, + a wall on an edge (averaged per segment where a wall or sheathing
  edge ends inside the segment — G5).
- **Wall of the load line inside the TD (td-v13, user test 26998):** a wall on a strut TD's load line that runs past
  the TD edge into the TD takes its share straight out of the member there; that part is added to P (as if the
  member were integrated on to the wall end). Before, P stopped at the TD edge and the member did not close
  (26998 2nd Floor: SW-8 0.5 ft into TD1, −405 lb on B).
- Engineer inputs: region clear = drawn TD; cantilever = the engineer's review of the listed limits (UNVERIFIED);
  closure tolerance = 1 % of |P1| + |P2| (code constant).

## Net field, members, checks (Phase 6)
- Net field = basic + the TD segment shears inside each TD. Every line is a member (chords and struts along the
  span, collectors and drag struts across it); N is integrated from a free end on the net field and must close.
- A wall line is one member across a gap inside the outline (strut) and splits at a gap outside it (notch); walls
  share the force of their own connected part of the line.
- Checks tab: equilibrium, closure of every member run, TD status, skill TD edge forces = integrator, seismic flag.
- Views: 1 basic shear, 2 TD shear, 3 net shear, 4 member force diagrams (+ table).
- Member closure (user 2026-10-30; values user 2026-11-03): |residual| ≤ max(`CLOSURE_LB` = **30 lb**, `CLOSURE_REL` =
  **5 %** of the run's largest |N|) — `tdNet.closes`, the pass / fail limit of the Checks tab and the View 4 table. The
  closure solver does not stop there: it runs to residual ~0 (one pass), so a looser limit never weakens the forces.

## Offset wall lines and the closure solver (Phase 7, general solver 2026-11-03)
- **When is a line an offset line of resistance?** Only when the engineer says so: walls with **one wall line name on
  two or more grids** across the span (book Ex 3.3: SW1 on B, SW3 / SW4 on C = "B/C"; Ch 8.4: SW5 on D, SW6 on E =
  "D/E"). The tool does not guess it from the geometry. The group's force is shared by wall length across its grids
  (rigid line). Walls with different names stay separate lines, also on the same grid (G8: SW7 on E = line "E7" takes
  only the force entering its own part of E). Typical sign that a group is needed: a TD whose load line is a wall line —
  the TD tab warns "give its walls on every grid one wall line name".
- The wall on one grid can then take more than the diaphragm delivers there; the excess runs along that grid as a
  strut into the TD that has it as a load line (P = the strut force at the TD edge), and the TD hands it to its
  supports. So these forces are not known before the TDs run.
- **General closure solver** (`tdClosure.js`, user 2026-11-02; replaces the Phase 7 offset iteration). Unknown
  hand-over forces, each starting at the flexible value (0 change):
  - **group** — an offset wall line's total force;
  - **line** — every other wall-line part (a TD reaction on a wall line changes its force);
  - **collector** (G7) — a wall-less line with no TD left holding force hands it as a **concentrated load** to the
    diaphragm(s) spanning across it (shared by depth); the receiving diaphragm's basic shear is recomputed each pass
    (G9), staged when one receiving diaphragm feeds another collector (Ch 8.4: collector B → Diaphragm 5);
  - **td** (G2) — a TD reaction on a line that loads two or more other TDs splits between them (Ex 8.1: TD2 on
    collector B between TD1 and TD3). With a single loaded TD the member rule stands (Ex 8.1 line D: G4 decides).
  Every member run must end at N = 0; all run residuals are the equations. Gauss–Newton with a finite-difference
  Jacobian and a tiny ridge (a force closure cannot fix — Ch 8.4 A.2 equal split — stays at its start). The statics
  are linear, so one step closes exactly; max 8 passes, else the check fails. Only cases with a group, a collector or a
  G2 split are solved; the others run once, unchanged.
- Results: Ex 3.3 1 pass (exact closure R_A 4580.5; the book's 4600 is its trial shift), Ex 8.1 1 pass (B split 553 /
  1781, book 550 / 1783.3 by trial and error), Ex 8.4 1 pass (strut D into TD1 159.7 lb; the book stops at 137.4 because
  its SW5 + SW6 total leaves out that strut force — G10, erratum p11). Run time ~4–13 ms per item.
- **Linked walls (Shear Wall Design) — option B, user 2026-11-03.** Each SWD line sits on one grid, so a group is chosen
  on **Setup → Shear wall link → Offset lines of resistance**: a name and two or more SWD lines of one direction
  (`wallLink.groups: [{ id, name, lineIds, exclude }]`; a wall can be left out). The group's story shear
  T = F + Σ (force from the stories above on each line) is shared by the group walls the way SWD shares a line:
  capacity method — by capacity × length (SDPWS 4.3.3.4.1, read from SWD's own split); deflection method — SWD's
  `equalDeflectionSplit` over the group walls with each wall's δ(V). Each grid's force = its walls' share − its force
  from above; each SWD line gets its grid's force back (unchanged link). Because SWD's shares depend on the forces
  (auto nailing, δ not linear), `solveLinkedGroups` (diaphragmAnalysis.js) repeats: SWD copy with the current line
  forces → weights → closure solve, until no weight moves more than 1e-5 (max 6 rounds). Typed walls keep the
  wall-length split. Tested on Ex 3.3 linked: same walls → the book's split and every phase-7 value; SW1 with heavier
  nailing → SWD, given DA's line forces, designs the same wall forces (equal demand / capacity on B and C); deflection
  method → equal δ on B and C; both close.
- **Several SWD lines on one grid** (user 2026-11-03; Ch 8.4: SW6 and SW7 both on E but independent): name the SWD
  lines "E 4-7" and "E 8-9" (grid, then the two cross grids of the stretch), or set grid / from / to on Setup → Shear
  wall link (`wallLink.lineGrid[lineId] = { gridId, fromId, toId }`, `tdWallLink.lineGridOf`). Such a line: origin =
  span start, length checked against the span (not the whole grid), walls checked to lie in the span (warning), two
  lines over the same stretch → error `link-overlap`, two lines on one continuous part of the grid → warning
  `swd-lines-one-part`. `linkLineForces`: the only SWD line on its grid without a span gets the grid's force (as
  before); otherwise each SWD line gets the Σ of its own walls' shares (no walls: the grid's part forces inside its
  span). Ex 8.4 linked as A / D / E 4-7 / E 8-9 with offset line D + E 4-7: every book value, SWD designs the same
  wall forces, closes (test). A wall left out of a group on the same SWD line as group walls still warns
  (`swd-group-partial`) — use separate SWD lines instead.
- Analysis tab (View 1): pass table "Closure solver" (group / wall-line / collector forces, TD loads, largest
  residual, open runs) and the change of each unknown; Checks tab: closure check. A linked Shear Wall Design line takes
  the solved force.

## Openings, cut chords and closure (decisions 2026-11-02)
Found on the book's complex examples (Ex 8.1 = §8.3, Ch 8.4); full register with experiments in the backlog ("Gap
register"); study in `docs/diaphragm-analysis-opening-study.md`.

**Why rules are needed.** At an opening the section has more members along the span (outer chords, opening-edge
members) than statics has equations (ΣN = 0, ΣN·y = M). The visual method fixes one constant per band by assumption;
the book uses different assumptions in Ch 5 and Ch 8 and says "no single approach is more correct than another".
The tool therefore chose its rules by comparison with a stiffness (stringer-panel) reference, validated on the book's
determinate examples (within ~1–2 %).

| Situation | Rule in the tool | Reason |
|---|---|---|
| Band shears at an opening | Shared by width at one section (`bandSplit`: auto / low / high / mid), each band then carries its own load (wind: windward / leeward to its face) | Book Ch 5 (Ex 5.1), Ex 8.1 p12; unchanged |
| Opening-edge member (inner) | Zero at the band's **zero-shear point** if the band's shear changes sign inside the opening, else at the **inflection** (mid-opening, or the free end at a support) — automatic (G3) | Book Ex 8.1 p13 (opening at the zero-shear zone) and Ex 5.1 (near a support) both reproduced; closure does not fix this constant. **Warning on every opening**: the study shows these forces depend on stiffness and may be under-estimated (up to 2–3×) — design opening collectors with a margin |
| Chord cut inside an opening stretch (e.g. a notch under the opening) | Setting `chordCut` per diaphragm: **section M/H at the cut (default)** — inner members taken as 0 there; override **Vierendeel** — M/H at the inflection with that section's depth, outer chord following the outermost band (G4) | Study: section within −6…+9 % of the reference on 9 layouts, Vierendeel −24…−30 % (unconservative); book Ex 8.1 p8 uses M/H. Closure does not decide it |
| A TD load line with members on both edges | Side `both`: P = N at the high edge − N at the low edge (G1) | Book Ex 8.1 TD1 line B (chord 5250 + collector 550) |
| A wall or sheathing edge ending inside a TD segment | TD engine gets the segment average of the exact outside shear; members use the exact profile (G5) | The engine's segment model is linear between ends; Ex 8.1 TD4 on line 6 |
| A TD edge line carrying on past the TD | That edge closes on its whole line (line closure check), not as a TD stop (G6) | Book Ex 8.1 line 5 closes only at A |
| Hand-over forces not fixed by statics (offset wall-line splits, opening-collector splits between two TDs, collector loads into another diaphragm) | **Iterate to closure** — the general closure solver (built 2026-11-03, section above) (G2, G7, G8, G9) | The book iterates "until closure of all force diagrams" (Ch 8.4); in Ex 8.1 the collector-B split that closes is unique and equals the book's 550 / 1783.3 |

Calculation versions: td-v7 (pieces, G5, G6), td-v8 (G3, G4 default, warning), td-v9 (closure solver, G2 / G7 / G8 / G9; no opening warning at a notch), td-v10 (user test 2026-11-03: load-line rules, superposed TDs, strut 'both', solver equilibrium + FAILED gate, new checks), td-v11 (2026-11-04: grid overhangs at either / both ends, superposed loads on supports and overhangs, open member runs fail the case).

## TD engine (Phase 3)
- One call per transfer diaphragm. It is not the analysis of a regular diaphragm: that is the basic shear (Phase 4);
  a TD adds its shears on top where a notch, offset or opening cuts a chord or strut.
- Frame (skill §2): y along the TD span from the support at y = 0 to the support at y = W; x along the TD length,
  edge x1 = lower plan coordinate. Plan axes are kept (a swap keeps the shear sign). The skill's cantilever overhang
  lies below y = 0: a TD with only a high-side overhang mirrors y, and plan unit shears change sign in and out. Loads
  past the top support of a TD with two overhangs run mirrored inside the superposition (2026-11-04).
- Geometry comes from the drawing (`tdFrame`); P and the basic / outside shears come from the plan in Phase 5.
  Engineer inputs (region clear, cantilever limits, closure tolerance) are asked when results first appear.

## Views
1. Basic unit shear. 2. TD unit shear. 3. Net unit shear. 4. All drag / collector / chord force diagrams on the plan.
- Analysis tab layout (2026-10-30): **Unit shear:** Basic v_b (View 1) · TD v_TD (View 2) · Net v_net (View 3);
  **Forces:** Members N (View 4). Overlays for every view: line forces & wall shares, diaphragm / TD outlines;
  members along / across the span (View 4).
- **Zoom / pan** (− / + / Fit, wheel about the cursor, drag) shared by all views and load cases, so one spot can be
  compared view by view. Labels keep their size, so values hidden on small cells appear as you zoom in; at ≥ 200 %
  View 4 also labels N at the grids crossing a member and at wall ends. Hover any cell / diagram for its value.
- **Text size** A− / A+ (default 120 %, kept across views); the room a label needs scales with it.
- **Maxima:** every member run labels its largest tension and its largest compression ("max T …", "max C …");
  the member table lists both with their positions.
- **Mouse read-out:** a box follows the mouse — Views 1–3: the unit shear at the point; View 4: N on the nearest
  member line (within 10 px) at that position, with a dot on the line.
- **Colours:** results blue = + (unit shear: book "+" element; members: tension), red = − (compression); colour depth
  ∝ |v| / the largest of that view (shown in the legend). Plan symbols: sheathing light indigo, opening white with an
  X, diaphragm teal dashed, TD brown (amber fill on the Plan tab, outline only on the result views so the result
  colours are the only fills), shear wall black (indigo when linked from Shear Wall Design), load blue, grid grey.
  Legend (HTML) under each drawing: the view's scale + the plan symbols; the Plan tab shows the symbols.
- **Gate (user 2026-10-30):** a TD that did not run — cantilever review pending, "limits not met" stop, error, or
  incomplete geometry — pauses its load case (`cs.paused`). The TD / Net / Members views, the member table and the
  closure / edge / offset checks are not reported (panel "PAUSED — TD1 awaits the cantilever review" or "STOPPED");
  the Checks tab shows PAUSED (warning, not failure); the Verification tab compares those values after the TD runs.
  Still shown: basic shear, line forces, wall shares, equilibrium, the TD status. A TD with no disrupted force adds
  nothing and does not pause. An offset-line case's line forces depend on the TD runs: they are held from Shear Wall
  Design (`lineForces` E / W = null, which SWD skips) with a warning. A run that does not close in a complete case is
  still marked "open ±N" in View 4.

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
| `src/modules/tdClosure.js` | general closure solver: offset lines, wall lines, collectors into a diaphragm, TD reaction splits (replaces `tdOffset.js`) |
| `tests/diaphragmAnalysisUser.test.mjs`, `tests/fixtures/da-user/` | the user's ADU items (2026-11-03, Roof 2026-11-04) and the fixes from them: load-line rules, superposition proof, equilibrium gate, offset-line path, new checks; 11-04 overhangs by grid, loads anywhere (Ex 3.4 and two-overhang proofs), Q2 fail, TD card |
| `tests/diaphragmAnalysisOffset.test.mjs` | Ex 3.3 values, the book's non-closing equal split, convergence, grouping, pass table / check; Ex 8.4 (96), G7, G8, Ex 8.1 G2 (146) |
| `src/modules/tdBookKeys.js` | tool value of a book key (Verification tab, book tests, book-cases doc) |
| `tests/diaphragmAnalysisBasic.test.mjs` | Phase 4: book values, statics, closed forms, bands, TD hand-over, load cases, B4, View 1 |
| `src/modules/tdWallLink.js` | Shear Wall Design link: `swdExtract`, direction guess, walls of the level placed on the plan, matching checks |
| `tests/diaphragmAnalysisLink.test.mjs` | link infra (many / from-inputs refs), walls on the plan, SWD line loads from DA, unlinked SWD untouched |
| `tests/td-book/src/toInputs.mjs`, `scripts/daSeedBook.mjs` | book layout → item inputs; seed project DA-BOOK |
| `docs/diaphragm-analysis-opening-study.md`, `scripts/study/` | opening study (G3 / G4): stringer-panel stiffness reference (`sp.py`), calibration on the book (`calibrate.py`), sensitivity (`sens.py`), test family (`family*.py/.mjs`, `g3.mjs`); study only, needs numpy |

## Commands
`npm run da:skill:build -- "<design-skills folder>" [--check]` · `npm run da:book:build [Ex4.1 …]` · `npm run da:book:doc` ·
`SB_EMAIL=… SB_PASSWORD=… npm run da:seed [-- --apply]` · `node tests/diaphragmAnalysisPlan.test.mjs`
