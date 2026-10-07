import fs from 'node:fs';
import path from 'node:path';
import { discoverSteamLibraries } from './steamDiscovery';

/** App IDs from appmanifest_*.acf in discovered Steam libraries (installed / owned on disk). */
export function listInstalledSteamAppIds(extraLibraryPaths: string[] = []): number[] {
  const libs = [...new Set([...discoverSteamLibraries(), ...extraLibraryPaths])];
  const ids = new Set<number>();

  for (const lib of libs) {
    const appsDir = path.join(lib, 'steamapps');
    let files: string[];
    try {
      files = fs.readdirSync(appsDir);
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.startsWith('appmanifest_') || !name.endsWith('.acf')) continue;
      const appId = Number(name.slice('appmanifest_'.length, -'.acf'.length));
      if (Number.isFinite(appId) && appId > 0) ids.add(appId);
    }
  }

  return [...ids].sort((a, b) => a - b);
}
