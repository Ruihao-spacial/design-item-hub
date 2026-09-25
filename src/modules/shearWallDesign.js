import { el, clearEl, numOrBlank, sameNumber } from '../utils.js';
import {
  resetIds, resetWallNum, resetElementNums, defaultInputs,
  newLevel, newWallDLType, newLine, newWallId, nextWallMark,
  wallOpeningDefaults, deflectionDefaults, newOpeningId,
} from './shearWallTypes.js';
import { calcAll, CALC_VERSION, DISTRIBUTION_METHODS, lineDistribution } from './shearWallCalc.js';
import { renderElevation, renderElevationForPdf, pdfElevationAspect } from './shearWallElevation.js';
import { NAILING_TABLE, SHEATHING_TYPES, FOOTNOTE_10_NOTE, sheathingLabel } from './shearWallNailing.js';
import { NDS_GRADES, HDUE_TABLE, MSTC_TABLE, POST_SIZES, computePostCapacity, FTAO_STRAP_TABLE, strapNailing, lrfdCap, getGradeById } from './shearWallHardware.js';
import { DRIFT_ROWS, driftLimit } from './shearWallDeflection.js';

// Values copied from a linked Seismic Base Shear item
const BASE_SHEAR_FIELDS = [['sds', 'Sds'], ['cd', 'Cd'], ['ie', 'Ie'], ['riskCategory', 'Risk Category']];
const sameValue = (a, b) => (typeof b === 'number' ? sameNumber(a, b, 0.0005) : String(a || '') === String(b || ''));

export const shearWallDesign = {
  id: 'shear_wall_design',
  label: 'Shear Wall Design',
  schemaVersion: 6,
  calcVersion: CALC_VERSION,
  noNewPrefix: true,
  noOutputSection: false,

  refs: [
    { key: 'baseShearSource', label: 'Seismic Base Shear', sourceType: 'seismic_base_shear',
      extract: (outputs) => ({ sds: outputs.sds, cd: outputs.cd, ie: outputs.ie, riskCategory: outputs.riskCategory }) },
  ],
  fields: [],
  outputFields: [],

  // Definition (inputs) is the source of truth — results are always regenerated from it
  regenerateResults: true,
  wideLayout: true, // item form uses the wide page so the elevation has room

  migrate(item) { return migrateDefinition(item); },

  // Sds / Cd / Ie / Risk Category copied from the Base Shear item that no longer match it
  linkDiff(inputs, linked) {
    const bs = linked.baseShearSource;
    if (!bs) return [];
    return BASE_SHEAR_FIELDS.filter(([k]) => bs[k] != null && !sameValue(inputs[k], bs[k]))
      .map(([k, label]) => ({ refKey: 'baseShearSource', label, from: inputs[k], to: bs[k] }));
  },

  applyLinks(inputs, linked) {
    const bs = linked.baseShearSource;
    if (bs) for (const [k] of BASE_SHEAR_FIELDS) if (bs[k] != null) inputs[k] = String(bs[k]);
    return inputs;
  },

  summaryLabel(inputs) {
    let wallCount = 0, beamCount = 0, postCount = 0;
    (inputs.directions || []).forEach(d => (d.lines || []).forEach(ln => {
      wallCount += (ln.walls || []).length;
      beamCount += (ln.beams || []).length;
      postCount += (ln.supportPosts || []).length;
    }));
    const lineCount = (inputs.directions || []).reduce((s, d) => s + (d.lines || []).length, 0);
    let label = 'Shear Walls — ' + wallCount + ' wall' + (wallCount !== 1 ? 's' : '') + ', ' + lineCount + ' line' + (lineCount !== 1 ? 's' : '');
    if (beamCount) label += ', ' + beamCount + ' beam' + (beamCount !== 1 ? 's' : '');
    if (postCount) label += ', ' + postCount + ' post' + (postCount !== 1 ? 's' : '');
    return label;
  },

  calc(inputs) { return calcAll(inputs); },

  renderForm(container, existingInputs, onSave, projectItems, onInputChange) {
    const inputs = existingInputs && existingInputs.directions ? existingInputs : defaultInputs();
    if (!inputs.refs) inputs.refs = {};
    resetIds(inputs);
    resetWallNum(inputs);
    resetElementNums(inputs);
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
      const distSelect = el('select', { className: 'form-select', style: { width: '270px' },
        onChange(e) { inputs.distribution = e.target.value; notifyChange(); } });
      DISTRIBUTION_METHODS.forEach(m => {
        const opt = el('option', { value: m.id }, m.label);
        if ((inputs.distribution || 'capacity') === m.id) opt.selected = true;
        distSelect.appendChild(opt);
      });
      row1.appendChild(el('div', { className: 'form-group', style: { marginBottom: 0 } },
        el('label', { className: 'form-label' }, 'Wall Distribution (default)'), distSelect));
      sec.appendChild(row1);
      sec.appendChild(renderDeflectionSettings());

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

    // Sheathing (Ga), Base Shear link (Sds, Cd, Ie, Risk Category), drift limit row, service wind factor
    function renderDeflectionSettings() {
      const box = el('div', { style: { marginBottom: '1rem' } });
      box.appendChild(el('div', { className: 'section-header' }, 'Deflection & Drift'));
      const row = el('div', { style: { display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' } });
      const field = (label, input) => el('div', { className: 'form-group', style: { marginBottom: 0 } }, el('label', { className: 'form-label' }, ...[].concat(label)), input);
      const select = (key, options, width) => {
        const s = el('select', { className: 'form-select', style: { width }, onChange(e) { inputs[key] = e.target.value; notifyChange(); } });
        options.forEach(([v, label]) => { const o = el('option', { value: v }, label); if (String(inputs[key] || '') === v) o.selected = true; s.appendChild(o); });
        return s;
      };
      const numInput = (key, width, placeholder) => el('input', { className: 'form-input mono', type: 'number', step: 'any', value: numOrBlank(inputs[key]), placeholder: placeholder || '', style: { width },
        onChange(e) { inputs[key] = e.target.value; notifyChange(); } });

      row.appendChild(field('Sheathing (Ga)', select('sheathing', SHEATHING_TYPES.map(t => [t.id, t.label]), '110px')));

      const bsItems = (projectItems || []).filter(it => it.type === 'seismic_base_shear' && !it.archived);
      const linkSel = el('select', { className: 'form-select', style: { maxWidth: '260px' }, onChange(e) {
        if (e.target.value) {
          inputs.refs.baseShearSource = e.target.value;
          const linked = bsItems.find(it => it.id === e.target.value);
          if (linked && linked.outputs) for (const [k] of BASE_SHEAR_FIELDS) if (linked.outputs[k] != null) inputs[k] = String(linked.outputs[k]);
        } else {
          delete inputs.refs.baseShearSource;
        }
        notifyChange(); renderAll();
      } });
      linkSel.appendChild(el('option', { value: '' }, bsItems.length ? '— None —' : 'No Base Shear item in project'));
      bsItems.forEach(it => {
        const o = el('option', { value: it.id }, (it.custom_name || it.customName || it.label || 'Seismic Base Shear') + (it.outputs ? ' (Cd=' + it.outputs.cd + ')' : ''));
        if (inputs.refs.baseShearSource === it.id) o.selected = true;
        linkSel.appendChild(o);
      });
      row.appendChild(field('Link to Seismic Base Shear', linkSel));
      row.appendChild(field(['C', el('sub', null, 'd')], numInput('cd', '60px')));
      row.appendChild(field(['I', el('sub', null, 'e')], numInput('ie', '60px')));
      row.appendChild(field('Risk Cat.', select('riskCategory', [['', '—'], ['I', 'I'], ['II', 'II'], ['III', 'III'], ['IV', 'IV']], '70px')));
      row.appendChild(field('Drift limit (Table 12.12-1)', select('driftRow', DRIFT_ROWS.map(r => [r.id, r.label]), '260px')));
      if (inputs.loadType === 'wind' || inputs.loadType === 'both') {
        row.appendChild(field(['Service wind α', el('sub', null, 's')], numInput('alphaS', '70px', 'blank = skip')));
      }
      box.appendChild(row);
      const lim = driftLimit(inputs.driftRow, inputs.riskCategory);
      box.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginTop: '0.35rem' } },
        'Deflection per SDPWS 2021 Eq. 4.3-1 at 1.0E (ρ = 1), ' + sheathingLabel(inputs.sheathing) + ' Ga. δx = Cd·δxe/Ie; allowable Δa = '
        + (lim != null ? lim + '·h_sx' : '— (set Risk Category)') + '. Linked values show an update notice when the Base Shear item changes.'));
      return box;
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
      sec.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '0.5rem' } }, '15/32 WSP Structural 1, 10d common nail. ' + FOOTNOTE_10_NOTE + ' ASD: E = V_n/2.8, W = V_n/2.0. LRFD (SDPWS 2021 §4.1.4): φ = 0.5 seismic, 0.8 wind. Ga for deflection uses the ' + sheathingLabel(inputs.sheathing) + ' column (Summary tab).'));
      const nTbl = el('table', { className: 'data-table', style: { fontSize: '0.85rem' } });
      nTbl.appendChild(el('tr', null, el('th', null, 'E.N.'), el('th', null, 'Sides'), el('th', { className: 'num' }, 'V_n (plf)'),
        el('th', { className: 'num' }, 'ASD E (plf)'), el('th', { className: 'num' }, 'ASD W (plf)'),
        el('th', { className: 'num' }, 'LRFD E (plf)'), el('th', { className: 'num' }, 'LRFD W (plf)'),
        el('th', { className: 'num' }, 'Ga OSB (k/in)'), el('th', { className: 'num' }, 'Ga PLY (k/in)')));
      for (const n of NAILING_TABLE) {
        nTbl.appendChild(el('tr', null, el('td', { className: 'mono' }, n.id), el('td', null, n.sides === 2 ? 'Both' : '1'),
          el('td', { className: 'num mono' }, n.vn), el('td', { className: 'num mono' }, n.asdE), el('td', { className: 'num mono' }, n.asdW),
          el('td', { className: 'num mono' }, n.lrfdE), el('td', { className: 'num mono' }, n.lrfdW),
          el('td', { className: 'num mono' }, n.gaOSB), el('td', { className: 'num mono' }, n.gaPLY)));
      }
      sec.appendChild(el('div', { className: 'table-scroll', style: { marginBottom: '1rem' } }, nTbl));

      sec.appendChild(el('div', { className: 'section-header' }, 'HDUE Holdown Catalog (Concrete Anchorage)'));
      const hTbl = el('table', { className: 'data-table', style: { fontSize: '0.85rem' } });
      hTbl.appendChild(el('tr', null, el('th', null, 'Model'), el('th', { className: 'num' }, 'ASD Cap (lb)'), el('th', { className: 'num' }, 'LRFD Cap (lb)'), el('th', null, 'Min Post (4")'), el('th', null, 'Min Post (6")'), el('th', { className: 'num' }, 'δ @ ASD cap (in)')));
      for (const hd of HDUE_TABLE) {
        hTbl.appendChild(el('tr', null, el('td', { className: 'mono' }, hd.id), el('td', { className: 'num mono' }, hd.cap), el('td', { className: 'num mono' }, lrfdCap(hd)),
          el('td', { className: 'mono' }, hd.minPost['4']), el('td', { className: 'mono' }, hd.minPost['6']), el('td', { className: 'num mono' }, hd.delta)));
      }
      sec.appendChild(el('div', { className: 'table-scroll', style: { marginBottom: '0.25rem' } }, hTbl));
      sec.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '1rem' } }, 'LRFD cap = 1.4 × ASD cap (reported with LRFD forces only). δ is at the ASD cap; deflection uses Δa = δ·T(1.0)/cap.'));

      sec.appendChild(el('div', { className: 'section-header' }, 'MSTC Strap Catalog (Floor-to-Floor)'));
      sec.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '0.5rem' } }, 'δ is at the strap LRFD cap = ASD cap / 0.7 (deflection only); Δa = δ·T(1.0)/(cap/0.7). No LRFD design check for straps.'));
      for (const [span, table] of Object.entries(MSTC_TABLE)) {
        sec.appendChild(el('div', { style: { fontWeight: '500', fontSize: '0.85rem', marginBottom: '0.25rem' } }, span + '" Clear Span'));
        const sTbl = el('table', { className: 'data-table', style: { fontSize: '0.85rem' } });
        sTbl.appendChild(el('tr', null, el('th', null, 'Model'), el('th', { className: 'num' }, 'ASD Cap (lb)'), el('th', { className: 'num' }, 'δ (in)')));
        for (const s of table) {
          sTbl.appendChild(el('tr', null, el('td', { className: 'mono' }, s.id), el('td', { className: 'num mono' }, s.cap), el('td', { className: 'num mono' }, s.delta)));
        }
        sec.appendChild(el('div', { className: 'table-scroll', style: { marginBottom: '0.75rem' } }, sTbl));
      }

      sec.appendChild(el('div', { className: 'section-header' }, 'FTAO Wall Straps (above / below openings)'));
      sec.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '0.5rem' } }, 'ASD allowable tension. Fasteners and end length shown for DF/SP framing, 0.148" nails (lightest strap ≥ F_max is selected; straps run the full wall length above and below the openings).'));
      const fsTbl = el('table', { className: 'data-table', style: { fontSize: '0.85rem' } });
      fsTbl.appendChild(el('tr', null, el('th', null, 'Model'), el('th', { className: 'num' }, 'Ga.'), el('th', { className: 'num' }, 'ASD Cap (lb)'), el('th', null, 'Fasteners (total)'), el('th', { className: 'num' }, 'End length (in)')));
      for (const st of FTAO_STRAP_TABLE) {
        const nl = strapNailing(st);
        fsTbl.appendChild(el('tr', null, el('td', { className: 'mono' }, st.id), el('td', { className: 'num mono' }, st.gauge), el('td', { className: 'num mono' }, st.cap),
          el('td', { className: 'mono' }, '(' + nl.count + ') ' + nl.d), el('td', { className: 'num mono' }, nl.endLength)));
      }
      sec.appendChild(el('div', { className: 'table-scroll', style: { marginBottom: '1rem' } }, fsTbl));

      const thickness = inputs.wallThickness || '4';
      const gradeObj = NDS_GRADES.find(g => g.id === inputs.woodGrade) || NDS_GRADES[2];
      const posts = POST_SIZES[thickness] || POST_SIZES['4'];
      sec.appendChild(el('div', { className: 'section-header', style: { marginTop: '0.5rem' } }, 'Post Compression Capacity — ' + gradeObj.label + ', ' + thickness + '" Wall'));
      sec.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '0.5rem' } },
        'NDS 2018, CD=1.6, Ke=1.0, l2=6" (braced by sheathing). Heights from project levels. Sill plate bearing / crushing uses ' + gradeObj.species + ' Fc⊥ = ' + gradeObj.Fcperp + ' psi.'));
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
      const distSel = el('select', { className: 'form-select', style: { width: '170px', fontSize: '0.8rem' },
        onChange(e) {
          line.distribution = e.target.value; notifyChange();
          if (elevationHandle && elevationHandle.hasResults) previewTC(line, dir);
        } });
      const projDefault = DISTRIBUTION_METHODS.find(m => m.id === lineDistribution(inputs, {})) || DISTRIBUTION_METHODS[0];
      [['', 'Default (' + (projDefault.id === 'deflection' ? 'Deflection' : 'Capacity') + ')'], ['capacity', 'Wall capacity'], ['deflection', 'Deflection (equal δ)']].forEach(([v, label]) => {
        const opt = el('option', { value: v }, label);
        if ((line.distribution || '') === v) opt.selected = true;
        distSel.appendChild(opt);
      });
      hdr.appendChild(el('label', { className: 'form-label', style: { marginBottom: 0 } }, 'Distribution:'));
      hdr.appendChild(distSel);
      const previewBtn = el('button', { className: 'btn btn-sm', type: 'button',
        onClick() {
          if (elevationHandle && elevationHandle.hasResults) {
            elevationHandle.clearResults();
            previewBtn.textContent = 'Preview T/C';
          } else {
            previewTC(line, dir);
            previewBtn.textContent = 'Clear Preview';
          }
        } }, 'Preview T/C');
      hdr.appendChild(previewBtn);

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
            ...wallOpeningDefaults(),
            method: sw.method || 'segmented', narrowPier: !!sw.narrowPier,
            openings: (sw.openings || []).map(o => ({ ...o, id: newOpeningId() })),
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
        onWallChange() {}, onGravityChange() {},
        designContext: () => ({ wallThickness: inputs.wallThickness, woodGrade: inputs.woodGrade, loadType: inputs.loadType }),
        onInputChange() {
          notifyChange();
          // Preview results go stale on every edit — recompute while the preview is shown
          if (elevationHandle && elevationHandle.hasResults) previewTC(line, dir);
        },
      });

      return panel;
    }

    renderAll();
  },

  renderOutputs(container, outputs) {
    if (!outputs || !outputs.perDirection) return;
    clearEl(container);
    // Saved results from an older calc version have a different shape — don't render them
    if (outputs.calcVersion !== CALC_VERSION) {
      container.appendChild(el('div', { style: { marginBottom: '0.75rem' } },
        el('span', { className: 'badge badge-stale' }, 'Results are from an older calc version — click Calculate & Save to refresh')));
      return;
    }

    let totalWalls = 0, failing = 0, warned = 0, auditIssues = 0;
    outputs.perDirection.forEach(d => d.perLine.forEach(ln => {
      ln.perLevel.forEach(pl => {
        totalWalls += pl.walls.length;
        for (const w of pl.walls) {
          if (wallFails(w)) failing++;
          else if (w.hOverBFlag) warned++;
        }
      });
      auditIssues += (ln.loadPathAudit?.warnings || []).length;
    }));
    const summaryParts = [totalWalls + ' wall' + (totalWalls !== 1 ? 's' : '') + ' analyzed'];
    if (failing > 0) summaryParts.push(failing + ' failing');
    if (warned > 0) summaryParts.push(warned + ' h/b warning');
    if (auditIssues > 0) summaryParts.push(auditIssues + ' load path issue' + (auditIssues !== 1 ? 's' : ''));
    if (!failing && !warned && !auditIssues) summaryParts.push('all passing');
    const summaryText = summaryParts.join(' — ');
    const summaryClass = (failing > 0 || auditIssues > 0) ? 'badge-fail' : warned > 0 ? 'badge-stale' : 'badge-pass';
    container.appendChild(el('div', { style: { marginBottom: '0.75rem' } }, el('span', { className: 'badge ' + summaryClass }, summaryText)));

    container.appendChild(renderMethodFootnotes());

    for (const dir of outputs.perDirection) {
      container.appendChild(el('div', { className: 'section-header' }, dir.dirName + ' (ρ = ' + dir.rho + ')'));
      for (const ln of dir.perLine) {
        container.appendChild(el('div', { style: { fontWeight: '500', marginBottom: '0.25rem' } }, ln.lineName,
          el('span', { style: { fontWeight: 'normal', fontSize: '0.8rem', color: 'var(--ink-secondary)', marginLeft: '0.5rem' } }, distributionText(ln))));
        if (ln.distribution && ln.distribution.note) container.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--stale, #b7791f)', marginBottom: '0.25rem' } }, 'ⓘ ' + ln.distribution.note));
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
            const fmtHW = (hw, dc) => hw ? hw.id + (dc != null ? ' (' + dc.toFixed(2) + ')' : '') : el('span', { style: { color: 'var(--fail)' } }, 'OVER');
            const fmtPost = (p, dc) => p ? p.postLabel + (dc != null ? ' (' + dc.toFixed(2) + ')' : '') : el('span', { style: { color: 'var(--fail)' } }, 'OVER');
            const hdL = fmtHW(w.anchorageLeft, w.anchorageDCLeft);
            const hdR = fmtHW(w.anchorageRight, w.anchorageDCRight);
            const postL = fmtPost(w.postLeft, w.postDCLeft);
            const postR = fmtPost(w.postRight, w.postDCRight);
            const allPass = w.dcRatio <= 1.0 && w.anchorageLeft && w.anchorageRight && w.postLeft && w.postRight;
            tbl.appendChild(el('tr', null,
              el('td', { className: 'mono' }, w.mark + (w.method === 'ftao' ? ' (FTAO)' : '')), el('td', null, pl.levelName),
              el('td', { className: 'mono', style: { fontSize: '0.8rem' } }, nailLabel),
              el('td', { className: 'num mono' }, w.unitShear_ASD.toFixed(0)),
              el('td', { className: 'num mono' }, w.effectiveCapacity != null ? w.effectiveCapacity.toFixed(0) : '—'),
              el('td', { className: 'num' }, dcBadge),
              el('td', { className: 'num mono' }, govT.toFixed(2)), el('td', { className: 'num mono' }, govC.toFixed(2)),
              el('td', { className: 'mono', style: { fontSize: '0.8rem' } }, hdL), el('td', { className: 'mono', style: { fontSize: '0.8rem' } }, hdR),
              el('td', { className: 'mono', style: { fontSize: '0.8rem' } }, postL), el('td', { className: 'mono', style: { fontSize: '0.8rem' } }, postR),
              el('td', null,
                !allPass || wallFails(w)
                  ? el('span', { className: 'badge badge-fail' }, 'NG')
                  : w.hOverBFlag
                    ? el('span', { className: 'badge badge-stale' }, 'WARN')
                    : el('span', { className: 'badge badge-pass' }, 'OK')),
            ));
          }
          container.appendChild(el('div', { className: 'table-scroll', style: { marginBottom: '0.5rem' } }, tbl));

          for (const w of pl.walls) {
            container.appendChild(w.method === 'ftao' && w.ftao ? renderFtaoDetail(w, pl) : renderWallCalcDetail(w, pl, dir, ln));
          }
        }

        // LRFD forces (reported for foundation / beam design; design above is ASD)
        const lr = lrfdRows(ln);
        if (lr.length) {
          container.appendChild(el('div', { style: { fontWeight: '500', fontSize: '0.85rem', marginTop: '0.5rem', marginBottom: '0.25rem' } }, 'LRFD Wall End Forces — ' + ln.lineName + ' (forces only)'));
          container.appendChild(simpleTable(LRFD_HEADERS, lr, [2, 3, 4, 5]));
        }

        // Deflection and story drift
        const dr = driftRows(ln);
        if (dr.length) {
          container.appendChild(el('div', { style: { fontWeight: '500', fontSize: '0.85rem', marginTop: '0.5rem', marginBottom: '0.25rem' } }, 'Story Drift — ' + ln.lineName));
          container.appendChild(simpleTable(DRIFT_HEADERS, dr, [1, 2, 4, 5, 6]));
          if (ln.drift && ln.drift.missing) container.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--stale, #b7791f)', marginBottom: '0.5rem' } }, 'ⓘ ' + ln.drift.missing));
          const wd = wallDeflectionRows(ln);
          if (wd.length) {
            container.appendChild(el('details', { style: { marginBottom: '0.75rem' } },
              el('summary', { style: { cursor: 'pointer', fontSize: '0.82rem', color: 'var(--ink-secondary)' } }, 'Wall deflections (SDPWS Eq. 4.3-1 terms)'),
              simpleTable(WALL_DEFL_HEADERS, wd, [2, 3, 4, 5, 6, 7, 8])));
          }
        }

        // Wall end connections (where each wall end's accumulated force goes)
        if (ln.wallDeliveries && ln.wallDeliveries.some(d => d.receiver.type !== 'foundation')) {
          container.appendChild(el('div', { style: { fontWeight: '500', fontSize: '0.85rem', marginTop: '0.5rem', marginBottom: '0.25rem' } }, 'Wall End Connections — ' + ln.lineName));
          container.appendChild(simpleTable(WALL_END_HEADERS, wallEndRows(ln), [3, 4]));
        }

        // Beam supports (reactions at user-defined supports)
        if (ln.beamTransfers && ln.beamTransfers.length) {
          container.appendChild(el('div', { style: { fontWeight: '500', fontSize: '0.85rem', marginTop: '0.5rem', marginBottom: '0.25rem' } }, 'Transfer Beams — ' + ln.lineName));
          container.appendChild(simpleTable(BEAM_HEADERS, beamSupportRows(ln), [2, 3, 5, 6]));
        }

        // Post schedule
        if (ln.postPaths && ln.postPaths.length) {
          container.appendChild(el('div', { style: { fontWeight: '500', fontSize: '0.85rem', marginTop: '0.5rem', marginBottom: '0.25rem' } }, 'Posts — ' + ln.lineName));
          container.appendChild(simpleTable(POST_HEADERS, postRows(ln), [2, 3, 4]));
        }

        // Load path audit
        if (ln.loadPathAudit && ln.loadPathAudit.warnings.length > 0) {
          container.appendChild(el('div', { style: { fontWeight: '500', fontSize: '0.85rem', marginTop: '0.5rem', marginBottom: '0.25rem' } },
            el('span', { className: 'badge badge-fail', style: { marginRight: '0.5rem' } }, ln.loadPathAudit.warnings.length + ' load path issue' + (ln.loadPathAudit.warnings.length !== 1 ? 's' : '')),
            ln.lineName));
          const atbl = el('table', { className: 'data-table', style: { fontSize: '0.85rem' } });
          atbl.appendChild(el('tr', null, el('th', null, 'Element'), el('th', null, 'Level'), el('th', null, 'Issue')));
          for (const w of ln.loadPathAudit.warnings) {
            atbl.appendChild(el('tr', null,
              el('td', { className: 'mono' }, w.elementMark), el('td', null, w.levelName),
              el('td', { style: { color: 'var(--fail)' } }, w.message),
            ));
          }
          container.appendChild(el('div', { className: 'table-scroll', style: { marginBottom: '0.75rem' } }, atbl));
        } else if (ln.loadPathAudit && ln.loadPathAudit.allClear && (ln.beamTransfers?.length || ln.postPaths?.length)) {
          container.appendChild(el('div', { style: { marginBottom: '0.5rem' } },
            el('span', { className: 'badge badge-pass' }, 'All load paths verified')));
        }
        if (ln.loadPathAudit && ln.loadPathAudit.notes && ln.loadPathAudit.notes.length) {
          const nbox = el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '0.75rem' } });
          ln.loadPathAudit.notes.forEach(n => nbox.appendChild(el('div', null, 'ⓘ ' + n.message)));
          container.appendChild(nbox);
        }
      }
    }
  },

  // Always built from the definition — stored results are only a snapshot
  pdfSections(inputs) {
    const sections = [];
    const outputs = calcAll(inputs);
    const gradeLabel = (NDS_GRADES.find(g => g.id === inputs.woodGrade) || {}).label || inputs.woodGrade;
    const configRows = [
      ['Load Type', inputs.loadType || '—'], ['SDS', inputs.sds || '—'],
      ['Default Wall', (inputs.wallThickness || '4') + '" framing'],
      ['Wood Grade', gradeLabel],
      ['Levels', (inputs.levels || []).length],
      ['Sheathing (Ga)', sheathingLabel(inputs.sheathing)],
      ['Sill plate', (getGradeById(inputs.woodGrade).species || '') + ', Fc⊥ = ' + getGradeById(inputs.woodGrade).Fcperp + ' psi'],
      ['Cd / Ie / Risk Category', (inputs.cd || '—') + ' / ' + (inputs.ie || '—') + ' / ' + (inputs.riskCategory || '—') + ((inputs.refs || {}).baseShearSource ? ' (linked to Seismic Base Shear)' : '')],
      ['Drift limit', ((DRIFT_ROWS.find(r => r.id === inputs.driftRow) || DRIFT_ROWS[0]).label) + (driftLimit(inputs.driftRow, inputs.riskCategory) != null ? ' — ' + driftLimit(inputs.driftRow, inputs.riskCategory) + '·h_sx' : '')],
      ['Nailing capacities', FOOTNOTE_10_NOTE],
      ['Wall distribution (default)', (DISTRIBUTION_METHODS.find(m => m.id === lineDistribution(inputs, {})) || {}).label],
    ];
    if (inputs.loadType !== 'seismic') configRows.push(['Service wind α_s', inputs.alphaS || '— (wind deflection not computed)']);
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
          const inLine = (inputs.directions || []).flatMap(d => d.lines || []).find(l => l.id === ln.lineId) || {};
          let anyManual = false;
          const star = (v, on) => { if (on) anyManual = true; return on ? v + ' *' : v; };
          for (const pl of ln.perLevel) { for (const w of pl.walls) {
            const wIn = (inLine.walls || []).find(x => x.id === (w.parentWallId || w.wallId)) || {};
            const nail = w.nailing ? w.nailing.label : '?';
            const cap = w.effectiveCapacity != null ? w.effectiveCapacity.toFixed(0) : '—';
            const ancL = w.anchorageLeft ? w.anchorageLeft.id + (w.anchorageDCLeft != null ? ' (' + w.anchorageDCLeft.toFixed(2) + ')' : '') : 'OVER';
            const ancR = w.anchorageRight ? w.anchorageRight.id + (w.anchorageDCRight != null ? ' (' + w.anchorageDCRight.toFixed(2) + ')' : '') : 'OVER';
            const postL = w.postLeft ? w.postLeft.postLabel + (w.postDCLeft != null ? ' (' + w.postDCLeft.toFixed(2) + ')' : '') : 'OVER';
            const postR = w.postRight ? w.postRight.postLabel + (w.postDCRight != null ? ' (' + w.postDCRight.toFixed(2) + ')' : '') : 'OVER';
            wallRows.push([w.mark + (w.method === 'ftao' ? ' (FTAO)' : ''), pl.levelName, w.length.toFixed(1), star(nail, !!wIn.nailingPattern), w.unitShear_ASD.toFixed(0), cap, w.dcRatio.toFixed(2),
              star(ancL, !!wIn.anchorageLeftOverride), star(ancR, !!wIn.anchorageRightOverride), star(postL, !!wIn.postLeftOverride), star(postR, !!wIn.postRightOverride)]);
          } }
          if (wallRows.length) sections.push({ title: dir.dirName + ' / ' + ln.lineName + ' — Wall Schedule, ' + distributionText(ln) + (anyManual ? ' (* = manual override)' : ''), pageBreakBefore: true, table: { headers: ['Mark', 'Level', 'Len', 'Nailing', 'v', 'Cap', 'D/C', 'HD/S L', 'HD/S R', 'Post L', 'Post R'], rows: wallRows, colWidths: [0.06, 0.08, 0.05, 0.1, 0.06, 0.06, 0.06, 0.1, 0.1, 0.08, 0.08] } });
          const tcRows = [];
          for (const pl of ln.perLevel) { for (const w of pl.walls) { tcRows.push([w.mark, pl.levelName, w.dlTotal.toFixed(2), w.governingTensionLeft.toFixed(2), w.governingTensionRight.toFixed(2), w.governingComprLeft.toFixed(2), w.governingComprRight.toFixed(2)]); } }
          if (tcRows.length) sections.push({ title: dir.dirName + ' / ' + ln.lineName + ' — T/C Results (ASD)', table: { headers: ['Mark', 'Level', 'DL (k)', 'T Left (k)', 'T Right (k)', 'C Left (k)', 'C Right (k)'], rows: tcRows } });
          for (const pl of ln.perLevel) { for (const w of pl.walls) {
            if (w.method !== 'ftao' || !w.ftao) continue;
            const t = dir.dirName + ' / ' + ln.lineName + ' — FTAO ' + w.mark + ' (' + pl.levelName + ')';
            sections.push({ title: t, rows: ftaoSummaryLines(w).concat(w.ftao.warnings.map(m => ['Warning', m])) });
            for (const lt of Object.keys(w.ftao.perType)) {
              sections.push({ title: t + ' — ' + LT_LABEL[lt] + ' piers', table: { headers: FTAO_PIER_HEADERS, rows: ftaoPierRows(w, lt) } });
              sections.push({ title: t + ' — ' + LT_LABEL[lt] + ' checks', table: { headers: FTAO_CHECK_HEADERS, rows: ftaoCheckRows(w, lt), colWidths: [0.4, 0.15, 0.15, 0.1, 0.1] } });
            }
            if ((w.ftao.jambs || []).length) sections.push({ title: t + ' — Jamb posts (C = f_D·DL + v_i·h_o)', table: { headers: FTAO_JAMB_HEADERS, rows: ftaoJambRows(w) } });
          } }
          const lrRows = lrfdRows(ln);
          if (lrRows.length) sections.push({ title: dir.dirName + ' / ' + ln.lineName + ' — LRFD Forces (reported only)', table: { headers: LRFD_HEADERS, rows: lrRows } });
          const drRows = driftRows(ln);
          if (drRows.length) sections.push({ title: dir.dirName + ' / ' + ln.lineName + ' — Story Drift', table: { headers: DRIFT_HEADERS, rows: drRows, colWidths: [0.16, 0.08, 0.09, 0.1, 0.14, 0.1, 0.13, 0.1] } });
          if (ln.drift && ln.drift.missing) sections.push({ title: dir.dirName + ' / ' + ln.lineName + ' — Drift note', text: ln.drift.missing });
          const wdRows = wallDeflectionRows(ln);
          if (wdRows.length) sections.push({ title: dir.dirName + ' / ' + ln.lineName + ' — Wall Deflection (SDPWS Eq. 4.3-1)', table: { headers: WALL_DEFL_HEADERS, rows: wdRows, colWidths: [0.08, 0.26, 0.07, 0.07, 0.1, 0.1, 0.1, 0.1, 0.08] } });
          if (ln.wallDeliveries && ln.wallDeliveries.some(d => d.receiver.type !== 'foundation')) {
            sections.push({ title: dir.dirName + ' / ' + ln.lineName + ' — Wall End Connections', table: { headers: WALL_END_HEADERS, rows: wallEndRows(ln), colWidths: [0.1, 0.14, 0.08, 0.12, 0.12, 0.3] } });
          }

          if (ln.beamTransfers && ln.beamTransfers.length) {
            sections.push({ title: dir.dirName + ' / ' + ln.lineName + ' — Transfer Beams', table: { headers: BEAM_HEADERS, rows: beamSupportRows(ln), colWidths: [0.07, 0.08, 0.06, 0.08, 0.07, 0.08, 0.08, 0.14, 0.2] } });
          }
          if (ln.postPaths && ln.postPaths.length) {
            sections.push({ title: dir.dirName + ' / ' + ln.lineName + ' — Posts', table: { headers: POST_HEADERS, rows: postRows(ln), colWidths: [0.07, 0.09, 0.07, 0.08, 0.08, 0.16, 0.16, 0.2] } });
          }

          // Load path audit
          if (ln.loadPathAudit && (ln.loadPathAudit.warnings.length > 0 || (ln.loadPathAudit.notes || []).length > 0)) {
            const auditRows = ln.loadPathAudit.warnings.map(w => [w.elementMark, w.levelName, w.message])
              .concat((ln.loadPathAudit.notes || []).map(n => [n.elementMark, n.levelName, 'Note: ' + n.message]));
            sections.push({ title: dir.dirName + ' / ' + ln.lineName + ' — Load Path Audit', table: { headers: ['Element', 'Level', 'Issue'], rows: auditRows } });
          }

          // Elevation diagram
          const inputLine = (inputs.directions || []).flatMap(d => d.lines || []).find(l => l.id === ln.lineId);
          if (inputLine) {
            sections.push({
              title: dir.dirName + ' / ' + ln.lineName + ' — Elevation',
              elevation: {
                renderFn: (w) => renderElevationForPdf(inputLine, inputs.levels, inputs.wallDLTypes || [], ln, w),
                aspectRatio: pdfElevationAspect(inputLine, inputs.levels, 500, true),
              },
              pageBreakBefore: true,
            });
          }
        }
      }
      const sdsVal = inputs.sds || 'SDS';
      sections.push({ title: 'Load Combinations (ASD design, LRFD reported)', equations: [
        { desc: 'Seismic Uplift (ASCE 7 Combo 8)', parts: [{ t: 'T = [0.7ρV·h - (0.6-0.14' }, { t: sdsVal, bold: true }, { t: ')DL·L/2] / L' }] },
        { desc: 'Seismic Compression (ASCE 7 Combo 5)', parts: [{ t: 'C = [0.7ρV·h + (1.0+0.14' }, { t: sdsVal, bold: true }, { t: ')DL·L/2] / L' }] },
        { desc: 'Wind Uplift (ASCE 7 Combo 7)', parts: [{ t: 'T = [0.6V' }, { t: 'w', sub: true }, { t: '·h - 0.6DL·L/2] / L' }] },
        { desc: 'Wind Compression (ASCE 7 Combo 4)', parts: [{ t: 'C = [0.6V' }, { t: 'w', sub: true }, { t: '·h + DL·L/2] / L' }] },
        { desc: 'LRFD Seismic Uplift (ASCE 7 §2.3.6)', parts: [{ t: 'T = [ρV·h - (0.9-0.2' }, { t: sdsVal, bold: true }, { t: ')DL·L/2] / L' }] },
        { desc: 'LRFD Seismic Compression (ASCE 7 §2.3.6)', parts: [{ t: 'C = [ρV·h + (1.2+0.2' }, { t: sdsVal, bold: true }, { t: ')DL·L/2] / L' }] },
        { desc: 'LRFD Wind (ASCE 7 §2.3.1)', parts: [{ t: 'T = [V' }, { t: 'w', sub: true }, { t: '·h - 0.9DL·L/2] / L,  C = [V' }, { t: 'w', sub: true }, { t: '·h + 1.2DL·L/2] / L' }] },
      ] });
    }
    return sections;
  },
};

// "Distribution: …" label for a line's results
function distributionText(ln) {
  const d = ln.distribution;
  if (!d || d.method !== 'deflection') return 'distribution by wall capacity';
  const pct = (v) => (v * 100).toFixed(1) + '%';
  return d.converged
    ? 'distribution by deflection (wall δ within ' + pct(d.spread) + ' at every level, limit ' + pct(d.tolerance) + ', ' + d.passes + ' pass' + (d.passes !== 1 ? 'es' : '') + ')'
    : 'distribution by deflection — NOT within ' + pct(d.tolerance) + ' after ' + d.passes + ' passes; pass ' + d.usedPass + ' used (δ spread ' + pct(d.spread) + ')';
}

// A wall fails when sheathing D/C > 1, h/b > 3.5, or (FTAO) the strap or sill plate bearing fails
function wallFails(w) {
  if (w.dcRatio > 1.0 || w.hbNotPermitted) return true;
  if (w.method === 'ftao' && w.ftao) {
    if (w.ftao.strapDC == null || w.ftao.strapDC > 1.0) return true;
    if ((w.ftao.jambs || []).some(j => !j.post || j.dc > 1.0)) return true;
    if (Object.values(w.ftao.perType || {}).some(r => (r.plateBearing || []).some(b => b.status === 'NG'))) return true;
  }
  return false;
}

const f0 = (v) => (v == null || !isFinite(v) ? '—' : Math.round(v).toString());
const f2 = (v) => (v == null || !isFinite(v) ? '—' : v.toFixed(2));
const f3 = (v) => (v == null || !isFinite(v) ? '—' : v.toFixed(3));
const f4 = (v) => (v == null || !isFinite(v) ? '—' : v.toFixed(4));
const LT_LABEL = { E: 'Seismic', W: 'Wind' };

// FTAO wall rows for one load type: summary lines, pier table rows, zone check rows
function ftaoSummaryLines(w) {
  const f = w.ftao;
  const lines = [];
  const any = Object.values(f.perType)[0];
  if (any) {
    const g = any.geometry;
    lines.push(['Geometry', 'L_wall = ' + g.Lwall.toFixed(2) + ' ft, h = ' + g.h.toFixed(2) + ' ft; governing opening ' + g.governing
      + ' (h_a ' + g.ha.toFixed(2) + ' / h_o ' + g.ho.toFixed(2) + ' / h_b ' + g.hb.toFixed(2) + ' ft)']);
  }
  for (const [lt, r] of Object.entries(f.perType)) {
    lines.push([LT_LABEL[lt] + ' loads', 'V1.0 = ' + f0(r.V_1p0) + ' lb; V_ASD = ' + r.kASD.toFixed(3) + '·V = ' + f0(r.V_ASD) + ' lb']);
    lines.push([LT_LABEL[lt] + ' forces', 'H (gross T = C) = ' + f0(r.H) + ' lb; v_a = v_b = ' + f0(r.va) + ' plf; F_max = ' + f0(r.Fmax) + ' lb; anchorage ' + f0(r.anchorage_plf) + ' plf']);
    lines.push([LT_LABEL[lt] + ' governing', r.governing.zone + ', DCR ' + f2(r.governing.dcr) + ' (' + r.governing.status + ')']);
    if (r.deflection) lines.push([LT_LABEL[lt] + ' deflection', 'Δ = ' + f3(r.deflection.Delta_in) + ' in (average of ' + r.deflection.cases.length + ' pier cases at V = ' + f0(r.deflection.V_defl) + ' lb)']);
  }
  const st = f.strap;
  lines.push(['Strap', st ? st.id + (st.override ? ' *' : '') + ' — ' + st.cap + ' lb ASD, D/C ' + f2(f.strapDC) + ' at F_max ' + f.strapDemand + ' lb; ('
    + st.nailing.count + ') ' + st.nailing.d + ', ' + st.nailing.endLength + '" end length; continuous full wall length above and below openings' : 'OVER — no strap carries ' + f.strapDemand + ' lb']);
  return lines;
}

function ftaoPierRows(w, lt) {
  const r = w.ftao.perType[lt];
  if (!r) return [];
  const car = r.geometry.piers;
  return r.piers.map((p, i) => [
    'Pier ' + p.i, p.L.toFixed(2), car[i].aspect.toFixed(2), car[i].Car.toFixed(3), f0(p.v), f0(p.vc), f0(p.R),
  ]);
}
const FTAO_PIER_HEADERS = ['Pier', 'L (ft)', 'h_o/b', 'C_ar', 'v (plf)', 'v_c corner (plf)', 'R (lb)'];

function ftaoCheckRows(w, lt) {
  const r = w.ftao.perType[lt];
  if (!r) return [];
  const rows = r.sheathing.map(z => [z.zone, f0(z.demand) + ' plf', f0(z.capacity) + ' plf', f2(z.dcr), z.status]);
  (r.plateBearing || []).forEach(b => rows.push(['Sill plate bearing, ' + b.end + ' end', f0(b.fc_perp) + ' psi', f0(b.Fc_perp_prime) + ' psi', f2(b.dcr), b.status]));
  return rows;
}
const FTAO_CHECK_HEADERS = ['Zone', 'Demand', 'Capacity', 'DCR', 'Status'];

// Jamb posts at the opening edges: C = fD·DL + v_i·h_o (Diekmann pier chord), NDS post capacity
function ftaoJambRows(w) {
  return (w.ftao.jambs || []).map(j => [
    'Opening ' + j.opening + ' ' + j.side, f2(j.dl), f0(j.v) + ' × ' + f2(j.ho), f2(j.C),
    j.post ? j.post.label + (j.override ? ' *' : '') : 'OVER', j.post ? f2(j.post.capacityKips) : '—', f2(j.dc),
  ]);
}
const FTAO_JAMB_HEADERS = ['Jamb', 'DL (k)', 'v_i × h_o (plf × ft)', 'C (k)', 'Post', 'Cap (k)', 'D/C'];

function renderFtaoDetail(w, pl) {
  const body = el('div', { style: { fontSize: '0.8rem', padding: '0.5rem 0', color: 'var(--ink-secondary)' } });
  for (const [k, v] of ftaoSummaryLines(w)) {
    body.appendChild(el('div', { style: { fontFamily: 'var(--font-mono, monospace)', lineHeight: '1.6' } },
      el('span', { style: { display: 'inline-block', minWidth: '150px', color: 'var(--ink-tertiary)' } }, k + ':'), v));
  }
  for (const lt of Object.keys(w.ftao.perType)) {
    body.appendChild(el('div', { style: { fontWeight: '500', margin: '0.4rem 0 0.2rem' } }, LT_LABEL[lt] + ' — piers (APA T555 / Diekmann)'));
    body.appendChild(simpleTable(FTAO_PIER_HEADERS, ftaoPierRows(w, lt), [1, 2, 3, 4, 5, 6]));
    body.appendChild(simpleTable(FTAO_CHECK_HEADERS, ftaoCheckRows(w, lt), [1, 2, 3]));
  }
  if ((w.ftao.jambs || []).length) {
    body.appendChild(el('div', { style: { fontWeight: '500', margin: '0.4rem 0 0.2rem' } }, 'Jamb posts — C = f_D·DL + v_i·h_o (ASD)'));
    body.appendChild(simpleTable(FTAO_JAMB_HEADERS, ftaoJambRows(w), [1, 3, 5, 6]));
  }
  if (w.ftao.warnings.length) {
    const wb = el('div', { style: { color: 'var(--stale, #b7791f)' } });
    w.ftao.warnings.forEach(m => wb.appendChild(el('div', null, '⚠ ' + m)));
    body.appendChild(wb);
  }
  const summary = el('summary', { style: { cursor: 'pointer', fontSize: '0.82rem', fontWeight: '500', color: 'var(--ink-secondary)' } },
    'FTAO calc — ' + w.mark + ' (' + pl.levelName + ', L=' + w.length.toFixed(1) + ' ft, h=' + (w.floorH || 0).toFixed(1) + ' ft)');
  return el('details', { style: { marginBottom: '0.5rem', borderLeft: '3px solid var(--border-light)', paddingLeft: '0.75rem' } }, summary, body);
}

const LRFD_HEADERS = ['Element', 'Level', 'T L (k)', 'T R (k)', 'C L (k)', 'C R (k)', 'HDUE LRFD cap L / R (lb)'];

// LRFD envelopes (accumulated through the load path) for walls, post bases and beam supports
function lrfdRows(ln) {
  const rows = [];
  for (const pl of ln.perLevel) {
    for (const w of pl.walls) {
      if (!w.lrfd) continue;
      const caps = [w.lrfdCapLeft, w.lrfdCapRight].map(c => (c == null ? '—' : c)).join(' / ');
      rows.push([w.mark, pl.levelName, f2(w.lrfd.tL), f2(w.lrfd.tR), f2(w.lrfd.cL), f2(w.lrfd.cR), caps]);
    }
  }
  for (const pp of ln.postPaths || []) {
    if (pp.lrfd) rows.push([pp.mark + ' base', pp.levelName, f2(pp.lrfd.T), '', f2(pp.lrfd.C), '', lrfdCap(pp.anchorage) || '—']);
  }
  for (const bt of ln.beamTransfers || []) {
    (bt.supports || []).forEach((s, i) => {
      if (s.lrfd) rows.push([bt.mark + (i === 0 ? ' L' : ' R') + ' support', bt.levelName, f2(s.lrfd.T), '', f2(s.lrfd.C), '', lrfdCap(s.anchorage) || '—']);
    });
  }
  return rows;
}

const DRIFT_HEADERS = ['Level', 'h_sx (ft)', 'δxe (in)', 'Governing wall', 'δx = Cd·δxe/Ie (in)', 'δx / h_sx', 'Allowable Δa (in)', 'Status'];

function driftRows(ln) {
  const d = ln.drift;
  if (!d) return [];
  const rows = [];
  for (const r of d.rows) {
    if (r.seismic) {
      const s = r.seismic;
      rows.push([r.levelName + ' (seismic)', f2(r.hsx), f3(s.deltaXE), s.wallMark, f3(s.deltaX), f4(s.ratio), s.allowable != null ? f3(s.allowable) : '—',
        s.pass == null ? '—' : s.pass ? 'OK' : 'NG']);
    }
    if (r.wind) {
      rows.push([r.levelName + ' (wind, service)', f2(r.hsx), f3(r.wind.delta), r.wind.wallMark, '—', f4(r.wind.ratio), '—', 'Report only']);
    }
  }
  return rows;
}

const WALL_DEFL_HEADERS = ['Wall', 'Case', 'v (plf)', 'Ga (k/in)', '8vh³/EAb', 'vh/1000Ga', 'Δa (in)', 'hΔa/b', 'δ (in)'];

function wallDeflectionRows(ln) {
  const rows = [];
  for (const pl of ln.perLevel) {
    for (const w of pl.walls) {
      for (const [lt, d] of Object.entries(w.deflection || {})) {
        if (!d) continue;
        const note = (w.onBeam ? ' — on beam, support deflection not included' : '');
        if (d.dirs) {
          const g = d.dirs.reduce((a, b) => (b.delta > a.delta ? b : a));
          rows.push([w.mark, (lt === 'E' ? '1.0E ' : 'α_s·W ') + g.dir + note, f0(d.v), d.Ga, f4(g.t1), f4(g.t2), f4(g.dHD + g.dC), f4(g.t3), f3(d.delta)]);
        } else {
          rows.push([w.mark, (lt === 'E' ? '1.0E' : 'α_s·W') + ' FTAO pier average' + note, '—', '—', '—', '—', '—', '—', f3(d.delta)]);
        }
      }
    }
  }
  return rows;
}

const WALL_END_HEADERS = ['Wall', 'Level', 'End', 'ΣT (k)', 'ΣC (k)', 'Delivers to'];

// Ends landing on the foundation are omitted — the wall's own holdown covers them
function wallEndRows(ln) {
  const wallById = {}, levelById = {};
  ln.perLevel.forEach(pl => pl.walls.forEach(w => { wallById[w.wallId] = w; levelById[w.wallId] = pl.levelName; }));
  return ln.wallDeliveries.filter(d => d.receiver.type !== 'foundation').map(d => [
    (wallById[d.wallId] || {}).mark || d.wallId, levelById[d.wallId] || '', d.side === 'left' ? 'Left' : 'Right',
    d.env.T.toFixed(2), d.env.C.toFixed(2),
    d.receiver.type === 'wall_mid' || d.receiver.type === 'none' ? d.receiver.label + ' — needs a post' : d.receiver.label,
  ]);
}

const BEAM_HEADERS = ['Beam', 'Level', 'Span (ft)', 'Support (ft)', 'Type', 'R T (k)', 'R C (k)', 'HD/Strap', 'Goes to'];
const POST_HEADERS = ['Post', 'Story', 'Pos (ft)', 'ΣT (k)', 'ΣC (k)', 'Base HD/Strap', 'Post', 'Lands on'];

function fmtConnection(item) {
  const r = item.receiver;
  if (!r || !['beam', 'post', 'wall_end', 'foundation'].includes(r.type)) return '—';
  if (!item.anchorage) return 'OVER';
  return item.anchorage.id + (item.anchorageDC != null ? ' (' + item.anchorageDC.toFixed(2) + ')' : '');
}

function fmtReceiver(r) {
  if (!r) return '—';
  if (r.type === 'reported') return 'Reaction only (design externally)';
  return r.label;
}

function beamSupportRows(ln) {
  return ln.beamTransfers.flatMap(bt => {
    if (!bt.supports.length) return [[bt.mark, bt.levelName, bt.length.toFixed(1), '—', '—', '—', '—', '—', 'Needs 2 valid supports']];
    return bt.supports.map((s, i) => [
      i === 0 ? bt.mark : '', i === 0 ? bt.levelName : '', i === 0 ? bt.length.toFixed(1) : '',
      s.position.toFixed(2), s.type === 'post' ? 'Post' : 'Point',
      s.envelopeT.toFixed(2), s.envelopeC.toFixed(2), fmtConnection(s), fmtReceiver(s.receiver),
    ]);
  });
}

function postRows(ln) {
  return ln.postPaths.map(pp => [
    pp.mark, pp.levelName, pp.position.toFixed(1), pp.envelopeT.toFixed(2), pp.envelopeC.toFixed(2),
    fmtConnection(pp), pp.post ? pp.post.postLabel + (pp.postDC != null ? ' (' + pp.postDC.toFixed(2) + ')' : '') : 'OVER',
    fmtReceiver(pp.receiver),
  ]);
}

function simpleTable(headers, rows, numCols) {
  const isNum = (i) => (numCols || []).includes(i);
  const tbl = el('table', { className: 'data-table', style: { fontSize: '0.85rem' } });
  tbl.appendChild(el('tr', null, ...headers.map((h, i) => el('th', isNum(i) ? { className: 'num' } : null, h))));
  rows.forEach(r => tbl.appendChild(el('tr', null, ...r.map((c, i) => el('td', { className: isNum(i) ? 'num mono' : 'mono', style: { color: c === 'OVER' ? 'var(--fail)' : null } }, c)))));
  return el('div', { className: 'table-scroll', style: { marginBottom: '0.75rem' } }, tbl);
}

function renderMethodFootnotes() {
  const notes = el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '1rem', lineHeight: '1.6' } });
  notes.appendChild(el('div', null,
    el('strong', null, 'Distribution: '), 'Wall capacity approach (SDPWS 4.3.3.4.1): load proportional to wall ASD capacity × length (FTAO walls: engine V_cap,ASD). Deflection approach: walls at a level deflect equally — shares ∝ k = V/δ (SDPWS Eq. 4.3-1 at 1.0E / 1.0W), iterated until the walls’ δ at every level are within 5% ((δmax − δmin)/δmax, max 20 passes; otherwise the closest pass is used and flagged). ' + FOOTNOTE_10_NOTE));
  notes.appendChild(el('div', null,
    el('strong', null, 'Aspect ratio: '), 'SDPWS 2021 — h/b > 2: capacity × (1.25 − 0.125h/b); h/b > 3.5 is not a shear wall (carries no shear).'));
  notes.appendChild(el('div', null,
    el('strong', null, 'Openings: '), 'Segmented walls are designed pier by pier (full-height piers, hardware at every pier end). FTAO walls use APA T555 (Diekmann) with the governing opening height; wall-end T/C still includes dead load, the FTAO H shown is gross (no dead load).'));
  notes.appendChild(el('div', null,
    el('strong', null, 'Deflection: '), 'SDPWS 2021 Eq. 4.3-1 at 1.0E (ρ = 1) with lateral-only end forces; Δa = δ × T/P_δ, P_δ = load at which δ was measured (HDUE: ASD cap; MSTC: LRFD cap = ASD cap / 0.7) + sill plate crushing. δx = Cd·δxe/Ie vs ASCE 7-22 Table 12.12-1.'));
  notes.appendChild(el('div', null,
    el('strong', null, 'LRFD: '), 'ASCE 7-22 §2.3.6 combinations are reported as forces only (e.g. for foundations); all design checks are ASD. HDUE LRFD cap = 1.4 × ASD.'));
  notes.appendChild(el('div', null,
    el('strong', null, 'T/C: '), 'ASCE 7-22 ASD Combos 5 & 8 with E', el('sub', null, 'v'),
    ' = 0.2S', el('sub', null, 'DS'), '×D (0.7 applied to full E including E', el('sub', null, 'v'), ').'));
  notes.appendChild(el('div', null,
    el('strong', null, 'Stacking: '), 'Simple force addition at aligned wall ends — net T at lower end = local T + accumulated T from above. A wall end landing mid-wall must sit on a post; its load goes down the post and does not change the T/C of the wall below.'));
  notes.appendChild(el('div', null,
    el('strong', null, 'Beams & posts: '), 'Wall end forces and post loads are applied per load combination as point loads; beam reactions by statics at the 2 user-defined supports. ΣT/ΣC and R values are ASD envelopes. Beam reactions exclude floor gravity load.'));
  return notes;
}

function renderWallCalcDetail(w, pl, dir, ln) {
  const summary = el('summary', { style: { cursor: 'pointer', fontSize: '0.82rem', fontWeight: '500', color: 'var(--ink-secondary)' } },
    'Calc detail — ' + w.mark + ' (' + pl.levelName + ', L=' + w.length.toFixed(1) + ' ft, h=' + (w.floorH || 0).toFixed(1) + ' ft)');
  const body = el('div', { style: { fontFamily: 'var(--font-mono, monospace)', fontSize: '0.78rem', lineHeight: '1.7', padding: '0.5rem 0', whiteSpace: 'pre-wrap', color: 'var(--ink-secondary)' } });

  const line = (label, expr) => body.appendChild(el('div', null, el('span', { style: { display: 'inline-block', minWidth: '140px', color: 'var(--ink-tertiary)' } }, label), expr));

  line('Story shear V_x:', pl.storyShear_1E.toFixed(2) + ' kips (1.0E, accumulated)');
  line('Nailing:', (w.nailing ? w.nailing.label : '?') + '  (E=' + (w.seismicCap || 0) + ', W=' + (w.windCap || 0) + ' plf)');
  if (ln && ln.distribution && ln.distribution.method === 'deflection') {
    line('Share (deflection):', w.relStiffness.toFixed(2) + '  (k = V/δ = ' + (w.stiffness && w.stiffness.E ? Math.round(w.stiffness.E) : '—') + ' lb/in; walls at this level deflect equally)');
  } else {
    line('Rel. stiffness:', w.relStiffness.toFixed(2) + '  (' + w.effectiveCapacity + '×' + w.length.toFixed(1) + ' / ' + w.totalCapLen.toFixed(0) + ')');
  }
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
    const ancL = w.anchorageLeft ? w.anchorageLeft.id + ' (' + w.anchorageLeft.cap + ' lb, D/C=' + (w.anchorageDCLeft != null ? w.anchorageDCLeft.toFixed(2) : '?') + ')' : 'OVER CAPACITY';
    const ancR = w.anchorageRight ? w.anchorageRight.id + ' (' + w.anchorageRight.cap + ' lb, D/C=' + (w.anchorageDCRight != null ? w.anchorageDCRight.toFixed(2) : '?') + ')' : 'OVER CAPACITY';
    line(w.anchorageType + ' Left:', ancL);
    line(w.anchorageType + ' Right:', ancR);
    const pL = w.postLeft ? w.postLeft.postLabel + ' (' + w.postLeft.capacityKips + 'k, D/C=' + (w.postDCLeft != null ? w.postDCLeft.toFixed(2) : '?') + ')' : 'OVER CAPACITY';
    const pR = w.postRight ? w.postRight.postLabel + ' (' + w.postRight.capacityKips + 'k, D/C=' + (w.postDCRight != null ? w.postDCRight.toFixed(2) : '?') + ')' : 'OVER CAPACITY';
    line('Post Left:', pL);
    line('Post Right:', pR);
  }

  const details = el('details', { style: { marginBottom: '0.5rem', borderLeft: '3px solid var(--border-light)', paddingLeft: '0.75rem' } }, summary, body);
  return details;
}

// === Definition migrations ===
// Saved definitions are upgraded step by step to the current schema. To change the definition shape:
// add a step here, bump schemaVersion, and add a legacy fixture of the previous version in
// tests/fixtures/legacy/. Steps must be idempotent. Results are never migrated — they are regenerated.

function migrateToV4(inp) {
  if (!inp.wallThickness) inp.wallThickness = '4';
  if (!inp.woodGrade) inp.woodGrade = 'dfir_no1';
  (inp.levels || []).forEach(l => {
    if (!l.floorClearSpan) l.floorClearSpan = '16';
    if (!l.anchorageType) l.anchorageType = 'auto';
  });
  (inp.directions || []).forEach(d => (d.lines || []).forEach(ln => {
    if (ln.wallThickness === undefined) ln.wallThickness = '';
    if (!ln.beams) ln.beams = [];
    if (!ln.supportPosts) ln.supportPosts = [];
    (ln.walls || []).forEach(w => { delete w.capacity; }); // v2 stored a derived capacity on walls
  }));
  return inp;
}

// Schema v6: wall openings (segmented / FTAO), deflection and drift settings
export function migrateV5toV6(inp) {
  if (!inp) return inp;
  const dd = deflectionDefaults();
  for (const [k, v] of Object.entries(dd)) if (inp[k] === undefined) inp[k] = v;
  if (!inp.refs) inp.refs = {};
  (inp.directions || []).forEach(d => (d.lines || []).forEach(ln => (ln.walls || []).forEach(w => {
    const wd = wallOpeningDefaults();
    for (const [k, v] of Object.entries(wd)) if (w[k] === undefined) w[k] = v;
  })));
  return inp;
}

const DEFINITION_MIGRATIONS = [
  { to: 4, up: migrateToV4 },
  { to: 5, up: migrateV4toV5 },
  { to: 6, up: migrateV5toV6 },
];
const CURRENT_SCHEMA = DEFINITION_MIGRATIONS[DEFINITION_MIGRATIONS.length - 1].to;

export function migrateDefinition(item) {
  const from = parseInt(item.schemaVersion, 10) || 1;
  if (from >= CURRENT_SCHEMA && item.inputs && item.inputs.directions) return item;
  let inp = item.inputs && item.inputs.directions ? JSON.parse(JSON.stringify(item.inputs)) : defaultInputs();
  for (const step of DEFINITION_MIGRATIONS) {
    if (step.to > from) inp = step.up(inp);
  }
  return { ...item, inputs: inp, schemaVersion: CURRENT_SCHEMA };
}

// Schema v5: unique beam/post ids (v4 generated duplicate 'bm-NaN'/'sp-NaN'), marks,
// explicit beam supports (v4 beams were implicitly supported at both ends).
export function migrateV4toV5(inp) {
  if (!inp) return inp;
  const maxOf = (prefix, ids) => ids.reduce((m, id) => {
    const mm = String(id || '').match(new RegExp('^' + prefix + '-(\\d+)$'));
    return mm ? Math.max(m, +mm[1]) : m;
  }, 0);
  const lines = (inp.directions || []).flatMap(d => d.lines || []);
  const allBeams = lines.flatMap(l => l.beams || []);
  const allPosts = lines.flatMap(l => l.supportPosts || []);
  let nb = maxOf('bm', allBeams.map(b => b.id));
  let np = maxOf('sp', allPosts.map(p => p.id));
  let ns = maxOf('bs', allBeams.flatMap(b => (b.supports || []).map(s => s.id)));
  let mb = maxOf('BM', allBeams.map(b => b.mark));
  let mp = maxOf('P', allPosts.map(p => p.mark));
  const seenB = new Set(), seenP = new Set();

  for (const ln of lines) {
    if (!ln.beams) ln.beams = [];
    if (!ln.supportPosts) ln.supportPosts = [];
    for (const p of ln.supportPosts) {
      if (!/^sp-\d+$/.test(p.id || '') || seenP.has(p.id)) p.id = 'sp-' + (++np);
      seenP.add(p.id);
      if (!p.mark) p.mark = 'P-' + (++mp);
      if (p.anchorageOverride === undefined) p.anchorageOverride = '';
      if (p.postOverride === undefined) p.postOverride = '';
    }
    for (const b of ln.beams) {
      if (!/^bm-\d+$/.test(b.id || '') || seenB.has(b.id)) b.id = 'bm-' + (++nb);
      seenB.add(b.id);
      if (!b.mark) b.mark = 'BM-' + (++mb);
      if (!Array.isArray(b.supports)) {
        const bs = parseFloat(b.position) || 0;
        const be = bs + (parseFloat(b.length) || 0);
        b.supports = [bs, be].map(x => ({
          id: 'bs-' + (++ns), position: x,
          type: ln.supportPosts.some(p => Math.abs((parseFloat(p.position) || 0) - x) <= 0.1) ? 'post' : 'point',
          anchorageOverride: '',
        }));
      }
    }
  }
  return inp;
}
