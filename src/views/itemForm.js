import { el, clearEl, formatDateTime, showToast } from '../utils.js';
import { saveItem, getItem } from '../db.js';
import { getModule } from '../modules/registry.js';
import { exportItemPdf } from '../pdf.js';
import { validateEngineeringInputs } from '../validation.js';

export async function renderItemForm(container, state, { moduleId, itemId, onBack, onSaved }) {
  clearEl(container);
  const p = state.currentProject;
  if (!p) { onBack(); return; }

  const isNew = !itemId;
  let item = null;
  let mod;

  if (isNew) {
    mod = getModule(moduleId);
    if (!mod) { onBack(); return; }
  } else {
    item = await getItem(itemId);
    if (!item) { onBack(); return; }
    mod = getModule(item.type);
    if (!mod) { onBack(); return; }
    if (mod.migrate) item = mod.migrate(item);
  }

  const newTitle = mod.noNewPrefix ? mod.label : 'New ' + mod.label;
  let customName = (!isNew && item.customName) ? item.customName : '';

  container.appendChild(el('div', { className: 'breadcrumb' },
    el('a', { href: '#', onClick(e) { e.preventDefault(); onBack(true); } }, 'Projects'),
    el('span', { className: 'sep' }, '/'),
    el('a', { href: '#', onClick(e) { e.preventDefault(); onBack(); } }, p.displayNumber || p.projectNumber),
    el('span', { className: 'sep' }, '/'),
    el('span', null, isNew ? newTitle : (customName || item.label || mod.label)),
  ));

  const nameRow = el('div', { style: { display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' } },
    el('input', { className: 'form-input', style: { maxWidth: '320px', fontWeight: '600', fontSize: '1.1rem' }, type: 'text',
      placeholder: mod.label, value: customName,
      onInput(e) { customName = e.target.value; markDirty(); } }),
    el('span', { className: 'badge badge-type' }, mod.label),
  );
  container.appendChild(nameRow);

  const dirtyBadge = el('span', { className: 'badge badge-stale', hidden: true, style: { fontSize: '0.78rem', transition: 'opacity 0.5s' } }, 'Unsaved changes');
  let savedTimer = null;
  function markDirty() {
    clearTimeout(savedTimer);
    dirtyBadge.hidden = false;
    dirtyBadge.className = 'badge badge-stale';
    dirtyBadge.textContent = 'Unsaved changes';
    dirtyBadge.style.opacity = '1';
  }
  function clearDirty() {
    clearTimeout(savedTimer);
    dirtyBadge.hidden = false;
    dirtyBadge.className = 'badge badge-pass';
    dirtyBadge.textContent = 'Saved';
    dirtyBadge.style.opacity = '1';
    savedTimer = setTimeout(() => { dirtyBadge.style.opacity = '0'; setTimeout(() => { dirtyBadge.hidden = true; }, 500); }, 2500);
  }

  const formBody = el('div', { className: 'panel-body' });
  container.appendChild(el('div', { className: 'panel' }, formBody));

  const showOutputs = !mod.noOutputSection;
  let outputSection = null;

  function renderOutputsInPlace(outputs) {
    if (!outputSection) return;
    if (!outputs) { outputSection.hidden = true; return; }
    outputSection.hidden = false;
    const body = outputSection.querySelector('.output-body');
    clearEl(body);
    mod.renderOutputs(body, outputs);
  }

  async function exportPdf() {
    if (!item) return;
    try {
      await exportItemPdf(p, item, mod);
    } catch (error) {
      console.error('Failed to export PDF:', error);
      showToast('PDF export failed.', 'error');
    }
  }

  if (showOutputs) {
    outputSection = el('div', { className: 'output-section', hidden: true },
      el('div', { className: 'output-header' },
        el('span', null, 'Results'),
        el('button', { className: 'btn btn-ghost btn-sm', onClick: exportPdf }, 'Export PDF'),
      ),
      el('div', { className: 'output-body' }),
    );
    container.appendChild(outputSection);
    if (!isNew && item.outputs) renderOutputsInPlace(item.outputs);
  }

  const statusRow = el('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'flex-end', marginTop: '0.5rem' } },
    dirtyBadge,
    !isNew ? el('button', { className: 'btn btn-ghost btn-sm', onClick: exportPdf }, 'Export PDF') : null,
  );
  container.appendChild(statusRow);

  const projectItems = state.items || [];

  mod.renderForm(formBody, isNew ? null : JSON.parse(JSON.stringify(item.inputs || {})), async (inputs) => {
    const validationErrors = validateEngineeringInputs(mod.id, inputs);
    if (validationErrors.length) {
      const visibleErrors = validationErrors.slice(0, 3).join(' ');
      const remainder = validationErrors.length > 3 ? ` (+${validationErrors.length - 3} more)` : '';
      showToast(`Complete the calculation before saving: ${visibleErrors}${remainder}`, 'error');
      return;
    }
    const resolvedRefs = {};
    if (mod.refs && mod.refs.length && inputs.refs) {
      for (const ref of mod.refs) {
        const refId = inputs.refs[ref.key];
        if (refId) {
          const refItem = await getItem(refId);
          if (refItem) resolvedRefs[ref.key] = ref.extract(refItem.outputs || {});
        }
      }
    }
    try {
      const savedId = await saveItem({ itemId: state._itemId, projectNumber: p.projectNumber, module: mod, inputs, resolvedRefs, customName });
      showToast(isNew ? 'Calculation saved.' : 'Calculation updated.', 'success');
      state._itemId = savedId;
      item = await getItem(savedId);
      if (mod.migrate) item = mod.migrate(item);
      renderOutputsInPlace(item.outputs);
      clearDirty();
      onSaved(savedId, true);
    } catch (e) {
      showToast('Error saving: ' + (e.message || ''), 'error');
    }
  }, projectItems, () => { markDirty(); });

  if (!isNew && item.revisions && item.revisions.length > 0) {
    const revList = el('div', { style: { marginTop: '0.5rem', fontSize: '0.82rem' } });
    item.revisions.slice().reverse().forEach((rev) => {
      revList.appendChild(el('div', { style: { padding: '0.4rem 0', borderBottom: '1px solid var(--border-light)', color: 'var(--ink-secondary)' } },
        formatDateTime(rev.updatedAt) + ' by ' + (rev.updatedBy || '—')));
    });
    container.appendChild(el('details', { style: { marginTop: '1rem' } },
      el('summary', { style: { cursor: 'pointer', fontSize: '0.85rem', color: 'var(--ink-secondary)', fontWeight: '500' } }, 'Revision History (' + item.revisions.length + ')'),
      revList,
    ));
  }
}
