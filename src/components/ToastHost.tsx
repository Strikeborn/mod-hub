import { useEffect, useState } from 'react';
import { onToast, type Toast } from '../utils/toast';

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(
    () =>
      onToast((t) => {
        setToasts((list) => [...list.slice(-3), t]);
        setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), t.kind === 'error' ? 8000 : 4500);
      }),
    [],
  );

  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span className="toast-icon" aria-hidden>
            {t.kind === 'ok' ? '✓' : t.kind === 'error' ? '!' : 'i'}
          </span>
          <span>{t.message}</span>
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss"
            onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
