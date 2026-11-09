# Diaphragm Analysis — open items, re-assessed by need and risk (2026-11-06)

First draft of this plan had 10 steps for backlog items 1–7. The user asked which are really needed and which could
conflict with what works today and make the tool fail. This is the approved re-assessment
(`~/.claude/plans/add-new-feature-to-kind-horizon.md`).

**State:** Roof 26998 closes; 2nd Floor 26998: load along y closes, load along x fails (line 2 −816 lb, line I −38 lb);
offset lines warn "did not settle"; `npm test` green (678), books 649 / 649, SWD freeze identical.

**Risk** = chance a change makes items that work today fail or change silently (engine paths shared by every item,
the closure solver, the stored data shape, SWD files used in production).

## Verdict per item
| # | Item | Needed now? | Risk to what works | Decision |
|---|---|---|---|---|
| 0 | Commit today's work | **Yes** — protects the working state | none | **Do (user)** |
| 1 | Member ends at its grid end (J collector) | No — only a flat −15 lb drawn above y 42.5 | **High**: grid extents are already set for drawing on many grids (26998: O–H.3 from 30, 8 / 8.8 from 50, 10 / 11 from 80). Grid 8 starts at x 50 but crosses D6 (x 43.33–57) on the 2nd Floor — its member would be cut inside a diaphragm and runs that close today would open | **Dropped**; if wanted, a view-only option (below) |
| 2 | Offset lines "did not settle" | **Yes** — 26998 wall shares use an unsettled round | investigation none; a solver change medium (all SWD-linked offset cases, 26996 tests) | **Investigate only**; change only with a proven cause, behind tests |
| 3 | 2nd Floor x: line 2 −816, line I −38 | **Yes** — the item fails | investigation none | **Investigate only**; fixes as modelling advice first |
| 4 | Strut over openings (grid 2 D–E, grid 9 F–G) | Probably not — along x already continuous struts, along y chords carry 0 there | none | **Ask the user** which view; no code |
| 5 | Collector per wall above / new default | **Partly** — grid 6 sends SW-39 into the east diaphragms | **High** as first planned: default change for every wall above (26996, 26997), stored-shape change, engine + member sources + wall link, closure solver, G11 | **Reduced** to an opt-in per-line switch, default unchanged (below) |
| 6 | Mixed-case fixture (26998 2nd) | Yes — regression protection | none (test only) | **Do**, pin today's values |
| 7 | G11 (load inside a TD) | No — avoidable: split the diaphragm at the collector end | **High**: TD engine, book values | **Deferred** |
| 8 | Small items | No | "+X k from above" label low (DA view); B5 note and snap-to-grid are **SWD production files** | DA label only if wanted; **SWD items deferred** |
| 9a | Modelling-rule warnings | Useful | low–medium: false positives on valid layouts | **Later**, after 2–3; warnings only; every fixture must stay warning-free |
| 9b | Placement agent | No | none until built | **Future** |
| — | Phase 8 PDF / upgrade | No | — | **On hold** |

## Work, in order
1. **Checkpoint (user):** browser check of the UI (light / dark theme), commit.
2. **Fixture 26998 2nd Floor** (`tests/fixtures/da-user/t98-2nd.json`, `tests/daCase26998.test.mjs`): pins today's
   2nd Floor (y closes, Σ 37.84 k, wall shares; x recorded as failing on line 2 and line I) and the Roof (both close).
   Test only.
3. **Investigation of 2 + 3** (scratch scripts, no tool change): why the SWD group shares do not settle
   (`solveLinkedGroups`, `diaphragmAnalysis.js`), what leaves −816 on line 2 and −38 on line I. Findings to the user,
   each marked "modelling advice" or "engine fix + its own plan".
4. **Item 5 reduced (only on the user's go):** an optional per-line switch "each wall into the diaphragm(s) under it"
   next to today's collector from–to (`inputs.aboveCollectors[swdLineId].own = true`; absent = today). Engine in
   `tdBasicShear.basicCase`: receivers = the diaphragms under each wall's own extent, split by overlap length; member
   source over the wall's own length. Existing items, books, 26996 / 26997 unchanged (tests prove it); CALC_VERSION
   bump for the new option. Test: 26998 2nd grid 6 — SW-39 only west, SW-55 / 56 only into D10. Stretches per line
   and a default flip only later, after the user validated this.
5. **Item 4:** ask the user (no code).

**Item 1, view-only alternative (only if wanted):** in View 4 hide member stretches with |N| below the closure
tolerance, or draw a member only within its grid's extent while the closure check still runs on the full line.

## Verification for every step kept
`npm test` (678+ ok), `npx vite build`, books 649 / 649, `tests/swdFreeze.test.mjs` identical; item 5: every existing
fixture identical with the switch absent.

## Findings (investigation 2026-11-06, scratch scripts; no tool change) — `tests/daCase26998.test.mjs` pins them
Fixtures refreshed from the local DB: `t98-2nd` (saved 22:54), `t98-swd` (22:55: SW-9 / SW-11 / SW-39 / SW-55 / SW-56
end at the 2nd Floor), `t98-roof` (20:07). Roof: both directions close.

1. **2nd Floor along y failed since the 22:54 save — fixed (td-v13).** First read as G11 (SW-9 / SW-11, Roof line B,
   7.32 k, end at this floor inside TD1 on its strut line B of offset line A/B). Closer look: their load balances on B
   inside the TD; the −405 lb on B came from **SW-8 (B, y 54–57.5) running 0.5 ft into TD1 (from y 57)** — the wall's
   share there left the member but was not part of the TD's strut load P (measured at the TD edge). Fix in
   `tdMembers.crossForce`: the part of a load-line wall inside the TD is added to P (as if TD1 started at the wall end —
   same shares within 0.1 k). Now the saved 2nd Floor closes along y **with A/B**: Σ 45.16 k. Books unchanged.
   Loading with / without A/B (load along y, SW-9 / SW-11 ending here, k): A 3.65 / 7.07 (SW-2 1.01 / 1.95, SW-12 2.64 /
   5.11), B 5.48 / 0.76 (SW-4, SW-8 2.74 / 0.38 each), C 0.51 / 0.75, D 2.32 / 3.39; E, G, J, M unchanged.
2. **"Did not settle" = a two-state cycle from SWD auto nailing.** The group split uses SWD wall capacities; between
   rounds SWD re-selects nailing and flips between two choices (x 2/3: SW-70 / 71 5520 / 6440 ↔ 4219 / 4922 lb;
   y A/B: SW-2 / 12 2974 / 7785 ↔ 2530 / 6624). The above force on line 3 also creeps (12.0 → 12.7 → 12.3 → 12.5 k).
   A fix (later, own plan): freeze SWD's auto-selection after the first round, or detect the cycle and take the
   conservative state — touches every SWD-linked offset case (26996 tests).
3. **Line 2 −816 lb (along x) is not from the cycle.** It moves with the round count (−650 … −1143) but stays near
   −780 lb when settled. The 2/3 split is fixed by SWD capacities; closure would need a different split (in Ex 3.3 the
   closure decides the split). Engine question for the offset solver — own plan, medium risk.
4. **Line I −38 lb (along x)** is the same in every round: the D12 corner (x 80, y 39–42.5); independent of 2–3.

## Update 2026-11-09 — 26998 2nd Floor after the user's layout changes
User changes: SW-57 deleted (line 6 has no wall: a Ch 8.4-style collector into the west diaphragm D2 and the east D10,
automatic); west tab + strip one diaphragm on 9 / 5 with chord-step TD7 (x 0–33, y 57–67, O / D); grid 9 ends at x 40,
new wall-less grid 9E (D6 on 9E / 6, D11 on 9E / 8), TD8 (x 80–87.5, on 8 / 10) takes 9E; TD9 (x 66–80, y 42.5–62,
5 / 8, load 9E) added. Load along y closes (A/B kept, td-v13).
- **TD9 is not needed and fails** (E_TD_CLOSURE in every shape tried); with TD9 deleted, 9E goes into TD8 alone and the
  only open run of the item is **line 2 (−816 lb)**. Shear Walls: plan grids to update (grid 9 / 9E, warning grid-mismatch).
- **Line 2 cause (step 4), found:** the 2/3 offset line is split by SWD capacity including the forces of the walls above
  that continue down lines 2 / 3 (SW-60 / 62 / 65: 8.5 k; SW-35: 15.65 k). Sharing them across the group moves ~5 k from
  line 3 to line 2 through this floor; the model does not close it. Probes (scratch copy): split by wall length → closes;
  SWD capacity but the above forces kept on their own lines → **both directions close** (line 2 2.70 k, line 3 1.64 k; y:
  A 2.66, B 6.86 k). Likely engine cause: a TD's strut load P leaves out walls above that continue down their line
  (26996 rule, `tdMembers.wallR` noThrough) — in an offset line part of that force does not stay on its line, so the
  strut must carry it.

### Steps now
| # | Step | Who | Risk |
|---|---|---|---|
| 1 | Delete TD9; update Shear Walls plan grids (grid 9 / 9E) | user | none |
| 2 | Commit today's work (UI, colours, td-v13, docs, tests) | user | none |
| 3 | Refresh fixtures `t98-*` + `tests/daCase26998.test.mjs` to this layout | Claude | none |
| 4 | **Line 2: offset line with walls above that continue — engine fix**, plan first: prove the P / sink cause on 26998, fix so the redistributed above force is carried by the strut (keep DA = SWD as verified on 26996), tests 26996 / 26998 / books unchanged elsewhere | Claude | medium |
| 5 | "Did not settle" (SWD auto-nailing two-state cycle) — after 4 | Claude | medium |
| 6 | Collector switch (opt-in, grid 6: SW-39 → D2 only, SW-55 / 56 → D10 only) | Claude, on go | low |
| — | Deferred: wall-less part of a wall line as automatic collector (9E made it unnecessary), G11, SWD small items, warnings, agent, Phase 8 | — | — |
