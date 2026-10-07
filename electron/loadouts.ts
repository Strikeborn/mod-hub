import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Loadout, LoadoutsForGame, ModRecord } from '../shared/types';
import { isaacModsDir, pzDefaultModsFile, rimworldModsConfigFile } from './loadOrder';
import { GAME_EXE, backup, backupRoot, isRunning } from './loadOrderWrite';

/**
 * Loadouts = named mod lists per game, kept where the game itself keeps them when it has its own format
 * (RimWorld ModLists/*.rml, PZ Lua/saved_modlists.txt), plus PZ per-save lists, plus Mod Hub's own lists for
 * games without one (Isaac). Applying a loadout replaces the game's enabled list (backed up; game must be closed).
 */

type Result = { ok: boolean; message: string };

const ISAAC_PROTECTED = /^repentogon_3127536138$/i;
const RIMWORLD_CORE_NAMES: Record<string, string> = {
  'ludeon.rimworld': 'Core',
  'ludeon.rimworld.royalty': 'Royalty',
  'ludeon.rimworld.ideology': 'Ideology',
  'ludeon.rimworld.biotech': 'Biotech',
  'ludeon.rimworld.anomaly': 'Anomaly',
  'ludeon.rimworld.odyssey': 'Odyssey',
};

const rwNorm = (id: string) => id.toLowerCase().replace(/_steam$/, '');
const ciNorm = (id: string) => id.toLowerCase();

function liList(block: string | undefined): string[] {
  return [...(block ?? '').matchAll(/<li>\s*([^<]+?)\s*<\/li>/gi)].map((m) => m[1]);
}

function mtimeIso(file: string): string | undefined {
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return undefined;
  }
}

function safeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 80) || 'Loadout';
}

// ---------- current state per game ----------

function rimworldCurrent(): string[] {
  const f = rimworldModsConfigFile();
  return fs.existsSync(f) ? liList(/<activeMods>([\s\S]*?)<\/activeMods>/i.exec(fs.readFileSync(f, 'utf8'))?.[1]) : [];
}

function pzReadModsBlock(text: string): string[] {
  return [...text.matchAll(/^\s*mod\s*=\s*([^,\r\n]+?)\s*,?\s*$/gim)].map((m) => m[1]);
}

function pzCurrent(): string[] {
  const f = pzDefaultModsFile();
  return fs.existsSync(f) ? pzReadModsBlock(fs.readFileSync(f, 'utf8')) : [];
}

function isaacFolders(): string[] {
  const dir = isaacModsDir();
  if (!dir) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
}

function isaacCurrent(): string[] {
  const dir = isaacModsDir();
  return dir ? isaacFolders().filter((f) => !fs.existsSync(path.join(dir, f, 'disable.it'))) : [];
}

// ---------- where lists live ----------

function rimworldModListsDir(): string {
  return path.join(path.dirname(path.dirname(rimworldModsConfigFile())), 'ModLists');
}

function pzSavedListsFile(): string {
  return path.join(os.homedir(), 'Zomboid', 'Lua', 'saved_modlists.txt');
}

function pzSavesDir(): string {
  return path.join(os.homedir(), 'Zomboid', 'Saves');
}

function modHubListsDir(gameId: string): string {
  return path.join(process.env.APPDATA ?? os.homedir(), 'mod-hub', 'loadouts', gameId);
}

type RawLoadout = Omit<Loadout, 'count' | 'missing' | 'toEnable' | 'toDisable' | 'isCurrent'>;

function readRimworldLists(): RawLoadout[] {
  const dir = rimworldModListsDir();
  if (!fs.existsSync(dir)) return [];
  const out: RawLoadout[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(rml|xml)$/i.test(f)) continue;
    const file = path.join(dir, f);
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    // RimWorld's own .rml: <modList><ids>; older mod-manager .xml: <ModList><Name>…<modIds>.
    const ids = liList(/<ids>([\s\S]*?)<\/ids>/i.exec(text)?.[1]);
    const fallback = ids.length ? ids : liList(/<modIds>([\s\S]*?)<\/modIds>/i.exec(text)?.[1]);
    if (!fallback.length) continue;
    out.push({
      id: `rimworld-list:${f}`,
      gameId: 'rimworld',
      name: /<Name>\s*([^<]+?)\s*<\/Name>/.exec(text)?.[1] ?? f.replace(/\.(rml|xml)$/i, ''),
      kind: 'game-list',
      kindLabel: /\.rml$/i.test(f) ? 'RimWorld mod list' : 'Mod list (older .xml)',
      path: file,
      ids: fallback,
      modifiedAt: mtimeIso(file),
      gameVersion: /<gameVersion>\s*([^<]+?)\s*<\/gameVersion>/i.exec(text)?.[1],
      canDelete: true,
    });
  }
  return out;
}

function readPzLists(): RawLoadout[] {
  const out: RawLoadout[] = [];
  const file = pzSavedListsFile();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^([^:=]+):(.*)$/.exec(line);
      if (!m || /^VERSION$/i.test(m[1].trim())) continue;
      const ids = m[2].split(';').map((s) => s.trim()).filter(Boolean);
      out.push({
        id: `pz-list:${m[1]}`,
        gameId: 'project-zomboid',
        name: m[1],
        kind: 'game-list',
        kindLabel: 'PZ saved mod list',
        path: file,
        ids,
        modifiedAt: mtimeIso(file),
        canDelete: true,
      });
    }
  }
  const saves = pzSavesDir();
  if (fs.existsSync(saves)) {
    for (const mode of fs.readdirSync(saves, { withFileTypes: true })) {
      if (!mode.isDirectory() || mode.name === 'Multiplayer') continue;
      for (const save of fs.readdirSync(path.join(saves, mode.name), { withFileTypes: true })) {
        const f = path.join(saves, mode.name, save.name, 'mods.txt');
        if (!save.isDirectory() || !fs.existsSync(f)) continue;
        out.push({
          id: `pz-save:${mode.name}/${save.name}`,
          gameId: 'project-zomboid',
          name: `${mode.name} — ${save.name}`,
          kind: 'save',
          kindLabel: 'PZ save',
          path: f,
          ids: pzReadModsBlock(fs.readFileSync(f, 'utf8')),
          modifiedAt: mtimeIso(f),
          canDelete: false,
        });
      }
    }
  }
  return out;
}

function readModHubLists(gameId: string): RawLoadout[] {
  const dir = modHubListsDir(gameId);
  if (!fs.existsSync(dir)) return [];
  const out: RawLoadout[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { name: string; ids: string[]; savedAt?: string };
      out.push({
        id: `modhub:${f}`,
        gameId,
        name: j.name,
        kind: 'modhub',
        kindLabel: 'Mod Hub list',
        path: path.join(dir, f),
        ids: j.ids,
        modifiedAt: j.savedAt ?? mtimeIso(path.join(dir, f)),
        canDelete: true,
      });
    } catch {
      /* skip unreadable list */
    }
  }
  return out;
}

// ---------- public API ----------

const GAMES: Record<
  string,
  { current: () => string[]; installed: (mods: ModRecord[]) => Set<string>; norm: (id: string) => string; lists: () => RawLoadout[] }
> = {
  rimworld: {
    current: rimworldCurrent,
    installed: (mods) =>
      new Set([
        ...Object.keys(RIMWORLD_CORE_NAMES),
        ...mods.filter((m) => m.gameId === 'rimworld').flatMap((m) => (m.modIds ?? []).map(rwNorm)),
      ]),
    norm: rwNorm,
    lists: readRimworldLists,
  },
  'project-zomboid': {
    current: pzCurrent,
    installed: (mods) => new Set(mods.filter((m) => m.gameId === 'project-zomboid').flatMap((m) => (m.modIds ?? []).map(ciNorm))),
    norm: ciNorm,
    lists: readPzLists,
  },
  'binding-of-isaac': {
    current: isaacCurrent,
    installed: () => new Set(isaacFolders().map(ciNorm)),
    norm: ciNorm,
    lists: () => readModHubLists('binding-of-isaac'),
  },
};

export function getLoadouts(gameId: string, mods: ModRecord[]): LoadoutsForGame {
  const g = GAMES[gameId];
  if (!g) return { gameId, supported: false, current: [], loadouts: [] };
  const current = g.current();
  const cur = new Set(current.map(g.norm));
  const installed = g.installed(mods);
  const lists = [...g.lists(), ...(gameId === 'binding-of-isaac' ? [] : readModHubLists(gameId))];
  const loadouts: Loadout[] = lists.map((l) => {
    const want = new Set(l.ids.map(g.norm));
    const missing = l.ids.filter((id) => !installed.has(g.norm(id)));
    const toEnable = [...want].filter((id) => !cur.has(id) && installed.has(id)).length;
    const toDisable = [...cur].filter((id) => !want.has(id) && !(gameId === 'binding-of-isaac' && ISAAC_PROTECTED.test(id))).length;
    const sameOrder =
      l.ids.length === current.length && l.ids.every((id, i) => g.norm(id) === g.norm(current[i]));
    return { ...l, count: l.ids.length, missing, toEnable, toDisable, isCurrent: toEnable === 0 && toDisable === 0 && (gameId === 'binding-of-isaac' || sameOrder) };
  });
  loadouts.sort((a, b) => (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? ''));
  return { gameId, supported: true, current, loadouts };
}

function guard(gameId: string): Result | null {
  const game = GAME_EXE[gameId];
  if (!game) return { ok: false, message: 'Loadouts are not supported for this game yet.' };
  if (isRunning(game.exe)) return { ok: false, message: `${game.name} is running. Close it first; it rewrites its mod list when it exits.` };
  return null;
}

export function applyLoadout(gameId: string, loadoutId: string, mods: ModRecord[]): Result {
  const blocked = guard(gameId);
  if (blocked) return blocked;
  const l = getLoadouts(gameId, mods).loadouts.find((x) => x.id === loadoutId);
  if (!l) return { ok: false, message: 'Loadout not found.' };
  try {
    if (gameId === 'rimworld') {
      const f = rimworldModsConfigFile();
      const text = fs.readFileSync(f, 'utf8');
      backup(gameId, f);
      fs.writeFileSync(
        f,
        text.replace(/<activeMods>[\s\S]*?<\/activeMods>/i, `<activeMods>\n${l.ids.map((id) => `    <li>${id.toLowerCase()}</li>`).join('\n')}\n  </activeMods>`),
        'utf8',
      );
    } else if (gameId === 'project-zomboid') {
      const f = pzDefaultModsFile();
      const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
      if (text) backup(gameId, f);
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const body = l.ids.map((id) => `\tmod = ${id},`).join(eol);
      fs.writeFileSync(
        f,
        /mods\s*\{[\s\S]*?\}/.test(text)
          ? text.replace(/mods\s*\{[\s\S]*?\}/, `mods${eol}{${eol}${body}${eol}}`)
          : `VERSION = 1,${eol}${eol}mods${eol}{${eol}${body}${eol}}${eol}`,
        'utf8',
      );
    } else {
      const dir = isaacModsDir();
      if (!dir) return { ok: false, message: "Isaac's mods folder wasn't found." };
      // Record the current state first so "undo" is just applying this snapshot.
      saveSnapshot(gameId, 'Before applying loadout', isaacCurrent());
      const want = new Set(l.ids.map(ciNorm));
      for (const f of isaacFolders()) {
        const on = want.has(ciNorm(f)) || ISAAC_PROTECTED.test(f);
        const flag = path.join(dir, f, 'disable.it');
        if (on && fs.existsSync(flag)) fs.rmSync(flag, { force: true });
        else if (!on && !fs.existsSync(flag)) fs.writeFileSync(flag, '');
      }
    }
    const note = l.missing.length ? ` ${l.missing.length} mod(s) in it aren't installed and were skipped by the game.` : '';
    console.log(`[Mod Hub] Applied loadout "${l.name}" to ${gameId}`);
    return { ok: true, message: `Applied “${l.name}” (+${l.toEnable} / −${l.toDisable}).${note}` };
  } catch (e) {
    return { ok: false, message: `Couldn't apply: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function saveSnapshot(gameId: string, name: string, ids: string[]): string {
  const dir = modHubListsDir(gameId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${safeFileName(name)}.json`);
  fs.writeFileSync(file, JSON.stringify({ name, ids, savedAt: new Date().toISOString() }, null, 1), 'utf8');
  return file;
}

/** Save the game's current enabled list as a named loadout, in the game's own format where it has one. */
export function saveCurrentLoadout(gameId: string, name: string, mods: ModRecord[], targetFile?: string): Result {
  const g = GAMES[gameId];
  if (!g) return { ok: false, message: 'Loadouts are not supported for this game yet.' };
  const clean = name.trim();
  if (!clean) return { ok: false, message: 'Give the loadout a name.' };
  const ids = g.current();
  try {
    if (gameId === 'rimworld') {
      const dir = rimworldModListsDir();
      fs.mkdirSync(dir, { recursive: true });
      const file = targetFile ?? path.join(dir, `${safeFileName(clean)}.rml`);
      if (fs.existsSync(file)) backup(gameId, file);
      const gameVersion = /<version>\s*([^<]+?)\s*<\/version>/i.exec(fs.readFileSync(rimworldModsConfigFile(), 'utf8'))?.[1] ?? '';
      const nameFor = (id: string) =>
        RIMWORLD_CORE_NAMES[rwNorm(id)] ??
        mods.find((m) => m.gameId === 'rimworld' && (m.modIds ?? []).some((x) => rwNorm(x) === rwNorm(id)))?.title ??
        id;
      const li = (xs: string[]) => xs.map((x) => `\t\t\t<li>${x.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</li>`).join('\n');
      // Same layout RimWorld writes, so the game's own Mod Lists menu can load it too.
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<savedModList>
\t<meta>
\t\t<gameVersion>${gameVersion}</gameVersion>
\t\t<modIds>
${li(ids)}
\t\t</modIds>
\t</meta>
\t<modList>
\t\t<ids>
${li(ids)}
\t\t</ids>
\t\t<names>
${li(ids.map(nameFor))}
\t\t</names>
\t</modList>
</savedModList>`;
      fs.writeFileSync(file, xml, 'utf8');
      return { ok: true, message: `Saved “${clean}” to RimWorld's mod lists (${ids.length} mods). It also shows in RimWorld's own Mod Lists menu.` };
    }
    if (gameId === 'project-zomboid') {
      const file = pzSavedListsFile();
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 'VERSION=2\n';
      if (fs.existsSync(file)) backup(gameId, file);
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const listName = clean.replace(/[:;\r\n]/g, ' ');
      const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith(`${listName}:`));
      lines.push(`${listName}:${ids.join(';')}`);
      fs.writeFileSync(file, lines.join(eol) + eol, 'utf8');
      return { ok: true, message: `Saved “${listName}” to PZ's saved mod lists (${ids.length} mods). It also shows in PZ's own mod manager.` };
    }
    saveSnapshot(gameId, clean, ids);
    return { ok: true, message: `Saved “${clean}” (${ids.length} enabled mods).` };
  } catch (e) {
    return { ok: false, message: `Couldn't save: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Remove a saved list. Files go to Mod Hub's backups folder, never straight to deletion. */
export function deleteLoadout(gameId: string, loadoutId: string, mods: ModRecord[]): Result {
  const l = getLoadouts(gameId, mods).loadouts.find((x) => x.id === loadoutId);
  if (!l || !l.canDelete || !l.path) return { ok: false, message: 'This loadout cannot be removed here.' };
  try {
    if (l.id.startsWith('pz-list:')) {
      backup(gameId, l.path);
      const text = fs.readFileSync(l.path, 'utf8');
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      fs.writeFileSync(l.path, text.split(/\r?\n/).filter((line) => line && !line.startsWith(`${l.name}:`)).join(eol) + eol, 'utf8');
    } else {
      const dest = path.join(backupRoot(), gameId, 'removed-loadouts');
      fs.mkdirSync(dest, { recursive: true });
      fs.renameSync(l.path, path.join(dest, `${Date.now()}-${path.basename(l.path)}`));
    }
    return { ok: true, message: `Removed “${l.name}” (a copy is in Mod Hub's backups).` };
  } catch (e) {
    return { ok: false, message: `Couldn't remove: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Overwrite an existing list with what the game has enabled right now (backed up first). */
export function updateLoadout(gameId: string, loadoutId: string, mods: ModRecord[]): Result {
  const l = getLoadouts(gameId, mods).loadouts.find((x) => x.id === loadoutId);
  if (!l) return { ok: false, message: 'Loadout not found.' };
  if (l.kind === 'save') return { ok: false, message: "A save's mod list can't be overwritten from here." };
  if (gameId === 'rimworld' && l.path && /\.rml$/i.test(l.path)) return saveCurrentLoadout(gameId, l.name, mods, l.path);
  if (gameId === 'rimworld') {
    // Older mod-manager .xml list: write it as a RimWorld .rml with the same name, then retire the .xml to backups.
    const r = saveCurrentLoadout(gameId, l.name, mods);
    if (r.ok && l.path && fs.existsSync(l.path)) {
      const dest = path.join(backupRoot(), gameId, 'removed-loadouts');
      fs.mkdirSync(dest, { recursive: true });
      fs.renameSync(l.path, path.join(dest, `${Date.now()}-${path.basename(l.path)}`));
      return { ok: true, message: `${r.message} (Converted from the older .xml list; the original is in Mod Hub's backups.)` };
    }
    return r;
  }
  if (l.kind === 'modhub' && l.path) backup(gameId, l.path);
  return saveCurrentLoadout(gameId, l.name, mods);
}
