import fs from 'node:fs';
import path from 'node:path';
import type { CatalogSnapshot, HubSettings, ModRecord, ScanReport } from '../shared/types';
import { GAMES_REGISTRY } from './gamesRegistry';
import { applyDuplicateHints } from './dedupeMods';
import { isGuess404NexusThumb } from './nexusImageIds';

const DEFAULT_SETTINGS: HubSettings = {
  steamLibraryPaths: [],
  extraScanPaths: [],
  nexusConnected: false,
  defaultGameFilter: 'all',
};

export class CatalogStore {
  private dataDir: string;
  private catalogPath: string;
  private settingsPath: string;
  private favoritesPath: string;
  private unsubscribedPath: string;

  constructor(userDataPath: string) {
    this.dataDir = userDataPath;
    this.catalogPath = path.join(userDataPath, 'catalog.json');
    this.settingsPath = path.join(userDataPath, 'settings.json');
    this.favoritesPath = path.join(userDataPath, 'favorites.json');
    this.unsubscribedPath = path.join(userDataPath, 'unsubscribed.json');
    fs.mkdirSync(userDataPath, { recursive: true });
  }

  loadSettings(): HubSettings {
    try {
      if (fs.existsSync(this.settingsPath)) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(this.settingsPath, 'utf8')) };
      }
    } catch {
      /* ignore */
    }
    return { ...DEFAULT_SETTINGS };
  }

  saveSettings(partial: Partial<HubSettings>): HubSettings {
    const next = { ...this.loadSettings(), ...partial };
    fs.writeFileSync(this.settingsPath, JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  loadFavorites(): Set<string> {
    try {
      if (fs.existsSync(this.favoritesPath)) {
        const arr = JSON.parse(fs.readFileSync(this.favoritesPath, 'utf8')) as string[];
        return new Set(arr);
      }
    } catch {
      /* ignore */
    }
    return new Set();
  }

  saveFavorites(ids: Set<string>) {
    fs.writeFileSync(this.favoritesPath, JSON.stringify([...ids], null, 2), 'utf8');
  }

  setFavorite(modId: string, favorited: boolean): void {
    const fav = this.loadFavorites();
    if (favorited) fav.add(modId);
    else fav.delete(modId);
    this.saveFavorites(fav);
  }

  loadUnsubscribed(): Set<string> {
    try {
      if (fs.existsSync(this.unsubscribedPath)) {
        return new Set(JSON.parse(fs.readFileSync(this.unsubscribedPath, 'utf8')) as string[]);
      }
    } catch {
      /* ignore */
    }
    return new Set();
  }

  saveUnsubscribed(ids: Set<string>) {
    fs.writeFileSync(this.unsubscribedPath, JSON.stringify([...ids], null, 2), 'utf8');
  }

  setSubscribed(modId: string, subscribed: boolean): void {
    const unsub = this.loadUnsubscribed();
    if (subscribed) unsub.delete(modId);
    else unsub.add(modId);
    this.saveUnsubscribed(unsub);
  }

  loadCatalog(): CatalogSnapshot {
    try {
      if (fs.existsSync(this.catalogPath)) {
        return JSON.parse(fs.readFileSync(this.catalogPath, 'utf8')) as CatalogSnapshot;
      }
    } catch {
      /* ignore */
    }
    return { scannedAt: '', games: GAMES_REGISTRY, mods: [] };
  }

  saveCatalog(snapshot: CatalogSnapshot) {
    fs.writeFileSync(this.catalogPath, JSON.stringify(snapshot, null, 2), 'utf8');
  }

  mergeScanResults(mods: ModRecord[], scanReport?: ScanReport): CatalogSnapshot {
    const fav = this.loadFavorites();
    const unsub = this.loadUnsubscribed();
    const prev = this.loadCatalog();
    const prevByPath = new Map(prev.mods.map((m) => [m.localPath.toLowerCase(), m]));
    const prevByNexus = new Map<string, ModRecord>();
    for (const m of prev.mods) {
      if (m.nexusModId && m.nexusGameDomain) {
        prevByNexus.set(`${m.nexusGameDomain}|${m.nexusModId}`, m);
      }
    }

    const settings = this.loadSettings();
    const installOnce = settings.workshopInstallOnce ?? [];

    const merged = mods.map((m) => {
      const oldByPath = prevByPath.get(m.localPath.toLowerCase());
      const oldByNexus =
        m.nexusModId && m.nexusGameDomain
          ? prevByNexus.get(`${m.nexusGameDomain}|${m.nexusModId}`)
          : undefined;
      const old = oldByPath ?? oldByNexus;
      const favorited = fav.has(m.id) || old?.favorited || false;
      const onDiskWorkshop = m.source === 'steam-workshop';
      let subscribed = onDiskWorkshop
        ? m.steamSubscribed === undefined
          ? !unsub.has(m.id)
          : m.steamSubscribed
        : subscribedOverride(m.id, unsub, old?.subscribed);
      if (
        onDiskWorkshop &&
        m.workshopId &&
        m.steamAppId &&
        installOnce.some((x) => x.workshopId === m.workshopId && x.appId === m.steamAppId)
      ) {
        subscribed = false;
        unsub.add(m.id);
      }
      let remotePreviewUrl = m.remotePreviewUrl || oldByNexus?.remotePreviewUrl || oldByPath?.remotePreviewUrl;
      if (isGuess404NexusThumb(remotePreviewUrl)) remotePreviewUrl = undefined;

      return {
        ...m,
        favorited,
        subscribed,
        downloadedAt: old?.downloadedAt ?? m.installedAt,
        remotePreviewUrl,
        previewPath: m.previewPath || oldByNexus?.previewPath || oldByPath?.previewPath,
        iconPath: m.iconPath || oldByNexus?.iconPath || oldByPath?.iconPath,
        remoteCreatedAt: m.remoteCreatedAt || oldByNexus?.remoteCreatedAt || oldByPath?.remoteCreatedAt,
        remoteUpdatedAt: m.remoteUpdatedAt || oldByNexus?.remoteUpdatedAt || oldByPath?.remoteUpdatedAt,
      };
    });

    const dismissed = new Set(settings.dismissedMods ?? []);
    if (dismissed.size) {
      for (let i = merged.length - 1; i >= 0; i--) {
        const m = merged[i];
        const key = m.nexusModId && m.nexusGameDomain ? `${m.nexusGameDomain.toLowerCase()}|${m.nexusModId}` : m.id;
        if (dismissed.has(key)) merged.splice(i, 1);
      }
    }
    const mergedPaths = new Set(merged.map((m) => m.localPath.toLowerCase()));
    for (const old of prev.mods) {
      if (!old.keptFromWorkshop || mergedPaths.has(old.localPath.toLowerCase())) continue;
      if (fs.existsSync(old.localPath)) merged.push(old);
    }

    applyDuplicateHints(merged);

    const snapshot: CatalogSnapshot = {
      scannedAt: new Date().toISOString(),
      games: GAMES_REGISTRY,
      mods: merged,
      scanReport: scanReport ?? prev.scanReport,
    };
    this.saveCatalog(snapshot);
    if (installOnce.length > 0) {
      const remaining = installOnce.filter(
        (x) =>
          !merged.some(
            (m) => m.workshopId === x.workshopId && m.steamAppId === x.appId && m.source === 'steam-workshop',
          ),
      );
      settings.workshopInstallOnce = remaining;
    }
    settings.lastFullScan = snapshot.scannedAt;
    this.saveSettings(settings);
    this.saveUnsubscribed(unsub);
    return snapshot;
  }

  addWorkshopInstallOnce(appId: number, workshopId: string) {
    const settings = this.loadSettings();
    const list = settings.workshopInstallOnce ?? [];
    if (!list.some((x) => x.appId === appId && x.workshopId === workshopId)) {
      list.push({ appId, workshopId });
      settings.workshopInstallOnce = list;
      this.saveSettings(settings);
    }
  }

  updateMod(modId: string, patch: Partial<ModRecord>): ModRecord | null {
    const cat = this.loadCatalog();
    const idx = cat.mods.findIndex((m) => m.id === modId);
    if (idx < 0) return null;
    cat.mods[idx] = { ...cat.mods[idx], ...patch };
    this.saveCatalog(cat);
    return cat.mods[idx];
  }
}

function subscribedOverride(modId: string, unsub: Set<string>, prev?: boolean): boolean {
  if (unsub.has(modId)) return false;
  return prev ?? false;
}
