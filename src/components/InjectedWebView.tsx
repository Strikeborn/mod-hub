import { useEffect, useRef, useState } from 'react';

type Props = {
  src: string;
  title: string;
  partition?: string;
};

type GuestEl = HTMLElement & {
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
  getWebContentsId?: () => number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  getURL?: () => string;
};

/** Nexus browse webview + Vortex carousel enhancer (main-process injection). */
export function InjectedWebView({ src, title, partition = 'persist:modhub-nexus-injected' }: Props) {
  const ref = useRef<GuestEl>(null);
  const [status, setStatus] = useState<{ kind: 'working' | 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el?.getWebContentsId) return;

    let cancelled = false;

    async function runInject() {
      const guestId = el!.getWebContentsId!();
      const pageUrl = el!.getURL?.() || src;
      if (!pageUrl.includes('nexusmods.com')) return;
      setStatus({ kind: 'working', text: 'Injecting carousel enhancer…' });
      const r = await window.modHub?.injectBrowseEnhancer(guestId, pageUrl);
      if (cancelled || !r) return;
      setStatus({ kind: r.ok ? 'ok' : 'error', text: r.message });
    }

    const onLoad = () => {
      setTimeout(() => void runInject(), 800);
    };
    el.addEventListener('dom-ready', onLoad);
    el.addEventListener('did-navigate-in-page', onLoad);
    el.addEventListener('did-navigate', onLoad);
    return () => {
      cancelled = true;
      el.removeEventListener('dom-ready', onLoad);
      el.removeEventListener('did-navigate-in-page', onLoad);
      el.removeEventListener('did-navigate', onLoad);
    };
  }, [src]);

  if (
    typeof window !== 'undefined' &&
    (window as Window & { modHubEnv?: { isElectron?: boolean } }).modHubEnv?.isElectron
  ) {
    return (
      <>
        {status && (
          <p className={`message message-compact${status.kind === 'error' ? ' message-error' : ''}`}>
            {status.kind === 'ok' ? '✓ ' : ''}
            {status.text}
          </p>
        )}
        <webview
          ref={ref as never}
          src={src}
          title={title}
          partition={partition}
          webpreferences="contextIsolation=yes, sandbox=no, webSecurity=no, allowRunningInsecureContent=yes"
          style={{ width: '100%', height: 'calc(100vh - 200px)', border: 'none', borderRadius: 8, background: '#111' }}
        />
      </>
    );
  }

  return (
    <div className="empty-state">
      <p>Injected browse requires the Mod Hub desktop app.</p>
    </div>
  );
}
