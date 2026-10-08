import type { ModRecord } from '@shared/types';

export type WorkshopRating = { stars: number; up: number; down: number; total: number; few: boolean };

/** Steam-style 0–5 stars from Workshop up/down votes; `few` = under 10 votes (Steam shows "Not enough ratings"). */
export function workshopRating(m: Pick<ModRecord, 'workshopVotesUp' | 'workshopVotesDown'>): WorkshopRating | null {
  const up = m.workshopVotesUp;
  const down = m.workshopVotesDown;
  if (up == null || down == null) return null;
  const total = up + down;
  if (total === 0) return { stars: 0, up, down, total, few: true };
  return { stars: (up / total) * 5, up, down, total, few: total < 10 };
}

export function ratingTitle(r: WorkshopRating): string {
  return `Workshop rating: ${r.up.toLocaleString()} up / ${r.down.toLocaleString()} down (${Math.round((r.up / Math.max(1, r.total)) * 100)}% positive)${r.few ? ', few ratings' : ''}`;
}

/** 18374989 -> "18.4M", 58817 -> "58.8k". */
export function compactNumber(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(n);
}
