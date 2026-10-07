import { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { GameRecord, ModLoadState, ModRecord } from '@shared/types';
import { bestPreviewFilePath, deployedDiskPath } from '@shared/modDiskPath';
import { ModThumbnail } from './ModThumbnail';
import { formatBytes, formatFullDate, formatShortDate, sourceLabel } from '../utils/format';
import { openModDetails } from '../utils/modDetails';
import { displayGameName } from '../utils/gameDisplay';
import { workshopDisplayTitle } from '../utils/workshopLabels';
import { isNexusLikeSource, steamAppIdForGameId } from '../utils/games';
import { gameVersionsFor } from '../utils/modVersions';

type SortKey = 'order' | 'ingame' | 'for' | 'title' | 'game' | 'source' | 'author' | 'version' | 'size' | 'uploaded' | 'updated' | 'status';

type Props = {
  mods: ModRecord[];
  games: GameRecord[];
  trackedNexus?: Set<string>;
  loadStates?: Map<string, ModLoadState>;
  /** Flip a mod on/off in the game's own list (supported games only). */
  onToggleEnabled?: (mod: ModRecord, enabled: boolean) => void;
  onFavorite: (mod: ModRecord) => void;
  /** Drag rows to change the game's load order (enabled mods; table not column-sorted). */
  onReorder?: (draggedModId: string, targetModId: string) => void;
  /** When one supported game is shown, the Load order header drives the app-wide load-order sort. */
  orderSortActive?: boolean;
  onOrderSort?: (active: boolean) => void;
};

function rowTitle(m: ModRecord): string {
  return m.source === 'steam-workshop' ? workshopDisplayTitle(m) : m.title;
}

/** One short status per row; the detail panel has the full story. */
function rowStatus(m: ModRecord, trackedNexus?: Set<string>): { text: string; warn?: boolean } {
  if (m.revision.updateAvailable) return { text: 'Update available', warn: true };
  if (m.localMissing) return { text: 'Missing on disk', warn: true };
  if (m.nexusStatus && m.nexusStatus !== 'published') return { text: `Nexus: ${m.nexusStatus.replace(/_/g, ' ')}`, warn: true };
  if (m.workshopHidden) return { text: 'Hidden on Workshop', warn: true };
  if (m.keptFromWorkshop) return { text: 'Kept copy' };
  if (m.source === 'steam-workshop') {
    if (m.steamSubscribed === false) return { text: 'Not subscribed' };
    return { text: m.subscribed !== false ? 'Subscribed' : 'Unsubscribed' };
  }
  if (m.nexusModId && m.nexusGameDomain && trackedNexus?.has(`${m.nexusGameDomain.toLowerCase()}|${m.nexusModId}`)) {
    return { text: 'Tracked' };
  }
  if (m.source === 'nexus' || m.source === 'vortex-staging') return { text: 'Downloaded' };
  return { text: 'Local' };
}

function inGameText(m: ModRecord, st?: ModLoadState): string {
  if (st) return st.enabled ? 'Enabled' : 'Disabled';
  return isNexusLikeSource(m) ? 'Vortex' : '—';
}

function sortValue(
  m: ModRecord,
  key: SortKey,
  games: GameRecord[],
  trackedNexus?: Set<string>,
  st?: ModLoadState,
): string | number {
  switch (key) {
    case 'order':
      return st?.enabled ? (st.position ?? 0) : st ? 1e6 : 2e6;
    case 'ingame':
      return inGameText(m, st);
    case 'for':
      return gameVersionsFor(m)?.short ?? '';
    case 'title':
      return rowTitle(m).toLowerCase();
    case 'game':
      return displayGameName(m, games).toLowerCase();
    case 'source':
      return sourceLabel(m.source);
    case 'author':
      return (m.authorDisplayName ?? m.author ?? '').toLowerCase();
    case 'version':
      return m.version ?? '';
    case 'size':
      return m.sizeBytes ?? -1;
    case 'uploaded':
      return m.remoteCreatedAt ? Date.parse(m.remoteCreatedAt) : 0;
    case 'updated':
      return m.remoteUpdatedAt ? Date.parse(m.remoteUpdatedAt) : 0;
    case 'status':
      return rowStatus(m, trackedNexus).text;
  }
}

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: 'order', label: 'Load order', className: 'col-num col-order' },
  { key: 'title', label: 'Title', className: 'col-title' },
  { key: 'game', label: 'Game' },
  { key: 'source', label: 'Source' },
  { key: 'author', label: 'Author' },
  { key: 'version', label: 'Version', className: 'col-narrow' },
  { key: 'for', label: 'For' },
  { key: 'size', label: 'Size', className: 'col-num' },
  { key: 'uploaded', label: 'Uploaded', className: 'col-date' },
  { key: 'updated', label: 'Updated', className: 'col-date' },
  { key: 'ingame', label: 'In game' },
  { key: 'status', label: 'Status' },
];

const Row = memo(function Row({
  mod,
  games,
  status,
  loadState,
  onFavorite,
  onToggleEnabled,
  draggable,
  dragOver,
  onDragEvent,
}: {
  mod: ModRecord;
  games: GameRecord[];
  status: { text: string; warn?: boolean };
  loadState?: ModLoadState;
  onFavorite: (mod: ModRecord) => void;
  onToggleEnabled?: (mod: ModRecord, enabled: boolean) => void;
  draggable?: boolean;
  dragOver?: boolean;
  onDragEvent?: (kind: 'start' | 'over' | 'drop' | 'end', modId: string) => void;
}) {
  const title = rowTitle(mod);
  const diskPath = deployedDiskPath(mod);
  const appId = mod.steamAppId ?? steamAppIdForGameId(mod.gameId);
  const versions = gameVersionsFor(mod);
  return (
    <tr
      className={`${draggable ? 'is-draggable' : ''}${dragOver ? ' drag-over' : ''}`}
      draggable={draggable}
      title={draggable ? 'Drag to change the load order' : undefined}
      onDragStart={
        draggable
          ? (e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', mod.id);
              onDragEvent?.('start', mod.id);
            }
          : undefined
      }
      onDragOver={
        draggable
          ? (e) => {
              e.preventDefault();
              onDragEvent?.('over', mod.id);
            }
          : undefined
      }
      onDrop={
        draggable
          ? (e) => {
              e.preventDefault();
              onDragEvent?.('drop', mod.id);
            }
          : undefined
      }
      onDragEnd={draggable ? () => onDragEvent?.('end', mod.id) : undefined}
    >
      <td className="col-thumb">
        <button type="button" className="mod-table-thumb-btn" title="Show details" onClick={() => openModDetails(mod)}>
          <ModThumbnail path={bestPreviewFilePath(mod)} remoteUrl={mod.remotePreviewUrl} title={title} />
        </button>
      </td>
      <td className="col-num col-order">{loadState?.enabled ? loadState.position : ''}</td>
      <td className="col-title">
        <button type="button" className="mod-table-title" title={title} onClick={() => openModDetails(mod)}>
          {title}
        </button>
      </td>
      <td>{displayGameName(mod, games)}</td>
      <td>{sourceLabel(mod.source)}</td>
      <td className="col-ellipsis" title={mod.authorDisplayName ?? mod.author}>
        {mod.authorDisplayName ?? mod.author ?? '—'}
      </td>
      <td className="col-narrow col-ellipsis" title={mod.version}>
        {mod.version ?? '—'}
      </td>
      <td className="col-ellipsis" title={versions?.full}>
        {versions ? (versions.guessed ? <span className="mod-table-guess">{versions.short}</span> : versions.short) : '—'}
      </td>
      <td className="col-num">{formatBytes(mod.sizeBytes)}</td>
      <td className="col-date" title={formatFullDate(mod.remoteCreatedAt)}>
        {formatShortDate(mod.remoteCreatedAt)}
      </td>
      <td className="col-date" title={formatFullDate(mod.remoteUpdatedAt)}>
        {formatShortDate(mod.remoteUpdatedAt)}
      </td>
      <td>
        {loadState && onToggleEnabled ? (
          <button
            type="button"
            className={`mod-table-toggle${loadState.enabled ? ' on' : ' off'}`}
            title={loadState.enabled ? 'Enabled in game. Click to disable.' : 'Disabled in game. Click to enable.'}
            onClick={() => onToggleEnabled(mod, !loadState.enabled)}
          >
            <span className="mod-table-toggle-dot" aria-hidden />
            {loadState.enabled ? 'Enabled' : 'Disabled'}
          </button>
        ) : (
          <span className={`mod-table-ingame${loadState?.enabled ? ' on' : loadState ? ' off' : ''}`}>{inGameText(mod, loadState)}</span>
        )}
      </td>
      <td>
        <span className={`mod-table-status${status.warn ? ' warn' : ''}`}>{status.text}</span>
      </td>
      <td className="col-actions">
        <button
          type="button"
          className={`btn btn-xs ${mod.favorited ? 'btn-active' : ''}`}
          title={mod.favorited ? 'Remove from favorites' : 'Favorite'}
          onClick={() => onFavorite(mod)}
        >
          {mod.favorited ? '★' : '☆'}
        </button>
        {mod.workshopId && appId ? (
          <button
            type="button"
            className="btn btn-xs"
            title="Workshop page"
            onClick={() => void window.modHub?.steamOpenWorkshop(appId, mod.workshopId!)}
          >
            Workshop
          </button>
        ) : mod.nexusModId && mod.nexusGameDomain ? (
          <button
            type="button"
            className="btn btn-xs"
            title="Nexus mod page"
            onClick={() => void window.modHub?.nexusOpenMod(mod.nexusGameDomain!, mod.nexusModId!)}
          >
            Nexus
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-xs"
          disabled={mod.localMissing}
          title={mod.localMissing ? 'The file is no longer on disk' : diskPath}
          onClick={() => window.modHub?.openPath(diskPath)}
        >
          Folder
        </button>
      </td>
    </tr>
  );
});

/** List view: one compact sortable row per mod (click a column header to sort, again to reverse). */
export function ModTable({ mods, games, trackedNexus, loadStates, onFavorite, onToggleEnabled, onReorder, orderSortActive, onOrderSort }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [drag, setDrag] = useState<{ from: string; over?: string } | null>(null);
  const dragFrom = useRef<string | null>(null);
  const onDragEvent = useCallback(
    (kind: 'start' | 'over' | 'drop' | 'end', modId: string) => {
      if (kind === 'start') {
        dragFrom.current = modId;
        setDrag({ from: modId });
      } else if (kind === 'over') {
        setDrag((d) => (d && d.over !== modId ? { ...d, over: modId } : d));
      } else {
        const from = dragFrom.current;
        dragFrom.current = null;
        setDrag(null);
        if (kind === 'drop' && from && from !== modId) onReorder?.(from, modId);
      }
    },
    [onReorder],
  );

  const rows = useMemo(() => {
    const withStatus = mods.map((m) => ({ mod: m, status: rowStatus(m, trackedNexus) }));
    if (!sort) return withStatus;
    const keyed = withStatus.map((r) => ({ ...r, v: sortValue(r.mod, sort.key, games, trackedNexus, loadStates?.get(r.mod.id)) }));
    keyed.sort((a, b) => (a.v < b.v ? -1 : a.v > b.v ? 1 : 0) * sort.dir);
    return keyed;
  }, [mods, games, trackedNexus, loadStates, sort]);

  function onHeader(key: SortKey) {
    if (key === 'order' && onOrderSort) {
      // Load order is the game's real order (and enables dragging), not a column sort.
      setSort(null);
      onOrderSort(!(orderSortActive && !sort));
      return;
    }
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: key === 'size' || key === 'uploaded' || key === 'updated' ? -1 : 1 };
      if (s.dir === 1 && !(key === 'size' || key === 'uploaded' || key === 'updated')) return { key, dir: -1 };
      if (s.dir === -1 && (key === 'size' || key === 'uploaded' || key === 'updated')) return { key, dir: 1 };
      return null;
    });
  }

  return (
    <div className="mod-table-wrap">
      <table className="mod-table">
        <thead>
          <tr>
            <th className="col-thumb" aria-label="Image" />
            {COLUMNS.map((c) => (
              <th key={c.key} className={c.className}>
                <button
                  type="button"
                  className="mod-table-sort"
                  title={
                    c.key === 'order' && onOrderSort
                      ? "Show mods in the game's load order (drag rows to reorder where supported). Click again for title order."
                      : undefined
                  }
                  onClick={() => onHeader(c.key)}
                >
                  {c.label}
                  {sort?.key === c.key
                    ? sort.dir === 1
                      ? ' ▲'
                      : ' ▼'
                    : c.key === 'order' && orderSortActive && !sort
                      ? ' ▲'
                      : ''}
                </button>
              </th>
            ))}
            <th className="col-actions" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ mod, status }) => (
            <Row
              key={mod.id}
              mod={mod}
              games={games}
              status={status}
              loadState={loadStates?.get(mod.id)}
              onFavorite={onFavorite}
              onToggleEnabled={onToggleEnabled}
              draggable={Boolean(onReorder) && !sort && loadStates?.get(mod.id)?.enabled === true}
              dragOver={drag?.over === mod.id && drag.from !== mod.id}
              onDragEvent={onDragEvent}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
