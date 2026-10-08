import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModRecord } from '../shared/types';
import { isaacFolderForMod, isaacModsDir, pzDefaultModsFile, rimworldModsConfigFile } from './loadOrder';

/**
 * Enable/disable mods in the game's OWN mod list. Rules: never while the game runs (it rewrites these files on
 * exit), back up a config file before changing it, and only touch the enabled list (Isaac: only disable.it).
 */

export type EnableResult = { ok: boolean; message: string; changed: number };

export const GAME_EXE: Record<string, { exe: string; name: string }> = {
  'binding-of-isaac': { exe: 'isaac-ng.exe', name: 'The Binding of Isaac' },
  rimworld: { exe: 'RimWorldWin64.exe', name: 'RimWorld' },
  'project-zomboid': { exe: 'ProjectZomboid64.exe', name: 'Project Zomboid' },
};

/** Running-process names for games Mod Hub can launch but doesn't write mod lists for. */
export const PLAY_EXE: Record<string, string[]> = {
  'binding-of-isaac': ['isaac-ng.exe'],
  rimworld: ['RimWorldWin64.exe'],
  'project-zomboid': ['ProjectZomboid64.exe'],
  skyrimse: ['SkyrimSE.exe'],
  cyberpunk2077: ['Cyberpunk2077.exe'],
  baldursgate3: ['bg3.exe', 'bg3_dx11.exe'],
  fallout4: ['Fallout4.exe'],
  terraria: ['Terraria.exe'],
};

export function isRunning(exe: string): boolean {
  try {
    const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${exe}`, '/NH'], { encoding: 'utf8', windowsHide: true });
    return out.toLowerCase().includes(exe.toLowerCase());
  } catch {
    return false;
  }
}

export function backupRoot(): string {
  return path.join(process.env.APPDATA ?? os.homedir(), 'mod-hub', 'backups');
}

/** Copy `file` to backups/<gameId>/<name>-<timestamp><ext> and keep the newest 30. */
export function backup(gameId: string, file: string): string {
  const dir = path.join(backupRoot(), gameId);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(file);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(dir, `${path.basename(file, ext)}-${stamp}${ext}`);
  fs.copyFileSync(file, dest);
  const old = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(path.basename(file, ext)))
    .sort()
    .reverse()
    .slice(30);
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  return dest;
}

function isaacSet(mods: ModRecord[], enabled: boolean): EnableResult {
  const modsDir = isaacModsDir();
  if (!modsDir) return { ok: false, message: "Isaac's mods folder wasn't found.", changed: 0 };
  let changed = 0;
  const missing: string[] = [];
  for (const m of mods) {
    const folder = isaacFolderForMod(m, modsDir);
    if (!folder) {
      missing.push(m.title);
      continue;
    }
    const flag = path.join(modsDir, folder, 'disable.it');
    const has = fs.existsSync(flag);
    if (enabled && has) {
      fs.rmSync(flag, { force: true });
      changed += 1;
    } else if (!enabled && !has) {
      fs.writeFileSync(flag, '');
      changed += 1;
    }
  }
  const note = missing.length ? ` ${missing.length} not in Isaac's mods folder yet (start the game once): ${missing.slice(0, 3).join(', ')}` : '';
  return { ok: true, message: `${enabled ? 'Enabled' : 'Disabled'} ${changed} Isaac mod(s).${note}`, changed };
}

/** Ordered id list in → file text out, for one game's list format. */
type ListFile = {
  file: string;
  read: (text: string) => string[];
  write: (text: string, ids: string[]) => string;
  idsFor: (m: ModRecord) => { enable: string[]; all: string[] };
  same: (a: string, b: string) => boolean;
};

const rimworldList = (): ListFile | null => {
  const file = rimworldModsConfigFile();
  if (!fs.existsSync(file)) return null;
  return {
    file,
    read: (text) => [...(/<activeMods>([\s\S]*?)<\/activeMods>/i.exec(text)?.[1] ?? '').matchAll(/<li>\s*([^<]+?)\s*<\/li>/gi)].map((m) => m[1]),
    write: (text, ids) =>
      text.replace(/<activeMods>[\s\S]*?<\/activeMods>/i, `<activeMods>\n${ids.map((id) => `    <li>${id}</li>`).join('\n')}\n  </activeMods>`),
    // RimWorld stores package ids lower-case.
    idsFor: (m) => {
      const ids = (m.modIds ?? []).map((id) => id.toLowerCase());
      return { enable: ids.slice(0, 1), all: ids };
    },
    same: (a, b) => a.toLowerCase().replace(/_steam$/, '') === b.toLowerCase().replace(/_steam$/, ''),
  };
};

const pzList = (): ListFile | null => {
  const file = pzDefaultModsFile();
  if (!fs.existsSync(file)) return null;
  return {
    file,
    read: (text) => [...text.matchAll(/^\s*mod\s*=\s*([^,\r\n]+?)\s*,?\s*$/gim)].map((m) => m[1]),
    write: (text, ids) => {
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const body = ids.map((id) => `\tmod = ${id},`).join(eol);
      return /mods\s*\{[\s\S]*?\}/.test(text)
        ? text.replace(/mods\s*\{[\s\S]*?\}/, `mods${eol}{${eol}${body}${eol}}`)
        : `VERSION = 1,${eol}${eol}mods${eol}{${eol}${body}${eol}}${eol}`;
    },
    // A Workshop item can hold several mods (map packs, variants). Enabling turns on the first (main) one;
    // disabling turns off all of them.
    idsFor: (m) => ({ enable: (m.modIds ?? []).slice(0, 1), all: m.modIds ?? [] }),
    same: (a, b) => a.toLowerCase() === b.toLowerCase(),
  };
};

function listSet(gameId: string, list: ListFile | null, mods: ModRecord[], enabled: boolean): EnableResult {
  if (!list) return { ok: false, message: 'Mod list file not found.', changed: 0 };
  const text = fs.readFileSync(list.file, 'utf8');
  let ids = list.read(text);
  const before = ids.join('\n');
  let changed = 0;
  const noId: string[] = [];
  for (const m of mods) {
    const { enable, all } = list.idsFor(m);
    if (!all.length) {
      noId.push(m.title);
      continue;
    }
    const isOn = ids.some((id) => all.some((x) => list.same(id, x)));
    if (enabled && !isOn) {
      ids = [...ids, ...enable];
      changed += 1;
    } else if (!enabled && isOn) {
      ids = ids.filter((id) => !all.some((x) => list.same(id, x)));
      changed += 1;
    }
  }
  if (ids.join('\n') !== before) {
    const saved = backup(gameId, list.file);
    fs.writeFileSync(list.file, list.write(text, ids), 'utf8');
    console.log(`[Mod Hub] ${gameId}: ${enabled ? 'enabled' : 'disabled'} ${changed} mod(s); backup ${saved}`);
  }
  const note = noId.length ? ` ${noId.length} skipped (no mod id): ${noId.slice(0, 3).join(', ')}` : '';
  const where = enabled && changed ? ' New ones were added at the end of the load order.' : '';
  return { ok: true, message: `${enabled ? 'Enabled' : 'Disabled'} ${changed} mod(s).${where}${note}`, changed };
}

/** Isaac: toggle one folder in the game's mods folder by name (used for leftover copies of renamed mods). */
export function setIsaacFolderEnabled(folder: string, enabled: boolean): EnableResult {
  if (isRunning(GAME_EXE['binding-of-isaac'].exe)) return { ok: false, message: 'Isaac is running. Close it first.', changed: 0 };
  const modsDir = isaacModsDir();
  if (!modsDir || folder.includes('..') || /[\\/]/.test(folder) || !fs.existsSync(path.join(modsDir, folder))) {
    return { ok: false, message: 'Mod folder not found.', changed: 0 };
  }
  const flag = path.join(modsDir, folder, 'disable.it');
  if (enabled && fs.existsSync(flag)) fs.rmSync(flag, { force: true });
  else if (!enabled && !fs.existsSync(flag)) fs.writeFileSync(flag, '');
  return { ok: true, message: `${enabled ? 'Enabled' : 'Disabled'} ${folder}.`, changed: 1 };
}

export function setModsEnabled(gameId: string, mods: ModRecord[], enabled: boolean): EnableResult {
  const game = GAME_EXE[gameId];
  if (!game) return { ok: false, message: 'Enable/disable is not supported for this game yet.', changed: 0 };
  if (isRunning(game.exe)) {
    return { ok: false, message: `${game.name} is running. Close it first; it rewrites its mod list when it exits.`, changed: 0 };
  }
  try {
    if (gameId === 'binding-of-isaac') return isaacSet(mods, enabled);
    if (gameId === 'rimworld') return listSet(gameId, rimworldList(), mods, enabled);
    return listSet(gameId, pzList(), mods, enabled);
  } catch (e) {
    return { ok: false, message: `Couldn't change the mod list: ${e instanceof Error ? e.message : String(e)}`, changed: 0 };
  }
}

/** Replace the whole enabled list with `ids` in this order (RimWorld / PZ). Game must be closed; backed up first. */
export function setLoadOrder(gameId: string, ids: string[]): EnableResult {
  const game = GAME_EXE[gameId];
  if (!game || gameId === 'binding-of-isaac') return { ok: false, message: 'This game has no editable load order.', changed: 0 };
  if (isRunning(game.exe)) {
    return { ok: false, message: `${game.name} is running. Close it first; it rewrites its mod list when it exits.`, changed: 0 };
  }
  const list = gameId === 'rimworld' ? rimworldList() : pzList();
  if (!list) return { ok: false, message: 'Mod list file not found.', changed: 0 };
  try {
    const text = fs.readFileSync(list.file, 'utf8');
    const before = list.read(text);
    const same = new Set(before.map((x) => x.toLowerCase()));
    if (ids.length !== before.length || ids.some((x) => !same.has(x.toLowerCase()))) {
      return { ok: false, message: 'The enabled mods changed since this order was made. Reload and try again.', changed: 0 };
    }
    const moved = ids.filter((id, i) => id.toLowerCase() !== before[i]?.toLowerCase()).length;
    if (moved === 0) return { ok: true, message: 'Order unchanged.', changed: 0 };
    const saved = backup(gameId, list.file);
    fs.writeFileSync(list.file, list.write(text, ids), 'utf8');
    console.log(`[Mod Hub] ${gameId}: saved new load order (${moved} positions changed); backup ${saved}`);
    return { ok: true, message: `Saved the new load order (${moved} position${moved === 1 ? '' : 's'} changed).`, changed: moved };
  } catch (e) {
    return { ok: false, message: `Couldn't save the order: ${e instanceof Error ? e.message : String(e)}`, changed: 0 };
  }
}
