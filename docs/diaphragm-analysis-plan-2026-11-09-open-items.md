# Diaphragm Analysis — fix plan for the open items (2026-11-09)

User decision: **no commit until the open items are fixed** (td-v14 + 26998 fixtures/tests/docs stay uncommitted).
For each item: the cause, at least two options with pros / cons / risk, and a recommendation. Nothing is built until the
user picks an option per item. Rules as before: SWD production files only behind the DA link (freeze identical), books
649 / 649, CALC_VERSION bump on a calc change, tests for each fix, user commits.

Risk = chance of changing results of items that work today or breaking the tool.

---

## Item 0 — Deflection method: a wall with no deflection grabs the whole offset line (bug)
**Cause.** `tdWallLink.swdWallShares`, deflection branch: `equalDeflectionSplit(carried, walls' δ(V))`. When SWD cannot
compute a wall's δ at its trial share (no nailing / hardware carries it), `_deltaAt` returns null; the solver reads null
as 0 → an infinitely stiff wall that takes the whole group (26998 Roof 2/3: SW-65 takes 22.8 k, SW-35 gets 0; the 2nd Floor
line 3 then goes negative). Statics and closure still pass — nothing flags it.
**Checked:** SWD's own per-line equal-δ split is already guarded (`shearWallCalc.js` ~1117: a story where a wall has no
δ at 0 or at V is kept on its current split). Only the DA offset-line path lacks the guard. Capacity method unaffected.

| Option | What | Pros | Cons | Risk |
|---|---|---|---|---|
| **0-A** Guard → capacity fallback | Use equal δ only if every group wall gives a finite δ over 0 … carried force; else split by capacity with the existing warning `swd-group-defl` ("split by capacity") | Smallest change (one condition, DA file only); reuses an existing, tested path and message; tested in scratch: 26998 closes, SW-35 17.84 k | That group is not split by deflection at all when one wall fails, even if the failure is only at the first trial | **Low** |
| **0-B** Guard → keep the previous round (mirror SWD) | Same check; when it fails, keep the group's weights from the previous round (round 0 = capacity) and warn | Same rule as SWD's own split ("kept") — consistent behaviour across modules; later rounds can recover deflection once the trial loads settle | Result depends on the round order; can still end on capacity weights; a little more state in the round loop | **Low** |
| **0-C** Overloaded wall saturates | A wall with no δ at a load takes at most the load up to which it has a δ (≈ its capacity); the rest is split by equal δ among the others (iterate) | Closest to the physics (an overloaded wall cannot take more); keeps deflection for the rest | New algorithm; needs SWD's "δ range" per wall (not exposed today); more code and tests; can still fail if every wall is overloaded | **Medium** |

**Recommendation: 0-A** now (simple, safe, clear warning); 0-C later only if users need deflection splits on overloaded
lines. Tests: 26998 with SWD = deflection — no wall of an offset line is 0 / negative, both levels close; a synthetic
group with one null-δ wall falls back with the warning; capacity runs unchanged (26996, 26998, books).

---

## Item 5 — Offset-line shares "did not settle in 6 rounds"
**Cause.** Each DA round runs SWD on a copy (`swdWallShares` → `shearWallCalc.calcAll`). SWD re-picks every auto-nailed
wall's nailing from its share (`shearWallCalc.js` ~415–440); the group split uses the resulting capacities. New split →
new shares → different nailing → the weights flip between two states (26998 x 2/3: SW-70 / 71 5520 / 6440 ↔ 4219 / 4922 lb;
y A/B: SW-2 / 12). The last round is used and a warning shown; on 26998 line 2 closes within tolerance (−29 lb).

| Option | What | Pros | Cons | Risk |
|---|---|---|---|---|
| **5-A** Fix the nailing after round 1 | From round 2, the DA copy of SWD holds each group wall's nailing at the heavier of its round-0 / round-1 pick (as a manual pattern in the copy only) | Converges in 1–2 rounds by construction; conservative (heavier nailing = higher capacity weight where it matters); SWD's stored item untouched | DA's split may differ slightly from SWD's own final auto-pick on Update (SWD re-picks for the final loads) → DA ≠ SWD by a small amount; needs a note in the guide | **Medium** |
| **5-B** Detect the cycle, take the envelope | Keep rounds as today; when the weights alternate (A, B, A, B), stop and use, per wall, the state that gives it the larger force (envelope), flagged "two nailing states — envelope used" | No change to how SWD is called; conservative for design; shows the user the ambiguity | The envelope is not one consistent state (Σ shares ≠ line force → closure must re-run on one of the states); more logic | **Medium** |
| **5-C** Converge on forces, not weights | Stop when every group wall's force changes < max(10 lb, 0.5 %) between rounds; add damping (next = ½ (old + new)) if it does not | Engineering tolerance instead of 1e-5 on weights; damping often settles a two-state flip at a value between them | A damped value can be a split SWD never produces (DA ≠ SWD); may still not settle with large jumps; damping changes results of items that settle today only if they did not settle exactly | **Medium–low** |
| **5-D** Keep, show the range | No solver change; the warning lists the two states and the wall forces in each (min / max) | Zero risk; transparent | Problem not solved; user must judge | **None** |

**Recommendation: 5-A** (deterministic, conservative, the copy only) with the DA ≠ SWD difference reported on the
Shear wall link page; **5-D** as part of it (the warning shows which walls changed). Tests: 26998 (A/B, C/D, 2/3) settle
without the warning; 26996 (capacity and deflection) unchanged within 1 %; books unchanged.

---

## Item 6 — Collector per wall above (grid 6: SW-39 → D2 only, SW-55 / 56 → D10 only)
**Today.** `tdBasicShear.basicCase`: a wall above that ends at this floor is a concentrated load into **every** diaphragm
spanning across its grid, shared by depth (26998 grid 6: each wall 41.8 % D2 / 58.2 % D10, regardless of where it
stands). One collector setting per line (`inputs.aboveCollectors[swdLineId]` from–to) applies to all walls of the line.
**User rule (reviewed):** no collector → no sharing; a collector spanning several diaphragms → they share.

| Option | What | Pros | Cons | Risk |
|---|---|---|---|---|
| **6-A** Opt-in switch per line | A tick per line "each wall into the diaphragm(s) under it" (`aboveCollectors[lineId].own = true`); a wall straddling a boundary split by length | Small; existing items unchanged (absent = today); solves 26998 grid 6 | Two rules per line only (all-share or own); cannot model a collector over part of a line plus own elsewhere | **Low** |
| **6-B** Collector stretches per line | `aboveCollectors[lineId]` becomes a list of from–to stretches; walls on a stretch share over its diaphragms; walls on no stretch → own diaphragm (with the switch) or today's rule | Models real collectors exactly; covers mixed cases | Stored-shape change (object → list, normaliser + upgrade-script note), more UI (add / remove stretches), more tests | **Medium** |
| **6-C** Change the default to "own diaphragm" | No collector set → own diaphragm for every wall above (no switch) | Physically the right default; nothing to tick | Changes results of every item with walls above and a blank collector (26996, 26997, 26998, user projects) and their SWD loads on Update; tests to rewrite | **High** |
| **6-D** Receiving diaphragm per wall | In the walls-above table, each wall gets a "goes into" pick (auto = today, own, or a list of diaphragms) | Most control; per wall, no geometry | More UI per wall; easy to pick an inconsistent set; still needs today's default | **Medium** |

**Recommendation: 6-A** now (covers 26998, zero change to existing items); **6-B** later if a real project needs a
collector over part of a line. Tests: 26998 grid 6 with the switch — SW-39 only into D2, SW-55 / 56 only into D10, Σ
unchanged, both directions close; switch off = today's values; 26996 / 26997 unchanged.

---

## Order and effort
| Order | Item | Option (recommended) | Effort | Risk |
|---|---|---|---|---|
| 1 | 0 — null δ | 0-A | small | low |
| 2 | 6 — collector switch | 6-A | small–medium | low |
| 3 | 5 — not settling | 5-A (+ 5-D warning detail) | medium | medium |
| then | commit everything (td-v14 + these) after the user's review | | | |

Deferred (unchanged): wall-less part of a wall line as automatic collector, G11, SWD small items, modelling-rule warnings,
placement agent, Phase 8 (PDF / upgrade script — must cover 6-B if built).

## Built 2026-11-09 (user picked 0-A, 6-A, 5-A) — uncommitted, user commits after review
- **0-A (td-v15)** `tdWallLink.swdWallShares`: equal δ only when every group wall has a finite δ at 0, ½ and the full
  carried force; else that round is split by capacity (warning `swd-group-defl`). Also fixed: the W pass (no wind)
  cleared the flag set by the E pass, so the warning never showed. The fallback is per round — on 26998 Roof 2/3
  (deflection): rounds 0–1 capacity, rounds 2+ deflection. Test `tests/daDeflectionGroup.test.mjs`.
- **6-A (td-v16)** opt-in per line of walls above "Each wall into the diaphragm under it" (`aboveCollectors[line].own`;
  Plan → Shear walls, collector table): no collector along the grid; a wall split by its length over the diaphragm(s)
  under it; none under it → error `above-no-diaphragm` naming the switch. Off = today. 26998 grid 6: SW-39 → D2 only,
  SW-55 / 56 → D10 only, drag across the middle of grid 6 2 k → ≤ 0.4 k, Σ unchanged. Tests in daCase26998, daUi.
- **5 (td-v17)** two causes found:
  1. `swdWallShares` clamped this level's line force to ≥ 0 when working out the force from above on a group line, so a
     negative line force (26998 line 3) fed back into the force from above (12.45 instead of 15.65 k) and the rounds
     swung. Removed: the force from above is now exact (SW-35 15.65 k).
  2. SWD's auto nailing can alternate (A → B → A); such a wall is now held at the heavier pick in the SWD copy (from
     round 3, warning `swd-group-nailing` names the walls). A wall whose nailing changes once and stays is left free —
     26996 (DA = SWD wall by wall) unchanged. Rounds 6 → 8.
  26998: every offset line settles. 2nd Floor 2/3 settles on SWD's own picks (SW-70 / 71 lighter nailing; line 3 −8.86 k,
  line 2 10.58 k; all six walls at the same demand / capacity); the Roof 5/6 walls SW-39 / 55 / 56 alternate and are held.
- Line 2 residual −29 lb (within tolerance) is not from the rounds: TD6 (supports 2 / 5) puts ~29 lb of line 4 onto
  line 2 as a support reaction; TD5's strut load on line 2 is read from the basic field without it (rule G2 shares a TD
  reaction on a load line only when ≥ 2 TDs are loaded from it). Small item for the backlog.
- `npm test` 692 ok, build OK, books unchanged, no SWD file touched.
