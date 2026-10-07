import type { ModRecord } from './types';

function isDownloadPath(p: string): boolean {
  return /\.(zip|7z|rar)(\.\d+)?$/i.test(p);
}

function isDeployedArchive(p: string): boolean {
  const lower = p.toLowerCase().replace(/\//g, '\\');
  return lower.endsWith('.archive') || lower.includes('archive\\pc\\mod');
}

/** Path users care about (deployed mod), not the Vortex download zip. */
export function deployedDiskPath(m: ModRecord): string {
  if (isDeployedArchive(m.localPath)) return m.localPath;
  for (const p of m.alternateLocalPaths ?? []) {
    if (isDeployedArchive(p)) return p;
  }
  for (const p of m.alternateLocalPaths ?? []) {
    if (!isDownloadPath(p)) return p;
  }
  return m.localPath;
}

export function downloadDiskPath(m: ModRecord): string | undefined {
  if (isDownloadPath(m.localPath)) return m.localPath;
  return m.alternateLocalPaths?.find((p) => isDownloadPath(p));
}

/** Local image file for thumbnail (never a .archive / .zip). */
export function bestPreviewFilePath(m: ModRecord): string | undefined {
  if (m.previewPath && /\.(png|jpe?g|webp)$/i.test(m.previewPath)) return m.previewPath;
  if (m.iconPath && /\.(png|jpe?g|webp)$/i.test(m.iconPath)) return m.iconPath;
  return undefined;
}
