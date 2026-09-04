import { el, clearEl, numOrBlank } from '../utils.js';
import { ASSEMBLY_TYPES, computeMaterialPsf } from './flatLoadMaterials.js';

let nextTabId = 1;
let nextCustomId = 1;

function newTab(type) {
  const def = ASSEMBLY_TYPES[type];
  const tab = {
    id: 'tab' + (nextTabId++),
    type,
    name: def.defaultName,
    layers: {},
    allowances: {},
    custom: [],
    liveLoad: def.hasLiveLoad ? def.defaultLL : null,
    includeLLinSeismic: false,
    seismicLLPercent: 25,
  };
  for (const layer of def.layers) tab.layers[layer.key] = { selectedIdx: 0, thickness: null, quantity: 1 };
  return tab;
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

  if (def.allowances) {
    def.allowances.items.forEach((item, i) => {
      const st = tab.allowances[i];
      if (!st || !st.checked) return;
      sdlGravity += item.psf;
      if (item.coverageEligible) {
        const coverage = st.coveragePercent != null ? st.coveragePercent : 100;
        sdlLateral += item.psf * (coverage / 100);
      } else {
        sdlLateral += item.psf;
      }
    });
  }

  for (const c of tab.custom) {
    const psf = c.perInch ? (parseFloat(c.psf) || 0) * (parseFloat(c.thickness) || 0) : (parseFloat(c.psf) || 0);
    if (c.category === 'framing') { dl += psf; continue; }
    sdlGravity += psf;
    if (c.coverageEligible) {
      const coverage = c.coveragePercent != null ? c.coveragePercent : 100;
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
  const asdCombo = def.hasLiveLoad ? round1(dl + sdlGravity + llGravity) : null;
  const lrfdCombo = def.hasLiveLoad ? round1(1.2 * (dl + sdlGravity) + 1.6 * llGravity) : null;

  return { dl, sdlGravity, sdlLateral, llGravity: round1(llGravity), llSeismic: round1(llSeismic), gravityTotal, lateralTotal, asdCombo, lrfdCombo };
}

export const flatLoadCalculator = {
  id: 'flat_load_calculator',
  label: 'Flat Load Calculator',
  schemaVersion: 1,
  calcVersion: 'v1',
  refs: [],
  fields: [
    { key: 'tabs', label: 'Assemblies', type: 'text' },
  ],
  outputFields: [
    { key: 'perTab', label: 'Per-Assembly Loads', type: 'table', columns: [
      { key: 'name', label: 'Assembly', unit: '' },
      { key: 'dl', label: 'DL', unit: 'psf', precision: 1 },
      { key: 'sdlGravity', label: 'SDL (gravity)', unit: 'psf', precision: 1 },
      { key: 'sdlLateral', label: 'SDL (lateral)', unit: 'psf', precision: 1 },
      { key: 'gravityTotal', label: 'Gravity Total', unit: 'psf', precision: 1 },
      { key: 'lateralTotal', label: 'Lateral Total', unit: 'psf', precision: 1 },
    ] },
  ],

  migrate(item) { return item; },

  summaryLabel(inputs) {
    const n = inputs.tabs ? inputs.tabs.length : 0;
    return 'Flat Load Calc — ' + n + ' assembl' + (n === 1 ? 'y' : 'ies');
  },

  calc(inputs) {
    const tabs = inputs.tabs || [];
    const perTab = tabs.map((tab) => {
      const def = ASSEMBLY_TYPES[tab.type];
      const totals = computeTabTotals(tab);
      return { id: tab.id, name: tab.name, type: tab.type, hasLiveLoad: def.hasLiveLoad, ...totals };
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

    function renderTabBody() {
      clearEl(bodyContainer);
      const tab = inputs.tabs.find((t) => t.id === activeTabId);
      if (!tab) {
        bodyContainer.appendChild(el('div', { className: 'empty-state' }, el('p', null, 'Add an assembly tab to begin.')));
        return;
      }
      const def = ASSEMBLY_TYPES[tab.type];

      const headerRow = el('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap' } },
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

      if (def.note) {
        bodyContainer.appendChild(el('div', { className: 'offline-banner', style: { color: 'var(--ink-secondary)', background: 'var(--surface)', borderColor: 'var(--border)' } }, def.note));
      }

      // Live load row
      if (def.hasLiveLoad) {
        const llInput = el('input', { className: 'form-input mono', style: { maxWidth: '100px' }, type: 'number', value: numOrBlank(tab.liveLoad),
          onChange(e) { tab.liveLoad = e.target.value; renderTabBar(); recalcAndRerenderOutputs(); } });
        const llPreset = el('select', { className: 'form-select', style: { maxWidth: '260px' } },
          el('option', { value: '' }, '— Preset —'),
          ...def.llPresets.map((p, i) => el('option', { value: String(i) }, p.label)),
        );
        llPreset.addEventListener('change', () => {
          if (llPreset.value === '') return;
          tab.liveLoad = def.llPresets[parseInt(llPreset.value, 10)].psf;
          llPreset.value = '';
          renderTabBody();
          renderTabBar();
        });
        const seismicToggle = el('input', { type: 'checkbox', checked: tab.includeLLinSeismic,
          onInput(e) { tab.includeLLinSeismic = e.target.checked; renderTabBody(); } });
        const seismicPercentInput = el('input', { className: 'form-input mono', style: { maxWidth: '80px' }, type: 'number', value: tab.seismicLLPercent, disabled: !tab.includeLLinSeismic,
          onInput(e) { tab.seismicLLPercent = e.target.value; } });

        const llWarn = (parseFloat(tab.liveLoad) || 0) >= 100
          ? el('span', { className: 'badge badge-stale' }, 'LL ≥ 100 psf — consider including in seismic weight')
          : null;

        bodyContainer.appendChild(el('div', { className: 'form-group panel', style: { padding: '0.75rem' } },
          el('label', { className: 'form-label' }, 'Design Live Load'),
          el('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' } },
            llPreset, llInput, el('span', { className: 'mono' }, 'psf'), llWarn,
          ),
          el('div', { className: 'll-ref', style: { fontSize: '0.75rem', color: 'var(--ink-tertiary)', marginTop: '0.4rem' } }, def.llRef),
          el('label', { style: { display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.6rem', fontSize: '0.85rem' } },
            seismicToggle, 'Include in seismic weight at', seismicPercentInput, '%  (ASCE 7 §12.7.2 — storage/heavy occupancy)',
          ),
        ));
      }

      // Layers
      const layersPanel = el('div', { className: 'panel', style: { padding: '0.75rem', marginBottom: '0.75rem' } });
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

      // Allowances
      if (def.allowances) {
        const allowPanel = el('div', { className: 'panel', style: { padding: '0.75rem', marginBottom: '0.75rem' } },
          el('div', { className: 'form-label' }, def.allowances.label));
        def.allowances.items.forEach((item, i) => {
          if (!tab.allowances[i]) tab.allowances[i] = { checked: false, coveragePercent: 100 };
          const st = tab.allowances[i];
          const checkbox = el('input', { type: 'checkbox', checked: st.checked,
            onInput(e) { st.checked = e.target.checked; renderTabBody(); renderTabBar(); } });
          const row = el('label', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0', fontSize: '0.85rem' } },
            checkbox, el('span', { style: { flex: '1' } }, item.name), el('span', { className: 'mono' }, item.psf.toFixed(1) + ' psf'),
          );
          if (item.coverageEligible) {
            const covInput = el('input', { className: 'mono', style: { width: '60px', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.2rem' }, type: 'number', min: '0', max: '100', value: st.coveragePercent, disabled: !st.checked,
              onChange(e) { st.coveragePercent = e.target.value; recalcAndRerenderOutputs(); } });
            row.appendChild(el('span', { style: { fontSize: '0.72rem', color: 'var(--ink-tertiary)' } }, '% roof coverage:'));
            row.appendChild(covInput);
          }
          allowPanel.appendChild(row);
        });
        bodyContainer.appendChild(allowPanel);
      }

      // Custom lines
      const customPanel = el('div', { className: 'panel', style: { padding: '0.75rem', marginBottom: '0.75rem' } },
        el('div', { className: 'form-label' }, 'Custom / Additional Items'));
      tab.custom.forEach((c) => {
        const row = el('div', { style: { display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap' } },
          el('input', { className: 'form-input', style: { maxWidth: '180px' }, type: 'text', placeholder: 'Description', value: c.name || '',
            onInput(e) { c.name = e.target.value; } }),
          el('input', { className: 'mono', style: { width: '70px', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.3rem' }, type: 'number', placeholder: 'psf', value: numOrBlank(c.psf),
            onChange(e) { c.psf = e.target.value; renderTabBar(); recalcAndRerenderOutputs(); } }),
          el('select', { className: 'form-select', style: { width: 'auto' },
            onChange(e) { c.category = e.target.value; renderTabBar(); recalcAndRerenderOutputs(); } },
            el('option', { value: 'superimposed', selected: c.category !== 'framing' }, 'Superimposed'),
            el('option', { value: 'framing', selected: c.category === 'framing' }, 'Framing'),
          ),
          el('label', { style: { display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' } },
            el('input', { type: 'checkbox', checked: !!c.coverageEligible, onInput(e) { c.coverageEligible = e.target.checked; renderTabBody(); } }),
            'Coverage-reduced (lateral)',
          ),
          c.coverageEligible ? el('input', { className: 'mono', style: { width: '55px', border: '1px solid var(--border)', borderRadius: '3px', padding: '0.3rem' }, type: 'number', min: '0', max: '100', value: c.coveragePercent != null ? c.coveragePercent : 100,
            onChange(e) { c.coveragePercent = e.target.value; recalcAndRerenderOutputs(); } }) : null,
          el('button', { className: 'btn btn-ghost btn-sm', type: 'button', onClick() { tab.custom = tab.custom.filter((x) => x.id !== c.id); renderTabBody(); renderTabBar(); } }, '×'),
        );
        customPanel.appendChild(row);
      });
      customPanel.appendChild(el('button', { className: 'btn btn-sm', type: 'button',
        onClick() { tab.custom.push({ id: 'custom' + (nextCustomId++), name: '', psf: 0, perInch: false, thickness: 1, category: 'superimposed' }); renderTabBody(); } }, '+ Add Custom Item'));
      bodyContainer.appendChild(customPanel);

      // Totals display
      const totals = computeTabTotals(tab);
      const totalsPanel = el('div', { className: 'output-section' },
        el('div', { className: 'output-header' }, el('span', null, 'Assembly Totals')),
        el('div', { className: 'output-body' },
          buildTotalsTable(totals, def.hasLiveLoad),
        ),
      );
      bodyContainer.appendChild(totalsPanel);
    }

    function recalcAndRerenderOutputs() {
      renderTabBody();
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
      el('th', { className: 'num' }, 'DL'),
      el('th', { className: 'num' }, 'SDL (grav.)'),
      el('th', { className: 'num' }, 'SDL (lat.)'),
      el('th', { className: 'num' }, 'Gravity Total'),
      el('th', { className: 'num' }, 'Lateral Total'),
    ));
    outputs.perTab.forEach((t) => {
      tbl.appendChild(el('tr', null,
        el('td', null, t.name),
        el('td', { className: 'num mono' }, t.dl.toFixed(1)),
        el('td', { className: 'num mono' }, t.sdlGravity.toFixed(1)),
        el('td', { className: 'num mono' }, t.sdlLateral.toFixed(1)),
        el('td', { className: 'num mono', style: { fontWeight: '600' } }, t.gravityTotal.toFixed(1)),
        el('td', { className: 'num mono', style: { fontWeight: '600' } }, t.lateralTotal.toFixed(1)),
      ));
    });
    container.appendChild(el('div', { className: 'table-scroll' }, tbl));
  },

  pdfSections(inputs, outputs) {
    const sections = [];
    (outputs && outputs.perTab ? outputs.perTab : []).forEach((t) => {
      const rows = [
        ['Dead Load (D)', t.dl.toFixed(1) + ' psf'],
        ['Superimposed DL — gravity', t.sdlGravity.toFixed(1) + ' psf'],
        ['Superimposed DL — lateral', t.sdlLateral.toFixed(1) + ' psf'],
      ];
      if (t.hasLiveLoad) {
        rows.push(['Live Load (L)', t.llGravity.toFixed(1) + ' psf']);
        rows.push(['Live Load — seismic portion', t.llSeismic.toFixed(1) + ' psf']);
      }
      rows.push(['Gravity Total', t.gravityTotal.toFixed(1) + ' psf']);
      rows.push(['Lateral (Seismic) Total', t.lateralTotal.toFixed(1) + ' psf']);
      if (t.asdCombo != null) {
        rows.push(['ASD Combo (D+L)', t.asdCombo.toFixed(1) + ' psf']);
        rows.push(['LRFD Combo (1.2D+1.6L)', t.lrfdCombo.toFixed(1) + ' psf']);
      }
      sections.push({ title: t.name, rows });
    });
    return sections;
  },
};

function buildTotalsTable(totals, hasLiveLoad) {
  const tbl = el('table', { className: 'data-table' });
  tbl.appendChild(el('tr', null, el('td', null, 'Dead Load (D)'), el('td', { className: 'num mono' }, totals.dl.toFixed(1) + ' psf')));
  tbl.appendChild(el('tr', null, el('td', null, 'Superimposed DL — gravity'), el('td', { className: 'num mono' }, totals.sdlGravity.toFixed(1) + ' psf')));
  tbl.appendChild(el('tr', null, el('td', null, 'Superimposed DL — lateral'), el('td', { className: 'num mono' }, totals.sdlLateral.toFixed(1) + ' psf')));
  if (hasLiveLoad) {
    tbl.appendChild(el('tr', null, el('td', null, 'Live Load (L)'), el('td', { className: 'num mono' }, totals.llGravity.toFixed(1) + ' psf')));
    tbl.appendChild(el('tr', null, el('td', null, 'Live Load — seismic portion'), el('td', { className: 'num mono' }, totals.llSeismic.toFixed(1) + ' psf')));
  }
  tbl.appendChild(el('tr', { style: { fontWeight: '600' } }, el('td', null, 'Gravity Total'), el('td', { className: 'num mono' }, totals.gravityTotal.toFixed(1) + ' psf')));
  tbl.appendChild(el('tr', { style: { fontWeight: '600' } }, el('td', null, 'Lateral (Seismic) Total'), el('td', { className: 'num mono' }, totals.lateralTotal.toFixed(1) + ' psf')));
  if (totals.asdCombo != null) {
    tbl.appendChild(el('tr', null, el('td', null, 'ASD Combo (D+L)'), el('td', { className: 'num mono' }, totals.asdCombo.toFixed(1) + ' psf')));
    tbl.appendChild(el('tr', null, el('td', null, 'LRFD Combo (1.2D+1.6L)'), el('td', { className: 'num mono' }, totals.lrfdCombo.toFixed(1) + ' psf')));
  }
  return tbl;
}
