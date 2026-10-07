import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ModRecord } from '../shared/types';
import { discoverSteamLibraries } from './steamDiscovery';

export type SteamItemResult = { id: string; ok: boolean; error?: string; folder?: string; timestamp?: number };

/**
 * Run the Steam helper (steamworks.js in a short-lived child process) for one app and many items.
 * `download` subscribes if needed, forces Steam to fetch the newest version and waits for it.
 */
export function runSteamWorkshopBatch(
  helperPath: string,
  action: 'subscribe' | 'unsubscribe' | 'download',
  appId: number,
  workshopIds: string[],
  onItem?: (r: SteamItemResult) => void,
): Promise<Map<string, SteamItemResult>> {
  return new Promise((resolve) => {
    const results = new Map<string, SteamItemResult>();
    const fail = (error: string) => {
      for (const id of workshopIds) if (!results.has(id)) results.set(id, { id, ok: false, error });
      resolve(results);
    };
    if (!fs.existsSync(helperPath)) return fail(`helper missing: ${helperPath}`);
    const child = spawn(process.execPath, [helperPath, action, String(appId), ...workshopIds], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      cwd: path.dirname(path.dirname(helperPath)),
      windowsHide: true,
    });
    let buf = '';
    let err = '';
    child.stdout.on('data', (d) => {
      buf += String(d);
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('{')) continue;
        try {
          const r = JSON.parse(line) as SteamItemResult;
          results.set(String(r.id), r);
          onItem?.(r);
        } catch {
          /* ignore */
        }
      }
    });
    child.stderr.on('data', (d) => (err += String(d)));
    const perItem = action === 'download' ? 10 * 60_000 : 25_000;
    const timer = setTimeout(() => child.kill(), 30_000 + perItem * workshopIds.length);
    child.on('close', () => {
      clearTimeout(timer);
      if (results.size < workshopIds.length) return fail((err || 'Steam helper stopped early').trim().slice(0, 300));
      resolve(results);
    });
  });
}

/** Back-compat single-item wrapper. */
export async function runSteamWorkshopAction(
  helperPath: string,
  action: 'subscribe' | 'unsubscribe',
  appId: number,
  workshopId: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = (await runSteamWorkshopBatch(helperPath, action, appId, [workshopId])).get(workshopId);
  return r ? { ok: r.ok, error: r.error } : { ok: false, error: 'no result' };
}

export function steamGameDir(installDirName: string): string | undefined {
  for (const lib of discoverSteamLibraries()) {
    const p = path.join(lib, 'steamapps', 'common', installDirName);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function uniqueDest(dest: string): string {
  if (!fs.existsSync(dest)) return dest;
  for (let i = 2; i < 100; i++) {
    const alt = `${dest} (kept ${i})`;
    if (!fs.existsSync(alt)) return alt;
  }
  return `${dest} (kept ${Date.now()})`;
}

/** Id for a kept local copy; distinct from the Workshop row's id so both can exist (e.g. after re-subscribing). */
export function keptModId(appId: number, workshopId: string): string {
  return `kept-${appId}-${workshopId}`;
}

export type KeepOptions = {
  /** Replace an existing kept copy (update); the old one is moved to kept-mods/_previous. */
  replace?: boolean;
  /** Copy from here instead of mod.localPath (e.g. freshly downloaded Workshop folder). */
  source?: string;
};

export type KeepResult = { ok: boolean; keptPath?: string; keptPaths?: string[]; note: string };

/** Where "Copy & keep" puts a game's mods, for the confirm dialog. */
export function keepDestinationLabel(gameId: string): string {
  switch (gameId) {
    case 'project-zomboid':
      return 'Zomboid\\mods (game loads them)';
    case 'rimworld':
      return 'RimWorld\\Mods (game loads them)';
    case 'binding-of-isaac':
      return 'Isaac\\mods as local mods (game loads them)';
    case 'terraria':
      return 'Terraria\\ResourcePacks (enable it in-game)';
    default:
      return "Mod Hub's kept-mods folder (backup only — the game won't load it)";
  }
}

async function placeCopy(src: string, dest: string, keptRoot: string, mod: ModRecord, replace: boolean): Promise<string> {
  if (fs.existsSync(dest)) {
    if (!replace) dest = uniqueDest(dest);
    else {
      const backup = path.join(keptRoot, '_previous', mod.gameId, `${path.basename(dest)}-${Date.now()}`);
      await fs.promises.mkdir(path.dirname(backup), { recursive: true });
      try {
        await fs.promises.rename(dest, backup);
      } catch {
        // Different drive: copy then remove.
        await fs.promises.cp(dest, backup, { recursive: true });
        await fs.promises.rm(dest, { recursive: true, force: true });
      }
    }
  }
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  // Async copy so big mods don't freeze the app.
  await fs.promises.cp(src, dest, { recursive: true });
  return dest;
}

/**
 * Copy a Workshop item somewhere Steam won't touch.
 * Project Zomboid / RimWorld / Isaac / Terraria: into the game's own local mods folder (the game still loads it).
 * Everything else: Mod Hub's kept-mods archive.
 */
export async function keepWorkshopCopy(mod: ModRecord, keptRoot: string, opts: KeepOptions = {}): Promise<KeepResult> {
  const src = opts.source ?? mod.localPath;
  const replace = Boolean(opts.replace);
  if (!src || !fs.existsSync(src)) return { ok: false, note: `Workshop folder not found: ${src}` };
  const id = mod.workshopId ?? path.basename(src);
  try {
    if (mod.gameId === 'project-zomboid') {
      const modsDir = path.join(src, 'mods');
      const target = path.join(os.homedir(), 'Zomboid', 'mods');
      if (fs.existsSync(modsDir)) {
        const copied: string[] = [];
        for (const d of fs.readdirSync(modsDir, { withFileTypes: true })) {
          if (d.isDirectory()) copied.push(await placeCopy(path.join(modsDir, d.name), path.join(target, d.name), keptRoot, mod, replace));
        }
        if (copied.length) {
          return { ok: true, keptPath: copied[0], keptPaths: copied, note: `Copied ${copied.length} mod folder(s) to ${target}.` };
        }
      }
    }
    if (mod.gameId === 'rimworld') {
      const game = steamGameDir('RimWorld');
      if (game) {
        const dest = await placeCopy(src, path.join(game, 'Mods', id), keptRoot, mod, replace);
        return { ok: true, keptPath: dest, keptPaths: [dest], note: `Copied to ${dest}.` };
      }
    }
    if (mod.gameId === 'binding-of-isaac') {
      const game = steamGameDir('The Binding of Isaac Rebirth');
      if (game) {
        const modsDir = path.join(game, 'mods');
        // Prefer the game's own copy (keeps the enabled/disabled state) unless updating from a fresh download.
        const gameCopy = fs.existsSync(modsDir) ? fs.readdirSync(modsDir).find((d) => d.endsWith(`_${id}`)) : undefined;
        const from = !opts.source && gameCopy ? path.join(modsDir, gameCopy) : src;
        const name = (gameCopy ?? path.basename(src)).replace(new RegExp(`_${id}$`), '') || id;
        const dest = await placeCopy(from, path.join(modsDir, `${name} (kept)`), keptRoot, mod, replace);
        const meta = path.join(dest, 'metadata.xml');
        if (fs.existsSync(meta)) {
          // Without a Workshop id Isaac treats it as a local mod and Steam sync leaves it alone.
          await fs.promises.writeFile(meta, (await fs.promises.readFile(meta, 'utf8')).replace(/\s*<id>\d+<\/id>/, ''), 'utf8');
        }
        return { ok: true, keptPath: dest, keptPaths: [dest], note: `Copied to ${dest} as a local mod.` };
      }
    }
    if (mod.gameId === 'terraria') {
      const docs = [path.join(os.homedir(), 'Documents'), path.join(os.homedir(), 'OneDrive', 'Documents')].find((d) =>
        fs.existsSync(path.join(d, 'My Games', 'Terraria')),
      );
      if (docs) {
        const packs = path.join(docs, 'My Games', 'Terraria', 'ResourcePacks');
        const dest = await placeCopy(src, path.join(packs, `${id} (kept)`), keptRoot, mod, replace);
        return { ok: true, keptPath: dest, keptPaths: [dest], note: `Copied to ${dest} as a local resource pack (enable it in-game).` };
      }
    }
    const dest = await placeCopy(src, path.join(keptRoot, mod.gameId, id), keptRoot, mod, replace);
    return { ok: true, keptPath: dest, keptPaths: [dest], note: `Copied to Mod Hub's kept mods: ${dest}` };
  } catch (e) {
    return { ok: false, note: `Copy failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
