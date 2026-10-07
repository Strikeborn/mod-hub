import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GameLoadOrder, ModLoadState, ModRecord } from '../shared/types';
import { steamGameDir } from './workshopActions';

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

const ADAPTERS: Adapter[] = [rimworld, projectZomboid, isaac];

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
