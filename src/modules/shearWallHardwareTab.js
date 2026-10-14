// Hardware tab of the Shear Wall form: every table the design uses, with where it comes from.
// Layout (user 2026-10-13): source block above each table (document, edition / page, entered by, Shared Drive file,
// basis); a DF/SP | SPF/HF toggle shows one framing group at a time (default = the project species' group);
// calculated columns are marked ƒ with the formula in the notes; values not entered show "—".
// Data: generated from the reference .md files (shearWallHardwareData.js, npm run hardware:build).
import { el } from '../utils.js';
import { rich } from '../richText.js';
import { nailingTable, nailingCG, FOOTNOTE_10_FACTOR, sheathingLabel } from './shearWallNailing.js';
import { NDS_GRADES, POST_SIZES, FTAO_STRAP_TABLE, SPECIES_GROUPS, SPECIES, HARDWARE_SOURCES, MSTC_SPANS,
  computePostCapacity, woodBasis, hdueTable, mstcTable, memberProps, cfTable4A, groupLabel } from './shearWallHardware.js';
import { WSWH_T01, WSWH_T02, WSWH_T03 } from './shearWallWswhData.js';

const MISSING = '—';
const REF_DIR = 'Shearwall design reference/';
const noteStyle = { fontSize: '0.8rem', color: 'var(--ink-secondary)', lineHeight: '1.6' };
const missingStyle = { color: 'var(--ink-tertiary)', fontStyle: 'italic' };

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

function notes(lines) {
  return el('div', { style: { ...noteStyle, marginBottom: '1rem' } }, ...lines.filter(Boolean).map(t => el('div', null, rich(t, true))));
}

const header = (t) => el('div', { className: 'section-header', style: { marginTop: '0.5rem' } }, t);
const subHeader = (t) => el('div', { style: { fontWeight: '500', fontSize: '0.85rem', margin: '0.5rem 0 0.25rem' } }, t);

function toggle(options, value, onPick) {
  return el('div', { style: { display: 'flex', gap: '2px' } }, ...options.map(o => el('button', {
    className: 'btn btn-sm' + (o.id === value ? ' btn-primary' : ''), type: 'button', onClick() { onPick(o.id); },
  }, o.label)));
}

// view: { species (group id), wswhLoad } (UI state, not saved); onView(): re-render after a toggle
export function renderHardwareTab(inputs, view, onView) {
  const wood = woodBasis(inputs);
  const sp = view.species || wood.group;
  const spLabel = groupLabel(sp);
  const sec = el('div');

  // --- Framing group toggle + project basis ---
  sec.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' } },
    el('strong', null, 'Framing group:'),
    toggle(SPECIES_GROUPS, sp, (id) => { view.species = id; onView(); }),
    el('span', { style: noteStyle }, 'Project: ' + wood.speciesLabel + ' → ' + groupLabel(wood.group) + ' tables; ' + wood.dim.label + ' (NDS ' + wood.dim.table + '), ' + wood.pt.label + ' (NDS 4D) — Summary tab')));
  sec.appendChild(notes([
    sp !== wood.group ? 'Showing the ' + spLabel + ' tables; this project designs with ' + groupLabel(wood.group) + '.' : null,
    'ƒ = calculated by the tool (formula under the table). Every other value is read from the reference file named above the table.',
  ]));

  // --- 1. Nailing ---
  const cg = nailingCG(sp);
  sec.appendChild(header('Shear Wall Nailing Capacity — SDPWS Table 4.3A — ' + spLabel));
  sec.appendChild(sourceBlock(HARDWARE_SOURCES.nailing, '15/32" WSP Structural 1, 10d common nails; capacities include the ' + FOOTNOTE_10_FACTOR + ' factor of SDPWS Table 4.3A footnote 10'));
  sec.appendChild(hwTable([
    { h: 'E.N.' }, { h: 'Sides' }, { h: cg !== 1 ? 'V_n × C_G (plf)' : 'V_n (plf)', num: true },
    { h: 'ASD E (plf)', num: true }, { h: 'ASD W (plf)', num: true }, { h: 'LRFD E (plf)', num: true }, { h: 'LRFD W (plf)', num: true },
    { h: 'G_a OSB (k/in)', num: true }, { h: 'G_a PLY (k/in)', num: true },
  ], nailingTable(sp).map(n => [n.id, n.sides === 2 ? 'Both' : '1', n.vn, n.asdE, n.asdW, n.lrfdE, n.lrfdW, n.gaOSB, n.gaPLY])));
  sec.appendChild(notes([
    cg !== 1 ? 'C_G = ' + cg + ' (species factor 1 − (0.5 − G), SDPWS Table 4.3A; entered in the reference file as V_n × C_G). G_a is not adjusted.' : 'DF/SP framing: C_G = 1.00.',
    'Capacities as entered: ASD E = V_n × ' + FOOTNOTE_10_FACTOR + ' / 2.8 · ASD W = V_n × ' + FOOTNOTE_10_FACTOR + ' / 2.0 · LRFD E = 0.5 × V_n × ' + FOOTNOTE_10_FACTOR + ' · LRFD W = 0.8 × V_n × ' + FOOTNOTE_10_FACTOR + ' (φ per SDPWS 2021 §4.1.4).',
    'Deflection uses the G_a ' + sheathingLabel(inputs.sheathing) + ' column (Summary tab).',
  ]));

  // --- 2. HDUE holdowns: one table per wall width ---
  sec.appendChild(header('HDUE Holdowns — Concrete Anchorage — ' + spLabel));
  sec.appendChild(sourceBlock(HARDWARE_SOURCES.hdue, 'ASD cap for design; LRFD cap with δ @ LRFD cap for 1.0E / 1.0W deflection only'));
  for (const t of ['4', '6']) {
    sec.appendChild(subHeader(t + '" wall'));
    sec.appendChild(hwTable([
      { h: 'Model' }, { h: 'ASD cap (lb)', num: true }, { h: 'LRFD cap (lb)', num: true }, { h: 'δ @ LRFD cap (in)', num: true },
      { h: 'Min post' }, { h: 'δ @ ASD cap (in)', num: true },
    ], hdueTable(sp, t).map(hd => [hd.id, hd.cap, hd.lrfdCap, hd.deltaLrfd, hd.minPost[t], hd.deltaAsd])));
  }
  sec.appendChild(notes([
    'The line\'s wall width picks the table. ASD cap: design (ASD combinations). LRFD cap: the load at which δ @ LRFD cap applies — never a design check.',
    'Deflection (SDPWS Eq. 4.3-1, 1.0E / α_s·1.0W, lateral only): Δ_a = δ @ LRFD cap × T_{1.0} / LRFD cap (linear from the LRFD pair); warning sign when T_{1.0} > LRFD cap (extrapolated).',
    'δ @ ASD cap: catalog deflection, the input to δ @ LRFD cap in the reference file.',
  ]));

  // --- 3. MSTC floor-to-floor straps ---
  sec.appendChild(header('MSTC Floor-to-Floor Straps — ' + spLabel));
  sec.appendChild(sourceBlock(HARDWARE_SOURCES.mstc, 'ASD cap for design; LRFD cap with δ @ LRFD cap (calculated in the reference file: steel + nail slip) for 1.0E / 1.0W deflection only'));
  for (const span of MSTC_SPANS) {
    sec.appendChild(subHeader(span + '" floor clear span'));
    sec.appendChild(hwTable([
      { h: 'Model' }, { h: 'ASD cap (lb)', num: true }, { h: 'LRFD cap (lb)', num: true }, { h: 'δ @ LRFD cap (in)', num: true },
      { h: 'Min post 4"' }, { h: 'Min post 6"' },
    ], mstcTable(sp, span).map(s => [s.id, s.cap, s.lrfdCap, s.deltaLrfd, s.minPost['4'], s.minPost['6']])));
  }
  sec.appendChild(notes([
    'ASD cap: design (ASD combinations). LRFD cap: the load at which δ @ LRFD cap applies — never a design check.',
    'Deflection (SDPWS Eq. 4.3-1, 1.0E / α_s·1.0W, lateral only): Δ_a = δ @ LRFD cap × T_{1.0} / LRFD cap (linear from the LRFD pair); warning sign when T_{1.0} > LRFD cap (extrapolated).',
    'Minimum post at every strap end: (2)2x (user rule 2026-09-30).',
  ]));

  // --- 4. FTAO wall straps ---
  sec.appendChild(header('FTAO Wall Straps (above / below openings) — ' + spLabel));
  sec.appendChild(sourceBlock(HARDWARE_SOURCES.ftao, 'ASD allowable tension (the same for both framing groups); fasteners and end length per framing group'));
  sec.appendChild(hwTable([
    { h: 'Model' }, { h: 'Gauge', num: true }, { h: 'Length (ft)', num: true }, { h: 'Nail' },
    { h: 'Fasteners (total)', num: true }, { h: 'End length (in)', num: true }, { h: 'ASD cap (lb)', num: true },
  ], FTAO_STRAP_TABLE.flatMap(st => st.nails.map(n => [st.id, st.gauge, st.lengthFt, n.d, n[sp][0], n[sp][1], st.cap]))));
  sec.appendChild(notes([
    'The lightest strap with ASD cap ≥ F_max is selected; straps run the full wall length above and below the openings. Nailing shown in results: the 0.148" row.',
  ]));

  // --- 5. WSWH ---
  sec.appendChild(header('Simpson Strong-Wall WSWH Panels'));
  sec.appendChild(sourceBlock(HARDWARE_SOURCES.wswh, 'Simpson panel — independent of the framing group; V and T for design, Δ for 1.0E / 1.0W deflection'));
  const lt = view.wswhLoad || 'S';
  sec.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' } },
    el('strong', { style: { fontSize: '0.85rem' } }, 'Load:'),
    toggle([{ id: 'S', label: 'Seismic' }, { id: 'W', label: 'Wind' }], lt, (id) => { view.wswhLoad = id; onView(); })));
  const wswhCols = (withP) => [
    { h: 'Model' }, { h: 'Nominal ht (ft)', num: true }, { h: 'H_e (in)', num: true },
    ...(withP ? [{ h: 'P (lb)', num: true }, { h: "f'c (psi)", num: true }] : []),
    { h: 'V_ASD (lb)', num: true }, { h: 'Δ_ASD (in)', num: true }, { h: 'T_ASD (lb)', num: true },
    { h: 'V_LRFD (lb)', num: true }, { h: 'Δ_LRFD (in)', num: true }, { h: 'T_LRFD (lb)', num: true },
  ];
  const wswhRow = (r, withP) => [r.model, r.nominal_ft, r.He_in, ...(withP ? [r.P_lb, r.fc_psi] : []),
    r['V_ASDcap_' + lt], r['Delta_ASDcap_' + lt], r['T_ASDcap_' + lt], r['V_LRFDcap_' + lt], r['Delta_LRFDcap_' + lt], r['T_LRFDcap_' + lt]];
  for (const [title, rows, withP] of [
    ['Table 01 — standard & balloon framing on concrete (pp. 40–41)', WSWH_T01, true],
    ['Table 02 — first story on a raised wood floor (p. 47)', WSWH_T02, false],
    ['Table 03 — two-story stacked, second-story panel (p. 50; no T published)', WSWH_T03, false],
  ]) {
    const det = el('details', { style: { marginBottom: '0.5rem' } }, el('summary', { style: { cursor: 'pointer', fontSize: '0.85rem' } }, title + ' — ' + rows.length + ' rows'));
    det.appendChild(hwTable(wswhCols(withP), rows.map(r => wswhRow(r, withP))));
    sec.appendChild(det);
  }
  sec.appendChild(notes([
    'V_ASD / T_ASD: design. Drift (1.0E / α_s·W): Δ = Δ_LRFD × V_{1.0} / V_LRFD — linear from the LRFD cap with its drift; stacked base Δ_1 = Δ_{0,LRFD} × M_d / M_{allow,LRFD}; the same line δ(V) is used in the deflection distribution; warning sign when V_{1.0} > V_LRFD (user 2026-10-13). Same rule as the holdowns / straps: linear from the LRFD pair at the 1.0 level.',
    'V_LRFD / Δ_LRFD / T_LRFD are derived in the reference tables (seismic ASD / 0.7, wind ASD / 0.6), not Simpson-published (no public LRFD data; the user keeps the derived values).',
  ]));

  // --- 6. Wood grades of the species in the group ---
  sec.appendChild(header('Wood Grades — ' + spLabel));
  sec.appendChild(sourceBlock(HARDWARE_SOURCES.wood, 'Reference design values (before adjustment factors) for post design, sill plate crushing and post bearing'));
  const gradeCols = [{ h: 'Grade' }, { h: 'F_c (psi)', num: true }, { h: 'F_c⊥ (psi)', num: true }, { h: 'E (psi)', num: true }, { h: 'E_min (psi)', num: true }, { h: 'G', num: true }];
  const gradeRow = (g, v) => ({ cells: [g.grade, v.Fc, v.Fcperp, v.E, v.Emin, v.G], active: g.id === wood.dim.id || g.id === wood.pt.id });
  for (const s of SPECIES.filter(x => x.group === sp)) {
    for (const table of ['4A', '4B', '4D']) {
      const list = NDS_GRADES.filter(g => g.species === s.id && g.table === table);
      if (!list.length) continue;
      const kind = table === '4D' ? 'posts & timbers (5"x5" and larger)' : 'dimension lumber (2"–4" thick)';
      if (table === '4B') {
        for (const [cls, name] of [['2-4', '2"–4" wide'], ['5-6', '5"–6" wide']]) {
          sec.appendChild(subHeader(s.id + ' — NDS Table 4B, ' + kind + ', ' + name));
          sec.appendChild(hwTable(gradeCols, list.filter(g => g.widths && g.widths[cls]).map(g => gradeRow(g, g.widths[cls]))));
        }
      } else {
        sec.appendChild(subHeader(s.id + ' — NDS Table ' + table + ', ' + kind));
        sec.appendChild(hwTable(gradeCols, list.map(g => gradeRow(g, g))));
      }
    }
  }
  sec.appendChild(notes([
    'Highlighted: the project grades (Summary tab). Studs, sill plates and 2x / 4x posts use the dimension-lumber grade (Table 4A, or 4B for SP by member width); 6x6 and 8x6 posts use the posts & timbers grade (Table 4D).',
    'Sill plate crushing (deflection) and post bearing use the sill plate F_c⊥ (Table 4A / 4B).',
  ]));

  // --- 7. Post sizes (C_F per the project species) ---
  sec.appendChild(header('Post Sizes — ' + wood.speciesLabel));
  sec.appendChild(hwTable([
    { h: 'Post' }, { h: 'Wall' }, { h: 'd_1 (in)', num: true }, { h: 'd_2 (in)', num: true }, { h: 'A (in²)', num: true },
    { h: 'NDS table' }, { h: 'Grade' }, { h: 'C_F', num: true, calc: true },
  ], Object.entries(POST_SIZES).flatMap(([t, posts]) => posts.map(p => {
    const m = memberProps(wood, p);
    return [p.label, t + '"', p.d1, p.d2, p.area, m ? m.table : 'not available', m ? m.gradeLabel : null, m ? m.CF.toFixed(2) : null];
  }))));
  sec.appendChild(notes([
    'd_1 = across the wall (wall thickness), d_2 = along the wall. 5"x5" and larger (6x6, 8x6) = posts & timbers, NDS Table 4D.',
    'ƒ C_F (F_c size factor): Table 4A by nominal width — 2"–4" 1.15, 5"–6" 1.10, 8" 1.05; Table 4B (SP) and 4D: 1.0 (values already by size). SP 8" wide is not entered → 8x4 not available for SP.',
  ]));

  // --- 8. Post compression capacity (project wood) ---
  // project wall thickness plus any line override (the calc sheets reference these tables)
  const thicknesses = [...new Set([inputs.wallThickness || '4', ...inputs.directions.flatMap(d => d.lines.map(l => l.wallThickness).filter(Boolean))])];
  const heights = [...new Set(inputs.levels.map(l => parseFloat(l.floorToFloor) || 0).filter(h => h > 0))];
  if (heights.length === 0) heights.push(10);
  for (const thickness of thicknesses) {
    const posts = POST_SIZES[thickness] || POST_SIZES['4'];
    sec.appendChild(header('Post Compression Capacity — ' + wood.speciesLabel + ', ' + thickness + '" Wall'));
    for (const h of heights) {
      sec.appendChild(subHeader('Floor Height: ' + h + ' ft'));
      sec.appendChild(hwTable([
        { h: 'Post' }, { h: 'Grade' }, { h: 'F_c (psi)', num: true }, { h: 'C_F', num: true }, { h: 'l_e/d', num: true, calc: true }, { h: 'F_cE (psi)', num: true, calc: true },
        { h: 'F_c* (psi)', num: true, calc: true }, { h: 'C_P', num: true, calc: true }, { h: "F_c' (psi)", num: true, calc: true }, { h: "F_c⊥' (psi)", num: true, calc: true },
        { h: 'Governs' }, { h: 'Capacity (k)', num: true, calc: true },
      ], posts.map(p => {
        const r = computePostCapacity(p, wood, h);
        if (!r) return [p.label, 'not available for ' + wood.species, null, null, null, null, null, null, null, null, null, null];
        return [p.label, r.gradeLabel + ' (' + r.table + ')', r.Fc, r.CF.toFixed(2), r.ratio1, r.FcE, r.FcStar, r.Cp, r.FcPrime, r.FcPerpPrime, r.governedBy === 'axial' ? 'Axial' : 'Bearing', r.capacityKips];
      })));
    }
  }
  sec.appendChild(notes([
    'ƒ F_c* = F_c × C_D × C_F · ƒ F_cE = 0.822 × E_min′ / (l_e/d)², the smaller of both axes · ƒ C_P from F_cE / F_c* with c = 0.8 · ƒ F_c′ = F_c* × C_P.',
    'ƒ F_c⊥′ = sill plate F_c⊥ (Table 4A / 4B) × C_b, C_b = (d_2 + 0.375) / d_2 · ƒ Capacity = min(F_c′, F_c⊥′) × A. Heights from the project levels.',
  ]));

  // --- 9. Assumptions ---
  sec.appendChild(header('Assumptions'));
  sec.appendChild(notes([
    'C_D = 1.6 (seismic / wind) · C_M = C_t = C_i = 1.0 · K_e = 1.0 · l_2 = 6" (post braced by the sheathing) · c = 0.8 (sawn lumber) — NDS 2018 §3.7.',
    'Holdown ends: post never smaller than the HDUE minimum post of the wall width. Strap ends: at least (2)2x.',
    'Design is ASD (load combinations, Summary tab). LRFD caps only pair with their deflection δ; they are never a design check.',
  ]));

  return sec;
}
