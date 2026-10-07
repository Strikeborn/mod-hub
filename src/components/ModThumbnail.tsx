import { useEffect, useRef, useState } from 'react';
import {
  getCachedThumbnail,
  setCachedThumbnail,
  thumbnailCacheKey,
} from '../utils/thumbnailCache';

type Props = {
  path?: string;
  remoteUrl?: string;
  title: string;
};

export function ModThumbnail({ path, remoteUrl, title }: Props) {
  const cacheKey = thumbnailCacheKey(path, remoteUrl);
  const cached = getCachedThumbnail(cacheKey);
  const [src, setSrc] = useState<string | null>(cached ?? null);
  const [loading, setLoading] = useState(cached === undefined);
  // Only fetch once the card is near the visible area, so on-screen cards aren't stuck behind
  // 1,600 off-screen requests (carousel scrolls horizontally, so the margin covers both axes).
  const boxRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(cached !== undefined);

  useEffect(() => {
    if (near) return;
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: '150% 150%' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return;
    const existing = getCachedThumbnail(cacheKey);
    if (existing !== undefined) {
      setSrc(existing);
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function load() {
      setLoading(true);
      if (!window.modHub) {
        if (!cancelled) setLoading(false);
        return;
      }

      const tasks: Promise<string | null>[] = [];
      if (path) tasks.push(window.modHub.getThumbnail(path));
      if (remoteUrl) tasks.push(window.modHub.fetchRemoteThumbnail(remoteUrl));

      const results = await Promise.all(tasks);
      if (cancelled) return;

      const local = path ? results[0] : null;
      const remote = remoteUrl ? (path ? results[1] : results[0]) : null;
      const picked = local ?? remote ?? null;
      // Only cache successes so a transient failure doesn't blank the card for the whole session.
      if (picked) setCachedThumbnail(cacheKey, picked);
      setSrc(picked);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, path, remoteUrl, near]);

  async function onImgError() {
    if (remoteUrl && window.modHub && src && !src.startsWith('data:')) {
      const proxied = await window.modHub.fetchRemoteThumbnail(remoteUrl);
      if (proxied) {
        setCachedThumbnail(cacheKey, proxied);
        setSrc(proxied);
        return;
      }
    }
    setSrc(null);
  }

  return (
    <div ref={boxRef} className={`mod-card-thumb${loading && !src ? ' mod-card-thumb-loading' : ''}`}>
      {src ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => void onImgError()} />
      ) : loading ? (
        <span className="thumb-placeholder" aria-hidden>
          …
        </span>
      ) : (
        <span className="thumb-fallback">{title.slice(0, 32)}</span>
      )}
    </div>
  );
}
