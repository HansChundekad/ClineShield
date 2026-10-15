# Risk Rubric ① (engine + edit checks + configuration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the interim 1.x size rules in the Cline plugin with the Risk rubric for file edits (`apply_patch`, `editor`): categories → points → tier, configured by `~/.cline-shield.yml` and `.cline-shield.yml`.

**Architecture:** Pure modules under `clineshield/src/plugin/rubric/` (checks, engine, messages) and `clineshield/src/plugin/config/` (validate, merge, resolve), plus two thin I/O modules (`gather.ts` reads files/git/CODEOWNERS with time caps; `config/store.ts` reads YAML with mtime caching). `plugin/index.ts` parses the tool input with the existing `plugin/patch` module, gathers, scores, and maps the decision to hook results and the existing `metrics.json` events. Commands (②), dependencies (③) and session signals (④) are later PRs.

**Tech Stack:** TypeScript (strict, CommonJS), Jest 30 + ts-jest, `js-yaml` 4, Node `child_process.spawn` for `git status`.

**Spec:** `SPEC.md` → "Risk rubric" and "Rubric configuration" (PR #20, branch `docs/rubric-design`). Read both sections and Decisions 1, 8, 9, 10 before starting.

## Global Constraints

- `metrics.json` schema (`clineshield/src/types/metrics.ts`) is fixed. PR ① adds **no** event type; it writes `edit-allowed`, `edit-approval`, `edit-blocked`, `risk-assessed` with their existing fields.
- Every hook exits normally: never throw into Cline (wrap in `guardHook`, as today).
- Internal deadline 2000 ms per action; the git check (`git diff HEAD --name-only`) capped at 300 ms; whole gather capped at 1500 ms; typical action < 200 ms.
- Cut-offs (ask / block): relaxed 60/90 · balanced 40/70 (default) · strict 25/50.
- Hard rules (`self_protection`, `placeholder`, `secret_added`) always block; no config can change them.
- Loosening keys (`mode`, `on_error`, `offline`, `trusted_commands`) are read only from the personal file.
- Cline sees reasons and fixes, never points or cut-offs.
- Regex patterns from config: ≤ 200 chars, nested quantifiers rejected.
- Only runtime dependency added: `js-yaml` (root `package.json`); plugin code must load with root deps only.
- TDD: failing test first, then code. Tests live in `__tests__/` next to the code (`jest.config.js` `testMatch`).
- Commit format `<type>(<scope>): <subject>` + bullet details; no AI attribution, no `Co-Authored-By`.
- Run tests from `clineshield/`: `npx jest <path>`; full suite `npm test`.

## Review Focus

1. **Patch that doesn't match the file on disk** (stale model view, whitespace drift) → patch-only measures, no extra ask; must not crash or score as a 100 % rewrite. Test in Task 3.
2. **Windows line endings in the original file** (`\r\n`) → in-memory apply still matches and CRLF does not count as changed lines. Test in Task 2.
3. **The 1.x `.cline-shield.yml` keys** (`no-nuke`, `sanity`, `risk`, `gemini_api_key`) in a user's existing file → ignored without warnings spam, nothing breaks. Test in Task 8.
4. **Placeholder false positive on legitimate code**: a new file containing `// TODO: implement`, or an edit that only adds `pass` to an empty function body → must not block. Test in Task 4.
5. **Secret-looking text in `.env` files and test fixtures** (`AKIAIOSFODNN7EXAMPLE`) → no hard block; `.env` scores as `secrets_file` instead. Test in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `clineshield/src/plugin/patch/apply.ts` (new) | Pure in-memory apply of a `FileOperation` to file text |
| `clineshield/src/plugin/rubric/types.ts` (new) | `CategoryId`, `Tier`, `CheckKind`, `FileChange`, `ActionContext`, `RawFinding`, `Check` |
| `clineshield/src/plugin/rubric/categories.ts` (new) | Per-category defaults: max points, kind, group, fix sentence; preset cut-offs |
| `clineshield/src/plugin/rubric/glob.ts` (new) | Minimal glob → RegExp (`**`, `*`, `?`) |
| `clineshield/src/plugin/rubric/paths.ts` (new) | Path classifiers: test file, language, secrets/CI/infra/migration/manifest/generated |
| `clineshield/src/plugin/rubric/gather.ts` (new) | I/O: read originals, binary/size, exists, realpath, git dirty set, CODEOWNERS → `ActionContext` |
| `clineshield/src/plugin/rubric/checks/hard.ts` (new) | `self_protection`, `placeholder`, `secret_added` |
| `clineshield/src/plugin/rubric/checks/files.ts` (new) | Size, file-operation and sensitive-file categories |
| `clineshield/src/plugin/rubric/checks/tests.ts` (new) | Weakening-safety categories + language packs |
| `clineshield/src/plugin/rubric/checks/content.ts` (new) | Content categories (added lines only) |
| `clineshield/src/plugin/rubric/checks/structure.ts` (new) | `functions_removed`, `exports_removed`, `signature_changed`, `env_key_renamed` |
| `clineshield/src/plugin/rubric/checks/index.ts` (new) | `ALL_CHECKS` in run order (critical first) |
| `clineshield/src/plugin/rubric/engine.ts` (new) | Run checks with crash/time handling, points, discount, tiers, custom rules |
| `clineshield/src/plugin/rubric/messages.ts` (new) | Block/ask text for Cline |
| `clineshield/src/plugin/config/schema.ts` (new) | Types, `validateConfig`, `mergeConfigs`, `resolveFilePolicy` |
| `clineshield/src/plugin/config/store.ts` (new) | Read + cache personal/project YAML by mtime |
| `clineshield/src/plugin/index.ts` (modify) | Wire gather → engine → events; on_error, observe, 3-block notice |
| `clineshield/src/plugin/editPolicy/` (delete) | Interim 1.x rules, replaced |
| `clineshield/src/plugin/__tests__/editSizePolicy.test.ts`, `riskScoring.test.ts` (delete) | Replaced by `rubricPlugin.test.ts` |
| `package.json` (root, modify) | `dependencies: { "js-yaml": "^4.1.1" }` |
| `.github/workflows/ci.yml` (modify) | Add `plugin-install` job |
| `.cline-shield.example.yml` (modify) | Document every 2.0 key |
| `SPEC.md` (modify) | Tick ① boxes, small corrections |

`clineshield/src/extension/riskAnalysis/rulesEngine.ts` stays (1.x hooks and `llmAnalyzer` type import) until "Retire 1.x hooks".

---

### Task 0: Worktree

- [ ] **Step 1: Create the branch and worktree**

If PR #20 is merged use `origin/main`, otherwise `origin/docs/rubric-design`:
```bash
cd /Users/hanschundekad/ClineShield
git fetch origin
git worktree add -b phase-9/risk-rubric ../ClineShield-risk-rubric origin/main
cd ../ClineShield-risk-rubric
~/.claude/scripts/worktree-bootstrap.sh
ln -s /Users/hanschundekad/ClineShield/clineshield/node_modules clineshield/node_modules
cd clineshield && npm test
```
Expected: all existing suites pass.

---

### Task 1: Types, categories, glob, path classifiers

**Files:**
- Create: `clineshield/src/plugin/rubric/types.ts`, `categories.ts`, `glob.ts`, `paths.ts`
- Test: `clineshield/src/plugin/rubric/__tests__/glob.test.ts`, `paths.test.ts`, `categories.test.ts`

**Interfaces:**
- Produces: everything in `types.ts`; `CATEGORIES: Record<CategoryId, CategoryDef>`, `PRESET_CUTOFFS`, `SIZE_GROUP`; `globToRegExp(glob: string): RegExp`, `matchesGlob(path: string, glob: string): boolean`; `isTestPath`, `languageOf`, `isSecretsFile`, `isCiConfig`, `isInfra`, `isMigration`, `isManifest`, `isGenerated`, `toLines`.

- [ ] **Step 1: Write `types.ts`** (types only, no test needed)

```ts
/**
 * types.ts
 *
 * Shared types for the Risk rubric (SPEC.md "Risk rubric"). Pure data.
 */

import type { FileOperation } from '../patch';

export type Tier = 'allow' | 'ask' | 'block';

/**
 * hard: always blocks, not configurable. critical: a crash in the check →
 * on_error. signal: a crash → skipped and logged. logOnly: recorded with 0 points.
 */
export type CheckKind = 'hard' | 'critical' | 'signal' | 'logOnly';

export type CategoryId =
  | 'self_protection' | 'placeholder' | 'secret_added'
  | 'rewrite_share' | 'lines_removed' | 'files_touched' | 'deletion_heavy'
  | 'file_deleted' | 'move_overwrites' | 'uncommitted_lost' | 'outside_workspace'
  | 'secrets_file' | 'ci_config' | 'infra' | 'migration' | 'protected_path'
  | 'gitignore_changed' | 'gitignore_unignores_secrets' | 'manifest' | 'generated'
  | 'tests_deleted' | 'tests_skipped' | 'checks_disabled' | 'assertions_weakened'
  | 'expected_changed' | 'test_and_source'
  | 'security_weakened' | 'auth_removed' | 'validation_removed' | 'sql_string_built'
  | 'new_domain' | 'empty_catch' | 'commented_out_block'
  | 'functions_removed' | 'exports_removed' | 'signature_changed' | 'env_key_renamed';

/** One file of an action, as the checks see it. */
export interface FileChange {
  /** Display path: workspace-relative POSIX when inside the workspace, else absolute. */
  path: string;
  absPath: string;
  kind: FileOperation['type'];
  /** Display path of a move/rename target. */
  moveTo?: string;
  op: FileOperation;
  /** File text before the action; undefined when missing, binary, > 2 MB, unreadable or gather timed out. */
  original?: string;
  originalLineCount?: number;
  /** undefined = unknown (not checked or timed out). */
  exists?: boolean;
  binary: boolean;
  /** Patch applies to `original`; undefined when `original` is unknown. */
  matched?: boolean;
  moveTargetExists?: boolean;
  /** path or moveTo (after resolving symlinks) is outside the workspace. */
  outsideWorkspace: boolean;
  /** File has uncommitted changes; undefined when git is unavailable. */
  gitDirty?: boolean;
  /** Lines added / removed by this change (for a delete with a known original: every original line). */
  added: string[];
  removed: string[];
  /** Per-hunk view for checks that need locality. */
  hunks: Array<{ added: string[]; removed: string[] }>;
  /** Context lines in the patch (for the patch-only size fallback). */
  contextLines: number;
  isTest: boolean;
}

export interface ActionContext {
  workspaceRoot: string;
  homeDir: string;
  /** Directory the plugin is installed in (self-protection). */
  pluginDir: string;
  changes: FileChange[];
  /** CODEOWNERS path patterns as globs. */
  codeownersGlobs: string[];
}

/** What a check reports; the engine turns weight into points. */
export interface RawFinding {
  category: CategoryId;
  /** 0..1 share of the category's max points (bands and per-unit counts). */
  weight: number;
  /** Human detail, e.g. "82% of the file rewritten". Shown to Cline and logs. */
  detail: string;
  /** Optional numbers the plugin copies into metrics events. */
  counts?: { functionsDeleted?: number; exportsDeleted?: number; structuralChangePercent?: number };
}

/** Per-file view of the config a check may need. */
export interface CheckOptions {
  protectedPaths: string[];
  trustedDomains: string[];
}

export interface Check {
  name: string;
  /** Crash behaviour: critical → on_error, signal → skipped. */
  kind: 'critical' | 'signal';
  /** Per-file checks get `change`; action checks (`perAction: true`) are called once with the first change. */
  perAction?: boolean;
  run(change: FileChange, action: ActionContext, options: CheckOptions): RawFinding[];
}
```

- [ ] **Step 2: Write the failing tests for glob, paths and categories**

`clineshield/src/plugin/rubric/__tests__/glob.test.ts`:
```ts
import { matchesGlob } from '../glob';

describe('matchesGlob', () => {
  it.each([
    ['src/auth/login.ts', 'src/auth/**', true],
    ['src/auth/deep/x.ts', 'src/auth/**', true],
    ['src/authx/login.ts', 'src/auth/**', false],
    ['billing/a.ts', 'billing/**', true],
    ['src/a.ts', '*.ts', false],
    ['a.ts', '*.ts', true],
    ['src/a.ts', '**/*.ts', true],
    ['a.ts', '**/*.ts', true],
    ['src/a.tsx', 'src/a.ts?', true],
    ['docs/a.md', 'src/**', false],
    ['src/a.b.ts', 'src/a.b.ts', true],
    ['src/axbxts', 'src/a.b.ts', false],
  ])('%s vs %s → %s', (p, g, expected) => {
    expect(matchesGlob(p, g)).toBe(expected);
  });

  it('a glob without a slash matches the basename anywhere (gitignore style)', () => {
    expect(matchesGlob('deep/dir/.env', '.env')).toBe(true);
  });
});
```

`clineshield/src/plugin/rubric/__tests__/paths.test.ts`:
```ts
import {
  isCiConfig, isGenerated, isInfra, isManifest, isMigration, isSecretsFile, isTestPath, languageOf, toLines,
} from '../paths';

describe('path classifiers', () => {
  it.each([
    'src/a.test.ts', 'src/a.spec.jsx', 'src/__tests__/a.ts', 'tests/x.py', 'pkg/a_test.go',
    'test_util.py', 'src/test/java/FooTest.java', 'spec/user_spec.rb', 'test/a.rs',
  ])('test path: %s', p => expect(isTestPath(p)).toBe(true));
  it.each(['src/a.ts', 'src/contest.ts', 'latest.py'])('not a test path: %s', p => expect(isTestPath(p)).toBe(false));

  it('languageOf', () => {
    expect(languageOf('a.tsx')).toBe('js');
    expect(languageOf('a.py')).toBe('py');
    expect(languageOf('a.go')).toBe('go');
    expect(languageOf('A.java')).toBe('java');
    expect(languageOf('A.kt')).toBe('java');
    expect(languageOf('a.rs')).toBe('rs');
    expect(languageOf('a.rb')).toBe('rb');
    expect(languageOf('a.md')).toBeUndefined();
  });

  it.each(['.env', 'config/.env.production', 'certs/server.pem', 'id_rsa', 'k.key', '.netrc', 'secrets.yaml'])(
    'secrets file: %s', p => expect(isSecretsFile(p)).toBe(true));
  it.each(['.env.example', '.env.sample', 'src/env.ts'])('not secrets: %s', p => expect(isSecretsFile(p)).toBe(false));

  it('ci, infra, migration, manifest, generated', () => {
    expect(isCiConfig('.github/workflows/ci.yml')).toBe(true);
    expect(isCiConfig('.gitlab-ci.yml')).toBe(true);
    expect(isCiConfig('src/ci.ts')).toBe(false);
    expect(isInfra('Dockerfile')).toBe(true);
    expect(isInfra('infra/main.tf')).toBe(true);
    expect(isInfra('k8s/deploy.yaml')).toBe(true);
    expect(isInfra('src/docker.ts')).toBe(false);
    expect(isMigration('db/migrate/001_init.rb')).toBe(true);
    expect(isMigration('migrations/0002.sql')).toBe(true);
    expect(isMigration('src/migrate.ts')).toBe(false);
    expect(isManifest('package.json')).toBe(true);
    expect(isManifest('web/yarn.lock')).toBe(true);
    expect(isManifest('requirements-dev.txt')).toBe(true);
    expect(isGenerated('dist/index.js')).toBe(true);
    expect(isGenerated('src/vendor/x.go')).toBe(true);
    expect(isGenerated('app.min.js')).toBe(true);
    expect(isGenerated('src/index.ts')).toBe(false);
  });

  it('toLines ignores one trailing newline and normalises CRLF', () => {
    expect(toLines('a\r\nb\r\n')).toEqual(['a', 'b']);
    expect(toLines('')).toEqual([]);
  });
});
```

`clineshield/src/plugin/rubric/__tests__/categories.test.ts`:
```ts
import { CATEGORIES, PRESET_CUTOFFS } from '../categories';

describe('categories', () => {
  it('hard rules are the three spec hard rules', () => {
    const hard = Object.entries(CATEGORIES).filter(([, d]) => d.kind === 'hard').map(([id]) => id).sort();
    expect(hard).toEqual(['placeholder', 'secret_added', 'self_protection']);
  });
  it('every category has a fix sentence', () => {
    for (const d of Object.values(CATEGORIES)) expect(d.fix.length).toBeGreaterThan(10);
  });
  it('preset cut-offs match the spec', () => {
    expect(PRESET_CUTOFFS).toEqual({
      relaxed: { ask: 60, block: 90 }, balanced: { ask: 40, block: 70 }, strict: { ask: 25, block: 50 },
    });
  });
  it('rewrite_share top band is 50 so strict blocks a full rewrite', () => {
    expect(CATEGORIES.rewrite_share.max).toBe(50);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd clineshield && npx jest src/plugin/rubric/__tests__`
Expected: FAIL, "Cannot find module '../glob'" (and `../paths`, `../categories`).

- [ ] **Step 4: Implement `glob.ts`, `paths.ts`, `categories.ts`**

`glob.ts`:
```ts
/**
 * glob.ts
 *
 * Minimal glob matcher for config paths and CODEOWNERS: `**` any depth,
 * `*` within a segment, `?` one char. A glob without "/" matches the
 * basename anywhere (gitignore style). Paths are workspace-relative POSIX.
 */

const cache = new Map<string, RegExp>();

export function globToRegExp(glob: string): RegExp {
  const hit = cache.get(glob);
  if (hit) return hit;
  let g = glob.replace(/^\.\//, '').replace(/^\//, '');
  if (!g.includes('/')) g = `**/${g}`;
  if (g.endsWith('/')) g += '**';
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      const slash = g[i + 2] === '/';
      re += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const out = new RegExp(`^${re}$`);
  cache.set(glob, out);
  return out;
}

export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}
```

`paths.ts`:
```ts
/**
 * paths.ts
 *
 * Path classifiers used by the rubric checks. Paths are display paths
 * (workspace-relative POSIX when inside the workspace).
 */

export type Language = 'js' | 'py' | 'go' | 'java' | 'rs' | 'rb';

const LANG_BY_EXT: Record<string, Language> = {
  ts: 'js', tsx: 'js', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', mts: 'js', cts: 'js',
  py: 'py', go: 'go', java: 'java', kt: 'java', rs: 'rs', rb: 'rb',
};

export function languageOf(path: string): Language | undefined {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? LANG_BY_EXT[m[1].toLowerCase()] : undefined;
}

const base = (p: string) => p.split('/').pop() ?? p;

const TEST_PATTERNS = [
  /(^|\/)(__tests__|tests?|spec)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /_test\.(go|py)$/,
  /(^|\/)test_[^/]*\.py$/,
  /Tests?\.(java|kt|cs)$/,
  /_spec\.rb$/,
];
export function isTestPath(p: string): boolean {
  return TEST_PATTERNS.some(r => r.test(p));
}

export function isSecretsFile(p: string): boolean {
  const b = base(p);
  if (/^\.env(\..+)?$/.test(b)) return !/\.(example|sample|template|dist)$/.test(b);
  return (
    /\.(pem|key|p12|pfx|crt|cer|der|jks|keystore)$/i.test(b) ||
    /^(id_rsa|id_dsa|id_ecdsa|id_ed25519|\.netrc|\.pgpass|credentials(\.json)?)$/.test(b) ||
    /^secrets?\.(ya?ml|json|toml)$/i.test(b)
  );
}

export function isCiConfig(p: string): boolean {
  return (
    /^\.github\/workflows\//.test(p) || /^\.circleci\//.test(p) || /^\.buildkite\//.test(p) ||
    /^(\.gitlab-ci\.yml|Jenkinsfile|azure-pipelines\.yml|\.travis\.yml|bitbucket-pipelines\.yml)$/.test(p)
  );
}

export function isInfra(p: string): boolean {
  const b = base(p);
  return (
    /^Dockerfile/.test(b) || /^docker-compose.*\.ya?ml$/.test(b) || /\.(tf|tfvars)$/.test(b) ||
    /^(Chart\.yaml|kustomization\.ya?ml|serverless\.ya?ml|cdk\.json|Pulumi\..*\.ya?ml)$/.test(b) ||
    /(^|\/)(k8s|kubernetes|helm|charts)\/.*\.ya?ml$/.test(p)
  );
}

export function isMigration(p: string): boolean {
  return /(^|\/)(migrations?|db\/migrate|alembic\/versions)\//.test(p);
}

const MANIFESTS = new Set([
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json',
  'Pipfile', 'Pipfile.lock', 'pyproject.toml', 'poetry.lock', 'setup.py', 'setup.cfg',
  'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock', 'Gemfile', 'Gemfile.lock',
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', 'composer.lock',
]);
export function isManifest(p: string): boolean {
  const b = base(p);
  return MANIFESTS.has(b) || /^requirements.*\.txt$/.test(b);
}

export function isGenerated(p: string): boolean {
  return (
    /(^|\/)(dist|build|out|node_modules|vendor|\.next|target|coverage|__pycache__)\//.test(p) ||
    /\.min\.(js|css)$/.test(p) || /\.generated\./.test(p) || /_pb2\.py$/.test(p) || /\.pb\.go$/.test(p)
  );
}

/** Line view of a text: CRLF normalised, one trailing newline does not make an extra line. */
export function toLines(text: string): string[] {
  if (text === '') return [];
  const t = text.replace(/\r\n/g, '\n');
  return (t.endsWith('\n') ? t.slice(0, -1) : t).split('\n');
}
```

`categories.ts`:
```ts
/**
 * categories.ts
 *
 * Default points, check kinds and fix sentences per category (SPEC.md
 * "Risk rubric" table). `max` is the category's top points; checks report a
 * 0..1 weight (bands, per-unit counts) and the engine multiplies. A config
 * points override replaces `max`, so bands scale with it.
 */

import type { CategoryId, CheckKind } from './types';

export type Group = 'hard' | 'size' | 'fileops' | 'sensitive' | 'weakening' | 'content' | 'structure';

export interface CategoryDef {
  max: number;
  kind: CheckKind;
  group: Group;
  /** One fixed "safer alternative" sentence shown to Cline. */
  fix: string;
}

export type Preset = 'relaxed' | 'balanced' | 'strict';
export interface Cutoffs { ask: number; block: number }

export const PRESET_CUTOFFS: Record<Preset, Cutoffs> = {
  relaxed: { ask: 60, block: 90 },
  balanced: { ask: 40, block: 70 },
  strict: { ask: 25, block: 50 },
};

/** Size/scope categories: the only ones the test-file discount reduces. */
export const SIZE_GROUP: ReadonlySet<CategoryId> = new Set(['rewrite_share', 'lines_removed', 'files_touched']);
export const TEST_FILE_DISCOUNT = 10;

const def = (max: number, kind: CheckKind, group: Group, fix: string): CategoryDef => ({ max, kind, group, fix });

export const CATEGORIES: Record<CategoryId, CategoryDef> = {
  self_protection: def(0, 'hard', 'hard', 'Do not change ClineShield files; ask the user to edit them by hand.'),
  placeholder: def(0, 'hard', 'hard', 'Write out the full code you are keeping, or change only the lines you need.'),
  secret_added: def(0, 'hard', 'hard', 'Read the secret from an environment variable or secrets manager instead of writing it into the file.'),
  rewrite_share: def(50, 'signal', 'size', 'Change one function or block at a time and keep the rest of the file as it is.'),
  lines_removed: def(30, 'signal', 'size', 'Remove less code per edit, and only what the task requires.'),
  files_touched: def(30, 'signal', 'size', 'Split the change into smaller actions that touch fewer files.'),
  deletion_heavy: def(20, 'logOnly', 'size', 'Delete only what the task requires.'),
  file_deleted: def(35, 'critical', 'fileops', 'Only delete files the task requires; confirm with the user if unsure.'),
  move_overwrites: def(40, 'critical', 'fileops', 'Move to a path that does not exist yet, or ask the user before replacing that file.'),
  uncommitted_lost: def(30, 'critical', 'fileops', 'Ask the user to commit or stash their changes first.'),
  outside_workspace: def(50, 'critical', 'fileops', 'Keep changes inside the project folder.'),
  secrets_file: def(45, 'critical', 'sensitive', 'Leave secrets files to the user unless the task is explicitly about them.'),
  ci_config: def(35, 'critical', 'sensitive', 'Change CI configuration only when the task asks for it.'),
  infra: def(30, 'critical', 'sensitive', 'Change infrastructure files only when the task asks for it.'),
  migration: def(30, 'critical', 'sensitive', 'Add a new migration instead of editing an existing one.'),
  protected_path: def(30, 'critical', 'sensitive', 'This path is protected; keep the change minimal and explain why it is needed.'),
  gitignore_changed: def(15, 'critical', 'sensitive', 'Change .gitignore only when the task asks for it.'),
  gitignore_unignores_secrets: def(60, 'critical', 'sensitive', 'Keep secrets files ignored by git.'),
  manifest: def(15, 'signal', 'sensitive', 'Change dependencies only when the task needs it.'),
  generated: def(20, 'signal', 'sensitive', 'Edit the source that generates this file instead.'),
  tests_deleted: def(40, 'signal', 'weakening', 'Keep existing tests; fix the code so they pass.'),
  tests_skipped: def(30, 'signal', 'weakening', 'Do not skip tests; fix the code so they pass.'),
  checks_disabled: def(20, 'signal', 'weakening', 'Fix the warning instead of disabling the check.'),
  assertions_weakened: def(30, 'signal', 'weakening', 'Keep assertions as strict as they were; fix the code instead.'),
  expected_changed: def(25, 'signal', 'weakening', 'Change expected values only if the requirement changed; otherwise fix the code.'),
  test_and_source: def(15, 'signal', 'weakening', 'Change tests and source in separate steps so each can be checked.'),
  security_weakened: def(40, 'signal', 'content', 'Keep the security setting on and solve the problem another way.'),
  auth_removed: def(45, 'signal', 'content', 'Keep the authentication or permission check in place.'),
  validation_removed: def(40, 'signal', 'content', 'Keep the input validation in place.'),
  sql_string_built: def(40, 'signal', 'content', 'Use parameterised queries instead of building SQL from strings.'),
  new_domain: def(20, 'signal', 'content', 'Only call services the project already uses, or ask the user first.'),
  empty_catch: def(10, 'signal', 'content', 'Handle or log the error instead of ignoring it.'),
  commented_out_block: def(10, 'signal', 'content', 'Delete unused code instead of commenting it out.'),
  functions_removed: def(40, 'signal', 'structure', 'Do not delete functions or classes the task does not require.'),
  exports_removed: def(40, 'signal', 'structure', 'Keep exported names; other code may depend on them.'),
  signature_changed: def(15, 'logOnly', 'structure', 'Keep public signatures unless the task requires a change.'),
  env_key_renamed: def(20, 'logOnly', 'structure', 'Keep environment variable and config key names unless the task requires a rename.'),
};
```

Note: `test_and_source` is an action-level check; the "+25 after a failing test run" part is PR ④.

- [ ] **Step 5: Run tests**

Run: `npx jest src/plugin/rubric/__tests__`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add clineshield/src/plugin/rubric
git commit -m "feat(rubric): add category table, path classifiers and glob matcher

- CategoryId, FileChange, RawFinding and Check types
- Default points, kinds and fix sentences per SPEC table
- Minimal gitignore-style glob matcher"
```

---

### Task 2: In-memory patch apply

**Files:**
- Create: `clineshield/src/plugin/patch/apply.ts`
- Modify: `clineshield/src/plugin/patch/index.ts` (export)
- Test: `clineshield/src/plugin/patch/__tests__/apply.test.ts`

**Interfaces:**
- Consumes: `FileOperation`, `PatchHunk` from `patch/types.ts`.
- Produces: `applyOperation(original: string, op: FileOperation): ApplyResult` where `type ApplyResult = { ok: true; text: string } | { ok: false; reason: string }`.

Semantics: `add` → `{ok:true, text: lines.join('\n')}`; `delete` → `{ok:true, text: ''}`; `update`: for each hunk in order, `exactText` (editor edits) → `oldText` must occur exactly once (CRLF-normalised) and is replaced; `insertAtLine` → insert before that 1-based line; otherwise the hunk's old block (context + remove lines, in order) is searched from a cursor, first exact, then with trailing whitespace trimmed; replaced by context + add lines; `endOfFile` hunks must match at the end. Missing block → `{ok:false}`.

- [ ] **Step 1: Write the failing test**

```ts
import { applyOperation } from '../apply';
import { editorInputToOperation, parseApplyPatch } from '..';

const patchOp = (body: string[]) =>
  parseApplyPatch(['*** Begin Patch', ...body, '*** End Patch'].join('\n')).operations[0];

describe('applyOperation', () => {
  const file = 'a\nb\nc\nd\n';

  it('applies an apply_patch update hunk', () => {
    const r = applyOperation(file, patchOp(['*** Update File: f.ts', '@@', ' b', '-c', '+C']));
    expect(r).toEqual({ ok: true, text: 'a\nb\nC\nd\n' });
  });

  it('applies two hunks in order', () => {
    const r = applyOperation(file, patchOp(['*** Update File: f.ts', '@@', '-a', '+A', '@@', '-d', '+D']));
    expect(r).toEqual({ ok: true, text: 'A\nb\nc\nD\n' });
  });

  it('matches with trailing whitespace differences', () => {
    const r = applyOperation('a  \nb\n', patchOp(['*** Update File: f.ts', '@@', ' a', '-b', '+B']));
    expect(r.ok).toBe(true);
  });

  it('applies to a CRLF file without counting line endings as changes', () => {
    const r = applyOperation('a\r\nb\r\n', patchOp(['*** Update File: f.ts', '@@', ' a', '-b', '+B']));
    expect(r).toEqual({ ok: true, text: 'a\r\nB\r\n' });
  });

  it('fails when the old block is not in the file', () => {
    const r = applyOperation(file, patchOp(['*** Update File: f.ts', '@@', '-zzz', '+y']));
    expect(r.ok).toBe(false);
  });

  it('editor replace: old_text must occur exactly once', () => {
    const op = editorInputToOperation({ path: 'f.ts', old_text: 'b\n', new_text: 'B\n' })!;
    expect(applyOperation(file, op)).toEqual({ ok: true, text: 'a\nB\nc\nd\n' });
    expect(applyOperation('b\nb\n', op).ok).toBe(false);
  });

  it('editor insert_line inserts before that line', () => {
    const op = editorInputToOperation({ path: 'f.ts', new_text: 'X', insert_line: 2 })!;
    expect(applyOperation(file, op)).toEqual({ ok: true, text: 'a\nX\nb\nc\nd\n' });
  });

  it('add and delete', () => {
    expect(applyOperation('', patchOp(['*** Add File: n.ts', '+x', '+y']))).toEqual({ ok: true, text: 'x\ny' });
    expect(applyOperation(file, patchOp(['*** Delete File: f.ts']))).toEqual({ ok: true, text: '' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/plugin/patch/__tests__/apply.test.ts`
Expected: FAIL, "Cannot find module '../apply'".

- [ ] **Step 3: Implement `apply.ts` and export it**

```ts
/**
 * apply.ts
 *
 * Pure in-memory apply of a FileOperation to file text, so the rubric can
 * compare before/after while the file on disk is still unchanged. Stricter
 * than the SDK executor (exact, then trailing-whitespace-insensitive): a
 * miss only makes the rubric fall back to patch-only measures.
 */

import type { FileOperation, PatchHunk } from './types';

export type ApplyResult = { ok: true; text: string } | { ok: false; reason: string };

function findBlock(lines: string[], block: string[], from: number, atEnd: boolean): number {
  const eq = [(a: string, b: string) => a === b, (a: string, b: string) => a.trimEnd() === b.trimEnd()];
  for (const same of eq) {
    const start = atEnd ? lines.length - block.length : from;
    const last = lines.length - block.length;
    for (let i = Math.max(0, start); i <= last; i++) {
      let hit = true;
      for (let j = 0; j < block.length; j++) {
        if (!same(lines[i + j], block[j])) { hit = false; break; }
      }
      if (hit) return i;
      if (atEnd) break;
    }
  }
  return -1;
}

function applyHunk(lines: string[], hunk: PatchHunk, cursor: number): { lines: string[]; cursor: number } | undefined {
  if (hunk.insertAtLine !== undefined) {
    const at = hunk.insertAtLine - 1;
    if (at < 0 || at > lines.length) return undefined;
    const added = hunk.lines.filter(l => l.kind === 'add').map(l => l.text);
    return { lines: [...lines.slice(0, at), ...added, ...lines.slice(at)], cursor: at + added.length };
  }
  const oldBlock = hunk.lines.filter(l => l.kind !== 'add').map(l => l.text);
  const newBlock = hunk.lines.filter(l => l.kind !== 'remove').map(l => l.text);
  if (oldBlock.length === 0) {
    return { lines: [...lines, ...newBlock], cursor: lines.length + newBlock.length };
  }
  const at = findBlock(lines, oldBlock, cursor, hunk.endOfFile);
  if (at < 0) return undefined;
  return { lines: [...lines.slice(0, at), ...newBlock, ...lines.slice(at + oldBlock.length)], cursor: at + newBlock.length };
}

export function applyOperation(original: string, op: FileOperation): ApplyResult {
  if (op.type === 'add') return { ok: true, text: op.lines.join('\n') };
  if (op.type === 'delete') return { ok: true, text: '' };

  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const normalized = original.replace(/\r\n/g, '\n');
  const trailing = normalized.endsWith('\n');

  // editor replace: exact text, exactly once.
  const only = op.hunks.length === 1 ? op.hunks[0] : undefined;
  if (only?.exactText && only.insertAtLine === undefined) {
    const oldText = only.exactText.oldText.replace(/\r\n/g, '\n');
    const first = normalized.indexOf(oldText);
    if (oldText === '' || first < 0 || normalized.indexOf(oldText, first + 1) >= 0) {
      return { ok: false, reason: 'old_text not found exactly once' };
    }
    const next = normalized.slice(0, first) + only.exactText.newText.replace(/\r\n/g, '\n') + normalized.slice(first + oldText.length);
    return { ok: true, text: next.replace(/\n/g, eol) };
  }

  let lines = (trailing ? normalized.slice(0, -1) : normalized).split('\n');
  if (normalized === '') lines = [];
  let cursor = 0;
  for (const hunk of op.hunks) {
    const r = applyHunk(lines, hunk, cursor);
    if (!r) return { ok: false, reason: 'hunk does not match the file' };
    lines = r.lines;
    cursor = r.cursor;
  }
  return { ok: true, text: lines.join(eol) + (trailing ? eol : '') };
}
```

In `patch/index.ts` add: `export { applyOperation } from './apply';` and `export type { ApplyResult } from './apply';`

- [ ] **Step 4: Run tests**

Run: `npx jest src/plugin/patch`
Expected: PASS (new and existing patch tests).

- [ ] **Step 5: Commit**

```bash
git add clineshield/src/plugin/patch
git commit -m "feat(patch): apply file operations in memory

- Exact match first, then trailing-whitespace-insensitive
- editor replace requires old_text exactly once; insert_line supported
- Keeps CRLF line endings"
```

---

### Task 3: Gather (file reads, git, CODEOWNERS)

**Files:**
- Create: `clineshield/src/plugin/rubric/gather.ts`
- Test: `clineshield/src/plugin/rubric/__tests__/gather.test.ts`

**Interfaces:**
- Consumes: `FileOperation`, `applyOperation`, `toLines`, `isTestPath`, `FileChange`, `ActionContext`.
- Produces:
  - `buildChange(op: FileOperation, info: FileInfo, display: (p: string) => string, absPath: string): FileChange` (pure)
  - `interface FileInfo { original?: string; exists?: boolean; binary: boolean; moveTargetExists?: boolean; outsideWorkspace: boolean; gitDirty?: boolean }`
  - `gitDirtyPaths(root: string, timeoutMs?: number): Promise<Set<string> | undefined>`
  - `readCodeowners(root: string): Promise<string[]>`
  - `gatherAction(ops: FileOperation[], opts: GatherOptions): Promise<ActionContext>` with `interface GatherOptions { workspaceRoot: string; homeDir: string; pluginDir: string; codeownersGlobs: string[]; budgetMs?: number; gitTimeoutMs?: number }`
  - constants `MAX_READ_BYTES = 2 * 1024 * 1024`, `GATHER_BUDGET_MS = 1500`, `GIT_TIMEOUT_MS = 300`

`buildChange` rules: `added`/`removed`/`hunks`/`contextLines` come from the patch (`add` op: all lines added; `update`: hunk lines; `editor` exactText hunks already carry a line diff). For a `delete` with a known original: `removed = toLines(original)`. `matched` = `applyOperation(original, op).ok` when the original is known and kind is `update`. `originalLineCount = toLines(original).length`.

- [ ] **Step 1: Write the failing test**

```ts
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { gatherAction, gitDirtyPaths, readCodeowners } from '../gather';
import { parseApplyPatch } from '../../patch';

const ops = (body: string[]) => parseApplyPatch(['*** Begin Patch', ...body, '*** End Patch'].join('\n')).operations;

describe('gatherAction', () => {
  let root: string;
  const opts = () => ({ workspaceRoot: root, homeDir: os.homedir(), pluginDir: '/nonexistent-plugin', codeownersGlobs: [] });

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-gather-'));
    await fs.writeFile(path.join(root, 'a.ts'), 'one\ntwo\nthree\n');
  });
  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  it('reads the original, applies in memory and records line changes', async () => {
    const a = await gatherAction(ops(['*** Update File: a.ts', '@@', ' one', '-two', '+TWO']), opts());
    const c = a.changes[0];
    expect(c.path).toBe('a.ts');
    expect(c.original).toBe('one\ntwo\nthree\n');
    expect(c.originalLineCount).toBe(3);
    expect(c.matched).toBe(true);
    expect(c.removed).toEqual(['two']);
    expect(c.added).toEqual(['TWO']);
    expect(c.exists).toBe(true);
  });

  it('marks a patch that does not match the file as matched=false (patch-only fallback)', async () => {
    const a = await gatherAction(ops(['*** Update File: a.ts', '@@', '-nope', '+x']), opts());
    expect(a.changes[0].matched).toBe(false);
  });

  it('delete with a readable file counts every original line as removed', async () => {
    const a = await gatherAction(ops(['*** Delete File: a.ts']), opts());
    expect(a.changes[0].removed).toEqual(['one', 'two', 'three']);
  });

  it('binary file: no original, binary=true', async () => {
    await fs.writeFile(path.join(root, 'b.png'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
    const a = await gatherAction(ops(['*** Delete File: b.png']), opts());
    expect(a.changes[0].binary).toBe(true);
    expect(a.changes[0].original).toBeUndefined();
  });

  it('unreadable/missing file: original undefined, exists=false, no throw', async () => {
    const a = await gatherAction(ops(['*** Update File: missing.ts', '@@', '-x', '+y']), opts());
    expect(a.changes[0].original).toBeUndefined();
    expect(a.changes[0].exists).toBe(false);
    expect(a.changes[0].matched).toBeUndefined();
  });

  it('outside workspace by path and by symlink', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-out-'));
    await fs.symlink(outside, path.join(root, 'link'));
    const a = await gatherAction(ops([
      `*** Update File: ${path.join(outside, 'x.ts')}`, '@@', '-a', '+b',
      '*** Update File: link/y.ts', '@@', '-a', '+b',
      '*** Update File: a.ts', '@@', '-two', '+2',
    ]), opts());
    expect(a.changes.map(c => c.outsideWorkspace)).toEqual([true, true, false]);
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('move onto an existing file sets moveTargetExists', async () => {
    await fs.writeFile(path.join(root, 'b.ts'), 'x\n');
    const a = await gatherAction(ops(['*** Update File: a.ts', '*** Move to: b.ts', '@@', '-two', '+2']), opts());
    expect(a.changes[0].moveTo).toBe('b.ts');
    expect(a.changes[0].moveTargetExists).toBe(true);
  });

  it('git dirty files are flagged; non-repo leaves gitDirty undefined', async () => {
    const a1 = await gatherAction(ops(['*** Update File: a.ts', '@@', '-two', '+2']), opts());
    expect(a1.changes[0].gitDirty).toBeUndefined();
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'i'], { cwd: root });
    expect((await gitDirtyPaths(root))?.has('a.ts')).toBe(false);
    await fs.writeFile(path.join(root, 'a.ts'), 'changed\n');
    const a2 = await gatherAction(ops(['*** Update File: a.ts', '@@', '-changed', '+x']), opts());
    expect(a2.changes[0].gitDirty).toBe(true);
  });

  it('readCodeowners turns CODEOWNERS entries into globs', async () => {
    await fs.mkdir(path.join(root, '.github'));
    await fs.writeFile(path.join(root, '.github', 'CODEOWNERS'), '# c\n/src/payments/ @team\n*.sql @dba\n\n');
    expect(await readCodeowners(root)).toEqual(['src/payments/**', '*.sql']);
  });

  it('respects the gather budget: a slow git yields gitDirty undefined, not a hang', async () => {
    const a = await gatherAction(ops(['*** Update File: a.ts', '@@', '-two', '+2']), { ...opts(), gitTimeoutMs: 0 });
    expect(a.changes[0].gitDirty).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/plugin/rubric/__tests__/gather.test.ts`
Expected: FAIL, "Cannot find module '../gather'".

- [ ] **Step 3: Implement `gather.ts`**

```ts
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
}

export interface GatherOptions {
  workspaceRoot: string;
  homeDir: string;
  pluginDir: string;
  codeownersGlobs: string[];
  budgetMs?: number;
  gitTimeoutMs?: number;
}

function displayPath(root: string, p: string): string {
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
    added: hunks.flatMap(h => h.added),
    removed: hunks.flatMap(h => h.removed),
    hunks,
    contextLines,
    isTest: isTestPath(path_),
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}

/** Workspace-relative paths with uncommitted changes to tracked files; undefined when git is unavailable, has no commits, or is slow. */
export function gitDirtyPaths(root: string, timeoutMs = GIT_TIMEOUT_MS): Promise<Set<string> | undefined> {
  const run = new Promise<Set<string> | undefined>(resolve => {
    let out = '';
    let child: ReturnType<typeof spawn>;
    try {
      // Paths relative to cwd (works when the workspace is a subfolder of the repo); staged + unstaged.
      child = spawn('git', ['diff', 'HEAD', '--name-only', '--relative', '-z'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(undefined);
      return;
    }
    const timer = setTimeout(() => { child.kill(); resolve(undefined); }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => { out += d.toString('utf-8'); });
    child.on('error', () => { clearTimeout(timer); resolve(undefined); });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0) return resolve(undefined);
      resolve(new Set(out.split('\0').filter(Boolean)));
    });
  });
  return run;
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

async function isOutside(root: string, abs: string): Promise<boolean> {
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

async function readInfo(op: FileOperation, root: string, dirty: Set<string> | undefined, display: (p: string) => string): Promise<FileInfo> {
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
  if (dirty) info.gitDirty = dirty.has(display(op.path));
  return info;
}

export async function gatherAction(ops: FileOperation[], opts: GatherOptions): Promise<ActionContext> {
  const root = opts.workspaceRoot;
  const display = (p: string) => displayPath(root, p);
  const budget = opts.budgetMs ?? GATHER_BUDGET_MS;
  const work = (async () => {
    const dirty = await gitDirtyPaths(root, opts.gitTimeoutMs ?? GIT_TIMEOUT_MS);
    return Promise.all(ops.map(op => readInfo(op, root, dirty, display).catch(() => ({ binary: false, outsideWorkspace: false }) as FileInfo)));
  })();
  const infos = await withTimeout(work, budget, ops.map(() => ({ binary: false, outsideWorkspace: false }) as FileInfo));
  return {
    workspaceRoot: root,
    homeDir: opts.homeDir,
    pluginDir: opts.pluginDir,
    codeownersGlobs: opts.codeownersGlobs,
    changes: ops.map((op, i) => buildChange(op, infos[i], display, path.resolve(root, op.path))),
  };
}
```

Note on the budget fallback: on timeout `outsideWorkspace` falls back to a lexical check only. Add that: in the fallback array, compute `outsideWorkspace` with the lexical `inside` test (no I/O). Implement by replacing the two fallback literals with `lexicalInfo(op)`:
```ts
const lexicalInfo = (op: FileOperation): FileInfo => {
  const rel = path.relative(root, path.resolve(root, op.path));
  return { binary: false, outsideWorkspace: rel.startsWith('..') || path.isAbsolute(rel) };
};
```
and use `ops.map(lexicalInfo)` / `.catch(() => lexicalInfo(op))`.

- [ ] **Step 4: Run tests**

Run: `npx jest src/plugin/rubric/__tests__/gather.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add clineshield/src/plugin/rubric
git commit -m "feat(rubric): gather file originals, git status and CODEOWNERS

- 2 MB read cap, binary detection, symlink-aware outside-workspace check
- git status capped at 300 ms, whole gather at 1500 ms; failures leave fields undefined"
```

---

### Task 4: Hard-rule checks

**Files:**
- Create: `clineshield/src/plugin/rubric/checks/hard.ts`
- Create: `clineshield/src/plugin/rubric/__tests__/fixtures.ts` (test helper shared by Tasks 4–7, 10)
- Test: `clineshield/src/plugin/rubric/checks/__tests__/hard.test.ts`

**Interfaces:**
- Consumes: `Check`, `FileChange`, `ActionContext`, `isSecretsFile`.
- Produces: `selfProtection: Check`, `placeholder: Check`, `secretAdded: Check`; exported regex lists `PLACEHOLDER_LINE`, `STUB_LINE`, `SECRET_PATTERNS`.

Rules:
- `self_protection` fires when `path` or `moveTo` (as absolute) is: basename `.cline-shield.yml` directly in the workspace root or in `homeDir`; inside `<root>/.cline-shield/`; inside `pluginDir`; inside `<root>/.cline/plugins/` or `<homeDir>/.cline/plugins/`.
- `placeholder` fires only for `kind === 'update'`: (a) any added line that is a comment and matches `PLACEHOLDER_LINE`; or (b) a hunk that removed ≥ 3 non-blank, non-stub lines and added a `STUB_LINE`.
- `secret_added` fires for any added line matching `SECRET_PATTERNS`, except in secrets files (`isSecretsFile`) and when the match contains `EXAMPLE` or `example`.

- [ ] **Step 1: Write the shared fixture helper**

`clineshield/src/plugin/rubric/__tests__/fixtures.ts`:
```ts
import { buildChange } from '../gather';
import type { FileInfo } from '../gather';
import { parseApplyPatch } from '../../patch';
import type { ActionContext, CheckOptions, FileChange } from '../types';

export const ROOT = '/ws';
export const HOME = '/home/u';

/** One FileChange from apply_patch body lines (without Begin/End markers). */
export function change(body: string[], info: Partial<FileInfo> = {}): FileChange {
  const op = parseApplyPatch(['*** Begin Patch', ...body, '*** End Patch'].join('\n')).operations[0];
  const abs = op.path.startsWith('/') ? op.path : `${ROOT}/${op.path}`;
  return buildChange(op, { binary: false, outsideWorkspace: false, ...info }, p => p.replace(/^\/ws\//, ''), abs);
}

export function update(file: string, removed: string[], added: string[], context: string[] = ['ctx']): string[] {
  return [`*** Update File: ${file}`, '@@', ...context.map(l => ` ${l}`), ...removed.map(l => `-${l}`), ...added.map(l => `+${l}`)];
}

export function action(changes: FileChange[], extra: Partial<ActionContext> = {}): ActionContext {
  return { workspaceRoot: ROOT, homeDir: HOME, pluginDir: '/plugins/clineshield', changes, codeownersGlobs: [], ...extra };
}

export const OPTS: CheckOptions = { protectedPaths: [], trustedDomains: [] };

export const ids = (findings: { category: string }[]) => findings.map(f => f.category);
```

- [ ] **Step 2: Write the failing test**

```ts
import { placeholder, secretAdded, selfProtection } from '../hard';
import { HOME, OPTS, action, change, ids, update } from '../../__tests__/fixtures';

const run = (check: typeof placeholder, c: ReturnType<typeof change>) => check.run(c, action([c]), OPTS);

describe('self_protection', () => {
  it.each([
    '.cline-shield.yml', '.cline-shield/metrics.json', '.cline/plugins/x/index.ts',
  ])('fires for %s', file => {
    expect(ids(run(selfProtection, change(update(file, ['a'], ['b']))))).toEqual(['self_protection']);
  });
  it('fires for the personal config and the plugin dir', () => {
    expect(ids(run(selfProtection, change(update(`${HOME}/.cline-shield.yml`, ['a'], ['b']))))).toEqual(['self_protection']);
    expect(ids(run(selfProtection, change(update('/plugins/clineshield/src/a.ts', ['a'], ['b']))))).toEqual(['self_protection']);
  });
  it('fires when a move targets a protected file', () => {
    const c = change(['*** Update File: x.yml', '*** Move to: .cline-shield.yml', '@@', '-a', '+b']);
    expect(ids(run(selfProtection, c))).toEqual(['self_protection']);
  });
  it('ignores ordinary files and the example config', () => {
    expect(run(selfProtection, change(update('src/a.ts', ['a'], ['b'])))).toEqual([]);
    expect(run(selfProtection, change(update('.cline-shield.example.yml', ['a'], ['b'])))).toEqual([]);
  });
});

describe('placeholder', () => {
  it.each([
    '// ... rest of code unchanged',
    '# ... existing code here',
    '/* rest of the file remains the same */',
    '// existing implementation unchanged',
    '// ...',
    '    // ... other methods',
  ])('blocks "%s" in an edit to an existing file', line => {
    expect(ids(run(placeholder, change(update('src/a.ts', ['real()'], [line]))))).toEqual(['placeholder']);
  });

  it('blocks a stub that replaces a real body', () => {
    const c = change(update('src/a.py', ['x = load()', 'y = parse(x)', 'return y'], ['raise NotImplementedError']));
    expect(ids(run(placeholder, c))).toEqual(['placeholder']);
    const js = change(update('src/a.ts', ['const a = 1;', 'const b = 2;', 'return a + b;'], ['// TODO: implement']));
    expect(ids(run(placeholder, js))).toEqual(['placeholder']);
  });

  it('does not fire in new files (scaffolding)', () => {
    expect(run(placeholder, change(['*** Add File: src/new.ts', '+// TODO: implement', '+export {}']))).toEqual([]);
  });

  it('does not fire when a stub replaces fewer than 3 real lines or only adds pass to an empty body', () => {
    expect(run(placeholder, change(update('src/a.py', ['x = 1'], ['pass'])))).toEqual([]);
    expect(run(placeholder, change(update('src/a.py', [], ['    pass'], ['def f():'])))).toEqual([]);
  });

  it('does not fire on ordinary comments or spread syntax', () => {
    expect(run(placeholder, change(update('src/a.ts', ['a'], ['// rest api client', 'const x = [...rest];'])))).toEqual([]);
  });
});

describe('secret_added', () => {
  it.each([
    'const k = "AKIAABCDEFGHIJKLMNOP";',
    'token = "ghp_' + 'a'.repeat(36) + '"',
    'STRIPE = "sk_live_' + 'a1'.repeat(12) + '"',
    '-----BEGIN RSA PRIVATE KEY-----',
    'api_key: "a1b2c3d4e5f6g7h8i9j0k1l2"',
  ])('blocks %s', line => {
    expect(ids(run(secretAdded, change(update('src/a.ts', [], [line]))))).toEqual(['secret_added']);
  });
  it('ignores AWS example keys, placeholders and .env files', () => {
    expect(run(secretAdded, change(update('src/a.ts', [], ['k = "AKIAIOSFODNN7EXAMPLE"'])))).toEqual([]);
    expect(run(secretAdded, change(update('src/a.ts', [], ['api_key: "your-api-key-here"'])))).toEqual([]);
    expect(run(secretAdded, change(update('.env', [], ['API_KEY=AKIAABCDEFGHIJKLMNOP'])))).toEqual([]);
  });
  it('only looks at added lines', () => {
    expect(run(secretAdded, change(update('src/a.ts', ['k = "AKIAABCDEFGHIJKLMNOP"'], [])))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx jest src/plugin/rubric/checks/__tests__/hard.test.ts`
Expected: FAIL, "Cannot find module '../hard'".

- [ ] **Step 4: Implement `checks/hard.ts`**

```ts
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
  const root = a.workspaceRoot;
  if (path.basename(abs) === '.cline-shield.yml' && [root, a.homeDir].includes(path.dirname(abs))) return true;
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
```

Note: the `your-api-key-here` placeholder is excluded by the generic pattern's "must contain a digit" lookahead.

- [ ] **Step 5: Run tests**

Run: `npx jest src/plugin/rubric/checks/__tests__/hard.test.ts`
Expected: PASS. If a placeholder regex misses or over-fires a listed case, adjust the regex, not the test.

- [ ] **Step 6: Commit**

```bash
git add clineshield/src/plugin/rubric
git commit -m "feat(rubric): add hard rules (self-protection, placeholder, secret added)"
```

---

### Task 5: Size, file-operation and sensitive-file checks

**Files:**
- Create: `clineshield/src/plugin/rubric/checks/files.ts`
- Test: `clineshield/src/plugin/rubric/checks/__tests__/files.test.ts`

**Interfaces:**
- Consumes: path classifiers, `matchesGlob`, fixtures.
- Produces: `rewriteShare(c: FileChange): number | undefined` (0..1, file-relative; patch-relative fallback), and checks `sizeCheck` (signal: `rewrite_share`, `lines_removed`, `deletion_heavy`), `filesTouched` (signal, `perAction`), `fileOpsCheck` (critical: `file_deleted`, `move_overwrites`, `uncommitted_lost`, `outside_workspace`), `sensitiveCheck` (critical: `secrets_file`, `ci_config`, `infra`, `migration`, `protected_path`, `gitignore_changed`, `gitignore_unignores_secrets`), `locationCheck` (signal: `manifest`, `generated`).

Rules:
- `rewriteShare`: `update` with known original, `matched`, `originalLineCount ≥ 20` → `removed.length / originalLineCount`. Else (original unknown or unmatched) → patch-relative `(added+removed)/(added+removed+contextLines)` only when that total > 10; else undefined. For `add` → undefined.
- `rewrite_share`: share ≥ 0.75 → weight 1; ≥ 0.40 → 0.5. Always report `counts.structuralChangePercent = floor(share*100)` when share is defined (weight 0 findings are not emitted; put the percent on whichever finding fires, and the engine falls back to `rewriteShare` for events — see Task 10).
- `lines_removed`: > 300 → 1; > 100 → 0.5.
- `deletion_heavy`: removed ≥ 30 and removed ≥ 4 × added → weight 1 (log-only by category kind).
- `files_touched`: n = action.changes.length; > 15 → 1; > 5 → 0.5.
- `file_deleted`: kind `delete`. `move_overwrites`: `moveTargetExists`. `outside_workspace`: `outsideWorkspace`.
- `uncommitted_lost`: `gitDirty === true` and (delete, or moveTo, or rewriteShare ≥ 0.75).
- Sensitive: test `path` and `moveTo`. `protected_path`: `options.protectedPaths` + `action.codeownersGlobs` via `matchesGlob`. `gitignore_*`: basename `.gitignore`; unignores = an added line `^!.*(\.env|\.pem|\.key|secret|credential)` (i) or a removed line `^/?(\*\*/)?(\.env\S*|\*\.pem|\*\.key|\S*secret\S*|\S*credential\S*)$` (i); if unignores fires, do not also emit `gitignore_changed`.

- [ ] **Step 1: Write the failing test**

```ts
import { fileOpsCheck, filesTouched, locationCheck, rewriteShare, sensitiveCheck, sizeCheck } from '../files';
import { OPTS, action, change, ids, update } from '../../__tests__/fixtures';
import type { Check } from '../../types';

const run = (check: Check, c: ReturnType<typeof change>, opts = OPTS) => check.run(c, action([c]), opts);
const lines = (n: number, p = 'l') => Array.from({ length: n }, (_, i) => `${p}${i}`);
const file = (n: number) => lines(n).join('\n') + '\n';

describe('rewriteShare', () => {
  it('is file-relative when the original is known', () => {
    const c = change(update('a.ts', lines(10), ['x'], []), { original: file(40) });
    c.matched = true;
    expect(rewriteShare(c)).toBe(0.25);
  });
  it('falls back to patch-relative for unknown originals, only above 10 patch lines', () => {
    expect(rewriteShare(change(update('a.ts', lines(8), lines(8, 'n'), ['c1', 'c2'])))).toBeCloseTo(16 / 18);
    expect(rewriteShare(change(update('a.ts', ['a'], ['b'])))).toBeUndefined();
  });
  it('ignores small files (< 20 lines)', () => {
    const c = change(update('a.ts', lines(10), [], []), { original: file(10) });
    c.matched = true;
    expect(rewriteShare(c)).toBeUndefined();
  });
});

describe('sizeCheck', () => {
  const sized = (removed: number, total: number) => {
    const c = change(update('a.ts', lines(removed), ['x'], []), { original: file(total) });
    c.matched = true;
    return c;
  };
  it('small edit to a big file: nothing', () => expect(run(sizeCheck, sized(3, 2000))).toEqual([]));
  it('≥ 40 % → half weight, ≥ 75 % → full', () => {
    expect(run(sizeCheck, sized(20, 40))).toEqual([expect.objectContaining({ category: 'rewrite_share', weight: 0.5 })]);
    expect(run(sizeCheck, sized(38, 40))).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'rewrite_share', weight: 1 })]));
  });
  it('lines removed bands and deletion-heavy', () => {
    const c = sized(150, 2000);
    expect(ids(run(sizeCheck, c)).sort()).toEqual(['deletion_heavy', 'lines_removed']);
    expect(run(sizeCheck, sized(301, 20000)).find(f => f.category === 'lines_removed')?.weight).toBe(1);
  });
  it('new files never score size', () => {
    expect(run(sizeCheck, change(['*** Add File: n.ts', ...lines(400).map(l => `+${l}`)]))).toEqual([]);
  });
});

describe('filesTouched', () => {
  it('bands on the number of files in the action', () => {
    const cs = (n: number) => Array.from({ length: n }, (_, i) => change(update(`f${i}.ts`, ['a'], ['b'])));
    expect(filesTouched.run(cs(5)[0], action(cs(5)), OPTS)).toEqual([]);
    expect(filesTouched.run(cs(6)[0], action(cs(6)), OPTS)[0].weight).toBe(0.5);
    expect(filesTouched.run(cs(16)[0], action(cs(16)), OPTS)[0].weight).toBe(1);
  });
});

describe('fileOpsCheck', () => {
  it('delete, delete with uncommitted changes', () => {
    expect(ids(run(fileOpsCheck, change(['*** Delete File: a.ts'])))).toEqual(['file_deleted']);
    expect(ids(run(fileOpsCheck, change(['*** Delete File: a.ts'], { gitDirty: true })))).toEqual(['file_deleted', 'uncommitted_lost']);
  });
  it('move onto an existing file, outside workspace', () => {
    const mv = change(['*** Update File: a.ts', '*** Move to: b.ts', '@@', '-a', '+b'], { moveTargetExists: true });
    expect(ids(run(fileOpsCheck, mv))).toEqual(['move_overwrites']);
    expect(ids(run(fileOpsCheck, change(update('/etc/x', ['a'], ['b']), { outsideWorkspace: true })))).toEqual(['outside_workspace']);
  });
  it('dirty file with a small edit is fine', () => {
    expect(run(fileOpsCheck, change(update('a.ts', ['a'], ['b']), { gitDirty: true }))).toEqual([]);
  });
});

describe('sensitiveCheck', () => {
  it.each([
    ['.env', 'secrets_file'], ['.github/workflows/ci.yml', 'ci_config'], ['Dockerfile', 'infra'],
    ['migrations/001.sql', 'migration'], ['.gitignore', 'gitignore_changed'],
  ])('%s → %s', (p, id) => expect(ids(run(sensitiveCheck, change(update(p, ['a'], ['b']))))).toEqual([id]));

  it('protected paths from config and CODEOWNERS', () => {
    const c = change(update('src/payments/pay.ts', ['a'], ['b']));
    expect(ids(sensitiveCheck.run(c, action([c]), { ...OPTS, protectedPaths: ['src/payments/**'] }))).toEqual(['protected_path']);
    expect(ids(sensitiveCheck.run(c, action([c], { codeownersGlobs: ['src/payments/**'] }), OPTS))).toEqual(['protected_path']);
  });

  it('gitignore un-ignoring secrets replaces the plain change finding', () => {
    expect(ids(run(sensitiveCheck, change(update('.gitignore', ['.env'], []))))).toEqual(['gitignore_unignores_secrets']);
    expect(ids(run(sensitiveCheck, change(update('.gitignore', [], ['!.env.local']))))).toEqual(['gitignore_unignores_secrets']);
  });

  it('checks the move target too', () => {
    const c = change(['*** Update File: notes.txt', '*** Move to: .env', '@@', '-a', '+b']);
    expect(ids(run(sensitiveCheck, c))).toEqual(['secrets_file']);
  });
});

describe('locationCheck', () => {
  it('manifest and generated', () => {
    expect(ids(run(locationCheck, change(update('package.json', ['a'], ['b']))))).toEqual(['manifest']);
    expect(ids(run(locationCheck, change(update('dist/a.js', ['a'], ['b']))))).toEqual(['generated']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/plugin/rubric/checks/__tests__/files.test.ts`
Expected: FAIL, "Cannot find module '../files'".

- [ ] **Step 3: Implement `checks/files.ts`**

```ts
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
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/plugin/rubric/checks/__tests__/files.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add clineshield/src/plugin/rubric
git commit -m "feat(rubric): add size, file-operation and sensitive-file checks

- File-relative rewrite share with patch-relative fallback
- Uncommitted-changes, move-overwrite, outside-workspace, CODEOWNERS"
```

---

### Task 6: Weakening-safety and code-structure checks (language packs)

**Files:**
- Create: `clineshield/src/plugin/rubric/checks/tests.ts`, `clineshield/src/plugin/rubric/checks/structure.ts`
- Test: `clineshield/src/plugin/rubric/checks/__tests__/tests.test.ts`, `structure.test.ts`

**Interfaces:**
- Consumes: `languageOf`, `isTestPath`, fixtures.
- Produces: `testsCheck: Check` (signal; `tests_deleted`, `tests_skipped`, `checks_disabled`, `assertions_weakened`, `expected_changed`), `testAndSource: Check` (signal, `perAction`), `structureCheck: Check` (signal; `functions_removed`, `exports_removed`, `signature_changed`, `env_key_renamed`); helper `definitions(lines: string[], lang: Language): Map<string, string>` (name → line).

Rules:
- `tests_skipped` / `checks_disabled`: any **added** line matches the language pack (any file for `checks_disabled`; `tests_skipped` too, because skip markers only appear in tests). Language unknown → JS pack + Python pack.
- In test files only: `tests_deleted` = test file deleted, or more test declarations removed than added (weight = min(n,1) → 1). `assertions_weakened` = more assertion lines removed than added, or a strong JS/Python matcher replaced by a weak one in the same hunk. `expected_changed` = in one hunk, a removed and an added assertion line are identical after replacing string and number literals with `_`, but differ as written.
- `test_and_source` (action-level): the action changes at least one test file and at least one non-test source file (a file with a `languageOf`).
- Structure (skip `delete` and `add`): names defined in removed lines minus names defined in added lines → `functions_removed` weight `min(n*10,40)/40`, `counts.functionsDeleted = n`. Exports: same for exported definitions → `exports_removed` weight `min(n*20,40)/40`, `counts.exportsDeleted = n`. `signature_changed`: a name both removed and added whose definition lines differ (after trimming). `env_key_renamed`: env keys referenced in removed lines but not added lines, while the hunk adds a different key.

- [ ] **Step 1: Write the failing tests**

`tests.test.ts`:
```ts
import { testAndSource, testsCheck } from '../tests';
import { OPTS, action, change, ids, update } from '../../__tests__/fixtures';

const run = (c: ReturnType<typeof change>) => testsCheck.run(c, action([c]), OPTS);

describe('testsCheck', () => {
  it.each([
    ['src/a.test.ts', "it.skip('works', () => {})"],
    ['src/a.test.ts', "xit('works', () => {})"],
    ['tests/test_a.py', '@pytest.mark.skip(reason="x")'],
    ['pkg/a_test.go', '\tt.Skip("later")'],
    ['src/test/FooTest.java', '@Disabled'],
    ['tests/a.rs', '#[ignore]'],
    ['spec/a_spec.rb', "xit 'works' do"],
  ])('tests_skipped in %s', (file, line) => {
    expect(ids(run(change(update(file, [], [line]))))).toContain('tests_skipped');
  });

  it.each([
    ['src/a.ts', '// eslint-disable-next-line'],
    ['src/a.ts', '// @ts-ignore'],
    ['a.py', 'x = f()  # type: ignore'],
    ['a.py', 'import os  # noqa'],
    ['a.go', 'x := 1 //nolint'],
    ['A.java', '@SuppressWarnings("unchecked")'],
    ['a.rs', '#[allow(dead_code)]'],
    ['a.rb', '# rubocop:disable Metrics/AbcSize'],
  ])('checks_disabled in %s', (file, line) => {
    expect(ids(run(change(update(file, [], [line]))))).toContain('checks_disabled');
  });

  it('tests_deleted: test file deleted or test cases removed', () => {
    expect(ids(run(change(['*** Delete File: src/a.test.ts'])))).toContain('tests_deleted');
    expect(ids(run(change(update('src/a.test.ts', ["it('a', () => {", 'expect(1).toBe(1);', '});'], []))))).toContain('tests_deleted');
    expect(ids(run(change(update('tests/test_a.py', ['def test_a():', '    assert f() == 1'], []))))).toContain('tests_deleted');
  });

  it('assertions_weakened: removed or strong → weak', () => {
    expect(ids(run(change(update('src/a.test.ts', ['expect(f()).toBe(3);'], []))))).toContain('assertions_weakened');
    expect(ids(run(change(update('src/a.test.ts', ['expect(f()).toEqual({a: 1});'], ['expect(f()).toBeDefined();']))))).toContain('assertions_weakened');
    expect(ids(run(change(update('tests/test_a.py', ['self.assertEqual(f(), 3)'], ['self.assertTrue(f())']))))).toContain('assertions_weakened');
  });

  it('expected_changed: same assertion, different literal', () => {
    expect(ids(run(change(update('src/a.test.ts', ['expect(sum(1, 2)).toBe(3);'], ['expect(sum(1, 2)).toBe(4);']))))).toEqual(['expected_changed']);
  });

  it('adding a new assertion or test is fine', () => {
    expect(run(change(update('src/a.test.ts', [], ["it('b', () => {", 'expect(2).toBe(2);', '});'])))).toEqual([]);
  });

  it('assertion rules only apply to test files', () => {
    expect(run(change(update('src/a.ts', ['assert(x);'], [])))).toEqual([]);
  });
});

describe('testAndSource', () => {
  it('fires when one action changes tests and source', () => {
    const t = change(update('src/a.test.ts', ['a'], ['b']));
    const s = change(update('src/a.ts', ['a'], ['b']));
    expect(ids(testAndSource.run(t, action([t, s]), OPTS))).toEqual(['test_and_source']);
    expect(testAndSource.run(t, action([t]), OPTS)).toEqual([]);
  });
});
```

`structure.test.ts`:
```ts
import { definitions, structureCheck } from '../structure';
import { OPTS, action, change, ids, update } from '../../__tests__/fixtures';

const run = (c: ReturnType<typeof change>) => structureCheck.run(c, action([c]), OPTS);

describe('definitions', () => {
  it.each([
    ['js', 'export async function load(a) {', 'load'],
    ['js', 'const handler = async (req) => {', 'handler'],
    ['js', 'class Foo extends Bar {', 'Foo'],
    ['js', '  async save(item) {', 'save'],
    ['py', 'def parse(x):', 'parse'],
    ['py', '    async def fetch(self):', 'fetch'],
    ['go', 'func (s *Server) Start(ctx context.Context) error {', 'Start'],
    ['java', '  public static int add(int a, int b) {', 'add'],
    ['rs', 'pub async fn run() -> Result<()> {', 'run'],
    ['rb', 'def self.call(x)', 'call'],
  ] as const)('%s: %s → %s', (lang, line, name) => {
    expect([...definitions([line], lang).keys()]).toEqual([name]);
  });
  it('does not treat control flow as methods', () => {
    expect(definitions(['  if (x) {', '  for (const a of b) {', '  while (y) {'], 'js').size).toBe(0);
  });
});

describe('structureCheck', () => {
  it('counts removed functions not re-added (10 each, max 40)', () => {
    const f = run(change(update('a.ts', ['function a() {}', 'function b() {}', 'function keep() {}'], ['function keep() { return 1; }'])));
    const fr = f.find(x => x.category === 'functions_removed')!;
    expect(fr.weight).toBe(0.5);
    expect(fr.counts?.functionsDeleted).toBe(2);
    expect(ids(f)).toContain('signature_changed');
  });

  it('exports removed or renamed', () => {
    const f = run(change(update('a.ts', ['export function oldName() {}'], ['export function newName() {}'])));
    expect(f.find(x => x.category === 'exports_removed')?.counts?.exportsDeleted).toBe(1);
  });

  it('go: capitalised names are exports', () => {
    const f = run(change(update('a.go', ['func Public() {}', 'func private() {}'], [])));
    expect(f.find(x => x.category === 'exports_removed')?.counts?.exportsDeleted).toBe(1);
    expect(f.find(x => x.category === 'functions_removed')?.counts?.functionsDeleted).toBe(2);
  });

  it('env key renamed', () => {
    const f = run(change(update('a.ts', ['const u = process.env.DB_URL;'], ['const u = process.env.DATABASE_URL;'])));
    expect(ids(f)).toContain('env_key_renamed');
    const env = run(change(update('.env.example', ['API_HOST=x'], ['API_URL=x'])));
    expect(ids(env)).toContain('env_key_renamed');
  });

  it('skips new and deleted files and unknown languages for definitions', () => {
    expect(run(change(['*** Delete File: a.ts']))).toEqual([]);
    expect(run(change(update('a.md', ['# def x():'], [])))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/plugin/rubric/checks/__tests__/tests.test.ts src/plugin/rubric/checks/__tests__/structure.test.ts`
Expected: FAIL, "Cannot find module".

- [ ] **Step 3: Implement `checks/tests.ts`**

```ts
/**
 * tests.ts
 *
 * Weakening-safety categories with per-language pattern packs
 * (JS/TS, Python, Go, Java/Kotlin, Rust, Ruby).
 */

import { languageOf } from '../paths';
import type { Language } from '../paths';
import type { Check, FileChange, RawFinding } from '../types';

type Pack = Record<Language, RegExp>;

const SKIP: Pack = {
  js: /\b(it|test|describe)\.(skip|todo)\s*\(|\bx(it|test|describe)\s*\(/,
  py: /@(pytest\.mark\.skip(if)?|unittest\.skip\w*)|\bpytest\.skip\s*\(/,
  go: /\bt\.Skip(f|Now)?\s*\(/,
  java: /@(Ignore|Disabled)\b/,
  rs: /#\[ignore\]/,
  rb: /^\s*(xit|xdescribe|xcontext)\b|\bskip\s*(\(|['"]|$)/,
};

const DISABLE: Pack = {
  js: /eslint-disable|@ts-(ignore|nocheck|expect-error)/,
  py: /#\s*(noqa|type:\s*ignore|pylint:\s*disable)/,
  go: /\/\/\s*nolint/,
  java: /@SuppressWarnings\b/,
  rs: /#!?\[allow\(/,
  rb: /rubocop:disable/,
};

const TEST_DECL: Pack = {
  js: /\b(it|test)\s*\(\s*['"`]/,
  py: /^\s*(async\s+)?def\s+test_\w*/,
  go: /^func\s+Test\w*\s*\(/,
  java: /@Test\b/,
  rs: /#\[(tokio::)?test\]/,
  rb: /^\s*(it|test)\s+['"]/,
};

const ASSERT: Pack = {
  js: /\bexpect\s*\(|\bassert(\.\w+)?\s*\(/,
  py: /^\s*assert\b|\bself\.assert\w+\s*\(/,
  go: /\b(assert|require)\.\w+\s*\(|\bt\.(Error|Fatal)f?\s*\(/,
  java: /\bassert\w*\s*\(/,
  rs: /\bassert(_eq|_ne)?!\s*\(/,
  rb: /\bexpect\s*\(|\bassert(_\w+)?\b/,
};

const STRONG: Partial<Pack> = {
  js: /\.(toBe|toEqual|toStrictEqual|toThrow\w*|toHaveBeenCalledWith|toMatch\w*)\s*\(/,
  py: /\bassert(Equal|Raises|In|Is|DictEqual|ListEqual)\b|==/,
};
const WEAK: Partial<Pack> = {
  js: /\.(toBeDefined|toBeTruthy|toBeFalsy|not\.toBeNull|not\.toThrow)\s*\(\s*\)|\.toBeGreaterThan(OrEqual)?\s*\(\s*0\s*\)/,
  py: /\bassert(True|IsNotNone|False)\b/,
};

const LANGS_FALLBACK: Language[] = ['js', 'py'];
const packFor = (p: Pack, lang: Language | undefined) => (lang ? [p[lang]] : LANGS_FALLBACK.map(l => p[l]));
const count = (lines: string[], rs: RegExp[]) => lines.filter(l => rs.some(r => r.test(l))).length;
const LITERAL = /(['"`])(?:\\.|(?!\1).)*\1|\b\d+(\.\d+)?\b/g;

export const testsCheck: Check = {
  name: 'tests',
  kind: 'signal',
  run(c: FileChange) {
    const out: RawFinding[] = [];
    const lang = languageOf(c.path);
    const add = (category: RawFinding['category'], detail: string) => out.push({ category, weight: 1, detail });

    if (count(c.added, packFor(SKIP, lang)) > 0) add('tests_skipped', 'marks tests as skipped');
    if (count(c.added, packFor(DISABLE, lang)) > 0) add('checks_disabled', 'disables a lint or type check');
    if (!c.isTest) return out;

    const decl = packFor(TEST_DECL, lang);
    if (c.kind === 'delete') add('tests_deleted', `deletes test file ${c.path}`);
    else if (count(c.removed, decl) > count(c.added, decl)) add('tests_deleted', `removes ${count(c.removed, decl) - count(c.added, decl)} test case(s)`);

    const asserts = packFor(ASSERT, lang);
    let weakened = c.kind !== 'delete' && count(c.removed, asserts) > count(c.added, asserts);
    let expectedChanged = false;
    for (const h of c.hunks) {
      const strong = lang && STRONG[lang];
      const weak = lang && WEAK[lang];
      if (strong && weak && h.removed.some(l => strong.test(l)) && h.added.some(l => weak.test(l))) weakened = true;
      const rem = h.removed.filter(l => asserts.some(r => r.test(l)));
      const addA = h.added.filter(l => asserts.some(r => r.test(l)));
      for (const r of rem) {
        const shape = r.trim().replace(LITERAL, '_');
        if (addA.some(a => a.trim() !== r.trim() && a.trim().replace(LITERAL, '_') === shape)) expectedChanged = true;
      }
    }
    if (weakened) add('assertions_weakened', 'removes or weakens assertions');
    if (expectedChanged) add('expected_changed', 'changes expected values in assertions');
    return out;
  },
};

export const testAndSource: Check = {
  name: 'test_and_source',
  kind: 'signal',
  perAction: true,
  run(_c, a) {
    const tests = a.changes.some(c => c.isTest);
    const source = a.changes.some(c => !c.isTest && languageOf(c.path) !== undefined);
    return tests && source ? [{ category: 'test_and_source', weight: 1, detail: 'changes tests and source code in one action' }] : [];
  },
};
```

Note: in the `expected_changed` test the removed line also counts as one removed assertion and one added, so `assertions_weakened` must not fire (counts equal). The test asserts exactly `['expected_changed']`.

- [ ] **Step 4: Implement `checks/structure.ts`**

```ts
/**
 * structure.ts
 *
 * Code-structure categories by per-language line patterns (tree-sitter is
 * "Later" in SPEC.md). A name counts as removed when a definition of it is
 * in the removed lines and not in the added lines.
 */

import { languageOf } from '../paths';
import type { Language } from '../paths';
import type { Check, RawFinding } from '../types';

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'with', 'elif', 'match']);

const DEF: Record<Language, RegExp[]> = {
  js: [
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|\w+)\s*=>/,
    /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/,
    /^\s+(?:(?:public|private|protected|static|async|override|readonly)\s+)*(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/,
  ],
  py: [/^\s*(?:async\s+)?def\s+(\w+)/, /^\s*class\s+(\w+)/],
  go: [/^func\s+(?:\([^)]*\)\s*)?(\w+)/, /^type\s+(\w+)\s+(?:struct|interface)\b/],
  java: [
    /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|override|suspend|open)\s+)+[\w<>[\],.? ]*?\s*(\w+)\s*\(/,
    /^\s*(?:(?:public|private|protected|static|final|abstract|data|open)\s+)*(?:class|interface|enum|object)\s+(\w+)/,
    /^\s*fun\s+(\w+)/,
  ],
  rs: [/^\s*(?:pub(?:\([\w:]+\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)/, /^\s*(?:pub(?:\([\w:]+\))?\s+)?(?:struct|enum|trait)\s+(\w+)/],
  rb: [/^\s*def\s+(?:self\.)?(\w+[?!]?)/, /^\s*(?:class|module)\s+(\w+)/],
};

const EXPORTED: Record<Language, (line: string, name: string) => boolean> = {
  js: line => /^\s*export\b/.test(line),
  py: () => false,
  go: (_l, name) => /^[A-Z]/.test(name),
  java: line => /\bpublic\b/.test(line),
  rs: line => /^\s*pub\b/.test(line),
  rb: () => false,
};

export function definitions(lines: string[], lang: Language): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of lines) {
    for (const r of DEF[lang]) {
      const m = r.exec(line);
      if (m && !KEYWORDS.has(m[1])) { out.set(m[1], line.trim()); break; }
    }
  }
  return out;
}

const ENV_REF = [
  /process\.env\.([A-Z_][A-Z0-9_]*)/g, /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
  /os\.environ(?:\.get)?[[(]\s*['"]([A-Z_][A-Z0-9_]*)['"]/g, /os\.getenv\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
  /os\.Getenv\("([A-Z_][A-Z0-9_]*)"\)/g, /ENV\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
  /System\.getenv\("([A-Z_][A-Z0-9_]*)"\)/g, /env::var\("([A-Z_][A-Z0-9_]*)"\)/g,
];
const ENV_FILE_KEY = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/;
const isEnvFile = (p: string) => /(^|\/)\.env(\.[\w-]+)?$/.test(p);

function envKeys(lines: string[], envFile: boolean): Set<string> {
  const keys = new Set<string>();
  for (const l of lines) {
    if (envFile) { const m = ENV_FILE_KEY.exec(l); if (m) keys.add(m[1]); }
    for (const r of ENV_REF) for (const m of l.matchAll(r)) keys.add(m[1]);
  }
  return keys;
}

export const structureCheck: Check = {
  name: 'structure',
  kind: 'signal',
  run(c) {
    if (c.kind !== 'update') return [];
    const out: RawFinding[] = [];
    const envFile = isEnvFile(c.path);
    for (const h of c.hunks) {
      const removedKeys = envKeys(h.removed, envFile);
      const addedKeys = envKeys(h.added, envFile);
      const gone = [...removedKeys].filter(k => !addedKeys.has(k));
      const fresh = [...addedKeys].filter(k => !removedKeys.has(k));
      if (gone.length && fresh.length) {
        out.push({ category: 'env_key_renamed', weight: 1, detail: `renames ${gone[0]} to ${fresh[0]}` });
        break;
      }
    }
    const lang = languageOf(c.path);
    if (!lang) return out;
    const removed = definitions(c.removed, lang);
    const added = definitions(c.added, lang);
    const gone = [...removed.keys()].filter(n => !added.has(n));
    const changedSig = [...removed.keys()].filter(n => added.has(n) && added.get(n) !== removed.get(n));
    const exportsGone = gone.filter(n => EXPORTED[lang](removed.get(n)!, n));
    if (gone.length) {
      out.push({ category: 'functions_removed', weight: Math.min(gone.length * 10, 40) / 40, detail: `removes ${gone.length} function(s)/class(es): ${gone.slice(0, 3).join(', ')}`, counts: { functionsDeleted: gone.length } });
    }
    if (exportsGone.length) {
      out.push({ category: 'exports_removed', weight: Math.min(exportsGone.length * 20, 40) / 40, detail: `removes or renames export(s): ${exportsGone.slice(0, 3).join(', ')}`, counts: { exportsDeleted: exportsGone.length } });
    }
    if (changedSig.length) out.push({ category: 'signature_changed', weight: 1, detail: `changes the signature of ${changedSig[0]}` });
    return out;
  },
};
```

- [ ] **Step 5: Run tests**

Run: `npx jest src/plugin/rubric/checks/__tests__`
Expected: PASS. Fix regexes (not tests) on mismatch.

- [ ] **Step 6: Commit**

```bash
git add clineshield/src/plugin/rubric
git commit -m "feat(rubric): add weakening-safety and code-structure checks

- Pattern packs for JS/TS, Python, Go, Java/Kotlin, Rust, Ruby
- Skips, disabled checks, deleted tests, weakened assertions, changed expectations
- Removed functions/exports by name; signature and env-key renames (log-only)"
```

---

### Task 7: Content checks

**Files:**
- Create: `clineshield/src/plugin/rubric/checks/content.ts`
- Test: `clineshield/src/plugin/rubric/checks/__tests__/content.test.ts`

**Interfaces:**
- Consumes: fixtures, `CheckOptions.trustedDomains`.
- Produces: `contentCheck: Check` (signal; `security_weakened`, `auth_removed`, `validation_removed`, `sql_string_built`, `new_domain`, `empty_catch`, `commented_out_block`).

Rules: added lines only, except `auth_removed` / `validation_removed` which fire when the **removed** lines contain more matches than the added lines (moving a check is fine). Skipped for `delete`. `new_domain`: hosts in added `https?://host` URLs that are not in `original` (or in any removed line when the original is unknown), not `localhost`, `127.0.0.1`, `0.0.0.0`, `example.com/org/net` or their subdomains, and not a trusted domain (exact or subdomain). `commented_out_block`: ≥ 5 consecutive added comment lines (`//` or `#`) that each contain one of `; { } ( ) =`.

- [ ] **Step 1: Write the failing test**

```ts
import { contentCheck } from '../content';
import { OPTS, action, change, ids, update } from '../../__tests__/fixtures';

const run = (c: ReturnType<typeof change>, opts = OPTS) => contentCheck.run(c, action([c]), opts);
const added = (file: string, lines: string[], info = {}) => run(change(update(file, [], lines), info));

describe('contentCheck', () => {
  it.each([
    'const agent = new https.Agent({ rejectUnauthorized: false });',
    "res.setHeader('Access-Control-Allow-Origin', '*');",
    "app.use(cors({ origin: '*' }));",
    'const r = eval(userInput);',
    "const f = new Function('a', body);",
    "exec(`rm ${dir}`, cb); // child_process",
    'subprocess.run(cmd, shell=True)',
    'os.system(cmd)',
    '<div dangerouslySetInnerHTML={{ __html: html }} />',
    'app.use(csrf({ csrf: false }));',
    'http.csrf().disable();',
    'requests.get(url, verify=False)',
  ])('security_weakened: %s', line => {
    expect(ids(added('src/a.ts', [line]))).toContain('security_weakened');
  });

  it('does not flag regex.exec or evaluate()', () => {
    expect(added('src/a.ts', ['const m = re.exec(s);', 'page.evaluate(fn);'])).toEqual([]);
  });

  it('auth_removed / validation_removed fire on net removal only', () => {
    expect(ids(run(change(update('src/r.ts', ['router.get("/a", requireAuth, h);'], ['router.get("/a", h);']))))).toContain('auth_removed');
    expect(run(change(update('src/r.ts', ['router.get("/a", requireAuth, h);'], ['router.get("/b", requireAuth, h);'])))).toEqual([]);
    expect(ids(run(change(update('src/r.ts', ['const body = schema.validate(req.body);'], ['const body = req.body;']))))).toContain('validation_removed');
    expect(ids(run(change(update('app.py', ['@login_required'], []))))).toContain('auth_removed');
  });

  it.each([
    'db.query("SELECT * FROM users WHERE id = " + id);',
    'db.query(`DELETE FROM t WHERE id = ${id}`);',
    'cur.execute(f"SELECT * FROM t WHERE name = {name}")',
    'cur.execute("UPDATE t SET a = %s" % a)',
  ])('sql_string_built: %s', line => {
    expect(ids(added('src/db.ts', [line]))).toContain('sql_string_built');
  });

  it('parameterised SQL is fine', () => {
    expect(added('src/db.ts', ["db.query('SELECT * FROM users WHERE id = $1', [id]);"])).toEqual([]);
  });

  it('new_domain: unknown host fires; known, trusted and local hosts do not', () => {
    expect(ids(added('src/a.ts', ["fetch('https://evil.io/x')"], { original: "fetch('https://api.github.com')\n" }))).toEqual(['new_domain']);
    expect(added('src/a.ts', ["fetch('https://api.github.com/y')"], { original: "fetch('https://api.github.com')\n" })).toEqual([]);
    expect(run(change(update('src/a.ts', [], ["fetch('https://a.corp.com')"])), { ...OPTS, trustedDomains: ['corp.com'] })).toEqual([]);
    expect(added('src/a.ts', ["fetch('http://localhost:3000')", "u = 'https://example.com'"])).toEqual([]);
  });

  it('empty catch', () => {
    expect(ids(added('src/a.ts', ['} catch (e) {}']))).toEqual(['empty_catch']);
    expect(ids(added('a.py', ['except Exception:', '    pass']))).toEqual(['empty_catch']);
  });

  it('commented-out block of 5+ code lines', () => {
    const block = ['// const a = 1;', '// if (a) {', '//   run(a);', '// }', '// return a;'];
    expect(ids(added('src/a.ts', block))).toEqual(['commented_out_block']);
    expect(added('src/a.ts', ['// This explains', '// the algorithm', '// in prose', '// over several', '// lines'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/plugin/rubric/checks/__tests__/content.test.ts`
Expected: FAIL, "Cannot find module '../content'".

- [ ] **Step 3: Implement `checks/content.ts`**

```ts
/**
 * content.ts
 *
 * Content categories: patterns in added lines (auth/validation: net removal).
 */

import type { Check, RawFinding } from '../types';

const SECURITY: RegExp[] = [
  /rejectUnauthorized\s*:\s*false/,
  /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/,
  /\bverify\s*=\s*False\b/,
  /InsecureSkipVerify\s*:\s*true/,
  /Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*['"]/,
  /\borigins?\s*[:=]\s*\[?\s*['"]\*['"]/,
  /allow_origins\s*=\s*\[\s*['"]\*['"]/,
  /(^|[^.\w])(eval|exec)\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bexecSync\s*\(|child_process['"]?\)?\.exec\s*\(|\bshell\s*:\s*true\b|\bshell\s*=\s*True\b|\bos\.system\s*\(/,
  /dangerouslySetInnerHTML/,
  /\bcsrf\s*:\s*false|csrf\(\)\.disable\(\)|@csrf_exempt|WTF_CSRF_ENABLED\s*=\s*False|skip_forgery_protection|protect_from_forgery\s+except/,
];

const AUTH = /\b(authenticate|authorize|authorise|requireAuth|requireLogin|requireUser|requireRole|login_required|permission_required|isAuthenticated|ensureAuthenticated|ensureLoggedIn|checkPermissions?|hasPermission|hasRole|isAdmin|verifyToken|verifyJwt|canActivate|UseGuards|PreAuthorize|Secured|RolesAllowed|authMiddleware|before_action\s+:authenticate\w*)\b|jwt\.verify|passport\.authenticate/;
const VALIDATION = /\b(validat\w*|sanitiz\w*|sanitis\w*|escapeHtml|DOMPurify|Joi\.\w+|yup\.\w+|z\.(object|string|number|array)|@Valid\w*|@Is[A-Z]\w*)/;

const SQL_VERB = String.raw`\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b`;
const SQL: RegExp[] = [
  new RegExp(String.raw`['"][^'"]*${SQL_VERB}[^'"]*['"]\s*\+`, 'i'),
  new RegExp(String.raw`\x60[^\x60]*${SQL_VERB}[^\x60]*\$\{`, 'i'),
  new RegExp(String.raw`\bf['"][^'"]*${SQL_VERB}[^'"]*\{`, 'i'),
  new RegExp(String.raw`['"][^'"]*${SQL_VERB}[^'"]*['"]\s*(%|\.format\()`, 'i'),
];

const URL_HOST = /https?:\/\/([a-z0-9.-]+)/gi;
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|(.+\.)?example\.(com|org|net))$/i;
const EMPTY_CATCH = /catch\s*(\([^)]*\))?\s*\{\s*\}/;
const PY_EXCEPT = /^\s*except\b[^:]*:\s*(pass)?\s*$/;
const CODE_COMMENT = /^\s*(\/\/|#)(?!!).*[;{}()=]/;

const countMatches = (lines: string[], r: RegExp) => lines.filter(l => r.test(l)).length;
const isUnder = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export const contentCheck: Check = {
  name: 'content',
  kind: 'signal',
  run(c, _a, o) {
    if (c.kind === 'delete') return [];
    const out: RawFinding[] = [];
    const add = (category: RawFinding['category'], detail: string) => out.push({ category, weight: 1, detail });

    const sec = c.added.find(l => SECURITY.some(r => r.test(l)));
    if (sec) add('security_weakened', `weakens a security setting ("${sec.trim().slice(0, 80)}")`);
    if (countMatches(c.removed, AUTH) > countMatches(c.added, AUTH)) add('auth_removed', 'removes an authentication or permission check');
    if (countMatches(c.removed, VALIDATION) > countMatches(c.added, VALIDATION)) add('validation_removed', 'removes input validation');
    if (c.added.some(l => SQL.some(r => r.test(l)))) add('sql_string_built', 'builds an SQL query from strings');

    const known = c.original ?? c.removed.join('\n');
    const hosts = new Set<string>();
    for (const l of c.added) for (const m of l.matchAll(URL_HOST)) hosts.add(m[1].toLowerCase());
    const fresh = [...hosts].filter(h => !known.toLowerCase().includes(h) && !LOCAL_HOSTS.test(h) && !o.trustedDomains.some(d => isUnder(h, d.toLowerCase())));
    if (fresh.length) add('new_domain', `calls a new domain: ${fresh.slice(0, 3).join(', ')}`);

    const pyEmpty = c.added.some((l, i) => PY_EXCEPT.test(l) && (/:\s*pass\s*$/.test(l) || /^\s*pass\s*$/.test(c.added[i + 1] ?? '')));
    if (c.added.some(l => EMPTY_CATCH.test(l)) || pyEmpty) add('empty_catch', 'adds an error handler that ignores the error');

    let run = 0;
    for (const l of c.added) {
      run = CODE_COMMENT.test(l) ? run + 1 : 0;
      if (run >= 5) { add('commented_out_block', 'adds a block of commented-out code'); break; }
    }
    return out;
  },
};
```

Check during Step 4: the test line ``exec(`rm ${dir}`, cb); // child_process`` matches `(^|[^.\w])(eval|exec)\s*\(`; `re.exec(s)` does not (dot before). `page.evaluate(fn)` does not (no `eval(`).

- [ ] **Step 4: Run tests**

Run: `npx jest src/plugin/rubric/checks/__tests__/content.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add clineshield/src/plugin/rubric
git commit -m "feat(rubric): add content checks

- Security-weakening patterns, removed auth/validation, SQL string building
- New outbound domains (trusted_domains aware), empty catch, commented-out code"
```

---

### Task 8: Config schema (validate, merge, resolve)

**Files:**
- Create: `clineshield/src/plugin/config/schema.ts`
- Test: `clineshield/src/plugin/config/__tests__/schema.test.ts`

**Interfaces:**
- Consumes: `CATEGORIES`, `PRESET_CUTOFFS`, `Cutoffs`, `Preset`, `CategoryId`, `matchesGlob`.
- Produces:
```ts
export type PointsSetting = number | 'off' | 'block';
export type Source = 'personal' | 'project';
export interface FolderOverride { preset?: Preset; cutoffs?: Partial<Cutoffs>; categories?: Partial<Record<CategoryId, PointsSetting>> }
export interface CustomRule { match: 'path' | 'content' | 'command'; pattern: string; points: number | 'block'; message: string; regex?: RegExp }
export interface PartialConfig {
  mode?: 'enforce' | 'observe'; preset?: Preset; onError?: 'ask' | 'allow'; offline?: boolean;
  cutoffs?: Partial<Cutoffs>; categories?: Partial<Record<CategoryId, PointsSetting>>;
  protectedPaths?: string[]; trustedCommands?: string[]; trustedDomains?: string[];
  paths?: Array<{ glob: string; override: FolderOverride }>; customRules?: CustomRule[];
}
export interface RubricConfig {
  mode: 'enforce' | 'observe'; preset: Preset; onError: 'ask' | 'allow'; offline: boolean;
  cutoffs: Partial<Cutoffs>; categories: Partial<Record<CategoryId, PointsSetting>>;
  protectedPaths: string[]; trustedCommands: string[]; trustedDomains: string[];
  paths: Array<{ glob: string; override: FolderOverride }>; customRules: CustomRule[];
}
export interface FilePolicy { cutoffs: Cutoffs; points: Record<CategoryId, PointsSetting> }
export const DEFAULT_PROTECTED_PATHS: string[]; // ['src/auth/**','src/config/**','src/middleware/**','auth/**','config/**']
export const DEFAULT_CONFIG: RubricConfig;
export function validateConfig(raw: unknown, source: Source): { config: PartialConfig; warnings: string[] };
export function mergeConfigs(personal: PartialConfig, project: PartialConfig): RubricConfig;
export function resolveFilePolicy(config: RubricConfig, path: string): FilePolicy;
```

Rules:
- Known top-level keys: `mode, preset, on_error, offline, cutoffs, categories, protected_paths, trusted_commands, trusted_domains, paths, custom_rules`. 1.x keys `no-nuke, sanity, risk, gemini_api_key` are ignored silently. Anything else → warning `unknown key "x" ignored`.
- `mode, on_error, offline, trusted_commands` in a project file → warning `"x" is only read from ~/.cline-shield.yml` and ignored.
- Enum/boolean/array-of-string type errors → warning, key dropped (default applies).
- `cutoffs`: integers 0–100, `ask < block` after filling missing from the preset, else warning and dropped.
- `categories`: known ids only; value integer 0–100, `'off'` or `'block'`; hard ids → warning `hard rule "x" can't be configured`.
- `paths`: object of glob (≤ 200 chars) → `{ preset?, cutoffs?, categories? }` validated like the top level; order kept.
- `custom_rules`: array of `{ match, pattern, points | 'block', message }`; `pattern` ≤ 200 chars; for `content`/`command` it is a regex: rejected when it fails to compile or has a nested quantifier (`/\((?:[^()\\]|\\.)*[+*}]\)[+*{?]/`), message ≤ 200 chars.
- Malformed YAML root (not an object) → warning, empty config.
- Merge: personal then project, key by key; `categories` merged by id; `cutoffs` merged by field; lists (`protectedPaths`, `trustedDomains`, `trustedCommands`, `paths`, `customRules`) concatenated (project `paths` first, so the project's folder rules win the "first match"). `protectedPaths` falls back to `DEFAULT_PROTECTED_PATHS` only when neither file sets it.
- Resolve for a path: cut-offs = preset cut-offs → `config.cutoffs` → first matching folder: its preset's cut-offs → its cutoffs. Points = category `max` → `config.categories` → folder categories. Hard categories keep `'block'`.

- [ ] **Step 1: Write the failing test**

```ts
import { DEFAULT_PROTECTED_PATHS, mergeConfigs, resolveFilePolicy, validateConfig } from '../schema';

const v = (raw: unknown, source: 'personal' | 'project' = 'personal') => validateConfig(raw, source);

describe('validateConfig', () => {
  it('accepts the spec example', () => {
    const { config, warnings } = v({
      mode: 'enforce', preset: 'balanced', on_error: 'ask', offline: false,
      cutoffs: { ask: 40, block: 70 },
      categories: { ci_config: 40, generated: 'off', tests_skipped: 'block' },
      protected_paths: ['src/payments/**'], trusted_commands: ['npm test'], trusted_domains: ['api.x.com'],
      paths: { 'src/auth/**': { preset: 'strict' }, 'tests/**': { preset: 'relaxed' } },
      custom_rules: [{ match: 'path', pattern: 'billing/**', points: 40, message: 'Billing code: ask first' }],
    });
    expect(warnings).toEqual([]);
    expect(config.categories).toEqual({ ci_config: 40, generated: 'off', tests_skipped: 'block' });
    expect(config.paths?.map(p => p.glob)).toEqual(['src/auth/**', 'tests/**']);
  });

  it('ignores 1.x keys silently and warns on unknown keys', () => {
    const { config, warnings } = v({ 'no-nuke': {}, sanity: {}, risk: {}, gemini_api_key: 'k', bogus: 1 });
    expect(config).toEqual({});
    expect(warnings).toEqual(['unknown key "bogus" ignored']);
  });

  it('loosening keys are personal-only', () => {
    const { config, warnings } = v({ mode: 'observe', on_error: 'allow', offline: true, trusted_commands: ['x'], preset: 'strict' }, 'project');
    expect(config).toEqual({ preset: 'strict' });
    expect(warnings).toHaveLength(4);
    expect(warnings[0]).toMatch(/only read from ~\/\.cline-shield\.yml/);
  });

  it('bad values fall back with a warning', () => {
    const { config, warnings } = v({
      preset: 'yolo', cutoffs: { ask: 80, block: 20 }, categories: { ci_config: 500, nope: 1, placeholder: 'off' }, offline: 'yes',
    });
    expect(config).toEqual({ categories: {} });
    expect(warnings).toHaveLength(6);
  });

  it('rejects long and catastrophic regexes', () => {
    const { config, warnings } = v({
      custom_rules: [
        { match: 'content', pattern: '(a+)+$', points: 10, message: 'x' },
        { match: 'content', pattern: 'a'.repeat(201), points: 10, message: 'x' },
        { match: 'content', pattern: '([', points: 10, message: 'x' },
        { match: 'content', pattern: 'TODO', points: 'block', message: 'no todos' },
      ],
    });
    expect(config.customRules?.map(r => r.pattern)).toEqual(['TODO']);
    expect(warnings).toHaveLength(3);
  });

  it('non-object root → warning, empty config', () => {
    expect(v('just a string')).toEqual({ config: {}, warnings: ['config is not a YAML mapping; ignored'] });
    expect(v(null)).toEqual({ config: {}, warnings: [] });
  });
});

describe('mergeConfigs + resolveFilePolicy', () => {
  it('defaults: balanced, ask on error, default protected paths', () => {
    const c = mergeConfigs({}, {});
    expect(c).toMatchObject({ mode: 'enforce', preset: 'balanced', onError: 'ask', offline: false });
    expect(c.protectedPaths).toEqual(DEFAULT_PROTECTED_PATHS);
    const p = resolveFilePolicy(c, 'src/a.ts');
    expect(p.cutoffs).toEqual({ ask: 40, block: 70 });
    expect(p.points.rewrite_share).toBe(50);
    expect(p.points.placeholder).toBe('block');
  });

  it('project overrides personal key by key; lists combine', () => {
    const personal = v({ preset: 'relaxed', categories: { ci_config: 10 }, protected_paths: ['a/**'] }).config;
    const project = v({ preset: 'strict', categories: { infra: 5 }, protected_paths: ['b/**'] }, 'project').config;
    const c = mergeConfigs(personal, project);
    expect(c.preset).toBe('strict');
    expect(c.categories).toEqual({ ci_config: 10, infra: 5 });
    expect(c.protectedPaths).toEqual(['a/**', 'b/**']);
  });

  it('per-folder override: first match wins, preset then cutoffs then categories', () => {
    const c = mergeConfigs(v({ paths: { 'src/auth/**': { preset: 'strict', categories: { manifest: 'off' } }, 'src/**': { preset: 'relaxed' } } }).config, {});
    expect(resolveFilePolicy(c, 'src/auth/login.ts')).toMatchObject({ cutoffs: { ask: 25, block: 50 }, points: { manifest: 'off' } });
    expect(resolveFilePolicy(c, 'src/x.ts').cutoffs).toEqual({ ask: 60, block: 90 });
    expect(resolveFilePolicy(c, 'docs/x.md').cutoffs).toEqual({ ask: 40, block: 70 });
  });

  it('config points replace the category max', () => {
    expect(resolveFilePolicy(mergeConfigs(v({ categories: { rewrite_share: 80 } }).config, {}), 'a.ts').points.rewrite_share).toBe(80);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/plugin/config`
Expected: FAIL, "Cannot find module '../schema'".

- [ ] **Step 3: Implement `config/schema.ts`**

```ts
/**
 * schema.ts
 *
 * Rubric configuration (SPEC.md "Rubric configuration"): allowlist
 * validation, personal + project merge, and per-file policy resolution.
 * Pure. Bad values fall back to defaults with a warning; never throws.
 */

import { CATEGORIES, PRESET_CUTOFFS } from '../rubric/categories';
import type { Cutoffs, Preset } from '../rubric/categories';
import { matchesGlob } from '../rubric/glob';
import type { CategoryId } from '../rubric/types';

export type PointsSetting = number | 'off' | 'block';
export type Source = 'personal' | 'project';
type Categories = Partial<Record<CategoryId, PointsSetting>>;

export interface FolderOverride { preset?: Preset; cutoffs?: Partial<Cutoffs>; categories?: Categories }
export interface CustomRule { match: 'path' | 'content' | 'command'; pattern: string; points: number | 'block'; message: string; regex?: RegExp }

export interface PartialConfig {
  mode?: 'enforce' | 'observe';
  preset?: Preset;
  onError?: 'ask' | 'allow';
  offline?: boolean;
  cutoffs?: Partial<Cutoffs>;
  categories?: Categories;
  protectedPaths?: string[];
  trustedCommands?: string[];
  trustedDomains?: string[];
  paths?: Array<{ glob: string; override: FolderOverride }>;
  customRules?: CustomRule[];
}

export interface RubricConfig {
  mode: 'enforce' | 'observe';
  preset: Preset;
  onError: 'ask' | 'allow';
  offline: boolean;
  cutoffs: Partial<Cutoffs>;
  categories: Categories;
  protectedPaths: string[];
  trustedCommands: string[];
  trustedDomains: string[];
  paths: Array<{ glob: string; override: FolderOverride }>;
  customRules: CustomRule[];
}

export interface FilePolicy { cutoffs: Cutoffs; points: Record<CategoryId, PointsSetting> }

/** 1.x `risk.protected_paths` directories; `.env*` is covered by `secrets_file`. */
export const DEFAULT_PROTECTED_PATHS = ['src/auth/**', 'src/config/**', 'src/middleware/**', 'auth/**', 'config/**'];

export const DEFAULT_CONFIG: RubricConfig = {
  mode: 'enforce', preset: 'balanced', onError: 'ask', offline: false, cutoffs: {}, categories: {},
  protectedPaths: DEFAULT_PROTECTED_PATHS, trustedCommands: [], trustedDomains: [], paths: [], customRules: [],
};

const PRESETS = ['relaxed', 'balanced', 'strict'];
const LEGACY_KEYS = new Set(['no-nuke', 'sanity', 'risk', 'gemini_api_key']);
const PERSONAL_ONLY = new Set(['mode', 'on_error', 'offline', 'trusted_commands']);
const MAX_PATTERN = 200;
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*}]\)[+*{?]/;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 100;
const strList = (x: unknown) => Array.isArray(x) && x.every(s => typeof s === 'string' && s.length <= MAX_PATTERN);

function cutoffsOf(raw: unknown, base: Cutoffs, where: string, warn: (m: string) => void): Partial<Cutoffs> | undefined {
  if (!isObj(raw)) { warn(`${where}cutoffs must be a mapping; ignored`); return undefined; }
  const out: Partial<Cutoffs> = {};
  for (const k of ['ask', 'block'] as const) {
    if (raw[k] === undefined) continue;
    if (!isInt(raw[k])) { warn(`${where}cutoffs.${k} must be 0-100; ignored`); return undefined; }
    out[k] = raw[k] as number;
  }
  if ((out.ask ?? base.ask) >= (out.block ?? base.block)) { warn(`${where}cutoffs.ask must be below cutoffs.block; ignored`); return undefined; }
  return out;
}

function categoriesOf(raw: unknown, where: string, warn: (m: string) => void): Categories {
  const out: Categories = {};
  if (!isObj(raw)) { warn(`${where}categories must be a mapping; ignored`); return out; }
  for (const [id, val] of Object.entries(raw)) {
    const def = CATEGORIES[id as CategoryId];
    if (!def) { warn(`${where}unknown category "${id}" ignored`); continue; }
    if (def.kind === 'hard') { warn(`${where}hard rule "${id}" can't be configured`); continue; }
    if (isInt(val) || val === 'off' || val === 'block') out[id as CategoryId] = val as PointsSetting;
    else warn(`${where}categories.${id} must be 0-100, off or block; ignored`);
  }
  return out;
}

function customRulesOf(raw: unknown, warn: (m: string) => void): CustomRule[] {
  if (!Array.isArray(raw)) { warn('custom_rules must be a list; ignored'); return []; }
  const out: CustomRule[] = [];
  raw.forEach((r, i) => {
    const where = `custom_rules[${i}]`;
    if (!isObj(r) || !['path', 'content', 'command'].includes(r.match as string) || typeof r.pattern !== 'string' || typeof r.message !== 'string') {
      warn(`${where} needs match (path|content|command), pattern and message; ignored`); return;
    }
    if (!(isInt(r.points) || r.points === 'block')) { warn(`${where}.points must be 0-100 or block; ignored`); return; }
    if (r.pattern.length > MAX_PATTERN || r.message.length > MAX_PATTERN) { warn(`${where} pattern/message longer than ${MAX_PATTERN} chars; ignored`); return; }
    const rule: CustomRule = { match: r.match as CustomRule['match'], pattern: r.pattern, points: r.points as number | 'block', message: r.message };
    if (rule.match !== 'path') {
      if (NESTED_QUANTIFIER.test(rule.pattern)) { warn(`${where}.pattern has nested repeats that could hang; ignored`); return; }
      try { rule.regex = new RegExp(rule.pattern); } catch { warn(`${where}.pattern is not a valid regex; ignored`); return; }
    }
    out.push(rule);
  });
  return out;
}

export function validateConfig(raw: unknown, source: Source): { config: PartialConfig; warnings: string[] } {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  const config: PartialConfig = {};
  if (raw === null || raw === undefined) return { config, warnings };
  if (!isObj(raw)) return { config, warnings: ['config is not a YAML mapping; ignored'] };

  for (const [key, val] of Object.entries(raw)) {
    if (LEGACY_KEYS.has(key)) continue;
    if (source === 'project' && PERSONAL_ONLY.has(key)) { warn(`"${key}" is only read from ~/.cline-shield.yml; ignored in the project file`); continue; }
    switch (key) {
      case 'mode': if (val === 'enforce' || val === 'observe') config.mode = val; else warn('mode must be enforce or observe; ignored'); break;
      case 'preset': if (PRESETS.includes(val as string)) config.preset = val as Preset; else warn('preset must be relaxed, balanced or strict; ignored'); break;
      case 'on_error': if (val === 'ask' || val === 'allow') config.onError = val; else warn('on_error must be ask or allow; ignored'); break;
      case 'offline': if (typeof val === 'boolean') config.offline = val; else warn('offline must be true or false; ignored'); break;
      case 'cutoffs': { const c = cutoffsOf(val, PRESET_CUTOFFS[config.preset ?? 'balanced'], '', warn); if (c) config.cutoffs = c; break; }
      case 'categories': config.categories = categoriesOf(val, '', warn); break;
      case 'protected_paths': if (strList(val)) config.protectedPaths = val as string[]; else warn('protected_paths must be a list of short strings; ignored'); break;
      case 'trusted_commands': if (strList(val)) config.trustedCommands = val as string[]; else warn('trusted_commands must be a list of short strings; ignored'); break;
      case 'trusted_domains': if (strList(val)) config.trustedDomains = val as string[]; else warn('trusted_domains must be a list of short strings; ignored'); break;
      case 'paths': {
        if (!isObj(val)) { warn('paths must be a mapping of glob → settings; ignored'); break; }
        config.paths = [];
        for (const [glob, o] of Object.entries(val)) {
          const where = `paths."${glob}".`;
          if (glob.length > MAX_PATTERN || !isObj(o)) { warn(`${where} invalid; ignored`); continue; }
          const override: FolderOverride = {};
          if (o.preset !== undefined) { if (PRESETS.includes(o.preset as string)) override.preset = o.preset as Preset; else warn(`${where}preset invalid; ignored`); }
          if (o.cutoffs !== undefined) { const c = cutoffsOf(o.cutoffs, PRESET_CUTOFFS[override.preset ?? 'balanced'], where, warn); if (c) override.cutoffs = c; }
          if (o.categories !== undefined) override.categories = categoriesOf(o.categories, where, warn);
          config.paths.push({ glob, override });
        }
        break;
      }
      case 'custom_rules': config.customRules = customRulesOf(val, warn); break;
      default: warn(`unknown key "${key}" ignored`);
    }
  }
  return { config, warnings };
}

export function mergeConfigs(personal: PartialConfig, project: PartialConfig): RubricConfig {
  const pick = <K extends keyof PartialConfig>(k: K) => project[k] ?? personal[k];
  const protectedSet = personal.protectedPaths !== undefined || project.protectedPaths !== undefined;
  return {
    mode: pick('mode') ?? DEFAULT_CONFIG.mode,
    preset: pick('preset') ?? DEFAULT_CONFIG.preset,
    onError: pick('onError') ?? DEFAULT_CONFIG.onError,
    offline: pick('offline') ?? DEFAULT_CONFIG.offline,
    cutoffs: { ...personal.cutoffs, ...project.cutoffs },
    categories: { ...personal.categories, ...project.categories },
    protectedPaths: protectedSet ? [...(personal.protectedPaths ?? []), ...(project.protectedPaths ?? [])] : DEFAULT_PROTECTED_PATHS,
    trustedCommands: [...(personal.trustedCommands ?? []), ...(project.trustedCommands ?? [])],
    trustedDomains: [...(personal.trustedDomains ?? []), ...(project.trustedDomains ?? [])],
    paths: [...(project.paths ?? []), ...(personal.paths ?? [])],
    customRules: [...(personal.customRules ?? []), ...(project.customRules ?? [])],
  };
}

export function resolveFilePolicy(config: RubricConfig, path: string): FilePolicy {
  const folder = config.paths.find(p => matchesGlob(path, p.glob))?.override;
  let cutoffs: Cutoffs = { ...PRESET_CUTOFFS[config.preset], ...config.cutoffs };
  if (folder?.preset) cutoffs = { ...PRESET_CUTOFFS[folder.preset] };
  if (folder?.cutoffs) cutoffs = { ...cutoffs, ...folder.cutoffs };
  const points = {} as Record<CategoryId, PointsSetting>;
  for (const [id, def] of Object.entries(CATEGORIES) as Array<[CategoryId, (typeof CATEGORIES)[CategoryId]]>) {
    points[id] = def.kind === 'hard' ? 'block' : folder?.categories?.[id] ?? config.categories[id] ?? def.max;
  }
  return { cutoffs, points };
}
```

Note on the "bad values" test count (6): `preset: 'yolo'`, `cutoffs ask>block`, `ci_config: 500`, `nope`, `placeholder` hard, `offline: 'yes'`. If the count differs because of a message split, fix the implementation to emit exactly one warning per bad value.

- [ ] **Step 4: Run tests**

Run: `npx jest src/plugin/config`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add clineshield/src/plugin/config
git commit -m "feat(config): validate, merge and resolve rubric configuration

- Allowlist validation with per-key fallback and warnings; 1.x keys ignored
- Loosening keys (mode, on_error, offline, trusted_commands) personal-only
- Per-folder overrides (first match), custom rules with regex safety caps"
```

---

### Task 9: Config store (YAML files, mtime reload), dependency, CI install check, example file

**Files:**
- Create: `clineshield/src/plugin/config/store.ts`
- Modify: `package.json` (root), `.github/workflows/ci.yml`, `.cline-shield.example.yml`
- Create: `clineshield/scripts/check-plugin-load.ts`
- Test: `clineshield/src/plugin/config/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `validateConfig`, `mergeConfigs`, `RubricConfig`.
- Produces: `class ConfigStore { constructor(opts: { workspaceRoot: string; homeDir: string }); get(): Promise<{ config: RubricConfig; warnings: string[] }> }`. Re-stats both files on every `get()` (cheap) and re-parses only when an mtime/size changes. Missing file = empty config. YAML parse error → warning `<file>: YAML parse error, file ignored`.

- [ ] **Step 1: Write the failing test**

```ts
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ConfigStore } from '../store';

describe('ConfigStore', () => {
  let ws: string;
  let home: string;
  beforeEach(async () => {
    ws = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-ws-'));
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-home-'));
  });
  afterEach(async () => {
    await fs.rm(ws, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  it('zero config → balanced defaults, no warnings', async () => {
    const { config, warnings } = await new ConfigStore({ workspaceRoot: ws, homeDir: home }).get();
    expect(config.preset).toBe('balanced');
    expect(warnings).toEqual([]);
  });

  it('merges personal and project; project cannot loosen', async () => {
    await fs.writeFile(path.join(home, '.cline-shield.yml'), 'preset: relaxed\non_error: allow\n');
    await fs.writeFile(path.join(ws, '.cline-shield.yml'), 'preset: strict\nmode: observe\n');
    const { config, warnings } = await new ConfigStore({ workspaceRoot: ws, homeDir: home }).get();
    expect(config).toMatchObject({ preset: 'strict', onError: 'allow', mode: 'enforce' });
    expect(warnings.join('\n')).toMatch(/\.cline-shield\.yml: "mode" is only read/);
  });

  it('re-reads after the file changes', async () => {
    const store = new ConfigStore({ workspaceRoot: ws, homeDir: home });
    const file = path.join(ws, '.cline-shield.yml');
    await fs.writeFile(file, 'preset: strict\n');
    expect((await store.get()).config.preset).toBe('strict');
    await fs.writeFile(file, 'preset: relaxed   \n');
    const later = new Date(Date.now() + 5000);
    await fs.utimes(file, later, later);
    expect((await store.get()).config.preset).toBe('relaxed');
  });

  it('broken YAML → file ignored with a warning', async () => {
    await fs.writeFile(path.join(ws, '.cline-shield.yml'), 'preset: [unclosed\n');
    const { config, warnings } = await new ConfigStore({ workspaceRoot: ws, homeDir: home }).get();
    expect(config.preset).toBe('balanced');
    expect(warnings[0]).toMatch(/YAML parse error/);
  });

  it('a 1.x config file loads without warnings', async () => {
    await fs.copyFile(path.join(__dirname, '../../../../../.cline-shield.example.yml'), path.join(home, '.cline-shield.yml'));
    const { warnings } = await new ConfigStore({ workspaceRoot: ws, homeDir: home }).get();
    expect(warnings).toEqual([]);
  });
});
```

Note: the last test copies the *rewritten* example file (Step 4) as the **personal** file (it sets personal-only keys); it must load clean. Also add a test with literal 1.x content:
```ts
  it('literal 1.x keys load without warnings', async () => {
    await fs.writeFile(path.join(ws, '.cline-shield.yml'), 'no-nuke:\n  max_deleted_functions: 3\nsanity:\n  tools: [eslint]\nrisk:\n  protected_paths: [src/auth/]\n');
    expect((await new ConfigStore({ workspaceRoot: ws, homeDir: home }).get()).warnings).toEqual([]);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/plugin/config/__tests__/store.test.ts`
Expected: FAIL, "Cannot find module '../store'".

- [ ] **Step 3: Implement `config/store.ts`**

```ts
/**
 * store.ts
 *
 * Loads ~/.cline-shield.yml (personal) and <workspace>/.cline-shield.yml
 * (project), re-parsing only when a file's mtime or size changes. Never throws.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { mergeConfigs, validateConfig } from './schema';
import type { PartialConfig, RubricConfig, Source } from './schema';

export const CONFIG_FILE = '.cline-shield.yml';

interface Cached { key: string; config: PartialConfig; warnings: string[] }

export class ConfigStore {
  private cache = new Map<Source, Cached>();
  constructor(private readonly opts: { workspaceRoot: string; homeDir: string }) {}

  private async load(source: Source): Promise<Cached> {
    const file = path.join(source === 'personal' ? this.opts.homeDir : this.opts.workspaceRoot, CONFIG_FILE);
    const label = source === 'personal' ? `~/${CONFIG_FILE}` : CONFIG_FILE;
    let key = 'missing';
    try {
      const st = await fs.stat(file);
      key = `${st.mtimeMs}:${st.size}`;
    } catch {
      key = 'missing';
    }
    const hit = this.cache.get(source);
    if (hit && hit.key === key) return hit;

    let entry: Cached = { key, config: {}, warnings: [] };
    if (key !== 'missing') {
      try {
        const raw = yaml.load(await fs.readFile(file, 'utf-8'), { schema: yaml.CORE_SCHEMA });
        const { config, warnings } = validateConfig(raw, source);
        entry = { key, config, warnings: warnings.map(w => `${label}: ${w}`) };
      } catch {
        entry = { key, config: {}, warnings: [`${label}: YAML parse error, file ignored`] };
      }
    }
    this.cache.set(source, entry);
    return entry;
  }

  async get(): Promise<{ config: RubricConfig; warnings: string[] }> {
    const [personal, project] = await Promise.all([this.load('personal'), this.load('project')]);
    return { config: mergeConfigs(personal.config, project.config), warnings: [...personal.warnings, ...project.warnings] };
  }
}
```

`yaml.CORE_SCHEMA` keeps parsing to plain JSON types (no custom tags).

- [ ] **Step 4: Root dependency, CI job, load-check script, example file**

Root `package.json`: add after `"repository"`:
```json
  "dependencies": {
    "js-yaml": "^4.1.1"
  },
```

`clineshield/scripts/check-plugin-load.ts`:
```ts
// Loads the plugin entry the way Cline's git install does (root deps only, .ts via jiti)
// and checks it exports an AgentPlugin. Run from the repo root in CI.
import plugin from '../src/plugin/index';

if (plugin?.name !== 'clineshield' || typeof plugin.hooks?.beforeTool !== 'function') {
  console.error('plugin did not load as an AgentPlugin');
  process.exit(1);
}
console.log('plugin loaded with root dependencies only');
```

`.github/workflows/ci.yml`: append a second job:
```yaml
  plugin-install:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install like `cline plugin install` (root deps only)
        run: npm install --omit=dev
      - name: Plugin loads without clineshield/node_modules
        run: |
          test ! -e clineshield/node_modules
          npx --yes jiti@2.7.0 clineshield/scripts/check-plugin-load.ts
```

`.cline-shield.example.yml`: replace the whole file with:
```yaml
# ClineShield configuration (2.0 plugin). Every key is optional; no file = balanced.
#
# Two files are read:
#   ~/.cline-shield.yml   personal, applies to every project
#   .cline-shield.yml     project, optional, can be committed for the team
# The project file wins key by key; lists are combined.
# Keys marked (personal only) are ignored in a project file, so a cloned repo
# can't switch protection off for you.
# Hard rules (self-protection, placeholder rewrites, secrets added) can't be configured.

mode: enforce          # enforce | observe (score and log only)       (personal only)
preset: balanced       # relaxed (60/90) | balanced (40/70) | strict (25/50)
on_error: ask          # ask | allow: what happens if ClineShield fails (personal only)
offline: false         # true = no package registry lookups           (personal only)

# Override the preset's cut-offs (0-100, ask < block)
# cutoffs: { ask: 40, block: 70 }

# Change a category's points (its maximum; bands scale with it), or off / block.
# Category ids are listed in SPEC.md "Risk rubric".
# categories:
#   ci_config: 40
#   generated: off
#   tests_skipped: block

# Extra protected paths (globs). Without this key the defaults are
# src/auth/**, src/config/**, src/middleware/**, auth/**, config/**.
# CODEOWNERS paths are always protected.
# protected_paths: ["src/payments/**"]

# trusted_commands: ["npm test", "make build"]   # never scored (personal only)
# trusted_domains: ["api.mycompany.com"]         # not counted as new domains

# Per-folder overrides; the first matching glob wins.
# paths:
#   "src/auth/**": { preset: strict }
#   "tests/**":    { preset: relaxed, categories: { tests_skipped: off } }

# Custom rules: match path (glob), content (regex on added lines) or command (regex).
# Patterns up to 200 characters; regexes with nested repeats are rejected.
# custom_rules:
#   - { match: path, pattern: "billing/**", points: 40, message: "Billing code: ask first" }

# No API keys here: the Gemini key for LLM explanations is set in the VS Code extension.
#
# 1.x hook settings (no-nuke, sanity, risk, gemini_api_key) are still read by the
# 1.x hooks until they are retired, and ignored by the plugin.
```

- [ ] **Step 5: Run tests and the load check locally**

Run: `npx jest src/plugin/config`
Expected: PASS.

Run (repo root, in a scratch clone so the worktree's symlinked `node_modules` is not used):
```bash
tmp=$(mktemp -d) && git clone -q . "$tmp/c" && cd "$tmp/c" && npm install --omit=dev --silent && npx --yes jiti@2.7.0 clineshield/scripts/check-plugin-load.ts; cd - >/dev/null
```
Expected: `plugin loaded with root dependencies only`. (Commit first if the clone needs the changes: run this after Step 6 instead.)

- [ ] **Step 6: Commit**

```bash
git add package.json .github/workflows/ci.yml .cline-shield.example.yml clineshield/scripts/check-plugin-load.ts clineshield/src/plugin/config
git commit -m "feat(config): load personal and project YAML with mtime reload

- js-yaml added to the root manifest (git install reads only root deps)
- CI job installs like cline plugin install and loads the plugin via jiti
- Example config documents every 2.0 key"
```

---

### Task 10: Engine and messages

**Files:**
- Create: `clineshield/src/plugin/rubric/checks/index.ts`, `clineshield/src/plugin/rubric/engine.ts`, `clineshield/src/plugin/rubric/messages.ts`
- Test: `clineshield/src/plugin/rubric/__tests__/engine.test.ts`, `messages.test.ts`

**Interfaces:**
- Consumes: all checks, `CATEGORIES`, `SIZE_GROUP`, `TEST_FILE_DISCOUNT`, `RubricConfig`, `resolveFilePolicy`, `rewriteShare`, `matchesGlob`.
- Produces:
```ts
// checks/index.ts
export const ALL_CHECKS: Check[]; // critical first: selfProtection, placeholder, secretAdded, fileOpsCheck, sensitiveCheck, then signals

// engine.ts
export interface Finding { id: string; points: number; block: boolean; logOnly: boolean; detail: string; fix: string }
export interface FileScore {
  file: string; score: number; tier: Tier; level: 'low' | 'medium' | 'high'; cutoffs: Cutoffs;
  findings: Finding[]; skipped: string[];
  structuralChangePercent: number; functionsDeleted: number; exportsDeleted: number;
}
export interface Decision { tier: Tier; files: FileScore[]; errored: boolean; errors: string[] }
export interface ScoreOptions { checks?: Check[]; now?: () => number; deadlineMs?: number }
export const DEADLINE_MS = 2000;
export function scoreAction(action: ActionContext, config: RubricConfig, options?: ScoreOptions): Decision;
export function levelFor(score: number, cutoffs: Cutoffs): 'low' | 'medium' | 'high';

// messages.ts
export function blockMessage(d: Decision): string;
export function askMessage(d: Decision): string;
export const REPEAT_BLOCK_NOTE: string; // "Stop and ask the user how to proceed."
```

Engine rules:
1. Start timer. For each file, for each check in order (per-action checks only once, against the first change, findings attached after scoring — step 4): `try { raw = check.run(change, action, opts) } catch`: critical → `errored = true`, push `"<check> crashed: <message>"` to `errors`; signal → push `"<check>: crashed"` to that file's `skipped` and `console.error`. Before each **signal** check: if `now() - start > deadlineMs` → push `"<check>: skipped (time)"` and skip. Critical checks always run.
2. Turn raw findings into `Finding` via the file's `resolveFilePolicy`: setting `'off'` → dropped; `'block'` → `block: true, points: 0`; number → `points = round(setting * weight)`; category kind `logOnly` → `logOnly: true, points: 0`.
3. Custom rules: `path` → `matchesGlob(file, pattern)`; `content` → `regex.test` on any added line; `command` → ignored in PR ①. Finding id `custom:<index>`, detail = message, fix = message, points or block.
4. Per-file score = sum of non-log-only points, minus `TEST_FILE_DISCOUNT` capped at the sum of `SIZE_GROUP` points when `change.isTest`; clamp 0–100. Action-level findings (files_touched, test_and_source) are added to the worst file (highest score, then first) and its score recomputed.
5. File tier: any `block` finding → `'block'`; else `score >= block` → block; `score >= ask` → ask; else allow. Action tier = worst file tier. `errored` → tier is `config.onError === 'ask' ? max(tier, 'ask')` else unchanged.
6. Event numbers: `structuralChangePercent` = `floor(rewriteShare(c)*100)` or 0; `functionsDeleted`/`exportsDeleted` from finding counts or 0.
7. `level`: `levelFor(score, cutoffs)`: `< ask` low, `< block` medium, else high; a block finding → high.

Messages (no points or cut-offs ever):
- Top 3 findings across files by (block first, then points), excluding log-only; each as `<file>: <detail>`.
- Block: `ClineShield blocked this action, so nothing was changed. Why: <a>; <b>; <c>. Fix: <fix of the top finding> Don't retry the same change in smaller pieces to get around this.`
- Ask: `ClineShield asked the user to approve this action. Why: <...>. If the user says no, don't retry the same action; ask them what they want.`
- Errored without findings: `ClineShield could not check this action and asked the user to approve it. If the user says no, ask them what they want.`

- [ ] **Step 1: Write the failing tests**

`engine.test.ts`:
```ts
import { DEADLINE_MS, levelFor, scoreAction } from '../engine';
import { mergeConfigs, validateConfig } from '../../config/schema';
import { OPTS, action, change, update } from './fixtures';
import type { Check } from '../types';

const cfg = (raw: unknown = {}) => mergeConfigs(validateConfig(raw, 'personal').config, {});
const lines = (n: number, p = 'l') => Array.from({ length: n }, (_, i) => `${p}${i}`);
const known = (file: string, removed: number, total: number) => {
  const c = change(update(file, lines(removed), ['x'], []), { original: lines(total).join('\n') + '\n' });
  c.matched = true;
  return c;
};

describe('scoreAction', () => {
  it('small edit to a big file → allow, low', () => {
    const d = scoreAction(action([known('src/a.ts', 2, 2000)]), cfg());
    expect(d.tier).toBe('allow');
    expect(d.files[0].level).toBe('low');
  });

  it('full rewrite of an ordinary file: asked under balanced, blocked under strict', () => {
    expect(scoreAction(action([known('lib/a.ts', 38, 40)]), cfg()).tier).toBe('ask');
    expect(scoreAction(action([known('lib/a.ts', 38, 40)]), cfg({ preset: 'strict' })).tier).toBe('block');
  });

  it('rewrite of a protected file → block (50 + 30)', () => {
    expect(scoreAction(action([known('src/auth/a.ts', 38, 40)]), cfg()).tier).toBe('block');
  });

  it('delete with uncommitted changes → ask (35 + 30 = 65)', () => {
    const d = scoreAction(action([change(['*** Delete File: lib/a.ts'], { gitDirty: true })]), cfg());
    expect(d.tier).toBe('ask');
    expect(d.files[0].score).toBe(65);
  });

  it('hard rule on one file blocks a multi-file action', () => {
    const ok = change(update('lib/b.ts', ['a'], ['b']));
    const bad = change(update('lib/a.ts', ['real()'], ['// ... rest of code unchanged']));
    const d = scoreAction(action([ok, bad]), cfg());
    expect(d.tier).toBe('block');
    expect(d.files.map(f => f.tier)).toEqual(['allow', 'block']);
  });

  it('test-file discount reduces size points only', () => {
    const t = known('src/a.test.ts', 38, 40);
    expect(scoreAction(action([t]), cfg()).files[0].score).toBe(40);
    const skip = change(update('src/a.test.ts', [], ["it.skip('x', () => {})"]));
    expect(scoreAction(action([skip]), cfg()).files[0].score).toBe(30);
  });

  it('config: off, block, points and per-folder preset', () => {
    const c = change(update('lib/a.ts', [], ['// eslint-disable-next-line']));
    expect(scoreAction(action([c]), cfg({ categories: { checks_disabled: 'off' } })).files[0].findings).toEqual([]);
    expect(scoreAction(action([c]), cfg({ categories: { checks_disabled: 'block' } })).tier).toBe('block');
    expect(scoreAction(action([c]), cfg({ categories: { checks_disabled: 45 } })).tier).toBe('ask');
    expect(scoreAction(action([c]), cfg({ paths: { 'lib/**': { cutoffs: { ask: 10, block: 90 } } } })).tier).toBe('ask');
  });

  it('log-only findings are recorded with 0 points', () => {
    const c = change(update('lib/a.ts', ['const u = process.env.A;'], ['const u = process.env.B;']));
    const f = scoreAction(action([c]), cfg()).files[0];
    expect(f.findings).toEqual([expect.objectContaining({ id: 'env_key_renamed', points: 0, logOnly: true })]);
    expect(f.score).toBe(0);
  });

  it('custom rules: path and content', () => {
    const c = change(update('billing/pay.ts', [], ['legacyCharge()']));
    const d = scoreAction(action([c]), cfg({ custom_rules: [
      { match: 'path', pattern: 'billing/**', points: 40, message: 'Billing code: ask first' },
      { match: 'content', pattern: 'legacyCharge', points: 'block', message: 'Use charge() instead' },
    ] }));
    expect(d.tier).toBe('block');
    expect(d.files[0].findings.map(f => f.id)).toEqual(['custom:0', 'custom:1']);
  });

  it('files_touched is added to the worst file once', () => {
    const cs = lines(6).map(n => change(update(`lib/${n}.ts`, ['a'], ['b'])));
    const d = scoreAction(action(cs), cfg());
    expect(d.files.filter(f => f.findings.some(x => x.id === 'files_touched'))).toHaveLength(1);
  });

  it('a crashing signal check is skipped; a crashing critical check sets errored → ask', () => {
    const boom = (kind: 'critical' | 'signal'): Check => ({ name: `boom-${kind}`, kind, run: () => { throw new Error('x'); } });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const c = change(update('lib/a.ts', ['a'], ['b']));
    const s = scoreAction(action([c]), cfg(), { checks: [boom('signal')] });
    expect(s).toMatchObject({ tier: 'allow', errored: false });
    expect(s.files[0].skipped).toEqual(['boom-signal: crashed']);
    const k = scoreAction(action([c]), cfg(), { checks: [boom('critical')] });
    expect(k).toMatchObject({ tier: 'ask', errored: true });
    expect(scoreAction(action([c]), cfg({ on_error: 'allow' }), { checks: [boom('critical')] }).tier).toBe('allow');
  });

  it('past the deadline, signal checks are skipped but critical checks still run', () => {
    let t = 0;
    const d = scoreAction(action([change(['*** Delete File: lib/a.test.ts'])]), cfg(), { now: () => (t += DEADLINE_MS) });
    expect(d.files[0].findings.map(f => f.id)).toContain('file_deleted');
    expect(d.files[0].skipped.some(s => s.endsWith('skipped (time)'))).toBe(true);
  });

  it('event numbers: structural percent, functions and exports deleted', () => {
    const c = known('lib/a.ts', 30, 40);
    c.removed = ['export function a() {}', 'function b() {}', ...lines(28)];
    c.hunks = [{ removed: c.removed, added: ['x'] }];
    const f = scoreAction(action([c]), cfg()).files[0];
    expect(f).toMatchObject({ structuralChangePercent: 75, functionsDeleted: 2, exportsDeleted: 1 });
  });
});

describe('levelFor', () => {
  it('maps score to level by cut-offs', () => {
    const c = { ask: 40, block: 70 };
    expect([levelFor(10, c), levelFor(40, c), levelFor(70, c)]).toEqual(['low', 'medium', 'high']);
  });
});

void OPTS;
```

`messages.test.ts`:
```ts
import { askMessage, blockMessage } from '../messages';
import { scoreAction } from '../engine';
import { mergeConfigs } from '../../config/schema';
import { action, change, update } from './fixtures';

const cfg = mergeConfigs({}, {});

describe('messages', () => {
  it('block message: reasons and fix, no points or cut-offs', () => {
    const d = scoreAction(action([change(update('lib/a.ts', ['real()'], ['// ... rest of code unchanged']))]), cfg);
    const m = blockMessage(d);
    expect(m).toMatch(/^ClineShield blocked this action, so nothing was changed\./);
    expect(m).toMatch(/lib\/a\.ts: replaces existing code with a placeholder/);
    expect(m).toMatch(/Fix: Write out the full code/);
    expect(m).toMatch(/Don't retry the same change in smaller pieces/);
    expect(m).not.toMatch(/\b\d+ points?\b|cut-?off|\b(40|70)\b/);
  });

  it('ask message', () => {
    const d = scoreAction(action([change(['*** Delete File: lib/a.ts'], { gitDirty: true })]), cfg);
    const m = askMessage(d);
    expect(m).toMatch(/^ClineShield asked the user to approve this action\. Why: lib\/a\.ts: deletes lib\/a\.ts/);
    expect(m).toMatch(/If the user says no, don't retry the same action/);
  });

  it('errored with no findings', () => {
    expect(askMessage({ tier: 'ask', files: [], errored: true, errors: ['x'] })).toMatch(/could not check this action/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/plugin/rubric/__tests__/engine.test.ts src/plugin/rubric/__tests__/messages.test.ts`
Expected: FAIL, "Cannot find module '../engine'".

- [ ] **Step 3: Implement `checks/index.ts`**

```ts
import { fileOpsCheck, filesTouched, locationCheck, sensitiveCheck, sizeCheck } from './files';
import { placeholder, secretAdded, selfProtection } from './hard';
import { contentCheck } from './content';
import { structureCheck } from './structure';
import { testAndSource, testsCheck } from './tests';
import type { Check } from '../types';

/** Run order: critical checks first so a deadline never skips them. */
export const ALL_CHECKS: Check[] = [
  selfProtection, placeholder, secretAdded, fileOpsCheck, sensitiveCheck,
  sizeCheck, filesTouched, locationCheck, testsCheck, testAndSource, contentCheck, structureCheck,
];
```

- [ ] **Step 4: Implement `engine.ts`**

```ts
/**
 * engine.ts
 *
 * Risk rubric engine (SPEC.md "Risk rubric"): runs the checks with crash and
 * time handling, turns findings into points per the file's config, and picks
 * the tier. Pure apart from Date.now() (injectable) and stderr logging.
 */

import { CATEGORIES, SIZE_GROUP, TEST_FILE_DISCOUNT } from './categories';
import type { Cutoffs } from './categories';
import { ALL_CHECKS } from './checks';
import { rewriteShare } from './checks/files';
import { matchesGlob } from './glob';
import { resolveFilePolicy } from '../config/schema';
import type { RubricConfig } from '../config/schema';
import type { ActionContext, Check, CategoryId, FileChange, RawFinding, Tier } from './types';

export const DEADLINE_MS = 2000;
const RANK: Record<Tier, number> = { allow: 0, ask: 1, block: 2 };

export interface Finding { id: string; points: number; block: boolean; logOnly: boolean; detail: string; fix: string }
export interface FileScore {
  file: string; score: number; tier: Tier; level: 'low' | 'medium' | 'high'; cutoffs: Cutoffs;
  findings: Finding[]; skipped: string[];
  structuralChangePercent: number; functionsDeleted: number; exportsDeleted: number;
}
export interface Decision { tier: Tier; files: FileScore[]; errored: boolean; errors: string[] }
export interface ScoreOptions { checks?: Check[]; now?: () => number; deadlineMs?: number }

export function levelFor(score: number, cutoffs: Cutoffs): 'low' | 'medium' | 'high' {
  return score >= cutoffs.block ? 'high' : score >= cutoffs.ask ? 'medium' : 'low';
}

function toFinding(raw: RawFinding, setting: number | 'off' | 'block'): Finding | undefined {
  const def = CATEGORIES[raw.category];
  if (setting === 'off') return undefined;
  const base = { id: raw.category, detail: raw.detail, fix: def.fix };
  if (def.kind === 'logOnly') return { ...base, points: 0, block: false, logOnly: true };
  if (setting === 'block') return { ...base, points: 0, block: true, logOnly: false };
  return { ...base, points: Math.round(setting * raw.weight), block: false, logOnly: false };
}

function finalize(f: FileScore, isTest: boolean): void {
  const scored = f.findings.filter(x => !x.logOnly);
  let score = scored.reduce((s, x) => s + x.points, 0);
  if (isTest) {
    const size = scored.filter(x => SIZE_GROUP.has(x.id as CategoryId)).reduce((s, x) => s + x.points, 0);
    score -= Math.min(TEST_FILE_DISCOUNT, size);
  }
  f.score = Math.max(0, Math.min(100, score));
  const blocked = scored.some(x => x.block);
  f.tier = blocked || f.score >= f.cutoffs.block ? 'block' : f.score >= f.cutoffs.ask ? 'ask' : 'allow';
  f.level = blocked ? 'high' : levelFor(f.score, f.cutoffs);
}

export function scoreAction(action: ActionContext, config: RubricConfig, options: ScoreOptions = {}): Decision {
  const checks = options.checks ?? ALL_CHECKS;
  const now = options.now ?? Date.now;
  const deadline = options.deadlineMs ?? DEADLINE_MS;
  const start = now();
  const errors: string[] = [];
  let errored = false;
  const checkOpts = { protectedPaths: config.protectedPaths, trustedDomains: config.trustedDomains };

  const runCheck = (check: Check, c: FileChange, skipped: string[]): RawFinding[] => {
    if (check.kind === 'signal' && now() - start > deadline) { skipped.push(`${check.name}: skipped (time)`); return []; }
    try {
      return check.run(c, action, checkOpts);
    } catch (e) {
      console.error(`[ClineShield] check ${check.name} crashed:`, e);
      if (check.kind === 'critical') { errored = true; errors.push(`${check.name} crashed: ${(e as Error)?.message ?? e}`); }
      else skipped.push(`${check.name}: crashed`);
      return [];
    }
  };

  const files: FileScore[] = action.changes.map(c => {
    const policy = resolveFilePolicy(config, c.path);
    const skipped: string[] = [];
    const raws = checks.filter(k => !k.perAction).flatMap(k => runCheck(k, c, skipped));
    const findings = raws.map(r => toFinding(r, policy.points[r.category])).filter((x): x is Finding => !!x);
    config.customRules.forEach((rule, i) => {
      const hit = rule.match === 'path' ? matchesGlob(c.path, rule.pattern) : rule.match === 'content' ? c.added.some(l => rule.regex!.test(l)) : false;
      if (hit) findings.push({ id: `custom:${i}`, points: rule.points === 'block' ? 0 : rule.points, block: rule.points === 'block', logOnly: false, detail: rule.message, fix: rule.message });
    });
    const count = (k: 'functionsDeleted' | 'exportsDeleted') => raws.reduce((n, r) => n + (r.counts?.[k] ?? 0), 0);
    const share = rewriteShare(c);
    const f: FileScore = {
      file: c.path, score: 0, tier: 'allow', level: 'low', cutoffs: policy.cutoffs, findings, skipped,
      structuralChangePercent: share === undefined ? 0 : Math.floor(share * 100),
      functionsDeleted: count('functionsDeleted'), exportsDeleted: count('exportsDeleted'),
    };
    finalize(f, c.isTest);
    return f;
  });

  if (files.length > 0) {
    const worstIdx = files.reduce((w, f, i) => (RANK[f.tier] > RANK[files[w].tier] || (RANK[f.tier] === RANK[files[w].tier] && f.score > files[w].score) ? i : w), 0);
    const worst = files[worstIdx];
    const policy = resolveFilePolicy(config, worst.file);
    for (const k of checks.filter(x => x.perAction)) {
      for (const r of runCheck(k, action.changes[0], worst.skipped)) {
        const f = toFinding(r, policy.points[r.category]);
        if (f) worst.findings.push(f);
      }
    }
    finalize(worst, action.changes[worstIdx].isTest);
  }

  let tier = files.reduce<Tier>((t, f) => (RANK[f.tier] > RANK[t] ? f.tier : t), 'allow');
  if (errored && config.onError === 'ask' && tier === 'allow') tier = 'ask';
  return { tier, files, errored, errors };
}
```

- [ ] **Step 5: Implement `messages.ts`**

```ts
/**
 * messages.ts
 *
 * Text Cline sees. Reasons and fixes only: never points or cut-offs, so the
 * model can't learn to slip under them (SPEC.md "Reasons").
 */

import type { Decision, Finding } from './engine';

export const REPEAT_BLOCK_NOTE = 'Stop and ask the user how to proceed.';

function top(d: Decision): Array<Finding & { file: string }> {
  return d.files
    .flatMap(f => f.findings.filter(x => !x.logOnly).map(x => ({ ...x, file: f.file })))
    .sort((a, b) => Number(b.block) - Number(a.block) || b.points - a.points)
    .slice(0, 3);
}

const why = (items: Array<Finding & { file: string }>) => items.map(x => `${x.file}: ${x.detail}`).join('; ');

export function blockMessage(d: Decision): string {
  const t = top(d);
  return (
    `ClineShield blocked this action, so nothing was changed. Why: ${why(t)}. ` +
    `Fix: ${t[0]?.fix ?? 'Make a smaller, targeted change.'} ` +
    "Don't retry the same change in smaller pieces to get around this."
  );
}

export function askMessage(d: Decision): string {
  const t = top(d);
  if (t.length === 0) {
    return 'ClineShield could not check this action and asked the user to approve it. If the user says no, ask them what they want.';
  }
  return `ClineShield asked the user to approve this action. Why: ${why(t)}. If the user says no, don't retry the same action; ask them what they want.`;
}
```

- [ ] **Step 6: Run tests**

Run: `npx jest src/plugin/rubric`
Expected: PASS. If a score in a test differs, recheck the spec numbers first: the test values come from the SPEC table.

- [ ] **Step 7: Commit**

```bash
git add clineshield/src/plugin/rubric
git commit -m "feat(rubric): add scoring engine and reason messages

- Check kinds: critical crash → on_error, signal crash → skipped
- 2 s deadline skips remaining signal checks, never critical ones
- Config points/off/block, per-folder policy, custom rules, test-file discount
- Messages carry reasons and fixes, never points or cut-offs"
```

---

### Task 11: Wire the rubric into the plugin; remove the interim policy

**Files:**
- Modify: `clineshield/src/plugin/index.ts`
- Delete: `clineshield/src/plugin/editPolicy/` (policy.ts, measure.ts, `__tests__/`), `clineshield/src/plugin/__tests__/editSizePolicy.test.ts`, `clineshield/src/plugin/__tests__/riskScoring.test.ts`
- Modify: `clineshield/src/plugin/__tests__/plugin.test.ts` (the "cannot parse" test)
- Create: `clineshield/src/plugin/__tests__/rubricPlugin.test.ts`

**Interfaces:**
- Consumes: `gatherAction`, `readCodeowners`, `scoreAction`, `blockMessage`, `askMessage`, `REPEAT_BLOCK_NOTE`, `ConfigStore`, `applyPatchInputText`, `parseApplyPatch`, `editorInputToOperation`.
- Produces: `createClineShieldPlugin(options?: { homeDir?: string; pluginDir?: string })`; `ClineShieldPlugin` gains `readonly configWarnings: string[]` (for `/clineshield` later). Existing exports `isApprovalDenied`, `TOOL_REJECTION_SUFFIX`, `guardHook`, `plugin`, default stay.

Behaviour:
- Edit tools: `apply_patch`, `editor`. Other tools → `undefined`. No `workspaceRoot` (before setup) → `undefined`.
- Parse: `apply_patch` → `applyPatchInputText` + `parseApplyPatch`; zero operations → **unparseable**. `editor` → `editorInputToOperation`; undefined → **unparseable**.
- Unparseable → treat as errored with no files: `on_error: ask` → `{ policy: { autoApprove: false }, appendContext: askMessage(...) }`, awaiting entry with one pseudo-file `'(unparsed <tool> input)'`; `on_error: allow` → `undefined`. Logged to stderr.
- Whole-rubric crash (exception escaping gather/score) → same as unparseable (try/catch inside `beforeTool`, not only `guardHook`).
- Config: `await store.get()` per action; warnings deduplicated into `configWarnings` and printed to stderr once each. On first load with `onError === 'allow'`, print once: `[ClineShield] on_error: allow — if ClineShield fails, actions run unchecked`.
- CODEOWNERS: `readCodeowners(root)` once per session (lazy, memoised promise).
- `mode: observe` → never ask/block; `risk-assessed` reasons get an extra `{ rule: 'observe', points: 0, description: 'Observe mode: would have asked|blocked' }` when the real tier was not allow.
- Block → `{ skip: true, reason }`; `edit-blocked` per file. Reason = `blockMessage`; if this is the 3rd+ block on the same file in this conversation (`snapshot.conversationId ?? ''` + file), append ` ${REPEAT_BLOCK_NOTE}`.
- Ask → as today (`policy`, `appendContext`, `edit-approval` in afterTool).
- Allow → `edit-allowed` per file.
- afterTool, successful edit → one `risk-assessed` per file from the cached `FileScore` (`rulesScore = score`, `level`, `reasons = findings.map(f => ({ rule: f.id, points: f.points, description: f.detail }))` plus `{ rule: 'skipped:<name>', points: 0, description }` per skipped entry). If nothing is cached (no beforeTool), re-score patch-only: build changes with `buildChange(op, { binary: false, outsideWorkspace: false }, display, abs)` and `scoreAction`.
- Event file field = `FileScore.file`; numbers from `FileScore`.

- [ ] **Step 1: Write the failing plugin test**

`clineshield/src/plugin/__tests__/rubricPlugin.test.ts`:
```ts
/**
 * Plugin-level tests for the Risk rubric: beforeTool decisions, events and
 * config handling against a real temp workspace.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createClineShieldPlugin, TOOL_REJECTION_SUFFIX } from '../index';
import type { AgentToolResult, ClineShieldPlugin } from '../index';
import { validateEvent } from './validateEvent';

type Event = { type: string; data: Record<string, unknown> };
const snapshot = { agentId: 'a', conversationId: 'conv-1', runId: 'r' };
const patch = (...body: string[]) => ({ input: ['*** Begin Patch', ...body, '*** End Patch'].join('\n') });
const lines = (n: number, p = 'l') => Array.from({ length: n }, (_, i) => `${p}${i}`);

describe('Risk rubric (plugin)', () => {
  let root: string;
  let home: string;
  let plugin: ClineShieldPlugin;
  let seq = 0;

  const call = (toolName: string, input: unknown) => {
    const toolCall = { toolCallId: `c${++seq}`, toolName, input };
    const ctx = { snapshot, tool: { name: toolName }, toolCall, input };
    return {
      before: () => plugin.hooks!.beforeTool!(ctx),
      after: (result: AgentToolResult = { output: 'ok' }) =>
        plugin.hooks!.afterTool!({ ...ctx, result, startedAt: new Date(), endedAt: new Date(), durationMs: 1 }),
    };
  };
  const events = async (type?: string): Promise<Event[]> => {
    await plugin.flush();
    const all = JSON.parse(await fs.readFile(path.join(root, '.cline-shield', 'metrics.json'), 'utf-8')) as Event[];
    for (const e of all) expect(validateEvent(e)).toEqual([]);
    return type ? all.filter(e => e.type === type) : all;
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-plugin-'));
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-home-'));
    await fs.mkdir(path.join(root, 'lib'));
    await fs.writeFile(path.join(root, 'lib', 'big.ts'), lines(2000).join('\n') + '\n');
    await fs.writeFile(path.join(root, 'lib', 'small.ts'), lines(40).join('\n') + '\n');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    plugin = createClineShieldPlugin({ homeDir: home, pluginDir: '/nonexistent' });
    plugin.setup?.({}, { session: { sessionId: 's1' }, workspaceInfo: { rootPath: root } });
  });
  afterEach(async () => {
    await plugin.flush();
    jest.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  it('small edit to a big file → allowed, edit-allowed + risk-assessed low', async () => {
    const c = call('apply_patch', patch('*** Update File: lib/big.ts', '@@', ' l0', '-l1', '+L1'));
    await expect(c.before()).resolves.toBeUndefined();
    await c.after();
    expect((await events('edit-allowed')).filter(e => e.data.file === 'lib/big.ts')).toHaveLength(1);
    expect((await events('risk-assessed'))[0].data).toMatchObject({ file: 'lib/big.ts', rulesScore: 0, level: 'low' });
  });

  it('full rewrite of an ordinary file → asked; approval recorded', async () => {
    const c = call('apply_patch', patch('*** Update File: lib/small.ts', '@@', ...lines(38).map(l => `-${l}`), '+x'));
    const r = await c.before();
    expect(r).toMatchObject({ policy: { autoApprove: false } });
    expect((r as { appendContext: string }).appendContext).toMatch(/asked the user to approve/);
    await c.after({ output: { error: `denied. ${TOOL_REJECTION_SUFFIX}` }, isError: true });
    const [ev] = await events('edit-approval');
    expect(ev.data).toMatchObject({ file: 'lib/small.ts', approved: false, structuralChangePercent: 95 });
  });

  it('placeholder rewrite → blocked, edit-blocked, reason without points', async () => {
    const c = call('apply_patch', patch('*** Update File: lib/small.ts', '@@', ' l0', '-l1', '+// ... rest of code unchanged'));
    const r = (await c.before()) as { skip: boolean; reason: string };
    expect(r.skip).toBe(true);
    expect(r.reason).toMatch(/placeholder/);
    expect(r.reason).not.toMatch(/points|cut-?off/);
    expect((await events('edit-blocked'))[0].data.file).toBe('lib/small.ts');
  });

  it('file delete is now evaluated (Decision 8)', async () => {
    const r = await call('apply_patch', patch('*** Delete File: lib/small.ts')).before();
    expect(r).toBeUndefined(); // 35 < 40 under balanced: allowed, but scored
    expect((await events('edit-allowed')).some(e => e.data.file === 'lib/small.ts')).toBe(true);
  });

  it('non-JS files are scored too', async () => {
    const r = await call('apply_patch', patch('*** Update File: .github/workflows/ci.yml', '@@', '-a', '+b')).before();
    expect(r).toBeUndefined(); // 35 → allow, but recorded
    await fs.writeFile(path.join(root, '.env'), 'A=1\n');
    expect(await call('apply_patch', patch('*** Update File: .env', '@@', '-A=1', '+A=2')).before()).toMatchObject({ policy: { autoApprove: false } });
  });

  it('third block on the same file adds the stop-and-ask note', async () => {
    const bad = () => call('apply_patch', patch('*** Update File: lib/small.ts', '@@', '-l1', '+// ... rest of code unchanged')).before();
    await bad(); await bad();
    expect(((await bad()) as { reason: string }).reason).toMatch(/Stop and ask the user how to proceed\.$/);
  });

  it('unparseable edit input → ask (on_error default); allow when the personal config says so', async () => {
    expect(await call('editor', { path: 'lib/a.ts' }).before()).toMatchObject({ policy: { autoApprove: false } });
    expect(await call('apply_patch', { input: 'garbage' }).before()).toMatchObject({ policy: { autoApprove: false } });
    await fs.writeFile(path.join(home, '.cline-shield.yml'), 'on_error: allow\n');
    expect(await call('editor', { path: 'lib/a.ts' }).before()).toBeUndefined();
  });

  it('a project file cannot switch protection off', async () => {
    await fs.writeFile(path.join(root, '.cline-shield.yml'), 'mode: observe\n');
    const r = await call('apply_patch', patch('*** Update File: lib/small.ts', '@@', '-l1', '+// ... rest of code unchanged')).before();
    expect(r).toMatchObject({ skip: true });
    expect(plugin.configWarnings.join('\n')).toMatch(/"mode" is only read/);
  });

  it('observe mode (personal) logs what would have happened but never blocks', async () => {
    await fs.writeFile(path.join(home, '.cline-shield.yml'), 'mode: observe\n');
    const c = call('apply_patch', patch('*** Update File: lib/small.ts', '@@', '-l1', '+// ... rest of code unchanged'));
    expect(await c.before()).toBeUndefined();
    await c.after();
    const [risk] = await events('risk-assessed');
    expect(risk.data.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'observe', description: 'Observe mode: would have blocked' })]));
  });

  it('editing the ClineShield config is blocked', async () => {
    const r = await call('editor', { path: path.join(root, '.cline-shield.yml'), new_text: 'mode: observe\n' }).before();
    expect(r).toMatchObject({ skip: true });
  });

  it('other tools and calls before setup pass through', async () => {
    expect(await call('read_files', { paths: ['x'] }).before()).toBeUndefined();
    const fresh = createClineShieldPlugin({ homeDir: home });
    expect(await fresh.hooks!.beforeTool!({ snapshot, tool: { name: 'editor' }, toolCall: { toolCallId: 'z', toolName: 'editor', input: {} }, input: {} })).toBeUndefined();
  });

  it('a 20,000-line file and patch score in under 200 ms', async () => {
    await fs.writeFile(path.join(root, 'lib', 'huge.ts'), lines(20000).join('\n') + '\n');
    const body = ['*** Update File: lib/huge.ts', '@@', ...lines(10000).map(l => `-${l}`), ...lines(10000, 'n').map(l => `+${l}`)];
    const t = Date.now();
    await call('apply_patch', patch(...body)).before();
    expect(Date.now() - t).toBeLessThan(200);
  });
});
```

In `plugin.test.ts`, replace the test `'beforeTool and afterTool pass through calls the policy cannot parse'` with:
```ts
    it('an edit input the rubric cannot parse is sent to the user (on_error: ask)', async () => {
      const p = createClineShieldPlugin({ homeDir: root });
      p.setup?.({}, { workspaceInfo: { rootPath: root } });
      const before = await p.hooks?.beforeTool?.({ snapshot, tool: { name: 'editor' }, toolCall, input: toolCall.input });
      expect(before).toMatchObject({ policy: { autoApprove: false } });
      await p.flush();
    });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/plugin/__tests__/rubricPlugin.test.ts src/plugin/__tests__/plugin.test.ts`
Expected: FAIL (`configWarnings` undefined, rubric not wired, options ignored).

- [ ] **Step 3: Rewrite `plugin/index.ts`**

Keep the header comment (update it to describe the rubric), `TOOL_REJECTION_SUFFIX`, `isApprovalDenied`, `guardHook`, `toDisplayPath`, the `setup` body and the exports. Replace the policy parts with:

```ts
import { randomUUID } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { appendEvent } from '../metrics/writer';
import type { MetricsEvent } from '../types/metrics';
import { ConfigStore } from './config/store';
import type { RubricConfig } from './config/schema';
import { applyPatchInputText, editorInputToOperation, parseApplyPatch } from './patch';
import type { FileOperation } from './patch';
import { buildChange, gatherAction, readCodeowners } from './rubric/gather';
import { scoreAction } from './rubric/engine';
import type { Decision, FileScore } from './rubric/engine';
import { askMessage, blockMessage, REPEAT_BLOCK_NOTE } from './rubric/messages';
import type {
  AgentAfterToolContext,
  AgentAfterToolResult,
  AgentBeforeToolContext,
  AgentBeforeToolResult,
  AgentPlugin,
  PluginSetupContext,
} from './types';

const EDIT_TOOLS = new Set(['apply_patch', 'editor']);
const UNPARSED = (tool: string) => `(unparsed ${tool} input)`;

/** The plugin's own install folder (repo root of clineshield/src/plugin). */
const DEFAULT_PLUGIN_DIR = path.resolve(__dirname, '..', '..', '..');

function operationsFor(toolName: string, input: unknown): FileOperation[] | undefined {
  if (toolName === 'apply_patch') {
    const text = applyPatchInputText(input);
    const ops = text === undefined ? [] : parseApplyPatch(text).operations;
    return ops.length > 0 ? ops : undefined;
  }
  const op = editorInputToOperation(input);
  return op ? [op] : undefined;
}

export interface ClineShieldPlugin extends AgentPlugin {
  readonly sessionId: string | undefined;
  readonly workspaceRoot: string | undefined;
  /** Config warnings seen this session (shown by `/clineshield` later). */
  readonly configWarnings: string[];
  flush(): Promise<void>;
}

export interface PluginOptions { homeDir?: string; pluginDir?: string }

export function createClineShieldPlugin(options: PluginOptions = {}): ClineShieldPlugin {
  const homeDir = options.homeDir ?? os.homedir();
  const pluginDir = options.pluginDir ?? DEFAULT_PLUGIN_DIR;
  let sessionId: string | undefined;
  let workspaceRoot: string | undefined;
  let store: ConfigStore | undefined;
  let codeowners: Promise<string[]> | undefined;
  let warnedAllow = false;
  const configWarnings: string[] = [];
  const pending = new Set<Promise<void>>();
  /** Decisions by toolCallId: ask entries await afterTool; all feed risk-assessed. */
  const decided = new Map<string, { decision: Decision; asked: boolean; reason: string; observedTier?: 'ask' | 'block' }>();
  const blockCounts = new Map<string, number>();

  function record(event: MetricsEvent): void {
    if (!workspaceRoot) return;
    const write = appendEvent(event, workspaceRoot).finally(() => pending.delete(write));
    pending.add(write);
  }
  const sid = () => sessionId ?? 'unknown-session';
  const editData = (f: FileScore) => ({
    file: f.file, structuralChangePercent: f.structuralChangePercent, functionsDeleted: f.functionsDeleted, exportsDeleted: f.exportsDeleted,
  });

  async function loadConfig(): Promise<RubricConfig> {
    const { config, warnings } = await store!.get();
    for (const w of warnings) {
      if (!configWarnings.includes(w)) { configWarnings.push(w); console.error(`[ClineShield] config: ${w}`); }
    }
    if (config.onError === 'allow' && !warnedAllow) {
      warnedAllow = true;
      console.error('[ClineShield] on_error: allow — if ClineShield fails, actions run unchecked');
    }
    return config;
  }

  function errorDecision(file: string): Decision {
    return {
      tier: 'ask', errored: true, errors: [file],
      files: [{ file, score: 0, tier: 'ask', level: 'medium', cutoffs: { ask: 0, block: 100 }, findings: [], skipped: [], structuralChangePercent: 0, functionsDeleted: 0, exportsDeleted: 0 }],
    };
  }

  async function decide(toolName: string, input: unknown): Promise<{ decision: Decision; config: RubricConfig } | undefined> {
    const config = await loadConfig();
    const ops = operationsFor(toolName, input);
    if (!ops) {
      console.error(`[ClineShield] could not parse ${toolName} input`);
      return config.onError === 'ask' ? { decision: errorDecision(UNPARSED(toolName)), config } : undefined;
    }
    codeowners ??= readCodeowners(workspaceRoot!);
    const action = await gatherAction(ops, { workspaceRoot: workspaceRoot!, homeDir, pluginDir, codeownersGlobs: await codeowners });
    return { decision: scoreAction(action, config), config };
  }

  async function beforeTool(ctx: AgentBeforeToolContext): Promise<AgentBeforeToolResult | undefined> {
    const toolName = ctx.toolCall?.toolName ?? ctx.tool?.name;
    if (!EDIT_TOOLS.has(toolName) || !workspaceRoot) return undefined;
    store ??= new ConfigStore({ workspaceRoot, homeDir });
    let result: { decision: Decision; config: RubricConfig } | undefined;
    try {
      result = await decide(toolName, ctx.input);
    } catch (error) {
      console.error('[ClineShield] rubric failed:', error);
      const config = await loadConfig().catch(() => undefined);
      result = config?.onError === 'allow' ? undefined : { decision: errorDecision(UNPARSED(toolName)), config: config! };
    }
    if (!result) return undefined;
    const { decision, config } = result;
    const id = ctx.toolCall?.toolCallId;
    const timestamp = new Date().toISOString();

    if (config?.mode === 'observe' && decision.tier !== 'allow') {
      if (id !== undefined) decided.set(id, { decision, asked: false, reason: '', observedTier: decision.tier });
      for (const f of decision.files) record({ timestamp, sessionId: sid(), type: 'edit-allowed', data: editData(f) });
      return undefined;
    }

    if (decision.tier === 'block') {
      let reason = blockMessage(decision);
      const key = `${ctx.snapshot?.conversationId ?? ''}:${decision.files.find(f => f.tier === 'block')?.file ?? ''}`;
      const n = (blockCounts.get(key) ?? 0) + 1;
      blockCounts.set(key, n);
      if (n >= 3) reason += ` ${REPEAT_BLOCK_NOTE}`;
      for (const f of decision.files) record({ timestamp, sessionId: sid(), type: 'edit-blocked', data: { ...editData(f), reason } });
      return { skip: true, reason };
    }

    if (id !== undefined) decided.set(id, { decision, asked: decision.tier === 'ask', reason: decision.tier === 'ask' ? askMessage(decision) : '' });
    if (decision.tier === 'ask') {
      return { policy: { autoApprove: false }, appendContext: askMessage(decision) };
    }
    for (const f of decision.files) record({ timestamp, sessionId: sid(), type: 'edit-allowed', data: editData(f) });
    return undefined;
  }

  function recordRisk(decision: Decision, observedTier?: 'ask' | 'block'): void {
    const timestamp = new Date().toISOString();
    for (const f of decision.files) {
      if (f.file.startsWith('(unparsed')) continue;
      const reasons = [
        ...f.findings.map(x => ({ rule: x.id, points: x.points, description: x.detail })),
        ...f.skipped.map(s => ({ rule: `skipped:${s.split(':')[0]}`, points: 0, description: s })),
        ...(observedTier ? [{ rule: 'observe', points: 0, description: `Observe mode: would have ${observedTier === 'ask' ? 'asked' : 'blocked'}` }] : []),
      ];
      record({ timestamp, sessionId: sid(), type: 'risk-assessed', data: { file: f.file, rulesScore: f.score, level: f.level, reasons } });
    }
  }

  async function afterTool(ctx: AgentAfterToolContext): Promise<AgentAfterToolResult | undefined> {
    const toolName = ctx.toolCall?.toolName ?? ctx.tool?.name;
    if (!EDIT_TOOLS.has(toolName) || !workspaceRoot) return undefined;
    const id = ctx.toolCall?.toolCallId;
    const entry = id === undefined ? undefined : decided.get(id);
    if (id !== undefined) decided.delete(id);

    if (entry?.asked) {
      const approved = !isApprovalDenied(ctx.result);
      const timestamp = new Date().toISOString();
      for (const f of entry.decision.files) {
        record({ timestamp, sessionId: sid(), type: 'edit-approval', data: { ...editData(f), reason: entry.reason, approved } });
      }
    }
    if (ctx.result?.isError) return undefined;

    if (entry) { recordRisk(entry.decision, entry.observedTier); return undefined; }
    // No beforeTool decision (e.g. hook added mid-session): patch-only re-score; the file has already changed.
    const ops = operationsFor(toolName, ctx.input);
    if (!ops) return undefined;
    store ??= new ConfigStore({ workspaceRoot, homeDir });
    const config = await loadConfig();
    const root = workspaceRoot;
    const changes = ops.map(op => buildChange(op, { binary: false, outsideWorkspace: false }, p => toDisplayPath(p, root), path.resolve(root, op.path)));
    recordRisk(scoreAction({ workspaceRoot: root, homeDir, pluginDir, codeownersGlobs: [], changes }, config));
    return undefined;
  }

  return {
    name: 'clineshield',
    manifest: { capabilities: ['hooks'] },
    get sessionId() { return sessionId; },
    get workspaceRoot() { return workspaceRoot; },
    get configWarnings() { return configWarnings; },
    async flush() { await Promise.all([...pending]); },
    // setup(): keep the current body exactly (workspace root, session id, session-start marker).
    setup(_api: unknown, ctx: PluginSetupContext): void { /* copy from the current index.ts */ },
    hooks: {
      beforeTool: guardHook<AgentBeforeToolContext, AgentBeforeToolResult>('beforeTool', beforeTool),
      afterTool: guardHook<AgentAfterToolContext, AgentAfterToolResult>('afterTool', afterTool),
    },
  };
}
```

Remove the imports of `computeRiskScore` and `editPolicy`. Then delete the interim modules and their tests:
```bash
git rm -r clineshield/src/plugin/editPolicy clineshield/src/plugin/__tests__/editSizePolicy.test.ts clineshield/src/plugin/__tests__/riskScoring.test.ts
```

Note on `toDisplayPath` vs gather's display path: both produce workspace-relative POSIX for inside paths; gather resolves outside paths to absolute. Keep `toDisplayPath` only for the afterTool fallback.

- [ ] **Step 4: Run the plugin tests, then the whole suite and the type check**

Run: `npx jest src/plugin`
Expected: PASS (if the < 200 ms test is flaky on CI, it measures `beforeTool` on a warm process; run it twice and keep the assertion: the target is part of the spec).

Run: `npm test && npx tsc -p . --noEmit`
Expected: all suites PASS, no type errors. Coverage threshold (80 %) still met; if not, add the missing branch tests to the relevant check test file.

- [ ] **Step 5: Commit**

```bash
git add -A clineshield/src/plugin
git commit -m "feat(plugin): score every edit with the risk rubric

- beforeTool gathers, scores and maps tiers to allow / ask / block for all files
- on_error for unparseable input and rubric crashes; observe mode; 3-block notice
- risk-assessed carries rubric categories; file deletes are now evaluated
- Remove the interim 1.x size policy (closes Decision 8)"
```

---

### Task 12: SPEC update, manual-check instructions, PR

**Files:**
- Modify: `SPEC.md`

- [ ] **Step 1: Update SPEC.md**

- In "Risk rubric": tick every ① checkbox. Leave ②, ③, ④ and "Manual: real CLI session" unticked.
- In "Rubric configuration": tick every box, and correct two lines to match what was built:
  - `yaml` → `js-yaml` (already a dependency of the extension; no install scripts).
  - Warnings line: "…with a warning to stderr, kept for `/clineshield` (Terminal visibility)…"; `on_error: allow` line: "logged to stderr at first use; shown in the extension (VS Code extension feature)".
- In "Action tiers": change "Today it is driven by the 1.x size rules; the Risk rubric replaces the scoring." to "Driven by the Risk rubric." and mark the "Interim scoring" item as replaced.
- In "Risk scoring after edits": note that `risk-assessed` now comes from the rubric.
- In "Rubric configuration", add one line: "Default `protected_paths` (when no file sets it): `src/auth/**`, `src/config/**`, `src/middleware/**`, `auth/**`, `config/**`."
- Open decisions: move #8 to Decided ("closed by Risk rubric ①").

- [ ] **Step 2: Full verification**

Run: `cd clineshield && npm test && npx tsc -p . --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit, push, open the PR**

```bash
git add SPEC.md
git commit -m "docs(spec): tick Risk rubric ① and Rubric configuration

- js-yaml instead of yaml; warnings to stderr until /clineshield exists
- Decision 8 closed"
git push -u origin phase-9/risk-rubric
gh pr create --title "feat(plugin): risk rubric ① and rubric configuration" --body "$(cat <<'EOF'
Implements SPEC.md "Risk rubric" PR ① and "Rubric configuration".

- One engine scores every apply_patch / editor action: hard rules, size, file operations, sensitive files, weakening safety, content, code structure (6 languages by patterns)
- Personal + project YAML, loosening keys personal-only, per-folder overrides, custom rules, observe mode, on_error
- Replaces the interim 1.x size rules; closes Decision 8
- CI: new job installs like `cline plugin install` and loads the plugin with root dependencies only

Manual checks left open (need the Cline CLI): see SPEC.md.
EOF
)"
```

- [ ] **Step 4: Wait for CI**

Run: `gh pr checks --watch`
Expected: `test` and `plugin-install` pass. Do not merge: the owner merges.

- [ ] **Step 5: Give the owner the manual check commands**

```bash
# In a clean folder with the Cline CLI installed:
cline plugin install https://github.com/HansChundekad/ClineShield@phase-9/risk-rubric
cd test-workspace && cline "Rewrite src/utils.ts completely"        # expect: approval prompt
cline "Replace the body of one function with // ... rest unchanged"  # expect: blocked with a reason
cat .cline-shield/metrics.json | tail -40                            # expect: edit-approval / edit-blocked / risk-assessed
```
