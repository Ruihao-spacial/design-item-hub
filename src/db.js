import { supabase } from './supabaseClient.js';
import { sanitizeProjectNumber } from './utils.js';
import { buildSaveItemArgs, mapRevisionHistory } from './itemPersistence.js';
import { cloneProjectRows, cloneItemRow } from './clone.js';

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

export async function createProject(rawNumber, name, notes = '') {
  const projectNumber = sanitizeProjectNumber(rawNumber);
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('projects').insert({
    project_number: projectNumber,
    display_number: rawNumber,
    name,
    notes,
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

// New project with a copy of every calculation of `source` (archived ones stay archived), links remapped
// to the copies (src/clone.js). If the calculations cannot be inserted, the new project is deleted again.
export async function cloneProject(source, rawNumber, name) {
  const items = await listItems(source.projectNumber);
  const from = source.displayNumber || source.projectNumber;
  const note = 'Cloned from ' + from + ' on ' + new Date().toISOString().slice(0, 10) + '.';
  const created = await createProject(rawNumber, name, source.notes ? note + '\n\n' + source.notes : note);
  if (!created.success) return created;

  const { data: { user } } = await supabase.auth.getUser();
  const rows = cloneProjectRows(items, created.projectNumber, user?.id);
  if (rows.length) {
    const { error } = await supabase.from('items').insert(rows);
    if (error) {
      await supabase.from('projects').delete().eq('project_number', created.projectNumber);
      return { success: false, error: 'The calculations could not be copied: ' + error.message };
    }
  }
  return { success: true, projectNumber: created.projectNumber, count: rows.length };
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

const ITEM_SELECT = `
  id,
  project_number,
  type,
  label,
  custom_name,
  inputs,
  outputs,
  refs,
  schema_version,
  calc_version,
  archived,
  entered_by,
  created_at,
  updated_at,
  entered_by_profile:profiles!items_entered_by_fkey(full_name),
  revision_history:item_revisions(updated_at, updated_by)
`;

export async function listItems(projectNumber) {
  const { data, error } = await supabase
    .from('items')
    .select(ITEM_SELECT)
    .eq('project_number', projectNumber)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(mapItemRow);
}

export async function getItem(itemId) {
  const { data, error } = await supabase
    .from('items')
    .select(ITEM_SELECT)
    .eq('id', itemId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapItemRow(data) : null;
}

export async function getItemsByType(projectNumber, type) {
  const { data, error } = await supabase
    .from('items')
    .select(ITEM_SELECT)
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

  const { data, error } = await supabase.rpc('save_item', buildSaveItemArgs({
    itemId,
    label,
    customName,
    inputs,
    outputs,
    refs: inputs.refs || {},
    schemaVersion: mod.schemaVersion,
    calcVersion: mod.calcVersion,
  }));
  if (error) throw error;
  return data || itemId;
}

// Copy of one calculation in its own project, named "<name> (copy)"; its links stay as they are
export async function duplicateItem(item, fallbackName) {
  const { data: { user } } = await supabase.auth.getUser();
  const row = cloneItemRow(item, user?.id, fallbackName);
  const { error } = await supabase.from('items').insert(row);
  if (error) throw error;
  return row.id;
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
    revisions: mapRevisionHistory(row.revision_history),
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

// ===== immutable activity history =====

export async function listActivity({ projectNumber, actorId, action, limit = 30, cursor } = {}) {
  const boundedLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  let query = supabase
    .from('audit_log')
    .select('*')
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(boundedLimit);

  if (projectNumber) query = query.eq('project_number', projectNumber);
  if (actorId) query = query.eq('actor_id', actorId);
  if (cursor) query = query.lt('occurred_at', cursor);

  const rawFilter = rawActivityFilter(action);
  if (rawFilter?.entityType) query = query.eq('entity_type', rawFilter.entityType);
  if (rawFilter?.operation) query = query.eq('action', rawFilter.operation);

  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  const entries = action ? rows.filter(row => semanticActivityAction(row) === action) : rows;
  return {
    entries,
    nextCursor: rows.length === boundedLimit ? rows.at(-1)?.occurred_at || null : null,
  };
}

function rawActivityFilter(action) {
  const filters = {
    'project.created': { entityType: 'projects', operation: 'insert' },
    'project.status_changed': { entityType: 'projects', operation: 'update' },
    'project.deleted': { entityType: 'projects', operation: 'delete' },
    'calculation.created': { entityType: 'items', operation: 'insert' },
    'calculation.edited': { entityType: 'items', operation: 'update' },
    'calculation.archived': { entityType: 'items', operation: 'update' },
    'calculation.restored': { entityType: 'items', operation: 'update' },
    'calculation.deleted': { entityType: 'items', operation: 'delete' },
    'user.created': { entityType: 'user_access', operation: 'insert' },
    'user.role_changed': { entityType: 'user_access', operation: 'update' },
    'user.status_changed': { entityType: 'user_access', operation: 'update' },
    'user.deleted': { entityType: 'user_access', operation: 'delete' },
  };
  return filters[action] || null;
}

function semanticActivityAction(entry) {
  const before = entry.old_values || {};
  const after = entry.new_values || {};
  if (entry.entity_type === 'projects') {
    if (entry.action === 'insert') return 'project.created';
    if (entry.action === 'delete') return 'project.deleted';
    if (before.status !== after.status) return 'project.status_changed';
    return 'project.edited';
  }
  if (entry.entity_type === 'items') {
    if (entry.action === 'insert') return 'calculation.created';
    if (entry.action === 'delete') return 'calculation.deleted';
    if (before.archived !== after.archived) return after.archived ? 'calculation.archived' : 'calculation.restored';
    return 'calculation.edited';
  }
  if (entry.entity_type === 'user_access') {
    if (entry.action === 'insert') return 'user.created';
    if (entry.action === 'delete') return 'user.deleted';
    if (before.role !== after.role) return 'user.role_changed';
    if (before.active !== after.active) return 'user.status_changed';
  }
  return `${entry.entity_type}.${entry.action}`;
}
