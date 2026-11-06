# Diaphragm Analysis — fix plan from the user's test (26999 Cotoros ADU Test), 2026-11-03

Status: **steps A–D built 2026-11-03 (user go, td-v10); step E on hold.** Results, open items and the user's pending
decisions Q1–Q3: `docs/diaphragm-analysis-backlog.md` start-here. Source: item "Diaphragm Analysis ADU - Roof" (linked to SWD
"ADU Shearwall Lines"), run in Node on copies; no database or repo data changed. Experiment scripts: session scratchpad
(`run26999.mjs`, `exp.mjs`, `expx.mjs`).

## User decisions (2026-11-03)
- **Plan approved, not started** — implementation waits for the user's go.
- **D1 — offset line needs a strut.** Two wall lines are one offset line of resistance only when a continuous strut
  connects them. 2nd floor (item "Diaphragm Analysis ADU - 2nd Floor", E-W): SW-9 on 4 and SW-11 on 5 are **separate
  lines** (no strut across the notch). Roof (E-W): **continuous strut on lines 4 / 5** → offset line 4/5 stays.
- Consequence (2nd floor): the middle strip x 13–22 has no wall under it; its share between lines 4 and 5 is a
  tributary assumption, not statics. Models tested on copies (all balance, all runs close):

  | Model (2nd floor E-W) | SW-9 (4) | SW-11 (5) | SW-7 (2) |
  |---|---|---|---|
  | A: D 3–13 on 4/2, D 13–35 on 5/2, TD 13–35 B/E (strip → right) | 1279 | 2587 | 4394 |
  | B: split at C, TD1 3–17.5 A/C, TD2 17.5–35 C/E (strip half / half) | 1671 | 2244 | 4345 |
  | C: D 3–22 on 4/2, D 22–35 on 5/2, TD 3–22 A/D (strip → left) | 2063 | 1901 | 4296 |
  | **D** (user): D1 3–13 on 4/2, D2 13–22 on 3.8/2, D3 22–35 on 5/2; TD1 = D1's rectangle (4/2), TD2 = D3's (5/2); line 3.8 → TD1 / TD2 equal split (Ex 4.2) | 1671 | 2244 | 4345 |

  D = B exactly (equal split of 3.8 = strip split at mid-width). D needs load line 3.8 set by hand today (Auto adds a
  false line 4 on TD2 — item 1b). The user's original single D1 on 5/2 gives SW-9 = 0 (item 6).
- Dropped: item 8 (a diaphragm resting on an offset line, each leg on its own line) — not needed with D1.

## Summary

| # | Issue | Fix | Changes today's results? |
|---|---|---|---|
| 1 | TD load-line search counts walls of the other direction (TD1 gets lines 2 and 4 from SW-6 / SW-8) | Count only walls that resist this load direction | Only TDs where such a wall was picked. Book: none expected (test proves it) |
| 2 | A TD takes at most 2 load lines (error `td-loads-max`) | Any number for a simple-span TD: one engine run per load line, results added (superposition) | Only TDs with ≥ 3 load lines (today an error). TDs with 1–2 lines run exactly as today |
| 3 | A strut TD whose load line enters from both edges gets P = 0 (side 'both' → 0) | P = N at the high edge − N at the low edge (same rule as G1 for chord TDs) | Only strut TDs with side 'both'. Book: none (test proves it) |
| 4 | Closure solver can leave a case out of equilibrium (ADU E-W: Σ line forces 18,349 / 10,559 lb vs load 16,740 lb), and those forces still go to SWD | (a) equilibrium as a solver equation; (b) a case out of equilibrium fails and its forces are held from SWD; (c) investigate an offset-line member inside a diaphragm overhang — stop and report before any method change | Only cases that today end out of equilibrium. Book: none (all balance exactly) |
| 1b | Load-line search accepts a wall (or a diaphragm support line) on a grid that does not reach the TD edge (2nd floor case D: TD2 at x 22 gets line 4 from SW-9 at x 3–7 across the notch) | The grid must run continuously along the sheathing from the wall / diaphragm to the TD edge | Only TDs with such a false line. Book: 20 / 20 must still be found |
| 6 | A shear wall of the load direction inside a diaphragm's span, not a support or offset-line member, takes 0 silently (2nd floor SW-9) | Warning naming the wall and diaphragm: split the diaphragm at each wall line (Ch 8.4) | Warning only |
| 7 | An offset line can be defined between lines no member connects (D1) | Plan error when no continuous strut / TD path connects the group's lines ("4/5: no strut connects line 4 to line 5 — separate lines of resistance") | Items with such a group show the error. Roof 4/5 (continuous) and book Ex 3.3 / Ch 8.4 must pass |
| 9 | (optional) A strip with no wall under it is shared by an assumption (equal split / where the plan is divided) | Show the bounds (all to one side / all to the other) next to the chosen split on the Analysis tab | Display only |
| 5 | Silent input problems | (a) error: loads of one case acting in opposite senses, or two seismic F_x/ΣA loads in one case; (b) error: a simple-span TD drawn past its supports; (c) warning: grid outside the outline | Items with these inputs show a plan error / warning instead of wrong results |

Proposed order: **A** (1, 1b, 3, 5a, 5c, 6 — small) → **B** (2) → **C** (4, 7; then rerun the Roof E-W with offset line
4/5) → **D** (5b) → **E** (9, if wanted). Acceptance tests from the user's items: 2nd floor case D on Auto closes 17 / 17
with SW-9 / SW-11 / SW-7 = 1671 / 2244 / 4345 (= model B); 2nd floor single D1 warns about SW-9; Roof N-S with TD1 on
6 / 1.7 Auto closes; Roof E-W with offset 4/5 balances (closes, or a stop-and-report per item 4c). Each step ends with `npm test` green,
`npx vite build` OK, all 9 book examples 649 / 649, Shear Wall Design files untouched, then a short report to the
user. CALC_VERSION td-v9 → **td-v10** (one bump at the end). No schema change, no migration: every new behaviour reads
fields that already exist (`tds[].loads` is already a list).

Suggested before step A: a checkpoint commit of today's uncommitted work (user's call), so these changes can be
reviewed as their own diff.

---

## 1. TD load-line search: walls of the other direction

**Issue.** `detectTdLoads` (tdGeometry.js:91) accepts "a wall on this grid outside the TD" as a reason for a load
line, whatever the wall's direction. In the ADU, N-S TD1 (load along y, load lines along x) picked up grid 2 (SW-6) and
grid 4 (SW-8), both E-W walls, which carry nothing under a N-S load.
- As drawn (supports 2 / 5): the search returns line 4 → "no disrupted force" → TD1 not run → 4 member runs open.
- With the correct supports 6 / 1.7: 4 lines found (2, 4, 5, 5.5) → plan error "a TD takes at most 2". This is the
  "multiple point loads" error.

**Fix.** The wall reason counts only for walls on grids running across the load (load along y: walls on grids at
constant x; load along x: walls on grids at constant y), i.e. grid axis ≠ the TD's load direction. Notch / opening
edges and the "support line of a diaphragm" reason are unchanged.

**Proof on your item:** TD1 on supports 6 / 1.7 then finds exactly 5 (left) and 5.5 (right). In the experiment with
those two set by hand: equilibrium ✓, 22 / 22 runs close, TD closure 0.000 %, TD1 loads 1756 / 1805 lb.

**Effect on current behaviour.**
- Changes: a TD whose found load lines include such a wall loses that line. That's the intended fix.
- Unchanged: the 20 book TDs. The existing test erases the entered load lines and requires all 20 to be found again;
  if any book TD relied on such a wall, I stop and report instead of changing the rule.
- Saved items: only Auto TDs; "Set by hand" TDs are never re-detected.

**Tests.** A case with an other-direction wall on a candidate grid (not found); the ADU layout (finds 5 / 5.5); the
existing 20-TD test.

## 2. More than 2 load lines on one TD

**Issue.** The TD engine (vendored skill) takes P1 and P2 only. tdGeometry raises `td-loads-max` (> 2), tdFrame says
"at most 2 load lines", the panel hides "+ load line" at 2. A TD crossing several cut chords / struts (several
notches along one edge, the ADU bump with a wall line in it) cannot be modelled.

**Fix — superposition of engine runs (the skill stays untouched).** A simple-span TD is a beam with point loads;
everything it produces is linear in the loads. The engine's outputs (tdFlow S090–S290): support reactions, segment
shears, net edge shears, edge member forces, collector forces, closure, aspect, blocking. It has no capacity check.
- **1–2 load lines: today's single run, no change** (same code path, same values).
- **≥ 3 load lines** (simple-span only; a cantilever TD keeps its one load at the tip):
  - run the engine once per load line i with P_i alone, basic / outside shears set to 0, so each run is the TD's own
    field and the basic field is not counted N times;
  - TD field = Σ of the runs: N + 1 segments between the supports and the load lines; segment shear = Σ_i of run i's
    shear on that interval; reactions = Σ;
  - net field and every member force: the tool's own integration, as today (basic + TD field), so View 2 / 3 / 4 and
    the member closure need no new method;
  - checks: each run's own closure (pure TD, must close); aspect / blocking are geometric (same for every run); the
    "skill = integrator" edge check compares Σ runs' edge forces + the basic-field part of the edge with the
    integrator;
  - closure solver: TD load = Σ P_i (today P1 + P2).
- Stored data: `tds[].loads` already a list; "+ load line" shown for any number on a simple TD.
- TDs tab: load table (line, side, position, P), reactions, the N + 1 segment shears, note "superposed from N engine
  runs (one per load line)"; each run's trace kept.

**Proof before it is used.** For every book TD with 2 load lines, the superposed result (two 1-load runs + basic)
must equal the existing 2-load run (reactions, segment shears, edge forces; 1e-6). Plus a 3-load case vs a hand
calculation (simple beam, three point loads), and a plan with three notches on one TD edge that must close.

**Effect on current behaviour.**
- Changes: TDs that today stop with `td-loads-max` now run.
- Unchanged: every TD with 1–2 load lines (all book TDs, all saved items that run today). Book keys `tdR`, `vtd`,
  `tdP` keep reading the same outputs for those.
- Not covered: a cantilever TD with more than one load (still an error, with its message).

## 3. Strut TD with a load line entering from both edges

**Issue.** tdFrame turns side 'both' into 0 (tdGeometry.js:461). For a chord TD that's handled (G1: P = N_high −
N_low), but for a strut TD tdDerive computes `N × side` = **0** (tdDerive.js:72). ADU E-W TD2: Auto finds line 4 from
both sides (SW-8 on the left, D1's support line on the right) → P = 0 → "no disrupted force", not run. The same line
set by hand with side "−" gives P = 3592 lb and the TD runs. So Auto and Set by hand differ.

**Fix.** Strut TD, side 'both': P = N at the high edge − N at the low edge (crossForce at each edge), and the "how"
text names both, as for chord TDs (G1).

**Effect on current behaviour.**
- Changes: strut TDs with side 'both' get a load instead of 0.
- Unchanged: no book TD is a strut with 'both' (649 / 649 must stay); chord TDs unchanged.

## 4. Closure solver and equilibrium (wall line inside a diaphragm overhang)

**Issue.** In the ADU E-W case D1 spans between 4 and 2; wall line 5 (SW-10) lies in D1's overhang (y 0–8) and
forms the offset line "4/5" with line 4. The solver moves the group force and the wall-line forces freely to close the
member runs; nothing holds Σ line forces = load. When it cannot close (TD2 not loaded — issue 3 — or TD2 drawn past its
supports — issue 5b), it ends with:
- as drawn: lines 4 / 2 / 5 = 6806 / 7344 / 4198 → Σ 18,349 lb vs load 16,740;
- TD2 drawn 5–29 with line 4 set by hand: Σ 10,559 lb.
These line forces **are sent to SWD**, which designs the walls for them. The Checks tab shows the failure, but SWD does
not.
With D1 supported on 5 / 2 instead, the same case balances, TD2 runs and only the small depth-step runs on O / B stay
open (73 / 130 lb, they need a TD in E-W like TD1 in N-S). So the overhang matters here, but only because the
offset-line member is inside it.

**Fix.**
- (a) **Equilibrium is an equation of the solver**: a heavily weighted row Σ line forces − load = 0 next to the run
  residuals. Every book case already balances exactly, so their solution does not move.
- (b) **Gate:** a case that ends out of equilibrium fails ("FAILED — line forces do not balance the load: Σ … vs …");
  TD / net / members not reported (like PAUSED), and its line forces are held from SWD (`E` / `W` = null, as for a
  paused case; SWD keeps its own values and shows the held-link note). SWD never gets unbalanced forces.
- (c) **Investigate** the wall line in the overhang after 1–3 and (a): rerun the ADU E-W layouts (as drawn, TD2 between
  its supports, line 4 by hand). If it closes, done (add it as a test). If not, I **stop and report** what the solver
  lacks and the options (e.g. let an offset-line member that is not a diaphragm support receive its share through the
  TD only) — no method change without your decision.

**Effect on current behaviour.**
- Changes: cases that today end out of equilibrium are marked FAILED and stop sending line forces to SWD.
- Unchanged: book cases and any case that balances today (they satisfy the new row already; test: 649 / 649, same
  pass table, same unknowns).

## 5. Input checks

**5a. Loads of one case.** Issue: a new item creates seismic loads −y and +x; "+ Seismic load along …" adds another per
direction. Your item has −y with +y and +x with −x, all seismic E → each pair cancels → every line force 0, no
message, SWD gets 0. Fix (plan errors, case not analysed):
- `load-opposite`: loads of one case (direction × kind) acting in opposite senses;
- `load-seismic-twice`: two seismic F_x/ΣA loads in one case (F_x counted twice).
And the "+ Seismic load along x / y" button is hidden when that direction already has a seismic load.
Effect: your item shows the error until one load per direction is deleted. Book items: one load per case, or wind
line loads in one sense (Ex 4.3, 5.1), so they stay valid (test). Several loads in the same sense (e.g. two wind line
loads on different edges) stay allowed.

**5b. TD drawn past its supports.** Issue: ADU TD1 / TD2 span y 0–32 with supports at 5 / 29; the parts outside the
supports are not part of the engine's beam, so edges don't close (TD2 by hand → HARD_STOP E_TD_CLOSURE) and nothing
says why. Fix: plan error `td-past-support` for a simple-span TD whose rectangle reaches beyond a support line along
its span ("TD1 runs past its support 5 (y 0–5): draw it between its supports, move the support to y = 0, or mark the
overhang"). Effect: such TDs show the error instead of a closure stop. Book TDs: checked by test; if any book TD
extends past a support, this becomes a warning instead and I report it.

**5c. Grid outside the outline.** Your grid "1" at y = 37 (outline ends at 32). Warning only ("grid 1 does not cross
the plan"); nothing else changes.

---

## What changes for your ADU item after the fixes (you edit; I don't touch your data)
- Delete one seismic load per direction (5a error until then).
- N-S: TD1 supports 6 / 1.7 → Auto finds 5 / 5.5 → closes (shown in the experiment).
- E-W: either D1 on 5 / 2, or keep 4 / 2 and see step C's result for the offset line in the overhang; a TD for the depth
  steps at y = 5 / 2 (lines O / B) to close those runs.

## Not in this plan
- TD supports found from the plan (still manual, as decided).
- Phase 8 (PDF, upgrade script) — still on hold.

---

## Implementation plan (for review, 2026-11-03)

Rules throughout: Shear Wall Design files and `diaphragmToLrs*` untouched; the vendored TD engine (`tdCalc.js`,
`tdFlow.js`) untouched; no DB writes; no commit unless asked. After every step: `npm test`, `npx vite build`, 9 book
examples 649 / 649, `git diff --stat` shows no SWD file, then a short report and wait. CALC_VERSION td-v10 once, at the
end of step D (one note listing all changes). No schema change.

### Step A — small fixes (items 1, 1b, 3, 5a, 5c, 6)
| Item | Where | Change |
|---|---|---|
| 1 | `tdGeometry.detectTdLoads` (wall reason, l. 91) | count a wall only if its grid's axis ≠ the TD's load direction (walls that resist this load) |
| 1b | same | …and only if the grid runs on sheathing without a gap from the wall's near end to the TD edge (new helper `runsOnSheathing(plan, grid, a, b)`: every interval between break coordinates sheathed on at least one side of the grid) |
| 3 | `tdDerive.deriveTd`, strut branch (l. 64–66) | side 'both' (0): P = N at the high edge − N at the low edge (`crossForce` at each edge), "how" names both, like G1 |
| 5a | `tdGeometry` load checks (l. 255 ff.) | errors `load-opposite` (a case with loads in both senses) and `load-seismic-twice` (two seismic F_x/ΣA loads in a case); `tdPlanEditor.renderLoadList`: "+ Seismic load along …" hidden when that direction has one |
| 5c | `tdGeometry` grid checks | warning `grid-off-plan`: a non-reference grid that does not cross the outline |
| 6 | `diaphragmAnalysis.calcAll` warnings (after `analyse`) | warning `wall-in-span`: a wall resisting the case's load, on a grid strictly inside a diaphragm's span and over its pieces, that is no support of a diaphragm of the case, not in an offset line, and takes 0 |

Tests (new, `tests/diaphragmAnalysisPlan.test.mjs` / `…Td.test.mjs`): other-direction wall ignored; wall across a
notch gap ignored; ADU Roof N-S TD1 on 6 / 1.7 Auto → 5 (−) and 5.5 (+), closes 22 / 22; ADU 2nd floor case D Auto →
only 3.8, closes 17 / 17, SW-9 / SW-11 / SW-7 = 1671 / 2244 / 4345; strut 'both' Auto = hand-set sides; Roof stored
loads → `load-opposite` errors; 2nd floor single D1 → `wall-in-span` for SW-9; 20 book TDs still found; no new
error / warning on any book item. The two ADU items are frozen as fixtures (`tests/fixtures/da-user/`).

### Step B — any number of load lines (item 2)
| Where | Change |
|---|---|
| `tdGeometry` checks, `tdFrame` | `td-loads-max` only for a cantilever (> 1); a simple TD may have any number; `tdFrame` keeps `geometry` (first two, for the 1–2 path) and the full sorted `loads` |
| `tdDerive.runTds` | 1–2 loads: today's path, untouched. ≥ 3: one `runTd` per load line (P_i alone, `td_has_load2` false, basic / outside shears 0 → the TD's own field); combine: reactions Σ, segments between supports and load lines (n + 1) with v = Σ of each run's shear there → `r.segs` (local), `r.runs` (each run kept with its trace); terminal OUTPUT only if every run is OUTPUT, else the first stop; aspect / blocking from run 1 (geometry only) |
| `tdNet.tdFields` | use `r.segs` when present, else today's s1 / s2 / s3 |
| `tdNet` edge check (skill = integrator) | for a superposed TD: Σ runs' edge forces + the basic-field part of the edge vs the integrator; if that turns out not to be exact, "not compared (superposed TD)" — reported, not hidden |
| `tdClosure` pass table | TD load = Σ P_i |
| `tdBookKeys` (`tdR`, `vtd`) | read `r.segs` when present (book TDs never have it) |
| `tdPlanEditor` (l. 1165), TDs tab (`diaphragmAnalysis.js` ~l. 685–720) | "+ load line" for any number on a simple TD; TDs tab: load table (line, side, position, P), n + 1 segment shears, "superposed from n engine runs" |

Tests: **proof** — every book TD with 2 load lines run both ways (direct vs two single runs superposed): reactions,
segment shears, net field, member forces equal to 1e-6; 3-load hand calc (simple beam, three point loads: reactions,
segment shears); a synthetic plan with three cut chords into one TD closes every run.

### Step C — solver equilibrium, gate, offset-line path (items 4, 7)
| Item | Where | Change |
|---|---|---|
| 4a | `tdClosure.closeCase.evaluate` | extra equation: (Σ line forces − load) × weight 10³, using the same sum as the equilibrium check (`netChecks`) |
| 4b | `diaphragmAnalysis.calcAll` (l. 65–71, l. 230) | a case whose equilibrium check fails → `cs.failed`; Checks "FAILED — line forces do not balance the load (Σ … vs …)"; TD / net / member values not reported (as paused); its `lineForces` E / W = null (SWD skips) + warning `swd-held` |
| 7 | `tdBasicShear.lineGroups` / plan checks | error `group-no-path`: every grid of an offset line must be linked to another grid of it through a TD of the case that has one as a load line (reaching the TD edge, 1b helper) and the other as a support (book: Ex 3.3 TD1 load B / support C; Ch 8.4 TD1 load D / support E; Roof TD2 load 4 / support 5) |
| 4c | — | rerun ADU Roof E-W with offset 4/5 (TD2 between its supports 5 / 2, load line 4): must balance; if it does not close, **stop and report** the cause and options — no method change without the user |

Tests: book cases unchanged (same pass table and unknowns); a forced non-closing model → FAILED + held from SWD;
2nd floor with group 4/5 → `group-no-path`; Ex 3.3 / Ex 8.4 / Roof pass the path check.

### Step D — TD drawn past its supports (item 5b)
`tdGeometry` TD checks: error `td-past-support` when a simple TD's rectangle reaches beyond a support along its span
("TD1 runs past support 5 (y 0–5): draw it between its supports, move the support, or mark the overhang"). Book TDs
checked by test; if one is past a support, warning instead + report. Then CALC_VERSION td-v10 and docs (guide,
backlog start-here, README row, manual-test doc: Test 4 = the ADU items).

### Step E — bounds for a strip without a wall (item 9, optional — only if the user asks)

### What the user will see on the ADU items afterwards
- Roof: errors for the opposite loads (delete one per direction) and for TD1 / TD2 drawn past their supports; grid 1
  warning. After the edits: N-S closes with TD1 on 6 / 1.7 (Auto); E-W per step C.
- 2nd floor: single D1 → warning SW-9 takes no force; case D on Auto closes with 1671 / 2244 / 4345.
