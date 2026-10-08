import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModRecord } from '../shared/types';
import { stableIdFromParts } from './scanHelpers';

/**
 * Mod Organizer 2: portable installs (registered as the nxm handler) and global instances in
 * %LOCALAPPDATA%\ModOrganizer. Mod Hub reads them (mods, profiles, load order) and launches through them;
 * MO2 stays the owner of its profiles, so nothing here writes MO2 files.
 */

export type Mo2Instance = {
  root: string;
  exe: string;
  gameName: string;
  gameId?: string;
  nexusDomain?: string;
  gamePath?: string;
  modsDir: string;
  profiles: string[];
  selectedProfile?: string;
  executables: { title: string; binary: string; arguments?: string }[];
};

const MO2_GAMES: Record<string, { gameId: string; nexus: string }> = {
  'skyrim special edition': { gameId: 'skyrimse', nexus: 'skyrimspecialedition' },
  skyrimse: { gameId: 'skyrimse', nexus: 'skyrimspecialedition' },
  skyrim: { gameId: 'skyrim', nexus: 'skyrim' },
  'fallout 4': { gameId: 'fallout4', nexus: 'fallout4' },
  fallout4: { gameId: 'fallout4', nexus: 'fallout4' },
  'new vegas': { gameId: 'falloutnv', nexus: 'newvegas' },
  'cyberpunk 2077': { gameId: 'cyberpunk2077', nexus: 'cyberpunk2077' },
  "baldur's gate 3": { gameId: 'baldursgate3', nexus: 'baldursgate3' },
  starfield: { gameId: 'starfield', nexus: 'starfield' },
};

function iniValue(text: string, key: string): string | undefined {
  const m = new RegExp(`^${key}=(.*)$`, 'mi').exec(text)?.[1]?.trim();
  return m?.replace(/^@ByteArray\((.*)\)$/, '$1').replace(/\\\\/g, '\\').replace(/^"(.*)"$/, '$1');
}

function readInstance(root: string): Mo2Instance | null {
  const iniPath = path.join(root, 'ModOrganizer.ini');
  if (!fs.existsSync(iniPath)) return null;
  const ini = fs.readFileSync(iniPath, 'utf8');
  const gameName = iniValue(ini, 'gameName') ?? '';
  const game = MO2_GAMES[gameName.toLowerCase()];
  const execBlock = /^\[customExecutables\]([\s\S]*?)(?=^\[)/m.exec(`${ini}\n[`)?.[1] ?? '';
  const executables: Mo2Instance['executables'] = [];
  for (const m of execBlock.matchAll(/^(\d+)\\title=(.*)$/gm)) {
    const n = m[1];
    const binary = new RegExp(`^${n}\\\\binary=(.*)$`, 'm').exec(execBlock)?.[1]?.trim();
    const args = new RegExp(`^${n}\\\\arguments=(.*)$`, 'm').exec(execBlock)?.[1]?.trim();
    if (binary) executables.push({ title: m[2].trim(), binary, arguments: args || undefined });
  }
  // Paths in [Settings] may use %BASE_DIR%.
  const resolveDir = (v: string | undefined, fallback: string) =>
    v ? path.resolve(root, v.replace(/%BASE_DIR%/gi, root)) : path.join(root, fallback);
  const profilesDir = resolveDir(iniValue(ini, 'profiles_directory'), 'profiles');
  const profiles = fs.existsSync(profilesDir)
    ? fs.readdirSync(profilesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];
  return {
    root,
    exe: path.join(root, 'ModOrganizer.exe'),
    gameName,
    gameId: game?.gameId,
    nexusDomain: game?.nexus,
    gamePath: iniValue(ini, 'gamePath'),
    modsDir: resolveDir(iniValue(ini, 'mod_directory'), 'mods'),
    profiles,
    selectedProfile: iniValue(ini, 'selected_profile'),
    executables,
  };
}

export function mo2ProfilesDir(inst: Mo2Instance): string {
  return path.join(inst.root, 'profiles');
}

export function findMo2Instances(): Mo2Instance[] {
  const out: Mo2Instance[] = [];
  const seen = new Set<string>();
  const add = (root: string) => {
    const key = path.resolve(root).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const inst = readInstance(root);
    if (inst) out.push(inst);
  };
  const local = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'ModOrganizer');
  try {
    const nxm = fs.readFileSync(path.join(local, 'nxmhandler.ini'), 'utf8');
    for (const m of nxm.matchAll(/executable=(.*)$/gm)) add(path.dirname(m[1].trim().replace(/\\\\/g, '\\')));
  } catch {
    /* no handler registered */
  }
  try {
    for (const d of fs.readdirSync(local, { withFileTypes: true })) if (d.isDirectory()) add(path.join(local, d.name));
  } catch {
    /* no global instances */
  }
  return out;
}

/** modlist.txt: "+Name" enabled, "-Name" disabled, "*Name" unmanaged/DLC; first line = highest priority. */
export function readMo2Modlist(inst: Mo2Instance, profile: string): { name: string; enabled: boolean; unmanaged: boolean }[] {
  try {
    const text = fs.readFileSync(path.join(mo2ProfilesDir(inst), profile, 'modlist.txt'), 'utf8');
    return text
      .split(/\r?\n/)
      .filter((l) => /^[+\-*]/.test(l))
      .map((l) => ({ name: l.slice(1).trim(), enabled: l[0] === '+', unmanaged: l[0] === '*' }));
  } catch {
    return [];
  }
}

/** plugins.txt: "*Plugin.esp" active (Bethesda format), in load order. */
export function readMo2Plugins(inst: Mo2Instance, profile: string): { name: string; active: boolean }[] {
  try {
    const text = fs.readFileSync(path.join(mo2ProfilesDir(inst), profile, 'plugins.txt'), 'utf8');
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => ({ name: l.replace(/^\*/, ''), active: l.startsWith('*') }));
  } catch {
    return [];
  }
}

function metaIni(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const text = fs.readFileSync(path.join(dir, 'meta.ini'), 'utf8');
    let section = '';
    for (const line of text.split(/\r?\n/)) {
      const sec = /^\[(.+)\]$/.exec(line.trim());
      if (sec) {
        section = sec[1];
        continue;
      }
      const kv = /^([^=]+)=(.*)$/.exec(line);
      if (kv && (section === 'General' || section === '')) out[kv[1].trim()] = kv[2].trim().replace(/^"(.*)"$/, '$1');
    }
  } catch {
    /* no meta.ini */
  }
  return out;
}

/** Every mod in each MO2 instance's mods folder (Nexus id + version from meta.ini). */
export function scanMo2Mods(addMod: (m: ModRecord, label?: string, root?: string) => void): number {
  let added = 0;
  for (const inst of findMo2Instances()) {
    if (!inst.gameId || !fs.existsSync(inst.modsDir)) continue;
    for (const d of fs.readdirSync(inst.modsDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const dir = path.join(inst.modsDir, d.name);
      const meta = metaIni(dir);
      const modId = Number(meta.modid);
      const stat = fs.statSync(dir);
      // MO2 prefixes versions it couldn't parse: "d2026.0.0.0-04-03" is only an install date (no real version),
      // "f2.08" is free-form text. Treat the date kind as unknown so update checks don't compare against it.
      const version = /^d\d/.test(meta.version ?? '') ? undefined : meta.version?.replace(/^f(?=\d)/, '');
      addMod(
        {
          id: stableIdFromParts(['mo2', inst.root.toLowerCase(), d.name]),
          source: 'local',
          gameId: inst.gameId,
          title: d.name,
          version: version || undefined,
          description: meta.nexusDescription?.replace(/\\n/g, '\n'),
          localPath: dir,
          nexusModId: Number.isFinite(modId) && modId > 0 ? modId : undefined,
          nexusGameDomain: Number.isFinite(modId) && modId > 0 ? inst.nexusDomain : undefined,
          installedAt: stat.mtime.toISOString(),
          lastSeenAt: new Date().toISOString(),
          favorited: false,
          revision: { kind: 'folder_mtime', value: String(Math.floor(stat.mtimeMs / 1000)) },
          tags: ['mo2'],
          mo2: { instance: inst.root, name: d.name, newestVersion: meta.newestVersion || undefined },
        },
        `Mod Organizer 2 (${inst.gameName})`,
        inst.modsDir,
      );
      added += 1;
    }
  }
  return added;
}
