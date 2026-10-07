export type ModSource =
  | 'steam-workshop'
  | 'nexus'
  | 'local'
  | 'vortex-staging'
  | 'unknown';

export type ViewMode = 'list' | 'grid' | 'carousel';

export interface GameRecord {
  id: string;
  name: string;
  steamAppId?: number;
  modFolderHints?: string[];
}

export interface ModRevision {
  kind: 'workshop_time_updated' | 'nexus_file_id' | 'folder_mtime' | 'unknown';
  value: string;
  remoteValue?: string;
  updateAvailable?: boolean;
}

export interface ModRecord {
  id: string;
  source: ModSource;
  gameId: string;
  steamAppId?: number;
  title: string;
  author?: string;
  authorSteamId?: string;
  authorDisplayName?: string;
  duplicateHint?: string;
  /** Other paths for the same Nexus mod (download vs deployed archive). */
  alternateLocalPaths?: string[];
  vortexMergeNote?: string;
  remoteCreatedAt?: string;
  gameVersionTags?: string[];
  workshopCategories?: string[];
  description?: string;
  version?: string;
  localPath: string;
  workshopId?: string;
  nexusModId?: number;
  nexusGameDomain?: string;
  modIds?: string[];
  iconPath?: string;
  previewPath?: string;
  remotePreviewUrl?: string;
  sizeBytes?: number;
  installedAt?: string;
  lastSeenAt?: string;
  remoteUpdatedAt?: string;
  downloadedAt?: string;
  favorited: boolean;
  subscribed?: boolean;
  revision: ModRevision;
  loadOrder?: number;
  enabled?: boolean;
  tags?: string[];
  /** Workshop API returned no public metadata (hidden/private/removed). */
  workshopHidden?: boolean;
  /** Nexus API status: published | hidden | not_published | removed | wastebinned … */
  nexusStatus?: string;
  /** Source archive/folder no longer exists on disk (row kept from Vortex records). */
  localMissing?: boolean;
  /** Local copy saved by Mod Hub before unsubscribing from the Workshop. */
  keptFromWorkshop?: { appId: number; workshopId: string };
  /** From Steam's appworkshop acf: false = downloaded by the game/a server without a subscription. */
  steamSubscribed?: boolean;
  /** remotePreviewUrl came from the Nexus API's picture_url (trusted even if the URL has another id). */
  remotePreviewFromApi?: boolean;
  /** Removed/hidden on the Workshop: details shown come from Mod Hub's last-known archive (see workshopArchive.ts). */
  workshopArchived?: { source: 'steam' | 'wayback' | 'manual'; savedAt: string; note?: string; requiredDlc?: string[] };
  /** Last Nexus API details call for this mod (ISO); fill-in skips it for a while if Nexus had nothing more. */
  nexusApiCheckedAt?: string;
  /** Same mod on the other platform, confirmed by the user (or a description link). */
  crossLinks?: {
    nexus?: { domain: string; modId: number; title?: string };
    workshop?: { appId: number; workshopId: string; title?: string };
  };
}

export interface ScanLocationReport {
  path: string;
  label: string;
  modCount: number;
}

export interface WorkshopEnrichStats {
  workshopIds: number;
  detailsFetched: number;
  appliedToMods: number;
  failedApiChunks?: number;
}

export interface ScanReport {
  libraries: string[];
  locations: ScanLocationReport[];
  bySource: Record<string, number>;
  byGame: Record<string, number>;
  durationMs?: number;
  workshopEnrich?: WorkshopEnrichStats;
}

export type WorkshopBrowseSort = 'trend' | 'recent' | 'subscribed' | 'rated';

export interface WorkshopBrowseQuery {
  appId: number;
  page?: number;
  numPerPage?: number;
  sort?: WorkshopBrowseSort;
  searchText?: string;
  categoryTag?: string;
}

export interface WorkshopBrowseItem {
  workshopId: string;
  appId: number;
  title: string;
  previewUrl?: string;
  author?: string;
  authorSteamId?: string;
  authorProfileUrl?: string;
  timeCreated?: number;
  timeUpdated?: number;
  gameVersionTags?: string[];
  workshopCategories?: string[];
  fileSize?: number;
  hiddenOnWorkshop?: boolean;
  votesUp?: number;
  votesDown?: number;
  /** 0–5 stars derived from Steam score or vote ratio. */
  starScore?: number;
}

export interface WorkshopBrowseResult {
  items: WorkshopBrowseItem[];
  page: number;
  appId: number;
  totalHint?: number;
  metadataMatched?: number;
  sourceUrl?: string;
  error?: string;
}

export interface SteamLibraryGame {
  appId: number;
  name: string;
  ownedOnDisk: boolean;
  localModCount: number;
  localWorkshopCount?: number;
  hasWorkshopBrowse?: boolean;
}

export interface ScanProgressEvent {
  phase: string;
  message: string;
  current?: number;
  total?: number;
  percent?: number;
}

export interface CatalogSnapshot {
  scannedAt: string;
  games: GameRecord[];
  mods: ModRecord[];
  scanReport?: ScanReport;
}

export interface HubSettings {
  steamLibraryPaths: string[];
  extraScanPaths: string[];
  nexusApiKey?: string;
  nexusConnected: boolean;
  steamSessionNote?: string;
  lastFullScan?: string;
  /** Default game filter for All mods / Steam (all | game id). */
  defaultGameFilter?: string;
  lastGameFilter?: string;
  lastSteamGameFilter?: string;
  workshopInstallOnce?: { appId: number; workshopId: string }[];
  /** Rows removed from Mod Hub by the user (`domain|nexusId` or mod id); never re-added by scans. */
  dismissedMods?: string[];
  /** Game ids hidden from all mod lists (undefined = defaults). */
  hiddenGames?: string[];
}

/** A mod's state in its game's own enabled list (read from the game's config, never from Mod Hub). */
export interface ModLoadState {
  enabled: boolean;
  /** 1-based position in the game's load order (enabled mods only). */
  position?: number;
}

/** Enabled mods + order for one game, as the game itself will load them. */
export interface GameLoadOrder {
  gameId: string;
  /** Human label for where this came from, e.g. "ModsConfig.xml". */
  sourceLabel: string;
  sourcePath: string;
  /** 'list' = the config file sets the order; 'folder-name' = the game loads by folder name (Isaac). */
  orderKind: 'list' | 'folder-name';
  /** Keyed by catalog mod id. Mods missing here aren't installed where the game looks. */
  mods: Record<string, ModLoadState>;
  enabledCount: number;
  /** Enabled entries with no matching catalog row: DLC/core, or mods that aren't installed. */
  unmatched: { id: string; position: number; note?: string }[];
  readAt: string;
  error?: string;
}

export interface OrderIssue {
  kind: 'dependency-missing' | 'dependency-off' | 'incompatible' | 'order' | 'cycle' | 'duplicate-id';
  /** Package id of the mod the issue is about. */
  modId: string;
  otherId?: string;
  message: string;
}

/** A checked load order and the closest order that satisfies every rule. */
export interface OrderPlan {
  gameId: string;
  current: string[];
  proposed: string[];
  /** Positions that change between current and proposed. */
  moved: number;
  issues: OrderIssue[];
}

/** A named mod list for one game (RimWorld .rml, PZ saved list / save, or a Mod Hub list). */
export interface Loadout {
  id: string;
  gameId: string;
  name: string;
  kind: 'game-list' | 'save' | 'modhub';
  kindLabel: string;
  path?: string;
  /** Mod ids in load order (Isaac: mod folder names). */
  ids: string[];
  modifiedAt?: string;
  gameVersion?: string;
  count: number;
  /** Ids in the list that aren't installed. */
  missing: string[];
  /** Compared with what the game has enabled right now. */
  toEnable: number;
  toDisable: number;
  isCurrent: boolean;
  canDelete: boolean;
}

export interface LoadoutsForGame {
  gameId: string;
  supported: boolean;
  /** The game's enabled list right now, in order. */
  current: string[];
  loadouts: Loadout[];
}

export interface ScanOptions {
  deepSize?: boolean;
  enrichWorkshop?: boolean;
  nexusApiKey?: string;
}

export interface NexusAuthStatus {
  connected: boolean;
  message: string;
}

export interface SteamAuthStatus {
  connected: boolean;
  message: string;
  steamPath?: string;
}

export type IpcApi = {
  scanAll: (options?: ScanOptions) => Promise<CatalogSnapshot>;
  getCatalog: () => Promise<CatalogSnapshot>;
  getSettings: () => Promise<HubSettings>;
  saveSettings: (partial: Partial<HubSettings>) => Promise<HubSettings>;
  setFavorite: (modId: string, favorited: boolean) => Promise<ModRecord | null>;
  setSubscribed: (modId: string, subscribed: boolean) => Promise<ModRecord | null>;
  workshopUnsubscribe: (modId: string, keepCopy: boolean) => Promise<{ ok: boolean; message: string }>;
  workshopDeleteLocal: (
    modIds: string[],
  ) => Promise<{ ok: boolean; message: string; deleted: number; bytes: number }>;
  dismissMod: (modId: string) => Promise<{ ok: boolean; message: string }>;
  getModMedia: (
    modId: string,
  ) => Promise<{ images: { src: string; local: boolean }[]; videos: string[]; description?: string; errors: string[] }>;
  openInSteam: (url: string) => Promise<void>;
  getModChanges: (modId: string) => Promise<{
    source: 'workshop' | 'nexus' | 'none';
    installed: { when?: string; version?: string };
    latest: { when?: string; version?: string };
    entries: { when?: string; version?: string; notes: string; isNew: boolean }[];
    pageUrl?: string;
    error?: string;
  }>;
  workshopUpdate: (modId: string) => Promise<{ ok: boolean; message: string }>;
  findCrossPlatform: (modId: string) => Promise<{
    candidates: {
      platform: 'nexus' | 'workshop';
      id: string;
      title: string;
      author?: string;
      url: string;
      imageUrl?: string;
      updatedAt?: string;
      score: number;
      linked?: boolean;
      local?: string;
      domain?: string;
      appId?: number;
    }[];
    searched: string[];
    error?: string;
  }>;
  linkCrossPlatform: (
    modId: string,
    link: { platform: 'nexus' | 'workshop'; id: string; domain?: string; appId?: number; title?: string } | null,
    platformToClear?: 'nexus' | 'workshop',
  ) => Promise<{ ok: boolean; message: string }>;
  getDiskInfo: (modId: string) => Promise<{
    exists: boolean;
    createdAt?: string;
    newestAt?: string;
    newestFile?: string;
    oldestAt?: string;
    files: number;
    bytes: number;
  }>;
  workshopBulkKeep: (modIds: string[]) => Promise<{ ok: boolean; message: string; kept: number; failed: number }>;
  onBulkProgress: (handler: (p: { done: number; total: number; current: string; phase: string }) => void) => () => void;
  onCatalogUpdated: (handler: () => void) => () => void;
  checkWorkshopUpdates: (gameSteamAppId?: number) => Promise<ModRecord[]>;
  getThumbnail: (filePath: string) => Promise<string | null>;
  /** Read-only: each supported game's enabled mods and load order (RimWorld, Project Zomboid, Isaac). */
  getLoadOrders: () => Promise<Record<string, GameLoadOrder>>;
  /** Turn mods on/off in the game's own list (refuses while the game runs; backs up config files first). */
  setModsEnabled: (gameId: string, modIds: string[], enabled: boolean) => Promise<{ ok: boolean; message: string; changed: number }>;
  getLoadouts: (gameId: string) => Promise<LoadoutsForGame>;
  /** RimWorld: check an order (default: the active list) and get the closest rule-satisfying order. */
  planLoadOrder: (gameId: string, order?: string[]) => Promise<OrderPlan | null>;
  /** Save a reordered enabled list (same mods, new order). */
  setLoadOrder: (gameId: string, ids: string[]) => Promise<{ ok: boolean; message: string; changed: number }>;
  applyLoadout: (gameId: string, loadoutId: string) => Promise<{ ok: boolean; message: string }>;
  saveLoadout: (gameId: string, name: string) => Promise<{ ok: boolean; message: string }>;
  deleteLoadout: (gameId: string, loadoutId: string) => Promise<{ ok: boolean; message: string }>;
  /** Overwrite a saved list with the current enabled mods. */
  updateLoadout: (gameId: string, loadoutId: string) => Promise<{ ok: boolean; message: string }>;
  /** Cover art from the Steam client's local library cache (works for new games with hashed store URLs). */
  getSteamGameArt: (appId: number) => Promise<string | null>;
  fetchRemoteThumbnail: (url: string) => Promise<string | null>;
  steamSubscribe: (appId: number, workshopId: string) => Promise<{ ok: boolean; message: string }>;
  steamOpenWorkshop: (appId: number, workshopId: string) => Promise<void>;
  nexusOpenMod: (gameDomain: string, modId: number) => Promise<void>;
  nexusDownloadMod: (gameDomain: string, modId: number) => Promise<{ ok: boolean; message: string }>;
  nexusTrackMod: (gameDomain: string, modId: number, track: boolean) => Promise<{ ok: boolean; message: string }>;
  openPath: (filePath: string) => Promise<void>;
  pickScanFolders: () => Promise<string[]>;
  onScanProgress: (handler: (event: ScanProgressEvent) => void) => () => void;
  workshopBrowse: (query: WorkshopBrowseQuery) => Promise<WorkshopBrowseResult>;
  getSteamLibraryGames: () => Promise<SteamLibraryGame[]>;
  getFavoriteIds: () => Promise<string[]>;
  getBrowseInjectionScript: () => Promise<{ script: string; source: string } | { error: string }>;
  injectBrowseEnhancer: (guestWebContentsId: number, pageUrl: string) => Promise<{ ok: boolean; message: string }>;
  workshopFavoriteInstall: (appId: number, workshopId: string) => Promise<{ ok: boolean; message: string }>;
  nexusFetchTracked: (gameDomain: string) => Promise<{ ok: boolean; message: string; modIds?: number[] }>;
  nexusFetchAllTracked: () => Promise<{
    ok: boolean;
    message: string;
    mods: Array<{ domain: string; modId: number }>;
  }>;
};

declare global {
  interface Window {
    modHub: IpcApi;
  }
}
