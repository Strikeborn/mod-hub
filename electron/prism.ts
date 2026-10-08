import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { EnableResult } from './loadOrderWrite';
import type { GameLoadOrder, ModRecord } from '../shared/types';
import { stableIdFromParts } from './scanHelpers';

/**
 * Prism Launcher (Minecraft): instances in %APPDATA%\PrismLauncher\instances (or the configured InstanceDir).
 * Each instance: instance.cfg (name), mmc-pack.json (Minecraft version + mod loader), minecraft\mods\*.jar
 * (disabled = *.jar.disabled), and mods\.index\*.pw.toml written by Prism's mod downloader (Modrinth/CurseForge
 * ids). Mod Hub lists those mods, switches them on/off the way Prism does (renaming), launches an instance,
 * and checks Modrinth for updates by file hash (no account needed).
 */

export type PrismInstance = { id: string; name: string; dir: string; gameDir: string; mcVersion?: string; loader?: string };

export function prismRoot(): string {
  return path.join(process.env.APPDATA ?? '', 'PrismLauncher');
}

export function prismExe(): string | undefined {
  const candidates = [
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'PrismLauncher', 'prismlauncher.exe'),
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PrismLauncher', 'prismlauncher.exe'),
    path.join(prismRoot(), 'prismlauncher.exe'),
  ];
  return candidates.find((c) => fs.existsSync(c));
}

const LOADERS: Record<string, string> = {
  'net.fabricmc.fabric-loader': 'fabric',
  'org.quiltmc.quilt-loader': 'quilt',
  'net.neoforged': 'neoforge',
  'net.minecraftforge': 'forge',
};

export function findPrismInstances(): PrismInstance[] {
  const root = prismRoot();
  let dir = path.join(root, 'instances');
  try {
    const cfg = fs.readFileSync(path.join(root, 'prismlauncher.cfg'), 'utf8');
    const v = /^InstanceDir=(.*)$/m.exec(cfg)?.[1]?.trim();
    if (v) dir = path.isAbsolute(v) ? v : path.join(root, v);
  } catch {
    /* defaults */
  }
  if (!fs.existsSync(dir)) return [];
  const out: PrismInstance[] = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const inst = path.join(dir, d.name);
    let cfg = '';
    try {
      cfg = fs.readFileSync(path.join(inst, 'instance.cfg'), 'utf8');
    } catch {
      continue;
    }
    const name = /^name=(.*)$/m.exec(cfg)?.[1]?.trim() || d.name;
    let mcVersion: string | undefined;
    let loader: string | undefined;
    try {
      const pack = JSON.parse(fs.readFileSync(path.join(inst, 'mmc-pack.json'), 'utf8')) as { components?: { uid: string; version?: string }[] };
      for (const c of pack.components ?? []) {
        if (c.uid === 'net.minecraft') mcVersion = c.version;
        if (LOADERS[c.uid]) loader = LOADERS[c.uid];
      }
    } catch {
      /* no pack file */
    }
    const gameDir = [path.join(inst, 'minecraft'), path.join(inst, '.minecraft')].find((g) => fs.existsSync(g)) ?? path.join(inst, 'minecraft');
    out.push({ id: d.name, name, dir: inst, gameDir, mcVersion, loader });
  }
  return out;
}

// ---------- jar metadata ----------

/** Read one file out of a zip/jar (central directory + deflate). */
export function readZipEntry(file: string, wanted: (name: string) => boolean): { name: string; data: Buffer } | null {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (wanted(name)) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + csize);
      return { name, data: method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw) };
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

type JarMeta = { modId?: string; name?: string; version?: string; authors?: string; description?: string };

const tomlValue = (text: string, key: string) => new RegExp(`^\\s*${key}\\s*=\\s*(?:"""([\\s\\S]*?)"""|"([^"]*)"|'([^']*)')`, 'm').exec(text)?.slice(1).find((x) => x != null);

/** fabric.mod.json / quilt.mod.json / (neo)forge mods.toml → id, name, version, authors. */
export function jarMetadata(file: string): JarMeta {
  try {
    const entry = readZipEntry(file, (n) => /^(fabric\.mod\.json|quilt\.mod\.json|META-INF\/(neoforge\.)?mods\.toml)$/.test(n));
    if (!entry) return {};
    const text = entry.data.toString('utf8');
    if (entry.name.endsWith('.json')) {
      // Some mods put raw newlines/tabs inside JSON strings; Minecraft's loader tolerates it, JSON.parse doesn't.
      // oxlint-disable-next-line no-control-regex
      const j = JSON.parse(text.replace(/[\u0000-\u001f]+/g, ' ')) as Record<string, unknown>;
      const q = (j.quilt_loader ?? {}) as Record<string, unknown>;
      const meta = (q.metadata ?? {}) as Record<string, unknown>;
      const authorsRaw = (j.authors ?? meta.contributors ?? []) as unknown;
      const authors = Array.isArray(authorsRaw)
        ? authorsRaw.map((a) => (typeof a === 'string' ? a : (a as { name?: string }).name)).filter(Boolean).join(', ')
        : typeof authorsRaw === 'object' && authorsRaw
          ? Object.keys(authorsRaw).join(', ')
          : undefined;
      return {
        modId: (j.id ?? q.id) as string | undefined,
        name: (j.name ?? meta.name) as string | undefined,
        version: (j.version ?? q.version) as string | undefined,
        authors: authors || undefined,
        description: (j.description ?? meta.description) as string | undefined,
      };
    }
    const mods = text.split(/^\s*\[\[mods\]\]\s*$/m)[1] ?? text;
    let version = tomlValue(mods, 'version');
    if (version === '${file.jarVersion}') {
      version = /^Implementation-Version:\s*(.+)$/m.exec(readZipEntry(file, (n) => n === 'META-INF/MANIFEST.MF')?.data.toString('utf8') ?? '')?.[1]?.trim();
    }
    return { modId: tomlValue(mods, 'modId'), name: tomlValue(mods, 'displayName'), version, authors: tomlValue(mods, 'authors') ?? tomlValue(text, 'authors'), description: tomlValue(mods, 'description')?.trim() };
  } catch {
    return {};
  }
}

type IndexEntry = { name?: string; filename?: string; modrinthId?: string; modrinthVersion?: string; curseforgeId?: string; sha1?: string };

/** Prism's mods\.index\*.pw.toml (packwiz format). */
export function readPrismIndex(modsDir: string): Map<string, IndexEntry> {
  const out = new Map<string, IndexEntry>();
  const dir = path.join(modsDir, '.index');
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.pw.toml'))) {
    try {
      const t = fs.readFileSync(path.join(dir, f), 'utf8');
      const section = (name: string) => new RegExp(`^\\[${name.replace('.', '\\.')}\\]([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))`, 'm').exec(t)?.[1] ?? '';
      const e: IndexEntry = {
        name: tomlValue(t, 'name'),
        filename: tomlValue(t, 'filename'),
        modrinthId: tomlValue(section('update.modrinth'), 'mod-id'),
        modrinthVersion: tomlValue(section('update.modrinth'), 'version'),
        curseforgeId: /project-id\s*=\s*(\d+)/.exec(section('update.curseforge'))?.[1],
      };
      const dl = section('download');
      if (tomlValue(dl, 'hash-format') === 'sha1') e.sha1 = tomlValue(dl, 'hash');
      if (e.filename) out.set(e.filename.toLowerCase(), e);
    } catch {
      /* skip */
    }
  }
  return out;
}

function sha1(file: string): string {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

/** Every mod jar in every Prism instance. */
export function scanPrismMods(addMod: (m: ModRecord, label?: string, root?: string) => void): number {
  let added = 0;
  for (const inst of findPrismInstances()) {
    const modsDir = path.join(inst.gameDir, 'mods');
    if (!fs.existsSync(modsDir)) continue;
    const index = readPrismIndex(modsDir);
    for (const f of fs.readdirSync(modsDir)) {
      if (!/\.jar(\.disabled)?$/i.test(f)) continue;
      const file = path.join(modsDir, f);
      const enabled = !/\.disabled$/i.test(f);
      const base = f.replace(/\.disabled$/i, '');
      const meta = jarMetadata(file);
      const idx = index.get(base.toLowerCase());
      const st = fs.statSync(file);
      addMod(
        {
          id: stableIdFromParts(['prism', inst.dir.toLowerCase(), base.toLowerCase()]),
          source: 'local',
          gameId: 'minecraft',
          title: idx?.name ?? meta.name ?? base.replace(/\.jar$/i, ''),
          version: meta.version,
          author: meta.authors,
          description: meta.description,
          localPath: file,
          sizeBytes: st.size,
          installedAt: st.mtime.toISOString(),
          lastSeenAt: new Date().toISOString(),
          favorited: false,
          revision: { kind: 'folder_mtime', value: String(Math.floor(st.mtimeMs / 1000)) },
          tags: ['prism'],
          modIds: meta.modId ? [meta.modId] : undefined,
          prism: {
            instance: inst.id,
            instanceName: inst.name,
            file: base,
            enabled,
            loader: inst.loader,
            mcVersion: inst.mcVersion,
            modrinthId: idx?.modrinthId,
            curseforgeId: idx?.curseforgeId,
            sha1: idx?.sha1 ?? sha1(file),
          },
        },
        `Prism Launcher (${inst.name})`,
        modsDir,
      );
      added += 1;
    }
  }
  return added;
}

/** The instance ▶ Play will start: the remembered one, else the first. */
export function chosenInstance(choice?: { optionId: string; profile?: string }): PrismInstance | undefined {
  const all = findPrismInstances();
  return all.find((i) => i.name === choice?.profile || i.id === choice?.profile) ?? all[0];
}

/** On/off per mod for the chosen instance (Prism has no load order: mods load together). */
export function prismLoadOrder(mods: ModRecord[], choice?: { optionId: string; profile?: string }): GameLoadOrder | null {
  const inst = chosenInstance(choice);
  if (!inst) return null;
  const modsDir = path.join(inst.gameDir, 'mods');
  const out: GameLoadOrder = {
    gameId: 'minecraft',
    sourceLabel: `Prism instance “${inst.name}”${inst.loader ? ` (${inst.loader}, ${inst.mcVersion ?? '?'})` : ` (vanilla ${inst.mcVersion ?? ''})`}`,
    sourcePath: modsDir,
    orderKind: 'folder-name',
    mods: {},
    enabledCount: 0,
    unmatched: [],
    readAt: new Date().toISOString(),
  };
  for (const m of mods) {
    if (m.gameId !== 'minecraft' || m.prism?.instance !== inst.id) continue;
    const on = fs.existsSync(path.join(modsDir, m.prism.file));
    out.mods[m.id] = { enabled: on, note: m.prism.modrinthId ? 'Modrinth' : m.prism.curseforgeId ? 'CurseForge' : undefined };
    if (on) out.enabledCount += 1;
  }
  return out;
}

/** Prism's own way: "Mod.jar" ↔ "Mod.jar.disabled". */
export function setPrismModsEnabled(mods: ModRecord[], enabled: boolean, running: boolean): EnableResult {
  if (running) return { ok: false, message: 'Minecraft is running. Close it first.', changed: 0 };
  let changed = 0;
  const inst = new Map(findPrismInstances().map((i) => [i.id, i]));
  try {
    for (const m of mods) {
      const i = m.prism && inst.get(m.prism.instance);
      if (!i || !m.prism) continue;
      const on = path.join(i.gameDir, 'mods', m.prism.file);
      const off = `${on}.disabled`;
      if (enabled && fs.existsSync(off) && !fs.existsSync(on)) {
        fs.renameSync(off, on);
        changed += 1;
      } else if (!enabled && fs.existsSync(on) && !fs.existsSync(off)) {
        fs.renameSync(on, off);
        changed += 1;
      }
    }
    return { ok: true, message: changed ? `${enabled ? 'Enabled' : 'Disabled'} ${changed} mod(s) in Prism.` : 'Nothing to change.', changed };
  } catch (e) {
    return { ok: false, message: `Couldn't rename: ${e instanceof Error ? e.message : String(e)}`, changed };
  }
}

/** Modrinth: newest compatible version for each installed file (by SHA-1). Marks rows that have an update. */
export async function checkModrinthUpdates(mods: ModRecord[]): Promise<number> {
  const insts = new Map(findPrismInstances().map((i) => [i.id, i]));
  const groups = new Map<string, ModRecord[]>();
  for (const m of mods) {
    if (m.gameId !== 'minecraft' || !m.prism?.sha1) continue;
    const i = insts.get(m.prism.instance);
    const key = `${i?.loader ?? ''}|${i?.mcVersion ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  let found = 0;
  for (const [key, list] of groups) {
    const [loader, mc] = key.split('|');
    const res = await fetch('https://api.modrinth.com/v2/version_files/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Strikeborn/mod-hub (github.com/Strikeborn/mod-hub)' },
      body: JSON.stringify({ hashes: list.map((m) => m.prism!.sha1), algorithm: 'sha1', loaders: loader ? [loader] : [], game_versions: mc ? [mc] : [] }),
    });
    if (!res.ok) continue;
    const latest = (await res.json()) as Record<string, { version_number: string; project_id: string; date_published: string; files: { hashes: { sha1: string } }[] }>;
    for (const m of list) {
      const v = latest[m.prism!.sha1!];
      if (!v) continue;
      m.prism!.modrinthId ??= v.project_id;
      const newer = !v.files.some((f) => f.hashes.sha1 === m.prism!.sha1);
      m.prism!.latestVersion = newer ? v.version_number : undefined;
      m.revision = { ...m.revision, updateAvailable: newer };
      if (newer) found += 1;
    }
  }
  return found;
}
