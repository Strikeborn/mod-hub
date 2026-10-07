import fs from 'node:fs';
import path from 'node:path';
import { parseVdf } from './vdfSimple';

function driveLetters(): string[] {
  const out: string[] = [];
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    const root = `${letter}:\\`;
    try {
      fs.accessSync(root);
      out.push(root);
    } catch {
      /* not mounted */
    }
  }
  return out;
}

function addLibraryFromVdf(steamRoot: string, roots: Set<string>) {
  const libVdf = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
  if (!fs.existsSync(libVdf)) return;
  roots.add(path.normalize(steamRoot));
  try {
    const parsed = parseVdf(fs.readFileSync(libVdf, 'utf8'));
    for (const [key, val] of Object.entries(parsed)) {
      if (!key.match(/^\d+$/)) continue;
      if (typeof val === 'object' && val !== null && 'path' in val) {
        const p = String((val as Record<string, unknown>).path ?? '')
          .replace(/\\\\/g, '\\')
          .replace(/\\/g, path.sep);
        if (p && fs.existsSync(p)) roots.add(path.normalize(p));
      }
    }
  } catch {
    /* keep root only */
  }
}

/** Find every Steam library root on all mounted drives (C:, F:, etc.). */
export function discoverSteamLibraries(): string[] {
  const roots = new Set<string>();

  const fixedCandidates = [
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)']!, 'Steam'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Steam'),
    process.env.SteamPath,
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
  ].filter(Boolean) as string[];

  for (const drive of driveLetters()) {
    for (const tail of [
      'Steam',
      'SteamLibrary',
      'Games\\Steam',
      'Program Files (x86)\\Steam',
      'Program Files\\Steam',
    ]) {
      fixedCandidates.push(path.join(drive, tail));
    }
  }

  for (const steamRoot of fixedCandidates) {
    if (!steamRoot || !fs.existsSync(steamRoot)) continue;
    addLibraryFromVdf(steamRoot, roots);
    const altVdf = path.join(steamRoot, 'libraryfolders.vdf');
    if (fs.existsSync(altVdf)) addLibraryFromVdf(steamRoot, roots);
  }

  for (const extra of discoverSecondarySteamLibraries()) {
    roots.add(extra);
  }

  return [...roots];
}

/** F:\\SteamLibrary-style folders: steamapps/common without libraryfolders.vdf on C. */
function discoverSecondarySteamLibraries(): string[] {
  const out: string[] = [];
  for (const drive of driveLetters()) {
    for (const name of ['SteamLibrary', 'Steam', 'Games']) {
      const base = path.join(drive, name);
      if (fs.existsSync(path.join(base, 'steamapps', 'common'))) {
        out.push(path.normalize(base));
      }
      if (fs.existsSync(path.join(base, 'steamapps', 'workshop', 'content'))) {
        out.push(path.normalize(base));
      }
    }
  }
  return out;
}

/** Find game install folders by name on any drive (limited depth). */
export function findGameInstallFolders(folderNames: string[], maxDepth = 4): string[] {
  const found: string[] = [];
  const want = new Set(folderNames.map((n) => n.toLowerCase()));

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (want.has(e.name.toLowerCase())) {
        found.push(path.join(dir, e.name));
        continue;
      }
      if (/^(Windows|Program Files|node_modules|\$RECYCLE|\.)/i.test(e.name)) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  }

  const searchRoots: string[] = [];
  for (const drive of driveLetters()) {
    for (const tail of ['', 'Games', 'SteamLibrary', 'Steam', 'Program Files (x86)', 'Program Files']) {
      const p = tail ? path.join(drive, tail) : drive;
      if (fs.existsSync(p)) searchRoots.push(p);
    }
  }

  for (const root of searchRoots) {
    walk(root, 0);
  }
  return [...new Set(found.map((p) => path.normalize(p)))];
}
