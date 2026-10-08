import { contextBridge, ipcRenderer } from 'electron';
import type {
  IpcApi,
  ScanOptions,
  HubSettings,
  ScanProgressEvent,
  WorkshopBrowseQuery,
} from '../shared/types';

const modHub: IpcApi = {
  scanAll: (options?: ScanOptions) => ipcRenderer.invoke('modhub:scanAll', options),
  getCatalog: () => ipcRenderer.invoke('modhub:getCatalog'),
  getSettings: () => ipcRenderer.invoke('modhub:getSettings'),
  saveSettings: (partial: Partial<HubSettings>) => ipcRenderer.invoke('modhub:saveSettings', partial),
  setFavorite: (modId: string, favorited: boolean) => ipcRenderer.invoke('modhub:setFavorite', modId, favorited),
  setSubscribed: (modId: string, subscribed: boolean) => ipcRenderer.invoke('modhub:setSubscribed', modId, subscribed),
  workshopDeleteLocal: (modIds: string[]) => ipcRenderer.invoke('modhub:workshopDeleteLocal', modIds),
  dismissMod: (modId: string) => ipcRenderer.invoke('modhub:dismissMod', modId),
  getModMedia: (modId: string) => ipcRenderer.invoke('modhub:getModMedia', modId),
  openInSteam: (url: string) => ipcRenderer.invoke('modhub:openInSteam', url),
  getModChanges: (modId: string) => ipcRenderer.invoke('modhub:getModChanges', modId),
  workshopUpdate: (modId: string) => ipcRenderer.invoke('modhub:workshopUpdate', modId),
  findCrossPlatform: (modId: string) => ipcRenderer.invoke('modhub:findCrossPlatform', modId),
  linkCrossPlatform: (
    modId: string,
    link: { platform: 'nexus' | 'workshop'; id: string; domain?: string; appId?: number; title?: string } | null,
    platformToClear?: 'nexus' | 'workshop',
  ) => ipcRenderer.invoke('modhub:linkCrossPlatform', modId, link, platformToClear),
  getDiskInfo: (modId: string) => ipcRenderer.invoke('modhub:getDiskInfo', modId),
  workshopBulkKeep: (modIds: string[]) => ipcRenderer.invoke('modhub:workshopBulkKeep', modIds),
  onBulkProgress: (handler: (p: { done: number; total: number; current: string; phase: string }) => void) => {
    const listener = (_e: unknown, p: { done: number; total: number; current: string; phase: string }) => handler(p);
    ipcRenderer.on('modhub:bulk-progress', listener);
    return () => ipcRenderer.removeListener('modhub:bulk-progress', listener);
  },
  onToast: (handler: (t: { message: string; kind?: 'ok' | 'error' | 'info' }) => void) => {
    const listener = (_e: unknown, t: { message: string; kind?: 'ok' | 'error' | 'info' }) => handler(t);
    ipcRenderer.on('modhub:toast', listener);
    return () => ipcRenderer.removeListener('modhub:toast', listener);
  },
  onCatalogUpdated: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on('modhub:catalog-updated', listener);
    return () => ipcRenderer.removeListener('modhub:catalog-updated', listener);
  },
  workshopUnsubscribe: (modId: string, keepCopy: boolean) =>
    ipcRenderer.invoke('modhub:workshopUnsubscribe', modId, keepCopy),
  checkWorkshopUpdates: (gameSteamAppId?: number) => ipcRenderer.invoke('modhub:checkWorkshopUpdates', gameSteamAppId),
  getThumbnail: (filePath: string) => ipcRenderer.invoke('modhub:getThumbnail', filePath),
  getLoadOrders: () => ipcRenderer.invoke('modhub:getLoadOrders'),
  getIsaacConflicts: () => ipcRenderer.invoke('modhub:getIsaacConflicts'),
  getPlayInfo: (gameId: string) => ipcRenderer.invoke('modhub:getPlayInfo', gameId),
  checkModSecurity: (modId: string) => ipcRenderer.invoke('modhub:checkModSecurity', modId),
  getSecurityReport: (modId: string) => ipcRenderer.invoke('modhub:getSecurityReport', modId),
  getSecurityOverview: () => ipcRenderer.invoke('modhub:getSecurityOverview'),
  checkAllExecutableMods: () => ipcRenderer.invoke('modhub:checkAllExecutableMods'),
  stopSecurityChecks: () => ipcRenderer.invoke('modhub:stopSecurityChecks'),
  defenderSweep: () => ipcRenderer.invoke('modhub:defenderSweep'),
  getLastSweep: () => ipcRenderer.invoke('modhub:getLastSweep'),
  onSecurityProgress: (handler: (p: { done: number; total: number; current: string; running: boolean }) => void) => {
    const listener = (_e: unknown, p: { done: number; total: number; current: string; running: boolean }) => handler(p);
    ipcRenderer.on('modhub:security-progress', listener);
    return () => ipcRenderer.removeListener('modhub:security-progress', listener);
  },
  openVirusTotal: (hash: string) => ipcRenderer.invoke('modhub:openVirusTotal', hash),
  getSteamUpdates: (appIds: number[]) => ipcRenderer.invoke('modhub:getSteamUpdates', appIds),
  setIsaacFolderEnabled: (folder: string, enabled: boolean) => ipcRenderer.invoke('modhub:setIsaacFolderEnabled', folder, enabled),
  playGame: (gameId: string, optionId: string, profile?: string) => ipcRenderer.invoke('modhub:playGame', gameId, optionId, profile),
  setModsEnabled: (gameId: string, modIds: string[], enabled: boolean) =>
    ipcRenderer.invoke('modhub:setModsEnabled', gameId, modIds, enabled),
  getLoadouts: (gameId: string) => ipcRenderer.invoke('modhub:getLoadouts', gameId),
  planLoadOrder: (gameId: string, order?: string[]) => ipcRenderer.invoke('modhub:planLoadOrder', gameId, order),
  setLoadOrder: (gameId: string, ids: string[]) => ipcRenderer.invoke('modhub:setLoadOrder', gameId, ids),
  applyLoadout: (gameId: string, loadoutId: string) => ipcRenderer.invoke('modhub:applyLoadout', gameId, loadoutId),
  saveLoadout: (gameId: string, name: string) => ipcRenderer.invoke('modhub:saveLoadout', gameId, name),
  deleteLoadout: (gameId: string, loadoutId: string) => ipcRenderer.invoke('modhub:deleteLoadout', gameId, loadoutId),
  updateLoadout: (gameId: string, loadoutId: string) => ipcRenderer.invoke('modhub:updateLoadout', gameId, loadoutId),
  applyLoadoutToSave: (loadoutId: string, saveId: string) => ipcRenderer.invoke('modhub:applyLoadoutToSave', loadoutId, saveId),
  exportLoadoutCode: (gameId: string, loadoutId: string) => ipcRenderer.invoke('modhub:exportLoadoutCode', gameId, loadoutId),
  importLoadoutCode: (code: string) => ipcRenderer.invoke('modhub:importLoadoutCode', code),
  getSteamGameArt: (appId: number) => ipcRenderer.invoke('modhub:getSteamGameArt', appId),
  fetchRemoteThumbnail: (url: string) => ipcRenderer.invoke('modhub:fetchRemoteThumbnail', url),
  steamSubscribe: (appId: number, workshopId: string) => ipcRenderer.invoke('modhub:steamSubscribe', appId, workshopId),
  steamOpenWorkshop: (appId: number, workshopId: string) => ipcRenderer.invoke('modhub:steamOpenWorkshop', appId, workshopId),
  nexusOpenMod: (gameDomain: string, modId: number) => ipcRenderer.invoke('modhub:nexusOpenMod', gameDomain, modId),
  nexusDownloadMod: (gameDomain: string, modId: number) => ipcRenderer.invoke('modhub:nexusDownloadMod', gameDomain, modId),
  nexusTrackMod: (gameDomain: string, modId: number, track: boolean) =>
    ipcRenderer.invoke('modhub:nexusTrackMod', gameDomain, modId, track),
  openPath: (filePath: string) => ipcRenderer.invoke('modhub:openPath', filePath),
  openWorkshopSearch: (appId: number, text: string) => ipcRenderer.invoke('modhub:openWorkshopSearch', appId, text),
  pickScanFolders: () => ipcRenderer.invoke('modhub:pickScanFolders'),
  workshopBrowse: (query: WorkshopBrowseQuery) => ipcRenderer.invoke('modhub:workshopBrowse', query),
  getSteamLibraryGames: () => ipcRenderer.invoke('modhub:getSteamLibraryGames'),
  getFavoriteIds: () => ipcRenderer.invoke('modhub:getFavoriteIds'),
  getBrowseInjectionScript: () => ipcRenderer.invoke('modhub:getBrowseInjectionScript'),
  injectBrowseEnhancer: (guestWebContentsId: number, pageUrl: string) =>
    ipcRenderer.invoke('modhub:injectBrowseEnhancer', guestWebContentsId, pageUrl),
  workshopFavoriteInstall: (appId: number, workshopId: string) =>
    ipcRenderer.invoke('modhub:workshopFavoriteInstall', appId, workshopId),
  nexusFetchTracked: (gameDomain: string) => ipcRenderer.invoke('modhub:nexusFetchTracked', gameDomain),
  nexusFetchAllTracked: () => ipcRenderer.invoke('modhub:nexusFetchAllTracked'),
  onScanProgress: (handler: (event: ScanProgressEvent) => void) => {
    const listener = (_event: unknown, payload: ScanProgressEvent) => handler(payload);
    ipcRenderer.on('modhub:scan-progress', listener);
    return () => ipcRenderer.removeListener('modhub:scan-progress', listener);
  },
};

contextBridge.exposeInMainWorld('modHub', modHub);

contextBridge.exposeInMainWorld('modHubEnv', {
  isElectron: true,
});

contextBridge.exposeInMainWorld('modHubAuth', {
  validateNexusKey: (apiKey: string) => ipcRenderer.invoke('modhub:validateNexusKey', apiKey),
  openSteamLogin: () => ipcRenderer.invoke('modhub:openSteamLogin'),
  openNexusLogin: () => ipcRenderer.invoke('modhub:openNexusLogin'),
});
