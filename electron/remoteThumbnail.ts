const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const cache = new Map<string, { at: number; ttl: number; dataUrl: string | null }>();
const inflight = new Map<string, Promise<string | null>>();
const OK_TTL_MS = 1000 * 60 * 60 * 24;
const PERMANENT_FAIL_TTL_MS = 1000 * 60 * 60 * 6;
const TRANSIENT_FAIL_TTL_MS = 1000 * 60 * 2;
const MAX_BYTES = 8_000_000;
const TIMEOUT_MS = 15_000;
const MAX_CONCURRENT = 8;

let active = 0;
const waiters: Array<() => void> = [];
async function acquire() {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active += 1;
}
function release() {
  active -= 1;
  waiters.shift()?.();
}

function refererFor(url: string): string {
  if (/steamuser(content|images)|steamstatic|steampowered|steamcommunity/i.test(url)) {
    return 'https://steamcommunity.com/';
  }
  return 'https://www.nexusmods.com/';
}

function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  return null;
}

type Attempt = { dataUrl: string | null; permanent: boolean; reason?: string };

async function attempt(url: string): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8', Referer: refererFor(url) },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) {
      const permanent = res.status === 404 || res.status === 403 || res.status === 410;
      return { dataUrl: null, permanent, reason: `HTTP ${res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return { dataUrl: null, permanent: true, reason: `too large ${buf.length}` };
    const headerCt = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    const mime = headerCt.startsWith('image/') ? headerCt : sniffImageMime(buf);
    if (!mime) return { dataUrl: null, permanent: true, reason: `not an image (${headerCt || 'no content-type'})` };
    return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, permanent: false };
  } catch (err) {
    return { dataUrl: null, permanent: false, reason: String((err as Error)?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

async function load(url: string): Promise<string | null> {
  await acquire();
  try {
    let result = await attempt(url);
    if (!result.dataUrl && !result.permanent) {
      await new Promise((r) => setTimeout(r, 750));
      result = await attempt(url);
    }
    if (result.dataUrl) {
      cache.set(url, { at: Date.now(), ttl: OK_TTL_MS, dataUrl: result.dataUrl });
    } else {
      console.warn(`[Mod Hub] thumbnail fetch failed (${result.reason}): ${url}`);
      cache.set(url, {
        at: Date.now(),
        ttl: result.permanent ? PERMANENT_FAIL_TTL_MS : TRANSIENT_FAIL_TTL_MS,
        dataUrl: null,
      });
    }
    return result.dataUrl;
  } finally {
    release();
  }
}

export async function fetchRemoteThumbnailDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.dataUrl;
  const pending = inflight.get(url);
  if (pending) return pending;
  const p = load(url).finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}
