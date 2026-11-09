# Plan: horizontal (out-of-plane) offset shear walls — transfer through the diaphragm (2026-11-05)

Test project **26997 "Horizontal Offset Walls"** (local DB): SWD item "Shear Walls — 16 walls, 7 lines", DA "DA - Roof",
DA "DA - 2nd Floor". Status: user answers in section 9 (2026-11-05); build step 1 (bounded grids) done.

## 1. The case

| | Grids | Outline |
|---|---|---|
| Roof (DA "DA - Roof", F_x = 20 k) | 1 x0 · 2 x10 · 3 x70 · A y0 · B y20 · C y80 · D y100 | x 10–70, y 20–80 (grids 2 / 3 / B / C) |
| 2nd floor (DA "DA - 2nd Floor", F_x = 10 k) | same grids | x 0–70, y 0–100 (grids 1 / 3 / A / D) |

SWD walls (each 10 ft): SWD level **"Roof"** = the 2nd-story walls, under the roof: lines **2** (SW-5, SW-7), **B** (SW-11,
SW-12), **C** (SW-13, SW-14), **3** (SW-1, SW-3). SWD level **"2nd Floor"** = the 1st-story walls: lines **1** (SW-9,
SW-10), **A** (SW-15, SW-16), **D** (SW-17, SW-18), **3** (SW-2, SW-4 — stacked under SW-1 / SW-3). Posts P-x on lines
2 / B / C at the 2nd floor carry the overturning of the walls above.

So lines **2, B, C stop at the 2nd floor**: their shear must go through the **2nd-floor diaphragm** to lines **1, A, D**
(ASCE 7-22 Table 12.3-1 horizontal irregularity **Type 4, out-of-plane offset**). Line 3 continues (stacked).

Note: this is **not** the DA "offset wall line" feature (walls of one story on two grids acting as one line, Ex 3.3).
That is a same-story offset. Here the offset is between stories. To keep them apart, this plan calls it
**"transfer from walls above"**.

## 2. What the tools do today (found while reading the code and the stored items)

1. **SWD drops the story shear of a discontinued line.** `accumulateStoryShear` adds up the story shear down the *same*
   line. At a level with no walls on that line the level is skipped. Check G2 then fails with "no wall at this level carries
   the story shear". Nothing tells the 2nd-floor diaphragm to carry that shear.
2. **DA knows only the walls of its own level.** `linkedWalls` places the SWD walls whose `levelId` = the DA level. The
   walls above (SWD level "Roof" for DA "2nd Floor") are not read. So the 2nd floor sees only its own F_x. Lines 1 / A /
   D would be under-loaded by the 20 k from the walls above.
3. **One wall would land in two places.** The auto origin of an SWD line is where its grid enters the sheathed plan of
   *that* DA item. Stored items: line B origin x = 10 at the roof and x = 0 at the 2nd floor. Line 2 origin y = 20 at the
   roof and y = 0 at the 2nd floor. The same SWD wall position would map 10–20 ft apart on the two levels.
4. **`link-length` blocks both items now.** SWD has one `totalLength` per line (60 ft for all). The plan length differs by
   level: roof 60, 2nd floor 70 (A–D) and 100 (1–3). Lines that are not on the roof plan at all (1 / A / D) give 0. The
   check also fires for lines with no wall at that level. Stored outputs: Roof 3 errors, 2nd Floor 7 errors.
5. **Force levels scale everything by one factor.** `scaleCase(cs, k)` multiplies the whole case by k_D or k_C. Once a
   level carries forces from the walls above, one factor is wrong. Those forces are not inertia of this level, so the
   F_px / F_x ratio and the collector ratio of the ELF item do not apply to them.
6. The stored DA items have grids and outline only — no diaphragms yet (saved 19:31 / 19:33).

## 3. Load path to capture

At DA level L (here 2nd Floor), each wall of the story above (SWD level directly above L) sits on this floor with its
story shear V_w (1.0E, from SWD's own split of its line).

| Wall above is… | Example | Into the diaphragm of L? | Member force on its grid at L | To SWD |
|---|---|---|---|---|
| **Through** — its SWD line has walls at L | SW-1 / SW-3 on line 3 | No — it goes straight down its line | In-plane drag from the upper wall's extent to the walls below on that line (0 when stacked) | SWD already carries it down the line (unchanged) |
| **Transfer** — its SWD line has no walls at L | SW-5 / SW-7 (2), SW-11 / SW-12 (B), SW-13 / SW-14 (C) | **Yes** — a concentrated load at its grid on the diaphragm(s) that span across it | **Distributor / drag strut** over the full sheathed depth: the load enters over the wall's length, the diaphragm takes it as a uniform shear jump | Its share reaches the support lines (1 / A / D / 3) inside DA's line forces; SWD must end the line's story shear at L (no G2 fail) |

Member equation along the grid (current rule, one source term added):
N(s) = ∫ (v_side A − v_side B) ds + ∫ q_above(s) ds, with q_above = V_w / L_w over each upper wall's extent. Closure
(N = 0 at both free ends) stays the check: Σ q_above = the shear jump × depth.

### Hand calc of 26997 (1.0E; equal split in SWD; one origin per line at grid 1 / grid A)
**Roof.** Load along x: diaphragm y 20–80 on B / C → 10 k each. SW-11 / SW-12 / SW-13 / SW-14 = 5 k each. Load along y:
x 10–70 on 2 / 3 → 10 k each. SW-5 / SW-7 / SW-1 / SW-3 = 5 k each.

**2nd floor, load along x.** Span A (y 0) → D (y 100), depth 70 ft. Own: 10 k = 100 plf along the span. Transfer: 10 k at B
(y 20), 10 k at C (y 80).
- Line A = 5 (own) + 10·80/100 + 10·20/100 = **15 k**; line D = **15 k**; Σ = 30 = 20 + 10 ✓.
- Shear at A = 15 000 / 70 = **214 plf**; between B and C ≤ 3 000 / 70 = 43 plf. The own load alone would give 71 plf at A.
- Distributor on B (x 0–70; SW-11 x 10–20, SW-12 x 24.5–34.5, 500 plf each into 143 plf of diaphragm): N runs
  −1.43 → +2.14 → +1.50 → **+5.07 k** at x 34.5 → 0 at x 70 (closes).
- Roof collector on B (x 10–70, same walls, 167 plf): max **5.92 k** at x 34.5. So the two levels need different
  collector lengths (60 vs 70 ft) and get different forces on the same grid.
- Collector on A (x 0–70; SW-15 x 4–14, SW-16 x 21–31, 750 plf in the walls): max **8.36 k** at x 31. 10 / 15 of that
  comes from the walls above.

**2nd floor, load along y.** Span 1 (x 0) → 3 (x 70), depth 100. Own 10 k; transfer 10 k at line 2 (x 10); line 3 roof
walls are through (10 k down line 3, not in the diaphragm).
- Line 1 = 5 + 10·60/70 = **13.57 k**. Line 3 diaphragm force = 5 + 1.43 = **6.43 k**, and its story shear in SWD = 6.43
  + 10 from above = 16.43 k. Σ = 30 ✓.

These numbers become the test for the build (fixture from 26997).

## 4. The three force levels

The analysis stays linear and at 1.0E. Each load case runs as two parts (the closure solver is linear, so they add up
exactly):
- **A — own level:** F_x of this level (q · d), as today.
- **T — from walls above:** the transfer loads + through-wall drags, at 1.0E as SWD gives them.

Run "A + T" and "A alone"; T = the difference. Linked offset-group weights (SWD nonlinearity) come from the A + T run and
are reused for A, so the split is exact.

| Level | Forces shown | Walls above shown? | Use | Code |
|---|---|---|---|---|
| **1. 1.0E** (F_x from ELF) | **A + T** | **Yes** — arrow + mark + V_w for each upper wall (transfer amber, through grey), the distributor runs | Line forces → SWD (unchanged rule: SWD gets 1.0E) | ASCE 7-22 §12.8 |
| **2. Diaphragm** | **k_D · A** (user) — see **Q1**: recommended **k_D · A + k_TD · T** | Per Q1 | Sheathing / nailing, chords | §12.10.1.1: F_px, transfer forces added (ρ of the structure) |
| **3. Collector** | **k_C · A + k_TC · T** | **Yes** — every collector / distributor shows the part from the walls above | Collectors, drag struts, distributors, wall-to-floor transfer connections | §12.10.2.1 (light-frame exception → F_px-based, transfer included); §12.3.3.4 +25 % for Type 4 in SDC D–F unless Ω₀ is used |

- k_D, k_C as today (Setup, from ELF). New on Setup → Seismic loading, shown only when the level has walls above:
  **k_TD** (default ρ of the SWD direction, 1.0 here) and **k_TC** (default 1.25 when SDC D–F, else 1.0; or Ω₀ if the
  collectors are designed with Ω₀). The ELF collector ratio does not apply to T (it is Ω₀ or light-frame F_px of *this*
  level's mass).
- `scaleCase(cs, k)` becomes `levelCase(A, T, kA, kT)` (field-by-field kA·A + kT·T). Every member run still closes,
  because A and T each close.
- "Forces shown" line: e.g. "COLLECTOR level = 1.0E × k_C 1.68 (own level) + 1.0E × k_TC 1.25 (walls above: SW-11,
  SW-12, SW-13, SW-14)".
- View 4 / member table: new column **"from walls above"** per run (the T part at that level). Each transfer wall also
  gets a **wall-to-floor transfer connection** demand: V_w / L_w × k_TC (plf), listed per wall.
- Wind (W): the same split for the 1.0W picture, no factors.

## 5. Collector length per level

- **DA:** each level is its own item with its own outline, so each grid's member at a level runs over that level's
  sheathing only (roof B 60 ft, 2nd floor B 70 ft). The integration and closure are per level already. What is new:
  (a) the walls above are a source term on the line, and (b) a transfer grid at L is a member even though it has no
  wall at L.
- **Wall positions must agree between levels.** An SWD position must map to the same plan point in every DA item.
  See **Q3** for the origin rule.
- **SWD:** SWD calculates no collector forces (DA does), so collector length matters to SWD only for the line length it
  draws and uses for full-line gravity loads, and for DA's `link-length` check. One `totalLength` per line cannot match
  60 ft at the roof and 70 / 100 ft at the 2nd floor. Proposal: an optional **length per level** (default
  `totalLength`). DA compares against that, and only for lines that have walls at the level or walls above landing on it.

## 6. Changes needed

### Diaphragm Analysis
| # | Change | Files |
|---|---|---|
| DA-1 | `link-length` only for lines with walls at this level or transfer walls landing on it; compare with SWD's per-level length when given. One origin per SWD line for all levels (Q3); existing items keep their present origins as typed values (normaliser, no loss) | `tdWallLink.js`, `tdMigrate.js` |
| DA-2 | **Walls above:** linked = SWD walls of the level directly above, placed with the same origin. V_w = SWD `shareExact_1E / _1W` at that level, read from the `swdCalcAll` copy DA already runs. Class through / transfer by "its SWD line has walls at L". Typed (no SWD): Setup list "Walls above" (grid, from, to, V_E, V_W, through / transfer) in `inputs.wallsAbove`. Drawn dashed on the Plan tab with arrows | `tdWallLink.js`, `diaphragmAnalysis.js`, `tdModel.js`, `tdPlanEditor.js` |
| DA-3 | **Engine:** transfer wall → concentrated load at its grid into the diaphragm(s) spanning across it, shared by depth (the G7 `ctx.points` path). Every wall above → source q_above on its grid's member over its extent (through: sinks at the walls below). The line force of a support line stays its diaphragm force (SWD adds the through force itself, so it is not counted twice). Equilibrium: Σ line forces = own load + Σ transfer | `tdBasicShear.js`, `tdNet.js`, `tdClosure.js` |
| DA-4 | Two-part runs A / T and the three force levels (section 4); k_TD / k_TC on Setup; forces-shown line; "from walls above" column; transfer connection list | `diaphragmAnalysis.js`, `tdViews.js` |
| DA-5 | Checks: `above-off-plan` (an upper wall not on a grid / sheathing of L, or over an opening — it cannot land), `above-no-diaphragm` (no diaphragm of the case spans across its grid), `above-stale` (SWD changed since), info "Type 4 out-of-plane offset: §12.3.3.3 / 12.3.3.4 / 12.10.1.1 apply" with the walls; `wall-in-span` does not count walls above | `tdGeometry.js`, `diaphragmAnalysis.js` |
| DA-6 | Guide / backlog / book-cases doc; CALC_VERSION td-v12 | docs |

### Shear Wall Design (needs the user's OK — the DA rule so far was "SWD files untouched"; same guard as PR #6: additive, goldens / fixtures / upgrade dry run identical for items that do not use it)
| # | Change |
|---|---|
| SWD-1 | **Story shear transferred at a level with no walls:** per line and level, "transferred to the diaphragm below". Set automatically when the linked DA item of that level takes it as a transfer; otherwise ticked by hand, with a warning naming the force. The accumulated shear stops there. G2 passes with the row "transferred to DA 2nd Floor: 10.00 k" instead of failing. |
| SWD-2 | New direction-level check: Σ story shear ended by transfer at L = Σ transfer loads DA level L used (from DA's line-load output), so nothing is lost or counted twice down the building. |
| SWD-3 | Optional line length per level (`line.levelLength[levelId]`). Used by the elevation, full-line gravity rows and DA's check. Schema bump + migration step + legacy fixture (durability rules P3–P6). |
| SWD-4 | No change: posts under discontinued wall ends already use max(ASD, Ω₀ ASD) (§12.3.3.3). The calc sheet gets a note "supports a discontinuous wall — horizontal irregularity Type 4". |

**Data flow (no cycle):** DA Roof → SWD (roof line loads) → SWD Roof-level wall shares → DA 2nd Floor (walls above) → SWD
(2nd-floor line loads). Upper-level shares do not depend on lower-level loads. A test will prove this for both
distribution methods. A roof change shows "Upstream changed" on SWD, then on DA 2nd Floor.

## 7. Build order (each step: tests green, 9 books 649 / 649, user fixtures unchanged)
1. DA-1 (fixes the blocking errors on 26997; origin rule per Q3).
2. DA-2 walls above (read and draw only; no force yet) — the user checks placement on screen.
3. DA-3 engine + the hand calc of section 3 as a test (fixture from 26997).
4. DA-4 force levels.
5. SWD-1 … SWD-3 (after the user's OK on Q4).
6. User test of 26997 in the browser.

## 8. Decisions for the user
- **Q1 — Diaphragm level and walls above.** Your rule: the diaphragm level shows k_D · own only. ASCE 7-22 §12.10.1.1 says
  transfer forces from walls above are **added** to F_px for diaphragm design. 26997 shows why this matters: the
  2nd-floor shear at A is 214 plf with the transfer and 71 plf without it (× k_D). **Recommended:** k_D · A + k_TD · T,
  showing both parts. Or keep k_D · A only and say on screen that the transfer is not included.
- **Q2 — Factor on T at the collector level (k_TC):** 1.0 / 1.25 (§12.3.3.4, Type 4 in SDC D–F) / Ω₀ —
  **recommended default** 1.25 in SDC D–F, else 1.0, editable.
- **Q3 — One origin per SWD line for all levels:** (a) **recommended:** auto origin = the lowest cross grid on that line.
  Both items here share the same grids, so it does not depend on the level. (b) Origin grid stored on the SWD line.
  (c) Keep typed origins per item + a cross-item check. Existing linked items (26999) keep their present origins frozen
  as typed values.
- **Q4 — SWD changes SWD-1…3 allowed** (additive, guarded by identical goldens)?
- **Q5 — Source of V_w:** **recommended:** SWD's own wall shares (capacity / deflection), or DA Roof's line force split by
  wall length.
- **Q6 — Diaphragm at the transfer level with Ω₀ (§12.3.3.3, "elements supporting discontinuous walls"):** engineer
  option, default off (k_TD = ρ). Only needed if you treat the floor diaphragm as such an element.

## 9. User answers (2026-11-05) — these replace sections 4–8 where they differ
- **Q1:** diaphragm level = **k_D·A + Ω₀·T**, × 1.25 when §12.3.3.5 applies (ASCE 7-22 §12.10.1.1: Type 4 transfer forces
  are increased by Ω₀ before being added to the inertial forces).
- **Q2:** collector level = **k_C·(A + T)** — ELF's k_C already takes the max of the three §12.10.2.1 cases.
- **Q3:** a better SWD ↔ DA link → **Option 1**:
  - grids copied from a linked DA item into SWD;
  - the SWD line start fixed on the plan (`planOrigin`);
  - cross grids drawn on the SWD elevation;
  - per-level extents from DA.
  It is active **only when the SWD item is linked to DA**. Existing SWD items and their elevations must not change
  (production). Proof: goldens identical, elevation SVG byte-identical, upgrade dry run 0 changed.
- **New:** DA grids on N-S / E-W tabs; each grid has an extent (x1 x2 y1 y2) so it can stop early; SWD sees only the grids
  that cross its line. **Built** (step 1).
- **Q4:** SWD changes OK (gated as above). **Q5:** V_w from SWD's wall split. A line may mix walls that continue down with
  walls that end at the floor: per-wall SWD flag "ends at this floor → diaphragm below" (auto when the line has no wall
  below; a tick on a mixed line).
- **Q6:** dropped (Ω₀ is in Q1 / Q2).
- Build order: 1 bounded grids (done) · 2 SWD safety harness · 3 grid link · 4 SWD flags / transfer · 5 walls above drawn ·
  6 engine + two-part runs · 7 force levels + checks · 8 user test.
