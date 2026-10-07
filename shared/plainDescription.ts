/** Strip HTML + Nexus/BBCode markup for card snippets. */
export function plainModDescription(raw?: string, maxLen = 480): string | undefined {
  if (!raw?.trim()) return undefined;
  let s = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[\/?(?:b|i|u|s|size|color|font|center|left|right|url|list|quote|code|spoiler|hr|table|tr|td|th|youtube|video|sound|media)[^\]]*\]/gi, ' ')
    .replace(/\[img[^\]]*\]/gi, ' ')
    .replace(/\[\*\]/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return undefined;
  if (s.length > maxLen) s = `${s.slice(0, maxLen - 1)}…`;
  return s;
}
