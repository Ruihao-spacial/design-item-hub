// Diaphragm to LRS — PDF sections (Summary / Detailed). Built from calcAll() results only.
import { renderDiaphragmDiagram, diagramSize } from './diaphragmToLrsDiagram.js';
import { leverRuleText } from './diaphragmToLrsCalc.js';

const f2 = v => (Number.isFinite(v) ? v.toFixed(2) : '—');
const REG = { span: 'back span', left: 'left OH', right: 'right OH' };

function diaphragmTable(lv) {
  const rows = [];
  for (const d of lv.diaphragms) {
    const parts = (d.parts || []).map(p => f2(p.a) + '/' + f2(p.b) + '/' + f2(p.c) + ' d ' + f2(p.d)).join('; ');
    const area = (d.parts || []).reduce((s, p) => s + (Number.isFinite(p.A) ? p.A : 0), 0);
    const w = (d.parts || []).map(p => f2(p.wPlf)).join('; ');
    const pts = (d.points || []).map(p => p.label + ' ' + f2(p.P) + ' @' + f2(p.x) + (p.source ? ' ← ' + p.source : ' manual')).join('; ') || '—';
    if (d.errors && d.errors.length) {
      rows.push([d.label, f2(d.L), parts, f2(area), w, pts, { t: 'not solved: ' + d.errors.join('; '), color: [200, 40, 40] }, '', '', '', '']);
      continue;
    }
    d.supports.forEach((s, i) => {
      const neg = s.R < 0;
      rows.push(i === 0
        ? [d.label, f2(d.L) + (d.x1 > 0 || d.x2 < d.L ? ' (x₁ ' + f2(d.x1) + ', x₂ ' + f2(d.x2) + ')' : ''), parts, f2(area), w, pts, d.label + '.' + s.name, s.to, f2(s.Rdist), f2(s.RP), neg ? { t: f2(s.R), color: [200, 40, 40] } : f2(s.R)]
        : ['', '', '', '', '', '', d.label + '.' + s.name, s.to, f2(s.Rdist), f2(s.RP), neg ? { t: f2(s.R), color: [200, 40, 40] } : f2(s.R)]);
    });
  }
  return { headers: ['Label', 'L (ft)', 'Parts a/b/c, d (ft)', 'A (sf)', 'w (plf)', 'Point loads (k @ ft)', 'Reaction', 'To', 'R_dist (k)', 'R_P (k)', 'R_total (k)'],
    rows, colWidths: [0.07, 0.09, 0.15, 0.06, 0.07, 0.15, 0.09, 0.07, 0.08, 0.08, 0.09] };
}

function summaryTable(lv) {
  const rows = lv.lines.map(u => [u.label, f2(u.F),
    u.fromAbove.map(f => f.from + (f.pct !== 100 ? ' ' + f2(f.pct) + '%' : '') + ' ' + f2(f.V)).join(' + ') || '—', f2(u.V), u.goesTo.map(g => g.text).join(', ')]);
  rows.push(['Σ', f2(lv.sumF), lv.ended ? 'ends at this level ' + f2(lv.ended) : '', f2(lv.sumV), 'ΣF = F_{x} + manual P = ' + f2((lv.fx || 0) + (lv.sumManual || 0))]);
  return { headers: ['Line', 'F (k)', 'From above (k)', 'V = F + above (k)', 'Goes to'], rows, colWidths: [0.14, 0.12, 0.32, 0.16, 0.26] };
}

export function diaphragmPdfSections(inputs, out) {
  const detailed = inputs.pdfReport === 'detailed';
  const sections = [];
  const linked = !!(inputs.refs && inputs.refs.elfSource);
  sections.push({ title: 'Design basis', rows: [
    ['Method', 'Flexible diaphragms, each a beam on two supports (statics)'],
    ['Load', 'Seismic 1.0E — story force F_{x} per level' + (linked ? ' (linked from the ELF item)' : ' (entered)')],
    ['Area load', 'q = F_{x} / ΣA, ΣA = all diaphragm parts of the level and direction'],
    ['Line load', 'w = q·d on each rectangular part (d = depth)'],
    ['Reactions', 'R1 = W·(x₂ − x̄)/l,  R2 = W·(x̄ − x₁)/l  per piece / point load; ΣR = ΣW + ΣP'],
    ['Story shear', 'V = F (this level) + force from the line(s) above'],
    ['Checks', results(out)],
  ] });
  const dirs = out.perDirection;
  sections.push({ title: 'Levels', table: {
    headers: ['Level', 'Tag', 'F_{x} (k)', ...dirs.flatMap(d => ['ΣA ' + d.name + ' (sf)', 'q ' + d.name + ' (psf)'])],
    rows: out.levels.map(lv => [lv.name, lv.tag, f2(lv.fx), ...dirs.flatMap(d => { const p = d.perLevel.find(x => x.levelId === lv.id); return [f2(p.sumA), f2(p.qPsf)]; })]),
  } });
  if (detailed) sections.push({ title: 'Variables', rows: [
    ['L', 'diaphragm length (ft); x measured from its left end'], ['x₁, x₂', 'support positions R1, R2 (ft); l = x₂ − x₁ = back span'],
    ['a, b, c', 'part start, loaded length, remainder: a + b + c = L (ft)'], ['d', 'part depth (ft); A = b·d (sf)'],
    ['w', 'line load q·d (plf)'], ['W, x̄', 'piece resultant w·length (k) at its mid-point (ft)'], ['P', 'point load (k)'],
    ['x₂ − x̄, x̄ − x₁', 'lever arms of a load about R1 / R2 (ft); a load on an overhang has a negative lever (its reaction reverses)'], ['R_dist, R_P', 'reaction from uniform parts / point loads (k)'],
    ['F, V', 'level force of a line (k); story shear V = F + from above (k)'],
  ] });

  for (const d of dirs) {
    const dir = inputs.directions.find(x => x.id === d.id) || {};
    sections.push({ heading: 'Direction ' + d.name, title: 'Wall lines', pageBreakBefore: true, rows: [
      ['Wall lines', (dir.lines || []).map(l => l.name).join(', ') || '—'],
      ['Merged lines', (dir.groups || []).filter(g => (g.lineIds || []).length > 1).map(g => g.lineIds.map(id => ((dir.lines || []).find(l => l.id === id) || {}).name).join('+')
        + (g.levelIds && g.levelIds.length ? ' at ' + g.levelIds.map(id => (inputs.levels.find(l => l.id === id) || {}).name).join(', ') : ' (all levels)')).join('; ') || '—'],
    ] });
    for (const lv of d.perLevel) {
      if (!lv.diaphragms.length && !lv.lines.length) continue;
      sections.push({ title: d.name + ' — ' + lv.name + ':  F_{x} ' + f2(lv.fx) + ' k,  ΣA ' + f2(lv.sumA) + ' sf,  q ' + f2(lv.qPsf) + ' psf', table: diaphragmTable(lv) });
      if (lv.lines.length) sections.push({ title: 'Wall Line Shear Summary — ' + d.name + ', ' + lv.name, table: summaryTable(lv) });
      if (!detailed) continue;
      for (const dg of lv.diaphragms) {
        if (dg.errors && dg.errors.length) continue;
        const sz = diagramSize(dg);
        sections.push({ title: dg.label + ' — L ' + f2(dg.L) + ' ft, l ' + f2(dg.l) + ' ft', pageBreakBefore: false,
          elevation: { renderFn: () => renderDiaphragmDiagram(dg), width: sz.width, height: sz.height } });
        sections.push({ title: dg.label + ' — reactions by piece / point load (lever rule)', table: {
          headers: ['Load', 'Region', 'w (plf) / P (k)', 'W (k)', 'x̄ (ft)', 'x₂ − x̄', 'x̄ − x₁', 'R1 (k)', 'R2 (k)'],
          rows: [...dg.rows.map(r => [r.kind === 'uniform' ? r.label + ' ' + f2(r.u) + '–' + f2(r.v) : r.label + (r.source ? ' ← ' + r.source : ' manual'),
            REG[r.region], r.kind === 'uniform' ? f2(r.w * 1000) : f2(r.P), f2(r.kind === 'uniform' ? r.W : r.P), f2(r.kind === 'uniform' ? r.xbar : r.x),
            f2(r.lever1), f2(r.lever2), f2(r.R1), f2(r.R2)]),
          ['Σ', '', '', f2((dg.sumW || 0) + (dg.sumP || 0)), '', '', '', f2(dg.supports[0].R), f2(dg.supports[1].R)]],
          colWidths: [0.2, 0.1, 0.11, 0.09, 0.09, 0.09, 0.09, 0.11, 0.12] } });
        sections.push({ title: dg.label + ' — lever rule per row (x₁ ' + f2(dg.x1) + ', x₂ ' + f2(dg.x2) + ', l ' + f2(dg.l) + ' ft)', rows: dg.rows.map(r => [(r.kind === 'uniform' ? r.label + ' (' + REG[r.region] + ')' : r.label), leverRuleText(r, dg.x1, dg.x2).join(';   ')]) });
      }
    }
    if (detailed) sections.push({ title: 'Checks — ' + d.name, table: { headers: ['Check', 'What', 'Status', 'Details'],
      rows: d.checks.map(c => [c.id, c.label, c.status === 'pass' ? { t: 'OK', color: [30, 130, 60] } : { t: 'NG', color: [200, 40, 40] }, c.items.join('; ') || '—']),
      colWidths: [0.08, 0.4, 0.08, 0.44] } });
  }
  if (inputs.notes) sections.push({ title: 'Notes', text: inputs.notes });
  return sections;
}

function results(out) {
  const bad = out.perDirection.flatMap(d => d.checks.filter(c => c.status === 'fail').map(c => d.name + ' ' + c.id));
  return bad.length ? 'NG — ' + bad.join(', ') : 'all checks OK';
}
