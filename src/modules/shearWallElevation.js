import { el, clearEl, numOrBlank } from '../utils.js';
import { svgEl, newWall, newUniformLoad, newPointLoad, newBeam, newSupportPost } from './shearWallTypes.js';
import { NAILING_TABLE } from './shearWallNailing.js';
import { HDUE_TABLE, MSTC_TABLE, POST_SIZES } from './shearWallHardware.js';

const GUTTER = 80;
const RULER_H = 24;
const MIN_LEVEL_H = 60;
const MIN_LEVEL_H_HW = 120;
const MIN_PX_PER_FT = 6;
const ANNOT_STRIP_H = 32;
const Y_MULT_DEFAULT = 4;
const Y_MULT_HARDWARE = 10;
const WALL_MARGIN = 1;
const HW_EDGE_ZONE_W = 34;
const HW_COL_INSET_1 = 9;
const HW_COL_INSET_2 = 25;
const HW_MIN_WIDTH = 80;
const WALL_COLOR = 'var(--accent)';
const WALL_SELECTED = '#2563eb';
const WALL_HOVER = 'var(--accent-hover)';
const TENSION_COLOR = '#dc2626';
const COMPR_COLOR = '#2563eb';
const HW_COLOR = '#7c3aed';
const BEAM_H = 6;
const BEAM_COLOR = '#7c3aed';
const POST_COLOR = '#7c3aed';
const SUPPORT_SIZE = 8;
const WARN_COLOR = '#dc2626';

function haloText(attrs, text) {
  const g = svgEl('g', { 'pointer-events': 'none' });
  g.appendChild(svgEl('text', { ...attrs, stroke: 'var(--surface)', 'stroke-width': '2.5', 'paint-order': 'stroke', fill: 'var(--surface)' }, text));
  g.appendChild(svgEl('text', { ...attrs }, text));
  return g;
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
  }
  buildToolbar();

  wrapper.appendChild(toolbarRow);
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

  function snapToWallEndsOrGrid(ft) {
    const SNAP_THRESHOLD = 0.5;
    let bestDist = SNAP_THRESHOLD;
    let bestSnap = null;
    for (const w of (line.walls || [])) {
      const wStart = parseFloat(w.position) || 0;
      const wEnd = wStart + (parseFloat(w.length) || 0);
      if (Math.abs(ft - wStart) < bestDist) { bestDist = Math.abs(ft - wStart); bestSnap = wStart; }
      if (Math.abs(ft - wEnd) < bestDist) { bestDist = Math.abs(ft - wEnd); bestSnap = wEnd; }
    }
    for (const b of (line.beams || [])) {
      const bStart = parseFloat(b.position) || 0;
      const bEnd = bStart + (parseFloat(b.length) || 0);
      if (Math.abs(ft - bStart) < bestDist) { bestDist = Math.abs(ft - bStart); bestSnap = bStart; }
      if (Math.abs(ft - bEnd) < bestDist) { bestDist = Math.abs(ft - bEnd); bestSnap = bEnd; }
    }
    for (const sp of (line.supportPosts || [])) {
      const spPos = parseFloat(sp.position) || 0;
      if (Math.abs(ft - spPos) < bestDist) { bestDist = Math.abs(ft - spPos); bestSnap = spPos; }
    }
    return bestSnap != null ? bestSnap : Math.round(ft * 2) / 2;
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

          // Snap to wall ends first, then 0.5ft grid
          const snapFt = snapToWallEndsOrGrid(ft);

          // Check if clicking an existing wall
          const hitWall = (line.walls || []).find(w => {
            if (w.levelId !== lv.id) return false;
            const ws = parseFloat(w.position) || 0;
            const we = ws + (parseFloat(w.length) || 0);
            return clickX >= GUTTER + ws * pxPerFt && clickX <= GUTTER + we * pxPerFt;
          });
          if (hitWall) { selectElement('wall', hitWall.id); return; }

          // Place new element based on mode, or deselect in none mode
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
            const bottomLevelId = levels.length > 0 ? levels[levels.length - 1].id : lv.id;
            const sp = newSupportPost(bottomLevelId, snapFt);
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
          if (onInputChange) onInputChange();
          drawSVG();
        },
      });
      svg.appendChild(lvRect);
    }

    drawStackingConnections(svg, line.walls || [], levelYs, pxPerFt, levels);
    drawBeams(svg, line.beams || [], levelYs, pxPerFt);
    drawSupportPosts(svg, line.supportPosts || [], levelYs, pxPerFt, levels);
    drawAuditWarnings(svg, line.walls || [], levelYs, pxPerFt);

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
        x: wx, y: wy, width: Math.max(ww, 2), height: Math.max(wh, 8),
        fill, opacity: 0.7, stroke: isSel ? WALL_SELECTED : 'var(--ink)', 'stroke-width': isSel ? 2.5 : 1, rx: 2,
        style: { cursor: 'grab' },
        onMousedown(e) {
          e.stopPropagation();
          const svgRect = svg.getBoundingClientRect();
          const startFt = (e.clientX - svgRect.left - GUTTER) / pxPerFt;
          dragState = { wallId: w.id, startFt, origPos: parseFloat(w.position) || 0 };
          selectElement('wall', w.id);
        },
      });
      svg.appendChild(wallRect);

      if (ar > 2.0) {
        svg.appendChild(haloText({ x: wx + ww / 2, y: lv.y - 4, 'text-anchor': 'middle', fill: 'var(--fail)', 'font-size': '8', 'font-weight': '700' }, 'h/b=' + ar.toFixed(1)));
      }

      const markLabel = w.mark || w.id;
      if (showHW && wr) {
        svg.appendChild(svgEl('text', { x: wx + ww / 2, y: wy + 16, 'text-anchor': 'middle', fill: '#fff', 'font-size': '9', 'font-weight': '600', 'pointer-events': 'none' }, markLabel));
        const nailLabel = wr.nailing ? wr.nailing.label : '';
        const nailFS = ww > 50 ? '10' : '8';
        svg.appendChild(svgEl('text', { x: wx + ww / 2, y: wy + wh / 2 - 7, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#fff', 'font-size': nailFS, 'font-weight': '600', 'pointer-events': 'none' }, nailLabel));
        const dcVal = wr.dcRatio != null ? wr.dcRatio.toFixed(2) : '—';
        const dcCol = wr.dcRatio > 1.0 ? '#fca5a5' : wr.dcRatio > 0.8 ? '#fde68a' : '#86efac';
        svg.appendChild(svgEl('text', { x: wx + ww / 2, y: wy + wh / 2 + 7, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: dcCol, 'font-size': nailFS, 'font-weight': '700', 'pointer-events': 'none' }, 'D/C ' + dcVal));
        drawHardwareLabels(svg, wr, wx, wy, ww, wh);
      } else {
        svg.appendChild(svgEl('text', { x: wx + ww / 2, y: wy + wh / 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#fff', 'font-size': ww > 40 ? '11' : '9', 'font-weight': '600', 'pointer-events': 'none' }, markLabel));
      }

      if (showForces) {
        drawTCAnnotations(svg, w.id, wx, ww, lv);
      }
    }

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
          const dww = (parseFloat(dw.length) || 0) * pxPerFt;
          const dlv = levelYs.find(l => l.id === dw.levelId);
          if (dlv) {
            previewGroup.appendChild(svgEl('rect', {
              x: dpx, y: dlv.y + WALL_MARGIN, width: Math.max(dww, 2), height: dlv.basePx - 2 * WALL_MARGIN,
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
      const hoveredLv = levelYs.find(l => my >= l.y && my < l.y + l.basePx);
      if (hoveredLv) {
        if (placementMode === 'beam') {
          const bw = 8 * pxPerFt;
          previewGroup.appendChild(svgEl('rect', {
            x: snapPx, y: hoveredLv.y + hoveredLv.basePx - BEAM_H, width: bw, height: BEAM_H,
            fill: BEAM_COLOR, opacity: 0.3, rx: 1,
          }));
        } else if (placementMode === 'post') {
          const botLv = levelYs[levelYs.length - 1];
          const prevLv = levelYs.length >= 2 ? levelYs[levelYs.length - 2] : botLv;
          previewGroup.appendChild(svgEl('line', {
            x1: snapPx, y1: prevLv.y + prevLv.basePx, x2: snapPx, y2: botLv.y + botLv.basePx,
            stroke: POST_COLOR, 'stroke-width': 1.5, 'stroke-dasharray': '6,4', opacity: 0.4,
          }));
        } else {
          const wPreviewW = 4 * pxPerFt;
          previewGroup.appendChild(svgEl('rect', {
            x: snapPx, y: hoveredLv.y + WALL_MARGIN, width: wPreviewW, height: hoveredLv.basePx - 2 * WALL_MARGIN,
            fill: 'var(--accent)', opacity: 0.2, rx: 2,
          }));
        }
      }
    }

    svg.addEventListener('mousemove', (e) => updatePreview(e.clientX, e.clientY));
    svg.addEventListener('mouseleave', () => {
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
          if (onInputChange) onInputChange();
        }
        dragState = null;
        drawSVG();
      }
    });

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

  function drawBeams(svg, beams, levelYs, pxPerFt) {
    for (const b of beams) {
      const lv = levelYs.find(l => l.id === b.levelId);
      if (!lv) continue;
      const bx = GUTTER + (parseFloat(b.position) || 0) * pxPerFt;
      const bw = (parseFloat(b.length) || 0) * pxPerFt;
      const by = lv.y + lv.basePx - BEAM_H;
      const isSel = b.id === selectedBeamId;

      svg.appendChild(svgEl('rect', {
        x: bx, y: by - 4, width: Math.max(bw, 4), height: BEAM_H + 8,
        fill: 'transparent', style: { cursor: 'pointer' },
        onClick(e) { e.stopPropagation(); selectElement('beam', b.id); },
      }));
      svg.appendChild(svgEl('rect', {
        x: bx, y: by, width: Math.max(bw, 4), height: BEAM_H,
        fill: BEAM_COLOR, opacity: 0.85, stroke: isSel ? '#fff' : BEAM_COLOR,
        'stroke-width': isSel ? 2 : 0.5, rx: 1, 'pointer-events': 'none',
      }));

      // Support triangles at each end
      const triH = SUPPORT_SIZE;
      for (const sx of [bx, bx + bw]) {
        svg.appendChild(svgEl('polygon', {
          points: [sx - triH / 2, by + BEAM_H + triH, sx + triH / 2, by + BEAM_H + triH, sx, by + BEAM_H].join(' '),
          fill: BEAM_COLOR, opacity: 0.7, 'pointer-events': 'none',
        }));
      }

      // Beam label
      if (bw > 30) {
        svg.appendChild(svgEl('text', {
          x: bx + bw / 2, y: by + BEAM_H / 2 + 1,
          'text-anchor': 'middle', 'dominant-baseline': 'middle',
          fill: '#fff', 'font-size': '8', 'font-weight': '600', 'pointer-events': 'none',
        }, 'BM'));
      }

      // Beam reactions when results are shown
      if (wallResults && wallResults.beamTransfers) {
        const bt = wallResults.beamTransfers.find(t => t.beamId === b.id);
        if (bt) {
          const rFS = '8';
          const rY = by + BEAM_H + triH + 10;
          if (bt.leftReaction.tension > 0 || bt.leftReaction.compression > 0) {
            svg.appendChild(haloText({ x: bx, y: rY, 'text-anchor': 'middle', fill: TENSION_COLOR, 'font-size': rFS, 'font-weight': '600' },
              'T' + bt.leftReaction.tension.toFixed(2) + 'k'));
            svg.appendChild(haloText({ x: bx, y: rY + 10, 'text-anchor': 'middle', fill: COMPR_COLOR, 'font-size': rFS, 'font-weight': '600' },
              'C' + bt.leftReaction.compression.toFixed(2) + 'k'));
          }
          if (bt.rightReaction.tension > 0 || bt.rightReaction.compression > 0) {
            svg.appendChild(haloText({ x: bx + bw, y: rY, 'text-anchor': 'middle', fill: TENSION_COLOR, 'font-size': rFS, 'font-weight': '600' },
              'T' + bt.rightReaction.tension.toFixed(2) + 'k'));
            svg.appendChild(haloText({ x: bx + bw, y: rY + 10, 'text-anchor': 'middle', fill: COMPR_COLOR, 'font-size': rFS, 'font-weight': '600' },
              'C' + bt.rightReaction.compression.toFixed(2) + 'k'));
          }
        }
      }
    }
  }

  function drawSupportPosts(svg, posts, levelYs, pxPerFt, lvls) {
    if (levelYs.length < 1) return;
    const bottomLv = levelYs[levelYs.length - 1];
    const aboveLv = levelYs.length >= 2 ? levelYs[levelYs.length - 2] : bottomLv;

    for (const sp of posts) {
      const px = GUTTER + (parseFloat(sp.position) || 0) * pxPerFt;
      const isSel = sp.id === selectedPostId;

      // Post spans floor-to-floor at foundation level
      const y1 = aboveLv.y + aboveLv.basePx;
      const y2 = bottomLv.y + bottomLv.basePx;

      // Transparent click target for the post
      svg.appendChild(svgEl('rect', {
        x: px - 6, y: y1, width: 12, height: Math.max(y2 - y1, 12),
        fill: 'transparent', style: { cursor: 'pointer' },
        onClick(e) { e.stopPropagation(); selectElement('post', sp.id); },
      }));

      svg.appendChild(svgEl('line', {
        x1: px, y1, x2: px, y2,
        stroke: isSel ? '#fff' : POST_COLOR, 'stroke-width': isSel ? 2.5 : 1.5,
        'stroke-dasharray': '6,4', 'pointer-events': 'none',
      }));

      // Diamond marker at foundation
      const my = y2;
      svg.appendChild(svgEl('polygon', {
        points: [px, my - 5, px + 4, my, px, my + 5, px - 4, my].join(' '),
        fill: POST_COLOR, stroke: '#fff', 'stroke-width': 0.5, 'pointer-events': 'none',
      }));

      // Post accumulated values at foundation
      if (wallResults && wallResults.postPaths) {
        const pp = wallResults.postPaths.find(p => p.postId === sp.id);
        if (pp && pp.perLevel.length > 0) {
          const pl = pp.perLevel[0];
          if (pl.accumT > 0 || pl.accumC > 0) {
            svg.appendChild(haloText({ x: px + 8, y: my + 4, fill: POST_COLOR, 'font-size': '7', 'font-weight': '600' },
              'T' + pl.accumT.toFixed(1) + 'k  C' + pl.accumC.toFixed(1) + 'k'));
          }
        }
      }
    }
  }

  function drawAuditWarnings(svg, walls, levelYs, pxPerFt) {
    if (!wallResults || !wallResults.loadPathAudit) return;
    for (const warn of wallResults.loadPathAudit.warnings) {
      if (warn.type === 'unsupported_wall') {
        const w = walls.find(ww => ww.id === warn.elementId);
        if (!w) continue;
        const lv = levelYs.find(l => l.id === w.levelId);
        if (!lv) continue;
        const wx = GUTTER + (parseFloat(w.position) || 0) * pxPerFt;
        const ww2 = (parseFloat(w.length) || 0) * pxPerFt;
        const wy = lv.y + WALL_MARGIN;
        const wh = lv.basePx - 2 * WALL_MARGIN;
        svg.appendChild(svgEl('rect', {
          x: wx - 1, y: wy - 1, width: Math.max(ww2, 2) + 2, height: wh + 2,
          fill: 'none', stroke: WARN_COLOR, 'stroke-width': 2, 'stroke-dasharray': '4,2',
          rx: 3, 'pointer-events': 'none',
        }));
        svg.appendChild(svgEl('text', {
          x: wx + ww2 / 2, y: lv.y + lv.basePx + 12,
          'text-anchor': 'middle', fill: WARN_COLOR, 'font-size': '10', 'font-weight': '700', 'pointer-events': 'none',
        }, '⚠'));
      }
    }
  }

  function drawTCAnnotations(svg, wallId, wx, ww, lv) {
    const wr = findWallResult(wallId);
    if (!wr || !lv.forceStripH) return;

    if (currentCombo === '1.0D') {
      const sY = lv.forceStripY;
      const midY = sY + lv.forceStripH / 2;
      const dlColor = '#78716c';
      const wLen = wr.length || 1;
      const dlKlf = wr.dlTotal / wLen;
      svg.appendChild(svgEl('rect', { x: wx + 1, y: sY + 2, width: ww - 2, height: lv.forceStripH - 4, fill: 'rgba(120,113,108,0.1)', rx: 2, 'pointer-events': 'none' }));
      svg.appendChild(haloText({ x: wx + ww / 2, y: midY, 'text-anchor': 'middle', fill: dlColor, 'font-size': '9', 'font-weight': '600' }, 'DL ' + dlKlf.toFixed(2) + ' klf'));
      return;
    }

    let tL = 0, tR = 0, cL = 0, cR = 0;
    let isAccum = false;
    if (currentCombo === 'governing') {
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
    } else if (wr.accumPerCombo && wr.accumPerCombo[currentCombo]) {
      const ac = wr.accumPerCombo[currentCombo];
      tL = ac.tensionLeft || 0; tR = ac.tensionRight || 0;
      cL = ac.comprLeft || 0; cR = ac.comprRight || 0;
      const c = wr.combos && wr.combos[currentCombo];
      if (c && (tL > (c.tensionLeft || 0) + 0.005 || tR > (c.tensionRight || 0) + 0.005 ||
                cL > (c.comprLeft || 0) + 0.005 || cR > (c.comprRight || 0) + 0.005)) {
        isAccum = true;
      }
    } else if (wr.combos && wr.combos[currentCombo]) {
      const c = wr.combos[currentCombo];
      tL = c.tensionLeft || 0; tR = c.tensionRight || 0;
      cL = c.comprLeft || 0; cR = c.comprRight || 0;
    }
    if (!tL && !tR && !cL && !cR) return;

    const ACCUM_T_COLOR = '#9333ea';
    const ACCUM_C_COLOR = '#6d28d9';
    const tColor = isAccum ? ACCUM_T_COLOR : TENSION_COLOR;
    const cColor = isAccum ? ACCUM_C_COLOR : COMPR_COLOR;

    const sY = lv.forceStripY;
    const tRow = sY + 12;
    const cRow = sY + 25;
    const leftX = wx + 2;
    const rightX = wx + ww - 2;
    const narrow = ww < 60;

    function drawVal(x, y, val, color, isUp, prefix) {
      if (val <= 0) return;
      const tri = isUp ? `${x - 4},${y} ${x + 4},${y} ${x},${y - 6}` : `${x - 4},${y - 4} ${x + 4},${y - 4} ${x},${y + 2}`;
      svg.appendChild(svgEl('polygon', { points: tri, fill: color, 'pointer-events': 'none' }));
      svg.appendChild(svgEl('text', { x: x + 6, y, 'dominant-baseline': 'middle', fill: color, 'font-size': '9', 'font-weight': '600', 'pointer-events': 'none' }, (prefix || '') + val.toFixed(2) + 'k'));
    }

    const prefix = isAccum ? 'Σ' : '';
    if (narrow) {
      const cx = wx + ww / 2;
      if (tL > 0 || tR > 0) drawVal(cx - 12, tRow, Math.max(tL, tR), tColor, true, prefix);
      if (cL > 0 || cR > 0) drawVal(cx - 12, cRow, Math.max(cL, cR), cColor, false, prefix);
    } else {
      drawVal(leftX, tRow, tL, tColor, true, prefix);
      drawVal(rightX - 30, tRow, tR, tColor, true, prefix);
      drawVal(leftX, cRow, cL, cColor, false, prefix);
      drawVal(rightX - 30, cRow, cR, cColor, false, prefix);
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

  function drawHardwareLabels(svg, wr, wx, wy, ww, wh) {
    if (ww < HW_MIN_WIDTH) return;

    const ancL = wr.anchorageLeft ? wr.anchorageLeft.id : 'OVER';
    const ancR = wr.anchorageRight ? wr.anchorageRight.id : 'OVER';
    const postL = wr.postLeft ? wr.postLeft.postLabel : 'OVER';
    const postR = wr.postRight ? wr.postRight.postLabel : 'OVER';

    const worstDCL = Math.max(wr.anchorageDCLeft || 0, wr.postDCLeft || 0);
    const worstDCR = Math.max(wr.anchorageDCRight || 0, wr.postDCRight || 0);
    const fillL = (!wr.anchorageLeft || !wr.postLeft) ? 'rgba(220,38,38,0.5)' : dcColorFill(worstDCL);
    const fillR = (!wr.anchorageRight || !wr.postRight) ? 'rgba(220,38,38,0.5)' : dcColorFill(worstDCR);

    svg.appendChild(svgEl('rect', { x: wx + 1, y: wy + 1, width: HW_EDGE_ZONE_W, height: wh - 2, fill: fillL, rx: 1, 'pointer-events': 'none' }));
    svg.appendChild(svgEl('rect', { x: wx + ww - HW_EDGE_ZONE_W - 1, y: wy + 1, width: HW_EDGE_ZONE_W, height: wh - 2, fill: fillR, rx: 1, 'pointer-events': 'none' }));

    const FS = 10;

    function hwLabel(x, y, text, color) {
      svg.appendChild(svgEl('text', {
        x, y, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
        fill: color, 'font-size': String(FS), 'font-weight': '600',
        transform: 'rotate(-90,' + x + ',' + y + ')', 'pointer-events': 'none',
      }, text));
    }

    const pad = 6;
    const usableH = wh - pad * 2;
    const midY = wy + wh / 2;

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

  function selectWall(wallId) { selectElement('wall', wallId); }

  function renderPropPanel() {
    clearEl(propPanel);
    if (selectedBeamId) { renderBeamPropPanel(); return; }
    if (selectedPostId) { renderPostPropPanel(); return; }
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

  function renderBeamPropPanel() {
    const b = (line.beams || []).find(bb => bb.id === selectedBeamId);
    if (!b) { propPanel.hidden = true; return; }
    propPanel.hidden = false;

    const row = (...items) => el('div', { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.5rem' } }, ...items);
    const field = (label, inputEl) => el('div', { className: 'form-group', style: { marginBottom: 0, minWidth: '80px' } }, el('label', { className: 'form-label' }, label), inputEl);

    const posInput = el('input', { className: 'form-input mono', type: 'number', step: 'any', value: numOrBlank(b.position), style: { width: '70px' },
      onChange(e) { b.position = e.target.value; if (onInputChange) onInputChange(); drawSVG(); } });
    const lenInput = el('input', { className: 'form-input mono', type: 'number', step: 'any', value: numOrBlank(b.length), style: { width: '70px' },
      onChange(e) { b.length = e.target.value; if (onInputChange) onInputChange(); drawSVG(); } });
    const deleteBtn = el('button', { className: 'btn btn-sm btn-danger', type: 'button', onClick() {
      const idx = (line.beams || []).findIndex(bb => bb.id === b.id);
      if (idx >= 0) line.beams.splice(idx, 1);
      selectedBeamId = null;
      propPanel.hidden = true;
      if (onInputChange) onInputChange();
      drawSVG();
    } }, 'Delete Beam');

    propPanel.appendChild(el('div', { style: { fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.9rem' } }, 'Transfer Beam — ' + b.id));
    propPanel.appendChild(row(field('Position (ft)', posInput), field('Span (ft)', lenInput)));
    propPanel.appendChild(row(deleteBtn));
  }

  function renderPostPropPanel() {
    const sp = (line.supportPosts || []).find(pp => pp.id === selectedPostId);
    if (!sp) { propPanel.hidden = true; return; }
    propPanel.hidden = false;

    const row = (...items) => el('div', { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.5rem' } }, ...items);
    const field = (label, inputEl) => el('div', { className: 'form-group', style: { marginBottom: 0, minWidth: '80px' } }, el('label', { className: 'form-label' }, label), inputEl);

    const posInput = el('input', { className: 'form-input mono', type: 'number', step: 'any', value: numOrBlank(sp.position), style: { width: '70px' },
      onChange(e) { sp.position = e.target.value; if (onInputChange) onInputChange(); drawSVG(); } });
    const deleteBtn = el('button', { className: 'btn btn-sm btn-danger', type: 'button', onClick() {
      const idx = (line.supportPosts || []).findIndex(pp => pp.id === sp.id);
      if (idx >= 0) line.supportPosts.splice(idx, 1);
      selectedPostId = null;
      propPanel.hidden = true;
      if (onInputChange) onInputChange();
      drawSVG();
    } }, 'Delete Post');

    propPanel.appendChild(el('div', { style: { fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.9rem' } }, 'Support Post — ' + sp.id + ' (Foundation)'));
    propPanel.appendChild(row(field('Position (ft)', posInput)));
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

    if (showHardwareOn) {
      const legend = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '0.75rem', fontSize: '0.75rem', color: 'var(--ink-secondary)' } });
      const swatch = (color, label) => el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '3px' } },
        el('span', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: color } }), label);
      legend.appendChild(swatch('rgba(34,197,94,0.6)', '< 0.8'));
      legend.appendChild(swatch('rgba(234,179,8,0.65)', '0.8–1.0'));
      legend.appendChild(swatch('rgba(220,38,38,0.6)', '> 1.0'));
      comboRow.appendChild(legend);
    }

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
    wallResults = lineResults;
    if (wallResults) {
      showForcesOn = true;
      showHardwareOn = true;
      if (!currentCombo) currentCombo = 'governing';
    }
    handle.hasResults = !!wallResults;
    buildComboRow();
    drawSVG();
  }

  function clearResults() {
    wallResults = null;
    showForcesOn = false;
    showHardwareOn = false;
    currentCombo = null;
    handle.hasResults = false;
    buildComboRow();
    drawSVG();
  }

  function destroy() {
    if (isExpanded) toggleExpand();
    clearEl(wrapper);
  }

  renderGravitySection();
  setTimeout(drawSVG, 0);

  const handle = { destroy, refresh, showResults, clearResults, drawSVG, hasResults: false };
  return handle;
}

// === Static SVG renderer for PDF ===

const PDF_COLORS = {
  accent: '#2563eb', accentBg: 'rgba(37,99,235,0.1)',
  border: '#d1d5db', borderLight: '#e5e7eb',
  surface: '#ffffff', ink: '#1a2233',
  inkSecondary: '#6b7280', inkTertiary: '#9ca3af',
  pass: '#22c55e', fail: '#dc2626', stale: '#eab308',
  beam: '#7c3aed', post: '#7c3aed',
  tension: '#dc2626', compression: '#2563eb',
};

function pdfHaloText(attrs, text) {
  const g = svgEl('g');
  g.appendChild(svgEl('text', { ...attrs, stroke: PDF_COLORS.surface, 'stroke-width': '2.5', 'paint-order': 'stroke', fill: PDF_COLORS.surface }, text));
  g.appendChild(svgEl('text', { ...attrs }, text));
  return g;
}

export function computeElevationLayout(line, levels, opts) {
  const totalLen = parseFloat(line.totalLength) || 60;
  const targetW = (opts && opts.width) || 600;
  const drawW = targetW - GUTTER - 20;
  const pxPerFt = Math.max(drawW / totalLen, MIN_PX_PER_FT);
  const svgW = GUTTER + totalLen * pxPerFt + 20;
  const yMult = (opts && opts.overlays) ? Y_MULT_HARDWARE : Y_MULT_DEFAULT;
  const minLvlH = (opts && opts.overlays) ? MIN_LEVEL_H_HW : MIN_LEVEL_H;

  let totalH = RULER_H + 10;
  const levelYs = [];
  for (const lvl of levels) {
    const ftH = parseFloat(lvl.floorToFloor) || 10;
    const basePx = Math.max(ftH * yMult, minLvlH);
    const px = basePx;
    levelYs.push({ id: lvl.id, name: lvl.name, y: totalH, h: px, ftH, basePx });
    totalH += px;
  }
  totalH += 10;

  return { totalLen, pxPerFt, svgW, totalH, levelYs };
}

export function renderElevationForPdf(line, levels, wallDLTypes, lineResults, width) {
  const C = PDF_COLORS;
  const layout = computeElevationLayout(line, levels, { width, overlays: true });
  const { totalLen, pxPerFt, svgW, totalH, levelYs } = layout;

  const svg = svgEl('svg', { xmlns: 'http://www.w3.org/2000/svg', width: svgW, height: totalH, viewBox: '0 0 ' + svgW + ' ' + totalH });
  svg.appendChild(svgEl('rect', { x: 0, y: 0, width: svgW, height: totalH, fill: C.surface }));

  // Ruler grid
  for (let i = 0; i <= totalLen; i += 5) {
    const x = GUTTER + i * pxPerFt;
    const isMajor = i % 10 === 0;
    svg.appendChild(svgEl('line', { x1: x, y1: RULER_H, x2: x, y2: totalH - 10, stroke: isMajor ? C.borderLight : C.border, 'stroke-width': isMajor ? 1 : 0.5, 'stroke-dasharray': isMajor ? 'none' : '2,4' }));
    if (isMajor) svg.appendChild(svgEl('text', { x, y: totalH - 2, 'text-anchor': 'middle', fill: C.inkTertiary, 'font-size': '8' }, String(i)));
  }

  // Level bands
  for (const lv of levelYs) {
    svg.appendChild(svgEl('line', { x1: GUTTER, y1: lv.y, x2: GUTTER + totalLen * pxPerFt, y2: lv.y, stroke: C.border, 'stroke-width': 1 }));
    svg.appendChild(svgEl('text', { x: GUTTER - 4, y: lv.y + 12, 'text-anchor': 'end', fill: C.ink, 'font-size': '9', 'font-weight': '600' }, lv.name || ''));
    svg.appendChild(svgEl('text', { x: GUTTER - 4, y: lv.y + 22, 'text-anchor': 'end', fill: C.inkTertiary, 'font-size': '7' }, lv.ftH.toFixed(0) + ' ft'));
  }

  // Stacking connections
  const walls = line.walls || [];
  for (let li = 0; li < levels.length - 1; li++) {
    const upperLvl = levelYs.find(l => l.id === levels[li].id);
    const lowerLvl = levelYs.find(l => l.id === levels[li + 1].id);
    if (!upperLvl || !lowerLvl) continue;
    for (const uw of walls.filter(w => w.levelId === levels[li].id)) {
      for (const lw of walls.filter(w => w.levelId === levels[li + 1].id)) {
        const uS = parseFloat(uw.position) || 0, uE = uS + (parseFloat(uw.length) || 0);
        const lS = parseFloat(lw.position) || 0, lE = lS + (parseFloat(lw.length) || 0);
        if (uS < lE && lS < uE) {
          const oS = Math.max(uS, lS), oE = Math.min(uE, lE);
          const x1 = GUTTER + oS * pxPerFt, x2 = GUTTER + oE * pxPerFt;
          const y1 = upperLvl.y + upperLvl.basePx, y2 = lowerLvl.y;
          if (y2 - y1 >= 2) {
            svg.appendChild(svgEl('rect', { x: x1, y: y1, width: x2 - x1, height: y2 - y1, fill: C.accentBg, opacity: 0.3 }));
            svg.appendChild(svgEl('line', { x1, y1, x2: x1, y2, stroke: C.accent, 'stroke-width': 1, 'stroke-dasharray': '4,3' }));
            svg.appendChild(svgEl('line', { x1: x2, y1, x2, y2, stroke: C.accent, 'stroke-width': 1, 'stroke-dasharray': '4,3' }));
          }
        }
      }
    }
  }

  // Beams
  for (const b of (line.beams || [])) {
    const lv = levelYs.find(l => l.id === b.levelId);
    if (!lv) continue;
    const bx = GUTTER + (parseFloat(b.position) || 0) * pxPerFt;
    const bw = (parseFloat(b.length) || 0) * pxPerFt;
    const by = lv.y + lv.basePx - BEAM_H;
    svg.appendChild(svgEl('rect', { x: bx, y: by, width: Math.max(bw, 4), height: BEAM_H, fill: C.beam, opacity: 0.85, rx: 1 }));
    for (const sx of [bx, bx + bw]) {
      svg.appendChild(svgEl('polygon', {
        points: [sx - 4, by + BEAM_H + 8, sx + 4, by + BEAM_H + 8, sx, by + BEAM_H].join(' '),
        fill: C.beam, opacity: 0.7,
      }));
    }
    if (bw > 30) svg.appendChild(svgEl('text', { x: bx + bw / 2, y: by + BEAM_H / 2 + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#fff', 'font-size': '8', 'font-weight': '600' }, 'BM'));
  }

  // Support posts (floor-to-floor at foundation level)
  if (levelYs.length > 0) {
    const pdfBotLv = levelYs[levelYs.length - 1];
    const pdfAboveLv = levelYs.length >= 2 ? levelYs[levelYs.length - 2] : pdfBotLv;
    for (const sp of (line.supportPosts || [])) {
      const px = GUTTER + (parseFloat(sp.position) || 0) * pxPerFt;
      const py1 = pdfAboveLv.y + pdfAboveLv.basePx;
      const py2 = pdfBotLv.y + pdfBotLv.basePx;
      svg.appendChild(svgEl('line', { x1: px, y1: py1, x2: px, y2: py2, stroke: C.post, 'stroke-width': 1.5, 'stroke-dasharray': '6,4' }));
      svg.appendChild(svgEl('polygon', { points: [px, py2 - 5, px + 4, py2, px, py2 + 5, px - 4, py2].join(' '), fill: C.post }));
    }
  }

  // Walls with D/C coloring
  const wrMap = {};
  if (lineResults) {
    for (const pl of (lineResults.perLevel || [])) {
      for (const wr of (pl.walls || [])) wrMap[wr.wallId] = wr;
    }
  }

  for (const w of walls) {
    const lv = levelYs.find(l => l.id === w.levelId);
    if (!lv) continue;
    const wx = GUTTER + (parseFloat(w.position) || 0) * pxPerFt;
    const ww = (parseFloat(w.length) || 0) * pxPerFt;
    const wy = lv.y + WALL_MARGIN;
    const wh = lv.basePx - 2 * WALL_MARGIN;
    const wr = wrMap[w.id];

    let fill = C.accent;
    if (wr) {
      if (wr.dcRatio > 1.0) fill = C.fail;
      else if (wr.dcRatio > 0.8) fill = C.stale;
      else fill = C.pass;
    }

    svg.appendChild(svgEl('rect', { x: wx, y: wy, width: Math.max(ww, 2), height: Math.max(wh, 8), fill, opacity: 0.7, stroke: C.ink, 'stroke-width': 1, rx: 2 }));
    svg.appendChild(svgEl('text', { x: wx + ww / 2, y: wy + wh / 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#fff', 'font-size': ww > 40 ? '10' : '8', 'font-weight': '600' }, w.mark || w.id));

    // T/C governing values
    if (wr && wr.governingTensionLeft > 0) {
      svg.appendChild(pdfHaloText({ x: wx + 4, y: wy + wh + 12, fill: C.tension, 'font-size': '7', 'font-weight': '600' },
        'T' + Math.max(wr.governingTensionLeft, wr.governingTensionRight).toFixed(2) + 'k'));
    }
    if (wr && wr.governingComprRight > 0) {
      svg.appendChild(pdfHaloText({ x: wx + ww - 4, y: wy + wh + 12, 'text-anchor': 'end', fill: C.compression, 'font-size': '7', 'font-weight': '600' },
        'C' + Math.max(wr.governingComprLeft, wr.governingComprRight).toFixed(2) + 'k'));
    }
  }

  // Audit warnings
  if (lineResults && lineResults.loadPathAudit) {
    for (const warn of lineResults.loadPathAudit.warnings) {
      if (warn.type === 'unsupported_wall') {
        const w = walls.find(ww => ww.id === warn.elementId);
        if (!w) continue;
        const lv = levelYs.find(l => l.id === w.levelId);
        if (!lv) continue;
        const wx = GUTTER + (parseFloat(w.position) || 0) * pxPerFt;
        const ww2 = (parseFloat(w.length) || 0) * pxPerFt;
        svg.appendChild(svgEl('rect', { x: wx - 1, y: lv.y + WALL_MARGIN - 1, width: Math.max(ww2, 2) + 2, height: lv.basePx - 2 * WALL_MARGIN + 2, fill: 'none', stroke: C.fail, 'stroke-width': 2, 'stroke-dasharray': '4,2', rx: 3 }));
      }
    }
  }

  return svg;
}
