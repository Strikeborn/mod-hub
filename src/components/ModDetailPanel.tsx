import { useEffect, useMemo, useState } from 'react';
import type { GameRecord, ModRecord } from '@shared/types';
import { plainModDescription } from '@shared/plainDescription';
import { deployedDiskPath } from '@shared/modDiskPath';
import { formatBytes, formatFullDate, sourceLabel } from '../utils/format';
import { displayGameName } from '../utils/gameDisplay';
import { workshopDisplayTitle } from '../utils/workshopLabels';
import { steamAppIdForGameId } from '../utils/games';
import { AuthorLink } from './AuthorLink';
import { toast } from '../utils/toast';
import { similarInstalled } from '../utils/similarMods';
import { openModDetails } from '../utils/modDetails';

type Changes = Awaited<ReturnType<NonNullable<Window['modHub']>['getModChanges']>>;

function ChangesSection({ mod }: { mod: ModRecord }) {
  const [changes, setChanges] = useState<Changes | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setChanges(null);
    setShowAll(false);
    void window.modHub?.getModChanges(mod.id).then((c) => !cancelled && setChanges(c));
    return () => {
      cancelled = true;
    };
  }, [mod.id]);

  if (!mod.workshopId && !mod.nexusModId) return null;
  const newOnes = changes?.entries.filter((e) => e.isNew) ?? [];
  const canUpdate = Boolean(mod.workshopId && mod.revision.updateAvailable);
  const visible = changes ? (showAll ? changes.entries : changes.entries.slice(0, Math.max(5, newOnes.length))) : [];
  const label = (w?: string, v?: string) => [v, w ? formatFullDate(w) : undefined].filter(Boolean).join(' · ') || 'unknown';

  async function update() {
    setUpdating(true);
    toast(`Updating “${mod.title}”…`, 'info');
    try {
      const r = await window.modHub!.workshopUpdate(mod.id);
      toast(r.message, r.ok ? 'ok' : 'error');
    } finally {
      setUpdating(false);
    }
  }

  return (
    <section className="detail-changes">
      <div className="detail-changes-head">
        <h3>What changed</h3>
        {canUpdate && (
          <button type="button" className="btn btn-sm btn-primary" disabled={updating} onClick={() => void update()}>
            {updating ? 'Updating…' : mod.keptFromWorkshop ? 'Update copy' : 'Update now'}
          </button>
        )}
      </div>
      {!changes ? (
        <p className="detail-muted">Loading change notes…</p>
      ) : changes.error ? (
        <p className="detail-muted">Couldn't load change notes: {changes.error}</p>
      ) : (
        <>
          <p className="detail-version">
            <span>Yours: {label(changes.installed.when, changes.installed.version)}</span>
            <span>Latest: {label(changes.latest.when, changes.latest.version)}</span>
          </p>
          {changes.entries[0] && (
            <p className="detail-latest">
              <strong>Most recent change:</strong>{' '}
              {[changes.entries[0].version, changes.entries[0].when ? formatFullDate(changes.entries[0].when) : undefined]
                .filter(Boolean)
                .join(' · ')}
              {' — '}
              {changes.entries[0].notes.split('\n').find((l) => l.trim() && !/^[-=*•\s]+$/.test(l))?.slice(0, 160) ?? ''}
            </p>
          )}
          <p className={`detail-status ${newOnes.length ? 'has-new' : ''}`}>
            {newOnes.length
              ? `${newOnes.length} update${newOnes.length === 1 ? '' : 's'} newer than your copy — review below before updating.`
              : mod.keptFromWorkshop
                ? 'Your kept copy matches the latest version.'
                : 'You have the latest version.'}
          </p>
          {changes.entries.length === 0 ? (
            <p className="detail-muted">The author hasn't posted change notes.</p>
          ) : (
            <ol className="detail-changelog">
              {visible.map((e, i) => (
                <li key={`${e.when ?? e.version}-${i}`} className={e.isNew ? 'is-new' : ''}>
                  <div className="detail-change-meta">
                    {e.isNew && <span className="status-pill update">New</span>}
                    {e.version && <strong>{e.version}</strong>}
                    {e.when && <span>{formatFullDate(e.when)}</span>}
                  </div>
                  <p>{e.notes}</p>
                </li>
              ))}
            </ol>
          )}
          {changes.entries.length > visible.length && (
            <button type="button" className="btn btn-sm" onClick={() => setShowAll(true)}>
              Show all {changes.entries.length} entries
            </button>
          )}
          <p className="detail-muted">
            Change notes are written by the mod author. Mod Hub can't diff the files themselves before you download.
          </p>
        </>
      )}
    </section>
  );
}

type DiskInfo = Awaited<ReturnType<NonNullable<Window['modHub']>['getDiskInfo']>>;

function earliest(...isos: (string | undefined)[]): string | undefined {
  const ts = isos.filter(Boolean).map((s) => new Date(s!).getTime()).filter((t) => Number.isFinite(t) && t > 0);
  return ts.length ? new Date(Math.min(...ts)).toISOString() : undefined;
}

function HistorySection({ mod }: { mod: ModRecord }) {
  const [disk, setDisk] = useState<DiskInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    setDisk(null);
    void window.modHub?.getDiskInfo(mod.id).then((d) => !cancelled && setDisk(d));
    return () => {
      cancelled = true;
    };
  }, [mod.id]);
  const first = earliest(disk?.createdAt, disk?.oldestAt, mod.downloadedAt, mod.installedAt);
  return (
    <section className="detail-history">
      <h3>On your PC</h3>
      <dl className="detail-info">
        <Row label="First on this PC">{first ? formatFullDate(first) : disk ? '—' : 'Checking…'}</Row>
        <Row label="Files last changed">
          {disk?.newestAt ? (
            <>
              {formatFullDate(disk.newestAt)}
              {disk.newestFile && <span className="detail-muted-inline"> ({disk.newestFile})</span>}
            </>
          ) : disk ? (
            disk.exists ? '—' : 'Not on disk'
          ) : (
            'Checking…'
          )}
        </Row>
        {disk?.exists && (
          <Row label="Files">
            {disk.files.toLocaleString()} file{disk.files === 1 ? '' : 's'} · {formatBytes(disk.bytes)}
          </Row>
        )}
      </dl>
    </section>
  );
}

type Cross = Awaited<ReturnType<NonNullable<Window['modHub']>['findCrossPlatform']>>;

const LOCAL_LABEL: Record<string, string> = {
  subscribed: 'you are subscribed',
  'on-disk': 'on your PC (not subscribed)',
  kept: 'you have a kept copy',
  installed: 'installed via Vortex',
  downloaded: 'in Vortex downloads',
};

function CrossPlatformSection({ mod, all }: { mod: ModRecord; all: ModRecord[] }) {
  const [res, setRes] = useState<Cross | null>(null);
  const similar = similarInstalled(mod, all);
  const other = mod.workshopId ? 'Nexus' : 'Steam Workshop';

  useEffect(() => {
    let cancelled = false;
    setRes(null);
    void window.modHub?.findCrossPlatform(mod.id).then((r) => !cancelled && setRes(r));
    return () => {
      cancelled = true;
    };
  }, [mod.id]);

  const open = (c: { platform: string; url: string; id: string; domain?: string }) =>
    c.platform === 'workshop'
      ? void window.modHub?.openInSteam(c.url)
      : c.domain && void window.modHub?.nexusOpenMod(c.domain, Number(c.id));

  async function link(c: Cross['candidates'][number] | null, clear?: 'nexus' | 'workshop') {
    const r = await window.modHub!.linkCrossPlatform(
      mod.id,
      c ? { platform: c.platform, id: c.id, domain: c.domain, appId: c.appId, title: c.title } : null,
      clear,
    );
    toast(r.message, r.ok ? 'ok' : 'error');
  }

  const linkedNexus = mod.crossLinks?.nexus;
  const linkedWs = mod.crossLinks?.workshop;

  return (
    <section className="detail-cross">
      <h3>Also on {other}</h3>
      {(linkedNexus || linkedWs) && (
        <ul className="detail-cross-list">
          {linkedNexus && (
            <li className="is-linked">
              <span className="detail-cross-title">
                <strong>Linked:</strong> {linkedNexus.title ?? `Nexus mod ${linkedNexus.modId}`}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void window.modHub?.nexusOpenMod(linkedNexus.domain, linkedNexus.modId)}
              >
                Open on Nexus
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void link(null, 'nexus')}>
                Unlink
              </button>
            </li>
          )}
          {linkedWs && (
            <li className="is-linked">
              <span className="detail-cross-title">
                <strong>Linked:</strong> {linkedWs.title ?? `Workshop item ${linkedWs.workshopId}`}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void window.modHub?.openInSteam(`https://steamcommunity.com/sharedfiles/filedetails/?id=${linkedWs.workshopId}`)}
              >
                Open in Steam
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void link(null, 'workshop')}>
                Unlink
              </button>
            </li>
          )}
        </ul>
      )}
      {!res ? (
        <p className="detail-muted">Searching {other}…</p>
      ) : res.searched.length === 0 && !res.candidates.length ? (
        <p className="detail-muted">This game has no {other} to compare with.</p>
      ) : res.candidates.length === 0 ? (
        <p className="detail-muted">
          No match on {res.searched.join(' / ') || other}
          {res.error ? ` (${res.error})` : ''} — looks like it's only published here.
        </p>
      ) : (
        <ul className="detail-cross-list">
          {res.candidates.map((c) => {
            const isLinked =
              (c.platform === 'nexus' && linkedNexus?.modId === Number(c.id)) ||
              (c.platform === 'workshop' && linkedWs?.workshopId === c.id);
            return (
              <li key={c.platform + c.id}>
                <span className="detail-cross-title">
                  {c.title}
                  <span className="detail-muted-inline">
                    {' '}
                    · {c.platform === 'nexus' ? 'Nexus' : 'Workshop'}
                    {c.author ? ` · ${c.author}` : ''}
                    {c.linked ? ' · linked in description' : ` · ${Math.round(c.score * 100)}% name match`}
                    {c.local ? ` · ${LOCAL_LABEL[c.local] ?? c.local}` : ' · not on your PC'}
                  </span>
                </span>
                <button type="button" className="btn btn-sm" onClick={() => open(c)}>
                  Open
                </button>
                {!isLinked && (
                  <button type="button" className="btn btn-sm" title="Remember this as the same mod" onClick={() => void link(c)}>
                    Link
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {similar.length > 0 && (
        <>
          <h3 className="detail-sub-h">Similar mods you also have</h3>
          <ul className="detail-cross-list">
            {similar.map((s) => (
              <li key={s.id}>
                <span className="detail-cross-title">
                  {s.title}
                  <span className="detail-muted-inline">
                    {' '}
                    · {s.workshopId ? `Workshop ${s.workshopId}` : s.nexusModId ? `Nexus ${s.nexusModId}` : s.source}
                  </span>
                </span>
                <button type="button" className="btn btn-sm" onClick={() => openModDetails(s)}>
                  View
                </button>
              </li>
            ))}
          </ul>
          <p className="detail-muted">Same-name mods (forks, re-uploads, variants) can conflict when both are active.</p>
        </>
      )}
    </section>
  );
}

type Media = { kind: 'image'; src: string; local: boolean } | { kind: 'video'; id: string };

type Props = {
  mod: ModRecord;
  games: GameRecord[];
  allMods: ModRecord[];
  onClose: () => void;
};

function useImage(src: string, local: boolean): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setUrl(undefined);
    const p = local ? window.modHub?.getThumbnail(src) : window.modHub?.fetchRemoteThumbnail(src);
    void p?.then((u) => !cancelled && setUrl(u ?? null));
    return () => {
      cancelled = true;
    };
  }, [src, local]);
  return url;
}

function MediaImage({ src, local, className }: { src: string; local: boolean; className?: string }) {
  const url = useImage(src, local);
  if (url === undefined) return <div className={`detail-media-placeholder ${className ?? ''}`}>Loading…</div>;
  if (!url) return <div className={`detail-media-placeholder ${className ?? ''}`}>Image unavailable</div>;
  return <img className={className} src={url} alt="" />;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

/** Left-side panel with a media gallery and the full details of one mod. */
export function ModDetailPanel({ mod, games, allMods, onClose }: Props) {
  const [media, setMedia] = useState<{ images: { src: string; local: boolean }[]; videos: string[]; description?: string; errors: string[] } | null>(null);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setMedia(null);
    setSelected(0);
    void window.modHub?.getModMedia(mod.id).then((m) => !cancelled && setMedia(m));
    return () => {
      cancelled = true;
    };
  }, [mod.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const items: Media[] = useMemo(() => {
    const list: Media[] = [];
    if (media) {
      for (const i of media.images) list.push({ kind: 'image', src: i.src, local: i.local });
      for (const v of media.videos) list.push({ kind: 'video', id: v });
    } else if (mod.remotePreviewUrl) {
      list.push({ kind: 'image', src: mod.remotePreviewUrl, local: false });
    }
    return list;
  }, [media, mod.remotePreviewUrl]);

  const current = items[Math.min(selected, items.length - 1)];
  const title = mod.source === 'steam-workshop' ? workshopDisplayTitle(mod) : mod.title;
  const appId = mod.steamAppId ?? steamAppIdForGameId(mod.gameId);
  const description = plainModDescription(media?.description ?? mod.description, 20000);
  const diskPath = deployedDiskPath(mod);

  return (
    <div className="detail-backdrop" role="presentation" onClick={onClose}>
      <aside className="detail-panel" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="detail-header">
          <div>
            <h2>{title}</h2>
            <p className="detail-sub">
              {sourceLabel(mod.source)} · {displayGameName(mod, games)}
            </p>
          </div>
          <button type="button" className="detail-close" aria-label="Close details" onClick={onClose}>
            ×
          </button>
        </header>

        <section className="detail-gallery">
          <div className="detail-stage">
            {!current ? (
              <div className="detail-media-placeholder">{media ? 'No images or videos' : 'Loading media…'}</div>
            ) : current.kind === 'image' ? (
              <MediaImage key={current.src} src={current.src} local={current.local} className="detail-stage-img" />
            ) : (
              <iframe
                key={current.id}
                className="detail-stage-video"
                src={`https://www.youtube-nocookie.com/embed/${current.id}`}
                title="Video"
                allow="encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
              />
            )}
          </div>
          {items.length > 1 && (
            <div className="detail-thumbs">
              {items.map((it, i) => (
                <button
                  key={it.kind === 'image' ? it.src : it.id}
                  type="button"
                  className={`detail-thumb ${i === selected ? 'active' : ''}`}
                  onClick={() => setSelected(i)}
                  aria-label={it.kind === 'video' ? `Video ${i + 1}` : `Image ${i + 1}`}
                >
                  {it.kind === 'image' ? (
                    <MediaImage src={it.src} local={it.local} />
                  ) : (
                    <span className="detail-thumb-video">
                      <MediaImage src={`https://img.youtube.com/vi/${it.id}/mqdefault.jpg`} local={false} />
                      <span className="detail-play" aria-hidden>
                        ▶
                      </span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {media && (
            <p className="detail-count">
              {media.images.length} image{media.images.length === 1 ? '' : 's'} · {media.videos.length} video
              {media.videos.length === 1 ? '' : 's'}
              {media.errors.length ? ` · ${media.errors.join('; ')}` : ''}
            </p>
          )}
        </section>

        <dl className="detail-info">
          <Row label="Author">
            <AuthorLink author={mod.authorDisplayName ?? mod.author} steamId={mod.authorSteamId} appId={mod.workshopId ? appId : undefined} />
          </Row>
          {mod.version && <Row label="Version">{mod.version}</Row>}
          <Row label="Size">{formatBytes(mod.sizeBytes)}</Row>
          <Row label="Uploaded">{formatFullDate(mod.remoteCreatedAt)}</Row>
          <Row label="Last updated">{formatFullDate(mod.remoteUpdatedAt)}</Row>
          <Row label="Installed">{formatFullDate(mod.installedAt)}</Row>
          {mod.downloadedAt && <Row label="Downloaded">{formatFullDate(mod.downloadedAt)}</Row>}
          <Row label="Last seen">{formatFullDate(mod.lastSeenAt)}</Row>
          {mod.workshopId && (
            <Row label="Workshop">
              {mod.workshopId}
              {mod.steamSubscribed === false ? ' · not subscribed (downloaded by game/server)' : mod.subscribed ? ' · subscribed' : ''}
            </Row>
          )}
          {mod.nexusModId && (
            <Row label="Nexus">
              {mod.nexusGameDomain}/{mod.nexusModId}
              {mod.nexusStatus ? ` · ${mod.nexusStatus.replace(/_/g, ' ')}` : ''}
            </Row>
          )}
          {!!mod.gameVersionTags?.length && <Row label="Game versions">{mod.gameVersionTags.join(', ')}</Row>}
          {!!mod.workshopCategories?.length && <Row label="Categories">{mod.workshopCategories.join(', ')}</Row>}
          <Row label="On disk">
            <span className="detail-path">{diskPath}</span>{' '}
            {!mod.localMissing && (
              <button type="button" className="btn btn-sm" onClick={() => window.modHub?.openPath(diskPath)}>
                Open folder
              </button>
            )}
          </Row>
        </dl>

        <ChangesSection mod={mod} />
        <HistorySection mod={mod} />
        <CrossPlatformSection mod={mod} all={allMods} />

        {description && (
          <section className="detail-desc">
            <h3>Description</h3>
            <p>{description}</p>
          </section>
        )}
      </aside>
    </div>
  );
}
