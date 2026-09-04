# Design Item Hub

Shared structural-engineering calculation tool, organized by project number. Each project holds multiple design-item calculations (seismic mass takeoff, shear wall design, and future modules). Real-time shared data across the team via Supabase, deployed on Railway.

## Stack

- **Frontend**: Vanilla JS + Vite (no framework — keeps each design-item module a self-contained file)
- **Database + Auth**: Supabase (Postgres, Row Level Security, email/password auth, Realtime, Storage)
- **Hosting**: Railway (auto-deploys from this GitHub repo)
- **PDF export**: jsPDF (client-side)

## Project structure

```
src/
  main.js                  — entry point
  app.js                   — router / app shell / auth state
  auth.js                  — Supabase auth wrappers
  db.js                    — all Supabase database queries
  pdf.js                   — PDF calc-sheet generation
  supabaseClient.js        — Supabase client init
  styles.css               — design tokens + all component styles
  utils.js                 — DOM helper (el), formatting, toasts
  modules/
    registry.js            — DESIGN_ITEM_MODULES array — register new modules here
    seismicMassTakeoff.js  — one module = one file
    shearWallDesign.js
  views/
    login.js
    projectPicker.js
    projectDetail.js
    itemForm.js
supabase/
  schema.sql                — full database schema, run once on a new Supabase project
```

## First-time setup

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com), create a new project (free tier is enough to start).
2. In the SQL Editor, run the contents of `supabase/schema.sql`. This creates the `profiles`, `projects`, and `items` tables, Row Level Security policies, realtime publication, and a private `calc-sheets` storage bucket.
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

### 4. Invite team members

Public signup is disabled, so accounts are created by an admin:

- **Supabase Dashboard**: Authentication → Users → **Invite user**. Enter their email; they get a magic link to set a password.
- Each invited user automatically gets a `profiles` row (via the `handle_new_user` trigger in the schema) using their email's local part as a default display name — they can update it later.

### 5. Deploy

- Push this repo to GitHub.
- Connect the repo to Railway (railway.app → New Project → Deploy from GitHub repo).
- In Railway's project settings, add the same environment variables as `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
- Railway builds via `npm run build` and serves the static output via `npm run start` (see `railway.json`).
- Every push to the connected branch auto-deploys.

## Adding a new design item module

1. Create `src/modules/yourModule.js` exporting an object with this shape (see `seismicMassTakeoff.js` for a full example):

```js
export const yourModule = {
  id: 'your_module_id',
  label: 'Human-Readable Name',
  schemaVersion: 1,
  calcVersion: 'v1',
  refs: [],                          // cross-item references, if any
  fields: [...],                     // input field metadata (labels/units)
  outputFields: [...],               // output field metadata
  migrate(item) { return item; },
  summaryLabel(inputs, outputs) { ... },
  calc(inputs, resolvedRefs) { ... }, // pure function
  renderForm(container, existingInputs, onSave, projectItems) { ... },
  renderOutputs(container, outputs) { ... },
  pdfSections(inputs, outputs) { ... },
};
```

2. Register it in `src/modules/registry.js`:

```js
import { yourModule } from './yourModule.js';
export const DESIGN_ITEM_MODULES = [seismicMassTakeoff, shearWallDesign, yourModule];
```

That's it — no changes needed to the app shell, project views, or PDF infrastructure.

## Cross-item references

A module can declare `refs` — what it can pull from other items in the same project (e.g. Shear Wall Design pulls total seismic weight from a Seismic Mass Takeoff item). The `extract(outputs)` function on each ref maps the source item's `outputs` into whatever shape the consuming module's `calc()` expects as `resolvedRefs`.

## Data model

See `supabase/schema.sql` for the authoritative schema. Summary:

- `projects` — one row per project number. `status` is `active` / `complete` / `archived`.
- `items` — one row per saved calculation. `type` matches a module id. `inputs`/`outputs` are `jsonb` — free-form, owned entirely by the module. `revisions` is a bounded array (last ~10 snapshots) for basic edit history.
- Row Level Security: any authenticated user reads and writes everything (no per-user gating) — matches the team's "shared workspace" requirement.

## Known limitations / open items

- **Placeholder formulas**: both shipped modules (`seismic_mass_takeoff`, `shear_wall_design`) use placeholder `calc()` functions, clearly labeled `PLACEHOLDER_v1`. PDF exports are watermarked while a calc is a placeholder. Real formulas are pending:
  - Seismic Mass Takeoff: user's MathCAD reference (not yet provided).
  - Shear Wall Design: `SWS Calc.xlsx` / `Shear_Wall_Schedule.xlsx` / `SWS Supplemental Calculation.pdf` review (deferred).
- **No real-time edit locking**: unlike a single-writer lease, Postgres writes here are last-writer-wins with a revision history kept for recovery — acceptable at this team's scale (2-5 concurrent users).
- **PDF calc-sheet template**: currently a generic layout (header, input/output tables, signature block). The firm has an existing template they want to redesign into this — pending that discussion.
