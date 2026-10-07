import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ClassicLevel } = require('classic-level');

const want = new Set(process.argv.slice(2).map((x) => Number(x)).filter(Boolean));
const db = new ClassicLevel(`${process.env.APPDATA}/Vortex/metadb`, { valueEncoding: 'buffer' });
const IMG_BB = /\[img\](https?:\/\/[^\[]+\.(?:png|jpg|jpeg|webp))(?:\[[^\]]*\])?\[\/img\]/i;
const IMG_PLAIN = /(https?:\/\/staticdelivery\.nexusmods\.com\/mods\/\d+\/images\/[^\s"']+\.(?:png|jpg|jpeg|webp))/i;

for await (const [key, value] of db.iterator()) {
  const ks = String(key);
  if (!ks.startsWith('hash:')) continue;
  try {
    const row = JSON.parse(value.toString('utf8'))[0];
    if (!row) continue;
    const id =
      (row.sourceURI?.match(/mods\/(\d+)/)?.[1] && Number(row.sourceURI.match(/mods\/(\d+)/)[1])) ||
      null;
    if (want.size && (!id || !want.has(id))) continue;
    const desc = row.details?.description ?? '';
    const bb = desc.match(IMG_BB);
    const plain = desc.match(IMG_PLAIN);
    console.log(JSON.stringify({
      id,
      fileName: row.fileName,
      picture: row.details?.picture,
      fromBb: bb?.[1],
      fromPlain: plain?.[1],
    }, null, 2));
  } catch {
    /* ignore */
  }
}
await db.close();
