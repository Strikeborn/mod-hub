import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ClassicLevel } = require('classic-level');
const needle = (process.argv[2] ?? '.archive').toLowerCase();
const db = new ClassicLevel(`${process.env.APPDATA}/Vortex/state.v2`, { valueEncoding: 'buffer' });
let n = 0;
for await (const [key, value] of db.iterator()) {
  const ks = String(key);
  const text = value.toString('utf8').toLowerCase();
  if (!text.includes(needle) && !ks.toLowerCase().includes(needle)) continue;
  if (!ks.includes('cyberpunk')) continue;
  n++;
  if (n <= 15) {
    console.log('KEY', ks.slice(0, 200));
    console.log(value.toString('utf8').slice(0, 180));
    console.log('---');
  }
}
await db.close();
console.log('total', n);
