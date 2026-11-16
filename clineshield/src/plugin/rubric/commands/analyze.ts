/**
 * analyze.ts
 *
 * Parsed run_commands pieces → command-level findings (SPEC.md "Risk rubric",
 * Commands) and the files the commands change (targets), which gather.ts
 * turns into FileChanges for the per-file checks. Pure (no I/O): anything
 * that needs git (discards_work) is returned for the caller to finish.
 */

import * as path from 'path';
import { REGISTRY_ENV, isPublicRegistry, parseInstall, registryHost } from '../deps/extract';
import { isSecretsFile } from '../paths';
import type { PackageInstall, RawFinding } from '../types';
import { simplify } from './parse';
import type { Piece, Redirect, Simple, Word } from './parse';

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
  /** Package installs, for the registry and lookalike checks (rubric/deps). */
  installs: PackageInstall[];
}

/** Folders that are rebuilt, not lost: rm_recursive = 0 and not scored as file deletes. */
export const DISPOSABLE_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', 'target', 'coverage', '__pycache__',
  '.pytest_cache', '.mypy_cache', '.turbo', '.cache', '.parcel-cache',
]);
const INLINE_REGISTRY_ENV = new Set([...REGISTRY_ENV.npm, ...REGISTRY_ENV.pypi]);
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
  readonly out: Analysis = { findings: [], targets: [], pieces: [], skipped: [], errors: [], discards: [], installs: [] };
  private readsSecret: string | undefined;
  private network: string | undefined;
  /** Shell variables set in this command: literal value when set exactly once by a plain `NAME=literal`. */
  private vars = new Map<string, { value?: string; at: number }>();
  /** Variables filled by `read` from a listing of workspace files (grep -l, find, git ls-files): the listed roots. */
  private listed = new Map<string, string[]>();
  private index = 0;

  constructor(private readonly ctx: AnalyzeContext) {}

  /** Records every way a variable gets set; only a single plain literal assignment keeps its value. */
  private collectVars(pieces: Piece[]): void {
    const seen = new Map<string, { value?: string; at: number; count: number }>();
    const set = (name: string, at: number, value?: string) => {
      const prev = seen.get(name);
      seen.set(name, { value, at, count: (prev?.count ?? 0) + 1 });
    };
    pieces.forEach((p, at) => {
      const s = simplify(p);
      const first = p.words.findIndex(w => !RESERVED_WORDS.has(w.text));
      if (p.words[0]?.text === 'for' && p.words[1]) set(p.words[1].text, at);
      if (s.name === 'read') for (const w of operands(s.args)) set(w.text, at);
      if (s.name === 'unset') for (const w of operands(s.args)) set(w.text, at);
      const declare = DECLARERS.has(s.name);
      if (s.name !== '' && !declare) return;
      const words = s.name === '' ? p.words.slice(Math.max(first, 0)) : s.args;
      for (const w of words) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)(\+?)=([\s\S]*)$/.exec(w.text);
        if (!m) { if (s.name === '') break; continue; } // a plain piece: only its leading NAME=value words assign
        set(m[1], at, m[2] || w.dynamic ? undefined : m[3]);
      }
    });
    for (const [name, v] of seen) this.vars.set(name, { value: v.count === 1 ? v.value : undefined, at: v.at });
  }

  /** A word with variables set literally earlier in this command filled in; unchanged when anything stays unknown. */
  private fill(w: Word): Word {
    if (!w.dynamic || w.subs.length > 0 || w.text.includes('`')) return w;
    let unknown = false;
    const text = w.text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, a?: string, b?: string) => {
      const v = this.vars.get((a ?? b)!);
      if (v?.value === undefined || v.at >= this.index) { unknown = true; return m; }
      return v.value;
    });
    return unknown || text.includes('$') ? w : { ...w, text, dynamic: false };
  }

  private filled(p: Piece): Piece {
    if (!p.words.some(w => w.dynamic) && !p.redirects.some(r => r.target?.dynamic)) return p;
    const redirects: Redirect[] = p.redirects.map(r => (r.target ? { ...r, target: this.fill(r.target) } : r));
    return { ...p, words: p.words.map(w => this.fill(w)), redirects };
  }

  /** Why a dynamic target can't be checked, in words that are true for this command. */
  private unknownWhy(w: Word): string {
    const names = [...w.text.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]);
    if (w.subs.length > 0 || w.text.includes('`') || names.length === 0) return 'target only known when it runs';
    if (names.some(n => this.vars.has(n))) return 'target is set by this command from a value only known when it runs';
    return 'target comes from a variable set outside this command';
  }

  /** Workspace roots a listing command (grep -l, rg -l/--files, git ls-files / grep -l, find without actions) prints files under. */
  private listingRoots(p: Piece): string[] | undefined {
    const q = this.filled(p);
    const s = simplify(q);
    const a = s.args;
    let roots: Word[] | undefined;
    if (s.name === 'grep' || s.name === 'rg' || s.name === 'egrep') {
      const lists = a.some(w => /^-[a-zA-Z]*[lL][a-zA-Z]*$/.test(w.text) || /^--files(-with(out)?-match(es)?)?$/.test(w.text));
      if (!lists) return undefined;
      const files = s.name === 'rg' && a.some(w => w.text === '--files');
      const explicit = a.some(w => /^(-e|-f|--regexp|--file)(=|$)/.test(w.text));
      const ops: Word[] = [];
      for (let i = 0; i < a.length; i++) {
        const t = a[i].text;
        if (t === '--') { ops.push(...a.slice(i + 1)); break; }
        if (GREP_VALUE.has(t)) { i++; continue; }
        if (t.startsWith('-') && t !== '-') continue;
        ops.push(a[i]);
      }
      roots = files || explicit ? ops : ops.slice(1);
    } else if (s.name === 'git') {
      const g = gitSub(a);
      if (!g || !(g.sub === 'ls-files' || (g.sub === 'grep' && g.rest.some(w => /^-[a-zA-Z]*l/.test(w.text) || w.text === '--files-with-matches')))) return undefined;
      roots = [];
    } else if (s.name === 'find') {
      if (a.some(w => /^-(delete|exec|execdir|ok|okdir|fprint\w*)$/.test(w.text))) return undefined;
      roots = findRoots(a);
    } else {
      return undefined;
    }
    const words = roots.length ? roots : [{ text: '.', dynamic: false, glob: false, subs: [] }];
    const abs: string[] = [];
    for (const w of words) {
      const x = this.resolve(w, q.cwd);
      if (x === undefined || this.where(globBase(x)) !== 'workspace') return undefined;
      abs.push(globBase(x));
    }
    return abs.filter((x, i) => !abs.some((y, j) => j !== i && within(x, y) && (x !== y || j < i)));
  }

  /** Glob edit targets for in-place edits over listed workspace files. */
  private listedTargets(roots: string[], form: string): void {
    for (const abs of roots) this.out.targets.push({ abs, kind: 'edit', form, glob: true });
  }

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
      const v = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(w.text);
      const roots = v && t.kind === 'edit' ? this.listed.get(v[1]) : undefined;
      if (roots) { this.listedTargets(roots, t.form); return; }
      this.find('unknown_target', `${t.form} ${w.text}: ${this.unknownWhy(w)}`);
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
        this.find('unknown_target', `rm -r ${w.text}: ${this.unknownWhy(w)}`);
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

  /** find … -delete / -exec rm: like rm -r of each start folder; a name/time/size filter narrows it from "everything". */
  private findDelete(s: Simple, cwd: string | undefined): void {
    const roots = findRoots(s.args);
    const narrowed = s.args.some(w => FIND_NARROWING.test(w.text));
    for (const w of roots.length ? roots : [{ text: '.', dynamic: false, glob: false, subs: [] } as Word]) {
      const abs = this.resolve(w, cwd);
      if (abs === undefined) {
        this.find('rm_recursive', `find … -delete deletes files under ${w.text}`);
        this.find('unknown_target', `find ${w.text} -delete: ${w.dynamic ? this.unknownWhy(w) : 'target only known when it runs'}`);
        continue;
      }
      const base = globBase(abs);
      const where = this.where(base);
      const ancestor = !narrowed && (within(this.ctx.workspaceRoot, base) || within(this.ctx.homeDir, base));
      if (!ancestor && (where === 'temp' || where === 'sink')) continue;
      if (where === 'outside' || ancestor) {
        this.find('rm_outside', base === this.ctx.workspaceRoot ? `find … -delete empties the whole project (${w.text})` : `find … -delete deletes files under ${w.text}, outside the project`);
        continue;
      }
      if (DISPOSABLE_DIRS.has(path.basename(base))) { this.find('rm_recursive', `deletes files in ${this.display(base)} (rebuilt by tools)`, 0); continue; }
      this.find('rm_recursive', `find … -delete deletes matching files under ${this.display(base)}`);
    }
  }

  /** Files a python / node script writes (heredoc, -c, -e): name-only edits, like an editor write to the same path. */
  private interpreter(p: Piece, s: Simple): void {
    const lang = /^python(3(\.\d+)?)?$/.test(s.name) ? 'py' : s.name === 'node' ? 'js' : undefined;
    if (!lang) return;
    let code: string | undefined;
    let form = '';
    const flag = s.args.findIndex(w => (lang === 'py' ? w.text === '-c' : /^(-e|--eval|-p|--print)$/.test(w.text)));
    if (flag >= 0 && s.args[flag + 1] && !s.args[flag + 1].dynamic) { code = s.args[flag + 1].text; form = `${s.name} ${s.args[flag].text}`; }
    else if (flag < 0) {
      const ops = operands(s.args);
      if (ops.length === 0 || ops[0].text === '-') { code = stdinOf(p); form = `${s.name} heredoc`; }
    }
    if (!code) return;
    for (const w of scriptWrites(code, lang)) {
      if (w === undefined) this.find('unknown_target', `${form}: writes to a path only known when it runs`);
      else this.target({ text: w, dynamic: false, glob: false, subs: [] }, p.cwd, { kind: 'edit', form });
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
    if (s.xargs && ['mv', 'cp', 'sed', 'perl', 'truncate', 'tee', 'chmod'].includes(s.name)) {
      const form = inPlaceForm(s);
      const roots = form && p.pipedFrom ? this.listingRoots(p.pipedFrom) : undefined;
      if (form && roots) { this.listedTargets(roots, form); return; }
      this.find('unknown_target', `xargs ${s.name}: targets come from input`);
    }
    switch (s.name) {
      case 'rm': case 'rmdir': case 'unlink': this.rm(s, cwd); return;
      case 'mv': case 'cp': {
        const tFlag = s.args.findIndex(w => w.text === '-t');
        const dest = tFlag >= 0 ? s.args[tFlag + 1] : ops[ops.length - 1];
        const srcs = tFlag >= 0 ? ops.filter(w => w !== dest) : ops.slice(0, -1);
        if (!dest || srcs.length === 0) return;
        if (dest.dynamic || (!path.isAbsolute(dest.text) && cwd === undefined)) { this.find('unknown_target', `${s.name} ${dest.text}: ${dest.dynamic ? this.unknownWhy(dest) : 'target only known when it runs'}`); return; }
        for (const src of srcs) {
          const from = this.resolve(src, cwd);
          if (s.name === 'cp') { this.read(src, cwd); this.target(dest, cwd, { kind: 'overwrite', form: 'cp', srcBase: path.basename(src.text) }); continue; }
          if (from === undefined) { this.find('unknown_target', `mv ${src.text}: ${src.dynamic ? this.unknownWhy(src) : 'target only known when it runs'}`); continue; }
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
        if (s.args.some((w, i) => w.text === '-delete' || (/^-(exec|execdir|ok)$/.test(w.text) && s.args[i + 1]?.text === 'rm'))) this.findDelete(s, cwd);
        return;
      case 'read':
        // `… | while read f`: f names files listed under the workspace roots (in-place edits only).
        if (p.pipedFrom) {
          const roots = this.listingRoots(p.pipedFrom);
          if (roots) for (const w of operands(s.args)) this.listed.set(w.text, roots);
        }
        return;
      default:
        this.inPlace(s, cwd);
        this.interpreter(p, s);
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
      // A lease only guards against pushes made since the last fetch; it still replaces commits already on the remote.
      const force = flags.some(f => f === '--force' || /^-[a-zA-Z]*f/.test(f) || f.startsWith('--force-with-lease'));
      if (force || paths.some(p => p.text.startsWith('+'))) this.find('history_rewrite', 'force-pushes, replacing commits already on the remote');
    }
    if (g.sub === 'branch' && (flags.some(f => /^-[a-zA-Z]*D/.test(f)) || (flags.includes('--delete') && flags.includes('--force')))) {
      this.find('history_rewrite', 'force-deletes a branch');
    }
  }

  private installs(p: Piece, s: Simple): void {
    const install = parseInstall(s);
    if (!install) return;
    const inline = p.words.flatMap(w => {
      const m = /^([A-Za-z_]+)=(.*)$/.exec(w.text);
      return m && INLINE_REGISTRY_ENV.has(m[1]) && !isPublicRegistry(m[2]) ? [m[2]] : [];
    });
    install.registries.push(...inline);
    for (const url of install.registries) this.find('dep_new_registry', `${s.name} installs from ${registryHost(url)}`);
    if (install.refs.length > 0) this.out.installs.push({ refs: install.refs, cwd: p.cwd, ownRegistry: install.registries.length > 0 });
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
    this.collectVars(pieces);
    for (const [at, raw] of pieces.entries()) {
      this.index = at;
      if (isTrusted(raw)) continue;
      this.out.pieces.push(raw.text);
      const p = this.filled(raw);
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
      step('dep_new_registry', 'critical', () => this.installs(p, s));
    }
    if (this.readsSecret && this.network) this.find('secret_exfil', `reads ${this.readsSecret} and sends data with ${this.network}`);
    return this.out;
  }
}

const RESERVED_WORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'while', 'until', 'do', 'done', 'for', 'case', 'esac', '!', '{', '}', '[[', ']]', 'in']);
const DECLARERS = new Set(['export', 'local', 'declare', 'typeset', 'readonly']);
const GREP_VALUE = new Set(['-e', '-f', '-m', '-A', '-B', '-C', '-d', '-D', '--regexp', '--file', '--max-count', '-g', '--glob', '-t', '--type', '-T', '--type-not']);
/** find tests that pick some files, so `find . <test> -delete` is not "delete everything". -type alone does not narrow. */
const FIND_NARROWING = /^-(i?name|i?path|i?wholename|i?regex|i?lname|newer\w*|[amc](time|min|newer)|size|empty|perm|user|group|nouser|nogroup|links|inum|samefile|used)$/;

/** find's start folders: arguments before the first expression token. */
function findRoots(args: Word[]): Word[] {
  const out: Word[] = [];
  for (const w of args) {
    if (/^-[HLP]$/.test(w.text) && out.length === 0) continue;
    if (w.text.startsWith('-') || w.text === '(' || w.text === '!') break;
    out.push(w);
  }
  return out;
}

/** "sed -i" / "perl -i" when the command edits files in place, else undefined. */
function inPlaceForm(s: Simple): string | undefined {
  if ((s.name === 'sed' || s.name === 'gsed') && s.args.some(w => /^-[A-Za-z]*i(\..*)?$/.test(w.text) || w.text.startsWith('--in-place'))) return 'sed -i';
  if (s.name === 'perl' && s.args.some(w => /^-[A-Za-z]*i/.test(w.text))) return 'perl -i';
  return undefined;
}

const STR = String.raw`(['"])([^'"\n]*)\1`;
const ARG = String.raw`(?:${STR}|([A-Za-z_][A-Za-z0-9_]*)|([^,)]+))`;
const WRITES: Record<'py' | 'js', RegExp[]> = {
  py: [
    new RegExp(String.raw`\bopen\(\s*${ARG}\s*,\s*(?:mode\s*=\s*)?['"][^'"]*[wax+]`, 'g'),
    new RegExp(String.raw`\bPath\(\s*${ARG}\s*\)\s*\.\s*write_(?:text|bytes)\(`, 'g'),
  ],
  js: [new RegExp(String.raw`\b(?:writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream)\(\s*${ARG}`, 'g')],
};

/**
 * Paths a short python / node script writes, in order; undefined for a write whose path is computed.
 * A bare name resolves to its last simple string assignment (`p = 'src/a.js'`) before the write.
 */
export function scriptWrites(code: string, lang: 'py' | 'js'): Array<string | undefined> {
  const assigns = [...code.matchAll(new RegExp(String.raw`(?:^|[\n;])\s*(?:const\s+|let\s+|var\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(['"])([^'"\n]*)\2`, 'gm'))]
    .map(m => ({ name: m[1], value: m[3], at: m.index ?? 0 }));
  const hits: Array<{ at: number; path: string | undefined }> = [];
  for (const re of WRITES[lang]) {
    for (const m of code.matchAll(re)) {
      const at = m.index ?? 0;
      if (m[2] !== undefined) { hits.push({ at, path: m[2] }); continue; }
      if (m[3] !== undefined) {
        const a = assigns.filter(x => x.name === m[3] && x.at < at).pop();
        hits.push({ at, path: a?.value });
        continue;
      }
      hits.push({ at, path: undefined });
    }
  }
  return hits.sort((x, y) => x.at - y.at).map(h => h.path);
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
