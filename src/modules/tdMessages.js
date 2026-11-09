// Diaphragm Analysis — plan messages (user 2026-11-06): errors and warnings grouped by type, numbered (E1… / W1…),
// shown under the interactive plan. groupMessages is pure (tested); renderMessages draws the groups.
import { el } from '../utils.js';

// [key, title, test on the message code]; first match wins, so the own group of grid-off-plan comes before "Grids"
const GROUPS = [
  ['grid-off-plan', 'Grids not on this plan', c => c === 'grid-off-plan'],
  ['grids', 'Grids', c => c.startsWith('grid-')],
  ['outline', 'Outline and openings', c => c.startsWith('outline-') || c.startsWith('opening-')],
  ['diaphragms', 'Diaphragms', c => c.startsWith('dg-')],
  ['tds', 'Transfer diaphragms', c => c === 'td' || c.startsWith('td-') || c === 'paused'],
  ['walls', 'Wall lines', c => c.startsWith('wall-') || c === 'line-no-wall' || c === 'line-part-no-wall' || c === 'group-no-path'],
  ['above', 'Walls of the story above', c => c.startsWith('above-')],
  ['swd', 'Shear Wall Design link', c => c.startsWith('link-') || c.startsWith('swd-')],
  ['loads', 'Loads', c => c.startsWith('load-') || c.startsWith('no-load-') || c === 'no-fx'],
];
const groupOf = code => GROUPS.find(g => g[2](String(code || ''))) || ['other', 'Other', null];

// → [{ key, title, kind, items: [{ n, msg, ref, code }] }]: errors first, then warnings; within a kind the groups keep
// the table order and the messages their order; numbers run through the groups (unique on the page)
export function groupMessages(errors = [], warnings = []) {
  const out = [];
  for (const [kind, list, pre] of [['error', errors, 'E'], ['warning', warnings, 'W']]) {
    const byKey = new Map();
    for (const m of list) {
      const [key, title] = groupOf(m.code);
      if (!byKey.has(key)) byKey.set(key, { key, title, kind, items: [] });
      byKey.get(key).items.push(m);
    }
    const order = [...GROUPS.map(g => g[0]), 'other'];
    let n = 0;
    for (const key of order) {
      const g = byKey.get(key);
      if (!g) continue;
      g.items = g.items.map(m => ({ n: pre + (++n), msg: m.msg, ref: m.ref, code: m.code }));
      out.push(g);
    }
  }
  return out;
}

// one <details> per group, open unless the user closed it (kept in state.msgCollapsed across redraws)
export function renderMessages(groups, state = {}) {
  if (!state.msgCollapsed) state.msgCollapsed = {};
  const box = el('div', { className: 'td-messages', style: { marginTop: '0.6rem', fontSize: '0.8rem' } });
  if (!groups.length) {
    box.appendChild(el('p', { style: { color: 'var(--pass)', margin: 0 } }, '✓ No plan errors or warnings.'));
    return box;
  }
  const nE = groups.filter(g => g.kind === 'error').reduce((s, g) => s + g.items.length, 0);
  const nW = groups.filter(g => g.kind === 'warning').reduce((s, g) => s + g.items.length, 0);
  box.appendChild(el('div', { className: 'section-header', style: { margin: '0 0 0.3rem' } },
    'Messages — ', el('span', { style: { color: nE ? 'var(--fail)' : 'var(--ink-tertiary)' } }, nE + ' error' + (nE === 1 ? '' : 's')),
    ' · ', el('span', { style: { color: nW ? 'var(--stale)' : 'var(--ink-tertiary)' } }, nW + ' warning' + (nW === 1 ? '' : 's'))));
  for (const g of groups) {
    const id = g.kind + ':' + g.key;
    const col = g.kind === 'error' ? 'var(--fail)' : 'var(--stale)';
    const d = el('details', { 'data-msg-group': id, style: { marginBottom: '0.35rem', borderLeft: '3px solid ' + col, paddingLeft: '6px' } });
    d.open = !state.msgCollapsed[id];
    d.appendChild(el('summary', { style: { cursor: 'pointer', color: col, fontWeight: 600 } },
      (g.kind === 'error' ? 'Error — ' : 'Warning — ') + g.title + ' (' + g.items.length + ')'));
    const list = el('div', { style: { marginTop: '2px' } });
    for (const m of g.items) list.appendChild(el('div', { 'data-msg': m.n, style: { display: 'flex', gap: '6px', margin: '1px 0' } },
      el('span', { className: 'mono', style: { color: col, minWidth: '2.6em', fontWeight: 600 } }, m.n),
      el('span', { style: { color: 'var(--ink)' } }, m.msg)));
    d.appendChild(list);
    d.addEventListener('toggle', () => { state.msgCollapsed[id] = !d.open; });
    box.appendChild(d);
  }
  return box;
}
