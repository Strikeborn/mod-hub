import fs from 'node:fs';
import path from 'node:path';
import type { ModRecord } from '../shared/types';
import { stableIdFromParts as stableId } from './scanHelpers';

/**
 * Thunderstore mods installed through r2modman or the Thunderstore Mod Manager app. Each game has profiles;
 * each profile's mods.yml lists its packages (name, author, version, enabled, icon). Read-only: the manager
 * owns those profiles.
 */

type R2Mod = {
  name?: string;
  displayName?: string;
  authorName?: string;
  description?: string;
  websiteUrl?: string;
  icon?: string;
  enabled?: boolean;
  installedAtTime?: number;
  version?: string;
};

/** r2modman writes a flat YAML list of maps (2-space keys, versionNumber nested one level). */
export function parseR2ModsYml(text: string): R2Mod[] {
  const mods: R2Mod[] = [];
  let cur: R2Mod | null = null;
  let inVersion = false;
  const ver: Record<string, string> = {};
  const finish = () => {
    if (!cur) return;
    if (ver.major != null) cur.version = [ver.major, ver.minor ?? '0', ver.patch ?? '0'].join('.');
    mods.push(cur);
    for (const k of Object.keys(ver)) delete ver[k];
  };
  const unquote = (v: string) => v.trim().replace(/^(['"])(.*)\1$/, '$2');
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const item = /^-\s+(\w+):\s*(.*)$/.exec(raw);
    const key = /^ {2}(\w+):\s*(.*)$/.exec(raw);
    const nested = /^ {4}(\w+):\s*(.*)$/.exec(raw);
    if (item) {
      finish();
      cur = {};
      inVersion = false;
      (cur as Record<string, unknown>)[item[1]] = unquote(item[2]);
      continue;
    }
    if (!cur) continue;
    if (key) {
      inVersion = key[1] === 'versionNumber';
      const v = unquote(key[2]);
      if (key[1] === 'enabled') cur.enabled = v !== 'false';
      else if (key[1] === 'installedAtTime') cur.installedAtTime = Number(v) || undefined;
      else if (!inVersion && v) (cur as Record<string, unknown>)[key[1]] = v;
      continue;
    }
    if (nested && inVersion) ver[nested[1]] = unquote(nested[2]);
  }
  finish();
  return mods;
}

const MANAGER_ROOTS = (): string[] => {
  const appData = process.env.APPDATA ?? '';
  return [path.join(appData, 'r2modmanPlus-local'), path.join(appData, 'Thunderstore Mod Manager', 'DataFolder')];
};

/** r2modman's game folder name ("LethalCompany", "RiskOfRain2") -> Mod Hub game id. */
const GAME_IDS: Record<string, string> = {
  lethalcompany: 'lethal-company',
  riskofrain2: 'risk-of-rain-2',
  valheim: 'valheim',
  contentwarning: 'content-warning',
};

export function scanThunderstoreProfiles(addMod: (m: ModRecord, label?: string, root?: string) => void): number {
  let added = 0;
  for (const root of MANAGER_ROOTS()) {
    if (!fs.existsSync(root)) continue;
    for (const game of fs.readdirSync(root, { withFileTypes: true })) {
      const profilesDir = path.join(root, game.name, 'profiles');
      if (!game.isDirectory() || !fs.existsSync(profilesDir)) continue;
      const gameId = GAME_IDS[game.name.toLowerCase()] ?? game.name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
      for (const profile of fs.readdirSync(profilesDir, { withFileTypes: true })) {
        if (!profile.isDirectory()) continue;
        const profileDir = path.join(profilesDir, profile.name);
        const yml = path.join(profileDir, 'mods.yml');
        if (!fs.existsSync(yml)) continue;
        let list: R2Mod[] = [];
        try {
          list = parseR2ModsYml(fs.readFileSync(yml, 'utf8'));
        } catch {
          continue;
        }
        for (const m of list) {
          if (!m.name) continue;
          const pluginDir = path.join(profileDir, 'BepInEx', 'plugins', m.name);
          const localPath = fs.existsSync(pluginDir) ? pluginDir : profileDir;
          const icon = m.icon && fs.existsSync(m.icon) ? m.icon : undefined;
          addMod(
            {
              id: stableId(['thunderstore', game.name, profile.name, m.name]),
              source: 'local',
              gameId,
              title: m.displayName || m.name.replace(/^[^-]+-/, ''),
              author: m.authorName,
              description: m.description,
              version: m.version,
              localPath,
              iconPath: icon,
              previewPath: icon,
              installedAt: m.installedAtTime ? new Date(m.installedAtTime).toISOString() : new Date().toISOString(),
              lastSeenAt: new Date().toISOString(),
              favorited: false,
              revision: { kind: 'folder_mtime', value: String(Math.floor((m.installedAtTime ?? Date.now()) / 1000)) },
              tags: ['thunderstore', `profile:${profile.name}`, ...(m.enabled === false ? ['thunderstore-disabled'] : [])],
              thunderstore: { packageName: m.name, profile: profile.name, websiteUrl: m.websiteUrl, enabled: m.enabled !== false },
            },
            `Thunderstore (${game.name} / ${profile.name})`,
            profileDir,
          );
          added += 1;
        }
      }
    }
  }
  return added;
}
