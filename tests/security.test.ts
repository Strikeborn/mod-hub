import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { riskyFiles, summarize } from '../electron/modSecurity';
import type { ModSecurityReport } from '../shared/types';
import { tempHome, write } from './helpers';

let env: ReturnType<typeof tempHome>;
beforeEach(() => {
  env = tempHome();
});
afterEach(() => env.restore());

const base = (over: Partial<ModSecurityReport>): ModSecurityReport => ({
  modId: 'm',
  checkedAt: '2026-10-08T00:00:00.000Z',
  defender: { status: 'clean' },
  executables: [],
  executableCount: 0,
  signature: '0',
  status: 'unchecked',
  ...over,
});

describe('executable inventory', () => {
  it('lists programs, DLL plugins and Windows scripts but not data files', () => {
    const root = path.join(env.home, 'mod');
    write(path.join(root, 'SKSE', 'Plugins', 'cbp.dll'), 'x');
    write(path.join(root, 'tools', 'setup.EXE'), 'x');
    write(path.join(root, 'install.ps1'), 'x');
    write(path.join(root, 'meshes', 'thing.nif'), 'x');
    write(path.join(root, 'readme.txt'), 'x');
    const { files, sig } = riskyFiles(root);
    expect(files.map((f) => f.rel.replace(/\\/g, '/')).sort()).toEqual(['SKSE/Plugins/cbp.dll', 'install.ps1', 'tools/setup.EXE']);
    // The signature changes when an executable changes, so stale results are re-checked.
    fs.writeFileSync(path.join(root, 'install.ps1'), 'changed content');
    expect(riskyFiles(root).sig).not.toBe(sig);
  });
});

describe('verdicts', () => {
  const vt = (malicious: number) => ({ status: malicious ? ('flagged' as const) : ('clean' as const), malicious, engines: 70 });
  it('Defender threat wins', () => {
    expect(summarize(base({ defender: { status: 'threat' } }))).toBe('threat');
  });
  it('1–2 engines = review, 3+ = flagged', () => {
    expect(summarize(base({ executables: [{ rel: 'a.dll', size: 1, sha256: 'x', virusTotal: vt(2) }] }))).toBe('review');
    expect(summarize(base({ executables: [{ rel: 'a.dll', size: 1, sha256: 'x', virusTotal: vt(5) }] }))).toBe('flagged');
  });
  it('clean when Defender is clean and nothing is flagged', () => {
    expect(summarize(base({ archive: { path: 'a.7z', sha256: 'x', virusTotal: vt(0) } }))).toBe('clean');
    expect(summarize(undefined)).toBe('unchecked');
  });
});
