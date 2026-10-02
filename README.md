# Engineer service calculator

Shared structural-engineering calculation tool, organized by project number. Each project holds multiple design-item calculations. Real-time shared data across the team via Supabase, deployed on Railway.

## Production

- **Application**: https://engineer-service-calculator-production.up.railway.app
- **Access**: invite-only Supabase email/password authentication
- **Runtime**: Railway with Railpack; Supabase provides Postgres, Auth, Realtime, and Storage
- **Administration**: in-app user creation, admin/member roles, deactivation, and an immutable work history

## Stack

- **Frontend**: Vanilla JS + Vite (no framework — keeps each design-item module a self-contained file)
- **Database + Auth**: Supabase (Postgres, Row Level Security, email/password auth, Realtime, Storage)
- **Hosting**: Railway (auto-deploys from this GitHub repo)
- **PDF export**: jsPDF (client-side)

## Modules

| Module | Files | Description |
|--------|-------|-------------|
| Flat Load Calculator | `flatLoadCalculator.js`, `flatLoadMaterials.js` | Dead/live load assembly builder with material library |
| Seismic Mass Takeoff | `seismicMassTakeoff.js` | Per-level seismic weight from Flat Load assemblies |
| Seismic Base Shear | `seismicBaseShear.js`, `seismicBaseShearTables.js` | ASCE 7-22 Cs calculator with seismic system dropdown |
| ELF Diaphragm & Collector | `elfDiaphragmCollector.js` | ASCE 7-22 §12.8/12.10 lateral force distribution |
| Shear Wall Design | `shearWallDesign.js`, `shearWallCalc.js`, `shearWallLoadPath.js`, `shearWallElevation.js`, `shearWallTypes.js`, `shearWallNailing.js`, `shearWallHardware.js`, `shearWallOpenings.js`, `shearWallFtao.js`, `shearWallFtaoAdapter.js`, `shearWallDeflection.js`, `shearWallCombos.js`, `shearWallGravity.js`, `shearWallWswh.js`, `shearWallWswhData.js`, `shearWallChecks.js`, `shearWallCalcSheet.js` | Multi-story shear wall analysis: nailing/hardware auto-select (HDUE minimum post), vertical load path through wall ends, posts at any story and transfer beams with user-defined supports (gravity on top carried down; support posts sized for max(ASD, Ω₀ ASD)), segmented walls (solid, full height — no openings) and FTAO walls with openings (APA T555), Simpson Strong-Wall WSWH panels (concrete / raised floor / two-story stacked, Table 06 anchors), gravity loads D / L / Lr (point, full-line or partial uniform; plf or psf × trib; Flat Load link), every ASCE 7-22 ASD / LRFD / Ω₀ combination (ASD designs; LRFD and Ω₀ reported), SDPWS 2021 deflection and story drift (auto nailing raised for drift, bypass per project / line), built-in equilibrium checks G1–G12, deflection distribution by equal δ (zero-share wall: holdown check + under-load warning, "Engineer reviewed — OK" per warning), wind drift vs h/n (report only), load cases + numbered combinations LC# (referred to by LC# everywhere), line results tabs Walls · Distribution · Posts & Beams · Drift · Forces · Checks (Summary / Detailed calc sheet per wall — one content list `wallSheetBlocks` drawn on screen and printed in the PDF), interactive SVG elevation (one shared drawing `drawElevationScene` for the tool and the PDF; Wall HW row under each wall; "(both)" / L: R: on narrow walls), PDF organised per wall line (Summary / Detailed; landscape elevations at a standard scale, end forces + hardware) |

**Cross-module data flow:** Flat Load Calculator → Seismic Mass Takeoff (per-assembly DL) → ELF (W, per-level). Seismic Base Shear → ELF (Cs, SDS, Ie, Ω0, k auto-fill via ref). Seismic Base Shear → Shear Wall Design (Sds, Cd, Ie, Risk Category for drift; Ω₀; SDC for WSWH anchors). Flat Load Calculator → Shear Wall Design (assembly psf × trib for uniform gravity rows).

## Project structure

```
src/
  main.js                  — entry point
  app.js                   — router / app shell / auth state
  auth.js                  — Supabase auth wrappers
  admin.js                 — admin-only Edge Function client
  db.js                    — all Supabase database queries
  pdf.js                   — PDF calc-sheet generation
  supabaseClient.js        — Supabase client init
  styles.css               — design tokens + all component styles
  utils.js                 — DOM helper (el), formatting, toasts
  modules/
    registry.js            — DESIGN_ITEM_MODULES array — register new modules here
    flatLoadCalculator.js  — dead/live load assembly builder
    flatLoadMaterials.js   — material library data for flat load calc
    seismicMassTakeoff.js  — per-level seismic weight takeoff
    seismicBaseShear.js    — ASCE 7-22 Cs calculator
    seismicBaseShearTables.js — Fa/Fv/TL lookup tables
    elfDiaphragmCollector.js  — ELF lateral force distribution
    shearWallDesign.js     — shear wall module UI + PDF
    shearWallCalc.js       — shear wall calc engine (distribution, T/C per combo, CALC_VERSION)
    shearWallLoadPath.js   — vertical load path: wall ends, posts, transfer beams, audit
    shearWallElevation.js  — elevation: one shared scene (drawElevationScene) drawn by the interactive tool and the PDF
    shearWallTypes.js      — data model constructors + helpers
    shearWallNailing.js    — SDPWS 4.3A nailing table + auto-select
    shearWallHardware.js   — holdown/strap/FTAO strap catalogs + post design
    shearWallOpenings.js   — FTAO wall openings: geometry checks and piers (segmented walls have no openings)
    shearWallFtao.js       — FTAO engine (vendored from the ftao-shear-wall skill, APA T555)
    shearWallFtaoAdapter.js — builds FTAO engine input from a wall and runs it
    shearWallDeflection.js — SDPWS Eq. 4.3-1 deflection, ASCE 7 drift limits
    shearWallCombos.js     — ASCE 7-22 load combinations (factors on D / L / Lr / E / W; design vs reported groups)
    shearWallGravity.js    — gravity load rows (point / full / partial, psf × trib), statics to wall ends, loads to beams / posts
    shearWallWswh.js       — Simpson Strong-Wall WSWH lookup, stacked base check, Table 06 anchors
    shearWallWswhData.js   — WSWH tables, GENERATED by scripts/buildWswhData.mjs from the Shared Drive WSWH md tables
    shearWallChecks.js     — built-in equilibrium checks G1–G12 (story shear, gravity, statics, transfer, global, superposition)
    shearWallCalcSheet.js  — row builders of the per-wall calc sheet (definition, capacity, overturning per corner, load-case end forces, superposition, M_R / beam lever tables, deflection substitution, from-above references)
    shearWallVerify.js     — verification cases: resolve expected values in the results, compare, check status (runner, catalog, Verification tab)
  richText.js              — subscript markup X_{ab} (and X_ab in headers): DOM <sub> for the app, runs for the PDF
  views/
    login.js
    projectPicker.js
    projectDetail.js
    itemForm.js
    userManagement.js
    activityLog.js
scripts/
  upgradeShearWallItems.mjs — bulk-upgrade saved shear wall items (dry run by default)
  lib/shearWallLoadCheck.mjs — "does this saved item open?" check shared with the tests
  buildWswhData.mjs         — regenerate shearWallWswhData.js: node scripts/buildWswhData.mjs "<WSWH reference folder>"
  casesDoc.mjs              — generate docs/shear-wall-test-cases.md (the verification case catalog)
  seedCases.mjs             — put the verification cases into the local project SW-VERIFY (dry run by default)
tests/
  shearWall.test.mjs       — shear wall calc + regression + legacy-definition checks (npm test)
  shearWallPhase4.test.mjs — openings (segmented / FTAO), deflection & drift, LRFD, schema v6
  shearWallRound2.test.mjs — HDUE minimum post, Ω₀ combos, dead load by statics, WSWH, schema v7
  shearWallLiveLoad.test.mjs — D / L / Lr loads, ASCE 7-22 combos, beam / post gravity, Flat Load link, Distribution tab, reports, schema v8
  shearWallChecks.test.mjs — G1–G12 on every fixture; tampered results prove each check fires
  shearWallDrift.test.mjs  — drift sizing, sheathing governed by, drift bypass, schema v9
  shearWallCalcSheet.test.mjs — calc sheet tabs and sections; C3 / C4 / C5 agree with the tool on every fixture; S0–S7 breakdowns
  shearWallCases.test.mjs  — METHOD verification cases (design pinned): checks, hand-calc values, method agreement, render, goldens, guard (no selection outcomes)
  shearWallRules.test.mjs  — design SELECTION rules R1–R6, R8 and R9 as properties on every model (lightest nailing / HD / strap, posts ≥ minimum, overrides kept, support posts, WSWH anchors, equal-δ deflection distribution, engineer review of distribution warnings)
  shearWallReport.test.mjs — UI / report: subscripts, LC numbering, linked gravity (lateral DL, greyed out), tab order, schedules, Forces tab, PDF per wall line, wind drift limit, elevation scale / parts / notes, FTAO strap on the hardware elevation only; tool and PDF draw the same elevation (same labels at the same places); "(both)" / L: R:; 4 px label gap; PDF calc sheet = tool calc sheet
  cases/                   — Vxx-*.json method cases (built); src/ hand-calc sources with pins, lib.mjs code tables, build / check; golden/
  rules/models/            — rule models (former selection cases V05, V06, V07, V16)
test/
  ftao.test.js             — FTAO engine regression vs APA T555 examples (node --test)
  fixtures/                — sample definitions, regression baseline, legacy/ saved definitions by schema
docs/
  shear-wall-backlog.md    — deferred shear wall items and gaps
supabase/
  config.toml              — Supabase CLI local dev config
  schema.sql               — full database schema, run once on a new Supabase project
  migrations/              — incremental schema changes
  functions/manage-users/  — server-side Supabase Auth administration
```

## First-time setup

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com), create a new project (free tier is enough to start).
2. Link the project with the Supabase CLI and run `supabase db push`. The migrations create the application tables, role-based Row Level Security, immutable audit history, realtime publication, and a private `calc-sheets` storage bucket.
3. In **Authentication → Providers**, confirm Email is enabled.
4. In **Authentication → Settings**, turn **off** "Enable email signups" (self-signup) — this is an invite-only team tool. Team members are added via invite (see below).
5. Copy your project's **URL** and **anon public key** from **Settings → API**.

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from step 1.

### 3. Install and run locally

```bash
npm install
npm run dev
```

### 4. Deploy user administration

```bash
supabase functions deploy manage-users
```

The function verifies the signed-in caller is an active administrator before using Supabase Auth's server-only administration API. Never place a service-role key in Vite environment variables.

### 5. Add team members

Public signup is disabled, so accounts are created by an admin:

- Sign in as an administrator and open **Users**.
- Create the account with a name, email, temporary password, and admin/member role.
- New accounts receive a profile and access record automatically. Administrators can deactivate access without deleting work attribution.

### 6. Deploy

- Push this repo to GitHub.
- Connect the repo to Railway (railway.app → New Project → Deploy from GitHub repo).
- In Railway's project settings, add the same environment variables as `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
- Railway builds with Railpack via `npm run build` and serves the static output via `npm run start` (see `railway.json`).
- Every push to the connected branch auto-deploys.

## Adding a new design item module

1. Create `src/modules/yourModule.js` exporting an object with this shape (see `flatLoadCalculator.js` for a full example):

```js
export const yourModule = {
  id: 'your_module_id',
  label: 'Human-Readable Name',
  schemaVersion: 1,
  calcVersion: 'v1',
  refs: [],                          // cross-item references, if any
  fields: [],
  outputFields: [],
  migrate(item) { return item; },
  summaryLabel(inputs, outputs) { ... },
  calc(inputs, resolvedRefs) { ... },
  renderForm(container, existingInputs, onSave, projectItems, onInputChange) { ... },
  renderOutputs(container, outputs) { ... },
  pdfSections(inputs, outputs) { ... },
};
```

2. Register it in `src/modules/registry.js`:

```js
import { yourModule } from './yourModule.js';
export const DESIGN_ITEM_MODULES = [..., yourModule];
```

That's it — no changes needed to the app shell, project views, or PDF infrastructure.

## Cross-item references

A module can declare `refs` — what it can pull from other items in the same project (e.g. Seismic Mass Takeoff pulls per-assembly dead loads from a Flat Load Calculator item, and ELF pulls seismic weight from Mass Takeoff). The `extract(outputs)` function on each ref maps the source item's `outputs` into whatever shape the consuming module's `calc()` expects as `resolvedRefs`.

## Data model

The ordered files in `supabase/migrations/` are the authoritative schema. Summary:

- `projects` — one row per project number. `status` is `active` / `complete` / `archived`.
- `items` — one row per saved calculation. `type` matches a module id. `inputs`/`outputs` are `jsonb` — free-form, owned entirely by the module. `custom_name` for user-defined labels. `revisions` is a bounded array (last ~10 snapshots) for basic edit history.
- `user_access` — active status plus `admin` / `member` authorization, separate from editable profile data.
- `audit_log` — append-only database-authored history for project, calculation, profile, and access changes.
- Row Level Security: active members share engineering work; only active administrators can manage users and read the global audit log.

## Tests and upgrades

- `npm test` — shear wall calc checks, aligned-stacking regression, and every saved definition in `tests/fixtures/legacy/` must open (form tabs, results, PDF sections, elevations) under a stand-in DOM (`linkedom`, dev-only).
- Shear wall verification has three layers: (1) method cases pin their design as overrides and check loads, T/C, combos, stacking and deflection against a hand calc (the reviewed catalog); (2) selection rules R1–R8 are property tests (`tests/shearWallRules.test.mjs`, drift sizing in `tests/shearWallDrift.test.mjs`) that any valid design passes; (3) goldens are a change detector. A change to the selection logic never needs a hand-calc rewrite.
- Shear wall verification cases: `npm run cases:build [Vxx …]` (sources → JSON), `npm run cases:check [Vxx]` (every value vs the engine), `npm run cases:diff` (changed golden fields), `npm run cases:accept` (refresh goldens after review), `npm run cases:doc` (catalog `docs/shear-wall-test-cases.md`), `SB_EMAIL=… SB_PASSWORD=… npm run seed:cases [-- --apply]` (local project SW-VERIFY, one item per case with a Verification tab).
- `SB_EMAIL=… SB_PASSWORD=… npm run upgrade:shearwall` — dry run over every saved Shear Wall Design item in the database from `.env`; add `-- --apply` to write the upgraded definition and regenerated results (previous version goes into `revisions`).

**Shear Wall Design stores the definition as the source of truth.** `items.inputs` (levels, lines, walls, beams, posts, loads) is authoritative; `items.outputs` is only a snapshot. The module sets `regenerateResults: true`, so `itemForm.js` recalculates results from the migrated definition on open and after save — old projects always show the current rules and visuals. When changing the definition shape: add a step to `DEFINITION_MIGRATIONS` in `shearWallDesign.js`, bump `schemaVersion`, and add a fixture of the previous version to `tests/fixtures/legacy/`. Bump `CALC_VERSION` in `shearWallCalc.js` on calc changes.

## Known limitations / open items

- **Shear Wall Design backlog**: see `docs/shear-wall-backlog.md` (start with "Next session — start here").
- **PDF export** (`src/pdf.js`, all calculators): the Export PDF button sits in a toolbar at the top of every calculator (`itemForm.js`); a module that declares `pdfOptions = { key, label, options }` gets a report dropdown next to it (Shear Wall: Summary / Detailed). Sections may set `heading` (large wall-line title), `landscape`, `pageBreakBefore`; table cells may be `{ t, color }`; text supports `_{…}` subscripts and Greek / arrow / math signs (drawn with the PDF Symbol font).

- **No real-time edit locking**: Postgres writes are last-writer-wins. The audit ledger preserves every committed mutation, while the calculation's convenience revision array remains capped.
- **PDF calc-sheet template**: currently a generic layout (header, input/output tables, signature block). A firm-specific template redesign is planned.
