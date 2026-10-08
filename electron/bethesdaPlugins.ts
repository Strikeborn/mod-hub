import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GameLoadOrder, ModLoadState, ModRecord, OrderIssue, OrderPlan } from '../shared/types';
import { backup, isRunning, type EnableResult } from './loadOrderWrite';
import { findMo2Instances, readMo2Modlist, type Mo2Instance } from './mo2';
import { steamGameDir } from './workshopActions';

/**
 * Bethesda plugin load order (Skyrim SE): which .esp/.esm/.esl files are active, and in what order.
 * - Played through Mod Organizer 2: the chosen MO2 profile's plugins.txt / loadorder.txt / modlist.txt.
 *   Mod Hub edits those (MO2 must be closed; files backed up first).
 * - Played without MO2: %LOCALAPPDATA%\<game>\plugins.txt, which Vortex rewrites on deploy, so it's read-only.
 * Mods deployed by Vortex sit in the game's Data folder, so their SKSE DLLs load in every MO2 profile; only
 * their plugins can be switched off per profile.
 */

type GameDef = { folder: string; exe: string; base: string[]; ccc: string };
const GAMES: Record<string, GameDef> = {
  skyrimse: {
    folder: 'Skyrim Special Edition',
    exe: 'SkyrimSE.exe',
    base: ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'],
    ccc: 'Skyrim.ccc',
  },
};

export const PLUGIN_RE = /\.(esp|esm|esl)$/i;

export type PluginCtx = {
  gameId: string;
  game: GameDef;
  label: string;
  pluginsFile: string;
  loadorderFile?: string;
  modlistFile?: string;
  inst?: Mo2Instance;
  profile?: string;
  dataDir?: string;
  readOnly: boolean;
};

export function isPluginGame(gameId: string): boolean {
  return gameId in GAMES;
}

/** The plugin list ▶ Play will use: the chosen MO2 profile, else the game's own (Vortex) plugins.txt. */
export function pluginContext(gameId: string, choice?: { optionId: string; profile?: string }): PluginCtx | null {
  const game = GAMES[gameId];
  if (!game) return null;
  const inst = findMo2Instances().find((i) => i.gameId === gameId);
  const gameDir = inst?.gamePath ?? steamGameDir(game.folder);
  const dataDir = gameDir ? path.join(gameDir, 'Data') : undefined;
  const useMo2 = inst && (!choice || choice.optionId.startsWith('mo2'));
  if (inst && useMo2) {
    const profile = (choice?.profile && inst.profiles.includes(choice.profile) ? choice.profile : undefined) ?? inst.selectedProfile ?? inst.profiles[0];
    if (profile) {
      const dir = path.join(inst.root, 'profiles', profile);
      return {
        gameId,
        game,
        label: `MO2 profile “${profile}”`,
        pluginsFile: path.join(dir, 'plugins.txt'),
        loadorderFile: path.join(dir, 'loadorder.txt'),
        modlistFile: path.join(dir, 'modlist.txt'),
        inst,
        profile,
        dataDir,
        readOnly: false,
      };
    }
  }
  const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  return {
    gameId,
    game,
    label: 'plugins.txt (managed by Vortex, read-only)',
    pluginsFile: path.join(local, game.folder, 'plugins.txt'),
    dataDir,
    readOnly: true,
  };
}

/** plugins.txt: "*Name.esp" = active; order = load order. */
export function readPluginsTxt(file: string): { name: string; active: boolean }[] {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => ({ name: l.replace(/^\*/, ''), active: l.startsWith('*') }))
      .filter((p) => PLUGIN_RE.test(p.name));
  } catch {
    return [];
  }
}

/** Plugins the game always loads first (base game, DLC, Creation Club), not listed in plugins.txt. */
export function implicitPlugins(ctx: PluginCtx): string[] {
  const out = [...ctx.game.base];
  if (ctx.dataDir) {
    try {
      const ccc = fs.readFileSync(path.join(path.dirname(ctx.dataDir), ctx.game.ccc), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      for (const c of ccc) if (fs.existsSync(path.join(ctx.dataDir, c))) out.push(c);
    } catch {
      /* no Creation Club list */
    }
  }
  return out.filter((p, i) => out.findIndex((x) => x.toLowerCase() === p.toLowerCase()) === i);
}

/** Plugin files at the top of a mod folder (that's where they land in Data). Archives can't be listed. */
export function modPlugins(m: ModRecord): string[] {
  try {
    if (!m.localPath || !fs.statSync(m.localPath).isDirectory()) return [];
    return fs.readdirSync(m.localPath).filter((f) => PLUGIN_RE.test(f));
  } catch {
    return [];
  }
}

/** SKSE plugin DLLs a mod ships (they load whenever the files are in Data, whatever plugins.txt says). */
export function modSkseDlls(m: ModRecord): string[] {
  try {
    return fs.readdirSync(path.join(m.localPath, 'SKSE', 'Plugins')).filter((f) => /\.dll$/i.test(f));
  } catch {
    return [];
  }
}

export type PluginHeader = { master: boolean; light: boolean; masters: string[] };

/** TES4 record header: flags (0x1 master, 0x200 light) and MAST sub-records (required masters). */
export function readPluginHeader(file: string): PluginHeader | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(24);
    if (fs.readSync(fd, head, 0, 24, 0) < 24 || head.toString('latin1', 0, 4) !== 'TES4') return null;
    const size = Math.min(head.readUInt32LE(4), 1 << 20);
    const flags = head.readUInt32LE(8);
    const data = Buffer.alloc(size);
    fs.readSync(fd, data, 0, size, 24);
    const masters: string[] = [];
    for (let o = 0; o + 6 <= size; ) {
      const type = data.toString('latin1', o, o + 4);
      const len = data.readUInt16LE(o + 4);
      if (type === 'MAST') masters.push(data.toString('latin1', o + 6, o + 6 + len).replace(/\0.*$/, ''));
      o += 6 + len;
    }
    const ext = path.extname(file).toLowerCase();
    return { master: Boolean(flags & 0x1) || ext === '.esm' || ext === '.esl', light: Boolean(flags & 0x200) || ext === '.esl', masters };
  } catch {
    return null;
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

/** Where each plugin file is: the game's Data folder, overridden by enabled MO2 mods (higher priority wins). */
function pluginFiles(ctx: PluginCtx): Map<string, string> {
  const map = new Map<string, string>();
  const addDir = (dir: string) => {
    try {
      for (const f of fs.readdirSync(dir)) if (PLUGIN_RE.test(f)) map.set(f.toLowerCase(), path.join(dir, f));
    } catch {
      /* missing */
    }
  };
  if (ctx.dataDir) addDir(ctx.dataDir);
  if (ctx.inst && ctx.profile) {
    const enabled = readMo2Modlist(ctx.inst, ctx.profile).filter((e) => e.enabled && !e.unmanaged).reverse();
    for (const e of enabled) addDir(path.join(ctx.inst.modsDir, e.name));
  }
  return map;
}

function mo2EnabledNames(ctx: PluginCtx): Set<string> | null {
  if (!ctx.inst || !ctx.profile) return null;
  return new Set(readMo2Modlist(ctx.inst, ctx.profile).filter((e) => e.enabled).map((e) => e.name.toLowerCase()));
}

/** Per catalog mod: on/off and plugin position for the list ▶ Play will use. */
export function pluginLoadOrder(gameId: string, mods: ModRecord[], choice?: { optionId: string; profile?: string }): GameLoadOrder | null {
  const ctx = pluginContext(gameId, choice);
  if (!ctx || !fs.existsSync(ctx.pluginsFile)) return null;
  const listed = readPluginsTxt(ctx.pluginsFile);
  const implicit = implicitPlugins(ctx);
  const activeOrder = [...implicit, ...listed.filter((p) => p.active).map((p) => p.name)];
  const position = new Map<string, number>();
  activeOrder.forEach((p, i) => {
    if (!position.has(p.toLowerCase())) position.set(p.toLowerCase(), i + 1);
  });
  const known = new Set(listed.map((p) => p.name.toLowerCase()));
  const mo2On = mo2EnabledNames(ctx);
  const out: GameLoadOrder = {
    gameId,
    sourceLabel: ctx.label,
    sourcePath: ctx.pluginsFile,
    orderKind: 'list',
    mods: {},
    enabledCount: activeOrder.length,
    unmatched: [],
    readAt: new Date().toISOString(),
    readOnly: ctx.readOnly,
    implicit,
  };
  const claimed = new Set<string>();
  for (const m of mods) {
    if (m.gameId !== gameId) continue;
    const isMo2 = Boolean(m.mo2);
    // MO2's own mods only exist inside MO2's virtual Data folder.
    if (isMo2 && (!mo2On || m.mo2!.instance !== ctx.inst?.root)) continue;
    const modOn = isMo2 ? mo2On!.has(m.mo2!.name.toLowerCase()) : true;
    const plugins = modPlugins(m);
    const dlls = modSkseDlls(m);
    plugins.forEach((p) => claimed.add(p.toLowerCase()));
    const state: ModLoadState = { enabled: modOn, items: plugins };
    if (plugins.length) {
      const hits = plugins.map((p) => position.get(p.toLowerCase())).filter((p): p is number => p != null);
      state.enabled = modOn && hits.length > 0;
      if (state.enabled) state.position = Math.min(...hits);
      const off = plugins.filter((p) => !position.has(p.toLowerCase()));
      state.note = plugins.map((p) => `${p}${position.has(p.toLowerCase()) ? '' : known.has(p.toLowerCase()) || !modOn ? ' (off)' : ' (not in list)'}`).join(', ');
      if (modOn && off.length && dlls.length) state.note += ` · ${dlls.join(', ')} still loads`;
    } else {
      state.note = dlls.length ? `SKSE plugin: ${dlls.join(', ')}` : 'No plugin (assets only)';
    }
    if (!isMo2 && !plugins.length) {
      state.readOnly = true;
      state.lockedBy = 'Vortex';
      state.note += ' · deployed by Vortex, loads in every profile';
    } else if (ctx.readOnly) {
      state.readOnly = true;
      state.lockedBy = 'Vortex';
    }
    out.mods[m.id] = state;
  }
  for (const [i, p] of activeOrder.entries()) {
    if (i < implicit.length || claimed.has(p.toLowerCase())) continue;
    out.unmatched.push({ id: p, position: i + 1, note: 'Plugin not linked to a mod in the library' });
  }
  return out;
}

function guard(ctx: PluginCtx): string | null {
  if (ctx.readOnly) {
    return 'Vortex manages this plugin list. Pick an MO2 profile in the ▶ Play menu to edit it here, or change it in Vortex.';
  }
  if (isRunning('ModOrganizer.exe')) return 'Mod Organizer 2 is open. Close it first; it rewrites its profile files when it closes.';
  if (isRunning(ctx.game.exe)) return `${ctx.game.exe} is running. Close the game first.`;
  return null;
}

/** MO2 writes its profile files with Windows line endings. */
function writeLines(file: string, header: string, lines: string[]) {
  fs.writeFileSync(file, [header, ...lines].join('\r\n') + '\r\n', 'utf8');
}

const MO2_HEADER = '# This file was automatically generated by Mod Organizer.';

/** Switch mods on/off in an MO2 profile: their plugins (plugins.txt) and, for MO2's own mods, modlist.txt. */
export function setPluginModsEnabled(gameId: string, mods: ModRecord[], enabled: boolean, choice?: { optionId: string; profile?: string }): EnableResult {
  const ctx = pluginContext(gameId, choice);
  if (!ctx) return { ok: false, message: 'Not a plugin-based game.', changed: 0 };
  const blocked = guard(ctx);
  if (blocked) return { ok: false, message: blocked, changed: 0 };
  try {
    const plugins = readPluginsTxt(ctx.pluginsFile);
    const modlistText = ctx.modlistFile && fs.existsSync(ctx.modlistFile) ? fs.readFileSync(ctx.modlistFile, 'utf8') : '';
    const modlist = modlistText.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
    let changed = 0;
    const skipped: string[] = [];
    for (const m of mods) {
      const own = modPlugins(m);
      if (m.mo2) {
        const i = modlist.findIndex((l) => /^[+-]/.test(l) && l.slice(1).toLowerCase() === m.mo2!.name.toLowerCase());
        if (i >= 0 && (modlist[i][0] === '+') !== enabled) {
          modlist[i] = `${enabled ? '+' : '-'}${modlist[i].slice(1)}`;
          changed += 1;
        }
      } else if (!own.length) {
        skipped.push(m.title);
        continue;
      }
      for (const p of own) {
        const e = plugins.find((x) => x.name.toLowerCase() === p.toLowerCase());
        if (e) {
          if (e.active !== enabled) {
            e.active = enabled;
            changed += 1;
          }
        } else if (enabled) {
          plugins.push({ name: p, active: true });
          changed += 1;
        }
      }
    }
    if (!changed) {
      return {
        ok: skipped.length === 0,
        message: skipped.length ? `${skipped.join(', ')}: no plugin to switch. Vortex deploys it to Data, so it loads in every profile. Disable it in Vortex.` : 'Nothing to change.',
        changed: 0,
      };
    }
    backup(gameId, ctx.pluginsFile);
    writeLines(ctx.pluginsFile, MO2_HEADER, plugins.map((p) => `${p.active ? '*' : ''}${p.name}`));
    if (ctx.loadorderFile && fs.existsSync(ctx.loadorderFile)) {
      const lo = fs.readFileSync(ctx.loadorderFile, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
      const missing = plugins.filter((p) => !lo.some((l) => l.toLowerCase() === p.name.toLowerCase())).map((p) => p.name);
      if (missing.length) {
        backup(gameId, ctx.loadorderFile);
        writeLines(ctx.loadorderFile, MO2_HEADER, [...lo, ...missing]);
      }
    }
    if (ctx.modlistFile && modlistText) {
      backup(gameId, ctx.modlistFile);
      writeLines(ctx.modlistFile, MO2_HEADER, modlist);
    }
    const note = skipped.length ? ` (${skipped.length} without a plugin are Vortex-deployed: change those in Vortex)` : '';
    return { ok: true, message: `${enabled ? 'Enabled' : 'Disabled'} in ${ctx.label}: ${changed} change(s)${note}.`, changed };
  } catch (e) {
    return { ok: false, message: `Couldn't change the profile: ${e instanceof Error ? e.message : String(e)}`, changed: 0 };
  }
}

/**
 * Check and sort the plugin list. Rules (the ones that crash the game when broken):
 * masters (ESM/ESL) load before regular plugins, and every plugin loads after the masters it lists.
 * Everything else keeps its current place, so a LOOT-sorted list stays as LOOT left it.
 */
export function planPluginOrder(gameId: string, mods: ModRecord[], choice?: { optionId: string; profile?: string }, order?: string[]): OrderPlan | null {
  const ctx = pluginContext(gameId, choice);
  if (!ctx || !fs.existsSync(ctx.pluginsFile)) return null;
  const listed = readPluginsTxt(ctx.pluginsFile);
  const current = order ?? listed.map((p) => p.name);
  const active = new Set(listed.filter((p) => p.active).map((p) => p.name.toLowerCase()));
  const implicit = implicitPlugins(ctx);
  const implicitSet = new Set(implicit.map((p) => p.toLowerCase()));
  const files = pluginFiles(ctx);
  const headers = new Map<string, PluginHeader>();
  for (const p of current) {
    const f = files.get(p.toLowerCase());
    const h = f ? readPluginHeader(f) : null;
    if (h) headers.set(p.toLowerCase(), h);
  }

  // Stable sort: masters first, then each plugin right after the masters it needs.
  const isMaster = (p: string) => headers.get(p.toLowerCase())?.master ?? /\.(esm|esl)$/i.test(p);
  const byName = new Map(current.map((p) => [p.toLowerCase(), p]));
  const placed = new Set<string>();
  const proposed: string[] = [];
  const visiting = new Set<string>();
  const place = (p: string, group: boolean) => {
    const k = p.toLowerCase();
    if (placed.has(k) || visiting.has(k)) return;
    visiting.add(k);
    for (const mast of headers.get(k)?.masters ?? []) {
      const mk = mast.toLowerCase();
      if (byName.has(mk) && isMaster(byName.get(mk)!) === group) place(byName.get(mk)!, group);
    }
    visiting.delete(k);
    placed.add(k);
    proposed.push(p);
  };
  for (const p of current) if (isMaster(p)) place(p, true);
  for (const p of current) if (!isMaster(p)) place(p, false);

  const issues: OrderIssue[] = [];
  const ownerOf = new Map<string, ModRecord>();
  for (const m of mods) if (m.gameId === gameId) for (const p of modPlugins(m)) if (!ownerOf.has(p.toLowerCase())) ownerOf.set(p.toLowerCase(), m);
  const idx = new Map(current.map((p, i) => [p.toLowerCase(), i]));
  for (const p of current) {
    const k = p.toLowerCase();
    if (!active.has(k)) continue;
    for (const mast of headers.get(k)?.masters ?? []) {
      const mk = mast.toLowerCase();
      if (implicitSet.has(mk)) continue;
      if (!byName.has(mk) && !files.has(mk)) {
        issues.push({ kind: 'dependency-missing', modId: p, otherId: mast, message: `${p} needs ${mast}, which isn't installed. The game crashes when it loads ${p}.` });
      } else if (!active.has(mk)) {
        const owner = ownerOf.get(mk);
        issues.push({ kind: 'dependency-off', modId: p, otherId: owner?.id ?? mast, message: `${p} needs ${mast}, which is switched off.` });
      } else if ((idx.get(mk) ?? -1) > (idx.get(k) ?? -1)) {
        issues.push({ kind: 'order', modId: p, otherId: mast, message: `${p} loads before its master ${mast}.` });
      }
    }
  }
  // An SKSE DLL that loads while its own plugin is off is the "crash on new game" setup.
  const mo2On = mo2EnabledNames(ctx);
  for (const m of mods) {
    if (m.gameId !== gameId) continue;
    if (m.mo2 && !mo2On?.has(m.mo2.name.toLowerCase())) continue;
    const own = modPlugins(m);
    const dlls = modSkseDlls(m);
    if (!own.length || !dlls.length || own.some((p) => active.has(p.toLowerCase()))) continue;
    issues.push({
      kind: 'dependency-off',
      modId: own[0],
      otherId: m.id,
      message: `${m.title}: ${dlls.join(', ')} loads but ${own.join(', ')} ${own.length === 1 ? 'is' : 'are'} off. That can crash the game (often on New Game).`,
    });
  }
  // Script extender builds for another edition (e.g. SKSE VR on Skyrim SE) replace SKSE's scripts with ones that
  // report the wrong version ("RaceMenu: expected 72, got 60").
  for (const m of mods) {
    if (m.gameId !== gameId || (m.mo2 && !mo2On?.has(m.mo2.name.toLowerCase()))) continue;
    if (!/\b(skse|script extender)\b/i.test(m.title) || !/\bVR\b/.test(m.title)) continue;
    issues.push({
      kind: 'incompatible',
      modId: m.title,
      otherId: m.id,
      message: `${m.title} is for Skyrim VR. Its SKSE scripts replace this game's and break version checks (e.g. RaceMenu). Remove it.`,
    });
  }
  if (ctx.dataDir && fs.existsSync(path.join(path.dirname(ctx.dataDir), 'skse64_loader.exe')) && !fs.existsSync(path.join(ctx.dataDir, 'Scripts', 'SKSE.pex'))) {
    const viaMo2 = ctx.inst && fs.readdirSync(ctx.inst.modsDir).some((d) => fs.existsSync(path.join(ctx.inst!.modsDir, d, 'Scripts', 'SKSE.pex')));
    if (!viaMo2) {
      issues.push({
        kind: 'dependency-missing',
        modId: 'SKSE',
        otherId: 'SKSE scripts',
        message: "SKSE's scripts (Data\\Scripts\\SKSE.pex) aren't installed. Copy the Data folder from the SKSE download into the game's Data folder.",
      });
    }
  }
  const moved = proposed.filter((p, i) => p !== current[i]).length;
  return { gameId, current, proposed, moved, issues };
}

/** Save a new plugin order (same plugins, new order) into the MO2 profile. */
export function setPluginOrder(gameId: string, order: string[], choice?: { optionId: string; profile?: string }): EnableResult {
  const ctx = pluginContext(gameId, choice);
  if (!ctx) return { ok: false, message: 'Not a plugin-based game.', changed: 0 };
  const blocked = guard(ctx);
  if (blocked) return { ok: false, message: blocked, changed: 0 };
  try {
    const listed = readPluginsTxt(ctx.pluginsFile);
    const byName = new Map(listed.map((p) => [p.name.toLowerCase(), p]));
    if (order.length !== listed.length || order.some((p) => !byName.has(p.toLowerCase()))) {
      return { ok: false, message: 'The plugin list changed since this order was made. Reload and try again.', changed: 0 };
    }
    const moved = order.filter((p, i) => p.toLowerCase() !== listed[i].name.toLowerCase()).length;
    if (!moved) return { ok: true, message: 'Order unchanged.', changed: 0 };
    backup(gameId, ctx.pluginsFile);
    writeLines(ctx.pluginsFile, MO2_HEADER, order.map((p) => `${byName.get(p.toLowerCase())!.active ? '*' : ''}${byName.get(p.toLowerCase())!.name}`));
    if (ctx.loadorderFile && fs.existsSync(ctx.loadorderFile)) {
      backup(gameId, ctx.loadorderFile);
      writeLines(ctx.loadorderFile, MO2_HEADER, [...implicitPlugins(ctx), ...order.map((p) => byName.get(p.toLowerCase())!.name)]);
    }
    return { ok: true, message: `Saved the plugin order in ${ctx.label} (${moved} moved).`, changed: moved };
  } catch (e) {
    return { ok: false, message: `Couldn't save the order: ${e instanceof Error ? e.message : String(e)}`, changed: 0 };
  }
}

/** Vortex's own plugin list for the game (what you get when you play without MO2). */
function vortexPluginsFile(game: GameDef): string {
  return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), game.folder, 'plugins.txt');
}

/**
 * Compare / copy plugin on-off between Vortex's plugins.txt and an MO2 profile. Only plugins both lists know
 * are touched (MO2's own mods aren't in Data, so Vortex can't have them; Vortex mods show in MO2 as unmanaged).
 */
export function pluginSync(
  gameId: string,
  direction: 'vortex-to-mo2' | 'mo2-to-vortex',
  choice?: { optionId: string; profile?: string },
  apply = false,
): EnableResult & { differences: { name: string; vortex: boolean; mo2: boolean }[] } {
  const none = { differences: [] as { name: string; vortex: boolean; mo2: boolean }[] };
  const ctx = pluginContext(gameId, choice ?? { optionId: 'mo2' });
  if (!ctx?.inst || !ctx.profile) return { ok: false, message: 'No MO2 profile for this game.', changed: 0, ...none };
  const vFile = vortexPluginsFile(ctx.game);
  if (!fs.existsSync(vFile)) return { ok: false, message: "Vortex's plugins.txt wasn't found.", changed: 0, ...none };
  const vortex = readPluginsTxt(vFile);
  const mo2 = readPluginsTxt(ctx.pluginsFile);
  const vMap = new Map(vortex.map((p) => [p.name.toLowerCase(), p]));
  const differences = mo2
    .filter((p) => vMap.has(p.name.toLowerCase()) && vMap.get(p.name.toLowerCase())!.active !== p.active)
    .map((p) => ({ name: p.name, vortex: vMap.get(p.name.toLowerCase())!.active, mo2: p.active }));
  if (!apply || !differences.length) {
    return { ok: true, message: differences.length ? `${differences.length} plugin(s) differ.` : 'Vortex and the MO2 profile agree.', changed: 0, differences };
  }
  if (isRunning('ModOrganizer.exe')) return { ok: false, message: 'Close Mod Organizer 2 first.', changed: 0, differences };
  if (isRunning(ctx.game.exe)) return { ok: false, message: 'Close the game first.', changed: 0, differences };
  try {
    if (direction === 'vortex-to-mo2') {
      for (const p of mo2) {
        const v = vMap.get(p.name.toLowerCase());
        if (v) p.active = v.active;
      }
      backup(gameId, ctx.pluginsFile);
      writeLines(ctx.pluginsFile, MO2_HEADER, mo2.map((p) => `${p.active ? '*' : ''}${p.name}`));
      return { ok: true, message: `Copied Vortex's plugin on/off into MO2 “${ctx.profile}” (${differences.length} changed).`, changed: differences.length, differences };
    }
    if (isRunning('Vortex.exe')) return { ok: false, message: 'Close Vortex first (it rewrites plugins.txt while open).', changed: 0, differences };
    const mMap = new Map(mo2.map((p) => [p.name.toLowerCase(), p]));
    for (const p of vortex) {
      const m = mMap.get(p.name.toLowerCase());
      if (m) p.active = m.active;
    }
    backup(gameId, vFile);
    writeLines(vFile, '# Automatically generated by Vortex', vortex.map((p) => `${p.active ? '*' : ''}${p.name}`));
    return {
      ok: true,
      message: `Copied MO2 “${ctx.profile}” plugin on/off into Vortex (${differences.length} changed). Vortex picks it up when it starts.`,
      changed: differences.length,
      differences,
    };
  } catch (e) {
    return { ok: false, message: `Couldn't sync: ${e instanceof Error ? e.message : String(e)}`, changed: 0, differences };
  }
}

/** LOOT, if installed (it reads the active MO2 profile only when started from MO2). */
export function lootExe(): string | undefined {
  const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean) as string[];
  for (const base of pf) {
    const f = path.join(base, 'LOOT', 'LOOT.exe');
    if (fs.existsSync(f)) return f;
  }
  return undefined;
}
