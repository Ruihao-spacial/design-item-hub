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
| Shear Wall Design | `shearWallDesign.js`, `shearWallCalc.js`, `shearWallElevation.js`, `shearWallTypes.js`, `shearWallNailing.js`, `shearWallHardware.js` | Multi-story shear wall analysis with nailing/hardware auto-select and interactive SVG elevation |

**Cross-module data flow:** Flat Load Calculator → Seismic Mass Takeoff (per-assembly DL) → ELF (W, per-level). Seismic Base Shear → ELF (Cs, SDS, Ie, Ω0, k auto-fill via ref).

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
    shearWallCalc.js       — shear wall calc engine
    shearWallElevation.js  — interactive SVG elevation drawing
    shearWallTypes.js      — data model constructors + helpers
    shearWallNailing.js    — SDPWS 4.3A nailing table + auto-select
    shearWallHardware.js   — holdown/strap catalogs + post design
  views/
    login.js
    projectPicker.js
    projectDetail.js
    itemForm.js
    userManagement.js
    activityLog.js
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

## Known limitations / open items

- **No real-time edit locking**: Postgres writes are last-writer-wins. The audit ledger preserves every committed mutation, while the calculation's convenience revision array remains capped.
- **PDF calc-sheet template**: currently a generic layout (header, input/output tables, signature block). A firm-specific template redesign is planned.
