# Diaphragm Analysis — opening study (G3 / G4), 2026-11-02

Why: at an opening the visual shear-transfer method (EX-IRREG-2E) needs one assumed constant per band — where an
opening-edge member carries zero (G3), and the force of a chord cut inside the opening stretch (G4). The book itself
says no breakdown is more correct than another (Ex 8.1 p35). This study compares the rules with a stiffness reference
to choose the tool's defaults. Decisions (user, 2026-11-02): **G4 default = section M/H at the cut** (Vierendeel as an
override); **G3 = automatic rule** (zero-shear point when a band's shear changes sign inside the opening, else the
inflection point) **plus a warning** that opening-edge collector forces depend on stiffness.

## Reference model (scripts/study/sp.py)
Stringer-panel stiffness model (Blaauwendraad / Hoogenboom): each panel one uniform shear flow q = 12000·Ga·γ; stringers
carry axial force varying linearly (element K = EA/L [[4,2,−6],[2,4,−6],[−6,−6,12]] on end and mean displacements).
Idealisation kept the same as the visual method, so only compatibility is added:
- sheathing carries shear only (auxiliary stringers on a 2.5 ft mesh, EA ≈ 0 in both directions);
- members exactly as designed: outline and opening edges (chords), TD edges, each TD load line across its TD, wall
  lines (collectors) — nothing else;
- load per section by band as in the tool's basic field (windward / leeward to the band on that face, else by depth),
  spread over the band depth;
- walls as springs proportional to length (walls of one collector line share by length, as in the book).
Defaults: Ga = 20 kips/in, chord / member EA = 1.68e7 lb (double 2×4 DF); sensitivity Ga 10–400, EA ×0.5–×4.

## Validation (scripts/study/calibrate.py)
- Regular rectangle: chords exactly M/d, shear exactly V/d across the depth.
- Determinate book examples (notches, no opening): reference = book within about 1–2 % — Ex 3.5 (0.1–2.2 %),
  Ex 4.1 (≤ 0.5 %), Ex 4.3 TD members (≤ 2.5 %). Section equilibrium through an opening checks exactly (ΣN = 0,
  −ΣN·y = M).
- So where the reference differs from the book, it is compatibility the visual method cannot see.

## G4 — chord cut inside an opening stretch (scripts/study/family*.{py,mjs})
Nine layouts: span 120 × 50, opening 25 × 15 (y 30–45) starting at x = 15 (near the support), 40 (quarter span) or
47.5 (centred, V = 0 at mid-span); bottom chord notched under the opening, cut at 10 / 40 / 60 % of the opening; TDs
left, right and under the opening (as Ex 8.1). Force in the cut chord at the cut:

| Layout | Vierendeel (from mid-opening) | Section M/H | Reference (Ga 10–40, EA ×1–×4) |
|---|---|---|---|
| near support, cut 10 % | 2945 (−28 %) | 4484 (+9 %) | 4027–4153 |
| near support, 40 % | 4605 (−27 %) | 5938 (−6 %) | 6229–6348 |
| quarter span, 10 % | 6373 (−25 %) | 8234 (−3 %) | 8333–8608 |
| quarter span, 40 % | 6962 (−24 %) | 8750 (−5 %) | 9007–9252 |
| centred, 10 % | 6914 (−25 %) | 8750 (−5 %) | 9004–9303 |
| centred, 40 % | 7182 (−24 %) | 8984 (−5 %) | 9229–9492 |
| cut past the inflection (60 %) | both rules equal: −4 % … −1 % | | |

The section rule is close and stable; Vierendeel is unconservative by about a quarter. Percentages vs the Ga 20 / EA ×1
reference.

## G3 — opening-edge members (A.2 above, B below the opening) at the opening ends
| Layout | A.2 at the TD1 end: inflection / zero-shear / reference range |
|---|---|
| near support | −2775 / −2775 / −4246 … −2554 |
| quarter span | −989 / −1150 / −3027 … −510 |
| centred | −454 / −454 / −2495 … +93 |

The reference range is wide: these forces depend on the panel-to-chord stiffness ratio (Ex 5.1 likewise: the book's
zero at mid-opening matches only stiff chords on flexible sheathing, Ga 10 / EA ×4). The two rules differ by less than
about 170 lb, and both sit at the low end of the range — hence the warning.

## Book examples against the reference (Ga 20, EA ×1)
- Ex 5.1 (opening, Vierendeel in the book): opening members within 3–35 %, stiffness dependent (see sens.py).
- Ex 8.1 Diaphragm 1: large differences around the opening (the A.2 split reverses: +952 T at grid 3 vs the book's
  −2043 C). Cause: the opening collectors (G3), not the cut-chord rule.

## Running
From `scripts/study`: `python calibrate.py 24000` (book / tool / reference per member force), `python sens.py`
(stiffness sensitivity), `python family.py && node family_tool.mjs && python family_ref.py && node g3.mjs` (G3 / G4
family). Needs numpy. Study code only; not used by the tool.
