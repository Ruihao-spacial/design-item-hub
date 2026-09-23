// Current results and linked-value checks, shared by the item form, project list and PDF export.
// Pure: works from items already loaded (no database reads), so it also runs in tests.
import { getModule } from './modules/registry.js';

// Item with its definition brought up to the module's current schema
export function migrated(mod, item) {
  return mod && mod.migrate && item ? mod.migrate({ ...item }) : item;
}

// Resolved refs for a definition, taken from the upstream items' *current* outputs.
// seen: item ids already on the chain (cycle guard).
export function refsFromItems(mod, inputs, items, seen) {
  const out = {};
  const refIds = (inputs && inputs.refs) || {};
  for (const ref of (mod && mod.refs) || []) {
    const id = refIds[ref.key];
    if (!id || (seen && seen.has(id))) continue;
    const up = (items || []).find(it => it.id === id);
    if (!up) continue;
    const upMod = getModule(up.type);
    if (!upMod) continue;
    const upOut = currentOutputs(upMod, up, items, new Set([...(seen || []), id]));
    if (!upOut) continue;
    try { out[ref.key] = ref.extract(upOut); } catch (e) { /* upstream shape changed — treat as not linked */ }
  }
  return out;
}

// Results to show for an item: regenerated from its definition when the module opts in,
// otherwise the stored snapshot. null when the calc fails.
export function currentOutputs(mod, item, items, seen) {
  const it = migrated(mod, item);
  if (!it) return null;
  if (!mod.regenerateResults) return it.outputs || null;
  try {
    return mod.calc(it.inputs || {}, refsFromItems(mod, it.inputs, items, seen || new Set([it.id])));
  } catch (e) {
    console.error('Recalculating results failed:', e);
    return null;
  }
}

// Linked values that differ from the upstream items' current values:
// [{ refKey, source, label, from, to }] — empty when nothing changed or the module copies nothing.
export function linkChanges(mod, item, items) {
  if (!mod || !mod.linkDiff || !item) return [];
  const it = migrated(mod, item);
  const inputs = it.inputs || {};
  const ext = refsFromItems(mod, inputs, items, new Set([it.id]));
  let changes = [];
  try { changes = mod.linkDiff(inputs, ext) || []; } catch (e) { console.error('Link check failed:', e); return []; }
  return changes.map(c => {
    const refDef = (mod.refs || []).find(r => r.key === c.refKey) || {};
    const up = (items || []).find(x => x.id === (inputs.refs || {})[c.refKey]);
    return { ...c, source: (up && (up.customName || up.label)) || refDef.label || c.refKey };
  });
}

// Definition with linked values refreshed from the upstream items (returns a copy)
export function applyLinkUpdates(mod, inputs, items, selfId) {
  if (!mod || !mod.applyLinks) return inputs;
  const copy = JSON.parse(JSON.stringify(inputs || {}));
  const ext = refsFromItems(mod, copy, items, new Set(selfId ? [selfId] : []));
  return mod.applyLinks(copy, ext) || copy;
}

