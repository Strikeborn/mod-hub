import { buildDownloadArchiveIndex, normalizeArchiveDeployKey } from '../electron/vortexDownloadArchiveIndex.ts';

const index = buildDownloadArchiveIndex();
console.log('keys', index.size);
for (const name of ['#DirtBegone.archive', '0_CheriNowlin_outfit.archive']) {
  const key = normalizeArchiveDeployKey(name);
  console.log(name, '->', key, index.get(key));
}
