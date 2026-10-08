import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModRecord } from '../shared/types';
import { checkModrinthUpdates, findPrismInstances, jarMetadata, prismLoadOrder, scanPrismMods, setPrismModsEnabled } from '../electron/prism';
import { tempHome, write } from './helpers';

let env: ReturnType<typeof tempHome>;
beforeEach(() => {
  env = tempHome();
});
afterEach(() => {
  vi.unstubAllGlobals();
  env.restore();
});

/** Minimal zip (stored entries) — enough for a jar with metadata. */
function makeJar(file: string, files: Record<string, string>): string {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const n = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([...locals, cd, end]));
  return file;
}

function instance() {
  const inst = path.join(process.env.APPDATA!, 'PrismLauncher', 'instances', 'Fab');
  write(path.join(inst, 'instance.cfg'), 'InstanceType=OneSix\nname=Fabric Fun\n');
  write(
    path.join(inst, 'mmc-pack.json'),
    JSON.stringify({ components: [{ uid: 'net.minecraft', version: '1.21.1' }, { uid: 'net.fabricmc.fabric-loader', version: '0.16.0' }] }),
  );
  const mods = path.join(inst, 'minecraft', 'mods');
  makeJar(path.join(mods, 'sodium.jar'), {
    'fabric.mod.json': JSON.stringify({ id: 'sodium', name: 'Sodium', version: '0.6.0', authors: ['jellysquid'] }),
  });
  makeJar(path.join(mods, 'jei.jar.disabled'), {
    'META-INF/mods.toml': 'modLoader="javafml"\n[[mods]]\nmodId="jei"\ndisplayName="Just Enough Items"\nversion="19.0.0"\nauthors="mezz"\n',
  });
  write(
    path.join(mods, '.index', 'sodium.pw.toml'),
    'name = "Sodium"\nfilename = "sodium.jar"\n\n[download]\nhash-format = "sha1"\nhash = "abc123"\n\n[update.modrinth]\nmod-id = "AANobbMI"\nversion = "v1"\n',
  );
  return { inst, mods };
}

function scan(): ModRecord[] {
  const out: ModRecord[] = [];
  scanPrismMods((m) => out.push(m));
  return out;
}

describe('Prism Launcher', () => {
  it('finds instances with loader and Minecraft version', () => {
    instance();
    expect(findPrismInstances()).toMatchObject([{ id: 'Fab', name: 'Fabric Fun', loader: 'fabric', mcVersion: '1.21.1' }]);
  });

  it('reads Fabric and Forge jar metadata', () => {
    const { mods } = instance();
    expect(jarMetadata(path.join(mods, 'sodium.jar'))).toMatchObject({ modId: 'sodium', name: 'Sodium', version: '0.6.0', authors: 'jellysquid' });
    expect(jarMetadata(path.join(mods, 'jei.jar.disabled'))).toMatchObject({ modId: 'jei', name: 'Just Enough Items', version: '19.0.0' });
  });

  it('lists mods with their on/off state and Modrinth ids, and switches them like Prism', () => {
    const { mods } = instance();
    const rows = scan();
    const sodium = rows.find((m) => m.title === 'Sodium')!;
    const jei = rows.find((m) => m.title === 'Just Enough Items')!;
    expect(sodium.prism).toMatchObject({ instance: 'Fab', enabled: true, modrinthId: 'AANobbMI', sha1: 'abc123' });
    expect(jei.prism).toMatchObject({ file: 'jei.jar', enabled: false });

    const lo = prismLoadOrder(rows)!;
    expect(lo.mods[sodium.id].enabled).toBe(true);
    expect(lo.mods[jei.id].enabled).toBe(false);

    expect(setPrismModsEnabled([jei], true, false).changed).toBe(1);
    expect(fs.existsSync(path.join(mods, 'jei.jar'))).toBe(true);
    expect(setPrismModsEnabled([sodium], false, false).changed).toBe(1);
    expect(fs.existsSync(path.join(mods, 'sodium.jar.disabled'))).toBe(true);
    expect(setPrismModsEnabled([sodium], true, true).ok).toBe(false);
  });

  it('marks Modrinth updates by file hash', async () => {
    instance();
    const rows = scan();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ abc123: { version_number: '0.6.1', project_id: 'AANobbMI', date_published: '2026-10-01', files: [{ hashes: { sha1: 'def456' } }] } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await checkModrinthUpdates(rows)).toBe(1);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({ algorithm: 'sha1', loaders: ['fabric'], game_versions: ['1.21.1'] });
    expect(rows.find((m) => m.title === 'Sodium')!.prism!.latestVersion).toBe('0.6.1');
  });
});
