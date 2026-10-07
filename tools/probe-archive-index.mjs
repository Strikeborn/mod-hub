// Rebuild the download archive index from scratch (no cache) — reproduces the scanAll index step.
import fs from 'node:fs';
import path from 'node:path';
import { buildDownloadArchiveIndex } from '../electron/vortexDownloadArchiveIndex.ts';

const root = path.join(process.env.APPDATA ?? '', 'Vortex', 'downloads');
let big = 0;
for (const g of fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : []) {
	if (!g.isDirectory()) continue;
	for (const f of fs.readdirSync(path.join(root, g.name))) {
		try {
			if (fs.statSync(path.join(root, g.name, f)).size > 0x1fffffe8) big += 1;
		} catch {}
	}
}
console.log('downloads over 512MB string limit', big);
const t0 = Date.now();
const idx = buildDownloadArchiveIndex((c, t) => {
	if (c % 500 === 0) console.log(`  progress ${c}/${t}`);
});
console.log('byDeployKey', idx.byDeployKey.size, 'byNexusId', idx.byNexusId.size);
console.log('seconds', ((Date.now() - t0) / 1000).toFixed(1));
