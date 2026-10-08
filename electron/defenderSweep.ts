import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DefenderSweep, ModRecord } from '../shared/types';
import { defenderScan } from './security';
import { findMo2Instances } from './mo2';
import { isaacModsDir } from './loadOrder';
import { steamGameDir } from './workshopActions';
import { discoverSteamLibraries } from './steamDiscovery';

/**
 * "Scan all mod folders": one recursive Defender scan per place mods live (Workshop folders, Vortex staging and
 * downloads, MO2, game mod folders, Mod Hub's vault) instead of one scan per mod. Archives are scanned inside.
 * Threats Defender reports are mapped back to the mod they belong to.
 */

/** Every folder that holds mods on this PC (nested folders removed). */
export function modRoots(mods: ModRecord[], userData: string): { label: string; dir: string }[] {
  const out: { label: string; dir: string }[] = [];
  const add = (label: string, dir: string | undefined) => {
    if (dir && fs.existsSync(dir)) out.push({ label, dir: path.resolve(dir) });
  };
  for (const lib of discoverSteamLibraries()) add(`Steam Workshop (${lib})`, path.join(lib, 'steamapps', 'workshop', 'content'));
  const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  add('Vortex downloads', path.join(appData, 'Vortex', 'downloads'));
  // Vortex staging folders (one per game; may be on another drive).
  for (const dir of new Set(mods.filter((m) => m.source === 'vortex-staging' && m.localPath).map((m) => path.dirname(m.localPath)))) {
    add(`Vortex staging (${path.basename(dir)})`, dir);
  }
  for (const inst of findMo2Instances()) add(`Mod Organizer 2 (${inst.gameName})`, inst.modsDir);
  add('Isaac mods folder', isaacModsDir());
  const rw = steamGameDir('RimWorld');
  if (rw) add('RimWorld Mods folder', path.join(rw, 'Mods'));
  add('Project Zomboid mods', path.join(os.homedir(), 'Zomboid', 'mods'));
  add('Terraria resource packs', path.join(os.homedir(), 'Documents', 'My Games', 'Terraria', 'ResourcePacks'));
  add("Baldur's Gate 3 Mods", path.join(process.env.LOCALAPPDATA ?? '', 'Larian Studios', "Baldur's Gate 3", 'Mods'));
  add('Mod Hub vault', path.join(userData, 'vault'));
  add('Mod Hub kept mods', path.join(userData, 'kept-mods'));
  const lower = (p: string) => p.toLowerCase().replace(/[\\/]+$/, '');
  const unique = out.filter((r, i) => out.findIndex((x) => lower(x.dir) === lower(r.dir)) === i);
  return unique.filter((r) => !unique.some((o) => o !== r && lower(r.dir).startsWith(`${lower(o.dir)}\\`)));
}

/** MpCmdRun's report: blocks of "Threat : <name>" followed by "file : <path>" lines. */
export function parseDefenderThreats(output: string): { threat: string; file: string }[] {
  const found: { threat: string; file: string }[] = [];
  let current = '';
  for (const line of output.split(/\r?\n/)) {
    const t = /^\s*Threat\s*:\s*(.+)$/.exec(line);
    if (t) {
      current = t[1].trim();
      continue;
    }
    const f = /^\s*file\s*:\s*(.+)$/i.exec(line);
    if (f && current) found.push({ threat: current, file: f[1].trim().replace(/->.*$/, '').trim() });
  }
  return found;
}

export async function defenderSweep(
  mods: ModRecord[],
  userData: string,
  onProgress?: (done: number, total: number, current: string) => void,
  shouldStop?: () => boolean,
): Promise<DefenderSweep> {
  const roots = modRoots(mods, userData);
  const started = new Date().toISOString();
  const results: DefenderSweep['roots'] = [];
  const threats: DefenderSweep['threats'] = [];
  const owner = (file: string) => {
    const f = file.toLowerCase();
    return mods.find((m) =>
      [m.localPath, ...(m.alternateLocalPaths ?? [])].some((p) => p && (f === p.toLowerCase() || f.startsWith(`${p.toLowerCase()}\\`))),
    );
  };
  for (let i = 0; i < roots.length; i++) {
    if (shouldStop?.()) break;
    onProgress?.(i, roots.length, roots[i].label);
    const t0 = Date.now();
    const r = await defenderScan(roots[i].dir);
    results.push({ ...roots[i], status: r.status, seconds: Math.round((Date.now() - t0) / 1000) });
    if (r.status === 'threat') {
      const found = parseDefenderThreats(r.detail ?? '');
      for (const t of found) {
        const m = owner(t.file);
        threats.push({ ...t, modId: m?.id, modTitle: m?.title });
      }
      if (!found.length) threats.push({ threat: 'Threat reported (see Windows Security)', file: roots[i].dir });
    }
  }
  onProgress?.(roots.length, roots.length, '');
  return { startedAt: started, finishedAt: new Date().toISOString(), roots: results, threats, complete: results.length === roots.length };
}
