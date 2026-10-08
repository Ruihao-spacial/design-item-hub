// Diaphragm to LRS — beam diagram of one diaphragm (one renderer for the tool and the PDF).
// Drawn to scale along x: uniform parts (stacked in tiers where they overlap) with w, point loads with P and
// their source, the two supports with their targets and reactions, and a dimension line.
import { svgEl } from './shearWallTypes.js';

const FONT = 'Barlow, Segoe UI, system-ui, sans-serif';
const C = {
  ink: '#1f2937', soft: '#6b7280', beam: '#111827', load: '#2563eb', loadFill: 'rgba(37,99,235,0.12)',
  point: '#7c3aed', support: '#374151', neg: '#dc2626', bg: '#ffffff', dim: '#9ca3af',
};
const W = 720, PAD = 46, TIER = 24;
const f2 = v => (Number.isFinite(v) ? v.toFixed(2) : '—');

function tiers(parts) {
  // greedy: a part goes in the first tier where it does not overlap the parts already there
  const rows = [];
  return parts.map(p => {
    const s = p.a, e = p.a + p.b;
    let t = rows.findIndex(r => r.every(([rs, re]) => e <= rs + 1e-9 || s >= re - 1e-9));
    if (t < 0) { rows.push([]); t = rows.length - 1; }
    rows[t].push([s, e]);
    return t;
  });
}

// Size of the drawing for a solved diaphragm (from calc outputs)
export function diagramSize(d) {
  const nt = Math.max(1, Math.max(0, ...tiers(validParts(d)).map(t => t + 1)));
  const top = (d.points && d.points.length ? 46 : 14);
  const beamY = top + nt * TIER + 14;
  return { width: W, height: beamY + 78 };
}

const validParts = d => (d.parts || []).filter(p => Number.isFinite(p.a) && p.b > 0);

// d = one diaphragm of outputs.perDirection[].perLevel[].diaphragms[]
export function renderDiaphragmDiagram(d, opts = {}) {
  const { width, height } = diagramSize(d);
  const svg = svgEl('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 ' + width + ' ' + height,
    width: opts.width || width, height: opts.width ? (opts.width * height / width) : height,
    style: { fontFamily: FONT, background: C.bg, display: 'block', maxWidth: '100%' } });
  svg.appendChild(svgEl('rect', { x: 0, y: 0, width, height, fill: C.bg }));
  const L = d.L;
  if (!(L > 0)) {
    svg.appendChild(text(width / 2, height / 2, 'Enter the length L to draw the diaphragm', { fill: C.soft, anchor: 'middle', size: 12 }));
    return svg;
  }
  const sx = (W - 2 * PAD) / L;
  const X = x => PAD + x * sx;
  const parts = validParts(d);
  const tierOf = tiers(parts);
  const nt = Math.max(1, Math.max(0, ...tierOf.map(t => t + 1)));
  const top = (d.points && d.points.length ? 46 : 14);
  const beamY = top + nt * TIER + 14;

  // uniform parts
  parts.forEach((p, i) => {
    const y = beamY - 6 - (tierOf[i] + 1) * TIER;
    const x0 = X(p.a), x1 = X(p.a + p.b);
    svg.appendChild(svgEl('rect', { x: x0, y, width: Math.max(1, x1 - x0), height: TIER - 6, fill: C.loadFill, stroke: C.load, 'stroke-width': 1 }));
    // load ticks: the bottom tier reaches the beam; upper tiers stay inside their own block (no lines through the parts below)
    const n = Math.max(2, Math.round((x1 - x0) / 18));
    const yEnd = tierOf[i] === 0 ? beamY - 3 : y + TIER - 6;
    const yStart = tierOf[i] === 0 ? y + TIER - 6 : y + TIER - 12;
    for (let k = 0; k <= n; k++) {
      const ax = x0 + (x1 - x0) * k / n;
      svg.appendChild(svgEl('line', { x1: ax, y1: yStart, x2: ax, y2: yEnd, stroke: C.load, 'stroke-width': 0.8 }));
    }
    const lbl = (parts.length > 1 ? p.label + ': ' : '') + 'w = ' + (Number.isFinite(p.wPlf) ? p.wPlf.toFixed(1) : '—') + ' plf';
    svg.appendChild(text((x0 + x1) / 2, y + TIER - 11, lbl, { fill: C.load, anchor: 'middle', size: 10.5, halo: true }));
  });

  // beam
  svg.appendChild(svgEl('line', { x1: X(0), y1: beamY, x2: X(L), y2: beamY, stroke: C.beam, 'stroke-width': 3 }));

  // point loads
  (d.points || []).forEach((pt, i) => {
    if (!Number.isFinite(pt.x)) return;
    const x = X(pt.x);
    const yTop = top - 30 + (i % 2) * 14;
    svg.appendChild(svgEl('line', { x1: x, y1: yTop + 4, x2: x, y2: beamY - 4, stroke: C.point, 'stroke-width': 1.6 }));
    svg.appendChild(svgEl('path', { d: `M${x - 4},${beamY - 10} L${x + 4},${beamY - 10} L${x},${beamY - 3} Z`, fill: C.point }));
    const lbl = pt.label + ' ' + f2(pt.P) + ' k' + (pt.source ? ' ← ' + pt.source : pt.manual ? ' (manual)' : '');
    const anchor = x < PAD + 60 ? 'start' : x > W - PAD - 60 ? 'end' : 'middle';
    svg.appendChild(text(x, yTop, lbl, { fill: C.point, anchor, size: 10.5, halo: true }));
  });

  // supports
  const sups = d.supports && d.supports.length ? d.supports : [{ name: 'R1', x: d.x1 }, { name: 'R2', x: d.x2 }];
  sups.forEach((s, i) => {
    if (!Number.isFinite(s.x)) return;
    const x = X(s.x);
    svg.appendChild(svgEl('path', { d: `M${x},${beamY + 2} L${x - 8},${beamY + 14} L${x + 8},${beamY + 14} Z`, fill: 'none', stroke: C.support, 'stroke-width': 1.5 }));
    const anchor = x < PAD + 50 ? 'start' : x > W - PAD - 50 ? 'end' : 'middle';
    const ax = anchor === 'start' ? x - 8 : anchor === 'end' ? x + 8 : x;
    svg.appendChild(text(ax, beamY + 27, s.name + (s.to ? ' → ' + s.to : ''), { fill: C.ink, anchor, size: 11, bold: true }));
    if (Number.isFinite(s.R)) {
      svg.appendChild(text(ax, beamY + 40, f2(s.R) + ' k' + (s.reverses ? ' (reverses)' : ''), { fill: s.reverses ? C.neg : C.ink, anchor, size: 11 }));
    }
  });

  // dimensions: 0, supports, L
  const marks = [...new Set([0, d.x1, d.x2, L].filter(Number.isFinite).map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  const dy = beamY + 60;
  svg.appendChild(svgEl('line', { x1: X(0), y1: dy, x2: X(L), y2: dy, stroke: C.dim, 'stroke-width': 1 }));
  marks.forEach(m => svg.appendChild(svgEl('line', { x1: X(m), y1: dy - 4, x2: X(m), y2: dy + 4, stroke: C.dim, 'stroke-width': 1 })));
  for (let i = 0; i < marks.length - 1; i++) {
    const a = marks[i], b = marks[i + 1];
    if (b - a < 1e-6) continue;
    const isSpan = Math.abs(a - d.x1) < 1e-6 && Math.abs(b - d.x2) < 1e-6;
    svg.appendChild(text((X(a) + X(b)) / 2, dy - 4, (isSpan ? 'l = ' : '') + f2(b - a) + ' ft', { fill: C.soft, anchor: 'middle', size: 10, halo: true }));
  }
  return svg;
}

function text(x, y, s, o = {}) {
  const t = svgEl('text', { x, y, 'text-anchor': o.anchor || 'start', 'font-size': o.size || 11, fill: o.fill || C.ink,
    'font-weight': o.bold ? 600 : 400, 'font-family': FONT });
  if (o.halo) { t.setAttribute('stroke', C.bg); t.setAttribute('stroke-width', 3); t.setAttribute('paint-order', 'stroke'); }
  t.textContent = s;
  return t;
}
