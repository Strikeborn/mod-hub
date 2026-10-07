import type { ModRecord } from '../shared/types';

/** Only flag true duplicate installs — not the normal Vortex download + deployed archive pair. */
export function applyDuplicateHints(mods: ModRecord[]): void {
  const byNexus = new Map<string, ModRecord[]>();
  const byWorkshop = new Map<string, ModRecord[]>();

  for (const m of mods) {
    if (m.nexusModId && m.gameId) {
      const k = `${m.gameId}|${m.nexusModId}`;
      const list = byNexus.get(k) ?? [];
      list.push(m);
      byNexus.set(k, list);
    }
    if (m.workshopId && m.gameId) {
      const k = `${m.gameId}|${m.workshopId}`;
      const list = byWorkshop.get(k) ?? [];
      list.push(m);
      byWorkshop.set(k, list);
    }
  }

  for (const m of mods) {
    const unusualCopyHint = m.duplicateHint?.includes('Unusual copies') ? m.duplicateHint : undefined;
    m.duplicateHint = undefined;

    const peers = new Set<ModRecord>();
    if (m.workshopId) {
      for (const p of byWorkshop.get(`${m.gameId}|${m.workshopId}`) ?? []) {
        if (p.id !== m.id && p.localPath.toLowerCase() !== m.localPath.toLowerCase()) peers.add(p);
      }
    }
    if (m.nexusModId) {
      for (const p of byNexus.get(`${m.gameId}|${m.nexusModId}`) ?? []) {
        if (p.id !== m.id && p.localPath.toLowerCase() !== m.localPath.toLowerCase()) peers.add(p);
      }
    }

    if (peers.size === 0) {
      if (unusualCopyHint) m.duplicateHint = unusualCopyHint;
      continue;
    }

    const labels = [...peers].map((o) => {
      const src =
        o.source === 'steam-workshop' ? 'Steam Workshop' : o.source === 'nexus' ? 'Nexus/Vortex' : o.source;
      return `${src}: ${o.title.slice(0, 40)}`;
    });
    m.duplicateHint = `Extra install elsewhere — ${labels.slice(0, 2).join('; ')}`;
  }
}
