import { el, clearEl, numOrBlank } from '../utils.js';
import {
  lookupIe, determineSdc, lookupCu,
  SITE_CLASSES, RISK_CATEGORIES, PERIOD_TYPES, STRUCTURAL_SYSTEMS, GROUND_MOTION_SOURCES,
} from './seismicBaseShearTables.js';

const round2 = v => Math.round(v * 100) / 100;
const round4 = v => Math.round(v * 10000) / 10000;

function computeAll(inputs) {
  const ss = parseFloat(inputs.ss) || 0;
  const s1 = parseFloat(inputs.s1) || 0;
  const sms = parseFloat(inputs.sms) || 0;
  const sm1 = parseFloat(inputs.sm1) || 0;
  const siteClass = inputs.siteClass || 'D';
  const riskCategory = inputs.riskCategory || 'II';
  const tl = parseFloat(inputs.tl) || 8;

  const sds = round4((2 / 3) * sms);
  const sd1 = round4((2 / 3) * sm1);

  const ie = lookupIe(riskCategory);
  const { sdcFromSds, sdcFromSd1, seismicDesignCategory } = determineSdc(sds, sd1, s1, riskCategory);

  const sys = STRUCTURAL_SYSTEMS.find(s => s.key === inputs.systemKey);
  let r, omega0, cd, systemLabel;
  if (sys && sys.key !== 'custom' && sys.r != null) {
    r = sys.r;
    omega0 = sys.omega0;
    cd = sys.cd;
    systemLabel = sys.label;
  } else {
    r = parseFloat(inputs.rManual) || 1;
    omega0 = parseFloat(inputs.omega0Manual) || 2.5;
    cd = parseFloat(inputs.cdManual) || 3;
    systemLabel = 'Custom';
  }

  if (inputs.flexibleDiaphragm && omega0 >= 2.5) {
    omega0 = round2(omega0 - 0.5);
  }

  const periodDef = PERIOD_TYPES.find(p => p.key === inputs.periodType) || PERIOD_TYPES[4];
  const ct = periodDef.ct;
  const x = periodDef.x;
  const hn = parseFloat(inputs.hn) || 0;

  const ta = round4(ct * Math.pow(Math.max(hn, 0), x));
  const cu = lookupCu(sd1);
  const tUpper = round4(cu * ta);
  const tComputedRaw = parseFloat(inputs.tComputed) || 0;
  const tComputed = tComputedRaw > 0 ? tComputedRaw : null;
  let tDesign;
  if (tComputed) {
    tDesign = round4(Math.min(tComputed, tUpper));
  } else {
    tDesign = ta;
  }

  const rOverIe = round4(r / ie);
  const csCalc = rOverIe > 0 ? round4(sds / rOverIe) : 0;
  let csMax;
  if (tDesign > 0 && rOverIe > 0) {
    if (tDesign <= tl) {
      csMax = round4(sd1 / (tDesign * rOverIe));
    } else {
      csMax = round4((sd1 * tl) / (tDesign * tDesign * rOverIe));
    }
  } else {
    csMax = Infinity;
  }
  const csMin = round4(Math.max(0.044 * sds * ie, 0.01));
  let csMinS1 = null;
  if (s1 >= 0.6 && rOverIe > 0) {
    csMinS1 = round4(0.5 * s1 / rOverIe);
  }
  const effectiveMin = Math.max(csMin, csMinS1 || 0);
  const cs = round4(Math.max(Math.min(csCalc, csMax), effectiveMin));

  let csGoverning;
  if (cs <= csCalc && csCalc <= csMax && csCalc >= effectiveMin) {
    csGoverning = 'Eq. 12.8-2';
  } else if (csMax <= csCalc && csMax >= effectiveMin) {
    csGoverning = tDesign <= tl ? 'Eq. 12.8-3' : 'Eq. 12.8-4';
  } else if (csMinS1 != null && effectiveMin === csMinS1) {
    csGoverning = 'Eq. 12.8-6';
  } else {
    csGoverning = 'Eq. 12.8-5';
  }

  let k;
  if (tDesign <= 0.5) k = 1;
  else if (tDesign >= 2.5) k = 2;
  else k = round4(1 + (tDesign - 0.5) / 2.0);

  return {
    groundMotionSource: inputs.groundMotionSource || 'asce_hazard',
    ss, s1, sms, sm1, siteClass, sds, sd1,
    riskCategory, ie,
    sdcFromSds, sdcFromSd1, seismicDesignCategory,
    systemLabel, r, omega0, cd, flexibleDiaphragm: !!inputs.flexibleDiaphragm,
    ct, x, hn, ta, cu, tUpper, tComputed, tDesign, tl,
    rOverIe, csCalc, csMax: csMax === Infinity ? null : csMax, csMin, csMinS1, cs, csGoverning,
    k,
    calcVersion: 'v1',
  };
}

export const seismicBaseShear = {
  id: 'seismic_base_shear',
  label: 'Seismic Base Shear',
  schemaVersion: 1,
  calcVersion: 'v1',
  noOutputSection: true,
  regenerateResults: true,

  refs: [],

  fields: [],
  outputFields: [],

  migrate(item) { return item; },

  summaryLabel(inputs, outputs) {
    const sdc = outputs && outputs.seismicDesignCategory;
    const cs = outputs && outputs.cs;
    return 'Seismic Base Shear' +
      (sdc ? ' — SDC ' + sdc : '') +
      (cs != null ? ' — Cs = ' + cs.toFixed(4) : '');
  },

  calc(inputs) {
    return computeAll(inputs);
  },

  renderForm(container, existingInputs, onSave, projectItems, onInputChange) {
    const inputs = existingInputs && existingInputs.sms !== undefined ? existingInputs : {
      groundMotionSource: 'asce_hazard',
      ss: '', s1: '', sms: '', sm1: '', siteClass: 'Default',
      riskCategory: 'II',
      systemKey: 'a15', rManual: '', omega0Manual: '', cdManual: '',
      flexibleDiaphragm: false,
      periodType: 'other', hn: '', tl: '8', tComputed: '',
      refs: {}, notes: '',
    };
    if (!inputs.refs) inputs.refs = {};
    clearEl(container);

    const formBody = el('div');

    function notifyChange() { if (onInputChange) onInputChange(); }

    function paramBox(labelParts, key, placeholder, width) {
      return el('div', { className: 'form-group', style: { marginBottom: 0 } },
        el('label', { className: 'form-label' }, ...labelParts),
        el('input', { className: 'form-input mono', style: { width: width || '80px' },
          type: 'number', step: 'any', placeholder, value: numOrBlank(inputs[key]),
          onChange(e) { inputs[key] = e.target.value; notifyChange(); renderAll(); } }));
    }

    function sectionLabel(text) {
      return el('div', { className: 'form-label', style: { marginTop: '1rem', marginBottom: '0.25rem', fontSize: '0.85rem' } }, text);
    }

    function eqRow(label, equation, value, ref) {
      return el('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'baseline', fontSize: '0.85rem', marginBottom: '0.2rem', flexWrap: 'wrap' } },
        el('span', { style: { color: 'var(--ink-secondary)', minWidth: '60px' } }, label),
        el('span', { style: { fontFamily: "'IBM Plex Mono', Consolas, monospace", color: 'var(--ink)' } }, equation),
        el('span', { style: { fontFamily: "'IBM Plex Mono', Consolas, monospace", fontWeight: '600' } }, '= ' + value),
        ref ? el('span', { style: { color: 'var(--ink-tertiary)', fontSize: '0.78rem' } }, ref) : null);
    }

    function eqHighlight(equation, value, ref) {
      return el('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'baseline', fontSize: '0.9rem', fontWeight: '600', marginBottom: '0.2rem', flexWrap: 'wrap',
        padding: '0.25rem 0.5rem', background: 'var(--accent-bg)', borderRadius: '3px', marginTop: '0.25rem' } },
        el('span', { style: { fontFamily: "'IBM Plex Mono', Consolas, monospace" } }, equation),
        el('span', { style: { fontFamily: "'IBM Plex Mono', Consolas, monospace" } }, '= ' + value),
        ref ? el('span', { style: { color: 'var(--ink-secondary)', fontSize: '0.78rem', fontWeight: '400' } }, ref) : null);
    }

    function renderAll() {
      clearEl(formBody);

      const p = computeAll(inputs);

      // --- Site Ground Motion §11.4 ---
      formBody.appendChild(sectionLabel('Site Ground Motion — ASCE 7-22 §11.4'));

      const srcSelect = el('select', { className: 'form-select', style: { width: '220px', marginBottom: '0.5rem' },
        onChange(e) { inputs.groundMotionSource = e.target.value; notifyChange(); } });
      GROUND_MOTION_SOURCES.forEach(src => {
        const opt = el('option', { value: src.key }, src.label);
        if (inputs.groundMotionSource === src.key) opt.selected = true;
        srcSelect.appendChild(opt);
      });
      formBody.appendChild(el('div', { className: 'form-group', style: { marginBottom: '0.35rem' } },
        el('label', { className: 'form-label' }, 'Source of Ground Motion Values'), srcSelect));

      const gmRow1 = el('div', { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.5rem' } });
      gmRow1.appendChild(paramBox(['S', el('sub', null, 'S'), ' (g)'], 'ss', '1.0'));
      gmRow1.appendChild(paramBox(['S', el('sub', null, '1'), ' (g)'], 's1', '0.4'));

      const scSelect = el('select', { className: 'form-select', style: { width: '280px' },
        onChange(e) { inputs.siteClass = e.target.value; notifyChange(); renderAll(); } });
      SITE_CLASSES.forEach(sc => {
        const opt = el('option', { value: sc.key }, sc.label);
        if (inputs.siteClass === sc.key) opt.selected = true;
        scSelect.appendChild(opt);
      });
      gmRow1.appendChild(el('div', { className: 'form-group', style: { marginBottom: 0 } },
        el('label', { className: 'form-label' }, 'Site Class'), scSelect));
      formBody.appendChild(gmRow1);

      const gmRow2 = el('div', { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.5rem' } });
      gmRow2.appendChild(paramBox(['S', el('sub', null, 'MS'), ' (g)'], 'sms', '1.0'));
      gmRow2.appendChild(paramBox(['S', el('sub', null, 'M1'), ' (g)'], 'sm1', '0.6'));
      formBody.appendChild(gmRow2);

      if (p.sms > 0 || p.sm1 > 0) {
        const cBlock = el('div', { style: { marginLeft: '0.25rem', marginBottom: '0.5rem' } });
        cBlock.appendChild(eqRow('S_DS', '⅔ × ' + p.sms.toFixed(2), p.sds.toFixed(2), '(Eq. 11.4-3)'));
        cBlock.appendChild(eqRow('S_D1', '⅔ × ' + p.sm1.toFixed(2), p.sd1.toFixed(2), '(Eq. 11.4-4)'));
        formBody.appendChild(cBlock);
      }

      // --- Risk Category & Importance §11.5 ---
      formBody.appendChild(sectionLabel('Risk Category & Importance — §11.5'));
      const rcRow = el('div', { style: { display: 'flex', gap: '0.75rem', alignItems: 'flex-end', marginBottom: '0.5rem' } });
      const rcSelect = el('select', { className: 'form-select', style: { width: '80px' },
        onChange(e) { inputs.riskCategory = e.target.value; notifyChange(); renderAll(); } });
      RISK_CATEGORIES.forEach(rc => {
        const opt = el('option', { value: rc.key }, rc.label);
        if (inputs.riskCategory === rc.key) opt.selected = true;
        rcSelect.appendChild(opt);
      });
      rcRow.appendChild(el('div', { className: 'form-group', style: { marginBottom: 0 } },
        el('label', { className: 'form-label' }, 'Risk Category'), rcSelect));
      rcRow.appendChild(el('div', { style: { fontSize: '0.85rem', color: 'var(--ink-secondary)', paddingBottom: '0.4rem', fontFamily: "'IBM Plex Mono', Consolas, monospace" } },
        'Ie = ' + p.ie.toFixed(2) + '  (Table 1.5-2)'));
      formBody.appendChild(rcRow);

      // --- SDC §11.6 ---
      if (p.sds > 0 || p.sd1 > 0) {
        formBody.appendChild(sectionLabel('Seismic Design Category — §11.6'));
        const sdcBlock = el('div', { style: { marginLeft: '0.25rem', marginBottom: '0.5rem' } });
        sdcBlock.appendChild(eqRow('Table 11.6-1', 'SDS = ' + p.sds.toFixed(2), 'SDC ' + p.sdcFromSds, ''));
        sdcBlock.appendChild(eqRow('Table 11.6-2', 'SD1 = ' + p.sd1.toFixed(2), 'SDC ' + p.sdcFromSd1, ''));
        sdcBlock.appendChild(eqHighlight('Governing SDC', p.seismicDesignCategory, ''));
        formBody.appendChild(sdcBlock);
      }

      // --- SFRS §12.2 ---
      formBody.appendChild(sectionLabel('Seismic Force-Resisting System — §12.2 (Table 12.2-1)'));

      const sysSelect = el('select', { className: 'form-select', style: { maxWidth: '480px', marginBottom: '0.5rem' },
        onChange(e) { inputs.systemKey = e.target.value; notifyChange(); renderAll(); } });
      let lastGroup = '';
      let currentOptgroup = null;
      STRUCTURAL_SYSTEMS.forEach(sys => {
        if (sys.group !== lastGroup) {
          currentOptgroup = el('optgroup', { label: sys.group });
          sysSelect.appendChild(currentOptgroup);
          lastGroup = sys.group;
        }
        const opt = el('option', { value: sys.key },
          sys.label + (sys.r != null ? ' (R=' + sys.r + ')' : ''));
        if (inputs.systemKey === sys.key) opt.selected = true;
        (currentOptgroup || sysSelect).appendChild(opt);
      });
      formBody.appendChild(sysSelect);

      const isCustom = inputs.systemKey === 'custom';
      if (isCustom) {
        const manRow = el('div', { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.5rem' } });
        manRow.appendChild(paramBox(['R'], 'rManual', '6.5'));
        manRow.appendChild(paramBox(['Ω', el('sub', null, '0')], 'omega0Manual', '2.5'));
        manRow.appendChild(paramBox(['C', el('sub', null, 'd')], 'cdManual', '4.0'));
        formBody.appendChild(manRow);
      } else {
        formBody.appendChild(el('div', { style: { fontSize: '0.85rem', fontFamily: "'IBM Plex Mono', Consolas, monospace", color: 'var(--ink-secondary)', marginBottom: '0.35rem' } },
          'R = ' + p.r + '    Ω₀ = ' + p.omega0 + (inputs.flexibleDiaphragm && p.omega0 < (STRUCTURAL_SYSTEMS.find(s => s.key === inputs.systemKey)?.omega0 || 0) ? ' (reduced)' : '') +
          '    Cd = ' + p.cd));
      }

      const flexCheck = el('input', { type: 'checkbox', checked: !!inputs.flexibleDiaphragm,
        onChange(e) { inputs.flexibleDiaphragm = e.target.checked; notifyChange(); renderAll(); } });
      formBody.appendChild(el('label', { style: { display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', cursor: 'pointer', marginBottom: '0.5rem' } },
        flexCheck, 'Flexible diaphragm — reduce Ω₀ by ½ where Ω₀ ≥ 2.5 (Table 12.2-1 footnote b)'));

      // --- Period §12.8.2 ---
      formBody.appendChild(sectionLabel('Approximate Period — §12.8.2'));
      const ptSelect = el('select', { className: 'form-select', style: { maxWidth: '380px', marginBottom: '0.5rem' },
        onChange(e) { inputs.periodType = e.target.value; notifyChange(); renderAll(); } });
      PERIOD_TYPES.forEach(pt => {
        const opt = el('option', { value: pt.key }, pt.label + ' (Ct=' + pt.ct + ', x=' + pt.x + ')');
        if (inputs.periodType === pt.key) opt.selected = true;
        ptSelect.appendChild(opt);
      });
      formBody.appendChild(el('div', { className: 'form-group', style: { marginBottom: '0.25rem' } },
        el('label', { className: 'form-label' }, 'Structure Type (Table 12.8-2)'), ptSelect));

      const perRow = el('div', { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.5rem' } });
      perRow.appendChild(paramBox(['h', el('sub', null, 'n'), ' (ft)'], 'hn', '30'));
      perRow.appendChild(paramBox(['T', el('sub', null, 'L'), ' (sec)'], 'tl', '8'));
      perRow.appendChild(paramBox(['T computed (sec)'], 'tComputed', 'optional', '100px'));
      formBody.appendChild(perRow);

      if (p.hn > 0) {
        const pBlock = el('div', { style: { marginLeft: '0.25rem', marginBottom: '0.5rem' } });
        pBlock.appendChild(eqRow('Ta', 'Ct × hn^x = ' + p.ct + ' × ' + p.hn.toFixed(2) + '^' + p.x, p.ta.toFixed(2) + ' sec', '(Eq. 12.8-7)'));
        pBlock.appendChild(eqRow('Cu', '(Table 12.8-1, SD1=' + p.sd1.toFixed(2) + ')', p.cu.toFixed(2), ''));
        pBlock.appendChild(eqRow('Cu×Ta', p.cu.toFixed(2) + ' × ' + p.ta.toFixed(2), p.tUpper.toFixed(2) + ' sec', ''));
        if (p.tComputed && p.tComputed > p.tUpper) {
          pBlock.appendChild(el('div', { style: { fontSize: '0.82rem', color: 'var(--stale)', marginBottom: '0.15rem' } },
            'T computed (' + p.tComputed.toFixed(2) + 's) capped at Cu × Ta'));
        }
        pBlock.appendChild(eqHighlight('Design Period T', p.tDesign.toFixed(2) + ' sec', ''));
        formBody.appendChild(pBlock);
      }

      // --- Cs §12.8.1.1 ---
      if (p.sds > 0 && p.r > 0 && p.hn > 0) {
        formBody.appendChild(sectionLabel('Seismic Response Coefficient — §12.8.1.1'));
        const csBlock = el('div', { style: { marginLeft: '0.25rem', marginBottom: '0.5rem' } });

        csBlock.appendChild(eqRow('Cs',
          'SDS/(R/Ie) = ' + p.sds.toFixed(2) + '/(' + p.r + '/' + p.ie.toFixed(2) + ')',
          p.csCalc.toFixed(2), '(Eq. 12.8-2)'));

        if (p.csMax != null) {
          const maxEq = p.tDesign <= p.tl ? 'Eq. 12.8-3' : 'Eq. 12.8-4';
          if (p.tDesign <= p.tl) {
            csBlock.appendChild(eqRow('Cs,max',
              'SD1/(T×R/Ie) = ' + p.sd1.toFixed(2) + '/(' + p.tDesign.toFixed(2) + '×' + p.r + '/' + p.ie.toFixed(2) + ')',
              p.csMax.toFixed(2), '(' + maxEq + ')'));
          } else {
            csBlock.appendChild(eqRow('Cs,max',
              'SD1·TL/(T²×R/Ie) = ' + p.sd1.toFixed(2) + '·' + p.tl + '/(' + p.tDesign.toFixed(2) + '²×' + p.r + '/' + p.ie.toFixed(2) + ')',
              p.csMax.toFixed(2), '(' + maxEq + ')'));
          }
        }

        csBlock.appendChild(eqRow('Cs,min',
          'max(0.044×SDS×Ie, 0.01) = max(0.044×' + p.sds.toFixed(2) + '×' + p.ie.toFixed(2) + ', 0.01)',
          p.csMin.toFixed(2), '(Eq. 12.8-5)'));

        if (p.csMinS1 != null) {
          csBlock.appendChild(eqRow('Cs,min(S1)',
            '0.5×S1/(R/Ie) = 0.5×' + p.s1.toFixed(2) + '/(' + p.r + '/' + p.ie.toFixed(2) + ')',
            p.csMinS1.toFixed(2), '(Eq. 12.8-6, S1≥0.6g)'));
        }

        csBlock.appendChild(eqHighlight('Governing Cs', p.cs.toFixed(2), '(' + p.csGoverning + ')'));

        csBlock.appendChild(el('div', { style: { fontSize: '0.82rem', color: 'var(--ink-tertiary)', marginTop: '0.25rem', fontFamily: "'IBM Plex Mono', Consolas, monospace" } },
          'k = ' + p.k.toFixed(2) + '  (§12.8.3, T = ' + p.tDesign.toFixed(2) + 's)'));
        formBody.appendChild(csBlock);
      }

      // --- Notes ---
      formBody.appendChild(el('div', { className: 'form-group', style: { marginTop: '0.75rem' } },
        el('textarea', { className: 'form-input', rows: '2', placeholder: 'Assumptions, notes…', value: inputs.notes || '',
          onInput(e) { inputs.notes = e.target.value; notifyChange(); } })));
    }

    renderAll();
    container.appendChild(formBody);
    container.appendChild(el('div', { style: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' } },
      el('button', { className: 'btn btn-primary', type: 'button', onClick() { onSave(inputs); } }, 'Calculate & Save')));
  },

  renderOutputs(container, outputs) {},

  pdfSections(inputs, outputs) {
    const sections = [];
    if (!outputs) return sections;
    const f = v => (v || 0).toFixed(2);

    const srcLabel = GROUND_MOTION_SOURCES.find(s => s.key === outputs.groundMotionSource)?.label || outputs.groundMotionSource || '—';
    sections.push({
      title: 'Site Ground Motion — ASCE 7-22 §11.4',
      rows: [
        ['Source', srcLabel],
        ['SS', f(outputs.ss) + ' g'],
        ['S1', f(outputs.s1) + ' g'],
        ['Site Class', outputs.siteClass || '—'],
        ['SMS', f(outputs.sms) + ' g'],
        ['SM1', f(outputs.sm1) + ' g'],
        ['SDS = (2/3) SMS', f(outputs.sds)],
        ['SD1 = (2/3) SM1', f(outputs.sd1)],
      ],
    });

    sections.push({
      title: 'Risk Category, Importance Factor & SDC — §11.5 / §11.6',
      rows: [
        ['Risk Category', outputs.riskCategory || '—'],
        ['Ie', f(outputs.ie)],
        ['SDC from SDS', outputs.sdcFromSds || '—'],
        ['SDC from SD1', outputs.sdcFromSd1 || '—'],
        ['Governing SDC', outputs.seismicDesignCategory || '—'],
      ],
    });

    const sysRows = [
      ['System', outputs.systemLabel || 'Custom'],
      ['R', f(outputs.r)],
      ['Omega0', f(outputs.omega0) + (outputs.flexibleDiaphragm ? ' (reduced)' : '')],
      ['Cd', f(outputs.cd)],
    ];
    sections.push({ title: 'Seismic Force-Resisting System — §12.2', rows: sysRows });

    const periodRows = [
      ['hn', f(outputs.hn) + ' ft'],
      ['Ta = Ct x hn^x', f(outputs.ta) + ' sec'],
      ['Cu', f(outputs.cu)],
      ['Cu x Ta', f(outputs.tUpper) + ' sec'],
    ];
    if (outputs.tComputed) periodRows.push(['T from analysis', f(outputs.tComputed) + ' sec']);
    periodRows.push(['Design Period T', f(outputs.tDesign) + ' sec']);
    periodRows.push(['TL', f(outputs.tl) + ' sec']);
    sections.push({ title: 'Approximate Period — §12.8.2', rows: periodRows });

    // Combined Cs equations + values (single section, no separate equations page)
    const R = outputs.r || 1;
    const Ie = outputs.ie || 1;
    const T = outputs.tDesign || 0;
    const eqs = [];

    eqs.push({ desc: 'Seismic Response Coefficient — §12.8.1.1', parts: [] });

    eqs.push({ ref: 'Eq. 12.8-2',
      parts: [{ t: 'C' }, { t: 's', sub: true },
        { t: ' = S' }, { t: 'DS', sub: true }, { t: ' / (R/I' }, { t: 'e', sub: true },
        { t: ') = ' + f(outputs.sds) + '/(' + f(R) + '/' + f(Ie) + ') = ' + f(outputs.csCalc) }] });

    if (outputs.csMax != null) {
      if (T <= (outputs.tl || 8)) {
        eqs.push({ ref: 'Eq. 12.8-3',
          parts: [{ t: 'C' }, { t: 's,max', sub: true },
            { t: ' = S' }, { t: 'D1', sub: true }, { t: ' / (T·R/I' }, { t: 'e', sub: true },
            { t: ') = ' + f(outputs.sd1) + '/(' + f(T) + '·' + f(R) + '/' + f(Ie) + ') = ' + f(outputs.csMax) }] });
      } else {
        eqs.push({ ref: 'Eq. 12.8-4',
          parts: [{ t: 'C' }, { t: 's,max', sub: true },
            { t: ' = S' }, { t: 'D1', sub: true }, { t: '·T' }, { t: 'L', sub: true },
            { t: ' / (T' }, { t: '2', sup: true }, { t: '·R/I' }, { t: 'e', sub: true },
            { t: ') = ' + f(outputs.csMax) }] });
      }
    }

    eqs.push({ ref: 'Eq. 12.8-5',
      parts: [{ t: 'C' }, { t: 's,min', sub: true },
        { t: ' = max(0.044·S' }, { t: 'DS', sub: true }, { t: '·I' }, { t: 'e', sub: true },
        { t: ', 0.01) = ' + f(outputs.csMin) }] });

    if (outputs.csMinS1 != null) {
      eqs.push({ ref: 'Eq. 12.8-6',
        parts: [{ t: 'C' }, { t: 's,min', sub: true },
          { t: ' = 0.5·S' }, { t: '1', sub: true }, { t: '/(R/I' }, { t: 'e', sub: true },
          { t: ') = ' + f(outputs.csMinS1) }, { t: '  [S' }, { t: '1', sub: true }, { t: '≥0.6g]' }] });
    }

    eqs.push({ desc: 'Governing: Cs = ' + f(outputs.cs) + '  (' + (outputs.csGoverning || '') + ')    k = ' + f(outputs.k), parts: [] });

    sections.push({ title: 'Seismic Response Coefficient — §12.8.1.1', equations: eqs });

    if (inputs.notes) sections.push({ title: 'Notes', text: inputs.notes });

    return sections;
  },
};
