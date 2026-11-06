import fs from 'fs';
const R = new URL('../../', import.meta.url).href;
const { calcAll } = await import(R + 'src/modules/diaphragmAnalysis.js');
const { bookToInputs } = await import(R + 'tests/td-book/src/toInputs.mjs');
const { chordForce } = await import(R + 'src/modules/tdMembers.js');
const cases = JSON.parse(fs.readFileSync('family.json', 'utf8'));
const out = {};
// zero-shear rule: the band's zero-shear point x0 inside the opening (if any) becomes the zero of its edge member
const zeroOf = (d, lo, hi, a, b) => {
  for (const iv of d.intervals) { if (iv.b <= a + 1e-6 || iv.a >= b - 1e-6) continue;
    const bd = iv.bands.find(q => Math.abs(q.lo - lo) < 1e-4 || Math.abs(q.hi - hi) < 1e-4);
    if (bd && bd.va * bd.vb < 0) return iv.a + (iv.b - iv.a) * bd.va / (bd.va - bd.vb); }
  return null;
};
for (const c of cases) {
  const i = bookToInputs(c); i.diaphragms[0].chordCut = 'section';
  const cs = calcAll(i).analysis.cases[0], d = cs.diaphragms[0];
  const r = {};
  for (const [nm, y, lo, hi] of [['A2', 45, 45, null], ['B', 30, null, 30]]) {
    const x0 = zeroOf(d, lo ?? -1, hi ?? -1, c.xo, c.xo + 25);
    const shift = x0 === null ? 0 : chordForce(cs, y, x0, '').N; // N under the inflection rule at the zero-shear point
    r[nm] = { x0, at3: chordForce(cs, y, c.xo, '+').N - shift, at5: chordForce(cs, y, c.xo + 25, '-').N - shift };
  }
  out[c.id] = r;
}
fs.writeFileSync('family_g3.json', JSON.stringify(out, null, 1));
