# Diaphragm Analysis — manual UI test (build a book example by hand)

Purpose (user 2026-11-03): check the **usability of the editor** and the **calculations** by drawing a book example
from scratch in a new item, without the seeded DA-BOOK data, and comparing the results with the book and with the
seeded item. Phase 8 (PDF, upgrade script) is on hold until this is done.

How: create a new project (e.g. `DA-MANUAL`), add a **Diaphragm Analysis** item, and follow one test below. Then open
the same example in **DA-BOOK** and compare. Note every stumble in the log at the end. That includes anything you had
to guess, any click that did something unexpected, and any value you could not find on screen. Usability findings
matter as much as the numbers.

The Plan tab has three input pages: **Grids & outline** (grids, outline, opening), **Diaphragms & TDs** (load
direction, diaphragms, pieces, TDs), **Shear walls**. Loads are on Setup → Seismic loading / Wind loading; press
**No seismic load** / **No wind load** on the page of the kind the example does not have (the warning must go away).

Coordinates are in feet, x to the right, y up (as the book figures). Grid ↕ = a line of constant x (numbered grids);
Grid ↔ = constant y (lettered grids).

---

## Test 1 — Ex 4.1 (notch, two TDs; ~15 min). Book: `The Analysis of Irregular Shaped Ch 4.1.pdf`

| Step | What to enter |
|---|---|
| Grids ↕ | 1 @ 0, 2 @ 15, 3 @ 35, 4 @ 50, 5 @ 150 (optional reference CL @ 75) |
| Grids ↔ | C @ 0, B @ 10, A @ 50 |
| Outline | (0,0) → (15,0) → (15,10) → (35,10) → (35,0) → (150,0) → (150,50) → (0,50) → close |
| Walls | SW1 on grid 1, y 0–50, wall line "1"; SW5 on grid 5, y 0–50, wall line "5" |
| Load (Wind page) | line load acting −y, 200 plf from x 0 to 150 (no edge); Seismic page: press **No seismic load** |
| Diaphragm | Plan → **Diaphragms & TDs**, load along y, **Diaphragm** tool: click (0, 0) then (150, 50). The tool cuts it to the sheathing around the notch by itself: message "D1 (3 pieces): spans between 1 / 5", piece table D1.1 0–15 × 0–50, D1.2 15–35 × 10–50, D1.3 35–150 × 0–50. One diaphragm is right here: the notch is not a support line, so the book keeps one beam 1–5 and handles the cut chord with TD1 / TD2. (Alternative: draw D1 over 0–15 only, then **+ Piece** and draw the rest, or press **Fill between supports**.) |
| TD1 | rectangle x 0–15, y 0–50; supports A and C; load lines **Auto** must show B — right (notch edge at x = 15) |
| TD2 | rectangle x 35–50, y 0–50; supports A and C; Auto must show B — left (notch edge at x = 35) |

Check on screen (Analysis tab / TDs tab):

| Value | Expected |
|---|---|
| Force to lines 1 and 5 | 15,000 lb each |
| Basic unit shear at 1 / 2− / 2+ (A-B) / 3− / 3+ / 4 | 300 / 240 / 300 / 200 / 160 / 100 plf |
| Chord B at grid 2 / grid 3 (basic, the disrupted force) | 5062.5 / 10,062.5 lb |
| TD1 force to A / C | 1012.5 / 4050 lb; shears 67.5 (A-B) / −270 (B-C) plf |
| TD2 force to A / C | 2012.5 / 8050 lb; shears −134.2 / 536.7 plf |
| Checks tab | equilibrium ✓, every member run closes ✓ |

---

## Test 2 — Ex 8.4 (Ch 8.4, E-W seismic; the full feature set; ~45–60 min). Book: `The Analysis of Irregular Shaped Ch 8.4.pdf`, Fig 8.20–8.21

This test covers: pieces, an opening, nine diaphragms, four TDs (one spanning the other way), an offset wall line,
a second wall line on the same grid, the collector into the main diaphragm, and the closure solver.

| Step | What to enter |
|---|---|
| Grids ↕ | 1 @ 0, 2 @ 30, 3 @ 50, 4 @ 60, 5 @ 75, 6 @ 100, 7 @ 125, 8 @ 145, 9 @ 170, 10 @ 190 |
| Grids ↔ | E @ 0, D @ 10, C @ 15, B @ 50, A.2 @ 80, A @ 90 |
| Outline | (0,90) → (190,90) → (190,50) → (170,50) → (170,0) → (145,0) → (145,15) → (125,15) → (125,0) → (60,0) → (60,10) → (30,10) → (30,50) → (0,50) → close. ΣA must read **13,250 sf** |
| Opening | x 50–75, y 50–80 |
| Walls (E-W only) | SW4 on A, x 25–50, line **A** · SW8 on A, x 88–108, line **A** · SW5 on D, x 30–40, line **D/E** · SW6 on E, x 75–125, line **D/E** · SW7 on E, x 145–170, line **E7** |
| Load (Seismic page) | acting **+x**: either Area 4.2 psf, or Seismic with F_x = 55.65 kip (q = 55,650 / 13,250 = 4.2 psf); Wind page: press **No wind load** |
| Diaphragms (load along x) | D1 x 0–30, y 50–90, supports A / B · D2 x 30–60, y 10–50, B / D · D3 x 50–75, y 80–90, A / A.2 · D4 x 75–100, y 0–50, B / E · **D5** x 100–170, supports A / E, pieces 100–170 × 15–90, 100–125 × 0–15, 145–170 × 0–15 (draw the big piece, then **+ Piece** twice, or try Fill between supports) · D6 x 170–190, y 50–90, A / B · DT1 x 60–75, y 0–50, B / E · DT3 x 30–50, y 50–90, A / B · DT4 x 75–100, y 50–90, A / B |
| TD1 | x 60–75, y 0–50; supports B / E; load line D, side − |
| TD2 | x 100–170, y 15–50; supports **6 / 9** (it spans along x); load lines 7 (side −) and 8 (side −) |
| TD3 | x 30–50, y 50–90; supports A / B; load line A.2, side + |
| TD4 | x 75–100, y 50–90; supports A / B; load line A.2, side − |

Check on screen (tool values; the book's are in brackets where they differ, see the errata in
`tests/td-book/src/Ex8.4.mjs`):

| Value | Expected |
|---|---|
| Line B | no wall: "to diaphragm D5 (concentrated load)", no "no shear wall" warning |
| Line A | 30,246 lb (book 30,247.8); SW4 / SW8 672.1 plf |
| Offset line D/E | 16,078 lb (book 15,944.7, short by the strut force); SW5 / SW6 268.0 plf (book 265.7) |
| SW7 (line E7) | 9326 lb, 373.1 plf; net shear along SW7 = 0 |
| TD1 load at D (strut from SW5) | 159.7 lb (book 137.4: the book stops, see G10) |
| TD3 / TD4 load at A.2 | 262.5 lb each |
| D5 basic shear (magnitudes) | 305 plf at A, 137 above B, 74.5 below B (book prints 75.4), 221.5 at C (6-9), 310.1 just below C, 373.1 at E. The book draws the mirrored "+" element here, so the Analysis tab shows the opposite signs; the Verification tab shows both |
| TD2 | loads 5123 lb at 7 and 8; force to 6 and 9 1464 lb; shears −41.8 / +104.6 / −41.8 plf |
| Line B member | 2520 at 2, 5946 at 3, 13,119 at 6 (compression), 1680 tension at 9, 0 at 10 |
| Line E member | closes to 0 at grid 7 (book leaves 137.5 lb) |
| Analysis tab | "Closure solver" table: pass 0 open, pass 1 every run closed; unknowns D/E, line A, line E (145–170), collector B → D5 |
| Checks tab | all ✓ |

Then open **DA-BOOK → Ex8.4** (after re-seeding): every value of your item should equal the seeded item, and the
Verification tab should show 96 / 96 ok.

---

---

## Test 3 — your own example (user, 2026-11-03)

Build a plan of your own and check what the book examples do not cover. Things worth trying:
- the editor: lock grid lines, pick outline corners on the plan (⌖ / +⌖), collapse sections, Delete a corner;
- TD load lines on **Auto** (does the card name the right grid and side?) and **Set by hand**;
- **No seismic load / No wind load** on the Setup pages;
- with a Shear Wall Design item linked: an offset line on Setup → Shear wall link, and two SWD lines on one grid
  ("E 4-7", "E 8-9") — check the lengths, the walls on the plan and the line forces SWD receives;
- the Checks tab (closure 30 lb / 5 %), the Analysis tab "Closure solver" table, View 4 member diagrams.

Note in the log anything unexpected, any value you cannot explain, and anything you had to guess.

## Test 4 — the ADU (project 26999 Cotoros ADU Test, user 2026-11-03)
Frozen in `tests/fixtures/da-user/` and checked by `tests/diaphragmAnalysisUser.test.mjs`.
| Item / case | Expected (td-v10; td-v11 where noted) |
|---|---|
| Roof, loads as first saved (−y with +y, +x with −x) | error "act in opposite directions — they would cancel" |
| Roof N-S, TD1 on 6 / 1.7, load lines Auto | 5 (−) and 5.5 (+) found; 22 / 22 runs close |
| Roof E-W, TD2 with load lines 4, 5 (both), 5.5 | runs (superposed from 3 runs); balances 16,740 lb |
| Roof E-W, TD2 on wall lines 5 / 2 (y 5–29) | SW-8 / SW-10 / SW-6 = 1312 / 7073 / 8355 lb; O / B open (overhang steps, open item) — td-v11: FAILED, E-W line forces held from SWD |
| Roof as saved 2026-11-04 (TD2 on 5 / 2, overhang 0–5, loads 4 / 5 / 5.5), td-v11 | on open: overhang shown as "from 5 to 6"; error: TD2 runs past support 2 (y 29–32) |
| … TD2 drawn y 0–29, or a second overhang "from 2 to 1.7" | runs (3 runs: back span / on a support / overhang); every run closes; SW-8 / SW-10 / SW-6 = 4888 / 3945 / 7908 lb; TD2 forces 2 / 5 = −283 / −2334 lb |
| 2nd floor as saved (one D1 on 5 / 2) | warning: SW-9 on line 4 inside D1 takes no force |
| 2nd floor with offset line 4/5 | error: no strut connects lines 4 and 5 |
| 2nd floor case D (D1 3–13 on 4/2, D2 13–22 on 3.8/2, D3 22–35 on 5/2; TD1 = D1, TD2 = D3; Auto) | 17 / 17 close; SW-9 / SW-11 / SW-7 = 1671 / 2244 / 4345 lb |

## Log (fill in while testing)

| # | Where (tab / tool) | What happened | Expected | Severity (blocker / annoying / cosmetic) |
|---|---|---|---|---|
| 1 | | | | |
