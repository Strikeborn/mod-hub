/** Reject epoch / placeholder dates (e.g. 1/1/2000) on mod metadata. */
export function isPlausibleModDate(iso?: string): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const y = new Date(t).getFullYear();
  return y >= 2005 && y <= 2100;
}

export function sanitizeIsoDate(iso?: string): string | undefined {
  return isPlausibleModDate(iso) ? iso : undefined;
}
