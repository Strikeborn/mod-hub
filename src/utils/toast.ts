export type ToastKind = 'ok' | 'error' | 'info';
export type Toast = { id: number; message: string; kind: ToastKind };

type Listener = (t: Toast) => void;
const listeners = new Set<Listener>();
let nextId = 1;

/** Show a short confirmation pop-up (bottom-right). */
export function toast(message: string, kind: ToastKind = 'ok'): void {
  const t = { id: nextId++, message, kind };
  for (const l of listeners) l(t);
}

export function onToast(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
