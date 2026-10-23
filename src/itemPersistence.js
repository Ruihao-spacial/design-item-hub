export function buildSaveItemArgs({ itemId, label, customName, inputs, outputs, refs, schemaVersion, calcVersion }) {
  return {
    p_item_id: itemId,
    p_label: label,
    p_custom_name: customName || null,
    p_inputs: inputs,
    p_outputs: outputs,
    p_refs: refs || {},
    p_schema_version: schemaVersion,
    p_calc_version: calcVersion,
  };
}

export function mapRevisionHistory(rows) {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((revision) => ({
      updatedAt: revision.updated_at,
      updatedBy: revision.updated_by || '—',
    }))
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
}
