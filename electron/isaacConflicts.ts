import fs from 'node:fs';
import path from 'node:path';
import type { IsaacConflictPair, IsaacConflicts, ModRecord } from '../shared/types';
import { isaacFolderForMod, isaacModsDir } from './loadOrder';

/**
 * Which enabled Isaac mods replace the same game files. Isaac loads `resources/` and `resources-dlc3/`
 * from every enabled mod; when two mods ship the same file, the one earlier in folder-name order wins
 * (that's why texture packs prefix "!"). Lua and content/*.xml are merged, not replaced, so they're ignored.
 */

const LOADED_DIRS = ['resources', 'resources-dlc3'];
const IGNORE = /(^|\/)(thumbs\.db|desktop\.ini|\.ds_store)$/i;

let cache: { key: string; result: IsaacConflicts } | null = null;

function sortFolders(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

function listFiles(root: string, prefix: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const rel = `${prefix}/${e.name.toLowerCase()}`;
    if (e.isDirectory()) listFiles(path.join(root, e.name), rel, out);
    else if (!IGNORE.test(rel)) out.push(rel);
  }
}

export function analyzeIsaacConflicts(mods: ModRecord[]): IsaacConflicts {
  const modsDir = isaacModsDir();
  if (!modsDir) return { pairs: [], perMod: {}, filesChecked: 0, modsChecked: 0, renamedCopies: [] };
  const folders = fs
    .readdirSync(modsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !fs.existsSync(path.join(modsDir, d.name, 'disable.it')))
    .map((d) => d.name)
    .sort(sortFolders);

  // Renamed mods: same Workshop id suffix on 2+ folders (enabled or not).
  const allFolders = fs.readdirSync(modsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const byId = new Map<string, string[]>();
  for (const f of allFolders) {
    const id = /_(\d{6,})$/.exec(f)?.[1];
    if (id) byId.set(id, [...(byId.get(id) ?? []), f]);
  }
  const renamedCopies: IsaacConflicts['renamedCopies'] = [...byId.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([workshopId, list]) => ({
      workshopId,
      folders: list
        .map((folder) => {
          const st = fs.statSync(path.join(modsDir, folder));
          return { folder, enabled: !fs.existsSync(path.join(modsDir, folder, 'disable.it')), changedAt: st.mtime.toISOString() };
        })
        .sort((a, b) => b.changedAt.localeCompare(a.changedAt)),
    }));

  // Re-use the last result while no enabled folder (or its resources) changed.
  const key = folders
    .map((f) => {
      const stamp = LOADED_DIRS.map((d) => {
        try {
          return fs.statSync(path.join(modsDir, f, d)).mtimeMs;
        } catch {
          return 0;
        }
      });
      return `${f}:${stamp.join(',')}`;
    })
    .join('|');
  if (cache?.key === key) return { ...cache.result, renamedCopies };

  const owners = new Map<string, number[]>(); // file -> indexes of folders that ship it, in load order
  let filesChecked = 0;
  folders.forEach((f, idx) => {
    const files: string[] = [];
    for (const d of LOADED_DIRS) listFiles(path.join(modsDir, f, d), d, files);
    filesChecked += files.length;
    for (const file of files) {
      const list = owners.get(file);
      if (list) list.push(idx);
      else owners.set(file, [idx]);
    }
  });

  // Catalog row for each folder, so the UI can show titles and link cards.
  const modByFolder = new Map<string, ModRecord>();
  for (const m of mods) {
    if (m.gameId !== 'binding-of-isaac') continue;
    const f = isaacFolderForMod(m, modsDir, folders);
    if (f && !modByFolder.has(f)) modByFolder.set(f, m);
  }

  const pairMap = new Map<string, { winner: number; loser: number; files: string[] }>();
  for (const [file, idxs] of owners) {
    if (idxs.length < 2) continue;
    const winner = idxs[0];
    for (const loser of idxs.slice(1)) {
      const k = `${winner}>${loser}`;
      const p = pairMap.get(k);
      if (p) p.files.push(file);
      else pairMap.set(k, { winner, loser, files: [file] });
    }
  }

  const describe = (idx: number) => {
    const folder = folders[idx];
    const m = modByFolder.get(folder);
    return { folder, modId: m?.id, title: m?.title ?? folder.replace(/_\d+$/, '') };
  };

  const pairs: IsaacConflictPair[] = [...pairMap.values()]
    .map((p) => ({
      winner: describe(p.winner),
      loser: describe(p.loser),
      fileCount: p.files.length,
      sampleFiles: p.files.slice(0, 12),
    }))
    .sort((a, b) => b.fileCount - a.fileCount);

  const perMod: IsaacConflicts['perMod'] = {};
  const bump = (modId: string | undefined, field: 'wins' | 'losses', files: number, other: string) => {
    if (!modId) return;
    const e = (perMod[modId] ??= { wins: 0, losses: 0, winsOver: [], lostTo: [] });
    e[field] += files;
    (field === 'wins' ? e.winsOver : e.lostTo).push(other);
  };
  for (const p of pairs) {
    bump(p.winner.modId, 'wins', p.fileCount, p.loser.title);
    bump(p.loser.modId, 'losses', p.fileCount, p.winner.title);
  }

  const result: IsaacConflicts = { pairs, perMod, filesChecked, modsChecked: folders.length, renamedCopies };
  cache = { key, result };
  return result;
}
