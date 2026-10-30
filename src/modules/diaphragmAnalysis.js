// Diaphragm Analysis (module id diaphragm_analysis) — irregular wood diaphragms by the visual shear transfer method (EX-IRREG-2E Ch 3–5).
// Inputs are the source of truth; results are always regenerated (regenerateResults).
// Plan editor: tdPlanEditor.js. Geometry: tdGeometry.js. Stored data: tdMigrate.js / tdModel.js.
// Phase 1 (2026-10-29): setup, plan editor, geometry checks. Phase 3: TD engine (tdCalc.js) and each drawn TD in the
// skill's frame (TDs tab). Analysis (basic shear, TD loads, member forces) follows.
import { el, clearEl, numOrBlank, sameNumber } from '../utils.js';
import { parsePlan, planErrors, sheathedArea, tdFrame } from './tdGeometry.js';
import { TD_FLOW } from './tdFlow.js';
import { TD_SCHEMA, migrateItem, normalizeInputs } from './tdMigrate.js';
import { defaultInputs } from './tdModel.js';
import { renderPlanEditor, newEditorState, drawPlan } from './tdPlanEditor.js';
import { swdExtract, linkedWalls, guessDir, swdWallShares } from './tdWallLink.js';
import { renderAnalysis } from './tdViews.js';
import { toolValue } from './tdBookKeys.js';
import { loadCases, analyseCase, lineForces as caseLineForces, wallShares } from './tdBasicShear.js';
import { runTds, CLOSURE_TOL } from './tdDerive.js';
import { tdFields, members, netChecks } from './tdNet.js';
import { cantileverLimits, CANTILEVER_LIMITS_VERIFY } from './tdLimits.js';

export const CALC_VERSION = 'td-v5'; // v5: TD and net fields, net-field members (Phase 6). // v2: TD geometry in the skill frame (results.tds); v3: basic shear, line forces, wall shares (Phase 4); v4: derived TD inputs + TD engine runs (Phase 5)
const f2 = v => (Number.isFinite(v) ? v.toFixed(2) : '—');
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const SHEATHING = [['wsp', 'Wood structural panels'], ['lumber_straight_single', 'Lumber, straight (single)'],
  ['lumber_diagonal_single', 'Lumber, diagonal (single)'], ['lumber_diagonal_double', 'Lumber, diagonal (double)']];

// The plan with the walls of the linked Shear Wall Design item (if any) in place of the typed walls
export function planWithLinks(inputs, refs = {}) {
  const base = parsePlan(inputs);
  if (!refs.wallSource) return { plan: base, link: null };
  const link = linkedWalls(inputs, base, refs.wallSource);
  return { plan: parsePlan({ ...inputs, walls: link.walls }), link };
}

// Results of the current phase: plan checks and ΣA. refs.wallSource = the linked SWD definition (swdExtract).
// lineForces: per SWD direction / line, the force the diaphragm delivers (kip, E and W) — filled by Phase 4.
export function calcAll(inputs, refs = {}) {
  const { plan, link } = planWithLinks(inputs, refs);
  const issues = [...planErrors(plan), ...(link ? link.issues : [])];
  const errors = issues.filter(e => !e.warn), warnings = issues.filter(e => e.warn);
  const sumA = sheathedArea(plan);
  const fx = Number(inputs.level && inputs.level.fx);
  const q = Number.isFinite(fx) && sumA > 0 ? fx * 1000 / sumA : null; // psf from F_x (kip)
  const an = errors.length ? { cases: [], lineForces: [], issues: [] } : analyse(plan, q, link, refs.wallSource);
  warnings.push(...an.issues.map(i => ({ ...i, warn: true })));
  const frames = new Map(plan.tds.map(t => [t.id, tdFrame(t)]));
  const tdRuns = an.cases.flatMap(cs => runTds(plan, cs, frames, inputs.tds, {
    codeEdition: inputs.codeEdition, designBasis: inputs.designBasis,
    sheathing: (inputs.diaphragm && inputs.diaphragm.sheathing) || 'wsp', blocked: !inputs.diaphragm || inputs.diaphragm.blocked !== false }));
  for (const r of tdRuns) warnings.push(...(r.issues || []).map(i => ({ ...i, warn: true })));
  for (const cs of an.cases) { cs.fields = tdFields(plan, cs, tdRuns, frames); cs.members = members(plan, cs, cs.fields); }
  const checks = an.cases.flatMap(cs => netChecks(plan, cs, tdRuns, frames, CLOSURE_TOL));
  return {
    calcVersion: CALC_VERSION,
    level: (inputs.level && inputs.level.name) || '',
    sumA,
    q,
    errors, warnings,
    counts: { grids: plan.grids.length, openings: plan.openings.length, walls: plan.walls.length, tds: plan.tds.length, diaphragms: plan.diaphragms.length },
    wallLink: link ? { levelId: link.levelId, lines: link.lines.map(l => ({ dirId: l.dirId, dir: l.dir, lineId: l.lineId, name: l.name, grid: l.grid ? l.grid.name : null, origin: l.origin,
      planLength: l.planLength, swdLength: l.swdLength })) } : null,
    lineForces: an.lineForces,
    analysis: { cases: an.cases, tdRuns },
    checks,
    tdRuns,
    tds: plan.tds.map(t => {
      const f = frames.get(t.id);
      return { id: t.id, mark: t.mark, dir: t.dir, ok: f.ok, issues: f.issues, geometry: f.geometry, ySign: f.ySign ?? 1,
        bottom: f.bottom ? f.bottom.name : null, top: f.top ? f.top.name : null, edges: [f.edgeX1, f.edgeX2], spanAxis: f.spanAxis || null,
        loadLines: (f.loads || []).map(l => ({ grid: l.grid.name, y: l.y, side: l.side })) };
    }),
    status: errors.length ? 'fail' : 'ok',
  };
}

// Phase 4: every load case (direction × E / W) → span beams, basic shear, line forces (wall-less lines into their
// TDs), wall shares (by length; with a Shear Wall Design link, in the ratio SWD's own calcAll gives — B4).
// lineForces: per linked SWD line, the force this diaphragm delivers (kip, load-direction sign, 1.0E / 1.0W as entered).
export function analyse(plan, q, link, swd) {
  const issues = [];
  const cases = loadCases(plan).map(lc => {
    const c = analyseCase(plan, lc, { q });
    const lf = caseLineForces(plan, c);
    issues.push(...c.issues, ...lf.issues);
    if (lc.loads.some(l => l.mode === 'seismic') && q === null) issues.push({ code: 'no-fx', msg: 'Seismic load: F_x is missing (Setup) — seismic loads are 0.' });
    return { ...c, lines: lf.lines, issues: undefined };
  });
  const lineForces = [];
  for (const l of (link && link.lines) || []) {
    if (!l.grid) continue;
    const at = kind => { const c = cases.find(x => x.dir === l.dir && x.kind === kind); const ln = c && c.lines.find(x => x.gridId === l.grid.id); return ln ? ln.P / 1000 : 0; };
    lineForces.push({ swdDirId: l.dirId, swdLineId: l.lineId, line: l.name, E: at('E'), W: at('W') });
  }
  const sw = link && swd ? swdWallShares(swd, link.levelId, lineForces) : null;
  if (sw && sw.error) issues.push({ code: 'swd-calc', msg: sw.error });
  for (const c of cases) for (const ln of c.lines) {
    const swdWalls = plan.walls.filter(w => w.gridId === ln.gridId && w.linked);
    let weights = null;
    if (sw && !sw.error && swdWalls.length) {
      weights = sw.weights[c.kind];
      if (swdWalls.reduce((t, w) => t + (weights[w.id] || 0), 0) <= 0) {
        weights = null;
        issues.push({ code: 'swd-no-share', msg: `Line ${ln.name} (${c.kind === 'E' ? 'seismic' : 'wind'}): Shear Wall Design gives its walls no share for this load — split by wall length.` });
      }
    }
    ln.walls = wallShares(plan, ln, weights);
  }
  return { cases, lineForces, issues };
}

const elfRows = linked => (linked && linked.elfSource && linked.elfSource.elfTable) || null;

export const diaphragmAnalysis = {
  id: 'diaphragm_analysis',
  formerIds: ['transfer_diaphragm'], // renamed 2026-10-29; items saved before keep their stored type
  label: 'Diaphragm Analysis',
  schemaVersion: TD_SCHEMA,
  calcVersion: CALC_VERSION,
  regenerateResults: true,
  wideLayout: true,
  refs: [
    { key: 'elfSource', label: 'ELF Diaphragm & Collector', sourceType: 'elf_diaphragm_collector',
      extract: (outputs) => ({ elfTable: (outputs.elfTable || []).map(r => ({ level: r.level, fx: r.fx })) }) },
    // walls of every level from Shear Wall Design (its definition, read-only; it never resolves back to here)
    { key: 'wallSource', label: 'Shear Wall Design', sourceType: 'shear_wall_design', from: 'inputs',
      extract: (inputs) => swdExtract(inputs) },
  ],
  fields: [],
  outputFields: [],
  pdfOptions: { key: 'pdfReport', label: 'PDF report', options: [['summary', 'Summary'], ['detailed', 'Detailed']] },

  migrate(item) { return migrateItem(item); },

  // F_x of the picked level that no longer matches the linked ELF item
  linkDiff(inputs, linked) {
    const rows = elfRows(linked);
    if (!rows || !inputs.level || !inputs.level.name) return [];
    const r = rows.find(x => sameName(x.level, inputs.level.name));
    if (!r) return [{ refKey: 'elfSource', label: 'Level', from: inputs.level.name, to: '(not in ELF)' }];
    return sameNumber(inputs.level.fx, r.fx, 0.0005) ? [] : [{ refKey: 'elfSource', label: inputs.level.name + ' Fx', from: inputs.level.fx, to: r.fx }];
  },

  applyLinks(inputs, linked) {
    const rows = elfRows(linked);
    if (rows && inputs.level) {
      const r = rows.find(x => sameName(x.level, inputs.level.name));
      if (r) inputs.level.fx = r.fx != null ? String(r.fx) : '';
    }
    return inputs;
  },

  summaryLabel(inputs, outputs) {
    const n = (inputs.tds || []).length;
    const lv = inputs.level && inputs.level.name ? inputs.level.name + ' — ' : '';
    return 'Diaphragm Analysis — ' + lv + n + ' TD' + (n !== 1 ? 's' : '') + (outputs && outputs.status === 'fail' ? ' — plan has errors' : '');
  },

  calc(inputs, refs) { return calcAll(inputs, refs || {}); },

  renderForm(container, existingInputs, onSave, projectItems, onInputChange, hooks) {
    const inputs = existingInputs && existingInputs.grids ? normalizeInputs(existingInputs) : defaultInputs();
    if (!inputs.refs) inputs.refs = {};
    if (hooks) hooks.setInput = (key, value) => { inputs[key] = value; if (onInputChange) onInputChange(); };
    const elfItems = (projectItems || []).filter(it => it.type === 'elf_diaphragm_collector' && !it.archived);
    const swdItems = (projectItems || []).filter(it => it.type === 'shear_wall_design' && !it.archived);
    // The linked SWD definition, read from the project's items (same as the wallSource ref; walls / lines / levels
    // only, fields every SWD schema has). Not via results.js: that would import the registry into this module.
    const linkedRefs = () => {
      const it = swdItems.find(x => x.id === inputs.refs.wallSource);
      return it && it.inputs ? { wallSource: swdExtract(it.inputs) } : {};
    };
    let refs = linkedRefs();
    const ed = newEditorState();
    if (inputs.loads[0] && String(inputs.loads[0].acts).endsWith('x')) ed.dir = 'x';
    let active = inputs.verification ? 'verification' : 'plan';
    let caseId = null, view = 1, show = { chord: true, cross: true }; // Analysis tab: load case, view, member filter
    let results = calcAll(inputs, refs);

    function refresh(inputsChanged) {
      if (inputsChanged) { refs = linkedRefs(); results = calcAll(inputs, refs); if (onInputChange) onInputChange(); }
      renderAll();
    }

    function renderAll() {
      const scrollY = typeof window !== 'undefined' ? window.scrollY : 0;
      clearEl(container);
      const tabBar = el('div', { style: { display: 'flex', gap: '2px', marginBottom: '1rem', borderBottom: '2px solid var(--border)', flexWrap: 'wrap' } });
      const tab = (key, label, bad) => {
        const on = active === key;
        return el('button', { className: 'btn btn-sm' + (on ? ' btn-primary' : ''), type: 'button',
          style: { borderRadius: '6px 6px 0 0', marginBottom: '-2px', borderBottom: on ? '2px solid var(--accent)' : '2px solid transparent' },
          onClick() { active = key; renderAll(); } }, label, bad ? el('span', { style: { color: 'var(--fail)', marginLeft: '0.3rem' } }, '●') : null);
      };
      tabBar.appendChild(tab('setup', 'Setup'));
      tabBar.appendChild(tab('plan', 'Plan', results.errors.length > 0));
      tabBar.appendChild(tab('analysis', 'Analysis'));
      tabBar.appendChild(tab('tds', 'TDs'));
      tabBar.appendChild(tab('checks', 'Checks', results.status === 'fail'));
      if (inputs.verification) tabBar.appendChild(tab('verification', 'Verification ' + (inputs.verification.id || '')));
      container.appendChild(tabBar);

      const body = el('div');
      if (active === 'setup') body.appendChild(renderSetup());
      else if (active === 'plan') body.appendChild(renderPlanTab());
      else if (active === 'analysis') body.appendChild(renderAnalysis(planWithLinks(inputs, refs).plan, results, { id: caseId, set(id) { caseId = id; renderAll(); },
        view, setView(n) { view = n; renderAll(); }, show, setShow(x) { show = x; renderAll(); }, closureTol: CLOSURE_TOL }));
      else if (active === 'tds') body.appendChild(renderTds(results, inputs, refresh));
      else if (active === 'checks') body.appendChild(renderChecks(results));
      else if (active === 'verification') body.appendChild(renderVerification(inputs, results, planWithLinks(inputs, refs).plan));
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

    function renderSetup() {
      const sec = el('div');
      sec.appendChild(el('div', { className: 'section-header' }, 'Level and story force F', el('sub', null, 'x')));
      const linked = !!inputs.refs.elfSource;
      const linkedItem = elfItems.find(x => x.id === inputs.refs.elfSource);
      if (elfItems.length) {
        const sel = el('select', { className: 'form-select', style: { maxWidth: '360px' }, onChange(e) {
          if (e.target.value) inputs.refs.elfSource = e.target.value; else delete inputs.refs.elfSource;
          refresh(true);
        } });
        sel.appendChild(el('option', { value: '' }, '— None (type F_x by hand) —'));
        elfItems.forEach(it => sel.appendChild(el('option', { value: it.id, selected: inputs.refs.elfSource === it.id }, it.custom_name || it.customName || it.label || 'ELF')));
        sec.appendChild(el('div', { className: 'form-group' }, el('label', { className: 'form-label' }, 'Link to ELF Diaphragm & Collector'), sel));
      } else {
        sec.appendChild(el('p', { style: { fontSize: '0.8rem', color: 'var(--ink-tertiary)', margin: '0 0 0.5rem' } },
          'No ELF Diaphragm & Collector item in this project — type the level and F', el('sub', null, 'x'), ' below.'));
      }
      const rows = linkedItem && linkedItem.outputs && linkedItem.outputs.elfTable;
      const lvInput = linked && rows
        ? el('select', { className: 'form-select', style: { width: 'auto' }, onChange(e) {
          const r = rows.find(x => x.level === e.target.value);
          inputs.level.name = e.target.value; inputs.level.fx = r && r.fx != null ? String(r.fx) : '';
          refresh(true);
        } }, el('option', { value: '' }, '— pick a level —'), ...rows.map(r => el('option', { value: r.level, selected: sameName(r.level, inputs.level.name) }, r.level + ' (F_x ' + r.fx + ' k)')))
        : el('input', { type: 'text', value: inputs.level.name || '', style: { width: '140px' }, onChange(e) { inputs.level.name = e.target.value; refresh(true); } });
      sec.appendChild(el('div', { style: { display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' } },
        el('div', { className: 'form-group' }, el('label', { className: 'form-label' }, 'Level'), lvInput),
        el('div', { className: 'form-group' }, el('label', { className: 'form-label' }, 'F', el('sub', null, 'x'), ' (kip, 1.0E)'),
          el('input', { type: 'number', step: 'any', value: numOrBlank(inputs.level.fx), disabled: linked && !!rows, style: { width: '100px' },
            title: linked ? 'From the linked ELF item' : '', onChange(e) { inputs.level.fx = e.target.value; refresh(true); } })),
        el('div', { className: 'form-group' }, el('label', { className: 'form-label' }, 'ΣA (sf) / q'),
          el('div', { className: 'mono', style: { padding: '6px 0' } }, f2(results.sumA) + ' sf' + (results.q != null ? ' · q = ' + f2(results.q) + ' psf' : '')))));

      sec.appendChild(renderWallLink());
      sec.appendChild(el('div', { className: 'section-header', style: { marginTop: '1rem' } }, 'Code and diaphragm'));
      const pick = (label, value, opts, set) => el('div', { className: 'form-group' }, el('label', { className: 'form-label' }, label),
        el('select', { className: 'form-select', style: { width: 'auto' }, onChange(e) { set(e.target.value); refresh(true); } },
          ...opts.map(([v, s]) => el('option', { value: v, selected: value === v }, s))));
      sec.appendChild(el('div', { style: { display: 'flex', gap: '1rem', flexWrap: 'wrap' } },
        pick('Code edition', inputs.codeEdition, [['CBC-2025', 'CBC 2025 (ASCE 7-22, SDPWS 2021)'], ['CBC-2022', 'CBC 2022 (ASCE 7-16, SDPWS 2021)']], v => { inputs.codeEdition = v; }),
        pick('Design basis of the loads', inputs.designBasis, [['ASD', 'ASD'], ['LRFD', 'LRFD']], v => { inputs.designBasis = v; }),
        pick('Sheathing', inputs.diaphragm.sheathing, SHEATHING, v => { inputs.diaphragm.sheathing = v; }),
        pick('Blocking', inputs.diaphragm.blocked ? 'yes' : 'no', [['yes', 'Blocked'], ['no', 'Unblocked']], v => { inputs.diaphragm.blocked = v === 'yes'; })));

      sec.appendChild(el('div', { className: 'section-header', style: { marginTop: '1rem' } }, 'Method'));
      sec.appendChild(el('ul', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', margin: 0, paddingLeft: '1.2rem' } },
        el('li', null, 'Flexible diaphragm, span by span between adjacent wall lines (a continuous diaphragm is a future item).'),
        el('li', null, 'Basic unit shear v = V / d, with d the sheathed depth at the section (it jumps at notches and openings).'),
        el('li', null, 'Every chord, strut, collector and drag force comes from integrating the unit shears on its two sides; each diagram must close to ~0.'),
        el('li', null, 'Transfer diaphragms per the wood-diaph-transfer skill (EX-IRREG-2E Ch 3–5). DRAFT: the skill is not PE-approved.')));
      return sec;
    }

    // Shear walls from a Shear Wall Design item: pick it, map its directions, line origins on the plan
    function renderWallLink() {
      const sec = el('div', { style: { marginTop: '1rem' } });
      sec.appendChild(el('div', { className: 'section-header' }, 'Shear walls (from Shear Wall Design)'));
      if (!inputs.wallLink) inputs.wallLink = { dirMap: {}, origins: {} };
      const wl = inputs.wallLink;
      const sel = el('select', { className: 'form-select', style: { maxWidth: '360px' }, onChange(e) {
        if (e.target.value) inputs.refs.wallSource = e.target.value; else delete inputs.refs.wallSource;
        refresh(true);
      } }, el('option', { value: '' }, swdItems.length ? '— None (draw walls in the plan) —' : '— no Shear Wall Design item in this project —'),
      ...swdItems.map(it => el('option', { value: it.id, selected: inputs.refs.wallSource === it.id }, it.custom_name || it.customName || it.label || 'Shear Wall Design')));
      sec.appendChild(el('div', { className: 'form-group' }, el('label', { className: 'form-label' }, 'Link to Shear Wall Design (walls, wall types and distribution method; all levels)'), sel));
      const swd = refs.wallSource;
      if (!inputs.refs.wallSource) {
        sec.appendChild(el('p', { style: { fontSize: '0.78rem', color: 'var(--ink-tertiary)', margin: 0 } }, 'Not linked: walls drawn with the Wall tool are used. Linked: the walls of this level come from Shear Wall Design (read-only here); its line names must match the grid names of this plan.'));
        return sec;
      }
      if (!swd) { sec.appendChild(el('p', { style: { color: 'var(--fail)', fontSize: '0.8rem' } }, 'The linked Shear Wall Design item was not found (deleted or archived).')); return sec; }
      const lv = swd.levels.find(l => String(l.name).trim().toLowerCase() === String(inputs.level.name || '').trim().toLowerCase());
      const t = el('table', { className: 'dynamic-table' });
      t.appendChild(el('tr', null, el('th', null, 'Shear Wall Design direction'), el('th', null, 'Load along'), el('th', null, 'Lines (walls on this level)')));
      for (const d of swd.directions) {
        const cur = (wl.dirMap || {})[d.id] || '';
        const pick = el('select', { className: 'form-select', style: { width: 'auto' }, onChange(e) { wl.dirMap[d.id] = e.target.value; refresh(true); } },
          el('option', { value: '', selected: cur === '' }, 'guess: ' + (guessDir(d.name) || '?')),
          el('option', { value: 'y', selected: cur === 'y' }, 'y (↕)'), el('option', { value: 'x', selected: cur === 'x' }, 'x (↔)'));
        const n = d.lines.map(l => l.name + ' (' + (lv ? l.walls.filter(w => w.levelId === lv.id).length : 0) + ')').join(', ');
        t.appendChild(el('tr', null, el('td', null, d.name || '?'), el('td', null, pick), el('td', { style: { fontSize: '0.8rem' } }, n || '—')));
      }
      sec.appendChild(el('div', { className: 'table-scroll' }, t));
      const lines = (results.wallLink && results.wallLink.lines) || [];
      if (lines.length) {
        const lt = el('table', { className: 'dynamic-table', style: { marginTop: '0.5rem' } });
        lt.appendChild(el('tr', null, el('th', null, 'Line'), el('th', null, 'Load'), el('th', null, 'Grid in plan'), el('th', null, 'Length SWD / plan (ft)'), el('th', { title: 'Plan coordinate of position 0 of the line in Shear Wall Design' }, 'Line origin (ft)')));
        for (const l of lines) {
          const typed = (wl.origins || {})[l.lineId] ?? '';
          lt.appendChild(el('tr', null, el('td', null, l.name), el('td', null, l.dir === 'y' ? '↕ y' : '↔ x'),
            el('td', { style: { color: l.grid ? '' : 'var(--fail)' } }, l.grid ? (l.dir === 'y' ? 'x = ' : 'y = ') + 'grid ' + l.grid : 'no grid named ' + l.name),
            (() => { const bad = l.grid && Number.isFinite(l.swdLength) && Math.abs(l.swdLength - l.planLength) > 0.01;
              return el('td', { className: 'mono', style: { color: bad ? 'var(--fail)' : '' }, title: bad ? 'Lengths differ — fix the SWD line length or the plan outline' : '' },
                (Number.isFinite(l.swdLength) ? f2(l.swdLength) : '—') + ' / ' + (l.grid ? f2(l.planLength) : '—') + (bad ? ' ✗' : l.grid ? ' ✓' : '')); })(),
            el('td', null, el('input', { type: 'number', step: 'any', value: typed, placeholder: Number.isFinite(l.origin) ? 'auto ' + l.origin : '', style: { width: '90px' },
              onChange(e) { wl.origins[l.lineId] = e.target.value; refresh(true); } }))));
        }
        sec.appendChild(el('div', { className: 'table-scroll' }, lt));
        sec.appendChild(el('p', { style: { fontSize: '0.75rem', color: 'var(--ink-tertiary)' } }, 'Origin blank = where the grid line enters the sheathed plan. A wall at position p (Shear Wall Design) is drawn from origin + p.'));
      }
      return sec;
    }

    function renderPlanTab() {
      const plan = planWithLinks(inputs, refs).plan;
      const box = el('div');
      if (results.errors.length) {
        box.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--fail)', margin: '0 0 0.5rem' } },
          el('strong', null, results.errors.length + ' plan issue(s): '), results.errors.slice(0, 6).map(e => e.msg).join(' · '), results.errors.length > 6 ? ' …' : ''));
      }
      if (results.warnings.length) {
        box.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--stale)', margin: '0 0 0.5rem' } },
          el('strong', null, '⚠ '), results.warnings.map(e => e.msg).join(' · ')));
      }
      box.appendChild(renderPlanEditor({ inputs, plan, errors: results.errors, state: ed, refresh, wallsLinked: !!refs.wallSource }));
      box.appendChild(el('p', { style: { fontSize: '0.78rem', color: 'var(--ink-tertiary)', marginTop: '0.4rem' } },
        'ΣA = ' + f2(results.sumA) + ' sf · ' + results.counts.grids + ' grids · ' + results.counts.openings + ' openings · ' + results.counts.walls + ' walls · ' + results.counts.diaphragms + ' diaphragms · ' + results.counts.tds + ' TDs'));
      return box;
    }

    renderAll();
  },

  renderOutputs(container, outputs) {
    clearEl(container);
    if (!outputs) return;
    container.appendChild(el('p', { style: { fontSize: '0.85rem' } }, 'Sheathed area ΣA = ' + f2(outputs.sumA) + ' sf' + (outputs.q != null ? ', q = ' + f2(outputs.q) + ' psf' : '')));
    container.appendChild(el('p', { style: { fontSize: '0.85rem', color: outputs.status === 'fail' ? 'var(--fail)' : 'var(--pass)' } },
      outputs.status === 'fail' ? '⚠ Plan issues: ' + (outputs.errors || []).length : '✓ Plan is valid'));
  },

  pdfSections(inputs) {
    const r = calcAll(inputs);
    const plan = parsePlan(inputs);
    return [
      { title: 'Diaphragm Analysis — DRAFT (skill wood-diaph-transfer not PE-approved)', rows: [
        ['Level', inputs.level.name || '—'], ['F_x (kip)', inputs.level.fx || '—'], ['ΣA (sf)', f2(r.sumA)],
        ['Code edition', inputs.codeEdition], ['Design basis', inputs.designBasis],
        ['Grids', plan.grids.map(g => g.name + (g.axis === 'x' ? ' x=' : ' y=') + g.at).join(', ')],
        ['Openings', String(plan.openings.length)], ['Walls', plan.walls.map(w => w.mark).join(', ') || '—'],
        ['Diaphragms', plan.diaphragms.map(d => d.mark + ' (' + d.dir + ')').join(', ') || '—'], ['TDs', plan.tds.map(t => t.mark + ' (' + t.dir + ')').join(', ') || '—']] },
      r.errors.length ? { title: 'Plan issues', text: r.errors.map(e => '• ' + e.msg).join('\n') } : { title: 'Plan', text: 'No plan issues.' },
    ];
  },
};


// TDs tab: each drawn TD in the skill frame, then per load case the derived inputs (how each was found), the TD
// engine's results and stops, and for a cantilever the limits the engineer reviews (td_cantilever_ok).
const STOP_TEXT = { E_TD_GEOMETRY: 'geometry or load invalid (e.g. no force at a load line)', E_TD_CLOSURE: 'edge-member diagrams do not close', E_TD_ASPECT: 'aspect ratio above the blocked limit', E_TD_CANTILEVER_LIMITS: 'cantilever limits not met (engineer)', E_TD_REGION_NOT_CLEAR: 'TD region not clear', E_EDITION_UNSUPPORTED: 'code edition not supported' };
function renderTds(results, inputs, refresh) {
  const box = el('div');
  const small = { fontSize: '0.78rem', color: 'var(--ink-tertiary)' };
  const f0 = v => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—');
  const f1 = v => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toString() : '—');
  box.appendChild(el('div', { className: 'section-header' }, 'Transfer diaphragms'));
  box.appendChild(el('p', { style: { fontSize: '0.8rem', color: 'var(--stale)', margin: '0 0 0.5rem' } },
    'DRAFT — skill ' + TD_FLOW.skill + ' ' + TD_FLOW.skillVersion + ' is ' + TD_FLOW.skillStatus + ', not PE-approved. Loads and shears come from the plan and the basic field (Phase 5); TD region clear = drawn by the engineer; closure tolerance ' + (CLOSURE_TOL * 100) + ' % of |P1| + |P2|.'));
  const list = results.tds || [];
  if (!list.length) { box.appendChild(el('p', { style: small }, 'No TD drawn — use the TD tool on the Plan tab.')); return box; }
  const t = el('table', { className: 'dynamic-table' });
  t.appendChild(el('tr', null, ...['TD', 'Load', 'Type', 'Supports y = 0 → W', 'W (ft)', 'L (ft)', 'Edges x1 / x2', 'Load lines (y, side)', 'Geometry'].map(h => el('th', null, h))));
  for (const d of list) {
    const g = d.geometry || {};
    const along = d.spanAxis === 'x' ? 'y' : 'x';
    t.appendChild(el('tr', null,
      el('td', null, d.mark || '—'), el('td', null, d.dir === 'y' ? '↕ y' : '↔ x'),
      el('td', null, g.td_support === 'cantilever' ? 'cantilever' + (d.ySign < 0 ? ' (y mirrored)' : '') : g.td_support || '—'),
      el('td', null, d.bottom && d.top ? d.bottom + ' → ' + d.top : '—'),
      el('td', { className: 'mono' }, f2(g.td_span)), el('td', { className: 'mono' }, f2(g.td_length)),
      el('td', { className: 'mono' }, d.spanAxis ? along + ' = ' + f2(d.edges[0]) + ' / ' + f2(d.edges[1]) : '—'),
      el('td', { className: 'mono' }, d.loadLines.map(l => l.grid + ' (' + f2(l.y) + ', ' + (l.side > 0 ? '+' : '−') + ')').join(', ') || '—'),
      el('td', { style: { color: d.ok ? 'var(--pass)' : 'var(--fail)' } }, d.ok ? '✓' : d.issues.join('; '))));
  }
  box.appendChild(el('div', { className: 'table-scroll' }, t));
  box.appendChild(el('p', { style: small }, 'Skill frame: y along the TD span from the support at y = 0; x along the TD length (edge x1 = lower coordinate). Side + = the cut member enters from the +x side.'));

  for (const d of list) {
    const raw = (inputs.tds || []).find(x => x.id === d.id);
    for (const r of (results.tdRuns || []).filter(x => x.tdId === d.id)) {
      const cs = ((results.analysis && results.analysis.cases) || []).find(c => c.id === r.caseId);
      const sec = el('div', { style: { border: '1px solid var(--border-light)', borderRadius: '6px', padding: '8px', margin: '0.75rem 0' } });
      const stop = r.terminal && r.terminal.startsWith('HARD_STOP:') ? r.terminal.slice(10) : null;
      const paused = r.terminal && r.terminal.startsWith('ENGINEER_INPUT');
      const firstMsg = code => ((r.issues || []).find(i => !code || i.code === code) || {}).msg || '';
      const head = r.terminal === 'OUTPUT' ? ['✓ results', 'var(--pass)']
        : paused ? ['awaiting the engineer review of the cantilever limits (below)', 'var(--stale)']
          : stop ? ['stopped: ' + stop + ' — ' + (STOP_TEXT[stop] || ''), 'var(--fail)']
            : [r.terminal === 'NOT_RUN' ? 'not run — ' + firstMsg() : 'error — ' + firstMsg('td-run'), 'var(--fail)'];
      sec.appendChild(el('div', { style: { fontWeight: 600, marginBottom: '4px' } }, 'TD ' + d.mark + ' — ' + (cs ? (cs.kind === 'E' ? 'seismic E' : 'wind W') : r.caseId) + (r.type ? ' (' + r.type + ' TD)' : '') + ' · ',
        el('span', { style: { color: head[1], fontWeight: 400 } }, head[0])));
      if (!r.skill) { box.appendChild(sec); continue; }
      const k = r.skill, o = r.outputs || {}, two = k.td_has_load2, cant = k.td_support === 'cantilever';
      // loads
      const lt = el('table', { className: 'dynamic-table', style: { fontSize: '0.8rem' } });
      lt.appendChild(el('tr', null, el('th', null, 'Load'), el('th', null, 'P (lb)'), el('th', null, 'y (ft)'), el('th', null, 'side'), el('th', null, 'From')));
      const loads = [[1, k.td_P1, k.td_y1, k.td_side1]];
      if (two) loads.push([2, k.td_P2, k.td_y2, k.td_side2]);
      for (const [i, P, y, sd] of loads) lt.appendChild(el('tr', null,
        el('td', null, 'P' + i), el('td', { className: 'mono' }, f0(P)), el('td', { className: 'mono' }, f2(y)), el('td', null, sd > 0 ? '+' : '−'),
        el('td', { style: { fontSize: '0.76rem' } }, (r.how || {})['td_P' + i] || '')));
      sec.appendChild(el('div', { className: 'table-scroll' }, lt));
      // shears by segment
      const segs = cant ? [['s1', 'back span 0 → W'], ['s3', 'overhang y1 → 0']] : two ? [['s1', 'y1 → W'], ['s2', 'y2 → y1'], ['s3', '0 → y2']] : [['s1', 'y1 → W'], ['s3', '0 → y1']];
      const ends = cant ? { s1: ['top', 'bot'], s3: ['bot', 'y1'] } : { s1: ['top', 'y1'], s2: ['y1', 'y2'], s3: [two ? 'y2' : 'y1', 'bot'] };
      const pair = (a, b) => f1(a) + ' / ' + f1(b);
      const st = el('table', { className: 'dynamic-table', style: { fontSize: '0.8rem' } });
      st.appendChild(el('tr', null, ...['Segment', 'v_b x1 (hi / lo)', 'v_b x2', 'outside x1', 'outside x2', 'v_TD', 'v_net x1', 'v_net x2'].map(h => el('th', null, h))));
      for (const [sg, lab] of segs) {
        const [hi, lo] = ends[sg];
        st.appendChild(el('tr', null, el('td', null, sg + ' (' + lab + ')'),
          el('td', { className: 'mono' }, pair(k['td_vb_x1_' + hi], k['td_vb_x1_' + lo])), el('td', { className: 'mono' }, pair(k['td_vb_x2_' + hi], k['td_vb_x2_' + lo])),
          el('td', { className: 'mono' }, pair(k['td_vo_x1_' + sg + '_hi'], k['td_vo_x1_' + sg + '_lo'])), el('td', { className: 'mono' }, pair(k['td_vo_x2_' + sg + '_hi'], k['td_vo_x2_' + sg + '_lo'])),
          el('td', { className: 'mono' }, f1(o['td_v_' + sg])),
          el('td', { className: 'mono' }, pair(o['td_vnet_x1_' + sg + '_hi'], o['td_vnet_x1_' + sg + '_lo'])), el('td', { className: 'mono' }, pair(o['td_vnet_x2_' + sg + '_hi'], o['td_vnet_x2_' + sg + '_lo']))));
      }
      sec.appendChild(el('div', { className: 'table-scroll', style: { marginTop: '4px' } }, st));
      sec.appendChild(el('p', { style: small }, 'Unit shears in plf, book "+" element in the TD frame; ' + (r.how || {}).td_vb + '; outside: ' + (r.how || {}).td_vo + '.'));
      if (r.terminal === 'OUTPUT') {
        const rt = el('table', { className: 'dynamic-table', style: { fontSize: '0.8rem' } });
        const row = (a, b) => rt.appendChild(el('tr', null, el('td', null, a), el('td', { className: 'mono' }, b)));
        row('Force to support ' + (d.top || 'top') + ' / ' + (d.bottom || 'bottom') + ' (lb, +x)', f0(o.td_F_sup_top) + ' / ' + f0(o.td_F_sup_bot));
        row('Edge x1 member: N at y1 / y2 / closure (lb), max', f0(o.td_N_x1_b1) + ' / ' + f0(o.td_N_x1_b2) + ' / ' + f0(o.td_N_x1_res) + ', max ' + f0(o.td_N_x1_absmax));
        row('Edge x2 member: N at y1 / y2 / closure (lb), max', f0(o.td_N_x2_b1) + ' / ' + f0(o.td_N_x2_b2) + ' / ' + f0(o.td_N_x2_res) + ', max ' + f0(o.td_N_x2_absmax));
        row('Load-line collector(s) at entry (lb), length (ft)', f0(o.td_Nlong_1) + (two ? ' / ' + f0(o.td_Nlong_2) : '') + ', ' + f1(o.td_coll_len_req));
        row('Max |net shear| (plf)', f1(o.td_vnet_absmax));
        row('Closure residual / tolerance', (o.td_closure_rel * 100).toFixed(3) + ' % / ' + (CLOSURE_TOL * 100) + ' %');
        row('Aspect W / L, blocking', f2(o.td_aspect) + (o.td_blocking_required ? ' — blocking required' + (k.td_blocked ? ' (blocked ✓)' : ' (NOT specified)') : ' — unblocked allowed') + ' (SDPWS T4.2.2 UNVERIFIED)');
        sec.appendChild(el('div', { className: 'table-scroll', style: { marginTop: '4px' } }, rt));
      }
      const flags = (r.flags || []).filter(f => !f.id.startsWith('E_'));
      if (flags.length) sec.appendChild(el('ul', { style: { fontSize: '0.78rem', color: 'var(--stale)', paddingLeft: '1.2rem' } }, ...flags.map(f => el('li', null, f.id + (f.message ? ': ' + f.message : '')))));
      if (cant && raw) {
        const lim = cantileverLimits({ Lp: Math.abs(k.td_y1), L: k.td_length });
        const ok = raw.engineer ? raw.engineer.cantileverOk : null;
        const btn = (v, lab) => el('button', { type: 'button', className: 'btn btn-sm' + (ok === v ? ' btn-primary' : ''),
          onClick() { raw.engineer = { ...(raw.engineer || {}), cantileverOk: v }; refresh(true); } }, lab);
        sec.appendChild(el('div', { style: { marginTop: '6px', fontSize: '0.8rem' } },
          el('strong', null, 'Cantilever limits — engineer review '), el('span', { style: small }, '(' + CANTILEVER_LIMITS_VERIFY + ')'),
          el('ul', { style: { paddingLeft: '1.2rem', margin: '4px 0' } }, ...lim.map(c => el('li', { style: { color: c.flag ? 'var(--stale)' : '' } }, c.id + '. ' + c.text + ' — ' + c.value + (c.flag ? ' ⚠' : '')))),
          el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
            el('span', null, 'Review: ', el('strong', { style: { color: ok === true ? 'var(--pass)' : ok === false ? 'var(--fail)' : 'var(--stale)' } }, ok === true ? 'limits met' : ok === false ? 'not met' : 'not reviewed')),
            btn(true, 'Reviewed — limits met'), btn(false, 'Not met'), btn(null, 'Clear'))));
      }
      box.appendChild(sec);
    }
  }
  return box;
}

function renderChecks(results) {
  const box = el('div');
  if ((results.checks || []).length) {
    box.appendChild(el('div', { className: 'section-header' }, 'Analysis checks'));
    box.appendChild(el('ul', { style: { fontSize: '0.85rem', paddingLeft: '1.2rem' } }, ...results.checks.map(c => el('li', { style: { color: c.ok && !c.warn ? 'var(--pass)' : c.warn ? 'var(--stale)' : 'var(--fail)' } },
      (c.ok && !c.warn ? '✓ ' : c.warn ? '⚠ ' : '✗ ') + c.msg))));
  }
  box.appendChild(el('div', { className: 'section-header' }, 'Plan checks'));
  if (!results.errors.length) box.appendChild(el('p', { style: { color: 'var(--pass)', fontSize: '0.85rem' } }, '✓ The plan is valid (outline, openings, walls, diaphragms, TDs, loads).'));
  else box.appendChild(el('ul', { style: { color: 'var(--fail)', fontSize: '0.85rem', paddingLeft: '1.2rem' } }, ...results.errors.map(e => el('li', null, e.msg))));
  if (results.warnings.length) box.appendChild(el('ul', { style: { color: 'var(--stale)', fontSize: '0.85rem', paddingLeft: '1.2rem' } }, ...results.warnings.map(e => el('li', null, '⚠ ' + e.msg))));
  return box;
}

// Book case (seeded into DA-BOOK): what the book says against what the tool gives so far
function renderVerification(inputs, results, toolPlan) {
  const v = inputs.verification;
  const box = el('div');
  box.appendChild(el('div', { className: 'section-header' }, 'Verification — ' + (v.id || '') + ' ' + (v.title || '')));
  box.appendChild(el('p', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)' } },
    'Source: ' + (v.pdf || '') + ', pages ' + (v.pages || '') + '. Book values are restated in tests/td-book/src/' + (v.id || '') + '.mjs; the tool must reach the same final values.'));
  const area = el('table', { className: 'dynamic-table' },
    el('tr', null, el('th', null, 'Quantity'), el('th', null, 'Book layout'), el('th', null, 'Tool'), el('th', null, 'Status')),
    el('tr', null, el('td', null, 'Sheathed area ΣA (sf)'), el('td', { className: 'mono' }, f2(v.sheathedArea)), el('td', { className: 'mono' }, f2(results.sumA)),
      el('td', { style: { color: Math.abs(results.sumA - v.sheathedArea) < 0.01 ? 'var(--pass)' : 'var(--fail)' } }, Math.abs(results.sumA - v.sheathedArea) < 0.01 ? 'ok' : 'DIFF')));
  box.appendChild(area);
  const exp = v.expected || [];
  const byPhase = {};
  exp.forEach(e => { byPhase[e.phase] = (byPhase[e.phase] || 0) + 1; });
  // values the built phases reach are compared (book tolerance, else 0.5 % or 0.5); the rest stay pending
  const BUILT = 6;
  const awaiting = (results.tdRuns || []).some(r => String(r.terminal).startsWith('ENGINEER_INPUT'));
  const row = e => {
    if (e.phase > BUILT) return { tool: null, status: 'pending' };
    if (e.phase >= 6 && awaiting) return { tool: null, status: 'review' }; // TD / net values wait for the cantilever review
    const t = toolValue(e.k, toolPlan, results.analysis);
    const want = e.vTool ?? e.v;
    if (t === null || Number.isNaN(t)) return { tool: t, status: 'DIFF' };
    return { tool: t, status: Math.abs(t - want) <= (e.tol ?? Math.max(0.005 * Math.abs(want), 0.5)) ? 'ok' : 'DIFF' };
  };
  const rows = exp.map(e => ({ e, ...row(e) }));
  const nOk = rows.filter(r => r.status === 'ok').length, nDiff = rows.filter(r => r.status === 'DIFF').length;
  if (awaiting) box.appendChild(el('p', { style: { fontSize: '0.8rem', color: 'var(--stale)' } }, 'A cantilever TD awaits the engineer review of its limits (TDs tab); TD and net-field values are compared after it.'));
  box.appendChild(el('p', { style: { fontSize: '0.8rem', color: nDiff ? 'var(--fail)' : 'var(--ink-secondary)', marginTop: '0.5rem' } },
    exp.length + ' book values (' + Object.entries(byPhase).map(([p, n]) => n + ' from phase ' + p).join(', ') + '): ' + nOk + ' ok, ' + nDiff + ' differ, '
    + (exp.length - nOk - nDiff) + ' pending (phases not built yet).'));
  const t = el('table', { className: 'dynamic-table', style: { fontSize: '0.78rem' } });
  t.appendChild(el('tr', null, el('th', null, 'Key'), el('th', null, 'Book'), el('th', null, 'Unit'), el('th', null, 'T/C'), el('th', null, 'Page'), el('th', null, 'Phase'), el('th', null, 'Tool')));
  rows.forEach(({ e, tool, status }) => t.appendChild(el('tr', null, el('td', { className: 'mono' }, e.k), el('td', { className: 'mono' }, String(e.vTool ?? e.v)), el('td', null, e.unit || ''),
    el('td', null, e.sense || ''), el('td', null, String(e.page) + (e.fig ? ' (' + e.fig + ')' : '')), el('td', null, String(e.phase)),
    el('td', { className: 'mono', style: { color: status === 'ok' ? 'var(--pass)' : status === 'DIFF' ? 'var(--fail)' : 'var(--ink-tertiary)' } },
      status === 'pending' ? 'pending' : status === 'review' ? 'awaiting review' : (tool === null ? '—' : Number.isNaN(tool) ? 'bands differ' : (Math.round(tool * 100) / 100)) + ' ' + (status === 'ok' ? '✓' : '✗')))));
  box.appendChild(el('div', { className: 'table-scroll', style: { maxHeight: '420px', overflowY: 'auto' } }, t));
  const plan = parsePlan(inputs);
  for (const dir of ['y', 'x'].filter(d => plan.loads.some(l => l.acts.endsWith(d)))) {
    box.appendChild(el('div', { style: { marginTop: '0.75rem' } }, drawPlan(plan, { ...newEditorState(), dir }, results.errors).svg));
  }
  return box;
}
