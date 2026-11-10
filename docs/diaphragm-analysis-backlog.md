# Diaphragm Analysis: decisions and backlog

Branch `diaphragm-analysis` (off `master` 71cdfb5; module renamed from Transfer Diaphragm 2026-10-29). Plan: `~/.claude/plans/read-the-md-files-composed-kite.md` (approved 2026-10-29).
Guide: `docs/diaphragm-analysis.md`. Book cases: `docs/diaphragm-analysis-book-cases.md`.

## Next session — start here (set 2026-11-10, end of session)
**State:** committed on `da-phase3-td-engine` (36f892e, then the ELF review commit) and pushed; **PR #9 → master** open
(the PR link is in the PR list; PR #8 merged 2026-11-09). CALC_VERSION **td-v19**, ELF **v2**; SWD untouched (CALC v24,
freeze identical). `npm test` 724 ok, build OK, books 649 / 649.

**Built 2026-11-10** (guide sections "Both senses and load combinations", "Linked ELF checks", "PDF report"):
- **td-v18 — both senses:** every load case is analysed acting both ways by a full second run (user: a sign flip is not
  accurate — wind moves its windward strip). Line forces to SWD = the entered sense, 1.0E / 1.0W (checked on 26998: no
  k_D / k_C / Ω₀ / basis / ρ reaches them; SWD applies 0.7ρ itself).
- **Analysis tab:** Acts entered / reversed / **Envelope ±** (members: max T / max C signed; unit shear Views 1–3: max |v|
  with the governing sense); **Load combination** dropdown LRFD 1.0E / ASD 0.7E, LRFD 1.0W / ASD 0.6W on top of the force
  level (default = Setup design basis); View 4 hides N = 0 stretches; Setup: ρ note, no Acts picker.
- **Phase 8 PDF** (`tdReport.js`): Summary / Detailed at ASD, three force levels, x and y, both-sense envelopes, the
  Analysis tab's own drawings; same recalculated result as the screen (with links). Upgrade script dropped (results
  regenerate on open; SWD reads DA's recalculated results).
- **ELF v2** (user review): each column with its ASCE 7-22 equation / section, three header rows (symbol · unit ·
  reference), equal widths, centred, sub- / superscripts everywhere (rich-text `X^{sup}` added to `richText.js` /
  `pdf.js`); F_px,des / F_x (k_D, × 1.25 with the 25 % box), F_c / F_px,des, F_c / F_x (k_C); collector = max(Ω₀F_x,
  Ω₀F_px,des, 1.25ρF_px,min); light-frame tick = Ω₀ − 0.5 ≥ 2.0; 25 % (§12.3.3.5) never with Ω₀; new exception "braced
  entirely by wood light-frame shear walls" F_c = 1.25ρF_px,des. Tests `tests/elf.test.mjs`.
- **td-v19:** walls above at the diaphragm level × max(Ω₀, 1.25) (was Ω₀ × 1.25); warnings: linked ELF and SWD use
  different Seismic Base Shear items; +25 % tick ≠ linked ELF 25 % box.

**Open, next session:**
1. User: merge PR #9 after review; export a DA PDF from 26998 in the app (the drawings were checked in Chrome by
   rendering the fixtures in the page, not by a real download).
2. User to confirm: V_x = ΣF_i is ASCE 7-22 **Eq. 12.8-13** (ELF table + equations page; the old page said §12.8.6).
3. Saved ELF items with the light-frame or 25 % box ticked get lower collector forces when opened (v2 rules); the k_C
   they offer DA changes with them. Production items: check after the merge.
4. Deferred (reviewed by the user 2026-11-10):
   - 6-B collector stretches per line — only for separate collectors with a gap on one line (e.g. B–C and E–F). Touching
     collectors are one from–to, already built. Until a project needs it: one from–to over both, or the "each wall into
     the diaphragm under it" switch. Build only on a real project.
   - G11 (collector end inside a diaphragm) — plan error `above-collector-inside`; split the diaphragm at the collector
     end. A drawing limit, not a wrong result.
   - SWD small items (B5 note, elevation snap), modelling-rule warnings, placement agent.
   - Dropped: wall-less part of a wall line as automatic collector (wall-less grid + TD covers it, `line-part-no-wall`);
     TD5 / TD6 29 lb on 26998 line 2 (within tolerance); 26998 design notes (not tool work).

## Earlier start-here (set 2026-11-09, end of session — history)
- Branch `da-phase3-td-engine`: 384f66c (UI + td-v13), 4fa1262 (td-v14 … td-v17); PR #8 → master merged 2026-11-09 23:01
  (it also carried Phases 3–7, td-v12). td-v17, `npm test` 692 ok. User test 26998 "Cotoros Main Test": Roof and 2nd
  Floor close in both directions; fixtures `tests/fixtures/da-user/t98-*`, test `tests/daCase26998.test.mjs`.
- Built 2026-11-06 … 11-09: UI (plan messages, Diaphragms / TDs tabs, analysis wall layers); td-v13 … td-v17; modelling
  guide "How to draw diaphragms and TDs" (rules 1–7).

## Earlier note (2026-11-06 … 11-09, during the work — history)
- **Plan for all open items: `docs/diaphragm-analysis-plan-2026-11-06.md`** — re-assessed by need and risk (user
  2026-11-06): kept = fixture 26998 2nd, investigation of the unsettled offset lines and the 2nd Floor x runs, item 6
  reduced to an opt-in per-line switch (default unchanged); dropped = member ends at its grid end (grid extents already
  set for drawing would cut members inside diaphragms); deferred = G11, SWD small items, warnings, agent.
- **Investigation 2026-11-06** (plan doc, "Findings"; pinned by `tests/daCase26998.test.mjs`): 2nd Floor along y did
  not close — cause SW-8 running 0.5 ft into TD1 on its load line B (not G11); **fixed td-v13** (`tdMembers.crossForce`:
  a load-line wall's part inside the TD belongs to P); now closes with A/B. "Did not settle" = SWD auto nailing flipping
  between two choices; line 2 −816 lb = offset split fixed by SWD capacities vs closure (engine question); line I
  −38 lb = D12 corner.
- **2026-11-09:** committed 384f66c; td-v14 (walls on a bridged stretch act on the member) fixes line 2 — the 26998
  2nd Floor closes in both directions (plan doc, "Done 2026-11-09"). td-v14 uncommitted. Next: offset shares not
  settling (step 5), collector switch (step 6).
- Project 26998 "Cotoros Main Test" Roof: closes in both directions after remodelling (no code change). Modelling rules
  found: a strut TD on a line that runs the full diaphragm depth counts its force twice (the basic field already
  closes it); an edge step needs a full-depth chord TD (Ex 3.5 / 4.1 form); an offset line closes only in the Ex 3.3
  form (each group wall on the support line of its own diaphragm part, the strut TD where the strut leaves it).
  Fixtures `tests/fixtures/da-user/t98-*.json`.
- UI (guide, Plan model): messages grouped / numbered under the plan; Diaphragms & TDs tabs with a sub-tab per item;
  Analysis diagrams above the walls, walls below / above switches. `tests/daUi.test.mjs`. Not committed (user's call).
- Modelling guide written: guide `docs/diaphragm-analysis.md`, "How to draw diaphragms and TDs" (rules 1–7 with the
  26998 cases).

## Earlier start-here (set 2026-11-06, end of session — history)
**State:** everything is committed and pushed.
- Commit **87aceab** on `da-phase3-td-engine` (everything since 5e7f607).
- **PR #7** is stacked on #6 (`diaphragm-analysis`); merge order **#5 → #6 → #7** (GitHub retargets #7 to master).
- CALC_VERSION **td-v12**; SWD CALC_VERSION unchanged (v24), no SWD schema bump.
- `npm test` green (671 ok), build OK, 9 books 649 / 649.
- SWD freeze: 36 repo items identical; local DB snapshot `supabase/backups/swd-freeze-db-2026-11-05e.json` (git-ignored).

**Built 2026-11-05/06** (details in the guide and the sections below):
- grids: N-S / E-W tabs, extents, shared grids;
- SWD ↔ DA grid link and elevation zoom;
- SWD walls that end at a floor;
- DA walls of the story above: engine, force levels, collector from–to (grids or diaphragm edges);
- fixes from user tests 26997 / 26996 (TD drag, offset-line weights, blocking errors).

**Verified (2026-11-06):** DA = SWD wall by wall after Update, on 26996:
- capacity method: equal v / capacity in the offset line;
- deflection method: equal δ;
- mixed nailing;
- base shear 30 k and the transfer balance.

All in `tests/daCase26996.test.mjs`.

**Open, next session:**
- **2026-11-09 built (uncommitted): 0-A (td-v15), 6-A (td-v16), 5 (td-v17)** — see
  `docs/diaphragm-analysis-plan-2026-11-09-open-items.md` "Built". Small item: TD5's strut load leaves out TD6's
  reaction on line 2 (~29 lb, 26998; rule G2 with one loaded TD).
0. **BUG (found 2026-11-09) — FIXED td-v15 (option 0-A, plan 2026-11-09-open-items): offset line + deflection method — a wall with no deflection grabs the whole
   line.** `tdWallLink.swdWallShares` (deflection branch) calls `shearWallCalc.equalDeflectionSplit` with each group
   wall's `_deltaAt`. When SWD cannot compute a wall's deflection at its trial share (no nailing / hardware carries it),
   `_deltaAt` returns **null**; the solver reads null as 0 deflection — an infinitely stiff wall — so that wall takes the
   whole group force. 26998 Roof, offset line 2/3, SWD distribution = deflection: round 0 puts 11.6 k on SW-65 (3.33 ft)
   → δ null → SW-65 takes all 22.8 k, **SW-35 (7.5 ft, the stiffest wall, 0.03 in / k) gets 0**; locked in over the rounds
   (line 3 = 0 at the Roof); on the 2nd Floor line 3 walls SW-70 / 71 go negative (−1.1 / −1.3 k). Statics and closure
   still pass, so nothing flags it. Direct equal δ with valid curves: SW-35 17.16, SW-65 5.08, SW-60 / 62 0.96 k each.
   - Fix tested in a scratch copy (Diaphragm Analysis side only): the deflection branch requires a finite δ for every
     group wall (checked at ¼, ½, 1 × the carried force); otherwise the existing fallback — split by capacity, warning
     `swd-group-defl`. 26998 then closes both levels; SW-35 17.84 k.
   - To check before any change: SWD's own per-line equal-δ (`shearWallCalc`, ~line 1008, same solver) may have the same
     null case — production code: check only, freeze test, plan first.
   - Capacity method (default): not affected.
1. **User test, mixed case** (noted 2026-11-05, see below): walls above partly into the diaphragm, partly straight
   down; build a fixture from it.
2. **G11:** TDs at the collector ends — the TD engine does not take a concentrated load of a wall above on its load
   line inside the TD (`tdDerive` would count it in P / the edge shears). Needed for option 3, and for ticked walls
   whose load lands inside an offset-line strut TD.
3. **Small items:**
   - DA wall-share labels on a line with continuing walls above show only the diaphragm part (SWD adds the rest) —
     maybe label "+ X k from above";
   - B5 calc-sheet note on posts under a wall that ends at a floor;
   - wall drag snap to grids in the SWD elevation.
4. Phase 8 (PDF, upgrade script) on hold.
5. **Future (user 2026-11-06): an agent that places the diaphragms and TDs.** From the plan (grids, outline,
   openings, walls linked from Shear Wall Design, offset lines) it proposes the diaphragms and TDs of each load
   direction, following the guide's "How to draw diaphragms and TDs" (rules 1–7) and the worked examples: the 9
   book cases (`docs/diaphragm-analysis-book-cases.md`) and the user tests 26999 / 26997 / 26996 / 26998
   (`tests/fixtures/da-user/`). It runs the calc, reads the checks (closure, `line-no-wall`, `wall-in-span`, open
   runs with residual = P) and revises until both directions close; the engineer reviews and accepts the proposal
   (nothing is saved without that). Not started — scope, form (in-app assistant, Claude Code skill / subagent, or
   rule-based auto-layout plus an agent for the hard cases) and acceptance tests to be agreed with the user first.
   Possible first step: the rule checks of rule 5 / 7 as tool warnings (TD on a full-depth line, missing chord-step
   TD), which the agent would also use.
6. **Collector per wall above / per receiving diaphragm (user 2026-11-06, project 26998 2nd Floor, grid 6).** Three
   Roof walls end at this floor on grid 6 and land on different diaphragms: SW-39 (x 11–20.5, 7.8 k) over the west
   part, SW-55 (x 66–72, 4.9 k) and SW-56 (x 74.67–87, 10.1 k) over D10 (load along x). Today the collector is one
   setting per line (`inputs.aboveCollectors[swdLineId]`, `tdBasicShear.basicCase`): blank = each wall's force goes
   into **every** diaphragm the grid crosses along the whole line, shared by depth; a from–to applies to all walls of
   the line. So SW-39 also loads the east diaphragms and SW-55 / 56 the west ones.
   **Rule proposed by the user (2026-11-06), reviewed — correct:** load sharing between diaphragms needs a collector
   that spans them. A wall above pushes its force only into the sheathing under it (through its sill); to reach another
   diaphragm a member must drag it there.
   - **No collector beyond the walls (new default):** each wall above loads only the diaphragm(s) under its own length;
     a diaphragm with no wall above on that line gets nothing from that line. A wall straddling a diaphragm boundary
     is its own collector across both: its force is split **by wall length** over each.
   - **Collector drawn (one or several stretches per line, each from–to):** every wall above lying on a stretch shares
     its force over all diaphragms that stretch spans, by depth (today's rule, G7 / Ex 8.4). Walls on separate stretches
     do not share.
   - **Note for the guide:** inside its receiving diaphragm the force is still dragged along the grid over that
     diaphragm's width (the beam analysis spreads it over the full depth) — shown on the member diagram and to be
     designed (Ω₀ for a Type 4 transfer). With no member at all, the unit shear under the wall is higher than the
     visual method assumes — the engineer's call.
   - **Impact:** the default changes (blank today = whole line) → CALC_VERSION bump; DA items whose walls above use the
     blank collector get new results (26997 tests with full depth to be updated or set a full-line stretch); SWD items
     linked to DA get new line loads on Update (26998 2nd Floor grid 6). DA is not on master yet (PRs #6 / #7), so no
     production item is affected.
   - Data: `aboveCollectors[swdLineId]` becomes a list of stretches (an old single object read as a list of one, no
     migration); a wall on no stretch of a line that has stretches → error `above-collector-short` (as now); a stretch
     end inside a diaphragm → `above-collector-inside` (TD case, G11). Drawn as one amber line per stretch.
   - Test on 26998 2nd Floor grid 6: SW-39 into the west diaphragm(s) only, SW-55 / SW-56 into D10 only; with one
     stretch over the whole line, today's result.
7. **Other items from 26998 2nd Floor (2026-11-06):**
   - a member ends where its grid ends (grid "to" / "from"): the user wants the y collector on J (x = 83) to stop at
     y = 42.5 (end of D9); today every grid is a member over the whole sheathing (it carries only −15 lb above 42.5);
   - offset lines A/B, C/D, 2/3: "Shear Wall Design shares did not settle in 6 rounds" — find why (auto nailing
     changing between rounds?); negative line force on B / 3 is real (the walls above that continue down B / 3 are
     shared with A / 2 by Shear Wall Design);
   - load along x still open: line 2 −816 lb at the east end of the 2/3 strut (x ≈ 93–109, TD6, SW-66 / SW-67), line I
     (x = 80) −38 lb at the D12 corner;
   - user intends struts on grid 2 over OP1 (D–G) and grid 9 over OP2 (F–G), openings that reach the outline: along x
     they are continuous struts already; along y they are chords cut at the opening (zero force there — supports D, F,
     G); check with the user which view showed "no strut".

**User test projects (local DB):** 26999 ADU, 26997 Horizontal Offset Walls, 26996 notch + SW-19 + offset line 1/2.

## Earlier start-here (set 2026-11-05, during the session — history)
**State** — still all uncommitted on `da-phase3-td-engine` (since 5e7f607; the 11-04 commit did not happen — user's call).
CALC_VERSION td-v11 (unchanged). `npm test` green, build OK, book-cases doc unchanged (649 / 649).

**Topic: horizontal (out-of-plane) offset walls** — user test project **26997 "Horizontal Offset Walls"** (walls on 2 / B /
C stop at the 2nd floor, carried by 1 / A / D). Plan: `docs/diaphragm-analysis-offset-transfer-plan-2026-11-05.md`
(first draft + section 9 "User answers"); approved build plan `~/.claude/plans/response-to-q1-confirmed-rippling-creek.md`.

**User decisions 2026-11-05:** diaphragm level = k_D·A + Ω₀·T (× 1.25 if §12.3.3.5 applies; ASCE 7-22 §12.10.1.1);
collector level = k_C·(A + T); 1.0E = A + T to SWD; V_w from SWD's own wall split; per-wall SWD flag "ends at this floor →
diaphragm below" (auto when the line has no wall below, tick on a mixed line); SWD ↔ DA grid link = Option 1, **only for
SWD items linked to DA — existing SWD items and elevations must not change** (production); DA grids on N-S / E-W tabs with
extents; SWD sees only the grids that cross its line.

**Built 2026-11-05 (build step 1 of 8, Part C):** grid tabs + bounded grids (guide, Plan model). User checked it in the
browser — confirmed.
**Built 2026-11-05 (step 2, SWD safety harness):** `tests/swdFreeze.test.mjs` + `scripts/swdFreeze.mjs` (README, Tests).
Baseline = 36 repo SWD items, 541 parts (results, form, results page, PDF, every elevation), written before any SWD change.
The guard fires (a wall moved 0.1 ft → elevation; a story force → results / PDF). Local DB snapshot (37 SWD items):
`supabase/backups/swd-freeze-db-2026-11-05.json` — after each SWD step run `npm run swd:freeze -- --db --check
supabase/backups/swd-freeze-db-2026-11-05.json` (no item is linked to DA yet, so all 37 must stay identical).
Finding: this branch vs `origin/master` (production) differs on every item, only through the open PRs:
- PR #6: the SWD form gets an empty div and `title=""` attributes (DA link box; nothing visible).
- PR #5: SWD v24 WSWH TSS-kit anchors, stacked rod arm B, PDF appendix.
Those differences are already reviewed; the freeze proves that nothing *new* changes.

**Built 2026-11-05 (step 3, grid link):** guide section "Grid link with Shear Wall Design". The SWD freeze is identical for
all 36 repo items and all 37 local DB items. `npm test` green, build OK, book doc unchanged. Not checked in a real
browser. New fixtures `tests/fixtures/da-user/hov-swd.json`, `hov-roof.json`, `hov-2nd.json` (26997 as saved
2026-11-05).
**User check for step 3 (26997):**
1. SWD → Loading: tick both DA items, then **Adopt plan grids**.
2. E-W / N-S tabs: each line header has "Starts at". Set B and C to grid 1 (x 0) and line 2 to grid A (y 0) if that is
   how the positions were meant.
3. The elevations show the grid bubbles and the teal diaphragm stretch per level.
4. Open + save both DA items: walls placed from the SWD start; the `link-length` errors are gone.

**User comments on step 3 (2026-11-05), fixed** (guide, "Grid link … User comments"):
1. One grid for all levels: a DA item owns the grids, the others use them read-only.
2. The update notice that would not go away came from jsonb key order; the copy is now compared by value.
3. The line-length check is removed (`link-wall-sheathing` warning instead), and the SWD line length comes from the plan.

Tests green, freeze identical (36 repo / 37 DB items, snapshot `supabase/backups/swd-freeze-db-2026-11-05b.json` taken
after the user's 26997 edits), book doc unchanged.
**User check:**
1. DA - 2nd Floor → Grids & outline → "shared from DA - Roof", or the other way round. Edit grids only in the owner.
2. SWD: no grid-link notice after saving; line lengths show "(plan)".
3. DA Setup: no length column or errors.

**2nd round of comments (same day), fixed:**
- Adopt panel: shared grids are one choice.
- Adopted items open with their line lengths from the plan (C / D were missing on the N-S lines).
- Zoom on every SWD elevation.

**Toolbar fix:** zoom / Expand moved into the elevation toolbar row (they covered Find). The freeze proves only the
buttons moved (36 repo / 37 DB items identical).
**Built 2026-11-05 (step 4, SWD transfer):** guide section "Walls that end at a floor — SWD side". Not checked in a
browser. B4 (transfer balance check) moves to step 6; B5 (calc-sheet note on posts) is deferred.

**USER TEST TO DO (user request 2026-11-05) — mixed transfer case:** a level where some walls of the story above hand
their force to the diaphragm (offset, `endsAtFloor` / no wall below) while other walls continue straight down to the
level below. Do it both on one line (mixed line: SW-1 ticked, SW-3 not) and across lines (B ends, 3 continues).
Check:
- in SWD: the transfer per line, the G2 rows, the story shear of the line below = rest only, base shear = Σ levels;
- in DA (after step 6): only the transfer walls load the diaphragm, through walls only drag along their own line, and
  the line forces sent back to SWD do not count any wall twice.
Build a fixture of it for `tests/swdTransfer.test.mjs` / the step 6 test when the user has drawn it.

**Built 2026-11-05 (step 5, DA walls above, drawn only):** guide section "Walls of the story above — DA side". Tests
green, book doc unchanged. New DB snapshot `supabase/backups/swd-freeze-db-2026-11-05d.json` (after the user saved
26997 at 22:21).
**User check (26997):** DA - 2nd Floor → Plan tab: the Roof-story walls dashed beside grids 2 / B / C (amber ↓) and 3
(grey ↕); Shear walls page table; warnings above-type4 (and above-linkback / above-origin if SWD is not ticked / not
adopted).

**Highlight (user 2026-11-05):** a wall picked on the Shear walls page (either table) or on the plan gets a pink halo +
bold label; walls of the story above are selectable too; no Delete for SWD walls.
**Built 2026-11-05 (step 6, engine, td-v12):** guide section "Walls of the story above — the engine". The 26997 hand calc
matched; tests green, book doc unchanged, SWD freeze identical (37 DB items).
**User check (26997):**
1. Draw the 2nd-floor diaphragms: along x on A / D; along y on 1 / 3.
2. Have roof loads in SWD: Update in SWD after the Roof DA is drawn, or type them.
3. Open DA - 2nd Floor. Expect line forces A / D 15 k and line 1 13.57 k (with the hand-calc loads), and the
   distributor diagrams on B / C in View 4.

**Built 2026-11-05 (step 7, force levels):** guide section "Walls of the story above — the engine", force levels. Tests
green, book doc unchanged, SWD freeze identical (37 DB items).
**User question 2026-11-05 — collector on grid 2 only from B to C (2nd floor, load along y):** three options compared;
**user chose option 2 — BUILT same day** (guide section "Collector extent of the walls above"). Option 3 (TDs at the
collector ends) stays open as gap G11. The options:
1. Full depth (today).
2. Collector extent picked per line: a load rule; its ends must be on diaphragm edges.
3. TDs at the collector ends: the book method.

Found while comparing:
- **Bug fixed:** `tdMembers.crossForce` did not break at the ends of the walls above, so a TD read the wrong strut force
  (8 000 instead of −2 000 lb). Regression test in `tests/daTransfer.test.mjs`.
- **Gap (G11):** the TD engine stops (E_TD_CLOSURE, S930) when the basic field has a concentrated load of a wall above
  on the TD's load line inside the TD. Option 3 needs `tdDerive` to take that load as part of P / the edge shears.

**User test project 26996 (2026-11-05)** — 2nd floor did not run (fixtures `tests/fixtures/da-user/t96-*.json`, test
`tests/daCase26996.test.mjs`):
1. **Model:** load along x, diaphragm D1 supported on A / C, but C has no wall below. Effects:
   - its 8.6 k had no wall (`line-no-wall`);
   - SW-13 / SW-14 above C sat on a support line (`above-no-diaphragm`).

   Fix (user): supports A / D. Then x runs: A 15.12 / D 14.88 k.
2. **Bug (fixed):** load along y, TD1 (load line 2, strut of offset line 1/2) read the drag of SW-5 / SW-7 along grid 2
   as a cut strut force. Those walls continue down line 2 to SW-19. The 10 k was counted twice, and grid 2 / 1 / 3 were
   left open.
   - Fix: a TD's P and outside shears leave out walls above that continue down their line (`wallR` opts.noThrough in
     `crossForce` and `tdDerive`).
   - Result: y closes; lines 1 / 2 / 3 = 5.90 / −1.20 / 5.30 k (Σ 10 k own).
   - Line 2 is negative: the offset line shares the 10 k from above between SW-19 and line 1 by capacity × length, so
     part of it goes to line 1 through TD1.
   - Warning `swd-group-rounds` (SWD shares did not settle in 6 rounds): **cause found and fixed** (item 5).
4. TD1 shallower than 70 / 4 = 17.5 ft → `E_TD_ASPECT` (SDPWS 4:1 blocked) — model, not a bug.
5. **Bug (fixed):** the offset-line weights used the line's running story shear from the top. With SW-5 / SW-7 ending
   at the floor (step 4), that sum still held their 10 k, so SW-19's capacity × length was scaled by 2.89 / 12.89 and
   shrank every round.
   - Fix: the level's story shear = Σ of SWD's wall shares there (`tdWallLink.swdWallShares`).
   - Now SW-19 (20 ft) = SW-9 + SW-10 (7.24 k vs 3.62 + 3.62), settled in 1 round.
   - Fixtures `t96b-*.json`.
3. **Ticking SW-5 / SW-7 "ends at this floor"** instead would hit gap G11: their load would sit on TD1's load line inside
   TD1.

**Step 8 = user test on 26997** (incl. the mixed case noted above):
1. Draw the 2nd-floor diaphragms.
2. SWD Update (roof loads).
3. DA - 2nd Floor:
   - line forces;
   - View 4 distributors on B / C;
   - Analysis force levels 1.0E / Diaphragm / Collector with the walls-above table;
   - Setup Ω₀ / +25 %.
4. SWD Loading transfer balance ✓.
Then commit (user's call): everything since 5e7f607 is still uncommitted.

## Earlier start-here (set 2026-11-04) (history)
**State** — still all uncommitted on `da-phase3-td-engine` (since 5e7f607); the user commits at the end of the
2026-11-04 session. CALC_VERSION **td-v11**. `npm test` green, `npx vite build` OK, book-cases doc 649 / 649 (only Ex
3.4's overhang text changed: "2 → 1"). SWD / DLRS files untouched. Not checked in a real browser by Claude.

**User answers 2026-11-04:** Q1 no warning for a TD support line without a wall (Ex 3.5's TD has none). Q2 a case
that balances but does not close FAILS and is held from SWD — built. Q3 commit at the end of this session.

**Built 2026-11-04** (guide, section "TD overhangs and loads anywhere"):
- Overhangs picked by grid (from a support to the tip grid), one per support — a TD may overhang both; typed
  overhangs converted on open; checks `td-overhang`, `td-overhang-tip`, `td-overhang-grid`; `td-past-support` also on
  an end without an overhang.
- Any number of TD loads anywhere from tip to tip (between, on a support, on either overhang): superposed runs
  span / cantilever / mirrored cantilever / straight into the support; Auto load lines search the overhangs.
- Q2: open member runs → FAILED, line forces held, diagrams kept.

**User's Roof item (DA "ADU - Roof", saved 2026-11-04 17:47):** on open its typed overhang 0–5 becomes "from 5 to 6";
it then shows `td-past-support` (TD2 y 29–32 past support 2). Fix in the editor: draw TD2 y 0–29, or add a second
overhang "from 2 to 1.7". Either way E-W runs and closes (SW-8 / SW-10 / SW-6 = 4888 / 3945 / 7908 lb).

**Still open:** step E (bounds for a strip without a wall) on hold; Phase 8 on hold; TD supports from the plan later.

**Next session:** the user opens the Roof item in the browser (first real-browser check of td-v11), fixes TD2 (y 0–29
or overhang 2 → 1.7), tries the overhang picks / + overhang / load lines on the TD card, and brings findings → plan → build on go.

## Earlier start-here (set 2026-11-03, after the user's test — history)
**State** — still all uncommitted on `da-phase3-td-engine` (since 5e7f607). User test of project 26999 (Cotoros ADU
Test: SWD "ADU Shearwall Lines", DA Roof, DA 2nd Floor) → plan `docs/diaphragm-analysis-fix-plan-2026-11-03.md`,
steps **A–D built** (user go), step E (bounds for a strip without a wall) **on hold**. CALC_VERSION **td-v10**.
`npm test` green (595 ok), build OK, book-cases doc unchanged (649 / 649), SWD / DLRS files untouched. Not checked in a
real browser by Claude.

**Built:** load-line rules (other-direction walls, wall across a gap), strut TD side 'both', any number of load lines
(superposed engine runs, proved on all 19 book TDs), solver equilibrium + FAILED gate (held from SWD), offset line needs
a strut (`group-no-path`, user decision D1), checks `load-opposite`, `load-seismic-twice`, `grid-off-plan`,
`wall-in-span`, `td-past-support`. Details: guide, section "User test 2026-11-03".

**Open (reported to the user, not built):**
1. Roof E-W as saved: balances, but 7 runs open — TD2 is supported on 6 / 1.7, which have no walls (its reactions have
   nowhere to go). With TD2 on wall lines 5 / 2 (y 5–29): 20 / 22 close, SW-8 / SW-10 / SW-6 = 1312 / 7073 / 8355 lb;
   chords O / B in the overhang below y = 5 stay open (73 / 130 lb) — no TD placement for them found yet (stop-and-report).
   Possible check: warn when a TD's support line has no wall and hands its reaction on to nothing.
2. A case that balances but does not close still sends its line forces to SWD (as before) — the user may want them held.
3. 2nd floor as saved: SW-9 takes 0 (warning `wall-in-span`); case D (3 diaphragms) is the user's model.

**Decisions the user will answer next session (asked 2026-11-03, end of session):**
- Q1: add a warning when a TD's support line has no shear wall (its reaction has nowhere to go — Roof E-W TD2 on 6 / 1.7)?
- Q2: hold the line forces of a case that balances but does not close (open member runs) from Shear Wall Design, like a
  FAILED case? Today they are still sent.
- Q3: checkpoint commit of everything since 5e7f607 now?
Also pending: step E (bounds for a strip without a wall) on hold; Roof overhang chords O / B (open item 1).

**Next session:** read this start-here + the plan doc; take the user's answers to Q1–Q3 → short plan → build on go.

## Earlier start-here (2026-11-03, end of day — history)
**State** — all uncommitted on `da-phase3-td-engine` (nothing since 5e7f607 is committed: pieces, G1–G10, Ex 8.1 / 8.4,
closure solver, everything below). `npm test` green, `npx vite build` OK, CALC_VERSION td-v9, Shear Wall Design files
unchanged. Book: **all 9 examples 649 / 649** (Ex 3.3–5.1 366, Ex 8.1 146, Ex 8.4 96). Not checked in a real browser by
Claude (Node stand-in DOM) — the user's own test is the first.

**User, now:** build an example of their own in a new item and test the DA module (UI + calcs); bring the findings
next session. Guide for it: `docs/diaphragm-analysis-manual-test.md` (Ex 4.1 / Ex 8.4 steps, log table). Before that:
re-seed DA-BOOK (`node scripts/daSeedBook.mjs --apply`, 9 items) so the book items show td-v9.

**Done 2026-11-03** (details in the guide `docs/diaphragm-analysis.md`):
- Book case **Ex 8.4** (Ch 8.4, 13 errata; G10: the book's SW5 + SW6 total leaves out TD1's strut force) and the
  **general closure solver** `tdClosure.js` (replaces `tdOffset.js`; G2, G7, G8, G9). Ex 8.1 100 → 146.
- Closure tolerance **30 lb / 5 %** — check limit only; the solver closes to ~0.
- **No seismic load / No wind load** (Setup, first on the page; `inputs.noLoad`; warning when neither).
- **TD load lines Auto** (found from the plan, 20 / 20 book TDs; Set by hand kept; old TDs → Auto when they match).
  Supports stay as entered (user: keep for now).
- **Linked walls:** offset lines of resistance on Setup → Shear wall link (`wallLink.groups`), split like Shear Wall
  Design (capacity × length or equal δ, force from above kept per line; repeated with SWD until settled — option B);
  **several SWD lines on one grid** ("E 4-7", "E 8-9", or grid / span set by hand; `wallLink.lineGrid`), length checked
  against the span, each SWD line gets its own walls' force; checks for overlap, one continuous part, wall outside span.
- **Plan tab editor:** input pages Grids & outline / Diaphragms & TDs / Shear walls (page buttons and load direction in
  the right column); sections ▾ / ▸ kept collapsed across redraws, pages and directions; a row is selected when one
  of its fields is edited; **Lock grid lines** (`inputs.gridsLocked`); outline corners **picked on the plan** (⌖, +⌖,
  + Corner (pick)); numbered corner dots and a ring on the selected corner; Delete removes a corner; other-direction
  diaphragms / TDs named with their issues; no diaphragm / TD before the outline is closed; no value change by mouse
  wheel; "Ref only" grid column explained.
- New stored fields (no schema change, normaliser defaults): `noLoad`, `gridsLocked`, `tds[].loadsMode`,
  `wallLink.groups`, `wallLink.lineGrid`.

**Next**
1. The user's test findings → plan, review, fix (the user reviews a plan before each implementation step).
2. Commit a checkpoint when the user says so (no push / PR unless asked).
3. On hold (user): Phase 8 — PDF reports, upgrade script for saved items (schema 2), README.
4. Possible later: TD supports found from the plan (like the load lines); SWD wind weights use per-wall wind capacity.

## Earlier start-here (2026-11-02, late — history)
- Ex 8.1 was 100 / 146, waiting for the closure solver; pieces (schema 2), hard checks, G1, G3–G6, opening study done.

## Gap register — Ex 8.1 / Ch 8.4 (2026-11-02, user decisions)
Found while checking the book's complex examples (Ex 8.1 = §8.3 N-S, Ch 8.4 = same building E-W). Values that depend
on an open gap show as DIFF in `docs/diaphragm-analysis-book-cases.md`; they are never adjusted to match.

| # | Gap | Status | Decision and reasoning |
|---|---|---|---|
| G1 | A TD load line taking members from both sides (Ex 8.1 TD1 line B: chord 5250 from the left + collector from the right) | **Done** | Load side `'both'` (panel: left / right / both): P = N at the high edge − N at the low edge. The TD engine uses the side only for its own collector output (side × P), so its shears / reactions need only the sum; members are integrated by the tool anyway. |
| G2 | Split of an opening-edge collector between the TDs at its two ends, incl. a TD's reaction into it (Ex 8.1 collector B: TD2's 600 lb; book 550 / 1783.3 by trial and error) | **Done 2026-11-03** | Closure solver unknown `td`: a TD reaction on a line that loads two or more other TDs splits between them (one unknown per loaded TD); with one loaded TD the member rule stands (Ex 8.1 line D: G4 decides, closure cannot). Result 553 / 1781 (exact closure), book 550 / 1783.3; Ex 8.1 146 / 146 (N:B:4 and TD3 B-E carry a 3 lb / 0.06 plf rounding tolerance for the book's trial and error). |
| G3 | Where an opening-edge member carries zero (Ex 8.1 A.2: book zero at the band's zero-shear point, 2043 / 282; tool had mid-opening, 1841 / 81) | **Done** | Closure does not fix it (both splits close every line). Automatic rule: zero at the band's **zero-shear point when the band's shear changes sign inside the opening**, else at the inflection (Ch 5). Ex 4.3 / 5.1 bands never change sign → unchanged; Ex 8.1 matches the book. The opening sits at the low-shear / high-moment zone in Ex 8.1, near the support in Ex 5.1 — location, not load direction, is the difference. Plus a **warning** on every opening: the opening study shows these forces depend on stiffness and both rules sit at the low end (up to 2–3× under). |
| G4 | Force of a chord cut inside an opening stretch (Ex 8.1 chord D at grid 4; book M4/80 = 3000) | **Done** | Per-diaphragm setting `chordCut`, **default section M/H at the cut**, override Vierendeel (consistent: M/H at the inflection with that section's depth, outer chord follows the outermost band → 2759.6). First chosen default Vierendeel; **reversed by the opening study**: section within −6…+9 % of a stiffness reference on 9 layouts, Vierendeel −24…−30 % (unconservative), stable across stiffness. Closure does not decide it (Ex 8.1 closes for 3000 → B split 553 / 1781, and for 2759.6 → 72 / 2213). The old code mixed M(62.5) with the depth at grid 4 (2929.7) — a bug. Note: just left of the cut neither rule balances the section moment (short by P × the 10 ft D→E step = the couple TD2 carries). |
| G5 | A wall ending inside a TD segment (Ex 8.1 TD4 on line 6: SW2 0–25, SW3 80–90) | **Done** | The engine gets the segment **average** of the exact outside-shear profile (tdDerive), so its closure sees the true ∫ v; the net field / members use the exact profile anyway. The engine-vs-integrator check skips such edges and says why. |
| G6 | A TD edge whose line carries on past the TD (Ex 8.1 TD2's line 5 above B, closing only at A) | **Done** | That edge is checked on its **whole line** (existing line closure check), not as a TD stop; the engine's closure tolerance is opened and the other edges are checked in runTds against CLOSURE_TOL; warning on the TDs tab. |
| G7 | A wall-less collector line delivering a concentrated force into a diaphragm spanning across it (Ch 8.4: collector B 14,804 lb into D5; D6 hangs off D5) | **Done 2026-11-03** | `lineForces`: a wall-less line with no TD left holding force hands it to the diaphragm(s) of the case spanning across it (not supported by it), shared by depth; `analyseCase` takes it as a point load (shear jump, shared by width inside an opening stretch); `basicCase` stages the cases where a receiving diaphragm feeds another collector. Closure solver unknown `collector` = the extra force from TD reactions on the collector. |
| G8 | Two lines of resistance on one grid, each part taking the force entering its own part (Ch 8.4 line E: SW6 with SW5 as "D/E", SW7 alone; 9327 lb per section) | **Done 2026-11-03** | A group takes only the parts of a grid that hold its walls (`groupForce`, `shareGroup`); the other parts keep their own force and walls (SW7 = line "E7" 9326 lb). Book key `R:<wall line name>` = Σ its walls when the name is not a grid. |
| G9 | The closure iteration must recompute the basic field of a diaphragm receiving collector loads (Ch 8.4: TD1 → collector B → D5 → SW5 / SW6 → strut D4 → TD1) | **Done 2026-11-03** | `tdClosure.closeCase`: each evaluation re-runs `basicCase` with the collector unknowns, then wall shares, TDs, net field, members; Gauss–Newton (finite-difference Jacobian, tiny ridge) on all member-run residuals; linear statics → one step closes exactly. Ex 3.3 1 pass, Ex 8.1 1 pass, Ex 8.4 1 pass; 4–13 ms. |
| G10 | The book stops iterating early (Ch 8.4 line E: "F7 = +137.5 lb … close enough") | **Explained 2026-11-03** | Not only early stopping: the book's SW5 + SW6 total (2520 + 1465 + 2625 + 9333 = 15,944.7) leaves out TD1's reaction at D (its strut force 137.4; TD1 carries 3150 = 1548 + 1465 + 137.4), so line E ends at +137.5 ≈ P. The tool includes it: P = 159.7, D/E 16,078 lb, every line closes. Ex 8.4 values that depend on it carry a G10 tolerance (erratum p11). |

**Experiments behind G2 / G4 (scratch copy, TD loads overridden; not in the repo):** book TD loads → all 22 runs close
and 140 / 146 match; the 6 left were book slips (now errata) → 146 / 146 possible. Mixing the book's B split with the
tool's A.2 split still closes (A.2 free). With TD2's load fixed, the B split that closes is unique (Newton on TD1-right
/ TD3-B); TD2's load itself is not fixed by closure (one free constant = the G4 rule).

**Opening study** (`docs/diaphragm-analysis-opening-study.md`, `scripts/study/`): stringer-panel stiffness reference;
validated (regular diaphragm exact, Ex 3.5 / 4.1 / 4.3 within ~1–2 %); results above (G3, G4).

**Other decisions this day:**
- Ex 3.3 line A (802.5 / 3388.5 / 3236 / 36): book slips (20.5 and 40.9 plf instead of a uniform 30.5 plf in the TD
  band); the tool's chain is kept (errata note in Ex3.3.mjs).
- **Diaphragm pieces** (schema 2): a diaphragm is one or more rectangles (D1.1 …) analysed as one beam; openings belong
  to the plan; **hard checks** — pieces and TDs inside the outline (exact) and not over an opening, pieces not
  overlapping, one region. Upgrade cuts schema-1 rectangles into pieces (same results; rectangle kept in x1..y2 as the
  record). Editor: + Piece, Fill between supports, piece rows, per-piece edges, Delete removes a piece first. Reason:
  the book splits a plan into separate diaphragms only at support lines (walls, struts into TDs — Ex 3.3, 3.4, 4.2,
  Ex 8.1 at wall line 6, Ch 8.4 at collectors); a depth change / notch / opening is not a split (Ex 3.5, Ex 8.1 §8.3
  "double offset diaphragm") — so one diaphragm must be able to follow an irregular outline.
- Plan tab: Show filter (diaphragms / TDs / openings), view only.
- Ex 8.1 errata added: N:B:4 and N:6:A.2 senses (the book's own arithmetic), N:B:9 = 3500 (book 1750), rounding
  tolerance on three closing zeros; p11 grid 4 label, p35 line 8 at C, TD3 30.45 / 30.46.
- CALC_VERSION: td-v7 (pieces, G5, G6, consistent Vierendeel), td-v8 (G4 section default, G3 rule, warning).
- Code: tdGeometry (`splitRegion`, `diaphragmBands`, `onSheathing`, `partsConnected`, checks; TD load side 'both'),
  tdMigrate (schema 2), tdModel (`newDiaphragm(mark, dir, parts, supports)`), tdBasicShear (bands by piece; opening
  warning), tdMembers (`chordCut`, `zeroShearPoint`), tdDerive (G1, G5, `continuingEdges` G6), tdNet (check note),
  tdPlanEditor (pieces, filter, settings), tdBookKeys (`tdP`), toInputs / daBookDoc (pieces). Fixtures:
  legacy-td/schema1-ex35-rect-diaphragm.json, schema1-ex51-rect-diaphragm-opening.json.

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
