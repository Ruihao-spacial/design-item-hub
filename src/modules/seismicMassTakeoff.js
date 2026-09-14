import { el, clearEl, numOrBlank } from '../utils.js';

let nextLevelId = 1;
let nextRowId = 1;

function newLevel(name) {
  return {
    id: 'lvl' + (nextLevelId++),
    name: name || '',
    hx: '',
    floorHeight: '',
    areaMasses: [],
    lineMasses: [],
    pointMasses: [],
  };
}

function newAreaMass() {
  return { id: 'am' + (nextRowId++), element: '', area: '', slope: '', psf: '', refKey: '', comments: '' };
}

function newLineMass() {
  return { id: 'lm' + (nextRowId++), element: '', length: '', psf: '', tribHeight: '', refKey: '', comments: '' };
}

function newPointMass() {
  return { id: 'pm' + (nextRowId++), element: '', weight: '', comments: '' };
}

function slopeFactor(rise) {
  const r = parseFloat(rise);
  if (!r || r <= 0) return 1;
  return Math.sqrt(1 + Math.pow(r / 12, 2));
}

function areaWeight(row) {
  const a = parseFloat(row.area) || 0;
  const p = parseFloat(row.psf) || 0;
  return a * p * slopeFactor(row.slope) / 1000;
}

function lineWeight(row) {
  return ((parseFloat(row.length) || 0) * (parseFloat(row.psf) || 0) * (parseFloat(row.tribHeight) || 0)) / 1000;
}

function levelTotals(level) {
  const at = level.areaMasses.reduce((s, r) => s + areaWeight(r), 0);
  const lt = level.lineMasses.reduce((s, r) => s + lineWeight(r), 0);
  const pt = level.pointMasses.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0);
  const round1 = v => Math.round(v * 10) / 10;
  return { area: round1(at), line: round1(lt), point: round1(pt), total: round1(at + lt + pt) };
}

export const seismicMassTakeoff = {
  id: 'seismic_mass_takeoff',
  label: 'Seismic Mass Takeoff',
  schemaVersion: 2,
  calcVersion: 'v1',
  noNewPrefix: true,
  refs: [
    { key: 'flatLoadSource', label: 'Flat Load Calculator', sourceType: 'flat_load_calculator',
      extract: (outputs) => ({ perTab: outputs.perTab }) },
  ],
  fields: [],
  outputFields: [],

  migrate(item) {
    if (!item.inputs || !item.inputs.levels || item.inputs.levels.length === 0) return item;
    if (item.inputs.levels[0].areaMasses !== undefined) return item;
    const oldLevels = item.inputs.levels || [];
    const newLevels = oldLevels.map(lv => {
      const level = newLevel(lv.label);
      level.hx = lv.elevation || '';
      if (lv.deadLoad || lv.areaSF) {
        const am = newAreaMass();
        am.element = lv.label || '';
        am.area = lv.areaSF || '';
        am.psf = lv.deadLoad || '';
        level.areaMasses.push(am);
      }
      return level;
    });
    return { ...item, inputs: { direction: 'both', levels: newLevels, refs: item.inputs.refs || {}, notes: item.inputs.notes || '' }, schemaVersion: 2 };
  },

  summaryLabel(inputs, outputs) {
    const n = inputs.levels ? inputs.levels.length : 0;
    const w = outputs && outputs.totalSeismicWeight;
    return 'Seismic Mass — ' + n + ' level' + (n !== 1 ? 's' : '') + (w != null ? ' — W = ' + w.toFixed(1) + ' kips' : '');
  },

  calc(inputs) {
    const levels = inputs.levels || [];
    const perLevel = levels.map(level => {
      const t = levelTotals(level);
      return {
        label: level.name || '',
        hx: parseFloat(level.hx) || 0,
        floorHeight: parseFloat(level.floorHeight) || 0,
        areaTotal: t.area,
        lineTotal: t.line,
        pointTotal: t.point,
        seismicWeight: t.total,
      };
    });
    const totalSeismicWeight = Math.round(perLevel.reduce((s, l) => s + l.seismicWeight, 0) * 10) / 10;
    return { perLevel, totalSeismicWeight, calcVersion: 'v1' };
  },

  renderForm(container, existingInputs, onSave, projectItems, onInputChange) {
    const isV2 = existingInputs && existingInputs.levels && existingInputs.levels.length > 0 && existingInputs.levels[0].areaMasses !== undefined;
    const inputs = isV2
      ? existingInputs
      : { direction: 'both', levels: [newLevel('Roof'), newLevel('2nd Floor')], refs: {}, notes: '' };
    if (!inputs.refs) inputs.refs = {};
    clearEl(container);

    const flatLoadItems = (projectItems || []).filter(it => it.type === 'flat_load_calculator' && !it.archived);

    function getAssemblies() {
      if (!inputs.refs.flatLoadSource) return [];
      const linked = flatLoadItems.find(it => it.id === inputs.refs.flatLoadSource);
      return (linked && linked.outputs && linked.outputs.perTab) ? linked.outputs.perTab : [];
    }

    function assemblyDLpsf(asm) {
      return Math.round((asm.dlLateral || asm.dl || 0) * 10) / 10;
    }

    const formBody = el('div');

    let initialized = false;
    function notifyChange() {
      if (initialized && onInputChange) onInputChange(inputs);
    }

    function renderAll() {
      clearEl(formBody);
      const assemblies = getAssemblies();

      // Direction + flat-load ref row
      const topRow = el('div', { style: { display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' } });

      const dirSelect = el('select', { className: 'form-select', style: { width: 'auto' },
        onChange(e) { inputs.direction = e.target.value; } });
      ['both', 'x', 'y'].forEach(d => {
        const opt = el('option', { value: d }, d === 'both' ? 'Both Dir' : d.toUpperCase() + '-Dir');
        if (inputs.direction === d) opt.selected = true;
        dirSelect.appendChild(opt);
      });
      topRow.appendChild(el('div', { className: 'form-group', style: { marginBottom: 0 } },
        el('label', { className: 'form-label' }, 'Direction'), dirSelect));

      if (flatLoadItems.length > 0) {
        const refSelect = el('select', { className: 'form-select', style: { maxWidth: '300px' },
          onChange(e) {
            if (e.target.value) inputs.refs.flatLoadSource = e.target.value;
            else delete inputs.refs.flatLoadSource;
            renderAll();
          } });
        refSelect.appendChild(el('option', { value: '' }, '— None —'));
        flatLoadItems.forEach(it => {
          const opt = el('option', { value: it.id }, it.label || 'Flat Load Calculator');
          if (inputs.refs.flatLoadSource === it.id) opt.selected = true;
          refSelect.appendChild(opt);
        });
        topRow.appendChild(el('div', { className: 'form-group', style: { marginBottom: 0, flex: 1 } },
          el('label', { className: 'form-label' }, 'Link to Flat Load Calculator'), refSelect));
      }
      formBody.appendChild(topRow);

      // Notes
      formBody.appendChild(el('div', { className: 'form-group' },
        el('textarea', { className: 'form-input', rows: '2', placeholder: 'Assumptions, notes…', value: inputs.notes || '',
          onInput(e) { inputs.notes = e.target.value; } })));

      // Per-level panels
      inputs.levels.forEach((level, li) => {
        const t = levelTotals(level);
        const panel = el('div', { className: 'panel', style: { marginBottom: '1rem' } });

        // Level header
        panel.appendChild(el('div', { className: 'panel-header' },
          el('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1, flexWrap: 'wrap' } },
            el('span', { style: { fontWeight: '600', fontSize: '0.85rem' } }, 'Level:'),
            el('input', { className: 'form-input', style: { maxWidth: '150px' }, type: 'text', placeholder: 'e.g. Roof', value: level.name || '',
              onInput(e) { level.name = e.target.value; } }),
            el('span', { style: { fontWeight: '600', fontSize: '0.85rem', marginLeft: '0.75rem' } }, 'h', el('sub', null, 'x'), ' ='),
            el('input', { className: 'form-input mono', style: { maxWidth: '70px' }, type: 'number', placeholder: '0', value: numOrBlank(level.hx),
              onChange(e) { level.hx = e.target.value; } }),
            el('span', { style: { fontSize: '0.78rem', color: 'var(--ink-secondary)' } }, 'ft mean story ht'),
            el('span', { style: { fontWeight: '600', fontSize: '0.85rem', marginLeft: '0.75rem' } }, 'h', el('sub', null, 'n'), ' ='),
            el('input', { className: 'form-input mono', style: { maxWidth: '70px' }, type: 'number', placeholder: '0', value: numOrBlank(level.floorHeight),
              onChange(e) { level.floorHeight = e.target.value; } }),
            el('span', { style: { fontSize: '0.78rem', color: 'var(--ink-secondary)' } }, 'ft floor-to-floor'),
          ),
          el('div', { style: { display: 'flex', gap: '0.4rem' } },
            el('button', { className: 'btn btn-ghost btn-sm', type: 'button', disabled: li === 0,
              onClick() { const tmp = inputs.levels[li]; inputs.levels[li] = inputs.levels[li - 1]; inputs.levels[li - 1] = tmp; renderAll(); } }, '▲'),
            el('button', { className: 'btn btn-ghost btn-sm', type: 'button', disabled: li === inputs.levels.length - 1,
              onClick() { const tmp = inputs.levels[li]; inputs.levels[li] = inputs.levels[li + 1]; inputs.levels[li + 1] = tmp; renderAll(); } }, '▼'),
            el('button', { className: 'btn btn-sm', type: 'button',
              onClick() {
                const copy = JSON.parse(JSON.stringify(level));
                copy.id = 'lvl' + (nextLevelId++);
                copy.name = (copy.name || '') + ' (copy)';
                copy.areaMasses.forEach(r => { r.id = 'am' + (nextRowId++); });
                copy.lineMasses.forEach(r => { r.id = 'lm' + (nextRowId++); });
                copy.pointMasses.forEach(r => { r.id = 'pm' + (nextRowId++); });
                inputs.levels.splice(li + 1, 0, copy);
                renderAll();
              } }, 'Duplicate'),
            el('button', { className: 'btn btn-danger btn-sm', type: 'button',
              onClick() { inputs.levels.splice(li, 1); renderAll(); } }, 'Remove'),
          ),
        ));

        const body = el('div', { style: { padding: '0.75rem' } });

        // --- Area Masses ---
        body.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.25rem' } },
          el('div', { className: 'form-label', style: { margin: 0 } }, 'Area Masses'),
          el('button', { className: 'btn btn-sm', type: 'button',
            onClick() { level.areaMasses.push(newAreaMass()); renderAll(); } }, '+ Area Mass'),
        ));
        const hasAsm = assemblies.length > 0;
        const areaCols = hasAsm ? '1fr 75px 60px 150px 70px 50px 80px 24px' : '1fr 75px 60px 70px 50px 80px 24px';
        if (level.areaMasses.length > 0) {
          const hdr = el('div', { style: { display: 'grid', gridTemplateColumns: areaCols, gap: '0.4rem', marginBottom: '0.3rem', fontSize: '0.7rem', color: 'var(--ink-tertiary)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' } },
            el('span', null, 'Element'), el('span', null, 'Area (sf)'), el('span', null, 'Slope'));
          if (hasAsm) hdr.appendChild(el('span', null, 'From Calc'));
          hdr.appendChild(el('span', null, 'psf'));
          hdr.appendChild(el('span'));
          hdr.appendChild(el('span', { style: { textAlign: 'right' } }, 'Wt (kip)'));
          hdr.appendChild(el('span'));
          body.appendChild(hdr);
        }
        level.areaMasses.forEach((row, ri) => {
          const sf = slopeFactor(row.slope);
          const wt = areaWeight(row);
          const wrap = el('div', { style: { marginBottom: '0.4rem', paddingBottom: '0.4rem', borderBottom: '1px dotted var(--border-light)' } });
          const r = el('div', { style: { display: 'grid', gridTemplateColumns: areaCols, gap: '0.4rem', alignItems: 'center' } });
          r.appendChild(el('input', { className: 'form-input', type: 'text', placeholder: 'Element', value: row.element || '',
            onInput(e) { row.element = e.target.value; } }));
          r.appendChild(el('input', { className: 'form-input mono', type: 'number', placeholder: 'sf', value: numOrBlank(row.area),
            onChange(e) { row.area = e.target.value; renderAll(); } }));
          r.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '2px' } },
            el('input', { className: 'form-input mono', style: { width: '36px', padding: '0.3rem' }, type: 'number', min: '0', placeholder: '—', value: numOrBlank(row.slope),
              onChange(e) { row.slope = e.target.value; renderAll(); } }),
            el('span', { style: { fontSize: '0.7rem', color: 'var(--ink-tertiary)' } }, ':12'),
          ));
          if (hasAsm) {
            const asmSel = el('select', { className: 'form-select', style: { fontSize: '0.78rem' },
              onChange(e) {
                row.refKey = e.target.value;
                if (e.target.value) { const a = assemblies.find(x => x.id === e.target.value); if (a) row.psf = assemblyDLpsf(a); }
                renderAll();
              } });
            asmSel.appendChild(el('option', { value: '' }, '— Manual —'));
            assemblies.forEach(a => {
              const opt = el('option', { value: a.id }, a.name + ' (' + assemblyDLpsf(a) + ')');
              if (row.refKey === a.id) opt.selected = true;
              asmSel.appendChild(opt);
            });
            r.appendChild(asmSel);
          }
          r.appendChild(el('input', { className: 'form-input mono', type: 'number', placeholder: 'psf', value: numOrBlank(row.psf),
            onChange(e) { row.psf = e.target.value; row.refKey = ''; renderAll(); } }));
          r.appendChild(el('span', { className: 'mono', style: { fontSize: '0.7rem', color: 'var(--accent)', whiteSpace: 'nowrap' } }, sf > 1.001 ? '×' + sf.toFixed(3) : ''));
          r.appendChild(el('span', { className: 'mono', style: { fontWeight: '600', textAlign: 'right' } }, wt.toFixed(1) + ' k'));
          r.appendChild(el('button', { className: 'btn btn-ghost btn-sm', type: 'button',
            onClick() { level.areaMasses.splice(ri, 1); renderAll(); } }, '×'));
          wrap.appendChild(r);
          if (row.comments) {
            wrap.appendChild(el('div', { style: { paddingLeft: '0.25rem', marginTop: '0.25rem' } },
              el('input', { className: 'form-input', style: { width: '100%', fontSize: '0.78rem', color: 'var(--ink-secondary)' }, type: 'text', placeholder: 'Comments', value: row.comments,
                onInput(e) { row.comments = e.target.value; } })));
          } else {
            wrap.appendChild(el('div', { style: { paddingLeft: '0.25rem', marginTop: '0.25rem' } },
              el('input', { className: 'form-input', style: { width: '100%', fontSize: '0.78rem', color: 'var(--ink-secondary)' }, type: 'text', placeholder: 'Comments (optional)',
                onInput(e) { row.comments = e.target.value; } })));
          }
          body.appendChild(wrap);
        });

        // --- Line Masses ---
        body.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
          el('div', { className: 'form-label', style: { margin: 0 } }, 'Line Masses'),
          el('button', { className: 'btn btn-sm', type: 'button',
            onClick() { level.lineMasses.push(newLineMass()); renderAll(); } }, '+ Line Mass'),
        ));
        const lineCols = hasAsm ? '1fr 75px 150px 70px 70px 80px 24px' : '1fr 75px 70px 70px 80px 24px';
        if (level.lineMasses.length > 0) {
          const hdr = el('div', { style: { display: 'grid', gridTemplateColumns: lineCols, gap: '0.4rem', marginBottom: '0.3rem', fontSize: '0.7rem', color: 'var(--ink-tertiary)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' } },
            el('span', null, 'Element'), el('span', null, 'Len (ft)'));
          if (hasAsm) hdr.appendChild(el('span', null, 'From Calc'));
          hdr.appendChild(el('span', null, 'psf'));
          hdr.appendChild(el('span', null, 'Trib Ht'));
          hdr.appendChild(el('span', { style: { textAlign: 'right' } }, 'Wt (kip)'));
          hdr.appendChild(el('span'));
          body.appendChild(hdr);
        }
        level.lineMasses.forEach((row, ri) => {
          const wt = lineWeight(row);
          const wrap = el('div', { style: { marginBottom: '0.4rem', paddingBottom: '0.4rem', borderBottom: '1px dotted var(--border-light)' } });
          const r = el('div', { style: { display: 'grid', gridTemplateColumns: lineCols, gap: '0.4rem', alignItems: 'center' } });
          r.appendChild(el('input', { className: 'form-input', type: 'text', placeholder: 'Element', value: row.element || '',
            onInput(e) { row.element = e.target.value; } }));
          r.appendChild(el('input', { className: 'form-input mono', type: 'number', placeholder: 'ft', value: numOrBlank(row.length),
            onChange(e) { row.length = e.target.value; renderAll(); } }));
          if (hasAsm) {
            const asmSel = el('select', { className: 'form-select', style: { fontSize: '0.78rem' },
              onChange(e) {
                row.refKey = e.target.value;
                if (e.target.value) { const a = assemblies.find(x => x.id === e.target.value); if (a) row.psf = assemblyDLpsf(a); }
                renderAll();
              } });
            asmSel.appendChild(el('option', { value: '' }, '— Manual —'));
            assemblies.forEach(a => {
              const opt = el('option', { value: a.id }, a.name + ' (' + assemblyDLpsf(a) + ')');
              if (row.refKey === a.id) opt.selected = true;
              asmSel.appendChild(opt);
            });
            r.appendChild(asmSel);
          }
          r.appendChild(el('input', { className: 'form-input mono', type: 'number', placeholder: 'psf', value: numOrBlank(row.psf),
            onChange(e) { row.psf = e.target.value; row.refKey = ''; renderAll(); } }));
          r.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '2px' } },
            el('input', { className: 'form-input mono', style: { width: '50px' }, type: 'number', placeholder: 'ft', value: numOrBlank(row.tribHeight),
              onChange(e) { row.tribHeight = e.target.value; renderAll(); } }),
            el('span', { style: { fontSize: '0.7rem', color: 'var(--ink-tertiary)' } }, 'ft'),
          ));
          r.appendChild(el('span', { className: 'mono', style: { fontWeight: '600', textAlign: 'right' } }, wt.toFixed(1) + ' k'));
          r.appendChild(el('button', { className: 'btn btn-ghost btn-sm', type: 'button',
            onClick() { level.lineMasses.splice(ri, 1); renderAll(); } }, '×'));
          wrap.appendChild(r);
          wrap.appendChild(el('div', { style: { paddingLeft: '0.25rem', marginTop: '0.25rem' } },
            el('input', { className: 'form-input', style: { width: '100%', fontSize: '0.78rem', color: 'var(--ink-secondary)' }, type: 'text', placeholder: 'Comments (optional)', value: row.comments || '',
              onInput(e) { row.comments = e.target.value; } })));
          body.appendChild(wrap);
        });

        // --- Point Masses ---
        body.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
          el('div', { className: 'form-label', style: { margin: 0 } }, 'Point Masses'),
          el('button', { className: 'btn btn-sm', type: 'button',
            onClick() { level.pointMasses.push(newPointMass()); renderAll(); } }, '+ Point Mass'),
        ));
        const ptCols = '1fr 80px 24px';
        if (level.pointMasses.length > 0) {
          body.appendChild(el('div', { style: { display: 'grid', gridTemplateColumns: ptCols, gap: '0.4rem', marginBottom: '0.3rem', fontSize: '0.7rem', color: 'var(--ink-tertiary)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' } },
            el('span', null, 'Element'),
            el('span', { style: { textAlign: 'right' } }, 'Wt (kip)'),
            el('span'),
          ));
        }
        level.pointMasses.forEach((row, ri) => {
          const wrap = el('div', { style: { marginBottom: '0.4rem', paddingBottom: '0.4rem', borderBottom: '1px dotted var(--border-light)' } });
          const r = el('div', { style: { display: 'grid', gridTemplateColumns: ptCols, gap: '0.4rem', alignItems: 'center' } });
          r.appendChild(el('input', { className: 'form-input', type: 'text', placeholder: 'Element', value: row.element || '',
            onInput(e) { row.element = e.target.value; } }));
          r.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '2px', justifyContent: 'flex-end' } },
            el('input', { className: 'form-input mono', style: { width: '60px', textAlign: 'right' }, type: 'number', placeholder: 'kip', value: numOrBlank(row.weight),
              onChange(e) { row.weight = e.target.value; renderAll(); } }),
            el('span', { style: { fontSize: '0.7rem', color: 'var(--ink-tertiary)' } }, 'k'),
          ));
          r.appendChild(el('button', { className: 'btn btn-ghost btn-sm', type: 'button',
            onClick() { level.pointMasses.splice(ri, 1); renderAll(); } }, '×'));
          wrap.appendChild(r);
          wrap.appendChild(el('div', { style: { paddingLeft: '0.25rem', marginTop: '0.25rem' } },
            el('input', { className: 'form-input', style: { width: '100%', fontSize: '0.78rem', color: 'var(--ink-secondary)' }, type: 'text', placeholder: 'Comments (optional)', value: row.comments || '',
              onInput(e) { row.comments = e.target.value; } })));
          body.appendChild(wrap);
        });

        // Level totals
        body.appendChild(el('div', { style: { display: 'flex', gap: '1rem', justifyContent: 'flex-end', padding: '0.5rem 0', borderTop: '2px solid var(--border)', marginTop: '0.5rem', fontWeight: '600', fontSize: '0.85rem', flexWrap: 'wrap' } },
          el('span', null, 'Area: ', el('span', { className: 'mono' }, t.area.toFixed(1) + ' k')),
          el('span', null, 'Line: ', el('span', { className: 'mono' }, t.line.toFixed(1) + ' k')),
          el('span', null, 'Point: ', el('span', { className: 'mono' }, t.point.toFixed(1) + ' k')),
          el('span', { style: { color: 'var(--accent)' } }, 'Total: ', el('span', { className: 'mono' }, t.total.toFixed(1) + ' kip')),
        ));

        panel.appendChild(body);
        formBody.appendChild(panel);
      });

      // Add level
      formBody.appendChild(el('button', { className: 'btn', type: 'button', style: { marginBottom: '1rem' },
        onClick() { inputs.levels.push(newLevel()); renderAll(); } }, '+ Add Level'));

      // Grand total
      const grand = inputs.levels.reduce((s, l) => s + levelTotals(l).total, 0);
      formBody.appendChild(el('div', { style: { textAlign: 'right', fontWeight: '700', fontSize: '1.1rem', marginBottom: '0.5rem' } },
        'W = ', el('span', { className: 'mono' }, (Math.round(grand * 10) / 10).toFixed(1) + ' kips')));
      notifyChange();
    }

    renderAll();
    initialized = true;
    container.appendChild(formBody);
    container.appendChild(el('div', { style: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' } },
      el('button', { className: 'btn btn-primary', type: 'button', onClick() { onSave(inputs); } }, 'Calculate & Save')));
  },

  renderOutputs(container, outputs) {
    if (!outputs || !outputs.perLevel) return;
    clearEl(container);
    const tbl = el('table', { className: 'data-table' });
    tbl.appendChild(el('tr', null,
      el('th', null, 'Level'),
      el('th', { className: 'num' }, 'h', el('sub', null, 'x'), ' (ft)'),
      el('th', { className: 'num' }, 'h', el('sub', null, 'n'), ' (ft)'),
      el('th', { className: 'num' }, 'Area (kip)'), el('th', { className: 'num' }, 'Line (kip)'),
      el('th', { className: 'num' }, 'Point (kip)'), el('th', { className: 'num' }, 'Total (kip)')));
    outputs.perLevel.forEach(lv => {
      tbl.appendChild(el('tr', null,
        el('td', null, lv.label),
        el('td', { className: 'num mono' }, lv.hx.toFixed(1)),
        el('td', { className: 'num mono' }, (lv.floorHeight || 0).toFixed(1)),
        el('td', { className: 'num mono' }, lv.areaTotal.toFixed(1)), el('td', { className: 'num mono' }, lv.lineTotal.toFixed(1)),
        el('td', { className: 'num mono' }, lv.pointTotal.toFixed(1)), el('td', { className: 'num mono' }, lv.seismicWeight.toFixed(1))));
    });
    tbl.appendChild(el('tr', { style: { fontWeight: '600' } },
      el('td', null, 'Total W'), el('td'), el('td'), el('td'), el('td'), el('td'),
      el('td', { className: 'num mono' }, outputs.totalSeismicWeight.toFixed(1))));
    container.appendChild(el('div', { className: 'table-scroll' }, tbl));
  },

  pdfSections(inputs, outputs) {
    const sections = [];
    const perLevel = outputs && outputs.perLevel ? outputs.perLevel : [];

    // Summary table
    sections.push({
      title: 'Seismic Mass Summary' + (inputs.direction && inputs.direction !== 'both' ? ' (' + inputs.direction.toUpperCase() + '-Dir)' : ''),
      table: {
        headers: ['Level', 'hx (ft)', 'hn (ft)', 'Area (kip)', 'Line (kip)', 'Point (kip)', 'Total (kip)'],
        rows: [
          ...perLevel.map(lv => [lv.label, lv.hx.toFixed(1), (lv.floorHeight || 0).toFixed(1), lv.areaTotal.toFixed(1), lv.lineTotal.toFixed(1), lv.pointTotal.toFixed(1), lv.seismicWeight.toFixed(1)]),
          ['Total W', '', '', '', '', '', outputs ? outputs.totalSeismicWeight.toFixed(1) : ''],
        ],
      },
    });

    if (inputs.notes) sections.push({ title: 'Notes', text: inputs.notes });

    // Per-level detail
    (inputs.levels || []).forEach((level, idx) => {
      const lbl = level.name || 'Level ' + (idx + 1);

      if (level.areaMasses.length > 0) {
        sections.push({
          title: lbl + ' — Area Masses',
          pageBreakBefore: idx === 0 && perLevel.length > 0,
          table: {
            headers: ['Element', 'Area (sf)', 'Slope', 'Weight (psf)', 'Weight (kip)', 'Comments'],
            rows: level.areaMasses.map(r => {
              const sf = slopeFactor(r.slope);
              return [r.element || '', numOrBlank(r.area), r.slope ? r.slope + ':12 (×' + sf.toFixed(3) + ')' : '—', numOrBlank(r.psf), areaWeight(r).toFixed(1), r.comments || ''];
            }),
          },
        });
      }
      if (level.lineMasses.length > 0) {
        sections.push({
          title: lbl + ' — Line Masses',
          table: {
            headers: ['Element', 'Length (ft)', 'Weight (psf)', 'Trib Ht (ft)', 'Weight (kip)', 'Comments'],
            rows: level.lineMasses.map(r => [r.element || '', numOrBlank(r.length), numOrBlank(r.psf), numOrBlank(r.tribHeight), lineWeight(r).toFixed(1), r.comments || '']),
          },
        });
      }
      if (level.pointMasses.length > 0) {
        sections.push({
          title: lbl + ' — Point Masses',
          table: {
            headers: ['Element', 'Weight (kip)', 'Comments'],
            rows: level.pointMasses.map(r => [r.element || '', numOrBlank(r.weight), r.comments || '']),
          },
        });
      }
    });

    return sections;
  },
};
