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
  {
    id: 'skyrimse',
    name: 'Skyrim SE (MO2)',
    note: 'Mod Organizer 2 profiles. Edit one here (MO2 must be closed): its MO2 mods and plugins switch on/off. Vortex-deployed SKSE mods without a plugin load in every profile.',
  },
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
  const [importCode, setImportCode] = useState('');
  /** List being edited (not saved until Save changes). */
  const [draft, setDraft] = useState<{ id: string; ids: string[] } | null>(null);
  const [addQuery, setAddQuery] = useState('');

  const refresh = useCallback(async () => {
    if (!window.modHub?.getLoadouts) return;
    setData(await window.modHub.getLoadouts(gameId));
  }, [gameId]);

  useEffect(() => {
    setData(null);
    setOpen(null);
    setDraft(null);
    void refresh();
  }, [refresh]);

  // Lists can change in-game (RimWorld/PZ menus): re-read when Mod Hub regains focus.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const index = useMemo(() => titleIndex(catalog, gameId), [catalog, gameId]);
  const candidateTitle = useMemo(() => new Map((data?.candidates ?? []).map((c) => [c.id.toLowerCase(), c.title])), [data]);
  const label = (id: string) => candidateTitle.get(id.toLowerCase()) ?? nameFor(index, gameId, id);
  const isMo2 = data?.managedBy === 'mo2';
  const canEdit = (l: Loadout) => l.kind !== 'save' && (!isMo2 || Boolean(data?.editable));
  const addResults = useMemo(() => {
    if (!draft) return [];
    const have = new Set(draft.ids.map((x) => x.toLowerCase()));
    const q = addQuery.trim().toLowerCase();
    return (data?.candidates ?? [])
      .filter((c) => !have.has(c.id.toLowerCase()) && (!q || c.title.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)))
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, 30);
  }, [draft, addQuery, data]);

  function moveDraft(i: number, d: number) {
    if (!draft) return;
    const ids = [...draft.ids];
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setDraft({ ...draft, ids });
  }

  function saveDraft(l: Loadout) {
    if (!draft) return;
    const ids = draft.ids;
    void run(() => window.modHub.editLoadout(gameId, l.id, ids)).then(() => {
      setDraft(null);
      setAddQuery('');
    });
  }
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
    if (data?.managedBy === 'mo2') {
      void run(() => window.modHub.applyLoadout(gameId, l.id));
      return;
    }
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

  async function share(l: Loadout) {
    const r = await window.modHub.exportLoadoutCode(gameId, l.id);
    if (r.ok && r.code) {
      try {
        await navigator.clipboard.writeText(r.code);
        toast(r.message, 'ok');
      } catch {
        window.prompt('Copy this share code:', r.code);
      }
    } else toast(r.message, 'error');
  }

  async function doImport() {
    const r = await window.modHub.importLoadoutCode(importCode);
    toast(r.message, r.ok ? 'ok' : 'error');
    if (r.ok) {
      setImportCode('');
      if (r.gameId && r.gameId !== gameId) setGameId(r.gameId);
      else await refresh();
    }
  }

  function applyToSave(l: Loadout, saveId: string) {
    const save = data?.loadouts.find((x) => x.id === saveId);
    if (!save) return;
    if (!window.confirm(`Make the save “${save.name}” load “${l.name}” (${l.ids.length} mods)?\n\nThat save's current mod list is backed up first. PZ must be closed.`)) return;
    void run(() => window.modHub.applyLoadoutToSave(l.id, saveId));
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
        {data && (
          <form
            className="loadouts-save"
            onSubmit={(e) => {
              e.preventDefault();
              saveCurrent();
            }}
          >
            <input
              type="text"
              placeholder={isMo2 ? 'Name for a copy of the ▶ Play profile…' : `Name for the current ${game.name} setup…`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={busy || !newName.trim()}>
              {isMo2 ? 'Copy profile' : `Save as new (${data?.current.length ?? 0} enabled)`}
            </button>
          </form>
        )}
      </div>
      <p className="loadouts-note">{game.note}</p>
      <form
        className="loadouts-save loadouts-import"
        onSubmit={(e) => {
          e.preventDefault();
          void doImport();
        }}
      >
        <input
          type="text"
          placeholder="Paste a Mod Hub share code (MODHUB1:…) to import a list"
          value={importCode}
          onChange={(e) => setImportCode(e.target.value)}
        />
        <button type="submit" className="btn" disabled={!importCode.trim()}>
          Import
        </button>
      </form>

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
                  <span>
                    {l.count} mods
                    {data.alwaysOn ? (
                      <span className="muted" title="Vortex-deployed mods without a plugin (SKSE DLLs, assets) load in every profile, so lists don't count them.">
                        {' '}+ {data.alwaysOn} always on (Vortex)
                      </span>
                    ) : null}
                  </span>
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
                {canEdit(l) && (
                  <button
                    type="button"
                    className={`btn btn-sm${draft?.id === l.id ? ' btn-active' : ''}`}
                    disabled={busy}
                    title="Add, remove or reorder mods in this list"
                    onClick={() => {
                      setOpen(l.id);
                      setAddQuery('');
                      setDraft(draft?.id === l.id ? null : { id: l.id, ids: [...l.ids] });
                    }}
                  >
                    {draft?.id === l.id ? 'Stop editing' : 'Edit'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={busy || (l.isCurrent && data.managedBy !== 'mo2')}
                  title={l.kind === 'save' ? "Make this save's mod list the main (new game) list" : 'Make this the enabled mod list'}
                  onClick={() => apply(l)}
                >
                  {data.managedBy === 'mo2' ? 'Use for ▶ Play' : l.kind === 'save' ? 'Use as main list' : 'Apply'}
                </button>
                {l.kind !== 'save' && data.managedBy !== 'mo2' && (
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
                {data.managedBy !== 'mo2' && (
                  <button type="button" className="btn btn-sm" title="Copy a share code for this list" onClick={() => void share(l)}>
                    Share
                  </button>
                )}
                {gameId === 'project-zomboid' && l.kind !== 'save' && data.loadouts.some((x) => x.kind === 'save') && (
                  <select
                    className="play-select"
                    value=""
                    title="Write this list into one save's mods.txt"
                    onChange={(e) => e.target.value && applyToSave(l, e.target.value)}
                  >
                    <option value="">Apply to save…</option>
                    {data.loadouts
                      .filter((x) => x.kind === 'save')
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </select>
                )}
                {l.canDelete && (
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => remove(l)}>
                    Remove
                  </button>
                )}
              </div>
              {open === l.id && draft?.id === l.id && (
                <div className="loadout-editor">
                  <ol className="loadout-mods">
                    {draft.ids.map((id, i) => (
                      <li key={id} className={l.missing.includes(id) ? 'missing' : 'on'} title={id}>
                        <span className="loadout-edit-name">{label(id)}</span>
                        {!isMo2 && (
                          <>
                            <button type="button" className="btn btn-xs" title="Load earlier" disabled={i === 0} onClick={() => moveDraft(i, -1)}>
                              ↑
                            </button>
                            <button type="button" className="btn btn-xs" title="Load later" disabled={i === draft.ids.length - 1} onClick={() => moveDraft(i, 1)}>
                              ↓
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          className="btn btn-xs"
                          title={isMo2 ? 'Switch off in this profile' : 'Remove from this list'}
                          onClick={() => setDraft({ ...draft, ids: draft.ids.filter((x) => x !== id) })}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ol>
                  <div className="loadout-add">
                    <input
                      type="search"
                      placeholder={`Search installed ${game.name} mods to add…`}
                      value={addQuery}
                      onChange={(e) => setAddQuery(e.target.value)}
                    />
                    <ul className="loadout-add-results">
                      {addResults.map((c) => (
                        <li key={c.id}>
                          <button type="button" className="btn btn-xs" onClick={() => setDraft({ ...draft, ids: [...draft.ids, c.id] })}>
                            + Add
                          </button>{' '}
                          {c.title}
                        </li>
                      ))}
                      {addResults.length === 0 && <li className="muted">Nothing else to add{addQuery ? ' for that search' : ''}.</li>}
                    </ul>
                  </div>
                  <div className="loadout-edit-actions">
                    <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => saveDraft(l)}>
                      Save changes ({draft.ids.length} mods)
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setDraft(null)}>
                      Cancel
                    </button>
                    <span className="muted">
                      {isMo2 ? 'Writes the MO2 profile (MO2 must be closed; backed up first).' : 'Saved to the list file (backed up first). Apply it to use it.'}
                    </span>
                  </div>
                </div>
              )}
              {open === l.id && draft?.id !== l.id && (
                <ol className="loadout-mods">
                  {l.ids.map((id) => {
                    const missing = l.missing.includes(id);
                    const on = data.current.some((c) => c.toLowerCase() === id.toLowerCase());
                    return (
                      <li key={id} className={missing ? 'missing' : on ? 'on' : 'off'} title={id}>
                        {label(id)}
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
