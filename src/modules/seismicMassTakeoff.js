import { el, clearEl } from '../utils.js';

export const seismicMassTakeoff = {
  id: 'seismic_mass_takeoff',
  label: 'Seismic Mass Takeoff',
  schemaVersion: 1,
  calcVersion: 'PLACEHOLDER_v1',
  refs: [],
  fields: [
    { key: 'levels', label: 'Levels', type: 'table', columns: [
      { key: 'label', label: 'Level', unit: '' },
      { key: 'elevation', label: 'Elevation', unit: 'ft', precision: 1 },
      { key: 'deadLoad', label: 'Dead Load', unit: 'psf', precision: 1 },
      { key: 'areaSF', label: 'Area', unit: 'sf', precision: 0 },
      { key: 'wallWeight', label: 'Wall Wt', unit: 'psf', precision: 1 },
    ] },
    { key: 'notes', label: 'Notes', type: 'text' },
  ],
  outputFields: [
    { key: 'perLevel', label: 'Per-Level Seismic Weight', type: 'table', columns: [
      { key: 'label', label: 'Level', unit: '' },
      { key: 'seismicWeight', label: 'Seismic Weight', unit: 'kips', precision: 1 },
    ] },
    { key: 'totalSeismicWeight', label: 'Total Seismic Weight (W)', unit: 'kips', precision: 1, type: 'value' },
  ],

  migrate(item) { return item; },

  summaryLabel(inputs, outputs) {
    const n = inputs.levels ? inputs.levels.length : 0;
    const w = outputs && outputs.totalSeismicWeight;
    return 'Seismic Mass — ' + n + ' level' + (n !== 1 ? 's' : '') + (w != null ? ' — W = ' + w.toFixed(1) + ' kips' : '');
  },

  calc(inputs) {
    const levels = inputs.levels || [];
    const perLevel = levels.map((lv) => {
      const dl = (parseFloat(lv.deadLoad) || 0) * (parseFloat(lv.areaSF) || 0) / 1000;
      return { label: lv.label || '', seismicWeight: Math.round(dl * 10) / 10 };
    });
    const totalSeismicWeight = Math.round(perLevel.reduce((s, l) => s + l.seismicWeight, 0) * 10) / 10;
    return { perLevel, totalSeismicWeight, calcVersion: 'PLACEHOLDER_v1' };
  },

  renderForm(container, existingInputs, onSave) {
    const inputs = existingInputs || { levels: [{ label: 'Roof', elevation: '', deadLoad: '', areaSF: '', wallWeight: '' }], notes: '' };
    clearEl(container);

    const levelsDiv = el('div');
    function renderLevels() {
      clearEl(levelsDiv);
      const tbl = el('table', { className: 'dynamic-table' });
      tbl.appendChild(el('tr', null,
        el('th', null, 'Level'),
        el('th', null, 'Elev. (ft)'),
        el('th', null, 'Dead Load (psf)'),
        el('th', null, 'Area (sf)'),
        el('th', null, 'Wall Wt (psf)'),
        el('th', { className: 'row-actions' }, ''),
      ));
      inputs.levels.forEach((lv, i) => {
        tbl.appendChild(el('tr', null,
          el('td', null, el('input', { type: 'text', value: lv.label || '', placeholder: 'e.g. Roof', onInput(e) { lv.label = e.target.value; } })),
          el('td', null, el('input', { type: 'number', value: lv.elevation || '', placeholder: '0', onInput(e) { lv.elevation = e.target.value; } })),
          el('td', null, el('input', { type: 'number', value: lv.deadLoad || '', placeholder: '0', onInput(e) { lv.deadLoad = e.target.value; } })),
          el('td', null, el('input', { type: 'number', value: lv.areaSF || '', placeholder: '0', onInput(e) { lv.areaSF = e.target.value; } })),
          el('td', null, el('input', { type: 'number', value: lv.wallWeight || '', placeholder: '0', onInput(e) { lv.wallWeight = e.target.value; } })),
          el('td', { className: 'row-actions' },
            el('button', { className: 'btn btn-ghost btn-sm', type: 'button', onClick() { inputs.levels.splice(i, 1); renderLevels(); }, title: 'Remove' }, '×')),
        ));
      });
      levelsDiv.appendChild(el('div', { className: 'table-scroll' }, tbl));
      levelsDiv.appendChild(el('button', { className: 'btn btn-sm', type: 'button', style: { marginTop: '0.5rem' },
        onClick() { inputs.levels.push({ label: '', elevation: '', deadLoad: '', areaSF: '', wallWeight: '' }); renderLevels(); },
      }, '+ Add Level'));
    }
    renderLevels();

    const notesInput = el('textarea', {
      className: 'form-input', rows: '2', placeholder: 'Assumptions, overrides, notes...',
      value: inputs.notes || '', onInput(e) { inputs.notes = e.target.value; },
    });

    container.appendChild(el('div', { className: 'form-group' }, el('label', { className: 'form-label' }, 'Building Levels'), levelsDiv));
    container.appendChild(el('div', { className: 'form-group' }, el('label', { className: 'form-label' }, 'Notes'), notesInput));
    container.appendChild(el('div', { style: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' } },
      el('button', { className: 'btn btn-primary', type: 'button', onClick() { onSave(inputs); } }, 'Calculate & Save'),
    ));
  },

  renderOutputs(container, outputs) {
    if (!outputs) return;
    clearEl(container);
    const tbl = el('table', { className: 'data-table' });
    tbl.appendChild(el('tr', null, el('th', null, 'Level'), el('th', { className: 'num' }, 'Seismic Weight (kips)')));
    (outputs.perLevel || []).forEach((lv) => {
      tbl.appendChild(el('tr', null, el('td', null, lv.label), el('td', { className: 'num mono' }, lv.seismicWeight != null ? lv.seismicWeight.toFixed(1) : '—')));
    });
    tbl.appendChild(el('tr', { style: { fontWeight: '600' } },
      el('td', null, 'Total W'), el('td', { className: 'num mono' }, outputs.totalSeismicWeight != null ? outputs.totalSeismicWeight.toFixed(1) : '—'),
    ));
    container.appendChild(el('div', { className: 'table-scroll' }, tbl));
    if (outputs.calcVersion === 'PLACEHOLDER_v1') {
      container.appendChild(el('div', { className: 'badge badge-placeholder', style: { marginTop: '0.5rem' } }, 'Placeholder calc — formula pending'));
    }
  },

  pdfSections(inputs, outputs) {
    const sections = [];
    if (inputs.levels && inputs.levels.length) {
      sections.push({
        title: 'Input — Building Levels',
        table: {
          headers: ['Level', 'Elev. (ft)', 'Dead Load (psf)', 'Area (sf)', 'Wall Wt (psf)'],
          rows: inputs.levels.map((lv) => [lv.label || '', lv.elevation || '', lv.deadLoad || '', lv.areaSF || '', lv.wallWeight || '']),
        },
      });
    }
    if (inputs.notes) sections.push({ title: 'Notes', text: inputs.notes });
    if (outputs && outputs.perLevel) {
      sections.push({
        title: 'Results — Per-Level Seismic Weight',
        table: { headers: ['Level', 'Seismic Weight (kips)'], rows: outputs.perLevel.map((lv) => [lv.label, lv.seismicWeight != null ? lv.seismicWeight.toFixed(1) : '']) },
      });
      sections.push({ title: 'Total Seismic Weight', rows: [['W', (outputs.totalSeismicWeight != null ? outputs.totalSeismicWeight.toFixed(1) : '—') + ' kips']] });
    }
    return sections;
  },
};
