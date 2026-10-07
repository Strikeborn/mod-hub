import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SEVEN_ZIP_CANDIDATES = [
  process.env.SEVEN_ZIP_PATH,
  'C:\\Program Files\\7-Zip\\7z.exe',
  'C:\\Program Files (x86)\\7-Zip\\7z.exe',
  path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Vortex', '7z.exe'),
].filter(Boolean) as string[];

let cached7z: string | null | undefined;

export function find7zExecutable(): string | null {
  if (cached7z !== undefined) return cached7z;
  for (const p of SEVEN_ZIP_CANDIDATES) {
    try {
      if (fs.existsSync(p)) {
        cached7z = p;
        return p;
      }
    } catch {
      /* ignore */
    }
  }
  const where = spawnSync('where.exe', ['7z'], { encoding: 'utf8', windowsHide: true });
  if (where.status === 0 && where.stdout?.trim()) {
    const first = where.stdout.trim().split(/\r?\n/)[0]?.trim();
    if (first && fs.existsSync(first)) {
      cached7z = first;
      return first;
    }
  }
  cached7z = null;
  return null;
}

/** List file paths inside zip/7z/rar using 7-Zip (fast `-ba` bare listing). */
export function listPathsWith7z(archivePath: string, timeoutMs = 25_000): string[] {
  const seven = find7zExecutable();
  if (!seven) return [];
  try {
    const stat = fs.statSync(archivePath);
    if (!stat.isFile() || stat.size > 900_000_000) return [];
  } catch {
    return [];
  }

  const result = spawnSync(seven, ['l', '-ba', archivePath], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) return [];
  const lines = (result.stdout ?? '').split(/\r?\n/);
  return lines.map((l) => l.trim()).filter(Boolean);
}
