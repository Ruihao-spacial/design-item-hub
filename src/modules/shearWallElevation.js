import { el, clearEl, numOrBlank } from '../utils.js';
import { svgEl, newWall, newGravityLoad, newBeam, newBeamSupport, newSupportPost, newOpening } from './shearWallTypes.js';
import { gravityRows, LOAD_SHAPES, LOAD_CASES, assemblyPsf } from './shearWallGravity.js';
import { nailingTable } from './shearWallNailing.js';
import { hdueTable, mstcTable, POST_SIZES, woodBasis, FTAO_STRAP_TABLE, jambPostOptions, hdueMinPost, meetsMinPost } from './shearWallHardware.js';
import { openingProblems, wallPiers, expandWalls, sortedOpenings, hasOpenings, wallMethod } from './shearWallOpenings.js';
import { findAnchorage, findPost } from './shearWallCalc.js';
import { lcRef } from './shearWallCombos.js';
import { WSWH_WIDTHS, WSWH_CONDITIONS, WSWH_JOISTS, anchorRows, anchorId, isWswh, wswhWidthFt, TSS_KIT_NOTE } from './shearWallWswh.js';

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
// Text sizes of the elevation scene (tool and PDF draw the same scene, user 2026-10-01)
export const ELEV_FS = { level: 11, levelSub: 9, ruler: 10, sigma: 9, pRow: 8, mark: 11, markSmall: 9, nail: 10, nailSmall: 8, hw: 9, post: 9, postSize: 8, strap: 8, legend: 9, gravity: 7, hb: 8 };
// The live view inherits the page font (styles.css body); the PDF SVG names the same stack
export const ELEV_FONT = "'Barlow', 'Segoe UI', system-ui, Arial, sans-serif";
const WALL_HW_ROW_H = 34; // Wall HW row: HD / strap + post of each wall end
const TC_ROW_H = 11; // T/C strip row pitch (P 10, T 21, C 32, 4th row 43)
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

// One palette shape for the shared elevation scene — the tool uses theme tokens, the PDF fixed light-theme hex.
// pass / stale / fail = text (D/C values); wallPass / wallWarn / wallFail = wall fills; wall = wall without results.
const LIVE_PALETTE = {
  surface: 'var(--surface)', ink: 'var(--ink)', inkSecondary: 'var(--ink-secondary)', inkTertiary: 'var(--ink-tertiary)',
  border: 'var(--border)', borderLight: 'var(--border-light)',
  beam: BEAM_COLOR, post: BEAM_COLOR, selected: WALL_SELECTED, warn: WARN_COLOR,
  pass: 'var(--pass)', stale: 'var(--stale)', fail: 'var(--fail)',
  wall: WALL_COLOR, wallPass: 'var(--pass)', wallWarn: 'var(--stale)', wallFail: 'var(--fail)',
  source: '#f59e0b', receiver: '#16a34a',
  tension: TENSION_COLOR, compression: COMPR_COLOR,
  bandFill: 'var(--surface)', bandOpacity: 0.5, bandLine: 'var(--border)', rowLabel: 'var(--ink-tertiary)',
};
const PDF_PALETTE = {
  surface: '#ffffff', ink: '#1a2233', inkSecondary: '#6b7280', inkTertiary: '#9ca3af',
  border: '#d1d5db', borderLight: '#e5e7eb',
  beam: '#7c3aed', post: '#7c3aed', selected: WALL_SELECTED, warn: WARN_COLOR,
  pass: '#15803d', stale: '#b45309', fail: '#dc2626',
  wall: '#2563eb', wallPass: '#22c55e', wallWarn: '#eab308', wallFail: '#dc2626',
  source: '#f59e0b', receiver: '#16a34a',
  tension: '#dc2626', compression: '#2563eb',
  bandFill: '#f3f4f6', bandOpacity: 0.8, bandLine: '#e5e7eb', rowLabel: '#9ca3af',
};

function num(v) { return parseFloat(v) || 0; }

// Estimated text width: 0.62 em per character, the force glyphs ▲ ▼ Σ measured wider (0.9 em)
const WIDE_GLYPHS = /[▲▼Σ]/g;
function textW(text, fs) {
  const s = String(text);
  const wide = (s.match(WIDE_GLYPHS) || []).length;
  return ((s.length - wide) * 0.62 + wide * 0.9) * fs;
}
// Estimated box of an SVG text label (pad = extra px around the glyphs)
export function textBox(attrs, text, pad) {
  const p = pad || 0;
  const fs = parseFloat(attrs['font-size']) || 9;
  const w = textW(text, fs) + 2 * p;
  const h = fs + 2 + 2 * p;
  const anchor = attrs['text-anchor'] || 'start';
  const x = anchor === 'middle' ? attrs.x - w / 2 : anchor === 'end' ? attrs.x - w + p : attrs.x - p;
  const y = attrs['dominant-baseline'] === 'middle' ? attrs.y - h / 2 : attrs.y - fs - p;
  return { x, y, w, h };
}

// Invisible hover box around a label; the live view shows its data-tip in a tooltip
function tipBox(attrs, text, tip) {
  const b = textBox(attrs, text, 3);
  return svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h + 2, fill: 'transparent', 'data-tip': tip, style: { cursor: 'help' } });
}

// Keeps labels from overlapping: reserve() fixed boxes, place() takes the first candidate
// group ([{ attrs, text }]) whose boxes are all free (and inside bounds.minX…maxX), or null.
// Side by side, labels keep a clear gap of LABEL_GAP_X px (touching labels read as one); the rows of a
// strip are spaced for their font, so boxes may touch vertically.
export const LABEL_GAP_X = 4;
function createLabelPlacer(bounds) {
  const boxes = [];
  const inside = (b) => !bounds || (b.x >= bounds.minX - 1 && b.x + b.w <= bounds.maxX + 1);
  const hit = (b) => boxes.some(o => b.x < o.x + o.w + LABEL_GAP_X && o.x < b.x + b.w + LABEL_GAP_X && b.y < o.y + o.h - 1 && o.y < b.y + b.h - 1);
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

// Combo labels use the LC# (user decision 2026-10-01); lcCombos = the combos of the results last shown (any wall)
let lcCombos = null;
function comboName(combo) { return !combo || combo === 'governing' ? 'ASD envelope' : lcCombos ? lcRef(lcCombos, combo) : combo; }
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
  // p.sub: subscript run (smaller, lowered)
  const fs0 = parseFloat(attrs['font-size']) || 9;
  parts.forEach(p => t.appendChild(svgEl('tspan', p.sub ? { fill: p.fill, 'font-size': String(Math.round(fs0 * 0.75 * 10) / 10), 'baseline-shift': 'sub' } : { fill: p.fill }, p.t)));
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
  const pxPerFt = o.pxPerFt > 0 ? o.pxPerFt : Math.max(drawW / totalLen, MIN_PX_PER_FT);
  const svgW = GUTTER + totalLen * pxPerFt + 20;
  const yMult = anyOverlay ? Y_MULT_HARDWARE : Y_MULT_DEFAULT;
  const minLvlH = anyOverlay ? MIN_LEVEL_H_HW : MIN_LEVEL_H;
  const walls = line.walls || [];
  const beams = line.beams || [];
  const posts = line.supportPosts || [];
  const hasBeamOn = (lvl) => !!lvl && beams.some(b => b.levelId === lvl.id);
  // Wall HW row (HD / strap + post of each end) under the walls whenever hardware is shown (user 2026-10-01)
  const wallHwOn = o.wallHwRows != null ? !!o.wallHwRows : showHW;
  // T/C rows per level: 3, more where a narrow wall lists its two ends on separate L: / R: rows
  const tcRows = showForces && o.results ? tcRowsByLevel(line, levels, o.results, o.combo || 'governing', pxPerFt) : {};

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
    const forceStripH = showForces && (hasWall || hasPostBase) ? ANNOT_STRIP_H + Math.max(0, (tcRows[lvl.id] || 3) - 3) * TC_ROW_H : 0;
    const wallHwH = wallHwOn && hasWall ? WALL_HW_ROW_H : 0;
    const postHwH = showHW && hasPostBase ? HW_ROW_H : 0;
    const y = totalH;
    const bodyY = y + topBandH;
    const forceStripY = bodyY + basePx;
    const wallHwY = forceStripY + forceStripH;
    const postHwY = wallHwY + wallHwH;
    const h = topBandH + basePx + forceStripH + wallHwH + postHwH;
    levelYs.push({
      id: lvl.id, name: lvl.name, y, h, ftH, basePx,
      topBandH, topReactH, topReactY: y, topHwH, topHwY: y + topReactH,
      bodyY, bodyH: basePx, forceStripH, forceStripY, wallHwH, wallHwY, postHwH, postHwY,
      bottomBandH: forceStripH + wallHwH + postHwH, floorY: y + h,
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

// Walls as drawn: a segmented wall with valid openings is drawn pier by pier, with the same ids as the
// calc results (w-5#p1 …). parent = the wall in the definition (selection, drag, overrides).
// Strong-Wall WSWH panel (live + PDF): dark panel with an X brace, mark · model written vertically,
// D/C pill beside the base, anchor ticks at the rod spacing B, kit name at a stacked floor line and the
// anchor (Table 06 row: min footing width W and embedment d_e) in the bottom band. o.tips = live hover tips.
export const WSWH_FILL = '#334155';
function drawWswhPanel(svg, o) {
  const { w, r, body, lv, wr, pxPerFt, placer, C, tips, showHW } = o;
  const x = r.x, wd = Math.max(r.w, 4), y = r.y, h = Math.max(r.h, 8);
  const brace = svgEl('g', { 'pointer-events': 'none' });
  brace.appendChild(svgEl('line', { x1: x + 1.5, y1: y + 2, x2: x + wd - 1.5, y2: y + h - 2, stroke: '#cbd5e1', 'stroke-width': 0.8 }));
  brace.appendChild(svgEl('line', { x1: x + wd - 1.5, y1: y + 2, x2: x + 1.5, y2: y + h - 2, stroke: '#cbd5e1', 'stroke-width': 0.8 }));
  svg.appendChild(brace);
  const info = wr && wr.wswh;
  const cx = x + wd / 2, cy = body.y + body.h / 2 - 4;
  const model = info && info.ok ? info.evalModel.replace(' (interp.)', '*') : 'WSWH' + (w.wswhWidth || '18');
  const txt = (w.mark || w.id) + ' · ' + model;
  svg.appendChild(svgEl('text', { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#fff', 'font-size': '8', 'font-weight': '600',
    transform: 'rotate(-90 ' + cx + ' ' + cy + ')', stroke: 'rgba(0,0,0,0.55)', 'stroke-width': '3', 'paint-order': 'stroke', 'stroke-linejoin': 'round', 'pointer-events': 'none' }, txt));
  const len = textW(txt, 8);
  placer.reserve({ x: cx - 6, y: cy - len / 2, w: 12, h: len });
  if (!wr) return;
  // D/C pill to the right of the panel base
  const pill = dcPill(0, 0, wr.dcRatio, 7);
  const pcx = x + wd + 2 + pill.box.w / 2, pcy = body.y + body.h - pill.box.h / 2 - 1;
  const placed = dcPill(pcx, pcy, wr.dcRatio, 7);
  svg.appendChild(placed.g);
  placer.reserve(placed.box);
  if (!info || !info.ok) return;
  // Anchor / rod ticks at B (panel centre ± B/2) across the floor line under the panel
  const half = (info.B / 12) * pxPerFt / 2;
  const fy = r.bottom;
  for (const tx of [cx - half, cx + half]) {
    svg.appendChild(svgEl('line', { x1: tx, y1: fy - 5, x2: tx, y2: fy + 4, stroke: C.ink, 'stroke-width': 1.4, 'pointer-events': 'none' }));
  }
  // Stacked 2nd-story panel: the two-story stacked connection kit at the floor line below it
  if (info.role === 'stackedUpper' && info.kit) {
    const a = { x: x + wd + 3, y: fy + 2, 'text-anchor': 'start', 'dominant-baseline': 'middle', fill: C.inkSecondary, 'font-size': '7', 'font-weight': '600' };
    const kitTxt = info.kit + ' (two-story stacked kit)';
    if (placer.place([[{ attrs: a, text: kitTxt }]])) svg.appendChild(haloText(a, kitTxt, C.surface, tips ? kitTxt + ' — ' + TSS_KIT_NOTE + ' T L ' + (wr.governingTensionLeft || 0).toFixed(2) + 'k / R ' + (wr.governingTensionRight || 0).toFixed(2) + 'k (reported)' : null));
  }
  if (!showHW) return;
  // Anchor label (bottom story): Table 06 row with the minimum footing width W and embedment d_e
  const an = [wr.anchorageLeft, wr.anchorageRight].filter(Boolean).sort((a, b) => (b.cap || 0) - (a.cap || 0))[0];
  if (info.role === 'stackedUpper') return;
  const aTxt = !an ? 'Anchor OVER — by RDP' : an.byRDP ? 'Anchorage by RDP' : an.id.replace('WSWH-AB ', 'AB ') + ' · W ' + an.W + '" · d_e ' + an.de + '"';
  // d_e drawn with a subscript e
  const aParts = (fill) => (an && !an.byRDP ? [{ t: an.id.replace('WSWH-AB ', 'AB ') + ' · W ' + an.W + '" · d', fill }, { t: 'e', fill, sub: true }, { t: ' ' + an.de + '"', fill }] : [{ t: aTxt, fill }]);
  const ay = lv.postHwH ? lv.postHwY + lv.postHwH / 2 : fy - 8;
  const base = { y: ay, 'dominant-baseline': 'middle', fill: an ? C.ink : C.fail, 'font-size': '7', 'font-weight': '600' };
  const cands = [{ ...base, x: cx, 'text-anchor': 'middle' }, { ...base, x: x, 'text-anchor': 'end' }, { ...base, x: x + wd + 2, 'text-anchor': 'start' }].map(a => [{ attrs: a, text: aTxt }]);
  const got = placer.place(cands);
  if (!got) return;
  const tip = tips && an ? (w.mark || w.id) + ' anchors: ' + an.id + (an.cap ? ' — ' + an.cap + ' lb ASD' : '') + (an.W ? ', min footing width W ' + an.W + '", embedment d_e ' + an.de + '", footing length ' + an.Lftg + '"' : '')
    + ' · T L ' + (wr.governingTensionLeft || 0).toFixed(2) + 'k / R ' + (wr.governingTensionRight || 0).toFixed(2) + 'k' : null;
  svg.appendChild(richHaloText(got[0].attrs, aParts(got[0].attrs.fill), C.surface, tip));
}

function drawParts(line, levels) {
  const walls = line.walls || [];
  return expandWalls(walls, levels).walls.map(part => ({ part, parent: walls.find(w => w.id === part.id) || part }));
}

// Opening boxes (px) of a wall: x/width along the line, head/sill heights above the floor line
function openingBoxes(w, lv, pxPerFt) {
  const ftH = parseFloat(lv.ftH) || 0;
  if (!(ftH > 0)) return [];
  const scale = (lv.floorY - lv.y) / ftH;
  return sortedOpenings(w).map(o => ({
    x: GUTTER + (num(w.position) + o.offset) * pxPerFt, w: o.width * pxPerFt,
    yHead: lv.floorY - o.head * scale, ySill: lv.floorY - o.sill * scale,
  }));
}

// Openings of one wall: white cut-outs (red dashed outline when the geometry is invalid).
// Openings exist only on FTAO walls (a segmented wall carrying openings is shown as invalid).
// FTAO: jamb posts at the opening edges and the continuous straps at head and sill with the strap label.
function drawWallOpenings(svg, w, lv, beams, pxPerFt, P, opts) {
  if (!hasOpenings(w)) return;
  const r = wallRectOf(w, lv, beams, pxPerFt);
  const ftao = wallMethod(w) === 'ftao';
  const valid = ftao && openingProblems(w, lv.ftH).length === 0;
  const boxes = openingBoxes(w, lv, pxPerFt);
  for (const b of boxes) {
    const top = Math.max(b.yHead, r.y + 1), bot = Math.min(b.ySill, r.bottom - 1);
    if (bot - top < 1) continue;
    svg.appendChild(svgEl('rect', valid
      ? { x: b.x, y: top, width: Math.max(b.w, 1), height: bot - top, fill: P.surface, stroke: P.ink, 'stroke-width': 0.75, 'pointer-events': 'none' }
      : { x: b.x, y: top, width: Math.max(b.w, 1), height: bot - top, fill: 'none', stroke: P.fail, 'stroke-width': 1, 'stroke-dasharray': '3,2', 'pointer-events': 'none' }));
    if (opts.placer) opts.placer.reserve({ x: b.x, y: top, w: b.w, h: bot - top });
  }
  if (!valid || !ftao || !boxes.length) return;
  for (const b of boxes) {
    for (const x of [b.x, b.x + b.w]) {
      svg.appendChild(svgEl('line', { x1: x, y1: r.y + 1, x2: x, y2: r.bottom - 1, stroke: P.ink, 'stroke-width': 1.5, opacity: 0.55, 'pointer-events': 'none' }));
    }
  }
  if (opts.noStrap) return; // PDF end-force elevation: the strap is hardware, shown on the hardware elevation only
  const yHead = Math.min(...boxes.map(b => b.yHead)) - 2;
  const ySill = Math.max(...boxes.map(b => b.ySill)) + 2;
  const strapId = opts.ftao && opts.ftao.strap ? opts.ftao.strap.id + (opts.ftao.strap.override ? (opts.pdf ? ' *' : ' ✎') : '') : opts.ftao ? 'OVER' : 'strap';
  for (const y of [yHead, ySill]) {
    svg.appendChild(svgEl('line', { x1: r.x + 1, y1: y, x2: r.x + r.w - 1, y2: y, stroke: P.beam, 'stroke-width': 1.5, 'stroke-dasharray': '5,3', 'pointer-events': 'none' }));
  }
  const a = { x: r.x + r.w - 3, y: yHead - 3, 'text-anchor': 'end', fill: P.beam, 'font-size': String(ELEV_FS.strap), 'font-weight': '600' };
  // strap D/C next to its id, coloured like every other D/C
  const sdc = opts.ftao && opts.ftao.strapDC != null ? opts.ftao.strapDC : null;
  if (sdc != null) {
    const parts = [{ t: strapId + ' ', fill: P.beam }, { t: sdc.toFixed(2), fill: dcInk(sdc, P) }];
    svg.appendChild(richHaloText(a, parts, P.surface, opts.tip || null));
    if (opts.placer) opts.placer.reserveText(a, strapId + ' ' + sdc.toFixed(2));
  } else {
    svg.appendChild(haloText(a, strapId, P.surface, opts.tip || null));
    if (opts.placer) opts.placer.reserveText(a, strapId);
  }
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
    rowLabel(lv.wallHwY, lv.wallHwH, 'Wall HW');
    rowLabel(lv.postHwY, lv.postHwH, 'Post HW');
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

// Hardware label parts, the same convention as the Wall HW row: owner tag in grey ("P-1: ", "BM-1: "), the hardware
// id in ink (red when OVER), its D/C in the D/C colour — so a post-base or beam-support HD never reads like a wall's
function hwLabelParts(owner, item, manualMark, P) {
  const parts = owner ? [{ t: owner + ': ', fill: P.inkSecondary }] : [];
  if (!item.anchorage) return [...parts, { t: 'OVER', fill: P.fail }];
  parts.push({ t: item.anchorage.id + manualMark + (item.anchorageDC != null ? ' ' : ''), fill: P.ink });
  if (item.anchorageDC != null) parts.push({ t: item.anchorageDC.toFixed(2), fill: dcInk(item.anchorageDC, P) });
  return parts;
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
  // PDF (no hover): a label with no free spot becomes a numbered marker and its text goes to the notes under the
  // drawing (S.notes), so PDF labels never overlap (user review 2026-10-01)
  const noteMark = (x, y, text) => {
    if (!S.notes) S.notes = [];
    const n = S.notes.length + 1;
    S.notes.push({ n, x, text });
    // the marker itself goes to the first free spot along the element (here, then up, then down)
    for (const dy of [0, -12, -24, -36, 12, 24]) {
      const yy = y + dy;
      if (L.place([[{ attrs: { x, y: yy + 7, 'text-anchor': 'middle', 'font-size': '10' }, text: '00' }]])) { y = yy; break; }
    }
    const g = svgEl('g');
    g.appendChild(svgEl('circle', { cx: x, cy: y + 3, r: 5, fill: P.surface, stroke: P.inkSecondary, 'stroke-width': 1 }));
    g.appendChild(svgEl('text', { x, y: y + 5.5, 'text-anchor': 'middle', fill: P.ink, 'font-size': '7', 'font-weight': '700' }, String(n)));
    svg.appendChild(g);
  };
  const placeGroup = (cands, dotAt, keep, label) => {
    const reduced = keep && keep < cands[0].length ? cands.map(c => c.slice(0, keep)) : null;
    const chosen = L.place(cands) || (reduced && L.place(reduced));
    if (!chosen) {
      if (H) { tipDot(dotAt.x, dotAt.y, cands[0].map(it => it.text).join(' · ') + (cands[0][0].tip ? ' — ' + cands[0][0].tip : ''), cands[0][0].edit); return; }
      noteMark(dotAt.x, dotAt.y, (label ? label + ': ' : '') + cands[0].map(it => it.text).join(' · '));
      return;
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
      placeGroup(cands, { x: g.x, y: g.lv.forceStripY + 3 }, shown.length || undefined, (p.mark || p.id) + ' base');
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
        if (lines.length) placeGroup(sides(sx, lines, !inward), { x: sx, y: band.reactY + 3 }, undefined, (b.mark || b.id) + ' reaction at ' + sr.position.toFixed(2) + ' ft');
      }
      if (layout.showHW && band && band.hwH) {
        const a = anchorageText(sr);
        const sDef = (b.supports || []).find(x => x.id === sr.supportId) || {};
        const manual = !!sDef.anchorageOverride;
        hwItems.push({ zoneY: band.hwY, srcLvId: lv.id, x: sx, preferEnd: !inward,
          edit: 'support:' + b.id + ':' + sr.supportId,
          detail: (sr.anchorage ? ' · T ' + kip(sr.envelopeT) + ' / cap ' + kip(sr.anchorage.cap / 1000) : '') + (manual ? ' · manual override' : ' · auto') + clickHint,
          line1: a.text === '—' ? receiverText(sr.receiver) : a.text + (manual ? MANUAL : ''),
          parts1: a.text === '—' ? null : hwLabelParts(b.mark || b.id, sr, manual ? MANUAL.trim() : '', P),
          color1: a.text === '—' ? P.inkSecondary : P.ink,
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
        parts1: a.text === '—' ? null : hwLabelParts(p.mark || p.id, pp, manual ? MANUAL.trim() : '', P),
        color1: a.text === '—' ? P.inkSecondary : P.ink, line2: '', mark: p.mark || p.id });
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
      const lines = [{ attrs: { y: it.zoneY + 10, fill: it.color1, 'font-size': String(ELEV_FS.hw), 'font-weight': '700' },
        text: it.parts1 ? partsText(it.parts1) : it.line1, parts: it.parts1 || undefined, tip, edit: it.edit }];
      if (it.line2) lines.push({ attrs: { y: it.zoneY + 21, fill: P.inkSecondary, 'font-size': '8' }, text: it.line2 });
      placeGroup(sides(it.x, lines, it.preferEnd), { x: it.x, y: it.zoneY + 3 }, 1, it.isSupport ? 'beam support' : it.mark + ' base HW'); // reduced = hardware line only
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
      const sizeParts = pp.post ? [{ t: pp.post.postLabel + (manual ? MANUAL : '') + (pp.postDC != null ? ' ' : ''), fill: P.ink },
        ...(pp.postDC != null ? [{ t: pp.postDC.toFixed(2), fill: dcInk(pp.postDC, P) }] : [])] : [{ t: 'OVER', fill: P.fail }];
      size = { attrs: { fill: P.ink, 'font-size': '8', 'font-weight': '600' }, text: partsText(sizeParts), parts: sizeParts, edit,
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
    else placeGroup(full, { x: g.x, y: g.lv.bodyY + 4 }, undefined, 'post');
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
        if (wr.combos && wr.combos[key] && wr.combos[key].group !== 'asd') continue;
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

// ctx: { group, thickness } — the project's framing group and the line's wall width
function hwOptionsFor(level, ctx) {
  const span = (level && level.floorClearSpan) || '16';
  return [...hdueTable(ctx.group, ctx.thickness), ...mstcTable(ctx.group, span)];
}

// ============================================================================================================
// === Shared elevation scene — ONE drawing for the tool and the PDF (user 2026-10-01: the tool elevation is the
// standard; a change made here shows in both). The tool adds only interaction (S.live / S.handlers: hit targets,
// hover tips, selection, drag); the PDF passes the print palette and gets numbered notes where the tool shows
// hover dots. Do not draw elevation content anywhere else.
// ============================================================================================================

function findWallResultIn(results, wallId) {
  if (!results) return null;
  for (const pl of (results.perLevel || [])) {
    const wr = (pl.walls || []).find(w => w.wallId === wallId);
    if (wr) return wr;
  }
  return null;
}

// Demand + current hardware at one wall end (hover tips, quick editor)
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

const GRAVITY_VIEWS = ['1.0D', '1.0L', '1.0Lr'];
const f2s = (v) => (v || 0).toFixed(2);
const ownText = (t, c) => 'P' + (t > 0 ? ' ▲' + t.toFixed(2) : '') + (c > 0 ? ' ▼' + c.toFixed(2) : '') + (t > 0 || c > 0 ? 'k' : ' 0');

// How a wall's T/C strip is laid out (user 2026-10-01, same rule as the Wall HW row): ends equal → 'both', one centred
// column with "(both)" at any wall width; ends differ → 'pair' (left / right columns) when they fit side by side,
// else 'lr' (one "L:" / "R:" row per end). rows = strip rows needed (3 fit the standard strip).
function wallTcPlan(wr, ww, combo) {
  if (GRAVITY_VIEWS.includes(combo)) return { kind: 'gravity', rows: 3 };
  const d = wallDisplayTC(wr, combo);
  const { tL, tR, cL, cR, isAccum, own } = d;
  if (!tL && !tR && !cL && !cR) return { kind: 'none', rows: 3, d };
  const vw = (v) => (isAccum && v > 0 ? textW('Σ' + v.toFixed(2) + 'k', ELEV_FS.sigma) + 8 : 0);
  const need = Math.max(vw(tL) + vw(tR), vw(cL) + vw(cR), textW(ownText(own.tL, own.cL), ELEV_FS.pRow) + textW(ownText(own.tR, own.cR), ELEV_FS.pRow)) + 14;
  const eq = (a, b) => f2s(a) === f2s(b);
  const same = eq(own.tL, own.tR) && eq(own.cL, own.cR) && (!isAccum || (eq(tL, tR) && eq(cL, cR)));
  if (same) return { kind: 'both', rows: 3, d };
  if (need <= ww) return { kind: 'pair', rows: 3, d };
  return { kind: 'lr', rows: isAccum ? 4 : 3, d };
}

function tcRowsByLevel(line, levels, results, combo, pxPerFt) {
  const out = {};
  for (const { part: w } of drawParts(line, levels)) {
    const wr = findWallResultIn(results, w.id);
    if (!wr) continue;
    out[w.levelId] = Math.max(out[w.levelId] || 3, wallTcPlan(wr, num(w.length) * pxPerFt, combo).rows);
  }
  return out;
}

// T/C strip of one wall: P row (this wall only) on top, Σ rows only when loads from above change the end forces
function drawWallTC(S, wr, wx, ww, lv) {
  const { svg, P, placer, combo } = S;
  if (!lv.forceStripH) return;
  const live = !!S.live;
  const sY = lv.forceStripY;
  const plan = wallTcPlan(wr, ww, combo);
  if (plan.kind === 'gravity') {
    // Gravity load case: end reactions by statics (R_L / R_R), total in between
    const midY = sY + lv.forceStripH / 2;
    const dlColor = '#78716c';
    const cs = combo.slice(3); // D | L | Lr
    const ll = cs === 'D' ? null : (wr.live && wr.live[cs]) || { total: 0, rL: 0, rR: 0 };
    const total = ll ? ll.total : wr.dlTotal;
    const rl = ll ? ll.rL : wr.dlRL != null ? wr.dlRL : wr.dlTotal / 2, rr = ll ? ll.rR : wr.dlRR != null ? wr.dlRR : wr.dlTotal / 2;
    svg.appendChild(svgEl('rect', { x: wx + 1, y: sY + 2, width: ww - 2, height: lv.forceStripH - 4, fill: 'rgba(120,113,108,0.1)', rx: 2, 'pointer-events': 'none' }));
    const a = { x: wx + ww / 2, y: midY, 'text-anchor': 'middle', fill: dlColor, 'font-size': String(ELEV_FS.sigma), 'font-weight': '600' };
    const txt = cs + ' ' + (+total).toFixed(2) + 'k · R ' + (+rl).toFixed(2) + ' / ' + (+rr).toFixed(2);
    svg.appendChild(haloText(a, txt, P.surface));
    placer.reserveText(a, txt);
    return;
  }
  if (plan.kind === 'none') return;
  const { tL, tR, cL, cR, isAccum, own } = plan.d;
  const mark = wr.mark || wr.wallId;
  const cn = comboName(combo);
  const tipFor = (side, kind) => (live ? mark + ' ' + side + ' end ' + kind + ' (' + cn + ')' + (isAccum ? ' — Σ incl. loads from above; P row = this wall only' : ' — this wall only (nothing lands on it from above)') : null);
  const ownTip = live ? mark + ' P = this wall only (' + cn + ')'
    + (isAccum ? ', before loads from above — Σ rows below include them' : ' — nothing lands on it from above, so this is the full end force') : null;
  const tRow = sY + T_ROW_DY, cRow = sY + C_ROW_DY, pRow = sY + P_ROW_DY;
  const both = { t: ' (both)', fill: P.inkSecondary };
  const pAttrs = (x, y, anchor) => ({ x, y, 'text-anchor': anchor, 'font-size': String(ELEV_FS.pRow), 'font-weight': '600' });
  const sigmaW = (v, suffix) => textW('Σ' + v.toFixed(2) + 'k' + (suffix ? suffix.t : ''), ELEV_FS.sigma) + 8;

  // Triangle + Σ value; x = triangle centre
  function drawVal(x, y, val, color, isUp, tip, suffix) {
    if (!isAccum || val <= 0) return; // no Σ rows when they would repeat the P row
    const tri = isUp ? `${x - 4},${y} ${x + 4},${y} ${x},${y - 6}` : `${x - 4},${y - 4} ${x + 4},${y - 4} ${x},${y + 2}`;
    svg.appendChild(svgEl('polygon', { points: tri, fill: color, 'pointer-events': 'none' }));
    const parts = [{ t: 'Σ', fill: SIGMA_COLOR }, { t: val.toFixed(2) + 'k', fill: color }, ...(suffix ? [suffix] : [])];
    const tAttrs = { x: x + 6, y, 'dominant-baseline': 'middle', fill: color, 'font-size': String(ELEV_FS.sigma), 'font-weight': '600' };
    svg.appendChild(richHaloText(tAttrs, parts, P.surface, tip));
    placer.reserve({ x: x - 4, y: y - 7, w: textW(partsText(parts), ELEV_FS.sigma) + 10, h: 11 });
  }
  const putParts = (attrs, parts, tip) => {
    svg.appendChild(richHaloText(attrs, parts, P.surface, tip));
    placer.reserveText(attrs, partsText(parts));
  };

  if (plan.kind === 'pair') {
    const leftX = wx + 6;
    const rightX = (v) => wx + ww - (isAccum && v > 0 ? sigmaW(v) : 0) + 2;
    drawVal(leftX, tRow, tL, P.tension, true, tipFor('left', 'tension'));
    drawVal(rightX(tR), tRow, tR, P.tension, true, tipFor('right', 'tension'));
    drawVal(leftX, cRow, cL, P.compression, false, tipFor('left', 'compression'));
    drawVal(rightX(cR), cRow, cR, P.compression, false, tipFor('right', 'compression'));
    putParts(pAttrs(wx + 3, pRow, 'start'), pParts(own.tL, own.cL, P), ownTip);
    putParts(pAttrs(wx + ww - 3, pRow, 'end'), pParts(own.tR, own.cR, P), ownTip);
  } else if (plan.kind === 'both') {
    const cx = wx + ww / 2;
    if (tL > 0) drawVal(cx - sigmaW(tL, both) / 2 + 4, tRow, tL, P.tension, true, tipFor('both', 'tension'), both);
    if (cL > 0) drawVal(cx - sigmaW(cL, both) / 2 + 4, cRow, cL, P.compression, false, tipFor('both', 'compression'), both);
    putParts(pAttrs(cx, pRow, 'middle'), [...pParts(own.tL, own.cL, P), both], ownTip);
  } else {
    // ends differ: one row per end — P rows first, then the Σ rows (loads from above included)
    const cx = wx + ww / 2;
    const tag = (s) => ({ t: s + ': ', fill: P.inkSecondary });
    const sig = (t, c) => [{ t: 'Σ', fill: SIGMA_COLOR }, ...(t > 0 ? [{ t: '▲' + t.toFixed(2), fill: P.tension }] : []),
      ...(c > 0 ? [{ t: (t > 0 ? ' ' : '') + '▼' + c.toFixed(2), fill: P.compression }] : []), { t: t > 0 || c > 0 ? 'k' : ' 0', fill: P.inkSecondary }];
    const rows = [[tag('L'), ...pParts(own.tL, own.cL, P)], [tag('R'), ...pParts(own.tR, own.cR, P)]];
    if (isAccum) rows.push([tag('L'), ...sig(tL, cL)], [tag('R'), ...sig(tR, cR)]);
    rows.forEach((parts, i) => putParts(pAttrs(cx, pRow + i * TC_ROW_H, 'middle'), parts,
      i < 2 ? ownTip : tipFor(i === 2 ? 'left' : 'right', 'tension / compression')));
  }
}

// Wall HW row (user 2026-10-01, tool and PDF): each end's HD / strap and post with D/C under the wall. Ends equal →
// one centred "(both)" label at any width; ends differ → one column per end, or on a narrow wall "L: …" / "R: …" rows.
// The tool adds hover tips and click targets (quick editor) on each end.
function drawWallHardwareRow(S, wr, part, pw, wx, ww, lv) {
  const { svg, P, placer } = S;
  const live = !!S.live;
  const FS = ELEV_FS.hw;
  const MANUAL = live ? '✎' : '*';
  // a label = parts: element id in ink (red when OVER) + its D/C in the D/C colour
  const end = (S1) => {
    const a = wr['anchorage' + S1], p = wr['post' + S1], ad = wr['anchorageDC' + S1], pd = wr['postDC' + S1];
    const star = (k) => (pw[k + S1 + 'Override'] ? MANUAL : '');
    const item = (obj, id, dc, kind) => [{ t: (obj ? id : 'OVER') + star(kind) + ' ', fill: obj ? P.ink : P.fail },
      ...(dc != null ? [{ t: dc.toFixed(2), fill: dcInk(dc, P) }] : [])];
    return { hd: item(a, a ? a.id : '', ad, 'anchorage'), post: item(p, p ? p.postLabel : '', pd, 'post') };
  };
  const L = end('Left'), R = end('Right');
  const txt = (parts) => parts.map(x => x.t).join('');
  const y1 = lv.wallHwY + 11, y2 = lv.wallHwY + 23; // clear of a transfer beam on the floor line below (8 px)
  const mark = pw.mark || pw.id;
  const tipOf = (sides) => sides.map(side => {
    const d = wallEndData(pw, wr, side);
    return mark + ' ' + side + ' end · ' + d.ancText + ' · ' + d.postText + (d.manual ? ' · manual override' : ' · auto');
  }).join(' | ') + ' · click to change';
  const put = (x, y, anchor, parts, side, fs = FS) => {
    const a = { x, y, 'text-anchor': anchor, 'font-size': String(fs), 'font-weight': '600' };
    svg.appendChild(richHaloText(a, parts, P.surface));
    placer.reserveText(a, txt(parts));
    if (live) {
      const b = textBox(a, txt(parts), 2);
      svg.appendChild(svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent',
        'data-edit': 'wallEnd:' + part.id + ':' + side, 'data-tip': tipOf(side === 'both' ? ['left', 'right'] : [side]), style: { cursor: 'pointer' } }));
    }
  };
  const need = Math.max(textW(txt(L.hd), FS), textW(txt(L.post), FS)) + Math.max(textW(txt(R.hd), FS), textW(txt(R.post), FS)) + 10;
  const same = txt(L.hd) === txt(R.hd) && txt(L.post) === txt(R.post);
  const cx = wx + ww / 2;
  if (same) {
    const fs = need <= ww ? FS : FS - 1;
    put(cx, y1, 'middle', [...L.hd, { t: ' (both)', fill: P.inkSecondary }], 'both', fs);
    put(cx, y2, 'middle', [...L.post, { t: ' (both)', fill: P.inkSecondary }], 'both', fs);
  } else if (need <= ww) {
    put(wx + 2, y1, 'start', L.hd, 'left'); put(wx + 2, y2, 'start', L.post, 'left');
    put(wx + ww - 2, y1, 'end', R.hd, 'right'); put(wx + ww - 2, y2, 'end', R.post, 'right');
  } else {
    const sep = { t: ' · ', fill: P.inkSecondary };
    put(cx, y1, 'middle', [{ t: 'L: ', fill: P.inkSecondary }, ...L.hd, sep, ...L.post], 'left', FS - 1);
    put(cx, y2, 'middle', [{ t: 'R: ', fill: P.inkSecondary }, ...R.hd, sep, ...R.post], 'right', FS - 1);
  }
}

// Unsupported walls: red dashed outline + ⚠
function drawWallAuditMarks(S, walls) {
  const { svg, layout, line, results } = S;
  if (!results || !results.loadPathAudit) return;
  for (const warn of results.loadPathAudit.warnings) {
    if (warn.type !== 'unsupported_wall') continue;
    const w = walls.find(ww => ww.id === warn.elementId);
    if (!w) continue;
    const lv = layout.levelYs.find(l => l.id === w.levelId);
    if (!lv) continue;
    const r = wallRectOf(w, lv, line.beams || [], layout.pxPerFt);
    svg.appendChild(svgEl('rect', { x: r.x - 1, y: r.y - 1, width: Math.max(r.w, 2) + 2, height: r.h + 2,
      fill: 'none', stroke: WARN_COLOR, 'stroke-width': 2, 'stroke-dasharray': '4,2', rx: 3, 'pointer-events': 'none' }));
    svg.appendChild(svgEl('text', { x: r.x + r.w - 8, y: r.y + 12, 'text-anchor': 'middle', fill: WARN_COLOR, 'font-size': '10', 'font-weight': '700', 'pointer-events': 'none' }, '⚠'));
  }
}

// Legend items (tool HTML row and PDF strip use the same list): { glyph, color, label } | { swatch, label } | { note }
export function elevationLegendItems(P, { forces, hw, live }) {
  const items = [];
  if (forces) {
    items.push(['▲', P.tension, 'tension'], ['▼', P.compression, 'compression'], ['Σ', SIGMA_COLOR, 'incl. loads from above'],
      ['P', P.inkSecondary, 'this element only'], ['R', P.beam, 'beam reaction'], ['●', P.ink, 'connected'], ['○', P.warn, 'needs post']);
  }
  items.push(['△', P.beam, 'point support'], ['■', P.beam, 'post support'], ['◆', P.beam, 'post to fdn'], ['┆', P.beam, 'post inside wall']);
  if (hw) {
    items.push({ swatch: P.wallPass, label: 'D/C < 0.80' }, { swatch: P.wallWarn, label: '0.80 – 1.00' }, { swatch: P.wallFail, label: '> 1.00 or OVER' });
  }
  items.push(live ? ['✎', P.inkSecondary, 'manual override (click nailing / hardware to change)'] : ['*', P.ink, 'manual override']);
  if (hw) items.push({ note: 'Wall HW row: HD / strap, then the end post (left end at left, right end at right) · Post HW: post-base hardware, tagged with its post (P-1: …) · beam supports tagged with the beam (BM-1: …) · in the wall: nailing + sheathing D/C' });
  return items.map(it => (Array.isArray(it) ? { glyph: it[0], color: it[1], label: it[2] } : it));
}

// PDF legend strip at the drawing's text size (ELEV_FS.legend), wrapped to maxX
const LEGEND_ROW_H = ELEV_FS.legend + 4;
function legendLayout(items, x0, maxX) {
  const fs = ELEV_FS.legend;
  let x = x0, row = 0;
  const placed = [];
  for (const it of items) {
    const w = it.note ? textW(it.note, fs) : (it.swatch ? fs + 3 : textW(it.glyph, fs) + 4) + textW(it.label, fs) + 12;
    if ((it.note || x + w > maxX) && x > x0) { x = x0; row++; }
    placed.push({ it, x, row });
    x += w;
    if (it.note) { x = x0; row++; }
  }
  const rows = placed.length ? Math.max(...placed.map(p => p.row)) + 1 : 0;
  return { placed, h: rows * LEGEND_ROW_H + 4 };
}
function drawSvgLegend(svg, legend, y0, P) {
  const fs = ELEV_FS.legend;
  for (const { it, x, row } of legend.placed) {
    const y = y0 + row * LEGEND_ROW_H + fs;
    if (it.note) { svg.appendChild(svgEl('text', { x, y, fill: P.inkSecondary, 'font-size': String(fs) }, it.note)); continue; }
    let lx = x;
    if (it.swatch) { svg.appendChild(svgEl('rect', { x, y: y - fs + 1, width: fs, height: fs, fill: it.swatch, opacity: 0.7, rx: 1 })); lx += fs + 3; }
    else { svg.appendChild(svgEl('text', { x, y, fill: it.color, 'font-size': String(fs), 'font-weight': '700' }, it.glyph)); lx += textW(it.glyph, fs) + 4; }
    svg.appendChild(svgEl('text', { x: lx, y, fill: P.inkSecondary, 'font-size': String(fs) }, it.label));
  }
}

// The scene. S: { svg, layout, line, levels, results, combo, P, placer, notes, sel, handlers, live }
//   live (tool only): { rel, highlightActive, placementMode, onLevelClick(e, lv), onWallMousedown(e, pw), onWallClick(e, lv) }
//   handlers (tool only): beam / post click (see drawTransferElements)
export function drawElevationScene(S) {
  const { svg, layout, line, levels, results, P, placer } = S;
  const live = S.live || null;
  const sel = S.sel || {};
  const { totalLen, pxPerFt, svgW, totalH, levelYs, showForces, showHW } = layout;
  const beams = line.beams || [];

  // Ruler grid
  for (let i = 0; i <= totalLen; i += 5) {
    const x = GUTTER + i * pxPerFt;
    const isMajor = i % 10 === 0;
    svg.appendChild(svgEl('line', { x1: x, y1: 0, x2: x, y2: totalH - RULER_H, stroke: P.borderLight, 'stroke-width': isMajor ? 0.5 : 0.25, 'stroke-dasharray': isMajor ? 'none' : '2,4', 'pointer-events': 'none' }));
    if (isMajor) svg.appendChild(svgEl('text', { x, y: totalH - 4, 'text-anchor': 'middle', fill: P.inkTertiary, 'font-size': String(ELEV_FS.ruler), 'pointer-events': 'none' }, String(i)));
  }
  svg.appendChild(svgEl('text', { x: GUTTER + totalLen * pxPerFt + 8, y: totalH - 4, fill: P.inkTertiary, 'font-size': String(ELEV_FS.levelSub), 'pointer-events': 'none' }, 'ft'));

  drawBandBackdrops(svg, layout, P);

  for (const lv of levelYs) {
    svg.appendChild(svgEl('line', { x1: 0, y1: lv.y, x2: svgW, y2: lv.y, stroke: P.border, 'stroke-width': 1, 'pointer-events': 'none' }));
    const midY = lv.bodyY + lv.bodyH / 2;
    svg.appendChild(svgEl('text', { x: 4, y: midY, 'dominant-baseline': 'middle', fill: P.inkSecondary, 'font-size': String(ELEV_FS.level), 'font-weight': '600', 'pointer-events': 'none' }, lv.name || '?'));
    svg.appendChild(svgEl('text', { x: 4, y: midY + 14, 'dominant-baseline': 'middle', fill: P.inkTertiary, 'font-size': String(ELEV_FS.levelSub), 'pointer-events': 'none' }, lv.ftH + "'"));

    // Gravity loads at the top of the story: uniform band + "D 200 / L 400 plf", point arrow + "D 2 / Lr 1 k"
    const gRows = gravityRows((line.gravityLoads || {})[lv.id], line.totalLength);
    const magText = (g, unit) => LOAD_CASES.filter(c => num(g[c])).map(c => c + ' ' + num(g[c])).join(' / ') + ' ' + unit;
    for (const u of gRows.uniform) {
      if (!LOAD_CASES.some(c => u[c])) continue;
      const sx = GUTTER + u.x0 * pxPerFt, ex = GUTTER + u.x1 * pxPerFt;
      svg.appendChild(svgEl('rect', { x: sx, y: lv.y + 2, width: ex - sx, height: 5, fill: '#f59e0b', opacity: 0.4, rx: 1, stroke: '#b45309', 'stroke-width': 0.5, 'pointer-events': 'none' }));
      const t = '#' + u.index + ' ' + magText(u, 'plf');
      const a = { x: (sx + ex) / 2, y: lv.y + 14, 'text-anchor': 'middle', fill: '#92400e', 'font-size': String(ELEV_FS.gravity) };
      const got = placer.place([[{ attrs: a, text: t }], [{ attrs: { ...a, y: lv.y + 22 }, text: t }]]);
      if (got) svg.appendChild(haloText(got[0].attrs, t, P.surface));
    }
    for (const pt of gRows.point) {
      if (!LOAD_CASES.some(c => pt[c])) continue;
      const px2 = GUTTER + pt.x * pxPerFt;
      svg.appendChild(svgEl('line', { x1: px2, y1: lv.y + 2, x2: px2, y2: lv.y + 12, stroke: '#f59e0b', 'stroke-width': 1.5, 'pointer-events': 'none' }));
      svg.appendChild(svgEl('polygon', { points: `${px2 - 2.5},${lv.y + 10} ${px2 + 2.5},${lv.y + 10} ${px2},${lv.y + 13}`, fill: '#f59e0b', 'pointer-events': 'none' }));
      const t = '#' + pt.index + ' ' + magText(pt, 'k');
      const a = { x: px2 + 4, y: lv.y + 9, 'text-anchor': 'start', fill: '#92400e', 'font-size': String(ELEV_FS.gravity) };
      const got = placer.place([[{ attrs: a, text: t }], [{ attrs: { ...a, x: px2 - 4, 'text-anchor': 'end' }, text: t }], [{ attrs: { ...a, y: lv.y + 18 }, text: t }]]);
      if (got) svg.appendChild(haloText(got[0].attrs, t, P.surface));
    }

    if (live) {
      svg.appendChild(svgEl('rect', {
        x: GUTTER, y: lv.y, width: totalLen * pxPerFt, height: lv.h,
        fill: 'transparent', style: { cursor: 'crosshair' },
        onClick(e) { live.onLevelClick(e, lv); },
      }));
    }
  }
  // Foundation line
  if (levelYs.length) {
    const fdnY = levelYs[levelYs.length - 1].floorY;
    svg.appendChild(svgEl('line', { x1: 0, y1: fdnY, x2: svgW, y2: fdnY, stroke: P.border, 'stroke-width': 1.5, 'pointer-events': 'none' }));
  }

  const parts = drawParts(line, levels);
  drawWallAuditMarks(S, parts.map(p => p.part));

  const rel = live && live.rel;
  const anyBands = showForces || showHW;
  // Wall T/C and HW-row labels are placed now (posts / beams avoid them) but drawn on top of the post and beam
  // lines, so a post line passing a wall's labels never strikes through them
  const labelLayer = svgEl('g');
  const SL = { ...S, svg: labelLayer };
  const openingsDrawn = new Set();
  for (const { part: w, parent: pw } of parts) {
    const lv = levelYs.find(l => l.id === w.levelId);
    if (!lv) continue;
    const r = wallRectOf(w, lv, beams, pxPerFt);
    const body = wallBodyOf(lv);
    const wx = r.x, ww = r.w;
    const isSel = !!live && pw.id === sel.wallId;
    const isFtaoWall = hasOpenings(w) && wallMethod(w) === 'ftao';
    const ar = (parseFloat(lv.ftH) || 0) / (parseFloat(w.length) || 1);
    const relHas = (set) => set.has('wall:' + w.id) || set.has('wall:' + pw.id);
    const related = isSel || (rel && (relHas(rel.sources) || relHas(rel.receivers)));

    const panelWall = isWswh(pw);
    let fill = panelWall ? WSWH_FILL : P.wall;
    const wr = results && anyBands ? findWallResultIn(results, w.id) : null;
    if (wr && !panelWall) {
      if (showHW) {
        const allPass = wr.dcRatio <= 1.0 && wr.anchorageLeft && wr.anchorageRight && wr.postLeft && wr.postRight;
        fill = allPass ? P.wallPass : P.wallFail;
      } else {
        fill = wr.dcRatio > 1.0 ? P.wallFail : wr.dcRatio > 0.8 ? P.wallWarn : P.wallPass;
      }
    }

    const rectAttrs = {
      x: wx, y: r.y, width: Math.max(ww, 2), height: Math.max(r.h, 8),
      fill, opacity: live && live.highlightActive && !related ? 0.3 : panelWall ? 0.92 : 0.7,
      stroke: isSel ? WALL_SELECTED : P.ink, 'stroke-width': isSel ? 2.5 : 1, rx: panelWall ? 1 : 2,
    };
    if (live) {
      rectAttrs.style = { cursor: live.placementMode === 'none' ? 'grab' : 'crosshair' };
      rectAttrs.onMousedown = (e) => live.onWallMousedown(e, pw);
      rectAttrs.onClick = (e) => live.onWallClick(e, lv);
    }
    svg.appendChild(svgEl('rect', rectAttrs));
    if (anyBands) drawWallBandScrim(svg, r, lv, P.surface);
    if (hasOpenings(pw) && !openingsDrawn.has(pw.id)) {
      openingsDrawn.add(pw.id);
      const fr = isFtaoWall && wr ? wr.ftao : null;
      // the FTAO strap is hardware: hidden when results are shown without the hardware (PDF end-force elevation)
      drawWallOpenings(svg, pw, lv, beams, pxPerFt, P, { placer, ftao: fr, pdf: !live, noStrap: !!results && !showHW,
        tip: live && fr && fr.strap ? (pw.mark || pw.id) + ' FTAO strap ' + fr.strap.id + ' · F_max ' + fr.strapDemand + ' lb / ' + fr.strap.cap + ' lb → D/C ' + (fr.strapDC != null ? fr.strapDC.toFixed(2) : '—') : null });
    }

    if (ar > 2.0 && !isFtaoWall && !panelWall) {
      const a = { x: wx + ww / 2, y: r.y + 10, 'text-anchor': 'middle', fill: P.fail, 'font-size': String(ELEV_FS.hb), 'font-weight': '700' };
      svg.appendChild(haloText(a, 'h/b=' + ar.toFixed(1), P.surface));
      placer.reserveText(a, 'h/b=' + ar.toFixed(1));
    }

    const markLabel = w.mark || w.id;
    const put = (attrs, text) => { labelLayer.appendChild(wallText(attrs, text)); placer.reserveText(attrs, text); };
    if (panelWall) {
      const pr = results ? findWallResultIn(results, w.id) : null;
      drawWswhPanel(svg, { w: pw, r, body, lv, wr: pr, pxPerFt, placer, C: P, tips: !!live, showHW: showHW && !!wr });
      if (pr && live) {
        const x = pr.wswh, lt = pr.dcGoverning === 'wind' ? 'W' : 'E';
        svg.appendChild(svgEl('rect', { x: wx, y: body.y, width: Math.max(ww, 4), height: body.h, fill: 'transparent', 'data-edit': 'nailing:' + w.id, style: { cursor: 'pointer' },
          'data-tip': markLabel + ' Strong-Wall ' + (x.ok ? x.evalModel + ' (' + x.orderModel + '), H_e ' + x.He.toFixed(2) + '" · V ' + x.Vd[lt] + ' / ' + x.Vcap[lt] + ' lb → D/C ' + pr.dcRatio.toFixed(2) : x.errors.join('; ')) + ' · click for details' }));
      }
    } else if (showHW && wr) {
      put({ x: wx + ww / 2, y: body.y + 16, 'text-anchor': 'middle', fill: '#fff', 'font-size': String(ELEV_FS.markSmall), 'font-weight': '600' }, markLabel);
      const nailFS = ww > 50 ? ELEV_FS.nail : ELEV_FS.nailSmall;
      const nailAttrs = { x: wx + ww / 2, y: body.y + body.h / 2 - 7, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#fff', 'font-size': String(nailFS), 'font-weight': '600' };
      const nailText = (wr.nailing ? wr.nailing.label : '?') + (pw.nailingPattern ? (live ? ' ✎' : ' *') : '');
      put(nailAttrs, nailText);
      const pill = dcPill(wx + ww / 2, body.y + body.h / 2 + 8, wr.dcRatio, nailFS - 1);
      labelLayer.appendChild(pill.g);
      placer.reserve(pill.box);
      if (live) {
        // Nailing + D/C pill = click-to-edit target
        const nb = textBox(nailAttrs, nailText, 2);
        const tx = Math.min(nb.x, pill.box.x), ty = nb.y, tw = Math.max(nb.x + nb.w, pill.box.x + pill.box.w) - tx, th = pill.box.y + pill.box.h - ty;
        labelLayer.appendChild(svgEl('rect', { x: tx, y: ty, width: tw, height: th, fill: 'transparent', 'data-edit': 'nailing:' + w.id, style: { cursor: 'pointer' },
          'data-tip': markLabel + ' nailing ' + (wr.nailing ? wr.nailing.label : '?') + ' · v ' + (wr.unitShear_ASD || 0).toFixed(0) + ' plf / cap ' + (wr.effectiveCapacity || 0).toFixed(0)
            + ' plf → D/C ' + (wr.dcRatio != null ? wr.dcRatio.toFixed(2) : '—') + (isFtaoWall ? ' (FTAO governing zone)' : '') + (pw.nailingPattern ? ' · manual override' : ' · auto') + ' · click to change' }));
      }
      if (lv.wallHwH) drawWallHardwareRow(SL, wr, w, pw, wx, ww, lv);
    } else {
      put({ x: wx + ww / 2, y: body.y + body.h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#fff', 'font-size': String(ww > 40 ? ELEV_FS.mark : ELEV_FS.markSmall), 'font-weight': '600' }, markLabel);
    }

    if (showForces && wr) drawWallTC(SL, wr, wx, ww, lv);
  }

  drawTransferElements(S);
  svg.appendChild(labelLayer);
}

export function renderElevation(container, line, levels, wallDLTypes, callbacks) {
  const { onWallChange, onGravityChange, onInputChange } = callbacks || {};
  let selectedWallId = null;
  let selectedBeamId = null;
  let selectedPostId = null;
  let placementMode = 'none'; // 'none' | 'wall' | 'beam' | 'post'
  let destroyed = false;
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
    const grade = c.wood || woodBasis(c);
    return { thickness: line.wallThickness || c.wallThickness || '4', grade, group: grade.group, loadType: c.loadType || 'both',
      wswhFc: c.wswhFc || '2500', sdc: c.sdc || '', detached: !!c.detached, bottomLevelId: c.bottomLevelId || (levels[levels.length - 1] || {}).id };
  }
  const dcTxt = (dc) => dc == null ? '—' : dc.toFixed(2) + (dc > 1 ? ' ✗' : '');
  // Anchorage choices for a level, auto-mode group first, with D/C at demand T (kips)
  function anchorageGroups(lvl, li, T) {
    const span = (lvl && lvl.floorClearSpan) || '16';
    const holdownFirst = li === levels.length - 1 || (lvl && lvl.anchorageType === 'holdown');
    const opt = (it) => {
      const a = findAnchorage(it.id, span, designCtx().group, designCtx().thickness) || it;
      const dc = a.cap > 0 ? T * 1000 / a.cap : null;
      return { id: it.id, text: it.id + ' — ' + (T || 0).toFixed(2) + 'k / ' + (a.cap / 1000).toFixed(2) + 'k → ' + dcTxt(dc), dc };
    };
    const { group, thickness } = designCtx();
    const hd = { label: 'Holdowns', items: hdueTable(group, thickness).map(opt) };
    const st = { label: 'Straps (' + span + '" span)', items: mstcTable(group, span).map(opt) };
    return holdownFirst ? [hd, st] : [st, hd];
  }
  // Posts below the anchorage minimum post at a holdown / strap end are not offered (P9)
  function postGroups(lvl, C, anchorage) {
    const { thickness, grade } = designCtx();
    const floorH = parseFloat(lvl && lvl.floorToFloor) || 10;
    const min = hdueMinPost(anchorage, thickness);
    return [{ label: 'Posts (' + (thickness === '6' ? '2x6' : '2x4') + ' wall)' + (min ? ' — min ' + min.label + ' (HD / strap)' : ''),
      items: (POST_SIZES[thickness] || POST_SIZES['4']).filter(ps => meetsMinPost(ps, min)).map(ps => {
      const p = findPost(ps.id, thickness, grade, floorH);
      const dc = p && p.capacityKips > 0 ? C / p.capacityKips : null;
      return { id: ps.id, text: ps.label + ' — ' + (C || 0).toFixed(2) + 'k / ' + (p ? p.capacityKips.toFixed(2) : '?') + 'k → ' + dcTxt(dc), dc };
    }) }];
  }
  function nailingGroups(wr) {
    const hb = wr.hbReductionFactor || 1;
    return [{ label: 'Nailing (≈ at current load share)', items: nailingTable(designCtx().group).map(n => {
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
      const found = drawParts(line, levels).find(p => p.part.id === id);
      const w = found && found.part;
      const pw = found && found.parent;
      const wr = w && findWallResult(w.id);
      if (!w || !wr) { hideQuickEdit(); return; }
      const li = levelIndexOf(w.levelId), lvl = levels[li];
      target = pw;
      if (isWswh(pw)) {
        // Strong-Wall panel: no nailing / HD / post overrides — width, condition and anchor are set in the wall panel
        const x = wr.wswh, lt = wr.dcGoverning === 'wind' ? 'W' : 'E';
        title = (w.mark || w.id) + ' · Strong-Wall';
        body.push(x.ok ? x.evalModel + ' · V ' + x.Vd[lt] + ' / ' + x.Vcap[lt] + ' lb → D/C ' + dcTxt(wr.dcRatio) : x.errors.join('; '));
        body.push('Anchors: ' + [wr.anchorageLeft, wr.anchorageRight].map(an => (an ? an.id + (an.cap ? ' ' + an.cap + ' lb' : '') : 'OVER')).join(' / '));
        body.push('Change width, condition or anchor in the Wall Properties panel');
      } else {
        if (kind === 'nailing') {
          title = (w.mark || w.id) + ' · nailing';
          fields.push(qeField('Nailing', pw, 'nailingPattern', nailingGroups(wr), wr.nailing ? wr.nailing.label : '?'));
          body.push('v ' + (wr.unitShear_ASD || 0).toFixed(0) + ' plf / cap ' + (wr.effectiveCapacity || 0).toFixed(0) + ' plf → D/C ' + dcTxt(wr.dcRatio)
            + (wr.hbReductionFactor < 1 ? ' (h/b factor ' + wr.hbReductionFactor.toFixed(2) + ')' : ''));
          resetKeys = ['nailingPattern'];
        }
        // Wall HW row targets: one end, or 'both' (a narrow wall whose ends carry the same hardware)
        const sides = kind === 'wallEnd' ? (sub === 'both' ? ['left', 'right'] : [sub]) : [];
        for (const side of sides) {
          const d = wallEndData(pw, wr, side);
          if (kind === 'wallEnd') title = (w.mark || w.id) + ' · ' + (sub === 'both' ? 'both ends' : side + ' end');
          body.push(side + ': ' + d.ancText + ' · ' + d.postText);
          fields.push(qeField(side[0].toUpperCase() + side.slice(1) + ' HD/Strap', pw, 'anchorage' + d.S1 + 'Override', anchorageGroups(lvl, li, d.T), d.anc ? d.anc.id : 'OVER'));
          fields.push(qeField(side[0].toUpperCase() + side.slice(1) + ' post', pw, 'post' + d.S1 + 'Override', postGroups(lvl, d.C, d.anc), d.post ? d.post.postLabel : 'OVER'));
          resetKeys.push('anchorage' + d.S1 + 'Override', 'post' + d.S1 + 'Override');
        }
      }
    } else if (kind === 'post') {
      const p = (line.supportPosts || []).find(x => x.id === id);
      const pp = p && (wallResults.postPaths || []).find(x => x.postId === p.id);
      if (!p || !pp) { hideQuickEdit(); return; }
      const li = levelIndexOf(p.levelId), lvl = levels[li];
      target = p;
      title = (p.mark || p.id) + ' · post';
      fields.push(qeField('Base HD/Strap', p, 'anchorageOverride', anchorageGroups(lvl, li, pp.envelopeT || 0), pp.anchorage ? pp.anchorage.id : '—'));
      fields.push(qeField('Post size', p, 'postOverride', postGroups(lvl, pp.envelopeC || 0, pp.anchorage), pp.post ? pp.post.postLabel : 'OVER'));
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
    if (destroyed) return; // deferred first draw after the elevation was removed
    clearEl(svgContainer);
    const containerW = Math.max(svgContainer.clientWidth || 600, 400);
    const showForces = !!(wallResults && showForcesOn && currentCombo !== null);
    const showHW = !!(wallResults && showHardwareOn);
    const layout = computeElevationLayout(line, levels, { width: containerW, showForces, showHW, results: wallResults, combo: currentCombo });
    const { totalLen, pxPerFt, svgW, totalH, levelYs } = layout;
    if (!isExpanded) {
      const viewH = (typeof window !== 'undefined' && window.innerHeight) || 800;
      svgContainer.style.height = Math.max(300, Math.min(totalH + 4, Math.round(viewH * 0.75))) + 'px';
    }

    const svg = svgEl('svg', { width: svgW, height: totalH, style: { cursor: 'crosshair' } });

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


    const selKey = selectedWallId ? { type: 'wall', id: selectedWallId } : selectedBeamId ? { type: 'beam', id: selectedBeamId } : selectedPostId ? { type: 'post', id: selectedPostId } : null;
    const rel = loadPathRelations(wallResults, selKey);
    const highlightActive = rel.sources.size + rel.receivers.size > 0;

    // The drawing is the shared scene (the PDF draws the same one); the tool adds the interaction below
    const S = {
      svg, layout, line, levels, results: wallResults, combo: currentCombo, P: LIVE_PALETTE,
      placer: createLabelPlacer({ minX: GUTTER, maxX: svgW }),
      sel: { wallId: selectedWallId, beamId: selectedBeamId, postId: selectedPostId },
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
      live: {
        rel, highlightActive, placementMode,
        onLevelClick: handleLevelClick,
        onWallMousedown(e, pw) {
          if (placementMode !== 'none') return;
          e.stopPropagation();
          const svgRect = svg.getBoundingClientRect(); // measure before pickAt redraws the SVG
          const startFt = (e.clientX - svgRect.left - GUTTER) / pxPerFt;
          if (pickAt(e, 'wall', pw.id)) return; // overlapping walls: choose first, no drag
          dragState = { wallId: pw.id, startFt, origPos: num(pw.position) };
        },
        onWallClick(e, lv) {
          if (placementMode === 'none') return;
          e.stopPropagation();
          handleLevelClick(e, lv);
        },
      },
    };
    drawElevationScene(S);
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

  function findWallResult(wallId) { return findWallResultIn(wallResults, wallId); }

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

  function comboLabel() { return comboName(currentCombo); }

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
  // Override list without posts below the minimum post of the current anchorage (P9)
  const ppOf = (sp) => wallResults && (wallResults.postPaths || []).find(p => p.postId === sp.id);
  const postItemsFor = (anchorage) => {
    const min = hdueMinPost(anchorage, designCtx().thickness);
    return min ? postItems.filter(p => meetsMinPost(p, min)) : postItems;
  };
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
    if (isWswh(w)) { lenInput.disabled = true; lenInput.title = 'Strong-Wall: length = panel width'; }

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

    // Wall type: sheathed wood shear wall or Simpson Strong-Wall WSWH panel (length locked to the panel width)
    const typeSel = el('select', { className: 'form-select', style: { width: '230px' }, onChange(e) {
      w.systemType = e.target.value;
      if (w.systemType === 'wswh') {
        if (!w.wswhWidth) w.wswhWidth = '18';
        if (!w.wswhCondition) w.wswhCondition = w.levelId === designCtx().bottomLevelId ? 'concrete' : 'stackedUpper';
        w.length = wswhWidthFt(w); w.openings = [];
      } else {
        w.length = Math.max(num(w.length), 4);
      }
      markChanged(); renderPropPanel(); drawSVG();
    } });
    [['sheathed', 'Sheathed wood shear wall'], ['wswh', 'Simpson Strong-Wall WSWH']].forEach(([v, label]) =>
      typeSel.appendChild(el('option', { value: v, selected: (w.systemType || 'sheathed') === v }, label)));
    propPanel.appendChild(panelRow(panelField('Wall type', typeSel)));
    if (isWswh(w)) renderWswhEditor(w);
    else {
      const nailSel = el('select', { className: 'form-select', style: { width: '130px' }, onChange(e) { w.nailingPattern = e.target.value; markChanged(); } });
      nailSel.appendChild(el('option', { value: '' }, 'Auto'));
      nailingTable(designCtx().group).forEach(n => {
        const opt = el('option', { value: n.id }, n.label + ' (' + n.asdE + '/' + n.asdW + ')');
        if (w.nailingPattern === n.id) opt.selected = true;
        nailSel.appendChild(opt);
      });

      const ancItems = hwOptionsFor(levels[levelIndexOf(w.levelId)], designCtx());

      propPanel.appendChild(panelRow(panelField('Nailing', nailSel)));
      propPanel.appendChild(panelSub('Hardware Overrides (blank = auto-select)'));
      propPanel.appendChild(panelRow(
        panelField('HD/Strap Left', hwSelect(w, 'anchorageLeftOverride', ancItems, ancLabelFn)),
        panelField('HD/Strap Right', hwSelect(w, 'anchorageRightOverride', ancItems, ancLabelFn)),
      ));
      // End anchorage of the wall (for the anchorage minimum post in the post list)
      const endAnc = (S1) => { const r = findWallResult(w.id); return r ? r['anchorage' + S1] : null; };
      propPanel.appendChild(panelRow(
        panelField('Post Left', hwSelect(w, 'postLeftOverride', postItemsFor(endAnc('Left')), postLabelFn)),
        panelField('Post Right', hwSelect(w, 'postRightOverride', postItemsFor(endAnc('Right')), postLabelFn)),
      ));
      renderOpeningsEditor(w);
    }

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

  // Strong-Wall WSWH settings of the selected wall: width, installation condition, joist / floor depth, anchor
  function renderWswhEditor(w) {
    const refresh = () => { markChanged(); renderPropPanel(); drawSVG(); };
    const sel = (key, options, width, after) => {
      const s = el('select', { className: 'form-select', style: { width }, onChange(e) { w[key] = e.target.value; if (after) after(); refresh(); } });
      options.forEach(([v, label]) => s.appendChild(el('option', { value: v, selected: String(w[key] || '') === v }, label)));
      return s;
    };
    propPanel.appendChild(panelSub('Strong-Wall WSWH (panel height = floor-to-floor, interpolated)'));
    const widthSel = sel('wswhWidth', WSWH_WIDTHS.map(v => [v, v + '" (' + (Number(v) / 12).toFixed(1) + ' ft)']), '110px', () => { w.length = wswhWidthFt(w); });
    const condSel = sel('wswhCondition', WSWH_CONDITIONS.map(c => [c.id, c.label]), '250px');
    const fields = [panelField('Width', widthSel), panelField('Condition', condSel)];
    if (w.wswhCondition === 'raised') fields.push(panelField('Floor joist', sel('wswhJoist', WSWH_JOISTS.map(j => [j.id, j.label]), '170px')));
    if (w.wswhCondition === 'stackedUpper') {
      fields.push(panelField('Floor depth d_fl (in, ≤ 18)', el('input', { className: 'form-input mono', type: 'number', step: 'any', value: numOrBlank(w.wswhFloorDepth), style: { width: '70px' },
        onChange(e) { w.wswhFloorDepth = e.target.value; refresh(); } })));
    }
    propPanel.appendChild(panelRow(...fields));
    if (w.wswhCondition === 'concrete') {
      const c = designCtx();
      const rows = anchorRows({ fc: c.wswhFc, sdc: c.sdc, detached: c.detached });
      const ancSel = sel('wswhAnchorOverride', [['', 'Auto (smallest footing W, then d_e)'],
        ...rows.map(r => [anchorId(r), r.criteria + ' ' + r.grade + ' — ' + r.T_ASDallow + ' lb, W ' + r.W_in + '" d_e ' + r.de_in + '"'])], '320px');
      propPanel.appendChild(panelRow(panelField('Anchor (Table 06, cracked, f\'c ' + c.wswhFc + ', SDC ' + (c.sdc || '—') + ')', ancSel)));
    }
    const wr = findWallResult(w.id);
    if (wr && wr.wswh) {
      const x = wr.wswh;
      const lt = wr.dcGoverning === 'wind' ? 'W' : 'E';
      propPanel.appendChild(el('div', { style: { fontSize: '0.8rem', color: x.ok ? 'var(--ink-secondary)' : 'var(--fail)', marginBottom: '0.5rem' } },
        x.ok ? (x.evalModel + (x.orderModel !== x.evalModel ? ' (order ' + x.orderModel + ')' : '') + ' · H_e ' + x.He.toFixed(2) + '" · V ' + x.Vd[lt] + ' / ' + x.Vcap[lt] + ' lb → D/C ' + wr.dcRatio.toFixed(2)
          + (x.kit ? ' · ' + x.kit : '')) : x.errors.join('; ')));
    }
  }

  // Wall method and openings. Segmented walls are solid full-height walls: openings only on FTAO walls.
  function renderOpeningsEditor(w) {
    if (!Array.isArray(w.openings)) w.openings = [];
    const refresh = () => { markChanged(); renderPropPanel(); drawSVG(); };
    const ftao = w.method === 'ftao';
    propPanel.appendChild(panelSub('Wall method and openings (windows; model doors as separate walls)'));
    const methodSel = el('select', { className: 'form-select', style: { width: '240px' }, onChange(e) { w.method = e.target.value; refresh(); } });
    [['segmented', 'Segmented (solid, full height — no openings)'], ['ftao', 'FTAO (force transfer around openings)']].forEach(([v, label]) => {
      // Segmented is not allowed while the wall has openings — remove them first
      const o = el('option', { value: v, disabled: v === 'segmented' && w.openings.length > 0 }, label);
      if ((ftao ? 'ftao' : 'segmented') === v) o.selected = true; methodSel.appendChild(o);
    });
    const items = [panelField('Method', methodSel)];
    if (ftao) {
      items.push(panelField('FTAO strap', hwSelect(w, 'ftaoStrapOverride', FTAO_STRAP_TABLE, it => it.id + ' (' + it.cap + ' lb)')));
      const jSel = el('select', { className: 'form-select', style: { width: '110px' }, onChange(e) { w.jambPostOverride = e.target.value; markChanged(); } });
      jambPostOptions(designCtx().thickness).forEach((p, i) => {
        const o = el('option', { value: i === 0 ? '' : p.id }, p.label + (i === 0 ? ' (default)' : ''));
        if ((w.jambPostOverride || '') === (i === 0 ? '' : p.id)) o.selected = true;
        jSel.appendChild(o);
      });
      items.push(panelField('Jamb posts', jSel));
      items.push(panelField('Narrow piers', el('label', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem' } },
        el('input', { type: 'checkbox', checked: !!w.narrowPier, onChange(e) { w.narrowPier = e.target.checked; refresh(); } }), '1.5–2 ft (APA T555, CBC §104.11)')));
    }
    propPanel.appendChild(panelRow(...items));
    if (!ftao) {
      propPanel.appendChild(el('div', { style: { fontSize: '0.8rem', marginBottom: '0.35rem', color: w.openings.length ? 'var(--fail)' : 'var(--ink-secondary)' } },
        w.openings.length
          ? '⚠ Segmented walls are solid and cannot have openings — remove the openings below or choose FTAO. The wall is designed as solid until then.'
          : 'Segmented walls are solid full-height walls. For a window, choose FTAO, or model two walls with a gap.'));
    }
    if (w.openings.length) {
      const tbl = el('table', { className: 'dynamic-table', style: { fontSize: '0.8rem', marginBottom: '0.35rem' } });
      tbl.appendChild(el('tr', null, el('th', null, '#'), el('th', null, 'Offset (ft)'), el('th', null, 'Width (ft)'), el('th', null, 'Sill (ft)'), el('th', null, 'Head (ft)'), el('th', { className: 'row-actions' }, '')));
      w.openings.forEach((o, i) => {
        const cell = (key) => el('td', null, el('input', { type: 'number', step: 'any', value: numOrBlank(o[key]), style: { width: '64px' }, onChange(e) { o[key] = e.target.value; refresh(); } }));
        tbl.appendChild(el('tr', null, el('td', null, String(i + 1)), cell('offset'), cell('width'), cell('sill'), cell('head'),
          el('td', { className: 'row-actions' }, el('button', { className: 'btn btn-ghost btn-sm', type: 'button', onClick() { w.openings.splice(i, 1); refresh(); } }, '×'))));
      });
      propPanel.appendChild(el('div', { className: 'table-scroll' }, tbl));
      const lvl = levels[levelIndexOf(w.levelId)];
      const problems = openingProblems(w, lvl && lvl.floorToFloor);
      const piers = wallPiers(w).map(p => p.length.toFixed(2)).join(' / ');
      if (ftao) propPanel.appendChild(el('div', { style: { fontSize: '0.8rem', marginBottom: '0.35rem', color: problems.length ? 'var(--fail)' : 'var(--ink-secondary)' } },
        problems.length ? '⚠ ' + problems.join('; ') + ' — wall is designed as solid until fixed.' : 'FTAO piers beside the openings (ft): ' + piers + '. Offset from the wall’s left end; sill and head above the floor line.'));
    }
    if (ftao) propPanel.appendChild(el('button', { className: 'btn btn-sm', type: 'button', style: { marginBottom: '0.5rem' }, onClick() {
      const L = num(w.length);
      const last = w.openings.map(o => num(o.offset) + num(o.width)).reduce((a, b) => Math.max(a, b), 0);
      const offset = Math.min(Math.max(last + 2, 2), Math.max(L - 5, 0));
      w.openings.push(newOpening(offset, 3, 3, 7));
      refresh();
    } }, '+ Opening'));
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
        el('td', null, hwSelect(s, 'anchorageOverride', hwOptionsFor(lvl, designCtx()), ancLabelFn, '100px')),
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
      panelField('Base HD/Strap', hwSelect(sp, 'anchorageOverride', hwOptionsFor(lvl, designCtx()), ancLabelFn)),
      panelField('Post Size', hwSelect(sp, 'postOverride', postItemsFor(ppOf(sp) && ppOf(sp).anchorage), postLabelFn)),
    ));

    const pp = ppOf(sp);
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

  // Gravity loads per level (at the top of that story): one row per load — shape, position, D / L / Lr.
  // Uniform rows can take D and L (or Lr for a roof) from a Flat Load assembly × tributary width.
  function renderGravitySection() {
    clearEl(gravSection);
    const assemblies = (callbacks && callbacks.flatLoadAssemblies && callbacks.flatLoadAssemblies()) || [];
    const changed = (redraw) => { if (onGravityChange) onGravityChange(); markChanged(); drawSVG(); if (redraw) renderGravitySection(); };
    gravSection.appendChild(el('div', { style: { fontWeight: '600', marginBottom: '0.25rem', fontSize: '0.9rem' } }, 'Gravity Loads (D / L / Lr)'));
    gravSection.appendChild(el('div', { style: { fontSize: '0.78rem', color: 'var(--ink-secondary)', marginBottom: '0.5rem' } },
      'Loads at the top of each story (its floor / roof). Point loads: kips. Uniform loads: plf, or check "psf × trib" to enter psf × a tributary width. Full = the whole line length. Walls take the part directly above them; a transfer beam on that floor line takes what is over it; a point load on a post top goes to the post.'
      + (assemblies.length ? ' Uniform rows can link a Flat Load assembly (psf × trib; dead → D, live → Lr for a roof, L otherwise).' : ' Link a Flat Load item in Summary / Config to take psf from its assemblies.')));

    for (const lvl of levels) {
      if (!line.gravityLoads) line.gravityLoads = {};
      const old = line.gravityLoads[lvl.id];
      if (!old || !Array.isArray(old.loads)) {
        // older definition (uniform / point lists): convert in place, dead load only
        const loads = [];
        ((old && old.uniform) || []).forEach(u => loads.push({ ...newGravityLoad('partial', u.start, u.end), id: u.id || newGravityLoad().id, D: u.dlPlf ?? '' }));
        ((old && old.point) || []).forEach(q => loads.push({ ...newGravityLoad('point', q.position, q.position), id: q.id || newGravityLoad().id, D: q.dlKips ?? '' }));
        line.gravityLoads[lvl.id] = { loads };
      }
      const gl = line.gravityLoads[lvl.id];

      const lvlPanel = el('div', { style: { marginBottom: '0.75rem', padding: '0.5rem', border: '1px solid var(--border-light)', borderRadius: '4px' } });
      lvlPanel.appendChild(el('div', { style: { fontWeight: '500', fontSize: '0.85rem', marginBottom: '0.25rem' } }, lvl.name || lvl.id));
      if (gl.loads.length) {
        const tbl = el('table', { className: 'dynamic-table', style: { fontSize: '0.82rem' } });
        tbl.appendChild(el('tr', null, ...['#', 'Shape', 'Position / start (ft)', 'End (ft)', 'Flat Load assembly', 'Trib width', 'D', 'L', 'Lr', 'Unit', ''].map(h => el('th', null, h))));
        gl.loads.forEach((ld, i) => {
          const inp = (key, width, disabled, after) => el('input', { type: 'number', step: 'any', value: numOrBlank(ld[key]), disabled: !!disabled, style: { width },
            onChange(e) { ld[key] = e.target.value; if (after) after(); changed(!!after); } });
          // Linking an assembly switches the row to psf × trib and copies its psf
          const relink = () => {
            const asm = assemblies.find(x => x.id === ld.assemblyId);
            if (!asm) return;
            const v = assemblyPsf(asm);
            ld.perArea = true;
            ld.D = String(v.D); ld.L = v.L ? String(v.L) : ''; ld.Lr = v.Lr ? String(v.Lr) : '';
          };
          const shapeSel = el('select', { className: 'form-select', style: { width: '170px', fontSize: '0.8rem' }, onChange(e) {
            ld.shape = e.target.value;
            if (ld.shape === 'point') { ld.assemblyId = ''; ld.trib = ''; ld.perArea = false; }
            changed(true);
          } });
          LOAD_SHAPES.forEach(sh => shapeSel.appendChild(el('option', { value: sh.id, selected: (ld.shape || 'partial') === sh.id }, sh.label)));
          const isPoint = ld.shape === 'point', isFull = ld.shape === 'full';
          const perArea = !isPoint && !!ld.perArea;
          const unit = isPoint ? 'k' : perArea ? 'psf' : 'plf';
          let asmCell = '—';
          if (!isPoint) {
            const asmSel = el('select', { className: 'form-select', style: { width: '170px', fontSize: '0.8rem' }, disabled: !assemblies.length, onChange(e) { ld.assemblyId = e.target.value; relink(); changed(true); } });
            asmSel.appendChild(el('option', { value: '' }, assemblies.length ? '— manual —' : 'No Flat Load link'));
            assemblies.forEach(x => asmSel.appendChild(el('option', { value: x.id, selected: ld.assemblyId === x.id },
              (x.name || x.id) + ' (lateral DL ' + assemblyPsf(x).D + ' / ' + (x.llSymbol || 'L') + ' ' + x.llGravity + ' psf)')));
            asmCell = !ld.assemblyId ? asmSel : el('span', { style: { display: 'inline-flex', gap: '4px', alignItems: 'center' } }, asmSel,
              el('button', { className: 'btn btn-sm btn-ghost', type: 'button', title: 'Unlink to type D / L / Lr by hand', onClick() { ld.assemblyId = ''; changed(true); } }, 'Unlink'));
          }
          // Trib width: checkbox "psf × trib" switches a uniform row between plf (unchecked) and psf × trib
          // (checked, trib width box shown). Unchecking also unlinks a Flat Load assembly. Values are cleared on switch.
          const tribCell = () => {
            const chk = el('input', { type: 'checkbox', checked: perArea, onChange(e) {
              ld.perArea = e.target.checked;
              if (!ld.perArea) ld.assemblyId = '';
              ld.D = ''; ld.L = ''; ld.Lr = '';
              changed(true);
            } });
            const box = el('span', { style: { display: 'inline-flex', gap: '4px', alignItems: 'center', whiteSpace: 'nowrap' } },
              el('label', { style: { display: 'inline-flex', gap: '3px', alignItems: 'center', cursor: 'pointer' }, title: 'Checked: enter D / L / Lr in psf × a tributary width. Unchecked: plf.' }, chk, 'psf × trib'));
            if (perArea) box.appendChild(el('span', { style: { display: 'inline-flex', gap: '3px', alignItems: 'center' } }, inp('trib', '50px', false, relink), 'ft'));
            return box;
          };
          // A linked row's D / L / Lr come from the Flat Load assembly and are greyed out (user 2026-10-01): Unlink to edit
          const linkedAsm = ld.assemblyId ? assemblies.find(x => x.id === ld.assemblyId) : null;
          const mag = (key) => el('input', { type: 'number', step: 'any', value: numOrBlank(ld[key]), style: { width: '62px' }, placeholder: unit,
            disabled: !!ld.assemblyId,
            title: ld.assemblyId ? key + ' linked to ' + ((linkedAsm && linkedAsm.name) || 'the Flat Load assembly') + (key === 'D' ? ' (lateral dead load)' : '') + ' — Unlink to edit' : key + ' (' + unit + ')',
            onChange(e) { ld[key] = e.target.value; changed(false); } });
          tbl.appendChild(el('tr', null,
            el('td', { className: 'mono' }, String(i + 1)),
            el('td', null, shapeSel),
            el('td', null, isFull ? el('span', { style: { color: 'var(--ink-tertiary)' } }, '0 (full line)') : inp(isPoint ? 'position' : 'start', '62px')),
            el('td', null, isPoint ? '—' : isFull ? el('span', { style: { color: 'var(--ink-tertiary)' } }, String(num(line.totalLength))) : inp('end', '62px')),
            el('td', null, asmCell),
            el('td', null, isPoint ? '—' : tribCell()),
            el('td', null, mag('D')), el('td', null, mag('L')), el('td', null, mag('Lr')),
            el('td', { style: { whiteSpace: 'nowrap', color: 'var(--ink-secondary)' } }, unit + (perArea && num(ld.trib) > 0
              ? ' → ' + LOAD_CASES.filter(c => num(ld[c])).map(c => c + ' ' + +(num(ld[c]) * num(ld.trib)).toFixed(1)).join(' / ') + ' plf' : '')),
            el('td', { className: 'row-actions' }, el('button', { className: 'btn btn-ghost btn-sm', type: 'button', onClick() { gl.loads.splice(i, 1); changed(true); } }, '×')),
          ));
        });
        lvlPanel.appendChild(el('div', { className: 'table-scroll' }, tbl));
      }
      const addBtn = (shape, label) => el('button', { className: 'btn btn-sm', type: 'button', style: { marginRight: '0.5rem', marginTop: '0.25rem' },
        onClick() { gl.loads.push(newGravityLoad(shape, 0, parseFloat(line.totalLength) || 60)); changed(true); } }, label);
      lvlPanel.appendChild(addBtn('point', '+ Point'));
      lvlPanel.appendChild(addBtn('full', '+ Uniform (full line)'));
      lvlPanel.appendChild(addBtn('partial', '+ Uniform (partial)'));
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
    // same item list as the PDF legend (elevationLegendItems)
    for (const it of elevationLegendItems(LIVE_PALETTE, { forces, hw, live: true })) {
      if (it.note) legendRow.appendChild(el('span', { style: { whiteSpace: 'normal' } }, it.note));
      else legendRow.appendChild(it.swatch ? swatch(it.swatch, it.label) : item(it.glyph, it.color, it.label));
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
      const keysOf = (g) => comboKeys.filter(k => sampleWall.combos[k].group === g);
      if (sampleWall && sampleWall.combos) lcCombos = sampleWall.combos;

      const envGroup = el('optgroup', { label: 'Envelope — used for design' });
      envGroup.appendChild(el('option', { value: 'governing' }, 'ASD Governing'));
      sel.appendChild(envGroup);
      const addGroup = (label, keys) => {
        if (!keys.length) return;
        const og = el('optgroup', { label });
        for (const key of keys) {
          const c = sampleWall.combos[key] || {};
          og.appendChild(el('option', { value: key }, c.lc ? lcRef(sampleWall.combos, key) + '  ' + (c.text || '') : key));
        }
        sel.appendChild(og);
      };
      addGroup('ASD Combos — used for design', asdKeys);
      addGroup('Load Cases — deflection', caseKeys);
      addGroup('LRFD Combos — forces only', keysOf('lrfd'));
      addGroup('Ω₀ ASD Combos — forces only', keysOf('asd_omega'));
      addGroup('Ω₀ LRFD Combos — forces only', keysOf('lrfd_omega'));
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
    destroyed = true;
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

// === PDF elevation: the shared scene (drawElevationScene) with the print palette ===
// mode 'forces' = the end-force elevation (ASD envelope, no hardware); 'hardware' = nailing + D/C, Wall HW row,
// post-base and beam-support hardware, no forces (user review 2026-10-01). Everything else is the tool's drawing.
const pdfLayoutOpts = (results, mode) => ({
  ...(mode === 'hardware' ? { showForces: false, showHW: !!results } : { showForces: !!results, showHW: false }),
  results: results && typeof results === 'object' ? results : null, combo: 'governing',
});
const pdfLegendItems = (mode) => elevationLegendItems(PDF_PALETTE, { forces: mode !== 'hardware', hw: mode === 'hardware', live: false });
const LEGEND_MIN_W = 620; // a part is at least this wide so the legend wraps cleanly (the drawing keeps its scale)

// Height / width of a whole-line PDF elevation (layout + legend strip)
export function pdfElevationAspect(line, levels, width, hasResults, mode = 'forces') {
  const l = computeElevationLayout(line, levels, { width, ...pdfLayoutOpts(hasResults, mode) });
  const legendH = hasResults ? legendLayout(pdfLegendItems(mode), GUTTER, l.svgW - 10).h + 8 : 0;
  return (l.totalH + legendH) / l.svgW;
}

// === PDF elevation at a standard drawing scale, split into parts (user 2026-10-01) ===
// Scales in pt per ft on the PDF page (72 pt = 1 in): 1/4" = 1'-0" → 18, 3/16" → 13.5, 1/8" → 9.
export const PDF_SCALES = [[18, '1/4" = 1\'-0"'], [13.5, '3/16" = 1\'-0"'], [9, '1/8" = 1\'-0"']];
const PART_OVERLAP_FT = 1;
// Elements a cut must not go through: walls, beams, posts (± 0.5 ft)
function blockedIntervals(line) {
  const n = (v) => parseFloat(v) || 0;
  const out = [];
  for (const w of line.walls || []) out.push([n(w.position), n(w.position) + n(w.length)]);
  for (const b of line.beams || []) out.push([n(b.position), n(b.position) + n(b.length)]);
  for (const pp of line.supportPosts || []) out.push([n(pp.position) - 0.5, n(pp.position) + 0.5]);
  return out.sort((a, b) => a[0] - b[0]);
}
// The largest standard scale that keeps the line within 2 parts (never below 1/8"), and the parts [x0, x1] (ft):
// each part ends in a gap between elements where one exists, the next starts 1 ft before that cut.
export function planPdfElevation(line, availW) {
  const totalLen = parseFloat(line.totalLength) || 60;
  const capFt = (pt) => (availW - GUTTER - 20) / pt;
  // only the length that holds elements is split: empty line length past the last element is not a part of its own
  const blocks0 = blockedIntervals(line);
  const contentEnd = blocks0.length ? Math.min(totalLen, Math.ceil(Math.max(...blocks0.map(b => b[1])))) : totalLen;
  const partsAt = (pt) => {
    const cap = capFt(pt), blocks = blocks0, parts = [];
    let a = 0, guard = 0;
    while (a < contentEnd - 1e-6 && guard++ < 50) {
      // last part: as much of the line as fits (always past the last element)
      if (contentEnd - a <= cap + 1e-6) { parts.push({ x0: a, x1: Math.min(totalLen, Math.floor((a + cap) * 2) / 2) }); break; }
      const limit = a + cap;
      // free points: gaps between blocks, as far right as possible (but past 40 % of the part)
      let cut = null;
      const inBlock = (x) => blocks.some(([b0, b1]) => x > b0 + 1e-6 && x < b1 - 1e-6);
      // cut on a half-foot grid so the part limits read cleanly (e.g. 0–32.5 ft)
      for (let x = Math.floor(limit * 2) / 2; x > a + 0.4 * cap; x -= 0.5) { if (!inBlock(x)) { cut = x; break; } }
      const throughElement = cut == null;
      if (cut == null) cut = Math.floor(limit * 2) / 2;
      parts.push({ x0: a, x1: cut, throughElement });
      a = Math.max(a + 1, cut - PART_OVERLAP_FT);
    }
    return parts;
  };
  for (const [pt, label] of PDF_SCALES) {
    const parts = partsAt(pt);
    if (parts.length <= 2) return { pxPerFt: pt, scaleLabel: label, parts };
  }
  const [pt, label] = PDF_SCALES[PDF_SCALES.length - 1];
  return { pxPerFt: pt, scaleLabel: label, parts: partsAt(pt) };
}

// Notes of one part: labels that had no free spot (numbered markers — the print form of the tool's hover dots)
const NOTE_ROW_H = ELEV_FS.legend + 3;
function partNotes(line, levels, results, mode, view) {
  const full = renderElevationFullForPdf(line, levels, [], results, 0, mode, view.pxPerFt, false);
  const x0 = GUTTER + view.x0 * view.pxPerFt - 1, x1 = GUTTER + view.x1 * view.pxPerFt + 1;
  return (full.__notes || []).filter(n => n.x >= x0 && n.x <= x1);
}
const notesHeight = (notes) => (notes.length ? 6 + NOTE_ROW_H * notes.length : 0);
// Size (pt) of one part of the PDF elevation. results: the line results (object) or true / false (size without notes)
export function pdfElevationPartSize(line, levels, results, mode, view) {
  const hasResults = !!results;
  const l = computeElevationLayout(line, levels, { ...pdfLayoutOpts(results, mode), pxPerFt: view.pxPerFt });
  const w = Math.round(Math.max(GUTTER + (view.x1 - view.x0) * view.pxPerFt + 20, hasResults ? LEGEND_MIN_W : 0));
  const legendH = hasResults ? legendLayout(pdfLegendItems(mode), GUTTER, w - 10).h + 8 : 0;
  const notes = results && typeof results === 'object' ? partNotes(line, levels, results, mode, view) : [];
  return { w, h: Math.round(l.totalH + legendH + notesHeight(notes)) };
}

// One PDF elevation, or one part of it (view = { pxPerFt, x0, x1 }): the whole line is drawn at the fixed scale
// and the part is a window onto it — the level labels (gutter) stay at the left and the legend is drawn per part.
export function renderElevationForPdf(line, levels, wallDLTypes, lineResults, width, mode = 'forces', view = null) {
  if (!view) return renderElevationFullForPdf(line, levels, wallDLTypes, lineResults, width, mode, null, true);
  const full = renderElevationFullForPdf(line, levels, wallDLTypes, lineResults, width, mode, view.pxPerFt, false);
  const layout = computeElevationLayout(line, levels, { ...pdfLayoutOpts(lineResults, mode), pxPerFt: view.pxPerFt });
  const P = PDF_PALETTE, px = view.pxPerFt;
  const { w, h } = pdfElevationPartSize(line, levels, lineResults || false, mode, view);
  const bodyW = (view.x1 - view.x0) * px + 20;
  const outer = svgEl('svg', { xmlns: 'http://www.w3.org/2000/svg', width: w, height: h, viewBox: '0 0 ' + w + ' ' + h, 'font-family': ELEV_FONT });
  outer.appendChild(svgEl('rect', { x: 0, y: 0, width: w, height: h, fill: P.surface }));
  const win = (x, vx, vw) => {
    const inner = svgEl('svg', { x, y: 0, width: vw, height: layout.totalH, viewBox: vx + ' 0 ' + vw + ' ' + layout.totalH, overflow: 'hidden' });
    for (const ch of [...full.childNodes]) inner.appendChild(ch.cloneNode(true));
    return inner;
  };
  outer.appendChild(win(0, 0, GUTTER));
  outer.appendChild(win(GUTTER, GUTTER + view.x0 * px, bodyW));
  if (lineResults) {
    const legend = legendLayout(pdfLegendItems(mode), GUTTER, w - 10);
    drawSvgLegend(outer, legend, layout.totalH + 8, P);
    // labels moved off the drawing (no free spot): numbered notes under the legend
    const notes = (full.__notes || []).filter(n => n.x >= GUTTER + view.x0 * px - 1 && n.x <= GUTTER + view.x1 * px + 1);
    const ny = layout.totalH + 8 + legend.h + 4;
    notes.forEach((n, i) => {
      outer.appendChild(svgEl('text', { x: GUTTER, y: ny + ELEV_FS.legend + i * NOTE_ROW_H, fill: P.ink, 'font-size': String(ELEV_FS.legend) }, '(' + n.n + ') ' + n.text));
    });
  }
  return outer;
}

function renderElevationFullForPdf(line, levels, wallDLTypes, lineResults, width, mode, fixedPx, withLegend) {
  const P = PDF_PALETTE;
  const layout = computeElevationLayout(line, levels, { width, ...pdfLayoutOpts(lineResults, mode), pxPerFt: fixedPx });
  const legend = lineResults && withLegend ? legendLayout(pdfLegendItems(mode), GUTTER, layout.svgW - 10) : null;
  const totalH = layout.totalH + (legend ? legend.h + 8 : 0);
  const svg = svgEl('svg', { xmlns: 'http://www.w3.org/2000/svg', width: layout.svgW, height: totalH, viewBox: '0 0 ' + layout.svgW + ' ' + totalH, 'font-family': ELEV_FONT });
  svg.appendChild(svgEl('rect', { x: 0, y: 0, width: layout.svgW, height: totalH, fill: P.surface }));
  const S = { svg, layout, line, levels, results: lineResults || null, combo: 'governing', P,
    placer: createLabelPlacer({ minX: GUTTER, maxX: layout.svgW }), sel: {}, handlers: null, live: null, notes: [] };
  drawElevationScene(S);
  svg.__notes = S.notes;
  if (legend) drawSvgLegend(svg, legend, layout.totalH + 8, P);
  return svg;
}
