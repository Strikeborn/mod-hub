import fs from 'node:fs';
import path from 'node:path';
import type { ArchiveZipHit } from './vortexDownloadArchiveIndex';

type CachedIndex = {
  signature: string;
  byDeployKey: [string, ArchiveZipHit][];
  byNexusId: [string, ArchiveZipHit][];
};

export function downloadsIndexSignature(downloadsRoot: string): string {
  if (!fs.existsSync(downloadsRoot)) return 'missing';
  let count = 0;
  let maxMtime = 0;
  try {
    for (const game of fs.readdirSync(downloadsRoot, { withFileTypes: true })) {
      if (!game.isDirectory()) continue;
      const dir = path.join(downloadsRoot, game.name);
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!f.isFile() || !/\.(zip|7z|rar)$/i.test(f.name)) continue;
        count += 1;
        const st = fs.statSync(path.join(dir, f.name));
        if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
      }
    }
  } catch {
    return 'error';
  }
  return `${count}:${Math.floor(maxMtime)}`;
}

export function loadCachedDownloadIndex(
  cachePath: string,
  signature: string,
): { byDeployKey: Map<string, ArchiveZipHit>; byNexusId: Map<string, ArchiveZipHit> } | null {
  try {
    if (!fs.existsSync(cachePath)) return null;
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as CachedIndex;
    if (raw.signature !== signature) return null;
    return {
      byDeployKey: new Map(raw.byDeployKey),
      byNexusId: new Map(raw.byNexusId),
    };
  } catch {
    return null;
  }
}

export function saveCachedDownloadIndex(
  cachePath: string,
  signature: string,
  byDeployKey: Map<string, ArchiveZipHit>,
  byNexusId: Map<string, ArchiveZipHit>,
) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const payload: CachedIndex = {
      signature,
      byDeployKey: [...byDeployKey.entries()],
      byNexusId: [...byNexusId.entries()],
    };
    fs.writeFileSync(cachePath, JSON.stringify(payload), 'utf8');
  } catch {
    /* ignore */
  }
}
