// Diaphragm Analysis (module id diaphragm_analysis) — irregular wood diaphragms by the visual shear transfer method (EX-IRREG-2E Ch 3–5).
// Inputs are the source of truth; results are always regenerated (regenerateResults).
// Plan editor: tdPlanEditor.js. Geometry: tdGeometry.js. Stored data: tdMigrate.js / tdModel.js.
// Phase 1 (2026-10-29): setup, plan editor, geometry checks. Phase 3: TD engine (tdCalc.js) and each drawn TD in the
// skill's frame (TDs tab). Analysis (basic shear, TD loads, member forces) follows.
import { el, clearEl, numOrBlank, sameNumber } from '../utils.js';
import { parsePlan, planErrors, sheathedArea, tdFrame, dirOf } from './tdGeometry.js';
import { TD_FLOW } from './tdFlow.js';
import { TD_SCHEMA, migrateItem, normalizeInputs } from './tdMigrate.js';
import { defaultInputs } from './tdModel.js';
import { renderPlanEditor, newEditorState, drawPlan, renderLoadList } from './tdPlanEditor.js';
import { swdExtract, linkedWalls, guessDir, swdWallShares, wallsAbove } from './tdWallLink.js';
import { omega0Of } from './shearWallCalc.js';
import { renderAnalysis } from './tdViews.js';
import { daPdfSections } from './tdReport.js';
import { toolValue } from './tdBookKeys.js';
import { loadCases, basicCase, wallShares, lineGroups, aboveLoads } from './tdBasicShear.js';
import { runTds, CLOSURE_TOL } from './tdDerive.js';
import { tdFields, members, netChecks, CLOSURE_REL, CLOSURE_LB } from './tdNet.js';
import { closeCase } from './tdClosure.js';
import { cantileverLimits, CANTILEVER_LIMITS_VERIFY } from './tdLimits.js';
import { sharedGrids, gridShareDiff, applyGridShare, localOnlyGrids } from './tdGridShare.js';

export const CALC_VERSION = 'td-v18'; // v18 (2026-11-10, user): every load case is analysed in both senses (+ and −) by a full second run (results.senses; checks the reversed run fails are added, caseId '<id>:rev'); the line forces sent to Shear Wall Design are those of the entered sense, unchanged. // v17 (2026-11-09, open item 5): offset lines with SWD shares settle — the force from above on a group line uses this level's line force as given (it was clamped to ≥ 0, so a negative one fed back and the rounds swung); a wall whose auto nailing alternates (A → B → A) is held at the heavier in the SWD copy (warning swd-group-nailing); up to 8 rounds. // v16 (2026-11-09, open item 6-A): opt-in per line of walls above "each wall into the diaphragm under it" (aboveCollectors[line].own) — no collector along the grid, a wall split by length over the diaphragms under it; absent = full depth as before. // v15 (2026-11-09, open item 0-A): offset line with SWD deflection distribution — equal δ only when every wall has a deflection (else that round split by capacity, warning swd-group-defl, kept across E / W); a wall without a deflection took the whole line. // v14 (2026-11-09, user test 26998): a wall line bridged across a gap inside the outline counts the walls (and walls above) standing on the bridged stretch in its member — the TD strut load counted them, the member did not (line 2 over OP1: −816 lb open). // v13 (2026-11-06, user test 26998): a TD's strut load P includes the share of a wall of its load line that runs past the TD edge into the TD (it was left out: the member did not close). // v12 (2026-11-05, user, project 26997): walls of the story above (SWD level above): those that end at this floor are concentrated loads into the diaphragms spanning across their grid (shared by depth) and a source on their grid's member (distributor); walls that continue add a drag on their own line; bounded grids, shared grids, grid link with SWD; no line-length check. // v11 (2026-11-04, user): TD overhangs picked by grid, one per support (both ends allowed); any number of TD load lines anywhere from tip to tip — between the supports, on a support (straight into it), on an overhang (superposed engine runs: span / cantilever / mirrored cantilever); Auto load lines on the overhangs; a TD past a support without an overhang there is an error; a case with open member runs FAILS and is held from SWD. // v10 (2026-11-03, user test 26999): TD load lines Auto count only walls of the load direction whose line reaches the TD edge; strut TD loaded from both edges; any number of load lines on a simple-span TD (superposed single-load engine runs); closure solver keeps equilibrium, a case out of balance FAILS and is held from SWD; checks: opposite / double seismic loads, grid off the plan, wall inside a span taking nothing, offset line without a strut, TD past its supports. // v9 (2026-11-03): general closure solver (offset lines, wall lines, collectors into a diaphragm G7 with its basic field recomputed G9, TD reaction split G2), Gauss–Newton to exact closure; a group takes only its parts of a grid (G8); no opening warning at a notch. // v8 (2026-11-02): chord cut in an opening = section M/H by default; opening-edge member zero at the band's zero-shear point when its shear changes sign; opening-collector warning (opening study). // v7 (2026-11-02): diaphragm pieces; outside TD shear averaged where a wall ends inside a segment (G5); an edge carrying on past the TD is closed on its line (G6); chord cut inside an opening: consistent Vierendeel / section setting (G4). // v6: offset wall lines, line forces iterated to closure (Phase 7). // v5: TD and net fields, net-field members (Phase 6). // v2: TD geometry in the skill frame (results.tds); v3: basic shear, line forces, wall shares (Phase 4); v4: derived TD inputs + TD engine runs (Phase 5)
const f2 = v => (Number.isFinite(v) ? v.toFixed(2) : '—');
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const SHEATHING = [['wsp', 'Wood structural panels'], ['lumber_straight_single', 'Lumber, straight (single)'],
  ['lumber_diagonal_single', 'Lumber, diagonal (single)'], ['lumber_diagonal_double', 'Lumber, diagonal (double)']];

// The plan with the walls of the linked Shear Wall Design item (if any) in place of the typed walls
export function planWithLinks(inputs, refs = {}) {
  const base = parsePlan(inputs);
  if (!refs.wallSource) return { plan: base, link: null };
  const link = linkedWalls(inputs, base, refs.wallSource);
  const plan = parsePlan({ ...inputs, walls: link.walls });
  // walls of the story above (step 5; drawn and checked, no force yet)
  link.above = wallsAbove(plan, refs.wallSource, link, inputs);
  plan.wallsAbove = link.above.walls;
  return { plan, link };
}

// Results of the current phase: plan checks and ΣA. refs.wallSource = the linked SWD definition (swdExtract).
// lineForces: per SWD direction / line, the force the diaphragm delivers (kip, E and W) — filled by Phase 4.
// opts (tests only): superposeFrom — number of load lines from which a TD is run as superposed single-load runs
export function calcAll(inputs, refs = {}, opts = {}) {
  const { plan, link } = planWithLinks(inputs, refs);
  const issues = [...planErrors(plan), ...(link ? link.issues : []), ...(link && link.above ? link.above.issues : []), ...offsetLinePaths(plan)];
  // shared grids (user 2026-11-05): a grid here that the owner item does not have
  if (refs.gridSource) {
    const loc = localOnlyGrids(inputs, refs.gridSource);
    if (loc.length) issues.push({ code: 'grid-local', warn: true, msg: `Grid${loc.length > 1 ? 's' : ''} ${loc.join(', ')} ${loc.length > 1 ? 'are' : 'is'} not in the shared grids (owner item) — add ${loc.length > 1 ? 'them' : 'it'} there, or stop using ${loc.length > 1 ? 'them' : 'it'} here and delete ${loc.length > 1 ? 'them' : 'it'}.` });
  }
  const errors = issues.filter(e => !e.warn), warnings = issues.filter(e => e.warn);
  const sumA = sheathedArea(plan);
  const fx = Number(inputs.level && inputs.level.fx);
  const q = Number.isFinite(fx) && sumA > 0 ? fx * 1000 / sumA : null; // psf from F_x (kip)
  const an = errors.length ? { cases: [], lineForces: [], issues: [] } : analyse(plan, q, link, refs.wallSource, opts);
  // every load kind is either entered or declared "none" on its Setup page (user 2026-11-03)
  for (const [k, page] of [['E', 'Seismic loading'], ['W', 'Wind loading']])
    if (!plan.noLoad[k] && !plan.loads.some(l => (l.kind || (l.mode === 'seismic' ? 'E' : 'W')) === k))
      warnings.push({ code: 'no-load-' + k, warn: true, msg: `No ${k === 'E' ? 'seismic' : 'wind'} load entered — add one on Setup → ${page}, or press "No ${k === 'E' ? 'seismic' : 'wind'} load" there.` });
  // a wall above whose force cannot be carried is a plan error (user 2026-11-05: it was only a warning and the case then
  // failed on open member runs with no reason given)
  const blocking = new Set(['above-collector-inside', 'above-no-diaphragm']);
  errors.push(...an.issues.filter(i => blocking.has(i.code)).map(i => ({ ...i, warn: false })));
  warnings.push(...an.issues.filter(i => !blocking.has(i.code)).map(i => ({ ...i, warn: true })));
  const frames = new Map(plan.tds.map(t => [t.id, tdFrame(t)]));
  const tdOpts = { codeEdition: inputs.codeEdition, designBasis: inputs.designBasis,
    sheathing: (inputs.diaphragm && inputs.diaphragm.sheathing) || 'wsp', blocked: !inputs.diaphragm || inputs.diaphragm.blocked !== false,
    ...(opts.superposeFrom ? { superposeFrom: opts.superposeFrom } : {}) };
  const runCase = cs => runTds(plan, cs, frames, inputs.tds, tdOpts);
  const tdRuns = [];
  for (const cs of an.cases) {
    // closure solver: offset lines, collectors, TD hand-overs; an offset line of linked walls is split like Shear Wall
    // Design (option B, user 2026-11-03) — repeated with SWD's new shares until they settle
    const it = link && refs.wallSource ? solveLinkedGroups(plan, cs, an.cases, link, refs.wallSource, runCase, frames, warnings) : closeCase(plan, cs, runCase, { frames });
    if (it) { cs.offset = it.offset; tdRuns.push(...it.tdRuns); continue; }
    const runs = runCase(cs);
    tdRuns.push(...runs);
    cs.fields = tdFields(plan, cs, runs, frames); cs.members = members(plan, cs, cs.fields);
  }
  // Gate (user 2026-10-30): a TD that did not run makes the net field / members of its case incomplete — they are
  // paused, not reported. Basic shear and line forces stay (an offset-line case's line forces are held from SWD).
  for (const cs of an.cases) cs.paused = tdRuns.filter(r => r.caseId === cs.id && blocksCase(r)).map(r => ({ mark: r.mark, terminal: r.terminal, reason: pauseReason(r) }));
  if (an.cases.some(cs => cs.offset)) an.lineForces = linkLineForces(an.cases, link);
  for (const cs of an.cases) if (cs.offset && cs.paused.length && link)
    warnings.push({ code: 'swd-held', warn: true, msg: `Line forces of the ${cs.kind === 'E' ? 'seismic' : 'wind'} case along ${cs.dir} are held from Shear Wall Design until ${cs.paused.map(p => 'TD ' + p.mark).join(', ')} run(s) (offset wall line).` });
  for (const r of tdRuns) warnings.push(...(r.issues || []).map(i => ({ ...i, warn: true })));
  warnings.push(...wallsInSpan(plan, an.cases));
  let checks = equilibriumGate(an, an.cases.flatMap(cs => (cs.paused.length ? pausedChecks(plan, cs, tdRuns, frames) : [...netChecks(plan, cs, tdRuns, frames), ...offsetChecks(cs)])), link, warnings);
  for (const cs of an.cases) if (cs.failed && (cs.aboveMissed || []).length && !checks.some(c => c.caseId === cs.id && c.code === 'failed'))
    checks = [...checks, { caseId: cs.id, code: 'failed', ok: false, msg: `${cs.dir === 'y' ? '↕' : '↔'} ${cs.kind}: FAILED — ${cs.failed} (see the plan errors: collector end inside a diaphragm, or no diaphragm across the grid). The line forces are not sent to Shear Wall Design.` }];
  const res = {
    calcVersion: CALC_VERSION,
    level: (inputs.level && inputs.level.name) || '',
    sumA,
    q,
    forceLevels: forceLevels(inputs, refs),
    errors, warnings,
    counts: { grids: plan.grids.length, openings: plan.openings.length, walls: plan.walls.length, tds: plan.tds.length, diaphragms: plan.diaphragms.length },
    wallLink: link ? { levelId: link.levelId, lines: link.lines.map(l => ({ dirId: l.dirId, dir: l.dir, lineId: l.lineId, name: l.name, grid: l.grid ? l.grid.name : null, origin: l.origin,
      span: l.span || null, gridHow: l.gridHow || null, planLength: l.planLength, swdLength: l.swdLength,
      // grid link (user 2026-11-05): where the grid sits, the sheathed stretches along it at this level, origin from SWD
      axis: l.grid ? l.grid.axis : null, at: l.grid ? l.grid.at : null, bands: l.bands || [], originFromSwd: !!l.originFromSwd })) } : null,
    // the plan grids (user 2026-11-05), read by a linked Shear Wall Design item (Loading → Plan grids): from / to = extent
    gridsFrom: (inputs.refs && inputs.refs.gridSource) || null, // shared grids: the owner item (user 2026-11-05)
    // walls of the story above (step 5): where they stand on this plan and whether they end at this floor
    wallsAbove: link && link.above ? { level: link.above.upperLevel, walls: link.above.walls.map(w => ({ mark: w.mark, line: w.line, swdWallId: w.swdWallId,
      swdLineId: w.swdLineId, swdDirId: w.swdDirId, dir: w.dir, axis: w.axis, at: w.at, from: w.from, to: w.to, kind: w.kind, onSheathing: w.onSheathing,
      E: w.VE ?? null, W: w.VW ?? null, collector: w.collector || null, own: !!w.own })) } : null,
    // B4 (step 6): the force of each wall above that this diaphragm took (kip, 1.0E / 1.0W) — Shear Wall Design compares it
    // with what it handed over at this floor
    transferIn: link && link.above ? (an.cases || []).flatMap(cs => (cs.above || []).filter(a => a.kind === 'transfer' && a.V && !(cs.aboveMissed || []).some(m => m.mark === a.mark))
      .map(a => ({ swdWallId: a.swdWallId, swdLineId: a.swdLineId, mark: a.mark, kind: cs.kind, V: a.V / 1000 }))) : [],
    planGrids: plan.grids.filter(g => g.name && Number.isFinite(g.at)).map(g => ({ name: g.name, axis: g.axis, at: g.at, from: Number.isFinite(g.lo) ? g.lo : null, to: Number.isFinite(g.hi) ? g.hi : null, ref: g.ref })),
    lineForces: an.lineForces,
    analysis: { cases: an.cases, tdRuns },
    checks,
    tdRuns,
    tds: plan.tds.map(t => {
      const f = frames.get(t.id);
      return { id: t.id, mark: t.mark, dir: t.dir, ok: f.ok, issues: f.issues, geometry: f.geometry, ySign: f.ySign ?? 1,
        bottom: f.bottom ? f.bottom.name : null, top: f.top ? f.top.name : null, edges: [f.edgeX1, f.edgeX2], spanAxis: f.spanAxis || null, tips: f.tips || null,
        overhangs: (t.overhangs || []).map(o => (o.support ? o.support.name : '?') + '→' + (o.tipGrid ? o.tipGrid.name : '?')),
        loadLines: (f.loads || []).map(l => ({ grid: l.grid.name, y: l.y, side: l.side })) };
    }),
    status: errors.length ? 'fail' : 'ok',
  };
  // Diaphragm level with walls above (step 7, user 2026-11-05): k_D·A + Ω₀·T (×1.25) = k_D × (the run with the walls
  // above × Ω₀ / k_D) — the analysis is linear, so one more run of the same plan gives it with the same members and
  // fields. Kept in memory only (not enumerable, so it is not stored; results are regenerated on open).
  if (!opts.noLevelD && an.cases.some(cs => cs.kind === 'E' && (cs.above || []).some(a => a.V))) {
    const fl = res.forceLevels;
    const d = calcAll(inputs, refs, { ...opts, noLevelD: true, aboveScaleE: fl.transfer / fl.diaphragm });
    Object.defineProperty(res, 'levelD', { value: ((d.analysis && d.analysis.cases) || []).filter(c => c.kind === 'E'), enumerable: false });
  }
  Object.defineProperty(res, 'plan', { value: plan, enumerable: false }); // the plan with the linked walls (PDF, not saved)
  // Both senses (user 2026-11-10, option 1-B): every load case is also analysed acting the other way (+y ↔ −y,
  // +x ↔ −x) by a full second run — not a sign flip: wind loads its windward strip on the other face, and every rule
  // of the run (TDs, closure, Shear Wall Design rounds) applies to the reversed loads as it does to the entered ones.
  // The reversed run is kept in memory (not enumerable, not saved: results are regenerated on open); only its sense
  // per case and any check it fails are stored. The line forces sent to Shear Wall Design stay those of the entered
  // sense.
  if (!opts.noReverse && an.cases.length) {
    const rv = calcAll(reverseLoads(inputs), refs, { ...opts, noReverse: true });
    const rCases = (rv.analysis && rv.analysis.cases) || [];
    const lcs = loadCases(plan);
    res.senses = an.cases.map(cs => { const lc = lcs.find(x => x.id === cs.id), a = lc && lc.loads[0] ? lc.loads[0].acts : '';
      return { caseId: cs.id, entered: a, reversed: a ? flipActs(a) : '' }; });
    const sense = id => { const s = res.senses.find(x => x.caseId === id); return s ? s.reversed : 'reversed'; };
    // a check the reversed run fails that the entered sense does not fail the same way (no duplicate of the same issue)
    const failsToo = c => res.checks.some(x => x.caseId === c.caseId && x.code === c.code && !x.ok);
    res.checks = [...res.checks, ...(rv.checks || []).filter(c => !c.ok && c.caseId && !failsToo(c)).map(c => ({ ...c, caseId: c.caseId + ':rev', reversed: true,
      msg: `Reversed (acts ${sense(c.caseId)}): ` + c.msg }))];
    Object.defineProperty(res, 'reverse', { value: { cases: rCases, levelD: rv.levelD || null, tdRuns: rv.tdRuns || [] }, enumerable: false });
  }
  return res;
}

// The loads acting the other way: +y ↔ −y, +x ↔ −x (every value as entered)
export const flipActs = a => (String(a).startsWith('-') ? '+' : '-') + String(a).slice(1);
export function reverseLoads(inputs) {
  return { ...inputs, loads: (inputs.loads || []).map(l => ({ ...l, acts: flipActs(l.acts) })) };
}

// A case whose line forces do not balance its load fails (user test 2026-11-03: the closure solver could drift off when
// a model could not close; it now keeps equilibrium as an equation, so this is the safety net): its line forces are
// held from Shear Wall Design (null) and its TD / net / member values are not reported. Returns the checks to show.
export function equilibriumGate(an, checks, link, warnings) {
  // a case that balances but whose member runs do not all close fails as well (user 2026-11-04, Q2): its line forces
  // are held from Shear Wall Design; its member diagrams stay on screen so the open runs can be found
  for (const c of checks.filter(x => x.code === 'closure' && !x.ok)) {
    const cs = an.cases.find(x => x.id === c.caseId);
    if (!cs || checks.some(x => x.caseId === c.caseId && x.code === 'equilibrium' && !x.ok)) continue;
    cs.notClosed = c.msg.replace(/^.*?: /, '');
    if (link) warnings.push({ code: 'swd-held', warn: true, msg: `Line forces of the ${cs.kind === 'E' ? 'seismic' : 'wind'} case along ${cs.dir} are held from Shear Wall Design: member runs do not close.` });
    checks = [...checks, { caseId: cs.id, code: 'failed', ok: false, msg: `${cs.dir === 'y' ? '↕' : '↔'} ${cs.kind}: FAILED — member runs do not close (${cs.notClosed}). The line forces are not sent to Shear Wall Design. The member diagrams (View 4) show the open runs; check the TDs (supports, load lines, overhangs), the offset lines and the diaphragm supports of this load case.` }];
  }
  const unbalanced = checks.filter(c => c.code === 'equilibrium' && !c.ok);
  if (!unbalanced.length) { if (an.cases.some(cs => cs.notClosed)) an.lineForces = linkLineForces(an.cases, link); return checks; }
  for (const c of unbalanced) {
    const cs = an.cases.find(x => x.id === c.caseId);
    cs.failed = 'line forces do not balance the load (' + c.msg.replace(/^.*?: /, '') + ')';
    if (link) warnings.push({ code: 'swd-held', warn: true, msg: `Line forces of the ${cs.kind === 'E' ? 'seismic' : 'wind'} case along ${cs.dir} are held from Shear Wall Design: they do not balance the load.` });
  }
  const out = checks.filter(c => !unbalanced.some(u => u.caseId === c.caseId) || ['equilibrium', 'td', 'paused'].includes(c.code));
  for (const c of unbalanced) {
    const cs = an.cases.find(x => x.id === c.caseId);
    out.push({ caseId: cs.id, code: 'failed', ok: false, msg: `${cs.dir === 'y' ? '↕' : '↔'} ${cs.kind}: FAILED — ${cs.failed}. TD / net shear, member forces and closure are not reported; the line forces are not sent to Shear Wall Design. Check the TDs, the offset lines and the diaphragm supports of this load case.` });
  }
  an.lineForces = linkLineForces(an.cases, link);
  return out;
}

// An offset line of resistance needs a member path between its lines (user decision D1, 2026-11-03: "the walls are
// not connected by a strut, so grids 4 and 5 are not one line"). The path is a TD of that load direction that has one
// of the lines as a load line (the strut runs into it) and the other as a support or another load line — book Ex 3.3
// TD1 (load B, support C), Ch 8.4 TD1 (load D, support E). Every line of the group must be linked this way.
function offsetLinePaths(plan) {
  const out = [];
  for (const dir of ['x', 'y']) {
    if (!plan.loads.some(l => dirOf(l.acts) === dir)) continue;
    for (const g of lineGroups(plan, { axis: dir === 'y' ? 'x' : 'y' })) {
      const root = new Map(g.gridIds.map(id => [id, id]));
      const find = a => (root.get(a) === a ? a : find(root.get(a)));
      for (const t of plan.tds.filter(x => x.dir === dir)) {
        const ld = t.loads.map(l => l.grid && l.grid.id).filter(id => root.has(id));
        const sp = t.supports.map(s => s && s.id).filter(id => root.has(id));
        for (const a of ld) for (const b of [...ld, ...sp]) root.set(find(a), find(b));
      }
      const parts = new Set(g.gridIds.map(find));
      if (parts.size > 1) {
        const names = g.gridIds.map(id => plan.gridById.get(id).name);
        out.push({ code: 'group-no-path', ref: g.walls[0] && g.walls[0].id,
          msg: `Offset line ${g.name} (lines ${names.join(', ')}): no strut connects its lines — no TD (load along ${dir}) takes one of them as a load line with another as its support or load line. Without a continuous strut they are separate lines of resistance: ${g.walls.some(w => w.linked) ? 'remove the offset line on Setup → Shear wall link' : 'give the walls on each grid their own wall line name'}, or draw the TD that carries the strut force.` });
      }
    }
  }
  return out;
}

// A shear wall resisting the case's load whose grid lies inside a diaphragm's span (between its supports, over one of
// its pieces) but which takes no force — not a support, not an offset-line member (user test 2026-11-03, 2nd floor:
// SW-9 on line 4 inside D1 between 5 and 2 took 0 without a word). Book Ch 8.4 splits the plan into one diaphragm per
// bottom wall line instead.
function wallsInSpan(plan, cases) {
  const out = [], seen = new Set();
  for (const cs of cases) {
    const taking = new Set(cs.lines.flatMap(l => (l.walls || []).filter(w => Math.abs(w.share || 0) > 0.5).map(w => w.id)));
    for (const w of plan.walls) {
      const g = plan.gridById.get(w.gridId);
      if (!g || g.axis === cs.dir || taking.has(w.id) || seen.has(w.id + cs.id)) continue;
      const d = plan.diaphragms.find(d => d.dir === cs.dir && d.supports.length === 2 && d.supports.every(Boolean) &&
        g.at > Math.min(...d.supports.map(s => s.at)) + 1e-6 && g.at < Math.max(...d.supports.map(s => s.at)) - 1e-6 &&
        d.parts.some(q => (g.axis === 'x' ? g.at >= q.x1 && g.at <= q.x2 && w.to > q.y1 && w.from < q.y2 : g.at >= q.y1 && g.at <= q.y2 && w.to > q.x1 && w.from < q.x2)));
      if (!d) continue;
      seen.add(w.id + cs.id);
      out.push({ code: 'wall-in-span', warn: true, msg: `${w.mark || 'A shear wall'} on line ${g.name} lies inside diaphragm ${d.mark} (between ${d.supports.map(s => s.name).join(' and ')}) and takes no force (${cs.kind === 'E' ? 'seismic' : 'wind'} along ${cs.dir}). Split the diaphragm so that line ${g.name} is a support of the part over it (book Ch 8.4), or — only when a continuous strut connects it to another wall line — make them an offset line.` });
    }
  }
  return out;
}

// An offset line of resistance made of linked walls (Setup → Shear wall link): its force is shared by the walls the
// way Shear Wall Design shares a line — capacity × length or equal δ, with the force from the stories above kept on
// each SWD line (tdWallLink.swdWallShares groups). SWD's shares depend on the forces (deflection, auto nailing), so:
// solve closure with the shares of the last SWD run, send the new line forces to an SWD copy, repeat until no weight
// moves more than 1e-5 of the group (max 6 rounds). Returns closeCase's result (null when nothing to solve).
export const GROUP_ROUNDS = 8; // 6 → 8 (open item 5-A): a wall found alternating is held from round 3, then the rounds settle
function solveLinkedGroups(plan, cs, cases, link, swd, runCase, frames, warnings) {
  const groups = lineGroups(plan, cs).filter(g => g.walls.every(w => w.linked));
  if (!groups.length) return closeCase(plan, cs, runCase, { frames });
  const clone = o => JSON.parse(JSON.stringify(o));
  const snap = { diaphragms: cs.diaphragms, lines: clone(cs.lines.map(l => ({ ...l, walls: undefined }))), walls: cs.lines.map(l => l.walls) };
  const spec = groups.map(g => ({ name: g.name, wallIds: g.walls.map(w => w.id), lineIds: [...new Set(g.walls.map(w => w.swdLineId).filter(Boolean))] }));
  const gridOfLine = id => { const l = link.lines.find(x => x.lineId === id); return l && l.grid ? l.grid.id : null; };
  const norm = b => Object.fromEntries(Object.entries(b).map(([n, x]) => { const s = Object.values(x.weights).reduce((t, v) => t + v, 0) || 1; return [n, Object.fromEntries(Object.entries(x.weights).map(([k, v]) => [k, v / s]))]; }));
  let it = null, prev = null, rounds = 0, settled = false, method = {};
  // open item 5-A (2026-11-09): SWD re-picks the auto nailing of a wall from its share in every round, so the capacity
  // weights can flip between two states and never settle (26998 2/3: SW-70 / 71). Only a wall that really alternates —
  // its pick comes back after a different one (A → B → A) — is held, in this SWD copy only, at the heavier of the two;
  // a wall whose nailing changes once and stays is left free, so a case that settles is unchanged (26996: DA = SWD).
  const picks = [], held = [], fixed = {};
  const groupWallIds = [...new Set(spec.flatMap(g => g.wallIds))].map(id => String(id).replace(/^swd:/, ''));
  for (; rounds < GROUP_ROUNDS; rounds++) {
    const lf = linkLineForces(cases, link).map(f => ({ ...f, E: f.E || 0, W: f.W || 0 }));
    if (rounds >= 3) for (const id of groupWallIds) {
      if (fixed[id]) continue;
      const a = picks[rounds - 3][id], b = picks[rounds - 2][id], c = picks[rounds - 1][id];
      if (!a || !b || !c || [a, b, c].some(x => x.id === 'wswh') || a.id !== c.id || a.id === b.id) continue;
      const h = (b.cap || 0) > (a.cap || 0) ? b : a;
      fixed[id] = h.id;
      held.push({ mark: (plan.walls.find(w => w.id === 'swd:' + id) || {}).mark || id, picks: [a.label, b.label], held: h.label });
    }
    const sw = swdWallShares(swd, link.levelId, lf, spec, Object.keys(fixed).length ? { fixNailing: fixed } : {});
    picks.push(sw.nailing || {});
    if (sw.error) { warnings.push({ code: 'swd-calc', warn: true, msg: sw.error + ' — offset line split by wall length.' }); return closeCase(plan, cs, runCase, { frames }); }
    const basis = {};
    for (const g of groups) {
      const e = sw.groups[g.name];
      if (!e) continue;
      const x = e[cs.kind];
      const above = {};
      for (const [lineId, kip] of Object.entries(x.above)) { const gid = gridOfLine(lineId); if (gid) above[gid] = (above[gid] || 0) + kip * 1000 * cs.sigma; }
      basis[g.name] = { method: e.method, weights: x.weights, above };
      method[g.name] = e;
    }
    const n = norm(basis), p = prev && norm(prev);
    if (p && Object.keys(n).every(k => p[k] && Object.keys(n[k]).every(w => Math.abs(n[k][w] - (p[k][w] || 0)) < 1e-5)
      && Object.keys(basis[k].above).every(gid => Math.abs(basis[k].above[gid] - (prev[k].above[gid] || 0)) < 0.5))) { settled = true; break; }
    cs.diaphragms = snap.diaphragms; cs.lines = clone(snap.lines); cs.lines.forEach((l, i) => { l.walls = snap.walls[i]; });
    it = closeCase(plan, cs, runCase, { frames, groupBasis: basis });
    prev = basis;
  }
  if (it) it.offset.swdRounds = { rounds, settled, held };
  if (held.length) warnings.push({ code: 'swd-group-nailing', warn: true, msg: `Offset line ${groups.map(g => g.name).join(', ')}: the automatic nailing of ${held.map(h => h.mark + ' (' + h.picks.join(' ↔ ') + ')').join(', ')} alternated between rounds; for the split it is held at the heavier (${held.map(h => h.mark + ': ' + h.held).join(', ')}). Shear Wall Design picks the lightest nailing for the final loads — if it picks a lighter one, its wall shares on these lines differ slightly from this analysis: check them there, or set that nailing in Shear Wall Design.` });
  for (const [name, e] of Object.entries(method)) {
    if (e.mixed) warnings.push({ code: 'swd-group-mixed', warn: true, msg: `Offset line ${name}: its Shear Wall Design lines use different distribution methods — the group is split by capacity.` });
    if (e.deflectionFailed) warnings.push({ code: 'swd-group-defl', warn: true, msg: `Offset line ${name}: no deflection from Shear Wall Design for every wall — the group is split by capacity.` });
  }
  // a wall left out of the group but on the same SWD line as group walls: SWD shares that line's force among all its
  // walls by its own rule, so it does not design the left-out wall for DA's split (tested, Ch 8.4 SW7)
  for (const g of groups) {
    const lineIds = new Set(g.walls.map(w => w.swdLineId));
    const out = plan.walls.filter(w => w.linked && lineIds.has(w.swdLineId) && !g.walls.includes(w));
    if (out.length) warnings.push({ code: 'swd-group-partial', warn: true, msg: `Offset line ${g.name}: ${out.map(w => w.mark).join(', ')} ${out.length > 1 ? 'are' : 'is'} left out of the group but on the same Shear Wall Design line as walls of the group. Shear Wall Design shares that line's force among all its walls by its own rule, so its wall forces there differ from this analysis. Put ${out.length > 1 ? 'them' : 'it'} in the group, or check that line in Shear Wall Design.` });
  }
  if (!settled) warnings.push({ code: 'swd-group-rounds', warn: true, msg: `Offset line ${groups.map(g => g.name).join(', ')}: the Shear Wall Design shares did not settle in ${GROUP_ROUNDS} rounds — the last round is used.` });
  return it;
}

// Phase 4: every load case (direction × E / W) → span beams, basic shear, line forces (wall-less lines into their
// TDs), wall shares (by length; with a Shear Wall Design link, in the ratio SWD's own calcAll gives — B4).
// lineForces: per linked SWD line, the force this diaphragm delivers (kip, load-direction sign, 1.0E / 1.0W as entered).
// opts.aboveScaleE (step 7): the seismic forces of the walls above × this factor (the diaphragm-level run, Ω₀ / k_D)
export function analyse(plan, q, link, swd, opts = {}) {
  const issues = [];
  // walls of the story above (step 6, user 2026-11-05): their 1.0E / 1.0W story shear from SWD's own split of that level
  // (SWD calcAll on the linked definition), in lb along the load
  const ab = (link && link.above && link.above.walls) || [];
  const up = ab.length && swd ? swdWallShares(swd, link.above.upperLevelId, []) : null;
  if (up && up.error) issues.push({ code: 'swd-calc', msg: up.error });
  const vRaw = (w, kind) => (up && !up.error ? (up.weights[kind]['swd:' + w.swdWallId] || 0) * 1000 : 0);
  const vOf = (w, kind) => vRaw(w, kind) * (kind === 'E' && Number.isFinite(opts.aboveScaleE) ? opts.aboveScaleE : 1);
  for (const w of ab) { w.VE = vRaw(w, 'E') / 1000; w.VW = vRaw(w, 'W') / 1000; } // kip at 1.0E / 1.0W, for the outputs / tables
  const cases = loadCases(plan).map(lc => {
    const sg = lc.loads.length && String(lc.loads[0].acts).startsWith('-') ? -1 : 1;
    const above = ab.filter(w => w.dir === lc.dir).map(w => ({ mark: w.mark, line: w.line, kind: w.kind, gridId: w.gridId, axis: w.axis, at: w.at,
      from: w.from, to: w.to, V: vOf(w, lc.kind), swdWallId: w.swdWallId, swdLineId: w.swdLineId, collector: w.collector || null, own: !!w.own }));
    // with collector loads into the diaphragms spanning across them (G7) and the walls above that end here (step 6)
    const { c, lf } = basicCase(plan, lc, { q, above: aboveLoads({ above, sigma: sg }) });
    issues.push(...c.issues, ...lf.issues);
    // a wall whose force could not be placed (user 2026-11-05): no source on its member (it would leave the run open), and
    // the case is held from Shear Wall Design — its line forces would miss that force (FAILED check in calcAll)
    for (const m of c.aboveMissed || []) for (const a of above) if (a.mark === m.mark && a.gridId === m.gridId) a.missed = true;
    if ((c.aboveMissed || []).length) c.failed = 'the force of ' + [...new Set(c.aboveMissed.map(m => m.mark))].join(', ') + ' (walls above) cannot be placed in a diaphragm';
    // one message per line (its walls listed)
    const inside = (c.aboveMissed || []).filter(m => m.reason === 'inside');
    for (const line of [...new Set(inside.map(m => m.line))]) {
      const ms = inside.filter(m => m.line === line), a = ms[0];
      issues.push({ code: 'above-collector-inside', msg: `Collector of line ${line} (${a.collector.from}–${a.collector.to}) ends inside diaphragm ${[...new Set(ms.flatMap(m => m.diaphragms))].join(', ')} (load along ${lc.dir}): the force of ${ms.map(m => m.mark).join(', ')} would go into only part of its depth. Split that diaphragm at the collector ends — a separate diaphragm on each side, so the ends become chords — or set the collector to the diaphragm edges, or leave it blank for the full depth.` });
    }
    for (const a of (c.aboveMissed || []).filter(m => m.reason === 'own')) issues.push({ code: 'above-no-diaphragm', msg: `Wall ${a.mark} of the story above (line ${a.line}) ends at this floor; its line is set to "into the diaphragm under each wall", but no diaphragm of the ${lc.kind === 'E' ? 'seismic' : 'wind'} case along ${lc.dir} spanning across its grid lies under the wall (${f2(Math.min(a.from, a.to))}–${f2(Math.max(a.from, a.to))}) — its force cannot be carried. Draw the diaphragm under it, or untick the switch (force shared along the grid).` });
    for (const a of (c.aboveMissed || []).filter(m => m.reason !== 'inside' && m.reason !== 'own')) issues.push({ code: 'above-no-diaphragm', msg: `Wall ${a.mark} of the story above (line ${a.line}) ends at this floor, but no diaphragm of the ${lc.kind === 'E' ? 'seismic' : 'wind'} case along ${lc.dir} spans across its grid (it is outside every diaphragm or on a support line) — its force cannot be carried. Draw the diaphragm across it, or check the line start.` });
    if (lc.loads.some(l => l.mode === 'seismic') && q === null) issues.push({ code: 'no-fx', msg: 'Seismic load: F_x is missing (Setup) — seismic loads are 0.' });
    return { ...c, q, lines: lf.lines, above, issues: undefined };
  });
  const lineForces = linkLineForces(cases, link);
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
    ln.weights = weights; // kept for Phase 7 (a line force moved by the iteration is re-shared on the same basis)
    ln.walls = wallShares(plan, ln, weights);
    // two SWD lines on one connected part of a grid (sheathing / strut runs on between them): the diaphragm cannot
    // tell them apart, so the part's force is split between them by SWD's shares of two separate lines (2026-11-03)
    const grouped = new Set(lineGroups(plan, c).flatMap(g => g.walls.map(w => w.id)));
    for (const p of ln.parts || []) {
      const ids = [...new Set(plan.walls.filter(w => w.linked && w.gridId === ln.gridId && w.to > p.lo + 1e-6 && w.from < p.hi - 1e-6 && !grouped.has(w.id)).map(w => w.swdLineId))];
      const ref = ln.gridId + '@' + p.lo;
      if (ids.length > 1 && !issues.some(i => i.code === 'swd-lines-one-part' && i.ref === ref)) {
        const names = ids.map(id => ((link && link.lines.find(l => l.lineId === id)) || {}).name || id);
        issues.push({ code: 'swd-lines-one-part', ref, msg: `Grid ${ln.name}: Shear Wall Design lines ${names.join(', ')} sit on one continuous part (${+p.lo.toFixed(2)}–${+p.hi.toFixed(2)}) — the diaphragm delivers one force there; it is split between them by their Shear Wall Design shares. If they act as one line of resistance, make them one SWD line (or an offset line on Setup).` });
      }
    }
  }
  return { cases, lineForces, issues };
}

// A TD run that leaves its case incomplete: engineer input pending, a stop, an error, or not run for a reason other
// than "no disrupted force" (a TD with nothing to carry adds no shear, so the case is complete without it)
export function blocksCase(r) {
  const t = String(r.terminal);
  if (t === 'OUTPUT') return false;
  if (t === 'NOT_RUN') return !(r.issues || []).some(i => i.code === 'td-no-load');
  return true;
}
function pauseReason(r) {
  const t = String(r.terminal);
  if (t.startsWith('ENGINEER_INPUT')) return 'awaits the cantilever review (TDs tab → "Reviewed — limits met")';
  if (t.startsWith('HARD_STOP')) return 'stopped: ' + t.slice(10).replace(/_/g, ' ').toLowerCase() + ' (TDs tab)';
  const i = (r.issues || []).find(x => !x.warn) || (r.issues || [])[0];
  return (t === 'ERROR' ? 'error' : 'not run') + (i ? ' — ' + i.msg : '');
}
// Checks of a paused case: what is still valid (equilibrium, TD status) + PAUSED instead of closure / members
function pausedChecks(plan, cs, tdRuns, frames) {
  const tag = (cs.dir === 'y' ? '↕' : '↔') + ' ' + (cs.kind === 'E' ? 'E' : 'W');
  return [...netChecks(plan, cs, tdRuns, frames).filter(c => c.code === 'equilibrium' || c.code === 'td'),
    { caseId: cs.id, code: 'paused', ok: false, warn: true,
      msg: `${tag}: PAUSED — ${cs.paused.map(p => 'TD ' + p.mark + ' ' + p.reason).join('; ')}. TD / net shear, member forces and closure are not reported until it runs` + (cs.offset ? '; the offset-line forces are not final.' : '.') }];
}

// Seismic display factors (Setup): F_x → diaphragm level (k_D = F_px / F_x) and collector level (k_C); blank / bad = 1
// transfer (step 7, user 2026-11-05): the forces of the walls above at the diaphragm level = Ω₀ × (1.25 when ticked,
// §12.3.3.5) — ASCE 7-22 §12.10.1.1, Type 4. Ω₀: typed on Setup, else the linked Shear Wall Design item's, else 2.5.
export function forceLevels(inputs, refs = {}) {
  const k = v => { const n = Number(v); return v !== '' && v !== null && v !== undefined && Number.isFinite(n) && n > 0 ? n : 1; };
  const lv = inputs.level || {};
  const typed = Number(lv.transferOmega);
  const swdDef = refs.wallSource && refs.wallSource.definition;
  const om = lv.transferOmega !== '' && lv.transferOmega !== undefined && Number.isFinite(typed) && typed > 0 ? { v: typed, from: 'typed' }
    : swdDef ? { v: omega0Of(swdDef), from: 'Shear Wall Design' } : { v: 2.5, from: 'default' };
  const inc = !!lv.transferIncrease;
  return { fx: Number.isFinite(Number(lv.fx)) && lv.fx !== '' ? Number(lv.fx) : null, diaphragm: k(lv.diaphragmFactor), collector: k(lv.collectorFactor),
    omega0: om.v, omega0From: om.from, increase: inc, transfer: om.v * (inc ? 1.25 : 1) };
}

// Per linked SWD line, the force this diaphragm delivers (kip, load-direction sign, E and W; null = held). The only SWD
// line on its grid without a span gets the grid's whole force (as before); with several SWD lines on one grid (Ch 8.4:
// "E 4-7", "E 8-9") each gets the force of its own walls (their shares), or — without walls on this level — the
// grid line's part forces inside its span.
export function linkLineForces(cases, link) {
  const out = [];
  for (const l of (link && link.lines) || []) {
    if (!l.grid) continue;
    const shared = !!l.span || (link.lines || []).some(o => o !== l && o.grid && o.grid.id === l.grid.id && o.dirId === l.dirId);
    const at = kind => {
      const c = cases.find(x => x.dir === l.dir && x.kind === kind);
      if (c && c.offset && (c.paused || []).length) return null; // held: offset-line forces wait for the TD runs (SWD skips null)
      if (c && (c.failed || c.notClosed)) return null; // held: the case's line forces do not balance its load / its member runs do not close
      const ln = c && c.lines.find(x => x.gridId === l.grid.id);
      if (!ln) return 0;
      if (!shared) return ln.P / 1000;
      const own = (ln.walls || []).filter(w => String(w.id).startsWith('swd:') && (link.walls || []).some(x => x.id === w.id && x.swdLineId === l.lineId));
      if (own.length) return own.reduce((t, w) => t + w.share, 0) / 1000;
      const [lo, hi] = l.span || [-Infinity, Infinity];
      return (ln.parts || []).reduce((t, p) => { const ov = Math.min(hi, p.hi) - Math.max(lo, p.lo); return t + (ov > 1e-6 && p.hi > p.lo ? (p.P ?? p.F * c.sigma) * ov / (p.hi - p.lo) : 0); }, 0) / 1000;
    };
    out.push({ swdDirId: l.dirId, swdLineId: l.lineId, line: l.name, E: at('E'), W: at('W') });
  }
  return out;
}

// Closure solver check: every member run closed (offset lines, collectors, TD hand-overs)
function offsetChecks(cs) {
  const o = cs.offset;
  if (!o) return [];
  const tag = (cs.dir === 'y' ? '↕' : '↔') + ' ' + (cs.kind === 'E' ? 'E' : 'W');
  const last = o.passes[o.passes.length - 1];
  const forces = last.lines.map(l => `${l.name} ${Math.round(l.P)} lb`).join(', ');
  return [{ caseId: cs.id, code: 'offset', ok: o.converged,
    msg: `${tag}: ${[...o.groups.map(g => 'offset wall line ' + g.name), ...(o.unknowns || []).filter(u => u.kind === 'collector' || u.kind === 'td').map(u => u.label)].join(', ') || 'wall lines'} — ` + (o.converged
      ? `line forces iterated to closure in ${last.pass} pass${last.pass === 1 ? '' : 'es'} (${forces}; tolerance max(${CLOSURE_LB} lb, ${CLOSURE_REL * 100} % of the run max))`
      : `no closure after ${last.pass} passes (${last.open} runs open, largest residual ${Math.round(last.maxRes)} lb; ${forces})`) }];
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
    // shared grid lines (user 2026-11-05): the grids of the DA item that owns them (its definition, read-only)
    { key: 'gridSource', label: 'Diaphragm Analysis (shared grids)', sourceType: 'diaphragm_analysis', from: 'inputs',
      extract: (inputs) => ({ grids: sharedGrids(inputs) }) },
  ],
  fields: [],
  outputFields: [],
  pdfOptions: { key: 'pdfReport', label: 'PDF report', options: [['summary', 'Summary'], ['detailed', 'Detailed']] },

  migrate(item) { return migrateItem(item); },

  // F_x of the picked level that no longer matches the linked ELF item
  linkDiff(inputs, linked) {
    const rows = elfRows(linked);
    const grid = gridShareDiff(inputs, linked.gridSource).map(c => ({ refKey: 'gridSource', ...c }));
    if (!rows || !inputs.level || !inputs.level.name) return grid;
    const r = rows.find(x => sameName(x.level, inputs.level.name));
    if (!r) return [{ refKey: 'elfSource', label: 'Level', from: inputs.level.name, to: '(not in ELF)' }, ...grid];
    return (sameNumber(inputs.level.fx, r.fx, 0.0005) ? [] : [{ refKey: 'elfSource', label: inputs.level.name + ' Fx', from: inputs.level.fx, to: r.fx }]).concat(grid);
  },

  applyLinks(inputs, linked) {
    const rows = elfRows(linked);
    if (rows && inputs.level) {
      const r = rows.find(x => sameName(x.level, inputs.level.name));
      if (r) inputs.level.fx = r.fx != null ? String(r.fx) : '';
    }
    applyGridShare(inputs, linked.gridSource);
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
    // The mouse wheel never changes a number field (user 2026-11-03): a focused number input loses the focus on a
    // wheel turn, so the page scrolls and the value stays. One listener per container (renderForm can run again).
    if (!container._noWheelEdit) {
      container._noWheelEdit = true;
      container.addEventListener('wheel', e => {
        const t = e.target;
        if (t && t.tagName === 'INPUT' && t.type === 'number' && typeof document !== 'undefined' && document.activeElement === t) t.blur();
      }, { passive: true });
    }
    const elfItems = (projectItems || []).filter(it => it.type === 'elf_diaphragm_collector' && !it.archived);
    const swdItems = (projectItems || []).filter(it => it.type === 'shear_wall_design' && !it.archived);
    const daItems = (projectItems || []).filter(it => (it.type === 'diaphragm_analysis' || it.type === 'transfer_diaphragm') && !it.archived);
    // The linked SWD definition, read from the project's items (same as the wallSource ref; walls / lines / levels
    // only, fields every SWD schema has). Not via results.js: that would import the registry into this module.
    const linkedRefs = () => {
      const it = swdItems.find(x => x.id === inputs.refs.wallSource);
      const out = it && it.inputs ? { wallSource: swdExtract(it.inputs) } : {};
      const own = daItems.find(x => x.id === inputs.refs.gridSource);
      if (own && own.inputs) out.gridSource = { grids: sharedGrids(own.inputs) };
      return out;
    };
    // shared grids (user 2026-11-05): the other DA items of the project that own their grids
    const selfId = (hooks && hooks.itemId) || null;
    const gridOwners = () => daItems.filter(x => x.id !== selfId && !((x.inputs || {}).refs || {}).gridSource);
    let refs = linkedRefs();
    const ed = newEditorState();
    if (inputs.loads[0] && String(inputs.loads[0].acts).endsWith('x')) ed.dir = 'x';
    let active = inputs.verification ? 'verification' : 'plan';
    let caseId = null, view = 1, show = { chord: true, cross: true }; // Analysis tab: load case, view, member filter
    let overlays = { lines: true, outlines: true };
    let setupPage = 'seismic'; // Setup tab page: seismic | wind | walls | general
    let forceLevel = 'E'; // Analysis tab, seismic cases: 'E' (1.0E, F_x) | 'D' (diaphragm level) | 'C' (collector level)
    let senseMode = 'entered'; // Analysis tab: 'entered' | 'reversed' | 'envelope' (user 2026-11-10, both senses analysed)
    let comboBasis = null; // Analysis tab load combination 'LRFD' | 'ASD' (null = Setup → General design basis)
    const viewZoom = { zoom: 1, panX: 0, panY: 0 }; // Analysis tab zoom / pan, shared by every view and case
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
        view, setView(n) { view = n; renderAll(); }, show, setShow(x) { show = x; renderAll(); },
        zoom: viewZoom, overlays, setOverlays(x) { overlays = x; renderAll(); }, level: forceLevel, setLevel(x) { forceLevel = x; renderAll(); },
        sense: senseMode, setSense(x) { senseMode = x; renderAll(); },
        basis: comboBasis || inputs.designBasis || 'ASD', setBasis(x) { comboBasis = x; renderAll(); } }));
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

    // Setup: one page each for seismic loading, wind loading, the Shear Wall Design link, and general settings
    function renderSetup() {
      const sec = el('div');
      sec.appendChild(el('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '0.8rem' } },
        ...[['seismic', 'Seismic loading'], ['wind', 'Wind loading'], ['walls', 'Shear wall link'], ['general', 'General']].map(([k, t]) =>
          el('button', { type: 'button', className: 'btn btn-sm' + (setupPage === k ? ' btn-primary' : ' btn-ghost'), onClick() { setupPage = k; renderAll(); } }, t))));
      if (setupPage === 'wind') return setupWind(sec);
      if (setupPage === 'walls') { sec.appendChild(renderWallLink()); return sec; }
      if (setupPage === 'general') return setupGeneral(sec);
      // "No seismic load" first on the page (user 2026-11-03); declared → only the level stays (the Shear Wall
      // Design link matches walls by level name)
      const noE = noLoadBar(sec, 'E');
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

      if (noE) return sec;
      // Seismic force levels (display factors on the Analysis tab; the analysis and the SWD line forces stay at 1.0E)
      const lvName = inputs.level.name;
      const elfRow = (table, key) => { const t = linkedItem && linkedItem.outputs && linkedItem.outputs[table]; const r = t && t.find(x => sameName(x.level, lvName)); return r ? Number(r[key]) : NaN; };
      const fxNum = Number(inputs.level.fx);
      const hint = (val, what) => (Number.isFinite(val) && fxNum > 0 ? el('span', { style: { fontSize: '0.75rem', color: 'var(--ink-tertiary)' } },
        ' ELF: ' + what + ' = ' + val + ' k → ' + (val / fxNum).toFixed(3) + ' ', el('button', { type: 'button', className: 'btn btn-ghost btn-sm', onClick() { setFactor(what === 'F_px' ? 'diaphragmFactor' : 'collectorFactor', (val / fxNum).toFixed(3)); } }, 'use')) : null);
      const setFactor = (k, v) => { inputs.level[k] = v; refresh(true); };
      const factorInput = k => el('input', { type: 'number', step: 'any', min: 0, value: numOrBlank(inputs.level[k]), placeholder: '1.0', style: { width: '80px' }, onChange(e) { setFactor(k, e.target.value); } });
      sec.appendChild(el('div', { className: 'section-header', style: { marginTop: '1rem' } }, 'Seismic force levels (Analysis tab display)'));
      sec.appendChild(el('p', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', margin: '0 0 0.4rem' } },
        'The analysis runs at 1.0E from F', el('sub', null, 'x'), ' (the line forces sent to Shear Wall Design stay there). The Analysis tab can show the same results scaled to the diaphragm design level (F', el('sub', null, 'px'), ', ASCE 7 §12.10.1.1) or to the collector level (Ω₀ / §12.10.2.1) — linear, so every force and unit shear scales by the factor. Blank = 1.0.'));
      sec.appendChild(el('div', { style: { display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' } },
        el('div', { className: 'form-group' }, el('label', { className: 'form-label' }, 'Diaphragm level k', el('sub', null, 'D'), ' = F', el('sub', null, 'px'), ' / F', el('sub', null, 'x')),
          el('div', null, factorInput('diaphragmFactor'), hint(elfRow('diaphragmTable', 'fpxDesign'), 'F_px'))),
        el('div', { className: 'form-group' }, el('label', { className: 'form-label' }, 'Collector level k', el('sub', null, 'C'), ' = F', el('sub', null, 'collector'), ' / F', el('sub', null, 'x')),
          el('div', null, factorInput('collectorFactor'), hint(elfRow('collectorTable', 'designForce'), 'F_collector')))));
      // ρ (user 2026-11-10): the factors are complete — no separate redundancy factor is applied
      sec.appendChild(el('p', { 'data-rho-note': '1', style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', margin: '0.2rem 0 0', padding: '4px 8px', borderLeft: '3px solid var(--stale)' } },
        el('strong', null, 'Note — redundancy factor ρ: '), 'k', el('sub', null, 'D'), ' and k', el('sub', null, 'C'),
        ' are the full factors — the effect of ρ is already incorporated in the factor entered; the tool applies no separate ρ. '
        + '(The ELF suggestion above, F_px / F_x and F_collector / F_x, has no ρ in it: the ELF item does not apply its ρ input to those forces.) '
        + 'The ASD / LRFD load combination is picked on the Analysis tab (ASD 0.7E, LRFD 1.0E) and applied on top of these factors.'));
      // transfer from the walls above (step 7): only when walls of the story above end at this floor
      const tw = ((results.wallsAbove && results.wallsAbove.walls) || []).filter(w => w.kind === 'transfer');
      if (tw.length) {
        const fl = results.forceLevels || {};
        sec.appendChild(el('div', { className: 'section-header', style: { marginTop: '1rem' } }, 'Transfer from the walls above (out-of-plane offset)'));
        sec.appendChild(el('p', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', margin: '0 0 0.4rem' } },
          tw.map(w => w.mark).join(', ') + ' end at this floor. ASCE 7-22 §12.10.1.1 (horizontal irregularity Type 4): their forces are increased by Ω₀ before they are added to the diaphragm inertia forces → Diaphragm level = k_D × own + Ω₀ × walls above (× 1.25 when §12.3.3.5 applies). Collector level = k_C × (own + walls above). 1.0E and the line forces sent to Shear Wall Design are unchanged.'));
        sec.appendChild(el('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' } },
          el('label', { style: { fontSize: '0.82rem' } }, 'Ω₀ ', el('input', { type: 'number', step: 'any', min: 0, 'data-transferomega': '1', value: numOrBlank(inputs.level.transferOmega), placeholder: String(fl.omega0 ?? 2.5),
            style: { width: '70px' }, onChange(e) { inputs.level.transferOmega = e.target.value; refresh(true); } }),
            el('span', { style: { fontSize: '0.75rem', color: 'var(--ink-tertiary)' } }, ' blank = ' + (fl.omega0From === 'Shear Wall Design' ? 'Shear Wall Design Ω₀ ' + fl.omega0 : '2.5'))),
          el('label', { style: { fontSize: '0.82rem', display: 'flex', gap: '4px', alignItems: 'center' } },
            el('input', { type: 'checkbox', 'data-transferinc': '1', checked: !!inputs.level.transferIncrease, onChange(e) { inputs.level.transferIncrease = e.target.checked; refresh(true); } }),
            '+25 % (§12.3.3.5, SDC D–F; not needed when Ω₀ is used — the engineer decides)'),
          el('span', { className: 'mono', style: { fontSize: '0.8rem' } }, '→ walls above × ' + (Math.round((fl.transfer ?? 2.5) * 1000) / 1000) + ' at the diaphragm level')));
      }

      sec.appendChild(el('div', { className: 'section-header', style: { marginTop: '1rem' } }, 'Seismic loads (E)'));
      sec.appendChild(el('p', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', margin: '0 0 0.2rem' } },
        'Seismic F_x / ΣA puts q = F_x / ΣA on the sheathed area (the load follows the sheathed depth; openings carry nothing). All E loads of one direction form one load case, 1.0E.'));
      sec.appendChild(renderLoadList(inputs, 'E', refresh));
      return sec;
    }

    // "No seismic load" / "No wind load": a stored declaration. The loads of that kind (if any) stay stored but are not
    // analysed; the "no load entered" warning goes away. Returns true when declared (the page shows only the note).
    function noLoadBar(sec, kind) {
      const word = kind === 'E' ? 'seismic' : 'wind';
      inputs.noLoad = inputs.noLoad || { E: false, W: false };
      const on = !!inputs.noLoad[kind];
      const kept = inputs.loads.filter(l => (l.kind || (l.mode === 'seismic' ? 'E' : 'W')) === kind).length;
      sec.appendChild(el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', margin: '0 0 0.5rem' } },
        el('button', { type: 'button', className: 'btn btn-sm' + (on ? ' btn-primary' : ''), 'data-noload': kind,
          title: on ? 'Analyse the ' + word + ' loads again' : 'Declare that this level has no ' + word + ' load',
          onClick() { inputs.noLoad[kind] = !on; refresh(true); } }, on ? '✓ No ' + word + ' load — undo' : 'No ' + word + ' load'),
        on ? el('span', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)' } },
          'Declared: this level has no ' + word + ' load. ' + (kept ? kept + ' ' + word + ' load(s) stay stored but are not analysed.' : 'Nothing is analysed for ' + word + '.')) : null));
      return on;
    }

    function setupWind(sec) {
      sec.appendChild(el('div', { className: 'section-header' }, 'Wind loads (W)'));
      if (noLoadBar(sec, 'W')) return sec;
      sec.appendChild(el('p', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', margin: '0 0 0.2rem' } },
        'Wind: per segment along the span a windward plf (on the face the wind comes from) and a leeward plf (on the opposite face) — pressure × tributary height. '
        + 'Without an opening only the net load counts; at an opening each band takes its own strip (book Ex 5.1). A line load (plf) on a chosen edge is also possible. '
        + 'All W loads of one direction form one load case, 1.0W as entered.'));
      sec.appendChild(renderLoadList(inputs, 'W', refresh));
      return sec;
    }

    function setupGeneral(sec) {
      sec.appendChild(el('div', { className: 'section-header' }, 'Code and diaphragm'));
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
        lt.appendChild(el('tr', null, el('th', null, 'Line'), el('th', null, 'Load'), el('th', null, 'Grid in plan'),
          el('th', { title: 'Several Shear Wall Design lines can share one grid, each on its own stretch: name them "E 4-7", "E 8-9", or pick the grid and the two cross grids here' }, 'Grid / span (set)'), el('th', { title: 'Where this level\'s sheathing runs along the grid (plan coordinates) — information only' }, 'Sheathed here (ft)'), el('th', { title: 'Plan coordinate of position 0 of the line in Shear Wall Design' }, 'Line origin (ft)')));
        for (const l of lines) {
          const typed = (wl.origins || {})[l.lineId] ?? '';
          lt.appendChild(el('tr', null, el('td', null, l.name), el('td', null, l.dir === 'y' ? '↕ y' : '↔ x'),
            el('td', { style: { color: l.grid ? '' : 'var(--fail)' } }, l.grid ? (l.dir === 'y' ? 'x = ' : 'y = ') + 'grid ' + l.grid + (l.span ? ', ' + f2(l.span[0]) + '–' + f2(l.span[1]) : '') : 'no grid for "' + l.name + '"'),
            (() => {
              // by hand: the grid, and the two cross grids of its span ('' = from the line name)
              if (!wl.lineGrid) wl.lineGrid = {};
              const set = wl.lineGrid[l.lineId] || {};
              const axis = l.dir === 'y' ? 'x' : 'y', cross = axis === 'x' ? 'y' : 'x';
              const put = (k, v) => { const cur = { ...(wl.lineGrid[l.lineId] || {}) }; cur[k] = v; if (!cur.gridId && !cur.fromId && !cur.toId) delete wl.lineGrid[l.lineId]; else wl.lineGrid[l.lineId] = cur; refresh(true); };
              const pick = (ax, k, blank) => el('select', { className: 'form-select', style: { width: 'auto', fontSize: '0.78rem' }, 'data-linegrid': l.name + ':' + k, onChange(e) { put(k, e.target.value); } },
                el('option', { value: '' }, blank), ...inputs.grids.filter(g => g.axis === ax && !g.ref).map(g => el('option', { value: g.id, selected: set[k] === g.id }, g.name)));
              return el('td', { style: { whiteSpace: 'nowrap' } }, pick(axis, 'gridId', 'by name'), ' ', pick(cross, 'fromId', 'from —'), ' – ', pick(cross, 'toId', 'to —'));
            })(),
            el('td', { className: 'mono', style: { color: 'var(--ink-secondary)' } }, l.grid ? ((l.bands || []).length ? l.bands.map(([a, b]) => f2(a) + '–' + f2(b)).join(', ') : 'not on this level') : '—'),
            l.originFromSwd
              ? el('td', { className: 'mono', title: 'Set in Shear Wall Design (line header → Starts at), the same for every level' }, f2(l.origin) + ' (SWD)')
              : el('td', null, el('input', { type: 'number', step: 'any', value: typed, placeholder: Number.isFinite(l.origin) ? 'auto ' + l.origin : '', style: { width: '90px' },
                onChange(e) { wl.origins[l.lineId] = e.target.value; refresh(true); } }))));
        }
        sec.appendChild(el('div', { className: 'table-scroll' }, lt));
        sec.appendChild(el('p', { style: { fontSize: '0.75rem', color: 'var(--ink-tertiary)' } }, 'Origin blank = where the grid line enters the sheathed plan, or the start of the line span. A wall at position p (Shear Wall Design) is drawn from origin + p. Several Shear Wall Design lines on one grid: name them "E 4-7", "E 8-9" (grid, then the two cross grids of its stretch) or set grid and span here; each line gets the force of its own walls.'));
      }
      sec.appendChild(renderLinkGroups(swd, lv));
      return sec;
    }

    // Offset lines of resistance of linked walls (user 2026-11-03): two or more SWD lines (one grid each) that act as
    // one line; a wall can be left out (it keeps its own line, e.g. SW7 on E). DA shares the group force like Shear
    // Wall Design shares a line (capacity × length or equal δ) and sends each SWD line its part.
    function renderLinkGroups(swd, lv) {
      const wl = inputs.wallLink;
      if (!Array.isArray(wl.groups)) wl.groups = [];
      const box = el('div', { style: { marginTop: '1rem' } });
      box.appendChild(el('div', { className: 'section-header' }, 'Offset lines of resistance'));
      box.appendChild(el('p', { style: { fontSize: '0.78rem', color: 'var(--ink-secondary)', margin: '0 0 0.4rem' } },
        'Shear Wall Design lines on different grids that act as one line of resistance (e.g. SW5 on D and SW6 on E, book Ch 8.4). '
        + 'The group force is found by the closure solver and shared by the walls the way Shear Wall Design shares a line — by capacity × length, or by equal deflection, as set for those lines in Shear Wall Design; '
        + 'the force from the stories above stays on its own line. Each line gets its part back in Shear Wall Design. Untick a wall that acts on its own (it keeps its line).'));
      const linesBy = (results.wallLink && results.wallLink.lines) || [];
      const dirName = id => ((swd.directions || []).find(d => d.id === id) || {}).name || '';
      const small = { fontSize: '0.78rem', color: 'var(--ink-tertiary)' };
      wl.groups.forEach((g, gi) => {
        if (!Array.isArray(g.lineIds)) g.lineIds = [];
        if (!Array.isArray(g.exclude)) g.exclude = [];
        const card = el('div', { 'data-group': g.id, style: { border: '1px solid var(--border-light)', borderRadius: '6px', padding: '6px', marginBottom: '6px' } });
        card.appendChild(el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
          el('span', { style: small }, 'Name'),
          el('input', { type: 'text', value: g.name || '', placeholder: 'e.g. D/E', style: { width: '90px' }, onChange(e) { g.name = e.target.value; refresh(true); } }),
          el('span', { style: { flex: 1 } }),
          el('button', { type: 'button', className: 'btn btn-ghost btn-sm', title: 'Delete this offset line', onClick() { wl.groups.splice(gi, 1); refresh(true); } }, '×')));
        const dirOf = g.lineIds.length ? (linesBy.find(l => l.lineId === g.lineIds[0]) || {}).dirId : null;
        for (const l of linesBy.filter(x => x.grid && (!dirOf || x.dirId === dirOf))) {
          const on = g.lineIds.includes(l.lineId);
          const swdLine = swd.directions.flatMap(d => d.lines).find(x => x.id === l.lineId);
          const walls = (swdLine ? swdLine.walls : []).filter(w => lv && w.levelId === lv.id);
          card.appendChild(el('div', { style: { marginTop: '4px', fontSize: '0.8rem' } },
            el('label', { style: { display: 'inline-flex', gap: '4px', alignItems: 'center', minWidth: '130px' } },
              el('input', { type: 'checkbox', checked: on, 'data-line': l.name, onChange(e) {
                if (e.target.checked) g.lineIds.push(l.lineId); else g.lineIds = g.lineIds.filter(x => x !== l.lineId);
                refresh(true); } }), 'Line ' + l.name + ' (' + dirName(l.dirId) + ')'),
            on ? el('span', null, ...walls.map(w => el('label', { style: { display: 'inline-flex', gap: '3px', alignItems: 'center', marginRight: '8px' } },
              el('input', { type: 'checkbox', checked: !g.exclude.includes(w.id), 'data-wall': w.mark, title: 'Untick: this wall acts on its own (keeps line ' + l.name + ')',
                onChange(e) { g.exclude = e.target.checked ? g.exclude.filter(x => x !== w.id) : [...g.exclude, w.id]; refresh(true); } }), w.mark)))
              : el('span', { style: small }, walls.length + ' wall(s) on this level')));
        }
        box.appendChild(card);
      });
      box.appendChild(el('button', { type: 'button', className: 'btn btn-sm', onClick() {
        wl.groups.push({ id: 'grp-' + Date.now().toString(36) + '-' + wl.groups.length, name: '', lineIds: [], exclude: [] }); refresh(true); } }, '+ Offset line'));
      return box;
    }

    function renderPlanTab() {
      const plan = planWithLinks(inputs, refs).plan;
      for (const w of plan.wallsAbove || []) { // their 1.0E / 1.0W forces (results) for the Shear walls page table
        const o = ((results.wallsAbove && results.wallsAbove.walls) || []).find(x => x.swdWallId === w.swdWallId);
        if (o) { w.VE = o.E; w.VW = o.W; }
      }
      const box = el('div');
      // errors and warnings: grouped and numbered under the plan (renderPlanEditor, user 2026-11-06)
      const owner = daItems.find(x => x.id === inputs.refs.gridSource);
      ed.gridShare = { fromId: inputs.refs.gridSource || '', ownerName: owner ? (owner.custom_name || owner.customName || owner.label || 'Diaphragm Analysis') : null,
        options: gridOwners().map(x => ({ id: x.id, name: (x.custom_name || x.customName || x.label || 'Diaphragm Analysis') })),
        set(id) {
          if (!id) { delete inputs.refs.gridSource; refresh(true); return; } // own grids: the copy becomes this item's own
          const it = daItems.find(x => x.id === id);
          inputs.refs.gridSource = id;
          if (it && it.inputs) applyGridShare(inputs, { grids: sharedGrids(it.inputs) });
          refresh(true);
        } };
      box.appendChild(renderPlanEditor({ inputs, plan, errors: results.errors, warnings: results.warnings, state: ed, refresh, wallsLinked: !!refs.wallSource,
        loadCases: results.analysis && results.analysis.cases, q: results.q }));
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

  // Phase 8 (user 2026-11-10): the PDF gets the same recalculated result as the screen (results.js currentOutputs →
  // calc with the links resolved); its plan (with the linked walls) rides on it, not enumerable. tdReport.js.
  pdfSections(inputs, outputs) {
    const r = outputs && outputs.analysis ? outputs : calcAll(inputs);
    return daPdfSections(inputs, r, r.plan || planWithLinks(inputs).plan);
  },
};


// TDs tab: each drawn TD in the skill frame, then per load case the derived inputs (how each was found), the TD
// engine's results and stops, and for a cantilever the limits the engineer reviews (td_cantilever_ok).
// TDs tab body of a TD with three or more load lines: one engine run per load line, added (tdDerive.superpose)
function superposedTdView(r, d) {
  const f0 = v => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—');
  const f1 = v => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toString() : '—');
  const small = { fontSize: '0.78rem', color: 'var(--ink-tertiary)' };
  const sideTxt = s => (s > 0 ? '+' : s < 0 ? '−' : 'both');
  const box = el('div');
  const runs = r.superposed.runs;
  box.appendChild(el('p', { style: small }, `Superposed from ${runs.length} engine runs, one per load line (a TD is linear in its loads). Each run: that load alone, basic / outside shears 0; the basic field is added once in the net field. A load between the supports runs as a simple span, a load on an overhang as a cantilever (mirrored for the overhang past the top support), a load on a support goes straight into it. Proof: superposing the book TDs gives their direct runs.`));
  const where = { span: 'between the supports', bottom: 'overhang past ' + (d.bottom || 'bottom'), top: 'overhang past ' + (d.top || 'top'), support: 'on a support' };
  const lt = el('table', { className: 'dynamic-table', style: { fontSize: '0.8rem' } });
  lt.appendChild(el('tr', null, ...['Load', 'P (lb)', 'y (ft)', 'side', 'where', 'run', 'v_TD above / below (plf)', 'to ' + (d.top || 'top') + ' / ' + (d.bottom || 'bottom') + ' (lb)', 'From'].map(h => el('th', null, h))));
  runs.forEach((x, i) => lt.appendChild(el('tr', null, el('td', null, 'P' + (i + 1) + ' (' + x.grid + ')'), el('td', { className: 'mono' }, f0(x.P)), el('td', { className: 'mono' }, f2(x.y)),
    el('td', null, sideTxt(x.side)), el('td', null, where[x.kind] || '—'), el('td', null, x.skipped ? 'no load' : x.kind === 'support' ? 'to the support' : x.terminal),
    el('td', { className: 'mono' }, f1(x.v_above) + ' / ' + f1(x.v_below)), el('td', { className: 'mono' }, f0(x.F_top) + ' / ' + f0(x.F_bot)),
    el('td', { style: { fontSize: '0.76rem' } }, (r.how || {})['td_P' + (i + 1)] || ''))));
  box.appendChild(el('div', { className: 'table-scroll' }, lt));
  const st = el('table', { className: 'dynamic-table', style: { fontSize: '0.8rem', marginTop: '4px' } });
  st.appendChild(el('tr', null, el('th', null, 'Stretch (local y, ft)'), el('th', null, 'v_TD (plf) = Σ runs')));
  for (const [lo, hi, v] of r.segsLocal) st.appendChild(el('tr', null, el('td', { className: 'mono' }, f2(hi) + ' → ' + f2(lo)), el('td', { className: 'mono' }, f1(v))));
  box.appendChild(el('div', { className: 'table-scroll' }, st));
  if (r.terminal === 'OUTPUT') {
    const o = r.outputs, rt = el('table', { className: 'dynamic-table', style: { fontSize: '0.8rem', marginTop: '4px' } });
    const row = (a, b) => rt.appendChild(el('tr', null, el('td', null, a), el('td', { className: 'mono' }, b)));
    row('Force to support ' + (d.top || 'top') + ' / ' + (d.bottom || 'bottom') + ' (lb, +x)', f0(o.td_F_sup_top) + ' / ' + f0(o.td_F_sup_bot));
    row('Closure residual (largest run) / tolerance', (o.td_closure_rel * 100).toFixed(3) + ' % / ' + (CLOSURE_TOL * 100) + ' %');
    row('Aspect W / L, blocking', f2(o.td_aspect) + (o.td_blocking_required ? ' — blocking required' + (r.skill.td_blocked ? ' (blocked ✓)' : ' (NOT specified)') : ' — unblocked allowed') + ' (SDPWS T4.2.2 UNVERIFIED)');
    row('Edge members, net shear', 'from the member diagrams (Analysis → Members N) — the engine\'s edge values hold for one load each');
    box.appendChild(el('div', { className: 'table-scroll' }, rt));
  }
  return box;
}

// The engineer's review of the cantilever limits (skill S062), one list per overhang (lists: cantileverLimits results)
function cantileverReview(raw, lists, small, refresh) {
  const ok = raw.engineer ? raw.engineer.cantileverOk : null;
  const btn = (v, lab) => el('button', { type: 'button', className: 'btn btn-sm' + (ok === v ? ' btn-primary' : ''),
    onClick() { raw.engineer = { ...(raw.engineer || {}), cantileverOk: v }; refresh(true); } }, lab);
  return el('div', { style: { marginTop: '6px', fontSize: '0.8rem' } },
    el('strong', null, 'Cantilever limits — engineer review '), el('span', { style: small }, '(' + CANTILEVER_LIMITS_VERIFY + ')'),
    ...lists.map((lim, i) => el('ul', { style: { paddingLeft: '1.2rem', margin: '4px 0' } }, ...(lists.length > 1 ? [el('li', { style: { listStyle: 'none', marginLeft: '-1rem' } }, 'Overhang ' + (i + 1))] : []),
      ...lim.map(c => el('li', { style: { color: c.flag ? 'var(--stale)' : '' } }, c.id + '. ' + c.text + ' — ' + c.value + (c.flag ? ' ⚠' : ''))))),
    el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
      el('span', null, 'Review: ', el('strong', { style: { color: ok === true ? 'var(--pass)' : ok === false ? 'var(--fail)' : 'var(--stale)' } }, ok === true ? 'limits met' : ok === false ? 'not met' : 'not reviewed')),
      btn(true, 'Reviewed — limits met'), btn(false, 'Not met'), btn(null, 'Clear')));
}

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
      el('td', null, g.td_support === 'cantilever' ? 'overhang' + (d.overhangs && d.overhangs.length > 1 ? 's' : '') + ' ' + (d.overhangs || []).join(', ') + (d.ySign < 0 ? ' (y mirrored)' : '') : g.td_support || '—'),
      el('td', null, d.bottom && d.top ? d.bottom + ' → ' + d.top : '—'),
      el('td', { className: 'mono' }, f2(g.td_span)), el('td', { className: 'mono' }, f2(g.td_length)),
      el('td', { className: 'mono' }, d.spanAxis ? along + ' = ' + f2(d.edges[0]) + ' / ' + f2(d.edges[1]) : '—'),
      el('td', { className: 'mono' }, d.loadLines.map(l => l.grid + ' (' + f2(l.y) + ', ' + (l.side > 0 ? '+' : l.side < 0 ? '−' : 'both') + ')').join(', ') || '—'),
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
      if (r.superposed) {
        sec.appendChild(superposedTdView(r, d));
        // a load on an overhang runs the skill's cantilever step: the engineer reviews the limits of each overhang
        const onOh = r.superposed.runs.some(x => !x.skipped && (x.kind === 'bottom' || x.kind === 'top'));
        if (onOh && raw && d.tips) {
          const W = r.skill.td_span, lens = [d.tips.bottom !== null ? Math.abs(d.tips.bottom) : null, d.tips.top !== null ? d.tips.top - W : null].filter(v => v !== null);
          sec.appendChild(cantileverReview(raw, lens.map(Lp => cantileverLimits({ Lp, L: r.skill.td_length })), small, refresh));
        }
        box.appendChild(sec); continue;
      }
      const k = r.skill, o = r.outputs || {}, two = k.td_has_load2, cant = k.td_support === 'cantilever';
      // loads
      const lt = el('table', { className: 'dynamic-table', style: { fontSize: '0.8rem' } });
      lt.appendChild(el('tr', null, el('th', null, 'Load'), el('th', null, 'P (lb)'), el('th', null, 'y (ft)'), el('th', null, 'side'), el('th', null, 'From')));
      const loads = [[1, k.td_P1, k.td_y1, k.td_side1]];
      if (two) loads.push([2, k.td_P2, k.td_y2, k.td_side2]);
      for (const [i, P, y, sd] of loads) lt.appendChild(el('tr', null,
        el('td', null, 'P' + i), el('td', { className: 'mono' }, f0(P)), el('td', { className: 'mono' }, f2(y)), el('td', null, sd > 0 ? '+' : sd < 0 ? '−' : 'both'),
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
      if (cant && raw) sec.appendChild(cantileverReview(raw, [cantileverLimits({ Lp: Math.abs(k.td_y1), L: k.td_length })], small, refresh));
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
  const BUILT = 7;
  const awaiting = ((results.analysis && results.analysis.cases) || []).some(c => (c.paused || []).length); // a paused case (gate)
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
  if (awaiting) box.appendChild(el('p', { style: { fontSize: '0.8rem', color: 'var(--stale)' } }, 'A TD has not run (cantilever review pending or a stop — TDs tab); its case is paused, so TD and net-field values are compared after it runs.'));
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
