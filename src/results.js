// Current results and linked-value checks, shared by the item form, project list and PDF export.
// Pure: works from items already loaded (no database reads), so it also runs in tests.
import { getModule } from './modules/registry.js';

// Item with its definition brought up to the module's current schema
export function migrated(mod, item) {
  return mod && mod.migrate && item ? mod.migrate({ ...item }) : item;
}

// Resolved refs for a definition, taken from the upstream items' *current* outputs.
// seen: item ids already on the chain (cycle guard).
// A ref may declare:
//   many: true      — inputs.refs[key] is a list of item ids; the result is [{ id, ...extract(…) }] in that order
//   from: 'inputs'  — extract(definition, item) reads the upstream item's (migrated) definition instead of its
//                     outputs; the upstream item's own refs are not resolved, so it can never close a cycle
export function refsFromItems(mod, inputs, items, seen) {
  const out = {};
  const refIds = (inputs && inputs.refs) || {};
  const one = (ref, id) => {
    if (!id) return undefined;
    const fromInputs = ref.from === 'inputs';
    if (!fromInputs && seen && seen.has(id)) return undefined;
    const up = (items || []).find(it => it.id === id);
    if (!up) return undefined;
    const upMod = getModule(up.type);
    if (!upMod) return undefined;
    try {
      if (fromInputs) {
        const m = migrated(upMod, up);
        return m && m.inputs ? ref.extract(m.inputs, m) : undefined;
      }
      const upOut = currentOutputs(upMod, up, items, new Set([...(seen || []), id]));
      return upOut ? ref.extract(upOut, up) : undefined;
    } catch (e) { return undefined; } // upstream shape changed — treat as not linked
  };
  for (const ref of (mod && mod.refs) || []) {
    const v = refIds[ref.key];
    if (ref.many) {
      const ids = Array.isArray(v) ? v : (v ? [v] : []);
      const list = ids.map(id => { const x = one(ref, id); return x === undefined ? undefined : { id, ...x }; }).filter(Boolean);
      if (list.length) out[ref.key] = list;
    } else {
      const x = one(ref, Array.isArray(v) ? v[0] : v);
      if (x !== undefined) out[ref.key] = x;
    }
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
    const v = (inputs.refs || {})[c.refKey];
    const up = Array.isArray(v) ? null : (items || []).find(x => x.id === v);
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

