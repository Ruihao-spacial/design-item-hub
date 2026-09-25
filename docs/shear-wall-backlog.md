# Shear Wall Design — Backlog

Open items after the 2026-09-22 elevation review rounds and Phase 4 round 1 (R1–R3, 2026-09-24).
Branches: `shearwall-load-path` (pushed, merge to `master` by someone else), `results-and-links` (G4, pushed 2026-09-24), `phase4-r1-r3` (local, not pushed; CALC_VERSION v6, schema v6).

## Pending approval / housekeeping
| # | Item | Notes |
|---|---|---|
| H1 | Bulk upgrade of the local database — **optional** | Not required: the item form migrates and regenerates on open, and the project-page PDF now migrates on export (fixed 2026-09-22). Opening and saving the two Test 123 shear wall items clears the "Stale" badge and refreshes the stored label. Keep `SB_EMAIL=… SB_PASSWORD=… npm run upgrade:shearwall [-- --apply]` for the cloud move (U2), when every stored item should be brought to the current schema at once. |
| H2 | Merge `shearwall-load-path` into `master` — **committed `9723949` and pushed 2026-09-22; merge pending** | Why: everything since `b959485` (Phase 3) exists only as uncommitted changes on one local disk. Committing gives a restore point, pushing gives a GitHub backup, separate commits keep the history reviewable and revertible, and `master` is what a later Railway deploy builds from. Suggested: commit on the branch and push now, then merge to `master` once accepted. |

| H5 | App test of G4 on branch `results-and-links` — **passed and pushed 2026-09-24** | Flat Load edit → Mass Takeoff shows "Upstream changed" → Update + save → ELF flagged; Base Shear Cs → ELF notice; project-page PDF matches the form. |
| H6 | Local Supabase project name changed by master | `supabase/config.toml` `project_id` is now `engineer-service-calculator`. Running `supabase start` from this code creates a new, empty local stack; existing local data lives in the `*_design-item-hub` containers. Plan a data move before restarting the local stack. After pulling master, apply new migrations with `npx supabase migration up --local` from the repo folder (2026-09-22: `20260917000000_user_management_audit` was needed for login). |

| H7 | App test of Phase 4 round 1 on `phase4-r1-r3` — **passed 2026-09-24** | Add openings to a Test 123 wall, switch Segmented ↔ FTAO, link the Base Shear item (Cd / Ie / Risk Category), check elevation (cut-outs, piers, straps), results (FTAO calc, LRFD forces, story drift) and PDF. Push only when asked. |

## Phase 4 round 1 — open items (2026-09-24)
| # | Item | Notes |
|---|---|---|
| P1 | MSTC δ basis — **resolved 2026-09-24** | User: MSTC δ is at the strap LRFD cap = ASD cap / 0.7 (deflection only). HDUE δ is at the ASD cap. `deltaBasisLoad()` in `shearWallHardware.js`. |
| P2 | Dead load over openings — **resolved 2026-09-24** | User rule: only loads directly above the shear wall length count. Segmented piers take loads over the pier length only (loads over openings are not carried). FTAO walls take loads over the full wall length including above openings; FTAO wall self-weight excludes the opening areas. |
| P3 | FTAO jamb posts — **resolved 2026-09-24** | Sized for compression per the Diekmann pier chord (user): C = f_D·DL + v_i·h_o (ASD; f_D = 1 + 0.14SDS seismic, 1.0 wind). DL = half the adjacent pier's DL + half the header DL above the opening. Lightest (2)2x-or-heavier post of the line thickness; override applies to all jambs. Jamb areas feed the FTAO deflection. |
| P4 | Drift = largest wall δ per line and level | **Distribution choice added 2026-09-24:** project default + per-line dropdown, Wall capacity (SDPWS 4.3.3.4.1) or Deflection (equal δ at each level, shares ∝ k = V/δ from SDPWS Eq. 4.3-1 at 1.0E / 1.0W, iterated from capacity shares until the walls’ δ at every level are within 5% ((δmax − δmin)/δmax), max 20 passes, else the closest pass is used and flagged; FTAO walls use the engine δ). `solveDistribution` in `shearWallCalc.js`, CALC_VERSION v7. Drift still reports the largest wall δ (equal under the deflection approach). |
| P5 | Walls on beams / posts | Support deflection is not included in the wall deflection (noted in the table). |
| P6 | FTAO with unequal opening heights | Engine analyzes the whole wall at the governing opening (APA largest-opening rule); straps drawn at the highest head and lowest sill. |
| P7 | Wind deflection | Only when the service factor α_s is entered; report only (no limit). |
| P8 | FTAO hold-down | Wall-end T/C and hardware use the usual net formula with dead load over L_wall; the engine's gross H (no dead load) is shown as a reference. |

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
| R4 | Amplified (Ω₀) seismic forces for collectors and connections | |
| R5 | Links to other modules | Seismic Mass Takeoff → W, ELF → Cs and story forces. |
| R6 | Non-uniform dead load and point loads in the 1.0D display | |
| R7 | Optional beam sizing | Planned as a separate Beam Calculator module linked to the shear wall beam reactions (see G3). |

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
