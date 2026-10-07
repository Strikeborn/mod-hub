import { useEffect, useMemo, useState } from 'react';
import type { CatalogSnapshot, SteamLibraryGame } from '@shared/types';
import { useHubNavigation } from '../context/HubNavigation';
import { modCountForGame, steamAppIdForGameId } from '../utils/games';
import { GameCoverImage } from '../components/GameCoverImage';
import { formatDate } from '../utils/format';

type Props = {
  catalog: CatalogSnapshot;
};

type GameFilter = 'all' | 'installed' | 'owned' | 'has-mods';

/** Steam "apps" that aren't games: Steamworks Common Redistributables, Steam Input controller configs. */
const NON_GAME_APP_IDS = new Set([228980, 241100]);

export function GamesView({ catalog }: Props) {
  const { openGameInstalled } = useHubNavigation();
  const [steamGames, setSteamGames] = useState<SteamLibraryGame[]>([]);
  const [filter, setFilter] = useState<GameFilter>('all');

  useEffect(() => {
    window.modHub?.getSteamLibraryGames().then(setSteamGames);
  }, [catalog.scannedAt]);

  const cards = useMemo(() => {
    const registry = catalog.games.map((g) => {
      const sg = steamGames.find((s) => s.appId === g.steamAppId);
      return {
        id: g.id,
        name: g.name,
        appId: g.steamAppId ?? steamAppIdForGameId(g.id),
        localMods: modCountForGame(catalog, g.id),
        ownedOnDisk: sg?.ownedOnDisk ?? false,
      };
    });

    const extra = steamGames
      .filter((sg) => !registry.some((r) => r.appId === sg.appId))
      .map((sg) => ({
        id: `steam-${sg.appId}`,
        name: sg.name,
        appId: sg.appId,
        localMods: sg.localModCount,
        ownedOnDisk: sg.ownedOnDisk,
      }));

    let list = [...registry, ...extra].filter((g) => !g.appId || !NON_GAME_APP_IDS.has(g.appId));
    if (filter === 'installed' || filter === 'owned') list = list.filter((g) => g.ownedOnDisk);
    if (filter === 'has-mods') list = list.filter((g) => g.localMods > 0);
    return list.sort((a, b) => {
      if (a.ownedOnDisk !== b.ownedOnDisk) return a.ownedOnDisk ? -1 : 1;
      return b.localMods - a.localMods || a.name.localeCompare(b.name);
    });
  }, [catalog, steamGames, filter]);

  return (
    <>
      <div className="filter-row">
        <label>
          Show
          <select value={filter} onChange={(e) => setFilter(e.target.value as GameFilter)}>
            <option value="all">All known games</option>
            <option value="installed">Installed on disk (Steam)</option>
            <option value="owned">Owned / installed only</option>
            <option value="has-mods">Has local mods</option>
          </select>
        </label>
      </div>
      <div className="game-grid">
        {cards.map((g) => (
          <button
            key={g.id}
            type="button"
            className="game-card"
            onClick={() => openGameInstalled(g.id.startsWith('steam-') ? 'all' : g.id)}
            disabled={g.localMods === 0 && !g.ownedOnDisk}
          >
            <div className="game-card-art">
              {g.appId ? <GameCoverImage appId={g.appId} name={g.name} /> : <span>{g.name.slice(0, 1)}</span>}
            </div>
            <div className="game-card-body">
              <h3>{g.name}</h3>
              <span>
                {g.localMods} local mods
                {g.ownedOnDisk ? ' · Installed' : ''}
              </span>
            </div>
          </button>
        ))}
      </div>
      <p className="message" style={{ marginTop: '1rem' }}>
        Last scan: {formatDate(catalog.scannedAt || undefined)} · Total: {catalog.mods.length}
      </p>
    </>
  );
}
