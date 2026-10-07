import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CatalogSnapshot, Loadout, LoadoutsForGame } from '@shared/types';
import { formatDate } from '../utils/format';
import { toast } from '../utils/toast';

type Props = {
  catalog: CatalogSnapshot;
  /** Re-read enabled state elsewhere in the app after a loadout is applied. */
  onChanged?: () => void;
};

const GAMES: { id: string; name: string; note: string }[] = [
  { id: 'rimworld', name: 'RimWorld', note: "Lists live in RimWorld's ModLists folder, the same ones its own Mod Lists menu uses." },
  { id: 'project-zomboid', name: 'Project Zomboid', note: "Saved lists come from PZ's mod manager; each save also keeps its own list." },
  { id: 'binding-of-isaac', name: 'The Binding of Isaac', note: "Isaac has no list format of its own, so Mod Hub stores these. REPENTOGON's mod always stays on." },
];

/** id (lower-case) → display title, per game, so lists show mod names instead of package ids/folders. */
function titleIndex(catalog: CatalogSnapshot, gameId: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of catalog.mods) {
    if (m.gameId !== gameId) continue;
    for (const id of m.modIds ?? []) map.set(id.toLowerCase().replace(/_steam$/, ''), m.title);
    if (gameId === 'binding-of-isaac' && m.workshopId) map.set(`ws:${m.workshopId}`, m.title);
    if (m.localPath) map.set(`path:${m.localPath.split(/[\\/]/).pop()!.toLowerCase()}`, m.title);
  }
  return map;
}

function nameFor(index: Map<string, string>, gameId: string, id: string): string {
  const key = id.toLowerCase().replace(/_steam$/, '');
  if (gameId === 'binding-of-isaac') {
    const ws = /_(\d+)$/.exec(id)?.[1];
    return index.get(`path:${key}`) ?? (ws ? index.get(`ws:${ws}`) : undefined) ?? id.replace(/_\d+$/, '');
  }
  if (key.startsWith('ludeon.rimworld')) return key === 'ludeon.rimworld' ? 'Core' : `DLC: ${key.split('.').pop()}`;
  return index.get(key) ?? id;
}

export function LoadoutsView({ catalog, onChanged }: Props) {
  const [gameId, setGameId] = useState('rimworld');
  const [data, setData] = useState<LoadoutsForGame | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!window.modHub?.getLoadouts) return;
    setData(await window.modHub.getLoadouts(gameId));
  }, [gameId]);

  useEffect(() => {
    setData(null);
    setOpen(null);
    void refresh();
  }, [refresh]);

  // Lists can change in-game (RimWorld/PZ menus): re-read when Mod Hub regains focus.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const index = useMemo(() => titleIndex(catalog, gameId), [catalog, gameId]);
  const game = GAMES.find((g) => g.id === gameId)!;

  async function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(true);
    try {
      const r = await action();
      toast(r.message, r.ok ? 'ok' : 'error');
      if (r.ok) onChanged?.();
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  function apply(l: Loadout) {
    const missing = l.missing.length ? `\n${l.missing.length} mod(s) in it aren't installed and will be skipped.` : '';
    if (
      !window.confirm(
        `Apply “${l.name}” to ${game.name}?\n\n+${l.toEnable} enabled, −${l.toDisable} disabled.${missing}\n\nThe game must be closed. The current list is backed up first.`,
      )
    ) {
      return;
    }
    void run(() => window.modHub.applyLoadout(gameId, l.id));
  }

  function remove(l: Loadout) {
    if (!window.confirm(`Remove the saved list “${l.name}”?\n\nA copy goes to Mod Hub's backups folder.`)) return;
    void run(() => window.modHub.deleteLoadout(gameId, l.id));
  }

  function update(l: Loadout) {
    if (
      !window.confirm(
        `Overwrite “${l.name}” with the ${data?.current.length ?? 0} mods ${game.name} has enabled right now?

The old version is backed up first.`,
      )
    ) {
      return;
    }
    void run(() => window.modHub.updateLoadout(gameId, l.id));
  }

  function saveCurrent() {
    const name = newName.trim();
    if (!name) return;
    const existing = data?.loadouts.find((l) => l.kind !== 'save' && l.name.toLowerCase() === name.toLowerCase());
    if (existing && !window.confirm(`A list called “${existing.name}” already exists. Overwrite it with the current setup?`)) return;
    void run(() => window.modHub.saveLoadout(gameId, name)).then(() => setNewName(''));
  }

  return (
    <div className="loadouts">
      <div className="loadouts-head">
        <div className="loadouts-games" role="tablist">
          {GAMES.map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={g.id === gameId}
              className={`btn ${g.id === gameId ? 'btn-active' : ''}`}
              onClick={() => setGameId(g.id)}
            >
              {g.name}
            </button>
          ))}
        </div>
        <form
          className="loadouts-save"
          onSubmit={(e) => {
            e.preventDefault();
            saveCurrent();
          }}
        >
          <input
            type="text"
            placeholder={`Name for the current ${game.name} setup…`}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !newName.trim()}>
            Save as new ({data?.current.length ?? 0} enabled)
          </button>
        </form>
      </div>
      <p className="loadouts-note">{game.note}</p>

      {!data ? (
        <div className="empty-state">Reading {game.name} lists…</div>
      ) : data.loadouts.length === 0 ? (
        <div className="empty-state">No saved lists for {game.name} yet. Save the current setup above to make one.</div>
      ) : (
        <ul className="loadout-list">
          {data.loadouts.map((l) => (
            <li key={l.id} className={`loadout-row${l.isCurrent ? ' is-current' : ''}`}>
              <div className="loadout-main">
                <div className="loadout-title">
                  <strong>{l.name}</strong>
                  {l.isCurrent && <span className="status-pill load-pill load-pill-on">Current</span>}
                  <span className="loadout-kind">{l.kindLabel}</span>
                </div>
                <div className="loadout-meta">
                  <span>{l.count} mods</span>
                  {l.isCurrent ? (
                    <span>matches what's enabled now</span>
                  ) : (
                    <span title="Compared with what the game has enabled right now">
                      <span className="loadout-plus">+{l.toEnable}</span> / <span className="loadout-minus">−{l.toDisable}</span> vs now
                    </span>
                  )}
                  {l.missing.length > 0 && (
                    <span className="loadout-missing" title={l.missing.join('\n')}>
                      {l.missing.length} not installed
                    </span>
                  )}
                  {l.gameVersion && <span>game {l.gameVersion}</span>}
                  {l.modifiedAt && <span>saved {formatDate(l.modifiedAt)}</span>}
                </div>
              </div>
              <div className="loadout-actions">
                <button type="button" className="btn btn-sm" onClick={() => setOpen(open === l.id ? null : l.id)}>
                  {open === l.id ? 'Hide mods' : 'Show mods'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={busy || l.isCurrent}
                  title={l.kind === 'save' ? "Make this save's mod list the main (new game) list" : 'Make this the enabled mod list'}
                  onClick={() => apply(l)}
                >
                  {l.kind === 'save' ? 'Use as main list' : 'Apply'}
                </button>
                {l.kind !== 'save' && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy || l.isCurrent}
                    title={l.isCurrent ? 'Already matches what is enabled now' : 'Overwrite this list with what the game has enabled right now'}
                    onClick={() => update(l)}
                  >
                    Update
                  </button>
                )}
                {l.canDelete && (
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => remove(l)}>
                    Remove
                  </button>
                )}
              </div>
              {open === l.id && (
                <ol className="loadout-mods">
                  {l.ids.map((id) => {
                    const missing = l.missing.includes(id);
                    const on = data.current.some((c) => c.toLowerCase() === id.toLowerCase());
                    return (
                      <li key={id} className={missing ? 'missing' : on ? 'on' : 'off'} title={id}>
                        {nameFor(index, gameId, id)}
                        {missing ? ' — not installed' : on ? '' : ' — currently off'}
                      </li>
                    );
                  })}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
