import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SecurityDefender, SecurityVirusTotal } from '../shared/types';

/**
 * Malware checks (shared approach with Model Organizer, F:\Model Organizer\electron\security.ts):
 * - Microsoft Defender (MpCmdRun) scans a file or folder on disk, archives included. Works on demand even in
 *   passive mode (another antivirus such as Malwarebytes is primary). Threats are handled by Defender as usual.
 * - VirusTotal is asked about a file's SHA-256 only: files are never uploaded (uploads become visible to
 *   VirusTotal's paying customers). Needs the user's free API key; free keys allow 4 lookups per minute.
 * Malwarebytes has no command-line scanner; its real-time protection checks files as they're written.
 */

function defenderExe(): string | null {
  const candidates = [path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe')];
  // Newer platform builds live under ProgramData\…\Platform\<version>\.
  const platform = path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Microsoft', 'Windows Defender', 'Platform');
  try {
    for (const v of fs.readdirSync(platform).sort().reverse()) candidates.push(path.join(platform, v, 'MpCmdRun.exe'));
  } catch {
    // no platform folder
  }
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

export function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

/** Defender custom scan of one file or folder. Exit code 0 = clean, 2 = threats found. */
export function defenderScan(target: string): Promise<SecurityDefender> {
  const exe = defenderExe();
  if (!exe) return Promise.resolve({ status: 'unavailable', detail: 'Microsoft Defender not found' });
  return new Promise((resolve) => {
    let out = '';
    const p = spawn(exe, ['-Scan', '-ScanType', '3', '-File', target], { windowsHide: true });
    const timer = setTimeout(() => p.kill(), 10 * 60_000);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('error', (e) => {
      clearTimeout(timer);
      resolve({ status: 'unavailable', detail: e.message });
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      const last = out.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
      if (code === 0) resolve({ status: 'clean', detail: last });
      else if (code === 2) resolve({ status: 'threat', detail: out.trim().slice(-600) });
      // Defender switched off entirely, or the scan failed.
      else resolve({ status: 'unavailable', detail: last || `MpCmdRun exited with ${code}` });
    });
  });
}

/** VirusTotal verdict for a hash (no upload). */
export async function virusTotalLookup(hash: string, apiKey: string | undefined): Promise<SecurityVirusTotal> {
  if (!apiKey) return { status: 'no-key' };
  try {
    const res = await fetch(`https://www.virustotal.com/api/v3/files/${hash}`, { headers: { 'x-apikey': apiKey } });
    if (res.status === 404) return { status: 'unknown' };
    if (res.status === 429) return { status: 'error', detail: 'VirusTotal rate limit (free keys: 4 per minute)' };
    if (res.status === 401) return { status: 'error', detail: 'VirusTotal rejected the API key' };
    if (!res.ok) return { status: 'error', detail: `VirusTotal HTTP ${res.status}` };
    const j = (await res.json()) as { data?: { attributes?: { last_analysis_stats?: Record<string, number> } } };
    const s = j.data?.attributes?.last_analysis_stats ?? {};
    const malicious = s.malicious ?? 0;
    const suspicious = s.suspicious ?? 0;
    const engines = Object.values(s).reduce((a, b) => a + b, 0);
    return { status: malicious ? 'flagged' : 'clean', malicious, suspicious, engines };
  } catch (e) {
    return { status: 'error', detail: (e as Error).message };
  }
}
