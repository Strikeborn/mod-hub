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
  /** Current version on Nexus (v2 GraphQL) and whether it's newer than the installed `version`. */
  nexusLatestVersion?: string;
  nexusUpdateAvailable?: boolean;
  nexusCheckedAt?: string;
  /** Nexus popularity (v2 GraphQL), refreshed with the update check. */
  nexusEndorsements?: number;
  nexusDownloads?: number;
  /** Installed in a Mod Organizer 2 instance (MO2 owns its profiles; Mod Hub reads them). */
  mo2?: { instance: string; name: string; newestVersion?: string };
  /** Minecraft mod in a Prism Launcher instance (file = jar name without ".disabled"). */
  prism?: {
    instance: string;
    instanceName: string;
    file: string;
    enabled: boolean;
    loader?: string;
    mcVersion?: string;
    modrinthId?: string;
    curseforgeId?: string;
    sha1?: string;
    /** Newer compatible version on Modrinth (set by the update check). */
    latestVersion?: string;
  };
  /** Installed through r2modman / Thunderstore Mod Manager (read-only; the manager owns the profile). */
  thunderstore?: { packageName: string; profile: string; websiteUrl?: string; enabled: boolean };
  /** Steam Workshop votes (via the Steam client), refreshed at most daily. */
  workshopVotesUp?: number;
  workshopVotesDown?: number;
  workshopVotesAt?: string;
  /** Removed Workshop mods: same-title items found on the Workshop (suggestions only, never auto-subscribed). */
  reuploadCandidates?: ReuploadCandidate[];
  reuploadCheckedAt?: string;
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
  /** Last Workshop votes refresh through the Steam client (ISO). */
  lastWorkshopVotesAt?: string;
  /** Last "update on Nexus" check (ISO). */
  lastNexusUpdateCheck?: string;
  /** Duplicates tab: groups (sorted mod ids joined by +) the user marked as not duplicates. */
  ignoredDuplicateGroups?: string[];
  /** Background checks (defaults: on, Nexus every 6 h). Steam-client checks briefly show you "in game". */
  workshopRatingsEnabled?: boolean;
  reuploadSearchEnabled?: boolean;
  nexusUpdateChecksEnabled?: boolean;
  nexusUpdateIntervalHours?: number;
  /** Malware checks: VirusTotal key (hash lookups only, never uploads), automatic checks of new/changed mods. */
  virusTotalApiKey?: string;
  securityAutoCheck?: boolean;
  /** Isaac: switch REPENTOGON's LuaDebug back off whenever it's found on (default on). */
  isaacLuaDebugGuard?: boolean;
  /** Mods installed before this date aren't auto-scanned (set when checks were first enabled). */
  securityBaseline?: string;
  /** Play: last launch method (and MO2 profile) per game. */
  playChoices?: Record<string, { optionId: string; profile?: string }>;
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

export interface SecurityDefender {
  status: 'clean' | 'threat' | 'unavailable' | 'skipped';
  detail?: string;
}

export interface SecurityVirusTotal {
  status: 'clean' | 'flagged' | 'unknown' | 'no-key' | 'error' | 'skipped';
  malicious?: number;
  suspicious?: number;
  engines?: number;
  detail?: string;
}

/** clean / review (1–2 engines flag it) / flagged (3+) / threat (Defender) / unavailable / unchecked. */
export type SecurityStatus = 'clean' | 'review' | 'flagged' | 'threat' | 'unavailable' | 'unchecked';

export interface ModSecurityReport {
  modId: string;
  checkedAt: string;
  defender: SecurityDefender;
  /** The mod's download archive (Vortex/Nexus zip), when it's on disk. */
  archive?: { path: string; sha256: string; virusTotal: SecurityVirusTotal };
  /** Programs, DLL/ASI plugins and Windows scripts inside the mod (first 25). */
  executables: { rel: string; size: number; sha256: string; virusTotal: SecurityVirusTotal }[];
  executableCount: number;
  signature: string;
  status: SecurityStatus;
}

/** Result of "Scan all mod folders" (one Defender scan per mod location). */
export interface DefenderSweep {
  startedAt: string;
  finishedAt: string;
  complete: boolean;
  roots: { label: string; dir: string; status: SecurityDefender['status']; seconds: number }[];
  threats: { threat: string; file: string; modId?: string; modTitle?: string }[];
}

/** Newest Crash Logger log for a game, with likely culprits mapped to library mods. */
export interface CrashReport {
  gameId: string;
  file: string;
  at: string;
  /** How many crash logs exist in total. */
  total: number;
  exception?: string;
  gameVersion?: string;
  suspects: { kind: 'dll' | 'plugin'; name: string; count: number; modId?: string; modTitle?: string }[];
}

/** One way to start a game (best first). */
export interface PlayOption {
  id: string;
  label: string;
  kind: 'steam' | 'exe' | 'mo2' | 'prism';
  command: string;
  args: string[];
  recommended?: boolean;
  note?: string;
  /** MO2 profiles / Prism instances to pick from, and the default one. */
  profiles?: string[];
  profile?: string;
}

export interface PlayInfo {
  gameId: string;
  options: PlayOption[];
  /** Remembered choice for this game. */
  chosenId?: string;
  chosenProfile?: string;
  running: boolean;
  /** Things worth knowing before launching (order problems, conflicts, two mod managers…). */
  warnings: string[];
  /** Steam has an update waiting for this game (a Steam launch installs it first). */
  steamUpdatePending?: { bytes?: number; autoUpdate?: string };
}

export interface IsaacConflictSide {
  folder: string;
  modId?: string;
  title: string;
}

/** Two enabled Isaac mods shipping the same resource files; `winner` loads first, so its files are used. */
export interface IsaacConflictPair {
  winner: IsaacConflictSide;
  loser: IsaacConflictSide;
  fileCount: number;
  sampleFiles: string[];
}

export interface IsaacConflicts {
  pairs: IsaacConflictPair[];
  /** One Workshop item in 2+ folders (author renamed the mod; Isaac kept the old copy). Newest first. */
  renamedCopies: { workshopId: string; folders: { folder: string; enabled: boolean; changedAt: string }[] }[];
  /** By catalog mod id: files it wins / loses, and against which mods. */
  perMod: Record<string, { wins: number; losses: number; winsOver: string[]; lostTo: string[] }>;
  filesChecked: number;
  modsChecked: number;
}

export interface ReuploadCandidate {
  workshopId: string;
  appId: number;
  title: string;
  ownerSteamId?: string;
  ownerName?: string;
  /** Compared with the removed mod's author (Steam id, or name from the archive). */
  sameAuthor: 'yes' | 'no' | 'unknown';
  titleMatch: 'exact' | 'close';
  createdAt?: string;
  votesUp?: number;
  votesDown?: number;
  previewUrl?: string;
  /** Already in your library (subscribed or kept). */
  installed?: boolean;
}

/** A mod's state in its game's own enabled list (read from the game's config, never from Mod Hub). */
export interface ModLoadState {
  enabled: boolean;
  /** 1-based position in the game's load order (enabled mods only). */
  position?: number;
  /** Another tool owns this list (BG3: Vortex writes modsettings.lsx), so Mod Hub only shows it. */
  readOnly?: boolean;
  /** Who owns it when read-only (shown next to the state). Default "Vortex". */
  lockedBy?: string;
  /** Entries in the game's list that belong to this mod (Skyrim: its .esp/.esm/.esl plugins). */
  items?: string[];
  /** Short explanation shown under the state (plugins on/off, SKSE DLLs). */
  note?: string;
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
  /** Another tool owns this list (BG3 → Vortex); Mod Hub shows it but doesn't change it. */
  readOnly?: boolean;
  /** Plugins the game always loads first (Skyrim: base game, DLC, Creation Club); they take positions 1..n. */
  implicit?: string[];
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
  /** Lists owned by another tool (MO2): Mod Hub picks one for Play instead of rewriting it. */
  managedBy?: 'mo2';
  /** Installed mods that can be added to a list (id as the list stores it + display title). */
  candidates?: { id: string; title: string }[];
  /** MO2 lists can be edited (Skyrim: plugins + MO2 mods per profile). */
  editable?: boolean;
  /** Mods that load in every profile (Vortex-deployed, no plugin), so lists don't count them. */
  alwaysOn?: number;
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
  onToast: (handler: (t: { message: string; kind?: 'ok' | 'error' | 'info' }) => void) => () => void;
  checkWorkshopUpdates: (gameSteamAppId?: number) => Promise<ModRecord[]>;
  getThumbnail: (filePath: string) => Promise<string | null>;
  /** Read-only: each supported game's enabled mods and load order (RimWorld, Project Zomboid, Isaac). */
  getLoadOrders: () => Promise<Record<string, GameLoadOrder>>;
  /** Enabled Isaac mods that replace the same resource files (winner = earlier in folder-name order). */
  getIsaacConflicts: () => Promise<IsaacConflicts>;
  /** Launch options + pre-launch checks for a game. */
  getPlayInfo: (gameId: string) => Promise<PlayInfo>;
  /** Malware check of one mod (Defender + VirusTotal hash lookups). */
  checkModSecurity: (modId: string) => Promise<ModSecurityReport | { error: string }>;
  getSecurityReport: (modId: string) => Promise<ModSecurityReport | null>;
  /** Per mod: last status, executable count, whether files changed since. */
  getSecurityOverview: () => Promise<Record<string, { status: SecurityStatus; executables: number; stale: boolean; checkedAt?: string; lua?: string[] }>>;
  /** Check every mod that contains programs/DLLs/scripts (background; progress via toasts). */
  checkAllExecutableMods: () => Promise<{ ok: boolean; message: string }>;
  openVirusTotal: (sha256: string) => Promise<void>;
  stopSecurityChecks: () => Promise<{ ok: boolean; message: string }>;
  /** Defender scan of every mod location (background; progress via onSecurityProgress). */
  defenderSweep: () => Promise<{ ok: boolean; message: string }>;
  getLastSweep: () => Promise<DefenderSweep | null>;
  onSecurityProgress: (handler: (p: { done: number; total: number; current: string; running: boolean }) => void) => () => void;
  /** Installed Steam games with an update waiting (appId -> download size). */
  getSteamUpdates: (appIds: number[]) => Promise<Record<number, { bytes?: number }>>;
  /** Isaac: add/remove disable.it for one mods folder (game must be closed). */
  setIsaacFolderEnabled: (folder: string, enabled: boolean) => Promise<{ ok: boolean; message: string }>;
  /** Open a Workshop search for `text` in the Steam client. */
  openWorkshopSearch: (appId: number, text: string) => Promise<void>;
  /** Start the game through the chosen option (remembered for next time). */
  playGame: (gameId: string, optionId: string, profile?: string) => Promise<{ ok: boolean; message: string }>;
  /** Turn mods on/off in the game's own list (refuses while the game runs; backs up config files first). */
  setModsEnabled: (gameId: string, modIds: string[], enabled: boolean) => Promise<{ ok: boolean; message: string; changed: number }>;
  getLoadouts: (gameId: string) => Promise<LoadoutsForGame>;
  /** RimWorld: check an order (default: the active list) and get the closest rule-satisfying order. */
  planLoadOrder: (gameId: string, order?: string[]) => Promise<OrderPlan | null>;
  /** Save a reordered enabled list (same mods, new order). */
  setLoadOrder: (gameId: string, ids: string[]) => Promise<{ ok: boolean; message: string; changed: number }>;
  /** Remember the ▶ Play launcher/profile (Skyrim: also picks which plugin list the library shows). */
  setPlayChoice: (gameId: string, optionId: string, profile?: string) => Promise<void>;
  /** Open the game's plugin sorter (MO2 → Sort runs LOOT; standalone LOOT if installed). */
  openSortTool: (gameId: string) => Promise<{ ok: boolean; message: string }>;
  /** Compare (apply=false) or copy plugin on/off between Vortex's plugins.txt and the MO2 profile. */
  pluginSync: (
    gameId: string,
    direction: 'vortex-to-mo2' | 'mo2-to-vortex',
    apply: boolean,
  ) => Promise<{ ok: boolean; message: string; changed: number; differences: { name: string; vortex: boolean; mo2: boolean }[] }>;
  getCrashReport: (gameId: string) => Promise<CrashReport | null>;
  applyLoadout: (gameId: string, loadoutId: string) => Promise<{ ok: boolean; message: string }>;
  saveLoadout: (gameId: string, name: string) => Promise<{ ok: boolean; message: string }>;
  deleteLoadout: (gameId: string, loadoutId: string) => Promise<{ ok: boolean; message: string }>;
  /** Overwrite a saved list with the current enabled mods. */
  updateLoadout: (gameId: string, loadoutId: string) => Promise<{ ok: boolean; message: string }>;
  /** Replace a saved list's mods (added / removed / reordered in the editor). */
  editLoadout: (gameId: string, loadoutId: string, ids: string[]) => Promise<{ ok: boolean; message: string }>;
  /** PZ: make one save load a list. */
  applyLoadoutToSave: (loadoutId: string, saveId: string) => Promise<{ ok: boolean; message: string }>;
  exportLoadoutCode: (gameId: string, loadoutId: string) => Promise<{ ok: boolean; message: string; code?: string }>;
  importLoadoutCode: (code: string) => Promise<{ ok: boolean; message: string; gameId?: string }>;
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
