import { el, clearEl, numOrBlank } from '../utils.js';
import {
  resetIds, resetWallNum, defaultInputs,
  newLevel, newWallDLType, newLine, newWallId, nextWallMark,
} from './shearWallTypes.js';
import { calcAll } from './shearWallCalc.js';
import { renderElevation } from './shearWallElevation.js';
import { NAILING_TABLE } from './shearWallNailing.js';
import { NDS_GRADES, HDUE_TABLE, MSTC_TABLE, POST_SIZES, computePostCapacity } from './shearWallHardware.js';

export const shearWallDesign = {
  id: 'shear_wall_design',
  label: 'Shear Wall Design',
  schemaVersion: 3,
  calcVersion: 'v2',
  noNewPrefix: true,
  noOutputSection: false,

  refs: [],
  fields: [],
  outputFields: [],

  migrate(item) {
    if (item.schemaVersion >= 3) return item;
    const inp = item.inputs || defaultInputs();
    if (!inp.wallThickness) inp.wallThickness = '4';
    if (!inp.woodGrade) inp.woodGrade = 'dfir_no1';
    (inp.levels || []).forEach(l => {
      if (!l.floorClearSpan) l.floorClearSpan = '16';
      if (!l.anchorageType) l.anchorageType = 'auto';
    });
    (inp.directions || []).forEach(d => (d.lines || []).forEach(ln => {
      if (ln.wallThickness === undefined) ln.wallThickness = '';
      (ln.walls || []).forEach(w => { delete w.capacity; });
    }));
    return { ...item, inputs: inp, schemaVersion: 3 };
  },

  summaryLabel(inputs) {
    let wallCount = 0;
    (inputs.directions || []).forEach(d => (d.lines || []).forEach(ln => { wallCount += (ln.walls || []).length; }));
    const lineCount = (inputs.directions || []).reduce((s, d) => s + (d.lines || []).length, 0);
    return 'Shear Walls — ' + wallCount + ' wall' + (wallCount !== 1 ? 's' : '') + ', ' + lineCount + ' line' + (lineCount !== 1 ? 's' : '');
  },

  calc(inputs) { return calcAll(inputs); },

  renderForm(container, existingInputs, onSave, projectItems, onInputChange) {
    const inputs = existingInputs && existingInputs.directions ? existingInputs : defaultInputs();
    if (!inputs.refs) inputs.refs = {};
    resetIds(inputs);
    resetWallNum(inputs);
    clearEl(container);

    let activeTopTab = 'summary';
    let activeDirLineTabs = {};
    let elevationHandle = null;

    function notifyChange() { if (onInputChange) onInputChange(); }

    function renderAll() {
      clearEl(container);
      if (elevationHandle) { elevationHandle.destroy(); elevationHandle = null; }

      const tabBar = el('div', { style: { display: 'flex', gap: '2px', marginBottom: '1rem', borderBottom: '2px solid var(--border)', paddingBottom: '0' } });

      const tabBtn = (key, label) => {
        const active = activeTopTab === key;
        return el('button', {
          className: 'btn btn-sm' + (active ? ' btn-primary' : ''), type: 'button',
          style: { borderRadius: '6px 6px 0 0', marginBottom: '-2px', borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent' },
          onClick() { activeTopTab = key; renderAll(); },
        }, label);
      };
      tabBar.appendChild(tabBtn('summary', 'Summary / Config'));
      for (const dir of inputs.directions) {
        tabBar.appendChild(tabBtn('dir-' + dir.id, dir.name || 'Direction'));
      }
      tabBar.appendChild(tabBtn('hardware', 'Hardware'));
      container.appendChild(tabBar);

      const body = el('div');
      if (activeTopTab === 'summary') {
        body.appendChild(renderSummaryTab());
      } else if (activeTopTab === 'hardware') {
        body.appendChild(renderHardwareTab());
      } else {
        const dir = inputs.directions.find(d => 'dir-' + d.id === activeTopTab);
        if (dir) body.appendChild(renderDirectionTab(dir));
      }
      container.appendChild(body);

      container.appendChild(el('div', { style: { marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-light)' } },
        el('div', { className: 'form-group' },
          el('label', { className: 'form-label' }, 'Notes'),
          el('textarea', { className: 'form-input', rows: 3, placeholder: 'Design notes, assumptions, etc.', value: inputs.notes || '', style: { resize: 'vertical' },
            onInput(e) { inputs.notes = e.target.value; notifyChange(); } })),
        el('div', { style: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' } },
          el('button', { className: 'btn btn-primary', type: 'button', onClick() { onSave(inputs); } }, 'Calculate & Save')),
      ));
    }

    function renderSummaryTab() {
      const sec = el('div');

      sec.appendChild(el('div', { className: 'section-header' }, 'Global Configuration'));
      const row1 = el('div', { style: { display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' } });
      const loadTypeBtns = el('div', { style: { display: 'flex', gap: '2px' } });
      ['seismic', 'wind', 'both'].forEach(lt => {
        loadTypeBtns.appendChild(el('button', {
          className: 'btn btn-sm' + (inputs.loadType === lt ? ' btn-primary' : ''), type: 'button',
          onClick() { inputs.loadType = lt; notifyChange(); renderAll(); },
        }, lt.charAt(0).toUpperCase() + lt.slice(1)));
      });
      row1.appendChild(el('div', { className: 'form-group', style: { marginBottom: 0 } },
        el('label', { className: 'form-label' }, 'Load Type'), loadTypeBtns));
      row1.appendChild(el('div', { className: 'form-group', style: { marginBottom: 0 } },
        el('label', { className: 'form-label' }, 'S', el('sub', null, 'DS')),
        el('input', { className: 'form-input mono', type: 'number', step: 'any', value: numOrBlank(inputs.sds), style: { width: '80px' },
          onChange(e) { inputs.sds = e.target.value; notifyChange(); } })));
      const thicknessBtn = (v, label) => el('button', {
        className: 'btn btn-sm' + (inputs.wallThickness === v ? ' btn-primary' : ''), type: 'button',
        onClick() { inputs.wallThickness = v; notifyChange(); renderAll(); },
      }, label);
      row1.appendChild(el('div', { className: 'form-group', style: { marginBottom: 0 } },
        el('label', { className: 'form-label' }, 'Default Wall'),
        el('div', { style: { display: 'flex', gap: '2px' } }, thicknessBtn('4', '2x4'), thicknessBtn('6', '2x6'))));
      const gradeSelect = el('select', { className: 'form-select', style: { width: '180px' },
        onChange(e) { inputs.woodGrade = e.target.value; notifyChange(); } });
      NDS_GRADES.forEach(g => {
        const opt = el('option', { value: g.id }, g.label);
        if (inputs.woodGrade === g.id) opt.selected = true;
        gradeSelect.appendChild(opt);
      });
      row1.appendChild(el('div', { className: 'form-group', style: { marginBottom: 0 } },
        el('label', { className: 'form-label' }, 'Wood Grade'), gradeSelect));
      sec.appendChild(row1);

      sec.appendChild(el('div', { style: { fontWeight: '500', fontSize: '0.85rem', marginBottom: '0.25rem' } }, 'Wall Dead Load Types'));
      const wdtTbl = el('table', { className: 'dynamic-table', style: { fontSize: '0.85rem', maxWidth: '360px' } });
      wdtTbl.appendChild(el('tr', null, el('th', null, 'Name'), el('th', null, 'PSF'), el('th', { className: 'row-actions' }, '')));
      (inputs.wallDLTypes || []).forEach((t, i) => {
        wdtTbl.appendChild(el('tr', null,
          el('td', null, el('input', { type: 'text', value: t.name || '', style: { width: '120px' }, onInput(e) { t.name = e.target.value; notifyChange(); } })),
          el('td', null, el('input', { type: 'number', step: 'any', value: numOrBlank(t.psf), style: { width: '70px' }, onChange(e) { t.psf = e.target.value; notifyChange(); } })),
          el('td', { className: 'row-actions' }, el('button', { className: 'btn btn-ghost btn-sm', type: 'button',
            onClick() { inputs.wallDLTypes.splice(i, 1); notifyChange(); renderAll(); } }, '×')),
        ));
      });
      sec.appendChild(wdtTbl);
      sec.appendChild(el('button', { className: 'btn btn-sm', type: 'button', style: { marginTop: '0.25rem', marginBottom: '1rem' },
        onClick() { inputs.wallDLTypes.push(newWallDLType('', '')); notifyChange(); renderAll(); } }, '+ Wall DL Type'));

      sec.appendChild(el('div', { className: 'section-header' }, 'Levels (top to bottom)'));
      const lvlTbl = el('table', { className: 'dynamic-table', style: { fontSize: '0.85rem' } });
      lvlTbl.appendChild(el('tr', null, el('th', null, ''), el('th', null, 'Level Name'), el('th', null, 'Ftf (ft)'), el('th', null, 'Elev (ft)'), el('th', null, 'Floor Span'), el('th', null, 'Anchorage'), el('th', { className: 'row-actions' }, '')));
      let elevAccum = 0;
      const elevations = [];
      for (let i = inputs.levels.length - 1; i >= 0; i--) { elevAccum += parseFloat(inputs.levels[i].floorToFloor) || 0; elevations[i] = elevAccum; }
      inputs.levels.forEach((lvl, i) => {
        const isBottom = i === inputs.levels.length - 1;
        if (!lvl.floorClearSpan) lvl.floorClearSpan = '16';
        if (!lvl.anchorageType) lvl.anchorageType = 'auto';
        const spanSel = el('select', { className: 'form-select', style: { width: '70px', fontSize: '0.8rem' },
          onChange(e) { lvl.floorClearSpan = e.target.value; notifyChange(); } });
        ['16', '18', '24'].forEach(v => {
          const opt = el('option', { value: v }, v + '"');
          if (lvl.floorClearSpan === v) opt.selected = true;
          spanSel.appendChild(opt);
        });
        const ancSel = el('select', { className: 'form-select', style: { width: '90px', fontSize: '0.8rem' },
          onChange(e) { lvl.anchorageType = e.target.value; notifyChange(); } });
        if (isBottom) {
          ancSel.appendChild(el('option', { value: 'holdown', selected: true }, 'Holdown'));
          ancSel.disabled = true;
        } else {
          [['auto', 'Strap'], ['holdown', 'Holdown']].forEach(([v, label]) => {
            const opt = el('option', { value: v }, label);
            if (lvl.anchorageType === v) opt.selected = true;
            ancSel.appendChild(opt);
          });
        }
        lvlTbl.appendChild(el('tr', null,
          el('td', null,
            el('button', { className: 'btn btn-ghost btn-sm', type: 'button', disabled: i === 0, onClick() { [inputs.levels[i - 1], inputs.levels[i]] = [inputs.levels[i], inputs.levels[i - 1]]; notifyChange(); renderAll(); } }, '▲'),
            el('button', { className: 'btn btn-ghost btn-sm', type: 'button', disabled: i === inputs.levels.length - 1, onClick() { [inputs.levels[i], inputs.levels[i + 1]] = [inputs.levels[i + 1], inputs.levels[i]]; notifyChange(); renderAll(); } }, '▼')),
          el('td', null, el('input', { type: 'text', value: lvl.name || '', placeholder: 'Level name', onInput(e) { lvl.name = e.target.value; notifyChange(); } })),
          el('td', null, el('input', { type: 'number', step: 'any', value: numOrBlank(lvl.floorToFloor), placeholder: '0', style: { width: '70px' }, onChange(e) { lvl.floorToFloor = e.target.value; notifyChange(); renderAll(); } })),
          el('td', { className: 'mono' }, elevations[i] != null ? elevations[i].toFixed(1) : '—'),
          el('td', null, spanSel),
          el('td', null, ancSel),
          el('td', { className: 'row-actions' }, el('button', { className: 'btn btn-ghost btn-sm', type: 'button', onClick() { inputs.levels.splice(i, 1); notifyChange(); renderAll(); } }, '×')),
        ));
      });
      sec.appendChild(lvlTbl);
      sec.appendChild(el('button', { className: 'btn btn-sm', type: 'button', style: { marginTop: '0.25rem', marginBottom: '1rem' },
        onClick() { inputs.levels.push(newLevel('')); notifyChange(); renderAll(); } }, '+ Level'));

      sec.appendChild(el('div', { className: 'section-header' }, 'Lateral Loading — All Lines (Unfactored, kips)'));
      sec.appendChild(renderMasterLoadingTable());

      return sec;
    }

    function renderMasterLoadingTable() {
      const showE = inputs.loadType === 'seismic' || inputs.loadType === 'both';
      const showW = inputs.loadType === 'wind' || inputs.loadType === 'both';
      const tbl = el('table', { className: 'dynamic-table', style: { fontSize: '0.85rem' } });
      const hdr = el('tr', null, el('th', null, 'Dir'), el('th', null, 'Line'), el('th', null, 'Level'));
      if (showE) hdr.appendChild(el('th', null, '1.0E (kip)'));
      if (showW) hdr.appendChild(el('th', null, '1.0W (kip)'));
      hdr.appendChild(el('th', { className: 'row-actions' }, ''));
      tbl.appendChild(hdr);

      for (const dir of inputs.directions) {
        for (const line of dir.lines) {
          if (!line.levelLoads) line.levelLoads = {};
          for (let li = 0; li < inputs.levels.length; li++) {
            const lvl = inputs.levels[li];
            if (!line.levelLoads[lvl.id]) line.levelLoads[lvl.id] = { seismic: '', wind: '' };
            const entry = line.levelLoads[lvl.id];
            const isFirstLvl = li === 0;
            const nameCell = isFirstLvl
              ? el('td', null, el('input', { type: 'text', value: line.name || '', placeholder: 'Line name', style: { width: '100px', fontWeight: '500' },
                  onInput(e) { line.name = e.target.value; notifyChange(); } }))
              : el('td');
            const row = el('tr', null,
              el('td', { style: { color: isFirstLvl ? 'var(--ink)' : 'var(--ink-tertiary)', fontWeight: isFirstLvl ? '500' : 'normal' } }, isFirstLvl ? (dir.name || '?') : ''),
              nameCell,
              el('td', null, lvl.name || '?'));
            if (showE) row.appendChild(el('td', null, el('input', { type: 'number', step: 'any', value: numOrBlank(entry.seismic), style: { width: '80px' }, onChange(e) { entry.seismic = e.target.value; notifyChange(); } })));
            if (showW) row.appendChild(el('td', null, el('input', { type: 'number', step: 'any', value: numOrBlank(entry.wind), style: { width: '80px' }, onChange(e) { entry.wind = e.target.value; notifyChange(); } })));
            row.appendChild(el('td', { className: 'row-actions' }));
            tbl.appendChild(row);
          }
        }
        if (dir.lines.length === 0) {
          const span = showE && showW ? 6 : 5;
          tbl.appendChild(el('tr', null, el('td', { colSpan: span, style: { color: 'var(--ink-tertiary)', fontStyle: 'italic' } }, dir.name + ': no lines yet')));
        }
      }

      const wrapper = el('div');
      wrapper.appendChild(el('div', { className: 'table-scroll' }, tbl));

      const addBtns = el('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '0.5rem' } });
      for (const dir of inputs.directions) {
        addBtns.appendChild(el('button', { className: 'btn btn-sm', type: 'button',
          onClick() { dir.lines.push(newLine('')); notifyChange(); renderAll(); } },
          '+ ' + (dir.name || 'Direction') + ' Line'));
      }
      wrapper.appendChild(addBtns);
      return wrapper;
    }

    function renderHardwareTab() {
      const sec = el('div');

      sec.appendChild(el('div', { className: 'section-header' }, 'Shearwall Nailing Capacity — SDPWS Table 4.3A'));
      sec.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '0.5rem' } }, '15/32 WSP Structural 1, 10d common nail, 0.92 factor'));
      const nTbl = el('table', { className: 'data-table', style: { fontSize: '0.85rem' } });
      nTbl.appendChild(el('tr', null, el('th', null, 'E.N.'), el('th', null, 'Sides'), el('th', { className: 'num' }, 'V_n (plf)'),
        el('th', { className: 'num' }, 'ASD E (plf)'), el('th', { className: 'num' }, 'ASD W (plf)'),
        el('th', { className: 'num' }, 'LRFD E (plf)'), el('th', { className: 'num' }, 'LRFD W (plf)')));
      for (const n of NAILING_TABLE) {
        nTbl.appendChild(el('tr', null, el('td', { className: 'mono' }, n.id), el('td', null, n.sides === 2 ? 'Both' : '1'),
          el('td', { className: 'num mono' }, n.vn), el('td', { className: 'num mono' }, n.asdE), el('td', { className: 'num mono' }, n.asdW),
          el('td', { className: 'num mono' }, n.lrfdE), el('td', { className: 'num mono' }, n.lrfdW)));
      }
      sec.appendChild(el('div', { className: 'table-scroll', style: { marginBottom: '1rem' } }, nTbl));

      sec.appendChild(el('div', { className: 'section-header' }, 'HDUE Holdown Catalog (Concrete Anchorage)'));
      const hTbl = el('table', { className: 'data-table', style: { fontSize: '0.85rem' } });
      hTbl.appendChild(el('tr', null, el('th', null, 'Model'), el('th', { className: 'num' }, 'ASD Cap (lb)'), el('th', null, 'Min Post (4")'), el('th', null, 'Min Post (6")'), el('th', { className: 'num' }, 'δ (in)')));
      for (const hd of HDUE_TABLE) {
        hTbl.appendChild(el('tr', null, el('td', { className: 'mono' }, hd.id), el('td', { className: 'num mono' }, hd.cap),
          el('td', { className: 'mono' }, hd.minPost['4']), el('td', { className: 'mono' }, hd.minPost['6']), el('td', { className: 'num mono' }, hd.delta)));
      }
      sec.appendChild(el('div', { className: 'table-scroll', style: { marginBottom: '1rem' } }, hTbl));

      sec.appendChild(el('div', { className: 'section-header' }, 'MSTC Strap Catalog (Floor-to-Floor)'));
      for (const [span, table] of Object.entries(MSTC_TABLE)) {
        sec.appendChild(el('div', { style: { fontWeight: '500', fontSize: '0.85rem', marginBottom: '0.25rem' } }, span + '" Clear Span'));
        const sTbl = el('table', { className: 'data-table', style: { fontSize: '0.85rem' } });
        sTbl.appendChild(el('tr', null, el('th', null, 'Model'), el('th', { className: 'num' }, 'ASD Cap (lb)'), el('th', { className: 'num' }, 'δ (in)')));
        for (const s of table) {
          sTbl.appendChild(el('tr', null, el('td', { className: 'mono' }, s.id), el('td', { className: 'num mono' }, s.cap), el('td', { className: 'num mono' }, s.delta)));
        }
        sec.appendChild(el('div', { className: 'table-scroll', style: { marginBottom: '0.75rem' } }, sTbl));
      }

      const thickness = inputs.wallThickness || '4';
      const gradeObj = NDS_GRADES.find(g => g.id === inputs.woodGrade) || NDS_GRADES[2];
      const posts = POST_SIZES[thickness] || POST_SIZES['4'];
      sec.appendChild(el('div', { className: 'section-header', style: { marginTop: '0.5rem' } }, 'Post Compression Capacity — ' + gradeObj.label + ', ' + thickness + '" Wall'));
      sec.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '0.5rem' } },
        'NDS 2018, CD=1.6, Ke=1.0, l2=6" (braced by sheathing). Heights from project levels.'));
      const heights = [...new Set(inputs.levels.map(l => parseFloat(l.floorToFloor) || 0).filter(h => h > 0))];
      if (heights.length === 0) heights.push(10);
      for (const h of heights) {
        sec.appendChild(el('div', { style: { fontWeight: '500', fontSize: '0.85rem', marginBottom: '0.25rem' } }, 'Floor Height: ' + h + ' ft'));
        const pTbl = el('table', { className: 'data-table', style: { fontSize: '0.85rem' } });
        pTbl.appendChild(el('tr', null, el('th', null, 'Post'), el('th', { className: 'num' }, 'FC\' (psi)'), el('th', { className: 'num' }, 'Fc⊥\' (psi)'),
          el('th', { className: 'num' }, 'Governs'), el('th', { className: 'num' }, 'Capacity (k)')));
        for (const p of posts) {
          const r = computePostCapacity(p, gradeObj, h);
          pTbl.appendChild(el('tr', null, el('td', { className: 'mono' }, p.label),
            el('td', { className: 'num mono' }, r.FcPrime), el('td', { className: 'num mono' }, r.FcPerpPrime),
            el('td', null, r.governedBy === 'axial' ? 'Axial' : 'Bearing'), el('td', { className: 'num mono' }, r.capacityKips)));
        }
        sec.appendChild(el('div', { className: 'table-scroll', style: { marginBottom: '0.75rem' } }, pTbl));
      }

      return sec;
    }

    function renderDirectionTab(dir) {
      const sec = el('div');
      const hdr = el('div', { style: { display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' } });
      hdr.appendChild(el('strong', null, 'Direction:'));
      hdr.appendChild(el('input', { className: 'form-input', type: 'text', value: dir.name || '', style: { width: '80px', fontWeight: '600' },
        onInput(e) { dir.name = e.target.value; notifyChange(); renderAll(); } }));
      hdr.appendChild(el('label', { className: 'form-label', style: { marginBottom: 0, marginLeft: '0.5rem' } }, 'ρ ='));
      hdr.appendChild(el('input', { className: 'form-input mono', type: 'number', step: 'any', value: numOrBlank(dir.rho), style: { width: '60px' },
        onChange(e) { dir.rho = e.target.value; notifyChange(); } }));
      sec.appendChild(hdr);

      if (dir.lines.length === 0) {
        sec.appendChild(el('div', { className: 'empty-state', style: { padding: '2rem', textAlign: 'center' } }, 'No gridlines yet. Add one from the Summary tab or below.'));
        sec.appendChild(el('button', { className: 'btn btn-sm', type: 'button', onClick() { dir.lines.push(newLine('')); notifyChange(); renderAll(); } }, '+ Add Line'));
        return sec;
      }

      const lineTabKey = 'dir-' + dir.id;
      if (!activeDirLineTabs[lineTabKey] || !dir.lines.find(l => l.id === activeDirLineTabs[lineTabKey])) {
        activeDirLineTabs[lineTabKey] = dir.lines[0].id;
      }

      const lineBar = el('div', { style: { display: 'flex', gap: '2px', marginBottom: '0.75rem', flexWrap: 'wrap' } });
      for (const line of dir.lines) {
        const isActive = activeDirLineTabs[lineTabKey] === line.id;
        lineBar.appendChild(el('button', {
          className: 'btn btn-sm' + (isActive ? ' btn-primary' : ''), type: 'button',
          onClick() { activeDirLineTabs[lineTabKey] = line.id; renderAll(); },
        }, line.name || line.id));
      }
      lineBar.appendChild(el('button', { className: 'btn btn-sm btn-ghost', type: 'button',
        onClick() { dir.lines.push(newLine('')); const nw = dir.lines[dir.lines.length - 1]; activeDirLineTabs[lineTabKey] = nw.id; notifyChange(); renderAll(); } }, '+'));
      sec.appendChild(lineBar);

      const activeLine = dir.lines.find(l => l.id === activeDirLineTabs[lineTabKey]);
      if (activeLine) sec.appendChild(renderLineContent(activeLine, dir));

      return sec;
    }

    function previewTC(line, dir) {
      if (!elevationHandle) return;
      const outputs = calcAll(inputs);
      const dirOut = (outputs.perDirection || []).find(d => d.dirId === dir.id);
      if (!dirOut) return;
      const lineOut = (dirOut.perLine || []).find(l => l.lineId === line.id);
      if (!lineOut) return;
      elevationHandle.showResults(lineOut);
    }

    function renderLineContent(line, dir) {
      const panel = el('div', { style: { border: '1px solid var(--border-light)', borderRadius: '6px', padding: '0.75rem' } });

      const hdr = el('div', { style: { display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', flexWrap: 'wrap' } });
      hdr.appendChild(el('label', { className: 'form-label', style: { marginBottom: 0 } }, 'Line Name:'));
      hdr.appendChild(el('input', { className: 'form-input', type: 'text', value: line.name || '', placeholder: 'Line name', style: { width: '120px', fontWeight: '600' },
        onInput(e) { line.name = e.target.value; notifyChange(); } }));
      hdr.appendChild(el('label', { className: 'form-label', style: { marginBottom: 0 } }, 'Length (ft):'));
      hdr.appendChild(el('input', { className: 'form-input mono', type: 'number', step: 'any', value: numOrBlank(line.totalLength), style: { width: '80px' },
        onChange(e) { line.totalLength = e.target.value; notifyChange(); if (elevationHandle) elevationHandle.drawSVG(); } }));
      const ltSel = el('select', { className: 'form-select', style: { width: '80px', fontSize: '0.8rem' },
        onChange(e) { line.wallThickness = e.target.value; notifyChange(); } });
      ltSel.appendChild(el('option', { value: '' }, 'Default'));
      [['4', '2x4'], ['6', '2x6']].forEach(([v, label]) => {
        const opt = el('option', { value: v }, label);
        if (line.wallThickness === v) opt.selected = true;
        ltSel.appendChild(opt);
      });
      hdr.appendChild(el('label', { className: 'form-label', style: { marginBottom: 0 } }, 'Wall:'));
      hdr.appendChild(ltSel);
      hdr.appendChild(el('button', { className: 'btn btn-sm', type: 'button',
        onClick() { previewTC(line, dir); } }, 'Preview T/C'));

      const copyFromSel = el('select', { className: 'form-select', style: { width: '100px', fontSize: '0.8rem' } });
      copyFromSel.appendChild(el('option', { value: '' }, 'Copy from…'));
      inputs.levels.forEach(lvl => {
        const wallCount = (line.walls || []).filter(w => w.levelId === lvl.id).length;
        if (wallCount > 0) copyFromSel.appendChild(el('option', { value: lvl.id }, (lvl.name || '?') + ' (' + wallCount + ')'));
      });
      const copyToSel = el('select', { className: 'form-select', style: { width: '90px', fontSize: '0.8rem' } });
      copyToSel.appendChild(el('option', { value: '' }, '→ to…'));
      inputs.levels.forEach(lvl => { copyToSel.appendChild(el('option', { value: lvl.id }, lvl.name || '?')); });
      const copyBtn = el('button', { className: 'btn btn-sm', type: 'button', onClick() {
        const fromId = copyFromSel.value;
        const toId = copyToSel.value;
        if (!fromId || !toId || fromId === toId) return;
        const sourceWalls = (line.walls || []).filter(w => w.levelId === fromId);
        if (!sourceWalls.length) return;
        for (const sw of sourceWalls) {
          line.walls.push({
            id: newWallId(), mark: nextWallMark(), levelId: toId,
            position: sw.position, length: sw.length,
            wallDLTypeId: sw.wallDLTypeId || '', nailingPattern: sw.nailingPattern || '',
          });
        }
        notifyChange(); renderAll();
      } }, 'Copy');
      hdr.appendChild(copyFromSel);
      hdr.appendChild(copyToSel);
      hdr.appendChild(copyBtn);

      hdr.appendChild(el('button', { className: 'btn btn-sm btn-danger', type: 'button', style: { marginLeft: 'auto' },
        onClick() { const idx = dir.lines.indexOf(line); if (idx >= 0) dir.lines.splice(idx, 1); notifyChange(); renderAll(); } }, 'Remove Line'));
      panel.appendChild(hdr);

      const elevContainer = el('div');
      panel.appendChild(elevContainer);
      if (elevationHandle) { elevationHandle.destroy(); elevationHandle = null; }
      elevationHandle = renderElevation(elevContainer, line, inputs.levels, inputs.wallDLTypes, {
        onWallChange() {}, onGravityChange() {}, onInputChange: notifyChange,
      });

      return panel;
    }

    renderAll();
  },

  renderOutputs(container, outputs) {
    if (!outputs || !outputs.perDirection) return;
    clearEl(container);

    let totalWalls = 0, failing = 0, warned = 0;
    outputs.perDirection.forEach(d => d.perLine.forEach(ln => ln.perLevel.forEach(pl => {
      totalWalls += pl.walls.length;
      for (const w of pl.walls) {
        if (w.dcRatio > 1.0 || w.hbReductionFactor < 1.0) failing++;
        else if (w.hOverBFlag) warned++;
      }
    })));
    const summaryParts = [totalWalls + ' wall' + (totalWalls !== 1 ? 's' : '') + ' analyzed'];
    if (failing > 0) summaryParts.push(failing + ' failing');
    if (warned > 0) summaryParts.push(warned + ' h/b warning');
    if (!failing && !warned) summaryParts.push('all passing');
    const summaryText = summaryParts.join(' — ');
    const summaryClass = failing > 0 ? 'badge-fail' : warned > 0 ? 'badge-stale' : 'badge-pass';
    container.appendChild(el('div', { style: { marginBottom: '0.75rem' } }, el('span', { className: 'badge ' + summaryClass }, summaryText)));

    container.appendChild(renderMethodFootnotes());

    for (const dir of outputs.perDirection) {
      container.appendChild(el('div', { className: 'section-header' }, dir.dirName + ' (ρ = ' + dir.rho + ')'));
      for (const ln of dir.perLine) {
        container.appendChild(el('div', { style: { fontWeight: '500', marginBottom: '0.25rem' } }, ln.lineName));
        for (const pl of ln.perLevel) {
          if (!pl.walls.length) continue;
          const tbl = el('table', { className: 'data-table' });
          tbl.appendChild(el('tr', null,
            el('th', null, 'Mark'), el('th', null, 'Level'), el('th', null, 'Nailing'),
            el('th', { className: 'num' }, 'v (plf)'), el('th', { className: 'num' }, 'Cap (plf)'), el('th', { className: 'num' }, 'D/C'),
            el('th', { className: 'num' }, 'T (k)'), el('th', { className: 'num' }, 'C (k)'),
            el('th', null, 'HD/Strap L'), el('th', null, 'HD/Strap R'),
            el('th', null, 'Post L'), el('th', null, 'Post R'),
            el('th', null, 'Status'),
          ));
          for (const w of pl.walls) {
            const dcBadge = el('span', { className: 'badge ' + (w.dcRatio > 1.0 ? 'badge-fail' : 'badge-pass') }, w.dcRatio.toFixed(2));
            const govT = Math.max(w.governingTensionLeft, w.governingTensionRight);
            const govC = Math.max(w.governingComprLeft, w.governingComprRight);
            const nailLabel = w.nailing ? w.nailing.label : '?';
            const hdL = w.anchorageLeft ? w.anchorageLeft.id : el('span', { style: { color: 'var(--fail)' } }, 'OVER');
            const hdR = w.anchorageRight ? w.anchorageRight.id : el('span', { style: { color: 'var(--fail)' } }, 'OVER');
            const postL = w.postLeft ? w.postLeft.postLabel : el('span', { style: { color: 'var(--fail)' } }, 'OVER');
            const postR = w.postRight ? w.postRight.postLabel : el('span', { style: { color: 'var(--fail)' } }, 'OVER');
            const allPass = w.dcRatio <= 1.0 && w.anchorageLeft && w.anchorageRight && w.postLeft && w.postRight;
            tbl.appendChild(el('tr', null,
              el('td', { className: 'mono' }, w.mark), el('td', null, pl.levelName),
              el('td', { className: 'mono', style: { fontSize: '0.8rem' } }, nailLabel),
              el('td', { className: 'num mono' }, w.unitShear_ASD.toFixed(0)),
              el('td', { className: 'num mono' }, w.effectiveCapacity != null ? w.effectiveCapacity.toFixed(0) : '—'),
              el('td', { className: 'num' }, dcBadge),
              el('td', { className: 'num mono' }, govT.toFixed(2)), el('td', { className: 'num mono' }, govC.toFixed(2)),
              el('td', { className: 'mono', style: { fontSize: '0.8rem' } }, hdL), el('td', { className: 'mono', style: { fontSize: '0.8rem' } }, hdR),
              el('td', { className: 'mono', style: { fontSize: '0.8rem' } }, postL), el('td', { className: 'mono', style: { fontSize: '0.8rem' } }, postR),
              el('td', null,
                !allPass || w.hbReductionFactor < 1.0
                  ? el('span', { className: 'badge badge-fail' }, 'NG')
                  : w.hOverBFlag
                    ? el('span', { className: 'badge badge-stale' }, 'WARN')
                    : el('span', { className: 'badge badge-pass' }, 'OK')),
            ));
          }
          container.appendChild(el('div', { className: 'table-scroll', style: { marginBottom: '0.5rem' } }, tbl));

          for (const w of pl.walls) {
            container.appendChild(renderWallCalcDetail(w, pl, dir));
          }
        }

        if (ln.stackGroups && ln.stackGroups.length) {
          const markMap = {};
          ln.perLevel.forEach(pl => pl.walls.forEach(w => { markMap[w.wallId] = w.mark || w.wallId; }));
          container.appendChild(el('div', { style: { fontWeight: '500', fontSize: '0.85rem', marginTop: '0.5rem', marginBottom: '0.25rem' } }, 'Stacking Summary — ' + ln.lineName));
          const stbl = el('table', { className: 'data-table', style: { fontSize: '0.85rem' } });
          stbl.appendChild(el('tr', null, el('th', null, 'Stack'), el('th', null, 'Wall'), el('th', { className: 'num' }, 'Accum T (k)'), el('th', { className: 'num' }, 'Accum C (k)')));
          for (const sg of ln.stackGroups) {
            const stackLabel = sg.wallIds.map(id => markMap[id] || id).join(' → ');
            sg.wallIds.forEach((wid, idx) => {
              stbl.appendChild(el('tr', null,
                el('td', { className: 'mono', style: { color: idx === 0 ? 'var(--ink)' : 'var(--ink-tertiary)' } }, idx === 0 ? stackLabel : ''),
                el('td', { className: 'mono' }, markMap[wid] || wid),
                el('td', { className: 'num mono' }, sg.accumulatedTension[idx] != null ? sg.accumulatedTension[idx].toFixed(2) : '—'),
                el('td', { className: 'num mono' }, sg.accumulatedCompression[idx] != null ? sg.accumulatedCompression[idx].toFixed(2) : '—'),
              ));
            });
          }
          container.appendChild(el('div', { className: 'table-scroll', style: { marginBottom: '0.75rem' } }, stbl));
        }
      }
    }
  },

  pdfSections(inputs, outputs) {
    const sections = [];
    const gradeLabel = (NDS_GRADES.find(g => g.id === inputs.woodGrade) || {}).label || inputs.woodGrade;
    const configRows = [
      ['Load Type', inputs.loadType || '—'], ['SDS', inputs.sds || '—'],
      ['Default Wall', (inputs.wallThickness || '4') + '" framing'],
      ['Wood Grade', gradeLabel],
      ['Levels', (inputs.levels || []).length],
    ];
    (inputs.wallDLTypes || []).forEach(t => { configRows.push(['Wall DL: ' + (t.name || '?'), (t.psf || 0) + ' psf']); });
    sections.push({ title: 'Building Configuration', rows: configRows });

    if (inputs.levels && inputs.levels.length) {
      let elev = 0;
      const rows = [];
      for (let i = inputs.levels.length - 1; i >= 0; i--) { elev += parseFloat(inputs.levels[i].floorToFloor) || 0; rows.unshift([inputs.levels[i].name || '?', numOrBlank(inputs.levels[i].floorToFloor), elev.toFixed(1)]); }
      sections.push({ title: 'Level Data', table: { headers: ['Level', 'Floor-to-Floor (ft)', 'Elevation (ft)'], rows } });
    }
    for (const dir of (inputs.directions || [])) {
      const loadRows = [];
      for (const line of (dir.lines || [])) { for (const lvl of (inputs.levels || [])) { const e = (line.levelLoads || {})[lvl.id] || {}; loadRows.push([line.name || '?', lvl.name || '?', numOrBlank(e.seismic), numOrBlank(e.wind)]); } }
      if (loadRows.length) sections.push({ title: dir.name + ' — Lateral Loading (Unfactored)', table: { headers: ['Line', 'Level', '1.0E (kip)', '1.0W (kip)'], rows: loadRows } });
    }
    if (outputs && outputs.perDirection) {
      for (const dir of outputs.perDirection) {
        for (const ln of dir.perLine) {
          const wallRows = [];
          for (const pl of ln.perLevel) { for (const w of pl.walls) {
            const nail = w.nailing ? w.nailing.label : '?';
            const cap = w.effectiveCapacity != null ? w.effectiveCapacity.toFixed(0) : '—';
            const ancL = w.anchorageLeft ? w.anchorageLeft.id : 'OVER';
            const ancR = w.anchorageRight ? w.anchorageRight.id : 'OVER';
            const postL = w.postLeft ? w.postLeft.postLabel : 'OVER';
            const postR = w.postRight ? w.postRight.postLabel : 'OVER';
            wallRows.push([w.mark, pl.levelName, w.length.toFixed(1), nail, w.unitShear_ASD.toFixed(0), cap, w.dcRatio.toFixed(2), ancL, ancR, postL, postR]);
          } }
          if (wallRows.length) sections.push({ title: dir.dirName + ' / ' + ln.lineName + ' — Wall Schedule', pageBreakBefore: true, table: { headers: ['Mark', 'Level', 'Len', 'Nailing', 'v', 'Cap', 'D/C', 'HD/S L', 'HD/S R', 'Post L', 'Post R'], rows: wallRows, colWidths: [0.06, 0.08, 0.05, 0.1, 0.06, 0.06, 0.06, 0.1, 0.1, 0.08, 0.08] } });
          const tcRows = [];
          for (const pl of ln.perLevel) { for (const w of pl.walls) { tcRows.push([w.mark, pl.levelName, w.dlTotal.toFixed(2), w.governingTensionLeft.toFixed(2), w.governingTensionRight.toFixed(2), w.governingComprLeft.toFixed(2), w.governingComprRight.toFixed(2)]); } }
          if (tcRows.length) sections.push({ title: dir.dirName + ' / ' + ln.lineName + ' — T/C Results', table: { headers: ['Mark', 'Level', 'DL (k)', 'T Left (k)', 'T Right (k)', 'C Left (k)', 'C Right (k)'], rows: tcRows } });
          if (ln.stackGroups && ln.stackGroups.length) {
            const sRows = []; for (const sg of ln.stackGroups) { sg.wallIds.forEach((wid, idx) => { sRows.push([sg.wallIds.join(' → '), wid, sg.accumulatedTension[idx] != null ? sg.accumulatedTension[idx].toFixed(2) : '—', sg.accumulatedCompression[idx] != null ? sg.accumulatedCompression[idx].toFixed(2) : '—']); }); }
            sections.push({ title: dir.dirName + ' / ' + ln.lineName + ' — Stacking', table: { headers: ['Stack', 'Wall', 'Accum T (k)', 'Accum C (k)'], rows: sRows } });
          }
        }
      }
      const sdsVal = inputs.sds || 'SDS';
      sections.push({ title: 'Load Combinations (ASD)', equations: [
        { desc: 'Seismic Uplift (ASCE 7 Combo 8)', parts: [{ t: 'T = [0.7ρV·h - (0.6-0.14' }, { t: sdsVal, bold: true }, { t: ')DL·L/2] / L' }] },
        { desc: 'Seismic Compression (ASCE 7 Combo 5)', parts: [{ t: 'C = [0.7ρV·h + (1.0+0.14' }, { t: sdsVal, bold: true }, { t: ')DL·L/2] / L' }] },
        { desc: 'Wind Uplift (ASCE 7 Combo 7)', parts: [{ t: 'T = [0.6V' }, { t: 'w', sub: true }, { t: '·h - 0.6DL·L/2] / L' }] },
        { desc: 'Wind Compression (ASCE 7 Combo 4)', parts: [{ t: 'C = [0.6V' }, { t: 'w', sub: true }, { t: '·h + DL·L/2] / L' }] },
      ] });
    }
    return sections;
  },
};

function renderMethodFootnotes() {
  const notes = el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '1rem', lineHeight: '1.6' } });
  notes.appendChild(el('div', null,
    el('strong', null, 'Distribution: '), 'SDPWS 4.3.3.4.1 Simplified Method — load proportional to wall ASD capacity × length.'));
  notes.appendChild(el('div', null,
    el('strong', null, 'T/C: '), 'ASCE 7-22 ASD Combos 5 & 8 with E', el('sub', null, 'v'),
    ' = 0.2S', el('sub', null, 'DS'), '×D (0.7 applied to full E including E', el('sub', null, 'v'), ').'));
  notes.appendChild(el('div', null,
    el('strong', null, 'Stacking: '), 'Simple force addition — net T at lower level = local T + accumulated T from above.'));
  return notes;
}

function renderWallCalcDetail(w, pl, dir) {
  const summary = el('summary', { style: { cursor: 'pointer', fontSize: '0.82rem', fontWeight: '500', color: 'var(--ink-secondary)' } },
    'Calc detail — ' + w.mark + ' (' + pl.levelName + ', L=' + w.length.toFixed(1) + ' ft, h=' + (w.floorH || 0).toFixed(1) + ' ft)');
  const body = el('div', { style: { fontFamily: 'var(--font-mono, monospace)', fontSize: '0.78rem', lineHeight: '1.7', padding: '0.5rem 0', whiteSpace: 'pre-wrap', color: 'var(--ink-secondary)' } });

  const line = (label, expr) => body.appendChild(el('div', null, el('span', { style: { display: 'inline-block', minWidth: '140px', color: 'var(--ink-tertiary)' } }, label), expr));

  line('Story shear V_x:', pl.storyShear_1E.toFixed(2) + ' kips (1.0E, accumulated)');
  line('Nailing:', (w.nailing ? w.nailing.label : '?') + '  (E=' + (w.seismicCap || 0) + ', W=' + (w.windCap || 0) + ' plf)');
  line('Rel. stiffness:', w.relStiffness.toFixed(2) + '  (' + w.effectiveCapacity + '×' + w.length.toFixed(1) + ' / ' + w.totalCapLen.toFixed(0) + ')');
  line('Wall share 1.0E:', w.share_1E.toFixed(2) + ' kips  =  ' + pl.storyShear_1E.toFixed(2) + ' × ' + w.relStiffness.toFixed(2));
  line('v_seismic (ASD):', w.unitShear_seismic.toFixed(0) + ' plf  =  0.7×' + dir.rho + '×' + w.share_1E.toFixed(2) + '×1000 / ' + w.length.toFixed(1));
  if (w.unitShear_wind > 0) line('v_wind (ASD):', w.unitShear_wind.toFixed(0) + ' plf  =  0.6×' + w.share_1W.toFixed(2) + '×1000 / ' + w.length.toFixed(1));
  if (w.seismicDC != null) line('D/C seismic:', w.seismicDC.toFixed(2) + '  =  ' + w.unitShear_seismic.toFixed(0) + ' / ' + (w.effectiveSeismicCap || 0));
  if (w.windDC != null && w.windDC > 0) line('D/C wind:', w.windDC.toFixed(2) + '  =  ' + w.unitShear_wind.toFixed(0) + ' / ' + (w.effectiveWindCap || 0));
  line('D/C governing:', w.dcRatio.toFixed(2) + '  (' + (w.dcGoverning || '') + ')');

  body.appendChild(el('div', { style: { borderTop: '1px solid var(--border-light)', margin: '0.25rem 0' } }));
  line('DL_wall:', w.dlWallSelf.toFixed(2) + ' kips (wall self-weight)');
  line('DL_diagram:', w.dlFromDiagram.toFixed(2) + ' kips (floor/roof)');
  line('DL_total:', w.dlTotal.toFixed(2) + ' kips');

  if (w.steps) {
    line('DL_RTM:', w.steps.dlRTM.toFixed(2) + ' kip-ft  =  ' + w.dlTotal.toFixed(2) + ' × ' + w.length.toFixed(1) + '/2');
    if (w.steps.seismic) {
      body.appendChild(el('div', { style: { borderTop: '1px solid var(--border-light)', margin: '0.25rem 0' } }));
      line('OTM_ASD (seismic):', w.steps.seismic.otm.toFixed(2) + ' kip-ft  =  0.7×' + dir.rho + '×' + w.share_1E.toFixed(2) + '×' + (w.floorH || 0).toFixed(1));
      line('gf_uplift:', w.steps.seismic.gfUplift.toFixed(4) + '  =  0.6 - 0.14×S_DS');
      line('gf_comp:', w.steps.seismic.gfComp.toFixed(4) + '  =  1.0 + 0.14×S_DS');
      line('T (uplift):', w.governingTensionLeft.toFixed(2) + ' kips  =  max(0, (' + w.steps.seismic.otm.toFixed(2) + ' - ' + w.steps.seismic.gfUplift.toFixed(4) + '×' + w.steps.dlRTM.toFixed(2) + ') / ' + w.length.toFixed(1) + ')');
      line('C (compr):', w.governingComprRight.toFixed(2) + ' kips  =  (' + w.steps.seismic.otm.toFixed(2) + ' + ' + w.steps.seismic.gfComp.toFixed(4) + '×' + w.steps.dlRTM.toFixed(2) + ') / ' + w.length.toFixed(1));
    }
    if (w.steps.wind) {
      body.appendChild(el('div', { style: { borderTop: '1px solid var(--border-light)', margin: '0.25rem 0' } }));
      line('OTM_ASD (wind):', w.steps.wind.otm.toFixed(2) + ' kip-ft  =  0.6×' + w.share_1W.toFixed(2) + '×' + (w.floorH || 0).toFixed(1));
      const wCombo = w.combos && w.combos['0.6D+0.6W_pos'];
      if (wCombo) {
        line('T_wind (uplift):', (wCombo.tensionLeft || 0).toFixed(2) + ' kips  =  max(0, (' + w.steps.wind.otm.toFixed(2) + ' - 0.6×' + w.steps.dlRTM.toFixed(2) + ') / ' + w.length.toFixed(1) + ')');
        line('C_wind (compr):', (wCombo.comprRight || 0).toFixed(2) + ' kips  =  (' + w.steps.wind.otm.toFixed(2) + ' + 1.0×' + w.steps.dlRTM.toFixed(2) + ') / ' + w.length.toFixed(1));
      }
    }
  }

  if (w.anchorageLeft || w.anchorageRight || w.postLeft || w.postRight) {
    body.appendChild(el('div', { style: { borderTop: '1px solid var(--border-light)', margin: '0.25rem 0' } }));
    const ancL = w.anchorageLeft ? w.anchorageLeft.id + ' (' + w.anchorageLeft.cap + ' lb)' : 'OVER CAPACITY';
    const ancR = w.anchorageRight ? w.anchorageRight.id + ' (' + w.anchorageRight.cap + ' lb)' : 'OVER CAPACITY';
    line(w.anchorageType + ' Left:', ancL);
    line(w.anchorageType + ' Right:', ancR);
    const pL = w.postLeft ? w.postLeft.postLabel + ' (' + w.postLeft.capacityKips + 'k)' : 'OVER CAPACITY';
    const pR = w.postRight ? w.postRight.postLabel + ' (' + w.postRight.capacityKips + 'k)' : 'OVER CAPACITY';
    line('Post Left:', pL);
    line('Post Right:', pR);
  }

  const details = el('details', { style: { marginBottom: '0.5rem', borderLeft: '3px solid var(--border-light)', paddingLeft: '0.75rem' } }, summary, body);
  return details;
}
