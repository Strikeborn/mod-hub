import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ClassicLevel } = require('classic-level');
const uuid = process.argv[2];
const db = new ClassicLevel(`${process.env.APPDATA}/Vortex/state.v2`, { valueEncoding: 'buffer' });
const prefix = `persistent###downloads###files###${uuid}`;
for await (const [key, value] of db.iterator()) {
  const ks = String(key);
  if (!ks.startsWith(prefix)) continue;
  if (/created|updated|game|modId|picture/.test(ks)) {
    console.log(ks.slice(prefix.length));
    console.log(value.toString('utf8').slice(0, 150));
  }
}
await db.close();
