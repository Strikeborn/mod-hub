import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GameLoadOrder, ModLoadState, ModRecord } from '../shared/types';
import { steamGameDir } from './workshopActions';
import { findMo2Instances, readMo2Modlist, readMo2Plugins } from './mo2';
import { readPakInfo } from './bg3Pak';

/**
 * Read-only load-order adapters. Each reads the game's OWN config (what the game will actually load),
 * matches entries to catalog rows, and never writes anything. Writing (enable/disable/reorder) is step 2.
 */

type Adapter = (mods: ModRecord[]) => GameLoadOrder | null;

export function rimworldModsConfigFile(): string {
  return path.join(os.homedir(), 'AppData', 'LocalLow', 'Ludeon Studios', 'RimWorld by Ludeon Studios', 'Config', 'ModsConfig.xml');
}

export function pzDefaultModsFile(): string {
  return path.join(os.homedir(), 'Zomboid', 'mods', 'default.txt');
}

export function isaacModsDir(): string | undefined {
  const game = steamGameDir('The Binding of Isaac Rebirth');
  const dir = game ? path.join(game, 'mods') : undefined;
  return dir && fs.existsSync(dir) ? dir : undefined;
}

/**
 * The game-folder copy a catalog row stands for: its own folder (local/kept rows), else <name>_<workshopId>.
 * If a renamed mod left two folders with the same id, the most recently changed one is the live copy.
 */
export function isaacFolderForMod(m: ModRecord, modsDir: string, folders?: string[]): string | undefined {
  const all = folders ?? fs.readdirSync(modsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  if (m.localPath && path.dirname(m.localPath).toLowerCase() === modsDir.toLowerCase()) {
    const own = path.basename(m.localPath);
    return all.includes(own) ? own : undefined;
  }
  if (!m.workshopId) return undefined;
  const hits = all.filter((f) => f.endsWith(`_${m.workshopId}`));
  if (hits.length <= 1) return hits[0];
  const mtime = (f: string) => {
    try {
      return fs.statSync(path.join(modsDir, f)).mtimeMs;
    } catch {
      return 0;
    }
  };
  return hits.sort((a, b) => mtime(b) - mtime(a))[0];
}

function base(gameId: string, sourceLabel: string, sourcePath: string, orderKind: GameLoadOrder['orderKind']): GameLoadOrder {
  return { gameId, sourceLabel, sourcePath, orderKind, mods: {}, enabledCount: 0, unmatched: [], readAt: new Date().toISOString() };
}

/** Ordered id list -> per-mod state, matching each catalog row by any of its ids. */
function applyIdList(
  out: GameLoadOrder,
  rows: ModRecord[],
  ordered: string[],
  normalize: (id: string) => string,
  unmatchedNote?: (id: string) => string | undefined,
): void {
  const position = new Map<string, number>();
  ordered.forEach((id, i) => {
    const key = normalize(id);
    if (!position.has(key)) position.set(key, i + 1);
  });
  const matched = new Set<string>();
  for (const m of rows) {
    const ids = (m.modIds ?? []).map(normalize);
    if (ids.length === 0) continue;
    const hits = ids.map((id) => position.get(id)).filter((p): p is number => p != null);
    const state: ModLoadState = hits.length ? { enabled: true, position: Math.min(...hits) } : { enabled: false };
    out.mods[m.id] = state;
    for (const id of ids) if (position.has(id)) matched.add(id);
  }
  out.enabledCount = Object.values(out.mods).filter((s) => s.enabled).length;
  for (const [id, pos] of position) {
    if (!matched.has(id)) out.unmatched.push({ id, position: pos, note: unmatchedNote?.(id) });
  }
}

// RimWorld: %USERPROFILE%\AppData\LocalLow\Ludeon Studios\RimWorld by Ludeon Studios\Config\ModsConfig.xml
const rimworld: Adapter = (mods) => {
  const file = rimworldModsConfigFile();
  if (!fs.existsSync(file)) return null;
  const out = base('rimworld', 'ModsConfig.xml', file, 'list');
  const xml = fs.readFileSync(file, 'utf8');
  const active = /<activeMods>([\s\S]*?)<\/activeMods>/i.exec(xml)?.[1] ?? '';
  const ids = [...active.matchAll(/<li>\s*([^<]+?)\s*<\/li>/gi)].map((m) => m[1]);
  // RimWorld appends "_steam" to a Workshop copy's id when a local copy has the same packageId.
  const norm = (id: string) => id.toLowerCase().replace(/_steam$/, '');
  applyIdList(out, mods.filter((m) => m.gameId === 'rimworld'), ids, norm, (id) =>
    id.startsWith('ludeon.rimworld') ? (id === 'ludeon.rimworld' ? 'Core game' : 'DLC') : 'Not installed (or not scanned)',
  );
  return out;
};

// Project Zomboid (B41 main menu list): %USERPROFILE%\Zomboid\mods\default.txt  ("mod = Id," lines, in order).
const projectZomboid: Adapter = (mods) => {
  const file = pzDefaultModsFile();
  if (!fs.existsSync(file)) return null;
  const out = base('project-zomboid', 'Zomboid\\mods\\default.txt (main menu)', file, 'list');
  const ids = [...fs.readFileSync(file, 'utf8').matchAll(/^\s*mod\s*=\s*([^,\r\n]+?)\s*,?\s*$/gim)].map((m) => m[1]);
  applyIdList(out, mods.filter((m) => m.gameId === 'project-zomboid'), ids, (id) => id.toLowerCase(), () => 'Not installed (or not scanned)');
  return out;
};

// The Binding of Isaac: game\mods\<name>_<workshopId> (or a local folder); disabled = a disable.it file inside.
// The game loads mods in folder-name order, so position follows the folder names.
const isaac: Adapter = (mods) => {
  const modsDir = isaacModsDir();
  if (!modsDir) return null;
  const out = base('binding-of-isaac', 'Isaac mods folder (disable.it)', modsDir, 'folder-name');
  const folders = fs
    .readdirSync(modsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
  const enabledFolders = folders.filter((f) => !fs.existsSync(path.join(modsDir, f, 'disable.it')));
  const positionOf = new Map(enabledFolders.map((f, i) => [f, i + 1]));
  const matched = new Set<string>();
  for (const m of mods) {
    if (m.gameId !== 'binding-of-isaac') continue;
    const folder = isaacFolderForMod(m, modsDir, folders);
    if (!folder) continue; // Workshop item not copied into the game's mods folder yet
    matched.add(folder);
    const pos = positionOf.get(folder);
    out.mods[m.id] = pos ? { enabled: true, position: pos } : { enabled: false };
  }
  out.enabledCount = enabledFolders.length;
  for (const f of enabledFolders) if (!matched.has(f)) out.unmatched.push({ id: f, position: positionOf.get(f)!, note: 'Folder not in catalog' });
  return out;
};

// Baldur's Gate 3: PlayerProfiles/Public/modsettings.lsx lists the active mods in order (Patch 7+: the "Mods"
// node; GustavDev/Gustav/GustavX are the base game). Vortex writes this file, so it's shown read-only.
// Entries name the mod's internal folder, so match them to the .pak files in the Mods folder (Vortex links
// into its staging folder, which is the catalog row's localPath).
const BG3_BASE = /^gustav(dev|x)?$/i;
const bg3Norm = (s: string) => s.toLowerCase().replace(/_[0-9a-f]{8}-[0-9a-f-]{27}$/i, '').replace(/[^a-z0-9]/g, '');

const baldursGate3: Adapter = (mods) => {
  const root = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Larian Studios', "Baldur's Gate 3");
  const file = path.join(root, 'PlayerProfiles', 'Public', 'modsettings.lsx');
  if (!fs.existsSync(file)) return null;
  const out = base('baldursgate3', 'modsettings.lsx (managed by Vortex, read-only)', file, 'list');
  out.readOnly = true;
  const xml = fs.readFileSync(file, 'utf8');
  const modsBlock = /<node id="Mods">([\s\S]*?)<\/children>\s*<\/node>/i.exec(xml)?.[1] ?? xml;
  const entries = [...modsBlock.matchAll(/<node id="ModuleShortDesc">([\s\S]*?)<\/node>/gi)]
    .map((m) => ({
      folder: /id="Folder"[^>]*value="([^"]*)"/i.exec(m[1])?.[1] ?? '',
      name: /id="Name"[^>]*value="([^"]*)"/i.exec(m[1])?.[1] ?? '',
      uuid: (/id="UUID"[^>]*value="([^"]*)"/i.exec(m[1])?.[1] ?? '').toLowerCase(),
    }))
    .filter((e) => e.folder && !BG3_BASE.test(e.folder));

  // .pak in the Mods folder -> the Vortex staging folder it links to.
  const paks: { key: string; target?: string; uuids: string[] }[] = [];
  const modsDir = path.join(root, 'Mods');
  try {
    for (const f of fs.readdirSync(modsDir)) {
      if (!/\.pak$/i.test(f)) continue;
      let target: string | undefined;
      try {
        target = path.dirname(fs.realpathSync(path.join(modsDir, f))).toLowerCase();
      } catch {
        /* broken link */
      }
      // The pak's own meta.lsx names its module UUID: exact match with modsettings.lsx entries.
      const uuids = readPakInfo(path.join(modsDir, f)).modules.map((m) => m.uuid.toLowerCase());
      paks.push({ key: bg3Norm(f.replace(/\.pak$/i, '')), target, uuids });
    }
  } catch {
    /* no Mods folder */
  }
  const rowByFolder = new Map<string, ModRecord>();
  for (const m of mods) {
    if (m.gameId !== 'baldursgate3') continue;
    for (const p of [m.localPath, ...(m.alternateLocalPaths ?? [])]) if (p) rowByFolder.set(path.normalize(p).toLowerCase(), m);
  }
  const findPak = (e: { folder: string; name: string; uuid: string }) => {
    const exact = e.uuid ? paks.find((p) => p.uuids.includes(e.uuid)) : undefined;
    if (exact) return exact;
    const keys = [bg3Norm(e.folder), bg3Norm(e.name)].filter((k) => k.length >= 4);
    return (
      paks.find((p) => keys.includes(p.key)) ??
      paks.find((p) => keys.some((k) => p.key.includes(k) || k.includes(p.key)) && p.key.length >= 4)
    );
  };
  entries.forEach((e, i) => {
    const pak = findPak(e);
    const row = pak?.target ? rowByFolder.get(path.normalize(pak.target).toLowerCase()) : undefined;
    if (row && !out.mods[row.id]) out.mods[row.id] = { enabled: true, position: i + 1, readOnly: true };
    else if (!row) out.unmatched.push({ id: e.name || e.folder, position: i + 1, note: pak ? 'pak not linked to a Vortex mod' : 'no matching .pak' });
  });
  // Installed BG3 mods that aren't in the active list are off.
  for (const m of mods) {
    if (m.gameId === 'baldursgate3' && !out.mods[m.id] && paks.some((p) => p.target && rowByFolder.get(p.target) === m)) {
      out.mods[m.id] = { enabled: false, readOnly: true };
    }
  }
  out.enabledCount = entries.length;
  return out;
};

// Mod Organizer 2 (e.g. Skyrim SE): the instance's selected profile. modlist.txt's first line is the highest
// priority; shown as load order 1 = lowest so later entries override earlier ones, like the other games.
const mo2Profiles: Adapter = (mods) => {
  const inst = findMo2Instances().find((i) => i.gameId && mods.some((m) => m.mo2?.instance === i.root));
  if (!inst?.gameId) return null;
  const profile = inst.selectedProfile ?? inst.profiles[0];
  if (!profile) return null;
  const file = path.join(inst.root, 'profiles', profile, 'modlist.txt');
  const out = base(inst.gameId, `MO2 profile “${profile}” (managed by MO2, read-only)`, file, 'list');
  out.readOnly = true;
  const list = readMo2Modlist(inst, profile).filter((e) => !e.unmanaged).reverse();
  const enabled = list.filter((e) => e.enabled);
  const pos = new Map(enabled.map((e, i) => [e.name.toLowerCase(), i + 1]));
  for (const m of mods) {
    if (m.mo2?.instance !== inst.root) continue;
    const p = pos.get(m.mo2.name.toLowerCase());
    out.mods[m.id] = p ? { enabled: true, position: p, readOnly: true } : { enabled: false, readOnly: true };
  }
  out.enabledCount = enabled.length;
  const plugins = readMo2Plugins(inst, profile);
  if (plugins.length) out.unmatched.push({ id: `${plugins.filter((p) => p.active).length}/${plugins.length} plugins active`, position: 0, note: 'plugins.txt' });
  return out;
};

const ADAPTERS: Adapter[] = [rimworld, projectZomboid, isaac, baldursGate3, mo2Profiles];

export function readLoadOrders(mods: ModRecord[]): Record<string, GameLoadOrder> {
  const out: Record<string, GameLoadOrder> = {};
  for (const adapter of ADAPTERS) {
    try {
      const r = adapter(mods);
      if (r) out[r.gameId] = r;
    } catch (e) {
      console.warn('[Mod Hub] load order read failed:', e);
    }
  }
  return out;
}
