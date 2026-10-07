import type { ModRecord } from '@shared/types';

type Listener = (mod: ModRecord) => void;
const listeners = new Set<Listener>();

/** Open the left-side detail panel for a mod (from any card). */
export function openModDetails(mod: ModRecord): void {
  for (const l of listeners) l(mod);
}

export function onOpenModDetails(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
