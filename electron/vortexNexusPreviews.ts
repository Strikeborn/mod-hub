import fs from 'node:fs';
import path from 'node:path';
import type { ModRecord } from '../shared/types';
import { downloadDiskPath } from '../shared/modDiskPath';
import { VORTEX_FOLDER_TO_GAME_ID } from './gamePathMap';
import { findVortexModPicture } from './vortexPictures';
import { isGuess404NexusThumb, isPlausibleNexusPreviewUrl } from './nexusImageIds';
import { vortexStagingRoot } from './vortexPaths';
import { readdirCached } from './dirCache';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export function vortexFolderForGameId(gameId: string): string {
  for (const [folder, id] of Object.entries(VORTEX_FOLDER_TO_GAME_ID)) {
    if (id === gameId) return folder;
  }
  return gameId.replace(/-/g, '');
}

function findImageBesideFile(filePath: string): string | undefined {
  if (!filePath || !fs.existsSync(filePath)) return undefined;
  const dir = fs.statSync(filePath).isDirectory() ? filePath : path.dirname(filePath);
  const base = path.basename(filePath).replace(/\.(zip|7z|rar|archive)(\.\d+)?$/i, '');
  const entries = readdirCached(dir) ?? [];
  const names = new Set(entries.map((e) => e.name.toLowerCase()));
  for (const ext of IMAGE_EXT) {
    if (names.has((base + ext).toLowerCase())) return path.join(dir, base + ext);
  }
  try {
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (!IMAGE_EXT.has(path.extname(e.name).toLowerCase())) continue;
      if (e.name.toLowerCase().includes(base.slice(0, 12).toLowerCase())) {
        return path.join(dir, e.name);
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function scanVortexDownloadsForModImage(gameFolder: string, nexusModId: number): string | undefined {
  const appData = process.env.APPDATA;
  if (!appData) return undefined;
  const dlRoot = path.join(appData, 'Vortex', 'downloads', gameFolder);
  if (!fs.existsSync(dlRoot)) return undefined;
  const id = String(nexusModId);
  try {
    for (const e of readdirCached(dlRoot) ?? []) {
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!IMAGE_EXT.has(ext)) continue;
      if (e.name.includes(id)) return path.join(dlRoot, e.name);
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function vortexModInstallDir(gameFolder: string, nexusModId: number): string | undefined {
  const modsRoot = vortexStagingRoot(gameFolder);
  if (!modsRoot || !fs.existsSync(modsRoot)) return undefined;
  const id = String(nexusModId);
  try {
    for (const e of readdirCached(modsRoot) ?? []) {
      if (!e.isDirectory()) continue;
      if (e.name.includes(id)) return path.join(modsRoot, e.name);
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/** Fill previewPath / sane remotePreviewUrl from Vortex caches and download folders (no API). */
export function attachVortexNexusPreviews(mods: ModRecord[]): number {
  let attached = 0;
  for (const m of mods) {
    if (m.nexusModId == null) continue;
    const gameFolder = (m.nexusGameDomain ?? vortexFolderForGameId(m.gameId)).toLowerCase();

    if (m.remotePreviewUrl && isGuess404NexusThumb(m.remotePreviewUrl)) {
      m.remotePreviewUrl = undefined;
    } else if (
      m.remotePreviewUrl &&
      !m.remotePreviewFromApi &&
      !isPlausibleNexusPreviewUrl(m.remotePreviewUrl, m.nexusGameDomain, m.nexusModId)
    ) {
      m.remotePreviewUrl = undefined;
    }

    if (m.previewPath && fs.existsSync(m.previewPath)) continue;
    // A usable Nexus image URL is already shown (and disk-cached by the thumbnail loader); searching
    // Vortex folders for a local copy on every catalog load cost seconds and almost never found one.
    if (m.remotePreviewUrl) continue;

    const tryPaths = [
      m.localPath,
      ...(m.alternateLocalPaths ?? []),
      downloadDiskPath(m),
      vortexModInstallDir(gameFolder, m.nexusModId),
    ].filter(Boolean) as string[];

    let found: string | undefined;
    for (const p of tryPaths) {
      found = findImageBesideFile(p);
      if (found) break;
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        found = findVortexModPicture(p, gameFolder, m.nexusModId);
        if (found) break;
      }
    }

    if (!found) found = scanVortexDownloadsForModImage(gameFolder, m.nexusModId);
    if (!found) found = findVortexModPicture('', gameFolder, m.nexusModId);

    if (found) {
      m.previewPath = found;
      m.iconPath = m.iconPath ?? found;
      attached += 1;
      continue;
    }

  }
  return attached;
}

/** Share metadb / Vortex folder previews across all rows with the same Nexus mod id. */
export function propagateNexusPreviewIndex(mods: ModRecord[]): number {
  type Bucket = {
    previewPath?: string;
    remotePreviewUrl?: string;
    remoteCreatedAt?: string;
    remoteUpdatedAt?: string;
  };
  const byId = new Map<string, Bucket>();

  for (const m of mods) {
    if (m.nexusModId == null) continue;
    const k = `${(m.nexusGameDomain ?? m.gameId).toLowerCase()}|${m.nexusModId}`;
    const b = byId.get(k) ?? {};
    if (m.previewPath && fs.existsSync(m.previewPath)) b.previewPath = b.previewPath ?? m.previewPath;
    if (m.remotePreviewUrl && !isGuess404NexusThumb(m.remotePreviewUrl)) {
      b.remotePreviewUrl = b.remotePreviewUrl ?? m.remotePreviewUrl;
    }
    if (m.remoteCreatedAt) b.remoteCreatedAt = b.remoteCreatedAt ?? m.remoteCreatedAt;
    if (m.remoteUpdatedAt) b.remoteUpdatedAt = b.remoteUpdatedAt ?? m.remoteUpdatedAt;
    byId.set(k, b);
  }

  let applied = 0;
  for (const m of mods) {
    if (m.nexusModId == null) continue;
    const k = `${(m.nexusGameDomain ?? m.gameId).toLowerCase()}|${m.nexusModId}`;
    const b = byId.get(k);
    if (!b) continue;
    if (m.remotePreviewUrl && isGuess404NexusThumb(m.remotePreviewUrl)) m.remotePreviewUrl = undefined;
    let touched = false;
    if (!m.previewPath && b.previewPath) {
      m.previewPath = b.previewPath;
      m.iconPath = m.iconPath ?? b.previewPath;
      touched = true;
    }
    if (!m.previewPath && !m.remotePreviewUrl && b.remotePreviewUrl) {
      m.remotePreviewUrl = b.remotePreviewUrl;
      touched = true;
    }
    if (!m.remoteCreatedAt && b.remoteCreatedAt) {
      m.remoteCreatedAt = b.remoteCreatedAt;
      touched = true;
    }
    if (!m.remoteUpdatedAt && b.remoteUpdatedAt) {
      m.remoteUpdatedAt = b.remoteUpdatedAt;
      touched = true;
    }
    if (touched) applied += 1;
  }
  return applied;
}
