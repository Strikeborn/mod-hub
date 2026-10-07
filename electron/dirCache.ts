import fs from 'node:fs';
import path from 'node:path';

/**
 * Short-lived readdir cache for preview lookups. attachVortexNexusPreviews checks the same few
 * Vortex folders (downloads, staging, cache, assets) once per mod; listing each folder once per
 * catalog load instead of once per mod took catalog load from ~5 s to well under 1 s.
 */
const TTL_MS = 30_000;
const listings = new Map<string, { at: number; entries: fs.Dirent[] | null }>();
const imageIndexes = new Map<string, { at: number; files: string[] }>();

/** fs.readdirSync(dir, { withFileTypes: true }) cached for 30 s; null if the folder can't be read. */
export function readdirCached(dir: string): fs.Dirent[] | null {
  const hit = listings.get(dir);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.entries;
  let entries: fs.Dirent[] | null;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    entries = null;
  }
  listings.set(dir, { at: now, entries });
  return entries;
}

/** Every image file under root (bounded walk), listed once per 30 s. */
export function imageFilesUnder(root: string, imageExt: Set<string>, maxDirs = 4000): string[] {
  const hit = imageIndexes.get(root);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.files;
  const files: string[] = [];
  const stack = [root];
  let steps = 0;
  while (stack.length > 0 && steps < maxDirs) {
    steps += 1;
    const dir = stack.pop()!;
    for (const e of readdirCached(dir) ?? []) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (imageExt.has(path.extname(e.name).toLowerCase())) files.push(full);
    }
  }
  imageIndexes.set(root, { at: now, files });
  return files;
}
