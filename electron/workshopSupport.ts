/** Games with little or no public Steam Workshop browse (mods live on Nexus/other). */
export const WORKSHOP_UNSUPPORTED: Record<number, string> = {
  413150:
    'Stardew Valley does not use Steam Workshop for mods. Use Nexus Mods (SMPI) or the Nexus tab in Mod Hub.',
  1086940:
    "Baldur's Gate 3 has no Steam Workshop. Mods are on Nexus and installed via Vortex or BG3 Mod Manager.",
  1091500:
    'Cyberpunk 2077 Workshop is limited; most mods are Nexus/redmod. Local Cyberpunk 2077 files appear under All mods.',
};

/** Steam app IDs known to have a public Workshop browse catalog. */
export const STEAM_WORKSHOP_BROWSE_APPS = new Set([
  108600, 294100, 489830, 244850, 251570, 949230, 233860, 250900, 105600, 346110, 322330, 393380,
]);

export function workshopUnsupportedMessage(appId: number): string | undefined {
  return WORKSHOP_UNSUPPORTED[appId];
}

export function hasSteamWorkshopBrowse(appId: number, localWorkshopCount = 0): boolean {
  if (WORKSHOP_UNSUPPORTED[appId] && localWorkshopCount === 0) return false;
  if (localWorkshopCount > 0) return true;
  return STEAM_WORKSHOP_BROWSE_APPS.has(appId);
}
