import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CrashReport, ModRecord } from '../shared/types';
import { modPlugins, modSkseDlls } from './bethesdaPlugins';

/**
 * Crash Logger SSE AE VR writes Documents\My Games\<game>\SKSE\crash-<date>.log. Mod Hub reads the newest one
 * and names the likely culprits: DLLs in the probable call stack (other than the game and Windows) and plugin
 * files the crashed objects came from, mapped back to library mods.
 */

const LOG_DIRS: Record<string, string> = { skyrimse: 'Skyrim Special Edition' };
const SYSTEM_MODULES = /^(skyrimse|skyrimvr|ntdll|kernel(base|32)|ucrtbase|msvcp\d+|vcruntime\d+|user32|win32u|gdi32|d3d11|dxgi|nvwgf2umx|amdxx64|atidxx64|combase|ole32|crashlogger|skse64_[\d_]+)\.(dll|exe)$/i;

export function crashLogDir(gameId: string): string | undefined {
  const folder = LOG_DIRS[gameId];
  return folder ? path.join(os.homedir(), 'Documents', 'My Games', folder, 'SKSE') : undefined;
}

/** Pull the exception and suspects out of one crash log. */
export function parseCrashLog(text: string): { exception?: string; gameVersion?: string; dlls: { name: string; count: number }[]; plugins: { name: string; count: number }[] } {
  const exception = /Unhandled exception "([^"]+)" at 0x[0-9A-F]+ ([^\s\t]+)/i.exec(text);
  const gameVersion = /^Skyrim (?:SSE|AE|VR) v?([\d.]+)/im.exec(text)?.[1];
  const section = (name: string) => {
    const i = text.search(new RegExp(`^${name}:`, 'm'));
    if (i < 0) return '';
    const rest = text.slice(i + name.length + 1);
    const end = rest.search(/^[A-Z][A-Z ]+:\s*$/m);
    return end < 0 ? rest : rest.slice(0, end);
  };
  const count = (names: string[]) => {
    const m = new Map<string, { name: string; count: number }>();
    for (const n of names) {
      const k = n.toLowerCase();
      const e = m.get(k) ?? { name: n, count: 0 };
      e.count += 1;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  };
  const stack = section('PROBABLE CALL STACK');
  const dlls = count(
    [...stack.matchAll(/\]\s+0x[0-9A-F]+\s+([^\s+]+\.(?:dll|exe))\+/gi)].map((m) => m[1]).filter((d) => !SYSTEM_MODULES.test(d)),
  );
  const objects = `${section('POSSIBLE RELEVANT OBJECTS')}\n${section('REGISTERS')}\n${section('STACK')}`;
  const plugins = count(
    [...objects.matchAll(/File:\s*"([^"]+\.(?:esp|esm|esl))"/gi)].map((m) => m[1]).filter((p) => !/^(skyrim|update|dawnguard|hearthfires|dragonborn)\.esm$/i.test(p)),
  );
  if (exception && !SYSTEM_MODULES.test(exception[2].split('+')[0]) && /\.(dll)\+/i.test(exception[2])) {
    const d = exception[2].split('+')[0];
    if (!dlls.some((x) => x.name.toLowerCase() === d.toLowerCase())) dlls.unshift({ name: d, count: 1 });
  }
  return { exception: exception ? `${exception[1]} at ${exception[2]}` : undefined, gameVersion, dlls, plugins };
}

/** The newest crash log for a game, with suspects mapped to library mods. */
export function latestCrash(gameId: string, mods: ModRecord[]): CrashReport | null {
  const dir = crashLogDir(gameId);
  if (!dir || !fs.existsSync(dir)) return null;
  const logs = fs
    .readdirSync(dir)
    .filter((f) => /^crash-.*\.log$/i.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!logs.length) return null;
  const file = path.join(dir, logs[0].f);
  const parsed = parseCrashLog(fs.readFileSync(file, 'utf8'));
  const own = mods.filter((m) => m.gameId === gameId);
  const byDll = new Map<string, ModRecord>();
  const byPlugin = new Map<string, ModRecord>();
  for (const m of own) {
    for (const d of modSkseDlls(m)) byDll.set(d.toLowerCase(), m);
    for (const p of modPlugins(m)) byPlugin.set(p.toLowerCase(), m);
  }
  const suspects: CrashReport['suspects'] = [
    ...parsed.dlls.map((d) => ({ kind: 'dll' as const, name: d.name, count: d.count, modId: byDll.get(d.name.toLowerCase())?.id, modTitle: byDll.get(d.name.toLowerCase())?.title })),
    ...parsed.plugins.map((p) => ({ kind: 'plugin' as const, name: p.name, count: p.count, modId: byPlugin.get(p.name.toLowerCase())?.id, modTitle: byPlugin.get(p.name.toLowerCase())?.title })),
  ];
  return { gameId, file, at: new Date(logs[0].t).toISOString(), total: logs.length, exception: parsed.exception, gameVersion: parsed.gameVersion, suspects };
}
