import { useMemo } from 'react';
import type { GameRecord, ModRecord } from '@shared/types';
import { displayGameName } from '../utils/gameDisplay';

/** Controller layouts, not mods: kept hidden by Clear all. */
const KEEP_HIDDEN = 'steam-241100';

type Props = {
  mods: ModRecord[];
  games: GameRecord[];
  hidden: string[];
  onChange: (next: string[]) => void;
};

/** Pick games to hide from every mod list; hidden games show as removable chips. */
export function HiddenGamesBar({ mods, games, hidden, onChange }: Props) {
  const options = useMemo(() => {
    const counts = new Map<string, { sample: ModRecord; count: number }>();
    for (const m of mods) {
      const hit = counts.get(m.gameId);
      if (hit) hit.count += 1;
      else counts.set(m.gameId, { sample: m, count: 1 });
    }
    return [...counts.entries()]
      .map(([id, { sample, count }]) => ({ id, name: displayGameName(sample, games), count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [mods, games]);

  const hiddenSet = new Set(hidden);
  const addable = options.filter((o) => !hiddenSet.has(o.id));
  const nameFor = (id: string) => options.find((o) => o.id === id)?.name ?? displayGameName({ gameId: id }, games);
  const countFor = (id: string) => options.find((o) => o.id === id)?.count ?? 0;

  return (
    <div className="hidden-games-bar">
      <label className="toolbar-select">
        Hide game
        <select
          value=""
          onChange={(e) => {
            const id = e.target.value;
            if (id && !hiddenSet.has(id)) onChange([...hidden, id]);
          }}
        >
          <option value="">Choose…</option>
          {addable.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} ({o.count})
            </option>
          ))}
        </select>
      </label>
      {hidden.length > 0 && <span className="hidden-games-label">Hidden:</span>}
      {hidden.some((id) => id !== KEEP_HIDDEN) && (
        <button
          type="button"
          className="btn btn-sm"
          title="Show every game again (Steam Input Configs stays hidden)"
          onClick={() => onChange(hidden.filter((id) => id === KEEP_HIDDEN))}
        >
          Clear all
        </button>
      )}
      {hidden.map((id) => (
        <span key={id} className="hidden-game-chip" title={`${countFor(id)} mods hidden`}>
          {nameFor(id)}
          <button
            type="button"
            aria-label={`Show ${nameFor(id)} again`}
            title="Remove from hide list"
            onClick={() => onChange(hidden.filter((h) => h !== id))}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
