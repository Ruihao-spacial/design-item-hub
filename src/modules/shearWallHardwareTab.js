// Hardware tab of the Shear Wall form: every table the design uses, with where it comes from.
// Layout (user 2026-10-13): source block above each table (document, edition / page, entered by, Shared Drive file,
// basis); a DF/SP | SPF/HF toggle shows one framing group at a time (default = the project species' group);
// calculated columns are marked ƒ with the formula in the notes; values not entered show "—".
// Data: generated from the reference .md files (shearWallHardwareData.js, npm run hardware:build).
// One content list (hardwareBlocks) feeds the tab and the PDF "Design data" appendix (Detailed report, user
// 2026-10-27: only the hardware the project uses, on the project's framing group).
import { el } from '../utils.js';
import { rich } from '../richText.js';
import { nailingTable, nailingCG, FOOTNOTE_10_FACTOR, sheathingLabel } from './shearWallNailing.js';
import { NDS_GRADES, POST_SIZES, FTAO_STRAP_TABLE, SPECIES_GROUPS, SPECIES, HARDWARE_SOURCES, MSTC_SPANS,
  computePostCapacity, woodBasis, hdueTable, mstcTable, memberProps, groupLabel, postSizeById } from './shearWallHardware.js';
import { WSWH_T01, WSWH_T02, WSWH_T03 } from './shearWallWswhData.js';
import { wswhRowsUsed } from './shearWallWswh.js';

const MISSING = '—';
const REF_DIR = 'Shearwall design reference/';
const noteStyle = { fontSize: '0.8rem', color: 'var(--ink-secondary)', lineHeight: '1.6' };
const missingStyle = { color: 'var(--ink-tertiary)', fontStyle: 'italic' };
const WSWH_TABLES = [
  ['T01', 'Table 01 — standard & balloon framing on concrete (pp. 40–41)', WSWH_T01, true],
  ['T02', 'Table 02 — first story on a raised wood floor (p. 47)', WSWH_T02, false],
  ['T03', 'Table 03 — two-story stacked, second-story panel (p. 50; no T published)', WSWH_T03, false],
];
const postThickness = (id) => (POST_SIZES['6'].some(p => p.id === id) && !POST_SIZES['4'].some(p => p.id === id) ? '6' : '4');
const r2 = (v) => Math.round(v * 100) / 100;

// The hardware a design uses (calcAll outputs): nailing ids, HDUE ids per wall width, MSTC ids per span, FTAO
// strap + nail rows, WSWH table rows, and posts by wall width and floor height.
export function hardwareUsed(inputs, outputs) {
  const used = { nailing: new Set(), hdue: {}, mstc: {}, ftao: new Set(), wswh: {}, posts: {}, pt: false };
  const anchorage = (a) => {
    if (!a || !a.id) return;
    if (a.family === 'HDUE') (used.hdue[Object.keys(a.minPost || { 4: 1 })[0]] ||= new Set()).add(a.id);
    if (a.family === 'MSTC') (used.mstc[a.span] ||= new Set()).add(a.id);
  };
  const post = (id, heightFt) => {
    const p = postSizeById(id);
    if (!p || !(heightFt > 0)) return;
    if (p.pt) used.pt = true;
    ((used.posts[postThickness(id)] ||= {})[r2(heightFt)] ||= new Set()).add(id);
  };
  const fc = inputs.wswhFc || '2500';
  for (const dir of (outputs && outputs.perDirection) || []) for (const ln of dir.perLine) {
    for (const pl of ln.perLevel) for (const w of pl.walls) {
      if (w.method === 'wswh') {
        const x = w.wswh;
        if (!x || !x.ok) continue;
        const { table, rows } = wswhRowsUsed({ width: x.width, condition: x.role, ftfFt: w.floorH, fc });
        for (const r of rows) (used.wswh[table] ||= new Set()).add(r);
        continue;
      }
      if (w.nailing) used.nailing.add(w.nailing.id);
      anchorage(w.anchorageLeft); anchorage(w.anchorageRight);
      for (const p of [w.postLeft, w.postRight]) if (p) post(p.postId, p.le1 / 12);
      if (w.ftao && w.ftao.strap) used.ftao.add(w.ftao.strap.id + '|' + ((w.ftao.strap.nailing || {}).d || ''));
      for (const j of (w.ftao && w.ftao.jambs) || []) if (j.post) post(j.post.id, w.floorH);
    }
    for (const pp of ln.postPaths || []) { anchorage(pp.anchorage); if (pp.post) post(pp.post.postId, pp.post.le1 / 12); }
    for (const bt of ln.beamTransfers || []) for (const sp of bt.supports || []) anchorage(sp.anchorage);
  }
  return used;
}

// Blocks: { k: 'head' | 'source' | 'sub' | 'table' | 'notes' | 'details' | 'wswhToggle' }.
// view: { species, wswhLoad } (screen state). used: hardwareUsed() → only those rows, project framing group, WSWH
// for the project's load type(s), nothing collapsed (PDF appendix); null → every table (Hardware tab).
export function hardwareBlocks(inputs, view, used) {
  const wood = woodBasis(inputs);
  const sp = used ? wood.group : (view.species || wood.group);
  const spLabel = groupLabel(sp);
  const B = [];
  const head = (text) => B.push({ k: 'head', text });
  const source = (src, basis) => B.push({ k: 'source', src, basis });
  const sub = (text) => B.push({ k: 'sub', text });
  const table = (cols, rows) => B.push({ k: 'table', cols, rows });
  const notes = (lines) => B.push({ k: 'notes', lines: lines.filter(Boolean) });
  const pick = (set, id) => !used || (set && set.has(id));

  // --- 1. Nailing ---
  const cg = nailingCG(sp);
  const nails = nailingTable(sp).filter(n => pick(used && used.nailing, n.id));
  if (nails.length) {
    head('Shear Wall Nailing Capacity — SDPWS Table 4.3A — ' + spLabel);
    source(HARDWARE_SOURCES.nailing, '15/32" WSP Structural 1, 10d common nails; capacities include the ' + FOOTNOTE_10_FACTOR + ' factor of SDPWS Table 4.3A footnote 10');
    table([
      { h: 'E.N.' }, { h: 'Sides' }, { h: cg !== 1 ? 'V_n × C_G (plf)' : 'V_n (plf)', num: true },
      { h: 'ASD E (plf)', num: true }, { h: 'ASD W (plf)', num: true }, { h: 'LRFD E (plf)', num: true }, { h: 'LRFD W (plf)', num: true },
      { h: 'G_a OSB (k/in)', num: true }, { h: 'G_a PLY (k/in)', num: true },
    ], nails.map(n => [n.id, n.sides === 2 ? 'Both' : '1', n.vn, n.asdE, n.asdW, n.lrfdE, n.lrfdW, n.gaOSB, n.gaPLY]));
    notes([
      cg !== 1 ? 'C_G = ' + cg + ' (species factor 1 − (0.5 − G), SDPWS Table 4.3A; entered in the reference file as V_n × C_G). G_a is not adjusted.' : 'DF/SP framing: C_G = 1.00.',
      'Capacities as entered: ASD E = V_n × ' + FOOTNOTE_10_FACTOR + ' / 2.8 · ASD W = V_n × ' + FOOTNOTE_10_FACTOR + ' / 2.0 · LRFD E = 0.5 × V_n × ' + FOOTNOTE_10_FACTOR + ' · LRFD W = 0.8 × V_n × ' + FOOTNOTE_10_FACTOR + ' (φ per SDPWS 2021 §4.1.4).',
      'Deflection uses the G_a ' + sheathingLabel(inputs.sheathing) + ' column (Summary tab).',
    ]);
  }

  // --- 2. HDUE holdowns: one table per wall width ---
  const hdueParts = ['4', '6'].map(t => [t, hdueTable(sp, t).filter(hd => pick(used && used.hdue[t], hd.id))]).filter(([, rows]) => rows.length);
  if (hdueParts.length) {
    head('HDUE Holdowns — Concrete Anchorage — ' + spLabel);
    source(HARDWARE_SOURCES.hdue, 'ASD cap for design; LRFD cap with δ @ LRFD cap for 1.0E / 1.0W deflection only');
    for (const [t, rows] of hdueParts) {
      sub(t + '" wall');
      table([
        { h: 'Model' }, { h: 'ASD cap (lb)', num: true }, { h: 'LRFD cap (lb)', num: true }, { h: 'δ @ LRFD cap (in)', num: true },
        { h: 'Min post' }, { h: 'δ @ ASD cap (in)', num: true },
      ], rows.map(hd => [hd.id, hd.cap, hd.lrfdCap, hd.deltaLrfd, hd.minPost[t], hd.deltaAsd]));
    }
    notes([
      'The line\'s wall width picks the table. ASD cap: design (ASD combinations). LRFD cap: the load at which δ @ LRFD cap applies — never a design check.',
      'Deflection (SDPWS Eq. 4.3-1, 1.0E / α_s·1.0W, lateral only): Δ_a = δ @ LRFD cap × T_{1.0} / LRFD cap (linear from the LRFD pair); warning sign when T_{1.0} > LRFD cap (extrapolated).',
      'δ @ ASD cap: catalog deflection, the input to δ @ LRFD cap in the reference file.',
    ]);
  }

  // --- 3. MSTC floor-to-floor straps ---
  const mstcParts = MSTC_SPANS.map(span => [span, mstcTable(sp, span).filter(s => pick(used && used.mstc[span], s.id))]).filter(([, rows]) => rows.length);
  if (mstcParts.length) {
    head('MSTC Floor-to-Floor Straps — ' + spLabel);
    source(HARDWARE_SOURCES.mstc, 'ASD cap for design; LRFD cap with δ @ LRFD cap (calculated in the reference file: steel + nail slip) for 1.0E / 1.0W deflection only');
    for (const [span, rows] of mstcParts) {
      sub(span + '" floor clear span');
      table([
        { h: 'Model' }, { h: 'ASD cap (lb)', num: true }, { h: 'LRFD cap (lb)', num: true }, { h: 'δ @ LRFD cap (in)', num: true },
        { h: 'Min post 4"' }, { h: 'Min post 6"' },
      ], rows.map(s => [s.id, s.cap, s.lrfdCap, s.deltaLrfd, s.minPost['4'], s.minPost['6']]));
    }
    notes([
      'ASD cap: design (ASD combinations). LRFD cap: the load at which δ @ LRFD cap applies — never a design check.',
      'Deflection (SDPWS Eq. 4.3-1, 1.0E / α_s·1.0W, lateral only): Δ_a = δ @ LRFD cap × T_{1.0} / LRFD cap (linear from the LRFD pair); warning sign when T_{1.0} > LRFD cap (extrapolated).',
      'Minimum post at every strap end: (2)2x (user rule 2026-09-30).',
    ]);
  }

  // --- 4. FTAO wall straps ---
  const ftaoRows = FTAO_STRAP_TABLE.flatMap(st => st.nails.filter(n => pick(used && used.ftao, st.id + '|' + n.d))
    .map(n => [st.id, st.gauge, st.lengthFt, n.d, n[sp][0], n[sp][1], st.cap]));
  if (ftaoRows.length) {
    head('FTAO Wall Straps (above / below openings) — ' + spLabel);
    source(HARDWARE_SOURCES.ftao, 'ASD allowable tension (the same for both framing groups); fasteners and end length per framing group');
    table([
      { h: 'Model' }, { h: 'Gauge', num: true }, { h: 'Length (ft)', num: true }, { h: 'Nail' },
      { h: 'Fasteners (total)', num: true }, { h: 'End length (in)', num: true }, { h: 'ASD cap (lb)', num: true },
    ], ftaoRows);
    notes([
      'The lightest strap with ASD cap ≥ F_max is selected; straps run the full wall length above and below the openings. Nailing shown in results: the 0.148" row.',
    ]);
  }

  // --- 5. WSWH ---
  const wswhTables = WSWH_TABLES.map(([id, title, rows, withP]) => [title, used ? rows.filter(r => used.wswh[id] && used.wswh[id].has(r)) : rows, withP])
    .filter(([, rows]) => rows.length);
  if (wswhTables.length) {
    head('Simpson Strong-Wall WSWH Panels');
    source(HARDWARE_SOURCES.wswh, 'Simpson panel — independent of the framing group; V and T for design, Δ for 1.0E / 1.0W deflection');
    const cols = (withP) => [
      { h: 'Model' }, { h: 'Nominal ht (ft)', num: true }, { h: 'H_e (in)', num: true },
      ...(withP ? [{ h: 'P (lb)', num: true }, { h: "f'c (psi)", num: true }] : []),
      { h: 'V_ASD (lb)', num: true }, { h: 'Δ_ASD (in)', num: true }, { h: 'T_ASD (lb)', num: true },
      { h: 'V_LRFD (lb)', num: true }, { h: 'Δ_LRFD (in)', num: true }, { h: 'T_LRFD (lb)', num: true },
    ];
    const row = (r, withP, lt) => [r.model, r.nominal_ft, r.He_in, ...(withP ? [r.P_lb, r.fc_psi] : []),
      r['V_ASDcap_' + lt], r['Delta_ASDcap_' + lt], r['T_ASDcap_' + lt], r['V_LRFDcap_' + lt], r['Delta_LRFDcap_' + lt], r['T_LRFDcap_' + lt]];
    if (used) {
      const lts = inputs.loadType === 'both' ? ['S', 'W'] : inputs.loadType === 'wind' ? ['W'] : ['S'];
      for (const [title, rows, withP] of wswhTables) for (const lt of lts) {
        sub(title + ' — ' + (lt === 'S' ? 'Seismic' : 'Wind'));
        table(cols(withP), rows.map(r => row(r, withP, lt)));
      }
    } else {
      const lt = view.wswhLoad || 'S';
      B.push({ k: 'wswhToggle', value: lt });
      for (const [title, rows, withP] of wswhTables) {
        B.push({ k: 'details', summary: title + ' — ' + rows.length + ' rows', blocks: [{ k: 'table', cols: cols(withP), rows: rows.map(r => row(r, withP, lt)) }] });
      }
    }
    notes([
      used ? 'Rows: the tabulated heights around each panel\'s floor-to-floor height (interpolated between them)' + (wswhTables.some(t => t[2]) ? ', every tabulated P at the project f\'c table' : '') + '.' : null,
      'V_ASD / T_ASD: design. Drift (1.0E / α_s·W): Δ = Δ_LRFD × V_{1.0} / V_LRFD — linear from the LRFD cap with its drift; stacked base Δ_1 = Δ_{0,LRFD} × M_d / M_{allow,LRFD}; the same line δ(V) is used in the deflection distribution; warning sign when V_{1.0} > V_LRFD (user 2026-10-13). Same rule as the holdowns / straps: linear from the LRFD pair at the 1.0 level.',
      'V_LRFD / Δ_LRFD / T_LRFD are derived in the reference tables (seismic ASD / 0.7, wind ASD / 0.6), not Simpson-published (no public LRFD data; the user keeps the derived values).',
    ]);
  }

  // --- 6. Wood grades of the species in the group (PDF: the project grades only) ---
  head('Wood Grades — ' + (used ? wood.speciesLabel : spLabel));
  source(HARDWARE_SOURCES.wood, 'Reference design values (before adjustment factors) for post design, sill plate crushing and post bearing');
  const gradeCols = [{ h: 'Grade' }, { h: 'F_c (psi)', num: true }, { h: 'F_c⊥ (psi)', num: true }, { h: 'E (psi)', num: true }, { h: 'E_min (psi)', num: true }, { h: 'G', num: true }];
  const gradeRow = (g, v) => ({ cells: [g.grade, v.Fc, v.Fcperp, v.E, v.Emin, v.G], active: g.id === wood.dim.id || g.id === wood.pt.id });
  const inProject = (g) => !used || g.id === wood.dim.id || (used.pt && g.id === wood.pt.id);
  for (const s of SPECIES.filter(x => x.group === sp && (!used || x.id === wood.species))) {
    for (const tbl of ['4A', '4B', '4D']) {
      const list = NDS_GRADES.filter(g => g.species === s.id && g.table === tbl && inProject(g));
      if (!list.length) continue;
      const kind = tbl === '4D' ? 'posts & timbers (5"x5" and larger)' : 'dimension lumber (2"–4" thick)';
      if (tbl === '4B') {
        for (const [cls, name] of [['2-4', '2"–4" wide'], ['5-6', '5"–6" wide']]) {
          sub(s.id + ' — NDS Table 4B, ' + kind + ', ' + name);
          table(gradeCols, list.filter(g => g.widths && g.widths[cls]).map(g => gradeRow(g, g.widths[cls])));
        }
      } else {
        sub(s.id + ' — NDS Table ' + tbl + ', ' + kind);
        table(gradeCols, list.map(g => gradeRow(g, g)));
      }
    }
  }
  notes([
    used ? 'The project grades (Summary tab).' : 'Highlighted: the project grades (Summary tab).',
    'Studs, sill plates and 2x / 4x posts use the dimension-lumber grade (Table 4A, or 4B for SP by member width); 6x6 and 8x6 posts use the posts & timbers grade (Table 4D).',
    'Sill plate crushing (deflection) and post bearing use the sill plate F_c⊥ (Table 4A / 4B).',
  ]);

  // --- 7. Post sizes (C_F per the project species) ---
  const postList = Object.entries(POST_SIZES).flatMap(([t, posts]) => posts.filter(p => !used || Object.values(used.posts[t] || {}).some(s => s.has(p.id))).map(p => [t, p]));
  if (postList.length) {
    head('Post Sizes — ' + wood.speciesLabel);
    table([
      { h: 'Post' }, { h: 'Wall' }, { h: 'd_1 (in)', num: true }, { h: 'd_2 (in)', num: true }, { h: 'A (in²)', num: true },
      { h: 'NDS table' }, { h: 'Grade' }, { h: 'C_F', num: true, calc: true },
    ], postList.map(([t, p]) => {
      const m = memberProps(wood, p);
      return [p.label, t + '"', p.d1, p.d2, p.area, m ? m.table : 'not available', m ? m.gradeLabel : null, m ? m.CF.toFixed(2) : null];
    }));
    notes([
      'd_1 = across the wall (wall thickness), d_2 = along the wall. 5"x5" and larger (6x6, 8x6) = posts & timbers, NDS Table 4D.',
      'ƒ C_F (F_c size factor): Table 4A by nominal width — 2"–4" 1.15, 5"–6" 1.10, 8" 1.05; Table 4B (SP) and 4D: 1.0 (values already by size). SP 8" wide is not entered → 8x4 not available for SP.',
    ]);
  }

  // --- 8. Post compression capacity (project wood) ---
  // Tab: project wall thickness plus any line override, every post at every level height (the calc sheets
  // reference these tables). PDF: the posts used, at the heights they are used.
  let capParts;
  if (used) {
    capParts = Object.keys(used.posts).sort().map(t => [t, Object.keys(used.posts[t]).map(Number).sort((a, b) => a - b)
      .map(h => [h, POST_SIZES[t].filter(p => used.posts[t][h].has(p.id))])]);
  } else {
    const thicknesses = [...new Set([inputs.wallThickness || '4', ...inputs.directions.flatMap(d => d.lines.map(l => l.wallThickness).filter(Boolean))])];
    const heights = [...new Set(inputs.levels.map(l => parseFloat(l.floorToFloor) || 0).filter(h => h > 0))];
    if (heights.length === 0) heights.push(10);
    capParts = thicknesses.map(t => [t, heights.map(h => [h, POST_SIZES[t] || POST_SIZES['4']])]);
  }
  for (const [thickness, byHeight] of capParts) {
    head('Post Compression Capacity — ' + wood.speciesLabel + ', ' + thickness + '" Wall');
    for (const [h, posts] of byHeight) {
      sub('Floor Height: ' + h + ' ft');
      table([
        { h: 'Post' }, { h: 'Grade' }, { h: 'F_c (psi)', num: true }, { h: 'C_F', num: true }, { h: 'l_e/d', num: true, calc: true }, { h: 'F_cE (psi)', num: true, calc: true },
        { h: 'F_c* (psi)', num: true, calc: true }, { h: 'C_P', num: true, calc: true }, { h: "F_c' (psi)", num: true, calc: true }, { h: "F_c⊥' (psi)", num: true, calc: true },
        { h: 'Governs' }, { h: 'Capacity (k)', num: true, calc: true },
      ], posts.map(p => {
        const r = computePostCapacity(p, wood, h);
        if (!r) return [p.label, 'not available for ' + wood.species, null, null, null, null, null, null, null, null, null, null];
        return [p.label, r.gradeLabel + ' (' + r.table + ')', r.Fc, r.CF.toFixed(2), r.ratio1, r.FcE, r.FcStar, r.Cp, r.FcPrime, r.FcPerpPrime, r.governedBy === 'axial' ? 'Axial' : 'Bearing', r.capacityKips];
      }));
    }
  }
  if (capParts.length) notes([
    'ƒ F_c* = F_c × C_D × C_F · ƒ F_cE = 0.822 × E_min′ / (l_e/d)², the smaller of both axes · ƒ C_P from F_cE / F_c* with c = 0.8 · ƒ F_c′ = F_c* × C_P.',
    'ƒ F_c⊥′ = sill plate F_c⊥ (Table 4A / 4B) × C_b, C_b = (d_2 + 0.375) / d_2 · ƒ Capacity = min(F_c′, F_c⊥′) × A. ' + (used ? 'Heights: the floor heights where each post is used.' : 'Heights from the project levels.'),
  ]);

  // --- 9. Assumptions ---
  head('Assumptions');
  notes([
    'C_D = 1.6 (seismic / wind) · C_M = C_t = C_i = 1.0 · K_e = 1.0 · l_2 = 6" (post braced by the sheathing) · c = 0.8 (sawn lumber) — NDS 2018 §3.7.',
    'Holdown ends: post never smaller than the HDUE minimum post of the wall width. Strap ends: at least (2)2x.',
    'Design is ASD (load combinations, Summary tab). LRFD caps only pair with their deflection δ; they are never a design check.',
  ]);
  return B;
}

// === Screen ===
// Source block: Source (document, edition, page) · Entered · File · Basis
function sourceBlock(src, basis) {
  const missing = (label) => el('span', { style: missingStyle }, label + ' not entered');
  return el('div', { style: { ...noteStyle, marginBottom: '0.5rem', paddingLeft: '0.5rem', borderLeft: '3px solid var(--border)' } },
    el('div', null, el('strong', null, 'Source: '), src.doc || missing('document'), ', ', src.edition || missing('edition'), ', ', src.page || missing('page / table')),
    src.entered ? el('div', null, el('strong', null, 'Entered: '), src.entered) : null,
    el('div', null, el('strong', null, 'File: '), el('span', { className: 'mono' }, REF_DIR + src.file)),
    basis ? el('div', null, el('strong', null, 'Basis: '), basis) : null);
}

// cols: [{ h, num, calc }]; rows: arrays (null / '' → "—"), or { cells, active }
function hwTable(cols, rows) {
  const tbl = el('table', { className: 'data-table', style: { fontSize: '0.85rem' } });
  tbl.appendChild(el('tr', null, ...cols.map(c => el('th', { className: c.num ? 'num' : null }, c.calc ? 'ƒ ' : null, rich(c.h, true)))));
  for (const r of rows) {
    const cells = Array.isArray(r) ? r : r.cells;
    tbl.appendChild(el('tr', { style: r.active ? { background: 'var(--accent-bg)' } : null }, ...cells.map((v, i) => {
      const c = cols[i] || {};
      const blank = v == null || v === '';
      return el('td', { className: (c.num ? 'num ' : '') + 'mono', style: blank ? missingStyle : null }, blank ? MISSING : rich(String(v)));
    })));
  }
  return el('div', { className: 'table-scroll', style: { marginBottom: '0.25rem' } }, tbl);
}

function notesEl(lines) {
  return el('div', { style: { ...noteStyle, marginBottom: '1rem' } }, ...lines.map(t => el('div', null, rich(t, true))));
}

function toggle(options, value, onPick) {
  return el('div', { style: { display: 'flex', gap: '2px' } }, ...options.map(o => el('button', {
    className: 'btn btn-sm' + (o.id === value ? ' btn-primary' : ''), type: 'button', onClick() { onPick(o.id); },
  }, o.label)));
}

// view: { species (group id), wswhLoad } (UI state, not saved); onView(): re-render after a toggle
export function renderHardwareTab(inputs, view, onView) {
  const wood = woodBasis(inputs);
  const sp = view.species || wood.group;
  const sec = el('div');

  // --- Framing group toggle + project basis ---
  sec.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' } },
    el('strong', null, 'Framing group:'),
    toggle(SPECIES_GROUPS, sp, (id) => { view.species = id; onView(); }),
    el('span', { style: noteStyle }, 'Project: ' + wood.speciesLabel + ' → ' + groupLabel(wood.group) + ' tables; ' + wood.dim.label + ' (NDS ' + wood.dim.table + '), ' + wood.pt.label + ' (NDS 4D) — Summary tab')));
  sec.appendChild(notesEl([
    sp !== wood.group ? 'Showing the ' + groupLabel(sp) + ' tables; this project designs with ' + groupLabel(wood.group) + '.' : null,
    'ƒ = calculated by the tool (formula under the table). Every other value is read from the reference file named above the table.',
  ].filter(Boolean)));

  const draw = (b, into) => {
    if (b.k === 'head') into.appendChild(el('div', { className: 'section-header', style: { marginTop: '0.5rem' } }, b.text));
    else if (b.k === 'source') into.appendChild(sourceBlock(b.src, b.basis));
    else if (b.k === 'sub') into.appendChild(el('div', { style: { fontWeight: '500', fontSize: '0.85rem', margin: '0.5rem 0 0.25rem' } }, b.text));
    else if (b.k === 'table') into.appendChild(hwTable(b.cols, b.rows));
    else if (b.k === 'notes') into.appendChild(notesEl(b.lines));
    else if (b.k === 'wswhToggle') {
      into.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' } },
        el('strong', { style: { fontSize: '0.85rem' } }, 'Load:'),
        toggle([{ id: 'S', label: 'Seismic' }, { id: 'W', label: 'Wind' }], b.value, (id) => { view.wswhLoad = id; onView(); })));
    } else if (b.k === 'details') {
      const det = el('details', { style: { marginBottom: '0.5rem' } }, el('summary', { style: { cursor: 'pointer', fontSize: '0.85rem' } }, b.summary));
      b.blocks.forEach(x => draw(x, det));
      into.appendChild(det);
    }
  };
  hardwareBlocks(inputs, view, null).forEach(b => draw(b, sec));
  return sec;
}

// === PDF "Design data" appendix (Detailed report) ===
// The hardware used by the design, on the project's framing group: heading + source rows, tables (heading — sub-heading
// as the title), notes as text. Blank values print "—"; ƒ marks the calculated columns.
export function hardwareAppendixSections(inputs, outputs) {
  const used = hardwareUsed(inputs, outputs);
  const wood = woodBasis(inputs);
  const out = [{ heading: 'Appendix — Design data', title: 'Hardware and material data used in this design', pageBreakBefore: true,
    text: 'Only the hardware this design uses (nailing, holdowns, straps, posts, Strong-Wall panels), from the ' + groupLabel(wood.group)
      + ' tables (' + wood.speciesLabel + '). Each table names its source; ƒ = calculated by the tool (formula in the notes); — = not entered. The full catalogs are on the Hardware tab.' }];
  let head = '', sub = '';
  const title = () => head + (sub ? ' — ' + sub : '');
  for (const b of hardwareBlocks(inputs, {}, used)) {
    if (b.k === 'head') { head = b.text; sub = ''; continue; }
    if (b.k === 'sub') { sub = b.text; continue; }
    if (b.k === 'source') {
      const s = b.src;
      out.push({ title: head + ' — source', rows: [
        ['Source', [s.doc, s.edition, s.page].map(x => x || MISSING).join(', ')],
        ...(s.entered ? [['Entered', s.entered]] : []),
        ['File', REF_DIR + s.file],
        ...(b.basis ? [['Basis', b.basis]] : []),
      ] });
      continue;
    }
    if (b.k === 'table') {
      out.push({ title: title(), table: { headers: b.cols.map(c => (c.calc ? 'ƒ ' : '') + c.h),
        rows: b.rows.map(r => (Array.isArray(r) ? r : r.cells).map(v => (v == null || v === '' ? MISSING : String(v)))) } });
      continue;
    }
    if (b.k === 'notes' && b.lines.length) out.push({ title: head + ' — notes', text: b.lines.join('\n') });
  }
  return out;
}
