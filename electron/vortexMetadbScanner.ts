import fs from 'node:fs';
import path from 'node:path';
import { vaultPathFor } from './archiveVault';
import { createRequire } from 'node:module';
import type { ModRecord } from '../shared/types';

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
import { gameIdFromVortexFolder } from './gamePathMap';
import { stableIdFromParts } from './scanHelpers';
import { normalizeArchiveDeployKey } from './vortexDownloadArchiveIndex';

type MetadbRow = {
  fileName?: string;
  logicalFileName?: string;
  fileVersion?: string;
  gameId?: string;
  domainName?: string;
  sourceURI?: string;
  source?: string;
  archived?: boolean;
  details?: {
    author?: string;
    description?: string;
    category?: string;
    picture?: string;
  };
};

const GAME_SUFFIX_RE = /:([a-z0-9_-]+):$/i;
const NXM_MOD_RE = /\/mods\/(\d+)\//i;
const IMG_BB_RE = /\[img\](https?:\/\/[^\[]+\.(?:png|jpg|jpeg|webp))(?:\[[^\]]*\])?\[\/img\]/i;
const IMG_PLAIN_RE = /(https?:\/\/staticdelivery\.nexusmods\.com\/mods\/\d+\/images\/[^\s"']+\.(?:png|jpg|jpeg|webp))/i;

function parseNexusModIdFromFileName(fileName: string): number | undefined {
  const base = fileName.replace(/\.(zip|rar|7z|7z\.\d+)$/i, '');
  let m = base.match(/-(\d{3,6})-\d+-[\d.]+-\d{10,}$/);
  if (m) return Number(m[1]);
  m = base.match(/\s(\d{4,6})\s+\d[\d.]+(?:\s|$)/);
  if (m) return Number(m[1]);
  m = base.match(/[\s-](\d{4,6})[\s-]/);
  if (m) return Number(m[1]);
  return undefined;
}

function pictureFromRow(row: MetadbRow, nexusModId?: number): string | undefined {
  const d = row.details;
  if (d?.picture && /^https?:\/\//i.test(d.picture)) return d.picture;
  const desc = d?.description ?? '';
  const bb = desc.match(IMG_BB_RE);
  if (bb) return bb[1];
  const plain = desc.match(IMG_PLAIN_RE);
  if (plain) return plain[1];
  return undefined;
}

function resolveDownloadPath(gameFolder: string, fileName: string): string {
  const appData = process.env.APPDATA;
  if (!appData) return path.join('downloads', gameFolder, fileName);
  return path.join(appData, 'Vortex', 'downloads', gameFolder, fileName);
}

export async function scanVortexMetadb(
  addMod: (m: ModRecord, locationLabel?: string, locationRoot?: string) => void,
  onProgress?: (current: number, total: number) => void,
): Promise<number> {
  const appData = process.env.APPDATA;
  if (!appData) return 0;
  const dbPath = path.join(appData, 'Vortex', 'metadb');
  if (!fs.existsSync(dbPath)) return 0;

  const db = openClassicLevel(dbPath);
  let count = 0;
  let scanned = 0;
  try {
    for await (const [key, value] of db.iterator()) {
      scanned += 1;
      if (scanned % 500 === 0) onProgress?.(scanned, scanned);
      const ks = String(key);
      if (!ks.startsWith('hash:')) continue;
      const gameMatch = ks.match(GAME_SUFFIX_RE);
      const gameFolder = gameMatch?.[1];
      if (!gameFolder || gameFolder === 'site') continue;

      let rows: MetadbRow[];
      try {
        const text = value.toString('utf8');
        rows = JSON.parse(text) as MetadbRow[];
      } catch {
        continue;
      }
      const row = rows[0];
      if (!row?.fileName) continue;

      const nexusModId =
        (row.sourceURI?.match(NXM_MOD_RE) ? Number(row.sourceURI.match(NXM_MOD_RE)![1]) : undefined) ??
        parseNexusModIdFromFileName(row.fileName);
      const domain = (row.domainName ?? gameFolder).toLowerCase();
      const gameId = gameIdFromVortexFolder(gameFolder);
      let localPath = resolveDownloadPath(gameFolder, row.fileName);
      let exists = fs.existsSync(localPath);
      let fromVault = false;
      if (!exists) {
        const vaulted = vaultPathFor(gameFolder, row.fileName);
        if (fs.existsSync(vaulted)) {
          localPath = vaulted;
          exists = true;
          fromVault = true;
        }
      }
      const title = row.logicalFileName?.trim() || row.fileName.replace(/\.(zip|rar|7z)$/i, '');
      const previewUrl = pictureFromRow(row, nexusModId);

      addMod(
        {
          id: stableIdFromParts(['vortex-meta', domain, String(nexusModId ?? row.fileName), localPath]),
          source: row.source === 'nexus' || nexusModId ? 'nexus' : 'vortex-staging',
          gameId,
          title,
          author: row.details?.author,
          version: row.fileVersion,
          localPath: exists ? localPath : localPath,
          nexusModId,
          nexusGameDomain: domain,
          remotePreviewUrl: previewUrl,
          sizeBytes: exists ? fs.statSync(localPath).size : undefined,
          localMissing: exists ? undefined : true,
          installedAt: exists ? fs.statSync(localPath).mtime.toISOString() : undefined,
          lastSeenAt: new Date().toISOString(),
          favorited: false,
          revision: {
            kind: nexusModId ? 'nexus_file_id' : 'unknown',
            value: nexusModId ? String(nexusModId) : row.fileName,
          },
          tags: ['vortex-metadb', gameFolder, row.archived ? 'archived' : 'download', ...(fromVault ? ['vault'] : [])],
        },
        `Vortex metadb (${gameFolder})`,
        path.join(appData, 'Vortex', 'downloads', gameFolder),
      );
      count += 1;
    }
  } finally {
    await db.close();
  }
  return count;
}

/** Match deployed Cyberpunk .archive files to Nexus rows by normalized title. */
export function linkCyberpunkArchivesToNexus(mods: ModRecord[]) {
  const nexusByTitle = new Map<string, ModRecord>();
  for (const m of mods) {
    if (m.gameId !== 'cyberpunk2077' || !m.nexusModId) continue;
    const key = normalizeArchiveDeployKey(m.title);
    if (key.length >= 3) nexusByTitle.set(key, m);
    const loose = normLoose(m.title);
    if (loose.length >= 3) nexusByTitle.set(loose, m);
  }
  for (const m of mods) {
    if (m.gameId !== 'cyberpunk2077' || m.source !== 'local') continue;
    if (!m.localPath.toLowerCase().includes('.archive')) continue;
    const key = normalizeArchiveDeployKey(m.title);
    let hit = nexusByTitle.get(key);
    if (!hit && key.length >= 4) {
      for (const [k, rec] of nexusByTitle) {
        if (k.includes(key) || key.includes(k) || normLoose(k) === normLoose(key)) {
          hit = rec;
          break;
        }
      }
    }
    if (!hit) continue;
    m.source = 'nexus';
    m.nexusModId = hit.nexusModId;
    m.nexusGameDomain = hit.nexusGameDomain ?? 'cyberpunk2077';
    if (hit.remotePreviewUrl && !m.remotePreviewUrl) m.remotePreviewUrl = hit.remotePreviewUrl;
    if (hit.author) m.author = hit.author;
    m.tags = [...(m.tags ?? []), 'vortex-deployed-archive'];
  }
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normLoose(s: string): string {
  return norm(s).replace(/\s+/g, '');
}
