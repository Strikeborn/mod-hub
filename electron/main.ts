import type { GameRecord } from '../shared/types';
import { app, BrowserWindow, ipcMain, shell, dialog, session, webContents, screen, protocol } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CatalogStore } from './catalogStore';
import { discoverSteamLibraries, scanAllMods } from './scanner';
import { fetchWorkshopDetails, workshopItemUrl, workshopSubscribeUrl } from './workshopApi';
import { queryWorkshopBrowse } from './workshopBrowse';
import { listInstalledSteamAppIds } from './steamLibraryApps';
import { GAMES_REGISTRY, gameById, gameBySteamAppId } from './gamesRegistry';
import { steamAppDisplayName } from './steamAppNames';
import { diskCachedThumbnail } from './thumbDiskCache';
import { pzDefaultModsFile, readLoadOrders } from './loadOrder';
import { planPzOrder } from './pzDeps';
import { enforceLuaDebugOff, isaacLuaDebugState } from './luaGuard';
import { backgroundSecurityPass, checkMod, initSecurityStore, lastSweep, recordSweep, securityOverview, securityReport } from './modSecurity';
import { defenderSweep } from './defenderSweep';
import { findMo2Instances, launchPlayOption, playOptions, steamUpdateState } from './playPaths';
import { analyzeIsaacConflicts } from './isaacConflicts';
import { applyWorkshopArchive } from './workshopArchive';
import { findWorkshopReuploads, refreshWorkshopVotes } from './workshopCommunity';
import { checkNexusUpdates } from './nexusUpdates';
import { PLAY_EXE, isRunning, setIsaacFolderEnabled, setLoadOrder, setModsEnabled } from './loadOrderWrite';
import { planRimworldOrder, readRimworldActive } from './rimworldSort';
import {
  applyLoadout,
  applyLoadoutToPzSave,
  deleteLoadout,
  exportLoadoutCode,
  getLoadouts,
  importLoadoutCode,
  saveCurrentLoadout,
  updateLoadout,
} from './loadouts';
import { keepWorkshopCopy, keptModId, runSteamWorkshopAction, runSteamWorkshopBatch } from './workshopActions';
import { getModChanges } from './modChanges';
import { findCrossPlatform } from './crossPlatform';
import { syncArchiveVault } from './archiveVault';
import { getModMedia } from './modMedia';
import { enrichModsWithNexusApi } from './nexusModDetails';
import { applyWorkshopSubscriptionState } from './workshopAcf';

/** Registry games plus a named entry for every other game id the catalog contains. */
function catalogGamesFor(mods: { gameId: string; steamAppId?: number }[]): GameRecord[] {
  const games: GameRecord[] = [...GAMES_REGISTRY];
  const known = new Set(games.map((g) => g.id));
  for (const m of mods) {
    if (known.has(m.gameId)) continue;
    known.add(m.gameId);
    const steam = /^steam-(\d+)$/.exec(m.gameId);
    const appId = steam ? Number(steam[1]) : m.steamAppId;
    if (appId) games.push({ id: m.gameId, name: steamAppDisplayName(appId), steamAppId: appId });
  }
  return games;
}
import { ensureInjectionFileOnDisk, injectionProtocolPath } from './prepareInjection';
import {
  buildEnhancerUpdateScript,
  buildFileInjectionLoaderScript,
  buildInjectionLoaderScript,
  parseNexusBrowseUrl,
} from './nexusEnhancerConfig';
import { loadBrowseInjectionScript } from './browseInjection';
import { executeInjectionScript } from './injectScript';
import { waitForBrowseEnhancer } from './injectProbe';
import { fetchRemoteThumbnailDataUrl } from './remoteThumbnail';
import { isGuess404NexusThumb } from './nexusImageIds';
import { emptyVortexStateIndex, scanVortexStateModMeta } from './vortexStateScanner';
import { refreshModsVortexCorrelation } from './vortexCatalogRefresh';
import type { ModRecord } from '../shared/types';
import { sanitizeIsoDate } from '../shared/modDates';
import { spawn } from 'node:child_process';
import { hasSteamWorkshopBrowse } from './workshopSupport';
import {
  nexusModPageUrl,
  nexusNxmUrl,
  trackMod,
  fetchAllTrackedMods,
  validateNexusKey,
  fetchTrackedModIds,
} from './nexusApi';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same data folder for the installed app ("Mod Hub") and dev builds ("mod-hub"): %APPDATA%\mod-hub.
app.setPath('userData', path.join(app.getPath('appData'), 'mod-hub'));

let store: CatalogStore;
let mainWindow: BrowserWindow | null = null;

// DevTools only in the Vite dev mode (tools/start-mod-hub.ps1 -Dev); the normal launch runs the built app.
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'modhub-inject',
    privileges: {
      standard: true,
      secure: true,
      bypassCSP: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

/** Stable key for "removed from Mod Hub" (survives rescans that regenerate row ids). */
function dismissKey(m: { id: string; nexusModId?: number; nexusGameDomain?: string }): string {
  return m.nexusModId && m.nexusGameDomain ? `${m.nexusGameDomain.toLowerCase()}|${m.nexusModId}` : m.id;
}

function folderSize(dir: string): number {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    try {
      total += e.isDirectory() ? folderSize(p) : fs.statSync(p).size;
    } catch {
      /* ignore */
    }
  }
  return total;
}

let devToolsWindow: BrowserWindow | null = null;

/** Dev only: DevTools in its own maximized window behind Mod Hub. */
function openDevToolsIfDev(win: BrowserWindow) {
  if (!isDev) return;
  try {
    devToolsWindow = new BrowserWindow({
      title: 'Mod Hub DevTools',
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#202124',
      opacity: 0,
    });
    devToolsWindow.on('closed', () => {
      devToolsWindow = null;
    });
    win.on('closed', () => {
      if (devToolsWindow && !devToolsWindow.isDestroyed()) devToolsWindow.close();
    });
    win.webContents.setDevToolsWebContents(devToolsWindow.webContents);
    win.webContents.openDevTools({ mode: 'detach', activate: false });
    // Show invisibly, push it behind Mod Hub, then fade it in so it never flashes over the app.
    devToolsWindow.maximize();
    devToolsWindow.showInactive();
    win.moveTop();
    win.focus();
    const dt = devToolsWindow;
    setTimeout(() => {
      if (!dt.isDestroyed()) dt.setOpacity(1);
      if (!win.isDestroyed()) {
        win.moveTop();
        win.focus();
      }
    }, 400);
  } catch (e) {
    console.warn('[Mod Hub] openDevTools failed:', e);
  }
}

function resolvePreloadPath(): string {
  for (const name of ['preload.cjs', 'preload.js', 'preload.mjs']) {
    const p = path.join(__dirname, name);
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, 'preload.cjs');
}

function createWindow() {
  const preload = resolvePreloadPath();
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: sw,
    height: sh,
    minWidth: 960,
    minHeight: 640,
    title: 'Mod Hub',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[Mod Hub] Preload failed:', preloadPath, error);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize();
    mainWindow?.setFullScreen(true);
    mainWindow?.show();
    mainWindow?.focus();
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) openDevToolsIfDev(mainWindow);
    }, 600);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function relaxNexusCsp(ses: Electron.Session) {
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.includes('nexusmods.com')) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    const headers = { ...details.responseHeaders };
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-security-policy') delete headers[key];
    }
    callback({ responseHeaders: headers });
  });
}

function registerInjectionProtocol(partition: string) {
  const ses = session.fromPartition(partition);
  relaxNexusCsp(ses);
  if (ses.protocol.isProtocolRegistered('modhub-inject')) return;
  ses.protocol.registerFileProtocol('modhub-inject', (request, callback) => {
    if (!request.url.includes('browse.js')) {
      callback({ error: -2 });
      return;
    }
    const p = injectionProtocolPath();
    if (p) callback({ path: p });
    else callback({ error: -2 });
  });
}

app.on('session-created', (ses) => {
  relaxNexusCsp(ses);
  if (ses.protocol.isProtocolRegistered('modhub-inject')) return;
  ses.protocol.registerFileProtocol('modhub-inject', (request, callback) => {
    if (!request.url.includes('browse.js')) {
      callback({ error: -2 });
      return;
    }
    const p = injectionProtocolPath();
    if (p) callback({ path: p });
    else callback({ error: -2 });
  });
});

app.whenReady().then(() => {
  registerInjectionProtocol('persist:modhub-nexus-injected');
  registerInjectionProtocol('');
  store = new CatalogStore(app.getPath('userData'));
  initSecurityStore(app.getPath('userData'));
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let vortexStateCache: { mtimeMs: number; index: Awaited<ReturnType<typeof scanVortexStateModMeta>> } | null =
  null;

function stripImplausibleModDates(m: ModRecord): boolean {
  let changed = false;
  const fields = ['remoteCreatedAt', 'remoteUpdatedAt', 'installedAt', 'downloadedAt'] as const;
  for (const key of fields) {
    const next = sanitizeIsoDate(m[key]);
    if (m[key] !== next) {
      m[key] = next;
      changed = true;
    }
  }
  return changed;
}

const localThumbnailCache = new Map<string, { mtimeMs: number; dataUrl: string | null }>();

async function getCachedVortexStateIndex() {
  const appData = process.env.APPDATA;
  if (!appData) return emptyVortexStateIndex();
  const statePath = path.join(appData, 'Vortex', 'state.v2');
  if (!fs.existsSync(statePath)) return emptyVortexStateIndex();
  const mtimeMs = fs.statSync(statePath).mtimeMs;
  if (vortexStateCache?.mtimeMs === mtimeMs) return vortexStateCache.index;
  // Two callers at once (e.g. the window loading the catalog twice) must share one DB read:
  // opening Vortex's LevelDB twice in parallel closes the first iterator mid-read.
  if (vortexStateLoading?.mtimeMs === mtimeMs) return vortexStateLoading.promise;
  const promise = scanVortexStateModMeta();
  vortexStateLoading = { mtimeMs, promise };
  try {
    const index = await promise;
    vortexStateCache = { mtimeMs, index };
    return index;
  } finally {
    if (vortexStateLoading?.promise === promise) vortexStateLoading = null;
  }
}

let vortexStateLoading: { mtimeMs: number; promise: ReturnType<typeof scanVortexStateModMeta> } | null = null;

function registerIpc() {
  ipcMain.handle('modhub:scanAll', async (_e, options) => {
    const settings = store.loadSettings();
    const libs = [...new Set([...discoverSteamLibraries(), ...settings.steamLibraryPaths])];
    const sendProgress = (event: import('../shared/types').ScanProgressEvent) => {
      const extra =
        event.current != null && event.total != null ? ` (${event.current}/${event.total})` : '';
      const pct = event.percent != null ? ` ${event.percent}%` : '';
      console.log(`[Mod Hub scan] ${event.phase}${pct}: ${event.message}${extra}`);
      mainWindow?.webContents.send('modhub:scan-progress', event);
    };
    const { mods, report } = await scanAllMods(
      libs,
      settings.extraScanPaths,
      {
        enrichWorkshop: true,
        deepSize: false,
        nexusApiKey: settings.nexusApiKey,
        ...(options ?? {}),
      },
      sendProgress,
      store.loadCatalog().mods,
    );
    store.mergeScanResults(mods, report);
    setTimeout(() => void workshopCommunityRefresh(true), 2000);
    setTimeout(() => void nexusUpdateCheck(true), 1000);
    setTimeout(() => void securityPass(), 20000);
    // Same dedupe/correlation pass as startup, so a scan never shows rows that vanish after a restart.
    return loadCatalogForWindow();
  });

  let catalogLoading: Promise<unknown> | null = null;
  ipcMain.handle('modhub:getCatalog', () => {
    if (!catalogLoading) {
      catalogLoading = loadCatalogForWindow().finally(() => {
        catalogLoading = null;
        setTimeout(() => void backgroundNexusFill(), 3000);
        setTimeout(() => void workshopCommunityRefresh(false), 15000);
        setTimeout(() => void nexusUpdateCheck(false), 6000);
        setTimeout(() => void securityPass(), 45000);
      });
    }
    return catalogLoading;
  });

  // Fill missing Nexus images / titles / dates / status in small batches after each catalog load.
  let nexusFillRunning = false;
  const nexusFillTried = new Set<string>();
  // "Update on Nexus": installed version vs current Nexus version, every 6 h and after each scan.
  let nexusUpdateRunning = false;
  const nexusUpdateCheck = async (force: boolean) => {
    if (nexusUpdateRunning) return;
    const s0 = store.loadSettings();
    if (s0.nexusUpdateChecksEnabled === false) return;
    const last = s0.lastNexusUpdateCheck;
    const hours = Math.max(1, s0.nexusUpdateIntervalHours ?? 6);
    if (!force && last && Date.now() - Date.parse(last) < hours * 60 * 60 * 1000) return;
    nexusUpdateRunning = true;
    try {
      const cat = store.loadCatalog();
      const r = await checkNexusUpdates(cat.mods);
      store.saveSettings({ lastNexusUpdateCheck: new Date().toISOString() });
      if (r.changed > 0) {
        const byId = new Map(cat.mods.map((m) => [m.id, m]));
        const fresh = store.loadCatalog();
        for (const m of fresh.mods) {
          const u = byId.get(m.id);
          if (!u) continue;
          m.nexusLatestVersion = u.nexusLatestVersion;
          m.nexusUpdateAvailable = u.nexusUpdateAvailable;
          m.nexusCheckedAt = u.nexusCheckedAt;
          m.nexusEndorsements = u.nexusEndorsements;
          m.nexusDownloads = u.nexusDownloads;
          m.remoteUpdatedAt ||= u.remoteUpdatedAt;
        }
        store.saveCatalog(fresh);
        mainWindow?.webContents.send('modhub:catalog-updated');
      }
      console.log(`[Mod Hub] Nexus updates: ${r.checked} mods checked, ${r.updates} with a newer version`);
    } catch (e) {
      console.warn('[Mod Hub] Nexus update check failed:', e);
    } finally {
      nexusUpdateRunning = false;
    }
  };

  // Workshop ratings (daily) + re-upload suggestions for removed mods (weekly per mod), via the Steam client.
  let communityRunning = false;
  const workshopCommunityRefresh = async (afterScan: boolean) => {
    if (communityRunning) return;
    communityRunning = true;
    try {
      const settings = store.loadSettings();
      const votesDue =
        settings.workshopRatingsEnabled !== false &&
        (afterScan || !settings.lastWorkshopVotesAt || Date.now() - Date.parse(settings.lastWorkshopVotesAt) > 20 * 60 * 60 * 1000);
      const cat = store.loadCatalog();
      let changed = 0;
      if (votesDue) {
        changed += await refreshWorkshopVotes(cat.mods, steamHelperPath());
        if (cat.mods.some((m) => m.workshopVotesAt)) store.saveSettings({ lastWorkshopVotesAt: new Date().toISOString() });
      }
      const reuploads = settings.reuploadSearchEnabled === false ? 0 : await findWorkshopReuploads(cat.mods, steamHelperPath());
      changed += reuploads;
      if (changed > 0) {
        // Merge onto the latest catalog so a concurrent change isn't lost.
        const byId = new Map(cat.mods.map((m) => [m.id, m]));
        const fresh = store.loadCatalog();
        for (const m of fresh.mods) {
          const u = byId.get(m.id);
          if (!u) continue;
          m.workshopVotesUp = u.workshopVotesUp;
          m.workshopVotesDown = u.workshopVotesDown;
          m.workshopVotesAt = u.workshopVotesAt;
          m.reuploadCandidates = u.reuploadCandidates;
          m.reuploadCheckedAt = u.reuploadCheckedAt;
          m.authorSteamId ||= u.authorSteamId;
        }
        store.saveCatalog(fresh);
        mainWindow?.webContents.send('modhub:catalog-updated');
      }
      console.log(`[Mod Hub] Workshop community: ${votesDue ? 'ratings refreshed' : 'ratings fresh'}; ${reuploads} re-upload check(s) changed`);
    } catch (e) {
      console.warn('[Mod Hub] Workshop community refresh failed:', e);
    } finally {
      communityRunning = false;
    }
  };

  const backgroundNexusFill = async () => {
    const apiKey = store.loadSettings().nexusApiKey;
    if (nexusFillRunning || !apiKey) return;
    nexusFillRunning = true;
    try {
      const cat = store.loadCatalog();
      const before = new Map(cat.mods.map((m) => [m.id, JSON.stringify(m)]));
      const r = await enrichModsWithNexusApi(
        cat.mods.filter((m) => !nexusFillTried.has(m.id)),
        apiKey,
        undefined,
        60,
        (m) => nexusFillTried.add(m.id),
      );
      const changed = new Map(cat.mods.filter((m) => before.get(m.id) !== JSON.stringify(m)).map((m) => [m.id, m]));
      if (!changed.size) return;
      const fresh = store.loadCatalog();
      fresh.mods = fresh.mods.map((m) => {
        const c = changed.get(m.id);
        if (!c) return m;
        return {
          ...m,
          title: c.title,
          author: m.author ?? c.author,
          version: m.version ?? c.version,
          remotePreviewUrl: c.remotePreviewUrl ?? m.remotePreviewUrl,
          remotePreviewFromApi: c.remotePreviewFromApi ?? m.remotePreviewFromApi,
          remoteCreatedAt: c.remoteCreatedAt ?? m.remoteCreatedAt,
          remoteUpdatedAt: c.remoteUpdatedAt ?? m.remoteUpdatedAt,
          nexusStatus: c.nexusStatus ?? m.nexusStatus,
        };
      });
      store.saveCatalog(fresh);
      console.log(`[Mod Hub] Nexus fill-in: updated ${changed.size} mod(s) with ${r.called} API call(s); ${r.skipped} still waiting`);
      mainWindow?.webContents.send('modhub:catalog-updated');
    } catch (e) {
      console.warn('[Mod Hub] Nexus fill-in failed:', e);
    } finally {
      nexusFillRunning = false;
    }
  };

  const loadCatalogForWindow = async () => {
    try {
      const v = syncArchiveVault();
      if (v.linked) console.log(`[Mod Hub] archive vault: ${v.linked} new hard links (${v.already} already safe)`);
    } catch (e) {
      console.warn('[Mod Hub] archive vault sync failed:', e);
    }
    const cat = store.loadCatalog();
    let dirty = false;
    const dismissed = new Set(store.loadSettings().dismissedMods ?? []);
    if (dismissed.size) {
      const before = cat.mods.length;
      cat.mods = cat.mods.filter((m) => !dismissed.has(dismissKey(m)));
      if (cat.mods.length !== before) dirty = true;
    }
    for (const m of cat.mods) {
      if (stripImplausibleModDates(m)) dirty = true;
      if (isGuess404NexusThumb(m.remotePreviewUrl)) {
        m.remotePreviewUrl = undefined;
        dirty = true;
      }
    }
    try {
      const stateIndex = await getCachedVortexStateIndex();
      const correlation = await refreshModsVortexCorrelation(cat.mods, stateIndex);
      if (
        correlation.deployment.linked > 0 ||
        correlation.deployment.enriched > 0 ||
        correlation.stateApplied > 0 ||
        correlation.mergedCount > 0 ||
        correlation.gameIdsFixed > 0
      ) {
        dirty = true;
        console.log(
          `[Mod Hub] Vortex correlation: ${correlation.deployment.linked} deployed links, ${correlation.deployment.enriched} enriched, ${correlation.mergedCount} rows merged`,
        );
      }
    } catch (e) {
      console.warn('[Mod Hub] Vortex state metadata refresh failed:', e);
    }
    if (applyWorkshopSubscriptionState(cat.mods) > 0) {
      for (const m of cat.mods) {
        if (m.source === 'steam-workshop' && m.steamSubscribed !== undefined) m.subscribed = m.steamSubscribed;
      }
      dirty = true;
    }
    if (applyWorkshopArchive(cat.mods) > 0) dirty = true;
    // Kept copies are local now; Steam's subscription flag no longer applies to them.
    const keptKeys = new Set<string>();
    for (const m of cat.mods) {
      if (!m.keptFromWorkshop) continue;
      keptKeys.add(`${m.keptFromWorkshop.appId}|${m.keptFromWorkshop.workshopId}`);
      if (m.steamSubscribed !== undefined) {
        delete m.steamSubscribed;
        dirty = true;
      }
      // Older kept rows reused the Workshop row's id; a duplicate id leaves ghost cards in the UI.
      const keptId = keptModId(m.keptFromWorkshop.appId, m.keptFromWorkshop.workshopId);
      if (m.id !== keptId) {
        m.id = keptId;
        dirty = true;
      }
    }
    // Steam leaves an unsubscribed item's files until the game next starts; hide that leftover when we hold a kept copy.
    if (keptKeys.size) {
      const before = cat.mods.length;
      cat.mods = cat.mods.filter(
        (m) =>
          !(
            m.source === 'steam-workshop' &&
            m.steamSubscribed === false &&
            m.steamAppId &&
            keptKeys.has(`${m.steamAppId}|${m.workshopId}`)
          ),
      );
      if (cat.mods.length !== before) dirty = true;
    }
    const gamesBefore = JSON.stringify(cat.games);
    cat.games = catalogGamesFor(cat.mods);
    if (JSON.stringify(cat.games) !== gamesBefore) dirty = true;
    if (dirty) store.saveCatalog(cat);
    // Isaac LuaDebug guard: switch REPENTOGON's LuaDebug back off if something turned it on.
    if (store.loadSettings().isaacLuaDebugGuard !== false && enforceLuaDebugOff()) {
      console.log('[Mod Hub] Isaac LuaDebug was on; switched it back off (backup in mod-hub\\backups).');
      setTimeout(
        () =>
          mainWindow?.webContents.send('modhub:toast', {
            message: 'Isaac LuaDebug was turned on (no Lua sandbox for any mod). Mod Hub switched it back off.',
            kind: 'error',
          }),
        1500,
      );
    }
    const bySource = cat.mods.reduce<Record<string, number>>((a, m) => ((a[m.source] = (a[m.source] ?? 0) + 1), a), {});
    console.log(
      `[Mod Hub] Catalog loaded: ${cat.mods.length} mods across ${new Set(cat.mods.map((m) => m.gameId)).size} games (${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ')})${dirty ? ' - saved fixes' : ''}`,
    );
    return cat;
  };

  ipcMain.handle('modhub:getLoadOrders', () => readLoadOrders(store.loadCatalog().mods));
  ipcMain.handle('modhub:getIsaacConflicts', () => analyzeIsaacConflicts(store.loadCatalog().mods));

  ipcMain.handle('modhub:setIsaacFolderEnabled', (_e, folder: string, enabled: boolean) => setIsaacFolderEnabled(folder, enabled));

  ipcMain.handle('modhub:getSteamUpdates', (_e, appIds: number[]) => {
    const out: Record<number, { bytes?: number }> = {};
    for (const id of appIds) {
      const s = steamUpdateState(id);
      if (s?.pending) out[id] = { bytes: s.bytes };
    }
    return out;
  });

  // Malware checks: new/changed mods in the background, one mod or all-with-executables on request.
  let securityRunning = false;
  let securityStop = false;
  const securityPass = async (all = false) => {
    if (securityRunning) return;
    securityStop = false;
    const settings = store.loadSettings();
    if (!all && settings.securityAutoCheck === false) return;
    if (!settings.securityBaseline) store.saveSettings({ securityBaseline: new Date().toISOString() });
    securityRunning = true;
    try {
      const mods = store.loadCatalog().mods;
      const baseline = all ? '' : (store.loadSettings().securityBaseline ?? new Date().toISOString());
      const send = (done: number, total: number, current: string) =>
        mainWindow?.webContents.send('modhub:security-progress', { done, total, current, running: done < total });
      const r = await backgroundSecurityPass(
        mods,
        settings.virusTotalApiKey,
        baseline,
        (done, total, current) => {
          send(done, total, current);
          if (done % 10 === 0 && done < total) console.log(`[Mod Hub] Malware check ${done}/${total}: ${current}`);
        },
        { allWithExecutables: all, shouldStop: () => securityStop },
      );
      mainWindow?.webContents.send('modhub:security-progress', { done: r.checked, total: r.total, current: '', running: false });
      console.log(
        `[Mod Hub] Malware checks${r.stopped ? ' (stopped)' : ''}: ${r.inventoried} inventories refreshed, ${r.checked}/${r.total} mod(s) checked, ${r.threats} with findings`,
      );
      if (all || r.checked) {
        mainWindow?.webContents.send('modhub:toast', {
          message: r.stopped
            ? `Malware check stopped after ${r.checked} of ${r.total} mods.`
            : r.total === 0
              ? 'Malware check: every mod with programs/DLLs already has a current result.'
              : `Malware check done: ${r.checked} mod(s), ${r.threats ? `${r.threats} flagged` : 'nothing found'}.`,
          kind: r.threats ? 'error' : 'ok',
        });
      }
      if (r.checked || r.inventoried) mainWindow?.webContents.send('modhub:catalog-updated');
      if (r.threats) {
        mainWindow?.webContents.send('modhub:toast', {
          message: `Malware check: ${r.threats} mod(s) flagged. Open them for details.`,
          kind: 'error',
        });
      }
    } catch (e) {
      console.warn('[Mod Hub] malware check pass failed:', e);
    } finally {
      securityRunning = false;
    }
  };

  ipcMain.handle('modhub:checkModSecurity', async (_e, modId: string) => {
    const m = store.loadCatalog().mods.find((x) => x.id === modId);
    if (!m) return { error: 'Mod not found.' };
    return checkMod(m, store.loadSettings().virusTotalApiKey);
  });
  ipcMain.handle('modhub:getSecurityReport', (_e, modId: string) => securityReport(modId) ?? null);
  ipcMain.handle('modhub:getSecurityOverview', () => securityOverview());
  ipcMain.handle('modhub:checkAllExecutableMods', () => {
    if (securityRunning) return { ok: false, message: 'A malware check is already running (see the progress bar).' };
    void securityPass(true);
    return { ok: true, message: 'Checking every mod that contains programs, DLLs or scripts…' };
  });
  ipcMain.handle('modhub:defenderSweep', () => {
    if (securityRunning) return { ok: false, message: 'A malware check is already running (see the progress bar).' };
    securityRunning = true;
    securityStop = false;
    void (async () => {
      try {
        const mods = store.loadCatalog().mods;
        const sweep = await defenderSweep(
          mods,
          app.getPath('userData'),
          (done, total, current) => {
            mainWindow?.webContents.send('modhub:security-progress', { done, total, current, running: done < total });
            if (current) console.log(`[Mod Hub] Defender sweep ${done + 1}/${total}: ${current}`);
          },
          () => securityStop,
        );
        recordSweep(sweep);
        const secs = sweep.roots.reduce((a, r) => a + r.seconds, 0);
        const unavailable = sweep.roots.filter((r) => r.status === 'unavailable').length;
        console.log(`[Mod Hub] Defender sweep: ${sweep.roots.length} folders in ${secs}s, ${sweep.threats.length} threat(s)`);
        mainWindow?.webContents.send('modhub:security-progress', { done: sweep.roots.length, total: sweep.roots.length, current: '', running: false });
        mainWindow?.webContents.send('modhub:toast', {
          message: sweep.threats.length
            ? `Defender found ${sweep.threats.length} threat(s) in mod folders. See Settings → Malware checks.`
            : `Defender scanned ${sweep.roots.length} mod folders in ${secs}s: nothing found${unavailable ? ` (${unavailable} couldn't be scanned)` : ''}.`,
          kind: sweep.threats.length ? 'error' : 'ok',
        });
        mainWindow?.webContents.send('modhub:catalog-updated');
      } catch (e) {
        console.warn('[Mod Hub] Defender sweep failed:', e);
      } finally {
        securityRunning = false;
      }
    })();
    return { ok: true, message: 'Scanning every mod folder with Microsoft Defender…' };
  });
  ipcMain.handle('modhub:getLastSweep', () => lastSweep() ?? null);

  ipcMain.handle('modhub:stopSecurityChecks', () => {
    securityStop = true;
    return { ok: true, message: 'Stopping after the current mod…' };
  });
  ipcMain.handle('modhub:openVirusTotal', (_e, hash: string) => {
    if (!/^[0-9a-f]{64}$/i.test(hash)) return;
    return shell.openExternal(`https://www.virustotal.com/gui/file/${hash}`);
  });

  ipcMain.handle('modhub:getPlayInfo', (_e, gameId: string) => {
    const settings = store.loadSettings();
    const options = playOptions(gameId);
    const running = (PLAY_EXE[gameId] ?? []).some((exe) => isRunning(exe));
    const mods = store.loadCatalog().mods;
    const warnings: string[] = [];
    if (gameId === 'rimworld') {
      const plan = planRimworldOrder(readRimworldActive(), mods);
      const order = plan.issues.filter((i) => i.kind === 'order').length;
      const deps = plan.issues.filter((i) => i.kind === 'dependency-missing' || i.kind === 'dependency-off').length;
      if (order) warnings.push(`${order} mod(s) are out of order. Auto-sort in All mods fixes it.`);
      if (deps) warnings.push(`${deps} dependency problem(s) (missing or disabled).`);
      const inc = plan.issues.filter((i) => i.kind === 'incompatible' || i.kind === 'duplicate-id').length;
      if (inc) warnings.push(`${inc} incompatible/duplicate pair(s) enabled.`);
    }
    if (gameId === 'binding-of-isaac') {
      const lua = isaacLuaDebugState();
      if (lua.launcher && settings.isaacLuaDebugGuard !== false && enforceLuaDebugOff()) {
        warnings.push('REPENTOGON had LuaDebug on (no Lua sandbox for any mod). Mod Hub switched it back off.');
      } else if (lua.launcher) {
        warnings.push('LuaDebug is ON in REPENTOGON: every enabled mod can read/write files and run programs.');
      }
      if (lua.steamOption) {
        warnings.push('Steam launch options for Isaac contain --luadebug (no Lua sandbox). Remove it in Steam → Isaac → Properties.');
      }
      const c = analyzeIsaacConflicts(mods);
      const heavy = c.pairs.filter((p) => p.fileCount >= 50).length;
      if (heavy) warnings.push(`${heavy} pair(s) of enabled mods replace 50+ of the same files (see ⚠ file conflicts).`);
    }
    if (gameId === 'skyrimse' && findMo2Instances().some((i) => i.gameId === 'skyrimse') && mods.some((m) => m.gameId === 'skyrimse' && (m.source === 'nexus' || m.source === 'vortex-staging'))) {
      warnings.push('Skyrim mods come from both MO2 and Vortex. Vortex deploys into the game folder (MO2 shows those as “Unmanaged”), so both sets load when you play through MO2.');
    }
    const appId = gameById(gameId)?.steamAppId ?? (Number(/^steam-(\d+)$/.exec(gameId)?.[1]) || undefined);
    const upd = appId ? steamUpdateState(appId) : null;
    if (upd?.pending) {
      const size = upd.bytes ? ` (${(upd.bytes / 1e9).toFixed(1)} GB)` : '';
      const nonSteam = options.some((o) => o.kind !== 'steam');
      warnings.push(
        `Steam has an update waiting for this game${size}. Launching through Steam installs it first, which can break script-extender and version-specific mods.${nonSteam ? ' MO2 / SKSE / REPENTOGON launches skip it.' : ''}${upd.autoUpdate === 'always' ? ' To stop Steam scheduling it: game Properties → Updates → "Only update this game when I launch it".' : ''}`,
      );
    }
    const choice = settings.playChoices?.[gameId];
    return {
      steamUpdatePending: upd?.pending ? { bytes: upd.bytes, autoUpdate: upd.autoUpdate } : undefined,
      gameId,
      options,
      chosenId: choice && options.some((o) => o.id === choice.optionId) ? choice.optionId : options.find((o) => o.recommended)?.id,
      chosenProfile: choice?.profile,
      running,
      warnings,
    };
  });

  ipcMain.handle('modhub:playGame', async (_e, gameId: string, optionId: string, profile?: string) => {
    if ((PLAY_EXE[gameId] ?? []).some((exe) => isRunning(exe))) return { ok: false, message: 'The game is already running.' };
    const opt = playOptions(gameId).find((o) => o.id === optionId);
    if (!opt) return { ok: false, message: 'That launch option is no longer available.' };
    const settings = store.loadSettings();
    store.saveSettings({ playChoices: { ...(settings.playChoices ?? {}), [gameId]: { optionId, profile } } });
    console.log(`[Mod Hub] Play ${gameId} via ${opt.label}${profile ? ` (profile ${profile})` : ''}`);
    return launchPlayOption(opt, profile);
  });

  ipcMain.handle('modhub:getLoadouts', (_e, gameId: string) => getLoadouts(gameId, store.loadCatalog().mods));
  ipcMain.handle('modhub:applyLoadout', (_e, gameId: string, id: string) => {
    if (id.startsWith('mo2:')) {
      // MO2 owns its profiles: "apply" = launch Play with this profile.
      const profile = id.slice(4);
      const opt = playOptions(gameId).find((o) => o.kind === 'mo2' && o.recommended) ?? playOptions(gameId).find((o) => o.kind === 'mo2');
      if (!opt) return { ok: false, message: 'MO2 launch option not found.' };
      const settings = store.loadSettings();
      store.saveSettings({ playChoices: { ...(settings.playChoices ?? {}), [gameId]: { optionId: opt.id, profile } } });
      return { ok: true, message: `▶ Play will start ${opt.label} with MO2 profile “${profile}”.` };
    }
    return applyLoadout(gameId, id, store.loadCatalog().mods);
  });
  ipcMain.handle('modhub:saveLoadout', (_e, gameId: string, name: string) => saveCurrentLoadout(gameId, name, store.loadCatalog().mods));
  ipcMain.handle('modhub:applyLoadoutToSave', (_e, id: string, saveId: string) => applyLoadoutToPzSave(id, saveId, store.loadCatalog().mods));
  ipcMain.handle('modhub:exportLoadoutCode', (_e, gameId: string, id: string) => exportLoadoutCode(gameId, id, store.loadCatalog().mods));
  ipcMain.handle('modhub:importLoadoutCode', (_e, code: string) => importLoadoutCode(code, store.loadCatalog().mods));
  ipcMain.handle('modhub:updateLoadout', (_e, gameId: string, id: string) => updateLoadout(gameId, id, store.loadCatalog().mods));
  ipcMain.handle('modhub:deleteLoadout', (_e, gameId: string, id: string) => deleteLoadout(gameId, id, store.loadCatalog().mods));

  ipcMain.handle('modhub:planLoadOrder', (_e, gameId: string, order?: string[]) => {
    const mods = store.loadCatalog().mods;
    if (gameId === 'project-zomboid') {
      let pzOrder = order;
      if (!pzOrder) {
        try {
          pzOrder = [...fs.readFileSync(pzDefaultModsFile(), 'utf8').matchAll(/^\s*mod\s*=\s*([^,\r\n]+?)\s*,?\s*$/gim)].map((m) => m[1]);
        } catch {
          pzOrder = [];
        }
      }
      return planPzOrder(pzOrder, mods);
    }
    if (gameId !== 'rimworld') return null;
    const current = order ?? readRimworldActive();
    return planRimworldOrder(current, mods);
  });
  ipcMain.handle('modhub:setLoadOrder', (_e, gameId: string, ids: string[]) => setLoadOrder(gameId, ids));

  ipcMain.handle('modhub:setModsEnabled', (_e, gameId: string, modIds: string[], enabled: boolean) => {
    const ids = new Set(modIds);
    const mods = store.loadCatalog().mods.filter((m) => ids.has(m.id) && m.gameId === gameId);
    return setModsEnabled(gameId, mods, enabled);
  });

  ipcMain.handle('modhub:getSettings', () => store.loadSettings());

  ipcMain.handle('modhub:saveSettings', (_e, partial) => store.saveSettings(partial));

  ipcMain.handle('modhub:setFavorite', (_e, modId: string, favorited: boolean) => {
    store.setFavorite(modId, favorited);
    console.log(`[Mod Hub] ${favorited ? 'Favorited' : 'Unfavorited'} ${modId}`);
    return store.updateMod(modId, { favorited });
  });

  ipcMain.handle('modhub:setSubscribed', (_e, modId: string, subscribed: boolean) => {
    store.setSubscribed(modId, subscribed);
    return store.updateMod(modId, { subscribed });
  });

  ipcMain.handle('modhub:checkWorkshopUpdates', async (_e, _appId?: number) => {
    const cat = store.loadCatalog();
    const ids = cat.mods.filter((m) => m.workshopId).map((m) => m.workshopId!);
    const details = await fetchWorkshopDetails(ids);
    const updated: typeof cat.mods = [];
    for (const m of cat.mods) {
      if (!m.workshopId) continue;
      const d = details.get(m.workshopId);
      if (!d) continue;
      const localTs = Number(m.revision.value);
      const updateAvailable = d.time_updated > localTs;
      const patched = store.updateMod(m.id, {
        remoteUpdatedAt: new Date(d.time_updated * 1000).toISOString(),
        revision: {
          ...m.revision,
          remoteValue: String(d.time_updated),
          updateAvailable,
        },
      });
      if (patched && updateAvailable) updated.push(patched);
    }
    return updated;
  });

  ipcMain.handle('modhub:fetchRemoteThumbnail', async (_e, url: string) => {
    if (!url?.startsWith('http')) return null;
    if (isGuess404NexusThumb(url)) return null;
    return diskCachedThumbnail(url, () => fetchRemoteThumbnailDataUrl(url));
  });

  // Steam keeps every library game's art in appcache/librarycache/{appId}/ (newer games: hashed subfolders).
  const steamArtNames = ['library_600x900.jpg', 'library_capsule.jpg', 'header.jpg', 'library_header.jpg', 'library_hero.jpg'];
  ipcMain.handle('modhub:getSteamGameArt', async (_e, appId: number) => {
    for (const lib of discoverSteamLibraries()) {
      const root = path.join(lib, 'appcache', 'librarycache', String(appId));
      if (!fs.existsSync(root)) continue;
      const files: string[] = [];
      for (const e of fs.readdirSync(root, { withFileTypes: true })) {
        if (e.isFile()) files.push(path.join(root, e.name));
        else if (e.isDirectory()) {
          for (const f of fs.readdirSync(path.join(root, e.name))) files.push(path.join(root, e.name, f));
        }
      }
      for (const name of steamArtNames) {
        const hit = files.find((f) => path.basename(f).toLowerCase() === name);
        if (hit) {
          const stat = fs.statSync(hit);
          return diskCachedThumbnail(`file:${hit.toLowerCase()}|${stat.mtimeMs}|${stat.size}`, () =>
            `data:image/jpeg;base64,${fs.readFileSync(hit).toString('base64')}`,
          );
        }
      }
    }
    return null;
  });

  ipcMain.handle('modhub:getThumbnail', async (_e, filePath: string) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) return null;
      const stat = fs.statSync(filePath);
      const cacheKey = filePath.toLowerCase();
      const hit = localThumbnailCache.get(cacheKey);
      if (hit && hit.mtimeMs === stat.mtimeMs) return hit.dataUrl;

      if (stat.size > 8_000_000) {
        localThumbnailCache.set(cacheKey, { mtimeMs: stat.mtimeMs, dataUrl: null });
        return null;
      }
      const ext = path.extname(filePath).toLowerCase();
      const mime =
        ext === '.png'
          ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.webp'
              ? 'image/webp'
              : ext === '.gif'
                ? 'image/gif'
                : ext === '.bmp'
                  ? 'image/bmp'
                  : null;
      if (!mime) {
        localThumbnailCache.set(cacheKey, { mtimeMs: stat.mtimeMs, dataUrl: null });
        return null;
      }
      const dataUrl = await diskCachedThumbnail(
        `file:${cacheKey}|${stat.mtimeMs}|${stat.size}`,
        () => `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`,
      );
      localThumbnailCache.set(cacheKey, { mtimeMs: stat.mtimeMs, dataUrl });
      return dataUrl;
    } catch {
      return null;
    }
  });

  // Packaged: the helper (and steamworks.js) are unpacked next to app.asar so a separate process can run them.
  const steamHelperPath = () =>
    path.join(app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'), 'electron', 'steam-workshop-helper.cjs');

  ipcMain.handle('modhub:steamSubscribe', async (_e, appId: number, workshopId: string) => {
    const direct = await runSteamWorkshopAction(steamHelperPath(), 'subscribe', appId, workshopId);
    if (direct.ok) {
      console.log(`[Mod Hub] Subscribed ${appId}/${workshopId} through Steam`);
      return { ok: true, message: 'Subscribed through Steam. Steam downloads it in the background.' };
    }
    console.warn('[Mod Hub] direct subscribe failed, opening Steam:', direct.error);
    shell.openExternal(workshopSubscribeUrl(appId, workshopId));
    return {
      ok: true,
      message: `Couldn't subscribe directly (${direct.error}). Opened Steam instead.`,
    };
  });

  ipcMain.handle('modhub:workshopDeleteLocal', async (_e, modIds: string[]) => {
    const t0 = Date.now();
    const cat = store.loadCatalog();
    const ids = new Set(Array.isArray(modIds) ? modIds : [modIds]);
    const failures: string[] = [];
    const removed = new Set<string>();
    let bytes = 0;

    // Group by Steam library. Moving folders inside one drive is an instant rename, so we gather
    // everything into one folder and send that to the Recycle Bin in a single operation.
    const groups = new Map<string, typeof cat.mods>();
    for (const mod of cat.mods.filter((m) => ids.has(m.id))) {
      const root = mod.localPath.match(/^(.*[\\/]steamapps)[\\/]workshop[\\/]content[\\/]\d+[\\/]\d+$/i)?.[1];
      if (mod.source !== 'steam-workshop' || !root) {
        failures.push(`${mod.title}: unexpected path`);
        continue;
      }
      groups.set(root, [...(groups.get(root) ?? []), mod]);
    }

    for (const [root, mods] of groups) {
      const staging = path.join(root, 'workshop', `modhub-deleted-${Date.now()}`);
      fs.mkdirSync(staging, { recursive: true });
      const moved: { mod: (typeof mods)[number]; to: string; size: number }[] = [];
      for (const mod of mods) {
        try {
          const size = folderSize(mod.localPath);
          const to = path.join(staging, `${mod.steamAppId ?? 'app'}-${mod.workshopId ?? mod.id}`);
          fs.renameSync(mod.localPath, to);
          moved.push({ mod, to, size });
        } catch (e) {
          failures.push(`${mod.title}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      try {
        await shell.trashItem(staging);
        for (const m of moved) {
          removed.add(m.mod.id);
          bytes += m.size;
        }
      } catch (e) {
        // Put everything back where it was so nothing is half-deleted.
        for (const m of moved) {
          try {
            fs.renameSync(m.to, m.mod.localPath);
          } catch {
            /* leave in staging */
          }
        }
        try {
          fs.rmdirSync(staging);
        } catch {
          /* not empty */
        }
        failures.push(`Recycle Bin refused ${moved.length} item(s): ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (removed.size) {
      cat.mods = cat.mods.filter((m) => !removed.has(m.id));
      store.saveCatalog(cat);
    }
    console.log(
      `[Mod Hub] Deleted ${removed.size} Workshop item(s), ${(bytes / 1e9).toFixed(2)} GB -> Recycle Bin in ${((Date.now() - t0) / 1000).toFixed(1)}s${failures.length ? `; ${failures.length} failed` : ''}`,
    );
    return {
      ok: failures.length === 0,
      deleted: removed.size,
      bytes,
      message: failures.length ? `${failures.length} couldn't be deleted: ${failures.slice(0, 3).join('; ')}` : 'Deleted.',
    };
  });

  ipcMain.handle('modhub:findCrossPlatform', async (_e, modId: string) => {
    const cat = store.loadCatalog();
    const mod = cat.mods.find((m) => m.id === modId);
    if (!mod) return { candidates: [], searched: [], error: 'Mod not found' };
    return findCrossPlatform(mod, cat.mods);
  });

  ipcMain.handle(
    'modhub:linkCrossPlatform',
    (
      _e,
      modId: string,
      link: { platform: 'nexus' | 'workshop'; id: string; domain?: string; appId?: number; title?: string } | null,
      platformToClear?: 'nexus' | 'workshop',
    ) => {
      const mod = store.loadCatalog().mods.find((m) => m.id === modId);
      if (!mod) return { ok: false, message: 'Mod not found.' };
      const next = { ...(mod.crossLinks ?? {}) };
      if (!link) {
        if (platformToClear) delete next[platformToClear];
      } else if (link.platform === 'nexus' && link.domain) {
        next.nexus = { domain: link.domain, modId: Number(link.id), title: link.title };
      } else if (link.platform === 'workshop') {
        const appId = link.appId ?? mod.steamAppId ?? gameById(mod.gameId)?.steamAppId ?? 0;
        next.workshop = { appId, workshopId: link.id, title: link.title };
      }
      store.updateMod(modId, { crossLinks: Object.keys(next).length ? next : undefined });
      console.log(`[Mod Hub] Cross-link ${mod.title}: ${link ? `${link.platform} ${link.id}` : `cleared ${platformToClear}`}`);
      mainWindow?.webContents.send('modhub:catalog-updated');
      return {
        ok: true,
        message: link
          ? `Linked “${mod.title}” to its ${link.platform === 'nexus' ? 'Nexus' : 'Workshop'} page.`
          : `Removed the ${platformToClear === 'nexus' ? 'Nexus' : 'Workshop'} link.`,
      };
    },
  );

  // First-on-disk (creation time) and most recent file change for a mod's folder or archive.
  ipcMain.handle('modhub:getDiskInfo', async (_e, modId: string) => {
    const mod = store.loadCatalog().mods.find((m) => m.id === modId);
    const target = mod?.localPath;
    if (!target || !fs.existsSync(target)) return { exists: false, files: 0, bytes: 0 };
    const root = await fs.promises.stat(target);
    let files = 0;
    let bytes = 0;
    let newest = { t: 0, f: '' };
    let oldestCreated = root.birthtimeMs || root.ctimeMs;
    const walk = async (dir: string, depth: number) => {
      if (files > 20000 || depth > 12) return;
      for (const e of await fs.promises.readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p, depth + 1);
        else {
          try {
            const st = await fs.promises.stat(p);
            files += 1;
            bytes += st.size;
            if (st.mtimeMs > newest.t) newest = { t: st.mtimeMs, f: path.relative(target, p) };
            if (st.birthtimeMs && st.birthtimeMs < oldestCreated) oldestCreated = st.birthtimeMs;
          } catch {
            /* ignore */
          }
        }
      }
    };
    if (root.isDirectory()) await walk(target, 0);
    else {
      files = 1;
      bytes = root.size;
      newest = { t: root.mtimeMs, f: path.basename(target) };
    }
    return {
      exists: true,
      createdAt: new Date(root.birthtimeMs || root.ctimeMs).toISOString(),
      oldestAt: new Date(oldestCreated).toISOString(),
      newestAt: newest.t ? new Date(newest.t).toISOString() : undefined,
      newestFile: newest.f || undefined,
      files,
      bytes,
    };
  });

  ipcMain.handle('modhub:getModChanges', async (_e, modId: string) => {
    const mod = store.loadCatalog().mods.find((m) => m.id === modId);
    if (!mod) return { source: 'none', installed: {}, latest: {}, entries: [], error: 'Mod not found' };
    return getModChanges(mod, store.loadSettings().nexusApiKey);
  });

  const keptRoot = () => path.join(app.getPath('userData'), 'kept-mods');

  // Update one Workshop item now. Subscribed: ask Steam to fetch the newest version.
  // Kept copy: briefly subscribe, download the newest version, replace the copy (old one backed up), unsubscribe.
  ipcMain.handle('modhub:workshopUpdate', async (_e, modId: string) => {
    const cat = store.loadCatalog();
    const mod = cat.mods.find((m) => m.id === modId);
    if (!mod?.workshopId) return { ok: false, message: 'Not a Workshop item.' };
    const appId = mod.keptFromWorkshop?.appId ?? mod.steamAppId ?? gameById(mod.gameId)?.steamAppId;
    if (!appId) return { ok: false, message: 'Unknown Steam app.' };
    const r = (await runSteamWorkshopBatch(steamHelperPath(), 'download', appId, [mod.workshopId])).get(mod.workshopId);
    if (!r?.ok) return { ok: false, message: `Steam couldn't download the update: ${r?.error ?? 'no result'}` };
    const newTs = r.timestamp ? String(r.timestamp) : mod.revision.remoteValue ?? mod.revision.value;

    if (mod.keptFromWorkshop) {
      const src = r.folder && fs.existsSync(r.folder) ? r.folder : undefined;
      if (!src) return { ok: false, message: 'Downloaded, but Steam did not report the folder.' };
      const kept = await keepWorkshopCopy({ ...mod, localPath: src }, keptRoot(), { replace: true, source: src });
      const unsub = await runSteamWorkshopAction(steamHelperPath(), 'unsubscribe', appId, mod.workshopId);
      if (!kept.ok) return { ok: false, message: `${kept.note}${unsub.ok ? '' : ' (also still subscribed)'}` };
      store.updateMod(mod.id, {
        localPath: kept.keptPath ?? mod.localPath,
        revision: { ...mod.revision, value: newTs, updateAvailable: false },
      });
      console.log(`[Mod Hub] Updated kept copy ${mod.title} -> ${kept.keptPath}`);
      mainWindow?.webContents.send('modhub:catalog-updated');
      return {
        ok: true,
        message: `Updated your kept copy of “${mod.title}”. The previous version is in kept-mods\\_previous.${unsub.ok ? '' : ' Note: still subscribed — unsubscribe failed.'}`,
      };
    }

    store.updateMod(mod.id, { revision: { ...mod.revision, value: newTs, updateAvailable: false } });
    console.log(`[Mod Hub] Steam updated ${mod.title}`);
    mainWindow?.webContents.send('modhub:catalog-updated');
    return { ok: true, message: `Steam downloaded the latest version of “${mod.title}”.` };
  });

  // Bulk: copy & keep every given subscribed Workshop item, then unsubscribe them in Steam.
  ipcMain.handle('modhub:workshopBulkKeep', async (_e, modIds: string[]) => {
    const cat = store.loadCatalog();
    const ids = new Set(modIds);
    const targets = cat.mods.filter(
      (m) => ids.has(m.id) && m.source === 'steam-workshop' && m.workshopId && m.steamSubscribed !== false && m.subscribed !== false,
    );
    const total = targets.length;
    const send = (done: number, current: string, phase: string) =>
      mainWindow?.webContents.send('modhub:bulk-progress', { done, total, current, phase });
    const t0 = Date.now();
    const copied = new Map<string, { appId: number; keptPath: string }>();
    const failures: string[] = [];
    let done = 0;
    for (const m of targets) {
      send(done, m.title, 'Copying');
      await new Promise((r) => setImmediate(r));
      const kept = await keepWorkshopCopy(m, keptRoot());
      if (kept.ok && kept.keptPath) copied.set(m.id, { appId: m.steamAppId!, keptPath: kept.keptPath });
      else failures.push(`${m.title}: ${kept.note}`);
      done += 1;
    }
    const byApp = new Map<number, typeof targets>();
    for (const m of targets) if (copied.has(m.id)) byApp.set(m.steamAppId!, [...(byApp.get(m.steamAppId!) ?? []), m]);
    const unsubscribed = new Set<string>();
    let udone = 0;
    for (const [appId, mods] of byApp) {
      const byWs = new Map(mods.map((m) => [m.workshopId!, m]));
      const res = await runSteamWorkshopBatch(steamHelperPath(), 'unsubscribe', appId, [...byWs.keys()], (r) => {
        udone += 1;
        send(udone, byWs.get(r.id)?.title ?? r.id, 'Unsubscribing');
      });
      for (const [wid, r] of res) {
        const m = byWs.get(wid);
        if (!m) continue;
        if (r.ok) unsubscribed.add(m.id);
        else failures.push(`${m.title}: unsubscribe failed (${r.error}) — local copy was still made`);
      }
    }
    const fresh = store.loadCatalog();
    fresh.mods = fresh.mods.map((m) => {
      const c = copied.get(m.id);
      if (!c || !unsubscribed.has(m.id)) return m;
      store.setSubscribed(m.id, false);
      return {
        ...m,
        id: keptModId(c.appId, m.workshopId!),
        subscribed: false,
        steamSubscribed: undefined,
        source: 'local' as const,
        localPath: c.keptPath,
        keptFromWorkshop: { appId: c.appId, workshopId: m.workshopId! },
        tags: [...(m.tags ?? []).filter((t) => t !== 'kept-from-workshop'), 'kept-from-workshop'],
        revision: { ...m.revision, updateAvailable: false },
      };
    });
    store.saveCatalog(fresh);
    send(total, '', 'Done');
    console.log(`[Mod Hub] Bulk keep: ${unsubscribed.size}/${total} kept + unsubscribed in ${((Date.now() - t0) / 1000).toFixed(0)}s; ${failures.length} problem(s)`);
    return {
      ok: failures.length === 0,
      kept: unsubscribed.size,
      failed: failures.length,
      message: failures.length
        ? `${unsubscribed.size} kept and unsubscribed. ${failures.length} problem(s): ${failures.slice(0, 3).join('; ')}`
        : `${unsubscribed.size} mods copied to safe local folders and unsubscribed. Steam won't update or remove those copies.`,
    };
  });

  ipcMain.handle('modhub:getModMedia', async (_e, modId: string) => {
    const mod = store.loadCatalog().mods.find((m) => m.id === modId);
    if (!mod) return { images: [], videos: [], errors: ['Mod not found'] };
    return getModMedia(mod, store.loadSettings().nexusApiKey);
  });

  ipcMain.handle('modhub:openInSteam', async (_e, url: string) => {
    if (!/^https:\/\/(steamcommunity\.com|store\.steampowered\.com)\//i.test(url)) return;
    try {
      await shell.openExternal(`steam://openurl/${url}`);
    } catch {
      await shell.openExternal(url);
    }
  });

  ipcMain.handle('modhub:dismissMod', (_e, modId: string) => {
    const cat = store.loadCatalog();
    const mod = cat.mods.find((m) => m.id === modId);
    if (!mod) return { ok: false, message: 'Not found.' };
    const settings = store.loadSettings();
    const key = dismissKey(mod);
    store.saveSettings({ dismissedMods: [...new Set([...(settings.dismissedMods ?? []), key])] });
    cat.mods = cat.mods.filter((m) => m.id !== modId);
    store.saveCatalog(cat);
    console.log(`[Mod Hub] Removed from list: ${mod.title} (${key})`);
    return { ok: true, message: `Removed “${mod.title}” from Mod Hub. Scans won't add it back.` };
  });

  ipcMain.handle('modhub:workshopUnsubscribe', async (_e, modId: string, keepCopy: boolean) => {
    const cat = store.loadCatalog();
    const mod = cat.mods.find((m) => m.id === modId);
    if (!mod?.workshopId) return { ok: false, message: 'Not a Workshop item.' };
    const appId = mod.steamAppId ?? gameById(mod.gameId)?.steamAppId;
    if (!appId) return { ok: false, message: 'Unknown Steam app for this item.' };

    let keptNote = '';
    let keptPath: string | undefined;
    if (keepCopy) {
      const kept = await keepWorkshopCopy(mod, path.join(app.getPath('userData'), 'kept-mods'));
      if (!kept.ok) return { ok: false, message: `${kept.note} Nothing was unsubscribed.` };
      keptNote = kept.note;
      keptPath = kept.keptPath;
    }

    const r = await runSteamWorkshopAction(steamHelperPath(), 'unsubscribe', appId, mod.workshopId);
    if (!r.ok) {
      return {
        ok: false,
        message: `Steam unsubscribe failed: ${r.error}.${keptNote ? ` (Local copy was still made. ${keptNote})` : ''}`,
      };
    }

    store.setSubscribed(mod.id, false);
    console.log(`[Mod Hub] Unsubscribed ${mod.title} (${appId}/${mod.workshopId})${keptPath ? ` - kept copy at ${keptPath}` : ''}`);
    if (keptPath) {
      store.updateMod(mod.id, {
        id: keptModId(appId, mod.workshopId),
        subscribed: false,
        steamSubscribed: undefined,
        source: 'local',
        localPath: keptPath,
        keptFromWorkshop: { appId, workshopId: mod.workshopId },
        tags: [...(mod.tags ?? []).filter((t) => t !== 'kept-from-workshop'), 'kept-from-workshop'],
        revision: { ...mod.revision, updateAvailable: false },
      });
    } else {
      store.updateMod(mod.id, { subscribed: false });
    }
    return {
      ok: true,
      message: keepCopy
        ? `Unsubscribed. ${keptNote} Steam won't update or delete this copy.`
        : 'Unsubscribed. Steam will remove the files.',
    };
  });

  ipcMain.handle('modhub:steamOpenWorkshop', async (_e, appId: number, workshopId: string) => {
    // Open inside the Steam client; fall back to the browser if no steam:// handler is registered.
    try {
      await shell.openExternal(`steam://url/CommunityFilePage/${encodeURIComponent(workshopId)}`);
    } catch {
      await shell.openExternal(workshopItemUrl(appId, workshopId));
    }
  });

  ipcMain.handle('modhub:nexusOpenMod', (_e, gameDomain: string, modId: number) => {
    shell.openExternal(nexusModPageUrl(gameDomain, modId));
  });

  ipcMain.handle('modhub:nexusDownloadMod', (_e, gameDomain: string, modId: number) => {
    shell.openExternal(nexusNxmUrl(gameDomain, modId));
    return { ok: true, message: 'Opened nxm link — use Vortex or Nexus Mods App if installed.' };
  });

  ipcMain.handle('modhub:nexusTrackMod', async (_e, gameDomain: string, modId: number, track: boolean) => {
    const settings = store.loadSettings();
    if (!settings.nexusApiKey) {
      return { ok: false, message: 'Add a Nexus API key in Settings to track on your account.' };
    }
    const r = await trackMod(settings.nexusApiKey, gameDomain, modId, track);
    console.log(`[Mod Hub] Nexus ${track ? 'track' : 'untrack'} ${gameDomain}/${modId}: ${r.ok ? 'ok' : r.message}`);
    return r;
  });

  ipcMain.handle('modhub:validateNexusKey', async (_e, apiKey: string) => {
    const result = await validateNexusKey(apiKey);
    if (result.ok) {
      store.saveSettings({ nexusApiKey: apiKey, nexusConnected: true });
    }
    return result;
  });

  ipcMain.handle('modhub:openWorkshopSearch', (_e, appId: number, text: string) => {
    const url = `https://steamcommunity.com/workshop/browse/?appid=${Number(appId)}&searchtext=${encodeURIComponent(String(text).slice(0, 120))}`;
    return shell.openExternal(`steam://openurl/${url}`);
  });

  ipcMain.handle('modhub:openPath', (_e, filePath: string) => {
    if (!filePath) return;
    try {
      if (process.platform === 'win32') {
        const normalized = path.normalize(filePath);
        if (fs.existsSync(normalized) && fs.statSync(normalized).isFile()) {
          spawn('explorer.exe', [`/select,${normalized}`], { shell: true, windowsHide: true });
        } else {
          const dir = fs.existsSync(normalized) ? normalized : path.dirname(normalized);
          spawn('explorer.exe', [dir], { shell: true, windowsHide: true });
        }
        return;
      }
      shell.showItemInFolder(filePath);
    } catch {
      shell.openPath(filePath);
    }
  });

  ipcMain.handle('modhub:workshopBrowse', async (_e, query: import('../shared/types').WorkshopBrowseQuery) => {
    console.log('[Mod Hub] workshopBrowse', query);
    return queryWorkshopBrowse(query);
  });

  ipcMain.handle('modhub:getSteamLibraryGames', async () => {
    const settings = store.loadSettings();
    const owned = new Set(listInstalledSteamAppIds(settings.steamLibraryPaths));
    const cat = store.loadCatalog();
    const localByApp = new Map<number, number>();
    const workshopByApp = new Map<number, number>();
    for (const m of cat.mods) {
      if (!m.steamAppId) continue;
      localByApp.set(m.steamAppId, (localByApp.get(m.steamAppId) ?? 0) + 1);
      if (m.source === 'steam-workshop') {
        workshopByApp.set(m.steamAppId, (workshopByApp.get(m.steamAppId) ?? 0) + 1);
      }
    }
    const seen = new Set<number>();
    const out: import('../shared/types').SteamLibraryGame[] = [];
    for (const g of GAMES_REGISTRY) {
      if (!g.steamAppId) continue;
      seen.add(g.steamAppId);
      const ws = workshopByApp.get(g.steamAppId!) ?? 0;
      out.push({
        appId: g.steamAppId,
        name: g.name,
        ownedOnDisk: owned.has(g.steamAppId),
        localModCount: localByApp.get(g.steamAppId) ?? 0,
        localWorkshopCount: ws,
        hasWorkshopBrowse: hasSteamWorkshopBrowse(g.steamAppId, ws),
      });
    }
    for (const appId of owned) {
      if (seen.has(appId)) continue;
      const reg = gameBySteamAppId(appId);
      const ws = workshopByApp.get(appId) ?? 0;
      out.push({
        appId,
        name: reg?.name ?? steamAppDisplayName(appId),
        ownedOnDisk: true,
        localModCount: localByApp.get(appId) ?? 0,
        localWorkshopCount: ws,
        hasWorkshopBrowse: hasSteamWorkshopBrowse(appId, ws),
      });
    }
    out.sort((a, b) => {
      if (a.ownedOnDisk !== b.ownedOnDisk) return a.ownedOnDisk ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return out;
  });

  ipcMain.handle('modhub:getFavoriteIds', () => [...store.loadFavorites()]);

  ipcMain.handle('modhub:getBrowseInjectionScript', () => {
    const r = ensureInjectionFileOnDisk();
    if ('error' in r) return r;
    return { source: r.source, script: '(loaded via modhub-inject protocol)' };
  });

  // One injection at a time per page (dom-ready + did-navigate fire together), and page errors in our log.
  const injectInFlight = new Map<number, Promise<{ ok: boolean; message: string }>>();
  const guestConsoleHooked = new WeakSet<Electron.WebContents>();
  ipcMain.handle('modhub:injectBrowseEnhancer', (_e, guestId: number, pageUrl: string) => {
    const running = injectInFlight.get(guestId);
    if (running) return running;
    const p = injectBrowseEnhancer(guestId, pageUrl).finally(() => injectInFlight.delete(guestId));
    injectInFlight.set(guestId, p);
    return p;
  });

  async function injectBrowseEnhancer(guestId: number, pageUrl: string): Promise<{ ok: boolean; message: string }> {
    const wc = webContents.fromId(guestId);
    if (!wc || wc.isDestroyed()) return { ok: false, message: 'Guest webview not ready.' };
    if (!guestConsoleHooked.has(wc)) {
      guestConsoleHooked.add(wc);
      wc.on('console-message', (details) => {
        const d = details as unknown as { level?: string | number; message?: string; lineNumber?: number; sourceId?: string };
        if (d.level === 'error' || d.level === 3) {
          console.warn(`[Nexus page] ${d.message ?? ''}${d.sourceId ? ` (${d.sourceId}:${d.lineNumber ?? 0})` : ''}`);
        }
      });
    }
    const disk = ensureInjectionFileOnDisk();
    if ('error' in disk) return { ok: false, message: disk.error };
    try {
      let loadedOk = false;
      const injectErrors: string[] = [];
      const loaded = loadBrowseInjectionScript();
      if ('error' in loaded) {
        return { ok: false, message: loaded.error };
      }
      const tryLoad = async (label: string, fn: () => Promise<void>, waitMs: number) => {
        if (loadedOk) return;
        try {
          await fn();
          loadedOk = await waitForBrowseEnhancer(wc, waitMs);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          injectErrors.push(`${label}: ${msg}`);
          console.warn(`[Mod Hub] ${label} failed:`, err);
        }
      };
      await tryLoad(
        'modhub-inject',
        () => wc.executeJavaScript(buildInjectionLoaderScript('modhub-inject://browse.js'), true),
        6000,
      );
      await tryLoad(
        'file loader',
        () => wc.executeJavaScript(buildFileInjectionLoaderScript(disk.diskPath), true),
        6000,
      );
      await tryLoad(
        'eval inject',
        async () => {
          console.log('[Mod Hub] Injecting via eval from', loaded.source);
          await executeInjectionScript(wc, loaded.script);
        },
        20000,
      );
      if (!loadedOk && injectErrors.length > 0) {
        return {
          ok: false,
          message: `Injection failed (${injectErrors.join('; ')}). Open guest DevTools and check the console.`,
        };
      }
      if (!loadedOk) {
        return {
          ok: false,
          message:
            'Browse enhancer script did not register __vortexBrowseEnhancer. Open guest DevTools (right-click page → Inspect) and check for red errors.',
        };
      }
      const parsed = parseNexusBrowseUrl(pageUrl);
      if (parsed) {
        await wc.executeJavaScript(buildEnhancerUpdateScript(parsed.browseHref, parsed.gameDomain), true);
      }
      console.log(`[Mod Hub] Carousel enhancer active on ${pageUrl} (${path.basename(loaded.source)})`);
      return { ok: true, message: `Carousel enhancer active (${path.basename(loaded.source)}).` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  ipcMain.handle('modhub:workshopFavoriteInstall', (_e, appId: number, workshopId: string) => {
    const favId = `ws-${appId}-${workshopId}`;
    store.setFavorite(favId, true);
    store.addWorkshopInstallOnce(appId, workshopId);
    shell.openExternal(workshopSubscribeUrl(appId, workshopId));
    return {
      ok: true,
      message:
        'Favorited. Steam opened to download — after files land, Scan computer. Hub marks unsubscribed when the folder appears.',
    };
  });

  ipcMain.handle('modhub:nexusFetchTracked', async (_e, gameDomain: string) => {
    const settings = store.loadSettings();
    if (!settings.nexusApiKey) {
      return { ok: false, message: 'Add Nexus API key in Settings first.', modIds: [] };
    }
    return fetchTrackedModIds(settings.nexusApiKey, gameDomain);
  });

  ipcMain.handle('modhub:nexusFetchAllTracked', async () => {
    const settings = store.loadSettings();
    if (!settings.nexusApiKey) {
      return { ok: false, message: 'Add Nexus API key in Settings first.', mods: [] };
    }
    return fetchAllTrackedMods(settings.nexusApiKey);
  });

  ipcMain.handle('modhub:pickScanFolders', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('modhub:openSteamLogin', () => {
    shell.openExternal('https://steamcommunity.com/login/home/?goto=workshop%2Fbrowse');
    return { ok: true, message: 'Log in via browser; Workshop favorites use your Steam session there.' };
  });

  ipcMain.handle('modhub:openNexusLogin', () => {
    shell.openExternal('https://www.nexusmods.com/users/myaccount?tab=api+access');
    return { ok: true, message: 'Generate a personal API key for track/download integration.' };
  });
}
