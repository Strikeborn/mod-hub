import type { ModRecord } from '../shared/types';
import { queryWorkshopBrowse } from './workshopBrowse';
import { gameById } from './gamesRegistry';

/** Hub game id -> Nexus domain (only games that exist on Nexus). */
const NEXUS_DOMAIN: Record<string, string> = {
  'project-zomboid': 'projectzomboid',
  rimworld: 'rimworld',
  'binding-of-isaac': 'thebindingofisaacrebirth',
  garrysmod: 'garrysmod',
  'counter-strike-2': 'counterstrike2',
  cyberpunk2077: 'cyberpunk2077',
  skyrimse: 'skyrimspecialedition',
  baldursgate3: 'baldursgate3',
  stardewvalley: 'stardewvalley',
  fallout4: 'fallout4',
  '7dtd': '7daystodie',
};

/** Games whose Steam Workshop has mods (Nexus mods of these can be matched on the Workshop). */
const WORKSHOP_APPS = new Set([108600, 294100, 250900, 4000, 730, 252490, 413150, 244850, 251570, 949230]);

export type CrossCandidate = {
  platform: 'nexus' | 'workshop';
  id: string;
  title: string;
  author?: string;
  url: string;
  imageUrl?: string;
  updatedAt?: string;
  /** 0..1 title similarity (+ author bonus) */
  score: number;
  /** from a link in the description — treat as certain */
  linked?: boolean;
  /** what you have locally for it */
  local?: 'subscribed' | 'on-disk' | 'kept' | 'installed' | 'downloaded';
  domain?: string;
  appId?: number;
};

export type CrossResult = { candidates: CrossCandidate[]; searched: string[]; error?: string };

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b(b4[12]|build\s*4[12]|v?\d+(\.\d+)+|mod|the|a|an|and|for|of)\b/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
}

function similarity(a: string, b: string): number {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / Math.max(A.size, B.size);
}

function sameAuthor(a?: string, b?: string): boolean {
  const n = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return Boolean(n(a) && n(a) === n(b));
}

async function nexusSearch(domain: string, name: string): Promise<CrossCandidate[]> {
  const main = words(name).slice(0, 4).join(' ');
  if (!main) return [];
  const query = `query($name: String!, $domain: String!) { mods(filter: { name: { value: $name, op: WILDCARD }, gameDomainName: { value: $domain, op: EQUALS } }, count: 10) { nodes { modId name uploader { name } author pictureUrl updatedAt } } }`;
  const res = await fetch('https://api.nexusmods.com/v2/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { name: main, domain } }),
  });
  if (!res.ok) throw new Error(`Nexus search HTTP ${res.status}`);
  const j = (await res.json()) as {
    data?: { mods?: { nodes?: { modId: number; name: string; author?: string; uploader?: { name?: string }; pictureUrl?: string; updatedAt?: string }[] } };
    errors?: { message: string }[];
  };
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return (j.data?.mods?.nodes ?? []).map((n) => ({
    platform: 'nexus' as const,
    id: String(n.modId),
    title: n.name,
    author: n.author || n.uploader?.name,
    url: `https://www.nexusmods.com/${domain}/mods/${n.modId}`,
    imageUrl: n.pictureUrl,
    updatedAt: n.updatedAt,
    score: 0,
    domain,
  }));
}

async function workshopSearch(appId: number, name: string): Promise<CrossCandidate[]> {
  const main = words(name).slice(0, 5).join(' ');
  if (!main) return [];
  const r = await queryWorkshopBrowse({ appId, searchText: main, numPerPage: 10, sort: 'rated' });
  if (r.error && !r.items.length) throw new Error(r.error);
  return r.items.map((i) => ({
    platform: 'workshop' as const,
    id: i.workshopId,
    title: i.title,
    author: i.author,
    url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${i.workshopId}`,
    imageUrl: i.previewUrl,
    updatedAt: i.timeUpdated ? new Date(i.timeUpdated * 1000).toISOString() : undefined,
    score: 0,
    appId,
  }));
}

/** Links to the other platform written in the description. */
function descriptionLinks(mod: ModRecord): CrossCandidate[] {
  const d = mod.description ?? '';
  const out: CrossCandidate[] = [];
  for (const m of d.matchAll(/nexusmods\.com\/([a-z0-9]+)\/mods\/(\d+)/gi)) {
    out.push({ platform: 'nexus', id: m[2], domain: m[1].toLowerCase(), title: `Nexus mod ${m[2]}`, url: `https://www.nexusmods.com/${m[1]}/mods/${m[2]}`, score: 1, linked: true });
  }
  for (const m of d.matchAll(/steamcommunity\.com\/(?:sharedfiles|workshop)\/filedetails\/\?id=(\d+)/gi)) {
    if (m[1] === mod.workshopId) continue;
    out.push({ platform: 'workshop', id: m[1], title: `Workshop item ${m[1]}`, url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${m[1]}`, score: 1, linked: true });
  }
  return out;
}

/** Look for the same mod on the other platform (Nexus <-> Steam Workshop). */
export async function findCrossPlatform(mod: ModRecord, catalog: ModRecord[]): Promise<CrossResult> {
  const searched: string[] = [];
  let found: CrossCandidate[] = descriptionLinks(mod);
  let error: string | undefined;
  const isWorkshop = Boolean(mod.workshopId);
  try {
    if (isWorkshop) {
      const domain = NEXUS_DOMAIN[mod.gameId];
      if (domain) {
        searched.push(`Nexus (${domain})`);
        found.push(...(await nexusSearch(domain, mod.title)));
      }
    }
    if (mod.nexusModId) {
      const appId = mod.steamAppId ?? gameById(mod.gameId)?.steamAppId;
      if (appId && WORKSHOP_APPS.has(appId)) {
        searched.push(`Steam Workshop (${appId})`);
        found.push(...(await workshopSearch(appId, mod.title)));
      }
    }
  } catch (e) {
    error = String((e as Error).message ?? e);
  }

  const author = mod.authorDisplayName ?? mod.author;
  for (const c of found) {
    if (!c.linked) c.score = Math.min(1, similarity(mod.title, c.title) + (sameAuthor(author, c.author) ? 0.25 : 0));
    const local = catalog.find((m) =>
      c.platform === 'nexus' ? m.nexusModId === Number(c.id) && (m.nexusGameDomain ?? '').toLowerCase() === c.domain : m.workshopId === c.id,
    );
    if (local) {
      c.local = local.keptFromWorkshop
        ? 'kept'
        : local.source === 'steam-workshop'
          ? local.steamSubscribed === false
            ? 'on-disk'
            : 'subscribed'
          : local.localMissing
            ? 'downloaded'
            : 'installed';
      if (c.title.startsWith('Nexus mod') || c.title.startsWith('Workshop item')) c.title = local.title;
    }
  }
  const seen = new Set<string>();
  found = found
    .filter((c) => !(c.platform === 'workshop' && c.id === mod.workshopId))
    .filter((c) => !(c.platform === 'nexus' && Number(c.id) === mod.nexusModId))
    .filter((c) => c.linked || c.score >= 0.34)
    .sort((a, b) => Number(Boolean(b.linked)) - Number(Boolean(a.linked)) || b.score - a.score)
    .filter((c) => (seen.has(c.platform + c.id) ? false : (seen.add(c.platform + c.id), true)))
    .slice(0, 5);
  return { candidates: found, searched, error };
}
