import { el, clearEl, numOrBlank, sameNumber } from '../utils.js';
import { rich } from '../richText.js';

const round2 = v => Math.round(v * 100) / 100;
const round4 = v => Math.round(v * 10000) / 10000;

const BASE_SHEAR_FIELDS = [['sds', 'Sds'], ['cs', 'Cs'], ['ie', 'Ie'], ['omega0', 'Ω0'], ['k', 'k']];
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const round3 = v => Math.round(v * 1000) / 1000;
// v2 (2026-11-10, user review of the ELF calculator):
// - collector force per ASCE 7-22 §12.10.2.1: F_c = max(Ω₀·F_x [item 1], Ω₀·F_px,des [item 2], 1.25·ρ·F_px,min [item 3]);
//   the 25 % (§12.3.3.5) only on item 3 — "forces calculated using the seismic load effects including overstrength
//   need not be increased"; the old 0.4·S_DS·I_e·w_px term (F_px,max) is not part of the collector force;
// - "Light-frame diaphragm": Ω₀ reduced by 0.5, not less than 2.0 (flexible diaphragms), in items 1 and 2;
// - new exception (structures braced entirely by wood light-frame shear walls): F_c = 1.25·ρ·F_px,des (§12.10.1.1
//   forces, 2.3.6 combinations, no Ω₀);
// - diaphragm design force × 1.25 when the 25 % box is ticked; ratios F_px,des / F_x (DA k_D), F_c / F_px,des, F_c / F_x
//   (DA k_C).
export const ELF_CALC_VERSION = 'v2';
// Ω₀ for the collector items: reduced by 0.5 (not below 2.0) for a light-frame (flexible) diaphragm
export const omegaCollector = (om, lightFrame) => (lightFrame ? Math.min(om, Math.max(2.0, om - 0.5)) : om);

export const elfDiaphragmCollector = {
  id: 'elf_diaphragm_collector',
  label: 'ELF Diaphragm & Collector',
  schemaVersion: 1,
  calcVersion: ELF_CALC_VERSION,
  regenerateResults: true,
  refs: [
    { key: 'massSource', label: 'Seismic Mass Takeoff', sourceType: 'seismic_mass_takeoff',
      extract: (outputs) => ({ perLevel: outputs.perLevel, totalSeismicWeight: outputs.totalSeismicWeight }) },
    { key: 'baseShearSource', label: 'Seismic Base Shear', sourceType: 'seismic_base_shear',
      extract: (outputs) => ({ cs: outputs.cs, sds: outputs.sds, ie: outputs.ie, omega0: outputs.omega0, k: outputs.k }) },
  ],
  fields: [],
  outputFields: [],

  migrate(item) { return item; },

  // Copied Mass Takeoff levels / Base Shear coefficients that no longer match the linked items
  linkDiff(inputs, linked) {
    const changes = [];
    const mass = linked.massSource && linked.massSource.perLevel;
    if (mass) {
      const levels = inputs.levels || [];
      const sameList = mass.length === levels.length && mass.every(m => levels.some(lv => sameName(lv.name, m.label)));
      if (!sameList) {
        changes.push({ refKey: 'massSource', label: 'Level list', from: levels.map(l => l.name).join(', '), to: mass.map(m => m.label).join(', ') });
      } else {
        for (const m of mass) {
          const lv = levels.find(l => sameName(l.name, m.label));
          if (!sameNumber(lv.wx, m.seismicWeight, 0.05)) changes.push({ refKey: 'massSource', label: (m.label || 'Level') + ' W', from: lv.wx, to: m.seismicWeight });
          if (!sameNumber(lv.hx, m.hx, 0.005)) changes.push({ refKey: 'massSource', label: (m.label || 'Level') + ' hx', from: lv.hx, to: m.hx });
        }
      }
    }
    const bs = linked.baseShearSource;
    if (bs) {
      for (const [key, label] of BASE_SHEAR_FIELDS) {
        if (bs[key] == null) continue;
        if (!sameNumber(inputs[key], bs[key], 0.0005)) changes.push({ refKey: 'baseShearSource', label, from: inputs[key], to: bs[key] });
      }
    }
    return changes;
  },

  applyLinks(inputs, linked) {
    const mass = linked.massSource && linked.massSource.perLevel;
    if (mass) {
      const old = inputs.levels || [];
      // Same shape as picking the link, keeping Wpx for levels whose names still match
      inputs.levels = mass.map(m => {
        const prev = old.find(l => sameName(l.name, m.label));
        return { name: m.label || '', wx: m.seismicWeight != null ? String(m.seismicWeight) : '', hx: m.hx != null ? String(m.hx) : '', wpx: prev ? prev.wpx : '' };
      });
    }
    const bs = linked.baseShearSource;
    if (bs) for (const [key] of BASE_SHEAR_FIELDS) if (bs[key] != null) inputs[key] = String(bs[key]);
    return inputs;
  },

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

    // §12.3.3.5 25 % increase: on forces without Ω₀ only (diaphragm design force, item 3, the wood-shear-wall exception)
    const inc = inputs.increase25 ? 1.25 : 1.0;
    const om = omegaCollector(omega0, !!inputs.lightFrame);
    const exc = !!inputs.woodWallException;
    sorted.forEach(lv => {
      lv.fpxDesignInc = round2(inc * lv.fpxDesign);
      lv.kD = lv.fx > 0 ? round3(lv.fpxDesignInc / lv.fx) : null;
      if (exc) {
        lv.omega0Fx = null; lv.omega0Fpx = null; lv.minForce = null;
        lv.exceptionForce = round2(inc * rho * lv.fpxDesign);
        lv.collectorDesign = lv.exceptionForce;
        lv.governs = 'exception';
      } else {
        lv.omega0Fx = round2(om * lv.fx);
        lv.omega0Fpx = round2(om * lv.fpxDesign);
        lv.minForce = round2(inc * rho * lv.fpxMin);
        lv.exceptionForce = null;
        lv.collectorDesign = Math.max(lv.omega0Fx, lv.omega0Fpx, lv.minForce);
        lv.governs = lv.collectorDesign === lv.omega0Fx ? '1' : lv.collectorDesign === lv.omega0Fpx ? '2' : '3';
      }
      lv.fcOverFpx = lv.fpxDesign > 0 ? round3(lv.collectorDesign / lv.fpxDesign) : null;
      lv.kC = lv.fx > 0 ? round3(lv.collectorDesign / lv.fx) : null;
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
        fpxDesignInc: lv.fpxDesignInc, kD: lv.kD,
      })),
      collectorTable: sorted.map(lv => ({
        level: lv.name, omega0Fx: lv.omega0Fx, omega0Fpx: lv.omega0Fpx, minForce: lv.minForce, exceptionForce: lv.exceptionForce,
        designForce: lv.collectorDesign, governs: lv.governs, fcOverFpx: lv.fcOverFpx, kC: lv.kC,
      })),
      // the options as used (DA: Ω₀ shown, 25 % alignment check, base-shear match check)
      options: { omega0, omegaCollector: om, rho, lightFrame: !!inputs.lightFrame, increase25: !!inputs.increase25, woodWallException: exc },
      calcVersion: ELF_CALC_VERSION,
    };
  },

  renderForm(container, existingInputs, onSave, projectItems) {
    const inputs = existingInputs && existingInputs.sds !== undefined ? existingInputs : {
      sds: '', cs: '', ie: '1.0', omega0: '2.5', rho: '1.0', k: '1',
      lightFrame: false, increase25: false, woodWallException: false,
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

      // options (v2, user 2026-11-10): one per line, each with what it does
      const toggleBox = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.75rem' } });
      const tick = (key, label, note) => toggleBox.appendChild(el('label', { style: { display: 'flex', alignItems: 'flex-start', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' } },
        el('input', { type: 'checkbox', 'data-elf-option': key, checked: !!inputs[key], style: { marginTop: '3px' }, onChange(e) { inputs[key] = e.target.checked; } }),
        el('span', null, label, el('span', { style: { display: 'block', fontSize: '0.75rem', color: 'var(--ink-tertiary)' } }, note))));
      tick('lightFrame', 'Light-frame diaphragm — reduce Ω₀ by 0.5', 'Collector items 1 and 2 use Ω₀ − 0.5, not less than 2.0 (flexible diaphragm).');
      tick('increase25', '25 % increase (§12.3.3.5)', 'Applied to the diaphragm design force and to collector item 3 / the exception — never to a force that includes Ω₀ (§12.3.3.5 exception).');
      tick('woodWallException', 'Structure braced entirely by wood light-frame shear walls (§12.10.2.1 Exception)',
        'Collectors and their connections need only resist the §12.10.1.1 forces with the 2.3.6 combinations: F_c = ρ·F_px,des (× 1.25 when ticked), no Ω₀.');
      formBody.appendChild(toggleBox);

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
    const o = outputs.options || {};
    const v = outputs.baseShear;
    const w = outputs.totalW;
    container.appendChild(el('div', { style: { fontWeight: '600', marginBottom: '0.75rem', fontSize: '0.95rem' } },
      'V = C', el('sub', null, 's'), ' · W = ', el('span', { className: 'mono' }, v.toFixed(1) + ' kip'),
      el('span', { style: { color: 'var(--ink-tertiary)', marginLeft: '0.5rem', fontSize: '0.8rem' } }, '(W = ' + w.toFixed(1) + ' kip) — ASCE 7-22 Eq. 12.8-1')));
    // each column: its label and the ASCE 7-22 equation / section under it; equal column widths, headers wrap; every
    // symbol with its subscript / superscript (user 2026-11-10)
    const nodes = m => [].concat(rich(m) ?? []);
    // three header rows (user 2026-11-10): symbol (one line) · unit · ASCE 7-22 reference; every column the same width
    // (the table fills the page; below 7.5rem a column the table scrolls sideways instead of wrapping); everything centred
    const COL_MIN = 7.5; // rem — fits the longest symbol (1.25·F_px,des / F_x)
    function outputTable(title, cols, rows) {
      container.appendChild(el('div', { className: 'form-label', style: { marginTop: '0.75rem' } }, title));
      const tbl = el('table', { className: 'data-table elf-table', style: { tableLayout: 'fixed', width: '100%', minWidth: (cols.length * COL_MIN) + 'rem' } });
      const cell = { width: (100 / cols.length).toFixed(3) + '%', textAlign: 'center', textTransform: 'none', letterSpacing: 'normal', whiteSpace: 'nowrap', paddingLeft: '0.3rem', paddingRight: '0.3rem' };
      const head = (key, extra) => el('tr', { 'data-head': key }, ...cols.map(c => el('th', { style: { ...cell, ...extra(c) } }, ...nodes(c[key === 'label' ? 0 : key === 'unit' ? 1 : 2] || ''))));
      tbl.appendChild(head('label', () => ({ paddingBottom: '0.1rem', borderBottom: 'none', fontSize: '0.8rem' })));
      tbl.appendChild(head('unit', () => ({ padding: '0 0.6rem', borderBottom: 'none', fontWeight: 400 })));
      tbl.appendChild(head('ref', () => ({ paddingTop: '0.1rem', fontWeight: 400, fontSize: '0.7rem', color: 'var(--ink-tertiary)' })));
      rows.forEach(row => tbl.appendChild(el('tr', null, ...row.map((c, i) => el('td', { className: i === 0 ? '' : 'mono', style: { textAlign: 'center' } }, c)))));
      container.appendChild(el('div', { className: 'table-scroll' }, tbl));
    }
    const n2 = x => (Number.isFinite(x) ? x.toFixed(2) : '—'), n3 = x => (Number.isFinite(x) ? x.toFixed(3) : '—'), n4 = x => (Number.isFinite(x) ? x.toFixed(4) : '—');
    outputTable('ELF Story Shear (§12.8)', ELF_COLS, outputs.elfTable.map(r => [r.level, n2(r.wx), n2(r.hx), n2(r.wxhk), n4(r.cvx), n2(r.fx), n2(r.vx)]));
    outputTable('Diaphragm Forces (§12.10.1.1)', DIAPH_COLS(o), outputs.diaphragmTable.map(r => diaphRow(r, o, n2, n3)));
    container.appendChild(el('p', { style: { fontSize: '0.75rem', color: 'var(--ink-tertiary)', margin: '0.2rem 0 0' } }, ...nodes(OMEGA_NOTE(o))));
    outputTable('Collector Forces (§12.10.2.1)', COLL_COLS(o), outputs.collectorTable.map(r => collRow(r, o, n2, n3)));
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
        ['S_{DS}', sds], ['C_{s}', cs], ['I_{e}', ie],
        ['Ω₀', omega0], ['ρ', rho], ['k', k],
        ['Base shear V = C_{s}·W (Eq. 12.8-1)', outputs.baseShear.toFixed(2) + ' kip'],
        ['Total W', outputs.totalW.toFixed(1) + ' kip'],
      ],
    });

    const o = outputs.options || {};
    sections.push({
      title: 'Options',
      rows: [
        ['Light-frame diaphragm', o.lightFrame ? 'Ω₀ − 0.5, not less than 2.0 → Ω₀ = ' + (o.omegaCollector ?? '') + ' in collector items (1) and (2)' : 'No'],
        ['25 % increase (§12.3.3.5)', o.increase25 ? 'Applied to F_{px,des} and collector item (3) / the exception (never with Ω₀)' : 'No'],
        ['Braced entirely by wood light-frame shear walls (§12.10.2.1 Exception)', o.woodWallException ? 'Yes — F_{c} = ρ·F_{px,des}' + (o.increase25 ? ' × 1.25' : '') + ', no Ω₀' : 'No'],
      ],
    });

    // headers: the same column definitions as the screen (label + reference), markup _{…} / ^{…}; equal widths
    const n2 = x => (Number.isFinite(x) ? x.toFixed(2) : '—'), n3 = x => (Number.isFinite(x) ? x.toFixed(3) : '—'), n4 = x => (Number.isFinite(x) ? x.toFixed(4) : '—');
    const pdfTable = (cols, rows) => ({ headers: cols.map(([l, u, e]) => l + (u ? ' (' + u + ')' : '') + (e ? ' [' + e + ']' : '')), rows, colWidths: cols.map(() => 1 / cols.length) });
    sections.push({ title: 'ELF Story Shear — ASCE 7-22 §12.8',
      table: pdfTable(ELF_COLS, outputs.elfTable.map(r => [r.level, n2(r.wx), n2(r.hx), n2(r.wxhk), n4(r.cvx), n2(r.fx), n2(r.vx)])) });
    sections.push({ title: 'Diaphragm Design Forces — ASCE 7-22 §12.10.1.1',
      table: pdfTable(DIAPH_COLS(o), outputs.diaphragmTable.map(r => diaphRow(r, o, n2, n3))) });
    sections.push({ text: OMEGA_NOTE(o) });
    sections.push({ title: 'Collector Design Forces — ASCE 7-22 §12.10.2.1',
      table: pdfTable(COLL_COLS(o), outputs.collectorTable.map(r => collRow(r, o, n2, n3))) });

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
        { ref: 'Eq. 12.8-13',
          parts: [
            { t: 'C' }, { t: 'vx', sub: true }, { t: ' = (w' }, { t: 'x', sub: true },
            { t: ' · h' }, { t: 'x', sub: true }, { t: 'k', sup: true },
            { t: ') / ' }, { t: 'S', greek: true }, { t: '(w' }, { t: 'i', sub: true },
            { t: ' · h' }, { t: 'i', sub: true }, { t: 'k', sup: true }, { t: ')' },
          ] },
        { ref: 'Eq. 12.8-12',
          parts: [{ t: 'F' }, { t: 'x', sub: true }, { t: ' = C' }, { t: 'vx', sub: true }, { t: ' · V' }] },
        { ref: 'Eq. 12.8-14',
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
        { ref: '§12.10.2.1 (1)',
          parts: [
            { t: 'F' }, { t: 'c,1', sub: true }, { t: ' = ' }, { t: 'W', greek: true }, { t: '0', sub: true },
            { t: ' · F' }, { t: 'x', sub: true },
          ] },
        { ref: '§12.10.2.1 (2)',
          parts: [
            { t: 'F' }, { t: 'c,2', sub: true }, { t: ' = ' }, { t: 'W', greek: true }, { t: '0', sub: true },
            { t: ' · F' }, { t: 'px,des', sub: true },
          ] },
        { ref: '§12.10.2.1 (3)',
          parts: [
            { t: 'F' }, { t: 'c,3', sub: true }, { t: ' = 1.25 · ' }, { t: 'r', greek: true }, { t: ' · F' }, { t: 'px,min', sub: true },
            { t: '  (1.25 only with the §12.3.3.5 increase)' },
          ] },
        { ref: 'Governing',
          parts: [
            { t: 'F' }, { t: 'c', sub: true }, { t: ' = max(F' }, { t: 'c,1', sub: true },
            { t: ', F' }, { t: 'c,2', sub: true }, { t: ', F' }, { t: 'c,3', sub: true }, { t: ')' },
          ] },
        { ref: '§12.10.2.1 Exc.',
          parts: [
            { t: 'Wood light-frame shear walls: F' }, { t: 'c', sub: true }, { t: ' = 1.25 · ' }, { t: 'r', greek: true },
            { t: ' · F' }, { t: 'px,des', sub: true }, { t: '  (no ' }, { t: 'W', greek: true }, { t: '0', sub: true }, { t: ')' },
          ] },
        { ref: 'Light-frame',
          parts: [
            { t: 'W', greek: true }, { t: '0', sub: true }, { t: ' reduced by 0.5, not less than 2.0 (flexible diaphragm)' },
          ] },
      ],
    });

    return sections;
  },
};

// ── column definitions shared by the screen tables and the PDF: [label, ASCE 7-22 reference], both in the rich-text
// markup (X_{sub}, X^{sup}) so every symbol is drawn with its subscript / superscript on screen and in the PDF; the
// references kept short so the columns stay equal and narrow (user 2026-11-10)
const ELF_COLS = [['Level', '', ''], ['w_{x}', 'kip', ''], ['h_{x}', 'ft', ''], ['w_{x}·h_{x}^{k}', '', ''],
  ['C_{vx}', '', 'Eq. 12.8-13'], ['F_{x}', 'kip', 'Eq. 12.8-12'], ['V_{x}', 'kip', 'Eq. 12.8-14']]; // ASCE 7-22 numbering (user 2026-11-10)
function DIAPH_COLS(o) {
  return [['Level', '', ''], ['w_{px}', 'kip', '§12.10.1.1'], ['F_{px}', 'kip', 'Eq. 12.10-1'], ['F_{px,min}', 'kip', 'Eq. 12.10-3'],
    ['F_{px,max}', 'kip', 'Eq. 12.10-2'], ['F_{px,des}', 'kip', '§12.10.1.1'],
    ...(o.increase25 ? [['1.25·F_{px,des}', 'kip', '§12.3.3.5']] : []),
    [(o.increase25 ? '1.25·' : '') + 'F_{px,des} / F_{x}', '', '= k_{D} (DA)']];
}
function COLL_COLS(o) {
  const tail = [['F_{c}', 'kip', o.woodWallException ? '§12.10.2.1 Exc.' : 'max of (1)–(3)'], ['F_{c} / F_{px,des}', '', ''], ['F_{c} / F_{x}', '', '= k_{C} (DA)']];
  const inc = o.increase25 ? '1.25·' : '';
  if (o.woodWallException) return [['Level', '', ''], [inc + 'ρ·F_{px,des}', 'kip', '§12.10.2.1 Exc.'], ...tail];
  return [['Level', '', ''], ['Ω_{0}·F_{x}', 'kip', '§12.10.2.1(1)'], ['Ω_{0}·F_{px,des}', 'kip', '§12.10.2.1(2)'], [inc + 'ρ·F_{px,min}', 'kip', '§12.10.2.1(3)'], ...tail];
}
function diaphRow(r, o, n2, n3) {
  return [r.level, n2(r.wpx), n2(r.fpxCalc), n2(r.fpxMin), n2(r.fpxMax), n2(r.fpxDesign), ...(o.increase25 ? [n2(r.fpxDesignInc)] : []), n3(r.kD)];
}
function collRow(r, o, n2, n3) {
  const g = k => (r.governs === k ? ' ◄' : '');
  if (o.woodWallException) return [r.level, n2(r.exceptionForce), n2(r.designForce), n3(r.fcOverFpx), n3(r.kC)];
  return [r.level, n2(r.omega0Fx) + g('1'), n2(r.omega0Fpx) + g('2'), n2(r.minForce) + g('3'), n2(r.designForce), n3(r.fcOverFpx), n3(r.kC)];
}
function OMEGA_NOTE(o) {
  return 'Ω_{0} = ' + (o.omega0 ?? '') + (o.lightFrame ? ' → ' + (o.omegaCollector ?? '') + ' for collector items (1) and (2) (light-frame diaphragm: Ω_{0} − 0.5, not less than 2.0)' : '')
    + '; ρ = ' + (o.rho ?? 1) + '. The 25 % increase (§12.3.3.5) ' + (o.increase25 ? 'is applied to F_{px,des} and to collector item (3) / the exception, never to a force with Ω_{0}.' : 'is not applied.')
    + (o.woodWallException ? ' Structure braced entirely by wood light-frame shear walls: collectors use the §12.10.2.1 Exception (no Ω_{0}).' : '')
    + ' ◄ = governing item.';
}
