import { el, clearEl, numOrBlank } from '../utils.js';

const round2 = v => Math.round(v * 100) / 100;
const round4 = v => Math.round(v * 10000) / 10000;

export const elfDiaphragmCollector = {
  id: 'elf_diaphragm_collector',
  label: 'ELF Diaphragm & Collector',
  schemaVersion: 1,
  calcVersion: 'v1',
  refs: [
    { key: 'massSource', label: 'Seismic Mass Takeoff', sourceType: 'seismic_mass_takeoff',
      extract: (outputs) => ({ perLevel: outputs.perLevel, totalSeismicWeight: outputs.totalSeismicWeight }) },
    { key: 'baseShearSource', label: 'Seismic Base Shear', sourceType: 'seismic_base_shear',
      extract: (outputs) => ({ cs: outputs.cs, sds: outputs.sds, ie: outputs.ie, omega0: outputs.omega0, k: outputs.k }) },
  ],
  fields: [],
  outputFields: [],

  migrate(item) { return item; },

  summaryLabel(inputs, outputs) {
    const n = inputs.levels ? inputs.levels.length : 0;
    const v = outputs && outputs.baseShear;
    return 'ELF — ' + n + ' level' + (n !== 1 ? 's' : '') + (v != null ? ' — V = ' + v.toFixed(1) + ' kip' : '');
  },

  calc(inputs) {
    const sds = parseFloat(inputs.sds) || 0;
    const cs = parseFloat(inputs.cs) || 0;
    const ie = parseFloat(inputs.ie) || 1.0;
    const omega0 = parseFloat(inputs.omega0) || 2.5;
    const rho = parseFloat(inputs.rho) || 1.0;
    const k = parseFloat(inputs.k) || 1;
    const levels = inputs.levels || [];

    const parsed = levels.map(lv => {
      const wx = parseFloat(lv.wx) || 0;
      const hx = parseFloat(lv.hx) || 0;
      const wpx = (lv.wpx !== '' && lv.wpx != null && lv.wpx !== '0' && lv.wpx !== 0) ? (parseFloat(lv.wpx) || 0) : wx;
      const wxhk = wx * Math.pow(Math.max(hx, 0), k);
      return { name: lv.name || '', wx, hx, wpx, wxhk };
    });

    const W = round2(parsed.reduce((s, lv) => s + lv.wx, 0));
    const V = round2(cs * W);
    const sumWxHk = parsed.reduce((s, lv) => s + lv.wxhk, 0);

    parsed.forEach(lv => {
      lv.cvx = sumWxHk > 0 ? lv.wxhk / sumWxHk : 0;
      lv.fx = round2(lv.cvx * V);
    });

    const sorted = [...parsed].sort((a, b) => b.hx - a.hx);

    let cumV = 0;
    sorted.forEach(lv => { cumV += lv.fx; lv.vx = round2(cumV); });

    let sumFi = 0, sumWi = 0;
    sorted.forEach(lv => {
      sumFi += lv.fx;
      sumWi += lv.wx;
      const ratio = sumWi > 0 ? sumFi / sumWi : 0;
      lv.fpxCalc = round2(ratio * lv.wpx);
      lv.fpxMin = round2(0.2 * sds * ie * lv.wpx);
      lv.fpxMax = round2(0.4 * sds * ie * lv.wpx);
      lv.fpxDesign = round2(Math.min(Math.max(lv.fpxCalc, lv.fpxMin), lv.fpxMax));
    });

    const mult = inputs.increase25 ? 1.25 : 1.0;
    sorted.forEach(lv => {
      lv.omega0Fx = round2(omega0 * lv.fx);
      lv.omega0Fpx = round2(omega0 * lv.fpxDesign);
      lv.lightFrameForce = inputs.lightFrame ? round2(0.4 * sds * ie * lv.wpx) : 0;
      const maxForce = Math.max(lv.omega0Fx, lv.omega0Fpx, lv.lightFrameForce);
      lv.collectorDesign = round2(maxForce * mult);
    });

    return {
      baseShear: V, totalW: W,
      elfTable: sorted.map(lv => ({
        level: lv.name, wx: round2(lv.wx), hx: round2(lv.hx),
        wxhk: round2(lv.wxhk), cvx: round4(lv.cvx), fx: lv.fx, vx: lv.vx,
      })),
      diaphragmTable: sorted.map(lv => ({
        level: lv.name, wpx: round2(lv.wpx),
        fpxCalc: lv.fpxCalc, fpxMin: lv.fpxMin, fpxMax: lv.fpxMax, fpxDesign: lv.fpxDesign,
      })),
      collectorTable: sorted.map(lv => ({
        level: lv.name, omega0Fx: lv.omega0Fx, omega0Fpx: lv.omega0Fpx,
        lightFrame: lv.lightFrameForce, designForce: lv.collectorDesign,
      })),
      calcVersion: 'v1',
    };
  },

  renderForm(container, existingInputs, onSave, projectItems) {
    const inputs = existingInputs && existingInputs.sds !== undefined ? existingInputs : {
      sds: '', cs: '', ie: '1.0', omega0: '2.5', rho: '1.0', k: '1',
      lightFrame: false, increase25: false,
      levels: [{ name: 'Roof', wx: '', hx: '', wpx: '' }, { name: '2nd Floor', wx: '', hx: '', wpx: '' }],
      refs: {}, notes: '',
    };
    if (!inputs.refs) inputs.refs = {};
    clearEl(container);

    const massItems = (projectItems || []).filter(it => it.type === 'seismic_mass_takeoff' && !it.archived);
    const baseShearItems = (projectItems || []).filter(it => it.type === 'seismic_base_shear' && !it.archived);

    const formBody = el('div');
    const levelDiv = el('div');

    function paramBox(labelParts, key, placeholder, width) {
      return el('div', { className: 'form-group', style: { marginBottom: 0 } },
        el('label', { className: 'form-label' }, ...labelParts),
        el('input', { className: 'form-input mono', style: { width: width || '70px' }, type: 'number', step: 'any', placeholder, value: numOrBlank(inputs[key]),
          onChange(e) { inputs[key] = e.target.value; } }));
    }

    function renderLevelTable() {
      clearEl(levelDiv);
      const tbl = el('table', { className: 'dynamic-table' });
      tbl.appendChild(el('tr', null,
        el('th', null, 'Level'), el('th', null, 'w', el('sub', null, 'x'), ' (kip)'),
        el('th', null, 'h', el('sub', null, 'x'), ' (ft)'), el('th', null, 'w', el('sub', null, 'px'), ' (kip)'),
        el('th', { className: 'row-actions' }, '')));
      inputs.levels.forEach((lv, i) => {
        tbl.appendChild(el('tr', null,
          el('td', null, el('input', { type: 'text', value: lv.name || '', placeholder: 'Level', onInput(e) { lv.name = e.target.value; } })),
          el('td', null, el('input', { type: 'number', step: 'any', value: numOrBlank(lv.wx), placeholder: '0', onChange(e) { lv.wx = e.target.value; } })),
          el('td', null, el('input', { type: 'number', step: 'any', value: numOrBlank(lv.hx), placeholder: '0', onChange(e) { lv.hx = e.target.value; } })),
          el('td', null, el('input', { type: 'number', step: 'any', value: numOrBlank(lv.wpx), placeholder: '= wₓ', onChange(e) { lv.wpx = e.target.value; } })),
          el('td', { className: 'row-actions' },
            el('button', { className: 'btn btn-ghost btn-sm', type: 'button', onClick() { inputs.levels.splice(i, 1); renderLevelTable(); } }, '×')),
        ));
      });
      levelDiv.appendChild(el('div', { className: 'table-scroll' }, tbl));
      levelDiv.appendChild(el('button', { className: 'btn btn-sm', type: 'button', style: { marginTop: '0.5rem' },
        onClick() { inputs.levels.push({ name: '', wx: '', hx: '', wpx: '' }); renderLevelTable(); } }, '+ Add Level'));
    }

    function renderAll() {
      clearEl(formBody);

      if (massItems.length > 0) {
        const refSelect = el('select', { className: 'form-select', style: { maxWidth: '300px' },
          onChange(e) {
            if (e.target.value) {
              inputs.refs.massSource = e.target.value;
              const linked = massItems.find(it => it.id === e.target.value);
              if (linked && linked.outputs && linked.outputs.perLevel) {
                inputs.levels = linked.outputs.perLevel.map(lv => ({
                  name: lv.label || '', wx: String(lv.seismicWeight || ''), hx: String(lv.hx || ''), wpx: '',
                }));
              }
            } else {
              delete inputs.refs.massSource;
            }
            renderLevelTable();
          } });
        refSelect.appendChild(el('option', { value: '' }, '— None —'));
        massItems.forEach(it => {
          const opt = el('option', { value: it.id }, (it.label || 'Seismic Mass Takeoff') +
            (it.outputs ? ' (W=' + it.outputs.totalSeismicWeight + 'k)' : ''));
          if (inputs.refs.massSource === it.id) opt.selected = true;
          refSelect.appendChild(opt);
        });
        formBody.appendChild(el('div', { className: 'form-group' },
          el('label', { className: 'form-label' }, 'Link to Seismic Mass Takeoff'), refSelect));
      }

      if (baseShearItems.length > 0) {
        const bsSelect = el('select', { className: 'form-select', style: { maxWidth: '340px' },
          onChange(e) {
            if (e.target.value) {
              inputs.refs.baseShearSource = e.target.value;
              const linked = baseShearItems.find(it => it.id === e.target.value);
              if (linked && linked.outputs) {
                inputs.sds = String(linked.outputs.sds || '');
                inputs.cs = String(linked.outputs.cs || '');
                inputs.ie = String(linked.outputs.ie || '');
                inputs.omega0 = String(linked.outputs.omega0 || '');
                inputs.k = String(linked.outputs.k || '');
              }
            } else {
              delete inputs.refs.baseShearSource;
            }
            renderAll();
          } });
        bsSelect.appendChild(el('option', { value: '' }, '— None —'));
        baseShearItems.forEach(it => {
          const label = (it.custom_name || it.label || 'Seismic Base Shear') +
            (it.outputs ? ' (Cs=' + it.outputs.cs + ')' : '');
          const opt = el('option', { value: it.id }, label);
          if (inputs.refs.baseShearSource === it.id) opt.selected = true;
          bsSelect.appendChild(opt);
        });
        formBody.appendChild(el('div', { className: 'form-group' },
          el('label', { className: 'form-label' }, 'Link to Seismic Base Shear'), bsSelect));
      }

      formBody.appendChild(el('div', { className: 'form-label', style: { marginBottom: '0.25rem' } }, 'Seismic Parameters'));
      const paramRow = el('div', { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' } });
      paramRow.appendChild(paramBox(['S', el('sub', null, 'DS')], 'sds', '0.9'));
      paramRow.appendChild(paramBox(['C', el('sub', null, 's')], 'cs', '0.15'));
      paramRow.appendChild(paramBox(['I', el('sub', null, 'e')], 'ie', '1.0'));
      paramRow.appendChild(paramBox(['Ω', el('sub', null, '0')], 'omega0', '2.5'));
      paramRow.appendChild(paramBox(['ρ'], 'rho', '1.0'));
      paramRow.appendChild(paramBox(['k'], 'k', '1'));
      formBody.appendChild(paramRow);

      const toggleRow = el('div', { style: { display: 'flex', gap: '1.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' } });
      const lfCheck = el('input', { type: 'checkbox', checked: !!inputs.lightFrame, onChange(e) { inputs.lightFrame = e.target.checked; } });
      toggleRow.appendChild(el('label', { style: { display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' } },
        lfCheck, 'Light-frame diaphragm (§12.10.2.1c)'));
      const incCheck = el('input', { type: 'checkbox', checked: !!inputs.increase25, onChange(e) { inputs.increase25 = e.target.checked; } });
      toggleRow.appendChild(el('label', { style: { display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' } },
        incCheck, '25% collector increase'));
      formBody.appendChild(toggleRow);

      formBody.appendChild(el('div', { className: 'form-label' }, 'Level Data'));
      renderLevelTable();
      formBody.appendChild(levelDiv);

      formBody.appendChild(el('div', { className: 'form-group', style: { marginTop: '0.75rem' } },
        el('textarea', { className: 'form-input', rows: '2', placeholder: 'Assumptions, notes…', value: inputs.notes || '',
          onInput(e) { inputs.notes = e.target.value; } })));
    }

    renderAll();
    container.appendChild(formBody);
    container.appendChild(el('div', { style: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' } },
      el('button', { className: 'btn btn-primary', type: 'button', onClick() { onSave(inputs); } }, 'Calculate & Save')));
  },

  renderOutputs(container, outputs) {
    if (!outputs || !outputs.elfTable) return;
    clearEl(container);

    const v = outputs.baseShear;
    const w = outputs.totalW;
    container.appendChild(el('div', { style: { fontWeight: '600', marginBottom: '0.75rem', fontSize: '0.95rem' } },
      'V = C', el('sub', null, 's'), ' · W = ', el('span', { className: 'mono' }, v.toFixed(1) + ' kip'),
      el('span', { style: { color: 'var(--ink-tertiary)', marginLeft: '0.5rem', fontSize: '0.8rem' } }, '(W = ' + w.toFixed(1) + ' kip)')));

    function outputTable(title, headers, rows) {
      container.appendChild(el('div', { className: 'form-label', style: { marginTop: '0.75rem' } }, title));
      const tbl = el('table', { className: 'data-table' });
      tbl.appendChild(el('tr', null, ...headers.map(h => {
        if (typeof h === 'string') return el('th', { className: h === 'Level' ? '' : 'num' }, h);
        return el('th', { className: 'num' }, ...h);
      })));
      rows.forEach(row => {
        tbl.appendChild(el('tr', null, ...row.map((c, i) =>
          el('td', { className: i === 0 ? '' : 'num mono' }, typeof c === 'number' ? c.toFixed(i === 4 ? 4 : 2) : c))));
      });
      container.appendChild(el('div', { className: 'table-scroll' }, tbl));
    }

    outputTable('ELF Story Shear (§12.8)',
      ['Level', ['w', el('sub', null, 'x'), ' (kip)'], ['h', el('sub', null, 'x'), ' (ft)'],
        ['w', el('sub', null, 'x'), '·h', el('sub', null, 'x'), el('sup', null, 'k')],
        ['C', el('sub', null, 'vx')], ['F', el('sub', null, 'x'), ' (kip)'], ['V', el('sub', null, 'x'), ' (kip)']],
      outputs.elfTable.map(r => [r.level, r.wx, r.hx, r.wxhk, r.cvx, r.fx, r.vx]));

    outputTable('Diaphragm Forces (§12.10.1.1)',
      ['Level', ['w', el('sub', null, 'px'), ' (kip)'], ['F', el('sub', null, 'px'), ' calc'],
        ['F', el('sub', null, 'px,min')], ['F', el('sub', null, 'px,max')], ['F', el('sub', null, 'px'), ' design (kip)']],
      outputs.diaphragmTable.map(r => [r.level, r.wpx, r.fpxCalc, r.fpxMin, r.fpxMax, r.fpxDesign]));

    const collHeaders = ['Level', ['Ω', el('sub', null, '0'), '·F', el('sub', null, 'x')],
      ['Ω', el('sub', null, '0'), '·F', el('sub', null, 'px')]];
    const collHasLF = outputs.collectorTable.some(r => r.lightFrame > 0);
    if (collHasLF) collHeaders.push('Light Frame (kip)');
    collHeaders.push(['F', el('sub', null, 'c'), ' design (kip)']);

    outputTable('Collector Forces (§12.10.2.1)', collHeaders,
      outputs.collectorTable.map(r => {
        const row = [r.level, r.omega0Fx, r.omega0Fpx];
        if (collHasLF) row.push(r.lightFrame);
        row.push(r.designForce);
        return row;
      }));
  },

  pdfSections(inputs, outputs) {
    const sections = [];
    if (!outputs) return sections;

    const sds = inputs.sds || '—';
    const cs = inputs.cs || '—';
    const ie = inputs.ie || '—';
    const omega0 = inputs.omega0 || '—';
    const rho = inputs.rho || '—';
    const k = inputs.k || '—';

    sections.push({
      title: 'Seismic Parameters',
      rows: [
        ['SDS', sds], ['Cs', cs], ['Ie', ie],
        ['Ω0', omega0], ['ρ', rho], ['k', k],
        ['Base Shear V', outputs.baseShear.toFixed(2) + ' kip'],
        ['Total W', outputs.totalW.toFixed(1) + ' kip'],
      ],
    });

    if (inputs.lightFrame || inputs.increase25) {
      sections.push({
        title: 'Options',
        rows: [
          ...(inputs.lightFrame ? [['Light-frame exception', '§12.10.2.1(c)']] : []),
          ...(inputs.increase25 ? [['25% collector increase', 'Applied']] : []),
        ],
      });
    }

    sections.push({
      title: 'ELF Story Shear — ASCE 7-22 §12.8',
      table: {
        headers: ['Level', 'wx (kip)', 'hx (ft)', 'wx·hx^k', 'Cvx', 'Fx (kip)', 'Vx (kip)'],
        rows: outputs.elfTable.map(r => [r.level, r.wx.toFixed(1), r.hx.toFixed(1), r.wxhk.toFixed(1), r.cvx.toFixed(4), r.fx.toFixed(2), r.vx.toFixed(2)]),
      },
    });

    sections.push({
      title: 'Diaphragm Design Forces — ASCE 7-22 §12.10.1.1',
      table: {
        headers: ['Level', 'wpx (kip)', 'Fpx calc', 'Fpx,min', 'Fpx,max', 'Fpx design (kip)'],
        rows: outputs.diaphragmTable.map(r => [r.level, r.wpx.toFixed(1), r.fpxCalc.toFixed(2), r.fpxMin.toFixed(2), r.fpxMax.toFixed(2), r.fpxDesign.toFixed(2)]),
      },
    });

    const collHasLF = outputs.collectorTable.some(r => r.lightFrame > 0);
    const collHeaders = ['Level', 'Ω0·Fx', 'Ω0·Fpx'];
    if (collHasLF) collHeaders.push('Light Frame');
    collHeaders.push('Fc design (kip)');
    sections.push({
      title: 'Collector Design Forces — ASCE 7-22 §12.10.2.1',
      table: {
        headers: collHeaders,
        rows: outputs.collectorTable.map(r => {
          const row = [r.level, r.omega0Fx.toFixed(2), r.omega0Fpx.toFixed(2)];
          if (collHasLF) row.push(r.lightFrame.toFixed(2));
          row.push(r.designForce.toFixed(2));
          return row;
        }),
      },
    });

    if (inputs.notes) sections.push({ title: 'Notes', text: inputs.notes });

    // Equations page
    sections.push({
      title: 'Design Equations — ASCE 7-22',
      pageBreakBefore: true,
      equations: [
        { desc: 'Equivalent Lateral Force Procedure (§12.8)',
          parts: [] },
        { ref: 'Eq. 12.8-1',
          parts: [{ t: 'V = C' }, { t: 's', sub: true }, { t: ' · W' }] },
        { ref: 'Eq. 12.8-12',
          parts: [
            { t: 'C' }, { t: 'vx', sub: true }, { t: ' = (w' }, { t: 'x', sub: true },
            { t: ' · h' }, { t: 'x', sub: true }, { t: 'k', sup: true },
            { t: ') / ' }, { t: 'S', greek: true }, { t: '(w' }, { t: 'i', sub: true },
            { t: ' · h' }, { t: 'i', sub: true }, { t: 'k', sup: true }, { t: ')' },
          ] },
        { ref: 'Eq. 12.8-11',
          parts: [{ t: 'F' }, { t: 'x', sub: true }, { t: ' = C' }, { t: 'vx', sub: true }, { t: ' · V' }] },
        { ref: '§12.8.6',
          parts: [{ t: 'V' }, { t: 'x', sub: true }, { t: ' = ' }, { t: 'S', greek: true }, { t: 'F' }, { t: 'i', sub: true }] },

        { desc: 'Diaphragm Design Forces (§12.10.1.1)',
          parts: [] },
        { ref: 'Eq. 12.10-1',
          parts: [
            { t: 'F' }, { t: 'px', sub: true }, { t: ' = (' }, { t: 'S', greek: true }, { t: 'F' }, { t: 'i', sub: true },
            { t: ' / ' }, { t: 'S', greek: true }, { t: 'w' }, { t: 'i', sub: true },
            { t: ') · w' }, { t: 'px', sub: true },
          ] },
        { ref: 'Eq. 12.10-2',
          parts: [
            { t: 'F' }, { t: 'px,max', sub: true }, { t: ' = 0.4 · S' }, { t: 'DS', sub: true },
            { t: ' · I' }, { t: 'e', sub: true }, { t: ' · w' }, { t: 'px', sub: true },
          ] },
        { ref: 'Eq. 12.10-3',
          parts: [
            { t: 'F' }, { t: 'px,min', sub: true }, { t: ' = 0.2 · S' }, { t: 'DS', sub: true },
            { t: ' · I' }, { t: 'e', sub: true }, { t: ' · w' }, { t: 'px', sub: true },
          ] },

        { desc: 'Collector Design Forces (§12.10.2.1)',
          parts: [] },
        { ref: '§12.10.2.1(a)',
          parts: [
            { t: 'F' }, { t: 'c,a', sub: true }, { t: ' = ' }, { t: 'W', greek: true }, { t: '0', sub: true },
            { t: ' · F' }, { t: 'x', sub: true },
          ] },
        { ref: '§12.10.2.1(b)',
          parts: [
            { t: 'F' }, { t: 'c,b', sub: true }, { t: ' = ' }, { t: 'W', greek: true }, { t: '0', sub: true },
            { t: ' · F' }, { t: 'px', sub: true },
          ] },
        { ref: '§12.10.2.1(c)',
          parts: [
            { t: 'F' }, { t: 'c,c', sub: true }, { t: ' = 0.4 · S' }, { t: 'DS', sub: true },
            { t: ' · I' }, { t: 'e', sub: true }, { t: ' · w' }, { t: 'px', sub: true },
            { t: '  (light-frame only)' },
          ] },
        { ref: 'Governing',
          parts: [
            { t: 'F' }, { t: 'c', sub: true }, { t: ' = max(F' }, { t: 'c,a', sub: true },
            { t: ', F' }, { t: 'c,b', sub: true }, { t: ', F' }, { t: 'c,c', sub: true }, { t: ')' },
          ] },
      ],
    });

    return sections;
  },
};
