import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const cache = new Map<string, string>();

function cachePath(): string {
  return path.join(app.getPath('userData'), 'steam-creator-names.json');
}

function loadDiskCache() {
  try {
    if (fs.existsSync(cachePath())) {
      const obj = JSON.parse(fs.readFileSync(cachePath(), 'utf8')) as Record<string, string>;
      for (const [k, v] of Object.entries(obj)) cache.set(k, v);
    }
  } catch {
    /* ignore */
  }
}

function saveDiskCache() {
  try {
    fs.writeFileSync(cachePath(), JSON.stringify(Object.fromEntries(cache), null, 2), 'utf8');
  } catch {
    /* ignore */
  }
}

let loaded = false;

async function fetchCreatorName(steamId: string): Promise<string | undefined> {
  try {
    const xml = await fetch(`https://steamcommunity.com/profiles/${steamId}?xml=1`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ModHub/1.0' },
    }).then((r) => (r.ok ? r.text() : ''));
    const m = xml.match(/<steamID><!\[CDATA\[([^\]]+)]]><\/steamID>/);
    return m?.[1]?.trim();
  } catch {
    return undefined;
  }
}

export async function resolveSteamCreatorNames(ids: string[]): Promise<Map<string, string>> {
  if (!loaded) {
    loadDiskCache();
    loaded = true;
  }
  const out = new Map<string, string>();
  const need = [...new Set(ids.filter((x) => /^\d{10,}$/.test(x)))].filter((id) => {
    const hit = cache.get(id);
    if (hit) {
      out.set(id, hit);
      return false;
    }
    return true;
  });

  const concurrency = 6;
  for (let i = 0; i < need.length; i += concurrency) {
    const batch = need.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (id) => {
        const name = await fetchCreatorName(id);
        if (name) {
          cache.set(id, name);
          out.set(id, name);
        }
      }),
    );
  }
  saveDiskCache();
  return out;
}

export function formatCreatorDisplay(creator: string | undefined, names: Map<string, string>): string | undefined {
  if (!creator) return undefined;
  const t = creator.trim();
  if (!/^\d{10,}$/.test(t)) return t;
  return names.get(t) ?? t;
}

export function steamProfileUrl(steamId: string): string {
  return `https://steamcommunity.com/profiles/${steamId}`;
}
