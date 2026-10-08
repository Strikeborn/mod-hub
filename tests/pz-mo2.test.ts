import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planPzOrder } from '../electron/pzDeps';
import { readLoadOrders } from '../electron/loadOrder';
import { setModsEnabled } from '../electron/loadOrderWrite';
import { readMo2Modlist, readMo2Plugins, type Mo2Instance } from '../electron/mo2';
import { parseModFolder } from '../electron/modMetadata';
import { mod, tempHome, write } from './helpers';

let env: ReturnType<typeof tempHome>;
beforeEach(() => {
  env = tempHome();
});
afterEach(() => env.restore());

function pzItem(root: string, workshopId: string, subMods: { id: string; require?: string }[]): string {
  const dir = path.join(root, workshopId);
  for (const s of subMods) {
    write(path.join(dir, 'mods', s.id, 'mod.info'), `name=${s.id}\nid=${s.id}\n${s.require ? `require=${s.require}\n` : ''}`);
  }
  return dir;
}

describe('Project Zomboid', () => {
  it('collects every sub-mod id of a Workshop item', () => {
    const dir = pzItem(env.home, '111', [{ id: 'ManySpawns' }, { id: 'ManySpawnsAll' }]);
    expect(parseModFolder(dir).modIds?.sort()).toEqual(['ManySpawns', 'ManySpawnsAll']);
  });

  it('flags required mods that are off or missing (incl. B42 "\\id" and sloppy "require=require=")', () => {
    const lib = pzItem(env.home, '1', [{ id: 'damnlib' }]);
    const car = pzItem(env.home, '2', [{ id: '63Type2Van', require: 'damnlib' }]);
    const b42 = pzItem(env.home, '3', [{ id: 'B42Thing', require: '\\damnlib,\\missinglib' }]);
    const sloppy = pzItem(env.home, '4', [{ id: 'Frigate', require: 'require=damnlib' }]);
    const mods = [lib, car, b42, sloppy].map((d, i) => mod({ id: `pz${i}`, gameId: 'project-zomboid', localPath: d }));
    const plan = planPzOrder(['63Type2Van', 'B42Thing', 'Frigate'], mods);
    const off = plan.issues.filter((i) => i.kind === 'dependency-off');
    const missing = plan.issues.filter((i) => i.kind === 'dependency-missing');
    expect(off.map((i) => i.otherId)).toEqual(['damnlib', 'damnlib', 'damnlib']);
    expect(missing.map((i) => i.otherId)).toEqual(['missinglib']);
    expect(planPzOrder(['damnlib', '63Type2Van', 'Frigate'], mods).issues).toEqual([]);
  });

  it('enables the main sub-mod and disables all of them in mods/default.txt', () => {
    const file = write(path.join(env.home, 'Zomboid', 'mods', 'default.txt'), 'VERSION = 1,\r\n\r\nmods\r\n{\r\n\tmod = damnlib,\r\n}\r\n\r\nmaps\r\n{\r\n}\r\n');
    const dir = pzItem(env.home, '9', [{ id: 'ManySpawns' }, { id: 'ManySpawnsAll' }]);
    const row = mod({ id: 'many', gameId: 'project-zomboid', localPath: dir, modIds: parseModFolder(dir).modIds });
    setModsEnabled('project-zomboid', [row], true);
    let text = fs.readFileSync(file, 'utf8');
    expect(text).toMatch(/mod = damnlib,\r\n\tmod = ManySpawns/);
    expect(text).toContain('maps\r\n{\r\n}');
    expect(readLoadOrders([row])['project-zomboid'].mods.many).toEqual({ enabled: true, position: 2 });
    setModsEnabled('project-zomboid', [row], false);
    text = fs.readFileSync(file, 'utf8');
    expect(text).not.toContain('ManySpawns');
  });
});

describe('Mod Organizer 2 profiles', () => {
  it('reads modlist.txt (priority, enabled, unmanaged) and plugins.txt', () => {
    const root = path.join(env.home, 'MO2');
    write(
      path.join(root, 'profiles', 'Testing', 'modlist.txt'),
      '# generated\n+SMIM\n+USSEP\n-Disabled Mod\n*DLC: Dawnguard\n*Unmanaged: FNIS\n',
    );
    write(path.join(root, 'profiles', 'Testing', 'plugins.txt'), '# generated\n*ussep.esp\n*SkyUI_SE.esp\nFNIS.esp\n');
    const inst = { root, profiles: ['Testing'] } as Mo2Instance;
    const list = readMo2Modlist(inst, 'Testing');
    expect(list.map((e) => [e.name, e.enabled, e.unmanaged])).toEqual([
      ['SMIM', true, false],
      ['USSEP', true, false],
      ['Disabled Mod', false, false],
      ['DLC: Dawnguard', false, true],
      ['Unmanaged: FNIS', false, true],
    ]);
    expect(readMo2Plugins(inst, 'Testing').filter((p) => p.active).map((p) => p.name)).toEqual(['ussep.esp', 'SkyUI_SE.esp']);
  });
});
