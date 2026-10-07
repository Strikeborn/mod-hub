import fs from 'node:fs';
import path from 'node:path';

const FALLBACK_GAME_IDS: Record<string, number> = {
  cyberpunk2077: 3333,
  skyrimspecialedition: 1704,
  skyrimse: 1704,
  fallout4: 1151,
  stardewvalley: 1303,
  rimworld: 1234,
  projectzomboid: 12345,
};

function loadVortexNexusGameIds(): Map<string, number> {
  const map = new Map<string, number>();
  try {
    const cachePath = path.join(process.env.APPDATA ?? '', 'Vortex', 'temp', 'nexus_gamelist.json');
    if (!fs.existsSync(cachePath)) return map;
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as Array<{ domain_name?: string; id?: number }>;
    for (const entry of raw) {
      const domain = entry.domain_name?.toLowerCase();
      const id = Number(entry.id);
      if (domain && Number.isFinite(id)) map.set(domain, id);
    }
  } catch {
    /* optional */
  }
  return map;
}

export function nexusGameNumericId(gameDomain: string): number | undefined {
  const key = gameDomain.toLowerCase().replace(/[^a-z0-9]/g, '');
  const fromCache = loadVortexNexusGameIds().get(gameDomain.toLowerCase());
  if (fromCache) return fromCache;
  return FALLBACK_GAME_IDS[key];
}

export function parseNexusBrowseUrl(url: string): { gameDomain: string; browseHref: string } | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('nexusmods.com')) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'games' && parts[1]) return { gameDomain: parts[1], browseHref: u.href };
    if (parts.length >= 2 && parts[1] === 'mods') return { gameDomain: parts[0], browseHref: u.href };
    return null;
  } catch {
    return null;
  }
}

export function buildEnhancerUpdateScript(browseHref: string, gameDomain: string): string {
  const gameNumericId = nexusGameNumericId(gameDomain);
  const config = {
    installed: {},
    hideInstalled: false,
    onlyInstalled: false,
    hideTracked: false,
    onlyTracked: false,
    gridColumns: 8,
    gridRows: 3,
    applyDefaultFilters: true,
    hideSiteChrome: true,
    tracked: {},
    endorsed: {},
    viewerDownloaded: {},
    trackedListLoaded: false,
    browseHref,
    filterBrowseActive: false,
    gameNumericId,
  };
  return `(function(){try{if(window.__vortexBrowseEnhancer){return window.__vortexBrowseEnhancer.update(${JSON.stringify(config)});}return { error: 'enhancer missing' };}catch(e){return { error: String(e && e.message || e) };}})();`;
}

export function buildInjectionLoaderScript(protocolUrl: string): string {
  const safe = protocolUrl.replace(/\\/g, '/').replace(/'/g, "%27");
  return `(function(){
    return new Promise(function(resolve, reject) {
      if (window.__vortexBrowseEnhancer) { resolve('already'); return; }
      var s = document.createElement('script');
      s.src = '${safe}';
      s.onload = function() { resolve('loaded'); };
      s.onerror = function() { reject(new Error('injection script load failed')); };
      (document.head || document.documentElement).appendChild(s);
    });
  })();`;
}

export function buildFileInjectionLoaderScript(diskPath: string): string {
  const url = `file:///${diskPath.replace(/\\/g, '/').replace(/'/g, "%27")}`;
  return buildInjectionLoaderScript(url);
}
