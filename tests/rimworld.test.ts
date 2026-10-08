import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planRimworldOrder } from '../electron/rimworldSort';
import { readLoadOrders } from '../electron/loadOrder';
import { setLoadOrder, setModsEnabled } from '../electron/loadOrderWrite';
import { parseModFolder } from '../electron/modMetadata';
import { RIMWORLD_CONFIG, mod, modsConfig, rimworldMod, tempHome, write } from './helpers';

let env: ReturnType<typeof tempHome>;
let modsRoot: string;
let catalog: ReturnType<typeof mod>[];

beforeEach(() => {
  env = tempHome();
  modsRoot = path.join(env.home, 'workshop');
  const harmony = rimworldMod(modsRoot, 'brrainz.harmony', { before: ['ludeon.rimworld'] });
  const lib = rimworldMod(modsRoot, 'some.library', { deps: ['brrainz.harmony'], after: ['ludeon.rimworld'] });
  const content = rimworldMod(modsRoot, 'cool.content', { deps: ['some.library'] });
  const offDep = rimworldMod(modsRoot, 'needs.off', { deps: ['cool.extra'] });
  const extra = rimworldMod(modsRoot, 'cool.extra');
  catalog = [harmony, lib, content, offDep, extra].map((dir) =>
    mod({ id: path.basename(dir), gameId: 'rimworld', localPath: dir, modIds: parseModFolder(dir).modIds }),
  );
});
afterEach(() => env.restore());

describe('About.xml parsing', () => {
  it('reads the mod’s own packageId even when dependencies are listed first', () => {
    expect(parseModFolder(path.join(modsRoot, 'some.library')).modIds).toEqual(['some.library']);
  });
});

describe('RimWorld auto-sort', () => {
  it('keeps a valid order untouched', () => {
    const plan = planRimworldOrder(['brrainz.harmony', 'ludeon.rimworld', 'some.library', 'cool.content'], catalog);
    expect(plan.moved).toBe(0);
    expect(plan.issues).toEqual([]);
  });

  it('reports problems and fixes a scrambled order', () => {
    const plan = planRimworldOrder(['cool.content', 'some.library', 'ludeon.rimworld', 'brrainz.harmony'], catalog);
    expect(plan.issues.some((i) => i.kind === 'order')).toBe(true);
    expect(plan.proposed).toEqual(['brrainz.harmony', 'ludeon.rimworld', 'some.library', 'cool.content']);
    expect(planRimworldOrder(plan.proposed, catalog).issues).toEqual([]);
  });

  it('flags a dependency that is installed but off, and one that is missing', () => {
    const plan = planRimworldOrder(['ludeon.rimworld', 'needs.off', 'cool.content'], catalog);
    expect(plan.issues.find((i) => i.kind === 'dependency-off')?.otherId).toBe('cool.extra');
    // cool.content needs some.library (installed, off) which needs harmony
    expect(plan.issues.filter((i) => i.kind === 'dependency-off').map((i) => i.otherId)).toContain('some.library');
  });
});

describe('RimWorld mod list read/write (temp files only)', () => {
  it('reads enabled mods and positions from ModsConfig.xml', () => {
    write(RIMWORLD_CONFIG(env.home), modsConfig(['brrainz.harmony', 'ludeon.rimworld', 'some.library']));
    const lo = readLoadOrders(catalog).rimworld;
    expect(lo.enabledCount).toBe(2);
    expect(lo.mods['some.library']).toEqual({ enabled: true, position: 3 });
    expect(lo.mods['cool.content']).toEqual({ enabled: false });
    expect(lo.unmatched.map((u) => u.id)).toEqual(['ludeon.rimworld']);
  });

  it('enables/disables only the activeMods block and backs the file up', () => {
    const file = write(RIMWORLD_CONFIG(env.home), modsConfig(['brrainz.harmony', 'ludeon.rimworld']));
    const content = catalog.find((m) => m.id === 'cool.content')!;
    expect(setModsEnabled('rimworld', [content], true).changed).toBe(1);
    let text = fs.readFileSync(file, 'utf8');
    expect(text).toContain('<li>cool.content</li>');
    expect(text).toContain('<knownExpansions>');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(setModsEnabled('rimworld', [content], false).changed).toBe(1);
    text = fs.readFileSync(file, 'utf8');
    expect(text).not.toContain('cool.content');
    const backups = fs.readdirSync(path.join(process.env.APPDATA!, 'mod-hub', 'backups', 'rimworld'));
    expect(backups.length).toBe(2);
  });

  it('saves a reordered list but refuses one whose mods changed', () => {
    write(RIMWORLD_CONFIG(env.home), modsConfig(['ludeon.rimworld', 'brrainz.harmony']));
    expect(setLoadOrder('rimworld', ['brrainz.harmony', 'ludeon.rimworld']).ok).toBe(true);
    expect(readLoadOrders(catalog).rimworld.mods['brrainz.harmony'].position).toBe(1);
    expect(setLoadOrder('rimworld', ['brrainz.harmony']).ok).toBe(false);
  });
});
