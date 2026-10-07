import crypto from 'node:crypto';

export function stableIdFromParts(parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
}
