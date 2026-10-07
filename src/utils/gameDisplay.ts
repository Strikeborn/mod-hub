import type { GameRecord, ModRecord } from '@shared/types';
import { steamAppIdForGameId } from './games';

/** Well-known Steam app ids when mods use `steam-{appId}` game ids. */
const STEAM_APP_LABELS: Record<number, string> = {
  252490: 'Rust',
  250900: 'The Binding of Isaac: Rebirth',
  247580: 'The Binding of Isaac: Repentance',
  1091500: 'Cyberpunk 2077',
  108600: 'Project Zomboid',
  294100: 'RimWorld',
  241100: 'Steam Input Configs (controller layouts)',
};

const GAME_ID_LABELS: Record<string, string> = {
  'binding-of-isaac': 'The Binding of Isaac: Repentance',
  cyberpunk2077: 'Cyberpunk 2077',
  'project-zomboid': 'Project Zomboid',
  rust: 'Rust',
  baldursgate3: "Baldur's Gate 3",
  roblox: 'Roblox',
};

function titleCaseSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Human-readable game name for cards and filters. */
export function displayGameName(mod: Pick<ModRecord, 'gameId' | 'steamAppId' | 'nexusGameDomain'>, games: GameRecord[]): string {
  const id = mod.gameId;
  const fromCatalog = games.find((g) => g.id === id)?.name;
  if (fromCatalog) return fromCatalog;

  const labeled = GAME_ID_LABELS[id];
  if (labeled) return labeled;

  const appId = mod.steamAppId ?? steamAppIdForGameId(id);
  if (appId && STEAM_APP_LABELS[appId]) return STEAM_APP_LABELS[appId];

  if (id.startsWith('steam-')) {
    const n = Number(id.replace('steam-', ''));
    if (Number.isFinite(n) && STEAM_APP_LABELS[n]) return STEAM_APP_LABELS[n];
    if (Number.isFinite(n)) return `Steam app ${n}`;
  }

  if (mod.nexusGameDomain && mod.nexusGameDomain !== id) {
    const nx = GAME_ID_LABELS[mod.nexusGameDomain] ?? titleCaseSlug(mod.nexusGameDomain);
    return nx;
  }

  return titleCaseSlug(id);
}

/** Nexus installed tab: group key for game filter (prefer Nexus domain). */
export function nexusGameFilterKey(m: ModRecord): string {
  return (m.nexusGameDomain ?? m.gameId).toLowerCase();
}
