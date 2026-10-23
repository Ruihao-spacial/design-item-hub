# Stored data rules — projects must survive code changes

**Goal.** A project saved today must open, calculate and print correctly after any later change to a calculator's
UI or logic, with no bug and no lost input.

**Status.**
- **Diaphragm to LRS** follows every rule below (schema 2, 2026-10-08).
- **Shear Wall Design** already has migrations and legacy fixtures (P4, P6, P7). It does not yet stamp the version
  inside the data (P3).
- **The other modules** adopt these rules when they are next changed.

## Rules
| # | Rule | Why |
|---|---|---|
| **P1** | **Store what the user typed, nothing derived.** `items.inputs` holds user values only, as typed (strings from number fields stay strings). Results (`items.outputs`) are a snapshot, recalculated on open (`regenerateResults: true`). | A logic change can never leave an old project with stale results. The inputs are re-read by the new logic. |
| **P2** | **Refer by stable id, never by name or position.** Levels, lines, diaphragms, parts, loads and merges each have an id; every link stores that id. Names are only labels. | Renaming or reordering in the UI never breaks a link. |
| **P3** | **The version is stamped inside the data:** `inputs.schemaVersion`. The DB column `schema_version` is a copy. If the two disagree, the stamp inside the data wins. | Copies, exports, fixtures and revisions still know their shape. |
| **P4** | **Shape changes only through migration steps.** An ordered list of `{ to, up }` steps runs from the stored version. Each step is pure and idempotent, and it **keeps every field it does not know** (copy with `...spread`, never rebuild an object from a list of known keys). A renamed or removed field is **moved** by its step, never dropped. Released steps are never edited. Data from a newer schema than the running code is left untouched. | Old data reaches the new shape without loss. Unknown fields from a newer or older version are not destroyed. |
| **P5** | **Missing fields are filled by `normalizeInputs()`**, run after migration on every open. It only adds neutral defaults (empty arrays, `''`) and never changes or removes a value. The UI and the calc also tolerate missing fields. | Adding an optional field needs no migration, and old data never crashes the form. |
| **P6** | **Frozen fixtures stay in the repo forever:** at least one per past schema, plus real saved items, in `tests/fixtures/legacy-<module>/` (Shear Wall: `tests/fixtures/legacy/`). Each must lose no value, migrate idempotently, give the same results (or a reviewed, intended change), open every tab, save without loss, print, and its old stored outputs must still render. | A future change that breaks an old project fails `npm test` before it ships. |
| **P7** | **Bulk upgrade by script:** dry run first. It reports schema from → to, "no value lost" and "results unchanged" per item. Items that would lose a value are never written. The previous version goes into `revisions`. | Saved projects are moved to the new shape in a controlled, reversible way. |

## When you change a module
0. **Copies (Clone Project / Duplicate, `src/clone.js`):** an item is copied exactly as stored — no migration, the
   schema stamp travels with it; only the links (`inputs.refs`, item ids) are pointed at the copies. A new link
   field must live in `inputs.refs`, or a cloned project would keep pointing at the old project's items.
   `tests/clone.test.mjs` copies every frozen fixture and checks no value is lost.
1. **UI only:** nothing to do, as long as it reads and writes the same fields. The fixtures' "opens and saves
   without loss" test catches a form that drops fields.
2. **Calc logic:**
   - bump `CALC_VERSION`;
   - review the golden diff (`…:cases:diff`) and the fixtures' "same results" test;
   - if numbers change on purpose, write down why in the backlog and refresh the frozen numbers.
3. **Inputs shape:**
   - add a migration step;
   - bump the schema version;
   - **before** changing anything, capture a fixture of the old shape from a real item;
   - run the migration test;
   - run the upgrade script as a dry run, then `--apply`.

## Diaphragm to LRS (reference implementation)
| What | Where |
|---|---|
| Schema, steps, normalisation, no-loss and results helpers | `src/modules/diaphragmToLrsMigrate.js` (`DLRS_SCHEMA`, `DLRS_MIGRATIONS`, `migrateItem`, `normalizeInputs`, `lostValues`, `resultNumbers`) |
| Module hook | `diaphragmToLrs.migrate(item)`; `renderForm` normalises again and saves the whole object |
| Fixtures | `tests/fixtures/legacy-dlrs/`: `schema1-test123.json` (real item), `schema1-d01.json` (spreadsheet), `schema1-unknown-fields.json` |
| Tests | `tests/diaphragmToLrsMigrate.test.mjs` (in `npm test`) |
| Upgrade | `SB_EMAIL=… SB_PASSWORD=… npm run upgrade:dlrs [-- --apply]` |

**Schema history.**
- **1:** first release (2026-10-07).
- **2** (2026-10-08): the version is stamped inside `inputs`; no field changes.
