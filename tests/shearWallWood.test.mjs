// Shear Wall wood species and hardware data (2026-10-13): tables generated from the reference .md files, species
// (DF/SP vs SPF/HF hardware tables), NDS Table 4A / 4B / 4D post design, sill F_c⊥, δ @ LRFD cap, schema 13.
// Run: node tests/shearWallWood.test.mjs
import fs from 'fs';
import assert from 'assert/strict';
import { execFileSync } from 'child_process';
import { checkShearWallItem } from '../scripts/lib/shearWallLoadCheck.mjs'; // sets up the stand-in DOM
import { calcAll } from '../src/modules/shearWallCalc.js';
import { shearWallDesign, migrateDefinition, migrateV12toV13 } from '../src/modules/shearWallDesign.js';
import { woodBasis, memberProps, sillProps, computePostCapacity, postSizeById, hdueTable, mstcTable, autoSelectHoldown,
  autoSelectStrap, anchorageSlip, overLrfdCap, dimGrades, ptGrades } from '../src/modules/shearWallHardware.js';
import { nailingTable, getNailingById } from '../src/modules/shearWallNailing.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' expected ' + b + ' ± ' + tol + ', got ' + a);
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message)); process.exitCode = 1; }
}

const W = (id, pos, len, more = {}) => ({ id, mark: 'SW-' + id.split('-')[1], levelId: 'lvl-1', position: pos, length: len, wallDLTypeId: '', nailingPattern: '',
  anchorageLeftOverride: '', anchorageRightOverride: '', postLeftOverride: '', postRightOverride: '', openings: [], method: 'segmented',
  narrowPier: false, ftaoStrapOverride: '', jambPostOverride: '', systemType: 'sheathed', ...more });
const oneStory = (walls, { seismic = 6, thickness = '4', wood = {}, extra = {} } = {}) => ({
  sds: '1.0', loadType: 'seismic', wallThickness: thickness, species: 'DF-L', woodGrade: 'dfir_no1', postGrade: 'dfir_pt_no1', ...wood,
  wallDLTypes: [], sheathing: 'ply', cd: '4', ie: '1', riskCategory: 'II', driftRow: 'other', alphaS: '', refs: {},
  levels: [{ id: 'lvl-1', name: 'L1', floorToFloor: 10, floorClearSpan: '16', anchorageType: 'auto' }],
  directions: [{ id: 'dir-1', name: 'N-S', rho: 1, lines: [{ id: 'ln-1', name: 'A', totalLength: 40, wallThickness: '', levelLoads: { 'lvl-1': { seismic: String(seismic) } },
    walls, beams: [], supportPosts: [], gravityLoads: {} }] }],
  ...extra,
});
const wallsOf = (out) => out.perDirection[0].perLine[0].perLevel.flatMap(p => p.walls);
const REF = 'G:/Shared drives/Structural Engineering Standards/ENG CALC TOOLDEV/Calculation Library/Design Software/Design Item Hub/Shearwall design reference';

test('Hardware data = the reference .md files (npm run hardware:build --check; skipped when the Shared Drive is not mounted)', () => {
  if (!fs.existsSync(REF)) { console.log('       (Shared Drive not found — skipped)'); return; }
  execFileSync(process.execPath, ['scripts/buildHardwareData.mjs', REF, '--check'], { stdio: 'pipe' });
});

test('Schema 13: v12 items become DF-L with the matching posts & timbers grade; idempotent; the frozen TC-1 still opens', () => {
  const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/legacy/schema12-tc1.json', import.meta.url), 'utf8'));
  const item = migrateDefinition({ schemaVersion: 12, inputs: fx.inputs });
  assert.equal(item.schemaVersion, 13);
  assert.equal(item.inputs.species, 'DF-L'); assert.equal(item.inputs.woodGrade, 'dfir_no1'); assert.equal(item.inputs.postGrade, 'dfir_pt_no1');
  const again = migrateV12toV13(JSON.parse(JSON.stringify(item.inputs)));
  assert.deepEqual(again, item.inputs);
  for (const [dim, pt] of [['dfir_ss', 'dfir_pt_ss'], ['dfir_no1btr', 'dfir_pt_no1'], ['dfir_no2', 'dfir_pt_no2'], ['dfir_no3', 'dfir_pt_no2']])
    assert.equal(migrateV12toV13({ woodGrade: dim }).postGrade, pt, dim);
  const rep = checkShearWallItem({ type: 'shear_wall_design', schemaVersion: 12, inputs: fx.inputs });
  assert.ok(rep.ok, rep.error);
});

test('Species picks the hardware tables: SPF/HF nailing (V_n × C_G), HDUE and MSTC capacities', () => {
  const df = wallsOf(calcAll(oneStory([W('w-1', 0, 8, { nailingPattern: '4' })])))[0];
  const spf = wallsOf(calcAll(oneStory([W('w-1', 0, 8, { nailingPattern: '4' })], { wood: { species: 'SPF', woodGrade: 'spf_no1no2', postGrade: 'spf_pt_no1' } })))[0];
  assert.equal(df.seismicCap, 470); assert.equal(spf.seismicCap, 432);
  assert.equal(df.woodGroup, 'dfsp'); assert.equal(spf.woodGroup, 'spfhf');
  assert.equal(spf.anchorageLeft.group, 'spfhf');
  assert.equal(getNailingById('2', 'spfhf').asdW, 1030);
  assert.equal(autoSelectHoldown(4.0, 'dfsp', '4').id, 'HDUE5'); assert.equal(autoSelectHoldown(4.0, 'spfhf', '4').id, 'HDUE5');
  assert.equal(autoSelectHoldown(4.8, 'spfhf', '4').id, 'HDUE7'); // SPF/HF HDUE5 = 4,700 lb
  assert.equal(autoSelectStrap(2.4, '18', 'spfhf').id, 'MSTC52'); // SPF/HF MSTC40 18" = 2,325 lb
  assert.equal(nailingTable('spfhf').length, 7);
  // HF uses the SPF/HF tables too
  assert.equal(woodBasis({ species: 'HF', woodGrade: 'hf_no2' }).group, 'spfhf');
  assert.equal(woodBasis({ species: 'SP' }).group, 'dfsp');
});

test('HDUE table by wall width: a 6" line uses the 6" capacities and minimum posts', () => {
  assert.equal(hdueTable('dfsp', '6').find(h => h.id === 'HDUE13').cap, 13110);
  assert.equal(hdueTable('dfsp', '4').find(h => h.id === 'HDUE13').cap, 12950);
  const w6 = wallsOf(calcAll(oneStory([W('w-1', 0, 4)], { seismic: 9, thickness: '6' })))[0];
  assert.ok(w6.anchorageLeft.minPost['6'], 'picked from the 6" table');
  const min6 = hdueTable('dfsp', '6').find(h => h.id === 'HDUE9').minPost['6'];
  assert.equal(min6, '6x6');
});

test('Posts: NDS Table 4A with C_F by width, 4B (SP) by width class with C_F = 1.0, 4D for 6x6 / 8x6; SP 8x4 not available', () => {
  const df = woodBasis({ species: 'DF-L', woodGrade: 'dfir_no1', postGrade: 'dfir_pt_no1' });
  const m = (id, wood = df) => memberProps(wood, postSizeById(id));
  assert.deepEqual([m('(2)2x4').CF, m('6x4').CF, m('8x4').CF, m('4x6').CF], [1.15, 1.1, 1.05, 1.1]);
  assert.deepEqual([m('6x6').table, m('6x6').Fc, m('6x6').CF, m('6x6').E], ['4D', 1000, 1.0, 1600000]);
  assert.deepEqual([m('4x4').table, m('4x4').Fc], ['4A', 1500]);
  const sp = woodBasis({ species: 'SP', woodGrade: 'sp_no2', postGrade: 'sp_pt_no2' });
  assert.deepEqual([m('4x4', sp).Fc, m('4x4', sp).CF, m('6x4', sp).Fc, m('(2)2x6', sp).Fc], [1450, 1.0, 1400, 1400]);
  assert.equal(m('8x4', sp), null);
  assert.equal(computePostCapacity(postSizeById('8x4'), sp, 10), null);
  // 6x6 DF-L No.1 P&T: F_c* = 1000 × 1.6 × 1.0
  const r = computePostCapacity(postSizeById('6x6'), df, 10);
  assert.equal(r.FcStar, 1600); assert.equal(r.table, '4D');
});

test('Sill plate F_c⊥ is the dimension grade (Table 4A / 4B): crushing in Eq. 4.3-1 and post bearing — also under a 4D post', () => {
  const spf = woodBasis({ species: 'SPF', woodGrade: 'spf_no1no2' });
  assert.equal(sillProps(spf, '4').Fcperp, 425);
  const sp = woodBasis({ species: 'SP', woodGrade: 'sp_no1', postGrade: 'sp_pt_no1' });
  assert.equal(sillProps(sp, '6').Fcperp, 565);
  // SP 6x6 P&T F_c⊥ = 375, but it bears on the SP No.1 sill (565): F_c⊥' = 565 × C_b
  const r = computePostCapacity(postSizeById('6x6'), sp, 10);
  near(r.FcPerpPrime, 565 * (5.5 + 0.375) / 5.5, 1, 'bearing on the sill');
  assert.equal(r.sillFcperp, 565);
  const w = wallsOf(calcAll(oneStory([W('w-1', 0, 8)], { wood: { species: 'SPF', woodGrade: 'spf_no1no2', postGrade: 'spf_pt_no1' } })))[0];
  assert.equal(w.deflection.E.Fcperp, 425);
});

test('Deflection: Δa = δ_LRFD × T / T_LRFD (lateral T); chord E of the end post; warning when T₁.₀ > LRFD cap', () => {
  const w = wallsOf(calcAll(oneStory([W('w-1', 0, 8)])))[0];
  const d = w.deflection.E;
  const hd = hdueTable('dfsp', '4').find(h => h.id === w.anchorageLeft.id);
  near(d.dirs[0].T, 6 * 10 / 8 * 1000, 1, 'lateral-only T = V·h/L'); // no gravity in the drift (user 2026-10-14)
  near(d.dirs[0].dHD, hd.deltaLrfd * d.dirs[0].T / hd.lrfdCap, 1e-4);
  near(d.dirs[0].dHD, anchorageSlip(w.anchorageLeft) * d.dirs[0].T / w.anchorageLeft.lrfdCap, 1e-4);
  assert.equal(d.E, memberProps(woodBasis({}), postSizeById(w.postLeft.postId)).E);
  assert.equal(overLrfdCap({ lrfdCap: 5306 }, 5306), false); assert.equal(overLrfdCap({ lrfdCap: 5306 }, 5400), true);
  // HDUE5 (ASD 5,375 / LRFD 7,525 lb): ASD T = 0.7 × 7.625 = 5.34 k OK, but the drift case T = 7,625 lb > LRFD cap
  // → warning only (never NG)
  const hd5 = { anchorageLeftOverride: 'HDUE5', anchorageRightOverride: 'HDUE5' };
  const ln = calcAll(oneStory([W('w-1', 0, 8, hd5)], { seismic: 6.1 })).perDirection[0].perLine[0];
  assert.ok(ln.deflWarnings.some(x => /T = 7625 lb > LRFD cap 7525 lb of HDUE5/.test(x.message)), JSON.stringify(ln.deflWarnings));
  assert.ok(!ln.checks.some(c => c.status === 'fail'), 'never NG');
});

test('Summary tab: Species / dimension grade / posts & timbers grade; a new species takes its default grades', () => {
  const inp = oneStory([W('w-1', 0, 8)]);
  const c = document.createElement('div');
  shearWallDesign.renderForm(c, inp, () => {}, [], () => {});
  const sels = [...c.querySelectorAll('select')];
  const species = sels.find(s => [...s.options].some(o => o.value === 'SPF'));
  assert.ok(species, 'species select');
  assert.ok(sels.some(s => [...s.options].some(o => o.value === 'dfir_pt_no1')), 'P&T grade select');
  Object.defineProperty(species, 'value', { value: 'SPF', configurable: true }); // the stand-in DOM has no select.value setter
  species.dispatchEvent(new window.Event('change'));
  assert.deepEqual([inp.species, inp.woodGrade, inp.postGrade], ['SPF', 'spf_no1no2', 'spf_pt_no1']);
  assert.deepEqual(dimGrades('HF').map(g => g.grade), ['Select Structural', 'No.1 & Btr', 'No.1', 'No.2', 'No.3']);
  assert.equal(ptGrades('SP').length, 6);
  assert.ok(mstcTable('spfhf', '24').every(s => s.lrfdCap > s.cap));
});

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
