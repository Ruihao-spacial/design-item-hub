// Diaphragm to LRS — flexible diaphragm loads to the lines of resistance (seismic, 1.0E).
// Inputs are the source of truth; results are always regenerated (regenerateResults).
// Engine: diaphragmToLrsCalc.js. Beam diagram: diaphragmToLrsDiagram.js. PDF: pdfSections below.
import { el, clearEl, numOrBlank, sameNumber } from '../utils.js';
import { calcAll, CALC_VERSION, autoTag, levelTag, tagged, isSimple, num, leverRuleText } from './diaphragmToLrsCalc.js';
import { DLRS_SCHEMA, migrateItem, normalizeInputs } from './diaphragmToLrsMigrate.js';
import { renderDiaphragmDiagram, diagramSize } from './diaphragmToLrsDiagram.js';
import { diaphragmPdfSections } from './diaphragmToLrsReport.js';
import { renderVerificationTab } from './diaphragmToLrsVerify.js';

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const f2 = v => (Number.isFinite(v) ? v.toFixed(2) : '—');
let _uid = 0;
export const uid = p => p + '-' + Date.now().toString(36) + '-' + (++_uid).toString(36);

export function newLevel(name, fx) { return { id: uid('lv'), name: name || '', tag: '', fx: fx == null ? '' : String(fx) }; }
export function newDirection(name) { return { id: uid('dir'), name: name || '', lines: [], groups: [], down: {}, diaphragms: [] }; }
export function newLine(name) { return { id: uid('ln'), name: name || '' }; }
export function newDiaphragm(levelId, mark) {
  return { id: uid('dg'), levelId, mark: mark || '', length: '',
    supports: [{ x: '', kind: 'line', lineId: '', diaphragmId: '', atX: '' }, { x: '', kind: 'line', lineId: '', diaphragmId: '', atX: '' }],
    parts: [{ id: uid('pt'), a: '0', b: '', d: '' }], pointLoads: [] };
}
export function defaultInputs() {
  return {
    schemaVersion: DLRS_SCHEMA, loadType: 'seismic', pdfReport: 'summary', refs: {}, notes: '',
    levels: [newLevel('Roof'), newLevel('2nd Floor')],
    directions: [newDirection('E-W'), newDirection('N-S')],
  };
}

const elfLevels = (linked) => (linked && linked.elfSource && linked.elfSource.elfTable) || null;

export const diaphragmToLrs = {
  id: 'diaphragm_to_lrs',
  label: 'Diaphragm to LRS',
  schemaVersion: DLRS_SCHEMA, // stored-data rules: diaphragmToLrsMigrate.js, docs/data-durability.md
  calcVersion: CALC_VERSION,
  regenerateResults: true,
  wideLayout: true,
  refs: [
    { key: 'elfSource', label: 'ELF Diaphragm & Collector', sourceType: 'elf_diaphragm_collector',
      extract: (outputs) => ({ elfTable: (outputs.elfTable || []).map(r => ({ level: r.level, fx: r.fx })) }) },
  ],
  fields: [],
  outputFields: [],
  pdfOptions: { key: 'pdfReport', label: 'PDF report', options: [['summary', 'Summary'], ['detailed', 'Detailed']] },

  migrate(item) { return migrateItem(item); },

  // F_x copied from the linked ELF item that no longer matches it
  linkDiff(inputs, linked) {
    const elf = elfLevels(linked);
    if (!elf) return [];
    const levels = inputs.levels || [];
    const sameList = elf.length === levels.length && elf.every(r => levels.some(lv => sameName(lv.name, r.level)));
    if (!sameList) return [{ refKey: 'elfSource', label: 'Level list', from: levels.map(l => l.name).join(', '), to: elf.map(r => r.level).join(', ') }];
    const changes = [];
    for (const r of elf) {
      const lv = levels.find(l => sameName(l.name, r.level));
      if (!sameNumber(lv.fx, r.fx, 0.0005)) changes.push({ refKey: 'elfSource', label: (r.level || 'Level') + ' Fx', from: lv.fx, to: r.fx });
    }
    return changes;
  },

  applyLinks(inputs, linked) {
    const elf = elfLevels(linked);
    if (elf) inputs.levels = levelsFromElf(elf, inputs.levels || []);
    return inputs;
  },

  summaryLabel(inputs, outputs) {
    const n = (inputs.directions || []).reduce((s, d) => s + (d.diaphragms || []).length, 0);
    const st = outputs && outputs.status === 'fail' ? ' — checks NG' : '';
    return 'Diaphragm to LRS — ' + n + ' diaphragm' + (n !== 1 ? 's' : '') + st;
  },

  calc(inputs) { return calcAll(inputs); },

  renderForm(container, existingInputs, onSave, projectItems, onInputChange, hooks) {
    // Migrated by itemForm (migrate); normalised again here so a field missing in older data never breaks the form.
    // The whole object is saved, so fields this version does not know are kept.
    const inputs = existingInputs && existingInputs.directions ? normalizeInputs(existingInputs) : defaultInputs();
    if (!inputs.refs) inputs.refs = {};
    if (hooks) hooks.setInput = (key, value) => { inputs[key] = value; if (onInputChange) onInputChange(); };
    const elfItems = (projectItems || []).filter(it => it.type === 'elf_diaphragm_collector' && !it.archived);

    let activeTop = inputs.verification ? 'verification' : 'setup';
    const activeLevel = {}; // dirId → levelId
    let openId = null;      // diaphragm open in the editor
    let results = calcAll(inputs);

    function changed(rerender = true) {
      results = calcAll(inputs);
      if (onInputChange) onInputChange();
      if (rerender) renderAll();
    }

    function renderAll() {
      const scrollY = typeof window !== 'undefined' ? window.scrollY : 0;
      clearEl(container);
      const tabBar = el('div', { style: { display: 'flex', gap: '2px', marginBottom: '1rem', borderBottom: '2px solid var(--border)', flexWrap: 'wrap' } });
      const tabBtn = (key, label, bad) => {
        const active = activeTop === key;
        return el('button', { className: 'btn btn-sm' + (active ? ' btn-primary' : ''), type: 'button',
          style: { borderRadius: '6px 6px 0 0', marginBottom: '-2px', borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent' },
          onClick() { activeTop = key; renderAll(); } }, label, bad ? el('span', { style: { color: 'var(--fail)', marginLeft: '0.3rem' } }, '●') : null);
      };
      tabBar.appendChild(tabBtn('setup', 'Setup'));
      for (const dir of inputs.directions) {
        const dres = results.perDirection.find(d => d.id === dir.id);
        tabBar.appendChild(tabBtn('dir-' + dir.id, dir.name || 'Direction', dres && dres.checks.some(c => c.status === 'fail')));
      }
      tabBar.appendChild(tabBtn('checks', 'Checks', results.status === 'fail'));
      if (inputs.verification) tabBar.appendChild(tabBtn('verification', 'Verification ' + (inputs.verification.id || '')));
      container.appendChild(tabBar);

      const body = el('div');
      if (activeTop === 'setup') body.appendChild(renderSetup());
      else if (activeTop === 'checks') body.appendChild(renderChecks(results));
      else if (activeTop === 'verification' && inputs.verification) body.appendChild(renderVerificationTab(inputs));
      else {
        const dir = inputs.directions.find(d => 'dir-' + d.id === activeTop);
        if (dir) body.appendChild(renderDirection(dir)); else body.appendChild(renderSetup());
      }
      container.appendChild(body);

      container.appendChild(el('div', { style: { marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-light)' } },
        el('div', { className: 'form-group' },
          el('label', { className: 'form-label' }, 'Notes'),
          el('textarea', { className: 'form-input', rows: 3, placeholder: 'Design notes, assumptions, etc.', value: inputs.notes || '', style: { resize: 'vertical' },
            onInput(e) { inputs.notes = e.target.value; if (onInputChange) onInputChange(); } })),
        el('div', { style: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' } },
          el('button', { className: 'btn btn-primary', type: 'button', onClick() { onSave(inputs); } }, 'Calculate & Save'))));
      if (typeof window !== 'undefined' && window.scrollTo) try { window.scrollTo(0, scrollY); } catch { /* stand-in DOM */ }
    }

    // ── Setup: ELF link, levels, directions ──
    function renderSetup() {
      const sec = el('div');
      sec.appendChild(el('div', { className: 'section-header' }, 'Story force F', el('sub', null, 'x'), ' (1.0E) per level'));
      const linked = !!inputs.refs.elfSource;
      if (elfItems.length) {
        const sel = el('select', { className: 'form-select', style: { maxWidth: '360px' }, onChange(e) {
          if (e.target.value) {
            inputs.refs.elfSource = e.target.value;
            const it = elfItems.find(x => x.id === e.target.value);
            if (it && it.outputs && it.outputs.elfTable) inputs.levels = levelsFromElf(it.outputs.elfTable, inputs.levels);
          } else delete inputs.refs.elfSource;
          changed();
        } });
        sel.appendChild(el('option', { value: '' }, '— None (type F_x by hand) —'));
        elfItems.forEach(it => sel.appendChild(el('option', { value: it.id, selected: inputs.refs.elfSource === it.id },
          (it.custom_name || it.customName || it.label || 'ELF') + (it.outputs && it.outputs.baseShear != null ? ' (V = ' + it.outputs.baseShear + ' k)' : ''))));
        sec.appendChild(el('div', { className: 'form-group' }, el('label', { className: 'form-label' }, 'Link to ELF Diaphragm & Collector (F', el('sub', null, 'x'), ')'), sel));
      } else {
        sec.appendChild(el('p', { style: { fontSize: '0.8rem', color: 'var(--ink-tertiary)', margin: '0 0 0.5rem' } },
          'No ELF Diaphragm & Collector item in this project — type F', el('sub', null, 'x'), ' per level below, or add an ELF item to link it.'));
      }
      const tbl = el('table', { className: 'dynamic-table' });
      tbl.appendChild(el('tr', null, el('th', null, 'Level (top down)'), el('th', null, 'Tag'), el('th', null, 'F', el('sub', null, 'x'), ' (kip)'),
        el('th', null, 'ΣA E-W / N-S (sf)'), el('th', { className: 'row-actions' }, '')));
      inputs.levels.forEach((lv, i) => {
        const lres = results.levels.find(x => x.id === lv.id);
        tbl.appendChild(el('tr', null,
          el('td', null, el('input', { type: 'text', value: lv.name || '', disabled: linked, style: { width: '140px' }, onChange(e) { lv.name = e.target.value; changed(); } })),
          el('td', null, el('input', { type: 'text', value: lv.tag || '', placeholder: autoTag(lv.name), style: { width: '48px' }, onChange(e) { lv.tag = e.target.value.trim(); changed(); } })),
          el('td', null, el('input', { type: 'number', step: 'any', value: numOrBlank(lv.fx), disabled: linked, style: { width: '90px' },
            title: linked ? 'Linked from the ELF item — choose None above to type it' : '', onChange(e) { lv.fx = e.target.value; changed(); } })),
          el('td', { className: 'mono', style: { fontSize: '0.8rem' } }, inputs.directions.map(d => (d.name || '?') + ' ' + f2(lres && lres.sumA[d.id])).join(' · ')),
          el('td', { className: 'row-actions' }, linked ? null : el('span', null,
            el('button', { className: 'btn btn-ghost btn-sm', type: 'button', title: 'Move up', disabled: i === 0, onClick() { swap(inputs.levels, i, i - 1); changed(); } }, '↑'),
            el('button', { className: 'btn btn-ghost btn-sm', type: 'button', title: 'Move down', disabled: i === inputs.levels.length - 1, onClick() { swap(inputs.levels, i, i + 1); changed(); } }, '↓'),
            el('button', { className: 'btn btn-ghost btn-sm', type: 'button', title: 'Delete level', onClick() { inputs.levels.splice(i, 1); changed(); } }, '×')))));
      });
      sec.appendChild(el('div', { className: 'table-scroll' }, tbl));
      if (!linked) sec.appendChild(el('button', { className: 'btn btn-sm', type: 'button', style: { marginTop: '0.5rem' }, onClick() { inputs.levels.push(newLevel('')); changed(); } }, '+ Level'));
      else sec.appendChild(el('p', { style: { fontSize: '0.78rem', color: 'var(--ink-tertiary)' } }, 'Levels and F', el('sub', null, 'x'), ' come from the linked ELF item (greyed out). The tag (R, 2 …) prefixes marks: R.D1, R.A.'));
      const orphan = inputs.directions.reduce((s, d) => s + (d.diaphragms || []).filter(g => !inputs.levels.some(l => l.id === g.levelId)).length, 0);
      if (orphan) sec.appendChild(el('p', { style: { color: 'var(--stale)', fontSize: '0.8rem' } }, '⚠ ' + orphan + ' diaphragm(s) belong to a level that no longer exists; they are not calculated.'));

      sec.appendChild(el('div', { className: 'section-header', style: { marginTop: '1.25rem' } }, 'Directions'));
      sec.appendChild(el('p', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', margin: '0 0 0.5rem' } },
        'Each tab is a load direction; its wall lines run parallel to the load (E-W load → E-W wall lines). The full F', el('sub', null, 'x'), ' applies in each direction.'));
      const dtbl = el('table', { className: 'dynamic-table' });
      inputs.directions.forEach((d, i) => dtbl.appendChild(el('tr', null,
        el('td', null, el('input', { type: 'text', value: d.name || '', style: { width: '140px' }, onChange(e) { d.name = e.target.value; changed(); } })),
        el('td', { style: { fontSize: '0.8rem', color: 'var(--ink-tertiary)' } }, (d.lines || []).length + ' lines, ' + (d.diaphragms || []).length + ' diaphragms'),
        el('td', { className: 'row-actions' }, el('button', { className: 'btn btn-ghost btn-sm', type: 'button', title: 'Delete direction', disabled: inputs.directions.length <= 1,
          onClick() { inputs.directions.splice(i, 1); changed(); } }, '×')))));
      sec.appendChild(dtbl);
      sec.appendChild(el('button', { className: 'btn btn-sm', type: 'button', style: { marginTop: '0.5rem' }, onClick() { inputs.directions.push(newDirection('Direction ' + (inputs.directions.length + 1))); changed(); } }, '+ Direction'));

      sec.appendChild(el('div', { className: 'section-header', style: { marginTop: '1.25rem' } }, 'Method'));
      sec.appendChild(el('ul', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', margin: 0, paddingLeft: '1.2rem' } },
        el('li', null, 'Flexible diaphragms. Area load q = F', el('sub', null, 'x'), ' / ΣA (ΣA = all diaphragm parts of that level and direction); w = q·d on each part.'),
        el('li', null, 'Each diaphragm is a beam on two supports (overhangs allowed). Parts are cut at the supports; each piece and point load gives R1 = W·(x₂ − x̄)/l, R2 = W·(x̄ − x₁)/l (statics, ΣM = 0 about each support; shown with its numbers per row).'),
        el('li', null, 'A support on another diaphragm becomes a point load on it. Reactions to wall lines give the level force F per line; story shear V = F + force from the line(s) above.')));
      return sec;
    }

    // ── Direction tab ──
    function renderDirection(dir) {
      const sec = el('div');
      const dres = results.perDirection.find(d => d.id === dir.id);
      sec.appendChild(renderLines(dir));
      // level sub-tabs
      if (!inputs.levels.length) { sec.appendChild(el('p', null, 'Add levels in the Setup tab.')); return sec; }
      if (!inputs.levels.some(l => l.id === activeLevel[dir.id])) activeLevel[dir.id] = inputs.levels[0].id;
      const bar = el('div', { style: { display: 'flex', gap: '2px', margin: '1rem 0 0.75rem', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' } });
      inputs.levels.forEach(lv => {
        const active = activeLevel[dir.id] === lv.id;
        const n = (dir.diaphragms || []).filter(d => d.levelId === lv.id).length;
        bar.appendChild(el('button', { className: 'btn btn-sm' + (active ? ' btn-primary' : ' btn-ghost'), type: 'button',
          onClick() { activeLevel[dir.id] = lv.id; openId = null; renderAll(); } }, (lv.name || '(level)') + ' (' + n + ')'));
      });
      sec.appendChild(bar);
      const lv = inputs.levels.find(l => l.id === activeLevel[dir.id]);
      const lres = dres.perLevel.find(p => p.levelId === lv.id);
      sec.appendChild(renderLevel(dir, lv, lres));
      sec.appendChild(renderSummary(dir, dres));
      return sec;
    }

    function renderLines(dir) {
      const box = el('div');
      box.appendChild(el('div', { className: 'section-header' }, 'Wall lines — ' + (dir.name || '')));
      const row = el('div', { style: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' } });
      dir.lines.forEach((ln, i) => {
        row.appendChild(el('span', { style: { display: 'inline-flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: '6px', padding: '0 0.15rem' } },
          el('button', { className: 'btn btn-ghost btn-sm', type: 'button', title: 'Move left', disabled: i === 0, onClick() { swap(dir.lines, i, i - 1); changed(); } }, '‹'),
          el('input', { type: 'text', className: 'form-input', value: ln.name || '', placeholder: 'A', style: { width: '56px', padding: '0.15rem 0.3rem' }, onChange(e) { ln.name = e.target.value.trim(); changed(); } }),
          el('button', { className: 'btn btn-ghost btn-sm', type: 'button', title: 'Move right', disabled: i === dir.lines.length - 1, onClick() { swap(dir.lines, i, i + 1); changed(); } }, '›'),
          el('button', { className: 'btn btn-ghost btn-sm', type: 'button', title: 'Delete line (supports to it become unassigned)', onClick() {
            dir.lines.splice(i, 1);
            for (const g of dir.groups || []) g.lineIds = (g.lineIds || []).filter(id => id !== ln.id);
            changed();
          } }, '×')));
      });
      row.appendChild(el('button', { className: 'btn btn-sm', type: 'button', onClick() { dir.lines.push(newLine(nextLineName(dir))); changed(); } }, '+ Line'));
      box.appendChild(row);

      // merged lines (stored as dir.groups)
      box.appendChild(el('div', { className: 'section-header', style: { marginTop: '1rem' } }, 'Merge lines → one line of resistance — ' + (dir.name || '')));
      box.appendChild(el('p', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', margin: '0 0 0.4rem' } },
        'Tick 2 or more lines (e.g. 4 and 5) and the levels. Reactions to the ticked lines are added, and the merged line (R.4+R.5) takes the story shear down as one unit at those levels.'));
      (dir.groups || []).forEach((g, gi) => {
        const lineBoxes = el('span', { style: { display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap' } }, ...dir.lines.map(ln =>
          el('label', { style: { fontSize: '0.85rem', display: 'inline-flex', gap: '0.2rem', alignItems: 'center' } },
            el('input', { type: 'checkbox', checked: (g.lineIds || []).includes(ln.id), onChange(e) {
              g.lineIds = e.target.checked ? [...(g.lineIds || []), ln.id] : (g.lineIds || []).filter(id => id !== ln.id);
              g.lineIds.sort((a, b) => dir.lines.findIndex(l => l.id === a) - dir.lines.findIndex(l => l.id === b));
              changed();
            } }), ln.name || '?')));
        const lvBoxes = el('span', { style: { display: 'inline-flex', gap: '0.5rem', flexWrap: 'wrap' } },
          el('label', { style: { fontSize: '0.85rem', display: 'inline-flex', gap: '0.2rem', alignItems: 'center' } },
            el('input', { type: 'checkbox', checked: !(g.levelIds || []).length, onChange(e) { g.levelIds = e.target.checked ? [] : inputs.levels.map(l => l.id); changed(); } }), 'all levels'),
          ...((g.levelIds || []).length ? inputs.levels.map(lv => el('label', { style: { fontSize: '0.85rem', display: 'inline-flex', gap: '0.2rem', alignItems: 'center' } },
            el('input', { type: 'checkbox', checked: g.levelIds.includes(lv.id), onChange(e) {
              g.levelIds = e.target.checked ? [...g.levelIds, lv.id] : g.levelIds.filter(id => id !== lv.id);
              if (!g.levelIds.length) g.levelIds = [lv.id === inputs.levels[0].id && inputs.levels[1] ? inputs.levels[1].id : inputs.levels[0].id];
              changed();
            } }), lv.name || '?')) : []));
        box.appendChild(el('div', { style: { display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.3rem 0', borderBottom: '1px solid var(--border-light)' } },
          el('strong', { style: { minWidth: '70px', color: (g.lineIds || []).filter(id => dir.lines.some(l => l.id === id)).length < 2 ? 'var(--stale)' : '' } },
            (g.lineIds || []).map(id => (dir.lines.find(l => l.id === id) || {}).name).filter(Boolean).join('+') || '', (g.lineIds || []).filter(id => dir.lines.some(l => l.id === id)).length < 2 ? ' (pick 2+ lines)' : ''),
          lineBoxes, el('span', { style: { color: 'var(--ink-tertiary)' } }, 'at'), lvBoxes,
          el('button', { className: 'btn btn-ghost btn-sm', type: 'button', title: 'Remove this merge', onClick() { dir.groups.splice(gi, 1); changed(); } }, '×')));
      });
      if (!(dir.groups || []).length) box.appendChild(el('p', { style: { fontSize: '0.8rem', color: 'var(--ink-tertiary)', margin: '0.2rem 0' } }, 'No merged lines.'));
      box.appendChild(el('button', { className: 'btn btn-sm', type: 'button', style: { marginTop: '0.4rem' }, disabled: dir.lines.length < 2,
        title: dir.lines.length < 2 ? 'Add at least two wall lines first' : '',
        onClick() { (dir.groups = dir.groups || []).push({ id: uid('grp'), lineIds: [], levelIds: [] }); changed(); } }, '+ Merge lines'));
      return box;
    }

    function renderLevel(dir, lv, lres) {
      const box = el('div');
      const tag = levelTag(lv);
      const others = inputs.directions.filter(d => d.id !== dir.id).map(d => (d.name || '?') + ' ' + f2(results.levels.find(x => x.id === lv.id).sumA[d.id]) + ' sf');
      box.appendChild(el('div', { style: { display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'baseline', fontSize: '0.9rem', marginBottom: '0.6rem' } },
        el('span', null, 'F', el('sub', null, 'x'), ' = ', el('strong', { className: 'mono' }, f2(lres.fx) + ' k'), inputs.refs.elfSource ? el('span', { style: { color: 'var(--ink-tertiary)', fontSize: '0.75rem' } }, ' (ELF)') : null),
        el('span', null, 'ΣA = ', el('strong', { className: 'mono' }, f2(lres.sumA) + ' sf')),
        el('span', null, 'q = F', el('sub', null, 'x'), '/ΣA = ', el('strong', { className: 'mono' }, f2(lres.qPsf) + ' psf')),
        others.length ? el('span', { style: { color: 'var(--ink-tertiary)', fontSize: '0.8rem' } }, 'other direction ΣA: ' + others.join(', ')) : null,
        lres.sumManual ? el('span', { style: { color: 'var(--stale)', fontSize: '0.8rem' } }, '+ manual P ' + f2(lres.sumManual) + ' k (extra)') : null));

      // copy from another level
      const srcLevels = inputs.levels.filter(l => l.id !== lv.id && (dir.diaphragms || []).some(d => d.levelId === l.id));
      if (srcLevels.length) {
        let src = srcLevels[0].id;
        const sel = el('select', { className: 'form-select', style: { width: 'auto' }, onChange(e) { src = e.target.value; } },
          ...srcLevels.map(l => el('option', { value: l.id }, l.name || '?')));
        box.appendChild(el('div', { style: { display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.5rem', fontSize: '0.8rem' } },
          'Copy diaphragms from', sel,
          el('button', { className: 'btn btn-sm', type: 'button', onClick() { copyLevel(dir, src, lv.id); changed(); } }, 'Copy'),
          el('span', { style: { color: 'var(--ink-tertiary)' } }, '(marks, L, parts and supports; manual P not copied; not linked afterwards)')));
      }

      // diaphragm table
      const dias = (dir.diaphragms || []).filter(d => d.levelId === lv.id);
      const tbl = el('table', { className: 'dynamic-table' });
      tbl.appendChild(el('tr', null, el('th', null, ''), el('th', null, 'Mark'), el('th', null, 'L (ft)'), el('th', null, 'd (ft)'), el('th', null, 'A (sf)'),
        el('th', null, 'R1 →'), el('th', null, 'R2 →'), el('th', null, 'Loads'), el('th', null, 'R1 (k)'), el('th', null, 'R2 (k)'), el('th', { className: 'row-actions' }, '')));
      dias.forEach(d => {
        const r = lres.diaphragms.find(x => x.id === d.id) || { errors: [], supports: [], parts: [], points: [] };
        const simple = isSimple(d);
        const open = openId === d.id;
        const area = (r.parts || []).reduce((s, p) => s + (Number.isFinite(p.A) ? p.A : 0), 0);
        const sum = [];
        if ((d.parts || []).length > 1) sum.push(d.parts.length + ' parts');
        const g = { L: num(d.length), x1: num(d.supports[0] && d.supports[0].x), x2: num(d.supports[1] && d.supports[1].x) };
        if (Number.isFinite(g.x1) && g.x1 > 1e-9) sum.push('OH ' + f2(g.x1) + ' L');
        if (Number.isFinite(g.x2) && Number.isFinite(g.L) && g.L - g.x2 > 1e-9) sum.push('OH ' + f2(g.L - g.x2) + ' R');
        const pts = (r.points || []).map(p => p.label + (p.source ? ' ← ' + p.source : ' (manual)'));
        const Rcell = i => {
          const s = r.supports[i];
          return el('td', { className: 'num mono', style: { color: s && s.reverses ? 'var(--fail)' : '' }, title: s ? 'R_dist ' + f2(s.Rdist) + ' + R_P ' + f2(s.RP) : '' }, s ? f2(s.R) : '—');
        };
        tbl.appendChild(el('tr', { style: r.errors.length ? { background: 'var(--fail-bg)' } : null },
          el('td', null, el('button', { className: 'btn btn-ghost btn-sm', type: 'button', title: open ? 'Close the editor' : 'Open the editor (parts, overhangs, point loads)',
            onClick() { openId = open ? null : d.id; renderAll(); } }, open ? '▾' : '▸')),
          el('td', null, el('span', { style: { color: 'var(--ink-tertiary)' } }, tag ? tag + '.' : ''),
            el('input', { type: 'text', value: d.mark || '', placeholder: 'D1', style: { width: '64px' }, onChange(e) { d.mark = e.target.value.trim(); changed(); } })),
          el('td', null, numInput(d.length, v => setLength(d, v), '70px')),
          el('td', null, simple ? numInput(d.parts[0] ? d.parts[0].d : '', v => { if (!d.parts.length) d.parts.push({ id: uid('pt'), a: '0', b: d.length, d: '' }); d.parts[0].d = v; }, '70px')
            : el('span', { style: { fontSize: '0.8rem', color: 'var(--ink-tertiary)' } }, sum.join(', ') || 'see editor')),
          el('td', { className: 'num mono' }, f2(area)),
          el('td', null, supportCell(dir, lv, d, 0)),
          el('td', null, supportCell(dir, lv, d, 1)),
          el('td', { style: { fontSize: '0.78rem' } }, pts.join(', ') || '—', !simple && sum.length && (d.parts || []).length <= 1 ? el('div', { style: { color: 'var(--ink-tertiary)' } }, sum.join(', ')) : null),
          Rcell(0), Rcell(1),
          el('td', { className: 'row-actions' }, el('button', { className: 'btn btn-ghost btn-sm', type: 'button', title: 'Delete diaphragm', onClick() {
            dir.diaphragms.splice(dir.diaphragms.indexOf(d), 1); if (openId === d.id) openId = null; changed();
          } }, '×'))));
        if (r.errors.length) tbl.appendChild(el('tr', null, el('td', { colSpan: 11, style: { color: 'var(--fail)', fontSize: '0.78rem' } }, '⚠ ' + r.errors.join('; '))));
        if (open) tbl.appendChild(el('tr', null, el('td', { colSpan: 11, style: { background: 'var(--surface)', padding: '0.6rem' } }, renderEditor(dir, lv, d, r))));
      });
      box.appendChild(el('div', { className: 'table-scroll' }, tbl));
      box.appendChild(el('button', { className: 'btn btn-sm', type: 'button', style: { marginTop: '0.5rem' }, onClick() {
        const d = newDiaphragm(lv.id, 'D' + (dias.length + 1)); dir.diaphragms.push(d); changed();
      } }, '+ Diaphragm'));

      box.appendChild(renderDown(dir, lv, lres));
      return box;
    }

    function numInput(value, set, width) {
      return el('input', { type: 'number', step: 'any', value: numOrBlank(value), style: { width: width || '70px' }, onChange(e) { set(e.target.value); changed(); } });
    }

    // Simple diaphragm: the full-length part follows L (rule in the plan); supports at '' stay at 0 / L.
    function setLength(d, v) {
      const simple = isSimple(d);
      d.length = v;
      if (simple && d.parts.length === 1) { d.parts[0].a = '0'; d.parts[0].b = v; }
      if (simple) d.supports.forEach(s => { s.x = ''; });
    }

    function supportCell(dir, lv, d, i) {
      const s = d.supports[i] || (d.supports[i] = { x: '', kind: 'line', lineId: '', diaphragmId: '', atX: '' });
      const cur = s.kind === 'diaphragm' ? 'd:' + (s.diaphragmId || '') : (s.lineId || '');
      const sel = el('select', { className: 'form-select', style: { width: 'auto', minWidth: '84px', padding: '0.15rem 0.3rem' }, onChange(e) {
        const v = e.target.value;
        if (v.startsWith('d:')) { s.kind = 'diaphragm'; s.diaphragmId = v.slice(2); s.lineId = ''; if (s.atX === '' || s.atX == null) s.atX = '0'; }
        else { s.kind = 'line'; s.lineId = v; s.diaphragmId = ''; }
        changed();
      } });
      sel.appendChild(el('option', { value: '', selected: !cur || cur === 'd:' }, '—'));
      const tag = levelTag(lv);
      const og1 = el('optgroup', { label: 'Wall lines' });
      dir.lines.forEach(ln => og1.appendChild(el('option', { value: ln.id, selected: cur === ln.id }, tagged(tag, ln.name))));
      sel.appendChild(og1);
      const others = (dir.diaphragms || []).filter(x => x.levelId === lv.id && x.id !== d.id);
      if (others.length) {
        const og2 = el('optgroup', { label: 'Diaphragms (point load on it)' });
        others.forEach(x => og2.appendChild(el('option', { value: 'd:' + x.id, selected: cur === 'd:' + x.id }, tagged(tag, x.mark))));
        sel.appendChild(og2);
      }
      const wrap = el('span', { style: { display: 'inline-flex', gap: '0.25rem', alignItems: 'center' } }, sel);
      if (s.kind === 'diaphragm') wrap.appendChild(el('span', { style: { fontSize: '0.75rem' } }, '@ x ', numInput(s.atX, v => { s.atX = v; }, '56px'), ' ft'));
      return wrap;
    }

    function renderEditor(dir, lv, d, r) {
      const box = el('div');
      const L = num(d.length);
      // supports
      const supRow = el('div', { style: { display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem', fontSize: '0.85rem' } },
        el('strong', null, tagged(levelTag(lv), d.mark)), el('span', null, 'L ', numInput(d.length, v => setLength(d, v), '70px'), ' ft'));
      [0, 1].forEach(i => {
        const s = d.supports[i];
        supRow.appendChild(el('span', null, 'R' + (i + 1) + ' at x ', numInput(s.x, v => { s.x = v; }, '64px'), ' ft ',
          el('span', { style: { color: 'var(--ink-tertiary)' } }, '(blank = ' + (i ? 'L' : '0') + ') → '), supportCell(dir, lv, d, i)));
      });
      const x1 = num(d.supports[0].x), x2 = num(d.supports[1].x);
      const oh = [];
      if (Number.isFinite(x1) && x1 > 1e-9) oh.push('left ' + f2(x1) + ' ft');
      if (Number.isFinite(L) && Number.isFinite(x2) && L - x2 > 1e-9) oh.push('right ' + f2(L - x2) + ' ft');
      if (oh.length) supRow.appendChild(el('span', { style: { color: 'var(--ink-secondary)' } }, 'overhang ' + oh.join(', ')));
      box.appendChild(supRow);

      // parts
      box.appendChild(el('div', { className: 'form-label' }, 'Uniform parts (rectangles): w = q·d on b, from a; c = L − a − b'));
      const pt = el('table', { className: 'dynamic-table' });
      pt.appendChild(el('tr', null, el('th', null, '#'), el('th', null, 'a (ft)'), el('th', null, 'b (ft)'), el('th', null, 'c (ft)'), el('th', null, 'd (ft)'),
        el('th', null, 'A (sf)'), el('th', null, 'w (plf)'), el('th', { className: 'row-actions' }, '')));
      d.parts.forEach((p, i) => {
        const rp = (r.parts || [])[i] || {};
        pt.appendChild(el('tr', null, el('td', null, String(i + 1)),
          el('td', null, numInput(p.a, v => { p.a = v; }, '64px')),
          el('td', null, numInput(p.b, v => { p.b = v; }, '64px')),
          el('td', { className: 'num mono' }, f2(rp.c)),
          el('td', null, numInput(p.d, v => { p.d = v; }, '64px')),
          el('td', { className: 'num mono' }, f2(rp.A)), el('td', { className: 'num mono' }, f2(rp.wPlf)),
          el('td', { className: 'row-actions' }, el('button', { className: 'btn btn-ghost btn-sm', type: 'button', disabled: d.parts.length <= 1, onClick() { d.parts.splice(i, 1); changed(); } }, '×'))));
      });
      box.appendChild(pt);
      box.appendChild(el('button', { className: 'btn btn-sm', type: 'button', style: { margin: '0.3rem 0 0.6rem' }, onClick() {
        d.parts.push({ id: uid('pt'), a: '0', b: d.length || '', d: '' }); changed();
      } }, '+ Part'));

      // point loads
      box.appendChild(el('div', { className: 'form-label' }, 'Point loads'));
      const plt = el('table', { className: 'dynamic-table' });
      plt.appendChild(el('tr', null, el('th', null, '#'), el('th', null, 'x (ft)'), el('th', null, 'P (k)'), el('th', null, 'Source / note'), el('th', { className: 'row-actions' }, '')));
      (r.points || []).filter(p => !p.manual).forEach(p => plt.appendChild(el('tr', null, el('td', null, p.label), el('td', { className: 'num mono' }, f2(p.x)),
        el('td', { className: 'num mono' }, f2(p.P)), el('td', { style: { color: 'var(--ink-tertiary)' } }, '← ' + p.source + ' (from that diaphragm, read-only)'), el('td', null, ''))));
      const nInc = (r.points || []).filter(p => !p.manual).length;
      d.pointLoads.forEach((p, i) => plt.appendChild(el('tr', null, el('td', null, 'P' + (nInc + i + 1)),
        el('td', null, numInput(p.x, v => { p.x = v; }, '64px')),
        el('td', null, numInput(p.p, v => { p.p = v; }, '64px')),
        el('td', null, el('input', { type: 'text', value: p.note || '', placeholder: 'manual — extra load, e.g. what it is', style: { width: '260px' }, onChange(e) { p.note = e.target.value; changed(); } })),
        el('td', { className: 'row-actions' }, el('button', { className: 'btn btn-ghost btn-sm', type: 'button', onClick() { d.pointLoads.splice(i, 1); changed(); } }, '×')))));
      box.appendChild(plt);
      box.appendChild(el('button', { className: 'btn btn-sm', type: 'button', style: { margin: '0.3rem 0 0.6rem' }, onClick() {
        d.pointLoads.push({ id: uid('pl'), x: '', p: '', note: '' }); changed();
      } }, '+ Manual point load'));

      // diagram + rows
      if (r.L > 0) box.appendChild(el('div', { style: { border: '1px solid var(--border-light)', borderRadius: '6px', overflow: 'hidden', margin: '0.3rem 0', maxWidth: '760px' } }, renderDiaphragmDiagram(r)));
      if ((r.rows || []).length) {
        const det = el('details', null, el('summary', { style: { cursor: 'pointer', fontSize: '0.85rem' } }, 'Reaction rows (pieces / point loads, lever rule)'));
        det.appendChild(rowsTable(r));
        box.appendChild(det);
      }
      return box;
    }

    // Down choices for each line / group at this level
    function renderDown(dir, lv, lres) {
      const box = el('div', { style: { marginTop: '1rem' } });
      const li = inputs.levels.findIndex(l => l.id === lv.id);
      const lower = inputs.levels[li + 1];
      box.appendChild(el('div', { className: 'form-label' }, 'Where each line\'s story shear goes ', lower ? '(to ' + (lower.name || 'the level below') + ')' : '(lowest level → foundation)'));
      if (!lower || !lres.lines.length) {
        box.appendChild(el('p', { style: { fontSize: '0.8rem', color: 'var(--ink-tertiary)', margin: 0 } }, lower ? 'No line receives load at this level.' : 'All story shear at this level goes to the foundation.'));
        return box;
      }
      const lowerTag = levelTag(lower);
      const activeLower = (dir.groups || []).filter(g => (!g.levelIds || !g.levelIds.length || g.levelIds.includes(lower.id)) && (g.lineIds || []).length > 1);
      const targets = [...dir.lines.map(l => [l.id, tagged(lowerTag, l.name)]), ...activeLower.map(g => ['g:' + g.id, g.lineIds.map(id => tagged(lowerTag, (dir.lines.find(l => l.id === id) || {}).name)).join('+')])];
      const down = (dir.down = dir.down || {});
      const map = (down[lv.id] = down[lv.id] || {});
      const tbl = el('table', { className: 'dynamic-table' });
      tbl.appendChild(el('tr', null, el('th', null, 'Line'), el('th', null, 'V (k)'), el('th', null, 'Goes to'), el('th', null, '')));
      for (const u of lres.lines) {
        const ch = map[u.key] || { mode: 'same' };
        const modeSel = el('select', { className: 'form-select', style: { width: 'auto' }, onChange(e) {
          const m = e.target.value;
          if (m === 'same') delete map[u.key];
          else map[u.key] = { mode: m, split: m === 'split' ? (ch.split && ch.split.length ? ch.split : [{ to: '', pct: '100' }]) : [] };
          changed();
        } },
          el('option', { value: 'same', selected: ch.mode === 'same' }, 'Same line below'),
          el('option', { value: 'split', selected: ch.mode === 'split' }, 'Split to lines (%)'),
          el('option', { value: 'ends', selected: ch.mode === 'ends' }, 'Ends here (resisted at this level)'));
        const extra = el('span', { style: { display: 'inline-flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' } });
        if (ch.mode === 'split') {
          (ch.split || []).forEach((sp, si) => {
            const tsel = el('select', { className: 'form-select', style: { width: 'auto' }, onChange(e) { sp.to = e.target.value; changed(); } },
              el('option', { value: '', selected: !sp.to }, '—'), ...targets.map(([v, t]) => el('option', { value: v, selected: sp.to === v }, t)));
            extra.appendChild(el('span', { style: { display: 'inline-flex', gap: '0.2rem', alignItems: 'center' } }, tsel,
              numInput(sp.pct, v => { sp.pct = v; }, '56px'), '%',
              el('button', { className: 'btn btn-ghost btn-sm', type: 'button', onClick() { ch.split.splice(si, 1); changed(); } }, '×')));
          });
          extra.appendChild(el('button', { className: 'btn btn-sm', type: 'button', onClick() { ch.split.push({ to: '', pct: '' }); changed(); } }, '+ target'));
        } else {
          extra.appendChild(el('span', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)' } }, u.goesTo.map(g => g.text).join(', ')));
        }
        tbl.appendChild(el('tr', null, el('td', null, u.label, mergedBadge(u)), el('td', { className: 'num mono' }, f2(u.V)), el('td', null, modeSel), el('td', null, extra)));
      }
      box.appendChild(tbl);
      return box;
    }

    renderAll();
  },

  renderOutputs(container, outputs) {
    clearEl(container);
    if (!outputs || !outputs.perDirection) return;
    for (const d of outputs.perDirection) container.appendChild(renderSummary(d, d));
    const bad = outputs.perDirection.flatMap(d => d.checks.filter(c => c.status === 'fail').map(c => (d.name || '') + ' ' + c.id));
    container.appendChild(el('p', { style: { fontSize: '0.85rem', color: bad.length ? 'var(--fail)' : 'var(--pass)' } },
      bad.length ? '⚠ Checks NG: ' + bad.join(', ') : '✓ All checks pass'));
  },

  pdfSections(inputs, outputs) {
    return diaphragmPdfSections(inputs, calcAll(inputs));
  },
};

// ── helpers shared by the form, outputs and tests ──

export function levelsFromElf(elfTable, old) {
  return elfTable.map(r => {
    const prev = (old || []).find(l => sameName(l.name, r.level));
    return { id: prev ? prev.id : uid('lv'), name: r.level || '', tag: prev ? prev.tag || '' : '', fx: r.fx != null ? String(r.fx) : '' };
  });
}

function swap(arr, i, j) { if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; }

function nextLineName(dir) {
  const used = new Set(dir.lines.map(l => l.name));
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!used.has(c)) return c;
  return String(dir.lines.length + 1);
}

// Copy a level's diaphragms (marks, L, parts, supports); links between copied diaphragms are remapped; manual P not copied.
export function copyLevel(dir, fromLevelId, toLevelId) {
  const src = (dir.diaphragms || []).filter(d => d.levelId === fromLevelId);
  const idMap = new Map(src.map(d => [d.id, uid('dg')]));
  for (const d of src) {
    const c = JSON.parse(JSON.stringify(d));
    c.id = idMap.get(d.id); c.levelId = toLevelId; c.pointLoads = [];
    c.parts = c.parts.map(p => ({ ...p, id: uid('pt') }));
    c.supports = c.supports.map(s => s.kind === 'diaphragm' ? { ...s, diaphragmId: idMap.get(s.diaphragmId) || '' } : s);
    dir.diaphragms.push(c);
  }
}

// Reaction rows of one diaphragm: every piece / point load through the lever rule, with its numbers.
export function rowsTable(r) {
  const t = el('table', { className: 'data-table' });
  t.appendChild(el('tr', null, ...['Load', 'Region', 'w (plf) / P (k)', 'from–to / at (ft)', 'W or P (k)', 'x̄ or x (ft)', 'x₂ − x̄', 'x̄ − x₁', 'R1 (k)', 'R2 (k)', 'Lever rule (l = x₂ − x₁)']
    .map((h, i) => el('th', { className: i >= 4 && i <= 9 ? 'num' : '' }, h))));
  const reg = { span: 'back span', left: 'left overhang', right: 'right overhang' };
  for (const row of r.rows || []) {
    const uni = row.kind === 'uniform';
    t.appendChild(el('tr', null,
      el('td', null, uni ? row.label : row.label + (row.source ? ' ← ' + row.source : ' (manual)')),
      el('td', null, reg[row.region] || row.region || ''),
      el('td', { className: 'mono' }, uni ? f2(row.w * 1000) : f2(row.P)),
      el('td', { className: 'mono' }, uni ? f2(row.u) + '–' + f2(row.v) : f2(row.x)),
      el('td', { className: 'num mono' }, f2(uni ? row.W : row.P)),
      el('td', { className: 'num mono' }, f2(uni ? row.xbar : row.x)),
      el('td', { className: 'num mono' }, f2(row.lever1)), el('td', { className: 'num mono' }, f2(row.lever2)),
      el('td', { className: 'num mono', style: { color: row.R1 < 0 ? 'var(--fail)' : '' } }, f2(row.R1)),
      el('td', { className: 'num mono', style: { color: row.R2 < 0 ? 'var(--fail)' : '' } }, f2(row.R2)),
      el('td', { className: 'mono', style: { fontSize: '0.72rem', whiteSpace: 'nowrap' } }, ...leverRuleText(row, r.x1, r.x2).map(s => el('div', null, s)))));
  }
  t.appendChild(el('tr', { style: { fontWeight: '600' } }, el('td', null, 'Σ'), el('td', null, ''), el('td', null, ''), el('td', null, ''),
    el('td', { className: 'num mono' }, f2((r.sumW || 0) + (r.sumP || 0))), el('td', null, ''), el('td', null, ''), el('td', null, ''),
    el('td', { className: 'num mono' }, f2(r.supports[0] && r.supports[0].R)), el('td', { className: 'num mono' }, f2(r.supports[1] && r.supports[1].R)), el('td', null, 'ΣR = ΣW + ΣP')));
  return el('div', { className: 'table-scroll' }, t);
}

const mergedBadge = u => (u.merged || String(u.key || '').startsWith('g:')
  ? el('span', { className: 'badge', style: { marginLeft: '0.35rem', fontSize: '0.68rem' }, title: 'Merged lines — one line of resistance' }, 'merged') : null);

// Wall Line Shear Summary of one direction: one table per level
export function renderSummary(dir, dres) {
  const box = el('div', { style: { marginTop: '1.25rem' } });
  box.appendChild(el('div', { className: 'section-header' }, 'Wall Line Shear Summary — ' + (dres.name || dir.name || '')));
  if (dres.perLevel.some(lv => lv.lines.length) && !dres.perLevel.some(lv => lv.lines.some(u => u.merged))) {
    box.appendChild(el('p', { style: { fontSize: '0.78rem', color: 'var(--ink-tertiary)', margin: '0 0 0.3rem' } },
      'To treat two lines as one line of resistance (e.g. R.4+R.5), use "Merge lines" at the top of this tab.'));
  }
  for (const lv of dres.perLevel) {
    if (!lv.lines.length) continue;
    box.appendChild(el('div', { className: 'form-label', style: { marginTop: '0.5rem' } }, (lv.name || '') + ' — F', el('sub', null, 'x'), ' ' + f2(lv.fx) + ' k'));
    const t = el('table', { className: 'data-table' });
    t.appendChild(el('tr', null, el('th', null, 'Line'), el('th', { className: 'num' }, 'F (k)'), el('th', null, 'From above (k)'), el('th', { className: 'num' }, 'V = F + above (k)'), el('th', null, 'Goes to')));
    for (const u of lv.lines) {
      t.appendChild(el('tr', null, el('td', null, u.label, mergedBadge(u)), el('td', { className: 'num mono' }, f2(u.F)),
        el('td', { className: 'mono', style: { fontSize: '0.8rem' } }, u.fromAbove.map(f => f.from + (f.pct !== 100 ? ' ' + f2(f.pct) + ' %' : '') + ' ' + f2(f.V)).join(' + ') || '—'),
        el('td', { className: 'num mono', style: { fontWeight: '600' } }, f2(u.V)),
        el('td', { style: { fontSize: '0.8rem' } }, u.goesTo.map(g => g.text).join(', '))));
    }
    t.appendChild(el('tr', { style: { borderTop: '2px solid var(--border)' } }, el('td', null, 'Σ'), el('td', { className: 'num mono' }, f2(lv.sumF)),
      el('td', { style: { fontSize: '0.78rem', color: 'var(--ink-tertiary)' } }, lv.ended || lv.lost ? (lv.ended ? 'ends here ' + f2(lv.ended) + ' k' : '') : ''),
      el('td', { className: 'num mono', style: { fontWeight: '600' } }, f2(lv.sumV)),
      el('td', { style: { fontSize: '0.78rem', color: 'var(--ink-tertiary)' } }, 'ΣF = F_x + manual P = ' + f2((lv.fx || 0) + (lv.sumManual || 0)))));
    box.appendChild(el('div', { className: 'table-scroll' }, t));
  }
  return box;
}

function renderChecks(results) {
  const box = el('div');
  for (const d of results.perDirection) {
    box.appendChild(el('div', { className: 'section-header' }, 'Checks — ' + (d.name || '')));
    const t = el('table', { className: 'data-table' });
    t.appendChild(el('tr', null, el('th', null, 'Check'), el('th', null, 'What'), el('th', null, 'Status'), el('th', null, 'Details')));
    for (const c of d.checks) {
      t.appendChild(el('tr', null, el('td', null, c.id), el('td', null, c.label),
        el('td', null, el('span', { className: 'badge ' + (c.status === 'pass' ? 'badge-pass' : 'badge-fail') }, c.status === 'pass' ? 'OK' : 'NG')),
        el('td', { style: { fontSize: '0.8rem' } }, ...(c.items.length ? c.items.map(s => el('div', null, s)) : ['—']))));
    }
    box.appendChild(el('div', { className: 'table-scroll' }, t));
  }
  return box;
}

export { diagramSize, renderDiaphragmDiagram };
