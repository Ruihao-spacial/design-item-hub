import { el, clearEl } from '../utils.js';

export const shearWallDesign = {
  id: 'shear_wall_design',
  label: 'Shear Wall Design',
  schemaVersion: 1,
  calcVersion: 'PLACEHOLDER_v1',
  refs: [
    { key: 'massSource', label: 'Seismic Mass Takeoff', sourceType: 'seismic_mass_takeoff',
      extract: (outputs) => ({ totalW: outputs.totalSeismicWeight }) },
  ],
  fields: [
    { key: 'walls', label: 'Shear Wall Schedule', type: 'table', columns: [
      { key: 'mark', label: 'Mark', unit: '' },
      { key: 'level', label: 'Level', unit: '' },
      { key: 'length', label: 'Length', unit: 'ft', precision: 1 },
      { key: 'height', label: 'Height', unit: 'ft', precision: 1 },
      { key: 'sheathing', label: 'Sheathing', unit: '' },
      { key: 'nailing', label: 'Nailing', unit: '' },
      { key: 'demand', label: 'Demand', unit: 'plf', precision: 0 },
    ] },
  ],
  outputFields: [
    { key: 'wallResults', label: 'Shear Wall Results', type: 'table', columns: [
      { key: 'mark', label: 'Mark', unit: '' },
      { key: 'capacity', label: 'Capacity', unit: 'plf', precision: 0 },
      { key: 'dcRatio', label: 'D/C', unit: '', precision: 2 },
      { key: 'status', label: 'Status', unit: '' },
    ] },
  ],

  migrate(item) { return item; },

  summaryLabel(inputs) {
    const n = inputs.walls ? inputs.walls.length : 0;
    return 'Shear Wall Schedule — ' + n + ' wall' + (n !== 1 ? 's' : '');
  },

  calc(inputs) {
    const walls = inputs.walls || [];
    const wallResults = walls.map((w) => {
      const capacity = 500;
      const demand = parseFloat(w.demand) || 0;
      const dcRatio = capacity > 0 ? Math.round((demand / capacity) * 100) / 100 : 0;
      return { mark: w.mark || '', capacity, dcRatio, status: dcRatio <= 1.0 ? 'OK' : 'NG' };
    });
    return { wallResults, calcVersion: 'PLACEHOLDER_v1' };
  },

  renderForm(container, existingInputs, onSave, projectItems) {
    const inputs = existingInputs || {
      walls: [{ mark: 'SW-1', level: '', length: '', height: '', sheathing: '', nailing: '', demand: '' }],
      refs: {},
    };
    if (!inputs.refs) inputs.refs = {};
    clearEl(container);

    const massItems = (projectItems || []).filter((it) => it.type === 'seismic_mass_takeoff' && !it.archived);
    if (massItems.length > 0) {
      const refSelect = el('select', { className: 'form-select', style: { maxWidth: '300px' },
        onInput(e) {
          if (e.target.value) inputs.refs.massSource = e.target.value;
          else delete inputs.refs.massSource;
        },
      }, el('option', { value: '' }, '— None —'));
      massItems.forEach((it) => {
        const opt = el('option', { value: it.id }, it.label || it.type);
        if (inputs.refs.massSource === it.id) opt.selected = true;
        refSelect.appendChild(opt);
      });
      container.appendChild(el('div', { className: 'form-group' },
        el('label', { className: 'form-label' }, 'Link to Seismic Mass Takeoff'), refSelect,
      ));
    }

    const wallsDiv = el('div');
    function renderWalls() {
      clearEl(wallsDiv);
      const tbl = el('table', { className: 'dynamic-table' });
      tbl.appendChild(el('tr', null,
        el('th', null, 'Mark'), el('th', null, 'Level'), el('th', null, 'Length (ft)'), el('th', null, 'Height (ft)'),
        el('th', null, 'Sheathing'), el('th', null, 'Nailing'), el('th', null, 'Demand (plf)'), el('th', { className: 'row-actions' }, ''),
      ));
      inputs.walls.forEach((w, i) => {
        tbl.appendChild(el('tr', null,
          el('td', null, el('input', { type: 'text', value: w.mark || '', placeholder: 'SW-1', onInput(e) { w.mark = e.target.value; } })),
          el('td', null, el('input', { type: 'text', value: w.level || '', placeholder: 'L2', onInput(e) { w.level = e.target.value; } })),
          el('td', null, el('input', { type: 'number', value: w.length || '', placeholder: '0', onInput(e) { w.length = e.target.value; } })),
          el('td', null, el('input', { type: 'number', value: w.height || '', placeholder: '0', onInput(e) { w.height = e.target.value; } })),
          el('td', null, el('input', { type: 'text', value: w.sheathing || '', placeholder: '—', onInput(e) { w.sheathing = e.target.value; } })),
          el('td', null, el('input', { type: 'text', value: w.nailing || '', placeholder: '—', onInput(e) { w.nailing = e.target.value; } })),
          el('td', null, el('input', { type: 'number', value: w.demand || '', placeholder: '0', onInput(e) { w.demand = e.target.value; } })),
          el('td', { className: 'row-actions' },
            el('button', { className: 'btn btn-ghost btn-sm', type: 'button', onClick() { inputs.walls.splice(i, 1); renderWalls(); }, title: 'Remove' }, '×')),
        ));
      });
      wallsDiv.appendChild(el('div', { className: 'table-scroll' }, tbl));
      wallsDiv.appendChild(el('button', { className: 'btn btn-sm', type: 'button', style: { marginTop: '0.5rem' },
        onClick() { inputs.walls.push({ mark: '', level: '', length: '', height: '', sheathing: '', nailing: '', demand: '' }); renderWalls(); },
      }, '+ Add Wall'));
    }
    renderWalls();

    container.appendChild(el('div', { className: 'form-group' }, el('label', { className: 'form-label' }, 'Shear Wall Schedule'), wallsDiv));
    container.appendChild(el('div', { style: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' } },
      el('button', { className: 'btn btn-primary', type: 'button', onClick() { onSave(inputs); } }, 'Calculate & Save'),
    ));
  },

  renderOutputs(container, outputs) {
    if (!outputs) return;
    clearEl(container);
    const tbl = el('table', { className: 'data-table' });
    tbl.appendChild(el('tr', null, el('th', null, 'Mark'), el('th', { className: 'num' }, 'Capacity (plf)'), el('th', { className: 'num' }, 'D/C'), el('th', null, 'Status')));
    (outputs.wallResults || []).forEach((w) => {
      const statusBadge = el('span', { className: 'badge ' + (w.status === 'OK' ? 'badge-pass' : 'badge-fail') }, w.status);
      tbl.appendChild(el('tr', null,
        el('td', { className: 'mono' }, w.mark), el('td', { className: 'num mono' }, w.capacity),
        el('td', { className: 'num mono' }, w.dcRatio != null ? w.dcRatio.toFixed(2) : '—'), el('td', null, statusBadge),
      ));
    });
    container.appendChild(el('div', { className: 'table-scroll' }, tbl));
    if (outputs.calcVersion === 'PLACEHOLDER_v1') {
      container.appendChild(el('div', { className: 'badge badge-placeholder', style: { marginTop: '0.5rem' } }, 'Placeholder calc — formula pending'));
    }
  },

  pdfSections(inputs, outputs) {
    const sections = [];
    if (inputs.walls && inputs.walls.length) {
      sections.push({
        title: 'Input — Shear Wall Schedule',
        table: {
          headers: ['Mark', 'Level', 'Length (ft)', 'Height (ft)', 'Sheathing', 'Nailing', 'Demand (plf)'],
          rows: inputs.walls.map((w) => [w.mark || '', w.level || '', w.length || '', w.height || '', w.sheathing || '', w.nailing || '', w.demand || '']),
        },
      });
    }
    if (outputs && outputs.wallResults) {
      sections.push({
        title: 'Results — Shear Wall Design',
        table: { headers: ['Mark', 'Capacity (plf)', 'D/C', 'Status'], rows: outputs.wallResults.map((w) => [w.mark, w.capacity, w.dcRatio != null ? w.dcRatio.toFixed(2) : '', w.status]) },
      });
    }
    return sections;
  },
};
