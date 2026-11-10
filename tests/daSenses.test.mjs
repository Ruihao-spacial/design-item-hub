// Diaphragm Analysis — both senses, load combinations, zero member stretches (user 2026-11-10, td-v18):
// 1. every load case is analysed acting both ways by a full second run (option 1-B — not a sign flip): wind puts its
//    windward strip on the other face, so at an opening the reversed sense is not the entered one × −1;
// 2. Analysis tab: sense buttons, load combination dropdown (LRFD 1.0E / 1.0W, ASD 0.7E / 0.6W) on top of the force level;
// 3. Setup: the ρ note under the seismic force levels;
// 4. View 4 draws nothing on a stretch of a member where N = 0.
// The line forces sent to Shear Wall Design stay those of the entered sense.
// Run: node tests/daSenses.test.mjs
import assert from 'assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';

if (!globalThis.document) {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window, document, Node: window.Node });
}
const { getModule } = await import('../src/modules/registry.js');
const { swdExtract } = await import('../src/modules/tdWallLink.js');
const { normalizeInputs } = await import('../src/modules/tdMigrate.js');
const { defaultInputs } = await import('../src/modules/tdModel.js');
const { diaphragmAnalysis, calcAll, planWithLinks, reverseLoads, flipActs, CALC_VERSION } = await import('../src/modules/diaphragmAnalysis.js');
const V = await import('../src/modules/tdViews.js');
const { bookToInputs } = await import('./td-book/src/toInputs.mjs');
const gs = await import('../src/modules/tdGridShare.js');

const clone = v => JSON.parse(JSON.stringify(v));
const book = id => JSON.parse(fs.readFileSync(new URL('./td-book/' + id + '.json', import.meta.url), 'utf8'));
const load = f => JSON.parse(fs.readFileSync(new URL('./fixtures/da-user/' + f, import.meta.url), 'utf8'));
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 6).join('\n       ')); process.exitCode = 1; }
}
const windLoad = (acts, segs) => ({ id: 'ld-w', acts, mode: 'wind', kind: '', psf: '', edgeId: '', segments: segs.map(([from, to, w, wl]) => ({ from: String(from), to: String(to), w: String(w), w2: '', wl: String(wl) })) });
const runs = cs => cs.members.flatMap(m => m.runs.map(r => ({ key: m.name + '|' + m.family + '|' + r.from.toFixed(4), max: r.max, points: r.points })));
const swdItem = load('t98-swd.json'), roofItem = load('t98-roof.json');
const swd = getModule('shear_wall_design').migrate({ schemaVersion: swdItem.schemaVersion, inputs: clone(swdItem.inputs) }).inputs;
const roofInputs = () => normalizeInputs(clone(roofItem.inputs));
const roofRefs = () => ({ wallSource: swdExtract(swd) });
const roof = calcAll(roofInputs(), roofRefs());

test('calc version td-v18; flipActs / reverseLoads flip every load and keep its values', () => {
  assert.equal(CALC_VERSION, 'td-v18');
  assert.deepEqual(['-y', '+y', '+x', '-x'].map(flipActs), ['+y', '-y', '-x', '+x']);
  const i = defaultInputs(), r = reverseLoads(i);
  assert.deepEqual(r.loads.map(l => l.acts), ['+y', '-x']);
  assert.deepEqual(i.loads.map(l => l.acts), ['-y', '+x'], 'inputs untouched');
  assert.deepEqual(r.loads.map(l => ({ ...l, acts: '' })), i.loads.map(l => ({ ...l, acts: '' })));
});

test('26998 Roof: senses stored per case; reversed run not saved; seismic reversed = entered × −1 (members), line forces equal', () => {
  assert.deepEqual(roof.senses, [{ caseId: 'y-E', entered: '-y', reversed: '+y' }, { caseId: 'x-E', entered: '+x', reversed: '-x' }]);
  assert.ok(roof.reverse && !Object.keys(roof).includes('reverse'), 'reverse is in memory only');
  assert.ok(!JSON.stringify(roof).includes('"reverse"'));
  for (const cs of roof.analysis.cases) {
    const rc = roof.reverse.cases.find(c => c.id === cs.id);
    assert.equal(rc.sigma, -cs.sigma);
    for (const l of cs.lines) assert.ok(Math.abs(l.P - rc.lines.find(x => x.gridId === l.gridId).P) < 0.01, cs.id + ' ' + l.name);
    const a = runs(cs), b = new Map(runs(rc).map(r => [r.key, r]));
    assert.equal(a.length, b.size);
    for (const r of a) assert.ok(Math.abs(r.max + b.get(r.key).max) < 0.01, cs.id + ' ' + r.key);
  }
  assert.equal(roof.reverse.levelD, null, 'no walls above the roof: no diaphragm-level run');
  assert.deepEqual(roof.checks.filter(c => c.reversed).map(c => c.msg), [], 'the reversed sense closes as well');
});

test('26998 Roof: the line forces sent to Shear Wall Design are those of the entered sense (unchanged)', () => {
  const single = calcAll(roofInputs(), roofRefs(), { noReverse: true });
  assert.deepEqual(roof.lineForces, single.lineForces);
  assert.deepEqual(roof.transferIn, single.transferIn);
  assert.equal(single.reverse, undefined);
});

test('wind at an opening (book Ex 5.1, 123 / 77 plf): the reversed sense is its own run, not the entered × −1', () => {
  const w = bookToInputs(book('Ex5.1')); w.loads = [windLoad('-y', [[0, 160, 123, 77]])];
  const r = calcAll(w);
  assert.deepEqual(r.errors, []);
  const cs = r.analysis.cases[0], rc = r.reverse.cases.find(c => c.id === cs.id);
  // at the opening the windward strip moves to the other face: entered −y: top band 123, bottom 77 → reversed +y: bottom 123, top 77
  const band = (c, lo, hi) => { const iv = c.diaphragms[0].intervals.find(i => i.a >= 15 - 1e-6 && i.b <= 39 + 1e-6); return iv.bands.find(x => (hi ? x.hi === 50 : x.lo === 0)).wa; };
  assert.ok(Math.abs(band(cs, 0, 1) + 123) < 1e-9 && Math.abs(band(cs, 1, 0) + 77) < 1e-9);
  assert.ok(Math.abs(band(rc, 0, 1) - 77) < 1e-9 && Math.abs(band(rc, 1, 0) - 123) < 1e-9, `${band(rc, 0, 1)} / ${band(rc, 1, 0)}`);
  // a sign flip would be wrong: some member differs from −entered by more than 1 lb
  const a = runs(cs), b = new Map(runs(rc).map(x => [x.key, x]));
  const worst = Math.max(...a.map(x => (b.get(x.key) ? Math.abs(x.max + b.get(x.key).max) : 0)));
  assert.ok(worst > 1, 'flip differs by ' + worst.toFixed(1) + ' lb');
  // the reversed run = the entered sense with the two strips swapped, × −1 (same faces, opposite direction)
  const s = bookToInputs(book('Ex5.1')); s.loads = [windLoad('-y', [[0, 160, 77, 123]])];
  const sc = calcAll(s, {}, { noReverse: true }).analysis.cases[0];
  const m = new Map(runs(sc).map(x => [x.key, x]));
  for (const x of runs(rc)) assert.ok(Math.abs(x.max + m.get(x.key).max) < 0.01, x.key);
  for (const l of rc.lines) assert.ok(Math.abs(l.P - sc.lines.find(y => y.gridId === l.gridId).P) < 0.01, l.name);
});

test('a check the reversed run fails is reported once (caseId …:rev, "Reversed (acts …)"), not when the entered sense fails it too', () => {
  // chord-step TD3 removed from the 26998 Roof y case: both senses fail closure → each failure is listed once (entered sense)
  const i = roofInputs(); i.tds = i.tds.filter(t => !(t.mark === 'TD3' && t.dir === 'y'));
  const r = calcAll(i, roofRefs());
  const ent = r.checks.filter(c => !c.reversed && !c.ok && !c.warn), rev = r.checks.filter(c => c.reversed);
  assert.deepEqual(ent.map(c => c.caseId + ':' + c.code), ['y-E:closure', 'y-E:offset', 'y-E:failed']);
  assert.deepEqual(rev.filter(c => !c.warn).map(c => c.code), [], 'the reversed failures are the same ones — not repeated');
  for (const c of rev) {
    assert.ok(c.caseId.endsWith(':rev') && c.msg.startsWith('Reversed (acts '), c.msg);
    assert.ok(!ent.some(x => x.caseId + ':rev' === c.caseId && x.code === c.code), 'duplicate of ' + c.code);
  }
});

test('26998 2nd Floor (walls above): the diaphragm-level run exists in both senses; reversed = entered × −1', () => {
  const flr = load('t98-2nd.json'), { sharedGrids } = gs;
  const i = normalizeInputs(clone(flr.inputs)); i.tds = i.tds.filter(t => t.mark !== 'TD9');
  const r = calcAll(i, { wallSource: swdExtract(swd), gridSource: { grids: sharedGrids(roofItem.inputs) } });
  assert.ok(r.levelD.length && r.reverse.levelD.length);
  for (const d of r.levelD) {
    const rd = r.reverse.levelD.find(c => c.id === d.id), m = new Map(runs(rd).map(x => [x.key, x]));
    for (const x of runs(d)) assert.ok(Math.abs(x.max + m.get(x.key).max) < 0.5, d.id + ' ' + x.key);
  }
  assert.deepEqual(r.checks.filter(c => c.reversed).map(c => c.msg), []);
});

test('Analysis tab: sense buttons (entered / reversed), load combination dropdown × force level, "Forces shown" names all', () => {
  const i = defaultInputs(); i.level.fx = '100'; i.level.diaphragmFactor = '1.2';
  const box = document.createElement('div');
  diaphragmAnalysis.renderForm(box, i, () => {}, [], () => {}, {});
  const btn = t => [...box.querySelectorAll('button')].find(b => b.textContent === t);
  const click = t => btn(t).dispatchEvent(new window.Event('click'));
  const shown = () => box.querySelector('.td-forces-shown').textContent;
  const combo = v => { const s = box.querySelector('select[data-combo]'); for (const o of s.querySelectorAll('option')) { if (o.value === v) o.setAttribute('selected', ''); else o.removeAttribute('selected'); } s.dispatchEvent(new window.Event('change')); };
  click('Analysis');
  assert.deepEqual([...box.querySelectorAll('[data-sense]')].map(b => b.textContent), ['-y (entered)', '+y', 'Envelope ±y']);
  assert.deepEqual([...box.querySelectorAll('select[data-combo] option')].map(o => o.textContent), ['LRFD — 1E', 'ASD — 0.7E']);
  assert.ok(shown().startsWith('ASD 0.7E, acting -y (entered sense)'), shown());
  assert.ok(box.textContent.includes('35,000'), '0.7 × 50 000');
  click('Diaphragm × 1.2');
  assert.ok(shown().startsWith('ASD 0.7E × level 1.2 = × 0.84'), shown());
  assert.ok(box.textContent.includes('42,000'), '0.84 × 50 000');
  combo('LRFD');
  assert.ok(shown().startsWith('LRFD 1E × level 1.2 = × 1.2'), shown());
  assert.ok(box.textContent.includes('60,000'));
  box.querySelector('[data-sense="reversed"]').dispatchEvent(new window.Event('click'));
  assert.ok(shown().includes('acting +y (reversed sense'), shown());
  assert.ok(box.textContent.includes('60,000'), 'line forces are positive in the load direction in both senses');
  // View 4 in the reversed sense: the member table is the reversed run's × 1.2
  click('Members N');
  const rc = calcAll(i).reverse.cases.find(c => c.dir === 'y');
  const tables = [...box.querySelectorAll('table')];
  assert.equal(tables[tables.length - 1].textContent, V.memberTable(V.scaleCase(rc, 1.2)).textContent);
  // the wind case shows its own combinations
  const w = bookToInputs(book('Ex3.4')); w.tds.forEach(x => { x.engineer.cantileverOk = true; });
  const b2 = document.createElement('div');
  diaphragmAnalysis.renderForm(b2, w, () => {}, [], () => {}, {});
  [...b2.querySelectorAll('button')].find(b => b.textContent === 'Analysis').dispatchEvent(new window.Event('click'));
  assert.deepEqual([...b2.querySelectorAll('select[data-combo] option')].map(o => o.textContent), ['LRFD — 1W', 'ASD — 0.6W']);
  assert.ok(b2.querySelector('.td-forces-shown').textContent.startsWith('ASD 0.6W'));
});

test('Setup: no Acts picker (both senses analysed); ρ note under the seismic force levels', () => {
  const i = defaultInputs(); i.level.fx = '100';
  const box = document.createElement('div');
  diaphragmAnalysis.renderForm(box, i, () => {}, [], () => {}, {});
  [...box.querySelectorAll('button')].find(b => b.textContent === 'Setup').dispatchEvent(new window.Event('click'));
  const note = box.querySelector('[data-rho-note]');
  assert.ok(note && note.textContent.includes('the effect of ρ is already incorporated in the factor entered'), note && note.textContent);
  assert.ok([...box.querySelectorAll('[data-acts]')].some(e => e.textContent === 'Acts ±y (both senses)'));
  assert.ok(![...box.querySelectorAll('select')].some(s => [...s.querySelectorAll('option')].map(o => o.value).join() === '-y,+y'), 'no sense picker');
});

test('View 4: no diagram drawn on a stretch where N = 0 (26998 Roof, both directions, both senses)', () => {
  const plan = planWithLinks(roofInputs(), roofRefs()).plan;
  let zeroStretches = 0;
  for (const cs of [...roof.analysis.cases, ...roof.reverse.cases]) {
    for (const m of cs.members) for (const r of m.runs) {
      const p = [...r.points].sort((a, b) => a[0] - b[0]);
      for (let k = 0; k < p.length - 1; k++) if (p[k + 1][0] - p[k][0] > 1e-9 && Math.abs(p[k][1]) < 0.5 && Math.abs(p[k + 1][1]) < 0.5) zeroStretches++;
    }
    const d = V.drawMembers(plan, cs);
    const titles = [...d.svg.querySelectorAll('polygon title')].map(t => t.textContent);
    assert.ok(titles.length > 0);
    assert.deepEqual(titles.filter(t => /N [TC] 0 → [TC] 0 at/.test(t)), [], cs.id);
  }
  assert.ok(zeroStretches > 0, 'the model has zero stretches to hide');
});

// ── Envelope of the two senses (user 2026-11-10): overlay of the two runs, max T / max C signed
test('envelopePoints: max / min of two diagrams with the crossing added; clipSide adds the zero crossing', () => {
  const { hi, lo } = V.envelopePoints([[0, 0], [10, 100]], [[0, 50], [10, -50]]);
  // a = 10p, b = 50 − 10p cross at p = 2.5 (N 25)
  assert.deepEqual(hi, [[0, 50], [2.5, 25], [10, 100]]);
  assert.deepEqual(lo, [[0, 0], [2.5, 25], [10, -50]]);
  // compression side of lo: 0 up to the zero crossing at p = 5 (25 → −50 over 2.5–10), then down to −50
  assert.deepEqual(V.clipSide(lo, -1), [[0, 0], [2.5, 0], [5, 0], [10, -50]]);
  assert.deepEqual(V.clipSide(hi, 1), hi, 'all tension: unchanged');
  // a point of one diagram that the other does not have is taken with the other's value there (stations united)
  const u = V.envelopePoints([[0, 0], [4, 40], [10, 0]], [[0, 0], [10, -100]]);
  assert.deepEqual(u.hi.map(([p]) => p), [0, 4, 10]);
  assert.deepEqual(u.lo, [[0, 0], [4, -40], [10, -100]]);
});

test('envelope, 26998 Roof (seismic): max T = |N|, max C = −|N| on every run (the reversed run = entered × −1)', () => {
  for (const cs of roof.analysis.cases) {
    const env = V.envelopeCase(cs, roof.reverse.cases.find(c => c.id === cs.id));
    assert.ok(env.envelope);
    const a = new Map(runs(cs).map(x => [x.key, x]));
    let n = 0;
    for (const m of env.members) for (const r of m.runs) {
      const ra = a.get(m.name + '|' + m.family + '|' + r.from.toFixed(4));
      assert.ok(ra, 'matched ' + m.name);
      const big = Math.max(...ra.points.map(([, v]) => Math.abs(v)));
      const { T, C } = V.runExtremes(r);
      if (big < 0.5) { assert.ok(!T && !C); continue; }
      assert.ok(Math.abs(T.N - big) < 0.01 && Math.abs(C.N + big) < 0.01, m.name + ' ' + T.N + ' / ' + C.N + ' vs ' + big);
      n++;
    }
    assert.ok(n > 10, cs.id + ' runs with force: ' + n);
  }
});

test('envelope, book Ex 5.1 wind at the opening: max T / max C from both runs (differs from either sense alone)', () => {
  const w = bookToInputs(book('Ex5.1')); w.loads = [windLoad('-y', [[0, 160, 123, 77]])];
  const r = calcAll(w), cs = r.analysis.cases[0], rc = r.reverse.cases.find(c => c.id === cs.id);
  const env = V.envelopeCase(cs, rc);
  const a = new Map(runs(cs).map(x => [x.key, x])), b = new Map(runs(rc).map(x => [x.key, x]));
  let differs = 0;
  for (const m of env.members) for (const er of m.runs) {
    const k = m.name + '|' + m.family + '|' + er.from.toFixed(4), ra = a.get(k), rb = b.get(k);
    const all = [...ra.points, ...rb.points].map(([, v]) => v);
    const { T, C } = V.runExtremes(er);
    const tMax = Math.max(...all), cMin = Math.min(...all);
    if (tMax >= 0.5) assert.ok(Math.abs(T.N - tMax) < 0.01, k + ' T ' + (T && T.N) + ' vs ' + tMax); else assert.equal(T, null);
    if (cMin <= -0.5) assert.ok(Math.abs(C.N - cMin) < 0.01, k + ' C ' + (C && C.N) + ' vs ' + cMin); else assert.equal(C, null);
    const ea = V.runExtremes(ra), eb = V.runExtremes(rb);
    if ([ea, eb].every(e => !(e.T && T && Math.abs(e.T.N - T.N) < 0.01 && e.C && C && Math.abs(e.C.N - C.N) < 0.01))) differs++;
  }
  assert.ok(differs > 0, 'some run takes its max T from one sense and its max C from the other');
});

test('Analysis tab: Envelope ±y — View 4 draws max T / max C of both senses', () => {
  const i = defaultInputs(); i.level.fx = '100';
  const box = document.createElement('div');
  diaphragmAnalysis.renderForm(box, i, () => {}, [], () => {}, {});
  const click = t => [...box.querySelectorAll('button')].find(b => b.textContent === t).dispatchEvent(new window.Event('click'));
  click('Analysis');
  box.querySelector('[data-sense="envelope"]').dispatchEvent(new window.Event('click'));
  click('Members N');
  assert.ok(!box.querySelector('[data-envelope-note="shear"]'));
  assert.ok(box.querySelector('.td-forces-shown').textContent.includes('acting ±y (envelope of both senses'));
  const titles = [...box.querySelectorAll('g.td-view polygon title')].map(t => t.textContent);
  assert.ok(titles.some(t => /: max N T /.test(t)) && titles.some(t => /: max N C /.test(t)), 'both diagrams drawn');
  // the table = the envelope of the two runs at ASD (0.7)
  const r = calcAll(i), cs = r.analysis.cases.find(c => c.dir === 'y');
  const env = V.envelopeCase(V.scaleCase(cs, 0.7), V.scaleCase(r.reverse.cases.find(c => c.id === cs.id), 0.7));
  const tables = [...box.querySelectorAll('table')];
  assert.equal(tables[tables.length - 1].textContent, V.memberTable(env).textContent);
});

// ── Unit shear envelope (user 2026-11-10): max |v| of the two senses, Views 1–3
test('unit shear envelope, 26998 Roof (seismic): max |v| = |v| of the entered sense, reversed v = −entered (basic, TD, net)', () => {
  const plan = planWithLinks(roofInputs(), roofRefs()).plan;
  for (const cs of roof.analysis.cases) {
    const rc = roof.reverse.cases.find(c => c.id === cs.id);
    let n = 0;
    for (const d of cs.diaphragms) for (const iv of d.intervals) for (const bd of iv.bands) {
      const s = (iv.a + iv.b) / 2, c = (bd.lo + bd.hi) / 2;
      for (const kind of [1, 2, 3]) {
        const e = V.envShearAt(cs, rc, kind, s, c);
        if (!e) continue;
        assert.ok(Math.abs((e.va || 0) + (e.vb || 0)) < 0.01, cs.id + ' kind ' + kind + ' ' + e.va + ' / ' + e.vb);
        assert.ok(Math.abs(e.v - Math.abs(e.va || 0)) < 0.01);
        n++;
      }
    }
    assert.ok(n > 50, cs.id + ' points ' + n);
    const d = V.drawShearEnvelope(plan, cs, rc, 3, {}, {}, { a: '-y', b: '+y' });
    assert.ok(d.scale.envelope && d.svg.querySelectorAll('g.td-view rect').length > 10);
  }
});

test('unit shear envelope, book Ex 5.1 wind at the opening: each band takes its max |v| from its own governing sense', () => {
  const w = bookToInputs(book('Ex5.1')); w.loads = [windLoad('-y', [[0, 160, 123, 77]])];
  const r = calcAll(w), cs = r.analysis.cases[0], rc = r.reverse.cases.find(c => c.id === cs.id);
  const iv = cs.diaphragms[0].intervals.find(i => i.a >= 15 - 1e-6 && i.b <= 39 + 1e-6);
  const s = (iv.a + iv.b) / 2;
  const top = iv.bands.find(x => x.hi === 50), bot = iv.bands.find(x => x.lo === 0);
  const et = V.envShearAt(cs, rc, 1, s, (top.lo + top.hi) / 2), eb = V.envShearAt(cs, rc, 1, s, (bot.lo + bot.hi) / 2);
  // the band that takes the windward strip has the larger |v|: top in −y (entered), bottom in +y (reversed)
  assert.ok(et.v > Math.abs(et.vb) + 0.1 && et.from === 'a', 'top band governed by the entered sense ' + JSON.stringify(et));
  assert.ok(eb.v > Math.abs(eb.va) + 0.1 && eb.from === 'b', 'bottom band governed by the reversed sense ' + JSON.stringify(eb));
});

test('Analysis tab: Envelope on View 1 / 3 — max |v| cells, note, section table per band with the governing sense, read-out', () => {
  const w = bookToInputs(book('Ex5.1')); w.loads = [windLoad('-y', [[0, 160, 123, 77]])];
  const box = document.createElement('div');
  diaphragmAnalysis.renderForm(box, w, () => {}, [], () => {}, {});
  const click = t => [...box.querySelectorAll('button')].find(b => b.textContent === t).dispatchEvent(new window.Event('click'));
  click('Analysis');
  box.querySelector('[data-sense="envelope"]').dispatchEvent(new window.Event('click'));
  assert.ok(box.querySelector('[data-envelope-note="shear"]').textContent.includes('max |v| of the two senses (-y, +y)'));
  const titles = [...box.querySelectorAll('g.td-view1 rect title')].map(t => t.textContent);
  assert.ok(titles.length && titles.every(t => t.startsWith('max |v_b| ')), titles[0]);
  assert.ok(titles.some(t => t.includes('plf (-y)')) && titles.some(t => t.includes('plf (+y)')), 'both senses govern somewhere');
  const rows = [...box.querySelectorAll('tr[data-env-row]')].map(r => r.textContent);
  assert.ok(rows.length && rows.some(t => t.includes('(+y)')) && rows.some(t => t.includes('(-y)')), rows.join(' | '));
  assert.ok(box.querySelector('.td-scale').textContent.includes('max |v_b| of both senses'));
  click('Net v_net');
  assert.ok([...box.querySelectorAll('g.td-view rect title')].some(t => t.textContent.startsWith('max |v_net| ')));
  // read-out of one cell: both senses and max |v|
  const r = calcAll(w), cs = r.analysis.cases[0], rc = r.reverse.cases.find(c => c.id === cs.id);
  const plan = planWithLinks(w).plan;
  const d = V.drawShearEnvelope(plan, V.scaleCase(cs, 0.6), V.scaleCase(rc, 0.6), 3, {}, {}, { a: '-y', b: '+y' });
  const [x, y] = [d.view.sx(27), d.view.sy(45)];
  const ro = V.readoutAt(plan, { ...V.scaleCase(cs, 0.6), envShear: { b: V.scaleCase(rc, 0.6), acts: { a: '-y', b: '+y' } } }, d.view, 3, x, y);
  assert.match(ro.text, /^v_net -y: .* · \+y: .* → max \|v\| .* plf \((-y|\+y)\)/);
});

console.log(passed + ' passed');
