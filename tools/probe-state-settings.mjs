import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ClassicLevel } = require('classic-level');

const db = new ClassicLevel(`${process.env.APPDATA}/Vortex/state.v2`, { valueEncoding: 'buffer' });
const want = /^settings###(mods|downloads|gameMode)/;
for await (const [key, value] of db.iterator()) {
  const ks = String(key);
  if (!want.test(ks)) continue;
  console.log(ks, '=', value.toString('utf8').slice(0, 300));
}
await db.close();
