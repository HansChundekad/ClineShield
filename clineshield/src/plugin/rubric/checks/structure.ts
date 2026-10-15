/**
 * structure.ts
 *
 * Code-structure categories by per-language line patterns (tree-sitter is
 * "Later" in SPEC.md). A name counts as removed when a definition of it is
 * in the removed lines and not in the added lines.
 */

import { languageOf } from '../paths';
import type { Language } from '../paths';
import type { Check, RawFinding } from '../types';

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'with', 'elif', 'match']);

const DEF: Record<Language, RegExp[]> = {
  js: [
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|\w+)\s*=>/,
    /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/,
    /^\s+(?:(?:public|private|protected|static|async|override|readonly)\s+)*(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/,
  ],
  py: [/^\s*(?:async\s+)?def\s+(\w+)/, /^\s*class\s+(\w+)/],
  go: [/^func\s+(?:\([^)]*\)\s*)?(\w+)/, /^type\s+(\w+)\s+(?:struct|interface)\b/],
  java: [
    /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|override|suspend|open)\s+)+[\w<>[\],.? ]*?\s*(\w+)\s*\(/,
    /^\s*(?:(?:public|private|protected|static|final|abstract|data|open)\s+)*(?:class|interface|enum|object)\s+(\w+)/,
    /^\s*fun\s+(\w+)/,
  ],
  rs: [/^\s*(?:pub(?:\([\w:]+\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)/, /^\s*(?:pub(?:\([\w:]+\))?\s+)?(?:struct|enum|trait)\s+(\w+)/],
  rb: [/^\s*def\s+(?:self\.)?(\w+[?!]?)/, /^\s*(?:class|module)\s+(\w+)/],
};

const EXPORTED: Record<Language, (line: string, name: string) => boolean> = {
  js: line => /^\s*export\b/.test(line),
  py: () => false,
  go: (_l, name) => /^[A-Z]/.test(name),
  java: line => /\bpublic\b/.test(line),
  rs: line => /^\s*pub\b/.test(line),
  rb: () => false,
};

export function definitions(lines: string[], lang: Language): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of lines) {
    for (const r of DEF[lang]) {
      const m = r.exec(line);
      if (m && !KEYWORDS.has(m[1])) { out.set(m[1], line.trim()); break; }
    }
  }
  return out;
}

const ENV_REF = [
  /process\.env\.([A-Z_][A-Z0-9_]*)/g, /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
  /os\.environ(?:\.get)?[[(]\s*['"]([A-Z_][A-Z0-9_]*)['"]/g, /os\.getenv\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
  /os\.Getenv\("([A-Z_][A-Z0-9_]*)"\)/g, /ENV\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
  /System\.getenv\("([A-Z_][A-Z0-9_]*)"\)/g, /env::var\("([A-Z_][A-Z0-9_]*)"\)/g,
];
const ENV_FILE_KEY = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/;
const isEnvFile = (p: string) => /(^|\/)\.env(\.[\w-]+)?$/.test(p);

function envKeys(lines: string[], envFile: boolean): Set<string> {
  const keys = new Set<string>();
  for (const l of lines) {
    if (envFile) { const m = ENV_FILE_KEY.exec(l); if (m) keys.add(m[1]); }
    for (const r of ENV_REF) for (const m of l.matchAll(r)) keys.add(m[1]);
  }
  return keys;
}

export const structureCheck: Check = {
  name: 'structure',
  kind: 'signal',
  run(c) {
    if (c.kind !== 'update') return [];
    const out: RawFinding[] = [];
    const envFile = isEnvFile(c.path);
    for (const h of c.hunks) {
      const removedKeys = envKeys(h.removed, envFile);
      const addedKeys = envKeys(h.added, envFile);
      const gone = [...removedKeys].filter(k => !addedKeys.has(k));
      const fresh = [...addedKeys].filter(k => !removedKeys.has(k));
      if (gone.length && fresh.length) {
        out.push({ category: 'env_key_renamed', weight: 1, detail: `renames ${gone[0]} to ${fresh[0]}` });
        break;
      }
    }
    const lang = languageOf(c.path);
    if (!lang) return out;
    const removed = definitions(c.removed, lang);
    const added = definitions(c.added, lang);
    const gone = [...removed.keys()].filter(n => !added.has(n));
    const changedSig = [...removed.keys()].filter(n => added.has(n) && added.get(n) !== removed.get(n));
    const exportsGone = gone.filter(n => EXPORTED[lang](removed.get(n)!, n));
    if (gone.length) {
      out.push({ category: 'functions_removed', weight: Math.min(gone.length * 10, 40) / 40, detail: `removes ${gone.length} function(s)/class(es): ${gone.slice(0, 3).join(', ')}`, counts: { functionsDeleted: gone.length } });
    }
    if (exportsGone.length) {
      out.push({ category: 'exports_removed', weight: Math.min(exportsGone.length * 20, 40) / 40, detail: `removes or renames export(s): ${exportsGone.slice(0, 3).join(', ')}`, counts: { exportsDeleted: exportsGone.length } });
    }
    if (changedSig.length) out.push({ category: 'signature_changed', weight: 1, detail: `changes the signature of ${changedSig[0]}` });
    return out;
  },
};
