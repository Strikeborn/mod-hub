import type { ModRecord } from '@shared/types';
import { bestPreviewFilePath } from '@shared/modDiskPath';
import { getCachedThumbnail, setCachedThumbnail, thumbnailCacheKey } from './thumbnailCache';

const MAX_WARM = 500;
// Low so on-screen thumbnails (main process allows 8 fetches at once) are never queued behind the warm-up.
const CONCURRENCY = 3;

/** Warm thumbnail cache after catalog load (non-blocking). */
export function prefetchModThumbnails(mods: ModRecord[]): void {
  if (!window.modHub) return;

  const jobs: Array<{ path?: string; url?: string; key: string }> = [];
  for (const m of mods) {
    if (jobs.length >= MAX_WARM) break;
    const path = bestPreviewFilePath(m);
    const url = m.remotePreviewUrl;
    if (!path && !url) continue;
    const key = thumbnailCacheKey(path, url);
    if (getCachedThumbnail(key) !== undefined) continue;
    jobs.push({ path, url, key });
  }
  if (jobs.length === 0) return;

  let index = 0;
  let active = 0;

  const pump = () => {
    while (active < CONCURRENCY && index < jobs.length) {
      const job = jobs[index++];
      active += 1;
      void (async () => {
        try {
          let picked: string | null = null;
          const tasks: Promise<string | null>[] = [];
          if (job.path) tasks.push(window.modHub.getThumbnail(job.path));
          if (job.url) tasks.push(window.modHub.fetchRemoteThumbnail(job.url));
          const results = await Promise.all(tasks);
          if (job.path && results[0]) picked = results[0];
          else if (job.url) picked = results[job.path ? 1 : 0] ?? null;
          if (picked) setCachedThumbnail(job.key, picked);
        } catch {
          /* leave uncached so the card retries */
        } finally {
          active -= 1;
          pump();
        }
      })();
    }
  };

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => pump(), { timeout: 2000 });
  } else {
    setTimeout(pump, 100);
  }
}
