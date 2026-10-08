/** Title matching for re-upload search (pure, so it can be unit-tested without Electron). */

/** Lower-case, drop leading !/#/symbols and [tags]/(tags), collapse punctuation. */
export function normTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9']+/g, ' ')
    .replace(/'/g, '')
    .trim();
}

export function titleMatch(original: string, candidate: string): 'exact' | 'close' | null {
  const a = normTitle(original);
  const b = normTitle(candidate);
  if (!a || !b) return null;
  if (a === b) return 'exact';
  // A re-upload usually keeps the title and may add to it ("… REBORN", "[B42] …"). The reverse, a shorter
  // candidate inside a longer original ("Undead Survivor" for "VFE Undead Survivor Patch"), is a different mod.
  if (b.includes(a) && a.length / b.length >= 0.6) return 'close';
  const wa = new Set(a.split(' '));
  const wb = new Set(b.split(' '));
  const inter = [...wa].filter((w) => wb.has(w)).length;
  return inter / new Set([...wa, ...wb]).size >= 0.75 ? 'close' : null;
}

