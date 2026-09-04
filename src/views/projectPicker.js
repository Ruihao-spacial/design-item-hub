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

  const statusTabs = el('div', { className: 'filter-tabs' });
  ['active', 'complete', 'archived', 'all'].forEach((s) => {
    statusTabs.appendChild(el('button', {
      className: 'filter-tab' + (state.statusFilter === s ? ' active' : ''),
      onClick() { state.statusFilter = s; renderProjectPicker(container, state, { onOpenProject, onProjectsChanged }); },
    }, s.charAt(0).toUpperCase() + s.slice(1)));
  });

  const searchInput = el('input', {
    className: 'search-input', type: 'text', placeholder: 'Search projects…', value: state.searchQuery || '',
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
  tbl.appendChild(el('tr', null, el('th', null, 'Project No.'), el('th', null, 'Name'), el('th', null, 'Status'), el('th', null, 'Created'), el('th', null, 'By')));
  filtered.forEach((p) => {
    const statusClass = p.status === 'active' ? 'badge-active' : p.status === 'complete' ? 'badge-complete' : 'badge-archived';
    tbl.appendChild(el('tr', { style: { cursor: 'pointer' }, onClick() { onOpenProject(p); } },
      el('td', { className: 'mono', style: { fontWeight: '600' } }, p.displayNumber || p.projectNumber),
      el('td', null, p.name || '—'),
      el('td', null, el('span', { className: 'badge ' + statusClass }, p.status)),
      el('td', null, formatDate(p.createdAt)),
      el('td', null, p.createdBy || '—'),
    ));
  });
  panel.appendChild(el('div', { className: 'table-scroll' }, tbl));
  container.appendChild(panel);
}

function showNewProjectModal(onProjectsChanged) {
  let number = '';
  let name = '';
  const backdrop = el('div', { className: 'modal-backdrop', onClick(e) { if (e.target === backdrop) backdrop.remove(); } });
  const numInput = el('input', { className: 'form-input mono', type: 'text', placeholder: 'e.g. 24-105', onInput(e) { number = e.target.value; } });
  const nameInput = el('input', { className: 'form-input', type: 'text', placeholder: 'e.g. Smith Residence', onInput(e) { name = e.target.value; } });

  async function submit() {
    if (!number.trim()) { showToast('Project number is required.', 'warning'); return; }
    const result = await createProject(number.trim(), name.trim());
    if (result.success) {
      backdrop.remove();
      showToast('Project ' + number + ' created.', 'success');
      onProjectsChanged();
    } else {
      showToast(result.error, 'warning');
    }
  }

  backdrop.appendChild(el('div', { className: 'modal' },
    el('div', { className: 'modal-header' }, el('h3', null, 'New Project'), el('button', { className: 'btn btn-ghost btn-sm', onClick() { backdrop.remove(); } }, '×')),
    el('div', { className: 'modal-body' },
      el('div', { className: 'form-group' }, el('label', { className: 'form-label' }, 'Project Number'), numInput),
      el('div', { className: 'form-group' }, el('label', { className: 'form-label' }, 'Project Name'), nameInput),
    ),
    el('div', { className: 'modal-footer' },
      el('button', { className: 'btn', onClick() { backdrop.remove(); } }, 'Cancel'),
      el('button', { className: 'btn btn-primary', onClick: submit }, 'Create'),
    ),
  ));
  document.body.appendChild(backdrop);
  numInput.focus();
}
