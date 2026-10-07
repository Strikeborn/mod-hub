import type { ModRecord } from '../shared/types';
import type { VortexStateIndex } from './vortexStateScanner';

const DOMAIN_ALIASES: Record<string, string> = {
  skyrimse: 'skyrimspecialedition',
};

const TITLE_DOMAIN_HINTS: Array<{ re: RegExp; domain: string }> = [
  { re: /baldur'?s?\s*gate/i, domain: 'baldursgate3' },
  { re: /script extender|bg3/i, domain: 'baldursgate3' },
  { re: /cyberpunk|cp2077|redmod/i, domain: 'cyberpunk2077' },
  { re: /skyrim/i, domain: 'skyrimspecialedition' },
  { re: /fallout\s*4/i, domain: 'fallout4' },
  { re: /rimworld/i, domain: 'rimworld' },
  { re: /stardew/i, domain: 'stardewvalley' },
  { re: /project zomboid|zomboid/i, domain: 'projectzomboid' },
];

function normalizeDomain(d: string): string {
  const lower = d.toLowerCase();
  return DOMAIN_ALIASES[lower] ?? lower;
}

/** Pick authoritative Nexus game domain from Vortex state + title hints (fixes roblox mis-tags). */
export function resolveNexusGameDomain(
  m: ModRecord,
  state: VortexStateIndex,
): string | undefined {
  const modId = m.nexusModId;
  if (!modId) return m.nexusGameDomain ? normalizeDomain(m.nexusGameDomain) : undefined;

  const fromState: string[] = [];
  for (const meta of state.byModId.values()) {
    if (meta.nexusModId === modId) fromState.push(normalizeDomain(meta.gameId));
  }
  for (const meta of state.byStagingFolder.values()) {
    if (meta.nexusModId === modId) fromState.push(normalizeDomain(meta.gameId));
  }
  const uniq = [...new Set(fromState.filter(Boolean))];
  if (uniq.length === 1) return uniq[0];

  const hintText = `${m.title} ${m.localPath}`;
  for (const { re, domain } of TITLE_DOMAIN_HINTS) {
    if (re.test(hintText)) return domain;
  }

  const gameFromHub = m.gameId?.toLowerCase();
  if (gameFromHub && gameFromHub !== 'unknown' && !gameFromHub.startsWith('steam-')) {
    const mapped = normalizeDomain(gameFromHub);
    if (uniq.includes(mapped)) return mapped;
    if (!['roblox', 'unknown'].includes(mapped)) return mapped;
  }

  if (m.nexusGameDomain) return normalizeDomain(m.nexusGameDomain);
  return uniq[0];
}

export function applyNexusGameDomainFixes(mods: ModRecord[], state: VortexStateIndex): number {
  let fixed = 0;
  for (const m of mods) {
    if (!m.nexusModId) continue;
    const resolved = resolveNexusGameDomain(m, state);
    if (!resolved) continue;
    const prev = m.nexusGameDomain?.toLowerCase();
    if (prev !== resolved) {
      m.nexusGameDomain = resolved;
      fixed += 1;
    }
  }
  return fixed;
}

function stateHasMod(state: VortexStateIndex, domain: string, modId: number): boolean {
  const keys = new Set([domain, normalizeDomain(domain), ...Object.entries(DOMAIN_ALIASES).filter(([, v]) => v === domain).map(([k]) => k)]);
  for (const k of keys) if (state.byModId.has(`${k}|${modId}`)) return true;
  return false;
}

/** Numbers in a download file name that could be a Nexus mod id (skips the ISO timestamp + random suffix). */
function idCandidatesFromFileName(fileName: string): number[] {
  const base = fileName
    .replace(/\.(zip|rar|7z)(\.\d+)?$/i, '')
    .replace(/\s\d{4}-\d{2}-\d{2}T\d{2}-\d{2}Z\s\S+$/, '');
  return [...base.matchAll(/(?:^|[\s-])(\d{2,7})(?=[\s-]|$)/g)].map((m) => Number(m[1]));
}

/**
 * Vortex metadb rows can carry the wrong Nexus id (hash lookup matched another mod). When the
 * id is unknown to Vortex state but a number in the file name is known, switch to that id and
 * drop metadata copied from the wrong mod so state/API enrichment refills it.
 */
export function fixMetadbNexusIds(mods: ModRecord[], state: VortexStateIndex): number {
  let fixed = 0;
  for (const m of mods) {
    if (!m.nexusModId || !m.nexusGameDomain || !m.tags?.includes('vortex-metadb')) continue;
    const domain = m.nexusGameDomain.toLowerCase();
    if (stateHasMod(state, domain, m.nexusModId)) continue;
    const file = (m.localPath ?? '').split(/[\\/]/).pop() ?? '';
    const better = idCandidatesFromFileName(file).find((id) => id !== m.nexusModId && stateHasMod(state, domain, id));
    if (!better) continue;
    console.log(`[Mod Hub] Nexus id fix: "${m.title}" ${domain} ${m.nexusModId} -> ${better}`);
    m.nexusModId = better;
    m.revision = { kind: 'nexus_file_id', value: String(better) };
    m.author = undefined;
    m.authorDisplayName = undefined;
    m.description = undefined;
    m.remotePreviewUrl = undefined;
    m.remoteUpdatedAt = undefined;
    m.remoteCreatedAt = undefined;
    fixed += 1;
  }
  return fixed;
}
