import { useMemo, useState } from 'react';
import type { CatalogSnapshot, ModRecord, ViewMode } from '@shared/types';
import { ModCollectionView } from '../components/ModCollectionView';
import { SubTabs } from '../components/SubTabs';
import { EmbeddedWebView } from '../components/EmbeddedWebView';
import { InjectedWebView } from '../components/InjectedWebView';
import { useHubNavigation } from '../context/HubNavigation';
import { displayGameName, nexusGameFilterKey } from '../utils/gameDisplay';

type Props = {
  catalog: CatalogSnapshot;
  viewMode: ViewMode;
  trackedNexus?: Set<string>;
  onTrackedNexusChange?: () => void;
  onFavorite: (mod: ModRecord) => void;
  onDismiss?: (mod: ModRecord) => void;
};

const NEXUS_BROWSE_URL = 'https://www.nexusmods.com/games';
const NEXUS_INJECT_DEFAULT = 'https://www.nexusmods.com/games/cyberpunk2077/mods';

function isNexusLocal(m: ModRecord): boolean {
  return (
    m.source === 'nexus' ||
    m.source === 'vortex-staging' ||
    m.nexusModId != null ||
    m.tags?.some((t) => /vortex|nexus/i.test(t)) === true
  );
}

export function NexusView({ catalog, viewMode, trackedNexus, onTrackedNexusChange, onFavorite, onDismiss }: Props) {
  const { nexusPanel, setNexusPanel } = useHubNavigation();
  const [nexusGameFilter, setNexusGameFilter] = useState('all');

  const local = useMemo(() => catalog.mods.filter(isNexusLocal), [catalog.mods]);

  const nexusGames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of local) {
      const key = nexusGameFilterKey(m);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({
        id,
        name: displayGameName({ gameId: id, nexusGameDomain: id }, catalog.games),
        count,
      }));
  }, [local, catalog.games]);

  const filtered = useMemo(() => {
    if (nexusGameFilter === 'all') return local;
    return local.filter((m) => nexusGameFilterKey(m) === nexusGameFilter);
  }, [local, nexusGameFilter]);

  return (
    <>
      <SubTabs
        tabs={[
          { id: 'installed' as const, label: 'Downloaded / installed' },
          { id: 'browse' as const, label: 'Browse Nexus' },
          { id: 'injected' as const, label: 'Browse carousel (injection)' },
          { id: 'native' as const, label: 'Native (no injection)' },
        ]}
        active={nexusPanel}
        onChange={setNexusPanel}
      />

      {nexusPanel === 'installed' && (
        <>
          {local.length === 0 ? (
            <div className="empty-state">No Nexus/Vortex mods found — run Scan computer after Vortex installs.</div>
          ) : (
            <>
              <div className="nexus-installed-toolbar">
                <label className="toolbar-select">
                  Game
                  <select value={nexusGameFilter} onChange={(e) => setNexusGameFilter(e.target.value)}>
                    <option value="all">All games ({local.length})</option>
                    {nexusGames.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.count})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <ModCollectionView
                mods={filtered}
                games={catalog.games}
                viewMode={viewMode}
                cardVariant="nexus"
                trackedNexus={trackedNexus}
                onTrackedNexusChange={onTrackedNexusChange}
                onFavorite={onFavorite}
                onDismiss={onDismiss}
                emptyMessage="No mods for this game."
              />
            </>
          )}
        </>
      )}

      {nexusPanel === 'browse' && (
        <>
          <EmbeddedWebView src={NEXUS_BROWSE_URL} title="Nexus Mods" partition="persist:modhub-nexus-browse" />
        </>
      )}

      {nexusPanel === 'injected' && (
        <InjectedWebView src={NEXUS_INJECT_DEFAULT} title="Nexus browse (injected)" />
      )}

      {nexusPanel === 'native' && (
        <>
          <p className="message message-compact">
            Future native carousel (no DOM injection). API key handles track/nxm from Mod Hub.
          </p>
          <div className="empty-state">Native Nexus UI not wired yet.</div>
        </>
      )}
    </>
  );
}
