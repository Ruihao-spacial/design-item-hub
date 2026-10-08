import { el, clearEl, formatDateTime, showToast } from '../utils.js';
import { saveItem, getItem } from '../db.js';
import { getModule } from '../modules/registry.js';
import { exportItemPdf } from '../pdf.js';
import { validateEngineeringInputs } from '../validation.js';
import { currentOutputs, linkChanges, applyLinkUpdates } from '../results.js';

// Refs for saving, read fresh from the database
async function resolveRefs(mod, inputs) {
  const resolvedRefs = {};
  if (mod.refs && mod.refs.length && inputs && inputs.refs) {
    for (const ref of mod.refs) {
      const refId = inputs.refs[ref.key];
      if (refId) {
        const refItem = await getItem(refId);
        if (refItem) resolvedRefs[ref.key] = ref.extract(refItem.outputs || {});
      }
    }
  }
  return resolvedRefs;
}

// Modules with regenerateResults treat the stored definition (inputs) as the source of truth:
// results are recalculated with the current calc instead of trusting the stored snapshot.
function withCurrentResults(mod, item, projectItems) {
  if (!mod.regenerateResults || !item) return item;
  return { ...item, outputs: currentOutputs(mod, item, projectItems) };
}

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
    item = withCurrentResults(mod, item, state.items || []);
  }

  container.classList.toggle('main-content--wide', !!mod.wideLayout);

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

  // Report toolbar at the top of every calculator (user request 2026-10-01): Export PDF, plus a report dropdown when
  // the module declares mod.pdfOptions = { key, label, options: [[value, label]] }. The dropdown writes inputs[key]
  // through the form hook (saved with the next Calculate & Save) and applies to this export straight away.
  const formHooks = {};
  let pdfChoice = null;
  const pdfToolbar = el('div', { className: 'pdf-toolbar', style: { display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'flex-end', marginBottom: '0.75rem', flexWrap: 'wrap' } });
  if (mod.pdfOptions) {
    const o = mod.pdfOptions;
    pdfChoice = (item && item.inputs && item.inputs[o.key]) || o.options[0][0];
    const sel = el('select', { className: 'form-select', style: { width: 'auto' }, onChange(e) {
      pdfChoice = e.target.value;
      if (formHooks.setInput) formHooks.setInput(o.key, pdfChoice);
    } });
    o.options.forEach(([v, label]) => sel.appendChild(el('option', { value: v, selected: v === pdfChoice }, label)));
    pdfToolbar.appendChild(el('label', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', display: 'flex', alignItems: 'center', gap: '0.35rem' } }, o.label, sel));
  }
  pdfToolbar.appendChild(el('button', { className: 'btn btn-sm btn-primary', type: 'button', disabled: isNew,
    title: isNew ? 'Save the calculation first' : 'Export this calculation as a PDF', onClick: () => exportPdf() }, 'Export PDF'));
  container.appendChild(pdfToolbar);

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

  // Linked values that changed in upstream items: list them, offer Update (fills the form, not saved) / Dismiss
  const linkNotice = el('div', { className: 'panel', hidden: true, style: { marginBottom: '0.75rem', borderColor: 'var(--stale)' } });
  container.appendChild(linkNotice);
  function renderLinkNotice() {
    clearEl(linkNotice);
    const changes = isNew ? [] : linkChanges(mod, item, state.items || []);
    linkNotice.hidden = !changes.length;
    if (!changes.length) return;
    const fmt = (v) => v == null || v === '' ? '—' : String(v);
    const body = el('div', { className: 'panel-body', style: { fontSize: '0.85rem' } },
      el('div', { style: { fontWeight: '600', marginBottom: '0.35rem' } }, '⚠ Linked values changed upstream'));
    const bySource = new Map();
    changes.forEach(c => { if (!bySource.has(c.source)) bySource.set(c.source, []); bySource.get(c.source).push(c); });
    for (const [source, list] of bySource) {
      body.appendChild(el('div', { style: { color: 'var(--ink-secondary)', marginTop: '0.25rem' } }, source + ':'));
      list.forEach(c => body.appendChild(el('div', { className: 'mono', style: { marginLeft: '1rem', fontSize: '0.8rem' } },
        c.missing ? c.label : c.label + '  ' + fmt(c.from) + ' → ' + fmt(c.to))));
    }
    body.appendChild(el('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '0.5rem' } },
      el('button', { className: 'btn btn-sm btn-primary', type: 'button', onClick() {
        item = { ...item, inputs: applyLinkUpdates(mod, item.inputs, state.items || [], item.id) };
        linkNotice.hidden = true;
        renderModuleForm(item.inputs);
        markDirty();
        showToast('Linked values updated — review, then Calculate & Save.', 'success');
      } }, 'Update from linked items'),
      el('button', { className: 'btn btn-sm btn-ghost', type: 'button', onClick() { linkNotice.hidden = true; } }, 'Dismiss')));
    linkNotice.appendChild(body);
  }
  renderLinkNotice();

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
    // A results bug must never take the form down with it
    try {
      mod.renderOutputs(body, outputs);
    } catch (e) {
      console.error('Rendering results failed:', e);
      clearEl(body);
      body.appendChild(el('span', { className: 'badge badge-fail' }, 'Results could not be displayed — click Calculate & Save to refresh'));
    }
  }

  async function exportPdf() {
    if (!item) return;
    try {
      const forExport = mod.pdfOptions && pdfChoice ? { ...item, inputs: { ...(item.inputs || {}), [mod.pdfOptions.key]: pdfChoice } } : item;
      await exportItemPdf(p, forExport, mod, { items: state.items || [] });
    } catch (error) {
      console.error('Failed to export PDF:', error);
      showToast('PDF export failed.', 'error');
    }
  }

  if (showOutputs) {
    outputSection = el('div', { className: 'output-section', hidden: true },
      el('div', { className: 'output-header' },
        el('span', null, 'Results'),
      ),
      el('div', { className: 'output-body' }),
    );
    container.appendChild(outputSection);
    if (!isNew && item.outputs) renderOutputsInPlace(item.outputs);
  }

  const statusRow = el('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'flex-end', marginTop: '0.5rem' } },
    dirtyBadge,
  );
  container.appendChild(statusRow);

  const projectItems = state.items || [];

  function renderModuleForm(formInputs) {
    clearEl(formBody);
    mod.renderForm(formBody, formInputs ? JSON.parse(JSON.stringify(formInputs)) : null, async (inputs) => {
      const validationErrors = validateEngineeringInputs(mod.id, inputs);
      if (validationErrors.length) {
        const visibleErrors = validationErrors.slice(0, 3).join(' ');
        const remainder = validationErrors.length > 3 ? ` (+${validationErrors.length - 3} more)` : '';
        showToast(`Complete the calculation before saving: ${visibleErrors}${remainder}`, 'error');
        return;
      }
      const resolvedRefs = await resolveRefs(mod, inputs);
      try {
        const savedId = await saveItem({ itemId: state._itemId, projectNumber: p.projectNumber, module: mod, inputs, resolvedRefs, customName });
        showToast(isNew ? 'Calculation saved.' : 'Calculation updated.', 'success');
        state._itemId = savedId;
        const saved = await getItem(savedId);
        // Keep the in-memory project list current so link checks see the saved values
        if (Array.isArray(state.items)) {
          const i = state.items.findIndex(x => x.id === savedId);
          if (i >= 0) state.items[i] = saved; else state.items.push(saved);
        }
        item = mod.migrate ? mod.migrate(saved) : saved;
        item = withCurrentResults(mod, item, state.items || []);
        renderOutputsInPlace(item.outputs);
        renderLinkNotice();
        clearDirty();
        onSaved(savedId, true);
      } catch (e) {
        showToast('Error saving: ' + (e.message || ''), 'error');
      }
    }, projectItems, () => { markDirty(); }, formHooks);
  }
  renderModuleForm(isNew ? null : item.inputs || {});

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
