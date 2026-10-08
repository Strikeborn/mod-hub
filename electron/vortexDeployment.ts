import fs from 'node:fs';
import path from 'node:path';
import type { ModRecord } from '../shared/types';
import { decodeMsgpack } from './msgpackLite';
import {
  applyStateMetaToMod,
  parseNexusIdFromVortexModKey,
  type VortexStateIndex,
  type VortexStateModMeta,
} from './vortexStateScanner';

type ManifestFile = { relPath?: string; source?: string; target?: string };

export type Manifest = {
  gameId?: string;
  stagingPath?: string;
  targetPath?: string;
  deploymentMethod?: string;
  files?: ManifestFile[];
};

export type DeployedFileLink = {
  gameId: string;
  /** Vortex staging mod folder name (key into `VortexStateIndex.byStagingFolder`). */
  stagingFolder: string;
  stagingFilePath: string;
  deployedPath: string;
};

export type VortexDeploymentIndex = {
  /** Lowercased absolute deployed file path → link. */
  byDeployedPath: Map<string, DeployedFileLink>;
  /** `gameId|lowercased basename` → link (deploy folders are flat per game). */
  byBaseName: Map<string, DeployedFileLink>;
  manifests: number;
  entries: number;
};

export function emptyDeploymentIndex(): VortexDeploymentIndex {
  return { byDeployedPath: new Map(), byBaseName: new Map(), manifests: 0, entries: 0 };
}

export function readManifest(stagingPath: string, kind = ''): Manifest | undefined {
  const packed = path.join(stagingPath, `vortex.deployment${kind ? `.${kind}` : ''}.msgpack`);
  if (fs.existsSync(packed)) {
    try {
      return decodeMsgpack(fs.readFileSync(packed)) as Manifest;
    } catch {
      /* fall through to json */
    }
  }
  const json = path.join(stagingPath, `vortex.deployment${kind ? `.${kind}` : ''}.json`);
  if (fs.existsSync(json)) {
    try {
      return JSON.parse(fs.readFileSync(json, 'utf8')) as Manifest;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Vortex writes `vortex.deployment.msgpack` in each game's staging folder: an exact
 * deployed-file → staging-mod mapping. That is the only reliable way to tie a flat
 * deployed file (e.g. `archive\pc\mod\LizziesBDs.archive`) back to its Nexus mod.
 */
export function buildVortexDeploymentIndex(
  stagingPaths: Map<string, string>,
): VortexDeploymentIndex {
  const index = emptyDeploymentIndex();

  for (const [gameId, stagingPath] of stagingPaths) {
    if (!stagingPath || !fs.existsSync(stagingPath)) continue;
    const manifest = readManifest(stagingPath);
    if (!manifest?.files?.length) continue;

    index.manifests += 1;
    const targetRoot = manifest.targetPath ?? '';
    const stagingRoot = manifest.stagingPath ?? stagingPath;
    const game = (manifest.gameId ?? gameId).toLowerCase();

    for (const entry of manifest.files) {
      const rel = entry.relPath;
      const source = entry.source;
      if (!rel || !source) continue;

      const relNorm = rel.replace(/\\/g, '/');
      const deployedPath = targetRoot
        ? path.normalize(path.join(targetRoot, ...relNorm.split('/')))
        : rel;
      const link: DeployedFileLink = {
        gameId: game,
        stagingFolder: source,
        stagingFilePath: path.join(stagingRoot, source, rel),
        deployedPath,
      };

      index.byDeployedPath.set(deployedPath.toLowerCase(), link);
      const baseKey = `${game}|${path.basename(rel).toLowerCase()}`;
      if (!index.byBaseName.has(baseKey)) index.byBaseName.set(baseKey, link);
      index.entries += 1;
    }
  }

  return index;
}

function vortexDownloadZipPath(gameId: string, fileName: string): string | undefined {
  const appData = process.env.APPDATA;
  if (!appData || !fileName) return undefined;
  const p = path.join(appData, 'Vortex', 'downloads', gameId.toLowerCase(), fileName);
  return fs.existsSync(p) ? p : undefined;
}

function addAlternatePath(m: ModRecord, alt: string): void {
  if (!alt || alt.toLowerCase() === m.localPath.toLowerCase()) return;
  const alts = new Set(m.alternateLocalPaths ?? []);
  alts.add(alt);
  m.alternateLocalPaths = [...alts];
}

function resolveStagingMeta(
  link: DeployedFileLink,
  state: VortexStateIndex,
): VortexStateModMeta | undefined {
  const sk = `${link.gameId}|${link.stagingFolder}`;
  let meta = state.byStagingFolder.get(sk);
  if (meta) return meta;

  const parsed = parseNexusIdFromVortexModKey(link.stagingFolder);
  if (parsed) return state.byModId.get(`${link.gameId}|${parsed}`);

  return undefined;
}

function lookupLink(
  m: ModRecord,
  index: VortexDeploymentIndex,
): DeployedFileLink | undefined {
  const direct = index.byDeployedPath.get(m.localPath.toLowerCase());
  if (direct) return direct;

  const base = path.basename(m.localPath).toLowerCase();
  const game = (m.nexusGameDomain ?? m.gameId).toLowerCase();
  return index.byBaseName.get(`${game}|${base}`) ?? index.byBaseName.get(`cyberpunk2077|${base}`);
}

export type DeploymentApplyStats = { linked: number; enriched: number };

/**
 * Attach Nexus metadata to deployed files using the manifest, then the staging folder's
 * Vortex attributes (mod id, picture, upload date, author).
 */
export function applyVortexDeploymentToMods(
  mods: ModRecord[],
  index: VortexDeploymentIndex,
  state: VortexStateIndex,
): DeploymentApplyStats {
  const stats: DeploymentApplyStats = { linked: 0, enriched: 0 };
  if (index.entries === 0) return stats;

  for (const m of mods) {
    const link = lookupLink(m, index);
    if (!link) continue;

    let enrichedThis = false;
    const meta = resolveStagingMeta(link, state);
    if (meta) {
      if (!m.nexusGameDomain) m.nexusGameDomain = link.gameId;
      if (applyStateMetaToMod(m, meta)) enrichedThis = true;
      const zip = meta.downloadFileName
        ? vortexDownloadZipPath(link.gameId, meta.downloadFileName)
        : undefined;
      if (zip) addAlternatePath(m, zip);
    } else {
      const parsed = parseNexusIdFromVortexModKey(link.stagingFolder);
      if (parsed && !m.nexusModId) {
        m.nexusModId = parsed;
        m.nexusGameDomain = m.nexusGameDomain ?? link.gameId;
        if (m.source === 'local' || m.source === 'unknown') m.source = 'nexus';
        enrichedThis = true;
      }
    }

    stats.linked += 1;
    if (enrichedThis) stats.enriched += 1;

    const staging = link.stagingFilePath;
    if (staging && fs.existsSync(staging)) addAlternatePath(m, staging);
  }

  return stats;
}
