# Diaphragm Analysis: decisions and backlog

Branch `diaphragm-analysis` (off `master` 71cdfb5; module renamed from Transfer Diaphragm 2026-10-29). Plan: `~/.claude/plans/read-the-md-files-composed-kite.md` (approved 2026-10-29).
Guide: `docs/diaphragm-analysis.md`. Book cases: `docs/diaphragm-analysis-book-cases.md`.

## Next session — start here (set 2026-10-30, Phase 7)
**State**
- Branch `da-phase3-td-engine`: Phases 3–6 (4d9782f) and, on 2026-10-30, Phase 7 + the review rounds below (result
  views, loads on Setup, wind mode, force levels, TD gate) committed and pushed. PRs #5 / #6 still open; no PR for
  this branch yet. `npm test` green (DA: Plan 22, Link 9, Engine 10, Basic 10, Td 8, Net 11, Offset 5, Loads 7),
  build OK, no Shear Wall Design / DLRS file changed.
- Book: **366 / 366** values of phases 4–7 match, nothing pending (`docs/diaphragm-analysis-book-cases.md`); the book's
  non-closing first run of Ex 3.3 (37 values) is reproduced in the Offset test.

**Next**
1. User: re-seed DA-BOOK (`npm run da:seed -- --apply`; PowerShell `$env:SB_EMAIL` / `$env:SB_PASSWORD` first);
   review Analysis Views 1–4 (Ex 3.3: pass table under the line forces), TDs, Checks, Verification next to the book
   figures (Ex 3.4: review the cantilever limits first — TD / net values wait for it).
2. Open (user): closure tolerance values — rule max(fixed lb, % of run max) is in; values kept at 1 lb / 1 %
   (`CLOSURE_LB` / `CLOSURE_REL`, tdNet.js). Should the iteration stop at the tolerance (now) or run on until the
   residual is ~0 (start-independent result)?
3. Phase 8: PDF reports (Views 1–4, TD tables, step trace, pass table), upgrade script, README.
4. For the skill author: T05 misprint; stray shell text at the end of `references/citations.md`.

## TD gate (2026-10-30, user)
- Ex 3.4 without "Reviewed — limits met": only TD1 paused; the net field / members still ran without it and showed
  invalid values. Decision: pause the dependent results of that load case (basic shear and line forces stay),
  PAUSED in Checks; offset-line line forces held from SWD (null) + warning. `blocksCase`, `pausedChecks`,
  `pausedPanel`. "No disrupted force" (td-no-load) does not pause.

## Setup pages (2026-10-30, user)
- All loads on the Setup tab: pages Seismic loading · Wind loading · Shear wall link · General (code / sheathing /
  method, which had no page of their own in the request). `renderLoadList(inputs, kind, refresh)` (tdPlanEditor.js)
  replaces the Plan-panel load cards; the Plan panel only points to Setup. No stored-data change.

## Review round 2 (2026-10-30): text, maxima, read-out, loads, force levels
- Text size A− / A+ (default 120 %); max tension and max compression labelled per run and listed in the member
  table; mouse read-out (unit shear at the point / N on the nearest member line).
- Decisions (user): seismic stays at F_x for everything; display factors k_D (→ F_px) and k_C (→ collector level)
  on the Analysis tab, with "Forces shown" always stated; SWD gets 1.0E. Load strip w(s) on the Plan tab only.
  Wind: simpler plf input with windward / leeward kept apart (matters at openings, Ex 5.1) → load mode `wind`
  (segments w = windward, wl = leeward). A single 123 / 77 wind load reproduces all 73 Ex 5.1 values. W area load →
  warning. No CALC_VERSION change (new mode only; existing items give the same results).

## Result views: zoom, organisation, legend (2026-10-30, user review of DA-BOOK)
- User: Ex 3.4 View 4 line 2 compression did not return to 0 at A. Cause: in the seeded item TD1 waits for the
  cantilever review (ENGINEER_INPUT), so View 4 drew members without TD1 (line 2 kept −5775 = TD1's reaction at 2;
  lines 1 / 3 left +4620 / +1155). After the review every run closes and matches Figs 3.25 / 3.26. Now shown on
  screen: notice on Views 2–4 + "open ±N" at the end of each run that does not close.
- Views regrouped (Unit shear: Basic / TD / Net; Forces: Members), shared zoom / pan (`zoomAt`, `zoomButtons` in
  tdPlanEditor.js, used by the editor too), hover read-outs, N at grids / wall ends at zoom ≥ 200 %, overlays
  (line forces on every view, outlines), result-mode plan (diaphragm / TD outlines only), HTML legend (scale + plan
  symbols, also on the Plan tab). No calc change. Not checked in a real browser by Claude (Node stand-in DOM).

## Phase 7 log (2026-10-30)
- Decisions (user): **iterate to closure** (not the book's p14 weighted-average rule, not flexible + flag);
  closure tolerance = the larger of a fixed force and a % of the run's largest |N|.
- **Offset line** = walls with one wall line name on ≥ 2 grids across the span (`lineGroups`); force shared by wall
  length across the group (`shareGroup`, basis `group`). No new input: the wall line name already exists. Linked
  Shear Wall Design walls keep one grid per line, so groups come from typed walls.
- `src/modules/tdOffset.js` `offsetIterate`: pass 0 flexible; per pass TDs → net field → members; each wall line
  F ← F − Σ residuals of its cross runs (parts by run), groups pool; stop when every wall-line run closes, max 25.
  Only cases with a group iterate — the other examples run exactly as before (test).
- `tdDerive`: a strut TD on a group grid takes P = strut force at the TD edge (Ex 3.3: 694 lb, book 693.6); an
  ungrouped wall line on a TD load line now says how to group it.
- Ex 3.3 result: R_A 4597, R_B/C 5403 (book 4600 / 5400), every Fig 3.21 value within its tolerance; 1 pass.
- `tdNet.closes` / `closureTol` / `CLOSURE_LB` / `CLOSURE_REL` replace the `closureTol` parameter (Checks, View 4).
  Book key `R:<group>`. Verification tab and book-cases doc compare phase 7. CALC_VERSION td-v6.
- Line forces sent to a linked SWD item are recomputed after the iteration; a non-group line moved by it is
  re-shared on its own basis (SWD weights kept from the first pass).

## Phase 6 log (2026-10-29)
- `src/modules/tdNet.js`: TD field (segment shears of each TD that ran, × ySign), net field v_net = v_b + Σ v_TD,
  members on every line of the case (grids, band / outline / opening edges, TD edges) in two families — chords along
  the span dN/ds = v_net(above) − v_net(below); lines across the span dN/dc = v_net(s+) − v_net(s−) − r_wall —
  from 0 at the low (free) end; Simpson per piece (exact for the linear / quadratic shears), interior extremes;
  closure residual per run.
- **Wall lines across a gap** (book): a line with walls is one member across a gap inside the outline (strut — Ex 4.3
  line 1, "continuous via strut") and two members at a gap outside it (notch — Ex 4.2 line C). Wall shares are now
  per connected part of the line (`lineParts`; each force contribution keeps where it enters the line): Ex 4.2
  SW3 = 500 + 213.3, SW4 = 3833.3 + 213.3 (book). Phase 4 values unchanged.
- **Checks** (`netChecks`, Checks tab): equilibrium per case; every member run closes (|res| ≤ max(1 lb, 1 % of the
  run's max)); TD status; skill TD edge forces = integrator (cantilever: from the tip); seismic collector flag.
  Without its TDs the basic field does not close (Ex 4.1 test) — the book's error check.
- **Views** (Analysis tab): View 2 TD shear, View 3 net shear (cells, values at the ends), View 4 member diagrams
  (tension blue / compression red, max per run, filter chords / cross members) + member table with closure.
- Book keys `tdR`, `vtd`, `aspect`, `vnet`, `N`, `Nmax` (signed at the largest |N|); Verification tab and the
  book-cases doc compare phases ≤ 6; with a cantilever not yet reviewed the TD / net rows read "awaiting review"
  (the doc uses the book's own acceptance of Ex 3.4's cantilever).
- Fixes: a side nudge smaller than sectionAt's snap returned the wrong side of a section; zero of q on a sample step
  missed an extreme. CALC_VERSION td-v5. Saved results 23–37 KB per book item.

## Phase 5 log (2026-10-29)
- **Opening rule from the geometry** (user review: Ex 4.3 and Ex 5.1 are different cases). Book Ch 5.2 (Vierendeel):
  the opening-edge chords have an inflection (force 0) and the bands share V by width at one section.
  - Opening stretch ending at a support line / diaphragm end (Ex 4.3, wall line 1): the edge chords have a free end
    there — inflection and width split at that end.
  - Sheathing / TDs on both sides (Ex 5.1): inflection at mid-opening (book F3B = F3C = 0); width split at the end
    with the smaller |V| (book "start at grid 4", 8200 < 13000).
  - Diaphragm "Opening bands share V at": auto (default) | start | end | mid overrides the width split only.
  - Book layouts no longer carry bandSplit; the auto rule reproduces both examples.
- `src/modules/tdMembers.js`: basic-field member forces. Chords: single band ±M/d (M = ∫V, exact); opening stretch:
  ±M/H at the inflection then ∫(v above − v below) per band edge. Cross lines (struts / collectors):
  dN/dc = v(s+) − v(s−) − r_wall from a free end; between two TDs equal split (Ex 4.2). Finding: on the basic field a
  notch chord with TDs at both ends has no zero point — the book's disrupted force there is M/d of the cut band; the
  unit-shear integral from free ends closes only on the net field (Phase 6).
- `src/modules/tdDerive.js`: each drawn TD's skill inputs per load case — P (chord TD: chord force at the TD edge ×
  side; strut TD: the wall-less line's force handed into it), td_vb (just inside each edge), td_vo (just outside:
  void 0, sheathing v, + wall reaction per foot on the edge line), ×ySign for a mirrored overhang. The 8 book TDs
  give exactly the skill tests' hand inputs T01–T08, and the engine then gives their expected outputs.
- Engineer inputs (user): region clear = true (drawn TD); cantilever = review of the listed limits (`tdLimits.js`,
  UNVERIFIED, buttons on the TDs tab → `engineer.cantileverOk`); closure tolerance = `CLOSURE_TOL` 1 %.
- TD runs in results (`tdRuns`, CALC_VERSION td-v4); TDs tab: loads with their derivation, shears per segment, TD
  results, flags, stops; Ex 3.3 (load line with walls) is not run — Phase 7.
- Fix: a one-sided section at a diaphragm's own end returned the other side (sectionAt), which zeroed strut forces.

## Phase 4 log (2026-10-29)
- `src/modules/tdBasicShear.js` (pure): load cases = direction × kind (E | W; new load field `kind`, '' = E for
  seismic mode, else W). Each user-defined diaphragm of the direction is a flexible beam between its two supports
  (overhang allowed). Load w(s): q·d(s) (seismic, q = F_x / ΣA), psf·d(s) (area), line segments shared by the
  diaphragms covering the section in proportion to their depth (edge loads: only diaphragms whose depth holds that
  edge line). Exact statics on the intervals between break coordinates; V(s) = forces on the low-s part; v = V/d
  in the book's "+" element.
- **Opening bands** (Ex 4.3, 5.1): each band carries its own load (edge loads → the band on that edge); the bands
  share the section shear by width at one section of the stretch — diaphragm field `bandSplit`: `low` / `high` end
  or `mid` (default, '' = mid). The book uses `low` in Ex 4.3 and `high` in Ex 5.1 (set in the book layouts).
  Default mid-opening = equal average shear strain of the two bands (to confirm with the user).
- **Line forces**: Σ reactions per support line. A line without a wall passes its force to the TD(s) that have it as
  a load line (equal split between TDs, Ex 4.2) and each TD to its supports by statics (Ex 3.4: 4620 → 5775 / −1155);
  no TD → warning. Reported positive in the load direction.
- **Wall shares**: by wall length (typed walls); with a Shear Wall Design link (**B4**) in the ratio SWD's own
  `calcAll` gives the walls of the line at this level, run on a copy of the definition with DA's line forces
  (`swdWallShares`, `tdWallLink.js`; `swdExtract` now carries the full definition). Test: same ratio as SWD after
  its DA-link update.
- `lineForces` output filled (kip, per linked SWD line, E and W as entered — enter loads as 1.0E / 1.0W).
- **Views**: Analysis tab = View 1 (`tdViews.js`): v_b painted per band and interval, values at the band ends, line
  forces and wall shares on the plan, line / wall table with Σ check, section shears per diaphragm at the grids.
  Verification tab compares the built phases (ok / differ / pending). Plan panel: load kind, opening band split.
- Book layouts: optional `diaphragms` (FORMAT.md); sub-diaphragms for Ex 3.3, 3.4, 4.2; `bandSplit` for 4.3, 5.1.
  Wall shares / wall unit shears are in the load-direction sense, so the mirrored examples no longer negate `vw`.
  `npm run da:book:doc` now fills the Tool column for the built phases.
- CALC_VERSION `td-v3`. Not checked in a real browser by Claude (Node stand-in DOM).

## Phase 3 log (2026-10-29)
- Decisions (user): go, branch off without waiting for merges; **no typed TD inputs** — geometry comes from the
  drawn TD, loads / shears become automatic in Phase 5; T05 misprint fixed and noted; SDPWS T4.2.2 stays UNVERIFIED;
  DA-BOOK review later.
- **What the TD engine is:** the calculation for one transfer-diaphragm strip (a beam between two support lines
  loaded by a cut chord / strut force). It does not analyse a regular diaphragm; the basic shear of every diaphragm
  is Phase 4, and TD shears are added on top of it where a notch / offset / opening cuts a member.
- `scripts/buildTdSkillData.mjs` now also writes `src/modules/tdFlow.js` (flow.yaml steps as data, expressions
  compiled to JS); `--check` ignores line endings (it reported a false difference on Windows before).
- `src/modules/tdCalc.js` `runTd(inputs, engineerInputs, edition)` → `{ outputs, flags, trace, terminal, draft }`,
  the JS twin of the skill's Python reference. Engineer inputs never filled (missing → `ENGINEER_INPUT:<step>`).
- Checked against the Python reference once (scratchpad script, not in `npm test`): 21 skill tests + 200 random
  cases, 7632 output values identical (1e-9), same terminal, flags and step path.
- **T05 correction** (in the build script, `CORRECTIONS`): book Ex 4.3 p3 prints v3 = 8800/56 = 167.9 plf; correct
  157.14. Edge x2 basic / outside shears → 157.14; expected net shears x2 → 39.05 / 412.38 / 32.38 (book 49.8 /
  423.1 / 43.7); the x2 s3 tolerance override is dropped. The vendored test keeps the replaced values under
  `corrected.was`. Edge-member forces do not depend on it (test).
- `tdFrame(td)` (`tdGeometry.js`): drawn TD → skill frame (support type, W, L, y1 / y2, sides, bottom / top support,
  edges). Overhang on the high side mirrors y (ySign −1: plan unit shears and support forces change sign into and
  out of the engine; P and member forces do not). All 8 book TDs give exactly the skill tests' geometry.
- Results gain `tds[]` (frame per TD); CALC_VERSION `td-v2`. TDs tab replaces the placeholder (DRAFT mark).
- Engineer inputs (`td_region_clear`, `td_cantilever_ok`, `td_closure_tol`): asked in the UI in Phase 5, when TD
  results first appear (the stored `engineer` fields exist since schema 1).

## Earlier start-here (end of Phase 2, history)
**State**
- Phases 0–2 done and committed on branch `diaphragm-analysis` (pushed). `npm test` green, build OK, no Shear Wall
  golden changed.
- PRs: [#5](https://github.com/Ruihao-spacial/design-item-hub/pull/5) `sw-design-data-appendix` → master (SWD v24) and
  [#6](https://github.com/Ruihao-spacial/design-item-hub/pull/6) `diaphragm-analysis` → master. **Merge #5 first**; #6
  contains the v24 commit.
- Local `master` = `a60be7a` (the two merged locally, **not pushed**). After the PRs merge on GitHub:
  `git switch master && git reset --hard origin/master` (local only), then branch Phase 3 off it.
- Local DB (done by the user): 34 SWD items at schema 13 / v24; SW-VERIFY re-seeded (19); DA-BOOK seeded (7 items).

**Next**
1. User: review / merge #5 then #6; look at DA-BOOK items (Plan + Verification tabs) next to the book figures.
2. **Phase 3 — TD engine — ON HOLD** until the user says go. Scope (plan file, "Phase 3"): `src/modules/tdCalc.js`,
   a JS port of wood-diaph-transfer; tests T01–T21 (`tests/td-cases/skill-tests.json`) + invariants; engineer inputs
   never auto-filled; DRAFT mark; selecting a drawn TD shows its typed inputs and results.
3. Then Phase 4 (loads, span beams, View 1) + B4 (DA runs SWD `calcAll` with its line forces → wall shares).

**Open questions / notes for later phases**
- Phase 5: one TD per side of a notch or the user's choice; load lines when an opening has 2 chords; Ex 5.1
  Vierendeel rule (chord force 0 at mid-opening) for chords around an opening.
- Phase 4/5: Ex 3.4 sub-diaphragm on strut line 1 → reaction into the cantilever TD (support line without walls).
- Phase 7: Ex 3.3 offset-line distribution (stiffness-weighted position; iterate to closure; tolerance).
- Skill author: Ex 4.3 p3 erratum (v3 = 157.14, book 167.9) — the skill's tests.yaml T05 uses the printed value.
- Local `supabase/config.toml` `site_url` is the production URL, so local password-reset emails link to the online
  site. Change it to `http://localhost:5173` if local resets are needed (user's call).
- PowerShell: set `$env:SB_EMAIL` / `$env:SB_PASSWORD` before `npm run …`, and pass flags as `-- --apply`.

## Earlier start-here (Phase 1, history)

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
