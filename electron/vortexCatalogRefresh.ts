import type { ModRecord } from '../shared/types';
import { sanitizeIsoDate } from '../shared/modDates';
import { linkCyberpunkArchivesToNexus } from './vortexMetadbScanner';
import { mergeNexusDuplicates } from './mergeNexusRecords';
import { attachVortexNexusPreviews, propagateNexusPreviewIndex } from './vortexNexusPreviews';
import {
  applyVortexStateToMods,
  scanVortexStateModMeta,
  type VortexStateIndex,
} from './vortexStateScanner';
import {
  applyVortexDeploymentToMods,
  buildVortexDeploymentIndex,
  type DeploymentApplyStats,
} from './vortexDeployment';
import { applyNexusGameDomainFixes, fixMetadbNexusIds } from './nexusGameResolve';
import { canonicalGameId } from './gamesRegistry';

export type VortexCorrelationResult = {
  state: VortexStateIndex;
  deployment: DeploymentApplyStats;
  stateApplied: number;
  mergedCount: number;
  gameIdsFixed: number;
};

/**
 * Deployment manifest + state metadata + Nexus row merge (download zip ↔ deployed archive).
 * Safe to run on catalog load without a full disk rescan.
 */
function sanitizeModDates(m: ModRecord): void {
  m.remoteCreatedAt = sanitizeIsoDate(m.remoteCreatedAt);
  m.remoteUpdatedAt = sanitizeIsoDate(m.remoteUpdatedAt);
  m.installedAt = sanitizeIsoDate(m.installedAt);
  m.downloadedAt = sanitizeIsoDate(m.downloadedAt);
}

export async function refreshModsVortexCorrelation(
  mods: ModRecord[],
  existingState?: VortexStateIndex,
): Promise<VortexCorrelationResult> {
  for (const m of mods) sanitizeModDates(m);
  const before = mods.length;
  const state = existingState ?? (await scanVortexStateModMeta());
  const deployIndex = buildVortexDeploymentIndex(state.stagingPaths);
  const deployment = applyVortexDeploymentToMods(mods, deployIndex, state);
  applyNexusGameDomainFixes(mods, state);
  const gameIdsFixed = normalizeModGameIds(mods) + fixMetadbNexusIds(mods, state);
  linkCyberpunkArchivesToNexus(mods);

  const merged = mergeNexusDuplicates(mods);
  mods.length = 0;
  mods.push(...merged);

  let stateApplied = applyVortexStateToMods(mods, state);
  stateApplied += propagateNexusPreviewIndex(mods);
  stateApplied += attachVortexNexusPreviews(mods);
  stateApplied += propagateNexusPreviewIndex(mods);
  stateApplied += applyVortexStateToMods(mods, state);

  return {
    state,
    deployment,
    stateApplied,
    mergedCount: before - mods.length,
    gameIdsFixed,
  };
}

/**
 * One game id per game: Nexus rows follow their resolved Nexus domain (not the Vortex
 * download folder they sat in), and aliases like `projectzomboid` fold into `project-zomboid`.
 */
export function normalizeModGameIds(mods: ModRecord[]): number {
  let fixed = 0;
  for (const m of mods) {
    const nexusLike = m.source === 'nexus' || m.source === 'vortex-staging';
    const basis = nexusLike && m.nexusGameDomain ? m.nexusGameDomain : m.gameId;
    const next = canonicalGameId(basis) ?? m.gameId;
    if (next && next !== m.gameId) {
      m.gameId = next;
      fixed += 1;
    }
  }
  return fixed;
}
