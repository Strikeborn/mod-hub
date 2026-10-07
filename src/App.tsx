import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogSnapshot, GameLoadOrder, ModLoadState, ModRecord, OrderPlan, ScanProgressEvent, ViewMode } from '@shared/types';
import { isNexusLikeSource } from './utils/games';
import { prefetchModThumbnails } from './utils/prefetchThumbnails';
import { Sidebar } from './components/Sidebar';
import { ScanProgressPanel } from './components/ScanProgressPanel';
import { HiddenGamesBar } from './components/HiddenGamesBar';
import { UnsubscribeDialog } from './components/UnsubscribeDialog';
import { DeleteLocalDialog } from './components/DeleteLocalDialog';
import { ToastHost } from './components/ToastHost';
import { ModDetailPanel } from './components/ModDetailPanel';
import { BulkKeepDialog } from './components/BulkKeepDialog';
import { onOpenModDetails } from './utils/modDetails';
import { setSimilarModsSource } from './utils/similarMods';
import { toast } from './utils/toast';
import { displayGameName } from './utils/gameDisplay';
import { workshopDisplayTitle } from './utils/workshopLabels';
import { HubNavigationProvider, useHubNavigation } from './context/HubNavigation';
import { LibraryView } from './views/LibraryView';
import { SteamView } from './views/SteamView';
import { NexusView } from './views/NexusView';
import { GamesView } from './views/GamesView';
import { LoadoutsView } from './views/LoadoutsView';
import { SettingsView } from './views/SettingsView';

const emptyCatalog: CatalogSnapshot = { scannedAt: '', games: [], mods: [] };
const DEFAULT_HIDDEN_GAMES = ['steam-241100'];

function resolveDefaultFilter(settings: {
  defaultGameFilter?: string;
  lastGameFilter?: string;
  lastSteamGameFilter?: string;
}): { library: string; steam: string } {
  const pick = (last?: string) => {
    if (settings.defaultGameFilter === 'last' && last) return last;
    if (settings.defaultGameFilter && settings.defaultGameFilter !== 'all') return settings.defaultGameFilter;
    return 'all';
  };
  return {
    library: pick(settings.lastGameFilter),
    steam: pick(settings.lastSteamGameFilter),
  };
}

const ISSUE_LABELS: Record<OrderPlan['issues'][number]['kind'], string> = {
  order: 'Order',
  'dependency-missing': 'Missing',
  'dependency-off': 'Not enabled',
  incompatible: 'Incompatible',
  'duplicate-id': 'Duplicate',
  cycle: 'Conflict',
};

/** RimWorld package ids compare case-insensitively; a Workshop duplicate may carry a _steam suffix. */
const rwNorm = (id: string) => id.toLowerCase().replace(/_steam$/, '');

/** Same function identity across renders (calls the latest closure), so memoized cards don't re-render. */
// oxlint-disable-next-line no-explicit-any
function useStableCallback<T extends (...args: any[]) => unknown>(fn: T): T {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback(((...args: Parameters<T>) => ref.current(...args)) as T, []);
}

function AppInner() {
  const { tab, setTab, gameFilter, setGameFilter, steamGameFilter, setSteamGameFilter } = useHubNavigation();
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [query, setQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('modhub.sidebarCollapsed') === '1';
    } catch {
      return false;
    }
  });
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => {
      try {
        localStorage.setItem('modhub.sidebarCollapsed', c ? '0' : '1');
      } catch {
        /* view preference only */
      }
      return !c;
    });
  }, []);
  // Typing updates the box immediately; filtering 1,600+ cards follows at lower priority.
  const deferredQuery = useDeferredValue(query);
  const [inGameFilter, setInGameFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [sortMode, setSortMode] = useState<'title' | 'load-order'>('title');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'nexus-vortex' | 'steam-workshop' | 'local' | 'other'>(
    'all',
  );
  const [catalog, setCatalog] = useState<CatalogSnapshot>(emptyCatalog);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState('');
  const [scanProgress, setScanProgress] = useState<ScanProgressEvent | null>(null);
  const scanStartedAt = useRef<number | null>(null);
  const statusDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtersBootstrapped = useRef(false);
  const [trackedNexus, setTrackedNexus] = useState<Set<string>>(new Set());
  const [hiddenGames, setHiddenGames] = useState<string[]>(DEFAULT_HIDDEN_GAMES);
  const [unsubTarget, setUnsubTarget] = useState<ModRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ModRecord | null>(null);
  const [detailMod, setDetailMod] = useState<ModRecord | null>(null);
  const [bulkKeepOpen, setBulkKeepOpen] = useState(false);

  useEffect(() => onOpenModDetails(setDetailMod), []);
  setSimilarModsSource(catalog.mods);

  function updateHiddenGames(next: string[]) {
    const added = next.find((g) => !hiddenGames.includes(g));
    const removed = hiddenGames.find((g) => !next.includes(g));
    const name = (id: string) => displayGameName({ gameId: id }, catalog.games);
    const removedAll = hiddenGames.filter((g) => !next.includes(g));
    if (added) toast(`Hid ${name(added)}.`);
    else if (removedAll.length > 1) toast(`Showing ${removedAll.length} games again.`);
    else if (removed) toast(`Showing ${name(removed)} again.`);
    setHiddenGames(next);
    void window.modHub?.saveSettings({ hiddenGames: next });
  }

  const refreshTrackedNexus = useCallback(async () => {
    if (!window.modHub?.nexusFetchAllTracked) return;
    const r = await window.modHub.nexusFetchAllTracked();
    if (!r.ok) return;
    setTrackedNexus(new Set(r.mods.map((m) => `${m.domain.toLowerCase()}|${m.modId}`)));
  }, []);
  const inElectron =
    typeof window !== 'undefined' &&
    (Boolean(window.modHub) ||
      Boolean((window as Window & { modHubEnv?: { isElectron?: boolean } }).modHubEnv?.isElectron));

  const [loadOrders, setLoadOrders] = useState<Record<string, GameLoadOrder>>({});
  const refreshLoadOrders = useCallback(async () => {
    if (!window.modHub?.getLoadOrders) return;
    try {
      setLoadOrders(await window.modHub.getLoadOrders());
    } catch {
      /* keep the last good read */
    }
  }, []);

  const reload = useCallback(async () => {
    if (!window.modHub) return;
    const c = await window.modHub.getCatalog();
    setCatalog(c);
    void refreshLoadOrders();
  }, [refreshLoadOrders]);

  // The enabled list can change in-game (mod menu); re-read when Mod Hub regains focus.
  useEffect(() => {
    const onFocus = () => void refreshLoadOrders();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshLoadOrders]);

  /** Catalog mod id -> its state in the game's own enabled list (only for supported games). */
  const savedLoadStates = useMemo(() => {
    const map = new Map<string, ModLoadState>();
    for (const g of Object.values(loadOrders)) for (const [id, st] of Object.entries(g.mods)) map.set(id, st);
    return map;
  }, [loadOrders]);

  // RimWorld order being edited (drag / auto-sort) but not saved yet: the full active list incl. Core/DLC.
  const [pendingOrder, setPendingOrder] = useState<{ ids: string[]; base: string[] } | null>(null);
  const [orderPlan, setOrderPlan] = useState<OrderPlan | null>(null);
  const [showOrderIssues, setShowOrderIssues] = useState(false);

  /** What the views show: saved states, with positions from the pending order while one is being edited. */
  const loadStates = useMemo(() => {
    if (!pendingOrder) return savedLoadStates;
    const pos = new Map(pendingOrder.ids.map((id, i) => [rwNorm(id), i + 1]));
    const map = new Map(savedLoadStates);
    for (const m of catalog.mods) {
      if (m.gameId !== 'rimworld') continue;
      const st = map.get(m.id);
      if (!st?.enabled) continue;
      const p = Math.min(...(m.modIds ?? []).map((x) => pos.get(rwNorm(x)) ?? Infinity));
      if (Number.isFinite(p)) map.set(m.id, { ...st, position: p });
    }
    return map;
  }, [pendingOrder, savedLoadStates, catalog.mods]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => window.modHub?.onCatalogUpdated?.(() => void reload()), [reload]);

  useEffect(() => {
    void refreshTrackedNexus();
  }, [refreshTrackedNexus, catalog.scannedAt]);

  useEffect(() => {
    if (catalog.mods.length === 0) return;
    const hidden = new Set(hiddenGames);
    prefetchModThumbnails(catalog.mods.filter((m) => !hidden.has(m.gameId)));
  }, [catalog.mods, catalog.scannedAt, hiddenGames]);

  useEffect(() => {
    if (!window.modHub || filtersBootstrapped.current) return;
    window.modHub.getSettings().then((s) => {
      const { library, steam } = resolveDefaultFilter(s);
      setHiddenGames(s.hiddenGames ?? DEFAULT_HIDDEN_GAMES);
      setGameFilter(library);
      setSteamGameFilter(steam);
      filtersBootstrapped.current = true;
    });
  }, [setGameFilter, setSteamGameFilter]);

  useEffect(() => {
    if (!window.modHub) return;
    return window.modHub.onScanProgress((event) => {
      setScanProgress(event);
      if (event.phase !== 'done') setStatus(event.message);
    });
  }, []);

  useEffect(() => {
    if (scanning || !status) return;
    if (statusDismissRef.current) clearTimeout(statusDismissRef.current);
    statusDismissRef.current = setTimeout(() => setStatus(''), 5000);
    return () => {
      if (statusDismissRef.current) clearTimeout(statusDismissRef.current);
    };
  }, [status, scanning]);

  async function persistGameFilters(partial: { lastGameFilter?: string; lastSteamGameFilter?: string }) {
    await window.modHub?.saveSettings(partial);
  }

  function onLibraryGameChange(id: string) {
    setGameFilter(id);
    void persistGameFilters({ lastGameFilter: id });
  }

  function onSteamGameChange(id: string) {
    void persistGameFilters({ lastSteamGameFilter: id });
  }

  async function runScan() {
    if (!window.modHub) {
      setStatus('Use the Mod Hub desktop window (Desktop\\games\\Mod Hub.lnk), not a browser tab.');
      return;
    }
    setScanning(true);
    scanStartedAt.current = Date.now();
    setScanProgress({ phase: 'start', message: 'Starting scan…' });
    setStatus('Scanning all drives for Steam libraries, Workshop, game folders, Vortex…');
    try {
      const c = await window.modHub.scanAll({ enrichWorkshop: true, deepSize: false });
      setCatalog(c);
      const ws = c.mods.filter((m) => m.source === 'steam-workshop').length;
      const dur = c.scanReport?.durationMs ? ` in ${Math.round(c.scanReport.durationMs / 1000)}s` : '';
      const en = c.scanReport?.workshopEnrich;
      const enrichNote = en
        ? ` Workshop metadata: ${en.detailsFetched}/${en.workshopIds} from API, ${en.appliedToMods} mods updated${
            en.failedApiChunks ? ` (${en.failedApiChunks} batch failures)` : ''
          }.`
        : '';
      setStatus(`Scan complete — ${c.mods.length} items indexed (${ws} Workshop on disk)${dur}.${enrichNote}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
      scanStartedAt.current = null;
      setTimeout(() => setScanProgress(null), 2500);
    }
  }

  async function checkUpdates() {
    if (!window.modHub) return;
    setStatus('Checking Workshop API…');
    const updated = await window.modHub.checkWorkshopUpdates();
    await reload();
    setStatus(
      updated.length ? `${updated.length} mod(s) have Workshop updates.` : 'Workshop revisions match local (where checked).',
    );
  }

  const visibleCatalog = useMemo<CatalogSnapshot>(() => {
    if (hiddenGames.length === 0) return catalog;
    const hidden = new Set(hiddenGames);
    return {
      ...catalog,
      mods: catalog.mods.filter((m) => !hidden.has(m.gameId)),
      games: catalog.games.filter((g) => !hidden.has(g.id)),
    };
  }, [catalog, hiddenGames]);

  /** Library Game filter: only games that have mods (registry games with 0 mods stay out), with counts. */
  const libraryGameOptions = useMemo(() => {
    const counts = new Map<string, { sample: ModRecord; count: number }>();
    for (const m of visibleCatalog.mods) {
      const hit = counts.get(m.gameId);
      if (hit) hit.count += 1;
      else counts.set(m.gameId, { sample: m, count: 1 });
    }
    return [...counts.entries()]
      .map(([id, { sample, count }]) => ({ id, name: displayGameName(sample, visibleCatalog.games), count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [visibleCatalog]);

  const filtered = useMemo(() => {
    let list = visibleCatalog.mods;
    if (gameFilter !== 'all') list = list.filter((m) => m.gameId === gameFilter);
    if (sourceFilter === 'nexus-vortex') list = list.filter((m) => isNexusLikeSource(m));
    else if (sourceFilter === 'steam-workshop') list = list.filter((m) => m.source === 'steam-workshop');
    else if (sourceFilter === 'local') list = list.filter((m) => m.source === 'local');
    else if (sourceFilter === 'other')
      list = list.filter(
        (m) => !isNexusLikeSource(m) && m.source !== 'steam-workshop' && m.source !== 'local',
      );
    if (inGameFilter !== 'all') {
      const want = inGameFilter === 'enabled';
      list = list.filter((m) => loadStates.get(m.id)?.enabled === want);
    }
    const q = deferredQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.gameId.toLowerCase().includes(q) ||
          m.author?.toLowerCase().includes(q) ||
          m.workshopId?.includes(q),
      );
    }
    if (sortMode === 'load-order' && loadOrders[gameFilter]) {
      // The game's order: enabled mods by position, then disabled, then mods the game can't see; title within ties.
      const rank = (m: ModRecord) => {
        const st = loadStates.get(m.id);
        return st?.enabled ? (st.position ?? 0) : st ? 1e6 : 2e6;
      };
      list = [...list].sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
    }
    return list;
  }, [visibleCatalog.mods, deferredQuery, gameFilter, sourceFilter, inGameFilter, sortMode, loadStates, loadOrders]);

  /** Load-order support for the single game currently filtered (null for "All games" / unsupported games). */
  const activeLoadOrder = gameFilter !== 'all' ? (loadOrders[gameFilter] ?? null) : null;
  const shownEnabled = useMemo(() => filtered.filter((m) => loadStates.get(m.id)?.enabled).length, [filtered, loadStates]);
  const shownToggleable = useMemo(() => filtered.filter((m) => loadStates.has(m.id)), [filtered, loadStates]);

  const orderGame = gameFilter === 'rimworld' && loadOrders.rimworld ? 'rimworld' : null;
  useEffect(() => {
    setPendingOrder(null);
    setShowOrderIssues(false);
  }, [gameFilter]);
  useEffect(() => {
    if (!orderGame || !window.modHub?.planLoadOrder) {
      setOrderPlan(null);
      return;
    }
    let cancelled = false;
    void window.modHub.planLoadOrder(orderGame, pendingOrder?.ids).then((p) => {
      if (!cancelled) setOrderPlan(p);
    });
    return () => {
      cancelled = true;
    };
  }, [orderGame, pendingOrder, loadOrders]);

  const pendingMoved = pendingOrder
    ? pendingOrder.ids.filter((id, i) => rwNorm(id) !== rwNorm(pendingOrder.base[i] ?? '')).length
    : 0;

  const onReorder = useStableCallback((fromModId: string, toModId: string) => {
    const base = pendingOrder?.ids ?? orderPlan?.current;
    if (!base) return;
    const indexOf = (modId: string) => {
      const ids = (catalog.mods.find((m) => m.id === modId)?.modIds ?? []).map(rwNorm);
      return base.findIndex((e) => ids.includes(rwNorm(e)));
    };
    const from = indexOf(fromModId);
    const to = indexOf(toModId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...base];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item); // moving down lands after the target, moving up lands before it
    const original = pendingOrder?.base ?? base;
    setPendingOrder(next.every((id, i) => id === original[i]) ? null : { ids: next, base: original });
  });

  const autoSort = () => {
    if (!orderPlan) return;
    setSortMode('load-order');
    if (orderPlan.moved === 0) {
      toast(
        orderPlan.issues.length
          ? 'Order already satisfies every sort rule (see the issues for missing/incompatible mods).'
          : 'Already in a valid order.',
      );
      return;
    }
    setPendingOrder({ ids: orderPlan.proposed, base: pendingOrder?.base ?? orderPlan.current });
    toast(`Auto-sort moved ${orderPlan.moved} mod(s). Review the order, then Save order.`);
  };

  const saveOrder = async () => {
    if (!pendingOrder || !window.modHub?.setLoadOrder) return;
    const r = await window.modHub.setLoadOrder('rimworld', pendingOrder.ids);
    toast(r.message, r.ok ? 'ok' : 'error');
    if (r.ok) {
      setPendingOrder(null);
      await refreshLoadOrders();
    }
  };

  const isProtectedMod = (m: ModRecord) => /repentogon/i.test(m.title) || m.workshopId === '3127536138';

  const applyEnabled = async (gameId: string, mods: ModRecord[], enabled: boolean) => {
    if (!window.modHub?.setModsEnabled || mods.length === 0) return;
    if (pendingOrder) {
      if (!window.confirm('You have an unsaved load order. Enabling/disabling mods discards it. Continue?')) return;
      setPendingOrder(null);
    }
    const r = await window.modHub.setModsEnabled(gameId, mods.map((m) => m.id), enabled);
    toast(r.message, r.ok ? 'ok' : 'error');
    await refreshLoadOrders();
  };

  const onToggleEnabled = useStableCallback(async (mod: ModRecord, enabled: boolean) => {
    if (
      !enabled &&
      isProtectedMod(mod) &&
      !window.confirm(`“${mod.title}” is REPENTOGON's companion mod. Mods that need REPENTOGON can break without it.\n\nDisable it anyway?`)
    ) {
      return;
    }
    await applyEnabled(mod.gameId, [mod], enabled);
  });

  const bulkSetEnabled = async (enabled: boolean) => {
    if (!activeLoadOrder) return;
    const targets = shownToggleable.filter((m) => loadStates.get(m.id)?.enabled !== enabled && !(!enabled && isProtectedMod(m)));
    if (targets.length === 0) {
      toast(`All shown mods are already ${enabled ? 'enabled' : 'disabled'}.`);
      return;
    }
    const kept = !enabled && shownToggleable.some(isProtectedMod) ? '\n(REPENTOGON stays enabled; toggle it on its own if you really want it off.)' : '';
    if (!window.confirm(`${enabled ? 'Enable' : 'Disable'} ${targets.length} shown mod(s) in the game's mod list?${kept}\n\nThe game must be closed. Config files are backed up first.`)) return;
    await applyEnabled(activeLoadOrder.gameId, targets, enabled);
  };

  const steamWorkshopList = useMemo(() => {
    let list = visibleCatalog.mods.filter((m) => m.source === 'steam-workshop');
    if (steamGameFilter !== 'all') list = list.filter((m) => m.gameId === steamGameFilter);
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.gameId.toLowerCase().includes(q) ||
        m.author?.toLowerCase().includes(q) ||
        m.workshopId?.includes(q),
    );
  }, [visibleCatalog.mods, deferredQuery, steamGameFilter]);
  const steamWorkshopShown = steamWorkshopList.length;

  /** Subscribed Workshop mods in the current view (target of "Keep & unsubscribe shown"). */
  const shownSubscribedWorkshop = useMemo(
    () =>
      (tab === 'steam' ? steamWorkshopList : filtered).filter(
        (m) => m.source === 'steam-workshop' && m.workshopId && m.steamSubscribed !== false && m.subscribed !== false,
      ),
    [tab, steamWorkshopList, filtered],
  );

  const workshopTotal = useMemo(
    () => visibleCatalog.mods.filter((m) => m.source === 'steam-workshop').length,
    [visibleCatalog.mods],
  );

  const nexusShown = useMemo(() => {
    let list = visibleCatalog.mods.filter((m) => isNexusLikeSource(m));
    if (gameFilter !== 'all') list = list.filter((m) => m.gameId === gameFilter);
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return list.length;
    return list.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.gameId.toLowerCase().includes(q) ||
        m.author?.toLowerCase().includes(q) ||
        String(m.nexusModId ?? '').includes(q),
    ).length;
  }, [visibleCatalog.mods, deferredQuery, gameFilter]);

  const nexusTotal = useMemo(
    () => visibleCatalog.mods.filter((m) => isNexusLikeSource(m)).length,
    [visibleCatalog.mods],
  );

  const displayCount =
    tab === 'steam' ? steamWorkshopShown : tab === 'nexus' ? nexusShown : filtered.length;
  const totalCount =
    tab === 'steam' ? workshopTotal : tab === 'nexus' ? nexusTotal : visibleCatalog.mods.length;

  const onFavorite = useStableCallback(async (mod: ModRecord) => {
    if (!window.modHub) return;
    await window.modHub.setFavorite(mod.id, !mod.favorited);
    toast(mod.favorited ? `Removed “${mod.title}” from favorites.` : `Favorited “${mod.title}”.`);
    await reload();
  });

  const onDismiss = useStableCallback(async (mod: ModRecord) => {
    if (!window.modHub) return;
    const r = await window.modHub.dismissMod(mod.id);
    toast(r.message, r.ok ? 'ok' : 'error');
    await reload();
  });

  const onSubscribe = useStableCallback(async (mod: ModRecord) => {
    if (!window.modHub || !mod.workshopId) return;
    const appId = mod.steamAppId ?? 108600;
    if (mod.subscribed !== false) {
      setUnsubTarget(mod);
      return;
    }
    const r = await window.modHub.steamSubscribe(appId, mod.workshopId);
    await window.modHub.setSubscribed(mod.id, true);
    toast(r.message, r.ok ? 'ok' : 'error');
    await reload();
  });

  const showModToolbar = tab === 'library' || tab === 'steam' || tab === 'nexus';
  const carouselLayout =
    viewMode === 'carousel' && (tab === 'library' || tab === 'steam' || tab === 'nexus');
  const showGlobalStatus = tab === 'library' || tab === 'games' || tab === 'settings' || tab === 'loadouts';

  return (
    <div className={`app-shell${sidebarCollapsed ? ' app-shell-collapsed' : ''}`}>
      <ToastHost />
      {bulkKeepOpen && (
        <BulkKeepDialog
          mods={shownSubscribedWorkshop}
          games={catalog.games}
          onClose={(changed) => {
            setBulkKeepOpen(false);
            if (changed) void reload();
          }}
        />
      )}
      {detailMod && (
        <ModDetailPanel
          mod={catalog.mods.find((m) => m.id === detailMod.id) ?? detailMod}
          games={catalog.games}
          allMods={catalog.mods}
          onClose={() => setDetailMod(null)}
        />
      )}
      {deleteTarget && (
        <DeleteLocalDialog
          mod={deleteTarget}
          title={workshopDisplayTitle(deleteTarget)}
          gameName={displayGameName(deleteTarget, catalog.games)}
          sameGame={catalog.mods.filter(
            (m) => m.source === 'steam-workshop' && m.steamSubscribed === false && m.gameId === deleteTarget.gameId,
          )}
          onClose={(changed) => {
            setDeleteTarget(null);
            if (changed) void reload();
          }}
        />
      )}
      {unsubTarget && (
        <UnsubscribeDialog
          mod={unsubTarget}
          title={workshopDisplayTitle(unsubTarget)}
          onClose={(changed) => {
            setUnsubTarget(null);
            if (changed) void reload();
          }}
        />
      )}
      <Sidebar tab={tab} onTab={setTab} collapsed={sidebarCollapsed} onToggleCollapsed={toggleSidebar} />
      <div className="main-panel">
        <header className="toolbar">
          {showModToolbar && (
            <>
              <input
                type="search"
                placeholder="Search title, game, author, workshop id…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="count-badge" aria-live="polite">
                {tab === 'steam' ? 'Workshop on disk: ' : 'Showing '}
                {displayCount}
                {displayCount !== totalCount ? ` of ${totalCount}` : ''}
                {tab === 'library' && activeLoadOrder && (
                  <span
                    title={`Read from ${activeLoadOrder.sourcePath}${
                      activeLoadOrder.unmatched.length
                        ? `\nAlso enabled but not a mod card here:\n${activeLoadOrder.unmatched
                            .map((u) => `  ${u.position}. ${u.id}${u.note ? ` (${u.note})` : ''}`)
                            .join('\n')}`
                        : ''
                    }`}
                  >
                    {' · '}
                    {shownEnabled} enabled
                    {activeLoadOrder.enabledCount !== shownEnabled ? ` (${activeLoadOrder.enabledCount} in game)` : ''}
                  </span>
                )}
              </span>
              {tab === 'library' && (
                <>
                  <label className="toolbar-select">
                    Game
                    <select value={gameFilter} onChange={(e) => onLibraryGameChange(e.target.value)}>
                      <option value="all">All games</option>
                      {libraryGameOptions.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.count})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="toolbar-select">
                    Source
                    <select
                      value={sourceFilter}
                      onChange={(e) =>
                        setSourceFilter(
                          e.target.value as 'all' | 'nexus-vortex' | 'steam-workshop' | 'local' | 'other',
                        )
                      }
                    >
                      <option value="all">All sources</option>
                      <option value="steam-workshop">Steam Workshop</option>
                      <option value="nexus-vortex">Nexus / Vortex</option>
                      <option value="local">Local / game folder</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label
                    className="toolbar-select"
                    title="Enabled in the game's own mod list (RimWorld, Project Zomboid, Isaac). Other games: not filtered."
                  >
                    In game
                    <select value={inGameFilter} onChange={(e) => setInGameFilter(e.target.value as 'all' | 'enabled' | 'disabled')}>
                      <option value="all">Any</option>
                      <option value="enabled">Enabled</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </label>
                  {activeLoadOrder && (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm"
                        title="Enable every mod currently shown (respects search and filters)"
                        onClick={() => void bulkSetEnabled(true)}
                      >
                        Enable shown
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        title="Disable every mod currently shown (respects search and filters)"
                        onClick={() => void bulkSetEnabled(false)}
                      >
                        Disable shown
                      </button>
                    </>
                  )}
                  {activeLoadOrder && viewMode !== 'list' && (
                    <label className="toolbar-select" title={`Load order read from ${activeLoadOrder.sourcePath}. In list view, click the Load order column instead.`}>
                      Sort
                      <select value={sortMode} onChange={(e) => setSortMode(e.target.value as 'title' | 'load-order')}>
                        <option value="title">Title</option>
                        <option value="load-order">
                          {activeLoadOrder.orderKind === 'folder-name' ? 'Load order (folder name)' : 'Load order'}
                        </option>
                      </select>
                    </label>
                  )}
                  {orderGame && (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={!orderPlan}
                        title="Sort by each mod's About.xml rules (dependencies, loadAfter/loadBefore). Only rule-breaking mods move. Nothing is saved until you click Save order."
                        onClick={autoSort}
                      >
                        Auto-sort
                      </button>
                      {orderPlan && (
                        <button
                          type="button"
                          className={`btn btn-sm order-check${orderPlan.issues.length ? ' has-issues' : ''}`}
                          title="Problems in the current (or unsaved) order"
                          onClick={() => setShowOrderIssues((v) => !v)}
                        >
                          {orderPlan.issues.length
                            ? `⚠ ${orderPlan.issues.length} issue${orderPlan.issues.length === 1 ? '' : 's'}`
                            : '✓ Order OK'}
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
              <div className="view-toggle">
                {(['list', 'grid', 'carousel'] as ViewMode[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={viewMode === v ? 'active' : ''}
                    onClick={() => setViewMode(v)}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </>
          )}
          <button type="button" className="btn btn-primary" disabled={scanning} onClick={runScan}>
            {scanning ? 'Scanning…' : 'Scan computer'}
          </button>
          {tab !== 'nexus' && (
            <button type="button" className="btn" onClick={checkUpdates}>
              Check Workshop updates
            </button>
          )}
          {(tab === 'library' || tab === 'steam') && (
            <button
              type="button"
              className="btn"
              title="Copy every subscribed Workshop mod shown to a local folder, then unsubscribe — Steam can't update or delete them anymore"
              onClick={() => setBulkKeepOpen(true)}
            >
              Keep &amp; unsubscribe shown ({shownSubscribedWorkshop.length})
            </button>
          )}
        </header>
        {showModToolbar && (
          <HiddenGamesBar
            mods={catalog.mods}
            games={catalog.games}
            hidden={hiddenGames}
            onChange={updateHiddenGames}
          />
        )}
        {!window.modHub && (
          <p className="message message-error">
            {inElectron
              ? 'Preload bridge missing — restart Mod Hub from the desktop shortcut.'
              : 'Open Mod Hub from Desktop\\games\\Mod Hub.lnk (not localhost in a browser).'}
          </p>
        )}
        {scanning && <ScanProgressPanel progress={scanProgress} startedAt={scanStartedAt.current} />}
        {status && showGlobalStatus && !scanning && <p className="message message-compact">{status}</p>}
        <main className={`content${carouselLayout ? ' content-carousel' : ''}`}>
          {tab === 'library' && pendingOrder && (
            <div className="order-banner">
              <span>
                Unsaved load order: {pendingMoved} position{pendingMoved === 1 ? '' : 's'} changed
                {orderPlan ? (orderPlan.issues.length ? ` · ${orderPlan.issues.length} issue(s)` : ' · no rule problems') : ''}. Drag
                rows in list view to adjust.
              </span>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void saveOrder()}>
                Save order
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setPendingOrder(null)}>
                Discard
              </button>
            </div>
          )}
          {tab === 'library' && orderGame && showOrderIssues && orderPlan && (
            <ul className="order-issues">
              {orderPlan.issues.length === 0 && <li>No problems: every dependency and loadAfter/loadBefore rule is satisfied.</li>}
              {orderPlan.issues.map((i, n) => (
                <li key={n} className={`issue-${i.kind}`}>
                  <span className="order-issue-kind">{ISSUE_LABELS[i.kind]}</span>
                  {i.message}
                </li>
              ))}
            </ul>
          )}
          {tab === 'library' && (
            <LibraryView
              onReorder={orderGame && sortMode === 'load-order' ? onReorder : undefined}
              orderSortActive={Boolean(activeLoadOrder) && sortMode === 'load-order'}
              onOrderSort={activeLoadOrder ? (on) => setSortMode(on ? 'load-order' : 'title') : undefined}
              loadStates={loadStates}
              onToggleEnabled={onToggleEnabled}
              mods={filtered}
              games={visibleCatalog.games}
              viewMode={viewMode}
              trackedNexus={trackedNexus}
              onTrackedNexusChange={refreshTrackedNexus}
              onFavorite={onFavorite}
              onDismiss={onDismiss}
              onSubscribe={onSubscribe}
              onDeleteLocal={setDeleteTarget}
            />
          )}
          {tab === 'steam' && (
            <SteamView
              catalog={visibleCatalog}
              searchQuery={deferredQuery}
              viewMode={viewMode}
              trackedNexus={trackedNexus}
              onTrackedNexusChange={refreshTrackedNexus}
              onFavorite={onFavorite}
              onDismiss={onDismiss}
              onSubscribe={onSubscribe}
              onDeleteLocal={setDeleteTarget}
              onSteamGameFilter={onSteamGameChange}
            />
          )}
          {tab === 'nexus' && (
            <NexusView
              catalog={visibleCatalog}
              viewMode={viewMode}
              trackedNexus={trackedNexus}
              onTrackedNexusChange={refreshTrackedNexus}
              onFavorite={onFavorite}
              onDismiss={onDismiss}
            />
          )}
          {tab === 'games' && <GamesView catalog={catalog} />}
          {tab === 'loadouts' && <LoadoutsView catalog={catalog} onChanged={() => void refreshLoadOrders()} />}
          {tab === 'settings' && <SettingsView catalog={catalog} onSaved={reload} />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <HubNavigationProvider>
      <AppInner />
    </HubNavigationProvider>
  );
}
