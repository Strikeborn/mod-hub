import { useMemo, useState } from 'react';
import type { CatalogSnapshot, ModRecord, ViewMode } from '@shared/types';
import { ModCollectionView } from '../components/ModCollectionView';
import { SubTabs } from '../components/SubTabs';
import { EmbeddedWebView } from '../components/EmbeddedWebView';
import { useHubNavigation } from '../context/HubNavigation';
import { steamAppIdForGameId } from '../utils/games';
import { workshopBrowseUrl, type WorkshopBrowseSort } from '../utils/steamImages';
import { SteamHubBrowseView } from './SteamHubBrowseView';

type Props = {
  catalog: CatalogSnapshot;
  searchQuery: string;
  viewMode: ViewMode;
  trackedNexus?: Set<string>;
  onTrackedNexusChange?: () => void;
  onFavorite: (mod: ModRecord) => void;
  onDismiss?: (mod: ModRecord) => void;
  onSubscribe: (mod: ModRecord) => void;
  onDeleteLocal?: (mod: ModRecord) => void;
  onSteamGameFilter: (gameId: string) => void;
};

function matchSearch(m: ModRecord, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  return (
    m.title.toLowerCase().includes(lower) ||
    m.gameId.toLowerCase().includes(lower) ||
    m.author?.toLowerCase().includes(lower) ||
    m.workshopId?.includes(lower) === true
  );
}

export function SteamView({
  catalog,
  searchQuery,
  viewMode,
  trackedNexus,
  onTrackedNexusChange,
  onFavorite,
  onDismiss,
  onSubscribe,
  onDeleteLocal,
  onSteamGameFilter,
}: Props) {
  const { steamPanel, setSteamPanel, steamGameFilter, setSteamGameFilter } = useHubNavigation();
  const [browseSort, setBrowseSort] = useState<WorkshopBrowseSort>('trend');

  const workshopByGame = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of catalog.mods) {
      if (m.source !== 'steam-workshop') continue;
      map.set(m.gameId, (map.get(m.gameId) ?? 0) + 1);
    }
    return map;
  }, [catalog.mods]);

  const gamesWithWorkshop = useMemo(() => {
    // Installed list: only games with Workshop items on disk. Browse: any Steam game, so new Workshops can be explored.
    const base = catalog.games.filter(
      (g) => (workshopByGame.get(g.id) ?? 0) > 0 || (steamPanel === 'browse' && g.steamAppId) || g.id === steamGameFilter,
    );
    const known = new Set(base.map((g) => g.id));
    const extras = [...workshopByGame.entries()]
      .filter(([id, n]) => n > 0 && !known.has(id))
      .map(([id]) => {
        const appId = steamAppIdForGameId(id);
        return {
          id,
          name: appId ? `Steam app ${appId}` : id,
          steamAppId: appId,
          modFolderHints: [],
        };
      });
    return [...base, ...extras];
  }, [catalog.games, workshopByGame, steamPanel, steamGameFilter]);

  const browseGameId =
    steamGameFilter === 'all' ? (gamesWithWorkshop[0]?.id ?? 'project-zomboid') : steamGameFilter;
  const appId = steamAppIdForGameId(browseGameId) ?? 108600;

  const installed = useMemo(() => {
    const filterAppId =
      steamGameFilter !== 'all' ? steamAppIdForGameId(steamGameFilter) : undefined;
    return catalog.mods.filter((m) => {
      if (m.source !== 'steam-workshop') return false;
      if (steamGameFilter !== 'all') {
        const modApp = m.steamAppId ?? steamAppIdForGameId(m.gameId);
        if (m.gameId !== steamGameFilter && modApp !== filterAppId) return false;
      }
      return matchSearch(m, searchQuery.trim());
    });
  }, [catalog.mods, steamGameFilter, searchQuery]);

  const localNonWorkshopForGame = useMemo(() => {
    if (steamGameFilter === 'all') return 0;
    return catalog.mods.filter(
      (m) => m.gameId === steamGameFilter && m.source !== 'steam-workshop',
    ).length;
  }, [catalog.mods, steamGameFilter]);

  const browseUrl = workshopBrowseUrl(appId, browseSort);

  function onGameSelect(id: string) {
    setSteamGameFilter(id);
    onSteamGameFilter(id);
  }

  return (
    <>
      <SubTabs
        tabs={[
          { id: 'installed' as const, label: 'Downloaded / installed' },
          { id: 'hub-browse' as const, label: 'Mod Hub browse' },
          { id: 'browse' as const, label: 'Browse Workshop (web)' },
        ]}
        active={steamPanel}
        onChange={setSteamPanel}
      />
      {steamPanel !== 'hub-browse' && (
        <div className="filter-row">
          <label>
            Game
            <select value={steamGameFilter} onChange={(e) => onGameSelect(e.target.value)}>
              <option value="all">All games</option>
              {gamesWithWorkshop.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({workshopByGame.get(g.id) ?? 0} Workshop)
                </option>
              ))}
            </select>
          </label>
          {steamPanel === 'browse' && (
            <label>
              Sort
              <select value={browseSort} onChange={(e) => setBrowseSort(e.target.value as WorkshopBrowseSort)}>
                <option value="trend">Trending</option>
                <option value="recent">Most recent</option>
                <option value="subscribed">Most subscribed</option>
                <option value="rated">Top rated</option>
              </select>
            </label>
          )}
        </div>
      )}
      {steamPanel === 'hub-browse' ? (
        <SteamHubBrowseView catalog={catalog} searchQuery={searchQuery} />
      ) : steamPanel === 'installed' ? (
        <>
          {installed.length === 0 && localNonWorkshopForGame > 0 && (
            <p className="message">
              {localNonWorkshopForGame} local mod(s) for this game (Vortex/Nexus/folders) — open{' '}
              <strong>All mods</strong> with the same game filter. None are Steam Workshop folders here.
            </p>
          )}
          <ModCollectionView
            mods={installed}
            games={catalog.games}
            viewMode={viewMode}
            cardVariant="steam"
            trackedNexus={trackedNexus}
            onTrackedNexusChange={onTrackedNexusChange}
            onFavorite={onFavorite}
            onDismiss={onDismiss}
            onSubscribe={onSubscribe}
            onDeleteLocal={onDeleteLocal}
            emptyMessage="No Workshop items on disk for this filter. Subscribe in Workshop browse, then rescan."
          />
        </>
      ) : (
        <>
          <EmbeddedWebView src={browseUrl} title="Steam Workshop" partition="persist:modhub-steam-workshop" />
        </>
      )}
    </>
  );
}
