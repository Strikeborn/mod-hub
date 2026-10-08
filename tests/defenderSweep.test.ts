import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDefenderThreats } from '../electron/defenderSweep';
import { isaacLuaRisks } from '../electron/luaGuard';

describe('parseDefenderThreats', () => {
  it('reads threat names and files from MpCmdRun output', () => {
    const out = [
      'Scan starting...',
      'Scan finished.',
      'Scanning C:\\mods found 2 threats.',
      '',
      '<===========================LIST OF DETECTED THREATS==========================>',
      '----------------------------- Threat information ------------------------------',
      'Threat                  : Trojan:Win32/Example',
      'Resources               : 2 total',
      '    file                : C:\\mods\\bad\\loader.dll',
      '    containerfile       : C:\\mods\\bad.zip',
      '    file                : C:\\mods\\bad.zip->loader.exe',
      '-------------------------------------------------------------------------------',
      'Threat                  : PUA:Win32/Other',
      'Resources               : 1 total',
      '    file                : D:\\x\\y.exe',
    ].join('\r\n');
    expect(parseDefenderThreats(out)).toEqual([
      { threat: 'Trojan:Win32/Example', file: 'C:\\mods\\bad\\loader.dll' },
      { threat: 'Trojan:Win32/Example', file: 'C:\\mods\\bad.zip' },
      { threat: 'PUA:Win32/Other', file: 'D:\\x\\y.exe' },
    ]);
  });

  it('returns nothing for a clean scan', () => {
    expect(parseDefenderThreats('Scan starting...\nScan finished.\nScanning C:\\mods found no threats.')).toEqual([]);
  });
});

describe('isaacLuaRisks', () => {
  it('flags sandbox-breaking Lua calls but ignores comments', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-lua-'));
    fs.writeFileSync(path.join(dir, 'main.lua'), '-- io.open is not used here\nlocal f = io.open("x", "w")\n--[[ os.execute("y") ]]\n');
    fs.writeFileSync(path.join(dir, 'clean.lua'), 'local mod = RegisterMod("x", 1)\n');
    expect(isaacLuaRisks(dir)).toEqual(['io.open (reads/writes files)']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
