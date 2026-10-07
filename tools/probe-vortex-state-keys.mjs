import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ClassicLevel } = require('classic-level');

const db = new ClassicLevel(`${process.env.APPDATA}/Vortex/state.v2`, { valueEncoding: 'buffer' });
const prefix = 'persistent###downloads###files###7576f44e-3054-4a26-84e6-0836217b18af';
for await (const [key, value] of db.iterator()) {
  const ks = String(key);
  if (!ks.startsWith(prefix)) continue;
  console.log(ks.replace(prefix, '...'));
  console.log(value.toString('utf8').slice(0, 200));
}
await db.close();
