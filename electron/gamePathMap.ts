import { gameById } from './gamesRegistry';

/** Steam `steamapps/common` folder name → Mod Hub game id */
export const COMMON_FOLDER_TO_GAME_ID: Record<string, string> = {
  'Cyberpunk 2077': 'cyberpunk2077',
  RimWorld: 'rimworld',
  'Project Zomboid': 'project-zomboid',
  'Skyrim Special Edition': 'skyrimse',
  'Fallout 4': 'fallout4',
  'Stardew Valley': 'stardewvalley',
  "Baldur's Gate 3": 'baldursgate3',
  'Cities: Skylines II': 'cities-skylines-2',
  'Space Engineers': 'space-engineers',
  '7 Days to Die': '7dtd',
  'The Binding of Isaac Rebirth': 'binding-of-isaac',
};

/** Vortex staging folder name → game id */
export const VORTEX_FOLDER_TO_GAME_ID: Record<string, string> = {
  cyberpunk2077: 'cyberpunk2077',
  rimworld: 'rimworld',
  projectzomboid: 'project-zomboid',
  skyrimse: 'skyrimse',
  skyrimvr: 'skyrimvr',
  fallout4: 'fallout4',
  stardewvalley: 'stardewvalley',
  baldursgate3: 'baldursgate3',
  bindingofisaac: 'binding-of-isaac',
};

export function gameIdFromCommonFolder(folderName: string): string {
  return COMMON_FOLDER_TO_GAME_ID[folderName] ?? slugify(folderName);
}

export function gameIdFromVortexFolder(folderName: string): string {
  const key = folderName.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [k, id] of Object.entries(VORTEX_FOLDER_TO_GAME_ID)) {
    if (key.includes(k.replace(/-/g, ''))) return id;
  }
  return slugify(folderName);
}

export function steamAppIdForGameId(gameId: string): number | undefined {
  return gameById(gameId)?.steamAppId;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}
