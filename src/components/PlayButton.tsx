import { useCallback, useEffect, useState } from 'react';
import type { PlayInfo } from '@shared/types';
import { toast } from '../utils/toast';

type Props = {
  gameId: string;
  /** Extra check from the caller (e.g. an unsaved load order); return false to cancel. */
  beforePlay?: () => boolean;
  compact?: boolean;
  /** Games grid: don't ask the main process until the card is hovered/focused (`active`). */
  active?: boolean;
};

/** ▶ Play with a launcher picker (MO2 executables + profile, REPENTOGON, SKSE, Steam) and pre-launch warnings. */
export function PlayButton({ gameId, beforePlay, compact, active = true }: Props) {
  const [info, setInfo] = useState<PlayInfo | null>(null);
  const [optionId, setOptionId] = useState<string | undefined>();
  const [profile, setProfile] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!window.modHub?.getPlayInfo) return;
    const i = await window.modHub.getPlayInfo(gameId);
    setInfo(i);
    setOptionId(i.chosenId);
    const chosen = i.options.find((o) => o.id === i.chosenId);
    setProfile(i.chosenProfile && chosen?.profiles?.includes(i.chosenProfile) ? i.chosenProfile : chosen?.profile);
  }, [gameId]);

  useEffect(() => {
    if (active && !info) void refresh();
  }, [refresh, active, info]);

  if (!info) return active ? <span className="play-group play-loading">…</span> : null;
  if (info.options.length === 0) return null;
  const option = info.options.find((o) => o.id === optionId) ?? info.options[0];

  async function play() {
    if (!window.modHub || !info) return;
    if (beforePlay && !beforePlay()) return;
    setBusy(true);
    try {
      const fresh = await window.modHub.getPlayInfo(gameId); // re-check: running state and warnings change
      if (fresh.running) {
        toast('The game is already running.', 'error');
        return;
      }
      if (fresh.warnings.length && !window.confirm(`Before you play:\n\n• ${fresh.warnings.join('\n• ')}\n\nPlay anyway?`)) return;
      if (
        fresh.steamUpdatePending &&
        option.kind === 'steam' &&
        !window.confirm('This will launch through Steam, and Steam will install the waiting game update first. Continue?')
      ) {
        return;
      }
      const r = await window.modHub.playGame(gameId, option.id, option.kind === 'mo2' ? profile : undefined);
      toast(r.message, r.ok ? 'ok' : 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={`play-group${compact ? ' compact' : ''}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="btn btn-sm btn-primary play-btn"
        disabled={busy}
        title={`${option.label}${option.note ? `\n${option.note}` : ''}${info.warnings.length ? `\n\n⚠ ${info.warnings.join('\n⚠ ')}` : ''}`}
        onClick={() => void play()}
      >
        ▶ Play{info.warnings.length ? ' ⚠' : ''}
      </button>
      {info.options.length > 1 && (
        <select
          className="play-select"
          value={option.id}
          title="How to start the game"
          onChange={(e) => {
            setOptionId(e.target.value);
            const o = info.options.find((x) => x.id === e.target.value);
            if (o?.kind === 'mo2') setProfile(profile && o.profiles?.includes(profile) ? profile : o.profile);
          }}
        >
          {info.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.recommended ? '★ ' : ''}
              {o.label}
            </option>
          ))}
        </select>
      )}
      {option.kind === 'mo2' && option.profiles && option.profiles.length > 1 && (
        <select className="play-select" value={profile} title="MO2 profile" onChange={(e) => setProfile(e.target.value)}>
          {option.profiles.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}
