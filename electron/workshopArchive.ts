import fs from 'node:fs';
import path from 'node:path';
import type { ModRecord } from '../shared/types';

/**
 * Last known Workshop details per item (%APPDATA%/mod-hub/workshop-archive.json). Every scan remembers what
 * Steam returned while the item was public; when Steam later says "removed" (result 9) or hides it, the card
 * keeps the author, dates and image instead of going blank. Entries can also come from a Wayback Machine
 * capture or be typed in by hand (source + note say which).
 */
export type WorkshopArchiveEntry = {
  title?: string;
  author?: string;
  authorDisplayName?: string;
  authorSteamId?: string;
  remoteCreatedAt?: string;
  remoteUpdatedAt?: string;
  remotePreviewUrl?: string;
  gameVersionTags?: string[];
  workshopCategories?: string[];
  requiredDlc?: string[];
  source: 'steam' | 'wayback' | 'manual';
  /** e.g. the Wayback capture date/URL. */
  note?: string;
  savedAt: string;
};

type Archive = Record<string, WorkshopArchiveEntry>;

function archivePath(): string {
  return path.join(process.env.APPDATA ?? '', 'mod-hub', 'workshop-archive.json');
}

export function loadWorkshopArchive(): Archive {
  try {
    return JSON.parse(fs.readFileSync(archivePath(), 'utf8')) as Archive;
  } catch {
    return {};
  }
}

function saveWorkshopArchive(a: Archive): void {
  fs.mkdirSync(path.dirname(archivePath()), { recursive: true });
  fs.writeFileSync(archivePath(), JSON.stringify(a, null, 1), 'utf8');
}

/** Merge a hand-entered or Wayback record (never overwrites a newer live Steam record). */
export function putWorkshopArchiveEntry(workshopId: string, entry: WorkshopArchiveEntry): void {
  const a = loadWorkshopArchive();
  a[workshopId] = { ...a[workshopId], ...entry };
  saveWorkshopArchive(a);
}

/** Fill blanks on removed/hidden Workshop items from the archive. Returns rows changed. */
export function applyWorkshopArchive(mods: ModRecord[], archive: Archive = loadWorkshopArchive()): number {
  let changed = 0;
  for (const m of mods) {
    if (!m.workshopId || !m.workshopHidden) continue;
    const e = archive[m.workshopId];
    if (!e) continue;
    const before = JSON.stringify(m);
    m.author ||= e.author;
    m.authorDisplayName ||= e.authorDisplayName;
    m.authorSteamId ||= e.authorSteamId;
    m.remoteCreatedAt ||= e.remoteCreatedAt;
    m.remoteUpdatedAt ||= e.remoteUpdatedAt;
    m.remotePreviewUrl ||= e.remotePreviewUrl;
    if (!m.gameVersionTags?.length && e.gameVersionTags?.length) m.gameVersionTags = e.gameVersionTags;
    if (!m.workshopCategories?.length && e.workshopCategories?.length) m.workshopCategories = e.workshopCategories;
    m.workshopArchived = { source: e.source, savedAt: e.savedAt, note: e.note, requiredDlc: e.requiredDlc };
    if (JSON.stringify(m) !== before) changed += 1;
  }
  return changed;
}

/** Remember what Steam returned for every public item this scan. Returns entries written. */
export function rememberWorkshopDetails(mods: ModRecord[]): number {
  const a = loadWorkshopArchive();
  let n = 0;
  const now = new Date().toISOString();
  for (const m of mods) {
    if (!m.workshopId || m.workshopHidden || !m.remoteCreatedAt) continue;
    const prev = a[m.workshopId];
    const next: WorkshopArchiveEntry = {
      ...prev,
      title: m.title,
      author: m.author,
      authorDisplayName: m.authorDisplayName ?? prev?.authorDisplayName,
      authorSteamId: m.authorSteamId,
      remoteCreatedAt: m.remoteCreatedAt,
      remoteUpdatedAt: m.remoteUpdatedAt,
      remotePreviewUrl: m.remotePreviewUrl ?? prev?.remotePreviewUrl,
      gameVersionTags: m.gameVersionTags,
      workshopCategories: m.workshopCategories,
      source: 'steam',
      note: undefined,
      savedAt: now,
    };
    const { savedAt: _a, ...cmpPrev } = prev ?? ({} as WorkshopArchiveEntry);
    const { savedAt: _b, ...cmpNext } = next;
    if (JSON.stringify(cmpPrev) === JSON.stringify(cmpNext)) continue;
    a[m.workshopId] = next;
    n += 1;
  }
  if (n) saveWorkshopArchive(a);
  return n;
}
