/** Strips credentials and host home paths from run output before it is committed (design §9). */
import * as fs from 'fs/promises';
import * as path from 'path';
import { SECRET_PATTERNS } from '../../clineshield/src/plugin/rubric/checks/hard';

const EXTRA: RegExp[] = [/sk-ant-[\w-]{10,}/, /Bearer\s+[\w.~+/-]{16,}=*/, /sk-(proj-)?[A-Za-z0-9_-]{32,}/];
const PATTERNS = [...SECRET_PATTERNS, ...EXTRA].map(r => new RegExp(r.source, r.flags.includes('g') ? r.flags : `${r.flags}g`));
const HOME = /\/Users\/[^/\s"']+/g;

export function redact(text: string, allow: string[]): { text: string; hits: string[] } {
  const hits: string[] = [];
  let out = text;
  for (const r of PATTERNS) {
    out = out.replace(r, m => {
      if (allow.some(a => m.includes(a) || a.includes(m))) return m;
      hits.push(m.slice(0, 12));
      return '[REDACTED]';
    });
  }
  out = out.replace(HOME, '~');
  return { text: out, hits };
}

/** Files under dir that still contain a secret match (the commit gate). */
export async function scanDir(dir: string, allow: string[]): Promise<string[]> {
  const bad: string[] = [];
  async function walk(d: string): Promise<void> {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (redact(await fs.readFile(p, 'utf-8'), allow).hits.length) bad.push(p);
    }
  }
  await walk(dir);
  return bad.sort();
}
