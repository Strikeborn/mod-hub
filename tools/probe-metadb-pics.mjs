import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ClassicLevel } = require('classic-level');

const db = new ClassicLevel(`${process.env.APPDATA}/Vortex/metadb`, { valueEncoding: 'buffer' });
let withPic = 0;
let total = 0;
const sample = [];
for await (const [key, value] of db.iterator()) {
  const ks = String(key);
  if (!ks.startsWith('hash:')) continue;
  total++;
  try {
    const rows = JSON.parse(value.toString('utf8'));
    const row = rows[0];
    if (!row) continue;
    const desc = row.details?.description ?? '';
    const pic = row.details?.picture;
    const m = row.sourceURI?.match(/mods\/(\d+)/);
    const id = m ? m[1] : null;
    if (pic || /staticdelivery|\[img\]/i.test(desc)) {
      withPic++;
      if (sample.length < 10) {
        sample.push({
          id,
          domain: row.domainName,
          fileName: row.fileName?.slice(0, 60),
          pic: pic?.slice(0, 120),
          imgTag: /\[img\]/i.test(desc),
        });
      }
    }
  } catch {
    /* ignore */
  }
}
await db.close();
console.log(JSON.stringify({ total, withPic, sample }, null, 2));
