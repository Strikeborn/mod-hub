/** In-memory thumbnail data URLs — survives tab switches within one session. */
const cache = new Map<string, string | null>();

export function thumbnailCacheKey(path?: string, remoteUrl?: string): string {
  return `${path ?? ''}|${remoteUrl ?? ''}`;
}

export function getCachedThumbnail(key: string): string | null | undefined {
  return cache.get(key);
}

export function setCachedThumbnail(key: string, dataUrl: string | null): void {
  cache.set(key, dataUrl);
}
