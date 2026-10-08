import fs from 'node:fs';
import path from 'node:path';
import type { ModRecord } from '../shared/types';
import { backup, isRunning } from './loadOrderWrite';
import { findMo2Instances } from './mo2';
import { readManifest } from './vortexDeployment';

/**
 * Copy the mods Vortex deploys for a game into its MO2 instance, so MO2 profiles control everything.
 * Copies (never moves) each Vortex staging folder into MO2's mods folder with a meta.ini (Nexus id + version),
 * adds it to every profile's modlist.txt (on in the chosen profile, off in the others), and leaves Vortex as it
 * is. After checking the game in MO2, the user purges the game in Vortex. Mods Vortex puts in the game's root
 * folder (e.g. Engine Fixes' d3dx9_42.dll) can't run from MO2 without Root Builder, so they're listed, not copied.
 */

export type MigrationItem = {
  modId?: string;
  title: string;
  stagingFolder: string;
  from: string;
  to: string;
  bytes: number;
  files: number;
  status: 'copy' | 'exists' | 'root-files';
};

export type MigrationPlan = { ok: boolean; message: string; instance?: string; profile?: string; items: MigrationItem[] };

/** "CBPC - Fomod installer - MAIN FILE 21224 1.7.2 2026-08-30T23-48Z kATsMWw0A" → "CBPC - Fomod installer - MAIN FILE". */
export function cleanModName(title: string): string {
  const t = title
    .replace(/\s+\d{3,7}\s+\S+\s+\d{4}-\d{2}-\d{2}T[\d-]+Z\s+\S+$/, '')
    .replace(/-\d{3,7}(-[\w]+)*-\d{9,}$/, '')
    .replace(/[<>:"/\\|?*]/g, '')
    .trim();
  return t || title.replace(/[<>:"/\\|?*]/g, '').trim();
}

function folderStats(dir: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        bytes += fs.statSync(p).size;
        files += 1;
      }
    }
  };
  try {
    walk(dir);
  } catch {
    /* unreadable */
  }
  return { bytes, files };
}

export function planVortexToMo2(gameId: string, mods: ModRecord[], profile?: string): MigrationPlan {
  const inst = findMo2Instances().find((i) => i.gameId === gameId);
  if (!inst) return { ok: false, message: 'No Mod Organizer 2 instance for this game.', items: [] };
  const staging = [...new Set(mods.filter((m) => m.gameId === gameId && m.localPath && /vortex/i.test(m.localPath)).map((m) => path.dirname(m.localPath)))].find(
    (d) => fs.existsSync(path.join(d, 'vortex.deployment.msgpack')) || fs.existsSync(path.join(d, 'vortex.deployment.json')),
  );
  if (!staging) return { ok: false, message: "Couldn't find Vortex's staging folder for this game.", items: [] };
  const deployed = new Set((readManifest(staging)?.files ?? []).map((f) => f.source).filter((s): s is string => Boolean(s)));
  const rootOnly = new Set((readManifest(staging, 'dinput')?.files ?? []).map((f) => f.source).filter((s): s is string => Boolean(s)));
  const items: MigrationItem[] = [];
  for (const folder of [...new Set([...deployed, ...rootOnly])].sort()) {
    const from = path.join(staging, folder);
    const row = mods.find((m) => m.gameId === gameId && m.localPath && path.basename(m.localPath) === folder);
    const name = cleanModName(row?.title ?? folder);
    const to = path.join(inst.modsDir, name);
    const st = folderStats(from);
    items.push({
      modId: row?.id,
      title: name,
      stagingFolder: folder,
      from,
      to,
      ...st,
      status: rootOnly.has(folder) && !deployed.has(folder) ? 'root-files' : fs.existsSync(to) ? 'exists' : 'copy',
    });
  }
  const p = profile && inst.profiles.includes(profile) ? profile : (inst.selectedProfile ?? inst.profiles[0]);
  return { ok: true, message: `${items.filter((i) => i.status === 'copy').length} mod(s) to copy into MO2.`, instance: inst.root, profile: p, items };
}

/** Do the copy. MO2 must be closed (it rewrites modlist.txt on exit). */
export function migrateVortexToMo2(gameId: string, mods: ModRecord[], profile?: string): MigrationPlan {
  const plan = planVortexToMo2(gameId, mods, profile);
  if (!plan.ok) return plan;
  if (isRunning('ModOrganizer.exe')) return { ...plan, ok: false, message: 'Close Mod Organizer 2 first.' };
  const inst = findMo2Instances().find((i) => i.root === plan.instance)!;
  const copied: MigrationItem[] = [];
  try {
    for (const it of plan.items.filter((i) => i.status === 'copy')) {
      fs.cpSync(it.from, it.to, { recursive: true, errorOnExist: true, force: false });
      const row = mods.find((m) => m.id === it.modId);
      const meta = [
        '[General]',
        `gameName=${inst.gameName.replace(/\s+/g, '')}`,
        `modid=${row?.nexusModId ?? 0}`,
        `version=${row?.version ?? ''}`,
        'repository=Nexus',
        `comments=Copied from Vortex by Mod Hub (${new Date().toISOString().slice(0, 10)})`,
        '',
      ].join('\r\n');
      fs.writeFileSync(path.join(it.to, 'meta.ini'), meta, 'utf8');
      copied.push(it);
    }
    for (const p of inst.profiles) {
      const file = path.join(inst.root, 'profiles', p, 'modlist.txt');
      if (!fs.existsSync(file)) continue;
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
      const header = lines[0]?.startsWith('#') ? [lines.shift()!] : [];
      const have = new Set(lines.map((l) => l.slice(1).toLowerCase()));
      // modlist.txt: first line = highest priority, so new mods go on top (they override the base game files).
      const added = copied.filter((c) => !have.has(c.title.toLowerCase())).map((c) => `${p === plan.profile ? '+' : '-'}${c.title}`);
      if (!added.length) continue;
      backup(gameId, file);
      fs.writeFileSync(file, [...header, ...added, ...lines].join('\r\n') + '\r\n', 'utf8');
    }
  } catch (e) {
    return { ...plan, ok: false, message: `Stopped after ${copied.length} mod(s): ${e instanceof Error ? e.message : String(e)}` };
  }
  const root = plan.items.filter((i) => i.status === 'root-files').map((i) => i.title);
  return {
    ...plan,
    message:
      `Copied ${copied.length} mod(s) into MO2 (on in “${plan.profile}”, off in other profiles). Vortex is unchanged: check the game through MO2, then purge Skyrim in Vortex.` +
      (root.length ? ` Not copied (game-root files MO2 can't place without Root Builder): ${root.join(', ')}.` : ''),
  };
}
