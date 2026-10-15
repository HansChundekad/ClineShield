/**
 * hard.ts
 *
 * Hard rules (SPEC.md "Risk rubric"): always block, not configurable.
 */

import * as path from 'path';
import { isSecretsFile } from '../paths';
import type { ActionContext, Check, FileChange, RawFinding } from '../types';

const COMMENT = /^\s*(\/\/|#|\/\*|\*|<!--|--|;)/;

export const PLACEHOLDER_LINE: RegExp[] = [
  /^\s*(\/\/|#|\/\*|\*|<!--|--)\s*\.{3}\s*(\*\/|-->)?\s*$/,
  /\.{3}\s*(rest|remaining|existing|other|previous|same|unchanged)\b/i,
  /\b(rest|remainder) of (the )?(code|file|implementation|function|class|methods?|component)\b.*\b(unchanged|same|as (before|is)|here|omitted)\b/i,
  /\b(existing|previous|original|other) (code|implementation|methods?|functions?|logic)\b.*\b(here|unchanged|omitted|remains?|stays?|same)\b/i,
  /\b(code|implementation) (omitted|unchanged) (for brevity|here)?/i,
];

export const STUB_LINE: RegExp[] = [
  /^\s*(pass|\.\.\.)\s*$/,
  /throw new Error\(\s*['"`](not implemented|todo|unimplemented)/i,
  /raise NotImplementedError/,
  /\b(todo|unimplemented)!\(/,
  /panic\(\s*"(TODO|not implemented|unimplemented)/i,
  /(\/\/|#)\s*TODO:?\s*implement/i,
  /throw new UnsupportedOperationException/,
];

export const SECRET_PATTERNS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{36,}/,
  /github_pat_[A-Za-z0-9_]{40,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /sk_live_[0-9a-zA-Z]{24,}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /\bsk-ant-[A-Za-z0-9_-]{32,}/,
  /\bsk-(proj-)?(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}/,
  /-----BEGIN ([A-Z]+ )?PRIVATE KEY-----/,
  /(api[_-]?key|secret|token|passw(or)?d)['"]?\s*[:=]\s*['"](?=[A-Za-z0-9_\-/+=]*\d)(?=[A-Za-z0-9_\-/+=]*[A-Za-z])[A-Za-z0-9_\-/+=]{20,}['"]/i,
];

const hit = (category: RawFinding['category'], detail: string): RawFinding[] => [{ category, weight: 1, detail }];

function within(p: string, dir: string): boolean {
  const rel = path.relative(dir, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isShieldPath(abs: string, a: ActionContext): boolean {
  // Normalise: hosts may report roots with a trailing slash.
  const root = path.resolve(a.workspaceRoot);
  if (path.basename(abs) === '.cline-shield.yml' && [root, path.resolve(a.homeDir)].includes(path.dirname(path.resolve(abs)))) return true;
  return [path.join(root, '.cline-shield'), a.pluginDir, path.join(root, '.cline', 'plugins'), path.join(a.homeDir, '.cline', 'plugins')]
    .some(dir => within(abs, dir));
}

export const selfProtection: Check = {
  name: 'self_protection',
  kind: 'critical',
  run(c: FileChange, a: ActionContext) {
    const targets = [c.absPath, ...(c.moveTo ? [path.resolve(a.workspaceRoot, c.moveTo)] : [])];
    return targets.some(t => isShieldPath(t, a)) ? hit('self_protection', `${c.moveTo ?? c.path} is a ClineShield file`) : [];
  },
};

const isStub = (l: string) => STUB_LINE.some(r => r.test(l));

export const placeholder: Check = {
  name: 'placeholder',
  kind: 'critical',
  run(c: FileChange) {
    if (c.kind !== 'update') return [];
    const marker = c.added.find(l => COMMENT.test(l) && PLACEHOLDER_LINE.some(r => r.test(l)));
    if (marker) return hit('placeholder', `replaces existing code with a placeholder ("${marker.trim()}")`);
    for (const h of c.hunks) {
      const real = h.removed.filter(l => l.trim() !== '' && !isStub(l));
      const stub = h.added.find(isStub);
      if (stub && real.length >= 3) return hit('placeholder', `replaces ${real.length} lines of code with a stub ("${stub.trim()}")`);
    }
    return [];
  },
};

export const secretAdded: Check = {
  name: 'secret_added',
  kind: 'critical',
  run(c: FileChange) {
    if (isSecretsFile(c.path)) return [];
    for (const line of c.added) {
      for (const r of SECRET_PATTERNS) {
        const m = r.exec(line);
        if (m && !/example/i.test(m[0])) return hit('secret_added', 'adds what looks like an API key, token or private key');
      }
    }
    return [];
  },
};
