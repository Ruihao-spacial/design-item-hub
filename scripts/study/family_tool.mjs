import fs from 'fs';
const R = new URL('../../', import.meta.url).href;
const { calcAll } = await import(R + 'src/modules/diaphragmAnalysis.js');
const { bookToInputs } = await import(R + 'tests/td-book/src/toInputs.mjs');
const { chordForce } = await import(R + 'src/modules/tdMembers.js');
const cases = JSON.parse(fs.readFileSync('family.json', 'utf8'));
const out = {};
for (const c of cases) {
  out[c.id] = {};
  for (const cut of ['vierendeel', 'section']) {
    const i = bookToInputs(c); i.diaphragms[0].chordCut = cut;
    const r = calcAll(i);
    if (r.errors.length) { out[c.id].err = r.errors.map(e => e.msg); continue; }
    const cs = r.analysis.cases[0];
    out[c.id][cut] = { D: chordForce(cs, 10, c.xc, '-').N, A2_3: chordForce(cs, 45, c.xo, '+').N, A2_5: chordForce(cs, 45, c.xo + 25, '-').N, B_3: chordForce(cs, 30, c.xo, '+').N, B_5: chordForce(cs, 30, c.xo + 25, '-').N };
  }
}
fs.writeFileSync('family_tool.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out).slice(0, 300));
