/** Nexus static CDN game folder ids (for URL validation / last-resort guess). */
export const NEXUS_DOMAIN_TO_CDN_GAME_ID: Record<string, number> = {
  cyberpunk2077: 3333,
  skyrimse: 1704,
  skyrimspecialedition: 1704,
  fallout4: 1151,
  rimworld: 1692,
  projectzomboid: 108600,
  stardewvalley: 1303,
  baldursgate3: 3474,
};

export function nexusCdnGameId(domain?: string): number | undefined {
  if (!domain) return undefined;
  const key = domain.toLowerCase().replace(/[^a-z0-9]/g, '');
  return NEXUS_DOMAIN_TO_CDN_GAME_ID[key] ?? NEXUS_DOMAIN_TO_CDN_GAME_ID[domain.toLowerCase()];
}

/** Auto-guessed thumbs use modId/modId.png — Nexus almost never hosts these (404). */
export function isGuess404NexusThumb(url: string | undefined): boolean {
  if (!url) return false;
  return /staticdelivery\.nexusmods\.com\/mods\/\d+\/images\/(\d+)\/\1\.(?:png|jpe?g|webp)$/i.test(url);
}

export function isPlausibleNexusPreviewUrl(url: string, gameDomain: string | undefined, modId: number): boolean {
  if (isGuess404NexusThumb(url)) return false;
  if (!url.includes(String(modId))) return false;
  const gid = nexusCdnGameId(gameDomain);
  if (!gid) return true;
  if (url.includes(`/mods/${gid}/`)) return true;
  if (url.includes('/mods/3333/') && gid !== 3333) return false;
  return true;
}
