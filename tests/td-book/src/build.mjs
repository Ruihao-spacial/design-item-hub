// Book example sources → tests/td-book/Ex*.json (validated). Run: npm run da:book:build [Ex4.1 …]
import fs from 'node:fs';
import path from 'node:path';
import { loadSources, validate, sheathedArea, toolValue, OUT_DIR } from './lib.mjs';

const ids = process.argv.slice(2);
let bad = 0;
for (const src of await loadSources(ids)) {
  const err = validate(src);
  if (err.length) {
    bad++;
    console.log(`${src.id}: ${err.length} error(s)`);
    err.forEach(e => console.log('   ' + e));
    continue;
  }
  // vTool = the value in the tool's sign convention (FORMAT.md, Signs); the test compares against vTool
  const conv = list => (list || []).map(e => ({ ...e, vTool: toolValue(src, e) }));
  const json = { ...src, expected: conv(src.expected), sheathedArea: sheathedArea(src.layout) };
  if (src.expectedNonClosing) json.expectedNonClosing = conv(src.expectedNonClosing);
  fs.writeFileSync(path.join(OUT_DIR, `${src.id}.json`), JSON.stringify(json, null, 2) + '\n');
  const byPhase = {};
  src.expected.forEach(e => { byPhase[e.phase] = (byPhase[e.phase] || 0) + 1; });
  console.log(`${src.id}: ${src.expected.length} values (${Object.entries(byPhase).map(([p, n]) => `phase ${p}: ${n}`).join(', ')}), area ${json.sheathedArea} sf`);
}
process.exit(bad ? 1 : 0);
