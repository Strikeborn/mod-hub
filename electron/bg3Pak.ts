import fs from 'node:fs';
import zlib from 'node:zlib';

/**
 * Baldur's Gate 3 .pak (LSPK v18) reader: lists the files and extracts the mod's meta.lsx, without LSLib.
 * Header: "LSPK", version u32, file list offset u64, file list size u32, flags u8, priority u8, md5[16], parts u16.
 * File list: count u32, compressed size u32, then LZ4 block-compressed entries of 272 bytes
 * (name[256], offset u32 + u16, archive part u8, flags u8, size on disk u32, uncompressed size u32).
 */

export type PakEntry = { name: string; offset: number; sizeOnDisk: number; size: number; method: number; part: number };

export type Bg3ModuleInfo = {
  uuid: string;
  folder: string;
  name: string;
  version64?: string;
  author?: string;
  description?: string;
  dependencies: { uuid: string; name?: string; folder?: string }[];
};

export type Bg3PakInfo = { file: string; modules: Bg3ModuleInfo[]; usesScriptExtender: boolean; error?: string };

/** LZ4 block format decoder (raw blocks; sizes known from the pak). */
export function lz4BlockDecode(src: Buffer, outSize: number): Buffer {
  const out = Buffer.alloc(outSize);
  let i = 0;
  let o = 0;
  while (i < src.length) {
    const token = src[i++];
    let lit = token >> 4;
    if (lit === 15) {
      let b: number;
      do {
        b = src[i++];
        lit += b;
      } while (b === 255);
    }
    src.copy(out, o, i, i + lit);
    i += lit;
    o += lit;
    if (i >= src.length) break;
    const off = src[i] | (src[i + 1] << 8);
    i += 2;
    let len = token & 15;
    if (len === 15) {
      let b: number;
      do {
        b = src[i++];
        len += b;
      } while (b === 255);
    }
    len += 4;
    if (off === 0 || off > o) throw new Error('bad LZ4 data');
    for (let k = 0; k < len; k++, o++) out[o] = out[o - off];
  }
  return o === outSize ? out : out.subarray(0, o);
}

/** LZ4 frame format (magic 0x184D2204): concatenated blocks. */
function lz4FrameDecode(src: Buffer, outSize: number): Buffer {
  const flg = src[4];
  let i = 4 + 2 + (flg & 0x08 ? 8 : 0) + (flg & 0x01 ? 4 : 0) + 1;
  const parts: Buffer[] = [];
  while (i + 4 <= src.length) {
    const word = src.readUInt32LE(i);
    i += 4;
    if (word === 0) break;
    const size = word & 0x7fffffff;
    const block = src.subarray(i, i + size);
    parts.push(word & 0x80000000 ? Buffer.from(block) : lz4BlockDecode(block, 4 * 1024 * 1024));
    i += size + (flg & 0x10 ? 4 : 0);
  }
  return Buffer.concat(parts).subarray(0, outSize);
}

function decompress(data: Buffer, method: number, size: number): Buffer {
  if (method === 0) return data;
  if (method === 1) return zlib.inflateSync(data);
  if (method === 2) return data.readUInt32LE(0) === 0x184d2204 ? lz4FrameDecode(data, size) : lz4BlockDecode(data, size);
  const zstd = (zlib as unknown as { zstdDecompressSync?: (b: Buffer) => Buffer }).zstdDecompressSync;
  if (method === 3 && zstd) return zstd(data);
  throw new Error(`unsupported compression ${method}`);
}

export function readPakEntries(file: string): PakEntry[] {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(40);
    fs.readSync(fd, head, 0, 40, 0);
    if (head.toString('latin1', 0, 4) !== 'LSPK') throw new Error('not an LSPK package');
    const version = head.readUInt32LE(4);
    if (version !== 18) throw new Error(`pak version ${version} not supported`);
    const listOffset = Number(head.readBigUInt64LE(8));
    const listSize = head.readUInt32LE(16);
    const list = Buffer.alloc(listSize);
    fs.readSync(fd, list, 0, listSize, listOffset);
    const count = list.readUInt32LE(0);
    const compressed = list.readUInt32LE(4);
    const ENTRY = 272;
    const raw = lz4BlockDecode(list.subarray(8, 8 + compressed), count * ENTRY);
    const out: PakEntry[] = [];
    for (let n = 0; n < count; n++) {
      const e = raw.subarray(n * ENTRY, (n + 1) * ENTRY);
      const name = e.toString('utf8', 0, 256).replace(/\0.*$/s, '');
      const offset = e.readUInt32LE(256) + e.readUInt16LE(260) * 2 ** 32;
      out.push({ name, offset, part: e[262], method: e[263] & 0x0f, sizeOnDisk: e.readUInt32LE(264), size: e.readUInt32LE(268) });
    }
    return out;
  } finally {
    fs.closeSync(fd);
  }
}

export function readPakFile(file: string, entry: PakEntry): Buffer {
  if (entry.part !== 0) throw new Error('multi-part paks are not supported');
  const fd = fs.openSync(file, 'r');
  try {
    const data = Buffer.alloc(entry.sizeOnDisk);
    fs.readSync(fd, data, 0, entry.sizeOnDisk, entry.offset);
    return decompress(data, entry.method, entry.size);
  } finally {
    fs.closeSync(fd);
  }
}

const attr = (block: string, id: string) => new RegExp(`<attribute id="${id}"[^>]*value="([^"]*)"`, 'i').exec(block)?.[1];

/** meta.lsx → module info (UUID, folder, version, dependencies). */
export function parseMetaLsx(xml: string): Bg3ModuleInfo | null {
  const info = /<node id="ModuleInfo">([\s\S]*?)(?:<children>|<\/node>)/i.exec(xml)?.[1];
  if (!info) return null;
  const uuid = attr(info, 'UUID');
  if (!uuid) return null;
  const depsBlock = /<node id="Dependencies">([\s\S]*?)<\/children>\s*<\/node>/i.exec(xml)?.[1] ?? '';
  const dependencies = [...depsBlock.matchAll(/<node id="ModuleShortDesc">([\s\S]*?)<\/node>/gi)]
    .map((m) => ({ uuid: attr(m[1], 'UUID') ?? '', name: attr(m[1], 'Name'), folder: attr(m[1], 'Folder') }))
    .filter((d) => d.uuid);
  return {
    uuid,
    folder: attr(info, 'Folder') ?? '',
    name: attr(info, 'Name') ?? '',
    version64: attr(info, 'Version64') ?? attr(info, 'Version'),
    author: attr(info, 'Author'),
    description: attr(info, 'Description'),
    dependencies,
  };
}

const cache = new Map<string, { key: string; info: Bg3PakInfo }>();

/** Module(s) a .pak defines and whether it ships Script Extender scripts. Cached by size + mtime. */
export function readPakInfo(file: string): Bg3PakInfo {
  let key = '';
  try {
    const st = fs.statSync(file);
    key = `${st.size}|${st.mtimeMs}`;
    const hit = cache.get(file);
    if (hit?.key === key) return hit.info;
  } catch (e) {
    return { file, modules: [], usesScriptExtender: false, error: (e as Error).message };
  }
  let info: Bg3PakInfo;
  try {
    const entries = readPakEntries(file);
    const modules: Bg3ModuleInfo[] = [];
    for (const e of entries.filter((x) => /^Mods\/[^/]+\/meta\.lsx$/i.test(x.name))) {
      const m = parseMetaLsx(readPakFile(file, e).toString('utf8'));
      if (m) modules.push(m);
    }
    const usesScriptExtender = entries.some((x) => /^Mods\/[^/]+\/ScriptExtender\//i.test(x.name));
    info = { file, modules, usesScriptExtender };
  } catch (e) {
    info = { file, modules: [], usesScriptExtender: false, error: (e as Error).message };
  }
  cache.set(file, { key, info });
  return info;
}
