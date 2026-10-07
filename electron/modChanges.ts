import type { ModRecord } from '../shared/types';

export type ChangeEntry = {
  /** ISO time of the update (Workshop) */
  when?: string;
  /** Version label (Nexus) */
  version?: string;
  notes: string;
  /** Newer than what you have installed / kept. */
  isNew: boolean;
};

export type ModChanges = {
  source: 'workshop' | 'nexus' | 'none';
  installed: { when?: string; version?: string };
  latest: { when?: string; version?: string };
  entries: ChangeEntry[];
  pageUrl?: string;
  error?: string;
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function decode(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

/** Compare "1.2.10" vs "1.2.9"; non-numeric parts compared as text. */
function cmpVersion(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split(/[.\-_ ]/);
  const pb = b.replace(/^v/i, '').split(/[.\-_ ]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const nx = Number(x);
    const ny = Number(y);
    const c = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y);
    if (c) return c;
  }
  return 0;
}

async function workshopChanges(mod: ModRecord): Promise<ModChanges> {
  const pageUrl = `https://steamcommunity.com/sharedfiles/filedetails/changelog/${mod.workshopId}`;
  const installedTs = Number(mod.revision.value) || 0;
  const res = await fetch(pageUrl, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.8' } });
  if (!res.ok) throw new Error(`Workshop changelog HTTP ${res.status}`);
  const html = await res.text();
  const entries: ChangeEntry[] = [];
  for (const m of html.matchAll(/<p id="(\d{9,})"[^>]*>([\s\S]*?)<\/p>/g)) {
    const ts = Number(m[1]);
    entries.push({ when: new Date(ts * 1000).toISOString(), notes: decode(m[2]) || '(no notes)', isNew: ts > installedTs });
  }
  entries.sort((a, b) => (b.when ?? '').localeCompare(a.when ?? ''));
  return {
    source: 'workshop',
    installed: { when: installedTs ? new Date(installedTs * 1000).toISOString() : undefined },
    latest: { when: entries[0]?.when ?? mod.remoteUpdatedAt },
    entries,
    pageUrl,
  };
}

async function nexusChanges(mod: ModRecord, apiKey: string): Promise<ModChanges> {
  const base = `https://api.nexusmods.com/v1/games/${encodeURIComponent(mod.nexusGameDomain!)}/mods/${mod.nexusModId}`;
  const headers = { apikey: apiKey, accept: 'application/json' };
  const [logRes, modRes] = await Promise.all([fetch(`${base}/changelogs.json`, { headers }), fetch(`${base}.json`, { headers })]);
  const logs = logRes.ok ? ((await logRes.json()) as Record<string, string[]>) : {};
  const info = modRes.ok ? ((await modRes.json()) as { version?: string; updated_time?: string }) : {};
  const installed = mod.version;
  const entries: ChangeEntry[] = Object.entries(logs)
    .map(([version, notes]) => ({
      version,
      notes: (Array.isArray(notes) ? notes : [String(notes)]).map((n) => `• ${decode(n)}`).join('\n'),
      isNew: Boolean(installed && cmpVersion(version, installed) > 0),
    }))
    .sort((a, b) => cmpVersion(b.version!, a.version!));
  return {
    source: 'nexus',
    installed: { version: installed },
    latest: { version: info.version, when: info.updated_time },
    entries,
    pageUrl: `https://www.nexusmods.com/${mod.nexusGameDomain}/mods/${mod.nexusModId}?tab=logs`,
  };
}

export async function getModChanges(mod: ModRecord, nexusApiKey?: string): Promise<ModChanges> {
  try {
    if (mod.workshopId) return await workshopChanges(mod);
    if (mod.nexusModId && mod.nexusGameDomain && nexusApiKey) return await nexusChanges(mod, nexusApiKey);
  } catch (e) {
    return { source: mod.workshopId ? 'workshop' : 'nexus', installed: {}, latest: {}, entries: [], error: String((e as Error).message ?? e) };
  }
  return { source: 'none', installed: {}, latest: {}, entries: [] };
}
