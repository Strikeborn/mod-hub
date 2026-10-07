import path from 'node:path';

/**
 * Vortex staging roots are configurable (`settings###mods###installPath###<game>`), e.g.
 * `F:\Vortex_Mods\cyberpunk2077`. Resolved once per state read and shared with the scanners
 * that used to assume the `%APPDATA%\Vortex\<game>\mods` default.
 */
let stagingPaths = new Map<string, string>();

export function setVortexStagingPaths(paths: Map<string, string>): void {
  stagingPaths = new Map([...paths].map(([k, v]) => [k.toLowerCase(), v]));
}

export function vortexStagingRoot(gameKey: string): string | undefined {
  const key = gameKey.toLowerCase();
  const configured = stagingPaths.get(key);
  if (configured) return configured;
  const appData = process.env.APPDATA;
  return appData ? path.join(appData, 'Vortex', key, 'mods') : undefined;
}

export function allVortexStagingRoots(): Map<string, string> {
  return new Map(stagingPaths);
}
