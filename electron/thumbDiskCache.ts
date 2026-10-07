import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app, nativeImage } from 'electron';

/**
 * Card thumbnails, shrunk once and kept on disk (%APPDATA%/mod-hub/thumbs) so a restart doesn't
 * re-download every Nexus/Workshop image at full size. Only successes are stored; failures stay in
 * the in-memory negative cache in remoteThumbnail.ts.
 */
const MAX_WIDTH = 480;
const JPEG_QUALITY = 82;

let dir: string | undefined;
function thumbsDir(): string {
  if (!dir) {
    dir = path.join(app.getPath('userData'), 'thumbs');
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function fileBase(key: string): string {
  return path.join(thumbsDir(), crypto.createHash('sha1').update(key).digest('hex'));
}

function readCached(base: string): string | null | undefined {
  for (const [ext, mime] of [
    ['.jpg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.gif', 'image/gif'],
  ] as const) {
    try {
      const buf = fs.readFileSync(base + ext);
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      /* not cached in this format */
    }
  }
  return undefined;
}

/** Most Nexus screenshots are opaque PNGs; only keep PNG when the alpha channel is actually used. */
function hasTransparency(img: Electron.NativeImage): boolean {
  const bgra = img.toBitmap();
  for (let i = 3; i < bgra.length; i += 4) if (bgra[i] < 255) return true;
  return false;
}

/** Shrink to MAX_WIDTH and store. Transparent PNGs stay PNG (icons), GIF stays as-is (animation), rest JPEG. */
function shrinkAndStore(base: string, dataUrl: string): string {
  const mime = /^data:([^;]+);/.exec(dataUrl)?.[1] ?? '';
  try {
    if (mime === 'image/gif') {
      fs.writeFileSync(base + '.gif', Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
      return dataUrl;
    }
    let img = nativeImage.createFromDataURL(dataUrl);
    if (img.isEmpty()) return dataUrl;
    const { width } = img.getSize();
    if (width > MAX_WIDTH) img = img.resize({ width: MAX_WIDTH, quality: 'good' });
    const asPng = mime === 'image/png' && hasTransparency(img);
    const buf = asPng ? img.toPNG() : img.toJPEG(JPEG_QUALITY);
    fs.writeFileSync(base + (asPng ? '.png' : '.jpg'), buf);
    return `data:${asPng ? 'image/png' : 'image/jpeg'};base64,${buf.toString('base64')}`;
  } catch {
    return dataUrl;
  }
}

/** Disk-cached thumbnail for `key` (a URL, or a file path + mtime); `produce` loads the original on a miss. */
export async function diskCachedThumbnail(key: string, produce: () => Promise<string | null> | string | null): Promise<string | null> {
  const base = fileBase(key);
  const hit = readCached(base);
  if (hit) return hit;
  const original = await produce();
  if (!original) return null;
  return shrinkAndStore(base, original);
}
