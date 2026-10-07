import fs from 'node:fs';
import path from 'node:path';
import type { ModRecord, OrderIssue, OrderPlan } from '../shared/types';
import { rimworldModsConfigFile } from './loadOrder';

/**
 * RimWorld ordering from each mod's About/About.xml, the same rules RimWorld's own sorter uses:
 * modDependencies (dependency loads first), loadAfter / loadBefore (+ forceLoad*), incompatibleWith,
 * including the *ByVersion variants for the running game version. Sorting is a stable topological sort:
 * mods only move when a rule requires it, otherwise they keep your order.
 */

type Rules = {
  id: string;
  name: string;
  deps: { id: string; alternatives: string[]; name?: string }[];
  after: string[];
  before: string[];
  incompatible: string[];
};

const norm = (id: string) => id.trim().toLowerCase().replace(/_steam$/, '');

const DLC_ORDER = [
  'ludeon.rimworld',
  'ludeon.rimworld.royalty',
  'ludeon.rimworld.ideology',
  'ludeon.rimworld.biotech',
  'ludeon.rimworld.anomaly',
  'ludeon.rimworld.odyssey',
];
const DLC_NAMES: Record<string, string> = {
  'ludeon.rimworld': 'Core',
  'ludeon.rimworld.royalty': 'Royalty',
  'ludeon.rimworld.ideology': 'Ideology',
  'ludeon.rimworld.biotech': 'Biotech',
  'ludeon.rimworld.anomaly': 'Anomaly',
  'ludeon.rimworld.odyssey': 'Odyssey',
};

function gameVersion(): string {
  try {
    const v = /<version>\s*(\d+\.\d+)/i.exec(fs.readFileSync(rimworldModsConfigFile(), 'utf8'))?.[1];
    return v ?? '1.5';
  } catch {
    return '1.5';
  }
}

/** Inner text of <tag> (first match), or of <tagByVersion><vX.Y> for this game version. */
function block(xml: string, tag: string, version: string): string[] {
  const out: string[] = [];
  const plain = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(xml)?.[1];
  if (plain) out.push(plain);
  const byVer = new RegExp(`<${tag}ByVersion>([\\s\\S]*?)</${tag}ByVersion>`, 'i').exec(xml)?.[1];
  if (byVer) {
    const v = new RegExp(`<v${version.replace('.', '\\.')}>([\\s\\S]*?)</v${version.replace('.', '\\.')}>`, 'i').exec(byVer)?.[1];
    if (v) out.push(v);
  }
  return out;
}

function liValues(blocks: string[]): string[] {
  return blocks.flatMap((b) => [...b.matchAll(/<li>\s*([^<\s][^<]*?)\s*<\/li>/gi)].map((m) => norm(m[1])));
}

function parseAbout(xml: string, version: string, fallbackId: string, title: string): Rules {
  const own = xml.replace(
    /<(modDependencies|modDependenciesByVersion|loadAfter|loadBefore|loadAfterByVersion|loadBeforeByVersion|forceLoadAfter|forceLoadBefore|incompatibleWith|incompatibleWithByVersion)\b[\s\S]*?<\/\1>/gi,
    '',
  );
  const id = norm(/<packageId>\s*([^<]+?)\s*<\/packageId>/i.exec(own)?.[1] ?? fallbackId);
  // One dependency per <packageId>; its <li> can hold a nested <alternativePackageIds> list, so split on packageId.
  const deps = block(xml, 'modDependencies', version).flatMap((b) =>
    b.split(/(?=<packageId>)/i).filter((seg) => /<packageId>/i.test(seg)).map((li) => {
      return {
        id: norm(/<packageId>\s*([^<]+?)\s*<\/packageId>/i.exec(li)?.[1] ?? ''),
        name: /<displayName>\s*([^<]+?)\s*<\/displayName>/i.exec(li)?.[1],
        alternatives: [...(/<alternativePackageIds>([\s\S]*?)<\/alternativePackageIds>/i.exec(li)?.[1] ?? '').matchAll(/<li>\s*([^<]+?)\s*<\/li>/gi)].map(
          (a) => norm(a[1]),
        ),
      };
    }),
  );
  return {
    id,
    name: title,
    deps: deps.filter((d) => d.id),
    after: [...liValues(block(xml, 'loadAfter', version)), ...liValues(block(xml, 'forceLoadAfter', version))],
    before: [...liValues(block(xml, 'loadBefore', version)), ...liValues(block(xml, 'forceLoadBefore', version))],
    incompatible: liValues(block(xml, 'incompatibleWith', version)),
  };
}

function aboutFile(modRoot: string): string | undefined {
  for (const p of [path.join(modRoot, 'About', 'About.xml'), path.join(modRoot, 'About', 'about.xml')]) if (fs.existsSync(p)) return p;
  return undefined;
}

/** Rules for every installed RimWorld mod, keyed by normalized packageId. */
export function rimworldRules(mods: ModRecord[]): Map<string, Rules> {
  const version = gameVersion();
  const map = new Map<string, Rules>();
  for (const m of mods) {
    if (m.gameId !== 'rimworld' || !m.localPath) continue;
    const f = aboutFile(m.localPath);
    if (!f) continue;
    try {
      const r = parseAbout(fs.readFileSync(f, 'utf8'), version, m.modIds?.[0] ?? m.id, m.title);
      if (!map.has(r.id)) map.set(r.id, r);
    } catch {
      /* unreadable About.xml: no rules */
    }
  }
  return map;
}

/**
 * Check `order` (package ids, the active list) and compute the closest valid order.
 * Kahn's algorithm with "position in your current list" as the tie-breaker, so only rule-breaking mods move.
 */
export function planRimworldOrder(order: string[], mods: ModRecord[]): OrderPlan {
  const rules = rimworldRules(mods);
  const ids = order.map(norm);
  const active = new Set(ids);
  const rank = new Map(ids.map((id, i) => [id, i]));
  const nameOf = (id: string) => DLC_NAMES[id] ?? rules.get(id)?.name ?? id;
  const issues: OrderIssue[] = [];

  // edges: a -> b means a must load before b
  const edges = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
  const why = new Map<string, string>();
  const addEdge = (a: string, b: string, reason: string) => {
    if (a === b || !active.has(a) || !active.has(b)) return;
    edges.get(a)!.add(b);
    if (!why.has(`${a}>${b}`)) why.set(`${a}>${b}`, reason);
  };

  // Core first among Ludeon content, DLC in release order.
  const dlcs = DLC_ORDER.filter((d) => active.has(d));
  for (let i = 0; i + 1 < dlcs.length; i++) addEdge(dlcs[i], dlcs[i + 1], 'Core and DLC load in release order');

  for (const id of ids) {
    const r = rules.get(id);
    if (!r) continue;
    for (const d of r.deps) {
      const hit = [d.id, ...d.alternatives].find((x) => active.has(x));
      if (hit) addEdge(hit, id, `${nameOf(id)} needs ${nameOf(hit)}`);
      else if (!DLC_NAMES[d.id] || !active.has(d.id)) {
        const installed = rules.has(d.id) || d.alternatives.some((a) => rules.has(a));
        issues.push({
          kind: installed ? 'dependency-off' : 'dependency-missing',
          modId: id,
          otherId: d.id,
          message: installed
            ? `${nameOf(id)} needs ${d.name ?? nameOf(d.id)}, which is installed but not enabled.`
            : `${nameOf(id)} needs ${d.name ?? d.id}, which isn't installed.`,
        });
      }
    }
    for (const a of r.after) addEdge(a, id, `${nameOf(id)} loads after ${nameOf(a)}`);
    for (const b of r.before) addEdge(id, b, `${nameOf(id)} loads before ${nameOf(b)}`);
    for (const x of r.incompatible) {
      if (active.has(x) && id < x) {
        issues.push({ kind: 'incompatible', modId: id, otherId: x, message: `${nameOf(id)} is marked incompatible with ${nameOf(x)}.` });
      }
    }
  }

  // RimWorld convention: mods load after Core and the DLC unless their own rules put them before one of them
  // (Harmony, Prepatcher, Fishery, Performance Fish…). Find every mod that must precede some Ludeon entry
  // (directly or through other rules) and give everything else "after Core/DLC" so stray mods don't float to the top.
  const ludeon = DLC_ORDER.filter((d) => active.has(d));
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [a, outs] of edges) for (const b of outs) preds.get(b)!.push(a);
  const mustPrecedeLudeon = new Set<string>();
  const stack = [...ludeon];
  while (stack.length) {
    for (const p of preds.get(stack.pop()!)!) {
      if (!mustPrecedeLudeon.has(p) && !DLC_NAMES[p]) {
        mustPrecedeLudeon.add(p);
        stack.push(p);
      }
    }
  }
  for (const id of ids) {
    if (DLC_NAMES[id] || mustPrecedeLudeon.has(id)) continue;
    for (const d of ludeon) {
      if (edges.get(id)!.has(d)) continue;
      edges.get(d)!.add(id);
      if (!why.has(`${d}>${id}`)) why.set(`${d}>${id}`, `${nameOf(id)} loads after ${nameOf(d)} (RimWorld default)`);
    }
  }

  // Same packageId on two installed mods (e.g. Hospitality and Hospitality (Continued)): RimWorld loads one.
  const byId = new Map<string, string[]>();
  for (const m of mods) {
    if (m.gameId !== 'rimworld') continue;
    for (const raw of m.modIds ?? []) byId.set(norm(raw), [...(byId.get(norm(raw)) ?? []), m.title]);
  }
  for (const [id, titles] of byId) {
    if (titles.length > 1 && active.has(id)) {
      issues.push({ kind: 'duplicate-id', modId: id, message: `${titles.join(' and ')} share the id ${id}; RimWorld only loads one of them.` });
    }
  }

  // Order problems in the list as it is now: one issue per misplaced mod (first broken rule + how many more).
  const broken = new Map<string, { a: string; extra: number }>();
  for (const [a, outs] of edges) {
    for (const b of outs) {
      if (rank.get(a)! <= rank.get(b)!) continue;
      const hit = broken.get(b);
      if (hit) hit.extra += 1;
      else broken.set(b, { a, extra: 0 });
    }
  }
  for (const [b, { a, extra }] of broken) {
    issues.push({
      kind: 'order',
      modId: b,
      otherId: a,
      message: `${why.get(`${a}>${b}`)}, but it's currently above it${extra ? ` (+${extra} more rule${extra > 1 ? 's' : ''})` : ''}.`,
    });
  }

  // Stable topological sort.
  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const outs of edges.values()) for (const b of outs) indeg.set(b, indeg.get(b)! + 1);
  const ready = ids.filter((id) => indeg.get(id) === 0);
  const sorted: string[] = [];
  while (ready.length) {
    ready.sort((a, b) => rank.get(a)! - rank.get(b)!);
    const n = ready.shift()!;
    sorted.push(n);
    for (const b of edges.get(n)!) {
      indeg.set(b, indeg.get(b)! - 1);
      if (indeg.get(b) === 0) ready.push(b);
    }
  }
  if (sorted.length < ids.length) {
    const stuck = ids.filter((id) => !sorted.includes(id));
    issues.push({
      kind: 'cycle',
      modId: stuck[0],
      message: `These mods have rules that contradict each other, so they keep their current order: ${stuck.map(nameOf).join(', ')}.`,
    });
    sorted.push(...stuck);
  }

  // Write back the ids exactly as they appeared in the list (keeps any _steam suffix).
  const original = new Map(order.map((raw) => [norm(raw), raw]));
  const proposed = sorted.map((id) => original.get(id) ?? id);
  const moved = proposed.filter((id, i) => norm(id) !== ids[i]).length;
  return { gameId: 'rimworld', current: order, proposed, moved, issues };
}

/** The active list exactly as ModsConfig.xml has it. */
export function readRimworldActive(): string[] {
  try {
    const xml = fs.readFileSync(rimworldModsConfigFile(), 'utf8');
    const block = /<activeMods>([\s\S]*?)<\/activeMods>/i.exec(xml)?.[1] ?? '';
    return [...block.matchAll(/<li>\s*([^<]+?)\s*<\/li>/gi)].map((m) => m[1]);
  } catch {
    return [];
  }
}
