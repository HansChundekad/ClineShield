/**
 * session.ts
 *
 * Risk rubric ④ (SPEC.md "Risk rubric", Session rows): a small in-memory
 * memory of this session — the last known test-run outcome, recent edits per
 * file, and the files Cline has read, created or edited. One store per plugin
 * worker; lost on restart by design; never written to disk. Bounded: at most
 * MAX_FILES files (least recently touched dropped first), MAX_EDITS_PER_FILE
 * timestamps per file, none older than EDIT_WINDOW_MS.
 *
 * Also the pure parsers that feed it from afterTool: which run_commands
 * entries are test runs and how they ended, and which read_files paths were
 * read successfully (shapes verified against Cline CLI 3.0.74 @cline/core).
 */

import { normaliseCommands } from './commands/normalise';
import type { CommandEntry } from './commands/normalise';
import * as path from 'path';
import { parseEntries, simplify } from './commands/parse';
import type { ParseEnv, Piece } from './commands/parse';

export const EDIT_WINDOW_MS = 600_000;
export const MAX_FILES = 500;
export const MAX_EDITS_PER_FILE = 20;
/** edit_loop fires when this many earlier edits of the file fall in the window (this edit is the 5th). */
export const EDIT_LOOP_PRIOR = 4;
/** session_churn fires when the session's changed lines go over this. */
export const CHURN_LIMIT = 1000;

export type TestOutcome = 'passed' | 'failed';

/** Read-only, live view of the store handed to the checks. */
export interface SessionView {
  readonly lastTestFailed: boolean;
  readonly churn: number;
  /** Edits of `path` within the last EDIT_WINDOW_MS. */
  priorEdits(path: string): number;
  /** Cline has read, created or edited `path` this session. */
  known(path: string): boolean;
  /** Paths edited within the window, plus approved edits still running (parallel tool calls). */
  recentEdits(): string[];
}

/** At most this many in-flight edit calls are remembered. */
export const MAX_PENDING = 50;

interface FileEntry { edits: number[] }

export class SessionStore {
  private readonly files = new Map<string, FileEntry>();
  private readonly pending = new Map<string, string[]>();
  private failed = false;
  private changed = 0;

  constructor(private readonly now: () => number = Date.now) {}

  get size(): number { return this.files.size; }

  view(): SessionView {
    const self = this;
    return {
      get lastTestFailed() { return self.failed; },
      get churn() { return self.changed; },
      priorEdits: (path: string) => {
        const e = self.files.get(path);
        if (!e) return 0;
        self.prune(e);
        return e.edits.length;
      },
      known: (path: string) => self.files.has(path),
      recentEdits: () => {
        const out = new Set<string>();
        for (const [p, e] of self.files) { self.prune(e); if (e.edits.length > 0) out.add(p); }
        for (const ps of self.pending.values()) for (const p of ps) out.add(p);
        return [...out];
      },
    };
  }

  /** undefined (unknown outcome) leaves the last known outcome as it is. */
  recordTestOutcome(outcome: TestOutcome | undefined): void {
    if (outcome) this.failed = outcome === 'failed';
  }

  recordRead(path: string): void { this.touch(path); }

  recordEdit(path: string, lines: number): void {
    const e = this.touch(path);
    e.edits.push(this.now());
    this.prune(e);
    if (e.edits.length > MAX_EDITS_PER_FILE) e.edits.splice(0, e.edits.length - MAX_EDITS_PER_FILE);
    this.changed += Math.max(0, lines);
  }

  /** An allowed or approved edit call that hasn't finished yet (cleared in afterTool). */
  recordPending(toolCallId: string, paths: string[]): void {
    this.pending.set(toolCallId, paths);
    while (this.pending.size > MAX_PENDING) this.pending.delete(this.pending.keys().next().value as string);
  }

  clearPending(toolCallId: string): void { this.pending.delete(toolCallId); }

  recordDelete(path: string): void { this.files.delete(path); }

  recordMove(from: string, to: string): void {
    this.files.delete(from);
    this.files.delete(to);
    this.touch(to);
  }

  /** Moves `path` to the most-recent end (Map order = LRU) and evicts beyond MAX_FILES. */
  private touch(path: string): FileEntry {
    const e = this.files.get(path) ?? { edits: [] };
    this.files.delete(path);
    this.files.set(path, e);
    while (this.files.size > MAX_FILES) this.files.delete(this.files.keys().next().value as string);
    return e;
  }

  private prune(e: FileEntry): void {
    const cutoff = this.now() - EDIT_WINDOW_MS;
    let i = 0;
    while (i < e.edits.length && e.edits[i] < cutoff) i++;
    if (i > 0) e.edits.splice(0, i);
  }
}

// ---- afterTool parsers ------------------------------------------------------

const PKG_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const RUNNERS = new Set(['jest', 'vitest', 'mocha']);
const BARE = new Set(['jest', 'vitest', 'mocha', 'pytest', 'rspec']);
const TEST_SUBCOMMAND = new Set(['go', 'cargo', 'dotnet', 'mvn', 'gradle', 'gradlew', 'make']);

/** True when one simple command runs a test suite (SPEC ④ test-command list). */
function isTestPiece(p: Piece): boolean {
  const s = simplify(p);
  const args = s.args.map(a => a.text).filter(a => !a.startsWith('-'));
  const [a0, a1] = args;
  if (BARE.has(s.name)) return true;
  if (PKG_MANAGERS.has(s.name)) {
    if (a0 === 'test' || (a0 === 'run' && (a1 === 'test' || a1?.startsWith('test:')))) return true;
    if (s.name === 'pnpm' && a0 === 'exec') return RUNNERS.has(a1);
    return s.name === 'yarn' && RUNNERS.has(a0);
  }
  if (s.name === 'npx' || s.name === 'bunx') return RUNNERS.has(a0);
  if (s.name === 'python' || s.name === 'python3') {
    const m = s.args.findIndex(a => a.text === '-m');
    return m >= 0 && ['pytest', 'unittest'].includes(s.args[m + 1]?.text ?? '');
  }
  return TEST_SUBCOMMAND.has(s.name) && a0 === 'test';
}

/**
 * An entry is a test run only when its top-level pieces are zero or more `cd`s
 * then exactly one test command, with no pipe: then the entry's exit code is
 * the suite's. Anything else (chains, pipes, `|| true`, parse errors) is not.
 */
export function isTestRun(entry: CommandEntry, env: ParseEnv): boolean {
  return testRunShape(entry, env) === 'plain';
}

/**
 * 'plain': `cd…` then one test command (the entry's exit code is the suite's).
 * A RegExp: the same followed by one `echo` of `$?` (`npm test; echo "EXIT=$?"`):
 * the entry's exit code is the echo's, so the suite's code is read from the
 * printed last line, which must match the RegExp exactly (group 1 = the code).
 */
function testRunShape(entry: CommandEntry, env: ParseEnv): 'plain' | RegExp | undefined {
  let pieces: Piece[];
  try {
    pieces = parseEntries([entry], env).filter(p => p.depth === 0);
  } catch {
    return undefined;
  }
  if (pieces.length === 0 || pieces.some(p => p.pipedFrom)) return undefined;
  const testAt = (n: number) => n >= 1 && pieces.slice(0, n - 1).every(p => simplify(p).name === 'cd') && isTestPiece(pieces[n - 1]);
  if (testAt(pieces.length)) return 'plain';
  if (!testAt(pieces.length - 1)) return undefined;
  return echoExitPattern(pieces[pieces.length - 1]);
}

const ECHO_OPTION = /^-[neE]+$/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `echo [-n|-e] … $? …` with `$?` expanded exactly once and nothing else dynamic → the line it prints. */
function echoExitPattern(p: Piece): RegExp | undefined {
  if (simplify(p).name !== 'echo' || p.redirects.length > 0) return undefined;
  const args = p.words.slice(1);
  while (args.length > 0 && ECHO_OPTION.test(args[0].text) && !args[0].dynamic) args.shift();
  if (args.length === 0 || args.some(w => w.subs.length > 0)) return undefined;
  const text = args.map(w => w.text).join(' ');
  const parts = text.split('$?');
  const expanded = args.filter(w => w.dynamic && w.text.includes('$?')).length;
  if (parts.length !== 2 || expanded !== 1 || /[$`]/.test(parts.join(''))) return undefined;
  return new RegExp(`^${escapeRe(parts[0])}(\\d+)${escapeRe(parts[1])}$`);
}

/** Last non-empty line of an entry's output. */
function lastLine(result: unknown): string | undefined {
  if (typeof result !== 'string') return undefined;
  const lines = result.split('\n').map(l => l.trimEnd()).filter(l => l !== '');
  return lines[lines.length - 1];
}

type ToolResult = { output?: unknown; isError?: boolean } | undefined;
const EXIT_FAILED = /^Command exited with code [1-9]\d*/;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Outcome of the test runs in one run_commands result: failed if any test
 * entry exited non-zero, else passed if any passed, else undefined (unknown:
 * timeouts, signals, detached, skipped or denied calls).
 */
export function testOutcome(input: unknown, result: ToolResult, env: ParseEnv): TestOutcome | undefined {
  if (!result || result.isError || !Array.isArray(result.output)) return undefined;
  const entries = normaliseCommands(input);
  if (!entries) return undefined;
  const output = result.output as unknown[];
  let passed = false;
  for (let i = 0; i < entries.length; i++) {
    const shape = testRunShape(entries[i], env);
    const r = output[i];
    if (!shape || !isObj(r)) continue;
    if (shape instanceof RegExp) {
      const m = shape.exec(lastLine(r.result) ?? '');
      if (m) { if (Number(m[1]) === 0) passed = true; else return 'failed'; continue; }
      // `npm test && echo …`: a failing suite skips the echo, so the entry's own code is the suite's.
      if (r.success === false && typeof r.error === 'string' && EXIT_FAILED.test(r.error)) return 'failed';
      continue;
    }
    if (r.success === true) passed = true;
    else if (typeof r.error === 'string' && EXIT_FAILED.test(r.error)) return 'failed';
  }
  return passed ? 'passed' : undefined;
}

/** One read_files request entry → its path (SDK FileReadRequest and legacy aliases). */
function entryPath(x: unknown): string | undefined {
  if (typeof x === 'string') return x;
  if (!isObj(x)) return undefined;
  const p = x.path ?? x.file_path ?? x.filePath;
  return typeof p === 'string' && p !== '' ? p : undefined;
}

const asList = (x: unknown): unknown[] => (Array.isArray(x) ? x : [x]);

/** read_files input → request entries, in the order the SDK runs them (ReadFilesInputUnionSchema). */
function readEntries(input: unknown): unknown[] {
  if (typeof input === 'string' || Array.isArray(input)) return asList(input);
  if (!isObj(input)) return [];
  if ('files' in input) return asList(input.files);
  if ('file_paths' in input) return asList(input.file_paths);
  if ('paths' in input) return asList(input.paths);
  return [input];
}

/** Paths read successfully by one read_files call (whole file or a range); [] for skipped or failed calls. */
export function readPaths(input: unknown, result: ToolResult): string[] {
  if (!result || result.isError || !Array.isArray(result.output)) return [];
  const output = result.output as unknown[];
  const out: string[] = [];
  readEntries(input).forEach((e, i) => {
    const p = entryPath(e);
    const r = output[i];
    if (p && isObj(r) && r.success === true) out.push(p);
  });
  return out;
}

const READERS = new Set(['cat', 'head', 'tail', 'less', 'more', 'bat']);

/**
 * Files read through the terminal (`cat`, `head`, `tail`, `less`, `more`,
 * `bat` with literal names) by the successful entries of one run_commands
 * call, as absolute paths. Option values that are plain numbers are skipped.
 */
export function shellReadPaths(input: unknown, result: ToolResult, env: ParseEnv): string[] {
  if (!result || result.isError || !Array.isArray(result.output)) return [];
  const entries = normaliseCommands(input);
  if (!entries) return [];
  const output = result.output as unknown[];
  const out: string[] = [];
  entries.forEach((entry, i) => {
    const r = output[i];
    if (!isObj(r) || r.success !== true) return;
    let pieces: Piece[];
    try { pieces = parseEntries([entry], env); } catch { return; }
    for (const p of pieces) {
      const s = simplify(p);
      if (!READERS.has(s.name) || !p.cwd) continue;
      for (const a of s.args) {
        if (a.dynamic || a.glob || a.text.startsWith('-') || /^\d+$/.test(a.text) || a.text === '') continue;
        out.push(path.resolve(p.cwd, a.text));
      }
    }
  });
  return out;
}
