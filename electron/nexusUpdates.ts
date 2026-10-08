import type { ModRecord } from '../shared/types';
import { cmpVersion } from './modChanges';

/**
 * "Update on Nexus": compare the installed version (from Vortex) with the mod's current version on Nexus.
 * Uses the public v2 GraphQL API (no key, no v1 rate limit). It returns at most 20 mods per request, so a
 * 700-mod library is ~36 small requests.
 */

const GRAPHQL = 'https://api.nexusmods.com/v2/graphql';
const QUERY = `query($ids:[CompositeDomainWithIdInput!]!){ legacyModsByDomain(ids:$ids){ nodes { modId version updatedAt endorsements downloads game { domainName } } } }`;

type Node = { modId: number; version?: string; updatedAt?: string; endorsements?: number; downloads?: number; game?: { domainName?: string } };

async function fetchBatch(ids: { gameDomain: string; modId: number }[]): Promise<Node[]> {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'ModHub' },
    body: JSON.stringify({ query: QUERY, variables: { ids } }),
  });
  if (!res.ok) throw new Error(`Nexus GraphQL HTTP ${res.status}`);
  const json = (await res.json()) as { data?: { legacyModsByDomain?: { nodes?: Node[] } }; errors?: { message: string }[] };
  if (json.errors?.length && !json.data?.legacyModsByDomain) throw new Error(json.errors[0].message);
  return json.data?.legacyModsByDomain?.nodes ?? [];
}

/** Version strings Vortex stores can carry a leading "v" or a file-name suffix; keep the comparable part. */
export function cleanVersion(v: string | undefined): string | undefined {
  const t = v?.trim().replace(/^v(?=\d)/i, '');
  return t && /\d/.test(t) ? t : undefined;
}

/** Plain version numbers only ("2.1.0.10", "2.02a"); date/hotfix labels like "v32-20260621-hotfix1" can't be ordered. */
export function comparable(v: string | undefined): v is string {
  return Boolean(v && /^\d+(?:[.]\d+)*[a-z]?$/i.test(v));
}

/** Returns rows whose update state changed. */
export async function checkNexusUpdates(mods: ModRecord[]): Promise<{ changed: number; checked: number; updates: number }> {
  const rows = mods.filter(
    (m) => m.nexusModId && m.nexusGameDomain && (m.source === 'nexus' || m.source === 'vortex-staging' || Boolean(m.mo2)),
  );
  const keyOf = (domain: string, id: number) => `${domain.toLowerCase()}|${id}`;
  const unique = new Map<string, { gameDomain: string; modId: number }>();
  for (const m of rows) unique.set(keyOf(m.nexusGameDomain!, m.nexusModId!), { gameDomain: m.nexusGameDomain!.toLowerCase(), modId: m.nexusModId! });
  const ids = [...unique.values()];
  const latest = new Map<string, Node>();
  for (let i = 0; i < ids.length; i += 20) {
    const nodes = await fetchBatch(ids.slice(i, i + 20));
    for (const n of nodes) if (n.game?.domainName) latest.set(keyOf(n.game.domainName, n.modId), n);
  }
  const now = new Date().toISOString();
  let changed = 0;
  let updates = 0;
  for (const m of rows) {
    const n = latest.get(keyOf(m.nexusGameDomain!, m.nexusModId!));
    if (!n) continue; // hidden/removed on Nexus: GraphQL doesn't return it
    const installed = cleanVersion(m.version);
    const remote = cleanVersion(n.version);
    const available = comparable(installed) && comparable(remote) && cmpVersion(remote, installed) > 0;
    if (m.nexusLatestVersion !== n.version || Boolean(m.nexusUpdateAvailable) !== available) changed += 1;
    m.nexusLatestVersion = n.version;
    m.nexusUpdateAvailable = available || undefined;
    m.nexusCheckedAt = now;
    if (m.nexusEndorsements !== n.endorsements) changed += 1;
    m.nexusEndorsements = n.endorsements;
    m.nexusDownloads = n.downloads;
    if (n.updatedAt && !m.remoteUpdatedAt) m.remoteUpdatedAt = n.updatedAt;
    if (available) updates += 1;
  }
  return { changed, checked: latest.size, updates };
}
