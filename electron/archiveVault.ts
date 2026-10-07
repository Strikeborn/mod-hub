import fs from 'node:fs';
import path from 'node:path';

/**
 * Mod Hub archive vault: a hard link to every Vortex download archive.
 * A hard link is a second name for the same file, so it costs no extra disk space. If Vortex
 * deletes or replaces its copy, the vault copy survives and Mod Hub points at it instead.
 */
export function vaultRoot(): string {
  return path.join(process.env.APPDATA ?? '', 'mod-hub', 'vault');
}

function vortexDownloadsRoot(): string {
  return path.join(process.env.APPDATA ?? '', 'Vortex', 'downloads');
}

export function vaultPathFor(gameFolder: string, fileName: string): string {
  return path.join(vaultRoot(), gameFolder, fileName);
}

export type VaultSyncStats = { linked: number; already: number; skipped: number; errors: number };

export function syncArchiveVault(): VaultSyncStats {
  const stats: VaultSyncStats = { linked: 0, already: 0, skipped: 0, errors: 0 };
  const root = vortexDownloadsRoot();
  if (!process.env.APPDATA || !fs.existsSync(root)) return stats;
  for (const g of fs.readdirSync(root, { withFileTypes: true })) {
    if (!g.isDirectory()) continue;
    const dir = path.join(root, g.name);
    let files: fs.Dirent[];
    try {
      files = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.isFile() || !/\.(zip|7z|rar)(\.\d+)?$/i.test(f.name)) continue;
      const src = path.join(dir, f.name);
      const dest = vaultPathFor(g.name, f.name);
      try {
        if (fs.existsSync(dest)) {
          const a = fs.statSync(src);
          const b = fs.statSync(dest);
          if (a.ino === b.ino || a.size === b.size) {
            stats.already += 1;
            continue;
          }
          // Vortex replaced the archive (new version under the same name): keep the old one.
          fs.renameSync(dest, `${dest}.old-${Math.floor(b.mtimeMs / 1000)}`);
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.linkSync(src, dest);
        stats.linked += 1;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EXDEV') stats.skipped += 1;
        else stats.errors += 1;
      }
    }
  }
  return stats;
}
