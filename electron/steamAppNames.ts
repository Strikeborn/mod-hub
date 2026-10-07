import fs from 'node:fs';
import path from 'node:path';
import { discoverSteamLibraries } from './steamDiscovery';

const nameCache = new Map<number, string>();

export function readAppNameFromManifest(acfPath: string): string | undefined {
  try {
    const text = fs.readFileSync(acfPath, 'utf8');
    const m = text.match(/"name"\s+"([^"\\]+)"/);
    return m?.[1];
  } catch {
    return undefined;
  }
}

/** Resolve Steam app display name from library appmanifest_*.acf files. */
export function steamAppDisplayName(appId: number, fallback?: string): string {
  if (nameCache.has(appId)) return nameCache.get(appId)!;
  for (const lib of discoverSteamLibraries()) {
    const acf = path.join(lib, 'steamapps', `appmanifest_${appId}.acf`);
    const name = readAppNameFromManifest(acf);
    if (name) {
      nameCache.set(appId, name);
      return name;
    }
  }
  const label = fallback ?? `Steam app ${appId}`;
  nameCache.set(appId, label);
  return label;
}
