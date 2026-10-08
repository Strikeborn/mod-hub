import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { shell } from 'electron';
import type { PlayOption } from '../shared/types';
import { gameById } from './gamesRegistry';
import { steamGameDir } from './workshopActions';
import { findMo2Instances } from './mo2';
import { findPrismInstances, prismExe } from './prism';
import { discoverSteamLibraries } from './steamDiscovery';

export { findMo2Instances };

/**
 * "Play": the ways each game can be started, best first. Mod Hub doesn't deploy anything itself (yet); it starts
 * the game through whatever owns the mods: MO2 (virtual file system + profile), REPENTOGON's launcher, SKSE for
 * Vortex-deployed Skyrim, or plain Steam (which reads ModsConfig.xml / mods\default.txt / disable.it as-is).
 */

/** REPENTOGON's launcher lives wherever the user unpacked it; look in the usual places once, then remember. */
let repentogonCache: string | null | undefined;
function findRepentogonLauncher(remembered?: string): string | undefined {
  if (remembered && fs.existsSync(remembered)) return remembered;
  if (repentogonCache !== undefined) return repentogonCache ?? undefined;
  const roots = ['C:', 'D:', 'E:', 'F:', 'G:'].map((d) => `${d}\\`).filter((d) => fs.existsSync(d));
  const candidates: string[] = [];
  for (const r of roots) {
    for (const sub of ['', 'Games', 'BOI', 'Isaac', 'Mods', 'Program Files', path.join('Program Files', 'REPENTOGON')]) {
      candidates.push(path.join(r, sub, 'REPENTOGONLauncher', 'REPENTOGONLauncher.exe'), path.join(r, sub, 'REPENTOGONLauncher.exe'));
    }
  }
  const game = steamGameDir('The Binding of Isaac Rebirth');
  if (game) candidates.unshift(path.join(game, 'REPENTOGONLauncher.exe'), path.join(path.dirname(game), 'REPENTOGONLauncher', 'REPENTOGONLauncher.exe'));
  candidates.push(path.join(os.homedir(), 'Downloads', 'REPENTOGONLauncher', 'REPENTOGONLauncher.exe'));
  repentogonCache = candidates.find((c) => fs.existsSync(c)) ?? null;
  return repentogonCache ?? undefined;
}

const STEAM_INSTALL_DIR: Record<string, string> = {
  skyrimse: 'Skyrim Special Edition',
  'binding-of-isaac': 'The Binding of Isaac Rebirth',
  fallout4: 'Fallout 4',
};

export function playOptions(gameId: string, remembered: { repentogonLauncher?: string } = {}): PlayOption[] {
  const out: PlayOption[] = [];
  const appId = gameById(gameId)?.steamAppId ?? (Number(/^steam-(\d+)$/.exec(gameId)?.[1]) || undefined);

  for (const mo2 of findMo2Instances().filter((i) => i.gameId === gameId)) {
    const profile = mo2.selectedProfile ?? mo2.profiles[0];
    const preferred = mo2.executables.find((e) => /skse|f4se|nvse|script extender/i.test(e.title)) ?? mo2.executables[0];
    for (const e of mo2.executables.filter((x) => !/explore|explorer\+\+/i.test(x.title))) {
      out.push({
        id: `mo2:${mo2.root}:${e.title}`,
        label: `Mod Organizer 2 → ${e.title}`,
        kind: 'mo2',
        command: mo2.exe,
        args: ['-p', profile ?? 'Default', `moshortcut://:${e.title}`],
        profiles: mo2.profiles,
        profile,
        recommended: e === preferred,
        note: `MO2 profile “${profile}” (mods load through MO2's virtual folder). Instance: ${mo2.root}`,
      });
    }
  }

  if (gameId === 'minecraft') {
    const exe = prismExe();
    const instances = findPrismInstances();
    if (exe && instances.length) {
      out.push({
        id: 'prism',
        label: 'Prism Launcher',
        kind: 'prism',
        command: exe,
        args: ['--launch', instances[0].id],
        profiles: instances.map((i) => i.id),
        profile: instances[0].id,
        recommended: true,
        note: 'Starts the chosen Prism instance (its mods, loader and Java).',
      });
    }
  }

  if (gameId === 'binding-of-isaac') {
    const launcher = findRepentogonLauncher(remembered.repentogonLauncher);
    if (launcher) {
      out.push({
        id: 'repentogon',
        label: 'REPENTOGON launcher',
        kind: 'exe',
        command: launcher,
        args: [],
        recommended: true,
        note: 'Starts Isaac with REPENTOGON. Mods load from the game\'s mods folder (disable.it respected).',
      });
    }
  }

  const installDir = STEAM_INSTALL_DIR[gameId];
  const gameDir = installDir ? steamGameDir(installDir) : undefined;
  if (gameId === 'skyrimse' && gameDir && fs.existsSync(path.join(gameDir, 'skse64_loader.exe'))) {
    out.push({
      id: 'skse-direct',
      label: 'SKSE (game folder, Vortex-deployed mods only)',
      kind: 'exe',
      command: path.join(gameDir, 'skse64_loader.exe'),
      args: [],
      recommended: !out.some((o) => o.recommended),
      note: 'Runs SKSE directly: only what Vortex deployed into the game folder loads (no MO2 mods).',
    });
  }

  if (appId) {
    out.push({
      id: 'steam',
      label: 'Steam',
      kind: 'steam',
      command: `steam://rungameid/${appId}`,
      args: [],
      recommended: !out.some((o) => o.recommended),
      note: 'Plain Steam launch. The game reads its own mod list (Mod Hub writes it), Vortex deployments stay in place.',
    });
  }
  return out;
}

/** Start a play option. Returns a message for the toast. */
export async function launchPlayOption(opt: PlayOption, profile?: string): Promise<{ ok: boolean; message: string }> {
  try {
    if (opt.kind === 'steam') {
      await shell.openExternal(opt.command);
      return { ok: true, message: 'Starting through Steam…' };
    }
    if (!fs.existsSync(opt.command)) return { ok: false, message: `Not found: ${opt.command}` };
    const args = profile && opt.profiles ? opt.args.map((a, i) => (opt.args[i - 1] === '-p' || opt.args[i - 1] === '--launch' ? profile : a)) : opt.args;
    const child = spawn(opt.command, args, { cwd: path.dirname(opt.command), detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    return {
      ok: true,
      message: `Starting ${opt.label}${opt.kind === 'mo2' ? ` (profile “${profile ?? opt.profile}”)` : opt.kind === 'prism' ? ` (instance “${profile ?? opt.profile}”)` : ''}…`,
    };
  } catch (e) {
    return { ok: false, message: `Couldn't start: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Steam's view of an installed game (steamapps/appmanifest_<id>.acf). StateFlags bit 2 = an update is required;
 * a Steam launch installs it first, which is what breaks script-extender mods (SKSE/F4SE) on Bethesda games.
 */
export function steamUpdateState(appId: number): { pending: boolean; bytes?: number; autoUpdate?: 'always' | 'on-launch' | 'high-priority' } | null {
  for (const lib of discoverSteamLibraries()) {
    const f = path.join(lib, 'steamapps', `appmanifest_${appId}.acf`);
    if (!fs.existsSync(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    const num = (k: string) => Number(new RegExp(`"${k}"\\s+"(\\d+)"`).exec(text)?.[1] ?? 0);
    const flags = num('StateFlags');
    const behavior = num('AutoUpdateBehavior');
    return {
      pending: (flags & 2) !== 0 || num('TargetBuildID') > num('buildid'),
      bytes: num('BytesToDownload') || undefined,
      autoUpdate: behavior === 1 ? 'on-launch' : behavior === 2 ? 'high-priority' : 'always',
    };
  }
  return null;
}
