import { isGuess404NexusThumb } from './nexusImageIds';

const NEXUS_API = 'https://api.nexusmods.com/v1';

export type NexusModDetails = {
  name?: string;
  picture_url?: string;
  author?: string;
  uploaded_timestamp?: number;
  updated_timestamp?: number;
  version?: string;
  status?: string;
  available?: boolean;
};

export async function fetchNexusModDetails(
  apiKey: string,
  gameDomain: string,
  modId: number,
): Promise<NexusModDetails | null> {
  try {
    const url = `${NEXUS_API}/games/${encodeURIComponent(gameDomain)}/mods/${modId}.json`;
    const res = await fetch(url, {
      headers: { apikey: apiKey, accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as NexusModDetails;
  } catch {
    return null;
  }
}

const DEFAULT_MAX_API_PER_SCAN = 120;
/** Don't re-ask Nexus about a mod it couldn't fill for this long. */
const RECHECK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

type ModRecord = import('../shared/types').ModRecord;

/**
 * A scan builds rows fresh from disk; copy what earlier Nexus calls already found onto them
 * (matched by disk path, then Nexus id) so the API fill-in only runs for data that is really missing.
 */
export function hydrateNexusFieldsFromPrevious(mods: ModRecord[], previous: ModRecord[]): number {
  const byPath = new Map(previous.map((m) => [m.localPath.toLowerCase(), m]));
  const byNexus = new Map<string, ModRecord>();
  for (const m of previous) if (m.nexusModId && m.nexusGameDomain) byNexus.set(`${m.nexusGameDomain}|${m.nexusModId}`, m);
  let hydrated = 0;
  for (const m of mods) {
    const old =
      (m.nexusModId && m.nexusGameDomain ? byNexus.get(`${m.nexusGameDomain}|${m.nexusModId}`) : undefined) ??
      byPath.get(m.localPath.toLowerCase());
    if (!old) continue;
    const before = JSON.stringify(m);
    if (!m.remotePreviewUrl && old.remotePreviewUrl && !isGuess404NexusThumb(old.remotePreviewUrl)) {
      m.remotePreviewUrl = old.remotePreviewUrl;
      if (old.remotePreviewFromApi) m.remotePreviewFromApi = true;
    }
    m.remoteCreatedAt ||= old.remoteCreatedAt;
    m.remoteUpdatedAt ||= old.remoteUpdatedAt;
    m.nexusStatus ||= old.nexusStatus;
    m.author ||= old.author;
    m.version ||= old.version;
    m.nexusApiCheckedAt ||= old.nexusApiCheckedAt;
    if (titleNeedsFix(m) && !titleNeedsFix(old)) m.title = old.title;
    if (JSON.stringify(m) !== before) hydrated += 1;
  }
  return hydrated;
}

function recentlyChecked(m: ModRecord, now: number): boolean {
  if (!m.nexusApiCheckedAt) return false;
  return now - Date.parse(m.nexusApiCheckedAt) < RECHECK_AFTER_MS;
}

/** Placeholder or raw Vortex file-name titles ("FNIS Behavior SE 7_6-3038-7-6-1582048023"). */
function titleNeedsFix(m: { title: string; nexusModId?: number }): boolean {
  if (m.title.startsWith('Nexus mod') || m.title.length < 3) return true;
  return Boolean(m.nexusModId && new RegExp(`-${m.nexusModId}-[\\d-]+-\\d{9,}$`).test(m.title));
}

export async function enrichModsWithNexusApi(
  mods: import('../shared/types').ModRecord[],
  apiKey: string | undefined,
  onProgress?: (current: number, total: number) => void,
  maxCalls: number = DEFAULT_MAX_API_PER_SCAN,
  onCalled?: (m: import('../shared/types').ModRecord) => void,
): Promise<{ called: number; skipped: number }> {
  if (!apiKey?.trim()) return { called: 0, skipped: 0 };
  const now = Date.now();
  const targets = mods.filter((m) => {
    if (!m.nexusModId || !m.nexusGameDomain) return false;
    if (recentlyChecked(m, now)) return false;
    const needsImage =
      !m.previewPath &&
      (!m.remotePreviewUrl || isGuess404NexusThumb(m.remotePreviewUrl));
    const needsDate = !m.remoteCreatedAt;
    const needsTitle = titleNeedsFix(m);
    const needsStatus = !m.nexusStatus && (m.tags?.includes('vortex-metadb') || m.localMissing);
    return needsImage || needsDate || needsTitle || needsStatus;
  });
  let i = 0;
  let called = 0;
  for (const m of targets) {
    if (called >= maxCalls) break;
    i += 1;
    onProgress?.(i, Math.min(targets.length, maxCalls));
    const needsImage =
      !m.previewPath &&
      (!m.remotePreviewUrl || isGuess404NexusThumb(m.remotePreviewUrl));
    const needsDate = !m.remoteCreatedAt;
    const needsTitle = titleNeedsFix(m);
    const needsStatus = !m.nexusStatus && (m.tags?.includes('vortex-metadb') || m.localMissing);
    if (!needsImage && !needsDate && !needsTitle && !needsStatus) continue;

    called += 1;
    onCalled?.(m);
    m.nexusApiCheckedAt = new Date().toISOString();
    const d = await fetchNexusModDetails(apiKey, m.nexusGameDomain!, m.nexusModId!);
    await new Promise((r) => setTimeout(r, 150));
    if (!d) continue;
    if (needsTitle && d.name) m.title = d.name;
    if (d.author && !m.author) m.author = d.author;
    if (needsImage && d.picture_url) {
      m.remotePreviewUrl = d.picture_url;
      m.remotePreviewFromApi = true;
    }
    if (needsDate && d.uploaded_timestamp) {
      m.remoteCreatedAt = new Date(d.uploaded_timestamp * 1000).toISOString();
    }
    if (d.updated_timestamp && !m.remoteUpdatedAt) {
      m.remoteUpdatedAt = new Date(d.updated_timestamp * 1000).toISOString();
    }
    if (d.version && !m.version) m.version = d.version;
    if (d.status) m.nexusStatus = d.status;
  }
  return { called, skipped: Math.max(0, targets.length - called) };
}
