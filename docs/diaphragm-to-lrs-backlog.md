# Diaphragm to LRS — decisions and backlog

Branch `diaphragm-to-lrs` (off `sw-verification`). Plan: `~/.claude/plans/fx-is-the-right-sharded-melody.md` (approved 2026-10-07).
Reference: Shared Drive `Design Item Hub\Diaphragm to LRS reference\diaphragm to line laoding.pdf` (page C.6) = case D01.

## Next session — start here (set 2026-10-08)
**State:** schema 2 / calc v2, local, **not committed**. `npm test` all green (engine 21, beam check 39, migration 22,
cases 87); `npx vite build` OK. DLRS-VERIFY seeded by the user on 2026-10-08 (29 items, all pass on read-back; still schema 1).

**The user next:**
1. **Upgrade the saved items:** `SB_EMAIL=… SB_PASSWORD=… npm run upgrade:dlrs` (dry run).
   - Claude's dry run on 2026-10-08 reported 30 items, every one "schema 1→2, no value lost, results unchanged".
   - Then `-- --apply`, or re-seed DLRS-VERIFY with `dlrs:seed -- --apply`.
   - The user runs both in their own PowerShell (DB writes by Claude are blocked).
2. **Test-123 merge:** E-W tab → Merge lines → + Merge lines → tick 4 and 5 → all levels → Calculate & Save.
   Expected: R.4+R.5 F = V = 6.35 k; 2.4+2.5 F 3.97 k, V 10.32 k; line 2 unchanged (R.2 6.01, 2.2 V 8.99).
3. **Look at:** the reaction rows (lever rule with numbers, no Case column) and the Detailed PDF (lever-rule table).

**Open items:**
- **O2 — Shear Wall link** (decision 16): fill Shear Wall line E loads from this item's F by direction / line name / level.
- **O3 — wind** (loadType 'wind'): area load from wind pressure instead of F_x / ΣA.
- **O4 — diaphragm design** (decision 15 kept it out): V(x), M(x), unit shear v = V/d, chord force M/d.
- **Suggestion S1 (not decided):** a manual uniform load in plf (extra load, like manual P).
- **Suggestion S2:** apply `docs/data-durability.md` P1–P7 to the other modules.
- **Note — leftover down choice:** Test-123 keeps a story-shear choice for a line that was later deleted.
  - The calc ignores it and the data keeps it (P4: never drop).
  - Deleting a line does not clean up its down choices or split targets. Cleaning them on delete would be a UI
    choice; not done.

**Closed:**
- **O1** (confirm the AISC case numbers): nothing is printed any more.
- **O5** (AISC labels): removed (decision 1, 2026-10-08).

**2026-10-08 — round 2** (plan `~/.claude/plans/sorted-floating-metcalfe.md`, user decisions 1–3):
- **D1 — AISC case labels removed** (calc v2).
  - The engine rows carry only the lever-rule values; `caseOf` is gone.
  - The tool rows and the PDF Detailed table show the lever rule with numbers (`leverRuleText`, one text for both).
  - The golden diff was only: calcVersion, `rows.case` removed, `lines.merged` added, D9 added. No number changed.
- **D2 — Merge lines.** The user had not found "Combined lines"; the logic was already there.
  - Renamed to **Merge lines → one line of resistance**.
  - Added a hint, a "merged" badge in the summary and the down table, and a pointer when nothing is merged.
  - Rules: a merge counts only with **2 or more** lines. A line in two merges at one level is flagged by **D9**.
  - Rounding: the merged values are the sums of the separate lines, but the tool adds unrounded values. So 2.4+2.5
    F is 3.9692, while 2.5735 + 1.3958 = 3.9693.
- **D3 — Durable stored data** (`docs/data-durability.md` P1–P7).
  - Schema 2 stamps `inputs.schemaVersion`.
  - `diaphragmToLrsMigrate.js` holds the steps, `normalizeInputs` and the no-loss / results helpers.
  - Frozen fixtures in `tests/fixtures/legacy-dlrs/`: the real Test-123 item, D01, and unknown / missing fields. All
    were captured on calc v1 before any change.
  - Also: `tests/diaphragmToLrsMigrate.test.mjs`, `npm run upgrade:dlrs`, and `dlrs:seed` now stores the current
    shape.

**2026-10-08 — beam solver back-check** (B01–B19, `docs/diaphragm-to-lrs-beam-check.md`):
- **Method:** hand calc two ways (formula, free body), written before the tool was run.
- **Result:** all 60 values match.
- **Tests:** `tests/diaphragmToLrsBeamCheck.test.mjs`, plus the case test and seed. Not in the generated catalog.

## Self-review notes (Claude, end of 2026-10-07) — to look at with the user
Not bugs found by tests; things to confirm or improve once the user has tried it:
- **R1 New diaphragm shows red at once.** A new row has no support targets, so D3 flags it until both supports are
  picked. Possibly show "incomplete" (grey) instead of an error while the row is new.
- **R2 Save gate.** Saving is blocked while any support has no target. Fine for finished work; may be annoying mid-entry
  (other modules behave the same way).
- **R3 "Same line below" needs diaphragm load below.** A line that continues down but gets no diaphragm load at the
  lower level is flagged D6; the workaround is Split 100 % to that line. Confirm this rule with the user.
- **R4 Negative line force.** A reversed reaction (D03) gives a line a negative F, which is carried down as is. Confirm
  this is wanted (statics) or should be flagged.
- **R5 Diagram labels** of point loads close together can overlap (labels alternate between two heights only).
  Narrow parts squeeze their "w = … plf" label.
- **R6 Levels from ELF.** If a level is renamed or removed in ELF, its diaphragms become orphans (warned in Setup,
  not calculated). Matching is by level name.
- **R7 Whole-form re-render** after every change (onChange): the page keeps its scroll position, but focus moves out of
  the field. Matches the other modules.
- **R8 Not run yet:** `npm run dlrs:seed` (local DB write), a browser check by the user, PDF export in the browser
  (Node tests only build the sections).
- **R9 Nothing committed.** Commit / push only when the user asks; branch is off `sw-verification` (not merged to master).

## Decisions (user, 2026-10-07)
1. F_x per level from an ELF item (`elfTable[].fx`), manual when not linked. F_x only.
2. q = F_x / Σ(that direction's diaphragm areas at the level); ΣA of the other direction shown for information.
3. Rectangles only: a part = b × d. Odd shapes are split into parts / diaphragms.
4. A diaphragm = length L, two supports x₁ < x₂ (overhangs where a support is not at an end), any number of parts (a, b, d; c = L − a − b) and point loads.
5. Exactly 2 supports; a span across 3+ lines = separate diaphragms.
6. A support is a wall line or another diaphragm (+ x on it), set on the supported diaphragm; the receiving diaphragm shows a read-only point load; solved in dependency order; a loop is an error.
7. Manual point loads are extra load (note each): level check Σ reactions to lines = F_x + Σ manual P.
8. Wall lines per direction (all levels), labelled with the level tag (R.A, 2.A).
9. Story shear down, per line per level: Same line (default) / Split % (vertical discontinuity) / Ends here (resisted at that level, e.g. hillside).
10. Summary per level: F, from above (source + %), V = F + from above, goes to; check row.
11. Combined lines (C+D) per direction with the levels where they apply.
12. Direction tab = load direction = wall-line direction.
13. Layout: Setup · direction tabs (lines → level sub-tabs → table + editor → down choices; summary at the bottom) · Checks.
14. One beam diagram per diaphragm (tool and PDF); no plan view.
15. v1 results: reactions + summary only.
16. Shear Wall link later.
17. Forces in kip, stored to 4 decimals, shown with 2.
18. Checks D1–D8 and a full verification catalog.
19. PDF Summary / Detailed.
20. Branch off `sw-verification`.
21. Labels: level tag auto (Roof → R, 2nd Floor → 2), editable; marks D1…; R1 / R2; P1….
22. ΣA E-W vs N-S: information only.
23. "Copy diaphragms from <level>": once, independent afterwards; manual P not copied.
24. Quick row entry for a simple diaphragm; the editor [▸] for parts, overhangs and point loads. While simple, changing L moves R2 and the part's b.

## Engine (as built)
- Parts are cut at x₁ and x₂ into pieces (left overhang / back span / right overhang). Every piece and point load: R1 = W·(x₂ − x̄)/l, R2 = W·(x̄ − x₁)/l (l = x₂ − x₁), computed independently so D1 is a real check. A load on an overhang gives a negative value at the far support (reverses).
- Row labels: back span uniform = Case 4 (Case 1 when it covers the span), point = Case 8; overhang uniform = Case 25 (whole overhang) or the general form; overhang point = Case 26 (tip) or the general form.
- Checks: D1 ΣR = ΣW + ΣP · D2 Σ to lines = F_x + manual P · D3 geometry / supports · D4 loops / cross-level links · D5 split = 100 % · D6 a line with nowhere to go below · D7 ΣV = ΣF at and above − resisted above · D8 F_x and area present.
- "Same line below" needs the same line (or its group) to receive diaphragm load at the level below; otherwise D6 asks for Split or Ends. A split to a line with no diaphragm load is allowed (explicit).
