# Session memory (Risk rubric ④, basic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the plugin a bounded in-memory session store (test outcome, edits, reads) and use it for `test_and_source` (15 → 30 after a failed test run) and three log-only signals.

**Architecture:** A pure `SessionStore` class plus pure input/output parsers in `rubric/session.ts`. The plugin owns one store, feeds it from afterTool (`run_commands`, `read_files`, successful edits) and hands a read-only `SessionView` to the engine through `ActionContext.session`. Checks stay pure; the engine is unchanged.

**Tech Stack:** TypeScript, Jest (`npm test` in `clineshield/`).

**Spec:** `docs/superpowers/specs/2026-11-11-session-signals-design.md`

## Global Constraints

- Work in `/Users/hanschundekad/ClineShield-session-signals` (branch `phase-9/session-signals`); run tests from `clineshield/`.
- metrics.json schema unchanged; nothing new written to disk.
- Hooks never throw; a session crash skips the signal and logs to stderr; stderr only.
- Points/cut-offs never reach Cline (log-only findings already go only to `reasons[]`).
- Values: window 10 min; `edit_loop` fires at ≥ 4 prior edits in window; churn fires when total > 1,000; store ≤ 500 files, ≤ 20 timestamps per file; `test_and_source` weight 2 after a failed run (30 points at default 15).
- Commit format `<type>(<scope>): <subject>`; no AI mention, no Co-Authored-By. Commit only when the owner asks — steps marked "Commit" mean stage and wait.

## Review Focus

1. `read_files` legacy input shapes (plain string, `paths`, `file_path`) must register reads — Task 2 test `readPaths legacy shapes`.
2. `read_files` with a whole-tool error (`isError`, e.g. skipped) must record nothing — Task 4 test.
3. Test command run via `env CI=1 npm test` or `timeout 60 npx jest` (wrappers) still counts — Task 2 test `wrappers`.
4. Absolute paths in reads vs workspace-relative change paths must match — Task 4 test `absolute read path matches edit`.
5. Edit approved after an ask (autoApprove path) records an edit exactly once — Task 4 test.

---

### Task 1: SessionStore

**Files:**
- Create: `clineshield/src/plugin/rubric/session.ts`
- Test: `clineshield/src/plugin/rubric/__tests__/session.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const EDIT_WINDOW_MS = 600_000, MAX_FILES = 500, MAX_EDITS_PER_FILE = 20, EDIT_LOOP_PRIOR = 4, CHURN_LIMIT = 1000;
  export type TestOutcome = 'passed' | 'failed';
  export interface SessionView { lastTestFailed: boolean; churn: number; priorEdits(path: string): number; known(path: string): boolean }
  export class SessionStore {
    constructor(now?: () => number);
    view(): SessionView;              // live read-only view; priorEdits prunes by window at call time
    recordTestOutcome(o: TestOutcome | undefined): void;  // undefined = no change
    recordRead(path: string): void;   // marks known
    recordEdit(path: string, lines: number): void;  // timestamp + known + churn += lines
    recordDelete(path: string): void; // forgets path
    recordMove(from: string, to: string): void; // forgets from, marks to known (no history)
    readonly size: number;            // tracked files
  }
  ```
  Paths are display paths (caller normalises). Store: `Map<string, { edits: number[] }>`; re-insert on touch so Map order = LRU; evict first key above `MAX_FILES`.

- [ ] **Step 1: Write failing tests** — `outcome failed→passed clears; undefined keeps`, `recordEdit marks known and adds churn`, `priorEdits counts only last 10 min` (fake `now`: edits at t=0, 1 min; at t=10 min+1 ms only the 1-min one counts), `21st edit drops oldest (priorEdits ≤ 20)`, `501st file evicts least-recently touched; touching keeps it`, `delete forgets; move marks target known and drops source`.
- [ ] **Step 2: Run** `npx jest src/plugin/rubric/__tests__/session.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement** `SessionStore` per the interface.
- [ ] **Step 4: Run** same command — PASS.

### Task 2: Test-run and read parsers

**Files:**
- Modify: `clineshield/src/plugin/rubric/session.ts`
- Test: `clineshield/src/plugin/rubric/__tests__/session.test.ts`

**Interfaces:**
- Consumes: `normaliseCommands` (`rubric/commands`), `parseEntries`, `simplify`, `ParseEnv`, `ParseError` (`rubric/commands/parse`).
- Produces:
  ```ts
  export function isTestRun(entry: CommandEntry, env: ParseEnv): boolean;
  export function testOutcome(input: unknown, result: { output?: unknown; isError?: boolean } | undefined, env: ParseEnv): TestOutcome | undefined;
  export function readPaths(input: unknown, result: { output?: unknown; isError?: boolean } | undefined): string[]; // raw paths of successful entries
  ```
- `isTestRun`: parse the one entry (ParseError → false); depth-0 pieces must be ≥ 0 `cd` pieces then exactly one test piece last; any piece with `pipedFrom` → false. Test piece by `simplify(p)` name + args: `npm|pnpm|yarn|bun` + `test` | `run test` | `run test:*`; `npx|pnpm exec|yarn|bunx` + `jest|vitest|mocha`; `jest|vitest|mocha|pytest|rspec`; `python|python3 -m pytest|unittest`; `go|cargo|dotnet|mvn|gradle|./gradlew(name gradlew)|make` + `test`.
- `testOutcome`: `isError` or output not an array → undefined. For each entry index where `isTestRun`: `success===true` → passed; `error` matches `/^Command exited with code [1-9]\d*/` → failed; else unknown. Any failed → 'failed'; else any passed → 'passed'; else undefined.
- `readPaths`: `isError` → []. Normalise input shapes like the SDK (`{files}`, `{paths}`, `{file_paths}`, string, array of string/`{path}`/`{file_path}`/`{filePath}`, single object); keep entries whose output[i].success === true; output not an array → [].

- [ ] **Step 1: Write failing tests** — `isTestRun` true for each listed command and `cd app && npm test`, `env CI=1 npm test`, `timeout 60 npx jest` (wrappers); false for `npm run build && npm test`, `npm test | tail -20`, `npm test || true`, `npm install`, `echo test`, unparsable `npm test "`. `testOutcome`: `[{success:false,error:'Command exited with code 1'}]` → failed; `success:true` → passed; `error:'Command timed out after 1ms'`, `'Command terminated by signal SIGTERM'`, `'Command failed: x'` → undefined; `isError:true` → undefined; two test entries one failed → failed; non-test entry failing → undefined. `readPaths`: `{files:[{path:'/ws/a.ts'},{path:'/ws/b.ts',start_line:1,end_line:5}]}` with second `success:false` → `['/ws/a.ts']`; legacy shapes `'x.ts'`, `{paths:['x.ts']}`, `{file_path:'x.ts'}` → `['x.ts']`.
- [ ] **Step 2: Run** session tests — FAIL.
- [ ] **Step 3: Implement** the three functions.
- [ ] **Step 4: Run** — PASS.

### Task 3: Categories, check and test_and_source bump

**Files:**
- Modify: `rubric/types.ts` (CategoryId + `ActionContext.session?: SessionView`), `rubric/categories.ts`, `rubric/checks/tests.ts`, `rubric/checks/index.ts`
- Create: `rubric/checks/session.ts`
- Test: `rubric/checks/__tests__/session.test.ts`, `rubric/__tests__/categories.test.ts`, `rubric/__tests__/engine.test.ts`

**Interfaces:**
- Consumes: `SessionView`, `EDIT_LOOP_PRIOR`, `CHURN_LIMIT` (Task 1).
- Produces: categories `edit_loop` (15), `unread_file` (10), `session_churn` (15): kind `logOnly`, group `null`. `export const sessionCheck: Check` (name `session`, kind `signal`, per-file). Detail strings end with `(would add N)` using `CATEGORIES[id].max`.
- `sessionCheck.run(c, a)`: no `a.session` or `c.shellEdit` → []. `edit_loop` when known lines and `a.session.priorEdits(c.path) >= EDIT_LOOP_PRIOR` (detail `edit ${n+1} of this file in 10 minutes`). `unread_file` when `c.exists === true && c.kind !== 'add' && !a.session.known(c.path)`. `session_churn` only when `c === a.changes[0]`: total = `session.churn + Σ (added+removed)` over non-shell changes; fires when `> CHURN_LIMIT`.
- `testAndSource`: weight `a.session?.lastTestFailed ? 2 : 1`; detail adds `, after a failed test run` when bumped.

- [ ] **Step 1: Write failing tests** — categories table `[15,'logOnly',null]`, `[10,…]`, `[15,…]`. Check: edit_loop at priorEdits 4 fires, 3 doesn't; unread_file fires for existing unread, not for known / `kind:'add'` / `exists:undefined` / shellEdit; churn 1,000 total no, 1,001 yes, only on first change. Engine (`scoreAction` with `action(..., { session })`): test+source after failed run → `test_and_source` 30 points; after pass → 15; next to `tests_skipped` (30, same group) in the test file the score of that file is unchanged rules-wise but the worst file gets 30 from `test_and_source` (assert finding points 30, not dropped); config `categories: { test_and_source: 20 }` → 40 when failed; log-only findings have points 0 and `categories: { edit_loop: 'off' }` removes it; a throwing view (`priorEdits` throws) → skipped `session: crashed`, tier unchanged.
- [ ] **Step 2: Run** `npx jest src/plugin/rubric` — FAIL.
- [ ] **Step 3: Implement**; add `sessionCheck` to `ALL_CHECKS`.
- [ ] **Step 4: Run** `npx jest src/plugin/rubric` — PASS.

### Task 4: Plugin wiring

**Files:**
- Modify: `clineshield/src/plugin/index.ts`
- Test: create `clineshield/src/plugin/__tests__/sessionPlugin.test.ts` (copy setup style from `commandsPlugin.test.ts`: temp workspace + git + `createClineShieldPlugin({ homeDir, pluginDir })`)

**Interfaces:**
- Consumes: Tasks 1–3.
- One `const session = new SessionStore()` per plugin instance. In `decide()` and `decideCommands()` set `action.session = session.view()` before `scoreAction`. `decided` entries keep `lines: Map<path, number>` (added+removed) and ops kind/moveTo for edits.
- afterTool:
  - `run_commands`: `session.recordTestOutcome(testOutcome(ctx.input, ctx.result, env))` (env from workspaceRoot/homeDir/tmpdir), in its own try/catch.
  - `read_files`: for each `readPaths` path → `session.recordRead(toDisplayPath(p, workspaceRoot))`, own try/catch.
  - edits: after the existing `isError` return, per file: delete → `recordDelete`; move → `recordMove(path, moveTo)` then `recordEdit(moveTo, lines)`; else `recordEdit(path, lines)`. Fallback path (no entry) uses the changes it builds.

- [ ] **Step 1: Write failing tests** —
  - `failed test run then test+source edit logs test_and_source 30`: afterTool run_commands `npm test` with `output:[{query:'npm test',result:'',error:'Command exited with code 1',success:false}]`; then before+after apply_patch touching `src/a.test.ts` and `src/a.ts`; risk-assessed reasons contain `{rule:'test_and_source', points:30}`; after a passing run → 15.
  - `skipped edit (isError) is not recorded`: blocked/asked edit afterTool with `isError:true` ×5 → no `edit_loop` on next edit.
  - `five edits in a row log edit_loop with 0 points` and `parallel afterTools all recorded` (run 4 before/after pairs with `Promise.all`, 5th logs `edit_loop`).
  - `unread_file`: edit of existing `src/small.ts` → reason `unread_file` points 0; after afterTool `read_files` with absolute `/<root>/src/small.ts` success → no `unread_file` (absolute read path matches edit).
  - `read_files isError records nothing`.
  - `approved ask records one edit` (use the existing ask-approval helper pattern from `askPlugin.test.ts`; then priorEdits === 1 via a following edits count).
  - Timing: 500-file store, `decide` median added time logged via `console.log` in a `it` marked with the numbers (no assertion > 5 ms).
- [ ] **Step 2: Run** `npx jest src/plugin/__tests__/sessionPlugin.test.ts` — FAIL.
- [ ] **Step 3: Implement** wiring.
- [ ] **Step 4: Run** full `npm test` and `npx tsc --noEmit -p .` — all PASS.

### Task 5: SPEC + manual check

**Files:** Modify `SPEC.md` (④ checkbox and rubric rows), this plan's manual line.

- [ ] **Step 1:** SPEC: `test_and_source` row → `15 · 30 after a failed test run`; Session row → `edit_loop` · `unread_file` · `session_churn` `(15) · (10) · (15)`; move `manual_edit_overwritten` (35) and `stable_file` (10) to the roadmap; tick ④ reworded to the basic scope.
- [ ] **Step 2:** `npm test` in `clineshield/` — PASS; give the owner the manual steps; after they confirm add `Manual (date, CLI version, commit)` under ④.
- [ ] **Step 3: Commit** (on owner's word) `feat(plugin): session memory for test runs, edits and reads`.
