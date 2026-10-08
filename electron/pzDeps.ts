import fs from 'node:fs';
import path from 'node:path';
import type { ModRecord, OrderIssue, OrderPlan } from '../shared/types';

/**
 * Project Zomboid dependency check: every mod.info can say `require=A,B` (B42 writes `require=\A,\B`).
 * PZ doesn't sort mods for you, but a required mod that's off or missing usually breaks the dependent one.
 */

// Some mod.info files are sloppy ("require=require=A"); strip a repeated key too.
const norm = (id: string) => id.trim().replace(/^require=/i, '').replace(/^\\+/, '').toLowerCase();

function modInfos(root: string): string[] {
  const out: string[] = [];
  const modsDir = path.join(root, 'mods');
  const dirs = fs.existsSync(modsDir) ? fs.readdirSync(modsDir).map((d) => path.join(modsDir, d)) : [root];
  for (const d of dirs) {
    for (const rel of ['mod.info', path.join('42', 'mod.info'), path.join('common', 'mod.info')]) {
      const f = path.join(d, rel);
      if (fs.existsSync(f)) out.push(f);
    }
  }
  return out;
}

export function planPzOrder(order: string[], mods: ModRecord[]): OrderPlan {
  const requires = new Map<string, { name: string; req: string[] }>();
  const installed = new Map<string, string>(); // id -> display name
  for (const m of mods) {
    if (m.gameId !== 'project-zomboid' || !m.localPath) continue;
    for (const f of modInfos(m.localPath)) {
      let text = '';
      try {
        text = fs.readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      const id = /^id=(.*)$/im.exec(text)?.[1]?.trim();
      if (!id) continue;
      const name = /^name=(.*)$/im.exec(text)?.[1]?.trim() ?? id;
      installed.set(norm(id), name);
      const req = (/^require=(.*)$/im.exec(text)?.[1] ?? '').split(',').map(norm).filter(Boolean);
      const prev = requires.get(norm(id));
      requires.set(norm(id), { name, req: [...new Set([...(prev?.req ?? []), ...req])] });
    }
  }
  const active = new Set(order.map(norm));
  const issues: OrderIssue[] = [];
  for (const raw of order) {
    const id = norm(raw);
    const r = requires.get(id);
    if (!r) continue;
    for (const dep of r.req) {
      if (active.has(dep)) continue;
      const depName = installed.get(dep);
      issues.push({
        kind: depName ? 'dependency-off' : 'dependency-missing',
        modId: id,
        otherId: dep,
        message: depName
          ? `${r.name} needs ${depName}, which is installed but not enabled.`
          : `${r.name} needs ${dep}, which isn't installed.`,
      });
    }
  }
  return { gameId: 'project-zomboid', current: order, proposed: order, moved: 0, issues };
}
