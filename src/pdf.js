import { jsPDF } from 'jspdf';
import { formatDate } from './utils.js';
import { uploadCalcSheet } from './db.js';
import { currentOutputs } from './results.js';
import { richRuns } from './richText.js';

export async function exportItemPdf(project, item, mod, { saveToStorage = true, items = [] } = {}) {
  // The project-page PDF button passes the stored row — bring its definition up to the current schema first
  // (migrations are idempotent, so items already migrated by the form pass through unchanged)
  if (mod.migrate && item) item = mod.migrate({ ...item });
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  let pageW = doc.internal.pageSize.getWidth();
  let pageH = doc.internal.pageSize.getHeight();
  const margin = 54;
  let contentW = pageW - 2 * margin;
  let orientation = 'portrait';
  // New page in the given orientation (sizes follow the page)
  function newPage(orient) {
    renderFooter();
    orientation = orient || orientation;
    doc.addPage('letter', orientation);
    pageNum++;
    pageW = doc.internal.pageSize.getWidth();
    pageH = doc.internal.pageSize.getHeight();
    contentW = pageW - 2 * margin;
    y = margin;
    renderHeader();
  }
  let y = margin;
  let pageNum = 1;

  const isPlaceholder = item.calcVersion === 'PLACEHOLDER_v1' || item.outputs?.calcVersion === 'PLACEHOLDER_v1';

  function checkPage(needed) {
    if (y + needed > pageH - 72) newPage();
  }

  function renderHeader() {
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text('Project: ' + (project.displayNumber || project.projectNumber) + ' — ' + project.name, margin, margin - 18);
    doc.text(item.label || mod.label, margin, margin - 8);
    doc.setDrawColor(180);
    doc.line(margin, margin - 4, pageW - margin, margin - 4);
    if (isPlaceholder) {
      doc.setFontSize(24);
      doc.setTextColor(220, 180, 60);
      doc.text('PLACEHOLDER', pageW / 2, pageH / 2, { align: 'center', angle: 45 });
      doc.setTextColor(0);
    }
  }

  function renderFooter() {
    doc.setFontSize(7);
    doc.setTextColor(140);
    const footY = pageH - 36;
    doc.line(margin, footY, pageW - margin, footY);
    doc.text('By: ' + (item.enteredBy || '—'), margin, footY + 12);
    doc.text('Date: ' + formatDate(item.updatedAt || item.createdAt), margin + 160, footY + 12);
    doc.text('Checked: ____________', margin + 320, footY + 12);
  }

  // === Rich text (subscripts, user request 2026-10-01): runs [{ t, sub }] from richText.js ===
  // A cell is a string, or { t, color: [r, g, b] } for a coloured value (D/C).
  const SUB_SCALE = 0.7;
  const cellText = (c) => (c != null && typeof c === 'object' && !Array.isArray(c) ? c.t : c);
  const cellColor = (c) => (c != null && typeof c === 'object' && c.color ? c.color : null);
  // The standard Helvetica font has no Greek, arrows or math signs (they printed as Á, ©, £, ´, !’ …). Those
  // characters are drawn with the standard Symbol font at their Symbol code (user review 2026-10-01).
  const SYM = { 'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'Δ': 'D', 'ε': 'e', 'θ': 'q', 'λ': 'l', 'μ': 'm', 'π': 'p', 'ρ': 'r',
    'σ': 's', 'Σ': 'S', 'τ': 't', 'φ': 'f', 'Φ': 'F', 'ψ': 'y', 'ω': 'w', 'Ω': 'W', '≤': '\u00A3', '≥': '\u00B3', '≈': '\u00BB',
    '∞': '\u00A5', '√': '\u00D6', '←': '\u00AC', '↑': '\u00AD', '→': '\u00AE', '↓': '\u00AF', '⊥': '^', '−': '-', '∓': '\u00B1', '′': '\u00A2' };
  // segments of one run: { t, sym } (combining marks dropped)
  function glyphSegs(t) {
    const out = [];
    for (const ch of String(t).replace(/\u0304/g, '')) {
      const sym = SYM[ch] != null;
      const c = sym ? SYM[ch] : ch;
      const last = out[out.length - 1];
      if (last && last.sym === sym) last.t += c; else out.push({ t: c, sym });
    }
    return out;
  }
  // Adobe Symbol glyph widths (em): jsPDF under-measures them, so text after an arrow overlapped it
  const SYM_W = { a: 0.631, b: 0.549, g: 0.411, d: 0.494, D: 0.612, e: 0.439, q: 0.521, l: 0.549, m: 0.576, p: 0.549, r: 0.549,
    s: 0.603, S: 0.592, t: 0.439, f: 0.521, F: 0.763, y: 0.686, w: 0.686, W: 0.768, '^': 0.658, '-': 0.549,
    '£': 0.549, '³': 0.549, '»': 0.549, '¥': 0.713, 'Ö': 0.549, '¬': 0.987, '­': 0.603,
    '®': 0.987, '¯': 0.603, '±': 0.549, '¢': 0.247 };
  const symWidth = (t) => [...t].reduce((a, c) => a + (SYM_W[c] != null ? SYM_W[c] : 0.6), 0) * doc.getFontSize();
  function segWidth(seg) { return seg.sym ? symWidth(seg.t) : doc.getTextWidth(seg.t); }
  function runWidth(r, size) { doc.setFontSize(r.sub ? size * SUB_SCALE : size); return glyphSegs(r.t).reduce((a, g) => a + segWidth(g), 0); }
  function drawRuns(runs, x, yBase, size) {
    let cx = x;
    const f = doc.getFont();
    for (const r of runs) {
      doc.setFontSize(r.sub ? size * SUB_SCALE : size);
      for (const g of glyphSegs(r.t)) {
        if (g.sym) doc.setFont('symbol', 'normal');
        doc.text(g.t, cx, yBase + (r.sub ? size * 0.25 : 0));
        cx += g.sym ? symWidth(g.t) : doc.getTextWidth(g.t);
        if (g.sym) doc.setFont(f.fontName, f.fontStyle);
      }
    }
    doc.setFontSize(size);
    return cx - x;
  }
  // Unicode subscript digits (Ω₀) → subscript runs
  const subDigits = (str) => String(str == null ? '' : str).replace(/[₀-₉]+/g, (m) => '_{' + [...m].map(c => String(c.charCodeAt(0) - 0x2080)).join('') + '}');
  const runsOf = (str, short) => richRuns(subDigits(str), short);
  // Word wrap over runs: returns lines, each an array of runs
  function wrapRuns(runs, width, size) {
    const words = [];
    for (const r of runs) {
      const parts = r.sub ? [r.t] : r.t.split(/(\s+)/).filter(x => x !== '');
      for (const t of parts) words.push({ t, sub: r.sub });
    }
    const lines = [[]];
    let w = 0;
    for (const wd of words) {
      const ww = runWidth(wd, size);
      const isSpace = !wd.sub && /^\s+$/.test(wd.t);
      if (w + ww > width && w > 0 && !isSpace) { lines.push([]); w = 0; }
      if (isSpace && w === 0) continue;
      // a single word longer than the width is split by characters
      if (ww > width && !wd.sub) {
        for (const ch of doc.splitTextToSize(wd.t, width)) { if (w > 0) { lines.push([]); w = 0; } lines[lines.length - 1].push({ t: ch, sub: false }); w = runWidth({ t: ch }, size); }
        continue;
      }
      lines[lines.length - 1].push(wd); w += ww;
    }
    doc.setFontSize(size);
    return lines;
  }
  const anchors = {}; // section.anchor → page number (line index)
  let indexRefs = []; // { page, x, y, anchor } — page numbers written after all sections

  renderHeader();
  doc.setFontSize(14);
  doc.setTextColor(26, 34, 51);
  doc.text(mod.label, margin, y + 14);
  y += 28;

  async function svgToCanvas(svgElement, w, h) {
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgElement);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    return canvas;
  }

  // Same results the form shows: regenerated from the definition when the module opts in
  const outputs = (mod.regenerateResults ? currentOutputs(mod, item, items) : item.outputs) || {};
  const sections = mod.pdfSections ? mod.pdfSections(item.inputs || {}, outputs) : [];
  for (const section of sections) {
    // a section that needs the other orientation (landscape elevations) always starts a new page in it
    const want = section.landscape ? 'landscape' : 'portrait';
    if (want !== orientation) newPage(want);
    else if (section.pageBreakBefore && y > margin) newPage();
    checkPage(60);
    if (section.anchor) anchors[section.anchor] = pageNum;
    if (section.heading) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(26, 34, 51);
      drawRuns(runsOf(section.heading), margin, y + 16, 15);
      doc.setFont('helvetica', 'normal');
      doc.setDrawColor(29, 78, 216);
      doc.setLineWidth(1.2);
      doc.line(margin, y + 22, pageW - margin, y + 22);
      doc.setLineWidth(0.2);
      doc.setDrawColor(200);
      y += 32;
    }
    doc.setFontSize(9);
    doc.setTextColor(29, 78, 216);
    const titleLines = wrapRuns(runsOf(section.title), contentW, 9);
    titleLines.forEach((ln, i) => drawRuns(ln, margin, y + 10 + i * 11, 9));
    y += 16 + (titleLines.length - 1) * 11;
    doc.setTextColor(26, 34, 51);

    if (section.table) {
      const { headers, rows } = section.table;
      const colWidths = section.table.colWidths;
      let colStarts = [];
      if (colWidths) {
        let x = 0;
        colStarts = colWidths.map((w) => { const s = x; x += w * contentW; return s; });
      } else {
        const colW = contentW / headers.length;
        colStarts = headers.map((_, i) => i * colW);
      }
      const colW = (i) => {
        const next = i + 1 < colStarts.length ? colStarts[i + 1] : contentW;
        return next - colStarts[i] - 4;
      };
      doc.setFontSize(7);
      doc.setTextColor(100);
      const headLines = headers.map((h, i) => wrapRuns(runsOf(h, true), colW(i), 7));
      const headN = Math.max(1, ...headLines.map(l => l.length));
      headLines.forEach((lines, i) => lines.forEach((ln, li) => drawRuns(ln, margin + colStarts[i], y + 8 + li * 8, 7)));
      y += 4 + headN * 8;
      doc.setDrawColor(200);
      doc.line(margin, y, pageW - margin, y);
      y += 2;
      doc.setFontSize(8);
      doc.setTextColor(26, 34, 51);
      rows.forEach((row) => {
        const cells = row.cells || row;
        const cellLines = cells.map((cell, i) => wrapRuns(runsOf(cellText(cell) == null ? '' : String(cellText(cell))), colW(i), 8));
        const lineCount = Math.max(1, ...cellLines.map((l) => l.length));
        const rowH = lineCount * 10 + 3;
        checkPage(rowH);
        cellLines.forEach((lines, i) => {
          const col = cellColor(cells[i]);
          if (col) doc.setTextColor(...col);
          lines.forEach((line, li) => drawRuns(line, margin + colStarts[i], y + 9 + li * 10, 8));
          if (col) doc.setTextColor(26, 34, 51);
          if (section.lineIndex && i === cells.length - 1 && row.anchor) indexRefs.push({ page: pageNum, x: margin + colStarts[i], y: y + 9, anchor: row.anchor });
        });
        y += rowH;
      });
      y += 6;
    } else if (section.rows) {
      doc.setFontSize(9);
      section.rows.forEach((row) => {
        const valLines = wrapRuns(runsOf(cellText(row[1]) == null ? '' : String(cellText(row[1]))), contentW - 160, 9);
        const h = Math.max(1, valLines.length) * 11 + 4;
        checkPage(h);
        doc.setTextColor(75);
        const lab = wrapRuns(runsOf(String(row[0]), true), 152, 9);
        lab.forEach((ln, li) => drawRuns(ln, margin, y + 10 + li * 11, 9));
        const col = cellColor(row[1]);
        doc.setTextColor(...(col || [26, 34, 51]));
        valLines.forEach((ln, li) => drawRuns(ln, margin + 160, y + 10 + li * 11, 9));
        doc.setTextColor(26, 34, 51);
        y += Math.max(h, lab.length * 11 + 4);
      });
      y += 4;
    } else if (section.text) {
      doc.setFontSize(8);
      const lines = wrapRuns(runsOf(section.text), contentW, 8);
      lines.forEach((line) => {
        checkPage(12);
        drawRuns(line, margin, y + 9, 8);
        y += 11;
      });
      y += 4;
    } else if (section.equations) {
      const baseSize = 9;
      const subSize = 6;
      section.equations.forEach((eq) => {
        if (eq.desc) {
          checkPage(32);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8);
          doc.setTextColor(60);
          doc.text(eq.desc, margin, y + 10);
          y += 14;
        }
        checkPage(20);
        let curX = margin + 8;
        (eq.parts || []).forEach((p) => {
          const size = (p.sub || p.sup) ? subSize : baseSize;
          const yOff = p.sub ? 3 : (p.sup ? -4 : 0);
          if (p.greek) doc.setFont('Symbol', 'normal');
          else doc.setFont('helvetica', p.bold ? 'bold' : 'normal');
          doc.setFontSize(size);
          doc.setTextColor(26, 34, 51);
          doc.text(p.t, curX, y + 10 + yOff);
          curX += doc.getTextWidth(p.t);
        });
        if (eq.ref) {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(7);
          doc.setTextColor(120);
          doc.text(eq.ref, pageW - margin, y + 10, { align: 'right' });
        }
        y += 18;
      });
      y += 4;
    } else if (section.elevation) {
      const { renderFn, aspectRatio, width: fixedW, height: fixedH } = section.elevation;
      const imgW = fixedW ? Math.min(fixedW, contentW) : contentW;
      const imgH = fixedW ? fixedH * (imgW / fixedW) : imgW * aspectRatio;
      const maxH = pageH - margin * 2 - 80;
      const finalW = imgH > maxH ? imgW * (maxH / imgH) : imgW;
      const finalH = imgH > maxH ? maxH : imgH;
      checkPage(finalH + 20);
      try {
        const svgElement = renderFn(finalW);
        const canvas = await svgToCanvas(svgElement, finalW, finalH);
        doc.addImage(canvas, 'PNG', margin, y, finalW, finalH);
        y += finalH + 10;
      } catch (e) {
        console.error('PDF elevation render failed:', e);
        doc.setFontSize(8);
        doc.setTextColor(200, 60, 60);
        doc.text('[Elevation diagram could not be rendered]', margin, y + 10);
        y += 20;
      }
    }
  }

  renderFooter();

  // Line index: page numbers of the anchored sections, written on the index page(s) now that they are known
  for (const r of indexRefs) {
    if (anchors[r.anchor] == null) continue;
    doc.setPage(r.page);
    doc.setFontSize(8);
    doc.setTextColor(26, 34, 51);
    doc.text('Sheet ' + anchors[r.anchor], r.x, r.y);
  }

  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    pageW = doc.internal.pageSize.getWidth();
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text('Sheet ' + i + ' of ' + totalPages, pageW - margin, margin - 18, { align: 'right' });
  }

  const blob = doc.output('blob');
  const filename = (project.displayNumber || project.projectNumber) + '_' + mod.id + '.pdf';

  // Trigger a direct browser download — this is a real website, not a
  // sandboxed artifact, so <a download> works normally here.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  if (saveToStorage) {
    try {
      await uploadCalcSheet(project.projectNumber, item.id, blob);
    } catch (e) {
      console.error('Failed to archive PDF to storage:', e);
    }
  }
}
