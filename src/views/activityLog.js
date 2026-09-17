import { el, clearEl, formatDateTime, showToast } from '../utils.js';
import { listActivity } from '../db.js';
import { listManagedUsers } from '../admin.js';

const PAGE_SIZE = 30;
const ACTION_OPTIONS = [
  ['', 'All activity'],
  ['project.created', 'Project created'],
  ['project.status_changed', 'Project status changed'],
  ['project.deleted', 'Project deleted'],
  ['calculation.created', 'Calculation created'],
  ['calculation.edited', 'Calculation edited'],
  ['calculation.archived', 'Calculation archived'],
  ['calculation.restored', 'Calculation restored'],
  ['calculation.deleted', 'Calculation deleted'],
  ['user.created', 'User created'],
  ['user.role_changed', 'User role changed'],
  ['user.status_changed', 'User status changed'],
  ['user.deleted', 'User deleted'],
];

export async function renderActivityLog(container, state, { onBack, projectNumber: scopedProjectNumber } = {}) {
  clearEl(container);
  let entries = [];
  let nextCursor = null;
  let loading = false;
  const filters = { projectNumber: scopedProjectNumber || '', actorId: '', action: '' };

  const projectInput = el('input', {
    className: 'search-input', type: 'search', placeholder: 'Project number',
    value: filters.projectNumber, 'aria-label': 'Filter by project number', disabled: Boolean(scopedProjectNumber),
  });
  const actorSelect = el('select', { className: 'form-select', 'aria-label': 'Filter by person', style: { width: 'auto' } },
    el('option', { value: '' }, 'All people'));
  const actionSelect = el('select', { className: 'form-select', 'aria-label': 'Filter by activity type', style: { width: 'auto' } });
  ACTION_OPTIONS.forEach(([value, label]) => actionSelect.appendChild(el('option', { value }, label)));
  const applyButton = el('button', { className: 'btn', type: 'button', onClick: applyFilters }, 'Apply filters');
  const results = el('div');
  const liveStatus = el('div', { role: 'status', 'aria-live': 'polite', className: 'sr-only' });
  const loadMoreButton = el('button', { className: 'btn', type: 'button', hidden: true, onClick() { loadPage(false); } }, 'Load more');

  container.appendChild(el('div', { className: 'section-header' },
    el('div', null,
      onBack ? el('div', { className: 'breadcrumb' },
        el('a', { href: '#', onClick(e) { e.preventDefault(); onBack(); } }, scopedProjectNumber ? 'Project' : 'Projects'),
        el('span', { className: 'sep' }, '/'),
        el('span', null, 'Activity')) : null,
      el('h1', null, scopedProjectNumber ? 'Project activity' : 'Activity log'),
    ),
  ));
  container.appendChild(el('form', { className: 'toolbar', role: 'search', onSubmit(e) { e.preventDefault(); applyFilters(); } },
    projectInput, actorSelect, actionSelect, applyButton,
  ));
  container.append(liveStatus, results, el('div', { style: { textAlign: 'center', marginTop: '1rem' } }, loadMoreButton));

  async function applyFilters() {
    filters.projectNumber = scopedProjectNumber || projectInput.value.trim();
    filters.actorId = actorSelect.value;
    filters.action = actionSelect.value;
    await loadPage(true);
  }

  async function loadPage(reset) {
    if (loading) return;
    loading = true;
    applyButton.disabled = true;
    loadMoreButton.disabled = true;
    liveStatus.textContent = reset ? 'Loading activity…' : 'Loading more activity…';
    if (reset) {
      entries = [];
      nextCursor = null;
      clearEl(results);
      results.appendChild(el('div', { style: { color: 'var(--ink-secondary)', fontSize: '0.9rem' } }, 'Loading activity…'));
    }

    try {
      const response = await listActivity({
        projectNumber: filters.projectNumber || undefined,
        actorId: filters.actorId || undefined,
        action: filters.action || undefined,
        limit: PAGE_SIZE,
        cursor: reset ? undefined : nextCursor,
      });
      const page = normalizePage(response);
      entries = reset ? page.entries : entries.concat(page.entries);
      nextCursor = page.nextCursor;
      renderEntries(results, entries);
      loadMoreButton.hidden = !nextCursor;
      liveStatus.textContent = page.entries.length
        ? `${page.entries.length} activit${page.entries.length === 1 ? 'y' : 'ies'} loaded.`
        : 'No more activity.';
    } catch (error) {
      if (reset) clearEl(results);
      results.appendChild(el('div', { className: 'error-banner', role: 'alert' }, error.message || 'Activity could not be loaded.'));
      showToast(error.message || 'Activity could not be loaded.', 'error');
    } finally {
      loading = false;
      applyButton.disabled = false;
      loadMoreButton.disabled = false;
    }
  }

  try {
    const users = await listManagedUsers();
    users.forEach((user) => actorSelect.appendChild(el('option', { value: user.id },
      user.full_name || user.fullName || user.email || 'Unnamed user')));
  } catch {
    actorSelect.disabled = true;
    actorSelect.title = 'The user filter is temporarily unavailable.';
  }
  await loadPage(true);
}

function renderEntries(container, entries) {
  clearEl(container);
  if (!entries.length) {
    container.appendChild(el('div', { className: 'panel empty-state' },
      el('h3', null, 'No activity'),
      el('p', null, 'No events match these filters.'),
    ));
    return;
  }

  const list = el('ol', { className: 'panel', 'aria-label': 'Activity events', style: { listStyle: 'none', padding: '0', margin: '0' } });
  entries.forEach((entry) => {
    const details = eventDetails(entry);
    list.appendChild(el('li', { style: { padding: '0.8rem 1rem', borderBottom: '1px solid var(--border-light)' } },
      el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'baseline', flexWrap: 'wrap' } },
        el('div', { style: { fontWeight: '500' } }, eventSummary(entry)),
        el('time', { datetime: eventTime(entry), style: { color: 'var(--ink-secondary)', fontSize: '0.8rem', whiteSpace: 'nowrap' } },
          formatDateTime(eventTime(entry))),
      ),
      el('div', { style: { color: 'var(--ink-secondary)', fontSize: '0.8rem', marginTop: '0.2rem' } }, eventContext(entry)),
      details.length ? el('details', { style: { marginTop: '0.45rem' } },
        el('summary', { style: { cursor: 'pointer', color: 'var(--accent)', fontSize: '0.8rem', fontWeight: '500' } }, 'View changes'),
        el('dl', { style: { display: 'grid', gridTemplateColumns: 'minmax(8rem, auto) 1fr', gap: '0.3rem 0.75rem', margin: '0.6rem 0 0', fontSize: '0.8rem' } },
          details.flatMap(detail => [
            el('dt', { style: { color: 'var(--ink-secondary)', fontWeight: '600' } }, detail.label),
            el('dd', { style: { margin: '0', overflowWrap: 'anywhere' } }, detail.value),
          ]),
        ),
      ) : null,
    ));
  });
  container.appendChild(list);
}

function normalizePage(response) {
  if (Array.isArray(response)) {
    return { entries: response, nextCursor: response.length === PAGE_SIZE ? cursorFor(response.at(-1)) : null };
  }
  const entries = response?.entries || response?.items || response?.data || [];
  return {
    entries,
    nextCursor: response?.nextCursor || response?.next_cursor || (response?.hasMore ? cursorFor(entries.at(-1)) : null),
  };
}

function cursorFor(entry) {
  return entry?.occurred_at || entry?.occurredAt || entry?.created_at || entry?.createdAt || entry?.id || null;
}

function eventSummary(entry) {
  const actor = entry.actor_name || entry.actorName || entry.actor_email || entry.actorEmail || 'System';
  const object = entityLabel(entry);
  const phrases = {
    'project.created': 'created project',
    'project.status_changed': 'changed the status of project',
    'project.deleted': 'deleted project',
    'calculation.created': 'created calculation',
    'calculation.edited': 'edited calculation',
    'calculation.archived': 'archived calculation',
    'calculation.restored': 'restored calculation',
    'calculation.deleted': 'deleted calculation',
    'user.created': 'created user',
    'user.role_changed': 'changed the role of user',
    'user.status_changed': 'changed the status of user',
    'user.deleted': 'deleted user',
  };
  const action = semanticAction(entry);
  return `${actor} ${phrases[action] || humanize(action)}${object ? ` “${object}”` : ''}`;
}

function eventContext(entry) {
  const project = entry.project_number || entry.projectNumber || entry.metadata?.project_number || entry.metadata?.projectNumber;
  const type = entry.entity_type || entry.entityType;
  const parts = [];
  if (project) parts.push(`Project ${project}`);
  if (type && type !== 'project') parts.push(humanize(type));
  return parts.join(' · ');
}

function entityLabel(entry) {
  const metadata = entry.metadata || {};
  const values = entry.new_values || entry.newValues || entry.old_values || entry.oldValues || {};
  const type = entry.entity_type || entry.entityType;
  return metadata.label || metadata.name || metadata.email || values.custom_name || values.label || values.name || values.email ||
    entry.entity_label || entry.entityLabel ||
    (type === 'project' || type === 'projects' ? entry.project_number || entry.projectNumber : '');
}

function eventDetails(entry) {
  const details = [];
  const changedFields = entry.changed_fields || entry.changedFields || entry.metadata?.changed_fields || entry.metadata?.changedFields;
  if (Array.isArray(changedFields) && changedFields.length) {
    details.push({ label: 'Fields changed', value: changedFields.map(humanize).join(', ') });
  }

  const before = entry.old_values || entry.oldValues || entry.old_data || entry.oldData || entry.metadata?.before;
  const after = entry.new_values || entry.newValues || entry.new_data || entry.newData || entry.metadata?.after;
  const keys = Array.isArray(changedFields) ? changedFields : changedKeys(before, after);
  keys.slice(0, 20).forEach((key) => {
    details.push({ label: humanize(key), value: `${displayValue(before?.[key])} → ${displayValue(after?.[key])}` });
  });
  if (!details.length && entry.metadata && Object.keys(entry.metadata).length) {
    Object.entries(entry.metadata).slice(0, 20).forEach(([key, value]) => {
      if (!['label', 'name', 'email', 'project_number', 'projectNumber'].includes(key)) {
        details.push({ label: humanize(key), value: displayValue(value) });
      }
    });
  }
  return details;
}

function changedKeys(before, after) {
  if (!before || !after) return [];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

function eventTime(entry) {
  return entry.occurred_at || entry.occurredAt || entry.created_at || entry.createdAt;
}

function semanticAction(entry) {
  const action = String(entry.action || '').toLowerCase();
  if (action.includes('.')) return action;
  const type = entry.entity_type || entry.entityType || 'activity';
  const before = entry.old_values || entry.oldValues || entry.old_data || entry.oldData || {};
  const after = entry.new_values || entry.newValues || entry.new_data || entry.newData || {};
  if (type === 'projects') {
    if (action === 'insert') return 'project.created';
    if (action === 'delete') return 'project.deleted';
    if (before.status !== after.status) return 'project.status_changed';
  }
  if (type === 'items') {
    if (action === 'insert') return 'calculation.created';
    if (action === 'delete') return 'calculation.deleted';
    if (before.archived !== after.archived) return after.archived ? 'calculation.archived' : 'calculation.restored';
    if (action === 'update') return 'calculation.edited';
  }
  if (type === 'user_access') {
    if (action === 'insert') return 'user.created';
    if (action === 'delete') return 'user.deleted';
    if (before.role !== after.role) return 'user.role_changed';
    if (before.active !== after.active) return 'user.status_changed';
  }
  return `${type}.${action || 'recorded'}`;
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 240 ? `${text.slice(0, 237)}…` : text;
}

function humanize(value) {
  return String(value || '').replace(/[._-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}
