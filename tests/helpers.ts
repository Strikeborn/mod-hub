import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModRecord } from '../shared/types';

/** A throwaway "home" folder; USERPROFILE/HOME/APPDATA point at it so code under test never touches real files. */
export function tempHome(): { home: string; restore: () => void } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-test-'));
  const saved = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME, APPDATA: process.env.APPDATA };
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  process.env.APPDATA = path.join(home, 'AppData', 'Roaming');
  fs.mkdirSync(process.env.APPDATA, { recursive: true });
  return {
    home,
    restore: () => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

export function write(file: string, text: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

export function mod(partial: Partial<ModRecord> & { id: string; gameId: string }): ModRecord {
  return {
    source: 'steam-workshop',
    title: partial.id,
    localPath: '',
    installedAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    favorited: false,
    revision: { kind: 'folder_mtime', value: '0' },
    ...partial,
  } as ModRecord;
}

export const RIMWORLD_CONFIG = (home: string) =>
  path.join(home, 'AppData', 'LocalLow', 'Ludeon Studios', 'RimWorld by Ludeon Studios', 'Config', 'ModsConfig.xml');

export function modsConfig(ids: string[]): string {
  return `﻿<?xml version="1.0" encoding="utf-8"?>
<ModsConfigData>
  <version>1.5.4409 rev1120</version>
  <activeMods>
${ids.map((i) => `    <li>${i}</li>`).join('\n')}
  </activeMods>
  <knownExpansions>
    <li>ludeon.rimworld.royalty</li>
  </knownExpansions>
</ModsConfigData>`;
}

/** A RimWorld mod folder with an About.xml (dependencies may be listed before the mod's own packageId). */
export function rimworldMod(root: string, id: string, rules: { deps?: string[]; after?: string[]; before?: string[] } = {}): string {
  const dir = path.join(root, id);
  const li = (xs: string[] = []) => xs.map((x) => `<li>${x}</li>`).join('');
  write(
    path.join(dir, 'About', 'About.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<ModMetaData>
  <name>${id}</name>
  ${rules.deps?.length ? `<modDependencies>${rules.deps.map((d) => `<li><packageId>${d}</packageId><displayName>${d}</displayName></li>`).join('')}</modDependencies>` : ''}
  <packageId>${id}</packageId>
  <loadAfter>${li(rules.after)}</loadAfter>
  <loadBefore>${li(rules.before)}</loadBefore>
</ModMetaData>`,
  );
  return dir;
}
