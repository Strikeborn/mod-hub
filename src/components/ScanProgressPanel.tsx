import type { ScanProgressEvent } from '@shared/types';

type Props = {
  progress: ScanProgressEvent | null;
  startedAt: number | null;
};

function formatEta(startedAt: number, percent?: number): string {
  if (!percent || percent <= 0 || percent >= 100) return '';
  const elapsed = Date.now() - startedAt;
  const totalEst = elapsed / (percent / 100);
  const remaining = Math.max(0, totalEst - elapsed);
  if (remaining < 3000) return ' · ~few seconds left';
  const sec = Math.round(remaining / 1000);
  if (sec < 60) return ` · ~${sec}s left`;
  const min = Math.round(sec / 60);
  return ` · ~${min} min left`;
}

export function ScanProgressPanel({ progress, startedAt }: Props) {
  if (!progress) return null;
  let pct = progress.percent;
  if (pct == null && progress.current != null && progress.total != null && progress.total > 0) {
    pct = Math.round((progress.current / progress.total) * 100);
  }
  if (pct == null && progress.phase === 'done') pct = 100;
  const eta = startedAt && pct ? formatEta(startedAt, pct) : '';

  return (
    <div className="scan-progress" role="status" aria-live="polite">
      <div className="scan-progress-head">
        <strong>{progress.phase === 'done' ? 'Finishing' : 'Scanning'}</strong>
        <span className="scan-progress-msg">
          {progress.message}
          {progress.current != null && progress.total != null ? ` (${progress.current}/${progress.total})` : ''}
          {eta}
        </span>
      </div>
      <div className="scan-progress-track" aria-hidden>
        <div
          className="scan-progress-fill"
          style={{
            width: pct != null ? `${Math.min(100, pct)}%` : progress.phase === 'enrich' ? '66%' : '33%',
          }}
        />
      </div>
    </div>
  );
}
