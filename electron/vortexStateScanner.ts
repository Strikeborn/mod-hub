import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { ModRecord } from '../shared/types';
import { isGuess404NexusThumb } from './nexusImageIds';
import { setVortexStagingPaths } from './vortexPaths';
import { plainModDescription } from '../shared/plainDescription';

const require = createRequire(import.meta.url);

type ClassicLevelDb = {
  iterator(): AsyncIterable<[string, Buffer]>;
  close(): Promise<void>;
};

type ClassicLevelCtor = new (
  location: string,
  options: { valueEncoding: 'buffer' },
) => ClassicLevelDb;

function openClassicLevel(dbPath: string): ClassicLevelDb {
  const { ClassicLevel } = require('classic-level') as { ClassicLevel: ClassicLevelCtor };
  return new ClassicLevel(dbPath, { valueEncoding: 'buffer' });
}

export type VortexStateModMeta = {
  nexusModId?: number;
  gameId: string;
  stagingFolder?: string;
  pictureUrl?: string;
  author?: string;
  title?: string;
  version?: string;
  homepage?: string;
  downloadFileName?: string;
  sizeBytes?: number;
  installedAt?: string;
  remoteCreatedAt?: string;
  remoteUpdatedAt?: string;
  description?: string;
};

export type VortexStateIndex = {
  /** `gameId|modId` → metadata (download + installed rows). */
  byModId: Map<string, VortexStateModMeta>;
  /** `gameId|normalizedTitle` → metadata (loose fallback). */
  byTitleNorm: Map<string, VortexStateModMeta>;
  /** `gameId|stagingFolderName` → metadata (authoritative for deployed files). */
  byStagingFolder: Map<string, VortexStateModMeta>;
  /** gameId → Vortex staging path (mod install folder). */
  stagingPaths: Map<string, string>;
  /** gameId → discovered game install folder. */
  gamePaths: Map<string, string>;
};

const STATIC_IMG_RE =
  /https?:\/\/staticdelivery\.nexusmods\.com\/mods\/\d+\/images\/[^\s"']+\.(?:png|jpe?g|webp|gif)/gi;

export function emptyVortexStateIndex(): VortexStateIndex {
  return {
    byModId: new Map(),
    byTitleNorm: new Map(),
    byStagingFolder: new Map(),
    stagingPaths: new Map(),
    gamePaths: new Map(),
  };
}

function stateDbPath(): string | undefined {
  const appData = process.env.APPDATA;
  if (!appData) return undefined;
  const p = path.join(appData, 'Vortex', 'state.v2');
  return fs.existsSync(p) ? p : undefined;
}

function parseJsonValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw.replace(/^"|"$/g, '');
  }
}

function asString(val: unknown): string | undefined {
  if (typeof val !== 'string') return undefined;
  const s = val.replace(/^"|"$/g, '').trim();
  return s.length > 0 ? s : undefined;
}

function asNumber(val: unknown): number | undefined {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.(archive|zip|7z|rar)$/i, '')
    .replace(/^[_!#\s]+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseGameField(val: unknown): string | undefined {
  if (Array.isArray(val) && val[0]) return String(val[0]).toLowerCase();
  if (typeof val === 'string') {
    const s = val.replace(/^"|"$/g, '').trim();
    if (s.startsWith('[')) {
      try {
        const arr = JSON.parse(s) as unknown[];
        if (arr[0]) return String(arr[0]).toLowerCase();
      } catch {
        /* ignore */
      }
    }
    if (s) return s.toLowerCase();
  }
  return undefined;
}

function isoFromNexusTime(val: unknown): string | undefined {
  if (val == null) return undefined;
  const n = Number(val);
  if (Number.isFinite(n) && n > 0) {
    const ms = n > 1e11 ? n : n * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime()) || d.getFullYear() < 2005) return undefined;
    return d.toISOString();
  }
  const s = String(val).replace(/^"|"$/g, '');
  const t = Date.parse(s);
  if (!Number.isFinite(t) || t <= 0) return undefined;
  const d = new Date(t);
  if (d.getFullYear() < 2005) return undefined;
  return d.toISOString();
}

function stripHtmlToPlain(html: string): string {
  return plainModDescription(html, 8000) ?? '';
}

function extractNexusImageFromDescription(desc: string): string | undefined {
  const urls = desc.match(STATIC_IMG_RE) ?? [];
  const still = urls.find((u) => /\.(png|jpe?g|webp)$/i.test(u));
  return still ?? urls[0];
}

/** Vortex mod folder / zip names embed Nexus id: `Name-6165-2-0-1-…` or `Name 11772 5.25.0 …`. */
export function parseNexusIdFromVortexModKey(name: string): number | undefined {
  const base = name.replace(/\.(zip|7z|rar|archive)(\.\d+)?$/i, '');
  let m = base.match(/-(\d{3,6})-\d+-[\d.]+-\d{10,}/);
  if (m) return Number(m[1]);
  m = base.match(/(?:^|\s)(\d{4,6})(?:\s+\d[\d.]+|\s+-|\s+\d{4}-\d{2})/);
  if (m) return Number(m[1]);
  m = base.match(/\s(\d{4,6})\s+\d[\d.]+/);
  if (m) return Number(m[1]);
  m = base.match(/[\s-](\d{4,6})[\s-]/);
  if (m) return Number(m[1]);
  return undefined;
}

function metaKey(gameId: string, modId: number): string {
  return `${gameId.toLowerCase()}|${modId}`;
}

function resolveStagingPath(template: string, gameId: string): string {
  const appData = process.env.APPDATA ?? '';
  return template
    .replace(/\{USERDATA\}/gi, path.join(appData, 'Vortex'))
    .replace(/\{game\}/gi, gameId);
}

/**
 * Read Vortex Redux persist DB (`%APPDATA%/Vortex/state.v2`): mod attributes, staging + game paths.
 */
export async function scanVortexStateModMeta(): Promise<VortexStateIndex> {
  const index = emptyVortexStateIndex();
  const dbPath = stateDbPath();
  if (!dbPath) return index;

  const { byModId, byTitleNorm, byStagingFolder, stagingPaths, gamePaths } = index;
  const installPathTemplates = new Map<string, string>();

  const downloadByFile = new Map<
    string,
    {
      gameId?: string;
      modId?: number;
      pictureUrl?: string;
      created?: string;
      updated?: string;
      author?: string;
      title?: string;
      fileName?: string;
      sizeBytes?: number;
    }
  >();

  const db = openClassicLevel(dbPath);
  try {
    for await (const [key, value] of db.iterator()) {
      const parts = String(key).split('###');
      const text = value.toString('utf8');

      if (parts[0] === 'settings') {
        if (parts[1] === 'mods' && parts[2] === 'installPath' && parts[3]) {
          const tpl = asString(parseJsonValue(text));
          if (tpl) installPathTemplates.set(parts[3].toLowerCase(), tpl);
        } else if (
          parts[1] === 'gameMode' &&
          parts[2] === 'discovered' &&
          parts[3] &&
          parts[4] === 'path'
        ) {
          const p = asString(parseJsonValue(text));
          if (p) gamePaths.set(parts[3].toLowerCase(), p);
        }
        continue;
      }

      if (parts[0] !== 'persistent') continue;
      const val = parseJsonValue(text);

      if (parts[1] === 'mods' && parts.length >= 6 && parts[4] === 'attributes') {
        const gameId = parts[2].toLowerCase();
        const stagingFolder = parts[3];
        const attr = parts[5];
        const sk = `${gameId}|${stagingFolder}`;

        let rec = byStagingFolder.get(sk);
        if (!rec) {
          rec = { gameId, stagingFolder };
          byStagingFolder.set(sk, rec);
        }

        switch (attr) {
          case 'modId':
            rec.nexusModId = asNumber(val) ?? rec.nexusModId;
            break;
          case 'pictureUrl': {
            const s = asString(val);
            if (s?.startsWith('http')) rec.pictureUrl = s;
            break;
          }
          case 'modName':
            rec.title = asString(val) ?? rec.title;
            break;
          case 'logicalFileName':
            if (!rec.title) rec.title = asString(val);
            break;
          case 'author':
          case 'uploader':
            rec.author = rec.author ?? asString(val);
            break;
          case 'version':
            rec.version = rec.version ?? asString(val);
            break;
          case 'homepage':
            rec.homepage = rec.homepage ?? asString(val);
            break;
          case 'fileName':
            rec.downloadFileName = rec.downloadFileName ?? asString(val);
            break;
          case 'modSize':
          case 'fileSize':
            rec.sizeBytes = rec.sizeBytes ?? asNumber(val);
            break;
          case 'installTime':
            rec.installedAt = rec.installedAt ?? isoFromNexusTime(val);
            break;
          case 'uploadedTimestamp':
            rec.remoteCreatedAt = rec.remoteCreatedAt ?? isoFromNexusTime(val);
            break;
          case 'updatedTimestamp':
            rec.remoteUpdatedAt = rec.remoteUpdatedAt ?? isoFromNexusTime(val);
            break;
          case 'description':
          case 'shortDescription': {
            const plain = typeof val === 'string' ? stripHtmlToPlain(val) : asString(val);
            if (plain && plain.length > 0) rec.description = rec.description ?? plain;
            break;
          }
          default:
            if (attr.startsWith('descript') && typeof val === 'string') {
              if (!rec.pictureUrl) {
                const img = extractNexusImageFromDescription(val);
                if (img) rec.pictureUrl = img;
              }
              if (!rec.description) {
                const plain = stripHtmlToPlain(val);
                if (plain.length > 0) rec.description = plain;
              }
            }
            break;
        }

        if (!rec.nexusModId) {
          const fromName = parseNexusIdFromVortexModKey(stagingFolder);
          if (fromName) rec.nexusModId = fromName;
        }
        continue;
      }

      if (parts[1] === 'downloads' && parts[2] === 'files' && parts.length >= 5) {
        const fileId = parts[3];
        const bucket = downloadByFile.get(fileId) ?? {};
        const tail = parts.slice(4).join('###');

        if (tail === 'game') {
          bucket.gameId = parseGameField(val) ?? bucket.gameId;
        } else if (tail === 'localPath') {
          bucket.fileName = asString(val) ?? bucket.fileName;
        } else if (tail === 'size') {
          bucket.sizeBytes = asNumber(val) ?? bucket.sizeBytes;
        } else if (tail === 'modInfo###modId' || tail === 'modInfo###nexus###ids###modId') {
          bucket.modId = asNumber(val) ?? bucket.modId;
        } else if (tail === 'modInfo###game') {
          bucket.gameId = parseGameField(val) ?? bucket.gameId;
        } else if (tail === 'modInfo###name') {
          bucket.title = asString(val) ?? bucket.title;
        } else if (tail === 'modInfo###nexus###modInfo###picture_url') {
          bucket.pictureUrl = asString(val) ?? bucket.pictureUrl;
        } else if (tail === 'modInfo###nexus###modInfo###author') {
          bucket.author = asString(val) ?? bucket.author;
        } else if (
          tail === 'modInfo###nexus###modInfo###created_timestamp' ||
          tail === 'modInfo###nexus###modInfo###created_time'
        ) {
          bucket.created = bucket.created ?? isoFromNexusTime(val);
        } else if (
          tail === 'modInfo###nexus###modInfo###updated_timestamp' ||
          tail === 'modInfo###nexus###modInfo###updated_time'
        ) {
          bucket.updated = bucket.updated ?? isoFromNexusTime(val);
        } else if (tail === 'installed###gameId') {
          bucket.gameId = asString(val)?.toLowerCase() ?? bucket.gameId;
        }

        downloadByFile.set(fileId, bucket);
      }
    }
  } finally {
    await db.close();
  }

  for (const [gameId, tpl] of installPathTemplates) {
    stagingPaths.set(gameId, resolveStagingPath(tpl, gameId));
  }
  for (const gameId of byStagingFolder.keys()) {
    const g = gameId.split('|')[0];
    if (!stagingPaths.has(g) && process.env.APPDATA) {
      stagingPaths.set(g, path.join(process.env.APPDATA, 'Vortex', g, 'mods'));
    }
  }

  for (const rec of byStagingFolder.values()) {
    if (rec.nexusModId) {
      const mk = metaKey(rec.gameId, rec.nexusModId);
      const existing = byModId.get(mk);
      if (!existing) byModId.set(mk, rec);
      else mergeMeta(existing, rec);
    }
    for (const label of [rec.title, rec.stagingFolder, rec.downloadFileName]) {
      if (!label) continue;
      const n = normTitle(label);
      if (n.length >= 3) byTitleNorm.set(`${rec.gameId}|${n}`, rec);
    }
  }

  for (const bucket of downloadByFile.values()) {
    if (!bucket.modId || !bucket.gameId) continue;
    const mk = metaKey(bucket.gameId, bucket.modId);
    const rec: VortexStateModMeta = byModId.get(mk) ?? {
      gameId: bucket.gameId,
      nexusModId: bucket.modId,
    };
    rec.pictureUrl = rec.pictureUrl ?? bucket.pictureUrl;
    rec.author = rec.author ?? bucket.author;
    rec.title = rec.title ?? bucket.title;
    rec.remoteCreatedAt = rec.remoteCreatedAt ?? bucket.created;
    rec.remoteUpdatedAt = rec.remoteUpdatedAt ?? bucket.updated;
    rec.downloadFileName = rec.downloadFileName ?? bucket.fileName;
    rec.sizeBytes = rec.sizeBytes ?? bucket.sizeBytes;
    byModId.set(mk, rec);

    for (const label of [bucket.title, bucket.fileName]) {
      if (!label) continue;
      const n = normTitle(label);
      if (n.length >= 3 && !byTitleNorm.has(`${rec.gameId}|${n}`)) {
        byTitleNorm.set(`${rec.gameId}|${n}`, rec);
      }
    }
  }

  setVortexStagingPaths(stagingPaths);
  return index;
}

function mergeMeta(target: VortexStateModMeta, src: VortexStateModMeta): void {
  target.pictureUrl = target.pictureUrl ?? src.pictureUrl;
  target.author = target.author ?? src.author;
  target.title = target.title ?? src.title;
  target.version = target.version ?? src.version;
  target.homepage = target.homepage ?? src.homepage;
  target.downloadFileName = target.downloadFileName ?? src.downloadFileName;
  target.remoteCreatedAt = target.remoteCreatedAt ?? src.remoteCreatedAt;
  target.remoteUpdatedAt = target.remoteUpdatedAt ?? src.remoteUpdatedAt;
  target.description = target.description ?? src.description;
}

export function applyStateMetaToMod(m: ModRecord, hit: VortexStateModMeta): boolean {
  let touched = false;

  if (hit.nexusModId && !m.nexusModId) {
    m.nexusModId = hit.nexusModId;
    m.nexusGameDomain = m.nexusGameDomain ?? hit.gameId;
    if (m.source === 'local' || m.source === 'unknown') m.source = 'nexus';
    touched = true;
  }
  if (hit.pictureUrl && !isGuess404NexusThumb(hit.pictureUrl)) {
    if (!m.previewPath && (!m.remotePreviewUrl || isGuess404NexusThumb(m.remotePreviewUrl))) {
      m.remotePreviewUrl = hit.pictureUrl;
      touched = true;
    }
  }
  if (hit.author && !m.author) {
    m.author = hit.author;
    touched = true;
  }
  if (hit.title && (m.title.length < 4 || /^[_!#\d]/.test(m.title) || /\.archive$/i.test(m.title))) {
    m.title = hit.title;
    touched = true;
  }
  if (hit.version && !m.version) {
    m.version = hit.version;
    touched = true;
  }
  if (hit.remoteCreatedAt && !m.remoteCreatedAt) {
    m.remoteCreatedAt = hit.remoteCreatedAt;
    touched = true;
  }
  if (hit.remoteUpdatedAt && !m.remoteUpdatedAt) {
    m.remoteUpdatedAt = hit.remoteUpdatedAt;
    touched = true;
  }
  if (hit.description && !m.description) {
    m.description = hit.description;
    touched = true;
  }
  return touched;
}

/** Fallback matching by Nexus id / title when the deployment manifest has no entry. */
export function applyVortexStateToMods(mods: ModRecord[], stateIndex: VortexStateIndex): number {
  let applied = 0;
  for (const m of mods) {
    let modId = m.nexusModId;
    const gameKey = (m.nexusGameDomain ?? m.gameId).toLowerCase();

    if (!modId) {
      const fromPath = parseNexusIdFromVortexModKey(path.basename(m.localPath));
      if (fromPath) modId = fromPath;
    }

    let hit: VortexStateModMeta | undefined;
    if (modId) hit = stateIndex.byModId.get(metaKey(gameKey, modId));
    if (!hit) {
      const n = normTitle(m.title);
      if (n.length >= 3) hit = stateIndex.byTitleNorm.get(`${gameKey}|${n}`);
    }
    if (!hit) {
      const loose = normTitle(path.basename(m.localPath));
      if (loose.length >= 3) hit = stateIndex.byTitleNorm.get(`${gameKey}|${loose}`);
    }

    if (!hit) continue;
    if (applyStateMetaToMod(m, hit)) applied += 1;
  }
  return applied;
}
