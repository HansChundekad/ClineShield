/**
 * files.ts
 *
 * Size, file-operation and sensitive-file categories (SPEC.md "Risk rubric").
 */

import { matchesGlob } from '../glob';
import { isCiConfig, isGenerated, isInfra, isManifest, isMigration, isSecretsFile } from '../paths';
import type { Check, FileChange, RawFinding } from '../types';

const MIN_FILE_LINES = 20;
const MIN_PATCH_LINES_FOR_PERCENT = 10;

export function rewriteShare(c: FileChange): number | undefined {
  if (c.kind !== 'update') return undefined;
  if (c.original !== undefined && c.matched && c.originalLineCount !== undefined) {
    return c.originalLineCount >= MIN_FILE_LINES ? Math.min(1, c.removed.length / c.originalLineCount) : undefined;
  }
  const changed = c.added.length + c.removed.length;
  const total = changed + c.contextLines;
  return total > MIN_PATCH_LINES_FOR_PERCENT ? changed / total : undefined;
}

export const sizeCheck: Check = {
  name: 'size',
  kind: 'signal',
  run(c) {
    const out: RawFinding[] = [];
    if (c.kind === 'add') return out;
    const share = rewriteShare(c);
    if (share !== undefined && share >= 0.4) {
      const pct = Math.floor(share * 100);
      out.push({ category: 'rewrite_share', weight: share >= 0.75 ? 1 : 0.5, detail: `${pct}% of the file rewritten`, counts: { structuralChangePercent: pct } });
    }
    const r = c.removed.length;
    if (r > 100) out.push({ category: 'lines_removed', weight: r > 300 ? 1 : 0.5, detail: `${r} lines removed` });
    if (r >= 30 && r >= 4 * c.added.length) out.push({ category: 'deletion_heavy', weight: 1, detail: `${r} lines removed, ${c.added.length} added` });
    return out;
  },
};

export const filesTouched: Check = {
  name: 'files_touched',
  kind: 'signal',
  perAction: true,
  run(_c, a) {
    const n = a.changes.length;
    return n > 5 ? [{ category: 'files_touched', weight: n > 15 ? 1 : 0.5, detail: `${n} files in one action` }] : [];
  },
};

export const fileOpsCheck: Check = {
  name: 'file_ops',
  kind: 'critical',
  run(c) {
    const out: RawFinding[] = [];
    if (c.kind === 'delete') out.push({ category: 'file_deleted', weight: 1, detail: `deletes ${c.path}` });
    if (c.moveTargetExists) out.push({ category: 'move_overwrites', weight: 1, detail: `moves onto existing file ${c.moveTo}` });
    const share = rewriteShare(c);
    if (c.gitDirty && (c.kind === 'delete' || c.moveTo || (share !== undefined && share >= 0.75))) {
      out.push({ category: 'uncommitted_lost', weight: 1, detail: `${c.path} has changes not committed to git` });
    }
    if (c.outsideWorkspace) out.push({ category: 'outside_workspace', weight: 1, detail: `${c.moveTo ?? c.path} is outside the project` });
    return out;
  },
};

const UNIGNORE_ADDED = /^!.*(\.env|\.pem|\.key|secret|credential)/i;
const SECRET_IGNORE_REMOVED = /^\/?(\*\*\/)?(\.env\S*|\*\.pem|\*\.key|\S*secret\S*|\S*credential\S*)$/i;
const isGitignore = (p: string) => (p.split('/').pop() ?? p) === '.gitignore';

export const sensitiveCheck: Check = {
  name: 'sensitive',
  kind: 'critical',
  run(c, a, o) {
    const out: RawFinding[] = [];
    const paths = [c.path, ...(c.moveTo ? [c.moveTo] : [])];
    const any = (f: (p: string) => boolean) => paths.find(f);
    const add = (category: RawFinding['category'], detail: string) => out.push({ category, weight: 1, detail });

    const s = any(isSecretsFile); if (s) add('secrets_file', `${s} is a secrets file`);
    const ci = any(isCiConfig); if (ci) add('ci_config', `${ci} is CI configuration`);
    const inf = any(isInfra); if (inf) add('infra', `${inf} is infrastructure configuration`);
    const mig = any(isMigration); if (mig) add('migration', `${mig} is a database migration`);
    const globs = [...o.protectedPaths, ...a.codeownersGlobs];
    const prot = any(p => globs.some(g => matchesGlob(p, g)));
    if (prot) add('protected_path', `${prot} is a protected path`);
    if (any(isGitignore)) {
      const unignores = c.added.some(l => UNIGNORE_ADDED.test(l.trim())) || c.removed.some(l => SECRET_IGNORE_REMOVED.test(l.trim()));
      if (unignores) add('gitignore_unignores_secrets', '.gitignore change stops ignoring secrets files');
      else add('gitignore_changed', '.gitignore changed');
    }
    return out;
  },
};

export const locationCheck: Check = {
  name: 'location',
  kind: 'signal',
  run(c) {
    const out: RawFinding[] = [];
    if (isManifest(c.path)) out.push({ category: 'manifest', weight: 1, detail: `${c.path} lists dependencies` });
    if (isGenerated(c.path)) out.push({ category: 'generated', weight: 1, detail: `${c.path} is generated or vendored` });
    return out;
  },
};
