const NEXUS_API = 'https://api.nexusmods.com/v1';

export async function trackMod(
  apiKey: string,
  gameDomain: string,
  modId: number,
  track: boolean,
): Promise<{ ok: boolean; message: string }> {
  const url = `${NEXUS_API}/user/tracked_mods.json`;
  const body = new URLSearchParams({
    mod_id: String(modId),
    domain_name: gameDomain,
  });
  try {
    const res = await fetch(url, {
      method: track ? 'POST' : 'DELETE',
      headers: {
        apikey: apiKey,
        accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (res.ok) return { ok: true, message: track ? 'Mod tracked on Nexus.' : 'Mod untracked on Nexus.' };
    const text = await res.text();
    return { ok: false, message: text || `${res.status} ${res.statusText}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export type TrackedNexusMod = { domain: string; modId: number };

/** All tracked mods for the API key (any game). */
export async function fetchAllTrackedMods(
  apiKey: string,
): Promise<{ ok: boolean; message: string; mods: TrackedNexusMod[] }> {
  try {
    const res = await fetch(`${NEXUS_API}/user/tracked_mods.json`, {
      headers: { apikey: apiKey, accept: 'application/json' },
    });
    if (!res.ok) {
      return { ok: false, message: `Tracked list failed (${res.status})`, mods: [] };
    }
    const json = (await res.json()) as unknown;
    const mods: TrackedNexusMod[] = [];
    const rows = Array.isArray(json) ? json : (json as { mods?: unknown[] })?.mods;
    if (Array.isArray(rows)) {
      for (const row of rows as Array<{ mod_id?: number; domain_name?: string; game?: { domain_name?: string } }>) {
        const modId = Number(row.mod_id);
        const domain = String(row.domain_name ?? row.game?.domain_name ?? '').toLowerCase();
        if (domain && Number.isFinite(modId) && modId > 0) mods.push({ domain, modId });
      }
    }
    return { ok: true, message: `${mods.length} tracked mod(s) on Nexus.`, mods };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e), mods: [] };
  }
}

export async function validateNexusKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${NEXUS_API}/users/validate.json`, {
      headers: { apikey: apiKey, accept: 'application/json' },
    });
    if (!res.ok) return { ok: false, message: `Invalid key (${res.status})` };
    return { ok: true, message: 'Nexus API key valid.' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export function nexusModPageUrl(gameDomain: string, modId: number): string {
  return `https://www.nexusmods.com/${gameDomain}/mods/${modId}`;
}

export async function fetchTrackedModIds(
  apiKey: string,
  gameDomain: string,
): Promise<{ ok: boolean; message: string; modIds: number[] }> {
  try {
    const url = `${NEXUS_API}/user/tracked_mods.json?game_domain_name=${encodeURIComponent(gameDomain)}`;
    const res = await fetch(url, { headers: { apikey: apiKey, accept: 'application/json' } });
    if (!res.ok) {
      return { ok: false, message: `Tracked list failed (${res.status})`, modIds: [] };
    }
    const json = (await res.json()) as { mod_id?: number; mods?: Array<{ mod_id?: number }> };
    const ids: number[] = [];
    if (Array.isArray(json)) {
      for (const row of json as Array<{ mod_id?: number }>) {
        if (row.mod_id) ids.push(Number(row.mod_id));
      }
    } else if (Array.isArray(json.mods)) {
      for (const row of json.mods) {
        if (row.mod_id) ids.push(Number(row.mod_id));
      }
    } else if (json.mod_id) {
      ids.push(Number(json.mod_id));
    }
    return { ok: true, message: `${ids.length} tracked mod(s) on Nexus for ${gameDomain}.`, modIds: ids };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e), modIds: [] };
  }
}

export function nexusNxmUrl(gameDomain: string, modId: number, fileId?: number): string {
  if (fileId) return `nxm://${gameDomain}/mods/${modId}/files/${fileId}`;
  return `nxm://${gameDomain}/mods/${modId}`;
}
