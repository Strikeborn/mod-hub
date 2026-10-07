import type { WebContents } from 'electron';

export async function waitForBrowseEnhancer(wc: WebContents, timeoutMs = 18000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (wc.isDestroyed()) return false;
    try {
      const ok = await wc.executeJavaScript('!!window.__vortexBrowseEnhancer', true);
      if (ok) return true;
    } catch {
      /* page still loading */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
