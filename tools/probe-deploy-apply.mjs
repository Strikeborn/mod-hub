import fs from 'node:fs';
import path from 'node:path';
import { scanVortexStateModMeta } from '../electron/vortexStateScanner.ts';
import {
  applyVortexDeploymentToMods,
  buildVortexDeploymentIndex,
} from '../electron/vortexDeployment.ts';
import { refreshModsVortexCorrelation } from '../electron/vortexCatalogRefresh.ts';

const catPath = path.join(process.env.APPDATA ?? '', 'mod-hub', 'catalog.json');
const cat = JSON.parse(fs.readFileSync(catPath, 'utf8'));
const localArchives = cat.mods.filter(
  (m) =>
    m.gameId === 'cyberpunk2077' &&
    m.source === 'local' &&
    /\.archive$/i.test(m.localPath ?? ''),
);

console.log('local archives in saved catalog', localArchives.length);

const state = await scanVortexStateModMeta();
console.log('staging path', state.stagingPaths.get('cyberpunk2077'));
console.log('byStagingFolder entries', state.byStagingFolder.size);

const idx = buildVortexDeploymentIndex(state.stagingPaths);
console.log('deployment index entries', idx.entries);

const clone = localArchives.map((m) => ({ ...m }));
const stats = applyVortexDeploymentToMods(clone, idx, state);
console.log('apply stats', stats);

const withNexus = clone.filter((m) => m.nexusModId);
console.log('with nexusModId after apply', withNexus.length, '/', clone.length);

const m0 = localArchives[0];
if (m0) {
  const base = path.basename(m0.localPath).toLowerCase();
  const byBase = idx.byBaseName.get(`cyberpunk2077|${base}`);
  console.log('first', m0.title, 'byBase', !!byBase);
  if (byBase) {
    const sk = `${byBase.gameId}|${byBase.stagingFolder}`;
    const meta = state.byStagingFolder.get(sk);
    console.log('staging key', sk.slice(0, 100));
    console.log('meta found', !!meta, meta?.nexusModId, meta?.remoteCreatedAt?.slice(0, 10));
  }
}

const allMods = cat.mods.map((m) => ({ ...m }));
const full = await refreshModsVortexCorrelation(allMods, state);
const cp = allMods.filter((m) => m.gameId === 'cyberpunk2077');
const localAfter = cp.filter(
  (m) => m.source === 'local' && /\.archive$/i.test(m.localPath ?? ''),
);
console.log('full refresh merged rows', full.mergedCount);
console.log('after refresh: local archive rows', localAfter.length);
console.log('cp2077 nexus source rows', cp.filter((m) => m.source === 'nexus').length);
console.log(
  'gaps: no uploaded',
  cp.filter((m) => m.nexusModId && !m.remoteCreatedAt).length,
  'no image',
  cp.filter((m) => m.nexusModId && !m.previewPath && !m.remotePreviewUrl).length,
  'with zip alt',
  cp.filter((m) => (m.alternateLocalPaths ?? []).some((p) => /\.(zip|7z)/i.test(p))).length,
);
