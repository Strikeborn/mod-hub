import fs from 'node:fs';
import path from 'node:path';
import type { ModRecord, ModSecurityReport, SecurityStatus } from '../shared/types';
import { downloadDiskPath } from '../shared/modDiskPath';
import { defenderScan, sha256, virusTotalLookup } from './security';
import { isaacLuaRisks } from './luaGuard';

/**
 * Malware checks for mods. Executable content (programs, DLL plugins, script-extender plugins, scripts that
 * Windows runs) is what can hurt you, so it's listed per mod, flagged on cards, scanned with Defender and
 * looked up on VirusTotal by hash. Results are kept in %APPDATA%\mod-hub\security.json and re-checked when the
 * files change.
 */

/** Files that run code: programs, plugins/DLLs (SKSE/F4SE/ASI loaders), Windows script hosts, installers. */
const RISKY = /\.(exe|dll|asi|scr|com|bat|cmd|ps1|vbs|vbe|js|jse|wsf|hta|msi|jar|lnk|sys)$/i;
const MAX_FILES = 25;

type Store = {
  sweep?: import('../shared/types').DefenderSweep;
  reports: Record<string, ModSecurityReport>;
  /** risky = program/DLL/script files; lua = blocked Lua APIs used (Isaac: only work with LuaDebug on). */
  inventory: Record<string, { sig: string; risky: string[]; lua?: string[] }>;
};

let storePath = '';
export function initSecurityStore(userData: string): void {
  storePath = path.join(userData, 'security.json');
}

function load(): Store {
  try {
    const s = JSON.parse(fs.readFileSync(storePath, 'utf8')) as Store;
    return { reports: s.reports ?? {}, inventory: s.inventory ?? {}, sweep: s.sweep };
  } catch {
    return { reports: {}, inventory: {} };
  }
}

function save(s: Store): void {
  if (!storePath) return;
  fs.writeFileSync(storePath, JSON.stringify(s), 'utf8');
}

/** The folder (or single file) a mod lives in on disk. */
function modRoot(m: ModRecord): string | undefined {
  const p = m.localPath;
  if (!p || !fs.existsSync(p)) return undefined;
  return p;
}

/** Risky files under a mod (relative paths), plus a signature that changes when they change. */
export function riskyFiles(root: string): { files: { rel: string; abs: string; size: number; mtimeMs: number }[]; sig: string } {
  const files: { rel: string; abs: string; size: number; mtimeMs: number }[] = [];
  const st = fs.statSync(root);
  if (st.isFile()) {
    if (RISKY.test(root)) files.push({ rel: path.basename(root), abs: root, size: st.size, mtimeMs: st.mtimeMs });
  } else {
    let seen = 0;
    const walk = (dir: string, depth: number) => {
      if (depth > 10 || seen > 20_000) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        seen += 1;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) walk(abs, depth + 1);
        else if (RISKY.test(e.name)) {
          try {
            const s = fs.statSync(abs);
            files.push({ rel: path.relative(root, abs), abs, size: s.size, mtimeMs: s.mtimeMs });
          } catch {
            /* vanished */
          }
        }
      }
    };
    walk(root, 0);
  }
  const sig = `${files.length}:${files.reduce((a, f) => a + f.size, 0)}:${Math.max(0, ...files.map((f) => Math.round(f.mtimeMs)))}`;
  return { files, sig };
}

function archiveOf(m: ModRecord): string | undefined {
  const a = downloadDiskPath(m);
  return a && fs.existsSync(a) && /\.(zip|7z|rar)$/i.test(a) ? a : undefined;
}

// VirusTotal free keys: 4 requests/minute. One queue for the whole app.
let vtChain: Promise<unknown> = Promise.resolve();
function vtQueued<T>(fn: () => Promise<T>): Promise<T> {
  const run = vtChain.then(fn);
  vtChain = run.then(
    () => new Promise((r) => setTimeout(r, 15_500)),
    () => new Promise((r) => setTimeout(r, 15_500)),
  );
  return run;
}

export function summarize(r: ModSecurityReport | undefined): SecurityStatus {
  if (!r) return 'unchecked';
  if (r.defender.status === 'threat') return 'threat';
  const vts = [r.archive?.virusTotal, ...r.executables.map((e) => e.virusTotal)].filter(Boolean);
  if (vts.some((v) => v!.status === 'flagged' && (v!.malicious ?? 0) >= 3)) return 'flagged';
  if (vts.some((v) => v!.status === 'flagged')) return 'review';
  if (r.defender.status === 'unavailable') return 'unavailable';
  return 'clean';
}

/** Full check of one mod: Defender on its folder (+ download archive), hashes, VirusTotal lookups. */
export async function checkMod(m: ModRecord, apiKey: string | undefined, opts: { maxVt?: number } = {}): Promise<ModSecurityReport> {
  const root = modRoot(m);
  const archive = archiveOf(m);
  const inv = root ? riskyFiles(root) : { files: [], sig: '0' };
  const targets = [...new Set([root, archive].filter((x): x is string => Boolean(x)))];
  let defender: ModSecurityReport['defender'] = { status: 'unavailable', detail: 'Nothing on disk to scan' };
  for (const t of targets) {
    const d = await defenderScan(t);
    defender = d;
    if (d.status !== 'clean') break;
  }
  const maxVt = opts.maxVt ?? MAX_FILES;
  let vtUsed = 0;
  const lookup = async (hash: string) => {
    if (!apiKey) return { status: 'no-key' as const };
    if (vtUsed >= maxVt) return { status: 'skipped' as const };
    vtUsed += 1;
    return vtQueued(() => virusTotalLookup(hash, apiKey));
  };
  let archiveResult: ModSecurityReport['archive'];
  if (archive && fs.existsSync(archive)) {
    const hash = await sha256(archive);
    archiveResult = { path: archive, sha256: hash, virusTotal: await lookup(hash) };
  }
  const executables: ModSecurityReport['executables'] = [];
  for (const f of inv.files.slice(0, MAX_FILES)) {
    if (!fs.existsSync(f.abs)) continue; // quarantined by Defender
    const hash = await sha256(f.abs);
    executables.push({ rel: f.rel, size: f.size, sha256: hash, virusTotal: await lookup(hash) });
  }
  const report: ModSecurityReport = {
    modId: m.id,
    checkedAt: new Date().toISOString(),
    defender,
    archive: archiveResult,
    executables,
    executableCount: inv.files.length,
    signature: `${inv.sig}|${archive ? fs.statSync(archive).size : 0}`,
    status: 'unchecked',
  };
  report.status = summarize(report);
  const s = load();
  s.reports[m.id] = report;
  s.inventory[m.id] = { sig: inv.sig, risky: inv.files.slice(0, 50).map((f) => f.rel) };
  save(s);
  return report;
}

export type SecurityOverview = Record<string, { status: SecurityStatus; executables: number; stale: boolean; checkedAt?: string; lua?: string[] }>;

/** Card-level view for every mod: executable count (inventory) and the last check's status. */
export function securityOverview(): SecurityOverview {
  const s = load();
  const out: SecurityOverview = {};
  for (const [id, inv] of Object.entries(s.inventory)) {
    const r = s.reports[id];
    out[id] = {
      status: r ? r.status : 'unchecked',
      executables: inv.risky.length,
      stale: Boolean(r && r.signature.split('|')[0] !== inv.sig),
      checkedAt: r?.checkedAt,
      lua: inv.lua?.length ? inv.lua : undefined,
    };
  }
  return out;
}

export function securityReport(modId: string): ModSecurityReport | undefined {
  return load().reports[modId];
}

/**
 * Background pass: refresh the executable inventory for every mod whose files changed (cheap: directory walk),
 * then fully check mods that are new or changed since their last check (Defender always; VirusTotal for the
 * archive + first few executables when a key is set). `baseline` = mods installed before this feature existed
 * aren't auto-scanned (use "Check all" in Settings for those).
 */
export async function backgroundSecurityPass(
  mods: ModRecord[],
  apiKey: string | undefined,
  baselineIso: string,
  onProgress?: (done: number, total: number, current: string) => void,
  /** "Check all": every mod that contains programs/DLLs/scripts and has no current result. */
  opts: { allWithExecutables?: boolean; shouldStop?: () => boolean } = {},
): Promise<{ inventoried: number; checked: number; threats: number; total: number; stopped: boolean }> {
  const s = load();
  let inventoried = 0;
  for (const m of mods) {
    const root = modRoot(m);
    if (!root) continue;
    try {
      const { files, sig } = riskyFiles(root);
      const lua = m.gameId === 'binding-of-isaac' && fs.statSync(root).isDirectory() ? isaacLuaRisks(root) : undefined;
      const prev = s.inventory[m.id];
      if (prev?.sig !== sig || JSON.stringify(prev?.lua ?? []) !== JSON.stringify(lua ?? [])) {
        s.inventory[m.id] = { sig, risky: files.slice(0, 50).map((f) => f.rel), lua: lua?.length ? lua : undefined };
        inventoried += 1;
      }
    } catch {
      /* unreadable */
    }
  }
  save(s);
  const due = mods.filter((m) => {
    const inv = s.inventory[m.id];
    const r = s.reports[m.id];
    if (!inv) return false;
    if (r) return r.signature.split('|')[0] !== inv.sig; // files changed since the last check
    if (opts.allWithExecutables) return inv.risky.length > 0;
    return (m.installedAt ?? '') > baselineIso; // new since the feature was turned on
  });
  let threats = 0;
  let checked = 0;
  for (let i = 0; i < due.length; i++) {
    if (opts.shouldStop?.()) return { inventoried, checked, threats, total: due.length, stopped: true };
    onProgress?.(i, due.length, due[i].title);
    const r = await checkMod(due[i], apiKey, { maxVt: 4 });
    checked += 1;
    if (r.status === 'threat' || r.status === 'flagged') threats += 1;
  }
  onProgress?.(due.length, due.length, '');
  return { inventoried, checked, threats, total: due.length, stopped: false };
}

/** Save a folder sweep; mods with a Defender finding get a "threat" report (shown on their card). */
export function recordSweep(sweep: import('../shared/types').DefenderSweep): void {
  const s = load();
  s.sweep = sweep;
  for (const t of sweep.threats) {
    if (!t.modId) continue;
    const prev = s.reports[t.modId];
    s.reports[t.modId] = {
      modId: t.modId,
      checkedAt: sweep.finishedAt,
      defender: { status: 'threat', detail: `${t.threat}: ${t.file}` },
      archive: prev?.archive,
      executables: prev?.executables ?? [],
      executableCount: prev?.executableCount ?? 0,
      signature: prev?.signature ?? '',
      status: 'threat',
    };
  }
  save(s);
}

export function lastSweep(): import('../shared/types').DefenderSweep | undefined {
  return load().sweep;
}
