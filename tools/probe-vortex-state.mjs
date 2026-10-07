import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { ClassicLevel } = require('classic-level');

const statePath = `${process.env.APPDATA}/Vortex/state.v2`;
if (!fs.existsSync(statePath)) {
  console.error('missing', statePath);
  process.exit(1);
}

const needle = process.argv[2] || '6165';
const db = new ClassicLevel(statePath, { valueEncoding: 'buffer' });
let hits = 0;
for await (const [key, value] of db.iterator()) {
  const ks = String(key);
  const text = value.toString('utf8');
  if (!text.includes(needle)) continue;
  if (!/picture|thumbnail|staticdelivery|modId/i.test(text)) continue;
  hits++;
  if (hits <= 8) {
    console.log('--- key:', ks.slice(0, 120));
    console.log(text.slice(0, 2000));
  }
}
await db.close();
console.log('hits', hits);
