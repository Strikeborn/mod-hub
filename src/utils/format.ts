export function formatBytes(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

import { isPlausibleModDate } from '@shared/modDates';

export { isPlausibleModDate };

export function formatDate(iso?: string): string {
  if (!iso || !isPlausibleModDate(iso)) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return '—';
  }
}

export function sourceLabel(source: string): string {
  switch (source) {
    case 'steam-workshop':
      return 'Steam Workshop';
    case 'nexus':
      return 'Nexus';
    case 'vortex-staging':
      return 'Vortex staging';
    case 'local':
      return 'Local / game folder';
    default:
      return 'Other';
  }
}

/** "12 Jul 2022" — compact date for cards. */
export function formatShortDate(iso?: string): string {
  if (!iso || !isPlausibleModDate(iso)) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '—';
  }
}

/** "Tue, 12 Jul 2022, 15:22:11" — full date and time for the detail panel. */
export function formatFullDate(iso?: string): string {
  if (!iso || !isPlausibleModDate(iso)) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '—';
  }
}
