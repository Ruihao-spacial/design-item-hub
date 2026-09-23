import { el, clearEl, numOrBlank } from '../utils.js';
import { svgEl, newWall, newUniformLoad, newPointLoad, newBeam, newBeamSupport, newSupportPost } from './shearWallTypes.js';
import { NAILING_TABLE } from './shearWallNailing.js';
import { HDUE_TABLE, MSTC_TABLE, POST_SIZES, getGradeById } from './shearWallHardware.js';
import { findAnchorage, findPost } from './shearWallCalc.js';

const GUTTER = 80;
const RULER_H = 24;
const MIN_LEVEL_H = 60;
const MIN_LEVEL_H_HW = 120;
const MIN_PX_PER_FT = 6;
const ANNOT_STRIP_H = 44;
// 44px T/C strip rows: P (this element only) on top, then tension / compression (or Σ) rows — clears a beam on the floor line
const P_ROW_DY = 10;
const T_ROW_DY = 20;
const C_ROW_DY = 31;
const REACT_ROW_H = 26;
const HW_ROW_H = 26;
const Y_MULT_DEFAULT = 4;
const Y_MULT_HARDWARE = 10;
const WALL_MARGIN = 1;
const HW_EDGE_ZONE_W = 34;
const HW_COL_INSET_1 = 9;
const HW_COL_INSET_2 = 25;
const HW_MIN_WIDTH = 80;
const WALL_COLOR = 'var(--accent)';
const WALL_SELECTED = '#2563eb';
const TENSION_COLOR = '#dc2626';
const COMPR_COLOR = '#2563eb';
const SIGMA_COLOR = '#9333ea'; // Σ marker = includes loads from above
const BEAM_H = 8;
const BEAM_COLOR = '#7c3aed';
const SUPPORT_SIZE = 8;
const WARN_COLOR = '#dc2626';
const POS_TOL = 0.1;

// Colors for the shared beam/post layer — live view uses theme tokens, PDF uses fixed light-theme hex
const LIVE_PALETTE = {
  surface: 'var(--surface)', ink: 'var(--ink)', inkSecondary: 'var(--ink-secondary)',
  beam: BEAM_COLOR, post: BEAM_COLOR, selected: WALL_SELECTED, warn: WARN_COLOR,
  pass: 'var(--pass)', stale: 'var(--stale)', fail: 'var(--fail)',
  source: '#f59e0b', receiver: '#16a34a',
  tension: TENSION_COLOR, compression: COMPR_COLOR,
  bandFill: 'var(--surface)', bandOpacity: 0.5, bandLine: 'var(--border)', rowLabel: 'var(--ink-tertiary)',
};
const PDF_COLORS = {
  accent: '#2563eb', accentBg: 'rgba(37,99,235,0.1)',
  border: '#d1d5db', borderLight: '#e5e7eb',
  surface: '#ffffff', ink: '#1a2233',
  inkSecondary: '#6b7280', inkTertiary: '#9ca3af',
  pass: '#22c55e', fail: '#dc2626', stale: '#eab308',
  beam: '#7c3aed', post: '#7c3aed',
  tension: '#dc2626', compression: '#2563eb',
};
const PDF_PALETTE = {
  surface: PDF_COLORS.surface, ink: PDF_COLORS.ink, inkSecondary: PDF_COLORS.inkSecondary,
  beam: PDF_COLORS.beam, post: PDF_COLORS.post, selected: WALL_SELECTED, warn: WARN_COLOR,
  pass: '#15803d', stale: '#b45309', fail: '#dc2626',
  source: '#f59e0b', receiver: '#16a34a',
  tension: PDF_COLORS.tension, compression: PDF_COLORS.compression,
  bandFill: '#f3f4f6', bandOpacity: 0.8, bandLine: PDF_COLORS.borderLight, rowLabel: PDF_COLORS.inkTertiary,
};

function num(v) { return parseFloat(v) || 0; }

// Estimated box of an SVG text label (pad = extra px around the glyphs)
export function textBox(attrs, text, pad) {
  const p = pad || 0;
  const fs = parseFloat(attrs['font-size']) || 9;
  const w = String(text).length * fs * 0.62 + 2 * p;
  const h = fs + 2 + 2 * p;
  const anchor = attrs['text-anchor'] || 'start';
  const x = anchor === 'middle' ? attrs.x - w / 2 : anchor === 'end' ? attrs.x - w + p : attrs.x - p;
  const y = attrs['dominant-baseline'] === 'middle' ? attrs.y - h / 2 : attrs.y - fs - p;
  return { x, y, w, h };
}
function textW(text, fs) { return String(text).length * fs * 0.62; }

// Invisible hover box around a label; the live view shows its data-tip in a tooltip
function tipBox(attrs, text, tip) {
  const b = textBox(attrs, text, 3);
  return svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h + 2, fill: 'transparent', 'data-tip': tip, style: { cursor: 'help' } });
}

// Keeps labels from overlapping: reserve() fixed boxes, place() takes the first candidate
// group ([{ attrs, text }]) whose boxes are all free (and inside bounds.minX…maxX), or null.
function createLabelPlacer(bounds) {
  const boxes = [];
  const inside = (b) => !bounds || (b.x >= bounds.minX - 1 && b.x + b.w <= bounds.maxX + 1);
  // 1px tolerance: the width estimates already run wide, and labels may touch
  const hit = (b) => boxes.some(o => b.x < o.x + o.w - 1 && o.x < b.x + b.w - 1 && b.y < o.y + o.h - 1 && o.y < b.y + b.h - 1);
  return {
    reserve(b) { boxes.push(b); },
    reserveText(attrs, text) { boxes.push(textBox(attrs, text)); },
    place(candidates) {
      for (const c of candidates) {
        const bs = c.map(it => textBox(it.attrs, it.text));
        if (bs.every(b => inside(b) && !hit(b))) { boxes.push(...bs); return c; }
      }
      return null;
    },
    boxes,
  };
}

// White in-wall text with a dark halo (readable on any wall fill)
function wallText(attrs, text) {
  const g = svgEl('g', { 'pointer-events': 'none' });
  g.appendChild(svgEl('text', { ...attrs, stroke: 'rgba(0,0,0,0.55)', 'stroke-width': '3', 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, text));
  return g;
}

// D/C pill: DCR-coloured rect with dark text
function dcPill(cx, cy, dc, fs) {
  const txt = 'D/C ' + (dc != null ? dc.toFixed(2) : '—');
  const w = textW(txt, fs) + 8, h = fs + 5;
  const fill = dc == null ? '#9ca3af' : dc > 1.0 ? '#f87171' : dc >= 0.8 ? '#facc15' : '#4ade80';
  const g = svgEl('g', { 'pointer-events': 'none' });
  g.appendChild(svgEl('rect', { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx: h / 2, fill, stroke: 'rgba(0,0,0,0.35)', 'stroke-width': 0.5 }));
  g.appendChild(svgEl('text', { x: cx, y: cy + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#0b1220', 'font-size': String(fs), 'font-weight': '700' }, txt));
  return { g, box: { x: cx - w / 2, y: cy - h / 2, w, h } };
}

// tip: optional hover tooltip text
function haloText(attrs, text, surface, tip) {
  const bg = surface || 'var(--surface)';
  const g = svgEl('g');
  g.appendChild(svgEl('text', { ...attrs, stroke: bg, 'stroke-width': '2.5', 'paint-order': 'stroke', fill: bg, 'pointer-events': 'none' }, text));
  g.appendChild(svgEl('text', { ...attrs, 'pointer-events': 'none' }, text));
  if (tip) g.appendChild(tipBox(attrs, text, tip));
  return g;
}

function comboName(combo) { return !combo || combo === 'governing' ? 'ASD envelope' : combo; }
// P row parts: grey 'P', red ▲ tension, blue ▼ compression
function pParts(t, c, P) {
  const parts = [{ t: 'P', fill: P.inkSecondary }];
  if (t > 0) parts.push({ t: ' ▲' + t.toFixed(2), fill: P.tension });
  if (c > 0) parts.push({ t: ' ▼' + c.toFixed(2), fill: P.compression });
  parts.push({ t: t > 0 || c > 0 ? 'k' : ' 0', fill: P.inkSecondary });
  return parts;
}
function partsText(parts) { return parts.map(p => p.t).join(''); }

// Halo text built from coloured tspans (tip: optional hover tooltip)
function richHaloText(attrs, parts, surface, tip) {
  const bg = surface || 'var(--surface)';
  const g = svgEl('g');
  g.appendChild(svgEl('text', { ...attrs, stroke: bg, 'stroke-width': '2.5', 'paint-order': 'stroke', fill: bg, 'pointer-events': 'none' }, partsText(parts)));
  const t = svgEl('text', { ...attrs, 'pointer-events': 'none' });
  parts.forEach(p => t.appendChild(svgEl('tspan', { fill: p.fill }, p.t)));
  g.appendChild(t);
  if (tip) g.appendChild(tipBox(attrs, partsText(parts), tip));
  return g;
}

function entriesText(entries, prefix) {
  if (!entries.length) return prefix + ' 0';
  return prefix + ' ' + entries.map(en => (en.kind === 'T' ? '▲' : '▼') + en.val.toFixed(2)).join(' ') + 'k';
}

// === Shared layout ===
// Walls run floor line to floor line; label bands overlay them (only where needed):
//   top band    — reactions + support hardware of the beam on the floor line above (story above has a beam)
//   body        — wall mark / nailing / D/C / edge strips
//   bottom band — T/C strip (story has walls or post bases), post-base hardware row
// A beam on the bottom story puts its reaction / hardware rows in a foundation band below the last floor line.

export function computeElevationLayout(line, levels, opts) {
  const o = opts || {};
  const showForces = o.showForces != null ? !!o.showForces : !!o.overlays;
  const showHW = o.showHW != null ? !!o.showHW : !!o.overlays;
  const anyOverlay = showForces || showHW;
  const totalLen = parseFloat(line.totalLength) || 60;
  const targetW = o.width || 600;
  const drawW = targetW - GUTTER - 20;
  const pxPerFt = Math.max(drawW / totalLen, MIN_PX_PER_FT);
  const svgW = GUTTER + totalLen * pxPerFt + 20;
  const yMult = anyOverlay ? Y_MULT_HARDWARE : Y_MULT_DEFAULT;
  const minLvlH = anyOverlay ? MIN_LEVEL_H_HW : MIN_LEVEL_H;
  const walls = line.walls || [];
  const beams = line.beams || [];
  const posts = line.supportPosts || [];
  const hasBeamOn = (lvl) => !!lvl && beams.some(b => b.levelId === lvl.id);

  let totalH = RULER_H + 10;
  const levelYs = [];
  levels.forEach((lvl, i) => {
    const ftH = parseFloat(lvl.floorToFloor) || 10;
    const basePx = Math.max(ftH * yMult, minLvlH);
    const beamAbove = i > 0 && hasBeamOn(levels[i - 1]);
    const hasWall = walls.some(w => w.levelId === lvl.id);
    const hasPostBase = posts.some(p => p.levelId === lvl.id);
    const topReactH = showForces && beamAbove ? REACT_ROW_H : 0;
    const topHwH = showHW && beamAbove ? HW_ROW_H : 0;
    const topBandH = topReactH + topHwH;
    const forceStripH = showForces && (hasWall || hasPostBase) ? ANNOT_STRIP_H : 0;
    const postHwH = showHW && hasPostBase ? HW_ROW_H : 0;
    const y = totalH;
    const bodyY = y + topBandH;
    const forceStripY = bodyY + basePx;
    const postHwY = forceStripY + forceStripH;
    const h = topBandH + basePx + forceStripH + postHwH;
    levelYs.push({
      id: lvl.id, name: lvl.name, y, h, ftH, basePx,
      topBandH, topReactH, topReactY: y, topHwH, topHwY: y + topReactH,
      bodyY, bodyH: basePx, forceStripH, forceStripY, postHwH, postHwY,
      bottomBandH: forceStripH + postHwH, floorY: y + h,
    });
    totalH += h;
  });
  let fdnBand = null;
  if (hasBeamOn(levels[levels.length - 1])) {
    const reactH = showForces ? REACT_ROW_H : 0;
    const hwH = showHW ? HW_ROW_H : 0;
    if (reactH + hwH) fdnBand = { y: totalH, reactH, reactY: totalH, hwH, hwY: totalH + reactH, h: reactH + hwH };
    if (fdnBand) totalH += fdnBand.h;
  }
  totalH += 10;
  return { totalLen, pxPerFt, svgW, totalH, levelYs, fdnBand, showForces, showHW };
}

// Beam bottom sits on its story's floor line
function beamYOf(lv) { return lv.floorY - BEAM_H; }

// Band a beam on story li labels into: top band of the story below, or the foundation band
function beamLabelBand(layout, li) {
  const below = layout.levelYs[li + 1];
  if (below) return below.topBandH ? { reactY: below.topReactY, reactH: below.topReactH, hwY: below.topHwY, hwH: below.topHwH } : null;
  const f = layout.fdnBand;
  return f ? { reactY: f.reactY, reactH: f.reactH, hwY: f.hwY, hwH: f.hwH } : null;
}

// Wall rect: floor line to floor line, ending at the beam top when a beam carries the whole wall
function wallRectOf(w, lv, beams, pxPerFt) {
  const ws = num(w.position), we = ws + num(w.length);
  const onBeam = beams.some(b => b.levelId === w.levelId && num(b.position) <= ws + POS_TOL && num(b.position) + num(b.length) >= we - POS_TOL);
  const y = lv.y + WALL_MARGIN;
  const bottom = onBeam ? beamYOf(lv) : lv.floorY - WALL_MARGIN;
  return { x: GUTTER + ws * pxPerFt, y, w: num(w.length) * pxPerFt, h: bottom - y, bottom, onBeam };
}

// Body zone of a wall (text + edge strips), clear of the label bands
function wallBodyOf(lv) { return { y: lv.bodyY + WALL_MARGIN, h: lv.bodyH - 2 * WALL_MARGIN }; }

// Full-width band backdrops + gutter row labels (drawn before walls)
function drawBandBackdrops(svg, layout, C) {
  const { totalLen, pxPerFt, levelYs, fdnBand } = layout;
  const x = GUTTER, w = totalLen * pxPerFt;
  const band = (y, h) => {
    if (!h) return;
    svg.appendChild(svgEl('rect', { x, y, width: w, height: h, fill: C.bandFill, opacity: C.bandOpacity, 'pointer-events': 'none' }));
  };
  const sep = (y) => svg.appendChild(svgEl('line', { x1: x, y1: y, x2: x + w, y2: y, stroke: C.bandLine, 'stroke-width': 0.5, 'stroke-dasharray': '4,4', 'pointer-events': 'none' }));
  const rowLabel = (y, h, text) => {
    if (!h) return;
    svg.appendChild(svgEl('text', { x: GUTTER - 6, y: y + h / 2, 'text-anchor': 'end', 'dominant-baseline': 'middle', fill: C.rowLabel, 'font-size': '8', 'pointer-events': 'none' }, text));
  };
  for (const lv of levelYs) {
    band(lv.y, lv.topBandH);
    if (lv.topBandH) sep(lv.bodyY);
    band(lv.forceStripY, lv.bottomBandH);
    if (lv.bottomBandH) sep(lv.forceStripY);
    rowLabel(lv.topReactY, lv.topReactH, 'React.');
    rowLabel(lv.topHwY, lv.topHwH, 'HW');
    rowLabel(lv.forceStripY, lv.forceStripH, 'T/C');
    rowLabel(lv.postHwY, lv.postHwH, 'HW');
  }
  if (fdnBand) {
    band(fdnBand.y, fdnBand.h);
    rowLabel(fdnBand.reactY, fdnBand.reactH, 'React.');
    rowLabel(fdnBand.hwY, fdnBand.hwH, 'HW');
  }
}

// Per-wall scrim over the label bands, so labels read while the wall visibly continues to the floor
function drawWallBandScrim(svg, r, lv, fill) {
  const add = (y1, y2) => {
    const top = Math.max(y1, r.y + 1), bot = Math.min(y2, r.bottom - 1);
    if (bot - top < 1) return;
    svg.appendChild(svgEl('rect', { x: r.x + 1, y: top, width: Math.max(r.w - 2, 1), height: bot - top, fill, opacity: 0.55, 'pointer-events': 'none' }));
  };
  if (lv.topBandH) add(lv.y, lv.bodyY);
  if (lv.bottomBandH) add(lv.forceStripY, lv.floorY);
}

function beamSpanAt(beams, levelId, pos) {
  return beams.find(b => {
    if (b.levelId !== levelId) return false;
    const bs = num(b.position), be = bs + num(b.length);
    return pos >= bs - POS_TOL && pos <= be + POS_TOL;
  });
}

function postGeom(p, S) {
  const { layout, line, levels } = S;
  const li = levels.findIndex(l => l.id === p.levelId);
  const lv = layout.levelYs[li];
  if (!lv) return null;
  const pos = num(p.position);
  const x = GUTTER + pos * layout.pxPerFt;
  // Top = floor line above (a beam above sits on it); bottom = the beam it stands on, else the floor line
  const bHere = beamSpanAt(line.beams || [], p.levelId, pos);
  const y1 = lv.y;
  const y2 = bHere ? beamYOf(lv) : lv.floorY;
  const insideWall = (line.walls || []).some(w => w.levelId === p.levelId
    && pos > num(w.position) + POS_TOL && pos < num(w.position) + num(w.length) - POS_TOL);
  return { x, y1, y2, lv, li, onBeam: !!bHere, insideWall, isFoundation: !bHere && li === levels.length - 1 };
}

// Force entries to display for a signed per-combo map (+ = compression)
function forceEntries(map, envT, envC, combo) {
  if (!combo || combo === 'governing') {
    const out = [];
    if (envT > 0) out.push({ kind: 'T', val: envT });
    if (envC > 0) out.push({ kind: 'C', val: envC });
    return out;
  }
  const v = map ? map[combo] : null;
  if (v == null || Math.abs(v) < 0.005) return [];
  return [v < 0 ? { kind: 'T', val: -v } : { kind: 'C', val: v }];
}

function dcInk(dc, P) {
  if (dc == null) return P.inkSecondary;
  if (dc > 1.0) return P.fail;
  if (dc >= 0.8) return P.stale;
  return P.pass;
}

function receiverText(rec) {
  if (!rec) return '';
  if (rec.type === 'foundation') return '→ Fdn';
  if (rec.type === 'reported') return 'reaction only';
  if (rec.type === 'wall_mid') return rec.label.replace('Bears on ', 'bears on ');
  if (rec.type === 'none') return rec.label;
  return '→ ' + rec.label;
}

function anchorageText(item) {
  const connection = item.receiver && ['beam', 'post', 'wall_end', 'foundation'].includes(item.receiver.type);
  if (!connection) return { text: '—', color: null };
  if (!item.anchorage) return { text: 'OVER', color: 'fail' };
  return { text: item.anchorage.id + (item.anchorageDC != null ? ' ' + item.anchorageDC.toFixed(2) : ''), dc: item.anchorageDC };
}

// Shared beam / post layer (live + PDF). S: { svg, layout, line, levels, results, combo, P, sel, handlers, placer }
// Geometry first, then labels in priority order: post Σ/P → beam reactions → hardware rows → post mark/size.
function drawTransferElements(S) {
  const { svg, layout, line, levels, results, combo, P } = S;
  const { pxPerFt, levelYs } = layout;
  const beams = line.beams || [];
  const posts = line.supportPosts || [];
  const walls = line.walls || [];
  const sel = S.sel || {};
  const H = S.handlers || null;
  const L = S.placer || createLabelPlacer();
  const btMap = {}, ppMap = {};
  if (results) {
    (results.beamTransfers || []).forEach(bt => { btMap[bt.beamId] = bt; });
    (results.postPaths || []).forEach(pp => { ppMap[pp.postId] = pp; });
  }

  const tipDot = (x, y, tip, edit) => {
    const g = svgEl('g');
    g.appendChild(svgEl('circle', { cx: x, cy: y, r: 3, fill: P.surface, stroke: P.inkSecondary, 'stroke-width': 1.2, 'pointer-events': 'none' }));
    g.appendChild(svgEl('circle', { cx: x, cy: y, r: 6, fill: 'transparent', 'data-tip': tip, 'data-edit': edit || null, style: { cursor: edit ? 'pointer' : 'help' } }));
    svg.appendChild(g);
  };
  // Draws the first free candidate group, else the first free reduced group (first lines only);
  // if neither fits: a hover dot with the full text (live) or the reduced group anyway (PDF)
  const markEdit = (node, edit) => {
    if (!H || !edit || !node) return;
    const r = node.lastChild;
    if (r && r.tagName && r.tagName.toLowerCase() === 'rect') { r.setAttribute('data-edit', edit); r.style.cursor = 'pointer'; }
  };
  const drawItem = (it, fallbackTip) => {
    const tip = it.tip || fallbackTip;
    const node = it.parts ? richHaloText(it.attrs, it.parts, P.surface, tip) : haloText(it.attrs, it.text, P.surface, tip);
    svg.appendChild(node);
    markEdit(node, it.edit);
  };
  const MANUAL = H ? ' ✎' : ' *'; // manual-override marker (PDF uses *)
  const clickHint = H ? ' · click to change' : '';
  const kip = (v) => (v || 0).toFixed(2) + 'k';
  const placeGroup = (cands, dotAt, keep) => {
    const reduced = keep && keep < cands[0].length ? cands.map(c => c.slice(0, keep)) : null;
    let chosen = L.place(cands) || (reduced && L.place(reduced));
    if (!chosen && reduced && !H) { chosen = reduced[0]; chosen.forEach(it => L.reserveText(it.attrs, it.text)); }
    if (!chosen) {
      if (H) { tipDot(dotAt.x, dotAt.y, cands[0].map(it => it.text).join(' · ') + (cands[0][0].tip ? ' — ' + cands[0][0].tip : ''), cands[0][0].edit); return; }
      chosen = cands[0];
      chosen.forEach(it => L.reserveText(it.attrs, it.text));
    }
    chosen.forEach(it => drawItem(it));
  };
  // Same lines, anchored right of x (start) or left of x (end)
  const sides = (x, lines, preferEnd) => {
    const mk = (anchor) => lines.map(l => ({ ...l, attrs: { ...l.attrs, x: anchor === 'start' ? x + 6 : x - 6, 'text-anchor': anchor } }));
    return preferEnd ? [mk('end'), mk('start')] : [mk('start'), mk('end')];
  };

  // --- Posts (geometry) ---
  const postGeoms = [];
  for (const p of posts) {
    const g = postGeom(p, S);
    if (!g) continue;
    postGeoms.push({ p, g });
    const isSel = p.id === sel.postId;
    if (H) {
      svg.appendChild(svgEl('rect', {
        x: g.x - 6, y: g.y1, width: 12, height: Math.max(g.y2 - g.y1, 12),
        fill: 'transparent', style: { cursor: 'pointer' },
        onClick(e) { e.stopPropagation(); H.onPostClick(e, p); },
      }));
    }
    // Inside a wall footprint the post is a hidden (dashed) line
    const hidden = g.insideWall && !isSel;
    svg.appendChild(svgEl('line', {
      x1: g.x, y1: g.y1, x2: g.x, y2: g.y2,
      stroke: isSel ? P.selected : P.post, 'stroke-width': isSel ? 4 : hidden ? 1.5 : 2.5,
      'stroke-dasharray': hidden ? '4,3' : 'none', opacity: hidden ? 0.85 : 1, 'pointer-events': 'none',
    }));
    if (g.isFoundation) {
      svg.appendChild(svgEl('polygon', {
        points: [g.x, g.y2 - 5, g.x + 4, g.y2, g.x, g.y2 + 5, g.x - 4, g.y2].join(' '),
        fill: P.post, stroke: P.surface, 'stroke-width': 0.5, 'pointer-events': 'none',
      }));
    }
  }

  // --- Beams + user-defined supports (geometry) ---
  for (const b of beams) {
    const li = levels.findIndex(l => l.id === b.levelId);
    const lv = levelYs[li];
    if (!lv) continue;
    const bs = num(b.position), be = bs + num(b.length);
    const bx = GUTTER + bs * pxPerFt;
    const bw = Math.max((be - bs) * pxPerFt, 4);
    const by = beamYOf(lv);
    const isSel = b.id === sel.beamId;

    if (H) {
      svg.appendChild(svgEl('rect', {
        x: bx, y: by - 4, width: bw, height: BEAM_H + 8,
        fill: 'transparent', style: { cursor: 'pointer' },
        onClick(e) { e.stopPropagation(); H.onBeamClick(e, b); },
      }));
    }
    svg.appendChild(svgEl('rect', {
      x: bx, y: by, width: bw, height: BEAM_H,
      fill: P.beam, opacity: 0.95, stroke: isSel ? P.selected : P.beam,
      'stroke-width': isSel ? 2.5 : 0.5, rx: 1, 'pointer-events': 'none',
    }));
    if (bw > 30) {
      svg.appendChild(svgEl('text', {
        x: bx + bw / 2, y: by + BEAM_H / 2 + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
        fill: '#fff', 'font-size': '7', 'font-weight': '700', 'pointer-events': 'none',
      }, b.mark || 'BM'));
    }
    L.reserve({ x: bx, y: by, w: bw, h: BEAM_H });

    const sups = b.supports || [];
    for (const s of sups) {
      const sx = GUTTER + num(s.position) * pxPerFt;
      const top = by + BEAM_H; // = floor line; symbols hang just below it
      if (s.type === 'post') {
        svg.appendChild(svgEl('rect', { x: sx - SUPPORT_SIZE / 2, y: top, width: SUPPORT_SIZE, height: SUPPORT_SIZE - 1, fill: P.beam, 'pointer-events': 'none' }));
      } else {
        svg.appendChild(svgEl('polygon', {
          points: [sx - SUPPORT_SIZE / 2, top + SUPPORT_SIZE, sx + SUPPORT_SIZE / 2, top + SUPPORT_SIZE, sx, top].join(' '),
          fill: 'none', stroke: P.beam, 'stroke-width': 1.5, 'pointer-events': 'none',
        }));
      }
    }
    if (sups.length !== 2) {
      const a = { x: bx + bw / 2, y: by - 3, 'text-anchor': 'middle', fill: P.warn, 'font-size': '9', 'font-weight': '700' };
      const t = '⚠ ' + sups.length + '/2 supports';
      svg.appendChild(haloText(a, t, P.surface));
      L.reserveText(a, t);
    }
  }

  // --- Joint dots: filled = end lands on a wall end / post / beam; hollow red = needs a post / nothing below ---
  if (results && layout.showForces) {
    const dot = (x, y, ok, tip) => {
      const g = svgEl('g');
      g.appendChild(ok
        ? svgEl('circle', { cx: x, cy: y, r: 3, fill: P.ink, stroke: P.surface, 'stroke-width': 1, 'pointer-events': 'none' })
        : svgEl('circle', { cx: x, cy: y, r: 4, fill: P.surface, stroke: P.warn, 'stroke-width': 1.5, 'pointer-events': 'none' }));
      g.appendChild(svgEl('circle', { cx: x, cy: y, r: 7, fill: 'transparent', 'data-tip': tip, style: { cursor: 'help' } }));
      svg.appendChild(g);
    };
    const bad = (rec) => rec.type === 'none' || rec.type === 'wall_mid';
    const wallMark = {};
    walls.forEach(w => { wallMark[w.id] = w.mark || w.id; });
    for (const d of (results.wallDeliveries || [])) {
      if (d.receiver.type === 'foundation') continue;
      const lv = levelYs[levels.findIndex(l => l.id === d.levelId)];
      if (!lv) continue;
      dot(GUTTER + d.position * pxPerFt, d.receiver.type === 'beam' ? beamYOf(lv) : lv.floorY, !bad(d.receiver),
        (wallMark[d.wallId] || d.wallId) + ' ' + d.side + ' end → ' + receiverText(d.receiver) + (bad(d.receiver) ? ' — add a post below' : ''));
    }
    for (const { p, g } of postGeoms) {
      const pp = ppMap[p.id];
      if (!pp || pp.receiver.type === 'foundation') continue;
      dot(g.x, g.y2, !bad(pp.receiver), (p.mark || p.id) + ' base → ' + receiverText(pp.receiver));
    }
  }

  // --- Audit glyphs for beams and posts (before labels, so labels avoid them; one per spot) ---
  if (results && results.loadPathAudit) {
    const seen = new Set(), spots = new Set();
    const glyph = (x, y) => {
      const k = Math.round(x) + ':' + Math.round(y);
      if (spots.has(k)) return;
      spots.add(k);
      const a = { x, y, 'text-anchor': 'middle', fill: P.warn, 'font-size': '10', 'font-weight': '700' };
      svg.appendChild(haloText(a, '⚠', P.surface));
      L.reserveText(a, '⚠');
    };
    for (const w of results.loadPathAudit.warnings) {
      if (seen.has(w.elementId)) continue;
      const b = beams.find(bb => bb.id === w.elementId);
      if (b) {
        seen.add(w.elementId);
        if ((b.supports || []).length !== 2) continue; // already flagged on the beam
        const lv = levelYs[levels.findIndex(l => l.id === b.levelId)];
        if (lv) glyph(GUTTER + (num(b.position) + num(b.length) / 2) * pxPerFt, beamYOf(lv) - 3);
        continue;
      }
      const pg = postGeoms.find(x => x.p.id === w.elementId);
      if (pg) { seen.add(w.elementId); glyph(pg.g.x - 10, pg.g.y2 - 2); }
    }
  }

  // --- Labels ① post Σ / P in the T/C strip ---
  if (layout.showForces) {
    for (const { p, g } of postGeoms) {
      const pp = ppMap[p.id];
      if (!pp || !g.lv.forceStripH) continue;
      const entries = forceEntries(pp.perCombo, pp.envelopeT, pp.envelopeC, combo);
      const srcTip = (p.mark || p.id) + ' Σ (' + comboName(combo) + ') from: ' + (pp.sources.map(x => x.label).join(', ') || 'nothing above');
      const sigma = entries.map((en, i) => {
        const parts = [{ t: 'Σ', fill: SIGMA_COLOR }, { t: (en.kind === 'T' ? '▲' : '▼') + en.val.toFixed(2) + 'k', fill: en.kind === 'T' ? P.tension : P.compression }];
        return { attrs: { y: g.lv.forceStripY + T_ROW_DY + 1 + i * 11, fill: P.post, 'font-size': '9', 'font-weight': '700' }, text: partsText(parts), parts, tip: srcTip };
      });
      // P = load added at this level (not from a post above)
      const pe = forceEntries(pp.levelLoad, pp.levelLoadEnv.T, pp.levelLoadEnv.C, combo);
      const direct = pp.sources.filter(x => x.type !== 'post').map(x => x.label);
      const peT = (pe.find(e => e.kind === 'T') || {}).val || 0, peC = (pe.find(e => e.kind === 'C') || {}).val || 0;
      const pRowParts = pParts(peT, peC, P);
      const pLine = { attrs: { y: g.lv.forceStripY + P_ROW_DY, fill: P.inkSecondary, 'font-size': '8', 'font-weight': '600' }, text: partsText(pRowParts), parts: pRowParts,
        tip: (p.mark || p.id) + ' P = load added at this level' + (direct.length ? ' from ' + direct.join(', ') : ' (none)')
          + (pp.hasPostAbove ? ' — Σ minus the post above' : ' — equals Σ (no post above)') };
      // Reduced fallback keeps the Σ rows only
      const shown = pp.hasPostAbove ? sigma : []; // no post above → Σ = P, so P alone
      const cands = sides(g.x, [...shown, pLine]);
      // A lone P row may drop to the next row when the top row is taken by wall P labels
      if (!shown.length) cands.push(...sides(g.x, [{ ...pLine, attrs: { ...pLine.attrs, y: g.lv.forceStripY + T_ROW_DY + 1 } }]));
      placeGroup(cands, { x: g.x, y: g.lv.forceStripY + 3 }, shown.length || undefined);
    }
  }

  // --- Labels ② beam reactions (band below the beam's floor line) ---
  const hwItems = []; // { zoneY, srcLvId, x, anchor, line1, color1, line2, isSupport }
  for (const b of beams) {
    const li = levels.findIndex(l => l.id === b.levelId);
    const lv = levelYs[li];
    const bt = btMap[b.id];
    if (!lv || !bt) continue;
    const band = beamLabelBand(layout, li);
    const bs = num(b.position), be = bs + num(b.length);
    for (const sr of bt.supports) {
      const sx = GUTTER + sr.position * pxPerFt;
      const inward = sr.position - bs <= be - sr.position; // left support → labels to the right
      if (layout.showForces && band && band.reactH) {
        const entries = forceEntries(sr.perCombo, sr.envelopeT, sr.envelopeC, combo);
        const tip = (b.mark || b.id) + ' reaction at ' + sr.position.toFixed(2) + ' ft (' + (sr.type === 'post' ? 'Post' : 'Point') + ' support, ' + comboName(combo) + ') ' + receiverText(sr.receiver);
        const lines = entries.map((en, i) => {
          const parts = [{ t: 'R', fill: P.beam }, { t: (en.kind === 'T' ? '▲' : '▼') + en.val.toFixed(2) + 'k', fill: en.kind === 'T' ? P.tension : P.compression }];
          return { attrs: { y: band.reactY + 10 + i * 11, fill: P.beam, 'font-size': '9', 'font-weight': '700' }, text: partsText(parts), parts, tip };
        });
        if (lines.length) placeGroup(sides(sx, lines, !inward), { x: sx, y: band.reactY + 3 });
      }
      if (layout.showHW && band && band.hwH) {
        const a = anchorageText(sr);
        const sDef = (b.supports || []).find(x => x.id === sr.supportId) || {};
        const manual = !!sDef.anchorageOverride;
        hwItems.push({ zoneY: band.hwY, srcLvId: lv.id, x: sx, preferEnd: !inward,
          edit: 'support:' + b.id + ':' + sr.supportId,
          detail: (sr.anchorage ? ' · T ' + kip(sr.envelopeT) + ' / cap ' + kip(sr.anchorage.cap / 1000) : '') + (manual ? ' · manual override' : ' · auto') + clickHint,
          line1: a.text === '—' ? receiverText(sr.receiver) : a.text + (manual ? MANUAL : ''),
          color1: a.color ? P[a.color] : a.text === '—' ? P.inkSecondary : dcInk(a.dc, P),
          line2: a.text === '—' ? '' : receiverText(sr.receiver), isSupport: true });
      }
    }
  }

  // --- Labels ③ hardware rows — a post base at a beam support merges into the support label ---
  if (layout.showHW) {
    for (const { p, g } of postGeoms) {
      const pp = ppMap[p.id];
      if (!pp || !g.lv.postHwH) continue;
      const a = anchorageText(pp);
      const manual = !!p.anchorageOverride;
      hwItems.push({ zoneY: g.lv.postHwY, srcLvId: g.lv.id, x: g.x, preferEnd: false, line1: a.text + (manual && a.text !== '—' ? MANUAL : ''),
        edit: 'post:' + p.id,
        detail: (pp.anchorage ? ' · T ' + kip(pp.envelopeT) + ' / cap ' + kip(pp.anchorage.cap / 1000) : '') + (manual ? ' · manual override' : ' · auto') + clickHint,
        color1: a.color ? P[a.color] : dcInk(a.dc, P), line2: '', mark: p.mark || p.id });
    }
    const supports = hwItems.filter(it => it.isSupport);
    for (const it of hwItems) {
      if (!it.isSupport) {
        const host = supports.find(s => s.srcLvId === it.srcLvId && Math.abs(s.x - it.x) < 2);
        if (host) { host.line2 = it.mark + ': ' + it.line1 + (host.line2 ? ' ' + host.line2 : ''); it.merged = true; }
      }
    }
    for (const it of hwItems) {
      if (it.merged) continue;
      const tip = (it.isSupport ? 'Beam support connection' : it.mark + ' base connection') + ': ' + it.line1 + (it.line2 ? ' — ' + it.line2 : '') + (it.detail || '');
      const lines = [{ attrs: { y: it.zoneY + 10, fill: it.color1, 'font-size': '9', 'font-weight': '700' }, text: it.line1, tip, edit: it.edit }];
      if (it.line2) lines.push({ attrs: { y: it.zoneY + 21, fill: P.inkSecondary, 'font-size': '8' }, text: it.line2 });
      placeGroup(sides(it.x, lines, it.preferEnd), { x: it.x, y: it.zoneY + 3 }, 1); // reduced = hardware line only
    }
  }

  // --- Labels ④ post mark + size (body zone, avoiding wall text) ---
  for (const { p, g } of postGeoms) {
    const isSel = p.id === sel.postId;
    const pp = ppMap[p.id];
    const edit = pp ? 'post:' + p.id : null;
    const mark = { attrs: { fill: isSel ? P.selected : P.post, 'font-size': '9', 'font-weight': '700' }, text: p.mark || p.id, edit };
    let size = null;
    if (pp && layout.showHW) {
      const manual = !!p.postOverride;
      const txt = pp.post ? pp.post.postLabel + (pp.postDC != null ? ' ' + pp.postDC.toFixed(2) : '') + (manual ? MANUAL : '') : 'OVER';
      size = { attrs: { fill: pp.post ? dcInk(pp.postDC, P) : P.fail, 'font-size': '8', 'font-weight': '600' }, text: txt, edit,
        tip: (p.mark || p.id) + ' post: ' + txt + (pp.post ? ' · C ' + kip(pp.envelopeC) + ' / cap ' + kip(pp.post.capacityKips) : '') + (manual ? ' · manual override' : ' · auto') + clickHint };
    }
    const lv = g.lv;
    const ys = [lv.bodyY + 13, lv.bodyY + lv.bodyH / 2, lv.bodyY + lv.bodyH - 16].filter(y => y > g.y1 + 8 && y < g.y2 - 4);
    if (!ys.length) ys.push((g.y1 + g.y2) / 2);
    const at = (y, withSize) => [{ ...mark, attrs: { ...mark.attrs, y } }, ...(withSize && size ? [{ ...size, attrs: { ...size.attrs, y: y + 12 } }] : [])];
    const full = ys.flatMap(y => sides(g.x, at(y, true)));
    const markOnly = size ? ys.flatMap(y => sides(g.x, at(y, false))) : [];
    const chosen = L.place(full) || (markOnly.length ? L.place(markOnly) : null);
    if (chosen) chosen.forEach(it => drawItem(it, size && size.tip));
    else placeGroup(full, { x: g.x, y: g.lv.bodyY + 4 });
  }

}


// Drawing box of an element ('wall:id' | 'beam:id' | 'post:id') in the current layout
function elementBox(S, key) {
  const { layout, line, levels } = S;
  const { pxPerFt, levelYs } = layout;
  const [type, id] = key.split(':');
  const lvOf = (levelId) => levelYs[levels.findIndex(l => l.id === levelId)];
  if (type === 'wall') {
    const w = (line.walls || []).find(ww => ww.id === id);
    const lv = w && lvOf(w.levelId);
    return lv ? wallRectOf(w, lv, line.beams || [], pxPerFt) : null;
  }
  if (type === 'beam') {
    const b = (line.beams || []).find(bb => bb.id === id);
    const lv = b && lvOf(b.levelId);
    return lv ? { x: GUTTER + num(b.position) * pxPerFt, y: beamYOf(lv), w: num(b.length) * pxPerFt, h: BEAM_H } : null;
  }
  if (type === 'post') {
    const p = (line.supportPosts || []).find(pp => pp.id === id);
    const g = p && postGeom(p, S);
    return g ? { x: g.x - 3, y: g.y1, w: 6, h: g.y2 - g.y1 } : null;
  }
  return null;
}

// Governing / per-combo T/C at wall ends (accumulated when stacking or loads from above increase it)
function wallDisplayTC(wr, combo) {
  let tL = 0, tR = 0, cL = 0, cR = 0;
  let isAccum = false;
  if (combo === 'governing') {
    if (wr.accumPerCombo) {
      let aTL = 0, aTR = 0, aCL = 0, aCR = 0;
      for (const [key, ac] of Object.entries(wr.accumPerCombo)) {
        if (wr.combos && wr.combos[key] && wr.combos[key].group === 'load_case') continue;
        aTL = Math.max(aTL, ac.tensionLeft || 0);
        aTR = Math.max(aTR, ac.tensionRight || 0);
        aCL = Math.max(aCL, ac.comprLeft || 0);
        aCR = Math.max(aCR, ac.comprRight || 0);
      }
      if (aTL > wr.governingTensionLeft || aTR > wr.governingTensionRight ||
          aCL > wr.governingComprLeft || aCR > wr.governingComprRight) {
        tL = aTL; tR = aTR; cL = aCL; cR = aCR;
        isAccum = true;
      } else {
        tL = wr.governingTensionLeft; tR = wr.governingTensionRight;
        cL = wr.governingComprLeft; cR = wr.governingComprRight;
      }
    } else {
      tL = wr.governingTensionLeft; tR = wr.governingTensionRight;
      cL = wr.governingComprLeft; cR = wr.governingComprRight;
    }
  } else if (wr.accumPerCombo && wr.accumPerCombo[combo]) {
    const ac = wr.accumPerCombo[combo];
    tL = ac.tensionLeft || 0; tR = ac.tensionRight || 0;
    cL = ac.comprLeft || 0; cR = ac.comprRight || 0;
    const c = wr.combos && wr.combos[combo];
    if (c && (tL > (c.tensionLeft || 0) + 0.005 || tR > (c.tensionRight || 0) + 0.005 ||
              cL > (c.comprLeft || 0) + 0.005 || cR > (c.comprRight || 0) + 0.005)) {
      isAccum = true;
    }
  } else if (wr.combos && wr.combos[combo]) {
    const c = wr.combos[combo];
    tL = c.tensionLeft || 0; tR = c.tensionRight || 0;
    cL = c.comprLeft || 0; cR = c.comprRight || 0;
  }
  // Own (this wall only) values for the P row
  let own;
  if (combo === 'governing') {
    own = { tL: wr.governingTensionLeft, tR: wr.governingTensionRight, cL: wr.governingComprLeft, cR: wr.governingComprRight };
  } else {
    const c = (wr.combos && wr.combos[combo]) || {};
    own = { tL: c.tensionLeft || 0, tR: c.tensionRight || 0, cL: c.comprLeft || 0, cR: c.comprRight || 0 };
  }
  return { tL, tR, cL, cR, isAccum, own };
}

// Sources feeding into / receivers of the selected element, as 'type:id' keys
function loadPathRelations(results, sel) {
  const sources = new Set(), receivers = new Set();
  if (!results || !sel) return { sources, receivers };
  const recKey = (rec) => {
    if (!rec || !rec.id) return null;
    if (rec.type === 'beam') return 'beam:' + rec.id;
    if (rec.type === 'post') return 'post:' + rec.id;
    if (rec.type === 'wall_end' || rec.type === 'wall_mid') return 'wall:' + rec.id;
    return null;
  };
  const add = (set, k) => { if (k) set.add(k); };
  if (sel.type === 'beam') {
    const bt = (results.beamTransfers || []).find(b => b.beamId === sel.id);
    if (bt) {
      bt.loads.forEach(ld => add(sources, ld.sourceType + ':' + ld.sourceId));
      bt.supports.forEach(s => add(receivers, recKey(s.receiver)));
    }
  } else if (sel.type === 'post') {
    const pp = (results.postPaths || []).find(p => p.postId === sel.id);
    if (pp) {
      pp.sources.forEach(s => add(sources, s.type + ':' + s.id));
      add(receivers, recKey(pp.receiver));
    }
  } else if (sel.type === 'wall') {
    (results.wallDeliveries || []).filter(d => d.wallId === sel.id).forEach(d => add(receivers, recKey(d.receiver)));
    for (const pl of (results.perLevel || [])) {
      const wr = (pl.walls || []).find(w => w.wallId === sel.id);
      if (wr && wr.injections) wr.injections.forEach(s => add(sources, s.type + ':' + s.id));
    }
  }
  return { sources, receivers };
}

function hwOptionsFor(level) {
  const span = (level && level.floorClearSpan) || '16';
  return [...HDUE_TABLE, ...(MSTC_TABLE[span] || MSTC_TABLE['16'])];
}

export function renderElevation(container, line, levels, wallDLTypes, callbacks) {
  const { onWallChange, onGravityChange, onInputChange } = callbacks || {};
  let selectedWallId = null;
  let selectedBeamId = null;
  let selectedPostId = null;
  let placementMode = 'none'; // 'none' | 'wall' | 'beam' | 'post'
  let dragState = null; // { wallId, startFt, origPos }
  let currentCombo = null;
  let showForcesOn = false;
  let showHardwareOn = false;
  let wallResults = null;

  const wrapper = el('div', { className: 'elevation-wrapper', style: { position: 'relative' } });
  const toolbarRow = el('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' } });
  const svgContainer = el('div', { style: { height: '500px', overflowY: 'auto', overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--surface)' } });
  const propPanel = el('div', { className: 'elevation-prop-panel', hidden: true, style: { marginTop: '0.5rem', padding: '0.75rem', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--panel)' } });
  const gravSection = el('div', { style: { marginTop: '0.75rem' } });
  const comboRow = el('div', { hidden: true, style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' } });
  const legendRow = el('div', { hidden: true, style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 12px', marginBottom: '0.5rem', fontSize: '0.75rem', color: 'var(--ink-secondary)' } });
  const tooltip = el('div', { hidden: true, style: { position: 'absolute', zIndex: '20', pointerEvents: 'none', maxWidth: '320px', padding: '4px 8px',
    fontSize: '0.75rem', lineHeight: '1.35', background: 'var(--ink)', color: 'var(--surface)', borderRadius: '4px', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' } });

  // Find an element by mark / ID (options refreshed on every draw)
  const findSelect = el('select', { className: 'form-select', style: { maxWidth: '240px', fontSize: '0.8rem', padding: '2px 6px', marginLeft: 'auto' },
    title: 'Select an element by mark or ID',
    onChange(e) {
      const v = e.target.value;
      if (!v) return;
      const [type, id] = v.split(':');
      placementMode = 'none';
      buildToolbar();
      selectElement(type, id);
      scrollToElement(v);
    } });

  const TYPE_LABEL = { wall: 'Wall', beam: 'Beam', post: 'Post' };
  function elementLabel(type, obj) {
    const lvl = levels.find(l => l.id === obj.levelId);
    const mark = obj.mark || obj.id;
    return mark + (obj.mark && obj.mark !== obj.id ? ' (' + obj.id + ')' : '') + ' — ' + TYPE_LABEL[type] + ', ' + ((lvl && lvl.name) || '?') + ' @ ' + num(obj.position).toFixed(2) + "'";
  }
  function refreshFindSelect() {
    clearEl(findSelect);
    findSelect.appendChild(el('option', { value: '' }, 'Find element…'));
    const lvlIdx = (id) => levels.findIndex(l => l.id === id);
    const groups = [['wall', 'Walls', line.walls], ['beam', 'Beams', line.beams], ['post', 'Posts', line.supportPosts]];
    const selKey = selectedWallId ? 'wall:' + selectedWallId : selectedBeamId ? 'beam:' + selectedBeamId : selectedPostId ? 'post:' + selectedPostId : '';
    for (const [type, label, items] of groups) {
      if (!items || !items.length) continue;
      const og = el('optgroup', { label });
      [...items].sort((a, b) => lvlIdx(a.levelId) - lvlIdx(b.levelId) || num(a.position) - num(b.position))
        .forEach(obj => og.appendChild(el('option', { value: type + ':' + obj.id, selected: selKey === type + ':' + obj.id }, elementLabel(type, obj))));
      findSelect.appendChild(og);
    }
  }
  function scrollToElement(key) {
    const b = lastS && elementBox(lastS, key);
    if (!b) return;
    svgContainer.scrollTop = Math.max(0, b.y - 60);
    svgContainer.scrollLeft = Math.max(0, b.x - 120);
  }

  // Chooser shown when several elements of the clicked kind overlap at the click point
  const chooser = el('div', { hidden: true, style: { position: 'absolute', zIndex: '30', minWidth: '200px', maxWidth: '340px', padding: '6px',
    background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '6px', boxShadow: '0 4px 14px rgba(0,0,0,0.3)', fontSize: '0.8rem' } });
  function hideChooser() { chooser.hidden = true; clearEl(chooser); }

  // === Quick editor: override nailing / hardware from the elevation ===
  const quickEdit = el('div', { hidden: true, className: 'quick-edit', style: { position: 'absolute', zIndex: '31', minWidth: '260px', maxWidth: '380px', padding: '8px',
    background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '6px', boxShadow: '0 4px 14px rgba(0,0,0,0.3)', fontSize: '0.8rem' } });
  let qeKey = null;
  function hideQuickEdit() { quickEdit.hidden = true; clearEl(quickEdit); qeKey = null; }
  function openQuickEdit(key, e) {
    const [kind, id] = key.split(':');
    selectElement(kind === 'support' ? 'beam' : kind === 'post' ? 'post' : 'wall', id);
    const wr = wrapper.getBoundingClientRect();
    quickEdit.style.left = Math.max(0, e.clientX - wr.left + 8) + 'px';
    quickEdit.style.top = Math.max(0, e.clientY - wr.top + 8) + 'px';
    qeKey = key;
    renderQuickEdit();
  }
  function designCtx() {
    const c = (callbacks && callbacks.designContext && callbacks.designContext()) || {};
    return { thickness: line.wallThickness || c.wallThickness || '4', grade: getGradeById(c.woodGrade || 'dfir_no1'), loadType: c.loadType || 'both' };
  }
  const dcTxt = (dc) => dc == null ? '—' : dc.toFixed(2) + (dc > 1 ? ' ✗' : '');
  // Anchorage choices for a level, auto-mode group first, with D/C at demand T (kips)
  function anchorageGroups(lvl, li, T) {
    const span = (lvl && lvl.floorClearSpan) || '16';
    const holdownFirst = li === levels.length - 1 || (lvl && lvl.anchorageType === 'holdown');
    const opt = (it) => {
      const a = findAnchorage(it.id, span) || it;
      const dc = a.cap > 0 ? T * 1000 / a.cap : null;
      return { id: it.id, text: it.id + ' — ' + (T || 0).toFixed(2) + 'k / ' + (a.cap / 1000).toFixed(2) + 'k → ' + dcTxt(dc), dc };
    };
    const hd = { label: 'Holdowns', items: HDUE_TABLE.map(opt) };
    const st = { label: 'Straps (' + span + '" span)', items: (MSTC_TABLE[span] || MSTC_TABLE['16']).map(opt) };
    return holdownFirst ? [hd, st] : [st, hd];
  }
  function postGroups(lvl, C) {
    const { thickness, grade } = designCtx();
    const floorH = parseFloat(lvl && lvl.floorToFloor) || 10;
    return [{ label: 'Posts (' + (thickness === '6' ? '2x6' : '2x4') + ' wall)', items: (POST_SIZES[thickness] || POST_SIZES['4']).map(ps => {
      const p = findPost(ps.id, thickness, grade, floorH);
      const dc = p && p.capacityKips > 0 ? C / p.capacityKips : null;
      return { id: ps.id, text: ps.label + ' — ' + (C || 0).toFixed(2) + 'k / ' + (p ? p.capacityKips.toFixed(2) : '?') + 'k → ' + dcTxt(dc), dc };
    }) }];
  }
  function nailingGroups(wr) {
    const hb = wr.hbReductionFactor || 1;
    return [{ label: 'Nailing (≈ at current load share)', items: NAILING_TABLE.map(n => {
      const dcE = wr.unitShear_seismic > 0 ? wr.unitShear_seismic / (n.asdE * hb) : 0;
      const dcW = wr.unitShear_wind > 0 ? wr.unitShear_wind / (n.asdW * hb) : 0;
      const lt = designCtx().loadType; // same governing rule as the calc
      const dc = lt === 'seismic' ? dcE : lt === 'wind' ? dcW : Math.max(dcE, dcW);
      return { id: n.id, text: n.label + ' — ' + (n.asdE * hb).toFixed(0) + '/' + (n.asdW * hb).toFixed(0) + ' plf → ' + dcTxt(dc), dc };
    }) }];
  }
  // One override field: select with Auto (current) + grouped options; ✓ on the first passing option
  function qeField(label, obj, key, groups, currentText) {
    const sel = el('select', { className: 'form-select', style: { width: '100%', fontSize: '0.8rem' },
      onChange(e) { obj[key] = e.target.value; applyQuickEdit(); } });
    sel.appendChild(el('option', { value: '', selected: !obj[key] }, obj[key] ? 'Auto' : 'Auto (currently ' + currentText + ')'));
    let tickDone = false;
    for (const g of groups) {
      const og = el('optgroup', { label: g.label });
      for (const it of g.items) {
        const tick = !tickDone && it.dc != null && it.dc <= 1;
        if (tick) tickDone = true;
        og.appendChild(el('option', { value: it.id, selected: obj[key] === it.id }, it.text + (tick ? ' ✓' : '')));
      }
      sel.appendChild(og);
    }
    return el('div', { style: { marginBottom: '6px' } },
      el('div', { style: { color: 'var(--ink-secondary)', marginBottom: '2px' } }, label + (obj[key] ? ' ✎ override' : '')), sel);
  }
  function applyQuickEdit() {
    markChanged(); // recalculates the preview and redraws
    renderPropPanel();
    drawSVG();
    renderQuickEdit();
  }
  function renderQuickEdit() {
    clearEl(quickEdit);
    if (!qeKey || !wallResults) { hideQuickEdit(); return; }
    const [kind, id, sub] = qeKey.split(':');
    const body = [];
    let title = '', fields = [], resetKeys = [], target = null;
    if (kind === 'nailing' || kind === 'wallEnd') {
      const w = (line.walls || []).find(x => x.id === id);
      const wr = w && findWallResult(w.id);
      if (!w || !wr) { hideQuickEdit(); return; }
      const li = levelIndexOf(w.levelId), lvl = levels[li];
      target = w;
      if (kind === 'nailing') {
        title = (w.mark || w.id) + ' · nailing';
        fields.push(qeField('Nailing', w, 'nailingPattern', nailingGroups(wr), wr.nailing ? wr.nailing.label : '?'));
        body.push('v ' + (wr.unitShear_ASD || 0).toFixed(0) + ' plf / cap ' + (wr.effectiveCapacity || 0).toFixed(0) + ' plf → D/C ' + dcTxt(wr.dcRatio)
          + (wr.hbReductionFactor < 1 ? ' (h/b factor ' + wr.hbReductionFactor.toFixed(2) + ')' : ''));
        resetKeys = ['nailingPattern'];
      }
      const sides = kind === 'wallEnd' ? [sub] : ((num(w.length) * (lastS ? lastS.layout.pxPerFt : 10)) < HW_MIN_WIDTH ? ['left', 'right'] : []);
      for (const side of sides) {
        const d = wallEndData(w, wr, side);
        if (kind === 'wallEnd') title = (w.mark || w.id) + ' · ' + side + ' end';
        fields.push(qeField(side[0].toUpperCase() + side.slice(1) + ' HD/Strap', w, 'anchorage' + d.S1 + 'Override', anchorageGroups(lvl, li, d.T), d.anc ? d.anc.id : 'OVER'));
        fields.push(qeField(side[0].toUpperCase() + side.slice(1) + ' post', w, 'post' + d.S1 + 'Override', postGroups(lvl, d.C), d.post ? d.post.postLabel : 'OVER'));
        body.push(side + ': ' + d.ancText + ' · ' + d.postText);
        resetKeys.push('anchorage' + d.S1 + 'Override', 'post' + d.S1 + 'Override');
      }
    } else if (kind === 'post') {
      const p = (line.supportPosts || []).find(x => x.id === id);
      const pp = p && (wallResults.postPaths || []).find(x => x.postId === p.id);
      if (!p || !pp) { hideQuickEdit(); return; }
      const li = levelIndexOf(p.levelId), lvl = levels[li];
      target = p;
      title = (p.mark || p.id) + ' · post';
      fields.push(qeField('Base HD/Strap', p, 'anchorageOverride', anchorageGroups(lvl, li, pp.envelopeT || 0), pp.anchorage ? pp.anchorage.id : '—'));
      fields.push(qeField('Post size', p, 'postOverride', postGroups(lvl, pp.envelopeC || 0), pp.post ? pp.post.postLabel : 'OVER'));
      body.push('T ' + (pp.envelopeT || 0).toFixed(2) + 'k → ' + (pp.anchorage ? pp.anchorage.id + ' D/C ' + dcTxt(pp.anchorageDC) : '—')
        + ' · C ' + (pp.envelopeC || 0).toFixed(2) + 'k → ' + (pp.post ? pp.post.postLabel + ' D/C ' + dcTxt(pp.postDC) : 'OVER'));
      resetKeys = ['anchorageOverride', 'postOverride'];
    } else if (kind === 'support') {
      const b = (line.beams || []).find(x => x.id === id);
      const sDef = b && (b.supports || []).find(x => x.id === sub);
      const bt = b && (wallResults.beamTransfers || []).find(x => x.beamId === b.id);
      const sr = bt && bt.supports.find(x => x.supportId === sub);
      if (!sDef || !sr) { hideQuickEdit(); return; }
      const li = levelIndexOf(b.levelId), lvl = levels[li];
      target = sDef;
      title = (b.mark || b.id) + ' · support at ' + sr.position.toFixed(2) + "'";
      fields.push(qeField('HD/Strap', sDef, 'anchorageOverride', anchorageGroups(lvl, li, sr.envelopeT || 0), sr.anchorage ? sr.anchorage.id : '—'));
      body.push('T ' + (sr.envelopeT || 0).toFixed(2) + 'k → ' + (sr.anchorage ? sr.anchorage.id + ' D/C ' + dcTxt(sr.anchorageDC) : '—') + ' · ' + receiverText(sr.receiver));
      resetKeys = ['anchorageOverride'];
    }
    quickEdit.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '6px' } },
      el('strong', null, title),
      el('button', { className: 'btn btn-sm btn-ghost', type: 'button', style: { marginLeft: 'auto', padding: '0 6px' }, onClick() { hideQuickEdit(); } }, '×')));
    fields.forEach(fl => quickEdit.appendChild(fl));
    body.forEach(t => quickEdit.appendChild(el('div', { className: 'mono', style: { color: 'var(--ink-secondary)', fontSize: '0.75rem', marginBottom: '4px' } }, t)));
    const anyManual = resetKeys.some(k => target && target[k]);
    quickEdit.appendChild(el('button', { className: 'btn btn-sm', type: 'button', disabled: !anyManual, style: { marginTop: '2px' },
      onClick() { resetKeys.forEach(k => { target[k] = ''; }); applyQuickEdit(); } }, 'Reset to auto'));
    quickEdit.hidden = false;
  }
  function elementsAt(e) {
    if (!lastS) return [];
    const r = lastS.svg.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const out = [];
    const test = (type, obj, pad) => {
      const b = elementBox(lastS, type + ':' + obj.id);
      if (b && mx >= b.x - pad && mx <= b.x + b.w + pad && my >= b.y - pad && my <= b.y + b.h + pad) out.push({ type, obj });
    };
    (line.supportPosts || []).forEach(p => test('post', p, 4));
    (line.beams || []).forEach(b => test('beam', b, 4));
    (line.walls || []).forEach(w => test('wall', w, 0));
    return out;
  }
  // Returns true when a chooser was shown instead of selecting directly
  function pickAt(e, type, id) {
    const hits = elementsAt(e);
    if (hits.filter(h => h.type === type).length < 2) { selectElement(type, id); return false; }
    clearEl(chooser);
    chooser.appendChild(el('div', { style: { color: 'var(--ink-secondary)', marginBottom: '4px' } }, hits.length + ' elements here — pick one:'));
    const selId = selectedWallId || selectedBeamId || selectedPostId;
    for (const h of hits) {
      chooser.appendChild(el('button', { className: 'btn btn-sm btn-ghost btn-block', type: 'button',
        style: { textAlign: 'left', justifyContent: 'flex-start', fontWeight: h.obj.id === selId ? '700' : '400' },
        onClick(ev) { ev.stopPropagation(); hideChooser(); selectElement(h.type, h.obj.id); } }, elementLabel(h.type, h.obj)));
    }
    const wr = wrapper.getBoundingClientRect();
    chooser.style.left = (e.clientX - wr.left + 8) + 'px';
    chooser.style.top = (e.clientY - wr.top + 8) + 'px';
    chooser.hidden = false;
    return true;
  }
  document.addEventListener('mousedown', onDocMouseDown);
  function onDocMouseDown(e) {
    if (!chooser.hidden && !chooser.contains(e.target)) hideChooser();
    if (!quickEdit.hidden && !quickEdit.contains(e.target)) hideQuickEdit();
  }

  function buildToolbar() {
    clearEl(toolbarRow);
    const btnStyle = (mode) => ({
      fontWeight: placementMode === mode ? '700' : '400',
      borderBottom: placementMode === mode ? '2px solid var(--accent)' : '2px solid transparent',
    });
    toolbarRow.appendChild(el('span', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginRight: '0.25rem' } }, 'Mode:'));
    toolbarRow.appendChild(el('button', { className: 'btn btn-sm btn-ghost', type: 'button', style: btnStyle('none'),
      onClick() { placementMode = 'none'; buildToolbar(); } }, 'Select'));
    toolbarRow.appendChild(el('button', { className: 'btn btn-sm btn-ghost', type: 'button', style: btnStyle('wall'),
      onClick() { placementMode = 'wall'; buildToolbar(); } }, '+ Wall'));
    toolbarRow.appendChild(el('button', { className: 'btn btn-sm btn-ghost', type: 'button', style: btnStyle('beam'),
      onClick() { placementMode = 'beam'; buildToolbar(); } }, '+ Beam'));
    toolbarRow.appendChild(el('button', { className: 'btn btn-sm btn-ghost', type: 'button', style: btnStyle('post'),
      onClick() { placementMode = 'post'; buildToolbar(); } }, '+ Post'));
    toolbarRow.appendChild(el('span', { style: { fontSize: '0.75rem', color: 'var(--ink-tertiary)', marginLeft: '0.5rem' } }, 'Del = delete selected · Esc = deselect'));
    toolbarRow.appendChild(findSelect);
  }
  buildToolbar();

  wrapper.appendChild(toolbarRow);
  wrapper.appendChild(comboRow);
  wrapper.appendChild(legendRow);
  wrapper.appendChild(svgContainer);
  wrapper.appendChild(propPanel);
  wrapper.appendChild(gravSection);
  wrapper.appendChild(tooltip);
  wrapper.appendChild(chooser);
  wrapper.appendChild(quickEdit);
  container.appendChild(wrapper);

  function updateTooltip(e) {
    const tip = e.target && e.target.getAttribute ? e.target.getAttribute('data-tip') : null;
    if (!tip) { tooltip.hidden = true; return; }
    const r = wrapper.getBoundingClientRect();
    tooltip.textContent = tip;
    tooltip.hidden = false;
    tooltip.style.left = (e.clientX - r.left + 14) + 'px';
    tooltip.style.top = (e.clientY - r.top + 14) + 'px';
  }

  let isExpanded = false;
  let lastS = null; // last drawn state, for hit-testing / scroll-to
  const expandBtn = el('button', { className: 'btn btn-sm btn-ghost', type: 'button', style: { position: 'absolute', top: '4px', right: '4px', zIndex: '5' },
    onClick() { toggleExpand(); } }, 'Expand');

  function toggleExpand() {
    isExpanded = !isExpanded;
    if (isExpanded) {
      wrapper.style.cssText = 'position:fixed;inset:0;z-index:200;background:var(--panel);padding:1rem;overflow-y:auto;';
      svgContainer.style.height = 'calc(100vh - 200px)';
      expandBtn.textContent = 'Collapse';
    } else {
      wrapper.style.cssText = 'position:relative;';
      svgContainer.style.height = '500px';
      expandBtn.textContent = 'Expand';
    }
    drawSVG();
  }

  function snapToWallEndsOrGrid(ft) {
    const SNAP_THRESHOLD = 0.5;
    let bestDist = SNAP_THRESHOLD;
    let bestSnap = null;
    const consider = (v) => { if (Math.abs(ft - v) < bestDist) { bestDist = Math.abs(ft - v); bestSnap = v; } };
    for (const w of (line.walls || [])) {
      const wStart = num(w.position);
      consider(wStart);
      consider(wStart + num(w.length));
    }
    for (const b of (line.beams || [])) {
      const bStart = num(b.position);
      consider(bStart);
      consider(bStart + num(b.length));
      (b.supports || []).forEach(s => consider(num(s.position)));
    }
    for (const sp of (line.supportPosts || [])) consider(num(sp.position));
    return bestSnap != null ? bestSnap : Math.round(ft * 2) / 2;
  }

  function levelIndexOf(levelId) { return levels.findIndex(l => l.id === levelId); }

  function postBelowAt(levelId, pos) {
    const li = levelIndexOf(levelId);
    if (li < 0 || li >= levels.length - 1) return null;
    const belowId = levels[li + 1].id;
    return (line.supportPosts || []).find(p => p.levelId === belowId && Math.abs(num(p.position) - pos) <= POS_TOL) || null;
  }

  function markChanged() { if (onInputChange) onInputChange(); }

  function drawSVG() {
    clearEl(svgContainer);
    const containerW = Math.max(svgContainer.clientWidth || 600, 400);
    const showForces = !!(wallResults && showForcesOn && currentCombo !== null);
    const showHW = !!(wallResults && showHardwareOn);
    const layout = computeElevationLayout(line, levels, { width: containerW, showForces, showHW });
    const { totalLen, pxPerFt, svgW, totalH, levelYs } = layout;
    const beams = line.beams || [];
    if (!isExpanded) {
      const viewH = (typeof window !== 'undefined' && window.innerHeight) || 800;
      svgContainer.style.height = Math.max(300, Math.min(totalH + 4, Math.round(viewH * 0.75))) + 'px';
    }

    const svg = svgEl('svg', { width: svgW, height: totalH, style: { cursor: 'crosshair' } });
    const placer = createLabelPlacer({ minX: GUTTER, maxX: svgW });

    for (let i = 0; i <= totalLen; i += 5) {
      const x = GUTTER + i * pxPerFt;
      const isMajor = i % 10 === 0;
      svg.appendChild(svgEl('line', { x1: x, y1: 0, x2: x, y2: totalH - RULER_H, stroke: 'var(--border-light)', 'stroke-width': isMajor ? 0.5 : 0.25, 'stroke-dasharray': isMajor ? 'none' : '2,4' }));
      if (isMajor) {
        svg.appendChild(svgEl('text', { x, y: totalH - 4, 'text-anchor': 'middle', fill: 'var(--ink-tertiary)', 'font-size': '10' }, String(i)));
      }
    }
    svg.appendChild(svgEl('text', { x: GUTTER + totalLen * pxPerFt + 8, y: totalH - 4, fill: 'var(--ink-tertiary)', 'font-size': '9' }, 'ft'));

    drawBandBackdrops(svg, layout, LIVE_PALETTE);

    for (const lv of levelYs) {
      svg.appendChild(svgEl('line', { x1: 0, y1: lv.y, x2: svgW, y2: lv.y, stroke: 'var(--border)', 'stroke-width': 1 }));

      const midY = lv.bodyY + lv.bodyH / 2;
      svg.appendChild(svgEl('text', { x: 4, y: midY, 'dominant-baseline': 'middle', fill: 'var(--ink-secondary)', 'font-size': '11', 'font-weight': '600' }, lv.name || '?'));
      svg.appendChild(svgEl('text', { x: 4, y: midY + 14, 'dominant-baseline': 'middle', fill: 'var(--ink-tertiary)', 'font-size': '9' }, lv.ftH + "'"));

      const gl = (line.gravityLoads || {})[lv.id];
      if (gl) {
        for (const u of (gl.uniform || [])) {
          const sx = GUTTER + num(u.start) * pxPerFt;
          const ex = GUTTER + num(u.end) * pxPerFt;
          if (ex > sx) {
            svg.appendChild(svgEl('rect', { x: sx, y: lv.y + 2, width: ex - sx, height: 5, fill: '#f59e0b', opacity: 0.4, rx: 1, stroke: '#b45309', 'stroke-width': 0.5 }));
            const a = { x: (sx + ex) / 2, y: lv.y + 14, 'text-anchor': 'middle', fill: '#92400e', 'font-size': '7' };
            svg.appendChild(haloText(a, num(u.dlPlf) + ' plf'));
            placer.reserveText(a, num(u.dlPlf) + ' plf');
          }
        }
        for (const p of (gl.point || [])) {
          const px2 = GUTTER + num(p.position) * pxPerFt;
          svg.appendChild(svgEl('line', { x1: px2, y1: lv.y + 2, x2: px2, y2: lv.y + 12, stroke: '#f59e0b', 'stroke-width': 1.5, 'pointer-events': 'none' }));
          svg.appendChild(svgEl('polygon', { points: `${px2 - 2.5},${lv.y + 10} ${px2 + 2.5},${lv.y + 10} ${px2},${lv.y + 13}`, fill: '#f59e0b', 'pointer-events': 'none' }));
        }
      }

      svg.appendChild(svgEl('rect', {
        x: GUTTER, y: lv.y, width: totalLen * pxPerFt, height: lv.h,
        fill: 'transparent', style: { cursor: 'crosshair' },
        onClick(e) { handleLevelClick(e, lv); },
      }));
    }
    // Foundation line
    const fdnY = levelYs.length ? levelYs[levelYs.length - 1].floorY : 0;
    if (levelYs.length) svg.appendChild(svgEl('line', { x1: 0, y1: fdnY, x2: svgW, y2: fdnY, stroke: 'var(--border)', 'stroke-width': 1.5 }));

    function handleLevelClick(e, lv) {
      const rect = svg.getBoundingClientRect();
      const ft = (e.clientX - rect.left - GUTTER) / pxPerFt;
      if (ft < 0 || ft > totalLen) return;
      const snapFt = snapToWallEndsOrGrid(ft);

      if (placementMode === 'none') {
        selectElement('wall', null);
        return;
      } else if (placementMode === 'beam') {
        if (!line.beams) line.beams = [];
        const b = newBeam(lv.id, snapFt, 8);
        line.beams.push(b);
        selectElement('beam', b.id);
      } else if (placementMode === 'post') {
        if (!line.supportPosts) line.supportPosts = [];
        const sp = newSupportPost(lv.id, snapFt);
        line.supportPosts.push(sp);
        selectElement('post', sp.id);
      } else if (placementMode === 'wall') {
        const defaultDLType = (wallDLTypes && wallDLTypes[0]) ? wallDLTypes[0].id : '';
        const w = newWall(lv.id, snapFt, defaultDLType);
        if (!line.walls) line.walls = [];
        line.walls.push(w);
        selectElement('wall', w.id);
        if (onWallChange) onWallChange();
      }
      markChanged();
    }

    drawAuditWarnings(svg, line.walls || [], levelYs, pxPerFt);

    const selKey = selectedWallId ? { type: 'wall', id: selectedWallId } : selectedBeamId ? { type: 'beam', id: selectedBeamId } : selectedPostId ? { type: 'post', id: selectedPostId } : null;
    const rel = loadPathRelations(wallResults, selKey);
    const highlightActive = rel.sources.size + rel.receivers.size > 0;
    const anyBands = showForces || showHW;

    for (const w of (line.walls || [])) {
      const lv = levelYs.find(l => l.id === w.levelId);
      if (!lv) continue;
      const r = wallRectOf(w, lv, beams, pxPerFt);
      const body = wallBodyOf(lv);
      const wx = r.x, ww = r.w;
      const isSel = w.id === selectedWallId;
      const ar = (parseFloat(lv.ftH) || 0) / (parseFloat(w.length) || 1);
      const related = isSel || rel.sources.has('wall:' + w.id) || rel.receivers.has('wall:' + w.id);

      let fill = WALL_COLOR;
      const wr = (wallResults && (showForcesOn || showHardwareOn)) ? findWallResult(w.id) : null;
      if (wr) {
        if (showHW) {
          const allPass = wr.dcRatio <= 1.0 && wr.anchorageLeft && wr.anchorageRight && wr.postLeft && wr.postRight;
          fill = allPass ? 'var(--pass)' : 'var(--fail)';
        } else {
          if (wr.dcRatio > 1.0) fill = 'var(--fail)';
          else if (wr.dcRatio > 0.8) fill = 'var(--stale)';
          else fill = 'var(--pass)';
        }
      }

      const wallRect = svgEl('rect', {
        x: wx, y: r.y, width: Math.max(ww, 2), height: Math.max(r.h, 8),
        fill, opacity: highlightActive && !related ? 0.3 : 0.7, stroke: isSel ? WALL_SELECTED : 'var(--ink)', 'stroke-width': isSel ? 2.5 : 1, rx: 2,
        style: { cursor: placementMode === 'none' ? 'grab' : 'crosshair' },
        onMousedown(e) {
          if (placementMode !== 'none') return;
          e.stopPropagation();
          const svgRect = svg.getBoundingClientRect(); // measure before pickAt redraws the SVG
          const startFt = (e.clientX - svgRect.left - GUTTER) / pxPerFt;
          if (pickAt(e, 'wall', w.id)) return; // overlapping walls: choose first, no drag
          dragState = { wallId: w.id, startFt, origPos: num(w.position) };
        },
        onClick(e) {
          if (placementMode === 'none') return;
          e.stopPropagation();
          handleLevelClick(e, lv);
        },
      });
      svg.appendChild(wallRect);
      if (anyBands) drawWallBandScrim(svg, r, lv, 'var(--surface)');

      if (ar > 2.0) {
        const a = { x: wx + ww / 2, y: r.y + 10, 'text-anchor': 'middle', fill: 'var(--fail)', 'font-size': '8', 'font-weight': '700' };
        svg.appendChild(haloText(a, 'h/b=' + ar.toFixed(1)));
        placer.reserveText(a, 'h/b=' + ar.toFixed(1));
      }

      const markLabel = w.mark || w.id;
      const put = (attrs, text) => { svg.appendChild(wallText(attrs, text)); placer.reserveText(attrs, text); };
      if (showHW && wr) {
        put({ x: wx + ww / 2, y: body.y + 16, 'text-anchor': 'middle', fill: '#fff', 'font-size': '9', 'font-weight': '600' }, markLabel);
        const nailFS = ww > 50 ? 10 : 8;
        const nailAttrs = { x: wx + ww / 2, y: body.y + body.h / 2 - 7, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#fff', 'font-size': String(nailFS), 'font-weight': '600' };
        const nailText = (wr.nailing ? wr.nailing.label : '') + (w.nailingPattern ? ' ✎' : '');
        put(nailAttrs, nailText);
        const pill = dcPill(wx + ww / 2, body.y + body.h / 2 + 8, wr.dcRatio, nailFS - 1);
        svg.appendChild(pill.g);
        placer.reserve(pill.box);
        // Nailing + D/C pill = click-to-edit target
        const nb = textBox(nailAttrs, nailText, 2);
        const tx = Math.min(nb.x, pill.box.x), ty = nb.y, tw = Math.max(nb.x + nb.w, pill.box.x + pill.box.w) - tx, th = pill.box.y + pill.box.h - ty;
        svg.appendChild(svgEl('rect', { x: tx, y: ty, width: tw, height: th, fill: 'transparent', 'data-edit': 'nailing:' + w.id, style: { cursor: 'pointer' },
          'data-tip': markLabel + ' nailing ' + (wr.nailing ? wr.nailing.label : '?') + ' · v ' + (wr.unitShear_ASD || 0).toFixed(0) + ' plf / cap ' + (wr.effectiveCapacity || 0).toFixed(0)
            + ' plf → D/C ' + (wr.dcRatio != null ? wr.dcRatio.toFixed(2) : '—') + (w.nailingPattern ? ' · manual override' : ' · auto') + ' · click to change' }));
        drawHardwareLabels(svg, wr, wx, body.y, ww, body.h, placer, w);
      } else {
        put({ x: wx + ww / 2, y: body.y + body.h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#fff', 'font-size': ww > 40 ? '11' : '9', 'font-weight': '600' }, markLabel);
      }

      if (showForces) {
        drawTCAnnotations(svg, w.id, wx, ww, lv, placer);
      }
    }

    const S = {
      svg, layout, line, levels, results: wallResults, combo: currentCombo, P: LIVE_PALETTE, placer,
      sel: { beamId: selectedBeamId, postId: selectedPostId },
      handlers: {
        onBeamClick(e, b) {
          if (placementMode !== 'none') { handleLevelClick(e, levelYs[levelIndexOf(b.levelId)]); return; }
          pickAt(e, 'beam', b.id);
        },
        onPostClick(e, p) {
          if (placementMode !== 'none') { handleLevelClick(e, levelYs[levelIndexOf(p.levelId)]); return; }
          pickAt(e, 'post', p.id);
        },
      },
    };
    drawTransferElements(S);
    lastS = S;
    refreshFindSelect();
    if (highlightActive) drawRelationOutlines(svg, S, rel);

    // Snap preview overlay
    const previewGroup = svgEl('g', { 'pointer-events': 'none' });
    svg.appendChild(previewGroup);

    function updatePreview(clientX, clientY) {
      while (previewGroup.firstChild) previewGroup.removeChild(previewGroup.firstChild);
      const svgRect = svg.getBoundingClientRect();
      const mx = clientX - svgRect.left;
      const ft = (mx - GUTTER) / pxPerFt;
      if (ft < 0 || ft > totalLen) return;

      // During drag, move the wall
      if (dragState) {
        const delta = ft - dragState.startFt;
        const newPos = snapToWallEndsOrGrid(dragState.origPos + delta);
        const dw = (line.walls || []).find(ww => ww.id === dragState.wallId);
        if (dw) {
          const dpx = GUTTER + newPos * pxPerFt;
          const dww = num(dw.length) * pxPerFt;
          const dlv = levelYs.find(l => l.id === dw.levelId);
          if (dlv) {
            previewGroup.appendChild(svgEl('rect', {
              x: dpx, y: dlv.y + WALL_MARGIN, width: Math.max(dww, 2), height: dlv.h - 2 * WALL_MARGIN,
              fill: 'var(--accent)', opacity: 0.3, stroke: 'var(--accent)', 'stroke-width': 1.5, 'stroke-dasharray': '4,3', rx: 2,
            }));
            previewGroup.appendChild(svgEl('text', {
              x: dpx + dww / 2, y: dlv.y - 6, 'text-anchor': 'middle', fill: 'var(--accent)', 'font-size': '8', 'font-weight': '600',
            }, newPos.toFixed(1) + "'"));
          }
        }
        return;
      }

      // Snap preview line for placement
      const snapFt = snapToWallEndsOrGrid(ft);
      const snapPx = GUTTER + snapFt * pxPerFt;
      const isSnapped = Math.abs(snapFt - Math.round(ft * 2) / 2) > 0.01;
      const previewColor = isSnapped ? '#f59e0b' : 'var(--accent)';

      previewGroup.appendChild(svgEl('line', {
        x1: snapPx, y1: 0, x2: snapPx, y2: totalH - RULER_H,
        stroke: previewColor, 'stroke-width': 1, 'stroke-dasharray': '4,4', opacity: 0.6,
      }));
      previewGroup.appendChild(svgEl('text', {
        x: snapPx, y: 10, 'text-anchor': 'middle', fill: previewColor, 'font-size': '8', 'font-weight': '600', opacity: 0.8,
      }, snapFt.toFixed(1) + "'"));

      // Show ghost element based on placement mode
      const my = clientY - svgRect.top;
      const hoveredLv = levelYs.find(l => my >= l.y && my < l.y + l.h);
      if (hoveredLv && placementMode !== 'none') {
        if (placementMode === 'beam') {
          previewGroup.appendChild(svgEl('rect', {
            x: snapPx, y: beamYOf(hoveredLv), width: 8 * pxPerFt, height: BEAM_H,
            fill: BEAM_COLOR, opacity: 0.3, rx: 1,
          }));
        } else if (placementMode === 'post') {
          previewGroup.appendChild(svgEl('line', {
            x1: snapPx, y1: hoveredLv.y, x2: snapPx, y2: hoveredLv.floorY,
            stroke: BEAM_COLOR, 'stroke-width': 2.5, 'stroke-dasharray': '6,4', opacity: 0.4,
          }));
        } else {
          previewGroup.appendChild(svgEl('rect', {
            x: snapPx, y: hoveredLv.y + WALL_MARGIN, width: 4 * pxPerFt, height: hoveredLv.h - 2 * WALL_MARGIN,
            fill: 'var(--accent)', opacity: 0.2, rx: 2,
          }));
        }
      }
    }

    svg.addEventListener('mousemove', (e) => { updatePreview(e.clientX, e.clientY); updateTooltip(e); });
    // Click-to-edit nailing / hardware (in placement modes the click still places)
    svg.addEventListener('click', (e) => {
      const key = e.target && e.target.getAttribute ? e.target.getAttribute('data-edit') : null;
      if (!key) return;
      e.stopPropagation();
      if (placementMode !== 'none') {
        const my = e.clientY - svg.getBoundingClientRect().top;
        const lv = levelYs.find(l => my >= l.y && my < l.y + l.h);
        if (lv) handleLevelClick(e, lv);
        return;
      }
      openQuickEdit(key, e);
    });
    svg.addEventListener('mouseleave', () => {
      tooltip.hidden = true;
      while (previewGroup.firstChild) previewGroup.removeChild(previewGroup.firstChild);
      if (dragState) { dragState = null; }
    });
    svg.addEventListener('mouseup', (e) => {
      if (dragState) {
        const svgRect = svg.getBoundingClientRect();
        const ft = (e.clientX - svgRect.left - GUTTER) / pxPerFt;
        const delta = ft - dragState.startFt;
        const newPos = snapToWallEndsOrGrid(dragState.origPos + delta);
        const dw = (line.walls || []).find(ww => ww.id === dragState.wallId);
        if (dw && Math.abs(newPos - dragState.origPos) > 0.05) {
          dw.position = newPos;
          markChanged();
        }
        dragState = null;
        drawSVG();
      }
    });

    wrapper.insertBefore(expandBtn, svgContainer);
    svgContainer.appendChild(svg);
  }

  function drawRelationOutlines(svg, S, rel) {
    const outline = (key, color) => {
      const b = elementBox(S, key);
      if (!b) return;
      svg.appendChild(svgEl('rect', { x: b.x - 3, y: b.y - 3, width: Math.max(b.w, 2) + 6, height: Math.max(b.h, 2) + 6,
        fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-dasharray': '5,3', rx: 3, 'pointer-events': 'none' }));
    };
    rel.sources.forEach(k => outline(k, LIVE_PALETTE.source));
    rel.receivers.forEach(k => outline(k, LIVE_PALETTE.receiver));
  }

  function drawAuditWarnings(svg, walls, levelYs, pxPerFt) {
    if (!wallResults || !wallResults.loadPathAudit) return;
    for (const warn of wallResults.loadPathAudit.warnings) {
      if (warn.type === 'unsupported_wall') {
        const w = walls.find(ww => ww.id === warn.elementId);
        if (!w) continue;
        const lv = levelYs.find(l => l.id === w.levelId);
        if (!lv) continue;
        const r = wallRectOf(w, lv, line.beams || [], pxPerFt);
        svg.appendChild(svgEl('rect', {
          x: r.x - 1, y: r.y - 1, width: Math.max(r.w, 2) + 2, height: r.h + 2,
          fill: 'none', stroke: WARN_COLOR, 'stroke-width': 2, 'stroke-dasharray': '4,2',
          rx: 3, 'pointer-events': 'none',
        }));
        svg.appendChild(svgEl('text', {
          x: r.x + r.w - 8, y: r.y + 12,
          'text-anchor': 'middle', fill: WARN_COLOR, 'font-size': '10', 'font-weight': '700', 'pointer-events': 'none',
        }, '⚠'));
      }
    }
  }

  function drawTCAnnotations(svg, wallId, wx, ww, lv, placer) {
    const wr = findWallResult(wallId);
    if (!wr || !lv.forceStripH) return;

    if (currentCombo === '1.0D') {
      const sY = lv.forceStripY;
      const midY = sY + lv.forceStripH / 2;
      const dlColor = '#78716c';
      const wLen = wr.length || 1;
      const dlKlf = wr.dlTotal / wLen;
      svg.appendChild(svgEl('rect', { x: wx + 1, y: sY + 2, width: ww - 2, height: lv.forceStripH - 4, fill: 'rgba(120,113,108,0.1)', rx: 2, 'pointer-events': 'none' }));
      const a = { x: wx + ww / 2, y: midY, 'text-anchor': 'middle', fill: dlColor, 'font-size': '9', 'font-weight': '600' };
      svg.appendChild(haloText(a, 'DL ' + dlKlf.toFixed(2) + ' klf'));
      placer.reserveText(a, 'DL ' + dlKlf.toFixed(2) + ' klf');
      return;
    }

    const { tL, tR, cL, cR, isAccum, own } = wallDisplayTC(wr, currentCombo);
    if (!tL && !tR && !cL && !cR) return;
    const mark = wr.mark || wr.wallId;
    const tipFor = (side, kind) => mark + ' ' + side + ' end ' + kind + ' (' + comboName(currentCombo) + ')' + (isAccum ? ' — Σ incl. loads from above; P row = this wall only' : ' — this wall only (nothing lands on it from above)');

    const tColor = TENSION_COLOR;
    const cColor = COMPR_COLOR;

    const sY = lv.forceStripY;
    const tRow = sY + T_ROW_DY;
    const cRow = sY + C_ROW_DY;
    const pRow = sY + P_ROW_DY;
    const prefix = isAccum ? 'Σ' : '';
    const valText = (v) => prefix + v.toFixed(2) + 'k';
    const ownText = (t, c) => 'P' + (t > 0 ? ' ▲' + t.toFixed(2) : '') + (c > 0 ? ' ▼' + c.toFixed(2) : '') + (t > 0 || c > 0 ? 'k' : ' 0');
    const ownTip = mark + ' P = this wall only (' + comboName(currentCombo) + ')'
      + (isAccum ? ', before loads from above — Σ rows below include them' : ' — nothing lands on it from above, so this is the full end force');

    // One centred column when the left + right labels of any row would not fit side by side
    const vw = (v) => isAccum && v > 0 ? textW(valText(v), 9) + 8 : 0;
    const need = Math.max(vw(tL) + vw(tR), vw(cL) + vw(cR), textW(ownText(own.tL, own.cL), 8) + textW(ownText(own.tR, own.cR), 8)) + 14;
    const narrow = need > ww;

    // Triangle + value; x = triangle centre (start) — right-side values are laid out from the wall's right edge
    function drawVal(x, y, val, color, isUp, tip) {
      if (!isAccum || val <= 0) return; // no Σ rows when they would repeat the P row
      const tri = isUp ? `${x - 4},${y} ${x + 4},${y} ${x},${y - 6}` : `${x - 4},${y - 4} ${x + 4},${y - 4} ${x},${y + 2}`;
      svg.appendChild(svgEl('polygon', { points: tri, fill: color, 'pointer-events': 'none' }));
      const label = valText(val);
      const tAttrs = { x: x + 6, y, 'dominant-baseline': 'middle', fill: color, 'font-size': '9', 'font-weight': '600' };
      svg.appendChild(isAccum
        ? richHaloText(tAttrs, [{ t: 'Σ', fill: SIGMA_COLOR }, { t: label.slice(1), fill: color }], undefined, tip)
        : haloText(tAttrs, label, undefined, tip));
      placer.reserve({ x: x - 4, y: y - 7, w: textW(label, 9) + 10, h: 11 });
    }
    const pText = (attrs, t, c) => {
      const parts = pParts(t, c, LIVE_PALETTE);
      svg.appendChild(richHaloText(attrs, parts, undefined, ownTip));
      placer.reserveText(attrs, partsText(parts));
    };

    if (narrow) {
      const cx = wx + ww / 2;
      const tMax = Math.max(tL, tR), cMax = Math.max(cL, cR);
      if (tMax > 0) drawVal(cx - vw(tMax) / 2 + 4, tRow, tMax, tColor, true, tipFor('max', 'tension'));
      if (cMax > 0) drawVal(cx - vw(cMax) / 2 + 4, cRow, cMax, cColor, false, tipFor('max', 'compression'));
      pText({ x: cx, y: pRow, 'text-anchor': 'middle', 'font-size': '8', 'font-weight': '600' }, Math.max(own.tL, own.tR), Math.max(own.cL, own.cR));
    } else {
      const leftX = wx + 6;
      const rightX = (v) => wx + ww - vw(v) + 2;
      drawVal(leftX, tRow, tL, tColor, true, tipFor('left', 'tension'));
      drawVal(rightX(tR), tRow, tR, tColor, true, tipFor('right', 'tension'));
      drawVal(leftX, cRow, cL, cColor, false, tipFor('left', 'compression'));
      drawVal(rightX(cR), cRow, cR, cColor, false, tipFor('right', 'compression'));
      pText({ x: wx + 3, y: pRow, 'font-size': '8', 'font-weight': '600' }, own.tL, own.cL);
      pText({ x: wx + ww - 3, y: pRow, 'text-anchor': 'end', 'font-size': '8', 'font-weight': '600' }, own.tR, own.cR);
    }
  }

  function dcColorFill(dc) {
    if (dc == null) return 'rgba(0,0,0,0.25)';
    if (dc > 1.0) return 'rgba(220,38,38,0.45)';
    if (dc >= 0.8) return 'rgba(234,179,8,0.4)';
    return 'rgba(34,197,94,0.35)';
  }

  function dcTextColor(dc) {
    if (dc == null) return '#fff';
    if (dc > 1.0) return '#fca5a5';
    if (dc >= 0.8) return '#fde68a';
    return '#86efac';
  }

  function drawHardwareLabels(svg, wr, wx, wy, ww, wh, placer, w) {
    if (ww < HW_MIN_WIDTH) return;
    const mk = (key) => (w && w[key] ? '✎' : '');

    const ancL = (wr.anchorageLeft ? wr.anchorageLeft.id : 'OVER') + mk('anchorageLeftOverride');
    const ancR = (wr.anchorageRight ? wr.anchorageRight.id : 'OVER') + mk('anchorageRightOverride');
    const postL = (wr.postLeft ? wr.postLeft.postLabel : 'OVER') + mk('postLeftOverride');
    const postR = (wr.postRight ? wr.postRight.postLabel : 'OVER') + mk('postRightOverride');

    const worstDCL = Math.max(wr.anchorageDCLeft || 0, wr.postDCLeft || 0);
    const worstDCR = Math.max(wr.anchorageDCRight || 0, wr.postDCRight || 0);
    const fillL = (!wr.anchorageLeft || !wr.postLeft) ? 'rgba(220,38,38,0.5)' : dcColorFill(worstDCL);
    const fillR = (!wr.anchorageRight || !wr.postRight) ? 'rgba(220,38,38,0.5)' : dcColorFill(worstDCR);

    svg.appendChild(svgEl('rect', { x: wx + 1, y: wy + 1, width: HW_EDGE_ZONE_W, height: wh - 2, fill: fillL, rx: 1, 'pointer-events': 'none' }));
    svg.appendChild(svgEl('rect', { x: wx + ww - HW_EDGE_ZONE_W - 1, y: wy + 1, width: HW_EDGE_ZONE_W, height: wh - 2, fill: fillR, rx: 1, 'pointer-events': 'none' }));
    if (placer) {
      placer.reserve({ x: wx + 1, y: wy + 1, w: HW_EDGE_ZONE_W, h: wh - 2 });
      placer.reserve({ x: wx + ww - HW_EDGE_ZONE_W - 1, y: wy + 1, w: HW_EDGE_ZONE_W, h: wh - 2 });
    }
    // Pending click-to-edit targets over each strip (appended after the labels so they sit on top)
    const stripTargets = w ? [['left', wx + 1], ['right', wx + ww - HW_EDGE_ZONE_W - 1]].map(([side, x]) => {
      const d = wallEndData(w, wr, side);
      const tip = (w.mark || w.id) + ' ' + side + ' end · ' + d.ancText + ' · ' + d.postText + (d.manual ? ' · manual override' : ' · auto') + ' · click to change';
      return svgEl('rect', { x, y: wy + 1, width: HW_EDGE_ZONE_W, height: wh - 2, fill: 'transparent', 'data-edit': 'wallEnd:' + w.id + ':' + side, 'data-tip': tip, style: { cursor: 'pointer' } });
    }) : [];

    const FS = 10;

    function hwLabel(x, y, text, color) {
      svg.appendChild(svgEl('text', {
        x, y, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
        fill: color, 'font-size': String(FS), 'font-weight': '600',
        stroke: 'rgba(0,0,0,0.55)', 'stroke-width': '3', 'paint-order': 'stroke', 'stroke-linejoin': 'round',
        transform: 'rotate(-90,' + x + ',' + y + ')', 'pointer-events': 'none',
      }, text));
    }

    const pad = 6;
    const usableH = wh - pad * 2;

    const lCol1 = wx + HW_COL_INSET_1;
    const lCol2 = wx + HW_COL_INSET_2;
    const rCol1 = wx + ww - HW_COL_INSET_2;
    const rCol2 = wx + ww - HW_COL_INSET_1;

    if (usableH >= 24) {
      const topY = wy + pad + usableH * 0.25;
      const botY = wy + pad + usableH * 0.75;

      hwLabel(lCol1, topY, ancL, !!wr.anchorageLeft ? '#fff' : '#fca5a5');
      hwLabel(lCol1, botY, wr.anchorageDCLeft != null ? wr.anchorageDCLeft.toFixed(2) : '—', dcTextColor(wr.anchorageDCLeft));
      hwLabel(lCol2, topY, postL, !!wr.postLeft ? '#fff' : '#fca5a5');
      hwLabel(lCol2, botY, wr.postDCLeft != null ? wr.postDCLeft.toFixed(2) : '—', dcTextColor(wr.postDCLeft));

      hwLabel(rCol1, topY, ancR, !!wr.anchorageRight ? '#fff' : '#fca5a5');
      hwLabel(rCol1, botY, wr.anchorageDCRight != null ? wr.anchorageDCRight.toFixed(2) : '—', dcTextColor(wr.anchorageDCRight));
      hwLabel(rCol2, topY, postR, !!wr.postRight ? '#fff' : '#fca5a5');
      hwLabel(rCol2, botY, wr.postDCRight != null ? wr.postDCRight.toFixed(2) : '—', dcTextColor(wr.postDCRight));
    }
    stripTargets.forEach(t => svg.appendChild(t));
  }

  // Demand + current hardware at one wall end
  function wallEndData(w, wr, side) {
    const S1 = side === 'left' ? 'Left' : 'Right', k = side === 'left' ? 'L' : 'R';
    const T = wr.hwDemand ? wr.hwDemand['t' + k] : wr['governingTension' + S1];
    const C = wr.hwDemand ? wr.hwDemand['c' + k] : wr['governingCompr' + S1];
    const anc = wr['anchorage' + S1], post = wr['post' + S1];
    const ancDC = wr['anchorageDC' + S1], postDC = wr['postDC' + S1];
    const f2 = (v) => (v || 0).toFixed(2);
    return {
      T, C, anc, post, ancDC, postDC, S1,
      manual: !!(w['anchorage' + S1 + 'Override'] || w['post' + S1 + 'Override']),
      ancText: (anc ? anc.id + ' T ' + f2(T) + 'k / ' + f2(anc.cap / 1000) + 'k → ' + (ancDC != null ? f2(ancDC) : '—') : 'OVER T ' + f2(T) + 'k'),
      postText: (post ? post.postLabel + ' C ' + f2(C) + 'k / ' + f2(post.capacityKips) + 'k → ' + (postDC != null ? f2(postDC) : '—') : 'OVER C ' + f2(C) + 'k'),
    };
  }

  function findWallResult(wallId) {
    if (!wallResults) return null;
    for (const pl of (wallResults.perLevel || [])) {
      const wr = (pl.walls || []).find(w => w.wallId === wallId);
      if (wr) return wr;
    }
    return null;
  }

  function selectElement(type, id) {
    selectedWallId = type === 'wall' ? id : null;
    selectedBeamId = type === 'beam' ? id : null;
    selectedPostId = type === 'post' ? id : null;
    renderPropPanel();
    drawSVG();
  }

  // === Property panels ===

  const panelRow = (...items) => el('div', { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.5rem' } }, ...items);
  const panelField = (label, inputEl) => el('div', { className: 'form-group', style: { marginBottom: 0, minWidth: '80px' } }, el('label', { className: 'form-label' }, label), inputEl);
  const panelTitle = (text) => el('div', { style: { fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.9rem' } }, text);
  const panelSub = (text) => el('div', { style: { fontSize: '0.8rem', fontWeight: '500', margin: '0.5rem 0 0.25rem', color: 'var(--ink-secondary)' } }, text);

  function comboLabel() { return !currentCombo || currentCombo === 'governing' ? 'ASD envelope' : currentCombo; }

  // Force text for the load path tables: envelope T/C or the selected combo's signed value
  function forceText(map, env) {
    const entries = forceEntries(map, env ? env.T : 0, env ? env.C : 0, currentCombo || 'governing');
    if (!entries.length) return '—';
    return entries.map(en => (en.kind === 'T' ? 'T ▲' : 'C ▼') + en.val.toFixed(2) + 'k').join('  ');
  }

  function loadPathTable(headers, rows) {
    const tbl = el('table', { className: 'data-table', style: { fontSize: '0.8rem', marginBottom: '0.5rem' } });
    tbl.appendChild(el('tr', null, ...headers.map(h => el('th', null, h))));
    rows.forEach(r => tbl.appendChild(el('tr', null, ...r.map(c => el('td', { className: 'mono' }, c)))));
    return el('div', { className: 'table-scroll' }, tbl);
  }

  function hwSelect(obj, key, items, labelFn, width) {
    const sel = el('select', { className: 'form-select', style: { width: width || '110px' }, onChange(e) { obj[key] = e.target.value; markChanged(); } });
    sel.appendChild(el('option', { value: '' }, 'Auto'));
    items.forEach(it => {
      const opt = el('option', { value: it.id }, labelFn(it));
      if (obj[key] === it.id) opt.selected = true;
      sel.appendChild(opt);
    });
    return sel;
  }
  const ancLabelFn = (it) => it.id + ' (' + (it.cap / 1000).toFixed(1) + 'k)';
  const postItems = [...(POST_SIZES['4'] || []), ...(POST_SIZES['6'] || [])];
  const postLabelFn = (it) => it.label;

  function renderPropPanel() {
    clearEl(propPanel);
    if (selectedBeamId) { renderBeamPropPanel(); return; }
    if (selectedPostId) { renderPostPropPanel(); return; }
    if (!selectedWallId) { propPanel.hidden = true; return; }
    const w = (line.walls || []).find(ww => ww.id === selectedWallId);
    if (!w) { propPanel.hidden = true; return; }
    propPanel.hidden = false;

    const markInput = el('input', { className: 'form-input mono', type: 'text', value: w.mark || '', style: { width: '90px' }, onChange(e) { w.mark = e.target.value; markChanged(); drawSVG(); } });
    const posInput = el('input', { className: 'form-input mono', type: 'number', step: 'any', value: numOrBlank(w.position), style: { width: '70px' }, onChange(e) { w.position = e.target.value; markChanged(); drawSVG(); } });
    const lenInput = el('input', { className: 'form-input mono', type: 'number', step: 'any', value: numOrBlank(w.length), style: { width: '70px' }, onChange(e) { w.length = e.target.value; markChanged(); drawSVG(); } });

    const dlTypeSelect = el('select', { className: 'form-select', style: { width: '120px' }, onChange(e) { w.wallDLTypeId = e.target.value; markChanged(); } });
    dlTypeSelect.appendChild(el('option', { value: '' }, '— None —'));
    (wallDLTypes || []).forEach(t => {
      const opt = el('option', { value: t.id }, (t.name || '?') + ' (' + (t.psf || 0) + ' psf)');
      if (w.wallDLTypeId === t.id) opt.selected = true;
      dlTypeSelect.appendChild(opt);
    });

    const deleteBtn = el('button', { className: 'btn btn-sm btn-danger', type: 'button', onClick() { deleteSelected(); } }, 'Delete Wall');

    propPanel.appendChild(panelTitle('Wall Properties — ' + (w.mark || w.id)));
    propPanel.appendChild(panelRow(panelField('Mark', markInput), panelField('Position (ft)', posInput), panelField('Length (ft)', lenInput), panelField('Wall DL Type', dlTypeSelect)));

    const nailSel = el('select', { className: 'form-select', style: { width: '130px' }, onChange(e) { w.nailingPattern = e.target.value; markChanged(); } });
    nailSel.appendChild(el('option', { value: '' }, 'Auto'));
    NAILING_TABLE.forEach(n => {
      const opt = el('option', { value: n.id }, n.label + ' (' + n.asdE + '/' + n.asdW + ')');
      if (w.nailingPattern === n.id) opt.selected = true;
      nailSel.appendChild(opt);
    });

    const ancItems = hwOptionsFor(levels[levelIndexOf(w.levelId)]);

    propPanel.appendChild(panelRow(panelField('Nailing', nailSel)));
    propPanel.appendChild(panelSub('Hardware Overrides (blank = auto-select)'));
    propPanel.appendChild(panelRow(
      panelField('HD/Strap Left', hwSelect(w, 'anchorageLeftOverride', ancItems, ancLabelFn)),
      panelField('HD/Strap Right', hwSelect(w, 'anchorageRightOverride', ancItems, ancLabelFn)),
    ));
    propPanel.appendChild(panelRow(
      panelField('Post Left', hwSelect(w, 'postLeftOverride', postItems, postLabelFn)),
      panelField('Post Right', hwSelect(w, 'postRightOverride', postItems, postLabelFn)),
    ));

    if (wallResults) {
      const wr = findWallResult(w.id);
      const deliveries = (wallResults.wallDeliveries || []).filter(d => d.wallId === w.id);
      if (deliveries.length) {
        propPanel.appendChild(panelSub('Load path — delivers to'));
        propPanel.appendChild(loadPathTable(['End', 'Receiver'], deliveries.map(d => [d.side === 'left' ? 'Left' : 'Right', receiverText(d.receiver)])));
      }
      if (wr && wr.injections && wr.injections.length) {
        propPanel.appendChild(panelSub('Load path — loads received from above (' + comboLabel() + ')'));
        const markOf = (id) => ((line.walls || []).find(ww => ww.id === id) || {}).mark || id;
        propPanel.appendChild(loadPathTable(['Source', 'Lands on', 'Force'], wr.injections.map(s => [
          s.label, (s.viaWallId ? markOf(s.viaWallId) + ' ' : '') + (s.side === 'left' ? 'left end' : 'right end'), forceText(s.map, s.env)])));
        if (wr.hwDemand) {
          const d = wr.hwDemand;
          propPanel.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)', marginBottom: '0.5rem' } },
            'Hardware demand incl. loads from above: T L ' + d.tL.toFixed(2) + 'k / R ' + d.tR.toFixed(2) + 'k, C L ' + d.cL.toFixed(2) + 'k / R ' + d.cR.toFixed(2) + 'k'));
        }
      }
    }
    propPanel.appendChild(panelRow(deleteBtn));
  }

  function renderBeamPropPanel() {
    const b = (line.beams || []).find(bb => bb.id === selectedBeamId);
    if (!b) { propPanel.hidden = true; return; }
    propPanel.hidden = false;
    if (!b.supports) b.supports = [];
    const lvl = levels[levelIndexOf(b.levelId)];
    const refresh = () => { markChanged(); renderPropPanel(); drawSVG(); };
    const defaultType = (x) => postBelowAt(b.levelId, x) ? 'post' : 'point';

    const markInput = el('input', { className: 'form-input mono', type: 'text', value: b.mark || '', style: { width: '80px' },
      onChange(e) { b.mark = e.target.value; refresh(); } });
    const posInput = el('input', { className: 'form-input mono', type: 'number', step: 'any', value: numOrBlank(b.position), style: { width: '70px' },
      onChange(e) { b.position = e.target.value; refresh(); } });
    const lenInput = el('input', { className: 'form-input mono', type: 'number', step: 'any', value: numOrBlank(b.length), style: { width: '70px' },
      onChange(e) { b.length = e.target.value; refresh(); } });
    const deleteBtn = el('button', { className: 'btn btn-sm btn-danger', type: 'button', onClick() { deleteSelected(); } }, 'Delete Beam');

    propPanel.appendChild(panelTitle('Transfer Beam — ' + (b.mark || b.id) + ' (floor line below ' + ((lvl && lvl.name) || '?') + ')'));
    propPanel.appendChild(panelRow(panelField('Mark', markInput), panelField('Position (ft)', posInput), panelField('Span (ft)', lenInput)));

    const bt = wallResults && (wallResults.beamTransfers || []).find(t => t.beamId === b.id);
    propPanel.appendChild(panelSub('Supports (exactly 2) — Point = support at this level, Post = post in the story below'));
    const sTbl = el('table', { className: 'dynamic-table', style: { fontSize: '0.85rem' } });
    sTbl.appendChild(el('tr', null, el('th', null, 'Position (ft)'), el('th', null, 'Type'), el('th', null, 'HD/Strap'), el('th', null, 'Goes to'), el('th', { className: 'row-actions' }, '')));
    b.supports.forEach((s, i) => {
      const typeSel = el('select', { className: 'form-select', style: { width: '80px' }, onChange(e) { s.type = e.target.value; refresh(); } },
        el('option', { value: 'point', selected: s.type !== 'post' }, 'Point'),
        el('option', { value: 'post', selected: s.type === 'post' }, 'Post'));
      const sr = bt && bt.supports.find(x => x.supportId === s.id);
      const goesTo = sr ? receiverText(sr.receiver) : s.type === 'post' ? ((postBelowAt(b.levelId, num(s.position)) || {}).mark || 'no post below') : '—';
      sTbl.appendChild(el('tr', null,
        el('td', null, el('input', { type: 'number', step: 'any', value: numOrBlank(s.position), style: { width: '70px' }, onChange(e) { s.position = e.target.value; refresh(); } })),
        el('td', null, typeSel),
        el('td', null, hwSelect(s, 'anchorageOverride', hwOptionsFor(lvl), ancLabelFn, '100px')),
        el('td', { className: 'mono', style: { fontSize: '0.8rem' } }, goesTo),
        el('td', { className: 'row-actions' }, el('button', { className: 'btn btn-ghost btn-sm', type: 'button', onClick() { b.supports.splice(i, 1); refresh(); } }, '×')),
      ));
    });
    propPanel.appendChild(sTbl);

    const bs = num(b.position), be = bs + num(b.length);
    const addSupportBtn = el('button', { className: 'btn btn-sm', type: 'button', disabled: b.supports.length >= 2, style: { marginTop: '0.25rem', marginRight: '0.5rem' },
      onClick() {
        const x = b.supports.length && Math.abs(num(b.supports[0].position) - bs) <= POS_TOL ? be : bs;
        b.supports.push(newBeamSupport(x, defaultType(x)));
        refresh();
      } }, '+ Support');
    const endsBtn = el('button', { className: 'btn btn-sm', type: 'button', style: { marginTop: '0.25rem' },
      onClick() {
        b.supports = [bs, be].map(x => newBeamSupport(x, defaultType(x)));
        refresh();
      } }, 'Supports at both ends');
    propPanel.appendChild(el('div', { style: { marginBottom: '0.5rem' } }, addSupportBtn, endsBtn));

    if (bt) {
      if (bt.loads.length) {
        propPanel.appendChild(panelSub('Load path — loads on beam (' + comboLabel() + ')'));
        propPanel.appendChild(loadPathTable(['Source', 'At (ft)', 'Force'], bt.loads.map(ld => [ld.label, ld.x.toFixed(2), forceText(ld.map, ld.env)])));
      }
      if (bt.supports.length) {
        propPanel.appendChild(panelSub('Load path — reactions (' + comboLabel() + ')'));
        propPanel.appendChild(loadPathTable(['Support', 'Reaction', 'Hardware', 'Goes to'], bt.supports.map(sr => {
          const a = anchorageText(sr);
          return [sr.position.toFixed(2) + ' ft ' + (sr.type === 'post' ? '(Post)' : '(Point)'), forceText(sr.perCombo, { T: sr.envelopeT, C: sr.envelopeC }), a.text, receiverText(sr.receiver)];
        })));
      }
      propPanel.appendChild(el('div', { style: { fontSize: '0.75rem', color: 'var(--ink-tertiary)', marginBottom: '0.5rem' } },
        'Reactions are from shear wall end forces and posts only — add floor gravity load when designing the beam.'));
    }
    propPanel.appendChild(panelRow(deleteBtn));
  }

  function renderPostPropPanel() {
    const sp = (line.supportPosts || []).find(pp => pp.id === selectedPostId);
    if (!sp) { propPanel.hidden = true; return; }
    propPanel.hidden = false;
    const li = levelIndexOf(sp.levelId);
    const lvl = levels[li];
    const refresh = () => { markChanged(); renderPropPanel(); drawSVG(); };

    const markInput = el('input', { className: 'form-input mono', type: 'text', value: sp.mark || '', style: { width: '70px' },
      onChange(e) { sp.mark = e.target.value; refresh(); } });
    const posInput = el('input', { className: 'form-input mono', type: 'number', step: 'any', value: numOrBlank(sp.position), style: { width: '70px' },
      onChange(e) { sp.position = e.target.value; refresh(); } });
    const storySel = el('select', { className: 'form-select', style: { width: '110px' }, onChange(e) { sp.levelId = e.target.value; refresh(); } });
    levels.forEach(l => storySel.appendChild(el('option', { value: l.id, selected: l.id === sp.levelId }, l.name || l.id)));

    const isBottom = li === levels.length - 1;
    const hasBelow = !!postBelowAt(sp.levelId, num(sp.position));
    const extendBtn = el('button', { className: 'btn btn-sm', type: 'button', disabled: isBottom || hasBelow,
      title: isBottom ? 'Already at the bottom story' : hasBelow ? 'A post already exists below' : '',
      onClick() {
        const np = newSupportPost(levels[li + 1].id, num(sp.position));
        line.supportPosts.push(np);
        selectedPostId = np.id;
        refresh();
      } }, 'Extend post down');
    const deleteBtn = el('button', { className: 'btn btn-sm btn-danger', type: 'button', onClick() { deleteSelected(); } }, 'Delete Post');

    propPanel.appendChild(panelTitle('Post — ' + (sp.mark || sp.id) + ' (spans ' + ((lvl && lvl.name) || '?') + ')'));
    propPanel.appendChild(panelRow(panelField('Mark', markInput), panelField('Position (ft)', posInput), panelField('Story', storySel)));
    propPanel.appendChild(panelSub('Hardware Overrides (blank = auto-select)'));
    propPanel.appendChild(panelRow(
      panelField('Base HD/Strap', hwSelect(sp, 'anchorageOverride', hwOptionsFor(lvl), ancLabelFn)),
      panelField('Post Size', hwSelect(sp, 'postOverride', postItems, postLabelFn)),
    ));

    const pp = wallResults && (wallResults.postPaths || []).find(p => p.postId === sp.id);
    if (pp) {
      propPanel.appendChild(panelSub('Load path — loads received (' + comboLabel() + ')'));
      if (pp.sources.length) {
        propPanel.appendChild(loadPathTable(['Source', 'Force'], [
          ...pp.sources.map(s => [s.label, forceText(s.map, s.env)]),
          ['Σ Total', forceText(pp.perCombo, { T: pp.envelopeT, C: pp.envelopeC })],
        ]));
      } else {
        propPanel.appendChild(el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-tertiary)', marginBottom: '0.5rem' } }, 'No load from above.'));
      }
      const a = anchorageText(pp);
      const postTxt = pp.post ? pp.post.postLabel + ' (' + pp.post.capacityKips + 'k' + (pp.postDC != null ? ', D/C ' + pp.postDC.toFixed(2) : '') + ')' : 'OVER CAPACITY';
      propPanel.appendChild(loadPathTable(['Delivers to', 'Base HD/Strap', 'Post'], [[receiverText(pp.receiver), a.text, postTxt]]));
    }
    propPanel.appendChild(panelRow(extendBtn, deleteBtn));
  }

  function renderGravitySection() {
    clearEl(gravSection);
    gravSection.appendChild(el('div', { style: { fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.9rem' } }, 'Gravity Loads (Floor/Roof DL)'));

    for (const lvl of levels) {
      if (!line.gravityLoads) line.gravityLoads = {};
      if (!line.gravityLoads[lvl.id]) line.gravityLoads[lvl.id] = { uniform: [], point: [] };
      const gl = line.gravityLoads[lvl.id];

      const lvlPanel = el('div', { style: { marginBottom: '0.75rem', padding: '0.5rem', border: '1px solid var(--border-light)', borderRadius: '4px' } });
      lvlPanel.appendChild(el('div', { style: { fontWeight: '500', fontSize: '0.85rem', marginBottom: '0.25rem' } }, lvl.name || lvl.id));

      const uTable = el('table', { className: 'dynamic-table', style: { fontSize: '0.85rem' } });
      uTable.appendChild(el('tr', null, el('th', null, 'Start (ft)'), el('th', null, 'End (ft)'), el('th', null, 'DL (plf)'), el('th', { className: 'row-actions' }, '')));
      gl.uniform.forEach((u, i) => {
        uTable.appendChild(el('tr', null,
          el('td', null, el('input', { type: 'number', step: 'any', value: numOrBlank(u.start), style: { width: '60px' }, onChange(e) { u.start = e.target.value; if (onGravityChange) onGravityChange(); markChanged(); drawSVG(); } })),
          el('td', null, el('input', { type: 'number', step: 'any', value: numOrBlank(u.end), style: { width: '60px' }, onChange(e) { u.end = e.target.value; if (onGravityChange) onGravityChange(); markChanged(); drawSVG(); } })),
          el('td', null, el('input', { type: 'number', step: 'any', value: numOrBlank(u.dlPlf), style: { width: '70px' }, onChange(e) { u.dlPlf = e.target.value; if (onGravityChange) onGravityChange(); markChanged(); drawSVG(); } })),
          el('td', { className: 'row-actions' }, el('button', { className: 'btn btn-ghost btn-sm', type: 'button', onClick() { gl.uniform.splice(i, 1); renderGravitySection(); if (onGravityChange) onGravityChange(); markChanged(); drawSVG(); } }, '×')),
        ));
      });
      lvlPanel.appendChild(uTable);
      lvlPanel.appendChild(el('button', { className: 'btn btn-sm', type: 'button', style: { marginRight: '0.5rem', marginTop: '0.25rem' }, onClick() { gl.uniform.push(newUniformLoad(0, parseFloat(line.totalLength) || 60)); renderGravitySection(); markChanged(); drawSVG(); } }, '+ Uniform'));

      const pTable = el('table', { className: 'dynamic-table', style: { fontSize: '0.85rem', marginTop: '0.5rem' } });
      if (gl.point.length > 0) {
        pTable.appendChild(el('tr', null, el('th', null, 'Position (ft)'), el('th', null, 'DL (kips)'), el('th', { className: 'row-actions' }, '')));
        gl.point.forEach((p, i) => {
          pTable.appendChild(el('tr', null,
            el('td', null, el('input', { type: 'number', step: 'any', value: numOrBlank(p.position), style: { width: '60px' }, onChange(e) { p.position = e.target.value; if (onGravityChange) onGravityChange(); markChanged(); drawSVG(); } })),
            el('td', null, el('input', { type: 'number', step: 'any', value: numOrBlank(p.dlKips), style: { width: '70px' }, onChange(e) { p.dlKips = e.target.value; if (onGravityChange) onGravityChange(); markChanged(); drawSVG(); } })),
            el('td', { className: 'row-actions' }, el('button', { className: 'btn btn-ghost btn-sm', type: 'button', onClick() { gl.point.splice(i, 1); renderGravitySection(); if (onGravityChange) onGravityChange(); markChanged(); drawSVG(); } }, '×')),
          ));
        });
        lvlPanel.appendChild(pTable);
      }
      lvlPanel.appendChild(el('button', { className: 'btn btn-sm', type: 'button', style: { marginTop: '0.25rem' }, onClick() { gl.point.push(newPointLoad(0)); renderGravitySection(); markChanged(); drawSVG(); } }, '+ Point Load'));

      gravSection.appendChild(lvlPanel);
    }
  }

  // Symbol legend for the active overlays
  function buildLegend() {
    clearEl(legendRow);
    const forces = !!(wallResults && showForcesOn);
    const hw = !!(wallResults && showHardwareOn);
    legendRow.hidden = !forces && !hw;
    if (legendRow.hidden) return;
    const item = (glyph, color, label) => el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '3px', whiteSpace: 'nowrap' } },
      el('span', { style: { color, fontWeight: '700' } }, glyph), label);
    const swatch = (color, label) => el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '3px' } },
      el('span', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: color } }), label);
    if (forces) {
      legendRow.appendChild(item('▲', TENSION_COLOR, 'tension'));
      legendRow.appendChild(item('▼', COMPR_COLOR, 'compression'));
      legendRow.appendChild(item('Σ', SIGMA_COLOR, 'incl. loads from above'));
      legendRow.appendChild(item('P', 'var(--ink-secondary)', 'this element only'));
      legendRow.appendChild(item('R', BEAM_COLOR, 'beam reaction'));
      legendRow.appendChild(item('●', 'var(--ink)', 'connected'));
      legendRow.appendChild(item('○', WARN_COLOR, 'needs post'));
    }
    if (hw) {
      legendRow.appendChild(item('△', BEAM_COLOR, 'point support'));
      legendRow.appendChild(item('■', BEAM_COLOR, 'post support'));
      legendRow.appendChild(item('◆', BEAM_COLOR, 'post to fdn'));
      legendRow.appendChild(item('┆', BEAM_COLOR, 'post inside wall'));
      legendRow.appendChild(swatch('rgba(34,197,94,0.6)', 'D/C < 0.8'));
      legendRow.appendChild(swatch('rgba(234,179,8,0.65)', '0.8–1.0'));
      legendRow.appendChild(swatch('rgba(220,38,38,0.6)', '> 1.0'));
      legendRow.appendChild(item('✎', 'var(--ink-secondary)', 'manual override (click nailing / hardware to change)'));
    }
  }

  function buildComboRow() {
    clearEl(comboRow);
    if (!wallResults) { comboRow.hidden = true; buildLegend(); return; }
    comboRow.hidden = false;

    const forcesChk = el('input', { type: 'checkbox', checked: showForcesOn, onChange(e) {
      showForcesOn = e.target.checked;
      if (showForcesOn && !currentCombo) currentCombo = 'governing';
      buildComboRow();
      drawSVG();
    } });
    comboRow.appendChild(el('label', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', fontWeight: '500', cursor: 'pointer' } }, forcesChk, 'Forces'));

    if (showForcesOn) {
      const sel = el('select', { className: 'form-select', style: { maxWidth: '220px', fontSize: '0.85rem', marginLeft: '0.25rem' }, onChange(e) { currentCombo = e.target.value || 'governing'; renderPropPanel(); drawSVG(); } });

      const sampleWall = (wallResults.perLevel || []).flatMap(pl => pl.walls || [])[0];
      const comboKeys = sampleWall && sampleWall.combos ? Object.keys(sampleWall.combos) : [];
      const asdKeys = comboKeys.filter(k => { const c = sampleWall.combos[k]; return !c.group || c.group === 'asd'; });
      const caseKeys = comboKeys.filter(k => { const c = sampleWall.combos[k]; return c.group === 'load_case'; });

      const envGroup = el('optgroup', { label: 'Envelope' });
      envGroup.appendChild(el('option', { value: 'governing' }, 'ASD Governing'));
      sel.appendChild(envGroup);
      if (asdKeys.length) {
        const asdGroup = el('optgroup', { label: 'ASD Combos' });
        for (const key of asdKeys) asdGroup.appendChild(el('option', { value: key }, key));
        sel.appendChild(asdGroup);
      }
      if (caseKeys.length) {
        const lcGroup = el('optgroup', { label: 'Load Cases' });
        for (const key of caseKeys) lcGroup.appendChild(el('option', { value: key }, key));
        sel.appendChild(lcGroup);
      }
      if (currentCombo) {
        const opt = sel.querySelector('option[value="' + currentCombo + '"]');
        if (opt) opt.selected = true;
      }
      comboRow.appendChild(sel);
    }

    const hwChk = el('input', { type: 'checkbox', checked: showHardwareOn, onChange(e) {
      showHardwareOn = e.target.checked;
      buildLegend();
      drawSVG();
    } });
    comboRow.appendChild(el('label', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', fontWeight: '500', cursor: 'pointer', marginLeft: '1rem' } }, hwChk, 'Hardware'));

    buildLegend();

    comboRow.appendChild(el('button', {
      className: 'btn btn-sm btn-ghost', type: 'button',
      style: { marginLeft: 'auto', fontSize: '0.8rem', padding: '2px 6px' },
      onClick() { clearResults(); },
    }, '×'));
  }

  function refresh(updatedLine, updatedLevels, updatedWallDLTypes) {
    if (updatedLine) Object.assign(line, updatedLine);
    if (updatedLevels) levels.splice(0, levels.length, ...updatedLevels);
    if (updatedWallDLTypes) wallDLTypes.splice(0, wallDLTypes.length, ...updatedWallDLTypes);
    renderGravitySection();
    drawSVG();
  }

  function showResults(lineResults) {
    const refreshing = !!wallResults;
    wallResults = lineResults;
    if (wallResults && !refreshing) {
      showForcesOn = true;
      showHardwareOn = true;
      if (!currentCombo) currentCombo = 'governing';
    }
    handle.hasResults = !!wallResults;
    buildComboRow();
    renderPropPanel();
    drawSVG();
  }

  function clearResults() {
    wallResults = null;
    showForcesOn = false;
    showHardwareOn = false;
    currentCombo = null;
    handle.hasResults = false;
    buildComboRow();
    renderPropPanel();
    drawSVG();
  }

  function deleteSelected() {
    if (selectedWallId) {
      const idx = (line.walls || []).findIndex(ww => ww.id === selectedWallId);
      if (idx >= 0) line.walls.splice(idx, 1);
      if (onWallChange) onWallChange();
    } else if (selectedBeamId) {
      const idx = (line.beams || []).findIndex(bb => bb.id === selectedBeamId);
      if (idx >= 0) line.beams.splice(idx, 1);
    } else if (selectedPostId) {
      const idx = (line.supportPosts || []).findIndex(pp => pp.id === selectedPostId);
      if (idx >= 0) line.supportPosts.splice(idx, 1);
    } else {
      return false;
    }
    selectedWallId = selectedBeamId = selectedPostId = null;
    propPanel.hidden = true;
    drawSVG();
    markChanged();
    return true;
  }

  // Delete / Backspace removes the selected element; Esc deselects, returns to Select mode, then collapses
  function onKeyDown(e) {
    if (!wrapper.isConnected) return;
    const t = e.target;
    if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (deleteSelected()) e.preventDefault();
    } else if (e.key === 'Escape') {
      if (!quickEdit.hidden) {
        hideQuickEdit();
      } else if (!chooser.hidden) {
        hideChooser();
      } else if (selectedWallId || selectedBeamId || selectedPostId || placementMode !== 'none') {
        placementMode = 'none';
        buildToolbar();
        selectElement('wall', null);
      } else if (isExpanded) {
        toggleExpand();
      }
    }
  }
  document.addEventListener('keydown', onKeyDown);

  function destroy() {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('mousedown', onDocMouseDown);
    if (isExpanded) toggleExpand();
    clearEl(wrapper);
  }

  renderGravitySection();
  setTimeout(drawSVG, 0);

  const handle = { destroy, refresh, showResults, clearResults, drawSVG, hasResults: false };
  return handle;
}

// === Static SVG renderer for PDF ===

function pdfHaloText(attrs, text) {
  const g = svgEl('g');
  g.appendChild(svgEl('text', { ...attrs, stroke: PDF_COLORS.surface, 'stroke-width': '2.5', 'paint-order': 'stroke', fill: PDF_COLORS.surface }, text));
  g.appendChild(svgEl('text', { ...attrs }, text));
  return g;
}

const PDF_LEGEND_H = 22;

// One-line symbol legend under the PDF elevation
function drawPdfLegend(svg, y, x0, maxX) {
  const C = PDF_COLORS;
  const items = [
    ['▲', C.tension, 'tension'], ['▼', C.compression, 'compression'], ['Σ', SIGMA_COLOR, 'incl. loads from above'],
    ['P', C.inkSecondary, 'this element only'], ['R', C.beam, 'beam reaction'], ['●', C.ink, 'connected'], ['○', C.fail, 'needs post'],
    ['△', C.beam, 'point support'], ['■', C.beam, 'post support'], ['◆', C.beam, 'post to fdn'], ['┆', C.beam, 'post inside wall'], ['*', C.ink, 'manual override'],
  ];
  let x = x0, row = 0;
  for (const [glyph, color, label] of items) {
    const w = textW(glyph + ' ' + label, 7) + 10;
    if (x + w > maxX && x > x0) { x = x0; row++; }
    const yy = y + row * 10;
    svg.appendChild(svgEl('text', { x, y: yy, fill: color, 'font-size': '7', 'font-weight': '700' }, glyph));
    svg.appendChild(svgEl('text', { x: x + 8, y: yy, fill: C.inkSecondary, 'font-size': '7' }, label));
    x += w;
  }
}

// Height / width of the PDF elevation (layout + legend strip)
export function pdfElevationAspect(line, levels, width, hasResults) {
  const l = computeElevationLayout(line, levels, { width, showForces: !!hasResults, showHW: !!hasResults });
  return (l.totalH + (hasResults ? PDF_LEGEND_H : 0)) / l.svgW;
}

export function renderElevationForPdf(line, levels, wallDLTypes, lineResults, width) {
  const C = PDF_COLORS;
  const layout = computeElevationLayout(line, levels, { width, showForces: !!lineResults, showHW: !!lineResults });
  const { totalLen, pxPerFt, svgW, levelYs } = layout;
  const legendH = lineResults ? PDF_LEGEND_H : 0;
  const totalH = layout.totalH + legendH;
  const beams = line.beams || [];
  const placer = createLabelPlacer({ minX: GUTTER, maxX: svgW });

  const svg = svgEl('svg', { xmlns: 'http://www.w3.org/2000/svg', width: svgW, height: totalH, viewBox: '0 0 ' + svgW + ' ' + totalH, 'font-family': 'Helvetica, Arial, sans-serif' });
  svg.appendChild(svgEl('rect', { x: 0, y: 0, width: svgW, height: totalH, fill: C.surface }));

  // Ruler grid
  const rulerBottom = layout.totalH;
  for (let i = 0; i <= totalLen; i += 5) {
    const x = GUTTER + i * pxPerFt;
    const isMajor = i % 10 === 0;
    svg.appendChild(svgEl('line', { x1: x, y1: RULER_H, x2: x, y2: rulerBottom - 10, stroke: isMajor ? C.borderLight : C.border, 'stroke-width': isMajor ? 1 : 0.5, 'stroke-dasharray': isMajor ? 'none' : '2,4' }));
    if (isMajor) svg.appendChild(svgEl('text', { x, y: rulerBottom - 2, 'text-anchor': 'middle', fill: C.inkTertiary, 'font-size': '8' }, String(i)));
  }

  drawBandBackdrops(svg, layout, PDF_PALETTE);

  // Floor lines + level names
  for (const lv of levelYs) {
    svg.appendChild(svgEl('line', { x1: GUTTER, y1: lv.y, x2: GUTTER + totalLen * pxPerFt, y2: lv.y, stroke: C.border, 'stroke-width': 1 }));
    svg.appendChild(svgEl('text', { x: GUTTER - 4, y: lv.bodyY + 12, 'text-anchor': 'end', fill: C.ink, 'font-size': '9', 'font-weight': '600' }, lv.name || ''));
    svg.appendChild(svgEl('text', { x: GUTTER - 4, y: lv.bodyY + 22, 'text-anchor': 'end', fill: C.inkTertiary, 'font-size': '7' }, lv.ftH.toFixed(0) + ' ft'));
  }
  if (levelYs.length) {
    const fy = levelYs[levelYs.length - 1].floorY;
    svg.appendChild(svgEl('line', { x1: GUTTER, y1: fy, x2: GUTTER + totalLen * pxPerFt, y2: fy, stroke: C.ink, 'stroke-width': 1.5 }));
  }

  // Walls with D/C coloring
  const walls = line.walls || [];
  const wrMap = {};
  if (lineResults) {
    for (const pl of (lineResults.perLevel || [])) {
      for (const wr of (pl.walls || [])) wrMap[wr.wallId] = wr;
    }
  }

  for (const w of walls) {
    const lv = levelYs.find(l => l.id === w.levelId);
    if (!lv) continue;
    const r = wallRectOf(w, lv, beams, pxPerFt);
    const body = wallBodyOf(lv);
    const wx = r.x, ww = r.w;
    const wr = wrMap[w.id];

    let fill = C.accent;
    if (wr) {
      if (wr.dcRatio > 1.0) fill = C.fail;
      else if (wr.dcRatio > 0.8) fill = C.stale;
      else fill = C.pass;
    }

    svg.appendChild(svgEl('rect', { x: wx, y: r.y, width: Math.max(ww, 2), height: Math.max(r.h, 8), fill, opacity: 0.7, stroke: C.ink, 'stroke-width': 1, rx: 2 }));
    if (lineResults) drawWallBandScrim(svg, r, lv, C.surface);
    const markAttrs = { x: wx + ww / 2, y: body.y + body.h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#fff', 'font-size': ww > 40 ? '10' : '8', 'font-weight': '600' };
    svg.appendChild(wallText(markAttrs, w.mark || w.id));
    placer.reserveText(markAttrs, w.mark || w.id);

    // Governing T/C at each end, in the T/C strip (one centred column when the pair would not fit)
    if (wr && lv.forceStripH) {
      const { tL, tR, cL, cR, isAccum, own } = wallDisplayTC(wr, 'governing');
      const pre = isAccum ? 'Σ' : '';
      const sY = lv.forceStripY;
      const putP = (x, anchor, t, c) => {
        const a = { x, y: sY + P_ROW_DY, 'text-anchor': anchor, 'font-size': '7', 'font-weight': '600' };
        const parts = pParts(t, c, PDF_PALETTE);
        svg.appendChild(richHaloText(a, parts, C.surface));
        placer.reserveText(a, partsText(parts));
      };
      const put = (x, y, anchor, color, text) => {
        const a = { x, y, 'text-anchor': anchor, fill: color, 'font-size': '7', 'font-weight': '600' };
        svg.appendChild(text.startsWith('Σ')
          ? richHaloText(a, [{ t: 'Σ', fill: SIGMA_COLOR }, { t: text.slice(1), fill: color }], C.surface)
          : pdfHaloText(a, text));
        placer.reserveText(a, text);
      };
      const tt = (v) => pre + '▲' + v.toFixed(2) + 'k', ct = (v) => pre + '▼' + v.toFixed(2) + 'k';
      const ownTxt = (t, c) => 'P' + (t > 0 ? ' ▲' + t.toFixed(2) : '') + (c > 0 ? ' ▼' + c.toFixed(2) : '') + (t > 0 || c > 0 ? 'k' : ' 0');
      const pairW = (a, b) => (a ? textW(a, 7) : 0) + (b ? textW(b, 7) : 0);
      const need = Math.max(isAccum ? pairW(tL > 0 && tt(tL), tR > 0 && tt(tR)) : 0, isAccum ? pairW(cL > 0 && ct(cL), cR > 0 && ct(cR)) : 0,
        pairW(ownTxt(own.tL, own.cL), ownTxt(own.tR, own.cR))) + 12;
      if (need > ww) {
        const cx = wx + ww / 2;
        if (isAccum && Math.max(tL, tR) > 0) put(cx, sY + T_ROW_DY + 1, 'middle', C.tension, tt(Math.max(tL, tR)));
        if (isAccum && Math.max(cL, cR) > 0) put(cx, sY + C_ROW_DY + 1, 'middle', C.compression, ct(Math.max(cL, cR)));
        putP(cx, 'middle', Math.max(own.tL, own.tR), Math.max(own.cL, own.cR));
      } else {
        if (isAccum && tL > 0) put(wx + 3, sY + T_ROW_DY + 1, 'start', C.tension, tt(tL));
        if (isAccum && cL > 0) put(wx + 3, sY + C_ROW_DY + 1, 'start', C.compression, ct(cL));
        if (isAccum && tR > 0) put(wx + ww - 3, sY + T_ROW_DY + 1, 'end', C.tension, tt(tR));
        if (isAccum && cR > 0) put(wx + ww - 3, sY + C_ROW_DY + 1, 'end', C.compression, ct(cR));
        putP(wx + 3, 'start', own.tL, own.cL);
        putP(wx + ww - 3, 'end', own.tR, own.cR);
      }
    }
  }

  drawTransferElements({ svg, layout, line, levels, results: lineResults, combo: 'governing', P: PDF_PALETTE, sel: {}, handlers: null, placer });

  // Audit warnings
  if (lineResults && lineResults.loadPathAudit) {
    for (const warn of lineResults.loadPathAudit.warnings) {
      if (warn.type === 'unsupported_wall') {
        const w = walls.find(ww => ww.id === warn.elementId);
        if (!w) continue;
        const lv = levelYs.find(l => l.id === w.levelId);
        if (!lv) continue;
        const r = wallRectOf(w, lv, beams, pxPerFt);
        svg.appendChild(svgEl('rect', { x: r.x - 1, y: r.y - 1, width: Math.max(r.w, 2) + 2, height: r.h + 2, fill: 'none', stroke: C.fail, 'stroke-width': 2, 'stroke-dasharray': '4,2', rx: 3 }));
      }
    }
  }

  if (legendH) drawPdfLegend(svg, layout.totalH + 8, GUTTER, svgW - 10);

  return svg;
}
