import { useEffect, useMemo, useState } from 'react';
import type { GameRecord, ModRecord } from '@shared/types';
import { formatBytes } from '../utils/format';
import { displayGameName } from '../utils/gameDisplay';
import { toast } from '../utils/toast';

type Props = {
  mods: ModRecord[];
  games: GameRecord[];
  onClose: (changed: boolean) => void;
};

const DEST: Record<string, string> = {
  'project-zomboid': 'Zomboid\\mods — game still loads them',
  rimworld: 'RimWorld\\Mods — game still loads them',
  'binding-of-isaac': 'Isaac\\mods as local mods — game still loads them',
  terraria: 'Terraria\\ResourcePacks — enable it in-game',
};

/** Copy & keep + unsubscribe every subscribed Workshop item currently shown. */
export function BulkKeepDialog({ mods, games, onClose }: Props) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string; phase: string } | null>(null);

  useEffect(() => window.modHub?.onBulkProgress(setProgress), []);

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; count: number; bytes: number }>();
    for (const m of mods) {
      const g = map.get(m.gameId) ?? { name: displayGameName(m, games), count: 0, bytes: 0 };
      g.count += 1;
      g.bytes += m.sizeBytes ?? 0;
      map.set(m.gameId, g);
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [mods, games]);
  const totalBytes = groups.reduce((n, [, g]) => n + g.bytes, 0);

  async function run() {
    if (!window.modHub) return;
    setRunning(true);
    try {
      const r = await window.modHub.workshopBulkKeep(mods.map((m) => m.id));
      toast(r.message, r.failed ? 'error' : 'ok');
      onClose(r.kept > 0);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
      setRunning(false);
    }
  }

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="modal-backdrop" role="presentation" onClick={() => !running && onClose(false)}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="bulk-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="bulk-title">Keep &amp; unsubscribe {mods.length} shown Workshop mods?</h2>
        {mods.length === 0 ? (
          <p className="modal-text">Nothing to do: no subscribed Workshop mods are shown with the current filters.</p>
        ) : (
          <>
            <p className="modal-text">
              Each mod is copied to a local folder Steam doesn't manage, then unsubscribed. From then on Steam can't
              update or delete it — you choose when to update (Update button / detail panel). About{' '}
              {formatBytes(totalBytes)} will be copied.
            </p>
            <table className="bulk-table">
              <tbody>
                {groups.map(([id, g]) => (
                  <tr key={id}>
                    <td>{g.name}</td>
                    <td>{g.count}</td>
                    <td>{formatBytes(g.bytes)}</td>
                    <td className="bulk-dest">{DEST[id] ?? "Mod Hub's kept-mods folder — backup only, the game won't load it"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="modal-text modal-note">
              Multiplayer servers that require a mod can make Steam download it again when you join.
            </p>
          </>
        )}
        {running && progress && (
          <div className="bulk-progress">
            <div className="bulk-bar">
              <span style={{ width: `${pct}%` }} />
            </div>
            <span>
              {progress.phase} {progress.done}/{progress.total}
              {progress.current ? ` — ${progress.current}` : ''}
            </span>
          </div>
        )}
        <div className="modal-actions">
          {mods.length > 0 && (
            <button type="button" className="btn btn-primary" disabled={running} onClick={() => void run()}>
              {running ? 'Working…' : `Keep & unsubscribe ${mods.length}`}
            </button>
          )}
          <button type="button" className="btn" disabled={running} onClick={() => onClose(false)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
