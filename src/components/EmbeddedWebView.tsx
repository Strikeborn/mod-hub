type Props = {
  src: string;
  title: string;
  /** Persistent Electron session — login cookies survive app restarts. */
  partition?: string;
};

/** Electron `<webview>` — not available in plain browser preview. */
export function EmbeddedWebView({ src, title, partition = 'persist:modhub-webview' }: Props) {
  if (typeof window !== 'undefined' && (window as Window & { modHubEnv?: { isElectron?: boolean } }).modHubEnv?.isElectron) {
    return (
      <webview
        src={src}
        title={title}
        partition={partition}
        style={{ width: '100%', height: 'calc(100vh - 220px)', border: 'none', borderRadius: 8, background: '#111' }}
      />
    );
  }
  return (
    <div className="empty-state">
      <p>Embedded browse works in the Mod Hub desktop app.</p>
      <p>
        <a href={src} target="_blank" rel="noreferrer">
          Open in browser: {title}
        </a>
      </p>
    </div>
  );
}
