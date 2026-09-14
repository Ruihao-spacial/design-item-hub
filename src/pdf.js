import { jsPDF } from 'jspdf';
import { formatDate } from './utils.js';
import { uploadCalcSheet } from './db.js';

export async function exportItemPdf(project, item, mod, { saveToStorage = true } = {}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 54;
  const contentW = pageW - 2 * margin;
  let y = margin;
  let pageNum = 1;

  const isPlaceholder = item.calcVersion === 'PLACEHOLDER_v1' || item.outputs?.calcVersion === 'PLACEHOLDER_v1';

  function checkPage(needed) {
    if (y + needed > pageH - 72) {
      renderFooter();
      doc.addPage();
      pageNum++;
      y = margin;
      renderHeader();
    }
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

  renderHeader();
  doc.setFontSize(14);
  doc.setTextColor(26, 34, 51);
  doc.text(mod.label, margin, y + 14);
  y += 28;

  const sections = mod.pdfSections ? mod.pdfSections(item.inputs || {}, item.outputs || {}) : [];
  for (const section of sections) {
    if (section.pageBreakBefore && y > margin) {
      renderFooter();
      doc.addPage();
      pageNum++;
      y = margin;
      renderHeader();
    }
    checkPage(60);
    doc.setFontSize(9);
    doc.setTextColor(29, 78, 216);
    doc.text(section.title, margin, y + 10);
    y += 16;
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
      headers.forEach((h, i) => doc.text(String(h), margin + colStarts[i], y + 8));
      y += 12;
      doc.setDrawColor(200);
      doc.line(margin, y, pageW - margin, y);
      y += 2;
      doc.setFontSize(8);
      doc.setTextColor(26, 34, 51);
      rows.forEach((row) => {
        const cellLines = row.map((cell, i) => doc.splitTextToSize(String(cell), colW(i)));
        const lineCount = Math.max(...cellLines.map((l) => l.length));
        const rowH = lineCount * 10 + 3;
        checkPage(rowH);
        cellLines.forEach((lines, i) => {
          lines.forEach((line, li) => doc.text(line, margin + colStarts[i], y + 9 + li * 10));
        });
        y += rowH;
      });
      y += 6;
    } else if (section.rows) {
      doc.setFontSize(9);
      section.rows.forEach((row) => {
        checkPage(16);
        doc.setTextColor(75);
        doc.text(String(row[0]), margin, y + 10);
        doc.setTextColor(26, 34, 51);
        doc.text(String(row[1]), margin + 160, y + 10);
        y += 15;
      });
      y += 4;
    } else if (section.text) {
      doc.setFontSize(8);
      const lines = doc.splitTextToSize(section.text, contentW);
      lines.forEach((line) => {
        checkPage(12);
        doc.text(line, margin, y + 9);
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
    }
  }

  renderFooter();

  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
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
