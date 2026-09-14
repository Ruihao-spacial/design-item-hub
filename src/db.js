import { supabase } from './supabaseClient.js';
import { sanitizeProjectNumber } from './utils.js';

const MAX_REVISIONS = 10;

// ===== projects =====

export async function listProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('*, created_by_profile:profiles!projects_created_by_fkey(full_name)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(mapProjectRow);
}

export async function getProject(projectNumber) {
  const { data, error } = await supabase
    .from('projects')
    .select('*, created_by_profile:profiles!projects_created_by_fkey(full_name)')
    .eq('project_number', projectNumber)
    .maybeSingle();
  if (error) throw error;
  return data ? mapProjectRow(data) : null;
}

export async function createProject(rawNumber, name) {
  const projectNumber = sanitizeProjectNumber(rawNumber);
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('projects').insert({
    project_number: projectNumber,
    display_number: rawNumber,
    name,
    status: 'active',
    created_by: user?.id,
  });
  if (error) {
    if (error.code === '23505') {
      return { success: false, error: 'A project with number "' + rawNumber + '" already exists.' };
    }
    return { success: false, error: error.message };
  }
  return { success: true, projectNumber };
}

export async function updateProjectStatus(projectNumber, status) {
  const { error } = await supabase.from('projects').update({ status }).eq('project_number', projectNumber);
  if (error) throw error;
}

export async function deleteProject(projectNumber) {
  // FK is ON DELETE CASCADE, so items are removed automatically by Postgres.
  const { error } = await supabase.from('projects').delete().eq('project_number', projectNumber);
  if (error) throw error;
}

export function subscribeProjects(onChange) {
  const channel = supabase
    .channel('projects-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

function mapProjectRow(row) {
  return {
    id: row.project_number,
    projectNumber: row.project_number,
    displayNumber: row.display_number,
    name: row.name,
    status: row.status,
    notes: row.notes,
    createdBy: row.created_by_profile?.full_name || '—',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ===== items =====

export async function listItems(projectNumber) {
  const { data, error } = await supabase
    .from('items')
    .select('*, entered_by_profile:profiles!items_entered_by_fkey(full_name)')
    .eq('project_number', projectNumber)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(mapItemRow);
}

export async function getItem(itemId) {
  const { data, error } = await supabase
    .from('items')
    .select('*, entered_by_profile:profiles!items_entered_by_fkey(full_name)')
    .eq('id', itemId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapItemRow(data) : null;
}

export async function getItemsByType(projectNumber, type) {
  const { data, error } = await supabase
    .from('items')
    .select('*, entered_by_profile:profiles!items_entered_by_fkey(full_name)')
    .eq('project_number', projectNumber)
    .eq('type', type)
    .eq('archived', false);
  if (error) throw error;
  return data.map(mapItemRow);
}

export async function saveItem({ itemId, projectNumber, module: mod, inputs, resolvedRefs, customName }) {
  const outputs = mod.calc(inputs, resolvedRefs || {});
  const autoLabel = mod.summaryLabel(inputs, outputs);
  const label = customName || autoLabel;

  if (!itemId) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('items')
      .insert({
        project_number: projectNumber,
        type: mod.id,
        label,
        custom_name: customName || null,
        inputs,
        outputs,
        refs: inputs.refs || {},
        schema_version: mod.schemaVersion,
        calc_version: mod.calcVersion,
        entered_by: user?.id,
        archived: false,
        revisions: [],
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  }

  const existing = await getItem(itemId);
  const revisions = Array.isArray(existing?.revisions) ? [...existing.revisions] : [];
  if (existing?.inputs) {
    revisions.push({
      inputs: existing.inputs,
      outputs: existing.outputs,
      updatedAt: existing.updatedAt,
      updatedBy: existing.enteredBy,
    });
    while (revisions.length > MAX_REVISIONS) revisions.shift();
  }

  const { error } = await supabase
    .from('items')
    .update({
      label,
      custom_name: customName || null,
      inputs,
      outputs,
      refs: inputs.refs || {},
      schema_version: mod.schemaVersion,
      calc_version: mod.calcVersion,
      revisions,
    })
    .eq('id', itemId);
  if (error) throw error;
  return itemId;
}

export async function archiveItem(itemId) {
  const { error } = await supabase.from('items').update({ archived: true }).eq('id', itemId);
  if (error) throw error;
}

export async function restoreItem(itemId) {
  const { error } = await supabase.from('items').update({ archived: false }).eq('id', itemId);
  if (error) throw error;
}

export function subscribeItems(projectNumber, onChange) {
  const channel = supabase
    .channel('items-changes-' + projectNumber)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'items', filter: 'project_number=eq.' + projectNumber }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

function mapItemRow(row) {
  return {
    id: row.id,
    projectNumber: row.project_number,
    type: row.type,
    label: row.label,
    customName: row.custom_name || '',
    inputs: row.inputs || {},
    outputs: row.outputs || {},
    refs: row.refs || {},
    schemaVersion: row.schema_version,
    calcVersion: row.calc_version,
    archived: row.archived,
    revisions: row.revisions || [],
    enteredBy: row.entered_by_profile?.full_name || '—',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ===== PDF storage =====

export async function uploadCalcSheet(projectNumber, itemId, blob) {
  const path = projectNumber + '/' + itemId + '-' + Date.now() + '.pdf';
  const { error } = await supabase.storage.from('calc-sheets').upload(path, blob, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (error) throw error;
  const { data } = await supabase.storage.from('calc-sheets').createSignedUrl(path, 60 * 60);
  return data?.signedUrl;
}
