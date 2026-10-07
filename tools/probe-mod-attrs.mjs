import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ClassicLevel } = require('classic-level');

const match = (process.argv[2] ?? 'Dirt Begone').toLowerCase();
const db = new ClassicLevel(`${process.env.APPDATA}/Vortex/state.v2`, { valueEncoding: 'buffer' });
const attrs = new Map();
for await (const [key, value] of db.iterator()) {
  const ks = String(key);
  if (!ks.startsWith('persistent###mods###')) continue;
  const parts = ks.split('###');
  if (parts[4] !== 'attributes') continue;
  if (!parts[3].toLowerCase().includes(match)) continue;
  const list = attrs.get(parts[3]) ?? [];
  const v = value.toString('utf8').slice(0, 90);
  list.push(`${parts.slice(5).join('.')} = ${v}`);
  attrs.set(parts[3], list);
}
await db.close();
for (const [folder, list] of attrs) {
  console.log('=== ' + folder);
  for (const l of list) console.log('   ' + l);
}
