import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lz4BlockDecode, parseMetaLsx, readPakInfo } from '../electron/bg3Pak';
import { planBg3Order } from '../electron/bg3Checks';
import { tempHome, write } from './helpers';

let env: ReturnType<typeof tempHome>;
beforeEach(() => {
  env = tempHome();
});
afterEach(() => env.restore());

/** LZ4 block holding only literals (valid input for any LZ4 decoder). */
function lz4Literals(data: Buffer): Buffer {
  const len = data.length;
  const head: number[] = [Math.min(len, 15) << 4];
  if (len >= 15) {
    let rest = len - 15;
    while (rest >= 255) {
      head.push(255);
      rest -= 255;
    }
    head.push(rest);
  }
  return Buffer.concat([Buffer.from(head), data]);
}

/** A version-18 .pak with uncompressed files. */
function makePak(file: string, files: Record<string, string>): string {
  const datas = Object.entries(files).map(([name, text]) => ({ name, data: Buffer.from(text, 'utf8') }));
  let offset = 40;
  const entries = datas.map((d) => {
    const e = Buffer.alloc(272);
    e.write(d.name, 0, 'utf8');
    e.writeUInt32LE(offset, 256);
    e.writeUInt32LE(d.data.length, 264);
    e.writeUInt32LE(d.data.length, 268);
    offset += d.data.length;
    return e;
  });
  const packed = lz4Literals(Buffer.concat(entries));
  const list = Buffer.concat([Buffer.alloc(8), packed]);
  list.writeUInt32LE(entries.length, 0);
  list.writeUInt32LE(packed.length, 4);
  const head = Buffer.alloc(40);
  head.write('LSPK', 0, 'latin1');
  head.writeUInt32LE(18, 4);
  head.writeBigUInt64LE(BigInt(offset), 8);
  head.writeUInt32LE(list.length, 16);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([head, ...datas.map((d) => d.data), list]));
  return file;
}

const meta = (name: string, uuid: string, deps: { name: string; uuid: string }[] = []) => `<?xml version="1.0" encoding="UTF-8"?>
<save><region id="Config"><node id="root"><children>
<node id="Dependencies"><children>
${deps.map((d) => `<node id="ModuleShortDesc"><attribute id="Folder" type="LSString" value="${d.name}"/><attribute id="Name" type="LSString" value="${d.name}"/><attribute id="UUID" type="FixedString" value="${d.uuid}"/></node>`).join('\n')}
</children></node>
<node id="ModuleInfo"><attribute id="Folder" type="LSString" value="${name}"/><attribute id="Name" type="LSString" value="${name}"/><attribute id="UUID" type="FixedString" value="${uuid}"/><attribute id="Version64" type="int64" value="36028797018963968"/></node>
</children></node></region></save>`;

const modsettings = (entries: { name: string; uuid: string }[]) => `<?xml version="1.0" encoding="UTF-8"?>
<save><region id="ModuleSettings"><node id="root"><children><node id="Mods"><children>
<node id="ModuleShortDesc"><attribute id="Folder" type="LSString" value="GustavDev"/><attribute id="Name" type="LSString" value="GustavDev"/><attribute id="UUID" type="guid" value="28ac9ce2-2aba-8cda-b3b5-6e922f71b6b8"/></node>
${entries.map((e) => `<node id="ModuleShortDesc"><attribute id="Folder" type="LSString" value="${e.name}"/><attribute id="Name" type="LSString" value="${e.name}"/><attribute id="UUID" type="guid" value="${e.uuid}"/></node>`).join('\n')}
</children></node></children></node></region></save>`;

describe('LZ4 block decoding', () => {
  it('expands back-references', () => {
    // "abc" literals, then a 6-byte match at offset 3 → "abcabcabc"
    expect(lz4BlockDecode(Buffer.from([0x32, 0x61, 0x62, 0x63, 0x03, 0x00]), 9).toString()).toBe('abcabcabc');
  });
});

describe('BG3 .pak metadata', () => {
  it('reads meta.lsx and spots Script Extender scripts', () => {
    const pak = makePak(path.join(env.home, 'A.pak'), {
      'Mods/A/meta.lsx': meta('A', 'aaaa-1', [{ name: 'GustavDev', uuid: 'base' }, { name: 'B', uuid: 'bbbb-2' }]),
      'Mods/A/ScriptExtender/Config.json': '{}',
    });
    const info = readPakInfo(pak);
    expect(info.error).toBeUndefined();
    expect(info.usesScriptExtender).toBe(true);
    expect(info.modules).toHaveLength(1);
    expect(info.modules[0]).toMatchObject({ uuid: 'aaaa-1', folder: 'A', name: 'A' });
    expect(info.modules[0].dependencies.map((d) => d.uuid)).toEqual(['base', 'bbbb-2']);
    expect(parseMetaLsx('<save/>')).toBeNull();
  });
});

describe('BG3 checks', () => {
  it('flags late, inactive and missing dependencies and stale entries, and suggests an order', () => {
    const root = path.join(process.env.LOCALAPPDATA!, 'Larian Studios', "Baldur's Gate 3");
    makePak(path.join(root, 'Mods', 'A.pak'), { 'Mods/A/meta.lsx': meta('A', 'a', [{ name: 'B', uuid: 'b' }, { name: 'C', uuid: 'c' }, { name: 'Gone', uuid: 'z' }]) });
    makePak(path.join(root, 'Mods', 'B.pak'), { 'Mods/B/meta.lsx': meta('B', 'b') });
    makePak(path.join(root, 'Mods', 'C.pak'), { 'Mods/C/meta.lsx': meta('C', 'c') });
    write(
      path.join(root, 'PlayerProfiles', 'Public', 'modsettings.lsx'),
      modsettings([
        { name: 'A', uuid: 'a' },
        { name: 'B', uuid: 'b' },
        { name: 'Stale', uuid: 's' },
      ]),
    );
    const plan = planBg3Order();
    const kinds = plan.issues.map((i) => `${i.kind}:${i.otherId}`);
    expect(kinds).toEqual(expect.arrayContaining(['order:b', 'dependency-off:c', 'dependency-missing:z', 'dependency-missing:s']));
    expect(plan.current).toEqual(['A', 'B', 'Stale']);
    expect(plan.proposed).toEqual(['B', 'A', 'Stale']);
  });
});
