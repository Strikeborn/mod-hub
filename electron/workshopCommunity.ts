import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ModRecord, ReuploadCandidate } from '../shared/types';
import { resolveSteamCreatorNames } from './steamCreators';
import { loadWorkshopArchive } from './workshopArchive';

/**
 * Workshop data that needs the Steam client (no Web API key): vote counts for star ratings, and a text search
 * used to find re-uploads of mods that were removed from the Workshop. Both go through the steamworks.js
 * helper; each run briefly shows you "in game" in Steam, so ratings refresh at most once a day.
 */

type HelperItem = {
  id: string;
  ok: boolean;
  error?: string;
  title?: string;
  appId?: number;
  owner?: string;
  up?: number;
  down?: number;
  created?: number;
  updated?: number;
  preview?: string;
};

function runHelper(helperPath: string, args: string[], timeoutMs: number): Promise<HelperItem[]> {
  return new Promise((resolve) => {
    if (!fs.existsSync(helperPath)) return resolve([]);
    const child = spawn(process.execPath, [helperPath, ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      cwd: path.dirname(path.dirname(helperPath)),
      windowsHide: true,
    });
    const items: HelperItem[] = [];
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += String(d);
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('{')) continue;
        try {
          items.push(JSON.parse(line) as HelperItem);
        } catch {
          /* ignore */
        }
      }
    });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('close', () => {
      clearTimeout(timer);
      resolve(items);
    });
  });
}

/** Votes for every Workshop-linked row, one Steam session for all games. Returns rows updated. */
export async function refreshWorkshopVotes(mods: ModRecord[], helperPath: string): Promise<number> {
  const rows = mods.filter((m) => m.workshopId && /^\d+$/.test(m.workshopId) && (m.steamAppId || m.keptFromWorkshop));
  const ids = [...new Set(rows.map((m) => m.workshopId!))];
  if (!ids.length) return 0;
  const appId = rows[0].steamAppId ?? rows[0].keptFromWorkshop?.appId ?? 480;
  const items = await runHelper(helperPath, ['details', String(appId), ...ids], 60_000 + ids.length * 1_000);
  const byId = new Map(items.filter((i) => i.ok).map((i) => [i.id, i]));
  if (byId.size === 0) return 0; // Steam not running / helper failed: keep old numbers
  const now = new Date().toISOString();
  let n = 0;
  for (const m of rows) {
    const it = byId.get(m.workshopId!);
    if (!it) continue;
    if (m.workshopVotesUp !== it.up || m.workshopVotesDown !== it.down) n += 1;
    m.workshopVotesUp = it.up;
    m.workshopVotesDown = it.down;
    m.workshopVotesAt = now;
    if (it.owner && !m.authorSteamId) m.authorSteamId = it.owner;
  }
  return n;
}

/** Lower-case, drop leading !/#/symbols and [tags]/(tags), collapse punctuation. */
function normTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9']+/g, ' ')
    .replace(/'/g, '')
    .trim();
}

function titleMatch(original: string, candidate: string): 'exact' | 'close' | null {
  const a = normTitle(original);
  const b = normTitle(candidate);
  if (!a || !b) return null;
  if (a === b) return 'exact';
  // A re-upload usually keeps the title and may add to it ("… REBORN", "[B42] …"). The reverse, a shorter
  // candidate inside a longer original ("Undead Survivor" for "VFE Undead Survivor Patch"), is a different mod.
  if (b.includes(a) && a.length / b.length >= 0.6) return 'close';
  const wa = new Set(a.split(' '));
  const wb = new Set(b.split(' '));
  const inter = [...wa].filter((w) => wb.has(w)).length;
  return inter / new Set([...wa, ...wb]).size >= 0.75 ? 'close' : null;
}

function cleanName(n: string | undefined): string | undefined {
  return n?.replace(/\(.*?\)/g, '').trim().toLowerCase() || undefined;
}

const RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * For mods Steam reports as removed/hidden: search the Workshop by title and keep close matches, marking whether
 * the uploader is the original author. Only suggestions; nothing is subscribed. Returns rows updated.
 */
export async function findWorkshopReuploads(mods: ModRecord[], helperPath: string, force = false): Promise<number> {
  const archive = loadWorkshopArchive();
  const now = Date.now();
  const targets = mods.filter(
    (m) =>
      m.workshopId &&
      m.workshopHidden &&
      (m.steamAppId || m.keptFromWorkshop) &&
      (force || !m.reuploadCheckedAt || now - Date.parse(m.reuploadCheckedAt) > RECHECK_MS),
  );
  if (!targets.length) return 0;
  const installed = new Set(mods.filter((m) => m.workshopId).map((m) => m.workshopId!));
  let changed = 0;
  for (const m of targets.slice(0, 25)) {
    const appId = m.steamAppId ?? m.keptFromWorkshop!.appId;
    const e = archive[m.workshopId!];
    const title = e?.title ?? m.title;
    if (/^\d+$/.test(title.trim())) {
      // Hidden item with no real title: nothing to search for.
      m.reuploadCheckedAt = new Date().toISOString();
      continue;
    }
    const found = (await runHelper(helperPath, ['search', String(appId), title.replace(/^[^a-z0-9]+/i, '')], 45_000)).filter(
      (i) => i.ok && i.id !== m.workshopId && i.title,
    );
    const matches = found
      .map((i) => ({ i, match: titleMatch(title, i.title!) }))
      .filter((x): x is { i: HelperItem; match: 'exact' | 'close' } => x.match !== null);
    const names = await resolveSteamCreatorNames(matches.map((x) => x.i.owner!).filter(Boolean));
    const knownIds = new Set([m.authorSteamId, e?.authorSteamId].filter(Boolean) as string[]);
    const knownNames = new Set(
      [m.authorDisplayName, m.author, e?.authorDisplayName, e?.author]
        .map(cleanName)
        .filter((x): x is string => Boolean(x) && !/^\d{10,}$/.test(x!)),
    );
    const candidates: ReuploadCandidate[] = matches.map(({ i, match }) => {
      const ownerName = i.owner ? names.get(i.owner) : undefined;
      const sameAuthor: ReuploadCandidate['sameAuthor'] =
        i.owner && knownIds.has(i.owner)
          ? 'yes'
          : ownerName && knownNames.size
            ? knownNames.has(cleanName(ownerName)!)
              ? 'yes'
              : 'no'
            : knownIds.size
              ? 'no'
              : 'unknown';
      return {
        workshopId: i.id,
        appId: i.appId ?? appId,
        title: i.title!,
        ownerSteamId: i.owner,
        ownerName,
        sameAuthor,
        titleMatch: match,
        createdAt: i.created ? new Date(i.created * 1000).toISOString() : undefined,
        votesUp: i.up,
        votesDown: i.down,
        previewUrl: i.preview || undefined,
        installed: installed.has(i.id),
      };
    });
    const rank = (c: ReuploadCandidate) => (c.sameAuthor === 'yes' ? 0 : c.sameAuthor === 'unknown' ? 1 : 2) * 2 + (c.titleMatch === 'exact' ? 0 : 1);
    candidates.sort((a, b) => rank(a) - rank(b) || (b.votesUp ?? 0) - (a.votesUp ?? 0));
    const top = candidates.slice(0, 4);
    if (JSON.stringify(top) !== JSON.stringify(m.reuploadCandidates ?? [])) changed += 1;
    m.reuploadCandidates = top.length ? top : undefined;
    m.reuploadCheckedAt = new Date().toISOString();
  }
  return changed;
}
