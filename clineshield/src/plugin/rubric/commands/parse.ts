/**
 * parse.ts
 *
 * Small shell lexer for run_commands (SPEC.md "Risk rubric", Commands). Not a
 * shell interpreter: it tokenizes so that quoted text, heredoc bodies and
 * comments are data, never commands; splits on && ; | || & newlines and
 * parentheses; tracks `cd`; and unwraps one level of `bash|sh|zsh -c` and
 * `$(...)` / backtick bodies. Pure (no I/O). Unbalanced quotes or
 * substitutions throw ParseError (→ on_error).
 */

import * as path from 'path';
import type { CommandEntry } from './normalise';

export class ParseError extends Error {}

export interface Word {
  /** Value after quote removal; known variables ($HOME, $TMPDIR, ~) substituted, other expansions kept as written. */
  text: string;
  /** Contains an expansion only known at run time: $VAR, ${VAR}, $(...), backticks, ~user. */
  dynamic: boolean;
  /** Unquoted * ? [ */
  glob: boolean;
  /** Bodies of $(...), backticks and <(...) / >(...) in this word. */
  subs: string[];
}

export interface Redirect {
  /** `>` also covers `>|`, `&>` and `>&file`; `heredoc` covers `<<` and `<<-`. */
  op: '>' | '>>' | '<' | 'heredoc' | 'herestring';
  fd?: number;
  target?: Word;
  /** fd duplication (`2>&1`, `>&2`): not a file. */
  dup?: boolean;
  /** heredoc body (with trailing newline). */
  body?: string;
}

export interface Piece {
  /** Source text of this simple command, trimmed (trusted_commands, custom rules). */
  text: string;
  words: Word[];
  redirects: Redirect[];
  /** Previous piece of a pipeline (`a | b`: b.pipedFrom = a). */
  pipedFrom?: Piece;
  /** 0 = top level; 1 = inside `bash -c` or a substitution. */
  depth: number;
  /** The piece whose `bash -c` script or substitution this piece came from. */
  parent?: Piece;
  /** Working directory; undefined when unknown (cd to a variable). */
  cwd: string | undefined;
}

export interface ParseEnv { cwd: string; home: string; tmpdir: string }

/** One level of `bash -c` / `$(...)` unwrapping (SPEC). */
const MAX_DEPTH = 1;
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);

type Token =
  | { kind: 'word'; word: Word; start: number; end: number }
  | { kind: 'op'; op: string; start: number; end: number }
  | { kind: 'redir'; redirect: Redirect; start: number; end: number };

const META = /[\s|&;<>()]/;
const word = (text: string): Word => ({ text, dynamic: false, glob: false, subs: [] });

function lex(s: string, env: ParseEnv): Token[] {
  const n = s.length;
  let i = 0;
  const tokens: Token[] = [];
  const pending: Array<{ delim: string; strip: boolean; redirect: Redirect }> = [];

  /** Index just after the `)` matching the `(` at `open`; skips quotes. */
  const closeParen = (open: number): number => {
    let depth = 0;
    for (let j = open; j < n; j++) {
      const ch = s[j];
      if (ch === '\\') { j++; continue; }
      if (ch === "'") { const k = s.indexOf("'", j + 1); if (k < 0) break; j = k; continue; }
      if (ch === '"') {
        let k = j + 1;
        while (k < n && s[k] !== '"') k += s[k] === '\\' ? 2 : 1;
        if (k >= n) break;
        j = k;
        continue;
      }
      if (ch === '(') depth++;
      else if (ch === ')' && --depth === 0) return j + 1;
    }
    throw new ParseError('unbalanced $( or (');
  };

  const known = (name: string): string | undefined => (name === 'HOME' ? env.home : name === 'TMPDIR' ? env.tmpdir : undefined);

  function readWord(): Word {
    const w = word('');
    const start = i;
    const dollar = () => {
      const rest = s.slice(i);
      if (rest.startsWith('$((')) {
        const end = closeParen(i + 1);
        w.dynamic = true; w.text += s.slice(i, end); i = end; return;
      }
      if (rest.startsWith('$(')) {
        const end = closeParen(i + 1);
        w.subs.push(s.slice(i + 2, end - 1)); w.dynamic = true; w.text += s.slice(i, end); i = end; return;
      }
      if (rest.startsWith('${')) {
        const end = s.indexOf('}', i);
        if (end < 0) throw new ParseError('unbalanced ${');
        const name = s.slice(i + 2, end);
        const v = known(name);
        if (v !== undefined) w.text += v; else { w.dynamic = true; w.text += s.slice(i, end + 1); }
        i = end + 1; return;
      }
      if (rest.startsWith("$'")) {
        let k = i + 2;
        while (k < n && s[k] !== "'") k += s[k] === '\\' ? 2 : 1;
        if (k >= n) throw new ParseError("unbalanced $'");
        w.text += s.slice(i + 2, k); i = k + 1; return;
      }
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/.exec(rest);
      if (m) {
        const v = known(m[1]);
        if (v !== undefined) w.text += v; else { w.dynamic = true; w.text += m[0]; }
        i += m[0].length; return;
      }
      w.text += '$'; i++;
    };
    const backtick = () => {
      let k = i + 1;
      while (k < n && s[k] !== '`') k += s[k] === '\\' ? 2 : 1;
      if (k >= n) throw new ParseError('unbalanced backtick');
      w.subs.push(s.slice(i + 1, k)); w.dynamic = true; w.text += s.slice(i, k + 1); i = k + 1;
    };

    while (i < n && !META.test(s[i])) {
      const ch = s[i];
      if (ch === "'") {
        const k = s.indexOf("'", i + 1);
        if (k < 0) throw new ParseError('unbalanced single quote');
        w.text += s.slice(i + 1, k); i = k + 1;
      } else if (ch === '"') {
        i++;
        for (;;) {
          if (i >= n) throw new ParseError('unbalanced double quote');
          const c = s[i];
          if (c === '"') { i++; break; }
          if (c === '\\') {
            const next = s[i + 1];
            if (next === '\n') { i += 2; continue; }
            if (next !== undefined && '$`"\\'.includes(next)) { w.text += next; i += 2; continue; }
            w.text += c; i++; continue;
          }
          if (c === '$') { dollar(); continue; }
          if (c === '`') { backtick(); continue; }
          w.text += c; i++;
        }
      } else if (ch === '\\') {
        if (s[i + 1] === '\n') i += 2;
        else { if (i + 1 < n) w.text += s[i + 1]; i += 2; }
      } else if (ch === '$') {
        dollar();
      } else if (ch === '`') {
        backtick();
      } else if (ch === '~' && i === start) {
        const end = i + 1 >= n || s[i + 1] === '/' || META.test(s[i + 1]);
        if (end) w.text += env.home; else { w.dynamic = true; w.text += '~'; }
        i++;
      } else {
        if (ch === '*' || ch === '?' || ch === '[') w.glob = true;
        w.text += ch; i++;
      }
    }
    return w;
  }

  const skipBlanks = () => { while (i < n && (s[i] === ' ' || s[i] === '\t' || (s[i] === '\\' && s[i + 1] === '\n'))) i += s[i] === '\\' ? 2 : 1; };

  const readHeredocs = () => {
    for (const h of pending) {
      const body: string[] = [];
      while (i < n) {
        let end = s.indexOf('\n', i);
        if (end < 0) end = n;
        const raw = s.slice(i, end);
        const line = h.strip ? raw.replace(/^\t+/, '') : raw;
        i = Math.min(n, end + 1);
        if (line === h.delim) break;
        body.push(line);
      }
      h.redirect.body = body.length ? body.join('\n') + '\n' : '';
    }
    pending.length = 0;
  };

  while (i < n) {
    skipBlanks();
    if (i >= n) break;
    const start = i;
    const ch = s[i];
    const rest = s.slice(i, i + 4);
    if (ch === '#') { while (i < n && s[i] !== '\n') i++; continue; }
    if (ch === '\n') { i++; tokens.push({ kind: 'op', op: '\n', start, end: i }); if (pending.length) readHeredocs(); continue; }
    if ((ch === '<' || ch === '>') && s[i + 1] === '(') {
      const end = closeParen(i + 1);
      tokens.push({ kind: 'word', word: { text: s.slice(i, end), dynamic: true, glob: false, subs: [s.slice(i + 2, end - 1)] }, start, end });
      i = end;
      continue;
    }
    const redir = /^(\d*)(>>|>\||>&|>|<<<|<<-|<<|<&|<>|<)/.exec(s.slice(i, i + 12)) ?? /^()(&>>|&>)/.exec(rest);
    if (redir && (redir[1] === '' || /^\d+[<>]/.test(s.slice(i, i + 12)))) {
      i += redir[0].length;
      const fd = redir[1] ? Number(redir[1]) : undefined;
      const op = redir[2];
      skipBlanks();
      if (i >= n || META.test(s[i])) throw new ParseError(`missing target after ${op}`);
      const targetStart = i;
      const target = readWord();
      let r: Redirect;
      if (op === '<<' || op === '<<-') {
        r = { op: 'heredoc', fd };
        pending.push({ delim: target.text, strip: op === '<<-', redirect: r });
        void targetStart;
      } else if (op === '<<<') {
        r = { op: 'herestring', fd, target };
      } else if (op === '>&' || op === '<&') {
        r = /^(\d+|-)$/.test(target.text) ? { op: op === '>&' ? '>' : '<', fd, target, dup: true } : { op: '>', fd, target };
      } else if (op === '<' || op === '<>') {
        r = { op: '<', fd, target };
      } else {
        r = { op: op === '>>' || op === '&>>' ? '>>' : '>', fd, target };
      }
      tokens.push({ kind: 'redir', redirect: r, start, end: i });
      continue;
    }
    const two = s.slice(i, i + 2);
    if (two === '&&' || two === '||' || two === '|&' || two === ';;') { i += 2; tokens.push({ kind: 'op', op: two, start, end: i }); continue; }
    if ('|;&()'.includes(ch)) { i++; tokens.push({ kind: 'op', op: ch, start, end: i }); continue; }
    const w = readWord();
    if (i === start) { i++; continue; } // defensive: never loop forever
    tokens.push({ kind: 'word', word: w, start, end: i });
  }
  if (pending.length) for (const h of pending) h.redirect.body = '';
  return tokens;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;
const RESERVED = new Set(['if', 'then', 'else', 'elif', 'fi', 'while', 'until', 'do', 'done', 'for', 'case', 'esac', '!', '{', '}', '[[', ']]', 'in']);
/** sudo / doas options that take a value. */
const SUDO_VALUE = new Set(['-u', '-g', '-h', '-p', '-C', '-U', '-r', '-t', '-D', '-R', '-T']);
const XARGS_VALUE = new Set(['-I', '-n', '-P', '-d', '-L', '-s', '-E', '-a']);
const ENV_VALUE = new Set(['-u', '-C', '-S']);

export interface Simple {
  /** Command name: basename, lower-case; '' when the command word is itself dynamic or missing. */
  name: string;
  args: Word[];
  sudo: boolean;
  /** Run through xargs: more arguments come from input. */
  xargs: boolean;
}

const baseName = (w: Word) => (w.dynamic ? '' : (w.text.split('/').pop() ?? w.text).toLowerCase());

/** Strips assignments, reserved words and wrappers (sudo, env, nohup, time, nice, timeout, command, exec, xargs). */
export function simplify(p: Piece): Simple {
  const w = p.words;
  let k = 0;
  let sudo = false;
  let xargs = false;
  const skipOpts = (valued: Set<string>) => {
    while (k < w.length && w[k].text.startsWith('-') && w[k].text !== '-') {
      if (w[k].text === '--') { k++; break; }
      k += valued.has(w[k].text) ? 2 : 1;
    }
  };
  for (;;) {
    while (k < w.length && (ASSIGNMENT.test(w[k].text) || RESERVED.has(w[k].text))) k++;
    if (k >= w.length) return { name: '', args: [], sudo, xargs };
    const name = baseName(w[k]);
    if (name === 'sudo' || name === 'doas') { sudo = true; k++; skipOpts(SUDO_VALUE); continue; }
    if (name === 'env') { k++; skipOpts(ENV_VALUE); continue; }
    if (name === 'xargs') { xargs = true; k++; skipOpts(XARGS_VALUE); continue; }
    if (name === 'nohup' || name === 'command' || name === 'exec' || name === 'builtin') { k++; skipOpts(new Set()); continue; }
    if (name === 'time') { k++; skipOpts(new Set()); continue; }
    if (name === 'nice') { k++; skipOpts(new Set(['-n'])); continue; }
    if (name === 'timeout') { k++; skipOpts(new Set(['-s', '-k'])); if (k < w.length && /^\d/.test(w[k].text)) k++; continue; }
    return { name, args: w.slice(k + 1), sudo, xargs };
  }
}

function shellScript(s: Simple): Word | undefined {
  if (!SHELLS.has(s.name)) return undefined;
  for (let j = 0; j < s.args.length; j++) {
    const t = s.args[j].text;
    if (!t.startsWith('-')) return undefined;
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(t)) return s.args.slice(j + 1).find(a => !a.text.startsWith('-'));
  }
  return undefined;
}

function piecesOf(tokens: Token[], src: string, depth: number): Piece[] {
  const out: Piece[] = [];
  let cur: { words: Word[]; redirects: Redirect[]; start: number; end: number } | undefined;
  let pipe = false;
  const finish = () => {
    if (cur && (cur.redirects.length || cur.words.some(w => !RESERVED.has(w.text)))) {
      const piece: Piece = { text: src.slice(cur.start, cur.end).trim(), words: cur.words, redirects: cur.redirects, depth, cwd: undefined };
      if (pipe && out.length) piece.pipedFrom = out[out.length - 1];
      out.push(piece);
    }
    cur = undefined;
  };
  for (const t of tokens) {
    if (t.kind === 'op') {
      finish();
      pipe = t.op === '|' || t.op === '|&';
      continue;
    }
    cur ??= { words: [], redirects: [], start: t.start, end: t.end };
    cur.end = t.end;
    if (t.kind === 'word') cur.words.push(t.word); else cur.redirects.push(t.redirect);
  }
  finish();
  return out;
}

function cdTarget(s: Simple, cwd: string | undefined, env: ParseEnv): string | undefined | null {
  if (s.name !== 'cd' && s.name !== 'pushd') return null; // not a cd
  const arg = s.args.find(a => !a.text.startsWith('-') || a.text === '-');
  if (!arg) return env.home;
  if (arg.dynamic || arg.text === '-') return undefined;
  if (path.isAbsolute(arg.text)) return path.normalize(arg.text);
  return cwd === undefined ? undefined : path.resolve(cwd, arg.text);
}

function parseShell(src: string, env: ParseEnv, cwd: string | undefined, depth: number, parent?: Piece): Piece[] {
  const pieces = piecesOf(lex(src, env), src, depth);
  const out: Piece[] = [];
  let dir = cwd;
  for (const p of pieces) {
    p.cwd = dir;
    if (parent) p.parent = parent;
    out.push(p);
    const s = simplify(p);
    if (depth < MAX_DEPTH) {
      const script = shellScript(s);
      if (script && !script.dynamic) out.push(...parseShell(script.text, env, dir, depth + 1, p));
      const subs = [...p.words, ...p.redirects.map(r => r.target).filter((x): x is Word => !!x)].flatMap(x => x.subs);
      for (const body of subs) out.push(...parseShell(body, env, dir, depth + 1, p));
    }
    const next = cdTarget(s, dir, env);
    if (next !== null) dir = next;
  }
  return out;
}

const shellQuote = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);

/** Display text of an entry (argv joined with shell quoting). */
export function entryText(e: CommandEntry): string {
  return 'shell' in e ? e.shell : e.argv.map(shellQuote).join(' ');
}

/** All pieces of all entries, in order. Each entry starts in env.cwd. Throws ParseError. */
export function parseEntries(entries: CommandEntry[], env: ParseEnv): Piece[] {
  const out: Piece[] = [];
  for (const e of entries) {
    if ('shell' in e) {
      out.push(...parseShell(e.shell, env, env.cwd, 0));
      continue;
    }
    // argv: no shell parsing; every argument is one literal word.
    const words = e.argv.map(word);
    const piece: Piece = { text: entryText(e), words, redirects: [], depth: 0, cwd: env.cwd };
    out.push(piece);
    const script = shellScript(simplify(piece));
    if (script) out.push(...parseShell(script.text, env, env.cwd, 1, piece));
  }
  return out;
}
