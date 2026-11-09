// Shared grid lines between Diaphragm Analysis items (user 2026-11-05, comment 1; pure, no DOM).
// One DA item of the project owns the grids (its own grid page, edited with the plan editor). Another DA item may use
// them: inputs.refs.gridSource = the owner's item id. Its grids are then a copy kept in step with the owner through the
// usual update notice (linkDiff / applyLinks). Grids are matched by axis + name, so a grid keeps its id in the copy and
// every diaphragm, TD, wall and overhang that points to it keeps working. A grid of the copy that the owner does not
// have stays (it may be in use) and is reported (grid-local); one the owner added is added.
import { newGrid } from './tdModel.js';

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const s = v => (v === null || v === undefined ? '' : String(v).trim());
const numEq = (a, b) => (s(a) === '' && s(b) === '') || (s(a) !== '' && s(b) !== '' && Math.abs(Number(a) - Number(b)) < 1e-6);
const FIELDS = ['at', 'from', 'to'];

// The owner's grids as the ref extract gives them
export function sharedGrids(inputs) {
  return (inputs && Array.isArray(inputs.grids) ? inputs.grids : []).filter(g => g && s(g.name))
    .map(g => ({ name: s(g.name), axis: g.axis === 'y' ? 'y' : 'x', at: s(g.at), from: s(g.from), to: s(g.to), ref: !!g.ref }));
}

const find = (list, g) => list.find(x => (x.axis === 'y' ? 'y' : 'x') === g.axis && same(x.name, g.name));
const label = g => 'Grid ' + g.name + ' (' + (g.axis === 'x' ? '↕' : '↔') + ')';

// Differences from the owner: [{ label, from, to }] (update notice rows)
export function gridShareDiff(inputs, owner) {
  const out = [];
  if (!owner || !Array.isArray(owner.grids)) return out;
  const mine = inputs.grids || [];
  for (const g of owner.grids) {
    const m = find(mine, g);
    if (!m) { out.push({ label: label(g), from: '(missing here)', to: (g.axis === 'x' ? 'x = ' : 'y = ') + g.at }); continue; }
    for (const k of FIELDS) if (!numEq(m[k], g[k])) out.push({ label: label(g) + ' ' + (k === 'at' ? 'position' : k === 'from' ? 'start' : 'end'), from: s(m[k]) || '—', to: g[k] || '—' });
    if (!!m.ref !== g.ref) out.push({ label: label(g) + ' ref only', from: String(!!m.ref), to: String(g.ref) });
  }
  return out;
}

// Make the copy equal to the owner (ids kept; owner grids added; local-only grids kept)
export function applyGridShare(inputs, owner) {
  if (!owner || !Array.isArray(owner.grids)) return inputs;
  if (!Array.isArray(inputs.grids)) inputs.grids = [];
  for (const g of owner.grids) {
    let m = find(inputs.grids, g);
    if (!m) { m = newGrid(g.name, g.axis, g.at); inputs.grids.push(m); }
    m.name = g.name; m.at = g.at; m.from = g.from; m.to = g.to; m.ref = g.ref;
  }
  return inputs;
}

// Grids of this item that the owner does not have
export function localOnlyGrids(inputs, owner) {
  if (!owner || !Array.isArray(owner.grids)) return [];
  return (inputs.grids || []).filter(g => s(g.name) && !find(owner.grids, { axis: g.axis === 'y' ? 'y' : 'x', name: g.name })).map(g => g.name);
}
