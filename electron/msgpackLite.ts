/** Minimal MessagePack decoder (maps/arrays/str/bin/int/float/bool/nil) for Vortex manifests. */
export function decodeMsgpack(buf: Buffer): unknown {
  let pos = 0;

  function u8(): number {
    return buf[pos++];
  }
  function str(len: number): string {
    const s = buf.toString('utf8', pos, pos + len);
    pos += len;
    return s;
  }
  function bin(len: number): Buffer {
    const b = buf.subarray(pos, pos + len);
    pos += len;
    return b;
  }
  function arr(len: number): unknown[] {
    const out = new Array(len);
    for (let i = 0; i < len; i++) out[i] = value();
    return out;
  }
  function map(len: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < len; i++) {
      const k = value();
      out[typeof k === 'string' ? k : String(k)] = value();
    }
    return out;
  }

  function value(): unknown {
    const b = u8();

    if (b <= 0x7f) return b;
    if (b >= 0xe0) return b - 0x100;
    if (b >= 0x80 && b <= 0x8f) return map(b & 0x0f);
    if (b >= 0x90 && b <= 0x9f) return arr(b & 0x0f);
    if (b >= 0xa0 && b <= 0xbf) return str(b & 0x1f);

    switch (b) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xc4: {
        const len = buf.readUInt8(pos);
        pos += 1;
        return bin(len);
      }
      case 0xc5: {
        const len = buf.readUInt16BE(pos);
        pos += 2;
        return bin(len);
      }
      case 0xc6: {
        const len = buf.readUInt32BE(pos);
        pos += 4;
        return bin(len);
      }
      case 0xca: {
        const v = buf.readFloatBE(pos);
        pos += 4;
        return v;
      }
      case 0xcb: {
        const v = buf.readDoubleBE(pos);
        pos += 8;
        return v;
      }
      case 0xcc: {
        const v = buf.readUInt8(pos);
        pos += 1;
        return v;
      }
      case 0xcd: {
        const v = buf.readUInt16BE(pos);
        pos += 2;
        return v;
      }
      case 0xce: {
        const v = buf.readUInt32BE(pos);
        pos += 4;
        return v;
      }
      case 0xcf: {
        const v = Number(buf.readBigUInt64BE(pos));
        pos += 8;
        return v;
      }
      case 0xd0: {
        const v = buf.readInt8(pos);
        pos += 1;
        return v;
      }
      case 0xd1: {
        const v = buf.readInt16BE(pos);
        pos += 2;
        return v;
      }
      case 0xd2: {
        const v = buf.readInt32BE(pos);
        pos += 4;
        return v;
      }
      case 0xd3: {
        const v = Number(buf.readBigInt64BE(pos));
        pos += 8;
        return v;
      }
      case 0xd9: {
        const len = buf.readUInt8(pos);
        pos += 1;
        return str(len);
      }
      case 0xda: {
        const len = buf.readUInt16BE(pos);
        pos += 2;
        return str(len);
      }
      case 0xdb: {
        const len = buf.readUInt32BE(pos);
        pos += 4;
        return str(len);
      }
      case 0xdc: {
        const len = buf.readUInt16BE(pos);
        pos += 2;
        return arr(len);
      }
      case 0xdd: {
        const len = buf.readUInt32BE(pos);
        pos += 4;
        return arr(len);
      }
      case 0xde: {
        const len = buf.readUInt16BE(pos);
        pos += 2;
        return map(len);
      }
      case 0xdf: {
        const len = buf.readUInt32BE(pos);
        pos += 4;
        return map(len);
      }
      default:
        throw new Error(`Unsupported msgpack byte 0x${b.toString(16)} at ${pos - 1}`);
    }
  }

  return value();
}
