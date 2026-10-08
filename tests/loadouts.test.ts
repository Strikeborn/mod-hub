import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyLoadout, applyLoadoutToPzSave, exportLoadoutCode, getLoadouts, importLoadoutCode, saveCurrentLoadout } from '../electron/loadouts';
import { parseModFolder } from '../electron/modMetadata';
import { RIMWORLD_CONFIG, mod, modsConfig, rimworldMod, tempHome, write } from './helpers';

let env: ReturnType<typeof tempHome>;
beforeEach(() => {
  env = tempHome();
});
afterEach(() => env.restore());

const PZ_LIST = (ids: string[]) => `VERSION = 1,\r\n\r\nmods\r\n{\r\n${ids.map((i) => `\tmod = ${i},`).join('\r\n')}\r\n}\r\n\r\nmaps\r\n{\r\n}\r\n`;

describe('RimWorld loadouts', () => {
  it('saves the current list as .rml and applies a list in a valid order', () => {
    const root = path.join(env.home, 'workshop');
    const catalog = [
      rimworldMod(root, 'brrainz.harmony', { before: ['ludeon.rimworld'] }),
      rimworldMod(root, 'some.library', { deps: ['brrainz.harmony'], after: ['ludeon.rimworld'] }),
    ].map((dir) => mod({ id: path.basename(dir), gameId: 'rimworld', localPath: dir, modIds: parseModFolder(dir).modIds }));
    const cfg = write(RIMWORLD_CONFIG(env.home), modsConfig(['brrainz.harmony', 'ludeon.rimworld']));

    expect(saveCurrentLoadout('rimworld', 'Base', catalog).ok).toBe(true);
    // A hand-made list in the wrong order:
    expect(saveCurrentLoadout('rimworld', 'Messy', catalog, undefined, ['some.library', 'ludeon.rimworld', 'brrainz.harmony']).ok).toBe(true);
    const lists = getLoadouts('rimworld', catalog).loadouts;
    expect(lists.map((l) => l.name).sort()).toEqual(['Base', 'Messy']);
    expect(lists.find((l) => l.name === 'Base')!.isCurrent).toBe(true);

    const r = applyLoadout('rimworld', lists.find((l) => l.name === 'Messy')!.id, catalog);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Auto-sorted/);
    const active = [...fs.readFileSync(cfg, 'utf8').matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1]).slice(0, 3);
    expect(active).toEqual(['brrainz.harmony', 'ludeon.rimworld', 'some.library']);
  });
});

describe('Project Zomboid loadouts', () => {
  it('applies a saved list to one save only, keeping its other sections', () => {
    write(path.join(env.home, 'Zomboid', 'mods', 'default.txt'), PZ_LIST(['damnlib', 'carA']));
    write(path.join(env.home, 'Zomboid', 'Lua', 'saved_modlists.txt'), 'VERSION=2\nCars:damnlib;carA;carB\n');
    const saveFile = write(path.join(env.home, 'Zomboid', 'Saves', 'Survivor', '2024-01-01', 'mods.txt'), PZ_LIST(['old']));
    const lists = getLoadouts('project-zomboid', []).loadouts;
    const cars = lists.find((l) => l.name === 'Cars')!;
    const save = lists.find((l) => l.kind === 'save')!;
    expect(applyLoadoutToPzSave(cars.id, save.id, []).ok).toBe(true);
    const text = fs.readFileSync(saveFile, 'utf8');
    expect(text).toContain('\tmod = carB,');
    expect(text).not.toContain('old');
    expect(text).toContain('maps\r\n{\r\n}');
    // The main list is untouched.
    expect(fs.readFileSync(path.join(env.home, 'Zomboid', 'mods', 'default.txt'), 'utf8')).not.toContain('carB');
  });

  it('round-trips a share code into a new saved list', () => {
    write(path.join(env.home, 'Zomboid', 'Lua', 'saved_modlists.txt'), 'VERSION=2\nCars:damnlib;carA\n');
    write(path.join(env.home, 'Zomboid', 'mods', 'default.txt'), PZ_LIST(['damnlib']));
    const cars = getLoadouts('project-zomboid', []).loadouts.find((l) => l.name === 'Cars')!;
    const exp = exportLoadoutCode('project-zomboid', cars.id, []);
    expect(exp.code).toMatch(/^MODHUB1:/);
    const imp = importLoadoutCode(exp.code!, []);
    expect(imp).toMatchObject({ ok: true, gameId: 'project-zomboid' });
    const again = getLoadouts('project-zomboid', []).loadouts.find((l) => l.name === 'Cars (imported)')!;
    expect(again.ids).toEqual(['damnlib', 'carA']);
    expect(importLoadoutCode('not a code', []).ok).toBe(false);
  });
});
