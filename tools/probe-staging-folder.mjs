import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ClassicLevel } = require('classic-level');

const folder = process.argv[2] ?? 'Nudist City Mod-2897-v2-0-1-1627623658';
const db = new ClassicLevel(`${process.env.APPDATA}/Vortex/state.v2`, { valueEncoding: 'buffer' });
let attr = 0;
let dl = 0;
for await (const [key, value] of db.iterator()) {
  const ks = String(key);
  if (ks.includes(folder)) {
    if (ks.includes('###attributes###')) attr++;
    console.log(ks.slice(0, 180), '=', value.toString('utf8').slice(0, 80));
  }
  if (ks.includes('###installed###modId') && value.toString('utf8').includes(folder)) {
    dl++;
    console.log('DL INSTALLED', ks, '=', value.toString('utf8').slice(0, 120));
  }
}
await db.close();
console.log('attr hits', attr, 'dl installed hits', dl);
