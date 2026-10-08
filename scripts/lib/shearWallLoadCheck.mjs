// Runs a saved Shear Wall Design item through what the page does when it is opened —
// migrate → regenerate results → form (tabs) → results → PDF sections → elevations —
// in a stand-in DOM, and reports anything that would blank the page.
import { parseHTML } from 'linkedom';

if (!globalThis.document) {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  globalThis.window = window;
  globalThis.document = document;
  globalThis.Node = window.Node;
}

const { shearWallDesign } = await import('../../src/modules/shearWallDesign.js');
const { renderElevation, renderElevationForPdf } = await import('../../src/modules/shearWallElevation.js');

const TAB_LABELS = ['Summary / Config', 'Hardware'];

export function checkShearWallItem(item) {
  const report = { ok: false, fromSchema: parseInt(item.schemaVersion, 10) || 1, toSchema: shearWallDesign.schemaVersion, stats: null, warnings: 0, error: null };
  try {
    const migrated = shearWallDesign.migrate({ ...item });
    const inputs = migrated.inputs;
    const outputs = shearWallDesign.calc(inputs);

    const form = document.createElement('div');
    shearWallDesign.renderForm(form, JSON.parse(JSON.stringify(inputs)), () => {}, [], () => {});
    const buttons = [...form.querySelectorAll('button')].map(b => b.textContent);
    const missing = TAB_LABELS.filter(t => !buttons.includes(t));
    if (missing.length) throw new Error('form tabs missing: ' + missing.join(', '));

    shearWallDesign.renderOutputs(document.createElement('div'), outputs);
    shearWallDesign.pdfSections(inputs, outputs);

    const lines = (inputs.directions || []).flatMap(d => d.lines || []);
    const outLines = outputs.perDirection.flatMap(d => d.perLine);
    for (const line of lines) {
      const lineOut = outLines.find(l => l.lineId === line.id);
      const c = document.createElement('div');
      const h = renderElevation(c, JSON.parse(JSON.stringify(line)), inputs.levels, inputs.wallDLTypes || [], {});
      h.drawSVG();
      if (lineOut) { h.showResults(lineOut); renderElevationForPdf(line, inputs.levels, inputs.wallDLTypes || [], lineOut, 500); }
      h.destroy();
    }

    report.stats = {
      lines: lines.length,
      walls: lines.reduce((s, l) => s + (l.walls || []).length, 0),
      beams: lines.reduce((s, l) => s + (l.beams || []).length, 0),
      posts: lines.reduce((s, l) => s + (l.supportPosts || []).length, 0),
    };
    report.warnings = outLines.reduce((s, l) => s + ((l.loadPathAudit && l.loadPathAudit.warnings) || []).length, 0);
    report.migrated = migrated;
    report.outputs = outputs;
    report.ok = true;
  } catch (e) {
    report.error = e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e);
  }
  return report;
}
