/**
 * analyze.ts
 *
 * Parsed run_commands pieces → command-level findings (SPEC.md "Risk rubric",
 * Commands) and the files the commands change (targets), which gather.ts
 * turns into FileChanges for the per-file checks. Pure (no I/O): anything
 * that needs git (discards_work) is returned for the caller to finish.
 */

import * as path from 'path';
import { isSecretsFile } from '../paths';
import type { RawFinding } from '../types';
import { simplify } from './parse';
import type { Piece, Simple, Word } from './parse';

export interface AnalyzeContext {
  workspaceRoot: string;
  homeDir: string;
  /** /tmp, /private/tmp, $TMPDIR: exempt from rm_outside and never targets. */
  tempDirs: string[];
  trustedCommands: string[];
}

export type TargetKind = 'delete' | 'edit' | 'overwrite' | 'replace' | 'append' | 'move';

/** A file a command changes. `edit`/`overwrite`/`delete`/`move`: name only; `replace`/`append`: content known. */
export interface Target {
  abs: string;
  kind: TargetKind;
  /** Command form for shell_edit, e.g. "sed -i", "cat >". */
  form: string;
  content?: string;
  /** move: destination as written (gather appends the source name when it is a folder). */
  moveTo?: string;
  /** cp: source name, appended when the destination is a folder. */
  srcBase?: string;
  /** Path has unquoted glob characters: names a pattern, not one file. */
  glob?: boolean;
}

export interface Analysis {
  findings: RawFinding[];
  targets: Target[];
  /** Untrusted piece texts (custom `match: command` rules). */
  pieces: string[];
  /** Signal detectors that crashed. */
  skipped: string[];
  /** Critical detectors that crashed. */
  errors: string[];
  /** discards_work hits; weight needs `git status` (dirty 50, clean 10). */
  discards: Array<{ detail: string; untracked: boolean }>;
}

/** Folders that are rebuilt, not lost: rm_recursive = 0 and not scored as file deletes. */
export const DISPOSABLE_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', 'target', 'coverage', '__pycache__',
  '.pytest_cache', '.mypy_cache', '.turbo', '.cache', '.parcel-cache',
]);
const SINKS = /^\/dev\/(null|zero|stdout|stderr|tty|fd\/\d+)$/;
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'python', 'python3', 'node', 'perl', 'ruby']);
const DOWNLOADERS = /\b(curl|wget)\b/;
const NETWORK = new Set(['curl', 'wget', 'nc', 'ncat', 'netcat', 'scp']);
const SQL_CLIENTS = new Set(['psql', 'mysql', 'mariadb', 'sqlite3', 'sqlcmd', 'duckdb', 'clickhouse-client', 'cockroach']);
const PUBLISH: Record<string, Set<string>> = {
  npm: new Set(['publish']), yarn: new Set(['publish']), pnpm: new Set(['publish']), bun: new Set(['publish']),
  docker: new Set(['push']), podman: new Set(['push']), terraform: new Set(['apply', 'destroy']), tofu: new Set(['apply', 'destroy']),
  kubectl: new Set(['apply', 'delete', 'replace']), cargo: new Set(['publish']), twine: new Set(['upload']), gem: new Set(['push']),
};

const within = (p: string, dir: string) => {
  const rel = path.relative(dir, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

const opts = (args: Word[]) => args.filter(a => a.text.startsWith('-') && a.text !== '-').map(a => a.text);
const operands = (args: Word[]) => {
  const out: Word[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a.text === '--') { ended = true; continue; }
    if (ended || !a.text.startsWith('-') || a.text === '-') out.push(a);
  }
  return out;
};

/** First non-option argument after git's global options (-C dir, -c k=v, --git-dir=...). */
function gitSub(args: Word[]): { sub: string; rest: Word[] } | undefined {
  let i = 0;
  while (i < args.length && args[i].text.startsWith('-')) i += /^-[Cc]$/.test(args[i].text) ? 2 : 1;
  return i < args.length ? { sub: args[i].text, rest: args.slice(i + 1) } : undefined;
}

/** Process printf/echo -e escapes we care about. */
const unescape = (t: string) => t.replace(/\\(n|t|\\)/g, (_m, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : '\\'));

class Analyzer {
  readonly out: Analysis = { findings: [], targets: [], pieces: [], skipped: [], errors: [], discards: [] };
  private readsSecret: string | undefined;
  private network: string | undefined;

  constructor(private readonly ctx: AnalyzeContext) {}

  private find(category: RawFinding['category'], detail: string, weight = 1): void {
    if (!this.out.findings.some(f => f.category === category && f.detail === detail)) this.out.findings.push({ category, weight, detail });
  }

  private display(abs: string): string {
    const rel = path.relative(this.ctx.workspaceRoot, abs);
    return rel === '' ? '.' : rel.startsWith('..') || path.isAbsolute(rel) ? abs : rel.split(path.sep).join('/');
  }

  /** Absolute path of a word, or undefined when only known at run time. */
  private resolve(w: Word, cwd: string | undefined): string | undefined {
    if (w.dynamic) return undefined;
    if (path.isAbsolute(w.text)) return path.normalize(w.text);
    return cwd === undefined ? undefined : path.resolve(cwd, w.text);
  }

  private where(abs: string): 'workspace' | 'temp' | 'sink' | 'outside' {
    if (SINKS.test(abs)) return 'sink';
    if (within(abs, this.ctx.workspaceRoot)) return 'workspace';
    if (this.ctx.tempDirs.some(t => within(abs, t))) return 'temp';
    return 'outside';
  }

  /** Records a file target; unknown paths → unknown_target. Temp files and sinks are skipped. */
  private target(w: Word, cwd: string | undefined, t: Omit<Target, 'abs'>): void {
    const abs = this.resolve(w, cwd);
    if (abs === undefined) {
      this.find('unknown_target', `${t.form} ${w.text}: target only known when it runs`);
      return;
    }
    if (this.where(globBase(abs)) === 'temp' || this.where(abs) === 'sink') return;
    this.out.targets.push({ abs, ...t, ...(w.glob ? { glob: true } : {}) });
  }

  private rm(s: Simple, cwd: string | undefined): void {
    const flags = opts(s.args);
    const recursive = flags.some(f => /^-[a-zA-Z]*[rR]/.test(f) || f === '--recursive') && s.name === 'rm';
    if (s.xargs) this.find('unknown_target', `xargs ${s.name}: targets come from input`);
    for (const w of operands(s.args)) {
      if (!recursive) { this.target(w, cwd, { kind: 'delete', form: s.name }); continue; }
      const abs = this.resolve(w, cwd);
      if (abs === undefined) {
        this.find('rm_recursive', `deletes ${w.text} recursively`);
        this.find('unknown_target', `rm -r ${w.text}: target only known when it runs`);
        continue;
      }
      const base = globBase(abs);
      const where = this.where(base);
      // The project, home, or a folder containing either: always hard, even when it sits in a temp dir.
      const ancestor = within(this.ctx.workspaceRoot, base) || within(this.ctx.homeDir, base);
      if (!ancestor && (where === 'temp' || where === 'sink')) continue;
      if (where === 'outside' || ancestor) {
        this.find('rm_outside', base === this.ctx.workspaceRoot ? `deletes the whole project (${w.text})` : `deletes ${w.text} recursively, outside the project`);
        continue;
      }
      const rel = this.display(base);
      if (DISPOSABLE_DIRS.has(path.basename(base))) { this.find('rm_recursive', `deletes ${rel} (rebuilt by tools)`, 0); continue; }
      this.find('rm_recursive', `deletes ${this.display(abs)} recursively`);
      this.target(w, cwd, { kind: 'delete', form: 'rm -r' });
    }
  }

  /** In-place editors: sed -i, perl -i, awk -i inplace. Returns true when handled. */
  private inPlace(s: Simple, cwd: string | undefined): void {
    const a = s.args;
    const isI = (t: string) => /^-[A-Za-z]*i(\..*)?$/.test(t) || t.startsWith('--in-place');
    if ((s.name === 'sed' || s.name === 'gsed') && a.some(w => isI(w.text))) {
      const files: Word[] = [];
      let script = false;
      for (let i = 0; i < a.length; i++) {
        const t = a[i].text;
        if (t === '-i' && i + 1 < a.length && (a[i + 1].text === '' || /^\.\w*$/.test(a[i + 1].text))) { i++; continue; } // BSD suffix
        if (t === '-e' || t === '-f' || t === '--expression' || t === '--file') { script = true; i++; continue; }
        if (t.startsWith('--expression=') || t.startsWith('--file=')) { script = true; continue; }
        if (t.startsWith('-') && t !== '-') continue;
        if (!script) { script = true; continue; }
        files.push(a[i]);
      }
      for (const f of files) this.target(f, cwd, { kind: 'edit', form: 'sed -i' });
      return;
    }
    if (s.name === 'perl' && a.some(w => /^-[A-Za-z]*i/.test(w.text))) {
      const files: Word[] = [];
      let script = false;
      for (let i = 0; i < a.length; i++) {
        const t = a[i].text;
        if (/^-[A-Za-z]*[eE]$/.test(t)) { script = true; i++; continue; }
        if (t.startsWith('-')) continue;
        if (!script) { script = true; continue; }
        files.push(a[i]);
      }
      for (const f of files) this.target(f, cwd, { kind: 'edit', form: 'perl -i' });
      return;
    }
    if (/^[gm]?awk$/.test(s.name) && a.some((w, i) => w.text === '-i' && a[i + 1]?.text === 'inplace')) {
      const ops = a.filter((w, i) => !w.text.startsWith('-') && a[i - 1]?.text !== '-i' && a[i - 1]?.text !== '-v');
      for (const f of ops.slice(1)) this.target(f, cwd, { kind: 'edit', form: 'awk -i inplace' });
    }
  }

  /** stdout content of a piece when it is literal: cat of a heredoc, echo / printf of static text. */
  private content(p: Piece, s: Simple): string | undefined {
    const stdin = stdinOf(p);
    if (s.name === 'cat' && operands(s.args).every(w => w.text === '-')) return stdin;
    if (s.name === 'echo') {
      if (s.args.some(w => w.dynamic)) return undefined;
      let i = 0;
      let newline = true;
      let esc = false;
      while (i < s.args.length && /^-[neE]+$/.test(s.args[i].text)) {
        if (s.args[i].text.includes('n')) newline = false;
        if (s.args[i].text.includes('e')) esc = true;
        i++;
      }
      const text = s.args.slice(i).map(w => w.text).join(' ');
      return (esc ? unescape(text) : text) + (newline ? '\n' : '');
    }
    if (s.name === 'printf') {
      if (s.args.length !== 1 || s.args[0].dynamic || /%[^%]/.test(s.args[0].text.replace(/%%/g, ''))) return undefined;
      return unescape(s.args[0].text).replace(/%%/g, '%');
    }
    return undefined;
  }

  private redirects(p: Piece, s: Simple): void {
    const form = s.name ? `${s.name} ` : '';
    for (const r of p.redirects) {
      if (r.op === '<' && r.target && !r.dup) this.read(r.target, p.cwd);
      if ((r.op !== '>' && r.op !== '>>') || r.dup || !r.target) continue;
      if (r.fd !== undefined && r.fd !== 1) { this.target(r.target, p.cwd, { kind: r.op === '>' ? 'overwrite' : 'edit', form: `${form}${r.fd}${r.op}` }); continue; }
      const content = this.content(p, s);
      if (r.op === '>') this.target(r.target, p.cwd, content === undefined ? { kind: 'overwrite', form: `${form}>` } : { kind: 'replace', form: `${form}>`, content });
      else this.target(r.target, p.cwd, content === undefined ? { kind: 'edit', form: `${form}>>` } : { kind: 'append', form: `${form}>>`, content });
    }
  }

  private fileCommands(p: Piece, s: Simple): void {
    const cwd = p.cwd;
    const ops = operands(s.args);
    if (s.xargs && ['mv', 'cp', 'sed', 'perl', 'truncate', 'tee', 'chmod'].includes(s.name)) this.find('unknown_target', `xargs ${s.name}: targets come from input`);
    switch (s.name) {
      case 'rm': case 'rmdir': case 'unlink': this.rm(s, cwd); return;
      case 'mv': case 'cp': {
        const tFlag = s.args.findIndex(w => w.text === '-t');
        const dest = tFlag >= 0 ? s.args[tFlag + 1] : ops[ops.length - 1];
        const srcs = tFlag >= 0 ? ops.filter(w => w !== dest) : ops.slice(0, -1);
        if (!dest || srcs.length === 0) return;
        if (dest.dynamic || (!path.isAbsolute(dest.text) && cwd === undefined)) { this.find('unknown_target', `${s.name} ${dest.text}: target only known when it runs`); return; }
        for (const src of srcs) {
          const from = this.resolve(src, cwd);
          if (s.name === 'cp') { this.read(src, cwd); this.target(dest, cwd, { kind: 'overwrite', form: 'cp', srcBase: path.basename(src.text) }); continue; }
          if (from === undefined) { this.find('unknown_target', `mv ${src.text}: target only known when it runs`); continue; }
          const where = this.where(from);
          if (where === 'workspace' || where === 'outside') this.out.targets.push({ abs: from, kind: 'move', form: 'mv', moveTo: this.resolve(dest, cwd)! });
          else this.target(dest, cwd, { kind: 'overwrite', form: 'mv', srcBase: path.basename(src.text) });
        }
        return;
      }
      case 'truncate': {
        const files = s.args.filter((w, i) => !w.text.startsWith('-') && !['-s', '--size', '-r', '--reference'].includes(s.args[i - 1]?.text ?? ''));
        for (const f of files) this.target(f, cwd, { kind: 'overwrite', form: 'truncate' });
        return;
      }
      case 'dd':
        for (const w of s.args) {
          if (w.text.startsWith('of=')) this.target({ ...w, text: w.text.slice(3) }, cwd, { kind: 'overwrite', form: 'dd' });
          if (w.text.startsWith('if=')) this.read({ ...w, text: w.text.slice(3) }, cwd);
        }
        return;
      case 'tee': {
        const append = opts(s.args).some(f => f === '-a' || f === '--append');
        const stdin = p.pipedFrom ? undefined : stdinOf(p);
        for (const f of ops) {
          if (stdin === undefined) this.target(f, cwd, { kind: append ? 'edit' : 'overwrite', form: append ? 'tee -a' : 'tee' });
          else this.target(f, cwd, { kind: append ? 'append' : 'replace', form: append ? 'tee -a' : 'tee', content: stdin });
        }
        return;
      }
      case 'find':
        if (s.args.some((w, i) => w.text === '-delete' || (/^-(exec|execdir|ok)$/.test(w.text) && s.args[i + 1]?.text === 'rm'))) {
          this.find('rm_recursive', `find … -delete deletes matching files under ${operands(s.args.slice(0, 1))[0]?.text ?? '.'}`);
        }
        return;
      default:
        this.inPlace(s, cwd);
    }
  }

  private read(w: Word, cwd: string | undefined): void {
    const t = w.text.replace(/^[^=@]*=?@/, '').replace(/^@/, '');
    if (w.dynamic || t === '') return;
    if (isSecretsFile(path.basename(t))) this.readsSecret ??= this.display(this.resolve({ ...w, text: t }, cwd ?? this.ctx.workspaceRoot)!);
  }

  private git(s: Simple): void {
    const g = gitSub(s.args);
    if (!g) return;
    const rest = g.rest.map(w => w.text);
    const flags = rest.filter(t => t.startsWith('-'));
    const paths = operands(g.rest);
    if (g.sub === 'reset' && flags.includes('--hard')) this.out.discards.push({ detail: 'git reset --hard discards uncommitted changes', untracked: false });
    if (g.sub === 'clean' && flags.some(f => f === '--force' || /^-[a-zA-Z]*f/.test(f))) this.out.discards.push({ detail: 'git clean deletes untracked files', untracked: true });
    if (g.sub === 'checkout' && (rest.includes('--') && rest.indexOf('--') < rest.length - 1 || paths.some(p => p.text === '.'))) {
      this.out.discards.push({ detail: 'git checkout discards uncommitted changes', untracked: false });
    }
    if (g.sub === 'restore' && paths.length > 0 && (!flags.some(f => f === '--staged' || f === '-S') || flags.some(f => f === '--worktree' || f === '-W'))) {
      this.out.discards.push({ detail: 'git restore discards uncommitted changes', untracked: false });
    }
    if (g.sub === 'push') {
      const force = flags.some(f => f === '--force' || /^-[a-zA-Z]*f/.test(f)) && !flags.some(f => f.startsWith('--force-with-lease'));
      if (force || paths.some(p => p.text.startsWith('+'))) this.find('history_rewrite', 'force-pushes, which can overwrite shared history');
    }
    if (g.sub === 'branch' && (flags.some(f => /^-[a-zA-Z]*D/.test(f)) || (flags.includes('--delete') && flags.includes('--force')))) {
      this.find('history_rewrite', 'force-deletes a branch');
    }
  }

  private categories(p: Piece, s: Simple): void {
    if (s.sudo) this.find('sudo', `runs ${s.name || 'a command'} as root (sudo)`);
    if (SHELLS.has(s.name)) {
      const fromDownload = p.pipedFrom && DOWNLOADERS.test(simplify(p.pipedFrom).name) && operands(s.args).every(w => w.text === '-' || w.text.startsWith('-'));
      const subDownload = s.args.some(w => w.subs.some(b => DOWNLOADERS.test(b)));
      if (fromDownload || subDownload) this.find('pipe_to_shell', `runs a downloaded script with ${s.name}`);
    }
    if (s.name === 'git') this.git(s);
    if (s.name === 'chmod') {
      const broad = s.args.some(w => /^-[a-zA-Z]*R/.test(w.text) || w.text === '--recursive' || /^0?777$|^0?666$|^[ugoa]*[ao][ugoa]*\+[rwx]*w/.test(w.text));
      if (broad) this.find('chmod_broad', `chmod ${s.args.map(w => w.text).join(' ')}`);
    }
    const sub = s.args.find(w => !w.text.startsWith('-'))?.text;
    if (sub && PUBLISH[s.name]?.has(sub)) this.find('publish', `${s.name} ${sub} publishes or deploys outside the project`);
    if (s.name === 'dropdb' || (s.name === 'prisma' && s.args.some(w => w.text === 'reset')) || (/^(rails|rake)$/.test(s.name) && s.args.some(w => /^db:(drop|reset)$/.test(w.text)))) {
      this.find('destructive_sql', `${s.name} ${s.args.map(w => w.text).join(' ')} deletes database data`);
    }
    if (SQL_CLIENTS.has(s.name)) {
      const sql = [...s.args.map(w => w.text), stdinOf(p) ?? ''].join(';');
      const hit = destructiveSql(sql);
      if (hit) this.find('destructive_sql', `${hit} via ${s.name}`);
    }
    if (NETWORK.has(s.name)) this.network ??= s.name;
    if (NETWORK.has(s.name) || ['cat', 'base64', 'gzip', 'tar', 'zip', 'xxd', 'less', 'head', 'tail'].includes(s.name)) for (const w of s.args) this.read(w, p.cwd);
  }

  run(pieces: Piece[]): Analysis {
    const trusted = new Set(this.ctx.trustedCommands.map(t => t.replace(/\s+/g, ' ').trim()));
    const isTrusted = (p: Piece | undefined): boolean => !!p && (trusted.has(p.text.replace(/\s+/g, ' ')) || isTrusted(p.parent));
    for (const p of pieces) {
      if (isTrusted(p)) continue;
      this.out.pieces.push(p.text);
      const s = simplify(p);
      const step = (name: string, kind: 'critical' | 'signal', fn: () => void) => {
        try { fn(); } catch (e) {
          console.error(`[ClineShield] command check ${name} crashed:`, e);
          if (kind === 'critical') this.out.errors.push(`${name} crashed: ${(e as Error)?.message ?? e}`);
          else this.out.skipped.push(`${name}: crashed`);
        }
      };
      step('file_targets', 'critical', () => { this.fileCommands(p, s); this.redirects(p, s); });
      step('command_categories', 'critical', () => this.categories(p, s));
    }
    if (this.readsSecret && this.network) this.find('secret_exfil', `reads ${this.readsSecret} and sends data with ${this.network}`);
    return this.out;
  }
}

/** Heredoc or here-string text fed to a piece. */
function stdinOf(p: Piece): string | undefined {
  for (const r of p.redirects) {
    if (r.op === 'heredoc') return r.body;
    if (r.op === 'herestring' && r.target && !r.target.dynamic) return `${r.target.text}\n`;
  }
  return undefined;
}

/** The path up to the first segment with a glob character. */
function globBase(abs: string): string {
  const parts = abs.split(path.sep);
  const i = parts.findIndex(x => /[*?[]/.test(x));
  return i < 0 ? abs : parts.slice(0, i).join(path.sep) || path.sep;
}

/** First destructive statement: DROP TABLE/DATABASE/SCHEMA, TRUNCATE, DELETE FROM without WHERE. */
export function destructiveSql(sql: string): string | undefined {
  for (const stmt of sql.split(';')) {
    if (/\bdrop\s+(table|database|schema)\b/i.test(stmt)) return 'DROP';
    if (/\btruncate\b/i.test(stmt)) return 'TRUNCATE';
    if (/\bdelete\s+from\b/i.test(stmt) && !/\bwhere\b/i.test(stmt)) return 'DELETE without WHERE';
  }
  return undefined;
}

export function analyze(pieces: Piece[], ctx: AnalyzeContext): Analysis {
  return new Analyzer(ctx).run(pieces);
}
