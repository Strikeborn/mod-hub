import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backup } from './loadOrderWrite';
import { discoverSteamLibraries } from './steamDiscovery';

/**
 * Isaac's Lua runs sandboxed: no files, no programs. "LuaDebug" (REPENTOGON launcher setting, or Steam's
 * `--luadebug` launch option) removes that sandbox for every enabled mod. Mod Hub keeps it off and flags mods
 * whose scripts try to use the blocked APIs (those are the ones that ask you to turn it on).
 */

function launcherIni(): string {
  return path.join(os.homedir(), 'Documents', 'My Games', 'repentogon_launcher.ini');
}

/** Steam's per-user launch options for Isaac (read only: Steam rewrites localconfig.vdf while it runs). */
function steamLaunchOptions(): string | undefined {
  for (const lib of discoverSteamLibraries()) {
    const userdata = path.join(lib, 'userdata');
    if (!fs.existsSync(userdata)) continue;
    for (const user of fs.readdirSync(userdata)) {
      const f = path.join(userdata, user, 'config', 'localconfig.vdf');
      try {
        const text = fs.readFileSync(f, 'utf8');
        const i = text.indexOf('"250900"');
        if (i < 0) continue;
        const block = text.slice(i, i + 4000);
        const end = block.search(/\n\t{4,5}\}/);
        const opts = /"LaunchOptions"\s+"([^"]*)"/.exec(end > 0 ? block.slice(0, end) : block)?.[1];
        if (opts) return opts;
      } catch {
        /* no config */
      }
    }
  }
  return undefined;
}

export type LuaDebugState = { launcher: boolean | null; steamOption: boolean; steamLaunchOptions?: string };

export function isaacLuaDebugState(): LuaDebugState {
  let launcher: boolean | null = null;
  try {
    const v = /^\s*LuaDebug\s*=\s*(\S+)/im.exec(fs.readFileSync(launcherIni(), 'utf8'))?.[1];
    if (v != null) launcher = v !== '0' && v.toLowerCase() !== 'false';
  } catch {
    /* no REPENTOGON launcher */
  }
  const opts = steamLaunchOptions();
  return { launcher, steamOption: /--luadebug/i.test(opts ?? ''), steamLaunchOptions: opts };
}

/** Turn REPENTOGON's LuaDebug back off (backup first). Returns true if it was on. */
export function enforceLuaDebugOff(): boolean {
  const f = launcherIni();
  try {
    const text = fs.readFileSync(f, 'utf8');
    if (!/^\s*LuaDebug\s*=\s*(?!0\s*$)\S+/im.test(text)) return false;
    backup('binding-of-isaac', f);
    fs.writeFileSync(f, text.replace(/^(\s*LuaDebug\s*=\s*)\S+/im, '$10'), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** Lua calls that only work with LuaDebug on: files, programs, native libraries, sockets. */
const LUA_RISKY: [RegExp, string][] = [
  [/\bos\.execute\s*\(/, 'os.execute (runs programs)'],
  [/\bio\.popen\s*\(/, 'io.popen (runs programs)'],
  [/\bio\.open\s*\(/, 'io.open (reads/writes files)'],
  [/\bos\.remove\s*\(|\bos\.rename\s*\(/, 'os.remove/rename (deletes/moves files)'],
  [/\bpackage\.loadlib\s*\(/, 'package.loadlib (loads native code)'],
  [/require\s*\(?\s*["'](ffi|socket|lfs|io|os)["']/, 'require of a native/system module'],
  [/\bloadstring\s*\(\s*[^)]*(base64|\\x[0-9a-f]{2})/i, 'loads hidden/encoded code'],
];

/** Which blocked Lua APIs an Isaac mod's scripts use (first match per rule). */
export function isaacLuaRisks(modDir: string): string[] {
  const found = new Set<string>();
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || found.size === LUA_RISKY.length) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.lua$/i.test(e.name)) {
        let text = '';
        try {
          if (fs.statSync(p).size > 2_000_000) continue;
          text = fs.readFileSync(p, 'utf8');
        } catch {
          continue;
        }
        // Ignore comments so "-- don't use io.open" doesn't count.
        const code = text.replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, '').replace(/--[^\n]*/g, '');
        for (const [re, label] of LUA_RISKY) if (re.test(code)) found.add(label);
      }
    }
  };
  walk(modDir, 0);
  return [...found];
}
