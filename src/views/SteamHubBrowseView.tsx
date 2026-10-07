import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogSnapshot, SteamLibraryGame, WorkshopBrowseItem, WorkshopBrowseSort } from '@shared/types';
import { ModThumbnail } from '../components/ModThumbnail';
import { StarRating } from '../components/StarRating';
import { formatBytes, formatDate } from '../utils/format';
import { AuthorLink } from '../components/AuthorLink';

type Props = {
  catalog: CatalogSnapshot;
  searchQuery: string;
};

const PAGE_SIZE = 21;

function favoriteId(appId: number, workshopId: string) {
  return `ws-${appId}-${workshopId}`;
}

function localModForWorkshop(catalog: CatalogSnapshot, appId: number, workshopId: string) {
  return catalog.mods.find(
    (m) => m.source === 'steam-workshop' && m.workshopId === workshopId && (m.steamAppId ?? 0) === appId,
  );
}

export function SteamHubBrowseView({ catalog, searchQuery }: Props) {
  const [games, setGames] = useState<SteamLibraryGame[]>([]);
  const [appId, setAppId] = useState(108600);
  const [sort, setSort] = useState<WorkshopBrowseSort>('trend');
  const [categoryTag, setCategoryTag] = useState('');
  const [hideInstalled, setHideInstalled] = useState(false);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<WorkshopBrowseItem[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingInstall, setPendingInstall] = useState<Set<string>>(new Set());
  const browseSeq = useRef(0);

  const loadGames = useCallback(async () => {
    if (!window.modHub) return;
    const g = await window.modHub.getSteamLibraryGames();
    const workshopGames = g.filter((x) => x.hasWorkshopBrowse !== false);
    setGames(workshopGames);
    const owned = workshopGames.find((x) => x.ownedOnDisk && x.hasWorkshopBrowse);
    const withWs = workshopGames.find((x) => (x.localWorkshopCount ?? 0) > 0);
    if (owned) setAppId(owned.appId);
    else if (withWs) setAppId(withWs.appId);
  }, []);

  const loadFavorites = useCallback(async () => {
    if (!window.modHub) return;
    const ids = await window.modHub.getFavoriteIds();
    setFavorites(new Set(ids));
  }, []);

  const runBrowse = useCallback(async () => {
    if (!window.modHub) return;
    const seq = ++browseSeq.current;
    setLoading(true);
    setError('');
    setItems([]);
    try {
      const q = searchQuery.trim();
      const r = await window.modHub.workshopBrowse({
        appId,
        page,
        sort,
        searchText: q || undefined,
        categoryTag: categoryTag.trim() || undefined,
        numPerPage: PAGE_SIZE,
      });
      if (seq !== browseSeq.current) return;
      if (r.error) {
        setError(r.error);
        setItems([]);
        return;
      }
      setItems(r.items.slice(0, PAGE_SIZE));
    } catch (e) {
      if (seq !== browseSeq.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      if (seq === browseSeq.current) setLoading(false);
    }
  }, [appId, page, sort, categoryTag, searchQuery]);

  useEffect(() => {
    void loadGames();
    void loadFavorites();
    window.modHub?.getSettings().then((s) => {
      const ids = new Set((s.workshopInstallOnce ?? []).map((x) => favoriteId(x.appId, x.workshopId)));
      setPendingInstall(ids);
    });
  }, [loadGames, loadFavorites]);

  useEffect(() => {
    void runBrowse();
  }, [runBrowse]);

  const gameOptions = useMemo(() => {
    return games.filter((g) => g.hasWorkshopBrowse !== false);
  }, [games]);

  const visibleItems = useMemo(() => {
    if (!hideInstalled) return items;
    return items.filter((item) => !localModForWorkshop(catalog, item.appId, item.workshopId));
  }, [items, hideInstalled, catalog]);

  async function toggleFavorite(item: WorkshopBrowseItem) {
    const id = favoriteId(item.appId, item.workshopId);
    const local = localModForWorkshop(catalog, item.appId, item.workshopId);
    const next = !favorites.has(id) && !(local?.favorited ?? false);
    if (local) await window.modHub?.setFavorite(local.id, next);
    else await window.modHub?.setFavorite(id, next);
    await loadFavorites();
  }

  async function favoriteInstall(item: WorkshopBrowseItem) {
    await window.modHub?.workshopFavoriteInstall(item.appId, item.workshopId);
    setPendingInstall((prev) => new Set(prev).add(favoriteId(item.appId, item.workshopId)));
    await loadFavorites();
  }

  function formatTs(sec?: number) {
    if (!sec) return '—';
    return formatDate(new Date(sec * 1000).toISOString());
  }

  async function subscribe(item: WorkshopBrowseItem) {
    const local = localModForWorkshop(catalog, item.appId, item.workshopId);
    await window.modHub?.steamSubscribe(item.appId, item.workshopId);
    if (local) await window.modHub?.setSubscribed(local.id, true);
  }

  return (
    <>
      <div className="filter-row workshop-hub-filters">
        <label>
          Game
          <select
            value={appId}
            onChange={(e) => {
              setAppId(Number(e.target.value));
              setPage(1);
            }}
          >
            {gameOptions.map((g) => (
              <option key={g.appId} value={g.appId}>
                {g.name}
                {g.ownedOnDisk ? ' · Installed' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort
          <select value={sort} onChange={(e) => { setSort(e.target.value as WorkshopBrowseSort); setPage(1); }}>
            <option value="trend">Trending</option>
            <option value="recent">Most recent</option>
            <option value="subscribed">Most subscribed</option>
            <option value="rated">Top rated</option>
          </select>
        </label>
        <label>
          Category tag
          <input
            type="text"
            placeholder="Optional Steam tag"
            value={categoryTag}
            onChange={(e) => setCategoryTag(e.target.value)}
            onBlur={() => setPage(1)}
          />
        </label>
        <label className="checkbox-inline">
          <input type="checkbox" checked={hideInstalled} onChange={(e) => setHideInstalled(e.target.checked)} />
          Hide installed on disk
        </label>
        <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void runBrowse()}>
          {loading ? 'Loading...' : 'Search / refresh'}
        </button>
        <div className="pagination-inline">
          <button type="button" className="btn btn-sm" disabled={loading || page <= 1} onClick={() => setPage((p) => p - 1)}>
            Prev page
          </button>
          <span>Page {page}</span>
          <button type="button" className="btn btn-sm" disabled={loading} onClick={() => setPage((p) => p + 1)}>
            Next page
          </button>
        </div>
      </div>
      {error && <p className="message message-error">{error}</p>}
      {loading && visibleItems.length === 0 ? (
        <div className="empty-state">Loading Workshop...</div>
      ) : visibleItems.length === 0 ? (
        <div className="empty-state">No items — try another game, page, or turn off Hide installed.</div>
      ) : (
        <div className="workshop-browse-grid">
          {visibleItems.map((item) => {
            const local = localModForWorkshop(catalog, item.appId, item.workshopId);
            const favId = favoriteId(item.appId, item.workshopId);
            const favorited = local?.favorited ?? favorites.has(favId);
            const subscribed = local?.subscribed ?? false;
            const installKey = favoriteId(item.appId, item.workshopId);
            const installing = pendingInstall.has(installKey) && !local;
            const installLabel = local
              ? 'Installed'
              : installing
                ? 'Installing via Steam...'
                : favorited
                  ? 'Favorited + install'
                  : 'Favorite + install';
            return (
              <article key={`${item.appId}-${item.workshopId}-${page}`} className="mod-card">
                <ModThumbnail remoteUrl={item.previewUrl} title={item.title} />
                <div className="mod-card-body">
                  <h3 className="mod-card-title">{item.title}</h3>
                  <div className="mod-card-meta">
                    <StarRating score={item.starScore} />
                    {item.author && (
                      <span>
                        Author:{' '}
                        <AuthorLink
                          author={item.author}
                          steamId={item.authorSteamId}
                          profileUrl={item.authorProfileUrl}
                        />
                      </span>
                    )}
                    <span>Uploaded: {formatTs(item.timeCreated)}</span>
                    <span>Updated: {formatTs(item.timeUpdated)}</span>
                    {item.gameVersionTags && item.gameVersionTags.length > 0 && (
                      <span>Game version: {item.gameVersionTags.slice(0, 4).join(', ')}</span>
                    )}
                    {item.workshopCategories && item.workshopCategories.length > 0 && (
                      <span>Categories: {item.workshopCategories.slice(0, 4).join(', ')}</span>
                    )}
                    <span>Size: {formatBytes(item.fileSize)}</span>
                  </div>
                  <div className="mod-card-actions">
                    <button type="button" className={`btn btn-sm${favorited ? ' btn-active' : ''}`} onClick={() => void toggleFavorite(item)}>
                      {favorited ? 'Favorited' : 'Favorite'}
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm btn-primary${local ? ' btn-active' : ''}`}
                      disabled={Boolean(local)}
                      onClick={() => void favoriteInstall(item)}
                    >
                      {installLabel}
                    </button>
                    <button type="button" className={`btn btn-sm${subscribed ? ' btn-active' : ''}`} onClick={() => void subscribe(item)}>
                      {subscribed ? 'Subscribed on disk' : 'Subscribe in Steam'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => window.modHub?.steamOpenWorkshop(item.appId, item.workshopId)}
                    >
                      Workshop page
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
