import fs from 'node:fs';
import { decodeMsgpack } from '../electron/msgpackLite.ts';

const p = process.argv[2] ?? 'F:/Vortex_Mods/cyberpunk2077/vortex.deployment.msgpack';
const data = decodeMsgpack(fs.readFileSync(p));
const { files, ...head } = data;
console.log('head', head);
console.log('files', files?.length);
console.log(JSON.stringify((files ?? []).slice(0, 5), null, 2));
const archives = (files ?? []).filter((f) => /\.archive$/i.test(f.relPath ?? ''));
console.log('archive entries', archives.length);
console.log(JSON.stringify(archives.slice(0, 3), null, 2));
