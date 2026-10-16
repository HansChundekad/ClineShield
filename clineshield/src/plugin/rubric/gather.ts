/**
 * gather.ts
 *
 * The rubric's only I/O before scoring: reads each file's original text,
 * checks existence, symlinks and git status, all under time caps. Anything
 * that fails or times out is left undefined, and checks fall back to
 * patch-only measures. Never throws.
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { applyOperation } from '../patch';
import type { FileOperation } from '../patch';
import { isTestPath, toLines } from './paths';
import type { ActionContext, FileChange } from './types';

export const MAX_READ_BYTES = 2 * 1024 * 1024;
export const GATHER_BUDGET_MS = 1500;
export const GIT_TIMEOUT_MS = 300;

export interface FileInfo {
  original?: string;
  exists?: boolean;
  binary: boolean;
  moveTargetExists?: boolean;
  outsideWorkspace: boolean;
  gitDirty?: boolean;
  gitTracked?: boolean;
}

export interface GatherOptions {
  workspaceRoot: string;
  homeDir: string;
  pluginDir: string;
  codeownersGlobs: string[];
  budgetMs?: number;
  gitTimeoutMs?: number;
}

export function displayPath(root: string, p: string): string {
  const rel = path.relative(root, path.resolve(root, p));
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return path.resolve(root, p);
  return rel.split(path.sep).join('/');
}

export function buildChange(op: FileOperation, info: FileInfo, display: (p: string) => string, absPath: string): FileChange {
  const hunks: FileChange['hunks'] = [];
  let contextLines = 0;
  if (op.type === 'add') hunks.push({ added: [...op.lines], removed: [] });
  if (op.type === 'update') {
    for (const h of op.hunks) {
      hunks.push({
        added: h.lines.filter(l => l.kind === 'add').map(l => l.text),
        removed: h.lines.filter(l => l.kind === 'remove').map(l => l.text),
      });
      contextLines += h.lines.filter(l => l.kind === 'context').length;
    }
  }
  if (op.type === 'delete' && info.original !== undefined) hunks.push({ added: [], removed: toLines(info.original) });

  const path_ = display(op.path);
  return {
    path: path_,
    absPath,
    kind: op.type,
    moveTo: op.type === 'update' && op.moveTo ? display(op.moveTo) : undefined,
    op,
    original: info.original,
    originalLineCount: info.original === undefined ? undefined : toLines(info.original).length,
    exists: info.exists,
    binary: info.binary,
    matched: info.original !== undefined && op.type === 'update' ? applyOperation(info.original, op).ok : undefined,
    moveTargetExists: info.moveTargetExists,
    outsideWorkspace: info.outsideWorkspace,
    gitDirty: info.gitDirty,
    gitTracked: info.gitTracked,
    added: hunks.flatMap(h => h.added),
    removed: hunks.flatMap(h => h.removed),
    hunks,
    contextLines,
    isTest: isTestPath(path_),
  };
}

export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}

/** NUL-separated output of a git command run in `root`; undefined on error, non-zero exit or timeout. */
export function gitPaths(root: string, args: string[], timeoutMs: number): Promise<Set<string> | undefined> {
  return new Promise(resolve => {
    let out = '';
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(undefined);
      return;
    }
    const timer = setTimeout(() => { child.kill(); resolve(undefined); }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => { out += d.toString('utf-8'); });
    child.on('error', () => { clearTimeout(timer); resolve(undefined); });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve(code === 0 ? new Set(out.split('\0').filter(Boolean)) : undefined);
    });
  });
}

/** Workspace-relative paths with uncommitted changes to tracked files; undefined when git is unavailable, has no commits, or is slow. */
export function gitDirtyPaths(root: string, timeoutMs = GIT_TIMEOUT_MS): Promise<Set<string> | undefined> {
  // Paths relative to cwd (works when the workspace is a subfolder of the repo); staged + unstaged.
  return gitPaths(root, ['diff', 'HEAD', '--name-only', '--relative', '-z'], timeoutMs);
}

/** Workspace-relative paths tracked by git; undefined when git is unavailable or slow. */
export function gitTrackedPaths(root: string, timeoutMs = GIT_TIMEOUT_MS): Promise<Set<string> | undefined> {
  return gitPaths(root, ['ls-files', '-z'], timeoutMs);
}

export async function readCodeowners(root: string): Promise<string[]> {
  for (const rel of ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']) {
    try {
      const text = await fs.readFile(path.join(root, rel), 'utf-8');
      return toLines(text)
        .map(l => l.trim())
        .filter(l => l !== '' && !l.startsWith('#'))
        .map(l => l.split(/\s+/)[0])
        .map(p => (p.endsWith('/') ? `${p.replace(/^\//, '')}**` : p.replace(/^\//, '')));
    } catch {
      continue;
    }
  }
  return [];
}

export async function isOutside(root: string, abs: string): Promise<boolean> {
  const inside = (p: string, r: string) => {
    const rel = path.relative(r, p);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  if (!inside(abs, root)) return true;
  // Resolve the deepest existing ancestor so symlinked folders count.
  let probe = abs;
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      const realRoot = await fs.realpath(root).catch(() => root);
      return !inside(real, realRoot);
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return false;
      probe = parent;
    }
  }
}

interface GitState { dirty?: Set<string>; tracked?: Set<string> }

async function readInfo(op: FileOperation, root: string, git: GitState, display: (p: string) => string): Promise<FileInfo> {
  const abs = path.resolve(root, op.path);
  const info: FileInfo = { binary: false, outsideWorkspace: await isOutside(root, abs) };
  if (op.type === 'update' && op.moveTo) {
    const target = path.resolve(root, op.moveTo);
    info.outsideWorkspace = info.outsideWorkspace || (await isOutside(root, target));
    info.moveTargetExists = await fs.stat(target).then(() => true, () => false);
  }
  try {
    const st = await fs.stat(abs);
    info.exists = true;
    if (st.size <= MAX_READ_BYTES) {
      const buf = await fs.readFile(abs);
      const head = buf.subarray(0, 8192);
      if (head.includes(0)) info.binary = true;
      else info.original = buf.toString('utf-8');
    }
  } catch (e) {
    info.exists = (e as NodeJS.ErrnoException).code === 'ENOENT' ? false : undefined;
  }
  if (git.dirty) info.gitDirty = git.dirty.has(display(op.path));
  if (git.tracked) info.gitTracked = git.tracked.has(display(op.path));
  return info;
}

export async function gatherAction(ops: FileOperation[], opts: GatherOptions): Promise<ActionContext> {
  const root = opts.workspaceRoot;
  const display = (p: string) => displayPath(root, p);
  const budget = opts.budgetMs ?? GATHER_BUDGET_MS;
  // Fallback when a read fails or the budget runs out: no I/O, lexical outside check only.
  const lexicalInfo = (op: FileOperation): FileInfo => {
    const rel = path.relative(root, path.resolve(root, op.path));
    return { binary: false, outsideWorkspace: rel.startsWith('..') || path.isAbsolute(rel) };
  };
  const work = (async () => {
    const gitMs = opts.gitTimeoutMs ?? GIT_TIMEOUT_MS;
    const [dirty, tracked] = await Promise.all([gitDirtyPaths(root, gitMs), gitTrackedPaths(root, gitMs)]);
    return Promise.all(ops.map(op => readInfo(op, root, { dirty, tracked }, display).catch(() => lexicalInfo(op))));
  })();
  const infos = await withTimeout(work, budget, ops.map(lexicalInfo));
  return {
    workspaceRoot: root,
    homeDir: opts.homeDir,
    pluginDir: opts.pluginDir,
    codeownersGlobs: opts.codeownersGlobs,
    changes: ops.map((op, i) => buildChange(op, infos[i], display, path.resolve(root, op.path))),
  };
}
