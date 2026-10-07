import fs from 'node:fs';
import path from 'node:path';
import type { ModRecord } from '../shared/types';

export type WorkshopAcfItem = {
  /** True when Steam records a subscriber; false = downloaded by the game/a server, not subscribed. */
  subscribed: boolean;
  timeUpdated?: string;
};

const cache = new Map<string, { mtimeMs: number; items: Map<string, WorkshopAcfItem> }>();

/** Parse `steamapps/workshop/appworkshop_{appId}.acf` (cached by mtime). */
export function readWorkshopAcf(acfPath: string): Map<string, WorkshopAcfItem> {
  try {
    const mtimeMs = fs.statSync(acfPath).mtimeMs;
    const hit = cache.get(acfPath);
    if (hit && hit.mtimeMs === mtimeMs) return hit.items;
    const text = fs.readFileSync(acfPath, 'utf8');
    const items = new Map<string, WorkshopAcfItem>();
    const details = text.split('"WorkshopItemDetails"')[1] ?? '';
    for (const m of details.matchAll(/"(\d+)"\s*\{([^{}]*)\}/g)) {
      const body = m[2];
      items.set(m[1], {
        subscribed: /"subscribedby"\s*"[1-9]\d*"/i.test(body),
        timeUpdated: body.match(/"timeupdated"\s*"(\d+)"/i)?.[1],
      });
    }
    cache.set(acfPath, { mtimeMs, items });
    return items;
  } catch {
    return new Map();
  }
}

/** `.../steamapps/workshop/content/{appId}/{id}` → its appworkshop acf path. */
export function acfPathForWorkshopFolder(localPath: string, appId: number): string | undefined {
  const m = localPath.match(/^(.*[\\/]steamapps)[\\/]workshop[\\/]content[\\/]/i);
  if (!m) return undefined;
  return path.join(m[1], 'workshop', `appworkshop_${appId}.acf`);
}

/**
 * Sync on-disk Workshop rows with Steam's own records: `steamSubscribed`, the installed version
 * (`revision.value` = acf timeupdated) and `updateAvailable` (Workshop newer than installed).
 * Returns rows changed.
 */
export function applyWorkshopSubscriptionState(mods: ModRecord[]): number {
  let changed = 0;
  for (const m of mods) {
    if (m.source !== 'steam-workshop' || !m.workshopId || !m.steamAppId) continue;
    const acf = acfPathForWorkshopFolder(m.localPath, m.steamAppId);
    if (!acf) continue;
    const items = readWorkshopAcf(acf);
    // Unsubscribing removes the item's details entry while Steam leaves the files until the game next
    // starts; a readable acf without an entry for an on-disk item therefore means "not subscribed".
    const item = items.get(m.workshopId) ?? (items.size > 0 ? { subscribed: false } : undefined);
    if (!item) continue;
    let dirty = false;
    if (m.steamSubscribed !== item.subscribed) {
      m.steamSubscribed = item.subscribed;
      dirty = true;
    }
    if (item.timeUpdated && (m.revision.kind !== 'workshop_time_updated' || m.revision.value !== item.timeUpdated)) {
      m.revision = { ...m.revision, kind: 'workshop_time_updated', value: item.timeUpdated };
      dirty = true;
    }
    const remote = Number(m.revision.remoteValue);
    const updateAvailable = Boolean(remote && remote > Number(m.revision.value));
    if (Boolean(m.revision.updateAvailable) !== updateAvailable) {
      m.revision = { ...m.revision, updateAvailable };
      dirty = true;
    }
    if (dirty) changed += 1;
  }
  return changed;
}
