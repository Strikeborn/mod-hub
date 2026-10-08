import { useEffect, useState } from 'react';
import type { CatalogSnapshot, HubSettings } from '@shared/types';
import { isNexusLikeSource } from '../utils/games';

type Props = {
  catalog: CatalogSnapshot;
  onSaved: () => void;
};

export function SettingsView({ catalog, onSaved }: Props) {
  const [settings, setSettings] = useState<HubSettings | null>(null);
  const [nexusKey, setNexusKey] = useState('');
  const [vtKey, setVtKey] = useState('');
  const [message, setMessage] = useState('');

  async function saveBg(partial: Partial<HubSettings>) {
    if (!window.modHub) return;
    setSettings(await window.modHub.saveSettings(partial));
    setMessage('Saved.');
  }

  useEffect(() => {
    window.modHub?.getSettings().then((s) => {
      setSettings(s);
      setNexusKey(s.nexusApiKey ?? '');
      setVtKey(s.virusTotalApiKey ?? '');
    });
  }, []);

  if (!settings) return <div className="empty-state">Loading settings…</div>;

  async function saveNexus() {
    if (!window.modHubAuth) return;
    const r = await window.modHubAuth.validateNexusKey(nexusKey.trim());
    setMessage(r.message);
    if (r.ok) {
      await window.modHub.saveSettings({ nexusApiKey: nexusKey.trim(), nexusConnected: true });
      onSaved();
    }
  }

  async function testNexusTracked() {
    const r = await window.modHub?.nexusFetchTracked('cyberpunk2077');
    setMessage(r?.message ?? 'No response');
  }

  async function addScanFolders() {
    if (!settings) return;
    const picked = await window.modHub.pickScanFolders();
    if (picked.length === 0) return;
    const next = [...new Set([...settings.extraScanPaths, ...picked])];
    await window.modHub.saveSettings({ extraScanPaths: next });
    setSettings({ ...settings, extraScanPaths: next });
    setMessage(`Added ${picked.length} folder(s) to scan list.`);
  }

  async function onDefaultGameFilter(value: string) {
    if (!settings) return;
    await window.modHub.saveSettings({ defaultGameFilter: value });
    setSettings({ ...settings, defaultGameFilter: value });
    setMessage(value === 'last' ? 'Default game filter: last chosen per tab.' : 'Default game filter: All games.');
  }

  const report = catalog.scanReport;
  const nexusCount = catalog.mods.filter((m) => isNexusLikeSource(m)).length;

  return (
    <div className="settings-layout">
      <div className="settings-form">
        <h2>Library defaults</h2>
        <label>
          Default game filter (All mods & Steam tabs)
          <select
            value={settings.defaultGameFilter ?? 'all'}
            onChange={(e) => void onDefaultGameFilter(e.target.value)}
          >
            <option value="all">All games</option>
            <option value="last">Last chosen (remember per tab)</option>
          </select>
        </label>

        <h2>Background checks</h2>
        <p className="message message-compact settings-centered-note">
          Workshop ratings and re-upload search go through the Steam client. Ratings run as Valve's test app
          (Spacewar) for a few seconds, once a day. The re-upload search has to run as the mod's game, so Steam
          briefly shows that game as played (weekly, only for mods removed from the Workshop).
        </p>
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={settings.workshopRatingsEnabled !== false}
            onChange={(e) => void saveBg({ workshopRatingsEnabled: e.target.checked })}
          />
          Workshop star ratings (daily, via Steam)
        </label>
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={settings.reuploadSearchEnabled !== false}
            onChange={(e) => void saveBg({ reuploadSearchEnabled: e.target.checked })}
          />
          Look for re-uploads of removed Workshop mods (via Steam)
        </label>
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={settings.nexusUpdateChecksEnabled !== false}
            onChange={(e) => void saveBg({ nexusUpdateChecksEnabled: e.target.checked })}
          />
          Check Nexus for updates, endorsements and downloads every
          <select
            value={settings.nexusUpdateIntervalHours ?? 6}
            disabled={settings.nexusUpdateChecksEnabled === false}
            onChange={(e) => void saveBg({ nexusUpdateIntervalHours: Number(e.target.value) })}
          >
            {[1, 3, 6, 12, 24].map((h) => (
              <option key={h} value={h}>
                {h} h
              </option>
            ))}
          </select>
        </label>

        <h2>Malware checks</h2>
        <p className="message message-compact settings-centered-note">
          New or changed mods are scanned with Microsoft Defender (it works on demand even when Malwarebytes is your main
          antivirus). Programs and DLLs are also looked up on VirusTotal <strong>by fingerprint only, never uploaded</strong>.
          Malwarebytes has no command-line scanner; its real-time protection covers files as they are written.
        </p>
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={settings.securityAutoCheck !== false}
            onChange={(e) => void saveBg({ securityAutoCheck: e.target.checked })}
          />
          Check new and changed mods automatically (after scans)
        </label>
        <label>
          VirusTotal API key (free at virustotal.com → profile → API key; 4 lookups/min)
          <input
            type="password"
            value={vtKey}
            placeholder="optional"
            onChange={(e) => setVtKey(e.target.value)}
            onBlur={() => void saveBg({ virusTotalApiKey: vtKey.trim() || undefined })}
          />
        </label>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const r = await window.modHub?.checkAllExecutableMods();
            if (r) setMessage(r.message);
          }}
        >
          Check all mods with programs/DLLs now
        </button>

        <h2>Accounts</h2>
        <p className="message message-compact settings-centered-note">
          Nexus API key: track/list mods via REST. Webview login is still separate for browsing.
        </p>
        <button type="button" className="btn" onClick={() => window.modHubAuth?.openNexusLogin()}>
          Open Nexus API key page
        </button>
        <label>
          Nexus API key
          <input type="password" value={nexusKey} onChange={(e) => setNexusKey(e.target.value)} autoComplete="off" />
        </label>
        <button type="button" className="btn btn-primary" onClick={saveNexus}>
          Save & validate Nexus key
        </button>
        <button type="button" className="btn" onClick={() => void testNexusTracked()}>
          Test tracked list (Cyberpunk 2077)
        </button>
        <button type="button" className="btn" onClick={() => window.modHubAuth?.openSteamLogin()}>
          Open Steam login (Workshop)
        </button>

        <h2>Scan paths</h2>
        <button type="button" className="btn" onClick={addScanFolders}>
          Add folders to scan…
        </button>
        <ul>
          {settings.extraScanPaths.map((p) => (
            <li key={p} style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {p}
            </li>
          ))}
        </ul>
        {message && <p className="message">{message}</p>}
      </div>

      <div className="settings-form settings-form-secondary">
        <h2>Scan summary</h2>
        <p className="message message-compact">
          Catalog: {catalog.mods.length} items · Nexus/Vortex: {nexusCount}
        </p>
        {report?.workshopEnrich && (
          <p className="message message-compact">
            Workshop enrich: {report.workshopEnrich.detailsFetched}/{report.workshopEnrich.workshopIds} API rows,{' '}
            {report.workshopEnrich.appliedToMods} mods updated.
          </p>
        )}
        {report && (
          <div className="scan-report-scroll">
            <h3>Last scan — where items were found</h3>
            {report.libraries.length > 0 && (
              <>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Steam libraries</p>
                <ul className="scan-report-list">
                  {report.libraries.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </>
            )}
            {Object.keys(report.bySource).length > 0 && (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                By source:{' '}
                {Object.entries(report.bySource)
                  .map(([k, n]) => `${k}: ${n}`)
                  .join(' · ')}
              </p>
            )}
            {report.locations.length > 0 && (
              <ul className="scan-report-list">
                {report.locations.slice(0, 80).map((loc) => (
                  <li key={`${loc.label}|${loc.path}`}>
                    <strong>{loc.modCount}</strong> — {loc.label}
                    <span className="scan-report-path">{loc.path}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {settings.lastFullScan && (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Last scan: {new Date(settings.lastFullScan).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
