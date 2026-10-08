// Diaphragm to LRS — engine and module tests. Run: node tests/diaphragmToLrs.test.mjs
import assert from 'assert/strict';
await import('../scripts/lib/shearWallLoadCheck.mjs'); // stand-in DOM globals
const { solveBeam, calcAll, autoTag, isSimple } = await import('../src/modules/diaphragmToLrsCalc.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n       ')); process.exitCode = 1; }
}
const close = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol, msg + ' ' + a + ' vs ' + b);

// ── Beam: the lever rule against every published closed form (AISC Manual Table 3-23) ──
const W = (w, a, b) => ({ id: 'p', label: 'part', a, b, w });
const P = (x, p) => ({ id: 'pt', label: 'P', x, P: p });

test('A — simple span, full uniform: R1 = R2 = w·l/2 (Case 1)', () => {
  const s = solveBeam({ L: 18, x1: 0, x2: 18, parts: [W(0.3, 0, 18)] });
  close(s.R1, 0.3 * 18 / 2); close(s.R2, 0.3 * 18 / 2);
  assert.equal(s.rows[0].region, 'span');
});

test('B — partial uniform a/b/c: R1 = w·b(2c+b)/(2l), R2 = w·b(2a+b)/(2l) (Case 4)', () => {
  const [w, a, b, l] = [0.25, 3, 8, 20]; const c = l - a - b;
  const s = solveBeam({ L: l, x1: 0, x2: l, parts: [W(w, a, b)] });
  close(s.R1, w * b * (2 * c + b) / (2 * l)); close(s.R2, w * b * (2 * a + b) / (2 * l));
  assert.equal(s.rows[0].region, 'span');
});

test('C — point load anywhere: R1 = P·b/l, R2 = P·a/l (Case 8)', () => {
  const s = solveBeam({ L: 18.25, x1: 0, x2: 18.25, parts: [], points: [P(2, 1.41706)] });
  close(s.R1, 1.41706 * 16.25 / 18.25); close(s.R2, 1.41706 * 2 / 18.25);
  assert.equal(s.rows[0].region, 'span');
});

test('D — overhang one side, full uniform: R1 = w(l²−a²)/(2l), R2 = w(l+a)²/(2l) (Case 24 = B + J)', () => {
  const [w, l, a] = [0.2, 20, 5];
  const s = solveBeam({ L: l + a, x1: 0, x2: l, parts: [W(w, 0, l + a)] });
  close(s.R1, w * (l * l - a * a) / (2 * l)); close(s.R2, w * (l + a) ** 2 / (2 * l));
  assert.deepEqual(s.rows.map(r => r.region), ['span', 'right']);
});

test('E — overhangs both sides: J + B + J, superposition of D on each side', () => {
  const [w, a1, l, a2] = [0.2, 3, 20, 5];
  const s = solveBeam({ L: a1 + l + a2, x1: a1, x2: a1 + l, parts: [W(w, 0, a1 + l + a2)] });
  assert.deepEqual(s.rows.map(r => r.region), ['left', 'span', 'right']);
  const R2 = w * (l + a2) ** 2 / (2 * l) - w * a1 * a1 / (2 * l);
  close(s.R2, R2); close(s.R1 + s.R2, w * (a1 + l + a2));
});

test('F — point load on an overhang: R1 = −P·a/l (reverses), R2 = P(l+a)/l (Case 26)', () => {
  const s = solveBeam({ L: 25, x1: 0, x2: 20, parts: [], points: [P(25, 2)] });
  close(s.R1, -2 * 5 / 20); close(s.R2, 2 * 25 / 20);
  assert.equal(s.rows[0].region, 'right');
  const g = solveBeam({ L: 25, x1: 0, x2: 20, parts: [], points: [P(22, 2)] });
  assert.equal(g.rows[0].region, 'right');
  close(g.R1, -2 * 2 / 20);
});

test('H — stepped depth along the span = Case 4 per step', () => {
  const l = 20, s = solveBeam({ L: l, x1: 0, x2: l, parts: [W(0.3, 0, 12), W(0.1, 12, 8)] });
  const c4 = (w, a, b) => [w * b * (2 * (l - a - b) + b) / (2 * l), w * b * (2 * a + b) / (2 * l)];
  const [r1a, r2a] = c4(0.3, 0, 12), [r1b, r2b] = c4(0.1, 12, 8);
  close(s.R1, r1a + r1b); close(s.R2, r2a + r2b);
});

test('I — two point loads = Case 10: R1 = [P1(l−a1) + P2(l−a2)]/l', () => {
  const l = 16, s = solveBeam({ L: l, x1: 0, x2: l, parts: [], points: [P(3, 1.2), P(11, 0.7)] });
  close(s.R1, (1.2 * (l - 3) + 0.7 * (l - 11)) / l); close(s.R2, (1.2 * 3 + 0.7 * 11) / l);
});

test('J — uniform only on the overhang: R1 = −w·a²/(2l), R2 = w·a(2l+a)/(2l) (Case 25)', () => {
  const [w, l, a] = [0.1, 20, 5];
  const s = solveBeam({ L: l + a, x1: 0, x2: l, parts: [W(w, l, a)] });
  close(s.R1, -w * a * a / (2 * l)); close(s.R2, w * a * (2 * l + a) / (2 * l));
  assert.equal(s.rows[0].region, 'right');
});

test('K — a part over a support is cut into B + J; same reactions as its resultant', () => {
  const s = solveBeam({ L: 25, x1: 0, x2: 20, parts: [W(0.05, 15, 10)] });
  assert.deepEqual(s.rows.map(r => r.region), ['span', 'right']);
  close(s.R1, 0, 1e-12); close(s.R2, 0.5);
});

test('L — diaphragm split into 3 parts, each Case 4 with a_i + b_i + c_i = l', () => {
  const l = 12, parts = [W(0.2, 0, 4), W(0.35, 4, 5), W(0.15, 9, 3)];
  const s = solveBeam({ L: l, x1: 0, x2: l, parts });
  let r1 = 0, r2 = 0;
  for (const p of parts) { const c = l - p.a - p.b; r1 += p.w * p.b * (2 * c + p.b) / (2 * l); r2 += p.w * p.b * (2 * p.a + p.b) / (2 * l); }
  close(s.R1, r1); close(s.R2, r2);
});

test('M — L + J worked example (plan / D04c): R1 = 2.9375, R2 = 4.0625', () => {
  const q = 0.01;
  const s = solveBeam({ L: 25, x1: 0, x2: 20, parts: [W(q * 30, 0, 20), W(q * 10, 20, 5), W(q * 5, 15, 10)] });
  close(s.R1, 2.9375, 1e-12); close(s.R2, 4.0625, 1e-12);
  assert.deepEqual(s.rows.map(r => r.region), ['span', 'right', 'span', 'right']);
  // mirror: overhang on the left
  const m = solveBeam({ L: 25, x1: 5, x2: 25, parts: [W(q * 30, 5, 20), W(q * 10, 0, 5), W(q * 5, 0, 10)] });
  close(m.R2, 2.9375, 1e-12); close(m.R1, 4.0625, 1e-12);
});

test('Random beams: ΣR = ΣW + ΣP and ΣM = 0 about any point', () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 300; k++) {
    const L = 5 + rnd() * 40, x1 = rnd() * L * 0.4, x2 = x1 + 0.5 + rnd() * (L - x1 - 0.5);
    const parts = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => { const a = rnd() * L * 0.9; return W(rnd(), a, 0.1 + rnd() * (L - a - 0.1)); });
    const points = Array.from({ length: Math.floor(rnd() * 3) }, () => P(rnd() * L, rnd() * 2));
    const s = solveBeam({ L, x1, x2, parts, points });
    close(s.R1 + s.R2, s.sumW + s.sumP, 1e-9, 'ΣF');
    const p = rnd() * L;
    const mR = s.R1 * (x1 - p) + s.R2 * (x2 - p);
    const mL = s.rows.reduce((t, r) => t + (r.kind === 'uniform' ? r.W * (r.xbar - p) : r.P * (r.x - p)), 0);
    close(mR, mL, 1e-9, 'ΣM');
  }
});

// ── Level / direction calc ──
const ln = (x, l) => ({ x: String(x), kind: 'line', lineId: l });
const on = (x, t, atX) => ({ x: String(x), kind: 'diaphragm', diaphragmId: t, atX: String(atX) });
const dg = (id, lv, len, d, s1, s2, extra = {}) => ({ id, levelId: lv, mark: id, length: String(len), supports: [s1, s2], parts: [{ id: id + 'p', a: '0', b: String(len), d: String(d) }], pointLoads: [], ...extra });
const TWO = [{ id: 'r', name: 'Roof', fx: '10' }, { id: 's', name: '2nd Floor', fx: '5' }];
const model = (diaphragms, more = {}, levels = TWO) => ({
  levels,
  directions: [{ id: 'ew', name: 'E-W', lines: ['A', 'B', 'C', 'D'].map(n => ({ id: n, name: n })), groups: [], down: {}, diaphragms, ...more }],
});

test('Level: q = F_x / ΣA and Σ reactions = F_x (D1, D2 pass)', () => {
  const out = calcAll(model([dg('d1', 'r', 20, 30, ln(0, 'A'), ln(20, 'B')), dg('d2', 'r', 10, 40, ln(0, 'B'), ln(10, 'C'))], {}, TWO.slice(0, 1)));
  const lv = out.perDirection[0].perLevel[0];
  close(lv.sumA, 1000); close(lv.q, 0.01);
  close(lv.lines.reduce((s, u) => s + u.F, 0), 10, 1e-4);
  assert.equal(out.status, 'pass');
});

test('Chain: a diaphragm on another passes its reaction as a point load, in any input order', () => {
  const out = calcAll(model([dg('d1', 'r', 20, 30, ln(0, 'A'), ln(20, 'B')), dg('d2', 'r', 10, 40, on(0, 'd1', 5), ln(10, 'C')), dg('d3', 'r', 4, 10, ln(0, 'C'), on(4, 'd2', 10))], {}, TWO.slice(0, 1)));
  const lv = out.perDirection[0].perLevel[0];
  const d1 = lv.diaphragms.find(d => d.id === 'd1');
  assert.equal(d1.points.length, 1);
  assert.equal(d1.points[0].source, 'R.d2.R1');
  close(lv.lines.reduce((s, u) => s + u.F, 0), 10, 1e-4);
  assert.equal(out.status, 'pass');
});

test('Loop is reported (D4) and the level does not balance (D2)', () => {
  const out = calcAll(model([dg('d1', 'r', 20, 30, ln(0, 'A'), on(20, 'd2', 0)), dg('d2', 'r', 10, 40, on(0, 'd1', 5), ln(10, 'C'))]));
  const fails = out.perDirection[0].checks.filter(c => c.status === 'fail').map(c => c.id);
  assert.ok(fails.includes('D4') && fails.includes('D2'), fails.join());
});

test('Manual P adds to the level: Σ reactions = F_x + ΣP', () => {
  const d = dg('d1', 'r', 20, 50, ln(0, 'A'), ln(20, 'B'), { pointLoads: [{ id: 'm1', x: '5', p: '1.5', note: 'unit' }] });
  const out = calcAll(model([d], {}, TWO.slice(0, 1)));
  const lv = out.perDirection[0].perLevel[0];
  close(lv.sumToLines, 11.5, 1e-4);
  assert.equal(out.status, 'pass');
});

test('Story shear: same line, split %, ends here, group at some levels only', () => {
  const ds = [
    dg('r1', 'r', 20, 25, ln(0, 'A'), ln(20, 'B')), dg('r2', 'r', 20, 25, ln(0, 'C'), ln(20, 'D')),
    dg('s1', 's', 20, 25, ln(0, 'A'), ln(20, 'B')), dg('s2', 's', 20, 25, ln(0, 'C'), ln(20, 'D')),
  ];
  const out = calcAll(model(ds, {
    groups: [{ id: 'bc', lineIds: ['B', 'C'], levelIds: ['s'] }],
    down: { r: { D: { mode: 'split', split: [{ to: 'A', pct: '40' }, { to: 'g:bc', pct: '60' }] }, A: { mode: 'ends' } } },
  }));
  const [roof, second] = out.perDirection[0].perLevel;
  assert.equal(roof.lines.length, 4);
  const at = (lv, label) => lv.lines.find(u => u.label === label);
  // roof: 2.5 k per line; 2nd: 1.25 k per line
  close(at(second, '2.A').V, 1.25 + 2.5 * 0.4, 1e-4);                 // own + 40 % of R.D (R.A ended at the roof)
  close(at(second, '2.B+2.C').V, 2.5 + 2.5 + 2.5 + 2.5 * 0.6, 1e-4);  // own (B + C) + R.B + R.C + 60 % of R.D
  close(at(second, '2.D').V, 1.25, 1e-4);
  close(second.sumV, 15 - 2.5, 1e-4);                                 // ΣF at and above − R.A resisted at the roof
  assert.equal(out.status, 'pass', JSON.stringify(out.perDirection[0].checks.filter(c => c.status === 'fail')));
});

test('A line with no same line below must be split or ended (D6), and D7 then fails', () => {
  const ds = [dg('r1', 'r', 20, 25, ln(0, 'A'), ln(20, 'D')), dg('s1', 's', 20, 25, ln(0, 'A'), ln(20, 'B'))];
  const fails = calcAll(model(ds)).perDirection[0].checks.filter(c => c.status === 'fail').map(c => c.id);
  assert.deepEqual(fails, ['D6', 'D7']);
});

test('Split must add to 100 % (D5); geometry errors are reported (D3)', () => {
  const ds = [dg('r1', 'r', 20, 25, ln(0, 'A'), ln(20, 'B')), dg('s1', 's', 20, 25, ln(0, 'A'), ln(20, 'C')),
    dg('s2', 's', 10, 5, ln(4, 'A'), ln(4, 'C'))];
  const out = calcAll(model(ds, { down: { r: { B: { mode: 'split', split: [{ to: 'C', pct: '90' }] } } } }));
  const fails = out.perDirection[0].checks.filter(c => c.status === 'fail').map(c => c.id);
  assert.ok(fails.includes('D5') && fails.includes('D3'), fails.join());
});

test('Labels: auto level tag and simple-diaphragm detection', () => {
  assert.equal(autoTag('Roof'), 'R'); assert.equal(autoTag('2nd Floor'), '2'); assert.equal(autoTag(''), '');
  assert.ok(isSimple(dg('x', 'r', 10, 5, ln(0, 'A'), ln(10, 'B'))));
  assert.ok(!isSimple(dg('x', 'r', 10, 5, ln(0, 'A'), ln(8, 'B'))));
});

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
