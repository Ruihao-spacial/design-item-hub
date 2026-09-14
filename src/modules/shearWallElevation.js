import { el, clearEl, numOrBlank } from '../utils.js';
import { svgEl, newWall, newUniformLoad, newPointLoad } from './shearWallTypes.js';
import { NAILING_TABLE } from './shearWallNailing.js';
import { HDUE_TABLE, MSTC_TABLE, POST_SIZES } from './shearWallHardware.js';

const GUTTER = 80;
const RULER_H = 24;
const MIN_LEVEL_H = 60;
const MIN_LEVEL_H_HW = 90;
const MIN_PX_PER_FT = 6;
const ANNOT_STRIP_H = 32;
const Y_MULT_DEFAULT = 4;
const Y_MULT_HARDWARE = 8;
const WALL_MARGIN = 1;
const HW_EDGE_ZONE_W = 13;
const HW_EDGE_INSET = 7;
const HW_MIN_WIDTH = 40;
const WALL_COLOR = 'var(--accent)';
const WALL_SELECTED = '#2563eb';
const WALL_HOVER = 'var(--accent-hover)';
const TENSION_COLOR = '#dc2626';
const COMPR_COLOR = '#2563eb';
const HW_COLOR = '#7c3aed';

function haloText(attrs, text) {
  const g = svgEl('g', { 'pointer-events': 'none' });
  g.appendChild(svgEl('text', { ...attrs, stroke: 'var(--surface)', 'stroke-width': '2.5', 'paint-order': 'stroke', fill: 'var(--surface)' }, text));
  g.appendChild(svgEl('text', { ...attrs }, text));
  return g;
}

export function renderElevation(container, line, levels, wallDLTypes, callbacks) {
  const { onWallChange, onGravityChange, onInputChange } = callbacks || {};
  let selectedWallId = null;
  let currentCombo = null;
  let showForcesOn = false;
  let showHardwareOn = false;
  let wallResults = null;

  const wrapper = el('div', { className: 'elevation-wrapper', style: { position: 'relative' } });
  const svgContainer = el('div', { style: { height: '500px', overflowY: 'auto', overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--surface)' } });
  const propPanel = el('div', { className: 'elevation-prop-panel', hidden: true, style: { marginTop: '0.5rem', padding: '0.75rem', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--panel)' } });
  const gravSection = el('div', { style: { marginTop: '0.75rem' } });
  const comboRow = el('div', { hidden: true, style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' } });

  wrapper.appendChild(comboRow);
  wrapper.appendChild(svgContainer);
  wrapper.appendChild(propPanel);
  wrapper.appendChild(gravSection);
  container.appendChild(wrapper);

  let isExpanded = false;
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

  function drawSVG() {
    clearEl(svgContainer);
    const totalLen = parseFloat(line.totalLength) || 60;
    const containerW = Math.max(svgContainer.clientWidth || 600, 400);
    const drawW = containerW - GUTTER - 20;
    const pxPerFt = Math.max(drawW / totalLen, MIN_PX_PER_FT);
    const svgW = GUTTER + totalLen * pxPerFt + 20;

    const showForces = wallResults && showForcesOn && currentCombo !== null;
    const showHW = wallResults && showHardwareOn;
    const anyOverlay = showForces || showHW;
    const yMult = anyOverlay ? Y_MULT_HARDWARE : Y_MULT_DEFAULT;
    const minLvlH = anyOverlay ? MIN_LEVEL_H_HW : MIN_LEVEL_H;
    let totalH = RULER_H + 10;
    const levelYs = [];
    for (const lvl of levels) {
      const ftH = parseFloat(lvl.floorToFloor) || 10;
      const basePx = Math.max(ftH * yMult, minLvlH);
      const forceStripH = showForces ? ANNOT_STRIP_H : 0;
      const stripH = forceStripH;
      const px = basePx + stripH;
      const forceStripY = totalH + basePx;
      levelYs.push({ id: lvl.id, name: lvl.name, y: totalH, h: px, ftH, basePx, stripH, forceStripH, forceStripY });
      totalH += px;
    }
    totalH += 10;

    const svg = svgEl('svg', { width: svgW, height: totalH, style: { cursor: 'crosshair' } });

    for (let i = 0; i <= totalLen; i += 5) {
      const x = GUTTER + i * pxPerFt;
      const isMajor = i % 10 === 0;
      svg.appendChild(svgEl('line', { x1: x, y1: 0, x2: x, y2: totalH - RULER_H, stroke: 'var(--border-light)', 'stroke-width': isMajor ? 0.5 : 0.25, 'stroke-dasharray': isMajor ? 'none' : '2,4' }));
      if (isMajor) {
        svg.appendChild(svgEl('text', { x, y: totalH - 4, 'text-anchor': 'middle', fill: 'var(--ink-tertiary)', 'font-size': '10' }, String(i)));
      }
    }
    svg.appendChild(svgEl('text', { x: GUTTER + totalLen * pxPerFt + 8, y: totalH - 4, fill: 'var(--ink-tertiary)', 'font-size': '9' }, 'ft'));

    for (const lv of levelYs) {
      svg.appendChild(svgEl('line', { x1: 0, y1: lv.y, x2: svgW, y2: lv.y, stroke: 'var(--border)', 'stroke-width': 1 }));
      if (showForces) {
        svg.appendChild(svgEl('line', { x1: 0, y1: lv.y + lv.basePx, x2: svgW, y2: lv.y + lv.basePx, stroke: 'var(--border)', 'stroke-width': 0.5, 'stroke-dasharray': '4,4' }));
      }

      const label = svgEl('text', { x: 4, y: lv.y + lv.basePx / 2, 'dominant-baseline': 'middle', fill: 'var(--ink-secondary)', 'font-size': '11', 'font-weight': '600' }, lv.name || '?');
      svg.appendChild(label);
      svg.appendChild(svgEl('text', { x: 4, y: lv.y + lv.basePx / 2 + 14, 'dominant-baseline': 'middle', fill: 'var(--ink-tertiary)', 'font-size': '9' }, lv.ftH + "'"));

      if (showForces && lv.forceStripH > 0) {
        svg.appendChild(svgEl('rect', { x: GUTTER, y: lv.forceStripY, width: totalLen * pxPerFt, height: lv.forceStripH, fill: 'var(--surface)', opacity: 0.5, 'pointer-events': 'none' }));
      }

      const gl = (line.gravityLoads || {})[lv.id];
      if (gl) {
        for (const u of (gl.uniform || [])) {
          const sx = GUTTER + (parseFloat(u.start) || 0) * pxPerFt;
          const ex = GUTTER + (parseFloat(u.end) || 0) * pxPerFt;
          if (ex > sx) {
            svg.appendChild(svgEl('rect', { x: sx, y: lv.y + 2, width: ex - sx, height: 5, fill: '#f59e0b', opacity: 0.4, rx: 1, stroke: '#b45309', 'stroke-width': 0.5 }));
            svg.appendChild(haloText({ x: (sx + ex) / 2, y: lv.y + 14, 'text-anchor': 'middle', fill: '#92400e', 'font-size': '7' }, (parseFloat(u.dlPlf) || 0) + ' plf'));
          }
        }
        for (const p of (gl.point || [])) {
          const px2 = GUTTER + (parseFloat(p.position) || 0) * pxPerFt;
          svg.appendChild(svgEl('line', { x1: px2, y1: lv.y + 2, x2: px2, y2: lv.y + 12, stroke: '#f59e0b', 'stroke-width': 1.5, 'pointer-events': 'none' }));
          svg.appendChild(svgEl('polygon', { points: `${px2 - 2.5},${lv.y + 10} ${px2 + 2.5},${lv.y + 10} ${px2},${lv.y + 13}`, fill: '#f59e0b', 'pointer-events': 'none' }));
        }
      }

      const lvRect = svgEl('rect', {
        x: GUTTER, y: lv.y, width: totalLen * pxPerFt, height: lv.basePx,
        fill: 'transparent', style: { cursor: 'crosshair' },
        onClick(e) {
          const rect = svg.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const ft = (clickX - GUTTER) / pxPerFt;
          if (ft < 0 || ft > totalLen) return;
          const hitWall = (line.walls || []).find(w => {
            if (w.levelId !== lv.id) return false;
            const ws = parseFloat(w.position) || 0;
            const we = ws + (parseFloat(w.length) || 0);
            const wsX = GUTTER + ws * pxPerFt;
            const weX = GUTTER + we * pxPerFt;
            return clickX >= wsX && clickX <= weX;
          });
          if (hitWall) {
            selectWall(hitWall.id);
          } else {
            const defaultDLType = (wallDLTypes && wallDLTypes[0]) ? wallDLTypes[0].id : '';
            const w = newWall(lv.id, Math.round(ft * 2) / 2, defaultDLType);
            if (!line.walls) line.walls = [];
            line.walls.push(w);
            selectWall(w.id);
            if (onWallChange) onWallChange();
            if (onInputChange) onInputChange();
            drawSVG();
          }
        },
      });
      svg.appendChild(lvRect);
    }

    drawStackingConnections(svg, line.walls || [], levelYs, pxPerFt, levels);

    for (const w of (line.walls || [])) {
      const lv = levelYs.find(l => l.id === w.levelId);
      if (!lv) continue;
      const wx = GUTTER + (parseFloat(w.position) || 0) * pxPerFt;
      const ww = (parseFloat(w.length) || 0) * pxPerFt;
      const wy = lv.y + WALL_MARGIN;
      const wh = lv.basePx - 2 * WALL_MARGIN;
      const isSel = w.id === selectedWallId;
      const ar = (parseFloat(lv.ftH) || 0) / (parseFloat(w.length) || 1);

      let fill = WALL_COLOR;
      const wr = wallResults ? findWallResult(w.id) : null;
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
        x: wx, y: wy, width: Math.max(ww, 2), height: Math.max(wh, 8),
        fill, opacity: 0.7, stroke: isSel ? WALL_SELECTED : 'var(--ink)', 'stroke-width': isSel ? 2.5 : 1, rx: 2,
        style: { cursor: 'pointer' },
        onClick(e) { e.stopPropagation(); selectWall(w.id); },
      });
      svg.appendChild(wallRect);

      if (ar > 2.0) {
        svg.appendChild(haloText({ x: wx + ww / 2, y: lv.y - 4, 'text-anchor': 'middle', fill: 'var(--fail)', 'font-size': '8', 'font-weight': '700' }, 'h/b=' + ar.toFixed(1)));
      }

      const markLabel = w.mark || w.id;
      if (showHW && wr) {
        svg.appendChild(svgEl('text', { x: wx + ww / 2, y: wy + 16, 'text-anchor': 'middle', fill: '#fff', 'font-size': '9', 'font-weight': '600', 'pointer-events': 'none' }, markLabel));
        const nailLabel = wr.nailing ? wr.nailing.label : '';
        svg.appendChild(svgEl('text', { x: wx + ww / 2, y: wy + wh / 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#fff', 'font-size': ww > 50 ? '10' : '8', 'font-weight': '600', 'pointer-events': 'none' }, nailLabel));
        drawHardwareLabels(svg, wr, wx, wy, ww, wh);
      } else {
        svg.appendChild(svgEl('text', { x: wx + ww / 2, y: wy + wh / 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#fff', 'font-size': ww > 40 ? '11' : '9', 'font-weight': '600', 'pointer-events': 'none' }, markLabel));
      }

      if (showForces) {
        drawTCAnnotations(svg, w.id, wx, ww, lv);
      }
    }

    wrapper.insertBefore(expandBtn, svgContainer);
    svgContainer.appendChild(svg);
  }

  function drawStackingConnections(svg, walls, levelYs, pxPerFt, lvls) {
    for (let li = 0; li < lvls.length - 1; li++) {
      const upperLvl = levelYs.find(l => l.id === lvls[li].id);
      const lowerLvl = levelYs.find(l => l.id === lvls[li + 1].id);
      if (!upperLvl || !lowerLvl) continue;
      const upperWalls = walls.filter(w => w.levelId === lvls[li].id);
      const lowerWalls = walls.filter(w => w.levelId === lvls[li + 1].id);
      for (const uw of upperWalls) {
        for (const lw of lowerWalls) {
          const uStart = parseFloat(uw.position) || 0;
          const uEnd = uStart + (parseFloat(uw.length) || 0);
          const lStart = parseFloat(lw.position) || 0;
          const lEnd = lStart + (parseFloat(lw.length) || 0);
          if (uStart < lEnd && lStart < uEnd) {
            const oStart = Math.max(uStart, lStart);
            const oEnd = Math.min(uEnd, lEnd);
            const x1 = GUTTER + oStart * pxPerFt;
            const x2 = GUTTER + oEnd * pxPerFt;
            const y1 = upperLvl.y + upperLvl.basePx;
            const y2 = lowerLvl.y;
            if (y2 - y1 < 2) continue;
            svg.appendChild(svgEl('rect', { x: x1, y: y1, width: x2 - x1, height: y2 - y1, fill: 'var(--accent-bg)', opacity: 0.3, 'pointer-events': 'none' }));
            svg.appendChild(svgEl('line', { x1, y1, x2: x1, y2, stroke: 'var(--accent)', 'stroke-width': 1, 'stroke-dasharray': '4,3', 'pointer-events': 'none' }));
            svg.appendChild(svgEl('line', { x1: x2, y1, x2, y2, stroke: 'var(--accent)', 'stroke-width': 1, 'stroke-dasharray': '4,3', 'pointer-events': 'none' }));
          }
        }
      }
    }
  }

  function drawTCAnnotations(svg, wallId, wx, ww, lv) {
    const wr = findWallResult(wallId);
    if (!wr || !lv.forceStripH) return;
    let tL = 0, tR = 0, cL = 0, cR = 0;
    if (currentCombo === 'governing') {
      tL = wr.governingTensionLeft; tR = wr.governingTensionRight;
      cL = wr.governingComprLeft; cR = wr.governingComprRight;
    } else if (wr.combos && wr.combos[currentCombo]) {
      const c = wr.combos[currentCombo];
      tL = c.tensionLeft || 0; tR = c.tensionRight || 0;
      cL = c.comprLeft || 0; cR = c.comprRight || 0;
    }
    if (!tL && !tR && !cL && !cR) return;

    const sY = lv.forceStripY;
    const tRow = sY + 12;
    const cRow = sY + 25;
    const leftX = wx + 2;
    const rightX = wx + ww - 2;
    const narrow = ww < 60;

    function drawVal(x, y, val, color, isUp) {
      if (val <= 0) return;
      const tri = isUp ? `${x - 4},${y} ${x + 4},${y} ${x},${y - 6}` : `${x - 4},${y - 4} ${x + 4},${y - 4} ${x},${y + 2}`;
      svg.appendChild(svgEl('polygon', { points: tri, fill: color, 'pointer-events': 'none' }));
      svg.appendChild(svgEl('text', { x: x + 6, y, 'dominant-baseline': 'middle', fill: color, 'font-size': '9', 'font-weight': '600', 'pointer-events': 'none' }, val.toFixed(2)));
    }

    if (narrow) {
      const cx = wx + ww / 2;
      if (tL > 0 || tR > 0) drawVal(cx - 12, tRow, Math.max(tL, tR), TENSION_COLOR, true);
      if (cL > 0 || cR > 0) drawVal(cx - 12, cRow, Math.max(cL, cR), COMPR_COLOR, false);
    } else {
      drawVal(leftX, tRow, tL, TENSION_COLOR, true);
      drawVal(rightX - 30, tRow, tR, TENSION_COLOR, true);
      drawVal(leftX, cRow, cL, COMPR_COLOR, false);
      drawVal(rightX - 30, cRow, cR, COMPR_COLOR, false);
    }
  }

  function drawHardwareLabels(svg, wr, wx, wy, ww, wh) {
    if (ww < HW_MIN_WIDTH) return;

    const ancL = wr.anchorageLeft ? wr.anchorageLeft.id : 'OVER';
    const ancR = wr.anchorageRight ? wr.anchorageRight.id : 'OVER';
    const postL = wr.postLeft ? wr.postLeft.postLabel : 'OVER';
    const postR = wr.postRight ? wr.postRight.postLabel : 'OVER';

    svg.appendChild(svgEl('rect', { x: wx + 1, y: wy + 1, width: HW_EDGE_ZONE_W, height: wh - 2, fill: 'rgba(0,0,0,0.2)', rx: 1, 'pointer-events': 'none' }));
    svg.appendChild(svgEl('rect', { x: wx + ww - HW_EDGE_ZONE_W - 1, y: wy + 1, width: HW_EDGE_ZONE_W, height: wh - 2, fill: 'rgba(0,0,0,0.2)', rx: 1, 'pointer-events': 'none' }));

    function edgeLabel(x, y, text, ok, fs, fw) {
      svg.appendChild(svgEl('text', {
        x, y, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
        fill: ok ? '#fff' : 'var(--fail)', 'font-size': String(fs), 'font-weight': String(fw),
        transform: 'rotate(-90,' + x + ',' + y + ')', 'pointer-events': 'none',
      }, text));
    }

    const lx = wx + HW_EDGE_INSET;
    const rx = wx + ww - HW_EDGE_INSET;

    if (wh >= 40) {
      const topY = wy + wh * 0.30;
      const botY = wy + wh * 0.70;
      edgeLabel(lx, topY, ancL, !!wr.anchorageLeft, 9, 600);
      edgeLabel(lx, botY, postL, !!wr.postLeft, 9, 600);
      edgeLabel(rx, topY, ancR, !!wr.anchorageRight, 9, 600);
      edgeLabel(rx, botY, postR, !!wr.postRight, 9, 600);
    } else {
      const midY = wy + wh / 2;
      edgeLabel(lx, midY, ancL + ' / ' + postL, !!wr.anchorageLeft, 8, 600);
      edgeLabel(rx, midY, ancR + ' / ' + postR, !!wr.anchorageRight, 8, 600);
    }
  }

  function findWallResult(wallId) {
    if (!wallResults) return null;
    for (const pl of (wallResults.perLevel || [])) {
      const wr = (pl.walls || []).find(w => w.wallId === wallId);
      if (wr) return wr;
    }
    return null;
  }

  function selectWall(wallId) {
    selectedWallId = wallId;
    renderPropPanel();
    drawSVG();
  }

  function renderPropPanel() {
    clearEl(propPanel);
    if (!selectedWallId) { propPanel.hidden = true; return; }
    const w = (line.walls || []).find(ww => ww.id === selectedWallId);
    if (!w) { propPanel.hidden = true; return; }
    propPanel.hidden = false;

    const row = (...items) => el('div', { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.5rem' } }, ...items);
    const field = (label, inputEl) => el('div', { className: 'form-group', style: { marginBottom: 0, minWidth: '80px' } }, el('label', { className: 'form-label' }, label), inputEl);

    const markInput = el('input', { className: 'form-input mono', type: 'text', value: w.mark || '', style: { width: '90px' }, onChange(e) { w.mark = e.target.value; if (onInputChange) onInputChange(); drawSVG(); } });
    const posInput = el('input', { className: 'form-input mono', type: 'number', step: 'any', value: numOrBlank(w.position), style: { width: '70px' }, onChange(e) { w.position = e.target.value; if (onInputChange) onInputChange(); drawSVG(); } });
    const lenInput = el('input', { className: 'form-input mono', type: 'number', step: 'any', value: numOrBlank(w.length), style: { width: '70px' }, onChange(e) { w.length = e.target.value; if (onInputChange) onInputChange(); drawSVG(); } });

    const dlTypeSelect = el('select', { className: 'form-select', style: { width: '120px' }, onChange(e) { w.wallDLTypeId = e.target.value; if (onInputChange) onInputChange(); } });
    dlTypeSelect.appendChild(el('option', { value: '' }, '— None —'));
    (wallDLTypes || []).forEach(t => {
      const opt = el('option', { value: t.id }, (t.name || '?') + ' (' + (t.psf || 0) + ' psf)');
      if (w.wallDLTypeId === t.id) opt.selected = true;
      dlTypeSelect.appendChild(opt);
    });

    const deleteBtn = el('button', { className: 'btn btn-sm btn-danger', type: 'button', onClick() {
      const idx = (line.walls || []).findIndex(ww => ww.id === w.id);
      if (idx >= 0) line.walls.splice(idx, 1);
      selectedWallId = null;
      propPanel.hidden = true;
      if (onWallChange) onWallChange();
      if (onInputChange) onInputChange();
      drawSVG();
    } }, 'Delete Wall');

    propPanel.appendChild(el('div', { style: { fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.9rem' } }, 'Wall Properties — ' + (w.mark || w.id)));
    propPanel.appendChild(row(field('Mark', markInput), field('Position (ft)', posInput), field('Length (ft)', lenInput), field('Wall DL Type', dlTypeSelect)));

    const nailSel = el('select', { className: 'form-select', style: { width: '130px' }, onChange(e) { w.nailingPattern = e.target.value; if (onInputChange) onInputChange(); } });
    nailSel.appendChild(el('option', { value: '' }, 'Auto'));
    NAILING_TABLE.forEach(n => {
      const opt = el('option', { value: n.id }, n.label + ' (' + n.asdE + '/' + n.asdW + ')');
      if (w.nailingPattern === n.id) opt.selected = true;
      nailSel.appendChild(opt);
    });

    function hwSelect(key, items, labelFn) {
      const sel = el('select', { className: 'form-select', style: { width: '110px' }, onChange(e) { w[key] = e.target.value; if (onInputChange) onInputChange(); } });
      sel.appendChild(el('option', { value: '' }, 'Auto'));
      items.forEach(it => {
        const opt = el('option', { value: it.id }, labelFn(it));
        if (w[key] === it.id) opt.selected = true;
        sel.appendChild(opt);
      });
      return sel;
    }
    const ancItems = [...HDUE_TABLE, ...(MSTC_TABLE['16'] || [])];
    const ancLabelFn = (it) => it.id + ' (' + (it.cap / 1000).toFixed(1) + 'k)';
    const postItems = [...(POST_SIZES['4'] || []), ...(POST_SIZES['6'] || [])];
    const postLabelFn = (it) => it.label;

    propPanel.appendChild(row(field('Nailing', nailSel)));
    propPanel.appendChild(el('div', { style: { fontSize: '0.8rem', fontWeight: '500', marginBottom: '0.25rem', color: 'var(--ink-secondary)' } }, 'Hardware Overrides (blank = auto-select)'));
    propPanel.appendChild(row(
      field('HD/Strap Left', hwSelect('anchorageLeftOverride', ancItems, ancLabelFn)),
      field('HD/Strap Right', hwSelect('anchorageRightOverride', ancItems, ancLabelFn)),
    ));
    propPanel.appendChild(row(
      field('Post Left', hwSelect('postLeftOverride', postItems, postLabelFn)),
      field('Post Right', hwSelect('postRightOverride', postItems, postLabelFn)),
    ));
    propPanel.appendChild(row(deleteBtn));
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
          el('td', null, el('input', { type: 'number', step: 'any', value: numOrBlank(u.start), style: { width: '60px' }, onChange(e) { u.start = e.target.value; if (onGravityChange) onGravityChange(); if (onInputChange) onInputChange(); drawSVG(); } })),
          el('td', null, el('input', { type: 'number', step: 'any', value: numOrBlank(u.end), style: { width: '60px' }, onChange(e) { u.end = e.target.value; if (onGravityChange) onGravityChange(); if (onInputChange) onInputChange(); drawSVG(); } })),
          el('td', null, el('input', { type: 'number', step: 'any', value: numOrBlank(u.dlPlf), style: { width: '70px' }, onChange(e) { u.dlPlf = e.target.value; if (onGravityChange) onGravityChange(); if (onInputChange) onInputChange(); drawSVG(); } })),
          el('td', { className: 'row-actions' }, el('button', { className: 'btn btn-ghost btn-sm', type: 'button', onClick() { gl.uniform.splice(i, 1); renderGravitySection(); if (onGravityChange) onGravityChange(); if (onInputChange) onInputChange(); drawSVG(); } }, '×')),
        ));
      });
      lvlPanel.appendChild(uTable);
      lvlPanel.appendChild(el('button', { className: 'btn btn-sm', type: 'button', style: { marginRight: '0.5rem', marginTop: '0.25rem' }, onClick() { gl.uniform.push(newUniformLoad(0, parseFloat(line.totalLength) || 60)); renderGravitySection(); if (onInputChange) onInputChange(); drawSVG(); } }, '+ Uniform'));

      const pTable = el('table', { className: 'dynamic-table', style: { fontSize: '0.85rem', marginTop: '0.5rem' } });
      if (gl.point.length > 0) {
        pTable.appendChild(el('tr', null, el('th', null, 'Position (ft)'), el('th', null, 'DL (kips)'), el('th', { className: 'row-actions' }, '')));
        gl.point.forEach((p, i) => {
          pTable.appendChild(el('tr', null,
            el('td', null, el('input', { type: 'number', step: 'any', value: numOrBlank(p.position), style: { width: '60px' }, onChange(e) { p.position = e.target.value; if (onGravityChange) onGravityChange(); if (onInputChange) onInputChange(); drawSVG(); } })),
            el('td', null, el('input', { type: 'number', step: 'any', value: numOrBlank(p.dlKips), style: { width: '70px' }, onChange(e) { p.dlKips = e.target.value; if (onGravityChange) onGravityChange(); if (onInputChange) onInputChange(); drawSVG(); } })),
            el('td', { className: 'row-actions' }, el('button', { className: 'btn btn-ghost btn-sm', type: 'button', onClick() { gl.point.splice(i, 1); renderGravitySection(); if (onGravityChange) onGravityChange(); if (onInputChange) onInputChange(); drawSVG(); } }, '×')),
          ));
        });
        lvlPanel.appendChild(pTable);
      }
      lvlPanel.appendChild(el('button', { className: 'btn btn-sm', type: 'button', style: { marginTop: '0.25rem' }, onClick() { gl.point.push(newPointLoad(0)); renderGravitySection(); if (onInputChange) onInputChange(); drawSVG(); } }, '+ Point Load'));

      gravSection.appendChild(lvlPanel);
    }
  }

  function buildComboRow() {
    clearEl(comboRow);
    if (!wallResults) { comboRow.hidden = true; return; }
    comboRow.hidden = false;

    const forcesChk = el('input', { type: 'checkbox', checked: showForcesOn, onChange(e) {
      showForcesOn = e.target.checked;
      if (showForcesOn && !currentCombo) currentCombo = 'governing';
      buildComboRow();
      drawSVG();
    } });
    comboRow.appendChild(el('label', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', fontWeight: '500', cursor: 'pointer' } }, forcesChk, 'Forces'));

    if (showForcesOn) {
      const sel = el('select', { className: 'form-select', style: { maxWidth: '220px', fontSize: '0.85rem', marginLeft: '0.25rem' }, onChange(e) { currentCombo = e.target.value || 'governing'; drawSVG(); } });

      const sampleWall = wallResults.perLevel?.[0]?.walls?.[0];
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
      drawSVG();
    } });
    comboRow.appendChild(el('label', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', fontWeight: '500', cursor: 'pointer', marginLeft: '1rem' } }, hwChk, 'Hardware'));
  }

  function refresh(updatedLine, updatedLevels, updatedWallDLTypes) {
    if (updatedLine) Object.assign(line, updatedLine);
    if (updatedLevels) levels.splice(0, levels.length, ...updatedLevels);
    if (updatedWallDLTypes) wallDLTypes.splice(0, wallDLTypes.length, ...updatedWallDLTypes);
    renderGravitySection();
    drawSVG();
  }

  function showResults(lineResults) {
    wallResults = lineResults;
    if (wallResults) {
      showForcesOn = true;
      showHardwareOn = true;
      if (!currentCombo) currentCombo = 'governing';
    }
    buildComboRow();
    drawSVG();
  }

  function destroy() {
    if (isExpanded) toggleExpand();
    clearEl(wrapper);
  }

  renderGravitySection();
  setTimeout(drawSVG, 0);

  return { destroy, refresh, showResults, drawSVG };
}
