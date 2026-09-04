import { el, clearEl, formatDateTime, showToast } from '../utils.js';
import { saveItem, getItem } from '../db.js';
import { getModule } from '../modules/registry.js';
import { exportItemPdf } from '../pdf.js';

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

  container.appendChild(el('div', { className: 'breadcrumb' },
    el('a', { href: '#', onClick(e) { e.preventDefault(); onBack(true); } }, 'Projects'),
    el('span', { className: 'sep' }, '/'),
    el('a', { href: '#', onClick(e) { e.preventDefault(); onBack(); } }, p.displayNumber || p.projectNumber),
    el('span', { className: 'sep' }, '/'),
    el('span', null, isNew ? newTitle : (item.label || mod.label)),
  ));

  container.appendChild(el('h2', { style: { marginBottom: '1rem' } }, isNew ? newTitle : mod.label));

  const formBody = el('div', { className: 'panel-body' });
  container.appendChild(el('div', { className: 'panel' }, formBody));

  const projectItems = state.items || [];

  mod.renderForm(formBody, isNew ? null : JSON.parse(JSON.stringify(item.inputs || {})), async (inputs) => {
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
      const savedId = await saveItem({ itemId, projectNumber: p.projectNumber, module: mod, inputs, resolvedRefs });
      showToast(isNew ? 'Calculation saved.' : 'Calculation updated.', 'success');
      onSaved(savedId);
    } catch (e) {
      showToast('Error saving: ' + (e.message || ''), 'error');
    }
  }, projectItems);

  if (!isNew && item.outputs) {
    const outputBody = el('div', { className: 'output-body' });
    container.appendChild(el('div', { className: 'output-section' },
      el('div', { className: 'output-header' },
        el('span', null, 'Results'),
        el('button', { className: 'btn btn-ghost btn-sm', onClick() { exportItemPdf(p, item, mod); } }, 'Export PDF'),
      ),
      outputBody,
    ));
    mod.renderOutputs(outputBody, item.outputs);
  }

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
