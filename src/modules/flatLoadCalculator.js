import { el, clearEl, numOrBlank } from '../utils.js';
import { ASSEMBLY_TYPES, TYPICAL_ASSEMBLIES, computeMaterialPsf } from './flatLoadMaterials.js';

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
  let framingSelfWeight = 0;
  let sdlGravity = 0;
  let sdlLateral = 0;
  let itemLL = 0;

  for (const layer of def.layers) {
    const ls = tab.layers[layer.key];
    if (!ls) continue;
    const mat = layer.materials[ls.selectedIdx];
    const psf = computeMaterialPsf(mat, ls);
    if (layer.loadCategory === 'framing') framingSelfWeight += psf;
    else { sdlGravity += psf; sdlLateral += psf; }
  }

  for (const it of (tab.items || [])) {
    const psf = it.perInch ? (parseFloat(it.psf) || 0) * (parseFloat(it.thickness) || 0) : (parseFloat(it.psf) || 0);
    if (it.category === 'framing') { framingSelfWeight += psf; continue; }
    if (it.category === 'roof_live' || it.category === 'live') { itemLL += psf; continue; }
    sdlGravity += psf;
    if (it.coverageEligible) {
      const coverage = it.coveragePercent != null && it.coveragePercent !== '' ? parseFloat(it.coveragePercent) : 100;
      sdlLateral += psf * (coverage / 100);
    } else {
      sdlLateral += psf;
    }
  }

  const round1 = (v) => Math.round(v * 10) / 10;
  framingSelfWeight = round1(framingSelfWeight);
  sdlGravity = round1(sdlGravity);
  sdlLateral = round1(sdlLateral);
  const dl = round1(framingSelfWeight + sdlGravity);
  const dlLateral = round1(framingSelfWeight + sdlLateral);
  const llGravity = round1((def.hasLiveLoad ? (parseFloat(tab.liveLoad) || 0) : 0) + itemLL);
  const llSeismic = def.hasLiveLoad && tab.includeLLinSeismic
    ? round1(llGravity * ((parseFloat(tab.seismicLLPercent) || 0) / 100))
    : 0;
  const gravityTotal = round1(dl + llGravity);
  const lateralTotal = round1(dlLateral + llSeismic);

  return { framingSelfWeight, dl, dlLateral, sdlGravity, sdlLateral, llGravity, llSeismic, gravityTotal, lateralTotal };
}

export const flatLoadCalculator = {
  id: 'flat_load_calculator',
  label: 'Flat Load Calculator',
  schemaVersion: 2,
  calcVersion: 'v1',
  noNewPrefix: true,
  noOutputSection: true,
  regenerateResults: true,
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
      const tabInputs = inputs.tabs.find((t) => t.id === tab.id);
      return {
        id: tab.id, name: tab.name, description: tab.description || '', type: tab.type,
        hasLiveLoad: def.hasLiveLoad, llLabel: def.llLabel || 'Live Load', llSymbol: def.llSymbol || 'L',
        layers: tabInputs ? tabInputs.layers : {}, items: tabInputs ? tabInputs.items : [],
        ...totals,
      };
    });
    return { perTab, calcVersion: 'v1' };
  },

  renderForm(container, existingInputs, onSave, projectItems, onInputChange) {
    const inputs = existingInputs && existingInputs.tabs
      ? existingInputs
      : { tabs: [newTab('roof'), newTab('floor'), newTab('extWall')] };
    clearEl(container);

    let activeTabId = inputs.tabs.length ? inputs.tabs[0].id : null;

    function notifyChange() {
      if (onInputChange) onInputChange(inputs);
    }

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
      notifyChange();
    });

    const bodyContainer = el('div');

    function moveTab(tabId, direction) {
      const idx = inputs.tabs.findIndex((t) => t.id === tabId);
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= inputs.tabs.length) return;
      const tmp = inputs.tabs[idx];
      inputs.tabs[idx] = inputs.tabs[newIdx];
      inputs.tabs[newIdx] = tmp;
      renderAll();
      notifyChange();
    }

    function renderTabBar() {
      clearEl(tabBar);
      const summaryBtn = el('button', {
        className: 'filter-tab' + (activeTabId === '__summary__' ? ' active' : ''),
        type: 'button',
        onClick() { activeTabId = '__summary__'; renderAll(); },
      }, 'Summary');
      tabBar.appendChild(summaryBtn);
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
      notifyChange();
    }

    function renderSummaryTab() {
      clearEl(bodyContainer);
      if (!inputs.tabs.length) {
        bodyContainer.appendChild(el('div', { className: 'empty-state' }, el('p', null, 'Add assemblies to see the summary.')));
        return;
      }
      inputs.tabs.forEach((tab, idx) => {
        const def = ASSEMBLY_TYPES[tab.type];
        const totals = computeTabTotals(tab);
        const rows = getLoadRows(totals, def.hasLiveLoad, def.llLabel, def.llSymbol)
          .filter((r) => !r.bold);
        const tbl = el('table', { className: 'data-table' });
        tbl.appendChild(el('tr', null, el('th', null, 'Load Type'), el('th', { className: 'num' }, 'Gravity'), el('th', { className: 'num' }, 'Lateral')));
        rows.forEach((r) => {
          tbl.appendChild(el('tr', null,
            el('td', null, r.label), el('td', { className: 'num mono' }, r.gravity.toFixed(1)), el('td', { className: 'num mono' }, r.lateral.toFixed(1))));
        });
        const header = el('div', { style: { fontWeight: '600', fontSize: '0.9rem' } },
          def.short + ' — ' + tab.name,
          tab.description ? el('span', { style: { fontWeight: '400', color: 'var(--ink-secondary)', fontSize: '0.82rem' } }, ' — ' + tab.description) : null);
        bodyContainer.appendChild(el('div', { className: 'output-section', style: { marginTop: idx > 0 ? '0.75rem' : 0 } },
          el('div', { className: 'output-header' }, header),
          el('div', { className: 'output-body' }, tbl),
        ));
      });
    }

    function renderTabBody() {
      if (activeTabId === '__summary__') { renderSummaryTab(); return; }
      clearEl(bodyContainer);
      const tab = inputs.tabs.find((t) => t.id === activeTabId);
      if (!tab) {
        bodyContainer.appendChild(el('div', { className: 'empty-state' }, el('p', null, 'Add an assembly tab to begin.')));
        return;
      }
      const def = ASSEMBLY_TYPES[tab.type];

      const presets = TYPICAL_ASSEMBLIES[tab.type] || [];
      const tabIdx = inputs.tabs.indexOf(tab);
      const headerRow = el('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' } },
        el('input', { className: 'form-input', style: { maxWidth: '220px' }, type: 'text', value: tab.name,
          onInput(e) { tab.name = e.target.value; renderTabBar(); } }),
        el('button', { className: 'btn btn-ghost btn-sm', type: 'button', disabled: tabIdx === 0,
          onClick() { moveTab(tab.id, -1); } }, '◀'),
        el('button', { className: 'btn btn-ghost btn-sm', type: 'button', disabled: tabIdx === inputs.tabs.length - 1,
          onClick() { moveTab(tab.id, 1); } }, '▶'),
        presets.length ? el('select', { className: 'form-select', style: { width: 'auto' },
          onChange(e) {
            if (e.target.value === '') return;
            const hasData = def.layers.some((l) => { const ls = tab.layers[l.key]; return ls && ls.selectedIdx > 0; }) || tab.items.length > 0;
            if (hasData && !confirm('Apply preset? This will overwrite current layers and additional items.')) { e.target.value = ''; return; }
            const preset = presets[parseInt(e.target.value, 10)];
            for (const [key, val] of Object.entries(preset.layers)) {
              tab.layers[key] = { ...(tab.layers[key] || {}), ...val };
            }
            tab.items = (preset.items || []).map((it) => ({ ...it, id: 'item' + (nextItemId++) }));
            if (preset.liveLoad != null) tab.liveLoad = preset.liveLoad;
            if (preset.roofLLMode) tab.roofLLMode = preset.roofLLMode;
            e.target.value = '';
            renderTabBody(); renderTabBar(); notifyChange();
          } },
          el('option', { value: '' }, '— Preset —'),
          ...presets.map((p, i) => el('option', { value: String(i) }, p.label)),
        ) : null,
        el('div', { style: { flex: '1' } }),
        el('button', { className: 'btn btn-danger btn-sm', type: 'button',
          onClick() {
            inputs.tabs = inputs.tabs.filter((t) => t.id !== tab.id);
            activeTabId = inputs.tabs.length ? inputs.tabs[0].id : null;
            renderAll(); notifyChange();
          } }, 'Remove'),
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
        const llGroup = el('div', { className: 'form-group panel', style: { padding: '0.75rem' } },
          el('label', { className: 'form-label' }, 'Design Live Load'),
        );

        if (def.hasSlopeReduction) {
          if (!tab.roofLLMode) tab.roofLLMode = 'flat';
          const mode = tab.roofLLMode;
          if (mode === 'flat') tab.liveLoad = 20;
          else if (mode === 'steep') tab.liveLoad = 12;
          else if (mode === 'sloped') {
            const slopeResult = computeSlopeReducedLr(def.defaultLL, tab.roofSlope);
            if (slopeResult) tab.liveLoad = slopeResult.Lr;
          }

          const modeSelect = el('select', { className: 'form-select', style: { maxWidth: '340px' },
            onChange(e) { tab.roofLLMode = e.target.value; if (e.target.value !== 'sloped') tab.roofSlope = ''; renderTabBody(); renderTabBar(); notifyChange(); } },
            el('option', { value: 'flat', selected: mode === 'flat' }, 'Flat / low-slope roof (Lr = 20 psf)'),
            el('option', { value: 'sloped', selected: mode === 'sloped' }, 'Sloped roof 5:12 – 12:12 (enter slope)'),
            el('option', { value: 'steep', selected: mode === 'steep' }, 'Steep roof ≥ 12:12 (Lr = 12 psf)'),
          );
          llGroup.appendChild(modeSelect);
          llGroup.appendChild(el('div', { className: 'mono', style: { fontSize: '0.85rem', marginTop: '0.5rem', fontWeight: '600' } },
            'Lr = ' + (parseFloat(tab.liveLoad) || 0).toFixed(1) + ' psf'));

          if (mode === 'sloped') {
            llGroup.appendChild(el('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.6rem', flexWrap: 'wrap' } },
              el('span', { style: { fontSize: '0.85rem', fontWeight: '500' } }, 'Roof Slope'),
              el('input', { className: 'mono', style: { width: '60px', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.3rem' }, type: 'number', min: '0', placeholder: '5', value: tab.roofSlope,
                onChange(e) { tab.roofSlope = e.target.value; renderTabBody(); renderTabBar(); notifyChange(); } }),
              el('span', { className: 'mono', style: { fontSize: '0.8rem', color: 'var(--ink-secondary)' } }, ': 12  (rise : run)'),
            ));
            const slopeRes = computeSlopeReducedLr(def.defaultLL, tab.roofSlope);
            if (slopeRes) {
              llGroup.appendChild(el('div', { className: 'mono', style: { fontSize: '0.78rem', color: 'var(--accent)', marginTop: '0.4rem', background: 'var(--accent-bg)', padding: '0.4rem 0.6rem', borderRadius: '3px' } },
                slopeRes.equation));
            }
          }
          llGroup.appendChild(el('div', { style: { fontSize: '0.75rem', color: 'var(--ink-tertiary)', marginTop: '0.4rem' } }, def.llRef));
        } else {
          const matchingPresetIdx = def.llPresets ? def.llPresets.findIndex((p) => p.psf === tab.liveLoad) : -1;
          if (def.llPresets && def.llPresets.length) {
            const llPreset = el('select', { className: 'form-select', style: { maxWidth: '260px' } },
              el('option', { value: '', selected: matchingPresetIdx === -1 }, '— Preset —'),
              ...def.llPresets.map((p, i) => el('option', { value: String(i), selected: i === matchingPresetIdx }, p.label)),
            );
            llPreset.addEventListener('change', () => {
              if (llPreset.value === '') return;
              tab.liveLoad = def.llPresets[parseInt(llPreset.value, 10)].psf;
              renderTabBody(); renderTabBar(); notifyChange();
            });
            llGroup.appendChild(el('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' } },
              llPreset,
              el('input', { className: 'form-input mono', style: { maxWidth: '100px' }, type: 'number', value: numOrBlank(tab.liveLoad),
                onChange(e) { tab.liveLoad = e.target.value; renderTabBar(); recalcAndRerenderOutputs(); } }),
              el('span', { className: 'mono' }, 'psf'),
            ));
          } else {
            llGroup.appendChild(el('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center' } },
              el('input', { className: 'form-input mono', style: { maxWidth: '100px' }, type: 'number', value: numOrBlank(tab.liveLoad),
                onChange(e) { tab.liveLoad = e.target.value; renderTabBar(); recalcAndRerenderOutputs(); } }),
              el('span', { className: 'mono' }, 'psf'),
            ));
          }
          llGroup.appendChild(el('div', { style: { fontSize: '0.75rem', color: 'var(--ink-tertiary)', marginTop: '0.4rem' } }, def.llRef));
        }

        const llWarn = (parseFloat(tab.liveLoad) || 0) >= 100
          ? el('span', { className: 'badge badge-stale', style: { marginTop: '0.4rem' } }, 'LL ≥ 100 psf — consider including in seismic weight')
          : null;
        if (llWarn) llGroup.appendChild(llWarn);

        const seismicToggle = el('input', { type: 'checkbox', checked: tab.includeLLinSeismic,
          onInput(e) { tab.includeLLinSeismic = e.target.checked; renderTabBody(); notifyChange(); } });
        const seismicPercentInput = el('input', { className: 'form-input mono', style: { maxWidth: '80px' }, type: 'number', value: tab.seismicLLPercent, disabled: !tab.includeLLinSeismic,
          onChange(e) { tab.seismicLLPercent = e.target.value; recalcAndRerenderOutputs(); } });
        llGroup.appendChild(el('label', { style: { display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.6rem', fontSize: '0.85rem' } },
          seismicToggle, 'Include in seismic weight at', seismicPercentInput, '%  (ASCE 7 §12.7.2 — storage/heavy occupancy)',
        ));
        bodyContainer.appendChild(llGroup);
      }

      // Layers
      const layersPanel = el('div', { className: 'panel', style: { padding: '0.75rem', marginBottom: '0.75rem' } });
      const layerCols = '1fr 2fr 70px 70px 130px';
      layersPanel.appendChild(el('div', { style: { display: 'grid', gridTemplateColumns: layerCols, gap: '0.75rem', marginBottom: '0.4rem', paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)' } },
        el('span', { className: 'form-label', style: { margin: 0 } }, 'Layer'),
        el('span', { className: 'form-label', style: { margin: 0 } }, 'Material'),
        el('span', { className: 'form-label', style: { margin: 0 } }, 'Thick (in)'),
        el('span', { className: 'form-label', style: { margin: 0 } }, 'Qty'),
        el('span', { className: 'form-label', style: { margin: 0, textAlign: 'right' } }, 'Load',
          el('span', { style: { display: 'block', fontSize: '0.62rem', fontWeight: '400', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-tertiary)' } }, '☐ override')),
      ));
      def.layers.forEach((layer) => {
        const ls = tab.layers[layer.key];
        const mat = layer.materials[ls.selectedIdx];
        const isPerInch = mat && mat.kind === 'perInch';
        const isOverridden = !!ls.psfOverride;
        const row = el('div', { style: { display: 'grid', gridTemplateColumns: layerCols, gap: '0.75rem', alignItems: 'center', marginBottom: '0.5rem' } });
        const catLabel = layer.loadCategory === 'framing' ? 'Framing (→ D)' : 'Superimposed (→ SD)';
        row.appendChild(el('div', null,
          el('span', { style: { fontWeight: '600', fontSize: '0.85rem' } }, layer.label),
          layer.sub ? el('div', { style: { fontSize: '0.72rem', color: 'var(--ink-tertiary)' } }, layer.sub) : null,
          el('div', { style: { fontSize: '0.68rem', color: layer.loadCategory === 'framing' ? 'var(--accent)' : 'var(--ink-tertiary)', fontStyle: 'italic' } }, catLabel),
        ));
        const select = el('select', { className: 'form-select' });
        buildSelectOptions(select, layer.materials, ls.selectedIdx);
        select.addEventListener('change', () => {
          ls.selectedIdx = parseInt(select.value, 10);
          const newMat = layer.materials[ls.selectedIdx];
          ls.thickness = newMat && newMat.kind === 'perInch' ? (newMat.defaultThick || 1) : null;
          ls.psfOverride = false; ls.customPsf = null;
          renderTabBody(); renderTabBar(); notifyChange();
        });
        row.appendChild(select);
        row.appendChild(isPerInch && !isOverridden
          ? el('input', { className: 'mono', style: { width: '60px', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.3rem' }, type: 'number', step: '0.25', value: numOrBlank(ls.thickness),
              onChange(e) { ls.thickness = e.target.value; renderTabBar(); recalcAndRerenderOutputs(); } })
          : el('span'));
        row.appendChild(!isOverridden
          ? el('input', { className: 'mono', title: 'Quantity (0-3, e.g. 2 for double layer)', style: { width: '50px', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.3rem' }, type: 'number', min: '0', max: '3', step: '1', value: ls.quantity != null ? ls.quantity : 1,
              onChange(e) { ls.quantity = e.target.value === '' ? 1 : parseInt(e.target.value, 10); renderTabBar(); recalcAndRerenderOutputs(); } })
          : el('span'));
        const psf = computeMaterialPsf(mat, ls);
        const loadCell = el('div', { style: { display: 'flex', alignItems: 'center', gap: '0.25rem', justifyContent: 'flex-end' } },
          el('input', { type: 'checkbox', title: 'Override load value', checked: isOverridden, style: { cursor: 'pointer' },
            onInput(e) { ls.psfOverride = e.target.checked; if (!e.target.checked) ls.customPsf = null; renderTabBody(); renderTabBar(); notifyChange(); } }),
          isOverridden
            ? el('input', { className: 'mono', style: { width: '55px', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.2rem', textAlign: 'right' }, type: 'number', step: '0.01', value: numOrBlank(ls.customPsf),
                onChange(e) { ls.customPsf = e.target.value; renderTabBar(); recalcAndRerenderOutputs(); } })
            : el('span', { className: 'mono', style: { fontWeight: '600' } }, psf.toFixed(2)),
          el('span', { className: 'mono', style: { fontSize: '0.72rem' } }, ' psf'),
        );
        row.appendChild(loadCell);
        layersPanel.appendChild(row);
      });
      bodyContainer.appendChild(layersPanel);

      // Additional items (merged misc presets + custom lines)
      const itemsPanel = el('div', { className: 'panel', style: { padding: '0.75rem', marginBottom: '0.75rem' } },
        el('div', { className: 'form-label' }, 'Additional Items'));

      tab.items.forEach((it) => {
        const isCustom = it.kind === 'custom';
        const isPreset = it.kind === 'preset';
        const isOverridden = isPreset ? !!it.psfOverride : true;
        const catLabel = it.category === 'framing' ? '[D]' : (it.category === 'roof_live' || it.category === 'live') ? '[LL]' : '[SD]';
        const catColor = it.category === 'framing' ? 'var(--accent)' : 'var(--ink-tertiary)';
        const row = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto 100px 24px', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem', paddingBottom: '0.4rem', borderBottom: '1px dotted var(--border-light)' } });
        row.appendChild(isCustom
          ? el('input', { className: 'form-input', style: { width: '100%' }, type: 'text', placeholder: 'Description', value: it.name || '',
              onInput(e) { it.name = e.target.value; } })
          : el('span', { style: { fontSize: '0.85rem' } }, it.name));
        if (isCustom) {
          const catOpts = def.hasLiveLoad
            ? [['superimposed', 'Superimposed dead'], ['roof_live', 'Roof live'], ['live', 'Live']]
            : [['superimposed', 'Superimposed dead'], ['live', 'Live']];
          row.appendChild(el('select', { className: 'form-select', style: { width: 'auto' },
            onChange(e) { it.category = e.target.value; renderTabBar(); recalcAndRerenderOutputs(); } },
            ...catOpts.map(([val, lbl]) => el('option', { value: val, selected: it.category === val }, lbl)),
          ));
        } else {
          row.appendChild(el('span', { style: { fontSize: '0.72rem', color: catColor, fontStyle: 'italic' } }, catLabel));
        }
        const psfCell = el('div', { style: { display: 'flex', alignItems: 'center', gap: '0.25rem', justifyContent: 'flex-end' } });
        if (isPreset) {
          psfCell.appendChild(el('input', { type: 'checkbox', title: 'Override value', checked: !!it.psfOverride, style: { cursor: 'pointer' },
            onInput(e) {
              it.psfOverride = e.target.checked;
              if (!e.target.checked) { const orig = def.allowances.items[it.presetIndex]; if (orig) it.psf = orig.psf; }
              renderTabBody(); renderTabBar(); notifyChange();
            } }));
        }
        if (isOverridden) {
          psfCell.appendChild(el('input', { className: 'mono', style: { width: '55px', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.2rem', textAlign: 'right' }, type: 'number', step: '0.1', value: numOrBlank(it.psf),
            onChange(e) { it.psf = e.target.value; renderTabBar(); recalcAndRerenderOutputs(); } }));
        } else {
          psfCell.appendChild(el('span', { className: 'mono', style: { fontWeight: '600' } }, (parseFloat(it.psf) || 0).toFixed(1)));
        }
        psfCell.appendChild(el('span', { className: 'mono', style: { fontSize: '0.72rem', color: 'var(--ink-tertiary)' } }, ' psf'));
        row.appendChild(psfCell);
        row.appendChild(el('button', { className: 'btn btn-ghost btn-sm', type: 'button',
          onClick() { tab.items = tab.items.filter((x) => x.id !== it.id); renderTabBody(); renderTabBar(); notifyChange(); } }, '×'));
        if (it.coverageEligible || (isCustom && it.category === 'superimposed')) {
          const detailRow = el('div', { style: { gridColumn: '1 / -1', display: 'flex', gap: '0.5rem', alignItems: 'center', paddingLeft: '0.5rem' } });
          if (isCustom) {
            detailRow.appendChild(el('label', { style: { display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem' } },
              el('input', { type: 'checkbox', checked: !!it.coverageEligible, onInput(e) { it.coverageEligible = e.target.checked; renderTabBody(); notifyChange(); } }),
              'Coverage-reduced (lateral)',
            ));
          }
          if (it.coverageEligible) {
            detailRow.appendChild(el('span', { style: { fontSize: '0.72rem', color: 'var(--ink-tertiary)' } }, '% coverage:'));
            detailRow.appendChild(el('input', { className: 'mono', style: { width: '55px', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.3rem' }, type: 'number', min: '0', max: '100', value: it.coveragePercent != null ? it.coveragePercent : 100,
              onChange(e) { it.coveragePercent = e.target.value; recalcAndRerenderOutputs(); } }));
          }
          itemsPanel.appendChild(row);
          itemsPanel.appendChild(detailRow);
          return;
        }
        itemsPanel.appendChild(row);
      });

      const availablePresets = (def.allowances ? def.allowances.items : []).map((p, i) => ({ p, i }))
        .filter(({ i }) => !tab.items.some((x) => x.kind === 'preset' && x.presetIndex === i));
      const addItemSelect = el('select', { className: 'form-select', style: { width: 'auto', marginTop: '0.4rem' } },
        el('option', { value: '' }, '+ Add item…'),
        ...availablePresets.map(({ p, i }) => el('option', { value: 'preset:' + i }, p.name + ' [SD] (' + p.psf.toFixed(1) + ' psf)')),
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
        renderTabBody(); renderTabBar(); notifyChange();
      });
      itemsPanel.appendChild(addItemSelect);
      bodyContainer.appendChild(itemsPanel);

      const totals = computeTabTotals(tab);
      const loadRows = getLoadRows(totals, def.hasLiveLoad, def.llLabel, def.llSymbol);
      const totalsTbl = el('table', { className: 'data-table' });
      totalsTbl.appendChild(el('tr', null, el('th', null, 'Load Type'), el('th', { className: 'num' }, 'Gravity'), el('th', { className: 'num' }, 'Lateral')));
      loadRows.forEach((r) => {
        totalsTbl.appendChild(el('tr', { style: r.bold ? { fontWeight: '600' } : null },
          el('td', null, r.label), el('td', { className: 'num mono' }, r.gravity.toFixed(1)), el('td', { className: 'num mono' }, r.lateral.toFixed(1))));
      });
      bodyContainer.appendChild(el('div', { className: 'output-section' },
        el('div', { className: 'output-header' }, el('span', null, def.short + ' — ' + tab.name + ' — Totals')),
        el('div', { className: 'output-body' }, totalsTbl),
      ));

    }

    function renderAll() {
      renderTabBar();
      renderTabBody();
    }
    renderAll();
    notifyChange();

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
    outputs.perTab.forEach((t, idx) => {
      const rows = getLoadRows(t, t.hasLiveLoad, t.llLabel, t.llSymbol);
      const tbl = el('table', { className: 'data-table' });
      tbl.appendChild(el('tr', null, el('th', null, 'Load Type'), el('th', { className: 'num' }, 'Gravity'), el('th', { className: 'num' }, 'Lateral')));
      rows.forEach((r) => {
        tbl.appendChild(el('tr', { style: r.bold ? { fontWeight: '600' } : null },
          el('td', null, r.label), el('td', { className: 'num mono' }, r.gravity.toFixed(1)), el('td', { className: 'num mono' }, r.lateral.toFixed(1))));
      });
      container.appendChild(el('div', { style: { marginBottom: idx < outputs.perTab.length - 1 ? '1rem' : 0 } },
        el('div', { style: { fontWeight: '600', fontSize: '0.9rem', marginBottom: '0.3rem' } },
          t.name, t.description ? el('span', { style: { fontWeight: '400', color: 'var(--ink-secondary)', fontSize: '0.82rem' } }, ' — ' + t.description) : null),
        el('div', { className: 'table-scroll' }, tbl),
      ));
    });
  },

  pdfSections(inputs, outputs) {
    const sections = [];
    const perTab = outputs && outputs.perTab ? outputs.perTab : [];

    // Results summary — its own sheet, one D/SD/(Lr or L)/Total table per
    // assembly, in the same shape as the live "Assembly Totals" panel.
    perTab.forEach((t) => {
      const loadRows = getLoadRows(t, t.hasLiveLoad, t.llLabel, t.llSymbol);
      sections.push({
        title: t.name + (t.description ? ' — ' + t.description : ''),
        table: {
          headers: ['Load Type', 'Gravity (psf)', 'Lateral (psf)'],
          rows: loadRows.map((r) => [r.label, r.gravity.toFixed(1), r.lateral.toFixed(1)]),
        },
      });
    });

    // Per-assembly layer detail — full breakdown on a fresh sheet.
    perTab.forEach((t, idx) => {
      const def = ASSEMBLY_TYPES[t.type];
      const layerRows = [];
      for (const layer of def.layers) {
        const ls = t.layers && t.layers[layer.key];
        if (!ls) continue;
        const mat = layer.materials[ls.selectedIdx];
        if (!mat || mat.psf === 0) continue;
        const psf = computeMaterialPsf(mat, ls);
        const catTag = layer.loadCategory === 'framing' ? '[D]' : '[SD]';
        const thickStr = mat.kind === 'perInch' && ls.thickness ? ', t=' + ls.thickness + ' in' : '';
        const qtyStr = ls.quantity > 1 ? ' ×' + ls.quantity : '';
        layerRows.push([layer.label + ' ' + catTag, mat.name + thickStr + qtyStr, psf.toFixed(2) + ' psf']);
      }
      for (const it of (t.items || [])) {
        const psf = it.perInch ? (parseFloat(it.psf) || 0) * (parseFloat(it.thickness) || 0) : (parseFloat(it.psf) || 0);
        if (psf === 0) continue;
        const catTag = it.category === 'framing' ? '[D]' : (it.category === 'roof_live' || it.category === 'live') ? '[LL]' : '[SD]';
        layerRows.push(['Item ' + catTag, it.name || 'Custom', psf.toFixed(2) + ' psf']);
      }
      sections.push({
        title: t.name + ' — Assembly Detail',
        pageBreakBefore: idx === 0,
        table: { headers: ['Layer', 'Material / Item', 'Load'], rows: layerRows, colWidths: [0.2, 0.6, 0.2] },
      });
      const summaryRows = [
        ['Dead Load, D (framing + SDL)', t.dl.toFixed(1) + ' psf (gravity) / ' + (t.dlLateral || t.dl).toFixed(1) + ' psf (lateral)'],
        ['Superimposed Dead (SD)', t.sdlGravity.toFixed(1) + ' psf (gravity) / ' + t.sdlLateral.toFixed(1) + ' psf (lateral)'],
      ];
      if (t.hasLiveLoad) {
        summaryRows.push([(t.llLabel || 'Live Load') + ' (' + (t.llSymbol || 'L') + ')', t.llGravity.toFixed(1) + ' psf (gravity) / ' + t.llSeismic.toFixed(1) + ' psf (lateral)']);
      }
      summaryRows.push(['Gravity Total', t.gravityTotal.toFixed(1) + ' psf']);
      summaryRows.push(['Lateral Total', t.lateralTotal.toFixed(1) + ' psf']);
      sections.push({ title: 'Totals', rows: summaryRows });
    });
    return sections;
  },
};

// Shared row data for the D/SD/(Lr or L)/Total load table — used by the
// live in-form "Assembly Totals" panel, the in-app Results view, and the
// PDF summary sheet, so all three stay in the same shape.
function getLoadRows(totals, hasLiveLoad, llLabel, llSymbol) {
  const rows = [
    { label: 'Dead Load, D (framing + SDL)', gravity: totals.dl, lateral: totals.dlLateral || totals.dl },
    { label: 'Superimposed Dead Load (SD)', gravity: totals.sdlGravity, lateral: totals.sdlLateral },
  ];
  if (hasLiveLoad) {
    rows.push({ label: (llLabel || 'Live Load') + ' (' + (llSymbol || 'L') + ')', gravity: totals.llGravity, lateral: totals.llSeismic });
  }
  rows.push({ label: 'Total', gravity: totals.gravityTotal, lateral: totals.lateralTotal, bold: true });
  return rows;
}

