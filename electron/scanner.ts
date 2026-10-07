import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ModRecord, ScanOptions, ScanProgressEvent, ScanReport } from '../shared/types';
import { gameBySteamAppId } from './gamesRegistry';
import { gameIdFromCommonFolder, gameIdFromVortexFolder } from './gamePathMap';
import { discoverSteamLibraries, findGameInstallFolders } from './steamDiscovery';
import { COMMON_FOLDER_TO_GAME_ID } from './gamePathMap';
import { folderSizeBytes, findPreviewInTree, parseModFolder } from './modMetadata';
import { fetchWorkshopDetailsWithStats } from './workshopApi';
import { nexusMetaToMod, scanPathForNexusMeta } from './nexusScanMeta';
import { scanConfiguredVortexStagingRoots, scanVortexInstalledModFolders } from './vortexModsScanner';
import { resolveSteamCreatorNames, formatCreatorDisplay } from './steamCreators';
import { applyDuplicateHints } from './dedupeMods';
import { enrichModsWithNexusApi, hydrateNexusFieldsFromPrevious } from './nexusModDetails';
import { applyWorkshopArchive, rememberWorkshopDetails } from './workshopArchive';
import { scanVortexMetadb } from './vortexMetadbScanner';
import { syncArchiveVault } from './archiveVault';
import { readWorkshopAcf } from './workshopAcf';
import {
  attachZipPathsFromIndex,
  buildDownloadArchiveIndex,
  linkDeployedArchivesToVortexDownloads,
} from './vortexDownloadArchiveIndex';
import { splitWorkshopTags } from './workshopTags';
import { scanVortexStateModMeta } from './vortexStateScanner';
import { refreshModsVortexCorrelation } from './vortexCatalogRefresh';

export { discoverSteamLibraries };

function stableId(parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
}

function readWorkshopAcfTimeUpdated(acfPath: string, workshopId: string): string | undefined {
  try {
    const text = fs.readFileSync(acfPath, 'utf8');
    const blockRe = new RegExp(`"${workshopId}"\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, 'm');
    const m = text.match(blockRe);
    if (!m) return undefined;
    const tm = m[1].match(/"TimeUpdated"\s*"(\d+)"/i);
    return tm ? tm[1] : undefined;
  } catch {
    return undefined;
  }
}

export type ScanProgressCallback = (event: ScanProgressEvent) => void;

export async function scanAllMods(
  steamLibraries: string[],
  extraPaths: string[],
  options: ScanOptions = {},
  onProgress?: ScanProgressCallback,
  /** Last saved catalog: lets the Nexus fill-in reuse what it already fetched. */
  previousMods: ModRecord[] = [],
): Promise<{ mods: ModRecord[]; report: ScanReport }> {
  const started = Date.now();
  const mods: ModRecord[] = [];
  const seenPaths = new Set<string>();
  const locationCounts = new Map<string, { label: string; path: string; count: number }>();

  const tick = (phase: string, message: string, current?: number, total?: number) => {
    onProgress?.({
      phase,
      message,
      current,
      total,
      percent: total && total > 0 && current != null ? Math.round((current / total) * 100) : undefined,
    });
  };

  const noteLocation = (label: string, rootPath: string) => {
    const key = `${label}|${rootPath}`;
    const cur = locationCounts.get(key) ?? { label, path: rootPath, count: 0 };
    cur.count += 1;
    locationCounts.set(key, cur);
  };

  const addMod = (record: ModRecord, locationLabel?: string, locationRoot?: string) => {
    const pathKey = record.localPath?.toLowerCase();
    if (pathKey) {
      if (seenPaths.has(`path|${pathKey}`)) return;
      seenPaths.add(`path|${pathKey}`);
    }
    if (record.workshopId) {
      const wsKey = `ws|${record.steamAppId ?? record.gameId}|${record.workshopId}`;
      if (seenPaths.has(wsKey)) return;
      seenPaths.add(wsKey);
    }
    mods.push(record);
    if (locationLabel && locationRoot) noteLocation(locationLabel, locationRoot);
  };

  tick('libraries', `Scanning ${steamLibraries.length} Steam library folder(s)...`);
  let libIndex = 0;
  for (const lib of steamLibraries) {
    libIndex += 1;
    tick('workshop', `Workshop: ${lib}`, libIndex, steamLibraries.length);
    const workshopRoot = path.join(lib, 'steamapps', 'workshop', 'content');
    if (!fs.existsSync(workshopRoot)) continue;

    let appDirs: fs.Dirent[];
    try {
      appDirs = fs.readdirSync(workshopRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const appDir of appDirs) {
      if (!appDir.isDirectory()) continue;
      const appId = Number(appDir.name);
      if (!Number.isFinite(appId)) continue;
      const game = gameBySteamAppId(appId);
      const gameId = game?.id ?? `steam-${appId}`;
      const acfPath = path.join(lib, 'steamapps', 'workshop', `appworkshop_${appId}.acf`);

      const itemRoot = path.join(workshopRoot, appDir.name);
      let items: fs.Dirent[];
      try {
        items = fs.readdirSync(itemRoot, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const item of items) {
        if (!item.isDirectory()) continue;
        const workshopId = item.name;
        const localPath = path.join(itemRoot, workshopId);
        const stat = fs.statSync(localPath);
        const meta = parseModFolder(localPath);
        const acfItem = readWorkshopAcf(acfPath).get(workshopId);
        // Steam writes "timeupdated" (lowercase); the old helper looked for "TimeUpdated" and fell back to folder mtime.
        const timeUpdated = acfItem?.timeUpdated ?? readWorkshopAcfTimeUpdated(acfPath, workshopId);

        let previewPath = meta.previewPath ?? meta.iconPath ?? findPreviewInTree(localPath);
        const steamPreview = path.join(localPath, 'preview.jpg');
        if (!previewPath && fs.existsSync(steamPreview)) previewPath = steamPreview;
        addMod(
          {
          id: stableId(['workshop', String(appId), workshopId, localPath]),
          source: 'steam-workshop',
          gameId,
          steamAppId: appId,
          title: meta.title ?? `Workshop ${workshopId}`,
          author: meta.author,
          description: meta.description,
          version: meta.version,
          localPath,
          workshopId,
          modIds: meta.modIds,
          iconPath: meta.iconPath ?? previewPath,
          previewPath,
          sizeBytes: options.deepSize ? folderSizeBytes(localPath) : undefined,
          installedAt: stat.mtime.toISOString(),
          lastSeenAt: new Date().toISOString(),
          favorited: false,
          subscribed: acfItem ? acfItem.subscribed : true,
          steamSubscribed: acfItem?.subscribed,
          revision: {
            kind: 'workshop_time_updated',
            value: timeUpdated ?? String(Math.floor(stat.mtime.getTime() / 1000)),
          },
          tags: game ? [game.name] : [`App ${appId}`],
        },
          `Workshop app ${appId}`,
          localPath,
        );
      }
    }

    const commonRoot = path.join(lib, 'steamapps', 'common');
    if (fs.existsSync(commonRoot)) {
      scanGameModFolders(commonRoot, addMod);
    }
  }

  tick('extra', 'Extra scan paths...');
  for (const extra of extraPaths) {
    if (!extra || !fs.existsSync(extra)) continue;
    scanTreeForMods(extra, addMod, 'unknown', slugify(path.basename(extra)), 'extra');
  }

  tick('vortex', 'Vortex staging & downloads...');
  const vortexState = await scanVortexStateModMeta();
  scanVortexInstalledModFolders(addMod);
  scanConfiguredVortexStagingRoots(addMod);
  scanVortexStaging(addMod);
  scanVortexDownloads(addMod);
  scanVortexGameMods(addMod);
  scanNexusDownloadMeta(addMod);

  tick('vortex-meta', 'Vortex metadb (Nexus downloads + pictures)...');
  try {
    const v = syncArchiveVault();
    console.log(`[Mod Hub] archive vault: ${v.linked} new hard links, ${v.already} already safe, ${v.skipped} on another drive, ${v.errors} errors`);
  } catch (e) {
    console.warn('[Mod Hub] archive vault sync failed:', e);
  }
  await scanVortexMetadb(addMod, (current) => {
    if (current % 500 === 0) tick('vortex-meta', `Vortex metadb rows... (${current})`, current);
  });

  tick('discover', 'Searching other drives for game installs...');
  const gameFolderNames = Object.keys(COMMON_FOLDER_TO_GAME_ID);
  for (const installRoot of findGameInstallFolders(gameFolderNames, 5)) {
    const base = path.basename(installRoot);
    const gameId = gameIdFromCommonFolder(base);
    if (base === 'Cyberpunk 2077') scanCyberpunk2077(installRoot, gameId, addMod);
    else if (gameId === 'binding-of-isaac') scanIsaacGameMods(path.join(installRoot, 'mods'), addMod);
    else {
      for (const modFolderName of ['Mods', 'mods']) {
        const modsPath = path.join(installRoot, modFolderName);
        if (fs.existsSync(modsPath)) scanTreeForMods(modsPath, addMod, 'local', gameId, base);
      }
    }
  }

  let workshopEnrich: import('../shared/types').WorkshopEnrichStats | undefined;

  if (options.enrichWorkshop !== false) {
    const wsIds = mods.filter((m) => m.workshopId).map((m) => m.workshopId!);
    const wsTotal = wsIds.length;
    tick('enrich', `Workshop metadata: 0/${wsTotal} (API batches)...`, 0, wsTotal);
    const { map: details, failedChunks } = await fetchWorkshopDetailsWithStats(wsIds, ({ fetched, total, chunk, chunkTotal }) => {
      tick(
        'enrich',
        `Workshop API batch ${chunk}/${chunkTotal} (${fetched}/${total} ids)...`,
        fetched,
        total,
      );
    });
    tick('enrich', `Applying Workshop metadata to ${wsTotal} local items...`, 0, wsTotal);
    let appliedToMods = 0;
    for (const m of mods) {
      if (!m.workshopId) continue;
      const d = details.get(m.workshopId);
      if (!d) {
        m.workshopHidden = true;
        continue;
      }
      if (d.result != null && d.result !== 1) {
        m.workshopHidden = true;
        continue;
      }
      m.workshopHidden = false;
      if (d.creator) {
        m.author = d.creator;
        if (/^\d{10,}$/.test(d.creator.trim())) m.authorSteamId = d.creator.trim();
      }
      if (d.title && (m.title.startsWith('Workshop ') || /^\d+$/.test(m.title.trim()) || /^#/.test(m.title.trim()) || !m.title)) {
        m.title = d.title;
      }
      m.remoteUpdatedAt =
        d.time_updated && d.time_updated > 0 ? new Date(d.time_updated * 1000).toISOString() : undefined;
      m.remoteCreatedAt =
        d.time_created && d.time_created > 0 ? new Date(d.time_created * 1000).toISOString() : undefined;
      if (d.tags?.length) {
        const tagSplit = splitWorkshopTags(d.tags);
        m.gameVersionTags = tagSplit.gameVersions.length ? tagSplit.gameVersions : undefined;
        m.workshopCategories = tagSplit.categories.length ? tagSplit.categories : undefined;
      }
      if (d.preview_url) m.remotePreviewUrl = d.preview_url;
      if (d.file_size && !m.sizeBytes) m.sizeBytes = d.file_size;
      if (!m.sizeBytes && m.localPath && fs.existsSync(m.localPath)) {
        try {
          const st = fs.statSync(m.localPath);
          if (st.isDirectory()) m.sizeBytes = folderSizeBytes(m.localPath);
          else m.sizeBytes = st.size;
        } catch {
          /* ignore */
        }
      }
      const localTs = Number(m.revision.value);
      m.revision.remoteValue = String(d.time_updated);
      m.revision.updateAvailable = Number.isFinite(localTs) && d.time_updated > localTs;
      appliedToMods += 1;
      if (appliedToMods % 50 === 0) tick('enrich', `Workshop metadata...`, appliedToMods, wsTotal);
    }
    applyWorkshopPreviewFallbacks(mods);
    for (const m of mods) {
      if (m.source !== 'steam-workshop' || !m.workshopId) continue;
      const d = details.get(m.workshopId);
      if (!d || (d.result != null && d.result !== 1)) m.workshopHidden = true;
    }

    workshopEnrich = {
      workshopIds: wsTotal,
      detailsFetched: details.size,
      appliedToMods,
      failedApiChunks: failedChunks,
    };
    tick(
      'enrich',
      `Workshop enrich: ${details.size}/${wsTotal} API hits, ${appliedToMods} mods updated`,
      appliedToMods,
      wsTotal,
    );

    const creatorIds = mods.filter((m) => m.authorSteamId).map((m) => m.authorSteamId!);
    if (creatorIds.length > 0) {
      tick('enrich', 'Resolving Steam creator display names...');
      const names = await resolveSteamCreatorNames(creatorIds);
      for (const m of mods) {
        if (!m.authorSteamId) continue;
        const display = formatCreatorDisplay(m.authorSteamId, names);
        if (display && display !== m.authorSteamId) {
          m.authorDisplayName = display;
          m.author = display;
        }
      }
    }
  }

  tick('enrich', 'Indexing Vortex downloads (zip + 7z via 7-Zip, inner .archive names)...');
  const indexCachePath = path.join(process.env.APPDATA ?? '', 'mod-hub', 'download-archive-index.json');
  const archiveZipIndex = buildDownloadArchiveIndex((current, total) => {
    if (current % 25 === 0 || current === total) {
      tick('enrich', `Download archive index: ${current}/${total}...`, current, total);
    }
  }, indexCachePath);
  const zipLinked = linkDeployedArchivesToVortexDownloads(mods, archiveZipIndex);
  const zipPaths = attachZipPathsFromIndex(mods, archiveZipIndex);
  if (zipLinked > 0 || zipPaths > 0) {
    tick(
      'enrich',
      `Archive↔download: ${zipLinked} Nexus link(s), ${zipPaths} zip path(s) on existing Nexus rows`,
    );
  }

  tick('enrich', 'Vortex deployment manifest + state (archive ↔ zip ↔ Nexus)...');
  const correlation = await refreshModsVortexCorrelation(mods, vortexState);
  if (correlation.deployment.linked > 0 || correlation.stateApplied > 0) {
    tick(
      'enrich',
      `Deployment: ${correlation.deployment.linked} file link(s), ${correlation.deployment.enriched} enriched; merged ${correlation.mergedCount} duplicate row(s); state ${correlation.stateApplied} field(s)`,
    );
  }

  if (options.nexusApiKey?.trim()) {
    const reused = hydrateNexusFieldsFromPrevious(mods, previousMods);
    tick('enrich', `Nexus API fill-in (reused saved details for ${reused} mod(s); only missing data is fetched)...`);
    const apiResult = await enrichModsWithNexusApi(mods, options.nexusApiKey, (current, total) => {
      if (current % 10 === 0 || current === total) {
        tick('enrich', `Nexus API fill-in: ${current}/${total}...`, current, total);
      }
    });
    if (apiResult.called === 0) tick('enrich', 'Nexus API: nothing missing, no calls needed.');
    if (apiResult.skipped > 0) {
      tick(
        'enrich',
        `Nexus API: ${apiResult.called} calls this scan; ${apiResult.skipped} still missing (rescan or raise cap in settings later).`,
      );
    }
  }

  // Remember live Workshop details; give removed/hidden items their last known author, dates and image.
  try {
    rememberWorkshopDetails(mods);
    applyWorkshopArchive(mods);
  } catch (e) {
    console.warn('[Mod Hub] workshop archive failed:', e);
  }

  applyDuplicateHints(mods);

  const sorted = mods.sort((a, b) => a.title.localeCompare(b.title));
  const bySource: Record<string, number> = {};
  const byGame: Record<string, number> = {};
  for (const m of sorted) {
    bySource[m.source] = (bySource[m.source] ?? 0) + 1;
    byGame[m.gameId] = (byGame[m.gameId] ?? 0) + 1;
  }

  const report: ScanReport = {
    libraries: steamLibraries,
    locations: [...locationCounts.values()].sort((a, b) => b.count - a.count),
    bySource,
    byGame,
    durationMs: Date.now() - started,
    workshopEnrich,
  };

  tick('done', `Indexed ${sorted.length} items in ${Math.round(report.durationMs! / 1000)}s`);
  return { mods: sorted, report };
}

function scanGameModFolders(commonRoot: string, addMod: (m: ModRecord) => void) {
  let games: fs.Dirent[];
  try {
    games = fs.readdirSync(commonRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const g of games) {
    if (!g.isDirectory()) continue;
    const gameId = gameIdFromCommonFolder(g.name);
    const gameRoot = path.join(commonRoot, g.name);
    if (g.name === 'Cyberpunk 2077') scanCyberpunk2077(gameRoot, gameId, addMod);
    for (const modFolderName of ['Mods', 'mods']) {
      const modsPath = path.join(gameRoot, modFolderName);
      if (!fs.existsSync(modsPath)) continue;
      scanTreeForMods(modsPath, addMod, 'local', gameId, g.name);
    }
  }
}

function scanCyberpunk2077(gameRoot: string, gameId: string, addMod: (m: ModRecord) => void) {
  const archiveDir = path.join(gameRoot, 'archive', 'pc', 'mod');
  if (fs.existsSync(archiveDir)) {
    try {
      const files = fs.readdirSync(archiveDir, { withFileTypes: true });
      for (const f of files) {
        if (!f.isFile() || !f.name.toLowerCase().endsWith('.archive')) continue;
        const localPath = path.join(archiveDir, f.name);
        const stat = fs.statSync(localPath);
        const title = f.name.replace(/\.archive$/i, '');
        addMod(
          {
            id: stableId(['cp-archive', localPath]),
            source: 'local',
            gameId,
            title,
            localPath,
            sizeBytes: stat.size,
            installedAt: stat.mtime.toISOString(),
            lastSeenAt: new Date().toISOString(),
            favorited: false,
            steamAppId: 1091500,
            revision: { kind: 'folder_mtime', value: String(Math.floor(stat.mtime.getTime() / 1000)) },
            tags: ['Cyberpunk 2077', 'archive'],
          },
          'Cyberpunk 2077 archives',
          archiveDir,
        );
      }
    } catch {
      /* ignore */
    }
  }
  const redModDir = path.join(gameRoot, 'mods');
  if (fs.existsSync(redModDir)) scanTreeForMods(redModDir, addMod, 'local', gameId, 'Cyberpunk 2077');
}

function scanTreeForMods(
  root: string,
  addMod: (m: ModRecord) => void,
  source: ModRecord['source'],
  gameId: string,
  label: string,
) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const localPath = path.join(root, e.name);
    if (!looksLikeModFolder(localPath)) continue;
    const meta = parseModFolder(localPath);
    const stat = fs.statSync(localPath);
    const previewPath = meta.previewPath ?? meta.iconPath ?? findPreviewInTree(localPath);
    addMod(
      {
      id: stableId(['local', localPath]),
      source,
      gameId,
      title: meta.title ?? e.name,
      author: meta.author,
      description: meta.description,
      version: meta.version,
      localPath,
      modIds: meta.modIds,
      iconPath: meta.iconPath ?? previewPath,
      previewPath,
      installedAt: stat.mtime.toISOString(),
      lastSeenAt: new Date().toISOString(),
      favorited: false,
      revision: {
        kind: 'folder_mtime',
        value: String(Math.floor(stat.mtime.getTime() / 1000)),
      },
      tags: [label],
    },
      label,
      root,
    );
  }
}

function decodeXmlEntities(v: string | undefined): string | undefined {
  return v
    ?.replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Best cover image in an Isaac mod's top folder: thumb.png, then cover/preview-named, then PNGs, then any image. */
function isaacCoverImage(modDir: string): string | undefined {
  let files: string[];
  try {
    files = fs
      .readdirSync(modDir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name);
  } catch {
    return undefined;
  }
  const images = files.filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f));
  // thumb.png is the Workshop thumbnail the uploader shipped with the mod: the real cover when present.
  const pick =
    images.find((f) => f.toLowerCase() === 'thumb.png') ??
    images.find((f) => /cover|thumb|preview|banner|logo|icon/i.test(f)) ??
    images.find((f) => /\.png$/i.test(f)) ??
    images[0];
  return pick ? path.join(modDir, pick) : undefined;
}

/**
 * Isaac copies every subscribed Workshop mod into game\mods\<name>_<workshopId> and keeps that copy (still loaded)
 * after you unsubscribe or the author renames the mod. Subscribed ones are already rows (the Workshop pass runs
 * first, and addMod dedupes by Workshop id); this adds the leftovers so they get cards. With the Workshop id set,
 * the Workshop API enrich step fills in the image, author and dates.
 */
function scanIsaacGameMods(modsDir: string, addMod: (m: ModRecord) => void) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(modsDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    // Mod Hub's own kept copies come back from the saved catalog (they keep their kept metadata).
    if (/\(kept( \d+)?\)$/i.test(e.name)) continue;
    const localPath = path.join(modsDir, e.name);
    const metaFile = path.join(localPath, 'metadata.xml');
    if (!fs.existsSync(metaFile)) continue;
    let xml = '';
    try {
      xml = fs.readFileSync(metaFile, 'utf8');
    } catch {
      continue;
    }
    const tag = (t: string) =>
      decodeXmlEntities(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, 'i').exec(xml)?.[1]?.trim()) || undefined;
    const workshopId = tag('id') ?? /_(\d{6,})$/.exec(e.name)?.[1];
    const stat = fs.statSync(localPath);
    // A cover-ish image in the mod's top folder (not a random sprite from resources/), else the first [img] in
    // the description; Steam has nothing for mods removed from the Workshop.
    const previewPath = isaacCoverImage(localPath);
    const description = tag('description');
    const remotePreviewUrl = previewPath
      ? undefined
      : /\[img\]\s*(https?:\/\/[^\s[]+?)\s*\[\/img\]/i.exec(description ?? '')?.[1];
    addMod(
      {
        id: stableId(['isaac-game', localPath]),
        source: 'local',
        gameId: 'binding-of-isaac',
        steamAppId: 250900,
        workshopId,
        remotePreviewUrl,
        title: tag('name') ?? e.name.replace(/_\d+$/, ''),
        description,
        version: tag('version'),
        localPath,
        iconPath: previewPath,
        previewPath,
        installedAt: stat.mtime.toISOString(),
        lastSeenAt: new Date().toISOString(),
        favorited: false,
        revision: { kind: 'folder_mtime', value: String(Math.floor(stat.mtime.getTime() / 1000)) },
        sizeBytes: folderSizeBytes(localPath),
        tags: ['isaac-game-copy'],
      },
      'Isaac mods folder (not subscribed)',
      modsDir,
    );
  }
}

function looksLikeModFolder(dir: string): boolean {
  const markers = ['mod.info', 'About.xml', 'meta.ini', 'manifest.json'];
  for (const m of markers) {
    if (fs.existsSync(path.join(dir, m))) return true;
    if (fs.existsSync(path.join(dir, 'About', m))) return true;
  }
  return false;
}

function scanVortexStaging(addMod: (m: ModRecord) => void) {
  const appData = process.env.APPDATA;
  if (!appData) return;
  const staging = path.join(appData, 'Vortex', 'staging');
  if (!fs.existsSync(staging)) return;
  let games: fs.Dirent[];
  try {
    games = fs.readdirSync(staging, { withFileTypes: true });
  } catch {
    return;
  }
  for (const g of games) {
    if (!g.isDirectory()) continue;
    const gameStaging = path.join(staging, g.name);
    const gameId = gameIdFromVortexFolder(g.name);
    scanTreeForMods(gameStaging, addMod, 'vortex-staging', gameId, `vortex:${g.name}`);
    scanVortexStagingTopLevel(gameStaging, addMod, gameId, g.name);
  }
}

/** Staging folders often lack mod.info/About.xml; still count as Vortex deploy targets. */
function scanVortexStagingTopLevel(
  gameStaging: string,
  addMod: (m: ModRecord) => void,
  gameId: string,
  vortexFolder: string,
) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(gameStaging, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const localPath = path.join(gameStaging, e.name);
    if (looksLikeModFolder(localPath)) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(localPath);
    } catch {
      continue;
    }
    const match = e.name.match(/^(\d{1,10})\s*[-–—]\s*(.+)$/);
    const nexusModId = match ? Number(match[1]) : undefined;
    const title = match ? match[2].trim() : e.name;
    const previewPath = findPreviewInTree(localPath);
    addMod(
      {
        id: stableId(['vortex-staging', vortexFolder, e.name, localPath]),
        source: 'vortex-staging',
        gameId,
        title,
        localPath,
        nexusModId,
        nexusGameDomain: nexusModId ? vortexFolder.toLowerCase() : undefined,
        previewPath,
        iconPath: previewPath,
        installedAt: stat.mtime.toISOString(),
        lastSeenAt: new Date().toISOString(),
        favorited: false,
        revision: { kind: 'folder_mtime', value: String(Math.floor(stat.mtime.getTime() / 1000)) },
        tags: ['vortex-staging', vortexFolder],
      },
      `vortex-staging:${vortexFolder}`,
      gameStaging,
    );
  }
}

function scanVortexDownloads(addMod: (m: ModRecord) => void) {
  const appData = process.env.APPDATA;
  if (!appData) return;
  const downloads = path.join(appData, 'Vortex', 'downloads');
  if (!fs.existsSync(downloads)) return;
  try {
    const entries = fs.readdirSync(downloads, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      scanTreeForMods(path.join(downloads, e.name), addMod, 'vortex-staging', 'unknown', `vortex-dl:${e.name}`);
    }
  } catch {
    /* ignore */
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

/** Reuse preview art from a sibling workshop folder (same author pack). */
function applyWorkshopPreviewFallbacks(mods: ModRecord[]) {
  const byParent = new Map<string, ModRecord[]>();
  for (const m of mods) {
    if (m.source !== 'steam-workshop') continue;
    const parent = path.dirname(m.localPath).toLowerCase();
    const list = byParent.get(parent) ?? [];
    list.push(m);
    byParent.set(parent, list);
  }
  for (const group of byParent.values()) {
    const donor = group.find((x) => x.previewPath || x.remotePreviewUrl || x.iconPath);
    if (!donor) continue;
    for (const m of group) {
      if (m.previewPath || m.remotePreviewUrl) continue;
      if (donor.previewPath) m.previewPath = donor.previewPath;
      else if (donor.iconPath) m.iconPath = donor.iconPath;
      else if (donor.remotePreviewUrl) m.remotePreviewUrl = donor.remotePreviewUrl;
    }
  }
}

function scanNexusDownloadMeta(addMod: (m: ModRecord, locationLabel?: string, locationRoot?: string) => void) {
  const appData = process.env.APPDATA;
  if (!appData) return;
  const vortexRoot = path.join(appData, 'Vortex');
  const metaHits: import('./nexusScanMeta').NexusMetaHit[] = [];
  scanPathForNexusMeta(path.join(vortexRoot, 'downloads'), 'vortex-downloads', metaHits);
  scanPathForNexusMeta(path.join(vortexRoot, 'meta'), 'vortex-meta', metaHits);
  scanPathForNexusMeta(path.join(vortexRoot, 'staging'), 'vortex-staging-meta', metaHits);
  if (fs.existsSync(vortexRoot)) {
    try {
      for (const e of fs.readdirSync(vortexRoot, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const skip = ['staging', 'downloads', 'logs', 'temp', 'plugins', 'cache', 'meta', 'state'];
        if (skip.includes(e.name.toLowerCase())) continue;
        scanPathForNexusMeta(path.join(vortexRoot, e.name), `vortex-game:${e.name}`, metaHits);
      }
    } catch {
      /* ignore */
    }
  }
  const seenNexusMeta = new Set<string>();
  for (const hit of metaHits) {
    const metaKey = `${hit.nexusGameDomain}|${hit.nexusModId}`;
    if (seenNexusMeta.has(metaKey)) continue;
    seenNexusMeta.add(metaKey);
    const mod = nexusMetaToMod(hit);
    const preview = findPreviewInTree(hit.localPath);
    if (preview) {
      mod.previewPath = preview;
      mod.iconPath = preview;
    }
    addMod(mod, 'Nexus/Vortex meta', hit.localPath);
  }
}

function scanVortexGameMods(addMod: (m: ModRecord, locationLabel?: string, locationRoot?: string) => void) {
  const appData = process.env.APPDATA;
  if (!appData) return;
  const vortexRoot = path.join(appData, 'Vortex');
  if (!fs.existsSync(vortexRoot)) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(vortexRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (['staging', 'downloads', 'logs', 'temp'].includes(e.name.toLowerCase())) continue;
    const modsPath = path.join(vortexRoot, e.name, 'mods');
    if (!fs.existsSync(modsPath)) continue;
    const gameId = gameIdFromVortexFolder(e.name);
    scanTreeForMods(modsPath, addMod, 'nexus', gameId, `vortex-mods:${e.name}`);
  }
}
