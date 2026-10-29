import { el, clearEl, numOrBlank, sameNumber } from '../utils.js';
import {
  resetIds, resetWallNum, resetElementNums, defaultInputs,
  newLevel, newWallDLType, newLine, newWallId, nextWallMark,
  wallOpeningDefaults, wallSystemDefaults, deflectionDefaults, projectV7Defaults, projectV8Defaults, projectV9Defaults, projectV12Defaults, newOpeningId,
} from './shearWallTypes.js';
import { calcAll, CALC_VERSION, DISTRIBUTION_METHODS, lineDistribution, lineDriftMode, DEFAULT_OMEGA0, omega0Of, windLimitDen } from './shearWallCalc.js';
import { renderElevation, renderElevationForPdf, pdfElevationAspect, planPdfElevation, pdfElevationPartSize } from './shearWallElevation.js';
import { NAILING_TABLE, SHEATHING_TYPES, FOOTNOTE_10_NOTE, sheathingLabel } from './shearWallNailing.js';
import { renderHardwareTab as renderHardwareTabView, hardwareAppendixSections } from './shearWallHardwareTab.js';
import { lrfdCap, getGradeById, woodBasis, sillProps, SPECIES, speciesOf, dimGrades, ptGrades, groupLabel } from './shearWallHardware.js';
import { DRIFT_ROWS, driftLimit } from './shearWallDeflection.js';
import { WSWH_NOTES, WSWH_FC, conditionLabel } from './shearWallWswh.js';
import { assemblyLoads, assemblyPsf } from './shearWallGravity.js';
import { comboDefs, loadCaseRows, lcRef } from './shearWallCombos.js';
import { rich } from '../richText.js';
import { evaluateCase, fmtValue } from './shearWallVerify.js';
import { wallDefinitionRows, capacityRows, nailingTraceRows, cornerOverturningRows, loadCaseEnds, superpositionRows, SUPERPOSITION_HEADERS, hardwareTraceRows, caseKeysOf,
  resistingMomentRows, beamLeverTable, deflectionSubstitutionRows, aboveSourceRefs } from './shearWallCalcSheet.js';

// Values copied from a linked Seismic Base Shear item
const BASE_SHEAR_FIELDS = [['sds', 'Sds'], ['cd', 'Cd'], ['ie', 'Ie'], ['riskCategory', 'Risk Category'], ['omega0', 'Ω₀'], ['seismicDesignCategory', 'SDC']];
const sameValue = (a, b) => (typeof b === 'number' ? sameNumber(a, b, 0.0005) : String(a || '') === String(b || ''));
// Gravity rows linked to a Flat Load assembly: { where: 'Line · Level · load n', ld }
function linkedGravityRows(inputs) {
  const out = [];
  for (const d of inputs.directions || []) for (const ln of d.lines || []) {
    for (const [lvlId, gl] of Object.entries(ln.gravityLoads || {})) {
      ((gl && gl.loads) || []).forEach((ld, i) => {
        if (!ld.assemblyId || ld.shape === 'point') return;
        const lvl = (inputs.levels || []).find(l => l.id === lvlId) || {};
        out.push({ where: (ln.name || 'Line') + ' · ' + (lvl.name || 'Level') + ' · load ' + (i + 1), ld });
      });
    }
  }
  return out;
}

export const shearWallDesign = {
  id: 'shear_wall_design',
  label: 'Shear Wall Design',
  schemaVersion: 13,
  calcVersion: CALC_VERSION,
  noNewPrefix: true,
  noOutputSection: false,

  refs: [
    { key: 'baseShearSource', label: 'Seismic Base Shear', sourceType: 'seismic_base_shear',
      extract: (outputs) => ({ sds: outputs.sds, cd: outputs.cd, ie: outputs.ie, riskCategory: outputs.riskCategory, omega0: outputs.omega0, seismicDesignCategory: outputs.seismicDesignCategory }) },
    { key: 'flatLoadSource', label: 'Flat Load Calculator', sourceType: 'flat_load_calculator',
      extract: (outputs) => ({ perTab: outputs.perTab }) },
  ],
  fields: [],
  outputFields: [],

  // Definition (inputs) is the source of truth — results are always regenerated from it
  regenerateResults: true,
  wideLayout: true, // item form uses the wide page so the elevation has room

  migrate(item) { return migrateDefinition(item); },

  // Sds / Cd / Ie / Risk Category copied from the Base Shear item that no longer match it
  // Flat Load: uniform gravity rows linked to an assembly whose D / L / Lr (psf × trib) changed
  linkDiff(inputs, linked) {
    const bs = linked.baseShearSource;
    const out = bs ? BASE_SHEAR_FIELDS.filter(([k]) => bs[k] != null && !sameValue(inputs[k], bs[k]))
      .map(([k, label]) => ({ refKey: 'baseShearSource', label, from: inputs[k], to: bs[k] })) : [];
    const tabs = linked.flatLoadSource && linked.flatLoadSource.perTab;
    if (tabs) {
      for (const { where, ld } of linkedGravityRows(inputs)) {
        const asm = tabs.find(t => t.id === ld.assemblyId);
        if (!asm) { out.push({ refKey: 'flatLoadSource', label: where + ' — assembly no longer in Flat Load', from: ld.D, to: null, missing: true }); continue; }
        const v = ld.perArea ? assemblyPsf(asm) : assemblyLoads(asm, ld.trib);
        const unit = ld.perArea ? ' psf' : ' plf';
        for (const c of ['D', 'L', 'Lr']) {
          if (!sameNumber(parseFloat(ld[c]) || 0, v[c], 0.005)) out.push({ refKey: 'flatLoadSource', label: where + ' (' + (asm.name || 'assembly') + ') ' + c + unit, from: ld[c] || 0, to: v[c] });
        }
      }
    }
    return out;
  },

  applyLinks(inputs, linked) {
    const bs = linked.baseShearSource;
    if (bs) for (const [k] of BASE_SHEAR_FIELDS) if (bs[k] != null) inputs[k] = String(bs[k]);
    const tabs = linked.flatLoadSource && linked.flatLoadSource.perTab;
    if (tabs) {
      for (const { ld } of linkedGravityRows(inputs)) {
        const asm = tabs.find(t => t.id === ld.assemblyId);
        if (!asm) continue; // missing assemblies are left for the engineer
        const v = ld.perArea ? assemblyPsf(asm) : assemblyLoads(asm, ld.trib);
        ld.D = String(v.D); ld.L = v.L ? String(v.L) : ''; ld.Lr = v.Lr ? String(v.Lr) : '';
      }
    }
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

  // Report dropdown next to the top Export PDF button (itemForm.js)
  pdfOptions: { key: 'pdfReport', label: 'PDF report', options: [['summary', 'Summary'], ['detailed', 'Detailed']] },

  renderForm(container, existingInputs, onSave, projectItems, onInputChange, hooks) {
    const inputs = existingInputs && existingInputs.directions ? existingInputs : defaultInputs();
    if (hooks) hooks.setInput = (key, value) => { inputs[key] = value; if (onInputChange) onInputChange(); };
    if (!inputs.refs) inputs.refs = {};
    resetIds(inputs);
    resetWallNum(inputs);
    resetElementNums(inputs);
    clearEl(container);

    let activeTopTab = 'summary';
    let activeResultTab = 'walls';
    let activeReport = 'summary'; // line results Walls tab: 'summary' | 'detailed'
    let activeForcesKey = 'governing'; // line results Forces tab: LC key or 'governing' (ASD envelope)
    const activeDetail = {}; // Detailed report tabs: { level, type, mark }
    let refreshLineResults = null; // set by the open line tab
    let resultsTimer = null;
    let activeDirLineTabs = {};
    let elevationHandle = null;
    const hardwareView = { species: null, wswhLoad: 'S' }; // Hardware tab toggles (not saved)

    function notifyChange() {
      if (onInputChange) onInputChange();
      if (refreshLineResults) { clearTimeout(resultsTimer); resultsTimer = setTimeout(() => refreshLineResults && refreshLineResults(), 400); }
    }

    function renderAll() {
      clearEl(container);
      if (elevationHandle) { elevationHandle.destroy(); elevationHandle = null; }
      refreshLineResults = null;

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
      if (inputs.verification) tabBar.appendChild(tabBtn('verification', 'Verification ' + (inputs.verification.id || '')));
      container.appendChild(tabBar);

      const body = el('div');
      if (activeTopTab === 'summary') {
        body.appendChild(renderSummaryTab());
      } else if (activeTopTab === 'hardware') {
        body.appendChild(renderHardwareTab());
      } else if (activeTopTab === 'verification' && inputs.verification) {
        body.appendChild(renderVerificationTab(inputs));
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
      // Wood (schema 13, user 2026-10-13): species (sets the DF/SP or SPF/HF hardware tables), the dimension-lumber
      // grade (NDS Table 4A / 4B: studs, plates, 2x / 4x posts) and the posts & timbers grade (Table 4D: 6x6, 8x6)
      const wood = woodBasis(inputs);
      const woodSelect = (list, value, width, onPick) => {
        const sel = el('select', { className: 'form-select', style: { width }, onChange(e) { onPick(e.target.value); } });
        list.forEach(o => sel.appendChild(el('option', { value: o.id, selected: o.id === value }, o.label)));
        return sel;
      };
      row1.appendChild(el('div', { className: 'form-group', style: { marginBottom: 0 } },
        el('label', { className: 'form-label' }, 'Species (hardware ' + groupLabel(wood.group) + ')'),
        woodSelect(SPECIES, wood.species, '200px', (id) => {
          const sp = speciesOf(id);
          inputs.species = id; inputs.woodGrade = sp.defaults[0]; inputs.postGrade = sp.defaults[1];
          notifyChange(); renderAll();
        })));
      row1.appendChild(el('div', { className: 'form-group', style: { marginBottom: 0 } },
        el('label', { className: 'form-label' }, 'Grade — dimension lumber (NDS ' + wood.dim.table + ')'),
        woodSelect(dimGrades(wood.species), wood.dim.id, '200px', (id) => { inputs.woodGrade = id; notifyChange(); })));
      row1.appendChild(el('div', { className: 'form-group', style: { marginBottom: 0 } },
        el('label', { className: 'form-label' }, 'Grade — posts & timbers 6x6, 8x6 (NDS 4D)'),
        woodSelect(ptGrades(wood.species), wood.pt.id, '200px', (id) => { inputs.postGrade = id; notifyChange(); })));
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
      sec.appendChild(renderGravitySettings());
      sec.appendChild(renderWswhSettings());

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
      // load cases and combinations at the bottom, below the loading (user 2026-10-01)
      sec.appendChild(designBasisTables(inputs));

      return sec;
    }

    // Assemblies (perTab) of the linked Flat Load item, for the gravity load rows
    function flatLoadAssemblies() {
      const it = (projectItems || []).find(x => x.id === (inputs.refs || {}).flatLoadSource);
      return (it && it.outputs && it.outputs.perTab) || [];
    }

    // Gravity loads: Flat Load link (assembly psf × trib for uniform rows) and the LRFD live-load factor
    function renderGravitySettings() {
      const box = el('div', { style: { marginBottom: '1rem' } });
      box.appendChild(el('div', { className: 'section-header' }, 'Gravity Loads (D / L / Lr)'));
      const row = el('div', { style: { display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' } });
      const flItems = (projectItems || []).filter(it => it.type === 'flat_load_calculator' && !it.archived);
      const flSel = el('select', { className: 'form-select', style: { maxWidth: '260px' }, onChange(e) {
        if (e.target.value) inputs.refs.flatLoadSource = e.target.value; else delete inputs.refs.flatLoadSource;
        notifyChange(); renderAll();
      } });
      flSel.appendChild(el('option', { value: '' }, flItems.length ? '— None —' : 'No Flat Load item in project'));
      flItems.forEach(it => flSel.appendChild(el('option', { value: it.id, selected: inputs.refs.flatLoadSource === it.id }, it.custom_name || it.customName || it.label || 'Flat Load Calculator')));
      row.appendChild(el('div', { className: 'form-group', style: { marginBottom: 0 } }, el('label', { className: 'form-label' }, 'Link to Flat Load Calculator'), flSel));
      const half = el('input', { type: 'checkbox', checked: !!inputs.lrfdHalfL, onChange(e) { inputs.lrfdHalfL = e.target.checked; notifyChange(); renderAll(); } });
      row.appendChild(el('label', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', paddingBottom: '0.4rem' } }, half,
        'LRFD: 0.5L in combos §2.3.1 (3), (4) and §2.3.6 (6) (Lo ≤ 100 psf; not garages or places of public assembly)'));
      box.appendChild(row);
      box.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginTop: '0.35rem' } },
        'Loads are entered per line and level in each line tab (Gravity Loads, below the elevation): point loads in kips, uniform loads in plf, or in psf × a trib width. A linked uniform row uses the assembly dead psf (D) and live psf (Lr for a roof assembly, L otherwise) × its trib width; changes in the Flat Load item show an update notice.'));
      return box;
    }

    // Strong-Wall WSWH project settings: foundation f'c (panel + anchor tables), SDC and dwelling type (anchor criteria)
    function renderWswhSettings() {
      const box = el('div', { style: { marginBottom: '1rem' } });
      box.appendChild(el('div', { className: 'section-header' }, 'Strong-Wall WSWH (Simpson)'));
      const row = el('div', { style: { display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' } });
      const field = (label, input) => el('div', { className: 'form-group', style: { marginBottom: 0 } }, el('label', { className: 'form-label' }, label), input);
      const fcSel = el('select', { className: 'form-select', style: { width: '110px' }, onChange(e) { inputs.wswhFc = e.target.value; notifyChange(); } });
      WSWH_FC.forEach(v => fcSel.appendChild(el('option', { value: v, selected: String(inputs.wswhFc || '2500') === v }, v + ' psi')));
      const sdcSel = el('select', { className: 'form-select', style: { width: '80px' }, onChange(e) { inputs.seismicDesignCategory = e.target.value; notifyChange(); } });
      ['', 'A', 'B', 'C', 'D', 'E', 'F'].forEach(v => sdcSel.appendChild(el('option', { value: v, selected: String(inputs.seismicDesignCategory || '') === v }, v || '—')));
      const det = el('input', { type: 'checkbox', checked: !!inputs.detachedOneTwoFamily, onChange(e) { inputs.detachedOneTwoFamily = e.target.checked; notifyChange(); } });
      row.appendChild(field("Foundation f'c", fcSel));
      row.appendChild(field('SDC (anchor criteria)', sdcSel));
      row.appendChild(el('label', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', paddingBottom: '0.4rem' } }, det, 'Detached one- / two-family dwelling'));
      box.appendChild(row);
      box.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginTop: '0.35rem' } },
        'Used by WSWH walls only. SDC is copied from the linked Base Shear item. Anchors (Table 06, cracked concrete): SDC A–B any row; SDC C seismic (E) rows unless a detached one- / two-family dwelling; SDC D–F (or blank) E rows. The lightest footing (smallest W, then embedment) that carries T is used.'));
      return box;
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
      row.appendChild(field(['Ω', el('sub', null, '0'), ' (forces only)'], numInput('omega0', '60px', String(DEFAULT_OMEGA0))));
      row.appendChild(field('Risk Cat.', select('riskCategory', [['', '—'], ['I', 'I'], ['II', 'II'], ['III', 'III'], ['IV', 'IV']], '70px')));
      row.appendChild(field('Drift limit (Table 12.12-1)', select('driftRow', DRIFT_ROWS.map(r => [r.id, r.label]), '260px')));
      if (inputs.loadType === 'wind' || inputs.loadType === 'both') {
        row.appendChild(field(['Service wind α', el('sub', null, 's')], numInput('alphaS', '70px', 'blank = skip')));
        row.appendChild(field(['Wind drift limit h', el('sub', null, 'sx'), ' / n (report only)'], numInput('windDriftLimit', '60px', '400')));
      }
      box.appendChild(row);
      const byp = el('input', { type: 'checkbox', checked: !!inputs.driftBypass, onChange(e) { inputs.driftBypass = e.target.checked; notifyChange(); renderAll(); } });
      box.appendChild(el('label', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', marginTop: '0.4rem' } }, byp,
        'Bypass the drift check (report only): no drift upsizing of the nailing, and drift NG does not fail a line. Each line can override this.'));
      const lim = driftLimit(inputs.driftRow, inputs.riskCategory);
      box.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginTop: '0.35rem' } },
        'Deflection per SDPWS 2021 Eq. 4.3-1 at 1.0E (ρ = 1), ' + sheathingLabel(inputs.sheathing) + ' Ga. δx = Cd·δxe/Ie; allowable Δa = '
        + (lim != null ? lim + '·h_sx' : '— (set Risk Category)') + '. When the drift check is on, auto nailing is raised until every story passes (walls then show "governed by drift"). Linked values show an update notice when the Base Shear item changes.'));
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
      return renderHardwareTabView(inputs, hardwareView, renderAll);
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
      const driftSel = el('select', { className: 'form-select', style: { width: '190px', fontSize: '0.8rem' },
        onChange(e) { line.driftBypass = e.target.value; notifyChange(); if (elevationHandle && elevationHandle.hasResults) previewTC(line, dir); } });
      const projDrift = lineDriftMode(inputs, {});
      [['', 'Default (' + (projDrift === 'bypass' ? 'bypass' : 'check & size') + ')'], ['check', 'Check & size for drift'], ['bypass', 'Bypass (report only)']].forEach(([v, label]) =>
        driftSel.appendChild(el('option', { value: v, selected: (line.driftBypass || '') === v }, label)));
      hdr.appendChild(el('label', { className: 'form-label', style: { marginBottom: 0 } }, 'Drift:'));
      hdr.appendChild(driftSel);
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
            ...wallSystemDefaults(),
            systemType: sw.systemType || 'sheathed', wswhWidth: sw.wswhWidth || '18', wswhJoist: sw.wswhJoist || '12',
            wswhFloorDepth: sw.wswhFloorDepth || '12',
            // a WSWH copied to an upper story becomes the 2nd-story panel of a stack
            wswhCondition: toId === inputs.levels[inputs.levels.length - 1].id ? (sw.wswhCondition === 'stackedUpper' ? 'concrete' : sw.wswhCondition || 'concrete') : 'stackedUpper',
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
        flatLoadAssemblies: () => flatLoadAssemblies(),
        designContext: () => ({ wallThickness: inputs.wallThickness, wood: woodBasis(inputs), loadType: inputs.loadType,
          wswhFc: inputs.wswhFc, sdc: inputs.seismicDesignCategory, detached: !!inputs.detachedOneTwoFamily, bottomLevelId: (inputs.levels[inputs.levels.length - 1] || {}).id }),
        onInputChange() {
          notifyChange();
          // Preview results go stale on every edit — recompute while the preview is shown
          if (elevationHandle && elevationHandle.hasResults) previewTC(line, dir);
        },
      });

      // This line's results (all reports for the line), recalculated from the current definition
      const resultsBox = el('div', { style: { marginTop: '1rem', borderTop: '2px solid var(--border)', paddingTop: '0.75rem' } });
      panel.appendChild(resultsBox);
      refreshLineResults = () => {
        clearEl(resultsBox);
        resultsBox.appendChild(el('div', { className: 'section-header', style: { marginTop: 0 } }, 'Line Results — ' + (dir.name || '') + ' / ' + (line.name || '')));
        let out;
        try { out = calcAll(inputs); } catch (e) {
          console.error('Line results failed:', e);
          resultsBox.appendChild(el('span', { className: 'badge badge-fail' }, 'Results could not be calculated — check the inputs'));
          return;
        }
        const dirOut = (out.perDirection || []).find(d => d.dirId === dir.id);
        const lnOut = dirOut && dirOut.perLine.find(l => l.lineId === line.id);
        if (!lnOut) return;
        try {
          renderLineResults(resultsBox, lnOut, dirOut, { tab: activeResultTab, onTab(t) { activeResultTab = t; refreshLineResults(); },
            report: activeReport, onReport(r) { activeReport = r; refreshLineResults(); },
            forcesKey: activeForcesKey, onForcesKey(k) { activeForcesKey = k; refreshLineResults(); },
            detail: activeDetail, onDetail(patch) {
              // a new level / type resets the lower tabs
              if (patch.level) { delete activeDetail.type; delete activeDetail.mark; }
              if (patch.type) delete activeDetail.mark;
              Object.assign(activeDetail, patch); refreshLineResults();
            },
            onReview(w, on) {
              // engineer review of a distribution warning, stored in the line definition (schema v11)
              const list = (line.distReviewed || []).filter(r => r.key !== w.key);
              if (on) list.push({ key: w.key, message: w.message, date: new Date().toISOString().slice(0, 10) });
              line.distReviewed = list;
              notifyChange(); refreshLineResults();
            },
            defs: { inputs, line } });
        } catch (e) {
          console.error('Rendering line results failed:', e);
          resultsBox.appendChild(el('span', { className: 'badge badge-fail' }, 'Results could not be displayed'));
        }
      };
      refreshLineResults();

      return panel;
    }

    renderAll();
  },

  // Project summary only — each line's full results are in its tab (direction → line)
  renderOutputs(container, outputs) {
    if (!outputs || !outputs.perDirection) return;
    clearEl(container);
    // Saved results from an older calc version have a different shape — don't render them
    if (outputs.calcVersion !== CALC_VERSION) {
      container.appendChild(el('div', { style: { marginBottom: '0.75rem' } },
        el('span', { className: 'badge badge-stale' }, 'Results are from an older calc version — click Calculate & Save to refresh')));
      return;
    }
    const all = { walls: 0, failing: 0, warned: 0, issues: 0, driftNG: 0 };
    const rows = [];
    for (const dir of outputs.perDirection) {
      for (const ln of dir.perLine) {
        const st = lineStats(ln);
        all.walls += st.walls; all.failing += st.failing; all.warned += st.warned; all.issues += st.issues;
        if (st.drift === 'NG') all.driftNG++;
        all.checksFailed = (all.checksFailed || 0) + st.checksFailed;
        rows.push([dir.dirName, ln.lineName, String(st.walls), st.walls ? st.maxDC.toFixed(2) : '—',
          ln.distribution && ln.distribution.method === 'deflection' ? 'Deflection' : 'Capacity',
          st.drift || '—', String(st.issues), st.checksFailed ? st.checksFailed + ' NG' : 'OK', lineStatusBadge(st)]);
      }
    }
    container.appendChild(el('div', { style: { marginBottom: '0.5rem' } }, lineStatusBadge({ ...all, drift: all.driftNG ? 'NG' : null })));
    container.appendChild(el('div', { style: { fontSize: '0.85rem', color: 'var(--ink-secondary)', marginBottom: '0.5rem' } },
      'Full results for each wall line are in its tab above (direction → line), below the elevation.'));
    container.appendChild(simpleTable(['Direction', 'Line', 'Walls', 'Max D/C', 'Distribution', 'Drift', 'Load path issues', 'Checks', 'Status'], rows, [2, 3, 6]));
    container.appendChild(renderMethodFootnotes());
  },

  // Always built from the definition — stored results are only a snapshot
  // PDF report (user 2026-10-01): organised per wall line — every table belongs to one line. Front pages hold only what
  // is common to all lines (design data, levels, load cases, LC#, line index). Summary = schedules; Detailed = + calcs.
  pdfSections(inputs) {
    const sections = [];
    const outputs = calcAll(inputs);
    const detailed = (inputs.pdfReport || 'summary') === 'detailed';
    const P = (rows) => rows.map(r => (r.cells || r).map(pdfCell));
    const wood = woodBasis(inputs);

    // === Front pages ===
    const configRows = [
      ['Report', detailed ? 'Detailed (schedules + calcs per wall line)' : 'Summary (schedules per wall line)'],
      ['Load Type', inputs.loadType || '—'], ['S_DS', inputs.sds || '—'],
      ['C_d / I_e / Risk Category', (inputs.cd || '—') + ' / ' + (inputs.ie || '—') + ' / ' + (inputs.riskCategory || '—') + ((inputs.refs || {}).baseShearSource ? ' (linked to Seismic Base Shear)' : '')],
      ['Ω_0 (forces only)', String(omega0Of(inputs))],
      ['Default Wall', (inputs.wallThickness || '4') + '" framing'],
      ['Species', wood.speciesLabel + ' — hardware tables ' + groupLabel(wood.group)],
      ['Grade — dimension lumber', wood.dim.label + ' (NDS 2018 Table ' + wood.dim.table + '; studs, plates, 2x / 4x posts)'],
      ['Grade — posts & timbers', wood.pt.label + ' (NDS 2018 Table 4D; 6x6, 8x6 posts)'],
      ['Sheathing (G_a)', sheathingLabel(inputs.sheathing)],
      ['Sill plate (crushing, post bearing)', 'F_{c⊥} = ' + sillProps(wood, '4').Fcperp + ' psi (2x4) / ' + sillProps(wood, '6').Fcperp + ' psi (2x6), ' + wood.dim.label + ', NDS Table ' + wood.dim.table],
      ['Drift limit', ((DRIFT_ROWS.find(r => r.id === inputs.driftRow) || DRIFT_ROWS[0]).label) + (driftLimit(inputs.driftRow, inputs.riskCategory) != null ? ' — ' + driftLimit(inputs.driftRow, inputs.riskCategory) + '·h_{sx}' : '')],
    ];
    if (inputs.loadType !== 'seismic') {
      configRows.push(['Service wind α_s', inputs.alphaS || '— (wind deflection not computed)']);
      configRows.push(['Wind drift limit', 'h_{sx} / ' + windLimitDen(inputs) + ' (serviceability, ASCE 7-22 Commentary CC.2.2; report only)']);
    }
    sections.push({ title: 'Design Data', rows: configRows });
    if (inputs.levels && inputs.levels.length) {
      let elev = 0;
      const rows = [];
      for (let i = inputs.levels.length - 1; i >= 0; i--) { elev += parseFloat(inputs.levels[i].floorToFloor) || 0; rows.unshift([inputs.levels[i].name || '?', numOrBlank(inputs.levels[i].floorToFloor), elev.toFixed(1)]); }
      sections.push({ title: 'Levels (top to bottom)', table: { headers: ['Level', 'Floor-to-Floor (ft)', 'Elevation (ft)'], rows } });
    }
    for (const dir of (inputs.directions || [])) {
      const rows = [];
      for (const line of (dir.lines || [])) for (const lvl of (inputs.levels || [])) {
        const e = (line.levelLoads || {})[lvl.id] || {};
        rows.push([line.name || '?', lvl.name || '?', numOrBlank(e.seismic) || '—', numOrBlank(e.wind) || '—']);
      }
      if (rows.length) sections.push({ title: 'Lateral loading — ' + dir.name + ' (unfactored, all lines)', table: { headers: ['Line', 'Level', '1.0E (k)', '1.0W (k)'], rows, colWidths: [0.3, 0.3, 0.2, 0.2] } });
    }
    sections.push({ title: 'Load Cases (unfactored)', table: { headers: LOAD_CASE_HEADERS, rows: loadCaseTableRows(inputs), colWidths: [0.1, 0.35, 0.55] } });
    sections.push({ title: 'Load Combinations', table: { headers: LC_HEADERS, rows: lcTableRows(inputs), colWidths: [0.07, 0.1, 0.33, 0.14, 0.36] } });
    sections.push({ title: 'Load combination note', text: designBasisNote(inputs) });
    if (!outputs || !outputs.perDirection) return sections;
    const lines = outputs.perDirection.flatMap(dir => dir.perLine.map(ln => ({ dir, ln })));
    const statusOf = (st) => (st.failing || st.issues || st.drift === 'NG' || st.checksFailed ? 'NG' : st.warned || st.distWarnings || st.windDriftNG ? 'WARN' : 'OK');
    sections.push({ title: 'Wall lines', table: {
      headers: ['Direction', 'Line', 'Walls', 'Status'], colWidths: [0.25, 0.35, 0.15, 0.25],
      rows: lines.map(({ dir, ln }) => {
        const st = lineStats(ln), s = statusOf(st);
        return [dir.dirName, ln.lineName, String(st.walls), s === 'NG' ? { t: 'NG', color: DC_RGB.fail } : s === 'WARN' ? { t: 'WARN', color: DC_RGB.warn } : { t: 'OK', color: DC_RGB.pass }];
      }) } });

    // === One section per wall line ===
    for (const { dir, ln } of lines) {
      const lst = lineStats(ln);
      const prefix = dir.dirName + ' / ' + ln.lineName;
      const T = (name) => prefix + ' — ' + name;
      const inLine = (inputs.directions || []).flatMap(d => d.lines || []).find(l => l.id === ln.lineId) || {};
      // 1. status + distribution warnings
      sections.push({ heading: 'Wall line ' + prefix, title: 'Line summary', anchor: 'line:' + ln.lineId, pageBreakBefore: true, rows: [
        ['Status', statusOf(lst)],
        ['Walls', lst.walls + (lst.failing ? ' (' + lst.failing + ' failing)' : '') + (lst.warned ? ', ' + lst.warned + ' h/b warning' : '')],
        ['Max sheathing D/C', lst.walls ? lst.maxDC.toFixed(2) : '—'],
        ['Distribution', distributionText(ln)],
        ['Story drift', (lst.drift || '—') + (ln.driftSizing ? ' — ' + (ln.driftSizing.mode === 'bypass' ? 'check bypassed (report only)' : 'check on') : '')
          + (lst.windDriftNG ? '; wind drift over h/' + ((ln.drift && ln.drift.windLimitDen) || 400) + ' at ' + lst.windDriftNG + ' level(s) (report only)' : '')],
        ...(ln.driftSizing && ln.driftSizing.note ? [['Drift sizing', ln.driftSizing.note]] : []),
        ['Load path issues', String(lst.issues)],
        ['Equilibrium checks', lst.checksFailed ? lst.checksFailed + ' failed' : 'all pass'],
      ] });
      const ws = distWarningsOf(ln);
      if (ws.length) sections.push({ title: T('Distribution warnings'), rows: ws.map(w => [(w.level === 'big' ? 'WARNING — walls carry more than designed' : 'Warning — ' + (w.elementMark || ''))
        + (w.reviewed ? ' — engineer reviewed OK' + (w.reviewDate ? ' ' + w.reviewDate : '') : w.reviewStale ? ' — review stale (values changed)' : ''),
        w.reviewed ? w.message : { t: w.message, color: DC_RGB.warn }]) });
      // line and wall definitions (user review 2026-10-01: the inputs of the line were not shown anywhere)
      sections.push({ title: T('Line definition'), rows: lineDefinitionRows(inputs, dir, inLine) });
      const wdef = wallDefinitionTableRows(inputs, inLine);
      if (wdef.length) sections.push({ title: T('Walls (definition)'), table: { headers: WALL_DEF_HEADERS, rows: wdef, colWidths: [0.07, 0.09, 0.1, 0.07, 0.07, 0.07, 0.06, 0.12, 0.35] } });
      const ed = elementDefinitionRows(inputs, inLine);
      if (ed.length) sections.push({ title: T('Posts and beams (definition)'), table: { headers: ELEMENT_DEF_HEADERS, rows: ed, colWidths: [0.1, 0.1, 0.1, 0.25, 0.45] } });
      // 2. this line's loading
      const loadRows = (inputs.levels || []).map(lvl => { const e = (inLine.levelLoads || {})[lvl.id] || {}; return [lvl.name || '?', numOrBlank(e.seismic) || '—', numOrBlank(e.wind) || '—']; });
      sections.push({ title: T('Lateral loading (unfactored)'), table: { headers: ['Level', '1.0E (k)', '1.0W (k)'], rows: loadRows, colWidths: [0.4, 0.3, 0.3] } });
      const gRows = gravityInputRows(inputs, inLine);
      if (gRows.length) sections.push({ title: T('Gravity loads'), table: { headers: GRAVITY_INPUT_HEADERS, rows: gRows, colWidths: [0.14, 0.05, 0.12, 0.17, 0.24, 0.28] } });
      // 3. wall schedule per level (* = manual override)
      for (const pl of ln.perLevel) {
        if (!pl.walls.length) continue;
        let anyManual = false;
        const rows = wallScheduleRows(pl).map((r, i) => {
          const w = pl.walls[i], wIn = (inLine.walls || []).find(x => x.id === w.wallId) || {};
          const star = (c, on) => { if (!on) return c; anyManual = true; return typeof c === 'object' ? { ...c, t: c.t + ' *' } : c + ' *'; };
          const out = r.slice();
          out[2] = star(out[2], !!wIn.nailingPattern);
          out[7] = star(out[7], !!wIn.anchorageLeftOverride); out[8] = star(out[8], !!wIn.anchorageRightOverride);
          out[9] = star(out[9], !!wIn.postLeftOverride); out[10] = star(out[10], !!wIn.postRightOverride);
          return out;
        });
        sections.push({ title: T('Wall schedule, ' + pl.levelName + ' (V = ' + f2(pl.storyShear_1E) + ' k 1.0E' + (pl.storyShear_1W ? ', ' + f2(pl.storyShear_1W) + ' k 1.0W' : '') + ')') + (anyManual ? ' — * = manual override' : ''),
          table: { headers: WALL_SCHEDULE_HEADERS, rows: P(rows), colWidths: [0.07, 0.07, 0.11, 0.09, 0.08, 0.08, 0.08, 0.1, 0.1, 0.08, 0.08, 0.06] } });
      }
      const wsRows = wswhRows(ln);
      if (wsRows.length) {
        sections.push({ title: T('Strong-Wall WSWH'), table: { headers: WSWH_HEADERS, rows: wsRows, colWidths: [0.06, 0.07, 0.13, 0.12, 0.07, 0.1, 0.12, 0.06, 0.07, 0.2] } });
        const stRows = wswhStackRows(ln);
        if (stRows.length) sections.push({ title: T('WSWH two-story stack (base moment)'), table: { headers: WSWH_STACK_HEADERS, rows: stRows } });
        sections.push({ title: T('Strong-Wall notes'), text: wswhNoteLines(ln).join('\n') });
      }
      // 4. posts & beams
      const pb = postsBeamsRows(ln);
      if (pb.length) sections.push({ title: T('Isolated posts and beam supports (ASD envelope, governing LC#)'), table: { headers: POSTS_BEAMS_HEADERS, rows: P(pb), colWidths: [0.16, 0.08, 0.06, 0.12, 0.12, 0.14, 0.14, 0.18] } });
      const audit = ln.loadPathAudit || { warnings: [], notes: [] };
      const nc = notCarriedSummary(audit.notes);
      const auditRows = audit.warnings.map(w => [w.elementMark + ' (' + w.levelName + ')', { t: w.message, color: DC_RGB.fail }])
        .concat(nc ? [['Note', nc]] : [])
        .concat((audit.notes || []).filter(n => n.type !== 'gravity_unsupported').map(n => [(n.elementMark || 'Note') + (n.levelName ? ' (' + n.levelName + ')' : ''), n.message]));
      if (auditRows.length) sections.push({ title: T('Load path warnings and notes'), rows: auditRows });
      // 5. distribution, 6. drift summary
      sections.push(...distributionSections(ln, prefix));
      const ds = driftSummaryRows(ln);
      if (ds.length) sections.push({ title: T('Story drift — seismic'), table: { headers: DRIFT_SUMMARY_HEADERS, rows: P(ds), colWidths: [0.14, 0.07, 0.1, 0.08, 0.13, 0.08, 0.08, 0.1, 0.22] } });
      const wd = windDriftRows(ln);
      if (wd.length) sections.push({ title: T('Story drift — wind, service level (h_{sx} / ' + ((ln.drift && ln.drift.windLimitDen) || 400) + ', report only)'), table: { headers: WIND_DRIFT_HEADERS, rows: P(wd), colWidths: [0.16, 0.08, 0.12, 0.17, 0.2, 0.12, 0.15] } });
      if (ln.drift && ln.drift.missing) sections.push({ title: T('Drift note'), text: ln.drift.missing });
      if ((ln.deflWarnings || []).length) sections.push({ title: T('Deflection warnings — T above the LRFD cap (Δa extrapolated)'), rows: ln.deflWarnings.map(wn => [wn.mark + (wn.levelName ? ' (' + wn.levelName + ')' : ''), '⚠ ' + wn.message]) });
      // 7. elevation
      if (inLine.id) {
        sections.push(...elevationSections(inputs, inLine, ln, 'forces', T('Elevation — end forces, ASD envelope (largest T and C over LC1–LC' + asdLcCount(inputs) + ' at each end)')));
        sections.push({ title: T('Elevation note'), landscape: true, text: 'P = this element only; Σ = including the loads from the elements above. T = uplift (tension), C = compression, ASD level (k). The governing LC# of each value is in the Forces tab / Detailed report.' });
        sections.push(...elevationSections(inputs, inLine, ln, 'hardware', T('Elevation — hardware (nailing, HD / strap and posts with D/C; no forces)')));
      }
      if (!detailed) continue;

      // === Detailed: the calcs of this line ===
      for (const pl of ln.perLevel) {
        if (!pl.walls.length) continue;
        sections.push({ title: T('Overturning, ' + pl.levelName + ' (loads used for the end forces, ASD governing incl. loads from above)'), pageBreakBefore: pl === ln.perLevel.find(x => x.walls.length),
          table: { headers: OT_SUMMARY_HEADERS, rows: overturningSummaryRows(pl), colWidths: [0.08, 0.1, 0.11, 0.1, 0.1, 0.1, 0.11, 0.11, 0.19] } });
      }
      // each wall's calc sheet = the tool's calc sheet (wallSheetBlocks), starting on a new page
      const sheetDefs = { inputs, line: inLine };
      for (const pl of ln.perLevel) for (const w of pl.walls) sections.push(...wallSheetPdfSections(w, pl, dir, ln, sheetDefs, T));
      const dc = driftCalcRows(ln);
      if (dc.length) sections.push({ title: T('Drift calc — numbers substituted'), table: { headers: DRIFT_CALC_HEADERS, rows: dc.map(r => (r.cells || r).map(subMarkup)) } });
      const wdRows = wallDeflectionRows(ln);
      if (wdRows.length) sections.push({ title: T('Wall deflection (SDPWS Eq. 4.3-1)'), table: { headers: WALL_DEFL_HEADERS, rows: wdRows, colWidths: [0.08, 0.26, 0.07, 0.07, 0.1, 0.1, 0.1, 0.1, 0.08] } });
      const fr = forcesRows(ln, 'governing');
      if (fr.length) sections.push({ title: T('End forces — ASD envelope with the governing LC#'), table: { headers: FORCES_HEADERS, rows: P(fr), colWidths: [0.12, 0.1, 0.1, 0.16, 0.16, 0.12, 0.12, 0.12] } });
      if (ln.wallDeliveries && ln.wallDeliveries.some(d => d.receiver.type !== 'foundation')) {
        sections.push({ title: T('Wall ends that land on a wall, post or beam'), table: { headers: WALL_END_HEADERS, rows: wallEndRows(ln), colWidths: [0.1, 0.14, 0.08, 0.12, 0.12, 0.3] } });
      }
      if (ln.beamTransfers && ln.beamTransfers.length) {
        sections.push({ title: T('Transfer beams'), table: { headers: BEAM_HEADERS, rows: beamSupportRows(ln), colWidths: [0.07, 0.08, 0.06, 0.08, 0.07, 0.08, 0.08, 0.14, 0.2] } });
        const bl = beamLoadRows(ln);
        if (bl.length) sections.push({ title: T('Loads on transfer beams'), table: { headers: BEAM_LOAD_HEADERS, rows: bl, colWidths: [0.08, 0.08, 0.5, 0.18, 0.16] } });
      }
      const checks = ln.checks || [];
      if (checks.length) sections.push({ title: T('Equilibrium checks G1–G12'), table: { headers: ['ID', 'Check', 'Result', 'Status'], colWidths: [0.07, 0.43, 0.35, 0.15],
        rows: checks.map(c => [c.id, c.title, checkSummaryText(c), c.status === 'fail' ? { t: 'NG', color: DC_RGB.fail } : c.status === 'pass' ? { t: 'OK', color: DC_RGB.pass } : String(c.status || '').toUpperCase()]) } });
    }
    // Appendix (Detailed): the hardware and material data this design uses, with sources (user 2026-10-27)
    if (detailed) sections.push(...hardwareAppendixSections(inputs, outputs));
    return sections;
  },
};

// Calc-sheet text writes variables as V_E, R_D, OTM_E, h_sx, δxe: give them subscript markup for the PDF
// (only a letter / Greek symbol followed by _ and letters or digits; wall marks keep their text)
function subMarkup(c) {
  if (typeof c !== 'string') return c;
  return c.replace(/([A-Za-zδΔΩ])_([A-Za-z0-9]+)/g, '$1_{$2}').replace(/δx(e?)(?![A-Za-z_])/g, (m, e) => 'δ_{x' + e + '}');
}

// PDF elevation sections of one line (user 2026-10-01): landscape pages, a standard horizontal scale (the largest of
// 1/4", 3/16", 1/8" = 1'-0" that keeps the line within 2 parts), split in gaps between elements when it does not fit.
const PDF_LANDSCAPE_W = 792 - 2 * 54;            // letter landscape content width (pt), as in pdf.js
const PDF_LANDSCAPE_IMG_H = 612 - 2 * 54 - 80;    // tallest image pdf.js places without reducing it
function elevationSections(inputs, line, ln, mode, title) {
  const plan = planPdfElevation(line, PDF_LANDSCAPE_W);
  const n = plan.parts.length;
  return plan.parts.map((part, i) => {
    const view = { pxPerFt: plan.pxPerFt, x0: part.x0, x1: part.x1 };
    const size = pdfElevationPartSize(line, inputs.levels, ln, mode, view);
    const reduced = size.h > PDF_LANDSCAPE_IMG_H;
    const tail = ' — horizontal scale ' + plan.scaleLabel + (reduced ? ' (reduced to fit the page height)' : '')
      + (n > 1 ? ' — part ' + (i + 1) + ' of ' + n + ' (' + trimNum(part.x0) + '–' + trimNum(part.x1) + ' ft)' + (part.throughElement ? ', cut through an element (no gap)' : '') : '');
    return { title: title + tail, landscape: true, pageBreakBefore: i === 0, elevation: {
      renderFn: () => renderElevationForPdf(line, inputs.levels, inputs.wallDLTypes || [], ln, 0, mode, view),
      width: size.w, height: size.h } };
  });
}

// Number of ASD combinations of the project (elevation title: LC1–LCn)
function asdLcCount(inputs) { return projectComboDefs(inputs).filter(d => d.group === 'asd').length; }

// Line definition (PDF line section): length, ρ, wall thickness, distribution, drift check
function lineDefinitionRows(inputs, dir, line) {
  const dist = lineDistribution(inputs, line);
  const drift = lineDriftMode(inputs, line);
  return [
    ['Line length', (parseFloat(line.totalLength) || 0) + ' ft'],
    ['ρ (direction ' + (dir.dirName || '') + ')', String(dir.rho != null ? dir.rho : 1)],
    ['Wall framing', (line.wallThickness || inputs.wallThickness || '4') + '"' + (line.wallThickness ? ' (line setting)' : ' (project default)')],
    ['Distribution', ((DISTRIBUTION_METHODS.find(m => m.id === dist) || {}).label || dist) + (line.distribution ? ' (line setting)' : ' (project default)')],
    ['Drift check', (drift === 'bypass' ? 'bypassed — report only' : 'on') + (line.driftBypass ? ' (line setting)' : ' (project default)')],
  ];
}
// Walls as entered (PDF line section)
export const WALL_DEF_HEADERS = ['Mark', 'Level', 'Type', 'x (ft)', 'L (ft)', 'h (ft)', 'h/b', 'Wall DL', 'Openings / manual overrides'];
function wallDefinitionTableRows(inputs, line) {
  const lvlOf = (id) => (inputs.levels || []).find(l => l.id === id) || {};
  const dlOf = (id) => (inputs.wallDLTypes || []).find(t => t.id === id);
  return (line.walls || []).map(w => {
    const lv = lvlOf(w.levelId), h = parseFloat(lv.floorToFloor) || 0, L = parseFloat(w.length) || 0;
    const type = w.systemType === 'wswh' ? 'WSWH' : (w.method === 'ftao' ? 'FTAO' : 'Segmented');
    const dl = dlOf(w.wallDLTypeId || w.dlTypeId);
    const notes = [];
    if ((w.openings || []).length) notes.push(w.openings.length + ' opening' + (w.openings.length !== 1 ? 's' : ''));
    if (w.nailingPattern) notes.push('nailing ' + ((NAILING_TABLE.find(n => n.id === w.nailingPattern) || {}).label || w.nailingPattern));
    if (w.anchorageLeftOverride || w.anchorageRightOverride) notes.push('HD/strap ' + (w.anchorageLeftOverride || 'auto') + ' / ' + (w.anchorageRightOverride || 'auto'));
    if (w.postLeftOverride || w.postRightOverride) notes.push('post ' + (w.postLeftOverride || 'auto') + ' / ' + (w.postRightOverride || 'auto'));
    return [w.mark || '?', lv.name || '?', type, String(parseFloat(w.position) || 0), String(L), String(h), L > 0 ? (h / L).toFixed(2) : '—',
      dl ? (dl.name || '') + ' ' + dl.psf + ' psf' : '—', notes.join('; ') || '—'];
  });
}
// Support posts and beams as entered (PDF line section)
export const ELEMENT_DEF_HEADERS = ['Element', 'Type', 'Level', 'Position (ft)', 'Supports / overrides'];
function elementDefinitionRows(inputs, line) {
  const lvl = (id) => ((inputs.levels || []).find(l => l.id === id) || {}).name || '?';
  const rows = (line.supportPosts || []).map(pp => [pp.mark || '?', 'Post', lvl(pp.levelId), String(parseFloat(pp.position) || 0),
    [pp.postOverride && 'post ' + pp.postOverride, pp.anchorageOverride && 'HD/strap ' + pp.anchorageOverride].filter(Boolean).join('; ') || '—']);
  for (const b of line.beams || []) {
    const x0 = parseFloat(b.position) || 0, L = parseFloat(b.length) || 0;
    rows.push([b.mark || '?', 'Beam', lvl(b.levelId), x0 + ' – ' + (x0 + L), (b.supports || []).map(sp => (sp.type === 'post' ? 'post' : 'point') + ' at ' + (parseFloat(sp.position) || 0) + ' ft').join(', ') || 'no supports']);
  }
  return rows;
}

// Gravity load rows of a line as entered (PDF line section)
export const GRAVITY_INPUT_HEADERS = ['Level', '#', 'Shape', 'Position / span (ft)', 'D / L / Lr', 'Flat Load link'];
function gravityInputRows(inputs, line) {
  const rows = [];
  for (const lvl of inputs.levels || []) {
    const loads = (((line.gravityLoads || {})[lvl.id] || {}).loads) || [];
    loads.forEach((ld, i) => {
      const unit = ld.shape === 'point' ? 'k' : ld.perArea ? 'psf × ' + (ld.trib || 0) + ' ft' : 'plf';
      const where = ld.shape === 'point' ? 'x = ' + (ld.position || 0) : ld.shape === 'full' ? 'full line' : (ld.start || 0) + '–' + (ld.end || 0);
      rows.push([lvl.name || '?', String(i + 1), ld.shape || 'partial', where, [ld.D || 0, ld.L || 0, ld.Lr || 0].join(' / ') + ' ' + unit,
        ld.assemblyId ? ld.assemblyId + ' (D = lateral DL)' : '—']);
    });
  }
  return rows;
}

// === Per-line results (shown in each line's tab; the bottom Results section only summarizes) ===

function lineStats(ln) {
  let walls = 0, failing = 0, warned = 0, maxDC = 0;
  for (const pl of ln.perLevel) {
    for (const w of pl.walls) {
      walls++;
      maxDC = Math.max(maxDC, w.dcRatio || 0);
      if (wallFails(w) || !(w.anchorageLeft && w.anchorageRight && w.postLeft && w.postRight)) failing++;
      else if (w.hOverBFlag) warned++;
    }
  }
  const issues = (ln.loadPathAudit && ln.loadPathAudit.warnings.length) || 0;
  const driftRowsE = ((ln.drift && ln.drift.rows) || []).filter(r => r.seismic && r.seismic.pass != null);
  const bypass = ln.driftSizing && ln.driftSizing.mode === 'bypass';
  const drift = !driftRowsE.length ? null : driftRowsE.every(r => r.seismic.pass) ? 'OK' : bypass ? 'NG (bypassed)' : 'NG';
  // distribution warnings (zero-share wall, walls carrying more than designed): a warning, not a failure;
  // the ones an engineer marked reviewed OK no longer count (a stale review counts again)
  const dws = (ln.distribution && ln.distribution.warnings) || [];
  const distWarnings = dws.filter(w => !w.reviewed).length, distReviewed = dws.filter(w => w.reviewed).length;
  // wind drift over its serviceability limit: a warning, never a failure (report only)
  const windDriftNG = ((ln.drift && ln.drift.rows) || []).filter(r => r.wind && r.wind.pass === false).length;
  return { walls, failing, warned, maxDC, issues, drift, checksFailed: ln.checksFailed || 0, distWarnings, distReviewed, windDriftNG };
}

function lineStatusBadge(st) {
  const bad = st.failing > 0 || st.issues > 0 || st.drift === 'NG' || st.checksFailed > 0;
  const text = st.walls + ' wall' + (st.walls !== 1 ? 's' : '')
    + (st.checksFailed ? ' — ' + st.checksFailed + ' equilibrium check' + (st.checksFailed !== 1 ? 's' : '') + ' failed' : '')
    + (st.failing ? ' — ' + st.failing + ' failing' : '')
    + (st.warned ? ' — ' + st.warned + ' h/b warning' : '')
    + (st.distWarnings ? ' — ' + st.distWarnings + ' distribution warning' + (st.distWarnings !== 1 ? 's' : '') : '')
    + (st.distReviewed ? ' — ' + st.distReviewed + ' distribution warning' + (st.distReviewed !== 1 ? 's' : '') + ' reviewed OK by engineer' : '')
    + (st.issues ? ' — ' + st.issues + ' load path issue' + (st.issues !== 1 ? 's' : '') : '')
    + (st.drift === 'NG' ? ' — drift NG' : st.drift === 'NG (bypassed)' ? ' — drift NG (bypassed, report only)' : '')
    + (st.windDriftNG ? ' — wind drift over h/n (report only)' : '')
    + (!bad && !st.warned && !st.distWarnings && !st.windDriftNG && st.drift !== 'NG (bypassed)' ? ' — all passing' : '');
  return el('span', { className: 'badge ' + (bad ? 'badge-fail' : st.warned || st.distWarnings || st.windDriftNG || st.drift === 'NG (bypassed)' ? 'badge-stale' : 'badge-pass') }, text);
}

// Distribution warnings of a line, the under-load one (walls carrying more than designed) first
function distWarningsOf(ln) {
  const ws = (ln.distribution && ln.distribution.warnings) || [];
  return [...ws.filter(w => w.level === 'big'), ...ws.filter(w => w.level !== 'big')];
}
// Banner with the distribution warnings (line results header and Distribution tab); null when none.
// Open warnings are amber with an "Engineer reviewed — OK" button (state.onReview); reviewed ones are shown small with
// the date and an Undo button. A review whose warning has changed since is stale and asks for a new review.
function distWarningBanner(ln, state = {}) {
  const ws = distWarningsOf(ln);
  if (!ws.length) return null;
  const open = ws.filter(w => !w.reviewed), done = ws.filter(w => w.reviewed);
  const wrap = el('div');
  const btn = (label, w, on, primary) => (state.onReview
    ? el('button', { className: 'btn btn-sm ' + (primary ? 'btn-primary' : 'btn-ghost'), type: 'button', style: { marginLeft: '0.5rem' },
      onClick() { state.onReview(w, on); } }, label)
    : null);
  if (open.length) {
    const box = el('div', { style: { border: '2px solid var(--stale)', background: 'var(--stale-bg)', borderRadius: '6px', padding: '0.5rem 0.75rem', margin: '0.35rem 0 0.5rem' } });
    for (const w of open) {
      box.appendChild(el('div', { style: w.level === 'big'
        ? { fontWeight: '700', fontSize: '0.95rem', color: 'var(--stale)', marginBottom: '0.35rem' }
        : { fontSize: '0.85rem', marginBottom: '0.35rem' } },
        '⚠ ' + w.message,
        w.reviewStale ? el('span', { style: { fontWeight: '600', marginLeft: '0.35rem' } }, ' (reviewed ' + (w.reviewDate || '') + ', but the values changed since — review again)') : null,
        btn('Engineer reviewed — OK', w, true, true)));
    }
    wrap.appendChild(box);
  }
  if (done.length) {
    const box = el('div', { style: { border: '1px solid var(--border)', borderRadius: '6px', padding: '0.35rem 0.75rem', margin: '0.35rem 0 0.5rem', fontSize: '0.8rem', color: 'var(--ink-secondary)' } });
    for (const w of done) {
      box.appendChild(el('div', { style: { marginBottom: '0.25rem' } },
        el('span', { className: 'badge badge-pass', style: { marginRight: '0.4rem' } }, '✓ Engineer reviewed — OK' + (w.reviewDate ? ' ' + w.reviewDate : '')),
        w.message, btn('Undo review', w, false, false)));
    }
    wrap.appendChild(box);
  }
  return wrap;
}

const subHead = (text) => el('div', { style: { fontWeight: '500', fontSize: '0.85rem', marginTop: '0.5rem', marginBottom: '0.25rem' } }, rich(text));
const emptyNote = (text) => el('div', { style: { fontSize: '0.85rem', color: 'var(--ink-tertiary)', fontStyle: 'italic', padding: '0.5rem 0' } }, text);

// What sizes a wall's sheathing nailing: strength (lightest pattern carrying the shear), drift (raised until the
// story drift passes), manual (override), or the panel / engine for WSWH
export function sheathingGovernsText(w) {
  if (w.method === 'wswh') return 'WSWH panel';
  if (w.nailingBasis === 'manual') return 'Manual';
  if (w.nailingBasis === 'drift') return 'Drift (strength: ' + ((w.strengthNailing && w.strengthNailing.label) || '?') + ')';
  return 'Strength';
}

// Wall schedule (Walls → Summary and the PDF; user review 2026-10-01): capacity next to the nailing, D/C with v and
// with every HD / strap / post (coloured), T and C at the left / right ends
export const WALL_SCHEDULE_HEADERS = ['Mark', 'Level', 'Nailing (cap)', 'Sheathing governed by', 'v plf (D/C)', 'T_L / T_R (k)', 'C_L / C_R (k)',
  'HD/Strap L (D/C)', 'HD/Strap R (D/C)', 'Post L (D/C)', 'Post R (D/C)', 'Status'];
const OVER = () => dcCell('OVER', 9);
export function wallScheduleRows(pl) {
  return pl.walls.map(w => {
    const lt = w.dcGoverning === 'wind' ? 'W' : 'E';
    const ancDrift = (side) => w.anchorageBasis && w.anchorageBasis[side] && w.anchorageBasis[side].basis === 'drift';
    const hw = (a, dc, side) => (a ? dcCell(a.id + (dc != null ? ' (' + dc.toFixed(2) + ')' : '') + (ancDrift(side) ? ' drift' : ''), dc) : OVER());
    const post = (pp, dc) => (pp ? dcCell(pp.postLabel + (dc != null ? ' (' + dc.toFixed(2) + ')' : ''), dc) : OVER());
    const [tL, tR, cL, cR] = hwT(w);
    const isPanel = w.method === 'wswh';
    const nail = isPanel ? (w.nailing ? w.nailing.label : 'WSWH') + ' — ' + f0(w.wswh.Vcap[lt]) + ' lb'
      : (w.nailing ? w.nailing.label : '?') + (w.effectiveCapacity != null ? ' — ' + w.effectiveCapacity.toFixed(0) + ' plf' : '');
    const v = isPanel ? f0(w.wswh.Vd[lt]) + ' lb' : w.unitShear_ASD.toFixed(0);
    const allPass = w.dcRatio <= 1.0 && w.anchorageLeft && w.anchorageRight && w.postLeft && w.postRight;
    const status = !allPass || wallFails(w) ? dcCell('NG', 9) : w.hOverBFlag ? dcCell('WARN', 0.9) : dcCell('OK', 0);
    return [w.mark + (w.method === 'ftao' ? ' (FTAO)' : isPanel ? ' (WSWH)' : ''), pl.levelName, nail, sheathingGovernsText(w),
      dcCell(v + ' (' + w.dcRatio.toFixed(2) + ')', w.dcRatio), f2(tL) + ' / ' + f2(tR), f2(cL) + ' / ' + f2(cR),
      hw(w.anchorageLeft, w.anchorageDCLeft, 'left'), hw(w.anchorageRight, w.anchorageDCRight, 'right'),
      post(w.postLeft, w.postDCLeft), post(w.postRight, w.postDCRight), status];
  });
}
function wallScheduleTable(pl) { return simpleTable(WALL_SCHEDULE_HEADERS, wallScheduleRows(pl), []); }

// Walls tab. Summary: schedule + overturning summary per level. Detailed: schedule + every wall's
// calc in the style of its type (sheathed / pier, FTAO, WSWH), in wall order.
function lineTabWalls(ln, dirOut, state) {
  const box = el('div');
  const detailed = state.report === 'detailed';
  const toggle = el('div', { style: { display: 'flex', gap: '2px', alignItems: 'center', marginBottom: '0.5rem' } },
    el('span', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginRight: '0.35rem' } }, 'Report:'),
    ...[['summary', 'Summary'], ['detailed', 'Detailed']].map(([k, label]) => el('button', {
      className: 'btn btn-sm' + ((state.report || 'summary') === k ? ' btn-primary' : ''), type: 'button',
      onClick() { if (state.onReport) state.onReport(k); } }, label)));
  box.appendChild(toggle);
  if (!ln.perLevel.some(pl => pl.walls.length)) { box.appendChild(emptyNote('No walls in this line yet.')); return box; }
  if (detailed) { box.appendChild(renderWallTabs(ln, dirOut, state)); return box; }
  for (const pl of ln.perLevel) {
    if (!pl.walls.length) continue;
    box.appendChild(subHead(pl.levelName + ' — story shear ' + pl.storyShear_1E.toFixed(2) + ' k (1.0E)' + (pl.storyShear_1W ? ', ' + pl.storyShear_1W.toFixed(2) + ' k (1.0W)' : '')));
    box.appendChild(wallScheduleTable(pl));
    box.appendChild(el('div', { style: { fontSize: '0.8rem', fontWeight: '500', margin: '0.25rem 0' } }, 'Overturning — loads used for the end forces (ASD governing incl. loads from above)'));
    box.appendChild(simpleTable(OT_SUMMARY_HEADERS, overturningSummaryRows(pl), []));
  }
  if (ln.perLevel.some(pl => pl.walls.some(w => w.method === 'wswh'))) box.appendChild(wswhSection(ln));
  return box;
}

// Strong-Wall panels of a line: panel table, stacked base check, notes
function wswhSection(ln) {
  const box = el('div');
  box.appendChild(subHead('Strong-Wall WSWH panels'));
  box.appendChild(simpleTable(WSWH_HEADERS, wswhRows(ln), [4, 5, 6, 7, 8]));
  const st = wswhStackRows(ln);
  if (st.length) {
    box.appendChild(subHead('Two-story stack — base moment check (C-L-SW26 p. 50 n.8)'));
    box.appendChild(simpleTable(WSWH_STACK_HEADERS, st, [2, 3, 4, 5]));
  }
  const nb = el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '0.5rem', lineHeight: '1.6' } });
  wswhNoteLines(ln).forEach(n => nb.appendChild(el('div', null, 'ⓘ ' + n)));
  box.appendChild(nb);
  return box;
}

// === Distribution of the story shear to the walls ===
const LT_NAME = { E: '1.0E (seismic)', W: '1.0W (wind)' };
const wallTypeOf = (w) => (w.method === 'wswh' ? 'WSWH' : w.method === 'ftao' ? 'FTAO' : 'Segmented');
const loadTypesOf = (ln) => ['E', 'W'].filter(lt => ln.perLevel.some(pl => (lt === 'E' ? pl.storyShear_1E : pl.storyShear_1W) > 0));
const shareOf = (w, lt) => (lt === 'E' ? w.shareExact_1E : w.shareExact_1W) || 0;

export const CAP_DIST_HEADERS = ['Wall', 'Type', 'L (ft)', 'Capacity basis (ASD)', 'Weight = cap × L (lb)', 'Relative stiffness = weight / Σ', 'V (k)'];
// Distribution table headers with the load case in the V column (user 2026-10-01: V 1.0E / 1.0W)
export const capDistHeaders = (lt) => CAP_DIST_HEADERS.slice(0, 6).concat('V_{1.0' + lt + '} (k)');
export const deflDistHeaders = (lt) => DEFL_DIST_HEADERS.slice(0, 5).concat('V_{1.0' + lt + '} (k)');
// Capacity method (SDPWS 4.3.3.4.1): V_i = V × weight_i / Σ weight
export function capacityDistRows(pl, lt) {
  const V = lt === 'E' ? pl.storyShear_1E : pl.storyShear_1W;
  const tot = pl.walls.reduce((a, w) => a + ((w.capWeight || {})[lt] || 0), 0);
  const rows = pl.walls.map(w => {
    const wt = (w.capWeight || {})[lt] || 0;
    let basis;
    if (w.hbNotPermitted) basis = 'h/b ' + w.hOverB + ' > 3.5 — not a shear wall';
    else if (w.method === 'wswh') basis = w.wswh.ok ? (w.wswh.role === 'stackedLower' ? 'V₀ ' : 'V_allow ') + f0(w.wswh.Vcap[lt]) + ' lb (' + w.wswh.evalModel + ')' : 'not tabulated — no shear';
    else if (w.method === 'ftao') basis = 'FTAO engine V_cap,ASD, ' + (w.nailing ? w.nailing.label : '');
    else {
      const cap = lt === 'E' ? w.seismicCap : w.windCap, rf = w.hbReductionFactor || 1;
      basis = (w.nailing ? w.nailing.label : '') + ': ' + cap + ' plf' + (rf < 1 ? ' × h/b ' + rf.toFixed(3) + ' = ' + f0(cap * rf) + ' plf' : '');
    }
    return [w.mark, wallTypeOf(w), w.length.toFixed(2), basis, f0(wt), tot > 0 ? (wt / tot * 100).toFixed(1) + '%' : '—', f2(shareOf(w, lt))];
  });
  rows.push({ cells: ['Σ', '', '', 'story shear V = ' + f2(V) + ' k', f0(tot), tot > 0 ? '100%' : '—', f2(pl.walls.reduce((a, w) => a + shareOf(w, lt), 0))], style: { fontWeight: '600' } });
  return rows;
}

// δ at zero own share and k = V/δ removed (user 2026-10-01); δ(0) stays in the zero-share warning and in G3
export const DEFL_DIST_HEADERS = ['Wall', 'Type', 'δ at its share — SDPWS Eq. 4.3-1, 1.0 level (end forces own + from above)', 'δ at share (in)', 'Relative stiffness = V_{i} / V', 'V (k)'];
// Stiffness basis of a wall for the deflection method
function stiffnessBasis(w, lt) {
  if (w.hbNotPermitted) return 'not a shear wall';
  if (w.method === 'wswh') return w.wswh.ok ? 'WSWH table: δ(V) = Δ_LRFD ' + f2(w.wswh.DcapL[lt]) + ' in × V / V_LRFD ' + f0(w.wswh.VcapL[lt]) + ' lb'
    + (w.wswh.role === 'stackedLower' ? ' (stacked base: × M / M_allow,LRFD, upper panel held)' : '') : 'not tabulated';
  if (w.method === 'ftao') return 'FTAO engine: δ(V) = SDPWS Eq. 4.3-1 over the APA T555 pier cases (average), 1.0 level';
  const d = (w.stiffnessDefl || {})[lt];
  if (!d) return '— (no deflection: missing post / nailing Ga)';
  const g = d.dirs.reduce((a, b) => (b.delta > a.delta ? b : a));
  return 'Eq. 4.3-1, v = ' + d.v + ' plf, Ga ' + d.Ga + ' k/in, A ' + d.A + ' in²: 8vh³/EAb ' + f4(g.t1) + ' + vh/1000Ga ' + f4(g.t2)
    + ' + hΔa/b ' + f4(g.t3) + ' (Δa = HD slip ' + f4(g.dHD) + ' + crushing ' + f4(g.dC) + ') = ' + f3(g.delta) + ' in (' + g.dir + ')';
}
// dist = the line's distribution result (story δ*, each wall's δ at zero own share); optional
export function deflectionDistRows(pl, lt, dist) {
  const lvl = ((dist && dist.levels) || []).find(l => l.levelId === pl.levelId && l.loadType === lt);
  const V = lt === 'E' ? pl.storyShear_1E : pl.storyShear_1W;
  const rows = pl.walls.map(w => {
    const dS = ((w.deltaShare || {})[lt]) || 0, Vw = shareOf(w, lt);
    const lw = lvl && lvl.walls.find(x => x.wallId === w.wallId);
    const zero = lw && lw.zeroShare;
    // free split (no V ≥ 0 limit, information only) where the story has a zero-share wall
    const free = lw && lw.freeShare != null ? ' (free ' + f2(lw.freeShare) + ')' : '';
    return [w.mark, wallTypeOf(w), stiffnessBasis(w, lt), zero ? 'no share (see warning)' : dS > 0 ? f3(dS) : '—',
      V > 0 ? (100 * Vw / V).toFixed(1) + '%' : '—', f2(Vw) + free];
  });
  const freeTxt = lvl && lvl.free ? '; free split (shares without the V ≥ 0 limit, not used for design): δ = ' + f3(lvl.free.delta) + ' in' : '';
  rows.push({ cells: ['Σ', '', 'story δ* = ' + (lvl ? f3(lvl.delta) + ' in (every wall with a share)' : '—') + '; story shear V = ' + f2(V) + ' k' + freeTxt, '', V > 0 ? '100%' : '—',
    f2(pl.walls.reduce((a, w) => a + shareOf(w, lt), 0))], style: { fontWeight: '600' } });
  return rows;
}

// Holdown / strap check of each zero-share wall at a level (estimate: other walls held, set the override to confirm)
export const REMEDY_HEADERS = ['Wall', 'Holdown / strap (both ends)', 'Post', 'δ at zero own share (in)', 'Share it would take (k)'];
export function remedyRows(pl, lt, dist) {
  const lvl = ((dist && dist.levels) || []).find(l => l.levelId === pl.levelId && l.loadType === lt);
  if (!lvl) return [];
  return lvl.walls.filter(w => w.zeroShare && w.remedy).flatMap(w => (w.remedy.length ? w.remedy.map(r => [w.mark, r.anchorage, r.post, f3(r.delta0), f2(r.share)])
    : [[w.mark, 'no larger holdown / strap in the catalog', '', '', '']]));
}
function distributionIntro(ln) {
  const d = ln.distribution;
  if (d && d.method === 'deflection') {
    return 'Deflection method: walls at a level deflect equally (rigid diaphragm). Each wall\'s δ is SDPWS Eq. 4.3-1 at its share, with its end forces (own + from the walls above) as in the rest of the calc; the shares are the ones where every wall gives the same δ* and Σ V = the story shear. A wall that the forces from above already displace more than δ* takes no share (noted). The line is recalculated until the shares stop moving (0.001 k). Shown: the final split — ' + distributionText(ln) + '.';
  }
  return 'Capacity method (SDPWS 4.3.3.4.1): each wall takes V × weight_i / Σ weight, weight = ASD unit shear capacity × length (h/b factor applied; FTAO: engine V_cap,ASD; WSWH: tabulated V_allow).';
}
function lineTabDistribution(ln, state = {}) {
  const box = el('div');
  box.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '0.5rem' } }, distributionIntro(ln)));
  const defl = ln.distribution && ln.distribution.method === 'deflection';
  const banner = distWarningBanner(ln, state);
  if (banner) box.appendChild(banner);
  let any = false;
  for (const pl of ln.perLevel) {
    if (!pl.walls.length) continue;
    for (const lt of loadTypesOf(ln)) {
      any = true;
      box.appendChild(subHead(pl.levelName + ' — ' + LT_NAME[lt] + ', V = ' + f2(lt === 'E' ? pl.storyShear_1E : pl.storyShear_1W) + ' k'));
      box.appendChild(defl ? detailTable(deflDistHeaders(lt), deflectionDistRows(pl, lt, ln.distribution)) : detailTable(capDistHeaders(lt), capacityDistRows(pl, lt)));
      const rem = defl ? remedyRows(pl, lt, ln.distribution) : [];
      if (rem.length) {
        box.appendChild(subHead(pl.levelName + ' — holdown check of the zero-share wall (estimate: other walls held; set the override and recalculate to confirm)'));
        box.appendChild(detailTable(REMEDY_HEADERS, rem));
      }
    }
  }
  if (!any) box.appendChild(emptyNote('No story shear in this line.'));
  return box;
}
// PDF sections of the distribution tables of a line
function distributionSections(ln, prefix) {
  const out = [{ title: prefix + ' — Shear distribution', text: distributionIntro(ln) }];
  const defl = ln.distribution && ln.distribution.method === 'deflection';
  for (const pl of ln.perLevel) {
    if (!pl.walls.length) continue;
    for (const lt of loadTypesOf(ln)) {
      const rows = (defl ? deflectionDistRows(pl, lt, ln.distribution) : capacityDistRows(pl, lt)).map(r => r.cells || r);
      out.push({ title: prefix + ' — ' + pl.levelName + ', ' + LT_NAME[lt] + ', V = ' + f2(lt === 'E' ? pl.storyShear_1E : pl.storyShear_1W) + ' k',
        table: { headers: defl ? deflDistHeaders(lt) : capDistHeaders(lt), rows, colWidths: defl ? [0.07, 0.11, 0.46, 0.12, 0.12, 0.12] : [0.07, 0.11, 0.07, 0.37, 0.13, 0.13, 0.12] } });
      const rem = defl ? remedyRows(pl, lt, ln.distribution) : [];
      if (rem.length) out.push({ title: prefix + ' — ' + pl.levelName + ', ' + LT_NAME[lt] + ' — holdown check of the zero-share wall (estimate)', table: { headers: REMEDY_HEADERS, rows: rem } });
    }
  }
  return out;
}

// === Overturning: the loads used for the end forces of each wall ===
const OT_SUMMARY_HEADERS = ['Wall', 'V 1.0E / W (k)', 'OTM 1.0 = V·h (k·ft)', 'R_D L / R (k)', 'R_L L / R (k)', 'R_Lr L / R (k)', 'ASD T L / R (k)', 'ASD C L / R (k)', 'Governing LC T / C'];
const pairTxt = (a, b) => f2(a) + ' / ' + f2(b);
// Name of the combination giving the largest value of a field over the ASD group
function governingCombo(w, field) {
  const src = w.accumPerCombo || w.combos || {};
  let best = null, v = 0;
  for (const [k, c] of Object.entries(src)) {
    const g = (w.combos && w.combos[k] && w.combos[k].group) || c.group;
    if (g !== 'asd' || !((c[field] || 0) > v)) continue;
    v = c[field]; best = k;
  }
  if (!best) return '—';
  return lcRef(w.combos, best);
}
function hwT(w) { return w.hwDemand ? [w.hwDemand.tL, w.hwDemand.tR, w.hwDemand.cL, w.hwDemand.cR] : [w.governingTensionLeft, w.governingTensionRight, w.governingComprLeft, w.governingComprRight]; }
function overturningSummaryRows(pl) {
  return pl.walls.map(w => {
    const st = w.steps || {}, lv = w.live || { L: {}, Lr: {} };
    const [tL, tR, cL, cR] = hwT(w);
    const gT = tL >= tR ? governingCombo(w, 'tensionLeft') : governingCombo(w, 'tensionRight');
    const gC = cL >= cR ? governingCombo(w, 'comprLeft') : governingCombo(w, 'comprRight');
    return [w.mark + (w.hwDemand ? ' Σ' : ''), pairTxt(w.share_1E, w.share_1W), pairTxt(st.otm1E, st.otm1W), pairTxt(w.dlRL, w.dlRR),
      pairTxt(lv.L.rL, lv.L.rR), pairTxt(lv.Lr.rL, lv.Lr.rR), pairTxt(tL, tR), pairTxt(cL, cR), gT + ' / ' + gC];
  });
}
// Detailed rows: [label, value]
function overturningRows(w) {
  const st = w.steps || {};
  const rows = [];
  const panel = w.method === 'wswh';
  rows.push(['Lateral share (1.0)', 'V_E = ' + f2(w.share_1E) + ' k' + (w.share_1W ? ', V_W = ' + f2(w.share_1W) + ' k' : '')]);
  rows.push(['Height / arm', panel ? 'h = H_e = ' + f2(w.wswh.He) + ' in, arm = B = ' + w.wswh.B + ' in' : 'h = ' + f2(w.floorH) + ' ft (floor-to-floor), arm = L = ' + f2(w.length) + ' ft']);
  rows.push(['OTM at the 1.0 level', 'E: ' + f2(st.otm1E) + ' k·ft' + (st.otm1W ? ', W: ' + f2(st.otm1W) + ' k·ft' : '') + (panel && w.wswh.role === 'stackedLower' ? ' (stack base: V₁·H₁ + V₂·(H₁ + d_fl + H₂))' : ' (= V·h)')]);
  rows.push(['ASD OTM (design)', (st.seismic ? '0.7ρ·OTM_E = ' + f2(st.seismic.otm) + ' k·ft' : '') + (st.wind ? (st.seismic ? '; ' : '') + '0.6·OTM_W = ' + f2(st.wind.otm) + ' k·ft' : '')]);
  const lv = w.live || { L: {}, Lr: {} };
  rows.push(['Resisting end reactions', 'R_D ' + pairTxt(w.dlRL, w.dlRR) + ', R_L ' + pairTxt(lv.L.rL, lv.L.rR) + ', R_Lr ' + pairTxt(lv.Lr.rL, lv.Lr.rR) + ' k (L / R)']);
  rows.push(['This wall, governing ASD', 'T ' + pairTxt(w.governingTensionLeft, w.governingTensionRight) + ' k, C ' + pairTxt(w.governingComprLeft, w.governingComprRight) + ' k']);
  for (const src of w.injections || []) {
    rows.push(['Load from above', src.label + ' → ' + (src.side === 'left' ? 'left' : 'right') + ' end: ASD T ' + f2(src.env && src.env.T) + ' / C ' + f2(src.env && src.env.C) + ' k']);
  }
  const [tL, tR, cL, cR] = hwT(w);
  rows.push(['Hardware / post demand', 'T ' + pairTxt(tL, tR) + ' k, C ' + pairTxt(cL, cR) + ' k' + (w.hwDemand ? ' (Σ incl. loads from above)' : '')
    + ' — T: ' + (tL >= tR ? governingCombo(w, 'tensionLeft') : governingCombo(w, 'tensionRight')) + '; C: ' + (cL >= cR ? governingCombo(w, 'comprLeft') : governingCombo(w, 'comprRight'))]);
  return rows;
}
function overturningDetail(w) {
  const box = el('div');
  box.appendChild(el('div', { style: { fontWeight: '600', marginTop: '0.35rem' } }, 'Overturning — loads used for the end forces'));
  for (const [k, v] of overturningRows(w)) {
    box.appendChild(el('div', null, el('span', { style: { display: 'inline-block', minWidth: '170px', color: 'var(--ink-tertiary)' } }, k + ':'), v));
  }
  return box;
}

// === Posts & Beams tab (replaces the Load path tab, user 2026-10-01) ===
// Combo metadata of a line (group / LC# per stored key) from any wall's combos
function lineCombos(ln) {
  for (const pl of ln.perLevel) for (const w of pl.walls) if (w.combos) return w.combos;
  return {};
}
// ASD envelope of a signed per-combo map (+ = compression): largest T and C with the LC# that gives each
function asdEnvelope(map, combos) {
  let T = 0, C = 0, tKey = null, cKey = null;
  for (const [k, v] of Object.entries(map || {})) {
    if (!combos[k] || combos[k].group !== 'asd') continue;
    if (-v > T) { T = -v; tKey = k; }
    if (v > C) { C = v; cKey = k; }
  }
  return { T, C, tLC: tKey ? lcRef(combos, tKey) : '—', cLC: cKey ? lcRef(combos, cKey) : '—' };
}
// Hardware schedule of the isolated posts and the beam supports: they have HD / strap (and posts) like the walls
export const POSTS_BEAMS_HEADERS = ['Element', 'Level', 'x (ft)', 'ΣT (k) — LC', 'ΣC (k) — LC', 'Base HD/Strap (D/C)', 'Post (D/C)', 'Lands on'];
export function postsBeamsRows(ln) {
  const combos = lineCombos(ln), rows = [];
  const hd = (item) => {
    const r = item.receiver;
    if (!r || !['beam', 'post', 'wall_end', 'foundation'].includes(r.type)) return '— (no connection)';
    return item.anchorage ? dcCell(item.anchorage.id + (item.anchorageDC != null ? ' (' + item.anchorageDC.toFixed(2) + ')' : ''), item.anchorageDC) : OVER();
  };
  for (const pp of ln.postPaths || []) {
    const e = asdEnvelope(pp.perCombo, combos);
    rows.push([pp.mark + ' (post)', pp.levelName, pp.position.toFixed(2), f2(e.T) + ' — ' + e.tLC, f2(e.C) + ' — ' + e.cLC, hd(pp),
      pp.post ? dcCell(pp.post.postLabel + (pp.postDC != null ? ' (' + pp.postDC.toFixed(2) + ')' : '') + (pp.postGoverns === 'Ω₀ ASD' ? ' Ω_{0} ASD' : ''), pp.postDC) : OVER(),
      fmtReceiver(pp.receiver)]);
  }
  for (const bt of ln.beamTransfers || []) {
    if (!bt.supports.length) { rows.push([bt.mark + ' (beam)', bt.levelName, '—', '—', '—', '—', '—', 'Needs 2 valid supports']); continue; }
    bt.supports.forEach((sp, i) => {
      const e = asdEnvelope(sp.perCombo, combos);
      rows.push([bt.mark + (i === 0 ? ' L' : ' R') + ' support (' + (sp.type === 'post' ? 'post' : 'point') + ')', bt.levelName, sp.position.toFixed(2),
        f2(e.T) + ' — ' + e.tLC, f2(e.C) + ' — ' + e.cLC, hd(sp), sp.type === 'post' ? 'see the post below' : '—', fmtReceiver(sp.receiver)]);
    });
  }
  return rows;
}
// "Not carried" gravity notes collapse into one line (carried by framing outside this line — not checked here)
export function notCarriedSummary(notes) {
  const nc = (notes || []).filter(n => n.type === 'gravity_unsupported');
  if (!nc.length) return null;
  return nc.length + ' gravity load' + (nc.length !== 1 ? 's are' : ' is') + ' carried by framing outside this line (no wall, beam or post below) — not checked here: '
    + nc.map(n => n.message.replace(/ — .*$/, '')).join('; ');
}
function lineTabPostsBeams(ln) {
  const box = el('div');
  let any = false;
  const pb = postsBeamsRows(ln);
  if (pb.length) {
    any = true;
    box.appendChild(subHead('Isolated posts and beam supports — hardware (ASD envelope, governing LC#)'));
    box.appendChild(simpleTable(POSTS_BEAMS_HEADERS, pb, [2]));
  }
  if (ln.wallDeliveries && ln.wallDeliveries.some(d => d.receiver.type !== 'foundation')) {
    any = true;
    box.appendChild(subHead('Wall ends that land on a wall, post or beam (not the foundation)'));
    box.appendChild(simpleTable(WALL_END_HEADERS, wallEndRows(ln), [3, 4]));
  }
  const audit = ln.loadPathAudit;
  if (audit && audit.warnings.length) {
    any = true;
    box.appendChild(el('div', { style: { fontWeight: '500', fontSize: '0.85rem', marginTop: '0.5rem', marginBottom: '0.25rem' } },
      el('span', { className: 'badge badge-fail', style: { marginRight: '0.5rem' } }, audit.warnings.length + ' load path issue' + (audit.warnings.length !== 1 ? 's' : ''))));
    const atbl = el('table', { className: 'data-table', style: { fontSize: '0.85rem' } });
    atbl.appendChild(el('tr', null, el('th', null, 'Element'), el('th', null, 'Level'), el('th', null, 'Issue')));
    for (const w of audit.warnings) {
      atbl.appendChild(el('tr', null, el('td', { className: 'mono' }, w.elementMark), el('td', null, w.levelName), el('td', { style: { color: 'var(--fail)' } }, w.message)));
    }
    box.appendChild(el('div', { className: 'table-scroll', style: { marginBottom: '0.75rem' } }, atbl));
  } else if (audit && audit.allClear && any) {
    box.appendChild(el('div', { style: { marginBottom: '0.5rem' } }, el('span', { className: 'badge badge-pass' }, 'All load paths verified')));
  }
  if (audit && audit.notes && audit.notes.length) {
    any = true;
    const nbox = el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '0.75rem' } });
    const nc = notCarriedSummary(audit.notes);
    if (nc) nbox.appendChild(el('div', null, 'ⓘ ' + nc));
    audit.notes.filter(n => n.type !== 'gravity_unsupported').forEach(n => nbox.appendChild(el('div', null, 'ⓘ ' + n.message)));
    box.appendChild(nbox);
  }
  if (ln.beamTransfers && ln.beamTransfers.length) {
    const det = el('details', { style: { marginTop: '0.5rem' } }, el('summary', { style: { cursor: 'pointer', fontSize: '0.85rem' } }, 'Transfer beams — loads, reactions and lever tables'));
    det.appendChild(simpleTable(BEAM_HEADERS, beamSupportRows(ln), [2, 3, 5, 6]));
    const bl = beamLoadRows(ln);
    if (bl.length) {
      det.appendChild(subHead('Loads on the transfer beams (reactions by statics at the 2 supports; member design deferred)'));
      det.appendChild(simpleTable(BEAM_LOAD_HEADERS, bl, [1]));
    }
    for (const bt of ln.beamTransfers) {
      const t = beamLeverTable(bt);
      if (!t) continue;
      det.appendChild(subHead(bt.mark + ' lever table — reactions by statics, per load case (x_a = ' + f2(t.xa) + ' ft, x_b = ' + f2(t.xb) + ' ft, + = compression)'));
      det.appendChild(detailTable(t.headers, t.rows));
    }
    box.appendChild(det);
  }
  if (!any) box.appendChild(emptyNote('No isolated posts or beams, and every wall end lands on the foundation or on an aligned wall end below — nothing to show here.'));
  return box;
}

// === Forces tab (replaces LRFD and Ω₀, user 2026-10-01): T / C at each end for one LC# or load case, or the ASD envelope ===
export const FORCES_HEADERS = ['Element', 'Level', 'End', 'T (k)', 'C (k)', 'HD / Strap', 'Cap (k)', 'D/C'];
export function forceOptions(ln) {
  const combos = lineCombos(ln), keys = Object.keys(combos);
  const groups = [['asd', 'ASD (design)'], ['lrfd', 'LRFD (forces only)'], ['asd_omega', 'Ω₀ ASD (forces only)'], ['lrfd_omega', 'Ω₀ LRFD (forces only)'], ['load_case', 'Load cases']];
  return groups.map(([g, label]) => ({ label, options: keys.filter(k => combos[k].group === g).map(k => [k, g === 'load_case' ? k : lcRef(combos, k) + '  ' + (combos[k].text || '')]) }))
    .filter(g => g.options.length);
}
export function forcesRows(ln, key) {
  const combos = lineCombos(ln), env = !key || key === 'governing';
  const group = env ? 'asd' : (combos[key] || {}).group;
  const capOf = (a) => (!a ? null : group === 'asd' ? a.cap / 1000 : group === 'lrfd' ? (lrfdCap(a) != null ? lrfdCap(a) / 1000 : null) : null);
  const rows = [];
  const push = (mark, level, end, T, C, a, tLC, cLC) => {
    const cap = capOf(a), dc = cap > 0 && T > 0 ? T / cap : null;
    rows.push([mark, level, end, f2(T) + (env && tLC ? ' — ' + tLC : ''), f2(C) + (env && cLC ? ' — ' + cLC : ''), a ? a.id : '—',
      cap != null ? f2(cap) : group === 'lrfd' && a ? 'no LRFD value' : group === 'asd' ? '—' : 'forces only', dc != null ? dcCell(dc.toFixed(2), dc) : '—']);
  };
  // walls: accumulated end forces (own + from above) at each end
  for (const pl of ln.perLevel) for (const w of pl.walls) {
    const acc = w.accumPerCombo || w.combos || {};
    for (const side of ['left', 'right']) {
      const S = side === 'left' ? 'Left' : 'Right', a = side === 'left' ? w.anchorageLeft : w.anchorageRight;
      if (env) {
        let T = 0, C = 0, tk = null, ck = null;
        for (const [k, c] of Object.entries(acc)) {
          if (!combos[k] || combos[k].group !== 'asd') continue;
          const t = c['tension' + S] || 0, cc = c['compr' + S] || 0;
          if (t > T) { T = t; tk = k; }
          if (cc > C) { C = cc; ck = k; }
        }
        push(w.mark, pl.levelName, S, T, C, a, tk ? lcRef(combos, tk) : '—', ck ? lcRef(combos, ck) : '—');
      } else {
        const c = acc[key] || {};
        push(w.mark, pl.levelName, S, c['tension' + S] || 0, c['compr' + S] || 0, a);
      }
    }
  }
  const signed = (mark, level, end, map, a) => {
    if (env) { const e = asdEnvelope(map, combos); push(mark, level, end, e.T, e.C, a, e.tLC, e.cLC); return; }
    const v = (map || {})[key] || 0;
    push(mark, level, end, Math.max(0, -v), Math.max(0, v), a);
  };
  for (const pp of ln.postPaths || []) signed(pp.mark + ' (post)', pp.levelName, 'Base', pp.perCombo, pp.anchorage);
  for (const bt of ln.beamTransfers || []) bt.supports.forEach((sp, i) => signed(bt.mark, bt.levelName, (i === 0 ? 'L' : 'R') + ' support', sp.perCombo, sp.anchorage));
  return rows;
}
function lineTabForces(ln, state = {}) {
  const box = el('div');
  const key = state.forcesKey || 'governing';
  const sel = el('select', { className: 'form-select', style: { width: 'auto', maxWidth: '100%' }, onChange(e) { if (state.onForcesKey) state.onForcesKey(e.target.value); } });
  sel.appendChild(el('option', { value: 'governing', selected: key === 'governing' }, 'ASD envelope (governing LC# per value)'));
  for (const g of forceOptions(ln)) {
    const og = el('optgroup', { label: g.label });
    g.options.forEach(([k, label]) => og.appendChild(el('option', { value: k, selected: k === key }, label)));
    sel.appendChild(og);
  }
  box.appendChild(el('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' } },
    el('span', { style: { fontSize: '0.85rem' } }, 'Load combination:'), sel));
  box.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '0.35rem' } },
    'End forces = the LC factors × the 1.0-level loads, own + from the walls above (T = uplift, C = compression). Cap / D/C: ASD cap for ASD LCs, LRFD cap of the hardware table (reported only, never a design check) for LRFD LCs; Ω₀ LCs and load cases are forces only. LC# definitions: Summary / Config → Load Combinations.'));
  const rows = forcesRows(ln, key);
  if (!rows.length) box.appendChild(emptyNote('No walls, posts or beams in this line yet.'));
  else box.appendChild(simpleTable(FORCES_HEADERS, rows, [3, 4, 6]));
  return box;
}

// Drift summary (user 2026-10-01; also in the Summary PDF): one row per story and load type
export const DRIFT_SUMMARY_HEADERS = ['Level', 'h_sx (ft)', 'Governing wall', 'δ_xe (in)', 'δ_x = C_d·δ_xe/I_e (in)', 'Δ_a (in)', 'δ_x / Δ_a', 'Status', 'Sizing applied'];
export function driftSummaryRows(ln) {
  const d = ln.drift;
  if (!d) return [];
  const bypass = ln.driftSizing && ln.driftSizing.mode === 'bypass';
  const log = (ln.driftSizing && ln.driftSizing.log) || [];
  const rows = [];
  for (const r of d.rows) {
    const steps = log.filter(l => l.levelName === r.levelName).map(l => l.detail);
    if (r.seismic) {
      const sx = r.seismic, ratio = sx.allowable > 0 ? sx.deltaX / sx.allowable : null;
      rows.push([r.levelName + ' (seismic)', f2(r.hsx), sx.wallMark, f3(sx.deltaXE), f3(sx.deltaX), sx.allowable != null ? f3(sx.allowable) : '—',
        ratio != null ? dcCell(ratio.toFixed(2), ratio) : '—',
        sx.pass == null ? '— (no limit: risk category missing)' : sx.pass ? dcCell('OK', 0) : bypass ? dcCell('NG (bypassed)', 0.9) : dcCell('NG', 9),
        steps.length ? steps.join('; ') : '—']);
    }
  }
  return rows;
}

// Wind drift (service level, α_s × 1.0W) against the serviceability limit h_sx / n — report only (user 2026-10-01)
export const WIND_DRIFT_HEADERS = ['Level', 'h_sx (ft)', 'Governing wall', 'δ_w = α_s·δ(1.0W) (in)', 'Δ_allow = h_sx·12 / n (in)', 'δ_w / Δ_allow', 'Status'];
export function windDriftRows(ln) {
  const d = ln.drift;
  if (!d) return [];
  return d.rows.filter(r => r.wind).map(r => {
    const w = r.wind, ratio = w.allowable > 0 ? w.delta / w.allowable : null;
    return [r.levelName, f2(r.hsx), w.wallMark, f3(w.delta), w.allowable != null ? f3(w.allowable) + ' (h/' + w.limitDen + ')' : '—',
      ratio != null ? dcCell(ratio.toFixed(2), ratio) : '—', w.pass == null ? '—' : w.pass ? dcCell('OK', 0) : dcCell('NG (report only)', 0.9)];
  });
}

// Drift tab: the summary on top, the sizing steps / calcs / wall deflections in a collapsed Details block
function lineTabDrift(ln) {
  const box = el('div');
  if (!driftSummaryRows(ln).length && !windDriftRows(ln).length) {
    // nothing computed: say why (e.g. wind without α_s) instead of implying the walls carry no shear
    const carries = ln.perLevel.some(pl => (pl.storyShear_1E || 0) > 0 || (pl.storyShear_1W || 0) > 0);
    if (ln.drift && ln.drift.missing) box.appendChild(el('div', { style: { fontSize: '0.85rem', color: 'var(--stale, #b7791f)', margin: '0.25rem 0 0.5rem' } }, 'ⓘ No story drift: ' + ln.drift.missing + '.'));
    else box.appendChild(emptyNote(carries ? 'No story drift computed (no wall deflection available — check that every wall has nailing, hardware and posts).' : 'No deflection results (no walls carrying shear).'));
    return box;
  }
  const sRows = driftSummaryRows(ln), wRows = windDriftRows(ln);
  if (sRows.length) {
    box.appendChild(subHead('Story drift — seismic (ASCE 7-22 §12.8.6, Table 12.12-1)'));
    box.appendChild(simpleTable(DRIFT_SUMMARY_HEADERS, sRows, [1, 3, 4, 5]));
  }
  if (wRows.length) {
    box.appendChild(subHead('Story drift — wind, service level (limit h_{sx} / ' + ((ln.drift && ln.drift.windLimitDen) || 400) + ', report only)'));
    box.appendChild(simpleTable(WIND_DRIFT_HEADERS, wRows, [1, 3, 4]));
  }
  if (ln.drift && ln.drift.missing) box.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--stale, #b7791f)', marginBottom: '0.5rem' } }, 'ⓘ ' + ln.drift.missing + '.'));
  // T above the LRFD cap (Δa extrapolated beyond its LRFD pair): warning sign only (no NG, no upsizing; user 2026-10-13)
  for (const wn of ln.deflWarnings || []) box.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--stale, #b7791f)', marginBottom: '0.25rem' } }, '⚠ ' + wn.message + (wn.levelName ? ' (' + wn.levelName + ')' : '') + '.'));
  const details = el('details', { style: { marginTop: '0.25rem' } },
    el('summary', { style: { cursor: 'pointer', fontSize: '0.85rem' } }, 'Details — drift sizing steps, drift calcs, wall deflections'));
  driftDetails(ln, details);
  box.appendChild(details);
  return box;
}

function driftDetails(ln, box) {
  const dr = driftRows(ln);

  const ds = ln.driftSizing;
  if (ds) {
    const bad = ds.mode === 'check' && ds.ngLevels.length;
    box.appendChild(el('div', { style: { fontSize: '0.8rem', marginBottom: '0.5rem', color: bad ? 'var(--fail)' : ds.mode === 'bypass' ? 'var(--stale, #b7791f)' : 'var(--ink-secondary)' } },
      el('strong', null, ds.mode === 'bypass' ? 'Drift check: bypassed. ' : 'Drift check: on — at each failing story, the step that cuts the governing wall’s δ more is applied (nailing for the story, or that wall’s holdown / strap one size up) until every story passes. '),
      ds.note || 'Strength governs every wall (no drift upsizing needed).'));
    if (ds.log && ds.log.length) {
      box.appendChild(subHead('Drift sizing steps — estimated Δδ of the governing wall (Eq. 4.3-1 terms)'));
      box.appendChild(simpleTable(['Step', 'Level', 'Governing wall', 'δx (in)', 'Δa (in)', 'Δδ nailing (in)', 'Δδ HD / strap (in)', 'Applied'],
        ds.log.map((l, i) => [String(i + 1), l.levelName, l.mark, l.deltaX != null ? l.deltaX.toFixed(3) : '—', l.allowable != null ? l.allowable.toFixed(3) : '—',
          l.saveNailing != null ? l.saveNailing.toFixed(4) : 'n/a', l.saveAnchorage != null ? l.saveAnchorage.toFixed(4) : 'n/a', l.detail]), [3, 4, 5, 6]));
      box.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '0.5rem' } },
        'Δδ nailing = vh/(1000·Ga)·(1 − Ga/Ga,new); Δδ HD / strap = (h/b)·T·(δ_LRFD/T_LRFD − δ_LRFD,new/T_LRFD,new), taken only when the larger size is stiffer (lower δ_LRFD/T_LRFD). n/a = step not available (manual, override, heaviest / largest size, OVER). The line is recalculated after each step.'));
    }
  }
  if (dr.length) {
    box.appendChild(subHead('Seismic story drift (C_d, I_e)'));
    box.appendChild(simpleTable(DRIFT_HEADERS, dr, [1, 2, 4, 5, 6]));
  }
  const dc = driftCalcRows(ln);
  if (dc.length) {
    box.appendChild(subHead('Drift calc — numbers substituted'));
    box.appendChild(detailTable(DRIFT_CALC_HEADERS, dc));
  }
  const wd = wallDeflectionRows(ln);
  if (wd.length) {
    box.appendChild(subHead('Wall deflections (SDPWS Eq. 4.3-1 terms)'));
    box.appendChild(simpleTable(WALL_DEFL_HEADERS, wd, [2, 3, 4, 5, 6, 7, 8]));
  }
  const d = ln.distribution;
  if (d && d.method === 'deflection' && d.spreadRows && d.spreadRows.length) {
    box.appendChild(subHead('Deflection distribution — δ spread per level'));
    box.appendChild(simpleTable(['Level', 'Case', 'δmax (in)', 'δmin (in)', 'Spread', 'Walls'],
      d.spreadRows.map(r => [r.levelName, r.loadType === 'E' ? '1.0E' : '1.0W', r.deltaMax.toFixed(3), r.deltaMin.toFixed(3), (r.spread * 100).toFixed(1) + '%', r.maxMark + ' / ' + r.minMark]), [2, 3, 4]));
  }
  return box;
}

function lineTabLrfd(ln) {
  const box = el('div');
  const lr = lrfdRows(ln);
  if (!lr.length) { box.appendChild(emptyNote('No LRFD forces.')); return box; }
  box.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '0.35rem' } },
    'ASCE 7-22 §2.3.6 combinations, reported as forces only (e.g. for foundations); all design checks are ASD. LRFD caps (holdowns and straps) come from the hardware tables and are reported only.'));
  box.appendChild(simpleTable(LRFD_HEADERS, lr, [2, 3, 4, 5]));
  return box;
}

function lineTabOmega(ln) {
  const box = el('div');
  const rows = omegaRows(ln);
  if (!rows.length) { box.appendChild(emptyNote('No Ω₀ forces (seismic load type only).')); return box; }
  box.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '0.35rem' } }, OMEGA_NOTE));
  box.appendChild(simpleTable(OMEGA_HEADERS, rows, []));
  return box;
}

// === Walls → Detailed: layered tabs (level → wall type → mark) and one wall's calc sheet ===
// Sheet order: A wall definition (inputs) · B applied loading · C calculations and equations.
const WALL_TYPES = [['wall', 'Segmented'], ['ftao', 'FTAO'], ['wswh', 'WSWH']];
function tabBar(items, active, onPick, small) {
  const bar = el('div', { style: { display: 'flex', gap: '2px', flexWrap: 'wrap', margin: '0.25rem 0 0.5rem', borderBottom: small ? 'none' : '1px solid var(--border-light)' } });
  for (const [key, label] of items) {
    bar.appendChild(el('button', { className: 'btn btn-sm' + (key === active ? ' btn-primary' : ' btn-ghost'), type: 'button',
      style: { borderRadius: '4px 4px 0 0', fontSize: small ? '0.78rem' : null }, onClick() { onPick(key); } }, label));
  }
  return bar;
}
const sheetHead = (text) => el('div', { style: { fontWeight: '600', fontSize: '0.85rem', margin: '0.75rem 0 0.25rem', borderBottom: '1px solid var(--border-light)', paddingBottom: '2px' } }, text);
// Calc sheet text: symbols written X_y (R_L, M_R, h_sx, d_e …) show as subscripts, the same rule as the PDF (subMarkup)
const sheetText = (text) => (typeof text === 'string' ? rich(subMarkup(text)) : text);
const sheetSub = (text) => el('div', { style: { fontWeight: '500', fontSize: '0.8rem', margin: '0.4rem 0 0.15rem' } }, sheetText(text));
const sheetNote = (text, color) => el('div', { style: { fontSize: '0.78rem', color: color || 'var(--ink-secondary)', margin: '0.15rem 0 0.35rem' } }, sheetText(text));
const subCell = (c) => (typeof c === 'string' ? subMarkup(c) : c && typeof c === 'object' && !(c instanceof Node) && 't' in c ? { ...c, t: subMarkup(String(c.t)) } : c);
const sheetTable = (headers, rows) => detailTable(headers, rows.map(r => (r.cells ? { ...r, cells: r.cells.map(subCell) } : r.map(subCell))));
const kvTable = (rows) => sheetTable(['Item', 'Value'], rows);
const sgnTxt = (v) => (v < 0 ? '− ' + f2(-v) : f2(v));
const sheetLink = (text, label, onClick) => el('div', { style: { fontSize: '0.78rem', color: 'var(--ink-secondary)', margin: '0.15rem 0 0.35rem' } }, text + ' ',
  el('button', { className: 'btn btn-sm btn-ghost', type: 'button', style: { fontSize: '0.75rem', padding: '0 0.35rem' }, onClick }, label + ' →'));
// Link from a calc sheet to another wall's sheet ({ level, type, mark }) or a results tab ({ tab })
function navButton(nav, state) {
  if (!nav) return '';
  const go = nav.tab ? () => state.onTab && state.onTab(nav.tab) : () => state.onDetail && state.onDetail({ level: nav.level, type: nav.type, mark: nav.mark });
  return el('button', { className: 'btn btn-sm btn-ghost', type: 'button', style: { fontSize: '0.72rem', padding: '0 0.35rem' }, onClick: go }, nav.tab ? 'Load path →' : 'Open ' + nav.mark + ' →');
}

// Level → type → mark tabs; state.detail = { level, type, mark }, state.onDetail(patch)
function renderWallTabs(ln, dirOut, state) {
  const box = el('div');
  const levels = ln.perLevel.filter(pl => pl.walls.length);
  if (!levels.length) return box;
  const det = state.detail || {};
  const pick = (patch) => { if (state.onDetail) state.onDetail(patch); };
  const pl = levels.find(p => p.levelId === det.level) || levels[0];
  box.appendChild(tabBar(levels.map(p => [p.levelId, p.levelName || '?']), pl.levelId, (k) => pick({ level: k })));
  const types = WALL_TYPES.map(([t, label]) => [t, label, pl.walls.filter(w => w.method === t)]).filter(([, , ws]) => ws.length);
  const ty = types.find(t => t[0] === det.type) || types[0];
  box.appendChild(tabBar(types.map(([t, label, ws]) => [t, label + ' (' + ws.length + ')']), ty[0], (k) => pick({ type: k }), true));
  const walls = ty[2];
  const w = walls.find(x => x.mark === det.mark) || walls[0];
  box.appendChild(tabBar(walls.map(x => [x.mark, x.mark + (x.nailingBasis === 'drift' ? ' ·drift' : '') + (x.dcRatio > 1 ? ' ·NG' : '')]), w.mark, (k) => pick({ mark: k }), true));
  box.appendChild(renderWallSheet(w, pl, dirOut, ln, state.defs || {}, state));
  return box;
}

// === Calc sheet of one wall — ONE content list, two outputs (user 2026-10-01: the PDF calc sheet is the same as the
// tool's). wallSheetBlocks builds the blocks; renderWallSheet draws them on screen, wallSheetPdfSections turns them
// into PDF sections. Change the calc sheet here only.
// Blocks: { k: 'title' | 'head' | 'sub' | 'note' | 'kv' | 'table' | 'link' | 'details', … }
function wallSheetBlocks(w, pl, dirOut, ln, defs) {
  const inputs = defs.inputs || {}, line = defs.line || {};
  const wallIn = (line.walls || []).find(x => x.id === w.wallId) || {};
  const lvl = (inputs.levels || []).find(l => l.id === pl.levelId) || {};
  const lineThickness = line.wallThickness || inputs.wallThickness || '4';
  const grade = woodBasis(inputs);
  const rho = dirOut && dirOut.rho != null ? dirOut.rho : 1;
  const loadType = inputs.loadType || (w.share_1W > 0 && !(w.share_1E > 0) ? 'wind' : 'seismic');
  const lts = loadType === 'both' ? ['E', 'W'] : loadType === 'wind' ? ['W'] : ['E'];
  const B = [];
  const head = (text) => B.push({ k: 'head', text });
  const sub = (text) => B.push({ k: 'sub', text });
  const note = (text, color) => B.push({ k: 'note', text, color });
  const kv = (rows) => B.push({ k: 'kv', rows });
  const table = (headers, rows, nav) => B.push({ k: 'table', headers, rows, nav });

  B.push({ k: 'title', text: 'Calc sheet — ' + w.mark + ' (' + pl.levelName + ', ' + wallTypeOf(w) + ')' });
  note('N = vertical force at a wall end (k), + = compression, − = uplift (N = C − T). x from the wall left end. → = shear toward the right end (left end uplift), ← = mirror.');

  // A. Definition
  head('A. Wall definition (inputs)');
  kv(wallDefinitionRows(w, { wallIn, levelName: pl.levelName, lineThickness, gradeLabel: grade.label, sheathing: inputs.sheathing, rho,
    dlType: (inputs.wallDLTypes || []).find(t => t.id === wallIn.wallDLTypeId) }));

  // B. Applied loading
  head('B. Applied loading');
  sub('B1. Lateral (1.0 level)');
  kv(lateralShareRows(w, pl, ln, inputs, line));
  B.push({ k: 'link', text: 'The Σ parts (every wall at ' + pl.levelName + ') are in the Distribution tab.', label: 'Open Distribution tab', tab: 'distribution',
    pdfText: 'The Σ parts (every wall at ' + pl.levelName + ') are in the Distribution table of this wall line.' });
  sub('B2. Gravity on this wall (R_R = P·x̄ / L, R_L = P − R_R)');
  const gr = gravityRowsOf(w);
  if (gr) table(GRAVITY_HEADERS, gr); else note('No gravity load on this wall.');
  sub('B3. Loads from above at the wall ends (per load case, k)');
  const ab = aboveRows(w);
  if (ab.length) table(ABOVE_HEADERS, ab); else note('Nothing lands on the ends of this wall from above.');

  // C. Calculations
  head('C. Calculations and equations');
  if (w.method === 'wall') {
    sub('C1. Sheathing capacity (SDPWS 2021 Table 4.3A, footnote 10, §4.3.4 aspect ratio)');
    kv(capacityRows(w, lts));
    sub('Nailing selection (lightest pattern with v ≤ v_cap)');
    kv(nailingTraceRows(w, rho, lts));
    sub('C2. Shear demand and D/C');
    kv(demandRows(w, rho, lts));
  } else if (w.method === 'ftao' && w.ftao) {
    sub('C1–C2. FTAO engine (APA T555 / Diekmann): capacity, demand and zone checks');
    kv(ftaoSummaryLines(w));
    for (const lt of Object.keys(w.ftao.perType)) {
      note(LT_LABEL[lt] + ' — piers and zone checks');
      table(FTAO_PIER_HEADERS, ftaoPierRows(w, lt));
      table(FTAO_CHECK_HEADERS, ftaoCheckRows(w, lt));
    }
    if ((w.ftao.jambs || []).length) { note('Jamb posts — C = d·D + l·L + lr·Lr + k·v_i·h_o (governing ASD combination)'); table(FTAO_JAMB_HEADERS, ftaoJambRows(w)); }
    w.ftao.warnings.forEach(m => note('⚠ ' + m, 'warn'));
  } else if (w.method === 'wswh') {
    sub('C1–C2. Strong-Wall WSWH panel (tabulated capacity, demand, anchors)');
    kv(wswhSheetRows(w));
  }
  const cases = caseKeysOf(w);
  if (w.combos && (cases.gravity.length || cases.lateral.length)) {
    sub('C3. Overturning about each corner, per load case (unfactored)');
    for (const dir of ['→', '←']) {
      const t = cornerOverturningRows(w, dir);
      table(t.headers, t.rows);
    }
    const mr = resistingMomentRows(w);
    if (mr && mr.note) note(mr.note);
    else if (mr) {
      B.push({ k: 'details', summary: 'M_R breakdown — lever of each gravity piece to each corner', blocks: [
        { k: 'note', text: 'x from the wall left end, L = ' + f2(w.length) + ' ft. A uniform piece acts at its centroid. The Σ row equals the M_R row of each C3 table (→ uses L − x, ← uses x).' },
        { k: 'table', headers: mr.headers, rows: mr.rows }] });
    }
    sub('C4. End forces by load case (unfactored): own + from above = total');
    const c4 = loadCaseEnds(w);
    table(c4.headers, c4.rows);
    const refs = aboveSourceRefs(w, ln);
    if (refs.length) {
      note('Where each "from above" value comes from (C3 and C4; lateral values are the → direction, ← = the negative):');
      table(['End', 'Load case', 'From above (k)', 'Source'], refs.map(r => [r.side === 'left' ? 'Left' : 'Right', r.key, sgnTxt(r.value), r.text]), refs.map(r => r.nav));
    }
    sub('C5. Governing ASD combination at each end — superposition of the C4 totals');
    const sup = superpositionRows(w);
    table(SUPERPOSITION_HEADERS, sup.map(r => (Math.abs(r.diff || 0) > 0.005 ? { cells: r.cells, bad: true } : r.cells)));
    note('The tool forms each combination at every wall and adds it down the load path per combination; here the load-case totals are factored and added. Both give the same result (superposition, check G12); end forces are kept unrounded, so the difference is 0.00 k. A red row differs by more than 0.005 k — see the Checks tab.');
    B.push({ k: 'details', summary: 'All combinations (this wall only, before loads from above)', blocks: [
      { k: 'note', text: endForceTitle(w) },
      { k: 'table', headers: END_FORCE_HEADERS, rows: endForceRowsOf(w) }] });
  }
  const hw = hardwareTraceRows(w, { floorSpan: lvl.floorClearSpan || '16', lineThickness, wallIn, gradeLabel: grade.label });
  if (hw.length) { sub('C6. Hardware and posts (ASD demand incl. loads from above)'); kv(hw); }
  const dr = deflectionSubstitutionRows(w, { lineThickness, grade });
  if (dr.length) { sub('C7. Deflection at 1.0E / α_s·W (SDPWS 2021 Eq. 4.3-1) — used for story drift'); kv(dr); }
  return B;
}

// Screen output of the calc sheet
function renderWallSheet(w, pl, dirOut, ln, defs, state = {}) {
  const box = el('div', { style: { borderLeft: '3px solid var(--border-light)', paddingLeft: '0.75rem' } });
  const draw = (b, into) => {
    if (b.k === 'title') into.appendChild(el('div', { style: { fontWeight: '600', fontSize: '0.9rem' } }, b.text));
    else if (b.k === 'head') into.appendChild(sheetHead(b.text));
    else if (b.k === 'sub') into.appendChild(sheetSub(b.text));
    else if (b.k === 'note') into.appendChild(sheetNote(b.text, b.color === 'warn' ? 'var(--stale, #b7791f)' : b.color));
    else if (b.k === 'kv') into.appendChild(kvTable(b.rows));
    else if (b.k === 'table') {
      const rows = b.rows.map(r => (r && r.bad ? { cells: r.cells, style: { color: 'var(--fail)', fontWeight: '600' } } : r));
      into.appendChild(b.nav ? sheetTable([...b.headers, ''], rows.map((r, i) => [...(r.cells || r), navButton(b.nav[i], state)])) : sheetTable(b.headers, rows));
    } else if (b.k === 'link') { if (state.onTab) into.appendChild(sheetLink(b.text, b.label, () => state.onTab(b.tab))); }
    else if (b.k === 'details') {
      const d = el('details', null, el('summary', { style: { cursor: 'pointer', fontSize: '0.8rem' } }, sheetText(b.summary)));
      b.blocks.forEach(x => draw(x, d));
      into.appendChild(d);
    }
  };
  wallSheetBlocks(w, pl, dirOut, ln, defs).forEach(b => draw(b, box));
  return box;
}

// PDF output of the same calc sheet: headings + sub-headings become section titles, collapsed parts are printed open
function wallSheetPdfSections(w, pl, dirOut, ln, defs, T) {
  const out = [];
  let pending = [];
  const title = () => { const t = pending.join(' — '); pending = []; return t; };
  const cells = (r) => (r && r.cells ? r.cells : r).map(c => pdfCell(subCell(c)));
  const emit = (b) => {
    if (b.k === 'title') { out.push({ title: T(b.text.replace('Calc sheet — ', 'Calc sheet ')), pageBreakBefore: true, text: '' }); return; }
    if (b.k === 'head') { pending = [b.text]; return; }
    if (b.k === 'sub') { pending = pending.length ? [pending[0], b.text] : [b.text]; return; }
    if (b.k === 'note') { out.push({ title: title(), text: subMarkup(b.text) }); return; }
    if (b.k === 'link') { out.push({ title: title(), text: subMarkup(b.pdfText || b.text) }); return; }
    if (b.k === 'kv') { out.push({ title: title(), rows: b.rows.map(r => { const c = r.cells || r; return [subMarkup(String(c[0])), pdfCell(subCell(c[1]))]; }) }); return; } // a row may be { cells, style }
    if (b.k === 'table') {
      out.push({ title: title(), table: { headers: b.headers, rows: b.rows.map(r => {
        const cs = cells(r);
        return r && r.bad ? cs.map(c => ({ t: c && typeof c === 'object' ? c.t : String(c == null ? '' : c), color: DC_RGB.fail })) : cs;
      }) } });
      return;
    }
    if (b.k === 'details') { pending = [b.summary]; b.blocks.forEach(emit); }
  };
  wallSheetBlocks(w, pl, dirOut, ln, defs).forEach(emit);
  // the sheet title section carries the first note (sign convention) instead of an empty text
  if (out.length > 1 && out[0].text === '' && out[1].text && !out[1].title) { out[0].text = out[1].text; out.splice(1, 1); }
  out.forEach(x => { x.sheetOf = w.wallId; }); // marks the sections of this wall's sheet (tests)
  return out;
}

// B1: story shear build-up and this wall's share
function lateralShareRows(w, pl, ln, inputs, line) {
  const rows = [];
  const lvls = inputs.levels || [];
  const idx = lvls.findIndex(l => l.id === pl.levelId);
  for (const [lt, key, V, share] of [['E', 'seismic', pl.storyShear_1E, w.shareExact_1E], ['W', 'wind', pl.storyShear_1W, w.shareExact_1W]]) {
    if (!(V > 0)) continue;
    const parts = idx >= 0 ? lvls.slice(0, idx + 1).map(l => ({ n: l.name, v: parseFloat(((line.levelLoads || {})[l.id] || {})[key]) || 0 })).filter(p => p.v) : [];
    rows.push(['Story shear V_x (1.0' + lt + ')', (parts.length ? parts.map(p => 'F_' + p.n + ' ' + f2(p.v)).join(' + ') + ' = ' : '') + f2(V) + ' k']);
    if (ln.distribution && ln.distribution.method === 'deflection') {
      const dS = (w.deltaShare || {})[lt], lvl = ((ln.distribution.levels || []).find(l => l.levelId === pl.levelId && l.loadType === lt)) || null;
      rows.push(['Share V_w (deflection)', 'the share at which δ_w = story δ*' + (lvl ? ' = ' + f3(lvl.delta) + ' in' : '') + ': V_w = ' + f2(share) + ' k'
        + (dS > 0 ? ', δ_w = ' + f3(dS) + ' in' : '') + ' (1.0 level, final pass; Distribution tab)']);
    } else {
      const tot = pl.walls.reduce((a, x) => a + ((x.capWeight || {})[lt] || 0), 0), wt = (w.capWeight || {})[lt] || 0;
      rows.push(['Share V_w (capacity)', 'V_x × wt_w / Σwt = ' + f2(V) + ' × ' + f0(wt) + ' / ' + f0(tot) + ' = ' + f2(share) + ' k  (wt = v_cap × L, Distribution tab)']);
    }
  }
  if (!rows.length) rows.push(['Lateral', 'no story shear at this level']);
  return rows;
}

// B3: loads from above per source and end
const ABOVE_HEADERS = ['Source', 'End', '1.0D', '1.0L', '1.0Lr', '1.0E →', '1.0W →'];
function aboveRows(w) {
  return (w.injections || []).map(s => [s.label || s.id, s.side === 'left' ? 'Left' : 'Right',
    ...['1.0D', '1.0L', '1.0Lr', '1.0E', '1.0W'].map(k => (s.map && s.map[k] != null ? (+s.map[k]).toFixed(2) : '—'))]);
}

// C2: shear demand and D/C (segmented)
function demandRows(w, rho, lts) {
  const rows = [];
  const L = w.length || 0;
  for (const lt of lts) {
    const V = lt === 'E' ? w.shareExact_1E : w.shareExact_1W;
    const v = lt === 'E' ? w.unitShear_seismic : w.unitShear_wind;
    const cap = lt === 'E' ? w.effectiveSeismicCap : w.effectiveWindCap;
    rows.push(['v ' + (lt === 'E' ? 'seismic' : 'wind') + ' (ASD)', (lt === 'E' ? '0.7 × ρ ' + rho + ' × ' : '0.6 × ') + f2(V) + ' k × 1000 / ' + f2(L) + ' ft = ' + f0(v) + ' plf']);
    rows.push(['D/C ' + (lt === 'E' ? 'seismic' : 'wind'), f0(v) + ' / ' + f0(cap) + ' = ' + f2(cap > 0 ? v / cap : null)]);
  }
  rows.push(['Governing', f2(w.dcRatio) + ' (' + (w.dcGoverning || '') + ')' + (w.dcRatio > 1 ? ' — NG' : ' — OK')]);
  return rows;
}

// C1–C2 for a WSWH panel
function wswhSheetRows(w) {
  const x = w.wswh;
  if (!x.ok) return [['Problem', x.errors.join('; ') + ' — panel carries no shear']];
  const lt = w.dcGoverning === 'wind' ? 'W' : 'E';
  const sc = x.stacked && x.stacked[lt];
  const an = (a, dc) => (!a ? 'OVER' : a.byRDP || a.byKit ? a.id : a.id + (a.cap ? ' ' + a.cap + ' lb' : '') + (a.W ? ', W ' + a.W + '" d_e ' + a.de + '" L_ftg ' + a.Lftg + '"' : '') + (dc != null ? ' (D/C ' + f2(dc) + ')' : ''));
  return [
    ['Panel', x.evalModel + (x.orderModel !== x.evalModel ? ' (order ' + x.orderModel + ', trimmed)' : '') + ' — ' + conditionLabel(x.role === 'stackedLower' ? 'concrete' : x.condition) + (x.role === 'stackedLower' ? ', stack base' : '') + (x.kit ? ', ' + x.kit : '')],
    ['Table values', 'H_e ' + f2(x.He) + ' in, B ' + x.B + ' in; V_allow E ' + f0(x.Vcap.E) + ' / W ' + f0(x.Vcap.W) + ' lb; Δ_cap E ' + f2(x.Dcap.E) + ' / W ' + f2(x.Dcap.W) + ' in; V_LRFD E ' + f0(x.VcapL.E) + ' / W ' + f0(x.VcapL.W) + ' lb with Δ_LRFD E ' + f2(x.DcapL.E) + ' / W ' + f2(x.DcapL.W) + ' in — drift Δ = Δ_LRFD × V / V_LRFD (' + x.table + ')'],
    ['Vertical load P', 'E ' + f0(x.P.E) + ' lb = max((1.0+0.14SDS)D, (1.0+0.105SDS)D + 0.75L); W ' + f0(x.P.W) + ' lb = max(D, D + 0.75L + 0.75Lr)' + (x.fromAbove ? ' — incl. the panel above' : '')],
    ['Shear check', sc ? 'M_d ' + f0(sc.Md) + ' / M_allow ' + f0(sc.Mallow) + ' lb-ft → D/C ' + f2(w.dcRatio) : 'V_ASD ' + f0(x.Vd[lt]) + ' / V_allow ' + f0(x.Vcap[lt]) + ' lb → D/C ' + f2(w.dcRatio)],
    ['Anchors L / R', an(w.anchorageLeft, w.anchorageDCLeft) + ' / ' + an(w.anchorageRight, w.anchorageDCRight)],
  ];
}

// === Verification tab: a seeded verification case (inputs.verification, scripts/seedCases.mjs) ===
// Expected values come from the case hand calc; calculated values from the current inputs. Editing the
// inputs changes the model, so the expected values then no longer apply.
export function renderVerificationTab(inputs) {
  const v = inputs.verification;
  const box = el('div');
  let ev = null, err = null;
  try { ev = evaluateCase(v, calcAll(inputs)); } catch (e) { err = e.message; }
  box.appendChild(el('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.35rem' } },
    el('strong', null, v.id + ' — ' + v.title),
    ev ? el('span', { className: 'badge ' + (ev.pass ? 'badge-pass' : 'badge-fail') }, ev.pass ? 'PASS' : 'FAIL') : null));
  const note = (text, color) => el('div', { style: { fontSize: '0.8rem', color: color || 'var(--ink-secondary)', marginBottom: '0.4rem', lineHeight: '1.5' } }, text);
  box.appendChild(note(v.intent));
  if ((v.covers || []).length) box.appendChild(note('Covers: ' + v.covers.join(' · ')));
  box.appendChild(note('Expected = the hand calc of this case; Calculated = the tool with the inputs as they are now. Changing the inputs changes the model — the expected values then no longer apply (re-seed with npm run seed:cases to restore).', 'var(--stale, #b7791f)'));
  if (err) { box.appendChild(note('Could not evaluate: ' + err, 'var(--fail)')); return box; }
  box.appendChild(sheetHead('Hand calc'));
  const ol = el('ol', { style: { fontSize: '0.82rem', paddingLeft: '1.25rem', margin: '0.25rem 0 0.5rem', lineHeight: '1.55' } });
  (v.handCalc || []).forEach(s => ol.appendChild(el('li', null, s.text)));
  box.appendChild(ol);
  box.appendChild(sheetHead('Expected vs calculated'));
  box.appendChild(detailTable(['Step', 'Value', 'Expected', 'Calculated', 'Difference', 'Tolerance', ''], ev.values.map(r => ({
    cells: [String(r.step), r.label, fmtValue(r.value), r.error || fmtValue(r.actual), r.diff != null ? r.diff.toFixed(4) : '', r.tol != null ? String(r.tol) : '', r.pass ? 'OK' : 'NG'],
    style: r.pass ? null : { color: 'var(--fail)', fontWeight: '600' } }))));
  const must = (v.expectChecks && v.expectChecks.fail) || [];
  box.appendChild(sheetHead('Line checks G1–G12' + (must.length ? ' — ' + must.join(', ') + ' must fail' : ' — all must pass')));
  box.appendChild(detailTable(['Line', 'Check', 'Status', 'Expected', ''], ev.checks.map(r => ({
    cells: [r.line, r.id + ' ' + (r.title || ''), r.status, r.expected, r.pass ? 'OK' : 'NG'], style: r.pass ? null : { color: 'var(--fail)', fontWeight: '600' } }))));
  if (ev.warnings.length) box.appendChild(note('Required load path warnings: ' + ev.warnings.map(w => w.type + (w.pass ? ' ✓' : ' — missing')).join(', ')));
  if (v.notChecked) box.appendChild(note('Not hand-checked here: ' + v.notChecked));
  return box;
}

// === Equilibrium checks (gatekeepers) G1–G12 — shearWallChecks.js ===
export const CHECK_ROW_HEADERS = ['Where', 'Case', 'Expected', 'Calculated', 'Diff', 'Tol.', 'Status', 'Detail'];
const statusBadge = (st) => el('span', { className: 'badge ' + (st === 'fail' ? 'badge-fail' : st === 'pass' ? 'badge-pass' : 'badge-stale') },
  st === 'fail' ? 'NG' : st === 'pass' ? 'OK' : st === 'note' ? 'NOTE' : 'N/A');
const checkValue = (v, unit) => (typeof v === 'number' ? v.toFixed(Math.abs(v) >= 100 ? 1 : 3) + (unit ? ' ' + unit : '') : v || '—');
export function checkRowCells(r) {
  return [r.where, r.case, checkValue(r.expected, r.unit), checkValue(r.actual, r.unit), typeof r.diff === 'number' ? r.diff.toFixed(3) : '',
    typeof r.tol === 'number' ? r.tol.toFixed(3) : '', r.status === 'fail' ? 'NG' : 'OK', r.detail || ''];
}
function checkSummaryText(c) {
  if (c.status === 'na') return 'Not applicable (nothing to check in this line)';
  const n = c.passCount + c.failCount;
  return c.failCount ? c.failCount + ' of ' + n + ' row' + (n !== 1 ? 's' : '') + ' NG' : n ? (n === 1 ? '1 row OK' : 'All ' + n + ' rows OK') : 'See notes';
}
const CHECK_ROW_LIMIT = 200;
function lineTabChecks(ln) {
  const box = el('div');
  const checks = ln.checks || [];
  box.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '0.5rem', lineHeight: '1.6' } },
    el('div', null, el('strong', null, 'What these are: '), 'independent statics checks of this line — shear, gravity and overturning must balance at every step. Applied loads are rebuilt from your inputs, not taken from the calc.'),
    el('div', null, el('strong', null, 'Sign convention: '), 'N = vertical force at a wall end / post base / beam support (k), + = compression, N = C − T; x is measured from the line left end (ft).'),
    el('div', null, el('strong', null, 'Load cases: '), 'G6–G9 run on 1.0D, 1.0L, 1.0Lr, 1.0E (ρ = 1) and 1.0W. G12 proves every combination is the factored sum of these, so every combination balances too (superposition).'),
    el('div', null, el('strong', null, 'Excluded loads: '), 'forces the load path audit already lists (unsupported ends, reaction-only supports, gravity with nothing below) are counted as excluded and noted, not failed.')));
  if (!checks.length) { box.appendChild(emptyNote('No checks (no results for this line).')); return box; }
  const tbl = el('table', { className: 'data-table', style: { fontSize: '0.85rem' } });
  tbl.appendChild(el('tr', null, ...['ID', 'Check', 'Intent', 'Result', 'Status'].map(h => el('th', null, h))));
  for (const c of checks) tbl.appendChild(el('tr', null, el('td', { className: 'mono' }, c.id), el('td', null, c.title), el('td', null, c.intent), el('td', null, checkSummaryText(c)), el('td', null, statusBadge(c.status))));
  box.appendChild(el('div', { className: 'table-scroll', style: { marginBottom: '0.75rem' } }, tbl));
  for (const c of checks) {
    if (c.status === 'na') continue;
    const body = el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', padding: '0.25rem 0 0.5rem' } },
      el('div', null, el('strong', null, 'Rule: '), el('span', { className: 'mono' }, c.rule)),
      el('div', { style: { marginBottom: '0.25rem' } }, el('strong', null, 'Variables: '), c.vars));
    c.notes.forEach(n => body.appendChild(el('div', null, 'ⓘ ' + n)));
    if (c.rows.length) {
      const rows = [...c.rows].sort((a, b) => (a.status === 'fail' ? 0 : 1) - (b.status === 'fail' ? 0 : 1));
      const shown = rows.slice(0, CHECK_ROW_LIMIT);
      body.appendChild(detailTable(CHECK_ROW_HEADERS, shown.map(r => (r.status === 'fail' ? { cells: checkRowCells(r), style: { color: 'var(--fail)', fontWeight: '600' } } : checkRowCells(r)))));
      if (rows.length > shown.length) body.appendChild(el('div', null, '… ' + (rows.length - shown.length) + ' more rows (all OK)'));
    }
    const d = el('details', { style: { marginBottom: '0.5rem', borderLeft: '3px solid ' + (c.status === 'fail' ? 'var(--fail)' : 'var(--border-light)'), paddingLeft: '0.75rem' } },
      el('summary', { style: { cursor: 'pointer', fontSize: '0.82rem', fontWeight: '500' } }, c.id + ' — ' + c.title + ': ' + checkSummaryText(c)), body);
    if (c.status === 'fail') d.open = true;
    box.appendChild(d);
  }
  return box;
}

// Full results of one line with sub-tabs. state: { tab, onTab(tab), report: 'summary' | 'detailed', onReport(r) }
export function renderLineResults(container, ln, dirOut, state) {
  const st = lineStats(ln);
  container.appendChild(el('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.35rem' } },
    lineStatusBadge(st),
    el('span', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)' } }, distributionText(ln))));
  if (ln.distribution && ln.distribution.note) container.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--stale, #b7791f)', marginBottom: '0.25rem' } }, 'ⓘ ' + ln.distribution.note));
  const banner = distWarningBanner(ln, state);
  if (banner) container.appendChild(banner);
  container.appendChild(designBasisLine(ln));

  // Tab order (user 2026-10-01): Walls first (default), Checks last; Posts & Beams replaces Load path, Forces replaces LRFD / Ω₀
  const tabs = [['walls', 'Walls'], ['distribution', 'Distribution'], ['postsbeams', 'Posts & Beams' + (st.issues ? ' (' + st.issues + ')' : '')],
    ['drift', 'Drift' + (st.drift === 'NG' ? ' (NG)' : '')], ['forces', 'Forces'], ['checks', 'Checks' + (st.checksFailed ? ' (' + st.checksFailed + ' NG)' : '')]];
  const tab = tabs.some(t => t[0] === state.tab) ? state.tab : 'walls';
  const bar = el('div', { style: { display: 'flex', gap: '2px', marginBottom: '0.5rem', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' } });
  for (const [key, label] of tabs) {
    bar.appendChild(el('button', { className: 'btn btn-sm' + (key === tab ? ' btn-primary' : ' btn-ghost'), type: 'button',
      style: { borderRadius: '4px 4px 0 0' }, onClick() { state.onTab(key); } }, label));
  }
  container.appendChild(bar);
  const body = tab === 'distribution' ? lineTabDistribution(ln, state) : tab === 'checks' ? lineTabChecks(ln) : tab === 'postsbeams' ? lineTabPostsBeams(ln)
    : tab === 'drift' ? lineTabDrift(ln) : tab === 'forces' ? lineTabForces(ln, state) : lineTabWalls(ln, dirOut, state);
  container.appendChild(body);
}

// "Distribution: …" label for a line's results
function distributionText(ln) {
  const d = ln.distribution;
  if (!d || d.method !== 'deflection') return 'distribution by wall capacity';
  const pct = (v) => (v * 100).toFixed(1) + '%';
  const zero = (d.noted || []).filter(n => n.zeroShare).map(n => n.mark);
  const tail = zero.length ? '; no story shear at ' + [...new Set(zero)].join(', ') + ' (rotated by the forces above)' : '';
  return d.converged
    ? 'distribution by deflection (equal δ at every level, spread ' + pct(d.spread) + ', ' + d.passes + ' pass' + (d.passes !== 1 ? 'es' : '') + ')' + tail
    : 'distribution by deflection — shares still moving ' + d.shareChange + ' k after ' + d.passes + ' passes; closest pass used (δ spread ' + pct(d.spread) + ')' + tail;
}

// A wall fails when sheathing D/C > 1, h/b > 3.5, or (FTAO) the strap or sill plate bearing fails
function wallFails(w) {
  if (w.dcRatio > 1.0 || w.hbNotPermitted) return true;
  if (w.method === 'wswh' && !w.wswh.ok) return true;
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
    'Opening ' + j.opening + ' ' + j.side, f2(j.dl) + ' / ' + f2(j.ll || 0) + ' / ' + f2(j.lr || 0) + (j.combo ? ' — ' + j.combo : ''), f0(j.v) + ' × ' + f2(j.ho), f2(j.C),
    j.post ? j.post.label + (j.override ? ' *' : '') : 'OVER', j.post ? f2(j.post.capacityKips) : '—', f2(j.dc),
  ]);
}
const FTAO_JAMB_HEADERS = ['Jamb', 'D / L / Lr (k) — governing ASD combo', 'v_i × h_o (plf × ft)', 'C (k)', 'Post', 'Cap (k)', 'D/C'];

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

const WSWH_HEADERS = ['Mark', 'Level', 'Model (order)', 'Condition', 'H_e (in)', 'P E / W (lb)', 'V_ASD / V_allow (lb)', 'D/C', 'Δ 1.0E (in)', 'Anchor L / R'];
const WSWH_STACK_HEADERS = ['Base panel', 'Case', 'M_allow (lb-ft)', 'M_d (lb-ft)', 'D/C', 'V₁ avail (lb)'];

function wswhRows(ln) {
  const rows = [];
  for (const pl of ln.perLevel) {
    for (const w of pl.walls) {
      if (w.method !== 'wswh') continue;
      const x = w.wswh;
      const lt = w.dcGoverning === 'wind' ? 'W' : 'E';
      const anc = (a, dc) => !a ? 'OVER' : a.byRDP || a.byKit ? a.id : a.id + (a.W ? ', W ' + a.W + '" d_e ' + a.de + '" L ' + a.Lftg + '"' : '') + (dc != null ? ' (' + dc.toFixed(2) + ')' : '') + (a.override ? ' *' : '');
      rows.push([
        w.mark, pl.levelName,
        x.ok ? x.evalModel + (x.orderModel && x.orderModel !== x.evalModel ? ' (' + x.orderModel + ')' : '') : 'not tabulated',
        conditionLabel(x.role === 'stackedLower' ? 'concrete' : x.condition) + (x.role === 'stackedLower' ? ' — stack base' : '') + (x.kit ? ', ' + x.kit : ''),
        x.ok ? x.He.toFixed(2) : '—', f0(x.P.E) + ' / ' + f0(x.P.W),
        f0(x.Vd[lt]) + ' / ' + f0(x.Vcap[lt]) + (x.role === 'stackedLower' ? ' (M check)' : ''), f2(w.dcRatio),
        w.deflection && w.deflection.E ? f3(w.deflection.E.delta) : '—',
        anc(w.anchorageLeft, w.anchorageDCLeft) + ' / ' + anc(w.anchorageRight, w.anchorageDCRight),
      ]);
    }
  }
  return rows;
}

function wswhStackRows(ln) {
  const rows = [];
  for (const pl of ln.perLevel) {
    for (const w of pl.walls) {
      if (w.method !== 'wswh' || w.wswh.role !== 'stackedLower') continue;
      for (const [lt, st] of Object.entries(w.wswh.stacked || {})) {
        if (!st || (lt === 'W' && !(w.share_1W > 0)) || (lt === 'E' && !(w.share_1E > 0))) continue;
        rows.push([w.mark, lt === 'E' ? 'Seismic (0.7ρE)' : 'Wind (0.6W)', f0(st.Mallow), f0(st.Md), f2(st.dc), f0(st.V1avail)]);
      }
    }
  }
  return rows;
}

function wswhNoteLines(ln) {
  const lines = ['M_allow = V₀·H₁/12 with V₀ at P = 4,000 lb, f\'c 2,500 psi; M_d = [V₁·H₁ + V₂·(H₁ + d_fl + H₂)]/12; T = V·H_e/B − P/2 with combo-factored D.'];
  for (const pl of ln.perLevel) for (const w of pl.walls) {
    if (w.method !== 'wswh') continue;
    (w.wswh.notes || []).forEach(n => lines.push(w.mark + ': ' + n));
    (w.wswh.errors || []).forEach(n => lines.push(w.mark + ': ' + n + ' — panel carries no shear'));
  }
  return [...lines, ...WSWH_NOTES];
}

const OMEGA_HEADERS = ['Element', 'Level', 'Ω₀ ASD T L / R (k)', 'Ω₀ ASD C L / R (k)', 'Ω₀ LRFD T L / R (k)', 'Ω₀ LRFD C L / R (k)'];

// Ω₀ envelopes (accumulated through the load path) — reported forces only
function omegaRows(ln) {
  const rows = [];
  const pair = (a, b) => f2(a) + ' / ' + f2(b);
  for (const pl of ln.perLevel) {
    for (const w of pl.walls) {
      const o = w.omega;
      if (!o || !o.asd || !w.combos || !Object.values(w.combos).some(c => c.group === 'asd_omega')) continue;
      rows.push([w.mark, pl.levelName, pair(o.asd.tL, o.asd.tR), pair(o.asd.cL, o.asd.cR), pair(o.lrfd.tL, o.lrfd.tR), pair(o.lrfd.cL, o.lrfd.cR)]);
    }
  }
  if (!rows.length) return rows;
  for (const pp of ln.postPaths || []) {
    if (pp.omega) rows.push([pp.mark + ' base', pp.levelName, f2(pp.omega.asd.T), f2(pp.omega.asd.C), f2(pp.omega.lrfd.T), f2(pp.omega.lrfd.C)]);
  }
  for (const bt of ln.beamTransfers || []) {
    (bt.supports || []).forEach((s, i) => {
      if (s.omega) rows.push([bt.mark + (i === 0 ? ' L' : ' R') + ' support', bt.levelName, f2(s.omega.asd.T), f2(s.omega.asd.C), f2(s.omega.lrfd.T), f2(s.omega.lrfd.C)]);
    });
  }
  return rows;
}
const OMEGA_NOTE = 'Amplified seismic (Ω₀) combinations, ASCE 7-22 §2.4.5 (ASD) and §2.3.6 (LRFD) with Ω₀ in place of ρ — reported forces only, not used for design.';

const DRIFT_HEADERS = ['Level', 'h_sx (ft)', 'δxe (in)', 'Governing wall', 'δx = Cd·δxe/Ie (in)', 'δx / h_sx', 'Allowable Δa (in)', 'Status'];

function driftRows(ln) {
  const d = ln.drift;
  if (!d) return [];
  const bypass = ln.driftSizing && ln.driftSizing.mode === 'bypass';
  const rows = [];
  for (const r of d.rows) {
    if (r.seismic) {
      const s = r.seismic;
      rows.push([r.levelName + ' (seismic)', f2(r.hsx), f3(s.deltaXE), s.wallMark, f3(s.deltaX), f4(s.ratio), s.allowable != null ? f3(s.allowable) : '—',
        s.pass == null ? '—' : s.pass ? 'OK' : bypass ? 'NG (bypassed)' : 'NG']);
    }

  }
  return rows;
}

// S7: δx = Cd·δxe/Ie and Δa = limit × h_sx × 12 with the numbers
export const DRIFT_CALC_HEADERS = ['Level', 'Amplified drift δx (in)', 'Allowable Δa (in)', 'Check'];
export function driftCalcRows(ln) {
  const d = ln.drift;
  if (!d) return [];
  const bypass = ln.driftSizing && ln.driftSizing.mode === 'bypass';
  const rows = [];
  for (const r of d.rows) {
    const s = r.seismic;
    if (s && s.deltaX != null) {
      const dx = 'δx = Cd·δxe / Ie = ' + d.cd + ' × ' + f3(s.deltaXE) + ' / ' + d.ie + ' = ' + f3(s.deltaX) + ' (δxe = ' + s.wallMark + ')';
      const da = s.allowable != null ? 'Δa = limit × h_sx × 12 = ' + s.limit + ' × ' + f2(r.hsx) + ' × 12 = ' + f3(s.allowable) + ' (ASCE 7-22 Table 12.12-1' + (d.riskCategory ? ', RC ' + d.riskCategory : '') + ')' : 'no limit (risk category missing)';
      const ck = s.allowable != null ? f3(s.deltaX) + (s.pass ? ' ≤ ' : ' > ') + f3(s.allowable) + ' → ' + (s.pass ? 'OK' : bypass ? 'NG (bypassed)' : 'NG') : '—';
      rows.push([r.levelName + ' (seismic)', dx, da, ck]);
    }
    if (r.wind) {
      const w = r.wind;
      rows.push([r.levelName + ' (wind, service)', 'δ_{w} = α_{s}·δ(1.0W) = ' + f3(w.delta) + ' (' + w.wallMark + ')',
        w.allowable != null ? 'Δ_{allow} = h_{sx} × 12 / n = ' + f2(r.hsx) + ' × 12 / ' + w.limitDen + ' = ' + f3(w.allowable) + ' (Commentary CC.2.2)' : 'no limit',
        w.pass == null ? '—' : f3(w.delta) + (w.pass ? ' ≤ ' : ' > ') + f3(w.allowable) + ' → ' + (w.pass ? 'OK' : 'NG (report only)')]);
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
          rows.push([w.mark, (lt === 'E' ? '1.0E' : 'α_s·W') + ' ' + (d.label || 'FTAO pier average') + note, '—', '—', '—', '—', '—', '—', f3(d.delta)]);
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

const BEAM_LOAD_HEADERS = ['Beam', 'x (ft)', 'Load on the beam', 'D / L / Lr (k)', 'ASD T / C (k)'];
// Every load on a transfer beam: wall ends / posts above and gravity loads on the beam (uniform at its centroid)
function beamLoadRows(ln) {
  const rows = [];
  for (const bt of ln.beamTransfers || []) {
    (bt.loads || []).forEach((ld, i) => {
      const g = ld.gravity;
      const what = ld.label + (g && g.uniform ? ' (' + ['D', 'L', 'Lr'].filter(c => g.uniform.w[c]).map(c => c + ' ' + g.uniform.w[c]).join(' / ') + ' plf, at its centroid)' : '');
      rows.push([i === 0 ? bt.mark : '', ld.x.toFixed(2), what, g ? ['D', 'L', 'Lr'].map(c => (g[c] || 0).toFixed(2)).join(' / ') : '—',
        (ld.env ? ld.env.T.toFixed(2) + ' / ' + ld.env.C.toFixed(2) : '—')]);
    });
  }
  return rows;
}

function postRows(ln) {
  return ln.postPaths.map(pp => [
    pp.mark, pp.levelName, pp.position.toFixed(1), pp.envelopeT.toFixed(2), pp.envelopeC.toFixed(2),
    fmtConnection(pp), (pp.post ? pp.post.postLabel + (pp.postDC != null ? ' (' + pp.postDC.toFixed(2) + ')' : '') : 'OVER')
      + (pp.postDesignC != null ? ' · C ' + pp.postDesignC.toFixed(2) + 'k ' + pp.postGoverns : ''),
    fmtReceiver(pp.receiver),
  ]);
}

// === Load combinations and their role (design / deflection / forces only) ===
// Load cases and load combinations (user decision 2026-10-01): load cases are separate from the combinations; each
// combination has an LC# that every other table refers to (lcRef) instead of repeating the equation.
export const LOAD_CASE_HEADERS = ['Case', 'Role', 'Used for'];
export function loadCaseTableRows(inputs) {
  return loadCaseRows(projectComboDefs(inputs)).map(r => [r.name, r.role, r.usedFor]);
}
export const LC_HEADERS = ['LC#', 'Group', 'Combination', 'ASCE 7-22', 'Role'];
const LC_ROLE = {
  asd: 'Design — sheathing, HD / strap, posts, WSWH, post-base and beam-support hardware (governing = ASD envelope)',
  lrfd: 'Forces only (e.g. foundations)',
  asd_omega: 'Forces only; support post members sized for max(ASD, Ω_{0} ASD) (§12.3.3.3)',
  lrfd_omega: 'Forces only',
};
export function lcTableRows(inputs) {
  return projectComboDefs(inputs).filter(d => d.lc).sort((a, b) => +a.lc.slice(2) - +b.lc.slice(2)).map(d => [d.lc, d.lcTag, d.rich, d.ref.replace(' with Ω₀', ''), LC_ROLE[d.group] || '']);
}
export function projectComboDefs(inputs) {
  return comboDefs({ loadType: inputs.loadType || 'seismic', sds: inputs.sds, rho: 1, omega0: omega0Of(inputs), lrfdHalfL: !!inputs.lrfdHalfL });
}
export function designBasisNote(inputs) {
  return 'D, L, Lr, W and E are tracked (S, R, H, F are not; ASCE 7-22 §2.4.5 (6) and §2.3.6 (6) carry S, not Lr). ρ from each direction; Ω_{0} = ' + omega0Of(inputs) + '. '
    + (inputs.lrfdHalfL ? 'LRFD L factor 0.5 in §2.3.1 (3), (4) and §2.3.6 (6) (L_{o} ≤ 100 psf, not garages / places of public assembly).' : 'LRFD L factor 1.0.')
    + ' Elsewhere a combination is referred to by its LC# (→ / ← = direction of the lateral load).';
}
function designBasisTables(inputs) {
  const box = el('div', { style: { marginBottom: '1rem' } });
  box.appendChild(el('div', { className: 'section-header' }, 'Load Cases (unfactored)'));
  box.appendChild(simpleTable(LOAD_CASE_HEADERS, loadCaseTableRows(inputs), []));
  box.appendChild(el('div', { className: 'section-header' }, 'Load Combinations'));
  box.appendChild(simpleTable(LC_HEADERS, lcTableRows(inputs), []));
  box.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginTop: '-0.5rem' } }, rich(designBasisNote(inputs))));
  return box;
}
function designBasisLine(ln) {
  const hasOmega = omegaRows(ln).length > 0;
  return el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '0.35rem' } },
    el('strong', null, 'Design: '), 'ASD combinations · ', el('strong', null, 'Deflection: '), '1.0 load cases · ',
    el('strong', null, 'Forces only: '), 'LRFD' + (hasOmega ? ', Ω₀ ASD, Ω₀ LRFD' : ''));
}

// D/C colour (same thresholds as the elevation dcInk): red > 1.0, amber ≥ 0.8, green otherwise
export function dcLevel(dc) { return dc == null || !Number.isFinite(dc) ? null : dc > 1.0 ? 'fail' : dc >= 0.8 ? 'warn' : 'pass'; }
const DC_CSS = { fail: 'var(--fail)', warn: 'var(--stale)', pass: 'var(--pass, #15803d)' };
export const DC_RGB = { fail: [200, 40, 40], warn: [190, 110, 0], pass: [21, 128, 61] };
// A D/C value as a table cell: { t, dc } → coloured in the app (cellNode) and in the PDF (pdfCell)
export const dcCell = (text, dc) => ({ t: text, dc });
// Table cell → DOM: a Node as is, { t, dc } coloured by D/C, strings with _{…} subscript markup
function cellNode(c) {
  if (c instanceof Node) return c;
  if (c != null && typeof c === 'object' && 't' in c) {
    const lv = dcLevel(c.dc);
    return el('span', { style: { color: lv ? DC_CSS[lv] : null, fontWeight: lv === 'fail' ? '600' : null } }, rich(String(c.t)));
  }
  return typeof c === 'string' ? rich(c) : c;
}
// Table cell → PDF cell (pdf.js: string or { t, color })
export function pdfCell(c) {
  if (c != null && typeof c === 'object' && 't' in c) { const lv = dcLevel(c.dc); return lv ? { t: String(c.t), color: DC_RGB[lv] } : String(c.t); }
  return c instanceof Node ? c.textContent : c;
}

function simpleTable(headers, rows, numCols) {
  const isNum = (i) => (numCols || []).includes(i);
  const tbl = el('table', { className: 'data-table', style: { fontSize: '0.85rem' } });
  tbl.appendChild(el('tr', null, ...headers.map((h, i) => el('th', isNum(i) ? { className: 'num' } : null, rich(h, true)))));
  rows.forEach(r => tbl.appendChild(el('tr', null, ...r.map((c, i) => el('td', { className: isNum(i) ? 'num mono' : 'mono', style: { color: c === 'OVER' ? 'var(--fail)' : null } }, cellNode(c))))));
  return el('div', { className: 'table-scroll', style: { marginBottom: '0.75rem' } }, tbl);
}

function renderMethodFootnotes() {
  const notes = el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '1rem', lineHeight: '1.6' } });
  notes.appendChild(el('div', null,
    el('strong', null, 'Distribution: '), 'Wall capacity approach (SDPWS 4.3.3.4.1): load proportional to wall ASD capacity × length (FTAO walls: engine V_cap,ASD). Deflection approach: walls at a level deflect equally — shares ∝ k = V/δ (SDPWS Eq. 4.3-1 at 1.0E / 1.0W), iterated until the walls’ δ at every level are within 5% ((δmax − δmin)/δmax, max 20 passes; otherwise the closest pass is used and flagged). ' + FOOTNOTE_10_NOTE));
  notes.appendChild(el('div', null,
    el('strong', null, 'Aspect ratio: '), 'SDPWS 2021 — h/b > 2: capacity × (1.25 − 0.125h/b); h/b > 3.5 is not a shear wall (carries no shear).'));
  notes.appendChild(el('div', null,
    el('strong', null, 'Openings: '), 'Segmented walls are solid full-height walls and cannot have openings (model a window between solid walls as two walls). Openings are FTAO only: APA T555 (Diekmann) with the governing opening height; wall-end T/C still includes dead load, the FTAO H shown is gross (no dead load).'));
  notes.appendChild(el('div', null,
    el('strong', null, 'Deflection: '), 'SDPWS 2021 Eq. 4.3-1 at 1.0E (ρ = 1; wind α_s·1.0W), lateral end forces only (own + from above); Δa = δ_LRFD × T / T_LRFD of the holdown / strap (linear from its LRFD pair; warning sign when T > LRFD cap) + sill plate crushing. FTAO: the same pair over the APA T555 pier cases; WSWH: Δ_LRFD × V / V_LRFD of the Simpson table. δx = Cd·δxe/Ie vs ASCE 7-22 Table 12.12-1.'));
  notes.appendChild(el('div', null,
    el('strong', null, 'LRFD: '), 'ASCE 7-22 §2.3.6 combinations are reported as forces only (e.g. for foundations); all design checks are ASD. LRFD caps (holdowns and straps) come from the hardware tables and are reported only.'));
  notes.appendChild(el('div', null,
    el('strong', null, 'T/C: '), 'ASCE 7-22 ASD Combos 5 & 8 with E', el('sub', null, 'v'),
    ' = 0.2S', el('sub', null, 'DS'), '×D (0.7 applied to full E including E', el('sub', null, 'v'), ').'));
  notes.appendChild(el('div', null,
    el('strong', null, 'Stacking: '), 'Simple force addition at aligned wall ends — net T at lower end = local T + accumulated T from above. A wall end landing mid-wall must sit on a post; its load goes down the post and does not change the T/C of the wall below.'));
  notes.appendChild(el('div', null,
    el('strong', null, 'Beams & posts: '), 'Wall end forces and post loads are applied per load combination as point loads; beam reactions by statics at the 2 user-defined supports. ΣT/ΣC and R values are ASD envelopes. Beam reactions exclude floor gravity load.'));
  return notes;
}

// === Calc detail: gravity loads on a wall and the resisting (end) forces of every combination ===
const CASES = ['D', 'L', 'Lr'];
const nz = (v) => Math.abs(v || 0) > 1e-9;
const caseText = (o, d = 2) => { const t = CASES.filter(c => o && nz(o[c])).map(c => c + ' ' + (+o[c]).toFixed(d)); return t.length ? t.join(' / ') : '—'; };
const trimNum = (v) => String(+(+v).toFixed(4));
const detailTable = (headers, rows) => {
  const tbl = el('table', { className: 'data-table', style: { fontSize: '0.75rem', whiteSpace: 'normal', margin: '0.25rem 0 0.5rem' } });
  tbl.appendChild(el('tr', null, ...headers.map(h => el('th', null, rich(h, true)))));
  rows.forEach(r => tbl.appendChild(el('tr', r.style ? { style: r.style } : null, ...(r.cells || r).map(c => el('td', { className: 'mono' }, cellNode(c))))));
  return el('div', { className: 'table-scroll' }, tbl);
};

const GRAVITY_HEADERS = ['Load', 'On wall (ft)', 'w or P', 'P (k)', 'x̄ (ft)', 'R_L (k)', 'R_R (k)'];
// Every load piece on the wall (shape, position, magnitude, resultant, centroid, share to each end) + self-weight
export function gravityDetail(w) {
  const box = el('div');
  box.appendChild(el('div', { style: { fontWeight: '600', marginTop: '0.35rem' } }, 'Gravity loads on this wall (x from its left end; R_R = P·x̄ / L, R_L = P − R_R)'));
  const rows = gravityRowsOf(w);
  if (!rows) box.appendChild(el('div', null, 'No gravity load on this wall.'));
  else box.appendChild(detailTable(GRAVITY_HEADERS, rows));
  return box;
}
function gravityRowsOf(w) {
  const L = w.length || 0;
  const rows = (w.gravRows || []).map(r => {
    const atPoint = r.shape === 'point' || r.shape === 'stack';
    const where = atPoint ? 'x = ' + r.x.toFixed(2) : r.a.toFixed(2) + '–' + r.b.toFixed(2);
    const mag = atPoint ? caseText(r.mag) + ' k'
      : (r.psf ? caseText(r.psf, 1) + ' psf × ' + r.trib + ' ft = ' : '') + caseText(r.w, 0) + ' plf' + (r.assemblyId ? ' (Flat Load)' : '');
    // stack: gravity of the WSWH panel above
    const name = r.shape === 'stack' ? r.label
      : '#' + r.index + ' ' + (r.shape === 'point' ? 'Point' : r.shape === 'full' ? 'Uniform (full line)' : 'Uniform');
    return [name, where, mag, caseText(r.P), r.x.toFixed(2), caseText(r.rL), caseText(r.rR)];
  });
  if (nz(w.dlWallSelf)) rows.push(['Wall self-weight', '0–' + L.toFixed(2), 'wall DL type × area', 'D ' + w.dlWallSelf.toFixed(2), (L / 2).toFixed(2), 'D ' + (w.dlWallSelf / 2).toFixed(2), 'D ' + (w.dlWallSelf / 2).toFixed(2)]);
  const lv = w.live || { L: {}, Lr: {} };
  const tot = { D: w.dlTotal, L: lv.L.total, Lr: lv.Lr.total };
  const rl = { D: w.dlRL, L: lv.L.rL, Lr: lv.Lr.rL }, rr = { D: w.dlRR, L: lv.L.rR, Lr: lv.Lr.rR };
  rows.push({ cells: ['Σ end reactions', '', '', caseText(tot), '', caseText(rl), caseText(rr)], style: { fontWeight: '600' } });
  return (w.gravRows || []).length || nz(w.dlWallSelf) ? rows : null;
}

const GROUP_TITLE = { asd: 'ASD — used for design', load_case: 'Load cases — deflection / display', lrfd: 'LRFD — forces only', asd_omega: 'Ω₀ ASD — forces only (support posts: max with ASD)', lrfd_omega: 'Ω₀ LRFD — forces only' };

// Resisting / end forces of this wall for every combination, with the numbers substituted:
// N = d·R_D + l·R_L + lr·R_Lr ∓ (e·V_E·h + w·V_W·h) / arm   (+ = compression; T = max(0, −N))
const END_FORCE_HEADERS = ['Combination', 'ASCE 7-22', 'Left end N (k)', 'T / C left', 'Right end N (k)', 'T / C right'];
function endForceTitle(w) { return 'End forces by combination — ' + endForceEquation(w); }
// N per combination of this wall (PDF: own text line under the title so it wraps; user 2026-10-01)
function endForceEquation(w) {
  const st = w.steps || {};
  return 'N = d·R_{D} + l·R_{L} + lr·R_{Lr} ∓ (e·' + (st.otm1E || 0).toFixed(2) + ' + w·' + (st.otm1W || 0).toFixed(2) + ') / ' + trimNum(st.arm || w.length || 0)
    + '  (1.0-level V·h in k·ft; + = compression; this wall only — Σ with the loads from above in the Forces tab)';
}
export function endForceDetail(w) {
  const box = el('div');
  if (!w.combos) return box;
  box.appendChild(el('div', { style: { fontWeight: '600', marginTop: '0.35rem' } }, rich(endForceTitle(w))));
  box.appendChild(detailTable(END_FORCE_HEADERS, endForceRowsOf(w)));
  box.appendChild(el('div', null, 'Governing ASD: T L / R ' + w.governingTensionLeft.toFixed(2) + ' / ' + w.governingTensionRight.toFixed(2)
    + ' k, C L / R ' + w.governingComprLeft.toFixed(2) + ' / ' + w.governingComprRight.toFixed(2) + ' k (→ = shear toward the right end, left end uplift side)'));
  return box;
}
function endForceRowsOf(w) {
  const st = w.steps || {};
  const R = { D: [st.rL || 0, st.rR || 0], L: (st.live && st.live.L) || [0, 0], Lr: (st.live && st.live.Lr) || [0, 0] };
  const arm = st.arm || w.length || 0;
  const byGroup = {};
  for (const [k, c] of Object.entries(w.combos)) (byGroup[c.group] = byGroup[c.group] || []).push([k, c]);
  const rows = [];
  for (const g of ['asd', 'load_case', 'lrfd', 'asd_omega', 'lrfd_omega']) {
    if (!byGroup[g]) continue;
    rows.push({ cells: [GROUP_TITLE[g], '', '', '', '', '', ''], style: { fontWeight: '600', background: 'var(--surface-2, rgba(0,0,0,0.03))' } });
    for (const [k, c] of byGroup[g]) {
      const f = c.f || {};
      const m = arm > 0 ? ((f.e || 0) * (st.otm1E || 0) + (f.w || 0) * (st.otm1W || 0)) / arm : 0;
      const sgn = k.endsWith('_neg') ? -1 : 1;
      const expr = (i, mSign) => {
        const t = [];
        for (const [fac, key] of [[f.d, 'D'], [f.l, 'L'], [f.lr, 'Lr']]) if (nz(fac) && nz(R[key][i])) t.push(trimNum(fac) + '×' + (+R[key][i]).toFixed(2));
        if (nz(m)) t.push((mSign * sgn < 0 ? '− ' : '+ ') + Math.abs(m).toFixed(2));
        return (t.length ? t.join(' + ').replace(/\+ ([−+]) /g, '$1 ') : '0');
      };
      const name = lcRef(w.combos, k);
      rows.push([name, c.ref || '', expr(0, -1), c.tensionLeft.toFixed(2) + ' / ' + c.comprLeft.toFixed(2), expr(1, 1), c.tensionRight.toFixed(2) + ' / ' + c.comprRight.toFixed(2), '']);
    }
  }
  return rows.map(r => (r.cells ? { ...r, cells: r.cells.slice(0, 6) } : r.slice(0, 6)));
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

// Schema v7: Ω₀ (forces-only combos), SDC / f'c / detached dwelling, wall system type (sheathed | WSWH)
export function migrateV6toV7(inp) {
  if (!inp) return inp;
  for (const [k, v] of Object.entries(projectV7Defaults())) if (inp[k] === undefined) inp[k] = v;
  (inp.directions || []).forEach(d => (d.lines || []).forEach(ln => (ln.walls || []).forEach(w => {
    for (const [k, v] of Object.entries(wallSystemDefaults())) if (w[k] === undefined) w[k] = v;
  })));
  return inp;
}

// Schema v8: gravity loads become rows { shape, D, L, Lr } (uniform → partial, point → point, dead load only);
// LRFD live-load factor setting
export function migrateV7toV8(inp) {
  if (!inp) return inp;
  for (const [k, v] of Object.entries(projectV8Defaults())) if (inp[k] === undefined) inp[k] = v;
  (inp.directions || []).forEach(d => (d.lines || []).forEach(ln => {
    for (const [lvlId, gl] of Object.entries(ln.gravityLoads || {})) {
      if (!gl || Array.isArray(gl.loads)) continue;
      const loads = [];
      (gl.uniform || []).forEach(u => loads.push({ id: u.id, shape: 'partial', position: u.start ?? 0, start: u.start ?? 0, end: u.end ?? 0, D: u.dlPlf ?? '', L: '', Lr: '', perArea: false, trib: '', assemblyId: '' }));
      (gl.point || []).forEach(p => loads.push({ id: p.id, shape: 'point', position: p.position ?? 0, start: p.position ?? 0, end: p.position ?? 0, D: p.dlKips ?? '', L: '', Lr: '', perArea: false, trib: '', assemblyId: '' }));
      ln.gravityLoads[lvlId] = { loads };
    }
  }));
  return inp;
}

// Schema v9: drift check mode (project bypass + per-line override)
export function migrateV8toV9(inp) {
  if (!inp) return inp;
  for (const [k, v] of Object.entries(projectV9Defaults())) if (inp[k] === undefined) inp[k] = v;
  (inp.directions || []).forEach(d => (d.lines || []).forEach(ln => { if (ln.driftBypass === undefined) ln.driftBypass = ''; }));
  return inp;
}

// Schema v10: segmented walls are solid full-height walls — a segmented wall with openings becomes FTAO
export function migrateV9toV10(inp) {
  if (!inp) return inp;
  (inp.directions || []).forEach(d => (d.lines || []).forEach(ln => (ln.walls || []).forEach(w => {
    if (w.systemType !== 'wswh' && Array.isArray(w.openings) && w.openings.length && w.method !== 'ftao') w.method = 'ftao';
  })));
  return inp;
}

// Schema v11: engineer-reviewed distribution warnings per line ([{ key, message, date }], user request 2026-10-01)
export function migrateV10toV11(inp) {
  if (!inp) return inp;
  (inp.directions || []).forEach(d => (d.lines || []).forEach(ln => { if (!Array.isArray(ln.distReviewed)) ln.distReviewed = []; }));
  return inp;
}

// Schema v12: wind drift limit h / n (default 400), report only
export function migrateV11toV12(inp) {
  if (!inp) return inp;
  for (const [k, v] of Object.entries(projectV12Defaults())) if (inp[k] === undefined) inp[k] = v;
  return inp;
}

// Schema v13 (user 2026-10-13): wood species (DF-L / SP / SPF / HF; sets the DF/SP or SPF/HF hardware tables) and the
// posts & timbers grade (NDS Table 4D, 6x6 / 8x6 posts). Older items are DF-L; the P&T grade follows the dimension
// grade (Select Structural → SS, No.1 & Btr / No.1 → No.1, No.2 / No.3 → No.2, the lowest P&T grade).
const PT_FROM_DIM = { dfir_ss: 'dfir_pt_ss', dfir_no1btr: 'dfir_pt_no1', dfir_no1: 'dfir_pt_no1', dfir_no2: 'dfir_pt_no2', dfir_no3: 'dfir_pt_no2' };
export function migrateV12toV13(inp) {
  if (!inp) return inp;
  if (!inp.woodGrade) inp.woodGrade = 'dfir_no1';
  if (inp.species === undefined) inp.species = getGradeById(inp.woodGrade).species || 'DF-L';
  if (inp.postGrade === undefined) inp.postGrade = PT_FROM_DIM[inp.woodGrade] || speciesOf(inp.species).defaults[1];
  return inp;
}

const DEFINITION_MIGRATIONS = [
  { to: 4, up: migrateToV4 },
  { to: 5, up: migrateV4toV5 },
  { to: 6, up: migrateV5toV6 },
  { to: 7, up: migrateV6toV7 },
  { to: 8, up: migrateV7toV8 },
  { to: 9, up: migrateV8toV9 },
  { to: 10, up: migrateV9toV10 },
  { to: 11, up: migrateV10toV11 },
  { to: 12, up: migrateV11toV12 },
  { to: 13, up: migrateV12toV13 },
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
