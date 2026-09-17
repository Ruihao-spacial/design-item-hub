import { el, clearEl, formatDate, showToast } from '../utils.js';
import { createProject } from '../db.js';

export function renderProjectPicker(container, state, { onOpenProject, onProjectsChanged }) {
  clearEl(container);

  const filtered = state.projects.filter((p) => {
    if (state.statusFilter !== 'all' && p.status !== state.statusFilter) return false;
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const num = (p.displayNumber || p.projectNumber || '').toLowerCase();
      const name = (p.name || '').toLowerCase();
      if (!num.includes(q) && !name.includes(q)) return false;
    }
    return true;
  });

  const statusTabs = el('div', { className: 'filter-tabs', role: 'group', 'aria-label': 'Filter projects by status' });
  ['active', 'complete', 'archived', 'all'].forEach((s) => {
    statusTabs.appendChild(el('button', {
      className: 'filter-tab' + (state.statusFilter === s ? ' active' : ''),
      type: 'button', 'aria-pressed': state.statusFilter === s ? 'true' : 'false',
      onClick() { state.statusFilter = s; renderProjectPicker(container, state, { onOpenProject, onProjectsChanged }); },
    }, s.charAt(0).toUpperCase() + s.slice(1)));
  });

  const searchInput = el('input', {
    className: 'search-input', type: 'search', placeholder: 'Search projects…', value: state.searchQuery || '', 'aria-label': 'Search projects',
    onInput(e) { state.searchQuery = e.target.value; renderProjectPicker(container, state, { onOpenProject, onProjectsChanged }); },
  });

  container.appendChild(el('div', { className: 'toolbar' },
    statusTabs,
    el('div', { className: 'toolbar-spacer' }),
    searchInput,
    el('button', { className: 'btn btn-primary', onClick() { showNewProjectModal(onProjectsChanged); } }, '+ New Project'),
  ));

  if (filtered.length === 0) {
    container.appendChild(el('div', { className: 'empty-state' },
      el('h3', null, 'No projects'),
      el('p', null, state.searchQuery ? 'No projects match your search.' : 'Create your first project to get started.'),
      !state.searchQuery ? el('button', { className: 'btn btn-primary', onClick() { showNewProjectModal(onProjectsChanged); } }, '+ New Project') : null,
    ));
    return;
  }

  const panel = el('div', { className: 'panel' });
  const tbl = el('table', { className: 'data-table' });
  tbl.appendChild(el('caption', { className: 'sr-only' }, 'Projects'));
  const thead = el('thead', null, el('tr', null,
    el('th', { scope: 'col' }, 'Project No.'), el('th', { scope: 'col' }, 'Name'), el('th', { scope: 'col' }, 'Status'),
    el('th', { scope: 'col' }, 'Created'), el('th', { scope: 'col' }, 'By')));
  const tbody = el('tbody');
  tbl.appendChild(thead);
  filtered.forEach((p) => {
    const statusClass = p.status === 'active' ? 'badge-active' : p.status === 'complete' ? 'badge-complete' : 'badge-archived';
    const openProject = () => onOpenProject(p);
    tbody.appendChild(el('tr', {
      className: 'clickable-row', tabindex: '0', role: 'link',
      'aria-label': 'Open project ' + (p.displayNumber || p.projectNumber) + (p.name ? ', ' + p.name : ''),
      onClick: openProject,
      onKeydown(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProject(); } },
    },
      el('td', { className: 'mono', style: { fontWeight: '600' } }, p.displayNumber || p.projectNumber),
      el('td', null, p.name || '—'),
      el('td', null, el('span', { className: 'badge ' + statusClass }, p.status)),
      el('td', null, formatDate(p.createdAt)),
      el('td', null, p.createdBy || '—'),
    ));
  });
  tbl.appendChild(tbody);
  panel.appendChild(el('div', { className: 'table-scroll' }, tbl));
  container.appendChild(panel);
}

function showNewProjectModal(onProjectsChanged) {
  let number = '';
  let name = '';
  let submitting = false;
  const previouslyFocused = document.activeElement;
  const close = () => {
    document.removeEventListener('keydown', onEscape);
    backdrop.remove();
    previouslyFocused?.focus?.();
  };
  const onEscape = (e) => { if (e.key === 'Escape') close(); };
  const backdrop = el('div', { className: 'modal-backdrop', onClick(e) { if (e.target === backdrop) close(); } });
  const numInput = el('input', { id: 'new-project-number', className: 'form-input mono', type: 'text', placeholder: 'e.g. 24-105', required: 'true', onInput(e) { number = e.target.value; } });
  const nameInput = el('input', { id: 'new-project-name', className: 'form-input', type: 'text', placeholder: 'e.g. Smith Residence', onInput(e) { name = e.target.value; } });

  async function submit() {
    if (submitting) return;
    if (!number.trim()) { showToast('Project number is required.', 'warning'); return; }
    submitting = true;
    createButton.disabled = true;
    let result;
    try {
      result = await createProject(number.trim(), name.trim());
    } catch (error) {
      console.error('Failed to create project:', error);
      result = { success: false, error: 'Project creation failed. Please try again.' };
    }
    submitting = false;
    createButton.disabled = false;
    if (result.success) {
      close();
      showToast('Project ' + number + ' created.', 'success');
      try {
        await onProjectsChanged();
      } catch (error) {
        console.error('Failed to refresh projects:', error);
      }
    } else {
      showToast(result.error || 'Project creation failed. Please try again.', 'error');
    }
  }

  const createButton = el('button', { className: 'btn btn-primary', type: 'submit' }, 'Create');
  const dialog = el('form', { className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'new-project-title', onSubmit(e) { e.preventDefault(); submit(); } },
    el('div', { className: 'modal-header' }, el('h3', { id: 'new-project-title' }, 'New Project'), el('button', { className: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': 'Close new project dialog', onClick: close }, '×')),
    el('div', { className: 'modal-body' },
      el('div', { className: 'form-group' }, el('label', { className: 'form-label', htmlFor: 'new-project-number' }, 'Project Number'), numInput),
      el('div', { className: 'form-group' }, el('label', { className: 'form-label', htmlFor: 'new-project-name' }, 'Project Name'), nameInput),
    ),
    el('div', { className: 'modal-footer' },
      el('button', { className: 'btn', type: 'button', onClick: close }, 'Cancel'),
      createButton,
    ),
  );
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  document.addEventListener('keydown', onEscape);
  numInput.focus();
}
