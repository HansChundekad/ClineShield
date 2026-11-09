/**
 * extract.ts
 *
 * Which packages an action newly adds, and which non-public registries it
 * introduces (SPEC.md "Risk rubric", Dependencies). Pure.
 */

import * as path from 'path';
import { applyOperation } from '../../patch';
import type { Simple, Word } from '../commands/parse';
import type { FileChange } from '../types';

export type Ecosystem = 'npm' | 'pypi';
export interface DepRef { ecosystem: Ecosystem; name: string }

export const refKey = (r: DepRef) => `${r.ecosystem}:${r.name}`;
export const normalisePypi = (n: string) => n.toLowerCase().replace(/[-_.]+/g, '-');

const PUBLIC_HOSTS = new Set(['registry.npmjs.org', 'registry.yarnpkg.com', 'pypi.org', 'pypi.python.org', 'files.pythonhosted.org']);

export function isPublicRegistry(url: string): boolean {
  try { return PUBLIC_HOSTS.has(new URL(url).hostname); } catch { return false; }
}

/** Host only: registry URLs can carry credentials, and this text reaches logs and Cline. */
export function registryHost(url: string): string {
  try { return new URL(url).hostname; } catch { return 'an unrecognised registry'; }
}

const npmRef = (name: string): DepRef => ({ ecosystem: 'npm', name });
const pypiRef = (name: string): DepRef => ({ ecosystem: 'pypi', name: normalisePypi(name) });

const NPM_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
/** package.json keys with version-like values that are not packages (added-line fallback). */
const NPM_NON_PACKAGES = new Set(['version', 'node', 'npm', 'yarn', 'pnpm', 'bun']);
const LOCAL_SPEC = /^(file:|link:|workspace:|portal:|git[+:]|github:|https?:|ssh:)/;
const VERSION_LIKE = /^(?:[\^~<>=*]|\d|v\d|latest$|next$)/;

/** Real package behind a package.json version value, or undefined for local/git specs. */
function npmSpec(name: string, spec: string): DepRef | undefined {
  if (spec.startsWith('npm:')) return npmRef(spec.slice(4).replace(/(?!^)@.*$/, ''));
  if (LOCAL_SPEC.test(spec) || spec.includes('/')) return undefined;
  return npmRef(name);
}

function packageJsonNames(text: string): DepRef[] | undefined {
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return undefined; }
  if (typeof doc !== 'object' || doc === null) return undefined;
  const out: DepRef[] = [];
  for (const section of NPM_SECTIONS) {
    const deps = (doc as Record<string, unknown>)[section];
    if (typeof deps !== 'object' || deps === null) continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec !== 'string') continue;
      const ref = npmSpec(name, spec);
      if (ref) out.push(ref);
    }
  }
  return out;
}

/** PEP 508 requirement → name; undefined for options, paths, URLs and direct references. */
function pep508Name(raw: string): string | undefined {
  const line = raw.replace(/\s+#.*$/, '').trim();
  if (!line || line.endsWith('/') || /^[#\-./~]/.test(line) || line.includes('://') || /\.(whl|tar\.gz|zip)$/.test(line)) return undefined;
  const m = /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*(.*)$/.exec(line);
  if (!m || m[2].replace(/^\[[^\]]*\]\s*/, '').startsWith('@')) return undefined;
  return m[1];
}

function requirementsNames(text: string): DepRef[] {
  return text.split(/\r?\n/).map(pep508Name).filter((n): n is string => !!n).map(pypiRef);
}

const ARRAY_SECTIONS = /^(project\.optional-dependencies|dependency-groups)$/;
const POETRY_SECTION = /^tool\.poetry\.(?:group\.[^.]+\.)?(?:dev-)?dependencies$/;
/** A `]` outside quotes: extras like "pkg[x]" don't end a TOML array. */
const closesArray = (s: string) => s.replace(/"[^"]*"|'[^']*'/g, '').includes(']');

function pyprojectNames(text: string): DepRef[] {
  const out: DepRef[] = [];
  let section = '';
  let inArray = false;
  const quoted = (s: string) => {
    for (const m of s.replace(/\{[^}]*\}/g, '').matchAll(/["']([^"']+)["']/g)) {
      const n = pep508Name(m[1]);
      if (n) out.push(pypiRef(n));
    }
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;
    if (inArray) {
      quoted(line);
      if (closesArray(line)) inArray = false;
      continue;
    }
    const head = /^\[+([^\]]+)\]+$/.exec(line);
    if (head) { section = head[1].trim(); continue; }
    const kv = /^(["']?)([A-Za-z0-9._-]+)\1\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    if (POETRY_SECTION.test(section)) {
      if (kv[2].toLowerCase() !== 'python' && !/\b(path|git|url)\s*=/.test(kv[3])) out.push(pypiRef(kv[2]));
    } else if ((section === 'project' && kv[2] === 'dependencies') || ARRAY_SECTIONS.test(section)) {
      if (!kv[3].startsWith('[')) continue;
      quoted(kv[3]);
      inArray = !closesArray(kv[3]);
    }
  }
  return out;
}

type Kind = 'package' | 'requirements' | 'pyproject';
function manifestKind(file: string): Kind | undefined {
  const b = path.posix.basename(file);
  if (b === 'package.json') return 'package';
  if (b === 'pyproject.toml') return 'pyproject';
  return /^requirements.*\.txt$/.test(b) ? 'requirements' : undefined;
}

/** Packages a supported manifest lists; undefined for other files and unparseable JSON. */
export function manifestNames(file: string, text: string): DepRef[] | undefined {
  switch (manifestKind(file)) {
    case 'package': return packageJsonNames(text);
    case 'requirements': return requirementsNames(text);
    case 'pyproject': return pyprojectNames(text);
    default: return undefined;
  }
}

function subtract(after: DepRef[], before: DepRef[]): DepRef[] {
  const had = new Set(before.map(refKey));
  const seen = new Set<string>();
  return after.filter(r => { const k = refKey(r); if (had.has(k) || seen.has(k)) return false; seen.add(k); return true; });
}

/** Line-based view for when the whole file can't be compared. */
function lineNames(kind: Kind, lines: string[]): DepRef[] {
  if (kind === 'requirements') return requirementsNames(lines.join('\n'));
  if (kind === 'pyproject') return []; // Sections are unknown from isolated lines.
  const out: DepRef[] = [];
  for (const line of lines) {
    const m = /^\s*"([^"]+)"\s*:\s*"([^"]+)"/.exec(line);
    if (!m || NPM_NON_PACKAGES.has(m[1]) || !(VERSION_LIKE.test(m[2]) || m[2].startsWith('npm:'))) continue;
    const ref = npmSpec(m[1], m[2]);
    if (ref) out.push(ref);
  }
  return out;
}

/** Packages this change newly adds to a supported manifest. */
export function addedFromChange(c: FileChange): DepRef[] {
  const kind = manifestKind(c.path);
  if (!kind || c.kind === 'delete' || c.binary) return [];
  const base = c.original ?? (c.kind === 'add' ? '' : undefined);
  if (base !== undefined) {
    const applied = applyOperation(base, c.op);
    if (applied.ok) {
      const before = base === '' ? [] : manifestNames(c.path, base);
      const after = manifestNames(c.path, applied.text);
      if (before && after) return subtract(after, before);
    }
  }
  return subtract(lineNames(kind, c.added), lineNames(kind, c.removed));
}

const TOML_URL = String.raw`\s*=\s*["']?([^"'\s]+)`;
/** Header lines stand for a registry whose URL is on a later line. */
const REGISTRY_LINES: Array<[RegExp, RegExp]> = [
  [/^\.npmrc$/, /^\s*(?:@[^:\s]+:)?registry\s*=\s*(\S+)/],
  [/^\.yarnrc\.yml$/, /^\s*npmRegistryServer:\s*["']?([^"'\s]+)/],
  [/^\.yarnrc$/, /^\s*registry\s+["']?([^"'\s]+)/],
  [/^bunfig\.toml$/, new RegExp(`^\\s*registry${TOML_URL}`)],
  [/^pip\.(?:conf|ini)$/, /^\s*(?:extra-)?index-url\s*=\s*(\S+)/],
  [/^requirements.*\.txt$/, /^\s*(?:-i|--index-url|--extra-index-url)[\s=]+(\S+)/],
  [/^uv\.toml$/, new RegExp(`^\\s*(?:(?:extra-)?index-url|default-index)${TOML_URL}`)],
  [/^uv\.toml$/, /^\s*(\[\[index\]\])/],
  [/^pyproject\.toml$/, /^\s*(\[\[tool\.(?:uv\.index|poetry\.source|pdm\.source)\]\])/],
];

/** Non-public registries named by these lines of `file`. */
export function registriesIn(file: string, lines: string[]): string[] {
  const b = path.posix.basename(file);
  return REGISTRY_LINES.filter(([f]) => f.test(b)).flatMap(([, re]) =>
    lines.map(l => re.exec(l)?.[1]).filter((u): u is string => !!u && !isPublicRegistry(u)));
}

export const addedRegistries = (c: FileChange): string[] => registriesIn(c.path, c.added);

/** Environment variables that set the default registry. */
export const REGISTRY_ENV: Record<Ecosystem, string[]> = {
  npm: ['NPM_CONFIG_REGISTRY', 'npm_config_registry', 'YARN_NPM_REGISTRY_SERVER', 'BUN_CONFIG_REGISTRY'],
  pypi: ['PIP_INDEX_URL', 'PIP_EXTRA_INDEX_URL', 'UV_INDEX_URL', 'UV_DEFAULT_INDEX', 'UV_EXTRA_INDEX_URL', 'UV_INDEX'],
};

const NPM_COMMON = ['--registry', '--prefix', '--tag', '--cache', '--userconfig', '--omit', '--include', '--loglevel', '--install-strategy', '--save-prefix', '--workspace', '--location', '--before'];
const NPM_MANAGERS: Record<string, { subs: Set<string>; value: Set<string> }> = {
  npm: { subs: new Set(['install', 'i', 'in', 'ins', 'inst', 'add']), value: new Set([...NPM_COMMON, '-w']) },
  pnpm: { subs: new Set(['add', 'install', 'i']), value: new Set([...NPM_COMMON, '--filter', '-F', '--dir', '-C', '--store-dir', '--reporter']) },
  yarn: { subs: new Set(['add']), value: new Set([...NPM_COMMON, '--cwd', '--cache-folder', '--modules-folder', '--network-timeout']) },
  bun: { subs: new Set(['add', 'a', 'install', 'i']), value: new Set([...NPM_COMMON, '--cwd', '--cache-dir', '--backend', '--config', '-c']) },
};
const PIP_VALUE = new Set([
  '-i', '--index-url', '--extra-index-url', '-r', '--requirement', '-c', '--constraint', '-e', '--editable', '-t', '--target',
  '--prefix', '--root', '-f', '--find-links', '--trusted-host', '--proxy', '--timeout', '--retries', '--cache-dir', '--python', '--platform',
  '--implementation', '--abi', '--python-version', '--src', '--no-binary', '--only-binary', '--upgrade-strategy', '--progress-bar',
  '--root-user-action', '--cert', '--client-cert', '--log', '--exists-action', '-C', '--config-settings', '--report',
  '--group', '-G', '--optional', '--project', '--directory', '--index', '--default-index', '--source',
]);
const NPM_REGISTRY = new Set(['--registry']);
const PIP_REGISTRY = new Set(['-i', '--index-url', '--extra-index-url', '--index', '--default-index']);
/** Python tools whose install word and version syntax differ from pip's. */
const PY_TOOLS: Record<string, string> = { poetry: 'add', pdm: 'add', pipx: 'install' };

function npmWord(w: Word): DepRef | undefined {
  const t = w.text;
  if (w.dynamic || w.glob || !t || /^[./~]/.test(t) || t.includes('://') || /\.(tgz|tar\.gz)$/.test(t)) return undefined;
  const alias = /^(?:@[^/]+\/)?[^@]+@npm:(.+)$/.exec(t);
  if (alias) return npmRef(alias[1].replace(/(?!^)@.*$/, ''));
  if (t.includes(':')) return undefined; // file:, github:, git@host:owner/repo
  const name = t.replace(/(?!^)@.*$/, '');
  if (name.includes('/') && !name.startsWith('@')) return undefined;
  return npmRef(name);
}

function pipWord(w: Word): DepRef | undefined {
  if (w.dynamic || w.glob) return undefined;
  const n = pep508Name(w.text);
  return n ? pypiRef(n) : undefined;
}

/** `name@1.2` as poetry and pdm write it. */
const atVersionWord = (w: Word) => pipWord({ ...w, text: w.text.replace(/@[^/]*$/, '') });

type Scanned = { refs: DepRef[]; registries: string[] };

function scan(words: Word[], valued: Set<string>, registry: Set<string>, toRef: (w: Word) => DepRef | undefined): Scanned {
  const refs: DepRef[] = [];
  const registries: string[] = [];
  const note = (flag: string, value: string | undefined) => {
    if (registry.has(flag) && value !== undefined && !isPublicRegistry(value)) registries.push(value);
  };
  let ended = false;
  for (let i = 0; i < words.length; i++) {
    const t = words[i].text;
    if (!ended && t === '--') { ended = true; continue; }
    if (!ended && t.startsWith('-')) {
      const eq = t.indexOf('=');
      if (eq > 0) note(t.slice(0, eq), t.slice(eq + 1));
      else if (valued.has(t)) { note(t, words[i + 1]?.text); i++; }
      else if (/^-[a-zA-Z]./.test(t) && valued.has(t.slice(0, 2))) note(t.slice(0, 2), t.slice(2));
      continue;
    }
    const ref = toRef(words[i]);
    if (ref) refs.push(ref);
  }
  return { refs, registries };
}

/** Index of the first argument that is neither a flag nor a flag's value. */
function firstWord(words: Word[], valued: Set<string>): number {
  for (let i = 0; i < words.length; i++) {
    const t = words[i].text;
    if (!t.startsWith('-')) return i;
    if (valued.has(t)) i++;
  }
  return -1;
}

const without = (words: Word[], i: number) => [...words.slice(0, i), ...words.slice(i + 1)];

/** `npm config set registry URL`, `pip config set global.index-url URL` and the like. */
function configRegistry(a: Word[]): Scanned | undefined {
  const i = a.findIndex(w => w.text === 'config');
  if (i < 0 || a[i + 1]?.text !== 'set') return undefined;
  const [key, inlineValue] = (a[i + 2]?.text ?? '').split(/=(.*)/s);
  if (!/^(?:registry|npmRegistryServer|(?:global\.|user\.|site\.)?(?:extra-)?index-url)$/.test(key)) return { refs: [], registries: [] };
  const url = inlineValue || a[i + 3]?.text;
  return { refs: [], registries: url !== undefined && !isPublicRegistry(url) ? [url] : [] };
}

/** Install details of a command, or undefined when it is not a package install or registry setting. */
export function parseInstall(s: Simple): Scanned | undefined {
  let a = s.args;
  const mgr = NPM_MANAGERS[s.name];
  if (mgr) {
    let sub = firstWord(a, mgr.value);
    if (s.name === 'yarn' && a[sub]?.text === 'workspace') { a = a.slice(sub + 2); sub = firstWord(a, mgr.value); }
    if (a[sub]?.text === 'config') return configRegistry(a);
    return sub >= 0 && mgr.subs.has(a[sub].text) ? scan(without(a, sub), mgr.value, NPM_REGISTRY, npmWord) : undefined;
  }
  if (PY_TOOLS[s.name] || (s.name === 'uv' && a[0]?.text === 'add')) {
    const sub = firstWord(a, PIP_VALUE);
    return sub >= 0 && a[sub].text === (PY_TOOLS[s.name] ?? 'add') ? scan(without(a, sub), PIP_VALUE, PIP_REGISTRY, atVersionWord) : undefined;
  }
  let rest: Word[] | undefined;
  if (/^pip[\d.]*$/.test(s.name)) rest = a;
  else if (/^python[\d.]*$|^py$/.test(s.name)) {
    const m = a.findIndex(w => w.text === '-m');
    if (m >= 0 && a[m + 1]?.text === 'pip') rest = a.slice(m + 2);
  } else if (s.name === 'uv' && a[0]?.text === 'pip') rest = a.slice(1);
  if (!rest) return undefined;
  const i = firstWord(rest, PIP_VALUE);
  if (rest[i]?.text === 'config') return configRegistry(rest);
  return rest[i]?.text === 'install' ? scan(without(rest, i), PIP_VALUE, PIP_REGISTRY, pipWord) : undefined;
}
