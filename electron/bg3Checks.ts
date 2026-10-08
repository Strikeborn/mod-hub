import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OrderIssue, OrderPlan } from '../shared/types';
import { readPakInfo, type Bg3PakInfo } from './bg3Pak';
import { steamGameDir } from './workshopActions';

/**
 * BG3 checks (read-only; Vortex owns modsettings.lsx): missing / inactive / late dependencies, active entries
 * without a .pak, and mods that need the Script Extender when it isn't installed.
 */

/** Base-game modules mods list as dependencies (always present). */
const BASE = /^(gustav|gustavdev|gustavx|shared|shareddev|honour|honourx|mainui|modbrowser|engine|game|diceset_\d+)$/i;

export function bg3Root(): string {
  return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Larian Studios', "Baldur's Gate 3");
}

/** Active mods in modsettings.lsx, in load order (base game entries left out). */
export function readModsettings(): { uuid: string; name: string; folder: string }[] {
  try {
    const xml = fs.readFileSync(path.join(bg3Root(), 'PlayerProfiles', 'Public', 'modsettings.lsx'), 'utf8');
    const block = /<node id="Mods">([\s\S]*?)<\/children>\s*<\/node>/i.exec(xml)?.[1] ?? xml;
    return [...block.matchAll(/<node id="ModuleShortDesc">([\s\S]*?)<\/node>/gi)]
      .map((m) => ({
        uuid: /id="UUID"[^>]*value="([^"]*)"/i.exec(m[1])?.[1] ?? '',
        name: /id="Name"[^>]*value="([^"]*)"/i.exec(m[1])?.[1] ?? '',
        folder: /id="Folder"[^>]*value="([^"]*)"/i.exec(m[1])?.[1] ?? '',
      }))
      .filter((e) => e.uuid && !BASE.test(e.folder) && !BASE.test(e.name));
  } catch {
    return [];
  }
}

export function installedPaks(): Bg3PakInfo[] {
  const dir = path.join(bg3Root(), 'Mods');
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /\.pak$/i.test(f))
      .map((f) => readPakInfo(path.join(dir, f)));
  } catch {
    return [];
  }
}

/** BG3 Script Extender: DWrite.dll next to bg3.exe. */
export function bg3ScriptExtenderInstalled(): boolean | null {
  const game = steamGameDir("Baldurs Gate 3") ?? steamGameDir("Baldur's Gate 3");
  if (!game) return null;
  return fs.existsSync(path.join(game, 'bin', 'DWrite.dll'));
}

export function planBg3Order(): OrderPlan {
  const active = readModsettings();
  const paks = installedPaks();
  const byUuid = new Map<string, { pak: Bg3PakInfo; name: string }>();
  for (const p of paks) for (const m of p.modules) byUuid.set(m.uuid.toLowerCase(), { pak: p, name: m.name });
  const pos = new Map(active.map((e, i) => [e.uuid.toLowerCase(), i]));
  const issues: OrderIssue[] = [];

  for (const [i, e] of active.entries()) {
    const hit = byUuid.get(e.uuid.toLowerCase());
    if (!hit) {
      issues.push({ kind: 'dependency-missing', modId: e.name, otherId: e.uuid, message: `${e.name} is active in modsettings.lsx but its .pak isn't in the Mods folder.` });
      continue;
    }
    const mod = hit.pak.modules.find((m) => m.uuid.toLowerCase() === e.uuid.toLowerCase())!;
    for (const d of mod.dependencies) {
      if (BASE.test(d.folder ?? '') || BASE.test(d.name ?? '')) continue;
      const label = d.name ?? d.uuid;
      const at = pos.get(d.uuid.toLowerCase());
      if (!byUuid.has(d.uuid.toLowerCase())) {
        issues.push({ kind: 'dependency-missing', modId: e.name, otherId: d.uuid, message: `${e.name} needs ${label}, which isn't installed.` });
      } else if (at == null) {
        issues.push({ kind: 'dependency-off', modId: e.name, otherId: d.uuid, message: `${e.name} needs ${label}, which is installed but not active.` });
      } else if (at > i) {
        issues.push({ kind: 'order', modId: e.name, otherId: d.uuid, message: `${e.name} loads before ${label}, which it needs.` });
      }
    }
  }
  const se = bg3ScriptExtenderInstalled();
  if (se === false) {
    const needing = active.map((e) => byUuid.get(e.uuid.toLowerCase())).filter((h) => h?.pak.usesScriptExtender).map((h) => h!.name);
    if (needing.length) {
      issues.push({
        kind: 'dependency-missing',
        modId: 'Script Extender',
        otherId: 'bg3se',
        message: `BG3 Script Extender isn't installed (bin\\DWrite.dll), but ${needing.length} active mod(s) use it: ${needing.join(', ')}.`,
      });
    }
  }
  for (const p of paks.filter((x) => x.error)) {
    issues.push({ kind: 'incompatible', modId: path.basename(p.file), message: `${path.basename(p.file)} couldn't be read (${p.error}).` });
  }
  // Suggested order: each mod after the active mods it depends on; otherwise unchanged.
  const depsOf = (uuid: string) =>
    (byUuid.get(uuid)?.pak.modules.find((m) => m.uuid.toLowerCase() === uuid)?.dependencies ?? []).map((d) => d.uuid.toLowerCase()).filter((d) => pos.has(d));
  const placed = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];
  const place = (uuid: string) => {
    if (placed.has(uuid) || visiting.has(uuid)) return;
    visiting.add(uuid);
    for (const d of depsOf(uuid)) place(d);
    visiting.delete(uuid);
    placed.add(uuid);
    order.push(uuid);
  };
  for (const e of active) place(e.uuid.toLowerCase());
  const nameOf = new Map(active.map((e) => [e.uuid.toLowerCase(), e.name]));
  const current = active.map((e) => e.name);
  const proposed = order.map((u) => nameOf.get(u)!);
  const moved = proposed.filter((n, i) => n !== current[i]).length;
  return { gameId: 'baldursgate3', current, proposed, moved, issues };
}
