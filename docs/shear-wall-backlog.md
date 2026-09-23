# Shear Wall Design — Backlog

Open items after the 2026-09-22 elevation review rounds. All review comments from those rounds are implemented;
this file tracks what is deferred. Branch: `shearwall-load-path` (committed and pushed 2026-09-22, not yet merged to `master`; CALC_VERSION v5, schema v5).

## Pending approval / housekeeping
| # | Item | Notes |
|---|---|---|
| H1 | Bulk upgrade of the local database — **optional** | Not required: the item form migrates and regenerates on open, and the project-page PDF now migrates on export (fixed 2026-09-22). Opening and saving the two Test 123 shear wall items clears the "Stale" badge and refreshes the stored label. Keep `SB_EMAIL=… SB_PASSWORD=… npm run upgrade:shearwall [-- --apply]` for the cloud move (U2), when every stored item should be brought to the current schema at once. |
| H2 | Merge `shearwall-load-path` into `master` — **committed `9723949` and pushed 2026-09-22; merge pending** | Why: everything since `b959485` (Phase 3) exists only as uncommitted changes on one local disk. Committing gives a restore point, pushing gives a GitHub backup, separate commits keep the history reviewable and revertible, and `master` is what a later Railway deploy builds from. Suggested: commit on the branch and push now, then merge to `master` once accepted. |

## Known gaps (found in review, not fixed)
| # | Item | Where | Notes |
|---|---|---|---|
| G3 | Beam reactions exclude floor gravity load | `shearWallLoadPath.js` | By design for now. **Note for the future Beam Calculator module:** consume Shear Wall `beamTransfers[].supports[]` (per-combo reactions, loads on the beam) through the existing `refs` / `extract` mechanism, add floor gravity (DL / LL tributary) and do the sizing there. Then decide whether the beam's reactions should flow back into the shear wall load path (support posts). Ties to R7. |
| G4 | "Regenerate results from the definition" applies to Shear Wall Design only | `regenerateResults` flag, `itemForm.js` | User chose this scope. Other modules still render stored results (protected by the try/catch notice). |
| G5 | Page-level recalculate-on-open path not exercised in automated tests | `itemForm.js` imports `db.js` (Vite env) | Accepted as-is (2026-09-22). Covered by build + code review + `scripts/lib/shearWallLoadCheck.mjs`. |

## Done / fixed
- **H3 (2026-09-22):** UI walkthrough by the user.
- **H4 (2026-09-22):** Test 123 cleanup (duplicate posts P-8 / P-13 on P-1).
- **G1 (2026-09-22):** the wall HD/Strap override list uses the wall level's floor-span strap table (`hwOptionsFor`), matching the post / beam-support panels and the quick editor.
- **G2 (2026-09-22):** every combination and load case reports both ends from one formula (net = fD·D/2 ∓ OTM/L). 1.0E / 1.0W are lateral only (T = C = V·h/L); they previously included dead load. The uplift-side end in D + 0.7ρE / D + 0.6W and a net-compression end in 0.6D combos are no longer dropped to 0. CALC_VERSION v5.
- **Project-page PDF (2026-09-22):** `exportItemPdf` migrates the stored item before building sections, so a PDF exported from the project list of a not-yet-re-saved item uses the current definition schema.

## Added 2026-09-22 (elevation / UI)
- Walls run floor line to floor line and label bands overlay them. The beam's bottom sits on its floor line with its reaction / hardware labels in the story below (or a foundation band).
- Label collision placement; posts inside walls are drawn dashed; dark halo on all force labels.
- T/C strip: P (this element only) on top; Σ rows only when loads from above change the values. Tension red / compression blue everywhere (P, Σ, R); the Σ and R markers stay purple.
- Legend row (live) and legend strip (PDF); wide page layout; elevation box fits its content.
- Overlap chooser for stacked elements; "Find element…" by mark / ID.
- Quick editor: hover nailing / hardware labels for demand, capacity and D/C; click to override nailing, HD/strap and post with per-option D/C. Manual overrides are marked ✎ (live) and `*` (PDF elevation + Wall Schedule).

## Phase 4 roadmap (not started)
| # | Item | Notes |
|---|---|---|
| R1 | Segmented walls / force transfer around openings (FTAO) | Different h/b rules; no capacity reduction for perforated/FTAO (earlier decision). |
| R2 | Deflection method | Holdown δ values already stored in the catalogs. |
| R3 | LRFD combinations | Nailing table already has `lrfdE` / `lrfdW`; per-combo load path supports extra combos. |
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
