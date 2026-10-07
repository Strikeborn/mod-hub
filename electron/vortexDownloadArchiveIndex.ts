import fs from 'node:fs';
import path from 'node:path';
import type { ModRecord } from '../shared/types';
import { parseNexusIdFromVortexModKey } from './vortexStateScanner';
import { gameIdFromVortexFolder } from './gamePathMap';
import { find7zExecutable, listPathsWith7z } from './sevenZipList';
import {
  downloadsIndexSignature,
  loadCachedDownloadIndex,
  saveCachedDownloadIndex,
} from './downloadIndexCache';

export type ArchiveZipHit = {
  nexusModId: number;
  nexusGameDomain: string;
  gameId: string;
  zipPath: string;
  innerArchiveName: string;
  zipFileName: string;
};

export type DownloadArchiveIndex = {
  byDeployKey: Map<string, ArchiveZipHit>;
  byNexusId: Map<string, ArchiveZipHit>;
};

/** Deployed `#DirtBegone.archive` ↔ zip entry `###-DirtBegone.archive`. */
export function normalizeArchiveDeployKey(name: string): string {
  return name
    .replace(/\.archive$/i, '')
    .replace(/\.xl$/i, '')
    .replace(/^#+/i, '')
    .replace(/^\d+_/i, '')
    .replace(/_physics(_nude)?$/i, '')
    .replace(/_size$/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

const INNER_ARCHIVE_PATH_RE = /archive[/\\]pc[/\\]mod[/\\]([^\x00/\\]+\.archive)/gi;
const USE_7Z_FOR = /\.(7z|rar)(\.\d+)?$/i;

function extractArchivePathsFromListedPaths(paths: string[]): string[] {
  const names = new Set<string>();
  for (const p of paths) {
    const norm = p.replace(/\\/g, '/');
    if (!/\/archive\/pc\/mod\/[^/]+\.archive$/i.test(norm)) continue;
    if (/\/physics\//i.test(norm) || /\/size\//i.test(norm)) continue;
    names.add(path.basename(norm));
  }
  return [...names];
}

function addInnerArchiveName(names: Set<string>, raw: string) {
  const norm = raw.replace(/\\/g, '/');
  if (/\/physics\//i.test(norm) || /\/size\//i.test(norm)) return;
  const base = path.basename(norm);
  if (!/physics|_size\.archive/i.test(base)) names.add(base);
}

function readAt(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const n = fs.readSync(fd, buf, read, length - read, position + read);
    if (n <= 0) break;
    read += n;
  }
  return read === length ? buf : buf.subarray(0, read);
}

/**
 * List entry names from a zip's central directory (reads only the tail of the file).
 * Returns null when the file is not a readable zip, so callers can fall back.
 */
function listZipEntryNames(archivePath: string): string[] | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(archivePath, 'r');
    const size = fs.fstatSync(fd).size;
    if (size < 22) return null;
    const tailLen = Math.min(size, 65_557);
    const tail = readAt(fd, size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      // ZIP64: locator sits 20 bytes before EOCD.
      const loc = eocd - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) return null;
      const z64Off = Number(tail.readBigUInt64LE(loc + 8));
      const z64 = readAt(fd, z64Off, 56);
      if (z64.length < 56 || z64.readUInt32LE(0) !== 0x06064b50) return null;
      count = Number(z64.readBigUInt64LE(32));
      cdSize = Number(z64.readBigUInt64LE(40));
      cdOffset = Number(z64.readBigUInt64LE(48));
    }
    if (cdSize <= 0 || cdSize > 256 * 1024 * 1024 || cdOffset + cdSize > size) return null;
    const cd = readAt(fd, cdOffset, cdSize);
    const names: string[] = [];
    let pos = 0;
    for (let n = 0; n < count && pos + 46 <= cd.length; n++) {
      if (cd.readUInt32LE(pos) !== 0x02014b50) break;
      const flags = cd.readUInt16LE(pos + 8);
      const nameLen = cd.readUInt16LE(pos + 28);
      const extraLen = cd.readUInt16LE(pos + 30);
      const commentLen = cd.readUInt16LE(pos + 32);
      const nameBuf = cd.subarray(pos + 46, pos + 46 + nameLen);
      names.push(nameBuf.toString(flags & 0x800 ? 'utf8' : 'latin1'));
      pos += 46 + nameLen + extraLen + commentLen;
    }
    return names;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

const BINARY_SCAN_CHUNK = 16 * 1024 * 1024;
const BINARY_SCAN_OVERLAP = 4096;
const BINARY_SCAN_MAX_BYTES = 4 * 1024 * 1024 * 1024;

/** Scan archive bytes in chunks for embedded CP2077 archive paths (never builds one huge string). */
function findInnerArchiveNamesBinary(archivePath: string): string[] {
  const names = new Set<string>();
  let fd: number | null = null;
  try {
    const stat = fs.statSync(archivePath);
    if (!stat.isFile() || stat.size > BINARY_SCAN_MAX_BYTES) return [];
    fd = fs.openSync(archivePath, 'r');
    let carry = '';
    for (let pos = 0; pos < stat.size; pos += BINARY_SCAN_CHUNK) {
      const chunk = readAt(fd, pos, Math.min(BINARY_SCAN_CHUNK, stat.size - pos));
      if (chunk.length === 0) break;
      const text = carry + chunk.toString('latin1');
      INNER_ARCHIVE_PATH_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = INNER_ARCHIVE_PATH_RE.exec(text))) addInnerArchiveName(names, m[1]);
      carry = text.slice(-BINARY_SCAN_OVERLAP);
    }
  } catch {
    /* unreadable archive — skip */
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
  return [...names];
}

function findInnerArchiveNames(archivePath: string): string[] {
  const ext = path.extname(archivePath).toLowerCase();
  if (USE_7Z_FOR.test(archivePath)) {
    const listed = listPathsWith7z(archivePath);
    const from7z = extractArchivePathsFromListedPaths(listed);
    if (from7z.length > 0) return from7z;
  }

  if (/\.zip$/i.test(ext)) {
    const entries = listZipEntryNames(archivePath);
    if (entries) return extractArchivePathsFromListedPaths(entries.map((e) => `/${e}`));
  }

  const binary = findInnerArchiveNamesBinary(archivePath);
  if (binary.length > 0) return binary;

  if (/\.zip$/i.test(ext)) {
    const listed = listPathsWith7z(archivePath, 15_000);
    return extractArchivePathsFromListedPaths(listed);
  }

  if (USE_7Z_FOR.test(archivePath)) return [];
  const listed = listPathsWith7z(archivePath, 15_000);
  return extractArchivePathsFromListedPaths(listed);
}

function zipStemLoose(fileName: string): string {
  const base = fileName.replace(/\.(zip|7z|rar)(\.\d+)?$/i, '');
  const id = parseNexusIdFromVortexModKey(fileName);
  let stem = base;
  if (id) {
    stem = base.replace(new RegExp(`[-\\s]${id}[-\\s].*$`), '').trim();
    stem = stem.replace(new RegExp(`${id}[-\\s].*$`), '').trim();
  }
  return normalizeArchiveDeployKey(stem);
}

function nexusKey(gameFolder: string, modId: number): string {
  return `${gameFolder.toLowerCase()}|${modId}`;
}

function registerHit(
  byDeployKey: Map<string, ArchiveZipHit>,
  byNexusId: Map<string, ArchiveZipHit>,
  deployKey: string,
  hit: ArchiveZipHit,
) {
  if (deployKey.length >= 3) {
    const existing = byDeployKey.get(deployKey);
    if (!existing || existing.nexusModId === hit.nexusModId) byDeployKey.set(deployKey, hit);
  }
  const nk = nexusKey(hit.nexusGameDomain, hit.nexusModId);
  if (!byNexusId.has(nk)) byNexusId.set(nk, hit);
}

/**
 * Index Vortex download zips/7z by inner `.archive` paths + Nexus id from filename.
 */
export function buildDownloadArchiveIndex(
  onProgress?: (current: number, total: number) => void,
  cachePath?: string,
): DownloadArchiveIndex {
  const byDeployKey = new Map<string, ArchiveZipHit>();
  const byNexusId = new Map<string, ArchiveZipHit>();
  const appData = process.env.APPDATA;
  if (!appData) return { byDeployKey, byNexusId };

  const downloadsRoot = path.join(appData, 'Vortex', 'downloads');
  if (!fs.existsSync(downloadsRoot)) return { byDeployKey, byNexusId };

  const signature = downloadsIndexSignature(downloadsRoot);
  if (cachePath) {
    const cached = loadCachedDownloadIndex(cachePath, signature);
    if (cached) return cached;
  }

  let gameDirs: fs.Dirent[];
  try {
    gameDirs = fs.readdirSync(downloadsRoot, { withFileTypes: true });
  } catch {
    return { byDeployKey, byNexusId };
  }

  const work: { gameFolder: string; filePath: string }[] = [];
  for (const g of gameDirs) {
    if (!g.isDirectory()) continue;
    const dir = path.join(downloadsRoot, g.name);
    let files: fs.Dirent[];
    try {
      files = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.isFile()) continue;
      if (!/\.(zip|7z|rar)$/i.test(f.name)) continue;
      work.push({ gameFolder: g.name, filePath: path.join(dir, f.name) });
    }
  }

  let warnedNo7z = false;
  let i = 0;
  for (const { gameFolder, filePath } of work) {
    i += 1;
    if (i % 25 === 0) onProgress?.(i, work.length);

    const modId = parseNexusIdFromVortexModKey(path.basename(filePath));
    if (!modId) continue;

    const gameId = gameIdFromVortexFolder(gameFolder);
    const domain = gameFolder.toLowerCase();
    const hitBase: Omit<ArchiveZipHit, 'innerArchiveName'> = {
      nexusModId: modId,
      nexusGameDomain: domain,
      gameId,
      zipPath: filePath,
      zipFileName: path.basename(filePath),
    };

    registerHit(byDeployKey, byNexusId, zipStemLoose(path.basename(filePath)), {
      ...hitBase,
      innerArchiveName: '',
    });

    if (USE_7Z_FOR.test(filePath) && !find7zExecutable() && !warnedNo7z) {
      warnedNo7z = true;
      console.warn('[Mod Hub] 7-Zip not found — install 7-Zip for .7z mod archive linking.');
    }
    let innerNames: string[] = [];
    try {
      innerNames = findInnerArchiveNames(filePath);
    } catch (err) {
      console.warn(`[Mod Hub] Skipping archive index for ${filePath}:`, err);
    }
    for (const inner of innerNames) {
      const key = normalizeArchiveDeployKey(inner);
      registerHit(byDeployKey, byNexusId, key, { ...hitBase, innerArchiveName: inner });
    }
  }

  try {
    indexVortexStagingArchives(byDeployKey, byNexusId, downloadsRoot);
  } catch (err) {
    console.warn("[Mod Hub] Staging archive index failed:", err);
  }

  onProgress?.(work.length, work.length);
  if (cachePath) saveCachedDownloadIndex(cachePath, signature, byDeployKey, byNexusId);
  return { byDeployKey, byNexusId };
}

/** Vortex `%APPDATA%/Vortex/{game}/mods/{id - name}/` often contains the same `.archive` names. */
function indexVortexStagingArchives(
  byDeployKey: Map<string, ArchiveZipHit>,
  byNexusId: Map<string, ArchiveZipHit>,
  downloadsRoot: string,
) {
  const vortexRoot = path.dirname(downloadsRoot);
  let gameDirs: fs.Dirent[];
  try {
    gameDirs = fs.readdirSync(vortexRoot, { withFileTypes: true });
  } catch {
    return;
  }
  const skip = new Set(['downloads', 'staging', 'logs', 'temp', 'plugins', 'cache', 'meta', 'state', 'metadb']);

  for (const g of gameDirs) {
    if (!g.isDirectory() || skip.has(g.name.toLowerCase())) continue;
    const modsRoot = path.join(vortexRoot, g.name, 'mods');
    if (!fs.existsSync(modsRoot)) continue;

    let modDirs: fs.Dirent[];
    try {
      modDirs = fs.readdirSync(modsRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const d of modDirs) {
      if (!d.isDirectory()) continue;
      const modId = parseNexusIdFromVortexModKey(d.name);
      if (!modId) continue;
      const nk = nexusKey(g.name, modId);
      const zipHit = byNexusId.get(nk);
      if (!zipHit) continue;

      const archives = findArchivesUnder(path.join(modsRoot, d.name), 6);
      for (const inner of archives) {
        const key = normalizeArchiveDeployKey(inner);
        registerHit(byDeployKey, byNexusId, key, { ...zipHit, innerArchiveName: inner });
      }
    }
  }
}

function findArchivesUnder(root: string, maxDepth: number): string[] {
  const out: string[] = [];
  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && /\.archive$/i.test(e.name) && !/physics|_size\.archive/i.test(e.name)) {
        out.push(e.name);
      } else if (e.isDirectory()) walk(full, depth + 1);
    }
  }
  walk(root, 0);
  return out;
}

function similarityScore(a: string, b: string): number {
  if (a === b) return 100;
  if (a.length >= 4 && b.includes(a)) return 80;
  if (b.length >= 4 && a.includes(b)) return 80;
  const minLen = Math.min(a.length, b.length);
  if (minLen >= 6) {
    let common = 0;
    for (let i = 0; i <= a.length - 4; i++) {
      const sub = a.slice(i, i + 4);
      if (b.includes(sub)) common += 1;
    }
    if (common >= 2) return 50 + common;
  }
  return 0;
}

function bestIndexHit(index: DownloadArchiveIndex, deployBaseName: string): ArchiveZipHit | undefined {
  const key = normalizeArchiveDeployKey(deployBaseName);
  if (key.length >= 3) {
    const direct = index.byDeployKey.get(key);
    if (direct) return direct;
  }

  if (key.length >= 5) {
    let best: ArchiveZipHit | undefined;
    let bestScore = 0;
    for (const [k, hit] of index.byDeployKey) {
      const score = similarityScore(key, k);
      if (score > bestScore) {
        bestScore = score;
        best = hit;
      }
    }
    if (bestScore >= 55) return best;
  }
  return undefined;
}

function applyHit(m: ModRecord, hit: ArchiveZipHit): void {
  m.nexusModId = hit.nexusModId;
  m.nexusGameDomain = hit.nexusGameDomain;
  m.gameId = hit.gameId;
  m.source = 'nexus';
  const alts = m.alternateLocalPaths ?? [];
  if (!alts.some((p) => p.toLowerCase() === hit.zipPath.toLowerCase())) {
    m.alternateLocalPaths = [...alts, hit.zipPath];
  }
  m.vortexMergeNote = m.vortexMergeNote ?? 'Linked to Vortex download (archive ↔ zip/7z).';
  m.tags = [...(m.tags ?? []), 'vortex-deployed-archive', 'vortex-zip-linked'];
}

/** Attach Nexus id + Vortex download zip/7z to deployed `.archive` rows. */
export function linkDeployedArchivesToVortexDownloads(mods: ModRecord[], index: DownloadArchiveIndex): number {
  let linked = 0;

  for (const m of mods) {
    if (!/\.archive$/i.test(m.localPath)) continue;
    const inGameArchive =
      m.gameId === 'cyberpunk2077' || m.localPath.toLowerCase().includes('archive\\pc\\mod');
    if (!inGameArchive) continue;
    if (m.nexusModId != null) continue;

    const hit = bestIndexHit(index, path.basename(m.localPath));
    if (!hit) continue;
    applyHit(m, hit);
    linked += 1;
  }

  for (const m of mods) {
    if (!/\.archive$/i.test(m.localPath)) continue;
    if (m.nexusModId != null) continue;
    const key = normalizeArchiveDeployKey(path.basename(m.localPath));
    if (key.length < 4) continue;

    let best: ArchiveZipHit | undefined;
    let bestScore = 0;
    for (const [k, hit] of index.byDeployKey) {
      if (k.length < 4) continue;
      const score = similarityScore(key, k);
      if (score > bestScore) {
        bestScore = score;
        best = hit;
      }
    }
    if (best && bestScore >= 70) {
      applyHit(m, best);
      linked += 1;
    }
  }

  return linked;
}

/** Link catalog rows that already share a Nexus id but missing zip path on archive side. */
export function attachZipPathsFromIndex(mods: ModRecord[], index: DownloadArchiveIndex): number {
  let n = 0;
  for (const m of mods) {
    if (m.nexusModId == null) continue;
    const nk = nexusKey(m.nexusGameDomain ?? m.gameId, m.nexusModId);
    const hit = index.byNexusId.get(nk);
    if (!hit) continue;
    const alts = m.alternateLocalPaths ?? [];
    if (alts.some((p) => p.toLowerCase() === hit.zipPath.toLowerCase())) continue;
    if (/\.archive$/i.test(m.localPath)) {
      m.alternateLocalPaths = [...alts, hit.zipPath];
      n += 1;
    }
  }
  return n;
}
