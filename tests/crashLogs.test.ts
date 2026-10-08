import { describe, expect, it } from 'vitest';
import { parseCrashLog } from '../electron/crashLogs';

const SAMPLE = [
  'Skyrim SSE v1.6.1170',
  'CrashLoggerSSE v1-25-0-0',
  '',
  'Unhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x7FF6A1B2C3D4 cbp.dll+0012AB0\tmov rax, [rcx]',
  '',
  'PROBABLE CALL STACK:',
  '\t[ 0] 0x7FF6A1B2C3D4 cbp.dll+0012AB0',
  '\t[ 1] 0x7FF6A1B2C3E0 cbp.dll+0013000',
  '\t[ 2] 0x7FF6B0000000 SkyrimSE.exe+0D6DDDA',
  '\t[ 3] 0x7FFB00000000 KERNELBASE.dll+0001234',
  '\t[ 4] 0x7FF6C0000000 skee64.dll+0045600',
  '',
  'REGISTERS:',
  '\tRCX 0x1F00 (TESNPC*)',
  '\t\tName: "Lydia"',
  '\t\tFile: "Skyrim.esm"',
  '\tRDX 0x2F00 (TESObjectARMO*)',
  '\t\tFile: "SomeArmor.esp"',
  '',
  'STACK:',
  '\t[RSP+8] 0x3F00 (TESObjectARMO*)',
  '\t\tFile: "SomeArmor.esp"',
  '',
  'MODULES:',
  '\tcbp.dll 0x7FF6A1000000',
].join('\r\n');

describe('parseCrashLog', () => {
  it('names DLLs in the call stack and plugins of the crashed objects, skipping the game and Windows', () => {
    const r = parseCrashLog(SAMPLE);
    expect(r.exception).toBe('EXCEPTION_ACCESS_VIOLATION at cbp.dll+0012AB0');
    expect(r.gameVersion).toBe('1.6.1170');
    expect(r.dlls).toEqual([
      { name: 'cbp.dll', count: 2 },
      { name: 'skee64.dll', count: 1 },
    ]);
    expect(r.plugins).toEqual([{ name: 'SomeArmor.esp', count: 2 }]);
  });
});
