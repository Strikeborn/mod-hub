import type { ModRecord } from '../shared/types';

function nexusKey(m: ModRecord): string | undefined {
  if (m.nexusModId == null) return undefined;
  return `${(m.nexusGameDomain ?? m.gameId).toLowerCase()}|${m.nexusModId}`;
}

/** Prefer deployed game files over Vortex download archives. */
function deployPriority(localPath: string): number {
  const p = localPath.toLowerCase().replace(/\//g, '\\');
  if (p.includes('archive\\pc\\mod') && p.endsWith('.archive')) return 100;
  if (p.includes('archive\\pc\\mod')) return 95;
  if (p.includes('\\vortex\\') && p.includes('\\mods\\') && !p.includes('\\downloads\\')) return 85;
  if (p.includes('\\staging\\')) return 45;
  if (/\.(zip|7z|rar)(\.\d+)?$/i.test(p)) return 35;
  return 55;
}

function pathRole(localPath: string): string {
  const p = localPath.toLowerCase();
  if (p.includes('archive') && p.endsWith('.archive')) return 'deployed archive';
  if (/\.(zip|7z|rar)/i.test(p)) return 'Vortex download';
  if (p.includes('staging')) return 'staging';
  if (p.includes('\\mods\\')) return 'mod folder';
  return 'on disk';
}

function mergeFields(primary: ModRecord, other: ModRecord) {
  if (!primary.author && other.author) primary.author = other.author;
  if (!primary.version && other.version) primary.version = other.version;
  if (!primary.remotePreviewUrl && other.remotePreviewUrl) primary.remotePreviewUrl = other.remotePreviewUrl;
  if (!primary.previewPath && other.previewPath) primary.previewPath = other.previewPath;
  if (!primary.iconPath && other.iconPath) primary.iconPath = other.iconPath;
  if (!primary.remoteCreatedAt && other.remoteCreatedAt) primary.remoteCreatedAt = other.remoteCreatedAt;
  if (!primary.remoteUpdatedAt && other.remoteUpdatedAt) primary.remoteUpdatedAt = other.remoteUpdatedAt;
  if (primary.source === 'local' && other.source !== 'local') primary.source = other.source;
  if (!primary.nexusGameDomain && other.nexusGameDomain) primary.nexusGameDomain = other.nexusGameDomain;
}

/**
 * One card per Nexus mod id: merge Vortex download (.zip/.7z) with deployed .archive / mod folder.
 * Does not delete files — only collapses catalog rows.
 */
export function mergeNexusDuplicates(mods: ModRecord[]): ModRecord[] {
  const passthrough: ModRecord[] = [];
  const groups = new Map<string, ModRecord[]>();

  for (const m of mods) {
    const key = nexusKey(m);
    if (!key) {
      passthrough.push(m);
      continue;
    }
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }

  const merged: ModRecord[] = [...passthrough];

  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    const sorted = [...group].sort((a, b) => deployPriority(b.localPath) - deployPriority(a.localPath));
    const primary = { ...sorted[0] };
    const alternates = sorted.slice(1);
    const altPaths: string[] = [];
    const roles = new Set<string>();

    for (const alt of alternates) {
      mergeFields(primary, alt);
      if (alt.localPath.toLowerCase() !== primary.localPath.toLowerCase()) {
        altPaths.push(alt.localPath);
        roles.add(pathRole(alt.localPath));
      }
    }

    if (altPaths.length > 0) {
      primary.alternateLocalPaths = altPaths;
      const roleText = [...roles].slice(0, 3).join(', ');
      primary.vortexMergeNote = `Also on disk (${roleText}). Normal for Vortex (download + deployed).`;
      primary.duplicateHint = undefined;

      const allPaths = [primary.localPath, ...altPaths];
      const downloads = allPaths.filter((p) => /\.(zip|7z|rar)(\.\d+)?$/i.test(p));
      const deployed = allPaths.filter((p) => !/\.(zip|7z|rar)(\.\d+)?$/i.test(p));
      if (downloads.length > 1 || deployed.length > 1) {
        primary.duplicateHint = `Unusual copies: ${downloads.length} download file(s), ${deployed.length} deployed path(s). Review in Vortex if unexpected.`;
      }
    }

    merged.push(primary);
  }

  return merged;
}
