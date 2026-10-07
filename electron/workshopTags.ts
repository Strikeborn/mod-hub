const STEAM_CATEGORY_TAGS = new Set(
  [
    'lua',
    'graphics',
    'sound effects',
    'music',
    'items',
    'vehicles',
    'multiplayer',
    'maps',
    'models',
    'textures',
    'weapons',
    'characters',
    'ui',
    'misc',
    'mod',
    'mod pack',
    'translation',
    'tags',
    'other',
    'buildings',
    'realism',
    'hardmode',
    'easy mode',
    'challenge',
    'qol',
    'quality of life',
    'framework',
    'library',
    'api',
  ].map((s) => s.toLowerCase()),
);

function isWorkshopVersionTag(tag: string): boolean {
  const t = tag.trim();
  const lower = t.toLowerCase();
  if (/build\s*\d+/i.test(t)) return true;
  if (/^b\d+\b/i.test(t)) return true;
  if (/^build\s*\d+/i.test(t)) return true;
  if (/^\d{2}\.\d+(\.\d+)?$/.test(t)) return true;
  if (/^v?\d+\.\d+(\.\d+)?$/i.test(t)) return true;
  if (lower.includes('compatible')) return true;
  if (lower.includes('game version')) return true;
  if (lower.includes('patch')) return true;
  if (/^41(\.|$)/.test(t)) return true;
  return false;
}

export function splitWorkshopTags(tags?: string[]): { categories: string[]; gameVersions: string[] } {
  if (!tags?.length) return { categories: [], gameVersions: [] };
  const gameVersions: string[] = [];
  const categories: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag) continue;
    if (isWorkshopVersionTag(tag)) {
      gameVersions.push(tag);
    } else if (STEAM_CATEGORY_TAGS.has(tag.toLowerCase())) {
      categories.push(tag);
    } else if (/^\d+$/.test(tag) && tag.length <= 3) {
      gameVersions.push(`Build ${tag}`);
    } else {
      categories.push(tag);
    }
  }
  return { categories, gameVersions };
}
