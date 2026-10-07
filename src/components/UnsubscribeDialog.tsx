import { useEffect, useState } from 'react';
import type { ModRecord } from '@shared/types';
import { toast } from '../utils/toast';

type Props = {
  mod: ModRecord;
  title: string;
  onClose: (changed: boolean) => void;
};

/** Ask how to unsubscribe from a Workshop item: keep a local copy, delete, or cancel. */
export function UnsubscribeDialog({ mod, title, onClose }: Props) {
  const [busy, setBusy] = useState<'keep' | 'delete' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose(Boolean(result?.ok));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, result, onClose]);

  async function run(keep: boolean) {
    if (!window.modHub) return;
    setBusy(keep ? 'keep' : 'delete');
    try {
      const r = await window.modHub.workshopUnsubscribe(mod.id, keep);
      if (r.ok) {
        toast(r.message);
        onClose(true);
        return;
      }
      setResult(r);
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={() => !busy && onClose(Boolean(result?.ok))}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="unsub-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="unsub-title">Unsubscribe from “{title}”?</h2>
        {!result ? (
          <>
            <p className="modal-text">
              Unsubscribing tells Steam to stop updating this item and delete its Workshop files.
            </p>
            <ul className="modal-options">
              <li>
                <strong>Copy &amp; keep</strong> — save a local copy first (Project Zomboid / RimWorld / Isaac: into the game's
                own mods folder so it still loads), then unsubscribe. Steam can't update or remove the copy.
              </li>
              <li>
                <strong>Delete</strong> — unsubscribe and let Steam remove the files.
              </li>
            </ul>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void run(true)}>
                {busy === 'keep' ? 'Copying…' : 'Copy & keep'}
              </button>
              <button type="button" className="btn btn-danger" disabled={busy !== null} onClick={() => void run(false)}>
                {busy === 'delete' ? 'Unsubscribing…' : 'Delete'}
              </button>
              <button type="button" className="btn" disabled={busy !== null} onClick={() => onClose(false)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={`modal-text ${result.ok ? '' : 'modal-error'}`}>{result.message}</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => onClose(result.ok)}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
