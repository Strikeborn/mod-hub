import type { GameRecord } from '../shared/types';

/** Known games for labeling workshop app IDs and extra mod folders. */
export const GAMES_REGISTRY: GameRecord[] = [
  { id: 'project-zomboid', name: 'Project Zomboid', steamAppId: 108600, modFolderHints: ['mods'] },
  { id: 'rimworld', name: 'RimWorld', steamAppId: 294100, modFolderHints: ['Mods'] },
  { id: 'skyrimse', name: 'Skyrim Special Edition', steamAppId: 489830, modFolderHints: ['Data'] },
  { id: 'fallout4', name: 'Fallout 4', steamAppId: 377160, modFolderHints: ['Data'] },
  { id: 'cyberpunk2077', name: 'Cyberpunk 2077', steamAppId: 1091500, modFolderHints: ['mods', 'archive'] },
  { id: 'stardewvalley', name: 'Stardew Valley', steamAppId: 413150, modFolderHints: ['Mods'] },
  { id: 'baldursgate3', name: "Baldur's Gate 3", steamAppId: 1086940, modFolderHints: ['Mods'] },
  { id: 'cities-skylines-2', name: 'Cities: Skylines II', steamAppId: 949230 },
  { id: 'space-engineers', name: 'Space Engineers', steamAppId: 244850 },
  { id: '7dtd', name: '7 Days to Die', steamAppId: 251570 },
  { id: 'binding-of-isaac', name: 'The Binding of Isaac: Repentance', steamAppId: 250900, modFolderHints: ['mods'] },
  { id: 'rust', name: 'Rust', steamAppId: 252490 },
  { id: 'counter-strike-2', name: 'Counter-Strike 2 / CS:GO', steamAppId: 730 },
  { id: 'garrysmod', name: "Garry's Mod", steamAppId: 4000 },
  { id: 'steamvr', name: 'SteamVR', steamAppId: 250820 },
  { id: 'dyinglight2', name: 'Dying Light 2', steamAppId: 534380 },
  { id: 'dyinglightthebeast', name: 'Dying Light: The Beast', steamAppId: 3008130 },
  { id: 'watchdogs', name: 'Watch Dogs', steamAppId: 243470 },
  { id: 'gta4', name: 'Grand Theft Auto IV', steamAppId: 12210 },
  { id: 'skyrim', name: 'Skyrim (Legendary Edition)', steamAppId: 72850 },
  { id: 'terraria', name: 'Terraria', steamAppId: 105600 },
  { id: 'lethal-company', name: 'Lethal Company', steamAppId: 1966720 },
  { id: 'risk-of-rain-2', name: 'Risk of Rain 2', steamAppId: 632360 },
  { id: 'steam-241100', name: 'Steam Input Configs (controller layouts)', steamAppId: 241100 },
];

/** Nexus domains / folder names that mean the same game as a registry id. */
const GAME_ID_ALIASES: Record<string, string> = {
  projectzomboid: 'project-zomboid',
  skyrimspecialedition: 'skyrimse',
  bindingofisaacrebirth: 'binding-of-isaac',
  thebindingofisaacrebirth: 'binding-of-isaac',
  citiesskylines2: 'cities-skylines-2',
  '7daystodie': '7dtd',
  csgo: 'counter-strike-2',
  cs2: 'counter-strike-2',
  gmod: 'garrysmod',
};

/** Map any game id (Nexus domain, folder name, `steam-{appId}`) to one canonical id. */
export function canonicalGameId(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  const id = raw.toLowerCase();
  if (GAME_ID_ALIASES[id]) return GAME_ID_ALIASES[id];
  const steam = /^steam-(\d+)$/.exec(id);
  if (steam) return gameBySteamAppId(Number(steam[1]))?.id ?? id;
  return id;
}

export function gameBySteamAppId(appId: number): GameRecord | undefined {
  return GAMES_REGISTRY.find((g) => g.steamAppId === appId);
}

export function gameById(id: string): GameRecord | undefined {
  return GAMES_REGISTRY.find((g) => g.id === id);
}
