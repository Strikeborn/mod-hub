import fs from 'node:fs';
import path from 'node:path';

export interface ParsedModMeta {
  title?: string;
  author?: string;
  description?: string;
  version?: string;
  modIds?: string[];
  iconPath?: string;
  previewPath?: string;
}

const PREVIEW_NAMES = ['preview.png', 'Preview.png', 'icon.png', 'modicon.png', 'thumbnail.png', 'logo.png'];

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

/** Walk mod folder (shallow) for any preview image Steam/Nexus packs bury in subfolders. */
export function findPreviewInTree(modRoot: string, maxDepth = 3): string | undefined {
  function walk(dir: string, depth: number): string | undefined {
    if (depth > maxDepth) return undefined;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const name of PREVIEW_NAMES) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
    for (const e of entries) {
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (IMAGE_EXT.has(ext) && /preview|icon|thumb|logo/i.test(e.name)) {
        return path.join(dir, e.name);
      }
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === 'media' || e.name === 'About' || depth < 2) {
        const found = walk(path.join(dir, e.name), depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  }
  return walk(modRoot, 0);
}

export function parseModFolder(modRoot: string): ParsedModMeta {
  const meta: ParsedModMeta = { modIds: [] };

  const modInfo = findFile(modRoot, 'mod.info');
  if (modInfo) {
    const kv = parseKeyValueFile(fs.readFileSync(modInfo, 'utf8'));
    meta.title = kv.name || kv.id;
    meta.author = kv.author;
    meta.description = kv.description;
    meta.version = kv.modversion || kv.version;
    if (kv.id) meta.modIds!.push(kv.id);
  }

  // Project Zomboid Workshop items can ship several mods (mods/<Name>/mod.info, B42: mods/<Name>/42/mod.info);
  // collect every id so load-order matching sees all of them, not just the first mod.info found.
  const pzMods = path.join(modRoot, 'mods');
  if (fs.existsSync(pzMods)) {
    try {
      for (const d of fs.readdirSync(pzMods, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        for (const rel of ['mod.info', path.join('42', 'mod.info'), path.join('common', 'mod.info')]) {
          const info = path.join(pzMods, d.name, rel);
          if (!fs.existsSync(info)) continue;
          const id = parseKeyValueFile(fs.readFileSync(info, 'utf8')).id;
          if (id && !meta.modIds!.includes(id)) meta.modIds!.push(id);
          break;
        }
      }
    } catch {
      /* unreadable mods folder: keep what we have */
    }
  }

  const aboutDir = path.join(modRoot, 'About');
  const aboutXml = fs.existsSync(path.join(aboutDir, 'About.xml'))
    ? path.join(aboutDir, 'About.xml')
    : findFile(modRoot, 'About.xml');
  if (aboutXml) {
    const xml = fs.readFileSync(aboutXml, 'utf8');
    meta.title = meta.title || extractXmlTag(xml, 'name');
    meta.author = meta.author || extractXmlTag(xml, 'author');
    meta.description = meta.description || extractXmlTag(xml, 'description');
    meta.version = meta.version || extractXmlTag(xml, 'modVersion');
    // The mod's own packageId, not one inside <modDependencies>/<loadAfter>/… (some About.xml list those first).
    const ownXml = xml.replace(
      /<(modDependencies|modDependenciesByVersion|loadAfter|loadBefore|loadAfterByVersion|loadBeforeByVersion|incompatibleWith|incompatibleWithByVersion)\b[\s\S]*?<\/\1>/gi,
      '',
    );
    const pkgId = extractXmlTag(ownXml, 'packageId');
    if (pkgId) meta.modIds!.push(pkgId);
    const preview = path.join(aboutDir, 'Preview.png');
    if (fs.existsSync(preview)) meta.previewPath = preview;
  }

  // Terraria resource packs (Workshop app 105600).
  const packJson = path.join(modRoot, 'pack.json');
  if (!meta.title && fs.existsSync(packJson)) {
    const pack = parseLooseJson(fs.readFileSync(packJson, 'utf8'));
    if (pack) {
      meta.title = stripTerrariaTags(pack.Name);
      meta.author = stripTerrariaTags(pack.Author);
      meta.description = stripTerrariaTags(pack.Description);
      const v = pack.Version;
      if (v && typeof v === 'object') meta.version = [v.major, v.minor].filter((n) => n != null).join('.');
      else if (v != null) meta.version = String(v);
    }
  }

  for (const name of PREVIEW_NAMES) {
    const p = path.join(modRoot, name);
    if (fs.existsSync(p)) {
      if (!meta.previewPath) meta.previewPath = p;
      if (name.toLowerCase().includes('icon')) meta.iconPath = p;
    }
  }

  if (!meta.title) {
    meta.title = path.basename(modRoot);
  }

  return meta;
}

/** JSON.parse that tolerates raw newlines/tabs inside strings (Terraria's pack.json has them). */
function parseLooseJson(text: string): any {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (c === '\\') {
        out += c + (text[i + 1] ?? '');
        i += 1;
        continue;
      }
      if (c === '"') inString = false;
      else if (c === '\n') { out += '\\n'; continue; }
      else if (c === '\r') continue;
      else if (c === '\t') { out += '\\t'; continue; }
    } else if (c === '"') inString = true;
    out += c;
  }
  try {
    return JSON.parse(out.replace(/^﻿/, ''));
  } catch {
    return undefined;
  }
}

/** Terraria chat tags: [c/af6262:text] -> text, [i:123] item icons dropped. */
function stripTerrariaTags(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\[c\/[0-9a-fA-F]{6}:([^\]]*)\]/g, '$1').replace(/\[i(?:\/[^:\]]*)?:[^\]]*\]/g, '').trim();
  return s || undefined;
}

function findFile(dir: string, fileName: string, depth = 0): string | undefined {
  if (depth > 3) return undefined;
  const direct = path.join(dir, fileName);
  if (fs.existsSync(direct)) return direct;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        const found = findFile(path.join(dir, e.name), fileName, depth + 1);
        if (found) return found;
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function parseKeyValueFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('//')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    out[key] = val;
  }
  return out;
}

function extractXmlTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : undefined;
}

export function folderSizeBytes(root: string, maxDepth = 4): number {
  let total = 0;
  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      try {
        if (e.isFile()) total += fs.statSync(p).size;
        else if (e.isDirectory()) walk(p, depth + 1);
      } catch {
        /* ignore */
      }
    }
  }
  walk(root, 0);
  return total;
}
