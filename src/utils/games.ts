import type { CatalogSnapshot } from '@shared/types';

const APP_BY_GAME: Record<string, number> = {
  'project-zomboid': 108600,
  rimworld: 294100,
  skyrimse: 489830,
  fallout4: 377160,
  cyberpunk2077: 1091500,
  stardewvalley: 413150,
  baldursgate3: 1086940,
  'cities-skylines-2': 949230,
  'space-engineers': 244850,
  '7dtd': 251570,
  'binding-of-isaac': 250900,
  rust: 252490,
};

export function isNexusLikeSource(m: { source: string; nexusModId?: number; tags?: string[] }): boolean {
  return (
    m.source === 'nexus' ||
    m.source === 'vortex-staging' ||
    m.nexusModId != null ||
    m.tags?.some((t) => /vortex|nexus/i.test(t)) === true
  );
}

export function steamAppIdForGameId(gameId: string): number | undefined {
  if (gameId.startsWith('steam-')) return Number(gameId.replace('steam-', ''));
  return APP_BY_GAME[gameId] ?? undefined;
}

export function modCountForGame(catalog: CatalogSnapshot, gameId: string): number {
  return catalog.mods.filter((m) => m.gameId === gameId).length;
}
