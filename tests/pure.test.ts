import { describe, expect, it } from 'vitest';
import { titleMatch } from '../electron/titleMatch';
import { cmpVersion } from '../electron/modChanges';
import { cleanVersion, comparable } from '../electron/nexusUpdates';
import { parseR2ModsYml } from '../electron/thunderstore';

describe('re-upload title matching', () => {
  it('matches the same title regardless of ! prefixes and case', () => {
    expect(titleMatch("!maggy's toy box", "!Maggy's Toy Box")).toBe('exact');
  });
  it('accepts a re-upload that adds to the title', () => {
    expect(titleMatch("!maggy's toy box", "!maggy's toy box+ REBORN")).toBe('close');
  });
  it('rejects a shorter mod that only appears inside the original title', () => {
    expect(titleMatch('VFE Undead Survivor Patch', 'Undead Survivor')).toBeNull();
  });
  it('rejects unrelated titles', () => {
    expect(titleMatch('Hospitality', 'Better Vents')).toBeNull();
  });
});

describe('version comparison', () => {
  it('orders numeric versions', () => {
    expect(cmpVersion('3.0.0', '2.0.3')).toBeGreaterThan(0);
    expect(cmpVersion('2.1.0.10', '2.1.0')).toBeGreaterThan(0);
    expect(cmpVersion('1.0', '1.0.0')).toBe(0);
  });
  it('only treats plain version numbers as comparable', () => {
    expect(comparable(cleanVersion('v1.27.3'))).toBe(true);
    expect(comparable(cleanVersion('2.02a'))).toBe(true);
    expect(comparable(cleanVersion('v32-20260621-hotfix1'))).toBe(false);
  });
});

describe('r2modman mods.yml', () => {
  it('reads names, versions and the enabled flag', () => {
    const mods = parseR2ModsYml(`- manifestVersion: 1
  name: BepInEx-BepInExPack
  authorName: BepInEx
  displayName: BepInExPack
  description: "BepInEx pack"
  versionNumber:
    major: 5
    minor: 4
    patch: 2100
  enabled: true
- manifestVersion: 1
  name: notnotnotswipez-MoreCompany
  authorName: notnotnotswipez
  versionNumber:
    major: 1
    minor: 9
    patch: 1
  enabled: false
`);
    expect(mods).toHaveLength(2);
    expect(mods[0]).toMatchObject({ name: 'BepInEx-BepInExPack', version: '5.4.2100', enabled: true, description: 'BepInEx pack' });
    expect(mods[1]).toMatchObject({ name: 'notnotnotswipez-MoreCompany', version: '1.9.1', enabled: false });
  });
});
