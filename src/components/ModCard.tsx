import { memo, useState } from 'react';
import type { GameRecord, IsaacConflicts, ModLoadState, ModRecord, SecurityStatus } from '@shared/types';
import { plainModDescription } from '@shared/plainDescription';
import { bestPreviewFilePath, deployedDiskPath } from '@shared/modDiskPath';
import { ModThumbnail } from './ModThumbnail';
import { StarRating } from './StarRating';
import { compactNumber, ratingTitle, workshopRating } from '../utils/workshopRating';
import { formatBytes, formatFullDate, formatShortDate, sourceLabel } from '../utils/format';
import { openModDetails } from '../utils/modDetails';
import { similarInstalled } from '../utils/similarMods';
import { displayGameName } from '../utils/gameDisplay';
import { isWorkshopStubTitle, workshopDisplayTitle } from '../utils/workshopLabels';
import { AuthorLink } from './AuthorLink';
import { steamAppIdForGameId } from '../utils/games';
import { toast } from '../utils/toast';

type Props = {
  mod: ModRecord;
  /** Enabled/position in the game's own mod list, when the game is supported. */
  loadState?: ModLoadState;
  onToggleEnabled?: (mod: ModRecord, enabled: boolean) => void;
  /** Isaac: resource files this mod wins/loses against other enabled mods. */
  conflict?: IsaacConflicts['perMod'][string];
  /** Malware-check overview for this mod. */
  security?: { status: SecurityStatus; executables: number; stale: boolean; checkedAt?: string; lua?: string[] };
  games: GameRecord[];
  variant?: 'steam' | 'nexus' | 'library';
  trackedNexus?: Set<string>;
  onTrackedNexusChange?: () => void;
  onFavorite: (mod: ModRecord) => void;
  onSubscribe?: (mod: ModRecord) => void;
  onDeleteLocal?: (mod: ModRecord) => void;
  onDismiss?: (mod: ModRecord) => void;
};

function appId(mod: ModRecord): number {
  return mod.steamAppId ?? steamAppIdForGameId(mod.gameId) ?? 108600;
}

function nexusTrackKey(mod: ModRecord): string | undefined {
  if (!mod.nexusModId || !mod.nexusGameDomain) return undefined;
  return `${mod.nexusGameDomain.toLowerCase()}|${mod.nexusModId}`;
}

/** Memoized: typing in search or scrolling must not re-render 1,600 unchanged cards. */
export const ModCard = memo(function ModCard({
  mod,
  loadState,
  onToggleEnabled,
  conflict,
  security,
  games,
  variant = 'library',
  trackedNexus,
  onTrackedNexusChange,
  onFavorite,
  onSubscribe,
  onDeleteLocal,
  onDismiss,
}: Props) {
  const showSteamActions = variant === 'steam' || mod.source === 'steam-workshop';
  const isKept = Boolean(mod.keptFromWorkshop);
  const showNexusActions = variant === 'nexus' || mod.source === 'nexus' || mod.source === 'vortex-staging';

  const trackKey = nexusTrackKey(mod);
  const isTracked = trackKey ? trackedNexus?.has(trackKey) === true : false;

  async function openWorkshop() {
    if (!mod.workshopId || !window.modHub) return;
    await window.modHub.steamOpenWorkshop(appId(mod), mod.workshopId);
  }

  const [updating, setUpdating] = useState(false);
  async function runUpdate() {
    if (!window.modHub) return;
    setUpdating(true);
    toast(`Updating “${title}”…`, 'info');
    try {
      const r = await window.modHub.workshopUpdate(mod.id);
      toast(r.message, r.ok ? 'ok' : 'error');
    } finally {
      setUpdating(false);
    }
  }

  async function openNexusPage() {
    if (!mod.nexusGameDomain || !mod.nexusModId || !window.modHub) return;
    await window.modHub.nexusOpenMod(mod.nexusGameDomain, mod.nexusModId);
  }

  async function nexusDownload() {
    if (!mod.nexusGameDomain || !mod.nexusModId || !window.modHub) return;
    const r = await window.modHub.nexusDownloadMod(mod.nexusGameDomain, mod.nexusModId);
    toast(r.message, r.ok ? 'info' : 'error');
  }

  async function nexusTrackToggle() {
    if (!mod.nexusGameDomain || !mod.nexusModId || !window.modHub) return;
    const r = await window.modHub.nexusTrackMod(mod.nexusGameDomain, mod.nexusModId, !isTracked);
    if (!r.ok) toast(r.message, 'error');
    else {
      toast(isTracked ? `Stopped tracking “${title}” on Nexus.` : `Tracking “${title}” on Nexus.`);
      onTrackedNexusChange?.();
    }
  }

  const subscribed = mod.subscribed !== false && mod.source === 'steam-workshop';
  const serverDownloaded = mod.source === 'steam-workshop' && mod.steamSubscribed === false;
  const nexusUnavailable = Boolean(mod.nexusStatus && mod.nexusStatus !== 'published');
  const similar = similarInstalled(mod);
  const linkedNexus = !mod.nexusModId ? mod.crossLinks?.nexus : undefined;
  const linkedWorkshop = !mod.workshopId ? mod.crossLinks?.workshop : undefined;
  const onDiskPath = deployedDiskPath(mod);
  const thumbPath = bestPreviewFilePath(mod);
  const gameName = displayGameName(mod, games);
  const title = mod.source === 'steam-workshop' ? workshopDisplayTitle(mod) : mod.title;
  const description = plainModDescription(mod.description, 220);
  const rating = workshopRating(mod);
  const reupload = mod.reuploadCandidates?.[0];
  const stubTitle = mod.source === 'steam-workshop' && isWorkshopStubTitle(mod.title);

  return (
    <article className="mod-card">
      <button type="button" className="mod-card-thumb-btn" title="Show details" onClick={() => openModDetails(mod)}>
        <ModThumbnail path={thumbPath} remoteUrl={mod.remotePreviewUrl} title={title} />
      </button>
      <div className="mod-card-body">
        <div className="mod-card-title-row">
          <h3 className="mod-card-title">
            <button type="button" className="mod-card-title-btn" title="Show details" onClick={() => openModDetails(mod)}>
              {title}
            </button>
          </h3>
        </div>
        <div className="mod-card-meta">
          <span>
            {sourceLabel(mod.source)} · {gameName}
          </span>
          {(mod.author || mod.authorDisplayName) && (
            <span>
              Author:{' '}
              <AuthorLink
                author={mod.authorDisplayName ?? mod.author}
                steamId={mod.authorSteamId}
                appId={mod.workshopId ? appId(mod) : undefined}
              />
            </span>
          )}
          {rating && (
            <span className="mod-card-rating" title={ratingTitle(rating)}>
              {rating.few ? (
                <span className="star-rating star-rating-empty">Few ratings ({rating.total})</span>
              ) : (
                <>
                  <StarRating score={rating.stars} />
                  <span className="mod-card-votes">({rating.total.toLocaleString()})</span>
                </>
              )}
            </span>
          )}
          {!rating && mod.nexusEndorsements != null && (
            <span
              className="mod-card-rating"
              title={`Nexus: ${mod.nexusEndorsements.toLocaleString()} endorsements, ${(mod.nexusDownloads ?? 0).toLocaleString()} downloads`}
            >
              <span className="nexus-endorse">♥ {compactNumber(mod.nexusEndorsements)}</span>
              {mod.nexusDownloads != null && <span className="mod-card-votes">⬇ {compactNumber(mod.nexusDownloads)}</span>}
            </span>
          )}
          {security && (security.executables > 0 || (security.status !== 'unchecked' && security.status !== 'clean')) && (
            <button
              type="button"
              className={`status-pill sec-pill sec-${security.status}${security.stale ? ' sec-stale' : ''}`}
              title={`${security.executables} program/DLL/script file(s) in this mod. ${
                security.status === 'unchecked'
                  ? 'Not checked for malware yet.'
                  : `Last malware check: ${security.status}${security.stale ? ' (files changed since)' : ''}.`
              } Click for details.`}
              onClick={() => openModDetails(mod)}
            >
              {security.status === 'threat'
                ? '⛔ Defender found a threat'
                : security.status === 'flagged'
                  ? '⚠ VirusTotal flags this mod'
                  : security.status === 'review'
                    ? '⚠ 1–2 VirusTotal engines flag it'
                    : security.status === 'clean'
                      ? `✓ ${security.executables} exe/DLL checked clean`
                      : `${security.executables} exe/DLL · not checked`}
              {security.stale ? ' · changed' : ''}
            </button>
          )}
          {security?.lua && (
            <span
              className="status-pill sec-pill sec-flagged"
              title={`This mod's scripts use: ${security.lua.join(', ')}. Isaac blocks these unless LuaDebug is on, which removes the sandbox for every mod. Mod Hub keeps LuaDebug off.`}
            >
              ⚠ Wants LuaDebug ({security.lua[0].split(' (')[0]}
              {security.lua.length > 1 ? ` +${security.lua.length - 1}` : ''})
            </span>
          )}
          {conflict && conflict.losses > 0 && (
            <span
              className="status-pill update"
              title={`${conflict.losses} of this mod's files are replaced by: ${[...new Set(conflict.lostTo)].join(', ')} (they load first). Disable those or this mod if it looks wrong.`}
            >
              {conflict.losses} file{conflict.losses === 1 ? '' : 's'} overridden by {conflict.lostTo[0]}
              {new Set(conflict.lostTo).size > 1 ? ` +${new Set(conflict.lostTo).size - 1}` : ''}
            </span>
          )}
          {conflict && conflict.wins > 0 && conflict.losses === 0 && (
            <span
              className="status-pill"
              title={`This mod's files replace ${conflict.wins} file(s) from: ${[...new Set(conflict.winsOver)].join(', ')}.`}
            >
              Overrides {conflict.wins} file{conflict.wins === 1 ? '' : 's'} of {new Set(conflict.winsOver).size} mod
              {new Set(conflict.winsOver).size === 1 ? '' : 's'}
            </span>
          )}
          {mod.nexusUpdateAvailable && mod.nexusModId && mod.nexusGameDomain && (
            <button
              type="button"
              className="status-pill update reupload-pill"
              title="A newer version is on Nexus. Click to open the mod page (download it through Vortex as usual)."
              onClick={() => void window.modHub?.nexusOpenMod(mod.nexusGameDomain!, mod.nexusModId!)}
            >
              Update on Nexus: {mod.version} → {mod.nexusLatestVersion}
            </button>
          )}
          {reupload && (
            <button
              type="button"
              className="status-pill update reupload-pill"
              title={`Removed from the Workshop. Possible re-upload: “${reupload.title}” by ${reupload.ownerName ?? reupload.ownerSteamId ?? 'unknown'}${
                reupload.sameAuthor === 'yes' ? ' (same author)' : reupload.sameAuthor === 'no' ? ' (different uploader)' : ''
              }. Click to open its Workshop page. Nothing is subscribed automatically.`}
              onClick={() => void window.modHub?.steamOpenWorkshop(reupload.appId, reupload.workshopId)}
            >
              {reupload.installed ? 'Re-upload installed: ' : 'Re-uploaded? '}
              {reupload.title}
              {reupload.sameAuthor === 'yes' ? ' · same author ✓' : reupload.sameAuthor === 'no' ? ' · other uploader' : ''}
            </button>
          )}
          {loadState && (
            <button
              type="button"
              className={`status-pill load-pill${loadState.enabled ? ' load-pill-on' : ''}`}
              disabled={!onToggleEnabled || loadState.readOnly}
              title={
                loadState.enabled
                  ? `Enabled in game, load order ${loadState.position}. Click to disable.`
                  : 'Disabled in game. Click to enable.'
              }
              onClick={() => onToggleEnabled?.(mod, !loadState.enabled)}
            >
              {loadState.enabled ? `Enabled · load order ${loadState.position}` : 'Disabled in game'}
              {loadState.readOnly ? ' (Vortex)' : ''}
            </button>
          )}
          {stubTitle && (
            <span className="status-pill update" title="Workshop page missing or unpublished; files kept locally">
              Local copy — Workshop page unavailable
            </span>
          )}
          {mod.workshopHidden && (
            <span className="status-pill update" title="Steam Workshop page hidden, private, or removed">
              Hidden on Workshop — still on disk
            </span>
          )}
          {similar.length > 0 && (
            <span
              className="status-pill update"
              title={`Same-name mod(s) also installed: ${similar.map((s) => s.title).join(', ')}. Open details to compare.`}
            >
              Similar mod also installed: {similar[0].title}
              {similar.length > 1 ? ` +${similar.length - 1}` : ''}
            </span>
          )}
          {serverDownloaded && (
            <span
              className="status-pill update"
              title="Steam has this on disk but you never subscribed: a game or server downloaded it (e.g. joining a server)."
            >
              Not subscribed — downloaded by a game/server
            </span>
          )}
          {mod.nexusStatus && mod.nexusStatus !== 'published' && (
            <span className="status-pill update" title={`Nexus status: ${mod.nexusStatus}`}>
              {mod.nexusStatus === 'not_published'
                ? 'Unpublished on Nexus (draft)'
                : mod.nexusStatus === 'hidden'
                  ? 'Hidden on Nexus'
                  : mod.nexusStatus === 'removed'
                    ? 'Removed from Nexus'
                    : mod.nexusStatus === 'wastebinned'
                      ? 'Deleted from Nexus'
                      : mod.nexusStatus === 'under_moderation'
                        ? 'Under moderation on Nexus'
                        : `Nexus: ${mod.nexusStatus.replace(/_/g, ' ')}`}
            </span>
          )}
          {mod.tags?.includes('vault') && (
            <span className="status-pill" title={mod.localPath}>
              Saved by Mod Hub vault — Vortex removed its copy
            </span>
          )}
          {mod.localMissing && (
            <span className="status-pill update" title={mod.localPath}>
              Download no longer on disk
            </span>
          )}
          {mod.workshopArchived && (
            <span
              className="status-pill"
              title={`Removed from the Workshop. Author/dates/image are the last known details (${mod.workshopArchived.source}${
                mod.workshopArchived.note ? `: ${mod.workshopArchived.note}` : ''
              }).${mod.workshopArchived.requiredDlc?.length ? ` Required DLC: ${mod.workshopArchived.requiredDlc.join(', ')}.` : ''}`}
            >
              Last known Workshop info ({mod.workshopArchived.source})
            </span>
          )}
          {mod.thunderstore && (
            <span className={`status-pill${mod.thunderstore.enabled ? '' : ' update'}`} title={`r2modman profile “${mod.thunderstore.profile}”: ${mod.thunderstore.packageName}`}>
              Thunderstore · {mod.thunderstore.profile}
              {mod.thunderstore.enabled ? '' : ' · disabled'}
            </span>
          )}
          {mod.tags?.includes('isaac-game-copy') && (
            <span
              className="status-pill update"
              title={`Only in the game's mods folder (${mod.localPath}). Not subscribed, so Steam won't update or remove it; the game still loads it.`}
            >
              Isaac mods folder only — not subscribed
            </span>
          )}
          {mod.keptFromWorkshop && (
            <span className="status-pill" title={`Workshop item ${mod.keptFromWorkshop.workshopId}`}>
              Kept local copy — Steam won't update it
            </span>
          )}
          {description && <p className="mod-card-desc">{description}</p>}
          {mod.version && <span>Version: {mod.version}</span>}
          <span>Size: {formatBytes(mod.sizeBytes)}</span>
          <span
            className="mod-card-dates"
            title={`Uploaded ${formatFullDate(mod.remoteCreatedAt)}\nLast updated ${formatFullDate(mod.remoteUpdatedAt)}`}
          >
            Up {formatShortDate(mod.remoteCreatedAt)} · Upd {formatShortDate(mod.remoteUpdatedAt)}
          </span>
          {mod.revision.updateAvailable && <span className="status-pill update">Update on Workshop</span>}
        </div>
        <div className="mod-card-actions">
          <button type="button" className={`btn btn-sm ${mod.favorited ? 'btn-active' : ''}`} onClick={() => onFavorite(mod)}>
            {mod.favorited ? 'Favorited' : 'Favorite'}
          </button>
          {showSteamActions && mod.workshopId && onSubscribe && (
            <>
              <button
                type="button"
                className={`btn btn-sm ${subscribed ? 'btn-active' : ''}`}
                onClick={() => onSubscribe(mod)}
                title={subscribed ? 'Unsubscribe (keep a copy or delete)' : 'Subscribe through Steam'}
              >
                {subscribed ? 'Subscribed' : 'Subscribe'}
              </button>
              {mod.revision.updateAvailable && (
                <button type="button" className="btn btn-sm btn-primary" disabled={updating} onClick={() => void runUpdate()}>
                  {updating ? 'Updating…' : 'Update'}
                </button>
              )}
              <button type="button" className="btn btn-sm" onClick={openWorkshop}>
                Workshop page
              </button>
              {serverDownloaded && onDeleteLocal && (
                <button type="button" className="btn btn-sm btn-danger" onClick={() => onDeleteLocal(mod)}>
                  Delete
                </button>
              )}
            </>
          )}
          {isKept && mod.workshopId && (
            <>
              {mod.revision.updateAvailable && (
                <button type="button" className="btn btn-sm btn-primary" disabled={updating} onClick={() => void runUpdate()}>
                  {updating ? 'Updating…' : 'Update copy'}
                </button>
              )}
              <button type="button" className="btn btn-sm" onClick={openWorkshop}>
                Workshop page
              </button>
            </>
          )}
          {showNexusActions && mod.nexusModId && mod.nexusGameDomain && (
            <>
              {mod.localMissing ? (
                <button type="button" className="btn btn-sm btn-primary" onClick={nexusDownload}>
                  Download (nxm)
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm btn-active"
                  title="Already downloaded (Vortex). Click to download again through Vortex (nxm link)."
                  onClick={nexusDownload}
                >
                  Downloaded
                </button>
              )}
              <button type="button" className={`btn btn-sm ${isTracked ? 'btn-active' : ''}`} onClick={() => void nexusTrackToggle()}>
                {isTracked ? 'Tracked' : 'Track'}
              </button>
            </>
          )}
          <button
            type="button"
            className="btn btn-sm"
            disabled={mod.localMissing}
            title={mod.localMissing ? 'The file is no longer on disk' : onDiskPath}
            onClick={() => window.modHub?.openPath(onDiskPath)}
          >
            Open folder
          </button>
          {showNexusActions && mod.nexusModId && mod.nexusGameDomain && (
            <button
              type="button"
              className="btn-nexus-link"
              disabled={nexusUnavailable}
              title={nexusUnavailable ? `No public Nexus page (${mod.nexusStatus?.replace(/_/g, ' ')})` : 'Open mod page on Nexus Mods'}
              aria-label="Open on Nexus Mods"
              onClick={() => void openNexusPage()}
            >
              N
            </button>
          )}
          {linkedWorkshop && (
            <button
              type="button"
              className="btn btn-sm"
              title="Linked Steam Workshop page (opens in Steam)"
              onClick={() =>
                void window.modHub?.openInSteam(`https://steamcommunity.com/sharedfiles/filedetails/?id=${linkedWorkshop.workshopId}`)
              }
            >
              Workshop page
            </button>
          )}
          {linkedNexus && (
            <button
              type="button"
              className="btn-nexus-link"
              title={`Linked Nexus page: ${linkedNexus.title ?? linkedNexus.modId}`}
              aria-label="Open linked Nexus page"
              onClick={() => void window.modHub?.nexusOpenMod(linkedNexus.domain, linkedNexus.modId)}
            >
              N
            </button>
          )}
          {mod.localMissing && onDismiss && (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => onDismiss(mod)}>
              Remove from list
            </button>
          )}
        </div>
      </div>
    </article>
  );
});
