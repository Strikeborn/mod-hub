import fs from 'node:fs';
import path from 'node:path';
import type { ModRecord } from '../shared/types';
import { gameIdFromVortexFolder } from './gamePathMap';
import { findPreviewInTree } from './modMetadata';
import { findVortexModPicture } from './vortexPictures';
import { stableIdFromParts } from './scanHelpers';
import { allVortexStagingRoots } from './vortexPaths';
import { parseNexusIdFromVortexModKey } from './vortexStateScanner';

const VORTEX_MOD_DIR_RE = /^(\d{1,10})\s*[-–—]\s*(.+)$/;

function vortexImageCandidates(modDir: string, gameFolder: string, nexusModId: number): string[] {
  const out: string[] = [];
  const preview = findPreviewInTree(modDir);
  if (preview) out.push(preview);
  const appData = process.env.APPDATA;
  if (!appData) return out;
  const cacheRoot = path.join(appData, 'Vortex', gameFolder, 'cache');
  if (fs.existsSync(cacheRoot)) {
    try {
      for (const f of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
        if (!f.isFile()) continue;
        if (!/\.(png|jpg|jpeg|webp)$/i.test(f.name)) continue;
        if (f.name.includes(String(nexusModId))) out.push(path.join(cacheRoot, f.name));
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

function nexusDomainFromFolder(gameFolder: string): string {
  const g = gameFolder.toLowerCase().replace(/[^a-z0-9]/g, '');
  const map: Record<string, string> = {
    cyberpunk2077: 'cyberpunk2077',
    projectzomboid: 'projectzomboid',
    rimworld: 'rimworld',
    skyrimse: 'skyrimspecialedition',
    skyrimspecialedition: 'skyrimspecialedition',
    fallout4: 'fallout4',
    stardewvalley: 'stardewvalley',
    baldursgate3: 'baldursgate3',
  };
  return map[g] ?? gameFolder.toLowerCase();
}

function ingestVortexModDir(
  addMod: (m: ModRecord, locationLabel?: string, locationRoot?: string) => void,
  gameFolder: string,
  gameId: string,
  domain: string,
  modsRoot: string,
  d: fs.Dirent,
) {
  if (!d.isDirectory()) return;
  const localPath = path.join(modsRoot, d.name);
  const match = d.name.match(VORTEX_MOD_DIR_RE);
  let nexusModId: number | undefined;
  let title = d.name;
  if (match) {
    nexusModId = Number(match[1]);
    title = match[2].trim();
  } else {
    nexusModId = parseNexusIdFromVortexModKey(d.name);
    const idOnly = d.name.match(/^(\d{4,10})$/);
    if (!nexusModId && idOnly) nexusModId = Number(idOnly[1]);
  }

  const images = vortexImageCandidates(localPath, gameFolder, nexusModId ?? 0);
  const previewPath = images[0] ?? findVortexModPicture(localPath, gameFolder, nexusModId);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(localPath);
  } catch {
    return;
  }

  addMod(
    {
      id: stableIdFromParts(['vortex-mod', gameFolder, d.name, localPath]),
      source: nexusModId ? 'nexus' : 'vortex-staging',
      gameId,
      title,
      localPath,
      nexusModId,
      nexusGameDomain: nexusModId ? domain : undefined,
      previewPath,
      iconPath: previewPath,
      installedAt: stat.mtime.toISOString(),
      lastSeenAt: new Date().toISOString(),
      favorited: false,
      revision: { kind: 'unknown', value: nexusModId ? String(nexusModId) : d.name },
      tags: ['vortex-installed', gameFolder],
    },
    `Vortex mods/${gameFolder}`,
    modsRoot,
  );
}

/** Custom install paths from Vortex state (`F:\Vortex_Mods\{game}`, etc.). */
export function scanConfiguredVortexStagingRoots(
  addMod: (m: ModRecord, locationLabel?: string, locationRoot?: string) => void,
) {
  for (const [gameFolder, stagingRoot] of allVortexStagingRoots()) {
    if (!stagingRoot || !fs.existsSync(stagingRoot)) continue;
    const gameId = gameIdFromVortexFolder(gameFolder);
    const domain = nexusDomainFromFolder(gameFolder);
    let modDirs: fs.Dirent[];
    try {
      modDirs = fs.readdirSync(stagingRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of modDirs) {
      if (d.name.startsWith('vortex.deployment')) continue;
      ingestVortexModDir(addMod, gameFolder, gameId, domain, stagingRoot, d);
    }
  }
}

/** Vortex default: %APPDATA%/Vortex/{gameId}/mods/{nexusId} - {name}/ */
export function scanVortexInstalledModFolders(
  addMod: (m: ModRecord, locationLabel?: string, locationRoot?: string) => void,
) {
  const appData = process.env.APPDATA;
  if (!appData) return;
  const root = path.join(appData, 'Vortex');
  if (!fs.existsSync(root)) return;

  let gameDirs: fs.Dirent[];
  try {
    gameDirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const g of gameDirs) {
    if (!g.isDirectory()) continue;
    const skip = ['staging', 'downloads', 'logs', 'temp', 'plugins', 'cache', 'meta', 'state'];
    if (skip.includes(g.name.toLowerCase())) continue;
    const modsRoot = path.join(root, g.name, 'mods');
    if (!fs.existsSync(modsRoot)) continue;

    let modDirs: fs.Dirent[];
    try {
      modDirs = fs.readdirSync(modsRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    const gameId = gameIdFromVortexFolder(g.name);
    const domain = nexusDomainFromFolder(g.name);

    for (const d of modDirs) {
      ingestVortexModDir(addMod, g.name, gameId, domain, modsRoot, d);
    }
  }
}
