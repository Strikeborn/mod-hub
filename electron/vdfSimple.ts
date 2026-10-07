/**
 * Minimal Valve Data Format parser for libraryfolders.vdf and appworkshop_*.acf.
 * Not a full VDF implementation — sufficient for Workshop manifests.
 */

export function parseVdf(text: string): Record<string, unknown> {
  const tokens = tokenize(text);
  let i = 0;

  function parseBlock(): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    while (i < tokens.length) {
      const key = tokens[i++];
      if (key === '}') break;
      if (key === '{') continue;
      const next = tokens[i];
      if (next === '{') {
        i++;
        obj[key] = parseBlock();
      } else {
        obj[key] = next;
        i++;
      }
    }
    return obj;
  }

  return parseBlock();
}

function tokenize(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '{' || c === '}') {
      out.push(c);
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      let s = '';
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\' && i + 1 < text.length) {
          s += text[i + 1];
          i += 2;
        } else {
          s += text[i++];
        }
      }
      i++;
      out.push(s);
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    let s = '';
    while (i < text.length && !/\s/.test(text[i]) && text[i] !== '{' && text[i] !== '}') {
      s += text[i++];
    }
    if (s) out.push(s);
  }
  return out;
}

export function vdfGetString(obj: Record<string, unknown>, path: string[]): string | undefined {
  let cur: unknown = obj;
  for (const p of path) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur : cur != null ? String(cur) : undefined;
}
