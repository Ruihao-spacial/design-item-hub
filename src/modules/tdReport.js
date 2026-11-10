// Diaphragm Analysis — PDF sections (Phase 8, user 2026-11-10). Summary / Detailed (inputs.pdfReport).
// Every value is at ASD (0.7E / 0.6W); seismic at the three force levels (1.0E, diaphragm × k_D (+ Ω₀ × walls above),
// collector × k_C), wind at 0.6W; each load direction on its own. Unit shears are the ± envelope (max |v| of the two
// senses), member forces the ± envelope (max T / max C, signed). The drawings are the Analysis tab's own functions
// (drawPlan, drawShearEnvelope, drawMembers on envelopeCase) at Fit — what the screen shows for the same settings.
// Built from calcAll() results only (the PDF gets the same recalculated result as the screen, with its links).
import { drawPlan, newEditorState } from './tdPlanEditor.js';
import { scaleCase, envelopeCase, drawShearEnvelope, drawMembers, drawNetShear, drawBasicShear, drawTdShear, runExtremes, comboFactor } from './tdViews.js';
import { sectionAt } from './tdBasicShear.js';
import { closes } from './tdNet.js';

const f0 = v => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—');
const f1 = v => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toString() : '—');
const f2 = v => (Number.isFinite(v) ? v.toFixed(2) : '—');
const fk = v => (Math.round(v * 1000) / 1000).toString();
const RED = [200, 40, 40];
const dirTxt = d => 'load along ' + d + ' (' + (d === 'y' ? '↕' : '↔') + ')';
const kindTxt = k => (k === 'E' ? 'seismic' : 'wind');

// The force levels printed for a case: [{ key, name, k, a, b }] — a / b = entered / reversed sense at ASD × level
// (b null when the reversed sense is missing, PAUSED or FAILED). Seismic: 1.0E, diaphragm, collector; wind: 0.6W.
export function reportLevels(out, cs) {
  const fl = out.forceLevels || { diaphragm: 1, collector: 1, transfer: 2.5 };
  const kc = comboFactor(cs.kind, 'ASD');
  const rev = out.reverse || null;
  const csR = rev ? rev.cases.find(c => c.id === cs.id) || null : null;
  const revOk = csR && !(csR.paused && csR.paused.length) && !csR.failed;
  const revBasic = csR && !csR.failed; // a PAUSED run still has a valid basic shear (as on the Analysis tab)
  const pickD = (list, id) => (list || []).find(c => c.id === id) || null;
  const lv = (key, name, kL, aBase, bBase) => ({ key, name, kL, k: kc * kL, a: scaleCase(aBase, kc * kL), b: revOk && bBase ? scaleCase(bBase, kc * kL) : null,
    bBasic: revBasic && bBase ? scaleCase(bBase, kc * kL) : null });
  if (cs.kind !== 'E') return [lv('W', 'ASD 0.6W', 1, cs, csR)];
  return [
    lv('E', 'ASD 0.7 × 1.0E', 1, cs, csR),
    lv('D', 'ASD 0.7 × diaphragm level (k_D ' + fk(fl.diaphragm) + ((cs.above || []).some(a => a.V) ? ', walls above × Ω₀ ' + fk(fl.transfer) : '') + ')', fl.diaphragm,
      pickD(out.levelD, cs.id) || cs, revBasic ? pickD(rev.levelD, cs.id) || csR : null),
    lv('C', 'ASD 0.7 × collector level (k_C ' + fk(fl.collector) + ')', fl.collector, cs, csR),
  ];
}

// A drawing as a PDF image section: the SVG at its own size (the PDF scales it to the page width)
function figure(title, d, note) {
  const s = d.svg;
  s.setAttribute('width', String(d.view.W)); s.setAttribute('height', String(d.view.H));
  s.setAttribute('style', 'background:#ffffff');
  const out = [{ title, elevation: { renderFn: () => s, width: d.view.W, height: d.view.H } }];
  if (note) out.push({ text: note });
  return out;
}
// The unit shear drawing at a level: the ± envelope, or the entered sense alone when the reversed one is not usable
function shearFigure(plan, L0, kind, acts, title) {
  const L = kind === 1 ? { ...L0, b: L0.bBasic } : L0;
  const d = L.b ? drawShearEnvelope(plan, L.a, L.b, kind, {}, {}, acts) : kind === 1 ? drawBasicShear(plan, L.a) : kind === 2 ? drawTdShear(plan, L.a) : drawNetShear(plan, L.a);
  return figure(title + (L.b ? ' — max |v| of ' + acts.a + ' / ' + acts.b : ' — ' + acts.a + ' only (reversed sense not available)'), d,
    L.b ? 'Each cell: max |v| (plf) of the two senses, at the cell ends along the span; colour depth ∝ max |v|.' : null);
}
function memberFigure(plan, L, acts, title) {
  const cs = L.b ? envelopeCase(L.a, L.b) : L.a;
  return figure(title + (L.b ? ' — envelope ' + acts.a + ' / ' + acts.b + ': max T (blue) / max C (red)' : ' — ' + acts.a + ' only (reversed sense not available)'),
    drawMembers(plan, cs), 'Tension +; each run labelled with its max T / max C (lb); "open" = a run that does not close.');
}

// Line forces and wall shares: 1.0 (what Shear Wall Design receives) and ASD
function lineTable(cs) {
  const kc = comboFactor(cs.kind, 'ASD'), u = cs.kind === 'E' ? 'E' : 'W';
  const rows = [...cs.lines].sort((a, b) => a.at - b.at).map(ln => [ln.name, f0(ln.P), f0(kc * ln.P),
    ln.into ? 'into ' + ln.into.join(', ') : (ln.walls || []).map(w => (w.mark || 'wall') + ' ' + f0(w.share) + ' / ' + f0(kc * w.share) + ' lb · ' + f1(kc * w.v) + ' plf').join('; ') || (ln.noWall ? 'no wall' : '—')]);
  const total = cs.lines.reduce((t, l) => t + l.P, 0);
  rows.push(['Σ', f0(total), f0(kc * total), '']);
  return { headers: ['Line', 'Force 1.0' + u + ' (lb)', 'ASD ' + fk(kc) + u + ' (lb)', 'Walls: share 1.0 / ASD (lb) · v ASD (plf)'], rows, colWidths: [0.1, 0.14, 0.14, 0.62] };
}

// Member maxima: one row per run with force, max T / max C at every level (± envelope), closes in both senses
export function memberRows(levels) {
  const envs = levels.map(L => (L.b ? envelopeCase(L.a, L.b) : L.a));
  const key = (m, r) => m.family + '|' + m.at.toFixed(4) + '|' + r.from.toFixed(4);
  const base = envs[0];
  const rows = [];
  for (const m of base.members || []) for (const r of m.runs) {
    const per = envs.map(e => { const mm = (e.members || []).find(x => x.family === m.family && Math.abs(x.at - m.at) < 1e-6); return mm && mm.runs.find(q => key(mm, q) === key(m, r)); });
    if (per.every(q => !q || Math.abs(q.max) < 0.5)) continue;
    const ok = per.every(q => !q || (q.env ? q.env.ok : closes(q)));
    rows.push({ name: m.name, family: m.family, from: r.from, to: r.to, ok, values: per.map(q => (q ? runExtremes(q) : { T: null, C: null })) });
  }
  return rows;
}
function memberTable(levels) {
  const rows = memberRows(levels).map(r => [r.name, r.family === 'chord' ? 'along' : 'across', f1(r.from) + '–' + f1(r.to),
    ...r.values.map(v => (v.T ? 'T ' + f0(v.T.N) : '—') + ' / ' + (v.C ? 'C ' + f0(-v.C.N) : '—')), r.ok ? '✓' : { t: '✗ open', color: RED }]);
  const n = levels.length, w = (1 - 0.32) / n;
  return { headers: ['Member', 'Span', 'Run (ft)', ...levels.map(L => (L.key === 'E' ? 'ASD, 1.0E level' : L.key === 'D' ? 'ASD, diaphragm level' : L.key === 'C' ? 'ASD, collector level' : 'ASD 0.6W') + ': max T / max C (lb)'), 'Closes'],
    rows, colWidths: [0.1, 0.07, 0.1, ...levels.map(() => w - 0.06 / n), 0.06] };
}

// Section shears per diaphragm at the grid stations (± envelope at a level): max |V| and per band max |v| (sense)
function sectionTables(plan, L, acts) {
  const out = [];
  for (const d of L.a.diaphragms) {
    const dB = L.b ? L.b.diaphragms.find(x => x.id === d.id) : null;
    const sec = (dd, cse, at, side) => sectionAt({ ...cse, diaphragms: [dd] }, at, side);
    const bands = (sa, sb) => sa.parts.filter(p => p.id === d.id).flatMap((p, pi) => p.bands.map((b, bi) => {
      const ob = sb ? ((sb.parts.filter(q => q.id === d.id)[pi] || {}).bands || [])[bi] : null;
      const vb = ob ? ob.v : null, gov = vb !== null && Math.abs(vb) > Math.abs(b.v) + 1e-9 ? acts.b : acts.a;
      return f1(Math.max(Math.abs(b.v), Math.abs(vb || 0))) + (sb ? ' (' + gov + ')' : '') + (p.bands.length > 1 ? ' [' + f1(b.lo) + '–' + f1(b.hi) + ']' : '');
    })).join(', ') || '—';
    const rows = plan.grids.filter(g => g.axis === L.a.axis && g.at >= d.lo - 1e-6 && g.at <= d.hi + 1e-6).sort((a, b) => a.at - b.at).map(g => {
      const lo = g.at <= d.lo + 1e-6, hi = g.at >= d.hi - 1e-6;
      const ma = sec(d, L.a, g.at, '-'), pa = sec(d, L.a, g.at, '+'), mb = dB ? sec(dB, L.b, g.at, '-') : null, pb = dB ? sec(dB, L.b, g.at, '+') : null;
      const V = (x, y) => f0(Math.max(Math.abs(x.V), y ? Math.abs(y.V) : 0));
      return [g.name + ' (' + f1(g.at) + ')', lo ? '' : V(ma, mb), hi ? '' : V(pa, pb), lo ? '' : bands(ma, mb), hi ? '' : bands(pa, pb)];
    });
    out.push({ title: 'Diaphragm ' + (d.mark || '') + ' — section shears, ' + L.name + (L.b ? ' (max of ' + acts.a + ' / ' + acts.b + ')' : ''),
      table: { headers: ['Station', '|V| − (lb)', '|V| + (lb)', 'max |v| − per band (plf)', 'max |v| + per band (plf)'], rows, colWidths: [0.14, 0.12, 0.12, 0.31, 0.31] } });
  }
  return out;
}

// TDs of the case at a level: supports, P, v_TD per segment, reactions — both senses
function tdTable(out, cs, L) {
  const runsOf = list => (list || []).filter(r => r.caseId === cs.id);
  const ent = runsOf(out.tdRuns), rv = out.reverse ? runsOf(out.reverse.tdRuns) : [];
  const fieldsB = L.b ? L.b.fields || [] : [];
  const rows = [];
  for (const f of L.a.fields || []) {
    const r = ent.find(x => x.tdId === f.tdId), rb = rv.find(x => x.tdId === f.tdId), fb = fieldsB.find(x => x.tdId === f.tdId);
    const P = x => (x && x.skill ? [x.skill.td_P1, x.skill.td_has_load2 ? x.skill.td_P2 : null].filter(v => Number.isFinite(v)).map(v => f0(L.k * v)).join(' + ') : '—');
    const R = x => (x && x.outputs && Number.isFinite(x.outputs.td_F_sup_top) ? f0(L.k * x.outputs.td_F_sup_top) + ' / ' + f0(L.k * x.outputs.td_F_sup_bot) : '—');
    const segs = ff => (ff ? ff.segs.map(s => f1(s.lo) + '–' + f1(s.hi) + ': ' + f1(s.v)).join('; ') : '—');
    rows.push([f.mark, (f.bottom || '?') + ' / ' + (f.top || '?'), (r && r.terminal) || '—', P(r) + (rb ? ' | ' + P(rb) : ''), segs(f) + (fb ? ' | ' + segs(fb) : ''), R(r) + (rb ? ' | ' + R(rb) : '')]);
  }
  if (!rows.length) return null;
  return { title: 'Transfer diaphragms — ' + L.name + ' (entered | reversed sense)', table: {
    headers: ['TD', 'Supports', 'Run', 'P (lb)', 'v_TD per segment (plf)', 'To top / bottom support (lb)'], rows, colWidths: [0.06, 0.1, 0.1, 0.14, 0.4, 0.2] } };
}

function caseStatus(cs, csR, acts) {
  const s = [];
  if ((cs.paused || []).length) s.push('PAUSED — ' + cs.paused.map(p => 'TD ' + p.mark + ' ' + p.reason).join('; ') + ': TD / net shear and member forces are not reported.');
  else if (cs.failed) s.push('FAILED — ' + cs.failed + '. Only the basic shear is valid; the line forces are not sent to Shear Wall Design.');
  else if (cs.notClosed) s.push('FAILED — member runs do not close (' + cs.notClosed + '). The line forces are held from Shear Wall Design.');
  if (csR && ((csR.paused || []).length || csR.failed)) s.push('The reversed sense (' + acts.b + ') is ' + ((csR.paused || []).length ? 'PAUSED' : 'FAILED') + ' — its TD / net shear and member forces are not used: those envelopes use the entered sense only.');
  return s;
}

export function daPdfSections(inputs, out, plan) {
  const detailed = inputs.pdfReport === 'detailed';
  const S = [];
  const fl = out.forceLevels || {};
  const cases = (out.analysis && out.analysis.cases) || [];
  const above = cases.some(cs => (cs.above || []).some(a => a.V));
  const fails = (out.checks || []).filter(c => !c.ok && !c.warn), warns = [...(out.checks || []).filter(c => !c.ok && c.warn), ...(out.warnings || [])];
  S.push({ title: 'Diaphragm Analysis — DRAFT (TD engine: skill wood-diaph-transfer, not PE-approved)', rows: [
    ['Level', (inputs.level && inputs.level.name) || '—'],
    ['F_{x} (kip, 1.0E)', fl.fx !== null && fl.fx !== undefined ? String(fl.fx) : '—'],
    ['ΣA (sf) / q (psf)', f2(out.sumA) + (out.q !== null && out.q !== undefined ? ' / ' + f2(out.q) : '')],
    ['Code / sheathing', (inputs.codeEdition || '') + ' · ' + ((inputs.diaphragm && inputs.diaphragm.sheathing) || 'wsp') + ', ' + (inputs.diaphragm && inputs.diaphragm.blocked === false ? 'unblocked' : 'blocked')],
    ['Values printed', 'ASD — 0.7E (seismic) / 0.6W (wind); the analysis runs at 1.0E / 1.0W. Seismic at three force levels: 1.0E, diaphragm (k_D) and collector (k_C).'],
    ['k_D / k_C', fk(fl.diaphragm || 1) + ' / ' + fk(fl.collector || 1) + ' — the full factors: the effect of ρ is already incorporated in the factor entered (no separate ρ)'],
    ...(above ? [['Walls above (transfer)', 'Ω₀ ' + fk(fl.omega0 ?? 2.5) + (fl.increase ? ' × 1.25' : '') + ' at the diaphragm level (ASCE 7-22 §12.10.1.1)']] : []),
    ['Both senses', 'Every load case is analysed acting both ways (each by its own run). Unit shears: max |v| of the two; members: max T / max C of the two (signed).'],
    ['Shear Wall Design', out.wallLink ? 'Linked — it receives the 1.0E / 1.0W line forces of the entered sense and applies its own ρ and load combinations' : 'Not linked'],
    ['Checks', fails.length ? { t: fails.length + ' failed, ' + warns.length + ' warning(s) — see Checks', color: RED } : 'all passed' + (warns.length ? ', ' + warns.length + ' warning(s)' : '')],
  ] });
  if (out.errors && out.errors.length) {
    S.push({ title: 'Plan issues — not analysed', text: out.errors.map(e => '• ' + e.msg).join('\n') });
    return S;
  }
  // plan, one per load direction
  for (const dir of [...new Set(cases.map(c => c.dir))]) {
    const d = drawPlan(plan, { ...newEditorState(), dir }, [], {});
    S.push(...figure('Plan — ' + dirTxt(dir) + ': grids, outline, openings, walls, diaphragms, TDs', { svg: d.svg, view: d.view }));
  }
  for (const cs of cases) {
    const sense = (out.senses || []).find(x => x.caseId === cs.id) || { entered: '', reversed: '' };
    const acts = { a: sense.entered || 'entered', b: sense.reversed || 'reversed' };
    const csR = out.reverse ? out.reverse.cases.find(c => c.id === cs.id) || null : null;
    const levels = reportLevels(out, cs);
    const head = kindTxt(cs.kind) + ', ' + dirTxt(cs.dir);
    S.push({ title: head.charAt(0).toUpperCase() + head.slice(1), pageBreakBefore: true, rows: [
      ['Senses', acts.a + ' (entered) and ' + acts.b + ' (reversed)'], ['Levels', levels.map(L => L.name + ' = × ' + fk(L.k)).join('; ')]] });
    const st = caseStatus(cs, csR, acts);
    if (st.length) S.push({ text: st.join('\n') });
    S.push({ title: 'Line forces and wall shares — ' + head + ' (equal in both senses)', table: lineTable(cs) });
    if (cs.failed || (cs.paused || []).length) {
      const L = levels.find(x => x.key === 'D') || levels[0];
      S.push(...shearFigure(plan, L, 1, acts, 'Basic unit shear v_b, ' + L.name));
      continue;
    }
    const D = levels.find(x => x.key === 'D') || levels[0], C = levels.find(x => x.key === 'C') || levels[0];
    if (!detailed) {
      S.push(...shearFigure(plan, D, 3, acts, 'Net unit shear v_net, ' + D.name));
      S.push(...memberFigure(plan, C, acts, 'Member forces, ' + C.name));
    } else {
      for (const L of levels) S.push(...shearFigure(plan, L, 3, acts, 'Net unit shear v_net, ' + L.name));
      S.push(...shearFigure(plan, D, 1, acts, 'Basic unit shear v_b, ' + D.name));
      if ((D.a.fields || []).length) S.push(...shearFigure(plan, D, 2, acts, 'TD unit shear v_TD, ' + D.name));
      for (const L of levels) S.push(...memberFigure(plan, L, acts, 'Member forces, ' + L.name));
    }
    S.push({ title: 'Member forces — ' + head + ', max T / max C of both senses at each level (lb)', table: memberTable(levels) });
    if (detailed) {
      S.push(...sectionTables(plan, D, acts));
      const td = tdTable(out, cs, levels[0]); // the TD runs are at 1.0: exact × the 1.0E-level factor (walls above scale by Ω₀ at the diaphragm level)
      if (td) S.push(td);
      if (cs.offset) S.push({ title: 'Closure solver — ' + head + ' (1.0, entered sense)', table: {
        headers: ['Pass', ...cs.offset.passes[0].lines.map(l => l.name + ' (lb)'), 'Largest residual (lb)', 'Open runs'],
        rows: cs.offset.passes.map(p => [String(p.pass), ...cs.offset.passes[0].lines.map(l => f0((p.lines.find(x => x.name === l.name) || {}).P)), f1(p.maxRes), p.open ? String(p.open) : '0 ✓']) } });
      const ab = (cs.above || []).filter(a => a.V);
      if (ab.length) {
        const kc = comboFactor(cs.kind, 'ASD');
        S.push({ title: 'Walls of the story above — ' + head + ' (ASD)', table: {
          headers: ['Wall', 'Line', 'Goes', 'V 1.0 (lb)', ...levels.map(L => L.key === 'E' ? '1.0E level (lb)' : L.key === 'D' ? 'Diaphragm (lb)' : 'Collector (lb)'), 'Into the floor, diaphragm (plf)'],
          rows: ab.map(a => { const f = L => kc * (L.key === 'D' ? (fl.transfer ?? 2.5) : L.kL);
            return [a.mark, a.line, a.kind === 'transfer' ? 'into this diaphragm' : 'down its line', f0(a.V), ...levels.map(L => f0(a.V * f(L))), f0(a.V * f(D) / Math.max(1e-9, a.to - a.from))]; }) } });
      }
    }
  }
  // checks
  const list = [...fails.map(c => '✗ ' + c.msg), ...warns.map(c => '⚠ ' + c.msg)];
  S.push({ title: 'Checks', pageBreakBefore: !detailed ? false : true, text: list.length ? list.join('\n') : 'All checks passed: every case balances and every member run closes, in both senses.' });
  return S;
}
