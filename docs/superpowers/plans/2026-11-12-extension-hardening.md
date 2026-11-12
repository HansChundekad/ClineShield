# Extension hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 7 deferred extension minors, self-heal stray `.tmp` files, and untrack committed runtime files, so ClineShield 2.0 has nothing open before the Evaluation.

**Architecture:** Pure-model fixes go in `sidebar/dashboard.ts` and `extension/riskAnalysis/explain.ts` (unit-tested as today). Provider fixes (`MetricsSidebarProvider`, `ChangeMapProvider`) get their first unit tests via a virtual `vscode` jest mock. A new pure helper `metrics/tempSweep.ts` is called by every atomic writer.

**Tech Stack:** TypeScript, jest + ts-jest, VS Code extension API, Node `fs/promises`.

**Spec:** SPEC.md ("VS Code extension", "Ask through the conversation"); handoff `docs/superpowers/handoffs/2026-11-11-phase3-manual-test.md` §2 "Deferred minors", §3; owner decisions (2026-11-12) recorded below.

## Owner decisions (2026-11-12)
- Temp files: before each atomic write, the writer deletes sibling `<file>.*.tmp` older than **30 s**. Applies to metrics.json, answers.json, the diff sidecar.
- Risk pairing: an allowed edit pairs with the **first `risk-assessed` for the same session + file after the edit, only if no other edit event (`edit-*`) for that file comes between**. Otherwise no score. (`risk-assessed` is logged in afterTool, i.e. after the edit event.)
- Explain: **all files of an edit in one Gemini request**, redacted, secrets files' contents skipped, the existing 8000-char contents cap shared evenly across files.
- Cause of stray temps (confirmed): both leftovers (main checkout 2026-11-08, sandbox 2026-11-10) are complete valid JSON → process killed between `writeFile` and `rename` (Cline's 3 s hook timeout).

## Global Constraints
- metrics.json schema fixed (`src/types/metrics.ts`); no new event types or fields.
- Plugin hooks < 2 s, never throw, stderr only, atomic writes (temp + rename).
- Extension works with no Gemini key; async file ops only.
- macOS watchers: keep both `onDidCreate` and `onDidChange`; add `onDidDelete`.
- Never update PROGRESS.md. Commit format `<type>(<scope>): <subject>` + bullets; no AI mentions, no Co-Authored-By.
- Run all commands from `clineshield/`: `npx jest <path>`; full gate `npm test && npx tsc --noEmit -p .`.

## Review Focus
1. A temp file being written right now by another process (age < 30 s) must never be swept → test "keeps fresh temp" (Task 1).
2. Sweep must not touch `metrics.json`, `metrics.json.lock`, or another file's temps (`answers.json.*.tmp` when writing metrics) → test (Task 1).
3. Item ids must stay stable across refreshes (dismiss/explanations keyed by id) → test "id unchanged after another event is appended" (Task 2).
4. A single bad timestamp must not hide the rest of the session's items → test (Task 2).
5. A multi-file edit where every file is a secrets file must still produce a prompt (diffs only, redacted) → test (Task 3).

---

### Task 1: Sweep stale temp files

**Files:**
- Create: `clineshield/src/metrics/tempSweep.ts`
- Modify: `clineshield/src/metrics/writer.ts` (`readModifyWrite`), `clineshield/src/plugin/answers.ts` (`appendNow`), `clineshield/src/plugin/sidecar.ts` (`appendNow`)
- Test: `clineshield/src/metrics/__tests__/tempSweep.test.ts`, add one case each to `writer.test.ts` and the answers/sidecar tests

**Interfaces:**
- Produces: `export const STALE_TEMP_MS = 30_000;` and `export async function sweepStaleTemps(target: string, now?: number): Promise<void>` — deletes files in `dirname(target)` named `${basename(target)}.<anything>.tmp` with `mtimeMs < now - STALE_TEMP_MS`. Never throws (missing dir, races, EPERM all swallowed).

- [ ] **Step 1: Write failing tests** in `tempSweep.test.ts` (temp dir via `fs.mkdtemp`, ages set with `fs.utimes`):
  - `removes metrics.json.123.ab.tmp aged 31 s`
  - `keeps metrics.json.123.ab.tmp aged 5 s`
  - `leaves metrics.json, metrics.json.lock, answers.json.x.tmp (old) untouched when target is metrics.json`
  - `resolves without throwing when the directory does not exist`
  - writer.test.ts: `appendEvent removes a stale metrics temp` (seed old temp, append, expect gone and event written)
  - writer.test.ts: `a failing writeFile leaves no temp` (make the temp path a directory or mock `fs.writeFile` to reject after creating) — the current `writeFile` sits outside the try.
  - one case each in answers/sidecar tests: stale `answers.json.*.tmp` / sidecar temp removed after an append.
- [ ] **Step 2:** `npx jest src/metrics src/plugin/__tests__` → new tests FAIL (module missing).
- [ ] **Step 3:** Implement `tempSweep.ts` (`readdir` + `stat` + `unlink`, all in `Promise.all` with per-file catch). Call `await sweepStaleTemps(path)` just before building the temp in the three writers. In `writer.ts` move `writeFile` inside the try so its failure also unlinks the temp.
- [ ] **Step 4:** Same jest command → PASS; `npm test` green.
- [ ] **Step 5:** Commit `fix(metrics): sweep stale temp files before each atomic write`.

### Task 2: Dashboard model — ids, NaN timestamps, risk pairing

**Files:**
- Modify: `clineshield/src/sidebar/dashboard.ts` (`validEvents`, `editItem`, `commandItem`)
- Test: `clineshield/src/sidebar/__tests__/dashboard.test.ts`

**Interfaces:**
- Produces: `ActionItem.id` format becomes `${sessionId}|${timestamp}|${kind}|${index}` where `index` is the first event's position in metrics.json (append-only, so stable). Webview treats ids as opaque; no other consumer parses them (verify with `git grep "|command\|\|edit"`).

- [ ] **Step 1: Write failing tests:**
  - `two command-assessed events in the same session and millisecond get distinct ids` (both ask; dismiss one id → the other still waiting)
  - `id unchanged after another event is appended`
  - `an event with an unparseable timestamp is ignored` (session has a valid ask, then an ask with `timestamp: 'garbage'` → waiting shows the valid ask, which still clears on an answers.json `yes`)
  - `allowed edit with no risk-assessed of its own gets no score even if a later edit of the same file has one` (edit-allowed a.ts @1, edit-allowed a.ts @3, risk-assessed a.ts @4 → first item score null, second item score = rulesScore)
  - `allowed edit pairs with the risk-assessed that follows it` (existing behaviour, keep)
  - `risk-assessed for another file or session is not used`
- [ ] **Step 2:** `npx jest src/sidebar/__tests__/dashboard.test.ts` → new tests FAIL.
- [ ] **Step 3:** In `validEvents` drop events where `!Number.isFinite(Date.parse(timestamp))`. Ids add `|${first.index}`. In `editItem`, find the first event `x` with `x.index > first.index`, same session, `x.data.file === f`, and type `risk-assessed` or starting with `edit-`; use it only if it is `risk-assessed`. (Pass all events, not just risks, into `editItem`.)
- [ ] **Step 4:** Same command → PASS; `npm test` green.
- [ ] **Step 5:** Commit `fix(sidebar): stable unique item ids, ignore bad timestamps, pair risk with its own edit`.

### Task 3: Explain every file of an edit

**Files:**
- Modify: `clineshield/src/extension/riskAnalysis/explain.ts` (`buildExplainPrompt`, `gather`)
- Test: `clineshield/src/extension/riskAnalysis/__tests__/explain.test.ts`

**Interfaces:**
- Produces: `export interface ExplainFile { file: string; diff: string; contents: string }` and `buildExplainPrompt(item: ActionItem, files: ExplainFile[]): string` (replaces the `(item, diff, fileContents)` signature; update existing tests). Commands pass `[]`.

- [ ] **Step 1: Write failing tests:**
  - `a two-file edit sends both files' diffs and contents in one request` (caller called once; prompt contains both file names and both diffs)
  - `contents cap is shared: each of 2 files is cut at 4000 chars with the truncation marker`
  - `a secrets file contributes its redacted diff but not its contents` (e.g. `.env` + `a.ts`)
  - `all-secrets edit still builds a prompt with diffs only`
  - existing single-file tests keep passing with the new signature
- [ ] **Step 2:** `npx jest src/extension/riskAnalysis` → FAIL.
- [ ] **Step 3:** `gather` maps `item.files` to `ExplainFile` (one `readSidecar` call), per-file contents cap `Math.floor(MAX_FILE_CHARS / files.length)`. Prompt subject: one `File: <name>` section per file (diff, contents), each redacted; header line stays `File(s)` neutral.
- [ ] **Step 4:** PASS; `npm test` green.
- [ ] **Step 5:** Commit `fix(explain): explain every file of a multi-file edit`.

### Task 4: Providers — watcher deletes, message errors, per-view disposables

**Files:**
- Modify: `clineshield/src/sidebar/MetricsSidebarProvider.ts` (constructor watchers, `resolveWebviewView`, `dispose`), `clineshield/src/changeMap/ChangeMapProvider.ts` (constructor)
- Create: `clineshield/src/__tests__/vscodeMock.ts` (shared minimal fake: `workspace.createFileSystemWatcher` recording `onDidCreate/onDidChange/onDidDelete` handlers, `RelativePattern`, `Uri.file`, `EventEmitter`, `window`, `commands`, `env`)
- Test: `clineshield/src/sidebar/__tests__/MetricsSidebarProvider.test.ts`, `clineshield/src/changeMap/__tests__/ChangeMapProvider.test.ts` (each `jest.mock('vscode', () => require('../../__tests__/vscodeMock'), { virtual: true })`; note `testMatch` only runs `*.test.ts`, so the mock file is not a test)

- [ ] **Step 1: Write failing tests:**
  - sidebar: `deleting metrics.json or answers.json triggers a refresh` (fire recorded onDidDelete → `onWaitingCount` called again after debounce, use fake timers)
  - sidebar: `a rejected message handler is caught and logged` (make `vscode.commands.executeCommand` reject for `setKey`; send message; expect `console.error` called and no unhandledRejection — attach a `process.on('unhandledRejection')` spy)
  - sidebar: `resolving the view twice keeps one message listener` (resolve two fake views; first view's `onDidReceiveMessage` disposable disposed; total live listeners = 1)
  - sidebar: `view dispose releases its listeners`
  - change map: `deleting metrics.json fires onDidChangeTreeData`
- [ ] **Step 2:** `npx jest src/sidebar src/changeMap` → FAIL.
- [ ] **Step 3:** Add `onDidDelete(() => …)` next to the existing two handlers in both providers. `onDidReceiveMessage(m => this.onMessage(m).catch(e => console.error('[ClineShield] sidebar message failed:', e?.message ?? e)))`. Keep a `private viewDisposables: vscode.Disposable[]`: disposed at the start of `resolveWebviewView`, in the view's `onDidDispose`, and in `dispose()`.
- [ ] **Step 4:** PASS; `npm test && npx tsc --noEmit -p .` green.
- [ ] **Step 5:** Commit `fix(extension): handle deletes, message errors and re-resolved views`.

### Task 5: Untrack runtime files; SPEC and handoff bookkeeping

**Files:**
- Modify: `.gitignore`, `SPEC.md`, `docs/superpowers/handoffs/2026-11-11-phase3-manual-test.md` (§2 minors and risk 8 marked fixed with the commit), `clineshield/src/types/metrics.ts:8` (drop the reference to `.cline-shield/metrics.json` as example events)

- [ ] **Step 1:** Verified in planning: nothing in tests, scripts or CI reads `.cline-shield/metrics.json` or `clineshield/.cline-shield/metrics.json` (`git grep`; CI runs `npm test` and `check-plugin-load.ts` only). Re-run `git grep -n "cline-shield/metrics.json" -- ':!*.md'` to confirm.
- [ ] **Step 2:** `git rm --cached .cline-shield/metrics.json clineshield/.cline-shield/metrics.json`; add `.cline-shield/` to `.gitignore` (comment: runtime log, answers, sidecar). Fixture `clineshield/src/plugin/visibility/__tests__/fixtures/metrics.json` stays tracked (`git ls-files` check).
- [ ] **Step 3:** `npm test` green.
- [ ] **Step 4:** Commit `chore(repo): stop tracking runtime .cline-shield files`.

(SPEC's two manual lines are ticked in Part 2, after the owner's manual run, in their own commit.)
