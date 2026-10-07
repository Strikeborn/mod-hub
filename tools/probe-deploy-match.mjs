import fs from 'node:fs';
import path from 'node:path';
import { decodeMsgpack } from '../electron/msgpackLite.ts';

const p = 'F:/Vortex_Mods/cyberpunk2077/vortex.deployment.msgpack';
const data = decodeMsgpack(fs.readFileSync(p));
const files = data.files ?? [];
const names = (process.argv.slice(2).length ? process.argv.slice(2) : ['_0_NoThong.archive', '_00_PC_Judy1_Wallpaper_2.0.archive', 'DirtBegone.archive', '#DirtBegone.archive']).map((s) => s.toLowerCase());

for (const want of names) {
  const hits = files.filter((f) => (f.relPath ?? '').toLowerCase().replace(/\//g, '\\').endsWith('\\' + want) || path.basename(f.relPath ?? '').toLowerCase() === want);
  console.log('===', want, 'hits', hits.length);
  console.log(JSON.stringify(hits.slice(0, 3), null, 2));
}

const archives = files.filter((f) => /\.archive$/i.test(f.relPath ?? ''));
const bases = new Set(archives.map((f) => path.basename(f.relPath).toLowerCase()));
console.log('unique archive basenames', bases.size, 'of', archives.length);

const cat = JSON.parse(fs.readFileSync(`${process.env.APPDATA}/mod-hub/catalog.json`, 'utf8'));
const local = cat.mods.filter((m) => m.gameId === 'cyberpunk2077' && m.source === 'local' && /\.archive$/i.test(m.localPath));
let inManifest = 0;
let miss = [];
for (const m of local) {
  const b = path.basename(m.localPath).toLowerCase();
  if (bases.has(b)) inManifest += 1;
  else if (miss.length < 20) miss.push(m.title);
}
console.log('local archives in catalog', local.length, 'basename in manifest', inManifest, 'not in manifest', local.length - inManifest);
console.log('sample not in manifest', miss);
