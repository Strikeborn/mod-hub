import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Loadout, LoadoutsForGame, ModRecord } from '../shared/types';
import { isaacFolderForMod, isaacModsDir, pzDefaultModsFile, rimworldModsConfigFile } from './loadOrder';
import { GAME_EXE, backup, backupRoot, isRunning } from './loadOrderWrite';
import { findMo2Instances, readMo2Modlist } from './mo2';
import { planRimworldOrder } from './rimworldSort';
import { isPluginGame, pluginLoadOrder, setPluginModsEnabled } from './bethesdaPlugins';

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

/** MO2 profiles for a game: shown as loadouts; "apply" means "use this profile for Play" (MO2 owns the files). */
function mo2Loadouts(gameId: string, mods: ModRecord[]): LoadoutsForGame | null {
  const inst = findMo2Instances().find((i) => i.gameId === gameId);
  if (!inst) return null;
  const selected = inst.selectedProfile ?? inst.profiles[0];
  // Plugin games (Skyrim): a profile's list = the library mods it switches on (MO2 mods + plugins), by load order.
  const plugin = isPluginGame(gameId);
  const enabledOf = (p: string) => {
    if (!plugin) return readMo2Modlist(inst, p).filter((e) => e.enabled).map((e) => e.name).reverse();
    const lo = pluginLoadOrder(gameId, mods, { optionId: 'mo2', profile: p });
    return Object.entries(lo?.mods ?? {})
      .filter(([, s]) => s.enabled && !s.readOnly)
      .sort(([a, x], [b, y]) => (x.position ?? 0) - (y.position ?? 0) || titleOf(mods, a).localeCompare(titleOf(mods, b)))
      .map(([id]) => id);
  };
  const current = selected ? enabledOf(selected) : [];
  const cur = new Set(current.map((x) => x.toLowerCase()));
  const loadouts: Loadout[] = inst.profiles.map((p) => {
    const ids = enabledOf(p);
    const want = new Set(ids.map((x) => x.toLowerCase()));
    return {
      id: `mo2:${p}`,
      gameId,
      name: p,
      kind: 'game-list',
      kindLabel: p === selected ? 'MO2 profile (selected in MO2)' : 'MO2 profile',
      path: path.join(inst.root, 'profiles', p),
      ids,
      modifiedAt: mtimeIso(path.join(inst.root, 'profiles', p, 'modlist.txt')),
      count: ids.length,
      missing: [],
      toEnable: [...want].filter((x) => !cur.has(x)).length,
      toDisable: [...cur].filter((x) => !want.has(x)).length,
      isCurrent: p === selected,
      canDelete: false,
    };
  });
  const candidates = plugin
    ? Object.entries(pluginLoadOrder(gameId, mods, { optionId: 'mo2', profile: selected })?.mods ?? {})
        .filter(([, s]) => !s.readOnly)
        .map(([id]) => ({ id, title: titleOf(mods, id) }))
    : undefined;
  const alwaysOn = plugin
    ? Object.values(pluginLoadOrder(gameId, mods, { optionId: 'mo2', profile: selected })?.mods ?? {}).filter((s) => s.readOnly && s.enabled).length
    : undefined;
  return { gameId, supported: true, current, loadouts, managedBy: 'mo2', candidates, editable: plugin, alwaysOn };
}

function titleOf(mods: ModRecord[], id: string): string {
  return mods.find((m) => m.id === id)?.title ?? id;
}

/** Installed mods a list can hold, as the list stores them (package id / Isaac folder name). */
function loadoutCandidates(gameId: string, mods: ModRecord[]): { id: string; title: string }[] {
  const own = mods.filter((m) => m.gameId === gameId);
  if (gameId === 'binding-of-isaac') {
    const dir = isaacModsDir();
    if (!dir) return [];
    const folders = isaacFolders();
    return own.flatMap((m) => {
      const f = isaacFolderForMod(m, dir, folders);
      return f ? [{ id: f, title: m.title }] : [];
    });
  }
  const out = own.flatMap((m) => (m.modIds ?? []).map((id) => ({ id, title: (m.modIds?.length ?? 0) > 1 ? `${m.title} (${id})` : m.title })));
  if (gameId === 'rimworld') for (const [id, title] of Object.entries(RIMWORLD_CORE_NAMES)) out.push({ id, title });
  return out;
}

/** Copy the chosen MO2 profile (mod list, plugins, profile INIs; not saves) to a new profile. */
export function copyMo2Profile(gameId: string, name: string, fromProfile?: string): Result {
  const inst = findMo2Instances().find((i) => i.gameId === gameId);
  if (!inst) return { ok: false, message: 'Mod Organizer 2 not found for this game.' };
  if (isRunning('ModOrganizer.exe')) return { ok: false, message: 'Close Mod Organizer 2 first (it rewrites its profiles).' };
  const clean = safeFileName(name.trim());
  if (!clean) return { ok: false, message: 'Give the profile a name.' };
  const src = fromProfile && inst.profiles.includes(fromProfile) ? fromProfile : (inst.selectedProfile ?? inst.profiles[0]);
  if (!src) return { ok: false, message: 'No MO2 profile to copy.' };
  const from = path.join(inst.root, 'profiles', src);
  const to = path.join(inst.root, 'profiles', clean);
  if (fs.existsSync(to)) return { ok: false, message: `An MO2 profile called “${clean}” already exists.` };
  try {
    fs.mkdirSync(to, { recursive: true });
    for (const f of fs.readdirSync(from, { withFileTypes: true })) if (f.isFile()) fs.copyFileSync(path.join(from, f.name), path.join(to, f.name));
    return { ok: true, message: `Made MO2 profile “${clean}” (copy of “${src}”). Edit it here or in MO2.` };
  } catch (e) {
    return { ok: false, message: `Couldn't copy the profile: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Replace a list's mods with `ids` (from the Loadouts editor). MO2 profiles: switches mods/plugins on/off. */
export function editLoadout(gameId: string, loadoutId: string, ids: string[], mods: ModRecord[]): Result {
  const all = getLoadouts(gameId, mods);
  const l = all.loadouts.find((x) => x.id === loadoutId);
  if (!l) return { ok: false, message: 'Loadout not found.' };
  const unique = ids.filter((id, i) => ids.findIndex((x) => x.toLowerCase() === id.toLowerCase()) === i);
  if (all.managedBy === 'mo2') {
    if (!all.editable) return { ok: false, message: 'Edit this profile in Mod Organizer 2.' };
    const profile = loadoutId.replace(/^mo2:/, '');
    const was = new Set(l.ids);
    const now = new Set(unique);
    const on = mods.filter((m) => now.has(m.id) && !was.has(m.id));
    const off = mods.filter((m) => was.has(m.id) && !now.has(m.id));
    const choice = { optionId: 'mo2', profile };
    const msgs: string[] = [];
    if (on.length) {
      const r = setPluginModsEnabled(gameId, on, true, choice);
      if (!r.ok) return r;
      msgs.push(`+${on.length}`);
    }
    if (off.length) {
      const r = setPluginModsEnabled(gameId, off, false, choice);
      if (!r.ok) return r;
      msgs.push(`−${off.length}`);
    }
    return { ok: true, message: msgs.length ? `Updated MO2 profile “${profile}” (${msgs.join(', ')}).` : 'Nothing changed.' };
  }
  if (l.kind === 'save') return { ok: false, message: "A save's list can't be edited here. Edit a saved list, then use “Apply to save…”." };
  if (gameId === 'rimworld' && l.path && /\.rml$/i.test(l.path)) return saveCurrentLoadout(gameId, l.name, mods, l.path, unique);
  if (l.kind === 'modhub' && l.path) backup(gameId, l.path);
  const r = saveCurrentLoadout(gameId, l.name, mods, undefined, unique);
  if (r.ok && gameId === 'rimworld' && l.path && fs.existsSync(l.path)) {
    // Older .xml list: now saved as a RimWorld .rml with the same name; retire the .xml to backups.
    const dest = path.join(backupRoot(), gameId, 'removed-loadouts');
    fs.mkdirSync(dest, { recursive: true });
    fs.renameSync(l.path, path.join(dest, `${Date.now()}-${path.basename(l.path)}`));
  }
  return r;
}

export function getLoadouts(gameId: string, mods: ModRecord[]): LoadoutsForGame {
  const viaMo2 = mo2Loadouts(gameId, mods);
  if (viaMo2) return viaMo2;
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
  return { gameId, supported: true, current, loadouts, candidates: loadoutCandidates(gameId, mods) };
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
    let sortedNote = '';
    if (gameId === 'rimworld') {
      const f = rimworldModsConfigFile();
      const text = fs.readFileSync(f, 'utf8');
      backup(gameId, f);
      // Lists saved elsewhere (or edited by hand) may break load rules: write them in the closest valid order.
      const plan = planRimworldOrder(l.ids, mods);
      if (plan.moved) sortedNote = ` Auto-sorted ${plan.moved} position(s) to satisfy load rules.`;
      fs.writeFileSync(
        f,
        text.replace(/<activeMods>[\s\S]*?<\/activeMods>/i, `<activeMods>\n${plan.proposed.map((id) => `    <li>${id.toLowerCase()}</li>`).join('\n')}\n  </activeMods>`),
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
    return { ok: true, message: `Applied “${l.name}” (+${l.toEnable} / −${l.toDisable}).${note}${sortedNote}` };
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
export function saveCurrentLoadout(gameId: string, name: string, mods: ModRecord[], targetFile?: string, idsOverride?: string[]): Result {
  const g = GAMES[gameId];
  if (!g) return { ok: false, message: 'Loadouts are not supported for this game yet.' };
  const clean = name.trim();
  if (!clean) return { ok: false, message: 'Give the loadout a name.' };
  const ids = idsOverride ?? g.current();
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

// ---------- PZ: write a list into one save ----------

/** Project Zomboid: make a save load exactly this list (its Saves/<mode>/<save>/mods.txt, backed up first). */
export function applyLoadoutToPzSave(loadoutId: string, saveId: string, mods: ModRecord[]): Result {
  const blocked = guard('project-zomboid');
  if (blocked) return blocked;
  const all = getLoadouts('project-zomboid', mods).loadouts;
  const l = all.find((x) => x.id === loadoutId);
  const save = all.find((x) => x.id === saveId && x.kind === 'save');
  if (!l || !save?.path) return { ok: false, message: 'List or save not found.' };
  try {
    const text = fs.readFileSync(save.path, 'utf8');
    backup('project-zomboid', save.path);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const body = l.ids.map((id) => `\tmod = ${id},`).join(eol);
    fs.writeFileSync(
      save.path,
      /mods\s*\{[\s\S]*?\}/.test(text) ? text.replace(/mods\s*\{[\s\S]*?\}/, `mods${eol}{${eol}${body}${eol}}`) : `VERSION = 1,${eol}${eol}mods${eol}{${eol}${body}${eol}}${eol}`,
      'utf8',
    );
    return { ok: true, message: `Save “${save.name}” now loads “${l.name}” (${l.ids.length} mods).` };
  } catch (e) {
    return { ok: false, message: `Couldn't write the save's mod list: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ---------- share codes ----------

const CODE_PREFIX = 'MODHUB1:';

/** A copyable code for a list: game + name + ordered ids. */
export function exportLoadoutCode(gameId: string, loadoutId: string, mods: ModRecord[]): { ok: boolean; message: string; code?: string } {
  const l = getLoadouts(gameId, mods).loadouts.find((x) => x.id === loadoutId);
  if (!l) return { ok: false, message: 'Loadout not found.' };
  const code = CODE_PREFIX + Buffer.from(JSON.stringify({ g: gameId, n: l.name, i: l.ids }), 'utf8').toString('base64');
  return { ok: true, message: `Copied “${l.name}” (${l.ids.length} mods) as a share code.`, code };
}

/** Save a pasted share code as a new list for its game (in the game's own format). */
export function importLoadoutCode(code: string, mods: ModRecord[]): Result & { gameId?: string } {
  const raw = code.trim();
  if (!raw.startsWith(CODE_PREFIX)) return { ok: false, message: 'That doesn\u2019t look like a Mod Hub share code.' };
  let data: { g?: string; n?: string; i?: unknown };
  try {
    data = JSON.parse(Buffer.from(raw.slice(CODE_PREFIX.length), 'base64').toString('utf8'));
  } catch {
    return { ok: false, message: 'The share code is damaged.' };
  }
  const ids = Array.isArray(data.i) ? data.i.filter((x): x is string => typeof x === 'string' && x.length < 200) : [];
  if (!data.g || !GAMES[data.g] || !ids.length) return { ok: false, message: 'The share code is for an unsupported game or is empty.' };
  const name = `${String(data.n ?? 'Imported').slice(0, 60)} (imported)`;
  const r = saveCurrentLoadout(data.g, name, mods, undefined, ids);
  return { ...r, gameId: data.g };
}
