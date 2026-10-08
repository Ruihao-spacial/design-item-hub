// Build the Diaphragm to LRS case JSON files from the sources. Run: npm run dlrs:cases:build [D01 …]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeCase } from './lib.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const srcs = fs.readdirSync(dir).filter(f => /^[DB]\d\d\w*\.mjs$/.test(f) && (!only.length || only.includes(f.replace('.mjs', ''))));
for (const f of srcs.sort()) {
  const c = (await import('./' + f)).default;
  console.log('wrote', path.basename(writeCase(c)));
}
