import { el, clearEl, formatDate, showToast } from '../utils.js';
import { updateProjectStatus, deleteProject, archiveItem, restoreItem, listItems } from '../db.js';
import { DESIGN_ITEM_MODULES, getModule } from '../modules/registry.js';
import { exportItemPdf } from '../pdf.js';
import { linkChanges } from '../results.js';

export async function renderProjectDetail(container, state, { onBack, onOpenItem, onAddItem, onDeleted }) {
  clearEl(container);
  const p = state.currentProject;
  if (!p) { onBack(); return; }

  container.appendChild(el('div', { className: 'breadcrumb' },
    el('a', { href: '#', onClick(e) { e.preventDefault(); onBack(); } }, 'Projects'),
    el('span', { className: 'sep' }, '/'),
    el('span', { className: 'mono', style: { fontWeight: '600' } }, p.displayNumber || p.projectNumber),
  ));

  const statusSelect = el('select', { className: 'form-select', 'aria-label': 'Project status', style: { width: 'auto', fontSize: '0.8rem', padding: '0.2rem 0.4rem' },
    async onInput(e) {
      const previousStatus = p.status;
      const nextStatus = e.target.value;
      e.target.disabled = true;
      try {
        await updateProjectStatus(p.projectNumber, nextStatus);
        p.status = nextStatus;
        showToast('Status updated.', 'success');
      } catch (error) {
        console.error('Failed to update project status:', error);
        e.target.value = previousStatus;
        showToast('Project status could not be updated.', 'error');
      } finally {
        e.target.disabled = false;
      }
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

  let items = [];
  try {
    items = await listItems(p.projectNumber);
  } catch (error) {
    console.error('Failed to load calculations:', error);
    container.appendChild(el('div', { className: 'error-banner', role: 'alert' }, 'Calculations could not be loaded. Refresh the page to try again.'));
    showToast('Calculations could not be loaded.', 'error');
  }
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
      const changes = mod ? linkChanges(mod, item, items) : [];
      const changesTip = changes.slice(0, 4).map(c => c.source + ': ' + c.label + (c.missing ? '' : ' ' + c.from + ' → ' + c.to)).join('\n')
        + (changes.length > 4 ? '\n+' + (changes.length - 4) + ' more' : '') + '\nOpen the item and click "Update from linked items".';
      panel.appendChild(el('div', { className: 'item-row' },
        el('button', { className: 'item-info item-open-button', type: 'button', 'aria-label': 'Open calculation ' + (item.customName || item.label || (mod ? mod.label : item.type)), onClick() { onOpenItem(item); } },
          el('div', { className: 'item-title' },
            item.customName || item.label || (mod ? mod.label : item.type),
            el('span', { className: 'badge badge-type' }, mod ? mod.label : item.type),
            isStale ? el('span', { className: 'badge badge-stale', title: mod && mod.regenerateResults
              ? 'Saved with an older calc version. Results shown are recalculated with the current version; re-save to refresh the saved record.'
              : 'Saved with an older calc version — re-save to update the results.' }, 'Stale') : null,
            changes.length ? el('span', { className: 'badge badge-stale', title: changesTip }, 'Upstream changed') : null,
          ),
          el('div', { className: 'item-meta' }, el('span', null, item.enteredBy || '—'), el('span', null, formatDate(item.createdAt))),
        ),
        el('div', { className: 'item-actions' },
          el('button', { className: 'btn btn-ghost btn-sm', title: 'Export PDF', 'aria-label': 'Export calculation as PDF', async onClick() {
            try { await exportItemPdf(p, item, mod, { items }); } catch (error) { console.error('Failed to export PDF:', error); showToast('PDF export failed.', 'error'); }
          } }, 'PDF'),
          el('button', { className: 'btn btn-ghost btn-sm btn-danger', title: 'Archive',
            async onClick() {
              try {
                await archiveItem(item.id);
                showToast('Item archived.', 'success');
                await renderProjectDetail(container, state, { onBack, onOpenItem, onAddItem, onDeleted });
              } catch (error) {
                console.error('Failed to archive calculation:', error);
                showToast('Calculation could not be archived.', 'error');
              }
            } }, 'Archive'),
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
            async onClick() {
              try {
                await restoreItem(item.id);
                showToast('Item restored.', 'success');
                await renderProjectDetail(container, state, { onBack, onOpenItem, onAddItem, onDeleted });
              } catch (error) {
                console.error('Failed to restore calculation:', error);
                showToast('Calculation could not be restored.', 'error');
              }
            } }, 'Restore'),
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
        try {
          await deleteProject(p.projectNumber);
          showToast('Project deleted.', 'success');
          onDeleted();
        } catch (error) {
          console.error('Failed to delete project:', error);
          showToast('Project could not be deleted.', 'error');
        }
      },
    }, 'Delete Project'),
  ));
}

function showAddCalcModal(onAddItem) {
  const previouslyFocused = document.activeElement;
  const close = () => {
    document.removeEventListener('keydown', onEscape);
    backdrop.remove();
    previouslyFocused?.focus?.();
  };
  const onEscape = (e) => { if (e.key === 'Escape') close(); };
  const backdrop = el('div', { className: 'modal-backdrop', onClick(e) { if (e.target === backdrop) close(); } });
  const body = el('div', { className: 'modal-body' });
  DESIGN_ITEM_MODULES.forEach((mod) => {
    body.appendChild(el('button', {
      className: 'btn', style: { width: '100%', justifyContent: 'flex-start', marginBottom: '0.5rem', padding: '0.7rem 1rem' },
      onClick() { close(); onAddItem(mod.id); },
    }, el('span', { className: 'badge badge-type', style: { marginRight: '0.5rem' } }, mod.label.slice(0, 3).toUpperCase()), mod.label));
  });
  backdrop.appendChild(el('div', { className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'add-calculation-title' },
    el('div', { className: 'modal-header' }, el('h3', { id: 'add-calculation-title' }, 'Add Calculation'), el('button', { className: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': 'Close add calculation dialog', onClick: close }, '×')),
    body,
  ));
  document.body.appendChild(backdrop);
  document.addEventListener('keydown', onEscape);
  body.querySelector('button')?.focus();
}
