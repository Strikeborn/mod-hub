import type { ModRecord } from '@shared/types';

/** Title reduced to its core so "Hospitality (Continued)" and "Hospitality" match. */
export function baseTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b(continued|updated|fixed|fork|drop version|reupload|re-upload|remastered|redux|legacy|v?\d+(\.\d+)+)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

let indexFor: ModRecord[] | null = null;
let currentAll: ModRecord[] = [];

/** App sets the full catalog once so cards can ask without passing it down. */
export function setSimilarModsSource(all: ModRecord[]): void {
  currentAll = all;
}
let index = new Map<string, ModRecord[]>();

/** Other installed mods of the same game whose core title matches (likely duplicates / forks / re-uploads). */
export function similarInstalled(mod: ModRecord, all: ModRecord[] = currentAll): ModRecord[] {
  if (indexFor !== all) {
    index = new Map();
    for (const m of all) {
      const k = baseTitle(m.title);
      if (k.length < 4 || m.title.startsWith('#')) continue;
      const key = `${m.gameId}|${k}`;
      index.set(key, [...(index.get(key) ?? []), m]);
    }
    indexFor = all;
  }
  const k = baseTitle(mod.title);
  if (k.length < 4) return [];
  return (index.get(`${mod.gameId}|${k}`) ?? []).filter((m) => m.id !== mod.id);
}
