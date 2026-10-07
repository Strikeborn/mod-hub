import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** A webpack/CommonJS bundle (e.g. the deployed Vortex plugin index.js) throws `module is not defined` in a page. */
function isNodeBundle(script: string): boolean {
  const head = script.slice(0, 2000);
  return /^\s*module\.exports\s*=/.test(head) || head.includes('webpackBootstrap');
}

/**
 * Load the raw browse enhancer runtime (`injectionRuntime.js`) for Nexus webview injection.
 * Not the deployed Vortex plugin `index.js`: that is the Vortex extension bundle, which only embeds the
 * runtime as a string and crashes when evaluated in a web page (injection never registered because of it).
 */
export function loadBrowseInjectionScript(): { script: string; source: string } | { error: string } {
  const candidates = [
    process.env.MOD_HUB_INJECTION_SCRIPT,
    // Vortex plugin repo checked out inside mod-hub (F:/mod-hub/vortex-builtin-mod-browser-enhanced).
    path.resolve(__dirname, '../vortex-builtin-mod-browser-enhanced/src/injectionRuntime.js'),
    // Legacy layout: mod-hub nested inside the plugin repo.
    path.resolve(__dirname, '../../src/injectionRuntime.js'),
  ].filter(Boolean) as string[];

  const problems: string[] = [];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const stat = fs.statSync(p);
      if (stat.size > 8_000_000) {
        problems.push(`${p} is too large (${stat.size} bytes)`);
        continue;
      }
      const script = fs.readFileSync(p, 'utf8');
      if (!script.includes('__vortexBrowseEnhancer')) {
        problems.push(`${p} does not look like the browse enhancer runtime`);
        continue;
      }
      if (isNodeBundle(script)) {
        problems.push(`${p} is a webpack/Node bundle, not the page runtime`);
        continue;
      }
      return { script, source: p };
    } catch {
      continue;
    }
  }
  return {
    error: `Browse injection runtime not found${problems.length ? ` (${problems.join('; ')})` : ''}. Expected vortex-builtin-mod-browser-enhanced/src/injectionRuntime.js next to Mod Hub, or set MOD_HUB_INJECTION_SCRIPT to that file.`,
  };
}
