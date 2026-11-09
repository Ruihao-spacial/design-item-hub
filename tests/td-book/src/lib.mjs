// Book example sources (FORMAT.md): loading, key parsing and validation. Shared by build, doc and tests.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SRC_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
export const OUT_DIR = path.resolve(SRC_DIR, '..');

export async function loadSources(ids) {
  const files = fs.readdirSync(SRC_DIR).filter(f => /^Ex\d+\.\d+\.mjs$/.test(f)).sort(byExample);
  const out = [];
  for (const f of files) {
    const mod = (await import(pathToFileURL(path.join(SRC_DIR, f)).href)).default;
    if (!ids || !ids.length || ids.includes(mod.id)) out.push(mod);
  }
  return out;
}

function byExample(a, b) {
  const n = s => s.match(/\d+/g).map(Number);
  const [a1, a2] = n(a), [b1, b2] = n(b);
  return a1 - b1 || a2 - b2;
}

// 'vnet:3+:A-B' → { kind: 'vnet', parts: ['3+', 'A-B'] }; station 'B+' → { at: 'B', side: '+' }
export function parseKey(k) {
  const [kind, ...parts] = k.split(':');
  return { kind, parts };
}
export function parseStation(s) {
  const m = /^(.*?)([+-])?$/.exec(s);
  return { at: m[1], side: m[2] || '' };
}

// number of key parts per kind ([min, max])
const KINDS = {
  R: [1, 1], Rw: [1, 1], vw: [1, 1], V: [1, 2], vb: [2, 2], Nb: [2, 2], tdP: [2, 2], tdR: [2, 2], vtd: [2, 2],
  vnet: [2, 2], N: [2, 2], Nmax: [2, 2], aspect: [1, 1],
};

// Unit-shear kinds follow the "+" sheathing element; the tool uses the Ex 4.1 element (FORMAT.md, Signs)
export const SHEAR_KINDS = new Set(['vb', 'vtd', 'vnet', 'vw']);
export function toolValue(src, e) {
  return src.shearElement === 'mirrored' && SHEAR_KINDS.has(parseKey(e.k).kind) ? -e.v : e.v;
}

// Errors in a source: shape, unknown grids, non-rectilinear outline, bad phase. Returns a list of strings.
export function validate(src) {
  const err = [];
  const L = src.layout || {};
  const grids = new Map((L.grids || []).map(g => [g.name, g]));
  const tds = new Set((L.tds || []).map(t => t.mark));
  const walls = new Set((L.walls || []).map(w => w.mark));
  const lines = new Set((L.walls || []).map(w => w.line));
  if (!src.id || !src.pdf || !src.pages) err.push('id / pdf / pages missing');
  for (const g of L.grids || []) {
    if (g.axis !== 'x' && g.axis !== 'y') err.push(`grid ${g.name}: axis must be x or y`);
    if (typeof g.at !== 'number') err.push(`grid ${g.name}: at must be a number`);
  }
  const o = L.outline || [];
  if (o.length < 4) err.push('outline needs 4+ corners');
  for (let i = 0; i < o.length; i++) {
    const a = o[i], b = o[(i + 1) % o.length];
    if (a[0] !== b[0] && a[1] !== b[1]) err.push(`outline edge ${i} is not orthogonal`);
  }
  const isStation = s => {
    const { at } = parseStation(s);
    return at === '*' || grids.has(at) || /^[xy]=-?\d+(\.\d+)?$/.test(at);
  };
  const isBand = s => s === '*' || s.split('-').every(g => grids.has(g));
  const entries = [...(src.expected || []).map(e => ['expected', e]), ...(src.expectedNonClosing || []).map(e => ['expectedNonClosing', e])];
  if (src.shearElement && src.shearElement !== 'mirrored') err.push('shearElement must be "mirrored" or absent');
  const seen = new Set();
  for (const [list, e] of entries) {
    const where = `${list} ${e.k}`;
    if (seen.has(list + e.k)) err.push(`${where}: duplicate key`);
    seen.add(list + e.k);
    if (typeof e.v !== 'number') err.push(`${where}: v must be a number`);
    if (![4, 5, 6, 7].includes(e.phase)) err.push(`${where}: phase must be 4-7`);
    if (typeof e.page !== 'number') err.push(`${where}: page must be a number`);
    const { kind, parts } = parseKey(e.k);
    if (!(kind in KINDS)) { err.push(`${where}: unknown kind ${kind}`); continue; }
    const [lo, hi] = KINDS[kind];
    if (parts.length < lo || parts.length > hi) { err.push(`${where}: ${kind} takes ${lo === hi ? lo : lo + '-' + hi} part(s)`); continue; }
    if (kind === 'R' && !lines.has(parts[0]) && !grids.has(parts[0])) err.push(`${where}: unknown wall line`);
    if ((kind === 'Rw' || kind === 'vw') && !walls.has(parts[0])) err.push(`${where}: unknown wall`);
    if (kind === 'V' && (!isStation(parts[0]) || (parts[1] && !isBand(parts[1])))) err.push(`${where}: bad station / band`);
    if ((kind === 'vb' || kind === 'vnet') && (!isStation(parts[0]) || !isBand(parts[1]))) err.push(`${where}: bad station / band`);
    if ((kind === 'tdR' || kind === 'tdP' || kind === 'vtd' || kind === 'aspect') && !tds.has(parts[0])) err.push(`${where}: unknown TD`);
    if ((kind === 'tdR' || kind === 'tdP') && !grids.has(parts[1])) err.push(`${where}: unknown grid`);
    if (kind === 'vtd' && !isBand(parts[1])) err.push(`${where}: bad band`);
    if ((kind === 'N' || kind === 'Nb') && (!grids.has(parts[0]) || !isStation(parts[1]))) err.push(`${where}: bad line / station`);
    if (kind === 'Nmax' && (!grids.has(parts[0]) || !isBand(parts[1]))) err.push(`${where}: bad line / run`);
  }
  for (const l of L.loads || []) {
    if (l.edge !== undefined && !grids.has(l.edge)) err.push(`load: unknown edge grid ${l.edge}`);
  }
  for (const t of L.tds || []) {
    for (const s of t.supports || []) if (!grids.has(s)) err.push(`td ${t.mark}: unknown support ${s}`);
    for (const l of t.loads || []) if (!grids.has(l.grid)) err.push(`td ${t.mark}: unknown load grid ${l.grid}`);
  }
  return err;
}

// Sheathed area: outline (shoelace) minus openings
export function sheathedArea(L) {
  const o = L.outline;
  let a = 0;
  for (let i = 0; i < o.length; i++) {
    const [x1, y1] = o[i], [x2, y2] = o[(i + 1) % o.length];
    a += x1 * y2 - x2 * y1;
  }
  const open = (L.openings || []).reduce((s, op) => s + (op.x[1] - op.x[0]) * (op.y[1] - op.y[0]), 0);
  return Math.abs(a) / 2 - open;
}
