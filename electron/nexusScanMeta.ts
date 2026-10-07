import fs from 'node:fs';
import path from 'node:path';
import type { ModRecord } from '../shared/types';
import { gameIdFromVortexFolder } from './gamePathMap';
import { stableIdFromParts } from './scanHelpers';

export type NexusMetaHit = {
  title: string;
  nexusGameDomain: string;
  nexusModId: number;
  localPath: string;
  filePath: string;
};

const NEXUS_URL_RE = /nexusmods\.com\/([a-z0-9_-]+)\/mods\/(\d+)/i;

export function parseNexusUrl(text: string): { domain: string; modId: number } | null {
  const m = text.match(NEXUS_URL_RE);
  if (!m) return null;
  const modId = Number(m[2]);
  if (!Number.isFinite(modId)) return null;
  return { domain: m[1].toLowerCase(), modId };
}

function readJsonSafe(p: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function scanPathForNexusMeta(root: string, label: string, hits: NexusMetaHit[]) {
  if (!fs.existsSync(root)) return;
  const stack: string[] = [root];
  let scanned = 0;
  while (stack.length > 0 && scanned < 8000) {
    const dir = stack.pop()!;
    scanned += 1;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        stack.push(full);
        continue;
      }
      const lower = e.name.toLowerCase();
      if (!lower.endsWith('.json') && lower !== 'meta.ini' && lower !== 'manifest.xml') continue;
      if (e.name.length > 64) continue;
      let text = '';
      try {
        text = fs.readFileSync(full, 'utf8').slice(0, 200_000);
      } catch {
        continue;
      }
      const fromUrl = parseNexusUrl(text);
      if (!fromUrl) continue;
      let title = `Nexus mod ${fromUrl.modId}`;
      const json = lower.endsWith('.json') ? (readJsonSafe(full) as Record<string, unknown>) : null;
      if (json) {
        const name = json.name ?? json.modName ?? json.title;
        if (typeof name === 'string') title = name;
      }
      hits.push({
        title,
        nexusGameDomain: fromUrl.domain,
        nexusModId: fromUrl.modId,
        localPath: dir,
        filePath: full,
      });
    }
  }
}

export function nexusMetaToMod(hit: NexusMetaHit): ModRecord {
  const gameId = gameIdFromVortexFolder(hit.nexusGameDomain);
  const stat = fs.statSync(hit.localPath);
  return {
    id: stableIdFromParts(['nexus-meta', hit.nexusGameDomain, String(hit.nexusModId), hit.localPath]),
    source: 'nexus',
    gameId,
    title: hit.title,
    localPath: hit.localPath,
    nexusGameDomain: hit.nexusGameDomain,
    nexusModId: hit.nexusModId,
    installedAt: stat.mtime.toISOString(),
    lastSeenAt: new Date().toISOString(),
    favorited: false,
    revision: { kind: 'unknown', value: String(hit.nexusModId) },
    tags: ['nexus-meta', hit.filePath],
  };
}
