import { useEffect, useMemo, useState } from 'react';
import type { CatalogSnapshot, ModLoadState, ModRecord } from '@shared/types';
import { baseTitle } from '../utils/similarMods';
import { displayGameName } from '../utils/gameDisplay';
import { formatBytes, formatShortDate, sourceLabel } from '../utils/format';
import { openModDetails } from '../utils/modDetails';
import { workshopRating } from '../utils/workshopRating';
import { toast } from '../utils/toast';

type Props = {
  catalog: CatalogSnapshot;
  hiddenGames: string[];
  loadStates: Map<string, ModLoadState>;
  onToggleEnabled: (mod: ModRecord, enabled: boolean) => void;
};

type Group = { key: string; gameId: string; mods: ModRecord[]; reasons: string[] };

/** Groups of installed mods that are probably the same mod (or versions of it). */
function findGroups(mods: ModRecord[]): Group[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const reasons = new Map<string, Set<string>>(); // reason sets keyed by the pair's root after union
  const pairReasons: { a: string; b: string; why: string }[] = [];
  const buckets = new Map<string, { why: string; ids: string[] }>();
  const add = (key: string, why: string, id: string) => {
    const b = buckets.get(key) ?? { why, ids: [] };
    if (!b.ids.includes(id)) b.ids.push(id);
    buckets.set(key, b);
  };
  for (const m of mods) {
    const t = baseTitle(m.title);
    if (t.length >= 4 && !m.title.startsWith('#')) add(`title|${m.gameId}|${t}`, 'Similar title', m.id);
    if (m.gameId === 'rimworld') for (const id of m.modIds ?? []) add(`modid|${id.toLowerCase().replace(/_steam$/, '')}`, `Same mod ID (${id})`, m.id);
    if (m.workshopId) add(`ws|${m.workshopId}`, 'Same Workshop item', m.id);
    if (m.nexusModId && m.nexusGameDomain) add(`nx|${m.nexusGameDomain.toLowerCase()}|${m.nexusModId}`, 'Same Nexus mod', m.id);
    if (m.crossLinks?.workshop?.workshopId) add(`ws|${m.crossLinks.workshop.workshopId}`, 'Linked Nexus ↔ Workshop', m.id);
    if (m.crossLinks?.nexus) add(`nx|${m.crossLinks.nexus.domain.toLowerCase()}|${m.crossLinks.nexus.modId}`, 'Linked Nexus ↔ Workshop', m.id);
  }
  for (const { why, ids } of buckets.values()) {
    if (ids.length < 2) continue;
    for (const id of ids.slice(1)) {
      parent.set(find(id), find(ids[0]));
      pairReasons.push({ a: ids[0], b: id, why });
    }
  }
  for (const p of pairReasons) {
    const root = find(p.a);
    const s = reasons.get(root) ?? new Set<string>();
    s.add(p.why);
    reasons.set(root, s);
  }
  const byId = new Map(mods.map((m) => [m.id, m]));
  const members = new Map<string, ModRecord[]>();
  for (const p of pairReasons) {
    for (const id of [p.a, p.b]) {
      const root = find(id);
      const list = members.get(root) ?? [];
      if (!list.some((m) => m.id === id)) list.push(byId.get(id)!);
      members.set(root, list);
    }
  }
  return [...members.entries()]
    .map(([root, list]) => ({
      key: list.map((m) => m.id).sort().join('+'),
      gameId: list[0].gameId,
      mods: list.sort((a, b) => a.title.localeCompare(b.title)),
      reasons: [...(reasons.get(root) ?? [])],
    }))
    .sort((a, b) => a.gameId.localeCompare(b.gameId) || a.mods[0].title.localeCompare(b.mods[0].title));
}

export function DuplicatesView({ catalog, hiddenGames, loadStates, onToggleEnabled }: Props) {
  const [ignored, setIgnored] = useState<string[]>([]);
  const [showIgnored, setShowIgnored] = useState(false);

  useEffect(() => {
    void window.modHub?.getSettings().then((s) => setIgnored(s.ignoredDuplicateGroups ?? []));
  }, []);

  const groups = useMemo(() => {
    const hidden = new Set(hiddenGames);
    return findGroups(catalog.mods.filter((m) => !hidden.has(m.gameId)));
  }, [catalog.mods, hiddenGames]);
  const ignoredSet = new Set(ignored);
  const shown = groups.filter((g) => showIgnored || !ignoredSet.has(g.key));

  function setIgnore(key: string, on: boolean) {
    const next = on ? [...ignored, key] : ignored.filter((k) => k !== key);
    setIgnored(next);
    void window.modHub?.saveSettings({ ignoredDuplicateGroups: next });
    toast(on ? 'Marked as not duplicates.' : 'Showing that group again.');
  }

  return (
    <div className="dups">
      <div className="dups-head">
        <p className="loadouts-note">
          Mods that are probably the same mod: similar titles (“Hospitality” / “Hospitality (Continued)”), the same mod ID,
          the same Workshop item or Nexus mod in more than one place, or mods you linked across Nexus and the Workshop.
          Keeping both usually means one overrides the other or they conflict.
        </p>
        <label className="checkbox-inline">
          <input type="checkbox" checked={showIgnored} onChange={(e) => setShowIgnored(e.target.checked)} />
          Show groups marked “not duplicates” ({groups.filter((g) => ignoredSet.has(g.key)).length})
        </label>
      </div>
      {shown.length === 0 ? (
        <div className="empty-state">No likely duplicates found.</div>
      ) : (
        <ul className="loadout-list">
          {shown.map((g) => (
            <li key={g.key} className={`dup-group${ignoredSet.has(g.key) ? ' is-ignored' : ''}`}>
              <div className="dup-group-head">
                <strong>{displayGameName(g.mods[0], catalog.games)}</strong>
                {g.reasons.map((r) => (
                  <span key={r} className="status-pill">
                    {r}
                  </span>
                ))}
                <span className="dup-spacer" />
                <button type="button" className="btn btn-sm" onClick={() => setIgnore(g.key, !ignoredSet.has(g.key))}>
                  {ignoredSet.has(g.key) ? 'Show again' : 'Not duplicates'}
                </button>
              </div>
              <table className="mod-table dup-table">
                <tbody>
                  {g.mods.map((m) => {
                    const st = loadStates.get(m.id);
                    const r = workshopRating(m);
                    return (
                      <tr key={m.id}>
                        <td className="col-title">
                          <button type="button" className="mod-table-title" title="Show details" onClick={() => openModDetails(m)}>
                            {m.title}
                          </button>
                        </td>
                        <td>{sourceLabel(m.source)}</td>
                        <td className="col-ellipsis">{m.authorDisplayName ?? m.author ?? '—'}</td>
                        <td className="col-narrow">{m.version ?? '—'}</td>
                        <td className="col-num">{r && !r.few ? `★ ${r.stars.toFixed(1)}` : '—'}</td>
                        <td className="col-num">{formatBytes(m.sizeBytes)}</td>
                        <td className="col-date" title="Last updated">
                          {formatShortDate(m.remoteUpdatedAt)}
                        </td>
                        <td>
                          {st && !st.readOnly ? (
                            <button
                              type="button"
                              className={`mod-table-toggle${st.enabled ? ' on' : ' off'}`}
                              onClick={() => onToggleEnabled(m, !st.enabled)}
                            >
                              <span className="mod-table-toggle-dot" aria-hidden />
                              {st.enabled ? 'Enabled' : 'Disabled'}
                            </button>
                          ) : (
                            <span className="detail-muted">{m.workshopHidden ? 'Removed from Workshop' : ''}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
