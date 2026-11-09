// SWD freeze (user 2026-11-05): proof that a Shear Wall Design item not linked to Diaphragm Analysis looks and
// calculates exactly as before a change. One fingerprint per item = SHA-256 of each thing the page shows when the item
// is opened: migrated definition, results, results page, form, PDF sections, and for every line the interactive
// elevation (without / with results) and both PDF elevations (forces / hardware). The CALC_VERSION and schema stamps are
// masked so a version bump alone does not count as a change.
import crypto from 'crypto';
import { parseHTML } from 'linkedom';

if (!globalThis.document) {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  globalThis.window = window;
  globalThis.document = document;
  globalThis.Node = window.Node;
}

const { shearWallDesign } = await import('../../src/modules/shearWallDesign.js');
const { CALC_VERSION } = await import('../../src/modules/shearWallCalc.js');
const { renderElevation, renderElevationForPdf, setElevationPlan, setElevationTransfer } = await import('../../src/modules/shearWallElevation.js');
const { transferOn, endsAtFloorIds } = await import('../../src/modules/shearWallCalc.js');
// the grid-link layer is attached the way the form / PDF do (null for an item that did not adopt the plan grids)
const { planViewOf } = await import('../../src/modules/shearWallPlanLink.js');

const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const clone = v => JSON.parse(JSON.stringify(v));
// stamps that legitimately change with a version bump
const mask = s => s.split(CALC_VERSION).join('<CALC>');
const stripStamps = v => {
  if (Array.isArray(v)) return v.map(stripStamps);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) if (k !== 'schemaVersion' && k !== 'calcVersion') o[k] = stripStamps(v[k]);
    return o;
  }
  return v;
};
const json = v => mask(JSON.stringify(stripStamps(v)));

// item = { schemaVersion, inputs } as stored. Returns { parts: { name: hash } } or { error }.
export function fingerprint(item) {
  const parts = {};
  try {
    const migrated = shearWallDesign.migrate({ schemaVersion: item.schemaVersion, inputs: clone(item.inputs) });
    const inputs = migrated.inputs;
    parts.definition = sha(json(inputs));
    const outputs = shearWallDesign.calc(clone(inputs));
    parts.results = sha(json(outputs));

    const form = document.createElement('div');
    shearWallDesign.renderForm(form, clone(inputs), () => {}, [], () => {});
    parts.form = sha(mask(form.innerHTML));
    const out = document.createElement('div');
    shearWallDesign.renderOutputs(out, outputs);
    parts.resultsPage = sha(mask(out.innerHTML));
    parts.pdf = sha(json(shearWallDesign.pdfSections(clone(inputs), outputs)));

    const outLines = (outputs.perDirection || []).flatMap(d => d.perLine || []);
    for (const line of (inputs.directions || []).flatMap(d => d.lines || [])) {
      const key = 'line ' + (line.name || line.id);
      const lineOut = outLines.find(l => l.lineId === line.id);
      const c = document.createElement('div');
      const ln = clone(line);
      setElevationPlan(ln, planViewOf(inputs, ln));
      setElevationTransfer(ln, transferOn(inputs) ? () => endsAtFloorIds(inputs, ln, inputs.levels || []) : null); // as the form does
      const h = renderElevation(c, ln, inputs.levels, inputs.wallDLTypes || [], {});
      h.drawSVG();
      // view controls (Expand, zoom — 2026-11-05) are left out: the drawing and the rest of the page are compared
      const view = () => { const x = c.cloneNode(true); x.querySelectorAll('[data-elevzoom], [data-elevview]').forEach(n => n.remove()); return mask(x.innerHTML); };
      parts[key + ' · elevation'] = sha(view());
      if (lineOut) {
        h.showResults(lineOut);
        parts[key + ' · elevation + results'] = sha(view());
        for (const mode of ['forces', 'hardware'])
          parts[key + ' · PDF ' + mode] = sha(mask(renderElevationForPdf(ln, inputs.levels, inputs.wallDLTypes || [], lineOut, 500, mode).outerHTML));
      }
      h.destroy();
    }
  } catch (e) {
    return { error: String(e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e) };
  }
  return { parts };
}

// Differences between a stored and a new set of fingerprints: [{ item, part, was, now }]
export function compare(before, after) {
  const diffs = [];
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[name], b = after[name];
    if (!a || !b) { diffs.push({ item: name, part: '(item)', was: a ? 'present' : 'missing', now: b ? 'present' : 'missing' }); continue; }
    if (a.error || b.error) { if (a.error !== b.error) diffs.push({ item: name, part: '(error)', was: a.error || 'ok', now: b.error || 'ok' }); continue; }
    for (const p of new Set([...Object.keys(a.parts), ...Object.keys(b.parts)]))
      if (a.parts[p] !== b.parts[p]) diffs.push({ item: name, part: p, was: a.parts[p] || '—', now: b.parts[p] || '—' });
  }
  return diffs;
}
