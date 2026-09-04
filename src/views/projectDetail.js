import { el, clearEl, formatDate, showToast } from '../utils.js';
import { updateProjectStatus, deleteProject, archiveItem, restoreItem, listItems } from '../db.js';
import { DESIGN_ITEM_MODULES, getModule } from '../modules/registry.js';
import { exportItemPdf } from '../pdf.js';

export async function renderProjectDetail(container, state, { onBack, onOpenItem, onAddItem, onDeleted }) {
  clearEl(container);
  const p = state.currentProject;
  if (!p) { onBack(); return; }

  container.appendChild(el('div', { className: 'breadcrumb' },
    el('a', { href: '#', onClick(e) { e.preventDefault(); onBack(); } }, 'Projects'),
    el('span', { className: 'sep' }, '/'),
    el('span', { className: 'mono', style: { fontWeight: '600' } }, p.displayNumber || p.projectNumber),
  ));

  const statusSelect = el('select', { className: 'form-select', style: { width: 'auto', fontSize: '0.8rem', padding: '0.2rem 0.4rem' },
    async onInput(e) {
      await updateProjectStatus(p.projectNumber, e.target.value);
      p.status = e.target.value;
      showToast('Status updated.', 'success');
    },
  });
  ['active', 'complete', 'archived'].forEach((s) => {
    const opt = el('option', { value: s }, s.charAt(0).toUpperCase() + s.slice(1));
    if (p.status === s) opt.selected = true;
    statusSelect.appendChild(opt);
  });

  container.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' } },
    el('h1', null, p.name || 'Untitled'),
    el('span', { className: 'mono', style: { color: 'var(--ink-secondary)', fontSize: '0.95rem' } }, p.displayNumber || p.projectNumber),
    statusSelect,
  ));

  const items = await listItems(p.projectNumber);
  state.items = items;
  const activeItems = items.filter((it) => !it.archived);
  const archivedItems = items.filter((it) => it.archived);

  container.appendChild(el('div', { className: 'section-header' },
    el('h3', null, 'Calculations (' + activeItems.length + ')'),
    el('button', { className: 'btn btn-primary btn-sm', onClick() { showAddCalcModal(onAddItem); } }, '+ Add Calculation'),
  ));

  if (activeItems.length === 0) {
    container.appendChild(el('div', { className: 'panel' },
      el('div', { className: 'empty-state', style: { padding: '2rem 1rem' } }, el('p', null, 'No calculations yet. Add a design item to this project.')),
    ));
  } else {
    const panel = el('div', { className: 'panel' });
    activeItems.forEach((item) => {
      const mod = getModule(item.type);
      const isStale = mod && item.calcVersion !== mod.calcVersion;
      panel.appendChild(el('div', { className: 'item-row', onClick() { onOpenItem(item); } },
        el('div', { className: 'item-info' },
          el('div', { className: 'item-title' },
            item.label || (mod ? mod.label : item.type),
            el('span', { className: 'badge badge-type' }, mod ? mod.label : item.type),
            isStale ? el('span', { className: 'badge badge-stale' }, 'Stale') : null,
          ),
          el('div', { className: 'item-meta' }, el('span', null, item.enteredBy || '—'), el('span', null, formatDate(item.createdAt))),
        ),
        el('div', { className: 'item-actions' },
          el('button', { className: 'btn btn-ghost btn-sm', title: 'Export PDF', onClick(e) { e.stopPropagation(); exportItemPdf(p, item, mod); } }, 'PDF'),
          el('button', { className: 'btn btn-ghost btn-sm btn-danger', title: 'Archive',
            async onClick(e) { e.stopPropagation(); await archiveItem(item.id); showToast('Item archived.', 'success'); renderProjectDetail(container, state, { onBack, onOpenItem, onAddItem, onDeleted }); } }, 'Archive'),
        ),
      ));
    });
    container.appendChild(panel);
  }

  if (archivedItems.length > 0) {
    const details = el('details', { style: { marginTop: '1.5rem' } },
      el('summary', { style: { cursor: 'pointer', fontSize: '0.85rem', color: 'var(--ink-secondary)', fontWeight: '500' } }, 'Archived (' + archivedItems.length + ')'));
    const archPanel = el('div', { className: 'panel', style: { marginTop: '0.5rem' } });
    archivedItems.forEach((item) => {
      const mod = getModule(item.type);
      archPanel.appendChild(el('div', { className: 'item-row', style: { opacity: '0.6' } },
        el('div', { className: 'item-info' },
          el('div', { className: 'item-title' }, item.label || (mod ? mod.label : item.type), el('span', { className: 'badge badge-archived' }, 'Archived')),
          el('div', { className: 'item-meta' }, el('span', null, item.enteredBy || '—'), el('span', null, formatDate(item.createdAt))),
        ),
        el('div', { className: 'item-actions', style: { opacity: '1' } },
          el('button', { className: 'btn btn-ghost btn-sm',
            async onClick(e) { e.stopPropagation(); await restoreItem(item.id); showToast('Item restored.', 'success'); renderProjectDetail(container, state, { onBack, onOpenItem, onAddItem, onDeleted }); } }, 'Restore'),
        ),
      ));
    });
    details.appendChild(archPanel);
    container.appendChild(details);
  }

  container.appendChild(el('div', { style: { marginTop: '2rem' } },
    el('button', { className: 'btn btn-danger btn-sm',
      async onClick() {
        if (!confirm('Delete project ' + (p.displayNumber || p.projectNumber) + ' and all its calculations? This cannot be undone.')) return;
        await deleteProject(p.projectNumber);
        showToast('Project deleted.', 'success');
        onDeleted();
      },
    }, 'Delete Project'),
  ));
}

function showAddCalcModal(onAddItem) {
  const backdrop = el('div', { className: 'modal-backdrop', onClick(e) { if (e.target === backdrop) backdrop.remove(); } });
  const body = el('div', { className: 'modal-body' });
  DESIGN_ITEM_MODULES.forEach((mod) => {
    body.appendChild(el('button', {
      className: 'btn', style: { width: '100%', justifyContent: 'flex-start', marginBottom: '0.5rem', padding: '0.7rem 1rem' },
      onClick() { backdrop.remove(); onAddItem(mod.id); },
    }, el('span', { className: 'badge badge-type', style: { marginRight: '0.5rem' } }, mod.label.slice(0, 3).toUpperCase()), mod.label));
  });
  backdrop.appendChild(el('div', { className: 'modal' },
    el('div', { className: 'modal-header' }, el('h3', null, 'Add Calculation'), el('button', { className: 'btn btn-ghost btn-sm', onClick() { backdrop.remove(); } }, '×')),
    body,
  ));
  document.body.appendChild(backdrop);
}
