import { useMemo, useState } from 'react';
import type { ModRecord } from '@shared/types';
import { formatBytes } from '../utils/format';
import { toast } from '../utils/toast';

type Props = {
  mod: ModRecord;
  title: string;
  gameName: string;
  /** All on-disk, not-subscribed Workshop items for the same game (for bulk delete). */
  sameGame: ModRecord[];
  onClose: (changed: boolean) => void;
};

/** Confirm removing Workshop items that a game/server downloaded without a subscription. */
export function DeleteLocalDialog({ mod, title, gameName, sameGame, onClose }: Props) {
  const [busy, setBusy] = useState<'one' | 'all' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const totalBytes = useMemo(() => sameGame.reduce((n, m) => n + (m.sizeBytes ?? 0), 0), [sameGame]);

  async function run(all: boolean) {
    if (!window.modHub) return;
    setBusy(all ? 'all' : 'one');
    setError(null);
    const targets = all ? sameGame : [mod];
    try {
      const r = await window.modHub.workshopDeleteLocal(targets.map((m) => m.id));
      if (!r.ok && r.deleted === 0) {
        setError(r.message);
        return;
      }
      const freed = formatBytes(r.bytes);
      toast(
        targets.length === 1
          ? `Deleted “${title}” (${freed}). It's in the Recycle Bin. Empty the bin to free the space.`
          : `Deleted ${r.deleted} ${gameName} items (${freed}). They're in the Recycle Bin. Empty the bin to free the space.`,
      );
      if (!r.ok) toast(r.message, 'error');
      onClose(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={() => !busy && onClose(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="del-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="del-title">Delete “{title}” from disk?</h2>
        <p className="modal-text">
          You're not subscribed to this. {gameName} or a server downloaded it ({formatBytes(mod.sizeBytes)}). It goes to
          the Recycle Bin, so you can still restore it. The game can download it again if it needs it.
        </p>
        {sameGame.length > 1 && (
          <p className="modal-text">
            There are <strong>{sameGame.length}</strong> unsubscribed {gameName} items on disk ({formatBytes(totalBytes)}).
          </p>
        )}
        {error && <p className="modal-text modal-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-danger" disabled={busy !== null} onClick={() => void run(false)}>
            {busy === 'one' ? 'Deleting…' : 'Delete this one'}
          </button>
          {sameGame.length > 1 && (
            <button type="button" className="btn btn-danger" disabled={busy !== null} onClick={() => void run(true)}>
              {busy === 'all' ? 'Deleting…' : `Delete all ${sameGame.length}`}
            </button>
          )}
          <button type="button" className="btn" disabled={busy !== null} onClick={() => onClose(false)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
