import { el, clearEl, numOrBlank } from '../utils.js';
import { ASSEMBLY_TYPES, computeMaterialPsf } from './flatLoadMaterials.js';

let nextTabId = 1;
let nextItemId = 1;

function newTab(type) {
  const def = ASSEMBLY_TYPES[type];
  const tab = {
    id: 'tab' + (nextTabId++),
    type,
    name: def.defaultName,
    description: '',
    layers: {},
    items: [],
    liveLoad: def.hasLiveLoad ? def.defaultLL : null,
    includeLLinSeismic: false,
    seismicLLPercent: 25,
    roofSlope: '',
  };
  for (const layer of def.layers) tab.layers[layer.key] = { selectedIdx: 0, thickness: null, quantity: 1 };
  return tab;
}

// Migrate a saved item from schemaVersion 1 (separate `allowances` map +
// `custom` array) to schemaVersion 2 (a single unified `items` array).
function migrateTab(tab, def) {
  if (tab.items) return tab;
  const items = [];
  if (tab.allowances && def.allowances) {
    Object.keys(tab.allowances).forEach((idxStr) => {
      const idx = parseInt(idxStr, 10);
      const st = tab.allowances[idx];
      const preset = def.allowances.items[idx];
      if (!st || !st.checked || !preset) return;
      items.push({
        id: 'item' + (nextItemId++), kind: 'preset', presetIndex: idx, name: preset.name, psf: preset.psf,
        category: 'superimposed', coverageEligible: !!preset.coverageEligible, coveragePercent: st.coveragePercent,
      });
    });
  }
  if (Array.isArray(tab.custom)) {
    tab.custom.forEach((c) => {
      items.push({
        id: 'item' + (nextItemId++), kind: 'custom', name: c.name || '', psf: c.psf, perInch: c.perInch, thickness: c.thickness,
        category: c.category || 'superimposed', coverageEligible: !!c.coverageEligible, coveragePercent: c.coveragePercent,
      });
    });
  }
  return { ...tab, items, description: tab.description || '', roofSlope: tab.roofSlope || '' };
}

function buildSelectOptions(select, materials, selectedIdx) {
  clearEl(select);
  const hasGroups = materials.some((m) => m.group);
  const addOption = (m, i) => {
    const opt = el('option', { value: String(i) }, m.name + (m.kind === 'perInch' ? ' (per inch)' : ''));
    if (i === selectedIdx) opt.selected = true;
    return opt;
  };
  if (!hasGroups) {
    materials.forEach((m, i) => select.appendChild(addOption(m, i)));
    return;
  }
  const groups = new Map();
  const order = [];
  materials.forEach((m, i) => {
    const g = m.group || '';
    if (!groups.has(g)) { groups.set(g, []); order.push(g); }
    groups.get(g).push({ m, i });
  });
  order.forEach((g) => {
    if (g === '') {
      groups.get(g).forEach(({ m, i }) => select.appendChild(addOption(m, i)));
    } else {
      const optgroup = el('optgroup', { label: g });
      groups.get(g).forEach(({ m, i }) => optgroup.appendChild(addOption(m, i)));
      select.appendChild(optgroup);
    }
  });
}

// ASCE 7 §4.8.2 slope reduction factor R2, applied to the base (unreduced)
// roof live load Lo. Returns null when slope is empty/zero (no reduction).
function computeSlopeReducedLr(Lo, slopeRisePerFt) {
  const F = parseFloat(slopeRisePerFt);
  if (!F || F <= 0) return null;
  let R2;
  let r2Formula;
  if (F <= 4) { R2 = 1.0; r2Formula = 'F = ' + F + ' ≤ 4  →  R2 = 1.00'; }
  else if (F < 12) { R2 = 1.2 - 0.05 * F; r2Formula = 'R2 = 1.2 − 0.05×' + F + ' = ' + R2.toFixed(2); }
  else { R2 = 0.6; r2Formula = 'F = ' + F + ' ≥ 12  →  R2 = 0.60'; }
  const raw = Lo * R2;
  const Lr = Math.round(Math.max(12, Math.min(20, raw)) * 10) / 10;
  const equation = r2Formula + ';  Lr = ' + Lo + ' × ' + R2.toFixed(2) + ' = ' + raw.toFixed(1) + ' psf (12–20 psf range)  →  ' + Lr.toFixed(1) + ' psf';
  return { R2, Lr, equation };
}

function computeTabTotals(tab) {
  const def = ASSEMBLY_TYPES[tab.type];
  let dl = 0;
  let sdlGravity = 0;
  let sdlLateral = 0;

  for (const layer of def.layers) {
    const ls = tab.layers[layer.key];
    if (!ls) continue;
    const mat = layer.materials[ls.selectedIdx];
    const psf = computeMaterialPsf(mat, ls);
    if (layer.loadCategory === 'framing') dl += psf;
    else { sdlGravity += psf; sdlLateral += psf; }
  }

  for (const it of (tab.items || [])) {
    const psf = it.perInch ? (parseFloat(it.psf) || 0) * (parseFloat(it.thickness) || 0) : (parseFloat(it.psf) || 0);
    if (it.category === 'framing') { dl += psf; continue; }
    sdlGravity += psf;
    if (it.coverageEligible) {
      const coverage = it.coveragePercent != null && it.coveragePercent !== '' ? parseFloat(it.coveragePercent) : 100;
      sdlLateral += psf * (coverage / 100);
    } else {
      sdlLateral += psf;
    }
  }

  const llGravity = def.hasLiveLoad ? (parseFloat(tab.liveLoad) || 0) : 0;
  const llSeismic = def.hasLiveLoad && tab.includeLLinSeismic
    ? llGravity * ((parseFloat(tab.seismicLLPercent) || 0) / 100)
    : 0;

  const round1 = (v) => Math.round(v * 10) / 10;
  dl = round1(dl); sdlGravity = round1(sdlGravity); sdlLateral = round1(sdlLateral);
  const gravityTotal = round1(dl + sdlGravity + llGravity);
  const lateralTotal = round1(dl + sdlLateral + llSeismic);

  return { dl, sdlGravity, sdlLateral, llGravity: round1(llGravity), llSeismic: round1(llSeismic), gravityTotal, lateralTotal };
}

export const flatLoadCalculator = {
  id: 'flat_load_calculator',
  label: 'Flat Load Calculator',
  schemaVersion: 2,
  calcVersion: 'v1',
  noNewPrefix: true,
  refs: [],
  fields: [
    { key: 'tabs', label: 'Assemblies', type: 'text' },
  ],
  outputFields: [
    { key: 'perTab', label: 'Per-Assembly Loads', type: 'table', columns: [
      { key: 'name', label: 'Assembly', unit: '' },
      { key: 'description', label: 'Description', unit: '' },
      { key: 'dl', label: 'DL', unit: 'psf', precision: 1 },
      { key: 'sdlGravity', label: 'SDL (gravity)', unit: 'psf', precision: 1 },
      { key: 'sdlLateral', label: 'SDL (lateral)', unit: 'psf', precision: 1 },
      { key: 'gravityTotal', label: 'Gravity Total', unit: 'psf', precision: 1 },
      { key: 'lateralTotal', label: 'Lateral Total', unit: 'psf', precision: 1 },
    ] },
  ],

  migrate(item) {
    if (!item.inputs || !item.inputs.tabs) return item;
    const tabs = item.inputs.tabs.map((tab) => migrateTab(tab, ASSEMBLY_TYPES[tab.type]));
    return { ...item, inputs: { ...item.inputs, tabs }, schemaVersion: 2 };
  },

  summaryLabel(inputs) {
    const n = inputs.tabs ? inputs.tabs.length : 0;
    return 'Flat Load Calc — ' + n + ' assembl' + (n === 1 ? 'y' : 'ies');
  },

  calc(inputs) {
    const tabs = inputs.tabs || [];
    const perTab = tabs.map((tab) => {
      const def = ASSEMBLY_TYPES[tab.type];
      const totals = computeTabTotals(tab);
      return {
        id: tab.id, name: tab.name, description: tab.description || '', type: tab.type,
        hasLiveLoad: def.hasLiveLoad, llLabel: def.llLabel || 'Live Load', ...totals,
      };
    });
    return { perTab, calcVersion: 'v1' };
  },

  renderForm(container, existingInputs, onSave) {
    const inputs = existingInputs && existingInputs.tabs
      ? existingInputs
      : { tabs: [newTab('roof'), newTab('floor'), newTab('extWall')] };
    clearEl(container);

    let activeTabId = inputs.tabs.length ? inputs.tabs[0].id : null;

    const tabBar = el('div', { className: 'filter-tabs', style: { flexWrap: 'wrap', marginBottom: '0.75rem' } });
    const addTabSelect = el('select', { className: 'form-select', style: { width: 'auto', display: 'inline-block', marginBottom: '0.75rem' } },
      el('option', { value: '' }, '+ Add assembly…'),
      ...Object.keys(ASSEMBLY_TYPES).map((k) => el('option', { value: k }, ASSEMBLY_TYPES[k].label)),
    );
    addTabSelect.addEventListener('change', () => {
      if (!addTabSelect.value) return;
      const tab = newTab(addTabSelect.value);
      inputs.tabs.push(tab);
      activeTabId = tab.id;
      addTabSelect.value = '';
      renderAll();
    });

    const bodyContainer = el('div');

    function renderTabBar() {
      clearEl(tabBar);
      inputs.tabs.forEach((tab) => {
        const def = ASSEMBLY_TYPES[tab.type];
        const totals = computeTabTotals(tab);
        const btn = el('button', {
          className: 'filter-tab' + (tab.id === activeTabId ? ' active' : ''),
          type: 'button',
          onClick() { activeTabId = tab.id; renderAll(); },
        }, def.short + ' — ' + tab.name + ' (' + totals.gravityTotal.toFixed(1) + ' psf)');
        tabBar.appendChild(btn);
      });
    }

    function recalcAndRerenderOutputs() {
      renderTabBody();
    }

    function renderTabBody() {
      clearEl(bodyContainer);
      const tab = inputs.tabs.find((t) => t.id === activeTabId);
      if (!tab) {
        bodyContainer.appendChild(el('div', { className: 'empty-state' }, el('p', null, 'Add an assembly tab to begin.')));
        return;
      }
      const def = ASSEMBLY_TYPES[tab.type];

      const headerRow = el('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' } },
        el('input', { className: 'form-input', style: { maxWidth: '220px' }, type: 'text', value: tab.name,
          onInput(e) { tab.name = e.target.value; renderTabBar(); } }),
        el('button', { className: 'btn btn-danger btn-sm', type: 'button',
          onClick() {
            inputs.tabs = inputs.tabs.filter((t) => t.id !== tab.id);
            activeTabId = inputs.tabs.length ? inputs.tabs[0].id : null;
            renderAll();
          } }, 'Remove Assembly'),
      );
      bodyContainer.appendChild(headerRow);
      bodyContainer.appendChild(el('div', { className: 'form-group' },
        el('input', { className: 'form-input', type: 'text', placeholder: 'Description (optional — shown in the summary table)', value: tab.description || '',
          onInput(e) { tab.description = e.target.value; } }),
      ));

      if (def.note) {
        bodyContainer.appendChild(el('div', { className: 'offline-banner', style: { color: 'var(--ink-secondary)', background: 'var(--surface)', borderColor: 'var(--border)' } }, def.note));
      }

      // Live load row
      if (def.hasLiveLoad) {
        const slopeActive = def.hasSlopeReduction && parseFloat(tab.roofSlope) > 0;
        const slopeResult = slopeActive ? computeSlopeReducedLr(def.defaultLL, tab.roofSlope) : null;
        if (slopeActive && slopeResult) tab.liveLoad = slopeResult.Lr;

        const matchingPresetIdx = def.llPresets.findIndex((p) => p.psf === tab.liveLoad);
        const llPreset = el('select', { className: 'form-select', style: { maxWidth: '260px' }, disabled: slopeActive },
          el('option', { value: '', selected: matchingPresetIdx === -1 }, '— Preset —'),
          ...def.llPresets.map((p, i) => el('option', { value: String(i), selected: i === matchingPresetIdx }, p.label)),
        );
        llPreset.addEventListener('change', () => {
          if (llPreset.value === '') return;
          tab.liveLoad = def.llPresets[parseInt(llPreset.value, 10)].psf;
          renderTabBody();
          renderTabBar();
        });
        const llInput = el('input', { className: 'form-input mono', style: { maxWidth: '100px' }, type: 'number', value: numOrBlank(tab.liveLoad), disabled: slopeActive,
          onChange(e) { tab.liveLoad = e.target.value; renderTabBar(); recalcAndRerenderOutputs(); } });
        const seismicToggle = el('input', { type: 'checkbox', checked: tab.includeLLinSeismic,
          onInput(e) { tab.includeLLinSeismic = e.target.checked; renderTabBody(); } });
        const seismicPercentInput = el('input', { className: 'form-input mono', style: { maxWidth: '80px' }, type: 'number', value: tab.seismicLLPercent, disabled: !tab.includeLLinSeismic,
          onChange(e) { tab.seismicLLPercent = e.target.value; recalcAndRerenderOutputs(); } });

        const llWarn = (parseFloat(tab.liveLoad) || 0) >= 100
          ? el('span', { className: 'badge badge-stale' }, 'LL ≥ 100 psf — consider including in seismic weight')
          : null;

        const llGroup = el('div', { className: 'form-group panel', style: { padding: '0.75rem' } },
          el('label', { className: 'form-label' }, 'Design Live Load'),
          el('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' } },
            llPreset, llInput, el('span', { className: 'mono' }, 'psf'), llWarn,
          ),
          el('div', { style: { fontSize: '0.75rem', color: 'var(--ink-tertiary)', marginTop: '0.4rem' } }, def.llRef),
        );

        if (def.hasSlopeReduction) {
          llGroup.appendChild(el('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.6rem', flexWrap: 'wrap' } },
            el('span', { style: { fontSize: '0.85rem', fontWeight: '500' } }, 'Roof Slope'),
            el('input', { className: 'mono', style: { width: '60px', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.3rem' }, type: 'number', min: '0', placeholder: '0', value: tab.roofSlope,
              onChange(e) { tab.roofSlope = e.target.value; renderTabBody(); renderTabBar(); } }),
            el('span', { className: 'mono', style: { fontSize: '0.8rem', color: 'var(--ink-secondary)' } }, ': 12  (rise:run — leave blank/0 for flat/manual entry)'),
          ));
          if (slopeResult) {
            llGroup.appendChild(el('div', { className: 'mono', style: { fontSize: '0.78rem', color: 'var(--accent)', marginTop: '0.4rem', background: 'var(--accent-bg)', padding: '0.4rem 0.6rem', borderRadius: '3px' } },
              slopeResult.equation));
          }
        }

        llGroup.appendChild(el('label', { style: { display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.6rem', fontSize: '0.85rem' } },
          seismicToggle, 'Include in seismic weight at', seismicPercentInput, '%  (ASCE 7 §12.7.2 — storage/heavy occupancy)',
        ));
        bodyContainer.appendChild(llGroup);
      }

      // Layers
      const layersPanel = el('div', { className: 'panel', style: { padding: '0.75rem', marginBottom: '0.75rem' } });
      layersPanel.appendChild(el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 2fr 70px 70px 90px', gap: '0.75rem', marginBottom: '0.4rem', paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)' } },
        el('span', { className: 'form-label', style: { margin: 0 } }, 'Layer'),
        el('span', { className: 'form-label', style: { margin: 0 } }, 'Material'),
        el('span', { className: 'form-label', style: { margin: 0 } }, 'Thick (in)'),
        el('span', { className: 'form-label', style: { margin: 0 } }, 'Qty'),
        el('span', { className: 'form-label', style: { margin: 0, textAlign: 'right' } }, 'Load'),
      ));
      def.layers.forEach((layer) => {
        const ls = tab.layers[layer.key];
        const mat = layer.materials[ls.selectedIdx];
        const isPerInch = mat && mat.kind === 'perInch';
        const row = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 2fr 70px 70px 90px', gap: '0.75rem', alignItems: 'center', marginBottom: '0.5rem' } });
        row.appendChild(el('div', null, el('span', { style: { fontWeight: '600', fontSize: '0.85rem' } }, layer.label), layer.sub ? el('div', { style: { fontSize: '0.72rem', color: 'var(--ink-tertiary)' } }, layer.sub) : null));
        const select = el('select', { className: 'form-select' });
        buildSelectOptions(select, layer.materials, ls.selectedIdx);
        select.addEventListener('change', () => {
          ls.selectedIdx = parseInt(select.value, 10);
          const newMat = layer.materials[ls.selectedIdx];
          ls.thickness = newMat && newMat.kind === 'perInch' ? (newMat.defaultThick || 1) : null;
          renderTabBody(); renderTabBar();
        });
        row.appendChild(select);
        row.appendChild(isPerInch
          ? el('input', { className: 'mono', style: { width: '60px', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.3rem' }, type: 'number', step: '0.25', value: numOrBlank(ls.thickness),
              onChange(e) { ls.thickness = e.target.value; renderTabBar(); recalcAndRerenderOutputs(); } })
          : el('span'));
        row.appendChild(el('input', { className: 'mono', title: 'Quantity (0-3, e.g. 2 for double layer)', style: { width: '50px', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.3rem' }, type: 'number', min: '0', max: '3', step: '1', value: ls.quantity != null ? ls.quantity : 1,
          onChange(e) { ls.quantity = e.target.value === '' ? 1 : parseInt(e.target.value, 10); renderTabBar(); recalcAndRerenderOutputs(); } }));
        const psf = computeMaterialPsf(mat, ls);
        row.appendChild(el('div', { className: 'mono', style: { textAlign: 'right', fontWeight: '600' } }, psf.toFixed(2) + ' psf'));
        layersPanel.appendChild(row);
      });
      bodyContainer.appendChild(layersPanel);

      // Additional items (merged misc presets + custom lines)
      const itemsPanel = el('div', { className: 'panel', style: { padding: '0.75rem', marginBottom: '0.75rem' } },
        el('div', { className: 'form-label' }, 'Additional Items'));

      tab.items.forEach((it) => {
        const isCustom = it.kind === 'custom';
        const row = el('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap', paddingBottom: '0.4rem', borderBottom: '1px dotted var(--border-light)' } });
        row.appendChild(isCustom
          ? el('input', { className: 'form-input', style: { maxWidth: '180px' }, type: 'text', placeholder: 'Description', value: it.name || '',
              onInput(e) { it.name = e.target.value; } })
          : el('span', { style: { flex: '1', fontSize: '0.85rem' } }, it.name));
        row.appendChild(el('input', { className: 'mono', style: { width: '65px', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.3rem' }, type: 'number', value: numOrBlank(it.psf),
          onChange(e) { it.psf = e.target.value; renderTabBar(); recalcAndRerenderOutputs(); } }));
        row.appendChild(el('span', { className: 'mono', style: { fontSize: '0.72rem', color: 'var(--ink-tertiary)' } }, 'psf'));
        if (isCustom) {
          row.appendChild(el('select', { className: 'form-select', style: { width: 'auto' },
            onChange(e) { it.category = e.target.value; renderTabBar(); recalcAndRerenderOutputs(); } },
            el('option', { value: 'superimposed', selected: it.category !== 'framing' }, 'Superimposed'),
            el('option', { value: 'framing', selected: it.category === 'framing' }, 'Framing'),
          ));
          row.appendChild(el('label', { style: { display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem' } },
            el('input', { type: 'checkbox', checked: !!it.coverageEligible, onInput(e) { it.coverageEligible = e.target.checked; renderTabBody(); } }),
            'Coverage-reduced (lateral)',
          ));
        }
        if (it.coverageEligible) {
          row.appendChild(el('span', { style: { fontSize: '0.72rem', color: 'var(--ink-tertiary)' } }, '% coverage:'));
          row.appendChild(el('input', { className: 'mono', style: { width: '55px', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.3rem' }, type: 'number', min: '0', max: '100', value: it.coveragePercent != null ? it.coveragePercent : 100,
            onChange(e) { it.coveragePercent = e.target.value; recalcAndRerenderOutputs(); } }));
        }
        row.appendChild(el('button', { className: 'btn btn-ghost btn-sm', type: 'button',
          onClick() { tab.items = tab.items.filter((x) => x.id !== it.id); renderTabBody(); renderTabBar(); } }, '×'));
        itemsPanel.appendChild(row);
      });

      const availablePresets = (def.allowances ? def.allowances.items : []).map((p, i) => ({ p, i }))
        .filter(({ i }) => !tab.items.some((x) => x.kind === 'preset' && x.presetIndex === i));
      const addItemSelect = el('select', { className: 'form-select', style: { width: 'auto', marginTop: '0.4rem' } },
        el('option', { value: '' }, '+ Add item…'),
        ...availablePresets.map(({ p, i }) => el('option', { value: 'preset:' + i }, p.name + ' (' + p.psf.toFixed(1) + ' psf)')),
        el('option', { value: 'custom' }, '+ Custom Item…'),
      );
      addItemSelect.addEventListener('change', () => {
        if (!addItemSelect.value) return;
        if (addItemSelect.value === 'custom') {
          tab.items.push({ id: 'item' + (nextItemId++), kind: 'custom', name: '', psf: 0, category: 'superimposed', perInch: false, thickness: 1, coverageEligible: false, coveragePercent: 100 });
        } else {
          const idx = parseInt(addItemSelect.value.split(':')[1], 10);
          const preset = def.allowances.items[idx];
          tab.items.push({ id: 'item' + (nextItemId++), kind: 'preset', presetIndex: idx, name: preset.name, psf: preset.psf, category: 'superimposed', coverageEligible: !!preset.coverageEligible, coveragePercent: 100 });
        }
        renderTabBody(); renderTabBar();
      });
      itemsPanel.appendChild(addItemSelect);
      bodyContainer.appendChild(itemsPanel);

      // Totals display — 2-column Gravity / Lateral
      const totals = computeTabTotals(tab);
      const totalsPanel = el('div', { className: 'output-section' },
        el('div', { className: 'output-header' }, el('span', null, 'Assembly Totals')),
        el('div', { className: 'output-body' },
          buildTotalsTable(totals, def),
        ),
      );
      bodyContainer.appendChild(totalsPanel);
    }

    function renderAll() {
      renderTabBar();
      renderTabBody();
    }
    renderAll();

    container.appendChild(el('div', { className: 'form-group' }, addTabSelect));
    container.appendChild(tabBar);
    container.appendChild(bodyContainer);
    container.appendChild(el('div', { style: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' } },
      el('button', { className: 'btn btn-primary', type: 'button', onClick() { onSave(inputs); } }, 'Calculate & Save'),
    ));
  },

  renderOutputs(container, outputs) {
    if (!outputs || !outputs.perTab) return;
    clearEl(container);
    const tbl = el('table', { className: 'data-table' });
    tbl.appendChild(el('tr', null,
      el('th', null, 'Assembly'),
      el('th', null, 'Description'),
      el('th', { className: 'num' }, 'DL'),
      el('th', { className: 'num' }, 'SDL (grav.)'),
      el('th', { className: 'num' }, 'SDL (lat.)'),
      el('th', { className: 'num' }, 'LL (grav.)'),
      el('th', { className: 'num' }, 'LL (seismic)'),
      el('th', { className: 'num' }, 'Gravity Total'),
      el('th', { className: 'num' }, 'Lateral Total'),
    ));
    outputs.perTab.forEach((t) => {
      tbl.appendChild(el('tr', null,
        el('td', null, t.name),
        el('td', { style: { color: 'var(--ink-secondary)', fontSize: '0.85rem' } }, t.description || '—'),
        el('td', { className: 'num mono' }, t.dl.toFixed(1)),
        el('td', { className: 'num mono' }, t.sdlGravity.toFixed(1)),
        el('td', { className: 'num mono' }, t.sdlLateral.toFixed(1)),
        el('td', { className: 'num mono' }, t.hasLiveLoad ? t.llGravity.toFixed(1) : '—'),
        el('td', { className: 'num mono' }, t.hasLiveLoad ? t.llSeismic.toFixed(1) : '—'),
        el('td', { className: 'num mono', style: { fontWeight: '600' } }, t.gravityTotal.toFixed(1)),
        el('td', { className: 'num mono', style: { fontWeight: '600' } }, t.lateralTotal.toFixed(1)),
      ));
    });
    container.appendChild(el('div', { className: 'table-scroll' }, tbl));
  },

  pdfSections(inputs, outputs) {
    const sections = [];
    const perTab = outputs && outputs.perTab ? outputs.perTab : [];

    if (perTab.length > 1) {
      sections.push({
        title: 'Summary — All Assemblies',
        table: {
          headers: ['Assembly', 'Description', 'Gravity Total (psf)', 'Lateral Total (psf)'],
          rows: perTab.map((t) => [t.name, t.description || '', t.gravityTotal.toFixed(1), t.lateralTotal.toFixed(1)]),
        },
      });
    }

    perTab.forEach((t) => {
      if (t.description) sections.push({ title: t.name, text: t.description });
      const rows = [
        ['Dead Load (D)', t.dl.toFixed(1) + ' psf'],
        ['Superimposed Dead Load — gravity', t.sdlGravity.toFixed(1) + ' psf'],
        ['Superimposed Dead Load — lateral', t.sdlLateral.toFixed(1) + ' psf'],
      ];
      if (t.hasLiveLoad) {
        rows.push([(t.llLabel || 'Live Load') + ' — gravity', t.llGravity.toFixed(1) + ' psf']);
        rows.push([(t.llLabel || 'Live Load') + ' — seismic portion', t.llSeismic.toFixed(1) + ' psf']);
      }
      rows.push(['Gravity Total', t.gravityTotal.toFixed(1) + ' psf']);
      rows.push(['Lateral (Seismic) Total', t.lateralTotal.toFixed(1) + ' psf']);
      sections.push({ title: t.description ? t.name + ' — Loads' : t.name, rows });
    });
    return sections;
  },
};

function buildTotalsTable(totals, def) {
  const tbl = el('table', { className: 'data-table' });
  tbl.appendChild(el('tr', null, el('th', null, 'Load Type'), el('th', { className: 'num' }, 'Gravity'), el('th', { className: 'num' }, 'Lateral')));
  tbl.appendChild(el('tr', null, el('td', null, 'Dead Load (D)'), el('td', { className: 'num mono' }, totals.dl.toFixed(1)), el('td', { className: 'num mono' }, totals.dl.toFixed(1))));
  tbl.appendChild(el('tr', null, el('td', null, 'Superimposed Dead Load (SD)'), el('td', { className: 'num mono' }, totals.sdlGravity.toFixed(1)), el('td', { className: 'num mono' }, totals.sdlLateral.toFixed(1))));
  if (def.hasLiveLoad) {
    tbl.appendChild(el('tr', null, el('td', null, (def.llLabel || 'Live Load') + ' (L)'), el('td', { className: 'num mono' }, totals.llGravity.toFixed(1)), el('td', { className: 'num mono' }, totals.llSeismic.toFixed(1))));
  }
  tbl.appendChild(el('tr', { style: { fontWeight: '600' } }, el('td', null, 'Total'), el('td', { className: 'num mono' }, totals.gravityTotal.toFixed(1)), el('td', { className: 'num mono' }, totals.lateralTotal.toFixed(1))));
  return tbl;
}
