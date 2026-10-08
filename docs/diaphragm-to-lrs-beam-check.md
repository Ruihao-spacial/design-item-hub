# Diaphragm to LRS — hand back-check of the beam solver (`solveBeam`)

Cases **B01–B19**. The hand calcs were written by hand **before** the tool was run. The tool values were pasted
in afterwards from `npm run dlrs:cases:check`.

**Why.** The tool computes every reaction with one lever rule (`solveBeam`, `src/modules/diaphragmToLrsCalc.js`):
R1 = W·(x₂ − x̄)/l and R2 = W·(x̄ − x₁)/l, applied to every uniform piece and point load. This document checks
that rule by hand on every loading condition the tool accepts, using two other methods.

**Result.** All 60 values in 19 cases match: Method 1 = Method 2 = tool within ± 0.0005 k. Tool values: engine calc v1, run 2026-10-08 (`npm run dlrs:cases:check`).

## Sign convention

- **Position x** is measured from the left end of the diaphragm (ft).
- **Supports.** R1 is the left support at x₁ and R2 the right support at x₂ (x₁ < x₂). A support that is not
  at an end makes an overhang.
- **Loads** act in the load direction and are positive.
- **Reactions** are positive when they resist the load. A **negative** reaction **reverses**: it pulls on the
  wall line.

## Variables

| Symbol | Meaning | Unit |
|---|---|---|
| L | diaphragm length | ft |
| x₁, x₂ | positions of supports R1, R2 | ft |
| l = x₂ − x₁ | back span (distance between the supports) | ft |
| q | area load = F_x / ΣA; q = 0.01 k/sf in every case | k/sf |
| d | depth of a part (perpendicular to the beam) | ft |
| w = q·d | line load of a part (shown in plf, calculated in k/ft) | k/ft |
| a, b, c | back-span formulas: unloaded length from R1, loaded length, unloaded length to R2 (a + b + c = l) | ft |
| W = w × loaded length | resultant of a uniform piece | k |
| x̄ | position of W (the middle of the loaded piece) | ft |
| e | distance from the nearer support to a load on the overhang | ft |
| P, x_P | point load and its position | k, ft |
| R1, R2 | reactions at the supports | k |

## Methods used (each case uses both)

**Method 1 — published beam formulas (superposition).** The formulas are as printed in standard beam tables
(e.g. AISC Manual Table 3-23).
- **Simple span, full uniform:** R1 = R2 = w·l/2.
- **Simple span, partial uniform (a / b / c):** R1 = w·b(2c + b)/(2l), R2 = w·b(2a + b)/(2l).
- **Simple span, point load (a / b measured from R1 / R2):** R1 = P·b/l, R2 = P·a/l.
- **Overhang, any load F (uniform resultant W, or a point load P) at distance e past a support:**
  - far support: −F·e/l;
  - near support: F·(l + e)/l.

  Whole-overhang uniform (overhang length a) is a special case: −w·a²/(2l) and w·a(2l + a)/(2l).
  - **Where a uniform load crosses a support:** it is split into the piece in the span and the piece on the
    overhang.
- **Reactions** are the sums of the reactions of the individual loads.

**Method 2 — free body.** Each uniform piece is replaced by its resultant W at x̄. Then:
- ΣM = 0 about R1 gives R2 = Σ F·(x_F − x₁) / l;
- ΣF = 0 gives R1 = ΣF − R2.

This uses different equations from the tool, which computes R1 and R2 independently from two moment equations.

**Tool.** Each case is an app item (one level "Roof", direction E-W). R1 goes to line A and R2 to line B.
- q = 0.01 k/sf, so F_x = 0.01 × ΣA and w (plf) = 10 × d (ft).
- Point loads are entered as manual point loads.
- A case with point loads only gets a separate **area carrier R.D2** (L 10 ft, d 10 ft, on lines C / D) so the
  level has an area (check D8). R.D2 does not touch R.D1. Its reactions (0.5000 k each end) are not part of the
  check.
- The same beam is also run straight through `solveBeam` in `tests/diaphragmToLrsBeamCheck.test.mjs`.

Tolerance ± 0.0005 k. Hand values to 4 decimals.

---

## B01 — Full uniform, simple span

```
      w = 200 plf (d 20)
  ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
  ══════════════════════
  △R1                 △R2
  x=0                 x=20
```
**Given:**
- L = 20, x₁ = 0, x₂ = 20, so l = 20 ft.
- One part, a 0, b 20, d 20, so w = 0.200 k/ft.
- ΣA = 400 sf, F_x = 4.0 k.

**Method 1:** R1 = R2 = w·l/2 = 0.200 × 20 / 2 = **2.0000 k**.

**Method 2:**
- W = 0.200 × 20 = 4.000 k at x̄ = 10.
- R2 = 4.000 × (10 − 0) / 20 = **2.0000 k**.
- R1 = 4.000 − 2.0000 = **2.0000 k**.

**Agreement:** the two methods agree.

| Value | Hand | Tool | Diff | |
|---|---|---|---|---|
| R1 (k) | 2.0000 | 2.0000 | 0.0000 | OK |
| R2 (k) | 2.0000 | 2.0000 | 0.0000 | OK |

## B02 — Partial uniform at the left end

```
   w = 150 plf
  ▼▼▼▼▼▼▼▼
  ══════════════════════
  △R1                 △R2
  0      8            20
```
**Given:**
- L = 20, l = 20.
- One part, a 0, b 8, d 15, so w = 0.150 k/ft and c = 20 − 0 − 8 = 12.
- ΣA = 120 sf, F_x = 1.2 k.

**Method 1 (partial uniform):**
- R1 = w·b(2c + b)/(2l) = 0.150 × 8 × (24 + 8) / 40 = 1.200 × 32 / 40 = **0.9600 k**.
- R2 = w·b(2a + b)/(2l) = 0.150 × 8 × (0 + 8) / 40 = 1.200 × 8 / 40 = **0.2400 k**.

**Method 2:**
- W = 1.200 k at x̄ = 4.
- R2 = 1.200 × 4 / 20 = **0.2400 k**.
- R1 = 1.200 − 0.2400 = **0.9600 k**.

**Agreement:** the two methods agree.

| Value | Hand | Tool | Diff | |
|---|---|---|---|---|
| R1 (k) | 0.9600 | 0.9600 | 0.0000 | OK |
| R2 (k) | 0.2400 | 0.2400 | 0.0000 | OK |

## B03 — Partial uniform inside the span

```
           w = 100 plf
      ▼▼▼▼▼▼▼▼▼▼
  ══════════════════════
  △R1                 △R2
  0   4         14    20
```
**Given:**
- L = 20, l = 20.
- One part, a 4, b 10, d 10, so w = 0.100 k/ft and c = 6.
- ΣA = 100 sf, F_x = 1.0 k.

**Method 1:**
- R1 = 0.100 × 10 × (12 + 10) / 40 = 1.000 × 22 / 40 = **0.5500 k**.
- R2 = 0.100 × 10 × (8 + 10) / 40 = 1.000 × 18 / 40 = **0.4500 k**.

**Method 2:**
- W = 1.000 k at x̄ = 9.
- R2 = 1.000 × 9 / 20 = **0.4500 k**.
- R1 = 1.000 − 0.4500 = **0.5500 k**.

**Agreement:** the two methods agree.

| Value | Hand | Tool | Diff | |
|---|---|---|---|---|
| R1 (k) | 0.5500 | 0.5500 | 0.0000 | OK |
| R2 (k) | 0.4500 | 0.4500 | 0.0000 | OK |

## B04 — Partial uniform at the right end

```
                 w = 250 plf
              ▼▼▼▼▼▼▼▼
  ══════════════════════
  △R1                 △R2
  0           12      20
```
**Given:**
- L = 20, l = 20.
- One part, a 12, b 8, d 25, so w = 0.250 k/ft and c = 0.
- ΣA = 200 sf, F_x = 2.0 k.

**Method 1:**
- R1 = 0.250 × 8 × (0 + 8) / 40 = 2.000 × 8 / 40 = **0.4000 k**.
- R2 = 0.250 × 8 × (24 + 8) / 40 = 2.000 × 32 / 40 = **1.6000 k**.

**Method 2:**
- W = 2.000 k at x̄ = 16.
- R2 = 2.000 × 16 / 20 = **1.6000 k**.
- R1 = 2.000 − 1.6000 = **0.4000 k**.

**Agreement:** the two methods agree.

| Value | Hand | Tool | Diff | |
|---|---|---|---|---|
| R1 (k) | 0.4000 | 0.4000 | 0.0000 | OK |
| R2 (k) | 1.6000 | 1.6000 | 0.0000 | OK |

## B05 — Stepped depth: three parts across the span

```
   300 plf     200 plf     100 plf
  ▼▼▼▼▼▼    ▼▼▼▼▼▼▼▼    ▼▼▼▼▼▼
  ══════════════════════════
  △R1                     △R2
  0     6          14      20
```
**Given:**
- L = 20, l = 20.
- Parts:
  - part 1: 0–6, d 30, w 0.300;
  - part 2: 6–14, d 20, w 0.200;
  - part 3: 14–20, d 10, w 0.100.
- ΣA = 180 + 160 + 60 = 400 sf, F_x = 4.0 k.

**Method 1 (partial uniform for each part):**

| Part | a / b / c | W (k) | R1 = w·b(2c+b)/(2l) | R2 = w·b(2a+b)/(2l) |
|---|---|---|---|---|
| 1 | 0 / 6 / 14 | 1.800 | 1.800 × 34 / 40 = 1.5300 | 1.800 × 6 / 40 = 0.2700 |
| 2 | 6 / 8 / 6 | 1.600 | 1.600 × 20 / 40 = 0.8000 | 1.600 × 20 / 40 = 0.8000 |
| 3 | 14 / 6 / 0 | 0.600 | 0.600 × 6 / 40 = 0.0900 | 0.600 × 34 / 40 = 0.5100 |
| Σ | | 4.000 | **2.4200** | **1.5800** |

**Method 2:**
- ΣM about R1 = 1.800 × 3 + 1.600 × 10 + 0.600 × 17 = 5.4 + 16.0 + 10.2 = 31.6 k·ft.
- R2 = 31.6 / 20 = **1.5800 k**.
- R1 = 4.000 − 1.5800 = **2.4200 k**.

**Agreement:** the two methods agree.

| Value | Hand | Tool | Diff | |
|---|---|---|---|---|
| R1 (k) | 2.4200 | 2.4200 | 0.0000 | OK |
| R2 (k) | 1.5800 | 1.5800 | 0.0000 | OK |
| part 1 R1 (k) | 1.5300 | 1.5300 | 0.0000 | OK |
| part 3 R2 (k) | 0.5100 | 0.5100 | 0.0000 | OK |

## B06 — Overlapping (stacked) parts

```
            100 plf (part 2, 5–15)
       ▼▼▼▼▼▼▼▼▼▼
  ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼  100 plf (part 1, 0–20)
  ════════════════════
  △R1               △R2
```
**Given:**
- L = 20, l = 20.
- Parts:
  - part 1: 0–20, d 10, w 0.100;
  - part 2: 5–15, d 10, w 0.100 (on top of part 1).
- ΣA = 200 + 100 = 300 sf, F_x = 3.0 k.

**Method 1:**
- Part 1 (full uniform): R1 = R2 = 0.100 × 20 / 2 = 1.0000 k.
- Part 2 (partial uniform, a / b / c = 5 / 10 / 5): R1 = 1.000 × 20 / 40 = 0.5000 k and R2 = 1.000 × 20 / 40 = 0.5000 k.
- Totals: R1 = **1.5000 k**, R2 = **1.5000 k**.

**Method 2:**
- R2 = (2.000 × 10 + 1.000 × 10) / 20 = **1.5000 k**.
- R1 = 3.000 − 1.5000 = **1.5000 k**.

**Agreement:** the two methods agree.

| Value | Hand | Tool | Diff | |
|---|---|---|---|---|
| R1 (k) | 1.5000 | 1.5000 | 0.0000 | OK |
| R2 (k) | 1.5000 | 1.5000 | 0.0000 | OK |

## B07 — Point load at midspan

```
            P = 2 k
              ▼
  ════════════════════
  △R1               △R2
  0         10       20
```
**Given:** L = 20, l = 20; P 2.0 k at x = 10 (manual point load); no parts on R.D1 (area carrier R.D2).

**Method 1 (point load):** a = 10, b = 10, so R1 = P·b/l = 2.0 × 10 / 20 = **1.0000 k** and R2 = P·a/l = **1.0000 k**.

**Method 2:**
- R2 = 2.0 × 10 / 20 = **1.0000 k**.
- R1 = 2.0 − 1.0000 = **1.0000 k**.

**Agreement:** the two methods agree.

| Value | Hand | Tool | Diff | |
|---|---|---|---|---|
| R1 (k) | 1.0000 | 1.0000 | 0.0000 | OK |
| R2 (k) | 1.0000 | 1.0000 | 0.0000 | OK |

## B08 — Point load off-centre

```
      P = 1.5 k
        ▼
  ════════════════════
  △R1               △R2
  0     6            20
```
**Given:** L = 20, l = 20; P 1.5 k at x = 6; area carrier R.D2.

**Method 1:** a = 6, b = 14, so:
- R1 = 1.5 × 14 / 20 = 21 / 20 = **1.0500 k**.
- R2 = 1.5 × 6 / 20 = 9 / 20 = **0.4500 k**.

**Method 2:**
- R2 = 1.5 × 6 / 20 = **0.4500 k**.
- R1 = 1.5 − 0.4500 = **1.0500 k**.

**Agreement:** the two methods agree.

| Value | Hand | Tool | Diff | |
|---|---|---|---|---|
| R1 (k) | 1.0500 | 1.0500 | 0.0000 | OK |
| R2 (k) | 0.4500 | 0.4500 | 0.0000 | OK |

## B09 — Uniform plus two point loads

```
       1.2 k            0.7 k
         ▼                ▼
  ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼  w = 250 plf
  ══════════════════════════
  △R1                     △R2
  0      4           11    16
```
**Given:**
- L = 16, l = 16.
- One part, a 0, b 16, d 25, so w = 0.250 k/ft.
- P1 = 1.2 k at 4, P2 = 0.7 k at 11.
- ΣA = 400 sf, F_x = 4.0 k.

**Method 1:**

| Load | R1 | R2 |
|---|---|---|
| uniform, w·l/2 | 0.250 × 16 / 2 = 2.0000 | 2.0000 |
| P1 (a 4, b 12) | 1.2 × 12 / 16 = 0.9000 | 1.2 × 4 / 16 = 0.3000 |
| P2 (a 11, b 5) | 0.7 × 5 / 16 = 0.2188 (0.21875) | 0.7 × 11 / 16 = 0.4813 (0.48125) |
| Σ | **3.1188 (3.11875)** | **2.7813 (2.78125)** |

**Method 2:**
- ΣM about R1 = 4.000 × 8 + 1.2 × 4 + 0.7 × 11 = 32 + 4.8 + 7.7 = 44.5 k·ft.
- R2 = 44.5 / 16 = **2.78125 k**.
- R1 = (4.000 + 1.2 + 0.7) − 2.78125 = 5.9 − 2.78125 = **3.11875 k**.

**Agreement:** the two methods agree. Σ = 5.9 k = F_x 4.0 + ΣP 1.9.

| Value | Hand | Tool | Diff | |
|---|---|---|---|---|
| R1 (k) | 3.1188 | 3.1188 | 0.0000 | OK |
| R2 (k) | 2.7813 | 2.7813 | 0.0000 | OK |
| R1 from point loads (k) | 1.1188 | 1.1188 | 0.0001 | OK |
| R2 from uniform (k) | 2.0000 | 2.0000 | 0.0000 | OK |

**Note on the rounding.** The exact hand values are 3.11875, 2.78125 and 1.11875 k, and the case file compares
against these exact values. The tool stores forces to 4 decimals (1.1188), so the Diff column shows 0.0001,
which is the half-unit of rounding (0.00005). It is not a calculation difference. Run directly, `solveBeam`
returns 1.11875 exactly (`tests/diaphragmToLrsBeamCheck.test.mjs`).

## B10 — Point loads exactly at the supports

```
  P1 = 1 k              P2 = 1 k
  ▼                     ▼
  ══════════════════════
  △R1                 △R2
  0                    20
```
**Given:** L = 20, l = 20; P1 1.0 k at x = 0, P2 1.0 k at x = 20; area carrier R.D2.

**Method 1:**
- P1: a = 0, b = 20, so R1 = 1.0 × 20/20 = 1.0000 and R2 = 1.0 × 0/20 = 0.0000.
- P2: a = 20, b = 0, so R1 = 0.0000 and R2 = 1.0000.
- Totals: R1 = **1.0000 k**, R2 = **1.0000 k**.

**Method 2:**
- R2 = (1.0 × 0 + 1.0 × 20)/20 = **1.0000 k**.
- R1 = 2.0 − 1.0 = **1.0000 k**.

**Agreement:** the two methods agree. Each load goes straight into the support it sits on.

| Value | Hand | Tool | Diff | |
|---|---|---|---|---|
| R1 (k) | 1.0000 | 1.0000 | 0.0000 | OK |
| R2 (k) | 1.0000 | 1.0000 | 0.0000 | OK |
| P1 share to R2 (k) | 0.0000 | 0.0000 | 0.0000 | OK |
| P2 share to R1 (k) | 0.0000 | 0.0000 | 0.0000 | OK |

## B11 — Overhang on the right, full uniform (overhang one side)

```
        w = 200 plf
  ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
  ═════════════════════════
  △R1               △R2
  0                 20    25
```
**Given:**
- L = 25, x₁ = 0, x₂ = 20, so l = 20 and the overhang a = 5.
- One part, 0–25, d 20, so w = 0.200 k/ft.
- ΣA = 500 sf, F_x = 5.0 k.

**Method 1:**
- Closed form for an overhang on one side:
  - R1 = w(l² − a²)/(2l) = 0.200 × (400 − 25)/40 = 0.200 × 375/40 = **1.8750 k**.
  - R2 = w(l + a)²/(2l) = 0.200 × 625/40 = **3.1250 k**.
- Split at R2 (as the tool cuts it):
  - span 0–20: W 4.000, so 2.0000 / 2.0000;
  - overhang 20–25: W 1.000, e = 2.5, so R1 = −1.000 × 2.5/20 = −0.1250 and R2 = 1.000 × 22.5/20 = 1.1250.
  - Sum 1.8750 / 3.1250, the same as the closed form.

**Method 2:**
- W = 0.200 × 25 = 5.000 k at x̄ = 12.5.
- R2 = 5.000 × 12.5/20 = **3.1250 k**.
- R1 = 5.000 − 3.1250 = **1.8750 k**.

**Agreement:** the two methods agree.

| Value | Hand | Tool | Diff | |
|---|---|---|---|---|
| R1 (k) | 1.8750 | 1.8750 | 0.0000 | OK |
| R2 (k) | 3.1250 | 3.1250 | 0.0000 | OK |
| overhang piece R1 (k) | −0.1250 | −0.1250 | 0.0000 | OK |
| overhang piece R2 (k) | 1.1250 | 1.1250 | 0.0000 | OK |

## B12 — Uniform on the overhang only

```
                     w = 100 plf
                    ▼▼▼▼▼
  ═════════════════════════
  △R1               △R2
  0                 20    25
```
**Given:**
- L = 25, supports 0 / 20, overhang a = 5.
- One part, a 20, b 5, d 10, so w = 0.100 k/ft.
- ΣA = 50 sf, F_x = 0.5 k.

**Method 1 (whole-overhang uniform):**
- R1 = −w·a²/(2l) = −0.100 × 25/40 = **−0.0625 k** (reverses).
- R2 = w·a(2l + a)/(2l) = 0.100 × 5 × 45/40 = **0.5625 k**.

**Method 2:**
- W = 0.500 k at x̄ = 22.5.
- R2 = 0.500 × 22.5/20 = **0.5625 k**.
- R1 = 0.500 − 0.5625 = **−0.0625 k**.

**Agreement:** the two methods agree.

| Value | Hand | Tool | Diff | |
|---|---|---|---|---|
| R1 (k) | −0.0625 | −0.0625 | 0.0000 | OK |
| R2 (k) | 0.5625 | 0.5625 | 0.0000 | OK |
| R1 reverses | true | true |  | OK |

## B13 — Partial uniform on the overhang (touching neither the support nor the tip)

```
                       60 plf
                      ▼▼▼
  ═════════════════════════
  △R1               △R2
  0                 20 21  24 25
```
**Given:**
- L = 25, supports 0 / 20.
- One part, a 21, b 3, d 6, so w = 0.060 k/ft.
- ΣA = 18 sf, F_x = 0.18 k.

**Method 1 (load on the overhang):**
- W = 0.060 × 3 = 0.180 k at x̄ = 22.5, so e = 2.5 past R2.
- R1 = −W·e/l = −0.180 × 2.5/20 = **−0.0225 k**.
- R2 = W(l + e)/l = 0.180 × 22.5/20 = **0.2025 k**.

**Method 2:**
- R2 = 0.180 × 22.5/20 = **0.2025 k**.
- R1 = 0.180 − 0.2025 = **−0.0225 k**.

**Agreement:** the two methods agree.

| Value | Hand | Tool | Diff | |
|---|---|---|---|---|
| R1 (k) | −0.0225 | −0.0225 | 0.0000 | OK |
| R2 (k) | 0.2025 | 0.2025 | 0.0000 | OK |

## B14 — A part running over a support

```
                 w = 40 plf
              ▼▼▼▼▼▼▼▼▼▼▼
  ═════════════════════════
  △R1               △R2
  0           15    20    25
```
**Given:**
- L = 25, supports 0 / 20.
- One part, a 15, b 10, d 4, so w = 0.040 k/ft (15–25, over R2).
- ΣA = 40 sf, F_x = 0.4 k.

**Method 1 (cut at R2):**
- Span piece 15–20 (partial uniform, a / b / c = 15 / 5 / 0, W 0.200):
  - R1 = 0.200 × (0 + 5)/40 = 0.0250;
  - R2 = 0.200 × (30 + 5)/40 = 0.1750.
- Overhang piece 20–25 (W 0.200, e 2.5):
  - R1 = −0.200 × 2.5/20 = −0.0250;
  - R2 = 0.200 × 22.5/20 = 0.2250.
- Totals: R1 = **0.0000 k**, R2 = **0.4000 k**.

**Method 2:**
- The whole part is W = 0.400 k at x̄ = 20, right on R2.
- R2 = 0.400 × 20/20 = **0.4000 k**.
- R1 = **0.0000 k**.

**Agreement:** the two methods agree.

| Value | Hand | Tool | Diff | |
|---|---|---|---|---|
| R1 (k) | 0.0000 | 0.0000 | 0.0000 | OK |
| R2 (k) | 0.4000 | 0.4000 | 0.0000 | OK |
| span piece R2 (k) | 0.1750 | 0.1750 | 0.0000 | OK |
| overhang piece R1 (k) | −0.0250 | −0.0250 | 0.0000 | OK |

## B15 — Overhang on the left (mirror of B11)

```
        w = 200 plf
  ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
  ═════════════════════════
        △R1               △R2
  0     5                 25
```
**Given:**
- L = 25, x₁ = 5, x₂ = 25, so l = 20 and the left overhang is 5.
- w = 0.200 k/ft over 0–25.
- ΣA = 500 sf, F_x = 5.0 k.

**Method 1:**
- Left overhang 0–5 (W 1.000, e 2.5 past R1): R1 = 1.000 × 22.5/20 = 1.1250 and R2 = −1.000 × 2.5/20 = −0.1250.
- Span 5–25: 2.0000 / 2.0000.
- Totals: R1 = **3.1250 k**, R2 = **1.8750 k**. These are B11 with R1 and R2 swapped.

**Method 2:**
- W = 5.000 k at x̄ = 12.5.
- R2 = 5.000 × (12.5 − 5)/20 = 37.5/20 = **1.8750 k**.
- R1 = 5.000 − 1.8750 = **3.1250 k**.

**Agreement:** the two methods agree.

| Value | Hand | Tool | Diff | |
|---|---|---|---|---|
| R1 (k) | 3.1250 | 3.1250 | 0.0000 | OK |
| R2 (k) | 1.8750 | 1.8750 | 0.0000 | OK |
| left overhang piece R2 (k) | −0.1250 | −0.1250 | 0.0000 | OK |

## B16 — Point loads on the overhang: at the tip and inside it

```
                       0.5 k  1 k
                         ▼     ▼
  ═════════════════════════
  △R1               △R2
  0                 20   22   25
```
**Given:** L = 25, supports 0 / 20; P1 1.0 k at 25 (tip, e = 5), P2 0.5 k at 22 (e = 2); area carrier R.D2.

**Method 1 (load on the overhang):**
- P1: R1 = −1.0 × 5/20 = −0.2500 and R2 = 1.0 × 25/20 = 1.2500.
- P2: R1 = −0.5 × 2/20 = −0.0500 and R2 = 0.5 × 22/20 = 0.5500.
- Totals: R1 = **−0.3000 k** (reverses), R2 = **1.8000 k**.

**Method 2:**
- R2 = (1.0 × 25 + 0.5 × 22)/20 = 36/20 = **1.8000 k**.
- R1 = 1.5 − 1.8 = **−0.3000 k**.

**Agreement:** the two methods agree.

| Value | Hand | Tool | Diff | |
|---|---|---|---|---|
| R1 (k) | −0.3000 | −0.3000 | 0.0000 | OK |
| R2 (k) | 1.8000 | 1.8000 | 0.0000 | OK |
| P1 (tip) share to R1 (k) | −0.2500 | −0.2500 | 0.0000 | OK |
| line A force (k) | −0.3000 | −0.3000 | 0.0000 | OK |

## B17 — Overhangs on both sides, R1 reverses

```
               w = 100 plf
  ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
  ══════════════════════════════
      △R1     △R2
  0   4       12                30
```
**Given:**
- L = 30, x₁ = 4, x₂ = 12, so l = 8. The overhangs are 4 ft on the left and 18 ft on the right.
- w = 0.100 k/ft over 0–30.
- ΣA = 300 sf, F_x = 3.0 k.

**Method 1:**

| Piece | W (k) | e | R1 | R2 |
|---|---|---|---|---|
| left overhang 0–4 | 0.400 | 2 past R1 | 0.400 × 10/8 = 0.5000 | −0.400 × 2/8 = −0.1000 |
| span 4–12 | 0.800 | — | 0.4000 | 0.4000 |
| right overhang 12–30 | 1.800 | 9 past R2 | −1.800 × 9/8 = −2.0250 | 1.800 × 17/8 = 3.8250 |
| Σ | 3.000 | | **−1.1250** | **4.1250** |

**Method 2:**
- W = 3.000 k at x̄ = 15.
- R2 = 3.000 × (15 − 4)/8 = 33/8 = **4.1250 k**.
- R1 = 3.000 − 4.1250 = **−1.1250 k**.

**Agreement:** the two methods agree.

| Value | Hand | Tool | Diff | |
|---|---|---|---|---|
| R1 (k) | −1.1250 | −1.1250 | 0.0000 | OK |
| R2 (k) | 4.1250 | 4.1250 | 0.0000 | OK |
| right overhang piece R1 (k) | −2.0250 | −2.0250 | 0.0000 | OK |
| R1 reverses | true | true |  | OK |

## B18 — Point loads exactly at the supports when both sides overhang

```
       1 k             1 k
        ▼               ▼
  ═════════════════════════
        △R1             △R2
  0     5               20  25
```
**Given:** L = 25, x₁ = 5, x₂ = 20, so l = 15; P1 1.0 k at 5 (on R1), P2 1.0 k at 20 (on R2); area carrier R.D2.

**Method 1:**
- P1: a = 0, b = 15, so R1 = 1.0000 and R2 = 0.0000.
- P2: a = 15, b = 0, so R1 = 0.0000 and R2 = 1.0000.
- Neither load is on an overhang.
- Totals: R1 = **1.0000 k**, R2 = **1.0000 k**.

**Method 2:**
- R2 = (1.0 × 0 + 1.0 × 15)/15 = **1.0000 k**.
- R1 = 2.0 − 1.0 = **1.0000 k**.

**Agreement:** the two methods agree.

| Value | Hand | Tool | Diff | |
|---|---|---|---|---|
| R1 (k) | 1.0000 | 1.0000 | 0.0000 | OK |
| R2 (k) | 1.0000 | 1.0000 | 0.0000 | OK |
| P2 share to R1 (k) | 0.0000 | 0.0000 | 0.0000 | OK |

## B19 — Everything combined

```
             1.0 k     0.6 k                 0.8 k
               ▼         ▼                     ▼
          ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼ 200 plf (8–18)
                            ▼▼▼▼▼▼▼▼ 50 plf (20–28)
  ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼ 100 plf (0–30)
  ══════════════════════════════
      △R1                  △R2
  0   4    8  10   16 18 20 24  28 30
```
**Given:**
- L = 30, x₁ = 4, x₂ = 24, so l = 20. The overhangs are 4 ft on the left and 6 ft on the right.
- Parts:
  - part 1: 0–30, d 10, w 0.100;
  - part 2: 8–18, d 20, w 0.200;
  - part 3: 20–28, d 5, w 0.050 (over R2).
- Point loads: P1 1.0 k at 10, P2 0.6 k at 16, P3 0.8 k at 30 (the tip).
- ΣA = 300 + 200 + 40 = 540 sf, F_x = 5.4 k.

**Method 1 (superposition of every single load):**

| Load / piece | W or P (k) | Formula | R1 | R2 |
|---|---|---|---|---|
| part 1 left overhang 0–4 | 0.400 | e 2: W(l+e)/l, −W·e/l | 0.400 × 22/20 = 0.4400 | −0.400 × 2/20 = −0.0400 |
| part 1 span 4–24 | 2.000 | w·l/2 | 1.0000 | 1.0000 |
| part 1 right overhang 24–30 | 0.600 | e 3: −W·e/l, W(l+e)/l | −0.600 × 3/20 = −0.0900 | 0.600 × 23/20 = 0.6900 |
| part 2 span 8–18 | 2.000 | partial uniform, a / b / c = 4 / 10 / 6 | 2.000 × 22/40 = 1.1000 | 2.000 × 18/40 = 0.9000 |
| part 3 span 20–24 | 0.200 | partial uniform, a / b / c = 16 / 4 / 0 | 0.200 × 4/40 = 0.0200 | 0.200 × 36/40 = 0.1800 |
| part 3 overhang 24–28 | 0.200 | e 2 | −0.200 × 2/20 = −0.0200 | 0.200 × 22/20 = 0.2200 |
| P1 @ 10 | 1.000 | a 6, b 14 | 1.0 × 14/20 = 0.7000 | 1.0 × 6/20 = 0.3000 |
| P2 @ 16 | 0.600 | a 12, b 8 | 0.6 × 8/20 = 0.2400 | 0.6 × 12/20 = 0.3600 |
| P3 @ 30 (tip) | 0.800 | e 6 | −0.8 × 6/20 = −0.2400 | 0.8 × 26/20 = 1.0400 |
| **Σ** | 7.800 | | **3.1500** | **4.6500** |

Subtotals:
- From uniform loads: R1 = 0.44 + 1.00 − 0.09 + 1.10 + 0.02 − 0.02 = **2.4500**, R2 = **2.9500**.
- From point loads: R1 = **0.7000**, R2 = **1.7000**.

**Method 2:**
- Moments about R1 (x = 4), using the whole parts as resultants:

| Load | F (k) | x_F | arm x_F − 4 | F × arm |
|---|---|---|---|---|
| part 1 | 3.000 | 15 | 11 | 33.0 |
| part 2 | 2.000 | 13 | 9 | 18.0 |
| part 3 | 0.400 | 24 | 20 | 8.0 |
| P1 | 1.000 | 10 | 6 | 6.0 |
| P2 | 0.600 | 16 | 12 | 7.2 |
| P3 | 0.800 | 30 | 26 | 20.8 |
| Σ | 7.800 | | | 93.0 |

- R2 = 93.0/20 = **4.6500 k**.
- R1 = 7.800 − 4.6500 = **3.1500 k**.

**Agreement:** the two methods agree. ΣR = 7.8 = ΣW 5.4 + ΣP 2.4.

| Value | Hand | Tool | Diff | |
|---|---|---|---|---|
| R1 (k) | 3.1500 | 3.1500 | 0.0000 | OK |
| R2 (k) | 4.6500 | 4.6500 | 0.0000 | OK |
| R1 from uniform (k) | 2.4500 | 2.4500 | 0.0000 | OK |
| R2 from uniform (k) | 2.9500 | 2.9500 | 0.0000 | OK |
| R1 from point loads (k) | 0.7000 | 0.7000 | 0.0000 | OK |
| R2 from point loads (k) | 1.7000 | 1.7000 | 0.0000 | OK |
| number of rows (6 pieces + 3 points) | 9 | 9.0000 | 0.0000 | OK |
