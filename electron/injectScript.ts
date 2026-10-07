import type { WebContents } from 'electron';

const CHUNK_CHARS = 180_000;

/**
 * Run large script via Electron executeJavaScript + eval (bypasses page CSP; blob/script tags do not).
 */
export async function executeInjectionScript(wc: WebContents, script: string): Promise<void> {
  if (wc.isDestroyed()) throw new Error('Guest webview destroyed');
  await wc.executeJavaScript('window.__modHubInjectParts=window.__modHubInjectParts||[]', true);
  for (let i = 0; i < script.length; i += CHUNK_CHARS) {
    const slice = script.slice(i, i + CHUNK_CHARS);
    await wc.executeJavaScript(`window.__modHubInjectParts.push(${JSON.stringify(slice)})`, true);
  }
  await wc.executeJavaScript(
    `(function(){
      var source = window.__modHubInjectParts.join('');
      delete window.__modHubInjectParts;
      (0, eval)(source);
    })();`,
    true,
  );
}
