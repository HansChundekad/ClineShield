/**
 * gather.ts
 *
 * The only I/O for run_commands: turns the files commands change (targets)
 * into FileChanges for the per-file checks, and finishes discards_work with
 * one `git status`. Reads, stats and git run only when a command touches
 * files or discards work; all under the same time caps as edits. Never throws.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { diffLines } from '../../patch';
import type { FileOperation, PatchHunk, PatchLine } from '../../patch';
import {
  GATHER_BUDGET_MS, GIT_TIMEOUT_MS, MAX_READ_BYTES,
  buildChange, displayPath, gitDirtyPaths, gitPaths, gitTrackedPaths, isOutside, withTimeout,
} from '../gather';
import type { FileInfo } from '../gather';
import { toLines } from '../paths';
import type { FileChange, RawFinding } from '../types';
import type { Analysis, Target } from './analyze';

export interface TargetGatherOptions {
  workspaceRoot: string;
  tempDirs: string[];
  budgetMs?: number;
  gitTimeoutMs?: number;
}

/** Weight of discards_work on a clean tree: 10 of 50 points. */
export const CLEAN_DISCARD_WEIGHT = 0.2;
const CONTEXT = 3;

const within = (p: string, dir: string) => {
  const rel = path.relative(dir, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Unified-diff style hunks (3 context lines) from a whole-file line diff. */
export function toHunks(lines: PatchLine[]): PatchHunk[] {
  const ranges: Array<[number, number]> = [];
  lines.forEach((l, i) => {
    if (l.kind === 'context') return;
    const lo = Math.max(0, i - CONTEXT);
    const hi = Math.min(lines.length - 1, i + CONTEXT);
    const last = ranges[ranges.length - 1];
    if (last && lo <= last[1] + 1) last[1] = hi; else ranges.push([lo, hi]);
  });
  return ranges.map(([lo, hi]) => ({ endOfFile: hi === lines.length - 1, lines: lines.slice(lo, hi + 1) }));
}

interface Stat { exists?: boolean; dir: boolean; size: number }
const statOf = (p: string): Promise<Stat> =>
  fs.stat(p).then(
    st => ({ exists: true, dir: st.isDirectory(), size: st.size }),
    (e: NodeJS.ErrnoException) => ({ exists: e.code === 'ENOENT' ? false : undefined, dir: false, size: 0 }),
  );

interface Resolved { t: Target; abs: string; moveTo?: string; info: FileInfo; dir: boolean }

async function resolveTarget(t: Target, o: TargetGatherOptions): Promise<Resolved> {
  const root = o.workspaceRoot;
  const inTemp = (p: string) => !within(p, root) && o.tempDirs.some(d => within(p, d));
  let abs = t.abs;
  let st = t.glob ? { exists: undefined, dir: false, size: 0 } : await statOf(abs);
  if (t.srcBase && st.dir) { abs = path.join(abs, t.srcBase); st = await statOf(abs); }
  const info: FileInfo = { binary: false, exists: st.exists, outsideWorkspace: !inTemp(abs) && (await isOutside(root, abs)) };
  let moveTo: string | undefined;
  if (t.kind === 'move' && t.moveTo) {
    moveTo = t.moveTo;
    const dst = await statOf(moveTo);
    if (dst.dir) moveTo = path.join(moveTo, path.basename(abs));
    const final = moveTo === t.moveTo ? dst : await statOf(moveTo);
    info.moveTargetExists = final.exists === true && !final.dir;
    if (!inTemp(moveTo)) info.outsideWorkspace = info.outsideWorkspace || (await isOutside(root, moveTo));
  }
  if (st.exists && !st.dir && st.size <= MAX_READ_BYTES) {
    try {
      const buf = await fs.readFile(abs);
      if (buf.subarray(0, 8192).includes(0)) info.binary = true; else info.original = buf.toString('utf-8');
    } catch { /* unreadable: name-only */ }
  }
  return { t, abs, moveTo, info, dir: st.dir };
}

function opFor(r: Resolved): { op: FileOperation; overwrite: boolean; matched?: boolean } {
  const { t, abs, info } = r;
  const content = t.content ?? '';
  const adds = (lines: string[]): PatchHunk => ({ endOfFile: true, lines: lines.map(text => ({ kind: 'add' as const, text })) });
  switch (t.kind) {
    case 'delete': return { op: { type: 'delete', path: abs }, overwrite: false };
    case 'move': return { op: { type: 'update', path: abs, moveTo: r.moveTo, hunks: [] }, overwrite: false };
    case 'edit': return { op: { type: 'update', path: abs, hunks: [] }, overwrite: false };
    case 'overwrite': return { op: { type: 'update', path: abs, hunks: [] }, overwrite: true };
    case 'replace':
      if (info.original !== undefined) return { op: { type: 'update', path: abs, hunks: toHunks(diffLines(toLines(info.original), toLines(content))) }, overwrite: false, matched: true };
      if (info.exists === false) return { op: { type: 'add', path: abs, lines: toLines(content) }, overwrite: false };
      return { op: { type: 'update', path: abs, hunks: [adds(toLines(content))] }, overwrite: true };
    case 'append': {
      if (info.exists === false) return { op: { type: 'add', path: abs, lines: toLines(content) }, overwrite: false };
      const tail = info.original === undefined ? [] : toLines(info.original).slice(-CONTEXT).map(text => ({ kind: 'context' as const, text }));
      const hunk = adds(toLines(content));
      hunk.lines = [...tail, ...hunk.lines];
      return { op: { type: 'update', path: abs, hunks: [hunk] }, overwrite: false, matched: info.original !== undefined ? true : undefined };
    }
  }
}

/** True when `git status` shows changes (untracked files only when asked); undefined when git is unavailable. */
async function treeDirty(root: string, untracked: boolean, ms: number): Promise<boolean | undefined> {
  const out = await gitPaths(root, ['status', '--porcelain', '-z', untracked ? '--untracked-files=normal' : '--untracked-files=no'], ms);
  return out === undefined ? undefined : out.size > 0;
}

export async function gatherTargets(
  targets: Target[],
  discards: Analysis['discards'],
  o: TargetGatherOptions,
): Promise<{ changes: FileChange[]; findings: RawFinding[] }> {
  const root = o.workspaceRoot;
  const gitMs = o.gitTimeoutMs ?? GIT_TIMEOUT_MS;
  const seen = new Set<string>();
  const unique = targets.filter(t => { const k = `${t.kind}:${t.abs}:${t.moveTo ?? ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const display = (p: string) => displayPath(root, p);

  const work = (async () => {
    const inWs = unique.some(t => within(t.abs, root));
    const [dirty, tracked, discardState] = await Promise.all([
      inWs ? gitDirtyPaths(root, gitMs) : undefined,
      inWs ? gitTrackedPaths(root, gitMs) : undefined,
      Promise.all(discards.map(d => treeDirty(root, d.untracked, gitMs))),
    ]);
    const resolved = await Promise.all(unique.map(t => resolveTarget(t, o).catch(() => undefined)));
    return { dirty, tracked, discardState, resolved };
  })();
  const lexical = { dirty: undefined, tracked: undefined, discardState: discards.map(() => undefined), resolved: unique.map(() => undefined) };
  const g = await withTimeout(work, o.budgetMs ?? GATHER_BUDGET_MS, lexical as Awaited<typeof work>);

  const changes = unique.map((t, i) => {
    const r: Resolved = g.resolved[i] ?? {
      t, abs: t.abs, moveTo: t.moveTo, dir: false,
      info: { binary: false, outsideWorkspace: !within(t.abs, root) && !o.tempDirs.some(d => within(t.abs, d)) },
    };
    const rel = display(r.abs);
    const under = (set: Set<string> | undefined) => (set === undefined ? undefined : r.dir ? [...set].some(p => p.startsWith(`${rel}/`)) : set.has(rel));
    r.info.gitDirty = under(g.dirty);
    r.info.gitTracked = under(g.tracked);
    const { op, overwrite, matched } = opFor(r);
    // Folders show with a trailing slash so folder globs (src/auth/**, tests/) match.
    const show = (p: string) => (r.dir && p === r.abs ? `${display(p)}/` : display(p));
    const c = buildChange(op, r.info, show, r.abs);
    c.shellEdit = t.form;
    if (overwrite) c.overwrite = true;
    if (matched) c.matched = true;
    return c;
  });

  const findings: RawFinding[] = discards.map((d, i) =>
    g.discardState[i] === false
      ? { category: 'discards_work', weight: CLEAN_DISCARD_WEIGHT, detail: `${d.detail} (nothing uncommitted right now)` }
      : { category: 'discards_work', weight: 1, detail: d.detail },
  );
  return { changes, findings };
}
