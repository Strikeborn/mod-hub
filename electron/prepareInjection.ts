import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { loadBrowseInjectionScript } from './browseInjection';

const INJECT_FILE = 'browse-injection.js';

export function ensureInjectionFileOnDisk(): { diskPath: string; source: string } | { error: string } {
  const loaded = loadBrowseInjectionScript();
  if ('error' in loaded) return loaded;

  const dest = path.join(app.getPath('userData'), INJECT_FILE);
  try {
    let copy = true;
    if (fs.existsSync(dest)) {
      const srcStat = fs.statSync(loaded.source);
      const dstStat = fs.statSync(dest);
      copy = srcStat.mtimeMs > dstStat.mtimeMs || dstStat.size !== srcStat.size;
    }
    if (copy) fs.copyFileSync(loaded.source, dest);
    return { diskPath: dest, source: loaded.source };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function injectionProtocolPath(): string | null {
  const r = ensureInjectionFileOnDisk();
  if ('error' in r) return null;
  return r.diskPath;
}
