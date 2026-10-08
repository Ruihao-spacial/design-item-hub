// Build verification case JSON from the sources:
//   node tests/cases/src/build.mjs            every case (npm run cases:build)
//   node tests/cases/src/build.mjs V05 V06    only those
import fs from 'fs';
import { writeCase } from './lib.mjs';

const dir = new URL('./', import.meta.url);
const outDir = new URL('../', import.meta.url);
const only = process.argv.slice(2).filter(a => /^V\d\d$/.test(a));
const files = fs.readdirSync(dir).filter(f => /^V\d\d\.mjs$/.test(f) && (!only.length || only.includes(f.slice(0, 3)))).sort();
for (const f of files) {
  const id = f.slice(0, 3);
  for (const old of fs.readdirSync(outDir)) if (old.startsWith(id + '-') && old.endsWith('.json')) fs.unlinkSync(new URL(old, outDir));
  const c = (await import(new URL(f, dir))).default;
  const file = writeCase(c);
  console.log(c.id + ' → ' + file.pathname.split('/').pop());
}
