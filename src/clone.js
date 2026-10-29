// Clone a project or one calculation: rows ready to insert into `items`.
// Pure (no database reads), so it also runs in tests. The definition is copied exactly as stored
// (docs/data-durability.md — no migration, no field dropped); only the links between calculations change.
// A link is an item id in inputs.refs[key]; the `refs` column is a copy of it.

const newUuid = () => crypto.randomUUID();
const copy = (v) => JSON.parse(JSON.stringify(v ?? {}));

// Links pointed at their new ids. A link to an item not in idMap (deleted) is cleared; a list of links keeps
// the ones that still exist (and is dropped when none do).
export function remapRefs(refs, idMap) {
  const out = {};
  for (const [key, id] of Object.entries(refs || {})) {
    if (Array.isArray(id)) {
      const ids = id.filter(x => idMap.has(x)).map(x => idMap.get(x));
      if (ids.length) out[key] = ids;
    } else if (idMap.has(id)) out[key] = idMap.get(id);
  }
  return out;
}

// Every calculation of a project (archived ones stay archived) into the project newProjectNumber,
// with the links between them pointing at the new copies.
export function cloneProjectRows(items, newProjectNumber, userId, makeId = newUuid) {
  const idMap = new Map(items.map(it => [it.id, makeId()]));
  return items.map(it => itemRow(it, {
    id: idMap.get(it.id),
    projectNumber: newProjectNumber,
    userId,
    refs: remapRefs(it.inputs && it.inputs.refs, idMap),
    customName: it.customName || null,
    label: it.label,
  }));
}

// One calculation duplicated in its own project: the links stay as they are.
export function cloneItemRow(item, userId, fallbackName, makeId = newUuid) {
  const name = (item.customName || item.label || fallbackName || item.type) + ' (copy)';
  return itemRow(item, {
    id: makeId(),
    projectNumber: item.projectNumber,
    userId,
    refs: copy(item.inputs && item.inputs.refs),
    customName: name,
    label: name,
  });
}

function itemRow(item, { id, projectNumber, userId, refs, customName, label }) {
  const inputs = copy(item.inputs);
  if (inputs.refs) inputs.refs = refs;
  return {
    id,
    project_number: projectNumber,
    type: item.type,
    label: label || '',
    custom_name: customName,
    inputs,
    outputs: copy(item.outputs),
    refs,
    schema_version: item.schemaVersion,
    calc_version: item.calcVersion,
    archived: !!item.archived,
    entered_by: userId || null,
    revisions: [],
  };
}
