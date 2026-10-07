import type { ModRecord } from '@shared/types';

export type GameVersionInfo = {
  /** Short label for a table cell, e.g. "1.4–1.6", "B41, B42", "Rep, Rep+". */
  short: string;
  /** Everything known, for a tooltip. */
  full: string;
  /** True when guessed from the title/description (Isaac's Workshop has no version tags). */
  guessed?: boolean;
};

function numericVersions(tags: string[]): number[] {
  return tags.map((t) => Number(t)).filter((n) => Number.isFinite(n));
}

/** Which game versions/DLC a mod is for: Workshop version tags (RimWorld, PZ), else title/description markers (Isaac). */
export function gameVersionsFor(m: ModRecord): GameVersionInfo | null {
  const tags = m.gameVersionTags ?? [];
  if (tags.length) {
    const nums = numericVersions(tags);
    if (nums.length === tags.length && nums.length > 2) {
      const sorted = [...nums].sort((a, b) => a - b);
      const fmt = (n: number) => tags[nums.indexOf(n)];
      return { short: `${fmt(sorted[0])}–${fmt(sorted[sorted.length - 1])}`, full: `Workshop tags: ${tags.join(', ')}` };
    }
    const short = tags.map((t) => t.replace(/^Build\s*/i, 'B')).join(', ');
    return { short, full: `Workshop tags: ${tags.join(', ')}` };
  }
  if (m.gameId !== 'binding-of-isaac') return null;
  const text = `${m.title} ${m.description ?? ''}`;
  const found: string[] = [];
  // "Required DLC" from an archived Workshop page is a fact, not a guess.
  const dlc = m.workshopArchived?.requiredDlc ?? [];
  if (dlc.some((d) => /repentance\s*\+/i.test(d))) found.push('Rep+');
  else if (dlc.some((d) => /repentance/i.test(d))) found.push('Rep');
  if (found.length && !/REPENTOGON/i.test(text)) {
    return { short: found.join(', '), full: `Workshop page (archived): requires ${dlc.join(', ')}` };
  }
  if (/\bREP(entance)?\s*\+|\bREP\+/i.test(text)) found.push('Rep+');
  if (/\[(?:[^\]]*\/)?REP(entance)?(?![+\w])|\bRepentance\b(?!\s*\+)/i.test(text)) found.push('Rep');
  if (/\bAB\+|\bAfterbirth\s*\+/i.test(text)) found.push('AB+');
  if (/repentogon/i.test(text)) found.push('REPENTOGON');
  if (!found.length) return null;
  return {
    short: found.join(', '),
    full: `From the mod's title/description (Isaac's Workshop has no version tags): ${found.join(', ')}`,
    guessed: true,
  };
}
