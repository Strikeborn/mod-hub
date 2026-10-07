import fs from 'node:fs';
import path from 'node:path';
import type { ModRecord } from '../shared/types';

export type ModMedia = {
  /** Remote image URLs (load through fetchRemoteThumbnail) or local file paths (getThumbnail). */
  images: { src: string; local: boolean }[];
  /** YouTube video ids. */
  videos: string[];
  /** Longer description when the source has one (plain BBCode/HTML; renderer strips it). */
  description?: string;
  errors: string[];
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const cache = new Map<string, { at: number; media: ModMedia }>();
const TTL = 1000 * 60 * 30;

const YT_RE = /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=|vi\/)|youtu\.be\/|img\.youtube\.com\/vi\/)([\w-]{11})/g;

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

async function workshopMedia(workshopId: string, media: ModMedia) {
  const res = await fetch(`https://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(workshopId)}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.8' },
  });
  if (!res.ok) throw new Error(`Workshop page HTTP ${res.status}`);
  const html = await res.text();
  const imgs: string[] = [];
  for (const m of html.matchAll(/ShowEnlargedImagePreview\(\s*'([^']+)'/g)) imgs.push(m[1]);
  const main = html.match(/id="previewImageMain"[^>]*src="([^"]+)"/)?.[1] ?? html.match(/id="previewImage"[^>]*src="([^"]+)"/)?.[1];
  if (main) imgs.unshift(main);
  for (const u of uniq(imgs)) media.images.push({ src: u.replace(/&amp;/g, '&'), local: false });
  media.videos.push(...[...html.matchAll(YT_RE)].map((m) => m[1]));
  const desc = html.match(/<div class="workshopItemDescription" id="highlightContent">([\s\S]*?)<\/div>\s*<\/div>/)?.[1];
  if (desc) media.description = desc.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
}

async function nexusMedia(domain: string, modId: number, apiKey: string, media: ModMedia) {
  const res = await fetch(`https://api.nexusmods.com/v1/games/${encodeURIComponent(domain)}/mods/${modId}.json`, {
    headers: { apikey: apiKey, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Nexus API HTTP ${res.status}`);
  const j = (await res.json()) as { picture_url?: string; description?: string };
  if (j.picture_url) media.images.push({ src: j.picture_url, local: false });
  const d = j.description ?? '';
  for (const m of d.matchAll(/\[img[^\]]*\]\s*(https?:\/\/[^\s[]+?)\s*\[\/img\]/gi)) media.images.push({ src: m[1], local: false });
  for (const m of d.matchAll(/\[youtube\]\s*([\w-]{11})\s*\[\/youtube\]/gi)) media.videos.push(m[1]);
  media.videos.push(...[...d.matchAll(YT_RE)].map((m) => m[1]));
  if (d) media.description = d;
}

function localMedia(mod: ModRecord, media: ModMedia) {
  for (const p of [mod.previewPath, mod.iconPath]) if (p && fs.existsSync(p)) media.images.push({ src: p, local: true });
  try {
    const dir = mod.localPath;
    if (dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      for (const f of fs.readdirSync(dir)) {
        if (/\.(png|jpe?g|gif|webp)$/i.test(f) && !/^_|normal|spec|emission|mask/i.test(f)) {
          media.images.push({ src: path.join(dir, f), local: true });
        }
        if (media.images.length > 12) break;
      }
    }
  } catch {
    /* ignore */
  }
}

export async function getModMedia(mod: ModRecord, nexusApiKey?: string): Promise<ModMedia> {
  const key = mod.id;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.media;
  const media: ModMedia = { images: [], videos: [], errors: [] };
  try {
    if (mod.workshopId) await workshopMedia(mod.workshopId, media);
  } catch (e) {
    media.errors.push(String((e as Error).message ?? e));
  }
  try {
    if (mod.nexusModId && mod.nexusGameDomain && nexusApiKey) await nexusMedia(mod.nexusGameDomain, mod.nexusModId, nexusApiKey, media);
  } catch (e) {
    media.errors.push(String((e as Error).message ?? e));
  }
  if (mod.remotePreviewUrl && !media.images.some((i) => i.src === mod.remotePreviewUrl)) {
    media.images.unshift({ src: mod.remotePreviewUrl, local: false });
  }
  localMedia(mod, media);
  const seen = new Set<string>();
  media.images = media.images.filter((i) => (seen.has(i.src) ? false : (seen.add(i.src), true))).slice(0, 30);
  media.videos = uniq(media.videos).slice(0, 10);
  cache.set(key, { at: Date.now(), media });
  return media;
}
