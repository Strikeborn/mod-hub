import fs from 'node:fs';
import path from 'node:path';
import { imageFilesUnder, readdirCached } from './dirCache';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/** Vortex often stores mod tiles under game cache or next to deployment metadata. */
export function findVortexModPicture(modDir: string, gameFolder: string, nexusModId?: number): string | undefined {
  if (modDir && fs.existsSync(modDir)) {
    const shallow = findImageInDir(modDir, 2);
    if (shallow) return shallow;
  }

  const appData = process.env.APPDATA;
  if (!appData) return undefined;

  const cacheRoot = path.join(appData, 'Vortex', gameFolder, 'cache');
  if (nexusModId && fs.existsSync(cacheRoot)) {
    try {
      for (const f of readdirCached(cacheRoot) ?? []) {
        if (!f.isFile()) continue;
        const ext = path.extname(f.name).toLowerCase();
        if (!IMAGE_EXT.has(ext)) continue;
        if (f.name.includes(String(nexusModId))) return path.join(cacheRoot, f.name);
      }
    } catch {
      /* ignore */
    }
  }

  const assetsRoot = path.join(appData, 'Vortex', 'assets');
  if (nexusModId && fs.existsSync(assetsRoot)) {
    const id = String(nexusModId);
    const hit = imageFilesUnder(assetsRoot, IMAGE_EXT).find((f) => path.basename(f).includes(id));
    if (hit) return hit;
  }

  return undefined;
}

function findImageInDir(root: string, maxDepth: number): string | undefined {
  function walk(dir: string, depth: number): string | undefined {
    if (depth > maxDepth) return undefined;
    const entries = readdirCached(dir);
    if (!entries) return undefined;
    for (const e of entries) {
      if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (IMAGE_EXT.has(ext) && /preview|icon|thumb|logo|banner/i.test(e.name)) {
          return path.join(dir, e.name);
        }
      }
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const found = walk(path.join(dir, e.name), depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  return walk(root, 0);
}
