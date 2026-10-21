# Shear Wall Design — Backlog

Open items after the 2026-09-22 elevation review rounds and Phase 4 round 1 (R1–R3, 2026-09-24).
Branches: `shearwall-load-path` (pushed, merge to `master` by someone else), `results-and-links` (G4, pushed 2026-09-24), `phase4-r1-r3` (Phase 4 round 1 + distribution + results by line; pushed 2026-09-24; CALC_VERSION v7, schema v6), `phase4-round2` (P9, R4, R6, WSWH, live loads, results / report rework; local 2026-09-28, not pushed; CALC_VERSION v9, schema v8), `sw-verification` (off phase4-round2; checks, drift sizing, solid segmented walls, calc sheet + S0–S7, verification cases, drift sizing with anchorage, verification split, F-DD1 equal-δ solver, zero-share warnings + engineer review, UI / report restructure, wind drift limit, PDF report + elevation rework, one shared elevation renderer, PDF calc sheet = tool calc sheet, drift in every method case; committed and pushed to GitHub 2026-10-01; CALC_VERSION v18, schema v12).

## Next session — start here (set 2026-10-14, end of session)
**State:**
- Branch `sw-hardware-data`: committed (`cba1f9a` diaphragm docs, `5592c6b` Shear Wall) and pushed. **[PR #3](https://github.com/Ruihao-spacial/design-item-hub/pull/3)** `sw-hardware-data` → `master` open (PRs #1 / #2 already merged into `master`).
- CALC_VERSION **v23**, schema **13**. `npm test` all green (method cases 97, wood 8, APA T555 regression unchanged); `npx vite build` OK; goldens accepted, catalog regenerated.
- Rules now in force (Step 5 below): drift / deflection **lateral only**; Δa = δ_LRFD × T / T_LRFD (segmented), d_a × T_pier / HD_lrfd (FTAO), Δ_LRFD × V / V_LRFD (WSWH) — all at the 1.0 level; no drift LC; no stored stiffness k (one δ(V) per wall type, `deltaShare`).

**First thing next session (user):**
1. Review in the app (http://localhost:5173): a wall's calc sheet **C7** (Walls tab → Detailed → level / type / mark; scaled Δ_HD row, no gravity rows), the Distribution tab "δ at share", the Hardware tab, Summary wood settings.
2. **Re-seed SW-VERIFY** at calc v23 (stored items still show v21 drift until recalculated); optional bulk upgrade of other items.
3. Merge PR #3 (done by the user / someone else).

**Then (open items, unchanged):** PDF "Design data" appendix; verify the D2 strap source (C-C2026 pp. 295–296); F-DD1 still present in milder form (V17 Line B SW-6 takes 0.37 k of 7 k vs ~33 % by capacity); nailing row 2 wind 1120 vs 1128 in D1.

## Hardware data — Hardware tab revision + SPF/HF (started 2026-10-13, branch `sw-hardware-data`)
**Goal (user):** the Hardware tab shows where every value comes from; add SPF/HF values (all data are DF/SP today). The user enters all catalog data; Claude never transcribes Simpson / NDS values.

**Step 1 — DONE 2026-10-13 (display only, no result change, uncommitted):**
- `shearWallHardwareTab.js` replaces the old Hardware tab. Each table has a source block (document, edition, page, Shared Drive file, basis); calculated columns are marked ƒ with the formula under the table; "—" = not entered; grey "(current)" columns = the basis the calc uses until the data input phase.
- DF/SP | SPF/HF toggle (one species at a time; default = the project grade's group, `NDS_GRADES[].group`; not saved).
- Tables: nailing (ƒ C_G, ASD / LRFD), HDUE, MSTC per span, FTAO straps (all nail rows, species fasteners, length), WSWH T01–T03 (Seismic / Wind toggle, collapsed), wood grades, post sizes, post compression capacity, assumptions.
- Reference .md files on the Shared Drive restructured (originals in the session scratchpad): source table, DF/SP + SPF/HF sections, new blank columns LRFD cap / δ @ LRFD cap, old-basis δ column kept until filled; new `Wood grades NDS 2018.md`; WSWH README §7.

**User decisions (2026-10-13):**
- ~~Holdown / strap δ: Eq. 4.3-1 uses **δ @ LRFD cap directly** (no δ·T/cap scaling).~~ **Superseded 2026-10-14 (Step 5): Δa = δ_LRFD × T / T_LRFD.** Each δ sits with its LRFD cap (HDUE and MSTC). T(1.0) > LRFD cap → **warning sign only** (no upsizing, no NG; drift is governed by the 3-term equation).
- LRFD caps are never a design check (design = ASD per the combination definitions).
- WSWH: option B — Δ_LRFDcap used directly, warning when V(1.0) > V_LRFDcap; the LRFD columns become input values.
- No fastener / anchor columns; no "used in this project" column; PDF "Design data" appendix after the data input.
- Post & Timber (NDS 4D, 6x6 / 8x6) = separate post-design topic.

**Step 2 — DONE 2026-10-13 (calc change, schema 13 / CALC_VERSION v19, uncommitted on `sw-hardware-data`):**
- The user filled 5 reference files (renamed with underscores; old versions in "Archived - not use"): HDUE per framing group **and wall width** (4" / 6"), MSTC per group and span (δ calculated: steel + 0.070 in slip), nailing DF/SP + SPF/HF (SPF/HF entered as V_n × C_G, C_G = 0.92 for SPF and HF), wood grades DF-L / SP (4B by width) / SPF / HF in Tables 4A / 4B / 4D. Claude filled the D2 source (C-C2026 pp. 295–296, to verify). All derived numbers re-checked (HDUE 24 rows, MSTC 22 rows recomputed from the strap model, nailing 35 values).
- `scripts/buildHardwareData.mjs` → `src/modules/shearWallHardwareData.js` (GENERATED; `npm run hardware:build`, `hardware:check`); sanity checks fail the build on a broken table. The Hardware tab reads it (sources incl. "Entered by").
- **Wood (user):** three Summary settings — Species (DF-L / SP / SPF / HF → DF/SP or SPF/HF tables), Grade — dimension lumber (4A / 4B), Grade — posts & timbers (4D, 6x6 / 8x6). Schema 13 migration: old items DF-L, P&T grade follows the dimension grade (SS → SS, No.1 & Btr / No.1 → No.1, No.2 / No.3 → No.2). Frozen fixture `tests/fixtures/legacy/schema12-tc1.json`.
- **Posts:** 4A with C_F by nominal width (2"–4" 1.15, 5"–6" 1.10, 8" 1.05 — fixes 8x4 1.10 → 1.05 and 4x6 1.00 → 1.10); SP 4B by width class with C_F 1.0 (SP 8x4 not available — no 8" table); 6x6 / 8x6 = 4D with C_F 1.0. Bearing and sill crushing use the **sill plate F_c⊥ (4A / 4B)**, also under a 4D post (user check). Chord E in Eq. 4.3-1 = the end post with the smaller E·A.
- **Deflection:** Δa = δ @ LRFD cap used directly (holdowns, straps, FTAO engine `daConstant`); T₁.₀ > LRFD cap → ⚠ in the Drift tab, calc sheet C7 and PDF (`ln.deflWarnings`), never NG. LRFD caps reported only (Forces tab uses the table value for HDUE and MSTC).
- **Drift sizing:** the anchorage step takes the lightest larger size whose δ @ LRFD cap is smaller (the δ column is not monotonic: HDUE7 0.216 → HDUE9 0.188). Effect: drift is now mostly fixed by nailing; with manual nailing the E-W test stays NG even at HDUE17.
- **Results that changed:** drift / deflection everywhere (e.g. V04 δx 1.809 → 3.268 in), deflection-distribution shares (V17), HDUE17 4" 17,685 → 16,040 lb, HDUE9 8,425 → 9,390 lb with min post 4x4 → 6x4, 6x6 / 8x6 post capacities (4D). Tests updated to the new rules; new `tests/shearWallWood.test.mjs` (8); method cases V01 / V14 / V15 / V17 / V18 / V22 / V23 hand calcs rewritten (δ @ LRFD cap), goldens accepted (drift + V17 shares only), catalog regenerated. `npm test` green, build OK.

**Step 3 — DONE 2026-10-13 (CALC_VERSION v20), REVERTED 2026-10-14 (Step 5): gravity in the drift case.** Kept for the record:
- Seismic: 1.0D + 0.5L + 1.0E; wind: 1.0D + 0.5L + α_s·W (Lr not included). Built from the accumulated load cases (`deflectionGravity`, shearWallDeflection.js): uplift end T = lateral − (D + 0.5L), other end C = lateral + (D + 0.5L), own + from above. Net T ≤ 0 → Δ_HD = 0 (user). The same δ drives drift, drift sizing and the equal-δ distribution (user). No new combination / LC#; G12 superposition unchanged.
- Drift sizing: the anchorage step is skipped when the governing end has no net uplift. "> LRFD cap" warning uses the net T. Calc sheet C7 shows the gravity per end and T / C per direction.
- FTAO walls (engine) and WSWH (table Δ) are unchanged — lateral only.
- Tests: wood test + gravity rule; 15 method-case hand calcs pass the gravity per end (`eq431` GL / GR); goldens accepted (drift + V17 shares). TC-1 no longer warns (dead load keeps T below the LRFD cap); TC-1 drift N-S 1.17 / 2.00 in, E-W 1.82 / 2.14 in.

**Step 4 — DONE 2026-10-13 (CALC_VERSION v21): WSWH drift basis (user, option B as the user meant it).**
- The table Δ is the deflection at its own cap, so it stays linear in V; the reference point is the LRFD pair: Δ = Δ_LRFD × V(1.0) / V_LRFD; stacked base Δ₁ = Δ₀,LRFD × M_d / M_allow,LRFD (M_allow,LRFD = V₀,LRFD·H₁/12); stiffness k = V_LRFD / Δ_LRFD. ⚠ when V(1.0) > V_LRFD (base: M > M_allow,LRFD) — `deflWarnings`, never NG.
- The LRFD columns stay the derived values (no public LRFD data — user); results differ from the old ASD line only by the column rounding (V20 panel 0.3550 → 0.3532 in). WSWH README §7 rewritten. V20 / V21 hand calcs use the LRFD rows; goldens accepted (V20 / V21 drift only).
- ~~Open (optional): the WSWH Table 01 lookup P in the drift case~~ — closed 2026-10-14: Table 01 Δ does not depend on P (V and Δ move together; k within ~2.6 %), drift is lateral only (Step 5).

**Step 5 — DONE 2026-10-14 (CALC_VERSION v23, no schema change, uncommitted): drift lateral only; Δa from the LRFD pair; one δ(V) per wall type (user).**
- **Why (user):** the drift LC only changed the h·Δa/b term; FTAO cannot take it without leaving APA T555, and WSWH Table 01 Δ does not depend on P (V and Δ move together with P, k within ~2.6 %). Decision: back to lateral-only drift and make the three wall types consistent at the LRFD level.
- **Drift / deflection end forces lateral only:** T = C = the accumulated 1.0E (ρ = 1) / α_s·1.0W end force, own + from above. `deflectionGravity` / `DEFL_GRAVITY` removed; the drift LC group, its LC#, Forces / LC table / elevation entries removed (`shearWallCombos.js` back to the committed version). TC-1 is LC1–LC17 again.
- **Δa linear from the LRFD pair (user: Δa is linear in T):** `anchorageDelta(hw, T) = δ_LRFD × T / T_LRFD`, `anchorageFlex(hw) = δ_LRFD / T_LRFD` (shearWallHardware.js). Above the LRFD cap: extrapolated, ⚠ warning only (unchanged rule).
- **FTAO (user):** APA T555 pier force kept, LRFD pair: Δa = d_a × T_pier / HD_lrfd (engine local change; the old ASD `HD_allow` path stays for the APA regression, `test/ftao.test.js` unchanged). The softer end holdown is picked by δ_LRFD / T_LRFD.
- **WSWH:** unchanged (Δ = Δ_LRFD × V / V_LRFD already the same rule).
- **Stored stiffness k removed (user):** every wall type has one δ(V) at the 1.0 level (`_deltaAt`): sheathed Eq. 4.3-1, FTAO engine with α_s = 1 (`ftao._deflAt`, adapter), WSWH `wswhDeltaAt` (stacked base with the upper panel's moment held — the old k ignored it). New stored `deltaShare[lt]` = δ at the wall's own share; the spread, G3, the Distribution tab and the calc sheet share line use it (`V_x × k_w / Σk` replaced by "the share at which δ_w = story δ*"). Fixes the FTAO wind k being read at α_s instead of 1.0W.
- **Drift sizing:** the anchorage step takes the lightest larger size that is stiffer (lower δ_LRFD / T_LRFD); saving = (h/b)·T·(f_cur − f_next). E-W test: manual nailing now reaches Level 1 OK with HDUE17; the Roof stays NG.
- **Audit (read-only script over all V-cases):** 82 sheathed directions Δa = δ_LRFD·T/T_LRFD, 6 FTAO pier cases d_a·T_pier/HD_lrfd, 3 WSWH panels Δ_LRFD·V/V_LRFD, 45 δ-at-share = reported δ (W at 1.0) — 0 mismatches.
- **Tests:** Phase4 / Wood / Drift / CalcSheet / Round2 updated to the new rules, drift-LC and gravity tests removed, LC counts back to 17 / 13 / 23. Method-case hand calcs rewritten (`eq431` without GL / GR, scaled Δ_HD; V01, V14, V15, V17, V18, V22, V23 own calcs) — every T2 passes. **Goldens accepted 2026-10-14 (user), catalog regenerated (19 cases, all pass), `npm test` green, build OK:** only δ / drift change (V04 δx 3.27 → 1.81 in, back to the v18 value 1.809 — v18 also scaled the slip with T), plus the deflection-distribution shares and their end forces in V17 / V23 (V17 Line B SW-6 0.053 → 0.367 k; V23 SW-6 still zero share).

**Next:**
0. **REVERTED 2026-10-14 (Step 5) — drift LCs (CALC_VERSION v22) removed.** Kept for the record: New combo group `drift` in `comboDefs` (shearWallCombos.js), numbered last (after Ω₀ LRFD, so every existing LC# stays): `1.0D+0.5L+1.0E` (§12.8.6.1, ρ = 1) for seismic, `1.0D+0.5L+αsW` (w = α_s) for wind **only when α_s is entered** (blank α_s = no wind drift, as before). α_s is passed to `computeWallTC` (regular walls and WSWH). Shown in: the Forces tab dropdown (group "Drift"; Cap = LRFD cap and the ratio as "⚠ > LRFD cap" text, never a D/C colour — user 2026-10-13 rule), the LC definitions table (Group "Drift", role text), the load case "Used for" text (names the drift LC#), the per-wall end-force table and the elevation combo select. G12 superposition covers the new LCs automatically. The deflection itself is still computed by `deflectionOf` (it needs trial shares for the equal-δ solver); new test `shearWallWood.test.mjs` asserts deflection T / C (→ and ←, E and W) = the drift LC end forces. Goldens unchanged; `npm test` green, build OK. Tests updated: Round2 R4 group list, Report LC numbering (seismic 18, wind 13 / 14 with α_s, both 25).
   - Note: FTAO and WSWH drift stay lateral only, so for those walls the drift LC is display of forces only (role text says so).
1. User review in the app (Hardware tab, Summary wood settings, Drift tab warnings) and of the regenerated catalog — see "Next session — start here" at the top.
2. SW-VERIFY re-seeded by the user after v21 (verified read-only 2026-10-14: 19 items, schema 13, calc v21, DF-L / dfir_pt_no1) — **re-seed again at v23**. Optional bulk upgrade of other items to schema 13.
3. PDF Design data appendix.
4. Verify the D2 strap source page (C-C2026 pp. 295–296) and its values.

**Review items, resolved 2026-10-13:** 6x6 / 8x6 posts now NDS 4D; C_F 8x4 1.05, 4x6 1.10; DF-L No.2 E_min 580000 (user); HDUE13 8x4 / HDUE17 6x4 minimum posts confirmed (user); the 0.92 footnote-10 factor is kept together with C_G = 0.92 for SPF/HF (user). Still as before: nailing row 2 wind 1120 vs 1128 in D1.

## Next session — start here (set 2026-10-01, end of session)
**Update 2026-10-08:** [PR #1](https://github.com/Ruihao-spacial/design-item-hub/pull/1) opened, `sw-verification` → `master`.
- It carries every Shear Wall branch (32 commits: load path, results-and-links, Phase 4 rounds 1 and 2, verification).
- Diaphragm to LRS is PR #2, stacked on it (see `docs/diaphragm-to-lrs-backlog.md`). Shear Wall code is unchanged since 2026-10-01.

**State (end of 2026-10-01):**
- Branch `sw-verification` **committed and pushed** to GitHub (user request). Merging into `master` is still done by someone else.
- CALC_VERSION **v18**, schema **v12**.
- `npm test` all green (method cases 97, rules incl. R9, report tests 17); `npx vite build` OK.
- Goldens accepted (v18: only the new drift values were added); catalog regenerated (19 cases, all pass); SW-VERIFY cleaned and re-seeded (19 items).

**First thing next session:** the user reviews, in the app (http://localhost:5173, Test-123 / SW-VERIFY):
1. TC-1 PDF **Detailed** — the calc sheet pages are now the tool's A → C7 sheet (longer report), and both elevations (shared renderer).
2. The tool elevation — Wall HW row under each wall (edge strips gone), "(both)" whenever ends are equal, L: / R: rows on narrow walls with different ends, post / beam HW tagged "P-1: …" / "BM-1: …".
3. The SW-VERIFY Verification tabs — every case now has its drift hand calc; V04 / V13 / V21 / V22 verify drift NG.

**Done on 2026-10-01** (details in the sections below):
1. **V23 zero-share wall:**
   - a holdown check with the share each larger HD / strap would give;
   - a free-split under-load warning (the other walls carry more than designed);
   - both are distribution **warnings** (amber, not NG).
2. **"Engineer reviewed — OK" button** per distribution warning:
   - stored in `line.distReviewed` (schema v11);
   - goes stale when the warning text changes.
3. **V23 seismic inputs** (Cd 4, Ie 1.0, RC II, Ω₀ 2.5); drift is now checked in V23.
4. **UI / report restructure:**
   - load cases + LC#; subscripts;
   - linked gravity D = lateral DL, greyed out;
   - Export PDF at the top of every calculator;
   - tabs Walls · Distribution · Posts & Beams · Drift · Forces · Checks;
   - PDF per wall line.
5. **Wind drift:**
   - the tab explains when α_s is missing;
   - a separate wind table with a limit h_sx / n (project setting, default 400, report only, schema v12).
6. **PDF review rounds:**
   - front page trimmed + lateral loading tables; Symbol-font glyphs; large wall-line heading;
   - line + wall definition tables;
   - two elevations (end forces / hardware); "L:" / "R:" rows; each wall's calc sheet on a new page; wrapping titles.
7. **PDF elevations:**
   - landscape pages, a standard scale (1/4", 3/16", 1/8" = 1'-0", ≤ 2 parts), split in gaps between elements;
   - labels with no free spot → numbered notes under the drawing;
   - screen font and sizes (`ELEV_FS`, `ELEV_FONT`); coloured D/C everywhere;
   - FTAO strap on the hardware elevation only.

**User decisions on 2026-10-01** (keep):
- **Zero-share wall:**
  - The tool calculates the holdown / strap check and lists the other fixes as text.
  - The zero share stays for design.
  - The other walls are **not** redesigned; they get a big warning instead.
- **Distribution warnings** can be marked "Engineer reviewed — OK"; the review is void when the values change.
- **Linked gravity rows** use the Flat Load **lateral DL** (`dlLateral`) for D.
- **Load combinations:**
  - one LC# per combination, numbered ASD → LRFD → Ω₀ ASD → Ω₀ LRFD;
  - load cases (D, L, Lr, E, W) are a separate table;
  - other tables refer to the LC# only.
- **Tabs:**
  - Load path tab → **Posts & Beams** (hardware schedule of isolated posts / beam supports);
  - LRFD + Ω₀ tabs → one **Forces** tab with an LC dropdown;
  - Checks is the last tab; Walls is the default;
  - Distribution: δ at zero own share and k columns removed.
- **PDF:**
  - organised **per wall line** (never mix lines in one table);
  - Summary = schedules, Detailed = Summary + calcs;
  - each wall's calc sheet on a new page.
- **PDF elevations:**
  - two per line: end forces at the ASD envelope, and hardware with no forces;
  - auto standard scale on **landscape** pages.
- **Wind drift:** the limit is a project setting h / n (default 400), **report only** (amber warning, no upsizing).
- **PDF vs tool elevation:** ~~keep two separate renderers~~ — superseded later the same day: **one shared renderer**, the tool elevation is the standard (see below).
- **Accepted as they are:** lateral loading appearing on the front and on each line; narrow-wall "(both)" labels.

**Done later on 2026-10-01 — one elevation renderer (user review of the TC-1 PDF, item 1; plan `~/.claude/plans/effervescent-shimmying-ocean.md`):**
- **Rule (user):** the tool elevation is the standard; the PDF must show the same drawing, so a change is made once.
- `drawElevationScene(S)` in shearWallElevation.js draws everything (grid, levels, gravity loads, walls, openings, h/b, WSWH, T/C strip, Wall HW row, audit marks, posts / beams). The tool (`drawSVG`) adds only interaction (`S.live`, `S.handlers`). The PDF (`renderElevationFullForPdf`) passes the print palette, `combo: governing` and one toggle per elevation (forces / hardware). The PDF-only T/C, wall text and hardware code and the tool's edge strips were removed.
- **Wall HW row in the tool too** (user choice): HD / strap + post per end under the wall, with hover tips and click-to-edit (`wallEnd:<id>:left|right|both`). The edge strips are gone.
- **"(both)" rule (user):** both ends equal → one centred label with "(both)" at **any** wall width, in the T/C strip and the Wall HW row (TC-1 N-S SW-2 / SW-4). Ends differ → one column per end, or on a narrow wall one "L:" / "R:" row per end; the strip grows one row where the Σ rows need it (`wallTcPlan`, `tcRowsByLevel`).
- **Post / beam hardware labels** carry their owner ("P-1: HDUE3 0.63", "BM-1: MSTC40 0.26"), hardware id in ink and only the D/C coloured, like the Wall HW row (user: the post HD could not be told apart from the wall HD on SW-6).
- **Crowding:** labels keep a 4 px gap side by side (`LABEL_GAP_X`) and ▲ ▼ Σ are measured 0.9 em wide. TC-1 E-W: P-1's label (inside SW-6) now goes to note (1) at 1/4" instead of touching SW-6's labels. Wall labels are drawn above post / beam lines, so a post line never strikes through them.
- **Shared legend** (`elevationLegendItems`) for the tool row and the PDF strip; the PDF legend and notes are at the drawing text size (`ELEV_FS.legend`), closing the old open item 2.
- **The PDF now also shows** what the tool already drew: gravity-load labels, the h/b warning, triangle + Σ T/C values, the tool's level labels. The WSWH anchor (hardware) shows on the hardware elevation only.
- **Tests:** shearWallReport.test.mjs — tool vs PDF draw the same labels at the same places (TC-1 + V09 / V10 / V14 / V20, both modes), "(both)" / L: R:, the 4 px gap and note (1). WSWH elevation test reads the anchor from the hardware elevation.

**Open / to start with next time:**
1. **User review** — see "First thing next session" above.
2. (closed — legend at drawing size)
3. ~~Subscripts not yet everywhere~~ — **DONE 2026-10-01:** the live calc sheet (titles, notes, every table cell) uses the PDF rule `subMarkup` (`sheetText` / `sheetTable` in shearWallDesign.js), so R_L, M_R, h_sx, F_Level, H_e … show as subscripts on screen as in the PDF. The only elevation label with a symbol, the WSWH anchor "d_e", is drawn with a subscript tspan (`richHaloText` parts accept `sub`). Hover tips stay plain text.
   - **Found:** the PDF Detailed calc sheet is built from `overturningRows` + a few tables, not from the live sheet builders (A–C, C1–C7). Like the elevation before, the screen calc sheet and the PDF calc sheet are two different presentations. Offered: build the PDF calc sheet from the same builders as the screen (one source).
   - **DONE 2026-10-01 (user: "the PDF calc sheet same as the tool"):** `wallSheetBlocks` (shearWallDesign.js) is the one content list of a wall's calc sheet (title, A–C7 headings, notes, key/value tables, tables, collapsed parts). `renderWallSheet` draws it on screen; `wallSheetPdfSections` turns it into the PDF Detailed sections (heading + sub-heading = section title, collapsed parts printed open, link buttons dropped, subscripts via `subMarkup`, red superposition rows kept red). It replaces the old PDF calc sheet (overturning rows + gravity + end-force + FTAO tables). Each sheet still starts on a new page.
   - **Found on the way:** a styled key/value row (`{ cells, style }`, the governing deflection row) printed "undefined" — fixed.
   - **Test:** shearWallReport.test.mjs compares, for every wall of TC-1, V14 (FTAO) and V20 (WSWH), the screen sheet's table cells with the PDF sheet's cells (identical) and checks the A / B1 / C headings.
4. ~~Remaining method cases leave Cd / Ie / RC / Ω₀ blank~~ — **DONE 2026-10-01 (calc v18):** every method case has Cd 4 / Ie 1.0 / RC II / Ω₀ 2.5 (ASCE 7-22 Table 12.2-1 A.15; lib.mjs `SEISMIC`) and a story-drift hand calc (`eq431` = SDPWS Eq. 4.3-1 both directions with the pinned design, `storyDrift`, `driftExpect`). WSWH panels use the table drift Δ_cap·V/V_cap (stack base Δ₀·M/M_allow); V14 FTAO uses the APA T555 pier method with the pinned design. **User decision:** cases that fail drift with their pinned design keep drift NG and verify it — V04 (1.809 > 1.68 in), V13 (2.416 > 2.40), V21 Line A Level 1 (2.440 > 2.16), V22 (3.118 > 2.40). Goldens changed only in the new drift values; catalog regenerated; SW-VERIFY re-seeded (19 items).
   - **Engine fix found on the way (V22):** a risk category typed with spaces (" II") silently disabled the drift limit; `driftLimit` now trims it (CALC_VERSION v18).
5. **Closed 2026-10-01:**
   - **Drift sizing (user decision):** keep the current rule — drift sizing raises only the governing wall's step at a failing story (TC-1 N-S: SW-3 to 2" o.c., SW-4 stays); **no need to raise every wall at the story to match nailing.**
   - **SW-VERIFY cleanup:** the retired V05 / V06 / V07 / V16 items and the "V17-3k — comparison" copy were deleted from the local project (user OK); 19 case items remain.
6. ~~One shared elevation renderer~~ — DONE 2026-10-01 (see above).
7. **Hub roadmap unchanged:** U1 PDF template redesign, U2 cloud deploy (last), U3 Beam Calculator.

## Previous start-here list (set 2026-09-30, kept for history)
1. **F-DD1 — DONE 2026-09-30 (calc v14).** The user rejected rewriting δ as c·V + d (it departs from the 3-term Eq. 4.3-1). Implemented instead:
   - **The equation is unchanged:** each wall's δ is SDPWS Eq. 4.3-1 at its share with its end forces (own + from above). `wallDeflectionAtShare` holds the from-above part.
   - **The solver changed:** `solveDistribution` / `equalDeflectionSplit` find the shares where every wall gives the same δ* and ΣV = V (bisection), and recalculate the line until no share moves > 0.001 k.
   - **Zero-share walls (user rule):** a wall whose δ(0) ≥ δ* takes no share, with a warning. The note fires when δ(0)/δ* > 0.5 (user choice, instead of a capacity %).
   - **Checks:** G3 checks equal δ ±0.5 %, ΣV = V, and δ(0) ≥ δ* for zero-share walls; R8 does the same in the rule tests.
   - **Display:** the Distribution tab shows δ at zero own share and the story δ*.
   - **Cases:** V17 Line B is now exact (SW-6 0.367 k, δ 0.4261 in). New V23 has a zero-share wall.
2. The user reviews the new catalog `docs/shear-wall-test-cases.md` (method cases only) and the drift-sizing steps in the app (Drift tab).
3. SW-VERIFY still holds the retired items V05 / V06 / V07 / V16 and the comparison copy "V17-3k — comparison" — delete by hand if not wanted.
4. **V23 zero-share wall — DONE 2026-10-01 (calc v15).** User rules:
   - **Holdown check:** for a zero-share wall the tool tries every larger catalog holdown / strap (both ends, same family, post raised to the minimum post). It keeps the other walls' δ fixed and reports the share each option gives. It is an estimate: set the override and recalculate to confirm. The other fixes (longer wall, less force from the stack above, story walls stiffer than their strength needs) are listed, not calculated.
   - **Zero share stays for design.** The free split (equal δ without V ≥ 0; T / C clipped at 0) is information only.
   - **Big warning when walls carry more than designed:** "the other walls carry more than designed … more wall may be needed". The other walls are not redesigned.
   - **Display:** `distribution.warnings` (types `dist_zero_share`, `dist_under_load`) replace the zero-share audit note. They show as an amber banner on the line results and the Distribution tab, a "free" value in the share column, a holdown-check table, PDF rows, and line status WARN (not NG).
   - **V23 values:** HDUE7 0, HDUE9 + 4x4 0.07 k, HDUE13 + 8x4 0.73 k, HDUE17 + 6x4 1.17 k. Free split SW-5 5.285 k, SW-6 −0.285 k, δ 0.3008 in.
   - **Engineer review (user request 2026-10-01, schema v11):** each distribution warning has an "Engineer reviewed — OK" button. The review is stored in `line.distReviewed` [{ key, message, date }] (`migrateV10toV11`, fixture schema10-zero-share.json). A reviewed warning shows small with the date and an Undo button, and no longer counts in the line status. The PDF prints "engineer reviewed OK". The review holds only while the warning text is unchanged; when the values change it is stale and the warning counts again. Test: R9 in shearWallRules.test.mjs.
   - **V23 now has the seismic inputs:** Cd 4, Ie 1.0, RC II, Ω₀ 2.5. Drift is checked: Level 2 δx 1.369 in, Level 1 1.512 in ≤ 2.4 in OK. The other method cases still leave Cd / Ie / RC / Ω₀ blank, except V15 / V18 / V22.
   - **Code:** `freeDeflectionSplit`, `anchorageTrials`, `zeroShareFollowUp`, `distributionWarnings` in shearWallCalc.js; `wallDeflectionAtShare(…, signed)`.
5. State at the end of 2026-10-01: `npm test` all green, goldens unchanged except the calc version, catalog regenerated, SW-VERIFY re-seeded. (Previously, 2026-09-30: `npm test` all green (method cases 97 tests incl. V23, rule tests R1–R6 + R8, drift R7), `npx vite build` OK, catalog regenerated (19 method cases), SW-VERIFY re-seeded. Nothing committed on `sw-verification` — commit / push only when the user asks.)

## UI / report restructure — DONE 2026-10-01 (calc v16 → v17, uncommitted; plan `~/.claude/plans/we-will-continue-the-sorted-dijkstra.md`) — awaiting the user's review
User decisions (review comments 1–3):
- **Load cases vs combinations:** Load cases (D, L, Lr, E, W) are a separate table with their roles (superposition / deflection). Each combination has an **LC#**, numbered continuously ASD → LRFD → Ω₀ ASD → Ω₀ LRFD (`comboDefs` → `lc`, `lcTag`, `rich`; `lcRef`). Everywhere else refers to "LC5 →". The two tables sit at the bottom of the Summary / Config tab, below Lateral Loading.
- **Subscripts:** `src/richText.js` — `X_{ab}` always, `X_ab` in headers. Used by `simpleTable` / `detailTable` and by pdf.js (tables, rows, text wrap by runs).
  - Not yet converted: SVG elevation labels, and most calc-sheet cell texts (they still use plain "R_L" — add braces where wanted).
- **Linked gravity rows:** D = Flat Load **lateral DL** (`dlLateral`, fallback `dl`). D / L / Lr are disabled while linked, with an Unlink button. Existing links get the usual "Update from linked items" notice.
- **Export PDF:** at the top of every calculator (itemForm.js toolbar). A report dropdown appears only where the module declares `pdfOptions` (Shear Wall: Summary / Detailed). The PDF report dropdown was removed from the Summary tab.
- **Line tabs:** Walls (default) · Distribution · Posts & Beams · Drift · Forces · Checks.
  - **Walls schedule:** nailing (cap), v (D/C), T_L / T_R, C_L / C_R, HD/strap and post D/C coloured (`dcCell`, `dcLevel`: red > 1, amber ≥ 0.8). Governing LC# in the overturning table.
  - **Distribution:** "δ at zero own share" and "k" removed. Added relative stiffness % and the V_{1.0E} / V_{1.0W} header.
  - **Posts & Beams (replaces Load path):** a hardware schedule of isolated posts and beam supports (`postsBeamsRows`), wall-end transfers, warnings. The "not carried" notes are reworded "carried by framing outside this line … not checked here" and collapsed to one line. Beam lever tables are in `<details>`.
  - **Drift:** a summary table (`driftSummaryRows`) with the details collapsed.
  - **Forces (replaces LRFD / Ω₀):** an LC dropdown (ASD envelope default, every LC#, load cases); T / C per end with ASD or LRFD cap and D/C (`forcesRows`).
- **PDF per wall line** (user rule): front = design data, levels, load cases, LC table, line index with sheet numbers. Each line starts a new sheet with status + warnings, its loading (lateral + gravity), wall schedule per level, posts & beams, distribution, drift summary and elevation.
  - **Detailed** adds per line: overturning, calc sheets, gravity, end forces (LC#), FTAO, drift calcs, wall deflection, ASD envelope forces, wall-end / beam tables, and the G1–G12 summary.
  - Removed: the cross-line loading and project summary tables, the LRFD / Ω₀ sections, and the End Force Equations example.
- **Wind drift (user report 2026-10-01):** a wind-only line without α_s showed an empty Drift tab ("no walls carrying shear"). Rule P7 stands: wind drift only with α_s, report only. Now `drift.missing` says why (α_s missing; Cd / Ie missing), and the note shows under the summary table. Test in shearWallReport.test.mjs.
- **Wind drift limit (user 2026-10-01, schema v12, calc v17):** a project setting `windDriftLimit` (h_sx / n, default 400, Commentary CC.2.2), report only. Over the limit = amber line warning, never NG / upsizing. The Drift tab has a separate wind table (δ_w = α_s·δ(1.0W), Δ_allow = h_sx·12/n, ratio, status) with no C_d columns; seismic keeps its own table. Same in the PDF. `migrateV11toV12`, fixture schema11-wind.json.
- **Tests:** new `tests/shearWallReport.test.mjs` (10) in npm test. Older tests updated to the new tabs and LC#. Goldens are unchanged except calcVersion. PDFs were generated in Node for V10 / V14 / V17 / V23 without errors; the elevation image needs a browser.

## Done 2026-09-30 (branch `sw-verification`, uncommitted) — calc v13 → v14
- **Strap minimum post:** every MSTC floor strap end needs at least (2)2x4 / (2)2x6 (user rule). A smaller post override is replaced and flagged, like the HDUE minimum post.
- **Drift sizing — nailing or anchorage:** at each failing story, the governing wall's Eq. 4.3-1 terms estimate the δ saving of one nailing step (story common pattern) vs one holdown / strap size on that wall (both ends to one size above the larger end); the larger saving is applied (user rule). Walls report the anchorage basis strength / drift / manual; the Drift tab lists the sizing steps (`driftSizing.log`). Studied with the user: a bigger holdown fixes drift and also shrinks the stacked-wall offset (F-DD1); OSB / heavier nailing make F-DD1 worse.
- **Verification split (user decision):** method cases pin their design and form the reviewed catalog; selection rules R1–R8 are property tests (`tests/shearWallRules.test.mjs`, `tests/shearWallDrift.test.mjs`); goldens are a change detector (`npm run cases:diff`, then `cases:accept`). V05 / V06 / V07 / V16 became rule models (`tests/rules/models/`). Guard test: a method case may not expect a selection outcome. Checked: removing the strap minimum post or making drift sizing nailing-first fails only the matching rule tests; the method cases and goldens are untouched. V17 Line B is now the pinned F-DD1 base (converged; SW-6 starved: 0.37 k of 7 k vs 2.1 k by capacity).
- **F-DD1 research (2026-09-30):** no US code guidance. CWC Shearwalls documents the same non-convergence / zero-load walls. Flores et al. (WCTE 2025) use own-story stiffness for the split and cumulative rotation for drift only. WoodWorks: multi-story effects are left to engineering judgment.

## Next session — previous list (set 2026-09-29)
1. **Resolve finding F-DD1** (deflection distribution with stacked walls, = Q2 / Q4) — see "Finding F-DD1" below. The user decided to resolve it in the next session. Start by agreeing the rule (options A–C), then change `solveDistribution` / wall stiffness, add a check, and update V17 (and a new case for the converged-but-starved wall).
2. The user reviews the verification catalog `docs/shear-wall-test-cases.md` (or the SW Verification project in the app). After any change: `npm run cases:build`, `npm run cases:accept`, `npm run cases:doc`, `npm run seed:cases -- --apply`.
3. State: `npm test` all pass (111 case tests), `npx vite build` OK. Nothing committed on `sw-verification` — commit / push only when the user asks.
4. Local: http://localhost:5173, login ruihao@spacial.io / Testpass123. Projects Test-123 (TC-1, TC-2, 3 older items) and SW-VERIFY (method cases V01–V04, V08–V15, V17–V23; retired V05 / V06 / V07 / V16 items and the "V17-3k — comparison" copy still there). Saved items show their old calc version until opened and saved.

## Pending approval / housekeeping
| # | Item | Notes |
|---|---|---|
| H1 | Bulk upgrade of the local database — **optional** | Not required: the item form migrates and regenerates on open, and the project-page PDF now migrates on export (fixed 2026-09-22). Opening and saving the two Test 123 shear wall items clears the "Stale" badge and refreshes the stored label. Keep `SB_EMAIL=… SB_PASSWORD=… npm run upgrade:shearwall [-- --apply]` for the cloud move (U2), when every stored item should be brought to the current schema at once. |
| H2 | Merge `shearwall-load-path` into `master` — **committed `9723949` and pushed 2026-09-22; merge pending** | Why: everything since `b959485` (Phase 3) exists only as uncommitted changes on one local disk. Committing gives a restore point, pushing gives a GitHub backup, separate commits keep the history reviewable and revertible, and `master` is what a later Railway deploy builds from. Suggested: commit on the branch and push now, then merge to `master` once accepted. |

| H5 | App test of G4 on branch `results-and-links` — **passed and pushed 2026-09-24** | Flat Load edit → Mass Takeoff shows "Upstream changed" → Update + save → ELF flagged; Base Shear Cs → ELF notice; project-page PDF matches the form. |
| H6 | Local Supabase project name changed by master | `supabase/config.toml` `project_id` is now `engineer-service-calculator`. Running `supabase start` from this code creates a new, empty local stack; existing local data lives in the `*_design-item-hub` containers. Plan a data move before restarting the local stack. After pulling master, apply new migrations with `npx supabase migration up --local` from the repo folder (2026-09-22: `20260917000000_user_management_audit` was needed for login). |

| H7 | App test of Phase 4 round 1 on `phase4-r1-r3` — **passed 2026-09-24, pushed** | Add openings to a Test 123 wall, switch Segmented ↔ FTAO, link the Base Shear item (Cd / Ie / Risk Category), check elevation (cut-outs, piers, straps), results (FTAO calc, LRFD forces, story drift) and PDF. Push only when asked. |

## Phase 4 round 1 — open items (2026-09-24)
| # | Item | Notes |
|---|---|---|
| P1 | MSTC δ basis — **resolved 2026-09-24** | User: MSTC δ is at the strap LRFD cap = ASD cap / 0.7 (deflection only). HDUE δ is at the ASD cap. `deltaBasisLoad()` in `shearWallHardware.js`. |
| P2 | Dead load over openings — **resolved 2026-09-24** | User rule: only loads directly above the shear wall length count. Segmented piers take loads over the pier length only (loads over openings are not carried). FTAO walls take loads over the full wall length including above openings; FTAO wall self-weight excludes the opening areas. |
| P3 | FTAO jamb posts — **resolved 2026-09-24** | Sized for compression per the Diekmann pier chord (user): C = f_D·DL + v_i·h_o (ASD; f_D = 1 + 0.14SDS seismic, 1.0 wind). DL = half the adjacent pier's DL + half the header DL above the opening. Lightest (2)2x-or-heavier post of the line thickness; override applies to all jambs. Jamb areas feed the FTAO deflection. |
| P4 | Drift = largest wall δ per line and level | **Distribution choice added 2026-09-24:** project default + per-line dropdown, Wall capacity (SDPWS 4.3.3.4.1) or Deflection (equal δ at each level, shares ∝ k = V/δ from SDPWS Eq. 4.3-1 at 1.0E / 1.0W, iterated from capacity shares until the walls’ δ at every level are within 5% ((δmax − δmin)/δmax), max 20 passes, else the closest pass is used and flagged; FTAO walls use the engine δ). `solveDistribution` in `shearWallCalc.js`, CALC_VERSION v7. Drift still reports the largest wall δ (equal under the deflection approach). **Superseded 2026-09-30 (calc v14, F-DD1):** the k = V/δ iteration and the 5 % spread test are replaced by a direct equal-δ solve on the unchanged Eq. 4.3-1 (shares where every wall gives the same δ*, Σ V = V; zero share + note when a wall is displaced more than δ* by the forces from above). |
| P5 | Walls on beams / posts | Support deflection is not included in the wall deflection (noted in the table). |
| P6 | FTAO with unequal opening heights | Engine analyzes the whole wall at the governing opening (APA largest-opening rule); straps drawn at the highest head and lowest sill. |
| P7 | Wind deflection | Only when the service factor α_s is entered; report only (no limit). |
| P8 | FTAO hold-down | Wall-end T/C and hardware use the usual net formula with dead load over L_wall; the engine's gross H (no dead load) is shown as a reference. |
| P9 | HDUE minimum post — **done 2026-09-28 (`phase4-round2`)**: posts at holdown ends never below the catalog minPost; override lists hide smaller posts; a stored smaller override is replaced and flagged | HDUE catalog lists (2)2x4 / (2)2x6 minimum post for every HDUE, but post auto-select can pick a single 2x4 at a holdown end. Found 2026-09-24 while tracing the deflection distribution (single 2x4 roughly doubles the bending term and triples plate crushing, so δ jumps). Proposed: holdown ends never below the HDUE minPost. |

## Known gaps (found in review, not fixed)
| # | Item | Where | Notes |
|---|---|---|---|
| G3 | Beam reactions exclude floor gravity load | `shearWallLoadPath.js` | By design for now. **Note for the future Beam Calculator module:** consume Shear Wall `beamTransfers[].supports[]` (per-combo reactions, loads on the beam) through the existing `refs` / `extract` mechanism, add floor gravity (DL / LL tributary) and do the sizing there. Then decide whether the beam's reactions should flow back into the shear wall load path (support posts). Ties to R7. |
| G5 | Page-level recalculate-on-open path not exercised in automated tests | `itemForm.js` imports `db.js` (Vite env) | Accepted as-is (2026-09-22). Covered by build + code review + `scripts/lib/shearWallLoadCheck.mjs`. |

## Done / fixed
- **H3 (2026-09-22):** UI walkthrough by the user.
- **H4 (2026-09-22):** Test 123 cleanup (duplicate posts P-8 / P-13 on P-1).
- **G1 (2026-09-22):** the wall HD/Strap override list uses the wall level's floor-span strap table (`hwOptionsFor`), matching the post / beam-support panels and the quick editor.
- **G2 (2026-09-22):** every combination and load case reports both ends from one formula (net = fD·D/2 ∓ OTM/L). 1.0E / 1.0W are lateral only (T = C = V·h/L); they previously included dead load. The uplift-side end in D + 0.7ρE / D + 0.6W and a net-compression end in 0.6D combos are no longer dropped to 0. CALC_VERSION v5.
- **G4 (2026-09-22, branch `results-and-links`):**
  - All modules now regenerate results from their definition (`regenerateResults`), in the form, on the project page and in PDFs, through the shared `src/results.js`.
  - Linked values copied from upstream items are checked on open: Mass Takeoff psf from Flat Load assemblies; ELF W / hx from Mass Takeoff and Sds, Cs, Ie, Ω0, k from Base Shear.
  - When they differ, the item shows a notice with **Update from linked items** (fills the form, not saved) and **Dismiss**, and the project list shows **Upstream changed**.
  - Stored outputs remain the saved record. Tests: `tests/links.test.mjs`.
- **Project-page PDF (2026-09-22):** `exportItemPdf` migrates the stored item before building sections, so a PDF exported from the project list of a not-yet-re-saved item uses the current definition schema.

## Added 2026-09-22 (elevation / UI)
- Walls run floor line to floor line and label bands overlay them. The beam's bottom sits on its floor line with its reaction / hardware labels in the story below (or a foundation band).
- Label collision placement; posts inside walls are drawn dashed; dark halo on all force labels.
- T/C strip: P (this element only) on top; Σ rows only when loads from above change the values. Tension red / compression blue everywhere (P, Σ, R); the Σ and R markers stay purple.
- Legend row (live) and legend strip (PDF); wide page layout; elevation box fits its content.
- Overlap chooser for stacked elements; "Find element…" by mark / ID.
- Quick editor: hover nailing / hardware labels for demand, capacity and D/C; click to override nailing, HD/strap and post with per-option D/C. Manual overrides are marked ✎ (live) and `*` (PDF elevation + Wall Schedule).

## Done — Phase 4 round 1 (2026-09-24, branch `phase4-r1-r3`)
- **R1 openings:** wall `openings[]` (offset, width, sill, head) with method **Segmented** (pier by pier, marks SW-1a/b…) or **FTAO** (APA T555 / Diekmann engine vendored from the user's ftao-shear-wall skill as `shearWallFtao.js`, adapter `shearWallFtaoAdapter.js`, geometry `shearWallOpenings.js`). FTAO capacity weight = engine V_cap,ASD; nailing auto-select per governing zone; strap auto-select from the FTAO strap catalog (D2); jamb posts (D3); T555 narrow piers opt-in. Bad geometry / engine hard stops → wall designed as solid with an audit warning. Elevation: cut-outs, pier-by-pier results, FTAO strap lines + label, jamb ticks (live + PDF).
- **Aspect ratio:** SDPWS 2021 for all walls (1.25 − 0.125h/b above 2; > 3.5 not a shear wall, carries no shear). Changes only schema4 fixture SW-6 (h/b 2.5: 1.0 → 0.9375).
- **R2 deflection & drift:** SDPWS Eq. 4.3-1 per wall at 1.0E (ρ = 1), Ga by sheathing (Plywood default), Δa = δ·T/cap + plate crushing; δx = Cd·δxe/Ie vs Table 12.12-1 (Risk Category + row). Cd / Ie / Risk Category / Sds linked from the Base Shear item (G4-style notice).
- **R2 files:** `shearWallDeflection.js` (3-term terms, drift limits).
- **R3 LRFD:** forces only — ASCE 7-22 §2.3.6 combos in `computeWallTC` (group `lrfd`), accumulated through the load path, LRFD tables in results and PDF, HDUE LRFD cap 1.4× shown.
- Fixed: `migrateV4toV5` id regex (`'\d'` in a string), deferred elevation draw after destroy.
- Tests: `test/ftao.test.js` (engine, 15), `tests/shearWallPhase4.test.mjs` (18).

- **Results by wall line (2026-09-24):** each line tab (direction → line) shows that line's full results under the elevation, with sub-tabs Walls · FTAO · Load path · Drift · LRFD, recalculated from the current definition as it is edited. The bottom Results section is a one-row-per-line project summary. PDF: project summary table, then per line a summary block (new page) followed by schedule, T/C, FTAO, load path, drift, LRFD and elevation.

## Phase 4 roadmap
| # | Item | Notes |
|---|---|---|
| R1–R3 | Done 2026-09-24 | See above. |
| R4 | Ω₀ combinations — **done 2026-09-28** | User: forces only, never used for design. Ω₀ ASD (§2.4.5) + Ω₀ LRFD (§2.3.6) groups, Ω₀ linked from Base Shear, Ω₀ line tab + PDF. 'Load Combinations & Design Basis' table (Design / Deflection / Forces only) in Summary + PDF; combo dropdown groups labelled. |
| R5 | Links to other modules — **dropped 2026-09-28** | User: wall-line loading stays manual input (no ELF Fx link); no Mass Takeoff link needed. |
| R6 | Dead load by statics — **done 2026-09-28** | End reactions R_L / R_R from each load's position (self-weight ½ each end); net = fD·R_end ∓ OTM/L for every combo, replacing fD·D/2. |
| W1 | Simpson Strong-Wall WSWH wall type — **done 2026-09-28** | Tables from Shared Drive `Shearwall design reference/WSWH` (01–06; `nominal_ft` column added) via `scripts/buildWswhData.mjs`. Conditions concrete / raised floor / two-story stacked; width picked by user; nominal height = floor-to-floor (interpolated); P = combo-factored D; mixes with sheathed walls under either distribution; Table 06 anchors (smallest W, then d_e; SDC + detached dwelling); stacked 2nd story checked against the TSS rod. |
| G6 | Live load / roof live load — **done 2026-09-28 (aa7d508)** | Gravity rows point / full line / partial with D, L, Lr (schema v8); Flat Load assembly × trib link; all ASCE 7-22 ASD + LRFD combos (shearWallCombos.js) with optional LRFD 0.5L; gravity on transfer beams and post tops carried down; support post members max(ASD, Ω₀ ASD); FTAO jambs and WSWH P include L; calc detail documents every load and the end forces of every combination. CALC_VERSION v9. Open: beam member design (R7); S / R not tracked. |
| G7 | Line results / report rework — **done 2026-09-28 (4ab70d1)** | Tabs Distribution · Walls · Load path · Drift · LRFD · Ω₀. Distribution: capacity-method table, or the deflection-method final pass with the stiffness basis (Eq. 4.3-1 terms / WSWH table / FTAO engine). Walls: Summary (schedule + overturning table) or Detailed (each wall's calc by type, with an Overturning section). PDF report setting Summary / Detailed (calc sheet per wall). |
| H8 | App test of `phase4-round2` — **pending** | P9, Ω₀ + design basis, dead load by statics, WSWH (demo item in Test 123), live loads / psf × trib / Flat Load link, Distribution tab, Summary / Detailed report, PDF. |
| T1 | Test module for the design calculator — **built 2026-09-29; F-DD1 resolved 2026-09-30** | Branch `sw-verification` (local, not committed): G1–G12 checks, drift sizing, solid segmented walls, calc sheet + S0–S7, verification cases V01–V22 (all pass) — see "Verification test cases V01–V22" below. Split 2026-09-30 into method cases / rule tests / goldens; F-DD1 fixed (calc v14). Remaining: the user's review of the catalog. |
| W2 | WSWH open items | Table 07 (bolt length l_e, HSR extension) and Table 08 (edge shear anchorage) not in the folder. Table 04 (out-of-plane / axial) skipped by user. Stacked 2nd-story rod arm uses the concrete B — confirm for the TSS kit. Stacked base capacity weight in the capacity distribution = V₀ (the moment check governs D/C). Confirm ESR-2652 lists the 2021 IBC (CBC 2022) and Simpson's α for concrete-governed LRFD anchor rows. Spot-check Tables 03 / 06 against the catalog. |
| R7 | Optional beam sizing | Planned as a separate Beam Calculator module linked to the shear wall beam reactions (see G3). |

## Done 2026-09-29 (branch `sw-verification`, local, not committed) — schema v10, calc v11
- **Equilibrium checks G1–G12** (`shearWallChecks.js`), shown in the Checks results tab. A failed check makes the line NG; loads the audit already lists are shown as excluded notes. G6–G8 run on the 5 load cases, and G12 proves every combo is their factored sum (superposition). Tests: `tests/shearWallChecks.test.mjs`.
- **Gravity fixes:** stacked WSWH upper-panel gravity is now carried to the base (F2). The earlier F1 (header load to the jambs) was removed together with segmented openings.
- **Drift sizing:**
  - Auto nailing is raised until the story drift passes.
  - Each wall shows what governs its sheathing: strength / drift / manual.
  - Drift bypass (report only), set for the project with a per-line override. Schema v9.
  - Tests: `tests/shearWallDrift.test.mjs`.
- **Segmented walls are solid (strict rule):**
  - Openings only on FTAO walls, enforced in the wall panel and the save gate.
  - Saved segmented walls with openings migrate to FTAO (schema v10).
  - The pier split was removed.
- **Calc sheet** (Walls → Detailed):
  - Level → type → mark tabs, and one sheet per wall.
  - A definition · B loads · C1 capacity with h/b · C2 D/C · C3 overturning about each corner per load case · C4 end forces per load case (own / from above / total) · C5 governing combo by superposition vs the tool · C6 hardware / post trace · C7 deflection.
  - Builders are in `shearWallCalcSheet.js`. Tests: `tests/shearWallCalcSheet.test.mjs`.
- **Test items in Test-123:**
  - TC-1 two-story stack. The user added an E-W drift test and Cd 5 / Ie 1 / RC II.
  - TC-2 two solid walls either side of a window.
- **Findings:**
  - Two old fixtures enter story shear at levels where the line has no wall. It's lost; G2 now flags it.
  - A holdown override below the demand didn't make the wall NG before; G10 now does.

## Calc sheet — breakdowns S0–S7 (user review 2026-09-29) — DONE 2026-09-29 (branch `sw-verification`, uncommitted)

Built: S0 `resistingMomentRows` (collapsed under C3) · S1 `beamLeverTable` (Load path tab, one table per beam, with a tool row) · S2 `deflectionSubstitutionRows` (C7, both directions, governing marked) · S3 the sheet references the Hardware tab; that tab now shows l_e/d, F_cE, F_c*, C_P and one table per wall thickness used · S4 `aboveSourceRefs` (table under C4 with a link to the source sheet / Load path; load path sources carry `end`) · S5 WSWH M_OT substituted in C3 (calc stores `stacked[lt].V1k / V2k`) · S6 B1 link to the Distribution tab · S7 `driftCalcRows` (Drift tab). Tests: 8 new in `tests/shearWallCalcSheet.test.mjs` — each breakdown is checked against the tool on every fixture. No CALC_VERSION bump (no result changed; only fields added).
Purpose: every number an engineer can't reproduce from the page gets its parts shown.

| # | Where | Add | Decision |
|---|---|---|---|
| S0 | C3 M_R | Collapsed "M_R breakdown" under C3: one table for both corners. Rows = load pieces incl. self-weight; columns = P per load case, x, lever to the right corner (L − x) and to the left corner (x), P × lever; Σ row = the C3 M_R values. WSWH: note that the panel load is concentric (M_R = P/2 × B), no table. | Agreed |
| S1 | Load path tab, transfer beams | The same lever table for the beam: each load (wall ends, posts, gravity) with P per load case, x, lever to each support; R_b = ΣP·(x − x_a)/(x_b − x_a). | Agreed |
| S2 | C7 deflection | Each Eq. 4.3-1 term with its numbers substituted (8vh³/(EAb), vh/(1000G_a), h·Δa/b), holdown slip δ·T/cap and crushing. | Agreed |
| S3 | C6 posts | **No NDS derivation on the calc sheet** (the Hardware tab has the post capacity table). The sheet shows the selection + a reference: "see Hardware tab → Post Compression Capacity, <h> ft". Optional: show F_c*, F_cE, C_P in the Hardware tab once per post size / height. | User: avoid repeating |
| S4 | C3 / C4 "from above" | A reference to the source for each value, e.g. "1.29 k — SW-1 left end, see Roof → Segmented → SW-1, C4 total". | Agreed |
| S5 | C3 M_OT, WSWH stack base | V₁·H₁ + V₂·(H₁ + d_fl + H₂) with numbers (the moment used for the base anchor forces). | Agreed |
| S6 | B1 share | A link to the Distribution tab (the Σwt parts are there); no new table. | Agreed |
| S7 | Drift tab | δx = Cd·δxe/Ie with numbers vs Δa = limit × h_sx × 12. | Agreed |

**Decision (2026-09-29):** the WSWH stack-base shear check stays as the moment ratio D/C = M_d / M_allow. This is equivalent to V₁ ≤ V₁,avail for pass / fail.

## Verification test cases V01–V22 — DONE 2026-09-29 (branch `sw-verification`, uncommitted, calc v12)
- **User decisions (2026-09-29):** V08 is a new model (not TC-1); all 22 cases in one round; drift sizing = **one common nailing pattern per story** (heaviest among the auto walls first, then one heavier per pass); end forces kept unrounded (display rounds). No review comments on S0–S7.
- **Built:**
  - Sources `tests/cases/src/Vxx.mjs` — the hand-calc arithmetic, independent of the engine (`lib.mjs` has the code tables) → `npm run cases:build [Vxx …]` → `tests/cases/Vxx-*.json`. `npm run cases:check [Vxx]` prints every value.
  - Runner `tests/shearWallCases.test.mjs` (in `npm test`): T1 checks, T2 values, T3 C3 = C4 = tool / C5, T4 render + no raw decimals, T5 goldens (`tests/cases/golden/`, `npm run cases:accept`).
  - Catalog `docs/shear-wall-test-cases.md` (`npm run cases:doc`).
  - `npm run seed:cases [-- --apply]` → local project SW-VERIFY "SW Verification", one item per case with a **Verification** tab. Shared helpers: `src/modules/shearWallVerify.js`. `expectChecks.fail` takes `'G10'` (some line) or `'Line B:G10'` (that line only).
- **Fixed on the way:** deflection used the share rounded to 0.01 k (now exact, same as its T / C); calc sheet A printed opening dimensions unrounded; Checks G10 detail printed raw numbers.
- **Goldens were written from the current engine after every hand calc matched — the engineer's review of the catalog is still to come.**

### Open questions found by the cases (not changed)
| # | Finding | Where |
|---|---|---|
| Q1 | **DONE (user 2026-09-29): OVER fails G10.** Wall holdown / strap / post, post-base anchorage / post member and beam-support anchorage with nothing in the catalog → NG row "OVER — no … carries …" (only where hardware is required; reaction-only / unsupported ends stay excluded). V06 Line O must fail G10; the sample fixture's OVER lines now fail G10. | shearWallChecks.js G10 |
| Q2 | **Open — finding F-DD1, to resolve next session (user 2026-09-29): needs an additional check.** Deflection distribution, stacked walls: a lower wall's δ includes the holdown slip from the end forces landing on it from above, so k = V_own / δ drops. | V17, shearWallCalc.js stiffness |
| Q3 | **DONE (user 2026-09-29): gravity unrounded.** Wall self-weight, dlTotal, end reactions and the per-piece rows stay unrounded (display rounds); WSWH P and D/2 use the exact value. | shearWallCalc.js resolveGravityAtWall, shearWallGravity.js |
| Q4 | **Analysed 2026-09-29 (pass-by-pass trace) — same root cause as Q2, not the crushing curve.** A lower wall's δ = own part (∝ its share) + an offset from the end forces landing on it from above (slip + crushing × h/b), which does not shrink with its share. The method uses k = V/δ, so the offset makes k → 0 as the share → 0. If the offset is larger than what the other walls deflect carrying the whole story, no equal-δ split exists: the lower wall is driven toward 0 and the spread stalls (V17 Line B: SW-6 offset ≈ 0.51 in vs SW-5 ≈ 0.42 in at 7 k; spread ≈ 18 %). Damping does not help (17 %); own-end-force stiffness converges in 3 passes. Even when it converges the lower wall can get little shear (no-post variant: SW-6 0.41 k of 7 k; own-force k: 1.01 k). The 2x4 override on SW-3 only widens the gap (SW-4 takes more of Level 2). | V17, shearWallCalc.js solveDistribution / stiffness |

## Finding F-DD1 — deflection distribution with stacked walls (RESOLVED 2026-09-30, calc v14 — see "Next session — start here" item 1; the analysis below is kept for reference)
Found by V17 (2026-09-29), analysed with a pass-by-pass trace of the engine (instrumented copy, repo unchanged). Same issue as Q2 and Q4.

**Symptom.** V17 Line B does not converge in 20 passes (Level 1 spread ≈ 18 %). Level 2 converges (0.0 % by pass 8). The first explanation (crushing Δ_c = 0.02·2r³ at the undersized 2x4 posts) was wrong.

**Model.** Level 2: SW-3 (8 ft, 2x4 end posts overridden) and SW-4 (4 ft). Level 1: SW-5 (8 ft) and SW-6 (4 ft), aligned under them. 1.0E = 7 k at Level 2 only (both stories carry 7 k). All 2B nailing.

**How the method works** (`solveDistribution`, `shearWallCalc.js`): each pass every wall gets k = V/δ (V = its current 1.0 share, δ = SDPWS Eq. 4.3-1 with its end forces); the story shear is re-split V_i = V·k_i/Σk; stop when (δmax − δmin)/δmax ≤ 5 % at every level, max 20 passes, else the closest pass is used and flagged. This assumes δ → 0 as the share → 0.

**Root cause.** A lower wall's δ uses its accumulated 1.0E end forces (own + from above, `wallDeflection` reads `accumPerCombo`), so
  δ_i = c_i·V_i (own: bending, nail slip, own slip / crushing) + d_i (h·(slip + crushing from the forces above)/b — independent of V_i).
- SW-6: 1.0E holdown tension 6.21 k, only 0.02 k its own. d ≈ 10 × (0.146 × 6190 / 5375 + 0.036) / 4 ≈ 0.51 in (h/b = 2.5 amplifies the slip).
- SW-5 carrying the whole 7 k deflects ≈ 0.42 in.
- k = V/δ → 0 as V → 0, so every pass takes more from SW-6: 2.23 → 1.47 → 1.02 → … → 0.01 k. Since d_6 (0.51) > δ_5 at the full story shear (0.42), **no split with equal δ and shares ≥ 0 exists** — the iteration cannot converge.

**Trace variants** (V17 Line B):
| Variant | Result |
|---|---|
| Engine as is | not converged, spread 17.8 % |
| Damped update (½ old + ½ new) | not converged, 17.3 % — not an oscillation |
| Stiffness from the wall's own end forces only | converged, 3 passes |
| No 2x4 override on SW-3 | converged, 7 passes (3.9 %) |
| Both | converged, 4 passes (0.0 %) |

The 2x4 override only widens the gap: SW-3 softens, SW-4 takes more of Level 2 (2.47 vs 1.33 k) and sends more force down to SW-6.

**Why it matters when it converges.** Without the override the line "converges" but SW-6 gets **0.41 k of 7 k** (6 %) and SW-5 6.59 k — it passes only because d_6 ≈ 0.44 in is within 5 % of δ_5. With own-force stiffness the same model gives SW-6 **1.01 k**, SW-5 5.99 k (their own δ match; total δ still differ, 0.394 vs 0.550 in). A short lower wall under a stack can be given too little shear; auto nailing / its own-shear design would be sized for that (forces from above still reach its holdown correctly).

**Options to decide next session** (the core question: what "walls at a story deflect equally" means when a wall also rotates from the story above):
- **A. Own-force stiffness.** k_i from the wall's own end forces only (`combos`, not `accumPerCombo`); the rotation from above stays in the story drift report. Simple; converges.
- **B. Solve with the offset.** δ_i = c_i·V_i + d_i as a linear system per story; a negative share → flag "no equal-deflection split" (and fall back to A or capacity) instead of iterating 20 passes.
- **C. Keep, and warn.** Flag when a wall's offset d_i exceeds the other walls' δ, or its share falls below a fraction of its length / capacity share.
- In every option: an **additional check** (user) — e.g. a G-check / Distribution-tab note that the split is consistent (Σ shares = V, equal δ by the chosen definition, no wall starved), and a new case for the converged-but-starved wall (no-override V17 Line B).

**Where:** `src/modules/shearWallCalc.js` (`solveDistribution`, stiffness block in `runLine` Phase 5), `src/modules/shearWallDeflection.js` (`wallDeflection`), V17 (`tests/cases/src/V17.mjs`).

## Verification test cases — original plan (kept for reference)
- **One case file per case:** `tests/cases/Vxx-name.json` with id, title, intent, covers, handCalc (numbered steps with numbers), expect ([{ label, path, value, tol, source step }]), expectChecks ("all pass" or the check that must fail), and inputs (the full definition).
- **The same file feeds three places:**
  - `npm test` (`tests/shearWallCases.test.mjs`);
  - the app: an item in a "SW Verification" project with a Verification panel (expected / calculated / difference / pass);
  - the catalog `docs/shear-wall-test-cases.md` (generated by `npm run cases:doc`) — the document the engineer reviews.
- **Test types:** T1 checks G1–G12 on every case and legacy fixture · T2 hand-calc values · T3 method agreement (C3 = C4 = the tool, C5 = governing) · T4 every tab and calc sheet render · T5 golden output per case (`npm run cases:accept` after review).
- **Cases:**
  - V01 one wall;
  - V02 two unequal walls + self-weight;
  - V03 gravity statics D / L / Lr;
  - V04 aspect ratio;
  - V05 nailing boundary;
  - V06 hardware boundaries (HDUE, MSTC 16 / 18 / 24", OVER);
  - V07 NDS post capacity;
  - V08 two-story aligned stack (= TC-1);
  - V09 offset stack with / without a post;
  - V10 transfer beam;
  - V11 beam point support / reaction only;
  - V12 unsupported gravity;
  - V13 window between two solid walls (= TC-2);
  - V14 FTAO APA T555 benchmark;
  - V15 deflection and drift;
  - V16 drift sizing + bypass (the user's E-W case);
  - V17 deflection distribution (converged / not);
  - V18 wind and both;
  - V19 LRFD and Ω₀;
  - V20 WSWH on concrete mixed with sheathed walls;
  - V21 WSWH stack + raised floor;
  - V22 robustness.
- **Build order:** format + resolver + runner, with TC-1 → V08 and TC-2 → V13 first · V01–V07 · V09–V12 · V14–V22 · Verification panel, `cases:doc`, `seed:cases` (dry run unless `--apply`).

**Decisions needed at the start of the next session:**
1. V08 base case: keep the original TC-1 without Cd / Ie (a clean stack hand calc) and move the user's E-W drift test to V16? (Recommended.) The user-edited TC-1 makes drift govern the N-S line too.
2. Scope of the first round: all 22 cases, or V01–V13 first so the format can be reviewed?
3. The user's review comments on the current work (checks, drift sizing, solid segmented walls, calc sheet) — the user is still reviewing and will send them first.
4. Drift sizing rule: raise only the worst wall at a story (current — TC-1 N-S gave SW-3 2" and SW-4 6"), or raise all walls at the story together?
5. Optional: keep end forces unrounded inside the calc and round only for display. The C5 differences would drop from ≤ 0.03 k to ~0.001 k; results change by ≤ 0.03 k.
6. Commit / push of `sw-verification` — only when the user asks.

## Hub roadmap
| # | Item |
|---|---|
| U1 | PDF template redesign (after 3–4 key calcs are done) |
| U2 | Cloud Supabase + Railway deployment (explicitly last) |
| U3 | Beam Calculator module (future) — takes shear wall beam reactions as a ref and adds floor gravity (G3 / R7) |

## Rules to keep when fixing these
- The definition (`items.inputs`) is the source of truth; results are always regenerated. A definition shape change = new step in `DEFINITION_MIGRATIONS` + bump `schemaVersion` + legacy fixture of the previous version in `tests/fixtures/legacy/`. Bump `CALC_VERSION` on calc changes.
- `npm test` must pass (calc checks, regression, legacy definitions open) and `npx vite build` must succeed before handing over.
- Wall ends transfer only where ends align; a mid-wall end needs a post (warning, no transfer).
- Elevation visual changes are planned with the user before implementation.

## PDF review round (user, TC-1 summary PDF, 2026-10-01) — DONE, awaiting the user's look
- **Front page:**
  - Design data no longer lists nailing capacities, the default distribution or the wall DL rows (gravity is shown per line).
  - Lateral loading tables (all lines, per direction) are added.
  - The "Wall lines" table has no sheet column.
- **Symbols:** Greek letters, arrows, ⊥ and − print in the standard Symbol font (pdf.js `SYM` map). Before, they came out as Á © £ ´ !’, which broke the combination column. Unicode subscript digits (Ω₀) become subscripts.
- **Each line:**
  - It starts with a large "Wall line <dir> / <line>" heading with a rule (`section.heading`).
  - New "Line definition" rows: length, ρ, framing, distribution, drift check.
  - New "Walls (definition)" table: mark, level, type, x, L, h, h/b, wall DL, openings / manual overrides. A posts / beams definition table appears when the line has any.
- **Elevations, two per line:**
  1. End forces only. The title names the ASD envelope (LC1–LCn) and a note explains P / Σ / T / C.
  2. Hardware, no forces. Nailing + D/C in each wall; a "Wall HW" row under each wall with the HD/strap and post of each end with D/C (colour); the post-base and beam-support hardware rows; its own legend.
  - Before, the single elevation drew post-base hardware but no wall hardware (why page 8 showed hardware and page 5 did not).
  - `renderElevationForPdf(..., mode)`, `computeElevationLayout({ wallHwRows })`. The live band label "HW" under the walls now reads "Post HW".
- **Round 2 (user, 2026-10-01):**
  - The narrow-wall hardware rows read "L: …" / "R: …".
  - The Detailed report starts each wall's calc sheet on a new page.
  - The end-force equation is its own wrapping text line under a short title; PDF section titles also wrap. It used to run off the page.
  - Symbol glyph widths come from a table (`SYM_W` in pdf.js): jsPDF under-measured them, so text after an arrow overlapped it.
  - Calc-sheet and drift-calc rows get subscript markup (`subMarkup`: V_E, R_D, OTM_E, h_sx, δxe).
- **Elevation scale and parts (user, 2026-10-01):** PDF elevations are no longer fitted to the page width.
  - **Pages:** elevations go on landscape pages (`section.landscape`; pdf.js switches orientation per section).
  - **Scale:** a standard horizontal scale, the largest of 1/4", 3/16" or 1/8" = 1'-0" that keeps the line within 2 parts (`planPdfElevation`). Never below 1/8"; more parts only beyond that.
  - **Splitting:** a long line is split only on its element extent (empty length past the last element is not a part). Cuts sit on a half-foot grid in gaps between walls, beams and posts, with a 1 ft overlap. "Cut through an element" appears only if no gap exists.
  - **Rendering:** each part is a window onto the full drawing at that scale (`renderElevationForPdf(..., view)`). It keeps the level labels on the left and has its own legend.
  - **Titles** read "— horizontal scale … — part i of n (x0–x1 ft)". "(reduced to fit the page height)" is added when a tall line has to shrink.
  - Tests are in shearWallReport.test.mjs.
- **PDF elevation overlap (user, TC-1 page 10, 2026-10-01):** in the PDF a label with no free spot used to be forced in place, overlapping (TC-1 E-W: P-1 sits inside SW-6 near its right end, so P-1's "P ▲2.38 ▼2.82k" landed on SW-6's right-end labels). The live tool turns such a label into a hover dot.
  - **Fix:** in the PDF it becomes a numbered marker on the element (placed at the first free spot along it), and the text goes to numbered notes under the legend: "(1) P-1 base: P ▲2.38 ▼2.82k". The image height grows to fit the notes (`placeGroup` label arg, `noteMark`, `partNotes`).
  - **Test:** fixture `tests/fixtures/tc1-two-story.json` with a regression test in shearWallReport.test.mjs.
- **Open (user to decide): the PDF and the live tool use two separate drawing functions** (`renderElevationForPdf` vs the live `drawSVG`). The differences:
  - The live tool fits the line to the screen width.
  - It colours walls by "all hardware OK" when hardware is on, or by D/C.
  - It shows forces and hardware together, for a selectable combination.
  - It writes the wall HD / strap and post as vertical labels in edge strips.
  - It hides crowded labels behind hover dots.
  Unifying them (one renderer, a print mode) is a larger refactor.
- **PDF elevation look (user, 2026-10-01; two renderers kept, same rules):**
  - **Shared sizes:** `ELEV_FS` sets the text sizes for the live and PDF elevations: level 11 / 9, ruler 10, Σ 9, P 8, mark 11 / 9, nailing 10 / 8, hardware 9, post 9 / 8, strap 8.
  - **Font:** the PDF SVG uses the screen font stack (`ELEV_FONT`: Barlow, Segoe UI, system-ui).
  - **Coloured D/C:** every D/C value is coloured (green < 0.80, amber 0.80–1.00, red > 1.00 / OVER). In the PDF hardware row the element id is in ink and its D/C in colour. The FTAO strap shows its D/C (live and PDF).
  - **Bug fix:** the FTAO strap (dashed lines + label) showed on both PDF elevations. It now appears on the hardware elevation only (`drawWallOpenings` `noStrap`).
