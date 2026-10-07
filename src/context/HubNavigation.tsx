import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type HubTab = 'library' | 'steam' | 'nexus' | 'games' | 'loadouts' | 'settings';
export type SteamPanel = 'installed' | 'hub-browse' | 'browse';
export type NexusPanel = 'installed' | 'browse' | 'injected' | 'native';

type HubNavigationState = {
  tab: HubTab;
  setTab: (t: HubTab) => void;
  gameFilter: string;
  setGameFilter: (id: string) => void;
  steamGameFilter: string;
  setSteamGameFilter: (id: string) => void;
  steamPanel: SteamPanel;
  setSteamPanel: (p: SteamPanel) => void;
  nexusPanel: NexusPanel;
  setNexusPanel: (p: NexusPanel) => void;
  openGameInstalled: (gameId: string) => void;
};

const HubNavigationContext = createContext<HubNavigationState | null>(null);

export function HubNavigationProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<HubTab>('library');
  const [gameFilter, setGameFilter] = useState('all');
  const [steamGameFilter, setSteamGameFilter] = useState('all');
  const [steamPanel, setSteamPanel] = useState<SteamPanel>('installed');
  const [nexusPanel, setNexusPanel] = useState<NexusPanel>('installed');

  const openGameInstalled = (gameId: string) => {
    setGameFilter(gameId);
    setTab('library');
    setSteamPanel('installed');
  };

  const value = useMemo(
    () => ({
      tab,
      setTab,
      gameFilter,
      setGameFilter,
      steamGameFilter,
      setSteamGameFilter,
      steamPanel,
      setSteamPanel,
      nexusPanel,
      setNexusPanel,
      openGameInstalled,
    }),
    [tab, gameFilter, steamGameFilter, steamPanel, nexusPanel],
  );

  return <HubNavigationContext.Provider value={value}>{children}</HubNavigationContext.Provider>;
}

export function useHubNavigation() {
  const ctx = useContext(HubNavigationContext);
  if (!ctx) throw new Error('useHubNavigation outside provider');
  return ctx;
}
